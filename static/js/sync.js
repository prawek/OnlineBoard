/** Durable ordered outbox. Server mutations are idempotent and merge object IDs. */
import { applyMutation, EMPTY_DOCUMENT, uid } from './document.js';
import { LocalCache } from './storage.js';

export class BoardSync {
    constructor({ onDocument, onStatus, onError }) {
        this.onDocument = onDocument;
        this.onStatus = onStatus;
        this.onError = onError;
        this.cache = new LocalCache(() => onError('Не удалось сохранить локальную копию. Экспортируйте доску в JSON.'));
        this.clientId = this.cache.clientId;
        this.document = { ...EMPTY_DOCUMENT };
        this.outbox = [];
        this.revision = -1;
        this.sending = false;
        this.refreshing = false;
        this.started = false;
        this.blocked = false;
    }

    async start() {
        const cached = await this.cache.read();
        if (cached?.document?.schemaVersion === 1) {
            this.document = cached.document;
            this.outbox = Array.isArray(cached.outbox) ? cached.outbox : [];
            await this.onDocument(this.document);
        }
        await this.refresh();
        this.started = true;
        window.addEventListener('online', () => { this.refresh(); this.flush(); });
        window.addEventListener('offline', () => this.onStatus('offline'));
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) { this.refresh(); this.flush(); }
        });
        // Netlify Functions handle individual HTTP requests; pause polling in hidden tabs.
        this.poll = setInterval(() => {
            if (!document.hidden) { this.refresh(); this.flush(); }
        }, 5000);
        this.flush();
    }

    async request(options = {}) {
        const response = await fetch('/api/board', { ...options, signal: AbortSignal.timeout(25000) });
        if (response.status === 304) return null;
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const error = new Error(body.error || `Ошибка сервера (${response.status}).`);
            error.permanent = response.status >= 400 && response.status < 500;
            throw error;
        }
        return response.json();
    }

    async accept(remote) {
        if (remote.revision < this.revision) return;
        this.revision = remote.revision;
        this.document = this.outbox.reduce(applyMutation, remote);
        this.cache.write(this.document, this.outbox);
        await this.onDocument(this.document);
    }

    async refresh() {
        if (this.refreshing) return;
        this.refreshing = true;
        try {
            const remote = await this.request({ headers: this.revision >= 0
                ? { 'If-None-Match': `"board-${this.revision}"` } : {} });
            if (remote) await this.accept(remote);
            this.onStatus(this.blocked ? 'error' : this.outbox.length ? 'busy' : 'saved');
        } catch { this.onStatus('offline'); }
        finally { this.refreshing = false; }
    }

    enqueue(mutation, document) {
        const operation = { ...mutation, mutationId: uid(), clientId: this.clientId };
        const last = this.outbox.at(-1);
        if (last && !last.attempted && last !== this.inFlight) {
            // Intermediate typing and slider values do not need separate network writes.
            const upsert = new Map(last.upsert.map(object => [object.id, object]));
            const remove = new Set(last.remove);
            operation.remove.forEach(id => { upsert.delete(id); remove.add(id); });
            operation.upsert.forEach(object => { remove.delete(object.id); upsert.set(object.id, object); });
            Object.assign(last, { upsert: [...upsert.values()], remove: [...remove] },
                operation.title !== undefined ? { title: operation.title } : {});
        } else this.outbox.push(operation);
        this.document = document;
        this.cache.write(document, this.outbox);
        // Removing an oversized object or undoing a rejected edit can repair the queue.
        this.blocked = false;
        this.onStatus(this.blocked ? 'error' : 'busy');
        if (this.started) {
            clearTimeout(this.sendTimer);
            this.sendTimer = setTimeout(() => this.flush(), 300);
        }
    }

    async flush() {
        if (this.sending || this.blocked || !this.outbox.length) return;
        this.sending = true;
        try {
            while (this.outbox.length) {
                const operation = this.outbox[0];
                this.inFlight = operation;
                // A lost response can hide a successful commit; retry payloads must stay immutable.
                operation.attempted = true;
                this.cache.write(this.document, this.outbox);
                const remote = await this.request({ method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation) });
                this.outbox.shift();
                await this.accept(remote);
            }
            this.onStatus('saved');
        } catch (error) {
            this.onStatus(error.permanent ? 'error' : 'offline');
            if (error.permanent) {
                this.blocked = true;
                if (this.inFlight) this.inFlight.attempted = false;
                this.cache.write(this.document, this.outbox);
                this.onError(`${error.message} Изменения сохранены локально; экспортируйте доску в JSON.`);
            }
        } finally { this.sending = false; this.inFlight = null; }
    }
}

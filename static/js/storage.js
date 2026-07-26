/** IndexedDB holds large images; a synchronous mirror protects small edits on reload. */
import { uid } from './document.js';

export function readPreference(key, fallback) {
    try { return JSON.parse(localStorage.getItem(`online-board:${key}`)) ?? fallback; }
    catch { return fallback; }
}

export function writePreference(key, value) {
    try { localStorage.setItem(`online-board:${key}`, JSON.stringify(value)); }
    catch { /* Private mode and full storage should not prevent using the board. */ }
}

export class LocalCache {
    constructor(onError) {
        try {
            this.clientId = sessionStorage.getItem('online-board:client') || uid();
            sessionStorage.setItem('online-board:client', this.clientId);
        } catch { this.clientId = uid(); }
        this.key = `online-board:recovery:${this.clientId}`;
        this.onError = onError;
        this.database = new Promise(resolve => {
            if (!globalThis.indexedDB) return resolve(null);
            const request = indexedDB.open('online-board', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('recovery');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        });
    }

    async read() {
        let mirror;
        try { mirror = JSON.parse(localStorage.getItem(this.key)); } catch { /* No local mirror. */ }
        const database = await this.database;
        if (!database) return mirror;
        return new Promise(resolve => {
            const request = database.transaction('recovery').objectStore('recovery').get(this.clientId);
            request.onsuccess = () => {
                const stored = request.result;
                resolve((mirror?.savedAt || 0) >= (stored?.savedAt || 0) ? mirror : stored);
            };
            request.onerror = () => resolve(mirror);
        });
    }

    write(document, outbox) {
        const value = { document, outbox: [...outbox], savedAt: Date.now() };
        let mirrored = false;
        try {
            const encoded = JSON.stringify(value);
            if (encoded.length < 1800000) {
                localStorage.setItem(this.key, encoded);
                mirrored = true;
            } else localStorage.removeItem(this.key);
        } catch { /* IndexedDB can still have free space when localStorage is full. */ }
        this.database.then(database => {
            if (!database) {
                if (!mirrored) this.onError();
                return;
            }
            const transaction = database.transaction('recovery', 'readwrite');
            transaction.objectStore('recovery').put(value, this.clientId);
            transaction.onerror = () => { if (!mirrored) this.onError(); };
        }).catch(() => { if (!mirrored) this.onError(); });
    }
}

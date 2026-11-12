import { test } from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './test-database.mjs';
import { createHandler } from '../server/api.js';
import { readFile } from 'node:fs/promises';

const object = id => ({ id, type: 'textbox', text: 'Текст', left: 20, top: 10 });
const mutation = (id, values = {}) => ({ clientId: 'test', mutationId: id, upsert: [], remove: [], ...values });

test('API persistence, concurrent object merging, retries, rollback and validation', async () => {
    const { db, pool, repository } = await testDatabase();
    try {
        const handler = createHandler(repository);
        const request = (method = 'GET', data, headers = {}) => handler(new Request('http://localhost/api/board', {
            method, headers: { 'Content-Type': 'application/json', ...headers },
            ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        }));
        assert.equal((await request()).status, 200);
        await Promise.all(Array.from({ length: 4 }, (_, i) => repository.apply(mutation(`add-${i}`, { upsert: [object(`${i}`)] }))));
        assert.equal((await repository.get()).objects.length, 4);
        assert.equal((await repository.get()).revision, 4);
        await repository.apply(mutation('delete', { remove: ['0'] }));
        await repository.apply(mutation('add-0', { upsert: [object('0')] }));
        assert.equal((await repository.get()).objects.length, 3);
        assert.equal((await repository.get()).revision, 5);
        await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
        assert.equal((await new (repository.constructor)(pool).get()).revision, 5);
        const response = await request();
        assert.equal((await request('GET', undefined, { 'If-None-Match': response.headers.get('etag') })).status, 304);
        for (const invalid of [null, [], {}, mutation('bad', { upsert: null }), mutation('bad', { remove: null }),
            mutation('bad', { upsert: [object('x'), object('x')] }),
            mutation('bad', { upsert: [{ id: 'x', type: 'image', src: 'https://evil.invalid/a.png' }] }),
            mutation('bad', { upsert: [{ ...object('x'), left: true }] }),
            mutation('bad', { upsert: [object('x')], remove: ['x'] }),
            mutation('bad', { title: '' }), mutation('bad', { upsert: [JSON.parse('{"id":"x","type":"rect","__proto__":{}}')] })]) {
            assert.equal((await request('PATCH', invalid)).status, 400);
        }
        assert.equal((await handler(new Request('http://localhost/api/board', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{' }))).status, 400);
        assert.equal((await request('POST', {})).status, 405);
        assert.equal((await request('PATCH', mutation('large', { padding: 'x'.repeat(5 * 1024 * 1024) }))).status, 413);
        // A valid mutation can still make the merged board exceed its limit: roll back both writes.
        const many = prefix => Array.from({ length: 24 }, (_, i) => ({ ...object(`${prefix}${i}`), text: 'x'.repeat(95000) }));
        await repository.apply(mutation('big-1', { upsert: many('a') }));
        await assert.rejects(repository.apply(mutation('big-2', { upsert: many('b') })), /4 МБ/);
        assert.equal((await repository.get()).revision, 6);
        await repository.apply(mutation('big-2', { title: 'Повтор после отката' }));
        assert.equal((await repository.get()).revision, 7);
    } finally { await db.close(); }
});

test('database failures return retryable errors without exposing credentials', async () => {
    const handler = createHandler({ get() { throw new Error('secret connection string'); } });
    const response = await handler(new Request('http://localhost/api/board'));
    assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes('secret'));
});

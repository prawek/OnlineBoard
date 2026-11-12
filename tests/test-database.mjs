// Isolated PostgreSQL engine for tests only. Production never imports this file.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { BoardRepository } from '../server/repository.js';
import pg from 'pg';

export async function testDatabase() {
    const db = new PGlite();
    await db.exec(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    // PGlite has one session: serialize connection checkout, including whole transactions.
    let tail = Promise.resolve();
    const pool = {
        async connect() {
            const previous = tail;
            let release;
            tail = new Promise(resolve => { release = resolve; });
            await previous;
            return { query: (sql, args) => db.query(sql, args), release };
        },
        async query(sql, args) {
            const client = await this.connect();
            try { return await client.query(sql, args); } finally { client.release(); }
        },
    };
    return { db, pool, repository: new BoardRepository(pool) };
}

if (process.env.BOARD_TEST_DB === '1') {
    const { pool } = await testDatabase();
    process.env.DATABASE_URL = 'postgresql://test-only';
    pg.Pool = class { constructor() { return { ...pool, on() {} }; } };
}

import { readFile } from 'node:fs/promises';
import { database } from '../server/database.js';

const pool = database();
try {
    await pool.query(await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    console.log('Database schema is ready.');
} finally { await pool.end(); }

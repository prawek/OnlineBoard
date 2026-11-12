import pg from 'pg';

let pool;
export function database() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    if (!pool) {
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2,
            connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000,
            allowExitOnIdle: true, query_timeout: 12000 });
        pool.on('error', error => console.error('Database pool error:', error.code));
    }
    return pool;
}

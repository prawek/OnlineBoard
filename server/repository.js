import { validateObjects } from './validation.js';

export function document(row) {
    return { schemaVersion: 1, title: row.title, objects: row.objects,
        revision: row.revision, updatedAt: new Date(row.updated_at).toISOString() };
}

export class BoardRepository {
    constructor(pool) { this.pool = pool; }
    async get() {
        const { rows } = await this.pool.query('SELECT * FROM board WHERE id=1');
        if (!rows[0]) throw new Error('Run npm run db:migrate first');
        return document(rows[0]);
    }
    async apply(mutation) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            // All writers lock the same row before reading objects or checking retry IDs.
            const { rows: [row] } = await client.query('SELECT * FROM board WHERE id=1 FOR UPDATE');
            if (!row) throw new Error('Run npm run db:migrate first');
            const previous = await client.query('SELECT id FROM mutations WHERE id=$1 AND client_id=$2',
                [mutation.mutationId, mutation.clientId]);
            if (previous.rows.length) {
                await client.query('COMMIT');
                return document(row);
            }
            const objects = new Map(row.objects.map(object => [object.id, object]));
            mutation.remove.forEach(id => objects.delete(id));
            mutation.upsert.forEach(object => objects.set(object.id, object));
            const updated = validateObjects([...objects.values()]);
            const { rows: [saved] } = await client.query(`UPDATE board SET title=$1, objects=$2::jsonb,
                revision=revision+1, updated_at=clock_timestamp() WHERE id=1 RETURNING *`,
                [mutation.title ?? row.title, JSON.stringify(updated)]);
            await client.query('INSERT INTO mutations VALUES ($1, $2, $3)',
                [mutation.mutationId, mutation.clientId, saved.revision]);
            await client.query('COMMIT');
            return document(saved);
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally { client.release(); }
    }
}

import { ValidationError, validateMutation, MAX_REQUEST_BYTES } from './validation.js';

const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });

export function createHandler(repository) {
    return async request => {
        try {
            if (request.method === 'GET') {
                const board = await repository.get();
                const etag = `"board-${board.revision}"`;
                if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
                return json(board, 200, { ETag: etag });
            }
            if (request.method !== 'PATCH') return json({ error: 'Метод не поддерживается.' }, 405, { Allow: 'GET, PATCH' });
            if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
                return json({ error: 'Ожидается Content-Type: application/json.' }, 415);
            }
            const bytes = new Uint8Array(await request.arrayBuffer());
            if (bytes.byteLength > MAX_REQUEST_BYTES) return json({ error: 'Размер запроса превышает 4 МБ.' }, 413);
            let data;
            try { data = JSON.parse(new TextDecoder().decode(bytes)); }
            catch { return json({ error: 'Не удалось прочитать JSON.' }, 400); }
            return json(await repository.apply(validateMutation(data)));
        } catch (error) {
            if (error instanceof ValidationError) return json({ error: error.message }, 400);
            console.error('Board API failed:', error.code || error.name);
            return json({ error: 'База данных недоступна. Проверьте DATABASE_URL и миграцию.' }, 503);
        }
    };
}

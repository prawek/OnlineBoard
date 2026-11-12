import { database } from '../../server/database.js';
import { BoardRepository } from '../../server/repository.js';
import { createHandler } from '../../server/api.js';

// Lazy connection: static builds never need database credentials.
export default async function handler(request) {
    const repository = {
        get: () => new BoardRepository(database()).get(),
        apply: mutation => new BoardRepository(database()).apply(mutation),
    };
    return createHandler(repository)(request);
}

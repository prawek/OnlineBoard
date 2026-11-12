import { validateImport } from '../static/js/document.js';

export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 128 * 1024;
export class ValidationError extends Error {}

export function validateObjects(objects) {
    try { validateImport({ schemaVersion: 1, title: 'Доска', objects }); }
    catch (error) { throw new ValidationError(error.message); }
    if (Buffer.byteLength(JSON.stringify(objects)) > MAX_DOCUMENT_BYTES) {
        throw new ValidationError('Доска превышает ограничение в 4 МБ.');
    }
    return objects;
}

const identifier = value => typeof value === 'string' && value.length >= 1 && value.length <= 80;
export function validateMutation(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ValidationError('Ожидается JSON-объект.');
    if (!identifier(data.mutationId) || !identifier(data.clientId)) throw new ValidationError('Некорректный идентификатор изменения.');
    const upsert = validateObjects(Object.hasOwn(data, 'upsert') ? data.upsert : []);
    const remove = Object.hasOwn(data, 'remove') ? data.remove : [];
    if (!Array.isArray(remove) || remove.length > 3000 || !remove.every(identifier)) {
        throw new ValidationError('Некорректный список удаляемых объектов.');
    }
    const removed = new Set(remove);
    if (upsert.some(object => removed.has(object.id))) throw new ValidationError('Объект нельзя одновременно изменить и удалить.');
    const result = { mutationId: data.mutationId, clientId: data.clientId, upsert, remove };
    if (Object.hasOwn(data, 'title')) {
        if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 100) {
            throw new ValidationError('Название должно содержать от 1 до 100 символов.');
        }
        result.title = data.title.trim();
    }
    return result;
}

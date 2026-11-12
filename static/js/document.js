/** Pure document operations, also used by undo/redo and offline reconciliation. */
export const EMPTY_DOCUMENT = { schemaVersion: 1, title: 'Моя доска', objects: [], revision: 0 };
export const SERIALIZED_PROPERTIES = ['id', 'kind', 'order'];

export function uid() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function equal(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

export function diff(before, after) {
    const previous = new Map(before.objects.map(object => [object.id, object]));
    const next = new Map(after.objects.map(object => [object.id, object]));
    const changes = [];
    for (const id of new Set([...previous.keys(), ...next.keys()])) {
        const oldObject = previous.get(id) || null;
        const newObject = next.get(id) || null;
        if (!equal(oldObject, newObject)) {
            changes.push({ id, before: oldObject, after: newObject });
        }
    }
    return {
        changes,
        ...(before.title !== after.title ? { title: { before: before.title, after: after.title } } : {}),
    };
}

export function hasChanges(change) {
    return change.changes.length > 0 || Boolean(change.title);
}

export function mutationFromChange(change, direction = 'after') {
    return {
        upsert: change.changes.filter(item => item[direction]).map(item => item[direction]),
        remove: change.changes.filter(item => !item[direction]).map(item => item.id),
        ...(change.title ? { title: change.title[direction] } : {}),
    };
}

export function applyMutation(document, mutation) {
    const objects = new Map(document.objects.map(object => [object.id, object]));
    (mutation.remove || []).forEach(id => objects.delete(id));
    (mutation.upsert || []).forEach(object => objects.set(object.id, object));
    return {
        ...document,
        ...(mutation.title !== undefined ? { title: mutation.title } : {}),
        objects: [...objects.values()].sort((a, b) => (a.order || 0) - (b.order || 0)),
    };
}

export class History {
    constructor(limit = 60) {
        this.limit = limit;
        this.past = [];
        this.future = [];
    }

    record(change) {
        if (!hasChanges(change)) return;
        this.past.push(change);
        if (this.past.length > this.limit) this.past.shift();
        this.future = [];
    }

    undo() {
        const change = this.past.pop();
        if (!change) return null;
        this.future.push(change);
        return mutationFromChange(change, 'before');
    }

    redo() {
        const change = this.future.pop();
        if (!change) return null;
        this.past.push(change);
        return mutationFromChange(change);
    }
}

const TYPES = new Set(['path', 'rect', 'ellipse', 'circle', 'line', 'triangle', 'text', 'i-text', 'textbox', 'sticky-note', 'image', 'group']);
const NUMERIC_PROPERTIES = new Set(['left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'skewX',
    'skewY', 'strokeWidth', 'fontSize', 'rx', 'ry', 'radius', 'opacity', 'x1', 'x2', 'y1', 'y2', 'notePadding', 'minNoteHeight', 'order']);

function validateShape(value) {
    if (['text', 'i-text', 'textbox', 'sticky-note'].includes(value.type)
        && (typeof value.text !== 'string' || value.text.length > 100000)) throw new Error('Некорректный текст в файле.');
    if (value.type === 'image' && typeof value.src !== 'string') throw new Error('В файле отсутствует изображение.');
    if (value.type === 'group' && !Array.isArray(value.objects)) throw new Error('Некорректная группа объектов.');
    if (value.type === 'path' && (!Array.isArray(value.path) || value.path.some(command => !Array.isArray(command)
        || !command.length || typeof command[0] !== 'string' || !/^[MmLlHhVvCcSsQqTtAaZz]$/.test(command[0])
        || command.slice(1).some(number => typeof number !== 'number')))) throw new Error('Некорректная линия рисунка.');
    for (const [key, item] of Object.entries(value)) {
        if (NUMERIC_PROPERTIES.has(key) && typeof item !== 'number') throw new Error('Размеры и координаты должны быть числами.');
        if (['fontFamily', 'textAlign', 'direction', 'backgroundColor'].includes(key) && typeof item !== 'string') {
            throw new Error('Некорректные свойства текста.');
        }
    }
}

export function validateImport(data) {
    if (new TextEncoder().encode(JSON.stringify(data)).length > 4 * 1024 * 1024) {
        throw new Error('Доска превышает ограничение в 4 МБ.');
    }
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.objects) || data.objects.length > 3000) {
        throw new Error('Выберите JSON-файл доски, сохранённый через «Экспорт».');
    }
    const ids = new Set();
    function walk(value, depth = 0) {
        if (depth > 32) throw new Error('Слишком сложный объект в файле.');
        if (Array.isArray(value)) {
            if (value.length > 100000) throw new Error('Слишком большой объект в файле.');
            value.forEach(item => walk(item, depth + 1));
        } else if (value && typeof value === 'object') {
            if (Object.keys(value).length > 150) throw new Error('Слишком много свойств объекта.');
            if (TYPES.has(value.type)) validateShape(value);
            for (const [key, item] of Object.entries(value)) {
                if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Недопустимое свойство в файле.');
                if (key === 'type' && !TYPES.has(item)) throw new Error('Неподдерживаемый тип объекта.');
                if (key === 'src' && (typeof item !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$/.test(item))) {
                    throw new Error('Изображения в файле должны быть встроены в доску.');
                }
                walk(item, depth + 1);
            }
        } else if (value !== null && !['number', 'string', 'boolean'].includes(typeof value)) {
            throw new Error('Некорректное значение объекта.');
        } else if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 10000000)) {
            throw new Error('Некорректные координаты в файле.');
        }
    }
    for (const object of data.objects) {
        if (!object || !TYPES.has(object.type) || typeof object.id !== 'string' || !object.id.length || object.id.length > 80 || ids.has(object.id)) {
            throw new Error('Файл содержит некорректные объекты.');
        }
        ids.add(object.id);
        walk(object);
    }
    if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 100) {
        throw new Error('Некорректное название доски.');
    }
    return { schemaVersion: 1, title: data.title.trim(), objects: data.objects, revision: 0 };
}

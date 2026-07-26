"""Validation shared by imports and API writes. Board images are self-contained."""

import json
import math
import re

MAX_OBJECTS = 3000
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
OBJECT_TYPES = {'path', 'rect', 'ellipse', 'circle', 'line', 'triangle',
                'text', 'i-text', 'textbox', 'sticky-note', 'image', 'group'}
IMAGE_SOURCE = re.compile(r'^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\s]+$')
TEXT_TYPES = {'text', 'i-text', 'textbox', 'sticky-note'}
NUMERIC_PROPERTIES = {'left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'skewX',
                      'skewY', 'strokeWidth', 'fontSize', 'rx', 'ry', 'radius', 'opacity',
                      'x1', 'x2', 'y1', 'y2', 'notePadding', 'minNoteHeight', 'order'}


class ValidationError(ValueError):
    pass


def validate_shape(value):
    object_type = value.get('type')
    if object_type in TEXT_TYPES and (not isinstance(value.get('text'), str) or len(value['text']) > 100000):
        raise ValidationError('Некорректный текст объекта.')
    if object_type == 'image' and not isinstance(value.get('src'), str):
        raise ValidationError('У изображения отсутствует источник.')
    if object_type == 'group' and not isinstance(value.get('objects'), list):
        raise ValidationError('Некорректная группа объектов.')
    if object_type == 'path':
        path = value.get('path')
        if not isinstance(path, list) or any(
            not isinstance(command, list) or not command or not isinstance(command[0], str)
            or command[0] not in set('MmLlHhVvCcSsQqTtAaZz')
            or any(isinstance(number, bool) or not isinstance(number, (int, float)) for number in command[1:])
            for command in path
        ):
            raise ValidationError('Некорректная линия рисунка.')
    for key in NUMERIC_PROPERTIES.intersection(value):
        if isinstance(value[key], bool) or not isinstance(value[key], (int, float)):
            raise ValidationError('Свойства размеров и координат должны быть числами.')
    for key in ('fontFamily', 'textAlign', 'direction', 'backgroundColor'):
        if key in value and not isinstance(value[key], str):
            raise ValidationError('Некорректные свойства текста.')


def validate_tree(value, depth=0):
    if depth > 32:
        raise ValidationError('Слишком сложный объект.')
    if isinstance(value, dict):
        if len(value) > 150:
            raise ValidationError('Слишком много свойств объекта.')
        if 'type' in value and isinstance(value['type'], str) and value['type'] in OBJECT_TYPES:
            validate_shape(value)
        for key, item in value.items():
            if key in {'__proto__', 'constructor', 'prototype'}:
                raise ValidationError('Недопустимое свойство объекта.')
            if key == 'type' and (not isinstance(item, str) or item not in OBJECT_TYPES):
                raise ValidationError('Неподдерживаемый тип объекта.')
            if key == 'src' and (not isinstance(item, str) or not IMAGE_SOURCE.fullmatch(item)):
                raise ValidationError('Поддерживаются только встроенные PNG, JPEG, WebP и GIF.')
            validate_tree(item, depth + 1)
    elif isinstance(value, list):
        if len(value) > 100000:
            raise ValidationError('Слишком большой объект.')
        for item in value:
            validate_tree(item, depth + 1)
    elif isinstance(value, (int, float)):
        if abs(value) > 10_000_000 or not math.isfinite(value):
            raise ValidationError('Некорректные координаты объекта.')
    elif not isinstance(value, (str, bool, type(None))):
        raise ValidationError('Некорректное значение объекта.')


def validate_objects(objects):
    if not isinstance(objects, list) or len(objects) > MAX_OBJECTS:
        raise ValidationError(f'На доске может быть не более {MAX_OBJECTS} объектов.')
    seen = set()
    for obj in objects:
        if not isinstance(obj, dict) or not isinstance(obj.get('type'), str) or obj['type'] not in OBJECT_TYPES:
            raise ValidationError('Неподдерживаемый объект доски.')
        object_id = obj.get('id')
        if not isinstance(object_id, str) or not 1 <= len(object_id) <= 80 or object_id in seen:
            raise ValidationError('Идентификаторы объектов должны быть уникальными.')
        seen.add(object_id)
        validate_tree(obj)
    if len(json.dumps(objects, ensure_ascii=False).encode('utf-8')) > MAX_DOCUMENT_BYTES:
        raise ValidationError('Доска превышает ограничение в 20 МБ.')
    return objects


def validate_title(title):
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 100:
        raise ValidationError('Название должно содержать от 1 до 100 символов.')
    return title.strip()


def validate_mutation(data):
    if not isinstance(data, dict):
        raise ValidationError('Ожидается JSON-объект.')
    for key in ('mutationId', 'clientId'):
        if not isinstance(data.get(key), str) or not 1 <= len(data[key]) <= 80:
            raise ValidationError('Некорректный идентификатор изменения.')
    upsert = validate_objects(data.get('upsert', []))
    remove = data.get('remove', [])
    if (not isinstance(remove, list) or len(remove) > MAX_OBJECTS
            or any(not isinstance(item, str) or not 1 <= len(item) <= 80 for item in remove)):
        raise ValidationError('Некорректный список удаляемых объектов.')
    if {obj['id'] for obj in upsert}.intersection(remove):
        raise ValidationError('Объект нельзя одновременно изменить и удалить.')
    result = {'mutationId': data['mutationId'], 'clientId': data['clientId'],
              'upsert': upsert, 'remove': remove}
    if 'title' in data:
        result['title'] = validate_title(data['title'])
    return result

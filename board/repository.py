"""Transactional SQLite persistence; mutations merge by object, not whole canvas."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .validation import validate_objects


class BoardRepository:
    def __init__(self, database):
        self.database = str(database)
        Path(self.database).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as connection:
            connection.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS board (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    title TEXT NOT NULL,
                    objects TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS mutations (
                    id TEXT NOT NULL,
                    client_id TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    PRIMARY KEY (id, client_id)
                );
            ''')
            connection.execute(
                'INSERT OR IGNORE INTO board VALUES (1, ?, ?, 0, ?)',
                ('Моя доска', '[]', self.now()),
            )

    @staticmethod
    def now():
        return datetime.now(timezone.utc).isoformat()

    @contextmanager
    def connection(self):
        connection = sqlite3.connect(self.database, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @staticmethod
    def document(row):
        return {'schemaVersion': 1, 'title': row['title'],
                'objects': json.loads(row['objects']), 'revision': row['revision'],
                'updatedAt': row['updated_at']}

    def get(self):
        with self.connection() as connection:
            return self.document(connection.execute('SELECT * FROM board WHERE id=1').fetchone())

    def apply(self, mutation):
        with self.connection() as connection:
            connection.execute('BEGIN IMMEDIATE')
            row = connection.execute('SELECT * FROM board WHERE id=1').fetchone()
            previous = connection.execute(
                'SELECT id FROM mutations WHERE id=? AND client_id=?',
                (mutation['mutationId'], mutation['clientId']),
            ).fetchone()
            if previous:
                return self.document(row)
            objects = {obj['id']: obj for obj in json.loads(row['objects'])}
            for object_id in mutation['remove']:
                objects.pop(object_id, None)
            for obj in mutation['upsert']:
                objects[obj['id']] = obj
            updated = list(objects.values())
            validate_objects(updated)
            revision = row['revision'] + 1
            connection.execute(
                'UPDATE board SET title=?, objects=?, revision=?, updated_at=? WHERE id=1',
                (mutation.get('title', row['title']), json.dumps(updated, ensure_ascii=False),
                 revision, self.now()),
            )
            connection.execute('INSERT INTO mutations VALUES (?, ?, ?)',
                               (mutation['mutationId'], mutation['clientId'], revision))
            return self.document(connection.execute('SELECT * FROM board WHERE id=1').fetchone())

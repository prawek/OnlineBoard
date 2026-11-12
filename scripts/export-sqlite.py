"""Read the legacy SQLite board into a portable JSON file (never modify the source)."""
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit('Usage: python scripts/export-sqlite.py instance/board.sqlite3 board-export.json')
source, target = map(Path, sys.argv[1:])
with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as connection:
    connection.row_factory = sqlite3.Row
    row = connection.execute('SELECT * FROM board WHERE id=1').fetchone()
    data = dict(schemaVersion=1, title=row['title'], objects=json.loads(row['objects']),
                revision=row['revision'], updatedAt=row['updated_at'])
with target.open('x', encoding='utf-8') as output:
    json.dump(data, output, ensure_ascii=False)
print(f'Exported {len(data["objects"])} objects to {target}')

BEGIN;
CREATE TABLE IF NOT EXISTS board (
    id integer PRIMARY KEY CHECK (id = 1),
    title text NOT NULL,
    objects jsonb NOT NULL DEFAULT '[]'::jsonb,
    revision integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mutations (
    id text NOT NULL,
    client_id text NOT NULL,
    sequence integer NOT NULL,
    PRIMARY KEY (id, client_id)
);
INSERT INTO board (id, title) VALUES (1, 'Моя доска') ON CONFLICT DO NOTHING;
COMMIT;

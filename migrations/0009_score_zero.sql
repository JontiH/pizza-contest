-- Scores may now be 0 to 10. SQLite can't change a CHECK in place, so the
-- table is rebuilt.
CREATE TABLE tastings_new (
  user_id INTEGER NOT NULL REFERENCES users (id),
  pizza_id INTEGER NOT NULL REFERENCES pizzas (id),
  position INTEGER NOT NULL,
  skipped INTEGER NOT NULL DEFAULT 0,
  score REAL CHECK (score BETWEEN 0 AND 10),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  scored_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  queued INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, pizza_id)
);
INSERT INTO tastings_new (user_id, pizza_id, position, skipped, score, assigned_at, scored_at, note, queued)
  SELECT user_id, pizza_id, position, skipped, score, assigned_at, scored_at, note, queued FROM tastings;
DROP TABLE tastings;
ALTER TABLE tastings_new RENAME TO tastings;
CREATE INDEX tastings_position ON tastings (position, pizza_id);

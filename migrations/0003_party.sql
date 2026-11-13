-- Replaces the v1 open-voting tables. They never held party data.
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS pizzas;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  checked_in_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX users_name ON users (lower(name));

CREATE TABLE login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Send counters keyed by day ("day:2026-11-28") and by IP per day, so the
-- site stops before Resend's free 100/day and one client can't use them all.
CREATE TABLE email_sends (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO settings (key, value) VALUES ('phase', 'signup'), ('official_method', '');

CREATE TABLE pizzas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('platonic', 'non_platonic')),
  champion INTEGER NOT NULL DEFAULT 0,
  bringer_id INTEGER REFERENCES users (id),
  box INTEGER UNIQUE,
  arrived_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX pizzas_restaurant ON pizzas (lower(restaurant), category);

-- A row is created when a slice is handed out. score stays NULL until the
-- taster scores it; skipped marks "can't get to it" so it's offered later.
CREATE TABLE tastings (
  user_id INTEGER NOT NULL REFERENCES users (id),
  pizza_id INTEGER NOT NULL REFERENCES pizzas (id),
  position INTEGER NOT NULL,
  skipped INTEGER NOT NULL DEFAULT 0,
  score REAL CHECK (score BETWEEN 1 AND 10),
  assigned_at TEXT NOT NULL DEFAULT (datetime('now')),
  scored_at TEXT,
  PRIMARY KEY (user_id, pizza_id)
);
CREATE INDEX tastings_position ON tastings (position, pizza_id);

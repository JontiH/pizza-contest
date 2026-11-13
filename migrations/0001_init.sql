CREATE TABLE pizzas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant TEXT NOT NULL,
  pizza TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT '',
  brought_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  creator_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE votes (
  pizza_id INTEGER NOT NULL REFERENCES pizzas(id) ON DELETE CASCADE,
  voter_id TEXT NOT NULL,
  voter_name TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 10),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (pizza_id, voter_id)
);

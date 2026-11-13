ALTER TABLE pizzas ADD COLUMN lat REAL;
ALTER TABLE pizzas ADD COLUMN lon REAL;
ALTER TABLE pizzas ADD COLUMN address TEXT NOT NULL DEFAULT '';

-- Photon search results by normalised query, so typing the same thing
-- twice doesn't hit OpenStreetMap's free service again.
CREATE TABLE place_cache (
  query TEXT PRIMARY KEY,
  results TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

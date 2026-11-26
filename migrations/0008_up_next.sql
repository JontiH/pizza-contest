-- queued = 1 marks the slice a taster will get after the current one.
ALTER TABLE tastings ADD COLUMN queued INTEGER NOT NULL DEFAULT 0;

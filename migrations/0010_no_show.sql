-- 1 = the host confirmed this guest isn't coming. Independent of their pizza.
ALTER TABLE users ADD COLUMN no_show INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS menu_catalog (
  menu TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT '',
  family TEXT NOT NULL DEFAULT '',
  price REAL,
  popularity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO menu_catalog(menu, category, popularity, updated_at)
SELECT menu, MAX(menu_category), SUM(CASE WHEN qty > 0 THEN qty ELSE 0 END), CURRENT_TIMESTAMP
FROM transactions
WHERE menu <> ''
GROUP BY menu
ON CONFLICT(menu) DO UPDATE SET
  category = excluded.category,
  popularity = excluded.popularity,
  updated_at = CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_menu_catalog_category_popularity
  ON menu_catalog(category, popularity DESC);

INSERT INTO schema_meta (key, value, updated_at)
VALUES ('schema_version', '3', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;

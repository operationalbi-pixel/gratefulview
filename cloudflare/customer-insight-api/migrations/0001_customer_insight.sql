PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_meta (key, value) VALUES ('schema_version', '1')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS members (
  member_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  mobile_digits TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_members_name ON members(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_members_mobile_digits ON members(mobile_digits);

CREATE TABLE IF NOT EXISTS transactions (
  row_id TEXT PRIMARY KEY,
  sales_number TEXT NOT NULL DEFAULT '',
  bill_number TEXT NOT NULL DEFAULT '',
  sales_date TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  member_id TEXT NOT NULL DEFAULT '',
  member_name TEXT NOT NULL DEFAULT '',
  menu_category TEXT NOT NULL DEFAULT '',
  menu_category_detail TEXT NOT NULL DEFAULT '',
  menu TEXT NOT NULL DEFAULT '',
  menu_code TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  waiter TEXT NOT NULL DEFAULT '',
  menu_notes TEXT NOT NULL DEFAULT '',
  source_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transactions_member_date ON transactions(member_id, sales_date DESC, sales_number DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_sales_number ON transactions(sales_number);
CREATE INDEX IF NOT EXISTS idx_transactions_branch_date ON transactions(branch, sales_date DESC);

CREATE TABLE IF NOT EXISTS pax_promotions (
  row_id TEXT PRIMARY KEY,
  sales_number TEXT NOT NULL DEFAULT '',
  bill_number TEXT NOT NULL DEFAULT '',
  promotion TEXT NOT NULL DEFAULT '',
  pax_total INTEGER NOT NULL DEFAULT 0,
  source_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_pax_sales_number ON pax_promotions(sales_number);

CREATE TABLE IF NOT EXISTS customer_summary (
  member_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'MEMBER',
  name TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  mobile_digits TEXT NOT NULL DEFAULT '',
  tier TEXT NOT NULL DEFAULT '',
  last_visit_date TEXT,
  last_sales_number TEXT,
  last_outlet TEXT,
  last_waiter TEXT,
  last_pax TEXT,
  last_promotion TEXT,
  weekday_visits INTEGER NOT NULL DEFAULT 0,
  weekend_visits INTEGER NOT NULL DEFAULT 0,
  total_visits INTEGER NOT NULL DEFAULT 0,
  classified_visits INTEGER NOT NULL DEFAULT 0,
  group_visits INTEGER NOT NULL DEFAULT 0,
  group_ratio REAL NOT NULL DEFAULT 0,
  favorite_menu_json TEXT NOT NULL DEFAULT '[]',
  menu_note TEXT NOT NULL DEFAULT '',
  last_order_json TEXT NOT NULL DEFAULT '[]',
  has_transaction_history INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_hash TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_summary_name ON customer_summary(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_summary_mobile_digits ON customer_summary(mobile_digits);
CREATE INDEX IF NOT EXISTS idx_summary_last_outlet ON customer_summary(last_outlet);

CREATE TABLE IF NOT EXISTS migration_batches (
  idempotency_key TEXT PRIMARY KEY,
  source_table TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_recommendations (
  member_id TEXT PRIMARY KEY,
  input_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_recommendations_expires_at
  ON ai_recommendations(expires_at);

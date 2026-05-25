CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
  user_id    TEXT PRIMARY KEY,
  layout     TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

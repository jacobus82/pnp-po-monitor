-- Migration 0002: goods-receipt lines + distinguish upload kind.

-- Tag uploads as 'po' (SAP PO export) or 'gr' (goods receipt). Existing rows
-- default to 'po'. SQLite ADD COLUMN is safe/idempotent-ish; re-running errors
-- only with "duplicate column", which the migrate script tolerates.
ALTER TABLE uploads ADD COLUMN kind TEXT NOT NULL DEFAULT 'po';

-- ---------------------------------------------------------------------------
-- gr_lines: one row per goods-receipt line. cost_zar / sell_zar are rand
-- amounts (REAL) per the source export; margin_pct is a 0-100 percentage.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gr_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id    INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  po_number    TEXT,
  article_code TEXT,
  article_desc TEXT,
  dept_code    TEXT,
  dept_name    TEXT,
  qty          REAL,
  cost_zar     REAL,
  sell_zar     REAL,
  margin_pct   REAL,
  gr_date      TEXT,                          -- ISO YYYY-MM-DD
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_gr_lines_upload  ON gr_lines(upload_id);
CREATE INDEX IF NOT EXISTS idx_gr_lines_po       ON gr_lines(po_number);
CREATE INDEX IF NOT EXISTS idx_gr_lines_article  ON gr_lines(article_code);
CREATE INDEX IF NOT EXISTS idx_gr_lines_dept     ON gr_lines(dept_code);
CREATE INDEX IF NOT EXISTS idx_gr_lines_date     ON gr_lines(gr_date);

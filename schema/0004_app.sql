-- Migration 0004: richer PO-line columns (from the SAP "Dynamic List Display"
-- export) + application tables for settings and weekly creditor statements.

-- Merchandise category (e.g. F55010101), storage location (S001 normal / S002
-- returns), and open-to-invoice value. ADD COLUMN is not idempotent — re-running
-- errors with "duplicate column", which is safe to ignore.
ALTER TABLE po_lines ADD COLUMN mdse_cat TEXT;
ALTER TABLE po_lines ADD COLUMN sloc TEXT;
ALTER TABLE po_lines ADD COLUMN open_invoice_cents INTEGER;
CREATE INDEX IF NOT EXISTS idx_po_lines_mdse_cat ON po_lines(mdse_cat);
CREATE INDEX IF NOT EXISTS idx_po_lines_sloc     ON po_lines(sloc);
CREATE INDEX IF NOT EXISTS idx_po_lines_order_date ON po_lines(order_date);

-- Key/value application settings (budget assumptions, thresholds, terms …).
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- Seed default settings (idempotent).
INSERT OR IGNORE INTO app_settings (key, value) VALUES
  ('monthly_turnover_target', '8000000'),
  ('target_gp_pct',           '20'),
  ('weekly_cap',              '2000000'),
  ('price_alert_threshold_pct', '5'),
  ('fy_start_month',          '3'),
  ('vencor_terms_days',       '14'),
  ('pnp_terms_days',          '28'),
  ('fresh_b_depts',           'F04,F06,F07,F09,F10,F64,F68,F77'),
  ('fresh_b_stocktake_day',   'Sunday'),
  ('fresh_b_fim_upload_day',  'Tuesday');

-- Weekly creditor statements (cash & creditors page). One row per Mon–Sun week.
CREATE TABLE IF NOT EXISTS creditor_statements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start      TEXT NOT NULL,          -- ISO Monday
  week_end        TEXT NOT NULL,          -- ISO Sunday
  opening_cents   INTEGER NOT NULL DEFAULT 0,
  purchases_cents INTEGER NOT NULL DEFAULT 0,
  credits_cents   INTEGER NOT NULL DEFAULT 0,
  closing_cents   INTEGER NOT NULL DEFAULT 0,
  due_date        TEXT,                   -- payment due date (ISO)
  note            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (week_start)
);

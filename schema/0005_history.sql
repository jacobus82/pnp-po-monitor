-- Migration 0005: historical FIM support (daily / weekly / monthly date ranges),
-- upload-level report-date tracking, and soft-delete support.
--
-- NOTE: numbered 0005 (not 0004) because 0004_app.sql already exists.

-- ---------------------------------------------------------------------------
-- Rebuild fim_daily: add report_type / date_from / date_to and move uniqueness
-- from (report_date, dept_code) to (date_from, date_to, dept_code) so a daily
-- row and a weekly/monthly row covering overlapping dates can coexist. SQLite
-- can't drop a table-level UNIQUE in place, so we rebuild the table.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS fim_daily_new;
CREATE TABLE fim_daily_new (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date           TEXT    NOT NULL,            -- representative date (= date_from)
  report_type           TEXT    NOT NULL DEFAULT 'daily',  -- daily | weekly | monthly
  date_from             TEXT    NOT NULL,
  date_to               TEXT    NOT NULL,
  fiscal_year           INTEGER NOT NULL,
  fiscal_quarter        INTEGER NOT NULL,
  fiscal_week           INTEGER NOT NULL,
  fiscal_week_start     TEXT    NOT NULL,
  fiscal_week_end       TEXT    NOT NULL,
  day_of_week           INTEGER NOT NULL,
  dept_code             TEXT    NOT NULL,
  dept_name             TEXT,
  net_sales_zar         REAL,
  total_cos_zar         REAL,
  pos_profit_zar        REAL,
  pos_margin_pct        REAL,
  operating_margin_pct  REAL,
  shrink_zar            REAL,
  waste_zar             REAL,
  store_margin_pct      REAL,
  total_purchases_zar   REAL,
  net_gr_cost_zar       REAL,
  upload_id             INTEGER REFERENCES uploads(id) ON DELETE CASCADE,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (date_from, date_to, dept_code)
);

INSERT INTO fim_daily_new
  (id, report_date, report_type, date_from, date_to, fiscal_year, fiscal_quarter,
   fiscal_week, fiscal_week_start, fiscal_week_end, day_of_week, dept_code, dept_name,
   net_sales_zar, total_cos_zar, pos_profit_zar, pos_margin_pct, operating_margin_pct,
   shrink_zar, waste_zar, store_margin_pct, total_purchases_zar, net_gr_cost_zar, upload_id, created_at)
SELECT id, report_date, 'daily', report_date, report_date, fiscal_year, fiscal_quarter,
   fiscal_week, fiscal_week_start, fiscal_week_end, day_of_week, dept_code, dept_name,
   net_sales_zar, total_cos_zar, pos_profit_zar, pos_margin_pct, operating_margin_pct,
   shrink_zar, waste_zar, store_margin_pct, total_purchases_zar, net_gr_cost_zar, upload_id, created_at
FROM fim_daily;

DROP TABLE fim_daily;
ALTER TABLE fim_daily_new RENAME TO fim_daily;

CREATE INDEX IF NOT EXISTS idx_fim_daily_date   ON fim_daily(report_date);
CREATE INDEX IF NOT EXISTS idx_fim_daily_dept   ON fim_daily(dept_code);
CREATE INDEX IF NOT EXISTS idx_fim_daily_range  ON fim_daily(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_fim_daily_fyweek ON fim_daily(fiscal_year, fiscal_week);
CREATE INDEX IF NOT EXISTS idx_fim_daily_upload ON fim_daily(upload_id);

-- ---------------------------------------------------------------------------
-- Upload-level report-date tracking. The spec referenced a `gr_uploads` table,
-- but GR uploads live in `uploads` (kind='gr'), so the columns go there and
-- serve every upload kind. Plus soft-delete support.
-- ---------------------------------------------------------------------------
ALTER TABLE uploads ADD COLUMN report_date TEXT;
ALTER TABLE uploads ADD COLUMN report_date_to TEXT;
ALTER TABLE uploads ADD COLUMN deleted_at TEXT;

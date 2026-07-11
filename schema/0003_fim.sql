-- Migration 0003: FIM (Financial Information Management) daily department
-- performance + departmental margin guidelines.
--
-- A FIM export is a per-store, per-day spreadsheet of department-level financial
-- lines (net sales, cost of sales, margins, shrink, waste, purchases). We store
-- one row per (report_date, dept_code), stamped with the PnP fiscal calendar so
-- the data can be rolled up by fiscal week / quarter / year. dept_code='TOTAL'
-- holds the sheet's "Overall Result" line.
--
-- dept_guidelines holds the official PnP margin / contribution / participation
-- targets per department, with effective-dated history so changes are auditable.

-- ---------------------------------------------------------------------------
-- fim_daily: one row per department per FIM report date.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fim_daily (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date           TEXT    NOT NULL,            -- ISO YYYY-MM-DD (from filename)
  fiscal_year           INTEGER NOT NULL,            -- e.g. 2027
  fiscal_quarter        INTEGER NOT NULL,            -- 1-4
  fiscal_week           INTEGER NOT NULL,            -- 1-based within fiscal year
  fiscal_week_start     TEXT    NOT NULL,            -- ISO Monday
  fiscal_week_end       TEXT    NOT NULL,            -- ISO Sunday
  day_of_week           INTEGER NOT NULL,            -- 1=Mon … 7=Sun

  dept_code             TEXT    NOT NULL,            -- short code (F09, G12, …) or 'TOTAL'
  dept_name             TEXT,
  net_sales_zar         REAL,
  total_cos_zar         REAL,                        -- total cost of sales
  pos_profit_zar        REAL,                        -- net_sales - total_cos
  pos_margin_pct        REAL,
  operating_margin_pct  REAL,
  shrink_zar            REAL,
  waste_zar             REAL,
  store_margin_pct      REAL,
  total_purchases_zar   REAL,
  net_gr_cost_zar       REAL,

  upload_id             INTEGER REFERENCES uploads(id) ON DELETE CASCADE,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (report_date, dept_code)
);
CREATE INDEX IF NOT EXISTS idx_fim_daily_date   ON fim_daily(report_date);
CREATE INDEX IF NOT EXISTS idx_fim_daily_dept   ON fim_daily(dept_code);
CREATE INDEX IF NOT EXISTS idx_fim_daily_fyweek ON fim_daily(fiscal_year, fiscal_week);
CREATE INDEX IF NOT EXISTS idx_fim_daily_upload ON fim_daily(upload_id);

-- ---------------------------------------------------------------------------
-- dept_guidelines: official PnP departmental targets, effective-dated.
-- The "current" guideline for a department is the row with the greatest
-- effective_from that is <= the date of interest.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dept_guidelines (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  dept_code                   TEXT    NOT NULL,      -- short code (F09, G12, GM, CLO, MOB …)
  dept_name                   TEXT,
  dept_group                  TEXT,                  -- 'Non-Fresh' | 'Fresh-A' | 'Fresh-B'
  guideline_margin_pct        REAL,
  margin_contribution_pct     REAL,
  participation_guideline_pct REAL,
  effective_from              TEXT    NOT NULL,      -- ISO YYYY-MM-DD
  updated_at                  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (dept_code, effective_from)
);
CREATE INDEX IF NOT EXISTS idx_dept_guidelines_code ON dept_guidelines(dept_code);

-- --- Seed: official PnP guideline data, effective 2026-03-01 (FY2027 open). ---
-- INSERT OR IGNORE keeps the migration idempotent on re-run.
INSERT OR IGNORE INTO dept_guidelines
  (dept_code, dept_name, dept_group, guideline_margin_pct, margin_contribution_pct, participation_guideline_pct, effective_from)
VALUES
  -- Non-Fresh
  ('G12', 'Edible Groceries',     'Non-Fresh', 18.79, 29.93, 32.24, '2026-03-01'),
  ('G13', 'Non Edible Groceries', 'Non-Fresh', 18.13, 10.28, 11.47, '2026-03-01'),
  ('G14', 'Liquor and Tobacco',   'Non-Fresh', 15.64,  9.76, 12.63, '2026-03-01'),
  ('GM',  'General Merchandise',  'Non-Fresh', 27.84,  5.10,  3.71, '2026-03-01'),
  ('CLO', 'Clothing',             'Non-Fresh', 25.23,  1.43,  1.14, '2026-03-01'),
  ('MOB', 'Mobile and Money',     'Non-Fresh',  7.05,  0.00,  0.01, '2026-03-01'),
  -- Fresh-A
  ('F01', 'Fresh Flowers',        'Fresh-A',   31.00,  0.46,  0.30, '2026-03-01'),
  ('F02', 'Fresh Produce',        'Fresh-A',   26.50, 10.77,  8.22, '2026-03-01'),
  ('F03', 'Deli',                 'Fresh-A',   28.00,  0.62,  0.45, '2026-03-01'),
  ('F05', 'Cheese Bar',           'Fresh-A',   18.00,  1.73,  1.94, '2026-03-01'),
  ('F08', 'Poultry',              'Fresh-A',   15.00,  1.19,  1.60, '2026-03-01'),
  ('F53', 'Convenience Meals',    'Fresh-A',   30.00,  0.73,  0.49, '2026-03-01'),
  ('F55', 'Outsourced Bakery',    'Fresh-A',   16.00,  2.40,  3.03, '2026-03-01'),
  ('P11', 'Perishables',          'Fresh-A',   15.40,  4.11,  5.40, '2026-03-01'),
  -- Fresh-B
  ('F04', 'Deli Prepared Foods',  'Fresh-B',   30.00,  3.38,  2.28, '2026-03-01'),
  ('F06', 'Instore Bakery',       'Fresh-B',   45.00,  6.23,  2.80, '2026-03-01'),
  ('F07', 'Fish Shop',            'Fresh-B',   20.00,  0.10,  0.10, '2026-03-01'),
  ('F09', 'Butchery',             'Fresh-B',   22.00, 10.48,  9.62, '2026-03-01'),
  ('F10', 'Restaurants',          'Fresh-B',   50.00,  0.02,  0.01, '2026-03-01'),
  ('F64', 'Kitchen Cafe Express', 'Fresh-B',   25.00,  0.00,  0.00, '2026-03-01'),
  ('F68', 'Sushi',                'Fresh-B',   10.00,  0.06,  0.11, '2026-03-01'),
  ('F77', 'Cold Deli',            'Fresh-B',   35.00,  0.56,  0.32, '2026-03-01');

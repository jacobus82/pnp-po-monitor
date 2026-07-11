-- ---------------------------------------------------------------------------
-- weekly_budgets v2: one row per (fiscal week, budget_type, department).
-- Supersedes the single-row-per-week 0014 shape (which shipped empty, so we
-- drop and recreate). Each row carries sales / PO / GR budgets in Rand.
--
--   budget_type  department   meaning
--   ----------   ----------   -----------------------------------------
--   store        TOTAL        whole store (drives the dashboard tiles)
--   department   F06/F09/F04  Instore Bakery / Butchery / Deli
--   packaging    F06/F09/F04  per-department packaging PO (po only)
--
-- A week with no row falls back to the default weekly cap
-- (app_settings.weekly_cap, Rand). sales/gr budgets are NULL for packaging rows.
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS weekly_budgets;

CREATE TABLE weekly_budgets (
  week_code        TEXT NOT NULL,            -- fiscal_week_code, e.g. '202717'
  week_ending      TEXT NOT NULL,            -- ISO Sunday (fiscal_weeks.week_end)
  budget_type      TEXT NOT NULL,            -- 'store' | 'department' | 'packaging'
  department       TEXT NOT NULL,            -- 'TOTAL' or dept code (F06/F09/F04)
  sales_budget_zar REAL,
  po_budget_zar    REAL,
  gr_budget_zar    REAL,
  notes            TEXT,
  created_at       TEXT DEFAULT (datetime('now')),
  updated_at       TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (week_code, budget_type, department)
);

CREATE INDEX IF NOT EXISTS idx_weekly_budgets_week ON weekly_budgets(week_code);
CREATE INDEX IF NOT EXISTS idx_weekly_budgets_we   ON weekly_budgets(week_ending);

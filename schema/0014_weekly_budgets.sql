-- ---------------------------------------------------------------------------
-- weekly_budgets: per-fiscal-week purchase (PO) and goods-receipt (GR) budgets.
-- One row per fiscal week (week_code = fiscal_weeks.fiscal_week_code). A week
-- WITHOUT a row falls back to the default weekly cap (app_settings.weekly_cap,
-- in Rand). po_budget_zar / gr_budget_zar are stored in Rand (REAL) to match the
-- figures entered in Settings and the gr_lines / fim_daily Rand convention.
-- Keyed UNIQUE by week_code so the Settings editor UPSERTs instead of duplicating.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS weekly_budgets (
  week_code     TEXT PRIMARY KEY,        -- fiscal_week_code, e.g. '202617'
  week_ending   TEXT NOT NULL,           -- ISO Sunday (fiscal_weeks.week_end)
  po_budget_zar REAL NOT NULL,           -- weekly PO purchase budget (Rand)
  gr_budget_zar REAL,                    -- weekly GR budget (Rand); NULL -> default cap
  notes         TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_budgets_week_ending ON weekly_budgets(week_ending);

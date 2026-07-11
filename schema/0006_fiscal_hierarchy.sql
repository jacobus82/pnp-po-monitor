-- Migration 0006: official PnP fiscal calendar (4-4-5) + merchandise hierarchy
-- lookup tables, plus a guideline_group column on dept_guidelines.
-- Seed data lives in 0007_seed_calendar.sql / 0008_seed_hierarchy.sql.

-- Fiscal weeks (Mon–Sun) from the verified FYE2026 5-year 4-4-5 calendar.
CREATE TABLE IF NOT EXISTS fiscal_weeks (
  fiscal_week_code     TEXT PRIMARY KEY,   -- e.g. '202601'
  fiscal_year          INTEGER NOT NULL,   -- e.g. 2026
  week_no              INTEGER NOT NULL,   -- 1..53
  fiscal_period_code   TEXT,               -- 'YYYYP##' e.g. '2026P01'
  fiscal_quarter       TEXT,               -- 'Q1'..'Q4'
  fiscal_quarter_code  TEXT,               -- 'YYYYQ#' e.g. '2026Q1'
  cal_month            TEXT,               -- 'YYYY-MM' of the week end
  week_spans_month     TEXT,               -- 'Y' | 'N'
  statement_due_week   TEXT,               -- fiscal_week_code of the statement-due week
  week_start           TEXT NOT NULL,      -- ISO Monday
  week_end             TEXT NOT NULL,      -- ISO Sunday
  statement_due_date   TEXT,               -- ISO Monday, +28d after week end
  notes                TEXT
);
CREATE INDEX IF NOT EXISTS idx_fiscal_weeks_range ON fiscal_weeks(week_start, week_end);
CREATE INDEX IF NOT EXISTS idx_fiscal_weeks_fy    ON fiscal_weeks(fiscal_year, week_no);

-- Calendar months mapped to fiscal year / fiscal month number (1 = March).
CREATE TABLE IF NOT EXISTS calendar_months (
  month_key        TEXT PRIMARY KEY,   -- 'YYYY-MM'
  month_name       TEXT,
  month_start      TEXT,               -- ISO
  month_end        TEXT,               -- ISO
  fiscal_year      INTEGER,
  fiscal_month_no  INTEGER             -- 1..12 (1 = March)
);

-- Merchandise hierarchy: Category Portfolio (CM) -> SAP department mapping.
CREATE TABLE IF NOT EXISTS merchandise_hierarchy (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  division_no     TEXT,
  major_division  TEXT,
  business_unit   TEXT,
  business_name   TEXT,
  cp_no           TEXT,   -- Category Portfolio No (5-digit, e.g. '30114')
  cp_name         TEXT,
  sap_dept_code   TEXT,   -- e.g. 'G12'
  sap_dept_name   TEXT
);
CREATE INDEX IF NOT EXISTS idx_mh_cp   ON merchandise_hierarchy(cp_no);
CREATE INDEX IF NOT EXISTS idx_mh_dept ON merchandise_hierarchy(sap_dept_code);

-- Guideline grouping (Non-Fresh / Fresh-A / Fresh-B) for the margin guidelines.
ALTER TABLE dept_guidelines ADD COLUMN guideline_group TEXT;

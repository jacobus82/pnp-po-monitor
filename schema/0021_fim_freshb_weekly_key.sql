-- Migration 0021: allow a dedicated Fresh B weekly FIM row to coexist with the
-- general weekly/daily row for the same (date_from, date_to, dept_code).
--
-- The dedicated Tuesday "Fresh B FIM" export is tagged report_type='weekly_freshb'
-- and is the EXCLUSIVE source of Fresh B margin/COS. Its rows share the same range +
-- dept as the general weekly (which carries the WRONG Fresh B cost), so the old
-- UNIQUE(date_from,date_to,dept_code) would make one overwrite the other. Widen the
-- key to include report_type so both persist. SQLite can't alter a constraint, so
-- recreate the table (id + all columns preserved) and rebuild indexes. ~3k rows.

CREATE TABLE fim_daily_new (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  report_date           TEXT    NOT NULL,
  report_type           TEXT    NOT NULL DEFAULT 'daily',  -- daily | weekly | monthly | weekly_freshb
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
  opening_soh_zar REAL, closing_soh_zar REAL, commercial_disc_zar REAL, line_disc_zar REAL, basket_disc_zar REAL,
  trade_invest_zar REAL, sallies_tallies_zar REAL, swell_allowance_zar REAL,
  total_shortages_zar REAL, net_shrinkage_zar REAL, rtc_zar REAL,
  UNIQUE (date_from, date_to, dept_code, report_type)
);

INSERT INTO fim_daily_new SELECT * FROM fim_daily;
DROP TABLE fim_daily;
ALTER TABLE fim_daily_new RENAME TO fim_daily;

CREATE INDEX IF NOT EXISTS idx_fim_daily_date   ON fim_daily(report_date);
CREATE INDEX IF NOT EXISTS idx_fim_daily_dept   ON fim_daily(dept_code);
CREATE INDEX IF NOT EXISTS idx_fim_daily_range  ON fim_daily(date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_fim_daily_fyweek ON fim_daily(fiscal_year, fiscal_week);
CREATE INDEX IF NOT EXISTS idx_fim_daily_upload ON fim_daily(upload_id);

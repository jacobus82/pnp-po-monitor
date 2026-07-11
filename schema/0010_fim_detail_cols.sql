-- Migration 0010: additional FIM detail columns (SOH, funding, shortages) that
-- power the Stock & SOH, Funding & Rebates and Shortage Analysis screens.
-- All amounts are Rands (REAL). ADD COLUMN is not idempotent — re-running errors
-- with "duplicate column", which is safe to ignore.

-- Stock on hand
ALTER TABLE fim_daily ADD COLUMN opening_soh_zar REAL;
ALTER TABLE fim_daily ADD COLUMN closing_soh_zar REAL;

-- Funding & rebates
ALTER TABLE fim_daily ADD COLUMN commercial_disc_zar REAL;
ALTER TABLE fim_daily ADD COLUMN line_disc_zar REAL;
ALTER TABLE fim_daily ADD COLUMN basket_disc_zar REAL;
ALTER TABLE fim_daily ADD COLUMN trade_invest_zar REAL;
ALTER TABLE fim_daily ADD COLUMN sallies_tallies_zar REAL;
ALTER TABLE fim_daily ADD COLUMN swell_allowance_zar REAL;

-- Shortages
ALTER TABLE fim_daily ADD COLUMN total_shortages_zar REAL;
ALTER TABLE fim_daily ADD COLUMN net_shrinkage_zar REAL;
ALTER TABLE fim_daily ADD COLUMN rtc_zar REAL;

-- ---------------------------------------------------------------------------
-- customer_counts: one row per calendar day from the SAP "Customer Count -
-- Equiv Date Range" export. Each row carries TY vs retail-equivalent LY figures
-- for customers, sales, units and basket. Keyed UNIQUE by cal_date so daily
-- re-exports (which overlap historical ranges) UPSERT instead of duplicating;
-- the most recent upload for a given day wins.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_counts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id         INTEGER,
  cal_date          TEXT    NOT NULL UNIQUE,   -- ISO YYYY-MM-DD
  site_code         TEXT,
  customers_ty      INTEGER,
  customers_ly      INTEGER,
  sales_ty_cents    INTEGER,                   -- Sales Value TY (Rand * 100)
  sales_ly_cents    INTEGER,                   -- Sales Value LY (Rand * 100)
  units_ty          REAL,                      -- Sales Units TY
  units_ly          REAL,                      -- Sales Units LY
  basket_ty_cents   INTEGER,                   -- Ave Customer Value TY (Rand * 100)
  units_per_cust_ty REAL,                      -- Ave Customer Units TY
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_customer_counts_date   ON customer_counts(cal_date);
CREATE INDEX IF NOT EXISTS idx_customer_counts_upload ON customer_counts(upload_id);

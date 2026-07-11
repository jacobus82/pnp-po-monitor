-- pnp-po-monitor D1 schema
-- Store: Dolly's Supermarket (Pty) Ltd t/a Pick n Pay Lydenburg, store 2516, site NF16.
--
-- Money is stored in cents (INTEGER) to avoid floating point drift.
-- Dates are stored as ISO-8601 text (YYYY-MM-DD). Timestamps as ISO datetime (UTC).

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- uploads: one row per SAP file ingested. The raw file lives in R2 at r2_key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS uploads (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT    NOT NULL,
  r2_key        TEXT    NOT NULL,
  content_hash  TEXT,                       -- sha-256 of raw bytes, for dedup
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  detected_delimiter TEXT,                  -- 'tab' | 'comma' | 'semicolon' | 'pipe' | 'fixed'
  row_count     INTEGER NOT NULL DEFAULT 0, -- parsed po_line rows
  skipped_rows  INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','parsed','error')),
  error_message TEXT,
  uploaded_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_uploads_hash   ON uploads(content_hash);
CREATE INDEX IF NOT EXISTS idx_uploads_status ON uploads(status);

-- ---------------------------------------------------------------------------
-- vendors: SAP supplier master (deduped by vendor_code).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_code  TEXT    NOT NULL UNIQUE,
  name         TEXT,
  first_seen   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------------------------------------------------------------------------
-- articles: SAP material/article master (deduped by article_code).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  article_code  TEXT    NOT NULL UNIQUE,
  description   TEXT,
  uom           TEXT,
  department    TEXT,
  first_seen    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  -- rolling reference price (cents) used for price-spike detection
  last_net_price_cents INTEGER
);

-- ---------------------------------------------------------------------------
-- po_lines: one row per purchase-order line item from a SAP file.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id       INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  vendor_id       INTEGER REFERENCES vendors(id),
  article_id      INTEGER REFERENCES articles(id),

  po_number       TEXT    NOT NULL,
  po_line_no      TEXT,                       -- SAP item number
  currency        TEXT    NOT NULL DEFAULT 'ZAR',

  order_qty       REAL,
  uom             TEXT,
  net_price_cents INTEGER,                     -- price per unit, cents
  line_value_cents INTEGER,                    -- order_qty * net_price (cents)

  gr_qty          REAL,                        -- goods received quantity
  open_qty        REAL,                        -- still to be delivered
  open_value_cents INTEGER,

  order_date      TEXT,                        -- ISO YYYY-MM-DD
  delivery_date   TEXT,                        -- ISO YYYY-MM-DD
  line_status     TEXT NOT NULL DEFAULT 'open' -- 'open' | 'partial' | 'closed'
                    CHECK (line_status IN ('open','partial','closed')),

  raw_json        TEXT,                        -- original parsed row, for audit
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_po_lines_upload  ON po_lines(upload_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_po       ON po_lines(po_number);
CREATE INDEX IF NOT EXISTS idx_po_lines_vendor   ON po_lines(vendor_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_article  ON po_lines(article_id);
CREATE INDEX IF NOT EXISTS idx_po_lines_status   ON po_lines(line_status);
CREATE INDEX IF NOT EXISTS idx_po_lines_delivery ON po_lines(delivery_date);

-- ---------------------------------------------------------------------------
-- budgets: spend caps by scope/period. status is computed against committed
-- (open) PO value at query time. scope_type/scope_ref let you budget overall,
-- per department, or per vendor.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budgets (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period       TEXT    NOT NULL,              -- e.g. '2026-06' (month) or '2026-W24' (week)
  scope_type   TEXT    NOT NULL DEFAULT 'overall'
                 CHECK (scope_type IN ('overall','department','vendor')),
  scope_ref    TEXT,                          -- department name or vendor_code; NULL for overall
  cap_cents    INTEGER NOT NULL,
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE (period, scope_type, scope_ref)
);

-- ---------------------------------------------------------------------------
-- anomalies: findings raised during ingestion / detection passes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anomalies (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id    INTEGER REFERENCES uploads(id) ON DELETE CASCADE,
  po_line_id   INTEGER REFERENCES po_lines(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,              -- OVER_BUDGET | STALE_OPEN_ORDER | PRICE_SPIKE | ...
  severity     TEXT    NOT NULL DEFAULT 'WARN'
                 CHECK (severity IN ('INFO','WARN','CRITICAL')),
  message      TEXT    NOT NULL,
  detail_json  TEXT,                          -- structured context
  resolved     INTEGER NOT NULL DEFAULT 0,    -- 0/1
  detected_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_anomalies_upload   ON anomalies(upload_id);
CREATE INDEX IF NOT EXISTS idx_anomalies_type     ON anomalies(type);
CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity);
CREATE INDEX IF NOT EXISTS idx_anomalies_resolved ON anomalies(resolved);

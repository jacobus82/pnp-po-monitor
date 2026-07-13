-- Migration 0019: EOD movement report ingestion + settlement reconciliation.
--
-- Brief 5 — the money-recovery module. eod_movements holds one row per movement
-- line from the weekly SAP End-of-Day Movements Report (.txt tab-delimited latin-1
-- or older .htm ALV table). settlement_ledger is the persisted open-items ledger:
-- EOD goods-receipts aggregated per LIV DocNo, reconciled against statement_lines
-- (GR ↔ statement), re-evaluated on every EOD/statement upload — never recomputed
-- in the request path. All money REAL Rand (matches gr_lines / statement_lines).

CREATE TABLE IF NOT EXISTS eod_movements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id      INTEGER NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  movement_type  TEXT,                         -- "Goods Receipt / AOD" | "Goods Return Note" | "Rev. Goods Return" | "DC Claim"
  mvmt_code      TEXT,                          -- SAP movement type code (Movmt Type)
  mvmt_date      TEXT,                          -- ISO YYYY-MM-DD (source DD.MM.YYYY)
  doc_no         TEXT,                          -- DocumentNo (material doc)
  po_number      TEXT,                          -- Pur. Doc.
  supplier_no    TEXT,
  supplier_name  TEXT,
  reference      TEXT,
  gr_reference   TEXT,
  gr_val_ex      REAL,                          -- GR Val(Ex)
  gr_vat         REAL,                          -- GR Vat
  gr_val_in      REAL,                          -- GR Val(In) — the received value incl VAT
  currency       TEXT,
  inv_status     TEXT,                          -- C = invoiced, N/blank = not
  gr_liv_var     REAL,                          -- GR-LIV variance as SAP reports it
  liv_doc        TEXT,                          -- LIV DocNo (the invoice/settlement doc — the match key)
  liv_date       TEXT,                          -- ISO
  liv_value      REAL,                          -- LIV Value (what SAP settled)
  dcrc_type      TEXT,                          -- DCRC Type (return credits / claims)
  claim_value    REAL,                          -- Value column (DC-claim monetary value)
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_eod_liv     ON eod_movements(liv_doc);
CREATE INDEX IF NOT EXISTS idx_eod_po      ON eod_movements(po_number);
CREATE INDEX IF NOT EXISTS idx_eod_date    ON eod_movements(mvmt_date);
CREATE INDEX IF NOT EXISTS idx_eod_upload  ON eod_movements(upload_id);
CREATE INDEX IF NOT EXISTS idx_eod_type    ON eod_movements(movement_type);

-- Open-items ledger: one row per reconciliation item, keyed by (match_key, side).
--   side='eod'       — a LIV DocNo aggregated from EOD GR rows (received)
--   side='statement' — a 5149-series statement line with no EOD match (billed-only)
-- status: OPEN (received, not yet billed) → MATCHED (billed within tolerance) or
--         AGED (received, unbilled > age threshold) ; BILLED_ONLY (billed, not received).
CREATE TABLE IF NOT EXISTS settlement_ledger (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  match_key        TEXT NOT NULL,               -- liv_doc | statement doc_number
  side             TEXT NOT NULL,               -- 'eod' | 'statement'
  week_code        TEXT,                        -- fiscal week of the GR / statement
  po_number        TEXT,
  supplier_no      TEXT,
  supplier_name    TEXT,
  eod_gr_total     REAL,                        -- Σ GR Val(In) across this LIV's GR rows (aggregated)
  eod_liv_value    REAL,                        -- LIV Value SAP recorded for the invoice
  gr_count         INTEGER,                     -- number of EOD GR rows behind this LIV
  gr_date          TEXT,                        -- latest GR date (for aging)
  statement_no     TEXT,
  statement_amount REAL,                        -- billed amount from the matched statement line
  variance_zar     REAL,                        -- signed: eod_gr_total − billed (or − liv_value)
  status           TEXT NOT NULL,               -- OPEN | MATCHED | AGED | BILLED_ONLY
  is_direct        INTEGER NOT NULL DEFAULT 1,  -- 1 direct vendor (R5 tol) / 0 DC/MA15 (R2000 tol)
  aging_days       INTEGER,                     -- days unbilled (received-not-billed)
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(match_key, side)
);
CREATE INDEX IF NOT EXISTS idx_sl_week   ON settlement_ledger(week_code);
CREATE INDEX IF NOT EXISTS idx_sl_status ON settlement_ledger(status);
CREATE INDEX IF NOT EXISTS idx_sl_po     ON settlement_ledger(po_number);

-- Return-credit tracking: each Goods Return Note should yield a statement DCRC
-- credit. One row per return movement, matched to a statement DCRC reference.
CREATE TABLE IF NOT EXISTS return_credits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  return_doc      TEXT NOT NULL,                -- EOD return DocumentNo
  reference       TEXT,                         -- return reference (matched to statement DCRC)
  po_number       TEXT,
  supplier_no     TEXT,
  supplier_name   TEXT,
  return_date     TEXT,                         -- ISO
  return_value    REAL,                         -- GR Val(In) of the return (negative movement)
  week_code       TEXT,
  credit_stmt_no  TEXT,                         -- statement carrying the DCRC credit, when found
  credit_amount   REAL,
  status          TEXT NOT NULL,                -- CREDITED | AWAITING | AGED (>14d, no credit)
  aging_days      INTEGER,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  UNIQUE(return_doc)
);
CREATE INDEX IF NOT EXISTS idx_rc_week   ON return_credits(week_code);
CREATE INDEX IF NOT EXISTS idx_rc_status ON return_credits(status);

-- Migration 0017: creditor account-statement detail (settlement module).
--
-- Case A of CLAUDE_CODE_TASK_statement_pdf_ingest.md: the settlement design's
-- `statements` / `statement_lines` tables were never deployed (only the weekly
-- manual `creditor_statements` summary table existed). Create them fresh with
-- source lineage (NATIVE pipe-CSV vs PDF-converted) built in.
--
-- NOT related to creditor_statements (0004) — that is the weekly opening/
-- purchases/credits/closing summary for the cash-flow page. These tables hold
-- the line-level detail of a single printed PnP account statement.

CREATE TABLE IF NOT EXISTS statements (
  statement_no    TEXT PRIMARY KEY,
  account         TEXT NOT NULL,
  statement_date  TEXT,
  period_start    TEXT NOT NULL,
  cut_off         TEXT NOT NULL,
  due_date        TEXT NOT NULL,
  total_due       REAL NOT NULL,
  payment         REAL NOT NULL DEFAULT 0,
  opening_balance REAL,
  closing_balance REAL,
  source          TEXT NOT NULL DEFAULT 'NATIVE',
  loaded_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS statement_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  statement_no  TEXT NOT NULL REFERENCES statements(statement_no),
  doc_number    TEXT NOT NULL,
  internal_no   TEXT,
  reference     TEXT,
  doc_date      TEXT,
  amount        REAL NOT NULL,
  liv_doc       TEXT,
  line_type     TEXT,
  vendor_text   TEXT,
  delivery_ref  TEXT,
  vendor_no     TEXT,
  vendor_name   TEXT,
  source        TEXT NOT NULL DEFAULT 'NATIVE'
);
CREATE INDEX IF NOT EXISTS idx_sl_stmt   ON statement_lines(statement_no);
CREATE INDEX IF NOT EXISTS idx_sl_doc    ON statement_lines(doc_number);
CREATE INDEX IF NOT EXISTS idx_sl_liv    ON statement_lines(liv_doc);
CREATE INDEX IF NOT EXISTS idx_sl_vendor ON statement_lines(vendor_no);

-- Chain view: does each statement's opening tie to the prior week's closing?
-- Only meaningful where both sides carry printed balances (PDF loads) or where
-- closing has been derived and persisted for native loads.
CREATE VIEW IF NOT EXISTS v_statement_chain AS
SELECT
  s.statement_no,
  s.cut_off,
  s.source,
  s.opening_balance,
  s.closing_balance,
  p.statement_no  AS prev_statement_no,
  p.closing_balance AS prev_closing,
  CASE
    WHEN s.opening_balance IS NULL OR p.closing_balance IS NULL THEN 'UNKNOWN'
    WHEN ABS(s.opening_balance - p.closing_balance) < 0.005    THEN 'OK'
    ELSE 'BREAK'
  END AS chain_status,
  ROUND(COALESCE(s.opening_balance,0) - COALESCE(p.closing_balance,0), 2) AS chain_gap
FROM statements s
LEFT JOIN statements p
  ON p.cut_off = date(s.cut_off, '-7 days');

-- Migration 0011: PO <-> GR reconciliation columns on po_lines.
--
-- These are denormalized rollups of gr_lines, matched by po_number + article_code.
-- They are recomputed by recomputeReceipts() (src/db/repo.ts) after every GR or
-- PO upload, and were backfilled once at deploy time.
--
-- NOTE on units: received_value is in RAND (gr_lines.cost_zar is Rand, not cents),
-- whereas po_lines.line_value_cents is in cents. Callers must reconcile units.
ALTER TABLE po_lines ADD COLUMN received_qty      REAL;
ALTER TABLE po_lines ADD COLUMN received_value    REAL;     -- Rand
ALTER TABLE po_lines ADD COLUMN last_gr_date      TEXT;     -- ISO YYYY-MM-DD
ALTER TABLE po_lines ADD COLUMN is_fully_received INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_po_lines_fully_received ON po_lines(is_fully_received);
-- Speeds up the recompute join and the unmatched-GR lookups.
CREATE INDEX IF NOT EXISTS idx_gr_lines_po_article ON gr_lines(po_number, article_code);

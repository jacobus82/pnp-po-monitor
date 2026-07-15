-- Migration 0020: manual "declare stale" closures for open POs.
--
-- Stale PO control (companion to the open_po_max_age_days auto-close): a buyer can
-- manually exclude a PO from every open/committed calculation regardless of age
-- ("Mark stale"). One row per po_number; an active closure is reopened_at IS NULL.
-- Reopen sets reopened_at (row kept for audit); re-closing clears reopened_at and
-- stamps a fresh closed_at. po_lines is NEVER mutated — exclusion is derived via the
-- shared openPoPredicate join, exactly like aging out.

CREATE TABLE IF NOT EXISTS po_manual_closures (
  po_number    TEXT PRIMARY KEY,
  closed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  closed_by    TEXT,                 -- optional actor (nullable)
  note         TEXT,                 -- optional reason (nullable)
  reopened_at  TEXT                  -- NULL = active closure; set = reopened (audit)
);

-- Active-closure lookups (openPoPredicate does `po_number NOT IN (... WHERE reopened_at IS NULL)`).
CREATE INDEX IF NOT EXISTS idx_po_manual_closures_active ON po_manual_closures(reopened_at);

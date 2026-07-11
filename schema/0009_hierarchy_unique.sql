-- Migration 0009: unique key on the merchandise hierarchy so the
-- POST /api/hierarchy/upload endpoint can upsert on (cp_no, sap_dept_code).
CREATE UNIQUE INDEX IF NOT EXISTS idx_mh_unique ON merchandise_hierarchy(cp_no, sap_dept_code);

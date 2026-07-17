-- Migration 0022: materialise each anomaly's business reference date (ref_date).
--
-- The Risk & Anomalies page, the dashboard critical tile and the Brief's Watch
-- counts default to a rolling window (app_settings.anomaly_window_weeks, default
-- 12 fiscal weeks) over the period the anomaly is ABOUT — not detected_at. An
-- anomaly whose ref_date falls before the cutoff and is still unresolved is
-- treated as AGED_OUT (derived at query time from ref_date; nothing is deleted
-- and no status column is written, so changing the setting re-ages instantly).
--
-- ref_date could not be read from one place: the business date lives in a
-- different spot per type (detail_json.reportDate for FIM, detail_json.orderDate
-- for stale lines, a fiscal week code for budget/OTB, po_lines.order_date for
-- line-level findings, uploads.report_date for GR margin). The CASE below mirrors
-- deriveAnomalyDrill() in src/index.ts type-for-type — the two MUST agree, so if
-- a new anomaly type is added, update both.
--
-- Correlated subqueries (not UPDATE..FROM) keep every lookup a primary-key hit,
-- which matters on D1's per-operation CPU ceiling. ~5k anomaly rows.

ALTER TABLE anomalies ADD COLUMN ref_date TEXT;

UPDATE anomalies SET ref_date = CASE type
  -- Price spikes are about the order that carried the new price. The deferred
  -- detector (recomputePriceSpikes) links no PO line, so fall back to the latest
  -- order date for the article it names.
  WHEN 'PRICE_SPIKE' THEN COALESCE(
    (SELECT order_date FROM po_lines WHERE id = anomalies.po_line_id),
    (SELECT MAX(pl.order_date) FROM po_lines pl JOIN articles art ON art.id = pl.article_id
      WHERE art.article_code = json_extract(anomalies.detail_json, '$.articleCode')))
  -- Line-level findings: the recorded order date, else the line's own.
  WHEN 'STALE_OPEN_ORDER' THEN COALESCE(
    json_extract(detail_json, '$.orderDate'),
    (SELECT order_date FROM po_lines WHERE id = anomalies.po_line_id))
  WHEN 'NEGATIVE_VALUE' THEN COALESCE(
    json_extract(detail_json, '$.orderDate'),
    (SELECT order_date FROM po_lines WHERE id = anomalies.po_line_id))
  -- FIM findings are about the report date they were computed from.
  WHEN 'FIM_HIGH_WASTE'              THEN json_extract(detail_json, '$.reportDate')
  WHEN 'FIM_HIGH_SHRINK'             THEN json_extract(detail_json, '$.reportDate')
  WHEN 'FIM_MARGIN_BELOW_GUIDELINE'  THEN json_extract(detail_json, '$.reportDate')
  WHEN 'FIM_PARTICIPATION_DEVIATION' THEN json_extract(detail_json, '$.reportDate')
  -- Week-scoped findings resolve their fiscal week code to that week's end date.
  WHEN 'OVER_BUDGET' THEN
    (SELECT week_end FROM fiscal_weeks WHERE fiscal_week_code = json_extract(anomalies.detail_json, '$.weekCode'))
  WHEN 'OTB_EXCEEDED' THEN
    (SELECT week_end FROM fiscal_weeks WHERE fiscal_week_code = json_extract(anomalies.detail_json, '$.week'))
  -- GR margin findings are about the receipt file's report date.
  WHEN 'NEGATIVE_MARGIN' THEN (SELECT report_date FROM uploads WHERE id = anomalies.upload_id)
  WHEN 'LOW_MARGIN'      THEN (SELECT report_date FROM uploads WHERE id = anomalies.upload_id)
  -- Unknown/legacy types (MISSING_PRICE, MISSING_VENDOR, OVER_DELIVERY,
  -- DUPLICATE_PO_LINE, ...): best available business date, detection day last.
  ELSE COALESCE(
    (SELECT report_date FROM uploads WHERE id = anomalies.upload_id),
    (SELECT order_date FROM po_lines WHERE id = anomalies.po_line_id),
    date(detected_at))
END;

-- The working list is always "unresolved, within window", so lead with resolved.
CREATE INDEX IF NOT EXISTS idx_anomalies_resolved_ref ON anomalies(resolved, ref_date);

-- Rolling window size in fiscal weeks (inclusive of the current week).
INSERT OR IGNORE INTO app_settings (key, value) VALUES ('anomaly_window_weeks', '12');

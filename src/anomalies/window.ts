import type { Env } from "../config";

/**
 * Rolling relevance window for the GLOBAL anomaly surfaces: the Risk & Anomalies
 * page, the dashboard critical-anomalies tile and the Brief's Watch counts. They
 * default to anomalies whose BUSINESS reference date (ref_date — the period the
 * anomaly is about) falls inside the last `anomaly_window_weeks` fiscal weeks.
 *
 * Week-scoped views (Weekly view, Brief week blocks) pass their own from/to and
 * are deliberately unaffected — they already scope to the selected week.
 *
 * Anything older and still unresolved is AGED_OUT. That status is DERIVED here,
 * never stored: no row is deleted or flagged, so changing the setting to 8 weeks
 * re-ages the list on the next query with no backfill job to run.
 */

export const DEFAULT_ANOMALY_WINDOW_WEEKS = 12;

/**
 * SQL for an anomaly's business reference date, mirroring deriveAnomalyDrill()
 * in src/index.ts type-for-type, and the backfill in schema/0022. All three MUST
 * agree — a new anomaly type needs updating in each. Correlated subqueries keep
 * every lookup a primary-key hit (D1 per-operation CPU ceiling).
 */
export const REF_DATE_SQL = `CASE type
  WHEN 'PRICE_SPIKE' THEN COALESCE(
    (SELECT order_date FROM po_lines WHERE id = anomalies.po_line_id),
    (SELECT MAX(pl.order_date) FROM po_lines pl JOIN articles art ON art.id = pl.article_id
      WHERE art.article_code = json_extract(anomalies.detail_json, '$.articleCode')))
  WHEN 'STALE_OPEN_ORDER' THEN COALESCE(
    json_extract(detail_json, '$.orderDate'),
    (SELECT order_date FROM po_lines WHERE id = anomalies.po_line_id))
  WHEN 'NEGATIVE_VALUE' THEN COALESCE(
    json_extract(detail_json, '$.orderDate'),
    (SELECT order_date FROM po_lines WHERE id = anomalies.po_line_id))
  WHEN 'FIM_HIGH_WASTE'              THEN json_extract(detail_json, '$.reportDate')
  WHEN 'FIM_HIGH_SHRINK'             THEN json_extract(detail_json, '$.reportDate')
  WHEN 'FIM_MARGIN_BELOW_GUIDELINE'  THEN json_extract(detail_json, '$.reportDate')
  WHEN 'FIM_PARTICIPATION_DEVIATION' THEN json_extract(detail_json, '$.reportDate')
  WHEN 'OVER_BUDGET' THEN
    (SELECT week_end FROM fiscal_weeks WHERE fiscal_week_code = json_extract(anomalies.detail_json, '$.weekCode'))
  WHEN 'OTB_EXCEEDED' THEN
    (SELECT week_end FROM fiscal_weeks WHERE fiscal_week_code = json_extract(anomalies.detail_json, '$.week'))
  WHEN 'NEGATIVE_MARGIN' THEN (SELECT report_date FROM uploads WHERE id = anomalies.upload_id)
  WHEN 'LOW_MARGIN'      THEN (SELECT report_date FROM uploads WHERE id = anomalies.upload_id)
  ELSE COALESCE(
    (SELECT report_date FROM uploads WHERE id = anomalies.upload_id),
    (SELECT order_date FROM po_lines WHERE id = anomalies.po_line_id),
    date(detected_at))
END`;

/**
 * Stamp ref_date on anomalies inserted since the last pass. Detectors do not set
 * it themselves: the date often lives on a row they don't hold (the PO line, the
 * upload, the fiscal calendar), and one set-based statement here keeps a single
 * definition rather than six drifting copies. Call after any path that inserts
 * anomalies. Only touches ref_date IS NULL rows, so it is cheap and idempotent.
 */
export async function fillAnomalyRefDates(env: Env): Promise<number> {
  const res = await env.DB.prepare(
    `UPDATE anomalies SET ref_date = ${REF_DATE_SQL} WHERE ref_date IS NULL`,
  ).run();
  return res.meta?.changes ?? 0;
}

/** The configured window size, as a SQL scalar (defaults to 12 if unset/garbage). */
const WEEKS_SQL = `MAX(1, CAST(COALESCE((SELECT value FROM app_settings WHERE key = 'anomaly_window_weeks'), '${DEFAULT_ANOMALY_WINDOW_WEEKS}') AS INTEGER))`;

/**
 * The window cutoff as a self-contained scalar subquery — the SQL twin of
 * anomalyWindow() below, for single-query surfaces (dashboard tile, Brief) that
 * would otherwise pay an extra round-trip to resolve the cutoff before binding.
 * /api/dashboard in particular is a latency-tuned two-phase Promise.all.
 */
export const CUTOFF_SQL = `(SELECT COALESCE(
  (SELECT fw.week_start FROM fiscal_weeks fw WHERE fw.week_start <= date('now')
    ORDER BY fw.week_start DESC LIMIT 1 OFFSET (${WEEKS_SQL} - 1)),
  date('now', '-' || (${WEEKS_SQL} * 7) || ' days')))`;

/** Window predicate that resolves the cutoff inline — see CUTOFF_SQL. Fails open on NULL. */
export const inWindowInlineSql = (alias = "a") =>
  `(${alias}.ref_date IS NULL OR ${alias}.ref_date >= ${CUTOFF_SQL})`;

export interface AnomalyWindow {
  weeks: number;
  /** Inclusive lower bound: ref_date >= cutoff is inside the window. */
  cutoff: string;
}

/**
 * Resolve the window to a cutoff date: the start of the fiscal week `weeks - 1`
 * weeks before the current one (so weeks=12 spans the current week plus the 11
 * before it). Falls back to a plain 7-day-per-week subtraction if the fiscal
 * calendar has no row for today.
 */
export async function anomalyWindow(env: Env): Promise<AnomalyWindow> {
  const raw = (
    await env.DB.prepare(`SELECT value FROM app_settings WHERE key = 'anomaly_window_weeks'`).first<{
      value: string;
    }>()
  )?.value;
  const n = Number(raw);
  const weeks = Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_ANOMALY_WINDOW_WEEKS;

  const row = await env.DB.prepare(
    `SELECT week_start FROM fiscal_weeks WHERE week_start <= date('now')
     ORDER BY week_start DESC LIMIT 1 OFFSET ?`,
  )
    .bind(weeks - 1)
    .first<{ week_start: string }>();

  const cutoff =
    row?.week_start ??
    (
      await env.DB.prepare(`SELECT date('now', ?) d`)
        .bind(`-${weeks * 7} days`)
        .first<{ d: string }>()
    )?.d ??
    "1970-01-01";

  return { weeks, cutoff };
}

/**
 * Window predicate for a query aliased `a`. A NULL ref_date FAILS OPEN (treated
 * as inside): a finding whose business date we could not derive must never be
 * silently hidden from the working list — better a stray row than a missed risk.
 */
export const inWindowSql = (alias = "a") => `(${alias}.ref_date IS NULL OR ${alias}.ref_date >= ?)`;

/** Complement of inWindowSql — unresolved and older than the cutoff. */
export const agedOutSql = (alias = "a") => `(${alias}.ref_date IS NOT NULL AND ${alias}.ref_date < ?)`;

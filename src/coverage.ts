/**
 * Data-completeness monitor (Brief 7 §1). Derives, per fiscal week, which source
 * feeds are present so the UI can render a coverage grid + a dashboard staleness
 * strip, and so downstream sections can declare when they run on incomplete data.
 *
 * Feeds: PO export (po_lines), GR/BI (gr_lines), EOD (eod_movements), FIM (daily
 * day-count + weekly-for-Fresh-B), statement (statements), customer count
 * (customer_counts), Fan Score (fan_score_weeks). Status per feed:
 *   green  = present/complete   amber = partial   red = missing.
 */
import { type Env } from "./config";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const FEEDS = [
  { key: "po", label: "PO export", kind: "daily" },
  { key: "gr", label: "GR (BI)", kind: "daily" },
  { key: "eod", label: "EOD movements", kind: "daily" },
  { key: "fim", label: "FIM", kind: "fim" },
  { key: "freshbw", label: "Fresh B weekly FIM", kind: "freshbw" },
  { key: "statement", label: "Statement", kind: "binary" },
  { key: "cc", label: "Customer count", kind: "daily" },
  { key: "fanScore", label: "Fan Score", kind: "binary" },
] as const;

interface WeekRow {
  wk: string; ws: string; we: string;
  po: number; gr: number; eod: number; fimd: number; fimw: number; fbw: number; stmt: number; cc: number; fs: number;
}

// A daily feed is green at ≥6 of 7 days, amber at 1–5, red at 0.
function dailyStatus(days: number): { status: string; detail: string } {
  if (days >= 6) return { status: "green", detail: days + "/7 days" };
  if (days >= 1) return { status: "amber", detail: days + "/7 days" };
  return { status: "red", detail: "missing" };
}
function binaryStatus(present: number, label: string): { status: string; detail: string } {
  return present > 0 ? { status: "green", detail: label } : { status: "red", detail: "missing" };
}
// FIM: complete when daily covers the week (≥6 days) OR weekly rows exist (older
// Fresh-B weekly pattern); partial daily is amber; nothing is red.
function fimStatus(fimd: number, fimw: number): { status: string; detail: string } {
  if (fimd >= 6) return { status: "green", detail: fimd + "/7 daily" };
  if (fimw > 0) return { status: "green", detail: "weekly" + (fimd ? " + " + fimd + "d" : "") };
  if (fimd >= 1) return { status: "amber", detail: fimd + "/7 daily" };
  return { status: "red", detail: "missing" };
}
// Fresh B weekly FIM: the dedicated post-stocktake export, expected each Tuesday for
// the prior Mon–Sun week (weekEnd = Sunday). Green once loaded; before it's due
// (through Tuesday, ≤2 days after week end) it is "awaited"; amber on Wednesday,
// red from Thursday on if still missing.
function freshbwStatus(present: number, weekEnd: string, today: string): { status: string; detail: string } {
  if (present > 0) return { status: "green", detail: "loaded" };
  const days = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(weekEnd + "T00:00:00Z")) / 86_400_000);
  if (days < 3) return { status: "grey", detail: "due Tue" };
  if (days === 3) return { status: "amber", detail: "overdue (Wed)" };
  return { status: "red", detail: "missing" };
}

/**
 * Feed status for a SINGLE fiscal week (reused by the Weekly Operating Brief to
 * mark sections built on incomplete data). Returns per-feed {status, detail}.
 */
export async function weekCoverage(
  env: Env, weekCode: string, weekStart: string, weekEnd: string,
): Promise<Record<string, { status: string; detail: string }>> {
  const r = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(DISTINCT order_date) FROM po_lines WHERE order_date BETWEEN ?2 AND ?3) po,
       (SELECT COUNT(DISTINCT gr_date) FROM gr_lines WHERE gr_date BETWEEN ?2 AND ?3) gr,
       (SELECT COUNT(DISTINCT mvmt_date) FROM eod_movements WHERE mvmt_date BETWEEN ?2 AND ?3) eod,
       (SELECT COUNT(DISTINCT date_from) FROM fim_daily WHERE report_type='daily' AND date_from BETWEEN ?2 AND ?3) fimd,
       (SELECT COUNT(*) FROM fim_daily WHERE report_type='weekly' AND date_from<=?3 AND date_to>=?2) fimw,
       (SELECT COUNT(*) FROM fim_daily WHERE report_type='weekly_freshb' AND date_from<=?3 AND date_to>=?2) fbw,
       (SELECT COUNT(*) FROM statements WHERE statement_no=?1) stmt,
       (SELECT COUNT(DISTINCT cal_date) FROM customer_counts WHERE cal_date BETWEEN ?2 AND ?3) cc,
       (SELECT COUNT(*) FROM fan_score_weeks WHERE week_ending BETWEEN ?2 AND ?3) fs,
       date('now') today`,
  ).bind(weekCode, weekStart, weekEnd).first<{ po: number; gr: number; eod: number; fimd: number; fimw: number; fbw: number; stmt: number; cc: number; fs: number; today: string }>();
  const z = r ?? { po: 0, gr: 0, eod: 0, fimd: 0, fimw: 0, fbw: 0, stmt: 0, cc: 0, fs: 0, today: "" };
  return {
    po: dailyStatus(z.po), gr: dailyStatus(z.gr), eod: dailyStatus(z.eod),
    fim: fimStatus(z.fimd, z.fimw), freshbw: freshbwStatus(z.fbw, weekEnd, z.today),
    statement: binaryStatus(z.stmt, weekCode),
    cc: dailyStatus(z.cc), fanScore: binaryStatus(z.fs, "loaded"),
  };
}

/**
 * GET /api/feed-coverage?weeks=N — per-fiscal-week feed presence for the last N
 * weeks up to the current week, plus latest-loaded markers and a staleness summary.
 */
export async function handleFeedCoverage(req: Request, env: Env): Promise<Response> {
  const n = Math.min(Math.max(Number(new URL(req.url).searchParams.get("weeks") ?? "16"), 4), 52);
  const today = (await env.DB.prepare(`SELECT date('now') d`).first<{ d: string }>())?.d ?? "";

  // Per-week presence counts, oldest→newest, ending at the current fiscal week.
  const rowsRes = await env.DB.prepare(
    `SELECT fw.fiscal_week_code wk, fw.week_start ws, fw.week_end we,
      (SELECT COUNT(DISTINCT order_date) FROM po_lines WHERE order_date BETWEEN fw.week_start AND fw.week_end) po,
      (SELECT COUNT(DISTINCT gr_date) FROM gr_lines WHERE gr_date BETWEEN fw.week_start AND fw.week_end) gr,
      (SELECT COUNT(DISTINCT mvmt_date) FROM eod_movements WHERE mvmt_date BETWEEN fw.week_start AND fw.week_end) eod,
      (SELECT COUNT(DISTINCT date_from) FROM fim_daily WHERE report_type='daily' AND date_from BETWEEN fw.week_start AND fw.week_end) fimd,
      (SELECT COUNT(*) FROM fim_daily WHERE report_type='weekly' AND date_from<=fw.week_end AND date_to>=fw.week_start) fimw,
      (SELECT COUNT(*) FROM fim_daily WHERE report_type='weekly_freshb' AND date_from<=fw.week_end AND date_to>=fw.week_start) fbw,
      (SELECT COUNT(*) FROM statements WHERE statement_no=fw.fiscal_week_code) stmt,
      (SELECT COUNT(DISTINCT cal_date) FROM customer_counts WHERE cal_date BETWEEN fw.week_start AND fw.week_end) cc,
      (SELECT COUNT(*) FROM fan_score_weeks WHERE week_ending BETWEEN fw.week_start AND fw.week_end) fs
     FROM fiscal_weeks fw
     WHERE fw.week_start <= date('now') AND fw.week_start >= date('now', ?)
     ORDER BY fw.week_start`,
  ).bind(`-${n * 7} days`).all<WeekRow>();

  const weeks = (rowsRes.results ?? []).map((r) => {
    const cells: Record<string, { status: string; detail: string }> = {
      po: dailyStatus(r.po), gr: dailyStatus(r.gr), eod: dailyStatus(r.eod),
      fim: fimStatus(r.fimd, r.fimw),
      freshbw: freshbwStatus(r.fbw, r.we, today),
      statement: binaryStatus(r.stmt, r.wk),
      cc: dailyStatus(r.cc),
      fanScore: binaryStatus(r.fs, "loaded"),
    };
    // "Complete" excludes the freshbw feed (a going-forward source): a week that
    // predates the Fresh B weekly workflow shouldn't read as incomplete forever. The
    // freshbw column + staleness list still surface when it's actually missing.
    const complete = FEEDS.filter((f) => f.key !== "freshbw").every((f) => cells[f.key]!.status === "green");
    return { code: r.wk, weekStart: r.ws, weekEnd: r.we, cells, complete };
  });

  // Latest-loaded markers (across all data, not just the window).
  const latest = await env.DB.prepare(
    `SELECT (SELECT MAX(order_date) FROM po_lines) po,
            (SELECT MAX(gr_date) FROM gr_lines) gr,
            (SELECT MAX(mvmt_date) FROM eod_movements) eod,
            (SELECT MAX(date_to) FROM fim_daily WHERE report_type IN ('daily','weekly')) fim,
            (SELECT statement_no FROM statements ORDER BY cut_off DESC LIMIT 1) statement,
            (SELECT MAX(cal_date) FROM customer_counts) cc,
            (SELECT week_ending FROM fan_score_weeks ORDER BY week_ending DESC LIMIT 1) fanScore`,
  ).first<Record<string, string | null>>();

  // Staleness summary: for each feed, the most recent weeks (excluding the current,
  // still-filling week) that are not green — the actionable "missing" list.
  const closed = weeks.filter((w) => w.weekEnd < today); // weeks fully in the past
  const missingByFeed: Record<string, string[]> = {};
  for (const f of FEEDS) {
    // "grey" = not yet due (freshbw before its Tuesday) — not actionable-missing.
    missingByFeed[f.key] = closed
      .filter((w) => w.cells[f.key]!.status !== "green" && w.cells[f.key]!.status !== "grey")
      .map((w) => w.code);
  }

  return json({
    today,
    feeds: FEEDS,
    weeks,
    latest,
    missingByFeed,
    currentWeek: weeks.length ? weeks[weeks.length - 1]!.code : null,
  });
}

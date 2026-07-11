import type { Env } from "../config";
import { committedOpenValueCents, type InsertedLine } from "../db/repo";
import { guidelineKeyForDept, type GuidelineRow } from "../guidelines";
import type { Anomaly, ParsedFimRow, ParsedGrLine } from "../types";

// Catch-weight / in-store-production departments (Deli, Bakery, Butchery). On a
// single-day FIM file their margin/waste/shrink findings are downgraded to INFO,
// because cost is recognised across the week, not per day (distortion).
const CATCH_WEIGHT_DEPTS = new Set(["F04", "F06", "F09"]);

// Default Fresh B departments (weekly stocktake) — overridden by the caller from
// app_settings.fresh_b_depts. Their daily margin is only trued-up at stocktake,
// so the FIM_MARGIN_BELOW_GUIDELINE finding is downgraded to INFO until the
// fiscal week is complete (post-stocktake weekly FIM loaded).
const DEFAULT_FRESH_B_DEPTS = new Set(["F04", "F06", "F07", "F09", "F10", "F64", "F68", "F77"]);

/** Today as ISO YYYY-MM-DD (UTC). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + "T00:00:00Z");
  const b = Date.parse(toIso + "T00:00:00Z");
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function fmt(cents: number | undefined, currency = "ZAR"): string {
  if (cents == null) return "n/a";
  return `${currency} ${(cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Per-line anomaly checks that need no cross-row context.
 * Price-spike uses the article's previous reference price captured at insert.
 */
export function detectLineAnomalies(inserted: InsertedLine, env: Env): Anomaly[] {
  const { id, line, previousPriceCents } = inserted;
  const out: Anomaly[] = [];

  // STALE_OPEN_ORDER is NOT raised here: staleness is purely time-based (35–60 days
  // since order_date) and cannot be known when a line is freshly inserted. It is
  // generated over the whole table by recomputeStaleAnomalies() — see
  // POST /api/anomalies/recompute, and the PO/GR upload + reconcile recompute paths.

  // MISSING_PRICE
  if (line.netPriceCents == null) {
    out.push({
      poLineId: id,
      type: "MISSING_PRICE",
      severity: "WARN",
      message: `PO ${line.poNumber}/${line.poLineNo ?? "?"} has no net price.`,
      detail: { articleCode: line.articleCode },
    });
  }

  // MISSING_VENDOR
  if (!line.vendorCode) {
    out.push({
      poLineId: id,
      type: "MISSING_VENDOR",
      severity: "INFO",
      message: `PO ${line.poNumber}/${line.poLineNo ?? "?"} has no vendor.`,
    });
  }

  // NEGATIVE_VALUE — skip S002 (returns storage location): those lines are
  // legitimately negative and would otherwise flood the anomaly list with noise.
  if (
    line.sloc !== "S002" &&
    ((line.lineValueCents != null && line.lineValueCents < 0) || (line.orderQty != null && line.orderQty < 0))
  ) {
    out.push({
      poLineId: id,
      type: "NEGATIVE_VALUE",
      severity: "WARN",
      message: `PO ${line.poNumber}/${line.poLineNo ?? "?"} has a negative quantity or value.`,
      detail: { orderQty: line.orderQty, lineValueCents: line.lineValueCents },
    });
  }

  // OVER_DELIVERY: received more than ordered.
  if (line.grQty != null && line.orderQty != null && line.grQty > line.orderQty * 1.0001) {
    out.push({
      poLineId: id,
      type: "OVER_DELIVERY",
      severity: "WARN",
      message: `PO ${line.poNumber}/${line.poLineNo ?? "?"} received ${line.grQty} vs ordered ${line.orderQty}.`,
      detail: { grQty: line.grQty, orderQty: line.orderQty },
    });
  }

  // PRICE_SPIKE: net price moved >=5% vs the last seen price for this article.
  if (previousPriceCents != null && previousPriceCents > 0 && line.netPriceCents != null) {
    const change = (line.netPriceCents - previousPriceCents) / previousPriceCents;
    if (Math.abs(change) >= 0.05) {
      out.push({
        poLineId: id,
        type: "PRICE_SPIKE",
        severity: Math.abs(change) >= 0.1 ? "CRITICAL" : "WARN",
        message: `Article ${line.articleCode ?? "?"} price ${change >= 0 ? "up" : "down"} ${(change * 100).toFixed(0)}% (${fmt(previousPriceCents, line.currency)} → ${fmt(line.netPriceCents, line.currency)}).`,
        detail: { previousPriceCents, newPriceCents: line.netPriceCents, changePct: change },
      });
    }
  }

  return out;
}

/** Flag duplicate (PO number + line number) pairs within a single upload batch. */
export function detectDuplicateLines(lines: InsertedLine[]): Anomaly[] {
  const seen = new Map<string, number>();
  const out: Anomaly[] = [];
  for (const { id, line } of lines) {
    const key = `${line.poNumber}::${line.poLineNo ?? ""}`;
    if (line.poLineNo == null) continue;
    if (seen.has(key)) {
      out.push({
        poLineId: id,
        type: "DUPLICATE_PO_LINE",
        severity: "WARN",
        message: `Duplicate PO line ${line.poNumber}/${line.poLineNo} appears more than once in this file.`,
        detail: { firstPoLineId: seen.get(key) },
      });
    } else {
      seen.set(key, id);
    }
  }
  return out;
}

/**
 * Goods-receipt margin checks, AGGREGATED BY DEPARTMENT (blended margin from
 * summed cost/sell over the upload). Per-line checks generated tens of thousands
 * of findings per upload (a single grocery dept could produce 6,000+), drowning
 * the anomalies feed — so we raise at most one finding per department:
 *  - NEGATIVE_MARGIN (CRITICAL): dept blended margin < 0.
 *  - LOW_MARGIN (WARN): under the 5% floor, or >10pp below the dept guideline.
 * Catch-weight (F04/F06/F09) and Fresh B departments have receipt-cost recognised
 * before markup on a daily file, so their margin findings are downgraded to INFO.
 */
export function detectGrAnomalies(
  lines: ParsedGrLine[],
  guidelines: Map<string, GuidelineRow>,
  freshBDepts: Set<string> = DEFAULT_FRESH_B_DEPTS,
): Anomaly[] {
  // Blend cost/sell per department (margin from summed numerator/denominator,
  // never an average of per-line percentages).
  const agg = new Map<string, { cost: number; sell: number; lines: number }>();
  for (const l of lines) {
    if (l.costZar == null && l.sellZar == null) continue;
    const key = l.deptCode ?? "?";
    const a = agg.get(key) ?? { cost: 0, sell: 0, lines: 0 };
    a.cost += l.costZar ?? 0;
    a.sell += l.sellZar ?? 0;
    a.lines += 1;
    agg.set(key, a);
  }

  const out: Anomaly[] = [];
  for (const [deptCode, a] of agg) {
    if (a.sell <= 0) continue; // no meaningful margin without positive sell value
    const marginPct = ((a.sell - a.cost) / a.sell) * 100;
    const bare = guidelineKeyForDept(deptCode) ?? deptCode;
    const guideline = guidelines.get(bare)?.guideline_margin_pct ?? null;
    const distorted = CATCH_WEIGHT_DEPTS.has(bare) || freshBDepts.has(bare);
    const note = distorted ? " [catch-weight/Fresh B daily receipt margin distorted — informational]" : "";
    const detail = {
      deptCode,
      blendedMarginPct: Math.round(marginPct * 100) / 100,
      guidelineMargin: guideline,
      lines: a.lines,
      costZar: Math.round(a.cost * 100) / 100,
      sellZar: Math.round(a.sell * 100) / 100,
    };

    if (marginPct < 0) {
      out.push({
        type: "NEGATIVE_MARGIN",
        severity: distorted ? "INFO" : "CRITICAL",
        message: `Loss-making GR: ${deptCode} blended margin ${marginPct.toFixed(2)}% over ${a.lines} lines.${note}`,
        detail,
      });
    } else if (marginPct < 5) {
      out.push({
        type: "LOW_MARGIN",
        severity: distorted ? "INFO" : "WARN",
        message: `Thin GR margin: ${deptCode} at ${marginPct.toFixed(2)}% over ${a.lines} lines (below 5% floor).${note}`,
        detail,
      });
    } else if (guideline != null && marginPct < guideline - 10) {
      out.push({
        type: "LOW_MARGIN",
        severity: distorted ? "INFO" : "WARN",
        message: `${deptCode} GR blended margin ${marginPct.toFixed(2)}%, ${(guideline - marginPct).toFixed(1)}pp below the ${guideline.toFixed(2)}% guideline.${note}`,
        detail,
      });
    }
  }
  return out;
}

/**
 * FIM department-level checks for one report date.
 *  - FIM_MARGIN_BELOW_GUIDELINE: CRITICAL if pos margin < guideline-5pp,
 *    WARN if < guideline-2pp.
 *  - FIM_HIGH_WASTE / FIM_HIGH_SHRINK: waste >2% / shrink >2% of net sales.
 *  - FIM_PARTICIPATION_DEVIATION: sales share differs >3pp from the guideline.
 *
 * F04 (Deli), F06 (Instore Bakery) and F09 (Butchery) carry catch-weight /
 * in-store production distortion on a single day, so their margin/waste/shrink
 * findings are downgraded to INFO unless the whole fiscal week is present
 * (`weeklyCompleteDepts`).
 *
 * Fresh B departments (`freshBDepts`, weekly stocktake) additionally have their
 * FIM_MARGIN_BELOW_GUIDELINE downgraded to INFO while the week is incomplete —
 * daily pre-stocktake margin is unreliable; only post-stocktake weekly FIM is
 * authoritative. Waste/shrink/participation keep their natural severity.
 */
export function detectFimAnomalies(
  rows: ParsedFimRow[],
  total: ParsedFimRow | undefined,
  guidelines: Map<string, GuidelineRow>,
  weeklyCompleteDepts: Set<string>,
  reportDate: string,
  freshBDepts: Set<string> = DEFAULT_FRESH_B_DEPTS,
): Anomaly[] {
  const out: Anomaly[] = [];
  const totalNet = total?.netSalesZar ?? null;

  for (const row of rows) {
    const g = guidelines.get(row.deptCode);
    const weekComplete = weeklyCompleteDepts.has(row.deptCode);
    const isCatchWeight = CATCH_WEIGHT_DEPTS.has(row.deptCode);
    const distorted = isCatchWeight && !weekComplete;
    const note = distorted ? " [F04/F06/F09 single-day catch-weight distortion — informational]" : "";
    const sev = (natural: Anomaly["severity"]): Anomaly["severity"] => (distorted ? "INFO" : natural);
    // Fresh B margin is unreliable until the stocktake week is complete — downgrade
    // FIM_MARGIN_BELOW_GUIDELINE only (waste/shrink/participation use sev() above).
    const freshBMarginInfo = freshBDepts.has(row.deptCode) && !weekComplete;
    const label = `${row.deptCode} ${row.deptName ?? ""}`.trim();
    const base = { deptCode: row.deptCode, deptName: row.deptName ?? null, reportDate };

    // Margin vs guideline.
    if (g?.guideline_margin_pct != null && row.posMarginPct != null) {
      const guide = g.guideline_margin_pct;
      let natural: Anomaly["severity"] | null = null;
      if (row.posMarginPct < guide - 5) natural = "CRITICAL";
      else if (row.posMarginPct < guide - 2) natural = "WARN";
      if (natural) {
        const marginNote = distorted
          ? note
          : freshBMarginInfo
            ? " [Fresh B daily margin pre-stocktake — informational; weekly post-stocktake FIM is authoritative]"
            : "";
        out.push({
          type: "FIM_MARGIN_BELOW_GUIDELINE",
          severity: distorted || freshBMarginInfo ? "INFO" : natural,
          message: `${label} POS margin ${row.posMarginPct.toFixed(2)}% vs ${guide.toFixed(2)}% guideline (${(guide - row.posMarginPct).toFixed(1)}pp short).${marginNote}`,
          detail: { ...base, posMarginPct: row.posMarginPct, guidelineMargin: guide },
        });
      }
    }

    // Waste > 2% of net sales.
    if (row.wasteZar != null && totalNetSalesGuard(row.netSalesZar) && row.wasteZar > row.netSalesZar! * 0.02) {
      out.push({
        type: "FIM_HIGH_WASTE",
        severity: sev("WARN"),
        message: `${label} waste R${fmtZar(row.wasteZar)} is ${pctOf(row.wasteZar, row.netSalesZar!)}% of net sales (>2%).${note}`,
        detail: { ...base, wasteZar: row.wasteZar, netSalesZar: row.netSalesZar },
      });
    }

    // Shrink > 2% of net sales.
    if (row.shrinkZar != null && totalNetSalesGuard(row.netSalesZar) && row.shrinkZar > row.netSalesZar! * 0.02) {
      out.push({
        type: "FIM_HIGH_SHRINK",
        severity: sev("WARN"),
        message: `${label} shrink R${fmtZar(row.shrinkZar)} is ${pctOf(row.shrinkZar, row.netSalesZar!)}% of net sales (>2%).${note}`,
        detail: { ...base, shrinkZar: row.shrinkZar, netSalesZar: row.netSalesZar },
      });
    }

    // Sales participation deviates > 3pp from guideline.
    if (g?.participation_guideline_pct != null && totalNet != null && totalNet > 0 && row.netSalesZar != null) {
      const actual = (row.netSalesZar / totalNet) * 100;
      const dev = actual - g.participation_guideline_pct;
      if (Math.abs(dev) > 3) {
        out.push({
          type: "FIM_PARTICIPATION_DEVIATION",
          severity: sev("WARN"),
          message: `${label} sales share ${actual.toFixed(2)}% vs ${g.participation_guideline_pct.toFixed(2)}% guideline (${dev >= 0 ? "+" : ""}${dev.toFixed(1)}pp).${note}`,
          detail: { ...base, actualParticipationPct: Math.round(actual * 100) / 100, participationGuideline: g.participation_guideline_pct },
        });
      }
    }
  }
  return out;
}

function totalNetSalesGuard(net: number | undefined): boolean {
  return net != null && net > 0;
}

function fmtZar(n: number): string {
  return n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function pctOf(part: number, whole: number): string {
  return ((part / whole) * 100).toFixed(1);
}

export interface BudgetEvaluation {
  budgetId: number;
  period: string;
  scopeType: string;
  scopeRef: string | null;
  capCents: number;
  committedCents: number;
  usedFraction: number;
  status: string;
}

/**
 * Evaluate the CURRENT fiscal week's store PO budget (weekly_budgets, the live
 * budget table — the legacy `budgets` table is empty/retired) against actual net
 * PO to date, and raise a single OVER_BUDGET anomaly if it has breached. The
 * week's PO budget is day-prorated to the elapsed days so a mid-week comparison
 * is fair (matches the dashboard-tiles proration). Any prior unresolved
 * OVER_BUDGET is cleared first so the alert reflects only the latest state.
 */
export async function evaluateBudgets(
  env: Env,
  uploadId: number,
): Promise<{ evaluations: BudgetEvaluation[]; anomalies: Anomaly[] }> {
  const { thresholds, budgetStatus } = await import("../config");
  const t = thresholds(env);
  const evaluations: BudgetEvaluation[] = [];
  const anomalies: Anomaly[] = [];

  // As-of = latest PO order_date we hold (fall back to today).
  const asOf =
    (await env.DB.prepare(`SELECT MAX(order_date) d FROM po_lines`).first<{ d: string | null }>())?.d ??
    new Date().toISOString().slice(0, 10);

  // Fiscal week containing the as-of date, plus its store PO budget (rands).
  const wk = await env.DB.prepare(
    `SELECT fw.fiscal_week_code week_code, fw.week_start, fw.week_end, wb.po_budget_zar
       FROM fiscal_weeks fw
       LEFT JOIN weekly_budgets wb
         ON wb.week_code = fw.fiscal_week_code AND wb.budget_type='store' AND wb.department='TOTAL'
      WHERE fw.week_start <= ? AND fw.week_end >= ?`,
  )
    .bind(asOf, asOf)
    .first<{ week_code: string; week_start: string; week_end: string; po_budget_zar: number | null }>();

  // Always clear prior unresolved OVER_BUDGET so we never accumulate stale ones.
  await env.DB.prepare(`DELETE FROM anomalies WHERE type='OVER_BUDGET' AND resolved=0`).run();

  if (wk && wk.po_budget_zar != null && wk.po_budget_zar > 0) {
    // Actual net PO (S001 + negative S002) committed this week, in cents.
    const act = await env.DB.prepare(
      `SELECT COALESCE(SUM(line_value_cents),0) net FROM po_lines
        WHERE order_date >= ? AND order_date <= ?`,
    )
      .bind(wk.week_start, asOf)
      .first<{ net: number }>();
    const actualCents = Number(act?.net ?? 0);

    // Day-prorate the weekly cap to the elapsed portion of the week (1..7 days).
    const day = 24 * 60 * 60 * 1000;
    const elapsed = Math.min(7, Math.max(1, Math.round((Date.parse(asOf) - Date.parse(wk.week_start)) / day) + 1));
    const capCents = Math.round(wk.po_budget_zar * 100 * (elapsed / 7));
    const used = capCents > 0 ? actualCents / capCents : 0;
    const status = budgetStatus(used, t);

    evaluations.push({
      budgetId: 0,
      period: wk.week_code,
      scopeType: "week-po",
      scopeRef: "TOTAL",
      capCents,
      committedCents: actualCents,
      usedFraction: used,
      status,
    });

    if (status === "OVER" || status === "TIGHT") {
      anomalies.push({
        type: "OVER_BUDGET",
        severity: status === "OVER" ? "CRITICAL" : "WARN",
        message: `Week ${wk.week_code} PO at ${(used * 100).toFixed(0)}% of the day-prorated store PO budget (${status}). Net PO ${fmt(actualCents)} of ${fmt(capCents)} (${elapsed}/7 days).`,
        detail: { weekCode: wk.week_code, actualCents, capCents, elapsedDays: elapsed, status },
      });
    }
  }

  return { evaluations, anomalies };
}

/**
 * Regenerate STALE_OPEN_ORDER anomalies across the whole table. Clears existing
 * stale findings, then raises one WARN per open (is_fully_received=0) PO line whose
 * age since order_date is 35–60 days inclusive. Lines under 35 days are active and
 * lines over 60 days are treated as historical (standing/already-handled) and are
 * deliberately ignored to avoid noise. Returns the number raised.
 */
export async function recomputeStaleAnomalies(env: Env): Promise<number> {
  await env.DB.prepare(`DELETE FROM anomalies WHERE type = 'STALE_OPEN_ORDER'`).run();
  const rows =
    (
      await env.DB.prepare(
        `SELECT p.id, p.po_number, p.po_line_no, p.order_date, p.open_value_cents,
                CAST(julianday('now') - julianday(p.order_date) AS INTEGER) days
         FROM po_lines p
         WHERE p.is_fully_received = 0 AND p.order_date IS NOT NULL
           AND julianday('now') - julianday(p.order_date) >= 35
           AND julianday('now') - julianday(p.order_date) <= 60`,
      ).all<{
        id: number;
        po_number: string;
        po_line_no: number | null;
        order_date: string;
        open_value_cents: number | null;
        days: number;
      }>()
    ).results ?? [];
  if (rows.length === 0) return 0;
  const stmt = env.DB.prepare(
    `INSERT INTO anomalies (upload_id, po_line_id, type, severity, message, detail_json)
     VALUES (NULL, ?, 'STALE_OPEN_ORDER', 'WARN', ?, ?)`,
  );
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    await env.DB.batch(
      chunk.map((r) =>
        stmt.bind(
          r.id,
          `PO ${r.po_number}/${r.po_line_no ?? "?"} open ${r.days} days since order ${r.order_date} (35–60 day stale window).`,
          JSON.stringify({ days: r.days, orderDate: r.order_date, openValueCents: r.open_value_cents }),
        ),
      ),
    );
  }
  return rows.length;
}

// Latest net price per article (most recent order_date; id breaks ties). Shared
// by the detection SELECT and the baseline-advance UPDATE so both agree.
const LATEST_PRICE_SUBQUERY = `
  SELECT article_id, net_price_cents cur
  FROM (
    SELECT article_id, net_price_cents,
           ROW_NUMBER() OVER (PARTITION BY article_id ORDER BY order_date DESC, id DESC) rn
    FROM po_lines
    WHERE article_id IS NOT NULL AND net_price_cents IS NOT NULL AND net_price_cents > 0
  ) WHERE rn = 1`;

/**
 * Deferred price-spike detection for the fast/batch ingest path (which never
 * advances the per-article price baseline, so the per-line PRICE_SPIKE check in
 * detectLineAnomalies is inert there). Compares each article's LATEST net price
 * against its stored baseline (`articles.last_net_price_cents`), raises a
 * PRICE_SPIKE for moves ≥ the `price_alert_threshold_pct` setting (CRITICAL at
 * ≥ 2×), then advances every baseline to the latest so the next run only reacts
 * to NEW moves (idempotent — re-running with no new data raises nothing).
 *
 * Seed-then-detect gate: the very first run (before `price_baseline_seeded` is
 * set) only advances baselines silently — it does NOT fire — so stale baselines
 * left by historical bulk loads don't produce a one-off flood. Existing
 * PRICE_SPIKE rows are left untouched (historical record).
 */
export async function recomputePriceSpikes(env: Env): Promise<{ seeded: boolean; raised: number }> {
  const setting = async (k: string, d: string) =>
    (await env.DB.prepare(`SELECT value FROM app_settings WHERE key = ?`).bind(k).first<{ value: string }>())?.value ?? d;
  const thrPct = Number(await setting("price_alert_threshold_pct", "5"));
  const thr = (Number.isFinite(thrPct) && thrPct > 0 ? thrPct : 5) / 100;
  const seeded = (await setting("price_baseline_seeded", "0")) === "1";

  let raised = 0;
  if (seeded) {
    const rows =
      (
        await env.DB.prepare(
          `WITH latest AS (${LATEST_PRICE_SUBQUERY})
           SELECT a.article_code, a.last_net_price_cents prev, l.cur
           FROM latest l JOIN articles a ON a.id = l.article_id
           WHERE a.last_net_price_cents IS NOT NULL AND a.last_net_price_cents > 0
             AND a.last_net_price_cents <> l.cur`,
        ).all<{ article_code: string; prev: number; cur: number }>()
      ).results ?? [];

    const stmt = env.DB.prepare(
      `INSERT INTO anomalies (upload_id, po_line_id, type, severity, message, detail_json)
       VALUES (NULL, NULL, 'PRICE_SPIKE', ?, ?, ?)`,
    );
    const binds = [];
    for (const r of rows) {
      const change = (r.cur - r.prev) / r.prev;
      if (Math.abs(change) < thr) continue;
      const severity = Math.abs(change) >= thr * 2 ? "CRITICAL" : "WARN";
      binds.push(
        stmt.bind(
          severity,
          `Article ${r.article_code} price ${change >= 0 ? "up" : "down"} ${(change * 100).toFixed(0)}% (${fmt(r.prev)} → ${fmt(r.cur)}).`,
          JSON.stringify({ articleCode: r.article_code, previousPriceCents: r.prev, newPriceCents: r.cur, changePct: change }),
        ),
      );
    }
    for (let i = 0; i < binds.length; i += 200) await env.DB.batch(binds.slice(i, i + 200));
    raised = binds.length;
  }

  // Advance every baseline to the latest price in one set-based statement (only
  // rows that actually changed are written).
  await env.DB.prepare(
    `UPDATE articles SET last_net_price_cents = l.cur
     FROM (${LATEST_PRICE_SUBQUERY}) AS l
     WHERE articles.id = l.article_id AND articles.last_net_price_cents IS NOT l.cur`,
  ).run();

  if (!seeded) {
    await env.DB.prepare(
      `INSERT INTO app_settings (key, value) VALUES ('price_baseline_seeded', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    ).run();
  }
  return { seeded, raised };
}

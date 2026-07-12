import { type Env, thresholds, budgetStatus } from "./config";
import { fiscalCalendar } from "./fiscal";
import { guidelineKeyForDept } from "./guidelines";
import { resolveDeptName } from "./departments";

/**
 * Read-only analytics handlers over po_lines / gr_lines that power the SPA
 * screens. "Purchases" are SLoc S001 movements; SLoc S002 are returns. All
 * money is in cents; the client formats to Rands.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const PURCH = `CASE WHEN COALESCE(p.sloc,'') = 'S002' THEN 0 ELSE COALESCE(p.line_value_cents,0) END`;
// S002 movements are stored as negative values; negate so RET is a positive
// "returns" magnitude and net = SUM(PURCH) - SUM(RET) is correct.
const RET = `CASE WHEN COALESCE(p.sloc,'') = 'S002' THEN -COALESCE(p.line_value_cents,0) ELSE 0 END`;

/**
 * Additive (flow) columns on fim_daily. These accumulate over time, so when a
 * period is covered by a weekly/monthly row they must be day-prorated (value ÷
 * span-in-days). opening_soh_zar / closing_soh_zar (balances) and the *_pct
 * ratios are NOT here — they are never summed, only taken at a boundary or
 * recomputed from summed flows.
 */
const FIM_FLOW_COLS = [
  "net_sales_zar", "total_cos_zar", "pos_profit_zar", "waste_zar", "shrink_zar",
  "total_purchases_zar", "net_gr_cost_zar", "commercial_disc_zar", "line_disc_zar",
  "basket_disc_zar", "trade_invest_zar", "sallies_tallies_zar", "swell_allowance_zar",
  "total_shortages_zar", "net_shrinkage_zar", "rtc_zar",
] as const;

/**
 * Builds a CTE named `fr` that yields ONE row per (calendar day × department)
 * inside an inclusive [from, to] window, resolved to the FINEST report_type
 * covering that day (daily ≻ weekly ≻ monthly — smallest span wins). Flow
 * columns are day-prorated (÷ span) so each real day is counted exactly once,
 * with no double-count when granularities overlap and no undercount when a
 * weekly/monthly row straddles the window boundary. Balance columns
 * (opening/closing SOH) are carried through un-prorated for boundary use.
 *
 * `fim_daily` mixes daily/weekly/monthly rows (see the report_type column), and
 * strict `date_from>=? AND date_to<=?` containment silently dropped straddling
 * rows while summing overlapping ones twice — this replaces that pattern.
 *
 * Requires exactly TWO binds, in order: from, to. Callers prepend `WITH` (or
 * `, ` when they already opened a WITH) and then SELECT ... FROM fr.
 */
function fimResolvedCte(open: "WITH" | ",") {
  const carry = FIM_FLOW_COLS.map((c) => `f.${c} AS ${c}`).join(", ");
  const prorate = FIM_FLOW_COLS.map((c) => `${c} / span AS ${c}`).join(", ");
  return `${open} RECURSIVE _days(d) AS (
      SELECT ? UNION ALL SELECT date(d, '+1 day') FROM _days WHERE d < ?
    ),
    _cover AS (
      SELECT _days.d AS day, f.dept_code, f.dept_name, f.report_type,
             (julianday(f.date_to) - julianday(f.date_from) + 1) AS span,
             ${carry}, f.opening_soh_zar, f.closing_soh_zar,
             ROW_NUMBER() OVER (
               PARTITION BY _days.d, f.dept_code
               ORDER BY (julianday(f.date_to) - julianday(f.date_from)) ASC,
                        CASE f.report_type WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END ASC
             ) AS rn
      FROM _days JOIN fim_daily f
        ON f.dept_code != 'TOTAL' AND f.date_from <= _days.d AND f.date_to >= _days.d
    ),
    fr AS (
      SELECT day, dept_code, dept_name, report_type,
             ${prorate}, opening_soh_zar, closing_soh_zar
      FROM _cover WHERE rn = 1
    )`;
}

/** Apply optional ?from=&to= (order_date) filters, returning SQL + binds. */
function dateRange(req: Request): { sql: string; binds: unknown[] } {
  const q = new URL(req.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.get("from")) {
    where.push("p.order_date >= ?");
    binds.push(q.get("from"));
  }
  if (q.get("to")) {
    where.push("p.order_date <= ?");
    binds.push(q.get("to"));
  }
  return { sql: where.length ? " AND " + where.join(" AND ") : "", binds };
}

/** GET /api/purchases/summary?from=&to=&groupBy=day|week|month */
export async function handlePurchasesSummary(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const groupBy = q.get("groupBy") ?? "week";
  const { sql: rangeSql, binds } = dateRange(req);

  const totals = await env.DB.prepare(
    `SELECT SUM(${PURCH}) purchases, SUM(${RET}) returns,
            SUM(COALESCE(p.open_value_cents,0)) open_deliver,
            SUM(COALESCE(p.open_invoice_cents,0)) open_invoice,
            COUNT(*) lines, COUNT(DISTINCT p.po_number) po_count
     FROM po_lines p WHERE p.order_date IS NOT NULL ${rangeSql}`,
  )
    .bind(...binds)
    .first<Record<string, number>>();

  // Group key by day / ISO-ish week / month (computed client-relevant in JS for week).
  const rows = await env.DB.prepare(
    `SELECT p.order_date d, SUM(${PURCH}) purchases, SUM(${RET}) returns, COUNT(*) lines
     FROM po_lines p WHERE p.order_date IS NOT NULL ${rangeSql}
     GROUP BY p.order_date ORDER BY p.order_date`,
  )
    .bind(...binds)
    .all<{ d: string; purchases: number; returns: number; lines: number }>();

  // For weekly grouping, bucket each date by the OFFICIAL fiscal week from the
  // fiscal_weeks lookup table (calculated calendar as a fallback only).
  let fweeks: { week_start: string; week_end: string; fiscal_week_code: string }[] = [];
  if (groupBy === "week") {
    fweeks = (
      await env.DB.prepare(`SELECT week_start, week_end, fiscal_week_code FROM fiscal_weeks ORDER BY week_start`).all<{
        week_start: string;
        week_end: string;
        fiscal_week_code: string;
      }>()
    ).results ?? [];
  }
  const findWeek = (d: string) => fweeks.find((w) => w.week_start <= d && d <= w.week_end);

  const buckets = new Map<string, { key: string; label: string; purchases: number; returns: number; lines: number; sort: string }>();
  for (const r of rows.results ?? []) {
    let key: string;
    let label: string;
    let sort: string;
    if (groupBy === "day") {
      key = r.d;
      label = r.d;
      sort = r.d;
    } else if (groupBy === "month") {
      key = r.d.slice(0, 7);
      label = r.d.slice(0, 7);
      sort = key;
    } else {
      const w = findWeek(r.d);
      if (w) {
        key = w.fiscal_week_code;
        label = `${w.fiscal_week_code} (${w.week_start}→${w.week_end})`;
        sort = w.week_start;
      } else {
        const fc = fiscalCalendar(r.d);
        key = `${fc.fiscalYear}-W${String(fc.fiscalWeek).padStart(2, "0")}`;
        label = `${fc.fiscalWeekStart}→${fc.fiscalWeekEnd}`;
        sort = fc.fiscalWeekStart;
      }
    }
    const b = buckets.get(key) ?? { key, label, purchases: 0, returns: 0, lines: 0, sort };
    b.purchases += r.purchases;
    b.returns += r.returns;
    b.lines += r.lines;
    buckets.set(key, b);
  }
  const series = [...buckets.values()].sort((a, b) => a.sort.localeCompare(b.sort));

  return json({ groupBy, totals: totals ?? {}, series });
}

/** GET /api/vendors — vendor analysis aggregate. */
export async function handleVendors(req: Request, env: Env): Promise<Response> {
  const { sql: rangeSql, binds } = dateRange(req);
  const rows = await env.DB.prepare(
    `SELECT v.vendor_code code, v.name,
            SUM(${PURCH}) purchases, SUM(${RET}) returns,
            SUM(${PURCH}) - SUM(${RET}) net,
            SUM(COALESCE(p.open_value_cents,0)) open_deliver,
            SUM(COALESCE(p.open_invoice_cents,0)) open_invoice,
            COUNT(DISTINCT p.po_number) po_count, COUNT(*) lines
     FROM po_lines p JOIN vendors v ON v.id = p.vendor_id
     WHERE 1=1 ${rangeSql}
     GROUP BY v.id ORDER BY net DESC`,
  )
    .bind(...binds)
    .all();
  return json({ vendors: rows.results });
}

/** GET /api/vendors/:code — vendor detail (KPIs + POs + articles + returns + lines). */
export async function handleVendorDetail(env: Env, code: string): Promise<Response> {
  const kpis = await env.DB.prepare(
    `SELECT v.vendor_code code, v.name,
            SUM(${PURCH}) purchases, SUM(${RET}) returns,
            SUM(COALESCE(p.open_value_cents,0)) open_deliver,
            SUM(COALESCE(p.open_invoice_cents,0)) open_invoice,
            COUNT(DISTINCT p.po_number) po_count, COUNT(*) lines
     FROM po_lines p JOIN vendors v ON v.id = p.vendor_id
     WHERE v.vendor_code = ? GROUP BY v.id`,
  )
    .bind(code)
    .first();
  if (!kpis) return json({ error: "Vendor not found", code }, 404);

  const pos = await env.DB.prepare(
    `SELECT p.po_number, MIN(p.order_date) order_date, COUNT(*) lines,
            SUM(${PURCH}) value, SUM(COALESCE(p.open_value_cents,0)) open_deliver
     FROM po_lines p JOIN vendors v ON v.id=p.vendor_id WHERE v.vendor_code = ?
     GROUP BY p.po_number ORDER BY order_date DESC LIMIT 200`,
  )
    .bind(code)
    .all();
  const articles = await env.DB.prepare(
    `SELECT a.article_code, a.description, SUM(${PURCH}) value, COUNT(*) lines
     FROM po_lines p JOIN vendors v ON v.id=p.vendor_id JOIN articles a ON a.id=p.article_id
     WHERE v.vendor_code = ? GROUP BY a.id ORDER BY value DESC LIMIT 200`,
  )
    .bind(code)
    .all();
  const returns = await env.DB.prepare(
    `SELECT p.po_number, p.order_date, a.article_code, a.description, -p.line_value_cents value
     FROM po_lines p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN articles a ON a.id=p.article_id
     WHERE v.vendor_code = ? AND p.sloc='S002' ORDER BY p.order_date DESC LIMIT 200`,
  )
    .bind(code)
    .all();
  const lines = await env.DB.prepare(
    `SELECT p.po_number, p.order_date, a.article_code, a.description, p.mdse_cat, p.sloc,
            p.order_qty, p.net_price_cents, p.line_value_cents, p.open_value_cents
     FROM po_lines p JOIN vendors v ON v.id=p.vendor_id LEFT JOIN articles a ON a.id=p.article_id
     WHERE v.vendor_code = ? ORDER BY p.line_value_cents DESC LIMIT 500`,
  )
    .bind(code)
    .all();
  return json({
    kpis,
    pos: pos.results,
    articles: articles.results,
    returns: returns.results,
    lines: lines.results,
  });
}

/** GET /api/articles — article analysis aggregate. */
export async function handleArticles(req: Request, env: Env): Promise<Response> {
  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? "500"), 2000);
  const rows = await env.DB.prepare(
    `SELECT a.article_code code, a.description, a.department dept,
            SUM(${PURCH}) total_value, AVG(p.net_price_cents) avg_price, COUNT(*) order_count
     FROM po_lines p JOIN articles a ON a.id = p.article_id
     GROUP BY a.id ORDER BY total_value DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return json({ articles: rows.results });
}

/** GET /api/articles/:code — article detail (price history + lines). */
export async function handleArticleDetail(env: Env, code: string): Promise<Response> {
  const kpis = await env.DB.prepare(
    `SELECT a.article_code code, a.description, a.department dept,
            SUM(${PURCH}) total_value, AVG(p.net_price_cents) avg_price,
            MIN(p.net_price_cents) min_price, MAX(p.net_price_cents) max_price, COUNT(*) order_count
     FROM po_lines p JOIN articles a ON a.id=p.article_id WHERE a.article_code = ? GROUP BY a.id`,
  )
    .bind(code)
    .first();
  if (!kpis) return json({ error: "Article not found", code }, 404);
  const history = await env.DB.prepare(
    `SELECT p.order_date, p.net_price_cents, v.vendor_code, v.name vendor
     FROM po_lines p JOIN articles a ON a.id=p.article_id LEFT JOIN vendors v ON v.id=p.vendor_id
     WHERE a.article_code = ? AND p.order_date IS NOT NULL AND p.net_price_cents IS NOT NULL
     ORDER BY p.order_date`,
  )
    .bind(code)
    .all();
  const lines = await env.DB.prepare(
    `SELECT p.po_number, p.order_date, v.vendor_code, v.name vendor, p.order_qty,
            p.net_price_cents, p.line_value_cents, p.sloc
     FROM po_lines p JOIN articles a ON a.id=p.article_id LEFT JOIN vendors v ON v.id=p.vendor_id
     WHERE a.article_code = ? ORDER BY p.order_date DESC LIMIT 500`,
  )
    .bind(code)
    .all();
  return json({ kpis, history: history.results, lines: lines.results });
}

/** GET /api/categories — merchandise-category aggregate. */
export async function handleCategories(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT p.mdse_cat code, substr(p.mdse_cat,1,3) dept,
            SUM(${PURCH}) purchases, SUM(COALESCE(p.open_value_cents,0)) open_deliver, COUNT(*) lines
     FROM po_lines p WHERE p.mdse_cat IS NOT NULL AND p.mdse_cat != ''
     GROUP BY p.mdse_cat ORDER BY purchases DESC`,
  ).all();
  return json({ categories: rows.results });
}

/** GET /api/categories/:code — lines for one category. */
export async function handleCategoryDetail(env: Env, code: string): Promise<Response> {
  const lines = await env.DB.prepare(
    `SELECT p.po_number, p.order_date, v.name vendor, a.article_code, a.description,
            p.order_qty, p.net_price_cents, p.line_value_cents
     FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN articles a ON a.id=p.article_id
     WHERE p.mdse_cat = ? ORDER BY p.line_value_cents DESC LIMIT 500`,
  )
    .bind(code)
    .all();
  return json({ code, lines: lines.results });
}

/** GET /api/departments-po — PO purchases by department vs guideline/budget. */
export async function handleDepartmentsPo(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT substr(p.mdse_cat,1,3) dept,
            SUM(${PURCH}) purchases, SUM(${RET}) returns,
            SUM(COALESCE(p.open_value_cents,0)) open_deliver, COUNT(*) lines
     FROM po_lines p WHERE p.mdse_cat IS NOT NULL AND p.mdse_cat != ''
     GROUP BY substr(p.mdse_cat,1,3) ORDER BY purchases DESC`,
  ).all<{ dept: string; purchases: number; returns: number; open_deliver: number; lines: number }>();
  const guides = await env.DB.prepare(
    `SELECT dept_code, dept_name, dept_group, guideline_margin_pct FROM dept_guidelines
     WHERE effective_from = (SELECT MAX(effective_from) FROM dept_guidelines g2 WHERE g2.dept_code = dept_guidelines.dept_code)`,
  ).all<{ dept_code: string; dept_name: string; dept_group: string; guideline_margin_pct: number }>();
  const gmap = new Map((guides.results ?? []).map((g) => [g.dept_code, g]));
  const departments = (rows.results ?? []).map((r) => {
    const g = gmap.get(r.dept);
    return { ...r, dept_name: g?.dept_name ?? null, dept_group: g?.dept_group ?? null, guideline_margin_pct: g?.guideline_margin_pct ?? null };
  });
  return json({ departments });
}

/** Format a quantity for bucket labels (drop trailing .0 on whole numbers). */
function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/**
 * Reconciliation status + aging bucket for one PO line. Aging is measured from
 * the last GR date when any GR exists, else order_date (the SAP PO export has no
 * delivery date). `days` is therefore "days since last GR" for partials and
 * "days since order" for not-yet-received lines.
 */
export function reconcileLine(o: {
  order_qty: number | null;
  received_qty: number | null;
  order_date: string | null;
  days: number | null;
}): { status: "matched" | "unmatched-po"; bucketKey: string; bucket: string } {
  const ordered = o.order_qty ?? 0;
  const received = o.received_qty ?? 0;
  const days = o.days ?? 0;
  if (received <= 0) {
    let key = "no_date";
    let label = "No date";
    if (o.order_date != null) {
      if (days <= 7) { key = "new_order"; label = "New order"; }
      else if (days <= 21) { key = "awaiting"; label = "Awaiting delivery"; }
      else if (days <= 34) { key = "overdue"; label = "Overdue"; }
      else if (days <= 60) { key = "stale"; label = "Stale"; }
      else { key = "historical"; label = "Historical"; }
    }
    return { status: "unmatched-po", bucketKey: key, bucket: label };
  }
  if (ordered > 0 && received < ordered) {
    if (days > 21) return { status: "matched", bucketKey: "stale_partial", bucket: "Stale partial" };
    return {
      status: "matched",
      bucketKey: "partial",
      bucket: `Partial — ${fmtQty(received)} of ${fmtQty(ordered)} received`,
    };
  }
  return { status: "matched", bucketKey: "complete", bucket: "Complete" };
}

const AGING_KEYS = [
  "new_order", "awaiting", "overdue", "stale", "historical", "partial", "stale_partial", "no_date",
] as const;

/** GET /api/open-orders?filter=deliver|invoice|both&limit= */
export async function handleOpenOrders(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const filter = q.get("filter") ?? "both";
  const limit = Math.min(Number(q.get("limit") ?? "1000"), 5000);
  let cond = "(COALESCE(p.open_value_cents,0) > 0 OR COALESCE(p.open_invoice_cents,0) > 0)";
  if (filter === "deliver") cond = "COALESCE(p.open_value_cents,0) > 0";
  else if (filter === "invoice") cond = "COALESCE(p.open_invoice_cents,0) > 0";

  const rows = await env.DB.prepare(
    `SELECT p.id, p.po_number, p.order_date, v.vendor_code, v.name vendor,
            a.article_code, a.description, p.mdse_cat, p.order_qty,
            COALESCE(p.received_qty,0) received_qty, COALESCE(p.received_value,0) received_value,
            p.line_value_cents, p.open_value_cents, p.open_invoice_cents, p.last_gr_date,
            CAST(julianday('now') - julianday(COALESCE(p.last_gr_date, p.order_date)) AS INTEGER) days_outstanding
     FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN articles a ON a.id=p.article_id
     WHERE p.is_fully_received = 0 AND ${cond}
     ORDER BY days_outstanding DESC LIMIT ?`,
  )
    .bind(limit)
    .all<Record<string, number | string | null>>();

  const count: Record<string, number> = {};
  const value: Record<string, number> = {};
  for (const k of AGING_KEYS) { count[k] = 0; value[k] = 0; }

  const out = (rows.results ?? []).map((r) => {
    const orderQty = r.order_qty as number | null;
    const receivedQty = (r.received_qty as number) ?? 0;
    const orderValue = ((r.line_value_cents as number) ?? 0) / 100;
    const receivedValue = (r.received_value as number) ?? 0;
    const days = r.days_outstanding as number | null;
    const rec = reconcileLine({
      order_qty: orderQty, received_qty: receivedQty,
      order_date: r.order_date as string | null, days,
    });
    const outstandingValue = Math.round((orderValue - receivedValue) * 100) / 100;
    const bk = rec.bucketKey;
    count[bk] = (count[bk] ?? 0) + 1;
    value[bk] = (value[bk] ?? 0) + Math.max(outstandingValue, 0);
    return {
      id: r.id, po_number: r.po_number, order_date: r.order_date,
      vendor_code: r.vendor_code, vendor: r.vendor,
      article_code: r.article_code, description: r.description, mdse_cat: r.mdse_cat,
      order_qty: orderQty, received_qty: receivedQty,
      outstanding_qty: orderQty != null ? Math.round((orderQty - receivedQty) * 1000) / 1000 : null,
      order_value: orderValue, received_value: receivedValue, outstanding_value: outstandingValue,
      last_gr_date: r.last_gr_date, days_outstanding: days,
      status: rec.status, bucket: rec.bucket,
    };
  });

  return json({ filter, rows: out, aging: { count, value } });
}

/**
 * GET /api/reconciliation?from=&to=&vendor=&dept=&status=all|matched|unmatched-po|unmatched-gr
 *
 * Reconciles PO lines against goods receipts (matched by po_number + article_code).
 * Returns a summary, a `lines` array driven by the status filter, and a dedicated
 * `unmatchedGr` array (GR received with no matching PO) so the GR-screen tab can
 * render both its tables from a single call.
 *
 * Units: order_value / received_value / outstanding_value are all in RAND.
 */
export async function handleReconciliation(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  const vendor = q.get("vendor");
  const dept = q.get("dept");
  const status = q.get("status") ?? "all";
  const limit = Math.min(Number(q.get("limit") ?? "2000"), 5000);

  // PO-side scope (order_date range, vendor code, SAP dept = first 3 of mdse_cat).
  const where: string[] = [];
  const binds: unknown[] = [];
  if (from) { where.push("p.order_date >= ?"); binds.push(from); }
  if (to) { where.push("p.order_date <= ?"); binds.push(to); }
  if (vendor) { where.push("v.vendor_code = ?"); binds.push(vendor); }
  if (dept) { where.push("substr(p.mdse_cat,1,3) = ?"); binds.push(dept); }
  const scope = where.length ? "WHERE " + where.join(" AND ") : "";

  const sum = await env.DB.prepare(
    `SELECT COUNT(*) total_po_lines,
            SUM(CASE WHEN p.is_fully_received = 1 THEN 1 ELSE 0 END) matched_lines,
            SUM(CASE WHEN p.is_fully_received = 0 THEN 1 ELSE 0 END) unmatched_po_lines,
            COALESCE(SUM(COALESCE(p.line_value_cents,0)),0)/100.0 total_ordered_value,
            COALESCE(SUM(COALESCE(p.received_value,0)),0) total_received_value
     FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id ${scope}`,
  ).bind(...binds).first<Record<string, number>>();

  // GR-side scope (gr_date range only; gr_lines has no vendor and a different dept code).
  // "Unmatched" = the GR line's (po_number, article_code) has no PO line. This is
  // expressed as a set-based anti-join against a materialized set of matched keys,
  // NOT a per-row correlated NOT EXISTS: the correlated form re-ran a
  // po_lines⋈articles lookup for every one of ~1M gr_lines rows and blew past D1's
  // per-request CPU limit (~35s → 500). The CTE materializes the matched keys once
  // and hash-anti-joins, cutting the two GR-side queries from ~35s to ~1s each with
  // identical results.
  const MATCHED_CTE =
    "WITH matched(pn, ac) AS (" +
    "SELECT DISTINCT p.po_number, a.article_code FROM po_lines p JOIN articles a ON a.id = p.article_id)";
  const grFrom = "FROM gr_lines g LEFT JOIN matched m ON m.pn = g.po_number AND m.ac = g.article_code";
  const grWhere = ["m.pn IS NULL"];
  const grBinds: unknown[] = [];
  if (from) { grWhere.push("g.gr_date >= ?"); grBinds.push(from); }
  if (to) { grWhere.push("g.gr_date <= ?"); grBinds.push(to); }
  const grScope = "WHERE " + grWhere.join(" AND ");

  const grCountRow = await env.DB.prepare(
    `${MATCHED_CTE} SELECT COUNT(*) n FROM (SELECT 1 ${grFrom} ${grScope} GROUP BY g.po_number, g.article_code)`,
  ).bind(...grBinds).first<{ n: number }>();

  const totalOrdered = sum?.total_ordered_value ?? 0;
  const totalReceived = sum?.total_received_value ?? 0;
  const summary = {
    total_po_lines: sum?.total_po_lines ?? 0,
    matched_lines: sum?.matched_lines ?? 0,
    unmatched_po_lines: sum?.unmatched_po_lines ?? 0,
    unmatched_gr_lines: grCountRow?.n ?? 0,
    total_ordered_value: Math.round(totalOrdered * 100) / 100,
    total_received_value: Math.round(totalReceived * 100) / 100,
    receipt_rate_pct: totalOrdered > 0 ? Math.round((totalReceived / totalOrdered) * 1000) / 10 : null,
  };

  // PO-based lines per status filter (all => still-outstanding lines).
  let lines: unknown[] = [];
  if (status !== "unmatched-gr") {
    const lw = [...where];
    if (status === "matched") lw.push("p.is_fully_received = 1");
    else if (status === "unmatched-po") lw.push("p.is_fully_received = 0");
    else lw.push("p.is_fully_received = 0");
    const lineScope = lw.length ? "WHERE " + lw.join(" AND ") : "";
    const rows = await env.DB.prepare(
      `SELECT p.po_number, a.article_code, a.description article_desc,
              v.name vendor_name, v.vendor_code, substr(p.mdse_cat,1,3) sap_dept_code,
              p.order_date, p.order_qty, COALESCE(p.line_value_cents,0)/100.0 order_value,
              COALESCE(p.received_qty,0) received_qty, COALESCE(p.received_value,0) received_value,
              p.last_gr_date,
              CAST(julianday('now') - julianday(COALESCE(p.last_gr_date, p.order_date)) AS INTEGER) days_outstanding
       FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN articles a ON a.id=p.article_id
       ${lineScope} ORDER BY days_outstanding DESC LIMIT ?`,
    ).bind(...binds, limit).all<Record<string, number | string | null>>();

    lines = (rows.results ?? []).map((r) => {
      const orderQty = r.order_qty as number | null;
      const receivedQty = (r.received_qty as number) ?? 0;
      const orderValue = (r.order_value as number) ?? 0;
      const receivedValue = (r.received_value as number) ?? 0;
      const rec = reconcileLine({
        order_qty: orderQty, received_qty: receivedQty,
        order_date: r.order_date as string | null, days: r.days_outstanding as number | null,
      });
      return {
        po_number: r.po_number, article_code: r.article_code, article_desc: r.article_desc,
        vendor_name: r.vendor_name, vendor_code: r.vendor_code, sap_dept_code: r.sap_dept_code,
        order_date: r.order_date, order_qty: orderQty, order_value: Math.round(orderValue * 100) / 100,
        received_qty: receivedQty, received_value: Math.round(receivedValue * 100) / 100,
        outstanding_qty: orderQty != null ? Math.round((orderQty - receivedQty) * 1000) / 1000 : null,
        outstanding_value: Math.round((orderValue - receivedValue) * 100) / 100,
        last_gr_date: r.last_gr_date, days_outstanding: r.days_outstanding,
        status: rec.status, aging_bucket: rec.bucket,
      };
    });
  }

  // GR received with no matching PO (always returned for the tab's second table).
  const grRows = await env.DB.prepare(
    `${MATCHED_CTE}
     SELECT g.po_number, g.article_code, g.article_desc, g.dept_code sap_dept_code,
            SUM(COALESCE(g.qty,0)) received_qty, SUM(COALESCE(g.cost_zar,0)) received_value,
            MAX(g.gr_date) last_gr_date, COUNT(*) gr_count,
            CAST(julianday('now') - julianday(MAX(g.gr_date)) AS INTEGER) days_outstanding
     ${grFrom} ${grScope}
     GROUP BY g.po_number, g.article_code
     ORDER BY received_value DESC LIMIT ?`,
  ).bind(...grBinds, limit).all<Record<string, number | string | null>>();

  const unmatchedGr = (grRows.results ?? []).map((r) => ({
    po_number: r.po_number, article_code: r.article_code, article_desc: r.article_desc,
    vendor_name: null, vendor_code: null, sap_dept_code: r.sap_dept_code,
    order_date: null, order_qty: null, order_value: 0,
    received_qty: r.received_qty, received_value: Math.round(((r.received_value as number) ?? 0) * 100) / 100,
    outstanding_qty: null, outstanding_value: null,
    last_gr_date: r.last_gr_date, gr_count: r.gr_count, days_outstanding: r.days_outstanding,
    status: "unmatched-gr", aging_bucket: "Review",
  }));

  return json({ summary, lines: status === "unmatched-gr" ? unmatchedGr : lines, unmatchedGr });
}

/** GET /api/returns?groupBy=vendor|article|category — SLoc S002 movements. */
export async function handleReturns(req: Request, env: Env): Promise<Response> {
  const groupBy = new URL(req.url).searchParams.get("groupBy") ?? "all";
  // S002 values are negative movements; negate to report positive return magnitudes.
  const totals = await env.DB.prepare(
    `SELECT -SUM(COALESCE(line_value_cents,0)) value, COUNT(*) lines, COUNT(DISTINCT po_number) pos
     FROM po_lines WHERE sloc = 'S002'`,
  ).first();

  let rows;
  if (groupBy === "vendor") {
    rows = await env.DB.prepare(
      `SELECT v.vendor_code code, v.name label, -SUM(COALESCE(p.line_value_cents,0)) value, COUNT(*) lines
       FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id WHERE p.sloc='S002'
       GROUP BY v.id ORDER BY value DESC`,
    ).all();
  } else if (groupBy === "article") {
    rows = await env.DB.prepare(
      `SELECT a.article_code code, a.description label, -SUM(COALESCE(p.line_value_cents,0)) value, COUNT(*) lines
       FROM po_lines p LEFT JOIN articles a ON a.id=p.article_id WHERE p.sloc='S002'
       GROUP BY a.id ORDER BY value DESC`,
    ).all();
  } else if (groupBy === "category") {
    rows = await env.DB.prepare(
      `SELECT p.mdse_cat code, p.mdse_cat label, -SUM(COALESCE(p.line_value_cents,0)) value, COUNT(*) lines
       FROM po_lines p WHERE p.sloc='S002' GROUP BY p.mdse_cat ORDER BY value DESC`,
    ).all();
  } else {
    rows = await env.DB.prepare(
      `SELECT p.po_number, p.order_date, v.name vendor, a.article_code, a.description,
              p.order_qty, -p.line_value_cents value
       FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN articles a ON a.id=p.article_id
       WHERE p.sloc='S002' ORDER BY p.order_date DESC LIMIT 1000`,
    ).all();
  }
  return json({ groupBy, totals, rows: rows.results });
}

/** GET /api/gr/reconciliation — match GR lines to PO lines by PO number. */
export async function handleGrReconciliation(env: Env): Promise<Response> {
  const latest = await env.DB.prepare(
    `SELECT id FROM uploads WHERE kind='gr' AND status='parsed' ORDER BY id DESC LIMIT 1`,
  ).first<{ id: number }>();
  if (!latest) return json({ grUpload: null, matched: [], summary: {} });

  const byVendor = await env.DB.prepare(
    `SELECT g.dept_code, g.dept_name,
            COUNT(*) gr_lines, SUM(COALESCE(g.cost_zar,0)) gr_cost,
            (SELECT COUNT(*) FROM po_lines p WHERE p.po_number = g.po_number) AS po_match
     FROM gr_lines g WHERE g.upload_id = ? GROUP BY g.dept_code ORDER BY gr_cost DESC`,
  )
    .bind(latest.id)
    .all();

  const match = await env.DB.prepare(
    `SELECT
        COUNT(*) gr_lines,
        SUM(CASE WHEN EXISTS (SELECT 1 FROM po_lines p WHERE p.po_number=g.po_number) THEN 1 ELSE 0 END) matched,
        SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM po_lines p WHERE p.po_number=g.po_number) THEN 1 ELSE 0 END) unmatched
     FROM gr_lines g WHERE g.upload_id = ?`,
  )
    .bind(latest.id)
    .first();
  return json({ grUploadId: latest.id, summary: match, byDept: byVendor.results });
}

const DAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

/**
 * Fresh-B margin cutoff, derived from the stocktake cadence (not stored).
 *
 * Fresh-B departments are stocktaken weekly; their daily FIM cost is only
 * trued-up after a stocktake (loaded on the FIM upload day that follows it).
 * Until that upload lands, the running daily margin is unreliable. So the
 * cutoff = the most recent stocktake date whose post-stocktake FIM is expected
 * to be loaded by now. Margin over any window ending after this date is
 * suppressed for Fresh-B depts; sales/waste/etc. are still reported.
 */
export function deriveFreshBMarginDate(stocktakeDay: string, fimUploadDay: string, todayIso: string): string {
  const stIdx = DAY_INDEX[stocktakeDay] ?? 0; // default Sunday
  const upIdx = DAY_INDEX[fimUploadDay] ?? 2; // default Tuesday
  const today = new Date(todayIso + "T00:00:00Z");
  const backToStocktake = (today.getUTCDay() - stIdx + 7) % 7;
  const lastStocktake = new Date(today);
  lastStocktake.setUTCDate(today.getUTCDate() - backToStocktake);
  // Days from a stocktake to the next upload day (1..7; same weekday => next week).
  let stToUp = (upIdx - stIdx + 7) % 7;
  if (stToUp === 0) stToUp = 7;
  const uploadDate = new Date(lastStocktake);
  uploadDate.setUTCDate(lastStocktake.getUTCDate() + stToUp);
  // If that upload hasn't happened yet, fall back to the prior stocktake week.
  const cutoff = today.getTime() >= uploadDate.getTime()
    ? lastStocktake
    : new Date(lastStocktake.getTime() - 7 * 86_400_000);
  return cutoff.toISOString().slice(0, 10);
}

/** Fresh-B settings (dept set + derived margin cutoff) from app_settings. */
export async function getFreshBConfig(
  env: Env,
): Promise<{ depts: Set<string>; stocktakeDay: string; fimUploadDay: string; marginDate: string }> {
  const rows = await env.DB.prepare(
    `SELECT key, value FROM app_settings
     WHERE key IN ('fresh_b_depts','fresh_b_stocktake_day','fresh_b_fim_upload_day')`,
  ).all<{ key: string; value: string }>();
  const m = new Map((rows.results ?? []).map((r) => [r.key, r.value]));
  const depts = new Set(
    (m.get("fresh_b_depts") ?? "F04,F06,F07,F09,F10,F64,F68,F77")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const stocktakeDay = m.get("fresh_b_stocktake_day") || "Sunday";
  const fimUploadDay = m.get("fresh_b_fim_upload_day") || "Tuesday";
  const marginDate = deriveFreshBMarginDate(stocktakeDay, fimUploadDay, new Date().toISOString().slice(0, 10));
  return { depts, stocktakeDay, fimUploadDay, marginDate };
}

/**
 * GET /api/fim/period?from=&to= — FIM aggregated over a date range, GROUP BY
 * dept. CRITICAL: margin% is computed from SUMMED sales/cos, never by averaging
 * daily margin percentages. Uses date_from/date_to containment so daily,
 * weekly and monthly rows are all included correctly.
 */
export async function handleFimPeriod(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  if (!from || !to) return json({ error: "from and to (YYYY-MM-DD) are required." }, 400);

  // Clamp the requested window to the actual FIM data span before it drives the
  // RECURSIVE day generator in fimResolvedCte. Callers (the FY + FIM-analysis
  // screens) pass "all data" as 2000-01-01→2099-12-31, which would generate
  // ~36,525 day-rows for ~850 days of real data (~7s). Days outside the data
  // span cover no rows, so clamping is result-identical but ~40x cheaper.
  const bounds = await env.DB.prepare(
    "SELECT MIN(date_from) mn, MAX(date_to) mx FROM fim_daily",
  ).first<{ mn: string | null; mx: string | null }>();
  const lo = bounds?.mn && from < bounds.mn ? bounds.mn : from;
  const hi = bounds?.mx && to > bounds.mx ? bounds.mx : to;

  const rows = await env.DB.prepare(
    `${fimResolvedCte("WITH")}
     SELECT dept_code,
            MAX(dept_name) dept_name,
            SUM(net_sales_zar)       sales,
            SUM(total_cos_zar)       cos,
            SUM(waste_zar)           waste,
            SUM(shrink_zar)          shrink,
            SUM(total_purchases_zar) purchases,
            SUM(net_gr_cost_zar)     net_gr_cost,
            (SELECT o.opening_soh_zar FROM fr o WHERE o.dept_code = fr.dept_code ORDER BY o.day ASC  LIMIT 1) opening_soh,
            (SELECT c.closing_soh_zar FROM fr c WHERE c.dept_code = fr.dept_code ORDER BY c.day DESC LIMIT 1) closing_soh,
            SUM(commercial_disc_zar) commercial_disc, SUM(line_disc_zar) line_disc,
            SUM(basket_disc_zar) basket_disc, SUM(trade_invest_zar) trade_invest,
            SUM(sallies_tallies_zar) sallies_tallies, SUM(swell_allowance_zar) swell_allowance,
            SUM(total_shortages_zar) total_shortages, SUM(net_shrinkage_zar) net_shrinkage, SUM(rtc_zar) rtc,
            COUNT(DISTINCT day) periods,
            GROUP_CONCAT(DISTINCT report_type) report_types
     FROM fr
     GROUP BY dept_code`,
  )
    .bind(lo, hi)
    .all<Record<string, number | string | null>>();

  const guides = await env.DB.prepare(
    `SELECT dept_code, dept_name, dept_group, guideline_margin_pct FROM dept_guidelines g
     WHERE effective_from = (SELECT MAX(effective_from) FROM dept_guidelines g2 WHERE g2.dept_code = g.dept_code)`,
  ).all<{ dept_code: string; dept_name: string; dept_group: string; guideline_margin_pct: number }>();
  const gmap = new Map((guides.results ?? []).map((g) => [g.dept_code, g]));

  const r2 = (n: unknown) => (n == null ? null : Math.round(Number(n) * 100) / 100);
  const departments = (rows.results ?? []).map((r) => {
    const deptCode = String(r.dept_code);
    const sales = Number(r.sales ?? 0);
    const cos = Number(r.cos ?? 0);
    const marginPct = sales > 0 ? Math.round(((sales - cos) / sales) * 1000) / 10 : null;
    const g = gmap.get(deptCode);
    const guideline = g?.guideline_margin_pct ?? null;
    const variancePp = marginPct != null && guideline != null ? Math.round((marginPct - guideline) * 10) / 10 : null;
    return {
      deptCode,
      deptName: (r.dept_name as string) ?? g?.dept_name ?? null,
      deptGroup: g?.dept_group ?? null,
      salesZar: r2(r.sales),
      cosZar: r2(r.cos),
      wasteZar: r2(r.waste),
      shrinkZar: r2(r.shrink),
      purchasesZar: r2(r.purchases),
      netGrCostZar: r2(r.net_gr_cost),
      openingSohZar: r2(r.opening_soh),
      closingSohZar: r2(r.closing_soh),
      commercialDiscZar: r2(r.commercial_disc),
      lineDiscZar: r2(r.line_disc),
      basketDiscZar: r2(r.basket_disc),
      tradeInvestZar: r2(r.trade_invest),
      salliesTalliesZar: r2(r.sallies_tallies),
      swellAllowanceZar: r2(r.swell_allowance),
      totalShortagesZar: r2(r.total_shortages),
      netShrinkageZar: r2(r.net_shrinkage),
      rtcZar: r2(r.rtc),
      marginPct,
      guidelineMarginPct: guideline,
      variancePp,
      periods: Number(r.periods),
      reportTypes: r.report_types,
      isProduction: deptCode === "F06" || deptCode === "F09",
      marginSuppressed: false,
    };
  });

  // Fresh-B margin suppression: daily/in-progress margin is unreliable until the
  // week is stocktaken. If the window extends past the last loaded stocktake,
  // null out margin (and variance) for Fresh-B depts — sales/waste stay intact.
  const fb = await getFreshBConfig(env);
  if (to > fb.marginDate) {
    for (const d of departments) {
      if (fb.depts.has(d.deptCode)) {
        d.marginPct = null;
        d.variancePp = null;
        d.marginSuppressed = true;
      }
    }
  }

  departments.sort(
    (a, b) =>
      (GROUP_RANK[a.deptGroup ?? ""] ?? 9) - (GROUP_RANK[b.deptGroup ?? ""] ?? 9) ||
      a.deptCode.localeCompare(b.deptCode),
  );
  return json({ from, to, departments, freshBMarginDate: fb.marginDate });
}

const GROUP_RANK: Record<string, number> = { "Non-Fresh": 0, "Fresh-A": 1, "Fresh-B": 2 };

/** GET /api/fim/by-period — FIM rolled up to fiscal periods (4-4-5), margin from sums. */
export async function handleFimByPeriod(env: Env): Promise<Response> {
  // Resolve to one row per (day × dept) at the finest granularity over the full
  // data span, then bucket days into fiscal periods. This avoids the report_date
  // join multi-counting daily/weekly/monthly rows that cover the same period.
  const span = await env.DB.prepare(
    `SELECT MIN(date_from) lo, MAX(date_to) hi FROM fim_daily WHERE dept_code != 'TOTAL'`,
  ).first<{ lo: string | null; hi: string | null }>();
  if (!span?.lo || !span?.hi) return json({ periods: [] });
  const rows = await env.DB.prepare(
    `${fimResolvedCte("WITH")}
     SELECT fw.fiscal_period_code period, fw.fiscal_quarter_code quarter, fw.fiscal_year fy,
            SUM(fr.net_sales_zar) sales, SUM(fr.total_cos_zar) cos,
            SUM(fr.waste_zar) waste, SUM(fr.shrink_zar) shrink, SUM(fr.total_purchases_zar) purchases,
            COUNT(DISTINCT fr.dept_code) depts, COUNT(DISTINCT fr.day) days
     FROM fr JOIN fiscal_weeks fw ON fr.day >= fw.week_start AND fr.day <= fw.week_end
     GROUP BY fw.fiscal_period_code ORDER BY fw.fiscal_period_code`,
  )
    .bind(span.lo, span.hi)
    .all<Record<string, number | string | null>>();
  const r2 = (n: unknown) => (n == null ? null : Math.round(Number(n) * 100) / 100);
  const periods = (rows.results ?? []).map((r) => {
    const sales = Number(r.sales ?? 0);
    const cos = Number(r.cos ?? 0);
    return {
      period: r.period,
      quarter: r.quarter,
      fiscalYear: Number(r.fy),
      salesZar: r2(r.sales),
      cosZar: r2(r.cos),
      wasteZar: r2(r.waste),
      shrinkZar: r2(r.shrink),
      purchasesZar: r2(r.purchases),
      marginPct: sales > 0 ? Math.round(((sales - cos) / sales) * 1000) / 10 : null,
      depts: Number(r.depts),
      days: Number(r.days),
    };
  });
  return json({ periods });
}

/** GET /api/fiscal/week?date= — the fiscal-week row containing a date. */
export async function handleFiscalWeek(req: Request, env: Env): Promise<Response> {
  const date = new URL(req.url).searchParams.get("date");
  if (!date) return json({ error: "date (YYYY-MM-DD) is required." }, 400);
  const row = await env.DB.prepare(
    `SELECT fiscal_week_code, fiscal_year, week_no, fiscal_period_code, fiscal_quarter,
            fiscal_quarter_code, week_start, week_end, statement_due_date
     FROM fiscal_weeks WHERE week_start <= ? AND week_end >= ? LIMIT 1`,
  )
    .bind(date, date)
    .first();
  return json({ date, week: row ?? null });
}

/**
 * GET /api/gr/period?from=&to= — goods receipts aggregated over a date range
 * (by gr_date), with blended margin from summed cost/sell (cost only where sell
 * is present) and a per-department breakdown vs guideline.
 */
export async function handleGrPeriod(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  if (!from || !to) return json({ error: "from and to (YYYY-MM-DD) are required." }, 400);

  // Match goods-receipt lines whose upload period overlaps [from,to]. GR is
  // period-level (≈bi-weekly), so overlap is more meaningful than a single date.
  const COST = `SUM(CASE WHEN g.sell_zar IS NOT NULL THEN g.cost_zar END)`;
  const OVERLAP = `JOIN uploads u ON u.id = g.upload_id
     WHERE COALESCE(u.report_date, g.gr_date) <= ?
       AND COALESCE(u.report_date_to, u.report_date, g.gr_date) >= ?`;
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) lines, COALESCE(${COST},0) cost, COALESCE(SUM(g.sell_zar),0) sell
     FROM gr_lines g ${OVERLAP}`,
  )
    .bind(to, from)
    .first<{ lines: number; cost: number; sell: number }>();

  const rows = await env.DB.prepare(
    `SELECT g.dept_code, MAX(g.dept_name) dept_name, COUNT(*) lines,
            COALESCE(${COST},0) cost, COALESCE(SUM(g.sell_zar),0) sell
     FROM gr_lines g ${OVERLAP}
     GROUP BY g.dept_code ORDER BY sell DESC`,
  )
    .bind(to, from)
    .all<{ dept_code: string; dept_name: string; lines: number; cost: number; sell: number }>();

  const guides = await env.DB.prepare(
    `SELECT dept_code, guideline_margin_pct FROM dept_guidelines g
     WHERE effective_from = (SELECT MAX(effective_from) FROM dept_guidelines g2 WHERE g2.dept_code = g.dept_code)`,
  ).all<{ dept_code: string; guideline_margin_pct: number }>();
  const gmap = new Map((guides.results ?? []).map((g) => [g.dept_code, g.guideline_margin_pct]));

  const blended = (cost: number, sell: number) => (sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null);
  const t = totals ?? { lines: 0, cost: 0, sell: 0 };
  const departments = (rows.results ?? []).map((r) => {
    const margin = blended(r.cost, r.sell);
    const guide = gmap.get(guidelineKeyForDept(r.dept_code) ?? "") ?? null;
    return {
      deptCode: r.dept_code,
      deptName: r.dept_name,
      lines: r.lines,
      costZar: Math.round(r.cost * 100) / 100,
      sellZar: Math.round(r.sell * 100) / 100,
      marginPct: margin,
      guidelineMarginPct: guide,
      deltaPp: margin != null && guide != null ? Math.round((margin - guide) * 10) / 10 : null,
    };
  });
  return json({
    from,
    to,
    totals: {
      lines: t.lines,
      costZar: Math.round(t.cost * 100) / 100,
      sellZar: Math.round(t.sell * 100) / 100,
      blendedMarginPct: blended(t.cost, t.sell),
    },
    departments,
  });
}

/** GET /api/meta/range — min/max dates across PO, FIM and GR, for screen defaults. */
export async function handleMetaRange(env: Env): Promise<Response> {
  const po = await env.DB.prepare(`SELECT MIN(order_date) mn, MAX(order_date) mx FROM po_lines`).first<{ mn: string | null; mx: string | null }>();
  const fim = await env.DB.prepare(`SELECT MIN(date_from) mn, MAX(date_to) mx FROM fim_daily`).first<{ mn: string | null; mx: string | null }>();
  const gr = await env.DB.prepare(`SELECT MIN(gr_date) mn, MAX(gr_date) mx FROM gr_lines`).first<{ mn: string | null; mx: string | null }>();
  return json({
    po: { min: po?.mn ?? null, max: po?.mx ?? null },
    fim: { min: fim?.mn ?? null, max: fim?.mx ?? null },
    gr: { min: gr?.mn ?? null, max: gr?.mx ?? null },
  });
}

/** GET /api/settings */
export async function handleGetSettings(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`SELECT key, value FROM app_settings`).all<{ key: string; value: string }>();
  const settings: Record<string, string> = {};
  for (const r of rows.results ?? []) settings[r.key] = r.value;
  return json({ settings });
}

/** PUT /api/settings — body { key: value, ... } */
export async function handlePutSettings(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return json({ error: "Expected a settings object." }, 400);
  const stmt = env.DB.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
  );
  const entries = Object.entries(body);
  if (entries.length) await env.DB.batch(entries.map(([k, v]) => stmt.bind(k, String(v))));
  return json({ status: "ok", updated: entries.length });
}

/** GET /api/creditors */
export async function handleGetCreditors(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT * FROM creditor_statements ORDER BY week_start DESC LIMIT 104`,
  ).all();
  return json({ statements: rows.results });
}

/** POST /api/creditors — upsert one weekly statement. */
export async function handlePostCreditor(req: Request, env: Env): Promise<Response> {
  const b = (await req.json().catch(() => null)) as {
    week_start?: string;
    week_end?: string;
    opening_cents?: number;
    purchases_cents?: number;
    credits_cents?: number;
    closing_cents?: number;
    due_date?: string;
    note?: string;
  } | null;
  if (!b?.week_start || !b?.week_end) return json({ error: "week_start and week_end are required." }, 400);
  await env.DB.prepare(
    `INSERT INTO creditor_statements (week_start, week_end, opening_cents, purchases_cents, credits_cents, closing_cents, due_date, note)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(week_start) DO UPDATE SET week_end=excluded.week_end, opening_cents=excluded.opening_cents,
       purchases_cents=excluded.purchases_cents, credits_cents=excluded.credits_cents,
       closing_cents=excluded.closing_cents, due_date=excluded.due_date, note=excluded.note`,
  )
    .bind(
      b.week_start,
      b.week_end,
      b.opening_cents ?? 0,
      b.purchases_cents ?? 0,
      b.credits_cents ?? 0,
      b.closing_cents ?? 0,
      b.due_date ?? null,
      b.note ?? null,
    )
    .run();
  return json({ status: "ok", week_start: b.week_start });
}

/** POST /api/anomalies/:id/ack — acknowledge (resolve) an anomaly. */
export async function handleAckAnomaly(env: Env, id: number, ack: boolean): Promise<Response> {
  await env.DB.prepare(`UPDATE anomalies SET resolved = ? WHERE id = ?`).bind(ack ? 1 : 0, id).run();
  return json({ status: "ok", id, resolved: ack });
}

interface CcWindow {
  customersTy: number;
  customersLy: number;
  customersVarPct: number | null; // TY vs LY %, one decimal
  salesTy: number; // Rand
  salesLy: number; // Rand
  salesVarPct: number | null;
  avgBasket: number | null; // AVG of the per-day basket over the window (Rand)
}

/** TY-vs-LY variance %, one decimal; null when there's no LY base. */
function ccVarPct(ty: number, ly: number): number | null {
  return ly > 0 ? Math.round(((ty - ly) / ly) * 1000) / 10 : null;
}

/**
 * GET /api/customer-counts/summary — YESTERDAY / WEEK-TO-DATE / MONTH-TO-DATE
 * customer totals anchored on the latest cal_date present (calendar windows:
 * Monday-start week, 1st-of-month). vs-LY is SUM(ty) vs SUM(ly) — the export's
 * LY column is already retail-equivalent. Returns { hasData:false } when empty.
 */
export async function handleCustomerCountSummary(env: Env): Promise<Response> {
  const latestRow = await env.DB.prepare(`SELECT MAX(cal_date) AS d FROM customer_counts`).first<{
    d: string | null;
  }>();
  const latest = latestRow?.d ?? null;
  if (!latest) return json({ hasData: false });

  // Calendar boundaries computed in SQLite (timezone-safe).
  const bounds = await env.DB.prepare(
    `SELECT date(?, '-' || ((strftime('%w', ?) + 6) % 7) || ' days') AS week_start,
            date(?, 'start of month') AS month_start`,
  )
    .bind(latest, latest, latest)
    .first<{ week_start: string; month_start: string }>();
  const weekStart = bounds?.week_start ?? latest;
  const monthStart = bounds?.month_start ?? latest;

  const agg = async (fromDate: string): Promise<CcWindow> => {
    const r = await env.DB.prepare(
      `SELECT COALESCE(SUM(customers_ty),0) AS cty,
              COALESCE(SUM(customers_ly),0) AS cly,
              COALESCE(SUM(sales_ty_cents),0) AS sty,
              COALESCE(SUM(sales_ly_cents),0) AS sly,
              AVG(basket_ty_cents) AS basket
       FROM customer_counts WHERE cal_date >= ? AND cal_date <= ?`,
    )
      .bind(fromDate, latest)
      .first<{ cty: number; cly: number; sty: number; sly: number; basket: number | null }>();
    const cty = r?.cty ?? 0;
    const cly = r?.cly ?? 0;
    const sty = r?.sty ?? 0;
    const sly = r?.sly ?? 0;
    return {
      customersTy: cty,
      customersLy: cly,
      customersVarPct: ccVarPct(cty, cly),
      salesTy: Math.round(sty) / 100, // cents -> Rand
      salesLy: Math.round(sly) / 100,
      salesVarPct: ccVarPct(sty, sly),
      avgBasket: r?.basket != null ? Math.round(r.basket) / 100 : null,
    };
  };

  const [yesterday, wtd, mtd] = await Promise.all([agg(latest), agg(weekStart), agg(monthStart)]);
  return json({ hasData: true, latestDate: latest, windows: { yesterday, wtd, mtd } });
}

/**
 * GET /api/customer-counts/daily?from=&to= — per-day rows for the table/chart,
 * newest first. Defaults to the most recent 90 days when no range is given. Money
 * is returned in Rand (sales_ty_zar / avg_basket_value); variances are TY-vs-LY %.
 */
export async function handleCustomerCountDaily(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  const where: string[] = [];
  const binds: unknown[] = [];
  if (from) {
    where.push("cal_date >= ?");
    binds.push(from);
  }
  if (to) {
    where.push("cal_date <= ?");
    binds.push(to);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const limitSql = where.length ? "" : "LIMIT 90"; // default: most recent 90 days
  const rows = await env.DB.prepare(
    `SELECT cal_date, customers_ty, customers_ly, sales_ty_cents, sales_ly_cents,
            basket_ty_cents, units_per_cust_ty
     FROM customer_counts ${whereSql} ORDER BY cal_date DESC ${limitSql}`,
  )
    .bind(...binds)
    .all<{
      cal_date: string;
      customers_ty: number | null;
      customers_ly: number | null;
      sales_ty_cents: number | null;
      sales_ly_cents: number | null;
      basket_ty_cents: number | null;
      units_per_cust_ty: number | null;
    }>();
  const zar = (c: number | null) => (c != null ? Math.round(c) / 100 : null);
  const varPct = (ty: number | null, ly: number | null) =>
    ty != null && ly != null && ly > 0 ? Math.round(((ty - ly) / ly) * 1000) / 10 : null;
  const daily = (rows.results ?? []).map((r) => ({
    cal_date: r.cal_date,
    customers_ty: r.customers_ty,
    customers_ly: r.customers_ly,
    customers_var_pct: varPct(r.customers_ty, r.customers_ly),
    sales_ty_zar: zar(r.sales_ty_cents),
    sales_ly_zar: zar(r.sales_ly_cents),
    sales_var_pct: varPct(r.sales_ty_cents, r.sales_ly_cents),
    avg_basket_value: zar(r.basket_ty_cents),
    avg_basket_units: r.units_per_cust_ty,
  }));
  return json(daily);
}

/**
 * GET /api/fan-score/summary — the latest week's NPS summary from fan_score_weeks
 * (reported NPS TW/LW + computed promoter/detractor counts). { hasData:false } when empty.
 */
export async function handleFanScoreSummary(env: Env): Promise<Response> {
  const w = await env.DB.prepare(
    `SELECT week_ending, site_code, nps_tw, nps_lw, total_responses, scored_responses,
            promoters, passives, detractors, nps_computed
     FROM fan_score_weeks ORDER BY week_ending DESC LIMIT 1`,
  ).first<{
    week_ending: string;
    site_code: string | null;
    nps_tw: number | null;
    nps_lw: number | null;
    total_responses: number;
    scored_responses: number;
    promoters: number;
    passives: number;
    detractors: number;
    nps_computed: number | null;
  }>();
  if (!w) return json({ hasData: false });
  return json({
    hasData: true,
    weekEnding: w.week_ending,
    siteCode: w.site_code,
    npsTw: w.nps_tw,
    npsLw: w.nps_lw,
    totalResponses: w.total_responses,
    scoredResponses: w.scored_responses,
    promoters: w.promoters,
    passives: w.passives,
    detractors: w.detractors,
    npsComputed: w.nps_computed,
  });
}

/**
 * GET /api/fan-score/history — the last 8 complete weeks from fan_score_weeks,
 * oldest-first so the trend chart reads left-to-right. Powers the Fan Score
 * mini-dashboard trend + week-history table.
 */
export async function handleFanScoreHistory(env: Env): Promise<Response> {
  const rows =
    (
      await env.DB.prepare(
        `SELECT week_ending, nps_tw, nps_lw, nps_computed,
                total_responses, scored_responses, promoters, passives, detractors
         FROM fan_score_weeks ORDER BY week_ending DESC LIMIT 8`,
      ).all<{
        week_ending: string;
        nps_tw: number | null;
        nps_lw: number | null;
        nps_computed: number | null;
        total_responses: number;
        scored_responses: number;
        promoters: number;
        passives: number;
        detractors: number;
      }>()
    ).results ?? [];
  const weeks = rows
    .map((r) => ({
      weekEnding: r.week_ending,
      npsTw: r.nps_tw,
      npsLw: r.nps_lw,
      npsComputed: r.nps_computed,
      totalResponses: r.total_responses,
      scoredResponses: r.scored_responses,
      promoters: r.promoters,
      passives: r.passives,
      detractors: r.detractors,
    }))
    .reverse();
  return json({ weeks });
}

// --- dashboard redesign: period resolver, tiles, PO listing, weekly budgets ---

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human label for an inclusive ISO date range, e.g. "16–22 Jun 2026". */
function fmtRangeLabel(from: string, to: string): string {
  const p = (s: string) => {
    const x = s.split("-");
    return { y: Number(x[0]), m: Number(x[1]), d: Number(x[2]) };
  };
  const a = p(from);
  const b = p(to);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/** ISO date one day before the given ISO date (UTC). */
function isoDayMinus1(iso: string): string {
  const x = iso.split("-");
  return new Date(Date.UTC(Number(x[0]), Number(x[1]) - 1, Number(x[2])) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** ISO date `n` days offset from the given ISO date (UTC; n may be negative). */
function isoAddDays(iso: string, n: number): string {
  const x = iso.split("-");
  return new Date(Date.UTC(Number(x[0]), Number(x[1]) - 1, Number(x[2])) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Single-date label, e.g. "21 Jun 2026". */
function fmtDate(iso: string): string {
  const x = iso.split("-");
  return `${Number(x[2])} ${MONTHS[Number(x[1]) - 1]} ${x[0]}`;
}

/**
 * Latest data date across the purchase/sales sources ("latest date in DB"),
 * used to anchor the dashboard's Yesterday / WTD / MTD / prev-period selectors.
 * Falls back to today when the store is empty.
 */
async function latestDataDate(env: Env): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const r = await env.DB.prepare(
    `SELECT MAX(d) d FROM (
       SELECT MAX(order_date) d FROM po_lines
       UNION ALL SELECT MAX(gr_date) d FROM gr_lines
       UNION ALL SELECT MAX(cal_date) d FROM customer_counts
     )`,
  ).first<{ d: string | null }>();
  return r?.d ?? today;
}

/** Default weekly cap (Rand) from app_settings.weekly_cap; falls back to 2,000,000. */
async function weeklyCapZar(env: Env): Promise<number> {
  const r = await env.DB.prepare(`SELECT value FROM app_settings WHERE key='weekly_cap'`).first<{ value: string }>();
  const n = Number(r?.value);
  return Number.isFinite(n) && n > 0 ? n : 2_000_000;
}

/**
 * Resolve a dashboard period selector into an inclusive [from,to] ISO range plus
 * a display label. "week" snaps to the fiscal week containing today (fiscal_weeks
 * lookup, calculated fallback); "month" is month-to-date; "fy"/"lastfy" use the
 * PnP fiscal year (1 Mar–end Feb); "custom" passes the supplied from/to through.
 */
export async function resolvePeriod(
  env: Env,
  period: string | null,
  fromParam: string | null,
  toParam: string | null,
): Promise<{ key: string; from: string; to: string; label: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const key = period ?? "week";
  if (key === "custom") {
    const from = fromParam ?? "2000-01-01";
    const to = toParam ?? today;
    return { key, from, to, label: fmtRangeLabel(from, to) };
  }
  if (key === "month") {
    const from = today.slice(0, 7) + "-01";
    return { key, from, to: today, label: fmtRangeLabel(from, today) };
  }
  if (key === "fy" || key === "lastfy") {
    const fc = fiscalCalendar(today);
    const openingYear = fc.fiscalYear - 1; // this FY opens 1 Mar of openingYear
    if (key === "fy") {
      const from = `${openingYear}-03-01`;
      return { key, from, to: today, label: `FY${fc.fiscalYear} (${fmtRangeLabel(from, today)})` };
    }
    const from = `${openingYear - 1}-03-01`;
    const to = isoDayMinus1(`${openingYear}-03-01`);
    return { key, from, to, label: `FY${fc.fiscalYear - 1} (${fmtRangeLabel(from, to)})` };
  }
  // Dashboard-redesign selectors, anchored on the latest data date in the DB.
  if (key === "yesterday" || key === "wtd" || key === "prevweek" || key === "mtd" || key === "prevmonth") {
    const latest = await latestDataDate(env);
    if (key === "yesterday") return { key, from: latest, to: latest, label: fmtRangeLabel(latest, latest) };
    if (key === "mtd") {
      const from = latest.slice(0, 7) + "-01";
      return { key, from, to: latest, label: fmtRangeLabel(from, latest) };
    }
    if (key === "prevmonth") {
      const to = isoDayMinus1(latest.slice(0, 7) + "-01"); // last day of prior calendar month
      const from = to.slice(0, 7) + "-01";
      return { key, from, to, label: fmtRangeLabel(from, to) };
    }
    // wtd / prevweek: snap to the fiscal week containing `latest`.
    const cur = await env.DB.prepare(
      `SELECT week_start, week_end FROM fiscal_weeks WHERE week_start <= ? AND week_end >= ? LIMIT 1`,
    )
      .bind(latest, latest)
      .first<{ week_start: string; week_end: string }>();
    const curStart = cur?.week_start ?? fiscalCalendar(latest).fiscalWeekStart;
    if (key === "wtd") return { key, from: curStart, to: latest, label: fmtRangeLabel(curStart, latest) };
    // prevweek: last complete fiscal week before the current week.
    const prev = await env.DB.prepare(
      `SELECT week_start, week_end FROM fiscal_weeks WHERE week_end < ? ORDER BY week_end DESC LIMIT 1`,
    )
      .bind(curStart)
      .first<{ week_start: string; week_end: string }>();
    const pFrom = prev?.week_start ?? isoAddDays(curStart, -7);
    const pTo = prev?.week_end ?? isoDayMinus1(curStart);
    return { key, from: pFrom, to: pTo, label: fmtRangeLabel(pFrom, pTo) };
  }

  // week (default)
  const row = await env.DB.prepare(
    `SELECT week_start, week_end FROM fiscal_weeks WHERE week_start <= ? AND week_end >= ? LIMIT 1`,
  )
    .bind(today, today)
    .first<{ week_start: string; week_end: string }>();
  if (row) return { key: "week", from: row.week_start, to: row.week_end, label: fmtRangeLabel(row.week_start, row.week_end) };
  const fc = fiscalCalendar(today);
  return { key: "week", from: fc.fiscalWeekStart, to: fc.fiscalWeekEnd, label: fmtRangeLabel(fc.fiscalWeekStart, fc.fiscalWeekEnd) };
}

/** Yesterday / WTD / MTD net sales (cents) from customer_counts + the window bounds. */
async function salesWindowsCents(env: Env): Promise<{
  latestDate: string | null;
  weekStart: string | null;
  monthStart: string | null;
  yesterdayCents: number;
  wtdCents: number;
  mtdCents: number;
}> {
  const latestRow = await env.DB.prepare(`SELECT MAX(cal_date) AS d FROM customer_counts`).first<{ d: string | null }>();
  const latest = latestRow?.d ?? null;
  if (!latest)
    return { latestDate: null, weekStart: null, monthStart: null, yesterdayCents: 0, wtdCents: 0, mtdCents: 0 };
  const bounds = await env.DB.prepare(
    `SELECT date(?, '-' || ((strftime('%w', ?) + 6) % 7) || ' days') AS week_start,
            date(?, 'start of month') AS month_start`,
  )
    .bind(latest, latest, latest)
    .first<{ week_start: string; month_start: string }>();
  const weekStart = bounds?.week_start ?? latest;
  const monthStart = bounds?.month_start ?? latest;
  const sum = async (from: string): Promise<number> => {
    const r = await env.DB.prepare(
      `SELECT COALESCE(SUM(sales_ty_cents),0) s FROM customer_counts WHERE cal_date >= ? AND cal_date <= ?`,
    )
      .bind(from, latest)
      .first<{ s: number }>();
    return r?.s ?? 0;
  };
  const [y, w, mo] = await Promise.all([sum(latest), sum(weekStart), sum(monthStart)]);
  return { latestDate: latest, weekStart, monthStart, yesterdayCents: y, wtdCents: w, mtdCents: mo };
}

/**
 * The last COMPLETE fiscal week that has FIM data, ending before the current
 * (in-progress) week. This avoids the distorted daily catch-weight figures
 * (F04/F06/F09) that the partial current week carries. Returns the week's
 * inclusive [from,to], a "W/E …" label and the week-ending date, or null when
 * no FIM has been loaded. §6 of the dashboard redesign.
 */
async function prevCompleteFimWeek(
  env: Env,
): Promise<{ from: string; to: string; label: string; weekEnding: string } | null> {
  const today = new Date().toISOString().slice(0, 10);
  const cur = await env.DB.prepare(
    `SELECT week_start FROM fiscal_weeks WHERE week_start <= ? AND week_end >= ? LIMIT 1`,
  )
    .bind(today, today)
    .first<{ week_start: string }>();
  const curStart = cur?.week_start ?? fiscalCalendar(today).fiscalWeekStart;
  // Latest FIM day ending strictly before the current week; fall back to the
  // overall latest FIM day if everything we have is inside the current week.
  let anchorRow = await env.DB.prepare(
    `SELECT MAX(date_to) d FROM fim_daily WHERE dept_code != 'TOTAL' AND date_to < ?`,
  )
    .bind(curStart)
    .first<{ d: string | null }>();
  if (!anchorRow?.d) {
    anchorRow = await env.DB.prepare(
      `SELECT MAX(date_to) d FROM fim_daily WHERE dept_code != 'TOTAL'`,
    ).first<{ d: string | null }>();
  }
  const anchor = anchorRow?.d ?? null;
  if (!anchor) return null;
  const wk = await env.DB.prepare(
    `SELECT week_start, week_end FROM fiscal_weeks WHERE week_start <= ? AND week_end >= ? LIMIT 1`,
  )
    .bind(anchor, anchor)
    .first<{ week_start: string; week_end: string }>();
  const from = wk?.week_start ?? fiscalCalendar(anchor).fiscalWeekStart;
  const to = wk?.week_end ?? fiscalCalendar(anchor).fiscalWeekEnd;
  return { from, to, label: "W/E " + fmtDate(to), weekEnding: to };
}

/** Summed FIM margins + waste/shrink/shortage over an inclusive date window. */
async function fimWeekAggregate(
  env: Env,
  from: string,
  to: string,
): Promise<{
  salesZar: number;
  marginPct: number | null;
  shortagessZar: number;
  shrinkZar: number;
  shrinkPct: number | null;
  wasteZar: number;
  wastePct: number | null;
  rtcZar: number;
}> {
  const r = await env.DB.prepare(
    `${fimResolvedCte("WITH")}
     SELECT COALESCE(SUM(net_sales_zar),0) sales, COALESCE(SUM(total_cos_zar),0) cos,
            COALESCE(SUM(total_shortages_zar),0) shortages, COALESCE(SUM(shrink_zar),0) shrink,
            COALESCE(SUM(waste_zar),0) waste, COALESCE(SUM(rtc_zar),0) rtc
     FROM fr`,
  )
    .bind(from, to)
    .first<{ sales: number; cos: number; shortages: number; shrink: number; waste: number; rtc: number }>();
  const sales = Number(r?.sales ?? 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pctOf = (n: number) => (sales > 0 ? Math.round((n / sales) * 1000) / 10 : null);
  return {
    salesZar: r2(sales),
    marginPct: sales > 0 ? Math.round(((sales - Number(r?.cos ?? 0)) / sales) * 1000) / 10 : null,
    shortagessZar: r2(Number(r?.shortages ?? 0)),
    shrinkZar: r2(Number(r?.shrink ?? 0)),
    shrinkPct: pctOf(Number(r?.shrink ?? 0)),
    wasteZar: r2(Number(r?.waste ?? 0)),
    wastePct: pctOf(Number(r?.waste ?? 0)),
    rtcZar: r2(Number(r?.rtc ?? 0)),
  };
}

// Departments carried in the structured budget editor (Instore Bakery / Butchery / Deli).
const BUDGET_DEPTS = [
  { code: "F06", name: "Instore Bakery" },
  { code: "F09", name: "Butchery" },
  { code: "F04", name: "Deli" },
] as const;

/** Store-level (budget_type='store', department='TOTAL') budgets keyed by week_code. */
async function storeBudgetMap(
  env: Env,
): Promise<Map<string, { sales: number | null; po: number | null; gr: number | null }>> {
  const rows =
    (
      await env.DB.prepare(
        `SELECT week_code, sales_budget_zar, po_budget_zar, gr_budget_zar
         FROM weekly_budgets WHERE budget_type='store' AND department='TOTAL'`,
      ).all<{ week_code: string; sales_budget_zar: number | null; po_budget_zar: number | null; gr_budget_zar: number | null }>()
    ).results ?? [];
  return new Map(rows.map((r) => [r.week_code, { sales: r.sales_budget_zar, po: r.po_budget_zar, gr: r.gr_budget_zar }]));
}

/** PO purchases (cents), GR cost (cents) and FIM sales-margin % over an inclusive date window. */
async function windowMetrics(
  env: Env,
  from: string,
  to: string,
): Promise<{ poCents: number; grCents: number; marginPct: number | null }> {
  const po = await env.DB.prepare(
    `SELECT COALESCE(SUM(${PURCH}),0) v FROM po_lines p WHERE p.order_date >= ? AND p.order_date <= ?`,
  )
    .bind(from, to)
    .first<{ v: number }>();
  const gr = await env.DB.prepare(
    `SELECT COALESCE(SUM(cost_zar),0) v FROM gr_lines WHERE gr_date >= ? AND gr_date <= ?`,
  )
    .bind(from, to)
    .first<{ v: number }>();
  const fim = await env.DB.prepare(
    `${fimResolvedCte("WITH")}
     SELECT COALESCE(SUM(net_sales_zar),0) s, COALESCE(SUM(total_cos_zar),0) c FROM fr`,
  )
    .bind(from, to)
    .first<{ s: number; c: number }>();
  const s = Number(fim?.s ?? 0);
  const c = Number(fim?.c ?? 0);
  return {
    poCents: Number(po?.v ?? 0),
    grCents: Math.round(Number(gr?.v ?? 0) * 100),
    marginPct: s > 0 ? Math.round(((s - c) / s) * 1000) / 10 : null,
  };
}

/**
 * PO value split over an order_date window, in CENTS:
 *  - grossCents   = S001 store orders (PURCH; non-S002)
 *  - netCents     = SUM of ALL line_value_cents (S001 + the negative S002 lines)
 *  - returnsCents = netCents - grossCents  (= the S002 total; ≤ 0)
 * Net is the true PO commitment (returns reduce it); gross overstates it.
 */
async function poGrnCents(
  env: Env,
  from: string,
  to: string,
): Promise<{ grossCents: number; returnsCents: number; netCents: number }> {
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(${PURCH}),0) gross, COALESCE(SUM(p.line_value_cents),0) net
     FROM po_lines p WHERE p.order_date >= ? AND p.order_date <= ?`,
  )
    .bind(from, to)
    .first<{ gross: number; net: number }>();
  const grossCents = Number(r?.gross ?? 0);
  const netCents = Number(r?.net ?? 0);
  return { grossCents, returnsCents: netCents - grossCents, netCents };
}

/**
 * GET /api/dashboard/tiles?period=week|month|fy|lastfy|custom&from=&to=
 * One call for the redesigned dashboard: PO/GR budget-vs-actual-vs-variance,
 * open committed, Row-2 sales windows, and the latest FIM margin chip.
 */
export async function handleDashboardTiles(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const { key, from, to, label } = await resolvePeriod(env, q.get("period"), q.get("from"), q.get("to"));
  const t = thresholds(env);

  // PO actual over order_date range, in cents: gross (S001) / returns (S002) /
  // net (all). The budget tile is measured on NET — returns reduce the spend.
  const poGrn = await poGrnCents(env, from, to);
  const poGrossCents = poGrn.grossCents;
  const poReturnsCents = poGrn.returnsCents;
  const poActualCents = poGrn.netCents; // headline = net commitment

  // GR actual (cost) over gr_date range; gr_lines money is Rand.
  const grRow = await env.DB.prepare(
    `SELECT COALESCE(SUM(cost_zar),0) cost, COALESCE(SUM(sell_zar),0) sell FROM gr_lines WHERE gr_date >= ? AND gr_date <= ?`,
  )
    .bind(from, to)
    .first<{ cost: number; sell: number }>();
  const grActualCents = Math.round(Number(grRow?.cost ?? 0) * 100);
  const grSellCents = Math.round(Number(grRow?.sell ?? 0) * 100);

  // Store-level (TOTAL) budgets summed across the fiscal weeks overlapping [from,to];
  // a week with no store row falls back to the default weekly cap (PO & GR).
  const defaultCapZar = await weeklyCapZar(env);
  const periodWeeks =
    (
      await env.DB.prepare(
        `SELECT fiscal_week_code, week_start, week_end FROM fiscal_weeks
         WHERE week_start <= ? AND week_end >= ? ORDER BY week_start`,
      )
        .bind(to, from)
        .all<{ fiscal_week_code: string; week_start: string; week_end: string }>()
    ).results ?? [];
  const storeMap = await storeBudgetMap(env);
  let poBudgetZar = 0;
  let grBudgetZar = 0;
  for (const w of periodWeeks) {
    const sb = storeMap.get(w.fiscal_week_code);
    poBudgetZar += sb?.po != null ? sb.po : defaultCapZar;
    grBudgetZar += sb?.gr != null ? sb.gr : defaultCapZar;
  }
  if (periodWeeks.length === 0) {
    poBudgetZar = defaultCapZar;
    grBudgetZar = defaultCapZar;
  }
  const poBudgetCents = Math.round(poBudgetZar * 100);
  const grBudgetCents = Math.round(grBudgetZar * 100);
  const poUsed = poBudgetCents > 0 ? poActualCents / poBudgetCents : 0;
  const grUsed = grBudgetCents > 0 ? grActualCents / grBudgetCents : 0;

  // Open committed: PO ordered minus GR received (matches the dashboard KPI).
  // S001 ONLY — S002 returns are incoming credits, not future cash outflows.
  const recon = await env.DB.prepare(
    `SELECT COALESCE(SUM(line_value_cents),0) ordered_cents, COALESCE(SUM(received_value),0) received_zar,
            SUM(CASE WHEN is_fully_received = 0 THEN 1 ELSE 0 END) lines FROM po_lines
     WHERE COALESCE(sloc,'') != 'S002'`,
  ).first<{ ordered_cents: number; received_zar: number; lines: number }>();
  const openCommittedCents = Math.max(0, Math.round((recon?.ordered_cents ?? 0) - (recon?.received_zar ?? 0) * 100));

  const sw = await salesWindowsCents(env);
  const latest = sw.latestDate;
  const weekStart = sw.weekStart;
  const monthStart = sw.monthStart;

  // Row-2 sales-budget proration: the store sales budget of the week containing the
  // latest sales day (daily = /7, WTD = ×daysElapsed/7), and the sum of store sales
  // budgets across the weeks overlapping the month-to-date for MTD.
  let weekSalesBudgetZar: number | null = null;
  let monthSalesBudgetZar = 0;
  let anyMonthSales = false;
  let daysElapsed = 7;
  if (latest && weekStart && monthStart) {
    const wk = await env.DB.prepare(
      `SELECT fiscal_week_code, week_start FROM fiscal_weeks WHERE week_start <= ? AND week_end >= ? LIMIT 1`,
    )
      .bind(latest, latest)
      .first<{ fiscal_week_code: string; week_start: string }>();
    if (wk) {
      weekSalesBudgetZar = storeMap.get(wk.fiscal_week_code)?.sales ?? null;
      daysElapsed = Math.round((Date.parse(latest) - Date.parse(wk.week_start)) / 86400000) + 1;
      if (daysElapsed < 1) daysElapsed = 1;
      if (daysElapsed > 7) daysElapsed = 7;
    }
    const mWeeks =
      (
        await env.DB.prepare(`SELECT fiscal_week_code FROM fiscal_weeks WHERE week_end >= ? AND week_start <= ?`)
          .bind(monthStart, latest)
          .all<{ fiscal_week_code: string }>()
      ).results ?? [];
    for (const w of mWeeks) {
      const s = storeMap.get(w.fiscal_week_code)?.sales;
      if (s != null) {
        monthSalesBudgetZar += s;
        anyMonthSales = true;
      }
    }
  }

  const [wY, wW, wM] = latest
    ? await Promise.all([
        windowMetrics(env, latest, latest),
        windowMetrics(env, weekStart ?? latest, latest),
        windowMetrics(env, monthStart ?? latest, latest),
      ])
    : [
        { poCents: 0, grCents: 0, marginPct: null },
        { poCents: 0, grCents: 0, marginPct: null },
        { poCents: 0, grCents: 0, marginPct: null },
      ];

  // §6: FIM figures on the dashboard use the last COMPLETE fiscal week, not the
  // distorted current partial week. One margin chip is shared by all Sales tiles.
  const prevWeek = await prevCompleteFimWeek(env);
  const fimAgg = prevWeek ? await fimWeekAggregate(env, prevWeek.from, prevWeek.to) : null;
  const fimMarginPct = fimAgg?.marginPct ?? null;

  const salesVar = (actualCents: number, budgetCents: number | null): number | null =>
    budgetCents != null && budgetCents > 0 ? Math.round(((actualCents - budgetCents) / budgetCents) * 1000) / 10 : null;
  const ydayBudgetC = weekSalesBudgetZar != null ? Math.round((weekSalesBudgetZar / 7) * 100) : null;
  const wtdBudgetC = weekSalesBudgetZar != null ? Math.round(((weekSalesBudgetZar * daysElapsed) / 7) * 100) : null;
  const mtdBudgetC = anyMonthSales ? Math.round(monthSalesBudgetZar * 100) : null;
  const mkWin = (
    salesCents: number,
    budgetCents: number | null,
    wm: { poCents: number; grCents: number; marginPct: number | null },
  ) => ({
    salesCents,
    salesBudgetCents: budgetCents,
    salesVarPct: salesVar(salesCents, budgetCents),
    poCents: wm.poCents,
    grCents: wm.grCents,
    marginPct: fimMarginPct,
  });

  return json({
    period: { key, from, to, label },
    po: {
      actualCents: poActualCents, // = net (headline)
      grossCents: poGrossCents,
      returnsCents: poReturnsCents,
      netCents: poActualCents,
      budgetCents: poBudgetCents,
      varCents: poActualCents - poBudgetCents,
      usedPct: Math.round(poUsed * 1000) / 10,
      status: budgetStatus(poUsed, t),
    },
    // Rand-denominated PO split for the budget tile / quick consumers.
    budget: {
      poGrossZar: Math.round(poGrossCents) / 100,
      poReturnsZar: Math.round(poReturnsCents) / 100,
      poNetZar: Math.round(poActualCents) / 100,
      poUsedPct: Math.round(poUsed * 1000) / 10,
    },
    gr: {
      actualCents: grActualCents,
      sellCents: grSellCents,
      budgetCents: grBudgetCents,
      varCents: grActualCents - grBudgetCents,
      usedPct: Math.round(grUsed * 1000) / 10,
      status: budgetStatus(grUsed, t),
    },
    openCommitted: { valueCents: openCommittedCents, lines: recon?.lines ?? 0 },
    windows: {
      latestDate: latest,
      yesterday: mkWin(sw.yesterdayCents, ydayBudgetC, wY),
      wtd: mkWin(sw.wtdCents, wtdBudgetC, wW),
      mtd: mkWin(sw.mtdCents, mtdBudgetC, wM),
    },
    // §5/§6: previous complete fiscal week label + that week's waste/shrink snapshot.
    fimWeekLabel: prevWeek?.label ?? null,
    fimWeekEnding: prevWeek?.weekEnding ?? null,
    fimWeekFrom: prevWeek?.from ?? null,
    fimWeekTo: prevWeek?.to ?? null,
    wasteData: fimAgg
      ? {
          shortagessZar: fimAgg.shortagessZar,
          shrinkZar: fimAgg.shrinkZar,
          shrinkPct: fimAgg.shrinkPct,
          wasteZar: fimAgg.wasteZar,
          wastePct: fimAgg.wastePct,
        }
      : null,
  });
}

/**
 * GET /api/dashboard/cashflow — upcoming creditor payments for the dashboard.
 *  - pnpPayments: next 3 PnP DC corporate payments (po invoice value per fiscal
 *    week, due on the statement-due Monday = week end + 28d).
 *  - meatPayments: Vencor / meat-supplier GR payments (14-day terms) falling due
 *    in the next 14 days. gr_lines carries no vendor, so we match on the linked
 *    PO vendor name (…vencor…/…meat…) or the butchery/deli departments (F09/F04).
 */
export async function handleDashboardCashflow(_req: Request, env: Env): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10);
  const dayDiff = (iso: string) => Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);

  const pnpRows =
    (
      await env.DB.prepare(
        `SELECT fw.fiscal_week_code code, fw.week_end week_end,
                COALESCE(fw.statement_due_date, date(fw.week_end,'+28 days')) pay_monday,
                COALESCE(SUM(${PURCH}),0) val_cents
         FROM fiscal_weeks fw
         JOIN po_lines p ON p.order_date >= fw.week_start AND p.order_date <= fw.week_end
         GROUP BY fw.fiscal_week_code
         HAVING val_cents > 0`,
      ).all<{ code: string; week_end: string; pay_monday: string; val_cents: number }>()
    ).results ?? [];
  const pnpPayments = pnpRows
    .filter((r) => r.pay_monday >= today)
    .sort((a, b) => a.pay_monday.localeCompare(b.pay_monday))
    .slice(0, 3)
    .map((r) => ({
      invoiceWeekCode: r.code,
      invoiceWeekEnding: r.week_end,
      paymentDueMonday: r.pay_monday,
      estimatedValueZar: Math.round(Number(r.val_cents)) / 100,
      daysUntilDue: dayDiff(r.pay_monday),
    }));

  const meatRows =
    (
      await env.DB.prepare(
        `SELECT g.gr_date gr_date, date(g.gr_date,'+14 days') due_date,
                COALESCE(SUM(g.cost_zar),0) val, MAX(v.name) vendor_name
         FROM gr_lines g
         LEFT JOIN po_lines p ON p.po_number = g.po_number
         LEFT JOIN vendors v ON v.id = p.vendor_id
         WHERE (LOWER(COALESCE(v.name,'')) LIKE '%vencor%' OR LOWER(COALESCE(v.name,'')) LIKE '%meat%'
                OR substr(g.dept_code, instr(g.dept_code,'/')+1) IN ('F09','F04'))
           AND g.gr_date IS NOT NULL
           AND date(g.gr_date,'+14 days') >= date('now')
           AND date(g.gr_date,'+14 days') <= date('now','+14 days')
         GROUP BY g.gr_date
         HAVING val > 0
         ORDER BY due_date`,
      ).all<{ gr_date: string; due_date: string; val: number; vendor_name: string | null }>()
    ).results ?? [];
  const meatPayments = meatRows.map((r) => ({
    grDate: r.gr_date,
    dueDate: r.due_date,
    valueZar: Math.round(Number(r.val) * 100) / 100,
    vendorName: r.vendor_name || "Meat (F09/F04)",
    daysUntilDue: dayDiff(r.due_date),
  }));

  return json({ pnpPayments, meatPayments });
}

/**
 * GET /api/waste?from=YYYY-MM-DD&to=YYYY-MM-DD — waste & shrinkage analysis from
 * fim_daily: store summary, per-department breakdown (sorted worst-first by waste
 * %), a 13-week trend, plus any open FIM_HIGH_WASTE / FIM_HIGH_SHRINK anomalies.
 */
export async function handleWaste(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  let from = q.get("from");
  let to = q.get("to");
  if (q.get("period") || !from || !to) {
    const r = await resolvePeriod(env, q.get("period") ?? "prevweek", from, to);
    from = from ?? r.from;
    to = to ?? r.to;
  }

  const rows =
    (
      await env.DB.prepare(
        `${fimResolvedCte("WITH")}
         SELECT dept_code, MAX(dept_name) dept_name,
                COALESCE(SUM(net_sales_zar),0) sales,
                COALESCE(SUM(total_shortages_zar),0) shortages,
                COALESCE(SUM(shrink_zar),0) shrink,
                COALESCE(SUM(waste_zar),0) waste,
                COALESCE(SUM(rtc_zar),0) rtc
         FROM fr
         GROUP BY dept_code`,
      )
        .bind(from, to)
        .all<{ dept_code: string; dept_name: string | null; sales: number; shortages: number; shrink: number; waste: number; rtc: number }>()
    ).results ?? [];

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pctOf = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : null);
  const byDept = rows
    .map((r) => ({
      deptCode: r.dept_code,
      deptName: r.dept_name ?? "",
      salesZar: r2(Number(r.sales)),
      shortagessZar: r2(Number(r.shortages)),
      shrinkZar: r2(Number(r.shrink)),
      shrinkPct: pctOf(Number(r.shrink), Number(r.sales)),
      wasteZar: r2(Number(r.waste)),
      wastePct: pctOf(Number(r.waste), Number(r.sales)),
      rtcZar: r2(Number(r.rtc)),
    }))
    .sort((a, b) => (b.wastePct ?? -1) - (a.wastePct ?? -1));

  const totalSales = byDept.reduce((s, d) => s + d.salesZar, 0);
  const totalShort = byDept.reduce((s, d) => s + d.shortagessZar, 0);
  const totalShrink = byDept.reduce((s, d) => s + d.shrinkZar, 0);
  const totalWaste = byDept.reduce((s, d) => s + d.wasteZar, 0);
  const totalRtc = byDept.reduce((s, d) => s + d.rtcZar, 0);
  const summary = {
    totalSalesZar: r2(totalSales),
    totalShortagessZar: r2(totalShort),
    totalShrinkZar: r2(totalShrink),
    shrinkPct: pctOf(totalShrink, totalSales),
    totalWasteZar: r2(totalWaste),
    wastePct: pctOf(totalWaste, totalSales),
    totalRtcZar: r2(totalRtc),
  };

  // 13-week trend (independent of the selected range).
  const trendRows =
    (
      await env.DB.prepare(
        `SELECT fiscal_week_start ws, fiscal_week_end we,
                COALESCE(SUM(shrink_zar),0) shrink, COALESCE(SUM(waste_zar),0) waste,
                COALESCE(SUM(net_sales_zar),0) sales
         FROM fim_daily WHERE dept_code != 'TOTAL'
         GROUP BY fiscal_week_start, fiscal_week_end
         ORDER BY fiscal_week_end DESC LIMIT 13`,
      ).all<{ ws: string; we: string; shrink: number; waste: number; sales: number }>()
    ).results ?? [];
  const trend = trendRows
    .map((r) => ({
      weekEnding: r.we,
      shrinkZar: r2(Number(r.shrink)),
      wasteZar: r2(Number(r.waste)),
      salesZar: r2(Number(r.sales)),
    }))
    .reverse();

  const anomalies =
    (
      await env.DB.prepare(
        `SELECT id, type, severity, message, detected_at FROM anomalies
         WHERE resolved = 0 AND type IN ('FIM_HIGH_WASTE','FIM_HIGH_SHRINK')
         ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, id DESC LIMIT 20`,
      ).all()
    ).results ?? [];

  return json({ period: { from, to, label: fmtRangeLabel(from!, to!) }, summary, byDept, trend, anomalies });
}

/**
 * GET /api/waste/dept?dept=&from=&to=&period= — per-day waste/shrink/RTC detail for
 * ONE department over a range (finest-granularity-resolved via fimResolvedCte), for
 * the inline drill-down under the waste table. rtcRecoveryPct = RTC ÷ waste (how much
 * waste value was recovered via reduced-to-clear); net unrecovered = waste − RTC.
 */
export async function handleWasteDept(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const dept = q.get("dept");
  if (!dept) return json({ error: "dept is required." }, 400);
  let from = q.get("from");
  let to = q.get("to");
  if (q.get("period") || !from || !to) {
    const r = await resolvePeriod(env, q.get("period") ?? "prevmonth", from, to);
    from = from ?? r.from;
    to = to ?? r.to;
  }

  const dayRows =
    (
      await env.DB.prepare(
        `${fimResolvedCte("WITH")}
         SELECT day, MAX(dept_name) dept_name,
                COALESCE(SUM(net_sales_zar),0) sales,
                COALESCE(SUM(waste_zar),0) waste,
                COALESCE(SUM(shrink_zar),0) shrink,
                COALESCE(SUM(rtc_zar),0) rtc
         FROM fr WHERE dept_code = ?
         GROUP BY day ORDER BY day`,
      )
        .bind(from, to, dept)
        .all<{ day: string; dept_name: string | null; sales: number; waste: number; shrink: number; rtc: number }>()
    ).results ?? [];

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pctOf = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : null);
  const rows = dayRows.map((r) => ({
    date: r.day,
    salesZar: r2(Number(r.sales)),
    wasteZar: r2(Number(r.waste)),
    wastePct: pctOf(Number(r.waste), Number(r.sales)),
    shrinkZar: r2(Number(r.shrink)),
    shrinkPct: pctOf(Number(r.shrink), Number(r.sales)),
    rtcZar: r2(Number(r.rtc)),
  }));

  const totalSales = dayRows.reduce((s, r) => s + Number(r.sales), 0);
  const totalWaste = dayRows.reduce((s, r) => s + Number(r.waste), 0);
  const totalShrink = dayRows.reduce((s, r) => s + Number(r.shrink), 0);
  const totalRtc = dayRows.reduce((s, r) => s + Number(r.rtc), 0);
  const deptName = dayRows.find((r) => r.dept_name)?.dept_name ?? resolveDeptName(dept) ?? dept;

  const summary = {
    totalSalesZar: r2(totalSales),
    totalWasteZar: r2(totalWaste),
    wastePct: pctOf(totalWaste, totalSales),
    totalShrinkZar: r2(totalShrink),
    shrinkPct: pctOf(totalShrink, totalSales),
    totalRtcZar: r2(totalRtc),
    rtcRecoveryPct: totalWaste > 0 ? Math.round((totalRtc / totalWaste) * 1000) / 10 : null,
    netUnrecoveredWasteZar: r2(totalWaste - totalRtc),
  };

  return json({ dept, deptName, period: { from, to, label: fmtRangeLabel(from!, to!) }, summary, rows });
}

/**
 * GET /api/waste/dept/articles?dept=&from=&to= — the individual articles driving a
 * department's waste over a range, worst-first. Reads fim_articles (already stored
 * at daily grain, so plain range containment is correct — no resolver needed).
 */
export async function handleWasteDeptArticles(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const dept = q.get("dept");
  if (!dept) return json({ error: "dept is required." }, 400);
  let from = q.get("from");
  let to = q.get("to");
  if (q.get("period") || !from || !to) {
    const r = await resolvePeriod(env, q.get("period") ?? "prevmonth", from, to);
    from = from ?? r.from;
    to = to ?? r.to;
  }

  const rowsRaw =
    (
      await env.DB.prepare(
        `SELECT article_code, MAX(article_desc) article_desc,
                COALESCE(SUM(net_sales_zar),0) sales,
                COALESCE(SUM(waste_zar),0) waste,
                COALESCE(SUM(shrink_zar),0) shrink,
                COALESCE(SUM(rtc_zar),0) rtc
         FROM fim_articles
         WHERE dept_code = ? AND date_from >= ? AND date_to <= ?
         GROUP BY article_code
         ORDER BY SUM(waste_zar) DESC`,
      )
        .bind(dept, from, to)
        .all<{ article_code: string; article_desc: string | null; sales: number; waste: number; shrink: number; rtc: number }>()
    ).results ?? [];

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const pctOf = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : null);
  const rows = rowsRaw.map((r) => ({
    articleCode: r.article_code,
    articleDesc: r.article_desc,
    salesZar: r2(Number(r.sales)),
    wasteZar: r2(Number(r.waste)),
    wastePct: pctOf(Number(r.waste), Number(r.sales)),
    shrinkZar: r2(Number(r.shrink)),
    rtcZar: r2(Number(r.rtc)),
  }));
  return json({ dept, period: { from, to, label: fmtRangeLabel(from!, to!) }, rows });
}

/**
 * GET /api/po-lines/list?period=&from=&to=&status=all|open|matched|unmatched-po&vendor=&dept=&limit=&offset=
 * Paginated PO-line listing for the Purchase Orders screen, with reconcile status.
 */
export async function handlePoLinesList(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  let from = q.get("from");
  let to = q.get("to");
  if (q.get("period")) {
    const r = await resolvePeriod(env, q.get("period"), from, to);
    from = r.from;
    to = r.to;
  }
  const status = q.get("status") ?? "all";
  const vendor = q.get("vendor");
  const dept = q.get("dept");
  const limit = Math.min(Number(q.get("limit") ?? "200"), 1000);
  const offset = Math.max(Number(q.get("offset") ?? "0"), 0);

  // Base scope = period + vendor + dept (drives the gross/returns/net summary
  // cards). The status filter is layered on top only for the line LIST.
  const baseWhere: string[] = [];
  const baseBinds: unknown[] = [];
  if (from) { baseWhere.push("p.order_date >= ?"); baseBinds.push(from); }
  if (to) { baseWhere.push("p.order_date <= ?"); baseBinds.push(to); }
  if (vendor) { baseWhere.push("v.vendor_code = ?"); baseBinds.push(vendor); }
  if (dept) { baseWhere.push("substr(p.mdse_cat,1,3) = ?"); baseBinds.push(dept); }
  const baseScope = baseWhere.length ? "WHERE " + baseWhere.join(" AND ") : "";

  const where = [...baseWhere];
  const binds = [...baseBinds];
  if (status === "open") where.push("p.is_fully_received = 0");
  else if (status === "matched") where.push("p.is_fully_received = 1");
  else if (status === "unmatched-po") where.push("p.is_fully_received = 0");
  const scope = where.length ? "WHERE " + where.join(" AND ") : "";

  const summary = await env.DB.prepare(
    `SELECT COUNT(*) lines, COALESCE(SUM(${PURCH}),0) value_cents
     FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id ${scope}`,
  )
    .bind(...binds)
    .first<{ lines: number; value_cents: number }>();

  // Summary cards over the period scope (status-independent): gross/returns/net,
  // line counts and distinct vendor count.
  const cards = await env.DB.prepare(
    `SELECT COALESCE(SUM(${PURCH}),0) gross_cents,
            COALESCE(SUM(p.line_value_cents),0) net_cents,
            COUNT(CASE WHEN COALESCE(p.sloc,'') != 'S002' THEN 1 END) gross_lines,
            COUNT(CASE WHEN p.sloc = 'S002' THEN 1 END) returns_lines,
            COUNT(*) net_lines,
            COUNT(DISTINCT CASE WHEN COALESCE(p.sloc,'') != 'S002' THEN p.vendor_id END) vendors
     FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id ${baseScope}`,
  )
    .bind(...baseBinds)
    .first<{ gross_cents: number; net_cents: number; gross_lines: number; returns_lines: number; net_lines: number; vendors: number }>();
  const grossCents = Number(cards?.gross_cents ?? 0);
  const netCents = Number(cards?.net_cents ?? 0);

  // Open Committed — GLOBAL, S001 only. Same definition as the dashboard KPI
  // (ordered minus received across all S001 lines); returns (S002) excluded.
  const oc = await env.DB.prepare(
    `SELECT COALESCE(SUM(line_value_cents),0) ordered_cents, COALESCE(SUM(received_value),0) received_zar
     FROM po_lines WHERE COALESCE(sloc,'') != 'S002'`,
  ).first<{ ordered_cents: number; received_zar: number }>();
  const openCommittedCents = Math.max(0, Math.round((oc?.ordered_cents ?? 0) - (oc?.received_zar ?? 0) * 100));

  // Returns to vendor (S002) over the period scope, grouped by vendor (most negative first).
  const retScope = baseWhere.length ? baseScope + " AND p.sloc = 'S002'" : "WHERE p.sloc = 'S002'";
  const retRows = await env.DB.prepare(
    `SELECT v.vendor_code code, v.name, COUNT(*) lines, COALESCE(SUM(p.line_value_cents),0) ret_cents
     FROM po_lines p LEFT JOIN vendors v ON v.id = p.vendor_id ${retScope}
     GROUP BY p.vendor_id ORDER BY ret_cents ASC`,
  )
    .bind(...baseBinds)
    .all<{ code: string | null; name: string | null; lines: number; ret_cents: number }>();

  const rows = await env.DB.prepare(
    `SELECT p.po_number, p.order_date, v.vendor_code, v.name vendor_name,
            a.article_code, a.description article_desc, substr(p.mdse_cat,1,3) sap_dept_code,
            p.order_qty, COALESCE(p.line_value_cents,0) line_value_cents,
            COALESCE(p.received_qty,0) received_qty, COALESCE(p.open_value_cents,0) open_value_cents,
            p.last_gr_date,
            CAST(julianday('now') - julianday(COALESCE(p.last_gr_date, p.order_date)) AS INTEGER) days_outstanding
     FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN articles a ON a.id=p.article_id
     ${scope} ORDER BY p.order_date DESC, p.po_number LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit, offset)
    .all<Record<string, number | string | null>>();

  const lines = (rows.results ?? []).map((r) => {
    const rec = reconcileLine({
      order_qty: r.order_qty as number | null,
      received_qty: r.received_qty as number,
      order_date: r.order_date as string | null,
      days: r.days_outstanding as number | null,
    });
    return {
      po_number: r.po_number,
      order_date: r.order_date,
      vendor_code: r.vendor_code,
      vendor_name: r.vendor_name,
      article_code: r.article_code,
      article_desc: r.article_desc,
      sap_dept_code: r.sap_dept_code,
      order_qty: r.order_qty,
      received_qty: r.received_qty,
      line_value_cents: r.line_value_cents,
      open_value_cents: r.open_value_cents,
      last_gr_date: r.last_gr_date,
      days_outstanding: r.days_outstanding,
      status: rec.status,
      bucket: rec.bucket,
    };
  });

  return json({
    period: q.get("period") ? { key: q.get("period"), from, to } : null,
    summary: {
      lines: summary?.lines ?? 0,
      valueCents: summary?.value_cents ?? 0,
      grossCents,
      returnsCents: netCents - grossCents,
      netCents,
      grossLines: Number(cards?.gross_lines ?? 0),
      returnsLines: Number(cards?.returns_lines ?? 0),
      netLines: Number(cards?.net_lines ?? 0),
      openCommittedCents,
      vendors: Number(cards?.vendors ?? 0),
    },
    returnsByVendor: (retRows.results ?? []).map((r) => ({
      code: r.code,
      name: r.name,
      lines: Number(r.lines),
      returnsCents: Number(r.ret_cents),
    })),
    limit,
    offset,
    lines,
  });
}

interface WbRow {
  week_code: string;
  budget_type: string;
  department: string;
  sales_budget_zar: number | null;
  po_budget_zar: number | null;
  gr_budget_zar: number | null;
}

/**
 * GET /api/weekly-budgets — past 8 + next 4 fiscal weeks, each with its structured
 * budget rows (store TOTAL + per-department + per-department packaging), for the
 * Settings editor. defaultCapZar is the fallback weekly cap (Rand).
 */
export async function handleGetWeeklyBudgets(env: Env): Promise<Response> {
  const defaultCapZar = await weeklyCapZar(env);
  const fw =
    (
      await env.DB.prepare(
        `SELECT fiscal_week_code, week_start, week_end, week_no FROM fiscal_weeks
         WHERE week_end >= date('now','-56 days') AND week_start <= date('now','+28 days')
         ORDER BY week_start DESC`,
      ).all<{ fiscal_week_code: string; week_start: string; week_end: string; week_no: number }>()
    ).results ?? [];
  const rows =
    (
      await env.DB.prepare(
        `SELECT week_code, budget_type, department, sales_budget_zar, po_budget_zar, gr_budget_zar FROM weekly_budgets`,
      ).all<WbRow>()
    ).results ?? [];
  const byWeek = new Map<string, WbRow[]>();
  for (const r of rows) {
    const a = byWeek.get(r.week_code) ?? [];
    a.push(r);
    byWeek.set(r.week_code, a);
  }
  const weeks = fw.map((w) => {
    const rs = byWeek.get(w.fiscal_week_code) ?? [];
    const find = (type: string, dept: string) => rs.find((r) => r.budget_type === type && r.department === dept);
    const store = find("store", "TOTAL");
    const depts: Record<string, { sales: number | null; po: number | null; gr: number | null; pkgPo: number | null }> = {};
    for (const d of BUDGET_DEPTS) {
      const dep = find("department", d.code);
      const pkg = find("packaging", d.code);
      depts[d.code] = {
        sales: dep?.sales_budget_zar ?? null,
        po: dep?.po_budget_zar ?? null,
        gr: dep?.gr_budget_zar ?? null,
        pkgPo: pkg?.po_budget_zar ?? null,
      };
    }
    return {
      weekCode: w.fiscal_week_code,
      weekStart: w.week_start,
      weekEnding: w.week_end,
      weekNo: w.week_no,
      store: { sales: store?.sales_budget_zar ?? null, po: store?.po_budget_zar ?? null, gr: store?.gr_budget_zar ?? null },
      depts,
    };
  });
  return json({ defaultCapZar, depts: BUDGET_DEPTS, weeks });
}

/**
 * POST /api/weekly-budgets — replace all budget rows for one week in a single call
 * (delete the week's existing rows, insert the supplied set). Body:
 * { week_code, week_ending, rows:[{budget_type, department, sales_budget_zar?, po_budget_zar?, gr_budget_zar?}] }.
 */
export async function handlePostWeeklyBudget(req: Request, env: Env): Promise<Response> {
  const b = (await req.json().catch(() => null)) as {
    week_code?: string;
    week_ending?: string;
    rows?: Array<{
      budget_type?: string;
      department?: string;
      sales_budget_zar?: number | null;
      po_budget_zar?: number | null;
      gr_budget_zar?: number | null;
    }>;
  } | null;
  if (!b?.week_code || !b?.week_ending) return json({ error: "week_code and week_ending are required." }, 400);
  const num = (v: unknown): number | null => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const stmts: D1PreparedStatement[] = [
    env.DB.prepare(`DELETE FROM weekly_budgets WHERE week_code = ?`).bind(b.week_code),
  ];
  const ins = env.DB.prepare(
    `INSERT INTO weekly_budgets (week_code, week_ending, budget_type, department, sales_budget_zar, po_budget_zar, gr_budget_zar, updated_at)
     VALUES (?,?,?,?,?,?,?, datetime('now'))`,
  );
  for (const r of b.rows ?? []) {
    if (!r || !r.budget_type || !r.department) continue;
    const sales = num(r.sales_budget_zar);
    const po = num(r.po_budget_zar);
    const gr = num(r.gr_budget_zar);
    if (sales == null && po == null && gr == null) continue; // skip empty rows
    stmts.push(ins.bind(b.week_code, b.week_ending, String(r.budget_type), String(r.department), sales, po, gr));
  }
  await env.DB.batch(stmts);
  return json({ status: "ok", week_code: b.week_code, rows: stmts.length - 1 });
}

/** DELETE /api/weekly-budgets/:weekCode — remove all budget rows for that week. */
export async function handleDeleteWeeklyBudget(env: Env, weekCode: string): Promise<Response> {
  await env.DB.prepare(`DELETE FROM weekly_budgets WHERE week_code = ?`).bind(weekCode).run();
  return json({ status: "ok", week_code: weekCode });
}

/** Sum day-keyed rows ({d,v}) whose date falls within [start,end] inclusive. */
function sumDays(rows: { d: string; v: number }[], start: string, end: string): number {
  let s = 0;
  for (const r of rows) if (r.d >= start && r.d <= end) s += Number(r.v ?? 0);
  return s;
}

/**
 * GET /api/budgets/summary — past 8 + next 4 fiscal weeks with store-level sales/PO/GR
 * budget vs actual vs variance, plus per-department breakdown. Sales actual: store from
 * customer_counts (daily), departments from FIM (weekly). PO from po_lines, GR from gr_lines.
 */
export async function handleBudgetsSummary(env: Env): Promise<Response> {
  const defaultCapZar = await weeklyCapZar(env);
  const today = new Date().toISOString().slice(0, 10);
  const fw =
    (
      await env.DB.prepare(
        `SELECT fiscal_week_code, week_start, week_end, week_no FROM fiscal_weeks
         WHERE week_end >= date('now','-56 days') AND week_start <= date('now','+28 days')
         ORDER BY week_start DESC`,
      ).all<{ fiscal_week_code: string; week_start: string; week_end: string; week_no: number }>()
    ).results ?? [];
  if (fw.length === 0) return json({ defaultCapZar, depts: BUDGET_DEPTS, weeks: [] });
  const maxEnd = fw[0]!.week_end;
  const minStart = fw[fw.length - 1]!.week_start;

  const budgetRows =
    (
      await env.DB.prepare(
        `SELECT week_code, budget_type, department, sales_budget_zar, po_budget_zar, gr_budget_zar FROM weekly_budgets`,
      ).all<WbRow>()
    ).results ?? [];
  const bKey = (wc: string, ty: string, dp: string) => wc + "|" + ty + "|" + dp;
  const bMap = new Map(budgetRows.map((r) => [bKey(r.week_code, r.budget_type, r.department), r]));

  const deptCodes = BUDGET_DEPTS.map((d) => d.code);
  const inList = "('" + deptCodes.join("','") + "')";
  const dayRows = async (sql: string) =>
    ((await env.DB.prepare(sql).bind(minStart, maxEnd).all<{ d: string; v: number }>()).results ?? []);
  const [salesByDay, grByDay] = await Promise.all([
    dayRows(`SELECT cal_date d, COALESCE(SUM(sales_ty_cents),0) v FROM customer_counts WHERE cal_date BETWEEN ? AND ? GROUP BY cal_date`),
    dayRows(`SELECT gr_date d, COALESCE(SUM(cost_zar),0) v FROM gr_lines WHERE gr_date BETWEEN ? AND ? GROUP BY gr_date`),
  ]);
  // PO per day: gross (S001) and net (all) so weekly variance can be net-based.
  const poByDay =
    (
      await env.DB.prepare(
        `SELECT order_date d, COALESCE(SUM(${PURCH}),0) g, COALESCE(SUM(p.line_value_cents),0) n
         FROM po_lines p WHERE p.order_date BETWEEN ? AND ? GROUP BY order_date`,
      )
        .bind(minStart, maxEnd)
        .all<{ d: string; g: number; n: number }>()
    ).results ?? [];
  const poDept =
    (
      await env.DB.prepare(
        `SELECT order_date d, substr(p.mdse_cat,1,3) dept,
                COALESCE(SUM(${PURCH}),0) g, COALESCE(SUM(p.line_value_cents),0) n FROM po_lines p
         WHERE p.order_date BETWEEN ? AND ? AND substr(p.mdse_cat,1,3) IN ${inList} GROUP BY d, dept`,
      )
        .bind(minStart, maxEnd)
        .all<{ d: string; dept: string; g: number; n: number }>()
    ).results ?? [];
  // gr_lines.dept_code carries SAP codes like "Z1/F09"; normalize to the bare
  // suffix ("F09") to match FIM/PO dept codes (mirrors guidelineKeyForDept()).
  const grDept =
    (
      await env.DB.prepare(
        `SELECT gr_date d, substr(dept_code, instr(dept_code,'/')+1) dept, COALESCE(SUM(cost_zar),0) v FROM gr_lines
         WHERE gr_date BETWEEN ? AND ? AND substr(dept_code, instr(dept_code,'/')+1) IN ${inList} GROUP BY d, dept`,
      )
        .bind(minStart, maxEnd)
        .all<{ d: string; dept: string; v: number }>()
    ).results ?? [];
  // Per-day, finest-granularity-resolved FIM sales so weekly buckets align with
  // the day-keyed PO/GR/sales series above (no boundary-straddle drop/double-count).
  const fimDept =
    (
      await env.DB.prepare(
        `${fimResolvedCte("WITH")}
         SELECT day d, dept_code dept, COALESCE(SUM(net_sales_zar),0) v FROM fr
         WHERE dept_code IN ${inList} GROUP BY day, dept_code`,
      )
        .bind(minStart, maxEnd)
        .all<{ d: string; dept: string; v: number }>()
    ).results ?? [];

  const varPct = (actualCents: number, budgetCents: number | null): number | null =>
    budgetCents != null && budgetCents > 0 ? Math.round(((actualCents - budgetCents) / budgetCents) * 1000) / 10 : null;
  const metric = (actualCents: number, budgetZar: number | null) => ({
    budgetCents: budgetZar != null ? Math.round(budgetZar * 100) : null,
    actualCents,
    varPct: varPct(actualCents, budgetZar != null ? Math.round(budgetZar * 100) : null),
  });
  // PO metric: actual & variance measured on NET (gross + S002 returns); gross and
  // returns carried alongside for display. Returns are negative.
  const poMetric = (grossCents: number, netCents: number, budgetZar: number | null) => {
    const budgetCents = budgetZar != null ? Math.round(budgetZar * 100) : null;
    return {
      budgetCents,
      actualCents: netCents,
      grossCents,
      returnsCents: netCents - grossCents,
      netCents,
      varPct: varPct(netCents, budgetCents),
    };
  };
  const sumF = <T extends { d: string }>(rows: T[], start: string, end: string, f: (r: T) => number): number =>
    rows.reduce((s, r) => (r.d >= start && r.d <= end ? s + f(r) : s), 0);

  const weeks = fw.map((w) => {
    const ws = w.week_start;
    const we = w.week_end;
    const isFuture = ws > today;
    const store = bMap.get(bKey(w.fiscal_week_code, "store", "TOTAL"));
    const storeSalesC = isFuture ? 0 : Math.round(sumDays(salesByDay, ws, we));
    const storePoGrossC = isFuture ? 0 : Math.round(sumF(poByDay, ws, we, (r) => Number(r.g ?? 0)));
    const storePoNetC = isFuture ? 0 : Math.round(sumF(poByDay, ws, we, (r) => Number(r.n ?? 0)));
    const storeGrC = isFuture ? 0 : Math.round(sumDays(grByDay, ws, we) * 100);
    const depts = BUDGET_DEPTS.map((d) => {
      const dep = bMap.get(bKey(w.fiscal_week_code, "department", d.code));
      const pkg = bMap.get(bKey(w.fiscal_week_code, "packaging", d.code));
      const poGrossC = isFuture
        ? 0
        : Math.round(poDept.filter((r) => r.dept === d.code && r.d >= ws && r.d <= we).reduce((s, r) => s + Number(r.g ?? 0), 0));
      const poNetC = isFuture
        ? 0
        : Math.round(poDept.filter((r) => r.dept === d.code && r.d >= ws && r.d <= we).reduce((s, r) => s + Number(r.n ?? 0), 0));
      const grC = isFuture
        ? 0
        : Math.round(
            grDept.filter((r) => r.dept === d.code && r.d >= ws && r.d <= we).reduce((s, r) => s + Number(r.v ?? 0), 0) * 100,
          );
      const salesC = isFuture
        ? 0
        : Math.round(
            fimDept.filter((r) => r.dept === d.code && r.d >= ws && r.d <= we).reduce((s, r) => s + Number(r.v ?? 0), 0) * 100,
          );
      return {
        code: d.code,
        name: d.name,
        sales: metric(salesC, dep?.sales_budget_zar ?? null),
        po: poMetric(poGrossC, poNetC, dep?.po_budget_zar ?? null),
        gr: metric(grC, dep?.gr_budget_zar ?? null),
        pkgPoBudgetCents: pkg?.po_budget_zar != null ? Math.round(pkg.po_budget_zar * 100) : null,
      };
    });
    return {
      weekCode: w.fiscal_week_code,
      weekStart: ws,
      weekEnding: we,
      weekNo: w.week_no,
      isFuture,
      store: {
        sales: metric(storeSalesC, store?.sales_budget_zar ?? null),
        po: poMetric(storePoGrossC, storePoNetC, store?.po_budget_zar ?? defaultCapZar),
        gr: metric(storeGrC, store?.gr_budget_zar ?? defaultCapZar),
      },
      depts,
    };
  });
  return json({ defaultCapZar, depts: BUDGET_DEPTS, weeks });
}

/**
 * GET /api/fan-score/responses?week= — individual responses for a week (defaults
 * to the latest), plus the list of available weeks for a selector.
 */
export async function handleFanScoreResponses(req: Request, env: Env): Promise<Response> {
  let week = new URL(req.url).searchParams.get("week");
  if (!week) {
    const latest = await env.DB.prepare(`SELECT MAX(week_ending) AS w FROM fan_score_responses`).first<{
      w: string | null;
    }>();
    week = latest?.w ?? null;
  }
  if (!week) return json({ hasData: false, weeks: [], responses: [] });
  const weeks = await env.DB.prepare(
    `SELECT week_ending FROM fan_score_weeks ORDER BY week_ending DESC`,
  ).all<{ week_ending: string }>();
  const wk = await env.DB.prepare(
    `SELECT nps_tw, nps_lw, total_responses, scored_responses, promoters, passives, detractors, nps_computed
     FROM fan_score_weeks WHERE week_ending = ?`,
  )
    .bind(week)
    .first<{
      nps_tw: number | null;
      nps_lw: number | null;
      total_responses: number;
      scored_responses: number;
      promoters: number;
      passives: number;
      detractors: number;
      nps_computed: number | null;
    }>();
  const rows = await env.DB.prepare(
    `SELECT score, classification, reason FROM fan_score_responses
     WHERE week_ending = ? ORDER BY (score IS NULL), score DESC, id ASC`,
  )
    .bind(week)
    .all<{ score: number | null; classification: string | null; reason: string | null }>();
  return json({
    hasData: true,
    weekEnding: week,
    weeks: (weeks.results ?? []).map((r) => r.week_ending),
    summary: wk
      ? {
          npsTw: wk.nps_tw,
          npsLw: wk.nps_lw,
          totalResponses: wk.total_responses,
          scoredResponses: wk.scored_responses,
          promoters: wk.promoters,
          passives: wk.passives,
          detractors: wk.detractors,
          npsComputed: wk.nps_computed,
        }
      : null,
    responses: rows.results ?? [],
  });
}

// --- Trading screen: one-call period analytics (/api/trading) ---

/** First day of the month after the given YYYY-MM-01. */
function addMonth(iso: string): string {
  const p = iso.split("-");
  let y = Number(p[0]);
  let m = Number(p[1]) + 1;
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** Summary metrics over an inclusive [from,to] window (Rand). Reused for prior period. */
async function tradingSummary(
  env: Env,
  from: string,
  to: string,
): Promise<{ salesZar: number; poZar: number; grZar: number; posMarginPct: number | null; customersTy: number }> {
  const po = await env.DB.prepare(
    `SELECT COALESCE(SUM(${PURCH}),0) v FROM po_lines p WHERE p.order_date >= ? AND p.order_date <= ?`,
  ).bind(from, to).first<{ v: number }>();
  const gr = await env.DB.prepare(
    `SELECT COALESCE(SUM(cost_zar),0) v FROM gr_lines WHERE gr_date >= ? AND gr_date <= ?`,
  ).bind(from, to).first<{ v: number }>();
  const fim = await env.DB.prepare(
    `${fimResolvedCte("WITH")}
     SELECT COALESCE(SUM(net_sales_zar),0) s, COALESCE(SUM(total_cos_zar),0) c FROM fr`,
  ).bind(from, to).first<{ s: number; c: number }>();
  const cc = await env.DB.prepare(
    `SELECT COALESCE(SUM(customers_ty),0) cty FROM customer_counts WHERE cal_date >= ? AND cal_date <= ?`,
  ).bind(from, to).first<{ cty: number }>();
  const s = Number(fim?.s ?? 0);
  const c = Number(fim?.c ?? 0);
  return {
    salesZar: Math.round(s * 100) / 100,
    poZar: Math.round(Number(po?.v ?? 0)) / 100,
    grZar: Math.round(Number(gr?.v ?? 0) * 100) / 100,
    posMarginPct: s > 0 ? Math.round(((s - c) / s) * 1000) / 10 : null,
    customersTy: Number(cc?.cty ?? 0),
  };
}

/** Friendly label for [from,to]: exact fiscal week / calendar month / fiscal year, else generic. */
async function tradingLabel(env: Env, from: string, to: string): Promise<string> {
  const wk = await env.DB.prepare(
    `SELECT week_no FROM fiscal_weeks WHERE week_start = ? AND week_end = ? LIMIT 1`,
  ).bind(from, to).first<{ week_no: number }>();
  if (wk) return `${fmtRangeLabel(from, to)} (Fiscal Week ${wk.week_no})`;
  const fp = from.split("-");
  if (fp[2] === "01" && to === isoDayMinus1(addMonth(from))) return `${MONTHS[Number(fp[1]) - 1]} ${fp[0]}`;
  if (from.slice(5) === "03-01") {
    const y = Number(from.slice(0, 4));
    if (to === isoDayMinus1(`${y + 1}-03-01`)) return `FY${y + 1} (Mar ${y} – Feb ${y + 1})`;
  }
  return fmtRangeLabel(from, to);
}

/**
 * GET /api/trading?from=YYYY-MM-DD&to=YYYY-MM-DD — one-call period analytics for the
 * Trading screen: summary (FIM sales, PO, GR, POS margin, customers) with vs-prior-period
 * change (same duration immediately before), customer_counts TY/LY, FIM dept breakdown,
 * and top-10 vendors / top-20 articles by PO value. Money in Rand.
 */
export async function handleTrading(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const from = q.get("from") ?? today;
  const to = q.get("to") ?? today;
  const days = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);
  const priorTo = isoDayMinus1(from);
  const priorFrom = new Date(Date.parse(priorTo) - (days - 1) * 86_400_000).toISOString().slice(0, 10);

  const [cur, prior, label] = await Promise.all([
    tradingSummary(env, from, to),
    tradingSummary(env, priorFrom, priorTo),
    tradingLabel(env, from, to),
  ]);
  const pctChange = (a: number, b: number): number | null => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null);
  const change = {
    salesPct: pctChange(cur.salesZar, prior.salesZar),
    poPct: pctChange(cur.poZar, prior.poZar),
    grPct: pctChange(cur.grZar, prior.grZar),
    marginPp:
      cur.posMarginPct != null && prior.posMarginPct != null
        ? Math.round((cur.posMarginPct - prior.posMarginPct) * 10) / 10
        : null,
    customersPct: pctChange(cur.customersTy, prior.customersTy),
  };

  const cc = await env.DB.prepare(
    `SELECT COALESCE(SUM(customers_ty),0) cty, COALESCE(SUM(customers_ly),0) cly,
            COALESCE(SUM(sales_ty_cents),0) sty, COALESCE(SUM(sales_ly_cents),0) sly, AVG(basket_ty_cents) basket
     FROM customer_counts WHERE cal_date >= ? AND cal_date <= ?`,
  ).bind(from, to).first<{ cty: number; cly: number; sty: number; sly: number; basket: number | null }>();
  const ccTy = Number(cc?.cty ?? 0);
  const ccLy = Number(cc?.cly ?? 0);
  const ccSty = Number(cc?.sty ?? 0);
  const ccSly = Number(cc?.sly ?? 0);
  const salesMargin = {
    customersTy: ccTy,
    customersLy: ccLy,
    customersVarPct: pctChange(ccTy, ccLy),
    salesTyZar: Math.round(ccSty) / 100,
    salesLyZar: Math.round(ccSly) / 100,
    salesVarPct: pctChange(ccSty, ccSly),
    avgBasketZar: cc?.basket != null ? Math.round(cc.basket) / 100 : null,
  };

  const fimRows =
    (
      await env.DB.prepare(
        `${fimResolvedCte("WITH")}
         SELECT dept_code, MAX(dept_name) dept_name, COALESCE(SUM(net_sales_zar),0) sales,
                COALESCE(SUM(total_cos_zar),0) cos, COALESCE(SUM(waste_zar),0) waste, COALESCE(SUM(shrink_zar),0) shrink
         FROM fr GROUP BY dept_code ORDER BY sales DESC`,
      ).bind(from, to).all<{ dept_code: string; dept_name: string; sales: number; cos: number; waste: number; shrink: number }>()
    ).results ?? [];
  const fimDepts = fimRows.map((r) => {
    const s = Number(r.sales);
    const c = Number(r.cos);
    return {
      deptCode: r.dept_code,
      deptName: r.dept_name,
      salesZar: Math.round(s * 100) / 100,
      marginPct: s > 0 ? Math.round(((s - c) / s) * 1000) / 10 : null,
      wasteZar: Math.round(Number(r.waste) * 100) / 100,
      shrinkZar: Math.round(Number(r.shrink) * 100) / 100,
    };
  });

  const poGrn = await poGrnCents(env, from, to);
  const vendors =
    (
      await env.DB.prepare(
        `SELECT v.vendor_code code, v.name,
                COALESCE(SUM(${PURCH}),0) gross_cents,
                COALESCE(SUM(p.line_value_cents),0) net_cents
         FROM po_lines p JOIN vendors v ON v.id = p.vendor_id
         WHERE p.order_date >= ? AND p.order_date <= ? GROUP BY v.id ORDER BY net_cents DESC LIMIT 10`,
      ).bind(from, to).all<{ code: string; name: string; gross_cents: number; net_cents: number }>()
    ).results ?? [];
  const articles =
    (
      await env.DB.prepare(
        `SELECT a.article_code code, a.description, COALESCE(SUM(${PURCH}),0) po_cents
         FROM po_lines p JOIN articles a ON a.id = p.article_id
         WHERE p.order_date >= ? AND p.order_date <= ? GROUP BY a.id ORDER BY po_cents DESC LIMIT 20`,
      ).bind(from, to).all<{ code: string; description: string; po_cents: number }>()
    ).results ?? [];

  return json({
    period: { from, to, label, days, priorFrom, priorTo },
    summary: { ...cur, prior, change },
    // PO gross/returns/net split (Rand) — net is the headline commitment.
    po: {
      grossZar: Math.round(poGrn.grossCents) / 100,
      returnsZar: Math.round(poGrn.returnsCents) / 100,
      netZar: Math.round(poGrn.netCents) / 100,
    },
    salesMargin,
    fim: { depts: fimDepts },
    vendors: vendors.map((v) => {
      const gross = Math.round(Number(v.gross_cents)) / 100;
      const net = Math.round(Number(v.net_cents)) / 100;
      const returns = Math.round(net * 100 - gross * 100) / 100;
      return {
        code: v.code,
        name: v.name,
        poZar: net, // backward-compat: poZar now = net
        grossZar: gross,
        returnsZar: returns,
        netZar: net,
        highReturnRate: gross > 0 && -returns / gross > 0.05,
      };
    }),
    articles: articles.map((a) => ({ code: a.code, description: a.description, poZar: Math.round(Number(a.po_cents)) / 100 })),
  });
}

// --- Budget generator + cash-flow risk (compute-on-demand flags) ---

interface CashFlag {
  weekCode: string;
  isSalaryWeek: boolean;
  isCreditorWeek: boolean;
  severity: "CRITICAL" | "HIGH" | null;
  flagType: "SALARY_AND_CREDITOR" | "CREDITOR" | "SALARY" | null;
  badges: string[];
  title: string | null;
  message: string | null;
}

/**
 * Cash-flow risk flags for the given fiscal week codes, derived live from the calendar:
 *  - salary week  = the last fiscal week of each calendar month (max week_end per cal_month).
 *  - creditor week = the statement-due week of each fiscal-period-final week (the monthly
 *    PnP corporate settlement — the "large payment").
 * CRITICAL when both coincide; HIGH for either alone.
 */
async function cashFlowFlags(env: Env, weekCodes: string[]): Promise<Map<string, CashFlag>> {
  const salaryRows =
    (
      await env.DB.prepare(
        `SELECT fw.fiscal_week_code c FROM fiscal_weeks fw
         JOIN (SELECT cal_month, MAX(week_end) mx FROM fiscal_weeks GROUP BY cal_month) s
           ON s.cal_month = fw.cal_month AND s.mx = fw.week_end`,
      ).all<{ c: string }>()
    ).results ?? [];
  const creditorRows =
    (
      await env.DB.prepare(
        `SELECT fw.statement_due_week c FROM fiscal_weeks fw
         JOIN (SELECT fiscal_period_code, MAX(week_no) mxw FROM fiscal_weeks GROUP BY fiscal_period_code) p
           ON p.fiscal_period_code = fw.fiscal_period_code AND p.mxw = fw.week_no
         WHERE fw.statement_due_week IS NOT NULL`,
      ).all<{ c: string }>()
    ).results ?? [];
  const salarySet = new Set(salaryRows.map((r) => r.c));
  const creditorSet = new Set(creditorRows.map((r) => r.c));
  const map = new Map<string, CashFlag>();
  for (const wc of weekCodes) {
    const sal = salarySet.has(wc);
    const cred = creditorSet.has(wc);
    const badges: string[] = [];
    if (cred) badges.push("WEEK 5");
    if (sal) badges.push("SALARY WEEK");
    let severity: CashFlag["severity"] = null;
    let flagType: CashFlag["flagType"] = null;
    let title: string | null = null;
    let message: string | null = null;
    if (sal && cred) {
      severity = "CRITICAL";
      flagType = "SALARY_AND_CREDITOR";
      title = "CRITICAL CASH FLOW RISK THIS WEEK";
      message = "Staff salaries + creditor payment due simultaneously. Monitor cash daily.";
    } else if (cred) {
      severity = "HIGH";
      flagType = "CREDITOR";
      title = "WEEK 5 — CREDITOR PAYMENT DUE";
      message = "Large PnP corporate payment expected. Consider reducing PO spend this week.";
    } else if (sal) {
      severity = "HIGH";
      flagType = "SALARY";
      title = "SALARY WEEK — CASH TIMING RISK";
      message = "Salaries out before card receipts clear. Ensure overdraft facility available.";
    }
    map.set(wc, { weekCode: wc, isSalaryWeek: sal, isCreditorWeek: cred, severity, flagType, badges, title, message });
  }
  return map;
}

/** GET /api/cash-flow-flags?weeks=N — flags for the next N fiscal weeks (default 8, incl current). */
export async function handleCashFlowFlags(req: Request, env: Env): Promise<Response> {
  const n = Math.min(Math.max(Number(new URL(req.url).searchParams.get("weeks") ?? "8"), 1), 52);
  const fw =
    (
      await env.DB.prepare(
        `SELECT fiscal_week_code, week_no, week_start, week_end FROM fiscal_weeks
         WHERE week_end >= date('now') ORDER BY week_start LIMIT ?`,
      ).bind(n).all<{ fiscal_week_code: string; week_no: number; week_start: string; week_end: string }>()
    ).results ?? [];
  const flags = await cashFlowFlags(env, fw.map((w) => w.fiscal_week_code));
  return json({
    weeks: fw.map((w) => ({
      ...(flags.get(w.fiscal_week_code) as CashFlag),
      weekNo: w.week_no,
      weekStart: w.week_start,
      weekEnding: w.week_end,
    })),
  });
}

/** Round to the nearest `step` (Rand). step<=0 → no rounding. */
function roundTo(v: number, step: number): number {
  if (!Number.isFinite(v)) return 0;
  if (!step || step <= 0) return Math.round(v);
  return Math.round(v / step) * step;
}

/** One budget-suggestion level (store or a department) from LY sales/cos + assumptions. */
function suggestLevel(
  lySalesZar: number,
  lyCosZar: number,
  growthPct: number,
  coverPct: number,
  safetyPct: number,
  step: number,
  isCreditorWeek: boolean,
) {
  const lyMarginPct = lySalesZar > 0 ? Math.round(((lySalesZar - lyCosZar) / lySalesZar) * 1000) / 10 : null;
  const expectedTyZar = lySalesZar * (1 + growthPct / 100);
  const suggestedSalesZar = roundTo(expectedTyZar, step);
  const marginFrac = lyMarginPct != null ? lyMarginPct / 100 : 0.2; // default 20% when no LY margin
  const requiredCosZar = suggestedSalesZar * (1 - marginFrac);
  const bufferStockZar = requiredCosZar * (coverPct / 100);
  const suggestedGrZar = roundTo(requiredCosZar + bufferStockZar, step);
  const suggestedPoZar = roundTo(suggestedGrZar * (1 + safetyPct / 100), step);
  const adjustedPoZar = isCreditorWeek ? roundTo(suggestedPoZar * 0.85, step) : null;
  return {
    lySalesZar: Math.round(lySalesZar),
    expectedTyZar: Math.round(expectedTyZar),
    suggestedSalesZar,
    lyMarginPct,
    requiredCosZar: Math.round(requiredCosZar),
    bufferStockZar: Math.round(bufferStockZar),
    suggestedGrZar,
    suggestedPoZar,
    adjustedPoZar,
  };
}

/**
 * GET /api/budgets/suggest?baseYear=&salesGrowthPct=&stockCoverPct=&poSafetyPct=&fromWeek=&toWeek=&roundTo=
 * Suggested Sales/GR/PO budgets per fiscal week (store + F04/F06/F09) from base-year FIM
 * actuals + assumptions. LY weekly sales are taken from FIM overlapping the matching
 * base-year week, day-prorated (exact for weekly FIM, proportional for monthly). Read-only.
 */
export async function handleBudgetsSuggest(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const baseYear = Number(String(q.get("baseYear") ?? "").replace(/[^\d]/g, "")) || 2026;
  const growthPct = Number(q.get("salesGrowthPct") ?? "5") || 0;
  const coverPct = Number(q.get("stockCoverPct") ?? "20") || 0;
  const safetyPct = Number(q.get("poSafetyPct") ?? "5") || 0;
  const step = Number(q.get("roundTo") ?? "1000") || 0;

  // Target weeks: [fromWeek,toWeek] by fiscal_week_code, else next 13 from today.
  const fromWeek = q.get("fromWeek");
  const toWeek = q.get("toWeek");
  const targets =
    fromWeek && toWeek
      ? (
          await env.DB.prepare(
            `SELECT fiscal_week_code, week_no, week_start, week_end FROM fiscal_weeks
             WHERE fiscal_week_code >= ? AND fiscal_week_code <= ? ORDER BY week_start`,
          ).bind(fromWeek, toWeek).all<{ fiscal_week_code: string; week_no: number; week_start: string; week_end: string }>()
        ).results ?? []
      : (
          await env.DB.prepare(
            `SELECT fiscal_week_code, week_no, week_start, week_end FROM fiscal_weeks
             WHERE week_end >= date('now') ORDER BY week_start LIMIT 13`,
          ).all<{ fiscal_week_code: string; week_no: number; week_start: string; week_end: string }>()
        ).results ?? [];

  // Base-year weeks by week_no (for LY mapping).
  const baseWeeks =
    (
      await env.DB.prepare(
        `SELECT week_no, week_start, week_end FROM fiscal_weeks WHERE fiscal_year = ?`,
      ).bind(baseYear).all<{ week_no: number; week_start: string; week_end: string }>()
    ).results ?? [];
  const baseByNo = new Map(baseWeeks.map((b) => [b.week_no, b]));

  const flags = await cashFlowFlags(env, targets.map((t) => t.fiscal_week_code));
  const DEPTS = BUDGET_DEPTS;

  const out = [];
  for (const t of targets) {
    const base = baseByNo.get(t.week_no);
    const cf = flags.get(t.fiscal_week_code)!;
    // Day-prorated FIM over the base week, grouped by dept.
    let deptRows: { dept_code: string; s: number; c: number }[] = [];
    if (base) {
      deptRows =
        (
          await env.DB.prepare(
            `SELECT dept_code,
                    COALESCE(SUM(net_sales_zar * (julianday(min(date_to, ?2)) - julianday(max(date_from, ?1)) + 1)
                                 / (julianday(date_to) - julianday(date_from) + 1)),0) s,
                    COALESCE(SUM(total_cos_zar * (julianday(min(date_to, ?2)) - julianday(max(date_from, ?1)) + 1)
                                 / (julianday(date_to) - julianday(date_from) + 1)),0) c
             FROM fim_daily
             WHERE dept_code != 'TOTAL' AND date_from <= ?2 AND date_to >= ?1
             GROUP BY dept_code`,
          ).bind(base.week_start, base.week_end).all<{ dept_code: string; s: number; c: number }>()
        ).results ?? [];
    }
    const storeS = deptRows.reduce((a, r) => a + Number(r.s), 0);
    const storeC = deptRows.reduce((a, r) => a + Number(r.c), 0);
    const store = suggestLevel(storeS, storeC, growthPct, coverPct, safetyPct, step, cf.isCreditorWeek);
    const depts = DEPTS.map((d) => {
      const r = deptRows.find((x) => x.dept_code === d.code);
      const lvl = suggestLevel(Number(r?.s ?? 0), Number(r?.c ?? 0), growthPct, coverPct, safetyPct, step, cf.isCreditorWeek);
      return { code: d.code, name: d.name, ...lvl };
    });
    out.push({
      weekCode: t.fiscal_week_code,
      weekNo: t.week_no,
      weekEnding: t.week_end,
      weekStart: t.week_start,
      baseWeek: base ? { weekStart: base.week_start, weekEnding: base.week_end } : null,
      store,
      depts,
      cashFlowFlags: cf.severity ? [cf] : [],
    });
  }
  return json({
    params: { baseYear, growthPct, coverPct, safetyPct, roundTo: step },
    weeks: out,
  });
}

/**
 * GET /api/creditor-payments?weeks=N — upcoming PnP statement payments + salary outflow +
 * cash-flow risk for the next N fiscal weeks (default 8). Est. creditor payment = purchases
 * from the trading week whose statement falls due this week. Salary out = monthly_salary_zar
 * (app setting) on salary weeks. netCashRisk = the cash-flow flag severity.
 */
export async function handleCreditorPayments(req: Request, env: Env): Promise<Response> {
  const n = Math.min(Math.max(Number(new URL(req.url).searchParams.get("weeks") ?? "8"), 1), 52);
  const salRow = await env.DB.prepare(`SELECT value FROM app_settings WHERE key='monthly_salary_zar'`).first<{ value: string }>();
  const monthlySalaryZar = salRow?.value != null && salRow.value !== "" ? Number(salRow.value) : null;

  const fw =
    (
      await env.DB.prepare(
        `SELECT fiscal_week_code, week_no, week_start, week_end FROM fiscal_weeks
         WHERE week_end >= date('now') ORDER BY week_start LIMIT ?`,
      ).bind(n).all<{ fiscal_week_code: string; week_no: number; week_start: string; week_end: string }>()
    ).results ?? [];
  const flags = await cashFlowFlags(env, fw.map((w) => w.fiscal_week_code));

  const weeks = [];
  for (const w of fw) {
    // Trading week(s) whose statement is due in this week → estimate the payment from their PO purchases.
    const trade = await env.DB.prepare(
      `SELECT COALESCE(SUM(${PURCH}),0) v FROM po_lines p
       WHERE p.order_date >= (SELECT MIN(week_start) FROM fiscal_weeks WHERE statement_due_week = ?1)
         AND p.order_date <= (SELECT MAX(week_end) FROM fiscal_weeks WHERE statement_due_week = ?1)`,
    ).bind(w.fiscal_week_code).first<{ v: number }>();
    const cf = flags.get(w.fiscal_week_code)!;
    const estCreditorPmtZar = cf.isCreditorWeek ? Math.round(Number(trade?.v ?? 0)) / 100 : 0;
    const salaryOutZar = cf.isSalaryWeek ? monthlySalaryZar : null;
    weeks.push({
      weekCode: w.fiscal_week_code,
      weekNo: w.week_no,
      weekEnding: w.week_end,
      flags: cf.badges,
      severity: cf.severity,
      estCreditorPmtZar,
      salaryOutZar,
      netCashRisk: cf.severity ?? "—",
    });
  }
  return json({ monthlySalaryZar, weeks });
}

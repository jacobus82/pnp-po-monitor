/**
 * Statement analytics (Brief 6) — payments due, balance/funding trends, credit
 * decomposition, fixed-charge & swell-by-dept tracking, and a line-level browser.
 *
 * Data model (migration 0017): `statements` (one per weekly PnP account statement,
 * statement_no = fiscal-week code) + `statement_lines` (typed detail). Money is
 * REAL Rand; debits positive, credits/payments negative. Only a handful of weeks
 * carry PRINTED opening/closing balances, so the balance trend is chained from
 * those anchors: closing = opening + Σ(all line amounts); adjacent weeks tie
 * closing(prev) == opening(next).
 */
import { type Env } from "./config";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// line_type → credit-decomposition bucket (Brief 6 §3).
function creditBucket(t: string): string | null {
  switch (t) {
    case "SWELL": return "swell";
    case "BONUS_BUY": return "bonusBuy";
    case "REBATE": return "rebate"; // Sally / Tally
    case "LOYALTY": return "loyalty";
    case "PROMO":
    case "FUNDING": return "promoFunding";
    case "CREDIT_NOTE":
    case "INVOICE_REDUCTION": return "otherCredit";
    default: return null;
  }
}
const CREDIT_BUCKETS = ["swell", "bonusBuy", "rebate", "loyalty", "promoFunding", "otherCredit"] as const;

interface StmtHdr {
  statement_no: string; period_start: string; cut_off: string; due_date: string;
  total_due: number; payment: number; opening_balance: number | null; closing_balance: number | null; source: string;
}

/** Chain balances from printed anchors: closing = opening + net; adjacent weeks tie. */
function deriveBalances(list: (StmtHdr & { net: number; balanceSource: string })[]): void {
  const iso = (d: string, add: number) => {
    const t = Date.parse(d + "T00:00:00Z") + add * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  };
  const contig = (prev: StmtHdr, cur: StmtHdr) => cur.period_start === iso(prev.cut_off, 1);
  for (const r of list) {
    if (r.opening_balance != null || r.closing_balance != null) {
      r.balanceSource = "PRINTED";
      if (r.opening_balance != null && r.closing_balance == null) r.closing_balance = r2(r.opening_balance + r.net);
      if (r.closing_balance != null && r.opening_balance == null) r.opening_balance = r2(r.closing_balance - r.net);
    } else r.balanceSource = "UNKNOWN";
  }
  for (let guard = 0; guard <= list.length; guard++) {
    let changed = false;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!, cur = list[i]!;
      if (contig(prev, cur) && prev.closing_balance != null && cur.opening_balance == null) {
        cur.opening_balance = prev.closing_balance; cur.closing_balance = r2(cur.opening_balance + cur.net);
        cur.balanceSource = "DERIVED"; changed = true;
      }
    }
    for (let i = list.length - 2; i >= 0; i--) {
      const cur = list[i]!, next = list[i + 1]!;
      if (contig(cur, next) && next.opening_balance != null && cur.closing_balance == null) {
        cur.closing_balance = next.opening_balance; cur.opening_balance = r2(cur.closing_balance - cur.net);
        cur.balanceSource = "DERIVED"; changed = true;
      }
    }
    if (!changed) break;
  }
}

/**
 * GET /api/statements/dashboard — one call powering the statement dashboard:
 * payments-due (next / schedule / overdue), balance & funding-rate trends, credit
 * decomposition by type (weekly), fixed charges (franchise/loyalty by month),
 * swell-by-department with completeness flags, and the interest trend.
 */
export async function handleStatementDashboard(env: Env): Promise<Response> {
  const today = (await env.DB.prepare(`SELECT date('now') d`).first<{ d: string }>())?.d ?? "";

  const [hdrRes, lineAgg, dcRes, swellRes, fixedRes, intRes] = await Promise.all([
    env.DB.prepare(
      `SELECT statement_no, period_start, cut_off, due_date, total_due, payment,
              opening_balance, closing_balance, source
       FROM statements ORDER BY cut_off ASC, statement_no ASC`,
    ).all<StmtHdr>(),
    // Per-statement credit BUCKETS by line_type (for the decomposition chart).
    env.DB.prepare(
      `SELECT statement_no, line_type, ROUND(SUM(amount),2) amt, COUNT(*) n
       FROM statement_lines GROUP BY statement_no, line_type`,
    ).all<{ statement_no: string; line_type: string; amt: number; n: number }>(),
    // Purchases (INVOICE debits) + total credits (all negative non-payment lines),
    // computed at LINE level so negatives hidden inside net-positive types count.
    env.DB.prepare(
      `SELECT statement_no,
              ROUND(COALESCE(SUM(CASE WHEN line_type='INVOICE' AND amount>0 THEN amount END),0),2) purchases,
              ROUND(COALESCE(SUM(CASE WHEN amount>0 THEN amount END),0),2) debits,
              ROUND(COALESCE(SUM(CASE WHEN amount<0 AND line_type!='PAYMENT' THEN amount END),0),2) credits
       FROM statement_lines GROUP BY statement_no`,
    ).all<{ statement_no: string; purchases: number; debits: number; credits: number }>(),
    // Swell per (statement, dept) — dept parsed from "*1.500% F05 Swell MA15".
    env.DB.prepare(
      `SELECT statement_no,
              substr(vendor_text, instr(vendor_text,'% ')+2, 3) dept,
              ROUND(SUM(amount),2) amt
       FROM statement_lines WHERE line_type='SWELL' AND vendor_text LIKE '*%'
       GROUP BY statement_no, dept`,
    ).all<{ statement_no: string; dept: string; amt: number }>(),
    // Fixed charges by month: FRANCHISE_FEE (debit) + LOYALTY (credit).
    env.DB.prepare(
      `SELECT substr(s.cut_off,1,7) ym, l.line_type,
              ROUND(SUM(l.amount),2) amt
       FROM statement_lines l JOIN statements s ON s.statement_no=l.statement_no
       WHERE l.line_type IN ('FRANCHISE_FEE','LOYALTY')
       GROUP BY ym, l.line_type ORDER BY ym`,
    ).all<{ ym: string; line_type: string; amt: number }>(),
    // Interest lines — should be zero; surface any value as a flag.
    env.DB.prepare(
      `SELECT s.statement_no, s.cut_off, ROUND(SUM(l.amount),2) amt
       FROM statement_lines l JOIN statements s ON s.statement_no=l.statement_no
       WHERE lower(l.vendor_text) LIKE '%interest%'
       GROUP BY s.statement_no ORDER BY s.cut_off`,
    ).all<{ statement_no: string; cut_off: string; amt: number }>(),
  ]);

  const hdrs = hdrRes.results ?? [];
  // Index the aggregates per statement: line-level purchases/debits/credits + buckets.
  const byStmt = new Map<string, { purchases: number; debits: number; credits: number; buckets: Record<string, number> }>();
  for (const h of hdrs) byStmt.set(h.statement_no, { purchases: 0, debits: 0, credits: 0, buckets: {} });
  for (const d of dcRes.results ?? []) {
    const e = byStmt.get(d.statement_no); if (!e) continue;
    e.purchases = d.purchases; e.debits = d.debits; e.credits = d.credits;
  }
  for (const l of lineAgg.results ?? []) {
    const e = byStmt.get(l.statement_no); if (!e) continue;
    const b = creditBucket(l.line_type);
    if (b) e.buckets[b] = r2((e.buckets[b] ?? 0) + l.amt);
  }
  const swellByStmt = new Map<string, Record<string, number>>();
  for (const s of swellRes.results ?? []) {
    if (!s.dept || !/^[A-Z]\d/.test(s.dept)) continue;
    const m = swellByStmt.get(s.statement_no) ?? {};
    m[s.dept] = s.amt; swellByStmt.set(s.statement_no, m);
  }

  // Weekly series (oldest→newest) with the derived balance chain.
  const chain = hdrs.map((h) => ({ ...h, net: r2(h.total_due + h.payment), balanceSource: "UNKNOWN" }));
  deriveBalances(chain);
  const weekly = chain.map((h) => {
    const agg = byStmt.get(h.statement_no)!;
    const { purchases, debits, credits } = agg; // credits negative
    return {
      code: h.statement_no, weekStart: h.period_start, cutOff: h.cut_off, dueDate: h.due_date,
      totalDue: r2(h.total_due), payment: r2(h.payment),
      purchases, debits, credits,
      // Funding rate = credits recovered as a % of purchases (invoices).
      fundingRatePct: purchases > 0 ? r2((-credits / purchases) * 100) : null,
      closing: h.closing_balance, opening: h.opening_balance, balanceSource: h.balanceSource,
      buckets: Object.fromEntries(CREDIT_BUCKETS.map((b) => [b, r2(agg.buckets[b] ?? 0)])),
      swellByDept: swellByStmt.get(h.statement_no) ?? {},
    };
  });

  // ---- Payments due: obligation = total_due on due_date; PAID when a LATER
  // statement carries a payment line == total_due within R1. ----
  const paymentsRes = await env.DB.prepare(
    `SELECT statement_no, ROUND(amount,2) amt FROM statement_lines WHERE line_type='PAYMENT'`,
  ).all<{ statement_no: string; amt: number }>();
  const payments = (paymentsRes.results ?? []).map((p) => ({ ...p, mag: Math.abs(p.amt) }));
  const cutOrder = new Map(hdrs.map((h, i) => [h.statement_no, i]));

  // Exact-match paid attribution (verifiable: 202711's due appears as 202716's
  // payment). Kept for the "paid via" label, but NOT used alone to judge overdue —
  // PnP also settles via round lump sums that match no single total_due.
  const paidOnOf = (h: StmtHdr): string | null => {
    const idx = cutOrder.get(h.statement_no)!;
    const m = payments.find((p) => Math.abs(p.mag - h.total_due) <= 1 && (cutOrder.get(p.statement_no) ?? -1) > idx);
    return m?.statement_no ?? null;
  };

  // FIFO settlement reconciliation: payments clear the OLDEST dues first, so the
  // true outstanding set is the most-recent statements whose cumulative dues exceed
  // total payments received (this equals the current account balance and prevents
  // lump-sum-paid old statements from showing as false overdue).
  const totalPaid = payments.reduce((s, p) => s + p.mag, 0);
  let cumDue = 0;
  const schedule: Array<Record<string, unknown>> = [];
  const overdue: Array<Record<string, unknown>> = [];
  for (const h of hdrs) {
    if (!(h.total_due > 0)) continue;
    cumDue += h.total_due;
    if (cumDue <= totalPaid + 1) continue; // covered by cumulative payments → settled
    const row = { code: h.statement_no, dueDate: h.due_date, totalDue: r2(h.total_due), paidOn: paidOnOf(h), status: "" as string };
    if (h.due_date < today) { row.status = "OVERDUE"; overdue.push(row); }
    else { row.status = "UPCOMING"; schedule.push(row); }
  }
  schedule.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  overdue.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  // Next payment = the latest statement's obligation (the newest bill to settle).
  const latest = hdrs[hdrs.length - 1];
  const next = latest && latest.total_due > 0
    ? { code: latest.statement_no, dueDate: latest.due_date, totalDue: r2(latest.total_due) }
    : (schedule[0] ?? null);
  const totalOverdue = r2(overdue.reduce((s, r) => s + Number(r.totalDue), 0));
  const totalOutstanding = r2(schedule.concat(overdue).reduce((s, r) => s + Number(r.totalDue), 0));

  // ---- Fixed charges by month ----
  const fixedByMonth = new Map<string, { franchiseFee: number; loyalty: number }>();
  for (const f of fixedRes.results ?? []) {
    const e = fixedByMonth.get(f.ym) ?? { franchiseFee: 0, loyalty: 0 };
    if (f.line_type === "FRANCHISE_FEE") e.franchiseFee = f.amt; else e.loyalty = f.amt;
    fixedByMonth.set(f.ym, e);
  }
  const fixedCharges = [...fixedByMonth.entries()].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month.localeCompare(b.month));

  // ---- Swell completeness: depts that normally appear, flag weeks missing one ----
  const deptFreq = new Map<string, number>();
  for (const w of weekly) for (const d of Object.keys(w.swellByDept)) deptFreq.set(d, (deptFreq.get(d) ?? 0) + 1);
  const swellWeeks = weekly.filter((w) => Object.keys(w.swellByDept).length > 0).length;
  const expectedDepts = [...deptFreq.entries()].filter(([, c]) => c >= swellWeeks * 0.5).map(([d]) => d).sort();
  const swellGaps: Array<{ week: string; missing: string[] }> = [];
  for (const w of weekly) {
    if (!Object.keys(w.swellByDept).length) continue; // no swell block that week at all
    const missing = expectedDepts.filter((d) => !(d in w.swellByDept));
    if (missing.length) swellGaps.push({ week: w.code, missing });
  }

  const interest = (intRes.results ?? []).map((i) => ({ code: i.statement_no, week: i.cut_off, amount: i.amt }));

  return json({
    today,
    latest: weekly[weekly.length - 1] ?? null,
    payments: { next, schedule, overdue, totalOverdue, totalOutstanding },
    weekly,
    creditBuckets: CREDIT_BUCKETS,
    fixedCharges,
    swell: { expectedDepts, gaps: swellGaps, weeks: weekly.map((w) => ({ code: w.code, weekStart: w.weekStart, byDept: w.swellByDept })).filter((w) => Object.keys(w.byDept).length) },
    interest,
  });
}

/**
 * Shared payments-due computation (same FIFO reconciliation as the statement
 * dashboard) for reuse by the Weekly Operating Brief. Returns the next PnP
 * obligation, the unpaid schedule, and overdue — all from `statements`.
 */
export async function computePaymentsDue(env: Env): Promise<{
  next: { code: string; dueDate: string; totalDue: number } | null;
  schedule: Array<{ code: string; dueDate: string; totalDue: number; status: string }>;
  overdue: Array<{ code: string; dueDate: string; totalDue: number }>;
  totalOverdue: number;
  totalOutstanding: number;
}> {
  const today = (await env.DB.prepare(`SELECT date('now') d`).first<{ d: string }>())?.d ?? "";
  const [hdrRes, payRes] = await Promise.all([
    env.DB.prepare(`SELECT statement_no, cut_off, due_date, total_due FROM statements ORDER BY cut_off ASC, statement_no ASC`).all<{ statement_no: string; cut_off: string; due_date: string; total_due: number }>(),
    env.DB.prepare(`SELECT ROUND(ABS(amount),2) mag FROM statement_lines WHERE line_type='PAYMENT'`).all<{ mag: number }>(),
  ]);
  const hdrs = hdrRes.results ?? [];
  const totalPaid = (payRes.results ?? []).reduce((s, p) => s + p.mag, 0);
  let cumDue = 0;
  const schedule: Array<{ code: string; dueDate: string; totalDue: number; status: string }> = [];
  const overdue: Array<{ code: string; dueDate: string; totalDue: number }> = [];
  for (const h of hdrs) {
    if (!(h.total_due > 0)) continue;
    cumDue += h.total_due;
    if (cumDue <= totalPaid + 1) continue; // settled by cumulative payments (FIFO)
    if (h.due_date < today) overdue.push({ code: h.statement_no, dueDate: h.due_date, totalDue: r2(h.total_due) });
    else schedule.push({ code: h.statement_no, dueDate: h.due_date, totalDue: r2(h.total_due), status: "UPCOMING" });
  }
  overdue.forEach((o) => schedule.push({ ...o, status: "OVERDUE" }));
  schedule.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const latest = hdrs[hdrs.length - 1];
  const next = latest && latest.total_due > 0 ? { code: latest.statement_no, dueDate: latest.due_date, totalDue: r2(latest.total_due) } : null;
  return {
    next, schedule, overdue: overdue.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    totalOverdue: r2(overdue.reduce((s, o) => s + o.totalDue, 0)),
    totalOutstanding: r2(schedule.reduce((s, o) => s + o.totalDue, 0)),
  };
}

/**
 * GET /api/statements/lines?statement=&from=&to=&type=&vendor=&q=&sort=&dir=
 * Line-level browser: filter by statement / cut-off range / line_type / vendor /
 * free text, sortable, with per-type subtotals. The charts drill into this.
 */
export async function handleStatementBrowse(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  const stmt = q.get("statement");
  if (stmt) { where.push("l.statement_no = ?"); binds.push(stmt); }
  if (q.get("from")) { where.push("s.cut_off >= ?"); binds.push(q.get("from")); }
  if (q.get("to")) { where.push("s.cut_off <= ?"); binds.push(q.get("to")); }
  if (q.get("type")) { where.push("l.line_type = ?"); binds.push(q.get("type")); }
  if (q.get("vendor")) { where.push("(l.vendor_no = ? OR l.vendor_name LIKE ?)"); binds.push(q.get("vendor"), `%${q.get("vendor")}%`); }
  if (q.get("q")) { where.push("(l.vendor_text LIKE ? OR l.reference LIKE ? OR l.doc_number LIKE ? OR l.vendor_name LIKE ?)"); const t = `%${q.get("q")}%`; binds.push(t, t, t, t); }
  const wsql = where.length ? "WHERE " + where.join(" AND ") : "";

  const sortCol = ({ amount: "l.amount", type: "l.line_type", date: "s.cut_off", doc: "l.doc_number", vendor: "l.vendor_name" } as Record<string, string>)[q.get("sort") ?? "date"] ?? "s.cut_off";
  const dir = (q.get("dir") ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";
  const limit = Math.min(Number(q.get("limit") ?? "500"), 3000);

  const [rows, subtotals] = await Promise.all([
    env.DB.prepare(
      `SELECT l.statement_no, s.cut_off, l.doc_number, l.line_type, l.reference, l.vendor_text,
              l.vendor_no, l.vendor_name, ROUND(l.amount,2) amount
       FROM statement_lines l JOIN statements s ON s.statement_no=l.statement_no
       ${wsql} ORDER BY ${sortCol} ${dir}, l.id ASC LIMIT ?`,
    ).bind(...binds, limit).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT l.line_type, COUNT(*) n, ROUND(SUM(l.amount),2) amt
       FROM statement_lines l JOIN statements s ON s.statement_no=l.statement_no
       ${wsql} GROUP BY l.line_type ORDER BY amt`,
    ).bind(...binds).all<{ line_type: string; n: number; amt: number }>(),
  ]);

  const subs = subtotals.results ?? [];
  return json({
    filters: { statement: stmt, from: q.get("from"), to: q.get("to"), type: q.get("type"), vendor: q.get("vendor"), q: q.get("q"), sort: q.get("sort") ?? "date", dir },
    lines: rows.results ?? [],
    subtotals: subs,
    total: r2(subs.reduce((s, r) => s + Number(r.amt), 0)),
    lineCount: subs.reduce((s, r) => s + Number(r.n), 0),
  });
}

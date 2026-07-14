/**
 * Weekly Operating Brief (Brief 7 §2) — one screen assembling the week's numbers
 * across Trading / Loss / Money-out / Money-back / Watch, with each section flagged
 * when the feeds it needs are incomplete (never partial-as-total). Every figure in
 * the UI drills to its source screen; this endpoint supplies the values + the
 * source hints. Default week = the last completed fiscal week.
 */
import { type Env } from "./config";
import { computePaymentsDue } from "./statements-analytics";
import { weekCoverage } from "./coverage";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
const r0 = (n: number) => Math.round(n);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const WASTE_THRESHOLD = 2, SHRINK_THRESHOLD = 2;

interface FweekRow { fiscal_week_code: string; week_start: string; week_end: string; fiscal_year: number; week_no: number; }

/** Resolved FIM per-dept aggregates over [from,to] (finest report_type per day). */
async function fimByDept(env: Env, from: string, to: string) {
  const res = await env.DB.prepare(
    `WITH RECURSIVE _days(d) AS (SELECT ?1 UNION ALL SELECT date(d,'+1 day') FROM _days WHERE d < ?2),
      _c AS (
        SELECT _days.d day, f.dept_code, MAX(f.dept_name) OVER (PARTITION BY f.dept_code) nm,
               (julianday(f.date_to)-julianday(f.date_from)+1) span,
               f.net_sales_zar ns, f.total_cos_zar cos, f.waste_zar wst, f.shrink_zar shr,
               ROW_NUMBER() OVER (PARTITION BY _days.d, f.dept_code
                 ORDER BY (julianday(f.date_to)-julianday(f.date_from)) ASC,
                          CASE f.report_type WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END) rn
        FROM _days JOIN fim_daily f ON f.dept_code!='TOTAL' AND f.date_from<=_days.d AND f.date_to>=_days.d)
     SELECT dept_code, MAX(nm) dept_name, ROUND(SUM(ns/span)) sales, ROUND(SUM(cos/span)) cos,
            ROUND(SUM(wst/span)) waste, ROUND(SUM(shr/span)) shrink
     FROM _c WHERE rn=1 GROUP BY dept_code`,
  ).bind(from, to).all<{ dept_code: string; dept_name: string; sales: number; cos: number; waste: number; shrink: number }>();
  return res.results ?? [];
}

export async function handleWeeklyBrief(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const growthPct = Number(q.get("growthPct") ?? "5") || 0;
  const marginRow = await env.DB.prepare(`SELECT value FROM app_settings WHERE key='target_gp_pct'`).first<{ value: string }>();
  const requiredMarginPct = Number(q.get("marginPct") ?? marginRow?.value ?? "20") || 0;

  // Resolve week: ?week= or the last COMPLETED fiscal week (week_end < today).
  const wanted = q.get("week");
  const target = wanted
    ? await env.DB.prepare(`SELECT fiscal_week_code, week_start, week_end, fiscal_year, week_no FROM fiscal_weeks WHERE fiscal_week_code=?`).bind(wanted).first<FweekRow>()
    : await env.DB.prepare(`SELECT fiscal_week_code, week_start, week_end, fiscal_year, week_no FROM fiscal_weeks WHERE week_end < date('now') ORDER BY week_end DESC LIMIT 1`).first<FweekRow>();
  if (!target) return json({ error: "No fiscal week found." }, 404);
  const { fiscal_week_code: code, week_start: ws, week_end: we } = target;

  const ly = await env.DB.prepare(`SELECT fiscal_week_code, week_start, week_end FROM fiscal_weeks WHERE fiscal_year=? AND week_no=?`).bind(target.fiscal_year - 1, target.week_no).first<{ fiscal_week_code: string; week_start: string; week_end: string }>();

  // Fetch the independent pieces concurrently.
  const [coverage, fim, lyFim, budgetRows, payments, vencorRes, claimsRow, uninvRow, returnsRow, fanRow, interestRow, anomRow, trendRes] = await Promise.all([
    weekCoverage(env, code, ws, we),
    fimByDept(env, ws, we),
    ly ? fimByDept(env, ly.week_start, ly.week_end) : Promise.resolve([]),
    env.DB.prepare(`SELECT budget_type, department, sales_budget_zar FROM weekly_budgets WHERE week_code=?`).bind(code).all<{ budget_type: string; department: string; sales_budget_zar: number | null }>(),
    computePaymentsDue(env),
    // Vencor / meat GR due within 14 days (14-day terms from gr_date).
    env.DB.prepare(
      `SELECT g.gr_date grDate, date(g.gr_date, '+' || ?1 || ' days') dueDate,
              ROUND(COALESCE(SUM(g.cost_zar),0),2) val, MAX(v.name) vendorName
       FROM gr_lines g LEFT JOIN po_lines p ON p.po_number=g.po_number LEFT JOIN vendors v ON v.id=p.vendor_id
       WHERE (LOWER(COALESCE(v.name,'')) LIKE '%vencor%' OR LOWER(COALESCE(v.name,'')) LIKE '%meat%'
              OR substr(g.dept_code, instr(g.dept_code,'/')+1) IN ('F09','F04'))
         AND g.gr_date IS NOT NULL AND date(g.gr_date,'+' || ?1 || ' days') >= date('now')
         AND date(g.gr_date,'+' || ?1 || ' days') <= date('now','+14 days')
       GROUP BY g.gr_date HAVING val>0 ORDER BY dueDate`,
    ).bind(String((await env.DB.prepare(`SELECT value FROM app_settings WHERE key='vencor_terms_days'`).first<{ value: string }>())?.value ?? "14")).all<{ grDate: string; dueDate: string; val: number; vendorName: string | null }>(),
    // Money back — confirmed overbilled claims (single-GR-row, beyond tol, store-wide).
    env.DB.prepare(`SELECT COUNT(*) n, ROUND(SUM(-variance_zar),2) total FROM settlement_ledger WHERE side='eod' AND gr_count=1 AND variance_zar<0 AND ABS(variance_zar)>(CASE WHEN is_direct=1 THEN 5 ELSE 2000 END)`).first<{ n: number; total: number }>(),
    // Uninvoiced GR aged > 14 days.
    env.DB.prepare(`SELECT COUNT(*) n, ROUND(SUM(eod_gr_total),2) total FROM settlement_ledger WHERE side='eod' AND status IN ('OPEN','AGED') AND aging_days>14`).first<{ n: number; total: number }>(),
    // Returns without credit.
    env.DB.prepare(`SELECT COUNT(*) n, ROUND(SUM(-return_value),2) total FROM return_credits WHERE status!='CREDITED' AND return_value<0`).first<{ n: number; total: number }>(),
    env.DB.prepare(`SELECT nps_tw, nps_computed FROM fan_score_weeks WHERE week_ending BETWEEN ? AND ?`).bind(ws, we).first<{ nps_tw: number | null; nps_computed: number | null }>(),
    env.DB.prepare(`SELECT COALESCE(SUM(l.amount),0) amt, COUNT(*) n FROM statement_lines l JOIN statements s ON s.statement_no=l.statement_no WHERE lower(l.vendor_text) LIKE '%interest%' AND s.cut_off BETWEEN ? AND ?`).bind(ws, we).first<{ amt: number; n: number }>(),
    env.DB.prepare(`SELECT COUNT(*) n FROM anomalies WHERE resolved=0`).first<{ n: number }>(),
    // 4-week waste% trend per dept (weeks ending at the selected week).
    env.DB.prepare(
      `WITH RECURSIVE _days(d) AS (SELECT date(?2,'-21 days') UNION ALL SELECT date(d,'+1 day') FROM _days WHERE d < ?2),
        _c AS (SELECT _days.d day, f.dept_code dc, (julianday(f.date_to)-julianday(f.date_from)+1) span,
                 f.net_sales_zar ns, f.waste_zar wst,
                 ROW_NUMBER() OVER (PARTITION BY _days.d, f.dept_code ORDER BY (julianday(f.date_to)-julianday(f.date_from)) ASC, CASE f.report_type WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END) rn
               FROM _days JOIN fim_daily f ON f.dept_code!='TOTAL' AND f.date_from<=_days.d AND f.date_to>=_days.d)
       SELECT fw.fiscal_week_code wk, _c.dc dept, ROUND(SUM(_c.wst/span)) waste, ROUND(SUM(_c.ns/span)) sales
       FROM _c JOIN fiscal_weeks fw ON _c.day>=fw.week_start AND _c.day<=fw.week_end
       WHERE _c.rn=1 GROUP BY fw.fiscal_week_code, _c.dc`,
    ).bind(ws, we).all<{ wk: string; dept: string; waste: number; sales: number }>(),
  ]);

  const fimComplete = coverage.fim!.status === "green";

  // ---- Trading ----
  const savedStore = budgetRows.results?.find((b) => b.budget_type === "store");
  const savedDept = new Map((budgetRows.results ?? []).filter((b) => b.budget_type === "department").map((b) => [b.department, b.sales_budget_zar]));
  const budgetSource = savedStore ? "saved" : "LY-FIM-generated";
  const lyByDept = new Map(lyFim.map((d) => [d.dept_code, d.sales]));
  const tradingDepts = fim.map((d) => {
    const saved = savedDept.get(d.dept_code);
    const lySales = lyByDept.get(d.dept_code) ?? 0;
    const budget = saved != null ? saved : r0(lySales * (1 + growthPct / 100));
    return {
      dept: d.dept_code, name: d.dept_name, sales: d.sales, budget,
      varianceZar: r0(d.sales - budget), variancePct: pct(d.sales - budget, budget),
      gpPct: pct(d.sales - d.cos, d.sales), lySales, lyVarPct: pct(d.sales - lySales, lySales),
    };
  }).sort((a, b) => b.sales - a.sales);
  const storeSales = fim.reduce((s, d) => s + d.sales, 0);
  const storeCos = fim.reduce((s, d) => s + d.cos, 0);
  const storeBudget = savedStore?.sales_budget_zar != null ? savedStore.sales_budget_zar : tradingDepts.reduce((s, d) => s + d.budget, 0);
  const storeLy = lyFim.reduce((s, d) => s + d.sales, 0);

  // ---- Loss ----
  const storeWaste = fim.reduce((s, d) => s + d.waste, 0);
  const storeShrink = fim.reduce((s, d) => s + d.shrink, 0);
  const lossDepts = fim.map((d) => ({
    dept: d.dept_code, name: d.dept_name, sales: d.sales,
    waste: d.waste, wastePct: pct(d.waste, d.sales), shrink: d.shrink, shrinkPct: pct(d.shrink, d.sales),
    overWaste: (pct(d.waste, d.sales) ?? 0) > WASTE_THRESHOLD, overShrink: (pct(d.shrink, d.sales) ?? 0) > SHRINK_THRESHOLD,
  })).filter((d) => d.sales > 0);
  // 4-week waste% trend per dept → arrow (latest vs earliest).
  const trendByDept = new Map<string, { wk: string; wastePct: number | null }[]>();
  for (const r of (trendRes.results ?? [])) {
    const arr = trendByDept.get(r.dept) ?? [];
    arr.push({ wk: r.wk, wastePct: pct(r.waste, r.sales) });
    trendByDept.set(r.dept, arr);
  }
  const topOffenders = lossDepts.slice().sort((a, b) => (b.wastePct ?? 0) - (a.wastePct ?? 0)).slice(0, 5).map((d) => {
    const tr = (trendByDept.get(d.dept) ?? []).sort((a, b) => a.wk.localeCompare(b.wk));
    const vals = tr.map((t) => t.wastePct).filter((v): v is number => v != null);
    const arrow = vals.length >= 2 ? (vals[vals.length - 1]! > vals[0]! + 0.1 ? "up" : vals[vals.length - 1]! < vals[0]! - 0.1 ? "down" : "flat") : "flat";
    return { dept: d.dept, name: d.name, wastePct: d.wastePct, trend: tr.map((t) => t.wastePct), arrow, date: we };
  });

  // ---- Money out (next 14 days) ----
  const in14 = (await env.DB.prepare(`SELECT date('now','+14 days') d`).first<{ d: string }>())?.d ?? "";
  const pnpDue = payments.schedule.filter((s) => s.dueDate <= in14);
  const vencor = (vencorRes.results ?? []).map((v) => ({ grDate: v.grDate, dueDate: v.dueDate, valueZar: v.val, vendor: v.vendorName || "Meat (F09/F04)" }));

  // ---- Watch ----
  const fanNps = fanRow ? (fanRow.nps_tw ?? fanRow.nps_computed) : null;

  return json({
    week: { code, weekStart: ws, weekEnd: we, weekNo: target.week_no, fiscalYear: target.fiscal_year, lyCode: ly?.fiscal_week_code ?? null },
    params: { growthPct, requiredMarginPct },
    coverage,
    trading: {
      complete: fimComplete, budgetSource,
      store: {
        sales: r0(storeSales), budget: r0(storeBudget), varianceZar: r0(storeSales - storeBudget), variancePct: pct(storeSales - storeBudget, storeBudget),
        gpPct: pct(storeSales - storeCos, storeSales), requiredMarginPct, gpDeltaPp: pct(storeSales - storeCos, storeSales) != null ? Math.round((pct(storeSales - storeCos, storeSales)! - requiredMarginPct) * 10) / 10 : null,
        lySales: r0(storeLy), lyVarPct: pct(storeSales - storeLy, storeLy),
      },
      depts: tradingDepts,
    },
    loss: {
      complete: fimComplete, threshold: WASTE_THRESHOLD,
      store: { sales: r0(storeSales), waste: r0(storeWaste), wastePct: pct(storeWaste, storeSales), shrink: r0(storeShrink), shrinkPct: pct(storeShrink, storeSales) },
      depts: lossDepts.sort((a, b) => (b.wastePct ?? 0) - (a.wastePct ?? 0)),
      topOffenders,
    },
    moneyOut: { pnp: pnpDue, vencor, overdue: payments.overdue, pnpTermsNote: "PnP statement obligations; Vencor 14-day terms from GR" },
    moneyBack: {
      claims: { count: claimsRow?.n ?? 0, total: claimsRow?.total ?? 0 },
      uninvoicedGr: { count: uninvRow?.n ?? 0, total: uninvRow?.total ?? 0 },
      returnsNoCredit: { count: returnsRow?.n ?? 0, total: returnsRow?.total ?? 0 },
    },
    watch: {
      anomalyCount: anomRow?.n ?? 0,
      interest: { amount: interestRow?.amt ?? 0, count: interestRow?.n ?? 0, present: coverage.statement!.status === "green" },
      fanScore: { nps: fanNps, target: 90, present: coverage.fanScore!.status === "green", belowTarget: fanNps != null && fanNps < 90 },
    },
  });
}

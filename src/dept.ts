/**
 * Department deep-dive (Brief 9) — league table + per-dept dossier, and the shared
 * 5-component GP bridge (Brief 8 §2). All money Rand. FIM is resolved to the finest
 * report_type per day (weekly for Fresh-B), so margins obey the house rule.
 */
import { type Env } from "./config";
import { DEPARTMENTS, resolveDeptName } from "./departments";
import { budgetAssumptions } from "./otb";
import { getFreshBConfig, freshBWeeklyMargin } from "./analytics";

/**
 * Builds a per-dept Fresh B margin adjuster over [from,to]. For a Fresh B dept it
 * returns the dedicated weekly_freshb file's sales+cos (so GP% equals the file
 * EXACTLY); if no file covers the window it returns pending=true (Fresh B margin is
 * NOT derivable from daily/general-weekly per the house rule). Non-Fresh-B depts
 * pass through unchanged.
 */
export async function freshBAdjuster(
  env: Env,
  from: string,
  to: string,
): Promise<(deptCode: string, sales: number, cos: number) => { sales: number; cos: number; pending: boolean }> {
  const [cfg, fbm] = await Promise.all([getFreshBConfig(env), freshBWeeklyMargin(env, from, to)]);
  return (deptCode, sales, cos) => {
    if (!cfg.depts.has(deptCode)) return { sales, cos, pending: false };
    const m = fbm.byDept.get(deptCode);
    if (m && m.marginPct != null) return { sales: m.salesZar, cos: m.cosZar, pending: false };
    return { sales, cos, pending: true };
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
const r0 = (n: number) => Math.round(n);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const WASTE_THRESHOLD = 2;

/** Friendly dept names: DEPARTMENTS defaults, overridden by the app_settings JSON. */
export async function deptNameMap(env: Env): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const [code, name] of Object.entries(DEPARTMENTS)) map.set(code.split("/").pop()!.toUpperCase(), name);
  const row = await env.DB.prepare(`SELECT value FROM app_settings WHERE key='dept_names'`).first<{ value: string }>();
  if (row?.value) {
    try { for (const [k, v] of Object.entries(JSON.parse(row.value) as Record<string, string>)) if (v) map.set(k.toUpperCase(), String(v)); } catch { /* ignore bad JSON */ }
  }
  return map;
}
function nameOf(map: Map<string, string>, code: string, fimName?: string | null): string {
  return map.get(code.toUpperCase()) ?? resolveDeptName(code) ?? fimName ?? code;
}

interface FimDeptRow { dept_code: string; dept_name: string; sales: number; cos: number; waste: number; shrink: number; }

/** Resolved FIM per SAP dept over [from,to]. */
async function fimByDept(env: Env, from: string, to: string): Promise<FimDeptRow[]> {
  const res = await env.DB.prepare(
    `WITH RECURSIVE _days(d) AS (SELECT ?1 UNION ALL SELECT date(d,'+1 day') FROM _days WHERE d < ?2),
      _c AS (SELECT _days.d day, f.dept_code, MAX(f.dept_name) OVER (PARTITION BY f.dept_code) nm,
               (julianday(f.date_to)-julianday(f.date_from)+1) span,
               f.net_sales_zar ns, f.total_cos_zar cos, f.waste_zar wst, f.shrink_zar shr,
               ROW_NUMBER() OVER (PARTITION BY _days.d, f.dept_code ORDER BY (julianday(f.date_to)-julianday(f.date_from)) ASC, CASE f.report_type WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END) rn
             FROM _days JOIN fim_daily f ON f.dept_code!='TOTAL' AND f.report_type!='weekly_freshb' AND f.date_from<=_days.d AND f.date_to>=_days.d)
     SELECT dept_code, MAX(nm) dept_name, ROUND(SUM(ns/span)) sales, ROUND(SUM(cos/span)) cos,
            ROUND(SUM(wst/span)) waste, ROUND(SUM(shr/span)) shrink
     FROM _c WHERE rn=1 GROUP BY dept_code`,
  ).bind(from, to).all<FimDeptRow>();
  return res.results ?? [];
}
/** LY range = same dates − 364 days (52 weeks; keeps fiscal-week / weekday alignment). */
function lyShift(d: string): string { return new Date(Date.parse(d + "T00:00:00Z") - 364 * 86400000).toISOString().slice(0, 10); }

/** GR purchase cost per SAP dept over [from,to]. */
async function grByDept(env: Env, from: string, to: string): Promise<Map<string, number>> {
  const res = await env.DB.prepare(
    `SELECT substr(dept_code, instr(dept_code,'/')+1) dept, ROUND(COALESCE(SUM(cost_zar),0)) cost
     FROM gr_lines WHERE gr_date BETWEEN ? AND ? AND dept_code IS NOT NULL GROUP BY dept`,
  ).bind(from, to).all<{ dept: string; cost: number }>();
  return new Map((res.results ?? []).map((r) => [r.dept, r.cost]));
}
/** Swell funding per SAP dept over statements whose cut_off falls in [from,to]. */
async function swellByDept(env: Env, from: string, to: string): Promise<Map<string, number>> {
  const res = await env.DB.prepare(
    `SELECT substr(l.vendor_text, instr(l.vendor_text,'% ')+2, 3) dept, ROUND(SUM(l.amount),2) swell
     FROM statement_lines l JOIN statements s ON s.statement_no=l.statement_no
     WHERE l.line_type='SWELL' AND l.vendor_text LIKE '*%' AND s.cut_off BETWEEN ? AND ?
     GROUP BY dept`,
  ).bind(from, to).all<{ dept: string; swell: number }>();
  return new Map((res.results ?? []).filter((r) => /^[A-Z]\d/.test(r.dept)).map((r) => [r.dept, r.swell]));
}
/** Saved SALES budget per dept for weeks whose week_end is in [from,to]. */
async function budgetByDept(env: Env, from: string, to: string): Promise<Map<string, number>> {
  const res = await env.DB.prepare(
    `SELECT wb.department dept, ROUND(SUM(wb.sales_budget_zar),2) budget
     FROM weekly_budgets wb JOIN fiscal_weeks fw ON fw.fiscal_week_code=wb.week_code
     WHERE wb.budget_type='department' AND wb.sales_budget_zar IS NOT NULL AND fw.week_end BETWEEN ? AND ?
     GROUP BY wb.department`,
  ).bind(from, to).all<{ dept: string; budget: number }>();
  return new Map((res.results ?? []).map((r) => [r.dept, r.budget]));
}

/** GET /api/dept-league?from=&to= — one row per SAP dept for the period + movers. */
export async function handleDeptLeague(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const from = q.get("from"), to = q.get("to");
  if (!from || !to) return json({ error: "from and to are required." }, 400);

  const [fim, lyFim, gr, swell, budget, names, adj, fbm] = await Promise.all([
    fimByDept(env, from, to),
    fimByDept(env, lyShift(from), lyShift(to)),
    grByDept(env, from, to),
    swellByDept(env, from, to),
    budgetByDept(env, from, to),
    deptNameMap(env),
    freshBAdjuster(env, from, to),
    freshBWeeklyMargin(env, from, to),
  ]);
  const lyByDept = new Map(lyFim.map((d) => [d.dept_code, d]));
  // Fresh B depts: sales/cos come from the weekly_freshb file (GP% = file exactly) or
  // are PENDING when no file covers the window — never a daily/general-weekly margin.
  const adjusted = fim.map((d) => {
    const a = adj(d.dept_code, d.sales, d.cos);
    return { ...d, sales: a.sales, cos: a.cos, pending: a.pending };
  });
  const storeSales = adjusted.reduce((s, d) => s + d.sales, 0);
  const storeGp = adjusted.reduce((s, d) => (d.pending ? s : s + (d.sales - d.cos)), 0);
  const igMap = new Map(fbm.integrity.map((i) => [i.deptCode, i]));

  const rows = adjusted.filter((d) => d.sales !== 0 || (gr.get(d.dept_code) ?? 0) !== 0).map((d) => {
    const gp = d.pending ? null : d.sales - d.cos;
    const ly = lyByDept.get(d.dept_code);
    const lyA = ly ? adj(d.dept_code, ly.sales, ly.cos) : null;
    const lyGp = lyA && !lyA.pending ? lyA.sales - lyA.cos : null;
    const grCost = r0(gr.get(d.dept_code) ?? 0);
    const swellR = r0(Math.abs(swell.get(d.dept_code) ?? 0)); // funding received (magnitude)
    const bud = budget.get(d.dept_code) ?? null;
    return {
      dept: d.dept_code, name: nameOf(names, d.dept_code, d.dept_name),
      sales: r0(d.sales), sharePct: pct(d.sales, storeSales),
      lySales: r0(ly?.sales ?? 0), growthPct: ly && ly.sales > 0 ? pct(d.sales - ly.sales, ly.sales) : null,
      gpPct: gp == null ? null : pct(gp, d.sales), gpR: gp == null ? null : r0(gp),
      gpSharePct: gp == null ? null : pct(gp, storeGp),
      wastePct: pct(d.waste, d.sales), shrinkPct: pct(d.shrink, d.sales),
      overWaste: (pct(d.waste, d.sales) ?? 0) > WASTE_THRESHOLD, overShrink: (pct(d.shrink, d.sales) ?? 0) > WASTE_THRESHOLD,
      grPurchases: grCost, purchToSales: d.sales > 0 ? Math.round((grCost / d.sales) * 100) / 100 : null,
      overPurch: d.sales > 0 && grCost / d.sales > 1.05,
      swell: swellR, swellPctOfPurch: pct(swellR, grCost),
      budget: bud != null ? r0(bud) : null, budgetVarPct: bud && bud > 0 ? pct(d.sales - bud, bud) : null,
      // Default sort key: GP contribution variance vs LY (biggest GP loss first).
      gpVarVsLy: gp == null || lyGp == null ? null : r0(gp - lyGp), lyGpPct: lyGp == null || !ly ? null : pct(lyGp, ly.sales),
      marginPending: d.pending,
      integrity: igMap.get(d.dept_code) ?? null,
    };
  });
  rows.sort((a, b) => (a.gpVarVsLy ?? Infinity) - (b.gpVarVsLy ?? Infinity));

  const byGrowth = rows.filter((r) => r.growthPct != null).slice();
  const gainers = byGrowth.slice().sort((a, b) => (b.growthPct ?? 0) - (a.growthPct ?? 0)).slice(0, 3);
  const decliners = byGrowth.slice().sort((a, b) => (a.growthPct ?? 0) - (b.growthPct ?? 0)).slice(0, 3);
  const marginDrops = rows.filter((r) => r.gpPct != null && r.lyGpPct != null)
    .map((r) => ({ ...r, marginDropPp: Math.round(((r.gpPct! - r.lyGpPct!)) * 10) / 10 }))
    .sort((a, b) => a.marginDropPp - b.marginDropPp).slice(0, 3);

  // Store GP% over depts with a known margin (pending Fresh B excluded from both GP
  // and its denominator so the % isn't diluted); pending count surfaced.
  const gpSales = adjusted.reduce((s, d) => (d.pending ? s : s + d.sales), 0);
  const freshBPending = adjusted.filter((d) => d.pending).map((d) => d.dept_code);
  return json({
    from, to, lyFrom: lyShift(from), lyTo: lyShift(to),
    store: { sales: r0(storeSales), gpR: r0(storeGp), gpPct: pct(storeGp, gpSales), freshBPending },
    depts: rows,
    movers: {
      gainers: gainers.map((r) => ({ dept: r.dept, name: r.name, growthPct: r.growthPct })),
      decliners: decliners.map((r) => ({ dept: r.dept, name: r.name, growthPct: r.growthPct })),
      marginDrops: marginDrops.map((r) => ({ dept: r.dept, name: r.name, marginDropPp: r.marginDropPp, gpPct: r.gpPct, lyGpPct: r.lyGpPct })),
    },
    thresholds: { waste: WASTE_THRESHOLD, purchToSales: 1.05 },
  });
}

/**
 * 5-component GP bridge for a scope (dept or store): Budget GP → volume → margin
 * rate → −waste → −shrink → residual → Actual GP. Volume + rate are TRUE effects;
 * residual carries rounding/mix so the components sum EXACTLY to actual − budget.
 */
export function gpBridge(sales: number, cos: number, waste: number, shrink: number, budgetSales: number, marginPct: number) {
  const m = marginPct / 100;
  const budgetGp = r0(budgetSales * m);
  const actualGp = r0(sales - cos - waste - shrink); // GP after losses
  const volume = r0((sales - budgetSales) * m);
  const posMargin = sales > 0 ? (sales - cos) / sales : 0; // margin BEFORE waste/shrink
  const rate = r0((posMargin - m) * sales);
  const residual = actualGp - budgetGp - volume - rate - (-r0(waste)) - (-r0(shrink)); // balances
  const components = [
    { key: "volume", label: "Volume", value: volume },
    { key: "rate", label: "Margin rate", value: rate },
    { key: "waste", label: "Waste", value: -r0(waste) },
    { key: "shrink", label: "Shrink", value: -r0(shrink) },
    { key: "residual", label: "Residual", value: residual },
  ];
  const sum = components.reduce((s, c) => s + c.value, 0);
  return { budgetGp, actualGp, components, assertionResidual: sum - (actualGp - budgetGp), ties: sum === actualGp - budgetGp, marginPct };
}

/** Per-dept SALES budget for a period: saved weekly_budgets else LY sales × (1+growth). */
async function deptSalesBudgets(env: Env, from: string, to: string, growthPct: number): Promise<Map<string, number>> {
  const [saved, ly] = await Promise.all([budgetByDept(env, from, to), fimByDept(env, lyShift(from), lyShift(to))]);
  const out = new Map<string, number>();
  for (const d of ly) out.set(d.dept_code, r0(d.sales * (1 + growthPct / 100)));
  for (const [dept, bud] of saved) out.set(dept, r0(bud));
  return out;
}

/**
 * GET /api/gpbridge?from=&to= — store-level GP bridge + per-dept components table
 * (worst variance first). Same 5-component model; each dept ties to the cent.
 */
export async function handleGpBridge(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const from = q.get("from"), to = q.get("to");
  if (!from || !to) return json({ error: "from and to are required." }, 400);
  const { growthPct, marginPct } = await budgetAssumptions(env);
  const [fim, budgets, names, adj] = await Promise.all([
    fimByDept(env, from, to), deptSalesBudgets(env, from, to, growthPct), deptNameMap(env),
    freshBAdjuster(env, from, to),
  ]);
  // Fresh B depts: file sales+cos (GP = file) or pending (excluded from the bridge).
  const adjusted = fim.map((d) => {
    const a = adj(d.dept_code, d.sales, d.cos);
    return { ...d, sales: a.sales, cos: a.cos, pending: a.pending };
  });
  const known = adjusted.filter((d) => !d.pending);
  const storeSales = known.reduce((s, d) => s + d.sales, 0), storeCos = known.reduce((s, d) => s + d.cos, 0);
  const storeWaste = known.reduce((s, d) => s + d.waste, 0), storeShrink = known.reduce((s, d) => s + d.shrink, 0);
  const storeBudget = known.reduce((s, d) => s + (budgets.get(d.dept_code) ?? 0), 0);
  const store = gpBridge(storeSales, storeCos, storeWaste, storeShrink, storeBudget, marginPct);
  const depts = adjusted.filter((d) => d.sales !== 0).map((d) => {
    if (d.pending) {
      return { dept: d.dept_code, name: nameOf(names, d.dept_code, d.dept_name), marginPending: true, gpVar: 0 };
    }
    const b = gpBridge(d.sales, d.cos, d.waste, d.shrink, budgets.get(d.dept_code) ?? 0, marginPct);
    return { dept: d.dept_code, name: nameOf(names, d.dept_code, d.dept_name), ...b, gpVar: b.actualGp - b.budgetGp, marginPending: false };
  }).sort((a, b) => a.gpVar - b.gpVar);
  const freshBPending = adjusted.filter((d) => d.pending).map((d) => d.dept_code);
  return json({ from, to, params: { growthPct, marginPct }, store, depts, freshBPending });
}

/**
 * GET /api/dept-dossier?dept=&from=&to= — one department's deep-dive: GP bridge,
 * swell funding by week (with expected rate), top articles by GR value, anomalies.
 */
export async function handleDeptDossier(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const dept = q.get("dept"); const from = q.get("from"), to = q.get("to");
  if (!dept || !from || !to) return json({ error: "dept, from and to are required." }, 400);
  const { growthPct, marginPct } = await budgetAssumptions(env);

  const [fim, budgets, names, swellRows, purchByWeek, topArts, anoms, adj, fbm] = await Promise.all([
    fimByDept(env, from, to),
    deptSalesBudgets(env, from, to, growthPct),
    deptNameMap(env),
    // Swell lines for this dept, by statement week, with the printed rate parsed.
    env.DB.prepare(
      `SELECT s.statement_no wk, s.period_start ws, s.cut_off we,
              ROUND(SUM(l.amount),2) swell,
              MAX(CAST(replace(substr(l.vendor_text,2,instr(l.vendor_text,'%')-2),' ','') AS REAL)) rate
       FROM statement_lines l JOIN statements s ON s.statement_no=l.statement_no
       WHERE l.line_type='SWELL' AND l.vendor_text LIKE '*%'
         AND substr(l.vendor_text, instr(l.vendor_text,'% ')+2, 3)=?1
         AND s.cut_off >= date(?2,'-56 days') AND s.cut_off <= ?3
       GROUP BY s.statement_no ORDER BY s.cut_off`,
    ).bind(dept, from, to).all<{ wk: string; ws: string; we: string; swell: number; rate: number | null }>(),
    // GR purchase cost per statement week for this dept (for expected-swell = rate × purchases).
    env.DB.prepare(
      `SELECT fw.fiscal_week_code wk, ROUND(COALESCE(SUM(g.cost_zar),0)) cost
       FROM gr_lines g JOIN fiscal_weeks fw ON g.gr_date>=fw.week_start AND g.gr_date<=fw.week_end
       WHERE substr(g.dept_code, instr(g.dept_code,'/')+1)=?1 AND g.gr_date >= date(?2,'-56 days') AND g.gr_date <= ?3
       GROUP BY fw.fiscal_week_code`,
    ).bind(dept, from, to).all<{ wk: string; cost: number }>(),
    // Top articles by GR value for the dept in the period + FIM sales/waste where present.
    env.DB.prepare(
      `SELECT g.article_code code, MAX(g.article_desc) desc_, ROUND(SUM(g.cost_zar),2) grValue,
              (SELECT ROUND(SUM(fa.net_sales_zar),2) FROM fim_articles fa WHERE fa.article_code=g.article_code AND fa.date_from>=?2 AND fa.date_to<=?3) fimSales,
              (SELECT ROUND(SUM(fa.waste_zar),2) FROM fim_articles fa WHERE fa.article_code=g.article_code AND fa.date_from>=?2 AND fa.date_to<=?3) fimWaste
       FROM gr_lines g WHERE substr(g.dept_code, instr(g.dept_code,'/')+1)=?1 AND g.gr_date BETWEEN ?2 AND ?3
         AND g.article_code IS NOT NULL AND g.article_code!=''
       GROUP BY g.article_code ORDER BY grValue DESC LIMIT 10`,
    ).bind(dept, from, to).all<{ code: string; desc_: string; grValue: number; fimSales: number | null; fimWaste: number | null }>(),
    // Anomalies mentioning this dept in the period.
    env.DB.prepare(
      `SELECT type, severity, message, detail_json FROM anomalies
       WHERE resolved=0 AND (json_extract(detail_json,'$.deptCode')=?1 OR message LIKE ?4)
       ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, id DESC LIMIT 20`,
    ).bind(dept, from, to, `${dept} %`).all<{ type: string; severity: string; message: string; detail_json: string | null }>(),
    freshBAdjuster(env, from, to),
    freshBWeeklyMargin(env, from, to),
  ]);

  const dRaw = fim.find((x) => x.dept_code === dept) ?? { dept_code: dept, dept_name: dept, sales: 0, cos: 0, waste: 0, shrink: 0 };
  // Fresh B: sales+cos from the weekly_freshb file (GP = file) or pending (no file).
  const a = adj(dept, dRaw.sales, dRaw.cos);
  const d = { ...dRaw, sales: a.sales, cos: a.cos };
  const marginPending = a.pending;
  const bridge = marginPending ? null : gpBridge(d.sales, d.cos, d.waste, d.shrink, budgets.get(dept) ?? 0, marginPct);
  const purchMap = new Map((purchByWeek.results ?? []).map((r) => [r.wk, r.cost]));
  const swell = (swellRows.results ?? []).map((s) => {
    const purchases = r0(purchMap.get(s.wk) ?? 0);
    const rate = s.rate ?? null;
    const expected = rate != null ? r0(purchases * rate / 100) : null;
    const received = r0(Math.abs(s.swell));
    return { week: s.wk, rate, purchases, expected, received, gap: expected != null ? expected - received : null, short: expected != null && received < expected * 0.8 };
  });

  return json({
    dept, name: nameOf(names, dept, d.dept_name), from, to,
    isFreshB: /^(F04|F06|F07|F09|F64|F77)$/.test(dept), // canonical Fresh B set (F55 excluded)
    marginPending,
    // Fresh B file-vs-daily basis check for this dept (present only on a complete daily
    // week that diverges): withinBand → known basis (muted), else anomaly (red).
    integrity: fbm.integrity.find((i) => i.deptCode === dept) ?? null,
    summary: { sales: r0(d.sales), gpR: marginPending ? null : r0(d.sales - d.cos), gpPct: marginPending ? null : pct(d.sales - d.cos, d.sales), waste: r0(d.waste), wastePct: pct(d.waste, d.sales), shrink: r0(d.shrink), shrinkPct: pct(d.shrink, d.sales) },
    bridge,
    swell,
    topArticles: (topArts.results ?? []).map((a) => ({ code: a.code, desc: a.desc_, grValue: r0(a.grValue), fimSales: a.fimSales != null ? r0(a.fimSales) : null, fimWaste: a.fimWaste != null ? r0(a.fimWaste) : null })),
    anomalies: (anoms.results ?? []).map((a) => ({ type: a.type, severity: a.severity, message: a.message })),
  });
}

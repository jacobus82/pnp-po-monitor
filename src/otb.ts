/**
 * Open-to-buy (Brief 8 §1) — forward purchase control. The PO date is the moment
 * an order can still be cancelled, so this measures, per SAP department for a
 * fiscal week: the purchase (GR) budget, POs placed to date, remaining open-to-buy
 * and pacing (consumed % vs elapsed % of week). Over-budget departments are the
 * signal to stop ordering. OTB, the GP bridge and budget generation all read the
 * SAME growth/margin assumptions (settings) so they stay consistent.
 */
import { type Env } from "./config";
import { openPoMaxAgeDays, notAgedOutSql, notManuallyClosedSql } from "./db/repo";
import { resolveDeptName } from "./departments";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}
const r0 = (n: number) => Math.round(n);

/** Shared budget assumptions (normalized): growth% + required margin%. */
export async function budgetAssumptions(env: Env): Promise<{ growthPct: number; marginPct: number }> {
  const rows = (await env.DB.prepare(`SELECT key, value FROM app_settings WHERE key IN ('budget_growth_pct','target_gp_pct')`).all<{ key: string; value: string }>()).results ?? [];
  const m = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const growthPct = Number.isFinite(m.get("budget_growth_pct")) ? m.get("budget_growth_pct")! : 5;
  const marginPct = Number.isFinite(m.get("target_gp_pct")) ? m.get("target_gp_pct")! : 20;
  return { growthPct, marginPct };
}

interface Fweek { fiscal_week_code: string; week_start: string; week_end: string; fiscal_year: number; week_no: number; }

/** LY-resolved net sales per SAP dept (finest report_type per day). */
async function lySalesByDept(env: Env, from: string, to: string): Promise<Map<string, number>> {
  const res = await env.DB.prepare(
    `WITH RECURSIVE _days(d) AS (SELECT ?1 UNION ALL SELECT date(d,'+1 day') FROM _days WHERE d < ?2),
      _c AS (SELECT _days.d day, f.dept_code dc, (julianday(f.date_to)-julianday(f.date_from)+1) span, f.net_sales_zar ns,
               ROW_NUMBER() OVER (PARTITION BY _days.d, f.dept_code ORDER BY (julianday(f.date_to)-julianday(f.date_from)) ASC, CASE f.report_type WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 ELSE 2 END) rn
             FROM _days JOIN fim_daily f ON f.dept_code!='TOTAL' AND f.date_from<=_days.d AND f.date_to>=_days.d)
     SELECT dc dept, ROUND(SUM(ns/span)) sales FROM _c WHERE rn=1 GROUP BY dc`,
  ).bind(from, to).all<{ dept: string; sales: number }>();
  return new Map((res.results ?? []).map((r) => [r.dept, r.sales]));
}

/**
 * Per-dept GR (purchase) budget for a week: saved weekly_budgets.gr_budget_zar
 * where present, else LY-FIM-generated = LY sales × (1+growth) × (1−margin).
 * Shared by OTB and the GP bridge so both use the budget-generation assumptions.
 */
export async function deptGrBudgets(
  env: Env, target: Fweek, growthPct: number, marginPct: number,
): Promise<{ budgets: Map<string, { grBudget: number; source: string }>; storeSaved: number | null }> {
  const [savedRes, ly] = await Promise.all([
    env.DB.prepare(`SELECT budget_type, department, gr_budget_zar FROM weekly_budgets WHERE week_code=?`).bind(target.fiscal_week_code).all<{ budget_type: string; department: string; gr_budget_zar: number | null }>(),
    env.DB.prepare(`SELECT week_start, week_end FROM fiscal_weeks WHERE fiscal_year=? AND week_no=?`).bind(target.fiscal_year - 1, target.week_no).first<{ week_start: string; week_end: string }>(),
  ]);
  const savedDept = new Map((savedRes.results ?? []).filter((b) => b.budget_type === "department" && b.gr_budget_zar != null).map((b) => [b.department, b.gr_budget_zar!]));
  const storeSaved = (savedRes.results ?? []).find((b) => b.budget_type === "store")?.gr_budget_zar ?? null;
  const lySales = ly ? await lySalesByDept(env, ly.week_start, ly.week_end) : new Map<string, number>();

  const budgets = new Map<string, { grBudget: number; source: string }>();
  const depts = new Set<string>([...savedDept.keys(), ...lySales.keys()]);
  for (const d of depts) {
    if (savedDept.has(d)) budgets.set(d, { grBudget: r0(savedDept.get(d)!), source: "saved" });
    else budgets.set(d, { grBudget: r0((lySales.get(d) ?? 0) * (1 + growthPct / 100) * (1 - marginPct / 100)), source: "LY-generated" });
  }
  return { budgets, storeSaved };
}

/** Resolve ?week= or the CURRENT fiscal week (contains today) — OTB is live. */
async function resolveWeek(env: Env, wanted: string | null): Promise<Fweek | null> {
  return wanted
    ? env.DB.prepare(`SELECT fiscal_week_code, week_start, week_end, fiscal_year, week_no FROM fiscal_weeks WHERE fiscal_week_code=?`).bind(wanted).first<Fweek>()
    : env.DB.prepare(`SELECT fiscal_week_code, week_start, week_end, fiscal_year, week_no FROM fiscal_weeks WHERE week_start<=date('now') AND week_end>=date('now') LIMIT 1`).first<Fweek>();
}

/** Placed PO net (S001−S002, aged-out excluded) per SAP dept for a week. */
async function placedByDept(env: Env, ws: string, we: string): Promise<Map<string, number>> {
  const notAged = notAgedOutSql(await openPoMaxAgeDays(env));
  const res = await env.DB.prepare(
    `SELECT substr(mdse_cat,1,3) dept,
            ROUND(SUM(CASE WHEN COALESCE(sloc,'')='S002' THEN -COALESCE(line_value_cents,0) ELSE COALESCE(line_value_cents,0) END)/100.0,2) net
     FROM po_lines WHERE order_date BETWEEN ? AND ? AND mdse_cat IS NOT NULL AND ${notAged} AND ${notManuallyClosedSql()}
     GROUP BY substr(mdse_cat,1,3)`,
  ).bind(ws, we).all<{ dept: string; net: number }>();
  return new Map((res.results ?? []).map((r) => [r.dept, r.net]));
}

/** Exact store PO net for a week (rounded ONCE) — ties to the Orders screen. */
async function storePlacedExact(env: Env, ws: string, we: string): Promise<number> {
  const notAged = notAgedOutSql(await openPoMaxAgeDays(env));
  const row = await env.DB.prepare(
    `SELECT ROUND(SUM(CASE WHEN COALESCE(sloc,'')='S002' THEN -COALESCE(line_value_cents,0) ELSE COALESCE(line_value_cents,0) END)/100.0) net
     FROM po_lines WHERE order_date BETWEEN ? AND ? AND ${notAged} AND ${notManuallyClosedSql()}`,
  ).bind(ws, we).first<{ net: number | null }>();
  return r0(row?.net ?? 0);
}

/** Compute the OTB rows for a week (shared by the endpoint and anomaly recompute). */
export async function computeOtb(env: Env, target: Fweek) {
  const { growthPct, marginPct } = await budgetAssumptions(env);
  const [{ budgets, storeSaved }, placed, storePlaced, todayRow] = await Promise.all([
    deptGrBudgets(env, target, growthPct, marginPct),
    placedByDept(env, target.week_start, target.week_end),
    storePlacedExact(env, target.week_start, target.week_end),
    env.DB.prepare(`SELECT date('now') d`).first<{ d: string }>(),
  ]);
  const today = todayRow?.d ?? target.week_end;
  const asOf = today < target.week_end ? today : target.week_end;
  const daysElapsed = Math.max(0, Math.min(7, Math.round((Date.parse(asOf) - Date.parse(target.week_start)) / 86400000) + 1));
  const elapsedPct = Math.round((daysElapsed / 7) * 1000) / 10;

  const deptCodes = new Set<string>([...budgets.keys(), ...placed.keys()]);
  const rows = [...deptCodes].map((dept) => {
    const b = budgets.get(dept);
    const budget = b?.grBudget ?? 0;
    const placedZar = r0(placed.get(dept) ?? 0);
    const otb = budget - placedZar;
    const consumedPct = budget > 0 ? Math.round((placedZar / budget) * 1000) / 10 : (placedZar > 0 ? 999 : 0);
    const over = placedZar > budget && budget > 0;
    const pacing = !over && budget > 0 && consumedPct > elapsedPct + 10;
    return {
      dept, name: resolveDeptName(dept) ?? dept, budget, budgetSource: b?.source ?? "none",
      placed: placedZar, otb, consumedPct, over, pacing,
      status: over ? "over" : pacing ? "amber" : "ok",
    };
  }).filter((r) => r.budget > 0 || r.placed > 0)
    .sort((a, b) => (a.over === b.over ? b.consumedPct - a.consumedPct : a.over ? -1 : 1));

  const storeBudget = storeSaved != null ? r0(storeSaved) : rows.reduce((s, r) => s + r.budget, 0);
  const deptsOver = rows.filter((r) => r.over).length;
  return {
    week: { code: target.fiscal_week_code, weekStart: target.week_start, weekEnd: target.week_end, daysElapsed, elapsedPct },
    params: { growthPct, marginPct },
    store: {
      budget: storeBudget, budgetSource: storeSaved != null ? "saved" : "sum of departments",
      placed: storePlaced, otb: storeBudget - storePlaced,
      consumedPct: storeBudget > 0 ? Math.round((storePlaced / storeBudget) * 1000) / 10 : 0,
      deptsOver,
    },
    depts: rows,
  };
}

/** GET /api/otb?week= — open-to-buy per SAP dept + store total for a fiscal week. */
export async function handleOtb(req: Request, env: Env): Promise<Response> {
  const target = await resolveWeek(env, new URL(req.url).searchParams.get("week"));
  if (!target) return json({ error: "No fiscal week found." }, 404);
  return json(await computeOtb(env, target));
}

/**
 * Regenerate OTB_EXCEEDED anomalies across the CURRENT fiscal week: one per dept
 * whose placed POs exceed its week purchase budget (money can still be stopped).
 * Follows the recomputeStaleAnomalies pattern (delete-by-type then insert).
 */
export async function recomputeOtbAnomalies(env: Env): Promise<number> {
  await env.DB.prepare(`DELETE FROM anomalies WHERE type='OTB_EXCEEDED'`).run();
  // Target the ACTIVE purchasing week — the fiscal week of the latest PO order_date
  // (where ordering is happening and can still be stopped), not an empty future week.
  const latest = await env.DB.prepare(
    `SELECT fw.fiscal_week_code, fw.week_start, fw.week_end, fw.fiscal_year, fw.week_no
     FROM fiscal_weeks fw WHERE fw.week_start <= (SELECT MAX(order_date) FROM po_lines)
       AND fw.week_end >= (SELECT MAX(order_date) FROM po_lines) LIMIT 1`,
  ).first<Fweek>();
  if (!latest) return 0;
  const otb = await computeOtb(env, latest);
  const over = otb.depts.filter((d) => d.over);
  if (!over.length) return 0;
  const stmt = env.DB.prepare(
    `INSERT INTO anomalies (upload_id, po_line_id, type, severity, message, detail_json)
     VALUES (NULL, NULL, 'OTB_EXCEEDED', 'CRITICAL', ?, ?)`,
  );
  for (let i = 0; i < over.length; i += 50) {
    await env.DB.batch(over.slice(i, i + 50).map((d) =>
      stmt.bind(
        `${d.dept} ${d.name} over purchase budget: placed ZAR ${d.placed.toLocaleString()} vs budget ZAR ${d.budget.toLocaleString()} (${d.consumedPct}%) — week ${otb.week.code}.`,
        JSON.stringify({ dept: d.dept, week: otb.week.code, placed: d.placed, budget: d.budget, consumedPct: d.consumedPct, drill: `otb?week=${otb.week.code}` }),
      ),
    ));
  }
  return over.length;
}

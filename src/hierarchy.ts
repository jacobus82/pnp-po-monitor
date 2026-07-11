import * as XLSX from "xlsx";
import type { Env } from "./config";

/**
 * Merchandise-hierarchy endpoints: the Division → Business Unit → Category
 * Portfolio → SAP department tree, a per-department reverse lookup, an xlsx
 * upsert, and division/BU performance (joined to the latest FIM).
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

interface MhRow {
  division_no: string;
  major_division: string;
  business_unit: string;
  business_name: string;
  cp_no: string;
  cp_name: string;
  sap_dept_code: string;
  sap_dept_name: string;
}

/** dept_code -> { guideline_margin_pct, guideline_group } (current guideline). */
async function guidelineByDept(
  env: Env,
): Promise<Map<string, { margin: number | null; group: string | null }>> {
  const rows = await env.DB.prepare(
    `SELECT dept_code, guideline_margin_pct, guideline_group FROM dept_guidelines g
     WHERE effective_from = (SELECT MAX(effective_from) FROM dept_guidelines g2 WHERE g2.dept_code = g.dept_code)`,
  ).all<{ dept_code: string; guideline_margin_pct: number | null; guideline_group: string | null }>();
  const map = new Map<string, { margin: number | null; group: string | null }>();
  for (const r of rows.results ?? []) map.set(r.dept_code, { margin: r.guideline_margin_pct, group: r.guideline_group });
  return map;
}

/** GET /api/hierarchy — full nested Division → BU → CP → SAP-dept tree. */
export async function handleHierarchy(env: Env): Promise<Response> {
  const rows = (
    await env.DB.prepare(
      `SELECT division_no, major_division, business_unit, business_name, cp_no, cp_name, sap_dept_code, sap_dept_name
       FROM merchandise_hierarchy ORDER BY CAST(division_no AS INTEGER), business_unit, cp_no`,
    ).all<MhRow>()
  ).results ?? [];
  const guides = await guidelineByDept(env);

  type CP = { no: string; name: string; sap_depts: string[]; guideline_margin_pct: number | null };
  type BU = { no: string; name: string; category_portfolios: Map<string, CP> };
  type DIV = { no: number; name: string; guideline_group: string | null; _groups: Record<string, number>; business_units: Map<string, BU> };
  const divisions = new Map<string, DIV>();

  for (const r of rows) {
    let div = divisions.get(r.division_no);
    if (!div) {
      div = { no: Number(r.division_no), name: r.major_division, guideline_group: null, _groups: {}, business_units: new Map() };
      divisions.set(r.division_no, div);
    }
    let bu = div.business_units.get(r.business_unit);
    if (!bu) {
      bu = { no: r.business_unit, name: r.business_name, category_portfolios: new Map() };
      div.business_units.set(r.business_unit, bu);
    }
    let cp = bu.category_portfolios.get(r.cp_no);
    if (!cp) {
      cp = { no: r.cp_no, name: r.cp_name, sap_depts: [], guideline_margin_pct: null };
      bu.category_portfolios.set(r.cp_no, cp);
    }
    if (!cp.sap_depts.includes(r.sap_dept_code)) cp.sap_depts.push(r.sap_dept_code);
    const g = guides.get(r.sap_dept_code);
    if (cp.guideline_margin_pct == null && g?.margin != null) cp.guideline_margin_pct = g.margin;
    if (g?.group) div._groups[g.group] = (div._groups[g.group] ?? 0) + 1;
  }

  const divisionsOut = [...divisions.values()].map((d) => {
    const group = Object.entries(d._groups).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return {
      no: d.no,
      name: d.name,
      guideline_group: group,
      business_units: [...d.business_units.values()].map((bu) => ({
        no: bu.no,
        name: bu.name,
        category_portfolios: [...bu.category_portfolios.values()],
      })),
    };
  });
  return json({ divisions: divisionsOut });
}

/** GET /api/hierarchy/dept/:code — every CP / BU / division mapping to a dept. */
export async function handleHierarchyDept(env: Env, code: string): Promise<Response> {
  const dept = code.toUpperCase();
  const rows = (
    await env.DB.prepare(
      `SELECT division_no, major_division, business_unit, business_name, cp_no, cp_name, sap_dept_name
       FROM merchandise_hierarchy WHERE sap_dept_code = ? ORDER BY CAST(division_no AS INTEGER), business_unit, cp_no`,
    )
      .bind(dept)
      .all<MhRow>()
  ).results ?? [];
  const guides = await guidelineByDept(env);
  const g = guides.get(dept);
  return json({
    deptCode: dept,
    deptName: rows[0]?.sap_dept_name ?? null,
    guideline_margin_pct: g?.margin ?? null,
    guideline_group: g?.group ?? null,
    categoryPortfolios: rows.map((r) => ({
      cp_no: r.cp_no,
      cp_name: r.cp_name,
      division: r.major_division,
      division_no: Number(r.division_no),
      business_unit: r.business_unit,
      business_name: r.business_name,
    })),
  });
}

/** POST /api/hierarchy/upload — upsert an updated CM_Master_Mapping.xlsx. */
export async function handleHierarchyUpload(req: Request, env: Env): Promise<Response> {
  const ctype = req.headers.get("content-type") ?? "";
  let bytes: ArrayBuffer;
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const entry = form.get("file") as unknown;
    if (entry == null || typeof entry === "string") return json({ error: "Expected a 'file' field." }, 400);
    bytes = await (entry as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
  } else {
    bytes = await req.arrayBuffer();
  }
  if (bytes.byteLength === 0) return json({ error: "Empty body." }, 400);

  let grid: unknown[][];
  try {
    const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
    const sheet = wb.Sheets["Master_Mapping"] ?? wb.Sheets[wb.SheetNames[0]!];
    grid = XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1, raw: false, defval: "", blankrows: false });
  } catch (err) {
    return json({ error: "Could not read xlsx: " + (err instanceof Error ? err.message : String(err)) }, 400);
  }

  const txt = (v: unknown) => (v == null ? "" : String(v).trim());
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  // Header at row 0: Division No, Major Division, Business Unit, Business Name,
  // Category Portfolio No, Category Portfolio Name, SAP Department Code, SAP Dept Name.
  for (const row of grid.slice(1)) {
    if (!Array.isArray(row)) continue;
    const cp = txt(row[4]);
    const dept = txt(row[6]);
    if (!cp || !dept) continue;
    const existing = await env.DB.prepare(
      `SELECT division_no, major_division, business_unit, business_name, cp_name, sap_dept_name
       FROM merchandise_hierarchy WHERE cp_no = ? AND sap_dept_code = ?`,
    )
      .bind(cp, dept)
      .first<MhRow>();
    const vals = [txt(row[0]), txt(row[1]), txt(row[2]), txt(row[3]), txt(row[5]), txt(row[7])];
    if (!existing) {
      await env.DB.prepare(
        `INSERT INTO merchandise_hierarchy (division_no, major_division, business_unit, business_name, cp_no, cp_name, sap_dept_code, sap_dept_name)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
        .bind(vals[0], vals[1], vals[2], vals[3], cp, vals[4], dept, vals[5])
        .run();
      inserted++;
    } else {
      const same =
        txt(existing.division_no) === vals[0] &&
        txt(existing.major_division) === vals[1] &&
        txt(existing.business_unit) === vals[2] &&
        txt(existing.business_name) === vals[3] &&
        txt(existing.cp_name) === vals[4] &&
        txt(existing.sap_dept_name) === vals[5];
      if (same) {
        unchanged++;
      } else {
        await env.DB.prepare(
          `UPDATE merchandise_hierarchy SET division_no=?, major_division=?, business_unit=?, business_name=?, cp_name=?, sap_dept_name=?
           WHERE cp_no=? AND sap_dept_code=?`,
        )
          .bind(vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], cp, dept)
          .run();
        updated++;
      }
    }
  }
  return json({ status: "ok", inserted, updated, unchanged });
}

/**
 * GET /api/hierarchy/performance — division & business-unit performance from the
 * latest FIM period: net sales / COS / margin (from summed sales/cos) rolled up
 * via the hierarchy, with the guideline margin per division.
 */
export async function handleHierarchyPerformance(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  // Windowed mode (?from=&to=): aggregate every FIM row inside the range so the
  // dashboard can show a full complete-week roll-up instead of one daily report.
  const windowed = !!(from && to);
  let reportDate: string | null;
  if (windowed) {
    reportDate = to!;
  } else {
    const latest = await env.DB.prepare(`SELECT MAX(report_date) d FROM fim_daily`).first<{ d: string | null }>();
    reportDate = latest?.d ?? null;
  }
  if (!reportDate) return json({ reportDate: null, divisions: [] });

  // Distinct dept -> division/BU (first mapping per dept) so FIM (dept-level)
  // rolls up to one division without double counting.
  const map = (
    await env.DB.prepare(
      `SELECT sap_dept_code, division_no, major_division, business_unit, business_name
       FROM merchandise_hierarchy m
       WHERE id = (SELECT MIN(id) FROM merchandise_hierarchy m2 WHERE m2.sap_dept_code = m.sap_dept_code)`,
    ).all<{ sap_dept_code: string; division_no: string; major_division: string; business_unit: string; business_name: string }>()
  ).results ?? [];
  const deptDiv = new Map(map.map((r) => [r.sap_dept_code, r]));

  const fim = (
    await (windowed
      ? env.DB.prepare(
          `SELECT dept_code, SUM(net_sales_zar) net_sales_zar, SUM(total_cos_zar) total_cos_zar,
                  SUM(waste_zar) waste_zar, SUM(shrink_zar) shrink_zar
           FROM fim_daily WHERE date_from >= ? AND date_to <= ? AND dept_code != 'TOTAL'
           GROUP BY dept_code`,
        ).bind(from, to)
      : env.DB.prepare(
          `SELECT dept_code, net_sales_zar, total_cos_zar, waste_zar, shrink_zar
           FROM fim_daily WHERE report_date = ? AND dept_code != 'TOTAL'`,
        ).bind(reportDate)
    ).all<{ dept_code: string; net_sales_zar: number | null; total_cos_zar: number | null; waste_zar: number | null; shrink_zar: number | null }>()
  ).results ?? [];
  const guides = await guidelineByDept(env);

  const divs = new Map<string, { no: number; name: string; group: string | null; sales: number; cos: number; waste: number; shrink: number; guideSum: number; guideN: number }>();
  for (const f of fim) {
    const d = deptDiv.get(f.dept_code);
    const key = d ? d.division_no : "0";
    let div = divs.get(key);
    if (!div) {
      div = { no: d ? Number(d.division_no) : 0, name: d?.major_division ?? "Unmapped", group: guides.get(f.dept_code)?.group ?? null, sales: 0, cos: 0, waste: 0, shrink: 0, guideSum: 0, guideN: 0 };
      divs.set(key, div);
    }
    div.sales += f.net_sales_zar ?? 0;
    div.cos += f.total_cos_zar ?? 0;
    div.waste += f.waste_zar ?? 0;
    div.shrink += f.shrink_zar ?? 0;
    const g = guides.get(f.dept_code);
    if (g?.margin != null) {
      div.guideSum += g.margin;
      div.guideN += 1;
    }
  }
  const divisions = [...divs.values()]
    .map((d) => ({
      no: d.no,
      name: d.name,
      guideline_group: d.group,
      netSalesZar: Math.round(d.sales * 100) / 100,
      cosZar: Math.round(d.cos * 100) / 100,
      marginPct: d.sales > 0 ? Math.round(((d.sales - d.cos) / d.sales) * 1000) / 10 : null,
      guidelineMarginPct: d.guideN ? Math.round((d.guideSum / d.guideN) * 100) / 100 : null,
      wasteZar: Math.round(d.waste * 100) / 100,
      shrinkZar: Math.round(d.shrink * 100) / 100,
    }))
    .sort((a, b) => b.netSalesZar - a.netSalesZar);
  return json({ reportDate, divisions });
}

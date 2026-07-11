import type { Env } from "./config";

/** A departmental guideline row as stored in dept_guidelines. */
export interface GuidelineRow {
  dept_code: string;
  dept_name: string | null;
  dept_group: string | null;
  guideline_margin_pct: number | null;
  margin_contribution_pct: number | null;
  participation_guideline_pct: number | null;
  effective_from: string;
}

/** Display order for the three department groups. */
export const DEPT_GROUP_ORDER = ["Non-Fresh", "Fresh-A", "Fresh-B"] as const;

/** Departments whose daily FIM figures are distorted by in-store production. */
export const PRODUCTION_DEPTS = new Set(["F06", "F09"]);

/**
 * Map any department identifier to the short guideline key. GR lines carry
 * SAP merchandise codes like "Z1/G12"; guidelines (and FIM) use the bare
 * suffix "G12". FIM already supplies the short code unchanged.
 */
export function guidelineKeyForDept(deptCode: string | null | undefined): string | undefined {
  if (!deptCode) return undefined;
  const s = deptCode.trim().toUpperCase().replace(/\s+/g, "");
  const suffix = s.includes("/") ? s.split("/").pop()! : s.replace(/^Z1[-_]?/, "");
  return suffix || undefined;
}

/**
 * The current guideline for every department: the row with the greatest
 * effective_from that is on or before `asOf` (default: today, UTC).
 */
export async function fetchCurrentGuidelines(
  env: Env,
  asOf?: string,
): Promise<Map<string, GuidelineRow>> {
  const day = asOf ?? new Date().toISOString().slice(0, 10);
  const rows = await env.DB.prepare(
    `SELECT dept_code, dept_name, dept_group, guideline_margin_pct,
            margin_contribution_pct, participation_guideline_pct, effective_from
     FROM dept_guidelines g
     WHERE g.effective_from <= ?1
       AND g.effective_from = (
         SELECT MAX(g2.effective_from) FROM dept_guidelines g2
         WHERE g2.dept_code = g.dept_code AND g2.effective_from <= ?1)`,
  )
    .bind(day)
    .all<GuidelineRow>();
  const map = new Map<string, GuidelineRow>();
  for (const r of rows.results ?? []) map.set(r.dept_code, r);
  return map;
}

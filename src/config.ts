/** Runtime bindings declared in wrangler.toml. */
export interface Env {
  DB: D1Database;
  UPLOADS_BUCKET: R2Bucket;

  DEFAULT_CURRENCY: string;
  BUDGET_AMBER_THRESHOLD: string;
  BUDGET_TIGHT_THRESHOLD: string;
  BUDGET_OVER_THRESHOLD: string;

  /** Optional shared secret guarding destructive routes (reset / bulk-delete /
   *  delete). Provision with `wrangler secret put ADMIN_TOKEN`. When set, those
   *  routes require a matching `X-Admin-Token` header; when unset, unenforced. */
  ADMIN_TOKEN?: string;
}

/** Static store identity (mirrors [vars] but available without an Env handle). */
export const STORE = {
  name: "Pick n Pay Lydenburg",
  legalEntity: "Dolly's Supermarket (Pty) Ltd",
  storeNumber: "2516",
  siteCode: "NF16",
  owner: "Jacobus Pretorius",
} as const;

export type BudgetStatus = "GREEN" | "AMBER" | "TIGHT" | "OVER";

export interface BudgetThresholds {
  amber: number;
  tight: number;
  over: number;
}

export function thresholds(env: Env): BudgetThresholds {
  return {
    amber: Number(env.BUDGET_AMBER_THRESHOLD ?? "0.85"),
    tight: Number(env.BUDGET_TIGHT_THRESHOLD ?? "0.95"),
    over: Number(env.BUDGET_OVER_THRESHOLD ?? "1.00"),
  };
}

/** Classify fraction-of-cap-used into a traffic-light budget status. */
export function budgetStatus(usedFraction: number, t: BudgetThresholds): BudgetStatus {
  if (usedFraction >= t.over) return "OVER";
  if (usedFraction >= t.tight) return "TIGHT";
  if (usedFraction >= t.amber) return "AMBER";
  return "GREEN";
}

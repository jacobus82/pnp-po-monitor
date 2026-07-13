/**
 * Settlement reconciliation engine (Brief 5) — the money-recovery core.
 *
 * Matches what we RECEIVED (EOD goods-receipts, aggregated per LIV DocNo) against
 * what PnP BILLED and settled (statement_lines, 5149/5150-series INVOICE lines
 * whose doc_number IS the LIV number). EOD GR rows are ALWAYS aggregated per LIV
 * first — one invoice covers many GRs, so row-level comparison would double-count.
 *
 * recomputeSettlement() rebuilds the open-items ledger + return-credit tracker from
 * the current eod_movements + statement_lines on every EOD/statement upload, so the
 * UI reads persisted rows (settlement_ledger / return_credits) — never recomputed
 * in the request path. State is derived from current data: MATCHED (billed within
 * tolerance) · OPEN/AGED (received, not yet billed) · BILLED_ONLY (billed, not
 * received). Claims = per-LIV (GR total − LIV value) beyond tolerance, signed.
 */
import { type Env } from "./config";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const TOL_DIRECT = 5; // Rand — direct vendors
const TOL_DC = 2000; // Rand — DC / MA15 lines
const AGE_FLAG_DAYS = 14;

/** DC / MA15 lines carry the wider R2,000 tolerance; everything else is direct (R5). */
function isDirect(name?: string | null): boolean {
  const n = (name ?? "").toLowerCase();
  return !/distribution\s+cent|(^|[^a-z])dc([^a-z]|$)|ma15|vector\s+logistic|eastport/.test(n);
}
function isFranchiseOneTime(name?: string | null): boolean {
  return /franchise\s+one\s+time\s+vendor/i.test(name ?? "");
}
function tolFor(direct: boolean): number {
  return direct ? TOL_DIRECT : TOL_DC;
}

interface EodLiv {
  liv_doc: string;
  gr_total: number;
  liv_value: number | null;
  gr_count: number;
  gr_date: string | null;
  po_number: string | null;
  supplier_no: string | null;
  supplier_name: string | null;
}

/**
 * Rebuild settlement_ledger + return_credits from current data. Called after each
 * EOD or statement ingest. Returns row counts for the response self-check.
 */
export async function recomputeSettlement(env: Env): Promise<{ ledger: number; returns: number; billedOnly: number }> {
  const today = (await env.DB.prepare(`SELECT date('now') d`).first<{ d: string }>())?.d ?? "";
  const fweeks = (
    await env.DB.prepare(`SELECT fiscal_week_code code, week_start, week_end FROM fiscal_weeks`).all<{
      code: string;
      week_start: string;
      week_end: string;
    }>()
  ).results ?? [];
  const weekOf = (d: string | null): string | null => {
    if (!d) return null;
    const w = fweeks.find((x) => x.week_start <= d && d <= x.week_end);
    return w ? w.code : null;
  };
  const daysBetween = (from: string | null): number | null =>
    from && today ? Math.max(0, Math.round((Date.parse(today) - Date.parse(from)) / 86400000)) : null;

  // 1. EOD goods-receipts aggregated per LIV DocNo (invoiced GRs). liv_value is
  //    consistent per LIV, so MAX() is a safe representative.
  const eodLivs =
    (
      await env.DB.prepare(
        `SELECT liv_doc,
                COALESCE(SUM(gr_val_in),0) gr_total, MAX(liv_value) liv_value, COUNT(*) gr_count,
                MAX(mvmt_date) gr_date, MAX(po_number) po_number,
                MAX(supplier_no) supplier_no, MAX(supplier_name) supplier_name
         FROM eod_movements
         WHERE movement_type LIKE 'Goods Receipt%' AND liv_doc IS NOT NULL AND liv_doc != ''
         GROUP BY liv_doc`,
      ).all<EodLiv>()
    ).results ?? [];

  // 2. Statement INVOICE lines aggregated per doc_number (= LIV number).
  const stmtDocs =
    (
      await env.DB.prepare(
        `SELECT doc_number, statement_no, COALESCE(SUM(amount),0) billed, COUNT(*) n
         FROM statement_lines WHERE line_type='INVOICE' AND doc_number LIKE '51%'
         GROUP BY doc_number`,
      ).all<{ doc_number: string; statement_no: string; billed: number; n: number }>()
    ).results ?? [];
  const stmtByDoc = new Map(stmtDocs.map((s) => [s.doc_number, s]));

  // 3. Received-not-billed with NO invoice yet (inv_status N/blank, no liv_doc),
  //    aggregated per material doc. These never appear on a statement.
  const openGrs =
    (
      await env.DB.prepare(
        `SELECT doc_no,
                COALESCE(SUM(gr_val_in),0) gr_total, COUNT(*) gr_count, MAX(mvmt_date) gr_date,
                MAX(po_number) po_number, MAX(supplier_no) supplier_no, MAX(supplier_name) supplier_name
         FROM eod_movements
         WHERE movement_type LIKE 'Goods Receipt%' AND (liv_doc IS NULL OR liv_doc='')
           AND COALESCE(inv_status,'') != 'C' AND doc_no IS NOT NULL AND doc_no != ''
         GROUP BY doc_no`,
      ).all<{ doc_no: string; gr_total: number; gr_count: number; gr_date: string | null; po_number: string | null; supplier_no: string | null; supplier_name: string | null }>()
    ).results ?? [];

  const rows: Array<Record<string, unknown>> = [];
  const matchedDocs = new Set<string>();

  for (const e of eodLivs) {
    if (isFranchiseOneTime(e.supplier_name)) continue; // FRANCHISE ONE TIME VENDOR excluded entirely
    const direct = isDirect(e.supplier_name);
    const stmt = stmtByDoc.get(e.liv_doc);
    const variance = e.liv_value != null ? Math.round((e.gr_total - e.liv_value) * 100) / 100 : null; // GR − LIV (signed claim)
    let status: string;
    let statementNo: string | null = null;
    let billed: number | null = null;
    let aging: number | null = null;
    if (stmt) {
      matchedDocs.add(e.liv_doc);
      status = "MATCHED";
      statementNo = stmt.statement_no;
      billed = Math.round(stmt.billed * 100) / 100;
    } else {
      aging = daysBetween(e.gr_date);
      status = aging != null && aging > AGE_FLAG_DAYS ? "AGED" : "OPEN";
    }
    rows.push({
      match_key: e.liv_doc, side: "eod", week_code: weekOf(e.gr_date),
      po_number: e.po_number, supplier_no: e.supplier_no, supplier_name: e.supplier_name,
      eod_gr_total: Math.round(e.gr_total * 100) / 100, eod_liv_value: e.liv_value, gr_count: e.gr_count,
      gr_date: e.gr_date, statement_no: statementNo, statement_amount: billed,
      variance_zar: variance, status, is_direct: direct ? 1 : 0, aging_days: aging,
    });
  }

  for (const g of openGrs) {
    if (isFranchiseOneTime(g.supplier_name)) continue;
    const aging = daysBetween(g.gr_date);
    rows.push({
      match_key: `GR:${g.doc_no}`, side: "eod", week_code: weekOf(g.gr_date),
      po_number: g.po_number, supplier_no: g.supplier_no, supplier_name: g.supplier_name,
      eod_gr_total: Math.round(g.gr_total * 100) / 100, eod_liv_value: null, gr_count: g.gr_count,
      gr_date: g.gr_date, statement_no: null, statement_amount: null,
      variance_zar: null, status: aging != null && aging > AGE_FLAG_DAYS ? "AGED" : "OPEN",
      is_direct: isDirect(g.supplier_name) ? 1 : 0, aging_days: aging,
    });
  }

  // 4. BILLED-NOT-RECEIVED: statement INVOICE docs with no EOD LIV match.
  let billedOnly = 0;
  for (const s of stmtDocs) {
    if (matchedDocs.has(s.doc_number)) continue;
    billedOnly++;
    rows.push({
      match_key: s.doc_number, side: "statement", week_code: s.statement_no,
      po_number: null, supplier_no: null, supplier_name: null,
      eod_gr_total: null, eod_liv_value: null, gr_count: 0, gr_date: null,
      statement_no: s.statement_no, statement_amount: Math.round(s.billed * 100) / 100,
      variance_zar: null, status: "BILLED_ONLY", is_direct: 1, aging_days: null,
    });
  }

  // Persist: rebuild the ledger wholesale (state is derived from current data).
  await env.DB.prepare(`DELETE FROM settlement_ledger`).run();
  const ins = env.DB.prepare(
    `INSERT INTO settlement_ledger
       (match_key, side, week_code, po_number, supplier_no, supplier_name, eod_gr_total,
        eod_liv_value, gr_count, gr_date, statement_no, statement_amount, variance_zar,
        status, is_direct, aging_days)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((r) =>
      ins.bind(
        r.match_key, r.side, r.week_code, r.po_number, r.supplier_no, r.supplier_name,
        r.eod_gr_total, r.eod_liv_value, r.gr_count, r.gr_date, r.statement_no,
        r.statement_amount, r.variance_zar, r.status, r.is_direct, r.aging_days,
      ),
    );
    if (batch.length) await env.DB.batch(batch);
  }

  const returns = await recomputeReturnCredits(env, weekOf, daysBetween);
  return { ledger: rows.length, returns, billedOnly };
}

/**
 * Return-credit tracking: each Goods Return Note should produce a statement DCRC
 * credit. Match return doc/reference to statement DCRC references; flag returns
 * with no credit after the aging threshold.
 */
async function recomputeReturnCredits(
  env: Env,
  weekOf: (d: string | null) => string | null,
  daysBetween: (d: string | null) => number | null,
): Promise<number> {
  const returns =
    (
      await env.DB.prepare(
        `SELECT doc_no, reference, po_number, supplier_no, supplier_name, mvmt_date,
                COALESCE(SUM(gr_val_in),0) return_value, COUNT(*) n
         FROM eod_movements WHERE movement_type LIKE 'Goods Return%'
         GROUP BY doc_no`,
      ).all<{ doc_no: string; reference: string | null; po_number: string | null; supplier_no: string | null; supplier_name: string | null; mvmt_date: string | null; return_value: number; n: number }>()
    ).results ?? [];

  // DCRC / credit-note statement lines, indexed by every reference token they carry.
  const creditLines =
    (
      await env.DB.prepare(
        `SELECT statement_no, doc_number, reference, delivery_ref, COALESCE(SUM(amount),0) amt
         FROM statement_lines
         WHERE line_type IN ('CREDIT_NOTE','INVOICE_REDUCTION','REBATE') OR reference LIKE '%DCRC%'
         GROUP BY statement_no, doc_number, reference, delivery_ref`,
      ).all<{ statement_no: string; doc_number: string; reference: string | null; delivery_ref: string | null; amt: number }>()
    ).results ?? [];
  const creditByRef = new Map<string, { statement_no: string; amt: number }>();
  for (const c of creditLines) {
    for (const key of [c.doc_number, c.reference, c.delivery_ref]) {
      if (key) creditByRef.set(String(key), { statement_no: c.statement_no, amt: c.amt });
    }
  }

  await env.DB.prepare(`DELETE FROM return_credits`).run();
  const ins = env.DB.prepare(
    `INSERT OR REPLACE INTO return_credits
       (return_doc, reference, po_number, supplier_no, supplier_name, return_date, return_value,
        week_code, credit_stmt_no, credit_amount, status, aging_days)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const batch = [];
  for (const r of returns) {
    const credit = (r.reference && creditByRef.get(r.reference)) || (r.doc_no && creditByRef.get(r.doc_no)) || null;
    const aging = daysBetween(r.mvmt_date);
    const status = credit ? "CREDITED" : aging != null && aging > AGE_FLAG_DAYS ? "AGED" : "AWAITING";
    batch.push(
      ins.bind(
        r.doc_no, r.reference, r.po_number, r.supplier_no, r.supplier_name, r.mvmt_date,
        Math.round(r.return_value * 100) / 100, weekOf(r.mvmt_date),
        credit?.statement_no ?? null, credit ? Math.round(credit.amt * 100) / 100 : null, status, aging,
      ),
    );
  }
  for (let i = 0; i < batch.length; i += 100) {
    const b = batch.slice(i, i + 100);
    if (b.length) await env.DB.batch(b);
  }
  return returns.length;
}

/**
 * GET /api/settlement?week= — the persisted three-bucket reconciliation for a
 * fiscal week: summary tiles, the billing-variance (claims) table, uninvoiced
 * aging, billed-not-received, and returns-without-credit — all read from the
 * ledger (no recompute here). `week` defaults to the latest week with EOD data.
 */
export async function handleSettlement(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  let week = q.get("week");
  if (!week) {
    week = (await env.DB.prepare(`SELECT week_code FROM settlement_ledger WHERE side='eod' AND week_code IS NOT NULL ORDER BY week_code DESC LIMIT 1`).first<{ week_code: string }>())?.week_code ?? null;
  }

  const [ledger, weeks, ret] = await Promise.all([
    env.DB.prepare(
      `SELECT match_key, side, po_number, supplier_no, supplier_name, eod_gr_total, eod_liv_value,
              gr_count, gr_date, statement_no, statement_amount, variance_zar, status, is_direct, aging_days
       FROM settlement_ledger WHERE week_code = ? ORDER BY ABS(COALESCE(variance_zar,0)) DESC`,
    ).bind(week).all<Record<string, number | string | null>>(),
    env.DB.prepare(`SELECT DISTINCT week_code FROM settlement_ledger WHERE week_code IS NOT NULL ORDER BY week_code DESC`).all<{ week_code: string }>(),
    env.DB.prepare(
      `SELECT return_doc, reference, po_number, supplier_name, return_date, return_value, credit_stmt_no, credit_amount, status, aging_days
       FROM return_credits WHERE week_code = ? ORDER BY aging_days DESC`,
    ).bind(week).all<Record<string, number | string | null>>(),
  ]);
  const rows = ledger.results ?? [];

  const eod = rows.filter((r) => r.side === "eod");
  const matched = eod.filter((r) => r.status === "MATCHED");
  const received = eod.filter((r) => r.status === "OPEN" || r.status === "AGED"); // received-not-billed
  const billed = rows.filter((r) => r.status === "BILLED_ONLY");
  const rnd = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;
  const sum = (arr: typeof rows, k: string) => rnd(arr.reduce((a, r) => a + Number(r[k] ?? 0), 0));

  // Claims = per-LIV GR−LIV variance beyond tolerance (R5 direct / R2000 DC).
  // Confidence: a single-GR-row LIV's variance is exactly SAP's own GR-LIV figure —
  // CONFIRMED. Multi-GR-row LIVs are aggregated per the spec, but a mis-tagged
  // liv_doc (two POs sharing one LIV, common on partial-week EOD) can inflate the
  // variance — flag needsVerify so those are checked via the drill before raising.
  const claims = eod
    .filter((r) => r.variance_zar != null && Math.abs(Number(r.variance_zar)) > (r.is_direct ? TOL_DIRECT : TOL_DC))
    .map((r) => {
      const grCount = Number(r.gr_count ?? 0);
      const livVal = Number(r.eod_liv_value ?? 0);
      const varZ = Number(r.variance_zar ?? 0);
      // Suspicious if multiple GR rows AND the variance is a large share of the invoice.
      const needsVerify = grCount > 1 && livVal > 0 && Math.abs(varZ) > 0.5 * livVal;
      return {
        po_number: r.po_number, liv_doc: r.match_key, supplier_name: r.supplier_name,
        grTotal: rnd(r.eod_gr_total), livValue: rnd(r.eod_liv_value), billed: r.statement_amount != null ? rnd(r.statement_amount) : null,
        variance: rnd(r.variance_zar), isDirect: !!r.is_direct, status: r.status,
        grCount, confidence: needsVerify ? "verify" : "confirmed",
      };
    })
    // Confirmed claims first, then by size — the actionable list surfaces at the top.
    .sort((a, b) => (a.confidence === b.confidence ? Math.abs(b.variance) - Math.abs(a.variance) : a.confidence === "confirmed" ? -1 : 1));

  return json({
    week,
    weeks: (weeks.results ?? []).map((w) => w.week_code),
    tiles: {
      matched: { count: matched.length, value: sum(matched, "statement_amount") },
      billedNotReceived: { count: billed.length, value: sum(billed, "statement_amount") },
      receivedNotBilled: { count: received.length, value: sum(received, "eod_gr_total"), aged: received.filter((r) => r.status === "AGED").length },
      claims: { count: claims.length, value: rnd(claims.reduce((a, c) => a + Math.abs(c.variance), 0)) },
    },
    claims,
    receivedNotBilled: received.map((r) => ({
      key: r.match_key, po_number: r.po_number, supplier_name: r.supplier_name,
      grTotal: rnd(r.eod_gr_total), grDate: r.gr_date, agingDays: r.aging_days, status: r.status,
    })),
    billedNotReceived: billed.map((r) => ({ liv_doc: r.match_key, statement_no: r.statement_no, billed: rnd(r.statement_amount) })),
    returnsWithoutCredit: (ret.results ?? []).filter((r) => r.status !== "CREDITED").map((r) => ({
      return_doc: r.return_doc, reference: r.reference, po_number: r.po_number, supplier_name: r.supplier_name,
      return_date: r.return_date, returnValue: rnd(r.return_value), agingDays: r.aging_days, status: r.status,
    })),
  });
}

/** GET /api/settlement/liv?liv= — drill: the EOD GR rows + statement lines behind a LIV. */
export async function handleSettlementLiv(req: Request, env: Env): Promise<Response> {
  const liv = new URL(req.url).searchParams.get("liv");
  if (!liv) return json({ error: "liv is required." }, 400);
  const key = liv.startsWith("GR:") ? null : liv;
  const [grRows, stmtRows, ledger] = await Promise.all([
    env.DB.prepare(
      `SELECT mvmt_date, doc_no, po_number, supplier_name, gr_val_ex, gr_vat, gr_val_in, inv_status, gr_liv_var, liv_doc, liv_value
       FROM eod_movements WHERE ${key ? "liv_doc = ?" : "doc_no = ?"} ORDER BY mvmt_date`,
    ).bind(key ?? liv.slice(3)).all<Record<string, number | string | null>>(),
    key
      ? env.DB.prepare(
          `SELECT statement_no, doc_number, reference, amount, line_type FROM statement_lines WHERE doc_number = ? ORDER BY amount DESC`,
        ).bind(key).all<Record<string, number | string | null>>()
      : Promise.resolve({ results: [] as Array<Record<string, number | string | null>> }),
    env.DB.prepare(`SELECT * FROM settlement_ledger WHERE match_key = ? LIMIT 1`).bind(liv).first<Record<string, number | string | null>>(),
  ]);
  return json({ liv, ledger, grRows: grRows.results ?? [], statementLines: stmtRows.results ?? [] });
}

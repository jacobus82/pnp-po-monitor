import type { Env } from "../config";
import type { EodRow } from "../parser/eodParser";
import type { FiscalCalendar } from "../fiscal";
import type {
  Anomaly,
  ParsedCustomerRow,
  ParsedFimArticle,
  ParsedFimRow,
  ParsedGrLine,
  ParsedPoLine,
  FanScoreParseResult,
} from "../types";

/** Upsert a vendor, returning its id. */
async function upsertVendor(env: Env, code: string, name?: string): Promise<number> {
  await env.DB.prepare(
    `INSERT INTO vendors (vendor_code, name) VALUES (?, ?)
     ON CONFLICT(vendor_code) DO UPDATE SET
       name = COALESCE(excluded.name, vendors.name),
       last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  )
    .bind(code, name ?? null)
    .run();
  const row = await env.DB.prepare(`SELECT id FROM vendors WHERE vendor_code = ?`)
    .bind(code)
    .first<{ id: number }>();
  return row!.id;
}

/** Upsert an article, returning its id and its previous reference price (cents). */
async function upsertArticle(
  env: Env,
  code: string,
  description?: string,
  uom?: string,
  department?: string,
  netPriceCents?: number,
): Promise<{ id: number; previousPriceCents: number | null }> {
  const existing = await env.DB.prepare(
    `SELECT id, last_net_price_cents FROM articles WHERE article_code = ?`,
  )
    .bind(code)
    .first<{ id: number; last_net_price_cents: number | null }>();

  if (existing) {
    await env.DB.prepare(
      `UPDATE articles SET
         description = COALESCE(?, description),
         uom = COALESCE(?, uom),
         department = COALESCE(?, department),
         last_net_price_cents = COALESCE(?, last_net_price_cents),
         last_seen = strftime('%Y-%m-%dT%H:%M:%SZ','now')
       WHERE id = ?`,
    )
      .bind(description ?? null, uom ?? null, department ?? null, netPriceCents ?? null, existing.id)
      .run();
    return { id: existing.id, previousPriceCents: existing.last_net_price_cents };
  }

  const res = await env.DB.prepare(
    `INSERT INTO articles (article_code, description, uom, department, last_net_price_cents)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(code, description ?? null, uom ?? null, department ?? null, netPriceCents ?? null)
    .run();
  return { id: Number(res.meta.last_row_id), previousPriceCents: null };
}

export interface CreateUploadInput {
  filename: string;
  r2Key: string;
  contentHash: string;
  sizeBytes: number;
}

export async function createUpload(
  env: Env,
  input: CreateUploadInput,
  kind: "po" | "gr" | "fim" | "cc" | "fs" | "eod" = "po",
): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO uploads (filename, r2_key, content_hash, size_bytes, status, kind)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(input.filename, input.r2Key, input.contentHash, input.sizeBytes, kind)
    .run();
  return Number(res.meta.last_row_id);
}

export async function findUploadByHash(env: Env, hash: string): Promise<{ id: number } | null> {
  return env.DB.prepare(`SELECT id FROM uploads WHERE content_hash = ? LIMIT 1`)
    .bind(hash)
    .first<{ id: number }>();
}

export async function markUploadParsed(
  env: Env,
  uploadId: number,
  delimiter: string,
  rowCount: number,
  skipped: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE uploads SET status='parsed', detected_delimiter=?, row_count=?, skipped_rows=? WHERE id=?`,
  )
    .bind(delimiter, rowCount, skipped, uploadId)
    .run();
}

export async function markUploadError(env: Env, uploadId: number, message: string): Promise<void> {
  await env.DB.prepare(`UPDATE uploads SET status='error', error_message=? WHERE id=?`)
    .bind(message.slice(0, 2000), uploadId)
    .run();
}

/** The id + price context returned after persisting a line, for anomaly detection. */
export interface InsertedLine {
  id: number;
  line: ParsedPoLine;
  previousPriceCents: number | null;
}

/**
 * Persist one parsed PO line plus its vendor/article. D1 has no long-lived
 * transactions across awaits the way a server does, so we insert sequentially;
 * the master upserts are idempotent.
 */
export async function insertPoLine(
  env: Env,
  uploadId: number,
  line: ParsedPoLine,
): Promise<InsertedLine> {
  const vendorId = line.vendorCode
    ? await upsertVendor(env, line.vendorCode, line.vendorName)
    : null;

  let articleId: number | null = null;
  let previousPriceCents: number | null = null;
  if (line.articleCode) {
    const art = await upsertArticle(
      env,
      line.articleCode,
      line.articleDescription,
      line.uom,
      line.department,
      line.netPriceCents,
    );
    articleId = art.id;
    previousPriceCents = art.previousPriceCents;
  }

  const res = await env.DB.prepare(
    `INSERT INTO po_lines (
        upload_id, vendor_id, article_id, po_number, po_line_no, currency,
        order_qty, uom, sku_qty, sku_uom, net_price_cents, line_value_cents,
        gr_qty, open_qty, open_value_cents,
        order_date, delivery_date, line_status, raw_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      uploadId,
      vendorId,
      articleId,
      line.poNumber,
      line.poLineNo ?? null,
      line.currency,
      line.orderQty ?? null,
      line.uom ?? null,
      line.skuQty ?? null,
      line.skuUom ?? null,
      line.netPriceCents ?? null,
      line.lineValueCents ?? null,
      line.grQty ?? null,
      line.openQty ?? null,
      line.openValueCents ?? null,
      line.orderDate ?? null,
      line.deliveryDate ?? null,
      line.lineStatus,
      JSON.stringify(line.raw),
    )
    .run();

  return { id: Number(res.meta.last_row_id), line, previousPriceCents };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Persist a whole upload's PO lines using batched D1 statements instead of
 * ~5 sequential queries per line. This keeps the request well under the Workers
 * per-invocation subrequest limit (which a large file otherwise blows, throwing
 * "Too many API requests by single worker invocation").
 *
 * Strategy (a handful of subrequests regardless of line count):
 *   1. read existing reference prices for price-spike detection (chunked reads)
 *   2. batch-upsert unique vendors, then unique articles
 *   3. read back vendor/article ids
 *   4. batch-insert po_lines, then read their ids back in insertion order
 */
export async function insertPoLinesBatch(
  env: Env,
  uploadId: number,
  lines: ParsedPoLine[],
): Promise<InsertedLine[]> {
  if (lines.length === 0) return [];

  // 1. Unique vendors/articles (last non-null field wins, matching the loop).
  const vendorName = new Map<string, string | null>();
  const articleMeta = new Map<
    string,
    { description?: string; uom?: string; department?: string; netPriceCents?: number }
  >();
  for (const l of lines) {
    if (l.vendorCode) {
      const cur = vendorName.get(l.vendorCode) ?? null;
      vendorName.set(l.vendorCode, l.vendorName ?? cur);
    }
    if (l.articleCode) {
      const prev = articleMeta.get(l.articleCode) ?? {};
      articleMeta.set(l.articleCode, {
        description: l.articleDescription ?? prev.description,
        uom: l.uom ?? prev.uom,
        department: l.department ?? prev.department,
        netPriceCents: l.netPriceCents ?? prev.netPriceCents,
      });
    }
  }
  const vendorCodes = [...vendorName.keys()];
  const articleCodes = [...articleMeta.keys()];

  // 2. Resolve vendor/article ids from ONE full-table load each into a Map. This
  //    replaces the old O(batches) chunked id read-backs (and the per-article
  //    price-history read) with O(1) lookups — that per-invocation query count was
  //    what tipped large PO slices over the Worker limit and 503'd them. Price
  //    history is no longer maintained on ingest; derive it on demand from po_lines.
  const vendorId = new Map<string, number>();
  {
    const rows = await env.DB.prepare(`SELECT vendor_code, id FROM vendors`).all<{
      vendor_code: string;
      id: number;
    }>();
    for (const r of rows.results ?? []) vendorId.set(r.vendor_code, r.id);
  }
  const articleId = new Map<string, number>();
  {
    const rows = await env.DB.prepare(`SELECT article_code, id FROM articles`).all<{
      article_code: string;
      id: number;
    }>();
    for (const r of rows.results ?? []) articleId.set(r.article_code, r.id);
  }

  // 3. Insert masters new to this file, recording each new id (rowid alias) back
  //    into the same Map so the line-insert loop resolves every id from memory
  //    with zero further queries. Existing masters are left untouched.
  const newVendors = vendorCodes.filter((code) => !vendorId.has(code));
  if (newVendors.length) {
    const v = env.DB.prepare(`INSERT INTO vendors (vendor_code, name) VALUES (?, ?)`);
    for (const c of chunk(newVendors, 200)) {
      const res = await env.DB.batch(c.map((code) => v.bind(code, vendorName.get(code) ?? null)));
      c.forEach((code, i) => vendorId.set(code, Number(res[i]!.meta.last_row_id)));
    }
  }

  const newArticles = articleCodes.filter((code) => !articleId.has(code));
  if (newArticles.length) {
    const a = env.DB.prepare(
      `INSERT INTO articles (article_code, description, uom, department, last_net_price_cents)
       VALUES (?,?,?,?,?)`,
    );
    for (const c of chunk(newArticles, 200)) {
      const res = await env.DB.batch(
        c.map((code) => {
          const m = articleMeta.get(code)!;
          return a.bind(code, m.description ?? null, m.uom ?? null, m.department ?? null, m.netPriceCents ?? null);
        }),
      );
      c.forEach((code, i) => articleId.set(code, Number(res[i]!.meta.last_row_id)));
    }
  }

  // 5. Batch-insert po_lines.
  const ins = env.DB.prepare(
    `INSERT INTO po_lines (
        upload_id, vendor_id, article_id, po_number, po_line_no, currency,
        order_qty, uom, sku_qty, sku_uom, net_price_cents, line_value_cents,
        gr_qty, open_qty, open_value_cents, open_invoice_cents,
        mdse_cat, sloc, order_date, delivery_date, line_status, raw_json
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  // Capture each new row id from the batch result's last_row_id (per statement),
  // so there is no need to read 1000s of rows back afterwards.
  const ids: number[] = [];
  // 200/batch: keeps each D1 batch's write amplification (po_lines has ~10 indexes,
  // so every row is ~11 writes) under D1's per-operation CPU limit. Larger batches
  // were tried and made very large slices WORSE — they tip a single D1 op over the
  // limit and reset it. Keep slices ≲60k rows so the whole ingest stays under it.
  for (const c of chunk(lines, 200)) {
    const results = await env.DB.batch(
      c.map((line) =>
        ins.bind(
          uploadId,
          line.vendorCode ? vendorId.get(line.vendorCode) ?? null : null,
          line.articleCode ? articleId.get(line.articleCode) ?? null : null,
          line.poNumber,
          line.poLineNo ?? null,
          line.currency,
          line.orderQty ?? null,
          line.uom ?? null,
          line.skuQty ?? null,
          line.skuUom ?? null,
          line.netPriceCents ?? null,
          line.lineValueCents ?? null,
          line.grQty ?? null,
          line.openQty ?? null,
          line.openValueCents ?? null,
          line.openInvoiceCents ?? null,
          line.mdseCat ?? null,
          line.sloc ?? null,
          line.orderDate ?? null,
          line.deliveryDate ?? null,
          line.lineStatus,
          JSON.stringify(line.raw),
        ),
      ),
    );
    for (const r of results) ids.push(Number(r.meta.last_row_id));
  }
  if (ids.length !== lines.length) {
    throw new Error(`po_lines insert count mismatch: expected ${lines.length}, got ${ids.length}`);
  }

  // previousPriceCents is no longer read on ingest (price history is derived on
  // demand from po_lines); kept null so the InsertedLine shape is unchanged.
  return lines.map((line, i) => ({
    id: ids[i]!,
    line,
    previousPriceCents: null,
  }));
}

/**
 * Recompute the GR-receipt rollups on every po_line from gr_lines, matched by
 * po_number + article_code. po_lines stores article_id (FK), so the match joins
 * through the articles table to recover the article_code that gr_lines carries.
 *
 * Run after each GR or PO upload (and once to backfill). Two statements:
 *   1. reset every row (so lines that lost their GR match revert to zero), then
 *   2. apply the aggregate via UPDATE ... FROM (SQLite >= 3.33, supported by D1).
 *
 * received_value is in RAND (gr_lines.cost_zar is Rand); line_value_cents is cents.
 *
 * is_fully_received is derived from SAP's own open_value_cents (<= 0 means nothing
 * outstanding), NOT from the GR aggregate qty. Historical lines often can't have
 * their received_qty reproduced from gr_lines, so keying the flag off received_qty
 * left ~99% of old fully-received lines wrongly flagged open. open_value_cents is
 * authoritative for whether a line is closed.
 */
export async function recomputeReceipts(env: Env): Promise<void> {
  const reset = env.DB.prepare(
    `UPDATE po_lines
        SET received_qty = 0, received_value = 0, last_gr_date = NULL,
            is_fully_received = CASE
              WHEN open_value_cents IS NOT NULL AND open_value_cents <= 0 THEN 1 ELSE 0 END`,
  );
  const apply = env.DB.prepare(
    `UPDATE po_lines AS p
        SET received_qty      = agg.rq,
            received_value    = agg.rv,
            last_gr_date      = agg.lgr,
            is_fully_received = CASE
              WHEN p.open_value_cents IS NOT NULL AND p.open_value_cents <= 0 THEN 1 ELSE 0 END
      FROM (
        SELECT p2.id AS pid,
               COALESCE(SUM(g.qty), 0)      AS rq,
               COALESCE(SUM(g.cost_zar), 0) AS rv,
               MAX(g.gr_date)               AS lgr
        FROM po_lines p2
        JOIN articles a ON a.id = p2.article_id
        JOIN gr_lines g ON g.po_number = p2.po_number AND g.article_code = a.article_code
        GROUP BY p2.id
      ) AS agg
      WHERE p.id = agg.pid`,
  );
  await env.DB.batch([reset, apply]);
}

export async function insertAnomalies(
  env: Env,
  uploadId: number | null,
  anomalies: Anomaly[],
): Promise<void> {
  if (anomalies.length === 0) return;
  const stmt = env.DB.prepare(
    `INSERT INTO anomalies (upload_id, po_line_id, type, severity, message, detail_json)
     VALUES (?,?,?,?,?,?)`,
  );
  // Chunk so a high-anomaly-count file does not exceed the D1 batch size limit.
  for (const c of chunk(anomalies, 200)) {
    await env.DB.batch(
      c.map((a) =>
        stmt.bind(
          uploadId,
          a.poLineId ?? null,
          a.type,
          a.severity,
          a.message,
          a.detail ? JSON.stringify(a.detail) : null,
        ),
      ),
    );
  }
}

/** Bulk-insert goods-receipt lines for one upload (batched). */
export async function insertGrLines(
  env: Env,
  uploadId: number,
  lines: ParsedGrLine[],
): Promise<number> {
  if (lines.length === 0) return 0;
  const stmt = env.DB.prepare(
    `INSERT INTO gr_lines (
        upload_id, po_number, article_code, article_desc, dept_code, dept_name,
        qty, cost_zar, sell_zar, margin_pct, gr_date
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const c of chunk(lines, 200)) {
    await env.DB.batch(
      c.map((l) =>
        stmt.bind(
          uploadId,
          l.poNumber ?? null,
          l.articleCode ?? null,
          l.articleDesc ?? null,
          l.deptCode ?? null,
          l.deptName ?? null,
          l.qty ?? null,
          l.costZar ?? null,
          l.sellZar ?? null,
          l.marginPct ?? null,
          l.grDate ?? null,
        ),
      ),
    );
  }
  return lines.length;
}

/** Delete EOD movements for a set of ISO dates (replace-on-reload by week). */
export async function deleteEodByDates(env: Env, dates: string[]): Promise<void> {
  if (!dates.length) return;
  for (const c of chunk(dates, 50)) {
    const ph = c.map(() => "?").join(",");
    await env.DB.prepare(`DELETE FROM eod_movements WHERE mvmt_date IN (${ph})`).bind(...c).run();
  }
}

/**
 * Delete EOD movements by material DocumentNo — the stable per-movement identity.
 * Ingest calls this with the incoming file's doc_nos so the SAME movement can
 * never be contributed to the ledger twice, even across overlapping-week files or
 * re-exports where mvmt_date-based clearing would miss it.
 */
export async function deleteEodByDocs(env: Env, docNos: string[]): Promise<void> {
  const docs = [...new Set(docNos.filter((d): d is string => !!d && d.trim() !== ""))];
  if (!docs.length) return;
  for (const c of chunk(docs, 50)) {
    const ph = c.map(() => "?").join(",");
    await env.DB.prepare(`DELETE FROM eod_movements WHERE doc_no IN (${ph})`).bind(...c).run();
  }
}

/** Persist EOD movement rows. Batched in chunks of 200 (as insertGrLines). */
export async function insertEodMovements(env: Env, uploadId: number, rows: EodRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const stmt = env.DB.prepare(
    `INSERT INTO eod_movements (
        upload_id, movement_type, mvmt_code, mvmt_date, doc_no, po_number, supplier_no,
        supplier_name, reference, gr_reference, gr_val_ex, gr_vat, gr_val_in, currency,
        inv_status, gr_liv_var, liv_doc, liv_date, liv_value, dcrc_type, claim_value
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const c of chunk(rows, 200)) {
    await env.DB.batch(
      c.map((r) =>
        stmt.bind(
          uploadId,
          r.movementType ?? null, r.mvmtCode ?? null, r.date ?? null, r.docNo ?? null,
          r.poNumber ?? null, r.supplierNo ?? null, r.supplierName ?? null, r.reference ?? null,
          r.grReference ?? null, r.grValEx ?? null, r.grVat ?? null, r.grValIn ?? null,
          r.currency ?? null, r.invStatus ?? null, r.grLivVar ?? null, r.livDoc ?? null,
          r.livDate ?? null, r.livValue ?? null, r.dcrcType ?? null, r.claimValue ?? null,
        ),
      ),
    );
  }
  return rows.length;
}

/**
 * Persist customer-count rows. UNIQUE(cal_date) means daily re-exports UPSERT —
 * the latest upload's figures for a given day win. Batched in chunks of 200 (same
 * as insertGrLines); customer_counts has only two indexes so write amplification
 * is negligible.
 */
export async function insertCustomerCounts(
  env: Env,
  uploadId: number,
  rows: ParsedCustomerRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const stmt = env.DB.prepare(
    `INSERT INTO customer_counts (
        upload_id, cal_date, site_code, customers_ty, customers_ly,
        sales_ty_cents, sales_ly_cents, units_ty, units_ly,
        basket_ty_cents, units_per_cust_ty
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cal_date) DO UPDATE SET
        upload_id        = excluded.upload_id,
        site_code        = excluded.site_code,
        customers_ty     = excluded.customers_ty,
        customers_ly     = excluded.customers_ly,
        sales_ty_cents   = excluded.sales_ty_cents,
        sales_ly_cents   = excluded.sales_ly_cents,
        units_ty         = excluded.units_ty,
        units_ly         = excluded.units_ly,
        basket_ty_cents  = excluded.basket_ty_cents,
        units_per_cust_ty = excluded.units_per_cust_ty`,
  );
  for (const c of chunk(rows, 200)) {
    await env.DB.batch(
      c.map((r) =>
        stmt.bind(
          uploadId,
          r.calDate,
          r.siteCode ?? null,
          r.customersTy ?? null,
          r.customersLy ?? null,
          r.salesTyCents ?? null,
          r.salesLyCents ?? null,
          r.unitsTy ?? null,
          r.unitsLy ?? null,
          r.basketTyCents ?? null,
          r.unitsPerCustTy ?? null,
        ),
      ),
    );
  }
  return rows.length;
}

export interface FanScoreSummary {
  weekEnding: string;
  totalResponses: number;
  scoredResponses: number;
  promoters: number;
  passives: number;
  detractors: number;
  npsComputed: number | null;
}

/**
 * Persist a parsed Fan Score report: replace the week's individual responses and
 * UPSERT the per-week summary (the report's stated NPS TW/LW plus the counts and
 * NPS we compute from the responses). One summary row per week_ending.
 */
export async function insertFanScore(
  env: Env,
  uploadId: number,
  parsed: FanScoreParseResult,
): Promise<FanScoreSummary> {
  const week = parsed.weekEnding;
  if (!week) throw new Error("Fan Score report has no week-ending (W/E) date.");

  // Re-upload safety: replace this week's responses wholesale.
  await env.DB.prepare(`DELETE FROM fan_score_responses WHERE week_ending = ?`).bind(week).run();

  const stmt = env.DB.prepare(
    `INSERT INTO fan_score_responses (upload_id, week_ending, site_code, score, classification, reason)
     VALUES (?,?,?,?,?,?)`,
  );
  for (const c of chunk(parsed.responses, 200)) {
    await env.DB.batch(
      c.map((r) =>
        stmt.bind(
          uploadId,
          week,
          parsed.siteCode ?? null,
          r.score ?? null,
          r.classification ?? null,
          r.reason ?? null,
        ),
      ),
    );
  }

  let scored = 0;
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const r of parsed.responses) {
    if (r.score == null) continue;
    scored++;
    if (r.classification === "promoter") promoters++;
    else if (r.classification === "passive") passives++;
    else if (r.classification === "detractor") detractors++;
  }
  const npsComputed = scored > 0 ? Math.round(((promoters - detractors) / scored) * 10000) / 100 : null;

  await env.DB.prepare(
    `INSERT INTO fan_score_weeks
       (week_ending, upload_id, site_code, nps_tw, nps_lw, total_responses, scored_responses,
        promoters, passives, detractors, nps_computed)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(week_ending) DO UPDATE SET
        upload_id=excluded.upload_id, site_code=excluded.site_code,
        nps_tw=excluded.nps_tw, nps_lw=excluded.nps_lw,
        total_responses=excluded.total_responses, scored_responses=excluded.scored_responses,
        promoters=excluded.promoters, passives=excluded.passives, detractors=excluded.detractors,
        nps_computed=excluded.nps_computed`,
  )
    .bind(
      week,
      uploadId,
      parsed.siteCode ?? null,
      parsed.npsTw ?? null,
      parsed.npsLw ?? null,
      parsed.responses.length,
      scored,
      promoters,
      passives,
      detractors,
      npsComputed,
    )
    .run();

  return {
    weekEnding: week,
    totalResponses: parsed.responses.length,
    scoredResponses: scored,
    promoters,
    passives,
    detractors,
    npsComputed,
  };
}

/** Category Portfolio → primary SAP department (first row per CP in the hierarchy). */
export async function cpToDeptMap(env: Env): Promise<Map<string, { deptCode: string; deptName: string }>> {
  const rows = await env.DB.prepare(
    `SELECT cp_no, sap_dept_code, sap_dept_name FROM merchandise_hierarchy m
     WHERE id = (SELECT MIN(id) FROM merchandise_hierarchy m2 WHERE m2.cp_no = m.cp_no)`,
  ).all<{ cp_no: string; sap_dept_code: string; sap_dept_name: string }>();
  const map = new Map<string, { deptCode: string; deptName: string }>();
  for (const r of rows.results ?? []) {
    if (r.cp_no) map.set(String(r.cp_no).trim(), { deptCode: r.sap_dept_code, deptName: r.sap_dept_name });
  }
  return map;
}

/**
 * Does FIM data already exist for this period? Dedup is keyed by (range, is-freshb):
 * a 'weekly_freshb' upload only dedups against existing weekly_freshb rows, and a
 * general (daily/weekly/monthly) upload only against non-freshb rows — so a Fresh B
 * weekly file and a general weekly for the same week never block each other.
 */
export async function fimPeriodExists(
  env: Env,
  dateFrom: string,
  dateTo: string,
  reportType?: string,
): Promise<boolean> {
  const freshb = reportType === "weekly_freshb";
  const row = await env.DB.prepare(
    `SELECT 1 FROM fim_daily WHERE date_from = ? AND date_to = ?
       AND report_type ${freshb ? "=" : "!="} 'weekly_freshb' LIMIT 1`,
  )
    .bind(dateFrom, dateTo)
    .first();
  return row != null;
}

export interface FimPeriod {
  reportDate: string;
  dateFrom: string;
  dateTo: string;
  reportType: string;
}

/**
 * Upsert FIM department rows (plus the optional TOTAL row) for one period.
 * Conflicts on (date_from, date_to, dept_code) overwrite the prior figures, so a
 * daily and a weekly/monthly row for overlapping dates coexist. Returns the
 * number of rows written.
 */
export async function insertFimRows(
  env: Env,
  uploadId: number,
  period: FimPeriod,
  fiscal: FiscalCalendar,
  rows: ParsedFimRow[],
  total?: ParsedFimRow,
): Promise<number> {
  const all = total ? [...rows, total] : rows;
  if (all.length === 0) return 0;

  const stmt = env.DB.prepare(
    `INSERT INTO fim_daily (
        report_date, report_type, date_from, date_to, fiscal_year, fiscal_quarter, fiscal_week,
        fiscal_week_start, fiscal_week_end, day_of_week,
        dept_code, dept_name, net_sales_zar, total_cos_zar, pos_profit_zar,
        pos_margin_pct, operating_margin_pct, shrink_zar, waste_zar,
        store_margin_pct, total_purchases_zar, net_gr_cost_zar, upload_id,
        opening_soh_zar, closing_soh_zar, commercial_disc_zar, line_disc_zar, basket_disc_zar,
        trade_invest_zar, sallies_tallies_zar, swell_allowance_zar,
        total_shortages_zar, net_shrinkage_zar, rtc_zar
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(date_from, date_to, dept_code, report_type) DO UPDATE SET
        report_date=excluded.report_date, report_type=excluded.report_type,
        fiscal_year=excluded.fiscal_year, fiscal_quarter=excluded.fiscal_quarter,
        fiscal_week=excluded.fiscal_week, fiscal_week_start=excluded.fiscal_week_start,
        fiscal_week_end=excluded.fiscal_week_end, day_of_week=excluded.day_of_week,
        dept_name=excluded.dept_name, net_sales_zar=excluded.net_sales_zar,
        total_cos_zar=excluded.total_cos_zar, pos_profit_zar=excluded.pos_profit_zar,
        pos_margin_pct=excluded.pos_margin_pct, operating_margin_pct=excluded.operating_margin_pct,
        shrink_zar=excluded.shrink_zar, waste_zar=excluded.waste_zar,
        store_margin_pct=excluded.store_margin_pct, total_purchases_zar=excluded.total_purchases_zar,
        net_gr_cost_zar=excluded.net_gr_cost_zar, upload_id=excluded.upload_id,
        opening_soh_zar=excluded.opening_soh_zar, closing_soh_zar=excluded.closing_soh_zar,
        commercial_disc_zar=excluded.commercial_disc_zar, line_disc_zar=excluded.line_disc_zar,
        basket_disc_zar=excluded.basket_disc_zar, trade_invest_zar=excluded.trade_invest_zar,
        sallies_tallies_zar=excluded.sallies_tallies_zar, swell_allowance_zar=excluded.swell_allowance_zar,
        total_shortages_zar=excluded.total_shortages_zar, net_shrinkage_zar=excluded.net_shrinkage_zar,
        rtc_zar=excluded.rtc_zar`,
  );

  const batch = all.map((r) => {
    const posProfit =
      r.netSalesZar != null && r.totalCosZar != null
        ? Math.round((r.netSalesZar - r.totalCosZar) * 100) / 100
        : null;
    return stmt.bind(
      period.reportDate,
      period.reportType,
      period.dateFrom,
      period.dateTo,
      fiscal.fiscalYear,
      fiscal.fiscalQuarter,
      fiscal.fiscalWeek,
      fiscal.fiscalWeekStart,
      fiscal.fiscalWeekEnd,
      fiscal.dayOfWeek,
      r.deptCode,
      r.deptName ?? null,
      r.netSalesZar ?? null,
      r.totalCosZar ?? null,
      posProfit,
      r.posMarginPct ?? null,
      r.operatingMarginPct ?? null,
      r.shrinkZar ?? null,
      r.wasteZar ?? null,
      r.storeMarginPct ?? null,
      r.totalPurchasesZar ?? null,
      r.netGrCostZar ?? null,
      uploadId,
      r.openingSohZar ?? null,
      r.closingSohZar ?? null,
      r.commercialDiscZar ?? null,
      r.lineDiscZar ?? null,
      r.basketDiscZar ?? null,
      r.tradeInvestZar ?? null,
      r.salliesTalliesZar ?? null,
      r.swellAllowanceZar ?? null,
      r.totalShortagesZar ?? null,
      r.netShrinkageZar ?? null,
      r.rtcZar ?? null,
    );
  });
  // Chunk the batch: a single oversized D1.batch (e.g. if a malformed export
  // slips many rows through) can exceed D1 limits and surface as an HTTP 503.
  for (const c of chunk(batch, 50)) await env.DB.batch(c);
  return all.length;
}

/**
 * Store the article-level FIM rows that carry waste/shrink (for the waste
 * drill-down). Deletes any existing rows for this upload first so re-processing
 * (backfill) is idempotent. `articles[].deptCode` must already be the rolled-up
 * SAP dept (CP→dept mapping happens in the ingest handler).
 */
export async function insertFimArticles(
  env: Env,
  uploadId: number,
  period: FimPeriod,
  articles: ParsedFimArticle[],
): Promise<number> {
  await env.DB.prepare(`DELETE FROM fim_articles WHERE upload_id = ?`).bind(uploadId).run();
  if (articles.length === 0) return 0;
  const stmt = env.DB.prepare(
    `INSERT INTO fim_articles (
        upload_id, report_date, date_from, date_to, dept_code, article_code, article_desc,
        net_sales_zar, shrink_zar, waste_zar, rtc_zar
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const batch = articles.map((a) =>
    stmt.bind(
      uploadId,
      period.reportDate,
      period.dateFrom,
      period.dateTo,
      a.deptCode,
      a.code,
      a.desc ?? null,
      a.netSalesZar ?? null,
      a.shrinkZar ?? null,
      a.wasteZar ?? null,
      a.rtcZar ?? null,
    ),
  );
  for (const c of chunk(batch, 100)) await env.DB.batch(c);
  return articles.length;
}

/**
 * Of the supplied department codes, which have all 7 days of their fiscal week
 * already present in fim_daily? Used to decide when F06/F09 daily distortion no
 * longer applies (a complete week is trustworthy).
 */
export async function fimWeekCompleteDepts(
  env: Env,
  fiscalYear: number,
  fiscalWeek: number,
  deptCodes: string[],
): Promise<Set<string>> {
  const complete = new Set<string>();
  if (deptCodes.length === 0) return complete;
  const placeholders = deptCodes.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT dept_code, COUNT(DISTINCT report_date) AS days
     FROM fim_daily
     WHERE fiscal_year = ? AND fiscal_week = ? AND dept_code IN (${placeholders})
     GROUP BY dept_code`,
  )
    .bind(fiscalYear, fiscalWeek, ...deptCodes)
    .all<{ dept_code: string; days: number }>();
  for (const r of rows.results ?? []) if (r.days >= 7) complete.add(r.dept_code);
  return complete;
}

/** Default max age (days) before an open PO line is treated as auto-closed. */
export const DEFAULT_OPEN_PO_MAX_AGE_DAYS = 60;

/**
 * Auto-close threshold: open PO lines older than this many days (from order_date)
 * are treated as closed — excluded from Open/Committed tiles, invoice-to-deliver
 * views and stale flags — without mutating the rows. Configurable via
 * app_settings.open_po_max_age_days; falls back to 90.
 */
export async function openPoMaxAgeDays(env: Env): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT value FROM app_settings WHERE key='open_po_max_age_days'`,
  ).first<{ value: string }>();
  const n = Math.floor(Number(r?.value));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_OPEN_PO_MAX_AGE_DAYS;
}

/**
 * SQL predicate that is FALSE only for aged-out OPEN PO lines (undelivered and
 * older than the max age), TRUE for everything else — so it can be dropped into
 * any query without disturbing fully-received lines. The integer max-age is
 * inlined (validated integer — injection-safe). `prefix` is the table alias
 * (e.g. "p") when po_lines is aliased; omit for an unqualified query.
 */
export function notAgedOutSql(maxAgeDays: number, prefix = ""): string {
  const d = Math.max(1, Math.floor(maxAgeDays));
  const p = prefix ? prefix + "." : "";
  // Sargable form (uses idx_po_lines_order_date) that is EXACTLY equivalent to the
  // previous `julianday('now') - julianday(order_date) > d`: for a date-only
  // order_date, that fires iff order_date <= date('now','-d days'). Verified to
  // return identical figures while avoiding a per-row julianday scan of po_lines
  // (openRow 894ms -> 112ms, recon 380ms -> 217ms on 420k rows).
  return `NOT (${p}is_fully_received = 0 AND ${p}order_date IS NOT NULL AND ${p}order_date <= date('now', '-${d} days'))`;
}

/**
 * SQL predicate that is FALSE for POs with an ACTIVE manual closure (buyer declared
 * the PO stale and hasn't reopened it), TRUE otherwise. A manual closure excludes the
 * PO from every open/committed calculation regardless of age — same effect as aging
 * out — without mutating po_lines. `prefix` is the po_lines alias when qualified.
 */
export function notManuallyClosedSql(prefix = ""): string {
  const p = prefix ? prefix + "." : "";
  return `${p}po_number NOT IN (SELECT po_number FROM po_manual_closures WHERE reopened_at IS NULL)`;
}

/**
 * THE shared open-PO predicate. A po_lines row is an open commitment iff it is:
 *   not fully received  AND  order age < open_po_max_age_days  AND  no active manual closure.
 * Every open/committed line-level query must use this so aging out and manual "declare
 * stale" take effect identically everywhere. `prefix` is the po_lines alias.
 */
export function openPoPredicate(maxAgeDays: number, prefix = ""): string {
  const p = prefix ? prefix + "." : "";
  return `${p}is_fully_received = 0 AND ${notAgedOutSql(maxAgeDays, prefix)} AND ${notManuallyClosedSql(prefix)}`;
}

/**
 * THE single "Open Committed" figure, used by /api/dashboard, /api/dashboard/tiles and
 * /api/po-lines/list so all screens show one identical number. Store-wide netting:
 * gross ordered (S001 only — returns/S002 excluded per house rule) minus received,
 * over lines that are not aged out and not manually closed. `lines` is the open-line
 * count (is_fully_received = 0). Value never goes negative.
 */
export async function openCommitted(env: Env): Promise<{ valueCents: number; lines: number }> {
  const notAged = notAgedOutSql(await openPoMaxAgeDays(env));
  const r = await env.DB.prepare(
    `SELECT COALESCE(SUM(line_value_cents),0) AS ordered_cents,
            COALESCE(SUM(received_value),0)   AS received_zar,
            SUM(CASE WHEN is_fully_received = 0 THEN 1 ELSE 0 END) AS lines
     FROM po_lines
     WHERE COALESCE(sloc,'') != 'S002' AND ${notAged} AND ${notManuallyClosedSql()}`,
  ).first<{ ordered_cents: number; received_zar: number; lines: number }>();
  const valueCents = Math.max(0, Math.round((r?.ordered_cents ?? 0) - (r?.received_zar ?? 0) * 100));
  return { valueCents, lines: r?.lines ?? 0 };
}

/** Committed (open) value in cents, optionally scoped to a department or vendor. */
export async function committedOpenValueCents(
  env: Env,
  scopeType: "overall" | "department" | "vendor",
  scopeRef: string | null,
): Promise<number> {
  const maxAge = await openPoMaxAgeDays(env);
  let sql = `SELECT COALESCE(SUM(open_value_cents),0) AS total FROM po_lines
             WHERE ${openPoPredicate(maxAge)}`;
  const binds: unknown[] = [];
  if (scopeType === "department" && scopeRef) {
    sql += ` AND article_id IN (SELECT id FROM articles WHERE department = ?)`;
    binds.push(scopeRef);
  } else if (scopeType === "vendor" && scopeRef) {
    sql += ` AND vendor_id IN (SELECT id FROM vendors WHERE vendor_code = ?)`;
    binds.push(scopeRef);
  }
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

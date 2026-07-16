import { STORE, type Env, thresholds, budgetStatus } from "./config";
import { parseSapFile } from "./parser/sapParser";
import { parseGrFile } from "./parser/grParser";
import { parseEodFile } from "./parser/eodParser";
import { recomputeSettlement, handleSettlement, handleSettlementLiv } from "./settlement";
import { handleStatementDashboard, handleStatementBrowse } from "./statements-analytics";
import { handleFeedCoverage } from "./coverage";
import { handleWeeklyBrief } from "./brief";
import { handleOtb, recomputeOtbAnomalies } from "./otb";
import { handleDeptLeague, handleDeptDossier, handleGpBridge } from "./dept";
import { parseFimFile, aggregateCpToDept } from "./parser/fimParser";
import { parseCustomerFile } from "./parser/customerParser";
import { parseFanScoreFile } from "./parser/fanScoreParser";
import { parseFilenamePeriod } from "./parser/core";
import { fiscalCalendarLookup } from "./fiscal";
import {
  createUpload,
  findUploadByHash,
  insertAnomalies,
  insertGrLines,
  insertCustomerCounts,
  insertFanScore,
  insertFimRows,
  insertFimArticles,
  fimPeriodExists,
  fimWeekCompleteDepts,
  cpToDeptMap,
  insertPoLinesBatch,
  recomputeReceipts,
  markUploadError,
  markUploadParsed,
  committedOpenValueCents,
  openCommitted,
  openPoMaxAgeDays,
  notAgedOutSql,
  insertEodMovements,
  deleteEodByDates,
  deleteEodByDocs,
  type InsertedLine,
} from "./db/repo";
import {
  detectDuplicateLines,
  detectFimAnomalies,
  detectGrAnomalies,
  detectLineAnomalies,
  evaluateBudgets,
  recomputeStaleAnomalies,
  recomputePriceSpikes,
} from "./anomalies/detect";
import { fetchCurrentGuidelines, guidelineKeyForDept } from "./guidelines";
import {
  handlePurchasesSummary,
  handleVendors,
  handleVendorDetail,
  handleArticles,
  handleArticleDetail,
  handleCategories,
  handleCategoryDetail,
  handleDepartmentsPo,
  handleFimPeriod,
  handleFimByPeriod,
  handleFiscalWeek,
  handleGrPeriod,
  handleMetaRange,
  handlePeriods,
  handleOpenOrders,
  handleReturns,
  handleGrReconciliation,
  handleReconciliation,
  handleGetSettings,
  handlePutSettings,
  handleGetCreditors,
  handlePostCreditor,
  handleAckAnomaly,
  handleCustomerCountSummary,
  handleCustomerCountDaily,
  handleFanScoreSummary,
  handleFanScoreHistory,
  handleFanScoreResponses,
  handleDashboardTiles,
  handlePoLinesList,
  handleGetWeeklyBudgets,
  handlePostWeeklyBudget,
  handleDeleteWeeklyBudget,
  handleBudgetsSummary,
  handleTrading,
  handleCashFlowFlags,
  handleBudgetsSuggest,
  handleBudgetsGenerateLy,
  handleWeeklyDayBlocks,
  handleCreditorPayments,
  handleDashboardCashflow,
  handleWaste,
  handleWasteDept,
  handleWasteDeptArticles,
  getFreshBConfig,
} from "./analytics";
import { handleReport } from "./reports";
import {
  handleHierarchy,
  handleHierarchyDept,
  handleHierarchyUpload,
  handleHierarchyPerformance,
} from "./hierarchy";
import { DASHBOARD_HTML } from "./dashboard";
import { UPLOAD_HTML } from "./upload";
import { APP_HTML } from "./app";
import { ICON_192_PNG_B64, ICON_512_PNG_B64 } from "./icons";
import {
  parseStatementCsv,
  persistStatement,
  type ParsedStatement,
} from "./statement-ingest";
import { STATEMENT_PDF_JS } from "./statementPdfClient";

// --- small helpers -------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/**
 * Guard for destructive routes (reset / bulk-delete / delete). When ADMIN_TOKEN
 * is configured, require a matching `X-Admin-Token` header; when it is unset the
 * route is unenforced (so existing deployments keep working until a secret is
 * provisioned via `wrangler secret put ADMIN_TOKEN`).
 */
function adminAuthorized(req: Request, env: Env): boolean {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return true;
  return req.headers.get("X-Admin-Token") === expected;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Content hash for a decoded-text upload (CSV path), without keeping a buffer. */
async function sha256HexText(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer);
}

/** Read a multipart 'file' field (or raw body) as a Blob, so the caller can pick
 *  blob.text() (CSV) or blob.arrayBuffer() (xlsx) and avoid double-buffering. */
async function readUploadEntry(
  req: Request,
  fallbackPrefix: string,
): Promise<{ filename: string; blob: Blob } | { error: string }> {
  let filename =
    new URL(req.url).searchParams.get("filename") ??
    req.headers.get("X-Filename") ??
    `${fallbackPrefix}-${Date.now()}.txt`;
  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const entry = form.get("file") as unknown;
    if (entry == null || typeof entry === "string") {
      return { error: "Expected a 'file' field in form-data." };
    }
    const file = entry as File;
    filename = file.name || filename;
    return { filename, blob: file };
  }
  return { filename, blob: await req.blob() };
}

/** Read a multipart 'file' field or a raw request body into bytes + filename. */
async function readUploadBytes(
  req: Request,
  fallbackPrefix: string,
): Promise<{ filename: string; bytes: ArrayBuffer } | { error: string }> {
  let filename =
    new URL(req.url).searchParams.get("filename") ??
    req.headers.get("X-Filename") ??
    `${fallbackPrefix}-${Date.now()}.txt`;
  const ctype = req.headers.get("content-type") ?? "";
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const entry = form.get("file") as unknown;
    if (entry == null || typeof entry === "string") {
      return { error: "Expected a 'file' field in form-data." };
    }
    const file = entry as { name?: string; arrayBuffer: () => Promise<ArrayBuffer> };
    filename = file.name || filename;
    return { filename, bytes: await file.arrayBuffer() };
  }
  return { filename, bytes: await req.arrayBuffer() };
}

// --- handlers ------------------------------------------------------------

/**
 * POST /api/uploads — ingest a SAP export file (multipart 'file' or raw body).
 *
 * The ENTIRE handler is wrapped so any failure (multipart parse, R2 archive,
 * D1 dedup/create, parse, or the per-line persist loop) returns a JSON error
 * tagged with the `step` it failed at — never an uncaught exception.
 */
async function handleUpload(req: Request, env: Env): Promise<Response> {
  let uploadId: number | undefined;
  let step = "read-body";
  try {
    const read = await readUploadBytes(req, "sap");
    if ("error" in read) return json({ error: read.error }, 400);
    const { filename, bytes } = read;
    if (bytes.byteLength === 0) return json({ error: "Empty body." }, 400);

    step = "hash";
    const hash = await sha256Hex(bytes);

    step = "dedup-lookup";
    const existing = await findUploadByHash(env, hash);
    if (existing) {
      return json(
        { status: "duplicate", message: "This exact file was already ingested.", uploadId: existing.id },
        409,
      );
    }

    // Archive raw file in R2 first (source of truth for re-processing).
    step = "r2-archive";
    const r2Key = `sap/${new Date().toISOString().slice(0, 10)}/${hash.slice(0, 12)}-${filename}`;
    await env.UPLOADS_BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { filename, store: STORE.storeNumber },
    });

    step = "create-upload";
    uploadId = await createUpload(env, { filename, r2Key, contentHash: hash, sizeBytes: bytes.byteLength });

    step = "parse";
    const text = new TextDecoder("utf-8").decode(bytes);
    const parsed = parseSapFile(text, env.DEFAULT_CURRENCY ?? "ZAR");

    if (parsed.lines.length === 0) {
      await markUploadError(env, uploadId, parsed.warnings.join(" "));
      return json(
        {
          status: "parsed_empty",
          uploadId,
          delimiter: parsed.delimiter,
          mappedColumns: parsed.headerMap,
          headerColumns: parsed.headerColumns,
          warnings: parsed.warnings,
        },
        422,
      );
    }

    // Persist lines + masters in batched D1 statements (keeps the request well
    // under the Workers per-invocation subrequest limit on large files).
    // Fast path is now the DEFAULT for PO uploads: insert only, skipping the
    // post-insert work whose cost grows with total DB size (per-row anomaly +
    // price-history lookups, full-table duplicate scan, budget SUM, receipt
    // recompute). Without this, each slice gets slower as the table grows and
    // eventually 503s. Run reconciliation once at the end via
    // POST /api/reconcile/recompute. Pass ?fast=0 to force the full pass.
    const qp = new URL(req.url).searchParams;
    const fast = qp.get("fast") !== "0";
    step = "persist-lines";
    const inserted = await insertPoLinesBatch(env, uploadId, parsed.lines);

    let evaluations: unknown[] = [];
    let anomaliesRaised = 0;
    const warnings = [...parsed.warnings];
    if (fast) {
      step = "mark-parsed";
      await markUploadParsed(env, uploadId, parsed.delimiter, parsed.lines.length, parsed.skippedRows);
    } else {
      // Refresh GR-receipt rollups (skippable via ?recompute=0).
      if (qp.get("recompute") !== "0") {
        step = "recompute-receipts";
        await recomputeReceipts(env);
        await recomputeStaleAnomalies(env);
        // Placing POs can push a dept over its purchase budget → OTB_EXCEEDED.
        try { await recomputeOtbAnomalies(env); } catch { /* best-effort */ }
      }
      const anomalies = [];
      for (const row of inserted) anomalies.push(...detectLineAnomalies(row, env));
      anomalies.push(...detectDuplicateLines(inserted));

      step = "budgets";
      const budget = await evaluateBudgets(env, uploadId);
      evaluations = budget.evaluations;
      anomalies.push(...budget.anomalies);
      anomaliesRaised = anomalies.length;

      step = "mark-parsed";
      await markUploadParsed(env, uploadId, parsed.delimiter, parsed.lines.length, parsed.skippedRows);

      step = "persist-anomalies";
      try {
        await insertAnomalies(env, uploadId, anomalies);
      } catch (anomErr) {
        const m = anomErr instanceof Error ? anomErr.message : String(anomErr);
        warnings.push(`Lines ingested OK, but anomalies could not all be saved: ${m}`);
      }
    }

    return json({
      status: "parsed",
      uploadId,
      filename,
      r2Key,
      delimiter: parsed.delimiter,
      mappedColumns: parsed.headerMap,
      headerColumns: parsed.headerColumns,
      deliveryDateColumn: parsed.headerMap["deliveryDate"] ?? null,
      linesIngested: parsed.lines.length,
      skippedRows: parsed.skippedRows,
      anomaliesRaised,
      budgets: evaluations,
      warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : "Error";
    const stack = err instanceof Error ? err.stack : undefined;
    if (uploadId != null) {
      try { await markUploadError(env, uploadId, `[${step}] ${message}`); } catch { /* ignore */ }
    }
    return json(
      { status: "error", step, uploadId, error: message || `${errorName} (no message)`, errorName, stack },
      500,
    );
  }
}

/** POST /api/gr-uploads — ingest a goods-receipt file into gr_lines. */
async function handleGrUpload(req: Request, env: Env): Promise<Response> {
  const read = await readUploadBytes(req, "gr");
  if ("error" in read) return json({ error: read.error }, 400);
  const { filename, bytes } = read;
  if (bytes.byteLength === 0) return json({ error: "Empty body." }, 400);

  const hash = await sha256Hex(bytes);
  const existing = await findUploadByHash(env, hash);
  if (existing) {
    return json(
      { status: "duplicate", message: "This exact file was already ingested.", uploadId: existing.id },
      409,
    );
  }

  const r2Key = `gr/${new Date().toISOString().slice(0, 10)}/${hash.slice(0, 12)}-${filename}`;
  await env.UPLOADS_BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: "text/plain" },
    customMetadata: { filename, store: STORE.storeNumber, kind: "gr" },
  });

  const uploadId = await createUpload(
    env,
    { filename, r2Key, contentHash: hash, sizeBytes: bytes.byteLength },
    "gr",
  );

  try {
    const parsed = parseGrFile(bytes, filename);

    if (parsed.lines.length === 0) {
      await markUploadError(env, uploadId, parsed.warnings.join(" "));
      return json(
        {
          status: "parsed_empty",
          uploadId,
          delimiter: parsed.delimiter,
          mappedColumns: parsed.headerMap,
          warnings: parsed.warnings,
        },
        422,
      );
    }

    // Guard against non-GR files (e.g. a margin/summary export mis-uploaded to
    // this endpoint — the 08-Jun incident: %-shaped "PO" values, no article
    // codes, bogus multi-million totals). A genuine GR line file carries an
    // article code on virtually every receipt line. This MUST run before the
    // replace-delete below, so a bad file can never wipe good data for a date.
    const totalLines = parsed.lines.length;
    const withArticle = parsed.lines.filter((l) => (l.articleCode ?? "").trim() !== "").length;
    const pctShapedPo = parsed.lines.filter((l) => /^-?\d+(\.\d+)?\s*%$/.test((l.poNumber ?? "").trim())).length;
    if (totalLines > 0 && (withArticle / totalLines < 0.5 || pctShapedPo / totalLines >= 0.3)) {
      await markUploadError(
        env,
        uploadId,
        "Rejected: not a goods-receipts line file (most rows lack an article code / carry percentage values) — likely a margin or summary export uploaded to the GR endpoint.",
      );
      return json(
        {
          status: "rejected",
          uploadId,
          reason: "not_gr_line_data",
          rows: totalLines,
          rowsWithArticle: withArticle,
          message:
            "This looks like a margin/summary report, not a goods-receipts line file (most rows have no article code). Nothing was ingested.",
          warnings: parsed.warnings,
        },
        422,
      );
    }

    // Replace-on-reload: clear any existing GR rows for the dates this file
    // covers BEFORE inserting, so re-uploading a day (even under a different
    // filename) replaces it instead of double-counting. gr_lines has no unique
    // key and content-hash dedup misses re-exports whose filename differs
    // ("Equiv Date …" vs "Equiv Date Range_ …"). The current upload has no rows
    // yet, so this only removes prior uploads' rows for the same gr_date(s).
    const grDates = [...new Set(parsed.lines.map((l) => l.grDate).filter((d): d is string => !!d))];
    if (grDates.length) {
      const ph = grDates.map(() => "?").join(",");
      await env.DB.prepare(`DELETE FROM gr_lines WHERE gr_date IN (${ph})`)
        .bind(...grDates)
        .run();
    }

    const inserted = await insertGrLines(env, uploadId, parsed.lines);

    // Reconcile: refresh received_qty/received_value/last_gr_date/is_fully_received
    // on matching PO lines. Skippable via ?recompute=0 for bulk loads.
    if (new URL(req.url).searchParams.get("recompute") !== "0") {
      await recomputeReceipts(env);
      await recomputeStaleAnomalies(env);
    }

    // Mark parsed before anomalies so an anomaly-write failure can't strand the
    // upload at pending/0 (lines are already persisted at this point).
    await markUploadParsed(env, uploadId, parsed.delimiter, inserted, parsed.skippedRows);

    // Record the report period from the filename (any SAP-default name).
    const grPeriod = parseFilenamePeriod(filename);
    if (grPeriod) {
      await env.DB.prepare(`UPDATE uploads SET report_date=?, report_date_to=? WHERE id=?`)
        .bind(grPeriod.from, grPeriod.to, uploadId)
        .run();
    }

    // Margin anomalies: negative / thin / well-below-guideline receipts (best-effort).
    const guidelines = await fetchCurrentGuidelines(env);
    const grFreshB = await getFreshBConfig(env);
    const grAnomalies = detectGrAnomalies(parsed.lines, guidelines, grFreshB.depts);
    const grWarnings = [...parsed.warnings];
    try {
      await insertAnomalies(env, uploadId, grAnomalies);
    } catch (anomErr) {
      const m = anomErr instanceof Error ? anomErr.message : String(anomErr);
      grWarnings.push(`Lines ingested OK, but anomalies could not all be saved: ${m}`);
    }

    // Per-department received summary for the response.
    const byDept = new Map<string, { lines: number; qty: number; cost: number; sell: number }>();
    let unknownDepts = 0;
    for (const l of parsed.lines) {
      if (!l.deptName) unknownDepts++;
      const key = `${l.deptCode ?? "?"} ${l.deptName ?? "Unknown"}`;
      const agg = byDept.get(key) ?? { lines: 0, qty: 0, cost: 0, sell: 0 };
      agg.lines++;
      agg.qty += l.qty ?? 0;
      agg.cost += l.costZar ?? 0;
      agg.sell += l.sellZar ?? 0;
      byDept.set(key, agg);
    }
    const departments = [...byDept.entries()].map(([dept, a]) => ({
      dept,
      lines: a.lines,
      qty: Math.round(a.qty * 1000) / 1000,
      costZar: Math.round(a.cost * 100) / 100,
      sellZar: Math.round(a.sell * 100) / 100,
      marginPct: a.sell > 0 ? Math.round(((a.sell - a.cost) / a.sell) * 1000) / 10 : null,
    }));

    return json({
      status: "parsed",
      uploadId,
      filename,
      r2Key,
      delimiter: parsed.delimiter,
      mappedColumns: parsed.headerMap,
      linesIngested: inserted,
      skippedRows: parsed.skippedRows,
      unmappedDepartments: unknownDepts,
      anomaliesRaised: grAnomalies.length,
      departments,
      warnings: grWarnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : "Error";
    const stack = err instanceof Error ? err.stack : undefined;
    await markUploadError(env, uploadId, message || errorName);
    return json(
      { status: "error", uploadId, error: message || `${errorName} (no message)`, errorName, stack },
      500,
    );
  }
}

/**
 * POST /api/eod-uploads — ingest a weekly EOD Movements Report (.txt tab-delimited
 * latin-1, or older .htm ALV table; sniffed by content). Archives to R2, parses to
 * eod_movements, replaces prior rows for the same dates (idempotent per week), then
 * re-evaluates the settlement ledger. The response reports the parsed GR total +
 * movement counts so they can be eyeballed against SAP.
 */
async function handleEodUpload(req: Request, env: Env): Promise<Response> {
  const read = await readUploadBytes(req, "eod");
  if ("error" in read) return json({ error: read.error }, 400);
  const { filename, bytes } = read;
  if (bytes.byteLength === 0) return json({ error: "Empty body." }, 400);

  const hash = await sha256Hex(bytes);
  const existing = await findUploadByHash(env, hash);
  if (existing) {
    return json({ status: "duplicate", message: "This exact file was already ingested.", uploadId: existing.id }, 409);
  }

  const r2Key = `eod/${new Date().toISOString().slice(0, 10)}/${hash.slice(0, 12)}-${filename}`;
  await env.UPLOADS_BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: "text/plain" },
    customMetadata: { filename, store: STORE.storeNumber, kind: "eod" },
  });
  const uploadId = await createUpload(env, { filename, r2Key, contentHash: hash, sizeBytes: bytes.byteLength }, "eod");

  try {
    const parsed = parseEodFile(bytes, filename);
    if (parsed.rows.length === 0) {
      await markUploadError(env, uploadId, parsed.warnings.join(" ") || "No movement rows parsed.");
      return json({ status: "parsed_empty", uploadId, format: parsed.format, warnings: parsed.warnings }, 422);
    }

    // Replace-on-reload, idempotent by BOTH the week's dates AND the movement
    // DocumentNos in this file — so the same movement can never be contributed to
    // the ledger twice, whether from a re-export or an overlapping-week file.
    const dates = [...new Set(parsed.rows.map((r) => r.date).filter((d): d is string => !!d))];
    const docNos = parsed.rows.map((r) => r.docNo).filter((d): d is string => !!d);
    await deleteEodByDates(env, dates);
    await deleteEodByDocs(env, docNos);

    const inserted = await insertEodMovements(env, uploadId, parsed.rows);
    await markUploadParsed(env, uploadId, parsed.format, inserted, parsed.skippedDcClaims);

    const period = parseFilenamePeriod(filename);
    if (period) {
      await env.DB.prepare(`UPDATE uploads SET report_date=?, report_date_to=? WHERE id=?`)
        .bind(period.from, period.to, uploadId)
        .run();
    }

    // Re-evaluate the settlement ledger (GR ↔ statement) after every EOD ingest.
    const settlement = await recomputeSettlement(env);

    return json({
      status: "parsed",
      uploadId,
      filename,
      format: parsed.format,
      mappedColumns: parsed.headerMap,
      rowsIngested: inserted,
      rawRows: parsed.rawRows,
      skippedDcClaims: parsed.skippedDcClaims,
      // self-check totals — eyeball against SAP.
      selfCheck: {
        grCount: parsed.grCount,
        grValInTotal: parsed.grValInTotal,
        returnCount: parsed.returnCount,
        returnValTotal: parsed.returnValTotal,
        reversalCount: parsed.reversalCount,
      },
      settlement,
      warnings: parsed.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    await markUploadError(env, uploadId, message);
    return json({ status: "error", uploadId, error: message, stack }, 500);
  }
}

/**
 * POST /api/customer-uploads — ingest a "Customer Count - Equiv Date Range" CSV
 * into customer_counts (one row per calendar day, UPSERT by cal_date). Filename
 * may be supplied via the `X-Filename` header (raw body) or `?filename=`.
 */
async function handleCcUpload(req: Request, env: Env): Promise<Response> {
  let uploadId: number | undefined;
  let step = "read-body";
  try {
    const read = await readUploadBytes(req, "customer");
    if ("error" in read) return json({ error: read.error }, 400);
    const { filename, bytes } = read;
    if (bytes.byteLength === 0) return json({ error: "Empty body." }, 400);

    step = "hash";
    const hash = await sha256Hex(bytes);

    step = "dedup-lookup";
    const existing = await findUploadByHash(env, hash);
    if (existing) {
      return json(
        { status: "duplicate", message: "This exact file was already ingested.", uploadId: existing.id },
        409,
      );
    }

    step = "r2-archive";
    const r2Key = `cc/${new Date().toISOString().slice(0, 10)}/${hash.slice(0, 12)}-${filename}`;
    await env.UPLOADS_BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: "text/csv; charset=utf-8" },
      customMetadata: { filename, store: STORE.storeNumber, kind: "cc" },
    });

    step = "create-upload";
    uploadId = await createUpload(env, { filename, r2Key, contentHash: hash, sizeBytes: bytes.byteLength }, "cc");

    step = "parse";
    const text = new TextDecoder("utf-8").decode(bytes);
    const parsed = parseCustomerFile(text, filename);

    if (parsed.rows.length === 0) {
      await markUploadError(env, uploadId, parsed.warnings.join(" "));
      return json({ status: "parsed_empty", uploadId, warnings: parsed.warnings }, 422);
    }

    step = "persist";
    const inserted = await insertCustomerCounts(env, uploadId, parsed.rows);

    step = "mark-parsed";
    await markUploadParsed(env, uploadId, parsed.delimiter, inserted, parsed.skippedRows);

    // Report period from the actual row dates (min/max), falling back to the filename.
    const dates = parsed.rows.map((r) => r.calDate).sort();
    const fnPeriod = parseFilenamePeriod(filename);
    const from = dates[0] ?? fnPeriod?.from ?? null;
    const to = dates[dates.length - 1] ?? fnPeriod?.to ?? null;
    if (from && to) {
      step = "record-period";
      await env.DB.prepare(`UPDATE uploads SET report_date=?, report_date_to=? WHERE id=?`)
        .bind(from, to, uploadId)
        .run();
    }

    return json({
      status: "parsed",
      uploadId,
      filename,
      r2Key,
      rowCount: inserted,
      linesIngested: inserted, // alias so the shared upload-result UI shows the count
      skippedRows: parsed.skippedRows,
      dateRange: { from, to }, // shape the PS loader reads
      dateFrom: from, // aliases the batch-summary UI reads
      dateTo: to,
      warnings: parsed.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : "Error";
    const stack = err instanceof Error ? err.stack : undefined;
    if (uploadId != null) {
      try { await markUploadError(env, uploadId, `[${step}] ${message}`); } catch { /* ignore */ }
    }
    return json(
      { status: "error", step, uploadId, error: message || `${errorName} (no message)`, errorName, stack },
      500,
    );
  }
}

/**
 * POST /api/fan-score-uploads — ingest a Fan Score / NPS store report (.txt).
 * Stores individual responses + a per-week summary (reported NPS TW/LW + computed
 * promoter/detractor counts). Filename via `X-Filename` header or `?filename=`.
 */
async function handleFanScoreUpload(req: Request, env: Env): Promise<Response> {
  let uploadId: number | undefined;
  let step = "read-body";
  try {
    const read = await readUploadBytes(req, "fanscore");
    if ("error" in read) return json({ error: read.error }, 400);
    const { filename, bytes } = read;
    if (bytes.byteLength === 0) return json({ error: "Empty body." }, 400);

    step = "hash";
    const hash = await sha256Hex(bytes);

    step = "dedup-lookup";
    const existing = await findUploadByHash(env, hash);
    if (existing) {
      return json(
        { status: "duplicate", message: "This exact file was already ingested.", uploadId: existing.id },
        409,
      );
    }

    step = "r2-archive";
    const r2Key = `fs/${new Date().toISOString().slice(0, 10)}/${hash.slice(0, 12)}-${filename}`;
    await env.UPLOADS_BUCKET.put(r2Key, bytes, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
      customMetadata: { filename, store: STORE.storeNumber, kind: "fs" },
    });

    step = "create-upload";
    uploadId = await createUpload(env, { filename, r2Key, contentHash: hash, sizeBytes: bytes.byteLength }, "fs");

    step = "parse";
    const text = new TextDecoder("utf-8").decode(bytes);
    const parsed = parseFanScoreFile(text, filename);

    if (!parsed.weekEnding || parsed.responses.length === 0) {
      await markUploadError(env, uploadId, parsed.warnings.join(" "));
      return json({ status: "parsed_empty", uploadId, weekEnding: parsed.weekEnding, warnings: parsed.warnings }, 422);
    }

    step = "persist";
    const summary = await insertFanScore(env, uploadId, parsed);

    step = "mark-parsed";
    await markUploadParsed(env, uploadId, "fan-score", summary.totalResponses, 0);

    step = "record-period";
    await env.DB.prepare(`UPDATE uploads SET report_date=?, report_date_to=? WHERE id=?`)
      .bind(parsed.weekEnding, parsed.weekEnding, uploadId)
      .run();

    return json({
      status: "parsed",
      uploadId,
      filename,
      r2Key,
      weekEnding: parsed.weekEnding,
      siteCode: parsed.siteCode ?? null,
      npsTw: parsed.npsTw ?? null,
      npsLw: parsed.npsLw ?? null,
      totalResponses: summary.totalResponses,
      scoredResponses: summary.scoredResponses,
      promoters: summary.promoters,
      passives: summary.passives,
      detractors: summary.detractors,
      npsComputed: summary.npsComputed,
      rowCount: summary.totalResponses,
      linesIngested: summary.totalResponses, // alias for the shared upload-result UI
      dateRange: { from: parsed.weekEnding, to: parsed.weekEnding },
      dateFrom: parsed.weekEnding,
      dateTo: parsed.weekEnding,
      warnings: parsed.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : "Error";
    const stack = err instanceof Error ? err.stack : undefined;
    if (uploadId != null) {
      try { await markUploadError(env, uploadId, `[${step}] ${message}`); } catch { /* ignore */ }
    }
    return json(
      { status: "error", step, uploadId, error: message || `${errorName} (no message)`, errorName, stack },
      500,
    );
  }
}

/** True iff [from,to] is a full Monday→Sunday week (UTC: Mon=1 start, Sun=0 end, 6-day span). */
function isFullMonSunWeek(from: string, to: string): boolean {
  if (!from || !to) return false;
  const a = new Date(from + "T00:00:00Z");
  const b = new Date(to + "T00:00:00Z");
  const span = (b.getTime() - a.getTime()) / 86_400_000;
  return a.getUTCDay() === 1 && b.getUTCDay() === 0 && span === 6;
}

/** POST /api/fim-uploads — ingest a FIM department spreadsheet (xlsx). */
async function handleFimUpload(req: Request, env: Env): Promise<Response> {
  const read = await readUploadEntry(req, "fim");
  if ("error" in read) return json({ error: read.error }, 400);
  const { filename, blob } = read;
  if (blob.size === 0) return json({ error: "Empty body." }, 400);

  // Option 5 (memory): CSV exports are read as text ONCE via blob.text() — we never
  // hold the binary buffer AND a decoded string during the CPU-heavy parse, halving
  // peak memory on large files. xlsx stays binary (.text() would corrupt the zip).
  const isXlsx = /\.xlsx?$/i.test(filename);
  const text = isXlsx ? null : await blob.text();
  const bytes = isXlsx ? await blob.arrayBuffer() : null;

  const hash = isXlsx ? await sha256Hex(bytes!) : await sha256HexText(text!);
  const existing = await findUploadByHash(env, hash);
  if (existing) {
    return json(
      { status: "duplicate", message: "This exact file was already ingested.", uploadId: existing.id },
      409,
    );
  }

  const r2Key = `fim/${new Date().toISOString().slice(0, 10)}/${hash.slice(0, 12)}-${filename}`;
  await env.UPLOADS_BUCKET.put(r2Key, isXlsx ? bytes! : text!, {
    httpMetadata: {
      contentType: isXlsx
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv; charset=utf-8",
    },
    customMetadata: { filename, store: STORE.storeNumber, kind: "fim" },
  });

  const uploadId = await createUpload(
    env,
    { filename, r2Key, contentHash: hash, sizeBytes: blob.size },
    "fim",
  );

  try {
    const t0 = Date.now();
    const parsed = parseFimFile(isXlsx ? bytes! : text!, filename);
    console.log(
      "[fim] file=%s bytes=%d parseMs=%d isCp=%s parsedRows=%d articleCount=%d skipped=%d",
      filename, blob.size, Date.now() - t0,
      String(parsed.isCpFormat), parsed.rows.length, parsed.articleCount, parsed.skippedRows,
    );
    if (!parsed.reportDate || parsed.rows.length === 0) {
      await markUploadError(env, uploadId, parsed.warnings.join(" "));
      return json(
        { status: "parsed_empty", uploadId, reportDate: parsed.reportDate, warnings: parsed.warnings },
        422,
      );
    }

    // Future-date guard: FIM report dates come from the filename, so a year typo
    // (e.g. "FIM DETAIL 03.07.2027.csv" for a 2026 report) silently pushes real
    // sales into a future fiscal year and pollutes aggregations. Reject anything
    // dated more than 2 days ahead (grace for period-end / timezone) so it's
    // caught at ingest instead of after the fact.
    const todayIso = new Date().toISOString().slice(0, 10);
    const graceIso = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    if (parsed.dateTo > graceIso) {
      await markUploadError(
        env,
        uploadId,
        `report date ${parsed.dateTo} is in the future (today ${todayIso}) — likely a filename year typo; not ingested`,
      );
      return json(
        {
          status: "future_date_rejected",
          uploadId,
          reportDate: parsed.reportDate,
          dateFrom: parsed.dateFrom,
          dateTo: parsed.dateTo,
          message: `Report date ${parsed.dateTo} is in the future — check the filename year.`,
        },
        422,
      );
    }

    // Fresh B weekly source detection (CONTENT-based, not filename): a file whose
    // only non-TOTAL departments are all Fresh B AND whose range is a full Mon–Sun
    // week is the dedicated post-stocktake Fresh B margin export. Tag it
    // 'weekly_freshb' so freshBWeeklyMargin() sources margin/COS exclusively from it
    // (the general weekly/daily FIM carry the wrong Fresh B cost). Mixed-dept weekly
    // files stay general 'weekly'.
    //
    // CP (Category-Portfolio) files key rows by CP code, not SAP dept — the FIM daily
    // AND weekly exports use this format — so resolve to SAP depts FIRST (via the same
    // cpToDeptMap the storage path uses), else an FB export in CP format would be
    // misclassified as a general weekly and silently ignored for FB margin.
    const cpMap = parsed.isCpFormat ? await cpToDeptMap(env) : null;
    const toDept = (code: string): string => (cpMap ? cpMap.get(code)?.deptCode ?? code : code);
    const fbCfg = await getFreshBConfig(env);
    const fileDepts = new Set(
      parsed.rows
        .map((r) => (r.deptCode ? toDept(r.deptCode) : r.deptCode))
        .filter((c): c is string => !!c && c !== "TOTAL"),
    );
    const isFreshbWeekly =
      fileDepts.size > 0 &&
      [...fileDepts].every((c) => fbCfg.depts.has(c)) &&
      isFullMonSunWeek(parsed.dateFrom, parsed.dateTo);
    const effectiveReportType = isFreshbWeekly ? "weekly_freshb" : parsed.reportType;

    // Period-level dedup: keyed by (range, is-freshb) so a Fresh B weekly file is not
    // rejected when a general weekly for the same week already exists, and vice versa.
    if (await fimPeriodExists(env, parsed.dateFrom, parsed.dateTo, effectiveReportType)) {
      await markUploadError(env, uploadId, "duplicate period, skipped");
      return json(
        {
          status: "duplicate",
          uploadId,
          reason: "duplicate, skipped",
          dateFrom: parsed.dateFrom,
          dateTo: parsed.dateTo,
        },
        409,
      );
    }

    const period = {
      reportDate: parsed.reportDate,
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      reportType: effectiveReportType,
    };
    // CP (going-forward) daily files are Category-Portfolio keyed → roll up to
    // SAP departments via the merchandise hierarchy before storing.
    let deptRows = parsed.rows;
    // Article rows for the waste drill-down; for CP files map the CP code to its
    // rolled-up dept (mirrors aggregateCpToDept so article sums reconcile).
    let articleRows = parsed.articles;
    let cpStats:
      | { cpRowsParsed: number; articlesParsed: number; cpsMapped: number; cpsUnmapped: string[] }
      | undefined;
    if (parsed.isCpFormat && cpMap) {
      articleRows = parsed.articles.map((a) => ({ ...a, deptCode: cpMap.get(a.deptCode)?.deptCode ?? a.deptCode }));
      const mapped = new Set<string>();
      const unmapped = new Set<string>();
      for (const r of parsed.rows) {
        const hasData = (r.netSalesZar ?? 0) !== 0 || (r.totalCosZar ?? 0) !== 0 || (r.posMarginPct ?? 0) !== 0;
        if (!hasData) continue; // count only CPs with activity
        if (cpMap.has(r.deptCode)) mapped.add(r.deptCode);
        else unmapped.add(r.deptCode);
      }
      deptRows = aggregateCpToDept(parsed.rows, cpMap);
      cpStats = {
        cpRowsParsed: parsed.rows.length,
        articlesParsed: parsed.articleCount,
        cpsMapped: mapped.size,
        cpsUnmapped: [...unmapped].sort(),
      };
    }

    const fiscal = await fiscalCalendarLookup(env, parsed.reportDate);
    console.log("[fim] inserting rows=%d (isCp=%s)", deptRows.length, String(parsed.isCpFormat));
    const tI = Date.now();
    const written = await insertFimRows(env, uploadId, period, fiscal, deptRows, parsed.total);
    console.log("[fim] inserted=%d insertMs=%d", written, Date.now() - tI);
    await markUploadParsed(env, uploadId, "xlsx", written, parsed.skippedRows);
    await env.DB.prepare(`UPDATE uploads SET report_date=?, report_date_to=? WHERE id=?`)
      .bind(parsed.dateFrom, parsed.dateTo, uploadId)
      .run();

    // Article-level waste (for the drill-down) — best-effort; a failure here
    // shouldn't fail an otherwise-good FIM upload (rows are already committed).
    let articlesStored = 0;
    try {
      articlesStored = await insertFimArticles(env, uploadId, period, articleRows);
      if (articlesStored) console.log("[fim] articles stored=%d", articlesStored);
    } catch (artErr) {
      parsed.warnings.push(
        `FIM rows OK, but article-level waste could not be stored: ${artErr instanceof Error ? artErr.message : String(artErr)}`,
      );
    }

    // Anomaly pass. F06/F09 daily figures stay INFO until the fiscal week is
    // complete; weekly/monthly uploads are already aggregated, so escalate.
    const guidelines = await fetchCurrentGuidelines(env, parsed.reportDate);
    const isAggregated = parsed.reportType !== "daily";
    const weekComplete = isAggregated
      ? new Set(deptRows.map((r) => r.deptCode))
      : await fimWeekCompleteDepts(env, fiscal.fiscalYear, fiscal.fiscalWeek, deptRows.map((r) => r.deptCode));
    const freshB = await getFreshBConfig(env);
    const anomalies = detectFimAnomalies(
      deptRows,
      parsed.total,
      guidelines,
      weekComplete,
      parsed.reportDate,
      freshB.depts,
    );
    await insertAnomalies(env, uploadId, anomalies);

    return json({
      status: "parsed",
      uploadId,
      filename,
      r2Key,
      reportDate: parsed.reportDate,
      dateFrom: parsed.dateFrom,
      dateTo: parsed.dateTo,
      reportType: parsed.reportType,
      isCpFormat: parsed.isCpFormat,
      fiscal,
      fiscal_week_code: fiscal.fiscalWeekCode,
      fiscal_period_code: fiscal.fiscalPeriodCode,
      departmentsIngested: deptRows.length,
      dept_rollups: deptRows.length,
      cp_rows_parsed: cpStats?.cpRowsParsed,
      articles_parsed: cpStats?.articlesParsed,
      cps_mapped: cpStats?.cpsMapped,
      cps_unmapped: cpStats?.cpsUnmapped,
      total_sales: parsed.total?.netSalesZar,
      totalIngested: parsed.total ? 1 : 0,
      skippedRows: parsed.skippedRows,
      anomaliesRaised: anomalies.length,
      articlesStored,
      warnings: parsed.warnings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorName = err instanceof Error ? err.name : "Error";
    const stack = err instanceof Error ? err.stack : undefined;
    console.log("[fim] ERROR %s: %s", errorName, message);
    await markUploadError(env, uploadId, message || errorName);
    return json(
      { status: "error", uploadId, error: message || `${errorName} (no message)`, errorName, stack },
      500,
    );
  }
}

/** GET /api/gr-lines?uploadId=&dept=&po=&limit= */
async function handleListGrLines(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.get("uploadId")) {
    where.push("upload_id = ?");
    binds.push(Number(q.get("uploadId")));
  }
  if (q.get("dept")) {
    where.push("dept_code = ?");
    binds.push(q.get("dept"));
  }
  if (q.get("po")) {
    where.push("po_number = ?");
    binds.push(q.get("po"));
  }
  const limit = Math.min(Number(q.get("limit") ?? "200"), 1000);
  const sql = `SELECT id, upload_id, po_number, article_code, article_desc, dept_code, dept_name,
                      qty, cost_zar, sell_zar, margin_pct, gr_date
               FROM gr_lines ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY id DESC LIMIT ?`;
  binds.push(limit);
  const rows = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ grLines: rows.results });
}

async function handleListUploads(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id, filename, kind, status, row_count, skipped_rows, detected_delimiter, size_bytes, uploaded_at, error_message
     FROM uploads ORDER BY id DESC LIMIT 100`,
  ).all();
  return json({ uploads: rows.results });
}

async function handleUploadDetail(env: Env, id: number): Promise<Response> {
  const upload = await env.DB.prepare(`SELECT * FROM uploads WHERE id = ?`).bind(id).first();
  if (!upload) return json({ error: "Upload not found." }, 404);
  const lineStats = await env.DB.prepare(
    `SELECT line_status, COUNT(*) AS n, COALESCE(SUM(line_value_cents),0) AS value_cents
     FROM po_lines WHERE upload_id = ? GROUP BY line_status`,
  )
    .bind(id)
    .all();
  const anomalyStats = await env.DB.prepare(
    `SELECT type, severity, COUNT(*) AS n FROM anomalies WHERE upload_id = ? GROUP BY type, severity`,
  )
    .bind(id)
    .all();
  return json({ upload, lineStats: lineStats.results, anomalyStats: anomalyStats.results });
}

/** Child tables that hold per-upload data, deleted explicitly (D1 does not
 *  enforce ON DELETE CASCADE by default), with their row counts returned. */
const UPLOAD_CHILD_TABLES = [
  "po_lines",
  "gr_lines",
  "fim_daily",
  "customer_counts",
  "fan_score_responses",
  "fan_score_weeks",
  "anomalies",
] as const;

async function deleteUploadById(
  env: Env,
  id: number,
): Promise<{ found: boolean; counts: Record<string, number>; r2Key: string | null }> {
  const up = await env.DB.prepare(`SELECT id, r2_key FROM uploads WHERE id = ?`)
    .bind(id)
    .first<{ id: number; r2_key: string | null }>();
  if (!up) return { found: false, counts: {}, r2Key: null };

  const counts: Record<string, number> = {};
  for (const t of UPLOAD_CHILD_TABLES) {
    const r = await env.DB.prepare(`DELETE FROM ${t} WHERE upload_id = ?`).bind(id).run();
    counts[t] = r.meta.changes ?? 0;
  }
  const u = await env.DB.prepare(`DELETE FROM uploads WHERE id = ?`).bind(id).run();
  counts["uploads"] = u.meta.changes ?? 0;
  return { found: true, counts, r2Key: up.r2_key };
}

/** DELETE /api/uploads/:id — remove an upload, its rows, and its R2 file. */
async function handleDeleteUpload(env: Env, id: number): Promise<Response> {
  const res = await deleteUploadById(env, id);
  if (!res.found) return json({ error: "Upload not found.", id }, 404);
  let r2Deleted = false;
  if (res.r2Key) {
    try {
      await env.UPLOADS_BUCKET.delete(res.r2Key);
      r2Deleted = true;
    } catch {
      /* object may already be gone */
    }
  }
  return json({ status: "ok", id, deleted: res.counts, r2Deleted });
}

/** POST /api/uploads/bulk-delete — body { ids: number[] }. */
async function handleBulkDeleteUploads(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { ids?: number[] } | null;
  const ids = (body?.ids ?? []).map(Number).filter((n) => Number.isInteger(n));
  if (!ids.length) return json({ error: "Provide a non-empty ids array." }, 400);

  const totals: Record<string, number> = { po_lines: 0, gr_lines: 0, fim_daily: 0, anomalies: 0, uploads: 0 };
  const r2Keys: string[] = [];
  for (const id of ids) {
    const res = await deleteUploadById(env, id);
    if (res.r2Key) r2Keys.push(res.r2Key);
    for (const k of Object.keys(res.counts)) totals[k] = (totals[k] ?? 0) + res.counts[k]!;
  }
  if (r2Keys.length) {
    try {
      await env.UPLOADS_BUCKET.delete(r2Keys);
    } catch {
      /* best effort */
    }
  }
  return json({ status: "ok", deletedUploads: totals["uploads"] ?? 0, requested: ids.length, deleted: totals });
}

/** POST /api/uploads/reset — body { confirm: "RESET" }. Wipes all ingested
 *  data + the R2 archive. Preserves config (guidelines, settings) and manual
 *  entries (budgets, creditor statements). */
async function handleResetUploads(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (body?.confirm !== "RESET") {
    return json({ error: 'Type RESET to confirm. Expected { "confirm": "RESET" }.' }, 400);
  }
  const tables = ["anomalies", "po_lines", "gr_lines", "fim_daily", "customer_counts", "fan_score_responses", "fan_score_weeks", "vendors", "articles", "uploads"];
  const deleted: Record<string, number> = {};
  for (const t of tables) {
    const r = await env.DB.prepare(`DELETE FROM ${t}`).run();
    deleted[t] = r.meta.changes ?? 0;
  }
  // Wipe the R2 archive (paginated).
  let r2Deleted = 0;
  let cursor: string | undefined;
  do {
    const list = await env.UPLOADS_BUCKET.list({ cursor, limit: 1000 });
    if (list.objects.length) {
      try {
        await env.UPLOADS_BUCKET.delete(list.objects.map((o) => o.key));
        r2Deleted += list.objects.length;
      } catch {
        /* best effort */
      }
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  return json({
    status: "ok",
    deleted,
    r2Deleted,
    preserved: ["dept_guidelines", "app_settings", "budgets", "creditor_statements"],
  });
}

async function handleListPoLines(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.get("uploadId")) {
    where.push("p.upload_id = ?");
    binds.push(Number(q.get("uploadId")));
  }
  if (q.get("status")) {
    where.push("p.line_status = ?");
    binds.push(q.get("status"));
  }
  if (q.get("vendor")) {
    where.push("v.vendor_code = ?");
    binds.push(q.get("vendor"));
  }
  const limit = Math.min(Number(q.get("limit") ?? "200"), 1000);
  const sql = `
    SELECT p.id, p.po_number, p.po_line_no, v.vendor_code, v.name AS vendor_name,
           a.article_code, a.description AS article_description,
           p.order_qty, p.uom, p.net_price_cents, p.line_value_cents,
           p.open_qty, p.open_value_cents, p.order_date, p.delivery_date, p.line_status
    FROM po_lines p
    LEFT JOIN vendors v ON v.id = p.vendor_id
    LEFT JOIN articles a ON a.id = p.article_id
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY p.id DESC LIMIT ?`;
  binds.push(limit);
  const rows = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ poLines: rows.results });
}

/**
 * GET /api/po-lines/:poNumber — every line of a single purchase order plus a
 * summary header (vendor, order date, total value, open value, line count).
 */
async function handlePoLinesByNumber(env: Env, poNumber: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT p.id, p.po_number, p.po_line_no,
            v.vendor_code, v.name AS vendor_name,
            a.article_code, a.description AS article_description,
            p.mdse_cat AS category_code, p.sloc AS storage_location,
            p.order_qty, p.uom, p.net_price_cents, p.line_value_cents,
            p.gr_qty AS delivered_qty, p.open_qty,
            p.open_value_cents, p.open_invoice_cents,
            p.order_date, p.delivery_date, p.line_status
     FROM po_lines p
     LEFT JOIN vendors v ON v.id = p.vendor_id
     LEFT JOIN articles a ON a.id = p.article_id
     WHERE p.po_number = ?
     ORDER BY CAST(p.po_line_no AS INTEGER), p.id`,
  )
    .bind(poNumber)
    .all<Record<string, unknown>>();

  const lines = rows.results ?? [];
  let totalValue = 0;
  let openValue = 0;
  let vendorCode: string | null = null;
  let vendorName: string | null = null;
  let orderDate: string | null = null;
  for (const l of lines) {
    totalValue += (l.line_value_cents as number) ?? 0;
    openValue += (l.open_value_cents as number) ?? 0;
    if (vendorCode == null && l.vendor_code != null) vendorCode = l.vendor_code as string;
    if (vendorName == null && l.vendor_name != null) vendorName = l.vendor_name as string;
    if (orderDate == null && l.order_date != null) orderDate = l.order_date as string;
  }

  return json({
    poNumber,
    summary: {
      vendor_code: vendorCode,
      vendor_name: vendorName,
      order_date: orderDate,
      total_value_cents: totalValue,
      open_value_cents: openValue,
      line_count: lines.length,
    },
    lines,
  });
}

async function handleListAnomalies(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.get("type")) {
    where.push("type = ?");
    binds.push(q.get("type"));
  }
  if (q.get("severity")) {
    where.push("severity = ?");
    binds.push(q.get("severity"));
  }
  if (q.get("resolved")) {
    where.push("resolved = ?");
    binds.push(q.get("resolved") === "true" ? 1 : 0);
  }
  const limit = Math.min(Number(q.get("limit") ?? "200"), 1000);
  const sql = `SELECT * FROM anomalies ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY
    CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, id DESC LIMIT ?`;
  binds.push(limit);
  const rows = await env.DB.prepare(sql)
    .bind(...binds)
    .all();
  return json({ anomalies: rows.results });
}

/** Extract "Article 245804" / "PO 4767080280" from an anomaly message as a fallback. */
function matchToken(message: string, prefix: string): string | null {
  const m = new RegExp(prefix + "\\s+([A-Za-z0-9/]+)").exec(message ?? "");
  return m ? m[1]! : null;
}

/**
 * Derive an anomaly's business reference date and a drill-through hash route from
 * its type + detail + joined PO/upload context. The hash carries the entity and
 * period so the target screen opens pre-filtered.
 */
function deriveAnomalyDrill(
  r: {
    type: string; message: string; detail: Record<string, unknown>;
    pl_order_date: string | null; pl_po: string | null; pl_article: string | null;
    up_report_date: string | null; detected_at: string;
  },
  weekMap: Map<string, { start: string; end: string }>,
): { refDate: string | null; drill: string | null } {
  const enc = encodeURIComponent;
  const d = r.detail;
  switch (r.type) {
    case "PRICE_SPIKE": {
      const art = r.pl_article ?? matchToken(r.message, "Article");
      const refDate = r.pl_order_date ?? null;
      return { refDate, drill: art ? `articles?article=${enc(art)}${refDate ? `&spike=${enc(refDate)}` : ""}` : null };
    }
    case "STALE_OPEN_ORDER":
    case "NEGATIVE_VALUE": {
      const refDate = (d.orderDate as string) ?? r.pl_order_date ?? null;
      const po = r.pl_po ?? matchToken(r.message, "PO");
      return { refDate, drill: po ? `open?po=${enc(po)}` : null };
    }
    case "FIM_HIGH_WASTE":
    case "FIM_HIGH_SHRINK":
    case "FIM_MARGIN_BELOW_GUIDELINE":
    case "FIM_PARTICIPATION_DEVIATION": {
      const refDate = (d.reportDate as string) ?? null;
      const dept = (d.deptCode as string) ?? null;
      return { refDate, drill: dept ? `waste?dept=${enc(dept)}${refDate ? `&date=${enc(refDate)}` : ""}` : null };
    }
    case "OVER_BUDGET": {
      const wc = d.weekCode != null ? String(d.weekCode) : null;
      const wk = wc ? weekMap.get(wc) : null;
      return { refDate: wk?.end ?? null, drill: wk ? `weekly?from=${enc(wk.start)}&to=${enc(wk.end)}` : null };
    }
    case "OTB_EXCEEDED": {
      const wc = d.week != null ? String(d.week) : null;
      const wk = wc ? weekMap.get(wc) : null;
      return { refDate: wk?.end ?? null, drill: wc ? `otb?week=${enc(wc)}` : "otb" };
    }
    case "NEGATIVE_MARGIN":
    case "LOW_MARGIN":
      return { refDate: r.up_report_date ?? null, drill: "gr" };
    default:
      return { refDate: r.up_report_date ?? r.pl_order_date ?? (r.detected_at ? r.detected_at.slice(0, 10) : null), drill: null };
  }
}

/**
 * GET /api/anomalies/scoped?from=&to=&resolved=&limit= — anomalies enriched with a
 * business reference date and a drill-through hash (Brief 4). When from/to are
 * given, only anomalies whose refDate falls in the window are returned (fixes the
 * weekly view showing the latest anomalies regardless of the selected week).
 */
async function handleScopedAnomalies(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const from = q.get("from");
  const to = q.get("to");
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.get("resolved")) { where.push("a.resolved = ?"); binds.push(q.get("resolved") === "true" ? 1 : 0); }
  if (q.get("severity")) { where.push("a.severity = ?"); binds.push(q.get("severity")); }
  const limit = Math.min(Number(q.get("limit") ?? "60"), 500);

  const [rowsRes, weeksRes] = await Promise.all([
    env.DB.prepare(
      `SELECT a.id, a.upload_id, a.po_line_id, a.type, a.severity, a.message, a.detail_json, a.resolved, a.detected_at,
              pl.order_date pl_order_date, pl.po_number pl_po, art.article_code pl_article, u.report_date up_report_date
       FROM anomalies a
       LEFT JOIN po_lines pl ON pl.id = a.po_line_id
       LEFT JOIN articles art ON art.id = pl.article_id
       LEFT JOIN uploads u ON u.id = a.upload_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, a.id DESC LIMIT 1000`,
    ).bind(...binds).all<Record<string, string | number | null>>(),
    env.DB.prepare(`SELECT fiscal_week_code code, week_start, week_end FROM fiscal_weeks`).all<{ code: string; week_start: string; week_end: string }>(),
  ]);
  const weekMap = new Map((weeksRes.results ?? []).map((w) => [w.code, { start: w.week_start, end: w.week_end }]));

  const out = [];
  for (const raw of rowsRes.results ?? []) {
    let detail: Record<string, unknown> = {};
    try { detail = raw.detail_json ? JSON.parse(String(raw.detail_json)) : {}; } catch { /* keep {} */ }
    const { refDate, drill } = deriveAnomalyDrill(
      {
        type: String(raw.type), message: String(raw.message ?? ""), detail,
        pl_order_date: (raw.pl_order_date as string) ?? null, pl_po: (raw.pl_po as string) ?? null,
        pl_article: (raw.pl_article as string) ?? null, up_report_date: (raw.up_report_date as string) ?? null,
        detected_at: String(raw.detected_at ?? ""),
      },
      weekMap,
    );
    if (from && to && !(refDate && refDate >= from && refDate <= to)) continue;
    out.push({
      id: raw.id, type: raw.type, severity: raw.severity, message: raw.message,
      resolved: raw.resolved, refDate, drill,
    });
    if (out.length >= limit) break;
  }
  return json({ anomalies: out, scoped: !!(from && to), from: from ?? null, to: to ?? null });
}

/** POST /api/budgets — define or update a spend cap. */
async function handleCreateBudget(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    period?: string;
    scopeType?: string;
    scopeRef?: string | null;
    capCents?: number;
    capRands?: number;
    note?: string;
  } | null;
  if (!body?.period) return json({ error: "period is required (e.g. '2026-06')." }, 400);
  const scopeType = body.scopeType ?? "overall";
  const capCents = body.capCents ?? (body.capRands != null ? Math.round(body.capRands * 100) : undefined);
  if (capCents == null) return json({ error: "capCents or capRands is required." }, 400);

  await env.DB.prepare(
    `INSERT INTO budgets (period, scope_type, scope_ref, cap_cents, note)
     VALUES (?,?,?,?,?)
     ON CONFLICT(period, scope_type, scope_ref) DO UPDATE SET cap_cents=excluded.cap_cents, note=excluded.note`,
  )
    .bind(body.period, scopeType, body.scopeRef ?? null, capCents, body.note ?? null)
    .run();
  return json({ status: "ok", period: body.period, scopeType, scopeRef: body.scopeRef ?? null, capCents });
}

/** GET /api/budget — current traffic-light status for every defined budget. */
async function handleBudgetStatus(env: Env): Promise<Response> {
  const t = thresholds(env);
  const budgets = await env.DB.prepare(`SELECT * FROM budgets ORDER BY period DESC`).all<{
    id: number;
    period: string;
    scope_type: string;
    scope_ref: string | null;
    cap_cents: number;
  }>();
  const out = [];
  for (const b of budgets.results ?? []) {
    const committed = await committedOpenValueCents(
      env,
      b.scope_type as "overall" | "department" | "vendor",
      b.scope_ref,
    );
    const used = b.cap_cents > 0 ? committed / b.cap_cents : 0;
    out.push({
      period: b.period,
      scopeType: b.scope_type,
      scopeRef: b.scope_ref,
      capCents: b.cap_cents,
      committedCents: committed,
      remainingCents: b.cap_cents - committed,
      usedPct: Math.round(used * 1000) / 10,
      status: budgetStatus(used, t),
    });
  }
  return json({ thresholds: t, budgets: out });
}

// --- guideline endpoints -------------------------------------------------

const GROUP_RANK: Record<string, number> = { "Non-Fresh": 0, "Fresh-A": 1, "Fresh-B": 2 };

/** GET /api/guidelines — the current guideline for every department. */
async function handleListGuidelines(env: Env): Promise<Response> {
  const map = await fetchCurrentGuidelines(env);
  const guidelines = [...map.values()].sort(
    (a, b) =>
      (GROUP_RANK[a.dept_group ?? ""] ?? 9) - (GROUP_RANK[b.dept_group ?? ""] ?? 9) ||
      a.dept_code.localeCompare(b.dept_code),
  );
  return json({ asOf: new Date().toISOString().slice(0, 10), guidelines });
}

/** PUT /api/guidelines/:dept — record a new effective-dated guideline margin. */
async function handleUpdateGuideline(req: Request, env: Env, dept: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as {
    guideline_margin_pct?: number;
    effective_from?: string;
  } | null;
  const deptCode = dept.toUpperCase();
  const margin = body?.guideline_margin_pct;
  const effectiveFrom = body?.effective_from;
  if (margin == null || !Number.isFinite(margin)) {
    return json({ error: "guideline_margin_pct (number) is required." }, 400);
  }
  if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return json({ error: "effective_from (YYYY-MM-DD) is required." }, 400);
  }

  // Carry forward the rest of the department's metadata from its latest row.
  const prev = await env.DB.prepare(
    `SELECT dept_name, dept_group, margin_contribution_pct, participation_guideline_pct
     FROM dept_guidelines WHERE dept_code = ? ORDER BY effective_from DESC LIMIT 1`,
  )
    .bind(deptCode)
    .first<{
      dept_name: string | null;
      dept_group: string | null;
      margin_contribution_pct: number | null;
      participation_guideline_pct: number | null;
    }>();

  await env.DB.prepare(
    `INSERT INTO dept_guidelines
       (dept_code, dept_name, dept_group, guideline_margin_pct,
        margin_contribution_pct, participation_guideline_pct, effective_from, updated_at)
     VALUES (?,?,?,?,?,?,?, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
     ON CONFLICT(dept_code, effective_from) DO UPDATE SET
       guideline_margin_pct = excluded.guideline_margin_pct,
       updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  )
    .bind(
      deptCode,
      prev?.dept_name ?? null,
      prev?.dept_group ?? null,
      margin,
      prev?.margin_contribution_pct ?? null,
      prev?.participation_guideline_pct ?? null,
      effectiveFrom,
    )
    .run();

  return json({ status: "ok", deptCode, guideline_margin_pct: margin, effective_from: effectiveFrom });
}

/** GET /api/guidelines/:dept/history — full effective-dated change history. */
async function handleGuidelineHistory(env: Env, dept: string): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT dept_code, dept_name, dept_group, guideline_margin_pct,
            margin_contribution_pct, participation_guideline_pct, effective_from, updated_at
     FROM dept_guidelines WHERE dept_code = ? ORDER BY effective_from DESC`,
  )
    .bind(dept.toUpperCase())
    .all();
  return json({ deptCode: dept.toUpperCase(), history: rows.results });
}

// --- FIM query endpoints -------------------------------------------------

/**
 * GET /api/fim/ima?from=&to= — store-total of every FIM money column we actually
 * store in fim_daily, for the Integrated Margin Analysis screens. Defaults to the
 * calendar month of the latest report_date. pos_margin_pct is recomputed from the
 * summed sales/cos (never averaged). Columns not in the schema simply aren't
 * returned, so the client shows "--" for them.
 */
async function handleFimIma(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  let from = q.get("from");
  let to = q.get("to");
  if (!from || !to) {
    const mx = await env.DB.prepare(`SELECT MAX(report_date) AS d FROM fim_daily`).first<{ d: string | null }>();
    if (!mx?.d) return json({ from: null, to: null, values: {} });
    from = mx.d.slice(0, 7) + "-01";
    to = mx.d;
  }
  const row = await env.DB.prepare(
    `SELECT
        COALESCE(SUM(net_sales_zar),0)        AS net_sales_zar,
        COALESCE(SUM(total_cos_zar),0)        AS total_cos_zar,
        COALESCE(SUM(pos_profit_zar),0)       AS pos_profit_zar,
        COALESCE(SUM(shrink_zar),0)           AS shrink_zar,
        COALESCE(SUM(waste_zar),0)            AS waste_zar,
        COALESCE(SUM(total_purchases_zar),0)  AS total_purchases_zar,
        COALESCE(SUM(net_gr_cost_zar),0)      AS net_gr_cost_zar,
        COALESCE(SUM(opening_soh_zar),0)      AS opening_soh_zar,
        COALESCE(SUM(closing_soh_zar),0)      AS closing_soh_zar,
        COALESCE(SUM(commercial_disc_zar),0)  AS commercial_disc_zar,
        COALESCE(SUM(line_disc_zar),0)        AS line_disc_zar,
        COALESCE(SUM(basket_disc_zar),0)      AS basket_disc_zar,
        COALESCE(SUM(trade_invest_zar),0)     AS trade_invest_zar,
        COALESCE(SUM(sallies_tallies_zar),0)  AS sallies_tallies_zar,
        COALESCE(SUM(swell_allowance_zar),0)  AS swell_allowance_zar,
        COALESCE(SUM(total_shortages_zar),0)  AS total_shortages_zar,
        COALESCE(SUM(net_shrinkage_zar),0)    AS net_shrinkage_zar,
        COALESCE(SUM(rtc_zar),0)              AS rtc_zar
     FROM fim_daily WHERE dept_code != 'TOTAL' AND report_type != 'weekly_freshb' AND report_date >= ? AND report_date <= ?`,
  )
    .bind(from, to)
    .first<Record<string, number>>();
  const v = (row ?? {}) as Record<string, number>;
  const ns = v.net_sales_zar ?? 0;
  const cos = v.total_cos_zar ?? 0;
  const pos_margin_pct = ns > 0 ? Math.round(((ns - cos) / ns) * 10000) / 100 : null;

  // Operating & store margin: prefer the FIM-stored authoritative values from each
  // file's TOTAL ("Overall Result") row, sales-weighted across the period (this
  // matches the FIM print within rounding). Fall back to our derived figures for
  // any period whose TOTAL rows don't carry them.
  const tot = await env.DB.prepare(
    `SELECT SUM(net_sales_zar * operating_margin_pct) AS op_w,
            SUM(CASE WHEN operating_margin_pct IS NOT NULL THEN net_sales_zar ELSE 0 END) AS op_ns,
            SUM(net_sales_zar * store_margin_pct) AS st_w,
            SUM(CASE WHEN store_margin_pct IS NOT NULL THEN net_sales_zar ELSE 0 END) AS st_ns
     FROM fim_daily WHERE dept_code = 'TOTAL' AND report_type != 'weekly_freshb' AND report_date >= ? AND report_date <= ?`,
  )
    .bind(from, to)
    .first<{ op_w: number | null; op_ns: number | null; st_w: number | null; st_ns: number | null }>();

  // Derived fallbacks (from summed Rand): operating = POS profit + funding + swell;
  // store = operating - total shortages.
  const derivedOpProfit =
    (v.pos_profit_zar ?? 0) + (v.commercial_disc_zar ?? 0) + (v.line_disc_zar ?? 0) +
    (v.basket_disc_zar ?? 0) + (v.trade_invest_zar ?? 0) + (v.sallies_tallies_zar ?? 0) +
    (v.swell_allowance_zar ?? 0);
  const derivedStoreProfit = derivedOpProfit - (v.total_shortages_zar ?? 0);
  const derivedOpMargin = ns > 0 ? Math.round((derivedOpProfit / ns) * 10000) / 100 : null;
  const derivedStoreMargin = ns > 0 ? Math.round((derivedStoreProfit / ns) * 10000) / 100 : null;

  const fimOpMargin =
    tot?.op_ns && tot.op_ns > 0 ? Math.round(((tot.op_w ?? 0) / tot.op_ns) * 100) / 100 : null;
  const fimStoreMargin =
    tot?.st_ns && tot.st_ns > 0 ? Math.round(((tot.st_w ?? 0) / tot.st_ns) * 100) / 100 : null;

  const operating_margin_pct = fimOpMargin != null ? fimOpMargin : derivedOpMargin;
  const store_margin_pct = fimStoreMargin != null ? fimStoreMargin : derivedStoreMargin;
  // Keep profit Rand consistent with the displayed (FIM-sourced) margin.
  const operating_profit_zar =
    operating_margin_pct != null ? Math.round((operating_margin_pct / 100) * ns) : derivedOpProfit;
  const store_profit_zar =
    store_margin_pct != null ? Math.round((store_margin_pct / 100) * ns) : derivedStoreProfit;
  const margin_source = fimOpMargin != null ? "fim" : "derived";

  return json({
    from,
    to,
    margin_source,
    values: { ...v, pos_margin_pct, operating_profit_zar, store_profit_zar, operating_margin_pct, store_margin_pct },
  });
}

/** GET /api/fim/summary?from=&to=&dept=&fy=&quarter=&week= */
async function handleFimSummary(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const where: string[] = ["dept_code != 'TOTAL'", "report_type != 'weekly_freshb'"];
  const binds: unknown[] = [];
  const addEq = (col: string, val: string | null, cast?: (v: string) => unknown) => {
    if (val == null || val === "") return;
    where.push(`${col} = ?`);
    binds.push(cast ? cast(val) : val);
  };
  if (q.get("from")) {
    where.push("report_date >= ?");
    binds.push(q.get("from"));
  }
  if (q.get("to")) {
    where.push("report_date <= ?");
    binds.push(q.get("to"));
  }
  addEq("dept_code", q.get("dept") ? q.get("dept")!.toUpperCase() : null);
  addEq("fiscal_year", q.get("fy"), Number);
  addEq("fiscal_quarter", q.get("quarter"), Number);
  addEq("fiscal_week", q.get("week"), Number);
  const whereSql = "WHERE " + where.join(" AND ");

  const totals = await env.DB.prepare(
    `SELECT COALESCE(SUM(net_sales_zar),0) AS net_sales,
            COALESCE(SUM(total_cos_zar),0) AS total_cos,
            COALESCE(SUM(pos_profit_zar),0) AS pos_profit,
            COALESCE(SUM(shrink_zar),0) AS shrink,
            COALESCE(SUM(waste_zar),0) AS waste,
            COUNT(DISTINCT report_date) AS days,
            COUNT(DISTINCT dept_code) AS dept_count
     FROM fim_daily ${whereSql}`,
  )
    .bind(...binds)
    .first<{ net_sales: number; total_cos: number; pos_profit: number; shrink: number; waste: number; days: number; dept_count: number }>();

  const departments = await env.DB.prepare(
    `SELECT dept_code, MAX(dept_name) AS dept_name,
            COALESCE(SUM(net_sales_zar),0) AS net_sales,
            COALESCE(SUM(total_cos_zar),0) AS total_cos,
            COALESCE(SUM(pos_profit_zar),0) AS pos_profit,
            COALESCE(SUM(shrink_zar),0) AS shrink,
            COALESCE(SUM(waste_zar),0) AS waste
     FROM fim_daily ${whereSql}
     GROUP BY dept_code ORDER BY net_sales DESC`,
  )
    .bind(...binds)
    .all<{ dept_code: string; dept_name: string; net_sales: number; total_cos: number; pos_profit: number; shrink: number; waste: number }>();

  const blended = (net: number, cos: number) => (net > 0 ? Math.round(((net - cos) / net) * 1000) / 10 : null);
  const t = totals ?? { net_sales: 0, total_cos: 0, pos_profit: 0, shrink: 0, waste: 0, days: 0, dept_count: 0 };

  return json({
    filters: {
      from: q.get("from"),
      to: q.get("to"),
      dept: q.get("dept"),
      fy: q.get("fy"),
      quarter: q.get("quarter"),
      week: q.get("week"),
    },
    totals: {
      netSalesZar: round2n(t.net_sales),
      totalCosZar: round2n(t.total_cos),
      posProfitZar: round2n(t.pos_profit),
      blendedMarginPct: blended(t.net_sales, t.total_cos),
      shrinkZar: round2n(t.shrink),
      wasteZar: round2n(t.waste),
      days: t.days,
      deptCount: t.dept_count,
    },
    departments: (departments.results ?? []).map((d) => ({
      deptCode: d.dept_code,
      deptName: d.dept_name,
      netSalesZar: round2n(d.net_sales),
      totalCosZar: round2n(d.total_cos),
      posProfitZar: round2n(d.pos_profit),
      marginPct: blended(d.net_sales, d.total_cos),
      shrinkZar: round2n(d.shrink),
      wasteZar: round2n(d.waste),
    })),
  });
}

/** GET /api/fim/departments — latest figures per dept with vs-guideline delta. */
async function handleFimDepartments(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT f.* FROM fim_daily f
     WHERE f.dept_code != 'TOTAL' AND f.report_type != 'weekly_freshb'
       AND f.report_date = (SELECT MAX(report_date) FROM fim_daily f2 WHERE f2.dept_code = f.dept_code AND f2.report_type != 'weekly_freshb')`,
  ).all<Record<string, number | string | null>>();

  const guidelines = await fetchCurrentGuidelines(env);
  const departments = (rows.results ?? []).map((r) => {
    const code = String(r.dept_code);
    const g = guidelines.get(code);
    const actual = r.pos_margin_pct == null ? null : Number(r.pos_margin_pct);
    const guide = g?.guideline_margin_pct ?? null;
    return {
      deptCode: code,
      deptName: r.dept_name,
      deptGroup: g?.dept_group ?? null,
      reportDate: r.report_date,
      netSalesZar: r.net_sales_zar,
      posMarginPct: actual,
      operatingMarginPct: r.operating_margin_pct,
      storeMarginPct: r.store_margin_pct,
      guidelineMarginPct: guide,
      marginDeltaPp: actual != null && guide != null ? Math.round((actual - guide) * 100) / 100 : null,
      participationGuidelinePct: g?.participation_guideline_pct ?? null,
    };
  });
  departments.sort(
    (a, b) =>
      (GROUP_RANK[a.deptGroup ?? ""] ?? 9) - (GROUP_RANK[b.deptGroup ?? ""] ?? 9) ||
      a.deptCode.localeCompare(b.deptCode),
  );
  return json({ departments });
}

/** GET /api/fim/trend?dept= — weekly margin rollup per dept for sparklines. */
async function handleFimTrend(req: Request, env: Env): Promise<Response> {
  const q = new URL(req.url).searchParams;
  // Convention: exclude the fim_daily dept_code='TOTAL' store-total row from any
  // per-dept aggregation (else it surfaces as a fake "TOTAL" department). Store
  // totals are always the sum of real depts; the TOTAL row is read only for the
  // store-level *_margin_pct columns that aren't stored per dept (handleFimIma).
  const where: string[] = ["dept_code != 'TOTAL'", "report_type != 'weekly_freshb'"];
  const binds: unknown[] = [];
  if (q.get("dept")) {
    where.push("dept_code = ?");
    binds.push(q.get("dept")!.toUpperCase());
  }
  const rows = await env.DB.prepare(
    `SELECT dept_code, MAX(dept_name) AS dept_name, fiscal_year, fiscal_week,
            MIN(fiscal_week_start) AS week_start,
            COALESCE(SUM(net_sales_zar),0) AS net_sales,
            COALESCE(SUM(total_cos_zar),0) AS total_cos,
            COUNT(DISTINCT report_date) AS days
     FROM fim_daily ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY dept_code, fiscal_year, fiscal_week
     ORDER BY dept_code, fiscal_year, fiscal_week`,
  )
    .bind(...binds)
    .all<{ dept_code: string; dept_name: string; fiscal_year: number; fiscal_week: number; week_start: string; net_sales: number; total_cos: number; days: number }>();

  const byDept = new Map<string, { deptCode: string; deptName: string; points: unknown[] }>();
  for (const r of rows.results ?? []) {
    const entry = byDept.get(r.dept_code) ?? { deptCode: r.dept_code, deptName: r.dept_name, points: [] };
    entry.points.push({
      fiscalYear: r.fiscal_year,
      fiscalWeek: r.fiscal_week,
      weekStart: r.week_start,
      netSalesZar: round2n(r.net_sales),
      marginPct: r.net_sales > 0 ? Math.round(((r.net_sales - r.total_cos) / r.net_sales) * 1000) / 10 : null,
      days: r.days,
    });
    byDept.set(r.dept_code, entry);
  }
  return json({ trend: [...byDept.values()] });
}

function round2n(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/**
 * GR / margin panel data: the latest goods-receipt upload's blended margin,
 * a per-department cost/sell/margin-vs-guideline breakdown, and the inline
 * negative/low-margin anomalies raised for that upload.
 */
async function buildGrPanel(env: Env, guidelines: Awaited<ReturnType<typeof fetchCurrentGuidelines>>) {
  const latest = await env.DB.prepare(
    `SELECT id, filename, uploaded_at FROM uploads
     WHERE kind = 'gr' AND status = 'parsed' ORDER BY id DESC LIMIT 1`,
  ).first<{ id: number; filename: string; uploaded_at: string }>();
  if (!latest) return null;

  // These three reads are all keyed by latest.id and independent of each other, so
  // run them concurrently (one round-trip instead of three). Margin sums use cost
  // only where sell is present, so blended margin is apples-to-apples (some GR lines
  // carry cost but no sell value).
  const [summary, deptRows, marginAnomalies] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS lines,
              COALESCE(SUM(CASE WHEN sell_zar IS NOT NULL THEN cost_zar END),0) AS cost,
              COALESCE(SUM(sell_zar),0) AS sell
       FROM gr_lines WHERE upload_id = ?`,
    )
      .bind(latest.id)
      .first<{ lines: number; cost: number; sell: number }>(),
    env.DB.prepare(
      `SELECT dept_code, MAX(dept_name) AS dept_name, COUNT(*) AS lines,
              COALESCE(SUM(CASE WHEN sell_zar IS NOT NULL THEN cost_zar END),0) AS cost,
              COALESCE(SUM(sell_zar),0) AS sell
       FROM gr_lines WHERE upload_id = ?
       GROUP BY dept_code ORDER BY sell DESC`,
    )
      .bind(latest.id)
      .all<{ dept_code: string; dept_name: string; lines: number; cost: number; sell: number }>(),
    env.DB.prepare(
      `SELECT type, severity, message, detail_json FROM anomalies
       WHERE upload_id = ? AND type IN ('NEGATIVE_MARGIN','LOW_MARGIN')
       ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, id DESC LIMIT 20`,
    )
      .bind(latest.id)
      .all<{ type: string; severity: string; message: string; detail_json: string | null }>(),
  ]);

  const blended = (cost: number, sell: number) => (sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null);

  const departments = (deptRows.results ?? []).map((d) => {
    const g = guidelines.get(guidelineKeyForDept(d.dept_code) ?? "");
    const margin = blended(d.cost, d.sell);
    const guide = g?.guideline_margin_pct ?? null;
    return {
      deptCode: d.dept_code,
      deptName: d.dept_name,
      lines: d.lines,
      costZar: round2n(d.cost),
      sellZar: round2n(d.sell),
      marginPct: margin,
      guidelineMarginPct: guide,
      deltaPp: margin != null && guide != null ? Math.round((margin - guide) * 100) / 100 : null,
    };
  });

  return {
    uploadId: latest.id,
    filename: latest.filename,
    uploadedAt: latest.uploaded_at,
    totals: {
      lines: summary?.lines ?? 0,
      costZar: round2n(summary?.cost ?? 0),
      sellZar: round2n(summary?.sell ?? 0),
      blendedMarginPct: blended(summary?.cost ?? 0, summary?.sell ?? 0),
    },
    departments,
    anomalies: (marginAnomalies.results ?? []).map((a) => ({
      type: a.type,
      severity: a.severity,
      message: a.message,
      detail: a.detail_json ? JSON.parse(a.detail_json) : null,
    })),
  };
}

/**
 * "Yesterday's goods receipt" tile: the single most recent GR business day
 * (MAX(gr_date), i.e. yesterday's receipts), aggregated across whatever
 * upload(s) carry that date. Distinct from buildGrPanel, which is upload-scoped
 * (filename + upload-level margin flags) for the legacy /classic dashboard.
 */
async function buildGrYesterday(env: Env) {
  const latest = await env.DB.prepare(`SELECT MAX(gr_date) AS d FROM gr_lines`).first<{ d: string | null }>();
  const date = latest?.d ?? null;
  if (!date) return null;

  // Both keyed by the same date and independent — run concurrently.
  const [summary, deptRows] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS lines,
              COALESCE(SUM(CASE WHEN sell_zar IS NOT NULL THEN cost_zar END),0) AS cost,
              COALESCE(SUM(sell_zar),0) AS sell
       FROM gr_lines WHERE gr_date = ?`,
    )
      .bind(date)
      .first<{ lines: number; cost: number; sell: number }>(),
    env.DB.prepare(
      `SELECT dept_code, MAX(dept_name) AS dept_name,
              COALESCE(SUM(sell_zar),0) AS sell
       FROM gr_lines WHERE gr_date = ?
       GROUP BY dept_code ORDER BY sell DESC LIMIT 3`,
    )
      .bind(date)
      .all<{ dept_code: string; dept_name: string; sell: number }>(),
  ]);

  const blended = (cost: number, sell: number) => (sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null);

  return {
    date,
    totals: {
      lines: summary?.lines ?? 0,
      costZar: round2n(summary?.cost ?? 0),
      sellZar: round2n(summary?.sell ?? 0),
      blendedMarginPct: blended(summary?.cost ?? 0, summary?.sell ?? 0),
    },
    departments: (deptRows.results ?? []).map((d) => ({
      deptCode: d.dept_code,
      deptName: d.dept_name,
      sellZar: round2n(d.sell),
    })),
  };
}

/**
 * Margin-performance section: latest FIM day per department, grouped
 * Non-Fresh / Fresh-A / Fresh-B, with actual-vs-guideline margin, actual-vs-
 * guideline participation, and the worst performer per group flagged.
 */
async function buildMarginPerformance(
  env: Env,
  guidelines: Awaited<ReturnType<typeof fetchCurrentGuidelines>>,
) {
  const latest = await env.DB.prepare(
    `SELECT MAX(report_date) AS d FROM fim_daily WHERE report_type != 'weekly_freshb'`,
  ).first<{ d: string | null }>();
  const reportDate = latest?.d ?? null;
  if (!reportDate) return null;

  const rows = await env.DB.prepare(
    `SELECT dept_code, dept_name, net_sales_zar, pos_margin_pct
     FROM fim_daily WHERE report_date = ? AND report_type != 'weekly_freshb'`,
  )
    .bind(reportDate)
    .all<{ dept_code: string; dept_name: string | null; net_sales_zar: number | null; pos_margin_pct: number | null }>();

  const totalRow = (rows.results ?? []).find((r) => r.dept_code === "TOTAL");
  const totalNet = totalRow?.net_sales_zar ?? null;

  type DeptPerf = {
    deptCode: string;
    deptName: string | null;
    marginPct: number | null;
    guidelineMarginPct: number | null;
    marginDeltaPp: number | null;
    participationPct: number | null;
    participationGuidelinePct: number | null;
    isProduction: boolean;
    worst?: boolean;
  };
  const groups: Record<string, DeptPerf[]> = { "Non-Fresh": [], "Fresh-A": [], "Fresh-B": [] };

  for (const r of rows.results ?? []) {
    if (r.dept_code === "TOTAL") continue;
    const g = guidelines.get(r.dept_code);
    if (!g?.dept_group || !(g.dept_group in groups)) continue;
    const margin = r.pos_margin_pct;
    const guide = g.guideline_margin_pct ?? null;
    const participation =
      totalNet != null && totalNet > 0 && r.net_sales_zar != null
        ? Math.round((r.net_sales_zar / totalNet) * 10000) / 100
        : null;
    groups[g.dept_group]!.push({
      deptCode: r.dept_code,
      deptName: r.dept_name ?? g.dept_name,
      marginPct: margin,
      guidelineMarginPct: guide,
      marginDeltaPp: margin != null && guide != null ? Math.round((margin - guide) * 100) / 100 : null,
      participationPct: participation,
      participationGuidelinePct: g.participation_guideline_pct ?? null,
      isProduction: r.dept_code === "F06" || r.dept_code === "F09",
    });
  }

  // Flag the worst margin-vs-guideline performer in each group.
  for (const key of Object.keys(groups)) {
    const arr = groups[key]!;
    let worst: DeptPerf | null = null;
    for (const d of arr) {
      if (d.marginDeltaPp == null) continue;
      if (!worst || d.marginDeltaPp < worst.marginDeltaPp!) worst = d;
    }
    if (worst) worst.worst = true;
    arr.sort((a, b) => a.deptCode.localeCompare(b.deptCode));
  }

  return {
    reportDate,
    groups: ["Non-Fresh", "Fresh-A", "Fresh-B"].map((name) => ({ group: name, departments: groups[name]! })),
  };
}

/** GET /api/dashboard — one-call aggregate powering the HTML dashboard. */
async function handleDashboard(env: Env): Promise<Response> {
  const t = thresholds(env);

  // Phase 1 — config + guideline snapshot + every read that depends on neither,
  // all in parallel. These 10 reads were previously sequential awaits and were the
  // bulk of the ~3.5s latency (round-trip per query). Aged-out open PO lines (older
  // than open_po_max_age_days, via notAged below) are treated as auto-closed —
  // excluded from Open/Committed tiles but never mutated.
  const [maxAge, guidelines, byStatus, aging, sevRows, staleRow, topAnomalies, recentUploads, budgetRows, grYesterday] =
    await Promise.all([
      openPoMaxAgeDays(env),
      fetchCurrentGuidelines(env),
      // line totals by status (raw breakdown; the Open tiles below apply the age cap)
      env.DB.prepare(
        `SELECT line_status, COUNT(*) AS n,
                COALESCE(SUM(open_value_cents),0) AS open_value_cents,
                COALESCE(SUM(line_value_cents),0) AS line_value_cents
         FROM po_lines GROUP BY line_status`,
      ).all<{ line_status: string; n: number; open_value_cents: number; line_value_cents: number }>(),
      // Open-order aging buckets. The SAP PO export carries no delivery date, so
      // aging is measured from COALESCE(last_gr_date, order_date) per the
      // reconciliation rules; fully-received lines are excluded (they are complete).
      env.DB.prepare(
        `SELECT CASE
            WHEN COALESCE(received_qty,0) <= 0 THEN
              CASE
                WHEN order_date IS NULL THEN 'no_date'
                WHEN julianday('now') - julianday(order_date) <= 7  THEN 'new_order'
                WHEN julianday('now') - julianday(order_date) <= 21 THEN 'awaiting'
                WHEN julianday('now') - julianday(order_date) <= 34 THEN 'overdue'
                WHEN julianday('now') - julianday(order_date) <= 60 THEN 'stale'
                ELSE 'historical'
              END
            WHEN julianday('now') - julianday(COALESCE(last_gr_date, order_date)) > 21
              THEN 'stale_partial'
            ELSE 'partial'
          END AS bucket,
          COUNT(*) AS n, COALESCE(SUM(open_value_cents),0) AS value_cents
         FROM po_lines WHERE is_fully_received = 0 GROUP BY bucket`,
      ).all<{ bucket: string; n: number; value_cents: number }>(),
      // unresolved anomaly counts by severity
      env.DB.prepare(
        `SELECT severity, COUNT(*) AS n FROM anomalies WHERE resolved = 0 GROUP BY severity`,
      ).all<{ severity: string; n: number }>(),
      // Stale orders KPI: open lines 35–59 days old (the flagged window, tightened
      // with the 60-day auto-close). Lines ≥60 days are auto-closed (excluded from
      // Open/Committed); <35 days are still active.
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM po_lines
         WHERE is_fully_received = 0 AND order_date IS NOT NULL
           AND order_date <= date('now','-35 days')
           AND order_date >  date('now','-60 days')`,
      ).first<{ n: number }>(),
      // top open anomalies (severity, then newest)
      env.DB.prepare(
        `SELECT id, type, severity, message, detected_at FROM anomalies WHERE resolved = 0
         ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, id DESC LIMIT 12`,
      ).all(),
      env.DB.prepare(
        `SELECT id, filename, status, row_count, uploaded_at FROM uploads ORDER BY id DESC LIMIT 6`,
      ).all(),
      env.DB.prepare(`SELECT * FROM budgets ORDER BY period DESC`).all<{
        period: string;
        scope_type: string;
        scope_ref: string | null;
        cap_cents: number;
      }>(),
      buildGrYesterday(env),
    ]);

  const notAged = notAgedOutSql(maxAge);

  // Phase 2 — reads that depend on maxAge (notAged) or the guideline snapshot,
  // again all in parallel (incl. the per-budget commitment lookups).
  const [committed, openRow, grPanel, marginPerformance, budgets] = await Promise.all([
    // Open Committed — THE single shared figure (S001-only netting, aged-out and
    // manually-closed POs excluded). Same openCommitted() as /api/dashboard/tiles
    // and /api/po-lines/list, so every screen shows one identical number.
    openCommitted(env),
    // Open value/lines: non-closed lines within the age cap.
    env.DB.prepare(
      `SELECT COALESCE(SUM(open_value_cents),0) AS open_value_cents, COUNT(*) AS n
       FROM po_lines WHERE line_status != 'closed' AND ${notAged}`,
    ).first<{ open_value_cents: number; n: number }>(),
    // GR margin panel + FIM margin performance (share one guideline snapshot).
    buildGrPanel(env, guidelines),
    buildMarginPerformance(env, guidelines),
    // budgets with current status (per-budget commitment lookups run concurrently)
    Promise.all(
      (budgetRows.results ?? []).map(async (b) => {
        const committed = await committedOpenValueCents(
          env,
          b.scope_type as "overall" | "department" | "vendor",
          b.scope_ref,
        );
        const used = b.cap_cents > 0 ? committed / b.cap_cents : 0;
        return {
          period: b.period,
          scopeType: b.scope_type,
          scopeRef: b.scope_ref,
          capCents: b.cap_cents,
          committedCents: committed,
          remainingCents: b.cap_cents - committed,
          usedPct: Math.round(used * 1000) / 10,
          status: budgetStatus(used, t),
        };
      }),
    ),
  ]);

  const outstandingValueCents = committed.valueCents;
  const outstandingLines = committed.lines;
  const openValueCents = openRow?.open_value_cents ?? 0;
  const openLines = openRow?.n ?? 0;

  const anomalyCounts: Record<string, number> = {};
  for (const r of sevRows.results ?? []) anomalyCounts[r.severity] = r.n;

  return json({
    store: STORE,
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC",
    totals: { byStatus: byStatus.results, openValueCents, openLines, outstandingValueCents, outstandingLines },
    aging: aging.results,
    anomalyCounts,
    staleOpenOrders: staleRow?.n ?? 0,
    topAnomalies: topAnomalies.results,
    recentUploads: recentUploads.results,
    budgets,
    grPanel,
    grYesterday,
    marginPerformance,
  });
}

// --- Manual "declare stale" PO closures (companion to the age auto-close) --------

/** POST /api/po-closures — mark a PO stale (exclude from all open calcs). Body:
 *  { poNumber, note?, closedBy? }. Upsert: a re-close clears any prior reopened_at
 *  and stamps a fresh closed_at. Never mutates po_lines. Admin-gated by the caller. */
async function handleMarkStale(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { poNumber?: string; note?: string; closedBy?: string } | null;
  const poNumber = (body?.poNumber ?? "").trim();
  if (!poNumber) return json({ error: "poNumber required" }, 400);
  const exists = await env.DB.prepare(`SELECT 1 FROM po_lines WHERE po_number = ? LIMIT 1`).bind(poNumber).first();
  if (!exists) return json({ error: `Unknown PO ${poNumber}` }, 404);
  const note = body?.note?.trim() || null;
  const closedBy = body?.closedBy?.trim() || null;
  await env.DB.prepare(
    `INSERT INTO po_manual_closures (po_number, closed_at, closed_by, note, reopened_at)
     VALUES (?, strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, ?, NULL)
     ON CONFLICT(po_number) DO UPDATE SET
       closed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), closed_by = excluded.closed_by,
       note = excluded.note, reopened_at = NULL`,
  ).bind(poNumber, closedBy, note).run();
  return json({ ok: true, poNumber });
}

/** POST /api/po-closures/reopen — reverse a manual closure (keeps the row for audit).
 *  Body: { poNumber }. Sets reopened_at so the PO re-enters open calcs. Admin-gated. */
async function handleReopenClosure(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { poNumber?: string } | null;
  const poNumber = (body?.poNumber ?? "").trim();
  if (!poNumber) return json({ error: "poNumber required" }, 400);
  const r = await env.DB.prepare(
    `UPDATE po_manual_closures SET reopened_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE po_number = ? AND reopened_at IS NULL`,
  ).bind(poNumber).run();
  if ((r.meta.changes ?? 0) === 0) return json({ error: `No active closure for ${poNumber}` }, 404);
  return json({ ok: true, poNumber });
}

/** GET /api/po-closures — active manual closures with vendor + the exact Open
 *  Committed contribution each one removes (same S001 netting as openCommitted,
 *  scoped to the PO), plus its open-line count and age. */
async function handleListClosures(env: Env): Promise<Response> {
  const notAged = notAgedOutSql(await openPoMaxAgeDays(env), "p");
  const rows = await env.DB.prepare(
    `SELECT c.po_number, c.closed_at, c.closed_by, c.note,
            (SELECT v.vendor_code FROM po_lines p LEFT JOIN vendors v ON v.id = p.vendor_id
               WHERE p.po_number = c.po_number LIMIT 1) AS vendor_code,
            (SELECT v.name FROM po_lines p LEFT JOIN vendors v ON v.id = p.vendor_id
               WHERE p.po_number = c.po_number LIMIT 1) AS vendor,
            COALESCE((SELECT SUM(p.line_value_cents - COALESCE(p.received_value,0) * 100)
               FROM po_lines p WHERE p.po_number = c.po_number
                 AND COALESCE(p.sloc,'') != 'S002' AND ${notAged}), 0) AS excluded_cents,
            COALESCE((SELECT SUM(CASE WHEN p.is_fully_received = 0 THEN 1 ELSE 0 END)
               FROM po_lines p WHERE p.po_number = c.po_number
                 AND COALESCE(p.sloc,'') != 'S002' AND ${notAged}), 0) AS open_lines,
            (SELECT CAST(julianday('now') - julianday(MIN(p.order_date)) AS INTEGER)
               FROM po_lines p WHERE p.po_number = c.po_number) AS age_days
     FROM po_manual_closures c WHERE c.reopened_at IS NULL
     ORDER BY c.closed_at DESC`,
  ).all<{
    po_number: string; closed_at: string; closed_by: string | null; note: string | null;
    vendor_code: string | null; vendor: string | null; excluded_cents: number; open_lines: number; age_days: number | null;
  }>();
  return json({ closures: rows.results ?? [] });
}

/**
 * POST /api/statement-uploads — ingest a PnP account statement. One route,
 * both formats converge here:
 *   { csv: "<pipe-delimited text>" }  — native file, parsed in the Worker
 *   { header, lines, stats }          — browser-parsed PDF payload
 * Every header/line row is tagged source = NATIVE | PDF. Totals are re-verified
 * server-side regardless of source (never trust client sums). Replace-on-reload
 * with a PDF-over-NATIVE downgrade guard (pass ?force=1 to override).
 */
async function handleStatementUpload(req: Request, env: Env): Promise<Response> {
  let body: { csv?: string } & Partial<ParsedStatement>;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  let parsed: ParsedStatement;
  try {
    parsed = body.csv
      ? parseStatementCsv(body.csv)
      : (body as ParsedStatement);
  } catch (err) {
    // parse/integrity failure (bad field counts, balance/total mismatch, …)
    return json({ error: err instanceof Error ? err.message : String(err) }, 422);
  }

  // minimal shape guard on the pre-parsed (PDF) variant
  if (
    !parsed.header?.statement_no ||
    !Array.isArray(parsed.lines) ||
    parsed.lines.length === 0
  ) {
    return json({ error: "invalid statement payload" }, 400);
  }

  // server-side re-check regardless of source (never trust the client sums)
  const net = round2(parsed.lines.reduce((s, l) => s + l.amount, 0));
  const pay = round2(
    parsed.lines.filter((l) => l.doc_number.startsWith("1400")).reduce((s, l) => s + l.amount, 0),
  );
  if (Math.abs(round2(net - pay) - parsed.header.total_due) >= 0.005) {
    return json(
      { error: "server integrity check failed: total_due does not tie to lines" },
      422,
    );
  }

  const force = new URL(req.url).searchParams.get("force") === "1";
  let persisted: { replaced: boolean; previousSource: string | null };
  try {
    persisted = await persistStatement(env.DB, parsed.header, parsed.lines, { force });
  } catch (err) {
    // e.g. PDF-over-NATIVE downgrade refusal
    return json({ error: err instanceof Error ? err.message : String(err) }, 409);
  }

  // chain continuity (view added by migration 0017)
  const chain = await env.DB.prepare(
    "SELECT chain_status, chain_gap FROM v_statement_chain WHERE statement_no = ?",
  )
    .bind(parsed.header.statement_no)
    .first<{ chain_status: string; chain_gap: number | null }>();

  // Re-evaluate the settlement ledger (GR ↔ statement) — best-effort.
  try { await recomputeSettlement(env); } catch { /* ledger recompute is non-fatal */ }

  return json({
    statement_no: parsed.header.statement_no,
    rowCount: parsed.lines.length,
    source: parsed.header.source,
    total_due: parsed.header.total_due,
    closing_balance: parsed.header.closing_balance,
    replaced: persisted.replaced,
    previousSource: persisted.previousSource,
    chain: chain?.chain_status ?? "UNKNOWN",
    chain_gap: chain?.chain_gap ?? null,
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface StatementRow {
  statement_no: string;
  account: string;
  statement_date: string | null;
  period_start: string;
  cut_off: string;
  due_date: string;
  total_due: number;
  payment: number;
  opening_balance: number | null;
  closing_balance: number | null;
  source: string;
  line_count: number;
  debits: number;
  credits: number;
  // derived below:
  net: number;
  balance_source: "PRINTED" | "DERIVED" | "UNKNOWN";
}

function isoAddDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * GET /api/statements — weekly statement list with a DERIVED balance chain.
 *
 * Native statement CSVs carry no printed opening/closing balances, so only the
 * one PDF-anchored week (202717) has them. We reconstruct every other week's
 * balances from that anchor by walking the weekly chain: adjacent statements tie
 * closing(prev) == opening(next), and each week's net movement is
 *   net = total_due + payment   (debits + credits + payments == closing - opening)
 * so opening = closing - net (and closing = opening + net). Balances propagate
 * bidirectionally across CONTIGUOUS weeks (period_start(n) == cut_off(n-1)+1);
 * a missing week breaks the chain, leaving earlier weeks UNKNOWN. Printed values
 * are never overwritten — they stay the source of truth and seed the derivation.
 */
async function handleListStatements(env: Env): Promise<Response> {
  const res = await env.DB.prepare(
    `SELECT s.statement_no, s.account, s.statement_date, s.period_start, s.cut_off,
            s.due_date, s.total_due, s.payment, s.opening_balance, s.closing_balance, s.source,
            COUNT(l.id) AS line_count,
            ROUND(COALESCE(SUM(CASE WHEN l.amount > 0 THEN l.amount END), 0), 2) AS debits,
            ROUND(COALESCE(SUM(CASE WHEN l.amount < 0 AND l.doc_number NOT LIKE '1400%' THEN l.amount END), 0), 2) AS credits
       FROM statements s
       LEFT JOIN statement_lines l ON l.statement_no = s.statement_no
      GROUP BY s.statement_no
      ORDER BY s.cut_off ASC, s.statement_no ASC`,
  ).all<StatementRow>();

  const list = (res.results ?? []) as StatementRow[];
  for (const r of list) {
    r.net = round2(r.total_due + r.payment);
    // Seed from printed balances; fill the partner side from net if only one printed.
    if (r.opening_balance != null || r.closing_balance != null) {
      r.balance_source = "PRINTED";
      if (r.opening_balance != null && r.closing_balance == null) r.closing_balance = round2(r.opening_balance + r.net);
      if (r.closing_balance != null && r.opening_balance == null) r.opening_balance = round2(r.closing_balance - r.net);
    } else {
      r.balance_source = "UNKNOWN";
    }
  }

  const contig = (prev: StatementRow, cur: StatementRow) => cur.period_start === isoAddDays(prev.cut_off, 1);
  // Propagate from printed anchors both directions until the contiguous runs fill.
  for (let guard = 0; guard <= list.length; guard++) {
    let changed = false;
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!, cur = list[i]!;
      if (contig(prev, cur) && prev.closing_balance != null && cur.opening_balance == null) {
        cur.opening_balance = prev.closing_balance;
        cur.closing_balance = round2(cur.opening_balance + cur.net);
        cur.balance_source = "DERIVED";
        changed = true;
      }
    }
    for (let i = list.length - 2; i >= 0; i--) {
      const cur = list[i]!, next = list[i + 1]!;
      if (contig(cur, next) && next.opening_balance != null && cur.closing_balance == null) {
        cur.closing_balance = next.opening_balance;
        cur.opening_balance = round2(cur.closing_balance - cur.net);
        cur.balance_source = "DERIVED";
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Newest first for display.
  list.reverse();
  return json({ statements: list });
}

// --- router --------------------------------------------------------------

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const m = req.method;

    const res: Response = await (async (): Promise<Response> => {
    try {
      if ((path === "/" || path === "/app") && m === "GET") {
        return new Response(APP_HTML, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate" },
        });
      }
      if (path === "/classic" && m === "GET") {
        return new Response(DASHBOARD_HTML, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate" },
        });
      }
      if (path === "/upload" && m === "GET") {
        return new Response(UPLOAD_HTML, {
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache, no-store, must-revalidate" },
        });
      }
      // Browser-side statement PDF parser, served as an importable ES module
      // (the app has no static-asset pipeline). Lazily imported by the
      // statements screen only when a PDF is chosen.
      if (path === "/js/statement-pdf.js" && m === "GET") {
        return new Response(STATEMENT_PDF_JS, {
          headers: {
            "content-type": "text/javascript; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      }
      if (path === "/manifest.webmanifest" && m === "GET") {
        const manifest = {
          name: "PO Monitor — PnP Lydenburg",
          short_name: "PO Monitor",
          description: "SAP purchase-order & goods-receipt monitoring for Pick n Pay Lydenburg (store 2516).",
          theme_color: "#0B3D6B",
          background_color: "#0B3D6B",
          display: "standalone",
          start_url: "/",
          scope: "/",
          orientation: "portrait-primary",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
            { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
            { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
          ],
        };
        return new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/manifest+json; charset=utf-8" },
        });
      }
      // App icons: navy rounded square with white "PO". SVG (no binary assets needed).
      const iconMatch = path.match(/^\/icon-(192|512)\.svg$/);
      if (iconMatch && m === "GET") {
        const sz = Number(iconMatch[1]);
        const fontSize = sz === 512 ? 200 : 80;
        const rx = Math.round(sz * 0.125); // 24 @192, 64 @512
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}">` +
          `<rect width="${sz}" height="${sz}" rx="${rx}" fill="#0B3D6B"/>` +
          `<text x="50%" y="50%" dy=".02em" fill="#ffffff" font-family="Segoe UI,Helvetica,Arial,sans-serif" ` +
          `font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="central">PO</text>` +
          `</svg>`;
        return new Response(svg, {
          headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=86400" },
        });
      }
      // Real PNG icons (build-time rasterized, base64-embedded) — needed because iOS
      // home-screen apple-touch-icon ignores SVG. Decoded from base64 at request time.
      const pngMatch = path.match(/^\/icon-(192|512)\.png$/);
      if (pngMatch && m === "GET") {
        const b64 = pngMatch[1] === "512" ? ICON_512_PNG_B64 : ICON_192_PNG_B64;
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Response(bytes, {
          headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" },
        });
      }
      if (path === "/api" && m === "GET") {
        return json({
          service: "pnp-po-monitor",
          store: STORE,
          endpoints: [
            "GET  /                     (HTML dashboard)",
            "GET  /api/dashboard",
            "POST /api/uploads          (multipart 'file' or raw SAP PO text body)",
            "GET  /api/uploads",
            "GET  /api/uploads/:id",
            "POST /api/gr-uploads       (goods-receipt file)",
            "POST /api/statement-uploads (statement CSV {csv} or browser-parsed PDF {header,lines}; ?force=1 to override downgrade guard)",
            "GET  /api/statements       (statement header list + line counts + chain status)",
            "GET  /api/gr-lines?uploadId=&dept=&po=&limit=",
            "POST /api/fim-uploads      (FIM xlsx, filename FIM_YYYY-MM-DD.xlsx)",
            "DELETE /api/uploads/:id    (delete upload + its data + R2 file)",
            "POST /api/uploads/bulk-delete ({ids:[...]})",
            "POST /api/uploads/reset    ({confirm:'RESET'} — wipe all data)",
            "GET  /api/guidelines",
            "PUT  /api/guidelines/:dept ({guideline_margin_pct, effective_from})",
            "GET  /api/guidelines/:dept/history",
            "GET  /api/fim/summary?from=&to=&dept=&fy=&quarter=&week=",
            "GET  /api/fim/departments",
            "GET  /api/fim/trend?dept=",
            "GET  /api/po-lines?uploadId=&status=&vendor=&limit=",
            "GET  /api/po-lines/:poNumber  (all lines + summary for one PO)",
            "GET  /api/reconciliation?from=&to=&vendor=&dept=&status=  (PO<->GR reconciliation)",
            "GET  /api/anomalies?type=&severity=&resolved=&limit=",
            "GET  /api/budget",
            "POST /api/budgets          ({period, scopeType, scopeRef, capRands})",
          ],
        });
      }
      // NOTE: every async handler is `await`-ed. Returning a handler's promise
      // without awaiting it inside this try/catch lets a rejection escape to the
      // runtime (Cloudflare's raw error page) instead of our JSON catch below.
      if (path === "/api/dashboard" && m === "GET") return await handleDashboard(env);
      if (path === "/api/dashboard/tiles" && m === "GET") return await handleDashboardTiles(req, env);
      if (path === "/api/dashboard/cashflow" && m === "GET") return await handleDashboardCashflow(req, env);
      if (path === "/api/waste" && m === "GET") return await handleWaste(req, env);
      if (path === "/api/waste/dept/articles" && m === "GET") return await handleWasteDeptArticles(req, env);
      if (path === "/api/waste/dept" && m === "GET") return await handleWasteDept(req, env);
      if (path === "/api/weekly-budgets" && m === "GET") return await handleGetWeeklyBudgets(env);
      if (path === "/api/weekly-budgets" && m === "POST") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handlePostWeeklyBudget(req, env);
      }
      if (path === "/api/budgets/summary" && m === "GET") return await handleBudgetsSummary(env);
      if (path === "/api/budgets/suggest" && m === "GET") return await handleBudgetsSuggest(req, env);
      if (path === "/api/budgets/generate-ly" && m === "GET") return await handleBudgetsGenerateLy(req, env);
      if (path === "/api/cash-flow-flags" && m === "GET") return await handleCashFlowFlags(req, env);
      if (path === "/api/creditor-payments" && m === "GET") return await handleCreditorPayments(req, env);
      if (path === "/api/trading" && m === "GET") return await handleTrading(req, env);
      const wbDelete = path.match(/^\/api\/weekly-budgets\/([^/]+)$/);
      if (wbDelete && m === "DELETE") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handleDeleteWeeklyBudget(env, decodeURIComponent(wbDelete[1]!));
      }
      if (path === "/api/uploads" && m === "POST") return await handleUpload(req, env);
      if (path === "/api/uploads" && m === "GET") return await handleListUploads(env);
      if (path === "/api/gr-uploads" && m === "POST") return await handleGrUpload(req, env);
      if (path === "/api/eod-uploads" && m === "POST") return await handleEodUpload(req, env);
      if (path === "/api/statement-uploads" && m === "POST") return await handleStatementUpload(req, env);
      if (path === "/api/settlement" && m === "GET") return await handleSettlement(req, env);
      if (path === "/api/settlement/liv" && m === "GET") return await handleSettlementLiv(req, env);
      if (path === "/api/statements" && m === "GET") return await handleListStatements(env);
      if (path === "/api/statements/dashboard" && m === "GET") return await handleStatementDashboard(env);
      if (path === "/api/statements/lines" && m === "GET") return await handleStatementBrowse(req, env);
      if (path === "/api/feed-coverage" && m === "GET") return await handleFeedCoverage(req, env);
      if (path === "/api/brief" && m === "GET") return await handleWeeklyBrief(req, env);
      if (path === "/api/otb" && m === "GET") return await handleOtb(req, env);
      if (path === "/api/dept-league" && m === "GET") return await handleDeptLeague(req, env);
      if (path === "/api/dept-dossier" && m === "GET") return await handleDeptDossier(req, env);
      if (path === "/api/gpbridge" && m === "GET") return await handleGpBridge(req, env);
      if (path === "/api/reconcile/recompute" && m === "POST") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        await recomputeReceipts(env);
        const staleAnomalies = await recomputeStaleAnomalies(env);
        // Price-spike pass (fast-path uploads never advance the price baseline).
        const priceSpikes = await recomputePriceSpikes(env);
        // Re-evaluate the current-week PO budget (fast-path uploads skip this).
        const budget = await evaluateBudgets(env, 0);
        try {
          await insertAnomalies(env, null, budget.anomalies);
        } catch {
          /* budget anomaly write is best-effort; rollups already committed */
        }
        const otbExceeded = await recomputeOtbAnomalies(env);
        return json({ status: "ok", recomputed: true, staleAnomalies, priceSpikes, otbExceeded, budget: budget.evaluations });
      }
      if (path === "/api/anomalies/recompute" && m === "POST") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        const staleAnomalies = await recomputeStaleAnomalies(env);
        const priceSpikes = await recomputePriceSpikes(env);
        const otbExceeded = await recomputeOtbAnomalies(env);
        return json({ status: "ok", staleAnomalies, priceSpikes, otbExceeded });
      }
      // Backfill fim_articles from the archived FIM files (article waste isn't
      // stored by older uploads). Paginated to stay under the Worker CPU/time
      // limit: call repeatedly with ?offset += limit until done=true.
      if (path === "/api/fim/backfill-articles" && m === "POST") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        const bq = new URL(req.url).searchParams;
        const limit = Math.max(1, Math.min(Number(bq.get("limit") ?? "10") || 10, 25));
        const offset = Math.max(0, Number(bq.get("offset") ?? "0") || 0);
        // Only daily FIM files feed article-level waste (see the parser's
        // captureArticles gate), so skip weekly/monthly uploads entirely.
        const ups =
          (
            await env.DB.prepare(
              `SELECT id, r2_key, filename FROM uploads
               WHERE kind='fim' AND status='parsed' AND report_date = report_date_to
               ORDER BY id LIMIT ? OFFSET ?`,
            )
              .bind(limit, offset)
              .all<{ id: number; r2_key: string; filename: string }>()
          ).results ?? [];
        let filesProcessed = 0;
        let articlesStored = 0;
        const errors: { id: number; error: string }[] = [];
        for (const u of ups) {
          try {
            const obj = await env.UPLOADS_BUCKET.get(u.r2_key);
            if (!obj) {
              errors.push({ id: u.id, error: "R2 object missing" });
              continue;
            }
            const parsed = parseFimFile(await obj.arrayBuffer(), u.filename);
            let articleRows = parsed.articles;
            if (parsed.isCpFormat && articleRows.length) {
              const cpMap = await cpToDeptMap(env);
              articleRows = articleRows.map((a) => ({ ...a, deptCode: cpMap.get(a.deptCode)?.deptCode ?? a.deptCode }));
            }
            articlesStored += await insertFimArticles(
              env,
              u.id,
              { reportDate: parsed.reportDate || parsed.dateFrom, dateFrom: parsed.dateFrom, dateTo: parsed.dateTo, reportType: parsed.reportType },
              articleRows,
            );
            filesProcessed++;
          } catch (e) {
            errors.push({ id: u.id, error: e instanceof Error ? e.message : String(e) });
          }
        }
        return json({ status: "ok", limit, offset, filesSeen: ups.length, filesProcessed, articlesStored, nextOffset: offset + ups.length, done: ups.length < limit, errors });
      }
      if (path === "/api/gr-lines" && m === "GET") return await handleListGrLines(req, env);
      if (path === "/api/fim-uploads" && m === "POST") return await handleFimUpload(req, env);
      if (path === "/api/customer-uploads" && m === "POST") return await handleCcUpload(req, env);
      if (path === "/api/customer-counts/summary" && m === "GET")
        return await handleCustomerCountSummary(env);
      if (path === "/api/customer-counts/daily" && m === "GET")
        return await handleCustomerCountDaily(req, env);
      if (path === "/api/fan-score-uploads" && m === "POST") return await handleFanScoreUpload(req, env);
      if (path === "/api/fan-score/summary" && m === "GET") return await handleFanScoreSummary(req, env);
      if (path === "/api/fan-score/history" && m === "GET") return await handleFanScoreHistory(req, env);
      if (path === "/api/fan-score/responses" && m === "GET") return await handleFanScoreResponses(req, env);

      if (path === "/api/uploads/reset" && m === "POST") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handleResetUploads(req, env);
      }
      if (path === "/api/uploads/bulk-delete" && m === "POST") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handleBulkDeleteUploads(req, env);
      }
      const uploadDetail = path.match(/^\/api\/uploads\/(\d+)$/);
      if (uploadDetail && m === "GET") return await handleUploadDetail(env, Number(uploadDetail[1]));
      if (uploadDetail && m === "DELETE") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handleDeleteUpload(env, Number(uploadDetail[1]));
      }

      // guidelines
      if (path === "/api/guidelines" && m === "GET") return await handleListGuidelines(env);
      const guidelineHist = path.match(/^\/api\/guidelines\/([A-Za-z0-9]+)\/history$/);
      if (guidelineHist && m === "GET") return await handleGuidelineHistory(env, guidelineHist[1]!);
      const guideline = path.match(/^\/api\/guidelines\/([A-Za-z0-9]+)$/);
      if (guideline && m === "PUT") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handleUpdateGuideline(req, env, guideline[1]!);
      }

      // FIM queries
      if (path === "/api/fim/ima" && m === "GET") return await handleFimIma(req, env);
      if (path === "/api/fim/summary" && m === "GET") return await handleFimSummary(req, env);
      if (path === "/api/fim/departments" && m === "GET") return await handleFimDepartments(env);
      if (path === "/api/fim/trend" && m === "GET") return await handleFimTrend(req, env);
      if (path === "/api/fim/period" && m === "GET") return await handleFimPeriod(req, env);
      if (path === "/api/fim/by-period" && m === "GET") return await handleFimByPeriod(env);
      if (path === "/api/fiscal/week" && m === "GET") return await handleFiscalWeek(req, env);
      if (path === "/api/gr/period" && m === "GET") return await handleGrPeriod(req, env);
      if (path === "/api/meta/range" && m === "GET") return await handleMetaRange(env);
      if (path === "/api/periods" && m === "GET") return await handlePeriods(env);

      // merchandise hierarchy
      if (path === "/api/hierarchy" && m === "GET") return await handleHierarchy(env);
      if (path === "/api/hierarchy/performance" && m === "GET") return await handleHierarchyPerformance(req, env);
      if (path === "/api/hierarchy/upload" && m === "POST") return await handleHierarchyUpload(req, env);
      const hierDept = path.match(/^\/api\/hierarchy\/dept\/([A-Za-z0-9]+)$/);
      if (hierDept && m === "GET") return await handleHierarchyDept(env, hierDept[1]!);

      // analytics (SPA data layer)
      if (path === "/api/purchases/summary" && m === "GET") return await handlePurchasesSummary(req, env);
      if (path === "/api/vendors" && m === "GET") return await handleVendors(req, env);
      const vendorDetail = path.match(/^\/api\/vendors\/([^/]+)$/);
      if (vendorDetail && m === "GET") return await handleVendorDetail(env, decodeURIComponent(vendorDetail[1]!));
      if (path === "/api/articles" && m === "GET") return await handleArticles(req, env);
      const articleDetail = path.match(/^\/api\/articles\/([^/]+)$/);
      if (articleDetail && m === "GET") return await handleArticleDetail(env, decodeURIComponent(articleDetail[1]!));
      if (path === "/api/categories" && m === "GET") return await handleCategories(req, env);
      const categoryDetail = path.match(/^\/api\/categories\/([^/]+)$/);
      if (categoryDetail && m === "GET") return await handleCategoryDetail(env, decodeURIComponent(categoryDetail[1]!));
      if (path === "/api/departments-po" && m === "GET") return await handleDepartmentsPo(req, env);
      if (path === "/api/open-orders" && m === "GET") return await handleOpenOrders(req, env);
      if (path === "/api/po-closures" && m === "GET") return await handleListClosures(env);
      if (path === "/api/po-closures" && m === "POST") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handleMarkStale(req, env);
      }
      if (path === "/api/po-closures/reopen" && m === "POST") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handleReopenClosure(req, env);
      }
      if (path === "/api/returns" && m === "GET") return await handleReturns(req, env);
      if (path === "/api/gr/reconciliation" && m === "GET") return await handleGrReconciliation(env);
      if (path === "/api/reconciliation" && m === "GET") return await handleReconciliation(req, env);
      if (path === "/api/settings" && m === "GET") return await handleGetSettings(env);
      if (path === "/api/settings" && m === "PUT") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handlePutSettings(req, env);
      }
      if (path === "/api/creditors" && m === "GET") return await handleGetCreditors(env);
      if (path === "/api/creditors" && m === "POST") {
        if (!adminAuthorized(req, env)) return json({ error: "Unauthorized" }, 401);
        return await handlePostCreditor(req, env);
      }
      const ackAnomaly = path.match(/^\/api\/anomalies\/(\d+)\/ack$/);
      if (ackAnomaly && m === "POST") {
        const body = (await req.json().catch(() => ({}))) as { resolved?: boolean };
        return await handleAckAnomaly(env, Number(ackAnomaly[1]), body.resolved !== false);
      }
      const reportMatch = path.match(/^\/api\/reports\/([a-z-]+)\.xlsx$/);
      if (reportMatch && m === "GET") return await handleReport(req, env, reportMatch[1]!);

      if (path === "/api/po-lines" && m === "GET") return await handleListPoLines(req, env);
      if (path === "/api/po-lines/list" && m === "GET") return await handlePoLinesList(req, env);
      const poLinesByNumber = path.match(/^\/api\/po-lines\/([^/]+)$/);
      if (poLinesByNumber && m === "GET")
        return await handlePoLinesByNumber(env, decodeURIComponent(poLinesByNumber[1]!));
      if (path === "/api/anomalies" && m === "GET") return await handleListAnomalies(req, env);
      if (path === "/api/anomalies/scoped" && m === "GET") return await handleScopedAnomalies(req, env);
      if (path === "/api/weekly/day-blocks" && m === "GET") return await handleWeeklyDayBlocks(req, env);
      if (path === "/api/budget" && m === "GET") return await handleBudgetStatus(env);
      if (path === "/api/budgets" && m === "POST") return await handleCreateBudget(req, env);

      return json({ error: "Not found", path }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorName = err instanceof Error ? err.name : "Error";
      const stack = err instanceof Error ? err.stack : undefined;
      return json(
        { status: "error", error: message || "Unhandled error", errorName, where: path, stack },
        500,
      );
    }
    })();
    // Data/API endpoints are per-request D1 queries — never let the Cloudflare edge or
    // the browser serve them stale after an upload. Static HTML/JS/img above set their
    // own cache-control and are unaffected. no-store also stops any heuristic caching.
    if (path.startsWith("/api/")) res.headers.set("cache-control", "no-store");
    return res;
  },
} satisfies ExportedHandler<Env>;

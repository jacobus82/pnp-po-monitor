import * as XLSX from "xlsx";
import type { FimParseResult, FimReportType, ParsedFimArticle, ParsedFimRow } from "../types";
import { detectDelimiter, parseFilenamePeriod, parseSapNumber, round2, splitLine } from "./core";

/**
 * FIM (Financial Information Management) spreadsheet parser.
 *
 * A FIM export is a single-day, single-store .xlsx where each row is a
 * merchandise node. We keep only DEPARTMENT-level rows — column 0 holds a short
 * department code such as F09, G12, P11, GM, CLO, MOB — and skip the article
 * rows beneath them (column 0 is a 6+ digit article number). The sheet's
 * "Overall Result" line is captured separately as the store total.
 *
 * Column positions are fixed by the export layout (0-indexed):
 *   0  dept_code              37 operating_margin_pct
 *   1  dept_name              49 shrink_zar
 *   4  net_sales_zar          50 waste_zar
 *   6  total_cos_zar          57 store_margin_pct
 *   17 pos_margin_pct         60 total_purchases_zar
 *                             61 net_gr_cost_zar
 */

const COL = {
  deptCode: 0,
  deptName: 1,
  netSales: 4,
  totalCos: 6,
  posMargin: 17,
  operatingMargin: 37,
  shrink: 49,
  waste: 50,
  storeMargin: 57,
  totalPurchases: 60,
  netGrCost: 61,
  openingSoh: 58,
  closingSoh: 59,
  commercialDisc: 18,
  lineDisc: 19,
  basketDisc: 22,
  tradeInvest: 25,
  salliesTallies: 26,
  swellAllowance: 38,
  totalShortages: 43,
  netShrinkage: 46,
  rtc: 55,
} as const;

/** Department short codes look like F09, G12, P11, GM, CLO, MOB. */
const DEPT_CODE_RE = /^[A-Z]{1,4}\d{0,3}$/;
/** Article rows carry a long numeric code. */
const ARTICLE_CODE_RE = /^\d{6,}$/;
/** Category Portfolio (CP / "going-forward") rows carry a 5-digit code. */
const CP_CODE_RE = /^\d{5}$/;

/** Detect the CP daily format: header col 0 names the Category Portfolio, or
 *  many data rows have a 5-digit col-0 code. */
function detectCpFormat(grid: unknown[][]): boolean {
  let cp = 0;
  for (const cells of grid.slice(0, 40)) {
    if (!Array.isArray(cells)) continue;
    const c0 = cellText(cells[COL.deptCode]);
    if (c0 && /category portfolio/i.test(c0)) return true;
    if (c0 && CP_CODE_RE.test(c0.replace(/\s+/g, ""))) cp++;
  }
  return cp >= 3;
}

/**
 * Extract the period + grain from a FIM filename. Accepts any SAP-default export
 * name (see parseFilenamePeriod): a single date → daily, or a range →
 * weekly/monthly based on the span. No renaming required.
 */
export function fimDateRangeFromFilename(
  filename: string,
): { from: string; to: string; reportType: FimReportType } | undefined {
  const p = parseFilenamePeriod(filename);
  if (!p) return undefined;
  let reportType: FimReportType = "daily";
  if (p.from !== p.to) {
    const span = (Date.parse(p.to + "T00:00:00Z") - Date.parse(p.from + "T00:00:00Z")) / 86_400_000;
    reportType = span <= 13 ? "weekly" : "monthly";
  }
  return { from: p.from, to: p.to, reportType };
}

/** Read a single cell that may already be a JS number or a SAP-formatted string. */
function cellNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  return parseSapNumber(String(v));
}

function cellText(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

/**
 * Roll CP-keyed FIM rows up to SAP departments. Additive figures are summed and
 * margin% is recomputed from the summed sales/cos (never averaged). CPs not in
 * the hierarchy keep their CP number as the department code so nothing is lost.
 */
/** Additive Rand fields summed across CPs when rolling up to a department. */
const FIM_ADDITIVE: (keyof ParsedFimRow)[] = [
  "netSalesZar", "totalCosZar", "shrinkZar", "wasteZar", "totalPurchasesZar", "netGrCostZar",
  "openingSohZar", "closingSohZar", "commercialDiscZar", "lineDiscZar", "basketDiscZar",
  "tradeInvestZar", "salliesTalliesZar", "swellAllowanceZar", "totalShortagesZar", "netShrinkageZar", "rtcZar",
];

export function aggregateCpToDept(
  cpRows: ParsedFimRow[],
  cpMap: Map<string, { deptCode: string; deptName: string }>,
): ParsedFimRow[] {
  const byDept = new Map<string, ParsedFimRow>();
  for (const r of cpRows) {
    const m = cpMap.get(r.deptCode);
    const deptCode = m?.deptCode ?? r.deptCode;
    const deptName = m?.deptName ?? r.deptName;
    let agg = byDept.get(deptCode);
    if (!agg) {
      agg = { deptCode, deptName, raw: {} };
      const ai = agg as unknown as Record<string, number>;
      for (const k of FIM_ADDITIVE) ai[k] = 0;
      byDept.set(deptCode, agg);
    }
    const ai = agg as unknown as Record<string, number>;
    for (const k of FIM_ADDITIVE) ai[k] = (ai[k] ?? 0) + ((r[k] as number) ?? 0);
  }
  for (const a of byDept.values()) {
    const ai = a as unknown as Record<string, number | undefined>;
    for (const k of FIM_ADDITIVE) ai[k] = round2(ai[k]);
    if (a.netSalesZar && a.netSalesZar !== 0) {
      a.posMarginPct = round2(((a.netSalesZar - (a.totalCosZar ?? 0)) / a.netSalesZar) * 100);
    }
  }
  // Drop departments with no activity (zero-activity CPs contribute nothing).
  return [...byDept.values()].filter(
    (a) => (a.netSalesZar ?? 0) !== 0 || (a.totalCosZar ?? 0) !== 0 || (a.shrinkZar ?? 0) !== 0 || (a.wasteZar ?? 0) !== 0,
  );
}

/** xlsx files are ZIP archives — they start with the "PK" magic bytes. */
function looksLikeXlsx(bytes: ArrayBuffer): boolean {
  const u8 = new Uint8Array(bytes);
  return u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b;
}

function xlsxToGrid(bytes: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
}

/**
 * CSV FIM export → grid of string cells. UTF-8 (BOM tolerated); delimiter
 * auto-detected; comma fields are quote-aware. Cell unit suffixes / thousands
 * separators (e.g. "14,159,522 ZAR") are normalized later by parseSapNumber.
 */
function csvToGrid(bytes: ArrayBuffer, captureArticles: boolean): { grid: string[][]; articleCount: number } {
  return csvTextToGrid(new TextDecoder("utf-8").decode(bytes), captureArticles);
}

/** Build the FIM grid from already-decoded CSV text (the memory-lean path: the
 *  caller holds only the string, never the binary buffer + a decoded copy).
 *  When `captureArticles` is true, article rows carrying waste/shrink are kept in
 *  the grid (for the drill-down); otherwise every article row is cheaply skipped
 *  (col-0 peek only — the original memory/CPU-lean behaviour, used for large
 *  weekly/monthly files that would otherwise blow the Free-plan limits). */
function csvTextToGrid(textIn: string, captureArticles: boolean): { grid: string[][]; articleCount: number } {
  let text = textIn;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { grid: [], articleCount: 0 };
  const detected = detectDelimiter(lines) ?? { name: "comma" as const, char: "," };
  const ch = detected.char;
  // Skip the ~15k article rows up front: peek at column 0 (a code field is never
  // quoted) and drop 6+ digit article lines WITHOUT the expensive quote-aware
  // full-column split. This keeps the grid at ~tens of rows so a large FIM CSV
  // stays well under the Worker CPU/memory limits (the cause of the 503s).
  const grid: string[][] = [];
  let articleCount = 0;
  for (const l of lines) {
    const end = l.indexOf(ch);
    const c0 = (end < 0 ? l : l.slice(0, end)).replace(/^"|"$/g, "").trim().toUpperCase().replace(/\s+/g, "");
    if (ARTICLE_CODE_RE.test(c0)) {
      // Article row. For daily files, split it to read waste/shrink and KEEP it in
      // the grid only if it carries waste/shrink (for the drill-down); the main
      // loop extracts and counts those. Otherwise (large weekly/monthly files),
      // skip cheaply — just count — to stay under the Free-plan CPU/memory limits.
      if (captureArticles) {
        const cells = splitLine(l, ch).map((c) => c.replace(/^"|"$/g, ""));
        if ((cellNumber(cells[COL.waste]) ?? 0) !== 0 || (cellNumber(cells[COL.shrink]) ?? 0) !== 0) {
          grid.push(cells);
          continue;
        }
      }
      articleCount++;
      continue;
    }
    grid.push(splitLine(l, ch).map((c) => c.replace(/^"|"$/g, "")));
  }
  return { grid, articleCount };
}

export function parseFimFile(input: ArrayBuffer | string, filename: string): FimParseResult {
  const warnings: string[] = [];
  const range = fimDateRangeFromFilename(filename);
  if (!range) {
    return {
      reportDate: "",
      dateFrom: "",
      dateTo: "",
      reportType: "daily",
      isCpFormat: false,
      rows: [],
      articles: [],
      articleCount: 0,
      skippedRows: 0,
      warnings: [
        `Could not find a date in the filename "${filename}". Any SAP default name with a date works ` +
          `(e.g. "… Equiv Date 01.11.2025 - 15.11.2025.xlsx", "…_12_06_2026_-_12_06_2026.xlsx", or FIM_YYYY-MM-DD.xlsx).`,
      ],
    };
  }
  const reportDate = range.from;
  const meta = { reportDate, dateFrom: range.from, dateTo: range.to, reportType: range.reportType, isCpFormat: false };

  // Only daily files feed the article-level waste drill-down. Weekly/monthly
  // aggregates carry thousands of waste articles — parsing+storing them all blows
  // the Free-plan CPU/memory limit, and daily is the authoritative grain anyway
  // (mirrors the waste resolver), so mixing granularities would double-count.
  const captureArticles = range.reportType === "daily";

  let grid: unknown[][];
  let preArticleCount = 0; // article rows skipped before full parse (CSV fast-path)
  try {
    if (typeof input === "string") {
      // CSV text supplied directly (memory-lean path, no binary buffer held).
      const r = csvTextToGrid(input, captureArticles);
      grid = r.grid;
      preArticleCount = r.articleCount;
    } else if (looksLikeXlsx(input)) {
      grid = xlsxToGrid(input);
    } else {
      const r = csvToGrid(input, captureArticles);
      grid = r.grid;
      preArticleCount = r.articleCount;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...meta, rows: [], articles: [], articleCount: 0, skippedRows: 0, warnings: [`Failed to read FIM file: ${message}`] };
  }
  if (grid.length === 0) {
    return { ...meta, rows: [], articles: [], articleCount: 0, skippedRows: 0, warnings: ["File had no rows."] };
  }

  const isCp = detectCpFormat(grid);
  meta.isCpFormat = isCp;

  const rows: ParsedFimRow[] = [];
  const articles: ParsedFimArticle[] = [];
  let total: ParsedFimRow | undefined;
  let skipped = 0;
  let articleCount = preArticleCount; // include CSV fast-path (zero-waste) skips
  let curDept = ""; // parent dept/CP code for the article rows that follow it

  for (const cells of grid) {
    if (!Array.isArray(cells)) continue;
    const rawCode = cellText(cells[COL.deptCode]);
    const rawName = cellText(cells[COL.deptName]);

    // "Overall Result" total line — may sit under a blank/total code cell.
    const isTotal = /overall result/i.test(rawCode ?? "") || /overall result/i.test(rawName ?? "");

    if (!isTotal) {
      if (!rawCode) {
        skipped++;
        continue;
      }
      const code = rawCode.toUpperCase().replace(/\s+/g, "");
      if (ARTICLE_CODE_RE.test(code)) {
        // Article row: count it, and (daily files only) capture it tagged with its
        // parent dept/CP when it carries waste/shrink — the waste drill-down subset.
        articleCount++;
        if (captureArticles && curDept) {
          const wasteZar = round2(cellNumber(cells[COL.waste]));
          const shrinkZar = round2(cellNumber(cells[COL.shrink]));
          if ((wasteZar ?? 0) !== 0 || (shrinkZar ?? 0) !== 0) {
            articles.push({
              code,
              desc: rawName ?? undefined,
              deptCode: curDept,
              netSalesZar: round2(cellNumber(cells[COL.netSales])),
              shrinkZar,
              wasteZar,
              rtcZar: round2(cellNumber(cells[COL.rtc])),
            });
          }
        }
        continue;
      }
      if (isCp) {
        // CP format: keep 5-digit Category Portfolio rows; skip everything else.
        if (!CP_CODE_RE.test(code)) {
          skipped++;
          continue;
        }
      } else if (!DEPT_CODE_RE.test(code)) {
        // Dept format: skip anything that is not a dept code.
        skipped++;
        continue;
      }
    }

    const row: ParsedFimRow = {
      deptCode: isTotal ? "TOTAL" : rawCode!.toUpperCase().replace(/\s+/g, ""),
      deptName: isTotal ? "Overall Result" : rawName,
      netSalesZar: round2(cellNumber(cells[COL.netSales])),
      totalCosZar: round2(cellNumber(cells[COL.totalCos])),
      posMarginPct: round2(cellNumber(cells[COL.posMargin])),
      operatingMarginPct: round2(cellNumber(cells[COL.operatingMargin])),
      shrinkZar: round2(cellNumber(cells[COL.shrink])),
      wasteZar: round2(cellNumber(cells[COL.waste])),
      storeMarginPct: round2(cellNumber(cells[COL.storeMargin])),
      totalPurchasesZar: round2(cellNumber(cells[COL.totalPurchases])),
      netGrCostZar: round2(cellNumber(cells[COL.netGrCost])),
      openingSohZar: round2(cellNumber(cells[COL.openingSoh])),
      closingSohZar: round2(cellNumber(cells[COL.closingSoh])),
      commercialDiscZar: round2(cellNumber(cells[COL.commercialDisc])),
      lineDiscZar: round2(cellNumber(cells[COL.lineDisc])),
      basketDiscZar: round2(cellNumber(cells[COL.basketDisc])),
      tradeInvestZar: round2(cellNumber(cells[COL.tradeInvest])),
      salliesTalliesZar: round2(cellNumber(cells[COL.salliesTallies])),
      swellAllowanceZar: round2(cellNumber(cells[COL.swellAllowance])),
      totalShortagesZar: round2(cellNumber(cells[COL.totalShortages])),
      netShrinkageZar: round2(cellNumber(cells[COL.netShrinkage])),
      rtcZar: round2(cellNumber(cells[COL.rtc])),
      raw: {},
    };

    // A header row can satisfy the dept-code regex (e.g. "Dept") but carries no
    // numbers. For dept format, drop those. CP rows are kept even at zero
    // activity so the parsed count matches the file (zeros add nothing on rollup).
    const hasNumbers =
      row.netSalesZar != null || row.totalCosZar != null || row.posMarginPct != null;
    if (!isTotal && !isCp && !hasNumbers) {
      skipped++;
      continue;
    }

    if (isTotal) total = row;
    else {
      rows.push(row);
      curDept = row.deptCode; // articles that follow belong to this dept/CP
    }
  }

  // Normalize percentage columns: if the source stored margins as fractions
  // (0.1879 rather than 18.79), scale them to whole-number percent.
  normalizePercentScale(rows, total);

  if (rows.length === 0) {
    warnings.push("No department-level rows found. Check the FIM layout / column positions.");
  }
  if (!total) {
    warnings.push("No 'Overall Result' total row found; participation checks will be skipped.");
  }

  return { ...meta, rows, total, articles, articleCount, skippedRows: skipped, warnings };
}

/**
 * Some exports store percentages as 0–1 fractions. If every margin we saw is
 * within [-1.5, 1.5], multiply the percentage columns by 100 so downstream
 * comparisons against whole-number guidelines (e.g. 18.79) are apples-to-apples.
 */
function normalizePercentScale(rows: ParsedFimRow[], total?: ParsedFimRow): void {
  const all = total ? [...rows, total] : rows;
  const margins = all
    .flatMap((r) => [r.posMarginPct, r.operatingMarginPct, r.storeMarginPct])
    .filter((v): v is number => v != null && v !== 0);
  if (margins.length === 0) return;
  const maxAbs = Math.max(...margins.map((v) => Math.abs(v)));
  if (maxAbs > 1.5) return; // already whole-number percent

  for (const r of all) {
    if (r.posMarginPct != null) r.posMarginPct = round2(r.posMarginPct * 100);
    if (r.operatingMarginPct != null) r.operatingMarginPct = round2(r.operatingMarginPct * 100);
    if (r.storeMarginPct != null) r.storeMarginPct = round2(r.storeMarginPct * 100);
  }
}

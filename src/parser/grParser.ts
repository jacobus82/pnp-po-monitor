import * as XLSX from "xlsx";
import type { GrParseResult, ParsedGrLine } from "../types";
import { canonicalDeptCode, resolveDeptName } from "../departments";
import {
  columnReader,
  detectDelimiter,
  mapHeaders,
  parseFilenamePeriod,
  parseSapDate,
  parseSapNumber,
  round2,
  splitLine,
} from "./core";

/**
 * GR entry point. Real GR exports are a SAP crosstab/pivot (departments across
 * columns, PO→article rows down the side); the simple sample export is flat.
 * We sniff xlsx vs text, build a grid, and unpivot the crosstab — falling back
 * to the flat parser otherwise. The receipt date comes from the filename.
 */
export function parseGrFile(bytes: ArrayBuffer, filename: string): GrParseResult {
  const grDate = parseFilenamePeriod(filename)?.from;
  if (looksLikeXlsx(bytes)) {
    const grid = xlsxToGrid(bytes);
    if (isGrCrosstab(grid)) return parseGrCrosstab(grid, grDate);
    return { lines: [], delimiter: "unknown", headerMap: {}, totalRows: grid.length, skippedRows: grid.length, warnings: ["xlsx GR file is not in the expected crosstab layout."] };
  }
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
  const grid = textToGrid(text);
  if (isGrCrosstab(grid)) return parseGrCrosstab(grid, grDate);
  return parseGrFlat(text, grDate);
}

function looksLikeXlsx(bytes: ArrayBuffer): boolean {
  const u8 = new Uint8Array(bytes);
  return u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b;
}

function xlsxToGrid(bytes: ArrayBuffer): string[][] {
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  const name = wb.SheetNames[0];
  if (!name) return [];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, raw: false, defval: "", blankrows: false });
  return aoa.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : []));
}

function textToGrid(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const d = detectDelimiter(lines) ?? { name: "comma" as const, char: "," };
  return lines.map((l) => splitLine(l, d.char).map((c) => c.replace(/^"|"$/g, "")));
}

/** A crosstab has a header row carrying several "Z1/…" department codes. */
function isGrCrosstab(grid: string[][]): boolean {
  for (let i = 0; i < Math.min(grid.length, 6); i++) {
    const z1 = grid[i]!.filter((c) => /^Z1\//.test(c.trim())).length;
    if (z1 >= 3) return true;
  }
  return false;
}

/**
 * Unpivot a SAP GR crosstab: metric blocks across columns
 * (qty / cost / sell / margin), one column per department within each block.
 * Data rows are PO Documents and their articles; each article's value lives in
 * its single department column.
 */
function parseGrCrosstab(grid: string[][], grDate: string | undefined): GrParseResult {
  // Locate the three header rows by the department-code row (most "Z1/" cells).
  let deptRowIdx = 0;
  let best = -1;
  for (let i = 0; i < Math.min(grid.length, 6); i++) {
    const z1 = grid[i]!.filter((c) => /^Z1\//.test(c.trim())).length;
    if (z1 > best) {
      best = z1;
      deptRowIdx = i;
    }
  }
  const metricRow = grid[deptRowIdx - 1] ?? [];
  const deptRow = grid[deptRowIdx] ?? [];
  const nameRow = grid[deptRowIdx + 1] ?? [];
  const dataStart = deptRowIdx + 2;

  // Group the metric row into consecutive same-name blocks (from col 2 on).
  type Block = { name: string; start: number; end: number };
  const blocks: Block[] = [];
  for (let i = 2; i < metricRow.length; i++) {
    const m = (metricRow[i] ?? "").trim();
    if (!m) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.name === m && last.end === i - 1) last.end = i;
    else blocks.push({ name: m, start: i, end: i });
  }
  const find = (kw: string) => blocks.find((b) => b.name.toLowerCase().includes(kw));
  const qB = find("oun") ?? find("good rec") ?? blocks[0];
  const cB = find("cost");
  const sB = find("sell");
  const mB = find("margin");
  if (!qB || !cB) {
    return { lines: [], delimiter: "fixed", headerMap: {}, totalRows: grid.length, skippedRows: grid.length, warnings: ["Could not identify GR metric columns (qty/cost) in the crosstab."] };
  }
  const width = qB.end - qB.start + 1;

  const lines: ParsedGrLine[] = [];
  let currentPo: string | undefined;
  let skipped = 0;
  for (let r = dataStart; r < grid.length; r++) {
    const row = grid[r]!;
    const c0 = (row[0] ?? "").trim();
    const c1 = (row[1] ?? "").trim();
    if (!c0 || c0 === "Overall Result" || c1 === "Overall Result") {
      skipped++;
      continue;
    }
    const isPo = /^\d{9,}$/.test(c0) && (c1 === "" || c1 === c0);
    const isArticle = /^\d{3,8}$/.test(c0) && !!c1 && !/^\d+$/.test(c1);
    if (isPo) {
      currentPo = c0;
      continue;
    }
    if (!isArticle) {
      skipped++;
      continue;
    }
    // Unpivot: emit a line for each real department column carrying a value.
    for (let k = 1; k < width; k++) {
      // Cheap empty-cell skip first — an article sits in one department, so 28 of
      // 29 columns are blank; this avoids ~58 regex number-parses per row.
      const qCell = row[qB.start + k];
      const cCell = row[cB.start + k];
      if ((!qCell || qCell.trim() === "") && (!cCell || cCell.trim() === "")) continue;
      const rawDept = (deptRow[qB.start + k] ?? "").trim();
      if (!rawDept || rawDept === "Overall Result") continue;
      const qty = parseSapNumber(qCell);
      const cost = round2(parseSapNumber(cCell));
      if (cost == null && qty == null) continue;
      const sell = sB ? round2(parseSapNumber(row[sB.start + k])) : undefined;
      let margin = mB ? round2(parseSapNumber(row[mB.start + k])) : undefined;
      if (margin == null && cost != null && sell != null && sell !== 0) {
        margin = round2(((sell - cost) / sell) * 100);
      }
      lines.push({
        poNumber: currentPo,
        articleCode: c0,
        articleDesc: c1,
        deptCode: canonicalDeptCode(rawDept) ?? rawDept,
        deptName: resolveDeptName(rawDept, (nameRow[qB.start + k] ?? "").trim()),
        qty,
        costZar: cost,
        sellZar: sell,
        marginPct: margin,
        grDate,
        raw: {},
      });
    }
  }

  return {
    lines,
    delimiter: "fixed",
    headerMap: { layout: "crosstab", qty: qB.name, cost: cB.name, sell: sB?.name ?? "", margin: mB?.name ?? "" },
    totalRows: grid.length - dataStart,
    skippedRows: skipped,
    warnings: lines.length === 0 ? ["Crosstab detected but no article rows yielded data."] : [],
  };
}

/**
 * Goods-receipt (GR) file parser.
 *
 * A GR export lists what was actually received against POs, with department,
 * cost and sell prices, and margin. Like the PO parser it is column-name driven
 * (auto-detect delimiter + synonym mapping). Department names are resolved from
 * the code via the DEPARTMENTS master, falling back to any name in the file.
 *
 * Extend GR_COLUMN_SYNONYMS below if a real export uses different headers.
 */
const GR_COLUMN_SYNONYMS: Record<string, string[]> = {
  poNumber: [
    "purchasing document", "purchasing doc", "purch doc", "po number", "po",
    "document number", "doc number", "ebeln", "order",
  ],
  articleCode: [
    "material", "article", "material number", "material no", "article number",
    "article no", "matnr", "sku", "barcode",
  ],
  articleDesc: [
    "material description", "article description", "short text", "description",
    "txz01", "item text", "article desc", "product description",
  ],
  deptCode: [
    "department code", "dept code", "department", "dept", "merch dept", "department no",
    "dept no", "material group", "matkl", "hierarchy",
  ],
  deptName: [
    "department name", "dept name", "department description", "dept desc", "department desc",
    "merch dept name",
  ],
  qty: [
    "quantity", "qty", "gr quantity", "gr qty", "received quantity", "received qty",
    "quantity received", "menge", "wemng", "delivered qty",
  ],
  costZar: [
    "cost", "cost price", "cost value", "total cost", "cost zar", "unit cost", "cost amount",
    "nett cost", "net cost", "cost excl",
  ],
  sellZar: [
    "sell", "sell price", "sell value", "selling price", "retail", "retail price", "rsp",
    "sell zar", "sell amount", "sell incl",
  ],
  marginPct: [
    "margin", "margin pct", "margin percent", "gp", "gp pct", "gross profit", "gross margin",
    "gp percentage", "markup",
  ],
  grDate: [
    "gr date", "goods receipt date", "posting date", "document date", "doc date", "date",
    "receipt date", "received date", "budat",
  ],
};

function parseGrFlat(text: string, fallbackDate?: string): GrParseResult {
  const warnings: string[] = [];
  const rawLines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  if (rawLines.length < 2) {
    return emptyResult("File has no data rows (need a header row and at least one line).");
  }

  const detected = detectDelimiter(rawLines);
  if (!detected) {
    return {
      ...emptyResult("Could not detect a delimiter (tab/comma/semicolon/pipe)."),
      skippedRows: rawLines.length,
    };
  }

  // Header = first row that maps an article code OR a PO number.
  let headerIdx = 0;
  let headerCols: string[] = [];
  let mapping = { index: {} as Record<string, number>, headerMap: {} as Record<string, string> };
  for (let i = 0; i < Math.min(rawLines.length, 10); i++) {
    const cols = splitLine(rawLines[i]!, detected.char).map((c) => c.replace(/^"|"$/g, ""));
    const m = mapHeaders(cols, GR_COLUMN_SYNONYMS);
    if (m.index["articleCode"] !== undefined || m.index["poNumber"] !== undefined) {
      headerIdx = i;
      headerCols = cols;
      mapping = m;
      break;
    }
  }

  if (mapping.index["articleCode"] === undefined && mapping.index["poNumber"] === undefined) {
    return {
      lines: [],
      delimiter: detected.name,
      headerMap: {},
      totalRows: rawLines.length - 1,
      skippedRows: rawLines.length - 1,
      warnings: [
        "Could not locate an article or PO column. Extend GR_COLUMN_SYNONYMS in src/parser/grParser.ts.",
      ],
    };
  }

  const idx = mapping.index;
  const col = columnReader(idx);
  const lines: ParsedGrLine[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < rawLines.length; r++) {
    const rowText = rawLines[r]!;
    if (/^[-=_*\s|]+$/.test(rowText)) {
      skipped++;
      continue;
    }
    const cols = splitLine(rowText, detected.char);

    const articleCode = col(cols, "articleCode");
    const poNumber = col(cols, "poNumber");
    if (!articleCode && !poNumber) {
      skipped++;
      continue;
    }

    const raw: Record<string, string> = {};
    for (const [field, i] of Object.entries(idx)) {
      const v = cols[i];
      if (v !== undefined) raw[headerCols[i] ?? field] = v.replace(/^"|"$/g, "").trim();
    }

    const rawDept = col(cols, "deptCode");
    const deptCode = canonicalDeptCode(rawDept) ?? rawDept;
    const deptName = resolveDeptName(rawDept, col(cols, "deptName"));

    const qty = parseSapNumber(col(cols, "qty"));
    const costZar = round2(parseSapNumber(col(cols, "costZar")));
    const sellZar = round2(parseSapNumber(col(cols, "sellZar")));
    let marginPct = round2(parseSapNumber(col(cols, "marginPct")));
    // derive margin if absent: (sell - cost) / sell * 100
    if (marginPct == null && costZar != null && sellZar != null && sellZar !== 0) {
      marginPct = round2(((sellZar - costZar) / sellZar) * 100);
    }

    lines.push({
      poNumber,
      articleCode,
      articleDesc: col(cols, "articleDesc"),
      deptCode,
      deptName,
      qty,
      costZar,
      sellZar,
      marginPct,
      grDate: parseSapDate(col(cols, "grDate")) ?? fallbackDate,
      raw,
    });
  }

  if (lines.length === 0) warnings.push("Header row parsed but no data rows yielded an article/PO.");

  return {
    lines,
    delimiter: detected.name,
    headerMap: mapping.headerMap,
    totalRows: rawLines.length - headerIdx - 1,
    skippedRows: skipped,
    warnings,
  };
}

function emptyResult(warning: string): GrParseResult {
  return { lines: [], delimiter: "unknown", headerMap: {}, totalRows: 0, skippedRows: 0, warnings: [warning] };
}

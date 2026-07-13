/**
 * End-of-Day Movements Report parser (Brief 5).
 *
 * Two source shapes, sniffed by content (not extension):
 *   - .txt  tab-delimited, latin-1, CRLF — a SAP list export with a title block,
 *           a selection-parameters block, then the real data header row whose
 *           columns include "Movement Text" / "Date" / "Pur. Doc." / "GR Val(In)".
 *   - .htm  an ALV HTML <table> (UTF-8), same logical columns.
 *
 * Both map to canonical fields by header NAME (mapHeaders), so the extra empty
 * columns and the .txt vs .htm column-count difference don't matter. Numbers are
 * SAP-formatted (US "1,234.56" with a TRAILING minus for negatives); dates are
 * DD.MM.YYYY. DC-Claim rows with no monetary value are dropped at ingest.
 */
import { mapHeaders, columnReader, parseSapNumber, parseSapDate, normalizeHeader } from "./core";

export interface EodRow {
  movementType?: string;
  mvmtCode?: string;
  date?: string; // ISO
  docNo?: string;
  poNumber?: string;
  supplierNo?: string;
  supplierName?: string;
  reference?: string;
  grReference?: string;
  grValEx?: number;
  grVat?: number;
  grValIn?: number;
  currency?: string;
  invStatus?: string;
  grLivVar?: number;
  livDoc?: string;
  livDate?: string; // ISO
  livValue?: number;
  dcrcType?: string;
  claimValue?: number;
}

export interface EodParseResult {
  format: "txt" | "htm";
  rows: EodRow[];
  rawRows: number; // data rows seen before filtering
  skippedDcClaims: number; // valueless DC-claim noise dropped
  headerMap: Record<string, string>;
  warnings: string[];
  // self-check totals
  grCount: number;
  grValInTotal: number;
  returnCount: number;
  returnValTotal: number;
  reversalCount: number;
}

const SYNONYMS: Record<string, string[]> = {
  movementType: ["movement text", "mvt text"],
  mvmtCode: ["movmt type"],
  date: ["date"],
  docNo: ["documentno", "document no"],
  poNumber: ["pur doc", "purchasing document"],
  supplierNo: ["supplier"],
  supplierName: ["name"],
  reference: ["reference"],
  grReference: ["gr reference"],
  grValEx: ["gr val ex"],
  grVat: ["gr vat"],
  grValIn: ["gr val in"],
  currency: ["currency"],
  invStatus: ["inv status"],
  grLivVar: ["gr liv"],
  livDoc: ["liv docno", "liv doc no"],
  livDate: ["liv date"],
  livValue: ["liv value"],
  dcrcType: ["dcrc type"],
  claimValue: ["value"],
};

// movement-type keys are normalizeHeader() forms (slashes/dots stripped):
//   "Goods Receipt / AOD" → "goods receipt aod", "Rev. Goods Return" → "rev goods return".
const MOVEMENT_HEADER = new Set(["movement text", "mvt text"]);
const GR_TYPES = new Set(["goods receipt aod"]);
const RETURN_TYPES = new Set(["goods return note"]);
const REVERSAL_TYPES = new Set(["rev goods return"]);

/** latin-1: byte value == code point. Chunked to avoid call-stack limits. */
function decodeLatin1(bytes: Uint8Array): string {
  let out = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + CH, bytes.length)));
  }
  return out;
}

function looksHtml(bytes: Uint8Array): boolean {
  const head = decodeLatin1(bytes.subarray(0, 512)).toLowerCase();
  return head.includes("<html") || head.includes("<table") || head.includes("<!doctype html");
}

export function parseEodFile(input: ArrayBuffer | Uint8Array, _filename: string): EodParseResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return looksHtml(bytes)
    ? buildResult("htm", ...extractHtmlRows(new TextDecoder("utf-8").decode(bytes)))
    : buildResult("txt", ...extractTextRows(decodeLatin1(bytes)));
}

/** HTML ALV table → [headers, rows-of-cells]. */
function extractHtmlRows(html: string): [string[], string[][]] {
  const stripTags = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))) // hex entities, e.g. &#x2f; = "/"
      .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
      .replace(/ /g, " ")
      .trim();
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    const cells = [...m[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => stripTags(c[1]!));
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return [[], []];
  // header = the first row that carries a "Movement Text" / "Mvt Text" cell.
  let hi = 0;
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    if (rows[i]!.some((c) => MOVEMENT_HEADER.has(normalizeHeader(c)))) { hi = i; break; }
  }
  const headers = rows[hi]!;
  // Keep every subsequent row — do NOT filter by exact width. SAP HTML exports
  // paginate and can emit ragged trailing-cell counts per row; an exact-width
  // filter silently drops good data. Absolute column indices still resolve
  // (columnReader guards out-of-range), and buildResult's movement-type filter
  // rejects footers / repeated header rows.
  const body = rows.slice(hi + 1).filter((r) => !r.some((c) => MOVEMENT_HEADER.has(normalizeHeader(c))));
  return [headers, body];
}

/** SAP list .txt → [headers, rows-of-cells], from the real data header row down. */
function extractTextRows(text: string): [string[], string[][]] {
  const lines = text.split(/\r\n|\n/);
  let hi = -1;
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i]!.split("\t").map((c) => c.trim());
    if (cells.some((c) => MOVEMENT_HEADER.has(normalizeHeader(c)))) {
      hi = i;
      break;
    }
  }
  if (hi === -1) return [[], []];
  const headers = lines[hi]!.split("\t").map((c) => c.trim());
  const body: string[][] = [];
  for (let i = hi + 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    // SAP truncates trailing EMPTY columns, so genuine data rows vary in width
    // (a GR row with no DCRC/claim trailing fields is ~31 cols vs the 40-col
    // header). Never drop by width — leading columns still align; the
    // movement-type filter in buildResult() rejects footers/repeated headers.
    body.push(raw.split("\t"));
  }
  return [headers, body];
}

function buildResult(format: "txt" | "htm", headers: string[], body: string[][]): EodParseResult {
  const warnings: string[] = [];
  if (!headers.length) {
    warnings.push("No EOD data header row found (expected columns incl. 'Movement Text', 'Date').");
    return {
      format, rows: [], rawRows: 0, skippedDcClaims: 0, headerMap: {}, warnings,
      grCount: 0, grValInTotal: 0, returnCount: 0, returnValTotal: 0, reversalCount: 0,
    };
  }
  const { index, headerMap } = mapHeaders(headers, SYNONYMS);
  const col = columnReader(index);

  const rows: EodRow[] = [];
  let skippedDcClaims = 0;
  let grCount = 0, grValInTotal = 0, returnCount = 0, returnValTotal = 0, reversalCount = 0;

  for (const cells of body) {
    const mt = col(cells, "movementType");
    if (!mt) continue; // separator / blank line
    const grValIn = parseSapNumber(col(cells, "grValIn"));
    const claimValue = parseSapNumber(col(cells, "claimValue"));
    const norm = normalizeHeader(mt);
    const isGr = GR_TYPES.has(norm), isReturn = RETURN_TYPES.has(norm), isRev = REVERSAL_TYPES.has(norm);
    const isDcClaim = norm.includes("dc claim");

    // Skip DC-claim noise ("No claims for DC…") — rows with no monetary value.
    if (isDcClaim && (grValIn == null || grValIn === 0) && (claimValue == null || claimValue === 0)) {
      skippedDcClaims++;
      continue;
    }
    if (!isGr && !isReturn && !isRev && !isDcClaim) continue; // unknown movement — ignore

    const row: EodRow = {
      movementType: mt,
      mvmtCode: col(cells, "mvmtCode"),
      date: parseSapDate(col(cells, "date")),
      docNo: col(cells, "docNo"),
      poNumber: col(cells, "poNumber"),
      supplierNo: col(cells, "supplierNo"),
      supplierName: col(cells, "supplierName"),
      reference: col(cells, "reference"),
      grReference: col(cells, "grReference"),
      grValEx: parseSapNumber(col(cells, "grValEx")),
      grVat: parseSapNumber(col(cells, "grVat")),
      grValIn: grValIn,
      currency: col(cells, "currency"),
      invStatus: col(cells, "invStatus"),
      grLivVar: parseSapNumber(col(cells, "grLivVar")),
      livDoc: col(cells, "livDoc"),
      livDate: parseSapDate(col(cells, "livDate")),
      livValue: parseSapNumber(col(cells, "livValue")),
      dcrcType: col(cells, "dcrcType"),
      claimValue: claimValue,
    };
    rows.push(row);

    if (isGr) { grCount++; grValInTotal += grValIn ?? 0; }
    else if (isReturn) { returnCount++; returnValTotal += grValIn ?? 0; }
    else if (isRev) { reversalCount++; }
  }

  return {
    format,
    rows,
    rawRows: body.length,
    skippedDcClaims,
    headerMap,
    warnings,
    grCount,
    grValInTotal: Math.round(grValInTotal * 100) / 100,
    returnCount,
    returnValTotal: Math.round(returnValTotal * 100) / 100,
    reversalCount,
  };
}

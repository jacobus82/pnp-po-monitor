/**
 * Shared, format-agnostic parsing primitives used by both the SAP PO parser
 * (sapParser.ts) and the goods-receipt parser (grParser.ts):
 *   - delimiter detection,
 *   - quote-aware line splitting,
 *   - SAP number/date normalization,
 *   - synonym-based header → canonical-field mapping.
 */

export type Delimiter = "tab" | "comma" | "semicolon" | "pipe" | "fixed" | "unknown";

const DELIMITERS: Array<{ name: Delimiter; char: string }> = [
  { name: "tab", char: "\t" },
  { name: "pipe", char: "|" },
  { name: "semicolon", char: ";" },
  { name: "comma", char: "," },
];

export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[._/()\\-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pick the delimiter that yields the most consistent, multi-column split. */
export function detectDelimiter(lines: string[]): { name: Delimiter; char: string } | null {
  const sample = lines.slice(0, Math.min(lines.length, 20));
  let best: { name: Delimiter; char: string; score: number } | null = null;
  for (const d of DELIMITERS) {
    const counts = sample.map((l) => l.split(d.char).length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    const consistent = counts.filter((c) => c === max).length;
    const score = max * 10 + consistent;
    if (!best || score > best.score) best = { ...d, score };
  }
  return best ? { name: best.name, char: best.char } : null;
}

/** Split a delimited line honoring simple double-quote quoting (CSV-style). */
export function splitLine(line: string, char: string): string[] {
  if (char !== ",") return line.split(char).map((c) => c.trim());
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parse a SAP numeric string into a JS number.
 * Handles trailing minus ("123.45-"), leading currency/space, thousands
 * separators, and both "1,234.56" (dot decimal) and "1.234,56" (comma decimal).
 */
export function parseSapNumber(input: string | undefined): number | undefined {
  if (input == null) return undefined;
  let s = String(input).trim();
  if (!s) return undefined;

  let negative = false;
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1).trim();
  }
  s = s.replace(/[^\d.,]/g, "");
  if (!s) return undefined;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", "."); // European 1.234,56
    } else {
      s = s.replace(/,/g, ""); // 1,234.56
    }
  } else if (lastComma !== -1) {
    const decimals = s.length - lastComma - 1;
    if (s.indexOf(",") === lastComma && decimals > 0 && decimals <= 2) {
      s = s.replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

export function toCents(n: number | undefined): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

/** Round to 2 decimal places (rand amounts). */
export function round2(n: number | undefined): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  return Math.round(n * 100) / 100;
}

/** Parse common SAP date formats into ISO YYYY-MM-DD. */
export function parseSapDate(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const s = input.trim();
  if (!s) return undefined;

  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return iso(m[1]!, m[2]!, m[3]!);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) return iso(m[3]!, m[2]!, m[1]!);
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return iso(m[1]!, m[2]!, m[3]!);
  return undefined;
}

function iso(y: string, mo: string, d: string): string | undefined {
  const yy = Number(y);
  const mm = Number(mo);
  const dd = Number(d);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  return `${yy.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Extract every date found in a filename, normalized to ISO YYYY-MM-DD, in order
 * of appearance. Recognizes SAP-default export names without renaming:
 *   - ISO            2026-06-12
 *   - day-first dot  12.06.2026          ("… Equiv Date 01.11.2025 - 15.11.2025")
 *   - day-first _    12_06_2026          ("Goods_Receipts_-_…__12_06_2026_-_12_06_2026")
 *   - day-first /    12/06/2026
 */
export function extractFilenameDates(filename: string): string[] {
  const out: string[] = [];
  // First alternative = ISO (year first); second = day-first with . _ or / separators.
  const re = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[._/](\d{1,2})[._/](\d{4})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(filename)) !== null) {
    const v = m[1] !== undefined ? iso(m[1], m[2]!, m[3]!) : iso(m[6]!, m[5]!, m[4]!);
    if (v) out.push(v);
  }
  return out;
}

/**
 * Resolve a filename into a date period (first date → from, last date → to).
 * Returns undefined when no date can be found.
 */
export function parseFilenamePeriod(
  filename: string,
): { from: string; to: string; dates: string[] } | undefined {
  const dates = extractFilenameDates(filename);
  if (dates.length === 0) return undefined;
  let from = dates[0]!;
  let to = dates[dates.length - 1]!;
  if (from > to) [from, to] = [to, from];
  return { from, to, dates };
}

/**
 * Match header columns to canonical fields using a synonym table.
 * Returns canonicalField -> column index, plus a human-readable map of which
 * source header satisfied each field.
 */
export function mapHeaders(
  headers: string[],
  synonyms: Record<string, string[]>,
): { index: Record<string, number>; headerMap: Record<string, string> } {
  const normalized = headers.map(normalizeHeader);
  const index: Record<string, number> = {};
  const headerMap: Record<string, string> = {};

  for (const [canonical, syns] of Object.entries(synonyms)) {
    let found = -1;
    for (const syn of syns) {
      const i = normalized.indexOf(syn);
      if (i !== -1) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      for (let i = 0; i < normalized.length; i++) {
        if (syns.some((syn) => normalized[i] === syn || normalized[i]!.includes(syn))) {
          found = i;
          break;
        }
      }
    }
    if (found !== -1 && !Object.values(index).includes(found)) {
      index[canonical] = found;
      headerMap[canonical] = headers[found]!;
    }
  }
  return { index, headerMap };
}

/** Build a per-row column accessor that strips quotes and blanks. */
export function columnReader(idx: Record<string, number>) {
  return (cols: string[], field: string): string | undefined => {
    const i = idx[field];
    if (i === undefined) return undefined;
    const v = cols[i];
    if (v === undefined) return undefined;
    const cleaned = v.replace(/^"|"$/g, "").trim();
    return cleaned.length ? cleaned : undefined;
  };
}

import type { ParsedPoLine, ParseResult } from "../types";
import {
  columnReader,
  detectDelimiter,
  mapHeaders,
  parseSapDate,
  parseSapNumber,
  splitLine,
  toCents,
} from "./core";

/**
 * SAP PO-export parser.
 *
 * SAP list exports (e.g. ME2M / ME2L / ME2N "Purchasing documents per ..."
 * downloads) come in many shapes. This parser is deliberately tolerant: it
 * auto-detects the delimiter, maps each source column to a canonical field via
 * COLUMN_SYNONYMS, and normalizes SAP number/date formats.
 *
 * If the real export differs, extend COLUMN_SYNONYMS below — that is the one
 * place column naming lives.
 */

// canonical field -> list of accepted SAP column labels (normalized for match).
// Supports both the simple sample export and the SAP "Dynamic List Display"
// report (tab-delimited, leading empty column, "Pur. Doc." / "Mdse Cat." /
// "To be inv." / "To be del." / "SLoc" headers).
const COLUMN_SYNONYMS: Record<string, string[]> = {
  poNumber: [
    "pur doc", "purchasing document", "purchasing doc", "purch doc", "po number", "po",
    "document number", "doc number", "ebeln", "order",
  ],
  poLineNo: ["item", "po item", "line item", "line", "ebelp", "item number"],
  vendorCode: [
    "vendor", "supplier", "vendor number", "vendor no", "account number of vendor",
    "lifnr", "supplier number",
  ],
  vendorName: ["name of vendor", "vendor name", "supplier name", "name 1", "name1"],
  articleCode: [
    "article", "material", "material number", "material no", "article number",
    "article no", "matnr",
  ],
  articleDescription: [
    "short text", "material description", "article description", "description",
    "txz01", "item text",
  ],
  // Merchandise category code (e.g. F55010101); department is its first 3 chars.
  mdseCat: ["mdse cat", "merchandise category", "material group", "matkl", "category", "merch category"],
  department: ["department", "dept"],
  orderQty: [
    "quantity", "order quantity", "po quantity", "qty", "menge", "ordered qty",
    "purchase order quantity",
  ],
  uom: ["opu", "order unit", "order price unit", "unit", "uom", "base unit of measure", "meins", "po unit"],
  netPrice: [
    "net price", "net order price", "price", "unit price", "netpr", "net value per unit",
  ],
  lineValue: ["net value", "value", "total value", "line value", "net order value", "amount"],
  openInvoiceValue: ["to be inv", "still to be invoiced", "to be invoiced", "open invoice value"],
  openDeliverValue: ["to be del", "still to be delivered value", "open delivery value"],
  sloc: ["sloc", "storage location", "storage loc", "lgort"],
  currency: ["currency", "crcy", "waers", "curr"],
  orderDate: [
    "doc date", "document date", "order date", "po date", "bedat", "purchase order date",
  ],
  deliveryDate: [
    "delivery date", "deliv date", "deliv dt", "delivery dt", "del date", "deldate",
    "eindt", "scheduled delivery date", "sched line date", "sched deliv date",
    "requested delivery date", "req deliv date", "req del date", "stat deliv date",
    "planned delivery date", "planned deliv date", "item delivery date",
    "lieferdatum", "liefertermin",
  ],
  grQty: [
    "quantity delivered", "delivered", "delivered qty", "gr quantity", "goods receipt qty",
    "gr qty", "received quantity", "wemng",
  ],
  openQty: [
    "still to be delivered qty", "still to be delivered (qty)", "open quantity", "open qty",
    "outstanding qty",
  ],
};

/** SAP purchasing-document numbers are numeric (e.g. 4768041429). Used to skip
 *  repeated page-header / title rows interspersed through report-style exports. */
function looksLikePoNumber(s: string | undefined): s is string {
  return s != null && /^\d{6,}$/.test(s.trim());
}

/** Split a combined "code  name" vendor cell into its parts.
 *  e.g. "1000001598 Premier FMCG (Pty) Ltd" or "MA15       PNP Eastport Inland DC". */
function splitVendor(cell: string | undefined): { code?: string; name?: string } {
  if (!cell) return {};
  const s = cell.trim();
  const m = s.match(/^(\S+)\s+(.*)$/);
  if (m) return { code: m[1], name: m[2]!.trim() || undefined };
  return { code: s || undefined };
}

function deriveStatus(openQty?: number, orderQty?: number, grQty?: number): ParsedPoLine["lineStatus"] {
  if (openQty != null) {
    if (openQty <= 0) return "closed";
    if (orderQty != null && openQty < orderQty) return "partial";
    return "open";
  }
  if (orderQty != null && grQty != null) {
    if (grQty <= 0) return "open";
    if (grQty >= orderQty) return "closed";
    return "partial";
  }
  return "open";
}

export function parseSapFile(text: string, defaultCurrency = "ZAR"): ParseResult {
  const warnings: string[] = [];
  const rawLines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  if (rawLines.length < 2) {
    return {
      lines: [],
      delimiter: "unknown",
      headerMap: {},
      totalRows: 0,
      skippedRows: 0,
      warnings: ["File has no data rows (need a header row and at least one line)."],
    };
  }

  const detected = detectDelimiter(rawLines);
  if (!detected) {
    return {
      lines: [],
      delimiter: "unknown",
      headerMap: {},
      totalRows: 0,
      skippedRows: rawLines.length,
      warnings: ["Could not detect a delimiter (tab/comma/semicolon/pipe). Fixed-width parsing is not yet implemented."],
    };
  }

  // Find the header row: the first line that maps at least poNumber.
  let headerIdx = 0;
  let headerCols: string[] = [];
  let mapping = { index: {} as Record<string, number>, headerMap: {} as Record<string, string> };
  for (let i = 0; i < Math.min(rawLines.length, 10); i++) {
    const cols = splitLine(rawLines[i]!, detected.char).map((c) => c.replace(/^"|"$/g, ""));
    const m = mapHeaders(cols, COLUMN_SYNONYMS);
    if (m.index["poNumber"] !== undefined) {
      headerIdx = i;
      headerCols = cols;
      mapping = m;
      break;
    }
  }

  if (mapping.index["poNumber"] === undefined) {
    return {
      lines: [],
      delimiter: detected.name,
      headerMap: {},
      totalRows: rawLines.length - 1,
      skippedRows: rawLines.length - 1,
      warnings: [
        "Could not locate a 'Purchasing Document' / PO number column. " +
          "Check the export columns or extend COLUMN_SYNONYMS in src/parser/sapParser.ts.",
      ],
    };
  }

  // Diagnostic: surface exactly what headers the export carried and which
  // canonical field each mapped to (visible via `wrangler tail`). Critical for
  // tracking down columns like delivery date that fail to map.
  console.log(
    "[sapParser] delimiter=%s headerRow=%d headers=%s",
    detected.name,
    headerIdx,
    JSON.stringify(headerCols),
  );
  console.log("[sapParser] mappedFields=%s", JSON.stringify(mapping.headerMap));
  console.log(
    "[sapParser] deliveryDate -> %s | orderDate -> %s",
    mapping.headerMap["deliveryDate"] ?? "(UNMAPPED)",
    mapping.headerMap["orderDate"] ?? "(UNMAPPED)",
  );

  const idx = mapping.index;
  const col = columnReader(idx);

  const lines: ParsedPoLine[] = [];
  let skipped = 0;

  for (let r = headerIdx + 1; r < rawLines.length; r++) {
    const cols = splitLine(rawLines[r]!, detected.char);
    if (/^[-=_*\s|]+$/.test(rawLines[r]!)) {
      skipped++;
      continue;
    }
    const poNumber = col(cols, "poNumber");
    // Skip blanks and the repeated page-title / column-header rows that SAP
    // report exports interleave (their "PO" cell is text like "Pur. Doc.").
    if (!looksLikePoNumber(poNumber)) {
      skipped++;
      continue;
    }

    const raw: Record<string, string> = {};
    for (const [field, i] of Object.entries(idx)) {
      const v = cols[i];
      if (v !== undefined) raw[headerCols[i] ?? field] = v.replace(/^"|"$/g, "").trim();
    }

    const orderQty = parseSapNumber(col(cols, "orderQty"));
    const grQty = parseSapNumber(col(cols, "grQty"));
    let openQty = parseSapNumber(col(cols, "openQty"));
    if (openQty == null && orderQty != null && grQty != null) {
      openQty = Math.max(orderQty - grQty, 0);
    }

    const netPrice = parseSapNumber(col(cols, "netPrice"));
    const netPriceCents = toCents(netPrice);
    let lineValueCents = toCents(parseSapNumber(col(cols, "lineValue")));
    if (lineValueCents == null && netPriceCents != null && orderQty != null) {
      lineValueCents = Math.round(netPriceCents * orderQty);
    }

    // Open-to-deliver value: prefer the explicit "To be del." column, else derive.
    let openValueCents = toCents(parseSapNumber(col(cols, "openDeliverValue")));
    if (openValueCents == null && netPriceCents != null && openQty != null) {
      openValueCents = Math.round(netPriceCents * openQty);
    }
    const openInvoiceCents = toCents(parseSapNumber(col(cols, "openInvoiceValue")));

    // Vendor cell combines "code  name"; merchandise category's first 3 chars
    // are the department (F55 → Outsourced Bakery, G12 → Edible Groceries, …).
    const vendor = splitVendor(col(cols, "vendorCode") ?? col(cols, "vendorName"));
    const mdseCat = col(cols, "mdseCat");
    const department = col(cols, "department") ?? (mdseCat ? mdseCat.slice(0, 3) : undefined);

    lines.push({
      poNumber,
      poLineNo: col(cols, "poLineNo"),
      vendorCode: vendor.code,
      vendorName: col(cols, "vendorName") ? splitVendor(col(cols, "vendorName")).name : vendor.name,
      articleCode: col(cols, "articleCode"),
      articleDescription: col(cols, "articleDescription"),
      department,
      mdseCat,
      sloc: col(cols, "sloc"),
      orderQty,
      uom: col(cols, "uom"),
      netPriceCents,
      lineValueCents,
      currency: col(cols, "currency") ?? defaultCurrency,
      grQty,
      openQty,
      openValueCents,
      openInvoiceCents,
      orderDate: parseSapDate(col(cols, "orderDate")),
      deliveryDate: parseSapDate(col(cols, "deliveryDate")),
      lineStatus: deriveStatus(openQty, orderQty, grQty),
      raw,
    });
  }

  if (lines.length === 0) {
    warnings.push("Header row parsed but no data rows yielded a PO number.");
  }

  return {
    lines,
    delimiter: detected.name,
    headerMap: mapping.headerMap,
    headerColumns: headerCols,
    totalRows: rawLines.length - headerIdx - 1,
    skippedRows: skipped,
    warnings,
  };
}

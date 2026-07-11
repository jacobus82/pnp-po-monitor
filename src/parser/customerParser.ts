/**
 * Parser for the SAP "Customer Count - Equiv Date Range" CSV export.
 *
 * Shape (quoted CSV, 14 columns):
 *   Site, Site, Calendar Day, Customer Count TY, Customer Count LY, Customer Count Var,
 *   Sales Value TY, Sales Value LY, Sales Value Growth, Sales Units TY, Sales Units LY,
 *   Sales Units Growth, Ave Customer Value TY, Ave Customer Units TY
 *
 * Row 1 is the header; rows 2-3 are "Overall Result"/"Result" summary rows. Daily
 * rows have a dd.mm.yyyy "Calendar Day". We map headers by name (robust to column
 * reordering) and skip any row whose Calendar Day isn't a real date — which drops
 * the summary rows for free. Money (Sales Value / Ave Customer Value) is stored in
 * cents; counts are integers; units are floats. parseSapNumber already strips the
 * " ZAR"/" MIX"/"%" decorations and thousands separators.
 */
import {
  splitLine,
  mapHeaders,
  columnReader,
  parseSapNumber,
  parseSapDate,
  toCents,
} from "./core";
import type { CustomerParseResult, ParsedCustomerRow } from "../types";

const SYNONYMS: Record<string, string[]> = {
  site: ["site"],
  calDate: ["calendar day"],
  customersTy: ["customer count ty"],
  customersLy: ["customer count ly"],
  salesTy: ["sales value ty"],
  salesLy: ["sales value ly"],
  unitsTy: ["sales units ty"],
  unitsLy: ["sales units ly"],
  aveValueTy: ["ave customer value ty"],
  aveUnitsTy: ["ave customer units ty"],
};

export function parseCustomerFile(text: string, _filename: string): CustomerParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    return { rows: [], delimiter: "comma", headerMap: {}, totalRows: 0, skippedRows: 0, warnings: ["Empty file."] };
  }

  const headers = splitLine(lines[0]!, ",");
  const { index, headerMap } = mapHeaders(headers, SYNONYMS);
  const read = columnReader(index);

  if (index.calDate === undefined || index.customersTy === undefined) {
    warnings.push("Could not locate the 'Calendar Day' / 'Customer Count TY' columns — check the file format.");
    return { rows: [], delimiter: "comma", headerMap, totalRows: lines.length - 1, skippedRows: lines.length - 1, warnings };
  }

  const rows: ParsedCustomerRow[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = splitLine(lines[i]!, ",");
    const calDate = parseSapDate(read(cols, "calDate"));
    if (!calDate) {
      skipped++; // header echoes, "Overall Result"/"Result" totals, or blank dates
      continue;
    }
    const intOf = (f: string) => {
      const n = parseSapNumber(read(cols, f));
      return n == null ? undefined : Math.round(n);
    };
    const numOf = (f: string) => parseSapNumber(read(cols, f));

    const raw: Record<string, string> = {};
    for (const [field, idx] of Object.entries(index)) {
      const v = cols[idx];
      if (v !== undefined) raw[field] = v;
    }

    rows.push({
      calDate,
      siteCode: read(cols, "site"),
      customersTy: intOf("customersTy"),
      customersLy: intOf("customersLy"),
      salesTyCents: toCents(numOf("salesTy")),
      salesLyCents: toCents(numOf("salesLy")),
      unitsTy: numOf("unitsTy"),
      unitsLy: numOf("unitsLy"),
      basketTyCents: toCents(numOf("aveValueTy")),
      unitsPerCustTy: numOf("aveUnitsTy"),
      raw,
    });
  }

  if (rows.length === 0) warnings.push("No dated customer-count rows were found.");
  return { rows, delimiter: "comma", headerMap, totalRows: lines.length - 1, skippedRows: skipped, warnings };
}

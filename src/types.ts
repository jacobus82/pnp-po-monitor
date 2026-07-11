/** Canonical, normalized PO line produced by the SAP parser. */
export interface ParsedPoLine {
  poNumber: string;
  poLineNo?: string;
  vendorCode?: string;
  vendorName?: string;
  articleCode?: string;
  articleDescription?: string;
  department?: string;

  orderQty?: number;
  uom?: string;
  netPriceCents?: number; // price per unit, in cents
  lineValueCents?: number; // qty * price, in cents
  currency: string;

  grQty?: number; // goods received
  openQty?: number; // still to deliver
  openValueCents?: number; // open-to-deliver value (cents)
  openInvoiceCents?: number; // open-to-invoice value (cents)

  mdseCat?: string; // merchandise category code, e.g. "F55010101"
  sloc?: string; // storage location, e.g. "S001" (normal) / "S002" (returns)

  orderDate?: string; // ISO YYYY-MM-DD
  deliveryDate?: string; // ISO YYYY-MM-DD
  lineStatus: "open" | "partial" | "closed";

  raw: Record<string, string>;
}

export interface ParseResult {
  lines: ParsedPoLine[];
  delimiter: "tab" | "comma" | "semicolon" | "pipe" | "fixed" | "unknown";
  headerMap: Record<string, string>; // canonical field -> matched source column
  headerColumns?: string[]; // every raw header in the file (incl. unmapped) — for diagnostics
  totalRows: number;
  skippedRows: number;
  warnings: string[];
}

/** Canonical, normalized goods-receipt line produced by the GR parser. */
export interface ParsedGrLine {
  poNumber?: string;
  articleCode?: string;
  articleDesc?: string;
  deptCode?: string; // canonical "Z1/XYZ"
  deptName?: string;
  qty?: number;
  costZar?: number; // rand
  sellZar?: number; // rand
  marginPct?: number; // 0-100
  grDate?: string; // ISO YYYY-MM-DD
  raw: Record<string, string>;
}

export interface GrParseResult {
  lines: ParsedGrLine[];
  delimiter: "tab" | "comma" | "semicolon" | "pipe" | "fixed" | "unknown";
  headerMap: Record<string, string>;
  totalRows: number;
  skippedRows: number;
  warnings: string[];
}

/** Canonical, normalized FIM (financial information management) department row. */
export interface ParsedFimRow {
  deptCode: string; // short code (F09, G12, …) or 'TOTAL'
  deptName?: string;
  netSalesZar?: number;
  totalCosZar?: number;
  posMarginPct?: number;
  operatingMarginPct?: number;
  shrinkZar?: number;
  wasteZar?: number;
  storeMarginPct?: number;
  totalPurchasesZar?: number;
  netGrCostZar?: number;
  // stock on hand
  openingSohZar?: number;
  closingSohZar?: number;
  // funding & rebates
  commercialDiscZar?: number;
  lineDiscZar?: number;
  basketDiscZar?: number;
  tradeInvestZar?: number;
  salliesTalliesZar?: number;
  swellAllowanceZar?: number;
  // shortages
  totalShortagesZar?: number;
  netShrinkageZar?: number;
  rtcZar?: number;
  raw: Record<string, string>;
}

export type FimReportType = "daily" | "weekly" | "monthly";

/** A FIM article row that carries non-zero waste/shrink (for the waste drill-down).
 *  `deptCode` is the parent dept/CP code the article sits under in the sheet. */
export interface ParsedFimArticle {
  code: string;
  desc?: string;
  deptCode: string; // parent dept (or CP number, pre-rollup)
  netSalesZar?: number;
  shrinkZar?: number;
  wasteZar?: number;
  rtcZar?: number;
}

export interface FimParseResult {
  reportDate: string; // ISO YYYY-MM-DD (= dateFrom)
  dateFrom: string; // period start (ISO)
  dateTo: string; // period end (ISO); equals dateFrom for a daily report
  reportType: FimReportType;
  isCpFormat: boolean; // true when rows are keyed by Category Portfolio number (needs CP→dept rollup)
  rows: ParsedFimRow[]; // department (or CP) rows (excludes the TOTAL row)
  total?: ParsedFimRow; // the 'Overall Result' line, if present
  articles: ParsedFimArticle[]; // article rows with non-zero waste/shrink (for the drill-down)
  articleCount: number; // article rows seen (6+ digit codes), for reporting
  skippedRows: number; // other non-department rows ignored
  warnings: string[];
}

/** Canonical, normalized customer-count row (one per calendar day). */
export interface ParsedCustomerRow {
  calDate: string; // ISO YYYY-MM-DD
  siteCode?: string;
  customersTy?: number;
  customersLy?: number;
  salesTyCents?: number; // Sales Value TY, in cents
  salesLyCents?: number; // Sales Value LY, in cents
  unitsTy?: number;
  unitsLy?: number;
  basketTyCents?: number; // Ave Customer Value TY, in cents
  unitsPerCustTy?: number; // Ave Customer Units TY
  raw: Record<string, string>;
}

export interface CustomerParseResult {
  rows: ParsedCustomerRow[];
  delimiter: "tab" | "comma" | "semicolon" | "pipe" | "fixed" | "unknown";
  headerMap: Record<string, string>;
  totalRows: number;
  skippedRows: number;
  warnings: string[];
}

/** One survey response from the Fan Score / NPS report. */
export interface ParsedFanScoreResponse {
  score?: number; // 0-10; undefined for non-numeric answers
  classification?: "promoter" | "passive" | "detractor";
  reason?: string;
}

export interface FanScoreParseResult {
  weekEnding?: string; // ISO YYYY-MM-DD
  siteCode?: string;
  npsTw?: number; // reported NPS this week (%)
  npsLw?: number; // reported NPS last week (%)
  responses: ParsedFanScoreResponse[];
  warnings: string[];
}

export type AnomalyType =
  | "OVER_BUDGET"
  | "STALE_OPEN_ORDER"
  | "PRICE_SPIKE"
  | "DUPLICATE_PO_LINE"
  | "MISSING_PRICE"
  | "MISSING_VENDOR"
  | "NEGATIVE_VALUE"
  | "OVER_DELIVERY"
  | "NEGATIVE_MARGIN"
  | "LOW_MARGIN"
  | "FIM_MARGIN_BELOW_GUIDELINE"
  | "FIM_HIGH_WASTE"
  | "FIM_HIGH_SHRINK"
  | "FIM_PARTICIPATION_DEVIATION";

export interface Anomaly {
  poLineId?: number;
  type: AnomalyType;
  severity: "INFO" | "WARN" | "CRITICAL";
  message: string;
  detail?: Record<string, unknown>;
}

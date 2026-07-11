// ============================================================================
// statement-ingest.ts — pure engine module (no fetch/UI), PO Monitor pattern
//
// Parses the pipe-delimited PnP account-statement CSV in BOTH variants:
//   NATIVE : 6-field header, 13-field lines (exported from PnP directly)
//   PDF    : 9-field header (adds opening|closing|total_due), 14-field lines
//            (adds a trailing "PDF" lineage column) — produced by the browser
//            PDF parser's toCanonicalCsv(), or the browser posts {header,lines}
//            straight through.
//
// Wired into the Worker route like /api/gr-uploads:
//   const { header, lines } = parseStatementCsv(text);
//   await persistStatement(env.DB, header, lines);
//
// Encoding: the caller MUST decode the upload as latin1
//   new TextDecoder('latin1').decode(buf)
// A utf-8 decode corrupts the 0xA0 padding bytes in the doc column.
//
// Column layout of the real native file (0-indexed, verified against
// NF16_202717.csv): 0 statement_no | 1 account | 2 internal/doc | 3 reference |
// 4 doc_date | 5 debit | 6 credit | 7 liv/settlement doc | 8 "ZAR" (currency,
// ignored) | 9 vendor_text | 10 delivery_ref | 11 vendor_no | 12 vendor_name.
// ============================================================================

export interface StatementHeader {
  statement_no: string;
  account: string;
  statement_date: string;
  period_start: string;
  cut_off: string;
  due_date: string;
  opening_balance: number | null;
  closing_balance: number | null;
  total_due_printed?: number | null;
  total_due: number;
  payment: number;
  source: "NATIVE" | "PDF";
}

export interface StatementLine {
  statement_no: string;
  doc_number: string;
  internal_no: string;
  reference: string;
  doc_date: string;
  amount: number;
  liv_doc: string;
  line_type: string;
  vendor_text: string;
  delivery_ref: string;
  vendor_no: string;
  vendor_name: string;
  source: "NATIVE" | "PDF";
}

export interface StatementStats {
  rowCount: number;
  net: number;
  payments: number;
  totalDue: number;
  checks: string[];
}

export interface ParsedStatement {
  header: StatementHeader;
  lines: StatementLine[];
  stats: StatementStats;
}

export function parseStatementCsv(text: string): ParsedStatement {
  const rows = text.split("\n").filter((r) => r.trim().length > 0);
  if (rows.length < 2) throw new Error("statement file has no data rows");

  // ---- header ----
  const h = rows[0]!.split("|");
  if (h.length !== 6 && h.length !== 9) {
    throw new Error(`unexpected header field count ${h.length} (want 6 native / 9 pdf)`);
  }
  const isPdf = h.length === 9;
  const header: StatementHeader = {
    statement_no: h[0]!.trim(),
    account: h[1]!.trim(),
    statement_date: isoDate(h[2]!),
    period_start: isoDate(h[3]!),
    cut_off: isoDate(h[4]!),
    due_date: isoDate(h[5]!),
    opening_balance: isPdf && h[6]!.trim() !== "" ? Number(h[6]) : null,
    closing_balance: isPdf && h[7]!.trim() !== "" ? Number(h[7]) : null,
    total_due_printed: isPdf && h[8]!.trim() !== "" ? Number(h[8]) : null,
    total_due: 0,
    payment: 0,
    source: isPdf ? "PDF" : "NATIVE",
  };

  // ---- lines ----
  const lines: StatementLine[] = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i]!.split("|");
    if (p.length !== 13 && p.length !== 14) {
      throw new Error(`row ${i + 1}: field count ${p.length} (want 13 or 14)`);
    }
    const internal = p[2]!.trim();
    const is5149 = internal.startsWith("5149");
    const debit = p[5]!.trim() === "" ? 0 : Number(p[5]);
    const credit = p[6]!.trim() === "" ? 0 : Number(p[6]);
    lines.push({
      statement_no: p[0]!.trim(),
      // doc_number: the settlement join key. 5149* rows carry it in col 3;
      // 16/18/14* rows carry it in the LIV/settlement column (col 8 = index 7).
      doc_number: is5149 ? internal : p[7]!.trim(),
      internal_no: is5149 ? "" : internal,
      reference: p[3]!.trim(),
      doc_date: isoDate(p[4]!),
      amount: round2(debit - credit), // signed: debit +, credit -
      liv_doc: is5149 ? p[7]!.trim() : "",
      line_type: classifyLine(p[9]!, p[3]!),
      vendor_text: p[9]!.trim(),
      delivery_ref: p[10]!.trim(),
      vendor_no: p[11]!.trim(),
      vendor_name: p[12]!.trim(),
      source: p.length === 14 ? (p[13]!.trim() as "NATIVE" | "PDF") : "NATIVE",
    });
  }

  // ---- integrity before anything touches D1 ----
  const net = round2(lines.reduce((s, l) => s + l.amount, 0));
  const payments = round2(
    lines.filter((l) => l.doc_number.startsWith("1400")).reduce((s, l) => s + l.amount, 0),
  );
  const totalDue = round2(net - payments);
  const stats: StatementStats = { rowCount: lines.length, net, payments, totalDue, checks: [] };

  const printedDue = header.total_due_printed;
  if (printedDue !== null && printedDue !== undefined && Math.abs(totalDue - printedDue) >= 0.005) {
    stats.checks.push(`total due mismatch: computed ${totalDue} vs printed ${printedDue}`);
  }
  if (
    header.opening_balance !== null &&
    header.closing_balance !== null &&
    Math.abs(round2(header.opening_balance + net) - header.closing_balance) >= 0.005
  ) {
    stats.checks.push(`balance mismatch: opening+net != closing`);
  }
  if (stats.checks.length) throw new Error("integrity failed: " + stats.checks.join("; "));

  // derive figures the header table wants (native files carry none)
  header.total_due = totalDue;
  header.payment = payments;
  if (header.closing_balance === null && header.opening_balance !== null) {
    header.closing_balance = round2(header.opening_balance + net);
  }
  return { header, lines, stats };
}

// Explicit types pass through; everything else buckets by keyword so Bonus Buy
// refs don't explode into hundreds of distinct "types".
export function classifyLine(vendorText: string, reference: string): string {
  const v = vendorText.trim();
  if (v.startsWith("*Invoice reduction")) return "INVOICE_REDUCTION";
  if (v.startsWith("*Invoice")) return "INVOICE";
  if (v.startsWith("*Credit Note")) return "CREDIT_NOTE";
  const r = reference.toUpperCase();
  if (r.startsWith("PAYMENT")) return "PAYMENT";
  if (r.includes("SWELL")) return "SWELL";
  if (r.startsWith("BB")) return "BONUS_BUY";
  if (r.includes("SALLY") || r.includes("TALLY")) return "REBATE";
  if (r.includes("FRANCHISE")) return "FRANCHISE_FEE";
  if (r.includes("LOYALTY")) return "LOYALTY";
  if (r.includes("PROMO")) return "PROMO";
  if (r.includes("FUNDING") || r.includes("SALLIES")) return "FUNDING";
  return "OTHER";
}

// Replace-on-reload: same statement_no wipes prior lines first, so a native CSV
// found later upgrades a PDF load in place. Downgrade (PDF over NATIVE) is
// refused unless force=true.
export async function persistStatement(
  db: D1Database,
  header: StatementHeader,
  lines: StatementLine[],
  { force = false }: { force?: boolean } = {},
): Promise<{ replaced: boolean; previousSource: string | null }> {
  const existing = await db
    .prepare("SELECT source, opening_balance, closing_balance FROM statements WHERE statement_no = ?")
    .bind(header.statement_no)
    .first<{ source: string; opening_balance: number | null; closing_balance: number | null }>();

  if (existing && existing.source === "NATIVE" && header.source === "PDF" && !force) {
    throw new Error(
      `statement ${header.statement_no} already loaded from NATIVE csv; ` +
        `refusing PDF downgrade (pass force=true to override)`,
    );
  }

  // Native CSVs carry no printed balances, so a native (re)load would otherwise
  // blank the balance chain. Preserve it: inherit the opening balance from the
  // same statement's prior (PDF) load when it is being replaced, else from the
  // prior week's closing balance (chain view). Then derive this week's closing
  // from opening + net movement (net = total_due + payment; payment is signed).
  // This keeps the chain table intact for native-only weeks that follow a
  // PDF-loaded week.
  if (header.source === "NATIVE" && header.opening_balance == null) {
    if (existing && existing.opening_balance != null) {
      header.opening_balance = existing.opening_balance;
    } else {
      const prev = await db
        .prepare("SELECT closing_balance FROM statements WHERE cut_off = date(?, '-7 days')")
        .bind(header.cut_off)
        .first<{ closing_balance: number | null }>();
      if (prev && prev.closing_balance != null) header.opening_balance = prev.closing_balance;
    }
    if (header.opening_balance != null && header.closing_balance == null) {
      header.closing_balance = round2(header.opening_balance + round2(header.total_due + header.payment));
    }
  }

  const stmts: D1PreparedStatement[] = [
    db.prepare("DELETE FROM statement_lines WHERE statement_no = ?").bind(header.statement_no),
    db.prepare("DELETE FROM statements WHERE statement_no = ?").bind(header.statement_no),
    db
      .prepare(
        `INSERT INTO statements
        (statement_no, account, statement_date, period_start, cut_off, due_date,
         total_due, payment, closing_balance, opening_balance, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        header.statement_no,
        header.account,
        header.statement_date,
        header.period_start,
        header.cut_off,
        header.due_date,
        header.total_due,
        header.payment,
        header.closing_balance,
        header.opening_balance,
        header.source,
      ),
  ];
  for (const l of lines) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO statement_lines
        (statement_no, doc_number, internal_no, reference, doc_date, amount,
         liv_doc, line_type, vendor_text, delivery_ref, vendor_no, vendor_name, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          l.statement_no,
          l.doc_number,
          l.internal_no,
          l.reference,
          l.doc_date,
          l.amount,
          l.liv_doc,
          l.line_type,
          l.vendor_text,
          l.delivery_ref,
          l.vendor_no,
          l.vendor_name,
          l.source,
        ),
    );
  }
  // ~600-700 rows: one batch, no chunking needed (unlike PO loads).
  await db.batch(stmts);
  return { replaced: !!existing, previousSource: existing?.source ?? null };
}

function isoDate(yyyymmdd: string): string {
  const s = yyyymmdd.trim();
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

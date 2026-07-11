# Task: Statement ingestion — native CSV + in-browser PDF conversion

## Project context

You are working in the PO Monitor repository (Cloudflare Workers + D1 + R2).

- Deploy: `npm run typecheck && npm run deploy` (Wrangler)
- D1 database binding: `env.DB` → database `pnp-po-monitor-db`
- Live URL: https://pnp-po-monitor.info-autocomply.workers.dev
- The app already has a settlement/statement module: a `statements` header
  table, a `statement_lines` detail table, and an open-items ledger that
  matches statement lines to Goods Receipts on LIV doc number. Statement
  CSVs are pipe-delimited exports from PnP corporate.

## Goal

Add ONE upload path on the statements screen that accepts both:

1. **Native statement CSV** (pipe-delimited, latin-1 encoded, 6-field header,
   13-field lines) — parsed in the Worker.
2. **Statement PDF** (the printed account statement, ~27 pages) — parsed
   **in the browser** with pdf.js from cdnjs, validated against the PDF's own
   printed figures, then POSTed as JSON to the same Worker route. The Worker
   never parses PDFs.

Both paths converge on one persistence function. Every line and header row is
tagged `source` = `NATIVE` or `PDF`.

## Step 0 — Discover before changing anything

Run and read the output of:

    npx wrangler d1 execute pnp-po-monitor-db --remote --command=".schema statements"
    npx wrangler d1 execute pnp-po-monitor-db --remote --command=".schema statement_lines"

Also locate:
- the existing statement upload route (search the Worker source for
  `statement` — it may follow the `/api/gr-uploads` pattern)
- the statements screen in the frontend (Cash & Creditors area)

If the `.schema` commands return nothing, the settlement tables were never
deployed — use Case A in Step 1 and skip the adaptation note below.

**Adapt the column names in the code below to the real schema.** The code
was written against the reconciliation-module design (doc_number,
internal_no, reference, doc_date, amount, liv_doc, line_type, vendor_text,
delivery_ref, vendor_no, vendor_name). If the deployed table uses different
names, change the INSERT binds — do not rename the deployed columns.

## Step 1 — D1 migration

**Case A — tables do not exist** (likely: the settlement module was designed
but its schema may never have been deployed). Create them fresh with source
tracking built in, then create ONLY the view from the migration block below:

```sql
CREATE TABLE IF NOT EXISTS statements (
  statement_no    TEXT PRIMARY KEY,
  account         TEXT NOT NULL,
  statement_date  TEXT,
  period_start    TEXT NOT NULL,
  cut_off         TEXT NOT NULL,
  due_date        TEXT NOT NULL,
  total_due       REAL NOT NULL,
  payment         REAL NOT NULL DEFAULT 0,
  opening_balance REAL,
  closing_balance REAL,
  source          TEXT NOT NULL DEFAULT 'NATIVE',
  loaded_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS statement_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  statement_no  TEXT NOT NULL REFERENCES statements(statement_no),
  doc_number    TEXT NOT NULL,
  internal_no   TEXT,
  reference     TEXT,
  doc_date      TEXT,
  amount        REAL NOT NULL,
  liv_doc       TEXT,
  line_type     TEXT,
  vendor_text   TEXT,
  delivery_ref  TEXT,
  vendor_no     TEXT,
  vendor_name   TEXT,
  source        TEXT NOT NULL DEFAULT 'NATIVE'
);
CREATE INDEX IF NOT EXISTS idx_sl_stmt   ON statement_lines(statement_no);
CREATE INDEX IF NOT EXISTS idx_sl_doc    ON statement_lines(doc_number);
CREATE INDEX IF NOT EXISTS idx_sl_liv    ON statement_lines(liv_doc);
CREATE INDEX IF NOT EXISTS idx_sl_vendor ON statement_lines(vendor_no);
```

If the open-items reconciliation module (`schema.sql` / `reconcile.js` from
the settlement design) is also present in the repo but undeployed, deploy it
in the same pass — it consumes these tables.

**Case B — tables already exist.** Adapt then run the migration below. If
`statements` already has `closing_balance`, drop that ALTER. If it already
has `source` or `opening_balance`, skip those too (ALTERs are not
idempotent on D1).

```sql
-- ============================================================================
-- Migration: statement source tracking + balance chain support
-- Run once via: wrangler d1 execute pnp-po-monitor-db --remote --file=migration_statement_source.sql
-- ============================================================================

-- 1. Lineage on lines: NATIVE (pipe CSV from PnP) vs PDF (converted historic)
ALTER TABLE statement_lines ADD COLUMN source TEXT NOT NULL DEFAULT 'NATIVE';

-- 2. Lineage + printed balances on the header.
--    Native CSVs never carry these; PDF-converted files do (extended header
--    fields 7-9). closing_balance may already exist in your schema as a
--    derived column — if so, skip that ALTER and keep opening_balance/source.
ALTER TABLE statements ADD COLUMN source TEXT NOT NULL DEFAULT 'NATIVE';
ALTER TABLE statements ADD COLUMN opening_balance REAL;

-- 3. Chain view: does each statement's opening tie to the prior closing?
--    Only meaningful where both sides have printed balances (PDF loads),
--    or where closing has been derived and persisted for native loads.
CREATE VIEW IF NOT EXISTS v_statement_chain AS
SELECT
  s.statement_no,
  s.cut_off,
  s.source,
  s.opening_balance,
  s.closing_balance,
  p.statement_no  AS prev_statement_no,
  p.closing_balance AS prev_closing,
  CASE
    WHEN s.opening_balance IS NULL OR p.closing_balance IS NULL THEN 'UNKNOWN'
    WHEN ABS(s.opening_balance - p.closing_balance) < 0.005    THEN 'OK'
    ELSE 'BREAK'
  END AS chain_status,
  ROUND(COALESCE(s.opening_balance,0) - COALESCE(p.closing_balance,0), 2) AS chain_gap
FROM statements s
LEFT JOIN statements p
  ON p.cut_off = date(s.cut_off, '-7 days');

```

## Step 2 — Worker engine module

Add `src/statement-ingest.js` (adjust path to repo convention):

```javascript
// ============================================================================
// statement-ingest.js — pure engine module (no fetch/UI), PO Monitor pattern
//
// Parses the pipe-delimited PnP statement CSV in BOTH variants:
//   NATIVE  : 6-field header, 13-field lines (from PnP directly)
//   PDF     : 9-field header (adds opening|closing|total_due),
//             14-field lines (adds trailing "PDF" lineage column)
//
// Wire into the Worker route the same way as /api/gr-uploads:
//   const { header, lines, stats } = parseStatementCsv(text);
//   then persistStatement(env.DB, header, lines) inside the handler.
//
// Encoding: fetch the upload as ArrayBuffer and decode latin1 —
//   new TextDecoder('latin1').decode(buf)
// A utf-8 decode will corrupt the 0xA0 padding bytes in the doc column.
// ============================================================================

export function parseStatementCsv(text) {
  const rows = text.split('\n').filter(r => r.trim().length > 0);
  if (rows.length < 2) throw new Error('statement file has no data rows');

  // ---- header ----
  const h = rows[0].split('|');
  if (h.length !== 6 && h.length !== 9) {
    throw new Error(`unexpected header field count ${h.length} (want 6 native / 9 pdf)`);
  }
  const header = {
    statement_no:   h[0].trim(),
    account:        h[1].trim(),
    statement_date: isoDate(h[2]),
    period_start:   isoDate(h[3]),
    cut_off:        isoDate(h[4]),
    due_date:       isoDate(h[5]),
    opening_balance: h.length === 9 && h[6] !== '' ? Number(h[6]) : null,
    closing_balance: h.length === 9 && h[7] !== '' ? Number(h[7]) : null,
    total_due_printed: h.length === 9 && h[8] !== '' ? Number(h[8]) : null,
    source: h.length === 9 ? 'PDF' : 'NATIVE',
  };

  // ---- lines ----
  const lines = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i].split('|');
    if (p.length !== 13 && p.length !== 14) {
      throw new Error(`row ${i + 1}: field count ${p.length} (want 13 or 14)`);
    }
    const internal = p[2].trim();
    const debit  = p[5].trim() === '' ? 0 : Number(p[5]);
    const credit = p[6].trim() === '' ? 0 : Number(p[6]);
    lines.push({
      statement_no: p[0].trim(),
      // doc_number: the settlement join key. 5149* rows carry it in col 3;
      // 16/18/14* rows carry it in the LIV column (col 8).
      doc_number: internal.startsWith('5149') ? internal : p[7].trim(),
      internal_no: internal.startsWith('5149') ? '' : internal,
      reference:  p[3].trim(),
      doc_date:   isoDate(p[4]),
      amount:     round2(debit - credit),          // signed: debit +, credit -
      liv_doc:    internal.startsWith('5149') ? p[7].trim() : '',
      line_type:  classifyLine(p[9], p[3]),
      vendor_text: p[9].trim(),
      delivery_ref: p[10].trim(),                  // 5181* -> GR join
      vendor_no:   p[11].trim(),                   // 1000* / MA15
      vendor_name: p[12].trim(),
      source: p.length === 14 ? p[13].trim() : 'NATIVE',
    });
  }

  // ---- integrity before anything touches D1 ----
  const net = round2(lines.reduce((s, l) => s + l.amount, 0));
  const payments = round2(lines.filter(l => l.doc_number.startsWith('1400'))
                               .reduce((s, l) => s + l.amount, 0));
  const totalDue = round2(net - payments);
  const stats = { rowCount: lines.length, net, payments, totalDue, checks: [] };

  if (header.total_due_printed !== null &&
      Math.abs(totalDue - header.total_due_printed) >= 0.005) {
    stats.checks.push(`total due mismatch: computed ${totalDue} vs printed ${header.total_due_printed}`);
  }
  if (header.opening_balance !== null && header.closing_balance !== null &&
      Math.abs(round2(header.opening_balance + net) - header.closing_balance) >= 0.005) {
    stats.checks.push(`balance mismatch: opening+net != closing`);
  }
  if (stats.checks.length) throw new Error('integrity failed: ' + stats.checks.join('; '));

  // derive figures the header table wants (native files carry none)
  header.total_due = totalDue;
  header.payment = payments;
  if (header.closing_balance === null && header.opening_balance !== null) {
    header.closing_balance = round2(header.opening_balance + net);
  }
  return { header, lines, stats };
}

// Existing type classifier pattern: explicit types pass through, everything
// else buckets by keyword so Bonus Buy refs don't explode into 400 "types".
export function classifyLine(vendorText, reference) {
  const v = vendorText.trim();
  if (v.startsWith('*Invoice reduction')) return 'INVOICE_REDUCTION';
  if (v.startsWith('*Invoice'))           return 'INVOICE';
  if (v.startsWith('*Credit Note'))       return 'CREDIT_NOTE';
  const r = reference.toUpperCase();
  if (r.startsWith('PAYMENT'))            return 'PAYMENT';
  if (r.includes('SWELL'))                return 'SWELL';
  if (r.startsWith('BB'))                 return 'BONUS_BUY';
  if (r.includes('SALLY') || r.includes('TALLY')) return 'REBATE';
  if (r.includes('FRANCHISE'))            return 'FRANCHISE_FEE';
  if (r.includes('LOYALTY'))              return 'LOYALTY';
  if (r.includes('PROMO'))                return 'PROMO';
  if (r.includes('FUNDING') || r.includes('SALLIES')) return 'FUNDING';
  return 'OTHER';
}

// Replace-on-reload: same statement_no wipes prior lines first, so a native
// CSV found later upgrades a PDF load in place. Downgrade (PDF over NATIVE)
// is refused unless force=true.
export async function persistStatement(db, header, lines, { force = false } = {}) {
  const existing = await db.prepare(
    'SELECT source FROM statements WHERE statement_no = ?'
  ).bind(header.statement_no).first();

  if (existing && existing.source === 'NATIVE' && header.source === 'PDF' && !force) {
    throw new Error(
      `statement ${header.statement_no} already loaded from NATIVE csv; ` +
      `refusing PDF downgrade (pass force=true to override)`);
  }

  const stmts = [
    db.prepare('DELETE FROM statement_lines WHERE statement_no = ?')
      .bind(header.statement_no),
    db.prepare('DELETE FROM statements WHERE statement_no = ?')
      .bind(header.statement_no),
    db.prepare(`INSERT INTO statements
        (statement_no, account, statement_date, period_start, cut_off, due_date,
         total_due, payment, closing_balance, opening_balance, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(header.statement_no, header.account, header.statement_date,
            header.period_start, header.cut_off, header.due_date,
            header.total_due, header.payment, header.closing_balance,
            header.opening_balance, header.source),
  ];
  for (const l of lines) {
    stmts.push(db.prepare(`INSERT INTO statement_lines
        (statement_no, doc_number, internal_no, reference, doc_date, amount,
         liv_doc, line_type, vendor_text, delivery_ref, vendor_no, vendor_name, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(l.statement_no, l.doc_number, l.internal_no, l.reference, l.doc_date,
            l.amount, l.liv_doc, l.line_type, l.vendor_text, l.delivery_ref,
            l.vendor_no, l.vendor_name, l.source));
  }
  // ~600-700 rows: one batch, no chunking needed (unlike PO loads)
  await db.batch(stmts);
  return { replaced: !!existing, previousSource: existing?.source ?? null };
}

function isoDate(yyyymmdd) {
  const s = yyyymmdd.trim();
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
function round2(n) { return Math.round(n * 100) / 100; }

```

## Step 3 — Browser engine module

Add `statement-pdf.js` wherever static frontend JS lives, served at a stable
path (e.g. `/js/statement-pdf.js`). It has no DOM and no fetch — keep it that
way (engine/UI separation).

```javascript
// ============================================================================
// statement-pdf.js — browser-side PnP statement PDF parser (PO Monitor)
//
// Converts an account-statement PDF into the SAME {header, lines, stats}
// shape that parseStatementCsv() produces, so both upload paths converge on
// one ingest endpoint / persistStatement().
//
// Engine/UI split maintained: this module has NO DOM and NO fetch. The page
// wires it:
//
//   <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs" type="module"></script>
//   pdfjsLib.GlobalWorkerOptions.workerSrc =
//     'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
//
//   const buf = await file.arrayBuffer();
//   const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
//   const pageLines = await extractPageLines(pdf);
//   const result = parseStatementPdf(pageLines);   // throws on any validation failure
//   // POST result to the statement ingest route (JSON body), or serialise
//   // with toCanonicalCsv(result) and reuse the existing CSV upload as-is.
//
// Validation (all must pass or it throws — nothing partial reaches D1):
//   1. running SubTotal chain reproduces every printed subtotal (from 0)
//   2. opening + net movement == printed closing balance
//   3. net excl. payments == printed "Total amount due"
// ============================================================================

const AMT = /^\d[\d,]*\.\d{2}-?$/;
const LINE = /^\s*(\d{10})(\*?)\s+(\d{2}\.\d{2}\.\d{2})\s+(.*)$/;

// ---- pdf.js text items -> ordered text lines per page ---------------------
export async function extractPageLines(pdf) {
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    // group items by y (2pt tolerance), sort each row by x, join
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 2) * 2;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0]) // top of page first (pdf y grows upward)
      .map(([, frags]) => frags.sort((a, b) => a.x - b.x).map(f => f.s).join(' ')
        .replace(/\s+/g, ' ').trim());
    pages.push(lines);
  }
  return pages;
}

// ---- main parse ------------------------------------------------------------
export function parseStatementPdf(pageLines) {
  const meta = {};
  const lines = [];

  for (const page of pageLines) {
    for (const raw of page) {
      let m;
      if ((m = raw.match(/Cut-off date\s+(\d{2}\.\d{2}\.\d{2})\s+Statement\s+(\d+)/)))
        { meta.cutoff = m[1]; meta.stmt = m[2]; }
      if ((m = raw.match(/Due date\s+(\d{2}\.\d{2}\.\d{2})/)) && !meta.due)
        meta.due = m[1];
      if ((m = raw.match(/Bal\.carried fwd\.\s+\d{2}\.\d{2}\.\d{2}\s*:\s+([\d,]+\.\d{2}-?)/)))
        meta.opening = dec(m[1]);
      if ((m = raw.match(/Closing balance\s+\d{2}\.\d{2}\.\d{2}\s*:\s+([\d,]+\.\d{2}-?)/)))
        meta.closing = dec(m[1]);
      if ((m = raw.match(/Total amount due for statement\s+([\d,]+\.\d{2}-?)/)))
        meta.totalDue = dec(m[1]);
      if ((m = raw.match(/Your account with us\s+(NF\d+)/)) && !meta.account)
        meta.account = m[1];

      const lm = raw.match(LINE);
      if (!lm) continue;
      const [, doc, , date] = lm;
      const toks = raw.split(' ');
      let amtTok = null, subTok = null, pre = [], post = [];
      const zi = toks.indexOf('ZAR');
      if (zi !== -1) {
        amtTok = toks[zi + 1];
        subTok = zi + 2 < toks.length && AMT.test(toks[zi + 2]) ? toks[zi + 2] : null;
        pre = toks.slice(2, zi);
        post = toks.slice(subTok ? zi + 3 : zi + 2);
      } else {
        const amts = toks.filter(t => AMT.test(t));
        if (amts.length < 2) continue;           // header echo / noise line
        amtTok = amts[0]; subTok = amts[1];
        const ai = toks.indexOf(amtTok);
        pre = toks.slice(2, ai);
        post = toks.slice(ai + 2);
      }
      if (!amtTok || !AMT.test(amtTok)) continue;
      lines.push({ doc, date, ref: pre.join(' '), amount: dec(amtTok),
                   subtotal: subTok ? dec(subTok) : null, tail: post });
    }
  }

  if (!meta.stmt) throw new Error('statement number not found — is this a PnP account statement PDF?');
  if (meta.opening == null) throw new Error('opening balance not found');

  // ---- validation ----
  const errs = [];
  let run = 0;
  lines.forEach((l, i) => {
    run = r2(run + l.amount);
    if (l.subtotal !== null && Math.abs(run - l.subtotal) >= 0.005) {
      errs.push(`subtotal chain breaks at line ${i + 1} doc ${l.doc}: computed ${run} printed ${l.subtotal}`);
      run = l.subtotal;
    }
  });
  const net = r2(lines.reduce((s, l) => s + l.amount, 0));
  const payments = r2(lines.filter(l => l.doc.startsWith('1400')).reduce((s, l) => s + l.amount, 0));
  if (meta.closing != null && Math.abs(r2(meta.opening + net) - meta.closing) >= 0.005)
    errs.push(`opening ${meta.opening} + net ${net} != closing ${meta.closing}`);
  if (meta.totalDue != null && Math.abs(r2(net - payments) - meta.totalDue) >= 0.005)
    errs.push(`net excl payments ${r2(net - payments)} != total due ${meta.totalDue}`);
  if (errs.length) throw new Error('PDF validation failed:\n' + errs.join('\n'));

  // ---- map to ingest shape (mirrors parseStatementCsv output) ----
  const cutoffIso = ddmmyy(meta.cutoff);
  const header = {
    statement_no: meta.stmt,
    account: meta.account || 'NF16',
    statement_date: cutoffIso,               // PDF run date not always on p1 text layer; cutoff is the operative date
    period_start: addDays(cutoffIso, -6),
    cut_off: cutoffIso,
    due_date: ddmmyy(meta.due),
    opening_balance: meta.opening,
    closing_balance: meta.closing ?? r2(meta.opening + net),
    total_due: r2(net - payments),
    payment: payments,
    source: 'PDF',
  };

  const outLines = lines.map(l => {
    const is5149 = l.doc.startsWith('5149');
    let vendorNo = '', vendorName = '', delRef = '', livRef = '';
    if (is5149) {
      const t = [...l.tail];
      if (t.length >= 2 && /^\d{10}$/.test(t[t.length - 1]) && /^\d{10}$/.test(t[t.length - 2])) {
        livRef = t.pop(); delRef = t.pop();
      }
      if (t.length && (/^\d{10}$/.test(t[0]) || t[0] === 'MA15')) vendorNo = t.shift();
      vendorName = t.join(' ');
    }
    const vendorText = is5149 ? (l.amount > 0 ? '*Invoice' : '*Credit Note') : l.tail.join(' ');
    return {
      statement_no: meta.stmt,
      doc_number: l.doc,
      internal_no: '',
      reference: l.ref,
      doc_date: ddmmyy(l.date),
      amount: l.amount,
      liv_doc: is5149 ? livRef : '',
      line_type: classify(vendorText, l.ref),
      vendor_text: vendorText,
      delivery_ref: delRef,
      vendor_no: vendorNo,
      vendor_name: vendorName,
      source: 'PDF',
    };
  });

  return {
    header,
    lines: outLines,
    stats: { rowCount: outLines.length, net, payments, totalDue: header.total_due, checks: [] },
  };
}

// Same classifier as statement-ingest.js — keep in lockstep.
function classify(vendorText, reference) {
  const v = vendorText.trim();
  if (v.startsWith('*Invoice reduction')) return 'INVOICE_REDUCTION';
  if (v.startsWith('*Invoice'))           return 'INVOICE';
  if (v.startsWith('*Credit Note'))       return 'CREDIT_NOTE';
  const r = reference.toUpperCase();
  if (r.startsWith('PAYMENT'))            return 'PAYMENT';
  if (r.includes('SWELL'))                return 'SWELL';
  if (r.startsWith('BB'))                 return 'BONUS_BUY';
  if (r.includes('SALLY') || r.includes('TALLY')) return 'REBATE';
  if (r.includes('FRANCHISE'))            return 'FRANCHISE_FEE';
  if (r.includes('LOYALTY'))              return 'LOYALTY';
  if (r.includes('PROMO'))                return 'PROMO';
  if (r.includes('FUNDING') || r.includes('SALLIES')) return 'FUNDING';
  return 'OTHER';
}

function dec(tok) {
  const neg = tok.endsWith('-');
  const n = Number(tok.replace(/-$/, '').replace(/,/g, ''));
  return neg ? -n : n;
}
function r2(n) { return Math.round(n * 100) / 100; }
function ddmmyy(s) {
  const [d, m, y] = s.split('.');
  return `20${y}-${m}-${d}`;
}
function addDays(iso, days) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

```

## Step 4 — Wiring (route + upload control + UI touches)

Reference implementation — adapt route names, toast helper, and list-refresh
calls to the app's existing conventions:

```javascript
// ============================================================================
// WIRING — how the two modules plug into the existing app
// (adapt names to your routes; logic is complete)
// ============================================================================

// ----------------------------------------------------------------------------
// 1. FRONTEND — statements screen upload control
//    One <input> accepts both formats; route by extension. pdf.js loads
//    lazily from cdnjs only when a PDF is actually chosen, so the normal
//    CSV path costs nothing.
// ----------------------------------------------------------------------------
// <input type="file" id="stmt-file" accept=".csv,.pdf">

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

document.getElementById('stmt-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    let payload;
    if (/\.pdf$/i.test(file.name)) {
      const pdfjsLib = await import(PDFJS);
      pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      const { extractPageLines, parseStatementPdf } = await import('/js/statement-pdf.js');
      const pdf = await pdfjsLib.getDocument({
        data: new Uint8Array(await file.arrayBuffer()),
      }).promise;
      payload = parseStatementPdf(await extractPageLines(pdf)); // throws if any check fails
    } else {
      // CSV: send raw, Worker parses (existing path). Read as latin1.
      const text = new TextDecoder('latin1').decode(await file.arrayBuffer());
      payload = { csv: text };
    }
    const res = await fetch('/api/statement-uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || res.statusText);
    toast(`Statement ${out.statement_no} loaded (${out.rowCount} lines, ${out.source})` +
          (out.replaced ? ` — replaced previous ${out.previousSource} load` : '') +
          (out.chain === 'BREAK' ? ` — WARNING: opening balance does not tie to prior week` : ''));
    refreshStatementsList();
  } catch (err) {
    toast('Statement load failed: ' + err.message, 'error');
  } finally {
    e.target.value = '';
  }
});

// ----------------------------------------------------------------------------
// 2. WORKER — single route, both formats converge here
// ----------------------------------------------------------------------------
import { parseStatementCsv, persistStatement } from './statement-ingest.js';

async function handleStatementUpload(request, env) {
  const body = await request.json();

  // Either shape: { csv: "..." } from a native file, or a pre-parsed
  // { header, lines, stats } object from the browser PDF parser.
  const parsed = body.csv ? parseStatementCsv(body.csv) : body;

  // minimal shape guard on the pre-parsed variant
  if (!parsed.header?.statement_no || !Array.isArray(parsed.lines) || parsed.lines.length === 0) {
    return json({ error: 'invalid statement payload' }, 400);
  }
  // server-side re-check regardless of source (never trust the client sums)
  const net = r2(parsed.lines.reduce((s, l) => s + l.amount, 0));
  const pay = r2(parsed.lines.filter(l => l.doc_number.startsWith('1400'))
                             .reduce((s, l) => s + l.amount, 0));
  if (Math.abs(r2(net - pay) - parsed.header.total_due) >= 0.005) {
    return json({ error: 'server integrity check failed: total_due does not tie to lines' }, 422);
  }

  const force = new URL(request.url).searchParams.get('force') === '1';
  let persisted;
  try {
    persisted = await persistStatement(env.DB, parsed.header, parsed.lines, { force });
  } catch (err) {
    return json({ error: err.message }, 409); // e.g. PDF-over-NATIVE downgrade refusal
  }

  // chain continuity (view added by the migration)
  const chain = await env.DB.prepare(
    'SELECT chain_status, chain_gap FROM v_statement_chain WHERE statement_no = ?'
  ).bind(parsed.header.statement_no).first();

  return json({
    statement_no: parsed.header.statement_no,
    rowCount: parsed.lines.length,
    source: parsed.header.source,
    total_due: parsed.header.total_due,
    closing_balance: parsed.header.closing_balance,
    replaced: persisted.replaced,
    previousSource: persisted.previousSource,
    chain: chain?.chain_status ?? 'UNKNOWN',
    chain_gap: chain?.chain_gap ?? null,
  });
}

const r2 = n => Math.round(n * 100) / 100;
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

// ----------------------------------------------------------------------------
// 3. STATEMENTS LIST — source badge + net-only indicator
// ----------------------------------------------------------------------------
// In the row template:
//   <span class="badge ${s.source === 'PDF' ? 'badge-pdf' : 'badge-native'}">${s.source}</span>
// In the settlement drill-down, when statement_lines.source === 'PDF':
//   show "net line (converted from PDF — invoice/reduction split not available)"
//   instead of rendering an empty reduction breakdown.
// CSS: .badge-pdf { background:#2E6CA8; } .badge-native { background:#0B3D6B; }

```

UI requirements:
- One `<input type="file" accept=".csv,.pdf">` on the statements screen.
- pdf.js must load **lazily** (dynamic import from
  https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/) only when a PDF is
  chosen — the CSV path must not pay for it.
- Statements list: source badge per row (`NATIVE` navy #0B3D6B, `PDF` mid
  #2E6CA8, existing brand palette).
- Settlement drill-down: when `statement_lines.source = 'PDF'`, show
  "net line (converted from PDF — invoice/reduction split not available)"
  instead of an empty invoice/reduction breakdown.
- Surface `chain: BREAK` from the upload response as a warning toast — it
  means the statement's opening balance does not tie to the prior week's
  closing (missing/corrupt statement in the sequence).
- Wire click handlers with event delegation on a stable parent
  (`e.target.closest('[data-nav]')`) — tile listeners have previously been
  wiped by `innerHTML` reassignment during render cycles in this app.

## Hard requirements (do not skip)

1. CSV bodies MUST be decoded as **latin1** (`new TextDecoder('latin1')`),
   never utf-8 — the files contain 0xA0 padding bytes that break utf-8.
2. The Worker MUST re-verify totals server-side even for browser-parsed PDF
   payloads (never trust client sums). This check is already in the route
   code above — keep it.
3. `persistStatement` replace semantics: re-upload of the same statement_no
   deletes and reloads; a NATIVE upload may replace a PDF load; a PDF upload
   must be REFUSED over an existing NATIVE load unless `?force=1`.
4. Insert all lines in a single `db.batch()` — ~700 rows, no chunking.
5. Do not modify or regress any existing route, screen, or the open-items
   matching logic. The matcher keys on doc totals and LIV refs, which both
   sources provide identically.

## Verification (must pass before you're done)

Test files are in the project knowledge / user's possession:
`202717.PDF` and `NF16_202717.csv` (the same statement in both formats).

1. `npm run typecheck` clean.
2. Upload `202717.PDF` through the UI. Expected exactly:
   - 606 lines, source PDF
   - net movement −569,950.34, payments −2,600,000.00
   - total due 2,030,049.66, closing balance 13,424,531.43
   - due date 2026-07-27, period 2026-06-22 → 2026-06-28
3. Upload `NF16_202717.csv`. Expected: 672 lines, source NATIVE, same
   total due / net; response reports `replaced: true, previousSource: "PDF"`.
4. Attempt the PDF again WITHOUT force → 409 refusal (downgrade guard).
5. Query check — doc-level totals identical regardless of source:
   `SELECT COUNT(DISTINCT doc_number) FROM statement_lines WHERE statement_no='202717'`
   must return 211.
6. Deploy, then repeat test 2 against the live URL.

If any figure differs, stop and report the discrepancy — do not adjust the
expected values to match.

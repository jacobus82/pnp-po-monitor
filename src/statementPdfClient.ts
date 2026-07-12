// ============================================================================
// statementPdfClient.ts — holds the browser-side PnP statement PDF parser as a
// string, served verbatim at GET /js/statement-pdf.js (see index.ts router).
//
// The app ships all its client code inline, so there is no static-asset
// pipeline; this route is how the browser gets an importable ES module:
//   const { extractPageLines, parseStatementPdf } = await import('/js/statement-pdf.js');
//
// The module below converts an account-statement PDF into the SAME
// {header, lines, stats} shape parseStatementCsv() produces, so both upload
// paths converge on one ingest route / persistStatement().
//
// Engine/UI split maintained: NO DOM, NO fetch. The statements page wires it
// (lazy pdf.js import from cdnjs 4.10.38). Validation is all-or-nothing — the
// parser throws on any of: subtotal-chain break, opening+net != closing, or
// net-excl-payments != printed total due. Nothing partial reaches D1.
//
// String.raw keeps the regex backslashes (\d \s \.) intact; the module source
// is deliberately free of backticks and ${ so it needs no escaping.
// ============================================================================

export const STATEMENT_PDF_JS = String.raw`
const AMT = /^\d[\d,]*\.\d{2}-?$/;
// Transaction line = 10-digit doc, then the date. Newer statements print a space
// after the optional "*" marker ("1400009959* 24.06.26"); older ones glue the "*"
// straight onto the date with no space ("1400007733*19.05.25"), which the old
// "(\*?)\s+" required-whitespace form silently dropped — losing payment (1400*)
// and interest (1800*) lines and breaking the balance check. Accept EITHER form:
// a "*" (optionally followed by space) OR mandatory whitespace. This is additive —
// it never matches a bare digits-abut-date run with neither a "*" nor a space, and
// the amount regex is untouched. Groups unchanged: 1=doc, 3=date.
const LINE = /^\s*(\d{10})(?:(\*)\s*|\s+)(\d{2}\.\d{2}\.\d{2})\s+(.*)$/;

export async function extractPageLines(pdf) {
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] / 2) * 2;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: it.transform[4], s: it.str });
    }
    const lines = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(function (e) {
        return e[1].sort((a, b) => a.x - b.x).map((f) => f.s).join(' ').replace(/\s+/g, ' ').trim();
      });
    pages.push(lines);
  }
  return pages;
}

export function parseStatementPdf(pageLines) {
  const meta = {};
  const lines = [];
  for (const page of pageLines) {
    for (const raw of page) {
      let m;
      // Header dates: most statements print a 2-digit year (20.07.25), but some
      // older ones use a 4-digit year in the header block (Cut-off / Due date /
      // Bal.carried) while the closing line and every transaction line stay
      // 2-digit. Accept both (\d{2,4} year); ddmmyy() normalises either form.
      if ((m = raw.match(/Cut-off date\s+(\d{2}\.\d{2}\.\d{2,4})\s+Statement\s+(\d+)/)))
        { meta.cutoff = m[1]; meta.stmt = m[2]; }
      if ((m = raw.match(/Due date\s+(\d{2}\.\d{2}\.\d{2,4})/)) && !meta.due)
        meta.due = m[1];
      if ((m = raw.match(/Bal\.carried fwd\.\s+\d{2}\.\d{2}\.\d{2,4}\s*:\s+([\d,]+\.\d{2}-?)/)))
        meta.opening = dec(m[1]);
      if ((m = raw.match(/Closing balance\s+\d{2}\.\d{2}\.\d{2,4}\s*:\s+([\d,]+\.\d{2}-?)/)))
        meta.closing = dec(m[1]);
      if ((m = raw.match(/Total amount due for statement\s+([\d,]+\.\d{2}-?)/)))
        meta.totalDue = dec(m[1]);
      if ((m = raw.match(/Your account with us\s+(NF\d+)/)) && !meta.account)
        meta.account = m[1];

      const lm = raw.match(LINE);
      if (!lm) continue;
      const doc = lm[1], date = lm[3];
      const toks = raw.split(' ');
      let amtTok = null, subTok = null, pre = [], post = [];
      const zi = toks.indexOf('ZAR');
      if (zi !== -1) {
        amtTok = toks[zi + 1];
        subTok = zi + 2 < toks.length && AMT.test(toks[zi + 2]) ? toks[zi + 2] : null;
        pre = toks.slice(2, zi);
        post = toks.slice(subTok ? zi + 3 : zi + 2);
      } else {
        const amts = toks.filter((t) => AMT.test(t));
        if (amts.length < 2) continue;
        amtTok = amts[0]; subTok = amts[1];
        const ai = toks.indexOf(amtTok);
        pre = toks.slice(2, ai);
        post = toks.slice(ai + 2);
      }
      if (!amtTok || !AMT.test(amtTok)) continue;
      lines.push({ doc: doc, date: date, ref: pre.join(' '), amount: dec(amtTok),
                   subtotal: subTok ? dec(subTok) : null, tail: post });
    }
  }

  if (!meta.stmt) throw new Error('statement number not found - is this a PnP account statement PDF?');
  if (meta.opening == null) throw new Error('opening balance not found');

  const errs = [];
  let run = 0;
  lines.forEach(function (l, i) {
    run = r2(run + l.amount);
    if (l.subtotal !== null && Math.abs(run - l.subtotal) >= 0.005) {
      errs.push('subtotal chain breaks at line ' + (i + 1) + ' doc ' + l.doc + ': computed ' + run + ' printed ' + l.subtotal);
      run = l.subtotal;
    }
  });
  const net = r2(lines.reduce((s, l) => s + l.amount, 0));
  const payments = r2(lines.filter((l) => l.doc.startsWith('1400')).reduce((s, l) => s + l.amount, 0));
  if (meta.closing != null && Math.abs(r2(meta.opening + net) - meta.closing) >= 0.005)
    errs.push('opening ' + meta.opening + ' + net ' + net + ' != closing ' + meta.closing);
  if (meta.totalDue != null && Math.abs(r2(net - payments) - meta.totalDue) >= 0.005)
    errs.push('net excl payments ' + r2(net - payments) + ' != total due ' + meta.totalDue);
  if (errs.length) throw new Error('PDF validation failed:\n' + errs.join('\n'));

  const cutoffIso = ddmmyy(meta.cutoff);
  const header = {
    statement_no: meta.stmt,
    account: meta.account || 'NF16',
    statement_date: cutoffIso,
    period_start: addDays(cutoffIso, -6),
    cut_off: cutoffIso,
    due_date: ddmmyy(meta.due),
    opening_balance: meta.opening,
    closing_balance: meta.closing != null ? meta.closing : r2(meta.opening + net),
    total_due: r2(net - payments),
    payment: payments,
    source: 'PDF',
  };

  const outLines = lines.map(function (l) {
    const is5149 = l.doc.startsWith('5149');
    let vendorNo = '', vendorName = '', delRef = '', livRef = '';
    if (is5149) {
      const t = l.tail.slice();
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
    header: header,
    lines: outLines,
    stats: { rowCount: outLines.length, net: net, payments: payments, totalDue: header.total_due, checks: [] },
  };
}

function classify(vendorText, reference) {
  const v = vendorText.trim();
  if (v.startsWith('*Invoice reduction')) return 'INVOICE_REDUCTION';
  if (v.startsWith('*Invoice')) return 'INVOICE';
  if (v.startsWith('*Credit Note')) return 'CREDIT_NOTE';
  const r = reference.toUpperCase();
  if (r.startsWith('PAYMENT')) return 'PAYMENT';
  if (r.includes('SWELL')) return 'SWELL';
  if (r.startsWith('BB')) return 'BONUS_BUY';
  if (r.includes('SALLY') || r.includes('TALLY')) return 'REBATE';
  if (r.includes('FRANCHISE')) return 'FRANCHISE_FEE';
  if (r.includes('LOYALTY')) return 'LOYALTY';
  if (r.includes('PROMO')) return 'PROMO';
  if (r.includes('FUNDING') || r.includes('SALLIES')) return 'FUNDING';
  return 'OTHER';
}

function dec(tok) { const neg = tok.endsWith('-'); const n = Number(tok.replace(/-$/, '').replace(/,/g, '')); return neg ? -n : n; }
function r2(n) { return Math.round(n * 100) / 100; }
function ddmmyy(s) { const parts = s.split('.'); const y = parts[2].length === 4 ? parts[2] : '20' + parts[2]; return y + '-' + parts[1] + '-' + parts[0]; }
function addDays(iso, days) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
`;

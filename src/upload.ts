/**
 * Self-contained file-upload page (no build step, no external assets).
 * Served at GET /upload. Provides drag-and-drop ingestion for the three file
 * types (SAP PO export, GR report, FIM report), each posting to its API
 * endpoint, with live progress and a parsed-result summary.
 */
export const UPLOAD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
<meta http-equiv="Pragma" content="no-cache" />
<meta http-equiv="Expires" content="0" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0055a5" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<title>Upload files — PO Monitor — Pick n Pay Lydenburg</title>
<style>
  :root {
    --pnp-blue: #0055a5; --pnp-red: #e2231a;
    --green: #1a8a3f; --amber: #d8a400; --orange: #e06f00; --red: #c0291f;
    --ink: #1c2530; --muted: #66707a; --line: #e4e8ec; --bg: #f4f6f8; --card: #fff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--ink); background: var(--bg); }
  header { background: var(--pnp-blue); color: #fff; padding: 16px 24px;
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; }
  header .title { font-size: 18px; font-weight: 700; }
  header .title small { display: block; font-weight: 400; font-size: 12px; opacity: .85; }
  a.navlink { display:inline-block; background: rgba(255,255,255,.15); color:#fff; text-decoration:none;
    border:1px solid rgba(255,255,255,.4); border-radius:6px; padding:6px 12px; font-size:12px; }
  a.navlink:hover { background: rgba(255,255,255,.28); }
  main { padding: 20px; max-width: 1100px; margin: 0 auto; }
  .intro { color: var(--muted); margin: 0 0 16px; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.03); display: flex; flex-direction: column; }
  .card h2 { margin: 0 0 4px; font-size: 15px; }
  .fmt { color: var(--muted); font-size: 12px; margin: 0 0 12px; }
  .fmt code { background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; font-size: 11px; }
  .zone { border: 2px dashed #c4ccd4; border-radius: 10px; padding: 22px 14px; text-align: center;
    cursor: pointer; transition: border-color .15s, background .15s; background: #fbfcfd; outline: none; }
  .zone:hover, .zone:focus-visible { border-color: var(--pnp-blue); background: #f2f7fc; }
  .zone.drag { border-color: var(--pnp-blue); background: #e9f2fb; }
  .zone .ic { font-size: 26px; line-height: 1; }
  .zone .big { font-weight: 600; margin-top: 6px; }
  .zone .link { color: var(--pnp-blue); text-decoration: underline; }
  .zone .hint { color: var(--muted); font-size: 11px; margin-top: 4px; }
  .zone .mob { display: none; }
  .last { font-size: 12px; color: var(--muted); margin-top: 10px; }
  .last b { color: var(--ink); font-weight: 600; }
  .progress { margin-top: 12px; }
  .progress .ptext { font-size: 12px; color: var(--muted); margin-bottom: 5px; }
  .bar2 { height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; }
  .bar2 > i { display: block; height: 100%; width: 0; background: var(--pnp-blue); transition: width .15s; }
  .bar2.indet { position: relative; }
  .bar2.indet > i { width: 38%; animation: slide 1.05s infinite linear; }
  @keyframes slide { 0% { margin-left: -40%; } 100% { margin-left: 102%; } }
  .result { margin-top: 12px; font-size: 13px; }
  .result:empty { display: none; }
  .result .ok { color: var(--green); font-weight: 700; margin-bottom: 8px; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
  .stat { background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; min-width: 84px; }
  .stat .v { font-size: 17px; font-weight: 700; }
  .stat .v.flag { color: var(--orange); }
  .stat .l { font-size: 10px; text-transform: uppercase; letter-spacing: .03em; color: var(--muted); }
  table.mini { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  table.mini th, table.mini td { padding: 5px 7px; border-bottom: 1px solid var(--line); text-align: left; }
  table.mini th { color: var(--muted); font-size: 10px; text-transform: uppercase; }
  table.mini td.num, table.mini th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .small { font-size: 12px; }
  .muted { color: var(--muted); }
  .box { border-radius: 8px; padding: 10px 12px; margin-top: 4px; font-size: 13px; }
  .box.err { background: #fdecea; color: #8a1c14; }
  .box.warn { background: #fff8e6; color: #7a5b00; }
  .box .bt { font-weight: 700; display: block; margin-bottom: 2px; }
  .warn-list { background: #fff8e6; color: #7a5b00; border-radius: 8px; padding: 8px 10px; margin-top: 8px; font-size: 12px; }
  .sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
  table.hist-t { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 10px; }
  table.hist-t th, table.hist-t td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  table.hist-t th { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; }
  table.hist-t td.num, table.hist-t th.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.hist-t tr.sel { background: #eef4fb; }
  .kindtag { display:inline-block; padding:1px 7px; border-radius:999px; font-size:10px; font-weight:700; color:#fff; }
  .k-po{background:var(--pnp-blue)} .k-gr{background:#1a8a3f} .k-fim{background:#6b46c1} .k-cc{background:#0d9488} .k-fs{background:#d97706}
  button.btnsm { background: var(--pnp-blue); color:#fff; border:0; border-radius:6px; padding:6px 11px; cursor:pointer; font-size:12px; }
  button.btnsm:hover { filter: brightness(1.08); }
  button.btnsm.danger { background: var(--pnp-red); }
  button.icondel { background:none; border:0; color:var(--pnp-red); cursor:pointer; font-size:14px; padding:2px 6px; border-radius:5px; }
  button.icondel:hover { background:#fdecea; }
  .delresult { margin-top:8px; font-size:12px; }
  .bsum { font-size:13px; }
  .bsum .ok { color: var(--green); font-weight:700; margin-bottom:6px; }
  .bsum details { margin-top:5px; }
  .bsum summary { cursor:pointer; font-weight:600; }
  .bsum .bfail summary { color: var(--pnp-red); }
  .bsum .bskip summary { color: var(--orange); }
  .bsum ul { margin:5px 0 0; padding-left:20px; font-size:12px; color: var(--muted); }
  @media (max-width: 760px) {
    body { font-size: 15px; }
    main { padding: 14px; }
    .grid { grid-template-columns: 1fr; gap: 14px; }   /* stack upload tiles */
    .zone { padding: 34px 14px; min-height: 132px; display:flex; flex-direction:column; justify-content:center; }
    .zone .ic { font-size: 34px; }
    .zone .big { font-size: 16px; }
    .zone .desk { display: none; }
    .zone .mob { display: inline; }
    .progress, .bar2, .result { width: 100%; }
    table.hist-t { display:block; overflow-x:auto; -webkit-overflow-scrolling:touch; white-space:nowrap; }
    button.btnsm, .zone { min-height: 44px; }
  }
</style>
</head>
<body>
<header>
  <div class="title">Upload files <small id="storeLine">Pick n Pay Lydenburg</small></div>
  <a class="navlink" href="/">&larr; Back to dashboard</a>
</header>
<main>
  <p class="intro">Drag a file onto a tile (or click to browse) to ingest it. The raw file is archived
    in R2 and parsed into D1; any anomalies are flagged automatically.</p>
  <div class="grid" id="grid">

    <section class="card" data-kind="sap">
      <h2>SAP PO Export</h2>
      <p class="fmt">Purchasing-document export (ME2M / ME2L). Accepted: <code>.tsv</code> <code>.csv</code>
        <code>.txt</code> — delimiter auto-detected. Any filename.</p>
      <div class="zone" tabindex="0" role="button"
           aria-label="SAP PO export drop zone. Drag a file here, or press Enter to browse.">
        <div class="ic" aria-hidden="true">&#128228;</div>
        <div class="big"><span class="mob">Tap to </span><span class="desk">Drag &amp; drop or </span><span class="link">browse</span><span class="mob"> files</span></div>
        <div class="hint">.tsv / .csv / .txt</div>
      </div>
      <input type="file" class="file sr" multiple accept=".tsv,.csv,.txt,.htm,.html,.xlsx,text/plain" aria-hidden="true" tabindex="-1" />
      <div class="last">Last upload: <span class="last-val"><b>—</b></span></div>
      <div class="progress" hidden role="status" aria-live="polite">
        <div class="ptext">Uploading&hellip;</div>
        <div class="bar2" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      </div>
      <div class="result" aria-live="polite"></div>
    </section>

    <section class="card" data-kind="gr">
      <h2>GR Report</h2>
      <p class="fmt">Goods-receipt export with department, cost, sell &amp; margin. Accepted:
        <code>.csv</code> <code>.tsv</code> — delimiter auto-detected.
        <strong>Any SAP default filename accepted — no renaming needed.</strong></p>
      <div class="zone" tabindex="0" role="button"
           aria-label="GR report drop zone. Drag a file here, or press Enter to browse.">
        <div class="ic" aria-hidden="true">&#128230;</div>
        <div class="big"><span class="mob">Tap to </span><span class="desk">Drag &amp; drop or </span><span class="link">browse</span><span class="mob"> files</span></div>
        <div class="hint">.csv / .tsv</div>
      </div>
      <input type="file" class="file sr" multiple accept=".csv,.tsv,.txt,.xlsx,text/csv" aria-hidden="true" tabindex="-1" />
      <div class="last">Last upload: <span class="last-val"><b>—</b></span></div>
      <div class="progress" hidden role="status" aria-live="polite">
        <div class="ptext">Uploading&hellip;</div>
        <div class="bar2" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      </div>
      <div class="result" aria-live="polite"></div>
    </section>

    <section class="card" data-kind="eod">
      <h2>EOD Movements</h2>
      <p class="fmt">Weekly End-of-Day Movements Report — goods receipts, returns &amp; LIV settlement.
        Accepts <code>.txt</code> (tab-delimited) or <code>.htm</code> — <strong>any SAP export
        filename accepted, no renaming needed.</strong> Powers the Settlement (GR&nbsp;&#8596;&nbsp;statement) screen.</p>
      <div class="zone" tabindex="0" role="button"
           aria-label="EOD movements drop zone. Drag a file here, or press Enter to browse.">
        <div class="ic" aria-hidden="true">&#128184;</div>
        <div class="big"><span class="mob">Tap to </span><span class="desk">Drag &amp; drop or </span><span class="link">browse</span><span class="mob"> files</span></div>
        <div class="hint">.txt / .htm</div>
      </div>
      <input type="file" class="file sr" multiple accept=".txt,.htm,.html,text/plain" aria-hidden="true" tabindex="-1" />
      <div class="last">Last upload: <span class="last-val"><b>—</b></span></div>
      <div class="progress" hidden role="status" aria-live="polite">
        <div class="ptext">Uploading&hellip;</div>
        <div class="bar2" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      </div>
      <div class="result" aria-live="polite"></div>
    </section>

    <section class="card" data-kind="fim">
      <h2>FIM Report</h2>
      <p class="fmt">Daily / weekly / monthly department financials. Accepts <code>.xlsx</code> or <code>.csv</code>
        — <strong>any SAP export filename accepted, no renaming needed.</strong> Examples:
        <code>FIM_2026-06-14.xlsx</code>, <code>FIM_DETAIL_01_03_2024_-_31_03_2024.csv</code>,
        <code>Franchise Integrated Margin (FIM) DETAIL - Exact Date 01.06.2026 - 07.06.2026.xlsx</code>.</p>
      <p class="fmt" style="margin-top:-6px"><strong>FIM CSV files up to 25MB supported.</strong> For files over 10MB ensure you export as CSV not xlsx.</p>
      <div class="zone" tabindex="0" role="button"
           aria-label="FIM report drop zone. Drag an xlsx file named FIM underscore date here, or press Enter to browse.">
        <div class="ic" aria-hidden="true">&#128202;</div>
        <div class="big"><span class="mob">Tap to </span><span class="desk">Drag &amp; drop or </span><span class="link">browse</span><span class="mob"> files</span></div>
        <div class="hint">FIM_YYYY-MM-DD.xlsx</div>
      </div>
      <input type="file" class="file sr" multiple
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        aria-hidden="true" tabindex="-1" />
      <div class="last">Last upload: <span class="last-val"><b>—</b></span></div>
      <div class="progress" hidden role="status" aria-live="polite">
        <div class="ptext">Uploading&hellip;</div>
        <div class="bar2" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      </div>
      <div class="result" aria-live="polite"></div>
    </section>

    <section class="card" data-kind="cc">
      <h2>&#128101; Customer Count Reports</h2>
      <p class="fmt">Daily customer counts with TY/LY comparison. Upload historical files plus today's
        export daily. Accepts <code>.csv</code> — <strong>any SAP default filename accepted, no renaming
        needed</strong> (e.g. <code>Customer Count - Equiv Date Range 01.03.2026 - 19.06.2026.csv</code>).</p>
      <div class="zone" tabindex="0" role="button"
           aria-label="Customer Count report drop zone. Drag a CSV file here, or press Enter to browse.">
        <div class="ic" aria-hidden="true">&#128101;</div>
        <div class="big"><span class="mob">Tap to </span><span class="desk">Drag &amp; drop or </span><span class="link">browse</span><span class="mob"> files</span></div>
        <div class="hint">.csv</div>
      </div>
      <input type="file" class="file sr" multiple accept=".csv,text/csv" aria-hidden="true" tabindex="-1" />
      <div class="last">Last upload: <span class="last-val"><b>&mdash;</b></span></div>
      <div class="progress" hidden role="status" aria-live="polite">
        <div class="ptext">Uploading&hellip;</div>
        <div class="bar2" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      </div>
      <div class="result" aria-live="polite"></div>
    </section>

    <section class="card" data-kind="fs">
      <h2>&#11088; Fan Score / NPS Reports</h2>
      <p class="fmt">Weekly Net Promoter Score store report (customer survey responses with score &amp; reason).
        Accepts <code>.txt</code> &mdash; the BusinessObjects "Fan Score Store Report" export.
        <strong>Any default filename accepted, no renaming needed</strong> (e.g. <code>Fan_Score_Store_Report_(Fran).txt</code>).</p>
      <div class="zone" tabindex="0" role="button"
           aria-label="Fan Score report drop zone. Drag a txt file here, or press Enter to browse.">
        <div class="ic" aria-hidden="true">&#11088;</div>
        <div class="big"><span class="mob">Tap to </span><span class="desk">Drag &amp; drop or </span><span class="link">browse</span><span class="mob"> files</span></div>
        <div class="hint">.txt</div>
      </div>
      <input type="file" class="file sr" multiple accept=".txt,text/plain" aria-hidden="true" tabindex="-1" />
      <div class="last">Last upload: <span class="last-val"><b>&mdash;</b></span></div>
      <div class="progress" hidden role="status" aria-live="polite">
        <div class="ptext">Uploading&hellip;</div>
        <div class="bar2" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      </div>
      <div class="result" aria-live="polite"></div>
    </section>

  </div>

  <section class="card" style="margin-top:18px">
    <h2 style="margin:0 0 4px">Load Historical Data</h2>
    <p class="fmt" style="margin:0 0 4px">Bulk import past reports going back to FY2023 (March 2022). Files are deduplicated automatically — safe to re-run.</p>
    <p class="fmt"><strong>Loading history: FY2023 (Mar 2022) → FY2027 (now)</strong></p>
    <div class="grid" id="histGrid">

      <section class="card" data-kind="fim" data-hist="1">
        <h2>&#128197; Historical FIM Reports</h2>
        <p class="fmt">Any SAP default filename accepted — no renaming needed (date read from the name,
          single or range). Tip: use monthly FIMs for older history.
          Suggested: FY2023–FY2025 monthly (36), FY2026 weekly (52), FY2027 daily.</p>
        <div class="zone" tabindex="0" role="button" aria-label="Historical FIM drop zone">
          <div class="ic" aria-hidden="true">&#128202;</div>
          <div class="big">Drag &amp; drop many or <span class="link">browse</span></div>
          <div class="hint">.xlsx / .csv</div>
        </div>
        <input type="file" class="file sr" multiple accept=".xlsx,.csv,text/csv" aria-hidden="true" tabindex="-1" />
        <div class="progress" hidden role="status" aria-live="polite"><div class="ptext">Uploading&hellip;</div><div class="bar2"><i></i></div></div>
        <div class="result" aria-live="polite"></div>
      </section>

      <section class="card" data-kind="gr" data-hist="1">
        <h2>&#128666; Historical GR Reports</h2>
        <p class="fmt">Any .xlsx GR crosstab export. Any SAP default filename accepted — no renaming needed
          (e.g. <code>Goods Receipts - Equiv Date 01.11.2025 - 15.11.2025.xlsx</code>). Suggested: one file per week per FY.</p>
        <div class="zone" tabindex="0" role="button" aria-label="Historical GR drop zone">
          <div class="ic" aria-hidden="true">&#128230;</div>
          <div class="big">Drag &amp; drop many or <span class="link">browse</span></div>
          <div class="hint">.csv / .tsv / .xlsx</div>
        </div>
        <input type="file" class="file sr" multiple accept=".csv,.tsv,.xlsx" aria-hidden="true" tabindex="-1" />
        <div class="progress" hidden role="status" aria-live="polite"><div class="ptext">Uploading&hellip;</div><div class="bar2"><i></i></div></div>
        <div class="result" aria-live="polite"></div>
      </section>

      <section class="card" data-kind="sap" data-hist="1">
        <h2>&#128203; Historical PO Exports</h2>
        <p class="fmt">Accepts <code>.xlsx</code> / <code>.txt</code> / <code>.tsv</code> / <code>.htm</code>.
          Column mapping is verified against your live export first. Suggested: one file per week per FY.</p>
        <div class="zone" tabindex="0" role="button" aria-label="Historical PO drop zone">
          <div class="ic" aria-hidden="true">&#128228;</div>
          <div class="big">Drag &amp; drop many or <span class="link">browse</span></div>
          <div class="hint">.txt / .tsv / .xlsx / .htm</div>
        </div>
        <input type="file" class="file sr" multiple accept=".tsv,.csv,.txt,.htm,.html,.xlsx" aria-hidden="true" tabindex="-1" />
        <div class="progress" hidden role="status" aria-live="polite"><div class="ptext">Uploading&hellip;</div><div class="bar2"><i></i></div></div>
        <div class="result" aria-live="polite"></div>
      </section>

    </div>
  </section>

  <section class="card hist" style="margin-top:18px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0">Upload history</h2>
      <div>
        <button class="btnsm" id="histRefresh" type="button">Refresh</button>
        <button class="btnsm danger" id="delSelected" type="button" hidden>Delete selected (0)</button>
      </div>
    </div>
    <div id="histBody"><div class="muted small" style="padding:8px 0">Loading…</div></div>
    <div id="resetRow" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px" hidden>
      <button class="btnsm danger" id="delAll" type="button">Delete ALL uploads…</button>
      <span class="muted small">Clears every upload, PO line, GR line, FIM row and anomaly, and empties the file archive. Guidelines &amp; settings are kept.</span>
    </div>
  </section>
</main>

<script>
const ENDPOINTS = { sap: "/api/uploads", gr: "/api/gr-uploads", eod: "/api/eod-uploads", fim: "/api/fim-uploads", cc: "/api/customer-uploads", fs: "/api/fan-score-uploads" };
const DB_KIND   = { sap: "po", gr: "gr", fim: "fim", cc: "cc", fs: "fs" };
const esc = s => String(s == null ? "" : s).replace(/[&<>]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));
const rand = v => "R" + (v == null ? 0 : v).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtWhen = s => s ? esc(String(s).replace("T", " ").replace("Z", "")) : "—";

function cardOf(kind) { return document.querySelector('section[data-kind="' + kind + '"]'); }

// --- wire each tile -------------------------------------------------------
for (const kind of ["sap", "gr", "eod", "fim", "cc", "fs"]) {
  const card = cardOf(kind);
  const zone = card.querySelector(".zone");
  const input = card.querySelector(".file");

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
  });
  input.addEventListener("change", () => { if (input.files && input.files.length) startBatch(kind, input.files); input.value = ""; });

  ["dragenter", "dragover"].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.add("drag");
  }));
  ["dragleave", "dragend"].forEach(ev => zone.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove("drag");
  }));
  zone.addEventListener("drop", e => {
    e.preventDefault(); e.stopPropagation(); zone.classList.remove("drag");
    const fs = e.dataTransfer && e.dataTransfer.files;
    if (fs && fs.length) startBatch(kind, fs);
  });
}

// --- historical zones (always batch, even for one file) -------------------
Array.prototype.slice.call(document.querySelectorAll('section[data-hist="1"]')).forEach(function (card) {
  var kind = card.getAttribute("data-kind");
  var zone = card.querySelector(".zone");
  var input = card.querySelector(".file");
  var ui = {
    prog: card.querySelector(".progress"), bar: card.querySelector(".bar2"),
    fill: card.querySelector(".bar2 i"), ptext: card.querySelector(".ptext"),
    result: card.querySelector(".result"),
  };
  function go(fs) { if (fs && fs.length) runBatch(kind, Array.prototype.slice.call(fs), ui); }
  zone.addEventListener("click", function () { input.click(); });
  zone.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", function () { go(input.files); input.value = ""; });
  ["dragenter", "dragover"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.add("drag"); }); });
  ["dragleave", "dragend"].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.remove("drag"); }); });
  zone.addEventListener("drop", function (e) { e.preventDefault(); e.stopPropagation(); zone.classList.remove("drag"); go(e.dataTransfer && e.dataTransfer.files); });
});

// Single file → detailed result; multiple → sequential batch with progress.
function startBatch(kind, fileList, ui) {
  var files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  if (!ui && files.length === 1) { startUpload(kind, files[0]); return; }
  var card = cardOf(kind);
  ui = ui || {
    prog: card.querySelector(".progress"),
    bar: card.querySelector(".bar2"),
    fill: card.querySelector(".bar2 i"),
    ptext: card.querySelector(".ptext"),
    result: card.querySelector(".result"),
  };
  runBatch(kind, files, ui);
}

// FIM accepts any SAP-default filename that contains a date (ISO, DD.MM.YYYY,
// DD_MM_YYYY, DD/MM/YYYY); the server resolves the exact period.
function nameHasDate(name) {
  return /(\\d{4}-\\d{1,2}-\\d{1,2})|(\\d{1,2}[._\\/]\\d{1,2}[._\\/]\\d{4})/.test(name);
}
function validFimName(name) {
  return nameHasDate(name);
}

async function runBatch(kind, files, ui) {
  ui.result.innerHTML = "";
  ui.prog.hidden = false;
  ui.bar.classList.remove("indet");
  var ok = 0, fail = [], skip = [], dates = [], eodCheck = null;
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    ui.fill.style.width = Math.round((i / files.length) * 100) + "%";
    ui.ptext.textContent = "Processing " + (i + 1) + " of " + files.length + " \\u2014 " + f.name + "\\u2026";
    if (kind === "fim" && !validFimName(f.name)) {
      fail.push({ name: f.name, reason: "no date found in filename — any SAP default name with a date works" });
      continue;
    }
    try {
      var fd = new FormData();
      fd.append("file", f, f.name);
      var resp = await fetch(ENDPOINTS[kind], { method: "POST", body: fd });
      var data = {};
      try { data = await resp.json(); } catch (_) {}
      if (resp.status === 409 || data.status === "duplicate") {
        skip.push({ name: f.name, reason: data.reason || "duplicate, skipped" });
      } else if (resp.ok && data.status === "parsed") {
        ok++;
        var dt = data.dateFrom || data.reportDate;
        if (dt) dates.push(dt);
        if (data.dateTo && data.dateTo !== dt) dates.push(data.dateTo);
        if (kind === "eod" && data.selfCheck) eodCheck = { c: data.selfCheck, s: data.settlement };
      } else {
        var reason = data.error || (data.warnings && data.warnings.join(" ")) || ("HTTP " + resp.status);
        fail.push({ name: f.name, reason: reason });
      }
    } catch (e) { fail.push({ name: f.name, reason: (e && e.message) || "network error" }); }
  }
  ui.fill.style.width = "100%";
  ui.prog.hidden = true;
  renderBatchSummary(ui.result, kind, ok, fail, skip, dates, eodCheck);
  loadLast();
  loadHistory();
}

function renderBatchSummary(el, kind, ok, fail, skip, dates, eodCheck) {
  var KIND = { sap: "PO", gr: "GR", eod: "EOD", fim: "FIM", cc: "CC", fs: "FS" };
  var range = "";
  if (dates.length) { dates.sort(); range = " (" + dates[0] + " \\u2192 " + dates[dates.length - 1] + ")"; }
  var h = '<div class="bsum">';
  h += '<div class="ok">\\u2705 ' + KIND[kind] + ": " + ok + " file" + (ok === 1 ? "" : "s") + " loaded" + esc(range) + "</div>";
  if (eodCheck && eodCheck.c) {
    var c = eodCheck.c, R = function (n) { return "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    h += '<div class="ok" style="font-weight:400">Self-check: <b>' + c.grCount + '</b> goods receipts totalling <b>' + R(c.grValInTotal) + '</b> \\u00b7 ' + c.returnCount + ' returns (' + R(c.returnValTotal) + ')' + (c.reversalCount ? ' \\u00b7 ' + c.reversalCount + ' reversal' : '') + '</div>';
    if (eodCheck.s) h += '<div class="ok" style="font-weight:400">Settlement re-evaluated \\u2014 open the <a href="/#settlement">Settlement screen</a> for the reconciliation.</div>';
  }
  if (skip.length) {
    h += '<details class="bskip"><summary>\\u23ED ' + skip.length + " skipped (duplicate)</summary><ul>"
      + skip.map(function (s) { return "<li>" + esc(s.name) + " \\u2014 " + esc(s.reason) + "</li>"; }).join("") + "</ul></details>";
  }
  if (fail.length) {
    h += '<details class="bfail" open><summary>\\u274C ' + fail.length + " failed</summary><ul>"
      + fail.map(function (s) { return "<li>" + esc(s.name) + " \\u2014 " + esc(s.reason) + "</li>"; }).join("") + "</ul></details>";
  }
  h += "</div>";
  el.innerHTML = h;
}

// --- upload ---------------------------------------------------------------
function startUpload(kind, file) {
  const card = cardOf(kind);
  const result = card.querySelector(".result");
  const prog = card.querySelector(".progress");
  const bar = card.querySelector(".bar2");
  const fill = bar.querySelector("i");
  const ptext = card.querySelector(".ptext");
  result.innerHTML = "";

  if (kind === "fim" && !nameHasDate(file.name)) {
    result.innerHTML = box("err", "No date in filename", "Couldn't find a date in <code>" + esc(file.name) + "</code>. Any SAP default name with a date works (e.g. <code>… Equiv Date 01.11.2025 - 15.11.2025.xlsx</code>) or <code>FIM_YYYY-MM-DD.xlsx</code>.");
    return;
  }

  prog.hidden = false;
  bar.classList.remove("indet");
  fill.style.width = "0%";
  ptext.textContent = "Uploading " + file.name + "\\u2026";

  const fd = new FormData();
  fd.append("file", file, file.name);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", ENDPOINTS[kind]);
  xhr.upload.onprogress = e => {
    if (e.lengthComputable) {
      const p = Math.round((e.loaded / e.total) * 100);
      fill.style.width = p + "%";
      bar.setAttribute("aria-valuenow", String(p));
    }
  };
  xhr.upload.onload = () => {
    bar.classList.add("indet");
    bar.removeAttribute("aria-valuenow");
    ptext.textContent = "Parsing on server\\u2026";
  };
  xhr.onload = () => {
    prog.hidden = true;
    bar.classList.remove("indet");
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch (_) {}
    renderResult(kind, data, xhr.status, { text: xhr.responseText || "", statusText: xhr.statusText || "" });
    loadLast();
    loadHistory();
  };
  xhr.onerror = () => {
    prog.hidden = true;
    result.innerHTML = box("err", "Upload failed", "A network error occurred during upload. Please retry.");
  };
  xhr.send(fd);
}

// --- result summary -------------------------------------------------------
function stat(label, value, flag) {
  return '<div class="stat"><div class="v' + (flag ? " flag" : "") + '">' + esc(value) + '</div><div class="l">' + esc(label) + '</div></div>';
}
function box(cls, title, bodyHtml) {
  return '<div class="box ' + cls + '"><span class="bt">' + esc(title) + '</span>' + bodyHtml + '</div>';
}

// Render the canonical-field -> source-header column mapping (for SAP / GR).
function mappedColumnsHtml(map) {
  const keys = map ? Object.keys(map) : [];
  if (!keys.length) return "";
  let h = '<div class="small" style="margin-top:8px"><strong>Mapped columns</strong> (' + keys.length + ')'
    + '<table class="mini"><thead><tr><th>Field</th><th>Source header</th></tr></thead><tbody>';
  h += keys.map(k => '<tr><td>' + esc(k) + '</td><td>' + esc(map[k]) + '</td></tr>').join("");
  return h + '</tbody></table></div>';
}

// Best-effort human detail from whatever the server returned (structured or raw).
function errorDetail(d, http, raw) {
  const parts = [];
  if (d && d.error) parts.push(d.error);
  if (d && d.message && d.message !== d.error) parts.push(d.message);
  if (!parts.length && raw && raw.statusText) parts.push(raw.statusText);
  if (!parts.length && raw && raw.text) parts.push(raw.text.slice(0, 1000));
  if (!parts.length) parts.push("HTTP " + http);
  let html = esc(parts.join(" — "));
  if (d && d.errorName) html += ' <span class="muted">(' + esc(d.errorName) + ')</span>';
  if (d && d.where) html += '<div class="muted small">at ' + esc(d.where) + '</div>';
  if (d && d.stack) html += '<details style="margin-top:6px"><summary class="muted small">stack trace</summary>'
    + '<pre style="white-space:pre-wrap;font-size:11px;margin:4px 0 0">' + esc(d.stack) + '</pre></details>';
  return html;
}

function renderResult(kind, d, http, raw) {
  const el = cardOf(kind).querySelector(".result");
  d = d || {};
  raw = raw || {};
  const status = d.status || ("HTTP " + http);

  if (status === "duplicate") {
    el.innerHTML = box("warn", "Already ingested", "This exact file was uploaded before (upload #" + esc(d.uploadId) + "). Nothing changed.");
    return;
  }
  if (http >= 500 || status === "error") {
    el.innerHTML = box("err", "Server error", errorDetail(d, http, raw));
    return;
  }
  if (status === "parsed_empty") {
    let body = esc((d.warnings || []).join(" ") || "No usable data rows were parsed from this file.");
    if (d.delimiter) body += '<div class="muted small" style="margin-top:6px">Detected delimiter: <code>' + esc(d.delimiter) + '</code></div>';
    body += mappedColumnsHtml(d.mappedColumns);
    el.innerHTML = box("warn", "No rows parsed", body);
    return;
  }
  if (http >= 400) {
    el.innerHTML = box("err", "Rejected", errorDetail(d, http, raw));
    return;
  }

  const lines = d.linesIngested != null ? d.linesIngested : (d.departmentsIngested != null ? d.departmentsIngested : null);
  let deptCount = null;
  if (kind === "gr") deptCount = (d.departments || []).length;
  if (kind === "fim") deptCount = d.departmentsIngested;

  const stats = [];
  stats.push(stat("Lines parsed", lines != null ? lines : "—"));
  if (kind === "sap") stats.push(stat("Columns mapped", d.mappedColumns ? Object.keys(d.mappedColumns).length : "—"));
  if (deptCount != null) stats.push(stat("Departments", deptCount));
  if (kind === "fim" && d.reportDate) stats.push(stat("Report date", d.reportDate));
  stats.push(stat("Skipped rows", d.skippedRows != null ? d.skippedRows : "—"));
  const an = d.anomaliesRaised != null ? d.anomaliesRaised : 0;
  stats.push(stat("Anomalies", an, an > 0));

  let html = '<div class="ok">&#10003; Parsed' + (d.uploadId != null ? " — upload #" + esc(d.uploadId) : "") + '</div>';
  html += '<div class="stats">' + stats.join("") + '</div>';

  if (kind === "fim" && d.fiscal) {
    html += '<div class="muted small">Fiscal: FY' + esc(d.fiscal.fiscalYear) + ' &middot; Q' + esc(d.fiscal.fiscalQuarter)
      + ' &middot; week ' + esc(d.fiscal.fiscalWeek) + ' (' + esc(d.fiscal.fiscalWeekStart) + ' &rarr; ' + esc(d.fiscal.fiscalWeekEnd) + ')</div>';
  }
  if ((kind === "sap" || kind === "gr") && d.mappedColumns) {
    html += mappedColumnsHtml(d.mappedColumns);
  }
  if (kind === "gr" && (d.departments || []).length) {
    html += '<table class="mini"><thead><tr><th>Department</th><th class="num">Lines</th><th class="num">Cost</th>'
      + '<th class="num">Sell</th><th class="num">Margin</th></tr></thead><tbody>';
    html += d.departments.map(x => '<tr><td>' + esc(x.dept) + '</td><td class="num">' + esc(x.lines) + '</td>'
      + '<td class="num">' + rand(x.costZar) + '</td><td class="num">' + rand(x.sellZar) + '</td>'
      + '<td class="num">' + (x.marginPct == null ? "—" : esc(x.marginPct) + "%") + '</td></tr>').join("");
    html += '</tbody></table>';
    if (d.unmappedDepartments) html += '<div class="muted small">' + esc(d.unmappedDepartments) + ' line(s) had an unrecognised department code.</div>';
  }
  if ((d.warnings || []).length) {
    html += '<div class="warn-list">' + d.warnings.map(w => "&#9888; " + esc(w)).join("<br>") + '</div>';
  }
  if (an > 0) {
    html += '<div class="small" style="margin-top:8px">' + esc(an) + ' anomaly flag(s) raised &mdash; '
      + '<a href="/">view on the dashboard</a>.</div>';
  }
  el.innerHTML = html;
}

// --- last-upload timestamps ----------------------------------------------
async function loadLast() {
  try {
    const r = await fetch("/api/uploads", { cache: "no-store" });
    const d = await r.json();
    const latest = {};
    for (const u of (d.uploads || [])) { if (u.kind && !latest[u.kind]) latest[u.kind] = u; }
    for (const kind of ["sap", "gr", "eod", "fim", "cc", "fs"]) {
      const card = cardOf(kind);
      const span = card && card.querySelector(".last-val");
      if (!span) continue;
      const u = latest[DB_KIND[kind]];
      if (!u) { span.innerHTML = "<b>none yet</b>"; continue; }
      span.innerHTML = "<b>" + esc(u.filename) + "</b> &middot; " + fmtWhen(u.uploaded_at)
        + (u.status && u.status !== "parsed" ? ' &middot; <span class="muted">' + esc(u.status) + "</span>" : "");
    }
  } catch (e) { /* leave dashes */ }
}

// --- upload history + delete ---------------------------------------------
var HIST = [];
var SEL = {};

function kindTag(k) {
  var cls = k === "po" ? "k-po" : k === "gr" ? "k-gr" : k === "fim" ? "k-fim" : k === "cc" ? "k-cc" : k === "fs" ? "k-fs" : "";
  var lbl = k === "po" ? "SAP PO" : k === "gr" ? "GR" : k === "fim" ? "FIM" : k === "cc" ? "CC" : k === "fs" ? "FS" : esc(k || "?");
  return '<span class="kindtag ' + cls + '">' + lbl + "</span>";
}

function selectedIds() {
  return Object.keys(SEL).filter(function (id) { return SEL[id]; }).map(Number);
}
function syncSelUI() {
  var ids = selectedIds();
  var btn = document.getElementById("delSelected");
  btn.hidden = ids.length === 0;
  btn.textContent = "Delete selected (" + ids.length + ")";
  HIST.forEach(function (u) {
    var tr = document.getElementById("hrow_" + u.id);
    if (tr) tr.classList.toggle("sel", !!SEL[u.id]);
  });
  var all = document.getElementById("hcheckall");
  if (all) all.checked = ids.length > 0 && ids.length === HIST.length;
}

async function loadHistory() {
  var body = document.getElementById("histBody");
  try {
    var r = await fetch("/api/uploads", { cache: "no-store" });
    var d = await r.json();
    HIST = d.uploads || [];
    SEL = {};
    if (!HIST.length) {
      body.innerHTML = '<div class="muted small" style="padding:8px 0">No uploads yet.</div>';
      document.getElementById("resetRow").hidden = true;
      syncSelUI();
      return;
    }
    var rows = HIST.map(function (u) {
      return '<tr id="hrow_' + u.id + '">'
        + '<td><input type="checkbox" class="hcheck" data-id="' + u.id + '"></td>'
        + "<td>" + u.id + "</td>"
        + "<td>" + kindTag(u.kind) + "</td>"
        + '<td title="' + esc(u.filename) + '">' + esc(u.filename) + "</td>"
        + "<td>" + esc(u.status) + "</td>"
        + '<td class="num">' + (u.row_count != null ? Number(u.row_count).toLocaleString() : "—") + "</td>"
        + '<td class="muted">' + fmtWhen(u.uploaded_at) + "</td>"
        + '<td><button class="icondel" title="Delete this upload" data-del="' + u.id + '">&#128465;</button></td>'
        + "</tr>";
    }).join("");
    body.innerHTML =
      '<table class="hist-t"><thead><tr>'
      + '<th><input type="checkbox" id="hcheckall"></th><th>ID</th><th>Type</th><th>File</th><th>Status</th>'
      + '<th class="num">Rows</th><th>When</th><th></th></tr></thead><tbody>' + rows + "</tbody></table>"
      + '<div class="delresult" id="delResult"></div>';
    document.getElementById("resetRow").hidden = false;

    body.querySelectorAll(".hcheck").forEach(function (cb) {
      cb.addEventListener("change", function () { SEL[this.getAttribute("data-id")] = this.checked; syncSelUI(); });
    });
    body.querySelectorAll("button[data-del]").forEach(function (b) {
      b.addEventListener("click", function () { deleteUploads([Number(this.getAttribute("data-del"))]); });
    });
    var all = document.getElementById("hcheckall");
    all.addEventListener("change", function () {
      var on = this.checked;
      HIST.forEach(function (u) { SEL[u.id] = on; });
      body.querySelectorAll(".hcheck").forEach(function (cb) { cb.checked = on; });
      syncSelUI();
    });
    syncSelUI();
  } catch (e) {
    body.innerHTML = '<div class="box err">Could not load history: ' + esc(e && e.message || e) + "</div>";
  }
}

function summariseDeleted(totals) {
  var parts = [];
  ["uploads", "po_lines", "gr_lines", "fim_daily", "anomalies"].forEach(function (k) {
    if (totals && totals[k]) parts.push(totals[k].toLocaleString() + " " + k.replace("_", " "));
  });
  return parts.length ? parts.join(", ") + " removed" : "Nothing to remove";
}

// Admin token for destructive routes (X-Admin-Token). Stored once in localStorage
// (shared origin with the main app); prompt if missing or force=true (after 401).
function adminToken(force) {
  var t = "";
  try { t = localStorage.getItem("admin-token") || ""; } catch (e) {}
  if (!t || force) { t = window.prompt("Admin token (required for destructive actions):") || ""; try { localStorage.setItem("admin-token", t); } catch (e) {} }
  return t;
}
async function adminJson(res) {
  if (res.status === 401) { adminToken(true); throw new Error("Admin token rejected — re-enter and retry"); }
  return await res.json();
}

async function deleteUploads(ids) {
  if (!ids.length) return;
  if (!confirm("Delete " + ids.length + " upload" + (ids.length > 1 ? "s" : "") + " and all their data?")) return;
  var res;
  try {
    if (ids.length === 1) {
      res = await adminJson(await fetch("/api/uploads/" + ids[0], { method: "DELETE", headers: { "X-Admin-Token": adminToken(false) } }));
      res = { deleted: res.deleted, r2Deleted: res.r2Deleted ? 1 : 0 };
    } else {
      res = await adminJson(await fetch("/api/uploads/bulk-delete", {
        method: "POST", headers: { "content-type": "application/json", "X-Admin-Token": adminToken(false) }, body: JSON.stringify({ ids: ids }),
      }));
    }
  } catch (e) { alert("Delete failed: " + (e && e.message || e)); return; }
  await loadHistory();
  await loadLast();
  var rd = document.getElementById("delResult");
  if (rd) rd.innerHTML = '<span style="color:var(--green)">&#10003; ' + esc(summariseDeleted(res.deleted)) + ".</span>";
}

async function deleteAll() {
  var typed = prompt('This deletes ALL uploads and their data and empties the file archive.\\n\\nType RESET to confirm:');
  if (typed !== "RESET") { if (typed != null) alert("Not confirmed — you must type RESET exactly."); return; }
  var res;
  try {
    res = await adminJson(await fetch("/api/uploads/reset", {
      method: "POST", headers: { "content-type": "application/json", "X-Admin-Token": adminToken(false) }, body: JSON.stringify({ confirm: "RESET" }),
    }));
  } catch (e) { alert("Reset failed: " + (e && e.message || e)); return; }
  await loadHistory();
  await loadLast();
  var rd = document.getElementById("delResult");
  if (rd) rd.innerHTML = '<span style="color:var(--green)">&#10003; Reset complete — ' + esc(summariseDeleted(res.deleted)) + ", " + (res.r2Deleted || 0) + " files purged.</span>";
}

document.getElementById("histRefresh").addEventListener("click", loadHistory);
document.getElementById("delSelected").addEventListener("click", function () { deleteUploads(selectedIds()); });
document.getElementById("delAll").addEventListener("click", deleteAll);

loadLast();
loadHistory();
</script>
</body>
</html>`;

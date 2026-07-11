/**
 * Self-contained dashboard page (no build step, no external assets).
 * Served at GET /. Fetches GET /api/dashboard and renders it client-side.
 */
export const DASHBOARD_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>PO Monitor — Pick n Pay Lydenburg</title>
<style>
  :root {
    --pnp-blue: #0055a5;
    --pnp-red: #e2231a;
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
  header .meta { font-size: 12px; opacity: .9; text-align: right; }
  main { padding: 20px; max-width: 1200px; margin: 0 auto; }
  .row { display: grid; gap: 16px; }
  .kpis { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin-bottom: 16px; }
  .grid2 { grid-template-columns: 1fr 1fr; }
  @media (max-width: 820px){ .grid2 { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 16px; box-shadow: 0 1px 2px rgba(0,0,0,.03); }
  .card h2 { margin: 0 0 12px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em;
    color: var(--muted); }
  .kpi .v { font-size: 26px; font-weight: 700; }
  .kpi .l { font-size: 12px; color: var(--muted); margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pill { display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; color: #fff; }
  .GREEN { background: var(--green); } .AMBER { background: var(--amber); }
  .TIGHT { background: var(--orange); } .OVER { background: var(--red); }
  .sev-CRITICAL { color: var(--red); font-weight: 700; }
  .sev-WARN { color: var(--orange); font-weight: 600; }
  .sev-INFO { color: var(--muted); }
  .bar { height: 8px; background: var(--line); border-radius: 999px; overflow: hidden; margin-top: 6px; }
  .bar > i { display: block; height: 100%; }
  .muted { color: var(--muted); }
  .right { text-align: right; }
  .empty { color: var(--muted); padding: 8px 0; }
  .err { background: #fdecea; color: #8a1c14; padding: 10px 14px; border-radius: 8px; margin-bottom: 16px; }
  button.refresh { background: rgba(255,255,255,.15); color:#fff; border:1px solid rgba(255,255,255,.4);
    border-radius:6px; padding:6px 12px; cursor:pointer; font-size:12px; }
  button.refresh:hover { background: rgba(255,255,255,.28); }
  a.navlink { display:inline-block; background: rgba(255,255,255,.15); color:#fff; text-decoration:none;
    border:1px solid rgba(255,255,255,.4); border-radius:6px; padding:6px 12px; font-size:12px; margin-right:8px; }
  a.navlink:hover { background: rgba(255,255,255,.28); }
  .pos { color: var(--green); font-weight: 600; }
  .neg { color: var(--red); font-weight: 700; }
  .warnrow { background: #fff8e6; }
  .critrow { background: #fdecea; }
  .grp-h { margin: 14px 0 6px; font-size: 12px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .04em; color: var(--pnp-blue); border-bottom: 2px solid var(--line); padding-bottom: 3px; }
  .worst-tag { display:inline-block; margin-left:6px; padding:1px 6px; border-radius:999px;
    background: var(--red); color:#fff; font-size:10px; font-weight:700; }
  .prod-note { color: var(--muted); font-size: 11px; font-style: italic; margin: 6px 0 0; }
  .mbar { position: relative; height: 9px; background: var(--line); border-radius: 999px; overflow: hidden; min-width: 90px; }
  .mbar > i { display: block; height: 100%; }
  .kv { display:flex; gap:18px; flex-wrap:wrap; margin-bottom:10px; }
  .kv > div { font-size:12px; color:var(--muted); }
  .kv b { display:block; font-size:18px; color:var(--ink); }
  .cc3 { display:grid; grid-template-columns: repeat(3, 1fr); gap:16px; }
  @media (max-width:820px){ .cc3 { grid-template-columns: 1fr; } }
  .ccbox { border:1px solid var(--line); border-radius:10px; padding:14px 12px; text-align:center; }
  .ccbox .hd { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  .ccbox .big { font-size:30px; font-weight:800; margin:4px 0 0; font-variant-numeric:tabular-nums; }
  .ccbox .sub { font-size:12px; color:var(--muted); margin-top:2px; }
  .cc-up { color:#2E7D32; font-weight:700; }
  .cc-down { color:#BE1D37; font-weight:700; }
  .cc-flat { color:var(--muted); font-weight:600; }
</style>
</head>
<body>
<header>
  <div class="title">Purchase Order Monitor <small id="storeLine">Loading…</small></div>
  <div class="meta">
    <div id="updated">—</div>
    <div id="autonote" style="font-size:11px;opacity:.75">auto-refresh every 60s</div>
    <div style="margin-top:6px">
      <a class="navlink" href="/upload">&#8593; Upload files</a>
      <button class="refresh" onclick="load()">Refresh now</button>
    </div>
  </div>
</header>
<main>
  <div id="error"></div>

  <div class="row" style="margin-bottom:16px">
    <div class="card" style="cursor:pointer" onclick="location.href='/#customers'" title="Open Customer Count detail">
      <h2>Customer count <span id="cc-asat" class="muted" style="text-transform:none;letter-spacing:0;font-weight:400"></span></h2>
      <div id="cc-widget"><div class="empty">Loading…</div></div>
    </div>
  </div>

  <div class="row" style="margin-bottom:16px">
    <div class="card" style="cursor:pointer" onclick="location.href='/#fanscore'" title="Open Fan Score / NPS detail">
      <h2>Fan Score / NPS <span id="fs-asat" class="muted" style="text-transform:none;letter-spacing:0;font-weight:400"></span></h2>
      <div id="fs-widget"><div class="empty">Loading…</div></div>
    </div>
  </div>

  <div class="row kpis" id="kpis"></div>

  <div class="row grid2">
    <div class="card">
      <h2>Budget status</h2>
      <div id="budgets"></div>
    </div>
    <div class="card">
      <h2>Open-order aging</h2>
      <table><thead><tr><th>Bucket</th><th class="num">Lines</th><th class="num">Open value</th></tr></thead>
        <tbody id="aging"></tbody></table>
    </div>
  </div>

  <div class="row" style="margin-top:16px">
    <div class="card">
      <h2>GR / Margin — latest goods-receipt upload</h2>
      <div id="grPanel"></div>
    </div>
  </div>

  <div class="row" style="margin-top:16px">
    <div class="card">
      <h2>Margin performance vs guideline</h2>
      <div id="marginPerf"></div>
    </div>
  </div>

  <div class="row grid2" style="margin-top:16px">
    <div class="card">
      <h2>Open anomalies</h2>
      <table><thead><tr><th>Sev</th><th>Type</th><th>Detail</th></tr></thead>
        <tbody id="anomalies"></tbody></table>
    </div>
    <div class="card">
      <h2>Recent uploads</h2>
      <table><thead><tr><th>File</th><th>Status</th><th class="num">Lines</th><th>When</th></tr></thead>
        <tbody id="uploads"></tbody></table>
    </div>
  </div>
</main>

<script>
const R = c => "R" + (c/100).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2});
const R2 = v => "R" + (v==null?0:v).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = s => String(s ?? "").replace(/[&<>]/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[m]));
const AGING_LABELS = { not_due:"Not yet due", overdue_1_7:"1–7 days overdue",
  overdue_8_21:"8–21 days overdue", overdue_22_plus:"22+ days overdue (stale)", no_date:"No delivery date" };

const REFRESH_MS = 60000;
let refreshTimer = null;

function setUpdated(d) {
  const now = new Date();
  const hhmmss = now.toLocaleTimeString("en-ZA", { hour12: false });
  const dataAsAt = d ? " · data as at " + esc(d.generatedAt) : "";
  document.getElementById("updated").innerHTML = "Last updated " + hhmmss + dataAsAt;
}

async function load() {
  const errEl = document.getElementById("error");
  errEl.innerHTML = "";
  try {
    const res = await fetch("/api/dashboard", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const d = await res.json();
    render(d);
    setUpdated(d);
  } catch (e) {
    errEl.innerHTML = '<div class="err">Failed to load dashboard: ' + esc(e.message) + ' (retrying in 60s)</div>';
    setUpdated(null);
  } finally {
    loadCc(); // customer-count widget refreshes independently of the main dashboard
    loadFs(); // fan-score / NPS widget, likewise
    // re-arm a single timer so overlapping/failed loads never stack up
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(load, REFRESH_MS);
  }
}

const CC_MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const fmtDate = s => { const p = String(s||"").split("-");
  return p.length === 3 ? Number(p[2]) + " " + CC_MON[Number(p[1])-1] + " " + p[0] : (s||""); };
const fmtN = n => Number(n||0).toLocaleString("en-ZA");
const ccVar = v => {
  if (v == null) return '<span class="cc-flat">— vs LY</span>';
  if (v > 0) return '<span class="cc-up">&#9650; +' + v.toFixed(1) + '% vs LY</span>';
  if (v < 0) return '<span class="cc-down">&#9660; ' + v.toFixed(1) + '% vs LY</span>';
  return '<span class="cc-flat">0.0% vs LY</span>';
};

async function loadCc() {
  const el = document.getElementById("cc-widget");
  const asat = document.getElementById("cc-asat");
  try {
    const res = await fetch("/api/customer-counts/summary", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const d = await res.json();
    if (!d.hasData) {
      asat.textContent = "";
      el.innerHTML = '<div class="empty">No customer data — upload Customer Count CSV to get started</div>';
      return;
    }
    asat.textContent = "· latest " + fmtDate(d.latestDate);
    const cols = [
      ["Yesterday", d.windows.yesterday, fmtDate(d.latestDate)],
      ["Week to date", d.windows.wtd, ""],
      ["Month to date", d.windows.mtd, ""],
    ];
    el.innerHTML = '<div class="cc3">' + cols.map(function(c){
      const w = c[1];
      const sv = w.salesVarPct;
      const svh = sv == null ? '' : ' <span class="' + (sv>0?'cc-up':sv<0?'cc-down':'cc-flat') + '">(' + (sv>=0?'+':'') + sv.toFixed(1) + '%)</span>';
      const basket = (w.avgBasket != null) ? '<div class="sub">' + R2(w.avgBasket) + ' avg basket</div>' : '';
      return '<div class="ccbox"><div class="hd">' + esc(c[0]) + '</div>'
        + '<div class="big">' + fmtN(w.customersTy) + '</div>'
        + '<div class="sub">customers</div>'
        + '<div style="margin:6px 0">' + ccVar(w.customersVarPct) + '</div>'
        + '<div class="sub">' + R2(w.salesTy) + ' sales' + svh + '</div>'
        + basket
        + (c[2] ? '<div class="sub" style="margin-top:4px">' + esc(c[2]) + '</div>' : '')
        + '</div>';
    }).join("") + '</div>';
  } catch (e) {
    asat.textContent = "";
    el.innerHTML = '<div class="empty">Customer data unavailable: ' + esc(e.message) + '</div>';
  }
}

// NPS band colour: >=70 green, >=50 amber, <50 red.
const fsBand = v => v == null ? "var(--muted)" : v >= 70 ? "#2E7D32" : v >= 50 ? "#d97706" : "#BE1D37";

async function loadFs() {
  const el = document.getElementById("fs-widget");
  const asat = document.getElementById("fs-asat");
  try {
    const res = await fetch("/api/fan-score/summary", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const d = await res.json();
    if (!d.hasData) {
      asat.textContent = "";
      el.innerHTML = '<div class="empty">No fan-score data — upload a Fan Score report to get started</div>';
      return;
    }
    asat.textContent = "· W/E " + fmtDate(d.weekEnding);
    const tw = d.npsTw != null ? d.npsTw : d.npsComputed;
    const delta = (d.npsTw != null && d.npsLw != null) ? (d.npsTw - d.npsLw) : null;
    const dh = delta == null ? '<span class="cc-flat">— vs LW</span>'
      : (delta >= 0 ? '<span class="cc-up">&#9650; +' + delta.toFixed(2) + 'pp vs LW</span>'
                    : '<span class="cc-down">&#9660; ' + delta.toFixed(2) + 'pp vs LW</span>');
    const boxes = [
      '<div class="ccbox"><div class="hd">NPS this week</div>'
        + '<div class="big" style="color:' + fsBand(tw) + '">' + (tw != null ? tw.toFixed(2) + '%' : '—') + '</div>'
        + '<div class="sub">last week ' + (d.npsLw != null ? d.npsLw.toFixed(2) + '%' : '—') + '</div>'
        + '<div style="margin:6px 0">' + dh + '</div></div>',
      '<div class="ccbox"><div class="hd">Responses</div>'
        + '<div class="big">' + fmtN(d.totalResponses) + '</div>'
        + '<div class="sub">' + fmtN(d.scoredResponses) + ' scored</div></div>',
      '<div class="ccbox"><div class="hd">Promoters / Neutrals / Detractors</div>'
        + '<div class="big"><span style="color:#2E7D32">' + fmtN(d.promoters) + '</span> / <span style="color:#d97706">' + fmtN(d.passives) + '</span> / <span style="color:#BE1D37">' + fmtN(d.detractors) + '</span></div>'
        + '<div class="sub">promoters / neutrals / detractors</div></div>',
    ];
    el.innerHTML = '<div class="cc3">' + boxes.join("") + '</div>';
  } catch (e) {
    asat.textContent = "";
    el.innerHTML = '<div class="empty">Fan-score data unavailable: ' + esc(e.message) + '</div>';
  }
}

// pause polling while the tab is hidden; refresh immediately when it returns
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (refreshTimer) clearTimeout(refreshTimer);
  } else {
    load();
  }
});

function render(d) {
  document.getElementById("storeLine").textContent =
    d.store.name + " · store " + d.store.storeNumber + " · site " + d.store.siteCode;

  const open = d.totals.byStatus.find(s => s.line_status === "open") || {};
  const kpis = [
    ["Total committed (open)", R(d.totals.openValueCents)],
    ["Open PO lines", d.totals.openLines],
    ["Critical anomalies", d.anomalyCounts.CRITICAL || 0],
    ["Stale open orders", d.staleOpenOrders],
  ];
  document.getElementById("kpis").innerHTML = kpis.map(([l,v]) =>
    '<div class="card kpi"><div class="v">'+esc(v)+'</div><div class="l">'+esc(l)+'</div></div>').join("");

  // budgets
  const bEl = document.getElementById("budgets");
  if (!d.budgets.length) { bEl.innerHTML = '<div class="empty">No budgets defined. POST /api/budgets to add one.</div>'; }
  else {
    bEl.innerHTML = d.budgets.map(b => {
      const scope = b.scopeType + (b.scopeRef ? ":"+b.scopeRef : "");
      const pct = Math.min(b.usedPct, 100);
      const colorVar = {GREEN:"--green",AMBER:"--amber",TIGHT:"--orange",OVER:"--red"}[b.status];
      return '<div style="margin-bottom:14px">'
        + '<div style="display:flex;justify-content:space-between;align-items:center">'
        + '<strong>'+esc(b.period)+' · '+esc(scope)+'</strong>'
        + '<span class="pill '+b.status+'">'+b.status+' · '+b.usedPct+'%</span></div>'
        + '<div class="muted" style="font-size:12px">'+R(b.committedCents)+' of '+R(b.capCents)
        + ' · '+(b.remainingCents>=0?'remaining ':'over by ')+R(Math.abs(b.remainingCents))+'</div>'
        + '<div class="bar"><i style="width:'+pct+'%;background:var('+colorVar+')"></i></div></div>';
    }).join("");
  }

  // aging
  const order = ["not_due","overdue_1_7","overdue_8_21","overdue_22_plus","no_date"];
  const aging = document.getElementById("aging");
  const rows = order.map(k => d.aging.find(a => a.bucket === k)).filter(Boolean);
  aging.innerHTML = rows.length ? rows.map(a =>
    '<tr><td>'+esc(AGING_LABELS[a.bucket]||a.bucket)+'</td><td class="num">'+a.n
    +'</td><td class="num">'+R(a.value_cents)+'</td></tr>').join("")
    : '<tr><td colspan="3" class="empty">No open orders.</td></tr>';

  // anomalies
  const an = document.getElementById("anomalies");
  an.innerHTML = d.topAnomalies.length ? d.topAnomalies.map(a =>
    '<tr><td class="sev-'+a.severity+'">'+a.severity+'</td><td>'+esc(a.type)
    +'</td><td>'+esc(a.message)+'</td></tr>').join("")
    : '<tr><td colspan="3" class="empty">No open anomalies. 🎉</td></tr>';

  // uploads
  const up = document.getElementById("uploads");
  up.innerHTML = d.recentUploads.length ? d.recentUploads.map(u =>
    '<tr><td>'+esc(u.filename)+'</td><td>'+esc(u.status)+'</td><td class="num">'+u.row_count
    +'</td><td class="muted">'+esc((u.uploaded_at||"").replace("T"," ").replace("Z",""))+'</td></tr>').join("")
    : '<tr><td colspan="4" class="empty">No uploads yet.</td></tr>';

  renderGrPanel(d.grPanel);
  renderMarginPerf(d.marginPerformance);
}

const pct = v => v == null ? "—" : v.toFixed(1) + "%";
const ppDelta = v => v == null ? "" : '<span class="'+(v<0?"neg":"pos")+'">'+(v>=0?"+":"")+v.toFixed(1)+"pp</span>";
// colour a margin value by how it sits against its guideline
function marginColour(actual, guide){
  if (actual == null) return "var(--muted)";
  if (actual < 0) return "var(--red)";
  if (guide == null) return "var(--pnp-blue)";
  if (actual >= guide) return "var(--green)";
  if (actual >= guide - 2) return "var(--amber)";
  if (actual >= guide - 5) return "var(--orange)";
  return "var(--red)";
}
// horizontal bar scaled so 50% margin fills the track; guideline tick overlaid
function marginBar(actual, guide){
  const scale = v => Math.max(0, Math.min(100, (v/50)*100));
  const w = actual == null ? 0 : scale(actual);
  const tick = guide == null ? null : scale(guide);
  const col = marginColour(actual, guide);
  let html = '<div class="mbar"><i style="width:'+w+'%;background:'+col+'"></i>';
  if (tick != null) html += '<span style="position:absolute;top:-2px;bottom:-2px;left:'+tick+'%;width:2px;background:var(--ink);opacity:.55"></span>';
  return html + '</div>';
}

function renderGrPanel(p){
  const el = document.getElementById("grPanel");
  if (!p) { el.innerHTML = '<div class="empty">No goods-receipt uploads yet. POST /api/gr-uploads to add one.</div>'; return; }
  const t = p.totals;
  let html = '<div class="muted" style="font-size:12px;margin-bottom:8px">'+esc(p.filename)
    +' · '+esc((p.uploadedAt||"").replace("T"," ").replace("Z",""))+'</div>';
  html += '<div class="kv">'
    + '<div>Total cost<b>'+R2(t.costZar)+'</b></div>'
    + '<div>Total sell<b>'+R2(t.sellZar)+'</b></div>'
    + '<div>Blended margin<b style="color:'+marginColour(t.blendedMarginPct,null)+'">'+pct(t.blendedMarginPct)+'</b></div>'
    + '<div>Lines<b>'+t.lines+'</b></div></div>';

  html += '<table><thead><tr><th>Dept</th><th class="num">Cost</th><th class="num">Sell</th>'
    + '<th class="num">Margin</th><th>vs guideline</th><th class="num">Δ</th></tr></thead><tbody>';
  html += (p.departments||[]).map(d => {
    const cls = d.marginPct!=null && d.marginPct<0 ? "critrow" : (d.deltaPp!=null && d.deltaPp < -10 ? "warnrow" : "");
    return '<tr class="'+cls+'"><td>'+esc(d.deptCode)+' '+esc(d.deptName||"")+'</td>'
      + '<td class="num">'+R2(d.costZar)+'</td><td class="num">'+R2(d.sellZar)+'</td>'
      + '<td class="num" style="color:'+marginColour(d.marginPct,d.guidelineMarginPct)+'">'+pct(d.marginPct)+'</td>'
      + '<td>'+marginBar(d.marginPct,d.guidelineMarginPct)+'<span class="muted" style="font-size:11px"> g '+pct(d.guidelineMarginPct)+'</span></td>'
      + '<td class="num">'+ppDelta(d.deltaPp)+'</td></tr>';
  }).join("") || '<tr><td colspan="6" class="empty">No lines.</td></tr>';
  html += '</tbody></table>';

  if (p.anomalies && p.anomalies.length){
    html += '<div style="margin-top:12px"><strong>Margin flags</strong><table><tbody>'
      + p.anomalies.map(a => '<tr class="'+(a.severity==="CRITICAL"?"critrow":"warnrow")+'">'
        + '<td class="sev-'+a.severity+'">'+a.severity+'</td><td>'+esc(a.type)+'</td>'
        + '<td>'+esc(a.message)+'</td></tr>').join("")
      + '</tbody></table></div>';
  } else {
    html += '<div class="prod-note">No negative or low-margin flags on this upload. 🎉</div>';
  }
  el.innerHTML = html;
}

function renderMarginPerf(mp){
  const el = document.getElementById("marginPerf");
  if (!mp) { el.innerHTML = '<div class="empty">No FIM data yet. POST /api/fim-uploads to add a daily FIM.</div>'; return; }
  let html = '<div class="muted" style="font-size:12px;margin-bottom:4px">Latest FIM: '+esc(mp.reportDate)+'</div>';
  let showedProdNote = false;
  for (const grp of mp.groups){
    if (!grp.departments.length) continue;
    html += '<div class="grp-h">'+esc(grp.group)+'</div>';
    html += '<table><thead><tr><th>Dept</th><th class="num">Margin</th><th>vs guideline</th>'
      + '<th class="num">Δ</th><th class="num">Partic.</th><th class="num">Guide</th><th class="num">Δ</th></tr></thead><tbody>';
    html += grp.departments.map(d => {
      const partDelta = (d.participationPct!=null && d.participationGuidelinePct!=null)
        ? Math.round((d.participationPct - d.participationGuidelinePct)*100)/100 : null;
      const prod = d.isProduction ? ' <span class="muted" title="daily production distortion">⚙</span>' : "";
      if (d.isProduction) showedProdNote = true;
      return '<tr><td>'+esc(d.deptCode)+' '+esc(d.deptName||"")+prod
        + (d.worst ? '<span class="worst-tag">worst</span>' : '')+'</td>'
        + '<td class="num" style="color:'+marginColour(d.marginPct,d.guidelineMarginPct)+'">'+pct(d.marginPct)+'</td>'
        + '<td>'+marginBar(d.marginPct,d.guidelineMarginPct)+'</td>'
        + '<td class="num">'+ppDelta(d.marginDeltaPp)+'</td>'
        + '<td class="num">'+pct(d.participationPct)+'</td>'
        + '<td class="num muted">'+pct(d.participationGuidelinePct)+'</td>'
        + '<td class="num">'+ppDelta(partDelta)+'</td></tr>';
    }).join("");
    html += '</tbody></table>';
  }
  if (showedProdNote){
    html += '<p class="prod-note">⚙ F06 Instore Bakery &amp; F09 Butchery: daily margins are distorted by in-store production '
      + '(receipts and sales land on different days) — anomalies for these depts are informational until a full fiscal week is loaded.</p>';
  }
  el.innerHTML = html;
}

load();
</script>
</body>
</html>`;

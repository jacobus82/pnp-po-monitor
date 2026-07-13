/**
 * Single-page application shell for the PO Monitor (served at GET / and /app).
 * Navy theme, fixed left navigation, hash-routed content area, no page reloads.
 * Self-contained: all CSS/JS inline, data via the /api/* endpoints.
 *
 * The embedded script uses string concatenation (no template literals / no
 * regex) so it survives being held inside this outer template literal.
 */
export const APP_HTML = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
<meta http-equiv="Pragma" content="no-cache" />
<meta http-equiv="Expires" content="0" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0B3D6B" />
<meta name="color-scheme" content="light" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icon-192.png" />
<link rel="icon" type="image/svg+xml" href="/icon-192.svg" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="PO Monitor" />
<title>PO Monitor — Pick n Pay Lydenburg</title>
<style>
  :root{
    --header:#0B3D6B; --nav:#2E6CA8; --navhover:#27598c; --red:#BE1D37;
    --green:#1a8a3f; --amber:#d8a400; --orange:#e06f00;
    --ink:#1b2733; --muted:#6a7480; --line:#e2e7ec; --bg:#eef1f4; --card:#fff;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%}
  body{font:13.5px/1.45 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg)}
  .app{display:flex;min-height:100vh}
  /* sidebar */
  aside{width:212px;flex:0 0 212px;background:var(--nav);color:#fff;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto}
  aside .brand{background:var(--header);padding:14px 16px;font-weight:700;font-size:15px;line-height:1.2}
  aside .brand small{display:block;font-weight:400;font-size:11px;opacity:.8;margin-top:2px}
  nav a{display:flex;align-items:center;gap:9px;padding:9px 16px;color:#eaf1f8;text-decoration:none;font-size:13px;border-left:3px solid transparent;cursor:pointer}
  nav a .ic{width:18px;text-align:center}
  nav a:hover{background:var(--navhover)}
  nav a.active{background:var(--header);border-left-color:#fff;font-weight:600}
  .navgrp-h{display:flex;justify-content:space-between;align-items:center;padding:9px 16px 5px;font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#bcd2e8;cursor:pointer;user-select:none}
  .navgrp-h:hover{color:#fff}
  .navgrp-x{font-size:14px;opacity:.85;line-height:1}
  .navgrp-items{display:none}
  .navgrp.expanded .navgrp-items{display:block}
  /* main */
  main{flex:1;min-width:0;display:flex;flex-direction:column}
  header.top{background:var(--header);color:#fff;padding:12px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px}
  header.top h1{margin:0;font-size:17px;font-weight:600}
  header.top .store{font-size:11px;opacity:.85}
  .view{padding:20px;max-width:1280px;width:100%;margin:0 auto}
  /* generic */
  .cards{display:grid;gap:14px}
  .kpis{grid-template-columns:repeat(auto-fit,minmax(170px,1fr));margin-bottom:16px}
  .g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:1fr 1fr 1fr}
  @media(max-width:900px){.g2,.g3{grid-template-columns:1fr}}
  .card{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:15px;box-shadow:0 1px 2px rgba(0,0,0,.03)}
  .card h2{margin:0 0 11px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  .kpi .v{font-size:23px;font-weight:700}.kpi .l{font-size:11px;color:var(--muted);margin-top:3px}
  .kpi .sub{font-size:11px;color:var(--muted);margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:12.5px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  th{color:var(--muted);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;cursor:pointer;user-select:none;position:sticky;top:0;background:var(--card)}
  th.num,td.num{text-align:right;font-variant-numeric:tabular-nums}
  th.sorted::after{content:" \\2193";opacity:.7}
  th.sorted.asc::after{content:" \\2191"}
  tbody tr:hover{background:#f5f8fb;cursor:pointer}
  .tablewrap{max-height:560px;overflow:auto;border:1px solid var(--line);border-radius:8px}
  .toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
  input.search,select.sel,input.inp{border:1px solid var(--line);border-radius:6px;padding:6px 9px;font-size:13px}
  input.search{min-width:220px}
  .pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;color:#fff}
  .badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;color:#fff;letter-spacing:.3px}
  .badge-native{background:#0B3D6B}.badge-pdf{background:#2E6CA8}
  .GREEN{background:var(--green)}.AMBER{background:var(--amber)}.TIGHT{background:var(--orange)}.OVER{background:var(--red)}
  .sev-CRITICAL{color:var(--red);font-weight:700}.sev-WARN{color:var(--orange);font-weight:600}.sev-INFO{color:var(--muted)}
  .pos{color:var(--green)}.neg{color:var(--red)}
  .muted{color:var(--muted)}.right{text-align:right}.small{font-size:11.5px}
  .bar{height:18px;background:#eef2f6;border-radius:4px;overflow:hidden;position:relative;min-width:80px}
  .bar>i{display:block;height:100%}
  .hbar{display:grid;grid-template-columns:150px 1fr 90px;gap:8px;align-items:center;margin:4px 0;font-size:12px}
  .hbar .lab{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hbar .val{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  button.btn{background:var(--nav);color:#fff;border:0;border-radius:6px;padding:7px 13px;cursor:pointer;font-size:12.5px}
  button.btn:hover{background:var(--navhover)}
  button.btn.alt{background:#fff;color:var(--nav);border:1px solid var(--nav)}
  button.btn.red{background:var(--red)}
  a.link{color:var(--nav);cursor:pointer;text-decoration:underline}
  .err{background:#fdecea;color:#8a1c14;padding:10px 14px;border-radius:8px}
  .loading{color:var(--muted);padding:24px;text-align:center}
  .tag{display:inline-block;background:#eef2f6;border:1px solid var(--line);border-radius:5px;padding:1px 6px;font-size:11px}
  /* context menu */
  #ctx{position:fixed;z-index:1000;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 6px 22px rgba(0,0,0,.18);padding:5px;display:none;min-width:200px}
  #ctx div{padding:7px 11px;border-radius:6px;cursor:pointer;font-size:13px}
  #ctx div:hover{background:#eef4fb}
  /* modal */
  #modal{position:fixed;inset:0;background:rgba(10,25,45,.45);z-index:900;display:none;align-items:flex-start;justify-content:center;padding:32px}
  #modal .box{background:#fff;border-radius:12px;max-width:1040px;width:100%;max-height:88vh;overflow:auto;padding:0}
  #modal .mh{position:sticky;top:0;background:var(--header);color:#fff;padding:13px 18px;display:flex;justify-content:space-between;align-items:center}
  #modal .mh h2{margin:0;font-size:16px;color:#fff;text-transform:none;letter-spacing:0}
  #modal .mb{padding:18px}
  #modal .x{cursor:pointer;font-size:20px;line-height:1;opacity:.85}
  .tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:8px 0 12px;flex-wrap:wrap}
  .tabs button{background:none;border:0;padding:8px 12px;cursor:pointer;font-size:13px;color:var(--muted);border-bottom:2px solid transparent}
  .tabs button.active{color:var(--nav);border-bottom-color:var(--nav);font-weight:600}
  .svgwrap{width:100%;overflow:hidden}
  svg{display:block;width:100%;height:auto}
  .legend{font-size:11px;color:var(--muted);margin-top:4px}
  tr.rowg td:first-child{box-shadow:inset 4px 0 0 var(--green)} tr.rowg{background:#f1faf3}
  tr.rowa td:first-child{box-shadow:inset 4px 0 0 var(--amber)} tr.rowa{background:#fdf8e9}
  tr.rowr td:first-child{box-shadow:inset 4px 0 0 var(--red)} tr.rowr{background:#fdeff0}
  .warnico{color:var(--orange);cursor:help}
  .swatch{display:inline-block;width:11px;height:11px;border-radius:3px;vertical-align:middle}
  .swatch.sg{background:var(--green)} .swatch.sa{background:var(--amber)} .swatch.sr{background:var(--red)}
  iframe.upl{width:100%;height:calc(100vh - 130px);border:0;border-radius:8px;background:#fff}
  /* ---- mobile scaffolding (hidden on desktop) ---- */
  .mobile-only{display:none}
  .hamburger{background:transparent;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:4px 8px}
  .uploadm{color:#fff;font-size:20px;text-decoration:none;padding:4px 8px;border:1px solid rgba(255,255,255,.4);border-radius:7px}
  .subbar{background:#0a335c;color:#cfe0f0;font-size:11px;padding:5px 14px}
  #navOverlay{position:fixed;inset:0;background:rgba(8,20,38,.5);z-index:40;display:none}
  #botnav{position:fixed;left:0;right:0;bottom:0;z-index:60;background:var(--header);display:flex;justify-content:space-around;padding:4px 2px env(safe-area-inset-bottom,4px);box-shadow:0 -2px 10px rgba(0,0,0,.18)}
  #botnav a{flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;gap:1px;color:#bcd2e8;text-decoration:none;padding:5px 0;border-radius:8px;overflow:hidden;white-space:nowrap}
  #botnav a .bn-icon{font-size:22px;line-height:1}
  #botnav a .bn-label{font-size:10px;line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis}
  #botnav a.active{color:#BE1D37;background:rgba(255,255,255,.12)}
  /* card view (Option B) */
  .mcards{display:flex;flex-direction:column;gap:9px}
  .mcard{background:var(--card);border:1px solid var(--line);border-radius:9px;padding:11px 13px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
  .mcard .mc-t{font-weight:700;font-size:14px;margin-bottom:6px;color:var(--ink)}
  .mcard .mc-row{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:2px 0;border-top:1px solid #f0f3f6}
  .mcard .mc-l{color:var(--muted)}.mcard .mc-v{text-align:right;font-variant-numeric:tabular-nums}
  .scrollhint{display:none}
  /* loading skeleton */
  .skel{display:flex;flex-direction:column;gap:12px;padding:6px}
  .skbar{height:54px;border-radius:9px;background:linear-gradient(90deg,#eef1f4 25%,#e3e8ee 37%,#eef1f4 63%);background-size:400% 100%;animation:sk 1.3s ease infinite}
  @keyframes sk{0%{background-position:100% 0}100%{background-position:0 0}}
  /* margin-performance list rows (used on the dashboard, all viewports) */
  .mlist .mc-row{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:4px 0;border-top:1px solid #f0f3f6}
  .mlist .mc-row:first-child{border-top:0}
  .mlist .mc-l{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto}
  .mlist .mc-v{text-align:right;white-space:nowrap;flex:0 0 auto}
  /* dashboard anomaly card rows (mobile) */
  .anrow{padding:8px 0;border-top:1px solid var(--line)}
  .anrow:first-child{border-top:0}
  .anrow .anty{font-weight:600;font-size:12.5px;word-break:break-word;margin-top:1px}
  .anrow .anmsg{word-break:break-word}
  /* dashboard redesign: section headers, period-picker pills, clickable tiles, margin bars */
  .dash-sec{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--header);font-weight:800;margin:20px 0 9px;border-bottom:1px solid var(--line);padding-bottom:5px}
  .dash-sec .ws{float:right;font-weight:600;color:var(--muted);text-transform:none;letter-spacing:0;font-size:11px}
  .dashpicker{flex-wrap:wrap;gap:6px;align-items:center}
  .pbtn{border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:18px;padding:6px 13px;font-size:12.5px;cursor:pointer;font-weight:600;line-height:1}
  .pbtn:hover{border-color:var(--nav)}
  .pbtn.on{background:var(--nav);color:#fff;border-color:var(--nav)}
  .clik{cursor:pointer;transition:box-shadow .15s ease,transform .15s ease}
  .clik:hover{box-shadow:0 4px 14px rgba(11,61,107,.16);transform:translateY(-1px)}
  .mbars{margin-top:8px}
  .mbar{display:grid;grid-template-columns:46px 1fr auto;gap:7px;align-items:center;margin-bottom:4px;font-size:11.5px}
  .mbar .mbl{color:var(--muted)}
  .mbar .mbt{height:10px;background:#eef1f4;border-radius:5px;overflow:hidden}
  .mbar .mbt i{display:block;height:100%;border-radius:5px}
  .mbar .mbv{white-space:nowrap;font-weight:600}

  /* dashboard reflow: desktop keeps budget|anomalies side-by-side; mobile uses the §5 order */
  @media(min-width:761px){
    /* mobile-only chrome must stay hidden on desktop. #botnav's id rule (specificity
       100) outranks .mobile-only{display:none} (10), so force it off here. */
    #botnav{display:none !important}
    .hamburger{display:none !important}
    .uploadm{display:none !important}
    .subbar{display:none !important}
    .dashwrap{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
    .dashwrap>*{grid-column:1/-1;margin-top:0}
    .dashwrap>.d-budget{grid-column:1}
    .dashwrap>.d-anoms{grid-column:2}
  }
  @media(max-width:760px){
    .dashwrap{display:flex;flex-direction:column;gap:14px}
    .dashwrap>*{margin-top:0}
    .dashwrap>.d-kpis{order:1} .dashwrap>.d-budget{order:2} .dashwrap>.d-divperf{order:3}
    .dashwrap>.d-gr{order:4} .dashwrap>.d-aging{order:5} .dashwrap>.d-margin{order:6}
    .dashwrap>.d-anoms{order:7} .dashwrap>.d-uploads{order:8}
    .d-margin .mlist{max-height:300px;overflow:auto}
  }

  @media(max-width:760px){
    /* hard guards: nothing on the dashboard may exceed the viewport width */
    html,body{max-width:100vw;overflow-x:hidden}
    .view{overflow-x:hidden}
    .dashwrap>*{width:100% !important;max-width:100% !important;box-sizing:border-box}
    .card{max-width:100%;box-sizing:border-box;overflow:hidden}
    aside{position:fixed;left:0;top:0;height:100vh;z-index:50;transform:translateX(-100%);transition:transform .22s ease;box-shadow:2px 0 16px rgba(0,0,0,.25)}
    body.navopen aside{transform:translateX(0)}
    body.navopen #navOverlay{display:block}
    main{width:100%;min-width:0}
    .desktop-only{display:none !important}
    .mobile-only{display:flex}
    .subbar{display:block}
    header.top{padding:9px 10px;gap:8px}
    header.top h1{font-size:18px;font-weight:700;flex:1;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} /* page title 18px bold */
    #clock{display:none}
    .view{padding:12px;padding-bottom:74px}            /* room for bottom nav */
    body{font-size:15px}
    /* KPI tiles */
    .kpis{grid-template-columns:1fr 1fr !important;gap:10px}
    .kpi{min-width:0;overflow:hidden}
    .kpi .v{font-size:28px;font-weight:700;line-height:1.12;overflow-wrap:anywhere}  /* KPI number 28px bold; long values wrap rather than overflow */
    .kpi .l{font-size:10px;line-height:1.15}            /* KPI label 10px (avoids 2-line wrap) */
    .kpi .sub{font-size:10px}
    .d-divperf .cards{grid-template-columns:1fr !important}   /* division cards stack, never 2-col */
    .hbar{grid-template-columns:92px 1fr 60px;gap:6px;font-size:11.5px}  /* fit label+bar+compact value on narrow screens */
    .dhide{display:none}   /* hand-built Department Analysis columns hidden on mobile (Group, Purchases) */
    td.desc{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}  /* truncate Article description (~18 chars) on mobile */
    .g2,.g3{grid-template-columns:1fr !important}
    /* section headings 15px bold (override the desktop uppercase-muted style) */
    h2,.card h2{font-size:15px;font-weight:700;text-transform:none;letter-spacing:0;color:var(--ink)}
    /* tables: 13px cells, 8px padding, 80px min column width */
    table{font-size:13px}
    th,td{padding:8px;min-width:80px}
    th{font-size:12px;font-weight:700;text-transform:uppercase}  /* table header 12px bold uppercase */
    td{font-size:13px}                                            /* table cell 13px */
    .pill{font-size:11px;font-weight:700}                         /* badge/pill 11px bold */
    /* Option A: sticky first column while the table scrolls sideways */
    .tablewrap{-webkit-overflow-scrolling:touch}
    .tablewrap th:first-child,.tablewrap td:first-child{position:sticky;left:0;background:var(--card);z-index:1}
    .tablewrap thead th:first-child{z-index:2}
    .scrollhint{display:block;font-size:11px;color:var(--muted);text-align:center;margin:-4px 0 6px}
    input.search,select.sel,input.inp{font-size:16px;min-height:44px}   /* 16px stops iOS zoom */
    input.search{width:100%}
    button.btn{min-height:44px;font-size:14px}          /* button 14px */
    #modal{padding:0;align-items:stretch}
    #modal .box{max-width:100%;max-height:100vh;border-radius:0}
    .tabs{overflow-x:auto;flex-wrap:nowrap}
  }
</style>
</head>
<body>
<div class="app">
  <aside>
    <div class="brand">Pick n Pay Lydenburg<small>PO Monitor · store 2516 · NF16</small></div>
    <nav id="nav"></nav>
  </aside>
  <main>
    <header class="top">
      <button id="hamburger" class="hamburger mobile-only" aria-label="Open menu" onclick="openNav()">&#9776;</button>
      <h1 id="title">Dashboard</h1>
      <div class="store" id="clock"></div>
      <a class="uploadm mobile-only" href="#upload" aria-label="Upload files">&#8593;</a>
    </header>
    <div class="subbar mobile-only" id="subbar">Pick n Pay Lydenburg</div>
    <div class="view" id="view"><div class="loading">Loading…</div></div>
  </main>
</div>
<div id="navOverlay" onclick="closeNav()"></div>
<nav id="botnav" class="mobile-only">
  <a href="#dashboard" data-r="dashboard"><span class="bn-icon">&#127968;</span><span class="bn-label">Home</span></a>
  <a href="#open" data-r="open"><span class="bn-icon">&#128203;</span><span class="bn-label">Orders</span></a>
  <a href="#gr" data-r="gr"><span class="bn-icon">&#128666;</span><span class="bn-label">GR</span></a>
  <a href="#anomalies" data-r="anomalies"><span class="bn-icon">&#9888;</span><span class="bn-label">Risk</span></a>
  <a href="#upload" data-r="upload"><span class="bn-icon">&#8593;</span><span class="bn-label">Upload</span></a>
</nav>
<div id="ctx"></div>
<div id="modal"><div class="box"><div class="mh"><h2 id="modalTitle"></h2><span class="x" onclick="closeModal()">&times;</span></div><div class="mb" id="modalBody"></div></div></div>

<script>
// ---- nav definition ----
var NAV=[
 ["dashboard","\\uD83D\\uDCCA","Dashboard"],
 ["trading","\\uD83D\\uDCB9","Trading"],
 ["upload","\\uD83D\\uDCC1","Upload Files"],
 ["weekly","\\uD83D\\uDCC5","Weekly View"],
 ["monthly","\\uD83D\\uDCC6","Monthly View"],
 ["fy","\\uD83D\\uDCC8","Financial Year"],
 ["customers","\\uD83D\\uDC65","Customer Count"],
 ["fanscore","\\u2B50","Fan Score / NPS"],
 ["vendors","\\uD83C\\uDFEA","Vendor Analysis"],
 ["articles","\\uD83D\\uDCE6","Article Analysis"],
 ["categories","\\uD83D\\uDDC2","Category Analysis"],
 ["departments","\\uD83C\\uDFEC","Department Analysis"],
 ["ima","\\uD83D\\uDCCA","Integrated Margin Analysis"],
 ["hierarchy","\\uD83C\\uDF33","Merchandise Hierarchy"],
 ["waste","\\u267B","Waste & Shrinkage"],
 ["period","\\uD83D\\uDDD3","Period Analysis"],
 ["stock","\\uD83D\\uDCE6","Stock on Hand"],
 ["funding","\\uD83D\\uDCB5","Funding & Rebates"],
 ["shortage","\\uD83D\\uDCC9","Shortages"],
 ["purchase-orders","\\uD83D\\uDCD1","Purchase Orders"],
 ["budgets","\\uD83C\\uDFAF","Weekly Budgets"],
 ["open","\\uD83D\\uDCCB","Open Orders"],
 ["returns","\\u21A9","Returns to Vendor"],
 ["anomalies","\\u26A0","Risk & Anomalies"],
 ["gr","\\uD83D\\uDE9A","Goods Receipts"],
 ["cash","\\uD83D\\uDCB0","Cash & Creditors"],
 ["settings","\\u2699","Settings"],
 ["export","\\uD83D\\uDCE4","Export Reports"]
];

// Collapsible sidebar groups. Each lists NAV keys; render + toggle state persist
// per-group in localStorage under "nav-<group id>" (default expanded).
var NAV_GROUPS=[
 {id:"g-overview",label:"Overview",items:["dashboard","trading","weekly","monthly","fy","customers","fanscore"]},
 {id:"g-purchasing",label:"Purchasing",items:["purchase-orders","budgets","open","returns","gr","vendors","cash"]},
 {id:"g-analysis",label:"Analysis",items:["articles","categories","departments","ima","hierarchy","waste","period","stock","funding","shortage","anomalies"]},
 {id:"g-admin",label:"Admin",items:["upload","settings","export"]}
];

// Integrated Margin Analysis: 6 expandable groups, each with FIM-column items.
// Routing uses the (globally unique) col number, since item ids repeat across groups.
var IMA=[
{id:"ima-sales",label:"Sales & COS",icon:"\\uD83D\\uDCC8",items:[
{id:"fim-net-sales",label:"Net Sales (After Disc)",col:16},
{id:"fim-sales-qty",label:"Sales Qty SUn",col:17},
{id:"fim-total-cos",label:"Franchise Total COS",col:18},
{id:"fim-cos-mac",label:"Cost of Sales @ MAC",col:19},
{id:"fim-mac-corrections",label:"MAC Corrections",col:20},
{id:"fim-rtc-fresh",label:"RTC Fresh - Reversal",col:21},
{id:"fim-raw-materials",label:"Consumption of Raw Materials",col:23},
{id:"fim-shrink-consumption",label:"Shrink Consumption",col:24},
{id:"fim-surplus-consumption",label:"Surplus Consumption",col:25},
{id:"fim-idt-in",label:"IDT In",col:26},
{id:"fim-idt-out",label:"IDT Out",col:27},
{id:"fim-opening-soh",label:"Opening SOH",col:91},
{id:"fim-closing-soh",label:"Closing SOH",col:92},
{id:"fim-total-purchases",label:"Total Purchases",col:93},
{id:"fim-net-gr-cost",label:"Net Goods Receipt @ Cost",col:94},
{id:"fim-gr-cost",label:"Goods Receipt @ Cost",col:95},
{id:"fim-gr-return",label:"Goods Return @ Cost",col:96},
{id:"fim-dc-claims",label:"Manual DC Claims Allowance",col:97},
{id:"fim-corrections",label:"Corrections",col:98}
]},
{id:"ima-profit",label:"Profit",icon:"\\uD83D\\uDCB0",items:[
{id:"fim-pos-profit",label:"Franchise POS Profit",col:29},
{id:"fim-pos-margin",label:"POS Margin %",col:30},
{id:"fim-op-profit",label:"Franchise Operating POS Profit",col:64},
{id:"fim-op-margin",label:"Franchise Operating POS Margin %",col:65},
{id:"fim-store-profit",label:"Franchise Store Profit After Swell + Shortage",col:89},
{id:"fim-store-margin",label:"Franchise Store Margin %",col:90}
]},
{id:"ima-discounts",label:"Discounts & Funding",icon:"\\uD83C\\uDFF7\\uFE0F",items:[
{id:"fim-promo-offs",label:"Total Promo Price-Offs",col:1},
{id:"fim-comm-disc",label:"Total Commercial Disc",col:2},
{id:"fim-cos-manual",label:"COS Manual Funding",col:28},
{id:"fim-comm-disc-fund",label:"Total Commercial Disc Funding",col:31},
{id:"fim-line-disc-fund",label:"Total Line Disc Funding",col:32},
{id:"fim-auto-line-disc",label:"Automated Line Disc Funding",col:33},
{id:"fim-manual-line-disc",label:"Manual Line Disc Funding",col:39},
{id:"fim-basket-disc",label:"Total Basket Disc Funding",col:46},
{id:"fim-auto-basket",label:"Automated Basket Disc Funding",col:47},
{id:"fim-manual-basket",label:"Manual Basket Disc Funding",col:51},
{id:"fim-trade-invest",label:"Trade Invest Manual Funding",col:53}
]},
{id:"ima-sallies",label:"Sallies & Tallies",icon:"\\uD83E\\uDD1D",items:[
{id:"fim-sallies-total",label:"Total Sallies & Tallies",col:54},
{id:"fim-sallies-pct",label:"Sallies & Tallies %",col:55},
{id:"fim-sallies",label:"Sallies Total",col:56},
{id:"fim-sallies-vendor",label:"Sallies Vendor Funding",col:57},
{id:"fim-sallies-pnp",label:"Sallies PnP Funding",col:58},
{id:"fim-sallies-manual",label:"Sallies Manual Funding",col:59},
{id:"fim-tallies",label:"Tallies Total",col:60},
{id:"fim-tallies-vendor",label:"Tallies - Vendor Funding",col:61},
{id:"fim-tallies-pnp",label:"Tallies - PnP Funding",col:62},
{id:"fim-tallies-manual",label:"Tallies - Manual Funding",col:63},
{id:"fim-swell-total",label:"Total Swell Allowance",col:66},
{id:"fim-swell-pct",label:"Swell Allowance %",col:67},
{id:"fim-swell",label:"Swell Allowance",col:68},
{id:"fim-swell-topup",label:"Swell Top-Up Manual Funding",col:69},
{id:"fim-swell-iqf",label:"Swell IQF - Manual Funding",col:70}
]},
{id:"ima-shortages",label:"Shortages",icon:"\\u26A0\\uFE0F",items:[
{id:"fim-total-shortages",label:"Total Store Shortages",col:71},
{id:"fim-shortages-pct",label:"Store Shortages %",col:72},
{id:"fim-shortages-fund",label:"Shortages - Manual Funding",col:73},
{id:"fim-net-shrinkage",label:"NET Store Shrinkage / (Surplus)",col:74},
{id:"fim-net-shrinkage-pct",label:"NET Store Shrinkage / (Surplus) %",col:75},
{id:"fim-surplus",label:"Surplus",col:76},
{id:"fim-shrink",label:"Shrink",col:77},
{id:"fim-waste-total",label:"Total Waste (Valuated + ZSAL Articles)",col:78},
{id:"fim-waste-pct",label:"Waste %",col:79},
{id:"fim-waste-val",label:"Store Waste Valuated Articles",col:80},
{id:"fim-swell-waste",label:"Store Swell Waste (Valuated Articles)",col:81},
{id:"fim-waste-zsal",label:"Waste ZSAL Articles - Memo Line",col:82},
{id:"fim-rtc",label:"RTC",col:83}
]},
{id:"ima-transfers",label:"Transfers",icon:"\\uD83D\\uDD04",items:[
{id:"fim-total-trf",label:"Total Inter & Intra Branch Trf",col:99},
{id:"fim-ibt-zsal",label:"IBT ZSAL & ZBSA Articles",col:100},
{id:"fim-inter-branch",label:"INTER Branch Transfers (PO Z43&Z44)",col:101},
{id:"fim-ibt-cost",label:"IBT IN / OUT @ Cost",col:102},
{id:"fim-ibt-rev-cost",label:"IBT Reversal IN/OUT @ Cost",col:103},
{id:"fim-intra-branch",label:"INTRA Branch Transfers (Mvt 641&642)",col:104},
{id:"fim-ibt-mac",label:"IBT IN/OUT @MAC",col:105},
{id:"fim-ibt-rev-mac",label:"IBT Reversal IN/OUT @ MAC",col:106},
{id:"fim-idt-out",label:"IDT OUT",col:107},
{id:"fim-idt-out-val",label:"IDT OUT Valuated Articles",col:108},
{id:"fim-idt-out-zsal",label:"IDT OUT Zsal Articles",col:109},
{id:"fim-idt-in",label:"IDT IN",col:110},
{id:"fim-idt-in-val",label:"IDT IN Valuated Articles",col:111},
{id:"fim-idt-in-zsal",label:"IDT IN Zsal Articles",col:112},
{id:"fim-other-trf",label:"Other Transfers",col:113},
{id:"fim-shop-use",label:"Shop Use @ Cost (Z07)",col:114},
{id:"fim-shop-use-rev",label:"Reversal Shop Use @ Cost (Z08)",col:115},
{id:"fim-canteen",label:"Canteen @ Cost (Z15)",col:116},
{id:"fim-canteen-rev",label:"Reversal Canteen @ Cost (Z16)",col:117},
{id:"fim-mat-splits",label:"NET Material Splits Difference",col:118},
{id:"fim-create-struct",label:"Create Structured Article (Mvt 317)",col:119},
{id:"fim-create-struct-rev",label:"Create Structured Article Reversal (Mvt 318)",col:120},
{id:"fim-split-struct",label:"Split Structured Article (Mvt 319)",col:121},
{id:"fim-split-struct-rev",label:"Split Structured Article Reversal (Mvt 320)",col:122}
]}
];

// ---- helpers ----
function $(id){return document.getElementById(id)}
function isMobile(){return window.matchMedia("(max-width:760px)").matches}
function openNav(){document.body.classList.add("navopen")}
function closeNav(){document.body.classList.remove("navopen")}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(m){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[m]})}
function R(c){return "R"+(c==null?0:c/100).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}
function R0(c){return "R"+Math.round((c==null?0:c)/100).toLocaleString("en-ZA")}
function Rr(r){return "R"+(r==null?0:r).toLocaleString("en-ZA",{minimumFractionDigits:2,maximumFractionDigits:2})}
function pct(v){return v==null?"\\u2014":(Math.round(v*10)/10)+"%"}
function dmy(iso){if(!iso)return "";var p=String(iso).slice(0,10).split("-");return p.length<3?esc(iso):p[2]+"."+p[1]+"."+p[0]}
function num(n){return (n==null?0:n).toLocaleString("en-ZA")}
function api(path){return fetch(path,{cache:"no-store"}).then(function(r){if(!r.ok)return r.json().then(function(j){throw new Error(j.error||("HTTP "+r.status))});return r.json()})}
// Admin token for destructive routes (X-Admin-Token). Stored once in localStorage;
// prompt if missing or when force=true (e.g. after a 401 rejection).
function adminToken(force){var t="";try{t=localStorage.getItem("admin-token")||""}catch(e){}if(!t||force){t=window.prompt("Admin token (required for destructive actions):")||"";try{localStorage.setItem("admin-token",t)}catch(e){}}return t}
function adminHdr(){return {"X-Admin-Token":adminToken(false)}}
// POST/PUT JSON to an admin-guarded route; re-prompts for the token on a 401.
function adminSend(path,method,body){return fetch(path,{method:method,headers:{"content-type":"application/json","X-Admin-Token":adminToken(false)},body:JSON.stringify(body)}).then(function(r){if(r.status===401){adminToken(true);throw new Error("Admin token rejected — re-enter and retry")}return r.json()})}
function setHTML(h){$("view").innerHTML=h}
function loading(){setHTML('<div class="skel"><div class="skbar"></div><div class="skbar"></div><div class="skbar"></div></div>')}
function errBox(e){setHTML('<div class="err">'+esc(e&&e.message||e)+'</div>')}
// Compact a Rand string for mobile KPI tiles. Handles SA format (space grouping,
// comma decimal: "R9 283 585,16") AND US format ("R9,283,585.16"). Returns null
// for non-money / HTML / values under R10k (which already fit).
function trimZero(x){return x.length>=2&&x.slice(-2)===".0"?x.slice(0,-2):x}
function midTrunc(s,n){s=String(s==null?"":s);if(s.length<=n)return s;var k=n-1,head=Math.ceil(k*0.6),tail=k-head;return s.slice(0,head)+"\\u2026"+s.slice(s.length-tail)}
// Date label helpers for the cash-flow tile: "Mon 23 Jun" / "23 Jun".
var _M3=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var _D3=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function shortDate(iso){var p=String(iso==null?"":iso).split("-");return p.length===3?(+p[2])+" "+_M3[(+p[1])-1]:String(iso||"")}
function fmtDay(iso){var p=String(iso==null?"":iso).split("-");if(p.length!==3)return String(iso||"");var dt=new Date(Date.UTC(+p[0],(+p[1])-1,+p[2]));return _D3[dt.getUTCDay()]+" "+(+p[2])+" "+_M3[(+p[1])-1]}
function compactMoney(s){if(typeof s!=="string")return null;
  var str=s.trim();var neg=false;
  if(str.charAt(0)==="-"){neg=true;str=str.slice(1)}
  if(str.charAt(0)!=="R")return null;
  // drop spaces (regular 32, NBSP 160, narrow NBSP 8239, tab 9) so only digits + , . remain
  var raw=str.slice(1),t="";
  for(var i=0;i<raw.length;i++){var cc=raw.charCodeAt(i);if(cc!==32&&cc!==160&&cc!==8239&&cc!==9)t+=raw.charAt(i)}
  if(!t.length)return null;
  var hasC=t.indexOf(",")>=0,hasD=t.indexOf(".")>=0,norm;
  if(hasC&&hasD){norm=(t.lastIndexOf(",")>t.lastIndexOf("."))?t.split(".").join("").split(",").join("."):t.split(",").join("")}
  else if(hasC){var li=t.lastIndexOf(","),dec=t.length-li-1;norm=(t.indexOf(",")===li&&dec>0&&dec<=2)?(t.slice(0,li)+"."+t.slice(li+1)):t.split(",").join("")}
  else{norm=t}
  var n=Number(norm);if(!isFinite(n))return null;
  var a=Math.abs(n),out;
  if(a>=1e9)out=trimZero((a/1e9).toFixed(1))+"bn";
  else if(a>=1e6)out=trimZero((a/1e6).toFixed(1))+"m";
  else if(a>=1e4)out=String(Math.round(a/1e3))+"k";
  else return null;
  return (neg?"-R":"R")+out}
function kpi(label,value,sub){var v=value,t="";
  if(isMobile()){var c=compactMoney(value);if(c!=null){v=c;t=' title="'+esc(value)+'"'}}
  return '<div class="card kpi"><div class="v"'+t+'>'+v+'</div><div class="l">'+esc(label)+'</div>'+(sub?'<div class="sub">'+sub+'</div>':'')+'</div>'}
function statusPill(s){return '<span class="pill '+s+'">'+s+'</span>'}
function trafficFor(usedPct){return usedPct>=100?"OVER":usedPct>=95?"TIGHT":usedPct>=85?"AMBER":"GREEN"}

// horizontal bar list (top-N)
function hbars(items,maxV,fmt){
  if(!items.length)return '<div class="muted small">No data.</div>';
  var mx=maxV||Math.max.apply(null,items.map(function(i){return Math.abs(i.value)}))||1;
  return items.map(function(i){
    var w=Math.max(2,Math.round(Math.abs(i.value)/mx*100));
    var col=i.color||"var(--nav)";
    var vs=fmt(i.value);
    if(isMobile()){var cm=compactMoney(vs);if(cm!=null)vs=cm}   // abbreviate long Rand bar values on mobile
    return '<div class="hbar"><span class="lab" title="'+esc(i.label)+'">'+esc(i.label)+'</span>'
      +'<span class="bar"><i style="width:'+w+'%;background:'+col+'"></i></span>'
      +'<span class="val">'+vs+'</span></div>';
  }).join("");
}

// simple SVG column chart with optional budget line. series:[{label,value}]
function colChart(series,opts){
  opts=opts||{};var W=720,H=240,pad=34,bw,gap=6;
  if(!series.length)return '<div class="muted small">No data.</div>';
  // Mobile: vertical columns are cramped on a narrow screen, so render as a
  // horizontal bar list (labels ellipsis-truncated, full name in tooltip; bars
  // over the budget line flagged red).
  if(isMobile()){
    var bud=opts.budget;
    var items=series.map(function(s){return {label:s.label,value:s.value,color:(bud&&s.value>bud)?"var(--red)":"#2E6CA8"}});
    return hbars(items,null,Rr0)+(bud?'<div class="legend">Budget '+Rr0(bud)+' \\u00b7 bars over budget shown in red</div>':'');
  }
  var max=Math.max.apply(null,series.map(function(s){return s.value}));
  if(opts.budget)max=Math.max(max,opts.budget);
  max=max||1;
  var n=series.length;bw=(W-pad*2)/n-gap;
  var bars="",labels="";
  for(var i=0;i<n;i++){
    var x=pad+i*((W-pad*2)/n)+gap/2;
    var h=(series[i].value/max)*(H-pad*2);
    var y=H-pad-h;
    var col=series[i].color||"#2E6CA8";
    bars+='<rect x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+Math.max(0,h).toFixed(1)+'" fill="'+col+'" rx="2"><title>'+esc(series[i].label)+": "+R0(series[i].value)+'</title></rect>';
    if(n<=16)labels+='<text x="'+(x+bw/2).toFixed(1)+'" y="'+(H-pad+12)+'" font-size="9" text-anchor="middle" fill="#6a7480">'+esc(series[i].short||series[i].label)+'</text>';
    if(opts.valueLabels&&n<=16&&series[i].value>0)labels+='<text x="'+(x+bw/2).toFixed(1)+'" y="'+Math.max(9,y-3).toFixed(1)+'" font-size="8.5" text-anchor="middle" fill="#3a4550">'+esc((opts.valueFmt||R0)(series[i].value))+'</text>';
  }
  var bl="";
  if(opts.budget){var by=H-pad-(opts.budget/max)*(H-pad*2);bl='<line x1="'+pad+'" y1="'+by.toFixed(1)+'" x2="'+(W-pad)+'" y2="'+by.toFixed(1)+'" stroke="#BE1D37" stroke-width="1.5" stroke-dasharray="5 4"/><text x="'+(W-pad)+'" y="'+(by-4).toFixed(1)+'" font-size="9" text-anchor="end" fill="#BE1D37">budget</text>'}
  return '<div class="svgwrap"><svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="#e2e7ec"/>'+bars+bl+labels+'</svg></div>';
}

// SVG line chart. points:[{label,value}]
function lineChart(points){
  var W=720,H=220,pad=34;
  if(points.length<2)return '<div class="muted small">Not enough data points.</div>';
  var max=Math.max.apply(null,points.map(function(p){return p.value}))||1;
  var n=points.length,pts=[];
  for(var i=0;i<n;i++){var x=pad+i*((W-pad*2)/(n-1));var y=H-pad-(points[i].value/max)*(H-pad*2);pts.push(x.toFixed(1)+","+y.toFixed(1))}
  var dots=points.map(function(p,i){var x=pad+i*((W-pad*2)/(n-1));var y=H-pad-(p.value/max)*(H-pad*2);return '<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="2.5" fill="#2E6CA8"><title>'+esc(p.label)+": "+R(p.value*100)+'</title></circle>'}).join("");
  return '<div class="svgwrap"><svg viewBox="0 0 '+W+' '+H+'"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="#e2e7ec"/><polyline points="'+pts.join(" ")+'" fill="none" stroke="#2E6CA8" stroke-width="2"/>'+dots+'</svg></div>';
}

// ---- sortable / filterable table ----
// cols:[{key,label,num,fmt,html,mobileHide}]; opts:{rowMenu, onRow, search, cards}
var TBLSEQ=0;
function makeTable(cols,rows,opts){
  opts=opts||{};var id="tbl"+(++TBLSEQ);
  if(isMobile())cols=cols.filter(function(c){return !c.mobileHide});   // drop mobileHide:true columns on phones
  var cardMode=!!opts.cards&&isMobile();   // Option B (cards) on mobile for flagged screens
  var state={sort:null,asc:false,q:""};
  function cellVal(c,r){return c.html?c.html(r):(c.fmt?c.fmt(r[c.key],r):esc(r[c.key]))}
  function render(){
    var data=rows.slice();
    if(state.q){var q=state.q.toLowerCase();data=data.filter(function(r){return cols.some(function(c){return String(r[c.key]==null?"":r[c.key]).toLowerCase().indexOf(q)>=0})})}
    if(state.sort){var k=state.sort;data.sort(function(a,b){var x=a[k],y=b[k];if(x==null)x=-Infinity;if(y==null)y=-Infinity;if(typeof x==="number"&&typeof y==="number")return state.asc?x-y:y-x;return state.asc?String(x).localeCompare(String(y)):String(y).localeCompare(String(x))})}
    var c2=$(id+"_c");if(c2)c2.textContent=data.length+" rows";
    var box=$(id+"_t");if(!box)return;
    if(cardMode){
      box.innerHTML=data.length?data.map(function(r){var ri=rows.indexOf(r);
        var rest=cols.slice(1).map(function(c){return '<div class="mc-row"><span class="mc-l">'+esc(c.label)+'</span><span class="mc-v">'+cellVal(c,r)+'</span></div>'}).join("");
        return '<div class="mcard" data-i="'+ri+'"><div class="mc-t">'+cellVal(cols[0],r)+'</div>'+rest+'</div>'}).join("")
        :'<div class="muted" style="padding:16px;text-align:center">No rows.</div>';
      return;
    }
    var head=cols.map(function(c){var cl=((c.num?"num ":"")+(c.cls?c.cls+" ":"")+(state.sort===c.key?("sorted "+(state.asc?"asc":"")):"")).trim();return '<th class="'+cl+'" data-k="'+c.key+'">'+esc(c.label)+'</th>'}).join("");
    var body=data.length?data.map(function(r,i){var ri=rows.indexOf(r);
      var tds=cols.map(function(c){return '<td class="'+((c.num?"num ":"")+(c.cls||"")).trim()+'">'+cellVal(c,r)+'</td>'}).join("");
      return '<tr data-i="'+ri+'">'+tds+'</tr>'}).join("")
      :'<tr><td colspan="'+cols.length+'" class="muted" style="padding:16px;text-align:center">No rows.</td></tr>';
    box.innerHTML="<thead><tr>"+head+"</tr></thead><tbody>"+body+"</tbody>";
  }
  setTimeout(function(){
    var search=$(id+"_s");if(search)search.oninput=function(){state.q=this.value;render()};
    var t=$(id+"_t");
    if(t){
      t.addEventListener("click",function(e){var th=e.target.closest("th");if(th){var k=th.getAttribute("data-k");if(state.sort===k)state.asc=!state.asc;else{state.sort=k;state.asc=false}render();return}
        var el=e.target.closest("tr[data-i],.mcard[data-i]");if(el&&opts.onRow)opts.onRow(rows[+el.getAttribute("data-i")])});
      if(opts.rowMenu!==false)t.addEventListener("contextmenu",function(e){var el=e.target.closest("tr[data-i],.mcard[data-i]");if(el){e.preventDefault();showCtx(e,rows[+el.getAttribute("data-i")])}});
    }
    render();
  },0);
  var bodyHtml=cardMode
    ?'<div id="'+id+'_t" class="mcards"></div>'
    :'<div class="scrollhint mobile-only">\\u2190 scroll \\u2192</div><div class="tablewrap"><table id="'+id+'_t"></table></div>';
  return '<div class="toolbar">'+(opts.search===false?"":'<input class="search" id="'+id+'_s" placeholder="Search\\u2026">')
    +'<span class="muted small" id="'+id+'_c"></span>'+(opts.extra||"")+'</div>'+bodyHtml;
}

// ---- context menu ----
var ctxRow=null;
function showCtx(e,row){ctxRow=row;var c=$("ctx");
  c.innerHTML=''
   +(row.po_number?'<div onclick="ctxGo(\\'po\\')">\\uD83D\\uDCCB View PO detail</div>':'')
   +(row.vendor_code||row.code?'<div onclick="ctxGo(\\'vendor\\')">\\uD83C\\uDFEA View vendor</div>':'')
   +(row.article_code?'<div onclick="ctxGo(\\'article\\')">\\uD83D\\uDCE6 View article</div>':'')
   +'<div onclick="ctxGo(\\'anom\\')">\\u26A0 View anomalies for this item</div>';
  c.style.display="block";c.style.left=Math.min(e.clientX,innerWidth-220)+"px";c.style.top=Math.min(e.clientY,innerHeight-160)+"px";
}
function ctxGo(kind){var r=ctxRow;$("ctx").style.display="none";if(!r)return;
  if(kind==="article"&&r.article_code)openArticle(r.article_code);
  else if(kind==="vendor"&&(r.vendor_code||r.code))openVendor(r.vendor_code||r.code);
  else if(kind==="po"&&r.po_number)openPO(r.po_number);
  else if(kind==="anom")location.hash="#anomalies";
}
document.addEventListener("click",function(){$("ctx").style.display="none"});

// ---- modal ----
function openModal(title,body){$("modalTitle").innerHTML=title;$("modalBody").innerHTML=body;$("modal").style.display="flex"}
function closeModal(){$("modal").style.display="none"}
$("modal").addEventListener("click",function(e){if(e.target===this)closeModal()});

// ---- clickable cell links (stopPropagation so row handlers don't double-fire) ----
function poLink(po){return po?'<a class="link" onclick="event.stopPropagation();openPO(\\''+esc(po)+'\\')">'+esc(po)+'</a>':""}
function venLink(code,name){return code?'<a class="link" onclick="event.stopPropagation();openVendor(\\''+esc(code)+'\\')">'+esc(name||code)+'</a>':esc(name||"")}
function artLink(code){return code?'<a class="link" onclick="event.stopPropagation();openArticle(\\''+esc(code)+'\\')">'+esc(code)+'</a>':""}

// ---- detail openers ----
function openVendor(code){openModal("Vendor "+esc(code),'<div class="loading">Loading\\u2026</div>');
  api("/api/vendors/"+encodeURIComponent(code)).then(function(d){
    var k=d.kpis||{};
    var head='<div class="cards kpis">'+kpi("Purchases",R(k.purchases),null)+kpi("Returns",R(k.returns),null)
      +kpi("Open to deliver",R(k.open_deliver),null)+kpi("Open to invoice",R(k.open_invoice),null)
      +kpi("PO count",num(k.po_count),null)+kpi("Lines",num(k.lines),null)+'</div>';
    var tabs=['pos','articles','returns','lines'];var labels={pos:"POs",articles:"Articles",returns:"Returns",lines:"All Lines"};
    var tabBtns='<div class="tabs" id="vtabs">'+tabs.map(function(t,i){return '<button class="'+(i==0?"active":"")+'" onclick="vtab(\\''+t+'\\')">'+labels[t]+'</button>'}).join("")+'</div>';
    window._vd=d;
    openModal("Vendor "+esc(k.name||code)+' <span class="tag">'+esc(code)+'</span>',head+tabBtns+'<div id="vtabc"></div>');
    vtab("pos");
  }).catch(function(e){openModal("Vendor "+esc(code),'<div class="err">'+esc(e.message)+'</div>')});
}
function vtab(t){var d=window._vd;if(!d)return;
  document.querySelectorAll("#vtabs button").forEach(function(b){b.classList.toggle("active",b.textContent.toLowerCase().indexOf(t.slice(0,3))>=0)});
  var c=$("vtabc");
  if(t==="pos")c.innerHTML=makeTable([{key:"po_number",label:"PO"},{key:"order_date",label:"Date"},{key:"lines",label:"Lines",num:true},{key:"value",label:"Value",num:true,fmt:R},{key:"open_deliver",label:"Open deliver",num:true,fmt:R}],d.pos||[],{rowMenu:false,onRow:function(r){openPO(r.po_number)}});
  else if(t==="articles")c.innerHTML=makeTable([{key:"article_code",label:"Article"},{key:"description",label:"Description"},{key:"value",label:"Value",num:true,fmt:R},{key:"lines",label:"Lines",num:true}],d.articles||[],{onRow:function(r){openArticle(r.article_code)}});
  else if(t==="returns")c.innerHTML=makeTable([{key:"po_number",label:"PO"},{key:"order_date",label:"Date"},{key:"article_code",label:"Article"},{key:"description",label:"Description"},{key:"value",label:"Value",num:true,fmt:R}],d.returns||[],{rowMenu:false});
  else c.innerHTML=makeTable([{key:"po_number",label:"PO"},{key:"order_date",label:"Date"},{key:"article_code",label:"Article"},{key:"description",label:"Description"},{key:"mdse_cat",label:"Cat"},{key:"sloc",label:"SLoc"},{key:"order_qty",label:"Qty",num:true},{key:"net_price_cents",label:"Price",num:true,fmt:R},{key:"line_value_cents",label:"Value",num:true,fmt:R}],d.lines||[],{});
}
// 12 month keys (YYYY-MM) ending at the anchor month, oldest first.
function last12Months(anchor){
  if(!anchor)return [];
  var y=+String(anchor).slice(0,4),m=+String(anchor).slice(5,7),out=[];
  for(var i=11;i>=0;i--){var mm=m-i,yy=y;while(mm<=0){mm+=12;yy--;}out.push(yy+"-"+(mm<10?"0"+mm:mm));}
  return out;
}
function monLabel(ym){var M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];var p=String(ym).split("-");return p.length<2?ym:M[(+p[1])-1]+" "+p[0].slice(2);}
// Scaffold a 12-month series (missing months = 0) for a colChart bar block.
function monthlySeries(rows,key,anchor){
  var months=last12Months(anchor),byM={};(rows||[]).forEach(function(r){byM[r.month]=r});
  return months.map(function(ym){var r=byM[ym];return {label:monLabel(ym),short:monLabel(ym),value:r?(r[key]||0):0}});
}
// Lens 4 — monthly average unit price line over the last 12 months, each existing
// point labelled with its price; gaps (no orders that month) leave a break.
function artPriceChart(priceMonthly,anchor){
  var months=last12Months(anchor);
  if(!months.length)return '<div class="muted small">No price history.</div>';
  var byM={};(priceMonthly||[]).forEach(function(p){byM[p.month]=p});
  var pts=months.map(function(ym,i){var p=byM[ym];return {i:i,month:ym,value:(p&&p.unitPriceCents!=null)?(p.unitPriceCents/100):null}});
  var ex=pts.filter(function(p){return p.value!=null});
  if(!ex.length)return '<div class="muted small">No unit price in the last 12 months.</div>';
  var W=760,H=250,pad=48,n=months.length;
  var vals=ex.map(function(p){return p.value});
  var mx=Math.max.apply(null,vals),mn=Math.min.apply(null,vals);
  if(mx<=mn)mx=mn+Math.max(1,mn*0.1);var span=mx-mn||1;mn=Math.max(0,mn-span*0.2);mx=mx+span*0.28;
  function X(i){return pad+(n<=1?(W-2*pad)/2:i*(W-2*pad)/(n-1))}
  function Y(v){return H-pad-((v-mn)/(mx-mn))*(H-2*pad)}
  var line='<polyline points="'+ex.map(function(p){return X(p.i).toFixed(1)+","+Y(p.value).toFixed(1)}).join(" ")+'" fill="none" stroke="#2E6CA8" stroke-width="2"/>';
  var dots=ex.map(function(p){return '<circle cx="'+X(p.i).toFixed(1)+'" cy="'+Y(p.value).toFixed(1)+'" r="3.5" fill="#2E6CA8"><title>'+esc(monLabel(p.month))+": "+R(p.value*100)+'</title></circle>'}).join("");
  var vlabs=ex.map(function(p){return '<text x="'+X(p.i).toFixed(1)+'" y="'+Math.max(12,Y(p.value)-8).toFixed(1)+'" font-size="9" font-weight="700" text-anchor="middle" fill="#2E6CA8">'+R(p.value*100)+'</text>'}).join("");
  var xlabs=months.map(function(ym,i){return '<text x="'+X(i).toFixed(1)+'" y="'+(H-pad+16)+'" font-size="9" fill="#6a7480" text-anchor="middle">'+esc(monLabel(ym))+'</text>'}).join("");
  var yax='<text x="'+(pad-6)+'" y="'+(pad+4)+'" font-size="10" fill="#6a7480" text-anchor="end">'+R(mx*100)+'</text><text x="'+(pad-6)+'" y="'+(H-pad)+'" font-size="10" fill="#6a7480" text-anchor="end">'+R(mn*100)+'</text>';
  return '<div class="svgwrap"><svg viewBox="0 0 '+W+' '+H+'"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="#e2e7ec"/>'+line+dots+vlabs+yax+xlabs+'</svg></div>';
}
function openArticle(code){openModal("Article "+esc(code),'<div class="loading">Loading\\u2026</div>');
  api("/api/articles/"+encodeURIComponent(code)).then(function(d){
    var k=d.kpis||{},fim=d.fim;
    var pb=k.price_basis==="unit"?("per "+esc(k.sku_uom||"unit")):"per order unit";
    var fimHint=d.fimEarliestGlobal?("FIM articles from "+esc(d.fimEarliestGlobal)):"not in FIM";
    // Lens 1/2 — PO ordered, GR received, unit price, and the FIM cross-match.
    var head='<div class="cards kpis">'
      +kpi("PO value ordered",R(k.total_value),num(k.order_count)+" orders")
      +kpi("GR value received",Rr0(k.grCostZar),k.grLines?(num(k.grLines)+" GR lines"):"no GR")
      +kpi("Unit price",R(k.avg_price),pb)
      +kpi("FIM net sales",fim?Rr0(fim.sales):'\\u2014',fim?("since "+esc(fim.earliest)):fimHint)
      +kpi("FIM waste / shrink",fim?(Rr0(fim.waste)+" / "+Rr0(fim.shrink)):'\\u2014',fim?"FIM article rows":fimHint)
      +'</div>';
    // Lens 4 — 12-month monthly average unit price.
    var priceChart='<div class="card" style="margin-top:14px"><h2>Unit price \\u00b7 monthly average <span class="muted small">last 12 months</span></h2>'+artPriceChart(d.priceMonthly,d.anchor)+'</div>';
    // Lens 5 — GR value by month; waste/shrink by month where FIM has the article.
    var grBars='<div class="card" style="margin-top:14px"><h2>GR value received by month <span class="muted small">@ cost</span></h2>'+colChart(monthlySeries(d.grMonthly,"cost",d.anchor),{valueLabels:true,valueFmt:Rr0})+'</div>';
    var wasteShrink;
    if(fim){
      wasteShrink='<div class="cards g2" style="margin-top:14px">'
        +'<div class="card"><h2>Waste by month <span class="muted small">FIM</span></h2>'+colChart(monthlySeries(d.fimMonthly,"waste",d.anchor),{valueLabels:true,valueFmt:Rr0})+'</div>'
        +'<div class="card"><h2>Shrink by month <span class="muted small">FIM</span></h2>'+colChart(monthlySeries(d.fimMonthly,"shrink",d.anchor),{valueLabels:true,valueFmt:Rr0})+'</div>'
        +'</div>';
    }else{
      wasteShrink='<div class="card" style="margin-top:14px"><h2>Waste &amp; shrink <span class="muted small">FIM</span></h2><div class="muted small">No FIM article-level data for this item'+(d.fimEarliestGlobal?' \\u2014 FIM article data begins '+esc(d.fimEarliestGlobal)+' (going-forward only)':'')+'.</div></div>';
    }
    // Lens 3 — funding is not article-attributable in the statement data (user decision: omit + note).
    var fundNote='<div class="card" style="margin-top:14px"><h2>Funding</h2><div class="muted small">Funding (Bonus Buy / Swell / rebates) is not article-attributable in the account-statement data: Bonus Buy lines carry only a promo-batch reference and Swell is booked at category level. See the Funding screen for department-level totals.</div></div>';
    var lines=makeTable([{key:"po_number",label:"PO"},{key:"order_date",label:"Date"},{key:"vendor",label:"Vendor"},{key:"order_qty",label:"Qty",num:true},{key:"net_price_cents",label:"Order price",num:true,fmt:R},{key:"line_value_cents",label:"Value",num:true,fmt:R},{key:"sloc",label:"SLoc"}],d.lines||[],{});
    openModal("Article "+esc(k.description||code)+' <span class="tag">'+esc(code)+"</span> <span class=\\"tag\\">"+esc(k.dept||"")+"</span>",head+priceChart+grBars+wasteShrink+fundNote+'<div class="card" style="margin-top:14px"><h2>Order lines</h2>'+lines+'</div>');
  }).catch(function(e){openModal("Article "+esc(code),'<div class="err">'+esc(e.message)+'</div>')});
}
function openPO(po){openModal("PO "+esc(po),'<div class="loading">Loading\\u2026</div>');
  api("/api/po-lines/"+encodeURIComponent(po)).then(function(d){
    var lines=d.lines||[];var s=d.summary||{};
    if(!lines.length){openModal("PO "+esc(po),'<div class="muted">No lines found for this PO.</div>');return}
    var head='<div class="cards kpis">'
      +kpi("Vendor",esc(s.vendor_name||s.vendor_code||"\\u2014"),s.vendor_code?esc(s.vendor_code):null)
      +kpi("Order date",esc(s.order_date||"\\u2014"),null)
      +kpi("Total value",R(s.total_value_cents),null)
      +kpi("Open value",R(s.open_value_cents),null)
      +kpi("Line count",num(s.line_count),null)+'</div>';
    var tbl=makeTable([
      {key:"article_code",label:"Article"},{key:"article_description",label:"Description"},
      {key:"category_code",label:"Cat"},{key:"storage_location",label:"SLoc"},
      {key:"order_qty",label:"Qty",num:true},{key:"delivered_qty",label:"Delivered",num:true},
      {key:"net_price_cents",label:"Price",num:true,fmt:R},{key:"line_value_cents",label:"Value",num:true,fmt:R},
      {key:"open_value_cents",label:"Open deliver",num:true,fmt:R},{key:"open_invoice_cents",label:"Open invoice",num:true,fmt:R},
      {key:"delivery_date",label:"Delivery"},{key:"line_status",label:"Status"}
    ],lines,{onRow:function(r){if(r.article_code)openArticle(r.article_code)}});
    openModal("PO "+esc(po)+(s.vendor_name?' <span class="tag">'+esc(s.vendor_name)+'</span>':''),head+'<div class="card" style="margin-top:14px"><h2>Order lines</h2>'+tbl+'</div>');
  }).catch(function(e){openModal("PO "+esc(po),'<div class="err">'+esc(e.message)+'</div>')});
}

// ============ PAGES ============
// Rand formatter, no decimals (GR/FIM values are already in Rands, not cents).
function Rr0(r){return "R"+Math.round(r==null?0:r).toLocaleString("en-ZA")}

// Shared Goods-Receipts + FIM panels for a date range (Weekly/Monthly/FY).
function grFimSection(gr,fim){
  var gt=(gr&&gr.totals)||{};
  var grCard='<div class="card"><h2>Goods receipts (received this period)</h2>';
  if(gt.lines){
    grCard+='<div class="cards kpis">'+kpi("GR cost",Rr0(gt.costZar),null)+kpi("GR sell",Rr0(gt.sellZar),null)
      +kpi("Blended margin",pct(gt.blendedMarginPct),null)+kpi("Lines",num(gt.lines),null)+'</div>';
    grCard+='<div style="margin-top:6px">'+hbars((gr.departments||[]).slice(0,8).map(function(d){return {label:d.deptCode+" "+(d.deptName||""),value:d.sellZar||0}}),null,Rr0)+'</div>';
    grCard+='<div class="legend">Receipt periods overlapping this view (GR is loaded in ~bi-weekly batches).</div>';
  } else grCard+='<div class="muted small">No goods receipts overlapping this period.</div>';
  grCard+='</div>';
  var fd=(fim&&fim.departments)||[];
  var sales=0,cos=0;fd.forEach(function(d){sales+=d.salesZar||0;cos+=d.cosZar||0});
  var fimCard='<div class="card"><h2>FIM margins (sales this period)</h2>';
  if(fd.length){
    var marg=sales>0?Math.round((sales-cos)/sales*1000)/10:null;
    fimCard+='<div class="cards kpis">'+kpi("Net sales",Rr0(sales),null)+kpi("Margin",pct(marg),null)
      +kpi("Waste",Rr0(fd.reduce(function(a,d){return a+(d.wasteZar||0)},0)),null)+kpi("Departments",num(fd.length),null)+'</div>';
    fimCard+='<div style="margin-top:6px">'+hbars(fd.slice(0,8).map(function(d){return {label:d.deptCode+" "+(d.deptName||""),value:d.salesZar||0}}),null,Rr0)+'</div>';
  } else fimCard+='<div class="muted small">No FIM reports cover this period. Load FIM via Upload Files.</div>';
  fimCard+='</div>';
  return '<div class="cards g2" style="margin-top:14px">'+grCard+fimCard+'</div>';
}

var PAGES={};

// ---- dashboard period picker + Row 1/Row 2 tiles (/api/dashboard/tiles) ----
function budgetBarCol(status){return status==="OVER"?"var(--red)":status==="TIGHT"?"var(--orange)":status==="AMBER"?"var(--amber)":"var(--green)"}
// PO/GR "actual this period" tile: big actual, % of budget, progress bar.
function poGrTile(label,actualCents,usedPct,status){
  var up=usedPct||0;
  return '<div class="card kpi"><div class="v">'+R(actualCents)+'</div><div class="l">'+esc(label)+'</div>'
    +'<div class="sub">'+pct(up)+' of budget</div>'
    +'<div class="bar" style="margin-top:6px"><i style="width:'+Math.min(Math.max(up,0),100)+'%;background:'+budgetBarCol(status)+'"></i></div></div>';
}
// Row-2 window tile: sales vs budget (+var), PO total, GR total, margin.
// clickable KPI tile (value may contain HTML); navigates to a hash on click.
function clikKpi(label,value,sub,hash){
  return '<div class="card kpi clik" onclick="location.hash=\\''+hash+'\\'" title="Open '+esc(label)+'"><div class="v">'+value+'</div><div class="l">'+esc(label)+'</div>'+(sub?'<div class="sub">'+sub+'</div>':'')+'</div>';
}
// clickable PO/GR actual tile (big value, % of budget, progress bar).
function clikPoGr(label,actualCents,usedPct,status,hash){
  var up=usedPct||0;
  return '<div class="card kpi clik" onclick="location.hash=\\''+hash+'\\'" title="Open '+esc(label)+'"><div class="v">'+R(actualCents)+'</div><div class="l">'+esc(label)+'</div>'
    +'<div class="sub">'+pct(up)+' of budget</div>'
    +'<div class="bar" style="margin-top:6px"><i style="width:'+Math.min(Math.max(up,0),100)+'%;background:'+budgetBarCol(status)+'"></i></div></div>';
}
// Shared PO display: Net is the headline (navy), with Gross and Returns as muted
// sub-text. All args in CENTS (returnsCents <= 0). opts: {large, pct, status}.
function poTriple(grossCents,returnsCents,netCents,opts){
  opts=opts||{};
  var retTxt=(returnsCents==null||returnsCents===0)?R(0):'-'+R(-returnsCents);
  var pctHtml=opts.pct!=null?'<div class="sub" style="margin-top:4px">'+pct(opts.pct)+' of budget</div>':'';
  var bar=(opts.pct!=null&&opts.status)?'<div class="bar" style="margin-top:6px"><i style="width:'+Math.min(Math.max(opts.pct,0),100)+'%;background:'+budgetBarCol(opts.status)+'"></i></div>':'';
  return '<div style="font-size:'+(opts.large?'26':'20')+'px;font-weight:800;color:var(--nav)">'+R(netCents)+' <span class="small muted" style="font-weight:400">net</span></div>'
    +'<div class="small muted" style="margin-top:3px">Gross '+R(grossCents)+' &nbsp;\\u00b7&nbsp; <span style="color:var(--red)">Returns '+retTxt+'</span></div>'
    +pctHtml+bar;
}
// Clickable PO tile built on poTriple (net headline + gross/returns + budget bar).
function clikPoTile(po,hash){
  po=po||{};var net=po.netCents!=null?po.netCents:po.actualCents;
  return '<div class="card kpi clik" onclick="location.hash=\\''+hash+'\\'" title="Open Purchase Orders"><div class="l">PO this period</div>'
    +poTriple(po.grossCents,po.returnsCents,net,{large:true,pct:po.usedPct,status:po.status})+'</div>';
}
// Sales-data tile (Sales R / PO R / GR R / Margin %). Clicking opens Trading
// with the matching period preset. Margin uses previous-complete-week FIM.
function salesTile(title,w,fimLabel,navPeriod){
  w=w||{};
  var vh=w.salesVarPct==null?'<span class="muted">no budget</span>':(w.salesVarPct>=0?'<span class="pos">\\u25B2 +'+w.salesVarPct+'%</span>':'<span class="neg">\\u25BC '+w.salesVarPct+'%</span>');
  return '<div class="card clik" onclick="dashGoTrading(\\''+navPeriod+'\\')" title="Open Trading">'
    +'<div class="small muted" style="text-transform:uppercase;letter-spacing:.04em">'+esc(title)+'</div>'
    +'<div style="font-size:24px;font-weight:800;margin:2px 0">'+R(w.salesCents)+'</div>'
    +'<div class="small muted">vs budget '+(w.salesBudgetCents!=null?R(w.salesBudgetCents):"\\u2014")+' '+vh+'</div>'
    +'<div class="mlist" style="margin-top:6px">'
    +'<div class="mc-row"><span class="mc-l">Sales R</span><span class="mc-v">'+R(w.salesCents)+'</span></div>'
    +'<div class="mc-row"><span class="mc-l">PO R</span><span class="mc-v">'+R(w.poCents)+'</span></div>'
    +'<div class="mc-row"><span class="mc-l">GR R</span><span class="mc-v">'+R(w.grCents)+'</span></div>'
    +'<div class="mc-row"><span class="mc-l">Margin %</span><span class="mc-v">'+(w.marginPct!=null?pct(w.marginPct):"\\u2014")+'</span></div></div>'
    +(fimLabel?'<div class="small muted" style="margin-top:5px">'+esc(fimLabel)+'</div>':'')
    +'</div>';
}
// Trading supports week/month/fy/custom; map dashboard windows onto it.
function dashGoTrading(p){
  var tp=p==="mtd"?"month":"week";
  try{localStorage.setItem("trading-period",tp)}catch(e){}
  location.hash="#trading";
}
// Waste tile for the Risk row (latest complete FIM week). Clickable -> #waste.
function wasteTile(wd){
  var open='<div class="card clik" onclick="location.hash=\\'#waste\\'" title="Open Waste &amp; Shrinkage">';
  if(!wd)return open+'<div class="small muted" style="text-transform:uppercase;letter-spacing:.04em">Waste &amp; shrinkage</div><div class="muted small" style="margin-top:6px">No FIM data yet.</div></div>';
  return open+'<div class="small muted" style="text-transform:uppercase;letter-spacing:.04em">Waste &amp; shrinkage</div>'
    +'<div class="mlist" style="margin-top:6px">'
    +'<div class="mc-row"><span class="mc-l">Net store shortages</span><span class="mc-v">'+Rr0(wd.shortagessZar)+'</span></div>'
    +'<div class="mc-row"><span class="mc-l">Shrink</span><span class="mc-v">'+Rr0(wd.shrinkZar)+(wd.shrinkPct!=null?' <span class="muted">('+wd.shrinkPct+'%)</span>':'')+'</span></div>'
    +'<div class="mc-row"><span class="mc-l">Waste</span><span class="mc-v">'+Rr0(wd.wasteZar)+(wd.wastePct!=null?' <span class="muted">('+wd.wastePct+'%)</span>':'')+'</span></div>'
    +'</div></div>';
}
// Guideline-vs-achieved mini bars (same look as the app's budget progress bars).
function marginBars(guide,actual){
  if(guide==null&&actual==null)return '';
  var mx=Math.max(guide||0,actual||0,1)*1.12;
  var gw=guide!=null?Math.round(guide/mx*100):0;
  var aw=actual!=null?Math.round(actual/mx*100):0;
  var dlt=(guide!=null&&actual!=null)?Math.round((actual-guide)*10)/10:null;
  var acol=dlt==null?"var(--muted)":(dlt<0?"var(--red)":"var(--green)");
  var dh=dlt==null?"":' <span style="color:'+acol+';font-weight:700">'+(dlt>=0?"\\u25B2 +":"\\u25BC ")+Math.abs(dlt)+'pp</span>';
  return '<div class="mbars">'
    +'<div class="mbar"><span class="mbl">Guide</span><span class="mbt"><i style="width:'+gw+'%;background:var(--nav)"></i></span><span class="mbv">'+(guide!=null?guide.toFixed(1)+"%":"\\u2014")+'</span></div>'
    +'<div class="mbar"><span class="mbl">Actual</span><span class="mbt"><i style="width:'+aw+'%;background:'+acol+'"></i></span><span class="mbv">'+(actual!=null?actual.toFixed(1)+"%":"\\u2014")+dh+'</span></div>'
    +'</div>';
}
// Dashboard period-picker options (key + label). Default is "wtd" (Week to Date).
var DASH_PERIODS=[["yesterday","Yesterday"],["wtd","Week to Date"],["prevweek","Prev Week"],["mtd","Month to Date"],["prevmonth","Prev Month"],["custom","Custom"]];
function dashSavedPeriod(){var p="wtd";try{p=localStorage.getItem("dashboard-period")||"wtd"}catch(e){}return p}
function dashPeriodQuery(){
  var p=dashSavedPeriod();
  if(p==="custom"){var f=$("dashFrom"),t=$("dashTo");var fv=f&&f.value,tv=t&&t.value;return "period=custom"+(fv?"&from="+fv:"")+(tv?"&to="+tv:"")}
  return "period="+p;
}
function dashSetPeriod(p){
  try{localStorage.setItem("dashboard-period",p)}catch(e){}
  var btns=document.querySelectorAll(".dashpicker .pbtn");
  for(var i=0;i<btns.length;i++){btns[i].className="pbtn"+(btns[i].getAttribute("data-p")===p?" on":"")}
  var cu=$("dashCustom");if(cu)cu.hidden=(p!=="custom");
  if(p!=="custom")dashLoadTiles();
}
var DASH_DIV_LOADED=false;
function dashLoadTiles(){
  var el=$("dashRow1");if(!el)return;
  api("/api/dashboard/tiles?"+dashPeriodQuery()).then(function(d){
    var rg=$("dashRange");if(rg&&d.period)rg.textContent="Showing: "+((d.period&&d.period.label)||"");
    var po=d.po||{},gr=d.gr||{},oc=d.openCommitted||{},wn=d.windows||{};
    // Row 1 — 5 purchase tiles, all clickable.
    el.innerHTML='<div class="cards kpis">'
      +clikPoTile(po,"#purchase-orders")
      +clikKpi("PO budget",R(po.budgetCents),statusPill(po.status||"GREEN")+" "+pct(po.usedPct)+" net","#budgets")
      +clikPoGr("GR this period",gr.actualCents,gr.usedPct,gr.status,"#gr")
      +clikKpi("GR budget",R(gr.budgetCents),statusPill(gr.status||"GREEN")+" "+pct(gr.usedPct),"#budgets")
      +clikKpi("Open committed",R(oc.valueCents),num(oc.lines)+' lines <span class="muted" title="Open S001 purchase orders only \\u2014 returns (S002) excluded, as these are incoming credits not future cash outflows.">\\u24D8</span>',"#open")+'</div>';
    // Sales Data row — FIM margin label is the previous complete fiscal week.
    var fl=d.fimWeekLabel?("FIM: "+d.fimWeekLabel):"";
    var sales=$("dashSales");
    if(sales)sales.innerHTML='<div class="cards g3">'
      +salesTile("Yesterday"+(wn.latestDate?" \\u00b7 "+wn.latestDate:""),wn.yesterday,fl,"yesterday")
      +salesTile("Week to date",wn.wtd,fl,"wtd")
      +salesTile("Month to date",wn.mtd,fl,"mtd")+'</div>';
    // Waste tile in the Risk row.
    var wt=$("dashWaste");if(wt)wt.innerHTML=wasteTile(d.wasteData);
    // Margin Performance header label + division cards (prev complete week, once).
    var mh=$("marginHdrWE");if(mh&&d.fimWeekLabel)mh.textContent=" \\u00b7 "+d.fimWeekLabel+" (prev complete week)";
    if(!DASH_DIV_LOADED&&d.fimWeekFrom&&d.fimWeekTo){DASH_DIV_LOADED=true;dashLoadDivPerf(d.fimWeekFrom,d.fimWeekTo)}
  }).catch(function(e){el.innerHTML='<div class="err">'+esc(e&&e.message||e)+'</div>'});
}
// Division performance cards for the previous complete FIM week, with mini bars.
function dashLoadDivPerf(from,to){
  var el=$("divperf");if(!el)return;
  api("/api/hierarchy/performance?from="+from+"&to="+to).then(function(p){
    var dv=p.divisions||[];
    if(!dv.length){el.innerHTML='<div class="muted small">No FIM data for the previous complete week.</div>';return}
    el.innerHTML='<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">'
      +dv.map(function(x){
        var v=(x.marginPct!=null&&x.guidelineMarginPct!=null)?Math.round((x.marginPct-x.guidelineMarginPct)*10)/10:null;
        var col=v==null?"var(--muted)":v>=-2?"var(--green)":v>=-5?"var(--amber)":"var(--red)";
        return '<div class="card clik" style="border-left:4px solid '+col+'" onclick="location.hash=\\'#departments\\'" title="Open Department Analysis"><strong>'+esc(x.name)+'</strong>'
          +(x.guideline_group?' <span class="tag">'+esc(x.guideline_group)+'</span>':'')
          +'<div style="font-size:20px;font-weight:700;margin-top:4px">'+Rr0(x.netSalesZar)+'</div>'
          +marginBars(x.guidelineMarginPct,x.marginPct)
          +'<div class="small muted" style="margin-top:4px">Waste '+Rr0(x.wasteZar)+' \\u00b7 Shrink '+Rr0(x.shrinkZar)+'</div></div>';
      }).join("")+'</div>';
  }).catch(function(){var el=$("divperf");if(el)el.innerHTML='<div class="muted small">Division performance unavailable.</div>'});
}
// Cash-flow forecast tile: PnP corporate payments (left) + Vencor/meat (right).
function dashLoadCashflow(){
  var el=$("cashflowBody");if(!el)return;
  api("/api/dashboard/cashflow").then(function(d){
    function pcol(days){return days<=3?"var(--red)":days<=7?"var(--amber)":"var(--nav)"}
    var pnp=d.pnpPayments||[];
    var left='<div class="small" style="text-transform:uppercase;letter-spacing:.04em;font-weight:700;color:var(--header)">PnP Corporate Payments Due</div>';
    left+=pnp.length?'<div class="mlist" style="margin-top:7px">'+pnp.map(function(p){var c=pcol(p.daysUntilDue);return '<div class="mc-row"><span class="mc-l">'+esc(fmtDay(p.paymentDueMonday))+'</span><span class="mc-v" style="color:'+c+';font-weight:700">'+Rr0(p.estimatedValueZar)+'</span></div>'}).join("")+'</div>':'<div class="muted small" style="margin-top:7px">No upcoming PnP payments.</div>';
    var meat=d.meatPayments||[];
    var right='<div class="small" style="text-transform:uppercase;letter-spacing:.04em;font-weight:700;color:var(--header)">Meat Supplier Payments (Vencor)</div>';
    right+=meat.length?'<div class="mlist" style="margin-top:7px">'+meat.map(function(p){var c=pcol(p.daysUntilDue);return '<div class="mc-row"><span class="mc-l">Due '+esc(shortDate(p.dueDate))+' \\u00b7 '+esc(p.vendorName||"")+'</span><span class="mc-v" style="color:'+c+';font-weight:700">'+Rr0(p.valueZar)+'</span></div>'}).join("")+'</div>':'<div class="muted small" style="margin-top:7px">No meat supplier GR data found \\u2014 check vendor names in Settings or GR data.</div>';
    el.innerHTML='<div class="cards g2"><div>'+left+'</div><div>'+right+'</div></div>';
  }).catch(function(){var el=$("cashflowBody");if(el)el.innerHTML='<div class="muted small">Cash-flow data unavailable.</div>'});
}
// Cash-flow risk banner for the current week (dismissible, persisted per week).
function dashRiskBanner(){
  var el=$("dashRisk");if(!el)return;
  api("/api/cash-flow-flags?weeks=1").then(function(d){
    var w=(d.weeks||[])[0];if(!w||!w.severity)return;
    var dismissed=false;try{dismissed=localStorage.getItem("dismissed-flag-"+w.weekCode)==="1"}catch(e){}
    if(dismissed)return;
    var crit=w.severity==="CRITICAL";var bg=crit?"#fdecea":"#fdf8e9";var bd=crit?"var(--red)":"var(--amber)";var ic=crit?"\\uD83D\\uDD34":"\\u26A0";
    el.innerHTML='<div style="background:'+bg+';border-left:4px solid '+bd+';border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-start;gap:10px">'
      +'<div><b>'+ic+' '+esc(w.title||"")+'</b><div class="small">'+esc(w.message||"")+'</div></div>'
      +'<span style="cursor:pointer;font-size:18px;line-height:1" onclick="dashDismissFlag(\\''+w.weekCode+'\\')">\\u00d7</span></div>';
  }).catch(function(){});
}
function dashDismissFlag(wc){try{localStorage.setItem("dismissed-flag-"+wc,"1")}catch(e){}var el=$("dashRisk");if(el)el.innerHTML=""}

PAGES.dashboard=function(){loading();api("/api/dashboard").then(function(d){
  var crit=(d.anomalyCounts||{}).CRITICAL||0;
  var saved=dashSavedPeriod();
  var pills=DASH_PERIODS.map(function(o){return '<button class="pbtn'+(o[0]===saved?" on":"")+'" data-p="'+o[0]+'" onclick="dashSetPeriod(\\''+o[0]+'\\')">'+esc(o[1])+(o[0]==="custom"?" \\u25BE":"")+'</button>'}).join("");
  var h='<div id="dashRisk"></div>';
  h+='<div class="toolbar dashpicker">'+pills
    +'<span id="dashCustom"'+(saved==="custom"?"":" hidden")+'><input type="date" class="inp" id="dashFrom"> <input type="date" class="inp" id="dashTo"> <button class="btn" id="dashApply">Apply</button></span>'
    +'<span id="dashRange" class="tag"></span></div>';

  // ---- PURCHASE DATA ----
  h+='<div class="dash-sec">Purchase Data</div>';
  h+='<div id="dashRow1"><div class="loading">Loading\\u2026</div></div>';
  // Row 2: Latest GR tile + Open order aging tile.
  var grTile;
  if(d.grYesterday){var g=d.grYesterday;var t3=(g.departments||[]).slice(0,3);
    grTile='<div class="card clik" onclick="location.hash=\\'#gr\\'" title="Open Goods Receipts"><h2>Latest goods receipt'+(g.date?' \\u00b7 '+esc(g.date):'')+'</h2>'
      +'<div class="cards kpis">'+kpi("Lines",num(g.totals.lines),null)+kpi("Cost",R(g.totals.costZar*100),null)+kpi("Sell",R(g.totals.sellZar*100),null)+kpi("Blended margin",pct(g.totals.blendedMarginPct),null)+'</div>'
      +(t3.length?'<div class="mlist" style="margin-top:6px"><div class="small muted" style="margin-bottom:3px">Top departments by value</div>'+t3.map(function(x){return '<div class="mc-row"><span class="mc-l">'+esc(x.deptCode)+' '+esc(x.deptName||"")+'</span><span class="mc-v">'+Rr0(x.sellZar)+'</span></div>'}).join("")+'</div>':'')
      +'</div>';
  }else{grTile='<div class="card clik" onclick="location.hash=\\'#gr\\'" title="Open Goods Receipts"><h2>Latest goods receipt</h2><div class="muted small">No goods receipts loaded.</div></div>';}
  var agMap={};(d.aging||[]).forEach(function(a){agMap[a.bucket]=a});
  var agDefs=[["new_order","New (0-7d)"],["awaiting","Awaiting (8-21d)"],["overdue","Overdue (22-34d)"],["stale","Stale (35-60d)"],["historical","Historical (>60d)"]];
  var agMax=1;agDefs.forEach(function(b){var a=agMap[b[0]];if(a&&a.n>agMax)agMax=a.n});
  var agTile='<div class="card clik" onclick="location.hash=\\'#open\\'" title="Open Open Orders"><h2>Open order aging</h2>'+agDefs.map(function(b){var a=agMap[b[0]]||{n:0};var danger=(b[0]==="overdue"||b[0]==="stale")&&a.n>0;var col=b[0]==="historical"?"var(--muted)":(danger?"var(--red)":"var(--nav)");return '<div class="hbar" style="grid-template-columns:128px 1fr 52px"><span class="lab'+(b[0]==="historical"?" muted":"")+'">'+b[1]+'</span><span class="bar"><i style="width:'+Math.max(2,Math.round(a.n/agMax*100))+'%;background:'+col+'"></i></span><span class="val">'+num(a.n)+'</span></div>'}).join("")+'</div>';
  h+='<div class="cards g2" style="margin-top:8px">'+grTile+agTile+'</div>';

  // ---- SALES DATA ----
  h+='<div class="dash-sec">Sales Data</div>';
  h+='<div id="dashSales"><div class="loading">Loading\\u2026</div></div>';

  // ---- RISK & ALERTS ----
  h+='<div class="dash-sec">Risk &amp; Alerts</div>';
  var staleVal=(agMap["stale"]&&agMap["stale"].value_cents||0)/100;
  var critTile='<div class="card kpi clik" onclick="location.hash=\\'#anomalies\\'" title="Open Risk &amp; Anomalies"><div class="v"><span class="'+(crit?"neg":"")+'">'+crit+'</span></div><div class="l">Critical anomalies</div><div class="sub">unacknowledged</div></div>';
  var staleTile='<div class="card kpi clik" onclick="location.hash=\\'#open\\'" title="Open stale orders"><div class="v">'+num(d.staleOpenOrders)+'</div><div class="l">Stale orders (35-60d)</div><div class="sub">'+Rr0(staleVal)+'</div></div>';
  h+='<div class="cards g3">'+critTile+staleTile+'<div id="dashWaste"><div class="card"><div class="loading">Loading\\u2026</div></div></div></div>';

  // ---- MARGIN PERFORMANCE (prev complete FIM week) ----
  h+='<div class="dash-sec">Margin Performance<span class="ws" id="marginHdrWE"></span></div>';
  h+='<div id="divperf"><div class="loading">Loading\\u2026</div></div>';

  // ---- CUSTOMER COUNT ----
  h+='<div class="dash-sec">Customer Count</div>';
  h+='<div class="card clik" onclick="location.hash=\\'#customers\\'" title="Open Customer Count detail"><h2>Customer count <span id="ccAsAt" class="muted small" style="text-transform:none;letter-spacing:0"></span></h2><div id="ccWidget"><div class="muted small">Loading\\u2026</div></div></div>';

  // ---- FAN SCORE / NPS ----
  h+='<div class="dash-sec">Fan Score / NPS</div>';
  h+='<div class="card clik" onclick="location.hash=\\'#fanscore\\'" title="Open Fan Score / NPS detail"><h2>Fan Score / NPS <span id="fsAsAt" class="muted small" style="text-transform:none;letter-spacing:0"></span></h2><div id="fsWidget"><div class="muted small">Loading\\u2026</div></div></div>';

  // ---- CASH FLOW FORECAST ----
  h+='<div class="dash-sec">Cash Flow Forecast</div>';
  h+='<div class="card clik" onclick="location.hash=\\'#cash\\'" title="Open Cash &amp; Creditors"><h2>Cash flow forecast</h2><div id="cashflowBody"><div class="muted small">Loading\\u2026</div></div></div>';

  // ---- OPEN ANOMALIES ----
  var anoms=d.topAnomalies||[];var anN=isMobile()?3:8;
  var anBody;
  if(!anoms.length){anBody='<div class="muted small">None.</div>';}
  else if(isMobile()){
    anBody=anoms.slice(0,anN).map(function(a){return '<div class="anrow"><span class="sev-'+a.severity+'" style="font-weight:700">'+a.severity+'</span><div class="anty">'+esc(a.type)+'</div><div class="small muted anmsg">'+esc(a.message)+'</div></div>'}).join("");
  }else{
    anBody='<table><tbody>'+anoms.slice(0,anN).map(function(a){return '<tr><td class="sev-'+a.severity+'">'+a.severity+'</td><td>'+esc(a.type)+'</td><td class="small">'+esc(a.message)+'</td></tr>'}).join("")+'</tbody></table>';
  }
  h+='<div class="dash-sec">Open Anomalies</div>';
  h+='<div class="card clik" onclick="location.hash=\\'#anomalies\\'" title="Open Risk &amp; Anomalies"><h2>Open anomalies</h2>'+anBody+'<div style="margin-top:6px"><a class="link" href="#anomalies">See all anomalies \\u2192</a></div></div>';

  setHTML(h);
  var ap=$("dashApply");if(ap)ap.onclick=dashLoadTiles;
  DASH_DIV_LOADED=false;
  dashLoadTiles();
  dashRiskBanner();
  dashLoadCashflow();
  // Customer-count widget (calendar yesterday / week-to-date / month-to-date).
  api("/api/customer-counts/summary").then(function(cc){
    function ccDate(s){var M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];var p=String(s||"").split("-");return p.length===3?(+p[2])+" "+M[(+p[1])-1]+" "+p[0]:(s||"")}
    var el=$("ccWidget");if(!el)return;var asat=$("ccAsAt");
    if(!cc.hasData){if(asat)asat.textContent="";el.innerHTML='<div class="muted small">No customer data \\u2014 upload Customer Count CSV to get started.</div>';return}
    if(asat)asat.textContent="\\u00b7 latest "+ccDate(cc.latestDate);
    var W=cc.windows;var cols=[["Yesterday",W.yesterday,ccDate(cc.latestDate)],["Week to date",W.wtd,""],["Month to date",W.mtd,""]];
    el.innerHTML='<div class="cards" style="grid-template-columns:repeat(3,1fr)">'+cols.map(function(c){
      var w=c[1];var v=w.customersVarPct;
      var vh=v==null?'<span class="muted">\\u2014 vs LY</span>':(v>0?'<span style="color:#2E7D32;font-weight:700">\\u25B2 +'+v.toFixed(1)+'% vs LY</span>':v<0?'<span style="color:#BE1D37;font-weight:700">\\u25BC '+v.toFixed(1)+'% vs LY</span>':'<span class="muted">0.0% vs LY</span>');
      var sv=w.salesVarPct;var svh=sv==null?'':' <span style="color:'+(sv>0?'#2E7D32':sv<0?'#BE1D37':'inherit')+'">('+(sv>=0?'+':'')+sv.toFixed(1)+'%)</span>';
      var basket=w.avgBasket!=null?'<div class="small muted">'+Rr(w.avgBasket)+' avg basket</div>':'';
      return '<div class="card" style="text-align:center"><div class="small muted" style="text-transform:uppercase;letter-spacing:.04em">'+esc(c[0])+'</div><div style="font-size:26px;font-weight:800;margin:2px 0">'+num(w.customersTy)+'</div><div class="small muted">customers</div><div style="margin:6px 0">'+vh+'</div><div class="small muted">'+Rr0(w.salesTy)+' sales'+svh+'</div>'+basket+(c[2]?'<div class="small muted" style="margin-top:3px">'+esc(c[2])+'</div>':'')+'</div>';
    }).join("")+'</div>';
  }).catch(function(){var el=$("ccWidget");if(el)el.innerHTML='<div class="muted small">Customer data unavailable.</div>'});
  // Fan Score / NPS widget.
  api("/api/fan-score/summary").then(function(fs){
    var el=$("fsWidget");if(!el)return;var asat=$("fsAsAt");
    if(!fs||!fs.hasData){if(asat)asat.textContent="";el.innerHTML='<div class="muted small">No fan-score data \\u2014 upload a Fan Score report to get started.</div>';return}
    if(asat)asat.textContent="\\u00b7 W/E "+esc(fs.weekEnding);
    var tw=fs.npsTw!=null?fs.npsTw:fs.npsComputed;
    var d=(fs.npsTw!=null&&fs.npsLw!=null)?(fs.npsTw-fs.npsLw):null;
    var dh=d==null?"":'<span style="color:'+(d>=0?"#2E7D32":"#BE1D37")+';font-weight:700">'+(d>=0?"\\u25B2 +":"\\u25BC ")+d.toFixed(2)+"pp vs LW</span>";
    el.innerHTML='<div class="cards" style="grid-template-columns:repeat(3,1fr)">'
      +'<div class="card" style="text-align:center"><div class="small muted" style="text-transform:uppercase;letter-spacing:.04em">NPS this week</div><div style="font-size:30px;font-weight:800;margin:2px 0;color:'+fsNpsColor(tw)+'">'+(tw!=null?tw.toFixed(1)+"%":"\\u2014")+'</div><div class="small muted">last week '+(fs.npsLw!=null?fs.npsLw.toFixed(1)+"%":"\\u2014")+'</div><div style="margin-top:4px">'+dh+'</div></div>'
      +'<div class="card" style="text-align:center"><div class="small muted" style="text-transform:uppercase;letter-spacing:.04em">Responses</div><div style="font-size:30px;font-weight:800;margin:2px 0">'+num(fs.totalResponses)+'</div><div class="small muted">'+num(fs.scoredResponses)+' scored</div></div>'
      +'<div class="card" style="text-align:center"><div class="small muted" style="text-transform:uppercase;letter-spacing:.04em">Promoters / Detractors</div><div style="font-size:24px;font-weight:800;margin:6px 0"><span style="color:#2E7D32">'+num(fs.promoters)+'</span> / <span style="color:#BE1D37">'+num(fs.detractors)+'</span></div><div class="small muted">'+num(fs.passives)+' passive</div></div>'
      +'</div>';
  }).catch(function(){var el=$("fsWidget");if(el)el.innerHTML='<div class="muted small">Fan-score data unavailable.</div>'});
}).catch(errBox)};

PAGES.upload=function(){setHTML('<iframe class="upl" src="/upload"></iframe>')};

// ---- Waste & Shrinkage screen (#waste): /api/waste ----
// Two-line SVG trend (waste red / shrink amber) over the last 13 weeks.
function wasteTrendChart(pts){
  if(!pts.length)return '<div class="muted small">No trend data.</div>';
  var W=760,H=260,pad=44,n=pts.length;
  var mx=Math.max.apply(null,pts.map(function(p){return Math.max(p.wasteZar||0,p.shrinkZar||0)}))||1;
  function X(i){return pad+(n<=1?(W-2*pad)/2:(i*(W-2*pad)/(n-1)))}
  function Y(v){return H-pad-((v||0)/mx)*(H-2*pad)}
  function poly(key,col){return '<polyline points="'+pts.map(function(p,i){return X(i).toFixed(1)+","+Y(p[key]).toFixed(1)}).join(" ")+'" fill="none" stroke="'+col+'" stroke-width="2"/>'}
  function dots(key,col){return pts.map(function(p,i){return '<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(p[key]).toFixed(1)+'" r="2.5" fill="'+col+'"/>'}).join("")}
  var step=Math.max(1,Math.ceil(n/7));
  var xlabs=pts.map(function(p,i){if(i%step!==0&&i!==n-1)return "";return '<text x="'+X(i).toFixed(1)+'" y="'+(H-pad+16)+'" font-size="10" fill="#6a7480" text-anchor="middle">'+esc(shortDate(p.weekEnding))+'</text>'}).join("");
  var yax='<text x="'+(pad-6)+'" y="'+(H-pad)+'" font-size="10" fill="#6a7480" text-anchor="end">0</text><text x="'+(pad-6)+'" y="'+(pad+4)+'" font-size="10" fill="#6a7480" text-anchor="end">'+Rr0(mx)+'</text>';
  var legend='<div class="small" style="margin-bottom:6px"><span style="color:var(--red);font-weight:700">\\u25CF Waste</span> &nbsp; <span style="color:var(--amber);font-weight:700">\\u25CF Shrink</span></div>';
  return legend+'<div class="svgwrap"><svg viewBox="0 0 '+W+' '+H+'"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="#e2e7ec"/><line x1="'+pad+'" y1="'+pad+'" x2="'+pad+'" y2="'+(H-pad)+'" stroke="#e2e7ec"/>'+poly("shrinkZar","#d8a400")+poly("wasteZar","#BE1D37")+dots("shrinkZar","#d8a400")+dots("wasteZar","#BE1D37")+yax+xlabs+'</svg></div>';
}
// Per-department waste/shrink % targets for the drill-down (fresh depts carry the
// most spoilage risk). Unlisted depts fall back to a sensible default.
var WASTE_TARGETS={
  F04:{waste:2.5,shrink:1.5,name:'Deli'},
  F06:{waste:3.0,shrink:1.5,name:'Bakery'},
  F09:{waste:2.0,shrink:1.5,name:'Butchery'},
  F07:{waste:4.0,shrink:1.5,name:'Fruit & Veg'},
  P11:{waste:2.0,shrink:1.5,name:'Perishable Groceries'}
};
function wasteTarget(dept){return WASTE_TARGETS[dept]||{waste:2.0,shrink:1.5,name:dept}}
// Toggle the inline detail row under a department in the waste table.
function toggleWasteDept(dept,from,to,rowEl){
  var det=document.getElementById("wdrow-"+dept);if(!det)return;
  var arrow=rowEl.querySelector(".wd-arrow");
  if(det.hidden){
    det.hidden=false;if(arrow)arrow.innerHTML="\\u25BC";rowEl.style.background="#eef3f8";
    var el=document.getElementById("wd-"+dept);
    if(el&&!el.getAttribute("data-loaded")){el.setAttribute("data-loaded","1");loadWasteDeptDetail(dept,from,to,el);}
  }else{
    det.hidden=true;if(arrow)arrow.innerHTML="\\u25B6";rowEl.style.background="";
  }
}
function closeWasteDept(dept){var tr=document.getElementById("wdtr-"+dept);if(tr)toggleWasteDept(dept,"","",tr);}
function loadWasteDeptDetail(dept,from,to,el){
  el.innerHTML='<div class="muted small" style="padding:8px">Loading detail\\u2026</div>';
  api("/api/waste/dept?dept="+encodeURIComponent(dept)+"&from="+from+"&to="+to).then(function(d){
    el.innerHTML=buildWasteDeptDetail(dept,d);
  }).catch(function(e){el.innerHTML='<div class="err" style="margin:8px">'+esc(e&&e.message||e)+'</div>';});
}
// Small SVG: daily waste% (red solid) vs shrink% (amber dashed) with a grey dashed target line.
function wasteMiniChart(rows,target){
  var pts=(rows||[]).filter(function(r){return r.wastePct!=null||r.shrinkPct!=null});
  if(pts.length<2)return '<div class="muted small">Not enough days for a trend.</div>';
  var W=600,H=120,pad=26,n=pts.length;
  var mx=Math.max(target||0,Math.max.apply(null,pts.map(function(p){return Math.max(p.wastePct||0,p.shrinkPct||0)})))||1;
  function X(i){return pad+i*(W-2*pad)/(n-1)}
  function Y(v){return H-pad-((v||0)/mx)*(H-2*pad)}
  function poly(key,col,dash){return '<polyline points="'+pts.map(function(p,i){return X(i).toFixed(1)+","+Y(p[key]).toFixed(1)}).join(" ")+'" fill="none" stroke="'+col+'" stroke-width="2"'+(dash?' stroke-dasharray="4 3"':'')+'/>'}
  var ty=Y(target);
  var tline='<line x1="'+pad+'" y1="'+ty.toFixed(1)+'" x2="'+(W-pad)+'" y2="'+ty.toFixed(1)+'" stroke="#9aa4ae" stroke-width="1" stroke-dasharray="3 3"/><text x="'+(W-pad)+'" y="'+(ty-3).toFixed(1)+'" font-size="9" fill="#9aa4ae" text-anchor="end">target '+target+'%</text>';
  var legend='<div class="small" style="margin:4px 0"><span style="color:var(--red);font-weight:700">\\u25CF Waste%</span> &nbsp; <span style="color:var(--amber);font-weight:700">\\u25CF Shrink%</span></div>';
  return legend+'<div class="svgwrap"><svg viewBox="0 0 '+W+' '+H+'"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="#e2e7ec"/>'+tline+poly("shrinkPct","#d8a400",true)+poly("wastePct","#BE1D37",false)+'</svg></div>';
}
function buildWasteDeptDetail(dept,d){
  var s=d.summary||{};var tgt=wasteTarget(dept);var rows=d.rows||[];
  var wp=s.wastePct,sp=s.shrinkPct;
  var warn=(wp!=null&&wp>tgt.waste)?" \\u26A0":"";
  var lbl=(d.period&&d.period.label)||"";
  var wcol=wp==null?"var(--muted)":wp>tgt.waste?"var(--red)":"var(--green)";
  var scol=sp==null?"var(--muted)":sp>tgt.shrink?"var(--red)":"var(--green)";
  var h='<div style="padding:14px 14px 18px">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:2px"><b>'+esc(dept)+' '+esc((d.deptName||tgt.name||"").toUpperCase())+' \\u2014 Waste &amp; Shrinkage Detail</b><button class="btn alt" onclick="closeWasteDept(\\''+dept+'\\')">\\u2715 Close</button></div>';
  h+='<div class="muted small" style="margin-bottom:10px">Period: '+esc(lbl)+'</div>';
  h+='<div class="cards kpis">'
    +kpi("Total waste",Rr0(s.totalWasteZar),"target <"+tgt.waste+"%")
    +kpi("Waste %",'<span style="color:'+wcol+'">'+(wp!=null?wp+"%"+warn:"\\u2014")+'</span>',null)
    +kpi("Total shrink",Rr0(s.totalShrinkZar),"target <"+tgt.shrink+"%")
    +kpi("Shrink %",'<span style="color:'+scol+'">'+(sp!=null?sp+"%":"\\u2014")+'</span>',null)
    +'</div>';
  h+='<div class="card" style="margin-top:10px"><h2>Daily waste vs shrink %</h2>'+wasteMiniChart(rows,tgt.waste)+'</div>';
  h+='<div class="card" style="margin-top:10px"><h2>Period breakdown</h2><div class="tablewrap"><table><thead><tr><th>Date</th><th class="num">Sales R</th><th class="num">Waste R</th><th class="num">Waste %</th><th class="num">Shrink R</th><th class="num">Shrink %</th></tr></thead><tbody>'
    +(rows.length?rows.map(function(r){var w=r.wastePct;var bg=w==null?"":w>5?"background:#fdecea":w>2?"background:#fff6e6":"";var wc=w==null?"var(--muted)":w>5?"var(--red)":w>2?"var(--amber)":"var(--green)";var wcell=w==null?"\\u2014":(w+"%"+(w>tgt.waste?" \\u26A0":""));
      return '<tr style="'+bg+'"><td>'+esc(ccFriendly(r.date))+'</td><td class="num">'+Rr0(r.salesZar)+'</td><td class="num">'+Rr0(r.wasteZar)+'</td><td class="num" style="color:'+wc+';font-weight:700">'+wcell+'</td><td class="num">'+Rr0(r.shrinkZar)+'</td><td class="num">'+(r.shrinkPct!=null?r.shrinkPct+"%":"\\u2014")+'</td></tr>';
    }).join(""):'<tr><td colspan="6" class="muted" style="padding:12px;text-align:center">No daily rows.</td></tr>')
    +'</tbody></table></div></div>';
  var rr=s.rtcRecoveryPct;
  h+='<div class="card" style="margin-top:10px"><h2>RTC recovery</h2>'
    +'<div class="small">Total RTC: <b>'+Rr0(s.totalRtcZar)+'</b>'+(rr!=null?" ("+rr+"% of waste recovered)":"")+'</div>'
    +'<div class="small">Net unrecovered waste: <b>'+Rr0(s.netUnrecoveredWasteZar)+'</b></div>'
    +((rr!=null&&rr<30)?'<div class="small" style="color:var(--amber);margin-top:4px">\\u26A0 Consider earlier markdown to recover margin.</div>':'')
    +'</div>';
  var pf=(d.period&&d.period.from)||"",pt=(d.period&&d.period.to)||"";
  h+='<div class="card" style="margin-top:10px"><button class="btn alt" onclick="showWasteArticles(\\''+dept+'\\',\\''+pf+'\\',\\''+pt+'\\',this)">Show articles</button><div id="wa-'+dept+'" style="margin-top:10px;display:none"></div></div>';
  h+='</div>';
  return h;
}
// Lazy-load the article-level waste table for a department (drill under the dept detail).
function showWasteArticles(dept,from,to,btn){
  var box=document.getElementById("wa-"+dept);if(!box)return;
  if(box.getAttribute("data-open")==="1"){box.style.display="none";box.setAttribute("data-open","0");btn.textContent="Show articles";return;}
  box.style.display="";box.setAttribute("data-open","1");btn.textContent="Hide articles";
  if(box.getAttribute("data-loaded")==="1")return;
  box.setAttribute("data-loaded","1");
  box.innerHTML='<div class="muted small" style="padding:6px">Loading articles\\u2026</div>';
  api("/api/waste/dept/articles?dept="+encodeURIComponent(dept)+"&from="+from+"&to="+to).then(function(d){
    var rows=(d&&d.rows)||[];var tgt=wasteTarget(dept);
    if(!rows.length){box.innerHTML='<div class="muted small" style="padding:6px">No article-level waste for this period (run the backfill).</div>';return;}
    box.innerHTML='<div class="small muted" style="margin-bottom:4px">'+rows.length+' article'+(rows.length===1?"":"s")+' with waste \\u00b7 worst first</div><div class="tablewrap"><table><thead><tr><th>Article</th><th class="num">Sales R</th><th class="num">Waste R</th><th class="num">Waste %</th><th class="num">Shrink R</th></tr></thead><tbody>'
      +rows.map(function(r){var w=r.wastePct;var wc=w==null?"var(--muted)":w>5?"var(--red)":w>2?"var(--amber)":"var(--green)";var wcell=w==null?"\\u2014":(w+"%"+(w>tgt.waste?" \\u26A0":""));
        return '<tr><td>'+esc(r.articleDesc||r.articleCode)+'</td><td class="num">'+Rr0(r.salesZar)+'</td><td class="num">'+Rr0(r.wasteZar)+'</td><td class="num" style="color:'+wc+';font-weight:700">'+wcell+'</td><td class="num">'+Rr0(r.shrinkZar)+'</td></tr>';
      }).join("")+'</tbody></table></div>';
  }).catch(function(e){box.innerHTML='<div class="err" style="margin:6px">'+esc(e&&e.message||e)+'</div>';});
}
function wasteQuery(){
  var p="prevweek";try{p=localStorage.getItem("waste-period")||"prevweek"}catch(e){}
  if(p==="custom"){var f=$("wsFrom"),t=$("wsTo");var fv=f&&f.value,tv=t&&t.value;return "period=custom"+(fv?"&from="+fv:"")+(tv?"&to="+tv:"")}
  return "period="+p;
}
function wsLoad(){
  var el=$("wsBody");if(!el)return;el.innerHTML='<div class="loading">Loading\\u2026</div>';
  api("/api/waste?"+wasteQuery()).then(function(d){
    var rg=$("wsRange");if(rg)rg.textContent=(d.period&&d.period.label)||"";
    var s=d.summary||{};var h="";
    if((d.anomalies||[]).length){
      h+='<div style="background:#fdecea;border-left:4px solid var(--red);border-radius:8px;padding:10px 14px;margin-bottom:12px"><b>\\u26A0 Waste / shrink anomalies</b>'
        +d.anomalies.map(function(a){return '<div class="small"><span class="sev-'+a.severity+'" style="font-weight:700">'+esc(a.severity)+'</span> '+esc(a.type)+' \\u2014 '+esc(a.message)+'</div>'}).join("")+'</div>';
    }
    h+='<div class="cards kpis">'
      +kpi("Net store shortages",Rr0(s.totalShortagessZar),null)
      +kpi("Shrinkage",Rr0(s.totalShrinkZar),null)
      +kpi("Shrink % of sales",(s.shrinkPct!=null?s.shrinkPct+"%":"\\u2014"),null)
      +kpi("Waste",Rr0(s.totalWasteZar),null)
      +kpi("Waste % of sales",(s.wastePct!=null?s.wastePct+"%":"\\u2014"),null)+'</div>';
    var rows=d.byDept||[];
    var pf=(d.period&&d.period.from)||"",pt=(d.period&&d.period.to)||"";
    h+='<div class="card"><h2>Waste &amp; shrinkage by department</h2><div class="muted small" style="margin-bottom:6px">Tap a department for daily detail.</div>'+(rows.length?'<div class="tablewrap"><table><thead><tr><th></th><th>Dept</th><th>Name</th><th class="num">Sales R</th><th class="num">Net shortages</th><th class="num">Shrink R</th><th class="num">Shrink %</th><th class="num">Waste R</th><th class="num">Waste %</th><th class="num">RTC R</th></tr></thead><tbody>'
      +rows.map(function(r){var wp=r.wastePct;var col=wp==null?"var(--muted)":wp>2?"var(--red)":wp>=1?"var(--amber)":"var(--green)";var dep=esc(r.deptCode);
        return '<tr class="wd-row" id="wdtr-'+dep+'" data-dept="'+dep+'" style="cursor:pointer"><td class="wd-arrow" style="width:16px;color:var(--muted)">\\u25B6</td><td>'+dep+'</td><td>'+esc(r.deptName||"")+'</td><td class="num">'+Rr0(r.salesZar)+'</td><td class="num">'+Rr0(r.shortagessZar)+'</td><td class="num">'+Rr0(r.shrinkZar)+'</td><td class="num">'+(r.shrinkPct!=null?r.shrinkPct+"%":"\\u2014")+'</td><td class="num">'+Rr0(r.wasteZar)+'</td><td class="num" style="color:'+col+';font-weight:700">'+(wp!=null?wp+"%":"\\u2014")+'</td><td class="num">'+Rr0(r.rtcZar)+'</td></tr>'
          +'<tr class="wd-detail" id="wdrow-'+dep+'" hidden><td colspan="10" style="padding:0;background:#f7f9fb"><div id="wd-'+dep+'"></div></td></tr>';
      }).join("")+'</tbody></table></div>':'<div class="muted small">No FIM data for this period.</div>')+'</div>';
    h+='<div class="card"><h2>Weekly waste &amp; shrink trend (last 13 weeks)</h2>'+wasteTrendChart(d.trend||[])+'</div>';
    el.innerHTML=h;
    el.onclick=function(e){var tr=e.target.closest(".wd-row");if(tr)toggleWasteDept(tr.getAttribute("data-dept"),pf,pt,tr)};
  }).catch(function(e){el.innerHTML='<div class="err">'+esc(e&&e.message||e)+'</div>'});
}
PAGES.waste=function(){
  var saved="prevweek";try{saved=localStorage.getItem("waste-period")||"prevweek"}catch(e){}
  var opts=[["wtd","This Week"],["prevweek","Last Week"],["mtd","This Month"],["prevmonth","Last Month"],["fy","This FY"],["lastfy","Last FY"],["custom","Custom\\u2026"]];
  var bar='<div class="toolbar"><label class="small muted">Period</label>'
    +'<select class="sel" id="wsPeriod">'+opts.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===saved?" selected":"")+'>'+o[1]+'</option>'}).join("")+'</select>'
    +'<span id="wsCustom"'+(saved==="custom"?"":" hidden")+'><input type="date" class="inp" id="wsFrom"> <input type="date" class="inp" id="wsTo"> <button class="btn" id="wsApply">Apply</button></span>'
    +'<span id="wsRange" class="tag"></span></div>';
  setHTML(bar+'<div id="wsBody"><div class="loading">Loading\\u2026</div></div>');
  $("wsPeriod").onchange=function(){var cu=$("wsCustom");if(cu)cu.hidden=this.value!=="custom";try{localStorage.setItem("waste-period",this.value)}catch(e){}; if(this.value!=="custom")wsLoad()};
  var ap=$("wsApply");if(ap)ap.onclick=wsLoad;
  wsLoad();
};

// ---- Trading screen (#trading): one-call period analytics (/api/trading) ----
function trRange(){
  var sel=$("trPeriod").value;var today=new Date().toISOString().slice(0,10);
  if(sel==="custom")return [$("trFrom").value||today,$("trTo").value||today];
  if(sel==="month"){var p=today.slice(0,7).split("-");var y=+p[0],m=+p[1];return [today.slice(0,7)+"-01",new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)]}
  if(sel.indexOf("fy")===0){var fy=+sel.slice(2);return [(fy-1)+"-03-01",new Date(Date.UTC(fy,2,1)-86400000).toISOString().slice(0,10)]}
  return weekBounds(today); // "week" (default)
}
function trLoad(){
  var r=trRange();var body=$("trBody");if(!body)return;
  body.innerHTML='<div class="skel"><div class="skbar"></div><div class="skbar"></div></div>';
  api("/api/trading?from="+r[0]+"&to="+r[1]).then(function(d){
    var lab=$("trLabel");if(lab)lab.textContent=(d.period&&d.period.label)||"";
    var s=d.summary||{},ch=s.change||{};
    function chg(v,goodWhenDown){if(v==null)return '<span class="muted">\\u2014</span>';var good=goodWhenDown?(v<=0):(v>=0);return '<span class="'+(good?"pos":"neg")+'">'+(v>=0?"\\u25B2 +":"\\u25BC ")+v+'% vs LY</span>'}
    function pp(v){if(v==null)return '<span class="muted">\\u2014</span>';return '<span class="'+(v>=0?"pos":"neg")+'">'+(v>=0?"\\u25B2 +":"\\u25BC ")+v+'pp vs LY</span>'}
    function card(lab,val,sub){return '<div class="card kpi"><div class="v">'+val+'</div><div class="l">'+esc(lab)+'</div><div class="sub">'+sub+'</div></div>'}
    var tpo=d.po||{};
    var poCard='<div class="card kpi"><div class="v">'+Rr0(tpo.netZar)+' <span class="small muted" style="font-weight:400">net</span></div>'
      +'<div class="l">Purchase orders</div>'
      +'<div class="sub">Gross '+Rr0(tpo.grossZar)+' \\u00b7 <span style="color:var(--red)">Returns '+Rr0(tpo.returnsZar)+'</span></div></div>';
    var cards='<div class="cards kpis">'
      +card("Sales (FIM)",Rr0(s.salesZar),chg(ch.salesPct,false))
      +poCard
      +card("GR total",Rr0(s.grZar),chg(ch.grPct,true))
      +card("POS margin",pct(s.posMarginPct),pp(ch.marginPp))
      +card("Customers",num(s.customersTy),chg(ch.customersPct,false))+'</div>';
    var sm=d.salesMargin||{};
    var smCard='<div class="card" style="margin-top:14px"><h2>Sales & margin (customer counts)</h2><div class="tablewrap"><table><tbody>'
      +'<tr><td>Customers</td><td class="num">TY '+num(sm.customersTy)+'</td><td class="num">LY '+num(sm.customersLy)+'</td><td class="num">'+chg(sm.customersVarPct,false)+'</td></tr>'
      +'<tr><td>Sales</td><td class="num">TY '+Rr0(sm.salesTyZar)+'</td><td class="num">LY '+Rr0(sm.salesLyZar)+'</td><td class="num">'+chg(sm.salesVarPct,false)+'</td></tr>'
      +'<tr><td>Avg basket</td><td class="num">'+(sm.avgBasketZar!=null?Rr(sm.avgBasketZar):"\\u2014")+'</td><td></td><td></td></tr>'
      +'</tbody></table></div></div>';
    var vends=d.vendors||[];
    var vCard='<div class="card" style="margin-top:14px"><h2>Top 10 vendors by PO net</h2>'+(vends.length?makeTable([
      {key:"name",label:"Vendor",html:function(r){return venLink(r.code,r.name)+(r.highReturnRate?' <span class="neg small" title="Returns exceed 5% of gross orders">high returns</span>':"")}},
      {key:"grossZar",label:"Gross",num:true,fmt:Rr0},
      {key:"returnsZar",label:"Returns",num:true,html:function(r){return '<span style="color:var(--red)">'+Rr0(r.returnsZar)+'</span>'}},
      {key:"netZar",label:"Net",num:true,fmt:Rr0}
    ],vends,{search:false,rowMenu:false,onRow:function(r){if(r.code)openVendor(r.code)}}):'<div class="muted small">No PO data for this period.</div>')+'</div>';
    var arts=d.articles||[];
    var aCard='<div class="card" style="margin-top:14px"><h2>Top 20 articles by PO value</h2>'+(arts.length?makeTable([
      {key:"description",label:"Article",cls:"desc",html:function(r){return artLink(r.code)+' '+esc(r.description||"")}},
      {key:"code",label:"Code"},
      {key:"poZar",label:"PO value",num:true,fmt:Rr0}
    ],arts,{search:false,rowMenu:false,onRow:function(r){if(r.code)openArticle(r.code)}}):'<div class="muted small">No PO data for this period.</div>')+'</div>';
    body.innerHTML=cards+smCard+vCard+aCard;
  }).catch(function(e){body.innerHTML='<div class="err">'+esc(e&&e.message||e)+'</div>'});
}
PAGES.trading=function(){
  var saved="week";try{saved=localStorage.getItem("trading-period")||"week"}catch(e){}
  var opts=[["week","This week"],["month","This month"],["fy2027","FY2027"],["fy2026","FY2026"],["fy2025","FY2025"],["custom","Custom\\u2026"]];
  var bar='<div class="toolbar"><label class="small muted">Period</label>'
    +'<select class="sel" id="trPeriod">'+opts.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===saved?" selected":"")+'>'+o[1]+'</option>'}).join("")+'</select>'
    +'<span id="trCustom"'+(saved==="custom"?"":" hidden")+'><input type="date" class="inp" id="trFrom"> <input type="date" class="inp" id="trTo"> <button class="btn" id="trApply">Apply</button></span></div>'
    +'<h2 id="trLabel" style="margin:6px 0 12px;font-size:18px;color:var(--ink);text-transform:none;letter-spacing:0"></h2>'
    +'<div id="trBody"></div>';
  setHTML(bar);
  $("trPeriod").onchange=function(){var cu=$("trCustom");if(cu)cu.hidden=this.value!=="custom";try{localStorage.setItem("trading-period",this.value)}catch(e){}; if(this.value!=="custom")trLoad()};
  var ap=$("trApply");if(ap)ap.onclick=trLoad;
  trLoad();
};

// ---- Purchase Orders: filterable, paginated PO-line list (/api/po-lines/list) ----
var PO_STATE={period:"month",status:"all",vendor:"",dept:"",offset:0,limit:100};
PAGES["purchase-orders"]=function(){
  var pOpts=[["week","This week"],["month","This month"],["fy","This FY"],["lastfy","Last FY"],["custom","All data"]];
  var sOpts=[["all","All lines"],["open","Open only"],["matched","Matched (received)"],["unmatched-po","Unmatched PO"]];
  var bar='<div class="toolbar">'
    +'<label class="small muted">Period</label><select class="sel" id="poPeriod">'+pOpts.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===PO_STATE.period?" selected":"")+'>'+o[1]+'</option>'}).join("")+'</select>'
    +'<label class="small muted">Status</label><select class="sel" id="poStatus">'+sOpts.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===PO_STATE.status?" selected":"")+'>'+o[1]+'</option>'}).join("")+'</select>'
    +'<input class="inp" id="poVendor" placeholder="Vendor code" value="'+esc(PO_STATE.vendor)+'" style="width:120px">'
    +'<input class="inp" id="poDept" placeholder="Dept" value="'+esc(PO_STATE.dept)+'" style="width:80px">'
    +'<button class="btn" id="poApply">Apply</button></div>';
  setHTML(bar+'<div id="poSummary" class="muted small" style="margin-bottom:8px"></div><div id="poBody"><div class="loading">Loading\\u2026</div></div>');
  $("poApply").onclick=function(){PO_STATE.period=$("poPeriod").value;PO_STATE.status=$("poStatus").value;PO_STATE.vendor=$("poVendor").value.trim();PO_STATE.dept=$("poDept").value.trim();PO_STATE.offset=0;poLoad()};
  poLoad();
};
// 5 summary cards for the PO screen: Gross / Returns / Net (headline) / Open / Vendors.
function poSummaryCards(sm){
  function c(val,lab,sub,col){return '<div class="card kpi"><div class="v"'+(col?' style="color:'+col+'"':'')+'>'+val+'</div><div class="l">'+esc(lab)+'</div>'+(sub?'<div class="sub">'+sub+'</div>':'')+'</div>'}
  var ret=sm.returnsCents?'-'+R(-sm.returnsCents):R(0);
  return '<div class="cards kpis" style="margin-bottom:10px">'
    +c(R(sm.grossCents),"Gross orders",num(sm.grossLines)+" lines")
    +c(ret,"Returns",num(sm.returnsLines)+" lines","var(--red)")
    +c(R(sm.netCents),"Net orders",num(sm.netLines)+" lines","var(--nav)")
    +c(R(sm.openCommittedCents),"Open committed","excl returns \\u00b7 S001")
    +c(num(sm.vendors),"Vendors","active")+'</div>';
}
// Returns-to-vendor (S002) section, grouped by vendor with a total row.
function poReturnsCard(rbv){
  if(!rbv||!rbv.length)return '';
  var totRet=rbv.reduce(function(s,r){return s+(r.returnsCents||0)},0);
  var totLines=rbv.reduce(function(s,r){return s+(r.lines||0)},0);
  var rows=rbv.map(function(r){return '<tr'+(r.code?' style="cursor:pointer" onclick="openVendor(\\''+esc(r.code)+'\\')"':'')
    +'><td>'+esc(r.name||r.code||"\\u2014")+'</td><td class="num">'+num(r.lines)+'</td>'
    +'<td class="num" style="color:var(--red)">'+(r.returnsCents?'-'+R(-r.returnsCents):R(0))+'</td></tr>'}).join("");
  return '<div class="card" style="margin-top:14px"><h2>\\u2500\\u2500 Returns to vendor (S002) \\u2500\\u2500</h2>'
    +'<div class="tablewrap"><table><thead><tr><th>Vendor</th><th class="num">Lines</th><th class="num">Return value</th></tr></thead><tbody>'+rows
    +'<tr style="font-weight:700;border-top:2px solid var(--line)"><td>Total returns</td><td class="num">'+num(totLines)
    +'</td><td class="num" style="color:var(--red)">'+(totRet?'-'+R(-totRet):R(0))+'</td></tr>'
    +'</tbody></table></div></div>';
}
function poLoad(){
  var body=$("poBody");if(!body)return;body.innerHTML='<div class="loading">Loading\\u2026</div>';
  var q="period="+encodeURIComponent(PO_STATE.period)+"&status="+encodeURIComponent(PO_STATE.status)+"&limit="+PO_STATE.limit+"&offset="+PO_STATE.offset;
  if(PO_STATE.vendor)q+="&vendor="+encodeURIComponent(PO_STATE.vendor);
  if(PO_STATE.dept)q+="&dept="+encodeURIComponent(PO_STATE.dept);
  api("/api/po-lines/list?"+q).then(function(d){
    var lines=d.lines||[];var sm=d.summary||{};
    var su=$("poSummary");if(su)su.innerHTML=poSummaryCards(sm)
      +'<div class="muted small">'+num(sm.lines)+' lines match the status filter'+(lines.length?(" \\u00b7 showing "+(PO_STATE.offset+1)+"\\u2013"+(PO_STATE.offset+lines.length)):"")+'</div>';
    var tbl=makeTable([
      {key:"po_number",label:"PO"},
      {key:"order_date",label:"Date"},
      {key:"vendor_name",label:"Vendor",mobileHide:true},
      {key:"article_desc",label:"Article",cls:"desc"},
      {key:"sap_dept_code",label:"Dept",mobileHide:true},
      {key:"order_qty",label:"Qty",num:true},
      {key:"line_value_cents",label:"Value",num:true,fmt:function(v){return R(v)}},
      {key:"open_value_cents",label:"Open",num:true,fmt:function(v){return R(v)}},
      {key:"days_outstanding",label:"Days",num:true},
      {key:"status",label:"Status",html:function(r){return esc(r.bucket||r.status)}}
    ],lines,{onRow:function(r){if(r.po_number)openPO(r.po_number)}});
    var pager='<div class="toolbar" style="margin-top:10px"><button class="btn alt" id="poPrev"'+(PO_STATE.offset<=0?" disabled":"")+'>\\u2190 Prev</button>'
      +'<button class="btn alt" id="poNext"'+(lines.length<PO_STATE.limit?" disabled":"")+'>Next \\u2192</button>'
      +'<span class="muted small">Page '+(Math.floor(PO_STATE.offset/PO_STATE.limit)+1)+'</span></div>';
    body.innerHTML=tbl+pager+poReturnsCard(d.returnsByVendor);
    var pv=$("poPrev");if(pv)pv.onclick=function(){PO_STATE.offset=Math.max(0,PO_STATE.offset-PO_STATE.limit);poLoad()};
    var nx=$("poNext");if(nx)nx.onclick=function(){PO_STATE.offset+=PO_STATE.limit;poLoad()};
  }).catch(function(e){body.innerHTML='<div class="err">'+esc(e&&e.message||e)+'</div>'});
}

// ---- Weekly Budgets screen (#budgets): 12-week sales/PO/GR budget vs actual ----
function bgMC(cents){return cents==null?'<td class="num muted">\\u2014</td>':'<td class="num">'+R(cents)+'</td>'}
function bgFuture(){return '<td class="num muted">\\u2014</td>'}
// Variance cell. goodWhenOver=true for sales (over budget = good); false for PO/GR (under = good).
function bgVar(varPct,goodWhenOver){
  if(varPct==null)return '<td class="num muted">\\u2014</td>';
  var good=goodWhenOver?(varPct>=0):(varPct<=0);
  return '<td class="num"><span class="'+(good?"pos":"neg")+'">'+(varPct>=0?"\\u25B2 +":"\\u25BC ")+varPct+'%</span></td>';
}
function bgTriple(m,future,goodWhenOver){
  return bgMC(m.budgetCents)+(future?bgFuture():bgMC(m.actualCents))+bgVar(future?null:m.varPct,goodWhenOver);
}
// PO triple: actual cell is NET, with a Gross/Returns/Net tooltip; variance on net.
function bgTriplePo(m,future){
  var act;
  if(future||m.actualCents==null){act=bgFuture();}
  else{
    var ret=(m.returnsCents)?'-'+R(-m.returnsCents):R(0);
    var tip=m.grossCents!=null?' title="Gross '+R(m.grossCents)+' \\u00b7 Returns '+ret+' \\u00b7 Net '+R(m.netCents)+'"':'';
    act='<td class="num"'+tip+'>'+R(m.actualCents)+'</td>';
  }
  return bgMC(m.budgetCents)+act+bgVar(future?null:m.varPct,false);
}
function bgWeekRow(w){
  var s=w.store;
  var main='<tr class="bgwk" data-wc="'+esc(w.weekCode)+'" style="cursor:pointer">'
    +'<td><b>'+esc(w.weekEnding)+'</b> <span class="muted small">W'+esc(w.weekNo)+'</span></td>'
    +bgTriple(s.sales,w.isFuture,true)+bgTriplePo(s.po,w.isFuture)+bgTriple(s.gr,w.isFuture,false)+'</tr>';
  var det=(w.depts||[]).map(function(dp){
    return '<tr class="bgdt bgdt-'+esc(w.weekCode)+'" style="display:none;background:#f7fafc">'
      +'<td class="small" style="padding-left:18px">'+esc(dp.name)+' ('+esc(dp.code)+')</td>'
      +bgTriple(dp.sales,w.isFuture,true)+bgTriplePo(dp.po,w.isFuture)+bgTriple(dp.gr,w.isFuture,false)+'</tr>';
  }).join("");
  var edit='<tr class="bgdt bgdt-'+esc(w.weekCode)+'" style="display:none"><td colspan="10" style="padding-left:18px"><a class="link" href="#settings">\\u270E Edit budgets in Settings \\u2192</a></td></tr>';
  return main+det+edit;
}
// ---- Budget Generator (modal on #budgets; /api/budgets/suggest) ----
function bgStep(v,step){return step>0?Math.round(v/step)*step:Math.round(v)}
function openBudgetGen(){
  var body='<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:520px">'
    +'<label class="small muted">Base year (LY)<br><select class="sel" id="bgBase" style="width:100%"><option value="2026">FY2026</option><option value="2025">FY2025</option><option value="2027">FY2027</option></select></label>'
    +'<label class="small muted">Sales growth %<br><input class="inp" id="bgGrowth" type="number" step="0.1" value="5" style="width:100%"></label>'
    +'<label class="small muted">Stock cover %<br><input class="inp" id="bgCover" type="number" step="0.1" value="20" style="width:100%"></label>'
    +'<label class="small muted">PO safety %<br><input class="inp" id="bgSafety" type="number" step="0.1" value="5" style="width:100%"></label>'
    +'<label class="small muted">From week code<br><input class="inp" id="bgFrom" placeholder="blank = next 13" style="width:100%"></label>'
    +'<label class="small muted">To week code<br><input class="inp" id="bgTo" placeholder="blank = next 13" style="width:100%"></label>'
    +'<label class="small muted">Round to<br><select class="sel" id="bgRound" style="width:100%"><option value="1000">R1,000</option><option value="100">R100</option><option value="10000">R10,000</option><option value="1">R1</option></select></label>'
    +'</div><div style="margin-top:12px"><button class="btn" onclick="bgPreview()">Preview budgets \\u2192</button></div>';
  openModal("Budget Generator",body);
}
function bgPreview(){
  var base=$("bgBase").value,g=$("bgGrowth").value,c=$("bgCover").value,sf=$("bgSafety").value,rt=$("bgRound").value;
  var fw=$("bgFrom").value.trim(),tw=$("bgTo").value.trim();
  var qs="baseYear="+base+"&salesGrowthPct="+g+"&stockCoverPct="+c+"&poSafetyPct="+sf+"&roundTo="+rt+(fw&&tw?("&fromWeek="+fw+"&toWeek="+tw):"");
  $("modalBody").innerHTML='<div class="loading">Generating\\u2026</div>';
  api("/api/budgets/suggest?"+qs).then(function(d){
    window._bg={params:d.params,map:{}};
    var cards=(d.weeks||[]).map(function(w){window._bg.map[w.weekCode]=w;var s=w.store;var cf=(w.cashFlowFlags||[])[0];
      var badges=cf?cf.badges.map(function(b){return '<span class="pill '+(cf.severity==="CRITICAL"?"OVER":"TIGHT")+'">'+esc(b)+'</span>'}).join(" "):"";
      var msg=cf?'<div class="small '+(cf.severity==="CRITICAL"?"neg":"")+'" style="margin:2px 0 6px">\\u26A0 '+esc(cf.message)+'</div>':"";
      var adj=s.adjustedPoZar!=null?'<label class="small"><input type="checkbox" id="bgADJ'+w.weekCode+'"> Use adjusted PO '+Rr0(s.adjustedPoZar)+' (\\u221215%)</label>':"";
      var dep=(w.depts||[]).map(function(x){return '<div class="mc-row"><span class="mc-l">'+esc(x.code)+' '+esc(x.name)+'</span><span class="mc-v">Sales '+Rr0(x.suggestedSalesZar)+' \\u00b7 GR '+Rr0(x.suggestedGrZar)+' \\u00b7 PO '+Rr0(x.suggestedPoZar)+'</span></div>'}).join("");
      return '<div class="card" style="margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:center"><b>W/E '+esc(w.weekEnding)+' \\u00b7 Week '+esc(w.weekNo)+'</b><span>'+badges+'</span></div>'+msg
        +'<div class="mlist" style="margin-top:6px">'
        +'<div class="mc-row"><span class="mc-l">LY sales \\u2192 expected TY</span><span class="mc-v">'+Rr0(s.lySalesZar)+' \\u2192 '+Rr0(s.expectedTyZar)+'</span></div>'
        +'<div class="mc-row"><span class="mc-l">Sales budget (R)</span><span class="mc-v"><input class="inp" id="bgS'+w.weekCode+'" type="number" step="1000" value="'+s.suggestedSalesZar+'" style="width:130px;text-align:right" oninput="bgRecalc(\\''+w.weekCode+'\\')"></span></div>'
        +'<div class="mc-row"><span class="mc-l">Margin (LY) \\u00b7 Required COS</span><span class="mc-v">'+pct(s.lyMarginPct)+' \\u00b7 <span id="bgCOS'+w.weekCode+'">'+Rr0(s.requiredCosZar)+'</span></span></div>'
        +'<div class="mc-row"><span class="mc-l">Buffer stock</span><span class="mc-v" id="bgBUF'+w.weekCode+'">'+Rr0(s.bufferStockZar)+'</span></div>'
        +'<div class="mc-row"><span class="mc-l">Suggested GR</span><span class="mc-v" id="bgGR'+w.weekCode+'">'+Rr0(s.suggestedGrZar)+'</span></div>'
        +'<div class="mc-row"><span class="mc-l">Suggested PO</span><span class="mc-v" id="bgPO'+w.weekCode+'">'+Rr0(s.suggestedPoZar)+'</span></div>'
        +'</div>'+adj
        +'<details style="margin-top:6px"><summary class="small muted" style="cursor:pointer">Department breakdown</summary><div class="mlist">'+dep+'</div></details></div>';
    }).join("");
    $("modalBody").innerHTML='<div style="max-height:58vh;overflow:auto">'+(cards||'<div class="muted small">No weeks in range.</div>')+'</div>'
      +'<div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn" onclick="bgSaveAll()">\\uD83D\\uDCBE Save all to weekly budgets</button><button class="btn alt" onclick="openBudgetGen()">\\u2190 Back</button><span id="bgMsg" class="small muted"></span></div>';
  }).catch(function(e){$("modalBody").innerHTML='<div class="err">'+esc(e&&e.message||e)+'</div>'});
}
function bgRecalc(wc){
  var w=window._bg&&window._bg.map[wc];if(!w)return;var p=window._bg.params;
  var sales=Number($("bgS"+wc).value)||0;var margin=w.store.lyMarginPct!=null?w.store.lyMarginPct:20;
  var cos=sales*(1-margin/100);var buf=cos*(p.coverPct/100);var gr=bgStep(cos+buf,p.roundTo);var po=bgStep(gr*(1+p.safetyPct/100),p.roundTo);
  $("bgCOS"+wc).textContent=Rr0(Math.round(cos));$("bgBUF"+wc).textContent=Rr0(Math.round(buf));$("bgGR"+wc).textContent=Rr0(gr);$("bgPO"+wc).textContent=Rr0(po);
}
function bgSaveAll(){
  var m=window._bg&&window._bg.map;if(!m)return;var keys=Object.keys(m);var msg=$("bgMsg");if(msg)msg.textContent="Saving\\u2026";var p=window._bg.params;
  var calls=keys.map(function(wc){var w=m[wc];
    var sales=Number($("bgS"+wc).value)||0;var margin=w.store.lyMarginPct!=null?w.store.lyMarginPct:20;
    var cos=sales*(1-margin/100);var buf=cos*(p.coverPct/100);var gr=bgStep(cos+buf,p.roundTo);var po=bgStep(gr*(1+p.safetyPct/100),p.roundTo);
    var adjEl=$("bgADJ"+wc);var usePo=(adjEl&&adjEl.checked&&w.store.adjustedPoZar!=null)?w.store.adjustedPoZar:po;
    var rows=[{budget_type:"store",department:"TOTAL",sales_budget_zar:sales,po_budget_zar:usePo,gr_budget_zar:gr}];
    (w.depts||[]).forEach(function(x){rows.push({budget_type:"department",department:x.code,sales_budget_zar:x.suggestedSalesZar,po_budget_zar:x.suggestedPoZar,gr_budget_zar:x.suggestedGrZar})});
    return adminSend("/api/weekly-budgets","POST",{week_code:wc,week_ending:w.weekEnding,rows:rows});
  });
  Promise.all(calls).then(function(){if(msg)msg.textContent="Saved.";closeModal();PAGES.budgets()}).catch(function(e){if(msg)msg.textContent="Error: "+(e&&e.message||e)});
}

PAGES.budgets=function(){loading();api("/api/budgets/summary").then(function(d){
  var weeks=d.weeks||[];
  var h='<div class="toolbar"><button class="btn" onclick="openBudgetGen()">\\u25B6 Generate Budgets</button></div>'
    +'<div class="card"><h2>Weekly budgets \\u2014 Sales / PO / GR</h2>'
    +'<div class="muted small" style="margin-bottom:8px">Past 8 + next 4 fiscal weeks. Sales variance is green when over budget; PO/GR variance is green when under budget. Future weeks show \\u2014. Click a week for the department breakdown.</div>'
    +'<div class="tablewrap"><table><thead>'
    +'<tr><th rowspan="2">Week</th><th colspan="3" style="text-align:center">Sales</th><th colspan="3" style="text-align:center">Purchase Orders</th><th colspan="3" style="text-align:center">Goods Receipts</th></tr>'
    +'<tr><th class="num">Budget</th><th class="num">Actual</th><th class="num">Var</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Var</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Var</th></tr>'
    +'</thead><tbody>'+(weeks.length?weeks.map(bgWeekRow).join(""):'<tr><td colspan="10" class="muted" style="padding:14px;text-align:center">No fiscal weeks in range.</td></tr>')+'</tbody></table></div>'
    +'<div class="small muted" style="margin-top:8px">* PO Actual = <b>Net</b> (S001 gross orders minus S002 returns to vendor); budget % is based on net. Hover a PO Actual cell for the Gross / Returns / Net split. &nbsp;<a class="link" href="#settings">Edit weekly budgets in Settings \\u2192</a></div></div>';
  setHTML(h);
  document.querySelectorAll(".bgwk").forEach(function(r){r.addEventListener("click",function(){
    var wc=this.getAttribute("data-wc");
    document.querySelectorAll(".bgdt-"+wc).forEach(function(x){x.style.display=x.style.display==="none"?"":"none"});
  })});
}).catch(errBox)};

// ---- Weekly / Monthly / FY share a period engine ----
function weekBounds(d){var x=new Date(d+"T00:00:00Z");var dow=(x.getUTCDay()+6)%7;var mon=new Date(x);mon.setUTCDate(x.getUTCDate()-dow);var sun=new Date(mon);sun.setUTCDate(mon.getUTCDate()+6);return [mon.toISOString().slice(0,10),sun.toISOString().slice(0,10)]}

PAGES.weekly=function(){
  setHTML('<div class="toolbar"><label class="small muted">Week of</label><input class="inp" type="date" id="wkpick"><span id="wkrange" class="tag"></span></div><div id="wkbody"><div class="loading">Loading\\u2026</div></div>');
  function load(date){if($("wkpick").value!==date)$("wkpick").value=date;
    // Use the official fiscal week (lookup) for boundaries + label; fall back to Mon–Sun.
    api("/api/fiscal/week?date="+date).then(function(fw){
      var b,labelPrefix="";
      if(fw.week){b=[fw.week.week_start,fw.week.week_end];labelPrefix=fw.week.fiscal_week_code+" \\u00b7 ";}
      else b=weekBounds(date);
      $("wkrange").innerHTML=esc(labelPrefix)+esc(b[0])+' <span class="muted">\\u2192</span> '+esc(b[1]);
      runWeek(b);
    }).catch(function(){var b=weekBounds(date);$("wkrange").innerHTML=esc(b[0])+' <span class="muted">\\u2192</span> '+esc(b[1]);runWeek(b)});
  }
  function runWeek(b){
    Promise.all([api("/api/purchases/summary?groupBy=day&from="+b[0]+"&to="+b[1]),api("/api/vendors?from="+b[0]+"&to="+b[1]),api("/api/categories"),api("/api/settings"),api("/api/anomalies?resolved=false&limit=40"),api("/api/gr/period?from="+b[0]+"&to="+b[1]),api("/api/fim/period?from="+b[0]+"&to="+b[1])]).then(function(res){
      var sum=res[0],ven=res[1],cat=res[2],sett=res[3].settings||{},an=res[4],gr=res[5],fim=res[6];
      var cap=Number(sett.weekly_cap||2000000)*100;var t=sum.totals||{};var used=cap?Math.round((t.purchases||0)/cap*1000)/10:0;
      var topV=(ven.vendors||[]).slice(0,10).map(function(v){return {label:v.name||v.code,value:(v.purchases||0)/100}});
      var topC=(cat.categories||[]).slice(0,10).map(function(c){return {label:c.code,value:(c.purchases||0)/100}});
      var days=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];var byd={};(sum.series||[]).forEach(function(s){byd[s.key]=s});
      var rowsD=[];for(var i=0;i<7;i++){var dt=new Date(b[0]+"T00:00:00Z");dt.setUTCDate(dt.getUTCDate()+i);var ds=dt.toISOString().slice(0,10);var s=byd[ds]||{purchases:0,returns:0,lines:0};rowsD.push({day:days[i],date:ds,purchases:s.purchases,returns:s.returns,lines:s.lines})}
      var h='<div class="cards kpis">'+kpi("Total purchases",R(t.purchases),null)+kpi("Open to deliver",R(t.open_deliver),null)+kpi("Lines",num(t.lines),null)+kpi("Budget used",used+"%",statusPill(trafficFor(used))+" of "+R0(cap))+'</div>';
      h+='<div class="cards g2"><div class="card"><h2>Top 10 vendors</h2>'+hbars(topV,null,R0)+'</div><div class="card"><h2>Top 10 categories</h2>'+hbars(topC,null,R0)+'</div></div>';
      h+='<div class="cards g2" style="margin-top:14px"><div class="card"><h2>Day-by-day purchases</h2>'+makeTable([{key:"day",label:"Day"},{key:"date",label:"Date"},{key:"purchases",label:"Purchases",num:true,fmt:R},{key:"returns",label:"Returns",num:true,fmt:R},{key:"lines",label:"Lines",num:true}],rowsD,{search:false,rowMenu:false})+'</div>';
      h+='<div class="card"><h2>Anomalies this week</h2><table><tbody>'+((an.anomalies||[]).slice(0,12).map(function(a){return '<tr><td class="sev-'+a.severity+'">'+a.severity+'</td><td class="small">'+esc(a.message)+'</td></tr>'}).join("")||'<tr><td class="muted">None.</td></tr>')+'</tbody></table></div></div>';
      h+=grFimSection(gr,fim);
      $("wkbody").innerHTML=h;
    }).catch(function(e){$("wkbody").innerHTML='<div class="err">'+esc(e.message)+'</div>'});
  }
  $("wkpick").onchange=function(){load(this.value)};
  // Default to the latest week that actually has PO data.
  api("/api/meta/range").then(function(m){var d=(m.po&&m.po.max)||new Date().toISOString().slice(0,10);load(d)}).catch(function(){load(new Date().toISOString().slice(0,10))});
};

PAGES.monthly=function(){
  setHTML('<div class="toolbar"><label class="small muted">Month</label><input class="inp" type="month" id="mpick"><span id="mfiscal" class="tag"></span></div><div id="mbody"><div class="loading">Loading\\u2026</div></div>');
  function load(m){var from=m+"-01";var to=new Date(Date.UTC(+m.slice(0,4),+m.slice(5,7),0)).toISOString().slice(0,10);if($("mpick").value!==m)$("mpick").value=m;
    api("/api/fiscal/week?date="+m+"-15").then(function(fw){if(fw.week)$("mfiscal").textContent="FY"+fw.week.fiscal_year+" \\u00b7 "+fw.week.fiscal_period_code}).catch(function(){});
    Promise.all([api("/api/purchases/summary?groupBy=week&from="+from+"&to="+to),api("/api/settings"),api("/api/gr/period?from="+from+"&to="+to),api("/api/fim/period?from="+from+"&to="+to)]).then(function(res){
      var sum=res[0],sett=res[1].settings||{},gr=res[2],fim=res[3];var t=sum.totals||{};
      var weeklyCap=Number(sett.weekly_cap||2000000);var nWeeks=(sum.series||[]).length||4;var monthCap=weeklyCap*nWeeks*100;var used=monthCap?Math.round((t.purchases||0)/monthCap*1000)/10:0;
      var series=(sum.series||[]).map(function(s){return {label:s.label,short:s.key.slice(-3),value:(s.purchases||0)/100}});
      var h='<div class="cards kpis">'+kpi("Purchases (month)",R(t.purchases),null)+kpi("Returns",R(t.returns),null)+kpi("Lines",num(t.lines),null)+kpi("Budget used",used+"%",statusPill(trafficFor(used)))+'</div>';
      h+='<div class="card"><h2>Purchases per week vs budget</h2>'+colChart(series,{budget:weeklyCap})+'<div class="legend">Red dashed = weekly cap '+R0(weeklyCap*100)+'</div></div>';
      h+='<div class="card" style="margin-top:14px"><h2>Week-by-week breakdown</h2>'+makeTable([{key:"label",label:"Week"},{key:"purchases",label:"Purchases",num:true,fmt:function(v,r){return R(r.purchases)}},{key:"returns",label:"Returns",num:true,fmt:function(v,r){return R(r.returns)}},{key:"lines",label:"Lines",num:true}],(sum.series||[]),{search:false,rowMenu:false})+'</div>';
      h+=grFimSection(gr,fim);
      $("mbody").innerHTML=h;
    }).catch(function(e){$("mbody").innerHTML='<div class="err">'+esc(e.message)+'</div>'});
  }
  $("mpick").onchange=function(){load(this.value)};
  api("/api/meta/range").then(function(m){var mx=(m.po&&m.po.max)||new Date().toISOString().slice(0,10);load(mx.slice(0,7))}).catch(function(){load(new Date().toISOString().slice(0,7))});
};

PAGES.fy=function(){
  loading();
  Promise.all([api("/api/purchases/summary?groupBy=month"),api("/api/settings"),api("/api/gr/period?from=2000-01-01&to=2099-12-31"),api("/api/fim/period?from=2000-01-01&to=2099-12-31")]).then(function(res){
    var sum=res[0],sett=res[1].settings||{},gr=res[2],fim=res[3];var t=sum.totals||{};
    // monthly_turnover_target is stored as a human-formatted string ("14 000 000"),
    // so Number() on it directly is NaN (was rendering "RNaN"). Strip non-numeric
    // separators before parsing; fall back to 8M if empty/unparseable.
    var monthlyTarget=Number(String(sett.monthly_turnover_target||"").replace(/[^0-9.]/g,""))||8000000;
    var series=(sum.series||[]).map(function(s){return {label:s.label,short:s.key.slice(5),value:(s.purchases||0)/100}});
    // quarters (fiscal Q1 Mar-May...)
    var q={Q1:0,Q2:0,Q3:0,Q4:0};(sum.series||[]).forEach(function(s){var mo=Number(s.key.slice(5,7));var qq=(mo>=3&&mo<=5)?"Q1":(mo>=6&&mo<=8)?"Q2":(mo>=9&&mo<=11)?"Q3":"Q4";q[qq]+=s.purchases});
    var h='<div class="cards kpis">'+kpi("FY purchases to date",R(t.purchases),null)+kpi("Returns",R(t.returns),null)+kpi("PO count",num(t.po_count),null)+kpi("Monthly target",R0(monthlyTarget*100),"Monthly pace")+'</div>';
    h+='<div class="card"><h2>Month-by-month vs target</h2>'+colChart(series,{budget:monthlyTarget})+'</div>';
    h+='<div class="card" style="margin-top:14px"><h2>Quarter breakdown</h2><div class="cards g2">'+["Q1","Q2","Q3","Q4"].map(function(k){return kpi(k+" (Mar-Feb FY)",R(q[k]),null)}).join("")+'</div></div>';
    h+=grFimSection(gr,fim);
    setHTML(h);
  }).catch(errBox);
};

PAGES.vendors=function(){
  setHTML(periodPickerHTML("vperiod")+'<div id="vbody"><div class="loading">Loading\\u2026</div></div>');
  function load(from,to){$("vbody").innerHTML='<div class="loading">Loading\\u2026</div>';
    api("/api/vendors?from="+from+"&to="+to).then(function(d){
      var rows=d.vendors||[];
      $("vbody").innerHTML='<div class="card"><h2>Vendor analysis ('+rows.length+') \\u2014 sorted by net spend</h2>'+makeTable([
        {key:"code",label:"Vendor"},
        {key:"name",label:"Name",html:function(r){return esc(r.name||"")+((r.purchases>0&&r.returns/r.purchases>0.05)?' <span class="neg small" title="Returns exceed 5% of gross orders">high returns</span>':"")}},
        {key:"purchases",label:"Gross",num:true,fmt:R},
        {key:"returns",label:"Returns",num:true,html:function(r){return '<span style="color:var(--red)">'+(r.returns>0?'-'+R(r.returns):R(0))+'</span>'}},
        {key:"net",label:"Net",num:true,html:function(r){return '<b style="color:var(--nav)">'+R(r.net)+'</b>'}},
        {key:"open_deliver",label:"Open deliver",num:true,fmt:R},
        {key:"open_invoice",label:"Open invoice",num:true,fmt:R},{key:"po_count",label:"POs",num:true},{key:"lines",label:"Lines",num:true}
      ],rows,{onRow:function(r){openVendor(r.code)},cards:true})+'</div>';
    }).catch(function(e){$("vbody").innerHTML='<div class="err">'+esc(e.message)+'</div>'});}
  initPeriodPicker("vperiod",load,"month");
};

var _artRows=[],_artRank="po";
PAGES.articles=function(){loading();api("/api/articles?limit=1000").then(function(d){
  _artRows=d.articles||[];artRender();
}).catch(errBox)};
function artRank(m){_artRank=m;artRender();}
function artRender(){
  var rows=_artRows.slice();
  rows.sort(function(a,b){return _artRank==="gr"?((b.gr_cost||0)-(a.gr_cost||0)):((b.total_value||0)-(a.total_value||0))});
  var toggle='<div class="tabs" style="margin-bottom:8px">'
    +'<button class="'+(_artRank==="po"?"active":"")+'" onclick="artRank(\\'po\\')">Rank by PO value ordered</button>'
    +'<button class="'+(_artRank==="gr"?"active":"")+'" onclick="artRank(\\'gr\\')">Rank by GR value received</button></div>';
  setHTML('<div class="card"><h2>Article analysis <span class="muted small">'+rows.length+' articles \\u00b7 PO ordered vs GR received</span></h2>'+toggle+makeTable([
    {key:"code",label:"Article"},{key:"description",label:"Description",cls:"desc"},{key:"dept",label:"Dept",mobileHide:true},
    {key:"total_value",label:"PO value ordered",num:true,fmt:R},
    {key:"gr_cost",label:"GR value received",num:true,mobileHide:true,html:function(r){return r.gr_cost?Rr0(r.gr_cost):'<span class="muted">\\u2014</span>'}},
    {key:"avg_price",label:"Unit price",num:true,mobileHide:true,html:function(r){return R(r.avg_price)+(r.price_basis==="unit"?'<span class="muted small"> /'+esc(r.sku_uom||"ea")+'</span>':'<span class="muted small" title="per order unit \\u2014 re-upload with SKU qty for per-unit price"> *</span>')}},{key:"order_count",label:"Orders",num:true}
  ],rows,{onRow:function(r){openArticle(r.code)}})+'</div>');
}

PAGES.categories=function(){
  setHTML(periodPickerHTML("cperiod")+'<div id="cbody"><div class="loading">Loading\\u2026</div></div>');
  function load(from,to){$("cbody").innerHTML='<div class="loading">Loading\\u2026</div>';
    api("/api/categories?from="+from+"&to="+to).then(function(d){
      var rows=d.categories||[];
      $("cbody").innerHTML='<div class="card"><h2>Category analysis ('+rows.length+') <span class="muted small">purchases in selected period</span></h2>'+makeTable([
        {key:"code",label:"Category"},{key:"dept",label:"Dept",mobileHide:true},
        {key:"purchases",label:"Purchases",num:true,fmt:R},{key:"open_deliver",label:"Open deliver",num:true,fmt:R},{key:"lines",label:"Lines",num:true}
      ],rows,{rowMenu:false,onRow:function(r){openCategory(r.code)}})+'</div>';
    }).catch(function(e){$("cbody").innerHTML='<div class="err">'+esc(e.message)+'</div>'});}
  initPeriodPicker("cperiod",load,"month");
};
function openCategory(code){openModal("Category "+esc(code),'<div class="loading">Loading\\u2026</div>');
  api("/api/categories/"+encodeURIComponent(code)).then(function(d){
    openModal("Category "+esc(code),makeTable([{key:"po_number",label:"PO"},{key:"order_date",label:"Date"},{key:"vendor",label:"Vendor"},{key:"article_code",label:"Article"},{key:"description",label:"Description"},{key:"order_qty",label:"Qty",num:true},{key:"line_value_cents",label:"Value",num:true,fmt:R}],d.lines||[],{}));
  }).catch(function(e){openModal("Category "+esc(code),'<div class="err">'+esc(e.message)+'</div>')});
}

// ---- Customer Count daily page ----------------------------------------------
// Period anchor is the latest cal_date in the DB (data runs 1-2 days behind), not
// today. All ranges are calendar-based; FY starts 1 March (SA retail).
function ccMonday(iso){var d=new Date(iso+"T00:00:00Z");var wd=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-wd);return d.toISOString().slice(0,10)}
function ccFyStart(iso){var y=+iso.slice(0,4),m=+iso.slice(5,7);return (m>=3?y:y-1)+"-03-01"}
function ccLastFY(iso){var y=+ccFyStart(iso).slice(0,4);var feb=new Date(Date.UTC(y,2,0)).toISOString().slice(0,10);return [(y-1)+"-03-01",feb]}
function ccVarCell(v){if(v==null)return "\\u2014";var cls=v>0?"pos":v<0?"neg":"";return '<span class="'+cls+'">'+(v>=0?"+":"")+v.toFixed(1)+"%</span>"}
function ccFriendly(s){var M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];var p=String(s||"").split("-");return p.length===3?(+p[2])+" "+M[(+p[1])-1]+" "+p[0]:(s||"")}
// Daily customers line chart (TY solid navy, optional LY dashed grey); x labels every 14 days.
function ccDailyChart(rows,showLy){
  var pts=(rows||[]).slice().reverse().filter(function(r){return r.customers_ty!=null});
  if(pts.length<2)return '<div class="muted small">Not enough days for a chart.</div>';
  var W=760,H=240,pad=40,n=pts.length;
  var vals=pts.map(function(p){return p.customers_ty||0});
  if(showLy)vals=vals.concat(pts.map(function(p){return p.customers_ly||0}));
  var mx=Math.max.apply(null,vals)||1;
  function X(i){return pad+(n<=1?(W-2*pad)/2:i*(W-2*pad)/(n-1))}
  function Y(v){return H-pad-((v||0)/mx)*(H-2*pad)}
  function poly(key,col,dash){return '<polyline points="'+pts.map(function(p,i){return X(i).toFixed(1)+","+Y(p[key]).toFixed(1)}).join(" ")+'" fill="none" stroke="'+col+'" stroke-width="2"'+(dash?' stroke-dasharray="5 4"':'')+'/>'}
  var xlabs=pts.map(function(p,i){if(i%14!==0&&i!==n-1)return "";return '<text x="'+X(i).toFixed(1)+'" y="'+(H-pad+16)+'" font-size="10" fill="#6a7480" text-anchor="middle">'+esc(shortDate(p.cal_date))+'</text>'}).join("");
  var yax='<text x="'+(pad-6)+'" y="'+(H-pad)+'" font-size="10" fill="#6a7480" text-anchor="end">0</text><text x="'+(pad-6)+'" y="'+(pad+4)+'" font-size="10" fill="#6a7480" text-anchor="end">'+num(mx)+'</text>';
  var legend='<div class="small" style="margin-bottom:6px"><span style="color:#2E6CA8;font-weight:700">\\u25CF This year</span>'+(showLy?' &nbsp; <span style="color:#9aa4ae;font-weight:700">\\u25CF Last year</span>':'')+'</div>';
  return legend+'<div class="svgwrap"><svg viewBox="0 0 '+W+' '+H+'"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="#e2e7ec"/>'+(showLy?poly("customers_ly","#9aa4ae",true):"")+poly("customers_ty","#2E6CA8",false)+yax+xlabs+'</svg></div>';
}
// Average customers (TY) grouped by day of week (Mon..Sun).
function byDayOfWeek(rows){
  var days=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  var sum=[0,0,0,0,0,0,0],cnt=[0,0,0,0,0,0,0];
  (rows||[]).forEach(function(r){if(r.customers_ty==null)return;var d=new Date(r.cal_date+"T00:00:00Z");var wd=(d.getUTCDay()+6)%7;sum[wd]+=r.customers_ty;cnt[wd]++});
  var items=days.map(function(nm,i){return {label:nm,value:cnt[i]?Math.round(sum[i]/cnt[i]):0}});
  if(!items.some(function(it){return it.value>0}))return '<div class="muted small">No data.</div>';
  return hbars(items,null,function(v){return num(Math.round(v))});
}
PAGES.customers=function(){
  var saved="28";try{saved=localStorage.getItem("customers-period")||"28"}catch(e){}
  var opts=[["7","Last 7 days"],["28","Last 28 days"],["90","Last 90 days"],["month","This month"],["lastmonth","Last month"],["custom","Custom\\u2026"]];
  setHTML('<div class="toolbar"><label class="small muted">Period</label>'
    +'<select class="sel" id="ccPeriod">'+opts.map(function(o){return '<option value="'+o[0]+'"'+(o[0]===saved?" selected":"")+'>'+esc(o[1])+'</option>'}).join("")+'</select>'
    +'<span id="ccCustom"'+(saved==="custom"?"":" hidden")+'><input type="date" class="inp" id="ccFrom"> <input type="date" class="inp" id="ccTo"> <button class="btn" id="ccApply">Apply</button></span>'
    +'<button class="btn alt" id="ccLyToggle">Show LY</button>'
    +'<span class="muted small" id="ccRange"></span></div>'
    +'<div id="ccBody"><div class="loading">Loading\\u2026</div></div>');
  var latest=null,showLy=false,lastRows=[];
  function pad2(n){return (n<10?"0":"")+n}
  function rangeFor(p){
    if(!latest)return null;
    var ld=new Date(latest+"T00:00:00Z");
    function back(n){var x=new Date(ld);x.setUTCDate(ld.getUTCDate()-(n-1));return x.toISOString().slice(0,10)}
    if(p==="7")return [back(7),latest];
    if(p==="28")return [back(28),latest];
    if(p==="90")return [back(90),latest];
    if(p==="month")return [latest.slice(0,7)+"-01",latest];
    if(p==="lastmonth"){var y=+latest.slice(0,4),m=+latest.slice(5,7);var pm=m===1?12:m-1,py=m===1?y-1:y;return [py+"-"+pad2(pm)+"-01",new Date(Date.UTC(py,pm,0)).toISOString().slice(0,10)];}
    return [back(28),latest];
  }
  function render(rows){
    rows=rows||[];var body=$("ccBody");if(!body)return;
    if(!rows.length){body.innerHTML='<div class="muted small" style="padding:16px">No customer data for this period.</div>';return;}
    var cty=0,cly=0,sty=0,sly=0,bsum=0,bcnt=0;
    rows.forEach(function(r){cty+=r.customers_ty||0;cly+=r.customers_ly||0;sty+=r.sales_ty_zar||0;sly+=r.sales_ly_zar||0;if(r.avg_basket_value!=null){bsum+=r.avg_basket_value;bcnt++}});
    var cvar=cly>0?Math.round((cty-cly)/cly*1000)/10:null;
    var svar=sly>0?Math.round((sty-sly)/sly*1000)/10:null;
    var h='<div class="cards kpis">'
      +kpi("Customers (TY)",num(cty),(cly?num(cly)+" LY":null))
      +kpi("Customers \\u0394",ccVarCell(cvar),"vs LY")
      +kpi("Sales (TY)",Rr0(sty),(sly?Rr0(sly)+" LY":null))
      +kpi("Sales \\u0394",ccVarCell(svar),"vs LY")
      +kpi("Avg basket",bcnt?Rr(bsum/bcnt):"\\u2014",null)
      +kpi("Avg daily customers",num(Math.round(cty/rows.length)),null)
      +'</div>';
    h+='<div class="card" style="margin-top:12px"><h2>Daily customers</h2>'+ccDailyChart(rows,showLy)+'</div>';
    h+='<div class="card" style="margin-top:12px"><h2>Average customers by day of week</h2>'+byDayOfWeek(rows)+'</div>';
    var cols=[
      {key:"cal_date",label:"Date",html:function(r){return esc(ccFriendly(r.cal_date))}},
      {key:"customers_ty",label:"Cust TY",num:true,fmt:num}
    ];
    if(showLy)cols.push({key:"customers_ly",label:"Cust LY",num:true,fmt:num});
    cols.push({key:"customers_var_pct",label:"Var%",num:true,html:function(r){return ccVarCell(r.customers_var_pct)}});
    cols.push({key:"sales_ty_zar",label:"Sales TY",num:true,fmt:Rr0});
    if(showLy)cols.push({key:"sales_ly_zar",label:"Sales LY",num:true,fmt:Rr0});
    cols.push({key:"sales_var_pct",label:"Var%",num:true,html:function(r){return ccVarCell(r.sales_var_pct)}});
    h+='<div class="card" style="margin-top:12px"><h2>Daily detail</h2>'+makeTable(cols,rows,{cards:true,rowMenu:false,search:false})+'</div>';
    body.innerHTML=h;
  }
  function load(period){
    var rng;
    if(period==="custom"){var f=$("ccFrom").value,t=$("ccTo").value;if(!f||!t){$("ccRange").textContent="pick both dates";return;}rng=[f,t];}
    else rng=rangeFor(period);
    if(!rng)return;
    $("ccRange").innerHTML=esc(rng[0])+' <span class="muted">\\u2192</span> '+esc(rng[1]);
    $("ccBody").innerHTML='<div class="loading">Loading\\u2026</div>';
    api("/api/customer-counts/daily?from="+rng[0]+"&to="+rng[1]).then(function(rows){lastRows=rows||[];render(lastRows);}).catch(function(e){$("ccBody").innerHTML='<div class="err">'+esc(e.message)+'</div>';});
  }
  $("ccPeriod").onchange=function(){var p=this.value;$("ccCustom").hidden=(p!=="custom");try{localStorage.setItem("customers-period",p)}catch(e){}if(p!=="custom")load(p);};
  $("ccApply").onclick=function(){load("custom");};
  $("ccLyToggle").onclick=function(){showLy=!showLy;this.textContent=showLy?"Hide LY":"Show LY";render(lastRows);};
  api("/api/customer-counts/summary").then(function(s){
    if(!s||!s.hasData){$("ccBody").innerHTML='<div class="muted small" style="padding:16px">No customer data \\u2014 upload Customer Count CSV to get started.</div>';return;}
    latest=s.latestDate;load(saved);
  }).catch(function(e){$("ccBody").innerHTML='<div class="err">'+esc(e.message)+'</div>';});
};

// ---- Fan Score / NPS page ---------------------------------------------------
function fsNpsColor(v){if(v==null)return "var(--muted)";if(v>=50)return "#2E7D32";if(v>=0)return "#d97706";return "#BE1D37"}
function fsClassTag(c){if(!c)return '<span class="muted">\\u2014</span>';var col=c==="promoter"?"#2E7D32":c==="detractor"?"#BE1D37":"#d97706";return '<span style="color:'+col+';font-weight:600">'+esc(c.charAt(0).toUpperCase()+c.slice(1))+'</span>'}
// NPS trend line (rolling 6 weeks ending at the selected week). Draws a horizontal
// target line (default 90%), scales the domain to include it so pass/fail reads at a
// glance, and labels each point with its score value.
function fsTrendChart(weeks,target){
  if(target==null)target=90;
  var pts=(weeks||[]).slice(-6).map(function(w){return {label:w.weekEnding,value:(w.npsTw!=null?w.npsTw:w.npsComputed)}}).filter(function(p){return p.value!=null});
  if(pts.length<2)return '<div class="muted small">Not enough weeks for a trend.</div>';
  var W=760,H=240,pad=44,n=pts.length;
  var vs=pts.map(function(p){return p.value});
  var mn=Math.min.apply(null,vs),mx=Math.max.apply(null,vs);
  if(target!=null){mn=Math.min(mn,target);mx=Math.max(mx,target);}
  mn=Math.min(mn,0);if(mx<=mn)mx=mn+1;
  var span=(mx-mn)||1;mn-=span*0.10;mx+=span*0.14; // headroom for point labels
  function X(i){return pad+(n<=1?(W-2*pad)/2:i*(W-2*pad)/(n-1))}
  function Y(v){return H-pad-((v-mn)/(mx-mn))*(H-2*pad)}
  var line='<polyline points="'+pts.map(function(p,i){return X(i).toFixed(1)+","+Y(p.value).toFixed(1)}).join(" ")+'" fill="none" stroke="#2E6CA8" stroke-width="2"/>';
  var dots=pts.map(function(p,i){return '<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(p.value).toFixed(1)+'" r="3.5" fill="'+fsNpsColor(p.value)+'"><title>'+esc(p.label)+": "+p.value.toFixed(2)+'%</title></circle>'}).join("");
  var vlabs=pts.map(function(p,i){return '<text x="'+X(i).toFixed(1)+'" y="'+Math.max(12,Y(p.value)-8).toFixed(1)+'" font-size="10" font-weight="700" text-anchor="middle" fill="'+fsNpsColor(p.value)+'">'+p.value.toFixed(1)+'%</text>'}).join("");
  var zero=(mn<0&&mx>0)?'<line x1="'+pad+'" y1="'+Y(0).toFixed(1)+'" x2="'+(W-pad)+'" y2="'+Y(0).toFixed(1)+'" stroke="#e2e7ec" stroke-dasharray="3 3"/>':"";
  var tgt='<line x1="'+pad+'" y1="'+Y(target).toFixed(1)+'" x2="'+(W-pad)+'" y2="'+Y(target).toFixed(1)+'" stroke="#2E7D32" stroke-width="1.5" stroke-dasharray="6 4"/><text x="'+(W-pad)+'" y="'+(Y(target)-5).toFixed(1)+'" font-size="10" font-weight="600" text-anchor="end" fill="#2E7D32">target '+target+'%</text>';
  var xlabs=pts.map(function(p,i){return '<text x="'+X(i).toFixed(1)+'" y="'+(H-pad+16)+'" font-size="10" fill="#6a7480" text-anchor="middle">'+esc(shortDate(p.label))+'</text>'}).join("");
  var yax='<text x="'+(pad-6)+'" y="'+(pad+4)+'" font-size="10" fill="#6a7480" text-anchor="end">'+mx.toFixed(0)+'%</text><text x="'+(pad-6)+'" y="'+(H-pad)+'" font-size="10" fill="#6a7480" text-anchor="end">'+mn.toFixed(0)+'%</text>';
  return '<div class="svgwrap"><svg viewBox="0 0 '+W+' '+H+'"><line x1="'+pad+'" y1="'+(H-pad)+'" x2="'+(W-pad)+'" y2="'+(H-pad)+'" stroke="#e2e7ec"/>'+zero+tgt+line+dots+vlabs+yax+xlabs+'</svg></div>';
}
// Promoters / Passives / Detractors as vertically-stacked bars (count + % of scored).
function fsBreakdown(sm){
  var tot=sm.scoredResponses||((sm.promoters||0)+(sm.passives||0)+(sm.detractors||0));
  function bar(label,val,col){var p=tot?Math.round((val||0)/tot*1000)/10:0;return '<div class="hbar"><span class="lab">'+label+'</span><span class="bar"><i style="width:'+Math.max(2,p)+'%;background:'+col+'"></i></span><span class="val">'+num(val)+' ('+p+'%)</span></div>'}
  return bar("Promoters",sm.promoters,"#2E7D32")+bar("Passives",sm.passives,"#d97706")+bar("Detractors",sm.detractors,"#BE1D37");
}
function fsRenderResponses(d){
  var card=$("fsRespCard");if(!card)return;
  if(!d||!d.hasData){card.innerHTML='<h2>Responses \\u00b7 W/E '+esc((d&&d.weekEnding)||"")+'</h2><div class="muted small">No responses for this week.</div>';return;}
  card.innerHTML='<h2>Responses \\u00b7 W/E '+esc(d.weekEnding)+'</h2>'
    +'<div style="margin-top:8px">'+makeTable([
      {key:"score",label:"Score",num:true,html:function(r){return r.score==null?"\\u2014":String(r.score)}},
      {key:"classification",label:"Class",html:function(r){return fsClassTag(r.classification)}},
      {key:"reason",label:"Reason for the score",cls:"desc",html:function(r){return esc(r.reason||"")}}
    ],d.responses||[],{cards:true,rowMenu:false})+'</div>';
}
// Selected week (week_ending) driving the whole Fan Score page; null = latest.
var _fsWeek=null;
PAGES.fanscore=function(){loading();fsLoad(_fsWeek);};
function fsLoad(week){
  var qs=week?("?week="+encodeURIComponent(week)):"";
  Promise.all([
    api("/api/fan-score/summary"+qs),
    api("/api/fan-score/history"+qs),
    api("/api/fan-score/responses"+qs),
    api("/api/customer-counts/summary")
  ]).then(function(res){
    var sm=res[0]||{},hist=(res[1]&&res[1].weeks)||[],resp=res[2]||{},cc=res[3]||{};
    if(!sm.hasData&&!(resp&&resp.hasData)){setHTML('<div class="card"><h2>\\u2B50 Fan Score / NPS</h2><div class="muted small" style="padding:8px">No fan-score data \\u2014 upload a Fan Score report to get started.</div></div>');return;}
    _fsWeek=sm.weekEnding||week||null;
    var tw=sm.npsTw!=null?sm.npsTw:sm.npsComputed;
    var delta=(sm.npsTw!=null&&sm.npsLw!=null)?(sm.npsTw-sm.npsLw):null;
    var vs=hist.map(function(w){return w.npsTw!=null?w.npsTw:w.npsComputed}).filter(function(v){return v!=null});
    var avg=vs.length?vs.reduce(function(a,b){return a+b},0)/vs.length:null;
    var wtdCust=(cc&&cc.hasData&&cc.windows&&cc.windows.wtd)?cc.windows.wtd.customersTy:null;
    // Week selector (full list, newest first) — drives the whole page.
    var allWeeks=(resp&&resp.weeks&&resp.weeks.length)?resp.weeks:hist.map(function(w){return w.weekEnding}).slice().reverse();
    var sel='<select class="sel" id="fsWeekTop">'+allWeeks.map(function(w){return '<option value="'+esc(w)+'"'+(w===_fsWeek?" selected":"")+'>W/E '+esc(w)+'</option>'}).join("")+'</select>';
    var h='<div class="toolbar" style="justify-content:space-between"><div><span class="small muted">Week ending</span> '+sel+'</div><span class="small muted">6-week trend ends at the selected week</span></div>';
    h+='<div class="cards kpis" style="margin-top:8px">'
      +kpi("NPS this week",'<span style="color:'+fsNpsColor(tw)+'">'+(tw!=null?tw.toFixed(2)+"%":"\\u2014")+'</span>',delta!=null?((delta>=0?"+":"")+delta.toFixed(2)+"pp vs LW"):null)
      +kpi("NPS last week",sm.npsLw!=null?sm.npsLw.toFixed(2)+"%":"\\u2014",null)
      +kpi("8-week avg NPS",avg!=null?avg.toFixed(1)+"%":"\\u2014",(vs.length+" weeks"))
      +kpi("Responses",num(sm.totalResponses),(sm.scoredResponses!=null?sm.scoredResponses+" scored":null))
      +kpi("Promoters / Detractors",'<span style="color:#2E7D32">'+num(sm.promoters)+'</span> / <span style="color:#BE1D37">'+num(sm.detractors)+'</span>',(sm.passives!=null?sm.passives+" passive":null))
      +kpi("Customers WTD",wtdCust!=null?num(wtdCust):"\\u2014","week to date")
      +'</div>';
    h+='<div class="card" style="margin-top:12px"><h2>NPS trend \\u00b7 6 weeks to W/E '+esc(_fsWeek||"")+'</h2>'+fsTrendChart(hist,90)+'</div>';
    h+='<div class="card" style="margin-top:12px"><h2>Response breakdown \\u00b7 W/E '+esc(sm.weekEnding||"")+'</h2>'+fsBreakdown(sm)+'</div>';
    h+='<div class="card" style="margin-top:12px"><h2>Weekly history</h2><div class="tablewrap"><table><thead><tr><th>Week ending</th><th class="num">NPS</th><th class="num">vs LW</th><th class="num">Responses</th></tr></thead><tbody>'
      +(hist.length?hist.slice().reverse().map(function(w){var v=w.npsTw!=null?w.npsTw:w.npsComputed;var dl=(w.npsTw!=null&&w.npsLw!=null)?(w.npsTw-w.npsLw):null;
        return '<tr><td>'+esc(w.weekEnding)+'</td><td class="num" style="color:'+fsNpsColor(v)+';font-weight:700">'+(v!=null?v.toFixed(2)+"%":"\\u2014")+'</td><td class="num">'+(dl!=null?((dl>=0?"+":"")+dl.toFixed(2)+"pp"):"\\u2014")+'</td><td class="num">'+num(w.totalResponses)+'</td></tr>';
      }).join(""):'<tr><td colspan="4" class="muted" style="padding:12px;text-align:center">No history.</td></tr>')
      +'</tbody></table></div></div>';
    h+='<div class="card" style="margin-top:12px" id="fsRespCard"></div>';
    setHTML(h);
    var wsel=$("fsWeekTop");if(wsel)wsel.onchange=function(){fsLoad(this.value);};
    fsRenderResponses(resp);
  }).catch(errBox);
}

// Map a period name to a [from,to] ISO range.
function periodRange(p) {
  var today = new Date().toISOString().slice(0, 10);
  if (p === "all") return ["2000-01-01", "2099-12-31"];
  if (p === "today") return [today, today];
  if (p === "week") return weekBounds(today);
  if (p === "month") { var ym = today.slice(0, 7); return [ym + "-01", new Date(Date.UTC(+ym.slice(0,4), +ym.slice(5,7), 0)).toISOString().slice(0,10)]; }
  var d = new Date(today + "T00:00:00Z"); var y = d.getUTCFullYear(); var mo = d.getUTCMonth() + 1;
  var sy = mo >= 3 ? y : y - 1; return [sy + "-03-01", today];
}
// --- Shared period picker (one component, used across analysis screens) --------
// Presets Yesterday / This week / This month + Financial year / Fiscal period /
// Fiscal week option groups + Custom range. "Today" is never offered and every
// range is capped server-side at the latest data date (see /api/periods). Each
// option value encodes "from|to|label"; onChange(from,to,label) fires on select.
var _periodsData=null;
function loadPeriods(){return _periodsData?Promise.resolve(_periodsData):api("/api/periods").then(function(d){_periodsData=d;return d})}
function periodPickerHTML(id){
  return '<div class="toolbar"><label class="small muted">Period</label>'
    +'<select class="sel" id="'+id+'"><option>Loading\\u2026</option></select>'
    +'<span id="'+id+'_c" style="display:none"> <input type="date" class="inp" id="'+id+'_f"> <span class="muted">\\u2192</span> <input type="date" class="inp" id="'+id+'_t"> <button class="btn" id="'+id+'_b">Apply</button></span>'
    +'<span class="muted small" id="'+id+'_r" style="margin-left:8px"></span></div>';
}
function initPeriodPicker(id,onChange,def){
  loadPeriods().then(function(d){
    var sel=$(id);if(!sel)return;
    function opt(v,l){return '<option value="'+esc(v)+'">'+esc(l)+'</option>'}
    var h='';
    d.presets.forEach(function(p){h+=opt(p.from+'|'+p.to+'|'+p.label,p.label)});
    function grp(lab,arr){if(!arr||!arr.length)return'';var s='<optgroup label="'+lab+'">';arr.forEach(function(x){s+=opt(x.from+'|'+x.to+'|'+x.label,x.label)});return s+'</optgroup>'}
    h+=grp("Financial year",d.fys)+grp("Fiscal period",d.periods)+grp("Fiscal week",d.weeks);
    h+='<option value="custom">Custom range\\u2026</option>';
    sel.innerHTML=h;
    var fI=$(id+'_f'),tI=$(id+'_t');if(fI)fI.max=d.latest;if(tI)tI.max=d.latest;
    function fire(from,to,label){var r=$(id+'_r');if(r)r.innerHTML=esc(from)+' <span class="muted">\\u2192</span> '+esc(to);onChange(from,to,label||(from+' \\u2192 '+to))}
    sel.onchange=function(){
      if(this.value==='custom'){$(id+'_c').style.display='';return}
      $(id+'_c').style.display='none';
      var p=this.value.split('|');fire(p[0],p[1],p.slice(2).join('|'));
    };
    var btn=$(id+'_b');if(btn)btn.onclick=function(){var f=fI.value,t=tI.value;if(f&&t)fire(f,t)};
    // default selection: a preset key ('yesterday'|'week'|'month') or 'fy'
    var want=def||'month',dv=null;
    if(want==='fy'&&d.fys.length)dv=d.fys[0].from+'|'+d.fys[0].to+'|'+d.fys[0].label;
    else{var pp=d.presets.find(function(p){return p.key===want});if(pp)dv=pp.from+'|'+pp.to+'|'+pp.label;}
    if(dv)sel.value=dv;
    sel.onchange();
  });
}
// Row colour from margin variance (actual - guideline, + is good).
function marginRowColour(v) {
  if (v == null) return "";
  if (v >= -2) return "rowg"; if (v >= -5) return "rowa"; return "rowr";
}
var PROD_WARN = "Daily margin distorted by production timing. Weekly FIM is more accurate for this department.";
var FRESHB_WARN = "Fresh B department (weekly stocktake). Daily FIM margin is suppressed \\u2014 only weekly post-stocktake FIM is used for margin.";

PAGES.departments = function () {
  setHTML(periodPickerHTML("dperiod") + '<div id="dbody"><div class="loading">Loading\\u2026</div></div>');
  function load(from, to) {
    $("dbody").innerHTML = '<div class="loading">Loading\\u2026</div>';
    // BUG FIX: pass the period to the PO endpoint too (previously PO showed full history).
    Promise.all([api("/api/departments-po?from=" + from + "&to=" + to), api("/api/fim/period?from=" + from + "&to=" + to)]).then(function (res) {
      var po = res[0].departments || [], fim = res[1].departments || [];
      var fbDate = res[1].freshBMarginDate;
      var pmap = {}; po.forEach(function (x) { pmap[x.dept] = x; });
      var fmap = {}; fim.forEach(function (x) { fmap[x.deptCode] = x; });
      var codes = {}; po.forEach(function (x) { codes[x.dept] = 1; }); fim.forEach(function (x) { codes[x.deptCode] = 1; });
      var rows = Object.keys(codes).map(function (c) {
        var pp = pmap[c] || {}, ff = fmap[c] || {};
        return {
          dept: c, name: ff.deptName || pp.dept_name || "", group: ff.deptGroup || pp.dept_group || "",
          purchases: pp.purchases || 0, sales: ff.salesZar, margin: ff.marginPct,
          guide: ff.guidelineMarginPct != null ? ff.guidelineMarginPct : pp.guideline_margin_pct,
          variance: ff.variancePp, waste: ff.wasteZar, shrink: ff.shrinkZar, prod: ff.isProduction,
          suppressed: ff.marginSuppressed,
        };
      });
      var rank = { "Non-Fresh": 0, "Fresh-A": 1, "Fresh-B": 2 };
      rows.sort(function (a, b) { return (rank[a.group] == null ? 9 : rank[a.group]) - (rank[b.group] == null ? 9 : rank[b.group]) || a.dept.localeCompare(b.dept); });
      var body = rows.map(function (r) {
        var warn = r.prod ? ' <span class="warnico" title="' + PROD_WARN + '">\\u26A0</span>' : "";
        if (r.suppressed) warn += ' <span class="warnico" title="' + FRESHB_WARN + '">\\u2298</span>';
        var mtxt = r.suppressed ? '<span class="muted" title="' + FRESHB_WARN + '">\\u2298 stocktake</span>' : (r.margin != null ? r.margin.toFixed(1) + "%" : "\\u2014");
        var vtxt = r.variance == null ? "\\u2014" : '<span class="' + (r.variance < 0 ? "neg" : "pos") + '">' + (r.variance >= 0 ? "+" : "") + r.variance.toFixed(1) + "pp</span>";
        return '<tr class="' + marginRowColour(r.variance) + '" data-dept="' + esc(r.dept) + '">'
          + '<td><strong>' + esc(r.dept) + "</strong>" + warn + "</td><td>" + esc(r.name) + "</td><td class='dhide'>" + esc(r.group) + "</td>"
          + '<td class="num dhide">' + (r.purchases ? R(r.purchases) : "\\u2014") + "</td>"
          + '<td class="num">' + (r.sales != null ? Rr(r.sales) : "\\u2014") + "</td>"
          + '<td class="num">' + mtxt + "</td>"
          + '<td class="num muted">' + (r.guide != null ? r.guide.toFixed(2) + "%" : "\\u2014") + "</td>"
          + '<td class="num">' + vtxt + "</td>"
          + '<td class="num">' + (r.waste != null ? Rr(r.waste) : "\\u2014") + "</td>"
          + '<td class="num">' + (r.shrink != null ? Rr(r.shrink) : "\\u2014") + "</td></tr>";
      }).join("");
      $("dbody").innerHTML = '<div class="card"><h2>Department analysis \\u2014 PO purchases + FIM margins</h2>'
        + '<div class="tablewrap"><table><thead><tr><th>Dept</th><th>Name</th><th class="dhide">Group</th>'
        + '<th class="num dhide">Purchases (PO)</th><th class="num">Net Sales (FIM)</th><th class="num">Actual margin</th>'
        + '<th class="num">Guideline</th><th class="num">Variance</th><th class="num">Waste</th><th class="num">Shrink</th></tr></thead><tbody>'
        + (body || '<tr><td colspan="10" class="muted" style="padding:16px;text-align:center">No data for this period. Load FIM reports for margin columns.</td></tr>')
        + '</tbody></table></div>'
        + '<div class="legend"><span class="swatch sg"></span> within 2pp of guideline &nbsp; <span class="swatch sa"></span> 2\\u20135pp below &nbsp; <span class="swatch sr"></span> &gt;5pp below &nbsp; \\u00b7 \\u26A0 F06/F09 daily margin distorted by production timing'
        + (fbDate ? ' &nbsp; \\u00b7 \\u2298 Fresh B daily margin suppressed \\u2014 weekly post-stocktake FIM only (through ' + esc(fbDate) + ')' : '') + '.</div></div>';
    }).catch(function (e) { $("dbody").innerHTML = '<div class="err">' + esc(e.message) + "</div>"; });
  }
  initPeriodPicker("dperiod", load, "month");
};

// ---- Merchandise Hierarchy (Division → BU → CP drill-down) ----
PAGES.hierarchy=function(){loading();api("/api/hierarchy").then(function(d){
  var divs=d.divisions||[];window._hier=divs;
  var h='<div class="toolbar"><input class="search" id="hsearch" placeholder="Search CP / dept / business unit\\u2026"><span class="muted small">'+divs.length+' divisions</span></div><div id="hbody"></div>';
  setHTML(h);renderHier("");
  $("hsearch").oninput=function(){renderHier(this.value.toLowerCase())};
}).catch(errBox)};
function renderHier(q){
  var divs=window._hier||[];var out="";
  divs.forEach(function(dv){
    var bus=(dv.business_units||[]).map(function(bu){
      var cps=(bu.category_portfolios||[]).filter(function(cp){
        if(!q)return true;
        return (cp.no+" "+cp.name+" "+(cp.sap_depts||[]).join(" ")+" "+bu.name+" "+dv.name).toLowerCase().indexOf(q)>=0;
      });
      if(!cps.length)return "";
      return '<div style="margin:6px 0 6px 14px"><div class="small" style="font-weight:600">'+esc(bu.no)+' \\u00b7 '+esc(bu.name)+'</div>'
        +'<table class="mini" style="margin-top:3px"><thead><tr><th>CP</th><th>Name</th><th>SAP dept</th><th class="num">Guideline</th></tr></thead><tbody>'
        +cps.map(function(cp){return '<tr><td>'+esc(cp.no)+'</td><td>'+esc(cp.name)+'</td><td>'
          +(cp.sap_depts||[]).map(function(dc){return '<a class="link" onclick="openDeptHier(\\''+esc(dc)+'\\')">'+esc(dc)+'</a>'}).join(" ")
          +'</td><td class="num">'+(cp.guideline_margin_pct!=null?cp.guideline_margin_pct+"%":"\\u2014")+'</td></tr>'}).join("")
        +'</tbody></table></div>';
    }).filter(Boolean).join("");
    if(!bus)return;
    out+='<div class="card" style="margin-bottom:12px"><h2 style="text-transform:none;font-size:15px;color:var(--ink)">'+esc(dv.name)
      +(dv.guideline_group?' <span class="tag">'+esc(dv.guideline_group)+'</span>':'')+' <span class="muted small">division '+esc(dv.no)+'</span></h2>'+bus+'</div>';
  });
  $("hbody").innerHTML=out||'<div class="muted" style="padding:16px">No matches.</div>';
}
function openDeptHier(code){openModal("Department "+esc(code),'<div class="loading">Loading\\u2026</div>');
  api("/api/hierarchy/dept/"+encodeURIComponent(code)).then(function(d){
    var head='<div class="kv"><div>Guideline margin<b>'+(d.guideline_margin_pct!=null?d.guideline_margin_pct+"%":"\\u2014")+'</b></div><div>Group<b>'+esc(d.guideline_group||"\\u2014")+'</b></div><div>Category portfolios<b>'+(d.categoryPortfolios||[]).length+'</b></div></div>';
    openModal("Department "+esc(d.deptName||code)+' <span class="tag">'+esc(d.deptCode)+'</span>',head+makeTable([{key:"cp_no",label:"CP"},{key:"cp_name",label:"Name"},{key:"business_name",label:"Business Unit"},{key:"division",label:"Division"}],d.categoryPortfolios||[],{rowMenu:false}));
  }).catch(function(e){openModal("Department "+esc(code),'<div class="err">'+esc(e.message)+'</div>')});
}

// ---- FIM analysis screens (Period / Stock / Funding / Shortage) ----
function fimPeriodToolbar(id){return '<div class="toolbar"><label class="small muted">Period</label><select class="sel" id="'+id+'"><option value="all" selected>All data</option><option value="month">This month</option><option value="fy">Financial year</option></select><span class="muted small" id="'+id+'r"></span></div>';}

PAGES.period=function(){loading();api("/api/fim/by-period").then(function(d){
  var p=d.periods||[];
  if(!p.length){setHTML('<div class="card"><div class="muted">No FIM data yet. Load FIM reports to see fiscal-period analysis.</div></div>');return}
  // Chart: net sales per period, period code on the axis and the figure above each bar.
  var series=p.map(function(x){return {label:periodLabel(x),short:String(x.period).slice(-3),value:x.salesZar||0}});
  var h='<div class="card"><h2>Net sales by fiscal period (4-4-5)</h2>'+colChart(series,{valueLabels:true,valueFmt:Rr0})+'</div>';
  // %-of-sales appended inline (muted, no new column) next to Waste and Shrink.
  function pctOfSales(v,r){var s=r.salesZar||0;if(!s||v==null)return "";return ' <span class="muted small">('+(Math.round(v/s*1000)/10)+'%)</span>'}
  h+='<div class="card" style="margin-top:14px"><h2>Period detail</h2>'+makeTable([
    {key:"period",label:"Period",html:function(r){return '<div>'+esc(r.period)+'</div>'+(r.periodStart&&r.periodEnd?'<div class="muted small">'+dmy(r.periodStart)+'\\u2013'+dmy(r.periodEnd)+'</div>':'')}},
    {key:"quarter",label:"Quarter"},
    {key:"salesZar",label:"Net sales",num:true,fmt:Rr},{key:"marginPct",label:"Margin",num:true,fmt:function(v){return pct(v)}},
    {key:"wasteZar",label:"Waste",num:true,html:function(r){return Rr(r.wasteZar)+pctOfSales(r.wasteZar,r)}},
    {key:"shrinkZar",label:"Shrink",num:true,html:function(r){return Rr(r.shrinkZar)+pctOfSales(r.shrinkZar,r)}},
    {key:"purchasesZar",label:"Purchases",num:true,fmt:Rr},{key:"days",label:"Days",num:true}
  ],p,{search:false,rowMenu:false})+'</div>';
  setHTML(h);
}).catch(errBox)};
// "2026P01 · 01.03.2026–29.03.2026" for chart tooltips.
function periodLabel(x){var c=esc(x.period);return x.periodStart&&x.periodEnd?c+" \\u00b7 "+dmy(x.periodStart)+"\\u2013"+dmy(x.periodEnd):c}

function fimAnalysis(toolbarId,bodyId,render){
  setHTML(periodPickerHTML(toolbarId)+'<div id="'+bodyId+'"><div class="loading">Loading\\u2026</div></div>');
  function load(from,to){$(bodyId).innerHTML='<div class="loading">Loading\\u2026</div>';
    api("/api/fim/period?from="+from+"&to="+to).then(function(d){render($(bodyId),d.departments||[])}).catch(function(e){$(bodyId).innerHTML='<div class="err">'+esc(e.message)+'</div>'});}
  initPeriodPicker(toolbarId,load,"month");
}

PAGES.stock=function(){fimAnalysis("stperiod","stbody",function(el,deps){
  if(!deps.length){el.innerHTML='<div class="card"><div class="muted">No FIM data for this period.</div></div>';return}
  var to={open:0,close:0,purch:0,gr:0};deps.forEach(function(d){to.open+=d.openingSohZar||0;to.close+=d.closingSohZar||0;to.purch+=d.purchasesZar||0;to.gr+=d.netGrCostZar||0});
  var h='<div class="cards kpis">'+kpi("Opening SOH",Rr0(to.open),null)+kpi("Closing SOH",Rr0(to.close),null)+kpi("Stock movement",Rr0(to.close-to.open),null)+kpi("Purchases",Rr0(to.purch),null)+kpi("Net GR @ cost",Rr0(to.gr),null)+'</div>';
  h+='<div class="card"><h2>Stock on hand by department</h2>'+makeTable([
    {key:"deptCode",label:"Dept"},{key:"deptName",label:"Name"},
    {key:"openingSohZar",label:"Opening SOH",num:true,fmt:Rr},{key:"closingSohZar",label:"Closing SOH",num:true,fmt:Rr},
    {key:"_mov",label:"Movement",num:true,html:function(r){var m=(r.closingSohZar||0)-(r.openingSohZar||0);return '<span class="'+(m<0?"neg":"pos")+'">'+Rr(m)+'</span>'}},
    {key:"purchasesZar",label:"Purchases",num:true,fmt:Rr},{key:"netGrCostZar",label:"Net GR",num:true,fmt:Rr}
  ],deps,{rowMenu:false})+'</div>';
  el.innerHTML=h;
})};

PAGES.funding=function(){fimAnalysis("fnperiod","fnbody",function(el,deps){
  if(!deps.length){el.innerHTML='<div class="card"><div class="muted">No FIM data for this period.</div></div>';return}
  function tot(k){return deps.reduce(function(a,d){return a+(d[k]||0)},0)}
  var totalFund=tot("commercialDiscZar")+tot("lineDiscZar")+tot("basketDiscZar")+tot("tradeInvestZar")+tot("salliesTalliesZar")+tot("swellAllowanceZar");
  var h='<div class="cards kpis">'+kpi("Commercial disc",Rr0(tot("commercialDiscZar")),null)+kpi("Line disc",Rr0(tot("lineDiscZar")),null)+kpi("Basket disc",Rr0(tot("basketDiscZar")),null)+kpi("Trade invest",Rr0(tot("tradeInvestZar")),null)+kpi("Sallies & tallies",Rr0(tot("salliesTalliesZar")),null)+kpi("Total funding",Rr0(totalFund),null)+'</div>';
  h+='<div class="card"><h2>Funding &amp; rebates by department</h2>'+makeTable([
    {key:"deptCode",label:"Dept"},{key:"deptName",label:"Name"},
    {key:"commercialDiscZar",label:"Commercial",num:true,fmt:Rr},{key:"lineDiscZar",label:"Line disc",num:true,fmt:Rr},
    {key:"basketDiscZar",label:"Basket disc",num:true,fmt:Rr},{key:"tradeInvestZar",label:"Trade invest",num:true,fmt:Rr},
    {key:"salliesTalliesZar",label:"Sallies/Tallies",num:true,fmt:Rr},{key:"swellAllowanceZar",label:"Swell",num:true,fmt:Rr}
  ],deps,{rowMenu:false})+'</div>';
  el.innerHTML=h;
})};

PAGES.shortage=function(){fimAnalysis("shperiod","shbody",function(el,deps){
  if(!deps.length){el.innerHTML='<div class="card"><div class="muted">No FIM data for this period.</div></div>';return}
  function tot(k){return deps.reduce(function(a,d){return a+(d[k]||0)},0)}
  var sales=tot("salesZar");var shortPct=sales>0?Math.round(tot("totalShortagesZar")/sales*1000)/10:null;
  var h='<div class="cards kpis">'+kpi("Total shortages",Rr0(tot("totalShortagesZar")),shortPct!=null?shortPct+"% of sales":null)+kpi("Shrink",Rr0(tot("shrinkZar")),null)+kpi("Waste",Rr0(tot("wasteZar")),null)+kpi("Net shrinkage",Rr0(tot("netShrinkageZar")),null)+kpi("RTC",Rr0(tot("rtcZar")),null)+'</div>';
  var maxSh=Math.max.apply(null,deps.map(function(d){return Math.abs(d.totalShortagesZar||0)}))||1;
  h+='<div class="card"><h2>Shortages by department</h2><div class="tablewrap"><table><thead><tr><th>Dept</th><th>Name</th><th class="num">Total shortages</th><th class="num">% sales</th><th class="num">Shrink</th><th class="num">Waste</th><th class="num">RTC</th><th>vs peak</th></tr></thead><tbody>'
    +deps.map(function(d){var sp=(d.salesZar||0)>0?Math.round((d.totalShortagesZar||0)/d.salesZar*1000)/10:null;var w=Math.round(Math.abs(d.totalShortagesZar||0)/maxSh*100);var col=sp==null?"var(--muted)":sp>5?"var(--red)":sp>3?"var(--amber)":"var(--green)";
      return '<tr><td>'+esc(d.deptCode)+'</td><td>'+esc(d.deptName||"")+'</td><td class="num">'+Rr(d.totalShortagesZar)+'</td><td class="num" style="color:'+col+'">'+(sp==null?"\\u2014":sp+"%")+'</td><td class="num">'+Rr(d.shrinkZar)+'</td><td class="num">'+Rr(d.wasteZar)+'</td><td class="num">'+Rr(d.rtcZar)+'</td><td style="width:140px"><div class="bar"><i style="width:'+w+'%;background:'+col+'"></i></div></td></tr>';
    }).join("")+'</tbody></table></div></div>';
  el.innerHTML=h;
})};

PAGES.open=function(){
  setHTML('<div class="toolbar"><label class="small muted">Filter</label><select class="sel" id="ofilter"><option value="both">Open to deliver or invoice</option><option value="deliver">Open to deliver</option><option value="invoice">Open to invoice</option></select></div><div id="obody"><div class="loading">Loading\\u2026</div></div>');
  function load(f){api("/api/open-orders?filter="+f+"&limit=3000").then(function(d){
    var ag=d.aging||{count:{},value:{}};var c=ag.count||{},v=ag.value||{};
    function tile(lab,key,danger){return kpi(lab,danger&&c[key]?'<span class="neg">'+num(c[key])+'</span>':num(c[key]),Rr0(v[key]||0))}
    var h='<div class="cards kpis">'
      +tile("New order (0-7d)","new_order",false)
      +tile("Awaiting (8-21d)","awaiting",false)
      +tile("Overdue (22-34d)","overdue",true)
      +tile("Stale (35-60d)","stale",true)
      +kpi("Historical (>60d)",'<span class="muted">'+num(c.historical||0)+'</span>',Rr0(v.historical||0))
      +tile("Partial","partial",false)
      +tile("Stale partial","stale_partial",true)+'</div>';
    h+='<div class="card"><h2>Open order lines ('+(d.rows||[]).length+')</h2>'+makeTable([
      {key:"po_number",label:"PO",html:function(r){return poLink(r.po_number)}},
      {key:"article_code",label:"Article",html:function(r){return artLink(r.article_code)}},
      {key:"vendor",label:"Vendor",html:function(r){return venLink(r.vendor_code,r.vendor)}},
      {key:"order_date",label:"Order date"},
      {key:"order_qty",label:"Ordered",num:true},{key:"received_qty",label:"Received",num:true},
      {key:"outstanding_qty",label:"Outstanding",num:true},
      {key:"order_value",label:"Ordered value",num:true,fmt:Rr},
      {key:"received_value",label:"Received value",num:true,fmt:Rr},
      {key:"outstanding_value",label:"Outstanding value",num:true,fmt:Rr},
      {key:"last_gr_date",label:"Last GR",html:function(r){return esc(r.last_gr_date||"\\u2014")}},
      {key:"days_outstanding",label:"Days",num:true,html:function(r){var dn=r.days_outstanding;var cls=dn==null?"":(dn>60?"muted":(dn>=35?"neg":""));return '<span class="'+cls+'">'+(dn==null?"\\u2014":dn)+'</span>'}},
      {key:"status",label:"Status"},{key:"bucket",label:"Bucket"}
    ],d.rows||[],{rowMenu:true,cards:true})+'</div>';
    $("obody").innerHTML=h;
  }).catch(function(e){$("obody").innerHTML='<div class="err">'+esc(e.message)+'</div>'})}
  $("ofilter").onchange=function(){load(this.value)};load("both");
};

PAGES.returns=function(){
  setHTML('<div class="toolbar"><label class="small muted">Group by</label><select class="sel" id="rgrp"><option value="all">All Lines</option><option value="vendor">By Vendor</option><option value="article">By Article</option><option value="category">By Category</option></select></div><div id="rbody"><div class="loading">Loading\\u2026</div></div>');
  function load(g){api("/api/returns?groupBy="+g).then(function(d){
    var t=d.totals||{};
    var h='<div class="cards kpis">'+kpi("Total returns value",R(t.value),null)+kpi("Return lines",num(t.lines),null)+kpi("POs",num(t.pos),null)+'</div>';
    var cols;
    if(g==="all")cols=[{key:"po_number",label:"PO"},{key:"order_date",label:"Date"},{key:"vendor",label:"Vendor"},{key:"article_code",label:"Article"},{key:"description",label:"Description"},{key:"order_qty",label:"Qty",num:true},{key:"value",label:"Value",num:true,fmt:R}];
    else cols=[{key:"code",label:g==="category"?"Category":g.charAt(0).toUpperCase()+g.slice(1)},{key:"label",label:"Name"},{key:"value",label:"Return value",num:true,fmt:R},{key:"lines",label:"Lines",num:true}];
    h+='<div class="card"><h2>Returns to vendor (SLoc S002)</h2>'+makeTable(cols,d.rows||[],{onRow:function(r){if(g==="vendor")openVendor(r.code);else if(g==="article")openArticle(r.code);else if(r.po_number)openPO(r.po_number)}})+'</div>';
    $("rbody").innerHTML=h;
  }).catch(function(e){$("rbody").innerHTML='<div class="err">'+esc(e.message)+'</div>'})}
  $("rgrp").onchange=function(){load(this.value)};load("all");
};

PAGES.anomalies=function(){
  setHTML('<div class="toolbar"><select class="sel" id="asev"><option value="">All severities</option><option>CRITICAL</option><option>WARN</option><option>INFO</option></select><label class="small"><input type="checkbox" id="aack"> show acknowledged</label></div><div id="abody"><div class="loading">Loading\\u2026</div></div>');
  function load(){var sev=$("asev").value;var showAck=$("aack").checked;
    api("/api/anomalies?limit=1000"+(sev?"&severity="+sev:"")+(showAck?"":"&resolved=false")).then(function(d){
      var rows=(d.anomalies||[]).map(function(a){var det={};try{if(a.detail_json)det=JSON.parse(a.detail_json)}catch(e){det={}}return {id:a.id,severity:a.severity,type:a.type,article:det.articleDesc||det.article||"",po_number:det.poNumber||"",dept:det.deptCode||"",value:det.actualMargin!=null?det.actualMargin+"%":(det.lineValueCents!=null?R(det.lineValueCents):""),message:a.message,resolved:a.resolved,detected_at:a.detected_at}});
      var h=makeTable([
        {key:"severity",label:"Sev",html:function(r){return '<span class="sev-'+r.severity+'">'+r.severity+'</span>'}},
        {key:"type",label:"Type"},{key:"dept",label:"Dept"},{key:"article",label:"Article"},{key:"po_number",label:"PO"},
        {key:"message",label:"Detail / suggested action"},{key:"detected_at",label:"Date"},
        {key:"resolved",label:"",html:function(r){return r.resolved?'<span class="muted small">ack\\u2713</span>':'<button class="btn alt" onclick="ackAnom(event,'+r.id+')">Acknowledge</button>'}}
      ],rows,{rowMenu:true,onRow:function(){}});
      $("abody").innerHTML='<div class="card"><h2>Risk & anomalies ('+rows.length+')</h2>'+h+'</div>';
    }).catch(function(e){$("abody").innerHTML='<div class="err">'+esc(e.message)+'</div>'})}
  $("asev").onchange=load;$("aack").onchange=load;load();window._reloadAnom=load;
};
function ackAnom(e,id){e.stopPropagation();fetch("/api/anomalies/"+id+"/ack",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({resolved:true})}).then(function(){if(window._reloadAnom)window._reloadAnom()})}

var _grFT={from:"",to:""},_grTab="gr";
PAGES.gr=function(){
  setHTML(periodPickerHTML("grPer")+'<div class="tabs" id="grtabs"><button class="active" onclick="grTab(\\'gr\\')">Goods Receipts</button><button onclick="grTab(\\'recon\\')">PO Reconciliation</button></div><div id="grtabc"><div class="loading">Loading\\u2026</div></div>');
  initPeriodPicker("grPer",function(from,to){_grFT={from:from,to:to};grTab(_grTab)},"month");
};
function grTab(t){
  _grTab=t;
  document.querySelectorAll("#grtabs button").forEach(function(b){b.classList.toggle("active",(t==="gr"&&b.textContent.indexOf("Goods")>=0)||(t==="recon"&&b.textContent.indexOf("Reconciliation")>=0))});
  var c=$("grtabc");c.innerHTML='<div class="loading">Loading\\u2026</div>';
  if(t==="recon")reconLoad(c);else grLoad(c);
}
function grLoad(c){
  if(!_grFT.from||!_grFT.to){c.innerHTML='<div class="loading">Loading\\u2026</div>';return}
  // GR cost/sell/margin + by-department now scope to the selected period (were the
  // latest upload only). Reconciliation-vs-PO stays latest-upload; outstanding
  // items are not period-bound.
  Promise.all([api("/api/gr/period?from="+_grFT.from+"&to="+_grFT.to),api("/api/gr/reconciliation"),api("/api/settings")]).then(function(res){
  var gp=res[0],rec=res[1],sett=res[2].settings||{};var t=gp.totals||{};
  var h='<div class="cards kpis">'+kpi("GR cost",Rr0(t.costZar||0),null)+kpi("GR sell",Rr0(t.sellZar||0),null)+kpi("Blended margin",(t.blendedMarginPct!=null?t.blendedMarginPct+"%":"\\u2014"),null)+kpi("Lines",num(t.lines||0),null)+'</div>';
  var sm=rec.summary||{};
  h+='<div class="cards g2"><div class="card"><h2>Reconciliation vs PO export <span class="muted small">(latest upload)</span></h2><div class="cards kpis">'+kpi("GR lines",num(sm.gr_lines),null)+kpi("Matched to PO",'<span class="pos">'+num(sm.matched)+'</span>',null)+kpi("Unmatched",'<span class="neg">'+num(sm.unmatched)+'</span>',null)+'</div></div>';
  var pnp=Number(sett.pnp_terms_days||28),ven=Number(sett.vencor_terms_days||14);
  h+='<div class="card"><h2>Cash outflow projection</h2><table><tbody><tr><td>PnP Corporate</td><td class="num">'+pnp+' days after week-end</td></tr><tr><td>Vencor</td><td class="num">'+ven+' days</td></tr></tbody></table><div class="legend">Goods received this week become payable per the supplier terms above.</div></div></div>';
  var deps=gp.departments||[];
  if(deps.length)h+='<div class="card" style="margin-top:14px"><h2>By department: received cost <span class="muted small">(selected period)</span></h2>'+makeTable([{key:"deptCode",label:"Dept"},{key:"deptName",label:"Name"},{key:"lines",label:"GR lines",num:true},{key:"costZar",label:"Cost",num:true,fmt:function(v){return Rr(v)}},{key:"sellZar",label:"Sell",num:true,fmt:function(v){return Rr(v)}},{key:"marginPct",label:"Margin",num:true,html:function(r){return r.marginPct!=null?r.marginPct.toFixed(1)+"%":"\\u2014"}}],deps,{rowMenu:false})+'</div>';
  else h+='<div class="card" style="margin-top:14px"><div class="muted">No goods receipts in this period.</div></div>';
  c.innerHTML=h;
}).catch(function(e){c.innerHTML='<div class="err">'+esc(e.message)+'</div>'})}
function reconLoad(c){api("/api/reconciliation?status=unmatched-po&limit=2000").then(function(d){
  var s=d.summary||{};
  var head='<div class="cards kpis">'
    +kpi("Total PO lines",num(s.total_po_lines),null)
    +kpi("Matched",'<span class="pos">'+num(s.matched_lines)+'</span>',null)
    +kpi("Unmatched PO",'<span class="'+(s.unmatched_po_lines?"neg":"")+'">'+num(s.unmatched_po_lines)+'</span>',null)
    +kpi("Unmatched GR",'<span class="'+(s.unmatched_gr_lines?"neg":"")+'">'+num(s.unmatched_gr_lines)+'</span>',null)
    +kpi("Receipt rate",(s.receipt_rate_pct==null?"\\u2014":s.receipt_rate_pct+"%"),Rr0(s.total_received_value||0)+" of "+Rr0(s.total_ordered_value||0))
    +'</div>';
  var t1=makeTable([
    {key:"po_number",label:"PO",html:function(r){return poLink(r.po_number)}},
    {key:"vendor_name",label:"Vendor",html:function(r){return venLink(r.vendor_code,r.vendor_name)}},
    {key:"article_code",label:"Article",html:function(r){return artLink(r.article_code)}},
    {key:"order_date",label:"Order date"},
    {key:"order_value",label:"Ordered value",num:true,fmt:Rr},
    {key:"days_outstanding",label:"Days waiting",num:true,html:function(r){var dn=r.days_outstanding;return '<span class="'+(dn!=null&&dn>=35?"neg":"")+'">'+(dn==null?"\\u2014":dn)+'</span>'}},
    {key:"aging_bucket",label:"Bucket"}
  ],d.lines||[],{rowMenu:true});
  var t2=makeTable([
    {key:"last_gr_date",label:"GR date"},
    {key:"article_code",label:"Article",html:function(r){return artLink(r.article_code)}},
    {key:"article_desc",label:"Description"},
    {key:"po_number",label:"PO ref"},
    {key:"received_qty",label:"Received qty",num:true},
    {key:"received_value",label:"Cost value",num:true,fmt:Rr},
    {key:"_notes",label:"Notes",html:function(){return '<span class="muted small">Emergency order, credit note, or PO not yet uploaded \\u2014 review</span>'}}
  ],d.unmatchedGr||[],{rowMenu:false});
  c.innerHTML=head
    +'<div class="card" style="margin-top:14px"><h2>Unmatched PO Lines \\u2014 ordered, no GR received ('+(d.lines||[]).length+')</h2><div class="legend" style="margin-bottom:8px">Oldest first \\u00b7 35+ days flagged red.</div>'+t1+'</div>'
    +'<div class="card" style="margin-top:14px"><h2>Unmatched GR Lines \\u2014 received, no matching PO ('+(d.unmatchedGr||[]).length+')</h2><div class="legend" style="margin-bottom:8px">GR export carries no vendor; match is by PO number + article.</div>'+t2+'</div>';
}).catch(function(e){c.innerHTML='<div class="err">'+esc(e.message)+'</div>'})}

PAGES.cash=function(){loading();api("/api/creditors").then(function(d){
  var st=d.statements||[];
  var trend=st.slice().reverse().map(function(s){return {label:s.week_start,value:(s.closing_cents||0)/100}});
  var today=new Date().toISOString().slice(0,10);var wb=weekBounds(today);
  var form='<div class="card"><h2>Weekly statement entry</h2><div class="cards g3">'
    +'<div><label class="small muted">Week start (Mon)</label><input class="inp" id="cs_ws" type="date" value="'+wb[0]+'" style="width:100%"></div>'
    +'<div><label class="small muted">Week end (Sun)</label><input class="inp" id="cs_we" type="date" value="'+wb[1]+'" style="width:100%"></div>'
    +'<div><label class="small muted">Due date (auto: Sun + PnP terms)</label><input class="inp" id="cs_due" type="date" style="width:100%"></div>'
    +'<div><label class="small muted">Opening balance (R)</label><input class="inp" id="cs_open" type="number" step="0.01" style="width:100%"></div>'
    +'<div><label class="small muted">Purchases (R)</label><input class="inp" id="cs_pur" type="number" step="0.01" style="width:100%"></div>'
    +'<div><label class="small muted">Credits (R)</label><input class="inp" id="cs_cr" type="number" step="0.01" style="width:100%"></div>'
    +'<div><label class="small muted">Closing balance (R)</label><input class="inp" id="cs_close" type="number" step="0.01" style="width:100%"></div>'
    +'</div><div style="margin-top:10px"><button class="btn" onclick="saveCreditor()">Save statement</button> <span id="cs_msg" class="small muted"></span></div></div>';
  var uploadCard='<div class="card" style="margin-top:14px"><h2>Account statement upload</h2>'
    +'<div class="small muted" style="margin-bottom:8px">Upload the native pipe-delimited statement CSV, or the printed account-statement PDF. PDFs are parsed and validated in your browser, then posted as data \\u2014 the server never parses PDFs. Re-uploading the native CSV replaces a PDF load; a PDF will not overwrite a native load.</div>'
    +'<input type="file" id="stmt-file" accept=".csv,.pdf" class="inp"> <span id="stmt_msg" class="small muted"></span></div>';
  var chart='<div class="card" style="margin-top:14px"><h2>Closing balance trend</h2>'+lineChart(trend)+'</div>';
  var riskCard='<div class="card" style="margin-top:14px"><h2>Upcoming payment risk \\u2014 next 8 weeks</h2><div id="cashRisk"><div class="muted small">Loading\\u2026</div></div></div>';
  var tbl='<div class="card" style="margin-top:14px"><h2>Statements</h2>'+makeTable([{key:"week_start",label:"Week start"},{key:"week_end",label:"Week end"},{key:"opening_cents",label:"Opening",num:true,fmt:R},{key:"purchases_cents",label:"Purchases",num:true,fmt:R},{key:"credits_cents",label:"Credits",num:true,fmt:R},{key:"closing_cents",label:"Closing",num:true,fmt:R},{key:"due_date",label:"Due"}],st,{rowMenu:false,search:false})+'</div>';
  var detailCard='<div class="card" style="margin-top:14px"><h2>Statements \\u2014 weekly balance chain</h2><div id="stmtDetail"><div class="muted small">Loading\\u2026</div></div></div>';
  setHTML(form+uploadCard+riskCard+chart+tbl+detailCard);
  var fi=$("stmt-file");if(fi)fi.addEventListener("change",onStmtFile);
  loadStatementDetail();
  // auto due date from settings
  api("/api/settings").then(function(s){var pnp=Number((s.settings||{}).pnp_terms_days||28);var due=new Date(wb[1]+"T00:00:00Z");due.setUTCDate(due.getUTCDate()+pnp);$("cs_due").value=due.toISOString().slice(0,10)});
  // upcoming payment risk
  api("/api/creditor-payments?weeks=8").then(function(cp){var el=$("cashRisk");if(!el)return;
    el.innerHTML=makeTable([
      {key:"weekEnding",label:"Week ending"},
      {key:"flags",label:"Risk flags",html:function(r){return (r.flags&&r.flags.length)?r.flags.map(function(f){return '<span class="pill '+(r.severity==="CRITICAL"?"OVER":"TIGHT")+'">'+esc(f)+'</span>'}).join(" "):'<span class="muted">\\u2014</span>'}},
      {key:"estCreditorPmtZar",label:"Est. creditor pmt",num:true,fmt:function(v){return v?Rr0(v):"\\u2014"}},
      {key:"salaryOutZar",label:"Salary out",num:true,html:function(r){return r.salaryOutZar!=null?Rr0(r.salaryOutZar):'<span class="muted">\\u2014</span>'}},
      {key:"netCashRisk",label:"Net cash risk",html:function(r){var s=r.netCashRisk;return s==="CRITICAL"?'<span class="neg">CRITICAL</span>':s==="HIGH"?'<span style="color:var(--orange);font-weight:600">HIGH</span>':'<span class="muted">\\u2014</span>'}}
    ],cp.weeks||[],{search:false,rowMenu:false})
    +(cp.monthlySalaryZar==null?'<div class="small muted" style="margin-top:6px">Set "Monthly salary cost" in Settings to populate the Salary out column.</div>':"");
  }).catch(function(){var el=$("cashRisk");if(el)el.innerHTML='<div class="muted small">Risk data unavailable.</div>'});
}).catch(errBox)};
function saveCreditor(){
  function c(id){return Math.round((Number($(id).value)||0)*100)}
  var body={week_start:$("cs_ws").value,week_end:$("cs_we").value,due_date:$("cs_due").value,opening_cents:c("cs_open"),purchases_cents:c("cs_pur"),credits_cents:c("cs_cr"),closing_cents:c("cs_close")};
  adminSend("/api/creditors","POST",body).then(function(){$("cs_msg").textContent="Saved.";PAGES.cash()}).catch(function(e){$("cs_msg").textContent="Error: "+(e&&e.message||e)});
}
// pdf.js loads lazily from cdnjs only when a PDF is actually chosen, so the CSV
// path costs nothing. Both formats converge on POST /api/statement-uploads.
var STMT_PDFJS="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
var STMT_PDFJS_WORKER="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
function onStmtFile(e){
  var file=e.target.files[0];if(!file)return;
  var msg=$("stmt_msg");if(msg){msg.className="small muted";msg.textContent="Processing "+file.name+"\\u2026";}
  var reset=function(){e.target.value=""};
  var build;
  if(/\\.pdf$/i.test(file.name)){
    build=import(STMT_PDFJS).then(function(pdfjsLib){
      pdfjsLib.GlobalWorkerOptions.workerSrc=STMT_PDFJS_WORKER;
      return Promise.all([import("/js/statement-pdf.js"),file.arrayBuffer()]).then(function(r){
        var mod=r[0];var buf=r[1];
        return pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise.then(function(pdf){
          return mod.extractPageLines(pdf).then(function(pl){return mod.parseStatementPdf(pl)});
        });
      });
    });
  }else{
    // CSV: decode latin1 (0xA0 padding bytes break utf-8), server parses.
    build=file.arrayBuffer().then(function(buf){return {csv:new TextDecoder("latin1").decode(buf)}});
  }
  build.then(function(payload){
    return fetch("/api/statement-uploads",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)})
      .then(function(res){return res.json().then(function(out){if(!res.ok)throw new Error(out.error||res.statusText);return out})});
  }).then(function(out){
    if(msg){
      var t="Statement "+out.statement_no+" loaded ("+out.rowCount+" lines, "+out.source+")";
      if(out.replaced)t+=" \\u2014 replaced previous "+out.previousSource+" load";
      if(out.chain==="BREAK"){msg.className="small neg";msg.textContent=t+" \\u2014 WARNING: opening balance does not tie to prior week (gap "+out.chain_gap+")"}
      else{msg.className="small pos";msg.textContent=t}
    }
    loadStatementDetail();
  }).catch(function(err){
    if(msg){msg.className="small neg";msg.textContent="Statement load failed: "+(err&&err.message||err)}
  }).then(reset,reset);
}
function loadStatementDetail(){
  var el=$("stmtDetail");if(!el)return;
  // Balance cell: printed anchor bold, chain-derived grey, unreachable em-dash.
  function bcell(v,src){if(v==null)return '<span class="muted">\\u2014</span>';var s=Rr(v);return src==="PRINTED"?'<b title="printed on statement">'+s+'</b>':'<span class="muted" title="derived from balance chain">'+s+'</span>'}
  api("/api/statements").then(function(d){
    var rows=d.statements||[];
    if(!rows.length){el.innerHTML='<div class="muted small">No statements uploaded yet. Use the upload control above.</div>';return}
    el.innerHTML=makeTable([
      {key:"statement_no",label:"Statement"},
      {key:"source",label:"Source",html:function(r){return '<span class="badge '+(r.source==="PDF"?"badge-pdf":"badge-native")+'">'+esc(r.source)+'</span>'}},
      {key:"cut_off",label:"Cut-off"},
      {key:"due_date",label:"Due"},
      {key:"opening_balance",label:"Opening",num:true,html:function(r){return bcell(r.opening_balance,r.balance_source)}},
      {key:"debits",label:"Debits",num:true,fmt:function(v){return Rr(v)}},
      {key:"credits",label:"Credits",num:true,fmt:function(v){return Rr(v)}},
      {key:"payment",label:"Payments",num:true,fmt:function(v){return Rr(v)}},
      {key:"closing_balance",label:"Closing",num:true,html:function(r){return bcell(r.closing_balance,r.balance_source)}}
    ],rows,{rowMenu:false,search:false})
      +'<div class="small muted" style="margin-top:6px">Opening/Closing in <b>bold</b> are printed on the statement; grey values are <b>derived</b> from the weekly balance chain (closing of one week = opening of the next). A missing week breaks the chain, so earlier weeks show \\u2014. Debits = invoices/purchases, Credits = credit notes (payments shown separately); Debits + Credits = total due.</div>';
  }).catch(function(){el.innerHTML='<div class="muted small">Could not load statements.</div>'});
}

PAGES.settings=function(){loading();Promise.all([api("/api/settings"),api("/api/guidelines"),api("/api/weekly-budgets")]).then(function(res){
  var s=res[0].settings||{};var g=res[1].guidelines||[];var wb=res[2]||{};
  function f(key,label,suffix){return '<div class="hbar" style="grid-template-columns:240px 160px 1fr"><span class="lab">'+label+'</span><input class="inp" id="set_'+key+'" value="'+esc(s[key]||"")+'"><span class="muted small">'+(suffix||"")+'</span></div>'}
  var form='<div class="card"><h2>Budget & assumptions</h2>'
    +f("monthly_turnover_target","Monthly turnover target","Rand")
    +f("target_gp_pct","Target GP %","percent")
    +f("weekly_cap","Weekly purchase cap","Rand (e.g. 2000000)")
    +f("monthly_salary_zar","Monthly salary cost","Rand (for cash-flow risk)")
    +f("price_alert_threshold_pct","Price change alert threshold","percent (default 5)")
    +f("fy_start_month","FY start month","3 = March")
    +f("vencor_terms_days","Vencor payment terms","days (14)")
    +f("pnp_terms_days","PnP Corporate payment terms","days after week-end (28)")
    +f("open_po_max_age_days","Auto-close open POs after","days (default 90 \\u2014 older open lines drop off Open/Committed)")
    +'<div style="margin-top:10px"><button class="btn" onclick="saveSettings()">Save settings</button> <span id="set_msg" class="small muted"></span></div></div>';
  window._setKeys=["monthly_turnover_target","target_gp_pct","weekly_cap","monthly_salary_zar","price_alert_threshold_pct","fy_start_month","vencor_terms_days","pnp_terms_days","open_po_max_age_days"];
  var gl='<div class="card" style="margin-top:14px"><h2>Department guideline margins</h2>'+makeTable([
    {key:"dept_code",label:"Dept"},{key:"dept_name",label:"Name"},{key:"dept_group",label:"Group"},
    {key:"guideline_margin_pct",label:"Guideline %",num:true,html:function(r){return '<input class="inp" style="width:80px;text-align:right" value="'+r.guideline_margin_pct+'" onchange="saveGuideline(\\''+r.dept_code+'\\',this.value)">'}},
    {key:"participation_guideline_pct",label:"Participation %",num:true}
  ],g,{rowMenu:false,search:false})+'</div>';
  // Structured weekly budget editor: store + Bakery/Butchery/Deli (+packaging), each
  // with Sales/PO/GR inputs. One collapsible card per fiscal week; Save posts the whole week.
  var depts=wb.depts||[];var cap=wb.defaultCapZar||0;
  function bi(wc,ty,dp,fld,val,ph){
    return '<input class="inp wbf" data-wc="'+esc(wc)+'" data-type="'+ty+'" data-dept="'+dp+'" data-fld="'+fld+'" style="width:110px;text-align:right" value="'+(val!=null?val:"")+'"'+(ph!=null?' placeholder="'+esc(ph)+'"':"")+'>';
  }
  function blank(){return '<span class="muted">\\u2014</span>'}
  var wkCards=(wb.weeks||[]).map(function(w){
    var rows='<tr><td><b>TOTAL STORE</b></td><td class="num">'+bi(w.weekCode,"store","TOTAL","sales",w.store.sales,null)+'</td>'
      +'<td class="num">'+bi(w.weekCode,"store","TOTAL","po",w.store.po,cap)+'</td>'
      +'<td class="num">'+bi(w.weekCode,"store","TOTAL","gr",w.store.gr,cap)+'</td></tr>';
    depts.forEach(function(d){
      var dd=(w.depts||{})[d.code]||{};
      rows+='<tr><td>'+esc(d.name)+' ('+esc(d.code)+')</td>'
        +'<td class="num">'+bi(w.weekCode,"department",d.code,"sales",dd.sales,null)+'</td>'
        +'<td class="num">'+bi(w.weekCode,"department",d.code,"po",dd.po,null)+'</td>'
        +'<td class="num">'+bi(w.weekCode,"department",d.code,"gr",dd.gr,null)+'</td></tr>';
      rows+='<tr><td class="muted small" style="padding-left:18px">\\u2514 Packaging PO</td><td class="num">'+blank()+'</td>'
        +'<td class="num">'+bi(w.weekCode,"packaging",d.code,"po",dd.pkgPo,null)+'</td><td class="num">'+blank()+'</td></tr>';
    });
    return '<details class="card" style="margin-top:10px"><summary style="cursor:pointer;font-weight:600">W/E '+esc(w.weekEnding)+' \\u00b7 Week '+esc(w.weekNo)+' <span class="muted small">('+esc(w.weekCode)+')</span></summary>'
      +'<div class="tablewrap" style="margin-top:8px"><table><thead><tr><th></th><th class="num">Sales budget (R)</th><th class="num">PO budget (R)</th><th class="num">GR budget (R)</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
      +'<div style="margin-top:8px"><button class="btn" onclick="saveWeekBudgets(\\''+esc(w.weekCode)+'\\',\\''+esc(w.weekEnding)+'\\')">\\uD83D\\uDCBE Save week</button> '
      +'<button class="btn alt" onclick="deleteWeekBudgets(\\''+esc(w.weekCode)+'\\')">\\u2212 Remove week</button> <span class="small muted" id="wbmsg_'+esc(w.weekCode)+'"></span></div></details>';
  }).join("");
  var wbCard='<div class="card" style="margin-top:14px"><h2>Weekly budgets</h2>'
    +'<div class="muted small">Sales, PO and GR budgets per fiscal week (Rand) for the whole store and each production department, plus packaging PO. Blank PO/GR at store level falls back to the default weekly cap ('+Rr0(cap)+', set above as "Weekly purchase cap").</div></div>'
    +(wkCards||'<div class="card" style="margin-top:10px"><div class="muted small">No fiscal weeks in range.</div></div>');
  // Fresh B departments (stocktake weekly). Codes are stored as a CSV in
  // app_settings.fresh_b_depts; the two day fields drive when daily FIM margin
  // is suppressed in favour of post-stocktake weekly FIM.
  var FRESHB=[["F04","Deli"],["F06","Instore Bakery"],["F07","Fish Shop"],["F09","Butchery"],["F10","Restaurants"],["F64","Kitchen Cafe Express"],["F68","Sushi"],["F77","Cold Deli"]];
  var fbDefault=FRESHB.map(function(d){return d[0]}).join(",");
  var fbSel=(s.fresh_b_depts!=null&&s.fresh_b_depts!=="")?String(s.fresh_b_depts).split(","):fbDefault.split(",");
  var days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  function daySel(id,cur){return '<select class="inp" id="'+id+'">'+days.map(function(d){return '<option'+(d===cur?' selected':'')+'>'+d+'</option>'}).join("")+'</select>'}
  var fbBoxes=FRESHB.map(function(d){var on=fbSel.indexOf(d[0])>=0;return '<label style="display:inline-block;margin:4px 14px 4px 0;white-space:nowrap"><input type="checkbox" class="fbdept" value="'+d[0]+'"'+(on?' checked':'')+'> '+d[0]+' '+esc(d[1])+'</label>'}).join("");
  var freshCard='<div class="card" style="margin-top:14px"><h2>Fresh Departments</h2>'
    +'<div class="muted small" style="margin-bottom:10px">Fresh B departments (stocktake weekly). Daily FIM margin for these departments is suppressed \\u2014 only weekly (post-stocktake) FIM is used for margin reporting.</div>'
    +'<div style="margin-bottom:12px">'+fbBoxes+'</div>'
    +'<div class="hbar" style="grid-template-columns:240px 200px 1fr"><span class="lab">Stocktake day</span>'+daySel("set_fresh_b_stocktake_day",s.fresh_b_stocktake_day||"Sunday")+'<span></span></div>'
    +'<div class="hbar" style="grid-template-columns:240px 200px 1fr"><span class="lab">FIM upload day</span>'+daySel("set_fresh_b_fim_upload_day",s.fresh_b_fim_upload_day||"Tuesday")+'<span></span></div>'
    +'<div style="margin-top:10px"><button class="btn" onclick="saveFreshDepts()">Save fresh departments</button> <span id="fresh_msg" class="small muted"></span></div></div>';
  setHTML(form+gl+freshCard+wbCard);
}).catch(errBox)};
function saveFreshDepts(){
  var depts=[];document.querySelectorAll(".fbdept").forEach(function(c){if(c.checked)depts.push(c.value)});
  var body={fresh_b_depts:depts.join(","),fresh_b_stocktake_day:$("set_fresh_b_stocktake_day").value,fresh_b_fim_upload_day:$("set_fresh_b_fim_upload_day").value};
  var msg=$("fresh_msg");if(msg)msg.textContent="Saving\\u2026";
  adminSend("/api/settings","PUT",body).then(function(){if(msg)msg.textContent="Saved."}).catch(function(e){if(msg)msg.textContent="Error: "+(e&&e.message||e)});
}
function saveWeekBudgets(wc,end){
  var inputs=document.querySelectorAll('.wbf[data-wc="'+wc+'"]');var map={};
  inputs.forEach(function(i){
    var ty=i.getAttribute("data-type"),dp=i.getAttribute("data-dept"),fld=i.getAttribute("data-fld");
    var k=ty+"|"+dp;if(!map[k])map[k]={budget_type:ty,department:dp,sales_budget_zar:null,po_budget_zar:null,gr_budget_zar:null};
    var v=i.value===""?null:Number(i.value);
    if(fld==="sales")map[k].sales_budget_zar=v;else if(fld==="po")map[k].po_budget_zar=v;else if(fld==="gr")map[k].gr_budget_zar=v;
  });
  var rows=Object.keys(map).map(function(k){return map[k]});var msg=$("wbmsg_"+wc);
  adminSend("/api/weekly-budgets","POST",{week_code:wc,week_ending:end,rows:rows}).then(function(j){if(msg)msg.textContent=j&&j.status==="ok"?("Saved ("+j.rows+" rows).") :("Error: "+(j&&j.error||"failed"))}).catch(function(e){if(msg)msg.textContent="Error: "+(e&&e.message||e)});
}
function deleteWeekBudgets(wc){
  if(!window.confirm("Remove all budget rows for "+wc+"?"))return;
  var msg=$("wbmsg_"+wc);
  fetch("/api/weekly-budgets/"+encodeURIComponent(wc),{method:"DELETE",headers:adminHdr()}).then(function(r){if(r.status===401){adminToken(true);throw new Error("Admin token rejected — re-enter and retry")}return r.json()}).then(function(){if(msg)msg.textContent="Removed.";PAGES.settings()}).catch(function(e){if(msg)msg.textContent="Error: "+(e&&e.message||e)});
}
function saveSettings(){var body={};window._setKeys.forEach(function(k){body[k]=$("set_"+k).value});
  adminSend("/api/settings","PUT",body).then(function(){$("set_msg").textContent="Saved."}).catch(function(e){$("set_msg").textContent="Error: "+(e&&e.message||e)})}
function saveGuideline(dept,val){var today=new Date().toISOString().slice(0,10);
  adminSend("/api/guidelines/"+dept,"PUT",{guideline_margin_pct:Number(val),effective_from:today}).catch(function(){})}

PAGES.export=function(){
  var reps=[["purchase-summary","Purchase Summary"],["open-orders","Open Orders"],["vendor-analysis","Vendor Analysis"],["article-analysis","Article Analysis"],["category-analysis","Category Analysis"],["anomaly-report","Anomaly Report"],["returns-report","Returns Report"],["cash-flow","Cash Flow Projection"],["fim-margin","FIM Margin Performance"]];
  setHTML('<div class="card"><h2>Export reports (xlsx)</h2><div class="cards g3">'+reps.map(function(r,i){return '<div class="card" style="display:flex;flex-direction:column;gap:8px"><strong>'+(i+1)+". "+esc(r[1])+'</strong><a class="btn" href="/api/reports/'+r[0]+'.xlsx" download>\\u2B07 Download xlsx</a></div>'}).join("")+'</div><div class="legend" style="margin-top:10px">Each report is generated server-side from the current data and downloads as an Excel workbook.</div></div>');
};

// ---- Integrated Margin Analysis (dashboard-first) ----
// Single #ima nav entry -> dashboard of 6 group cards -> per-group detail screen.
// IMA data (6 groups, each with FIM-column items) lives in the IMA array above.
var IMA_GROUP={};IMA.forEach(function(g){IMA_GROUP[g.id]=g.label});

// Period selector shared by the dashboard + group screens. State persists in
// IMA_PERIOD; all values are placeholders ("--") until the FIM API is wired up.
var IMA_PERIOD={type:"month",period:""};
// BUG FIX: the old IMA bar only sent dates for "Monthly" (day/week/fy did
// nothing, and no specific date was pickable). Use the shared period picker so
// any date/week/period/FY/custom range is selectable and actually drives the data.
var _imaFT={from:"",to:""};
function imaPeriodBar(){return periodPickerHTML("imaPer")}
function imaWire(reload){initPeriodPicker("imaPer",function(from,to){_imaFT={from:from,to:to};reload()},"month")}

// Map IMA item id -> [fim_daily column, kind]. ONLY items whose metric is actually
// stored in fim_daily are wired to real data; everything else shows "--".
var IMA_DBCOL={
 "fim-net-sales":["net_sales_zar","money"],
 "fim-total-cos":["total_cos_zar","money"],
 "fim-opening-soh":["opening_soh_zar","money"],
 "fim-closing-soh":["closing_soh_zar","money"],
 "fim-total-purchases":["total_purchases_zar","money"],
 "fim-net-gr-cost":["net_gr_cost_zar","money"],
 "fim-pos-profit":["pos_profit_zar","money"],
 "fim-pos-margin":["pos_margin_pct","pct"],
 "fim-op-profit":["operating_profit_zar","money"],
 "fim-op-margin":["operating_margin_pct","pct"],
 "fim-store-profit":["store_profit_zar","money"],
 "fim-store-margin":["store_margin_pct","pct"],
 "fim-comm-disc":["commercial_disc_zar","money"],
 "fim-line-disc-fund":["line_disc_zar","money"],
 "fim-basket-disc":["basket_disc_zar","money"],
 "fim-trade-invest":["trade_invest_zar","money"],
 "fim-sallies-total":["sallies_tallies_zar","money"],
 "fim-swell-total":["swell_allowance_zar","money"],
 "fim-total-shortages":["total_shortages_zar","money"],
 "fim-net-shrinkage":["net_shrinkage_zar","money"],
 "fim-shrink":["shrink_zar","money"],
 "fim-waste-total":["waste_zar","money"],
 "fim-rtc":["rtc_zar","money"]
};
// Fetch store-total FIM values for the selected period (defaults to latest month).
function imaFetch(){
  var p=(_imaFT.from&&_imaFT.to)?("?from="+_imaFT.from+"&to="+_imaFT.to):"";
  return api("/api/fim/ima"+p);
}
function imaVal(it,vals){var m=IMA_DBCOL[it.id];if(!m)return "--";var v=vals[m[0]];if(v==null)return "--";return m[1]==="pct"?pct(v):Rr0(v)}

// IMA dashboard: one card per group (click -> #<group id>). Headline = first
// real money metric in the group, else "--".
PAGES.ima=function(){
  setHTML(imaPeriodBar()+'<div id="imacards" class="cards g3"><div class="loading">Loading\\u2026</div></div>');
  function reload(){ var ec=$("imacards"); if(ec)ec.innerHTML='<div class="loading">Loading\\u2026</div>';
  imaFetch().then(function(d){
    var vals=d.values||{};
    $("imacards").innerHTML=IMA.map(function(g){
      var head="--";
      for(var i=0;i<g.items.length;i++){var m=IMA_DBCOL[g.items[i].id];if(m&&m[1]==="money"&&vals[m[0]]!=null){head=Rr0(vals[m[0]]);break}}
      var extra="";
      if(g.id==="ima-profit"){
        extra='<div class="small" style="margin-top:6px">Operating margin: <b>'+(vals.operating_margin_pct!=null?pct(vals.operating_margin_pct):"--")
          +'</b><br>Store margin: <b>'+(vals.store_margin_pct!=null?pct(vals.store_margin_pct):"--")+'</b></div>';
      }
      return '<div class="card" style="cursor:pointer" onclick="location.hash=\\'#'+g.id+'\\'">'
        +'<h2 style="text-transform:none;color:var(--ink);font-size:15px">'+g.icon+' '+esc(g.label)+'</h2>'
        +'<div class="kpi"><div class="v">'+head+'</div><div class="l">'+g.items.length+' FIM metrics</div></div>'
        +extra+'<a class="link">View detail \\u2192</a></div>';
    }).join("");
  }).catch(function(e){var el=$("imacards");if(el)el.innerHTML='<div class="err">'+esc(e.message)+'</div>'}); }
  imaWire(reload);
};

// Per-group detail: lists that group's metrics, real values where the column
// exists in fim_daily and "--" otherwise.
IMA.forEach(function(g){
  PAGES[g.id]=function(){
    setHTML(imaPeriodBar()
      +'<div class="card"><h2 style="text-transform:none;color:var(--ink);font-size:15px">'+g.icon+' '+esc(g.label)+'</h2>'
      +'<div id="imabody"><div class="loading">Loading\\u2026</div></div>'
      +'<div style="margin-top:10px"><a class="link" href="#ima">\\u2190 Back to IMA dashboard</a></div></div>');
    function reload(){ var lb=$("imabody"); if(lb)lb.innerHTML='<div class="loading">Loading\\u2026</div>';
    imaFetch().then(function(d){
      var vals=d.values||{};
      var rows=g.items.map(function(it){
        return '<tr><td>'+esc(it.label)+'</td><td class="num muted">'+it.col+'</td><td class="num">'+imaVal(it,vals)+'</td></tr>';
      }).join("");
      var el=$("imabody");if(el)el.innerHTML='<div class="muted small" style="margin-bottom:6px">Period '+esc(d.from||"latest")+' \\u2192 '+esc(d.to||"")+'</div><div class="tablewrap"><table><thead><tr><th>Metric</th><th class="num">FIM col</th><th class="num">Value</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
    }).catch(function(e){var el=$("imabody");if(el)el.innerHTML='<div class="err">'+esc(e.message)+'</div>'}); }
    imaWire(reload);
  };
});

// ---- sidebar (collapsible groups, state persisted in localStorage) ----
function navGroupOpen(id){try{return localStorage.getItem("nav-"+id)!=="0"}catch(e){return true}}
function renderNav(){
  var map={};NAV.forEach(function(n){map[n[0]]=n});
  $("nav").innerHTML=NAV_GROUPS.map(function(grp){
    var open=navGroupOpen(grp.id);
    var links=grp.items.map(function(k){var n=map[k];return n?'<a data-r="'+n[0]+'" href="#'+n[0]+'"><span class="ic">'+n[1]+'</span>'+esc(n[2])+'</a>':""}).join("");
    return '<div class="navgrp'+(open?" expanded":"")+'" data-g="'+grp.id+'">'
      +'<div class="navgrp-h" data-toggle="'+grp.id+'">'+esc(grp.label)+'<span class="navgrp-x">'+(open?"\\u2212":"+")+'</span></div>'
      +'<div class="navgrp-items">'+links+'</div></div>';
  }).join("");
  document.querySelectorAll("#nav .navgrp-h").forEach(function(hh){hh.addEventListener("click",function(){
    var id=this.getAttribute("data-toggle");var g=this.parentNode;var nowOpen=!g.classList.contains("expanded");
    g.classList.toggle("expanded",nowOpen);try{localStorage.setItem("nav-"+id,nowOpen?"1":"0")}catch(e){}
    var x=this.querySelector(".navgrp-x");if(x)x.textContent=nowOpen?"\\u2212":"+";
  })});
}

// ---- router ----
function go(){var hash=(location.hash||"#dashboard").slice(1);if(!PAGES[hash]){hash="dashboard"}
  // Highlight the single IMA nav item when on the dashboard or any group screen.
  document.querySelectorAll("#nav a").forEach(function(a){var r=a.getAttribute("data-r");a.classList.toggle("active",r===hash||(r==="ima"&&!!IMA_GROUP[hash]))});
  // Ensure the active link's group is expanded so the highlight is visible.
  var activeLink=document.querySelector('#nav a.active');if(activeLink){var grp=activeLink.closest(".navgrp");if(grp&&!grp.classList.contains("expanded")){grp.classList.add("expanded");var x=grp.querySelector(".navgrp-x");if(x)x.textContent="\\u2212"}}
  document.querySelectorAll("#botnav a").forEach(function(a){a.classList.toggle("active",a.getAttribute("data-r")===hash)});
  var nv=NAV.filter(function(n){return n[0]===hash})[0];
  $("title").textContent=nv?nv[2]:(IMA_GROUP[hash]?IMA_GROUP[hash]:"Dashboard");
  closeNav();closeModal();try{PAGES[hash]()}catch(e){errBox(e)}}
renderNav();
window.addEventListener("hashchange",go);
function tick(){var s="Pick n Pay Lydenburg \\u00b7 "+new Date().toLocaleString("en-ZA",{hour12:false});$("clock").textContent=s;var sb=$("subbar");if(sb)sb.textContent=s}
tick();setInterval(tick,1000);
// NOTE: the timed auto-refresh that re-ran the current PAGES[hash]() every 60–120s
// was removed — it caused the dashboard to re-render/re-fetch on a timer. Screens
// now refresh only on navigation, period change, or an explicit Apply/refresh.
go();
</script>
</body>
</html>`;

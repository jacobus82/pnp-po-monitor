// Validate the inline SPA <script> inside APP_HTML (a template literal), which tsc
// treats as an opaque string. Extracts it, applies template-literal unescaping,
// and syntax-checks with new Function(). Run: node scripts/check-inline.cjs
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../src/app.ts", "utf8");
const start = src.indexOf("export const APP_HTML");
const tickStart = src.indexOf("`", start);
let i = tickStart + 1, end = -1;
for (; i < src.length; i++) {
  if (src[i] === "\\") { i++; continue; }
  if (src[i] === "`") { end = i; break; }
}
const tl = src.slice(tickStart + 1, end);
// Reverse template-literal escapes: \` -> `, \$ -> $, \\ -> \
const served = tl.replace(/\\`/g, "`").replace(/\\\$/g, "$").replace(/\\\\/g, "\\");
const m = served.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error("no <script> found"); process.exit(1); }
try { new Function(m[1]); console.log("INLINE SCRIPT OK (" + m[1].length + " chars)"); }
catch (e) {
  console.error("INLINE SYNTAX ERROR:", e.message);
  fs.writeFileSync(__dirname + "/../.inline-script.tmp.js", m[1]);
  console.error("wrote .inline-script.tmp.js — run: node --check .inline-script.tmp.js");
  process.exit(1);
}

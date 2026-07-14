# pnp-po-monitor

SAP purchase-order ingestion and anomaly monitoring on Cloudflare Workers.

**Store:** Dolly's Supermarket (Pty) Ltd t/a **Pick n Pay Lydenburg** — store **2516**, site **NF16**, owner Jacobus Pretorius.

Upload a SAP PO export → the file is archived in **R2**, parsed, and exploded into
`po_lines` in **D1** with deduped `vendors`/`articles` masters. Each ingest runs an
anomaly pass (stale open orders, price spikes, over-budget, missing data, duplicates)
and re-evaluates budget traffic-lights.

## Architecture

```
client ──POST /api/uploads──▶ Worker
                               ├─ R2  (raw file archive: UPLOADS_BUCKET)
                               └─ D1  (DB): uploads · vendors · articles · po_lines · budgets · anomalies
```

| File | Role |
|------|------|
| `wrangler.toml` | Worker config + D1/R2 bindings + store vars |
| `schema/0001_init.sql` | D1 schema (uploads, vendors, articles, po_lines, budgets, anomalies) |
| `schema/0002_gr_lines.sql` | Goods-receipt lines + upload `kind` |
| `schema/0003_fim.sql` | FIM daily department performance + dept margin guidelines (seeded) |
| `src/index.ts` | HTTP router + ingest pipeline + dashboard aggregate |
| `src/dashboard.ts` | Self-contained HTML dashboard page (served at `/`) |
| `src/parser/core.ts` | Shared parser primitives (delimiter, number/date, header mapping) |
| `src/parser/sapParser.ts` | SAP PO export parser |
| `src/parser/grParser.ts` | Goods-receipt parser (dept + cost/sell/margin) |
| `src/parser/fimParser.ts` | FIM xlsx parser (dept-level rows, SheetJS) |
| `src/fiscal.ts` | PnP fiscal calendar (March–February year, Monday weeks) |
| `src/guidelines.ts` | Departmental guideline lookup (effective-dated) |
| `src/departments.ts` | Department master (`Z1/…` codes → names) |
| `src/db/repo.ts` | D1 read/write helpers |
| `src/anomalies/detect.ts` | Anomaly + budget-status engine (PO, GR margin, FIM) |

## Setup

```bash
npm install

# 1. Create the D1 database, then paste the printed database_id into wrangler.toml
npm run db:create

# 2. Create the R2 bucket
npm run r2:create

# 3. Apply the schema (local dev DB, then remote when ready)
npm run db:migrate:local
npm run db:migrate:remote

# 4. Run locally
npm run dev
```

Then open **http://localhost:8787/** for the dashboard (budget traffic-lights, open-order
aging, KPIs, open anomalies, recent uploads). It refreshes from `GET /api/dashboard`.

## Usage

```bash
# Ingest a SAP export (raw text body)
curl -X POST "http://localhost:8787/api/uploads?filename=me2m.tsv" \
  --data-binary @schema/sample-sap-export.tsv

# Or multipart
curl -X POST http://localhost:8787/api/uploads -F "file=@schema/sample-sap-export.tsv"

# Ingest a goods-receipt file (→ gr_lines)
curl -X POST http://localhost:8787/api/gr-uploads -F "file=@schema/sample-gr-export.csv"
curl "http://localhost:8787/api/gr-lines?dept=Z1/G14"   # filter by department

# Define a budget (R250 000 overall for June 2026)
curl -X POST http://localhost:8787/api/budgets \
  -H 'content-type: application/json' \
  -d '{"period":"2026-06","scopeType":"overall","capRands":250000}'

# Inspect
curl http://localhost:8787/api/uploads
curl http://localhost:8787/api/po-lines?status=open
curl http://localhost:8787/api/anomalies?severity=CRITICAL
curl http://localhost:8787/api/budget
```

## Budget status (traffic light)

Committed value = sum of `open_value_cents` for non-closed lines (scoped overall / by department / by vendor).

| Status | Used vs cap |
|--------|-------------|
| 🟢 GREEN | < 85% |
| 🟡 AMBER | 85–95% |
| 🟠 TIGHT | 95–100% |
| 🔴 OVER | > 100% |

Thresholds are tunable in `wrangler.toml` (`BUDGET_*_THRESHOLD`).

## SAP file format

The parser is **column-name driven**, not position driven. It auto-detects the
delimiter (tab / `;` / `|` / `,`) and maps source columns to canonical fields via a
synonym table. Supported labels include both descriptive headers
("Purchasing Document", "Net Price", "Still to be delivered (qty)") and SAP technical
field names (`EBELN`, `LIFNR`, `MATNR`, `NETPR`, `EINDT`, …).

If your real export uses different headers, extend `COLUMN_SYNONYMS` at the top of
`src/parser/sapParser.ts` — that is the single place column naming is configured.
Fixed-width (no-delimiter) exports are detected but not yet parsed.

> ⚠️ The sample file (`schema/sample-sap-export.tsv`) is a **best-guess layout**.
> Drop a real SAP export in and check the `mappedColumns` field in the upload
> response to confirm the column mapping before trusting the data.

## Goods receipts & departments

`POST /api/gr-uploads` parses a GR export into `gr_lines`
`(upload_id, po_number, article_code, article_desc, dept_code, dept_name, qty, cost_zar, sell_zar, margin_pct, gr_date)`.
`margin_pct` is derived as `(sell − cost) / sell × 100` when not supplied. Department
names are resolved from the code via `src/departments.ts`; a bare suffix (`G14`) or
`Z1/G14` both resolve to **Liquor**. The upload response includes a per-department
cost/sell/margin roll-up. `uploads.kind` is `'po'`, `'gr'`, or `'fim'`.

Departments: `Z1/F53` Convenience · `Z1/F55` Outsourced Bakery · `Z1/G12` Edible Groceries ·
`Z1/G13` Non-Edible · `Z1/G14` Liquor · `Z1/G15` Toiletries · `Z1/G99` Bottle Returns ·
`Z1/M83` Outdoor · `Z1/M85` Office · `Z1/M88` Home · `Z1/P11` Perishable Groceries.

## Dashboard refresh

Screens refresh on navigation, period change, or explicit Apply/refresh — there is no
background auto-refresh timer. The header shows a "data as at …" stamp.

## Anomaly types

| Type | Trigger |
|------|---------|
| `STALE_OPEN_ORDER` | Open line ≥ `STALE_OPEN_ORDER_DAYS` past delivery date |
| `PRICE_SPIKE` | Net price moved ≥ `price_alert_threshold_pct` (default 5%) vs last seen price for the article (CRITICAL at ≥ 2×). Detected per-line on full-path uploads, and via `POST /api/reconcile/recompute` for fast/batch uploads |
| `OVER_BUDGET` | A budget reached TIGHT or OVER status |
| `OVER_DELIVERY` | Goods received > ordered quantity |
| `MISSING_PRICE` / `MISSING_VENDOR` | Required field absent |
| `NEGATIVE_VALUE` | Negative qty or value |
| `DUPLICATE_PO_LINE` | Same PO+item appears twice in one file |
| `NEGATIVE_MARGIN` | GR line margin < 0% (loss-making receipt) — CRITICAL |
| `LOW_MARGIN` | GR line margin < 5% floor, or > 10pp below the dept guideline |
| `FIM_MARGIN_BELOW_GUIDELINE` | POS margin < guideline−5pp (CRITICAL) / < guideline−2pp (WARN) |
| `FIM_HIGH_WASTE` / `FIM_HIGH_SHRINK` | Waste > 5% / shrink > 3% of net sales |
| `FIM_PARTICIPATION_DEVIATION` | Sales share differs > 3pp from participation guideline |

> **F06 Instore Bakery & F09 Butchery** carry in-store production distortion on any
> single day (receipts and sales land on different dates), so their FIM findings are
> logged as **INFO** until the whole fiscal week (all 7 days) is present — then they
> escalate to WARN/CRITICAL.

## FIM & margin guidelines

`POST /api/fim-uploads` ingests a daily FIM spreadsheet (`.xlsx`, filename
`FIM_YYYY-MM-DD.xlsx`). Only **department-level** rows are kept (column 0 is a short
code like `F09`, `G12`, `P11`); article rows (6+ digit codes) are skipped, and the
"Overall Result" line is stored as `dept_code = 'TOTAL'`. Each row is stamped with the
PnP **fiscal calendar** (March–February year, Monday-anchored weeks) and upserted into
`fim_daily` on `(report_date, dept_code)`.

Official departmental targets live in `dept_guidelines` (seeded effective `2026-03-01`,
grouped Non-Fresh / Fresh-A / Fresh-B) with effective-dated history.

```bash
# Ingest a daily FIM
curl -X POST http://localhost:8787/api/fim-uploads -F "file=@schema/sample-fim-export.xlsx;filename=FIM_2026-06-13.xlsx"

# Guidelines: current, history, and effective-dated update
curl http://localhost:8787/api/guidelines
curl http://localhost:8787/api/guidelines/F09/history
curl -X PUT http://localhost:8787/api/guidelines/F09 \
  -H 'content-type: application/json' -d '{"guideline_margin_pct":20.5,"effective_from":"2026-09-01"}'

# FIM rollups
curl "http://localhost:8787/api/fim/summary?fy=2027&quarter=2&week=16"
curl http://localhost:8787/api/fim/departments     # latest margin per dept vs guideline
curl "http://localhost:8787/api/fim/trend?dept=F09" # weekly rollup for sparklines
```

The dashboard adds a **GR / Margin** panel (latest goods-receipt blended margin +
per-dept vs-guideline breakdown with inline margin flags) and a **Margin performance**
section (departments grouped Non-Fresh / Fresh-A / Fresh-B, actual-vs-guideline margin
and participation bars, worst performer per group highlighted).

## Analytics UI (single-page app)

`/` serves the **SPA** (`src/app.ts`, hash-routed, all CSS/JS inline). `/classic` is
the legacy dashboard (`src/dashboard.ts`); `/upload` is the upload page. Screens refresh
on navigation / period change only (no background timer).

- **Shared period picker** (`GET /api/periods`): Yesterday / This week / This month +
  fiscal year / period / week + custom. Never offers "today"; every range is capped at
  the latest data date. Applied across Department, Stock, Funding, Category, Vendor,
  Waste, Goods-Receipt and IMA screens.
- **Trading** compares the selected period against the **same period last year** (TY vs LY).
- **Article Analysis** — three lenses side by side: **PO value ordered** (`po_lines`) vs
  **GR value received** (`gr_lines`), a 12-month monthly-average **unit-price** line
  (per SKU unit = net value ÷ SKU qty), and **FIM** cross-match (net sales / waste /
  shrink from `fim_articles` where present, with an earliest-date hint otherwise) plus
  per-month GR / waste / shrink bars. Funding is **not** article-attributable in the
  statement data (Bonus Buy = promo-batch ref, Swell = category level) and is omitted
  with a note.
- **Weekly view** — fiscal-week picker (Monday-start), four day-by-day blocks
  (purchase orders, goods receipts, FIM margins — Fresh-B contributes weekly-averaged
  margins, daily suppressed), and week-scoped anomalies.
- **Fan Score / NPS** — a week selector drives the whole page; the trend is a rolling
  6 weeks ending at the selected week with a 90 % target line.
- **Anomaly drill-through** — every anomaly row (Weekly view + Risk & Anomalies) links
  to its evidence: `PRICE_SPIKE` → Article Analysis (spike month highlighted),
  `FIM_HIGH_WASTE`/`FIM_HIGH_SHRINK` → Waste & Shrinkage filtered to dept + period,
  stale order → the PO in Open Orders. One delegated click listener on `[data-drill]`.

## Weekly budgets from LY FIM

`GET /api/budgets/generate-ly?week=&growthPct=&marginPct=` builds a weekly budget from
**last year's** corresponding fiscal week (same week number). LY net sales per SAP
department come from FIM at the finest report-type per day (weekly for Fresh-B where it
exists, daily/monthly rollup otherwise). Per department: `sales budget = LY sales ×
(1 + growth%)`, `GR budget = sales budget × (1 − required margin%)`, no PO budget; the
store total is the sum of departments. The **Budgets** page reviews the table (editable
sales budgets) and saves via `POST /api/weekly-budgets` (`weekly_budgets`, one row per
week × budget_type × department). Admin-gated.

## Auto-close aged POs

Open PO lines older than `app_settings.open_po_max_age_days` (default **90**, editable in
Settings) are treated as closed at query level — excluded from Open / Committed tiles,
the invoice-to-deliver views and stale flags — **without mutating rows** (historic
analysis screens still see them). See `notAgedOutSql` / `openPoMaxAgeDays` in
`src/db/repo.ts`.

## New/notable endpoints

```bash
curl "…/api/periods"                                   # period-picker options
curl "…/api/trading?from=&to="                         # TY vs LY period comparison
curl "…/api/articles?limit=1000"                       # article list (PO + GR value)
curl "…/api/articles/848207"                           # article detail (3 lenses)
curl "…/api/weekly/day-blocks?from=&to="               # PO / GR / FIM per day
curl "…/api/anomalies/scoped?from=&to=&resolved=false" # week-scoped, drill-enriched
curl "…/api/budgets/generate-ly?week=&growthPct=&marginPct="
curl "…/api/fan-score/summary?week="                   # + /history?week= , /responses?week=
curl "…/api/fim/by-period"                             # fiscal-period rollup w/ date ranges
```

## Settlement — GR ↔ statement reconciliation (money recovery)

`POST /api/eod-uploads` ingests the weekly **End-of-Day Movements Report** (`.txt`
tab-delimited latin-1, or older `.htm` ALV table — sniffed by content) into
`eod_movements`. Each ingest re-evaluates the persisted settlement ledger, matching
what we **received** (EOD goods receipts) against what PnP **billed** (statement
INVOICE lines). The match unit is the **LIV DocNo** (= statement `doc_number`), with
EOD GR rows **aggregated per LIV first** — one invoice covers many receipts, so
row-level comparison would double-count.

Three buckets per fiscal week, plus a billing-variance claims list:

| Bucket | Meaning |
|--------|---------|
| **Matched** | LIV on a statement, within tolerance (R5 direct / R2,000 DC-MA15) |
| **Received, not billed** | EOD LIVs / uninvoiced GRs not yet on any statement (aged, flagged > 14 days) |
| **Billed, not received** | Statement LIVs with no EOD goods receipt |
| **Claims (variance)** | Per-LIV signed `GR total − LIV value` beyond tolerance — the list to raise |

`FRANCHISE ONE TIME VENDOR` lines are excluded. Each Goods Return Note is tracked
for its statement DCRC credit; returns with no credit after 14 days are flagged.

The **Settlement** screen (Purchasing group) has a fiscal-week picker, the four
summary tiles, the variance/aging/returns/billed tables, and a drill: clicking a
variance row opens the underlying EOD GR rows + statement lines.

```bash
curl -X POST "…/api/eod-uploads?filename=eod_06.07-12.07.2026.txt" --data-binary @eod.txt
curl "…/api/settlement?week=202719"          # three-bucket reconciliation + claims
curl "…/api/settlement/liv?liv=5149590384"   # drill: EOD GR rows + statement lines
```

> Data note: the D1 database caps large ingests (~60k rows/upload) on the per-operation
> CPU limit; `fim_daily` mixes daily/weekly/monthly `report_type` rows, so read it via
> the finest-resolution CTE (`fimResolvedCte` in `src/analytics.ts`) rather than raw
> `date_from>=? AND date_to<=?` containment.

## Statement analytics (Cash & Creditors)

`/#cash` is the statement dashboard, driven by `/api/statements/dashboard` +
`/api/statements/lines` (`src/statements-analytics.ts`):

- **Payments due** — each statement's `total_due` is payable on its `due_date`.
  A statement is PAID when a later statement carries a payment line matching its
  `total_due` (±R1) — plus a FIFO settlement reconciliation (payments clear oldest
  dues first) so lump-sum-paid old statements don't show as false overdue. The
  panel shows the next payment (the latest statement's obligation), the unpaid
  schedule, total outstanding, and overdue.
- **Balance trend** — closing balance per week across all statements, chained from
  the few PRINTED anchors (`closing = opening + Σ lines`); printed points render as
  diamonds, derived as dots.
- **Funding** — purchases (invoices) vs credits, with credits-as-%-of-purchases
  (the funding rate); credit decomposition by type (swell / bonus buy / rebate /
  loyalty / promo-funding / other); fixed charges (franchise fee + loyalty) by
  month; swell-by-department parsed from `*1.500% F05 Swell MA15` vendor text with
  rebate-completeness gap flags; interest lines flagged (should be zero).
- **Line browser** — filter by statement / date / type / vendor / text, sortable,
  with per-type subtotals. Every chart drills into it (a `[data-drill]` segment sets
  `#cash?week=&type=` and pre-filters the browser).

A **PnP Account** dashboard tile shows current balance, next payment due, and an
overdue badge, linking to this screen.

## Weekly Operating Brief + data completeness (Brief 7)

**Data coverage** (`/api/feed-coverage`, `src/coverage.ts`, screen `#coverage`):
per fiscal week, presence of every feed (PO, GR, EOD, FIM daily+weekly, statement,
customer count, Fan Score) as green/amber/red, plus latest-loaded markers and a
dashboard **staleness strip**. `weekCoverage()` is reused to flag any Brief section
built on incomplete data.

**Weekly Operating Brief** (`/api/brief`, `src/brief.ts`, screen `#brief`,
print-friendly): five sections for a fiscal week (default = last completed) —
Trading (sales vs budget store+dept, GP% vs required margin, same-week-LY), Loss
(waste/shrink vs 2% + top-5 offenders with 4-week trend), Money out (PnP payments
due 14d + Vencor 14-day GR terms + overdue), Money back (confirmed claims /
uninvoiced GR >14d / returns without credit), Watch (Fan Score vs 90, interest,
week-scoped anomalies). Every figure drills to its source screen; a section whose
feeds are incomplete shows an inline warning rather than a partial total. The
dashboard adds a **"This week so far"** card (sales-to-date vs pro-rata budget,
POs placed; "awaiting FIM" when the current week hasn't loaded).

> `scripts/check-inline.cjs` syntax-checks the inline SPA `<script>` (which tsc
> treats as an opaque string) — run it before deploying app.ts changes.

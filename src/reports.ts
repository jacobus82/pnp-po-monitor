import * as XLSX from "xlsx";
import type { Env } from "./config";

/**
 * Server-side XLSX report builders (SheetJS). Each report runs a query, builds
 * an array-of-arrays sheet, and streams it back as a download.
 */

const R = (cents: number | null | undefined): number =>
  cents == null ? 0 : Math.round(cents) / 100;

function workbookResponse(name: string, sheetName: string, rows: unknown[][]): Response {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Response(buf, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${name}.xlsx"`,
    },
  });
}

async function all<T = Record<string, unknown>>(env: Env, sql: string, binds: unknown[] = []): Promise<T[]> {
  const res = await env.DB.prepare(sql).bind(...binds).all<T>();
  return res.results ?? [];
}

const PURCH = `CASE WHEN COALESCE(sloc,'')='S002' THEN 0 ELSE COALESCE(line_value_cents,0) END`;
// S002 returns are negative movements; negate so RET is a positive magnitude.
const RET = `CASE WHEN COALESCE(sloc,'')='S002' THEN -COALESCE(line_value_cents,0) ELSE 0 END`;

/** GET /api/reports/:name.xlsx */
export async function handleReport(_req: Request, env: Env, name: string): Promise<Response> {
  switch (name) {
    case "purchase-summary": {
      const rows = await all(
        env,
        `SELECT order_date d, SUM(${PURCH}) purch, SUM(${RET}) ret, COUNT(*) lines
         FROM po_lines WHERE order_date IS NOT NULL GROUP BY order_date ORDER BY order_date`,
      );
      const aoa: unknown[][] = [["Date", "Purchases (R)", "Returns (R)", "Net (R)", "Lines"]];
      for (const r of rows as Record<string, number>[]) {
        const purch = r.purch ?? 0, ret = r.ret ?? 0;
        aoa.push([r.d, R(purch), R(ret), R(purch - ret), r.lines]);
      }
      return workbookResponse("purchase-summary", "Purchase Summary", aoa);
    }
    case "open-orders": {
      const rows = await all(
        env,
        `SELECT p.po_number, p.order_date, v.name vendor, a.article_code, a.description,
                p.order_qty, p.open_value_cents, p.open_invoice_cents
         FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN articles a ON a.id=p.article_id
         WHERE COALESCE(p.open_value_cents,0)>0 OR COALESCE(p.open_invoice_cents,0)>0
         ORDER BY p.open_value_cents DESC LIMIT 50000`,
      );
      const aoa: unknown[][] = [
        ["PO", "Order date", "Vendor", "Article", "Description", "Qty", "Open to deliver (R)", "Open to invoice (R)"],
      ];
      for (const r of rows as Record<string, number | string>[]) {
        aoa.push([r.po_number, r.order_date, r.vendor, r.article_code, r.description, r.order_qty, R(r.open_value_cents as number), R(r.open_invoice_cents as number)]);
      }
      return workbookResponse("open-orders", "Open Orders", aoa);
    }
    case "vendor-analysis": {
      const rows = await all(
        env,
        `SELECT v.vendor_code, v.name, SUM(${PURCH}) purch, SUM(${RET}) ret,
                SUM(COALESCE(p.open_value_cents,0)) od, SUM(COALESCE(p.open_invoice_cents,0)) oi,
                COUNT(DISTINCT p.po_number) pos, COUNT(*) lines
         FROM po_lines p JOIN vendors v ON v.id=p.vendor_id GROUP BY v.id ORDER BY purch DESC`,
      );
      const aoa: unknown[][] = [
        ["Vendor code", "Name", "Purchases (R)", "Returns (R)", "Net (R)", "Open deliver (R)", "Open invoice (R)", "PO count", "Lines"],
      ];
      for (const r of rows as Record<string, number | string>[]) {
        aoa.push([r.vendor_code, r.name, R(r.purch as number), R(r.ret as number), R((r.purch as number) - (r.ret as number)), R(r.od as number), R(r.oi as number), r.pos, r.lines]);
      }
      return workbookResponse("vendor-analysis", "Vendor Analysis", aoa);
    }
    case "article-analysis": {
      const rows = await all(
        env,
        `SELECT a.article_code, a.description, a.department, SUM(${PURCH}) val,
                AVG(p.net_price_cents) avgp, COUNT(*) orders
         FROM po_lines p JOIN articles a ON a.id=p.article_id GROUP BY a.id ORDER BY val DESC LIMIT 20000`,
      );
      const aoa: unknown[][] = [["Article", "Description", "Dept", "Total value (R)", "Avg price (R)", "Order count"]];
      for (const r of rows as Record<string, number | string>[]) {
        aoa.push([r.article_code, r.description, r.department, R(r.val as number), R(r.avgp as number), r.orders]);
      }
      return workbookResponse("article-analysis", "Article Analysis", aoa);
    }
    case "category-analysis": {
      const rows = await all(
        env,
        `SELECT mdse_cat, substr(mdse_cat,1,3) dept, SUM(${PURCH}) val,
                SUM(COALESCE(open_value_cents,0)) od, COUNT(*) lines
         FROM po_lines WHERE mdse_cat IS NOT NULL GROUP BY mdse_cat ORDER BY val DESC`,
      );
      const aoa: unknown[][] = [["Category", "Dept", "Purchases (R)", "Open deliver (R)", "Lines"]];
      for (const r of rows as Record<string, number | string>[]) {
        aoa.push([r.mdse_cat, r.dept, R(r.val as number), R(r.od as number), r.lines]);
      }
      return workbookResponse("category-analysis", "Category Analysis", aoa);
    }
    case "anomaly-report": {
      const rows = await all(
        env,
        `SELECT severity, type, message, resolved, detected_at FROM anomalies
         ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, id DESC LIMIT 20000`,
      );
      const aoa: unknown[][] = [["Severity", "Type", "Message", "Acknowledged", "Detected"]];
      for (const r of rows as Record<string, number | string>[]) {
        aoa.push([r.severity, r.type, r.message, r.resolved ? "Yes" : "No", r.detected_at]);
      }
      return workbookResponse("anomaly-report", "Anomalies", aoa);
    }
    case "returns-report": {
      const rows = await all(
        env,
        `SELECT p.po_number, p.order_date, v.name vendor, a.article_code, a.description, -p.line_value_cents line_value_cents
         FROM po_lines p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN articles a ON a.id=p.article_id
         WHERE p.sloc='S002' ORDER BY p.order_date DESC LIMIT 20000`,
      );
      const aoa: unknown[][] = [["PO", "Date", "Vendor", "Article", "Description", "Return value (R)"]];
      for (const r of rows as Record<string, number | string>[]) {
        aoa.push([r.po_number, r.order_date, r.vendor, r.article_code, r.description, R(r.line_value_cents as number)]);
      }
      return workbookResponse("returns-report", "Returns", aoa);
    }
    case "cash-flow": {
      const rows = await all(
        env,
        `SELECT week_start, week_end, opening_cents, purchases_cents, credits_cents, closing_cents, due_date
         FROM creditor_statements ORDER BY week_start`,
      );
      const aoa: unknown[][] = [["Week start", "Week end", "Opening (R)", "Purchases (R)", "Credits (R)", "Closing (R)", "Due date"]];
      for (const r of rows as Record<string, number | string>[]) {
        aoa.push([r.week_start, r.week_end, R(r.opening_cents as number), R(r.purchases_cents as number), R(r.credits_cents as number), R(r.closing_cents as number), r.due_date]);
      }
      return workbookResponse("cash-flow", "Cash Flow", aoa);
    }
    case "fim-margin": {
      const rows = await all(
        env,
        `SELECT dept_code, dept_name, report_date, net_sales_zar, pos_margin_pct, operating_margin_pct,
                shrink_zar, waste_zar, store_margin_pct
         FROM fim_daily WHERE dept_code != 'TOTAL' AND report_date=(SELECT MAX(report_date) FROM fim_daily) ORDER BY net_sales_zar DESC`,
      );
      const aoa: unknown[][] = [
        ["Dept", "Name", "Report date", "Net sales (R)", "POS margin %", "Operating margin %", "Shrink (R)", "Waste (R)", "Store margin %"],
      ];
      for (const r of rows as Record<string, number | string>[]) {
        aoa.push([r.dept_code, r.dept_name, r.report_date, r.net_sales_zar, r.pos_margin_pct, r.operating_margin_pct, r.shrink_zar, r.waste_zar, r.store_margin_pct]);
      }
      return workbookResponse("fim-margin", "FIM Margin", aoa);
    }
    default:
      return new Response(JSON.stringify({ error: "Unknown report", name }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
  }
}

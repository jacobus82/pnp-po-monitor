/**
 * Pick n Pay fiscal calendar.
 *
 * PnP's financial year runs **March → February**. A fiscal year is named after
 * the calendar year in which it *ends*: FY2027 runs 1 Mar 2026 → 28 Feb 2027.
 *
 * Fiscal weeks are Monday-anchored: week 1 begins on the first Monday on or
 * before 1 March of the fiscal year's opening calendar year. All arithmetic is
 * done in UTC against date-only (midnight) values to avoid timezone drift.
 */

export interface FiscalCalendar {
  fiscalYear: number; // e.g. 2027 for a date in June 2026
  fiscalQuarter: 1 | 2 | 3 | 4; // Q1 Mar-May, Q2 Jun-Aug, Q3 Sep-Nov, Q4 Dec-Feb
  fiscalWeek: number; // 1-based week number within the fiscal year
  fiscalWeekStart: string; // ISO YYYY-MM-DD (Monday)
  fiscalWeekEnd: string; // ISO YYYY-MM-DD (Sunday)
  dayOfWeek: number; // 1=Monday … 7=Sunday
}

/** Full 4-4-5 calendar context (lookup) — adds period/quarter codes & due date. */
export interface FiscalCalendarFull extends FiscalCalendar {
  fiscalWeekCode?: string; // '202601'
  fiscalPeriodCode?: string; // '2026P01'
  fiscalQuarterCode?: string; // '2026Q1'
  statementDueDate?: string; // ISO
  source: "lookup" | "calculated";
}

interface FiscalWeekRow {
  fiscal_week_code: string;
  fiscal_year: number;
  week_no: number;
  fiscal_period_code: string | null;
  fiscal_quarter: string | null; // 'Q1'..'Q4'
  fiscal_quarter_code: string | null;
  week_start: string;
  week_end: string;
  statement_due_date: string | null;
}

function quarterNum(q: string | null | undefined): 1 | 2 | 3 | 4 {
  const n = Number(String(q ?? "").replace(/[^\d]/g, ""));
  return n >= 1 && n <= 4 ? (n as 1 | 2 | 3 | 4) : 1;
}

/**
 * Official PnP fiscal calendar by lookup against the seeded fiscal_weeks table
 * (verified 4-4-5, FY2026–FY2030). Falls back to the calculated calendar for
 * any date outside the table so ingestion never fails.
 */
export async function fiscalCalendarLookup(
  env: { DB: D1Database },
  input: string | Date,
): Promise<FiscalCalendarFull> {
  const iso = isoDay(toUtcMidnight(input));
  const row = await env.DB.prepare(
    `SELECT fiscal_week_code, fiscal_year, week_no, fiscal_period_code, fiscal_quarter,
            fiscal_quarter_code, week_start, week_end, statement_due_date
     FROM fiscal_weeks WHERE week_start <= ? AND week_end >= ? LIMIT 1`,
  )
    .bind(iso, iso)
    .first<FiscalWeekRow>();

  if (row) {
    return {
      fiscalYear: row.fiscal_year,
      fiscalQuarter: quarterNum(row.fiscal_quarter),
      fiscalWeek: row.week_no,
      fiscalWeekStart: row.week_start,
      fiscalWeekEnd: row.week_end,
      dayOfWeek: ((new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7) + 1,
      fiscalWeekCode: row.fiscal_week_code,
      fiscalPeriodCode: row.fiscal_period_code ?? undefined,
      fiscalQuarterCode: row.fiscal_quarter_code ?? undefined,
      statementDueDate: row.statement_due_date ?? undefined,
      source: "lookup",
    };
  }
  return { ...fiscalCalendar(input), source: "calculated" };
}

const DAY_MS = 86_400_000;

/** Parse an ISO date (YYYY-MM-DD or full ISO) or Date into a UTC midnight epoch. */
function toUtcMidnight(input: string | Date): number {
  if (input instanceof Date) {
    return Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate());
  }
  const m = String(input)
    .trim()
    .match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) throw new Error(`fiscalCalendar: unrecognized date "${input}" (expected YYYY-MM-DD).`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function isoDay(epoch: number): string {
  return new Date(epoch).toISOString().slice(0, 10);
}

/** Compute the full PnP fiscal calendar context for a date. */
export function fiscalCalendar(input: string | Date): FiscalCalendar {
  const t = toUtcMidnight(input);
  const d = new Date(t);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12

  // Fiscal year is named for the calendar year it ends in.
  const fiscalYear = month >= 3 ? year + 1 : year;

  let fiscalQuarter: 1 | 2 | 3 | 4;
  if (month >= 3 && month <= 5) fiscalQuarter = 1;
  else if (month >= 6 && month <= 8) fiscalQuarter = 2;
  else if (month >= 9 && month <= 11) fiscalQuarter = 3;
  else fiscalQuarter = 4; // Dec, Jan, Feb

  // Anchor: first Monday on or before 1 March of the opening calendar year.
  const openingYear = fiscalYear - 1;
  const march1 = Date.UTC(openingYear, 2, 1); // month index 2 = March
  const march1Dow = new Date(march1).getUTCDay(); // 0=Sun … 6=Sat
  const daysSinceMonday = (march1Dow + 6) % 7; // 0 if March 1 is a Monday
  const anchorMonday = march1 - daysSinceMonday * DAY_MS;

  const fiscalWeek = Math.floor((t - anchorMonday) / (7 * DAY_MS)) + 1;
  const weekStart = anchorMonday + (fiscalWeek - 1) * 7 * DAY_MS;
  const weekEnd = weekStart + 6 * DAY_MS;

  const dayOfWeek = ((d.getUTCDay() + 6) % 7) + 1; // Mon=1 … Sun=7

  return {
    fiscalYear,
    fiscalQuarter,
    fiscalWeek,
    fiscalWeekStart: isoDay(weekStart),
    fiscalWeekEnd: isoDay(weekEnd),
    dayOfWeek,
  };
}

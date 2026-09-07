/**
 * The ONE canonical "what does this date range mean" resolver for every
 * ERP query/analysis/export/ranking tool in the assistant. This is the
 * single source of truth so "last 30 days" always means the exact same
 * thing regardless of which tool or which AI provider is asking - the
 * model is instructed (see promptBuilder.ts) to never invent or compute a
 * date range itself and instead omit startDate/endDate and let this
 * resolver apply the application's own definition.
 *
 * Root-cause fix: several query tools (getProductionSummary and friends in
 * productionQueryTools.ts / analysisTools.ts / exportTools.ts) previously
 * had NO default at all - if the model omitted startDate/endDate, the tool
 * silently queried the entire, all-time record set instead of "last 30
 * days." Every one of those tools must now resolve through here.
 *
 * Dates are computed from LOCAL calendar time (the browser's local
 * timezone, i.e. the factory's own timezone for a normal ASFOUR user), not
 * UTC - using toISOString() here would shift the day boundary near
 * midnight local time, silently including/excluding a day.
 */
export interface ResolvedDateRange {
  startDate: string;
  endDate: string;
  wasDefaulted: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD from LOCAL calendar date components - never toISOString() (UTC). */
function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Exported so the system prompt can ground the model with the real current date. */
export function todayLocalIso(): string {
  return toLocalIsoDate(new Date());
}

export function resolveDateRange(input: any): ResolvedDateRange {
  // A single explicit day (e.g. getProductionByDate) - always explicit, never defaulted.
  if (input?.date) {
    const date = String(input.date);
    return { startDate: date, endDate: date, wasDefaulted: false };
  }
  if (input?.startDate || input?.endDate) {
    const endDate = input.endDate ? String(input.endDate) : todayLocalIso();
    const startDate = input.startDate ? String(input.startDate) : endDate;
    return { startDate, endDate, wasDefaulted: false };
  }
  // No period specified at all - default to the last 30 days (inclusive of
  // today), and the caller MUST disclose wasDefaulted in its response text.
  const endDate = todayLocalIso();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { startDate: toLocalIsoDate(start), endDate, wasDefaulted: true };
}

const ARABIC_MONTH_NAMES: Record<string, number> = {
  'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6, 'يوليو': 7,
  'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
};

const ENGLISH_MONTH_NAMES: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

function daysInMonth(year: number, month: number): number {
  // Date(year, month, 0) is the last day of the PREVIOUS month to `month`
  // (0-based month arg), i.e. the last day of `month` itself (1-based) -
  // this is the one true-calendar-length computation, never a hardcoded 30.
  return new Date(year, month, 0).getDate();
}

function monthRange(year: number, month: number): ResolvedDateRange {
  return {
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`,
    wasDefaulted: false,
  };
}

/**
 * Exported wrapper around the same monthRange() calendar-length computation
 * used by extractExplicitMonthRange() - the Dashboard's "named month" filter
 * (setDashboardDateFilter) resolves an explicit month+year through this,
 * never a hand-rolled 30/31-day guess.
 */
export function resolveNamedMonthRange(year: number, month: number): ResolvedDateRange {
  return monthRange(year, month);
}

/**
 * Deterministically extracts an explicit NAMED-month reference from RAW user
 * text - "مايو 2026", "شهر 5 - 2026", "May 2026", "5/2026" - independent of
 * whatever the model itself produced. This is the authoritative fallback the
 * Gateway uses to inject/override a tool call's startDate/endDate BEFORE
 * execution whenever the user explicitly named a month, so a weak/free model
 * that fails to compute the range itself (or omits it) can never cause a
 * wrong or missing period - the deterministic resolver, not the LLM, owns
 * the final dates for an explicit month reference.
 *
 * Deliberately distinct from RELATIVE phrases ("آخر 30 يوم", "آخر 5 شهور",
 * "الشهر الماضي") - none of those name a specific month, so this function
 * returns null for them and they continue to go through resolveDateRange()'s
 * own default/model-computed path untouched. "شهر" (singular "month") is
 * only ever treated as an explicit reference when immediately followed by a
 * number ("شهر 5") - "شهور" (plural "months", as in "آخر 5 شهور") does not
 * contain that substring and is never matched.
 */
export function extractExplicitMonthRange(userText: string, todayIso: string = todayLocalIso()): ResolvedDateRange | null {
  if (!userText) return null;
  const text = String(userText);
  const currentYear = Number(todayIso.slice(0, 4));

  // 1) Arabic "شهر N" numeric form, optional trailing year: "شهر 5 - 2026", "شهر 5", "شهر 5/2026".
  const arabicNumericMatch = text.match(/شهر\s*(\d{1,2})\s*(?:[-\/]\s*(\d{4}))?/);
  if (arabicNumericMatch) {
    const month = Number(arabicNumericMatch[1]);
    if (month >= 1 && month <= 12) {
      const year = arabicNumericMatch[2] ? Number(arabicNumericMatch[2]) : currentYear;
      return monthRange(year, month);
    }
  }

  // 2) Arabic or English month NAME, optional trailing year: "مايو 2026", "May 2026", "مايو".
  const nameTokens = [...Object.keys(ARABIC_MONTH_NAMES), ...Object.keys(ENGLISH_MONTH_NAMES)];
  const namePattern = new RegExp(`(${nameTokens.join('|')})\\s*,?\\s*(\\d{4})?`, 'i');
  const nameMatch = text.match(namePattern);
  if (nameMatch) {
    const matchedToken = nameMatch[1];
    const month = ARABIC_MONTH_NAMES[matchedToken] ?? ENGLISH_MONTH_NAMES[matchedToken.toLowerCase()];
    if (month) {
      const year = nameMatch[2] ? Number(nameMatch[2]) : currentYear;
      return monthRange(year, month);
    }
  }

  // 3) Bare "N/YYYY" numeric month/year form: "5/2026".
  const slashMatch = text.match(/\b(\d{1,2})\s*\/\s*(\d{4})\b/);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const year = Number(slashMatch[2]);
    if (month >= 1 && month <= 12) return monthRange(year, month);
  }

  return null;
}

/** Bilingual "(last 30 days - no period specified)" / "(from X to Y)" disclosure fragment. */
export function periodDisclosure(range: ResolvedDateRange, language: 'ar' | 'en'): string {
  if (language === 'ar') {
    return range.wasDefaulted
      ? ` (خلال آخر 30 يومًا - لم يُحدد المستخدم فترة، من ${range.startDate} إلى ${range.endDate})`
      : ` (من ${range.startDate} إلى ${range.endDate})`;
  }
  return range.wasDefaulted
    ? ` (last 30 days - no period specified, from ${range.startDate} to ${range.endDate})`
    : ` (from ${range.startDate} to ${range.endDate})`;
}

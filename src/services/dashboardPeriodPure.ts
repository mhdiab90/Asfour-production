/**
 * Phase 5B - pure, Firebase-free date-period resolution for the two
 * Dashboard screens (DashboardView's classic dashboard and
 * DashboardBuilderView's custom dashboards).
 *
 * WHY THIS FILE EXISTS: the preset->date math previously lived inline
 * inside DashboardView.tsx, which imports React and therefore cannot be
 * loaded by the plain-tsx test scripts this repo uses (there is no test
 * runner or mocking framework here - see scripts/tests/). Phase 5B needs
 * that math to be deterministically testable across every preset, so it
 * moves here unchanged in meaning and is re-exported from DashboardView.tsx
 * so every existing importer (notably assistant/tools/navigationTools.ts,
 * which is OUT OF SCOPE for this phase and is NOT modified) keeps working
 * against the exact same symbols.
 *
 * WHAT PHASE 5B ACTUALLY CHANGES here vs. the previous inline version:
 *   - two NEW presets: 'last90days' and 'prevMonth' (previous calendar
 *     month), required by the Phase 5B period list. Purely additive - no
 *     existing preset's meaning is altered.
 *   - the DEFAULT preset moves from 'month' (calendar month-to-date) to
 *     'last30days'. This is the deliberate, disclosed Phase 5B product
 *     decision that makes the Dashboard's very first Firestore query
 *     server-side bounded (and therefore Phase 4B cache-eligible) instead
 *     of a full-history read of all 8 stage collections.
 *   - `isValidCustomRange()` is new: the previous inline resolver silently
 *     fell back to the default period for an incomplete OR INVERTED custom
 *     range. Phase 5B requires an inverted range to be REJECTED and
 *     surfaced to the user, never quietly substituted and never widened
 *     into a full-history read.
 *
 * DATE CONVENTION: every computation is LOCAL-calendar, never
 * toISOString()/UTC - identical to the reasoning already documented in
 * dateRangeResolver.ts and dashboardRegistry.ts's toDateStr(). Using UTC
 * would shift the day boundary for any positive-offset timezone (the
 * factory's own), silently including or excluding a production day.
 *
 * "Today" is INJECTED rather than read from the clock, so the tests can be
 * deterministic without a mocking framework - the same dependency-injection
 * convention genericStageDuplicateIdentityPure.ts's `readField` already
 * established in this codebase. Production callers inject the real value.
 */

/**
 * Phase 5B period vocabulary for the classic Dashboard.
 *
 * 'week' is the "Last 7 Days" rolling window (today-6 -> today); it keeps
 * its original id so the AI's setDashboardDateFilter contract
 * (navigationTools.ts, out of scope) and any dispatched patch carrying
 * `preset: 'week'` keep resolving to exactly what they did before - only
 * its UI LABEL is clarified to "Last 7 Days".
 *
 * 'month' is calendar month-to-date (1st -> today); 'prevMonth' is the
 * whole previous calendar month. 'all' preserves the pre-existing
 * "all time" bucket - it is an EXPLICIT, clearly-labelled user choice, and
 * removing it would be a real regression rather than an optimization.
 */
export type DashboardDatePreset =
  | 'today'
  | 'week'
  | 'month'
  | 'prevMonth'
  | 'last30days'
  | 'last90days'
  | 'all'
  | 'custom'
  | 'namedMonth';

export const DASHBOARD_DATE_PRESETS: DashboardDatePreset[] = [
  'today', 'week', 'month', 'prevMonth', 'last30days', 'last90days', 'all', 'custom', 'namedMonth',
];

/**
 * PHASE 5B PRODUCT DECISION: the Dashboard opens on the last 30 days.
 * This is intentional and user-visible (the resolved period is rendered on
 * screen and the active preset button is highlighted) - never a silent cap.
 */
export const DASHBOARD_DEFAULT_DATE_PRESET: DashboardDatePreset = 'last30days';

export interface DashboardDateSelection {
  preset: DashboardDatePreset;
  /** Required when preset === 'custom'. */
  startDate?: string;
  /** Required when preset === 'custom'. */
  endDate?: string;
  /** Required when preset === 'namedMonth' (1-12). */
  month?: number;
  /** Required when preset === 'namedMonth'. */
  year?: number;
}

export interface ResolvedDashboardRange {
  /** YYYY-MM-DD, or '' meaning "no lower bound" (the explicit 'all' preset only). */
  startDate: string;
  /** YYYY-MM-DD, or '' meaning "no upper bound" (the explicit 'all' preset only). */
  endDate: string;
  /** Language-agnostic display label; the UI layer resolves bilingual wording itself. */
  label: string;
  /**
   * True only when the user's CUSTOM range is incomplete or inverted. The
   * caller must NOT query Firestore in that state - it must surface a
   * validation message instead. Deliberately not conflated with "no bound":
   * an invalid custom range must never degrade into a full-history read.
   */
  invalid: boolean;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** YYYY-MM-DD from LOCAL calendar components - never toISOString() (UTC). */
function toLocalIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Parses YYYY-MM-DD into a LOCAL-midnight Date. Deliberately NOT
 * `new Date(iso)`, which the language spec parses as UTC for the bare date
 * form and would roll the day backwards in any positive-offset timezone.
 */
function parseLocalIsoDate(iso: string): Date {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  return new Date(y, m - 1, d);
}

/** A well-formed YYYY-MM-DD that also denotes a real calendar day. */
export function isWellFormedDashboardDate(value: string | undefined | null): boolean {
  if (!value || !ISO_DATE_RE.test(value)) return false;
  const parsed = parseLocalIsoDate(value);
  return !Number.isNaN(parsed.getTime()) && toLocalIsoDate(parsed) === value;
}

/**
 * A custom range is usable only when BOTH ends are present, both are real
 * dates, and it is not inverted. An equal start/end (a single day) is
 * valid. Phase 5B: an invalid range must block the query outright.
 */
export function isValidCustomRange(startDate?: string, endDate?: string): boolean {
  if (!isWellFormedDashboardDate(startDate) || !isWellFormedDashboardDate(endDate)) return false;
  return (startDate as string) <= (endDate as string);
}

export interface DashboardPeriodDeps {
  /** Today's LOCAL calendar date as YYYY-MM-DD. Injected so tests are deterministic. */
  today: string;
  /**
   * Resolves a named calendar month to its true first/last day. Injected so
   * this module stays free of any dependency on the assistant layer - the
   * caller passes the codebase's existing canonical resolver
   * (dateRangeResolver.ts's resolveNamedMonthRange), never a second
   * hand-rolled 30/31-day guess.
   */
  resolveNamedMonth: (year: number, month: number) => { startDate: string; endDate: string };
}

/** Rolling window ending today (inclusive), spanning `days` calendar days. */
function rollingWindow(today: string, days: number): { startDate: string; endDate: string } {
  const start = parseLocalIsoDate(today);
  start.setDate(start.getDate() - (days - 1));
  return { startDate: toLocalIsoDate(start), endDate: today };
}

function rangeLabel(startDate: string, endDate: string): string {
  return `${startDate} -> ${endDate}`;
}

/**
 * The ONE place the Dashboard turns a period selection into concrete
 * bounds. Both the classic Dashboard's preset buttons and the AI's
 * setDashboardDateFilter patches flow through here, so "last 30 days"
 * cannot mean two different things on the same screen.
 */
export function resolveDashboardDateSelection(
  sel: DashboardDateSelection,
  deps: DashboardPeriodDeps
): ResolvedDashboardRange {
  const today = deps.today;

  switch (sel.preset) {
    case 'today':
      return { startDate: today, endDate: today, label: today, invalid: false };

    case 'all':
      // Empty bounds - filterUniversalRecords()'s startDate/endDate checks are
      // truthy-gated, so '' already means "no bound" with no extra branch.
      // Phase 5B keeps this preset: the phase forbids a SILENT full-history
      // read, not a deliberate one the user selected and can see on screen.
      return { startDate: '', endDate: '', label: 'all', invalid: false };

    case 'week': {
      const r = rollingWindow(today, 7);
      return { ...r, label: rangeLabel(r.startDate, r.endDate), invalid: false };
    }

    case 'last30days': {
      const r = rollingWindow(today, 30);
      return { ...r, label: rangeLabel(r.startDate, r.endDate), invalid: false };
    }

    case 'last90days': {
      const r = rollingWindow(today, 90);
      return { ...r, label: rangeLabel(r.startDate, r.endDate), invalid: false };
    }

    case 'month': {
      const startDate = `${today.slice(0, 4)}-${today.slice(5, 7)}-01`;
      return { startDate, endDate: today, label: rangeLabel(startDate, today), invalid: false };
    }

    case 'prevMonth': {
      // Delegates the true month length to the injected canonical resolver
      // rather than assuming a 30- or 31-day month.
      const year = Number(today.slice(0, 4));
      const month = Number(today.slice(5, 7));
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const r = deps.resolveNamedMonth(prevYear, prevMonth);
      return { ...r, label: rangeLabel(r.startDate, r.endDate), invalid: false };
    }

    case 'namedMonth': {
      if (sel.month && sel.year) {
        const r = deps.resolveNamedMonth(sel.year, sel.month);
        return { ...r, label: rangeLabel(r.startDate, r.endDate), invalid: false };
      }
      break;
    }

    case 'custom': {
      if (isValidCustomRange(sel.startDate, sel.endDate)) {
        const startDate = sel.startDate as string;
        const endDate = sel.endDate as string;
        return { startDate, endDate, label: rangeLabel(startDate, endDate), invalid: false };
      }
      // Incomplete (mid-edit) or INVERTED. Phase 5B: report it as invalid so
      // the caller blocks the query and shows a validation message. The old
      // inline resolver silently substituted the default period here, which
      // showed the user numbers for a period they had not selected.
      return { startDate: '', endDate: '', label: 'invalid', invalid: true };
    }
  }

  // Incomplete namedMonth (no month/year picked yet) - fall back to the real
  // default period rather than an empty (= unbounded) range.
  const fallback = rollingWindow(today, 30);
  return { ...fallback, label: rangeLabel(fallback.startDate, fallback.endDate), invalid: false };
}

export interface DateRangeBounds {
  startDate: string;
  endDate: string;
}

/**
 * Widest range covering every supplied range - used by DashboardBuilderView,
 * whose widgets may each OVERRIDE the dashboard's global time range (and may
 * carry period-vs-period comparison windows). Bounding the single shared
 * fetch to only the GLOBAL range there would silently starve a widget that
 * legitimately asks for a wider one, so the fetch is bounded by the UNION.
 *
 * An empty string on either side means "unbounded on that side" and
 * therefore dominates the union (an ALL_TIME widget forces a full read -
 * correct, and it is the user's own explicit configuration).
 */
export function unionDateRange(ranges: Array<DateRangeBounds | null | undefined>): DateRangeBounds {
  let start: string | null = null;
  let end: string | null = null;
  let startUnbounded = false;
  let endUnbounded = false;

  for (const r of ranges) {
    if (!r) continue;
    if (!r.startDate) startUnbounded = true;
    else if (start === null || r.startDate < start) start = r.startDate;

    if (!r.endDate) endUnbounded = true;
    else if (end === null || r.endDate > end) end = r.endDate;
  }

  return {
    startDate: startUnbounded || start === null ? '' : start,
    endDate: endUnbounded || end === null ? '' : end,
  };
}

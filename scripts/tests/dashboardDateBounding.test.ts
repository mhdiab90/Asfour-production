/**
 * Phase 5B - focused tests for Dashboard / DashboardBuilder date-range
 * bounding.
 *
 * `dashboardPeriodPure.ts` is pure/Firebase-free and injects "today", so
 * every preset is tested against DETERMINISTIC dates rather than the real
 * clock. The two components themselves are React/Firebase-coupled (the same
 * established convention as stageRecordQueryBounds.test.ts /
 * productionQueryBounds.test.ts - there is no mocking framework in this
 * codebase), so their wiring is verified by source inspection: exact
 * string/regex assertions against the committed source confirm the bounded
 * call shape, that no zero-argument fetchUniversalStageRecords() call
 * survives in either component, that existing non-date filters are intact,
 * and that no forbidden file was touched.
 *
 * Run: npx tsx scripts/tests/dashboardDateBounding.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DASHBOARD_DATE_PRESETS,
  DASHBOARD_DEFAULT_DATE_PRESET,
  isValidCustomRange,
  isWellFormedDashboardDate,
  resolveDashboardDateSelection,
  unionDateRange,
  type DashboardPeriodDeps,
} from '../../src/services/dashboardPeriodPure';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf-8');

const DASHBOARD_VIEW = 'src/components/dashboard/DashboardView.tsx';
const BUILDER_VIEW = 'src/components/dashboard/DashboardBuilderView.tsx';
const PURE = 'src/services/dashboardPeriodPure.ts';

const dashboardSource = read(DASHBOARD_VIEW);
const builderSource = read(BUILDER_VIEW);
const pureSource = read(PURE);

/**
 * Strips block comments and whole-line `//` comments. Assertions about what
 * the CODE does must not be satisfiable or breakable by prose: both
 * components legitimately DOCUMENT, in comments, the zero-argument call this
 * phase removed, so a raw-source scan produces a false positive.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const dashboardCode = stripComments(dashboardSource);
const builderCode = stripComments(builderSource);
const pureCode = stripComments(pureSource);

/**
 * Deterministic "today". 2026-03-15 is deliberately mid-March so that
 * "previous month" lands on FEBRUARY - the one month whose length a naive
 * 30/31-day guess gets wrong - and so 90-day/30-day windows both cross a
 * month boundary backwards.
 */
const TODAY = '2026-03-15';

/** Real calendar month resolver, matching what DashboardView injects in production. */
const deps: DashboardPeriodDeps = {
  today: TODAY,
  resolveNamedMonth: (year, month) => {
    const lastDay = new Date(year, month, 0).getDate();
    const p2 = (n: number) => String(n).padStart(2, '0');
    return { startDate: `${year}-${p2(month)}-01`, endDate: `${year}-${p2(month)}-${p2(lastDay)}` };
  },
};

const resolve = (sel: Parameters<typeof resolveDashboardDateSelection>[0]) =>
  resolveDashboardDateSelection(sel, deps);

// ---------------------------------------------------------------------------
// 1. Default period = last 30 days
// ---------------------------------------------------------------------------

test('1a. DASHBOARD_DEFAULT_DATE_PRESET is last30days', () => {
  assert.equal(DASHBOARD_DEFAULT_DATE_PRESET, 'last30days');
});

test('1b. the default preset resolves to a real bounded 30-day window', () => {
  const r = resolve({ preset: DASHBOARD_DEFAULT_DATE_PRESET });
  assert.equal(r.startDate, '2026-02-14');
  assert.equal(r.endDate, TODAY);
  assert.equal(r.invalid, false);
  // Both bounds present is exactly what Phase 4B's isStageQueryCacheEligible requires.
  assert.notEqual(r.startDate, '');
  assert.notEqual(r.endDate, '');
});

test('1c. the default window is inclusive of both endpoints (30 calendar days)', () => {
  const r = resolve({ preset: 'last30days' });
  const days =
    Math.round((new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / 86400000) + 1;
  assert.equal(days, 30);
});

// ---------------------------------------------------------------------------
// 2-7. Every required preset, deterministic
// ---------------------------------------------------------------------------

test('2. Today resolves to a single day', () => {
  const r = resolve({ preset: 'today' });
  assert.deepEqual({ s: r.startDate, e: r.endDate }, { s: TODAY, e: TODAY });
  assert.equal(r.invalid, false);
});

test('3. Last 7 Days resolves to today-6 .. today', () => {
  const r = resolve({ preset: 'week' });
  assert.equal(r.startDate, '2026-03-09');
  assert.equal(r.endDate, TODAY);
});

test('4. Last 30 Days resolves to today-29 .. today', () => {
  const r = resolve({ preset: 'last30days' });
  assert.equal(r.startDate, '2026-02-14');
  assert.equal(r.endDate, TODAY);
});

test('5. Last 90 Days resolves to today-89 .. today', () => {
  const r = resolve({ preset: 'last90days' });
  assert.equal(r.startDate, '2025-12-16');
  assert.equal(r.endDate, TODAY);
  const days =
    Math.round((new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / 86400000) + 1;
  assert.equal(days, 90);
});

test('6. This Month resolves to the 1st .. today (month-to-date)', () => {
  const r = resolve({ preset: 'month' });
  assert.equal(r.startDate, '2026-03-01');
  assert.equal(r.endDate, TODAY);
});

test('7a. Previous Month resolves to the WHOLE previous calendar month', () => {
  const r = resolve({ preset: 'prevMonth' });
  // February 2026 is not a leap year -> 28 days. A hardcoded 30/31 would fail here.
  assert.equal(r.startDate, '2026-02-01');
  assert.equal(r.endDate, '2026-02-28');
});

test('7b. Previous Month handles the January -> December year rollover', () => {
  const r = resolveDashboardDateSelection({ preset: 'prevMonth' }, { ...deps, today: '2026-01-08' });
  assert.equal(r.startDate, '2025-12-01');
  assert.equal(r.endDate, '2025-12-31');
});

test('7c. Previous Month respects a real leap February', () => {
  const r = resolveDashboardDateSelection({ preset: 'prevMonth' }, { ...deps, today: '2028-03-10' });
  assert.equal(r.startDate, '2028-02-01');
  assert.equal(r.endDate, '2028-02-29');
});

// ---------------------------------------------------------------------------
// 8-9. Custom range: valid accepted, inverted rejected
// ---------------------------------------------------------------------------

test('8a. a valid custom range is passed through verbatim', () => {
  const r = resolve({ preset: 'custom', startDate: '2026-01-01', endDate: '2026-01-31' });
  assert.equal(r.startDate, '2026-01-01');
  assert.equal(r.endDate, '2026-01-31');
  assert.equal(r.invalid, false);
});

test('8b. a single-day custom range (start === end) is valid', () => {
  assert.equal(isValidCustomRange('2026-01-05', '2026-01-05'), true);
  assert.equal(resolve({ preset: 'custom', startDate: '2026-01-05', endDate: '2026-01-05' }).invalid, false);
});

test('9a. an INVERTED custom range is rejected, not silently substituted', () => {
  assert.equal(isValidCustomRange('2026-03-31', '2026-03-01'), false);
  const r = resolve({ preset: 'custom', startDate: '2026-03-31', endDate: '2026-03-01' });
  assert.equal(r.invalid, true);
});

test('9b. an inverted range never degrades into a full-history read', () => {
  const r = resolve({ preset: 'custom', startDate: '2026-03-31', endDate: '2026-03-01' });
  // It must be flagged invalid so the caller BLOCKS the query. The empty
  // bounds here are never sent to Firestore precisely because invalid===true.
  assert.equal(r.invalid, true);
  assert.match(
    dashboardSource,
    /if \(resolvedDate\.invalid\) \{\s*setIsLoading\(false\);\s*return;/,
    'DashboardView must return early (no fetch) when the range is invalid'
  );
});

test('9c. an incomplete custom range (mid-edit) is invalid, not defaulted', () => {
  assert.equal(resolve({ preset: 'custom', startDate: '2026-03-01' }).invalid, true);
  assert.equal(resolve({ preset: 'custom', endDate: '2026-03-01' }).invalid, true);
  assert.equal(resolve({ preset: 'custom' }).invalid, true);
});

test('9d. malformed / non-calendar dates are rejected', () => {
  assert.equal(isWellFormedDashboardDate('2026-02-30'), false); // Feb 30 does not exist
  assert.equal(isWellFormedDashboardDate('2026-13-01'), false);
  assert.equal(isWellFormedDashboardDate('26-01-01'), false);
  assert.equal(isWellFormedDashboardDate(''), false);
  assert.equal(isWellFormedDashboardDate(undefined), false);
  assert.equal(isWellFormedDashboardDate('2026-02-28'), true);
  assert.equal(isValidCustomRange('2026-02-30', '2026-03-05'), false);
});

// ---------------------------------------------------------------------------
// 10. DashboardView passes startDate/endDate to fetchUniversalStageRecords
// ---------------------------------------------------------------------------

test('10a. DashboardView calls fetchUniversalStageRecords with resolved bounds', () => {
  assert.match(
    dashboardSource,
    /fetchUniversalStageRecords\(\{ startDate: resolvedDate\.startDate, endDate: resolvedDate\.endDate \}\)/
  );
});

test('10b. DashboardView re-fetches when the resolved period changes', () => {
  assert.match(
    dashboardSource,
    /\}, \[refreshTrigger, resolvedDate\.startDate, resolvedDate\.endDate, resolvedDate\.invalid\]\);/
  );
});

// ---------------------------------------------------------------------------
// 11. DashboardBuilder passes startDate/endDate
// ---------------------------------------------------------------------------

test('11a. DashboardBuilderView calls fetchUniversalStageRecords with resolved bounds', () => {
  assert.match(
    builderSource,
    /fetchUniversalStageRecords\(\{ startDate: range\.startDate, endDate: range\.endDate \}\)/
  );
});

test('11b. DashboardBuilderView defaults to LAST_30_DAYS', () => {
  assert.match(
    builderSource,
    /export const BUILDER_DEFAULT_GLOBAL_FILTERS: GlobalDashboardFilters = \{\s*timeRangePreset: 'LAST_30_DAYS',/
  );
  // The old hardcoded THIS_MONTH fallback must be gone from every call site.
  assert.equal(
    builderSource.includes("{ timeRangePreset: 'THIS_MONTH', stageType: 'all' }"),
    false,
    'the hardcoded THIS_MONTH default must no longer appear'
  );
});

test('11c. DashboardBuilderView re-fetches when the resolved bounds change', () => {
  assert.match(
    builderSource,
    /\}, \[fetchRange\.startDate, fetchRange\.endDate\]\);/
  );
});

// ---------------------------------------------------------------------------
// 12. No zero-argument fetchUniversalStageRecords call remains
// ---------------------------------------------------------------------------

test('12. neither Dashboard component calls fetchUniversalStageRecords()', () => {
  for (const [name, source] of [['DashboardView', dashboardCode], ['DashboardBuilderView', builderCode]] as const) {
    const zeroArg = /fetchUniversalStageRecords\(\s*\)/.exec(source);
    assert.equal(
      zeroArg,
      null,
      `${name} still contains a zero-argument fetchUniversalStageRecords() call: ${zeroArg?.[0]}`
    );
  }
});

test('12b. both components still call the EXISTING service (no duplicated query logic)', () => {
  for (const source of [dashboardSource, builderSource]) {
    assert.match(source, /import \{ fetchUniversalStageRecords \} from '\.\.\/\.\.\/services\/stageRecordService'/);
    // No component may build its own Firestore query or its own cache.
    assert.equal(/from 'firebase\/firestore'/.test(source), false);
    assert.equal(/runCacheFirstRead|buildStageQueryCacheKey|getDocs\(/.test(source), false);
  }
});

// ---------------------------------------------------------------------------
// 13. Existing filters remain preserved
// ---------------------------------------------------------------------------

test('13a. DashboardView keeps every pre-existing non-date filter', () => {
  for (const fragment of [
    'const [stageType, setStageType]',
    'const [shiftId, setShiftId]',
    'const [entityFilters, setEntityFilters]',
    'pressId: entityFilters.pressId',
    'employeeId: entityFilters.employeeId',
    'customerId: entityFilters.customerId',
    'productId: entityFilters.productId',
    'shiftId: shiftId || undefined',
  ]) {
    assert.ok(dashboardSource.includes(fragment), `missing preserved filter: ${fragment}`);
  }
});

test('13b. client-side filtering and KPI aggregation are unchanged', () => {
  assert.match(dashboardSource, /filterUniversalRecords\(records, filters\)|filterUniversalRecords\(/);
  assert.match(dashboardSource, /aggregateByDimension\(/);
  // Only DATE bounds are pushed to Firestore; the other filters keep working
  // client-side exactly as before this phase.
  assert.equal(
    /fetchUniversalStageRecords\(filters\)/.test(dashboardSource),
    false,
    'only the date bounds should be sent to the service from the Dashboard'
  );
});

test('13c. DashboardBuilder keeps its global stage/entity filter model', () => {
  assert.match(builderSource, /GlobalDashboardFilters/);
  assert.match(builderSource, /resolveWidgetFilters/);
  assert.match(builderSource, /stageType: 'all'/);
});

// ---------------------------------------------------------------------------
// 14. Date change triggers a bounded refetch
// ---------------------------------------------------------------------------

test('14a. changing the preset produces DIFFERENT bounds (so the effect refires)', () => {
  const a = resolve({ preset: 'last30days' });
  const b = resolve({ preset: 'last90days' });
  assert.notEqual(a.startDate, b.startDate);
  assert.equal(a.endDate, b.endDate);
});

test('14b. every non-"all" preset yields BOTH bounds (a bounded query)', () => {
  for (const preset of DASHBOARD_DATE_PRESETS) {
    if (preset === 'all' || preset === 'custom' || preset === 'namedMonth') continue;
    const r = resolve({ preset });
    assert.notEqual(r.startDate, '', `${preset} produced no startDate`);
    assert.notEqual(r.endDate, '', `${preset} produced no endDate`);
    assert.equal(r.invalid, false);
  }
});

test('14c. the "all" preset is the ONLY unbounded path, and it is explicit', () => {
  const r = resolve({ preset: 'all' });
  assert.equal(r.startDate, '');
  assert.equal(r.endDate, '');
  assert.equal(r.invalid, false);
  // It must remain a visible, labelled user choice in the UI.
  assert.match(dashboardSource, /'كل الفترات' : 'All Time'/);
});

// ---------------------------------------------------------------------------
// 15. Phase 4B cache eligibility is naturally preserved
// ---------------------------------------------------------------------------

test('15a. default Dashboard bounds satisfy Phase 4B cache eligibility rules', () => {
  const r = resolve({ preset: DASHBOARD_DEFAULT_DATE_PRESET });
  // isStageQueryCacheEligible requires BOTH dates, well-formed, non-inverted.
  assert.equal(isWellFormedDashboardDate(r.startDate), true);
  assert.equal(isWellFormedDashboardDate(r.endDate), true);
  assert.ok(r.startDate <= r.endDate);
});

test('15b. Phase 4A/4B implementation files were NOT modified by this phase', () => {
  const stageService = read('src/services/stageRecordService.ts');
  const boundsPure = read('src/services/stageQueryBoundsPure.ts');
  // Phase 4A server-side bounding still present.
  assert.match(stageService, /where\('date', '>=', bounds\.startDate\)/);
  assert.match(stageService, /where\('date', '<=', bounds\.endDate\)/);
  // Phase 4B cache dispatcher still present.
  assert.match(stageService, /isStageQueryCacheEligible/);
  assert.match(stageService, /runCacheFirstRead</);
  assert.match(boundsPure, /export function buildStageQueryCacheKey/);
  assert.match(boundsPure, /export function isStageQueryCacheEligible/);
});

test('15c. no limit() was introduced anywhere in this phase', () => {
  for (const source of [dashboardCode, builderCode, pureCode]) {
    assert.equal(/\blimit\(/.test(source), false);
  }
});

// ---------------------------------------------------------------------------
// Builder union-range correctness (widget overrides must not be starved)
// ---------------------------------------------------------------------------

test('16a. unionDateRange returns the widest span across ranges', () => {
  const u = unionDateRange([
    { startDate: '2026-02-14', endDate: '2026-03-15' },
    { startDate: '2025-12-01', endDate: '2026-01-31' },
  ]);
  assert.equal(u.startDate, '2025-12-01');
  assert.equal(u.endDate, '2026-03-15');
});

test('16b. an unbounded member dominates the union on that side only', () => {
  const u = unionDateRange([
    { startDate: '2026-02-14', endDate: '2026-03-15' },
    { startDate: '', endDate: '2026-01-31' },
  ]);
  assert.equal(u.startDate, '');
  assert.equal(u.endDate, '2026-03-15');
});

test('16c. null/undefined members are ignored', () => {
  const u = unionDateRange([null, { startDate: '2026-01-01', endDate: '2026-01-31' }, undefined]);
  assert.equal(u.startDate, '2026-01-01');
  assert.equal(u.endDate, '2026-01-31');
});

test('16d. an empty list yields unbounded (never a bogus narrow window)', () => {
  const u = unionDateRange([]);
  assert.equal(u.startDate, '');
  assert.equal(u.endDate, '');
});

test('16e. the builder folds widget overrides AND comparison periods into the fetch range', () => {
  assert.match(builderSource, /if \(widget\.timeRangePreset !== 'inherit'\)/);
  assert.match(builderSource, /widget\.comparePeriods\.startA/);
  assert.match(builderSource, /widget\.comparePeriods\.startB/);
  assert.match(builderSource, /return unionDateRange\(ranges\);/);
});

// ---------------------------------------------------------------------------
// Scope / safety
// ---------------------------------------------------------------------------

test('17a. the pure period module imports nothing at all (Firebase-free)', () => {
  assert.equal(/^\s*import\s/m.test(pureSource), false, 'dashboardPeriodPure.ts must have zero imports');
});

test('17b. no forbidden file is referenced as modified by this phase', () => {
  for (const source of [dashboardSource, builderSource, pureSource]) {
    assert.equal(/firestore\.rules|firestore\.indexes\.json/.test(source), false);
  }
});

test('17c. the AI setDashboardDateFilter contract still resolves against the shared preset list', () => {
  const navTools = read('src/assistant/tools/navigationTools.ts');
  assert.match(navTools, /DASHBOARD_DATE_PRESETS/);
  assert.match(navTools, /from '\.\.\/\.\.\/components\/dashboard\/DashboardView'/);
  // DashboardView must still export the symbols navigationTools.ts imports.
  assert.match(dashboardSource, /export \{ DASHBOARD_DATE_PRESETS, DASHBOARD_DEFAULT_DATE_PRESET, isValidCustomRange \}/);
  assert.match(dashboardSource, /export type \{ DashboardDatePreset, DashboardDateSelection \}/);
  // The two new presets are automatically accepted by the AI validator.
  assert.ok(DASHBOARD_DATE_PRESETS.includes('last90days'));
  assert.ok(DASHBOARD_DATE_PRESETS.includes('prevMonth'));
});

test('17d. the visible period label exists in both languages', () => {
  assert.match(dashboardSource, /'فترة لوحة التحكم:' : 'Dashboard Period:'/);
  assert.match(dashboardSource, /'آخر 30 يوم' : 'Last 30 Days'/);
  assert.match(dashboardSource, /'آخر 90 يوم' : 'Last 90 Days'/);
  assert.match(dashboardSource, /'الشهر السابق' : 'Previous Month'/);
  assert.match(dashboardSource, /'آخر 7 أيام' : 'Last 7 Days'/);
});

// ---------------------------------------------------------------------------
// Phase 5B.1 - the Dashboard Builder's quick-preset bar exposes the previous
// calendar month and the existing ~90-day period. UI exposure only: no new
// preset, no new resolver, no new read/write path.
// ---------------------------------------------------------------------------

const liveControlBarSource = read('src/components/dashboard/LiveControlBar.tsx');
const liveControlBarCode = stripComments(liveControlBarSource);

/** The QUICK_PRESETS array literal as actually declared (comments stripped). */
const quickPresets: string[] = (() => {
  const m = /const QUICK_PRESETS: TimeRangePreset\[\] = \[([^\]]*)\];/.exec(liveControlBarCode);
  assert.ok(m, 'QUICK_PRESETS declaration not found in LiveControlBar.tsx');
  return (m as RegExpExecArray)[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
})();

test('5B.1-1. LAST_MONTH is present in QUICK_PRESETS', () => {
  assert.ok(quickPresets.includes('LAST_MONTH'), `QUICK_PRESETS = ${quickPresets.join(', ')}`);
});

test('5B.1-2. LAST_3_MONTHS is present in QUICK_PRESETS', () => {
  assert.ok(quickPresets.includes('LAST_3_MONTHS'), `QUICK_PRESETS = ${quickPresets.join(', ')}`);
});

test('5B.1-3. Previous Month is visible through the existing label system', () => {
  const registry = read('src/services/dashboardRegistry.ts');
  // The label already existed; this phase adds no new label mechanism.
  assert.match(registry, /LAST_MONTH: \{ ar: 'الشهر الماضي', en: 'Last Month' \}/);
  // The bar renders every QUICK_PRESETS entry via that same label map.
  assert.match(liveControlBarCode, /TIME_RANGE_LABELS\[p\]\.ar : TIME_RANGE_LABELS\[p\]\.en/);
  assert.match(liveControlBarCode, /\{QUICK_PRESETS\.map\(\(p\) => \(/);
});

test('5B.1-4. the existing ~90-day preset is visible and was NOT duplicated', () => {
  const registry = read('src/services/dashboardRegistry.ts');
  assert.match(registry, /LAST_3_MONTHS: \{ ar: 'آخر 3 أشهر', en: 'Last 3 Months' \}/);
  // No competing LAST_90_DAYS preset may have been invented anywhere.
  assert.equal(/LAST_90_DAYS/.test(registry), false, 'a competing LAST_90_DAYS preset was introduced');
  // Scans the stripped CODE: the file legitimately explains in a comment why
  // this preset was deliberately NOT created.
  assert.equal(/LAST_90_DAYS/.test(liveControlBarCode), false, 'a competing LAST_90_DAYS preset was introduced');
});

test('5B.1-5. every pre-existing quick preset is preserved, in order, with only LAST_MONTH added', () => {
  const before = ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_3_MONTHS', 'LAST_6_MONTHS', 'THIS_YEAR', 'ALL_TIME', 'NAMED_MONTH', 'CUSTOM'];
  // Nothing removed, nothing reordered relative to each other.
  assert.deepEqual(quickPresets.filter((p) => p !== 'LAST_MONTH'), before);
  // Exactly one addition.
  assert.equal(quickPresets.length, before.length + 1);
});

test('5B.1-6/7. selecting a preset flows through the existing GlobalDashboardFilters channel', () => {
  // One handler serves EVERY preset button, so LAST_MONTH and LAST_3_MONTHS
  // update global filters by exactly the same path as every existing preset.
  assert.match(liveControlBarCode, /onClick=\{\(\) => onChangeFilters\(\{ timeRangePreset: p \}\)\}/);
  assert.match(liveControlBarCode, /globalFilters\.timeRangePreset === p/);
  // The builder still resolves those presets with the existing resolver only.
  assert.match(builderCode, /resolveTimeRangePreset\(/);
  assert.equal(
    /function resolveTimeRangePreset/.test(liveControlBarCode),
    false,
    'LiveControlBar must not define a second date resolver'
  );
});

test('5B.1-8. no new Firestore read/write/listener path was introduced', () => {
  assert.equal(/from 'firebase\/firestore'/.test(liveControlBarSource), false);
  assert.equal(/getDocs\(|getDoc\(|onSnapshot\(|setDoc\(|writeBatch\(|getCountFromServer\(/.test(liveControlBarCode), false);
  assert.equal(/fetchUniversalStageRecords/.test(liveControlBarCode), false);
  // ALL_TIME behavior untouched.
  assert.ok(quickPresets.includes('ALL_TIME'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

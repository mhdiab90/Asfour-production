/**
 * Phase 5E.3 - focused tests for the Data Review screen's default review
 * period (LAST 30 DAYS) and its explicit ALL TIME escape hatch.
 *
 * The period math is NOT reimplemented here: Data Review reuses the
 * application's existing period vocabulary (services/dashboardPeriodPure.ts,
 * Phase 5B), whose resolver takes "today" as an injected dependency - so
 * every expectation below is deterministic against a fixed reference date
 * rather than the real clock.
 *
 * DataReviewView.tsx itself is React/Firebase-coupled (no test runner or
 * mocking framework exists in this repo - see the sibling suites), so its
 * wiring is verified by source inspection: exact string/regex assertions
 * against the committed source confirm the default preset, that the resolved
 * bounds reach the service, that explicit All Time is the only intentional
 * unbounded path, and that no forbidden module was touched.
 *
 * Run: npx tsx scripts/tests/dataReviewDateDefault.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveDashboardDateSelection,
  isValidCustomRange,
  type DashboardDateSelection,
  type DashboardPeriodDeps,
} from '../../src/services/dashboardPeriodPure';
import { isStageQueryCacheEligible, buildStageQueryCacheKey } from '../../src/services/stageQueryBoundsPure';

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

const VIEW = 'src/components/production/DataReviewView.tsx';
const viewSource = read(VIEW);

/**
 * Strips block comments and whole-line `//` comments. Assertions about what
 * the CODE does must not be satisfiable or breakable by prose - this file
 * legitimately documents the old empty-date behaviour in its comments.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}
const viewCode = stripComments(viewSource);

/** Real calendar month resolver, matching what the component injects. */
const makeDeps = (today: string): DashboardPeriodDeps => ({
  today,
  resolveNamedMonth: (year, month) => {
    const lastDay = new Date(year, month, 0).getDate();
    const p2 = (n: number) => String(n).padStart(2, '0');
    return { startDate: `${year}-${p2(month)}-01`, endDate: `${year}-${p2(month)}-${p2(lastDay)}` };
  },
});

const TODAY = '2026-09-03';
const deps = makeDeps(TODAY);
const resolve = (sel: DashboardDateSelection, today = TODAY) =>
  resolveDashboardDateSelection(sel, makeDeps(today));

// ---------------------------------------------------------------------------
// 1-2. Reference date -> correct Last 30 Days window, and it is the default
// ---------------------------------------------------------------------------

test('1. an injected reference date yields the correct Last 30 Days window', () => {
  const r = resolve({ preset: 'last30days' });
  assert.equal(r.startDate, '2026-08-05');
  assert.equal(r.endDate, TODAY);
  assert.equal(r.invalid, false);
});

test('2a. DataReviewView declares last30days as its default preset', () => {
  assert.match(
    viewCode,
    /export const DATA_REVIEW_DEFAULT_DATE_PRESET: DashboardDatePreset = 'last30days';/
  );
  // ...and the component's initial state actually uses that constant.
  assert.match(
    viewCode,
    /useState<DashboardDateSelection>\(\{\s*preset: DATA_REVIEW_DEFAULT_DATE_PRESET,?\s*\}\)/
  );
});

test('2b. the default state resolves to startDate = last-30-days start, endDate = reference date', () => {
  const r = resolve({ preset: 'last30days' });
  const days =
    Math.round((new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / 86400000) + 1;
  assert.equal(days, 30, 'the window must span 30 calendar days inclusive');
  assert.equal(r.endDate, TODAY);
});

// ---------------------------------------------------------------------------
// 3-5. All Time semantics and switching between presets
// ---------------------------------------------------------------------------

test('3. All Time resolves to empty startDate/endDate (the service\'s existing unbounded semantics)', () => {
  const r = resolve({ preset: 'all' });
  assert.equal(r.startDate, '');
  assert.equal(r.endDate, '');
  assert.equal(r.invalid, false);
  // No fake floor date was substituted.
  assert.equal(/1900-01-01|2000-01-01|1970-01-01/.test(viewCode), false, 'no artificial date floor may be introduced');
});

test('4. selecting All Time does not retain the previous Last-30-Days dates', () => {
  // The selection is replaced wholesale (`setDateSelection({ preset: p })`),
  // so no startDate/endDate can survive from the previous preset.
  const previous = resolve({ preset: 'last30days' });
  assert.notEqual(previous.startDate, '');
  const now = resolve({ preset: 'all' });
  assert.equal(now.startDate, '');
  assert.equal(now.endDate, '');
  assert.match(viewCode, /onClick=\{\(\) => setDateSelection\(\{ preset: p \}\)\}/);
});

test('5. switching from All Time back to Last 30 Days restores the correct range', () => {
  assert.deepEqual(
    { s: resolve({ preset: 'all' }).startDate, e: resolve({ preset: 'all' }).endDate },
    { s: '', e: '' }
  );
  const back = resolve({ preset: 'last30days' });
  assert.equal(back.startDate, '2026-08-05');
  assert.equal(back.endDate, TODAY);
});

// ---------------------------------------------------------------------------
// 6. Manual date range preserved verbatim
// ---------------------------------------------------------------------------

test('6a. a manual custom range is used exactly as entered', () => {
  const r = resolve({ preset: 'custom', startDate: '2025-03-10', endDate: '2025-04-02' });
  assert.equal(r.startDate, '2025-03-10');
  assert.equal(r.endDate, '2025-04-02');
  assert.equal(r.invalid, false);
});

test('6b. editing one date input carries the other end over, so a manual range survives', () => {
  // Both inputs write a complete custom selection - the edited end plus the
  // currently-resolved opposite end - so a manual range is never half-formed
  // and is not overwritten when stage/status filters change.
  assert.match(viewCode, /onChange=\{\(e\) => setDateSelection\(\{ preset: 'custom', startDate: e\.target\.value, endDate \}\)\}/);
  assert.match(viewCode, /onChange=\{\(e\) => setDateSelection\(\{ preset: 'custom', startDate, endDate: e\.target\.value \}\)\}/);
  // The stage/status filter handlers must not touch the date selection, so a
  // manual range survives a stage or status change.
  const stageHandler = /onChange=\{\(e\) => setSelectedStage\([^}]*\}/.exec(viewCode);
  const statusHandler = /onChange=\{\(e\) => setSelectedStatus\([^}]*\}/.exec(viewCode);
  assert.ok(stageHandler, 'stage filter handler not found');
  assert.ok(statusHandler, 'status filter handler not found');
  assert.equal(/setDateSelection/.test((stageHandler as RegExpExecArray)[0]), false);
  assert.equal(/setDateSelection/.test((statusHandler as RegExpExecArray)[0]), false);
});

test('6c. an inverted manual range is rejected, never widened into a full read', () => {
  const r = resolve({ preset: 'custom', startDate: '2025-04-02', endDate: '2025-03-10' });
  assert.equal(r.invalid, true);
  assert.equal(isValidCustomRange('2025-04-02', '2025-03-10'), false);
  // ...and the component refuses to query while invalid.
  assert.match(viewCode, /if \(resolvedDates\.invalid\) \{\s*setIsLoading\(false\);\s*return;/);
});

// ---------------------------------------------------------------------------
// 7-9. Boundary behaviour and determinism
// ---------------------------------------------------------------------------

test('7. leap-year boundary: a 30-day window spanning 29 Feb 2028 is correct', () => {
  const r = resolve({ preset: 'last30days' }, '2028-03-05');
  assert.equal(r.startDate, '2028-02-05');
  assert.equal(r.endDate, '2028-03-05');
  // 2028 is a leap year, so Feb has 29 days: 05 Feb -> 05 Mar inclusive = 30 days.
  const days = Math.round((new Date(r.endDate).getTime() - new Date(r.startDate).getTime()) / 86400000) + 1;
  assert.equal(days, 30);
});

test('8a. month boundary: a window starting in the previous month', () => {
  const r = resolve({ preset: 'last30days' }, '2026-03-01');
  assert.equal(r.startDate, '2026-01-31');
  assert.equal(r.endDate, '2026-03-01');
});

test('8b. year boundary: a window crossing 1 January', () => {
  const r = resolve({ preset: 'last30days' }, '2026-01-10');
  assert.equal(r.startDate, '2025-12-12');
  assert.equal(r.endDate, '2026-01-10');
});

test('9. the default range is deterministic for an injected reference date', () => {
  const a = resolve({ preset: 'last30days' }, '2026-06-15');
  const b = resolve({ preset: 'last30days' }, '2026-06-15');
  assert.deepEqual(a, b);
  assert.equal(a.startDate, '2026-05-17');
});

// ---------------------------------------------------------------------------
// 10-11. The initial load is bounded; All Time is the only unbounded path
// ---------------------------------------------------------------------------

test('10a. the initial load cannot use empty dates - it passes the resolved bounds', () => {
  // The service call receives the resolved values, not raw '' state.
  assert.match(viewCode, /const startDate = resolvedDates\.startDate;/);
  assert.match(viewCode, /const endDate = resolvedDates\.endDate;/);
  assert.match(viewCode, /startDate: startDate \|\| undefined,/);
  assert.match(viewCode, /endDate: endDate \|\| undefined,/);
  // The old always-empty defaults are gone.
  assert.equal(/const \[startDate, setStartDate\] = useState\(''\)/.test(viewCode), false);
  assert.equal(/const \[endDate, setEndDate\] = useState\(''\)/.test(viewCode), false);
});

test('10b. the default preset produces a bounded, cache-eligible query', () => {
  const r = resolve({ preset: 'last30days' });
  const filters = { startDate: r.startDate, endDate: r.endDate, stageType: 'all' as const };
  assert.equal(isStageQueryCacheEligible(filters), true, 'the default must be Phase 4B cache-eligible');
  assert.match(buildStageQueryCacheKey(filters), /^stageRecords::v2::/, 'cache key must remain v2 (Phase 5E.2)');
});

test('11a. explicit All Time is the ONLY preset that yields an unbounded query', () => {
  assert.equal(isStageQueryCacheEligible({ startDate: '', endDate: '' }), false);
  const allTime = resolve({ preset: 'all' });
  assert.equal(isStageQueryCacheEligible({ startDate: allTime.startDate, endDate: allTime.endDate }), false);
  const bounded = resolve({ preset: 'last30days' });
  assert.equal(isStageQueryCacheEligible({ startDate: bounded.startDate, endDate: bounded.endDate }), true);
});

test('11b. All Time is an explicit, clearly labelled control in both languages', () => {
  assert.match(viewCode, /'كل الفترات \(All Time\)'/);
  assert.match(viewCode, /'آخر 30 يوم \(Last 30 Days\)'/);
  // The active scope is stated on screen rather than implied by empty inputs.
  assert.match(viewSource, /فترة المراجعة \(Review Period\)/);
  assert.match(viewSource, /All Time - full history/);
});

test('11c. no limit() and no artificial truncation were introduced', () => {
  assert.equal(/\blimit\(/.test(viewCode), false);
  assert.equal(/\.slice\(0,\s*\d+\)/.test(viewCode), false);
});

// ---------------------------------------------------------------------------
// Scope: nothing outside this phase changed
// ---------------------------------------------------------------------------

test('12a. the existing period vocabulary is REUSED - no second date framework', () => {
  assert.match(viewCode, /from '\.\.\/\.\.\/services\/dashboardPeriodPure'/);
  assert.match(viewCode, /resolveDashboardDateSelection\(dateSelection, \{/);
  // No hand-rolled rolling-window arithmetic in the component.
  assert.equal(/setDate\(.*getDate\(\)\s*-/.test(viewCode), false, 'the component must not recompute date windows itself');
  // "Today" comes from the canonical local-calendar helper, not an ad-hoc UTC
  // conversion. Deliberately targeted at the injected reference date rather
  // than every toISOString() in the file: the Excel export filename at
  // line ~276 has used `new Date().toISOString()` since before this phase and
  // has nothing to do with the query window.
  assert.match(viewCode, /today: todayLocalIso\(\),/);
  assert.equal(
    /today:\s*new Date\(\)/.test(viewCode),
    false,
    'the reference date must come from todayLocalIso(), not an inline Date'
  );
});

test('12b. Phase 5E.2 cache-key contract is untouched by this phase', () => {
  const boundsPure = read('src/services/stageQueryBoundsPure.ts');
  assert.match(boundsPure, /'v2',/);
  assert.match(boundsPure, /`status=\$\{enc\(status\)\}`/);
  // Cache POLICY (eligibility) still requires both dates - unchanged.
  assert.match(boundsPure, /if \(!startDate \|\| !endDate\) return false;/);
});

test('12c. this phase touches no other screen\'s read path', () => {
  // Scoped deliberately to the files THIS release ships. An earlier version
  // of this test also asserted on DataQualityModal / DashboardView /
  // DashboardBuilderView / ReportsView, but those belong to Phase 5B/5C and
  // are not part of this release - so those assertions passed only in a
  // working tree that happened to contain that unreleased work, and failed
  // on a clean checkout. A guard for those screens belongs with the release
  // that ships them, not here.
  //
  // What IS verifiable from inside this release: Data Review reads through
  // the one shared service and adds no read path of its own.
  assert.match(viewCode, /import \{[\s\S]*?fetchUniversalStageRecords[\s\S]*?\} from '\.\.\/\.\.\/services\/stageRecordService'/);
  assert.equal(/fetchProductionRecords/.test(viewCode), false, 'Data Review must not reach into the Pressing-only production reader');
  assert.equal(/collection\(|getDocs\(|onSnapshot\(/.test(viewCode), false, 'Data Review must not build its own Firestore query');
});

test('12d. the component builds no Firestore query and no second cache of its own', () => {
  assert.equal(/from 'firebase\/firestore'/.test(viewSource), false);
  assert.equal(/runCacheFirstRead|buildStageQueryCacheKey|getDocs\(/.test(viewCode), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

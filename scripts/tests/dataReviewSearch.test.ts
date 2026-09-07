/**
 * F-02 - focused tests for the Data Review free-text search.
 *
 * The predicate lives in services/dataReviewSearchPure.ts (Firebase-free and
 * React-free) so it can be exercised directly. DataReviewView.tsx itself
 * cannot be imported by these plain-tsx scripts - it pulls in React and,
 * transitively, the Firebase config that reads import.meta.env - so its
 * wiring is verified by source inspection, the same convention every other
 * suite in this directory uses.
 *
 * Run: npx tsx scripts/tests/dataReviewSearch.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  matchesDataReviewSearch,
  filterDataReviewRecords,
} from '../../src/services/dataReviewSearchPure';

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

const viewSource = read('src/components/production/DataReviewView.tsx');
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}
const viewCode = stripComments(viewSource);

/** Fixtures shaped like real UniversalStageRecord rows. */
const RECORDS = [
  { id: 'r1', productCode: 'BRK-100', productName: 'طوب حراري', customerName: 'شركة الحديد', stageNameAr: 'المكابس' },
  { id: 'r2', productCode: 'MIX-200', productName: 'خلطة أسمنت', customerName: 'مصنع الأسمنت', stageNameAr: 'الخلط' },
  { id: 'r3', productCode: 'srt-300', productName: 'Sorting Batch', customerName: 'ACME Ltd', stageNameAr: 'الفرز' },
  { id: 'r4' }, // every searchable field missing - must never throw
];

// ---------------------------------------------------------------------------
// 1. Empty search -> everything passes through
// ---------------------------------------------------------------------------

test('1a. an empty search returns every record, in the same order', () => {
  const out = filterDataReviewRecords(RECORDS, '');
  assert.equal(out.length, RECORDS.length);
  assert.deepEqual(out.map((r) => r.id), ['r1', 'r2', 'r3', 'r4']);
});

test('1b. undefined/null search behaves as empty', () => {
  assert.equal(filterDataReviewRecords(RECORDS, undefined).length, RECORDS.length);
  assert.equal(filterDataReviewRecords(RECORDS, null).length, RECORDS.length);
});

test('1c. a whitespace-only search behaves as empty', () => {
  assert.equal(filterDataReviewRecords(RECORDS, '   ').length, RECORDS.length);
  assert.equal(matchesDataReviewSearch(RECORDS[0], '   '), true);
});

// ---------------------------------------------------------------------------
// 2. Case-insensitive
// ---------------------------------------------------------------------------

test('2a. matching is case-insensitive on the record side and the query side', () => {
  assert.equal(filterDataReviewRecords(RECORDS, 'SRT-300')[0].id, 'r3');
  assert.equal(filterDataReviewRecords(RECORDS, 'srt-300')[0].id, 'r3');
  assert.equal(filterDataReviewRecords(RECORDS, 'sOrTiNg')[0].id, 'r3');
  assert.equal(filterDataReviewRecords(RECORDS, 'acme')[0].id, 'r3');
});

test('2b. surrounding whitespace in the query is ignored', () => {
  assert.equal(filterDataReviewRecords(RECORDS, '  BRK-100  ')[0].id, 'r1');
});

// ---------------------------------------------------------------------------
// 3. Every searchable field the application defines
// ---------------------------------------------------------------------------

test('3a. matches on productCode', () => {
  assert.deepEqual(filterDataReviewRecords(RECORDS, 'MIX-200').map((r) => r.id), ['r2']);
});

test('3b. matches on productName (Arabic)', () => {
  assert.deepEqual(filterDataReviewRecords(RECORDS, 'طوب').map((r) => r.id), ['r1']);
});

test('3c. matches on customerName (Arabic and Latin)', () => {
  assert.deepEqual(filterDataReviewRecords(RECORDS, 'مصنع').map((r) => r.id), ['r2']);
  assert.deepEqual(filterDataReviewRecords(RECORDS, 'Ltd').map((r) => r.id), ['r3']);
});

test('3d. matches on stageNameAr', () => {
  assert.deepEqual(filterDataReviewRecords(RECORDS, 'الفرز').map((r) => r.id), ['r3']);
});

test('3e. partial substring matches, as the existing service predicate does', () => {
  assert.deepEqual(filterDataReviewRecords(RECORDS, 'BRK').map((r) => r.id), ['r1']);
});

test('3f. the search target matches the service\'s own definition - no invented fields', () => {
  const service = read('src/services/stageRecordService.ts');
  for (const field of ['productCode', 'productName', 'customerName', 'stageNameAr']) {
    assert.match(service, new RegExp(`rec\\.${field}`), `service predicate should reference ${field}`);
  }
  const pure = read('src/services/dataReviewSearchPure.ts');
  for (const field of ['productCode', 'productName', 'customerName', 'stageNameAr']) {
    assert.match(pure, new RegExp(`record\\.${field}`), `pure predicate should reference ${field}`);
  }
  // No field outside that set is consulted.
  const consulted = Array.from(pure.matchAll(/record\.(\w+)/g)).map((m) => m[1]);
  assert.deepEqual(
    Array.from(new Set(consulted)).sort(),
    ['customerName', 'productCode', 'productName', 'stageNameAr']
  );
});

// ---------------------------------------------------------------------------
// 4. Non-matching search
// ---------------------------------------------------------------------------

test('4a. a non-matching term yields zero records', () => {
  assert.deepEqual(filterDataReviewRecords(RECORDS, 'zzzz-no-such-thing'), []);
});

test('4b. records with every searchable field missing never throw and never falsely match', () => {
  assert.equal(matchesDataReviewSearch(RECORDS[3], 'anything'), false);
  assert.equal(matchesDataReviewSearch({}, 'x'), false);
  assert.equal(matchesDataReviewSearch({ productCode: undefined, productName: undefined }, 'x'), false);
  // ...but an empty query still matches them (they belong to the unfiltered set).
  assert.equal(matchesDataReviewSearch(RECORDS[3], ''), true);
});

// ---------------------------------------------------------------------------
// 5 & 8. Search is client-side: no Firestore work per keystroke
// ---------------------------------------------------------------------------

test('5a. the component derives the shown records with useMemo over loaded state', () => {
  assert.match(
    viewCode,
    /const visibleRecords = useMemo\(\s*\(\) => filterDataReviewRecords\(records, searchQuery\),\s*\[records, searchQuery\]\s*\)/
  );
});

test('5b/8. searchQuery reaches NEITHER the Firestore fetch NOR its effect deps', () => {
  // The service call must not carry searchQuery any more...
  assert.equal(
    /searchQuery: searchQuery/.test(viewCode),
    false,
    'searchQuery must not be sent to fetchUniversalStageRecords'
  );
  // ...and the fetch effect must not depend on it, so typing cannot refetch.
  const deps = /\}, \[selectedStage, selectedStatus, startDate, endDate, resolvedDates\.invalid\]\);/.exec(viewCode);
  assert.ok(deps, 'fetch effect dependency array not found in its expected form');
  assert.equal(/searchQuery/.test((deps as RegExpExecArray)[0]), false);
  // The pure module performs no I/O at all.
  const pure = read('src/services/dataReviewSearchPure.ts');
  assert.equal(/firebase|getDocs|onSnapshot|fetch\(/.test(stripComments(pure)), false);
});

// ---------------------------------------------------------------------------
// 6. Existing filters untouched
// ---------------------------------------------------------------------------

test('6a. stage/status/date filters still drive the query exactly as before', () => {
  assert.match(viewCode, /stageType: selectedStage,/);
  assert.match(viewCode, /status: selectedStatus,/);
  assert.match(viewCode, /startDate: startDate \|\| undefined,/);
  assert.match(viewCode, /endDate: endDate \|\| undefined,/);
  // Phase 5E.3 guards still in place.
  assert.match(viewCode, /if \(resolvedDates\.invalid\)/);
  assert.match(viewCode, /DATA_REVIEW_DEFAULT_DATE_PRESET: DashboardDatePreset = 'last30days'/);
});

test('6b. the permission narrowing on load is unchanged', () => {
  assert.match(viewCode, /adminUser\?\.role === 'PRODUCTION_USER'/);
  assert.match(viewCode, /setRecords\(data\.filter\(r => r\.createdBy === adminUser\.uid\)\)/);
});

test('6c. search composes ON TOP of the loaded set rather than replacing it', () => {
  // Only the load path writes `records`; the search never does.
  const writes = Array.from(viewCode.matchAll(/setRecords\(/g));
  assert.equal(writes.length, 2, 'setRecords should only be called by the two load-path branches');
});

// ---------------------------------------------------------------------------
// 7. No mutation of the source array
// ---------------------------------------------------------------------------

test('7a. filtering never mutates or reorders the input array', () => {
  const input = RECORDS.slice();
  const snapshot = JSON.stringify(input);
  const out = filterDataReviewRecords(input, 'BRK');
  assert.equal(JSON.stringify(input), snapshot, 'input array must be untouched');
  assert.equal(input.length, 4);
  assert.equal(out.length, 1);
  assert.notEqual(out, input);
});

test('7b. an empty query returns the SAME array reference (cheap no-op, still not mutated)', () => {
  const input = RECORDS.slice();
  assert.equal(filterDataReviewRecords(input, ''), input);
  assert.equal(input.length, 4);
});

// ---------------------------------------------------------------------------
// Coherence: every consumer shows the same set
// ---------------------------------------------------------------------------

test('9. table, empty-state and Excel export all use the derived list', () => {
  assert.match(viewCode, /\{visibleRecords\.map\(\(rec\) => \(/);
  assert.match(viewCode, /visibleRecords\.length === 0 \?/);
  assert.match(viewCode, /const exportData = visibleRecords\.map\(r => \(\{/);
  // No consumer still renders the unfiltered array.
  assert.equal(/\{records\.map\(/.test(viewCode), false);
  assert.equal(/records\.length === 0 \?/.test(viewCode), false);
});

// ---------------------------------------------------------------------------
// 11-12. Multiple matches, and one term matching different records through
// DIFFERENT fields (the earlier cases each assert a single match).
// ---------------------------------------------------------------------------

const MULTI = [
  { id: 'm1', productCode: 'ALPHA-1', productName: 'طوب', customerName: 'عميل أ', stageNameAr: 'المكابس' },
  { id: 'm2', productCode: 'BETA-2', productName: 'ALPHA brick', customerName: 'عميل ب', stageNameAr: 'الخلط' },
  { id: 'm3', productCode: 'GAMMA-3', productName: 'خلطة', customerName: 'Alpha Trading', stageNameAr: 'الفرز' },
  { id: 'm4', productCode: 'DELTA-4', productName: 'رمل', customerName: 'عميل د', stageNameAr: 'ألفا للطواحين' },
  { id: 'm5', productCode: 'ZETA-5', productName: 'مسحوق', customerName: 'عميل هـ', stageNameAr: 'التجفيف' },
];

test('11. a term matching several records returns ALL of them, order preserved', () => {
  const out = filterDataReviewRecords(MULTI, 'alpha');
  assert.deepEqual(out.map((r) => r.id), ['m1', 'm2', 'm3']);
  assert.equal(out.length, 3, 'must not stop at the first match');
});

test('12a. one term matches different records through DIFFERENT fields', () => {
  // m1 via productCode, m2 via productName, m3 via customerName - a single
  // query resolving across the whole searchable set, not just one field.
  const out = filterDataReviewRecords(MULTI, 'alpha');
  assert.equal(matchesDataReviewSearch(MULTI[0], 'alpha'), true); // productCode
  assert.equal(matchesDataReviewSearch(MULTI[1], 'alpha'), true); // productName
  assert.equal(matchesDataReviewSearch(MULTI[2], 'alpha'), true); // customerName
  assert.equal(matchesDataReviewSearch(MULTI[4], 'alpha'), false);
  assert.equal(out.includes(MULTI[4]), false);
});

test('12b. an Arabic term matches via stageNameAr while Latin terms match other fields', () => {
  assert.deepEqual(filterDataReviewRecords(MULTI, 'ألفا').map((r) => r.id), ['m4']);
  assert.deepEqual(filterDataReviewRecords(MULTI, 'عميل').map((r) => r.id), ['m1', 'm2', 'm4', 'm5']);
});

test('12c. narrowing the term narrows the result set monotonically', () => {
  assert.equal(filterDataReviewRecords(MULTI, 'a').length >= filterDataReviewRecords(MULTI, 'al').length, true);
  assert.deepEqual(filterDataReviewRecords(MULTI, 'alpha-').map((r) => r.id), ['m1']);
});

// ---------------------------------------------------------------------------
// Date-range + search integration (state matrix scenario I): after a
// date-range change reloads `records`, the ACTIVE search must still apply.
// ---------------------------------------------------------------------------

test('13a. re-filtering a newly loaded dataset keeps the active search applied', () => {
  const term = 'alpha';
  const beforeReload = filterDataReviewRecords(MULTI, term);
  assert.equal(beforeReload.length, 3);

  // Simulates a date-range change: `records` is replaced wholesale by the
  // newly bounded dataset while `searchQuery` state is untouched.
  const afterReload = [
    { id: 'n1', productCode: 'ALPHA-9', productName: 'طوب', customerName: 'عميل ز', stageNameAr: 'المكابس' },
    { id: 'n2', productCode: 'OMEGA-9', productName: 'طوب', customerName: 'عميل ح', stageNameAr: 'المكابس' },
  ];
  const out = filterDataReviewRecords(afterReload, term);
  assert.deepEqual(out.map((r) => r.id), ['n1'], 'the search term must still be applied to the new records');
});

test('13b. the memo re-runs on a records change, so the search cannot go stale', () => {
  // `records` is in the dependency array alongside `searchQuery`, so a
  // date-range reload recomputes the visible set with the CURRENT term.
  assert.match(viewCode, /\[records, searchQuery\]/);
  // ...and only the date/stage/status filters can trigger that reload.
  assert.match(viewCode, /\}, \[selectedStage, selectedStatus, startDate, endDate, resolvedDates\.invalid\]\);/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

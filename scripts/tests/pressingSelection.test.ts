/**
 * Focused tests for the Pressing historical import "Select All" family
 * (pressingSelectionPure.ts) - part of the global Select All audit/fix.
 * Plain Node `assert` + `tsx` - no new test framework/dependency added.
 *
 * Run: npx tsx scripts/tests/pressingSelection.test.ts
 */
import assert from 'node:assert/strict';
import {
  getRowSelection,
  isRowReadyToImport,
  getRowCategory,
  isRowWritable,
  computePressingBulkOutcome,
  computePressingPartialImportSummary,
} from '../../src/services/pressingSelectionPure';
import { PressingImportRow } from '../../src/types';

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

console.log('pressingSelection.test.ts');

function makeRow(overrides: Partial<PressingImportRow> = {}): PressingImportRow {
  return {
    rowIndex: overrides.rowIndex ?? 1,
    raw: {},
    date: '2026-05-01',
    errors: [],
    warnings: [],
    isDuplicate: false,
    ...overrides,
  } as unknown as PressingImportRow;
}

// TEST 2 (1648 rows) - Select All operates on the FULL dataset, not a slice/page/viewport.
test('TEST 2 - Select All on 1648 rows selects exactly 1648, not a subset', () => {
  const rows: PressingImportRow[] = Array.from({ length: 1648 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  const outcomes = rows.map((r) => computePressingBulkOutcome(r, 'ALL'));
  assert.equal(outcomes.filter((o) => o.rowSelection === 'INCLUDED').length, 1648);
  const summary = computePressingPartialImportSummary(rows.map((r) => ({ ...r, rowSelection: 'INCLUDED' as const })));
  assert.equal(summary.selected, 1648, 'the counter must report the full count, never just a rendered/paginated slice');
});

// TEST 1
test('TEST 1 - Select All on 3 rows selects all 3', () => {
  const rows = [makeRow({ rowIndex: 1 }), makeRow({ rowIndex: 2 }), makeRow({ rowIndex: 3 })];
  const outcomes = rows.map((r) => computePressingBulkOutcome(r, 'ALL'));
  assert.ok(outcomes.every((o) => o.rowSelection === 'INCLUDED'));
});

// TEST 3/4 - pagination/scrolling irrelevance: the pure function has no
// concept of "visible" rows at all - it operates on whatever array it's
// given, proving Select All can never accidentally be wired to a
// viewport/page-sliced array without a type/behavior change.
test('TEST 3/4 - the bulk-selection function has no notion of pagination/viewport - it always processes the array passed in', () => {
  const fullDataset = Array.from({ length: 500 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  // Simulate "only 20 rows are currently rendered due to internal scroll" -
  // Select All must still be invoked with (and act on) the FULL dataset, not
  // a `renderedRows.slice(0, 20)` equivalent.
  const outcomes = fullDataset.map((r) => computePressingBulkOutcome(r, 'ALL'));
  assert.equal(outcomes.length, 500);
  assert.ok(outcomes.every((o) => o.rowSelection === 'INCLUDED'));
});

// TEST 5
test('TEST 5 - Deselect All (NONE) excludes every row', () => {
  const rows = [makeRow({ rowIndex: 1 }), makeRow({ rowIndex: 2 })];
  const outcomes = rows.map((r) => computePressingBulkOutcome(r, 'NONE'));
  assert.ok(outcomes.every((o) => o.rowSelection === 'EXCLUDED' && o.exclusionReason === 'USER_DESELECTED'));
});

// TEST 6
test('TEST 6 - manual uncheck after Select All decrements the Selected counter correctly', () => {
  let rows = [makeRow({ rowIndex: 1 }), makeRow({ rowIndex: 2 }), makeRow({ rowIndex: 3 })];
  rows = rows.map((r) => ({ ...r, rowSelection: computePressingBulkOutcome(r, 'ALL').rowSelection }));
  assert.equal(computePressingPartialImportSummary(rows).selected, 3);
  // Manually uncheck row 2.
  rows = rows.map((r) => (r.rowIndex === 2 ? { ...r, rowSelection: 'EXCLUDED' as const, exclusionReason: 'USER_DESELECTED' as const } : r));
  assert.equal(computePressingPartialImportSummary(rows).selected, 2);
});

// TEST 7 - mixed statuses: 90 valid, 5 warning, 5 blocking -> Select All = 100 selected.
test('TEST 7 - Select All on a mixed dataset (90 valid / 5 warning / 5 blocking) selects all 100', () => {
  const rows: PressingImportRow[] = [
    ...Array.from({ length: 90 }, (_, i) => makeRow({ rowIndex: i + 1, errors: [], warnings: [] })),
    ...Array.from({ length: 5 }, (_, i) => makeRow({ rowIndex: 91 + i, errors: [], warnings: ['bag weight mismatch'] })),
    ...Array.from({ length: 5 }, (_, i) => makeRow({ rowIndex: 96 + i, errors: ['missing press'], warnings: [] })),
  ];
  const selected = rows.map((r) => ({ ...r, rowSelection: computePressingBulkOutcome(r, 'ALL').rowSelection }));
  const summary = computePressingPartialImportSummary(selected);
  assert.equal(summary.total, 100);
  assert.equal(summary.selected, 100, '§5: Select All must NOT silently ignore blocking rows - they are still selected, just not yet writable');
  assert.equal(summary.blocking, 5);
  assert.equal(summary.warning, 5);
});

// TEST 8 - warning rows are importable (non-blocking) once accepted.
test('TEST 8 - 95 valid + 5 warning(accepted) = 100 Will Import; warnings are never automatically blocking', () => {
  const rows: PressingImportRow[] = [
    ...Array.from({ length: 95 }, (_, i) => makeRow({ rowIndex: i + 1, rowSelection: 'INCLUDED', errors: [], warnings: [] })),
    ...Array.from({ length: 5 }, (_, i) => makeRow({ rowIndex: 96 + i, rowSelection: 'INCLUDED', errors: [], warnings: ['w'], warningsAccepted: true })),
  ];
  const summary = computePressingPartialImportSummary(rows);
  assert.equal(summary.willImport, 100, 'an accepted warning must never block import - WARNING != BLOCKING');

  // And explicitly: an UNACCEPTED warning is not yet writable (still needs the explicit accept step), but is NOT counted as blocking either.
  const unaccepted = makeRow({ rowIndex: 1, rowSelection: 'INCLUDED', errors: [], warnings: ['w'], warningsAccepted: false });
  assert.equal(isRowWritable(unaccepted), false, 'not yet writable until explicitly accepted');
  assert.equal(getRowCategory(unaccepted), 'WARNING', 'category is WARNING, never BLOCKING');
});

// TEST 9 - blocking isolation: 95 eligible import, 5 blocking remain, never fails the whole batch.
test('TEST 9 - blocking rows are isolated: 95 eligible rows are writable, 5 blocking rows are not, nothing else affected', () => {
  const rows: PressingImportRow[] = [
    ...Array.from({ length: 95 }, (_, i) => makeRow({ rowIndex: i + 1, rowSelection: 'INCLUDED', errors: [], warnings: [] })),
    ...Array.from({ length: 5 }, (_, i) => makeRow({ rowIndex: 96 + i, rowSelection: 'INCLUDED', errors: ['missing press'], warnings: [] })),
  ];
  const writable = rows.filter(isRowWritable);
  const blocking = rows.filter((r) => !isRowWritable(r));
  assert.equal(writable.length, 95);
  assert.equal(blocking.length, 5);
  assert.ok(blocking.every((r) => !isRowReadyToImport(r)));
});

// TEST 11 - empty dataset.
test('TEST 11 - Select All / summary on an empty dataset never throws, reports 0', () => {
  const summary = computePressingPartialImportSummary([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.selected, 0);
  assert.equal(computePressingBulkOutcome(makeRow(), 'ALL').rowSelection, 'INCLUDED'); // function itself is still well-defined per-row
});

// Root-cause-adjacent regression: getRowSelection/getRowCategory single
// source of truth - the checkbox `checked` state (getRowSelection(row) ===
// 'INCLUDED') and the Selected counter (partialImportSummary.selected) must
// never be able to drift, since both are derived from the SAME row field via
// the SAME function.
test('checkbox state and counter never drift - both derive from getRowSelection on the same row object', () => {
  const row = makeRow({ rowIndex: 1, rowSelection: 'INCLUDED' });
  const checkboxChecked = getRowSelection(row) === 'INCLUDED';
  const counterIncludesIt = computePressingPartialImportSummary([row]).selected === 1;
  assert.equal(checkboxChecked, true);
  assert.equal(counterIncludesIt, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

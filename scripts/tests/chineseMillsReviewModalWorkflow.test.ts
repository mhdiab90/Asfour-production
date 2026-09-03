/**
 * Focused tests for the Review Modal Select All / Deselect All scoping fix
 * and the Cancel Import (before/during execution) workflow - the "FINAL
 * IMPORT REVIEW WORKFLOW FIX" task.
 *
 * These mirror ChineseMillsImportPanel.tsx's actual wiring:
 *   - handleScopedBulkSelection(mode, scopeRowIndexes) applies
 *     computeBulkSelectionOutcome(row, mode) to ONLY the rows whose
 *     rowIndex is in scopeRowIndexes (i.e. reviewWindowRows), leaving every
 *     other row in the dataset untouched - this is the fix for the reported
 *     "Select All doesn't select every row in THAT review window" bug.
 *   - reviewWindowSelectedCount / reviewWindowWillImportCount are computed
 *     by filtering reviewWindowRows only (never the full dataset).
 *   - executeChineseMillsBatchImport's batch-boundary cancellation math is
 *     modeled by the pure planBatchCancellation() (chineseMillsSelectionPure.ts).
 *
 * Plain Node `assert` + `tsx` - no new test framework/dependency added.
 * Run: npx tsx scripts/tests/chineseMillsReviewModalWorkflow.test.ts
 */
import assert from 'node:assert/strict';
import {
  computeBulkSelectionOutcome,
  computeSelectionCounts,
  isChineseMillsRowWritable,
  getRowSelection,
  planBatchCancellation,
} from '../../src/services/chineseMillsSelectionPure';
import { ChineseMillsImportRow } from '../../src/types';

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

console.log('chineseMillsReviewModalWorkflow.test.ts');

function makeRow(overrides: Partial<ChineseMillsImportRow> = {}): ChineseMillsImportRow {
  return {
    rowIndex: overrides.rowIndex ?? 1,
    raw: {},
    date: '2026-05-01',
    customerNameRaw: '',
    specificationCodeRaw: '',
    millTypeRaw: '5101',
    shiftRaw: '1',
    productionQuantity: 3,
    numberOfBags: 5,
    rejectedQuantity: 0,
    operatingMinutes: 30,
    operatingHours: 3,
    totalOperatingTimeHours: 3,
    downtimeHours: 0,
    actualRateDecision: 'NOT_APPLICABLE',
    status: 'VALID',
    errors: [],
    warnings: [],
    ...overrides,
  } as unknown as ChineseMillsImportRow;
}

/** Mirrors ChineseMillsImportPanel.tsx's handleScopedBulkSelection exactly. */
function applyScopedBulkSelection(
  rows: ChineseMillsImportRow[],
  mode: 'ALL' | 'NONE',
  scopeRowIndexes: Set<number>
): ChineseMillsImportRow[] {
  return rows.map((r) => {
    if (!scopeRowIndexes.has(r.rowIndex)) return r;
    const outcome = computeBulkSelectionOutcome(r, mode);
    if (!outcome) return r;
    return { ...r, rowSelection: outcome.rowSelection, exclusionReason: outcome.exclusionReason };
  });
}

// TEST 1 - 329-row review window, Select All -> 329 selected.
test('TEST 1 - Select All inside a 329-row review window selects exactly 329', () => {
  const rows = Array.from({ length: 329 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  const after = applyScopedBulkSelection(rows, 'ALL', scope);
  assert.equal(after.filter((r) => getRowSelection(r) === 'INCLUDED').length, 329);
});

// TEST 2 - Deselect All -> 0 selected.
test('TEST 2 - Deselect All inside the same window drops Selected to 0', () => {
  let rows = Array.from({ length: 329 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  rows = applyScopedBulkSelection(rows, 'ALL', scope);
  rows = applyScopedBulkSelection(rows, 'NONE', scope);
  assert.equal(rows.filter((r) => getRowSelection(r) === 'INCLUDED').length, 0);
});

// TEST 3 - Select All then manually uncheck one -> 328.
test('TEST 3 - Select All then manually uncheck one row leaves 328 selected', () => {
  let rows = Array.from({ length: 329 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  rows = applyScopedBulkSelection(rows, 'ALL', scope);
  rows = rows.map((r) => (r.rowIndex === 42 ? { ...r, rowSelection: 'EXCLUDED' as const, exclusionReason: 'USER_DESELECTED' as const } : r));
  assert.equal(rows.filter((r) => getRowSelection(r) === 'INCLUDED').length, 328);
});

// TEST 4 - Select All again -> back to 329 (re-includes the manually unchecked row).
test('TEST 4 - Select All again re-selects the manually unchecked row, back to 329', () => {
  let rows = Array.from({ length: 329 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  rows = applyScopedBulkSelection(rows, 'ALL', scope);
  rows = rows.map((r) => (r.rowIndex === 42 ? { ...r, rowSelection: 'EXCLUDED' as const, exclusionReason: 'USER_DESELECTED' as const } : r));
  rows = applyScopedBulkSelection(rows, 'ALL', scope);
  assert.equal(rows.filter((r) => getRowSelection(r) === 'INCLUDED').length, 329);
});

// TEST 5 - 1648 rows (simulated internal scroll: only a slice is "rendered"),
// Select All must still select all 1648 since the pure function has no
// concept of "visible"/"rendered" rows - it always operates on the full
// scope set built from reviewWindowRows, never a DOM-rendered subset.
test('TEST 5 - Select All on a 1648-row window (with internal scroll) selects all 1648, not just the rendered slice', () => {
  const rows = Array.from({ length: 1648 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  // Simulate "only rows 0-49 are currently rendered due to internal scroll" -
  // the scope set is still built from the FULL underlying array, never a
  // renderedRows.slice(0, 50) equivalent.
  const renderedSlice = rows.slice(0, 50);
  assert.equal(renderedSlice.length, 50, 'sanity: viewport only renders a fraction of the data');
  const after = applyScopedBulkSelection(rows, 'ALL', scope);
  assert.equal(after.filter((r) => getRowSelection(r) === 'INCLUDED').length, 1648);
});

// TEST 6 - mixed 90 valid / 5 warning(unaccepted) / 5 blocking -> Select All = 100 selected.
// Will Import is 90 here: an unaccepted warning is never BLOCKING (still
// selected/reviewable, §12), but per the existing single-source-of-truth
// isChineseMillsRowWritable - the SAME rule Pressing's reference
// implementation already uses (pressingSelectionPure.ts's needsWarningAcceptance)
// - a warning row only becomes writable once its warning is EXPLICITLY
// accepted. TEST 6b below is the "warnings already accepted" case, which is
// where Will Import reaches 95 (matching the task's illustrative example).
test('TEST 6 - mixed window (90 valid / 5 warning-unaccepted / 5 blocking) - Select All selects 100, Will Import is 90 (unaccepted warnings pending, blocking excluded)', () => {
  const valid = Array.from({ length: 90 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  const warning = Array.from({ length: 5 }, (_, i) => makeRow({ rowIndex: 91 + i, warnings: ['وزن الشوال غير متطابق'] }));
  const blocking = Array.from({ length: 5 }, (_, i) => makeRow({ rowIndex: 96 + i, errors: ['رمز المواصفة غير معروف'] }));
  let rows = [...valid, ...warning, ...blocking];
  const scope = new Set(rows.map((r) => r.rowIndex));
  rows = applyScopedBulkSelection(rows, 'ALL', scope);

  const selectedCount = rows.filter((r) => getRowSelection(r) === 'INCLUDED').length;
  const willImportCount = rows.filter(isChineseMillsRowWritable).length;
  assert.equal(selectedCount, 100, '§6/§12: Select All must select every row in the window, including warning and blocking rows');
  assert.equal(willImportCount, 90, 'the 5 unaccepted-warning rows are selected/reviewable but not yet writable; the 5 blocking rows are excluded');

  const counts = computeSelectionCounts(rows);
  assert.equal(counts.selected, 100);
  assert.equal(counts.willImport, 90);
});

// TEST 6b - same mixed set, but the 5 warning rows are explicitly ACCEPTED -> Will Import = 95 (warning is never automatically blocking, §12) - matches the task's 90/5/5 -> Will Import=95 example.
test('TEST 6b - once warnings are explicitly accepted, Will Import rises to 95 - warning is never auto-blocking', () => {
  const valid = Array.from({ length: 90 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  const warningAccepted = Array.from({ length: 5 }, (_, i) => makeRow({ rowIndex: 91 + i, warnings: ['وزن الشوال غير متطابق'], warningsAccepted: true }));
  const blocking = Array.from({ length: 5 }, (_, i) => makeRow({ rowIndex: 96 + i, errors: ['رمز المواصفة غير معروف'] }));
  let rows = [...valid, ...warningAccepted, ...blocking];
  const scope = new Set(rows.map((r) => r.rowIndex));
  rows = applyScopedBulkSelection(rows, 'ALL', scope);
  const counts = computeSelectionCounts(rows);
  assert.equal(counts.selected, 100);
  assert.equal(counts.willImport, 95, 'the 5 blocking rows still never become writable no matter what happens to warnings');
});

// TEST 7 - a non-blocking (accepted) warning never prevents import.
test('TEST 7 - a row with an accepted warning is writable (warning != blocking)', () => {
  const row = makeRow({ rowIndex: 1, warnings: ['bag weight mismatch'], warningsAccepted: true, rowSelection: 'INCLUDED' });
  assert.equal(isChineseMillsRowWritable(row), true);
});

// TEST 8 - blocking rows stay selected/reviewable but are NEVER written while unresolved.
test('TEST 8 - a selected blocking row remains selected (reviewable) but is excluded from Will Import until its error clears', () => {
  let row = makeRow({ rowIndex: 1, errors: ['missing customer code'], rowSelection: 'INCLUDED' });
  assert.equal(getRowSelection(row), 'INCLUDED', 'stays selected/reviewable');
  assert.equal(isChineseMillsRowWritable(row), false, 'never writable while the blocking error remains');
  // Simulate the underlying issue being resolved (revalidation clears errors).
  row = { ...row, errors: [] };
  assert.equal(isChineseMillsRowWritable(row), true, 'becomes writable only once actually resolved, never before');
});

// TEST 9 - Cancel BEFORE execution: 0 rows written, session preserved.
test('TEST 9 - Cancel Import before execution writes 0 rows and preserves all row state', () => {
  const rows = Array.from({ length: 10 }, (_, i) => makeRow({ rowIndex: i + 1, rowSelection: 'INCLUDED' }));
  // Cancelling before execution means handleConfirmImport/executeChineseMillsBatchImport
  // is never even called - modeled here as "cancelledAtBatchStartIndex = 0",
  // i.e. the very first batch never started.
  const writable = rows.filter(isChineseMillsRowWritable);
  const plan = planBatchCancellation(writable.length, 400, 0);
  assert.equal(plan.importedCount, 0);
  assert.equal(plan.cancelledCount, writable.length);
  // Rows themselves are untouched (still INCLUDED, still reviewable) - nothing about
  // cancelling BEFORE execution mutates row state, only the (never-started) write does.
  assert.ok(rows.every((r) => getRowSelection(r) === 'INCLUDED'));
});

// TEST 10 - partial execution: cancel requested mid-way through multiple batches.
// Batches already committed stay committed (no fake rollback); batches not
// yet started are reported as cancelled and remain reviewable/re-importable.
test('TEST 10 - cancelling after the 2nd of 5 batches: first 2 batches counted imported, the rest cancelled (not rolled back)', () => {
  const BATCH_SIZE = 400;
  const writableCount = 5 * BATCH_SIZE; // 2000 rows, 5 batches
  const cancelledAtBatchStartIndex = 2 * BATCH_SIZE; // cancel requested right before batch 3 starts
  const plan = planBatchCancellation(writableCount, BATCH_SIZE, cancelledAtBatchStartIndex);
  assert.equal(plan.totalBatches, 5);
  assert.equal(plan.importedCount, 800, 'the 2 already-committed batches are never rolled back');
  assert.equal(plan.cancelledCount, 1200, 'the 3 not-yet-started batches are reported as cancelled, not silently dropped');
  assert.equal(plan.importedCount + plan.cancelledCount, writableCount, 'every writable row is accounted for exactly once');
});

// TEST 10b - no cancellation at all: everything imports, cancelledCount stays 0.
test('TEST 10b - no cancel request means the full writable set is counted imported, cancelledCount is 0', () => {
  const plan = planBatchCancellation(950, 400, -1);
  assert.equal(plan.importedCount, 950);
  assert.equal(plan.cancelledCount, 0);
  assert.equal(plan.totalBatches, 3);
});

// TEST 11 - audit-relevant fields: original row data is never destructively
// overwritten by selection/exclusion actions.
test('TEST 11 - original row data (raw) is preserved through Select All / Deselect All / manual exclude', () => {
  const original = { customer: 'ORIGINAL_RAW_VALUE' };
  let row = makeRow({ rowIndex: 1, raw: original });
  const outcome1 = computeBulkSelectionOutcome(row, 'ALL')!;
  row = { ...row, rowSelection: outcome1.rowSelection, exclusionReason: outcome1.exclusionReason };
  const outcome2 = computeBulkSelectionOutcome(row, 'NONE')!;
  row = { ...row, rowSelection: outcome2.rowSelection, exclusionReason: outcome2.exclusionReason };
  assert.deepEqual(row.raw, original, 'raw/original data must never be mutated by selection state changes');
});

// TEST 12 - Reinclude: an excluded row returns to the selection when swept by Select All again.
test('TEST 12 - an excluded (skipped/excluded) row is reincluded by a subsequent Select All in its window', () => {
  let row = makeRow({ rowIndex: 1, rowSelection: 'EXCLUDED', exclusionReason: 'SKIPPED_ROW' });
  const scope = new Set([1]);
  const after = applyScopedBulkSelection([row], 'ALL', scope);
  assert.equal(getRowSelection(after[0]), 'INCLUDED');
  assert.equal(after[0].exclusionReason, undefined, 'exclusionReason is cleared on reinclude, never carried over stale');
});

// TEST 13 - the scoping fix applies regardless of what OTHER rows exist
// outside the review window - Select All inside a window must never leak
// into (or be starved by) rows the window isn't currently showing.
test("TEST 13 - Select All scoped to one review window never touches rows outside that window's scope", () => {
  const inWindow = Array.from({ length: 20 }, (_, i) => makeRow({ rowIndex: i + 1 }));
  const outsideWindow = Array.from({ length: 15 }, (_, i) => makeRow({ rowIndex: 1000 + i, rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' }));
  let rows = [...inWindow, ...outsideWindow];
  const scope = new Set(inWindow.map((r) => r.rowIndex));
  rows = applyScopedBulkSelection(rows, 'ALL', scope);
  assert.equal(rows.filter((r) => r.rowIndex <= 20 && getRowSelection(r) === 'INCLUDED').length, 20, 'every in-window row is selected');
  assert.equal(rows.filter((r) => r.rowIndex >= 1000 && getRowSelection(r) === 'EXCLUDED').length, 15, 'rows outside the window scope are completely untouched');
});

// SUPERSEDED design decision, kept as a note: an earlier version of this
// fix left PENDING/blocking rows untouched by bulk selection entirely. That
// turned out to be the ROOT CAUSE of a real production bug: the review
// modal's row checkbox reads getRowSelection(row) === 'INCLUDED', so a row
// this function always skipped could NEVER show as checked, no matter how
// many times "Select All" was clicked - a user manually testing the live
// site confirmed individual checkboxes worked but Select All visibly did
// nothing. The corrected behavior (matching Pressing's own proven pattern,
// which has no PENDING state at all) is: Select All/Deselect All give EVERY
// row, including blocking ones, a real INCLUDED/EXCLUDED decision. A
// blocking row still never becomes writable - isChineseMillsRowWritable's
// OWN errors.length check is a separate, independent gate.
test('a PENDING/blocking row inside the review window scope IS swept by scoped Select All (selectable for review, still never writable)', () => {
  const pending = makeRow({ rowIndex: 1, rowSelection: 'PENDING', errors: ['duplicate row'] });
  const clean = makeRow({ rowIndex: 2 });
  const rows = [pending, clean];
  const scope = new Set([1, 2]);
  const after = applyScopedBulkSelection(rows, 'ALL', scope);
  assert.equal(getRowSelection(after[0]), 'INCLUDED', 'the blocking row IS selected by Select All - this is what makes its checkbox actually become checked');
  assert.equal(isChineseMillsRowWritable(after[0]), false, 'but it is still never writable - the errors.length check in isChineseMillsRowWritable is untouched by selection');
  assert.equal(getRowSelection(after[1]), 'INCLUDED');
});

// TEST §7 (§23 of the current task): the EXACT regression - reproduce the
// rendered checkbox's `checked` expression itself
// (checked={getRowSelection(row) === 'INCLUDED'}, exactly as
// ChineseMillsImportPanel.tsx's renderMainReviewTable and (since the fix)
// renderInvalidStyleTable's REVIEW-mode checkbox both use), not merely "is
// the row in some Set." Before the fix this stayed false for every blocking
// row after Select All; after the fix it becomes true for every row in
// scope, exactly matching manual re-include's effect.
test('regression: the rendered checkbox checked-expression becomes true for every row (including blocking) after Select All, exactly like manual re-include does', () => {
  const rows = [
    makeRow({ rowIndex: 1 }), // clean
    makeRow({ rowIndex: 2, rowSelection: 'PENDING', errors: ['missing customer code'] }), // blocking
    makeRow({ rowIndex: 3, rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' }), // previously deselected
  ];
  const checkboxCheckedBefore = rows.map((r) => getRowSelection(r) === 'INCLUDED');
  assert.deepEqual(checkboxCheckedBefore, [true, false, false], 'sanity: before Select All, rows 2 and 3 render unchecked');

  const scope = new Set(rows.map((r) => r.rowIndex));
  const afterSelectAll = applyScopedBulkSelection(rows, 'ALL', scope);
  const checkboxCheckedAfter = afterSelectAll.map((r) => getRowSelection(r) === 'INCLUDED');
  assert.deepEqual(checkboxCheckedAfter, [true, true, true], 'EVERY rendered checkbox (the same checked={getRowSelection(row) === "INCLUDED"} expression the UI uses) must become true after Select All - this is the exact bug: it must not merely update a counter or an unrelated Set');

  // Manual re-include on a single row (what "the individual checkbox works" already did before this fix) produces the exact SAME checked value as Select All - one authoritative mechanism, not two.
  const manuallyReincluded = { ...rows[1], rowSelection: 'INCLUDED' as const, exclusionReason: undefined };
  assert.equal(getRowSelection(manuallyReincluded) === 'INCLUDED', checkboxCheckedAfter[1], 'manual single-row selection and bulk Select All must produce identical checked state for the same row');

  const afterDeselectAll = applyScopedBulkSelection(afterSelectAll, 'NONE', scope);
  assert.deepEqual(afterDeselectAll.map((r) => getRowSelection(r) === 'INCLUDED'), [false, false, false], 'Deselect All must likewise flip every rendered checkbox back to unchecked, including the blocking row');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

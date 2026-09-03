/**
 * Focused tests for the Chinese Mills Simplified Selection + Draft task.
 * Plain Node `assert` + `tsx` - no new test framework/dependency added.
 *
 * Run: npx tsx scripts/tests/chineseMillsSelection.test.ts
 */
import assert from 'node:assert/strict';
import {
  isChineseMillsRowWritable,
  computeBulkSelectionOutcome,
  computeSelectionCounts,
  matchesValid,
  matchesReady,
  matchesCorrected,
  matchesInvalidNeedsReview,
  planImport,
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

console.log('chineseMillsSelection.test.ts');

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
    isDuplicate: false,
    ...overrides,
  } as ChineseMillsImportRow;
}

// §23 fixture: 10 valid rows, 5 blocking (PENDING) rows, 3 excluded rows.
function buildFixture(): ChineseMillsImportRow[] {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 10; i++) rows.push(makeRow({ rowIndex: i, rowSelection: 'INCLUDED' }));
  for (let i = 11; i <= 15; i++) rows.push(makeRow({ rowIndex: i, rowSelection: 'PENDING', errors: ['نوع الطاحونة غير معروف'] }));
  for (let i = 16; i <= 18; i++) rows.push(makeRow({ rowIndex: i, rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' }));
  return rows;
}

// TEST 1: Select All
// ROOT CAUSE FIX (checkbox-state bug): a blocking/PENDING row's review-modal
// checkbox reads getRowSelection(row) === 'INCLUDED' - the OLD behavior of
// leaving PENDING rows untouched meant that checkbox could NEVER become
// checked via Select All, no matter how many times it was clicked. Blocking
// rows must now get a real INCLUDED decision too, exactly like Pressing
// (which has no PENDING state at all) - they simply stay excluded from
// Firestore writes via isChineseMillsRowWritable's OWN errors.length check,
// completely independent of this selection flag.
test('TEST 1 - Select All selects EVERY row including blocking/PENDING ones (they stay non-writable via isChineseMillsRowWritable, never via being skipped here)', () => {
  const rows = buildFixture();
  const outcomes = rows.map((r) => computeBulkSelectionOutcome(r, 'ALL'));
  assert.ok(outcomes.every((o) => o?.rowSelection === 'INCLUDED'), 'every row - including the 5 PENDING/blocking ones - gets an explicit INCLUDED decision');
  const selectedCount = outcomes.filter((o) => o?.rowSelection === 'INCLUDED').length;
  assert.equal(selectedCount, 18, 'all 18 rows (10 already-included + 5 blocking + 3 previously-excluded) become selected');
});

// TEST 2: Deselect All
test('TEST 2 - Deselect All excludes EVERY row including blocking/PENDING ones', () => {
  const rows = buildFixture();
  const outcomes = rows.map((r) => computeBulkSelectionOutcome(r, 'NONE'));
  assert.ok(outcomes.every((o) => o?.rowSelection === 'EXCLUDED' && o.exclusionReason === 'USER_DESELECTED'));
});

// TEST 3: Select Valid
test('TEST 3 - Select Valid selects ONLY error-free, warning-free rows (a blocking row is still given an explicit EXCLUDED decision, never skipped)', () => {
  const rows = [
    makeRow({ rowIndex: 1, errors: [], warnings: [] }), // valid
    makeRow({ rowIndex: 2, errors: [], warnings: ['bag weight mismatch'] }), // has a warning - not "clean valid"
    makeRow({ rowIndex: 3, rowSelection: 'PENDING', errors: ['unknown mill'] }), // blocking - not valid, but still gets a real decision
  ];
  const outcomes = rows.map((r) => computeBulkSelectionOutcome(r, 'VALID'));
  assert.deepEqual(outcomes[0], { rowSelection: 'INCLUDED' });
  assert.deepEqual(outcomes[1], { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' });
  assert.deepEqual(outcomes[2], { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' });
  assert.equal(matchesValid(rows[0]), true);
  assert.equal(matchesValid(rows[1]), false);
});

// TEST 4: Select Ready
test('TEST 4 - Select Ready selects ONLY rows that would be writable if included', () => {
  const rows = [
    makeRow({ rowIndex: 1, errors: [], warnings: [] }), // ready
    makeRow({ rowIndex: 2, errors: [], warnings: ['w'], warningsAccepted: true }), // ready (warning accepted)
    makeRow({ rowIndex: 3, errors: [], warnings: ['w'], warningsAccepted: false }), // NOT ready (unaccepted warning)
    makeRow({ rowIndex: 4, errors: [], proposedMatches: [{ fieldDomain: 'customer', fieldNameAr: '', fieldNameEn: '', importedValue: 'x', confidence: 0, matchType: '', reasonAr: '', reasonEn: '', decision: 'PENDING' }] }), // NOT ready
  ];
  const outcomes = rows.map((r) => computeBulkSelectionOutcome(r, 'READY'));
  assert.deepEqual(outcomes[0], { rowSelection: 'INCLUDED' });
  assert.deepEqual(outcomes[1], { rowSelection: 'INCLUDED' });
  assert.deepEqual(outcomes[2], { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' });
  assert.deepEqual(outcomes[3], { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' });
  assert.equal(matchesReady(rows[0]), true);
  assert.equal(matchesReady(rows[2]), false);
});

// TEST 5: Select Corrected
test('TEST 5 - Select Corrected selects ONLY rows with resolution history', () => {
  const rows = [
    makeRow({ rowIndex: 1, resolutionHistory: [{ timestamp: 't', actor: 'a', action: 'FULL_ROW_EDIT', summary: 's' }] }),
    makeRow({ rowIndex: 2, resolutionHistory: [] }),
    makeRow({ rowIndex: 3 }), // undefined history
  ];
  const outcomes = rows.map((r) => computeBulkSelectionOutcome(r, 'CORRECTED'));
  assert.deepEqual(outcomes[0], { rowSelection: 'INCLUDED' });
  assert.deepEqual(outcomes[1], { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' });
  assert.deepEqual(outcomes[2], { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' });
});

// TEST 6: Select Invalid / Needs Review
test('TEST 6 - matchesInvalidNeedsReview selects ONLY PENDING/unresolved rows, never a clean valid or an already-approved-warning row', () => {
  const pending = makeRow({ rowIndex: 1, rowSelection: 'PENDING', errors: ['e'] });
  const unresolvedWarning = makeRow({ rowIndex: 2, warnings: ['w'], warningsAccepted: false });
  const approvedWarning = makeRow({ rowIndex: 3, warnings: ['w'], warningsAccepted: true });
  const cleanValid = makeRow({ rowIndex: 4 });
  const pendingMatch = makeRow({ rowIndex: 5, proposedMatches: [{ fieldDomain: 'millType', fieldNameAr: '', fieldNameEn: '', importedValue: 'x', confidence: 0, matchType: '', reasonAr: '', reasonEn: '', decision: 'PENDING' }] });

  assert.equal(matchesInvalidNeedsReview(pending), true);
  assert.equal(matchesInvalidNeedsReview(unresolvedWarning), true);
  assert.equal(matchesInvalidNeedsReview(pendingMatch), true);
  // §8: an ALREADY-approved warning must not be reclassified as invalid.
  assert.equal(matchesInvalidNeedsReview(approvedWarning), false);
  assert.equal(matchesInvalidNeedsReview(cleanValid), false);
});

// TEST 7: Valid rows remain importable when invalid rows exist (§18 - the 1000/900/50/50 example)
test('TEST 7 - Invalid rows never block valid rows from being importable', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 900; i++) rows.push(makeRow({ rowIndex: i, rowSelection: 'INCLUDED' })); // valid
  for (let i = 901; i <= 950; i++) rows.push(makeRow({ rowIndex: i, rowSelection: 'INCLUDED', resolutionHistory: [{ timestamp: 't', actor: 'a', action: 'x', summary: 's' }] })); // corrected
  for (let i = 951; i <= 1000; i++) rows.push(makeRow({ rowIndex: i, rowSelection: 'PENDING', errors: ['blocking'] })); // blocking
  const { willImport, willRemain } = planImport(rows);
  assert.equal(willImport.length, 950, 'the 900 valid + 50 corrected rows must all be importable');
  assert.equal(willRemain.length, 50, 'only the 50 blocking rows remain');
  assert.ok(willRemain.every((r) => r.rowSelection === 'PENDING'));
});

// TEST 8: Blocking rows never import
test('TEST 8 - A PENDING row is never in the writable/import set, even if manually flipped to INCLUDED without clearing its errors', () => {
  const stillBroken = makeRow({ rowIndex: 1, rowSelection: 'INCLUDED', errors: ['still broken'] });
  assert.equal(isChineseMillsRowWritable(stillBroken), false);
  const { willImport } = planImport([stillBroken]);
  assert.equal(willImport.length, 0);
});

// TEST 9: Manual correction changes row eligibility after revalidation
test('TEST 9 - Row eligibility flips ONLY after errors clear (simulated revalidation), never silently', () => {
  let row = makeRow({ rowIndex: 1, rowSelection: 'PENDING', errors: ['نوع الطاحونة غير معروف'] });
  assert.equal(matchesInvalidNeedsReview(row), true);
  assert.equal(isChineseMillsRowWritable({ ...row, rowSelection: 'INCLUDED' }), false);
  // Simulated revalidation after a manual fix: errors cleared.
  row = { ...row, errors: [] };
  assert.equal(isChineseMillsRowWritable({ ...row, rowSelection: 'INCLUDED' }), true);
  // A row that is STILL invalid after revalidation must stay blocking (never silently marked valid).
  const stillInvalid = makeRow({ rowIndex: 2, rowSelection: 'PENDING', errors: ['still unknown'] });
  const revalidatedStillBroken = { ...stillInvalid, errors: ['still unknown - after revalidation'] };
  assert.equal(isChineseMillsRowWritable({ ...revalidatedStillBroken, rowSelection: 'INCLUDED' }), false);
});

// §3 counts - never invented, derived from actual row state.
test('computeSelectionCounts matches the §23 fixture exactly (10 valid, 5 invalid/pending, 3 excluded)', () => {
  const rows = buildFixture();
  const counts = computeSelectionCounts(rows);
  assert.equal(counts.total, 18);
  assert.equal(counts.valid, 13, '10 INCLUDED + 3 EXCLUDED rows are all still error/warning-free (valid is independent of selection state)');
  assert.equal(counts.invalidNeedsReview, 5);
  assert.equal(counts.excluded, 3);
  assert.equal(counts.selected, 10);
});

// §11 - Skipped and Will Import counters, previously missing from the top bar.
test('computeSelectionCounts distinguishes Skipped (exclusionReason=SKIPPED_ROW) from plain Excluded, and computes Will Import', () => {
  const rows = [
    makeRow({ rowIndex: 1, rowSelection: 'EXCLUDED', exclusionReason: 'SKIPPED_ROW' }),
    makeRow({ rowIndex: 2, rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' }),
    makeRow({ rowIndex: 3, rowSelection: 'INCLUDED' }), // writable -> will import
    makeRow({ rowIndex: 4, rowSelection: 'PENDING', errors: ['x'] }), // not writable
  ];
  const counts = computeSelectionCounts(rows);
  assert.equal(counts.skipped, 1, 'only the SKIPPED_ROW-reason row counts as Skipped');
  assert.equal(counts.excluded, 2, 'both EXCLUDED rows (skipped or not) count toward the broader Excluded total');
  assert.equal(counts.willImport, 1);
});

// Root-cause regression test: BEFORE the fix, "Select All"/bulk selection only
// mutated row state and never produced anything for a review UI to show -
// this proves the ALL-mode partition (invalid-style vs main-style, used by
// the new review window) is populated correctly and covers every row exactly
// once, so "click Select All -> see nothing" cannot recur silently.
test('TEST 11 (mixed dataset) - "Select All" review-window partition covers every row exactly once, 90 valid / 10 invalid', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 90; i++) rows.push(makeRow({ rowIndex: i, rowSelection: 'INCLUDED' }));
  for (let i = 91; i <= 100; i++) rows.push(makeRow({ rowIndex: i, rowSelection: 'PENDING', errors: ['bad mill'] }));

  // Simulate handleBulkSelection('ALL') then partitioning exactly as the panel's ALL review window does.
  const afterSelectAll = rows.map((r) => {
    const outcome = computeBulkSelectionOutcome(r, 'ALL');
    return outcome ? { ...r, rowSelection: outcome.rowSelection } : r;
  });
  const invalidPart = afterSelectAll.filter(matchesInvalidNeedsReview);
  const mainPart = afterSelectAll.filter((r) => !matchesInvalidNeedsReview(r));

  // Classification (which section a row renders in) is intrinsic
  // (errors.length > 0), NOT derived from rowSelection - so it stays stable
  // at 10/90 even after Select All flips every row's rowSelection to
  // INCLUDED. A blocking row does not "graduate" out of its review section
  // just because it got selected.
  assert.equal(invalidPart.length, 10);
  assert.equal(mainPart.length, 90);
  assert.equal(invalidPart.length + mainPart.length, rows.length, 'every row must appear in exactly one section - nothing dropped, nothing duplicated');

  // Selected count must visibly change (never stay at 0 - §11's explicit rule) and must include the 10 blocking rows too (§10: they may be selected for review, just never written).
  const counts = computeSelectionCounts(afterSelectAll);
  assert.equal(counts.selected, 100, 'Select All selects ALL 100 rows, including the 10 blocking ones - this is exactly what makes their checkbox actually show checked');
  assert.equal(counts.willImport, 90, 'the 10 blocking rows are selected/checked but still never counted as writable - errors.length > 0 still gates isChineseMillsRowWritable regardless of selection');

  // §10 (Select Valid) / independently, Select Invalid on the SAME dataset:
  const invalidOnly = afterSelectAll.filter(matchesInvalidNeedsReview);
  assert.equal(invalidOnly.length, 10, 'Select Invalid must show exactly the 10 blocking rows, independent of the Select All pass');
});

// TEST 13: Reinclude
test('TEST 13 - a Skipped or Excluded row can be re-included and becomes writable again once its underlying issue is gone', () => {
  const skipped = makeRow({ rowIndex: 1, rowSelection: 'EXCLUDED', exclusionReason: 'SKIPPED_ROW', errors: [] });
  const reincluded = { ...skipped, rowSelection: 'INCLUDED' as const, exclusionReason: undefined };
  assert.equal(isChineseMillsRowWritable(reincluded), true);

  const excluded = makeRow({ rowIndex: 2, rowSelection: 'EXCLUDED', exclusionReason: 'EXCLUDED_ROW', errors: [] });
  const reincludedExcluded = { ...excluded, rowSelection: 'INCLUDED' as const, exclusionReason: undefined };
  assert.equal(isChineseMillsRowWritable(reincludedExcluded), true);
});

// Empty-state (§12/§7): a selection mode with zero matches must never be silently
// indistinguishable from "the button did nothing" - the counter itself must
// correctly report 0, and the partition functions must return an empty array
// (never throw/return undefined) so the UI's explicit empty-state message renders.
test('TEST 7 - a selection mode with zero matches yields an empty, well-formed result (not an error, not undefined)', () => {
  const rows = [makeRow({ rowIndex: 1, errors: [], warnings: [] })]; // only a clean valid row - 0 corrected, 0 invalid
  assert.deepEqual(rows.filter(matchesCorrected), []);
  assert.deepEqual(rows.filter(matchesInvalidNeedsReview), []);
  const counts = computeSelectionCounts(rows);
  assert.equal(counts.corrected, 0);
  assert.equal(counts.invalidNeedsReview, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

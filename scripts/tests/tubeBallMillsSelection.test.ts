/**
 * Focused tests for Tube/Ball Mills Historical Import's selection/
 * eligibility logic (tubeBallMillsSelectionPure.ts) - mirrors
 * chineseMillsSelection.test.ts's coverage, adapted to this stage's own
 * fields (Mill/Material/Bunker instead of Customer/MillType/FaultType/
 * Specification).
 *
 * Plain Node `assert` + `tsx` - no new test framework/dependency added.
 * Run: npx tsx scripts/tests/tubeBallMillsSelection.test.ts
 */
import assert from 'node:assert/strict';
import {
  isTubeBallMillsRowWritable,
  isNonOverridableBlockingCondition,
  matchesValid,
  matchesReady,
  matchesCorrected,
  matchesInvalidNeedsReview,
  matchesApproved,
  matchesReadyToImport,
  computeBulkSelectionOutcome,
  computeSelectionCounts,
  canMarkReadyToImport,
  computeMarkReadyPatch,
  getRowSelection,
  planImport,
} from '../../src/services/tubeBallMillsSelectionPure';
import { planBatchCancellation } from '../../src/services/chineseMillsSelectionPure';
import { TubeBallMillsImportRow } from '../../src/types';

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

console.log('tubeBallMillsSelection.test.ts');

function makeRow(overrides: Partial<TubeBallMillsImportRow> = {}): TubeBallMillsImportRow {
  return {
    rowIndex: overrides.rowIndex ?? 1,
    raw: {},
    date: '2026-05-01',
    millTypeRaw: 'طاحونة 1',
    resolvedMillId: 'mill-1',
    materialTypeRaw: 'جريت',
    isMixture: false,
    resolvedMaterialId: 'mat-1',
    operatingHours: 8,
    tonsPerHour: 12.5,
    totalTons: 100,
    storageBunkersRaw: '54',
    bunkerAllocations: [{ bunkerRaw: '54', resolvedBunkerId: 'bunker-1', allocatedTons: 100 }],
    bunkerAllocationValid: true,
    status: 'VALID',
    errors: [],
    warnings: [],
    isDuplicate: false,
    ...overrides,
  } as unknown as TubeBallMillsImportRow;
}

// TEST 1 - all valid.
test('TEST 1 - a clean row is VALID, writable once selected, and never blocking', () => {
  const row = makeRow();
  assert.equal(matchesValid(row), true);
  assert.equal(isTubeBallMillsRowWritable(row), true);
  assert.equal(isNonOverridableBlockingCondition(row), false);
});

// TEST 18/19 - optional vs required field validation, matching the EXISTING
// generic import schema (productionStageConfig.ts's tube_ball_mills entry:
// only `totalTons` is required: true; Mill/Material/Hours/TonsPerHour/
// Bunker are all required: false) - never guessed, reused verbatim.
test('TEST 18 - a blank Mill Type is OPTIONAL (required: false in the existing schema) - not an error, not blocking at all', () => {
  const row = makeRow({ millTypeRaw: '', resolvedMillId: undefined, errors: [] });
  assert.equal(isNonOverridableBlockingCondition(row), false);
  assert.equal(isTubeBallMillsRowWritable(row), true, 'a blank optional field never prevents writability on its own');
});

test('TEST 19 - Total is the ONE required field (required: true in the existing schema) - a non-positive value stays a non-overridable BLOCKING condition, row stays blocked until corrected/excluded/skipped', () => {
  const row = makeRow({ totalTons: 0, errors: ['الإجمالي غير صالح.'] });
  assert.equal(isNonOverridableBlockingCondition(row), true);
});

test('an invalid date is a non-overridable BLOCKING condition', () => {
  const row = makeRow({ status: 'INVALID_DATE', errors: ['التاريخ غير صالح.'] });
  assert.equal(isNonOverridableBlockingCondition(row), true);
});

test('a duplicate-in-file row is a non-overridable BLOCKING condition (never double-count real production)', () => {
  const row = makeRow({ duplicateType: 'FILE', errors: ['صف مكرر داخل نفس الملف.'] });
  assert.equal(isNonOverridableBlockingCondition(row), true);
});

// TEST 13 - invalid bunker allocation is a hard block, never overridable.
test('TEST 13 - an invalid bunker allocation (sum != Total) is a non-overridable BLOCKING condition - approval can never write inconsistent tonnage', () => {
  const row = makeRow({
    bunkerAllocations: [{ bunkerRaw: '54', allocatedTons: 100 }, { bunkerRaw: '65', allocatedTons: 100 }, { bunkerRaw: '66', allocatedTons: 80 }],
    bunkerAllocationValid: false,
    errors: ['توزيع البناكر لا يساوي الإجمالي.'],
  });
  assert.equal(isNonOverridableBlockingCondition(row), true);
  assert.equal(isTubeBallMillsRowWritable({ ...row, approved: true }), false);
});

// TEST 3/TEST 5 - unknown mill/material is OVERRIDABLE (a master-data-match miss, not structural).
test('TEST 3/5 - an unresolved Mill or Material is OVERRIDABLE (a master-data-match miss, unlike the structural rules above)', () => {
  const unknownMill = makeRow({ status: 'UNKNOWN_MILL', resolvedMillId: undefined, errors: ['نوع الطاحونة "X" غير معروف - يتطلب مراجعة.'] });
  assert.equal(isNonOverridableBlockingCondition(unknownMill), false);
  const unknownMaterial = makeRow({ status: 'UNKNOWN_MATERIAL', resolvedMaterialId: undefined, errors: ['الخامة "X" غير معروفة - يتطلب مراجعة.'] });
  assert.equal(isNonOverridableBlockingCondition(unknownMaterial), false);
});

// TEST 4 - selecting an existing mill makes the row ready.
test('TEST 4 - resolving Unknown Mill to an existing Master Data mill and approving makes the row writable', () => {
  const row = makeRow({ status: 'UNKNOWN_MILL', errors: ['نوع الطاحونة "X" غير معروف.'] });
  assert.equal(isTubeBallMillsRowWritable(row), false);
  const resolved = { ...row, resolvedMillId: 'mill-9', approved: true, approvedBy: 'admin', approvalMethod: 'INDIVIDUAL' as const };
  assert.equal(isTubeBallMillsRowWritable(resolved), true, 'approved + overridable-only errors -> writable, exactly like Chinese Mills');
});

// TEST 25 - warning does not block.
test('WARNING remains distinct from BLOCKING - an unaccepted warning blocks writability but is never counted as a structural block, and accepting it (not "approving") is enough', () => {
  const row = makeRow({ warnings: ['فرق ملحوظ بين الطن بالساعة المصرح به والمحسوب.'], warningsAccepted: false });
  assert.equal(isTubeBallMillsRowWritable(row), false);
  assert.equal(row.errors.length, 0, 'a warning never becomes an error');
  const accepted = { ...row, warningsAccepted: true };
  assert.equal(isTubeBallMillsRowWritable(accepted), true);
});

// TEST 2 - mixed file, partial import.
test('TEST 2 - 90 valid + 10 blocking: selecting only the 90 valid rows imports exactly 90, the 10 remain reviewable', () => {
  const rows: TubeBallMillsImportRow[] = [];
  for (let i = 1; i <= 90; i++) rows.push(makeRow({ rowIndex: i }));
  for (let i = 91; i <= 100; i++) rows.push(makeRow({ rowIndex: i, millTypeRaw: '', errors: ['نوع الطاحونة مفقود.'], rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' }));
  const { willImport, willRemain } = planImport(rows);
  assert.equal(willImport.length, 90);
  assert.equal(willRemain.length, 10);
});

// TEST 14/15 - Select All / Deselect All, including blocking rows (never skipped, matching the ROOT-CAUSE fix pattern from the Review Modal task).
test('TEST 14/15 - Select All selects EVERY row (blocking included, they just stay non-writable); Deselect All excludes every row', () => {
  const rows = [makeRow({ rowIndex: 1 }), makeRow({ rowIndex: 2, millTypeRaw: '', errors: ['x'] })];
  const afterSelectAll = rows.map((r) => ({ ...r, ...computeBulkSelectionOutcome(r, 'ALL') }));
  assert.ok(afterSelectAll.every((r) => getRowSelection(r) === 'INCLUDED'));
  const afterDeselectAll = afterSelectAll.map((r) => ({ ...r, ...computeBulkSelectionOutcome(r, 'NONE') }));
  assert.ok(afterDeselectAll.every((r) => getRowSelection(r) === 'EXCLUDED'));
});

// TEST 20 - unselect a valid row.
test('TEST 20 - deselecting a valid row means it is never imported, even though it would otherwise be writable', () => {
  const row = makeRow({ rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' });
  assert.equal(isTubeBallMillsRowWritable(row), false);
});

// TEST 21 - reinclude.
test('TEST 21 - a previously excluded row becomes eligible again once reincluded (rowSelection back to INCLUDED)', () => {
  const excluded = makeRow({ rowSelection: 'EXCLUDED', exclusionReason: 'EXCLUDED_ROW' });
  const reincluded = { ...excluded, rowSelection: 'INCLUDED' as const, exclusionReason: undefined };
  assert.equal(isTubeBallMillsRowWritable(reincluded), true);
});

// Ready-to-Import: individual/selected/all, mirroring the Global Ready-to-Import Override task exactly.
test('TEST 32 (Ready-to-Import) - a blocking-but-overridable row can be marked Ready, which implicitly approves it, validationStatus untouched', () => {
  const row = makeRow({ status: 'UNKNOWN_MATERIAL', resolvedMaterialId: undefined, errors: ['الخامة غير معروفة.'] });
  assert.equal(canMarkReadyToImport(row), true);
  const patch = computeMarkReadyPatch(row);
  const after = { ...row, ...patch, readyToImport: true };
  assert.equal(after.status, row.status, 'validationStatus (status) is NEVER touched by marking ready');
  assert.equal(after.approved, true);
  assert.equal(isTubeBallMillsRowWritable(after), true);
});

test('a non-overridable row can never be marked Ready to Import', () => {
  const row = makeRow({ totalTons: 0, errors: ['الإجمالي غير صالح.'] });
  assert.equal(canMarkReadyToImport(row), false);
});

// Bulk counts sanity, mirroring the 5000-row example in §6 of the task.
test('computeSelectionCounts reflects a large mixed dataset correctly (500 valid, 300 warning-unaccepted, 200 blocking)', () => {
  const rows: TubeBallMillsImportRow[] = [];
  for (let i = 1; i <= 500; i++) rows.push(makeRow({ rowIndex: i }));
  for (let i = 501; i <= 800; i++) rows.push(makeRow({ rowIndex: i, warnings: ['w'], warningsAccepted: false }));
  for (let i = 801; i <= 1000; i++) rows.push(makeRow({ rowIndex: i, totalTons: 0, errors: ['x'] }));
  const counts = computeSelectionCounts(rows);
  assert.equal(counts.total, 1000);
  assert.equal(counts.valid, 500);
  assert.equal(counts.warning, 300);
  assert.equal(counts.blocking, 200);
  assert.equal(counts.willImport, 500, 'only the clean valid rows are writable as-is - warnings unaccepted and blocking rows are excluded');
});

// Reused, not duplicated: planBatchCancellation comes from chineseMillsSelectionPure.ts directly.
test('planBatchCancellation (Cancel Entire Import) is reused verbatim from chineseMillsSelectionPure - no second implementation', () => {
  const result = planBatchCancellation(1000, 400, 400);
  assert.equal(result.importedCount, 400);
  assert.equal(result.cancelledCount, 600);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

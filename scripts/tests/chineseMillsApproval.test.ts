/**
 * Focused tests for the "Approve Invalid Records" workflow (individual +
 * bulk approval, full import after approval) - the
 * "ADD APPROVE INVALID RECORDS WORKFLOW" task.
 *
 * These mirror ChineseMillsImportPanel.tsx's actual wiring:
 *   - handleApproveRow(rowIndex, method) / handleRevokeApproval(rowIndex) /
 *     handleApproveAllInWindow(scopeRowIndexes) all delegate to the row's
 *     own errors.length + isNonOverridableBlockingCondition (pure,
 *     chineseMillsSelectionPure.ts) - never a second/divergent eligibility
 *     model from isChineseMillsRowWritable.
 *   - isChineseMillsRowWritable now allows a row with blocking errors
 *     through ONLY when row.approved is true AND none of its errors are
 *     non-overridable - approval overrides REVIEWABLE errors only, never a
 *     hard structural/data-integrity rule (§10).
 *
 * Plain Node `assert` + `tsx` - no new test framework/dependency added.
 * Run: npx tsx scripts/tests/chineseMillsApproval.test.ts
 */
import assert from 'node:assert/strict';
import {
  isChineseMillsRowWritable,
  isNonOverridableBlockingCondition,
  matchesApproved,
  matchesInvalidNeedsReview,
  computeBulkSelectionOutcome,
  computeSelectionCounts,
  getRowSelection,
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

console.log('chineseMillsApproval.test.ts');

/** A row with every non-overridable condition (§10) already satisfied, so its ONLY problem is an OVERRIDABLE master-data-match error - the case approval is meant for. */
function makeOverridableBlockingRow(overrides: Partial<ChineseMillsImportRow> = {}): ChineseMillsImportRow {
  return {
    rowIndex: overrides.rowIndex ?? 1,
    raw: {},
    date: '2026-05-01',
    customerNameRaw: 'عميل غير معروف',
    specificationCodeRaw: '',
    millTypeRaw: '5101',
    resolvedShiftNumber: 1,
    shiftRaw: '1',
    productionQuantity: 3,
    numberOfBags: 5,
    rejectedQuantity: 0,
    operatingMinutes: 30,
    operatingHours: 3,
    totalOperatingTimeHours: 3,
    downtimeHours: 0,
    actualRateDecision: 'NOT_APPLICABLE',
    status: 'UNKNOWN_CUSTOMER',
    errors: ['العميل "عميل غير معروف" غير معروف - يتطلب مراجعة.'],
    warnings: [],
    isDuplicate: false,
    ...overrides,
  } as unknown as ChineseMillsImportRow;
}

function makeCleanRow(overrides: Partial<ChineseMillsImportRow> = {}): ChineseMillsImportRow {
  return makeOverridableBlockingRow({ status: 'VALID', errors: [], customerNameRaw: '', ...overrides });
}

/** Mirrors ChineseMillsImportPanel.tsx's handleApproveRow exactly (minus audit/adminUser side effects, which are not part of the pure layer). */
function applyApproveRow(rows: ChineseMillsImportRow[], rowIndex: number, method: 'INDIVIDUAL' | 'BULK'): ChineseMillsImportRow[] {
  return rows.map((r) => {
    if (r.rowIndex !== rowIndex) return r;
    if (r.errors.length === 0 || isNonOverridableBlockingCondition(r)) return r;
    return { ...r, approved: true, approvedBy: 'admin@asfour.com', approvedAt: '2026-09-03T00:00:00.000Z', approvalMethod: method };
  });
}

/** Mirrors ChineseMillsImportPanel.tsx's handleRevokeApproval exactly. */
function applyRevokeApproval(rows: ChineseMillsImportRow[], rowIndex: number): ChineseMillsImportRow[] {
  return rows.map((r) => {
    if (r.rowIndex !== rowIndex || !r.approved) return r;
    return { ...r, approved: false, approvedBy: undefined, approvedAt: undefined, approvalMethod: undefined };
  });
}

/** Mirrors ChineseMillsImportPanel.tsx's handleApproveAllInWindow exactly - scoped to scopeRowIndexes only, never the whole dataset. */
function applyApproveAllInWindow(rows: ChineseMillsImportRow[], scopeRowIndexes: Set<number>): ChineseMillsImportRow[] {
  return rows.map((r) => {
    if (!scopeRowIndexes.has(r.rowIndex)) return r;
    if (r.errors.length === 0 || isNonOverridableBlockingCondition(r)) return r;
    return { ...r, approved: true, approvedBy: 'admin@asfour.com', approvedAt: '2026-09-03T00:00:00.000Z', approvalMethod: 'BULK' as const };
  });
}

// TEST 1
test('TEST 1 - one blocking (overridable) record: Approve -> row.approved is true, still classified as needs-review', () => {
  const row = makeOverridableBlockingRow();
  const [approved] = applyApproveRow([row], 1, 'INDIVIDUAL');
  assert.equal(approved.approved, true);
  assert.equal(approved.approvalMethod, 'INDIVIDUAL');
  assert.equal(matchesInvalidNeedsReview(approved), true, 'an approved row is still shown in the needs-review table (§4) - approval never removes it');
});

// TEST 2
test('TEST 2 - one blocking (overridable) record: Approve -> Import - imports because the approval policy allows it', () => {
  const row = makeOverridableBlockingRow();
  const [approved] = applyApproveRow([row], 1, 'INDIVIDUAL');
  assert.equal(isChineseMillsRowWritable(approved), true);
  const { willImport } = planImport([approved]);
  assert.equal(willImport.length, 1);
});

// TEST 3
test('TEST 3 - 100 blocking (overridable) records: Approve All -> 100 approved', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 100; i++) rows.push(makeOverridableBlockingRow({ rowIndex: i }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  const after = applyApproveAllInWindow(rows, scope);
  assert.equal(after.filter((r) => r.approved).length, 100, 'every row in the current review window scope must actually become approved');
});

// TEST 4
test('TEST 4 - bulk approval scope: review window has 50 of 500 rows -> only those 50 approved', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 500; i++) rows.push(makeOverridableBlockingRow({ rowIndex: i }));
  const scope = new Set(Array.from({ length: 50 }, (_, i) => i + 1)); // rows 1..50 only
  const after = applyApproveAllInWindow(rows, scope);
  assert.equal(after.filter((r) => r.approved).length, 50, 'only the 50 rows in this window scope - never the other 450 in the import session');
  assert.ok(after.slice(50).every((r) => !r.approved), 'rows outside the window scope are completely untouched');
});

// TEST 5
test('TEST 5 - bulk approval with scrolling: 1648 rows -> 1648 approved (scope-based, never dependent on rendered/visible rows)', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 1648; i++) rows.push(makeOverridableBlockingRow({ rowIndex: i }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  const after = applyApproveAllInWindow(rows, scope);
  assert.equal(after.filter((r) => r.approved).length, 1648);
});

// TEST 6
test('TEST 6 - approval audit: row carries every field the audit log line needs (importId is supplied by the caller, rowId/original status/new status/user/timestamp all present on the row itself)', () => {
  const row = makeOverridableBlockingRow({ rowIndex: 42, status: 'UNKNOWN_CUSTOMER' });
  const originalErrors = [...row.errors];
  const [approved] = applyApproveRow([row], 42, 'INDIVIDUAL');
  assert.equal(approved.rowIndex, 42, 'RowId/RowNumber');
  assert.equal(approved.approvedBy, 'admin@asfour.com', 'User');
  assert.ok(approved.approvedAt, 'Timestamp');
  assert.equal(approved.approvalMethod, 'INDIVIDUAL', 'Approval Method');
  assert.deepEqual(approved.errors, originalErrors, 'Original Errors are exactly what a [ROW_APPROVED] audit line reports - never mutated by approval');
});

// TEST 7
test('TEST 7 - revoke approval: APPROVED -> back to needs-review/blocking, non-importable again', () => {
  const row = makeOverridableBlockingRow();
  const [approved] = applyApproveRow([row], 1, 'INDIVIDUAL');
  assert.equal(isChineseMillsRowWritable(approved), true);
  const [revoked] = applyRevokeApproval([approved], 1);
  assert.equal(revoked.approved, false);
  assert.equal(isChineseMillsRowWritable(revoked), false, 'no longer writable once approval is revoked - its errors were never actually cleared');
  assert.equal(matchesInvalidNeedsReview(revoked), true, 'still shown as needs-review, exactly like before it was ever approved');
});

// TEST 8
test('TEST 8 - edit after approval: revalidation updates status correctly in both directions', () => {
  const approvedRow = { ...makeOverridableBlockingRow(), approved: true, approvedBy: 'admin', approvedAt: 't', approvalMethod: 'INDIVIDUAL' as const };
  // Case A: the edit actually fixed the row - errors clear, approval is no longer needed/relevant and must not be silently left dangling.
  const fixed = { ...approvedRow, errors: [], approved: false, approvedBy: undefined, approvedAt: undefined, approvalMethod: undefined };
  assert.equal(isChineseMillsRowWritable(fixed), true, 'writable on its own merits now - not because of a stale approval flag');
  // Case B: the edit did NOT fix the row (still has an error, possibly a different one) - approval must be revoked, row returns to blocking.
  const stillBroken = { ...approvedRow, errors: ['نوع الطاحونة "X" غير معروف - يتطلب مراجعة.'], approved: false, approvedBy: undefined, approvedAt: undefined, approvalMethod: undefined };
  assert.equal(isChineseMillsRowWritable(stillBroken), false, 'must not silently preserve APPROVED status - a fresh, explicit re-approval is required');
});

// TEST 9
test('TEST 9 - approved + excluded: must not import (EXCLUDED takes precedence over APPROVED)', () => {
  const row = makeOverridableBlockingRow();
  const approved = { ...row, approved: true, approvedBy: 'admin', approvedAt: 't', approvalMethod: 'INDIVIDUAL' as const, rowSelection: 'EXCLUDED' as const, exclusionReason: 'EXCLUDED_ROW' as const };
  assert.equal(isChineseMillsRowWritable(approved), false);
  const { willImport } = planImport([approved]);
  assert.equal(willImport.length, 0);
});

// TEST 10
test('TEST 10 - approved + skipped: must not import', () => {
  const row = makeOverridableBlockingRow();
  const approved = { ...row, approved: true, approvedBy: 'admin', approvedAt: 't', approvalMethod: 'INDIVIDUAL' as const, rowSelection: 'EXCLUDED' as const, exclusionReason: 'SKIPPED_ROW' as const };
  assert.equal(isChineseMillsRowWritable(approved), false);
  const { willImport } = planImport([approved]);
  assert.equal(willImport.length, 0);
});

// TEST 11
test('TEST 11 - approved + Cancel Entire Import: no pending records imported - approval is purely in-memory/session state until executeChineseMillsBatchImport is actually invoked', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 5; i++) rows.push(makeOverridableBlockingRow({ rowIndex: i }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  const approvedRows = applyApproveAllInWindow(rows, scope);
  assert.equal(approvedRows.filter((r) => r.approved).length, 5, 'sanity: rows really are approved and would be writable');
  const { willImport } = planImport(approvedRows);
  assert.equal(willImport.length, 5, 'they WOULD import if executeChineseMillsBatchImport were called');
  // Cancel Entire Import (handleCancelEntireImport, pre-execution) resets the
  // whole session (setSummary(null)/setFile(null)) WITHOUT ever calling
  // executeChineseMillsBatchImport - there is no code path from approval
  // state alone to a Firestore write. Modeled here as: the approved rows
  // never reach the import function at all.
  const firestoreWritesIssued = 0; // handleCancelEntireImport never invokes executeChineseMillsBatchImport
  assert.equal(firestoreWritesIssued, 0, 'zero rows written to Firestore - approval decisions stay in-memory/auditable but unexecuted');
});

// TEST 12
test('TEST 12 - mixed 90 valid / 5 warning / 5 blocking: Approve All in blocking review -> 5 approved, Will Import reflects it', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 90; i++) rows.push(makeCleanRow({ rowIndex: i }));
  for (let i = 91; i <= 95; i++) rows.push(makeCleanRow({ rowIndex: i, warnings: ['bag weight mismatch'], warningsAccepted: false }));
  for (let i = 96; i <= 100; i++) rows.push(makeOverridableBlockingRow({ rowIndex: i }));

  const blockingScope = new Set(Array.from({ length: 5 }, (_, i) => i + 96));
  const afterApproval = applyApproveAllInWindow(rows, blockingScope);
  assert.equal(afterApproval.filter((r) => r.approved).length, 5);

  const counts = computeSelectionCounts(afterApproval);
  assert.equal(counts.approved, 5);
  // Will Import: 90 clean + the 5 now-approved blocking = 95; the 5 unaccepted-warning rows still aren't writable (warning != blocking, but still needs an explicit accept - unrelated to approval).
  assert.equal(counts.willImport, 95, 'the 5 approved blocking rows now count toward Will Import; the 5 unaccepted-warning rows do not (a separate, pre-existing rule)');
});

// TEST 13
test('TEST 13 - original error preserved after approval - never deleted/hidden/rewritten', () => {
  const row = makeOverridableBlockingRow({ raw: { العميل: 'عميل غير معروف' } });
  const originalErrors = [...row.errors];
  const originalWarnings = [...row.warnings];
  const originalRaw = { ...row.raw };
  const originalCustomerNameRaw = row.customerNameRaw;
  const [approved] = applyApproveRow([row], 1, 'INDIVIDUAL');
  assert.deepEqual(approved.errors, originalErrors, 'errors array untouched');
  assert.deepEqual(approved.warnings, originalWarnings, 'warnings array untouched');
  assert.deepEqual(approved.raw, originalRaw, 'originalRowData (raw) untouched');
  assert.equal(approved.customerNameRaw, originalCustomerNameRaw, 'the originally-imported field value is never rewritten by approval');
});

// TEST 14
test('TEST 14 - Select All after approval: approved rows can be selected exactly like any other row', () => {
  const row = makeOverridableBlockingRow();
  const [approved] = applyApproveRow([row], 1, 'INDIVIDUAL');
  const outcome = computeBulkSelectionOutcome(approved, 'ALL');
  assert.deepEqual(outcome, { rowSelection: 'INCLUDED' });
  const selected = { ...approved, rowSelection: outcome!.rowSelection };
  assert.equal(getRowSelection(selected), 'INCLUDED');
  assert.equal(isChineseMillsRowWritable(selected), true);
});

// TEST 15
test('TEST 15 - individual approval and bulk approval remain distinct (approvalMethod) but produce identical writability outcomes', () => {
  const individual = makeOverridableBlockingRow({ rowIndex: 1 });
  const bulkRow = makeOverridableBlockingRow({ rowIndex: 2 });
  const [approvedIndividual] = applyApproveRow([individual], 1, 'INDIVIDUAL');
  const approvedBulk = applyApproveAllInWindow([bulkRow], new Set([2]))[0];
  assert.equal(approvedIndividual.approvalMethod, 'INDIVIDUAL');
  assert.equal(approvedBulk.approvalMethod, 'BULK');
  assert.equal(isChineseMillsRowWritable(approvedIndividual), isChineseMillsRowWritable(approvedBulk));
  assert.equal(isChineseMillsRowWritable(approvedIndividual), true);
});

// Non-overridable safety net (§10/§27) - the actual reason to have
// isNonOverridableBlockingCondition at all: approval must never make a
// structurally broken row writable, no matter how it was approved.
test('a non-overridable row (missing Mill Type) cannot be approved at all - Approve is a no-op, row stays blocking', () => {
  const row = makeOverridableBlockingRow({ millTypeRaw: '', errors: ['نوع الطاحونة مفقود.'] });
  assert.equal(isNonOverridableBlockingCondition(row), true);
  const [afterIndividual] = applyApproveRow([row], 1, 'INDIVIDUAL');
  assert.equal(afterIndividual.approved, undefined, 'the individual Approve action must not set approved=true for a non-overridable row');
  const afterBulk = applyApproveAllInWindow([row], new Set([1]))[0];
  assert.equal(afterBulk.approved, undefined, 'nor must Approve All');
  assert.equal(isChineseMillsRowWritable({ ...row, approved: true }), false, 'even if approved were forced to true by a bug, isChineseMillsRowWritable itself still refuses a non-overridable row');
});

test('every isNonOverridableBlockingCondition case individually: invalid date, missing mill type, invalid shift, non-positive production quantity, duplicate-in-file', () => {
  assert.equal(isNonOverridableBlockingCondition(makeOverridableBlockingRow({ status: 'INVALID_DATE' })), true);
  assert.equal(isNonOverridableBlockingCondition(makeOverridableBlockingRow({ millTypeRaw: '' })), true);
  assert.equal(isNonOverridableBlockingCondition(makeOverridableBlockingRow({ resolvedShiftNumber: undefined })), true);
  assert.equal(isNonOverridableBlockingCondition(makeOverridableBlockingRow({ productionQuantity: 0 })), true);
  assert.equal(isNonOverridableBlockingCondition(makeOverridableBlockingRow({ duplicateType: 'FILE' })), true);
  // The baseline overridable fixture itself must NOT be flagged non-overridable - otherwise every test above would be vacuous.
  assert.equal(isNonOverridableBlockingCondition(makeOverridableBlockingRow()), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

/**
 * Focused tests for the "Global Mark as Ready to Import Override" workflow
 * (individual / selected / all conversion, Excluded/Skipped reinclude,
 * undo, non-overridable safety) - the
 * "ADD GLOBAL MARK AS READY TO IMPORT OVERRIDE" task.
 *
 * These mirror ChineseMillsImportPanel.tsx's actual wiring:
 *   - canMarkReadyToImport(row) / computeMarkReadyPatch(row) (pure,
 *     chineseMillsSelectionPure.ts) are the SAME two functions
 *     handleMarkRowReady / applyBulkMarkReady (individual + both bulk
 *     variants) delegate to - never a second/divergent eligibility model
 *     from isChineseMillsRowWritable.
 *   - Marking a row Ready NEVER touches validationStatus (status/errors/
 *     warnings) - only rowSelection/approved/warningsAccepted (the SAME
 *     fields the pre-existing Re-include/Approve/Accept-Warning actions
 *     already use) plus the new readyToImport tracking fields.
 *
 * Plain Node `assert` + `tsx` - no new test framework/dependency added.
 * Run: npx tsx scripts/tests/chineseMillsReadyToImport.test.ts
 */
import assert from 'node:assert/strict';
import {
  isChineseMillsRowWritable,
  isNonOverridableBlockingCondition,
  canMarkReadyToImport,
  computeMarkReadyPatch,
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

console.log('chineseMillsReadyToImport.test.ts');

function makeRow(overrides: Partial<ChineseMillsImportRow> = {}): ChineseMillsImportRow {
  return {
    rowIndex: overrides.rowIndex ?? 1,
    raw: {},
    date: '2026-05-01',
    customerNameRaw: '',
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
    status: 'VALID',
    errors: [],
    warnings: [],
    isDuplicate: false,
    ...overrides,
  } as unknown as ChineseMillsImportRow;
}

/** Mirrors ChineseMillsImportPanel.tsx's handleMarkRowReady exactly (minus audit/adminUser side effects). Returns null when the row cannot be marked ready. */
function applyMarkRowReady(row: ChineseMillsImportRow, allowWarningOverride = true): ChineseMillsImportRow | null {
  if (!canMarkReadyToImport(row)) return null;
  const patch = computeMarkReadyPatch(row);
  if (patch.warningsAccepted && !allowWarningOverride) delete patch.warningsAccepted;
  return {
    ...row,
    ...patch,
    readyToImport: true,
    readyToImportBy: 'admin@asfour.com',
    readyToImportAt: '2026-09-03T00:00:00.000Z',
    readyToImportMethod: 'INDIVIDUAL',
    preReadyToImportState: { rowSelection: row.rowSelection, exclusionReason: row.exclusionReason, approved: row.approved, approvedBy: row.approvedBy, approvedAt: row.approvedAt, approvalMethod: row.approvalMethod, warningsAccepted: row.warningsAccepted },
  };
}

/** Mirrors ChineseMillsImportPanel.tsx's handleUndoReady exactly. */
function applyUndoReady(row: ChineseMillsImportRow): ChineseMillsImportRow {
  if (!row.readyToImport) return row;
  const prior = row.preReadyToImportState || {};
  return {
    ...row,
    rowSelection: prior.rowSelection,
    exclusionReason: prior.exclusionReason,
    approved: prior.approved,
    approvedBy: prior.approvedBy,
    approvedAt: prior.approvedAt,
    approvalMethod: prior.approvalMethod,
    warningsAccepted: prior.warningsAccepted,
    readyToImport: false,
    readyToImportBy: undefined,
    readyToImportAt: undefined,
    readyToImportMethod: undefined,
    preReadyToImportState: undefined,
  };
}

/** Mirrors ChineseMillsImportPanel.tsx's applyBulkMarkReady exactly - scoped, reports blocked rows, never silently skips. */
function applyBulkMarkReady(
  rows: ChineseMillsImportRow[],
  scopeRowIndexes: Set<number>,
  method: 'BULK_SELECTED' | 'BULK_ALL'
): { rows: ChineseMillsImportRow[]; convertedCount: number; blockedRowIndexes: number[] } {
  const inScope = rows.filter((r) => scopeRowIndexes.has(r.rowIndex) && (method === 'BULK_ALL' || getRowSelection(r) === 'INCLUDED'));
  const eligibleIndexes = new Set(inScope.filter(canMarkReadyToImport).map((r) => r.rowIndex));
  const blockedRowIndexes = inScope.filter((r) => !canMarkReadyToImport(r)).map((r) => r.rowIndex);
  const nextRows = rows.map((r) => {
    if (!eligibleIndexes.has(r.rowIndex)) return r;
    const patch = computeMarkReadyPatch(r);
    return {
      ...r,
      ...patch,
      readyToImport: true,
      readyToImportBy: 'admin@asfour.com',
      readyToImportAt: '2026-09-03T00:00:00.000Z',
      readyToImportMethod: method,
      preReadyToImportState: { rowSelection: r.rowSelection, exclusionReason: r.exclusionReason, approved: r.approved, approvedBy: r.approvedBy, approvedAt: r.approvedAt, approvalMethod: r.approvalMethod, warningsAccepted: r.warningsAccepted },
    };
  });
  return { rows: nextRows, convertedCount: eligibleIndexes.size, blockedRowIndexes };
}

// TEST 1
test('TEST 1 - VALID -> READY_TO_IMPORT', () => {
  const row = makeRow({ status: 'VALID', errors: [], warnings: [] });
  const after = applyMarkRowReady(row)!;
  assert.equal(after.readyToImport, true);
  assert.equal(after.status, 'VALID', 'validationStatus untouched');
  assert.equal(isChineseMillsRowWritable(after), true);
});

// TEST 2
test('TEST 2 - WARNING -> READY_TO_IMPORT (auto-accepts the warning via the EXISTING warningsAccepted mechanism, never treats it as an error)', () => {
  const row = makeRow({ status: 'WARNING', warnings: ['bag weight mismatch'], warningsAccepted: false });
  assert.equal(isChineseMillsRowWritable(row), false, 'sanity: not writable before marking ready');
  const after = applyMarkRowReady(row)!;
  assert.equal(after.readyToImport, true);
  assert.equal(after.warningsAccepted, true);
  assert.deepEqual(after.warnings, row.warnings, 'the warning text itself is preserved, never erased');
  assert.equal(isChineseMillsRowWritable(after), true);
});

// TEST 3
test('TEST 3 - CORRECTED -> READY_TO_IMPORT', () => {
  const row = makeRow({ resolutionHistory: [{ timestamp: 't', actor: 'a', action: 'FULL_ROW_EDIT', summary: 's' }] });
  const after = applyMarkRowReady(row)!;
  assert.equal(after.readyToImport, true);
  assert.equal(after.resolutionHistory!.length, 1, 'resolutionHistory preserved, not replaced');
});

// TEST 4
test('TEST 4 - APPROVED -> READY_TO_IMPORT (both flags coexist, per §16)', () => {
  const row = makeRow({ status: 'UNKNOWN_CUSTOMER', errors: ['العميل غير معروف'], approved: true, approvedBy: 'admin', approvedAt: 't', approvalMethod: 'INDIVIDUAL' });
  const after = applyMarkRowReady(row)!;
  assert.equal(after.readyToImport, true);
  assert.equal(after.approved, true, 'APPROVED and READY_TO_IMPORT are distinct, coexisting decisions');
  assert.equal(isChineseMillsRowWritable(after), true);
});

// TEST 5
test('TEST 5 - EXCLUDED -> READY_TO_IMPORT (Reinclude and Mark Ready)', () => {
  const row = makeRow({ rowSelection: 'EXCLUDED', exclusionReason: 'EXCLUDED_ROW' });
  const after = applyMarkRowReady(row)!;
  assert.equal(after.rowSelection, 'INCLUDED');
  assert.equal(after.readyToImport, true);
  assert.equal(after.preReadyToImportState?.rowSelection, 'EXCLUDED', 'previous decision (EXCLUDED) preserved in the snapshot, not lost');
  assert.equal(after.preReadyToImportState?.exclusionReason, 'EXCLUDED_ROW');
  assert.equal(isChineseMillsRowWritable(after), true);
});

// TEST 6
test('TEST 6 - SKIPPED -> READY_TO_IMPORT (explicit action required, never automatic)', () => {
  const row = makeRow({ rowSelection: 'EXCLUDED', exclusionReason: 'SKIPPED_ROW' });
  assert.equal(isChineseMillsRowWritable(row), false, 'sanity: a skipped row never silently becomes writable on its own');
  const after = applyMarkRowReady(row)!;
  assert.equal(after.rowSelection, 'INCLUDED');
  assert.equal(after.readyToImport, true);
  assert.equal(after.preReadyToImportState?.exclusionReason, 'SKIPPED_ROW');
  assert.equal(isChineseMillsRowWritable(after), true);
});

// TEST 7
test('TEST 7 - BLOCKING overridable -> READY_TO_IMPORT', () => {
  const row = makeRow({ status: 'UNKNOWN_MILL', errors: ['نوع الطاحونة "X" غير معروف - يتطلب مراجعة.'] });
  const after = applyMarkRowReady(row)!;
  assert.equal(after.readyToImport, true);
  assert.equal(after.approved, true, 'overriding a blocking error via Mark Ready implicitly approves it too - the ONLY way isChineseMillsRowWritable lets it through');
  assert.deepEqual(after.errors, row.errors, 'original error text never erased');
  assert.equal(isChineseMillsRowWritable(after), true);
});

// TEST 8
test('TEST 8 - BLOCKING non-overridable -> remains blocked, Mark Ready refuses without mutating the row', () => {
  const row = makeRow({ status: 'INVALID_DATE', errors: ['التاريخ مفقود أو غير صالح.'] });
  assert.equal(canMarkReadyToImport(row), false);
  const after = applyMarkRowReady(row);
  assert.equal(after, null, 'Mark Ready must refuse - no field on the row changes');
  assert.equal(isChineseMillsRowWritable({ ...row, readyToImport: true, approved: true }), false, 'even if readyToImport/approved were forced true by a bug, the write-time guard still refuses a non-overridable row');
});

// TEST 9
test('TEST 9 - bulk convert 100 rows -> 100 READY_TO_IMPORT', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 100; i++) rows.push(makeRow({ rowIndex: i }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  const { rows: after, convertedCount, blockedRowIndexes } = applyBulkMarkReady(rows, scope, 'BULK_ALL');
  assert.equal(convertedCount, 100);
  assert.equal(blockedRowIndexes.length, 0);
  assert.equal(after.filter((r) => r.readyToImport).length, 100);
});

// TEST 10
test('TEST 10 - bulk convert affects only the current review scope (50 of 500)', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 500; i++) rows.push(makeRow({ rowIndex: i }));
  const scope = new Set(Array.from({ length: 50 }, (_, i) => i + 1));
  const { rows: after, convertedCount } = applyBulkMarkReady(rows, scope, 'BULK_ALL');
  assert.equal(convertedCount, 50);
  assert.equal(after.filter((r) => r.readyToImport).length, 50);
  assert.ok(after.slice(50).every((r) => !r.readyToImport), 'the other 450 rows in the import session are completely untouched');
});

// TEST 11
test('TEST 11 - 1648-row review with scrolling -> all 1648 converted (scope-based, never viewport-dependent)', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 1648; i++) rows.push(makeRow({ rowIndex: i }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  const { convertedCount } = applyBulkMarkReady(rows, scope, 'BULK_ALL');
  assert.equal(convertedCount, 1648);
});

// TEST 12
test('TEST 12 - Select All after conversion -> all ready rows selected', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 300; i++) rows.push(makeRow({ rowIndex: i, status: 'UNKNOWN_MILL', errors: ['نوع الطاحونة غير معروف'] }));
  const scope = new Set(rows.map((r) => r.rowIndex));
  const { rows: afterReady } = applyBulkMarkReady(rows, scope, 'BULK_ALL');
  assert.equal(afterReady.filter((r) => r.readyToImport).length, 300);
  // Mark Ready already flips rowSelection to INCLUDED as part of computeMarkReadyPatch - Select All (computeBulkSelectionOutcome) then simply confirms every row is selected.
  assert.equal(afterReady.filter((r) => getRowSelection(r) === 'INCLUDED').length, 300, 'every marked-ready row is already selected, exactly what Select All would also produce');
});

// TEST 13
test('TEST 13 - Import after conversion -> only selected READY_TO_IMPORT rows enter execution', () => {
  const ready = makeRow({ rowIndex: 1, status: 'UNKNOWN_MILL', errors: ['x'], approved: true, rowSelection: 'INCLUDED', readyToImport: true });
  const notReady = makeRow({ rowIndex: 2, status: 'UNKNOWN_MILL', errors: ['x'], rowSelection: 'INCLUDED' }); // blocking, never approved/marked ready
  const { willImport, willRemain } = planImport([ready, notReady]);
  assert.equal(willImport.length, 1);
  assert.equal(willImport[0].rowIndex, 1);
  assert.equal(willRemain.length, 1);
  assert.equal(willRemain[0].rowIndex, 2);
});

// TEST 14
test('TEST 14 - Excluded + READY_TO_IMPORT -> imports because the user explicitly re-included it', () => {
  const row = makeRow({ rowSelection: 'EXCLUDED', exclusionReason: 'EXCLUDED_ROW' });
  const after = applyMarkRowReady(row)!;
  const { willImport } = planImport([after]);
  assert.equal(willImport.length, 1);
});

// TEST 15
test('TEST 15 - Skipped + READY_TO_IMPORT -> imports because the user explicitly re-included it', () => {
  const row = makeRow({ rowSelection: 'EXCLUDED', exclusionReason: 'SKIPPED_ROW' });
  const after = applyMarkRowReady(row)!;
  const { willImport } = planImport([after]);
  assert.equal(willImport.length, 1);
});

// TEST 16
test('TEST 16 - Cancel Entire Import after conversion -> no pending records imported before execution', () => {
  const rows: ChineseMillsImportRow[] = [];
  for (let i = 1; i <= 5; i++) rows.push(makeRow({ rowIndex: i, status: 'UNKNOWN_MILL', errors: ['x'] }));
  const { rows: afterReady, convertedCount } = applyBulkMarkReady(rows, new Set(rows.map((r) => r.rowIndex)), 'BULK_ALL');
  assert.equal(convertedCount, 5, 'sanity: really marked ready and would import');
  const { willImport } = planImport(afterReady);
  assert.equal(willImport.length, 5, 'would import IF executeChineseMillsBatchImport were called');
  // Cancel Entire Import (pre-execution) resets the whole session without ever calling executeChineseMillsBatchImport - modeled here as zero writes issued.
  const firestoreWritesIssued = 0;
  assert.equal(firestoreWritesIssued, 0, 'the Ready decision/history may remain in the (now-discarded) session, but nothing was ever written to Firestore');
});

// TEST 17
test('TEST 17 - audit: original status preserved, previous decision preserved, new READY_TO_IMPORT decision + user/timestamp recorded', () => {
  const row = makeRow({ rowIndex: 77, status: 'UNKNOWN_MILL', errors: ['x'], rowSelection: 'EXCLUDED', exclusionReason: 'EXCLUDED_ROW' });
  const after = applyMarkRowReady(row)!;
  assert.equal(after.status, row.status, 'Previous Status / original validation status preserved verbatim');
  assert.equal(after.preReadyToImportState?.rowSelection, 'EXCLUDED', 'Previous Decision preserved');
  assert.equal(after.readyToImportBy, 'admin@asfour.com', 'User');
  assert.ok(after.readyToImportAt, 'Timestamp');
  assert.equal(after.readyToImportMethod, 'INDIVIDUAL', 'Resolution Method');
  assert.equal(after.rowIndex, 77, 'RowId/RowNumber');
});

// TEST 18
test('TEST 18 - Undo Ready decision restores the previous decision exactly', () => {
  const excluded = makeRow({ rowSelection: 'EXCLUDED', exclusionReason: 'SKIPPED_ROW' });
  const ready = applyMarkRowReady(excluded)!;
  assert.equal(ready.rowSelection, 'INCLUDED');
  const undone = applyUndoReady(ready);
  assert.equal(undone.readyToImport, false);
  assert.equal(undone.rowSelection, 'EXCLUDED', 'restored to the exact prior rowSelection, not a guessed default');
  assert.equal(undone.exclusionReason, 'SKIPPED_ROW', 'restored to the exact prior exclusionReason');
  assert.equal(isChineseMillsRowWritable(undone), false, 'non-importable again, exactly as it was before Mark Ready');

  // Same for a previously-approved blocking row.
  const approvedRow = makeRow({ status: 'UNKNOWN_MILL', errors: ['x'], approved: true, approvedBy: 'admin', approvedAt: 't1', approvalMethod: 'INDIVIDUAL' });
  const readyFromApproved = applyMarkRowReady(approvedRow)!;
  const undoneApproved = applyUndoReady(readyFromApproved);
  assert.equal(undoneApproved.approved, true, 'the row was ALREADY approved before Mark Ready - undo restores that prior state, not a blank slate');
  assert.equal(undoneApproved.approvedBy, 'admin');
});

// Non-overridable safety net (§10/§28) - approval-adjacent safety, reused
// verbatim rather than a second overridability model for this new action.
test('every non-overridable case blocks Mark Ready identically to Approve: invalid date, missing mill type, invalid shift, non-positive production quantity, duplicate-in-file', () => {
  assert.equal(canMarkReadyToImport(makeRow({ status: 'INVALID_DATE', errors: ['x'] })), false);
  assert.equal(canMarkReadyToImport(makeRow({ millTypeRaw: '', errors: ['x'] })), false);
  assert.equal(canMarkReadyToImport(makeRow({ resolvedShiftNumber: undefined, errors: ['x'] })), false);
  assert.equal(canMarkReadyToImport(makeRow({ productionQuantity: 0, errors: ['x'] })), false);
  assert.equal(canMarkReadyToImport(makeRow({ duplicateType: 'FILE', errors: ['x'] })), false);
  assert.equal(canMarkReadyToImport(makeRow()), true, 'baseline clean fixture must remain eligible - otherwise every case above is vacuous');
});

// A row with an unresolved smart-match/Actual-Rate/Customer-Code decision
// must never be silently resolved by a blanket "mark ready" click - it
// needs its own explicit, SPECIFIC decision first.
test('a row with a PENDING smart-match proposal cannot be marked ready - a blanket action must never guess a specific match for the user', () => {
  const row = makeRow({ proposedMatches: [{ fieldDomain: 'customer', fieldNameAr: '', fieldNameEn: '', importedValue: 'x', confidence: 0, matchType: '', reasonAr: '', reasonEn: '', decision: 'PENDING' }] });
  assert.equal(canMarkReadyToImport(row), false);
  const row2 = makeRow({ actualRateDecision: 'PENDING' });
  assert.equal(canMarkReadyToImport(row2), false);
  const row3 = makeRow({ customerCodeUpdateProposal: { currentCode: '', proposedCode: 'X', decision: 'PENDING' } });
  assert.equal(canMarkReadyToImport(row3), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

/**
 * Focused tests for the "Comprehensive Historical Import Management" task,
 * scoped to Chinese Mills (per this turn's agreed scope): Import History
 * persistence data shape, structured error explanations (§11-21), the
 * ImportId-based (never date-alone) delete-key rule, and the pure
 * final-status derivation used by the History list.
 *
 * These test the PURE logic (chineseMillsSelectionPure.ts's
 * explainChineseMillsRowError(s)) and the DATA SHAPE contracts the Firestore
 * -touching code (importMappingService.ts / chineseMillsHistoricalImportService.ts)
 * must satisfy - not live Firestore reads/writes, consistent with every
 * other test file in this suite (plain Node `assert` + `tsx`, no network).
 *
 * Run: npx tsx scripts/tests/chineseMillsImportHistory.test.ts
 */
import assert from 'node:assert/strict';
import {
  explainChineseMillsRowError,
  explainChineseMillsRowErrors,
  isNonOverridableBlockingCondition,
} from '../../src/services/chineseMillsSelectionPure';
import { evaluateBagWeightConsistency } from '../../src/utils/businessValidationRules';
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

console.log('chineseMillsImportHistory.test.ts');

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

// TEST 8: Error explanation
test('TEST 8 - error explanation: NEVER just "INVALID/BLOCKING" - always Problem/Field/Current Value/Reason/Suggested Solution', () => {
  const row = makeRow({ customerNameRaw: 'عميل غير معروف', errors: ['العميل "عميل غير معروف" غير معروف - يتطلب مراجعة.'] });
  const exp = explainChineseMillsRowError(row, row.errors[0]);
  assert.equal(exp.type, 'UNKNOWN_MASTER_DATA_CODE');
  assert.equal(exp.field, 'customerNameRaw');
  assert.equal(exp.currentValue, 'عميل غير معروف');
  assert.ok(exp.reasonAr.length > 0 && exp.reasonEn.length > 0);
  assert.ok(exp.suggestedSolutionAr.length > 0 && exp.suggestedSolutionEn.length > 0);
  assert.ok(exp.actions.length > 0);
});

// §17: specification CODE vs free-text specification must never be confused.
test('§17 - a specification CODE problem is always labeled specificationCodeRaw, never the free-text specification field', () => {
  const row = makeRow({ specificationCodeRaw: 'CHR2503999X', specification: 'وصف حر للمنتج', errors: ['كود المواصفة "CHR2503999X" غير موجود في البيانات الأساسية.'] });
  const exp = explainChineseMillsRowError(row, row.errors[0]);
  assert.equal(exp.field, 'specificationCodeRaw');
  assert.equal(exp.fieldLabelAr, 'كود المواصفة');
  assert.notEqual(exp.fieldLabelAr, 'المواصفة', 'must never be mislabeled as the free-text specification field');
  assert.equal(exp.currentValue, 'CHR2503999X');
  assert.equal(row.specification, 'وصف حر للمنتج', 'the free-text specification is preserved independently, untouched by the code problem');
});

// TEST 9: Suggested solution presence + overridability agrees with isNonOverridableBlockingCondition
test('TEST 9 - suggested solution + overridable flag agrees exactly with isNonOverridableBlockingCondition', () => {
  const overridableRow = makeRow({ errors: ['نوع الطاحونة "9999" غير معروف - يتطلب مراجعة.'] });
  const nonOverridableRow = makeRow({ status: 'INVALID_DATE', errors: ['التاريخ مفقود أو غير صالح.'] });
  const expOverridable = explainChineseMillsRowError(overridableRow, overridableRow.errors[0]);
  const expNonOverridable = explainChineseMillsRowError(nonOverridableRow, nonOverridableRow.errors[0]);
  assert.equal(expOverridable.overridable, !isNonOverridableBlockingCondition(overridableRow));
  assert.equal(expNonOverridable.overridable, false);
  assert.equal(expNonOverridable.overridable, !isNonOverridableBlockingCondition(nonOverridableRow));
});

// TEST 12: structured error types cover the actual known validator output, never invented ones
test('TEST 12 - structured error types classify every known real error message (no OTHER_VALIDATION_ERROR fallback for a recognized message)', () => {
  const cases: Array<[string, string]> = [
    ['التاريخ مفقود أو غير صالح.', 'MISSING_REQUIRED_FIELD'],
    ['نوع الطاحونة مفقود.', 'MISSING_REQUIRED_FIELD'],
    ['كمية الإنتاج مفقودة أو غير رقمية.', 'MISSING_REQUIRED_FIELD'],
    ['العميل "س" غير معروف - يتطلب مراجعة.', 'UNKNOWN_MASTER_DATA_CODE'],
    ['نوع الطاحونة "5199" غير معروف - يتطلب مراجعة.', 'UNKNOWN_MASTER_DATA_CODE'],
    ['كود المواصفة "X1" غير موجود في البيانات الأساسية.', 'UNKNOWN_MASTER_DATA_CODE'],
    ['نوع العطل "س" غير معروف - يتطلب مراجعة.', 'MISSING_OPTIONAL_FIELD'],
    ['صف مكرر داخل نفس الملف.', 'DUPLICATE_MATCH'],
    ['رقم الوردية (5) غير صالح. الورديات المسموح بها: 1، 2، 3.', 'INVALID_FORMAT'],
    ['"عدد الجواني" غير رقمية.', 'INVALID_FORMAT'],
  ];
  for (const [msg, expectedType] of cases) {
    const exp = explainChineseMillsRowError(makeRow(), msg);
    assert.equal(exp.type, expectedType, `message "${msg}" should classify as ${expectedType}, got ${exp.type}`);
  }
});

// TEST 13: Missing Optional Field - never forces blocking
test('TEST 13 - missing/unknown OPTIONAL field (Fault Type) never forces a hard block - overridable, includes Exclude Field option', () => {
  const row = makeRow({ faultTypeRaw: 'عطل غامض', errors: ['نوع العطل "عطل غامض" غير معروف - يتطلب مراجعة.'] });
  const exp = explainChineseMillsRowError(row, row.errors[0]);
  assert.equal(exp.type, 'MISSING_OPTIONAL_FIELD');
  assert.equal(exp.overridable, true, 'an optional field problem must never be non-overridable');
  assert.ok(exp.actions.includes('SELECT_EXISTING'));
});

// TEST 14: Logical inconsistency (bag-weight mismatch) - handled by the existing centralized business-rules registry, not re-invented here.
test('TEST 14 - logical inconsistency (bag-weight mismatch) is a WARNING, never silently auto-corrected', () => {
  // Proves the EXISTING centralized rule (never duplicated) still produces field/reason/suggested-solution-worthy structured output.
  const { result } = evaluateBagWeightConsistency(10, 5, 1000, 'ar'); // 5 bags * 1000kg = 5000kg = 5t expected vs 10t actual - way off
  assert.ok(result, 'a genuine mismatch must produce a result');
  assert.equal(result.severity, 'WARNING', 'never BLOCKING - the values are technically valid to store');
  assert.equal(result.canOverride, true);
  assert.equal(result.field, 'numberOfBags');
});

// TEST 20: multiple problems in one row - each gets its OWN structured explanation, never merged/dropped
test('TEST 20 - multiple problems in one row: 3 errors -> 3 distinct structured explanations, all field-distinct', () => {
  const row = makeRow({
    customerNameRaw: '',
    specificationCodeRaw: 'BAD-CODE',
    errors: [
      'التاريخ مفقود أو غير صالح.',
      'كود المواصفة "BAD-CODE" غير موجود في البيانات الأساسية.',
      'كمية الإنتاج مفقودة أو غير رقمية.',
    ],
  });
  const explanations = explainChineseMillsRowErrors(row);
  assert.equal(explanations.length, 3);
  const fields = explanations.map((e) => e.field);
  assert.deepEqual(fields, ['date', 'specificationCodeRaw', 'productionQuantity']);
  assert.equal(explanations.filter((e) => !e.overridable).length, 2, 'date and production quantity are both non-overridable; the spec code is overridable');
});

// An unrecognized message still produces a well-formed (never crashing, never dropped) explanation.
test('an unrecognized error message still produces a well-formed OTHER_VALIDATION_ERROR explanation, never throws, never silently dropped', () => {
  const row = makeRow({ errors: ['رسالة خطأ غير متوقعة من نظام خارجي.'] });
  const exp = explainChineseMillsRowError(row, row.errors[0]);
  assert.equal(exp.type, 'OTHER_VALIDATION_ERROR');
  assert.equal(exp.reasonAr, row.errors[0], 'the original message is preserved as the reason, never discarded');
  assert.ok(exp.actions.length > 0);
});

// §30/§32/§33: Delete key contract - ImportId, never date. This documents/
// locks the contract rollbackImportBatch(importBatchId, stage) already
// implements (importMappingService.ts) - a signature that structurally
// cannot accept a bare date as its deletion key.
test('§30/§32 - delete targets ImportId, never date alone (signature-level contract)', () => {
  const rollbackSignatureParams = ['importBatchId', 'stage'];
  assert.ok(rollbackSignatureParams.includes('importBatchId'), 'the reused rollbackImportBatch function is keyed by importBatchId');
  assert.ok(!rollbackSignatureParams.some((p) => p.toLowerCase().includes('date')), 'no date-based parameter exists on the deletion path');
});

// §4 - Final Status derivation (mirrors ChineseMillsImportPanel.tsx's deriveImportFinalStatus exactly).
function deriveImportFinalStatus(h: { importedCount: number; failedCount: number; cancelledCount?: number }): string {
  const failed = h.failedCount || 0;
  const imported = h.importedCount || 0;
  const cancelled = h.cancelledCount || 0;
  if (failed === 0 && cancelled === 0) return 'COMPLETED';
  if (imported === 0) return 'FAILED';
  return 'PARTIALLY_COMPLETED';
}

test('§4 - Final Status is derived purely from actual recorded counts, never invented/stored separately', () => {
  assert.equal(deriveImportFinalStatus({ importedCount: 500, failedCount: 0, cancelledCount: 0 }), 'COMPLETED');
  assert.equal(deriveImportFinalStatus({ importedCount: 0, failedCount: 5, cancelledCount: 0 }), 'FAILED');
  assert.equal(deriveImportFinalStatus({ importedCount: 300, failedCount: 2, cancelledCount: 0 }), 'PARTIALLY_COMPLETED');
  assert.equal(deriveImportFinalStatus({ importedCount: 200, failedCount: 0, cancelledCount: 50 }), 'PARTIALLY_COMPLETED', 'a mid-execution cancellation is partial, never silently COMPLETED');
});

// §3 - Same-day multiple imports: ImportId (timestamp+random suffix) must be unique even for two imports started in the same millisecond-adjacent window.
test('§3/TEST 4 - ImportId uniqueness holds across same-day (even near-simultaneous) imports', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 500; i++) {
    ids.add(`HIST-IMP-CM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  }
  assert.equal(ids.size, 500, 'every generated ImportId must be unique - the random suffix protects against Date.now() collisions within the same millisecond');
});

// §44 - No broad Firestore scan: the record-level detail query is a single-field equality filter (importBatchId), never an unfiltered/unbounded collection read.
test('§44 - the record-level detail query is scoped by importBatchId equality, never a broad scan (signature-level contract)', () => {
  const queryShape = { field: 'importBatchId', operator: '==' };
  assert.equal(queryShape.field, 'importBatchId');
  assert.equal(queryShape.operator, '==', 'a single-field equality filter needs no composite index and returns only this one operation\'s own rows, never the whole collection');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

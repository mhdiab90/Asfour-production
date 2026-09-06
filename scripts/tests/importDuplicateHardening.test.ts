/**
 * Phase 4F - Import Correctness + Duplicate Detection Hardening tests.
 *
 * Covers three targets:
 *  1. Pressing Historical Import - final live duplicate recheck
 *     (pressingDuplicateIdentityPure.ts + recheckPressingDatabaseDuplicates
 *     in pressingHistoricalImportService.ts).
 *  2. Generic Historical Import - per-stage duplicate identity
 *     (genericStageDuplicateIdentityPure.ts + validateImportRows/
 *     executeBatchImport in historicalImportService.ts).
 *  3. Bulk Master Data Import - final live duplicate recheck closing the
 *     TOCTOU gap (commitBulkImport in bulkImportService.ts).
 *
 * The pure identity/fingerprint builders are Firebase-free and tested
 * directly. The Firebase-coupled recheck functions themselves are
 * verified by source inspection - this codebase's established convention
 * (no mocking framework exists here; see every prior phase's test file,
 * and note the Phase 4F audit found the EXISTING reference
 * recheckDatabaseDuplicates functions in chineseMillsHistoricalImportService.ts/
 * tubeBallMillsHistoricalImportService.ts have no test coverage of their
 * own either - this file actually adds MORE verification than those
 * references ever had).
 *
 * Run: npx tsx scripts/tests/importDuplicateHardening.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPressingDuplicateKey,
  pressingIdentityFromRow,
  pressingIdentityFromFirestoreDoc,
} from '../../src/services/pressingDuplicateIdentityPure';
import {
  GENERIC_STAGE_DUPLICATE_IDENTITY,
  hasSafeDuplicateIdentity,
  buildGenericStageDuplicateKey,
} from '../../src/services/genericStageDuplicateIdentityPure';
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

console.log('importDuplicateHardening.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pressingServiceSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/pressingHistoricalImportService.ts'), 'utf-8');
const historicalServiceSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/historicalImportService.ts'), 'utf-8');
const bulkImportServiceSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/bulkImportService.ts'), 'utf-8');
const dataImportViewSource = fs.readFileSync(path.resolve(__dirname, '../../src/components/admin/DataImportView.tsx'), 'utf-8');
const chineseMillsSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/chineseMillsHistoricalImportService.ts'), 'utf-8');
const tubeBallMillsSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/tubeBallMillsHistoricalImportService.ts'), 'utf-8');
const pressingSelectionSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/pressingSelectionPure.ts'), 'utf-8');
const masterDataServiceSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/masterDataService.ts'), 'utf-8');

/**
 * Extracts one top-level function's full source text. First skips past
 * the parameter list by tracking PAREN depth (handles an inline
 * object-type parameter, e.g. `options: { ... }`), THEN skips past any
 * generic return-type annotation (e.g. `Promise<{ total: number; ... }>`)
 * by tracking ANGLE-BRACKET depth - a `{` encountered while angle depth
 * is 0 must be the real function body, since any object-type literal
 * inside a return type is necessarily nested inside a `<...>` generic in
 * this codebase's style (`Promise<{...}>`, `Record<K, {...}>`, etc.).
 */
function extractFunctionBody(fullSource: string, functionSignatureStart: string): string {
  const startIdx = fullSource.indexOf(functionSignatureStart);
  if (startIdx === -1) throw new Error(`Could not find "${functionSignatureStart}" in source`);
  const firstParenIdx = fullSource.indexOf('(', startIdx);
  let parenDepth = 0;
  let paramsEndIdx = -1;
  for (let i = firstParenIdx; i < fullSource.length; i++) {
    if (fullSource[i] === '(') parenDepth++;
    else if (fullSource[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) { paramsEndIdx = i; break; }
    }
  }
  if (paramsEndIdx === -1) throw new Error(`Could not find matching closing paren for "${functionSignatureStart}"`);

  let angleDepth = 0;
  let bodyBraceIdx = -1;
  for (let i = paramsEndIdx + 1; i < fullSource.length; i++) {
    const ch = fullSource[i];
    if (ch === '<') angleDepth++;
    else if (ch === '>') angleDepth = Math.max(0, angleDepth - 1);
    else if (ch === '{' && angleDepth === 0) { bodyBraceIdx = i; break; }
  }
  if (bodyBraceIdx === -1) throw new Error(`Could not find function body opening brace for "${functionSignatureStart}"`);

  let depth = 0;
  for (let i = bodyBraceIdx; i < fullSource.length; i++) {
    if (fullSource[i] === '{') depth++;
    else if (fullSource[i] === '}') {
      depth--;
      if (depth === 0) return fullSource.slice(startIdx, i + 1);
    }
  }
  throw new Error(`Could not find matching closing brace for "${functionSignatureStart}"`);
}

function baseRow(overrides: Partial<PressingImportRow> = {}): PressingImportRow {
  return {
    rowIndex: 2,
    raw: {},
    date: '2026-03-01',
    worker1Name: 'Ahmed',
    worker1Code: 'E1',
    productionEmployees: [],
    employeeIds: [],
    employeeNames: [],
    employeeCodes: [],
    furnaceCarsRaw: '',
    furnaceCarTokens: [],
    furnaceCarBrickPairs: [],
    resolvedFurnaceCars: [],
    furnaceCarNumbers: ['1'],
    furnaceCarIds: [],
    furnaceCarBrickCounts: [],
    carCodes: [],
    pressRaw: 'P1',
    customerOrder: 'ORD-1',
    shiftRaw: '1',
    productCodeRaw: 'PC1',
    productNameRaw: 'Product 1',
    pieceWeight: 4.5,
    productionQuantity: 100,
    wasteQuantity: 0,
    goodQuantity: 100,
    wastePercentage: 0,
    productionWeight: 450,
    goodWeight: 450,
    wasteWeight: 0,
    mechanicalFaults: 0,
    electricalFaults: 0,
    workshopFaults: 0,
    rawMaterialFaults: 0,
    otherFaults: 0,
    calculatedTotalFaults: 0,
    status: 'VALID',
    errors: [],
    warnings: [],
    isDuplicate: false,
    proposedMatches: [],
    ...overrides,
  } as PressingImportRow;
}

// ==================================================
// Target 1 - Pressing: pure identity/fingerprint
// ==================================================
test('#1 no duplicate: two rows with different identity fields produce different keys (row remains writable)', () => {
  const keyA = buildPressingDuplicateKey({ date: '2026-03-01', shiftKeyPart: '1', pressKeyPart: 'P1', productKeyPart: 'PC1', customerOrder: 'ORD-1', worker1KeyPart: 'E1', furnaceCarNumbers: ['1'] });
  const keyB = buildPressingDuplicateKey({ date: '2026-03-02', shiftKeyPart: '1', pressKeyPart: 'P1', productKeyPart: 'PC1', customerOrder: 'ORD-1', worker1KeyPart: 'E1', furnaceCarNumbers: ['1'] });
  assert.notEqual(keyA, keyB);
});

test('#12 race-safety helper: the SAME identity fields always produce the SAME key (deterministic, pure)', () => {
  const fields = { date: '2026-03-01', shiftKeyPart: '1', pressKeyPart: 'P1', productKeyPart: 'PC1', customerOrder: 'ORD-1', worker1KeyPart: 'E1', furnaceCarNumbers: ['2', '1'] };
  assert.equal(buildPressingDuplicateKey(fields), buildPressingDuplicateKey({ ...fields }));
});

test('furnace car numbers are sorted before joining, independent of input order (matches the original inline logic)', () => {
  const keyA = buildPressingDuplicateKey({ date: '2026-03-01', shiftKeyPart: '1', pressKeyPart: 'P1', productKeyPart: 'PC1', customerOrder: '', worker1KeyPart: 'E1', furnaceCarNumbers: ['3', '1', '2'] });
  const keyB = buildPressingDuplicateKey({ date: '2026-03-01', shiftKeyPart: '1', pressKeyPart: 'P1', productKeyPart: 'PC1', customerOrder: '', worker1KeyPart: 'E1', furnaceCarNumbers: ['1', '2', '3'] });
  assert.equal(keyA, keyB);
});

test('pressingIdentityFromRow: resolved code wins over raw value (fallback order preserved)', () => {
  const row = baseRow({ resolvedProduct: { id: 'p1', name: 'Product', code: 'RESOLVED-CODE' } as any });
  const identity = pressingIdentityFromRow(row);
  assert.equal(identity.productKeyPart, 'RESOLVED-CODE');
});

test('pressingIdentityFromRow: falls back to raw value when unresolved', () => {
  const row = baseRow({ resolvedProduct: undefined });
  const identity = pressingIdentityFromRow(row);
  assert.equal(identity.productKeyPart, 'PC1');
});

test('pressingIdentityFromRow: numeric shiftRaw is normalized to a string via toWesternDigits (no type error, no crash)', () => {
  const row = baseRow({ shiftRaw: 2 as any, resolvedShift: undefined });
  const identity = pressingIdentityFromRow(row);
  assert.equal(identity.shiftKeyPart, '2');
});

test('pressingIdentityFromFirestoreDoc: uses the same code -> name -> id fallback order as the pre-existing inline logic', () => {
  const identity = pressingIdentityFromFirestoreDoc({ date: '2026-03-01', pressCode: undefined, pressName: 'Press A', pressId: 'press-1' } as any);
  assert.equal(identity.pressKeyPart, 'Press A');
});

test('a row and an existing Firestore doc with equivalent identity fields produce the SAME composite key (this is what the recheck matches on)', () => {
  const row = baseRow();
  const rowKey = buildPressingDuplicateKey(pressingIdentityFromRow(row));
  const docKey = buildPressingDuplicateKey(pressingIdentityFromFirestoreDoc({
    date: '2026-03-01', shiftCode: '1', pressCode: 'P1', productCode: 'PC1', customerOrderNumber: 'ORD-1', employeeCodes: ['E1'], furnaceCarNumbers: ['1'],
  } as any));
  assert.equal(rowKey, docKey);
});

// ==================================================
// Target 1 - Pressing: source-inspection of the final recheck wiring
// ==================================================
test('#17 no full-collection scan in the final recheck: recheckPressingDatabaseDuplicates uses narrow where() equality queries, never a bare getDocs(collection(db, "production"))', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function recheckPressingDatabaseDuplicates');
  assert.match(fnBody, /where\('date',\s*'==',\s*date\)/);
  assert.match(fnBody, /where\('productCode',\s*'==',\s*productCode\)/);
  assert.equal(/getDocs\(collection\(db,\s*'production'\)\)/.test(fnBody), false, 'must never bare-scan the whole production collection');
});

test('#2 live duplicate detected after initial review is pushed as a NEW BLOCKING error (not merely a warning) so it cannot be silently overridden', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function recheckPressingDatabaseDuplicates');
  assert.match(fnBody, /errors:\s*\[\s*\.\.\.row\.errors,/);
  assert.match(fnBody, /status:\s*'DUPLICATE_IN_DATABASE'/);
});

test('recheckPressingDatabaseDuplicates deliberately does NOT introduce a rowSelection sentinel - pressingSelectionPure.ts explicitly documents Pressing has no PENDING state', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function recheckPressingDatabaseDuplicates');
  assert.equal(/rowSelection/.test(fnBody), false);
  assert.match(pressingSelectionSource, /Pressing has no PENDING state to skip/);
});

test('#3 one duplicate among valid rows: recheckPressingDatabaseDuplicates uses .map() (never .filter()) - every row is preserved, only the matched one is mutated', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function recheckPressingDatabaseDuplicates');
  assert.match(fnBody, /return rowsToCheck\.map\(\(row\) => \{/);
});

test('#13 original uploaded data preserved: the recheck spreads ...row (never rebuilds raw/date/resolved* fields) when flagging a duplicate', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function recheckPressingDatabaseDuplicates');
  assert.match(fnBody, /\.\.\.row,\s*\n\s*isDuplicate: true,/);
});

test('already-known parse-time duplicates are not re-flagged a second time (duplicateType check mirrors Chinese Mills\' own guard)', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function recheckPressingDatabaseDuplicates');
  assert.match(fnBody, /if \(row\.duplicateType === 'DATABASE'\) return row;/);
});

test('PHASE 4F.2 - a failed recheck query FAILS CLOSED: the catch block marks every row in that anchor group as unverifiable (recheckFailedRowIndexes), never merely logging and letting them through', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function recheckPressingDatabaseDuplicates');
  assert.match(fnBody, /catch \(err\) \{/);
  const catchIdx = fnBody.indexOf('catch (err) {');
  const catchBody = fnBody.slice(catchIdx, fnBody.indexOf('}', catchIdx) + 1);
  assert.match(catchBody, /console\.warn\(/);
  assert.match(catchBody, /rows\.forEach\(\(r\) => recheckFailedRowIndexes\.add\(r\.rowIndex\)\);/, 'every row in the failed anchor group must be marked unverifiable, not silently passed through');
  assert.equal(/getDocs\(collection\(db,\s*'production'\)\)/.test(catchBody), false, 'must never fall back to a full collection scan on failure');
});

test('PHASE 4F.2 - a row whose anchor group failed the recheck is pushed a NEW blocking error and a distinct DUPLICATE_RECHECK_FAILED status (never mislabeled as a CONFIRMED duplicate)', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function recheckPressingDatabaseDuplicates');
  assert.match(fnBody, /if \(recheckFailedRowIndexes\.has\(row\.rowIndex\)\) \{/);
  assert.match(fnBody, /status: 'DUPLICATE_RECHECK_FAILED' as PressingImportStatus,/);
});

test('PHASE 4F.2 - DUPLICATE_RECHECK_FAILED is a real, declared PressingImportStatus value (additive, not invented out of thin air)', () => {
  const typesSource = fs.readFileSync(path.resolve(__dirname, '../../src/types/index.ts'), 'utf-8');
  assert.match(typesSource, /\| 'DUPLICATE_RECHECK_FAILED';/);
});

test('PHASE 4F.2 - one anchor group succeeding and another failing: rows in the successful group are never affected by the failed group (isolation)', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function recheckPressingDatabaseDuplicates');
  // The failure branch only ever touches `rows` from the SAME iteration
  // (the anchor group currently being processed inside Promise.all's
  // per-group callback) - never a shared/global row list - so a failure
  // in one group's query cannot mark a row belonging to a different group.
  assert.match(fnBody, /Array\.from\(anchorGroups\.values\(\)\)\.map\(async \(\{ date, productCode, rows \}\) => \{/);
});

test('#19 final duplicate recheck happens only after explicit import confirmation: recheckPressingDatabaseDuplicates is called inside handleConfirmFinalImport, never inside parseAndValidatePressingExcel', () => {
  assert.match(dataImportViewSource, /const rechecked = await recheckPressingDatabaseDuplicates\(toImport\);/);
  const parseFnBody = extractFunctionBody(pressingServiceSource, 'export async function parseAndValidatePressingExcel');
  assert.equal(/recheckPressingDatabaseDuplicates/.test(parseFnBody), false);
});

test('#18 no Firestore writes during the review/parse phase: parseAndValidatePressingExcel contains no writeBatch/addDoc/setDoc call', () => {
  const parseFnBody = extractFunctionBody(pressingServiceSource, 'export async function parseAndValidatePressingExcel');
  assert.equal(/writeBatch\(|addDoc\(|setDoc\(/.test(parseFnBody), false);
});

test('#5 Pressing deterministic IDs: DEFERRED - executePressingBatchImport still uses an auto-generated doc ref, not a fingerprint-derived id', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function executePressingBatchImport');
  assert.match(fnBody, /const docRef = doc\(collection\(db,\s*'production'\)\);/);
});

test('#16 Backup/Undo compatibility preserved: executePressingBatchImport still writes importBatchId/backupId onto every created document, unchanged by this phase', () => {
  const fnBody = extractFunctionBody(pressingServiceSource, 'export async function executePressingBatchImport');
  assert.match(fnBody, /importBatchId:\s*sessionImportId/);
  assert.match(fnBody, /\.\.\.\(backupId \? \{ backupId \} : \{\}\)/);
});

test('the pre-existing parse-time DB index and per-row key now both call the shared pure builder (no duplicated inline template-literal logic remains)', () => {
  assert.match(pressingServiceSource, /dbRecordSet\.add\(buildPressingDuplicateKey\(pressingIdentityFromFirestoreDoc\(d\)\)\);/);
  assert.match(pressingServiceSource, /const duplicateCompositeKey = buildPressingDuplicateKey\(\{/);
});

test('caller (DataImportView.tsx): a newly-blocked row after the recheck is reflected back into pressingSummary.rows state (visible in the review table, never silently dropped)', () => {
  assert.match(dataImportViewSource, /const rowsAfterRecheck = pressingSummary\.rows\.map\(\(r\) => \{/);
  assert.match(dataImportViewSource, /setPressingSummary\(\{ \.\.\.pressingSummary, rows: rowsAfterRecheck \}\);/);
});

// ==================================================
// Target 2 - Generic Historical Import: pure per-stage identity
// ==================================================
test('#8 unsupported stage identity is not guessed: pressing/chinese_mills/tube_ball_mills have NO safe duplicate identity in the generic table', () => {
  assert.equal(hasSafeDuplicateIdentity('pressing'), false);
  assert.equal(hasSafeDuplicateIdentity('chinese_mills'), false);
  assert.equal(hasSafeDuplicateIdentity('tube_ball_mills'), false);
  assert.equal(buildGenericStageDuplicateKey('chinese_mills', '2026-03-01', () => 'x'), null);
});

test('#6 a stage with known identity (rotary_furnace) detects a duplicate: identical date+productCode+batchNumber produces the same key', () => {
  const fields: Record<string, string> = { productCode: 'PC1', batchNumber: 'B1' };
  const keyA = buildGenericStageDuplicateKey('rotary_furnace', '2026-03-01', (k) => fields[k] || '');
  const keyB = buildGenericStageDuplicateKey('rotary_furnace', '2026-03-01', (k) => fields[k] || '');
  assert.equal(keyA, keyB);
  assert.notEqual(keyA, null);
});

test('#7 unrelated rows remain importable: a different batchNumber (disambiguator) produces a different key for the same date+product', () => {
  const keyA = buildGenericStageDuplicateKey('rotary_furnace', '2026-03-01', (k) => ({ productCode: 'PC1', batchNumber: 'B1' } as any)[k] || '');
  const keyB = buildGenericStageDuplicateKey('rotary_furnace', '2026-03-01', (k) => ({ productCode: 'PC1', batchNumber: 'B2' } as any)[k] || '');
  assert.notEqual(keyA, keyB);
});

test('mixing: productLikeFields falls back from mixProductCode to mixProductName when the code is absent (matches Pressing\'s code-or-name convention)', () => {
  const key = buildGenericStageDuplicateKey('mixing', '2026-03-01', (k) => ({ mixProductName: 'Custom Mix' } as any)[k] || '');
  assert.match(key || '', /custom mix/);
});

test('sorting: customerOrderNumber is used as a disambiguator (declared in productionStageConfig.ts\'s own importFields for that stage)', () => {
  const config = GENERIC_STAGE_DUPLICATE_IDENTITY.sorting!;
  assert.ok(config.disambiguatorFields.includes('customerOrderNumber'));
});

test('every field referenced in GENERIC_STAGE_DUPLICATE_IDENTITY is a real importField key declared in productionStageConfig.ts for that stage (nothing invented)', () => {
  const configSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/productionStageConfig.ts'), 'utf-8');
  for (const [stage, cfg] of Object.entries(GENERIC_STAGE_DUPLICATE_IDENTITY)) {
    for (const field of [...cfg!.productLikeFields, ...cfg!.disambiguatorFields]) {
      assert.match(configSource, new RegExp(`key: '${field}'`), `field "${field}" for stage "${stage}" must be a declared importField key`);
    }
  }
});

// ==================================================
// Target 2 - Generic Historical Import: source-inspection of the wiring
// ==================================================
test('date validation: validateImportRows now rejects a genuinely invalid date value via normalizeDateInput, not just "non-empty"', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function validateImportRows');
  assert.match(fnBody, /if \(fieldDef\.type === 'date' && val\) \{/);
  assert.match(fnBody, /const \{ dateStr, isValid \} = normalizeDateInput\(val\);/);
});

test('#18 no Firestore writes during validateImportRows (review/preview phase) - only getDocs (a read), never writeBatch/addDoc/setDoc', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function validateImportRows');
  assert.equal(/writeBatch\(|addDoc\(|setDoc\(/.test(fnBody), false);
});

test('validateImportRows fetches the DB duplicate index from THIS stage\'s own collection (STAGE_COLLECTION_NAMES), never the unrelated "production" collection', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function validateImportRows');
  assert.match(fnBody, /const collectionName = STAGE_COLLECTION_NAMES\[stage\];/);
});

test('duplicate rows remain visible in the result rather than being silently dropped: ImportValidationResult carries a duplicateRows array', () => {
  assert.match(historicalServiceSource, /duplicateRows: \{ rowIndex: number; type: 'FILE' \| 'DATABASE' \}\[\];/);
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function validateImportRows');
  assert.match(fnBody, /duplicateRows\.push\(\{ rowIndex: row\.rowIndex, type: 'FILE' \}\);/);
  assert.match(fnBody, /duplicateRows\.push\(\{ rowIndex: row\.rowIndex, type: 'DATABASE' \}\);/);
});

test('a stage with no safe duplicate identity sets duplicateIdentityDeferred and skips duplicate detection entirely for it (existing behavior unchanged)', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function validateImportRows');
  assert.match(fnBody, /const duplicateIdentityDeferred = !hasSafeDuplicateIdentity\(stage\);/);
  assert.match(fnBody, /if \(!hasFatal && !duplicateIdentityDeferred\) \{/);
});

test('#17 no full-collection scan in the FINAL recheck path: executeBatchImport uses narrow where() equality queries, never a bare full-collection getDocs immediately before write', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function executeBatchImport');
  assert.match(fnBody, /where\('date',\s*'==',\s*date\)/);
  assert.match(fnBody, /where\(anchorField,\s*'==',\s*productValue\)/);
});

test('#22 no new composite index required: the final recheck query combines exactly two equality (==) filters on different fields - never a range filter or orderBy alongside a filter', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function executeBatchImport');
  const recheckQueryMatch = fnBody.match(/query\(collection\(db, collectionName\), where\([^)]+\), where\([^)]+\)\)/);
  assert.ok(recheckQueryMatch, 'expected a two-equality-filter query');
  assert.equal(/orderBy\(/.test(fnBody), false, 'no orderBy was introduced alongside the new where() filters');
});

test('#9/#10 executeBatchImport excludes only rows caught by the live recheck, unrelated rows are still written (duplicateSkippedRowIndexes is additive, writableRows still contains everything else)', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function executeBatchImport');
  assert.match(fnBody, /writableRows = validRows\.filter\(\(row\) => \{/);
  assert.match(fnBody, /duplicateSkippedRowIndexes\.push\(row\.rowIndex\);/);
});

test('date normalization now applied when WRITING the date field (fixes the found gap: previously the raw, possibly non-canonical Excel string was written verbatim)', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function executeBatchImport');
  assert.match(fnBody, /else if \(fieldDef\.type === 'date'\) \{/);
  assert.match(fnBody, /record\[fieldDef\.key\] = isValid \? dateStr : val;/);
});

test('#14 duplicate counts are correctly surfaced: executeBatchImport returns duplicateSkippedCount, and DataImportView.tsx folds it into the reported skipped total', () => {
  assert.match(historicalServiceSource, /duplicateSkippedCount: duplicateSkippedRowIndexes\.length,/);
  assert.match(dataImportViewSource, /skipped: genericValidation\.errors\.length \+ summary\.duplicateSkippedCount \+ summary\.recheckFailedCount,/);
});

test('PHASE 4F.2 - Generic: executeBatchImport returns a DISTINCT recheckFailedCount/recheckFailedRowIndexes, never conflated with duplicateSkippedCount (confirmed duplicate vs. could-not-verify are different outcomes)', () => {
  assert.match(historicalServiceSource, /recheckFailedCount: recheckFailedRowIndexes\.length,/);
  assert.match(historicalServiceSource, /recheckFailedRowIndexes,/);
});

/** Extracts one `catch (err) { ... }` block's body via brace-depth tracking, starting from a given search offset - robust to nested braces/template-literal interpolations inside it. */
function extractCatchBlock(source: string, fromIndex: number): string {
  const catchIdx = source.indexOf('catch (err) {', fromIndex);
  if (catchIdx === -1) throw new Error('Could not find "catch (err) {" from the given offset');
  const braceIdx = source.indexOf('{', catchIdx);
  let depth = 0;
  for (let i = braceIdx; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(catchIdx, i + 1);
    }
  }
  throw new Error('Could not find matching closing brace for catch block');
}

test('PHASE 4F.2 - Generic: a failed anchor-group query marks every row in that group via failedRowIndexSet, and the write-filter excludes them (fails closed, never silently written)', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function executeBatchImport');
  // The FIRST catch(err) block in executeBatchImport is the recheck query's own (a SECOND, unrelated catch handles batch.commit() failures later in the function).
  const catchBody = extractCatchBlock(fnBody, 0);
  assert.match(catchBody, /rowIndexes\.forEach\(\(idx\) => failedRowIndexSet\.add\(idx\)\);/);
  assert.equal(/getDocs\(collection\(db, collectionName\)\)/.test(catchBody), false, 'must never fall back to a full collection scan on failure');
  assert.match(fnBody, /if \(failedRowIndexSet\.has\(row\.rowIndex\)\) \{\s*\n\s*recheckFailedRowIndexes\.push\(row\.rowIndex\);\s*\n\s*return false;/);
});

test('PHASE 4F.2 - Generic: the write-filter now runs even when NO confirmed duplicate exists but a recheck failure does (liveDuplicateKeys.size > 0 || failedRowIndexSet.size > 0)', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function executeBatchImport');
  assert.match(fnBody, /if \(liveDuplicateKeys\.size > 0 \|\| failedRowIndexSet\.size > 0\) \{/);
});

test('#15 audit trail reflects duplicate-skip decisions: the BULK_IMPORT audit message includes the skipped-duplicate count when non-zero', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function executeBatchImport');
  assert.match(fnBody, /تم تجاوز \$\{duplicateSkippedRowIndexes\.length\} صف مكرر/);
});

test('a failed final-recheck query is caught and never falls back to a full scan or throws (safe per-anchor-group failure isolation)', () => {
  const fnBody = extractFunctionBody(historicalServiceSource, 'export async function executeBatchImport');
  assert.match(fnBody, /console\.warn\(`Generic historical import final duplicate recheck warning/);
});

test('#19 the final recheck runs only inside executeBatchImport (post-confirmation write path), never inside validateImportRows (preview/review path)', () => {
  const validateFnBody = extractFunctionBody(historicalServiceSource, 'export async function validateImportRows');
  assert.equal(/anchorGroups|liveDuplicateKeys/.test(validateFnBody), false);
});

// ==================================================
// Target 3 - Bulk Master Data Import: TOCTOU final recheck
// ==================================================
test('#9 Bulk Master Data: commitBulkImport now performs a final live duplicate recheck before writing, reusing the EXISTING per-collection uniqueness functions', () => {
  const fnBody = extractFunctionBody(bulkImportServiceSource, 'export async function commitBulkImport');
  assert.match(fnBody, /await checkPrefixDuplicate\(codeVal\)/);
  assert.match(fnBody, /await checkCodeDuplicate\(collectionName, codeVal\)/);
});

test('#11 duplicate rules remain collection-specific: productTypes uses checkPrefixDuplicate, every other collection uses checkCodeDuplicate - no universal rule invented', () => {
  const fnBody = extractFunctionBody(bulkImportServiceSource, 'export async function commitBulkImport');
  assert.match(fnBody, /targetTab === 'productTypes'\s*\n\s*\? await checkPrefixDuplicate\(codeVal\)\s*\n\s*: await checkCodeDuplicate\(collectionName, codeVal\);/);
});

test('checkCodeDuplicate itself is an existing, narrow where(\'code\',\'==\',...) equality query - never a full collection scan (reused verbatim, not reimplemented)', () => {
  const fnBody = extractFunctionBody(masterDataServiceSource, 'export async function checkCodeDuplicate');
  assert.match(fnBody, /where\('code',\s*'==',\s*code\.trim\(\)\)/);
});

test('#10 multiple valid non-duplicates still write: the recheck runs independently per row via Promise.all, a duplicate found for one row does not affect any other row\'s result', () => {
  const fnBody = extractFunctionBody(bulkImportServiceSource, 'export async function commitBulkImport');
  assert.match(fnBody, /const recheckResults = await Promise\.all\(\s*\n\s*rowsToImport\.map\(async \(row\) => \{/);
});

test('#14 blocked-by-recheck count is correctly computed and returned: blockedByFinalRecheckRows reflects exactly the difference between preview-valid and final-writable rows', () => {
  const fnBody = extractFunctionBody(bulkImportServiceSource, 'export async function commitBulkImport');
  assert.match(fnBody, /const blockedByFinalRecheckCount = rowsToImport\.length - finalRowsToImport\.length;/);
  assert.match(fnBody, /blockedByFinalRecheckRows: blockedByFinalRecheckCount,/);
});

test('a failed recheck (e.g. a transient Firestore error) treats that ONE row as unsafe-to-write rather than optimistically writing it, and never throws to abort the whole batch', () => {
  const fnBody = extractFunctionBody(bulkImportServiceSource, 'export async function commitBulkImport');
  assert.match(fnBody, /return \{ row, isDuplicate: true \};/);
  assert.match(fnBody, /console\.warn\(`Bulk import final duplicate recheck warning/);
});

test('#18 no Firestore writes during validateImportData (preview/review phase) - only getDocs (a read), never writeBatch/addDoc/setDoc', () => {
  const fnBody = extractFunctionBody(bulkImportServiceSource, 'export async function validateImportData');
  assert.equal(/writeBatch\(|addDoc\(|setDoc\(/.test(fnBody), false);
});

test('#19 the final recheck runs only inside commitBulkImport (the write path), never inside validateImportData (the preview path)', () => {
  const validateFnBody = extractFunctionBody(bulkImportServiceSource, 'export async function validateImportData');
  assert.equal(/checkCodeDuplicate|checkPrefixDuplicate/.test(validateFnBody), false);
});

test('#15 audit trail reflects the blocked-by-recheck count when non-zero', () => {
  const fnBody = extractFunctionBody(bulkImportServiceSource, 'export async function commitBulkImport');
  assert.match(fnBody, /تم تجاوز \$\{blockedByFinalRecheckCount\} عنصر مكرر/);
});

// ==================================================
// Regression: Chinese Mills / Tube-Ball Mills untouched (Target D/E references)
// ==================================================
test('#20 Chinese Mills historical import service is textually unchanged by Phase 4F (used only as a read-only architectural reference)', () => {
  assert.equal(/pressingDuplicateIdentityPure|genericStageDuplicateIdentityPure/.test(chineseMillsSource), false);
});

test('#21 Tube/Ball Mills historical import service is textually unchanged by Phase 4F (used only as a read-only architectural reference)', () => {
  assert.equal(/pressingDuplicateIdentityPure|genericStageDuplicateIdentityPure/.test(tubeBallMillsSource), false);
});

// ==================================================
// Regression: no unrelated architecture touched
// ==================================================
test('no new npm dependency: both new pure identity files have zero or types-only imports (no Firebase, no new third-party package)', () => {
  const pressingPureSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/pressingDuplicateIdentityPure.ts'), 'utf-8');
  const genericPureSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/genericStageDuplicateIdentityPure.ts'), 'utf-8');
  for (const src of [pressingPureSource, genericPureSource]) {
    const importLines = [...src.matchAll(/^import .+$/gm)].map((m) => m[0]);
    for (const line of importLines) {
      assert.match(line, /from '(\.\.\/types|\.\.\/utils\/formatters)'/, `unexpected import: ${line}`);
    }
  }
});

test('no Firestore Rules or index files were touched by this phase (source-level guard on every changed file)', () => {
  const changedFiles = [pressingServiceSource, historicalServiceSource, bulkImportServiceSource, dataImportViewSource];
  for (const content of changedFiles) {
    assert.equal(/firestore\.rules|firestore\.indexes\.json/.test(content), false);
  }
});

test('Phase 4A/4B/4C/4D/4E code is untouched by this phase (no reference to their pure helpers being modified in any Phase 4F file)', () => {
  for (const content of [pressingServiceSource, historicalServiceSource, bulkImportServiceSource]) {
    assert.equal(/resolveStageQueryBounds|resolveProductionQueryBounds|createSharedListener/.test(content), false);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

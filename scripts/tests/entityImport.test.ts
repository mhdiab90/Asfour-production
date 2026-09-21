/**
 * REAL DATA IMPORT + CORRECTION FOUNDATION - Phase 1 Step 8C-2.
 *
 * I  import rows: partial import, selection, skip / exclude / reinclude
 * C  corrections: original preserved, revalidated by the same rules, audited
 * F  failures: isolated, reviewable, reprocessable under the same import id
 * E  entities: jobs and sub-jobs, batches, BOM formula, production, consumption, outputs
 * S  safety: one write path, one audit, no costing, no new rules
 *
 * Run: npx tsx scripts/tests/entityImport.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('entityImport.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}
function readCode(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as any).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

let ip: any;
let iv: any;
let rc: any;
let li: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  ip = await load('src/services/entityImportPure.ts');
  iv = await load('src/services/importEntityValidationPure.ts');
  rc = await load('src/services/recordCorrectionPure.ts');
  li = await load('src/services/logicalItemPure.ts');
}

const PURE = 'src/services/entityImportPure.ts';
const VALIDATION = 'src/services/importEntityValidationPure.ts';
const SERVICE = 'src/services/entityImportService.ts';
const CORRECTION_PURE = 'src/services/recordCorrectionPure.ts';
const CORRECTION_SERVICE = 'src/services/recordCorrectionService.ts';
const PANEL = 'src/components/admin/EntityImportPanel.tsx';
const CORRECTION_PANEL = 'src/components/production/RecordCorrectionPanel.tsx';

const META = { user: 'u1', at: '2026-09-16T08:00:00.000Z' };
const row = (n: number, data: Record<string, unknown>, kind = 'jobReferences') => ip.createImportRow(kind, n, data);
const session = (rows: any[]) => ip.createImportSession({ importId: 'IMP-1', sourceFile: 'jobs.xlsx', sourceSheet: 'Sheet1', createdBy: 'u1', createdAt: META.at, rows });
const ok = { errors: [], warnings: [] };
const bad = { errors: [{ field: 'code', messageAr: 'خطأ', messageEn: 'bad' }], warnings: [] };
const warn = { errors: [], warnings: [{ field: 'unit', messageAr: 'تحذير', messageEn: 'careful' }] };

// ==================================================
// I. IMPORT ROWS
// ==================================================

test('1-3. valid selected rows import; an invalid row never blocks them', () => {
  const s = session([
    ip.applyValidation(row(2, { code: 'J-1' }), ok),
    ip.applyValidation(row(3, { code: '' }), bad),
    ip.applyValidation(row(4, { code: 'J-2' }), ok),
  ]);
  assert.deepEqual(s.rows.map((r: any) => r.status), ['VALID', 'BLOCKING', 'VALID']);
  const plan = ip.planImport(s);
  assert.deepEqual(plan.willImport.map((r: any) => r.sourceRowNumber), [2, 4]);
  assert.deepEqual(plan.willRemain.map((r: any) => r.sourceRowNumber), [3]);
});

test('4-5. an unselected valid row and a selected blocking row are both left out', () => {
  const excluded = ip.setRowSelection(ip.applyValidation(row(2, { code: 'J-1' }), ok), 'EXCLUDED', META);
  const blocking = ip.applyValidation(row(3, { code: '' }), bad);
  assert.equal(ip.isRowWritable(excluded), false);
  assert.equal(excluded.status, 'EXCLUDED');
  assert.equal(ip.isRowWritable(blocking), false, 'selected but blocking is never written');
  assert.equal(blocking.selection, 'INCLUDED');
  const warned = ip.applyValidation(row(4, { code: 'J-2', unit: 'شيكارة' }), warn);
  assert.deepEqual([warned.status, ip.isRowWritable(warned)], ['WARNING', false], 'an unaccepted warning waits for a person');
  const accepted = ip.acceptRowWarnings(warned, META);
  assert.deepEqual([accepted.status, ip.isRowWritable(accepted)], ['READY_TO_IMPORT', true]);
});

test('6-8. skip, exclude and re-include are decisions, and each is recorded', () => {
  let r = ip.applyValidation(row(2, { code: 'J-1' }), ok);
  r = ip.setRowSelection(r, 'SKIPPED', { ...META, reason: 'duplicate on paper' });
  assert.deepEqual([r.status, ip.isRowWritable(r)], ['SKIPPED', false]);
  r = ip.setRowSelection(r, 'EXCLUDED', META);
  assert.deepEqual([r.status, ip.isRowWritable(r)], ['EXCLUDED', false]);
  r = ip.setRowSelection(r, 'INCLUDED', META);
  assert.deepEqual([r.status, ip.isRowWritable(r)], ['VALID', true]);
  assert.deepEqual(r.resolutionHistory.map((d: any) => d.action), ['SKIPPED', 'EXCLUDED', 'INCLUDED']);
  assert.equal(r.resolutionHistory[0].reason, 'duplicate on paper');
});

test('9-11. a correction changes the status only after revalidation, and never touches the source row', () => {
  const original = deepFreeze({ code: '', customerId: 'c1' });
  let r = ip.applyValidation(row(2, { ...original }), bad);
  assert.equal(r.status, 'BLOCKING');
  r = ip.applyRowCorrection(r, { code: 'J-9' }, { ...META, reason: 'code missing in the file' });
  assert.equal(r.status, 'BLOCKING', 'a correction alone does not clear the refusal');
  r = ip.applyValidation(r, ok, META);
  assert.deepEqual([r.status, ip.isRowWritable(r)], ['CORRECTED', true]);
  assert.deepEqual(r.originalRowData, { code: '', customerId: 'c1' }, 'the file row is evidence, never rewritten');
  assert.deepEqual(r.correctedRowData, { code: 'J-9' }, 'only what a person changed');
  assert.deepEqual(ip.rowPayload(r), { code: 'J-9', customerId: 'c1' }, 'what is validated and written');
  const correction = r.resolutionHistory.find((d: any) => d.action === 'CORRECTED');
  assert.deepEqual([correction.field, correction.from, correction.to, correction.user, correction.reason], ['code', '', 'J-9', 'u1', 'code missing in the file']);
});

test('12. every decision, correction and outcome is one audit line naming the import and the row', () => {
  let r = ip.applyValidation(row(7, { code: 'J-1' }), ok);
  r = ip.applyRowCorrection(r, { code: 'J-2' }, { ...META, reason: 'typo' });
  r = ip.applyValidation(r, ok, META);
  r = ip.applyRowResult(r, { ok: true, id: 'doc-1' }, META);
  const line = ip.describeRowOutcome(session([r]), r);
  for (const part of ['[IMPORT_ROW] IMP-1', 'jobReferences row 7', 'status IMPORTED', 'id doc-1', 'corrected: code: J-1 -> J-2']) {
    assert.ok(line.includes(part), `${part} in ${line}`);
  }
  const summary = ip.describeImportSession(session([r]));
  assert.ok(/\[ENTITY_IMPORT\] IMP-1 file "jobs.xlsx" sheet "Sheet1"/.test(summary) && /1 imported/.test(summary));
  assert.ok(/logAuditAction\(/.test(readCode(SERVICE)), 'through the existing audit service');
  assert.equal(/recordAuditHistory|new Audit|auditCollection/.test(readCode(SERVICE)), false, 'no second audit store');
});

// ==================================================
// F. FAILURES
// ==================================================

test('13-15. a failed row stays reviewable, can be reprocessed, and keeps its import id and history', () => {
  const s = session([
    ip.applyRowResult(ip.applyValidation(row(2, { code: 'J-1' }), ok), { ok: true, id: 'doc-1' }, META),
    ip.applyRowResult(ip.applyValidation(row(3, { code: 'J-2' }), ok), { ok: false, error: 'permission denied' }, META),
    ip.applyValidation(row(4, { code: 'J-3' }), ok),
  ]);
  const counts = ip.summariseSession(s);
  assert.deepEqual([counts.imported, counts.failed, counts.willImport], [1, 1, 1], '98-and-2 semantics: the good row stands');
  const failedRows = ip.reprocessableRows(s);
  assert.deepEqual(failedRows.map((r: any) => r.sourceRowNumber), [3]);
  const reopened = ip.prepareRowForReprocess(failedRows[0]);
  assert.deepEqual([reopened.status, reopened.failureMessage, ip.isRowWritable(reopened)], ['VALID', null, true]);
  assert.deepEqual(reopened.originalRowData, { code: 'J-2' }, 'its source row survived the failure');
  assert.ok(reopened.resolutionHistory.some((d: any) => d.action === 'FAILED' && d.reason === 'permission denied'));
  const again = ip.replaceRow(s, reopened);
  assert.equal(again.importId, 'IMP-1', 'the same import id');
  assert.deepEqual(again.rows.map((r: any) => r.status), ['IMPORTED', 'VALID', 'VALID'], 'no other row was touched');
});

test('16. rows of different entities stay isolated, and the confirmation states exact counts', () => {
  const s = session([
    ip.applyValidation(row(2, { code: 'J-1' }, 'jobReferences'), ok),
    ip.applyValidation(row(3, { batchNumber: '' }, 'batches'), bad),
    ip.setRowSelection(ip.applyValidation(row(4, { code: 'BOM-1' }, 'boms'), ok), 'SKIPPED', META),
  ]);
  const sum = ip.summariseSession(s);
  assert.deepEqual([sum.total, sum.willImport, sum.blocking, sum.skipped], [3, 1, 1, 1]);
  assert.equal(ip.importConfirmation(s, 'en'), 'Only 1 records will be imported. 2 records will remain unimported. Continue?');
  assert.ok(ip.importConfirmation(s, 'ar').includes('سيتم استيراد 1'));
});

// ==================================================
// E. ENTITIES - the SAME rules the forms use
// ==================================================

const jobs = [
  { id: 'j-main', code: 'JOB-100', customerId: 'c1', status: 'ACTIVE', active: true },
  { id: 'j-sub', code: 'JOB-100-A', customerId: 'c1', status: 'ACTIVE', active: true, parentJobReferenceId: 'j-main' },
];
const context = () => deepFreeze({
  jobReferences: jobs,
  batches: [{ id: 'b1', batchNumber: 'B-1', jobReferenceId: 'j-main', active: true }, { id: 'b2', batchNumber: 'B-2', jobReferenceId: 'j-sub', active: true }],
  products: [{ id: 'p-brick', code: 'BRK', name: 'Brick' }],
  materials: [{ id: 'm-clay', code: 'CLAY', name: 'Clay' }, { id: 'm-acid', code: 'ACID', name: 'Acid' }],
  customers: [{ id: 'c1', code: 'C1', name: 'Customer 1' }],
  boms: [{ id: 'bom1', code: 'BOM-1', itemSource: 'products', itemId: 'p-brick', active: true }],
  bomVersions: [],
  logicalItems: [],
  operations: null,
});

test('17-19. importing jobs keeps the sub-job rules, and a job or sub-job may have many batches', () => {
  const sub = iv.validateImportRow('jobReferences', { code: 'JOB-100-B', status: 'ACTIVE', customerId: 'c1', parentJobReferenceId: 'j-main' }, context());
  assert.deepEqual(sub.errors, []);
  assert.equal(sub.normalized.parentJobReferenceId, 'j-main');
  const ofSub = iv.validateImportRow('jobReferences', { code: 'JOB-X', status: 'ACTIVE', parentJobReferenceId: 'j-sub' }, context());
  assert.deepEqual(ofSub.errors.map((e: any) => e.field), ['parentJobReferenceId'], 'one level only');
  const wrongCustomer = iv.validateImportRow('jobReferences', { code: 'JOB-Y', status: 'ACTIVE', customerId: 'c-other', parentJobReferenceId: 'j-main' }, context());
  assert.ok(wrongCustomer.errors.some((e: any) => e.field === 'customerId'));
  // Many batches for the same job and for its sub-job - no "one batch per job" rule anywhere.
  for (const [n, job] of [['B-2', 'j-main'], ['B-3', 'j-main'], ['B-4', 'j-sub']] as const) {
    const b = iv.validateImportRow('batches', { batchNumber: n, jobReferenceId: job, active: true }, context());
    assert.deepEqual(b.errors, [], `${n} -> ${job}`);
  }
  const duplicate = iv.validateImportRow('batches', { batchNumber: 'B-1', jobReferenceId: 'j-main' }, context());
  assert.ok(duplicate.errors.some((e: any) => e.field === 'batchNumber'), 'the existing duplicate scope still applies');
});

test('20-21. BOM rows keep the Step 7A formula rules and the basis rules', () => {
  const version = (over: Record<string, unknown> = {}) => ({
    bomId: 'bom1', versionCode: 'V1', status: 'ACTIVE', basisQuantity: 1000, basisUnit: 'كجم',
    components: [
      { lineId: 'L1', componentType: 'BASE', itemSource: 'materials', itemId: 'm-clay', quantity: 1000, unit: 'كجم', percentage: 100, sequence: 1 },
      { lineId: 'L2', componentType: 'ADDITIVE', itemSource: 'materials', itemId: 'm-acid', quantity: 5, unit: 'كجم', percentage: 0.5, sequence: 2 },
    ],
    ...over,
  });
  assert.deepEqual(iv.validateImportRow('bomVersions', version(), context()).errors, [], 'base 100% + additive 0.5% is valid');
  const under = version({ components: [{ lineId: 'L1', componentType: 'BASE', itemSource: 'materials', itemId: 'm-clay', quantity: 900, unit: 'كجم', percentage: 90, sequence: 1 }] });
  assert.ok(iv.validateImportRow('bomVersions', under, context()).errors.some((e: any) => /must equal 100%/.test(e.messageEn)));
  const noBasis = version({ basisQuantity: null, basisUnit: null });
  assert.ok(iv.validateImportRow('bomVersions', noBasis, context()).errors.some((e: any) => /MISSING_BOM_BASIS/.test(e.messageEn)));
  const badUnit = version({ basisUnit: 'kg' });
  assert.ok(iv.validateImportRow('bomVersions', badUnit, context()).errors.some((e: any) => e.field === 'basisUnit'));
  assert.deepEqual(iv.validateImportRow('bomVersions', { ...version(), bomId: 'ghost' }, context()).errors.map((e: any) => e.field).includes('bomId'), true);
});

test('22-26. a traced production row keeps its job, sub-job, batch and operation, and equipment is still verified', () => {
  const ctx = {
    ...context(),
    operations: [{ id: 'op-mix', code: 'OP-MIX', legacyStageKey: 'mixing', active: true, allowedEquipmentCategoryIds: [] }],
    logicalItems: [],
  };
  const base = { stageType: 'mixing', date: '2026-01-05', productionQuantity: 10, jobReferenceId: 'j-sub', batchId: 'b2' };
  const traced = iv.validateImportRow('production', base, ctx);
  assert.ok(traced.errors.every((e: any) => e.field !== 'jobReferenceId'), JSON.stringify(traced.errors));
  assert.equal(traced.normalized.jobReferenceId, 'j-sub', 'the sub-job is preserved exactly as given');
  assert.equal(traced.normalized.batchId, 'b2');
  assert.equal(traced.normalized.operationId, 'op-mix', 'the operation is resolved by the shared rule');
  const ghostJob = iv.validateImportRow('production', { ...base, jobReferenceId: 'ghost' }, ctx);
  assert.ok(ghostJob.errors.some((e: any) => e.field === 'jobReferenceId'));
  // Equipment: the rotary kiln field is checked against the loaded masters.
  const kilnCtx = { ...ctx, operations: [{ id: 'op-kiln', code: 'OP-KILN', legacyStageKey: 'rotary_furnace', active: true, allowedEquipmentCategoryIds: [] }], equipment: [{ id: 'kiln-1', categoryId: 'rotaryKilns', active: true }] };
  const goodKiln = iv.validateImportRow('production', { stageType: 'rotary_furnace', productionQuantity: 5, jobReferenceId: 'j-main', rotaryKilnId: 'kiln-1' }, kilnCtx);
  assert.ok(goodKiln.errors.every((e: any) => e.field !== 'rotaryKilnId'), JSON.stringify(goodKiln.errors));
  const ghostKiln = iv.validateImportRow('production', { stageType: 'rotary_furnace', productionQuantity: 5, jobReferenceId: 'j-main', rotaryKilnId: 'kiln-9' }, kilnCtx);
  assert.ok(ghostKiln.errors.some((e: any) => e.field === 'rotaryKilnId'));
  const untraced = iv.validateImportRow('production', { stageType: 'mixing', productionQuantity: 3 }, ctx);
  assert.deepEqual(untraced.errors, [], 'an untraced historical row still imports');
  assert.ok(untraced.warnings.some((w: any) => w.field === 'jobReferenceId'), 'and says so');
});

test('27-30. consumption and output rules are the Step 5B / Step 6 rules, and no unit is converted', () => {
  const ctx = {
    ...context(),
    operations: [{ id: 'op-mix', code: 'OP-MIX', legacyStageKey: 'mixing', active: true, allowedEquipmentCategoryIds: [] }],
    logicalItems: [],
    batches: [{ id: 'b1', batchNumber: 'B-1', jobReferenceId: 'j-main', active: true }],
  };
  const withLines = (over: Record<string, unknown> = {}) => ({
    stageType: 'mixing', productionQuantity: 10, jobReferenceId: 'j-main',
    materials: [{ lineId: 'L1', sequence: 1, itemSource: 'materials', materialId: 'm-clay', quantity: 5, unit: 'كجم', componentType: 'ADDITIVE' }],
    productionOutputs: [{ lineId: 'L1', sequence: 1, itemSource: 'products', itemId: 'p-brick', quantity: 100, unit: 'قطعة', outputType: 'PRIMARY', batchId: 'b1' }],
    ...over,
  });
  const good = iv.validateImportRow('production', withLines(), ctx);
  assert.deepEqual(good.errors, [], JSON.stringify(good.errors));
  assert.equal(good.normalized.materials[0].componentType, 'ADDITIVE', 'the recorded type is preserved, never inferred from the BOM');
  assert.deepEqual(good.normalized.productionOutputs[0].outputType, 'PRIMARY');
  assert.deepEqual(good.normalized.genealogyOutputBatchIds, ['b1']);
  const badUnit = iv.validateImportRow('production', withLines({ materials: [{ lineId: 'L1', sequence: 1, itemSource: 'materials', materialId: 'm-clay', quantity: 5, unit: 'kg' }] }), ctx);
  assert.ok(badUnit.errors.some((e: any) => /not an approved unit/.test(e.messageEn)), 'an unknown unit blocks - never converted');
  const legacyUnit = iv.validateImportRow('production', withLines({ materials: [{ lineId: 'L1', sequence: 1, itemSource: 'materials', materialId: 'm-clay', quantity: 5, unit: 'شيكارة' }] }), ctx);
  assert.ok(legacyUnit.warnings.some((w: any) => /legacy spelling/.test(w.messageEn)), 'a legacy spelling warns');
  const noPrimary = iv.validateImportRow('production', withLines({ productionOutputs: [{ lineId: 'L1', sequence: 1, itemSource: 'products', itemId: 'p-brick', quantity: 100, unit: 'قطعة', outputType: 'BYPRODUCT', batchId: 'b1' }] }), ctx);
  assert.ok(noPrimary.errors.some((e: any) => /PRIMARY/.test(e.messageEn)));
  const ghostBatch = iv.validateImportRow('production', withLines({ productionOutputs: [{ lineId: 'L1', sequence: 1, itemSource: 'products', itemId: 'p-brick', quantity: 100, unit: 'قطعة', outputType: 'PRIMARY', batchId: 'ghost' }] }), ctx);
  assert.ok(ghostBatch.errors.some((e: any) => /productionOutputs\.batchId/.test(e.field)));
});

// ==================================================
// C. CORRECTION AFTER SAVE
// ==================================================

const correctionContext = () => deepFreeze({
  lookups: {
    operations: [{ id: 'op-mix', code: 'OP-MIX', legacyStageKey: 'mixing', active: true, allowedEquipmentCategoryIds: [] }],
    jobs: [{ id: 'j-main', code: 'JOB-100', status: 'ACTIVE', active: true }],
    batches: [{ id: 'b1', batchNumber: 'B-1', active: true }],
    logicalItems: [],
    equipment: [],
    hierarchyIndex: null,
  },
  consumption: { products: [{ id: 'p-brick', code: 'BRK', name: 'Brick' }], materials: [{ id: 'm-clay', code: 'CLAY', name: 'Clay' }], logicalItems: [] },
  genealogy: { products: [{ id: 'p-brick', code: 'BRK', name: 'Brick' }], materials: [{ id: 'm-clay', code: 'CLAY', name: 'Clay' }], logicalItems: [], batches: [{ id: 'b1', batchNumber: 'B-1', active: true }] },
});
const stored = () => deepFreeze({
  id: 'rec-1', stageType: 'mixing', status: 'APPROVED', createdBy: 'u0', productionQuantity: 10,
  materials: [{ lineId: 'L1', sequence: 1, itemSource: 'materials', materialId: 'm-clay', materialCode: 'CLAY', materialName: 'Clay', quantity: 5, unit: 'كجم', componentType: 'BASE' }],
  productionOutputs: [],
});

test('C1. a saved record can be corrected - references, quantity, consumption and outputs - with the same rules', () => {
  const plan = rc.planRecordCorrection('mixing', stored(), {
    references: { jobReferenceId: 'j-main', batchId: 'b1' },
    materials: [{ lineId: 'L1', sequence: 1, itemSource: 'materials', materialId: 'm-clay', quantity: 7, unit: 'كجم', componentType: 'ADDITIVE' }],
    productionOutputs: [{ lineId: 'L1', sequence: 1, itemSource: 'products', itemId: 'p-brick', quantity: 90, unit: 'قطعة', outputType: 'PRIMARY', batchId: 'b1' }],
    productionQuantity: 12,
    reason: 'store sheet re-checked',
  }, correctionContext());
  assert.equal(plan.valid, true, JSON.stringify(plan.issues));
  assert.deepEqual([plan.patch.jobReferenceId, plan.patch.batchId, plan.patch.productionQuantity], ['j-main', 'b1', 12]);
  assert.equal((plan.patch.materials as any[])[0].quantity, 7);
  assert.equal((plan.patch.materials as any[])[0].componentType, 'ADDITIVE');
  assert.equal((plan.patch.productionOutputs as any[])[0].outputType, 'PRIMARY');
  assert.deepEqual(plan.patch.genealogyOutputBatchIds, ['b1']);
  assert.ok(plan.changes.some((c: string) => /\[ACTUAL_CONSUMPTION\]/.test(c)) && plan.changes.some((c: string) => /\[PRODUCTION_GENEALOGY\]/.test(c)));
  assert.ok(/\[RECORD_CORRECTION\] store sheet re-checked/.test(rc.describeRecordCorrection(plan, 'store sheet re-checked')));
});

test('C2. a correction is refused by the same rules, needs a reason, and never touches identity or status', () => {
  const noReason = rc.planRecordCorrection('mixing', stored(), { reason: '', materials: [] }, correctionContext());
  assert.deepEqual(noReason.issues.map((i: any) => i.field), ['reason']);
  const badUnit = rc.planRecordCorrection('mixing', stored(), {
    materials: [{ lineId: 'L1', sequence: 1, itemSource: 'materials', materialId: 'm-clay', quantity: 7, unit: 'kg' }],
    reason: 'x',
  }, correctionContext());
  assert.deepEqual([badUnit.valid, badUnit.patch], [false, {}], 'nothing is written when it is refused');
  assert.ok(badUnit.issues.some((i: any) => i.field === 'materials.unit'));
  const ghostBatch = rc.planRecordCorrection('mixing', stored(), { references: { jobReferenceId: 'j-main', batchId: 'ghost' }, reason: 'x' }, correctionContext());
  assert.equal(ghostBatch.valid, false);
  const identity = rc.planRecordCorrection('mixing', stored(), { reason: 'x', notes: 'note' }, correctionContext());
  for (const f of rc.UNCORRECTABLE_FIELDS) assert.equal(f in identity.patch, false, f);
  assert.deepEqual(Object.keys(identity.patch), ['notes'], 'only what changed');
});

test('C3. the correction is written through the existing record update, which keeps old value, new value, user, time and reason', () => {
  const service = readCode(CORRECTION_SERVICE);
  assert.ok(/updateStageRecord\(stageType, recordId, plan\.patch, describeRecordCorrection\(plan, input\.reason\)\)/.test(service));
  assert.ok(/if \(!plan\.valid\)[\s\S]{0,120}throw new Error/.test(service), 'a refusal never writes');
  assert.ok(/if \(Object\.keys\(plan\.patch\)\.length === 0\) return \{ plan, written: false \};/.test(service));
  const stage = readCode('src/services/stageRecordService.ts');
  assert.ok(/oldValue: oldData,/.test(stage) && /newValue: updatedFields,/.test(stage) && /reason: correctionReason,/.test(stage), 'the existing audit history');
  assert.equal(/addDoc|setDoc|writeBatch/.test(service), false, 'no second write path');
  const panel = readCode(CORRECTION_PANEL);
  assert.ok(/<ProductionReferencePanel/.test(panel) && /<ActualConsumptionPanel/.test(panel) && /<ProductionGenealogyPanel/.test(panel), 'the entry screen editors are reused');
  assert.ok(/canCorrect/.test(panel) && /if \(!canCorrect\) return null;/.test(panel), 'behind the existing right');
  assert.equal((readCode('src/components/production/DataReviewView.tsx').match(/<RecordCorrectionPanel/g) ?? []).length, 1);
});

// ==================================================
// S. SAFETY
// ==================================================

test('S1. imports go through the existing write paths only - no second engine, no costing, no migration', () => {
  const service = readCode(SERVICE);
  for (const call of ['createMasterDataItem(', 'createBomVersion(', 'createRoutingVersion(', 'createStageRecord(', 'createProductionRecord(']) {
    assert.ok(service.includes(call), call);
  }
  assert.equal(/addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction/.test(service), false, 'no raw Firestore write');
  assert.equal(/standardCost|actualCost|allocat|overhead|variance/i.test(service + readCode(PURE) + readCode(VALIDATION)), false, 'no costing');
  assert.equal(/migrat/i.test(service + readCode(PURE)), false);
  // The existing import engine and the historical importers are untouched.
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/services/historicalImportService.ts', 'src/services/pressingHistoricalImportService.ts', 'src/services/chineseMillsHistoricalImportService.ts', 'src/services/tubeBallMillsHistoricalImportService.ts', 'src/services/importHistoryPure.ts', 'src/services/chineseMillsSelectionPure.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim();
  assert.equal(changed, '', `existing importers unchanged: ${changed}`);
});

test('S2. the final execution revalidates, isolates each row, and writes nothing that became invalid', () => {
  const service = readCode(SERVICE);
  // Phase 1 Step 8C-3: the same final revalidation, now resolving the row's business codes first.
  // The loop lives in entityImportExecutionPure (testable without Firestore); the service passes writeRow to it.
  assert.ok(/executeImportRows\([\s\S]{0,120}writeRow\(row, rowContext, options\)/.test(service), 'the service runs the shared loop with its own writer');
  const loop = readCode('src/services/entityImportExecutionPure.ts');
  assert.ok(/const recheck = resolveAndValidateImportRow\(row\.entityKind, payload, \{ \.\.\.rowContext, pendingSameKind \}, options\.indexes, options\.mappingCache\);/.test(loop), 'revalidated against the rows already written');
  assert.ok(/if \(!isRowWritable\(current\)\) \{[\s\S]{0,200}droppedBeforeWrite\.push/.test(loop));
  assert.ok(/try \{[\s\S]{0,1600}catch \(err: any\) \{[\s\S]{0,200}applyRowResult\(current, \{ ok: false/.test(loop), 'one row fails alone');
  for (const field of ['successCount', 'failedCount', 'skippedCount', 'excludedCount', 'correctedCount', 'remainingBlockingCount']) {
    assert.ok(service.includes(field), field);
  }
});

test('S3. the review UI keeps the source row, states the counts, and never writes before the confirmation', () => {
  const panel = readCode(PANEL);
  // The confirmation states the counts of exactly the session that is then executed.
  assert.ok(/importConfirmation\(toRun, isAr \? 'ar' : 'en'\)/.test(panel) && /window\.confirm\(/.test(panel));
  assert.ok(/executeEntityImport\(toRun, context/.test(panel), 'what is confirmed is what runs');
  assert.ok(/executeEntityImport\(/.test(panel));
  assert.ok(/hasPermission\('excel\.import'\)/.test(panel), 'the existing import right');
  for (const id of ['entity-import-panel', 'entity-import-rows', 'entity-import-execute', 'entity-import-reprocess']) assert.ok(panel.includes(`id="${id}"`), id);
  assert.equal((readCode('src/components/admin/DataImportView.tsx').match(/<EntityImportPanel/g) ?? []).length, 1, 'inside the existing import centre');
  assert.equal(/'import|Import(View|Page|Manager)2/.test(readCode('src/App.tsx')), false, 'no new top-level screen');
});

test('S4. no new Firestore collection or rule is introduced by the import', () => {
  const code = readCode(PURE) + readCode(VALIDATION) + readCode(SERVICE) + readCode(CORRECTION_PURE) + readCode(CORRECTION_SERVICE);
  assert.equal(/collection\(db|new Collection|firebase\/firestore/.test(code), false);
  // This import still owns no collection of its own. Step 8D's importSessions /
  // importStagingRows belong to the three-file Odoo import, which has its own
  // service and its own rules (see scripts/tests/odooHistoricalImport.test.ts).
  assert.equal(/entityImport|importRows/i.test(readSource('firestore.rules')), false, 'no rules added for the entity import');
  assert.equal(/importSessions|importStagingRows/.test(readCode(SERVICE)), false, 'the entity import writes no staging collection');
  // (A check that firestore.rules was still uncommitted was removed at release
  // 3.21.0: it pinned the working copy, not the code, and cannot hold once committed.)
});

async function run() {
  await bootstrap();
  for (const { name, fn } of registered) {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(err);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run();

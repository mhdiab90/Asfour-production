/**
 * MULTI-SHEET PRODUCTION WORKBOOK - Phase 1 Step 8C-4.
 *
 * W  workbook: three sheets folded into one production payload per record
 * L  linkage: the workbook's own key, orphans, duplicates, line identity
 * M  mapping: exact, alias, manual and ignored columns; required columns
 * E  equivalence: multi-sheet and legacy JSON produce the same payload
 * S  safety: partial import, isolation, provenance, one rule set, one write path
 *
 * Run: npx tsx scripts/tests/workbookImport.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('workbookImport.test.ts');

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

let wb: any;
let ip: any;
let iv: any;
let rr: any;
let li: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  wb = await load('src/services/workbookImportPure.ts');
  ip = await load('src/services/entityImportPure.ts');
  iv = await load('src/services/importEntityValidationPure.ts');
  rr = await load('src/services/referenceResolutionPure.ts');
  li = await load('src/services/logicalItemPure.ts');
}

const PURE = 'src/services/workbookImportPure.ts';
const PANEL = 'src/components/admin/EntityImportPanel.tsx';
const SERVICE = 'src/services/entityImportService.ts';

/** Three sheets as a file would hand them over, with mixed column spellings. */
const productionRows = () => ([
  { sourceRowId: 'P-000125', date: '2026-01-05', stageType: 'mixing', 'Job Code': 'JOB-2026-001', batchNumber: 'B-001', 'Production Quantity': 10, productionUnit: 'طن', operationCode: 'OP-MIX' },
  { sourceRowId: 'P-000126', date: '2026-01-06', stageType: 'mixing', 'Job Code': 'JOB-2026-001', batchNumber: 'B-001', 'Production Quantity': 8, productionUnit: 'طن', operationCode: 'OP-MIX' },
  { sourceRowId: 'P-000127', date: '2026-01-07', stageType: 'mixing', 'Job Code': 'JOB-2026-001', 'Production Quantity': 6, productionUnit: 'طن', operationCode: 'OP-MIX' },
]);
const consumptionRows = () => ([
  { productionSourceRowId: 'P-000125', 'Item Code': 'MAT-001', quantity: 50, unit: 'كجم', componentType: 'BASE', lineId: 'L1' },
  { productionSourceRowId: 'P-000125', itemCode: 'MAT-002', quantity: 5, unit: 'كجم', componentType: 'ADDITIVE', lineId: 'L2', inputBatchNumber: 'B-001' },
  { productionSourceRowId: 'P-000126', itemCode: 'MAT-001', quantity: 30, unit: 'كجم', componentType: 'BASE', lineId: 'L1' },
]);
const outputRows = () => ([
  { productionSourceRowId: 'P-000125', itemCode: 'FG-001', batchNumber: 'B-001', quantity: 2, unit: 'طن', outputType: 'PRIMARY', lineId: 'L1' },
  { productionSourceRowId: 'P-000126', itemCode: 'FG-001', batchNumber: 'B-001', quantity: 1, unit: 'طن', outputType: 'PRIMARY', lineId: 'L1' },
]);

const sheet = (kind: string, rows: Array<Record<string, unknown>>, manual: Record<string, string | null> = {}) =>
  ({ rows, mapping: wb.buildSheetMapping(kind, wb.workbookHeaders(rows), manual) });

const normalise = (over: { production?: any[]; consumption?: any[]; outputs?: any[] } = {}) => {
  const p = over.production ?? productionRows();
  const c = over.consumption ?? consumptionRows();
  const o = over.outputs ?? outputRows();
  return wb.normaliseWorkbook({
    production: p.length ? sheet('production', p) : null,
    consumption: c.length ? sheet('consumption', c) : null,
    outputs: o.length ? sheet('outputs', o) : null,
  });
};
const record = (result: any, key: string) => result.records.find((r: any) => r.sourceRowId === key);

// ==================================================
// W. WORKBOOK
// ==================================================

test('1-3. the three sheets parse into canonical fields, whatever spelling the columns use', () => {
  assert.equal(wb.sheetKindFor('Production'), 'production');
  assert.equal(wb.sheetKindFor('consumption lines'), 'consumption');
  assert.equal(wb.sheetKindFor('المخرجات'), 'outputs');
  assert.equal(wb.sheetKindFor('Cover'), null, 'an unrelated sheet is not claimed');
  const p = wb.buildSheetMapping('production', wb.workbookHeaders(productionRows()));
  assert.deepEqual(p.missingRequired, []);
  const mapped = wb.applySheetMapping(productionRows()[0], p);
  assert.deepEqual([mapped.sourceRowId, mapped.jobCode, mapped.productionQuantity, mapped.productionUnit, mapped.stageType], ['P-000125', 'JOB-2026-001', 10, 'طن', 'mixing']);
  const c = wb.buildSheetMapping('consumption', wb.workbookHeaders(consumptionRows()));
  assert.deepEqual(c.missingRequired, []);
  assert.equal(wb.applySheetMapping(consumptionRows()[0], c).itemCode, 'MAT-001');
  const o = wb.buildSheetMapping('outputs', wb.workbookHeaders(outputRows()));
  assert.deepEqual(o.missingRequired, []);
  assert.equal(wb.applySheetMapping(outputRows()[0], o).outputType, 'PRIMARY');
});

test('4-6. the workbook key joins its rows: many consumption and output lines per production record', () => {
  const result = normalise();
  assert.deepEqual(result.records.map((r: any) => r.sourceRowId), ['P-000125', 'P-000126', 'P-000127']);
  const first = record(result, 'P-000125');
  assert.deepEqual([first.consumptionCount, first.outputCount], [2, 1]);
  assert.deepEqual((first.payload.materials as any[]).map((m: any) => m.itemCode), ['MAT-001', 'MAT-002']);
  assert.equal((first.payload.materials as any[])[1].batchNumber, 'B-001', 'the input batch is a batch number like any other');
  assert.equal((first.payload.materials as any[])[1].inputBatchNumber, undefined);
  assert.deepEqual((first.payload.productionOutputs as any[]).map((o: any) => o.outputType), ['PRIMARY']);
  const third = record(result, 'P-000127');
  assert.deepEqual([third.consumptionCount, third.outputCount, third.payload.materials], [0, 0, undefined], 'a record with no lines is simply a record');
  assert.deepEqual(result.counts, { production: 3, consumption: 3, outputs: 2, orphans: 0, duplicates: 0 });
});

// ==================================================
// L. LINKAGE
// ==================================================

test('7-9. an orphan line and a duplicate key block - and nothing is attached to a neighbour', () => {
  const orphanConsumption = normalise({ consumption: [...consumptionRows(), { productionSourceRowId: 'P-999', itemCode: 'MAT-001', quantity: 1, unit: 'كجم' }] });
  assert.equal(orphanConsumption.orphans.length, 1);
  assert.equal(orphanConsumption.orphans[0].origin.sheet, 'consumption');
  assert.ok(/No production row has the key "P-999"/.test(orphanConsumption.orphans[0].issue.messageEn));
  assert.equal(record(orphanConsumption, 'P-000125').consumptionCount, 2, 'the orphan was not attached to anyone');
  const orphanOutput = normalise({ outputs: [...outputRows(), { productionSourceRowId: '', itemCode: 'FG-001', quantity: 1, unit: 'طن', outputType: 'PRIMARY' }] });
  assert.equal(orphanOutput.orphans.length, 1);
  assert.ok(/key is blank/.test(orphanOutput.orphans[0].issue.messageEn));
  const duplicate = normalise({ production: [...productionRows(), { sourceRowId: 'P-000125', stageType: 'mixing', 'Production Quantity': 1 }] });
  assert.equal(duplicate.counts.duplicates, 2);
  const blocked = duplicate.records.filter((r: any) => r.sourceRowId === 'P-000125');
  assert.equal(blocked.length, 2);
  for (const r of blocked) assert.ok(r.issues.some((i: any) => /used by more than one production row/.test(i.messageEn)));
  assert.ok(duplicate.orphans.some((o: any) => /duplicated in the Production sheet/.test(o.issue.messageEn)), 'its lines cannot be attributed either');
});

test('L2. a blank key, a missing Production sheet and a repeated line id are all reported', () => {
  const blankKey = normalise({ production: [{ sourceRowId: '', stageType: 'mixing' }] });
  assert.ok(blankKey.records[0].issues.some((i: any) => /relationship key \(sourceRowId\) is blank/.test(i.messageEn)));
  const noProduction = wb.normaliseWorkbook({ production: null, consumption: sheet('consumption', consumptionRows()), outputs: null });
  assert.ok(noProduction.sheetIssues.some((i: any) => /Production sheet is missing/.test(i.messageEn)));
  assert.equal(noProduction.orphans.length, 3, 'every line is an orphan without it');
  const repeated = normalise({ consumption: [
    { productionSourceRowId: 'P-000125', itemCode: 'MAT-001', quantity: 1, unit: 'كجم', lineId: 'L1' },
    { productionSourceRowId: 'P-000125', itemCode: 'MAT-002', quantity: 2, unit: 'كجم', lineId: 'L1' },
  ] });
  assert.ok(record(repeated, 'P-000125').issues.some((i: any) => /Line id "L1" is used twice/.test(i.messageEn)));
});

test('10-12. one bad line belongs to one record - every other record still imports', () => {
  const result = normalise({ consumption: [
    { productionSourceRowId: 'P-000125', itemCode: 'MAT-001', quantity: 50, unit: 'كجم', lineId: 'L1' },
    { productionSourceRowId: 'P-000126', itemCode: 'MAT-001', quantity: 30, unit: 'kg', lineId: 'L1' },
    { productionSourceRowId: 'P-000127', itemCode: 'MAT-001', quantity: 20, unit: 'كجم', lineId: 'L1' },
  ] });
  const ctx: any = { ...masters(), operations: [{ id: 'op-mix', code: 'OP-MIX', legacyStageKey: 'mixing', active: true, allowedEquipmentCategoryIds: [] }] };
  const idx = indexes();
  const rows = result.records.map((r: any) => {
    const row = ip.createImportRow('production', r.sourceRowNumber, r.payload, `production:${r.sourceRowId}`);
    const validation = iv.resolveAndValidateImportRow('production', ip.rowPayload(row), ctx, idx);
    return ip.applyValidation(row, { errors: [...wb.recordIssues(r), ...validation.errors], warnings: validation.warnings, normalized: validation.normalized });
  });
  const session = ip.createImportSession({ importId: 'IMP-WB', sourceFile: 'period.xlsx', createdBy: 'u1', createdAt: '2026-09-16T00:00:00.000Z', rows });
  const plan = ip.planImport(session);
  assert.deepEqual(plan.willImport.map((r: any) => r.rowId), ['production:P-000125', 'production:P-000127'], 'the unknown unit blocks only its own record');
  assert.equal(plan.willRemain[0].rowId, 'production:P-000126');
  assert.ok(plan.willRemain[0].errors.some((e: any) => /not an approved unit/.test(e.messageEn)));
});

// ==================================================
// M. MAPPING
// ==================================================

test('22-25. mapping is exact, alias, manual or ignored - and a missing required column blocks the sheet', () => {
  const auto = wb.buildSheetMapping('production', ['sourceRowId', 'Job Code', 'كود العميل', 'Some Unknown Column', 'stageType']);
  assert.deepEqual(auto.columns.map((c: any) => [c.sourceColumn, c.field, c.method]), [
    ['sourceRowId', 'sourceRowId', 'EXACT'],
    // The field's own name, written with a space - still the exact field, not a guess.
    ['Job Code', 'jobCode', 'EXACT'],
    // A listed alias of a different spelling entirely.
    ['كود العميل', 'customerCode', 'ALIAS'],
    ['Some Unknown Column', null, 'UNMAPPED'],
    ['stageType', 'stageType', 'EXACT'],
  ]);
  assert.deepEqual(auto.missingRequired, [], 'an unknown OPTIONAL column is simply ignored');
  const manual = wb.buildSheetMapping('production', ['كود أمر التشغيل', 'sourceRowId', 'stageType'], { 'كود أمر التشغيل': 'jobCode' });
  assert.deepEqual(manual.columns[0], { sourceColumn: 'كود أمر التشغيل', field: 'jobCode', method: 'MANUAL' });
  assert.equal(wb.applySheetMapping({ 'كود أمر التشغيل': 'JOB-2026-001', sourceRowId: 'P-1', stageType: 'mixing' }, manual).jobCode, 'JOB-2026-001');
  const override = wb.buildSheetMapping('production', ['Job Code'], { 'Job Code': null });
  assert.deepEqual([override.columns[0].field, override.columns[0].method], [null, 'IGNORED'], 'a manual decision overrides the automatic one');
  const missing = wb.buildSheetMapping('consumption', ['quantity', 'unit']);
  assert.deepEqual(missing.missingRequired, ['productionSourceRowId'], 'a required column that maps to nothing is reported');
  const result = wb.normaliseWorkbook({ production: sheet('production', productionRows()), consumption: { rows: [{ quantity: 1, unit: 'كجم' }], mapping: missing }, outputs: null });
  assert.ok(result.sheetIssues.some((i: any) => /required column is not mapped/.test(i.messageEn)));
});

// ==================================================
// E. EQUIVALENCE AND RESOLUTION
// ==================================================

const masters = () => deepFreeze({
  products: [{ id: 'p1', code: 'FG-001', name: 'Finished' }],
  materials: [{ id: 'm1', code: 'MAT-001', name: 'Clay' }, { id: 'm2', code: 'MAT-002', name: 'Acid' }],
  customers: [],
  jobReferences: [{ id: 'j1', code: 'JOB-2026-001', status: 'ACTIVE', active: true }],
  batches: [{ id: 'b1', batchNumber: 'B-001', jobReferenceId: 'j1', active: true }],
  boms: [], bomVersions: [], routings: [], routingVersions: [],
  operations: [{ id: 'op-mix', code: 'OP-MIX', nameAr: 'الخلط', legacyStageKey: 'mixing', active: true, allowedEquipmentCategoryIds: [] }],
  equipment: [], costCenters: [], accounts: [], employees: [],
  logicalItems: [],
});
const indexes = () => rr.buildReferenceIndexes(masters());

test('13-17. business codes resolve inside every sheet - item, batch, job and operation', () => {
  const result = normalise();
  const row = record(result, 'P-000125');
  const resolved = rr.resolveRowReferences('production', row.payload, indexes(), {});
  assert.equal(resolved.payload.jobReferenceId, 'j1');
  assert.equal(resolved.payload.batchId, 'b1');
  assert.equal(resolved.payload.operationId, 'op-mix');
  assert.equal((resolved.payload.materials as any[])[0].materialId, 'm1', 'nested consumption item');
  assert.equal((resolved.payload.materials as any[])[1].batchId, 'b1', 'nested input batch');
  assert.equal((resolved.payload.productionOutputs as any[])[0].itemId, 'p1', 'nested output item');
  assert.equal((resolved.payload.productionOutputs as any[])[0].batchId, 'b1', 'nested output batch');
});

test('18-19. the legacy JSON mode still works, and both shapes produce the SAME payload', () => {
  const ctx: any = { ...masters(), operations: masters().operations };
  const idx = indexes();
  const fromWorkbook = record(normalise({ production: [productionRows()[0]], consumption: consumptionRows().filter((c) => c.productionSourceRowId === 'P-000125'), outputs: outputRows().filter((o) => o.productionSourceRowId === 'P-000125') }), 'P-000125');
  const fromJson = {
    sourceRowId: 'P-000125', date: '2026-01-05', stageType: 'mixing', jobCode: 'JOB-2026-001', batchNumber: 'B-001', productionQuantity: 10, productionUnit: 'طن', operationCode: 'OP-MIX',
    materials: [
      { itemCode: 'MAT-001', quantity: 50, unit: 'كجم', componentType: 'BASE', lineId: 'L1' },
      { itemCode: 'MAT-002', quantity: 5, unit: 'كجم', componentType: 'ADDITIVE', lineId: 'L2', batchNumber: 'B-001' },
    ],
    productionOutputs: [{ itemCode: 'FG-001', batchNumber: 'B-001', quantity: 2, unit: 'طن', outputType: 'PRIMARY', lineId: 'L1' }],
  };
  const a = iv.resolveAndValidateImportRow('production', fromWorkbook.payload, ctx, idx);
  const b = iv.resolveAndValidateImportRow('production', fromJson, ctx, idx);
  assert.deepEqual(a.errors, [], JSON.stringify(a.errors));
  assert.deepEqual(b.errors, [], JSON.stringify(b.errors));
  const compare = (n: any) => ({
    job: n.jobReferenceId, batch: n.batchId, operation: n.operationId, quantity: n.productionQuantity,
    materials: (n.materials ?? []).map((m: any) => [m.materialId, m.quantity, m.unit, m.componentType, m.batchId ?? null]),
    outputs: (n.productionOutputs ?? []).map((o: any) => [o.itemId, o.quantity, o.unit, o.outputType, o.batchId]),
    inputBatches: n.genealogyInputBatchIds, outputBatches: n.genealogyOutputBatchIds,
  });
  assert.deepEqual(compare(a.normalized), compare(b.normalized), 'one model, one rule set - the input shape changes nothing');
});

// ==================================================
// S. SAFETY
// ==================================================

test('20-21. every contributing row keeps its sheet, its row number and its untouched values', () => {
  const result = normalise();
  const first = record(result, 'P-000125');
  assert.deepEqual(first.origins.map((o: any) => [o.sheet, o.sourceRowNumber]), [['production', 2], ['consumption', 2], ['consumption', 3], ['outputs', 2]]);
  assert.deepEqual(first.origins[0].originalRowData, productionRows()[0], 'the production row exactly as the sheet had it');
  assert.deepEqual(first.origins[1].originalRowData, consumptionRows()[0], 'and each line, with its original column names');
  const report = wb.workbookIssueReport(normalise({ consumption: [{ productionSourceRowId: 'P-999', itemCode: 'X', quantity: 1, unit: 'كجم' }] }));
  assert.deepEqual(report.map((i: any) => [i.sheet, i.sourceRowNumber, i.sourceRowId, i.field]), [['consumption', 2, 'P-999', 'productionSourceRowId']]);
});

test('26-29. the workbook adds no second engine: same rows, same statuses, same write path, same audit', () => {
  const pure = readCode(PURE);
  assert.equal(/validateJobReference|validateActualConsumption|validateProductionGenealogy|classifyImportedUom/.test(pure), false, 'it validates no business rule of its own');
  assert.equal(/fetchMasterData|firebase|addDoc|setDoc/.test(pure), false, 'and reads and writes nothing');
  assert.ok(/resolveAndValidateImportRow/.test(readCode(PANEL)), 'rows still go through the one pipeline');
  const panel = readCode(PANEL);
  assert.ok(/normaliseWorkbook\(/.test(panel) && /buildSheetMapping\(/.test(panel));
  assert.ok(/mode === 'workbook'/.test(panel) && /mode === 'sheet'/.test(panel), 'both modes stay available');
  assert.ok(/setSession\(buildWorkbookSession\(sheetRows, manual, context, indexes, mappingCache, workbookFile, session\.importId\)\)/.test(panel), 'a mapping change revalidates under the same import id');
  for (const id of ['entity-import-workbook', 'entity-import-relationships', 'entity-import-workbook-issues', 'entity-import-mode']) assert.ok(panel.includes(`id="${id}"`), id);
  const service = readCode(SERVICE);
  assert.ok(/createStageRecord\(|createProductionRecord\(/.test(service), 'one record, one existing write');
  assert.ok(/consumptionLine|outputLine/.test(service) && /cannot be written on its own/.test(service), 'an orphan line is never written alone');
  assert.equal((readCode('src/components/admin/DataImportView.tsx').match(/<EntityImportPanel/g) ?? []).length, 1, 'still inside the existing import centre');
});

test('S2. no new collection and no rules change for the workbook mode', () => {
  // The workbook key never reaches the database, and no rule mentions it.
  assert.equal(/sourceRowId|productionSourceRowId/i.test(readSource('firestore.rules')), false);
  assert.equal(/sourceRowId/.test(readCode('src/services/entityImportService.ts')), false, 'the workbook key is never written');
  assert.equal(/collection\(|MASTER_DATA_COLLECTIONS/.test(readCode(PURE)), false);
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

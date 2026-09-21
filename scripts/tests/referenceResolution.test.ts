/**
 * BUSINESS CODE / EXTERNAL CODE MAPPING - Phase 1 Step 8C-3.
 *
 * R  resolution: internal id, exact code, external reference, approved mapping, suggestion
 * A  ambiguity: duplicate code, ambiguous external reference, not found - never guessed
 * N  nested: components, consumption lines, outputs, routing steps
 * E  entities: product, material, customer, job, sub-job, batch, BOM, routing, operation, equipment
 * S  safety: ids preserved, codes not rewritten, permissions, audit, one pipeline
 *
 * Run: npx tsx scripts/tests/referenceResolution.test.ts
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

console.log('referenceResolution.test.ts');

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

let rr: any;
let iv: any;
let li: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  rr = await load('src/services/referenceResolutionPure.ts');
  iv = await load('src/services/importEntityValidationPure.ts');
  li = await load('src/services/logicalItemPure.ts');
}

const PURE = 'src/services/referenceResolutionPure.ts';
const VALIDATION = 'src/services/importEntityValidationPure.ts';
const SERVICE = 'src/services/entityImportService.ts';
const PANEL = 'src/components/admin/EntityImportPanel.tsx';

const masters = () => deepFreeze({
  products: [
    { id: 'p1', code: 'BFC1501', name: 'Brick BFC1501', externalRefs: [{ system: 'odoo', model: 'product.product', externalId: '123' }] },
    { id: 'p2', code: 'FG-001', name: 'Finished 001' },
    { id: 'p3', code: '00125', name: 'Leading zero product' },
    { id: 'p4', code: '125', name: 'Plain 125' },
  ],
  materials: [
    { id: 'm1', code: 'MAT-001', name: 'Clay' },
    { id: 'm2', code: 'MAT-002', name: 'Kaolin' },
    { id: 'm3', code: 'DUP', name: 'First duplicate' },
    { id: 'm4', code: 'DUP', name: 'Second duplicate' },
  ],
  customers: [{ id: 'c1', code: 'CUST-005', name: 'Customer 5' }],
  employees: [{ id: 'e1', code: 'EMP-1', name: 'Employee 1' }],
  jobReferences: [
    { id: 'j1', code: 'JOB-2026-001', customerId: 'c1', status: 'ACTIVE', active: true },
    { id: 'j2', code: 'JOB-2026-001-A', customerId: 'c1', status: 'ACTIVE', active: true, parentJobReferenceId: 'j1' },
  ],
  batches: [
    { id: 'b1', batchNumber: 'B-001', jobReferenceId: 'j1', active: true },
    { id: 'b2', batchNumber: 'B-001', jobReferenceId: 'j2', active: true },
    { id: 'b3', batchNumber: 'B-777', active: true },
  ],
  boms: [{ id: 'bom1', code: 'BOM-BFC1501', itemSource: 'products', itemId: 'p1', active: true }],
  bomVersions: [{ id: 'bv1', bomId: 'bom1', versionCode: 'V2', status: 'ACTIVE', components: [] }],
  routings: [{ id: 'rt1', code: 'RT-1', logicalItemId: 'li1', active: true }],
  routingVersions: [{ id: 'rv1', routingId: 'rt1', versionCode: 'R1', status: 'ACTIVE', steps: [] }],
  operations: [{ id: 'op-cmill', code: 'OP-CMILL', nameAr: 'الطحن', legacyStageKey: 'chinese_mills', active: true, allowedEquipmentCategoryIds: [] }],
  equipment: [{ id: 'eq1', code: 'CM-001', name: 'Chinese mill 1', categoryId: 'mills', active: true }],
  costCenters: [{ id: 'cc1', sheet1Code: '601', nameAr: 'مركز 601' }],
  accounts: [{ id: 'acc1', code: '5101', name: 'Account 5101' }],
  logicalItems: [{ id: 'li1', productId: 'p1', materialId: null, status: 'ACTIVE' }],
});

const indexes = () => {
  const m = masters();
  return rr.buildReferenceIndexes({ ...m, logicalItems: m.logicalItems.map((x: any) => li.readLogicalItem(x)) });
};
const resolve = (kind: string, row: Record<string, unknown>, cache?: any) => rr.resolveRowReferences(kind, row, indexes(), { cache });
const byField = (result: any, field: string) => result.resolutions.find((r: any) => r.field === field);

// ==================================================
// R. RESOLUTION
// ==================================================

test('1-3. exact product, material and customer codes resolve to their internal ids', () => {
  const r = resolve('production', { stageType: 'chinese_mills', ProductCode: 'BFC1501', 'Customer Code': 'CUST-005' });
  assert.equal(r.payload.productId, 'p1');
  assert.equal(r.payload.customerId, 'c1');
  assert.deepEqual([byField(r, 'productCode').method, byField(r, 'productCode').status, byField(r, 'productCode').targetCode], ['EXACT_CODE', 'RESOLVED', 'BFC1501']);
  const material = resolve('boms', { itemSource: 'materials', item_code: 'MAT-001' });
  assert.equal(material.payload.itemId, 'm1');
  // The column name may be written in any of the accepted spellings.
  for (const key of ['productCode', 'Product Code', 'product_code', 'PRODUCTCODE']) {
    assert.equal(resolve('production', { stageType: 'mixing', [key]: 'BFC1501' }).payload.productId, 'p1', key);
  }
});

test('4-6. job, parent job and batch (in that job) resolve', () => {
  const r = resolve('production', { stageType: 'mixing', jobCode: 'JOB-2026-001', batchNumber: 'B-001' });
  assert.equal(r.payload.jobReferenceId, 'j1');
  assert.equal(r.payload.batchId, 'b1', 'the batch of THIS job, not the sub-job one');
  const sub = resolve('jobReferences', { code: 'JOB-2026-001-B', 'Parent Job Code': 'JOB-2026-001' });
  assert.equal(sub.payload.parentJobReferenceId, 'j1');
  const other = resolve('production', { stageType: 'mixing', jobCode: 'JOB-2026-001-A', batchNumber: 'B-001' });
  assert.equal(other.payload.batchId, 'b2', 'the same number resolves per job context');
  const unbound = resolve('production', { stageType: 'mixing', jobCode: 'JOB-2026-001', batchNumber: 'B-777' });
  assert.equal(unbound.payload.batchId, 'b3', 'a batch with no job is still selectable');
});

test('7-10. BOM, BOM version, routing and routing version codes resolve, versions within their parent', () => {
  const bom = resolve('bomVersions', { bomCode: 'BOM-BFC1501', versionCode: 'V3' });
  assert.equal(bom.payload.bomId, 'bom1');
  const production = resolve('production', { stageType: 'mixing', bomCode: 'BOM-BFC1501', 'BOM Version Code': 'V2' });
  assert.equal(production.payload.bomVersionId, 'bv1');
  const routing = resolve('routingVersions', { routingCode: 'RT-1', versionCode: 'R2' });
  assert.equal(routing.payload.routingId, 'rt1');
  const wrongParent = resolve('production', { stageType: 'mixing', bomCode: 'BOM-BFC1501', bomVersionCode: 'R1' });
  assert.equal(byField(wrongParent, 'bomVersionCode').status, 'NOT_FOUND', 'a version of another BOM is not accepted');
});

test('11-12. operation and equipment codes resolve from their existing masters', () => {
  const r = resolve('production', { stageType: 'chinese_mills', operationCode: 'OP-CMILL', millCode: 'CM-001' });
  assert.equal(r.payload.operationId, 'op-cmill');
  assert.equal(r.payload.millId, 'eq1');
  const ghost = resolve('production', { stageType: 'chinese_mills', operationCode: 'OP-GHOST' });
  // Nothing similar enough to suggest, so it is simply not found - either way it is never applied.
  assert.ok(['NOT_FOUND', 'SUGGESTION_PENDING'].includes(byField(ghost, 'operationCode').status));
  assert.equal(ghost.payload.operationId, undefined);
  const nearMiss = resolve('production', { stageType: 'chinese_mills', millCode: 'CM-01' });
  assert.deepEqual([byField(nearMiss, 'millCode').status, nearMiss.payload.millId], ['SUGGESTION_PENDING', undefined], 'a close code is offered, never applied');
});

test('13. an exact Odoo external reference resolves - and the Odoo id never becomes the document id', () => {
  const r = resolve('production', { stageType: 'mixing', productCode: 'UNKNOWN-CODE', externalSystem: 'odoo', externalModel: 'product.product', externalId: '123' });
  const resolution = byField(r, 'productCode');
  assert.deepEqual([resolution.method, resolution.status, resolution.targetId], ['EXTERNAL_REFERENCE', 'RESOLVED', 'p1']);
  assert.equal(r.payload.productId, 'p1');
  assert.notEqual(r.payload.productId, '123');
  assert.ok(/externalIdentityKey|readExternalReferences/.test(readCode(PURE)), 'the Step 1A architecture is reused');
});

test('14-16. not found, duplicate and ambiguous references all block - nothing is guessed', () => {
  const notFound = resolve('boms', { itemSource: 'materials', itemCode: 'XYZ999' });
  const nf = byField(notFound, 'itemCode');
  assert.ok(['NOT_FOUND', 'SUGGESTION_PENDING'].includes(nf.status));
  assert.equal(notFound.payload.itemId, undefined);
  const duplicate = resolve('boms', { itemSource: 'materials', itemCode: 'DUP' });
  const dup = byField(duplicate, 'itemCode');
  assert.deepEqual([dup.status, dup.targetId, dup.candidates.length], ['DUPLICATE_BUSINESS_CODE', null, 2]);
  assert.ok(dup.messageEn.includes('duplicated in the master data'));
  const issues = rr.resolutionIssues([nf, dup]);
  assert.equal(issues.errors.length, 2, 'both block the row');
  assert.deepEqual(issues.warnings, []);
});

test('17-18. a fuzzy suggestion is never applied, and an approved mapping is reused for the whole import', () => {
  const suggestion = resolve('production', { stageType: 'mixing', productCode: 'BFC150' });
  const s = byField(suggestion, 'productCode');
  assert.equal(s.status, 'SUGGESTION_PENDING');
  assert.equal(s.method, 'FUZZY_SUGGESTION');
  assert.equal(s.targetId, null, 'a suggestion is shown, never committed');
  assert.ok(s.candidates.length > 0 && s.candidates[0].id === 'p1');
  // Approve it once; every later row naming the same value reuses it.
  const cache = rr.approveReferenceMapping(new Map(), 'product', 'BFC150', 'p1');
  const later = resolve('production', { stageType: 'mixing', productCode: 'BFC150' }, cache);
  assert.deepEqual([byField(later, 'productCode').method, byField(later, 'productCode').status, later.payload.productId], ['APPROVED_MAPPING', 'RESOLVED', 'p1']);
  assert.equal(rr.cacheKey('product', ' bfc150 '), rr.cacheKey('product', 'BFC150'), 'the same value, however it is typed');
});

// ==================================================
// N. NESTED
// ==================================================

test('19-22. nested component, consumption and output codes resolve, including the output batch', () => {
  const version = resolve('bomVersions', {
    bomCode: 'BOM-BFC1501', versionCode: 'V3', basisQuantity: 1000, basisUnit: 'كجم',
    components: [{ itemCode: 'MAT-001', quantity: 100, unit: 'كجم', componentType: 'BASE' }],
  });
  assert.deepEqual([(version.payload.components as any[])[0].itemId, (version.payload.components as any[])[0].itemSource], ['m1', 'materials']);
  const production = resolve('production', {
    stageType: 'mixing', jobCode: 'JOB-2026-001',
    materials: [{ itemCode: 'MAT-001', quantity: 50, unit: 'كجم', componentType: 'ADDITIVE', batchNumber: 'B-001' }],
    productionOutputs: [{ itemCode: 'FG-001', batchNumber: 'B-001', quantity: 2, unit: 'طن', outputType: 'PRIMARY' }],
  });
  const line = (production.payload.materials as any[])[0];
  const output = (production.payload.productionOutputs as any[])[0];
  assert.deepEqual([line.materialId, line.batchId, line.componentType], ['m1', 'b1', 'ADDITIVE']);
  assert.deepEqual([output.itemId, output.itemSource, output.batchId, output.outputType], ['p2', 'products', 'b1', 'PRIMARY']);
  assert.ok(production.resolutions.some((r: any) => r.field === 'materials.1.itemCode'));
  assert.ok(production.resolutions.some((r: any) => r.field === 'productionOutputs.1.batchNumber'));
  const steps = resolve('routingVersions', { routingCode: 'RT-1', versionCode: 'R2', steps: [{ operationCode: 'OP-CMILL', equipmentCode: 'CM-001', sequence: 1 }] });
  assert.deepEqual([(steps.payload.steps as any[])[0].operationId, (steps.payload.steps as any[])[0].equipmentId], ['op-cmill', 'eq1']);
});

// ==================================================
// S. SAFETY
// ==================================================

test('23. a leading zero is part of the identifier - 00125 never becomes 125', () => {
  assert.equal(resolve('production', { stageType: 'mixing', productCode: '00125' }).payload.productId, 'p3');
  assert.equal(resolve('production', { stageType: 'mixing', productCode: '125' }).payload.productId, 'p4');
  assert.equal(resolve('production', { stageType: 'mixing', productCode: ' bfc1501 ' }).payload.productId, 'p1', 'surrounding spaces and case only');
  assert.ok(/normalizeCode/.test(readCode(PURE)) && !/replace\(\/\^0\+\//.test(readCode(PURE)), 'no zero stripping');
});

test('24-25. UOM behaviour and partial import are unchanged - resolution only adds ids', () => {
  const ctx: any = { ...masters(), logicalItems: [], pendingSameKind: [] };
  const idx = indexes();
  const good = iv.resolveAndValidateImportRow('production', {
    stageType: 'mixing', jobCode: 'JOB-2026-001', productionQuantity: 5,
    materials: [{ itemCode: 'MAT-001', quantity: 50, unit: 'شيكارة' }],
  }, { ...ctx, operations: [{ id: 'op-mix', code: 'OP-MIX', legacyStageKey: 'mixing', active: true, allowedEquipmentCategoryIds: [] }] }, idx);
  assert.ok(good.warnings.some((w: any) => /legacy spelling/.test(w.messageEn)), 'Step 8 legacy spelling still warns');
  const badUnit = iv.resolveAndValidateImportRow('production', {
    stageType: 'mixing', jobCode: 'JOB-2026-001', productionQuantity: 5,
    materials: [{ itemCode: 'MAT-001', quantity: 50, unit: 'kg' }],
  }, ctx, idx);
  assert.ok(badUnit.errors.some((e: any) => /not an approved unit/.test(e.messageEn)), 'an unknown unit still blocks');
  assert.equal(badUnit.normalized, null);
  // A row that already carries ids resolves to itself - nothing that worked before changes.
  const byId = iv.resolveAndValidateImportRow('batches', { batchNumber: 'B-NEW', productId: 'p1', jobReferenceId: 'j1' }, ctx, idx);
  assert.deepEqual(byId.errors, []);
  assert.equal(byId.resolvedPayload.productId, 'p1');
});

test('26. resolution creates nothing: no master record is added, and the add right stays separate', () => {
  const code = readCode(PURE) + readCode(VALIDATION);
  assert.equal(/createMasterDataItem|createMaterial|addDoc|setDoc/.test(code), false, 'the resolver never creates a record');
  const panel = readCode(PANEL);
  assert.ok(/hasPermission\('excel\.import'\)/.test(panel), 'the existing import right');
  assert.equal(/masterData\.inlineAdd|createMasterDataItem/.test(panel), false, 'no Master Data creation from the import panel');
});

test('27. every mapping decision is auditable: field, value, entity, method, status and target', () => {
  const r = resolve('production', { stageType: 'chinese_mills', productCode: 'BFC1501', operationCode: 'OP-CMILL' });
  const line = rr.describeResolution(byField(r, 'productCode'));
  assert.ok(/productCode="BFC1501" product EXACT_CODE RESOLVED -> BFC1501 \(p1\)/.test(line), line);
  const service = readCode(SERVICE);
  assert.ok(/describeResolution/.test(service) && /references: \$\{resolutionTrail\.join\('; '\)\}/.test(service), 'the trail is in the row audit line');
  assert.ok(/logAuditAction\(/.test(service));
  assert.equal(/mappingAudit|new audit|mappingHistoryCollection/i.test(service + readCode(PURE)), false, 'no parallel audit system');
});

test('P. the dictionaries are built once per session, and the panel resolves through the one pipeline', () => {
  const service = readCode(SERVICE);
  assert.ok(/export async function buildImportReferenceIndexes\(/.test(service));
  assert.ok(/resolveAndValidateImportRow\(row\.entityKind, payload, \{ \.\.\.rowContext, pendingSameKind \}, options\.indexes, options\.mappingCache\)/.test(readCode('src/services/entityImportExecutionPure.ts')), 'the final revalidation resolves too');
  const panel = readCode(PANEL);
  assert.ok(/buildImportReferenceIndexes\(ctx, stageType\)/.test(panel));
  assert.ok(/approveReferenceMapping\(mappingCache, resolution\.entity, resolution\.sourceValue, targetId\)/.test(panel), 'approving once applies to the whole import');
  assert.equal(/fetchMasterData/.test(readCode(PURE)), false, 'the resolver reads nothing itself');
  const indexed = indexes();
  assert.equal(indexed.product.byCode.get('BFC1501').length, 1, 'code dictionary');
  assert.equal(indexed.material.byCode.get('DUP').length, 2, 'duplicates are visible, not collapsed');
  assert.equal(indexed.batch.codeField, 'batchNumber', "a batch's identity is its number");
  assert.equal(indexed.costCenter.byCode.get('601')[0].id, 'cc1', 'the hierarchy code field');
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

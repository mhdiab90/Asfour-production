/**
 * ASFOUR JOB REFERENCE + BATCH FOUNDATION - Phase 1 Step 1E.
 *
 * J  Job Reference: ASFOUR identity, standalone or externally linked, optional
 *    product/customer, minimal status, generic source
 * B  Batch: identity, product/job links, the explicit duplicate scope, no
 *    generated numbers, never part of a product code
 * H  historical safety: legacy order and batch fields, record models, stage
 *    collections and importers untouched
 * U  reuse: one Master Data group on the shared tab engine, existing
 *    permission gate and audited services, rules in the existing pattern
 *
 * Pure modules run as shipped; the screen imports Firebase, so its wiring is
 * pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/jobBatch.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Phase 1 Step 8A: stageRecordService.ts may differ from HEAD only by the approved unit-label correction.
import { stageRecordServiceChangedBeyondApproved } from './stageRecordServiceBaseline';
import { changedBeyondStep8C5 } from './step8c5Baseline';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('jobBatch.test.ts');

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
function interfaceBlock(name: string): string {
  const types = readCode('src/types/index.ts').replace(/[ \t]*\/\/.*$/gm, '');
  const start = types.search(new RegExp(`export interface ${name}\\b`));
  assert.ok(start >= 0, `${name} interface exists`);
  return types.slice(start, types.indexOf('\n}', start));
}

let jb: any;
let ext: any;
let reg: any;
let panels: any;
let stageBounds: any;
let stageConfig: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  jb = await load('src/services/jobBatchPure.ts');
  ext = await load('src/services/externalReferencesPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  panels = await load('src/services/masterDataPanelsPure.ts');
  stageBounds = await load('src/services/stageQueryBoundsPure.ts');
  stageConfig = await load('src/services/productionStageConfig.ts').catch(() => null);
}

const JB = 'src/services/jobBatchPure.ts';
const VIEW = 'src/components/masterData/MasterDataView.tsx';
const fields = (v: any) => v.issues.map((i: any) => i.field);
const products = new Set(['prodA', 'prodB']);
const customers = new Set(['cust1']);
const jobs = new Set(['job1', 'job2']);

const odooRef = { system: 'odoo', model: 'mrp.production', externalId: '4711', externalCode: 'WH/MO/00012' };

// ==================================================
// J. JOB REFERENCE
// ==================================================

test('1. a Job Reference has a stable internal identity: the document id, with the business code as a separate field', () => {
  const block = interfaceBlock('JobReference');
  assert.ok(block.includes('id?: string;') && block.includes('code: string;'));
  const payload = jb.jobReferencePayloadForSave({ id: 'doc-1', code: ' JR-2026-001 ', status: 'ACTIVE', createdAt: 'x', updatedAt: 'y', externalRefs: [odooRef] });
  // Phase 1 Step 8C adds the optional sub-job link (the MAIN job this one belongs to) - still no id, no quantities.
  assert.deepEqual(Object.keys(payload).sort(), ['active', 'code', 'customerId', 'notes', 'parentJobReferenceId', 'productId', 'sourceSystem', 'status']);
  assert.equal('id' in payload, false, 'the id is never written as data - Firestore assigns it');
  assert.equal(payload.code, 'JR-2026-001');
  const svc = readCode('src/services/masterDataService.ts');
  assert.ok(/await safeAddDoc\(collection\(db, collectionName\)/.test(svc) || /addDoc\(collection\(db, collectionName\)/.test(svc), 'the shared create uses an auto id');
});

test('2. a Job Reference works without Odoo: source defaults to asfour, no external reference required', () => {
  const v = jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'DRAFT' });
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  assert.equal(jb.jobReferencePayloadForSave({ code: 'JR-1', status: 'DRAFT' }).sourceSystem, 'asfour');
  assert.equal(jb.ASFOUR_SOURCE_SYSTEM, 'asfour');
});

test('3. a Job Reference can carry Step 1A externalRefs, and one external job maps to one ASFOUR job', () => {
  assert.equal(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE', sourceSystem: 'odoo', externalRefs: [odooRef] }).valid, true);
  const stored = [{ id: 'j-other', code: 'JR-9', status: 'ACTIVE', sourceSystem: 'odoo', externalRefs: [odooRef] }];
  assert.deepEqual(fields(jb.validateJobReferenceForSave(stored, { code: 'JR-1', status: 'ACTIVE', externalRefs: [odooRef] })), ['externalRefs'], 'same Odoo MO on two jobs');
  assert.equal(jb.validateJobReferenceForSave(stored, { ...stored[0] }, { editingId: 'j-other' }).valid, true, 'editing the holder itself');
  assert.deepEqual(fields(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE', externalRefs: [{ system: 'Odoo!' }] })), ['externalRefs', 'externalRefs'], 'invalid refs are reported through the Step 1A rules');
  assert.equal(/validateExternalReference|findExternalIdentityConflicts/.test(readCode(JB)), true, 'Step 1A helpers reused');
});

test('4. the external identity stays outside the ASFOUR identity - no odoo* fields, refs never written by the save', () => {
  for (const name of ['JobReference', 'Batch']) {
    const block = interfaceBlock(name);
    assert.ok(block.includes('extends WithExternalReferences'), name);
    assert.equal(/odoo/i.test(block), false, `${name}: no Odoo-specific field`);
  }
  const code = readCode(JB);
  assert.equal(/odooJobId|odooMoId|odooManufacturingOrderId|fetch\(|axios|xmlrpc|jsonrpc/i.test(code), false, 'no Odoo ids or network calls');
  const payload = jb.jobReferencePayloadForSave({ code: 'JR-1', status: 'ACTIVE', externalRefs: [odooRef] });
  assert.equal('externalRefs' in payload, false, 'the merge update keeps stored references; the form never writes them');
  assert.equal(payload.code, 'JR-1', 'the ASFOUR code is not replaced by the external code');
});

test('5. a Job Reference can optionally reference a Product by id (never by code)', () => {
  assert.equal(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE', productId: 'prodA' }, { knownProductIds: products }).valid, true);
  assert.equal(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE' }, { knownProductIds: products }).valid, true, 'optional');
  assert.deepEqual(fields(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE', productId: 'BFC400100001' }, { knownProductIds: products })), ['productId'], 'a product code is not an id');
  assert.equal(/productCode|productName/.test(interfaceBlock('JobReference')), false, 'no product snapshot');
});

test('6. a Job Reference can optionally reference a Customer by id', () => {
  assert.equal(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE', customerId: 'cust1' }, { knownCustomerIds: customers }).valid, true);
  assert.deepEqual(fields(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE', customerId: 'nope' }, { knownCustomerIds: customers })), ['customerId']);
  assert.equal(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE', customerId: 'unloaded' }, { knownCustomerIds: null }).valid, true, 'an unloaded list refuses nothing');
});

test('7. job status validation: exactly the four minimal statuses', () => {
  assert.deepEqual([...jb.JOB_REFERENCE_STATUSES], ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
  for (const st of jb.JOB_REFERENCE_STATUSES) assert.equal(jb.validateJobReferenceForSave([], { code: 'JR-1', status: st }).valid, true, st);
  assert.deepEqual(fields(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'IN_PROGRESS' })), ['status']);
  assert.deepEqual(fields(jb.validateJobReferenceForSave([], { code: 'JR-1' })), ['status'], 'status is required');
  assert.deepEqual(fields(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE', sourceSystem: 'Odoo ERP' })), ['sourceSystem'], 'generic source key rule');
  assert.ok(ext.isExternalSystemKey('odoo') && ext.isExternalSystemKey('asfour') && !ext.isExternalSystemKey('Odoo ERP'));
});

test('7b. job codes are unique among job references (existing code normalisation, retired included), edits unblocked', () => {
  const stored = [{ id: 'j1', code: 'JR-001', status: 'CANCELLED', active: false }];
  assert.deepEqual(fields(jb.validateJobReferenceForSave(stored, { code: 'jr-001 ', status: 'ACTIVE' })), ['code']);
  assert.equal(jb.validateJobReferenceForSave(stored, { ...stored[0], notes: 'x' }, { editingId: 'j1' }).valid, true);
  assert.deepEqual(fields(jb.validateJobReferenceForSave([], { code: ' ', status: 'ACTIVE' })), ['code']);
});

test('8. legacy customer / manufacturing / request order fields are untouched', () => {
  const production = interfaceBlock('ProductionRecord');
  assert.ok(production.includes('customerOrderNumber?: string;'));
  const mortar = interfaceBlock('MortarConcreteRecord');
  for (const f of ['batchNumber?: string;', 'manufacturingOrderNumber?: string;', 'customerRequestNumber?: string;']) assert.ok(mortar.includes(f), f);
  assert.ok(interfaceBlock('SortingRecord').includes('customerOrderNumber?: string;'));
  assert.equal(/customerOrderNumber|manufacturingOrderNumber|customerRequestNumber/.test(readCode(JB)), false, 'never read, mapped or inferred');
});

test('9. existing production records stay compatible: no record type gained a required or job/batch field', () => {
  for (const name of ['ProductionRecord', 'RotaryFurnaceRecord', 'ChineseMillsRecord', 'TubeBallMillsRecord', 'MortarConcreteRecord', 'MixingRecord', 'LightweightFoamRecord', 'SortingRecord', 'UniversalStageRecord']) {
    const block = interfaceBlock(name);
    // Phase 1 Step 5A: new records carry references through the shared mixin only - no fields declared per type.
    assert.equal(/jobReferenceId|batchId\b/.test(block), false, name);
    if (name !== 'UniversalStageRecord') assert.ok(/WithProductionReferences/.test(block), `${name} uses the shared mixin`);
  }
  const mixin = interfaceBlock('WithProductionReferences');
  assert.ok(mixin.includes('jobReferenceId?: string | null;') && mixin.includes('batchId?: string | null;'), 'optional foundation for future writes');
});

// ==================================================
// B. BATCH
// ==================================================

test('10. a Batch has a stable internal identity: document id plus batchNumber', () => {
  const block = interfaceBlock('Batch');
  assert.ok(block.includes('id?: string;') && block.includes('batchNumber: string;') && block.includes('active: boolean;'));
  const payload = jb.batchPayloadForSave({ id: 'b-doc', batchNumber: ' B2026-001 ', createdAt: 'x' });
  assert.deepEqual(Object.keys(payload).sort(), ['active', 'batchNumber', 'jobReferenceId', 'notes', 'productId']);
  assert.equal(payload.batchNumber, 'B2026-001');
});

test('11. the batch number is not part of Product.code - nothing parses, derives or writes a product code', () => {
  const payload = jb.batchPayloadForSave({ batchNumber: 'B2026-001', productId: 'prodA', productCode: 'BFC400100001' });
  assert.equal('productCode' in payload, false);
  assert.equal(payload.batchNumber, 'B2026-001');
  const code = readCode(JB);
  assert.equal(/productCodeParser|parseProductCode|normalizeProductCode|\.code\s*\+|products'/.test(code), false);
  assert.equal(/productCode/.test(interfaceBlock('Batch')), false);
});

test('12. one product can have many batches', () => {
  const stored = [
    { id: 'b1', batchNumber: 'B-001', productId: 'prodA' },
    { id: 'b2', batchNumber: 'B-002', productId: 'prodA' },
  ];
  const v = jb.validateBatchForSave(stored, { batchNumber: 'B-003', productId: 'prodA' }, { knownProductIds: products });
  assert.equal(v.valid, true, JSON.stringify(v.issues));
});

test('13. a batch can exist without a job reference (and without a product)', () => {
  assert.equal(jb.validateBatchForSave([], { batchNumber: 'B-1' }).valid, true);
  assert.equal(jb.batchPayloadForSave({ batchNumber: 'B-1', jobReferenceId: '' }).jobReferenceId, null);
});

test('14. a batch can optionally reference a job reference, which must exist when the list is loaded', () => {
  assert.equal(jb.validateBatchForSave([], { batchNumber: 'B-1', jobReferenceId: 'job1' }, { knownJobReferenceIds: jobs }).valid, true);
  assert.deepEqual(fields(jb.validateBatchForSave([], { batchNumber: 'B-1', jobReferenceId: 'ghost' }, { knownJobReferenceIds: jobs })), ['jobReferenceId']);
});

test('15. a batch can optionally reference a product by id', () => {
  assert.equal(jb.validateBatchForSave([], { batchNumber: 'B-1', productId: 'prodB' }, { knownProductIds: products }).valid, true);
  assert.deepEqual(fields(jb.validateBatchForSave([], { batchNumber: 'B-1', productId: 'BFC400100001' }, { knownProductIds: products })), ['productId']);
});

test('16. duplicate handling follows the explicit scope: number + product + job reference', () => {
  const stored = [{ id: 'b1', batchNumber: 'B-001', productId: 'prodA', jobReferenceId: 'job1', active: false }];
  // Same lot entered twice (retired included, case/space normalised) -> refused.
  assert.deepEqual(fields(jb.validateBatchForSave(stored, { batchNumber: 'b-001 ', productId: 'prodA', jobReferenceId: 'job1' })), ['batchNumber']);
  // Same number, other product / other job / no job -> allowed: no global uniqueness is invented.
  assert.equal(jb.validateBatchForSave(stored, { batchNumber: 'B-001', productId: 'prodB', jobReferenceId: 'job1' }).valid, true, 'another product');
  assert.equal(jb.validateBatchForSave(stored, { batchNumber: 'B-001', productId: 'prodA', jobReferenceId: 'job2' }).valid, true, 'another job');
  assert.equal(jb.validateBatchForSave(stored, { batchNumber: 'B-001', productId: 'prodA' }).valid, true, 'no job is its own scope');
  // Unlinked duplicates are the same lot too.
  assert.deepEqual(fields(jb.validateBatchForSave([{ id: 'u1', batchNumber: 'X-1' }], { batchNumber: 'X-1' })), ['batchNumber']);
  // Editing a batch without changing its scope is never blocked.
  assert.equal(jb.validateBatchForSave(stored, { ...stored[0], notes: 'n' }, { editingId: 'b1' }).valid, true);
  assert.equal(jb.batchDuplicateScopeKey({ batchNumber: 'b-001', productId: 'prodA', jobReferenceId: 'job1' }), jb.batchDuplicateScopeKey(stored[0]));
});

test('17. no automatic batch numbering, and the Date.now() fragment default is not reused', () => {
  assert.equal(/Date\.now|Math\.random|toString\(\)\.slice/.test(readCode(JB)), false);
  const view = readCode(VIEW);
  assert.ok(/setFormData\(\{ batchNumber: '', productId: null, jobReferenceId: null, notes: '', active: true \}\);/.test(view), 'new batches start with an empty, user-entered number');
  const batchForm = view.slice(view.indexOf('id="batch-form"'), view.indexOf('id="equipment-bunker-form"'));
  assert.ok(batchForm.length > 0);
  assert.equal(/Date\.now/.test(batchForm), false);
});

test('18. historical data is not modified: stage collections, stage configs and importers are untouched', () => {
  assert.deepEqual(Object.values(stageBounds.STAGE_COLLECTION_NAMES), [
    'production', 'stage_rotary_furnace', 'stage_chinese_mills', 'stage_tube_ball_mills',
    'stage_mortar_concrete', 'stage_mixing', 'stage_lightweight_foam', 'stage_sorting',
    // Phase 1 Step 8C-5 (approved): three new record types, appended - no existing collection changed.
    'stage_thermal_concrete', 'stage_tunnel_kiln', 'stage_handmade_brick',
  ]);
  const changed = [changedBeyondStep8C5(ROOT, [
    'src/services/productionStageConfig.ts', 'src/services/productionService.ts',
    'src/services/pressingHistoricalImportService.ts', 'src/services/historicalImportService.ts',
    'src/services/genericStageDuplicateIdentityPure.ts', 'src/services/pressingDuplicateIdentityPure.ts',
  ]), stageRecordServiceChangedBeyondApproved(ROOT)].filter(Boolean).join('\n');
  assert.equal(changed, '', `production/import services must be unchanged vs HEAD: ${changed}`);
  const code = readCode(JB);
  assert.equal(/firebase|getDocs|addDoc|setDoc|updateDoc|writeBatch|stage_|'production'/.test(code.replace(/^import type.*$/gm, '')), false, 'pure: no reads or writes');
});

// ==================================================
// U. REUSE
// ==================================================

test('U1. one Jobs & Batches group in the Master Data navigation, on the shared tab engine', () => {
  assert.ok([...panels.PANEL_CATEGORY_IDS].includes('jobsAndBatches'));
  assert.equal([...panels.PANEL_CATEGORY_IDS].includes('jobReferences') || [...panels.PANEL_CATEGORY_IDS].includes('batches'), false);
  assert.deepEqual(reg.subCategories('jobsAndBatches').map((c: any) => c.collection), ['jobReferences', 'batches']);
  assert.equal(reg.navigationCategoryIdForTab('batches', panels.panelCategories()), 'jobsAndBatches');
  const svc = readCode('src/services/masterDataService.ts');
  assert.ok(/jobReferences: 'jobReferences'/.test(svc) && /batches: 'batches'/.test(svc));
  const view = readCode(VIEW);
  assert.equal((view.match(/updateMasterDataItem\(/g) || []).length, 1, 'one shared audited update');
  assert.equal((view.match(/createMasterDataItem\(/g) || []).length, 1, 'one shared audited create');
  const files = fs.readdirSync(path.join(ROOT, 'src/components'), { recursive: true } as any) as string[];
  // BatchAddMasterDataModal is a pre-existing bulk-add modal, unrelated to lots.
  assert.equal(files.some((f) => /job|batch/i.test(String(f)) && !/BatchAddMasterDataModal/.test(String(f))), false, 'no separate Job or Batch screen');
  assert.equal(/'jobs'|'batches'|job-references/.test(readCode('src/App.tsx')), false, 'no new top-level page');
});

test('U2. saves go through the validated shapes behind the existing permission gate; records are retired, never deleted', () => {
  const view = readCode(VIEW);
  assert.ok(/if \(isJobBatchTab\) \{\s*if \(!canImportMasterData\) \{\s*throw new Error/.test(view));
  assert.ok(/validateJobReferenceForSave\(items, formData, context\)/.test(view) && /validateBatchForSave\(items, formData, context\)/.test(view));
  assert.ok(/dataToWrite = activeTab === 'jobReferences' \? jobReferencePayloadForSave\(formData\) : batchPayloadForSave\(formData\);/.test(view));
  assert.ok(/if \(isJobBatchTab\) \{ setDeleteConfirmItem\(null\); return; \}/.test(view));
  assert.ok(/if \(isJobBatchTab && !canImportMasterData\) return;/.test(view));
  // Step 2 appended Bills of Materials to the same gate.
  assert.ok(/const isRetireOnlyTab = isCompletedEquipment \|\| isJobBatchTab\b/.test(view));
  const perms = readCode('src/types/permissions.ts');
  // approval.batch_approve is pre-existing (bulk approval), unrelated to lots.
  assert.equal(/'(job[A-Za-z]*|batches|batch)\./.test(perms), false, 'no new permission keys');
  const svc = readCode('src/services/masterDataService.ts');
  assert.ok(/logAuditAction\('CREATE', collectionName/.test(svc) && /logAuditAction\('UPDATE', collectionName/.test(svc), 'existing audit');
});

test('U3. rules follow the Master Data pattern - signed-in read, admin write, nothing public', () => {
  const rules = readSource('firestore.rules');
  for (const [coll, param] of [['jobReferences', 'jobReferenceId'], ['batches', 'batchId']]) {
    const m = rules.match(new RegExp(`match /${coll}/\\{${param}\\} \\{([\\s\\S]*?)\\n\\s*\\}`));
    assert.ok(m, coll);
    assert.deepEqual(m![1].split('\n').map((l) => l.trim()).filter(Boolean), ['allow read: if isSignedIn();', 'allow write: if isAdmin();'], coll);
  }
});

test('U4. no BOM, routing, genealogy, consumption or costing artefacts', () => {
  const code = readCode(JB) + readCode('src/types/index.ts').slice(readCode('src/types/index.ts').indexOf('export interface JobReference'), readCode('src/types/index.ts').indexOf('export interface Employee'));
  // Phase 1 Step 4 added the job's version REFERENCES (bomVersionId, routingVersionId) - ids only.
  assert.equal(/bom\b|billOfMaterial|routing|routeStep|genealog|parentBatch|consum|cost(ing)?\b|quantity|plannedStart|plannedEnd/i.test(code.replace(/\b(bomVersionId|routingVersionId)\b/g, '')), false);
});

(async () => {
  await bootstrap();
  for (const { name, fn } of registered) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (err: any) {
      console.log(`  FAIL  ${name}`);
      console.log(String(err && err.message ? err.message : err).split('\n').slice(0, 6).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

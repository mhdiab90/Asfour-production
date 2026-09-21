/**
 * ACTUAL PRODUCTION REFERENCE LAYER - Phase 1 Step 5A.
 *
 * R  references on new records: job, batch, logical item, operation, cost centre
 * M  modes: untraced entries behave as before; traced entries validate everything
 * O  operation resolution through the Operation Master (no duplicated mapping)
 * E  equipment and hierarchy validation
 * W  write path: existing writes, merged before, no second path, nothing else written
 * H  historical compatibility and untouched neighbours
 *
 * Pure modules run as shipped; forms and services import Firebase, so their
 * wiring is pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/productionReferences.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Phase 1 Step 8A: stageRecordService.ts may differ from HEAD only by the approved unit-label correction.
import { stageRecordServiceChangedBeyondApproved } from './stageRecordServiceBaseline';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('productionReferences.test.ts');

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
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as any).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

let pr: any;
let ops: any;
let li: any;
let hier: any;
let stageBounds: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  pr = await load('src/services/productionReferencePure.ts');
  ops = await load('src/services/operationMasterPure.ts');
  li = await load('src/services/logicalItemPure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
  stageBounds = await load('src/services/stageQueryBoundsPure.ts');
}

const PURE = 'src/services/productionReferencePure.ts';
const SERVICE = 'src/services/productionReferenceService.ts';
const PANEL = 'src/components/production/ProductionReferencePanel.tsx';
const CONTAINER = 'src/components/production/StageProductionEntryView.tsx';
const FORMS: Record<string, string> = {
  pressing: 'ProductionEntryForm',
  rotary_furnace: 'RotaryFurnaceEntryForm',
  chinese_mills: 'ChineseMillsEntryForm',
  tube_ball_mills: 'TubeBallMillsEntryForm',
  mortar_concrete: 'MortarConcreteEntryForm',
  mixing: 'MixingEntryForm',
  lightweight_foam: 'LightweightFoamEntryForm',
  sorting: 'SortingEntryForm',
};
const fields = (v: any) => v.issues.map((i: any) => i.field);

const operations = () => [
  { id: 'op-press', code: 'OP-PRESS', nameAr: 'الكبس', legacyStageKey: 'pressing', allowedEquipmentCategoryIds: ['presses', 'furnaces'], active: true },
  { id: 'op-kiln', code: 'OP-KILN', nameAr: 'الفرن الدوار', legacyStageKey: 'rotary_furnace', allowedEquipmentCategoryIds: [], active: true },
  { id: 'op-mix', code: 'OP-MIX', nameAr: 'الخلط', legacyStageKey: 'mixing', allowedEquipmentCategoryIds: [], active: true },
  { id: 'op-sort-old', code: 'OP-SORT', nameAr: 'الفرز', legacyStageKey: 'sorting', allowedEquipmentCategoryIds: [], active: false },
  { id: 'op-new', code: 'OP-PACK', nameAr: 'التعبئة', legacyStageKey: null, allowedEquipmentCategoryIds: [], active: true },
].map((o) => ops.readOperation(o));

const world = () => deepFreeze({
  operations: operations(),
  jobs: [
    { id: 'job-brick', code: 'JR-1', status: 'ACTIVE', active: true, logicalItemId: 'li-brick', batchId: 'b-brick', customerId: null },
    { id: 'job-draft', code: 'JR-2', status: 'DRAFT', active: true, logicalItemId: 'li-brick' },
    { id: 'job-plain', code: 'JR-3', status: 'ACTIVE', active: true },
  ],
  batches: [
    { id: 'b-brick', batchNumber: 'B-1', productId: 'p-brick', jobReferenceId: 'job-brick', active: true },
    { id: 'b-free', batchNumber: 'B-2', productId: null, jobReferenceId: null, active: true },
    { id: 'b-mortar', batchNumber: 'B-3', productId: 'p-mortar', jobReferenceId: null, active: true },
    { id: 'b-off', batchNumber: 'B-4', productId: null, jobReferenceId: null, active: false },
    { id: 'b-other', batchNumber: 'B-5', productId: null, jobReferenceId: 'job-plain', active: true },
  ],
  logicalItems: [
    { id: 'li-brick', productId: 'p-brick', materialId: null, status: 'ACTIVE' },
    { id: 'li-mortar', productId: 'p-mortar', materialId: null, status: 'ACTIVE' },
    { id: 'li-old', productId: 'p-old', materialId: null, status: 'INACTIVE' },
  ].map((x) => li.readLogicalItem(x)),
  equipment: [
    { id: 'press-1', categoryId: 'presses', active: true },
    { id: 'press-off', categoryId: 'presses', active: false },
    { id: 'kiln-1', categoryId: 'furnaces', active: true },
  ],
  hierarchyIndex: hier.buildHierarchyIndex([{ id: '513', code: '513', parentId: null }]),
});
const pressing = (over: Record<string, unknown> = {}) => ({ date: '2026-09-15', productId: 'p-brick', productName: 'Brick A', productCode: 'BRK-A', pressId: 'press-1', furnaceId: 'kiln-1', productionQuantity: 100, ...over });
const traced = (over: Record<string, unknown> = {}) => ({ jobReferenceId: 'job-brick', batchId: 'b-brick', ...over });

// ==================================================
// R. REFERENCES ON NEW RECORDS
// ==================================================

test('1-4. a new record can reference a job, a batch, the logical item and the operation - by stable ids', () => {
  const r = pr.validateProductionReferences('pressing', pressing(), traced(), world());
  assert.equal(r.valid, true, JSON.stringify(r.issues));
  assert.deepEqual(r.references, { operationId: 'op-press', jobReferenceId: 'job-brick', logicalItemId: 'li-brick', batchId: 'b-brick' });
  const mixin = interfaceBlock('WithProductionReferences');
  for (const f of ['jobReferenceId?: string | null;', 'batchId?: string | null;', 'logicalItemId?: string | null;', 'operationId?: string | null;', 'hierarchyNodeId?: string | null;']) assert.ok(mixin.includes(f), f);
  assert.equal(/productCode|batchNumber|operationName|operationCode|odoo/i.test(mixin), false, 'no codes, names or external ids as references');
});

test('R2. the shared Step 1E mixin is reused on every production record type - no second reference framework', () => {
  for (const name of ['ProductionRecord', 'RotaryFurnaceRecord', 'ChineseMillsRecord', 'TubeBallMillsRecord', 'MortarConcreteRecord', 'MixingRecord', 'LightweightFoamRecord', 'SortingRecord']) {
    assert.ok(/extends [^{]*WithProductionReferences/.test(interfaceBlock(name)), name);
  }
  assert.deepEqual(readCode('src/types/index.ts').match(/export interface \w*ProductionReference\w*/g), ['export interface WithProductionReferences'], 'the one shared reference interface');
  assert.deepEqual([...pr.PRODUCTION_REFERENCE_FIELDS], ['jobReferenceId', 'batchId', 'logicalItemId', 'operationId', 'hierarchyNodeId']);
});

test('5/20. historical records without references stay valid and readable', () => {
  const r = pr.validateProductionReferences('pressing', pressing(), {}, { operations: null });
  assert.equal(r.valid, true);
  assert.deepEqual(r.references, {});
  assert.equal(pr.validateProductionReferences('sorting', { date: 'x' }, undefined, { operations: null }).valid, true, 'no selection at all');
  const universal = readCode('src/services/stageRecordService.ts');
  assert.ok(/rawData: d/.test(universal), 'reads still expose the stored document as before');
  assert.equal(/jobReferenceId|operationId/.test(interfaceBlock('UniversalStageRecord')), false, 'the read model is unchanged');
});

// ==================================================
// M. MODES
// ==================================================

test('M1. untraced entries are never refused: operation attached when it resolves, omitted otherwise', () => {
  assert.deepEqual(pr.validateProductionReferences('rotary_furnace', { productId: 'p-x' }, {}, world()).references, { operationId: 'op-kiln' });
  const unresolved = pr.validateProductionReferences('sorting', {}, {}, world());
  assert.equal(unresolved.valid, true, 'inactive operation for sorting - still saves');
  assert.deepEqual(unresolved.references, {});
  assert.equal(pr.validateProductionReferences('pressing', pressing({ pressId: 'press-off' }), {}, world()).valid, true, 'no equipment existence check untraced');
  assert.equal(pr.isTracedSelection({}), false);
  assert.equal(pr.isTracedSelection({ batchId: 'b-free' }), true);
});

test('6. the record logical item must match the job logical item', () => {
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), traced({ logicalItemId: 'li-mortar' }), world())), ['logicalItemId']);
  assert.equal(pr.validateProductionReferences('pressing', pressing(), traced({ logicalItemId: 'li-brick' }), world()).valid, true);
});

test('6b. the form product must belong to the job logical item - never replaced', () => {
  const r = pr.validateProductionReferences('pressing', pressing({ productId: 'p-mortar' }), traced(), world());
  assert.deepEqual(fields(r), ['productId']);
  assert.ok(/not replaced automatically/.test(r.issues[0].messageEn));
  assert.equal(pr.validateProductionReferences('mixing', { linkedProductId: 'p-brick' }, { jobReferenceId: 'job-brick' }, world()).valid, true, 'mixing uses linkedProductId');
  assert.deepEqual(fields(pr.validateProductionReferences('mixing', { linkedProductId: 'p-mortar' }, { jobReferenceId: 'job-brick' }, world())), ['productId']);
});

test('M2. the job must exist, be active and in ACTIVE status', () => {
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), { jobReferenceId: 'ghost' }, world())), ['jobReferenceId']);
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), { jobReferenceId: 'job-draft' }, world())), ['jobReferenceId'], 'DRAFT job');
  assert.equal(pr.validateProductionReferences('pressing', pressing({ productId: '' }), { jobReferenceId: 'job-plain' }, world()).valid, true, 'an unconfigured active job');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), { jobReferenceId: 'job-brick' }, { ...world(), jobs: null })), ['jobReferenceId'], 'unverifiable');
});

test('M3. an inactive logical item is refused', () => {
  const w = { ...world(), jobs: [{ id: 'job-old', code: 'JR-9', status: 'ACTIVE', active: true, logicalItemId: 'li-old' }] };
  assert.ok(fields(pr.validateProductionReferences('pressing', pressing({ productId: '' }), { jobReferenceId: 'job-old' }, w)).includes('logicalItemId'));
});

test('7/8. the batch must be active and compatible with the job (the Step 4 rule, reused)', () => {
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), traced({ batchId: 'b-off' }), world())), ['batchId'], 'inactive');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), traced({ batchId: 'b-mortar' }), world())), ['batchId'], 'another product');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), traced({ batchId: 'b-other' }), world())), ['batchId'], 'bound to another job');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), traced({ batchId: 'ghost' }), world())), ['batchId'], 'missing - never created');
  assert.equal(pr.validateProductionReferences('pressing', pressing(), traced({ batchId: 'b-free' }), world()).valid, true, 'unbound batch');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), { batchId: 'b-brick' }, world())), ['batchId'], 'job-bound batch without its job');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), { batchId: 'b-mortar' }, world())), ['batchId'], 'product-bound batch without a logical item');
  assert.ok(/import \{ batchIncompatibility \} from '\.\/jobConfigurationPure';/.test(readCode(PURE)));
});

// ==================================================
// O. OPERATION
// ==================================================

test('9/10/11. a legacy stage resolves to its ACTIVE Operation Master record; traced entries require it', () => {
  assert.equal(pr.resolveOperationForStage(operations(), 'pressing').operation.id, 'op-press');
  assert.equal(pr.resolveOperationForStage(operations(), 'rotary_furnace').operation.id, 'op-kiln');
  assert.equal(pr.resolveOperationForStage(operations(), 'sorting').operation, null, 'inactive is not used');
  assert.equal(pr.resolveOperationForStage(operations(), 'chinese_mills').operation, null, 'unmapped');
  const dup = [...operations(), ops.readOperation({ id: 'op-press-2', code: 'OP-PRESS-2', nameAr: 'x', legacyStageKey: 'pressing', active: true })];
  assert.equal(pr.resolveOperationForStage(dup, 'pressing').operation, null, 'ambiguous resolves to none');
  assert.deepEqual(fields(pr.validateProductionReferences('sorting', {}, { jobReferenceId: 'job-plain' }, world())), ['operationId'], 'traced + inactive operation');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), traced(), { ...world(), operations: null })), ['operationId'], 'traced + Operation Master unreadable');
});

test('12. the stage->operation mapping is not duplicated: it is read from Operation.legacyStageKey', () => {
  const code = readCode(PURE) + readCode(SERVICE) + readCode(PANEL);
  assert.equal(/OP-PRESS|OP-KILN|OP-CMILL|OP-TBM|OP-MORTAR|OP-MIX|OP-FOAM|OP-SORT/.test(code), false, 'no operation codes in code');
  assert.ok(/text\(o\.legacyStageKey\) === text\(stageType\)/.test(readCode(PURE)));
  assert.equal(/pressing:\s*['"]|rotary_furnace:\s*['"]/.test(code), false, 'no stage->operation table');
});

test('13. an invalid explicit operation reference is rejected (even untraced)', () => {
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), { operationId: 'op-mix' }, world())), ['operationId']);
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), { operationId: 'ghost' }, world())), ['operationId']);
  assert.equal(pr.validateProductionReferences('pressing', pressing(), { operationId: 'op-press' }, world()).valid, true);
});

// ==================================================
// E. EQUIPMENT AND HIERARCHY
// ==================================================

test('14/15. equipment must exist, be active and be allowed by the operation (stage fields from the registry)', () => {
  assert.deepEqual(pr.stageEquipmentFields('pressing'), [{ field: 'pressId', categoryId: 'presses' }, { field: 'furnaceId', categoryId: 'furnaces' }]);
  // Phase 1 Step 8C: these stages now name their machine from their existing equipment master (free text kept).
  assert.deepEqual(pr.stageEquipmentFields('rotary_furnace'), [{ field: 'rotaryKilnId', categoryId: 'rotaryKilns' }]);
  assert.deepEqual(pr.stageEquipmentFields('chinese_mills'), [{ field: 'millId', categoryId: 'mills' }]);
  assert.deepEqual(pr.stageEquipmentFields('tube_ball_mills'), [{ field: 'tubeBallMillId', categoryId: 'tubeBallMills' }, { field: 'bunkerId', categoryId: 'bunkers' }]);
  assert.deepEqual(pr.stageEquipmentFields('mixing'), [], 'stages with no equipment master are still left alone');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing({ pressId: 'press-ghost' }), traced(), world())), ['pressId']);
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing({ pressId: 'press-off' }), traced(), world())), ['pressId'], 'inactive');
  const restricted = { ...world(), operations: operations().map((o: any) => (o.id === 'op-press' ? { ...o, allowedEquipmentCategoryIds: ['presses'] } : o)) };
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), traced(), restricted)), ['furnaceId'], 'furnace not allowed by the operation');
  const untraced = pr.validateProductionReferences('pressing', pressing(), {}, restricted);
  assert.equal(untraced.valid, true);
  assert.equal('operationId' in untraced.references, false, 'untraced: an incompatible operation is simply not attached');
  assert.ok(/STAGE_EQUIPMENT_CATEGORIES/.test(readCode(PURE)) && /legacyProductionFields/.test(readCode(PURE)), 'reuses the registry maps');
});

test('16. an invalid hierarchy reference is rejected; a valid node id is attached', () => {
  assert.equal(pr.validateProductionReferences('pressing', pressing(), traced({ hierarchyNodeId: '513' }), world()).references.hierarchyNodeId, '513');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), traced({ hierarchyNodeId: '999' }), world())), ['hierarchyNodeId']);
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), traced({ hierarchyNodeId: '513' }), { ...world(), hierarchyIndex: null })), ['hierarchyNodeId'], 'unverifiable');
  assert.deepEqual(fields(pr.validateProductionReferences('pressing', pressing(), { hierarchyNodeId: '513' }, world())), ['hierarchyNodeId'], 'only with a job or batch');
  assert.ok(/import \{ validateEquipmentLink \} from '\.\/hierarchyResolverPure';/.test(readCode(PURE)));
});

// ==================================================
// W. WRITE PATH
// ==================================================

test('17/18/19. references are validated and merged before each form\'s EXISTING write; a refusal throws first', () => {
  for (const [stage, form] of Object.entries(FORMS)) {
    const code = readCode(`src/components/production/${form}.tsx`);
    if (stage === 'pressing') {
      assert.ok(/const referencedRecordData = await attachProductionReferences\('pressing', newRecordData, productionReferences, language\);\s*const newRecordId = await createProductionRecord\(referencedRecordData\);/.test(code), form);
    } else {
      assert.ok(new RegExp(`const newRecordId = await createStageRecord\\('${stage}', await attachProductionReferences\\('${stage}', \\{[\\s\\S]*?\\}, productionReferences, language\\), status\\);`).test(code), form);
    }
    assert.ok(/productionReferences/.test(code), `${form} receives the selection`);
  }
  const svc = readCode(SERVICE);
  assert.ok(/if \(!result\.valid\) \{\s*throw new Error/.test(svc), 'invalid -> throws, so the write call never runs');
  assert.ok(/return \{ \.\.\.data, \.\.\.result\.references \};/.test(svc));
  assert.equal(/createStageRecord|createProductionRecord|addDoc|setDoc|updateDoc|writeBatch|createMasterDataItem|updateMasterDataItem/.test(svc + readCode(PURE) + readCode(PANEL)), false, 'no second write path');
});

test('22. the existing write functions (and their side-collection batch) are untouched', () => {
  const changed = [execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/services/productionService.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim(), stageRecordServiceChangedBeyondApproved(ROOT)].filter(Boolean).join('\n');
  assert.equal(changed, '', changed);
  const ps = readCode('src/services/productionService.ts');
  for (const side of ['productionEmployees', 'productionFurnaceCars', 'downtime']) assert.ok(ps.includes(`'${side}'`), side);
});

test('21. product snapshots stay as each form writes them - references are only added alongside', () => {
  const r = pr.validateProductionReferences('pressing', pressing(), traced(), world());
  const merged = { ...pressing(), ...r.references };
  for (const f of ['productId', 'productName', 'productCode', 'pressId', 'furnaceId']) assert.equal((merged as any)[f], (pressing() as any)[f], f);
  assert.equal(Object.keys(r.references).some((k) => ['productId', 'productName', 'productCode'].includes(k)), false);
});

test('W2. the new references are recorded through the existing audit', () => {
  const pressingForm = readCode('src/components/production/ProductionEntryForm.tsx');
  assert.ok(/const referencesAudit = describeProductionReferences\(newRecordId, referencedRecordData\);\s*if \(referencesAudit\) logAuditAction\('CREATE', 'production', newRecordId, referencesAudit\)/.test(pressingForm));
  assert.ok(/newValue: data,/.test(readCode('src/services/stageRecordService.ts')), 'stage record audit history stores the written data, references included');
  assert.equal(pr.describeProductionReferences('rec-1', { jobReferenceId: 'job-brick', operationId: 'op-press', productName: 'x', batchId: '' }), '[PRODUCTION_REFERENCES] productionRecordId=rec-1 jobReferenceId=job-brick operationId=op-press');
  assert.equal(pr.describeProductionReferences('rec-1', {}), null);
});

// ==================================================
// H. HISTORY AND NEIGHBOURS
// ==================================================

test('23-26. production entry modifies no job, batch, BOM or routing - and inputs are never mutated', () => {
  const w = world();
  pr.validateProductionReferences('pressing', pressing(), traced(), w); // deepFreeze throws on mutation
  const code = readCode(PURE) + readCode(SERVICE) + readCode(PANEL) + readCode(CONTAINER);
  assert.equal(/updateMasterDataItem|createMasterDataItem|saveBomVersionDraft|transitionBomVersion|transitionRoutingVersion|saveRoutingVersionDraft|createBomVersion|createRoutingVersion/.test(code), false);
  assert.equal(/components|steps/.test(readCode(PURE)), false, 'no BOM components or routing steps copied');
});

test('H1. no historical record is read or rewritten; importers and stage collections are unchanged', () => {
  assert.deepEqual(Object.values(stageBounds.STAGE_COLLECTION_NAMES), ['production', 'stage_rotary_furnace', 'stage_chinese_mills', 'stage_tube_ball_mills', 'stage_mortar_concrete', 'stage_mixing', 'stage_lightweight_foam', 'stage_sorting',
    // Phase 1 Step 8C-5 (approved): three new record types appended; no existing collection changed.
    'stage_thermal_concrete', 'stage_tunnel_kiln', 'stage_handmade_brick']);
  const code = readCode(SERVICE) + readCode(PURE);
  assert.equal(/fetchUniversalStageRecords|fetchStageRecords|subscribeProduction|'production'|stage_/.test(code), false);
  const importers = ['src/services/pressingHistoricalImportService.ts', 'src/services/tubeBallMillsHistoricalImportService.ts', 'src/services/chineseMillsHistoricalImportService.ts', 'src/services/historicalImportService.ts'];
  for (const rel of importers) {
    if (fs.existsSync(path.join(ROOT, rel))) assert.equal(/attachProductionReferences/.test(readCode(rel)), false, rel);
  }
});

test('U. the existing entry container shows one optional panel; no new screen, navigation, permission or collection', () => {
  const container = readCode(CONTAINER);
  assert.ok(/<ProductionReferencePanel stageType=\{activeStage\} value=\{productionReferences\} onChange=\{setProductionReferences\} \/>/.test(container));
  for (const form of Object.values(FORMS)) assert.ok(new RegExp(`<${form}[^>]*productionReferences=\\{productionReferences\\}`).test(container), form);
  const panel = readCode(PANEL);
  assert.ok(/String\(j\.status \?\? ''\)\.toUpperCase\(\) === 'ACTIVE'/.test(panel), 'only active jobs offered');
  assert.ok(/compatibleBatches\(/.test(panel), 'batches filtered by the Step 4 rule');
  assert.equal(/'production-reference|job-production|'batch-production/.test(readCode('src/App.tsx') + readCode('src/types/index.ts')), false, 'no new NavigationPage');
  assert.equal(/'(productionReference|traceability)\./i.test(readCode('src/types/permissions.ts')), false, 'no new permission keys');
  const rules = readSource('firestore.rules');
  assert.equal(/match \/production(References|Traceability)/.test(rules), false, 'no new collection or rule');
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

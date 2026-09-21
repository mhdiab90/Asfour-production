/**
 * SETUP-DRIVEN ROUTING + ROUTING VERSIONS - Phase 1 Step 3.
 *
 * R  routing header: identity, logical item, customer scope, defaults
 * V  versions: shared lifecycle, one active, drafts only editable
 * S  steps: operation references, sequence, cost centre, equipment, required
 * G  logical item registration (explicit, refused while an overlap is undecided)
 * C  compatibility: shared helpers, Operation Master, equipment, BOM, jobs,
 *    batches and production untouched; no hard-coded routes
 * U  UI, service, permissions, audit, rules
 *
 * Pure modules run as shipped; the screen, modal and service import Firebase,
 * so their wiring is pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/routing.test.ts
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

console.log('routing.test.ts');

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

let rt: any;
let li: any;
let ops: any;
let hier: any;
let shared: any;
let bom: any;
let jb: any;
let reg: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  rt = await load('src/services/routingPure.ts');
  li = await load('src/services/logicalItemPure.ts');
  ops = await load('src/services/operationMasterPure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
  shared = await load('src/services/versionedSetupPure.ts');
  bom = await load('src/services/bomPure.ts');
  jb = await load('src/services/jobBatchPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
}

const PURE = 'src/services/routingPure.ts';
const SERVICE = 'src/services/routingService.ts';
const MODAL = 'src/components/masterData/RoutingVersionsModal.tsx';
const VIEW = 'src/components/masterData/MasterDataView.tsx';
const fields = (v: any) => v.issues.map((i: any) => i.field);

const logicalItems = () => [
  { id: 'li-brick', productId: 'p-brick', materialId: null, status: 'ACTIVE' },
  { id: 'li-kaolin', productId: 'p-kaolin', materialId: 'm-kaolin', status: 'ACTIVE' },
  { id: 'li-old', productId: 'p-old', materialId: null, status: 'INACTIVE' },
].map((x) => li.readLogicalItem(x));
const customers = new Set(['custX', 'custY']);
const routing = { id: 'r1', code: 'RT-BRICK-STD', name: 'Brick Standard', logicalItemId: 'li-brick', customerId: null, isDefault: true, active: true };

const operations = () => [
  { id: 'op-mix', code: 'OP-MIX', nameAr: 'الخلط', nameEn: 'Mixing', legacyStageKey: 'mixing', allowedEquipmentCategoryIds: [], active: true },
  { id: 'op-press', code: 'OP-PRESS', nameAr: 'الكبس', nameEn: 'Pressing', legacyStageKey: 'pressing', allowedEquipmentCategoryIds: ['presses', 'furnaces'], active: true },
  { id: 'op-kiln', code: 'OP-KILN', nameAr: 'الفرن الدوار', nameEn: 'Rotary Kiln', legacyStageKey: 'rotary_furnace', allowedEquipmentCategoryIds: [], active: true },
  { id: 'op-old', code: 'OP-OLD', nameAr: 'قديمة', nameEn: 'Old', allowedEquipmentCategoryIds: [], active: false },
].map((o) => ops.readOperation(o));
const index = () => hier.buildHierarchyIndex([
  { id: '501', code: '501', parentId: null },
  { id: '5011', code: '5011', parentId: '501' },
  { id: '512', code: '512', parentId: null },
]);
const equipment = () => [
  { id: 'press-1', categoryId: 'presses', active: true },
  { id: 'press-old', categoryId: 'presses', active: false },
  { id: 'rk-01', categoryId: 'rotaryKilns', active: true },
];
const ctx = (over: Record<string, unknown> = {}) => ({ operations: operations(), hierarchyIndex: index(), equipment: equipment(), routing, ...over });
const step = (n: number, operationId: string, over: Record<string, unknown> = {}) => ({ lineId: `L${n}`, sequence: n, operationId, hierarchyNodeId: null, equipmentCategoryId: null, equipmentId: null, required: true, notes: '', ...over });
const version = (over: Record<string, unknown> = {}) => ({ routingId: 'r1', versionCode: 'R1', status: 'DRAFT', steps: [step(1, 'op-mix'), step(2, 'op-press')], ...over });

// ==================================================
// R. ROUTING HEADER
// ==================================================

test('1. a routing has a stable internal identity: the document id, with code as a field', () => {
  const block = interfaceBlock('Routing');
  assert.ok(block.includes('id?: string;') && block.includes('code: string;') && block.includes('extends WithExternalReferences'));
  const payload = rt.routingPayloadForSave({ ...routing, createdAt: 'x', externalRefs: [] });
  assert.deepEqual(Object.keys(payload).sort(), ['active', 'code', 'customerId', 'isDefault', 'logicalItemId', 'name', 'notes']);
  assert.equal('id' in payload, false);
  assert.deepEqual(fields(rt.validateRoutingForSave([routing], { ...routing, id: undefined, code: 'rt-brick-std ', isDefault: false }, { logicalItems: logicalItems() })), ['code']);
  assert.equal(rt.validateRoutingForSave([routing], { ...routing, notes: 'x' }, { editingId: 'r1', logicalItems: logicalItems() }).valid, true, 'an edit keeping its code');
});

test('2. a routing references an ACTIVE logical item - never a raw product or material id, never an invented identity', () => {
  assert.ok(interfaceBlock('Routing').includes('logicalItemId: string;'));
  assert.equal(/productId|materialId|itemSource/.test(interfaceBlock('Routing')), false);
  assert.equal(rt.validateRoutingForSave([], routing, { logicalItems: logicalItems() }).valid, true);
  assert.deepEqual(fields(rt.validateRoutingForSave([], { ...routing, logicalItemId: 'p-brick' }, { logicalItems: logicalItems() })), ['logicalItemId'], 'a product id is not a logical item');
  assert.deepEqual(fields(rt.validateRoutingForSave([], { ...routing, logicalItemId: 'li-old' }, { logicalItems: logicalItems() })), ['logicalItemId'], 'inactive');
  assert.deepEqual(fields(rt.validateRoutingForSave([], { ...routing, logicalItemId: '' }, { logicalItems: logicalItems() })), ['logicalItemId']);
  assert.deepEqual(fields(rt.validateRoutingForSave([], routing, { logicalItems: null })), ['logicalItemId'], 'unloaded identities accept nothing');
  assert.ok(/Overlap Review/.test(rt.validateRoutingForSave([], { ...routing, logicalItemId: '' }, {}).issues[0].messageEn), 'the user is told where to register');
  assert.equal(/createMasterDataItem\(LOGICAL_ITEM_COLLECTION|registerLogicalItem|logicalItemRegistrationPayload/.test(readCode(PURE) + readCode(SERVICE) + readCode(MODAL)), false, 'routing code never creates a logical item');
});

test('3/4/5. customer scope is optional: standard = null, customer-specific is valid, customers must exist', () => {
  assert.equal(rt.routingPayloadForSave({ ...routing, customerId: '' }).customerId, null);
  assert.equal(rt.validateRoutingForSave([], { ...routing, code: 'RT-X', customerId: 'custX' }, { logicalItems: logicalItems(), knownCustomerIds: customers }).valid, true);
  assert.deepEqual(fields(rt.validateRoutingForSave([], { ...routing, code: 'RT-X', customerId: 'ghost' }, { logicalItems: logicalItems(), knownCustomerIds: customers })), ['customerId']);
});

test('9/10. one active default per (logical item, customer) - refused naming code and name, the holder untouched', () => {
  const second = { ...routing, id: undefined, code: 'RT-BRICK-2', name: 'Brick Two' };
  const v = rt.validateRoutingForSave([routing], second, { logicalItems: logicalItems() });
  assert.deepEqual(fields(v), ['isDefault']);
  assert.ok(/RT-BRICK-STD/.test(v.issues[0].messageEn) && /Brick Standard/.test(v.issues[0].messageEn));
  assert.equal(routing.isDefault, true);
  assert.equal(rt.validateRoutingForSave([routing], { ...second, customerId: 'custX' }, { logicalItems: logicalItems(), knownCustomerIds: customers }).valid, true, 'another customer scope');
  assert.equal(rt.validateRoutingForSave([{ ...routing, active: false }], second, { logicalItems: logicalItems() }).valid, true, 'an inactive default does not block');
  assert.equal(rt.validateRoutingForSave([routing], { ...second, isDefault: false }, { logicalItems: logicalItems() }).valid, true);
  const view = readCode(VIEW);
  assert.ok(/validateRoutingForSave\(items, \{ \.\.\.item, active: true \}/.test(view), 'reactivating a default is checked too');
});

// ==================================================
// V. VERSIONS
// ==================================================

test('6/7. a routing has many versions; the version code is unique within its routing', () => {
  const stored = [{ id: 'v1', ...version({ status: 'RETIRED' }) }, { id: 'v2', ...version({ versionCode: 'R2', status: 'ACTIVE' }) }];
  assert.equal(rt.validateRoutingVersionForSave(stored, version({ versionCode: 'R3' }), ctx()).valid, true);
  assert.deepEqual(fields(rt.validateRoutingVersionForSave(stored, version({ versionCode: 'r2' }), ctx())), ['versionCode']);
  assert.equal(rt.validateRoutingVersionForSave(stored, version({ routingId: 'r9', versionCode: 'R2' }), ctx({ routing: null })).valid, true, 'R2 of another routing');
  const block = interfaceBlock('RoutingVersion');
  assert.ok(block.includes('routingId: string;') && block.includes('steps: RoutingStep[];'));
  assert.equal(rt.ROUTING_VERSION_COLLECTION, 'routingVersions');
});

test('8/22. one ACTIVE version per routing - a second activation is refused and nothing is retired silently', () => {
  const active = { id: 'v1', ...version({ status: 'ACTIVE' }) };
  const next = { id: 'v2', ...version({ versionCode: 'R2' }) };
  const v = rt.validateRoutingVersionTransition([active, next], next, 'ACTIVE', ctx());
  assert.equal(v.valid, false);
  assert.ok(v.issues.some((i: any) => /"R1" is already active/.test(i.messageEn)));
  assert.equal(active.status, 'ACTIVE');
  assert.equal(rt.validateRoutingVersionTransition([next], next, 'ACTIVE', ctx({ routing: { ...routing, active: false } })).valid, false, 'inactive routing');
});

test('11/12/13. drafts are editable; ACTIVE and RETIRED versions are not; the lifecycle is DRAFT -> ACTIVE -> RETIRED', () => {
  const d = { id: 'v1', ...version() };
  assert.equal(rt.isVersionEditable(d), true);
  assert.equal(rt.isVersionEditable({ ...d, status: 'ACTIVE' }), false);
  assert.equal(rt.isVersionEditable({ ...d, status: 'RETIRED' }), false);
  assert.equal(rt.validateRoutingVersionTransition([d], d, 'ACTIVE', ctx()).valid, true);
  assert.equal(rt.validateRoutingVersionTransition([d], { ...d, status: 'ACTIVE' }, 'DRAFT', ctx()).valid, false);
  assert.equal(rt.validateRoutingVersionTransition([d], { ...d, status: 'RETIRED' }, 'ACTIVE', ctx()).valid, false);
  const svc = readCode(SERVICE);
  assert.ok(/if \(String\(stored\.status\)\.toUpperCase\(\) !== 'DRAFT'\) \{/.test(svc), 'the service refuses editing a non-draft');
  const copy = rt.draftFromRoutingVersion({ id: 'v9', ...version({ status: 'ACTIVE', effectiveFrom: '2026-01-01' }) }, 'R2');
  assert.equal(copy.status, 'DRAFT');
  assert.equal(copy.effectiveFrom, null);
  assert.deepEqual(copy.steps.map((s: any) => s.operationId), ['op-mix', 'op-press'], 'copy keeps the steps');
});

test('21. effective dates are valid and never inverted', () => {
  assert.equal(rt.validateRoutingVersionForSave([], version({ effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }), ctx()).valid, true);
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ effectiveFrom: '2026-13-01' }), ctx())), ['effectiveFrom']);
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ effectiveFrom: '2026-06-02', effectiveTo: '2026-06-01' }), ctx())), ['effectiveTo']);
});

// ==================================================
// S. STEPS
// ==================================================

test('14/28. a step references the Operation Master by id - no copied name, no legacy stage key', () => {
  const block = interfaceBlock('RoutingStep');
  assert.ok(block.includes('operationId: string;'));
  assert.equal(/operationName|nameAr|nameEn|legacyStageKey|stageType|ProductionStageType/.test(block + interfaceBlock('RoutingVersion') + interfaceBlock('Routing')), false);
  const payload = rt.routingStepPayload({ ...step(1, 'op-kiln'), operationName: 'Rotary Kiln', legacyStageKey: 'rotary_furnace' });
  assert.deepEqual(Object.keys(payload).sort(), ['equipmentCategoryId', 'equipmentId', 'hierarchyNodeId', 'lineId', 'notes', 'operationId', 'required', 'sequence']);
  assert.equal(/legacyStageKey|STAGE_COLLECTION_NAMES|ProductionStageType/.test(readCode(PURE) + readCode(SERVICE)), false);
});

test('15/16/17. sequence is unique, renumbered 1..n, and steps can be reordered and removed safely', () => {
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix'), step(2, 'op-press', { sequence: 1 })] }), ctx())), ['steps.sequence']);
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix'), step(2, 'op-press', { lineId: 'L1' })] }), ctx())), ['steps.lineId']);
  const steps = [step(1, 'op-mix'), step(2, 'op-press'), step(3, 'op-kiln')];
  assert.deepEqual(rt.moveRoutingStep(steps, 'L3', 'up').map((s: any) => [s.lineId, s.sequence]), [['L1', 1], ['L3', 2], ['L2', 3]]);
  assert.deepEqual(rt.normaliseSequences(steps.filter((s) => s.lineId !== 'L2')).map((s: any) => [s.lineId, s.sequence]), [['L1', 1], ['L3', 2]]);
  assert.deepEqual(rt.routingVersionPayloadForSave(version({ steps: [step(2, 'op-press', { sequence: 9 }), step(1, 'op-mix', { sequence: 4 })] })).steps.map((s: any) => [s.lineId, s.sequence]), [['L1', 1], ['L2', 2]]);
  assert.equal(rt.nextLineId([step(1, 'op-mix'), { lineId: 'L7' }]), 'L8');
});

test('18. the same operation may appear in more than one step (a route may revisit an operation)', () => {
  const v = rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix'), step(2, 'op-press'), step(3, 'op-mix')] }), ctx());
  assert.equal(v.valid, true, JSON.stringify(v.issues));
});

test('19. invalid operations are rejected: missing, unknown, inactive, unverifiable, or a routing id', () => {
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, '')] }), ctx())), ['steps.operationId']);
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-ghost')] }), ctx())), ['steps.operationId']);
  const inactive = rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-old')] }), ctx());
  assert.ok(/inactive/.test(inactive.issues[0].messageEn) && /never substituted/.test(inactive.issues[0].messageEn));
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix')] }), ctx({ operations: null }))), ['steps.operationId']);
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'r1')] }), ctx())), ['steps.operationId'], 'a routing cannot be its own operation');
});

test('20/21. the optional cost-centre override must be an existing hierarchy node id', () => {
  assert.equal(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix', { hierarchyNodeId: '512' })] }), ctx()).valid, true);
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix', { hierarchyNodeId: '999' })] }), ctx())), ['steps.hierarchyNodeId']);
  const codeKeyed = hier.buildHierarchyIndex([{ id: 'doc-512', code: '512', parentId: null }]);
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix', { hierarchyNodeId: '512' })] }), ctx({ hierarchyIndex: codeKeyed }))), ['steps.hierarchyNodeId'], 'a code is not the node id');
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix', { hierarchyNodeId: '512' })] }), ctx({ hierarchyIndex: null }))), ['steps.hierarchyNodeId'], 'unverifiable');
  assert.equal(rt.routingStepPayload(step(1, 'op-mix', { hierarchyNodeId: '' })).hierarchyNodeId, null, 'empty = the operation default');
});

test('22. the optional equipment category is a registered one, and one the operation allows', () => {
  assert.deepEqual([...ops.OPERATION_EQUIPMENT_CATEGORY_IDS], ['presses', 'furnaces', 'mills', 'tubeBallMills', 'rotaryKilns']);
  assert.equal(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-press', { equipmentCategoryId: 'presses' })] }), ctx()).valid, true);
  assert.equal(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-kiln', { equipmentCategoryId: 'rotaryKilns' })] }), ctx()).valid, true, 'no restriction on the operation');
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-press', { equipmentCategoryId: 'rotaryKilns' })] }), ctx())), ['steps.equipmentCategoryId'], 'not allowed by OP-PRESS');
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix', { equipmentCategoryId: 'extruders' })] }), ctx())), ['steps.equipmentCategoryId'], 'unregistered');
});

test('23/24. the optional machine must belong to the selected category, be active, and needs a category', () => {
  assert.equal(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-kiln', { equipmentCategoryId: 'rotaryKilns', equipmentId: 'rk-01' })] }), ctx()).valid, true);
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-press', { equipmentCategoryId: 'presses', equipmentId: 'rk-01' })] }), ctx())), ['steps.equipmentId'], 'wrong category');
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-kiln', { equipmentId: 'rk-01' })] }), ctx())), ['steps.equipmentId'], 'machine without category');
  assert.deepEqual(fields(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-press', { equipmentCategoryId: 'presses', equipmentId: 'press-old' })] }), ctx())), ['steps.equipmentId'], 'inactive machine');
  assert.equal(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-press', { equipmentCategoryId: 'presses' })] }), ctx()).valid, true, 'no machine is fine');
});

test('25. required / optional is plain metadata (default required)', () => {
  assert.equal(rt.routingStepPayload({ lineId: 'L1', sequence: 1, operationId: 'op-mix' }).required, true);
  assert.equal(rt.routingStepPayload(step(1, 'op-mix', { required: false })).required, false);
  assert.equal(rt.validateRoutingVersionForSave([], version({ steps: [step(1, 'op-mix', { required: false })] }), ctx()).valid, true);
  assert.equal(/branch|alternate|skipIf|condition/i.test(readCode(PURE)), false, 'no branching engine');
});

test('26/27. an empty version cannot activate; one with a step can', () => {
  const empty = { id: 'v1', ...version({ steps: [] }) };
  const t = rt.validateRoutingVersionTransition([empty], empty, 'ACTIVE', ctx());
  assert.equal(t.valid, false);
  assert.ok(fields(t).includes('steps'));
  const one = { id: 'v2', ...version({ versionCode: 'R2', steps: [step(1, 'op-mix')] }) };
  assert.equal(rt.validateRoutingVersionTransition([one], one, 'ACTIVE', ctx()).valid, true);
});

// ==================================================
// G. LOGICAL ITEM REGISTRATION
// ==================================================

test('G1. a record can be registered as its own logical item only explicitly, and never while an overlap is undecided', () => {
  const rows = [
    { materialId: 'm-clay', productId: 'p-clay' },
    { materialId: 'm-sand' },
  ];
  const blocked = li.planSingleRecordRegistration([], [], 'products', 'p-clay', rows);
  assert.equal(blocked.outcome, 'CONFLICT');
  assert.deepEqual(blocked.undecidedPairs, [{ productId: 'p-clay', materialId: 'm-clay' }]);
  const kept = [li.readItemPairDecision({ id: 'd1', productId: 'p-clay', materialId: 'm-clay', status: 'ACTIVE' })];
  assert.equal(li.planSingleRecordRegistration([], kept, 'products', 'p-clay', rows).outcome, 'CREATE', 'after Keep Separate');
  assert.equal(li.planSingleRecordRegistration([], [], 'products', 'p-brick', rows).outcome, 'CREATE', 'a brick with no twin');
  assert.equal(li.planSingleRecordRegistration([], [], 'materials', 'm-sand', rows).outcome, 'CREATE', 'a material with no match');
  assert.equal(li.planSingleRecordRegistration(logicalItems(), [], 'products', 'p-brick', rows).outcome, 'ALREADY_REGISTERED');
  const payload = li.logicalItemRegistrationPayload('products', 'p-brick', { userId: 'u1' });
  assert.deepEqual([payload.productId, payload.materialId, payload.status, payload.reason], ['p-brick', null, 'ACTIVE', 'SINGLE_RECORD_REGISTRATION']);
  assert.equal(li.planProductMaterialMapping([li.readLogicalItem({ id: 'li-b', ...payload })], [], { productId: 'p-brick', materialId: 'm-brick' }).outcome, 'ATTACH_MATERIAL', 'a later twin attaches, no second identity');
});

test('G2. the service re-runs the existing analyzer on fresh reads before registering; the dialog confirms first', () => {
  const svc = readCode('src/services/logicalItemService.ts');
  const fn = svc.slice(svc.indexOf('export async function registerLogicalItem'), svc.indexOf('export async function unlinkLogicalItem'));
  assert.ok(/requireEditor\(options\.canEdit, options\.language\);/.test(fn));
  assert.ok(/analyzeProductMaterialOverlap\(materials, products, productTypes\)\.rows/.test(fn));
  assert.ok(/skipCache: true/.test(fn));
  assert.ok(fn.indexOf("plan.outcome === 'CONFLICT'") < fn.indexOf('createMasterDataItem('));
  const modal = readCode('src/components/masterData/ItemOverlapReviewModal.tsx');
  assert.ok(/setPending\(\{ kind: 'REGISTER', source, record \}\)/.test(modal));
  assert.ok(/registerLogicalItem\(pending\.source, pending\.record, \{ canEdit, language \}\)/.test(modal));
});

// ==================================================
// C. COMPATIBILITY
// ==================================================

test('29/30/31. the logical item layer, the Operation Master, equipment categories and the hierarchy resolver are reused', () => {
  const code = readCode(PURE);
  assert.ok(/import type \{ LogicalItemRecord \} from '\.\/logicalItemPure';/.test(code));
  assert.ok(/import \{ OPERATION_EQUIPMENT_CATEGORY_IDS \} from '\.\/operationMasterPure';/.test(code));
  assert.ok(/import \{ validateEquipmentLink \} from '\.\/hierarchyResolverPure';/.test(code));
  assert.ok(/from '\.\/versionedSetupPure';/.test(code));
  const view = readCode(VIEW);
  assert.ok(/fetchMasterData<any>\(MASTER_DATA_COLLECTIONS\.stages\)\.then\(\(rows\) => setReferenceOperations\(rows\.map\(readOperation\)\)\)/.test(view), 'Operation Master read and normalised by its own reader');
  assert.ok(/allEquipment\.map\(\(e\) => \(\{ id: String\(e\.id \?\? ''\), categoryId: String\(e\.__categoryId \?\? ''\)/.test(view), 'the equipment already loaded for reconciliation');
  assert.ok(/hierarchyIndex=\{hierarchyNodes\.length \? linkHierarchyIndex : null\}/.test(view), 'the shared cost-centre index');
  const services = fs.readdirSync(path.join(ROOT, 'src/services'));
  assert.deepEqual(services.filter((f) => /resolver/i.test(f)), ['hierarchyResolverPure.ts'], 'no second resolver');
});

test('C2. the version lifecycle is shared with BOM, not duplicated', () => {
  assert.equal(bom.isVersionEditable, shared.isVersionEditable);
  assert.equal(bom.moveComponent, shared.moveLine);
  assert.equal(rt.moveRoutingStep, shared.moveLine);
  assert.equal(rt.normaliseSequences, shared.normaliseSequences);
  assert.deepEqual([...bom.BOM_VERSION_STATUSES], [...rt.ROUTING_VERSION_STATUSES]);
  for (const rel of ['src/services/bomPure.ts', PURE]) {
    assert.equal(/const TRANSITIONS|DATE_PATTERN|function isValidDate/.test(readCode(rel)), false, `${rel} keeps no private copy`);
  }
});

test('32. BOM stays separate: no routing in BOM, no BOM in routing', () => {
  for (const name of ['Routing', 'RoutingVersion', 'RoutingStep']) assert.equal(/bom|component|quantity|unit\b/i.test(interfaceBlock(name)), false, name);
  for (const name of ['Bom', 'BomVersion', 'BomComponent']) assert.equal(/routing|operation/i.test(interfaceBlock(name)), false, name);
  assert.equal(/bomPure|bomService|bomVersions|'boms'/.test(readCode(PURE) + readCode(SERVICE) + readCode(MODAL)), false);
});

test('33/34/35. jobs, batches and production are untouched; no routing is assigned or executed', () => {
  for (const name of ['Batch', 'ProductionRecord', 'UniversalStageRecord', 'WithProductionReferences']) {
    assert.equal(/routing/i.test(interfaceBlock(name)), false, name);
  }
  // Phase 1 Step 4: the job references a routing version by id only - no copied steps.
  const job = interfaceBlock('JobReference');
  assert.ok(job.includes('routingVersionId?: string | null;'));
  assert.equal(/routing/i.test(job.replace(/\broutingVersionId\b/g, '')) || /steps/.test(job), false);
  assert.equal(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE' }).valid, true);
  const code = readCode(PURE) + readCode(SERVICE) + readCode(MODAL);
  assert.equal(/jobReferences|'batches'|stage_|'production'|productionService|stageRecordService|financialTransactions/.test(code), false);
  const changed = [changedBeyondStep8C5(ROOT, ['src/services/productionService.ts', 'src/services/productionStageConfig.ts', 'src/services/stageQueryBoundsPure.ts']), stageRecordServiceChangedBeyondApproved(ROOT)].filter(Boolean).join('\n');
  assert.equal(changed, '', changed);
});

test('C3. no hard-coded route anywhere - operations, products and stages are never named in routing code', () => {
  const code = readCode(PURE) + readCode(SERVICE) + readCode(MODAL);
  assert.equal(/OP-[A-Z]|'op-|Mixing|Pressing|Tunnel|Sorting|Packing|Brick|Kaolin|Mortar|pressing|mixing|rotary_furnace/.test(code), false);
  assert.equal(/steps:\s*\[\s*\{/.test(code), false, 'no literal step list');
});

// ==================================================
// U. UI, SERVICE, PERMISSIONS, AUDIT, RULES
// ==================================================

test('U1. Routings sit beneath Products in the existing Master Data navigation - no new page', () => {
  assert.deepEqual(reg.subCategories('products').map((c: any) => c.tab), ['products', 'boms', 'routings']);
  assert.equal(reg.categoryForTab('routings').collection, 'routings');
  assert.ok(/routings: 'routings'/.test(readCode('src/services/masterDataService.ts')));
  assert.equal(/Routing(View|Page|Manager|App)|'routing/.test(readCode('src/App.tsx')), false);
  const view = readCode(VIEW);
  assert.equal((view.match(/updateMasterDataItem\(/g) || []).length, 1);
  assert.equal((view.match(/createMasterDataItem\(/g) || []).length, 1);
  assert.ok(/<RoutingVersionsModal[\s\S]*?canEdit=\{canImportMasterData\}/.test(view));
  assert.ok(/options=\{logicalItemOptions\}/.test(view) && /referenceLogicalItems\.filter\(\(i\) => i\.status === 'ACTIVE'\)/.test(view), 'only active logical items are offered');
});

test('U2. headers save behind the existing gate with audit; routings are retired, never deleted', () => {
  const view = readCode(VIEW);
  assert.ok(/if \(isRoutingTab\) \{\s*if \(!canImportMasterData\) \{\s*throw new Error/.test(view));
  assert.ok(/dataToWrite = routingPayloadForSave\(formData\);/.test(view));
  assert.ok(/logAuditAction\(editingItem \? 'UPDATE' : 'CREATE', MASTER_DATA_COLLECTIONS\.routings, savedId, describeRoutingChange\(editingItem, dataToWrite\)\)/.test(view));
  assert.ok(/if \(isRoutingTab\) \{ setDeleteConfirmItem\(null\); return; \}/.test(view));
  assert.ok(/const isRetireOnlyTab = isCompletedEquipment \|\| isJobBatchTab \|\| isBomTab \|\| isRoutingTab;/.test(view));
  assert.equal(/'(routing[A-Za-z]*|routings)\./i.test(readCode('src/types/permissions.ts')), false, 'no new permission keys');
});

test('U3. versions are written only through the gated, validated service; nothing is deleted', () => {
  const svc = readCode(SERVICE);
  for (const fn of ['createRoutingVersion', 'saveRoutingVersionDraft', 'transitionRoutingVersion']) {
    const body = svc.slice(svc.indexOf(`export async function ${fn}`));
    assert.ok(/^[\s\S]*?\{\s*requireEditor\(options\.canEdit, options\.language\);/.test(body), `${fn} checks the gate first`);
  }
  assert.ok(/validateRoutingVersionTransition\(versionsOfRouting, stored, next, context\)/.test(svc));
  assert.ok(/logAuditAction\(next === 'ACTIVE' \? 'ACTIVATE' : 'DEACTIVATE'/.test(svc));
  assert.equal(/deleteMasterDataItem|deleteDoc|writeBatch|setDoc/.test(svc + readCode(MODAL)), false);
  const modal = readCode(MODAL);
  assert.ok(/if \(!canEdit\) return;/.test(modal) && /window\.confirm\(/.test(modal));
});

test('U4. audit descriptions cover creation, copy, scope, default, steps added/removed/reordered and step changes', () => {
  assert.ok(/\[ROUTING_CREATED\].*customer custX/.test(rt.describeRoutingChange(null, { ...routing, customerId: 'custX' })));
  const upd = rt.describeRoutingChange(routing, { ...routing, customerId: 'custY', isDefault: false });
  assert.ok(/customer scope standard -> custY/.test(upd) && /default true -> false/.test(upd));
  assert.ok(/\[ROUTING_VERSION_COPIED\].*from version R1/.test(rt.describeRoutingVersionChange(null, version({ versionCode: 'R2' }), 'R1')));
  const before = { id: 'v1', ...version({ steps: [step(1, 'op-mix'), step(2, 'op-press'), step(3, 'op-kiln')] }) };
  const after = { ...before, steps: [step(3, 'op-kiln', { sequence: 1, hierarchyNodeId: '512', equipmentCategoryId: 'rotaryKilns', equipmentId: 'rk-01', required: false }), step(1, 'op-press', { sequence: 2 }), step(4, 'op-mix', { sequence: 3 })] };
  const d = rt.describeRoutingVersionChange(before, after);
  for (const re of [/steps added: L4 operation op-mix/, /steps removed: L2 operation op-press/, /steps reordered/, /L1 operation op-mix -> op-press/, /L3 cost centre override - -> 512/, /L3 equipment -\/- -> rotaryKilns\/rk-01/, /L3 required true -> false/]) {
    assert.ok(re.test(d), `${re} in ${d}`);
  }
  assert.ok(/\[ROUTING_VERSION_ACTIVATED\]/.test(rt.describeRoutingVersionChange(before, { ...before, status: 'ACTIVE' })));
  assert.ok(/\[ROUTING_VERSION_RETIRED\]/.test(rt.describeRoutingVersionChange({ ...before, status: 'ACTIVE' }, { ...before, status: 'RETIRED' })));
});

test('U5. rules follow the Master Data pattern for routings and routingVersions - nothing public', () => {
  const rules = readSource('firestore.rules');
  for (const [coll, param] of [['routings', 'routingId'], ['routingVersions', 'routingVersionId']]) {
    const m = rules.match(new RegExp(`match /${coll}/\\{${param}\\} \\{([\\s\\S]*?)\\n\\s*\\}`));
    assert.ok(m, coll);
    assert.deepEqual(m![1].split('\n').map((l) => l.trim()).filter(Boolean), ['allow read: if isSignedIn();', 'allow write: if isAdmin();'], coll);
  }
});

test('U6. no Odoo fields or calls, and no automatic routing creation', () => {
  const code = readCode(PURE) + readCode(SERVICE) + readCode(MODAL) + interfaceBlock('Routing') + interfaceBlock('RoutingVersion') + interfaceBlock('RoutingStep');
  assert.equal(/odoo|fetch\(|axios|jsonrpc/i.test(code), false);
  assert.equal(/useEffect\([\s\S]{0,200}createRoutingVersion/.test(readCode(MODAL)), false);
  assert.equal(/routings/.test(readCode('src/services/bulkImportService.ts').replace(/type FormOnlyEquipmentTab[^\n]*/, '')), false, 'not a bulk-import target');
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

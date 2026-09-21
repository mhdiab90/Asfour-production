/**
 * JOB EXECUTION SETUP - Phase 1 Step 4.
 *
 * J  job configuration: four optional references, validation, locking, no write on refusal
 * D  defaults resolved to explicit version ids
 * I  immutability: ids only, BOMs / routings / batches never modified
 * C  compatibility: reuse of logical items, BOM, routing, batch; production untouched
 * U  existing Job References form, single audited write, permissions
 *
 * Pure modules run as shipped; the screen imports Firebase, so its wiring is
 * pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/jobConfiguration.test.ts
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

console.log('jobConfiguration.test.ts');

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

let jc: any;
let li: any;
let jb: any;
let ext: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  jc = await load('src/services/jobConfigurationPure.ts');
  li = await load('src/services/logicalItemPure.ts');
  jb = await load('src/services/jobBatchPure.ts');
  ext = await load('src/services/externalReferencesPure.ts');
}

const PURE = 'src/services/jobConfigurationPure.ts';
const VIEW = 'src/components/masterData/MasterDataView.tsx';
const fields = (v: any) => v.issues.map((i: any) => i.field);

// A small factory world: Brick A (product-only logical item), Kaolin (product + material), Mortar.
const data = () => deepFreeze({
  logicalItems: [
    { id: 'li-brick', productId: 'p-brick', materialId: null, status: 'ACTIVE' },
    { id: 'li-kaolin', productId: 'p-kaolin', materialId: 'm-kaolin', status: 'ACTIVE' },
    { id: 'li-mortar', productId: 'p-mortar', materialId: null, status: 'ACTIVE' },
    { id: 'li-old', productId: 'p-old', materialId: null, status: 'INACTIVE' },
  ].map((x) => li.readLogicalItem(x)),
  boms: [
    { id: 'bom-brick-std', code: 'BOM-BRICK-STD', name: 'Brick A Standard', itemSource: 'products', itemId: 'p-brick', customerId: null, isDefault: true, active: true },
    { id: 'bom-brick-x', code: 'BOM-BRICK-X', name: 'Brick A for X', itemSource: 'products', itemId: 'p-brick', customerId: 'custX', isDefault: true, active: true },
    { id: 'bom-kaolin-mat', code: 'BOM-KAO', name: 'Kaolin via material', itemSource: 'materials', itemId: 'm-kaolin', customerId: null, isDefault: true, active: true },
    { id: 'bom-mortar', code: 'BOM-MORTAR', name: 'Mortar', itemSource: 'products', itemId: 'p-mortar', customerId: null, isDefault: true, active: true },
    { id: 'bom-off', code: 'BOM-OFF', name: 'Inactive', itemSource: 'products', itemId: 'p-brick', customerId: null, isDefault: false, active: false },
  ],
  bomVersions: [
    { id: 'bv-brick-v2', bomId: 'bom-brick-std', versionCode: 'V2', status: 'RETIRED', components: [{ lineId: 'L1' }] },
    { id: 'bv-brick-v3', bomId: 'bom-brick-std', versionCode: 'V3', status: 'ACTIVE', components: [{ lineId: 'L1', itemSource: 'materials', itemId: 'clay', quantity: 10, unit: 'طن' }] },
    { id: 'bv-brick-v4', bomId: 'bom-brick-std', versionCode: 'V4', status: 'DRAFT', components: [] },
    { id: 'bv-brick-x1', bomId: 'bom-brick-x', versionCode: 'X1', status: 'ACTIVE', components: [] },
    { id: 'bv-kaolin', bomId: 'bom-kaolin-mat', versionCode: 'K1', status: 'ACTIVE', components: [] },
    { id: 'bv-mortar', bomId: 'bom-mortar', versionCode: 'M1', status: 'ACTIVE', components: [] },
    { id: 'bv-off', bomId: 'bom-off', versionCode: 'O1', status: 'ACTIVE', components: [] },
  ],
  routings: [
    { id: 'rt-brick-std', code: 'RT-BRICK-STD', name: 'Brick A Standard', logicalItemId: 'li-brick', customerId: null, isDefault: true, active: true },
    { id: 'rt-brick-x', code: 'RT-BRICK-X', name: 'Brick A for X', logicalItemId: 'li-brick', customerId: 'custX', isDefault: false, active: true },
    { id: 'rt-mortar', code: 'RT-MORTAR', name: 'Mortar A', logicalItemId: 'li-mortar', customerId: null, isDefault: true, active: true },
  ],
  routingVersions: [
    { id: 'rv-brick-r1', routingId: 'rt-brick-std', versionCode: 'R1', status: 'RETIRED', steps: [{ lineId: 'L1' }] },
    { id: 'rv-brick-r2', routingId: 'rt-brick-std', versionCode: 'R2', status: 'ACTIVE', steps: [{ lineId: 'L1', sequence: 1, operationId: 'op-mix' }] },
    { id: 'rv-brick-x1', routingId: 'rt-brick-x', versionCode: 'RX1', status: 'ACTIVE', steps: [] },
    { id: 'rv-mortar-r1', routingId: 'rt-mortar', versionCode: 'R1', status: 'ACTIVE', steps: [] },
  ],
  batches: [
    { id: 'b-free', batchNumber: 'B2026-001', productId: null, jobReferenceId: null, active: true },
    { id: 'b-brick', batchNumber: 'B2026-002', productId: 'p-brick', jobReferenceId: null, active: true },
    { id: 'b-mortar', batchNumber: 'B2026-003', productId: 'p-mortar', jobReferenceId: null, active: true },
    { id: 'b-off', batchNumber: 'B2026-004', productId: null, jobReferenceId: null, active: false },
    { id: 'b-other-job', batchNumber: 'B2026-005', productId: 'p-brick', jobReferenceId: 'job-other', active: true },
    { id: 'b-this-job', batchNumber: 'B2026-006', productId: 'p-brick', jobReferenceId: 'job-1', active: true },
  ],
});
const ctx = (over: Record<string, unknown> = {}) => ({ editingId: 'job-1', ...data(), ...over });
const job = (over: Record<string, unknown> = {}) => ({ id: 'job-1', code: 'JR-2026-001', status: 'DRAFT', sourceSystem: 'asfour', customerId: null, productId: null, notes: '', active: true, ...over });
const full = { logicalItemId: 'li-brick', bomVersionId: 'bv-brick-v3', routingVersionId: 'rv-brick-r2', batchId: 'b-brick' };

// ==================================================
// J. JOB CONFIGURATION
// ==================================================

test('1-4. a job can store a logical item, a BOM version, a routing version and a batch', () => {
  const block = interfaceBlock('JobReference');
  for (const f of ['logicalItemId?: string | null;', 'bomVersionId?: string | null;', 'routingVersionId?: string | null;', 'batchId?: string | null;']) assert.ok(block.includes(f), f);
  const v = jc.validateJobConfiguration(job(), job(full), ctx());
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  assert.deepEqual(jc.jobConfigurationPatch(job(), job(full)), full);
});

test('5/24. all four references are optional; existing jobs without them stay valid and gain no empty fields', () => {
  assert.equal(jc.validateJobConfiguration(null, job(), ctx()).valid, true, 'a new job without setup');
  const legacy = { id: 'job-old', code: 'JR-OLD', status: 'ACTIVE', sourceSystem: 'asfour', active: true };
  assert.equal(jc.validateJobConfiguration(legacy, { ...legacy, notes: 'edited' }, ctx({ logicalItems: null, boms: null, bomVersions: null, routings: null, routingVersions: null, batches: null })).valid, true, 'nothing to verify, nothing required');
  assert.deepEqual(jc.jobConfigurationPatch(legacy, { ...legacy, notes: 'edited' }), {}, 'no empty fields written onto an old job');
  assert.deepEqual(jc.jobConfigurationPatch(job(full), job({ ...full, batchId: '' })), { ...full, batchId: null }, 'clearing a stored value is written');
  assert.equal(jb.validateJobReferenceForSave([], legacy).valid, true, 'the Step 1E job rules still accept it');
});

test('6/20. the logical item must exist and be active - never created', () => {
  assert.deepEqual(fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-ghost' }), ctx())), ['logicalItemId']);
  assert.deepEqual(fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-old' }), ctx())), ['logicalItemId'], 'inactive');
  assert.deepEqual(fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'p-brick' }), ctx())), ['logicalItemId'], 'a product id is not a logical item');
  assert.deepEqual(fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick' }), ctx({ logicalItems: null }))), ['logicalItemId'], 'unverifiable');
  assert.deepEqual(fields(jc.validateJobConfiguration(job(), job({ bomVersionId: 'bv-brick-v3' }), ctx())), ['logicalItemId'], 'the item comes first');
  assert.equal(/createMasterDataItem|registerLogicalItem|logicalItemRegistrationPayload/.test(readCode(PURE)), false);
});

test('J2. the older productId must agree with the logical item - logicalItemId is authoritative', () => {
  assert.equal(jc.validateJobConfiguration(job(), job({ productId: 'p-brick', logicalItemId: 'li-brick' }), ctx()).valid, true);
  assert.deepEqual(fields(jc.validateJobConfiguration(job(), job({ productId: 'p-mortar', logicalItemId: 'li-brick' }), ctx())), ['productId']);
});

test('7/18. the BOM version must exist and be ACTIVE (not RETIRED, not DRAFT, not of an inactive BOM)', () => {
  const pick = (id: string) => fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick', bomVersionId: id }), ctx()));
  assert.deepEqual(pick('bv-ghost'), ['bomVersionId']);
  assert.deepEqual(pick('bv-brick-v2'), ['bomVersionId'], 'RETIRED');
  assert.deepEqual(pick('bv-brick-v4'), ['bomVersionId'], 'DRAFT');
  assert.deepEqual(pick('bv-off'), ['bomVersionId'], 'inactive BOM header');
  assert.ok(/not ACTIVE \(RETIRED\)/.test(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick', bomVersionId: 'bv-brick-v2' }), ctx()).issues[0].messageEn));
});

test('8/19. the routing version must exist and be ACTIVE', () => {
  const pick = (id: string) => fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick', routingVersionId: id }), ctx()));
  assert.deepEqual(pick('rv-ghost'), ['routingVersionId']);
  assert.deepEqual(pick('rv-brick-r1'), ['routingVersionId'], 'RETIRED');
  assert.deepEqual(pick('rv-brick-r2'), []);
});

test('9/14b. the batch must exist and be active', () => {
  const pick = (id: string) => fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick', batchId: id }), ctx()));
  assert.deepEqual(pick('b-ghost'), ['batchId']);
  assert.deepEqual(pick('b-off'), ['batchId'], 'inactive');
  assert.deepEqual(pick('b-free'), [], 'a batch not tied to a product is allowed');
});

test('10/15. an incompatible BOM (another logical item) is rejected; a mapped material BOM resolves through the resolver', () => {
  assert.deepEqual(fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick', bomVersionId: 'bv-mortar' }), ctx())), ['bomVersionId']);
  assert.equal(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-kaolin', bomVersionId: 'bv-kaolin' }), ctx()).valid, true, 'BOM made by the material side of the kaolin logical item');
  assert.ok(/resolveLogicalItemId\(logicalItems, text\(bom\.itemSource\), text\(bom\.itemId\)\)/.test(readCode(PURE)), 'the shared resolver');
});

test('11/16. an incompatible routing (another logical item) is rejected', () => {
  assert.deepEqual(fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick', routingVersionId: 'rv-mortar-r1' }), ctx())), ['routingVersionId']);
});

test('12. BOM and routing must resolve to the same logical item - Brick BOM with Mortar routing is refused', () => {
  const v = jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick', bomVersionId: 'bv-brick-v3', routingVersionId: 'rv-mortar-r1' }), ctx());
  assert.equal(v.valid, false);
  assert.ok(fields(v).includes('routingVersionId'));
  assert.ok(v.issues.some((i: any) => /different logical items/.test(i.messageEn)), 'the pair itself is named as inconsistent');
});

test('13/14. customer scope is exact: standard only without a customer, customer X only for X - no implicit fallback', () => {
  const noCustomer = (bv: string, rv?: string) => fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick', bomVersionId: bv, ...(rv ? { routingVersionId: rv } : {}) }), ctx()));
  assert.deepEqual(noCustomer('bv-brick-v3'), []);
  assert.deepEqual(noCustomer('bv-brick-x1'), ['bomVersionId'], 'a customer BOM on a standard job');
  const forX = (over: Record<string, unknown>) => fields(jc.validateJobConfiguration(job(), job({ customerId: 'custX', logicalItemId: 'li-brick', ...over }), ctx()));
  assert.deepEqual(forX({ bomVersionId: 'bv-brick-x1', routingVersionId: 'rv-brick-x1' }), []);
  assert.deepEqual(forX({ bomVersionId: 'bv-brick-v3' }), ['bomVersionId'], 'standard BOM on a customer job - no fallback');
  assert.deepEqual(forX({ routingVersionId: 'rv-brick-r2' }), ['routingVersionId'], 'standard routing on a customer job - no fallback');
  const lists = jc.compatibleBomVersions({ logicalItemId: 'li-brick', customerId: 'custX' }, data().boms, data().bomVersions, data().logicalItems);
  assert.deepEqual(lists.map((x: any) => x.version.id), ['bv-brick-x1']);
});

test('17. an item-bound batch must match the logical item, and a job-bound batch must be this job', () => {
  const pick = (id: string, item = 'li-brick') => fields(jc.validateJobConfiguration(job(), job({ logicalItemId: item, batchId: id }), ctx()));
  assert.deepEqual(pick('b-mortar'), ['batchId'], 'another product');
  assert.deepEqual(pick('b-other-job'), ['batchId'], 'bound to another job');
  assert.deepEqual(pick('b-this-job'), [], 'bound to this job');
  assert.deepEqual(jc.compatibleBatches({ logicalItemId: 'li-brick' }, data().batches, data().logicalItems, 'job-1').map((b: any) => b.id), ['b-free', 'b-brick', 'b-this-job']);
});

test('J3. a stored reference is preserved when its version is retired later; only new or changed choices are checked', () => {
  const stored = job(full);
  const retiredWorld = ctx({ bomVersions: data().bomVersions.map((v: any) => (v.id === 'bv-brick-v3' ? { ...v, status: 'RETIRED' } : v)) });
  assert.equal(jc.validateJobConfiguration(stored, { ...stored, notes: 'edited' }, retiredWorld).valid, true, 'untouched reference kept');
  assert.deepEqual(fields(jc.validateJobConfiguration(stored, { ...stored, customerId: 'custX' }, retiredWorld)).includes('bomVersionId'), true, 'a scope change re-checks it');
  assert.deepEqual(fields(jc.validateJobConfiguration(job(), job({ logicalItemId: 'li-brick', bomVersionId: 'bv-brick-v3' }), retiredWorld)), ['bomVersionId'], 'but a retired version cannot be newly selected');
});

test('J4. completed and cancelled jobs refuse setup changes; draft and active jobs allow them', () => {
  for (const status of ['COMPLETED', 'CANCELLED']) {
    const stored = job({ status, ...full });
    assert.deepEqual(fields(jc.validateJobConfiguration(stored, { ...stored, routingVersionId: null }, ctx())), ['status'], status);
    assert.equal(jc.validateJobConfiguration(stored, { ...stored, notes: 'x' }, ctx()).valid, true, `${status}: other fields still editable`);
  }
  for (const status of ['DRAFT', 'ACTIVE']) {
    assert.equal(jc.validateJobConfiguration(job({ status }), job({ status, ...full }), ctx()).valid, true, status);
  }
});

test('21/22. an invalid setup produces NO write; a valid one is part of the job\'s single audited update', () => {
  const view = readCode(VIEW);
  const save = view.slice(view.indexOf('if (activeTab === \'jobReferences\') {\n          const setup = validateJobConfiguration('));
  assert.ok(save.length > 0, 'setup validation lives in the job save');
  assert.ok(/const setup = validateJobConfiguration\(editingItem, formData, \{ editingId: editingItem\?\.id \?\? null, \.\.\.jobSetup \}\);\s*if \(!setup\.valid\) \{\s*throw new Error/.test(view), 'refusal throws before any write');
  assert.ok(view.indexOf('const setup = validateJobConfiguration(') < view.indexOf('await updateMasterDataItem(MASTER_DATA_COLLECTIONS[activeTab], editingItem.id, dataToWrite);'));
  assert.ok(/dataToWrite = \{ \.\.\.dataToWrite, \.\.\.jobConfigurationPatch\(editingItem, formData\) \};/.test(view), 'merged into the job payload');
  assert.equal((view.match(/updateMasterDataItem\(/g) || []).length, 1, 'one shared update');
  assert.equal((view.match(/createMasterDataItem\(/g) || []).length, 1, 'one shared create');
  assert.ok(/if \(setupChange\) logAuditAction\(editingItem \? 'UPDATE' : 'CREATE', MASTER_DATA_COLLECTIONS\.jobReferences, savedId, setupChange\)/.test(view));
  const text = jc.describeJobConfigurationChange(job({ bomVersionId: 'V1', routingVersionId: 'R1', batchId: 'B1', logicalItemId: 'L' }), job({ bomVersionId: 'V2', routingVersionId: 'R2', batchId: 'B2', logicalItemId: 'L' }));
  assert.ok(/Job JR-2026-001 configuration changed from logical item L \/ BOM V1 \/ Routing R1 \/ Batch B1 to logical item L \/ BOM V2 \/ Routing R2 \/ Batch B2/.test(text), text);
  assert.equal(jc.describeJobConfigurationChange(job(full), { ...job(full), notes: 'x' }), null, 'no setup change, no setup audit line');
});

test('23. existing job fields remain intact - the setup patch adds only its own four fields', () => {
  const payload = { ...jb.jobReferencePayloadForSave(job({ ...full })), ...jc.jobConfigurationPatch(job(), job(full)) };
  // `parentJobReferenceId` comes from the Step 1E payload (Phase 1 Step 8C sub-jobs), not from the setup patch.
  assert.deepEqual(Object.keys(payload).sort(), ['active', 'batchId', 'bomVersionId', 'code', 'customerId', 'logicalItemId', 'notes', 'parentJobReferenceId', 'productId', 'routingVersionId', 'sourceSystem', 'status']);
  assert.deepEqual(Object.keys(jc.jobConfigurationPatch(job(), job(full))).sort(), ['batchId', 'bomVersionId', 'logicalItemId', 'routingVersionId']);
  assert.ok(/dataToWrite = activeTab === 'jobReferences' \? jobReferencePayloadForSave\(formData\) : batchPayloadForSave\(formData\);/.test(readCode(VIEW)), 'the Step 1E payload is unchanged');
});

// ==================================================
// D. DEFAULTS
// ==================================================

test('25/26/27. Use Default resolves to explicit version ids - never a "uses default" flag', () => {
  const d = data();
  assert.deepEqual(jc.resolveDefaultBomVersion({ logicalItemId: 'li-brick', customerId: null }, d.boms, d.bomVersions, d.logicalItems).versionId, 'bv-brick-v3');
  assert.equal(jc.resolveDefaultBomVersion({ logicalItemId: 'li-brick', customerId: 'custX' }, d.boms, d.bomVersions, d.logicalItems).versionId, 'bv-brick-x1', 'the customer default in the exact scope');
  assert.equal(jc.resolveDefaultRoutingVersion({ logicalItemId: 'li-brick', customerId: null }, d.routings, d.routingVersions).versionId, 'rv-brick-r2');
  const none = jc.resolveDefaultRoutingVersion({ logicalItemId: 'li-brick', customerId: 'custX' }, d.routings, d.routingVersions);
  assert.equal(none.versionId, null, 'no default routing for X - no fallback to standard');
  assert.ok(/no active default routing/.test(none.messageEn));
  const noActive = jc.resolveDefaultBomVersion({ logicalItemId: 'li-brick', customerId: null }, d.boms, d.bomVersions.filter((v: any) => v.id !== 'bv-brick-v3'), d.logicalItems);
  assert.equal(noActive.versionId, null);
  assert.ok(/has no active version/.test(noActive.messageEn));
  assert.equal(/usesDefault|useDefault\s*:|isDefaultSelection/.test(interfaceBlock('JobReference') + JSON.stringify(jc.jobConfigurationPatch(job(), job(full)))), false);
  const view = readCode(VIEW);
  assert.ok(/setFormData\(\{ \.\.\.formData, \[sel\.key\]: resolved\.versionId \}\)/.test(view), 'the resolved id is what the form stores');
});

// ==================================================
// I. IMMUTABILITY
// ==================================================

test('28/29/30/31. selection modifies no BOM, routing or batch, and stores ids - never components or steps', () => {
  const world = data();
  jc.validateJobConfiguration(job(), job(full), ctx());
  jc.compatibleBomVersions({ logicalItemId: 'li-brick' }, world.boms, world.bomVersions, world.logicalItems);
  jc.resolveDefaultRoutingVersion({ logicalItemId: 'li-brick' }, world.routings, world.routingVersions);
  // deepFreeze would have thrown on any mutation.
  const patch = jc.jobConfigurationPatch(job(), job({ ...full, components: [{}], steps: [{}] }));
  assert.equal('components' in patch || 'steps' in patch, false);
  assert.ok(Object.values(patch).every((v) => typeof v === 'string'));
  const code = readCode(PURE);
  assert.equal(/createMasterDataItem|updateMasterDataItem|firebase|setDoc|addDoc|writeBatch|\.components\b|\.steps\b/.test(code), false);
  const view = readCode(VIEW);
  const jobSave = view.slice(view.indexOf("if (activeTab === 'jobReferences') {\n          const setup"), view.indexOf('let savedId'));
  assert.equal(/boms|bomVersions|routings|routingVersions|batches/.test(jobSave.replace(/\.\.\.jobSetup/, '')), false, 'the job save writes nothing else');
});

// ==================================================
// C. COMPATIBILITY
// ==================================================

test('32. the Step 1A external references are unchanged on jobs', () => {
  assert.ok(interfaceBlock('JobReference').includes('extends WithExternalReferences'));
  assert.equal(/odoo/i.test(interfaceBlock('JobReference') + readCode(PURE)), false);
  assert.equal(typeof ext.validateExternalReference, 'function');
  const changed = execFileSync('git', ['status', '--short', '--', 'src/services/externalReferencesPure.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim();
  assert.ok(changed === '' || changed.startsWith('??'), 'no tracked diff');
});

test('33/34/35/36. logical item resolver, BOM, routing and batch architecture are reused - no second model or selector', () => {
  const code = readCode(PURE);
  assert.ok(/import \{ resolveLogicalItemId \} from '\.\/logicalItemPure';/.test(code));
  assert.equal(/interface\s+(JobExecution|ManufacturingOrder|ProductionOrder)/.test(readCode('src/types/index.ts')), false, 'no manufacturing-order model');
  const view = readCode(VIEW);
  assert.ok(/fetchMasterData<any>\(BOM_VERSION_COLLECTION\)/.test(view) && /fetchMasterData<any>\(ROUTING_VERSION_COLLECTION\)/.test(view) && /fetchMasterData<any>\(MASTER_DATA_COLLECTIONS\.batches\)/.test(view));
  assert.ok(/id="job-logical-item"[\s\S]{0,600}options=\{logicalItemOptions\}/.test(view), 'the existing SmartEntitySelect with the Step 3 logical item options');
  const components = fs.readdirSync(path.join(ROOT, 'src/components'), { recursive: true } as any) as string[];
  assert.equal(components.some((f) => /JobExecution|ManufacturingOrder|ProductionOrder|JobConfig/i.test(String(f))), false, 'no new screen');
  assert.equal(/'job-execution'|'manufacturing-order'/.test(readCode('src/types/index.ts') + readCode('src/App.tsx')), false, 'no new navigation');
});

test('P. production, stage collections and stage forms are untouched', () => {
  const changed = [changedBeyondStep8C5(ROOT, ['src/services/productionService.ts', 'src/services/productionStageConfig.ts', 'src/services/stageQueryBoundsPure.ts']), stageRecordServiceChangedBeyondApproved(ROOT)].filter(Boolean).join('\n');
  assert.equal(changed, '', changed);
  for (const name of ['ProductionRecord', 'UniversalStageRecord', 'Batch']) {
    assert.equal(/bomVersionId|routingVersionId|logicalItemId/.test(interfaceBlock(name)), false, name);
  }
  assert.equal(/stage_|'production'|productionService|stageRecordService/.test(readCode(PURE)), false);
});

// ==================================================
// U. UI AND PERMISSIONS
// ==================================================

test('U1. the setup lives in the existing Job Reference form, readable before save, behind the existing gate', () => {
  const view = readCode(VIEW);
  const form = view.slice(view.indexOf('id="job-reference-form"'), view.indexOf('id="batch-form"'));
  for (const id of ['job-execution-setup', 'job-logical-item', 'job-bom-version', 'job-routing-version', 'job-batch', 'job-execution-summary']) {
    assert.ok(form.includes(`id="${id}"`) || form.includes(`'${id}'`), id);
  }
  assert.ok(/if \(isJobBatchTab\) \{\s*if \(!canImportMasterData\) \{\s*throw new Error/.test(view), 'the existing Master Data edit gate');
  assert.ok(/disabled=\{jobSetupLocked \|\| !formData\.logicalItemId\}/.test(view), 'selectors follow the item and the lock');
  assert.ok(/\(not compatible\)/.test(view), 'an incompatible stored choice is shown, not replaced');
  assert.equal(/'(jobConfiguration|jobExecution)\./i.test(readCode('src/types/permissions.ts')), false, 'no new permission keys');
  const rules = readSource('firestore.rules');
  assert.ok(/match \/jobReferences\/\{jobReferenceId\} \{\s*allow read: if isSignedIn\(\);\s*allow write: if isAdmin\(\);/.test(rules), 'job writes stay admin-only; no rule change needed');
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

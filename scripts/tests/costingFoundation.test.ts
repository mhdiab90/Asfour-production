/**
 * PRE-COSTING FOUNDATION - Phase 1 Step 8C.
 *
 * J  jobs: main job -> sub-jobs, many batches per job, backward compatible
 * M  material cost: actual (Odoo average) vs pricing (latest price) - never one field
 * A  allocation setup: driver, driver source, sequence, effective windows, history
 * P  costing period: any window, lifecycle, closed immutability, audited reopen
 * H  historical: snapshot references, current vs historical
 * B  BOM / UOM rules unchanged
 * I  import: the existing partial-import behaviour is untouched
 * S  safety: no costing engine, no rules change, no migration
 *
 * Run: npx tsx scripts/tests/costingFoundation.test.ts
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

console.log('costingFoundation.test.ts');

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

let jb: any;
let cp: any;
let cs: any;
let bom: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  jb = await load('src/services/jobBatchPure.ts');
  cp = await load('src/services/costingPeriodPure.ts');
  cs = await load('src/services/costingSetupPure.ts');
  bom = await load('src/services/bomPure.ts');
}

const PERIOD_PURE = 'src/services/costingPeriodPure.ts';
const SETUP_PURE = 'src/services/costingSetupPure.ts';
const SERVICE = 'src/services/costingSetupService.ts';
const PANEL = 'src/components/masterData/CostingSetupPanel.tsx';
const TRACE_PANEL = 'src/components/production/ProductionTraceabilityPanel.tsx';
const fields = (v: any) => v.issues.map((i: any) => i.field);

// ==================================================
// J. JOB -> SUB-JOB -> BATCH
// ==================================================

const jobs = () => deepFreeze([
  { id: 'j-main', code: 'JOB-100', customerId: 'c1', status: 'ACTIVE', active: true },
  { id: 'j-sub1', code: 'JOB-100-A', customerId: 'c1', status: 'ACTIVE', active: true, parentJobReferenceId: 'j-main' },
  { id: 'j-sub2', code: 'JOB-100-B', customerId: 'c1', status: 'ACTIVE', active: true, parentJobReferenceId: 'j-main' },
  { id: 'j-other', code: 'JOB-200', customerId: 'c2', status: 'ACTIVE', active: true },
]);
const batches = () => deepFreeze([
  { id: 'b1', batchNumber: 'B-1', jobReferenceId: 'j-main' },
  { id: 'b2', batchNumber: 'B-2', jobReferenceId: 'j-main' },
  { id: 'b3', batchNumber: 'B-3', jobReferenceId: 'j-sub1' },
  { id: 'b4', batchNumber: 'B-4', jobReferenceId: 'j-sub1' },
  { id: 'b5', batchNumber: 'B-5', jobReferenceId: null },
]);

test('1-2. one job has many batches, and so does a sub-job', () => {
  assert.deepEqual(jb.batchesOfJob(batches(), { id: 'j-main' }).map((b: any) => b.batchNumber), ['B-1', 'B-2']);
  assert.deepEqual(jb.batchesOfJob(batches(), { id: 'j-sub1' }).map((b: any) => b.batchNumber), ['B-3', 'B-4']);
  assert.deepEqual(jb.batchesOfJobTree(jobs(), batches(), 'j-main').map((b: any) => b.batchNumber), ['B-1', 'B-2', 'B-3', 'B-4'], 'the whole customer order');
  assert.deepEqual(jb.subJobsOf(jobs(), 'j-main').map((j: any) => j.code), ['JOB-100-A', 'JOB-100-B']);
});

test('3. a batch names its job or sub-job, and a job may be a sub-job of one main job only', () => {
  const ctx = { jobReferences: jobs(), knownCustomerIds: new Set(['c1', 'c2']) };
  assert.equal(jb.validateJobReferenceForSave(jobs(), { code: 'JOB-100-C', status: 'ACTIVE', customerId: 'c1', parentJobReferenceId: 'j-main' }, ctx).valid, true);
  assert.deepEqual(fields(jb.validateJobReferenceForSave(jobs(), { code: 'JOB-X', status: 'ACTIVE', parentJobReferenceId: 'j-sub1' }, ctx)), ['parentJobReferenceId'], 'a sub-job cannot be a parent');
  assert.deepEqual(fields(jb.validateJobReferenceForSave(jobs(), { code: 'JOB-X', status: 'ACTIVE', parentJobReferenceId: 'ghost' }, ctx)), ['parentJobReferenceId']);
  assert.deepEqual(fields(jb.validateJobReferenceForSave(jobs(), { code: 'JOB-100', status: 'ACTIVE', parentJobReferenceId: 'j-main' }, { ...ctx, editingId: 'j-main' })), ['parentJobReferenceId'], 'never its own parent');
  assert.deepEqual(fields(jb.validateJobReferenceForSave(jobs(), { code: 'JOB-100', status: 'ACTIVE', parentJobReferenceId: 'j-other' }, { ...ctx, editingId: 'j-main' })), ['parentJobReferenceId'], 'a main job with sub-jobs cannot become one');
  assert.deepEqual(fields(jb.validateJobReferenceForSave(jobs(), { code: 'JOB-Y', status: 'ACTIVE', customerId: 'c2', parentJobReferenceId: 'j-main' }, ctx)), ['customerId'], "a sub-job keeps its main job's customer");
  assert.equal(jb.isSubJob(jobs()[1]), true);
  assert.equal(jb.isSubJob(jobs()[0]), false);
});

test('4. existing single-batch behaviour is untouched: the job keeps its selected batchId', () => {
  const payload = jb.jobReferencePayloadForSave({ code: 'JOB-1', status: 'ACTIVE' });
  assert.equal(payload.parentJobReferenceId, null, 'a plain job is a main job');
  assert.equal(jb.validateJobReferenceForSave([], { code: 'JOB-1', status: 'ACTIVE' }).valid, true, 'no parent, no job list needed');
  const selected = jb.batchesOfJob([...batches(), { id: 'b9', batchNumber: 'B-9' }], { id: 'j-main', batchId: 'b9' });
  assert.deepEqual(selected.map((b: any) => b.batchNumber), ['B-1', 'B-2', 'B-9'], "the Step 4 selected batch is included");
  assert.equal(/batchId/.test(readCode('src/services/jobConfigurationPure.ts')), true, 'Step 4 execution setup still stores one selected batch');
});

// ==================================================
// M. MATERIAL COST
// ==================================================

test('5-7. actual issue cost and pricing reference price are separate purposes with separate sources', () => {
  assert.deepEqual([...cs.MATERIAL_COST_PURPOSES], ['ACTUAL_ISSUE_COST', 'PRICING_REFERENCE_PRICE']);
  assert.equal(cs.DEFAULT_MATERIAL_COST_SOURCE.ACTUAL_ISSUE_COST, 'ODOO_AVERAGE_COST');
  assert.equal(cs.DEFAULT_MATERIAL_COST_SOURCE.PRICING_REFERENCE_PRICE, 'LATEST_PURCHASE_PRICE');
  assert.deepEqual(cs.materialCostSourceIssues('ACTUAL_ISSUE_COST', 'ODOO_AVERAGE_COST'), []);
  assert.deepEqual(cs.materialCostSourceIssues('PRICING_REFERENCE_PRICE', 'LATEST_PURCHASE_PRICE'), []);
  assert.equal(cs.materialCostSourceIssues('ACTUAL_ISSUE_COST', 'LATEST_PURCHASE_PRICE').length, 1, 'a pricing price is never the actual cost');
  assert.equal(cs.materialCostSourceIssues('PRICING_REFERENCE_PRICE', 'ODOO_AVERAGE_COST').length, 1);
  assert.equal(cs.materialCostSourceIssues('ACTUAL_ISSUE_COST', 'GUESS').length, 1);
  // No amount, rate or price is stored or calculated anywhere in the foundation.
  const code = [PERIOD_PURE, SETUP_PURE, SERVICE].map(readCode).join('\n').replace(/['"`][^'"`\n]*['"`]/g, '""');
  assert.equal(/amount|price\s*[:=]\s*[0-9]|unitCost|totalCost|rate\s*[:=]\s*[0-9]/i.test(code), false);
});

// ==================================================
// A. ALLOCATION SETUP
// ==================================================

const setup = (over: Record<string, unknown> = {}) => ({ sourceCostCenterCode: '601', targetCostCenterCode: '701', method: 'DRIVER_BASED', driver: 'PRODUCTION_TONS', driverSource: 'PRODUCTION_RECORDS', sequence: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30', active: true, ...over });
const centres = new Set(['601', '602', '615', '701', '702']);

test('8-9. the driver and its source are configuration - and an unavailable source is reported, never invented', () => {
  assert.ok(cs.COST_DRIVERS.includes('PRODUCTION_TONS') && cs.COST_DRIVERS.includes('MACHINE_HOURS') && cs.COST_DRIVERS.includes('CUSTOM'));
  assert.equal(cs.validateAllocationSetupForSave([], setup(), { knownCostCenterCodes: centres }).valid, true);
  assert.deepEqual(fields(cs.validateAllocationSetupForSave([], setup({ driver: '' }), { knownCostCenterCodes: centres })), ['driver']);
  assert.deepEqual(fields(cs.validateAllocationSetupForSave([], setup({ driverSource: '' }), { knownCostCenterCodes: centres })), ['driverSource']);
  assert.deepEqual(fields(cs.validateAllocationSetupForSave([], setup({ driver: 'PRODUCTION_TONS', driverSource: 'EMPLOYEE_MASTER' }), { knownCostCenterCodes: centres })), ['driverSource'], 'a source that cannot serve the driver');
  assert.equal(cs.driverSourceAvailability('PRODUCTION_TONS', 'PRODUCTION_RECORDS').availability, 'AVAILABLE');
  assert.equal(cs.driverSourceAvailability('ENERGY_CONSUMPTION', 'METER_IMPORT').availability, 'NOT_AVAILABLE');
  assert.equal(cs.driverSourceAvailability('LABOR_HOURS', 'LABOR_RECORDS').availability, 'PARTIAL');
  assert.ok(cs.driverSourceAvailability('CUSTOM', 'ODOO_IMPORT').noteEn.includes('not built yet'));
  assert.deepEqual(fields(cs.validateAllocationSetupForSave([], setup({ method: 'PERCENTAGE', percentage: 0 }), { knownCostCenterCodes: centres })), ['percentage']);
  assert.equal(cs.validateAllocationSetupForSave([], setup({ method: 'PERCENTAGE', percentage: 12.5, driver: '', driverSource: '' }), { knownCostCenterCodes: centres }).valid, true, 'an explicit percentage stays configurable');
});

test('10. the step-down sequence is configuration: ordered, and never ambiguous within one window', () => {
  const rows = [{ id: 'a', ...setup({ targetCostCenterCode: '702' }) }, { id: 'b', ...setup({ sourceCostCenterCode: '602', sequence: 2 }) }];
  assert.deepEqual(cs.allocationSetupsForDate(rows, '2026-03-01').map((r: any) => r.sequence), [1, 2]);
  assert.deepEqual(fields(cs.validateAllocationSetupForSave(rows, setup({ sequence: 1 }), { knownCostCenterCodes: centres })), ['sequence'], 'two targets cannot share one step for the same source');
  assert.deepEqual(fields(cs.validateAllocationSetupForSave(rows, setup({ targetCostCenterCode: '702', sequence: 3 }), { knownCostCenterCodes: centres })), ['targetCostCenterCode'], 'the same pair twice in one window');
  assert.deepEqual(fields(cs.validateAllocationSetupForSave([], setup({ sequence: 0 }), { knownCostCenterCodes: centres })), ['sequence']);
  assert.deepEqual(fields(cs.validateAllocationSetupForSave([], setup({ targetCostCenterCode: '601' }), { knownCostCenterCodes: centres })), ['targetCostCenterCode'], 'never onto itself');
  assert.deepEqual(fields(cs.validateAllocationSetupForSave([], setup({ sourceCostCenterCode: '999' }), { knownCostCenterCodes: centres })), ['sourceCostCenterCode']);
});

test('11-12. the same centre uses one driver in H1 and another in H2 - the earlier row is untouched', () => {
  const h1 = { id: 'h1', ...setup() };
  const h2 = setup({ driver: 'MACHINE_HOURS', driverSource: 'EQUIPMENT_RECORDS', effectiveFrom: '2026-07-01', effectiveTo: '2026-12-31' });
  assert.equal(cs.validateAllocationSetupForSave([h1], h2, { knownCostCenterCodes: centres }).valid, true, 'a later window is not a duplicate');
  assert.deepEqual(cs.allocationSetupsForDate([h1, { id: 'h2', ...h2 }], '2026-03-15').map((r: any) => r.driver), ['PRODUCTION_TONS']);
  assert.deepEqual(cs.allocationSetupsForDate([h1, { id: 'h2', ...h2 }], '2026-09-15').map((r: any) => r.driver), ['MACHINE_HOURS']);
  assert.deepEqual(h1.driver, 'PRODUCTION_TONS', 'the H1 configuration is not rewritten');
  assert.deepEqual(fields(cs.validateAllocationSetupForSave([], setup({ effectiveFrom: '2026-07-01', effectiveTo: '2026-01-01' }), { knownCostCenterCodes: centres })), ['effectiveTo']);
});

test('A/behaviour + mapping. account behaviour and the cost centre / operation / equipment mapping are configuration too', () => {
  assert.deepEqual([...cs.ACCOUNT_BEHAVIORS], ['FIXED', 'VARIABLE', 'STUDY_MANUAL', 'SALARY_MIX']);
  const accounts = new Set(['5101']);
  assert.equal(cs.validateAccountBehaviorForSave([], { accountCode: '5101', behavior: 'FIXED', effectiveFrom: '2026-01-01' }, { knownAccountCodes: accounts }).valid, true);
  assert.deepEqual(fields(cs.validateAccountBehaviorForSave([], { accountCode: '5101', behavior: 'GUESS' }, { knownAccountCodes: accounts })), ['behavior']);
  assert.deepEqual(fields(cs.validateAccountBehaviorForSave([{ id: 'x', accountCode: '5101', behavior: 'FIXED', active: true }], { accountCode: '5101', behavior: 'VARIABLE' }, { knownAccountCodes: accounts })), ['accountCode'], 'one behaviour per account per window');
  const map = { historicalLineCode: 'LINE-601', costCenterCode: '601', operationId: 'op-press', equipmentCategoryId: 'presses', equipmentId: 'press-1', productionLineCode: 'PRESS-LINE' };
  const ctx = { knownCostCenterCodes: centres, knownOperationIds: new Set(['op-press']) };
  assert.equal(cs.validateCostCenterMapForSave([], map, ctx).valid, true);
  assert.deepEqual(fields(cs.validateCostCenterMapForSave([], { ...map, operationId: 'ghost' }, ctx)), ['operationId']);
  const payload = cs.costCenterMapPayloadForSave(map);
  for (const f of ['costCenterCode', 'operationId', 'equipmentCategoryId', 'equipmentId', 'productionLineCode']) assert.ok(f in payload, `${f} stays its own field`);
});

// ==================================================
// P. COSTING PERIOD
// ==================================================

const period = (over: Record<string, unknown> = {}) => ({ code: 'P-2026-01', name: 'January 2026', periodType: 'MONTH', startDate: '2026-01-01', endDate: '2026-01-31', status: 'OPEN', calculationVersion: 1, active: true, ...over });

test('13. a period is any explicit window - a month, six months, a year - never a hard-coded month', () => {
  for (const [type, start, end] of [['MONTH', '2026-01-01', '2026-01-31'], ['HALF_YEAR', '2026-01-01', '2026-06-30'], ['YEAR', '2026-01-01', '2026-12-31'], ['CUSTOM', '2026-02-05', '2026-03-09']] as const) {
    assert.equal(cp.validateCostingPeriodForSave([], period({ periodType: type, startDate: start, endDate: end }), {}).valid, true, type);
  }
  assert.deepEqual(fields(cp.validateCostingPeriodForSave([], period({ startDate: '2026-02-01', endDate: '2026-01-01' }), {})), ['endDate']);
  assert.deepEqual(fields(cp.validateCostingPeriodForSave([{ id: 'x', ...period() }], period({ code: 'P-2', startDate: '2026-01-15', endDate: '2026-02-15' }), {})), ['startDate'], 'a day belongs to one period');
  assert.equal(cp.costingPeriodForDate([{ id: 'x', ...period() }], '2026-01-10').code, 'P-2026-01');
  assert.equal(cp.costingPeriodForDate([{ id: 'x', ...period() }], '2026-02-10'), null);
});

test('14. the lifecycle exists and each step is stamped with who and when', () => {
  assert.deepEqual([...cp.COSTING_PERIOD_STATUSES], ['OPEN', 'CALCULATED', 'REVIEWED', 'APPROVED', 'CLOSED']);
  const actor = { userId: 'u1', at: '2026-02-01T08:00:00.000Z' };
  let current: any = period();
  for (const next of ['CALCULATED', 'REVIEWED', 'APPROVED', 'CLOSED']) {
    const plan = cp.planCostingPeriodTransition(current, next, actor);
    assert.equal(plan.valid, true, next);
    current = { ...current, ...plan.patch };
  }
  assert.deepEqual([current.status, current.reviewedBy, current.approvedBy, current.closedBy], ['CLOSED', 'u1', 'u1', 'u1']);
  assert.equal(cp.planCostingPeriodTransition(period(), 'APPROVED', actor).valid, false, 'no skipping a step');
  assert.equal(cp.planCostingPeriodTransition(period({ status: 'CALCULATED' }), 'OPEN', actor).valid, true, 'an open period may be recalculated');
});

test('15. a closed period never changes silently', () => {
  const closed = deepFreeze(period({ status: 'CLOSED', calculationVersion: 1 }));
  assert.equal(cp.isCostingPeriodClosed(closed), true);
  assert.deepEqual(cp.costingPeriodEditIssues(closed, { ...closed, endDate: '2026-02-28' }).map((i: any) => i.field), ['endDate']);
  assert.deepEqual(cp.costingPeriodEditIssues(closed, { ...closed, status: 'OPEN' }).map((i: any) => i.field), ['status']);
  assert.deepEqual(cp.costingPeriodEditIssues(closed, { ...closed, notes: 'only a note' }), [], 'a note is not a result');
  assert.equal(cp.planCostingPeriodTransition(closed, 'OPEN', {}).valid, false);
  assert.deepEqual(cp.costingPeriodEditIssues(period({ status: 'OPEN' }), period({ status: 'OPEN', endDate: '2026-02-28' })), [], 'an open period stays editable');
  assert.ok(/costingPeriodEditIssues\(stored, draft\)/.test(readCode(SERVICE)), 'the service refuses before writing');
});

test('16. reopening is audited, needs a reason, and starts a NEW calculation version', () => {
  const closed = deepFreeze(period({ status: 'CLOSED', calculationVersion: 2 }));
  assert.deepEqual(cp.planCostingPeriodReopen(closed, '', {}).issues.map((i: any) => i.field), ['reopenReason']);
  const plan = cp.planCostingPeriodReopen(closed, 'Odoo issue cost corrected', { userId: 'u9', at: '2026-03-01T00:00:00.000Z' });
  assert.deepEqual([plan.valid, plan.patch.status, plan.patch.calculationVersion, plan.patch.reopenedBy, plan.patch.reopenReason], [true, 'OPEN', 3, 'u9', 'Odoo issue cost corrected']);
  assert.equal(cp.planCostingPeriodReopen(period({ status: 'OPEN' }), 'why', {}).valid, false, 'only a closed period is reopened');
  assert.ok(/\[COSTING_PERIOD_REOPENED\]/.test(cp.describeCostingPeriodChange(closed, { ...closed, ...plan.patch })));
  assert.ok(/logAuditAction\('UPDATE', COSTING_PERIOD_COLLECTION/.test(readCode(SERVICE)), 'through the existing audit');
});

// ==================================================
// H. HISTORICAL
// ==================================================

test('17-19. a snapshot names its period, its version and every configuration it used - current and historical are distinguishable', () => {
  const ref = {
    periodId: 'p1', calculationVersion: 2,
    allocationSetupIds: ['a1'], bomVersionIds: ['bv1'], routingVersionIds: ['rv1'],
    materialCostSource: 'ODOO_AVERAGE_COST', materialCostPurpose: 'ACTUAL_ISSUE_COST',
    productionScope: { startDate: '2026-01-01', endDate: '2026-01-31', stageTypes: ['pressing'] },
    accountBehaviorIds: ['ab1'], costCenterMapIds: ['cm1'],
  };
  assert.deepEqual(cs.snapshotReferenceIssues(ref), []);
  assert.deepEqual(cs.snapshotReferenceIssues({ ...ref, periodId: '' }).map((i: any) => i.field), ['periodId']);
  assert.deepEqual(cs.snapshotReferenceIssues({ ...ref, productionScope: undefined }).map((i: any) => i.field), ['productionScope']);
  assert.deepEqual(cs.snapshotReferenceIssues({ ...ref, materialCostSource: 'LATEST_PURCHASE_PRICE' }).map((i: any) => i.field), ['source']);
  assert.equal(cs.isHistoricalSnapshot(ref, { calculationVersion: 3, status: 'OPEN' }), true, 'an older version is historical');
  assert.equal(cs.isHistoricalSnapshot(ref, { calculationVersion: 2, status: 'CLOSED' }), true, 'a closed period is historical');
  assert.equal(cs.isHistoricalSnapshot(ref, { calculationVersion: 2, status: 'OPEN' }), false, 'the open period at the same version is current');
  assert.equal(cs.PERIOD_COST_SNAPSHOT_COLLECTION, 'periodCostSnapshots');
  // A period snapshot is period-level; a job's cost is accumulated per job / sub-job / batch.
  assert.equal(/jobReferenceId|batchId/.test(readCode(SETUP_PURE)), false, 'the period snapshot model forces nothing into jobs');
});

// ==================================================
// B. BOM / UOM UNCHANGED
// ==================================================

test('20-22. a kg component normalises against the declared basis, nothing converts silently, Base/Additive stand', () => {
  const version = { basisQuantity: 1, basisUnit: 'طن', components: [
    { lineId: 'L1', componentType: 'BASE', itemSource: 'materials', itemId: 'm1', quantity: 100, unit: 'كجم', percentage: 10, sequence: 1 },
    { lineId: 'L2', componentType: 'ADDITIVE', itemSource: 'materials', itemId: 'm2', quantity: 5, unit: 'كجم', percentage: 0.5, sequence: 2 },
  ] };
  const f = bom.bomFormula(version);
  assert.deepEqual([f.baseTotal, f.additiveTotal, f.totalApplied], [10, 0.5, 10.5], 'percentages are as stored');
  assert.deepEqual(f.lines.map((l: any) => [l.quantity, l.unit, l.percentageDerived]), [[100, 'كجم', false], [5, 'كجم', false]], 'kg quantities are not converted to the طن basis');
  const kgBasis = bom.bomFormula({ basisQuantity: 1000, basisUnit: 'كجم', components: [{ lineId: 'L1', itemSource: 'materials', itemId: 'm1', quantity: null, unit: 'كجم', percentage: 10, sequence: 1 }] });
  assert.deepEqual([kgBasis.lines[0].effectiveQuantity, kgBasis.lines[0].quantityDerived], [100, true], '10% of 1000 كجم = 100 كجم, derived for display only');
  // Step 8E: "m²" and "متر" joined the approved units; no conversion was added with them.
  assert.deepEqual([...bom.BOM_UNITS], ['طن', 'كجم', 'م3', 'لتر', 'شكارة', 'قطعة', 'm²', 'متر']);
  assert.equal(bom.approvedUnitSpelling('شيكارة'), 'شكارة');
  assert.equal(/[*/]\s*1000\b/.test(readCode(SETUP_PURE) + readCode(PERIOD_PURE)), false, 'the costing foundation invents no conversion');
});

// ==================================================
// I. IMPORT AND S. SAFETY
// ==================================================

test('23-25. the existing import engine and its partial-import behaviour are untouched', () => {
  // bulkImportService.ts already carried uncommitted work before this step, so it is pinned by content, not by diff.
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/services/historicalImportService.ts', 'src/services/pressingHistoricalImportService.ts', 'src/services/chineseMillsHistoricalImportService.ts', 'src/services/tubeBallMillsHistoricalImportService.ts', 'src/services/importHistoryPure.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim();
  assert.equal(changed, '', `import services unchanged: ${changed}`);
  assert.equal(/costing|allocation|periodCostSnapshot/i.test(readCode('src/services/bulkImportService.ts')), false, 'the bulk import engine gained no costing path');
  const code = [PERIOD_PURE, SETUP_PURE, SERVICE].map(readCode).join('\n');
  assert.equal(/xlsx|parseImportFile|commitBulkImport|READY_TO_IMPORT/i.test(code), false, 'the foundation adds no second import path');
});

test('S. no costing engine, no rules change, no migration, no production write', () => {
  const code = [PERIOD_PURE, SETUP_PURE, SERVICE, PANEL].map(readCode).join('\n').replace(/['"`][^'"`\n]*['"`]/g, '""');
  assert.equal(/standardCost|actualCost|allocatedAmount|overhead|variance|totalCost|unitCost/i.test(code), false, 'no costing calculation');
  assert.equal(/deleteDoc|deleteMasterDataItem|writeBatch|runTransaction|migrat/i.test(code), false);
  // Release 3.21.0 (DB-0033): Step 8C shipped these two collections without a rule,
  // so the default-deny catch-all refused every read and write from the panel.
  // They now take the Master Data pattern - read signed-in, write admin - and
  // nothing broader: no signed-in write and no separate delete grant.
  const rules = readSource('firestore.rules');
  for (const [col, param] of [['costingPeriods', 'periodId'], ['allocationSetups', 'setupId']]) {
    const block = rules.match(new RegExp(`match /${col}/\\{${param}\\} \\{([^}]*)\\}`))?.[1] ?? '';
    assert.ok(/allow read: if isSignedIn\(\);/.test(block), `${col} is readable by signed-in users`);
    assert.ok(/allow write: if isAdmin\(\);/.test(block), `${col} is written by admins only`);
    assert.equal(/allow (create|update|delete)|write: if isSignedIn/.test(block), false, `${col} grants nothing beyond the Master Data pattern`);
  }
  // The three setup collections the service never writes still have no rule.
  assert.equal(/accountBehaviors|costCenterOperationMap|periodCostSnapshots/.test(rules), false);
  const production = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/services/productionService.ts', 'src/services/stageRecordService.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim();
  assert.ok(production === '' || production === 'src/services/stageRecordService.ts', 'no new production write path');
});

test('U. the setup is one panel inside Master Data, and traceability is read-only inside Data Review', () => {
  const view = readCode('src/components/masterData/MasterDataView.tsx');
  assert.equal((view.match(/<CostingSetupPanel/g) ?? []).length, 1);
  assert.ok(/canEdit=\{canImportMasterData\}/.test(view.slice(view.indexOf('<CostingSetupPanel'))), 'the existing Master Data gate');
  assert.equal(/'costing|Costing(View|Page|Manager)/.test(readCode('src/App.tsx')), false, 'no new top-level screen');
  assert.equal(/costing|allocation/i.test(readCode('src/types/permissions.ts')), false, 'no new permission keys');
  const panel = readCode(PANEL);
  assert.ok(/DRIVER SOURCE NOT AVAILABLE/.test(panel), 'an unavailable driver source is stated, never implied');
  const trace = readCode(TRACE_PANEL);
  for (const id of ['production-traceability-panel', 'traceability-consumption', 'traceability-outputs']) assert.ok(trace.includes(`id="${id}"`), id);
  assert.ok(/parentJobReferenceId/.test(trace), 'a sub-job is shown as such');
  assert.ok(/genealogyInputBatchIds/.test(trace) && /genealogyOutputBatchIds/.test(trace));
  assert.equal(/<input|<select|updateStageRecord|createMasterDataItem/.test(trace), false, 'read-only');
  assert.equal((readCode('src/components/production/DataReviewView.tsx').match(/<ProductionTraceabilityPanel record=\{selectedRecord\} \/>/g) ?? []).length, 1);
});

test('E. the three stages that had no equipment identity now name it from their existing masters', () => {
  const registry = readCode('src/services/masterDataCategoryRegistry.ts');
  assert.ok(/rotary_furnace: \['rotaryKilns'\]/.test(registry) && /chinese_mills: \['mills'\]/.test(registry) && /tube_ball_mills: \['tubeBallMills', 'bunkers'\]/.test(registry));
  for (const [form, field] of [['RotaryFurnaceEntryForm', 'rotaryKilnId'], ['ChineseMillsEntryForm', 'millId'], ['TubeBallMillsEntryForm', 'tubeBallMillId'], ['TubeBallMillsEntryForm', 'bunkerId']] as const) {
    const code = readCode(`src/components/production/${form}.tsx`);
    assert.ok(new RegExp(`\\.\\.\\.\\(${field} \\? \\{ ${field} \\} : \\{\\}\\),`).test(code), `${form} writes ${field} only when chosen`);
  }
  // The legacy free text is kept exactly as it was.
  assert.ok(/value=\{millType\}/.test(readCode('src/components/production/ChineseMillsEntryForm.tsx')));
  assert.ok(/value=\{storageBunker\}/.test(readCode('src/components/production/TubeBallMillsEntryForm.tsx')));
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

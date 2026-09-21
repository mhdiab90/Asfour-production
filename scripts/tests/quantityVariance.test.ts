/**
 * STANDARD vs ACTUAL CONSUMPTION / QUANTITY VARIANCE - Phase 1 Step 7.
 *
 * B  basic: standard and actual read, statuses, variance and percentage
 * I  identity: logical item first, exact source record fallback, no fuzzy match
 * U  units: same unit only, never converted
 * V  BOM version: exactly the job's selection, retired kept, missing = integrity error
 * S  basis / scaling: the decided policy, missing data named
 * R  read-only: nothing mutated, no write, no audit, no persistence; resolver reused
 * P  placement: the existing Data Review modal, no new screen or permission
 *
 * The pure engine runs as shipped; the service and UI import Firebase, so their
 * wiring is pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/quantityVariance.test.ts
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

console.log('quantityVariance.test.ts');

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

let qv: any;
let li: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  qv = await load('src/services/quantityVariancePure.ts');
  li = await load('src/services/logicalItemPure.ts');
}

const PURE = 'src/services/quantityVariancePure.ts';
const SERVICE = 'src/services/quantityVarianceService.ts';
const PANEL = 'src/components/production/QuantityVariancePanel.tsx';
const REVIEW = 'src/components/production/DataReviewView.tsx';

// Fixture: kaolin is mapped (product p-calcined = material m-kaolin); clay, additive, dust are unmapped.
const component = (n: number, over: Record<string, unknown> = {}) => ({ lineId: `L${n}`, sequence: n, itemSource: 'materials', itemId: 'm-clay', quantity: 100, unit: 'كجم', percentage: null, notes: '', ...over });
const consumed = (n: number, over: Record<string, unknown> = {}) => ({ lineId: `L${n}`, sequence: n, itemSource: 'materials', materialId: 'm-clay', materialCode: 'CLAY', materialName: 'طفلة', quantity: 100, unit: 'كجم', ...over });

function context(over: Record<string, unknown> = {}) {
  return deepFreeze({
    jobs: [
      { id: 'j1', code: 'JOB-1', bomVersionId: 'v-std' },
      { id: 'j-none', code: 'JOB-NONE', bomVersionId: null },
      { id: 'j-cust', code: 'JOB-CUST', customerId: 'c1', bomVersionId: 'v-cust' },
      { id: 'j-retired', code: 'JOB-R', bomVersionId: 'v-retired' },
      { id: 'j-gone', code: 'JOB-G', bomVersionId: 'v-deleted' },
      { id: 'j-basis', code: 'JOB-B', bomVersionId: 'v-basis' },
    ],
    boms: [
      { id: 'bom-std', code: 'BOM-STD', itemSource: 'products', itemId: 'p-brick', customerId: null, isDefault: true, active: true },
      { id: 'bom-cust', code: 'BOM-C1', itemSource: 'products', itemId: 'p-brick', customerId: 'c1', isDefault: false, active: true },
    ],
    bomVersions: [
      { id: 'v-std', bomId: 'bom-std', versionCode: 'V1', status: 'ACTIVE', components: [component(1), component(2, { itemSource: 'products', itemId: 'p-calcined', quantity: 120 })] },
      { id: 'v-std-2', bomId: 'bom-std', versionCode: 'V2', status: 'DRAFT', components: [component(1, { quantity: 999 })] },
      { id: 'v-cust', bomId: 'bom-cust', versionCode: 'C1', status: 'ACTIVE', components: [component(1, { quantity: 50 })] },
      { id: 'v-retired', bomId: 'bom-std', versionCode: 'V0', status: 'RETIRED', components: [component(1, { quantity: 80 })] },
      { id: 'v-basis', bomId: 'bom-std', versionCode: 'VB', status: 'ACTIVE', basisQuantity: 1000, basisUnit: 'كجم', components: [component(1, { quantity: 200 })] },
    ],
    logicalItems: [{ id: 'li-kaolin', productId: 'p-calcined', materialId: 'm-kaolin', status: 'ACTIVE' }].map((x) => li.readLogicalItem(x)),
    products: [{ id: 'p-calcined', code: 'CAL', name: 'كاولين مكلسن' }, { id: 'p-dust', code: 'DST', name: 'غبار' }],
    materials: [{ id: 'm-clay', code: 'CLAY', name: 'طفلة' }, { id: 'm-kaolin', code: 'KAO', name: 'كاولين' }, { id: 'm-add', code: 'ADD', name: 'مادة مضافة' }],
    ...over,
  });
}
const analyse = (record: Record<string, unknown>, ctx: any = context()) => qv.analyseQuantityVariance(deepFreeze({ jobReferenceId: 'j1', ...record }), ctx);
const row = (report: any, itemId: string) => report.rows.find((r: any) => r.itemId === itemId);
const statuses = (report: any) => Object.fromEntries(report.rows.map((r: any) => [r.itemId || r.key, r.status]));

// ==================================================
// B. BASIC
// ==================================================

test('B/1-2. standard BOM quantity and actual consumption quantity are read', () => {
  const r = analyse({ materials: [consumed(1, { quantity: 90 })] });
  assert.equal(r.state, 'COMPARED');
  assert.deepEqual([row(r, 'm-clay').standardQuantity, row(r, 'm-clay').standardUnit], [100, 'كجم']);
  assert.deepEqual([row(r, 'm-clay').actualQuantity, row(r, 'm-clay').actualUnit], [90, 'كجم']);
  assert.deepEqual([r.bomVersionId, r.bomVersionCode, r.bomCode], ['v-std', 'V1', 'BOM-STD']);
});

test('B/3. equal quantity is MATCHED with zero variance', () => {
  const r = analyse({ materials: [consumed(1), consumed(2, { itemSource: 'products', materialId: 'p-calcined', quantity: 120 })] });
  assert.deepEqual(r.rows.map((x: any) => [x.status, x.varianceQuantity, x.variancePercent]), [['MATCHED', 0, 0], ['MATCHED', 0, 0]]);
});

test('B/4,8,9. actual > standard is OVER_CONSUMED: +15 كجم, +12.5%', () => {
  const r = analyse({ materials: [consumed(1), consumed(2, { itemSource: 'products', materialId: 'p-calcined', quantity: 135 })] });
  const k = row(r, 'p-calcined');
  assert.deepEqual([k.status, k.varianceQuantity, k.variancePercent], ['OVER_CONSUMED', 15, 12.5]);
});

test('B/5. actual < standard is UNDER_CONSUMED with a negative variance', () => {
  const r = analyse({ materials: [consumed(1, { quantity: 75 })] });
  const c = row(r, 'm-clay');
  assert.deepEqual([c.status, c.varianceQuantity, c.variancePercent], ['UNDER_CONSUMED', -25, -25]);
});

test('B/6. a component with no actual is MISSING', () => {
  const r = analyse({ materials: [consumed(1)] });
  const k = row(r, 'p-calcined');
  assert.deepEqual([k.status, k.actualFound, k.actualQuantity, k.varianceQuantity, k.expectedQuantity], ['MISSING', false, null, null, 120]);
  assert.equal(r.summary.missing, 1);
});

test('B/7. an actual item not in the BOM is OFF_BOM - analytical, not an error', () => {
  const r = analyse({ materials: [consumed(1), consumed(2, { itemSource: 'products', materialId: 'p-calcined', quantity: 120 }), consumed(3, { materialId: 'm-add', quantity: 5 })] });
  const a = row(r, 'm-add');
  assert.deepEqual([a.status, a.inBom, a.standardQuantity, a.varianceQuantity], ['OFF_BOM', false, null, null]);
  assert.equal(r.state, 'COMPARED');
});

test('B/10. a zero or invalid standard quantity is NO_STANDARD_QUANTITY - no division by zero', () => {
  for (const q of [0, -3, Number.NaN, null, '100']) {
    const ctx = context({ bomVersions: [{ id: 'v-std', bomId: 'bom-std', versionCode: 'V1', status: 'ACTIVE', components: [component(1, { quantity: q })] }] });
    const c = row(analyse({ materials: [consumed(1)] }, ctx), 'm-clay');
    assert.deepEqual([c.status, c.variancePercent, c.varianceQuantity], ['NO_STANDARD_QUANTITY', null, null], String(q));
  }
  assert.ok(/NO_STANDARD_QUANTITY/.test(readCode(PURE)));
});

test('B/aggregation. actual lines of one item are summed (50 + 70 = 120); duplicate components are summed, not double-counted', () => {
  const r = analyse({ materials: [consumed(1), consumed(2, { itemSource: 'products', materialId: 'p-calcined', quantity: 50 }), consumed(3, { itemSource: 'products', materialId: 'p-calcined', quantity: 70 })] });
  const k = row(r, 'p-calcined');
  assert.deepEqual([k.actualQuantity, k.status, k.consumptionLineIds], [120, 'MATCHED', ['L2', 'L3']]);
  const ctx = context({ bomVersions: [{ id: 'v-std', bomId: 'bom-std', versionCode: 'V1', status: 'ACTIVE', components: [component(1, { quantity: 60 }), component(2, { quantity: 40 })] }] });
  const c = row(analyse({ materials: [consumed(1)] }, ctx), 'm-clay');
  assert.deepEqual([c.standardQuantity, c.status, c.bomLineIds], [100, 'MATCHED', ['L1', 'L2']]);
  assert.equal(analyse({ materials: [consumed(1)] }, ctx).rows.length, 1, 'one row per identity');
});

test('B/summary. counts per status plus standard and actual item counts', () => {
  const r = analyse({ materials: [consumed(1, { quantity: 110 }), consumed(2, { materialId: 'm-add', quantity: 5 })] });
  assert.deepEqual(
    [r.summary.standardItems, r.summary.actualItems, r.summary.overConsumed, r.summary.missing, r.summary.offBom, r.summary.matched],
    [2, 2, 1, 1, 1, 0],
  );
});

// ==================================================
// I. IDENTITY
// ==================================================

test('I/11-12. matching uses the logical item: BOM product p-calcined = consumed material m-kaolin', () => {
  const r = analyse({ materials: [consumed(1), consumed(2, { materialId: 'm-kaolin', quantity: 120 })] });
  const k = r.rows.find((x: any) => x.logicalItemId === 'li-kaolin');
  assert.deepEqual([k.identityBasis, k.status, k.inBom, k.actualFound], ['LOGICAL_ITEM', 'MATCHED', true, true]);
  assert.equal(r.rows.length, 2, 'no separate missing/off-BOM rows');
});

test('I/13. unmapped items match only on the exact (collection, document id)', () => {
  const r = analyse({ materials: [consumed(1)] });
  const c = row(r, 'm-clay');
  assert.deepEqual([c.identityBasis, c.key, c.status], ['SOURCE_RECORD', 'record:materials/m-clay', 'MATCHED']);
  const other = analyse({ materials: [consumed(1, { materialId: 'm-clay-2', materialName: 'طفلة', materialCode: 'CLAY' })] });
  assert.deepEqual(statuses(other), { 'm-clay': 'MISSING', 'p-calcined': 'MISSING', 'm-clay-2': 'OFF_BOM' }, 'same name and code, different record = different item');
});

test('I/14. an unmapped standard item and an unmapped actual item from different collections are UNRESOLVED_ITEM_IDENTITY, not guessed', () => {
  const r = analyse({ materials: [consumed(1, { itemSource: 'products', materialId: 'p-clay-product', materialName: 'طفلة' }), consumed(2, { itemSource: 'products', materialId: 'p-calcined', quantity: 120 })] });
  assert.equal(row(r, 'm-clay').status, 'UNRESOLVED_ITEM_IDENTITY');
  assert.equal(row(r, 'p-clay-product').status, 'UNRESOLVED_ITEM_IDENTITY');
  assert.equal(r.summary.unresolvedIdentity, 2);
});

test('I/14b. a line with no item, or whose stored logical item no longer matches its source, is UNRESOLVED_ITEM_IDENTITY', () => {
  const r = analyse({ materials: [consumed(1, { materialId: '' }), consumed(2, { materialId: 'm-add', logicalItemId: 'li-old' })] });
  const unresolved = r.rows.filter((x: any) => x.identityBasis === 'UNRESOLVED');
  assert.deepEqual(unresolved.map((x: any) => [x.status, x.consumptionLineIds[0]]), [['UNRESOLVED_ITEM_IDENTITY', 'L1'], ['UNRESOLVED_ITEM_IDENTITY', 'L2']]);
  assert.equal(row(r, 'm-clay').status, 'MISSING', 'never silently matched to a component');
});

test('I/15. no fuzzy matching: nothing compares names, codes, categories or substrings', () => {
  const code = readCode(PURE);
  assert.equal(/\.name\b[^;]*===|itemName\s*===|materialName\s*===|toLowerCase|normalize\(|includes\(\s*text|similar|levenshtein|fuzzy|category/i.test(code.replace(/name: text\([^)]*\)/g, '')), false);
});

// ==================================================
// U. UNITS
// ==================================================

test('U/16. the same unit compares normally', () => {
  assert.equal(row(analyse({ materials: [consumed(1, { quantity: 101 })] }), 'm-clay').status, 'OVER_CONSUMED');
});

test('U/17-18. a different unit is UNIT_MISMATCH with no numeric variance - 0.1 طن is not 100 كجم', () => {
  const c = row(analyse({ materials: [consumed(1, { quantity: 0.1, unit: 'طن' })] }), 'm-clay');
  assert.deepEqual([c.status, c.varianceQuantity, c.variancePercent, c.actualQuantity, c.actualUnit], ['UNIT_MISMATCH', null, null, 0.1, 'طن']);
  const mixed = row(analyse({ materials: [consumed(1, { quantity: 50 }), consumed(2, { quantity: 0.05, unit: 'طن' })] }), 'm-clay');
  assert.deepEqual([mixed.status, mixed.varianceQuantity], ['UNIT_MISMATCH', null], 'actual lines in two units are not added together');
  assert.equal(/[*/]\s*1000\b|convertUnit|conversionFactor|UOM_|unitFactor/i.test(readCode(PURE)), false, 'no conversion factor in the engine');
});

// ==================================================
// V. BOM VERSION
// ==================================================

test('V/19. uses exactly the version the job selected - not the default BOM or another version', () => {
  const r = analyse({ materials: [consumed(1)] });
  assert.equal(r.bomVersionId, 'v-std');
  assert.equal(row(r, 'm-clay').standardQuantity, 100, 'not V2 (999)');
});

test('V/20. a RETIRED referenced version is still the standard, even with an ACTIVE version of the same BOM', () => {
  const r = analyse({ jobReferenceId: 'j-retired', materials: [consumed(1, { quantity: 80 })] });
  assert.deepEqual([r.bomVersionId, r.bomVersionStatus, row(r, 'm-clay').standardQuantity, row(r, 'm-clay').status], ['v-retired', 'RETIRED', 80, 'MATCHED']);
});

test('V/21. a referenced version that no longer exists is an INTEGRITY_ERROR - nothing substituted', () => {
  const r = analyse({ jobReferenceId: 'j-gone', materials: [consumed(1)] });
  assert.deepEqual([r.state, r.message.code, r.rows.length, r.bomVersionId], ['INTEGRITY_ERROR', 'BOM_VERSION_NOT_FOUND', 0, 'v-deleted']);
  const missingJob = analyse({ jobReferenceId: 'j-deleted', materials: [consumed(1)] });
  assert.deepEqual([missingJob.state, missingJob.message.code], ['INTEGRITY_ERROR', 'JOB_NOT_FOUND']);
});

test('V/22-23. a customer-specific selection is used as selected; no fallback to the standard BOM', () => {
  const r = analyse({ jobReferenceId: 'j-cust', materials: [consumed(1, { quantity: 50 })] });
  assert.deepEqual([r.bomVersionId, r.bomCode, r.bomCustomerId, row(r, 'm-clay').standardQuantity, row(r, 'm-clay').status], ['v-cust', 'BOM-C1', 'c1', 50, 'MATCHED']);
  const code = readCode(PURE);
  assert.equal(/isDefault|status[^;]*===\s*'ACTIVE'|customerId\s*===|resolveDefaultBomVersion|compatibleBomVersions/.test(code), false, 'no default / active / scope lookup');
});

test('V/no-baseline. no job or no BOM version is NO_STANDARD_BOM, without reads of BOM data', () => {
  const noJob = qv.analyseQuantityVariance({ jobReferenceId: null, materials: [consumed(1)] }, {});
  assert.deepEqual([noJob.state, noJob.message.code, noJob.rows.length], ['NO_STANDARD_BOM', 'NO_JOB', 0]);
  const noVersion = analyse({ jobReferenceId: 'j-none', materials: [consumed(1)] }, context({ bomVersions: null }));
  assert.deepEqual([noVersion.state, noVersion.message.code], ['NO_STANDARD_BOM', 'NO_BOM_VERSION']);
  assert.equal(analyse({ materials: [consumed(1)] }, context({ bomVersions: null })).state, 'DATA_NOT_LOADED', 'unloaded is never read as "no BOM"');
});

// ==================================================
// S. BASIS / SCALING
// ==================================================

test('S/24. a basis version is scaled by record quantity / basis when units match exactly: 200 per 1000 كجم at 2500 كجم = 500', () => {
  const r = analyse({ jobReferenceId: 'j-basis', productionQuantity: 2500, productionUnit: 'كجم', materials: [consumed(1, { quantity: 520 })] });
  const c = row(r, 'm-clay');
  assert.deepEqual([r.basis.state, r.basis.scaleFactor], ['SCALED', 2.5]);
  assert.deepEqual([c.standardQuantity, c.expectedQuantity, c.varianceQuantity, c.variancePercent, c.status], [200, 500, 20, 4, 'OVER_CONSUMED']);
});

test('S/24b. a version without a basis is compared as written, whatever the production quantity', () => {
  const r = analyse({ productionQuantity: 7, productionUnit: 'طن', materials: [consumed(1)] });
  assert.deepEqual([r.basis.state, r.basis.scaleFactor, row(r, 'm-clay').expectedQuantity, row(r, 'm-clay').status], ['NO_BASIS', 1, 100, 'MATCHED']);
});

test('S/25-26. scaling is withheld - not invented - when the unit differs or the production quantity is missing; the gap is named', () => {
  const tons = analyse({ jobReferenceId: 'j-basis', productionQuantity: 2.5, productionUnit: 'طن', materials: [consumed(1, { quantity: 500 })] });
  assert.deepEqual([tons.basis.state, tons.basis.gap, tons.message.code, row(tons, 'm-clay').status, row(tons, 'm-clay').varianceQuantity], ['SCALING_NOT_SUPPORTED', 'UNIT_DIFFERS', 'UNIT_DIFFERS', 'SCALING_NOT_SUPPORTED', null]);
  for (const q of [0, null, undefined, Number.NaN]) {
    const r = analyse({ jobReferenceId: 'j-basis', productionQuantity: q, productionUnit: 'كجم', materials: [consumed(1)] });
    assert.deepEqual([r.basis.gap, row(r, 'm-clay').status], ['PRODUCTION_QUANTITY_MISSING', 'SCALING_NOT_SUPPORTED'], String(q));
    assert.ok(r.message.messageEn.includes('data required for this calculation is not currently available'));
  }
  const noUnit = analyse({ jobReferenceId: 'j-basis', productionQuantity: 1000, productionUnit: '', materials: [consumed(1)] });
  assert.equal(noUnit.basis.gap, 'PRODUCTION_UNIT_MISSING');
  const half = analyse({ materials: [consumed(1)] }, context({ bomVersions: [{ id: 'v-std', bomId: 'bom-std', versionCode: 'V1', status: 'ACTIVE', basisQuantity: null, basisUnit: 'كجم', components: [component(1)] }] }));
  assert.equal(half.basis.gap, 'INVALID_BASIS');
});

test('S/26b. presence checks still run while numeric variance is withheld', () => {
  const r = analyse({ jobReferenceId: 'j-basis', productionQuantity: 3, productionUnit: 'طن', materials: [consumed(1, { quantity: 1, unit: 'كجم' }), consumed(2, { materialId: 'm-add', quantity: 2 })] });
  assert.deepEqual(statuses(r), { 'm-clay': 'SCALING_NOT_SUPPORTED', 'm-add': 'OFF_BOM' });
  const missing = analyse({ jobReferenceId: 'j-basis', productionQuantity: 3, productionUnit: 'طن', materials: [] });
  assert.deepEqual([row(missing, 'm-clay').status, row(missing, 'm-clay').expectedQuantity], ['MISSING', null]);
});

test('S/yield. expected yield is not applied and genealogy outputs / routing are not read', () => {
  const code = readCode(PURE) + readCode(SERVICE);
  assert.equal(/expectedYieldPercent|productionOutputs|genealogy|routing/i.test(code), false);
});

// ==================================================
// R. READ-ONLY
// ==================================================

test('R/27-30. analysis never mutates the BOM, consumption lines, record, job or batch (deep-frozen inputs)', () => {
  const ctx = context();
  const record = deepFreeze({ jobReferenceId: 'j1', batchId: 'b1', productionQuantity: 10, productionUnit: 'طن', materials: [consumed(1), consumed(2, { materialId: 'm-kaolin', quantity: 60 }), consumed(3, { materialId: 'm-kaolin', quantity: 60 })] });
  const before = JSON.stringify([record, ctx]);
  assert.doesNotThrow(() => qv.analyseQuantityVariance(record, ctx));
  assert.equal(JSON.stringify([record, ctx]), before);
});

test('R/31. no Firestore write, audit or persisted snapshot for viewing variance', () => {
  const code = [PURE, SERVICE, PANEL].map(readCode).join('\n');
  assert.equal(/addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|safeAddDoc|createMasterDataItem|updateMasterDataItem|logAuditAction|logRecordAudit|localStorage|onClick=\{[^}]*save/i.test(code), false);
  assert.equal(/collection\(|doc\(/.test(readCode(PURE) + readCode(SERVICE)), false, 'no new collection');
  assert.equal(/variance/i.test(readSource('firestore.rules')), false, 'no rules for variance');
  assert.equal(/variance/i.test(readCode('src/services/masterDataService.ts')), false);
});

test('R/32. the existing logical item resolver and consumption identity helpers are reused, not re-implemented', () => {
  const code = readCode(PURE);
  assert.ok(/import \{ resolveLogicalItemId \} from '\.\/logicalItemPure';/.test(code));
  assert.ok(/import \{ lineLogicalItemKey, lineSource \} from '\.\/actualConsumptionPure';/.test(code));
  assert.equal(/function (resolveLogicalItemId|findLogicalItemFor|lineLogicalItemKey)\b/.test(code), false);
});

test('R/cost. quantities only - no money, cost or price', () => {
  const code = [PURE, SERVICE, PANEL].map(readCode).join('\n').replace(/['"`][^'"`\n]*['"`]/g, '""');
  assert.equal(/costPerUnit|unitCost|totalCost|standardCost|actualCost|price|currency|amount|overhead/i.test(code), false);
});

test('R/service. reads only what a record with a job needs; re-checks uncached before an integrity error', () => {
  const code = readCode(SERVICE);
  assert.ok(/if \(!jobId\) return analyseQuantityVariance\(record, \{\}\);/.test(code), 'no job = no reads');
  assert.ok(/if \(!job \|\| !versionId\) return analyseQuantityVariance\(record, \{ jobs \}\);/.test(code), 'no BOM version = no BOM reads');
  assert.ok(/MASTER_DATA_COLLECTIONS\.jobReferences, \{ skipCache: true \}/.test(code));
  assert.ok(/BOM_VERSION_COLLECTION, \{ skipCache: true \}/.test(code));
  assert.equal(/getDocs|query\(|where\(|fetchUniversalStageRecords|productionRecords/.test(code), false, 'no production scans');
});

// ==================================================
// P. PLACEMENT
// ==================================================

test('P/ui. one read-only panel in the existing Data Review record modal - no new screen, route, navigation or permission', () => {
  const review = readCode(REVIEW);
  assert.equal((review.match(/<QuantityVariancePanel record=\{selectedRecord\} \/>/g) ?? []).length, 1);
  const nav = ['src/App.tsx', 'src/components/layout/Sidebar.tsx', 'src/components/layout/MobileNav.tsx', 'src/components/layout/Header.tsx', 'src/types/permissions.ts'].map(readCode).join('\n');
  assert.equal(/variance/i.test(nav), false);
  const panel = readCode(PANEL);
  assert.equal(/hasPermission|<input|<select|<button|onChange=/.test(panel), false, 'display only');
  assert.ok(/id="quantity-variance-panel"/.test(panel));
  for (const h of ["'Item'", "'Standard'", "'Actual'", "'Variance'", "'Variance %'", "'Status'"]) assert.ok(panel.includes(h), h);
});

test('P/reuse. the panel shows the engine result and does not compute variance itself', () => {
  const panel = readCode(PANEL);
  assert.ok(/loadQuantityVariance\(/.test(panel));
  assert.equal(/actualQuantity\s*-|standardQuantity\s*\*|\/ r\.expectedQuantity|resolveLogicalItemId/.test(panel), false);
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

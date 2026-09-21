/**
 * ACTUAL MATERIAL CONSUMPTION - Phase 1 Step 5B.
 *
 * M  model: the existing MaterialConsumptionItem, extended with optional fields
 * I  items: products and materials, source identity kept, no logical item created
 * B  BOM: information only, off-BOM allowed, BOM untouched, no BOM needed
 * P  production: lines in the record's own write, references preserved, no write on refusal
 * H  history, inventory and cost untouched
 * U  one shared panel in the existing forms
 *
 * Pure modules run as shipped; forms and services import Firebase, so their
 * wiring is pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/actualConsumption.test.ts
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

console.log('actualConsumption.test.ts');

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

let ac: any;
let li: any;
let pr: any;
let ops: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  ac = await load('src/services/actualConsumptionPure.ts');
  li = await load('src/services/logicalItemPure.ts');
  pr = await load('src/services/productionReferencePure.ts');
  ops = await load('src/services/operationMasterPure.ts');
}

const PURE = 'src/services/actualConsumptionPure.ts';
const SERVICE = 'src/services/actualConsumptionService.ts';
const PANEL = 'src/components/production/ActualConsumptionPanel.tsx';
const CONSUMING: Record<string, string> = {
  rotary_furnace: 'RotaryFurnaceEntryForm',
  mortar_concrete: 'MortarConcreteEntryForm',
  mixing: 'MixingEntryForm',
  lightweight_foam: 'LightweightFoamEntryForm',
};
const NON_CONSUMING = ['ProductionEntryForm', 'ChineseMillsEntryForm', 'TubeBallMillsEntryForm', 'SortingEntryForm'];
const fields = (v: any) => v.issues.map((i: any) => i.field);

const context = () => deepFreeze({
  products: [
    { id: 'p-calcined', code: 'CAL-40', name: 'كاولين مكلسن', unit: 'طن', currentStock: 99 },
    { id: 'p-brick', code: 'BRK-A', name: 'Brick A', unit: 'قطعة' },
  ],
  materials: [
    { id: 'm-clay', code: 'CLAY', name: 'طفلة', unit: 'طن', currentStock: 500 },
    { id: 'm-kaolin', code: 'KAO', name: 'كاولين', unit: 'طن', currentStock: 300 },
    { id: 'm-additive', code: 'ADD', name: 'مادة مضافة', unit: 'kg', currentStock: 20 },
  ],
  logicalItems: [
    { id: 'li-kaolin', productId: 'p-calcined', materialId: 'm-kaolin', status: 'ACTIVE' },
    { id: 'li-brick', productId: 'p-brick', materialId: null, status: 'ACTIVE' },
  ].map((x) => li.readLogicalItem(x)),
});
const line = (n: number, over: Record<string, unknown> = {}) => ({ lineId: `L${n}`, sequence: n, itemSource: 'materials', materialId: 'm-clay', materialCode: '', materialName: '', quantity: 1.5, unit: 'طن', notes: '', ...over });
const bomVersion = { id: 'bv1', status: 'ACTIVE', components: [
  { lineId: 'L1', itemSource: 'materials', itemId: 'm-clay', quantity: 10, unit: 'طن' },
  { lineId: 'L2', itemSource: 'products', itemId: 'p-calcined', quantity: 5, unit: 'طن' },
] };

// ==================================================
// M. MODEL
// ==================================================

test('M/3. the existing MaterialConsumptionItem is reused and extended with optional fields only', () => {
  const block = interfaceBlock('MaterialConsumptionItem');
  for (const f of ['materialId: string;', 'materialCode: string;', 'materialName: string;', 'quantity: number;', 'unit: string;']) assert.ok(block.includes(f), `kept ${f}`);
  for (const f of ['lineId?: string;', 'sequence?: number;', "itemSource?: 'products' | 'materials';", 'logicalItemId?: string | null;', 'notes?: string;']) assert.ok(block.includes(f), `optional ${f}`);
  assert.equal(/cost|price|stock/i.test(block), false);
  assert.equal(/export interface (ActualConsumption|ConsumptionLine)/.test(readCode('src/types/index.ts')), false, 'no competing model');
});

test('1/6. a line has a stable line id and a valid display sequence', () => {
  assert.equal(ac.validateActualConsumption([line(1), line(2, { materialId: 'm-kaolin' })], context()).valid, true);
  assert.deepEqual(fields(ac.validateActualConsumption([line(1), line(2, { lineId: 'L1', materialId: 'm-kaolin' })], context())), ['materials.lineId']);
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { lineId: '' })], context())), ['materials.lineId']);
  assert.deepEqual(fields(ac.validateActualConsumption([line(1), line(2, { sequence: 1, materialId: 'm-kaolin' })], context())), ['materials.sequence']);
  const out = ac.normaliseActualConsumption([line(2, { sequence: 9, materialId: 'm-kaolin' }), line(1, { sequence: 3 })], context());
  assert.deepEqual(out.map((l: any) => [l.lineId, l.sequence]), [['L1', 1], ['L2', 2]], 'renumbered 1..n, ids unchanged');
  assert.ok(/lineIdentityIssues/.test(readCode(PURE)) && /normaliseSequences/.test(readCode(PURE)), 'the shared line rules');
});

test('2. the source item reference is preserved (collection + record id), with snapshots from the source', () => {
  const [out] = ac.normaliseActualConsumption([line(1, { itemSource: 'products', materialId: 'p-calcined', materialName: 'typed by user' })], context());
  assert.equal(out.itemSource, 'products');
  assert.equal(out.materialId, 'p-calcined');
  assert.equal(out.materialName, 'كاولين مكلسن', 'snapshot from the source record');
  assert.equal(out.materialCode, 'CAL-40');
});

test('4. quantity must be a number greater than zero - never rounded', () => {
  for (const q of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '5', null]) {
    assert.deepEqual(fields(ac.validateActualConsumption([line(1, { quantity: q })], context())), ['materials.quantity'], String(q));
  }
  assert.equal(ac.normaliseActualConsumption([line(1, { quantity: 0.333 })], context())[0].quantity, 0.333);
});

test('5. the unit is required, from the existing unit values - never assumed or converted', () => {
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { unit: '' })], context())), ['materials.unit']);
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { unit: 'kg' })], context())), ['materials.unit']);
  const [out] = ac.normaliseActualConsumption([line(1, { quantity: 300, unit: 'كجم' })], context());
  assert.deepEqual([out.quantity, out.unit], [300, 'كجم'], '300 كجم stays 300 كجم');
  assert.ok(/import \{ BOM_UNITS \} from '\.\/bomPure';/.test(readCode(PURE)), 'the one existing unit list');
});

test('7. notes are optional', () => {
  assert.equal(ac.validateActualConsumption([line(1, { notes: undefined })], context()).valid, true);
  assert.equal('notes' in ac.normaliseActualConsumption([line(1, { notes: '' })], context())[0], false);
  assert.equal(ac.normaliseActualConsumption([line(1, { notes: ' wet ' })], context())[0].notes, 'wet');
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { notes: 5 })], context())), ['materials.notes']);
});

// ==================================================
// I. ITEMS
// ==================================================

test('8/9/10. products, materials and intermediates kept as products can be consumed', () => {
  assert.equal(ac.validateActualConsumption([line(1, { itemSource: 'products', materialId: 'p-brick', unit: 'قطعة' })], context()).valid, true, 'product');
  assert.equal(ac.validateActualConsumption([line(1)], context()).valid, true, 'material');
  assert.equal(ac.validateActualConsumption([line(1, { itemSource: 'products', materialId: 'p-calcined' })], context()).valid, true, 'calcined intermediate stored as a product');
  assert.equal(ac.lineSource({ materialId: 'm-old' }), 'materials', 'historical lines without itemSource are materials');
});

test('11. an invalid source item is rejected', () => {
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { materialId: 'ghost' })], context())), ['materials.materialId']);
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { itemSource: 'products', materialId: 'm-clay' })], context())), ['materials.materialId'], 'right id, wrong collection');
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { materialId: '' })], context())), ['materials.materialId']);
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { itemSource: 'stages' })], context())), ['materials.itemSource']);
  assert.deepEqual(fields(ac.validateActualConsumption([line(1)], { ...context(), materials: null })), ['materials.materialId'], 'unverifiable');
});

test('12/13. no logical item is created; an unmapped valid item is recorded and reported as unresolved', () => {
  const [mapped, unmapped] = ac.normaliseActualConsumption([line(1, { materialId: 'm-kaolin' }), line(2)], context());
  assert.equal(mapped.logicalItemId, 'li-kaolin', 'resolved identity stored alongside the source');
  assert.equal('logicalItemId' in unmapped, false, 'unmapped: source kept, nothing invented');
  assert.deepEqual(ac.unresolvedConsumptionLines([line(1, { materialId: 'm-kaolin' }), line(2)], context().logicalItems), ['L2']);
  assert.equal(/createMasterDataItem|registerLogicalItem|mapProductToMaterial|logicalItemPayloadForCreate/.test(readCode(PURE) + readCode(SERVICE) + readCode(PANEL)), false);
});

test('14. consistency: a stored logical item must be what its source resolves to (decided rule - no job comparison)', () => {
  assert.equal(ac.validateActualConsumption([line(1, { materialId: 'm-kaolin', logicalItemId: 'li-kaolin' })], context()).valid, true);
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { materialId: 'm-kaolin', logicalItemId: 'li-brick' })], context())), ['materials.logicalItemId']);
  assert.deepEqual(fields(ac.validateActualConsumption([line(1, { logicalItemId: 'li-kaolin' })], context())), ['materials.logicalItemId'], 'an unmapped source cannot claim a logical item');
  assert.equal(ac.validateActualConsumption([line(1, { itemSource: 'products', materialId: 'p-brick', unit: 'قطعة' })], context()).valid, true, "consuming an item that differs from the job's is normal");
  assert.equal(/jobReferenceId|job\.logicalItemId/.test(readCode(PURE)), false, 'no comparison with the job item');
});

// ==================================================
// B. BOM
// ==================================================

test('15/16/18. BOM membership is information only: in-BOM, off-BOM and no-BOM lines are all allowed', () => {
  const lis = context().logicalItems;
  assert.equal(ac.bomMembership(line(1), bomVersion, lis), 'IN_BOM');
  assert.equal(ac.bomMembership(line(1, { materialId: 'm-kaolin' }), bomVersion, lis), 'IN_BOM', 'the material twin of a BOM product counts through the logical item');
  assert.equal(ac.bomMembership(line(1, { materialId: 'm-additive' }), bomVersion, lis), 'OFF_BOM');
  assert.equal(ac.bomMembership(line(1), null, lis), 'NO_BOM');
  assert.equal(ac.validateActualConsumption([line(1), line(2, { materialId: 'm-additive', unit: 'كجم' })], context()).valid, true, 'off-BOM additive allowed');
  assert.equal(/bomMembership|bomVersion/.test(readCode(PURE).slice(readCode(PURE).indexOf('export function validateActualConsumption'), readCode(PURE).indexOf('export function normaliseActualConsumption'))), false, 'validation never looks at the BOM');
});

test('17. the BOM is never modified by actual consumption', () => {
  const frozen = deepFreeze(JSON.parse(JSON.stringify(bomVersion)));
  ac.bomMembership(line(1), frozen, context().logicalItems);
  const code = readCode(PURE) + readCode(SERVICE) + readCode(PANEL);
  assert.equal(/saveBomVersionDraft|createBomVersion|transitionBomVersion|updateMasterDataItem|createMasterDataItem/.test(code), false);
});

// ==================================================
// P. PRODUCTION
// ==================================================

test('19/27/28. lines are prepared before, and written inside, each consuming form\'s existing single write', () => {
  for (const [stage, form] of Object.entries(CONSUMING)) {
    const code = readCode(`src/components/production/${form}.tsx`);
    assert.ok(new RegExp(`const consumptionLines = await prepareActualConsumption\\(materialsList, language\\);\\s*const newRecordId = await createStageRecord\\('${stage}', await attachProductionReferences\\('${stage}', \\{[\\s\\S]*?materials: consumptionLines,[\\s\\S]*?\\}, productionReferences, language\\), status\\);`).test(code), form);
    assert.equal(/materials: materialsList,/.test(code), false, `${form} no longer writes unvalidated lines`);
  }
  const svc = readCode(SERVICE);
  assert.equal(/createStageRecord|createProductionRecord|addDoc|setDoc|updateDoc|writeBatch/.test(svc + readCode(PURE) + readCode(PANEL)), false, 'no second write path');
  const rules = readSource('firestore.rules');
  assert.equal(/match \/(actualConsumption|materialConsumption|consumptionLines)/i.test(rules), false, 'no new collection');
  const changed = [execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/services/productionService.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim(), stageRecordServiceChangedBeyondApproved(ROOT)].filter(Boolean).join('\n');
  assert.equal(changed, '', 'write functions unchanged');
});

test('20-24. job, batch, logical item and operation stay on the record header (Step 5A); lines carry none; equipment unchanged', () => {
  const [out] = ac.normaliseActualConsumption([line(1)], context());
  assert.equal(['jobReferenceId', 'batchId', 'operationId', 'hierarchyNodeId', 'pressId', 'furnaceId'].some((k) => k in out), false);
  const operations = [ops.readOperation({ id: 'op-mix', code: 'OP-MIX', nameAr: 'x', legacyStageKey: 'mixing', active: true })];
  const refs = pr.validateProductionReferences('mixing', { materials: [out] }, {}, { operations });
  assert.deepEqual(refs.references, { operationId: 'op-mix' }, 'references still resolve with consumption present');
  assert.equal(/routingVersionId|routing|steps\[0\]/.test(readCode(PURE)), false, 'operation never taken from a routing');
});

test('25/26. invalid consumption throws before the write; the existing stage validation stays in place', () => {
  const svc = readCode(SERVICE);
  assert.ok(/if \(!check\.valid\) throw new Error/.test(svc));
  assert.ok(svc.indexOf('validateActualConsumption(') < svc.indexOf('return normaliseActualConsumption('));
  for (const form of Object.values(CONSUMING)) {
    const code = readCode(`src/components/production/${form}.tsx`);
    assert.ok(code.indexOf('prepareActualConsumption(') < code.indexOf('createStageRecord('), `${form}: prepared before the write`);
  }
});

// ==================================================
// H. HISTORY, INVENTORY, COST
// ==================================================

test('29/30. historical consumption and production are untouched: readers and importers unchanged', () => {
  assert.ok(/materials: d\.materials \|\| \[\]/.test(readCode('src/services/stageRecordService.ts')), 'the universal read passes stored lines through');
  const [out] = ac.normaliseActualConsumption([line(1)], context());
  for (const f of ['materialId', 'materialCode', 'materialName', 'quantity', 'unit']) assert.ok(f in out, `readers' fields present: ${f}`);
  for (const rel of ['src/services/historicalImportService.ts', 'src/services/tubeBallMillsHistoricalImportService.ts', 'src/services/pressingHistoricalImportService.ts', 'src/services/chineseMillsHistoricalImportService.ts']) {
    if (fs.existsSync(path.join(ROOT, rel))) assert.equal(/prepareActualConsumption|ActualConsumptionPanel/.test(readCode(rel)), false, rel);
  }
  assert.equal(/fetchUniversalStageRecords|stage_|'production'/.test(readCode(SERVICE) + readCode(PURE)), false, 'no historical read or rewrite');
});

test('31/32/33. no stock change, no inventory transaction, no cost', () => {
  const ctx = context();
  ac.validateActualConsumption([line(1)], ctx);
  ac.normaliseActualConsumption([line(1)], ctx);
  assert.equal(ctx.materials[0].currentStock, 500, 'stock unchanged (frozen input)');
  const code = readCode(PURE) + readCode(SERVICE) + readCode(PANEL);
  assert.equal(/currentStock|updateMaterial|stockMovement|inventory(Transaction|Movement)|warehouse/i.test(code), false);
  assert.equal(/\b(costPerUnit|unitCost|totalCost|materialCost|price|variance|amount)\b/i.test(code), false, 'no cost or variance');
});

// ==================================================
// U. UI
// ==================================================

test('U1. one shared panel replaces the four copied editors in the consuming forms; other stages are unchanged', () => {
  for (const form of Object.values(CONSUMING)) {
    const code = readCode(`src/components/production/${form}.tsx`);
    assert.ok(/<ActualConsumptionPanel lines=\{materialsList\} onChange=\{setMaterialsList\} jobReferenceId=\{productionReferences\?\.jobReferenceId\} \/>/.test(code), form);
    assert.equal(/materialsList\.map\(/.test(code), false, `${form}: the old inline editor is gone`);
    assert.ok(/useState<MaterialConsumptionItem\[\]>\(\[\]\)/.test(code), `${form}: the shared line type`);
  }
  // Phase 1 Step 6: these stages now record inputs through the entry screen's genealogy panel - still no editor inside the form.
  for (const form of NON_CONSUMING) assert.equal(/ActualConsumptionPanel/.test(readCode(`src/components/production/${form}.tsx`)), false, `${form} has no consumption editor of its own`);
  const panel = readCode(PANEL);
  assert.ok(/<SmartEntitySelect/.test(panel) && /allowAddNew=\{false\}/.test(panel), 'the existing selector, no inline creation');
  for (const id of ['actual-consumption-panel', 'actual-consumption-add']) assert.ok(panel.includes(`id="${id}"`), id);
  assert.ok(/moveLine\(/.test(panel) && /nextLineId\(/.test(panel), 'add / move / renumber through the shared helpers');
  assert.equal(/'actual-consumption'|'material-consumption'/.test(readCode('src/App.tsx') + readCode('src/types/index.ts')), false, 'no new page');
  assert.equal(/'(consumption|actualConsumption)\./i.test(readCode('src/types/permissions.ts')), false, 'no new permission keys');
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

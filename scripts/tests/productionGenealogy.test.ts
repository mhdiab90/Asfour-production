/**
 * PRODUCTION GENEALOGY - Phase 1 Step 6.
 *
 * I  inputs: the Step 5B consumption lines with an optional input batch - no second input system
 * O  outputs: item, batch, quantity, unit, type, notes - validated, normalised, never auto-created
 * D  decided rules: PRIMARY only when outputs exist; same batch + same item is circular
 * S  save: merged into each stage's existing single write; invalid = no write
 * U  UI: one panel inside the existing Production Entry container, no new page
 * N  non-goals: no stock, cost, BOM, routing, downstream record, collection or rule
 *
 * Pure modules run as shipped; forms and services import Firebase, so their
 * wiring is pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/productionGenealogy.test.ts
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

console.log('productionGenealogy.test.ts');

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
function interfaceHeader(name: string): string {
  const types = readCode('src/types/index.ts');
  const m = types.match(new RegExp(`export interface ${name}\\b[^{]*\\{`));
  assert.ok(m, `${name} interface exists`);
  return m![0];
}
function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as any).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

let g: any;
let li: any;
let ac: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  g = await load('src/services/productionGenealogyPure.ts');
  li = await load('src/services/logicalItemPure.ts');
  ac = await load('src/services/actualConsumptionPure.ts');
}

const PURE = 'src/services/productionGenealogyPure.ts';
const SERVICE = 'src/services/productionGenealogyService.ts';
const PANEL = 'src/components/production/ProductionGenealogyPanel.tsx';
const CONSUMPTION_PANEL = 'src/components/production/ActualConsumptionPanel.tsx';
const CONTAINER = 'src/components/production/StageProductionEntryView.tsx';
const FORM_CONSUMPTION: Record<string, string> = {
  rotary_furnace: 'RotaryFurnaceEntryForm',
  mortar_concrete: 'MortarConcreteEntryForm',
  mixing: 'MixingEntryForm',
  lightweight_foam: 'LightweightFoamEntryForm',
};
const CONTAINER_CONSUMPTION: Record<string, string> = {
  chinese_mills: 'ChineseMillsEntryForm',
  tube_ball_mills: 'TubeBallMillsEntryForm',
  sorting: 'SortingEntryForm',
};
const ALL_FORMS = ['ProductionEntryForm', ...Object.values(FORM_CONSUMPTION), ...Object.values(CONTAINER_CONSUMPTION)];
const formPath = (f: string) => `src/components/production/${f}.tsx`;
const fields = (v: any) => v.issues.map((i: any) => i.field);

const context = () => deepFreeze({
  products: [
    { id: 'p-calcined', code: 'CAL-40', name: 'كاولين مكلسن', unit: 'طن', currentStock: 99 },
    { id: 'p-brick', code: 'BRK-A', name: 'Brick A', unit: 'قطعة' },
    { id: 'p-dust', code: 'DST', name: 'غبار', unit: 'طن' },
  ],
  materials: [
    { id: 'm-clay', code: 'CLAY', name: 'طفلة', unit: 'طن', currentStock: 500 },
    { id: 'm-kaolin', code: 'KAO', name: 'كاولين', unit: 'طن', currentStock: 300 },
  ],
  logicalItems: [
    { id: 'li-kaolin', productId: 'p-calcined', materialId: 'm-kaolin', status: 'ACTIVE' },
    { id: 'li-brick', productId: 'p-brick', materialId: null, status: 'ACTIVE' },
  ].map((x) => li.readLogicalItem(x)),
  batches: [
    { id: 'b-open', batchNumber: 'B-OPEN', active: true },
    { id: 'b-kaolin', batchNumber: 'B-KAO', active: true, productId: 'p-calcined' },
    { id: 'b-brick-j1', batchNumber: 'B-BRK-J1', active: true, productId: 'p-brick', jobReferenceId: 'j1' },
    { id: 'b-j2', batchNumber: 'B-J2', active: true, jobReferenceId: 'j2' },
    { id: 'b-off', batchNumber: 'B-OFF', active: false },
  ],
});
const input = (n: number, over: Record<string, unknown> = {}) => ({ lineId: `L${n}`, sequence: n, itemSource: 'materials', materialId: 'm-clay', materialCode: 'CLAY', materialName: 'طفلة', quantity: 2, unit: 'طن', ...over });
const output = (n: number, over: Record<string, unknown> = {}) => ({ lineId: `L${n}`, sequence: n, itemSource: 'products', itemId: 'p-brick', itemCode: '', itemName: '', batchId: 'b-open', quantity: 1000, unit: 'قطعة', outputType: 'PRIMARY', notes: '', ...over });
const check = (inputs: any[], outputs: any[], jobReferenceId: string | null = 'j1', ctx: any = context()) =>
  g.validateProductionGenealogy(deepFreeze({ inputs, outputs, jobReferenceId }), ctx);

// ==================================================
// I. INPUTS = ACTUAL CONSUMPTION
// ==================================================

test('I/1. inputs are the Step 5B consumption lines - MaterialConsumptionItem gains only an optional batchId', () => {
  const block = interfaceBlock('MaterialConsumptionItem');
  assert.ok(block.includes('batchId?: string | null;'));
  assert.equal(/export interface (GenealogyInputLine|ProductionInputLine|InputLine)\b/.test(readCode('src/types/index.ts')), false, 'no competing input model');
  assert.equal(/productionInputs/.test(readCode('src/types/index.ts') + readCode(PURE) + readCode(SERVICE)), false, 'no second input array on the record');
});

test('I/2. the consumption normaliser carries the input batch through, and adds nothing when absent', () => {
  const ctx = context();
  const [withBatch] = ac.normaliseActualConsumption([input(1, { batchId: 'b-open' })], ctx);
  assert.equal(withBatch.batchId, 'b-open');
  const [without] = ac.normaliseActualConsumption([input(1)], ctx);
  assert.equal('batchId' in without, false, 'no empty key written');
});

test('I/3. an input batch must exist and be active', () => {
  assert.equal(check([input(1, { batchId: 'b-open' })], []).valid, true);
  assert.deepEqual(fields(check([input(1, { batchId: 'b-missing' })], [])), ['materials.batchId']);
  assert.deepEqual(fields(check([input(1, { batchId: 'b-off' })], [])), ['materials.batchId']);
});

test('I/4. a product-bound input batch must be the consumed item (logical identity) - input lots may be from other jobs', () => {
  assert.equal(check([input(1, { materialId: 'm-kaolin', batchId: 'b-kaolin' })], []).valid, true, 'material kaolin = product calcined via the logical item');
  assert.deepEqual(fields(check([input(1, { materialId: 'm-clay', batchId: 'b-kaolin' })], [])), ['materials.batchId']);
  assert.equal(check([input(1, { batchId: 'b-j2' })], [], 'j1').valid, true, 'job binding is not enforced on inputs');
});

test('I/5. an input batch cannot be verified without batches or logical items loaded - refused, never assumed', () => {
  const ctx = { ...context(), batches: null };
  assert.deepEqual(fields(check([input(1, { batchId: 'b-open' })], [], 'j1', ctx)), ['materials.batchId']);
});

test('I/6. the consumption panel gains an input-batch column filtered to active, compatible batches - read only', () => {
  const code = readCode(CONSUMPTION_PANEL);
  assert.ok(/MASTER_DATA_COLLECTIONS\.batches/.test(code));
  assert.ok(/batchId/.test(code));
  assert.ok(/active === false|active !== false/.test(code), 'inactive batches filtered');
  assert.equal(/createMasterDataItem|updateMasterDataItem|addDoc|setDoc|updateDoc|writeBatch/.test(code), false, 'selects, never creates');
});

// ==================================================
// O. OUTPUTS
// ==================================================

test('O/7. the output line model is controlled and cost-free', () => {
  const block = interfaceBlock('ProductionOutputLine');
  for (const f of ['lineId: string;', 'sequence: number;', "itemSource: 'products' | 'materials';", 'itemId: string;', 'itemCode: string;', 'itemName: string;', 'logicalItemId?: string | null;', 'batchId?: string | null;', 'quantity: number;', 'unit: string;', "outputType: 'PRIMARY' | 'BYPRODUCT' | 'SCRAP';", 'notes?: string;']) {
    assert.ok(block.includes(f), f);
  }
  assert.equal(/cost|price|stock|value|yield/i.test(block), false);
  assert.deepEqual([...g.OUTPUT_TYPES], ['PRIMARY', 'BYPRODUCT', 'SCRAP']);
  assert.deepEqual([...g.BATCH_REQUIRED_OUTPUT_TYPES], ['PRIMARY', 'BYPRODUCT']);
});

test('O/8. a valid primary output passes; lines keep stable ids and a valid sequence', () => {
  assert.equal(check([input(1)], [output(1)]).valid, true);
  assert.deepEqual(fields(check([], [output(1), output(2, { lineId: 'L1', outputType: 'SCRAP', batchId: '' })])), ['productionOutputs.lineId']);
  assert.deepEqual(fields(check([], [output(1), output(2, { sequence: 1, outputType: 'SCRAP', batchId: '' })])), ['productionOutputs.sequence']);
});

test('O/9. the output item must be a real product or material', () => {
  assert.equal(check([], [output(1, { itemSource: 'materials', itemId: 'm-kaolin', batchId: 'b-kaolin', unit: 'طن' })]).valid, true, 'a material output is allowed');
  assert.deepEqual(fields(check([], [output(1, { itemId: 'p-ghost' })])), ['productionOutputs.itemId']);
  assert.deepEqual(fields(check([], [output(1, { itemId: '' })])), ['productionOutputs.itemId']);
  assert.ok(fields(check([], [output(1, { itemSource: 'equipment' })])).includes('productionOutputs.itemSource'));
  assert.deepEqual(fields(check([], [output(1)], 'j1', { ...context(), products: null })), ['productionOutputs.itemId'], 'unloaded list = refused');
});

test('O/10. quantity > 0, never rounded', () => {
  for (const q of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '10', null]) {
    assert.deepEqual(fields(check([], [output(1, { quantity: q })])), ['productionOutputs.quantity'], String(q));
  }
  const out = g.normaliseProductionGenealogy({ inputs: [], outputs: [output(1, { quantity: 12.345 })], jobReferenceId: 'j1' }, context());
  assert.equal(out.productionOutputs[0].quantity, 12.345);
});

test('O/11. unit from the existing unit list - never assumed or converted', () => {
  assert.deepEqual(fields(check([], [output(1, { unit: '' })])), ['productionOutputs.unit']);
  assert.deepEqual(fields(check([], [output(1, { unit: 'kg' })])), ['productionOutputs.unit']);
  for (const u of ['طن', 'كجم', 'م3', 'لتر', 'شكارة', 'قطعة']) assert.equal(check([], [output(1, { unit: u })]).valid, true, u);
  const out = g.normaliseProductionGenealogy({ inputs: [], outputs: [output(1, { quantity: 300, unit: 'كجم' })], jobReferenceId: 'j1' }, context());
  assert.deepEqual([out.productionOutputs[0].quantity, out.productionOutputs[0].unit], [300, 'كجم']);
  assert.ok(/import \{ BOM_UNITS \} from '\.\/bomPure';/.test(readCode(PURE)), 'the one existing unit list');
});

test('O/12. output type is controlled', () => {
  assert.ok(fields(check([], [output(1, { outputType: 'WASTE' })])).includes('productionOutputs.outputType'));
  assert.ok(fields(check([], [output(1, { outputType: '' })])).includes('productionOutputs.outputType'));
});

test('O/13. notes are optional text', () => {
  assert.equal(check([], [output(1, { notes: undefined })]).valid, true);
  assert.deepEqual(fields(check([], [output(1, { notes: 42 })])), ['productionOutputs.notes']);
});

test('O/14. PRIMARY and BYPRODUCT require a batch; SCRAP may have none - no batch is generated', () => {
  assert.deepEqual(fields(check([], [output(1, { batchId: '' })])), ['productionOutputs.batchId']);
  assert.deepEqual(fields(check([], [output(1), output(2, { outputType: 'BYPRODUCT', batchId: null })])), ['productionOutputs.batchId']);
  assert.equal(check([], [output(1), output(2, { itemId: 'p-dust', outputType: 'SCRAP', batchId: '', unit: 'طن' })]).valid, true);
  const out = g.normaliseProductionGenealogy({ inputs: [], outputs: [output(1, { outputType: 'SCRAP', batchId: '' })], jobReferenceId: 'j1' }, context());
  assert.equal('batchId' in out.productionOutputs[0], false, 'no batch invented');
});

test('O/15. the output batch must exist and be active', () => {
  assert.deepEqual(fields(check([], [output(1, { batchId: 'b-ghost' })])), ['productionOutputs.batchId']);
  assert.deepEqual(fields(check([], [output(1, { batchId: 'b-off' })])), ['productionOutputs.batchId']);
  assert.deepEqual(fields(check([], [output(1)], 'j1', { ...context(), batches: null })), ['productionOutputs.batchId'], 'unverifiable = refused');
});

test('O/16. a product-bound output batch must be the output item (logical identity)', () => {
  assert.deepEqual(fields(check([], [output(1, { batchId: 'b-kaolin' })])), ['productionOutputs.batchId'], 'brick into a kaolin batch');
  assert.equal(check([], [output(1, { itemSource: 'materials', itemId: 'm-kaolin', batchId: 'b-kaolin', unit: 'طن' })]).valid, true, 'material side of the same logical item');
  assert.equal(check([], [output(1, { batchId: 'b-brick-j1' })], 'j1').valid, true);
});

test('O/17. a job-bound output batch must be this record\'s job', () => {
  assert.deepEqual(fields(check([], [output(1, { batchId: 'b-brick-j1' })], 'j2')), ['productionOutputs.batchId']);
  assert.deepEqual(fields(check([], [output(1, { batchId: 'b-j2' })], null)), ['productionOutputs.batchId'], 'untraced entry cannot claim a job lot');
  assert.equal(check([], [output(1, { batchId: 'b-j2' })], 'j2').valid, true);
});

test('O/18. a stored logicalItemId must be what the item resolves to', () => {
  assert.equal(check([], [output(1, { logicalItemId: 'li-brick' })]).valid, true);
  assert.deepEqual(fields(check([], [output(1, { logicalItemId: 'li-kaolin' })])), ['productionOutputs.logicalItemId']);
});

test('O/19. normalisation: snapshots from the source, logical item only when it resolves, sequences 1..n, type upper-cased', () => {
  const out = g.normaliseProductionGenealogy(deepFreeze({ inputs: [], jobReferenceId: 'j1', outputs: [
    output(2, { sequence: 9, itemName: 'typed', outputType: 'scrap', batchId: '', itemId: 'p-dust', unit: 'طن' }),
    output(1, { sequence: 4, notes: '  ok ' }),
  ] }), context());
  assert.deepEqual(out.productionOutputs.map((l: any) => [l.lineId, l.sequence]), [['L1', 1], ['L2', 2]]);
  const [brick, dust] = out.productionOutputs;
  assert.deepEqual([brick.itemCode, brick.itemName, brick.logicalItemId, brick.notes], ['BRK-A', 'Brick A', 'li-brick', 'ok']);
  assert.deepEqual([dust.itemName, dust.outputType, 'logicalItemId' in dust], ['غبار', 'SCRAP', false], 'no logical item created');
});

// ==================================================
// D. DECIDED RULES
// ==================================================

test('D/20. outputs are optional: no outputs = valid and nothing new merged', () => {
  assert.equal(check([input(1)], []).valid, true);
  assert.deepEqual(g.normaliseProductionGenealogy({ inputs: [input(1)], outputs: [], jobReferenceId: null }, context()), {});
});

test('D/21. once outputs are entered, at least one must be PRIMARY', () => {
  const v = check([], [output(1, { outputType: 'BYPRODUCT' }), output(2, { itemId: 'p-dust', outputType: 'SCRAP', batchId: '', unit: 'طن' })]);
  assert.deepEqual(fields(v), ['productionOutputs.outputType']);
  assert.equal(check([], [output(1), output(2, { outputType: 'BYPRODUCT', itemId: 'p-brick' })]).valid, true, 'several PRIMARY/BYPRODUCT lines allowed');
});

test('D/22. circular: the same batch AND the same item as an input is refused', () => {
  const v = check([input(1, { itemSource: 'products', materialId: 'p-brick', unit: 'قطعة', batchId: 'b-open' })], [output(1)]);
  assert.deepEqual(fields(v), ['productionOutputs.batchId']);
  assert.ok(v.issues[0].messageEn.includes('no transformation'));
});

test('D/23. circularity uses logical identity - the material side of the same item is the same item', () => {
  const v = check([input(1, { materialId: 'm-kaolin', batchId: 'b-kaolin' })], [output(1, { itemId: 'p-calcined', batchId: 'b-kaolin', unit: 'طن' })]);
  assert.deepEqual(fields(v), ['productionOutputs.batchId']);
});

test('D/24. the same batch carried into a different item is allowed; totals never have to balance', () => {
  assert.equal(check([input(1, { batchId: 'b-open', quantity: 50 })], [output(1, { batchId: 'b-open', quantity: 1 })]).valid, true);
});

test('D/25. index lists: unique input and output batch ids, only when present', () => {
  const out = g.normaliseProductionGenealogy({ jobReferenceId: 'j1',
    inputs: [input(1, { batchId: 'b-open' }), input(2, { batchId: 'b-open', materialId: 'm-kaolin' }), input(3)],
    outputs: [output(1, { batchId: 'b-brick-j1' }), output(2, { batchId: 'b-brick-j1', outputType: 'BYPRODUCT' }), output(3, { itemId: 'p-dust', outputType: 'SCRAP', batchId: '', unit: 'طن' })],
  }, context());
  assert.deepEqual(out.genealogyInputBatchIds, ['b-open']);
  assert.deepEqual(out.genealogyOutputBatchIds, ['b-brick-j1']);
  const onlyInputs = g.normaliseProductionGenealogy({ inputs: [input(1, { batchId: 'b-open' })], outputs: [], jobReferenceId: null }, context());
  assert.deepEqual(Object.keys(onlyInputs), ['genealogyInputBatchIds']);
  const typesCode = readCode('src/types/index.ts');
  assert.ok(/genealogyInputBatchIds\?: string\[\];/.test(typesCode) && /genealogyOutputBatchIds\?: string\[\];/.test(typesCode));
});

test('D/26. validation and normalisation never mutate their inputs (deep-frozen)', () => {
  const ctx = context();
  const data = deepFreeze({ inputs: [input(1, { batchId: 'b-open' })], outputs: [output(1, { sequence: 7 })], jobReferenceId: 'j1' });
  assert.doesNotThrow(() => g.validateProductionGenealogy(data, ctx));
  assert.doesNotThrow(() => g.normaliseProductionGenealogy(data, ctx));
});

test('D/27. output changes are described for the existing audit', () => {
  const a = output(1);
  assert.equal(g.describeOutputChange([], []), null);
  assert.ok(g.describeOutputChange([], [a]).startsWith('[PRODUCTION_GENEALOGY] output added L1 PRIMARY products/p-brick batch b-open 1000'));
  const changed = g.describeOutputChange([a], [{ ...a, batchId: 'b-brick-j1', quantity: 900, outputType: 'BYPRODUCT' }]);
  for (const s of ['L1 batch b-open -> b-brick-j1', 'L1 quantity 1000 -> 900', 'L1 type PRIMARY -> BYPRODUCT']) assert.ok(changed.includes(s), s);
  assert.ok(g.describeOutputChange([a], []).includes('output removed L1'));
});

// ==================================================
// S. SAVE PATH
// ==================================================

test('S/28. the service reads fresh batches and logical items, validates, throws on refusal, and never writes', () => {
  const code = readCode(SERVICE);
  assert.ok(/if \(outputLines\.length === 0 && !hasInputBatches\) return \{\};/.test(code), 'nothing to trace = nothing read');
  assert.ok(/loadLogicalItemState\(\{ skipCache: true \}\)/.test(code));
  assert.ok(/MASTER_DATA_COLLECTIONS\.batches, \{ skipCache: true \}/.test(code));
  assert.ok(/if \(!check\.valid\) throw new Error/.test(code));
  assert.equal(/addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|createMasterDataItem|updateMasterDataItem|safeAddDoc|registerLogicalItem/.test(code), false);
});

test('S/29. the four forms with their own consumption editor: genealogy validated before consumption, merged into the one createStageRecord', () => {
  for (const [stage, form] of Object.entries(FORM_CONSUMPTION)) {
    const code = readCode(formPath(form));
    assert.ok(new RegExp(`const genealogy = await prepareProductionGenealogy\\(materialsList, productionGenealogy\\?\\.outputs \\?\\? \\[\\], productionReferences, language\\);\\s*const consumptionLines = await prepareActualConsumption\\(materialsList, language\\);`).test(code), `${form} order`);
    assert.ok(new RegExp(`createStageRecord\\('${stage}', await attachProductionReferences\\('${stage}', \\{[\\s\\S]{0,1500}?materials: consumptionLines,\\s*\\.\\.\\.genealogy,`).test(code), `${form} single write`);
    assert.equal((code.match(/createStageRecord\(/g) ?? []).length, 1, `${form} one write`);
  }
});

test('S/30. Chinese Mills, Tube/Ball Mills and Sorting: inputs from the entry screen, validated, merged into the one createStageRecord', () => {
  for (const [stage, form] of Object.entries(CONTAINER_CONSUMPTION)) {
    const code = readCode(formPath(form));
    assert.ok(/const genealogy = await prepareProductionGenealogy\(genealogyInputs, productionGenealogy\?\.outputs \?\? \[\], productionReferences, language\);\s*const consumptionLines = await prepareActualConsumption\(genealogyInputs, language\);\s*const newRecordId = await createStageRecord/.test(code), `${form} order`);
    assert.ok(new RegExp(`createStageRecord\\('${stage}', await attachProductionReferences\\('${stage}', \\{\\s*date,\\s*\\.\\.\\.\\(consumptionLines\\.length \\? \\{ materials: consumptionLines \\} : \\{\\}\\),\\s*\\.\\.\\.genealogy,`).test(code), `${form} single write`);
    assert.equal(/ActualConsumptionPanel/.test(code), false, `${form} has no editor of its own`);
  }
});

test('S/31. Pressing: inputs and outputs merged into the record data before references and the one batched createProductionRecord', () => {
  const code = readCode(formPath('ProductionEntryForm'));
  assert.ok(/const genealogy = await prepareProductionGenealogy\(genealogyInputs, productionGenealogy\?\.outputs \?\? \[\], productionReferences, language\);\s*const consumptionLines = await prepareActualConsumption\(genealogyInputs, language\);\s*if \(consumptionLines\.length\) newRecordData\.materials = consumptionLines;\s*Object\.assign\(newRecordData, genealogy\);\s*const referencedRecordData = await attachProductionReferences\('pressing', newRecordData, productionReferences, language\);\s*const newRecordId = await createProductionRecord\(referencedRecordData\);/.test(code));
  assert.ok(/describeOutputChange\(\[\], genealogy\.productionOutputs \?\? \[\]\)/.test(code), 'outputs audited through the existing audit');
});

test('S/32. the write functions themselves are unchanged and no form writes genealogy on its own', () => {
  const stageService = readCode('src/services/stageRecordService.ts');
  const prodService = readCode('src/services/productionService.ts');
  assert.equal(/genealogy|productionOutputs/i.test(stageService + prodService), false);
  for (const form of ALL_FORMS) {
    const code = readCode(formPath(form));
    assert.equal((code.match(/prepareProductionGenealogy\(/g) ?? []).length, 1, `${form} validates once`);
    assert.equal(/collection\([^)]*genealogy|productionOutputs'\)|addDoc\([^)]*genealogy/i.test(code), false, `${form} no side write`);
  }
});

test('S/33. importers and other writers never call the genealogy service; historical records are not migrated', () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx|mjs|js)$/.test(e.name) && /prepareProductionGenealogy|normaliseProductionGenealogy/.test(readCode(rel))) offenders.push(rel);
    }
  };
  walk('src');
  walk('scripts');
  // Phase 1 Step 8C-2: the entity import and the post-save correction reuse the SAME genealogy rules
  // (they are user-driven writes of outputs, validated exactly like the entry forms) - still no migration
  // and still no historical record read or rewritten, which the tests below continue to prove.
  const allowed = new Set([
    SERVICE, PURE, ...ALL_FORMS.map(formPath),
    'src/services/importEntityValidationPure.ts',
    'src/services/recordCorrectionPure.ts',
    'scripts/tests/productionGenealogy.test.ts',
    // Phase 1 Step 8C-5: the shared entry form of the three new record types, and its test.
    'src/components/production/ProductionAreaEntryForm.tsx',
    'scripts/tests/productionAreas.test.ts',
  ]);
  assert.deepEqual(offenders.filter((f) => !allowed.has(f)), []);
  for (const rel of ['src/services/importEntityValidationPure.ts', 'src/services/recordCorrectionPure.ts']) {
    assert.equal(/migrat|historical(Record|Import)|stage_/i.test(readCode(rel)), false, `${rel} migrates nothing`);
  }
});

// ==================================================
// U. UI
// ==================================================

test('U/34. one genealogy panel inside the existing entry container, shared by all eight stages', () => {
  const code = readCode(CONTAINER);
  assert.equal((code.match(/<ProductionGenealogyPanel\b/g) ?? []).length, 1);
  assert.ok(/STAGES_WITH_FORM_CONSUMPTION: ProductionStageType\[\] = \['rotary_furnace', 'mortar_concrete', 'mixing', 'lightweight_foam', 'thermal_concrete', 'tunnel_kiln', 'handmade_brick'\]/.test(code));
  assert.ok(/showInputs=\{!STAGES_WITH_FORM_CONSUMPTION\.includes\(activeStage\)\}/.test(code), 'inputs once per stage - never two editors');
  // Step 8C-5: eight forms plus the one shared form of the three new record types.
  assert.equal((code.match(/productionGenealogy=\{productionGenealogy\}/g) ?? []).length, 9);
  assert.ok(/\[activeStage\]\);/.test(code) && /const handleSuccess = \(\) => \{\s*setGenealogyInputs\(\[\]\);\s*setProductionOutputs\(\[\]\);/.test(code), 'lines never carry over');
});

test('U/35. the panel uses SmartEntitySelect, selects existing batches only, and has no write path', () => {
  const code = readCode(PANEL);
  assert.ok(/SmartEntitySelect/.test(code));
  assert.ok(/<ActualConsumptionPanel\b/.test(code), 'inputs reuse the Step 5B panel');
  for (const id of ['production-genealogy-panel', 'production-genealogy-outputs', 'production-output-add']) assert.ok(code.includes(`id="${id}"`), id);
  assert.equal(/createMasterDataItem|updateMasterDataItem|addDoc|setDoc|updateDoc|writeBatch|registerLogicalItem|generateBatch|batchNumber:\s*`/.test(code), false);
});

test('U/36. no genealogy page, route or navigation entry', () => {
  const nav = ['src/App.tsx', 'src/components/layout/Sidebar.tsx', 'src/components/layout/MobileNav.tsx', 'src/components/layout/Header.tsx'].map(readCode).join('\n');
  assert.equal(/genealogy/i.test(nav), false);
  assert.equal(fs.readdirSync(path.join(ROOT, 'src/components/production')).some((f) => /Genealogy(View|Page)/.test(f)), false);
});

// ==================================================
// N. NON-GOALS
// ==================================================

test('N/37. every production record type may carry genealogy; the four stages without consumption gain optional materials', () => {
  for (const t of ['ProductionRecord', 'RotaryFurnaceRecord', 'ChineseMillsRecord', 'TubeBallMillsRecord', 'MortarConcreteRecord', 'MixingRecord', 'LightweightFoamRecord', 'SortingRecord']) {
    assert.ok(interfaceHeader(t).includes('WithProductionGenealogy'), t);
  }
  for (const t of ['ProductionRecord', 'ChineseMillsRecord', 'TubeBallMillsRecord', 'SortingRecord']) {
    assert.ok(interfaceBlock(t).includes('materials?: MaterialConsumptionItem[];'), t);
  }
});

test('N/38. no stock, inventory, cost, variance or yield logic in the genealogy layer', () => {
  const code = [PURE, SERVICE, PANEL].map(readCode).join('\n').replace(/['"`][^'"`\n]*['"`]/g, '""');
  assert.equal(/currentStock|inventory|warehouse|stockMovement|costPerUnit|unitCost|totalCost|standardCost|actualCost|variance|overhead|yieldCost/i.test(code), false);
});

test('N/39. no BOM, routing, job, batch or logical item is changed; no downstream record is created', () => {
  const code = [PURE, SERVICE, PANEL].map(readCode).join('\n');
  assert.equal(/saveBom|createBom|updateBom|saveRouting|createRouting|createJobReference|updateJobReference|createStageRecord|createProductionRecord|registerLogicalItem/.test(code), false);
});

test('N/40. no new Firestore collection, rule or Odoo integration', () => {
  assert.equal(/genealogy|productionOutputs/i.test(readSource('firestore.rules')), false, 'rules untouched for genealogy');
  assert.equal(/genealogy|productionOutputs/i.test(readCode('src/services/masterDataService.ts')), false, 'no master-data collection');
  const code = [PURE, SERVICE, PANEL].map(readCode).join('\n');
  assert.equal(/collection\(|doc\(|odoo/i.test(code), false);
});

test('N/41. the record\'s job, logical item, batch and operation stay the Step 5A references - genealogy never sets them', () => {
  const out = g.normaliseProductionGenealogy({ jobReferenceId: 'j1', inputs: [input(1, { batchId: 'b-open' })], outputs: [output(1, { batchId: 'b-brick-j1' })] }, context());
  assert.deepEqual(Object.keys(out).sort(), ['genealogyInputBatchIds', 'genealogyOutputBatchIds', 'productionOutputs']);
  for (const k of ['jobReferenceId', 'logicalItemId', 'batchId', 'operationId', 'hierarchyNodeId', 'routingId', 'bomId']) assert.equal(k in out, false, k);
  for (const form of ALL_FORMS) {
    const code = readCode(formPath(form));
    assert.ok(code.indexOf('prepareProductionGenealogy(') < code.indexOf('attachProductionReferences('), `${form}: references are applied last`);
  }
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

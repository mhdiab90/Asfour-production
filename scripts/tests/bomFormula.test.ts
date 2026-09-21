/**
 * BOM BASE FORMULA + ABOVE-FORMULA ADDITIVES - Phase 1 Step 7A.
 *
 * B  BOM: component type, base 100% rule, additives on top, basis, consistency
 * V  variance: base vs base, additive vs additive, off-BOM additive, type mismatch
 * S  safety: existing behaviour, production, historical consumption, no collection
 * U  UI and audit: the existing BOM editor, consumption panel and variance panel
 *
 * Pure modules run as shipped; UI and services are pinned by source inspection.
 *
 * Run: npx tsx scripts/tests/bomFormula.test.ts
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

console.log('bomFormula.test.ts');

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

let bom: any;
let qv: any;
let ac: any;
let li: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  bom = await load('src/services/bomPure.ts');
  qv = await load('src/services/quantityVariancePure.ts');
  ac = await load('src/services/actualConsumptionPure.ts');
  li = await load('src/services/logicalItemPure.ts');
}

const BOM_PURE = 'src/services/bomPure.ts';
const VARIANCE = 'src/services/quantityVariancePure.ts';
const MODAL = 'src/components/masterData/BomVersionsModal.tsx';
const CONSUMPTION_PANEL = 'src/components/production/ActualConsumptionPanel.tsx';
const VARIANCE_PANEL = 'src/components/production/QuantityVariancePanel.tsx';
const fields = (v: any) => v.issues.map((i: any) => i.field);

const known = { products: new Set(['brickA', 'p-gk']), materials: new Set(['m-clay', 'm-k13', 'm-k01', 'm-feld', 'm-acid', 'm-kaolin']) };
const bomHeader = { id: 'bom1', code: 'BOM-A', name: 'Brick A', itemSource: 'products', itemId: 'brickA', customerId: null, isDefault: true, active: true };
const ctx = (over: Record<string, unknown> = {}) => ({ knownItems: known, bom: bomHeader, logicalItems: [], ...over });

const c = (n: number, itemId: string, over: Record<string, unknown> = {}) => ({ lineId: `L${n}`, sequence: n, componentType: 'BASE', itemSource: itemId.startsWith('p-') ? 'products' : 'materials', itemId, quantity: null, unit: 'كجم', percentage: null, notes: '', ...over });

/** The factory example, basis 1000 كجم: 5 base lines = 100%, phosphoric acid +0.5%. */
const factoryKg = (over: Record<string, unknown> = {}) => ({
  id: 'v1', bomId: 'bom1', versionCode: 'V1', status: 'DRAFT', basisQuantity: 1000, basisUnit: 'كجم',
  components: [
    c(1, 'm-clay', { quantity: 100, percentage: 10 }),
    c(2, 'm-k13', { quantity: 300, percentage: 30 }),
    c(3, 'm-k01', { quantity: 400, percentage: 40 }),
    c(4, 'm-feld', { quantity: 100, percentage: 10 }),
    c(5, 'p-gk', { quantity: 100, percentage: 10 }),
    c(6, 'm-acid', { componentType: 'ADDITIVE', quantity: 5, percentage: 0.5 }),
  ],
  ...over,
});
/** The same formula written "per 1 طن" with كجم quantities - production recorded in طن scales without conversion. */
const factoryTon = () => ({ ...factoryKg(), basisQuantity: 1, basisUnit: 'طن' });
const activate = (version: any, context = ctx()) => bom.validateBomVersionTransition([], version, 'ACTIVE', context);
const withBase = (pcts: number[], extra: any[] = []) => factoryKg({ basisQuantity: null, basisUnit: null, components: [...pcts.map((p, i) => c(i + 1, ['m-clay', 'm-k13', 'm-k01', 'm-feld', 'p-gk'][i], { quantity: 1, unit: 'قطعة', percentage: p })), ...extra] });

// ==================================================
// B. BOM
// ==================================================

test('1-2. a component is BASE or ADDITIVE - a stored typed value; absent = BASE; anything else refused', () => {
  assert.deepEqual([...bom.BOM_COMPONENT_TYPES], ['BASE', 'ADDITIVE']);
  assert.equal(bom.componentPayload(c(1, 'm-clay', { quantity: 1 })).componentType, 'BASE');
  assert.equal(bom.componentPayload(c(1, 'm-acid', { componentType: 'additive', quantity: 1 })).componentType, 'ADDITIVE');
  const legacyLine = { lineId: 'L1', sequence: 1, itemSource: 'materials', itemId: 'm-clay', quantity: 100, unit: 'كجم', percentage: null, notes: '' };
  assert.equal(bom.componentPayload(legacyLine).componentType, 'BASE', 'a pre-7A line reads as BASE');
  const bad = bom.validateBomVersionForSave([], factoryKg({ components: [c(1, 'm-clay', { quantity: 100, componentType: '+' })] }), ctx());
  assert.deepEqual(fields(bad), ['components.componentType'], 'the "+" is display only, never the stored type');
});

test('3-4. BASE percentages make the base total; ADDITIVE percentages are excluded from it', () => {
  const f = bom.bomFormula(factoryKg());
  assert.deepEqual([f.baseTotal, f.additiveTotal, f.totalApplied, f.baseComplete, f.percentageBased], [100, 0.5, 100.5, true, true]);
});

test('5. a base total of exactly 100% is valid - saved and activated (additives on top)', () => {
  assert.equal(bom.validateBomVersionForSave([], factoryKg(), ctx()).valid, true);
  assert.deepEqual(activate(factoryKg()).issues, []);
});

test('6. a base total above 100% is refused with the base-formula message - never blamed on an additive', () => {
  const over = withBase([10, 30, 40, 10, 10.5], [c(6, 'm-acid', { componentType: 'ADDITIVE', quantity: 1, unit: 'قطعة', percentage: 0.5 })]);
  const v = bom.validateBomVersionForSave([], over, ctx());
  assert.deepEqual(fields(v), ['components.percentage']);
  assert.ok(v.issues[0].messageAr.startsWith('إجمالي الخلطة الأساسية يجب أن يساوي 100%.'));
  assert.ok(v.issues[0].messageEn.startsWith('Base formula percentage must equal 100%.'));
  assert.ok(v.issues[0].messageEn.includes('total 100.5%') && v.issues[0].messageEn.includes('additives are not included'));
  assert.equal(activate(over).valid, false, 'never activated');
  assert.equal(activate(over).issues.filter((i: any) => i.field === 'components.percentage').length, 1, 'reported once, not twice');
});

test('7. a base total below 100% is refused - the gap is not assumed to be an additive', () => {
  const under = withBase([10, 30, 40, 10, 9.5], [c(6, 'm-acid', { componentType: 'ADDITIVE', quantity: 1, unit: 'قطعة', percentage: 0.5 })]);
  const v = bom.validateBomVersionForSave([], under, ctx());
  assert.deepEqual(fields(v), ['components.percentage']);
  assert.ok(v.issues[0].messageEn.includes('total 99.5%'));
});

test('7b. a percentage-based base with a line whose share cannot be known may be saved as DRAFT but not activated', () => {
  const partial = factoryKg({ components: [c(1, 'm-clay', { quantity: 600, percentage: 60 }), c(2, 'm-k13', { quantity: 2, unit: 'شكارة' })] });
  assert.equal(bom.validateBomVersionForSave([], partial, ctx()).valid, true, 'a draft can be corrected later');
  const a = activate(partial);
  assert.deepEqual(fields(a), ['components.percentage']);
  assert.ok(/Line 2: a base component has no percentage/.test(a.issues[0].messageEn));
  const derivedUnder = factoryKg({ components: [c(1, 'm-clay', { quantity: 100, percentage: 10 }), c(2, 'm-k13', { quantity: 895 })] });
  assert.deepEqual(fields(activate(derivedUnder)), ['components.percentage'], '10% + 895/1000 = 99.5% (derived) refused at activation');
});

test('8. additives may make the total applied exceed 100%', () => {
  const two = factoryKg({ components: [...factoryKg().components, c(7, 'm-kaolin', { componentType: 'ADDITIVE', quantity: 10, percentage: 1 })] });
  const f = bom.bomFormula(two);
  assert.deepEqual([f.baseTotal, f.additiveTotal, f.totalApplied], [100, 1.5, 101.5]);
  assert.equal(activate(two).valid, true);
});

test('9-10. an additive shows "+0.5%" but stores the plain number 0.5', () => {
  assert.equal(bom.formatFormulaPercentage('ADDITIVE', 0.5), '+0.5%');
  assert.equal(bom.formatFormulaPercentage('BASE', 10), '10.0%');
  assert.equal(bom.formatFormulaPercentage('BASE', 100), '100.0%');
  const payload = bom.componentPayload(c(6, 'm-acid', { componentType: 'ADDITIVE', quantity: '5', percentage: '0.5' }));
  assert.deepEqual([payload.percentage, typeof payload.percentage], [0.5, 'number']);
  assert.equal(/'\+'\s*\+|percentage:\s*`\+/.test(readCode(BOM_PURE).replace(/\? '\+' : ''/, '')), false, 'no "+" concatenated into stored values');
});

test('11-13. quantity and percentage must agree with the basis, for BASE and ADDITIVE; the conflicting line is named, nothing is fixed silently', () => {
  const base = factoryKg({ components: factoryKg().components.map((x: any) => (x.lineId === 'L1' ? { ...x, percentage: 12 } : x)) });
  const vb = bom.validateBomVersionForSave([], base, ctx());
  assert.ok(vb.issues.some((i: any) => i.field === 'components.percentage' && /Line 1: quantity 100 does not match 12%/.test(i.messageEn)));
  const add = factoryKg({ components: factoryKg().components.map((x: any) => (x.lineId === 'L6' ? { ...x, percentage: 0.6 } : x)) });
  const va = bom.validateBomVersionForSave([], add, ctx());
  assert.deepEqual(fields(va), ['components.percentage']);
  assert.ok(/Line 6: quantity 5 does not match 0.6%/.test(va.issues[0].messageEn));
  assert.equal(bom.bomVersionPayloadForSave(add).components[5].percentage, 0.6, 'the input is not rewritten');
});

test('14. one logical item appears once per version - not as BASE and ADDITIVE together', () => {
  const dup = factoryKg({ components: [...factoryKg().components, c(7, 'm-clay', { componentType: 'ADDITIVE', quantity: 5, percentage: 0.5 })] });
  assert.ok(fields(bom.validateBomVersionForSave([], dup, ctx())).includes('components.itemId'));
  const mapped = [{ id: 'li-k', productId: 'p-gk', materialId: 'm-kaolin', status: 'ACTIVE' }].map((x) => li.readLogicalItem(x));
  const viaLogical = factoryKg({ components: [...factoryKg().components, c(7, 'm-kaolin', { componentType: 'ADDITIVE', quantity: 5, percentage: 0.5 })] });
  assert.ok(fields(bom.validateBomVersionForSave([], viaLogical, ctx({ logicalItems: mapped }))).includes('components.itemId'), 'the product and material of one logical item');
});

test('15. a BOM cannot contain its own item - as base or additive', () => {
  const self = factoryKg({ components: [...factoryKg().components, { ...c(7, 'p-x', { componentType: 'ADDITIVE', quantity: 5, percentage: 0.5 }), itemSource: 'products', itemId: 'brickA' }] });
  assert.ok(fields(bom.validateBomVersionForSave([], self, ctx())).includes('components.itemId'));
});

test('16-17. quantities follow the basis: derived for display, scaled with production - base and additive alike', () => {
  const pctOnly = factoryKg({ components: [c(1, 'm-clay', { percentage: 100 }), c(2, 'm-acid', { componentType: 'ADDITIVE', percentage: 0.5 })] });
  assert.equal(bom.validateBomVersionForSave([], pctOnly, ctx()).valid, true, 'percentage-only lines are allowed');
  const f = bom.bomFormula(pctOnly);
  assert.deepEqual(f.lines.map((l: any) => [l.effectiveQuantity, l.quantityDerived, l.quantity]), [[1000, true, null], [5, true, null]]);
  const qtyOnly = bom.bomFormula(factoryKg({ components: [c(1, 'm-k13', { quantity: 300 }), c(2, 'm-acid', { componentType: 'ADDITIVE', quantity: 5 })] }));
  assert.deepEqual(qtyOnly.lines.map((l: any) => [l.effectivePercentage, l.percentageDerived]), [[30, true], [0.5, true]], '300 x 100 / 1000 = 30 exactly');
  assert.equal(activate(pctOnly).valid, true);
});

test('18. a missing basis is reported when percentages or additives need one - no basis invented', () => {
  const noBasis = factoryKg({ basisQuantity: null, basisUnit: null });
  assert.equal(bom.validateBomVersionForSave([], noBasis, ctx()).valid, true, 'draft save allowed');
  assert.deepEqual(fields(activate(noBasis)), ['basisQuantity']);
  assert.ok(/MISSING_BOM_BASIS/.test(activate(noBasis).issues[0].messageEn));
  const additiveQtyOnly = factoryKg({ basisQuantity: null, basisUnit: null, components: [c(1, 'm-clay', { quantity: 100 }), c(2, 'm-acid', { componentType: 'ADDITIVE', quantity: 5 })] });
  assert.deepEqual(fields(activate(additiveQtyOnly)), ['basisQuantity'], 'an additive is proportional - never a fixed amount');
  const plainQty = factoryKg({ basisQuantity: null, basisUnit: null, components: [c(1, 'm-clay', { quantity: 100 }), c(2, 'm-k13', { quantity: 300 })] });
  assert.equal(activate(plainQty).valid, true, 'a quantity-only base BOM keeps working without a basis');
  const onlyAdditives = factoryKg({ components: [c(1, 'm-acid', { componentType: 'ADDITIVE', quantity: 5, percentage: 0.5 })] });
  assert.ok(activate(onlyAdditives).issues.some((i: any) => /no base formula/.test(i.messageEn)));
});

test('19. the approved bag spelling is "شكارة"; the legacy "شيكارة" is the same unit, never a factor', () => {
  assert.ok(bom.BOM_UNITS.includes('شكارة'));
  assert.equal(bom.BOM_UNITS.includes('شيكارة'), false);
  assert.equal(bom.approvedUnitSpelling('شيكارة'), 'شكارة');
  assert.equal(bom.approvedUnitSpelling(' كجم '), 'كجم');
  // Step 8E added the plain spelling of the square metre - a spelling table, never a factor.
  assert.deepEqual(Object.entries(bom.UNIT_SPELLING_ALIASES), [['شيكارة', 'شكارة'], ['m2', 'm²'], ['M2', 'm²']]);
  assert.equal(bom.approvedUnitSpelling('m2'), 'm²');
});

test('20. no silent unit conversion: a different unit is never compared or converted', () => {
  const tonsLine = factoryKg({ components: [c(1, 'm-clay', { quantity: 0.1, unit: 'طن', percentage: 100 })] });
  assert.equal(bom.validateBomVersionForSave([], tonsLine, ctx()).valid, true, 'consistency is not checked across units');
  assert.equal(bom.bomFormula(tonsLine).lines[0].percentageDerived, false);
  assert.equal(/[*/]\s*1000\b|convertUnit|conversionFactor|unitFactor/.test(readCode(BOM_PURE) + readCode(VARIANCE)), false);
});

test('21. legacy mixtures are untouched: read-only, not typed as base/additive, never written', () => {
  const read = bom.readLegacyMixture({ isMixtureBOM: true, mixtureComponents: [{ materialId: 'm-clay', quantityKg: 700, percentage: 70 }] });
  assert.equal('componentType' in read.lines[0], false);
  const code = readCode(MODAL) + readCode('src/services/bomService.ts');
  assert.equal(/mixtureComponents\s*[:=]|isMixtureBOM\s*[:=]/.test(code), false);
});

// ==================================================
// V. VARIANCE
// ==================================================

const logicalItems = [] as any[];
const vctx = (version: any) => deepFreeze({ jobs: [{ id: 'j1', bomVersionId: 'v1' }], bomVersions: [version], boms: [bomHeader], logicalItems, products: [], materials: [] });
const used = (n: number, materialId: string, quantity: number, over: Record<string, unknown> = {}) => ({ lineId: `L${n}`, sequence: n, itemSource: materialId.startsWith('p-') ? 'products' : 'materials', materialId, quantity, unit: 'كجم', componentType: 'BASE', ...over });
const analyse = (version: any, materials: any[], productionQuantity: number, productionUnit: string) =>
  qv.analyseQuantityVariance(deepFreeze({ jobReferenceId: 'j1', materials, productionQuantity, productionUnit }), vctx(version));
const byItem = (r: any, id: string, type = 'BASE') => r.rows.find((x: any) => x.itemId === id && x.componentType === type);
const expected = (r: any) => Object.fromEntries(r.rows.map((x: any) => [`${x.componentType}:${x.itemId}`, x.expectedQuantity]));

test('22-23/26. factory example: 2000 كجم -> 200/600/800/200/200 base and 10 additive; 500 كجم -> 50/150/200/50/50 and 2.5', () => {
  const r2 = analyse(factoryKg(), [], 2000, 'كجم');
  assert.deepEqual(expected(r2), { 'BASE:m-clay': 200, 'BASE:m-k13': 600, 'BASE:m-k01': 800, 'BASE:m-feld': 200, 'BASE:p-gk': 200, 'ADDITIVE:m-acid': 10 });
  const rHalf = analyse(factoryKg(), [], 500, 'كجم');
  assert.deepEqual(expected(rHalf), { 'BASE:m-clay': 50, 'BASE:m-k13': 150, 'BASE:m-k01': 200, 'BASE:m-feld': 50, 'BASE:p-gk': 50, 'ADDITIVE:m-acid': 2.5 });
});

test('22-23/26b. the same formula "per 1 طن" scales from production recorded in طن - 2 طن and 0.5 طن', () => {
  assert.deepEqual(expected(analyse(factoryTon(), [], 2, 'طن')), { 'BASE:m-clay': 200, 'BASE:m-k13': 600, 'BASE:m-k01': 800, 'BASE:m-feld': 200, 'BASE:p-gk': 200, 'ADDITIVE:m-acid': 10 });
  assert.deepEqual(expected(analyse(factoryTon(), [], 0.5, 'طن')), { 'BASE:m-clay': 50, 'BASE:m-k13': 150, 'BASE:m-k01': 200, 'BASE:m-feld': 50, 'BASE:p-gk': 50, 'ADDITIVE:m-acid': 2.5 });
});

test('22-23. base actual is compared with base standard, additive actual with additive standard', () => {
  const r = analyse(factoryTon(), [used(1, 'm-clay', 210), used(2, 'm-acid', 9, { componentType: 'ADDITIVE' })], 2, 'طن');
  const clay = byItem(r, 'm-clay');
  const acid = byItem(r, 'm-acid', 'ADDITIVE');
  assert.deepEqual([clay.status, clay.varianceQuantity, clay.variancePercent], ['OVER_CONSUMED', 10, 5]);
  assert.deepEqual([acid.status, acid.varianceQuantity, acid.variancePercent], ['UNDER_CONSUMED', -1, -10]);
});

test('24. an additive consumed but not in the BOM is OFF_BOM_ADDITIVE; an unplanned base item stays OFF_BOM', () => {
  // Every planned item is consumed, so no unmatched unmapped item on the other side makes the identity ambiguous.
  const planned = [used(1, 'm-clay', 200), used(2, 'm-k13', 600), used(3, 'm-k01', 800), used(4, 'm-feld', 200), used(5, 'p-gk', 200), used(6, 'm-acid', 10, { componentType: 'ADDITIVE' })];
  const r = analyse(factoryTon(), [...planned, used(7, 'm-kaolin', 3, { componentType: 'ADDITIVE' }), used(8, 'm-extra', 4)], 2, 'طن');
  assert.equal(r.summary.matched, 6);
  assert.equal(byItem(r, 'm-kaolin', 'ADDITIVE').status, 'OFF_BOM_ADDITIVE');
  assert.equal(byItem(r, 'm-extra').status, 'OFF_BOM');
  assert.deepEqual([r.summary.offBomAdditive, r.summary.offBom], [1, 1]);
});

test('25. the same item in the other formula group is FORMULA_TYPE_MISMATCH - never merged into one number', () => {
  const r = analyse(factoryTon(), [used(1, 'm-acid', 10)], 2, 'طن');
  const standardRow = byItem(r, 'm-acid', 'ADDITIVE');
  const actualRow = byItem(r, 'm-acid', 'BASE');
  assert.deepEqual([standardRow.status, standardRow.inBom, standardRow.actualFound, standardRow.varianceQuantity], ['FORMULA_TYPE_MISMATCH', true, false, null]);
  assert.deepEqual([actualRow.status, actualRow.inBom, actualRow.actualFound, actualRow.varianceQuantity, actualRow.actualQuantity], ['FORMULA_TYPE_MISMATCH', false, true, null, 10]);
  assert.equal(r.summary.formulaTypeMismatch, 2);
  const untyped = analyse(factoryTon(), [{ lineId: 'L1', sequence: 1, itemSource: 'materials', materialId: 'm-acid', quantity: 10, unit: 'كجم' }], 2, 'طن');
  assert.equal(byItem(untyped, 'm-acid', 'BASE').status, 'FORMULA_TYPE_MISMATCH', 'an unclassified line is BASE - the BOM never decides it');
});

test('18v. a BOM with percentages or additives but no basis gives MISSING_BOM_BASIS rows, not numbers', () => {
  const r = analyse(factoryKg({ basisQuantity: null, basisUnit: null }), [used(1, 'm-clay', 200), used(2, 'm-acid', 10, { componentType: 'ADDITIVE' })], 2000, 'كجم');
  assert.deepEqual([r.basis.gap, byItem(r, 'm-clay').status, byItem(r, 'm-acid', 'ADDITIVE').status, byItem(r, 'm-clay').varianceQuantity], ['MISSING_BOM_BASIS', 'MISSING_BOM_BASIS', 'MISSING_BOM_BASIS', null]);
  assert.equal(byItem(r, 'm-k13').status, 'MISSING', 'presence checks still run');
  assert.ok(r.message.messageEn.includes('Data required for this calculation is not currently available'));
});

test('19v/27. the legacy bag spelling scales against a "شكارة" basis; other unit differences stay explicit', () => {
  const bags = { ...factoryKg(), basisQuantity: 10, basisUnit: 'شكارة' };
  assert.equal(analyse(bags, [], 20, 'شيكارة').basis.state, 'SCALED');
  const tons = analyse(factoryKg(), [used(1, 'm-clay', 0.2, { unit: 'طن' })], 2000, 'كجم');
  assert.deepEqual([byItem(tons, 'm-clay').status, byItem(tons, 'm-clay').varianceQuantity], ['UNIT_MISMATCH', null]);
  assert.equal(analyse(factoryKg(), [], 2, 'طن').basis.gap, 'UNIT_DIFFERS', 'basis كجم vs production طن - not converted');
});

test('28. quantities only - no cost, price or money anywhere in the formula or variance code', () => {
  const code = [BOM_PURE, VARIANCE, VARIANCE_PANEL, MODAL].map(readCode).join('\n').replace(/['"`][^'"`\n]*['"`]/g, '""');
  assert.equal(/costPerUnit|unitCost|totalCost|standardCost|actualCost|materialRate|price|currency|overhead/i.test(code), false);
});

// ==================================================
// S. SAFETY
// ==================================================

test('29. behaviour unrelated to the formula group is unchanged', () => {
  const plain = { bomId: 'bom1', versionCode: 'V1', status: 'DRAFT', components: [{ lineId: 'L1', itemSource: 'materials', itemId: 'm-clay', quantity: 100, unit: 'كجم', sequence: 1, percentage: null, notes: '' }] };
  assert.equal(bom.validateBomVersionForSave([], plain, ctx()).valid, true);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], { ...plain, components: [{ ...plain.components[0], quantity: 0 }] }, ctx())), ['components.quantity'], 'quantity still required without a percentage');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], { ...plain, components: [{ ...plain.components[0], unit: 'kg' }] }, ctx())), ['components.unit']);
  const r = qv.analyseQuantityVariance(deepFreeze({ jobReferenceId: 'j1', materials: [used(1, 'm-clay', 100)], productionQuantity: 7, productionUnit: 'طن' }), vctx({ id: 'v1', bomId: 'bom1', versionCode: 'V1', status: 'ACTIVE', components: plain.components }));
  assert.deepEqual([r.basis.state, byItem(r, 'm-clay').status], ['NO_BASIS', 'MATCHED'], 'a quantity-only version without basis is still compared as written');
});

test('30. production write paths are unchanged', () => {
  const changed = [execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/services/productionService.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim(), stageRecordServiceChangedBeyondApproved(ROOT)].filter(Boolean).join('\n');
  assert.equal(changed, '');
});

test('31. historical consumption is unchanged: read as BASE, never rewritten; only new lines store the type', () => {
  const historical = deepFreeze([{ lineId: 'L1', sequence: 1, materialId: 'm-clay', materialCode: 'C', materialName: 'Clay', quantity: 5, unit: 'كجم' }]);
  assert.doesNotThrow(() => qv.analyseQuantityVariance({ jobReferenceId: 'j1', materials: historical, productionQuantity: 2, productionUnit: 'طن' }, vctx(factoryTon())));
  const context = { products: [], materials: [{ id: 'm-clay', code: 'C', name: 'Clay' }, { id: 'm-acid', code: 'A', name: 'Acid' }], logicalItems: [] };
  const [newLine] = ac.normaliseActualConsumption([{ ...historical[0] }], context);
  assert.equal(newLine.componentType, 'BASE', 'a new write stores the type explicitly');
  const [additive] = ac.normaliseActualConsumption([{ ...historical[0], materialId: 'm-acid', componentType: 'ADDITIVE' }], context);
  assert.equal(additive.componentType, 'ADDITIVE');
  assert.deepEqual(ac.validateActualConsumption([{ ...historical[0], componentType: 'EXTRA' }], context).issues.map((i: any) => i.field), ['materials.componentType']);
  assert.ok(/L1 type BASE -> ADDITIVE/.test(ac.describeConsumptionChange(historical, [{ ...historical[0], componentType: 'ADDITIVE' }])));
});

test('32. no new Firestore collection or rule', () => {
  assert.equal(/componentType|match \/[^\n]*(formula|additive)/i.test(readSource('firestore.rules')), false);
  assert.equal(/collection\(|doc\(|addDoc|setDoc|updateDoc/.test(readCode(BOM_PURE) + readCode(VARIANCE)), false);
  assert.equal(/formula|additive/i.test(readCode('src/services/masterDataService.ts')), false);
});

// ==================================================
// U. UI AND AUDIT
// ==================================================

test('U1. the existing BOM editor gets a type selector, "+" display, derived values, summary and preview - gated by the existing edit right', () => {
  const modal = readCode(MODAL);
  assert.ok(/<select disabled=\{!editable\} value=\{isAdditive \? 'ADDITIVE' : 'BASE'\}/.test(modal), 'type selector, read-only without edit rights');
  assert.ok(/formatFormulaPercentage\(/.test(modal) && /isAdditive && <span className="font-black text-purple-700">\+<\/span>/.test(modal));
  for (const id of ['bom-formula-summary', 'bom-formula-issues', 'bom-formula-preview']) assert.ok(modal.includes(`id="${id}"`), id);
  assert.ok(/'Base Formula:'/.test(modal) && /'Additives:'/.test(modal) && /'Total Applied:'/.test(modal));
  assert.ok(/bomFormulaIssues\(formulaInput\)/.test(modal), 'the same rules activation enforces');
  assert.equal(/setPreviewQuantity\([^)]*\)[^;]*saveBomVersionDraft|previewQuantity[^\n]*createBomVersion/.test(modal), false, 'the preview is never saved');
  assert.equal(/'bom|Bom(View|Page|Manager)|formula/i.test(readCode('src/App.tsx')), false, 'no new top-level screen');
});

test('U2. actual consumption records Base or Additive in the shared panel; the variance panel shows the group and new statuses', () => {
  const panel = readCode(CONSUMPTION_PANEL);
  assert.ok(/value=\{componentTypeOf\(line as any\)\}/.test(panel) && /componentType: 'BASE' \}/.test(panel));
  const vp = readCode(VARIANCE_PANEL);
  for (const s of ['OFF_BOM_ADDITIVE', 'FORMULA_TYPE_MISMATCH', 'MISSING_BOM_BASIS']) assert.ok(vp.includes(`${s}:`), s);
  assert.ok(/r\.componentType === 'ADDITIVE'/.test(vp));
});

test('U3. audit names component type, item, quantity and percentage changes; activation and retirement stay audited', () => {
  const before = factoryKg();
  const after = { ...before, components: before.components.map((x: any) => (x.lineId === 'L1' ? { ...x, componentType: 'ADDITIVE', percentage: 0.5, quantity: 5 } : x)) };
  const d = bom.describeBomVersionChange(before, after);
  assert.ok(/L1 \(type BASE -> ADDITIVE, quantity 100 -> 5, percentage 10 -> 0.5\)/.test(d), d);
  const added = bom.describeBomVersionChange({ ...before, components: [] }, before);
  assert.ok(/L6 ADDITIVE materials\/m-acid 5 كجم \+0.5%/.test(added), added);
  assert.ok(/logAuditAction\(next === 'ACTIVE' \? 'ACTIVATE' : 'DEACTIVATE'/.test(readCode('src/services/bomService.ts')));
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

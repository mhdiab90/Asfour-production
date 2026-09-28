/**
 * BOM COSTING VIEW, ALUMINA AND IMPORTED SHARE (3.24.0)
 *
 * THE PROPERTIES UNDER TEST:
 * - a component's value is its quantity for the basis x the chosen price
 *   (last purchase / average issue), converted ONLY through the approved
 *   COSTING conversion (طن <-> كجم); any other unit pair is reported, never
 *   guessed, and a component without a price is shown without a value - never
 *   valued at zero;
 * - the mix's alumina % is the effective-percentage-weighted average, and a
 *   component without an alumina % makes it "incomplete" instead of counting 0;
 * - the imported value is the sum of the IMPORTED components' values, and its
 *   share is taken of the total;
 * - the attributes screen writes ONLY the fields that changed, validates them,
 *   and is behind the existing edit gate.
 *
 * Run: npx tsx scripts/tests/bomCosting.test.ts
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

console.log('bomCosting.test.ts');

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

const RULES = 'src/services/bomCostingPure.ts';
const MODAL = 'src/components/masterData/BomVersionsModal.tsx';
const ATTRS = 'src/components/masterData/BomComponentAttributesModal.tsx';
const VIEW = 'src/components/masterData/MasterDataView.tsx';

let c: any;
let print: any;
let uom: any;

async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  c = await load(RULES);
  print = await load('src/services/bomPrintPure.ts');
  uom = await load('src/services/uomPure.ts');
}

const RECORDS: Record<string, any> = {
  'products:p1': { id: 'p1', code: 'CRUSH', name: 'Crushed brick', aluminaPercentage: 40 },
  'materials:m1': { id: 'm1', code: 'M-ALU60', name: 'Alumina 60', unit: 'طن', aluminaPercentage: 60, origin: 'IMPORTED', lastPurchasePrice: 18000, averageIssuePrice: 17250 },
  'materials:m2': { id: 'm2', code: 'M-CR', name: 'Chromite', unit: 'طن', aluminaPercentage: 12, origin: 'LOCAL', lastPurchasePrice: 9000, averageIssuePrice: 8800 },
  'materials:m3': { id: 'm3', code: 'M-BND', name: 'Binder', unit: 'كجم', origin: 'LOCAL', lastPurchasePrice: 25 },
  'materials:m4': { id: 'm4', code: 'M-BAG', name: 'Bagged', unit: 'شكارة', aluminaPercentage: 5, origin: 'IMPORTED', lastPurchasePrice: 300 },
};
const lookup = (s: string, id: string) => RECORDS[`${s}:${id}`] ?? null;

const VERSION = {
  basisQuantity: 1000,
  basisUnit: 'كجم',
  components: [
    { lineId: 'L1', componentType: 'BASE', itemSource: 'materials', itemId: 'm1', percentage: 60, unit: 'كجم', sequence: 1 },
    { lineId: 'L2', componentType: 'BASE', itemSource: 'materials', itemId: 'm2', quantity: 400, unit: 'كجم', sequence: 2 },
    { lineId: 'L3', componentType: 'ADDITIVE', itemSource: 'materials', itemId: 'm3', percentage: 2.5, unit: 'كجم', sequence: 3 },
  ],
};

// ==================================================
// A. A LINE'S VALUE
// ==================================================

test('A1. quantity x price in the same unit', () => {
  assert.deepEqual(c.lineValue(25, 'كجم', 25, 'كجم'), { value: 625, reason: null, factor: 1 });
});

test('A2. kg against a price per ton goes through the approved COSTING conversion', () => {
  const v = c.lineValue(600, 'كجم', 18000, 'طن');
  assert.equal(v.reason, null);
  assert.equal(Math.round(v.value * 100) / 100, 10800);
  assert.equal(Math.round(c.lineValue(0.4, 'طن', 25, 'كجم').value), 10000, 'and the other way');
});

test('A3. the costing conversion is ONLY ton <-> kg, and only in the COSTING context', () => {
  assert.deepEqual(c.COSTING_UOM_CONVERSIONS.map((x: any) => [x.context, x.from, x.to, x.factor]), [
    ['COSTING', 'كجم', 'طن', 1 / 1000], ['COSTING', 'طن', 'كجم', 1000],
  ]);
  // Nothing else is converted: a bag against a ton, a piece against a kilogram.
  assert.equal(c.lineValue(10, 'شكارة', 300, 'طن').reason, 'UNIT_MISMATCH');
  assert.equal(c.lineValue(10, 'قطعة', 5, 'كجم').reason, 'UNIT_MISMATCH');
  // And the approval is not a global one: another context still refuses ton <-> kg.
  assert.equal(uom.uomCompatibility('كجم', 'طن', 'QUANTITY_VARIANCE', c.COSTING_UOM_CONVERSIONS).status, 'PHYSICALLY_CONVERTIBLE');
});

test('A4. no price, no quantity or no unit: no value, with the reason - never zero', () => {
  assert.deepEqual(c.lineValue(10, 'كجم', null, 'كجم'), { value: null, reason: 'NO_PRICE', factor: null });
  assert.deepEqual(c.lineValue(null, 'كجم', 5, 'كجم'), { value: null, reason: 'NO_QUANTITY', factor: null });
  assert.deepEqual(c.lineValue(10, '', 5, 'كجم'), { value: null, reason: 'NO_UNIT', factor: null });
  assert.equal(c.lineValue(10, 'كجم', 0, 'كجم').value, 0, 'a real price of zero is a value, not a missing one');
});

// ==================================================
// B. THE VERSION
// ==================================================

test('B1. the total is the sum of the valued lines, at the chosen price basis', () => {
  const last = c.bomCosting(VERSION, lookup, 'LAST_PURCHASE');
  assert.deepEqual(last.lines.map((l: any) => Math.round(l.value * 100) / 100), [10800, 3600, 625]);
  assert.equal(Math.round(last.totalCost * 100) / 100, 15025);
  assert.equal(last.costComplete, true);
  const avg = c.bomCosting(VERSION, lookup, 'AVERAGE_ISSUE');
  // The binder has no average price: shown without a value and left out of the total.
  assert.equal(avg.lines[2].value, null);
  assert.equal(avg.lines[2].valueReason, 'NO_PRICE');
  assert.equal(Math.round(avg.totalCost * 100) / 100, 0.6 * 17250 + 0.4 * 8800);
  assert.equal(avg.costComplete, false);
  assert.equal(avg.unvaluedLines, 1);
});

test('B2. imported value and share: the IMPORTED components against the total', () => {
  const r = c.bomCosting(VERSION, lookup, 'LAST_PURCHASE');
  assert.equal(Math.round(r.importedValue), 10800);
  assert.equal(Math.round(r.importedShare * 100) / 100, Math.round((10800 * 10000) / 15025) / 100);
  assert.equal(r.missingOrigin, 0);
});

test('B3. the mix alumina is weighted by effective percentage; a missing alumina is "incomplete", not zero', () => {
  const r = c.bomCosting(VERSION, lookup, 'LAST_PURCHASE');
  // 60% x 60 + 40% x 12 over 100 (the binder has no alumina and is left out).
  assert.equal(Math.round(r.aluminaTotal * 100) / 100, 40.8);
  assert.equal(r.aluminaComplete, false);
  assert.equal(r.missingAlumina, 1);
  const complete = c.bomCosting({ ...VERSION, components: VERSION.components.slice(0, 2) }, lookup, 'LAST_PURCHASE');
  assert.equal(complete.aluminaComplete, true);
});

test('B4. a product component is LOCAL, takes its own alumina, and has no price', () => {
  const a = c.componentAttributes('products', RECORDS['products:p1']);
  assert.equal(a.origin, 'LOCAL');
  assert.equal(a.aluminaPercentage, 40);
  assert.equal(a.lastPurchasePrice, null);
  assert.equal(c.componentAttributes('materials', null).found, false);
});

test('B5. a derived quantity is valued in the basis unit', () => {
  // 2.5% of 1000 kg = 25 kg at 25 / kg.
  const r = c.bomCosting(VERSION, lookup, 'LAST_PURCHASE');
  assert.equal(r.lines[2].unit, 'كجم');
  assert.equal(r.lines[2].quantity, 25);
});

// ==================================================
// C. THE ATTRIBUTES SCREEN
// ==================================================

test('C1. only the changed fields are written; a cleared field becomes null, never zero', () => {
  const original = c.draftFromMaterial(RECORDS['materials:m1']);
  assert.deepEqual(c.materialCostAttributesPatch(original, original, 'T'), {}, 'nothing changed, nothing written');
  const patch = c.materialCostAttributesPatch(original, { ...original, aluminaPercentage: '', origin: 'LOCAL' }, 'T');
  assert.deepEqual(patch, { aluminaPercentage: null, origin: 'LOCAL' }, 'no price changed, so no price date');
  const priced = c.materialCostAttributesPatch(original, { ...original, lastPurchasePrice: '19000' }, '2026-09-28T00:00:00Z');
  // 3.25.0: a typed price also records its source, beside the Excel import's.
  assert.deepEqual(priced, { lastPurchasePrice: 19000, pricesUpdatedAt: '2026-09-28T00:00:00Z', pricesSource: 'MANUAL' });
  for (const k of ['code', 'name', 'unit', 'active']) assert.equal(k in priced, false, `${k} is never touched`);
});

test('C2. validation refuses what cannot be right', () => {
  const units = ['طن', 'كجم'];
  const base = { aluminaPercentage: '', origin: '', lastPurchasePrice: '', averageIssuePrice: '', priceUnit: 'طن' };
  assert.deepEqual(c.validateMaterialCostAttributes(base, units), []);
  const bad = c.validateMaterialCostAttributes({ aluminaPercentage: '120', origin: 'ABROAD', lastPurchasePrice: '-1', averageIssuePrice: 'x', priceUnit: 'bucket' }, units);
  assert.deepEqual(bad.map((i: any) => i.field).sort(), ['aluminaPercentage', 'averageIssuePrice', 'lastPurchasePrice', 'origin', 'priceUnit']);
});

test('C3. the "missing only" filter reports what a material lacks', () => {
  assert.deepEqual(c.missingAttributes(RECORDS['materials:m1']), []);
  assert.deepEqual(c.missingAttributes(RECORDS['materials:m3']), ['aluminaPercentage', 'averageIssuePrice']);
  assert.deepEqual(c.missingAttributes({ code: 'X' }), ['aluminaPercentage', 'origin', 'lastPurchasePrice', 'averageIssuePrice']);
});

test('C4. the screen saves through the shared audited service, one bounded write per changed row, behind the edit gate', () => {
  const src = readCode(ATTRS);
  assert.ok(/await withTimeout\(updateMasterDataItem\(MASTER_DATA_COLLECTIONS\.materials, id, patch\), 30_000\);/.test(src));
  assert.ok(/const issues = validateMaterialCostAttributes\(drafts\[id\], BOM_UNITS\);/.test(src), 'validated before writing');
  assert.ok(/if \(!canEdit \|\| changedIds\.length === 0\) return;/.test(src), 'gated');
  assert.ok(/\{canEdit && \(\s*<button\s+id="bom-attributes-save-btn"/.test(src), 'no save button without the gate');
  for (const forbidden of ['setDoc', 'updateDoc(', 'writeBatch', 'deleteMasterDataItem']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not be used`);
  }
  const view = readCode(VIEW);
  assert.ok(/<BomComponentAttributesModal[\s\S]{0,200}canEdit=\{canImportMasterData\}/.test(view), 'the existing Master Data edit gate');
});

// ==================================================
// D. THE WINDOW AND THE PRINT
// ==================================================

test('D1. the window offers quantities only or cost, and the price basis', () => {
  const src = readCode(MODAL);
  assert.ok(/id=\{v === 'COST' \? 'bom-view-cost-btn' : 'bom-view-quantities-btn'\}/.test(src));
  assert.ok(/id="bom-price-basis"/.test(src));
  assert.ok(/const costing = draft \? bomCosting\(draft, lookupRecord, priceBasis\) : null;/.test(src));
  assert.ok(/\{isCostView && <th[^>]*>\{isAr \? 'قيمة الصنف \(ج\.م\)'/.test(src), 'the value column only in the cost view');
  assert.ok(/id="bom-cost-summary"/.test(src) && /id="bom-alumina-total"/.test(src));
});

test('D2. the columns read # / type / source / item code / item / alumina / % / quantity / unit / value', () => {
  const src = readSource(MODAL);
  const head = src.slice(src.indexOf('<table id="bom-component-lines"'), src.indexOf('</thead>', src.indexOf('<table id="bom-component-lines"')));
  const order = ["'النوع'", "'المصدر'", "'كود الصنف'", "'الصنف'", "'الألومينا %'", "'النسبة %'", "'الكمية /'", "'الوحدة'", "'قيمة الصنف (ج.م)'"];
  let at = -1;
  for (const label of order) {
    const next = head.indexOf(label, at + 1);
    assert.ok(next > at, `${label} must come after the previous column`);
    at = next;
  }
});

test('D3. the print follows the view: values and cost summary only in the cost view', () => {
  const base = {
    language: 'ar', bom: { code: 'B', name: 'n', itemSource: 'products', itemId: 'p1' }, version: VERSION,
    itemLabel: () => 'x', customerLabel: 'c', printedAt: 'now', lookup,
  };
  const qtyHtml = print.bomPrintHtml(print.buildBomPrintModel({ ...base, view: 'QUANTITIES' }));
  assert.equal(qtyHtml.includes('id="bom-print-cost"'), false);
  assert.equal(qtyHtml.includes('قيمة الصنف'), false);
  assert.ok(qtyHtml.includes('نسبة الألومينا الإجمالية'), 'the alumina total is always printed');
  const costModel = print.buildBomPrintModel({ ...base, view: 'COST', priceBasis: 'LAST_PURCHASE' });
  assert.deepEqual(costModel.lines.map((l: any) => l.code), ['M-ALU60', 'M-CR', 'M-BND']);
  assert.deepEqual(costModel.lines.map((l: any) => l.value), ['10,800.00', '3,600.00', '625.00']);
  assert.equal(costModel.costing.totalCost, '15,025.00');
  assert.equal(costModel.costing.importedValue, '10,800.00');
  assert.equal(costModel.summary.aluminaTotal, '40.80%');
  assert.ok(costModel.summary.aluminaNote.length > 0, 'marked incomplete, apart from the number');
  const costHtml = print.bomPrintHtml(costModel);
  assert.ok(costHtml.includes('id="bom-print-cost"') && costHtml.includes('قيمة الصنف (ج.م)'));
  assert.ok(costHtml.includes('<span class="origin">مستورد</span>'), 'an imported item is marked');
});

test('D4. the window prints with the view, price basis and records on screen', () => {
  const src = readCode(MODAL);
  assert.ok(/lookup: lookupRecord,\s*view,\s*priceBasis,/.test(src));
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

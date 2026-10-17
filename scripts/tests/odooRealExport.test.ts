/**
 * ODOO REAL-EXPORT COMPATIBILITY (3.26.1)
 *
 * The first real three-file export (mrp.production + mrp.workorder + stock.scrap) showed 1,461 errors
 * and 0 production rows to write. Three causes, each fixed here and pinned with rows shaped like the
 * real files:
 *  - the work-order sheet's only date column is "Scheduled Start Date" - it was not recognised;
 *  - the work-order sheet has NO unit column - the unit of the linked manufacturing order is used
 *    (an Odoo work order's quantity is in that unit), with no conversion and a visible warning;
 *  - centre names spelled differently from the approved ones ("المونة و الخرسانة", "الافران النفقية",
 *    "الفرز ز التغليف") are the same centres.
 * And what must NOT change: a unit that is written but unknown is refused, a piece-counting stage
 * still refuses a tonne quantity (no conversion), and an unknown centre still needs approval.
 *
 * Run: npx tsx scripts/tests/odooRealExport.test.ts
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0; let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => registered.push({ name, fn });
console.log('odooRealExport.test.ts');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
let wo: any; let prod: any; let session: any; let reg: any;
async function bootstrap() {
  wo = await load('src/services/odooWorkOrderReaderPure.ts');
  prod = await load('src/services/odooProductionReaderPure.ts');
  session = await load('src/services/odooImportSessionPure.ts');
  reg = await load('src/services/workCenterRegistryPure.ts');
}
const ctx = (f: string) => ({ importSessionId: 'S', fileName: f, sheetName: 'Sheet1' });

// Real shapes: the first row of each real file, trimmed to what matters.
const MO_ROW = {
  Reference: 'المونة والخرسانة/MO/00336', 'Product Template/Internal Reference': 'LCC8001', 'Finished Product': '[LCC8001] Castable LCC 80%',
  'Product Unit of Measure': 'Ton', 'Quantity To Produce': 2, 'Work Orders/Work Center': 'المونة و الخرسانة', 'Scheduled Date': 46023, 'Start Date': '', 'End Date': 46026.4,
};
const WO_ROW = {
  'Manufacturing Order': 'المونة والخرسانة/MO/00336', 'Scheduled Start Date': 46022.2987, Product: '[LCC8001] Castable LCC 80%', Quantity: 2,
  'Quantity To Be Produced': 0, Status: 'Finished', 'Work Center': 'المونة و الخرسانة', 'Work Order': '1', Employees: 'احمد',
};
const build = (workOrders: any[], production: any[] = [MO_ROW]) => {
  const p = prod.readMrpProduction(production, ctx('mo.xlsx'));
  const w = wo.readMrpWorkOrder(workOrders, ctx('wo.xlsx'), []);
  return session.buildOdooImportSession({ importSessionId: 'S', createdBy: 'u', createdAt: 'now', production: p.rows, workOrders: w.rows, scrap: [], approvedWorkCenters: [] });
};
const woRow = (built: any) => built.staged.find((s: any) => s.kind === 'odooWorkOrder');

test('A1. "Scheduled Start Date" is read as the work order\'s date', () => {
  const r = wo.readMrpWorkOrder([WO_ROW], ctx('wo.xlsx'), []).rows[0];
  assert.ok(r.normalized.date, 'a date was read');
  assert.equal(r.normalized.date.slice(0, 10), '2025-12-31', 'Excel serial 46022 is 31 Dec 2025');
  assert.equal(r.issues.some((i: any) => i.field === 'date'), false);
});

test('A2. the work-order sheet without a unit column no longer fails on the unit', () => {
  const built = build([WO_ROW]);
  assert.equal(built.counts.productionRowsToWrite, 1, 'one production record is ready to write');
  const row = woRow(built);
  assert.equal((row.row.errors ?? []).length, 0);
  assert.ok((row.row.warnings ?? []).some((w: any) => /أُخذت من أمر التصنيع/.test(w.messageAr)), 'and the row says where the unit came from');
});

test('A3. the inherited unit is the name table\'s, never a conversion: Ton -> طن, quantity untouched', () => {
  const row = woRow(build([WO_ROW]));
  assert.equal(row.payload?.productionUnit ?? row.payload?.unit ?? 'طن', 'طن');
  assert.equal(row.payload?.productionQuantity, 2);
});

test('A4. a work order whose manufacturing order is NOT in the files still has no unit and is refused', () => {
  const built = build([{ ...WO_ROW, 'Manufacturing Order': 'المونة والخرسانة/MO/09999' }]);
  assert.equal(built.counts.productionRowsToWrite, 0);
  assert.ok((woRow(built).row.errors ?? []).some((e: any) => e.field === 'unit'));
});

test('A5. a unit that IS written but unknown is still refused - the inheritance only fills an absent unit', () => {
  const built = build([{ ...WO_ROW, 'Unit of Measure': 'barrel' }]);
  assert.equal(built.counts.productionRowsToWrite, 0);
  assert.ok((woRow(built).row.errors ?? []).some((e: any) => e.field === 'unit'));
});

test('A6. a piece-counting stage still refuses a tonne quantity - nothing is converted', () => {
  const pressing = { ...WO_ROW, 'Work Center': 'مكبس بوخر 2' };
  const built = build([pressing], [{ ...MO_ROW, 'Work Orders/Work Center': 'مكبس بوخر 2' }]);
  assert.equal(built.counts.productionRowsToWrite, 0);
  assert.ok((woRow(built).row.errors ?? []).some((e: any) => /عدم تطابق الوحدة/.test(e.messageAr)));
});

test('B1. the real spellings of the approved centres resolve to them', () => {
  const id = (raw: string) => reg.resolveWorkCenter(raw, []).mainCenterId;
  assert.equal(id('المونة و الخرسانة'), 'mortar_concrete_center');
  assert.equal(id('الافران النفقية'), 'tunnel_kiln');
  assert.equal(id('الفرز ز التغليف'), 'sorting');
  assert.equal(id('الفرز و التغليف'), 'sorting');
});

test('B2. a centre nobody has approved is still unknown and still needs approval', () => {
  for (const raw of ['الهزازات', 'كسارات', 'اليدوى والشاكوش', 'كسارة رقم 12', 'هزاز الشلاوى']) {
    assert.equal(reg.resolveWorkCenter(raw, []).status, 'UNMAPPED_CENTER', raw);
  }
});

(async () => {
  await bootstrap();
  for (const { name, fn } of registered) {
    try { await fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (err: any) { console.log(`  FAIL  ${name}`); console.log(String(err?.message ?? err).split('\n').slice(0, 6).join('\n')); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

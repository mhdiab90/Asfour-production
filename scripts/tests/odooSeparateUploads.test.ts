/**
 * ODOO IMPORT - THE THREE FILES UPLOADED SEPARATELY (3.36.0).
 *
 * Any one of mrp.production / mrp.workorder (with its workers) / stock.scrap can be uploaded alone. What an
 * earlier upload staged is read back as CONTEXT so a later upload links by the same manufacturing-order
 * number, and everything that shares one number is collected per order.
 *
 *  S  staging -> carried context (newest wins, own session excluded, nothing invented)
 *  L  linking a lone upload to carried context (orphans, unit, stage, conflicts) - never re-staged, never written
 *  C  the per-order collection (sources, missing parts, one unit only)
 *  P  source pins: the loader only reads; the panel wires it in
 *
 * Run: npx tsx scripts/tests/odooSeparateUploads.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0; let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => registered.push({ name, fn });
console.log('odooSeparateUploads.test.ts');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
let wo: any; let prod: any; let scr: any; let session: any;
async function bootstrap() {
  wo = await load('src/services/odooWorkOrderReaderPure.ts');
  prod = await load('src/services/odooProductionReaderPure.ts');
  scr = await load('src/services/odooScrapReaderPure.ts');
  session = await load('src/services/odooImportSessionPure.ts');
}
const ctx = (id: string, f: string) => ({ importSessionId: id, fileName: f, sheetName: 'Sheet1' });

const MO_ROW = {
  Reference: 'المونة والخرسانة/MO/00336', 'Product Template/Internal Reference': 'LCC8001', 'Finished Product': '[LCC8001] Castable LCC 80%',
  'Product Unit of Measure': 'Ton', 'Quantity To Produce': 2, 'Work Orders/Work Center': 'المونة و الخرسانة', 'Scheduled Date': 46023, 'Start Date': '', 'End Date': 46026.4,
};
const WO_ROW = {
  'Manufacturing Order': 'المونة والخرسانة/MO/00336', 'Scheduled Start Date': 46022.2987, Product: '[LCC8001] Castable LCC 80%', Quantity: 2,
  'Quantity To Be Produced': 0, Status: 'Finished', 'Work Center': 'المونة و الخرسانة', 'Work Order': '1', Employees: 'احمد',
};
const SCRAP_ROW = { Reference: 'SP/00001', 'Manufacturing Order': 'المونة والخرسانة/MO/00336', Product: '[LCC8001] Castable LCC 80%', Quantity: 0.5, 'Unit of Measure': 'Ton', Date: 46030, 'Scrap Location': 'Virtual/Scrap' };

const readP = (id: string, rows: any[] = [MO_ROW]) => prod.readMrpProduction(rows, ctx(id, 'mo.xlsx')).rows;
const readW = (id: string, rows: any[] = [WO_ROW]) => wo.readMrpWorkOrder(rows, ctx(id, 'wo.xlsx'), []).rows;
const readS = (id: string, rows: any[] = [SCRAP_ROW]) => scr.readStockScrap(rows, ctx(id, 'scrap.xlsx')).rows;
const build = (id: string, input: any) => session.buildOdooImportSession({ importSessionId: id, createdBy: 'u', createdAt: 'now', production: [], workOrders: [], scrap: [], approvedWorkCenters: [], ...input });
/** What staging stores for a built session, in the fields the carried-context reader uses. */
const stored = (id: string, built: any) => built.staged.map((s: any) => ({
  importSessionId: id, rowId: s.row.rowId, sourceType: s.sourceType, rawRow: s.rawRow, normalizedRow: s.row.normalizedData, provenance: s.provenance,
}));

test('S1. a manufacturing-order-only upload is accepted and staged: context, nothing to write', () => {
  const built = build('ODOO-1', { production: readP('ODOO-1') });
  assert.equal(built.staged.length, 1);
  assert.equal(built.counts.productionRowsToWrite, 0);
  assert.equal(session.isOdooRowWritable(built.staged[0]), false);
});

test('S2. carried context: the newest session wins per order, and the session being built is excluded', () => {
  const older = build('ODOO-1', { production: readP('ODOO-1') });
  const newer = build('ODOO-2', { production: readP('ODOO-2', [{ ...MO_ROW, 'Quantity To Produce': 5 }]) });
  const c = session.carriedContextFromStaging([...stored('ODOO-1', older), ...stored('ODOO-2', newer)], 'ODOO-9');
  assert.equal(c.production.length, 1, 'one order, however many sessions staged it');
  assert.equal(c.production[0].normalized.quantityToProduce, 5, 'the newest session wins');
  const own = session.carriedContextFromStaging([...stored('ODOO-1', older), ...stored('ODOO-2', newer)], 'ODOO-2');
  assert.equal(own.production[0].normalized.quantityToProduce, 2, 'the session being built is not its own context');
});

test('S3. a staged row that never normalised is not context', () => {
  const c = session.carriedContextFromStaging([{ importSessionId: 'ODOO-1', rowId: 'x', sourceType: 'MRP_PRODUCTION', normalizedRow: null, provenance: {} }], 'ODOO-9');
  assert.deepEqual([c.production.length, c.workOrders.length, c.scrap.length], [0, 0, 0]);
});

test('L1. work orders alone: with no earlier upload the order is missing (tons assumed, 3.34.0)', () => {
  const built = build('ODOO-2', { workOrders: readW('ODOO-2') });
  const row = built.staged.find((s: any) => s.kind === 'odooWorkOrder');
  assert.ok(row.orphanKinds.includes('WORK_ORDER_WITHOUT_MO'));
  assert.ok(row.row.warnings.some((w: any) => /افتُرضت وحدة "طن"/.test(w.messageAr)));
});

test('L2. the same work orders, with the manufacturing orders uploaded EARLIER, link by order number', () => {
  const earlier = build('ODOO-1', { production: readP('ODOO-1') });
  const carried = session.carriedContextFromStaging(stored('ODOO-1', earlier), 'ODOO-2');
  const built = build('ODOO-2', { workOrders: readW('ODOO-2'), carried });
  const row = built.staged.find((s: any) => s.kind === 'odooWorkOrder');
  assert.equal(row.orphanKinds.includes('WORK_ORDER_WITHOUT_MO'), false, 'no longer without an order');
  assert.ok(row.row.warnings.some((w: any) => /أُخذت من أمر التصنيع/.test(w.messageAr)), 'the unit now comes from the linked order');
  assert.equal(row.row.warnings.some((w: any) => /افتُرضت/.test(w.messageAr)), false, 'and is not assumed');
  assert.equal(row.payload?.productionQuantity, 2);
  assert.equal(built.staged.length, 1, 'the carried order is NOT staged again');
  assert.equal(built.counts.productionRowsToWrite, 1);
});

test('L3. a carried order with no work order in this upload raises no finding of its own', () => {
  const earlier = build('ODOO-1', { production: readP('ODOO-1', [MO_ROW, { ...MO_ROW, Reference: 'المونة والخرسانة/MO/00999', 'Quantity To Produce': 9 }]) });
  const carried = session.carriedContextFromStaging(stored('ODOO-1', earlier), 'ODOO-2');
  assert.equal(carried.production.length, 2);
  const built = build('ODOO-2', { workOrders: readW('ODOO-2'), carried });
  assert.equal(built.link.orphans.some((o: any) => o.kind === 'MO_WITHOUT_WORK_ORDER'), false, 'the untouched order 00999 is not this upload\'s orphan');
  assert.equal(built.conflicts.some((c: any) => /00999/.test(String(c.logicalKey))), false);
});

test('L4. a manufacturing order in THIS upload always wins over a carried one', () => {
  const earlier = build('ODOO-1', { production: readP('ODOO-1', [{ ...MO_ROW, 'Quantity To Produce': 99 }]) });
  const carried = session.carriedContextFromStaging(stored('ODOO-1', earlier), 'ODOO-2');
  const built = build('ODOO-2', { production: readP('ODOO-2'), workOrders: readW('ODOO-2'), carried });
  const row = built.staged.find((s: any) => s.kind === 'odooWorkOrder');
  assert.equal(row.payload?.plannedQuantity, 2, 'the planned quantity is this upload\'s');
});

test('L5. scrap alone is accepted; its stage comes from work orders uploaded EARLIER', () => {
  const alone = build('ODOO-3', { scrap: readS('ODOO-3') });
  const s0 = alone.staged.find((s: any) => s.kind === 'odooScrap');
  assert.equal(session.isOdooRowWritable({ ...s0, row: { ...s0.row, selection: 'INCLUDED', warningsAccepted: true } }), true, 'a lone scrap row can be written');
  assert.equal(s0.targetStage, null);
  const earlier = build('ODOO-2', { production: readP('ODOO-2'), workOrders: readW('ODOO-2') });
  const carried = session.carriedContextFromStaging(stored('ODOO-2', earlier), 'ODOO-3');
  const linked = build('ODOO-3', { scrap: readS('ODOO-3'), carried });
  const s1 = linked.staged.find((s: any) => s.kind === 'odooScrap');
  assert.equal(s1.targetStage, 'mortar_concrete', 'the stage is taken from the earlier work order');
  assert.equal(linked.staged.length, 1);
});

test('C1. the per-order collection: parts, sources and what is still missing', () => {
  const earlier = build('ODOO-1', { production: readP('ODOO-1') });
  const carried = session.carriedContextFromStaging(stored('ODOO-1', earlier), 'ODOO-2');
  const out = session.consolidateByManufacturingOrder({ production: [], workOrders: readW('ODOO-2'), scrap: [], carried });
  assert.equal(out.length, 1);
  const o = out[0];
  assert.deepEqual([o.workOrders, o.workOrdersQuantity, o.workers, o.plannedQuantity], [1, 2, 1, 2]);
  assert.deepEqual(o.sources, { production: 'EARLIER', workOrders: 'THIS', scrap: 'NONE' });
  assert.deepEqual(o.missing, ['scrap']);
  const full = session.consolidateByManufacturingOrder({ production: [], workOrders: readW('ODOO-2'), scrap: readS('ODOO-2'), carried });
  assert.deepEqual([full[0].scrapQuantity, full[0].scrapUnit, full[0].missing.length], [0.5, 'طن', 0]);
});

test('C2. quantities add only within one unit - never a mixed sum - and scrap is never subtracted', () => {
  const rows = readW('ODOO-2', [WO_ROW, { ...WO_ROW, 'Work Order': '2', Quantity: 3, Employees: 'سعيد' }]);
  const o = session.consolidateByManufacturingOrder({ production: [], workOrders: rows, scrap: readS('ODOO-2') })[0];
  assert.equal(o.workOrdersQuantity, 5);
  assert.equal(o.workers, 2);
  assert.equal(o.scrapQuantity, 0.5, 'scrap is beside production, not taken out of it');
  const mixed = rows.map((r: any, i: number) => (i === 1 ? { ...r, normalized: { ...r.normalized, unit: 'قطعة' } } : r));
  assert.equal(session.consolidateByManufacturingOrder({ production: [], workOrders: mixed, scrap: [] })[0].workOrdersQuantity, null);
});

test('C3. a re-uploaded work order replaces its earlier copy instead of counting twice', () => {
  const earlier = build('ODOO-1', { workOrders: readW('ODOO-1') });
  const carried = session.carriedContextFromStaging(stored('ODOO-1', earlier), 'ODOO-2');
  const out = session.consolidateByManufacturingOrder({ production: [], workOrders: readW('ODOO-2'), scrap: [], carried })[0];
  assert.equal(out.workOrders, 1);
  assert.equal(out.sources.workOrders, 'THIS');
});

test('P1. the loader only reads staging; the panel wires it in and the order tab exists', () => {
  const svc = code('src/services/odooImportService.ts');
  const fn = svc.slice(svc.indexOf('export async function loadCarriedOdooContext'), svc.indexOf('/** The Work Center mappings a user approved'));
  assert.ok(/getDocs\(/.test(fn));
  assert.equal(/setDoc|addDoc|updateDoc|writeBatch|deleteDoc|safeSetDoc|safeAddDoc|safeUpdateDoc/.test(fn), false, 'read-only');
  const panel = code('src/components/admin/OdooHistoricalImportPanel.tsx');
  assert.ok(/loadCarriedOdooContext\(id, \{ production: !files\.MRP_PRODUCTION, workOrders: !files\.MRP_WORKORDER, scrap: !files\.STOCK_SCRAP \}\)/.test(panel), 'only the kinds NOT uploaded now are looked up');
  assert.ok(/carried: \{ production: carried\.production, workOrders: carried\.workOrders \}/.test(panel));
  for (const id of ['odoo-link-earlier', 'odoo-import-carried', 'odoo-import-by-order', 'odoo-import-separate-hint']) assert.ok(panel.includes(`id="${id}"`), id);
  assert.ok(/'byOrder'/.test(panel) && /Odoo_by_order_/.test(panel));
});

(async () => {
  await bootstrap();
  for (const { name, fn } of registered) {
    try { await fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (err: any) { console.log(`  FAIL  ${name}`); console.log(String(err?.message ?? err).split('\n').slice(0, 8).join('\n')); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

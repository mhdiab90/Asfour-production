/**
 * ODOO HISTORICAL IMPORT - three files - Phase 1 Step 8D.
 *
 * R  readers: mrp.production, mrp.workorder, stock.scrap
 * W  work centres: the registry, Arabic variants, machine names
 * L  linking: MO + work centre, orphans, conflicts, duplicate identity
 * E  employees: participation, share, team-only stages
 * S  safety: raw kept, planned never actual, no conversion, staged before write
 *
 * Run: npx tsx scripts/tests/odooHistoricalImport.test.ts
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

console.log('odooHistoricalImport.test.ts');

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

let wc: any;
let prodReader: any;
let woReader: any;
let scrapReader: any;
let linking: any;
let sessionPure: any;
let reports: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  wc = await load('src/services/workCenterRegistryPure.ts');
  prodReader = await load('src/services/odooProductionReaderPure.ts');
  woReader = await load('src/services/odooWorkOrderReaderPure.ts');
  scrapReader = await load('src/services/odooScrapReaderPure.ts');
  linking = await load('src/services/odooImportLinkingPure.ts');
  sessionPure = await load('src/services/odooImportSessionPure.ts');
  reports = await load('src/services/odooImportReportsPure.ts');
}

const ctx = (file: string) => ({ importSessionId: 'ODOO-TEST', fileName: file, sheetName: 'Sheet1' });

// --- fixtures: the three exports, as Odoo writes them ----------------------------------------

const productionRows = () => deepFreeze([
  {
    Reference: 'الطواحين الصيني/MO/00386-003', 'Product Template/Internal Reference': 'CHS3601251C', 'Finished Product': '[CHS3601251C] Chamotte 125 micron',
    'Quantity To Produce': 0, 'Product Unit of Measure': 'Ton', 'Scheduled Date': '2026-01-05', State: 'done',
    'Components/Product Template': '[CHS3600401] Chamotte 0-40mm', 'Components/Quantity Done': 60, 'Components/UoM': 'Ton', ID: '4711',
  },
  // A continuation row: another component of the SAME manufacturing order.
  {
    Reference: '', 'Product Template/Internal Reference': '', 'Finished Product': '', 'Quantity To Produce': '', 'Product Unit of Measure': '', 'Scheduled Date': '', State: '',
    'Components/Product Template': '[MAT-002] Additive', 'Components/Quantity Done': 2, 'Components/UoM': 'Kg', ID: '',
  },
  {
    Reference: 'الفرن النفقى/MO/01758', 'Product Template/Internal Reference': 'FBHA800404715', 'Finished Product': '[FBHA800404715] Under Burn Bricks',
    'Quantity To Produce': 10, 'Product Unit of Measure': 'Ton', 'Scheduled Date': '2026-01-06', State: 'done',
    'Components/Product Template': '', 'Components/Quantity Done': '', 'Components/UoM': '', ID: '4712',
  },
]);

const workOrderRows = () => deepFreeze([
  // Four real production rows of ONE manufacturing order: two shifts x two mills.
  { 'Manufacturing Order': 'الطواحين الصيني/MO/00386-003', 'Work Order': '1', 'Work Center': 'الطاحونه الصينيه رقم 1', Product: '[CHS3601251C] Chamotte 125 micron', Quantity: 14.95, 'Unit of Measure': 'Ton', Employee: 'أحمد', 'Real Duration': 60, State: 'done', Date: '2026-01-05', ID: '901' },
  { 'Manufacturing Order': 'الطواحين الصيني/MO/00386-003', 'Work Order': '1', 'Work Center': 'الطاحونه الصينيه رقم 2', Product: '[CHS3601251C] Chamotte 125 micron', Quantity: 14.95, 'Unit of Measure': 'Ton', Employee: 'سعيد', 'Real Duration': 60, State: 'done', Date: '2026-01-05', ID: '902' },
  { 'Manufacturing Order': 'الطواحين الصيني/MO/00386-003', 'Work Order': '2', 'Work Center': 'الطاحونه الصينيه رقم 1', Product: '[CHS3601251C] Chamotte 125 micron', Quantity: 14.95, 'Unit of Measure': 'Ton', Employee: 'محمود', 'Real Duration': 60, State: 'done', Date: '2026-01-05', ID: '903' },
  { 'Manufacturing Order': 'الطواحين الصيني/MO/00386-003', 'Work Order': '2', 'Work Center': 'الطاحونه الصينيه رقم 2', Product: '[CHS3601251C] Chamotte 125 micron', Quantity: 14.95, 'Unit of Measure': 'Ton', Employee: 'خالد', 'Real Duration': 60, State: 'done', Date: '2026-01-05', ID: '904' },
  // An employee-only row: it belongs to the work order above and carries no production.
  { 'Manufacturing Order': '', 'Work Order': '', 'Work Center': '', Product: '', Quantity: '', 'Unit of Measure': '', Employee: 'عمرو', 'Real Duration': '', State: '', ID: '' },
  // The tunnel kiln: one team, continuous operation, blank pause summary.
  { 'Manufacturing Order': 'الفرن النفقى/MO/01758', 'Work Order': 'حريق', 'Work Center': 'الفرن النفقى', Product: '[FBHA800404715] Under Burn Bricks', Quantity: 9.24, 'Unit of Measure': 'Ton', Employee: '', 'Real Duration': 1440, State: 'done', 'Pause Summary': '', Date: '2026-01-06', ID: '905' },
  // An orphan: its manufacturing order is not in mrp.production.
  { 'Manufacturing Order': 'كبس/MO/99999', 'Work Order': '1', 'Work Center': 'مكبس لايس 2000', Product: '[BHA1] Brick', Quantity: 500, 'Unit of Measure': 'Ton', Employee: 'سالم', 'Real Duration': 120, State: 'done', ID: '906' },
]);

const scrapRows = () => deepFreeze([
  { Date: '2026-01-05', 'Manufacturing Order': 'الطواحين الصيني/MO/00386-003', Product: '[CHS3601251C] Chamotte 125 micron', Quantity: 0.5, 'Unit of Measure': 'Ton', Reference: 'SP/00001', 'Scrap Location': 'Scrap', 'Source Location': 'WH/Stock', State: 'done', ID: '701' },
  { Date: '2026-01-05', 'Manufacturing Order': 'الطواحين الصيني/MO/00386-003', Product: '[CHS3601251C] Chamotte 125 micron', Quantity: 0.25, 'Unit of Measure': 'Ton', Reference: 'SP/00002', 'Scrap Location': 'Scrap', 'Source Location': 'WH/Stock', State: 'done', ID: '702' },
  { Date: '2026-01-07', 'Manufacturing Order': 'MO/NOT-IN-FILE', Product: '[X] X', Quantity: 1, 'Unit of Measure': 'Ton', Reference: 'SP/00003', 'Scrap Location': 'Scrap', 'Source Location': 'WH/Stock', State: 'done', ID: '703' },
]);

const readAll = () => {
  const production = prodReader.readMrpProduction(productionRows(), ctx('mrp.production.xlsx'));
  const workOrders = woReader.readMrpWorkOrder(workOrderRows(), ctx('mrp.workorder.xlsx'));
  const scrap = scrapReader.readStockScrap(scrapRows(), ctx('stock.scrap.xlsx'));
  return { production, workOrders, scrap };
};

const buildSession = () => {
  const { production, workOrders, scrap } = readAll();
  return sessionPure.buildOdooImportSession({
    importSessionId: 'ODOO-TEST',
    createdBy: 'tester',
    createdAt: '2026-01-10T00:00:00.000Z',
    production: production.rows,
    workOrders: workOrders.rows,
    scrap: scrap.rows,
  });
};

// ==================================================
// W. WORK CENTRES
// ==================================================

test('1. the approved Work Center mapping resolves exactly as the business gave it', () => {
  const cases: Array<[string, string]> = [
    ['CM', 'chinese_mills'],
    ['الطواحين الصيني', 'chinese_mills'],
    ['السرد', 'sard'],
    ['فرز', 'sorting'],
    ['الصب والفوم', 'casting_foam_center'],
    ['الفرن الدوار', 'rotary_furnace'],
    ['المونة والخرسانة', 'mortar_concrete_center'],
    ['الفرن النفقى', 'tunnel_kiln'],
    ['الفرن النفقي', 'tunnel_kiln'],
    ['كبس', 'pressing'],
    ['خلط', 'mixing'],
    ['الطواحين العاديه', 'tube_ball_mills'],
  ];
  for (const [raw, centerId] of cases) {
    const r = wc.resolveWorkCenter(raw);
    assert.equal(r.mainCenterId, centerId, raw);
    assert.equal(r.raw, raw, 'the raw text is never replaced');
  }
});

test('2. Arabic spelling variants are the same centre; an unknown name is never guessed', () => {
  for (const raw of ['الفرن النفقي', 'الفرن النفقى', 'الفرن  النفقي ', 'الفرن النفقى']) {
    assert.equal(wc.resolveWorkCenter(raw).mainCenterId, 'tunnel_kiln', raw);
  }
  assert.equal(wc.resolveWorkCenter('الطواحين العادية').mainCenterId, 'tube_ball_mills');
  const unknown = wc.resolveWorkCenter('ورشة غير معروفة');
  assert.deepEqual([unknown.mainCenterId, unknown.status, unknown.rule], [null, 'UNMAPPED_CENTER', 'NO_ALIAS_MATCHED']);
  assert.equal(wc.resolveWorkCenter('').status, 'EMPTY');
});

test('3. a machine name keeps its machine and still names its centre', () => {
  const mill1 = wc.resolveWorkCenter('الطاحونه الصينيه رقم 1');
  const mill2 = wc.resolveWorkCenter('الطاحونه الصينيه رقم 2');
  assert.deepEqual([mill1.mainCenterId, mill1.equipmentName], ['chinese_mills', 'الطاحونه الصينيه رقم 1']);
  assert.deepEqual([mill2.mainCenterId, mill2.equipmentName], ['chinese_mills', 'الطاحونه الصينيه رقم 2']);
  assert.notEqual(mill1.equipmentName, mill2.equipmentName, 'two mills of one centre stay distinguishable');
  for (const press of ['مكبس بوخر 1', 'مكبس بوخر 2', 'مكبس 1600', 'مكبس لايس 2000', 'مكبس لايس 400', 'مكبس صيني 400', 'مكبس فركشن 3', 'مكبس توجل 5']) {
    const r = wc.resolveWorkCenter(press);
    assert.equal(r.mainCenterId, 'pressing', press);
    assert.equal(r.equipmentName, press, 'the detailed machine name is preserved');
  }
});

test('4. mills: the normal-mills centre keeps TUBE / BALL only when the text says it', () => {
  const ball = wc.resolveWorkCenter('الطواحين الكرويه (بول ميل)');
  const tube = wc.resolveWorkCenter('طواحين اسطوانيه (تيوب ميل)');
  assert.deepEqual([ball.mainCenterId, ball.millKind], ['tube_ball_mills', 'BALL']);
  assert.deepEqual([tube.mainCenterId, tube.millKind], ['tube_ball_mills', 'TUBE']);
  assert.equal(wc.resolveWorkCenter('الطواحين العاديه').millKind, null, 'never inferred');
});

test('5. the two missing centres exist and have no stage of their own', () => {
  const sard = wc.resolveWorkCenter('السرد');
  assert.deepEqual([sard.mainCenterId, sard.stageType, sard.status], ['sard', null, 'NO_STAGE_MAPPING']);
  assert.equal(wc.workCenterById('sard').parentCenterId, 'rotary_furnace');
  const casting = wc.resolveWorkCenter('الصب والفوم');
  assert.deepEqual([casting.mainCenterNameAr, casting.stageType, casting.status], ['مركز الصب والفرم', null, 'NO_STAGE_MAPPING']);
  assert.equal(wc.workCenterIsWritable(sard), false, 'no production is written into a centre nobody mapped');
  // Existing stage ids are reused as centre ids - no production centre was renamed.
  for (const id of ['pressing', 'mixing', 'chinese_mills', 'tube_ball_mills', 'tunnel_kiln', 'rotary_furnace', 'sorting']) {
    assert.equal(wc.workCenterById(id).stageType, id, id);
  }
});

test('6. an approved mapping resolves a name the registry does not know - and nothing else does', () => {
  const approved = [{ rawNormalized: wc.normaliseWorkCenterText('ورشة غير معروفة'), mainCenterId: 'mixing', equipmentName: 'ورشة غير معروفة', active: true }];
  const r = wc.resolveWorkCenter('ورشة غير معروفة', approved);
  assert.deepEqual([r.mainCenterId, r.rule, r.stageType], ['mixing', 'APPROVED_MAPPING', 'mixing']);
  assert.equal(wc.resolveWorkCenter('ورشة أخرى', approved).status, 'UNMAPPED_CENTER');
});

// ==================================================
// R. READERS
// ==================================================

test('7. mrp.production: many rows make ONE manufacturing order, with its components', () => {
  const result = prodReader.readMrpProduction(productionRows(), ctx('mrp.production.xlsx'));
  assert.deepEqual(result.counts, { manufacturingOrders: 2, sourceRows: 3, components: 2, continuationBeforeMo: 0 });
  const mo = result.rows[0].normalized;
  assert.equal(mo.moReference, 'الطواحين الصيني/MO/00386-003');
  assert.deepEqual(mo.components.map((c: any) => [c.code, c.quantity, c.unit]), [['CHS3600401', 60, 'طن'], ['MAT-002', 2, 'كجم']]);
  assert.deepEqual(mo.sourceRows, [2, 3], 'every contributing Excel row is kept');
  assert.equal(result.rows[0].raw.Reference, 'الطواحين الصيني/MO/00386-003', 'the raw row is kept');
});

test('8. mrp.production: quantity to produce is PLANNED - 0 never becomes actual production', () => {
  const result = prodReader.readMrpProduction(productionRows(), ctx('mrp.production.xlsx'));
  const mo = result.rows[0].normalized;
  assert.equal(mo.quantityToProduce, 0, 'the planned figure is kept as it is');
  assert.equal(mo.producedQuantity, null, 'this export carries no actual quantity');
  assert.ok(result.rows[0].warnings.some((w: any) => /planned quantity is never used as actual/i.test(w.messageEn)));
  const staged = buildSession().staged.find((s: any) => s.kind === 'odooProduction');
  assert.equal(staged.row.selection, 'EXCLUDED', 'a manufacturing order row is context, never a production record');
});

test('9. mrp.workorder: work centre, machine, employees and durations are read; the raw text stays', () => {
  const result = woReader.readMrpWorkOrder(workOrderRows(), ctx('mrp.workorder.xlsx'));
  assert.equal(result.counts.workOrders, 6);
  const first = result.rows[0].normalized;
  assert.equal(first.workCenterRaw, 'الطاحونه الصينيه رقم 1');
  assert.equal(first.workCenter.mainCenterId, 'chinese_mills');
  assert.equal(first.equipmentRaw, 'الطاحونه الصينيه رقم 1');
  assert.deepEqual([first.quantity, first.unit, first.realDuration], [14.95, 'طن', 60]);
  assert.deepEqual(first.employees.map((e: any) => e.employeeName), ['أحمد']);
  assert.equal(first.rawWorkOrder, '1');
});

test('10. stock.scrap: every row is its own scrap record, many per MO', () => {
  const result = scrapReader.readStockScrap(scrapRows(), ctx('stock.scrap.xlsx'));
  assert.equal(result.counts.scrapRows, 3);
  const [a, b] = result.rows;
  assert.deepEqual([a.normalized.quantity, a.normalized.unit, a.normalized.reference], [0.5, 'طن', 'SP/00001']);
  assert.deepEqual([b.normalized.quantity, b.normalized.reference], [0.25, 'SP/00002']);
  assert.equal(a.normalized.moReference, b.normalized.moReference, 'two scrap rows of one MO are both kept');
  assert.deepEqual([a.normalized.scrapLocation, a.normalized.sourceLocation, a.normalized.state], ['Scrap', 'WH/Stock', 'done']);
  assert.equal(a.normalized.date, '2026-01-05');
});

test('11. a required column that is missing blocks the sheet, not a row', () => {
  const result = woReader.readMrpWorkOrder([{ Something: 1 }], ctx('mrp.workorder.xlsx'));
  assert.deepEqual(result.mapping.missingRequired, ['moReference', 'workCenterRaw']);
  assert.equal(result.rows.length, 0);
  assert.equal(result.sheetIssues.length, 2);
});

// ==================================================
// L. LINKING, CONFLICTS, ORPHANS, IDENTITY
// ==================================================

test('12. the three files link on the manufacturing order', () => {
  const { production, workOrders, scrap } = readAll();
  const link = linking.linkOdooSources({ production: production.rows, workOrders: workOrders.rows, scrap: scrap.rows });
  const chinese = link.links.find((l: any) => l.moReference === 'الطواحين الصيني/MO/00386-003');
  assert.equal(chinese.workOrderRowIds.length, 4);
  assert.equal(chinese.scrapRowIds.length, 2);
  assert.ok(chinese.productionRowId);
  assert.equal(link.counts.linkedWorkOrders, 5);
  assert.equal(link.counts.linkedScrapRows, 2);
});

test('13. CHINESE MILLS: four rows of one MO stay four records, never collapsed', () => {
  const session = buildSession();
  const rows = session.staged.filter((s: any) => s.kind === 'odooWorkOrder' && s.linkedManufacturingOrder === 'الطواحين الصيني/MO/00386-003');
  assert.equal(rows.length, 4);
  const keys = new Set(rows.map((r: any) => r.identityKey));
  assert.equal(keys.size, 4, 'work centre and shift are part of the identity');
  assert.equal(session.link.duplicateGroups.length, 0, 'these are additional production, not duplicates');
  const total = rows.reduce((sum: number, r: any) => sum + Number(r.payload.quantity), 0);
  assert.equal(Number(total.toFixed(2)), 59.8);
  for (const r of rows) assert.equal(r.payload.quantity, 14.95, 'nothing is summed into one record');
});

test('14. duplicate identity: only a row identical in every part is a duplicate', () => {
  const base = { moReference: 'MO/1', productCode: 'P1', mainCenterId: 'chinese_mills', equipmentName: 'mill 1', workOrderKey: 'shift:1', odooId: '1' };
  assert.equal(linking.productionIdentityKey(base), linking.productionIdentityKey({ ...base }));
  assert.notEqual(linking.productionIdentityKey(base), linking.productionIdentityKey({ ...base, equipmentName: 'mill 2' }));
  assert.notEqual(linking.productionIdentityKey(base), linking.productionIdentityKey({ ...base, workOrderKey: 'shift:2' }));
  assert.notEqual(linking.productionIdentityKey(base), linking.productionIdentityKey({ ...base, mainCenterId: 'pressing' }));
  // The old date+product+batch key is NOT what decides identity here.
  const code = readCode('src/services/odooImportLinkingPure.ts');
  assert.ok(/mainCenterId/.test(code) && /workOrderKey/.test(code));
});

test('15. a repeated identity is reported, never merged', () => {
  const rows = [workOrderRows()[0], { ...workOrderRows()[0] }];
  const result = woReader.readMrpWorkOrder(rows, ctx('mrp.workorder.xlsx'));
  const link = linking.linkOdooSources({ production: [], workOrders: result.rows, scrap: [] });
  assert.equal(link.duplicateGroups.length, 1);
  assert.equal(link.duplicateGroups[0].rowIds.length, 2);
  assert.equal(result.rows.length, 2, 'both rows stay - nothing is dropped');
});

test('16. an orphan work order and an orphan scrap row are reported, never attached or dropped', () => {
  const session = buildSession();
  const kinds = session.link.orphans.map((o: any) => o.kind);
  assert.ok(kinds.includes('WORK_ORDER_WITHOUT_MO'));
  assert.ok(kinds.includes('SCRAP_WITHOUT_MO'));
  const orphanWo = session.staged.find((s: any) => s.linkedManufacturingOrder === 'كبس/MO/99999');
  assert.ok(orphanWo, 'the orphan row is still in the session');
  assert.ok(orphanWo.orphanKinds.includes('WORK_ORDER_WITHOUT_MO'));
  const orphanScrap = session.staged.find((s: any) => s.kind === 'odooScrap' && s.linkedManufacturingOrder === 'MO/NOT-IN-FILE');
  assert.ok(orphanScrap.orphanKinds.includes('SCRAP_WITHOUT_MO'));
});

test('17. an unresolved work centre is an orphan and its production is never written', () => {
  const rows = [{ 'Manufacturing Order': 'MO/1', 'Work Order': '1', 'Work Center': 'ورشة مجهولة', Product: '[P1] P', Quantity: 5, 'Unit of Measure': 'Ton' }];
  const result = woReader.readMrpWorkOrder(rows, ctx('mrp.workorder.xlsx'));
  assert.ok(result.rows[0].issues.some((i: any) => /not in the registry/.test(i.messageEn)));
  const link = linking.linkOdooSources({ production: [], workOrders: result.rows, scrap: [] });
  assert.ok(link.orphans.some((o: any) => o.kind === 'UNRESOLVED_WORK_CENTER'));
  const built = sessionPure.productionPayloadFromWorkOrder(result.rows[0], null, { attachComponents: false });
  assert.equal(built.payload, null);
});

test('18. a conflict between two files keeps BOTH values and decides nothing', () => {
  const production = prodReader.readMrpProduction([
    { Reference: 'MO/1', 'Product Template/Internal Reference': 'P1', 'Finished Product': '[P1] P', 'Quantity Produced': 100, 'Product Unit of Measure': 'Ton', 'Scheduled Date': '2026-01-05' },
  ], ctx('mrp.production.xlsx'));
  const workOrders = woReader.readMrpWorkOrder([
    { 'Manufacturing Order': 'MO/1', 'Work Order': '1', 'Work Center': 'خلط', Product: '[P1] P', Quantity: 95, 'Unit of Measure': 'Ton' },
  ], ctx('mrp.workorder.xlsx'));
  const link = linking.linkOdooSources({ production: production.rows, workOrders: workOrders.rows, scrap: [] });
  const quantity = link.conflicts.find((c: any) => c.field === 'quantity');
  assert.ok(quantity, 'the disagreement is recorded');
  assert.deepEqual([quantity.valueA, quantity.valueB], [100, 95]);
  assert.deepEqual([quantity.sourceA, quantity.sourceB], ['MRP_PRODUCTION', 'MRP_WORKORDER']);
  assert.deepEqual([quantity.severity, quantity.resolutionStatus], ['WARNING', 'OPEN']);
  assert.equal(quantity.fileA, 'mrp.production.xlsx');
  assert.equal(quantity.fileB, 'mrp.workorder.xlsx');
  assert.equal(production.rows[0].normalized.producedQuantity, 100, 'neither value was overwritten');
  assert.equal(workOrders.rows[0].normalized.quantity, 95);
});

test('19. a conflicting product or unit blocks the row; a quantity conflict is reviewable', () => {
  const production = prodReader.readMrpProduction([
    { Reference: 'MO/1', 'Product Template/Internal Reference': 'P1', 'Finished Product': '[P1] P', 'Quantity Produced': 10, 'Product Unit of Measure': 'Ton', 'Scheduled Date': '2026-01-05' },
  ], ctx('mrp.production.xlsx'));
  const workOrders = woReader.readMrpWorkOrder([
    { 'Manufacturing Order': 'MO/1', 'Work Order': '1', 'Work Center': 'خلط', Product: '[P2] Other', Quantity: 10, 'Unit of Measure': 'Ton' },
  ], ctx('mrp.workorder.xlsx'));
  const session = sessionPure.buildOdooImportSession({ importSessionId: 'S', createdBy: 'x', createdAt: 'x', production: production.rows, workOrders: workOrders.rows, scrap: [] });
  const wo = session.staged.find((s: any) => s.kind === 'odooWorkOrder');
  assert.ok(wo.row.errors.some((e: any) => /conflict\.productCode/.test(e.field)));
  assert.equal(sessionPure.isOdooRowWritable(wo), false, 'a blocking conflict is never written');
});

// ==================================================
// E. EMPLOYEES
// ==================================================

test('20. an employee-only row adds participation and NEVER production', () => {
  const result = woReader.readMrpWorkOrder(workOrderRows(), ctx('mrp.workorder.xlsx'));
  assert.equal(result.counts.employeeOnlyRows, 1);
  assert.equal(result.counts.workOrders, 6, 'the employee row created no work order');
  const fourth = result.rows[3].normalized;
  assert.deepEqual(fourth.employees.map((e: any) => e.employeeName), ['خالد', 'عمرو']);
  assert.deepEqual(fourth.employeeOnlyRows, [6]);
  assert.equal(fourth.quantity, 14.95, 'the quantity is still the one the production row carried');
});

test('21. participation lists the orders with the order\'s OWN total - never divided', () => {
  const orders = [
    { id: 'w1', manufacturingOrderNumber: 'MO/1', stageType: 'chinese_mills', quantity: 14.95, unit: 'طن', employees: [{ employeeId: '', employeeCode: '', employeeName: 'أحمد' }] },
    { id: 'w2', manufacturingOrderNumber: 'MO/1', stageType: 'chinese_mills', quantity: 14.95, unit: 'طن', employees: [{ employeeId: '', employeeCode: '', employeeName: 'سعيد' }] },
    { id: 'w3', manufacturingOrderNumber: 'MO/1', stageType: 'chinese_mills', quantity: 14.95, unit: 'طن', employees: [{ employeeId: '', employeeCode: '', employeeName: 'محمود' }] },
    { id: 'w4', manufacturingOrderNumber: 'MO/1', stageType: 'chinese_mills', quantity: 14.95, unit: 'طن', employees: [{ employeeId: '', employeeCode: '', employeeName: 'خالد' }] },
  ];
  const participation = reports.employeeParticipation(orders);
  assert.equal(participation.length, 4);
  const ahmed = participation.find((p: any) => p.employeeName === 'أحمد');
  assert.equal(ahmed.orders.length, 1);
  assert.equal(ahmed.orders[0].orderTotalQuantity, 59.8, 'the order total, not a share');
  assert.equal(ahmed.orders[0].unit, 'طن');
});

test('22. employee share is total / participants - analytical only', () => {
  const orders = ['أحمد', 'سعيد', 'محمود', 'خالد'].map((name, i) => ({
    id: `w${i}`, manufacturingOrderNumber: 'MO/1', stageType: 'chinese_mills', quantity: 14.95, unit: 'طن',
    employees: [{ employeeId: '', employeeCode: '', employeeName: name }],
  }));
  const share = reports.employeeShare(orders);
  assert.equal(share.length, 1);
  assert.deepEqual([share[0].orderTotalQuantity, share[0].participantCount, share[0].sharePerEmployee], [59.8, 4, 14.95]);
  assert.equal(share[0].note, reports.EMPLOYEE_SHARE_NOTE);
  assert.ok(/ANALYTICAL ONLY/.test(reports.EMPLOYEE_SHARE_NOTE));
  // Nothing in the reports module writes.
  const code = readCode('src/services/odooImportReportsPure.ts');
  assert.equal(/addDoc|setDoc|updateDoc|firebase|fetchMasterData/.test(code), false);
  // A head count is never assumed.
  const noEmployees = reports.employeeShare([{ id: 'w', manufacturingOrderNumber: 'MO/2', stageType: 'chinese_mills', quantity: 10, unit: 'طن', employees: [] }]);
  assert.equal(noEmployees[0].sharePerEmployee, null);
});

test('23. sorting and the tunnel kiln are one team: no participation, no share, no invented workers', () => {
  assert.deepEqual([...sessionPure.EMPLOYEE_PARTICIPATION_STAGES], ['pressing', 'chinese_mills', 'mixing']);
  assert.deepEqual([...sessionPure.TEAM_ONLY_STAGES], ['sorting', 'tunnel_kiln']);
  for (const stage of ['sorting', 'tunnel_kiln']) {
    assert.equal(sessionPure.recordsEmployeeParticipation(stage), false, stage);
    const orders = [{ id: 'w', manufacturingOrderNumber: 'MO/9', stageType: stage, quantity: 5, unit: 'طن', employees: [{ employeeId: '', employeeCode: '', employeeName: 'فريق' }] }];
    assert.deepEqual(reports.employeeParticipation(orders), []);
    assert.deepEqual(reports.employeeShare(orders), []);
  }
  const sortingRow = woReader.readMrpWorkOrder(
    [{ 'Manufacturing Order': 'MO/9', 'Work Order': 'فرز', 'Work Center': 'فرز', Product: '[P] P', Quantity: 5, 'Unit of Measure': 'Ton', Employee: 'عامل', Date: '2026-01-05' }],
    ctx('mrp.workorder.xlsx'),
  ).rows[0];
  const built = sessionPure.productionPayloadFromWorkOrder(sortingRow, null, { attachComponents: false });
  assert.equal(built.payload?.workers, undefined, 'no employee participation is written for sorting');
  // Sorting counts pieces and this source gives tons, so the row is blocked before anything is written.
  assert.ok(built.errors.some((e: any) => /Unit mismatch/.test(e.messageEn)));
  // The tunnel kiln's unit does match, so its team rule is what holds the employees back.
  const kilnRow = woReader.readMrpWorkOrder(
    [{ 'Manufacturing Order': 'MO/8', 'Work Order': 'حريق', 'Work Center': 'الفرن النفقى', Product: '[P] P', Quantity: 9, 'Unit of Measure': 'Ton', Employee: 'عامل', Date: '2026-01-05' }],
    ctx('mrp.workorder.xlsx'),
  ).rows[0];
  const kilnBuilt = sessionPure.productionPayloadFromWorkOrder(kilnRow, null, { attachComponents: false });
  assert.equal(kilnBuilt.payload.workers, undefined, 'a team stage writes no individual participation');
  assert.ok(kilnBuilt.warnings.some((w: any) => /one team/.test(w.messageEn)));
  assert.deepEqual(kilnRow.normalized.employees.map((e: any) => e.employeeName), ['عامل'], 'the source value is still kept on the work order');
});

// ==================================================
// S. SAFETY
// ==================================================

test('24. a work order is not a shift: only the centres whose source numbers it get one', () => {
  assert.deepEqual([...woReader.WORK_ORDER_IS_SHIFT_CENTERS], ['chinese_mills', 'pressing', 'sard']);
  assert.equal(woReader.shiftFromWorkOrder('chinese_mills', '2'), 2);
  assert.equal(woReader.shiftFromWorkOrder('pressing', '1'), 1);
  assert.equal(woReader.shiftFromWorkOrder('sorting', '1'), null, 'sorting text is never a shift');
  assert.equal(woReader.shiftFromWorkOrder('tunnel_kiln', 'حريق'), null);
  assert.equal(woReader.shiftFromWorkOrder('mixing', 'خلطة 3'), null, 'mixing text stays raw');
  const kiln = woReader.readMrpWorkOrder(workOrderRows(), ctx('f')).rows[4].normalized;
  assert.deepEqual([kiln.rawWorkOrder, kiln.shiftNumber], ['حريق', null], 'the raw value is never rewritten');
});

test('25. the tunnel kiln is continuous: a blank pause summary is the rule, not unknown downtime', () => {
  assert.equal(sessionPure.stageOperationalRule('tunnel_kiln'), 'CONTINUOUS_NO_DOWNTIME');
  assert.equal(sessionPure.stageOperationalRule('mixing'), 'STANDARD');
  const kiln = woReader.readMrpWorkOrder(workOrderRows(), ctx('f')).rows[4];
  const built = sessionPure.productionPayloadFromWorkOrder(kiln, null, { attachComponents: false });
  assert.equal(built.payload.operationalRule, 'CONTINUOUS_NO_DOWNTIME');
  assert.ok(built.warnings.some((w: any) => /not unknown downtime/.test(w.messageEn)));
  const code = readCode('src/services/odooImportSessionPure.ts');
  assert.equal(/downtimeMinutes:\s*0|pauseCount|invented/.test(code), false, 'no pause record is invented');
});

test('26. units are never converted: a stage that counts pieces refuses a tonne quantity', () => {
  const press = woReader.readMrpWorkOrder(
    [{ 'Manufacturing Order': 'MO/5', 'Work Order': '1', 'Work Center': 'مكبس 1600', Product: '[P] P', Quantity: 500, 'Unit of Measure': 'Ton', Date: '2026-01-05' }],
    ctx('mrp.workorder.xlsx'),
  ).rows[0];
  const built = sessionPure.productionPayloadFromWorkOrder(press, null, { attachComponents: false });
  assert.equal(built.payload, null);
  assert.ok(built.errors.some((e: any) => /Unit mismatch/.test(e.messageEn) && /nothing is converted/.test(e.messageEn)));
  // and it blocks only itself - the mixing row beside it is still writable.
  const mixing = woReader.readMrpWorkOrder(
    [{ 'Manufacturing Order': 'MO/6', 'Work Order': 'خلطة', 'Work Center': 'خلط', Product: '[P] P', Quantity: 3, 'Unit of Measure': 'Ton', Date: '2026-01-05' }],
    ctx('mrp.workorder.xlsx'),
  ).rows[0];
  assert.equal(sessionPure.productionPayloadFromWorkOrder(mixing, null, { attachComponents: false }).payload?.productionQuantity, 3);
  const unknown = scrapReader.readStockScrap([{ Date: '2026-01-05', Quantity: 1, 'Unit of Measure': 'Bag' }], ctx('stock.scrap.xlsx')).rows[0];
  assert.ok(unknown.issues.some((i: any) => /nothing is converted/.test(i.messageEn)));
});

test('27. scrap: stock.scrap is the only source, and the others only cross-check it', () => {
  const production = prodReader.readMrpProduction([
    { Reference: 'MO/1', 'Product Template/Internal Reference': 'P1', 'Finished Product': '[P1] P', 'Quantity Produced': 10, 'Product Unit of Measure': 'Ton', 'Scheduled Date': '2026-01-05', 'Scraps/Quantity': 2, 'Scraps/Product': '[P1] P' },
  ], ctx('mrp.production.xlsx'));
  assert.equal(production.rows[0].normalized.scrapCrossCheck.length, 1, 'read as a cross-check');
  const session = sessionPure.buildOdooImportSession({ importSessionId: 'S', createdBy: 'x', createdAt: 'x', production: production.rows, workOrders: [], scrap: [] });
  assert.equal(session.staged.filter((s: any) => s.kind === 'odooScrap').length, 0, 'no scrap record is created from mrp.production');
  const mismatch = session.conflicts.find((c: any) => c.field === 'scrapQuantity');
  assert.ok(mismatch && /never created from a non-primary source/.test(mismatch.messageEn));
  // Two stock.scrap rows of one MO both become records.
  const full = buildSession();
  const scrapRowsStaged = full.staged.filter((s: any) => s.kind === 'odooScrap' && s.linkedManufacturingOrder === 'الطواحين الصيني/MO/00386-003');
  assert.equal(scrapRowsStaged.length, 2);
  assert.deepEqual(scrapRowsStaged.map((s: any) => s.payload.quantity), [0.5, 0.25], 'never summed, never merged');
  // Scrap is not subtracted from production anywhere in this feature.
  const code = readCode('src/services/odooImportSessionPure.ts') + readCode('src/services/odooImportReportsPure.ts') + readCode('src/services/odooImportLinkingPure.ts');
  assert.equal(/production\s*-\s*scrap|quantity\s*-\s*scrap/i.test(code), false);
});

test('28. external Odoo ids are kept as external references, never as an ASFOUR id', () => {
  const session = buildSession();
  const wo = session.staged.find((s: any) => s.kind === 'odooWorkOrder' && s.payload);
  const refs = wo.payload.externalRefs as any[];
  assert.ok(refs.some((r) => r.system === 'odoo' && r.model === 'mrp.workorder' && r.externalId === '901'));
  assert.ok(refs.some((r) => r.system === 'odoo' && r.model === 'mrp.production' && r.externalId === '4711'));
  assert.equal(wo.payload.id, undefined, 'an Odoo id is never the document id');
  const scrap = session.staged.find((s: any) => s.kind === 'odooScrap' && s.payload);
  assert.deepEqual((scrap.payload.externalRefs as any[])[0], { system: 'odoo', model: 'stock.scrap', externalId: '701', externalCode: 'SP/00001' });
  const types = readCode('src/types/index.ts');
  assert.ok(/export interface WorkOrderRecord extends WithExternalReferences/.test(types));
  assert.ok(/export interface ScrapRecord extends WithExternalReferences/.test(types));
});

test('29. provenance: every staged row names its file, sheet, row and session', () => {
  const session = buildSession();
  for (const item of session.staged) {
    assert.equal(item.provenance.importSessionId, 'ODOO-TEST');
    assert.equal(item.provenance.sourceSystem, 'odoo');
    assert.ok(item.provenance.sourceRow >= 2, 'the Excel row number is kept');
    assert.ok(['mrp.production.xlsx', 'mrp.workorder.xlsx', 'stock.scrap.xlsx'].includes(item.provenance.sourceFile));
    assert.equal(item.provenance.sourceSheet, 'Sheet1');
  }
  const wo = session.staged.find((s: any) => s.kind === 'odooWorkOrder');
  assert.ok(wo.provenance.normalizationRule, 'the work-centre rule that produced the value is recorded');
  const report = reports.provenanceReport([{ id: 'x', provenance: wo.provenance }]);
  assert.deepEqual([report[0].recordId, report[0].sourceType], ['x', 'MRP_WORKORDER']);
});

test('30. raw is kept beside normalised, and a correction never overwrites the original', () => {
  const session = buildSession();
  const item = session.staged.find((s: any) => s.kind === 'odooWorkOrder');
  assert.equal(item.rawRow['Work Center'], 'الطاحونه الصينيه رقم 1');
  assert.equal(item.row.originalRowData['Work Center'], 'الطاحونه الصينيه رقم 1');
  assert.equal(item.row.correctedRowData, null);
  assert.ok(item.row.normalizedData, 'the normalised shape is separate');
});

test('31. the session is staged before anything is written, and each row is written on its own', () => {
  const service = readCode('src/services/odooImportService.ts');
  assert.ok(/IMPORT_SESSION_COLLECTION = 'importSessions'/.test(service));
  assert.ok(/IMPORT_STAGING_COLLECTION = 'importStagingRows'/.test(service));
  assert.ok(/WORK_ORDER_COLLECTION = 'workOrders'/.test(service));
  assert.ok(/STOCK_SCRAP_COLLECTION = 'stockScrap'/.test(service));
  assert.ok(/export async function saveOdooImportSession/.test(service) && /export async function loadOdooImportSession/.test(service));
  assert.ok(/createStageRecord\(|createProductionRecord\(/.test(service), 'the existing production write is reused');
  assert.ok(/resolveAndValidateImportRow/.test(service), 'the existing resolution and validation are reused');
  assert.ok(/catch \(err: any\)[\s\S]{0,400}FAILED/.test(service), 'one row failing never stops the others');
  const panel = readCode('src/components/admin/OdooHistoricalImportPanel.tsx');
  assert.ok(/saveOdooImportSession\(/.test(panel), 'staging is saved at parse time');
  assert.ok(/executeOdooImport\(/.test(panel) && /window\.confirm/.test(panel), 'writing needs an explicit approval');
  for (const id of ['odoo-import-files', 'odoo-import-build', 'odoo-import-work-centers', 'odoo-import-conflicts', 'odoo-import-orphans', 'odoo-import-rows', 'odoo-import-execute', 'odoo-import-audit']) {
    assert.ok(panel.includes(`id="${id}"`), id);
  }
  assert.equal((readCode('src/components/admin/DataImportView.tsx').match(/<OdooHistoricalImportPanel/g) ?? []).length, 1, 'inside the existing import centre');
});

test('32. the pure modules read and write nothing; the new collections have repository rules', () => {
  for (const rel of [
    'src/services/workCenterRegistryPure.ts',
    'src/services/odooSourcePure.ts',
    'src/services/odooProductionReaderPure.ts',
    'src/services/odooWorkOrderReaderPure.ts',
    'src/services/odooScrapReaderPure.ts',
    'src/services/odooImportLinkingPure.ts',
    'src/services/odooImportSessionPure.ts',
    'src/services/odooImportReportsPure.ts',
  ]) {
    const code = readCode(rel);
    assert.equal(/firebase|fetchMasterData|addDoc|setDoc|updateDoc|collection\(/.test(code), false, rel);
  }
  const rules = readSource('firestore.rules');
  for (const collection of ['importSessions', 'importStagingRows', 'workOrders', 'stockScrap', 'workCenters']) {
    assert.ok(rules.includes(`match /${collection}/{`), collection);
  }
  assert.ok(/NOT deployed here/.test(rules));
});

test('33. existing behaviour is untouched: kinds, panels and permissions', () => {
  const pure = readCode('src/services/entityImportPure.ts');
  // Step 8E appended the Master Data package kinds; the seven original ones are untouched and still first.
  assert.ok(/IMPORT_ENTITY_KINDS = \[\s*'jobReferences',\s*'batches',\s*'boms',\s*'bomVersions',\s*'routings',\s*'routingVersions',\s*'production',/.test(pure), 'the original entity kinds are unchanged');
  assert.ok(/'products',\s*'materials',\s*'bomPackage',\s*\] as const;/.test(pure), 'the package kinds are appended after them');
  assert.ok(/ODOO_SOURCE_KINDS = \['odooProduction', 'odooWorkOrder', 'odooScrap'\]/.test(pure));
  const service = readCode('src/services/entityImportService.ts');
  assert.ok(/case 'production'/.test(service), 'the existing entity import still writes production itself');
  assert.equal(/odooWorkOrder|odooScrap/.test(service), false, 'the Odoo import has its own service');
  const panel = readCode('src/components/admin/OdooHistoricalImportPanel.tsx');
  assert.ok(/hasPermission\('excel\.import'\)|hasPermission\('historical\.import\.execute'\)/.test(panel), 'existing permissions are reused');
  assert.equal(/'odoo\.import'|new permission/.test(panel), false, 'no new permission key');
});

test('34. reports: production and scrap by every required dimension, units never mixed', () => {
  const orders = [
    { id: 'w1', manufacturingOrderNumber: 'MO/1', stageType: 'chinese_mills', quantity: 14.95, unit: 'طن', shiftNumber: 1, workCenter: { mainCenterId: 'chinese_mills', mainCenterNameAr: 'الطواحين الصيني', equipmentName: 'مطحنة 1' } },
    { id: 'w2', manufacturingOrderNumber: 'MO/1', stageType: 'chinese_mills', quantity: 14.95, unit: 'طن', shiftNumber: 2, workCenter: { mainCenterId: 'chinese_mills', mainCenterNameAr: 'الطواحين الصيني', equipmentName: 'مطحنة 2' } },
  ];
  assert.equal(reports.productionByManufacturingOrder(orders)[0].total, 29.9);
  assert.equal(reports.productionByWorkCenter(orders)[0].label, 'الطواحين الصيني');
  assert.equal(reports.productionByEquipment(orders).length, 2);
  assert.equal(reports.productionByShift(orders).length, 2);
  const mixed = reports.productionByManufacturingOrder([
    { id: 'a', manufacturingOrderNumber: 'MO/2', quantity: 1, unit: 'طن' },
    { id: 'b', manufacturingOrderNumber: 'MO/2', quantity: 100, unit: 'قطعة' },
  ]);
  assert.deepEqual([mixed[0].total, mixed[0].unitMismatch], [null, true], 'tons and pieces are never added');
  const scrap = [
    { id: 's1', manufacturingOrderNumber: 'MO/1', productCode: 'P1', stageType: 'chinese_mills', quantity: 0.5, unit: 'طن', workCenter: { mainCenterId: 'chinese_mills', mainCenterNameAr: 'الطواحين الصيني' } },
    { id: 's2', manufacturingOrderNumber: 'MO/1', productCode: 'P1', stageType: 'chinese_mills', quantity: 0.25, unit: 'طن', workCenter: { mainCenterId: 'chinese_mills', mainCenterNameAr: 'الطواحين الصيني' } },
  ];
  assert.equal(reports.scrapByManufacturingOrder(scrap)[0].total, 0.75);
  assert.equal(reports.scrapByProduct(scrap)[0].total, 0.75);
  assert.equal(reports.scrapByWorkCenter(scrap)[0].total, 0.75);
  assert.equal(reports.scrapByStage(scrap)[0].total, 0.75);
});

test('35. the whole three-file session: counts, and only reviewed rows are writable', () => {
  const session = buildSession();
  assert.equal(session.counts.manufacturingOrders, 2);
  assert.equal(session.counts.workOrders, 6);
  assert.equal(session.counts.scrapRows, 3);
  assert.equal(session.counts.excluded, 2, 'both manufacturing-order rows are context');
  assert.ok(session.counts.conflicts >= 0);
  const writable = session.staged.filter((s: any) => sessionPure.isOdooRowWritable(s));
  assert.equal(writable.some((s: any) => s.kind === 'odooProduction'), false, 'a manufacturing order is never written');
  const withWarnings = session.staged.filter((s: any) => s.kind !== 'odooProduction' && s.row.warnings.length > 0 && !s.row.warningsAccepted);
  for (const item of withWarnings) assert.equal(sessionPure.isOdooRowWritable(item), false, 'an unreviewed warning holds its row');
});

// ==================================================
// C. CONFIRMED BUSINESS CORRECTIONS
// ==================================================

test('A. السرد is NOT the rotary furnace and is never written as one', () => {
  const sard = wc.resolveWorkCenter('السرد');
  assert.equal(sard.mainCenterId, 'sard');
  assert.notEqual(sard.mainCenterId, 'rotary_furnace');
  assert.equal(sard.stageType, null, 'no stage is invented for it');
  assert.equal(sard.mainCenterNameAr, 'السرد — تابع للفرن الدوار');
  assert.equal(sard.raw, 'السرد', 'the raw work centre is preserved');
  assert.equal(wc.workCenterIsWritable(sard), false);
  // The rotary furnace stays its own centre, untouched by this.
  assert.equal(wc.resolveWorkCenter('الفرن الدوار').stageType, 'rotary_furnace');
  // A سرد row survives the whole session, unresolved and visible - never silently written or dropped.
  const workOrders = woReader.readMrpWorkOrder(
    [{ 'Manufacturing Order': 'MO/SARD', 'Work Order': '1', 'Work Center': 'السرد', Product: '[P] P', Quantity: 12, 'Unit of Measure': 'Ton', Date: '2026-01-05' }],
    ctx('mrp.workorder.xlsx'),
  );
  const built = sessionPure.productionPayloadFromWorkOrder(workOrders.rows[0], null, { attachComponents: false });
  assert.equal(built.payload, null, 'no production record is written for a centre with no stage');
  assert.ok(built.errors.some((e: any) => /no production record type/.test(e.messageEn)));
  const session = sessionPure.buildOdooImportSession({ importSessionId: 'S', createdBy: 'x', createdAt: 'x', production: [], workOrders: workOrders.rows, scrap: [] });
  const staged = session.staged.find((s: any) => s.kind === 'odooWorkOrder');
  assert.ok(staged, 'the row is still in the session');
  assert.ok(staged.orphanKinds.includes('UNRESOLVED_STAGE'), 'it is reviewable as unresolved');
  assert.equal(staged.rawRow['Work Center'], 'السرد', 'its raw row is intact');
  assert.equal(sessionPure.isOdooRowWritable(staged), false);
});

test('B. مركز الصب والفرم is NOT mapped to lightweight_foam', () => {
  for (const raw of ['الصب والفوم', 'الصب والفرم']) {
    const r = wc.resolveWorkCenter(raw);
    assert.equal(r.mainCenterId, 'casting_foam_center', raw);
    assert.equal(r.mainCenterNameAr, 'مركز الصب والفرم');
    assert.equal(r.stageType, null, 'no stage is assumed');
    assert.notEqual(r.stageType, 'lightweight_foam');
  }
  // No centre in the registry claims the foam stage - the only mention of it is
  // the note saying it is deliberately NOT mapped.
  assert.equal(wc.WORK_CENTERS.some((c: any) => c.stageType === 'lightweight_foam'), false);
  const casting = wc.WORK_CENTERS.find((c: any) => c.id === 'casting_foam_center');
  assert.equal(casting.stageType, null);
  assert.ok(/not mapped to lightweight_foam/.test(casting.note), 'the decision is recorded, not implemented');
  const aliasTargets = new Set(wc.WORK_CENTER_ALIASES.map((a: any) => a.centerId));
  assert.equal([...aliasTargets].every((id: any) => wc.workCenterById(id)), true, 'every alias points at a declared centre');
});

test('C. rotary sorting: work order 1 / 2 is shift 1 / 2, and only for that centre', () => {
  assert.equal(woReader.shiftFromWorkOrder('sard', '1'), 1);
  assert.equal(woReader.shiftFromWorkOrder('sard', '2'), 2);
  assert.equal(woReader.shiftFromWorkOrder('sard', 'فرز'), null, 'only a plain number is a shift');
  assert.equal(woReader.shiftFromWorkOrder('sorting', '1'), null, 'the rule is not global');
  assert.equal(woReader.shiftFromWorkOrder('tunnel_kiln', '1'), null);
  assert.equal(woReader.shiftFromWorkOrder('mortar_concrete_center', '1'), null);
  const row = woReader.readMrpWorkOrder(
    [{ 'Manufacturing Order': 'MO/SARD', 'Work Order': '2', 'Work Center': 'السرد', Product: '[P] P', Quantity: 12, 'Unit of Measure': 'Ton', Date: '2026-01-05' }],
    ctx('mrp.workorder.xlsx'),
  ).rows[0].normalized;
  assert.deepEqual([row.rawWorkOrder, row.shiftNumber], ['2', 2], 'the raw value is kept and the shift is read');
});

test('D. a work-order row that records no quantity never creates production', () => {
  const rows = [
    { 'Manufacturing Order': 'MO/1', 'Work Order': '1', 'Work Center': 'خلط', Product: '[P] P', Quantity: 8, 'Unit of Measure': 'Ton', Employee: 'أحمد', Date: '2026-01-05' },
    // The same work order repeated to name a second employee - no quantity.
    { 'Manufacturing Order': 'MO/1', 'Work Order': '1', 'Work Center': 'خلط', Product: '', Quantity: '', 'Unit of Measure': '', Employee: 'سعيد', Date: '' },
    // An employee-only row.
    { 'Manufacturing Order': '', 'Work Order': '', 'Work Center': '', Product: '', Quantity: '', 'Unit of Measure': '', Employee: 'محمود', Date: '' },
  ];
  const result = woReader.readMrpWorkOrder(rows, ctx('mrp.workorder.xlsx'));
  assert.equal(result.rows.length, 1, 'one production event, not three');
  assert.equal(result.counts.continuationRows, 1);
  assert.equal(result.counts.employeeOnlyRows, 1);
  assert.equal(result.counts.productionEvents, 1);
  const n = result.rows[0].normalized;
  assert.equal(n.quantity, 8, 'the quantity is read once, from the row that carried it');
  assert.deepEqual(n.employees.map((e: any) => e.employeeName), ['أحمد', 'سعيد', 'محمود'], 'the others are participation');
  assert.deepEqual(n.sourceRows, [2, 3, 4], 'every contributing row is kept for provenance');
  // A work order that genuinely carries no quantity is not a production event.
  const noQuantity = woReader.readMrpWorkOrder(
    [{ 'Manufacturing Order': 'MO/2', 'Work Order': '1', 'Work Center': 'خلط', Product: '[P] P', Quantity: '', 'Unit of Measure': 'Ton', Date: '2026-01-05' }],
    ctx('mrp.workorder.xlsx'),
  ).rows[0];
  assert.equal(noQuantity.normalized.isProductionEvent, false);
  const built = sessionPure.productionPayloadFromWorkOrder(noQuantity, null, { attachComponents: false });
  assert.equal(built.payload, null);
  assert.ok(built.errors.some((e: any) => /not a production event/.test(e.messageEn)));
});

test('E. repeated chinese-mill rows stay separate production records', () => {
  const session = buildSession();
  const rows = session.staged.filter((s: any) => s.kind === 'odooWorkOrder' && s.linkedManufacturingOrder === 'الطواحين الصيني/MO/00386-003');
  assert.equal(rows.length, 4, 'four production events');
  assert.equal(new Set(rows.map((r: any) => r.identityKey)).size, 4);
  assert.deepEqual(rows.map((r: any) => r.payload.quantity), [14.95, 14.95, 14.95, 14.95]);
  assert.equal(Number(rows.reduce((s: number, r: any) => s + r.payload.quantity, 0).toFixed(2)), 59.8);
  // The identity is the source production event, not date + product + batch.
  const identities = rows.map((r: any) => r.row.normalizedData);
  assert.deepEqual(identities.map((n: any) => [n.shiftNumber, n.workCenter.equipmentName]), [
    [1, 'الطاحونه الصينيه رقم 1'], [1, 'الطاحونه الصينيه رقم 2'], [2, 'الطاحونه الصينيه رقم 1'], [2, 'الطاحونه الصينيه رقم 2'],
  ]);
});

test('F. a manufacturing order with no work order is retained and reported, never written', () => {
  const production = prodReader.readMrpProduction([
    { Reference: 'MO/LONE', 'Product Template/Internal Reference': 'P1', 'Finished Product': '[P1] P', 'Quantity To Produce': 10, 'Product Unit of Measure': 'Ton', 'Scheduled Date': '2026-01-05' },
  ], ctx('mrp.production.xlsx'));
  const session = sessionPure.buildOdooImportSession({ importSessionId: 'S', createdBy: 'x', createdAt: 'x', production: production.rows, workOrders: [], scrap: [] });
  const staged = session.staged.find((s: any) => s.kind === 'odooProduction');
  assert.ok(staged, 'the manufacturing order is kept');
  assert.equal(staged.rawRow.Reference, 'MO/LONE', 'with its source data');
  assert.ok(staged.orphanKinds.includes('MO_WITHOUT_WORK_ORDER'), 'and flagged as unresolved');
  assert.ok(session.link.orphans.some((o: any) => o.kind === 'MO_WITHOUT_WORK_ORDER' && /no production record with an assumed centre/.test(o.messageEn)));
  assert.equal(sessionPure.isOdooRowWritable(staged), false, 'no production centre is invented for it');
  assert.ok(staged.row.warnings.some((w: any) => /stays for review/.test(w.messageEn)));
});

test('G. components are never split across several work orders', () => {
  const production = prodReader.readMrpProduction([
    { Reference: 'MO/C', 'Product Template/Internal Reference': 'P1', 'Finished Product': '[P1] P', 'Quantity To Produce': 10, 'Product Unit of Measure': 'Ton', 'Scheduled Date': '2026-01-05', 'Components/Product Template': '[M1] Clay', 'Components/Quantity Done': 20, 'Components/UoM': 'Ton' },
  ], ctx('mrp.production.xlsx'));
  const two = woReader.readMrpWorkOrder([
    { 'Manufacturing Order': 'MO/C', 'Work Order': '1', 'Work Center': 'خلط', Product: '[P1] P', Quantity: 5, 'Unit of Measure': 'Ton', Date: '2026-01-05' },
    { 'Manufacturing Order': 'MO/C', 'Work Order': '2', 'Work Center': 'خلط', Product: '[P1] P', Quantity: 5, 'Unit of Measure': 'Ton', Date: '2026-01-05' },
  ], ctx('mrp.workorder.xlsx'));
  const many = sessionPure.buildOdooImportSession({ importSessionId: 'S', createdBy: 'x', createdAt: 'x', production: production.rows, workOrders: two.rows, scrap: [] });
  for (const row of many.staged.filter((s: any) => s.kind === 'odooWorkOrder')) {
    assert.equal(row.payload.materials, undefined, 'nothing is allocated to a work order');
    assert.ok(row.row.warnings.some((w: any) => /never split/.test(w.messageEn)));
  }
  const mo = many.staged.find((s: any) => s.kind === 'odooProduction');
  assert.equal((mo.row.normalizedData as any).components.length, 1, 'the components stay at manufacturing-order level');
  // With exactly one work order the linkage is exact, so they may be attached.
  const one = woReader.readMrpWorkOrder([
    { 'Manufacturing Order': 'MO/C', 'Work Order': '1', 'Work Center': 'خلط', Product: '[P1] P', Quantity: 10, 'Unit of Measure': 'Ton', Date: '2026-01-05' },
  ], ctx('mrp.workorder.xlsx'));
  const single = sessionPure.buildOdooImportSession({ importSessionId: 'S', createdBy: 'x', createdAt: 'x', production: production.rows, workOrders: one.rows, scrap: [] });
  const attached = single.staged.find((s: any) => s.kind === 'odooWorkOrder');
  assert.equal((attached.payload.materials as any[]).length, 1);
});

test('H. approving a Work Center mapping creates no Equipment Master record', () => {
  const service = readCode('src/services/odooImportService.ts');
  const saveFn = service.slice(service.indexOf('export async function saveWorkCenterMapping'), service.indexOf('export interface OdooExecutionOptions'));
  assert.ok(/WORK_CENTER_COLLECTION/.test(saveFn), 'it writes the mapping collection');
  assert.equal(/createMasterDataItem|presses|chineseMills|tubeBallMills|rotaryKilns|furnaces|bunkers|machines/.test(saveFn), false, 'and no equipment master');
  assert.equal(/createMasterDataItem/.test(service), false, 'the import service creates no master data at all');
  const panel = readCode('src/components/admin/OdooHistoricalImportPanel.tsx');
  assert.ok(/saveWorkCenterMapping\(/.test(panel));
  assert.equal(/createMasterDataItem|InlineMasterDataAdd/.test(panel), false);
  // The detailed machine name is preserved so it can be promoted later, deliberately.
  assert.equal(wc.resolveWorkCenter('مكبس لايس 2000').equipmentName, 'مكبس لايس 2000');
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

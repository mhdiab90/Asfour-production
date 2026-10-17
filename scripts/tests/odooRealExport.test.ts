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
  // 3.29.0: the shakers, crushers and hand-made brick - only the last still needs the user's approval.
  for (const raw of ['اليدوى والشاكوش', 'مركز غير معروف']) {
    assert.equal(reg.resolveWorkCenter(raw, []).status, 'UNMAPPED_CENTER', raw);
  }
});

// ==================================================
// C. OPT-IN TON -> PIECES (3.26.2)
// ==================================================

const PRESS_WO = { ...WO_ROW, 'Work Center': 'مكبس بوخر 2', Quantity: 0.5 };
const PRESS_MO = { ...MO_ROW, 'Work Orders/Work Center': 'مكبس بوخر 2' };
const withConversion = (weights: Record<string, number>, workOrders: any[], production: any[]) => {
  const p = prod.readMrpProduction(production, ctx('mo.xlsx'));
  const w = wo.readMrpWorkOrder(workOrders, ctx('wo.xlsx'), []);
  return session.buildOdooImportSession({
    importSessionId: 'S', createdBy: 'u', createdAt: 'now', production: p.rows, workOrders: w.rows, scrap: [], approvedWorkCenters: [],
    pieceConversion: { enabled: true, pieceWeightKg: (code: string) => weights[code] ?? null },
  });
};

test('C1. OFF by default: pressing still refuses tons (nothing changes unless the user switches it on)', () => {
  const built = build([PRESS_WO], [PRESS_MO]);
  assert.equal(built.counts.productionRowsToWrite, 0);
});

test('C2. ON with the product piece weight: tons x 1000 / weight, rounded, written as pieces with the tons kept', () => {
  const built = withConversion({ LCC8001: 2.5 }, [PRESS_WO], [PRESS_MO]);
  assert.equal(built.counts.productionRowsToWrite, 1);
  const row = woRow(built);
  assert.equal(row.payload.productionQuantity, 200, '0.5 t x 1000 / 2.5 kg');
  assert.equal(row.payload.productionUnit, 'قطعة');
  assert.equal(row.payload.sourceQuantityTons, 0.5, 'the source tons stay on the record');
  assert.equal(row.payload.pieceWeight, 2.5);
  assert.ok((row.row.warnings ?? []).some((w: any) => /حُوّلت 0.5 طن إلى 200 قطعة/.test(w.messageAr)), 'and the row says exactly what was done');
});

test('C3. the conversion rounds to the nearest whole piece', () => {
  const built = withConversion({ LCC8001: 3.3 }, [{ ...PRESS_WO, Quantity: 0.1 }], [PRESS_MO]);
  assert.equal(woRow(built).payload.productionQuantity, 30, '100 / 3.3 = 30.3');
});

test('C4. a product with no piece weight is refused - no weight is ever assumed', () => {
  const built = withConversion({}, [PRESS_WO], [PRESS_MO]);
  assert.equal(built.counts.productionRowsToWrite, 0);
  assert.ok((woRow(built).row.errors ?? []).some((e: any) => /لا يوجد وزن قطعة/.test(e.messageAr)));
});

test('C5. less than one piece is refused', () => {
  const built = withConversion({ LCC8001: 800 }, [{ ...PRESS_WO, Quantity: 0.0001 }], [PRESS_MO]);
  assert.equal(built.counts.productionRowsToWrite, 0);
  assert.ok((woRow(built).row.errors ?? []).some((e: any) => /أقل من قطعة واحدة/.test(e.messageAr)));
});

test('C6. sorting writes the converted count to totalCount', () => {
  const sort = { ...WO_ROW, 'Work Center': 'الفرز', Quantity: 1 };
  const built = withConversion({ LCC8001: 4 }, [sort], [{ ...MO_ROW, 'Work Orders/Work Center': 'الفرز' }]);
  const row = woRow(built);
  assert.equal(row.payload.totalCount, 250);
  assert.equal('productionQuantity' in row.payload, false);
});

test('C7. a stage that already counts tons is never touched by the conversion', () => {
  const built = withConversion({ LCC8001: 2.5 }, [WO_ROW], [MO_ROW]);
  const row = woRow(built);
  assert.equal(row.payload.productionQuantity, 2);
  assert.equal(row.payload.productionUnit, 'طن');
  assert.equal('sourceQuantityTons' in row.payload, false);
});

test('C8. the Hand-made Brick centre is offered for approval but no name maps to it by itself', () => {
  assert.equal(reg.workCenterById('handmade_brick')?.stageType, 'handmade_brick');
  assert.equal(reg.resolveWorkCenter('اليدوى والشاكوش', []).status, 'UNMAPPED_CENTER', 'still needs the user to approve it');
  const approved = [{ rawNormalized: reg.normaliseWorkCenterText('اليدوى والشاكوش'), mainCenterId: 'handmade_brick', active: true }];
  const r = reg.resolveWorkCenter('اليدوى والشاكوش', approved);
  assert.equal(r.stageType, 'handmade_brick');
  assert.equal(reg.WORK_CENTER_ALIASES.some((a: any) => a.centerId === 'handmade_brick'), false);
});

// ==================================================
// D. PRESS AND SHIFT IDENTITY OF PRESSING ROWS (3.28.0)
// ==================================================

const PRESSES = [
  { id: 'p2', code: 'PR-02', name: 'مكبس بوخر 2' },
  { id: 'p3', code: 'PR-03', name: 'مكبس بوخر 3' },
  { id: 'x1', code: 'DUP-1', name: 'مكبس مكرر' },
  { id: 'x2', code: 'DUP-2', name: 'مكبس مكرر' },
  { id: 'p9', code: 'PR-09', name: 'مكبس قديم', active: false },
];
const SHIFTS = [
  { id: 's1', code: 'S1', name: 'الوردية الأولى' },
  { id: 's2', code: 'SH-2', name: 'الوردية الثانية' },
  { id: 's3a', code: '3', name: 'الثالثة أ' },
  { id: 's3b', code: 'S3', name: 'الثالثة ب' },
];
const identity = () => ({ pressByName: reg.buildPressLookup(PRESSES), shiftByNumber: reg.buildShiftLookup(SHIFTS) });
const pressingBuilt = (center: string, order = '1') => {
  const p = prod.readMrpProduction([{ ...MO_ROW, 'Work Orders/Work Center': center }], ctx('mo.xlsx'));
  const w = wo.readMrpWorkOrder([{ ...WO_ROW, 'Work Center': center, Quantity: 0.5, 'Work Order': order }], ctx('wo.xlsx'), []);
  return session.buildOdooImportSession({
    importSessionId: 'S', createdBy: 'u', createdAt: 'now', production: p.rows, workOrders: w.rows, scrap: [], approvedWorkCenters: [],
    pieceConversion: { enabled: true, pieceWeightKg: () => 2.5 }, identity: identity(),
  });
};

test('D1. a press named like one press of Master Data gets its code and name; the shift gets its id', () => {
  const row = woRow(pressingBuilt('مكبس بوخر 2', '2'));
  assert.equal(row.payload.pressCode, 'PR-02');
  assert.equal(row.payload.pressName, 'مكبس بوخر 2');
  assert.equal(row.payload.shiftId, 's2', 'work order "2" is shift 2 on a pressing centre');
  assert.equal(row.payload.shiftName, 'الوردية الثانية');
  assert.equal(row.payload.shiftCode, 'SH-2');
});

test('D2. a press that matches nothing, or an inactive press, is written without a press - and says so', () => {
  for (const center of ['مكبس بوخر 4', 'مكبس قديم']) {
    const row = woRow(pressingBuilt(center));
    assert.equal('pressCode' in row.payload, false, center);
    assert.ok((row.row.warnings ?? []).some((w: any) => /لا يطابق مكبسًا واحدًا بالضبط/.test(w.messageAr)), center);
  }
});

test('D3. two presses with the same name are ambiguous: no press is picked', () => {
  const row = woRow(pressingBuilt('مكبس مكرر'));
  assert.equal('pressCode' in row.payload, false);
});

test('D4. two shifts that fit number 3 are ambiguous: no shift is picked, and the row says so', () => {
  const row = woRow(pressingBuilt('مكبس بوخر 2', '3'));
  assert.equal('shiftId' in row.payload, false);
  assert.ok((row.row.warnings ?? []).some((w: any) => /لا تطابق وردية واحدة بالضبط/.test(w.messageAr)));
  assert.equal(row.payload.pressCode, 'PR-02', 'the press is still found');
});

test('D5. a stage that is not pressing is untouched by the identity lookups', () => {
  const p = prod.readMrpProduction([MO_ROW], ctx('mo.xlsx'));
  const w = wo.readMrpWorkOrder([WO_ROW], ctx('wo.xlsx'), []);
  const built = session.buildOdooImportSession({ importSessionId: 'S', createdBy: 'u', createdAt: 'now', production: p.rows, workOrders: w.rows, scrap: [], approvedWorkCenters: [], identity: identity() });
  const row = woRow(built);
  assert.equal('pressCode' in row.payload, false);
  assert.equal('shiftId' in row.payload, false);
});

test('D6. without lookups nothing changes (the screen could not read Master Data)', () => {
  const built = withConversion({ LCC8001: 2.5 }, [PRESS_WO], [PRESS_MO]);
  const row = woRow(built);
  assert.equal('pressCode' in row.payload, false);
  assert.equal((row.row.warnings ?? []).some((w: any) => /مكبس/.test(w.messageAr) && /بالضبط/.test(w.messageAr)), false);
});

test('D7. the lookups themselves: name or code, one match only', () => {
  const press = reg.buildPressLookup(PRESSES);
  assert.deepEqual(press('PR-03'), { code: 'PR-03', name: 'مكبس بوخر 3' }, 'by code');
  assert.equal(press('  مكبس   بوخر 3 ')?.code, 'PR-03', 'spacing is normalised');
  const shift = reg.buildShiftLookup(SHIFTS);
  assert.equal(shift(1)?.id, 's1');
  assert.equal(shift(3), null);
  assert.equal(shift(4), null);
  assert.equal(reg.buildShiftLookup([{ id: 'a', name: 'x', shiftNumber: 2 }])(2)?.id, 'a', 'a shiftNumber field is read');
});

// ==================================================
// E. ROTARY-KILN SUB-CENTRES AND CASTING & FOAM (3.29.0)
// ==================================================

test('E1. the shakers and the crushers are sub-centres of the rotary kiln and write to its record type', () => {
  for (const [raw, center] of [['الهزازات', 'rotary_shakers'], ['هزاز الشلاوى', 'rotary_shakers'], ['كسارات', 'rotary_crushers'], ['كسارة رقم 12', 'rotary_crushers'], ['كسارة رقم 11', 'rotary_crushers']]) {
    const r = reg.resolveWorkCenter(raw, []);
    assert.equal(r.mainCenterId, center, raw);
    assert.equal(r.stageType, 'rotary_furnace', raw);
    assert.equal(r.status, 'RESOLVED', raw);
    assert.equal(reg.workCenterById(center).parentCenterId, 'rotary_furnace');
  }
  assert.equal(reg.resolveWorkCenter('كسارة رقم 12', []).equipmentName, 'كسارة رقم 12', 'the machine stays readable');
});

test('E2. the kiln itself and every other centre resolve exactly as before', () => {
  const id = (raw: string) => reg.resolveWorkCenter(raw, []).mainCenterId;
  assert.equal(id('الفرن الدوار'), 'rotary_furnace');
  assert.equal(id('مكبس بوخر 2'), 'pressing');
  assert.equal(id('الخلاطات'), 'mixing');
  assert.equal(id('خلاط الفوم'), 'mixing');
  assert.equal(id('الطاحونه الصينيه رقم 1'), 'chinese_mills');
  assert.equal(id('السرد'), 'sard', 'the sard centre is untouched');
});

test('E3. casting & foam: the raw name resolves to the EXISTING centre, which still has no record type', () => {
  const r = reg.resolveWorkCenter('صب الفوم', []);
  assert.equal(r.mainCenterId, 'casting_foam_center');
  assert.equal(r.status, 'NO_STAGE_MAPPING');
  assert.equal(r.stageType, null);
  assert.equal(reg.workCenterById('casting_foam_center').stageType, null, 'no stage was invented for it');
});

test('E4. a shaker work order is written to the rotary-kiln stage, in tons, with its sub-centre identity on the record', () => {
  const shaker = { ...WO_ROW, 'Work Center': 'الهزازات', Quantity: 3 };
  const built = build([shaker], [{ ...MO_ROW, 'Work Orders/Work Center': 'الهزازات' }]);
  assert.equal(built.counts.productionRowsToWrite, 1);
  const row = woRow(built);
  assert.equal(row.targetStage, 'rotary_furnace');
  assert.equal(row.payload.stageType, 'rotary_furnace');
  assert.equal(row.payload.productionQuantity, 3);
  assert.equal(row.payload.productionUnit, 'طن');
  assert.equal(row.payload.subCenterId, 'rotary_shakers');
  assert.equal(row.payload.parentCenterId, 'rotary_furnace');
  assert.equal(row.payload.subCenterMachine, 'الهزازات');
});

test('E5. the kiln itself has NO sub-centre fields on its work order', () => {
  const kiln = { ...WO_ROW, 'Work Center': 'الفرن الدوار', Quantity: 3 };
  const row = woRow(build([kiln], [{ ...MO_ROW, 'Work Orders/Work Center': 'الفرن الدوار' }]));
  assert.equal(row.payload.stageType, 'rotary_furnace');
  assert.equal('subCenterId' in row.payload, false);
});

test('E6. a casting & foam work order is still refused for writing (no record type), and says why', () => {
  const foam = { ...WO_ROW, 'Work Center': 'صب الفوم', Quantity: 1 };
  const built = build([foam], [{ ...MO_ROW, 'Work Orders/Work Center': 'صب الفوم' }]);
  assert.equal(built.counts.productionRowsToWrite, 0);
  assert.ok((woRow(built).row.errors ?? []).some((e: any) => /غير مرتبط بنوع سجل إنتاج/.test(e.messageAr)));
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

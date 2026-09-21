/**
 * REMAINING PRODUCTION AREAS - Phase 1 Step 8C-5.
 *
 * R  record types: thermal concrete, tunnel kiln, hand-made brick
 * P  packing as a sub-activity of the packing lines only
 * X  extrusion inside pressing; tube vs ball mill never guessed
 * O  the Odoo manufacturing-order sheets fold into the same payloads
 * I  integration: one rule set, one write path, repository-only rules
 *
 * Run: npx tsx scripts/tests/productionAreas.test.ts
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

console.log('productionAreas.test.ts');

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

let pa: any;
let pk: any;
let od: any;
let iv: any;
let rr: any;
let uom: any;
let bounds: any;
let reg: any;
let refs: any;
let eq: any;
let rc: any;
let ops: any;
let cfg: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  pa = await load('src/services/productionAreaPure.ts');
  pk = await load('src/services/packagingActivityPure.ts');
  od = await load('src/services/odooManufacturingImportPure.ts');
  iv = await load('src/services/importEntityValidationPure.ts');
  rr = await load('src/services/referenceResolutionPure.ts');
  uom = await load('src/services/uomReadinessPure.ts');
  bounds = await load('src/services/stageQueryBoundsPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  refs = await load('src/services/productionReferencePure.ts');
  eq = await load('src/services/equipmentMasterPure.ts');
  rc = await load('src/services/recordCorrectionPure.ts');
  ops = await load('src/services/operationMasterPure.ts');
  cfg = await load('src/services/genericStageDuplicateIdentityPure.ts');
}

const NEW = ['thermal_concrete', 'tunnel_kiln', 'handmade_brick'];

const masters = () => deepFreeze({
  products: [
    { id: 'p-tc', code: 'LCC8001', name: 'Castable LCC 80%' },
    { id: 'p-fb', code: 'FBHA800404715', name: 'Under Burn Bricks' },
    { id: 'p-hb', code: 'HB-001', name: 'Hand brick' },
  ],
  materials: [
    { id: 'm-gb', code: 'GBHA800404715', name: 'Green Bricks' },
    { id: 'm-ch', code: 'CHR3800502', name: 'Calcined Kaolin' },
  ],
  customers: [], jobReferences: [], batches: [], boms: [], bomVersions: [], routings: [], routingVersions: [],
  operations: [
    { id: 'op-tc', code: 'OP-TCONC', nameAr: 'خرسانة', legacyStageKey: 'thermal_concrete', active: true, allowedEquipmentCategoryIds: [] },
    { id: 'op-tk', code: 'OP-TUNNEL-KILN', nameAr: 'نفقي', legacyStageKey: 'tunnel_kiln', active: true, allowedEquipmentCategoryIds: [] },
    { id: 'op-hb', code: 'OP-HAND', nameAr: 'يدوي', legacyStageKey: 'handmade_brick', active: true, allowedEquipmentCategoryIds: [] },
    { id: 'op-pack', code: 'OP-PACK', nameAr: 'تعبئة', legacyStageKey: null, active: true, allowedEquipmentCategoryIds: [] },
  ],
  equipment: [], costCenters: [], accounts: [], employees: [], logicalItems: [],
});
const ctx = () => ({ ...masters() } as any);
const idx = () => rr.buildReferenceIndexes(masters());
const validate = (payload: Record<string, unknown>) => iv.resolveAndValidateImportRow('production', payload, ctx(), idx());

// ==================================================
// R. RECORD TYPES
// ==================================================

test('1. the three new stages are record types with their own collection', () => {
  assert.deepEqual(NEW.map((s) => bounds.STAGE_COLLECTION_NAMES[s]), ['stage_thermal_concrete', 'stage_tunnel_kiln', 'stage_handmade_brick']);
  assert.deepEqual([...pa.PRODUCTION_AREA_STAGES], NEW);
  const types = readCode('src/types/index.ts');
  for (const name of ['ThermalConcreteRecord', 'TunnelKilnRecord', 'HandmadeBrickRecord']) assert.ok(types.includes(`export interface ${name}`), name);
  assert.ok(/'thermal_concrete'[\s\S]*'tunnel_kiln'[\s\S]*'handmade_brick'/.test(types));
});

test('2. packing and extrusion are NOT record families', () => {
  const keys = Object.keys(bounds.STAGE_COLLECTION_NAMES);
  assert.equal(keys.some((k) => /pack|extru/i.test(k)), false);
  assert.equal(keys.length, 11);
});

test('3. required / optional / future-ready are declared per record type', () => {
  for (const s of NEW) {
    const spec = pa.PRODUCTION_AREA_FIELDS[s];
    assert.deepEqual([...spec.required], ['date', 'productId', 'productionQuantity'], s);
    assert.ok(spec.futureReady.includes('workers') && spec.futureReady.includes('operatingHours'), s);
  }
  assert.deepEqual(NEW.map((s) => pa.PRODUCTION_AREA_FIELDS[s].productionUnit), ['طن', 'طن', 'قطعة']);
  assert.deepEqual(NEW.map((s) => pa.PRODUCTION_AREA_FIELDS[s].operationCode), ['OP-TCONC', 'OP-TUNNEL-KILN', 'OP-HAND']);
});

test('4. a new record without its required fields is refused', () => {
  for (const s of NEW) {
    const v = pa.validateProductionAreaRecord(s, {});
    assert.equal(v.valid, false);
    assert.deepEqual(v.issues.map((i: any) => i.field), ['date', 'productId', 'productionQuantity'], s);
  }
  assert.equal(pa.validateProductionAreaRecord('mixing', {}).valid, true, 'existing stages are not given new requirements');
});

test('5. quantities: positive production, non-negative waste, whole pieces for hand-made brick', () => {
  const base = { date: '2026-01-01', productId: 'p' };
  assert.deepEqual(pa.validateProductionAreaRecord('tunnel_kiln', { ...base, productionQuantity: 0 }).issues.map((i: any) => i.field), ['productionQuantity']);
  assert.deepEqual(pa.validateProductionAreaRecord('tunnel_kiln', { ...base, productionQuantity: 9.24, wasteQuantity: -1 }).issues.map((i: any) => i.field), ['wasteQuantity']);
  assert.deepEqual(pa.validateProductionAreaRecord('handmade_brick', { ...base, productionQuantity: 10.5 }).issues.map((i: any) => i.field), ['productionQuantity']);
  assert.deepEqual(pa.validateProductionAreaRecord('handmade_brick', { ...base, productionQuantity: 10, pieceWeightKg: 0 }).issues.map((i: any) => i.field), ['pieceWeightKg']);
  assert.equal(pa.validateProductionAreaRecord('thermal_concrete', { ...base, productionQuantity: 1.5 }).valid, true);
  assert.deepEqual(pa.validateProductionAreaRecord('thermal_concrete', { ...base, date: '01/01/2026', productionQuantity: 1 }).issues.map((i: any) => i.field), ['date']);
});

test('6. the tunnel kiln names its kiln from the Furnaces master and its cars as text', () => {
  assert.deepEqual(reg.STAGE_EQUIPMENT_CATEGORIES.tunnel_kiln, ['furnaces']);
  assert.deepEqual(refs.stageEquipmentFields('tunnel_kiln'), [{ field: 'furnaceId', categoryId: 'furnaces' }]);
  assert.deepEqual(reg.STAGE_EQUIPMENT_CATEGORIES.thermal_concrete, []);
  assert.deepEqual(reg.STAGE_EQUIPMENT_CATEGORIES.handmade_brick, []);
  const base = { date: '2026-01-01', productId: 'p', productionQuantity: 1 };
  assert.equal(pa.validateProductionAreaRecord('tunnel_kiln', { ...base, furnaceCarNumbers: ['65', '244'] }).valid, true);
  assert.deepEqual(pa.validateProductionAreaRecord('tunnel_kiln', { ...base, furnaceCarNumbers: ['65', ''] }).issues.map((i: any) => i.field), ['furnaceCarNumbers']);
  assert.deepEqual(pa.validateProductionAreaRecord('tunnel_kiln', { ...base, furnaceCarIds: ['a'], furnaceCarNumbers: ['1', '2'] }).issues.map((i: any) => i.field), ['furnaceCarIds']);
});

test('7. units: tons for thermal concrete and tunnel kiln, pieces for hand-made brick', () => {
  const row = (op: string) => uom.STAGE_UOM_MATRIX.find((r: any) => r.operationCode === op);
  assert.deepEqual([row('OP-TCONC').stageType, row('OP-TCONC').status, row('OP-TCONC').production.unit], ['thermal_concrete', 'READY', 'طن']);
  assert.deepEqual([row('OP-TUNNEL-KILN').stageType, row('OP-TUNNEL-KILN').production.unit], ['tunnel_kiln', 'طن']);
  assert.deepEqual([row('OP-HAND').stageType, row('OP-HAND').production.unit], ['handmade_brick', 'قطعة']);
  assert.equal(uom.stageListQuantityUnit('handmade_brick', { productionQuantity: 5 }), 'قطعة');
  assert.equal(uom.stageListQuantityUnit('tunnel_kiln', { productionQuantity: 5 }), 'طن');
  assert.deepEqual(uom.stageProductionMeasure('tunnel_kiln', { productionQuantity: 9.24 }), { field: 'productionQuantity', quantity: 9.24, unit: 'طن' });
});

test('8. operations: the new stages are valid legacy keys; the approved seed is unchanged', () => {
  for (const s of NEW) assert.equal(ops.isLegacyStageKey(s), true, s);
  const op = refs.resolveOperationForStage(masters().operations, 'tunnel_kiln');
  assert.equal(op.operation.code, 'OP-TUNNEL-KILN');
  const seed = readCode('src/services/operationSeedPure.ts');
  assert.ok(/code: 'OP-TCONC'[^\n]*legacyStageKey: null/.test(seed), 'the stored seed is not rewritten - the link is configured in Master Data');
});

test('9. traceability, consumption and genealogy: one validator, the same as every stage', () => {
  const v = validate({
    stageType: 'tunnel_kiln', date: '2026-01-01', productCode: 'FBHA800404715', productionQuantity: 9.24,
    materials: [{ lineId: 'L1', sequence: 1, itemCode: 'GBHA800404715', quantity: 9.24, unit: 'طن' }],
  });
  assert.deepEqual(v.errors, [], JSON.stringify(v.errors));
  assert.equal(v.normalized.productId, 'p-fb');
  assert.equal(v.normalized.operationId, 'op-tk', 'the stage operation resolves');
  assert.equal(v.normalized.materials[0].materialId, 'm-gb');
  assert.ok(v.warnings.some((w: any) => w.field === 'jobReferenceId'), 'untraced is reported like any stage');
});

test('10. a new-stage row missing its product is blocked by the import', () => {
  const v = validate({ stageType: 'handmade_brick', date: '2026-01-01', productionQuantity: 4 });
  assert.ok(v.errors.some((e: any) => e.field === 'productId'));
  assert.equal(v.normalized, null);
});

test('11. an unknown stage is never written to a guessed collection', () => {
  const v = validate({ stageType: 'packing', date: '2026-01-01' });
  assert.ok(v.errors.some((e: any) => e.field === 'stageType' && /Unknown stage/.test(e.messageEn)));
});

test('12. duplicate identity, stage config, display names and permissions cover the new stages', () => {
  for (const s of NEW) assert.equal(cfg.hasSafeDuplicateIdentity(s), true, s);
  const svc = readCode('src/services/stageRecordService.ts');
  for (const s of NEW) assert.ok(svc.includes(`'${s}'`), s);
  const perms = readCode('src/utils/permissions.ts');
  for (const s of NEW) assert.ok(perms.includes(`'stage.${s}': true`), s);
  assert.ok(/handmade_brick'\) \{\n\s*prodCount/.test(svc) || /st === 'pressing' \|\| st === 'handmade_brick'/.test(svc), 'hand-made brick is measured in pieces');
});

// ==================================================
// P. PACKING
// ==================================================

test('13. packing applies to the packing lines only', () => {
  assert.deepEqual([...pk.PACKAGING_APPLICABLE_STAGES], ['sorting', 'mortar_concrete', 'thermal_concrete', 'rotary_furnace', 'chinese_mills', 'tube_ball_mills']);
  for (const s of ['pressing', 'mixing', 'tunnel_kiln', 'handmade_brick', 'lightweight_foam']) assert.equal(pk.packagingApplies(s), false, s);
});

test('14. no packing block = nothing recorded, nothing refused', () => {
  for (const p of [null, undefined, {}, { packedUnit: null, notes: '  ' }]) {
    assert.equal(pk.validatePackagingActivity('pressing', p).valid, true);
    assert.equal(pk.normalisePackagingActivity(p), null);
  }
});

test('15. packing on a non-packing line is refused', () => {
  for (const s of ['pressing', 'mixing', 'tunnel_kiln']) {
    const v = pk.validatePackagingActivity(s, { packageCount: 10, packageUnit: 'شكارة' });
    assert.deepEqual(v.issues.map((i: any) => i.field), ['packaging'], s);
  }
});

test('16. a packed quantity needs an approved unit and is never converted', () => {
  assert.deepEqual(pk.validatePackagingActivity('sorting', { packedQuantity: 2 }).issues.map((i: any) => i.field), ['packaging.packedUnit']);
  assert.deepEqual(pk.validatePackagingActivity('sorting', { packedQuantity: 2, packedUnit: 'Ton' }).issues.map((i: any) => i.field), ['packaging.packedUnit']);
  assert.deepEqual(pk.validatePackagingActivity('sorting', { packageCount: 2.5, packageUnit: 'شكارة' }).issues.map((i: any) => i.field), ['packaging.packageCount']);
  assert.deepEqual(pk.validatePackagingActivity('sorting', { packedQuantity: -1, packedUnit: 'طن' }).issues.map((i: any) => i.field), ['packaging.packedQuantity']);
  const input = deepFreeze({ packedQuantity: 2, packedUnit: 'طن', packageCount: 40, packageUnit: 'شيكارة', notes: ' ok ' });
  assert.equal(pk.validatePackagingActivity('chinese_mills', input).valid, true);
  assert.deepEqual(pk.normalisePackagingActivity(input, masters().operations), {
    operationId: 'op-pack', packedQuantity: 2, packedUnit: 'طن', packageCount: 40, packageUnit: 'شكارة', notes: 'ok',
  });
});

test('17. the packing operation links only when exactly one active OP-PACK exists', () => {
  const two = [...masters().operations, { id: 'op-pack-2', code: 'op-pack', active: true }];
  assert.equal(pk.resolvePackagingOperation(two), null);
  assert.equal(pk.normalisePackagingActivity({ packageCount: 1, packageUnit: 'شكارة' }, two).operationId, undefined);
});

test('18. packing rides the stage record through import - and is refused on a kiln', () => {
  const ok = validate({ stageType: 'thermal_concrete', date: '2026-01-01', productCode: 'LCC8001', productionQuantity: 1, packaging: { packageCount: 40, packageUnit: 'شكارة' } });
  assert.deepEqual(ok.errors, [], JSON.stringify(ok.errors));
  assert.deepEqual(ok.normalized.packaging, { operationId: 'op-pack', packageCount: 40, packageUnit: 'شكارة' });
  const bad = validate({ stageType: 'tunnel_kiln', date: '2026-01-01', productCode: 'FBHA800404715', productionQuantity: 1, packaging: { packageCount: 4, packageUnit: 'قطعة' } });
  assert.ok(bad.errors.some((e: any) => e.field === 'packaging'));
});

test('19. the entry screen shows packing only for packing lines and saves it in the same write', () => {
  const view = readCode('src/components/production/StageProductionEntryView.tsx');
  assert.ok(/showPackaging && <PackagingActivityPanel/.test(view));
  assert.ok(/packaging: showPackaging \? packaging : null/.test(view));
  for (const [form, stage] of [['RotaryFurnace', 'rotary_furnace'], ['ChineseMills', 'chinese_mills'], ['TubeBallMills', 'tube_ball_mills'], ['MortarConcrete', 'mortar_concrete'], ['Sorting', 'sorting']]) {
    const code = readCode(`src/components/production/${form}EntryForm.tsx`);
    assert.ok(code.includes(`preparePackagingActivity('${stage}', productionGenealogy?.packaging, language)`), form);
    assert.equal((code.match(/createStageRecord\(/g) ?? []).length, 1, `${form}: still one write`);
  }
  for (const form of ['Mixing', 'LightweightFoam']) assert.equal(/preparePackagingActivity/.test(readCode(`src/components/production/${form}EntryForm.tsx`)), false, form);
  assert.equal(/preparePackagingActivity/.test(readCode('src/components/production/ProductionEntryForm.tsx')), false, 'not on pressing');
  const uomRow = uom.STAGE_UOM_MATRIX.find((r: any) => r.operationCode === 'OP-PACK');
  assert.deepEqual([uomRow.stageType, uomRow.status], [null, 'SUB_ACTIVITY']);
});

// ==================================================
// X. EXTRUSION, MILL TYPE, FUTURE-READY
// ==================================================

test('20. extrusion is a forming method of pressing only', () => {
  assert.equal(pa.formingMethodOf({}), 'PRESSING', 'every historical record is pressing');
  assert.equal(pa.formingMethodOf({ formingMethod: 'extrusion' }), 'EXTRUSION');
  assert.deepEqual(pa.validateFormingMethod('pressing', 'EXTRUSION'), []);
  assert.deepEqual(pa.validateFormingMethod('pressing', 'CASTING').map((i: any) => i.field), ['formingMethod']);
  assert.deepEqual(pa.validateFormingMethod('mixing', 'EXTRUSION').map((i: any) => i.field), ['formingMethod']);
  const v = validate({ stageType: 'thermal_concrete', date: '2026-01-01', productCode: 'LCC8001', productionQuantity: 1, formingMethod: 'EXTRUSION' });
  assert.ok(v.errors.some((e: any) => e.field === 'formingMethod'));
});

test('21. the pressing form marks only an extrusion; OP-EXTRUDER stays an operation', () => {
  const form = readCode('src/components/production/ProductionEntryForm.tsx');
  assert.ok(/formingMethod === 'EXTRUSION' \? \{ formingMethod \} : \{\}/.test(form));
  assert.ok(form.includes('id="forming-method-select"'));
  const row = uom.STAGE_UOM_MATRIX.find((r: any) => r.operationCode === 'OP-EXTRUDER');
  assert.deepEqual([row.stageType, row.status, row.reviewListUnit], [null, 'SUB_ACTIVITY', 'قطعة']);
  assert.ok(/code: 'OP-EXTRUDER'/.test(readCode('src/services/operationSeedPure.ts')));
});

test('22. tube vs ball mill: recorded on the master, never read from the name', () => {
  assert.equal(pa.tubeBallMillKindOf({ name: 'طواحين تيوب ميل 503' }), 'NOT_IDENTIFIED');
  assert.equal(pa.tubeBallMillKindOf({ name: 'x', millKind: 'ball' }), 'BALL');
  assert.deepEqual(pa.validateTubeBallMillKind('ROD').map((i: any) => i.field), ['millKind']);
  assert.equal(eq.equipmentPayloadForSave('tubeBallMills', { code: 'TM', name: 'n' }).millKind, null);
  assert.equal(eq.equipmentPayloadForSave('tubeBallMills', { code: 'TM', name: 'n', millKind: 'tube' }).millKind, 'TUBE');
  assert.equal('millKind' in eq.equipmentPayloadForSave('rotaryKilns', { code: 'RK', name: 'n', millKind: 'TUBE' }), false);
  assert.ok(eq.validateEquipmentForSave('tubeBallMills', [], { code: 'A', name: 'a', millKind: 'ROD' }, { hierarchyIndex: { byId: new Map(), byCode: new Map(), nodes: [] } }).issues.some((i: any) => i.field === 'millKind'));
  assert.equal(pa.EQUIPMENT_TYPE_NOT_IDENTIFIED, 'EQUIPMENT TYPE NOT IDENTIFIED IN SOURCE');
});

test('23. labour, energy and standard rates are future-ready only - nothing is calculated', () => {
  assert.equal(pa.LABOR_DATA_SOURCE_STATUS, 'LABOR DATA SOURCE NOT AVAILABLE');
  assert.deepEqual(pa.validateStandardProductionRate({ operationId: 'op', quantityPerHour: 2, unit: 'طن', effectiveFrom: '2026-01-01' }), []);
  assert.deepEqual(pa.validateStandardProductionRate({ quantityPerHour: 0, effectiveFrom: 'x' }).map((i: any) => i.field), ['operationId', 'quantityPerHour', 'unit', 'effectiveFrom']);
  const code = readCode('src/services/productionAreaPure.ts');
  assert.equal(/cost|allocat|\* *quantityPerHour|firebase|fetchMasterData/i.test(code.replace(/StandardProductionRate|validateStandardProductionRate/g, '')), false);
});

test('24. the source reference is split only where it plainly says so', () => {
  assert.deepEqual(pa.parseSourceDocumentReference('ps04097/car65/car244'), { pressSlipReferences: ['PS04097'], furnaceCarNumbers: ['65', '244'], unparsed: [] });
  assert.deepEqual(pa.parseSourceDocumentReference('ps04097car12'), { pressSlipReferences: ['PS04097'], furnaceCarNumbers: ['12'], unparsed: [] });
  assert.deepEqual(pa.parseSourceDocumentReference('CAR23/مقاسات مختلفه'), { pressSlipReferences: [], furnaceCarNumbers: ['23'], unparsed: ['مقاسات مختلفه'] });
  assert.deepEqual(pa.parseSourceDocumentReference('رصيد'), { pressSlipReferences: [], furnaceCarNumbers: [], unparsed: ['رصيد'] });
  assert.deepEqual(pa.parseSourceDocumentReference(''), { pressSlipReferences: [], furnaceCarNumbers: [], unparsed: [] });
});

test('25. a correction of a new-stage record keeps its rules', () => {
  const stored = { id: 'r1', stageType: 'tunnel_kiln', date: '2026-01-01', productId: 'p-fb', productionQuantity: 5, materials: [] };
  const plan = rc.planRecordCorrection('tunnel_kiln', stored, { reason: 'fix', productionQuantity: 0 }, { consumption: {}, genealogy: {}, lookups: { operations: masters().operations } });
  assert.equal(plan.valid, false);
  assert.ok(plan.issues.some((i: any) => i.field === 'productionQuantity'));
});

// ==================================================
// O. ODOO MANUFACTURING ORDERS
// ==================================================

const HEAD = {
  Reference: '', 'Product Template/Internal Reference': '', 'Finished Product': '', 'Quantity Producing': '', 'Product Unit of Measure': '',
  Source: '', 'Scheduled Date': '', 'Components/Product Template': '', State: '', 'Components/Warehouse': '', 'Components/Quantity Done': '',
  'Components/UoM': '', 'Components/Product Category': '', 'Components/Product On Hand Quantity': '', 'Components/Source Location': '',
};
const mo = (over: Record<string, unknown>) => ({ ...HEAD, ...over });
const kilnRows = () => deepFreeze([
  mo({ Reference: 'الفرن النفقى/MO/01758', 'Product Template/Internal Reference': 'FBHA800404715', 'Finished Product': '[FBHA800404715] Under Burn Bricks', 'Quantity Producing': 9.24, 'Product Unit of Measure': 'Ton', Source: 'ps04097/car65/car244', 'Scheduled Date': 46023.04, 'Components/Product Template': '[GBHA800404715] Green Bricks', State: 'Done', 'Components/Warehouse': 'الفرن النفقى', 'Components/Quantity Done': 9.24, 'Components/UoM': 'Ton', 'Components/Product Category': 'منتجات المكابس' }),
  mo({ Reference: 'الفرن النفقى/MO/01759', 'Product Template/Internal Reference': 'FBHA800404715', 'Finished Product': '[FBHA800404715] Under Burn Bricks', 'Quantity Producing': 3, 'Product Unit of Measure': 'Ton', Source: 'CAR7/مقاسات مختلفه', 'Scheduled Date': 46024.5, 'Components/Product Template': '[GBHA800404715] Green Bricks', State: 'Done', 'Components/Quantity Done': 3, 'Components/UoM': 'Ton' }),
]);

test('26. an Odoo MO sheet is recognised by its columns and its sheet name', () => {
  assert.equal(od.isOdooManufacturingSheet(Object.keys(HEAD)), true);
  assert.equal(od.isOdooManufacturingSheet(['sourceRowId', 'stageType']), false);
  assert.equal(od.odooSheetStage('الفرن النفقي'), 'tunnel_kiln');
  assert.equal(od.odooSheetStage('الفرن النفقى'), 'tunnel_kiln', 'ى/ي spelling');
  assert.equal(od.odooSheetStage('الفرز و التغليف'), 'sorting');
  assert.equal(od.odooSheetStage('الطواحين العادية'), 'tube_ball_mills');
  assert.equal(od.odooSheetStage('كبس'), 'pressing');
  assert.equal(od.odooSheetStage('المونة والخرسانة'), od.AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE);
  assert.equal(od.odooSheetStage('Sheet1'), null);
});

test('27. an MO folds into one production payload with its components', () => {
  const r = od.normaliseOdooManufacturingSheet('الفرن النفقي', kilnRows());
  assert.equal(r.stage, 'tunnel_kiln');
  assert.deepEqual(r.counts, { production: 2, consumption: 2, outputs: 0, orphans: 0, duplicates: 0 });
  assert.deepEqual(r.records[0].payload, {
    sourceRowId: 'الفرن النفقى/MO/01758', stageType: 'tunnel_kiln', date: '2026-01-01',
    productCode: 'FBHA800404715', productName: 'Under Burn Bricks', manufacturingOrderNumber: 'الفرن النفقى/MO/01758',
    sourceDocumentReference: 'ps04097/car65/car244', productionQuantity: 9.24, productionUnit: 'طن', furnaceCarNumbers: ['65', '244'],
    materials: [{ lineId: 'L1', sequence: 1, itemCode: 'GBHA800404715', quantity: 9.24, unit: 'طن' }],
  });
  assert.deepEqual(r.records[0].issues, []);
  assert.ok(r.records[1].warnings.some((w: any) => /not understood/.test(w.messageEn)), 'unparsed source text is reported');
  assert.equal(r.records[0].origins[0].originalRowData.Source, 'ps04097/car65/car244', 'provenance kept');
  assert.equal('Components/Warehouse' in r.records[0].payload, false, 'provenance-only columns are not written');
});

test('28. Odoo unit names map explicitly and are reported; quantities never convert', () => {
  assert.deepEqual(od.mapOdooUnit('Ton'), { unit: 'طن', mapped: true, original: 'Ton' });
  assert.deepEqual(od.mapOdooUnit('m³'), { unit: 'م3', mapped: true, original: 'm³' });
  assert.deepEqual(od.mapOdooUnit('كجم'), { unit: 'كجم', mapped: false, original: 'كجم' });
  assert.deepEqual(od.mapOdooUnit('Bag'), { unit: null, mapped: false, original: 'Bag' });
  const r = od.normaliseOdooManufacturingSheet('الفرن النفقي', kilnRows());
  const fields = r.records[0].warnings.map((w: any) => w.field);
  assert.deepEqual(fields, ['productionUnit', 'materials.unit'], 'one warning per record for lines, not per line');
  assert.equal(r.records[0].payload.productionQuantity, 9.24);
});

test('29. continuation rows: components attach to their MO; zero-done components and extra finished products are reported, not imported', () => {
  const rows = deepFreeze([
    mo({ Reference: 'الفرن الدوار/MO/1', 'Product Template/Internal Reference': 'CHR3801202F', 'Finished Product': '[CHR3801202F] Kaolin', 'Quantity Producing': 300, 'Product Unit of Measure': 'Ton', 'Scheduled Date': 46023.5, 'Components/Product Template': '[CHR3800502] Kaolin', State: 'Done', 'Components/Quantity Done': 0, 'Components/UoM': 'Ton' }),
    mo({ 'Finished Product': '[CHR3800502] Kaolin' }),
    mo({ 'Components/Product Template': '[CHR4000401F] Kaolin', 'Components/Quantity Done': 450, 'Components/UoM': 'Ton' }),
    mo({}),
  ]);
  const r = od.normaliseOdooManufacturingSheet('الفرن الدوار', rows);
  const rec = r.records[0];
  assert.equal(rec.payload.materials.length, 1);
  assert.deepEqual(rec.payload.materials[0], { lineId: 'L1', sequence: 1, itemCode: 'CHR4000401F', quantity: 450, unit: 'طن' });
  assert.ok(rec.warnings.some((w: any) => /zero quantity done/.test(w.messageEn)));
  assert.ok(rec.warnings.some((w: any) => /further finished product/.test(w.messageEn)));
  assert.equal(rec.payload.productionOutputs, undefined, 'no output is invented');
  assert.equal(rec.outputCount, 0);
});

test('30. a continuation row before any MO is an orphan; a repeated MO reference blocks both', () => {
  const orphan = od.normaliseOdooManufacturingSheet('خلط', [mo({ 'Components/Product Template': '[X] x', 'Components/Quantity Done': 1, 'Components/UoM': 'Ton' }), ...kilnRows().slice(0, 1)]);
  assert.equal(orphan.orphans.length, 1);
  const dup = od.normaliseOdooManufacturingSheet('الفرن النفقي', [kilnRows()[0], kilnRows()[0]]);
  assert.equal(dup.counts.duplicates, 2);
  assert.ok(dup.records.every((x: any) => x.issues.some((i: any) => i.field === 'sourceRowId')));
});

test('31. never guessed: mortar vs thermal concrete, piece-counting stages, state, mill type', () => {
  const rows = kilnRows().map((r: any) => ({ ...r, 'Finished Product': '[LCC8001] Castable LCC 80%', 'Product Template/Internal Reference': 'LCC8001' }));
  const amb = od.normaliseOdooManufacturingSheet('المونة والخرسانة', rows);
  assert.equal(amb.stage, od.AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE);
  assert.ok(amb.sheetIssues.some((i: any) => i.field === 'stageType'));
  assert.equal(amb.records[0].payload.stageType, undefined);
  const chosen = od.normaliseOdooManufacturingSheet('المونة والخرسانة', rows, { stageOverride: 'thermal_concrete' });
  assert.deepEqual([chosen.sheetIssues.length, chosen.records[0].payload.stageType, chosen.records[0].payload.productionQuantity], [0, 'thermal_concrete', 9.24]);

  const press = od.normaliseOdooManufacturingSheet('كبس', kilnRows());
  assert.ok(press.records.every((x: any) => x.issues.some((i: any) => /Unit mismatch/.test(i.messageEn))));
  assert.equal(press.records[0].payload.productionQuantity, undefined, 'tons never go into a piece field');

  const draft = od.normaliseOdooManufacturingSheet('الفرن النفقي', [{ ...kilnRows()[0], State: 'Draft' }]);
  assert.ok(draft.records[0].issues.some((i: any) => i.field === 'state'));

  const mills = od.normaliseOdooManufacturingSheet('الطواحين العادية', kilnRows());
  assert.deepEqual(mills.notices, ['EQUIPMENT TYPE NOT IDENTIFIED IN SOURCE']);
  assert.equal(mills.records[0].payload.totalTons, 9.24);
  assert.equal('millKind' in mills.records[0].payload, false);
});

test('32. dates: the Excel serial becomes the calendar date, time dropped', () => {
  assert.equal(od.odooDateToIso(46023.04), '2026-01-01');
  assert.equal(od.odooDateToIso(46203.4995), '2026-06-30');
  assert.equal(od.odooDateToIso('2026-02-03 10:00:00'), '2026-02-03');
  assert.equal(od.odooDateToIso('46024'), '2026-01-02');
  assert.equal(od.odooDateToIso('yesterday'), null);
  assert.deepEqual(od.splitBracketCode('[CHS3600453C] Chamotte 45 micron-فلتر الطاحونة'), { code: 'CHS3600453C', name: 'Chamotte 45 micron-فلتر الطاحونة' });
  assert.deepEqual(od.splitBracketCode('رصيد'), { code: '', name: 'رصيد' });
});

test('33. an Odoo record goes through the SAME resolution and validation as any row', () => {
  const r = od.normaliseOdooManufacturingSheet('الفرن النفقي', kilnRows());
  const v = validate(r.records[0].payload);
  assert.deepEqual(v.errors, [], JSON.stringify(v.errors));
  assert.equal(v.normalized.productId, 'p-fb');
  assert.equal(v.normalized.materials[0].materialId, 'm-gb');
  assert.deepEqual(v.normalized.furnaceCarNumbers, ['65', '244']);
});

// ==================================================
// I. INTEGRATION AND SAFETY
// ==================================================

test('34. the import panel reads Odoo sheets through the one pipeline and asks for the ambiguous stage', () => {
  const panel = readCode('src/components/admin/EntityImportPanel.tsx');
  assert.ok(/isOdooManufacturingSheet\(workbookHeaders\(parsed\)\)/.test(panel));
  assert.ok(/normaliseOdooManufacturingSheet\(sheetName, rowsOfSheet, \{ stageOverride/.test(panel));
  assert.ok(/resolveAndValidateImportRow\('production'/.test(panel));
  assert.ok(panel.includes('id="entity-import-odoo-sheets"'));
  assert.ok(/buildOdooSession\(odooSheets, next, context, indexes, mappingCache, workbookFile, session\.importId\)/.test(panel), 'a stage choice revalidates under the same import id');
  assert.ok(/buildWorkbookSession\(/.test(panel), 'the Step 8C-4 workbook mode stays');
  const service = readCode('src/services/entityImportService.ts');
  assert.ok(/stageType\?: string \| readonly string\[\]/.test(service), 'equipment of every stage in the file is loaded');
});

test('35. the Odoo reader and the rule modules read and write nothing', () => {
  for (const rel of ['src/services/odooManufacturingImportPure.ts', 'src/services/productionAreaPure.ts', 'src/services/packagingActivityPure.ts']) {
    const code = readCode(rel);
    assert.equal(/firebase|fetchMasterData|addDoc|setDoc|updateDoc|collection\(/.test(code), false, rel);
  }
});

test('36. the new record types write through createStageRecord only, once', () => {
  const form = readCode('src/components/production/ProductionAreaEntryForm.tsx');
  assert.equal((form.match(/createStageRecord\(/g) ?? []).length, 1);
  assert.ok(/attachProductionReferences\(stage,/.test(form) && /prepareActualConsumption\(/.test(form) && /prepareProductionGenealogy\(/.test(form));
  assert.ok(/validateProductionAreaRecord\(stage,/.test(form));
  assert.ok(/stage === 'thermal_concrete' \? await preparePackagingActivity/.test(form), 'packing only on thermal concrete among the new stages');
  const view = readCode('src/components/production/StageProductionEntryView.tsx');
  assert.ok(/isProductionAreaStage\(activeStage\) && \(\s*<ProductionAreaEntryForm stage=\{activeStage\}/.test(view));
  const selector = readCode('src/components/production/ProductionStageSelector.tsx');
  for (const s of NEW) assert.ok(selector.includes(`id: '${s}'`), s);
});

test('37. rules for the new collections are defined in the repository only', () => {
  const rules = readSource('firestore.rules');
  for (const c of ['stage_thermal_concrete', 'stage_tunnel_kiln', 'stage_handmade_brick']) assert.ok(rules.includes(`match /${c}/{id}`), c);
  assert.ok(/NOT\s+\/\/ deployed by this step|NOT[\s\S]{0,20}deployed/.test(rules));
  assert.ok(readCode('src/services/backupService.ts').includes("'stage_tunnel_kiln'"), 'backup covers the new collections');
});

test('38. the source workbook is never imported by the repository', () => {
  const files = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }) as string[];
  const hits = files.filter((f) => /\.(ts|tsx)$/.test(String(f))).filter((f) => /انتاجيات|Downloads/.test(readCode(path.join('src', String(f)))));
  assert.deepEqual(hits, []);
  assert.equal(fs.existsSync(path.join(ROOT, 'scripts/_inspect_odoo.cjs')), false, 'no inspection script left behind');
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

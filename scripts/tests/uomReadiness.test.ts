/**
 * UOM STANDARDIZATION + DATA READINESS - Phase 1 Step 8.
 *
 * U  unit model: approved units, aliases, categories, one official unit per concept
 * C  conversions: physical facts vs business permission, nothing invented
 * R  readiness: BOM, production, consumption, outputs, master data - findings and summary
 * V  variance: Step 7 / 7A behaviour unchanged, production measure from the stage matrix
 * S  safety: no mutation, no scans, no collection, no write, UI read-only
 *
 * Run: npx tsx scripts/tests/uomReadiness.test.ts
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

console.log('uomReadiness.test.ts');

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

let uom: any;
let rd: any;
let bom: any;
let qv: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  uom = await load('src/services/uomPure.ts');
  rd = await load('src/services/uomReadinessPure.ts');
  bom = await load('src/services/bomPure.ts');
  qv = await load('src/services/quantityVariancePure.ts');
}

const UOM = 'src/services/uomPure.ts';
const READINESS = 'src/services/uomReadinessPure.ts';
const SERVICE = 'src/services/uomReadinessService.ts';
const PANEL = 'src/components/production/UomReadinessPanel.tsx';
// Step 8E appended the approved area and length units; nothing before them changed.
const APPROVED = ['طن', 'كجم', 'م3', 'لتر', 'شكارة', 'قطعة', 'm²', 'متر'];
const issues = (r: any) => r.findings.filter((f: any) => f.severity !== 'INFO').map((f: any) => [f.entityType, f.recordId, f.lineId, f.field, f.issue, f.severity]);

// ==================================================
// U. UNIT MODEL
// ==================================================

test('1-2. every approved unit is recognised, "شكارة" included, from the one existing unit list', () => {
  assert.deepEqual(uom.UOM_DEFINITIONS.map((d: any) => d.value), APPROVED);
  assert.deepEqual(uom.UOM_DEFINITIONS.map((d: any) => d.value), [...bom.BOM_UNITS], 'derived from bomPure.BOM_UNITS, not a second list');
  for (const u of APPROVED) assert.deepEqual([uom.normaliseUom(u).status, uom.normaliseUom(u).normalized], ['APPROVED', u], u);
  assert.equal(uom.getUomDefinition('شكارة').code, 'BAG');
  assert.ok(/import \{ BOM_UNITS, BOM_UNIT_LABELS, UNIT_SPELLING_ALIASES \} from '\.\/bomPure';/.test(readCode(UOM)));
});

test('3. "شيكارة" is a legacy alias only - normalised for validation, never an official unit', () => {
  const n = uom.normaliseUom('شيكارة');
  assert.deepEqual([n.status, n.original, n.normalized, n.definition.code], ['LEGACY_ALIAS', 'شيكارة', 'شكارة', 'BAG']);
  assert.equal(uom.getUomDefinition('شيكارة'), null);
});

test('4. an unknown or missing unit is reported, never replaced', () => {
  for (const v of ['XYZ', 't', 'kg', 'ton', 'pcs', 50]) assert.deepEqual([uom.normaliseUom(v).status, uom.normaliseUom(v).normalized], ['UNKNOWN', null], String(v));
  for (const v of ['', '  ', null, undefined]) assert.equal(uom.normaliseUom(v).status, 'MISSING', String(v));
});

test('5. no duplicate official unit: one definition per value and per code', () => {
  const values = uom.UOM_DEFINITIONS.map((d: any) => d.value);
  const codes = uom.UOM_DEFINITIONS.map((d: any) => d.code);
  assert.equal(new Set(values).size, values.length);
  assert.equal(new Set(codes).size, codes.length);
  for (const alias of Object.keys(bom.UNIT_SPELLING_ALIASES)) assert.equal(values.includes(alias), false, `${alias} is not selectable`);
});

test('6-9. categories: MASS, VOLUME, COUNT, PACKAGE, AREA, LENGTH - a bag is never mass', () => {
  const cat = (v: string) => uom.getUomDefinition(v).category;
  assert.deepEqual([cat('طن'), cat('كجم')], ['MASS', 'MASS']);
  assert.deepEqual([cat('م3'), cat('لتر')], ['VOLUME', 'VOLUME']);
  assert.equal(cat('قطعة'), 'COUNT');
  assert.equal(cat('شكارة'), 'PACKAGE');
  // Step 8E: the two approved units have their own categories, and neither is a mass or a volume.
  assert.deepEqual([cat('m²'), cat('متر')], ['AREA', 'LENGTH']);
  assert.deepEqual(uom.UOM_DEFINITIONS.filter((d: any) => d.measurable).map((d: any) => d.value), ['طن', 'كجم', 'م3', 'لتر'], 'only mass and volume have a known physical relation');
});

test('6-9b. the approved area and length units convert to nothing, in any context', () => {
  for (const [from, to] of [['m²', 'طن'], ['متر', 'طن'], ['m²', 'متر'], ['طن', 'm²']] as const) {
    for (const context of ['QUANTITY_VARIANCE', 'BOM_BASIS_CONSISTENCY', 'PRODUCTION_WEIGHT_REPORTING', 'IMPORT', 'COSTING'] as const) {
      const c = uom.uomCompatibility(from, to, context);
      assert.equal(c.status, 'CONVERSION_NOT_CONFIGURED', `${from}->${to} in ${context}`);
      assert.equal(c.physicalFactor, null, 'no physical factor is invented');
      assert.equal(c.businessFactor, null, 'no business factor is configured');
    }
  }
  assert.equal(uom.PHYSICAL_UOM_RELATIONS.some((r: any) => [r.from, r.to].includes('m²') || [r.from, r.to].includes('متر')), false);
  assert.equal(uom.EXISTING_BUSINESS_UOM_CONVERSIONS.some((c: any) => [c.from, c.to].includes('m²') || [c.from, c.to].includes('متر')), false);
  // An imported value in either unit is accepted outright - never blocked, never rewritten.
  for (const v of ['m²', 'متر']) {
    assert.deepEqual([uom.classifyImportedUom(v).accepted, uom.classifyImportedUom(v).normalized, uom.classifyImportedUom(v).severity], [true, v, 'INFO'], v);
  }
  // "m2" is the same unit written without the superscript: a spelling, with a warning.
  assert.deepEqual([uom.normaliseUom('m2').status, uom.normaliseUom('m2').normalized], ['LEGACY_ALIAS', 'm²']);
});

// ==================================================
// C. CONVERSIONS
// ==================================================

test('10. طن <-> كجم is a known physical relation - information, not permission', () => {
  assert.deepEqual(uom.PHYSICAL_UOM_RELATIONS, [{ from: 'طن', to: 'كجم', factor: 1000 }]);
  const c = uom.uomCompatibility('طن', 'كجم', 'QUANTITY_VARIANCE');
  assert.deepEqual([c.status, c.physicalFactor, c.businessFactor, c.sameCategory], ['PHYSICALLY_CONVERTIBLE', 1000, null, true]);
  assert.deepEqual([uom.uomCompatibility('كجم', 'طن', 'COSTING').status, uom.uomCompatibility('كجم', 'طن', 'COSTING').physicalFactor], ['PHYSICALLY_CONVERTIBLE', 0.001]);
});

test('11. no conversion outside explicit rules: only named contexts and configured factors are business-allowed', () => {
  for (const ctx of ['QUANTITY_VARIANCE', 'BOM_BASIS_CONSISTENCY', 'IMPORT', 'COSTING']) {
    assert.equal(uom.uomCompatibility('كجم', 'طن', ctx).businessFactor, null, ctx);
  }
  const reporting = uom.uomCompatibility('كجم', 'طن', 'PRODUCTION_WEIGHT_REPORTING');
  assert.deepEqual([reporting.status, reporting.businessFactor], ['BUSINESS_CONVERSION_ALLOWED', 0.001], 'the existing weight reporting conversion, recorded');
  const configured = [{ context: 'COSTING', from: 'شكارة', to: 'كجم', factor: 50, source: 'test configuration' }];
  assert.deepEqual([uom.uomCompatibility('شكارة', 'كجم', 'COSTING', configured).status, uom.uomCompatibility('شكارة', 'كجم', 'COSTING', configured).businessFactor], ['BUSINESS_CONVERSION_ALLOWED', 50], 'only when configured explicitly');
  assert.equal(uom.uomCompatibility('شكارة', 'كجم', 'QUANTITY_VARIANCE', configured).status, 'CONVERSION_NOT_CONFIGURED', 'never outside its context');
  assert.equal(uom.isValidBusinessUomConversion({ context: 'COSTING', from: 'شكارة', to: 'كجم', factor: 0, source: 'x' }), false);
  assert.equal(uom.isValidBusinessUomConversion({ context: 'COSTING', from: 'bag', to: 'كجم', factor: 50, source: 'x' }), false);
});

test('12-15. شكارة->كجم, قطعة->كجم, لتر->كجم, م3->طن (and قطعة->طن) stay CONVERSION_NOT_CONFIGURED', () => {
  for (const [from, to] of [['شكارة', 'كجم'], ['قطعة', 'كجم'], ['قطعة', 'طن'], ['لتر', 'كجم'], ['م3', 'طن'], ['م3', 'لتر']]) {
    const c = uom.uomCompatibility(from, to, 'COSTING');
    assert.deepEqual([c.status, c.physicalFactor, c.businessFactor], ['CONVERSION_NOT_CONFIGURED', null, null], `${from} -> ${to}`);
  }
  assert.equal(uom.uomCompatibility('شيكارة', 'شكارة', 'QUANTITY_VARIANCE').status, 'EXACT_MATCH', 'a spelling is not a conversion');
  assert.equal(uom.uomCompatibility('XYZ', 'كجم', 'COSTING').status, 'UNKNOWN_UOM');
  assert.equal(uom.uomCompatibility('', 'كجم', 'COSTING').status, 'MISSING_UOM');
});

test('W. import readiness: approved passes, a known alias passes as its approved value with a warning, unknown blocks', () => {
  assert.deepEqual(uom.classifyImportedUom('كجم'), { accepted: true, normalized: 'كجم', severity: 'INFO', status: 'APPROVED' });
  assert.deepEqual(uom.classifyImportedUom('شيكارة'), { accepted: true, normalized: 'شكارة', severity: 'WARNING', status: 'LEGACY_ALIAS' });
  assert.deepEqual(uom.classifyImportedUom('bag'), { accepted: false, normalized: null, severity: 'BLOCKING', status: 'UNKNOWN' });
  assert.deepEqual(uom.classifyImportedUom(''), { accepted: false, normalized: null, severity: 'BLOCKING', status: 'MISSING' });
});

// ==================================================
// R. READINESS
// ==================================================

const v = (id: string, over: Record<string, unknown> = {}) => ({ id, bomId: 'bom1', versionCode: 'V1', status: 'ACTIVE', basisQuantity: 1, basisUnit: 'طن', components: [{ lineId: 'L1', componentType: 'BASE', itemSource: 'materials', itemId: 'm-clay', quantity: 100, unit: 'كجم', percentage: null, sequence: 1 }], ...over });

test('16-17. a BOM basis with a positive quantity and an approved unit is ready; an unknown unit or a missing basis blocks', () => {
  const r = rd.analyzeUomReadiness(deepFreeze({ bomVersions: [v('v-ok'), v('v-xyz', { basisQuantity: 1000, basisUnit: 'XYZ' }), v('v-zero', { basisQuantity: 0 }), v('v-nobasis', { basisQuantity: null, basisUnit: null, components: [{ lineId: 'L1', itemSource: 'materials', itemId: 'm', quantity: null, unit: 'كجم', percentage: 100, sequence: 1 }] })], boms: [{ id: 'bom1', code: 'BOM-01' }] }));
  const okBasis = r.findings.find((f: any) => f.recordId === 'v-ok' && f.field === 'basisUnit');
  assert.deepEqual([okBasis.severity, okBasis.issue, okBasis.context, okBasis.category], ['INFO', 'READY', 'BOM-01 / V1', 'MASS']);
  assert.deepEqual(issues(r), [
    ['BOM_VERSION', 'v-nobasis', null, 'basisUnit', 'MISSING_BOM_BASIS', 'BLOCKING'],
    ['BOM_VERSION', 'v-xyz', null, 'basisUnit', 'UNKNOWN_UOM', 'BLOCKING'],
    ['BOM_VERSION', 'v-zero', null, 'basisQuantity', 'MISSING_BOM_BASIS', 'BLOCKING'],
  ]);
});

test('H. a percentage line in another unit than the basis: physical relation -> CONVERSION_NOT_CONFIGURED, none -> BASIS_UNIT_NOT_COMPATIBLE; values untouched', () => {
  const version = v('v1', { basisQuantity: 1000, basisUnit: 'كجم', components: [
    { lineId: 'L1', itemSource: 'materials', itemId: 'a', quantity: 0.1, unit: 'طن', percentage: 10, sequence: 1 },
    { lineId: 'L2', itemSource: 'materials', itemId: 'b', quantity: 2, unit: 'شكارة', percentage: 90, sequence: 2 },
  ] });
  const r = rd.analyzeUomReadiness(deepFreeze({ bomVersions: [version] }));
  assert.deepEqual(issues(r), [
    ['BOM_VERSION', 'v1', 'L1', 'components.unit', 'CONVERSION_NOT_CONFIGURED', 'WARNING'],
    ['BOM_VERSION', 'v1', 'L2', 'components.unit', 'BASIS_UNIT_NOT_COMPATIBLE', 'WARNING'],
  ]);
  assert.equal(version.components[0].unit, 'طن');
  assert.equal(version.basisQuantity, 1000, 'no basis rewritten');
});

test('18-19. production: a missing or legacy unit on a stored field is detected; an unknown stage has no production unit', () => {
  const r = rd.analyzeUomReadiness(deepFreeze({ stageRecords: [
    { id: 'rec-missing', stageType: 'mixing', data: { productionQuantity: 3, unit: '' } },
    { id: 'rec-alias', stageType: 'mixing', data: { productionQuantity: 3, productionUnit: 'شيكارة' } },
    // Step 8C-5 made tunnel_kiln a record type; an unknown stage key is used instead.
    { id: 'rec-odd', stageType: 'unknown_stage', data: { quantity: 9 } },
  ] }));
  const probs = issues(r);
  assert.ok(probs.some((p: any) => p[1] === 'rec-missing' && p[3] === 'unit' && p[4] === 'MISSING_UOM' && p[5] === 'BLOCKING'));
  assert.ok(probs.some((p: any) => p[1] === 'rec-alias' && p[3] === 'productionUnit' && p[4] === 'LEGACY_ALIAS' && p[5] === 'WARNING'));
  assert.ok(probs.some((p: any) => p[0] === 'STAGE' && p[1] === 'unknown_stage' && p[4] === 'MISSING_UOM'));
  const alias = r.findings.find((f: any) => f.recordId === 'rec-alias' && f.field === 'productionUnit');
  assert.deepEqual([alias.originalUom, alias.normalizedUom, alias.recommendedActionEn], ['شيكارة', 'شكارة', 'Replace the legacy spelling with the approved unit label.']);
});

test('20-21. consumption and output lines: unknown unit, non-positive quantity and unknown item are identified by record and line', () => {
  const data = {
    materials: [
      { lineId: 'L1', materialId: 'm-clay', quantity: 5, unit: 'كجم' },
      { lineId: 'L2', materialId: 'm-clay', quantity: 5, unit: 'kg' },
      { lineId: 'L3', materialId: 'm-ghost', quantity: 0, unit: 'كجم' },
    ],
    productionOutputs: [
      { lineId: 'L1', itemSource: 'products', itemId: 'p-brick', quantity: 1000, unit: 'قطعة' },
      { lineId: 'L2', itemSource: 'products', itemId: 'p-brick', quantity: 10, unit: 'XYZ' },
    ],
  };
  const r = rd.analyzeUomReadiness(deepFreeze({ stageRecords: [{ id: 'rec-1', stageType: 'mixing', data }], materials: [{ id: 'm-clay', code: 'CLAY', unit: 'كجم' }], products: [{ id: 'p-brick', code: 'BRK', unit: 'قطعة' }] }));
  assert.deepEqual(issues(r).filter((p: any) => p[0] !== 'STAGE'), [
    ['CONSUMPTION_LINE', 'rec-1', 'L2', 'materials.unit', 'UNKNOWN_UOM', 'BLOCKING'],
    ['CONSUMPTION_LINE', 'rec-1', 'L3', 'materials.materialId', 'UNKNOWN_ITEM', 'BLOCKING'],
    ['CONSUMPTION_LINE', 'rec-1', 'L3', 'materials.quantity', 'NOT_POSITIVE_QUANTITY', 'BLOCKING'],
    ['PRODUCTION_OUTPUT', 'rec-1', 'L2', 'productionOutputs.unit', 'UNKNOWN_UOM', 'BLOCKING'],
  ]);
  assert.deepEqual([r.summary.consumptionLinesAnalyzed, r.summary.productionOutputsAnalyzed, r.summary.productionRecordsAnalyzed], [3, 2, 1]);
});

test('L. a line unit that differs from its item\'s unit: physical relation -> warning, unrelated -> unit mismatch risk; never converted', () => {
  const data = { materials: [{ lineId: 'L1', materialId: 'm-clay', quantity: 0.5, unit: 'طن' }, { lineId: 'L2', materialId: 'm-clay', quantity: 3, unit: 'شكارة' }] };
  const r = rd.analyzeUomReadiness(deepFreeze({ stageRecords: [{ id: 'rec-1', stageType: 'mixing', data }], materials: [{ id: 'm-clay', unit: 'كجم' }] }));
  assert.deepEqual(issues(r).filter((p: any) => p[0] === 'CONSUMPTION_LINE').map((p: any) => [p[2], p[4], p[5]]), [['L1', 'CONVERSION_NOT_CONFIGURED', 'WARNING'], ['L2', 'UNIT_MISMATCH_RISK', 'WARNING']]);
});

test('J. the stage UOM matrix covers the 13 operations with the repository\'s real fields', () => {
  assert.deepEqual(rd.STAGE_UOM_MATRIX.map((s: any) => s.operationCode), ['OP-PRESS', 'OP-KILN', 'OP-CMILL', 'OP-TBM', 'OP-MIX', 'OP-MORTAR', 'OP-TCONC', 'OP-TUNNEL-KILN', 'OP-SORT', 'OP-PACK', 'OP-HAND', 'OP-FOAM', 'OP-EXTRUDER']);
  const seed = readCode('src/services/operationSeedPure.ts');
  for (const row of rd.STAGE_UOM_MATRIX) assert.ok(seed.includes(`code: '${row.operationCode}'`), row.operationCode);
  const byOp = Object.fromEntries(rd.STAGE_UOM_MATRIX.map((s: any) => [s.operationCode, s]));
  assert.deepEqual([byOp['OP-PRESS'].production.unit, byOp['OP-PRESS'].production.fields], ['قطعة', ['productionQuantity']]);
  // Phase 1 Step 8A corrected the Data Review list labels, so both stages are now READY.
  assert.deepEqual([byOp['OP-CMILL'].production.unit, byOp['OP-CMILL'].status, byOp['OP-CMILL'].reviewListUnit], ['طن', 'READY', 'طن']);
  assert.deepEqual([byOp['OP-SORT'].production.unit, byOp['OP-SORT'].status], ['قطعة', 'READY']);
  assert.deepEqual([byOp['OP-TBM'].production.fields, byOp['OP-TBM'].production.unit], [['totalTons'], 'طن']);
  // Phase 1 Step 8C-5: three operations became record types; packing and extrusion are sub-activities.
  assert.deepEqual(['OP-TCONC', 'OP-TUNNEL-KILN', 'OP-HAND'].map((op) => [byOp[op].stageType, byOp[op].status, byOp[op].production.unit]), [['thermal_concrete', 'READY', 'طن'], ['tunnel_kiln', 'READY', 'طن'], ['handmade_brick', 'READY', 'قطعة']]);
  for (const op of ['OP-PACK', 'OP-EXTRUDER']) assert.deepEqual([byOp[op].stageType, byOp[op].status], [null, 'SUB_ACTIVITY'], op);
  // The matrix follows the repository: Chinese Mills production is tons (importer header); the list label now uses the same rule.
  assert.ok(readSource('src/services/chineseMillsHistoricalImportService.ts').includes("'كمية الإنتاج (طن)'"));
  assert.ok(readCode('src/services/stageRecordService.ts').includes('unit: stageListQuantityUnit(st, d),'));
  assert.equal(readCode('src/services/stageRecordService.ts').includes('شيكارة'), false);
});

test('K. process, product and material quantities stay separate fields in their own units', () => {
  assert.deepEqual(rd.stageProductionMeasure('chinese_mills', { quantity: 3.75, numberOfBags: 75 }), { field: 'quantity', quantity: 3.75, unit: 'طن' });
  assert.deepEqual(rd.stageProductionMeasure('chinese_mills', { productionQuantity: 2 }), { field: 'productionQuantity', quantity: 2, unit: 'طن' });
  assert.deepEqual(rd.stageProductionMeasure('sorting', { totalCount: 900, totalTons: 4.05 }), { field: 'totalCount', quantity: 900, unit: 'قطعة' });
  assert.deepEqual(rd.stageProductionMeasure('mixing', {}), { field: 'productionQuantity', quantity: null, unit: 'طن' });
  // Step 8C-5: tunnel_kiln is now a record type (tons); an unknown stage still has no production unit.
  assert.deepEqual(rd.stageProductionMeasure('tunnel_kiln', { quantity: 1 }), { field: 'productionQuantity', quantity: null, unit: 'طن' });
  assert.deepEqual(rd.stageProductionMeasure('unknown_stage', { quantity: 1 }), { field: null, quantity: null, unit: null });
});

test('N. production unit vs the job\'s BOM basis: exact = ready, طن vs كجم = explicit normalization needed, قطعة vs طن = blocking', () => {
  const jobs = [{ id: 'j-t', code: 'J-T', bomVersionId: 'v-ton' }, { id: 'j-k', code: 'J-K', bomVersionId: 'v-kg' }];
  const bomVersions = [v('v-ton'), v('v-kg', { basisQuantity: 1000, basisUnit: 'كجم', components: [] })];
  const r = rd.analyzeUomReadiness(deepFreeze({ jobs, bomVersions, stageRecords: [
    { id: 'mix-ton', stageType: 'mixing', data: { productionQuantity: 2, jobReferenceId: 'j-t' } },
    { id: 'mix-kg', stageType: 'mixing', data: { productionQuantity: 2, jobReferenceId: 'j-k' } },
    { id: 'press-ton', stageType: 'pressing', data: { productionQuantity: 900, jobReferenceId: 'j-t' } },
  ] }));
  const prod = (id: string) => r.findings.find((f: any) => f.entityType === 'PRODUCTION_RECORD' && f.recordId === id);
  assert.deepEqual([prod('mix-ton').issue, prod('mix-ton').severity], ['READY', 'INFO']);
  assert.deepEqual([prod('mix-kg').issue, prod('mix-kg').severity], ['VARIANCE_REQUIRES_EXPLICIT_NORMALIZATION', 'WARNING']);
  assert.deepEqual([prod('press-ton').issue, prod('press-ton').severity, prod('press-ton').originalUom], ['CONVERSION_NOT_CONFIGURED', 'BLOCKING', 'قطعة']);
  assert.equal(prod('press-ton').context, 'job J-T');
});

test('28-29. the summary is deterministic, input order does not matter, and every finding names its source record', () => {
  const input = {
    stageRecords: [
      { id: 'b', stageType: 'chinese_mills', data: { quantity: 1, materials: [{ lineId: 'L1', materialId: 'm', quantity: 1, unit: 'شيكارة' }] } },
      { id: 'a', stageType: 'mixing', data: { productionQuantity: 1, materials: [{ lineId: 'L1', materialId: 'm', quantity: 1, unit: 'XYZ' }] } },
    ],
    materials: [{ id: 'm', code: 'M', unit: 't' }],
  };
  const one = rd.analyzeUomReadiness(deepFreeze(JSON.parse(JSON.stringify(input))));
  const two = rd.analyzeUomReadiness(deepFreeze({ ...JSON.parse(JSON.stringify(input)), stageRecords: [...input.stageRecords].reverse() }));
  assert.deepEqual(one, two);
  assert.deepEqual(one.summary, {
    // Step 8A: the Chinese Mills list label is corrected, so its stage row is READY rather than a unit-mismatch warning.
    totalAnalyzed: one.findings.length, ready: 2, warnings: 1, blocking: 2, unknownUom: 2, legacyAliases: 1, conversionNotConfigured: 0, unitMismatches: 0,
    bomVersionsAnalyzed: 0, productionRecordsAnalyzed: 2, consumptionLinesAnalyzed: 2, productionOutputsAnalyzed: 0,
  });
  for (const f of one.findings) assert.ok(f.entityType && f.recordId && f.field && f.severity && f.issue && f.recommendedActionEn && f.recommendedActionAr, JSON.stringify(f));
  const tMaterial = one.findings.find((f: any) => f.entityType === 'MATERIAL');
  assert.deepEqual([tMaterial.recordId, tMaterial.originalUom, tMaterial.issue, tMaterial.severity], ['m', 't', 'UNKNOWN_UOM', 'BLOCKING']);
  assert.deepEqual(Object.keys(rd.UOM_SUMMARY_LABELS), ['totalAnalyzed', 'ready', 'warnings', 'blocking', 'unknownUom', 'legacyAliases', 'conversionNotConfigured', 'unitMismatches']);
  assert.deepEqual(Object.values(rd.UOM_SUMMARY_LABELS).map((l: any) => l.ar), ['إجمالي السجلات', 'جاهز', 'تحذيرات', 'أخطاء مانعة', 'وحدات غير معروفة', 'مرادفات قديمة', 'تحويلات غير مهيأة', 'اختلافات الوحدات']);
});

test('27/T. recommended actions are factual - no assumed factor anywhere in the readiness wording', () => {
  const code = readSource(READINESS) + readSource(UOM);
  assert.equal(/=\s*(50|25|40)\s*(كجم|kg)|Assume|افترض/i.test(code), false);
  assert.ok(code.includes('Configure an explicit business conversion'));
});

// ==================================================
// V. VARIANCE COMPATIBILITY
// ==================================================

const vctx = (version: any) => deepFreeze({ jobs: [{ id: 'j1', bomVersionId: 'v1' }], bomVersions: [version], boms: [], logicalItems: [], products: [], materials: [] });
const line = (materialId: string, quantity: number, over: Record<string, unknown> = {}) => ({ lineId: `L-${materialId}`, sequence: 1, itemSource: 'materials', materialId, quantity, unit: 'كجم', componentType: 'BASE', ...over });

test('22. exact-unit variance is unchanged: طن production against a كجم basis is still not converted', () => {
  const version = { id: 'v1', bomId: 'b', versionCode: 'V1', status: 'ACTIVE', basisQuantity: 1000, basisUnit: 'كجم', components: [{ lineId: 'L1', itemSource: 'materials', itemId: 'm-clay', quantity: 100, unit: 'كجم', percentage: 10, sequence: 1 }] };
  const r = qv.analyseQuantityVariance(deepFreeze({ jobReferenceId: 'j1', materials: [line('m-clay', 200)], productionQuantity: 2, productionUnit: 'طن' }), vctx(version));
  assert.equal(r.basis.gap, 'UNIT_DIFFERS');
  assert.equal(r.rows[0].varianceQuantity, null);
  assert.equal(/uomPure|uomCompatibility|PHYSICAL_UOM_RELATIONS/.test(readCode('src/services/quantityVariancePure.ts')), false, 'the variance engine does not use physical relations');
});

test('23-24. Step 7A base and additive logic is unchanged', () => {
  const version = { id: 'v1', bomId: 'b', versionCode: 'V1', status: 'ACTIVE', basisQuantity: 1, basisUnit: 'طن', components: [
    { lineId: 'L1', componentType: 'BASE', itemSource: 'materials', itemId: 'm-clay', quantity: 100, unit: 'كجم', percentage: 100, sequence: 1 },
    { lineId: 'L2', componentType: 'ADDITIVE', itemSource: 'materials', itemId: 'm-acid', quantity: 5, unit: 'كجم', percentage: 0.5, sequence: 2 },
  ] };
  const r = qv.analyseQuantityVariance(deepFreeze({ jobReferenceId: 'j1', materials: [line('m-clay', 200), line('m-acid', 12, { componentType: 'ADDITIVE' })], productionQuantity: 2, productionUnit: 'طن' }), vctx(version));
  assert.deepEqual(r.rows.map((x: any) => [x.componentType, x.expectedQuantity, x.status]), [['BASE', 200, 'MATCHED'], ['ADDITIVE', 10, 'OVER_CONSUMED']]);
  assert.deepEqual([bom.bomFormula(version).baseTotal, bom.bomFormula(version).additiveTotal], [100, 0.5]);
});

test('V. the variance panel takes the production quantity from the stage matrix, not the review list label', () => {
  const panel = readCode('src/components/production/QuantityVariancePanel.tsx');
  assert.ok(/const measure = stageProductionMeasure\(record\.stageType, raw\);/.test(panel));
  assert.ok(/productionQuantity: measure\.quantity,\s*productionUnit: measure\.unit,/.test(panel));
  assert.equal(/productionUnit: record\.unit/.test(panel), false);
});

// ==================================================
// S. SAFETY
// ==================================================

test('25. analysis never mutates its input (deep-frozen) and historical values stay as found', () => {
  const input = deepFreeze({ stageRecords: [{ id: 'r', stageType: 'chinese_mills', data: { quantity: 1, materials: [{ lineId: 'L1', materialId: 'm', quantity: 1, unit: 'شيكارة' }] } }], materials: [{ id: 'm', unit: 'شيكارة' }] });
  const before = JSON.stringify(input);
  assert.doesNotThrow(() => rd.analyzeUomReadiness(input));
  assert.equal(JSON.stringify(input), before);
  const changed = [execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/services/productionService.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim(), stageRecordServiceChangedBeyondApproved(ROOT)].filter(Boolean).join('\n');
  assert.equal(changed, '', 'production read/write services untouched');
});

test('26. no new broad Firestore scans: pure modules read nothing, the service uses cache-first master data and the records already on screen', () => {
  assert.equal(/firebase|firestore|getDocs|collection\(|query\(/.test(readCode(UOM) + readCode(READINESS)), false);
  const service = readCode(SERVICE);
  assert.equal(/getDocs|query\(|where\(|fetchUniversalStageRecords|skipCache|subscribe/.test(service), false);
  assert.ok(/records\.map\(\(r\) => \(\{ id: r\.id, stageType: r\.stageType, data:/.test(service));
});

test('V/F. no write, migration, rule or collection; the UI is read-only in the existing Data Review screen', () => {
  const code = [UOM, READINESS, SERVICE, PANEL].map(readCode).join('\n');
  assert.equal(/addDoc|setDoc|updateDoc|deleteDoc|writeBatch|runTransaction|createMasterDataItem|updateMasterDataItem|logAuditAction|createMaterial/.test(code), false);
  assert.equal(/uom|unitOfMeasure|conversion/i.test(readSource('firestore.rules')), false);
  assert.equal(/uom|conversion/i.test(readCode('src/services/masterDataService.ts')), false);
  assert.equal((readCode('src/components/production/DataReviewView.tsx').match(/<UomReadinessPanel records=\{visibleRecords\} \/>/g) ?? []).length, 1);
  const nav = ['src/App.tsx', 'src/components/layout/Sidebar.tsx', 'src/components/layout/MobileNav.tsx', 'src/types/permissions.ts'].map(readCode).join('\n');
  assert.equal(/uom|readiness/i.test(nav), false, 'no new screen or permission');
  assert.equal(/<input(?![^>]*type="checkbox")|<select|onClick=\{[^}]*(save|update|fix|apply)/i.test(readCode(PANEL)), false, 'no edit controls');
});

test('X. new master-data unit entry uses approved values only - no free text, no "t"', () => {
  const smart = readCode('src/components/common/SmartEntitySelect.tsx');
  assert.ok(/UOM_DEFINITIONS\.map\(\(u\) => <option key=\{u\.code\} value=\{u\.value\}>/.test(smart));
  assert.ok(/unit: normaliseUom\(newExtra\)\.normalized \|\| 'طن',/.test(smart));
  assert.equal(/placeholder="طن \/ كجم/.test(smart), false);
  const multi = readCode('src/components/common/MultiSmartEntitySelect.tsx');
  assert.ok(/createMaterial\(\{ code, name, unit: 'طن',/.test(multi));
  assert.equal(/'طن' : 't'/.test(multi), false);
  const raw = readSource('src/components/admin/RawMaterialsView.tsx');
  const options = [...raw.slice(raw.indexOf('UNIT_OPTIONS'), raw.indexOf('];', raw.indexOf('UNIT_OPTIONS'))).matchAll(/value: '([^']+)'/g)].map((m) => m[1]);
  for (const u of options) assert.equal(uom.normaliseUom(u).status, 'APPROVED', u);
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

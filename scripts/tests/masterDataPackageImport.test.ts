/**
 * RECONCILED MASTER DATA PACKAGE - Phase 1 Step 8E.
 *
 * P  package readers: product master, mixes, exceptions
 * D  the decisions the business already took
 * U  upsert / idempotency: the same package twice creates nothing new
 * B  BOM, its single version and its components
 * S  safety: scope, no invention, existing data protected
 *
 * Run: npx tsx scripts/tests/masterDataPackageImport.test.ts
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

console.log('masterDataPackageImport.test.ts');

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

let pkg: any;
let session: any;
let entity: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  pkg = await load('src/services/masterDataPackagePure.ts');
  session = await load('src/services/masterDataPackageSessionPure.ts');
  entity = await load('src/services/entityImportPure.ts');
}

// --- fixtures: the package's own columns ------------------------------------------------

const productRow = (over: Record<string, unknown> = {}) => ({
  'Product Code': 'BHA6001',
  'Product Name': 'Bricks High Alumina 60%',
  'Product Tags': 'إنتاج تام',
  'Business Role': 'EXISTING_PRODUCT',
  ItemKind: 'OTHER',
  'Unit of Measure': 'Ton',
  'Quantity On Hand': '12',
  'Inventory Location': 'WH/Stock',
  'Product Category': 'FP / Sh / D-Bricks',
  'Costing Method': 'average',
  'Odoo External ID': '__export__.product_template_1',
  'Master Source': 'ODOO_PRODUCT_EXPORT',
  Notes: '',
  ...over,
});

const mixRow = (over: Record<string, unknown> = {}) => ({
  'BOM Reference': 'BHA6001',
  'BOM Odoo ID': '__export__.mrp_bom_1',
  'Product Code': 'BHA6001',
  'Product Name': 'Bricks High Alumina 60%',
  'Product Odoo ID': '__export__.product_template_1',
  'BOM Output Quantity': '1',
  'BOM Output UOM': 'Ton',
  'Component Code': 'MAT-1',
  'Component Name': 'Clay',
  'Component Odoo ID': '__export__.product_product_9',
  'Component Quantity': '0.6',
  'Original Source UOM': 'Ton',
  'Resolved Component UOM': 'Ton',
  'Component Role': 'COMPONENT',
  'UOM Resolution': 'PRODUCT_MASTER_UOM',
  'Source Row': '2',
  ...over,
});

const sheet = (rows: Array<Record<string, unknown>>, fileName = 'pkg.xlsx', sheetName = 'S1') => ({ fileName, sheetName, rows });

const build = (input: { products?: any[]; mixes?: any[]; exceptions?: any[]; existing?: any } = {}) =>
  session.buildMasterDataPackageSession({
    importSessionId: 'MDP-TEST',
    productSheets: input.products ? [sheet(input.products)] : [],
    mixSheets: input.mixes ? [sheet(input.mixes)] : [],
    exceptionSheets: input.exceptions ? [sheet(input.exceptions)] : [],
    existing: input.existing ?? { products: [], materials: [], boms: [], bomVersions: [] },
  });

/**
 * What the reviewer does before importing: accept every row's warnings. The BOM
 * rows are then re-derived by the same function the panel runs, so a BOM that
 * waited for its package items becomes importable exactly when they are.
 */
const reviewed = (result: any) => {
  const rows = session.evaluatePackageRows(result, result.staged.map((s: any) =>
    (s.row.warnings.length > 0 && !s.row.warningsAccepted ? entity.acceptRowWarnings(s.row, { user: 'reviewer', at: 'T' }) : s.row)));
  return { ...result, staged: result.staged.map((s: any, i: number) => ({ ...s, row: rows[i] })), counts: session.packageSessionCounts(result.staged, rows, result.exceptions) };
};

const rowOf = (result: any, kind: string, code?: string) =>
  result.staged.find((s: any) => s.kind === kind && (!code || String((s.row.normalizedData as any)?.code ?? (s.row.normalizedData as any)?.bom?.code ?? '') === code));

// ==================================================
// P. READERS
// ==================================================

test('1. the three package sheets are recognised by their own columns', () => {
  assert.equal(session.packageSheetKind(Object.keys(productRow())), 'PRODUCT_MASTER');
  assert.equal(session.packageSheetKind(Object.keys(mixRow())), 'MIXES');
  assert.equal(session.packageSheetKind(['Source Row', 'Exception Type', 'Key', 'Action / Note']), 'EXCEPTIONS');
  assert.equal(session.packageSheetKind(['Something', 'Else']), 'UNKNOWN');
});

test('2. a product row becomes a product; a raw material becomes a material', () => {
  const result = build({ products: [productRow(), productRow({ 'Product Code': 'MAT-1', 'Product Name': 'Clay', ItemKind: 'RAW_MATERIAL', 'Business Role': 'EXISTING_RAW_MATERIAL', 'Odoo External ID': '__export__.product_product_9' })] });
  assert.deepEqual(result.staged.map((s: any) => s.kind), ['products', 'materials']);
  const product = rowOf(result, 'products').row.normalizedData;
  assert.deepEqual([product.code, product.productCode, product.name, product.unit, product.itemKind], ['BHA6001', 'BHA6001', 'Bricks High Alumina 60%', 'طن', 'OTHER']);
  assert.equal(product.businessRole, 'EXISTING_PRODUCT');
  assert.deepEqual(product.externalRefs, [{ system: 'odoo', model: 'product.template', externalId: '__export__.product_template_1', externalCode: 'BHA6001' }]);
  assert.equal(rowOf(result, 'materials').row.normalizedData.itemKind, 'RAW_MATERIAL');
});

test('3. stock and costing columns are read but NEVER written', () => {
  const result = build({ products: [productRow()] });
  const payload = rowOf(result, 'products').row.normalizedData;
  for (const field of ['quantityOnHand', 'Quantity On Hand', 'inventoryLocation', 'Inventory Location', 'costingMethod', 'Costing Method']) {
    assert.equal((payload as any)[field], undefined, field);
  }
  assert.deepEqual([...pkg.PRODUCT_MASTER_PROVENANCE_ONLY], ['Quantity On Hand', 'Inventory Location', 'Costing Method']);
  // The raw sheet row is still kept beside the payload.
  assert.equal(rowOf(result, 'products').rawRow['Quantity On Hand'], '12');
});

test('4. package unit names map to approved units; a unit ASFOUR does not have DEFERS its own row only', () => {
  assert.deepEqual([pkg.mapPackageUnit('Ton').unit, pkg.mapPackageUnit('Kg').unit, pkg.mapPackageUnit('pc').unit, pkg.mapPackageUnit('عدد').unit, pkg.mapPackageUnit('m³').unit, pkg.mapPackageUnit('لتر').unit],
    ['طن', 'كجم', 'قطعة', 'قطعة', 'م3', 'لتر']);
  // A unit that is genuinely not in the ASFOUR UOM master is still deferred, never guessed.
  assert.equal(pkg.mapPackageUnit('فدان').unit, null);
  const result = build({ products: [productRow(), productRow({ 'Product Code': 'X-1', 'Unit of Measure': 'فدان' })] });
  const deferredRow = result.staged[1];
  // DEFERRED, never blocking: kept, excluded from this import, listed for the UOM phase.
  assert.equal(deferredRow.row.status, 'EXCLUDED');
  assert.equal(deferredRow.row.errors.length, 0, 'it is not a blocking row');
  assert.deepEqual(deferredRow.deferral, { reason: 'UNSUPPORTED_UOM', detail: 'فدان' });
  assert.ok(deferredRow.row.warnings.some((w: any) => /DEFERRED \(UNSUPPORTED_UOM\)/.test(w.messageEn)));
  assert.ok(deferredRow.row.resolutionHistory.some((d: any) => /UNSUPPORTED_UOM/.test(String(d.reason))), 'the reason is kept for the audit');
  assert.equal(rowOf(result, 'products', 'BHA6001').row.errors.length, 0, 'the good row is untouched');
  assert.equal(result.counts.blocking, 0, 'an unsupported unit never blocks the package');
  assert.equal(result.counts.deferredUnsupportedUom, 1);
  assert.deepEqual(result.unresolvedUnits, [{ unit: 'فدان', rows: 1 }]);
  assert.deepEqual(result.deferred.map((d: any) => [d.reason, d.code, d.sourceRow]), [['UNSUPPORTED_UOM', 'X-1', 3]]);
  // Nothing is converted and nothing is deleted: the raw row is still there.
  assert.equal(deferredRow.rawRow['Unit of Measure'], 'فدان');
});

test('4b. m² and متر are supported ASFOUR units: accepted, normalised, never converted', () => {
  // The approved values, and the plain spellings of the same units.
  assert.deepEqual([pkg.mapPackageUnit('m²').unit, pkg.mapPackageUnit('متر').unit], ['m²', 'متر']);
  assert.deepEqual([pkg.mapPackageUnit('m2').unit, pkg.mapPackageUnit('M2').unit, pkg.mapPackageUnit('sqm').unit], ['m²', 'm²', 'm²']);
  assert.deepEqual([pkg.mapPackageUnit('meter').unit, pkg.mapPackageUnit('metre').unit], ['متر', 'متر']);

  // The five products the business approved are ordinary rows now.
  const affected: Array<[string, string]> = [
    ['2201010020', 'm²'], ['3333016', 'm²'], ['3333017', 'm²'], ['4401010167', 'm²'], ['4401010152', 'متر'],
  ];
  const result = build({ products: affected.map(([code, unit], i) => productRow({ 'Product Code': code, 'Unit of Measure': unit, 'Odoo External ID': `__export__.product_template_${i + 10}` })) });
  assert.equal(result.counts.deferredUnsupportedUom, 0, 'none of them is deferred');
  assert.equal(result.counts.blocking, 0, 'and none of them blocks');
  assert.deepEqual(result.deferred, []);
  assert.deepEqual(result.unresolvedUnits, []);
  for (const [i, [code, unit]] of affected.entries()) {
    const staged = result.staged[i];
    assert.equal(staged.deferral, null, code);
    assert.equal(staged.row.selection, 'INCLUDED', code);
    assert.notEqual(staged.row.status, 'EXCLUDED', code);
    assert.deepEqual([staged.row.normalizedData.code, staged.row.normalizedData.unit], [code, unit], `${code} keeps its own unit`);
    // The unit name is normalised; the quantity columns are never touched.
    assert.equal(staged.row.normalizedData.quantityOnHand, undefined);
  }
});

// ==================================================
// D. THE DECISIONS
// ==================================================

test('5. the six purchased raw materials are RAW_MATERIAL measured in Ton', () => {
  assert.deepEqual([...pkg.DECIDED_PURCHASED_RAW_MATERIALS], ['21080101138', '2111020002', '2111020138', '2111020142', '2111030032', '2111030035']);
  const rows = pkg.DECIDED_PURCHASED_RAW_MATERIALS.map((code: string) =>
    productRow({ 'Product Code': code, 'Product Name': `خامة ${code}`, ItemKind: 'OTHER', 'Business Role': 'RAW_MATERIAL_PURCHASED', 'Unit of Measure': 'pc' }));
  const result = build({ products: rows });
  for (const staged of result.staged) {
    const n = staged.row.normalizedData;
    assert.equal(staged.kind, 'materials', n.code);
    assert.deepEqual([n.itemKind, n.unit], ['RAW_MATERIAL', 'طن'], n.code);
    assert.equal(staged.row.errors.length, 0);
  }
});

test('6. the two reject outputs are scrap outputs in Ton - never purchased raw materials', () => {
  assert.deepEqual([...pkg.DECIDED_SCRAP_REJECT_OUTPUTS], ['FBFCReject400001', 'FBFCReject400005']);
  const result = build({ products: pkg.DECIDED_SCRAP_REJECT_OUTPUTS.map((code: string) => productRow({ 'Product Code': code, 'Business Role': 'SCRAP_REJECT_OUTPUT', 'Unit of Measure': 'pc' })) });
  for (const staged of result.staged) {
    const n = staged.row.normalizedData;
    assert.equal(staged.kind, 'products', 'a reject output is not a purchased raw material');
    assert.equal(n.unit, 'طن');
    assert.equal(n.businessRole, 'SCRAP_REJECT_OUTPUT');
    assert.equal(n.itemKind, 'OTHER', 'the ItemKind architecture is not changed here');
    assert.ok(staged.row.warnings.some((w: any) => /reject \/ scrap output/.test(w.messageEn)));
  }
});

test('7. the three decided mixes output Ton, never Piece', () => {
  assert.deepEqual([...pkg.DECIDED_BOM_OUTPUT_TON], ['LCC-S9006', 'LCC8004', 'LCC-S8005']);
  for (const code of pkg.DECIDED_BOM_OUTPUT_TON) {
    const result = reviewed(build({
      products: [productRow({ 'Product Code': code }), productRow({ 'Product Code': 'MAT-1', ItemKind: 'RAW_MATERIAL' })],
      mixes: [mixRow({ 'BOM Reference': code, 'Product Code': code, 'BOM Output UOM': 'pc' })],
    }));
    const bom = rowOf(result, 'bomPackage');
    assert.equal(bom.row.normalizedData.version.basisUnit, 'طن', code);
    assert.ok(bom.row.warnings.some((w: any) => /Ton by a recorded decision/.test(w.messageEn)));
  }
});

test('8. CHR3600401F is IGNORED and NON-BLOCKING, and no second product is created for it', () => {
  assert.deepEqual([...pkg.IGNORED_IDENTITY_COLLISIONS], ['CHR3600401F']);
  const result = build({
    products: [productRow({ 'Product Code': 'CHR3600401F', 'Product Name': 'Calcined Kaolin' })],
    exceptions: [{ 'Exception Type': 'BLOCKING_CODE_COLLISION', Key: 'CHR3600401F', 'Action / Note': 'canonical first row retained' }],
  });
  const row = rowOf(result, 'products', 'CHR3600401F');
  assert.notEqual(row.row.status, 'BLOCKING', 'it never blocks the import');
  assert.equal(row.row.errors.length, 0);
  assert.ok(row.row.warnings.some((w: any) => /identity collision/i.test(w.messageEn)), 'it is recorded for the audit');
  assert.equal(result.staged.filter((s: any) => String(s.row.normalizedData?.code) === 'CHR3600401F').length, 1, 'exactly one product');
  assert.equal(result.exceptions[0].blocking, false);
  assert.equal(result.counts.blockingExceptions, 0);
});

test('9. a case-only duplicate is SKIPPED, never blocking and never merged', () => {
  // Two different records whose codes are the same once ASFOUR normalises the case.
  const result = build({ products: [productRow({ 'Product Code': 'BFC2501REJ مكابس', 'Product Name': 'A' }), productRow({ 'Product Code': 'BFC2501Rej مكابس', 'Product Name': 'B', 'Odoo External ID': '__export__.product_template_2' })] });
  const [first, second] = result.staged;
  assert.equal(first.row.errors.length, 0, 'the FIRST record stays canonical');
  assert.equal(first.row.selection, 'INCLUDED');
  assert.equal(second.row.status, 'SKIPPED', 'the later duplicate is skipped, not blocked');
  assert.equal(second.row.errors.length, 0);
  assert.equal(second.deferral.reason, 'DUPLICATE_CODE');
  assert.ok(/row 2/.test(second.deferral.detail), 'it names the row that was kept');
  assert.ok(second.row.warnings.some((w: any) => /no second product is created/.test(w.messageEn)));
  assert.ok(second.row.resolutionHistory.some((d: any) => /DUPLICATE_CODE/.test(String(d.reason))), 'the skipped row and its reason are kept for the audit');
  assert.equal(second.rawRow['Product Name'], 'B', 'the skipped source row is preserved in full');
  assert.equal(result.counts.blocking, 0);
  assert.equal(result.counts.skippedDuplicates, 1);
  // Two genuinely different codes are never touched by this rule.
  const genuine = build({ products: [productRow({ 'Product Code': 'AAA-1' }), productRow({ 'Product Code': 'AAA-2', 'Odoo External ID': '__export__.product_template_3' })] });
  assert.deepEqual(genuine.staged.map((s: any) => s.row.selection), ['INCLUDED', 'INCLUDED']);
  assert.equal(genuine.counts.skippedDuplicates, 0);
});

// ==================================================
// B. BOM
// ==================================================

test('10. a mix becomes one BOM with one version and its components, in the file\'s own order', () => {
  const result = reviewed(build({
    products: [productRow(), productRow({ 'Product Code': 'MAT-1', 'Product Name': 'Clay', ItemKind: 'RAW_MATERIAL' }), productRow({ 'Product Code': 'MAT-2', 'Product Name': 'Sand', ItemKind: 'RAW_MATERIAL' })],
    mixes: [mixRow(), mixRow({ 'Component Code': 'MAT-2', 'Component Name': 'Sand', 'Component Quantity': '0.4' })],
  }));
  const bom = rowOf(result, 'bomPackage');
  const n = bom.row.normalizedData;
  assert.deepEqual([n.bom.code, n.bom.name], ['BHA6001', 'Bricks High Alumina 60%']);
  assert.deepEqual(n.bom.externalRefs, [{ system: 'odoo', model: 'mrp.bom', externalId: '__export__.mrp_bom_1', externalCode: 'BHA6001' }]);
  assert.deepEqual([n.version.versionCode, n.version.status, n.version.effectiveFrom, n.version.effectiveTo], ['V1', 'DRAFT', null, null], 'no version or date is invented');
  // V1 is an internal ASFOUR version, never presented as an Odoo historical one.
  assert.ok(/INTERNAL ASFOUR VERSION/.test(n.version.notes));
  assert.ok(/no Odoo BOM version and no effective dates/.test(n.version.notes));
  assert.ok(/Activation is a separate human-approved step/.test(n.version.notes));
  assert.equal(n.odooBomId, '__export__.mrp_bom_1', 'the Odoo BOM id is preserved');
  assert.deepEqual([n.version.basisQuantity, n.version.basisUnit], [1, 'طن']);
  // The source row names each component by code, in the file's order ...
  assert.deepEqual(bom.row.originalRowData.version.components.map((c: any) => [c.lineId, c.sequence, c.itemCode]), [['L1', 1, 'MAT-1'], ['L2', 2, 'MAT-2']]);
  // ... and what is written (the validator's normalised form) carries the item it resolved to - here the
  // package's own materials, as pending tokens until their ids exist.
  assert.deepEqual(n.version.components.map((c: any) => [c.lineId, c.sequence, c.itemId, c.quantity, c.unit]), [
    ['L1', 1, session.packageItemToken('materials', 'MAT-1'), 0.6, 'طن'],
    ['L2', 2, session.packageItemToken('materials', 'MAT-2'), 0.4, 'طن'],
  ]);
  assert.equal(bom.row.originalRowData.version.components[0].componentType, undefined, 'the package states no BASE / ADDITIVE split');
  // The BOM model's own normal form reads an absent type as BASE (Step 7A) - its documented default, not a package value.
  assert.equal(n.version.components[0].componentType, 'BASE');
  assert.equal(bom.componentCount, 2);
});

test('11. one BOM split across two part files stays ONE BOM', () => {
  const result = reviewed(session.buildMasterDataPackageSession({
    importSessionId: 'MDP-TEST',
    productSheets: [sheet([productRow(), productRow({ 'Product Code': 'MAT-1', ItemKind: 'RAW_MATERIAL' }), productRow({ 'Product Code': 'MAT-2', ItemKind: 'RAW_MATERIAL' })])],
    mixSheets: [sheet([mixRow()], 'Part1.xlsx'), sheet([mixRow({ 'Component Code': 'MAT-2', 'Component Quantity': '0.4' })], 'Part2.xlsx')],
    exceptionSheets: [],
    existing: { products: [], materials: [], boms: [], bomVersions: [] },
  }));
  const boms = result.staged.filter((s: any) => s.kind === 'bomPackage');
  assert.equal(boms.length, 1, 'not two BOMs');
  assert.equal(boms[0].row.normalizedData.version.components.length, 2, 'its components are joined');
  assert.equal(boms[0].row.errors.length, 0, 'and it is not reported as a duplicate');
});

test('12. a component that resolves to nothing blocks its own BOM and creates no item', () => {
  const result = build({ products: [productRow()], mixes: [mixRow({ 'Component Code': 'NOT-IN-MASTER' })] });
  const bom = rowOf(result, 'bomPackage');
  assert.equal(bom.row.status, 'BLOCKING');
  assert.ok(bom.row.errors.some((e: any) => /no item is created from a name/.test(e.messageEn)));
  assert.equal(result.staged.filter((s: any) => s.kind === 'products' || s.kind === 'materials').length, 1, 'no product was invented');
});

test('13. a BOM component with no unit is a validation issue, never a guess - and other BOMs still import', () => {
  const result = reviewed(build({
    products: [productRow(), productRow({ 'Product Code': 'MAT-1', ItemKind: 'RAW_MATERIAL' })],
    mixes: [
      mixRow({ 'BOM Reference': 'GOOD', 'BOM Odoo ID': 'bom-good', 'Product Code': 'BHA6001' }),
      mixRow({ 'BOM Reference': 'BAD', 'BOM Odoo ID': 'bom-bad', 'Product Code': 'BHA6001', 'Resolved Component UOM': '', 'Original Source UOM': '' }),
    ],
  }));
  const good = result.staged.find((s: any) => s.kind === 'bomPackage' && s.row.rowId.includes('bom-good'));
  const bad = result.staged.find((s: any) => s.kind === 'bomPackage' && s.row.rowId.includes('bom-bad'));
  assert.equal(good.row.errors.length, 0, 'a bad row never blocks a good one');
  assert.equal(bad.row.status, 'BLOCKING');
  assert.ok(bad.row.errors.some((e: any) => /not approved - nothing is guessed/.test(e.messageEn)));
});

// ==================================================
// U. UPSERT AND IDEMPOTENCY
// ==================================================

test('14. an existing product is UPDATED by code, never duplicated, and its code is never rewritten', () => {
  const existing = [{ id: 'p1', code: 'BHA6001', name: 'Old name', unit: 'طن', active: true }];
  const result = build({ products: [productRow()], existing: { products: existing, materials: [], boms: [], bomVersions: [] } });
  const row = rowOf(result, 'products', 'BHA6001');
  assert.equal(row.upsertAction, 'UPDATE');
  assert.equal(row.matchedBy, 'CODE');
  assert.equal(row.row.normalizedData.existingId, 'p1');
  assert.ok(row.row.warnings.some((w: any) => /updated, not created again/.test(w.messageEn)));
  assert.equal(row.row.normalizedData.code, 'BHA6001', 'the code is unchanged');
  assert.equal(result.counts.productsToCreate, 0);
  assert.equal(result.counts.productsToUpdate, 1);
});

test('15. an existing product is also matched by its Odoo reference, never by name', () => {
  const existing = [{ id: 'p2', code: 'DIFFERENT-CODE', name: 'x', externalRefs: [{ system: 'odoo', model: 'product.template', externalId: '__export__.product_template_1' }] }];
  const found = pkg.findExistingMasterRecord(existing, { code: 'BHA6001', externalRefs: [{ system: 'odoo', model: 'product.template', externalId: '__export__.product_template_1' }] });
  assert.deepEqual([found.record.id, found.matchedBy], ['p2', 'EXTERNAL_REFERENCE']);
  const byName = pkg.findExistingMasterRecord([{ id: 'p3', code: 'OTHER', name: 'Bricks High Alumina 60%' }], { code: 'BHA6001', name: 'Bricks High Alumina 60%', externalRefs: [] });
  assert.deepEqual([byName.record, byName.matchedBy], [null, 'NONE'], 'a name never identifies a record');
});

test('16. running the same package twice creates nothing new', () => {
  const products = [productRow(), productRow({ 'Product Code': 'MAT-1', 'Product Name': 'Clay', ItemKind: 'RAW_MATERIAL', 'Odoo External ID': '__export__.product_product_9' })];
  const mixes = [mixRow()];
  const first = reviewed(build({ products, mixes }));
  const writtenProducts = first.staged.filter((s: any) => s.kind === 'products').map((s: any, i: number) => ({ id: `p${i}`, ...s.row.normalizedData }));
  const writtenMaterials = first.staged.filter((s: any) => s.kind === 'materials').map((s: any, i: number) => ({ id: `m${i}`, ...s.row.normalizedData }));
  const writtenBoms = first.staged.filter((s: any) => s.kind === 'bomPackage').map((s: any, i: number) => ({ id: `b${i}`, ...s.row.normalizedData.bom }));
  const writtenVersions = writtenBoms.map((b: any, i: number) => ({ id: `v${i}`, bomId: b.id, versionCode: pkg.PACKAGE_BOM_VERSION_CODE, status: 'DRAFT' }));

  const second = build({ products, mixes, existing: { products: writtenProducts, materials: writtenMaterials, boms: writtenBoms, bomVersions: writtenVersions } });
  assert.deepEqual([second.counts.productsToCreate, second.counts.materialsToCreate, second.counts.bomsToCreate], [0, 0, 0], 'nothing new');
  assert.deepEqual([second.counts.productsToUpdate, second.counts.materialsToUpdate, second.counts.bomsToUpdate], [1, 1, 1]);
  const bom = second.staged.find((s: any) => s.kind === 'bomPackage');
  assert.equal(bom.row.normalizedData.existingVersionId, 'v0');
  assert.ok(bom.row.warnings.some((w: any) => /not rewritten/.test(w.messageEn)), 'an existing version is never overwritten');
});

test('17. the write path upserts through the existing services and never deletes', () => {
  const service = readCode('src/services/entityImportService.ts');
  assert.ok(/case 'products':\s*case 'materials': \{/.test(service));
  assert.ok(/const changes = changedFieldsOnly\(current, patch\);[\s\S]{0,120}updateMasterDataItem\(collectionName, String\(existingId\), changes, steps\)/.test(service), 'an existing record is updated - only what changed');
  assert.ok(/createMasterDataItem\(collectionName, record, steps\)/.test(service), 'a new record uses the existing audited service');
  assert.ok(/UPDATABLE_MASTER_FIELDS/.test(service), 'only the allowed fields are updated');
  assert.equal(/deleteDoc|removeMasterDataItem|destructive/.test(service), false, 'nothing is deleted');
  assert.equal(/patch\.code\s*=/.test(service), false, 'an existing code is never rewritten');
  assert.ok(/upsertExternalReference/.test(service), 'external references are merged, never replaced');
  assert.deepEqual([...pkg.UPDATABLE_MASTER_FIELDS], ['name', 'productName', 'unit', 'category', 'itemKind', 'businessRole', 'notes', 'externalRefs']);
});

// ==================================================
// S. SAFETY AND SCOPE
// ==================================================

test('18. Odoo ids are external references, never ASFOUR ids', () => {
  const result = build({ products: [productRow()], mixes: [] });
  const payload = rowOf(result, 'products').row.normalizedData;
  assert.equal(payload.id, undefined);
  assert.equal(payload.externalRefs[0].externalId, '__export__.product_template_1');
  assert.equal(payload.externalRefs[0].system, 'odoo');
  const types = readCode('src/types/index.ts');
  assert.ok(/export interface Product extends WithExternalReferences/.test(types));
  assert.ok(/export interface Material extends WithExternalReferences/.test(types));
});

test('19. the package modules touch nothing outside product, material and BOM', () => {
  for (const rel of ['src/services/masterDataPackagePure.ts', 'src/services/masterDataPackageSessionPure.ts']) {
    const code = readCode(rel);
    assert.equal(/firebase|addDoc|setDoc|updateDoc|collection\(/.test(code), false, `${rel} writes nothing`);
    // Scope: it imports nothing from production, stock, employees, equipment or finance,
    // and names none of their collections. (English prose in a message is not a dependency.)
    assert.equal(/from '\.\/(production|stage|workOrder|odoo|employee|equipment|financial|costing)/i.test(code), false, `${rel} imports nothing out of scope`);
    assert.equal(/stage_|'workOrders'|'stockScrap'|'employees'|'presses'|'financialAccounts'|createStageRecord|createProductionRecord/.test(code), false, `${rel} names no out-of-scope collection`);
  }
  const service = readCode('src/services/entityImportService.ts');
  const packageCases = service.slice(service.indexOf("case 'products':"), service.indexOf("case 'jobReferences':"));
  assert.equal(/stage_|production|workOrders|stockScrap|employees/.test(packageCases), false, 'the package write path touches no production or stock collection');
});

test('20. no fuzzy matching decides anything, and no business value is invented', () => {
  const code = readCode('src/services/masterDataPackagePure.ts') + readCode('src/services/masterDataPackageSessionPure.ts');
  assert.equal(/fuzzy|levenshtein|similarity|rankFuzzyCandidates/i.test(code), false);
  // A blank unit is never filled in, a missing quantity is never zero.
  const result = build({ products: [productRow({ 'Unit of Measure': '' })], mixes: [mixRow({ 'Component Quantity': '' })] });
  assert.equal(result.staged[0].deferral.reason, 'UNSUPPORTED_UOM', 'a blank unit is deferred, never filled in');
  assert.equal(result.staged[0].row.errors.length, 0);
  const bom = result.staged.find((s: any) => s.kind === 'bomPackage');
  assert.ok(bom.row.errors.some((e: any) => /not a number/.test(e.messageEn)));
});

test('21. the review UI reuses the existing panel and the existing permission', () => {
  const panel = readCode('src/components/admin/EntityImportPanel.tsx');
  assert.ok(/mode === 'package'/.test(panel) || /value="package"/.test(panel));
  assert.ok(/buildMasterDataPackageSession\(/.test(panel));
  assert.ok(panel.includes('id="entity-import-package-files"'));
  assert.ok(panel.includes('id="entity-import-package"'));
  assert.ok(/hasPermission\('excel\.import'\)/.test(panel), 'the existing import right, no new permission');
  assert.equal((readCode('src/components/admin/DataImportView.tsx').match(/<EntityImportPanel/g) ?? []).length, 1, 'still one panel inside the existing centre');
  assert.ok(/executeEntityImport\(/.test(panel), 'the existing execution path');
});

test('22. every package row carries its provenance and its raw sheet row', () => {
  const result = build({ products: [productRow()], mixes: [mixRow()] });
  for (const staged of result.staged) {
    assert.equal(staged.provenance.sourceFile, 'pkg.xlsx');
    assert.equal(staged.provenance.sourceSheet, 'S1');
    assert.ok(staged.provenance.sourceRow >= 2);
    assert.ok(staged.rawRow && Object.keys(staged.rawRow).length > 0);
  }
  assert.equal(result.staged[0].provenance.masterSource, 'ODOO_PRODUCT_EXPORT');
  assert.equal(result.staged[1].provenance.packageSourceRow, '2');
});

test('23. the new kinds join the existing lifecycle without changing it', () => {
  assert.deepEqual([...entity.IMPORT_ENTITY_KINDS], [
    'jobReferences', 'batches', 'boms', 'bomVersions', 'routings', 'routingVersions', 'production',
    'products', 'materials', 'bomPackage',
  ]);
  // The rows are ordinary import rows: status, selection, warnings, corrections.
  const result = build({ products: [productRow()] });
  const row = result.staged[0].row;
  assert.deepEqual([row.selection, row.importedId, row.failureMessage], ['INCLUDED', null, null]);
  assert.ok(entity.IMPORT_ROW_STATUSES.includes(row.status));
  const corrected = entity.applyRowCorrection(row, { unit: 'كجم' }, { user: 'u', at: 'now', reason: 'fix' });
  assert.equal(corrected.correctedRowData.unit, 'كجم');
  assert.equal(corrected.originalRowData.unit, 'طن', 'the original value is kept');
});

test('24. the three non-import outcomes coexist and never stop a valid row', () => {
  const result = build({
    products: [
      productRow({ 'Product Code': 'GOOD-1' }),
      productRow({ 'Product Code': 'good-1', 'Product Name': 'case duplicate', 'Odoo External ID': '' }),
      productRow({ 'Product Code': 'UOM-1', 'Unit of Measure': 'فدان', 'Odoo External ID': '' }),
      productRow({ 'Product Code': '', 'Product Name': 'no code', 'Odoo External ID': '' }),
      productRow({ 'Product Code': 'GOOD-2', 'Odoo External ID': '' }),
    ],
  });
  // The two good rows carry the "unit read by name" warning, so they are WARNING - reviewable, not blocked.
  assert.deepEqual(result.staged.map((s: any) => s.row.status), ['WARNING', 'SKIPPED', 'EXCLUDED', 'BLOCKING', 'WARNING']);
  assert.deepEqual([result.counts.ready, result.counts.skippedDuplicates, result.counts.deferredUnsupportedUom, result.counts.blocking], [4, 1, 1, 1]);
  // The two valid rows are still importable.
  for (const staged of [result.staged[0], result.staged[4]]) {
    assert.equal(staged.row.selection, 'INCLUDED');
    assert.ok(staged.row.normalizedData);
  }
});

test('25. the same package produces the same session every time', () => {
  const products = [productRow(), productRow({ 'Product Code': 'bha6001', 'Odoo External ID': '' }), productRow({ 'Product Code': 'U-1', 'Unit of Measure': 'فدان', 'Odoo External ID': '' })];
  const mixes = [mixRow()];
  const a = build({ products, mixes });
  const b = build({ products, mixes });
  const shape = (r: any) => r.staged.map((s: any) => [s.row.rowId, s.row.status, s.row.selection, s.deferral?.reason ?? null, JSON.stringify(s.row.resolutionHistory)]);
  assert.deepEqual(shape(a), shape(b), 'deterministic - no timestamp and no randomness in a package decision');
  assert.deepEqual(a.counts, b.counts);
  assert.deepEqual(a.deferred, b.deferred);
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

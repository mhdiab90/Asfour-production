/**
 * MASTER DATA PACKAGE - DEPENDENCY AND PREVIEW/EXECUTION CONSISTENCY.
 *
 * The 3.21.0 defect: a BOM whose product or components are created by the SAME
 * package carried a blank item id; the preview showed it ready and the final
 * pre-write validation dropped it ("rows excluded before write"). These tests run
 * the real preview (buildMasterDataPackageSession + evaluatePackageRows) and the
 * real execution loop (executeImportRows) with a stand-in writer that only
 * records - no Firestore.
 *
 * Run: npx tsx scripts/tests/masterDataPackageDependency.test.ts
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

console.log('masterDataPackageDependency.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const readCode = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let S: any;
let L: any;
let X: any;
let P: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  S = await load('src/services/masterDataPackageSessionPure.ts');
  L = await load('src/services/entityImportPure.ts');
  X = await load('src/services/entityImportExecutionPure.ts');
  P = await load('src/services/masterDataPackagePure.ts');
}

// ---- fixtures ------------------------------------------------------------------------------------
const productRow = (over: Record<string, unknown> = {}) => ({
  'Product Code': 'BHA6001',
  'Product Name': 'Bricks High Alumina 60%',
  'Product Tags': 'إنتاج تام',
  'Business Role': 'EXISTING_PRODUCT',
  ItemKind: 'OTHER',
  'Unit of Measure': 'Ton',
  'Odoo External ID': '__export__.product_template_1',
  'Master Source': 'ODOO_PRODUCT_EXPORT',
  ...over,
});
const materialRow = (code: string, over: Record<string, unknown> = {}) =>
  productRow({ 'Product Code': code, 'Product Name': `Material ${code}`, ItemKind: 'RAW_MATERIAL', 'Odoo External ID': `__export__.product_template_${code}`, ...over });
const mixRow = (over: Record<string, unknown> = {}) => ({
  'BOM Reference': 'BHA6001',
  'BOM Odoo ID': '__export__.mrp_bom_1',
  'Product Code': 'BHA6001',
  'Product Name': 'Bricks High Alumina 60%',
  'BOM Output Quantity': '1',
  'BOM Output UOM': 'Ton',
  'Component Code': 'MAT-1',
  'Component Name': 'Clay',
  'Component Quantity': '0.6',
  'Original Source UOM': 'Ton',
  'Resolved Component UOM': 'Ton',
  'Component Role': 'COMPONENT',
  'Source Row': '2',
  ...over,
});
const sheet = (rows: Array<Record<string, unknown>>, fileName = 'pkg.xlsx') => ({ fileName, sheetName: 'S1', rows });
const EMPTY = { products: [], materials: [], boms: [], bomVersions: [] };

function build(input: { products?: any[]; mixes?: any[]; existing?: any }) {
  return S.buildMasterDataPackageSession({
    importSessionId: 'MDP-DEP',
    productSheets: input.products ? [sheet(input.products)] : [],
    mixSheets: input.mixes ? [sheet(input.mixes)] : [],
    exceptionSheets: [],
    existing: input.existing ?? EMPTY,
    validationContext: { customers: [], logicalItems: [] },
  });
}
/** The reviewer accepts every warning; BOM rows are re-derived by the panel's own function. */
function review(built: any, rows: any[] = built.staged.map((s: any) => s.row)) {
  return S.evaluatePackageRows(built, rows.map((r: any) => (r.warnings.length > 0 && !r.warningsAccepted ? L.acceptRowWarnings(r, { user: 'reviewer', at: 'T' }) : r)));
}
const bomRow = (rows: any[], code = 'BHA6001') => rows.find((r: any) => r.entityKind === 'bomPackage' && String(r.originalRowData.bom.code) === code);
const itemRow = (rows: any[], code: string) => rows.find((r: any) => (r.entityKind === 'products' || r.entityKind === 'materials') && String(r.originalRowData.code) === code);

/** Runs the REAL execution loop with a writer that records every write and hands out ids. */
async function execute(rows: any[], existing: any = EMPTY, failCodes: string[] = []) {
  const session = L.createImportSession({ importId: 'MDP-DEP', sourceFile: 'pkg', createdBy: 'reviewer', createdAt: 'T', rows });
  const planned = L.planImport(session).willImport.map((r: any) => r.rowId);
  const writes: Array<{ kind: string; rowId: string; data: any; id: string; context: any }> = [];
  let n = 0;
  const writer = async (row: any, context: any) => {
    const d = row.normalizedData ?? {};
    if (failCodes.includes(String(d.code ?? ''))) throw new Error('simulated write failure');
    const id = row.entityKind === 'bomPackage' ? (d.existingBomId || `fs-bom-${++n}`) : (d.existingId || `fs-${row.entityKind}-${++n}`);
    writes.push({ kind: row.entityKind, rowId: row.rowId, data: d, id, context });
    return id;
  };
  const out = await X.executeImportRows(session, { ...existing, customers: [], logicalItems: [] }, { indexes: {}, user: 'reviewer', at: () => 'T', language: 'en' }, writer);
  return { planned, writes, out, imported: out.rows.filter((r: any) => r.status === 'IMPORTED').map((r: any) => r.rowId) };
}

// ==================================================================================
// A. ITEMS CREATED IN THE SAME PACKAGE
// ==================================================================================

test('1. product and BOM in the same package, with no product in Firestore yet', async () => {
  const built = build({ products: [productRow(), materialRow('MAT-1')], mixes: [mixRow()] });
  const bom = bomRow(built.staged.map((s: any) => s.row));
  // Before any id exists, the reference is a pending token - never a blank id.
  assert.equal(bom.originalRowData.bom.itemId, S.packageItemToken('products', 'BHA6001'));
  const rows = review(built);
  assert.equal(bomRow(rows).errors.length, 0, 'after review the BOM is valid in the preview');
  const run = await execute(rows);
  assert.deepEqual(run.out.droppedBeforeWrite, [], 'nothing is excluded before write');
  assert.ok(run.imported.includes(bomRow(rows).rowId), 'the BOM is written in the same approved import');
});

test('2. a material and the BOM that uses it as a component, in the same package', async () => {
  const built = build({ products: [productRow(), materialRow('MAT-1')], mixes: [mixRow()] });
  const bom = bomRow(built.staged.map((s: any) => s.row));
  assert.equal(bom.originalRowData.version.components[0].itemSource, 'materials');
  assert.equal(bom.originalRowData.version.components[0].itemId, S.packageItemToken('materials', 'MAT-1'));
  const run = await execute(review(built));
  const material = run.writes.find((w) => w.kind === 'materials');
  const written = run.writes.find((w) => w.kind === 'bomPackage');
  assert.equal(written.data.version.components[0].itemId, material.id, 'the component is the id the material write returned');
});

test('3. the product created in the run is the BOM\'s product - by the id its write returned', async () => {
  const run = await execute(review(build({ products: [productRow(), materialRow('MAT-1')], mixes: [mixRow()] })));
  const product = run.writes.find((w) => w.kind === 'products');
  const bom = run.writes.find((w) => w.kind === 'bomPackage');
  assert.equal(bom.data.bom.itemId, product.id);
  assert.equal(X.carriesPackageItemToken(bom.data), false, 'no pending token is ever written');
  // Items are written first, then BOMs - whatever the file order.
  const lastItem = Math.max(...run.writes.map((w, i) => (w.kind === 'bomPackage' ? -1 : i)));
  const firstBom = run.writes.findIndex((w) => w.kind === 'bomPackage');
  assert.ok(lastItem < firstBom, 'every product and material precedes every BOM');
  // The BOM's final validation saw the item created in this run.
  assert.ok((bom.context.products ?? []).some((p: any) => p.id === product.id));
});

test('4. the material created in the run resolves for the BOM, and so does the product', async () => {
  const built = build({ products: [productRow(), materialRow('MAT-1'), materialRow('MAT-2')], mixes: [mixRow(), mixRow({ 'Component Code': 'MAT-2', 'Component Quantity': '0.4' })] });
  const run = await execute(review(built));
  const ids = Object.fromEntries(run.writes.filter((w) => w.kind === 'materials').map((w) => [w.data.code, w.id]));
  const bom = run.writes.find((w) => w.kind === 'bomPackage');
  assert.deepEqual(bom.data.version.components.map((c: any) => c.itemId), [ids['MAT-1'], ids['MAT-2']]);
});

// ==================================================================================
// B. ITEMS ALREADY IN ASFOUR
// ==================================================================================

test('5. an existing product with a new BOM: referenced by its own id, no token', async () => {
  const existing = { ...EMPTY, products: [{ id: 'p-existing', code: 'BHA6001', name: 'Bricks', unit: 'طن' }] };
  const built = build({ products: [materialRow('MAT-1')], mixes: [mixRow()], existing });
  const bom = bomRow(built.staged.map((s: any) => s.row));
  assert.equal(bom.originalRowData.bom.itemId, 'p-existing');
  const run = await execute(review(built), existing);
  assert.equal(run.writes.find((w) => w.kind === 'bomPackage').data.bom.itemId, 'p-existing');
});

test('6. an existing material with a new BOM: referenced by its own id, no token', async () => {
  const existing = { ...EMPTY, materials: [{ id: 'm-existing', code: 'MAT-1', name: 'Clay', unit: 'طن' }] };
  const built = build({ products: [productRow()], mixes: [mixRow()], existing });
  assert.equal(bomRow(built.staged.map((s: any) => s.row)).originalRowData.version.components[0].itemId, 'm-existing');
  const run = await execute(review(built), existing);
  assert.equal(run.writes.find((w) => w.kind === 'bomPackage').data.version.components[0].itemId, 'm-existing');
});

test('7. re-running the same package creates nothing, and never rewrites the BOM version', async () => {
  const input = { products: [productRow(), materialRow('MAT-1')], mixes: [mixRow()] };
  const first = await execute(review(build(input)));
  const strip = ({ existingId: _a, upsertAction: _b, matchedBy: _c, ...r }: any) => r;
  const existing = {
    products: first.writes.filter((w) => w.kind === 'products').map((w) => ({ ...strip(w.data), id: w.id })),
    materials: first.writes.filter((w) => w.kind === 'materials').map((w) => ({ ...strip(w.data), id: w.id })),
    boms: first.writes.filter((w) => w.kind === 'bomPackage').map((w) => ({ ...w.data.bom, id: w.id })),
    bomVersions: first.writes.filter((w) => w.kind === 'bomPackage').map((w, i) => ({ id: `v${i}`, bomId: w.id, versionCode: 'V1', status: 'DRAFT' })),
  };
  const second = build({ ...input, existing });
  assert.deepEqual([second.counts.productsToCreate, second.counts.materialsToCreate, second.counts.bomsToCreate], [0, 0, 0]);
  const rows = review(second);
  assert.equal(bomRow(rows).errors.length, 0, 'an existing BOM is never a duplicate of itself');
  const run = await execute(rows, existing);
  assert.deepEqual(run.out.droppedBeforeWrite, []);
  const bom = run.writes.find((w) => w.kind === 'bomPackage');
  assert.equal(bom.data.existingBomId, existing.boms[0].id, 'the same BOM is updated');
  assert.equal(bom.data.existingVersionId, 'v0', 'its version is recognised - the writer returns without rewriting it');
  assert.equal(run.writes.filter((w) => w.kind === 'products' || w.kind === 'materials').every((w) => String(w.id).startsWith('fs-')), true, 'items keep their ids');
});

test('7b. an unchanged stored record is a NO-OP update', () => {
  const current = { id: 'p1', name: 'Clay', unit: 'طن', externalRefs: [{ externalId: 'x', system: 'odoo' }] };
  assert.deepEqual(P.changedFieldsOnly(current, { name: 'Clay', unit: 'طن', externalRefs: [{ system: 'odoo', externalId: 'x' }] }), {}, 'key order does not matter');
  assert.deepEqual(P.changedFieldsOnly(current, { name: 'Clay 2', unit: 'طن' }), { name: 'Clay 2' });
  const service = readCode('src/services/entityImportService.ts');
  assert.equal((service.match(/changedFieldsOnly\(current,/g) ?? []).length, 2, 'items and BOM headers both skip unchanged writes');
});

// ==================================================================================
// C. PREVIEW = EXECUTION
// ==================================================================================

test('8. what the preview marks importable is exactly what the import writes', async () => {
  const built = build({
    products: [productRow(), materialRow('MAT-1'), productRow({ 'Product Code': 'P2', 'Product Name': 'Second', 'Odoo External ID': 'x2' })],
    mixes: [mixRow(), mixRow({ 'BOM Reference': 'P2', 'BOM Odoo ID': 'b2', 'Product Code': 'P2' }), mixRow({ 'BOM Reference': 'BAD', 'BOM Odoo ID': 'b3', 'Product Code': 'P2', 'Component Quantity': '0' })],
  });
  const rows = review(built);
  const run = await execute(rows);
  assert.deepEqual(run.imported.sort(), run.planned.sort(), 'planned == imported, row for row');
  assert.deepEqual(run.out.droppedBeforeWrite, [], 'no final-validation surprise');
  // Before review: a BOM waits for its items with the reason stated, and is not planned.
  const unreviewed = built.staged.map((s: any) => s.row);
  const waiting = bomRow(unreviewed);
  assert.ok(waiting.errors.some((e: any) => e.field === S.PACKAGE_DEPENDENCY_FIELD && /BHA6001/.test(e.messageEn) && /warnings are not accepted/.test(e.messageEn)));
  assert.equal(L.isRowWritable(waiting), false);
  assert.equal(built.counts.bomsWaitingForItems, 2, 'the two good BOMs wait; the bad one is blocked by its own data');
  assert.equal(built.counts.bomsBlockedByData, 1);
});

test('8b. excluding a package item blocks the BOMs that need it - in the preview, with the reason', () => {
  const built = build({ products: [productRow(), materialRow('MAT-1')], mixes: [mixRow()] });
  let rows = review(built);
  const material = itemRow(rows, 'MAT-1');
  rows = S.evaluatePackageRows(built, rows.map((r: any) => (r === material ? L.setRowSelection(r, 'EXCLUDED', { user: 'reviewer', at: 'T' }) : r)));
  const bom = bomRow(rows);
  assert.ok(bom.errors.some((e: any) => /MAT-1/.test(e.messageEn) && /excluded/.test(e.messageEn)));
  // Re-including it makes the BOM importable again.
  rows = S.evaluatePackageRows(built, rows.map((r: any) => (r.rowId === material.rowId ? L.setRowSelection(r, 'INCLUDED', { user: 'reviewer', at: 'T' }) : r)));
  assert.equal(bomRow(rows).errors.length, 0);
});

test('8c. an item whose write fails takes only its own BOMs with it, with the reason', async () => {
  const built = build({ products: [productRow(), materialRow('MAT-1'), productRow({ 'Product Code': 'P2', 'Product Name': 'Second', 'Odoo External ID': 'x2' })], mixes: [mixRow(), mixRow({ 'BOM Reference': 'P2', 'BOM Odoo ID': 'b2', 'Product Code': 'P2' })] });
  const run = await execute(review(built), EMPTY, ['BHA6001']);
  assert.ok(run.out.droppedBeforeWrite.some((d: any) => /BHA6001/.test(d.reason) && /not written in this import/.test(d.reason)), 'the dependent BOM is reported');
  assert.ok(run.writes.some((w) => w.kind === 'bomPackage' && w.data.bom.code === 'P2'), 'the other BOM is still written');
  assert.equal(run.writes.some((w) => X.carriesPackageItemToken(w.data)), false);
});

test('8d. the panel re-derives BOM rows by the same rules, and confirms what it runs', () => {
  const panel = readCode('src/components/admin/EntityImportPanel.tsx');
  assert.ok(/evaluatePackageRows\(packageSession, session\.rows\)/.test(panel), 'every session change re-derives the BOMs');
  assert.ok(/const toRun = mode === 'package' && packageSession \? \{ \.\.\.session, rows: evaluatePackageRows\(packageSession, session\.rows\) \}/.test(panel));
  assert.ok(/validationContext: ctx/.test(panel), 'the preview uses the same context the import loads');
  const session = readCode('src/services/masterDataPackageSessionPure.ts');
  assert.ok(/resolveAndValidateImportRow\('bomPackage', rowPayload\(row\), context, \{\}\)/.test(session), 'the preview runs the final validator');
});

// ==================================================================================
// D. BAD BOMS ARE VISIBLE BEFORE APPROVAL - AND BLOCK ONLY THEMSELVES
// ==================================================================================

test('9. a BOM that would fail at write time is BLOCKING in the preview, with the validator\'s reason', () => {
  const built = build({
    products: [productRow(), materialRow('MAT-1'), materialRow('MAT-2')],
    mixes: [
      mixRow({ 'BOM Reference': 'Q0', 'BOM Odoo ID': 'q0', 'Component Quantity': '0' }),
      mixRow({ 'BOM Reference': 'DUP', 'BOM Odoo ID': 'dup' }),
      mixRow({ 'BOM Reference': 'DUP', 'BOM Odoo ID': 'dup', 'Component Quantity': '0.4' }),
    ],
  });
  const rows = review(built);
  assert.ok(bomRow(rows, 'Q0').errors.some((e: any) => /quantity must be a number greater than zero/.test(e.messageEn)));
  assert.ok(bomRow(rows, 'DUP').errors.some((e: any) => /listed twice/.test(e.messageEn)));
  assert.equal(S.packageSessionCounts(built.staged, rows).bomsBlockedByData, 2);
});

test('10. a bad BOM never blocks a valid one', async () => {
  const built = build({
    products: [productRow(), materialRow('MAT-1')],
    mixes: [mixRow({ 'BOM Reference': 'GOOD', 'BOM Odoo ID': 'g' }), mixRow({ 'BOM Reference': 'BAD', 'BOM Odoo ID': 'b', 'Component Quantity': '-1' })],
  });
  const run = await execute(review(built));
  assert.deepEqual(run.writes.filter((w) => w.kind === 'bomPackage').map((w) => w.data.bom.code), ['GOOD']);
  assert.equal(run.writes.filter((w) => w.kind !== 'bomPackage').length, 2, 'the items are written regardless');
});

// ==================================================================================
// E. APPROVED DECISIONS STAY AS THEY WERE
// ==================================================================================

test('11. a case-only duplicate is SKIPPED; the BOM resolves to the first record, and one product is written', async () => {
  const built = build({ products: [productRow({ 'Product Code': 'ABC1' }), productRow({ 'Product Code': 'abc1', 'Odoo External ID': 'x9' }), materialRow('MAT-1')], mixes: [mixRow({ 'BOM Reference': 'ABC1', 'Product Code': 'abc1' })] });
  const rows = review(built);
  assert.equal(rows.filter((r: any) => r.selection === 'SKIPPED').length, 1);
  assert.equal(bomRow(rows, 'ABC1').errors.length, 0);
  const run = await execute(rows);
  assert.equal(run.writes.filter((w) => w.kind === 'products').length, 1, 'never a second product');
  assert.equal(run.writes.find((w) => w.kind === 'bomPackage').data.bom.itemId, run.writes.find((w) => w.kind === 'products').id);
});

test('12. CHR3600401F stays a non-blocking warning, and a BOM on it is importable after review', async () => {
  const built = build({ products: [productRow({ 'Product Code': 'CHR3600401F', 'Product Name': 'Calcined Kaolin' }), materialRow('MAT-1')], mixes: [mixRow({ 'BOM Reference': 'CHR3600401F', 'Product Code': 'CHR3600401F' })] });
  const product = itemRow(built.staged.map((s: any) => s.row), 'CHR3600401F');
  assert.equal(product.errors.length, 0);
  assert.ok(product.warnings.length > 0);
  const run = await execute(review(built));
  assert.deepEqual(run.out.droppedBeforeWrite, []);
  assert.equal(run.writes.filter((w) => w.kind === 'products').length, 1, 'one product only');
});

test('13. m² and متر are valid units in the same run - and no quantity is converted', async () => {
  const built = build({
    products: [productRow(), materialRow('FIB', { 'Unit of Measure': 'm²' }), materialRow('ROPE', { 'Unit of Measure': 'متر' })],
    mixes: [
      mixRow({ 'Component Code': 'FIB', 'Component Quantity': '2.5', 'Resolved Component UOM': 'm²', 'Original Source UOM': 'm²' }),
      mixRow({ 'Component Code': 'ROPE', 'Component Quantity': '3', 'Resolved Component UOM': 'متر', 'Original Source UOM': 'متر' }),
    ],
  });
  assert.equal(built.counts.deferredUnsupportedUom, 0);
  const run = await execute(review(built));
  const bom = run.writes.find((w) => w.kind === 'bomPackage');
  assert.deepEqual(bom.data.version.components.map((c: any) => [c.quantity, c.unit]), [[2.5, 'm²'], [3, 'متر']], 'each keeps its own unit and quantity');
});

test('14. the preview is deterministic', () => {
  const input = { products: [productRow(), materialRow('MAT-1'), productRow({ 'Product Code': 'abc', 'Odoo External ID': 'z' }), productRow({ 'Product Code': 'ABC', 'Odoo External ID': 'z2' })], mixes: [mixRow(), mixRow({ 'BOM Reference': 'Q', 'BOM Odoo ID': 'q', 'Component Quantity': '0' })] };
  const shape = (b: any) => JSON.stringify(b.staged.map((s: any) => [s.row.rowId, s.row.status, s.row.selection, s.row.errors.map((e: any) => e.messageEn), s.row.warnings.length]));
  assert.equal(shape(build(input)), shape(build(input)));
  assert.deepEqual(build(input).counts, build(input).counts);
});

test('15. a pending token is never an id: unresolved references are reported, and a token cannot be written', () => {
  const token = S.packageItemToken('products', 'Abc 1');
  assert.ok(S.isPackageItemToken(token));
  const bound = S.bindPackageItemReferences({ bom: { itemId: token }, version: { components: [{ itemId: 'real-id' }] } }, new Map());
  assert.deepEqual(bound.unresolved, [token.slice(S.PACKAGE_ITEM_TOKEN_PREFIX.length)]);
  const ok = S.bindPackageItemReferences({ bom: { itemId: token }, version: { components: [] } }, new Map([[S.packageItemKey('products', 'ABC 1'), 'fs-1']]));
  assert.deepEqual([ok.payload.bom.itemId, ok.unresolved], ['fs-1', []]);
  const loop = readCode('src/services/entityImportExecutionPure.ts');
  assert.ok(/if \(carriesPackageItemToken\(current\.normalizedData\)\) \{[\s\S]{0,200}throw new Error/.test(loop), 'a token that slipped through is refused, never written');
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
      console.log(String(err && err.stack ? err.stack : err).split('\n').slice(0, 6).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

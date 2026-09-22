/**
 * MASTER DATA PACKAGE WITH REAL REFERENCE INDEXES (3.21.3).
 *
 * The 3.21.2 import wrote 222 of 30,166 rows: the final re-check resolved each
 * new product's OWN productCode against the existing products ("No record
 * matches"), and read each BOM row's `version` object as a BOM version code. Every
 * earlier test ran with `indexes: {}`, so none of them could see it. These tests
 * build the indexes exactly as the live import does (buildReferenceIndexes over a
 * realistic stored context) and run the real preview and the real execution loop
 * with a recording writer - no Firestore.
 *
 * Run: npx tsx scripts/tests/masterDataPackageRealIndexes.test.ts
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

console.log('masterDataPackageRealIndexes.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const readCode = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let S: any;
let L: any;
let X: any;
let R: any;
let V: any;
let UI: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  S = await load('src/services/masterDataPackageSessionPure.ts');
  L = await load('src/services/entityImportPure.ts');
  X = await load('src/services/entityImportExecutionPure.ts');
  R = await load('src/services/referenceResolutionPure.ts');
  V = await load('src/services/importEntityValidationPure.ts');
  UI = await load('src/components/admin/ImportProgressPanel.tsx');
}

// ---- a realistic stored context: products, materials, BOMs and versions ALREADY in ASFOUR --------
const storedContext = () => ({
  products: [
    { id: 'st-p1', code: 'LEGACY-PRODUCT-1', name: 'Legacy product' },
    // Close to the package's codes, so a fuzzy suggestion WOULD fire if a product's own code were looked up.
    { id: 'st-p2', code: 'P10', name: 'Legacy P10' },
    { id: 'st-p3', code: 'P2X', name: 'Similar to P2' },
  ],
  materials: [{ id: 'st-m1', code: 'LEGACY-MAT-1', name: 'Legacy material' }],
  boms: [{ id: 'st-b1', code: 'LEGACY-BOM-1', itemSource: 'products', itemId: 'st-p1' }],
  bomVersions: [{ id: 'st-v1', bomId: 'st-b1', versionCode: 'V1', status: 'ACTIVE' }],
  customers: [],
  logicalItems: [],
});
const indexesOf = (ctx: any) => R.buildReferenceIndexes({ products: ctx.products, materials: ctx.materials, customers: ctx.customers, boms: ctx.boms, bomVersions: ctx.bomVersions });

function packageInput(products: number, materials: number, boms: number, extra: { productRows?: any[]; mixRows?: any[] } = {}) {
  const productRows: any[] = [];
  for (let i = 1; i <= products; i++) productRows.push({ 'Product Code': `P${i}`, 'Product Name': `Product ${i}`, ItemKind: 'OTHER', 'Unit of Measure': 'Ton', 'Odoo External ID': `pt_${i}` });
  for (let i = 1; i <= materials; i++) productRows.push({ 'Product Code': `M${i}`, 'Product Name': `Material ${i}`, ItemKind: 'RAW_MATERIAL', 'Unit of Measure': 'Ton', 'Odoo External ID': `mt_${i}` });
  const mixRows: any[] = [];
  for (let i = 1; i <= boms; i++) {
    mixRows.push({
      'BOM Reference': `B${i}`, 'BOM Odoo ID': `bom_${i}`, 'Product Code': `P${((i - 1) % products) + 1}`, 'Product Name': 'x',
      'BOM Output Quantity': '1', 'BOM Output UOM': 'Ton', 'Component Code': `M${((i - 1) % materials) + 1}`, 'Component Name': 'm',
      'Component Quantity': '0.5', 'Original Source UOM': 'Ton', 'Resolved Component UOM': 'Ton', 'Component Role': 'COMPONENT', 'Source Row': String(i + 1),
    });
  }
  return { productRows: [...productRows, ...(extra.productRows ?? [])], mixRows: [...mixRows, ...(extra.mixRows ?? [])] };
}
function build(input: { productRows: any[]; mixRows: any[] }, ctx: any) {
  return S.buildMasterDataPackageSession({
    importSessionId: 'MDP-REAL',
    productSheets: [{ fileName: 'pm.xlsx', sheetName: 'S', rows: input.productRows }],
    mixSheets: [{ fileName: 'mx.xlsx', sheetName: 'S', rows: input.mixRows }],
    exceptionSheets: [],
    existing: { products: ctx.products, materials: ctx.materials, boms: ctx.boms, bomVersions: ctx.bomVersions },
    validationContext: ctx,
  });
}
const review = (built: any) => S.evaluatePackageRows(built, built.staged.map((s: any) => (s.row.warnings.length > 0 ? L.acceptRowWarnings(s.row, { user: 'r', at: 'T' }) : s.row)));
const sessionOf = (rows: any[]) => L.createImportSession({ importId: 'MDP-REAL', sourceFile: 'pkg', createdBy: 'r', createdAt: 'T', rows });

async function execute(rows: any[], ctx: any, extra: Record<string, any> = {}) {
  const writes: Array<{ kind: string; action: string; code: string; id: string; data: any }> = [];
  const snapshots: any[] = [];
  let n = 0;
  const out = await X.executeImportRows(sessionOf(rows), ctx, {
    indexes: indexesOf(ctx), user: 'r', at: () => 'T', language: 'en', batchSize: 250, concurrency: 4, yieldToUi: async () => {},
    onProgress: (p: any) => snapshots.push(p), ...extra,
  }, async (row: any) => {
    const d = row.normalizedData ?? {};
    const existingId = row.entityKind === 'bomPackage' ? d.existingBomId : d.existingId;
    const id = existingId || `fs-${row.entityKind}-${++n}`;
    writes.push({ kind: row.entityKind, action: existingId ? 'update' : 'create', code: String(d.code ?? d.bom?.code ?? ''), id, data: d });
    return id;
  });
  return { out, writes, snapshots };
}
const storedAfter = (ctx: any, writes: any[]) => {
  const strip = ({ existingId: _a, upsertAction: _b, matchedBy: _c, ...r }: any) => r;
  return {
    ...ctx,
    products: [...ctx.products, ...writes.filter((w) => w.kind === 'products' && w.action === 'create').map((w) => ({ ...strip(w.data), id: w.id }))],
    materials: [...ctx.materials, ...writes.filter((w) => w.kind === 'materials' && w.action === 'create').map((w) => ({ ...strip(w.data), id: w.id }))],
    boms: [...ctx.boms, ...writes.filter((w) => w.kind === 'bomPackage' && w.action === 'create').map((w) => ({ ...w.data.bom, id: w.id }))],
    bomVersions: [...ctx.bomVersions, ...writes.filter((w) => w.kind === 'bomPackage' && w.action === 'create').map((w, i) => ({ id: `fs-v-${i}`, bomId: w.id, versionCode: 'V1', status: 'DRAFT' }))],
  };
};

// ==================================================================================
// A. THE TWO ROOT CAUSES
// ==================================================================================

test('1. a new product is never rejected because its OWN code is not among the stored products', () => {
  const ctx = storedContext();
  const indexes = indexesOf(ctx);
  const built = build(packageInput(20, 2, 0), ctx);
  const products = built.staged.filter((s: any) => s.kind === 'products');
  for (const s of products) {
    const recheck = V.resolveAndValidateImportRow('products', L.rowPayload(s.row), ctx, indexes);
    assert.deepEqual(recheck.errors, [], `${s.row.originalRowData.code}: ${JSON.stringify(recheck.errors)}`);
    assert.deepEqual(recheck.resolutions, [], 'no business-code lookup on a product row');
  }
  // P1 is close to the stored P10 / P2X: no fuzzy suggestion blocks it any more.
  assert.equal(indexes.product.records.length, 3, 'the index is real and non-empty');
});

test('2. material package rows still pass the final re-check', () => {
  const ctx = storedContext();
  const built = build(packageInput(2, 10, 0), ctx);
  for (const s of built.staged.filter((x: any) => x.kind === 'materials')) {
    assert.deepEqual(V.resolveAndValidateImportRow('materials', L.rowPayload(s.row), ctx, indexesOf(ctx)).errors, []);
  }
});

test('3. a BOM row\'s version object is never read as a BOM version code', () => {
  const ctx = storedContext();
  const built = build(packageInput(3, 2, 3), ctx);
  const bom = built.staged.find((s: any) => s.kind === 'bomPackage');
  // The object under `version` is structure, not a code - whatever the row kind.
  assert.equal(R.readReferenceValue({ version: { versionCode: 'V1' } }, 'bomVersionCode'), undefined);
  assert.equal(R.readReferenceValue({ version: 'V2' }, 'bomVersionCode'), 'V2', 'a real version code is still read');
  const resolved = R.resolveRowReferences('bomPackage', L.rowPayload(bom.row), indexesOf(ctx));
  assert.equal(resolved.resolutions.some((r: any) => r.field === 'bomVersionCode'), false);
  const recheck = V.resolveAndValidateImportRow('bomPackage', L.rowPayload(bom.row), built.previewContext, indexesOf(ctx));
  assert.equal(recheck.errors.some((e: any) => /bomVersionCode/.test(e.field)), false);
});

test('3b. business-code resolution is kept for every other kind', () => {
  const ctx = storedContext();
  const indexes = indexesOf(ctx);
  const job = V.resolveAndValidateImportRow('jobReferences', { code: 'J-1', productCode: 'LEGACY-PRODUCT-1' }, ctx, indexes);
  const product = job.resolutions.find((r: any) => r.field === 'productCode');
  assert.equal(product?.status, 'RESOLVED', 'a job still resolves the product it names');
  assert.equal(job.resolvedPayload.productId, 'st-p1');
  const unknown = V.resolveAndValidateImportRow('batches', { batchNumber: 'B-9', productCode: 'NO-SUCH' }, ctx, indexes);
  assert.ok(unknown.errors.some((e: any) => /productCode/.test(e.field)), 'and still refuses a product that does not exist');
  assert.deepEqual([...V.SELF_IDENTIFIED_IMPORT_KINDS], ['products', 'materials', 'bomPackage']);
});

// ==================================================================================
// B. PREVIEW = EXECUTION, WITH REAL INDEXES
// ==================================================================================

test('4. every row the preview marks importable is written - with the real indexes', async () => {
  const ctx = storedContext();
  const rows = review(build(packageInput(300, 20, 200), ctx));
  const planned = L.planImport(sessionOf(rows)).willImport.map((r: any) => r.rowId).sort();
  const run = await execute(rows, ctx);
  assert.deepEqual(run.out.droppedBeforeWrite, [], 'no final-validation surprise');
  assert.deepEqual(run.out.rows.filter((r: any) => r.status === 'IMPORTED').map((r: any) => r.rowId).sort(), planned);
  assert.equal(run.out.result.outcome, 'COMPLETED');
});

test('5. dependency order with real indexes: items first, then every BOM bound to their ids', async () => {
  const ctx = storedContext();
  const run = await execute(review(build(packageInput(40, 5, 30), ctx)), ctx);
  const lastItem = Math.max(...run.writes.map((w, i) => (w.kind === 'bomPackage' ? -1 : i)));
  assert.ok(lastItem < run.writes.findIndex((w) => w.kind === 'bomPackage'));
  const ids = new Map(run.writes.filter((w) => w.kind !== 'bomPackage').map((w) => [w.code, w.id]));
  for (const bom of run.writes.filter((w) => w.kind === 'bomPackage')) {
    assert.equal(bom.data.bom.itemId, ids.get(`P${((Number(bom.code.slice(1)) - 1) % 40) + 1}`));
    assert.equal(X.carriesPackageItemToken(bom.data), false);
  }
  assert.deepEqual(run.out.result.phasesCompleted, ['ITEMS', 'DEPENDENCIES', 'BOMS']);
});

test('6. items already stored are updated, never created again', async () => {
  const ctx = storedContext();
  const input = packageInput(5, 2, 0, { productRows: [{ 'Product Code': 'LEGACY-PRODUCT-1', 'Product Name': 'Legacy product', ItemKind: 'OTHER', 'Unit of Measure': 'Ton', 'Odoo External ID': 'pt_legacy' }] });
  const run = await execute(review(build(input, ctx)), ctx);
  const legacy = run.writes.find((w) => w.code === 'LEGACY-PRODUCT-1');
  assert.deepEqual([legacy.action, legacy.id], ['update', 'st-p1']);
});

test('7. no product code is created twice', async () => {
  const ctx = storedContext();
  const run = await execute(review(build(packageInput(200, 10, 50), ctx)), ctx);
  const created = run.writes.filter((w) => w.action === 'create' && w.kind === 'products').map((w) => w.code.toUpperCase());
  assert.equal(new Set(created).size, created.length);
  assert.equal(created.some((c) => ctx.products.some((p: any) => p.code.toUpperCase() === c)), false, 'a stored code is never created again');
});

// ==================================================================================
// C. EXISTING RULES UNCHANGED
// ==================================================================================

test('8. warning acceptance is unchanged: before acceptance, product rows wait and their BOMs wait for them', async () => {
  const ctx = storedContext();
  const built = build(packageInput(10, 2, 5), ctx);
  const unreviewed = built.staged.map((s: any) => s.row);
  const run = await execute(unreviewed, ctx);
  const writtenProducts = run.writes.filter((w) => w.kind === 'products').length;
  assert.equal(writtenProducts, unreviewed.filter((r: any) => r.entityKind === 'products' && L.isRowWritable(r)).length, 'only rows without pending warnings are written');
  assert.equal(run.writes.filter((w) => w.kind === 'bomPackage').length, 0);
  assert.ok(built.counts.bomsWaitingForItems > 0);
});

test('9. BOMs blocked by their own data stay blocked, and never block the others', async () => {
  const ctx = storedContext();
  const input = packageInput(10, 3, 5, {
    mixRows: [
      { 'BOM Reference': 'QZERO', 'BOM Odoo ID': 'q0', 'Product Code': 'P1', 'Product Name': 'x', 'BOM Output Quantity': '1', 'BOM Output UOM': 'Ton', 'Component Code': 'M1', 'Component Name': 'm', 'Component Quantity': '0', 'Original Source UOM': 'Ton', 'Resolved Component UOM': 'Ton', 'Component Role': 'COMPONENT', 'Source Row': '90' },
      { 'BOM Reference': 'TWICE', 'BOM Odoo ID': 't2', 'Product Code': 'P2', 'Product Name': 'x', 'BOM Output Quantity': '1', 'BOM Output UOM': 'Ton', 'Component Code': 'M1', 'Component Name': 'm', 'Component Quantity': '0.5', 'Original Source UOM': 'Ton', 'Resolved Component UOM': 'Ton', 'Component Role': 'COMPONENT', 'Source Row': '91' },
      { 'BOM Reference': 'TWICE', 'BOM Odoo ID': 't2', 'Product Code': 'P2', 'Product Name': 'x', 'BOM Output Quantity': '1', 'BOM Output UOM': 'Ton', 'Component Code': 'M1', 'Component Name': 'm', 'Component Quantity': '0.5', 'Original Source UOM': 'Ton', 'Resolved Component UOM': 'Ton', 'Component Role': 'COMPONENT', 'Source Row': '92' },
    ],
  });
  const rows = review(build(input, ctx));
  const blocked = rows.filter((r: any) => r.entityKind === 'bomPackage' && r.errors.length > 0).map((r: any) => r.originalRowData.bom.code).sort();
  assert.deepEqual(blocked, ['QZERO', 'TWICE']);
  const run = await execute(rows, ctx);
  assert.equal(run.writes.filter((w) => w.kind === 'bomPackage').length, 5, 'the five valid BOMs are written');
  assert.equal(run.writes.some((w) => w.code === 'QZERO' || w.code === 'TWICE'), false);
});

test('10. a case-only duplicate is still SKIPPED and the first record kept', async () => {
  const ctx = storedContext();
  const input = packageInput(3, 2, 0, { productRows: [{ 'Product Code': 'p1', 'Product Name': 'lower case twin', ItemKind: 'OTHER', 'Unit of Measure': 'Ton', 'Odoo External ID': 'pt_twin' }] });
  const rows = review(build(input, ctx));
  assert.equal(rows.filter((r: any) => r.selection === 'SKIPPED').length, 1);
  const run = await execute(rows, ctx);
  assert.equal(run.writes.filter((w) => w.code.toUpperCase() === 'P1').length, 1);
});

// ==================================================================================
// D. PROGRESS, COUNTERS AND THE CLOSE STATE
// ==================================================================================

test('11-13. 0% to a verified 100%, never 100% before, with counters that add up', async () => {
  const ctx = storedContext();
  const run = await execute(review(build(packageInput(400, 20, 300), ctx)), ctx);
  const running = run.snapshots.filter((s: any) => s.state === 'IMPORTING' || s.state === 'VERIFYING');
  assert.equal(X.progressPercent(running[0]), 0);
  for (let i = 1; i < running.length; i++) assert.ok(running[i].processed >= running[i - 1].processed);
  assert.ok(running.every((s: any) => X.progressPercent(s) < 100));
  const res = run.out.result;
  assert.equal(res.percent, 100);
  assert.equal(res.verification.ok, true);
  assert.equal(res.processed, res.total);
  assert.equal(res.succeeded + res.failed + res.skipped, res.processed);
  assert.equal(res.succeeded, run.writes.length, 'successful = the writes that happened');
});

test('14. for one run, the session count of imported rows equals the run\'s own successful count', async () => {
  const ctx = storedContext();
  const run = await execute(review(build(packageInput(100, 10, 60), ctx)), ctx);
  assert.equal(L.summariseSession(sessionOf(run.out.rows)).imported, run.out.result.succeeded);
  const panel = readCode('src/components/admin/EntityImportPanel.tsx');
  assert.ok(/Imported \(all runs in this window\)/.test(panel), 'the summary strip says it counts every run of the window');
  const progressPanel = readCode('src/components/admin/ImportProgressPanel.tsx');
  assert.ok(/- this run/.test(progressPanel), 'the final panel says it is this run');
});

test('15. the close state: a message for every outcome, and the close button only after a final result', () => {
  const ok = UI.closingMessage('COMPLETED', true);
  assert.equal(ok.title, 'انتهت عملية الاستيراد');
  assert.deepEqual(ok.lines, ['تمت معالجة جميع السجلات ووصلت العملية إلى 100%.', 'يمكنك الآن إغلاق هذه النافذة بأمان.']);
  const partial = UI.closingMessage('COMPLETED_WITH_ERRORS', true);
  assert.equal(partial.title, 'انتهت عملية الاستيراد مع وجود أخطاء');
  assert.deepEqual(partial.lines, ['انتهت عملية المعالجة ووصلت إلى 100%، ولكن توجد سجلات لم يتم استيرادها.', 'راجع النتيجة والتفاصيل قبل إغلاق النافذة.']);
  const stopped = UI.closingMessage('INTERRUPTED', true);
  assert.equal(stopped.title, 'توقفت عملية الاستيراد');
  assert.deepEqual(stopped.lines, ['تم حفظ نتائج السجلات التي تمت معالجتها حتى لحظة التوقف.', 'راجع السبب قبل إغلاق النافذة.']);
  assert.deepEqual([ok.icon, partial.icon, stopped.icon], ['✅', '⚠️', '⏸️']);
  // Success is only ever claimed for COMPLETED.
  assert.notEqual(UI.closingMessage('COMPLETED_WITH_ERRORS', true).icon, '✅');
  const progressPanel = readCode('src/components/admin/ImportProgressPanel.tsx');
  const finalBranch = progressPanel.slice(progressPanel.indexOf('if (final) {'), progressPanel.indexOf('if (progress) {'));
  assert.ok(/id="entity-import-close"/.test(finalBranch) && /إغلاق النافذة/.test(finalBranch), 'the close button lives in the final state only');
  assert.equal(/id="entity-import-close"/.test(progressPanel.slice(progressPanel.indexOf('if (progress) {'))), false, 'never while running');
  const panel = readCode('src/components/admin/EntityImportPanel.tsx');
  assert.ok(/onClose=\{finalResult && !busy \? onClose : undefined\}/.test(panel), 'offered only once the final result is shown');
  assert.equal(/setTimeout\([^)]*onClose/.test(panel), false, 'the window never closes by itself');
});

// ==================================================================================
// E. RE-RUN AND THE FULL-SIZE PACKAGE
// ==================================================================================

test('16-17. re-running the same package is idempotent: updates only, no duplicate, versions not rewritten', async () => {
  const ctx = storedContext();
  const input = packageInput(150, 10, 100);
  const first = await execute(review(build(input, ctx)), ctx);
  const after = storedAfter(ctx, first.writes);
  const second = await execute(review(build(input, after)), after);
  assert.equal(second.out.result.outcome, 'COMPLETED');
  assert.equal(second.writes.every((w) => w.action === 'update'), true);
  assert.equal(second.writes.filter((w) => w.kind === 'bomPackage').every((w) => w.data.existingVersionId), true);
  // Resuming the state 3.21.2 left - materials written, products not - creates each product once.
  const partial = storedAfter(ctx, first.writes.filter((w) => w.kind === 'materials'));
  const resumed = await execute(review(build(input, partial)), partial);
  // Every package product not already stored is created exactly once (the stored context holds P10 - that one is an update).
  const alreadyStored = input.productRows.filter((r: any) => /^P\d+$/.test(r['Product Code']) && ctx.products.some((p: any) => p.code === r['Product Code'])).length;
  assert.equal(alreadyStored, 1);
  assert.deepEqual([resumed.writes.filter((w) => w.kind === 'materials' && w.action === 'create').length, resumed.writes.filter((w) => w.kind === 'products' && w.action === 'create').length], [0, 150 - alreadyStored]);
  const createdCodes = resumed.writes.filter((w) => w.action === 'create' && w.kind === 'products').map((w) => w.code);
  assert.equal(new Set(createdCodes).size, createdCodes.length, 'no product created twice');
});

test('18. a package of the real size (30,166 planned rows) with real indexes: every planned row written', async () => {
  const ctx = storedContext();
  const t0 = Date.now();
  const built = build(packageInput(15872, 221, 14073), ctx);
  const run = await execute(review(built), ctx);
  const res = run.out.result;
  assert.equal(res.total, 30166);
  assert.equal(res.outcome, 'COMPLETED');
  assert.deepEqual([res.byKind.products.succeeded, res.byKind.materials.succeeded, res.byKind.bomPackage.succeeded], [15872, 221, 14073]);
  assert.deepEqual([res.skipped, res.failed, res.dropped.length], [0, 0, 0]);
  assert.ok(Date.now() - t0 < 90000, `${Date.now() - t0} ms`);
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

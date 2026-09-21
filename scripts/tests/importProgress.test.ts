/**
 * LARGE IMPORT EXECUTION - batches, live progress and the verified final result (3.21.2).
 *
 * Runs the REAL execution loop (executeImportRows) over REAL package sessions
 * (buildMasterDataPackageSession) with a stand-in writer that only records - no
 * Firestore, no import.
 *
 * Run: npx tsx scripts/tests/importProgress.test.ts
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

console.log('importProgress.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const readCode = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let S: any;
let L: any;
let X: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  S = await load('src/services/masterDataPackageSessionPure.ts');
  L = await load('src/services/entityImportPure.ts');
  X = await load('src/services/entityImportExecutionPure.ts');
}

// ---- a package of any size ------------------------------------------------------------------------
function packageInput(products: number, materials: number, boms: number) {
  const productRows = [];
  for (let i = 1; i <= products; i++) productRows.push({ 'Product Code': `P${i}`, 'Product Name': `Product ${i}`, ItemKind: 'OTHER', 'Unit of Measure': 'Ton', 'Odoo External ID': `pt_${i}` });
  for (let i = 1; i <= materials; i++) productRows.push({ 'Product Code': `M${i}`, 'Product Name': `Material ${i}`, ItemKind: 'RAW_MATERIAL', 'Unit of Measure': 'Ton', 'Odoo External ID': `mt_${i}` });
  const mixRows = [];
  for (let i = 1; i <= boms; i++) {
    mixRows.push({
      'BOM Reference': `B${i}`, 'BOM Odoo ID': `bom_${i}`, 'Product Code': `P${((i - 1) % products) + 1}`, 'Product Name': `Product ${i}`,
      'BOM Output Quantity': '1', 'BOM Output UOM': 'Ton', 'Component Code': `M${((i - 1) % materials) + 1}`, 'Component Name': 'm',
      'Component Quantity': '0.5', 'Original Source UOM': 'Ton', 'Resolved Component UOM': 'Ton', 'Component Role': 'COMPONENT', 'Source Row': String(i + 1),
    });
  }
  return { productRows, mixRows };
}
function build(input: { productRows: any[]; mixRows: any[] }, existing: any = { products: [], materials: [], boms: [], bomVersions: [] }) {
  return S.buildMasterDataPackageSession({
    importSessionId: 'MDP-PROGRESS',
    productSheets: [{ fileName: 'pm.xlsx', sheetName: 'S', rows: input.productRows }],
    mixSheets: [{ fileName: 'mx.xlsx', sheetName: 'S', rows: input.mixRows }],
    exceptionSheets: [],
    existing,
    validationContext: { customers: [], logicalItems: [] },
  });
}
function reviewedSession(built: any) {
  const rows = S.evaluatePackageRows(built, built.staged.map((s: any) => (s.row.warnings.length > 0 ? L.acceptRowWarnings(s.row, { user: 'r', at: 'T' }) : s.row)));
  return L.createImportSession({ importId: 'MDP-PROGRESS', sourceFile: 'pkg', createdBy: 'r', createdAt: 'T', rows });
}

/** Runs the real loop; records progress snapshots, yields, writes and the peak number of writes in flight. */
async function run(session: any, opts: Record<string, any> = {}, writerOpts: { fail?: (row: any) => boolean } = {}) {
  const snapshots: any[] = [];
  const writes: Array<{ kind: string; code: string; id: string; existing: boolean }> = [];
  let yields = 0;
  let inFlight = 0;
  let peak = 0;
  let sinceYield = 0;
  let maxBetweenYields = 0;
  let n = 0;
  const writer = async (row: any) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    sinceYield++;
    maxBetweenYields = Math.max(maxBetweenYields, sinceYield);
    await Promise.resolve();
    inFlight--;
    const d = row.normalizedData ?? {};
    if (writerOpts.fail?.(row)) throw new Error(`simulated failure for ${d.code ?? d.bom?.code}`);
    const existingId = row.entityKind === 'bomPackage' ? d.existingBomId : d.existingId;
    const id = existingId || `fs-${row.entityKind}-${++n}`;
    writes.push({ kind: row.entityKind, code: String(d.code ?? d.bom?.code ?? ''), id, existing: Boolean(existingId) });
    return id;
  };
  const out = await X.executeImportRows(session, { customers: [], logicalItems: [], products: [], materials: [], boms: [], bomVersions: [], ...(opts.context ?? {}) }, {
    indexes: {}, user: 'r', at: () => 'T', language: 'en', batchSize: 50, concurrency: 4,
    yieldToUi: async () => { yields++; sinceYield = 0; },
    onProgress: (p: any) => { snapshots.push(p); opts.onProgress?.(p, snapshots.length); },
    ...opts.options,
  }, writer);
  return { out, snapshots, writes, yields, peak, maxBetweenYields };
}

// ==================================================================================
// A. PERCENTAGE
// ==================================================================================

test('1. the percentage rule: floor(processed / total), clamped, and 100 only when completed and verified', () => {
  const p = (processed: number, total: number, state = 'IMPORTING') => X.progressPercent({ state, processed, total });
  assert.equal(p(0, 30166), 0);
  assert.equal(p(23540, 30166), 78, 'floor');
  assert.equal(p(30166, 30166), 99, 'all rows done but not verified: never 100');
  assert.equal(p(30166, 30166, 'VERIFYING'), 99);
  assert.equal(p(-5, 10), 0, 'clamped at 0');
  assert.equal(p(50, 10), 99, 'clamped below 100 while running');
  assert.equal(X.progressPercent({ state: 'COMPLETED', processed: 30166, total: 30166 }, true), 100);
  assert.equal(X.progressPercent({ state: 'COMPLETED', processed: 30166, total: 30166 }, false), 99, 'not verified -> not 100');
});

test('2. progress starts at 0%, only grows, and reaches exactly 100% only in the verified result', async () => {
  const r = await run(reviewedSession(build(packageInput(120, 10, 100))));
  assert.equal(X.progressPercent(r.snapshots[0]), 0, 'starts at 0');
  assert.equal(r.snapshots[0].processed, 0);
  const running = r.snapshots.filter((s: any) => s.state === 'IMPORTING' || s.state === 'VERIFYING');
  for (let i = 1; i < running.length; i++) assert.ok(running[i].processed >= running[i - 1].processed, 'never goes backwards');
  assert.ok(running.every((s: any) => X.progressPercent(s) < 100), '100% is never shown while running');
  assert.ok(running.some((s: any) => X.progressPercent(s) > 0 && X.progressPercent(s) < 99), 'it passes through intermediate values');
  assert.equal(r.out.result.outcome, 'COMPLETED');
  assert.equal(r.out.result.percent, 100);
  assert.equal(r.out.result.processed, r.out.result.total);
});

// ==================================================================================
// B. PHASES
// ==================================================================================

test('3. three phases in dependency order: Products & Materials, Resolving Dependencies, BOMs', async () => {
  const r = await run(reviewedSession(build(packageInput(60, 6, 40))));
  const phases = r.snapshots.map((s: any) => `${s.phase}:${s.phaseNumber}/${s.phaseCount}`);
  const firstOf = (p: string) => phases.findIndex((x: string) => x.startsWith(p));
  assert.ok(firstOf('ITEMS:1/3') >= 0 && firstOf('DEPENDENCIES:2/3') > firstOf('ITEMS:1/3') && firstOf('BOMS:3/3') > firstOf('DEPENDENCIES:2/3'));
  assert.deepEqual(r.out.result.phasesCompleted, ['ITEMS', 'DEPENDENCIES', 'BOMS']);
  const lastItem = Math.max(...r.writes.map((w, i) => (w.kind === 'bomPackage' ? -1 : i)));
  const firstBom = r.writes.findIndex((w) => w.kind === 'bomPackage');
  assert.ok(lastItem < firstBom, 'no BOM is written before every product and material');
  // The dependency phase reports its own position.
  const dep = r.snapshots.filter((s: any) => s.phase === 'DEPENDENCIES');
  assert.equal(dep[dep.length - 1].phaseProcessed, 40);
  // Every BOM was bound to the ids its items received.
  assert.equal(r.out.result.byKind.bomPackage.succeeded, 40);
});

test('4. an import without BOMs has one phase', async () => {
  const input = packageInput(30, 5, 0);
  const r = await run(reviewedSession(build({ ...input, mixRows: [] })));
  assert.ok(r.snapshots.filter((s: any) => s.phaseNumber > 0).every((s: any) => s.phaseCount === 1 && (s.phase === 'RECORDS' || s.phase === 'VERIFYING' || s.phase === 'DONE')));
  assert.deepEqual(r.out.result.phasesCompleted, ['RECORDS']);
  assert.equal(r.out.result.outcome, 'COMPLETED');
});

// ==================================================================================
// C. OUTCOMES
// ==================================================================================

test('5. a successful import: every counter comes from the real writes', async () => {
  const r = await run(reviewedSession(build(packageInput(100, 10, 80))));
  const res = r.out.result;
  assert.equal(res.outcome, 'COMPLETED');
  assert.equal(res.succeeded, r.writes.length, 'successful = what the writer actually wrote');
  assert.deepEqual([res.byKind.products.succeeded, res.byKind.materials.succeeded, res.byKind.bomPackage.succeeded], [100, 10, 80]);
  assert.deepEqual([res.failed, res.skipped, res.failures.length, res.dropped.length], [0, 0, 0, 0]);
  assert.equal(res.verification.ok, true);
  assert.equal(res.warnings, r.out.rows.filter((row: any) => row.status === 'IMPORTED' && row.warnings.length > 0).length);
});

test('6. failed records: completes WITH ERRORS at 100%, lists every failure, and drops only the dependent BOMs', async () => {
  const r = await run(reviewedSession(build(packageInput(100, 10, 80))), {}, { fail: (row) => ['P3', 'P7'].includes(String(row.normalizedData?.code)) });
  const res = r.out.result;
  assert.equal(res.outcome, 'COMPLETED_WITH_ERRORS', 'never reported as success');
  assert.equal(res.percent, 100, 'the run completed and verified');
  assert.equal(res.failed, 2);
  assert.deepEqual(res.failures.map((f: any) => f.code).sort(), ['P3', 'P7']);
  assert.ok(res.failures.every((f: any) => /simulated failure/.test(f.reason)));
  // BOMs of P3 / P7 (B3, B7, B103? - only up to 80) cannot be written and are reported, not guessed.
  assert.deepEqual(res.dropped.map((d: any) => d.code).sort(), ['B3', 'B7']);
  assert.ok(res.dropped.every((d: any) => /not written in this import/.test(d.reason)));
  assert.equal(res.succeeded + res.failed + res.skipped, res.processed);
});

test('7. a fatal error interrupts the run: no exception escapes, completed rows are kept, never 100%', async () => {
  let thrown = false;
  const r = await run(reviewedSession(build(packageInput(200, 10, 50))), {
    onProgress: (_p: any, count: number) => { if (count === 4) { thrown = true; throw new Error('screen crashed'); } },
  });
  assert.ok(thrown);
  const res = r.out.result;
  assert.equal(res.outcome, 'INTERRUPTED');
  assert.ok(res.percent < 100);
  assert.equal(res.error, 'screen crashed');
  assert.equal(res.resumable, true);
  assert.ok(res.stoppedIn, 'the phase it stopped in is stated');
  assert.equal(r.out.rows.filter((row: any) => row.status === 'IMPORTED').length, r.writes.length, 'what was written is recorded, not lost');
  assert.ok(res.processed < res.total);
});

test('8. a run of consecutive failures stops the import instead of failing every row', async () => {
  const r = await run(reviewedSession(build(packageInput(300, 10, 20))), { options: { maxConsecutiveFailures: 10 } }, { fail: () => true });
  const res = r.out.result;
  assert.equal(res.outcome, 'INTERRUPTED');
  assert.match(res.error, /stopped after 10 consecutive failed writes/);
  assert.ok(res.failed >= 10 && res.failed < 300, `stopped early (${res.failed} failures)`);
  assert.equal(r.writes.length, 0);
});

test('9. a stop request ends the run between batches, resumable, in its phase', async () => {
  let stop = false;
  const r = await run(reviewedSession(build(packageInput(400, 10, 20))), {
    options: { shouldStop: () => stop },
    onProgress: (p: any) => { if (p.processed >= 100) stop = true; },
  });
  const res = r.out.result;
  assert.equal(res.outcome, 'INTERRUPTED');
  assert.equal(res.stoppedIn, 'ITEMS');
  assert.ok(res.processed >= 100 && res.processed < res.total);
  assert.equal(res.resumable, true);
  assert.match(res.error, /stopped by the user/);
});

// ==================================================================================
// D. BATCHES AND RESPONSIVENESS
// ==================================================================================

test('10. rows are written in batches, a few at a time, with the browser handed a turn after each batch', async () => {
  const session = reviewedSession(build(packageInput(500, 20, 300)));
  const r = await run(session, { options: { batchSize: 50, concurrency: 4 } });
  const planned = r.out.result.total;
  assert.ok(r.yields >= Math.ceil(planned / 50), `at least one yield per batch (${r.yields} for ${planned} rows)`);
  assert.ok(r.maxBetweenYields <= 50, `never more than one batch between two yields (${r.maxBetweenYields})`);
  assert.ok(r.peak <= 4, `never more than 4 writes in flight (${r.peak})`);
  assert.ok(r.peak > 1, 'writes do overlap for the package');
  // Progress is reported per batch, not per row.
  assert.ok(r.snapshots.length < planned / 10, `${r.snapshots.length} snapshots for ${planned} rows`);
});

test('11. without a concurrency setting, rows keep the strict one-at-a-time order', async () => {
  const r = await run(reviewedSession(build(packageInput(40, 5, 10))), { options: { concurrency: undefined } });
  assert.equal(r.peak, 1);
});

// ==================================================================================
// E. IDEMPOTENCY
// ==================================================================================

test('12. re-running the same package after a completed import creates nothing and duplicates nothing', async () => {
  const input = packageInput(80, 8, 60);
  const first = await run(reviewedSession(build(input)));
  const ids = new Map(first.writes.map((w) => [`${w.kind}:${w.code}`, w.id]));
  const existing = {
    products: first.writes.filter((w) => w.kind === 'products').map((w) => ({ id: w.id, code: w.code, externalRefs: [{ system: 'odoo', model: 'product.template', externalId: `pt_${w.code.slice(1)}` }] })),
    materials: first.writes.filter((w) => w.kind === 'materials').map((w) => ({ id: w.id, code: w.code })),
    boms: first.writes.filter((w) => w.kind === 'bomPackage').map((w) => ({ id: w.id, code: w.code, externalRefs: [{ system: 'odoo', externalId: `bom_${w.code.slice(1)}` }] })),
    bomVersions: first.writes.filter((w) => w.kind === 'bomPackage').map((w, i) => ({ id: `v${i}`, bomId: w.id, versionCode: 'V1' })),
  };
  const second = await run(reviewedSession(build(input, existing)), { context: existing });
  assert.equal(second.out.result.outcome, 'COMPLETED');
  assert.equal(second.writes.every((w) => w.existing), true, 'every write is an update of an existing record');
  assert.equal(second.writes.every((w) => ids.get(`${w.kind}:${w.code}`) === w.id), true, 'each keeps its id');
});

test('13. an interrupted run resumed by re-running creates no duplicate', async () => {
  const input = packageInput(300, 10, 50);
  let stop = false;
  const first = await run(reviewedSession(build(input)), { options: { shouldStop: () => stop }, onProgress: (p: any) => { if (p.processed >= 120) stop = true; } });
  assert.equal(first.out.result.outcome, 'INTERRUPTED');
  const existing = {
    products: first.writes.filter((w) => w.kind === 'products').map((w) => ({ id: w.id, code: w.code })),
    materials: first.writes.filter((w) => w.kind === 'materials').map((w) => ({ id: w.id, code: w.code })),
    boms: [], bomVersions: [],
  };
  const second = await run(reviewedSession(build(input, existing)), { context: existing });
  assert.equal(second.out.result.outcome, 'COMPLETED');
  const created = [...first.writes, ...second.writes].filter((w) => !w.existing);
  const keys = created.map((w) => `${w.kind}:${w.code}`);
  assert.equal(new Set(keys).size, keys.length, 'no record was created twice');
  assert.equal(created.filter((w) => w.kind === 'products').length, 300, 'exactly one record per product');
});

test('14. every planned row is written once and only once', async () => {
  const r = await run(reviewedSession(build(packageInput(150, 10, 100))));
  const keys = r.writes.map((w) => `${w.kind}:${w.code}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(r.writes.length, r.out.result.total);
});

// ==================================================================================
// F. A PACKAGE OF THE REAL SIZE
// ==================================================================================

test('15. a ~30,000-record package runs in batches to a verified 100%', async () => {
  const t0 = Date.now();
  const session = reviewedSession(build(packageInput(15872, 221, 14073)));
  const r = await run(session, { options: { batchSize: 250, concurrency: 4 } });
  const res = r.out.result;
  assert.equal(res.total, 30166);
  assert.equal(res.outcome, 'COMPLETED');
  assert.equal(res.percent, 100);
  assert.deepEqual([res.byKind.products.succeeded, res.byKind.materials.succeeded, res.byKind.bomPackage.succeeded], [15872, 221, 14073]);
  assert.ok(r.yields >= Math.ceil(30166 / 250), `yielded ${r.yields} times`);
  assert.ok(r.maxBetweenYields <= 250);
  const percents = r.snapshots.filter((s: any) => s.state === 'IMPORTING').map((s: any) => X.progressPercent(s));
  for (let i = 1; i < percents.length; i++) assert.ok(percents[i] >= percents[i - 1]);
  assert.ok(percents.includes(78) || percents.some((p: number) => p > 70 && p < 90), 'progress passes through the high range');
  assert.ok(Date.now() - t0 < 60000, `in memory, the loop itself takes ${Date.now() - t0} ms`);
});

// ==================================================================================
// G. THE SCREEN
// ==================================================================================

test('16. the screen shows the loop\'s own numbers, a page of rows at a time, and cannot start a second run', () => {
  const panel = readCode('src/components/admin/EntityImportPanel.tsx');
  const progressPanel = readCode('src/components/admin/ImportProgressPanel.tsx');
  assert.ok(/<ImportProgressPanel/.test(panel));
  assert.ok(/setFinalResult\(outcome\.final\)/.test(panel), 'the final panel shows the execution result as it is');
  assert.ok(/onProgress: \(p\) => \{/.test(panel) && /setProgress\(p\)/.test(panel), 'live snapshots from the loop');
  assert.ok(/if \(!session \|\| runningRef\.current\) return;/.test(panel), 'a second import cannot start while one runs');
  assert.ok(/pageRows\.map\(\(row\) =>/.test(panel) && !/session\.rows\.map\(\(row\) => \{\s*const payload/.test(panel), 'the review table renders one page, never 30,000 rows');
  assert.ok(/addEventListener\('beforeunload'/.test(panel), 'leaving the page mid-import asks first');
  assert.ok(/<fieldset disabled=\{busy\}/.test(panel), 'rows cannot change under a running import');
  assert.ok(/concurrency: packageRun \? 4 : 1/.test(panel), 'only the package writes a few rows at once');
  assert.ok(/progressPercent\(progress\)/.test(progressPanel) && /\{final\.percent\}%/.test(progressPanel), 'no percentage is computed by the screen itself');
  for (const id of ['entity-import-progress', 'entity-import-final', 'entity-import-final-failures', 'entity-import-stop', 'entity-import-ready']) {
    assert.ok(progressPanel.includes(`id="${id}"`) || progressPanel.includes(`id=\\"${id}\\"`) || new RegExp(`["']${id}["']`).test(progressPanel), id);
  }
  for (const text of ['IMPORT COMPLETED SUCCESSFULLY', 'IMPORT COMPLETED WITH ERRORS', 'IMPORT INTERRUPTED', 'READY TO IMPORT', 'VERIFYING', 'IMPORTING']) {
    assert.ok(progressPanel.includes(text), text);
  }
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

/**
 * NO UNBOUNDED WAIT IN THE IMPORT (3.21.4).
 *
 * In production (3.21.3) an import stopped at 21% for 30 minutes: one write in a
 * batch never answered, and the loop had no time limit, a stop only acted between
 * batches, and a pending promise was never counted as a failure. These tests run
 * the REAL execution loop with writers that hang, reject, commit-then-hang, and
 * with a local cache whose operations abort or never answer - and prove nothing
 * waits forever. No Firestore.
 *
 * Run: npx tsx scripts/tests/importTimeout.test.ts
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

console.log('importTimeout.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const readCode = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let S: any;
let L: any;
let X: any;
let R: any;
let C: any;
let UI: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  S = await load('src/services/masterDataPackageSessionPure.ts');
  L = await load('src/services/entityImportPure.ts');
  X = await load('src/services/entityImportExecutionPure.ts');
  R = await load('src/services/referenceResolutionPure.ts');
  C = await load('src/services/localCacheStore.ts');
  UI = await load('src/components/admin/ImportProgressPanel.tsx');
}

const NEVER = () => new Promise<never>(() => {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function packageInput(products: number, materials: number, boms: number) {
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
  return { productRows, mixRows };
}
const EMPTY = { products: [], materials: [], boms: [], bomVersions: [] };
function reviewedRows(input: any, existing: any = EMPTY) {
  const ctx = { ...existing, customers: [], logicalItems: [] };
  const built = S.buildMasterDataPackageSession({
    importSessionId: 'MDP-TIMEOUT', productSheets: [{ fileName: 'pm.xlsx', sheetName: 'S', rows: input.productRows }],
    mixSheets: [{ fileName: 'mx.xlsx', sheetName: 'S', rows: input.mixRows }], exceptionSheets: [], existing, validationContext: ctx,
  });
  return { rows: S.evaluatePackageRows(built, built.staged.map((s: any) => (s.row.warnings.length ? L.acceptRowWarnings(s.row, { user: 'r', at: 'T' }) : s.row))), ctx };
}

/**
 * The real loop, with a writer whose behaviour per row is chosen by `plan(code, kind)`:
 * 'ok' | 'reject' | 'hang' (never answers) | 'commit-hang' (commits to `store`, never answers)
 * | 'lookup-hang' | 'cache-hang' | 'audit-hang' (the write's own sub-steps).
 */
async function run(rows: any[], ctx: any, plan: (code: string, kind: string) => string, options: Record<string, any> = {}) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const snapshots: any[] = [];
  let n = 0;
  const writer = async (row: any) => {
    const d = row.normalizedData ?? {};
    const code = String(d.code ?? d.bom?.code ?? '');
    calls.push(code);
    const mode = plan(code, row.entityKind);
    const existingId = row.entityKind === 'bomPackage' ? d.existingBomId : d.existingId;
    const id = existingId || `fs-${row.entityKind}-${++n}`;
    if (mode === 'reject') throw new Error(`Missing or insufficient permissions (${code})`);
    if (mode === 'hang') return NEVER();
    if (mode === 'lookup-hang') { await NEVER(); }
    store.set(`${row.entityKind}:${code}`, id);                    // the write itself
    if (mode === 'commit-hang') return NEVER();
    if (mode === 'cache-hang') { await NEVER(); }                    // cache cleanup never answers
    if (mode === 'audit-hang') { await NEVER(); }                    // audit write never answers
    return id;
  };
  const t0 = Date.now();
  const session = L.createImportSession({ importId: 'MDP-TIMEOUT', sourceFile: 'pkg', createdBy: 'r', createdAt: 'T', rows });
  const out = await X.executeImportRows(session, ctx, {
    indexes: R.buildReferenceIndexes({ products: ctx.products, materials: ctx.materials, customers: [], boms: ctx.boms, bomVersions: ctx.bomVersions }),
    user: 'r', at: () => 'T', language: 'en', batchSize: 25, concurrency: 4, recordTimeoutMs: 40, stopGraceMs: 20,
    yieldToUi: async () => {}, onProgress: (p: any) => { snapshots.push(p); options.onProgress?.(p, snapshots.length); }, ...options.loop,
  }, writer);
  return { out, res: out.result, calls, store, snapshots, ms: Date.now() - t0 };
}

// ==================================================================================
// A. EVERY KIND OF WAIT IS BOUNDED
// ==================================================================================

test('1. a normal run: every write succeeds, 100% only after verification', async () => {
  const { rows, ctx } = reviewedRows(packageInput(30, 5, 20));
  const r = await run(rows, ctx, () => 'ok');
  assert.equal(r.res.outcome, 'COMPLETED');
  assert.equal(r.res.percent, 100);
  assert.deepEqual([r.res.failed, r.res.uncertain, r.res.skipped], [0, 0, 0]);
  assert.equal(X.progressPercent(r.snapshots[0]), 0, 'starts at 0%');
  assert.ok(r.snapshots.filter((s: any) => s.state === 'IMPORTING').every((s: any) => X.progressPercent(s) < 100));
});

test('2. a rejected write is a CONFIRMED failure, never "unknown"', async () => {
  const { rows, ctx } = reviewedRows(packageInput(10, 2, 0));
  const r = await run(rows, ctx, (code) => (code === 'P3' ? 'reject' : 'ok'));
  assert.deepEqual([r.res.failed, r.res.uncertain], [1, 0]);
  assert.match(r.res.failures[0].reason, /insufficient permissions/);
  assert.equal(r.res.outcome, 'COMPLETED_WITH_ERRORS');
});

test('3. IMPORTANT: a Firestore write that NEVER resolves does not hang the import', async () => {
  const { rows, ctx } = reviewedRows(packageInput(12, 2, 0));
  const r = await run(rows, ctx, (code) => (code === 'P5' ? 'hang' : 'ok'));
  assert.ok(r.ms < 5000, `finished in ${r.ms} ms`);
  assert.equal(r.res.uncertain, 1);
  assert.equal(r.res.failed, 0, 'a timeout is never counted as a confirmed failure');
  const row = r.res.uncertainRows[0];
  assert.equal(row.code, 'P5');
  assert.match(row.reason, /^OUTCOME UNKNOWN: the server did not answer within/);
  assert.match(row.reason, /may or may not have committed/);
  assert.match(row.reason, /phase RECORDS/, 'the phase it happened in (a package without BOMs has one phase)');
  assert.match(row.reason, /within 40 ms/);
  assert.equal(r.res.outcome, 'COMPLETED_WITH_ERRORS', 'never reported as success');
  assert.equal(r.res.percent, 100, 'every row has a final state and the run verified');
  assert.equal(r.res.succeeded + r.res.failed + r.res.uncertain + r.res.skipped, r.res.processed);
  assert.equal(r.calls.filter((c) => c === 'P5').length, 1, 'never retried in the same run');
});

test('4. IMPORTANT: a local-cache cleanup that NEVER resolves does not hang the import', async () => {
  const { rows, ctx } = reviewedRows(packageInput(8, 2, 0));
  const r = await run(rows, ctx, (code) => (code === 'P2' ? 'cache-hang' : 'ok'));
  assert.ok(r.ms < 5000);
  assert.equal(r.res.uncertain, 1);
  assert.ok(r.store.has('products:P2'), 'the write itself happened - which is exactly why the outcome is "unknown", not "failed"');
});

test('5. an audit write or a duplicate lookup that never answers is bounded the same way', async () => {
  const { rows, ctx } = reviewedRows(packageInput(8, 2, 0));
  const audit = await run(rows, ctx, (code) => (code === 'P1' ? 'audit-hang' : 'ok'));
  const lookup = await run(rows, ctx, (code) => (code === 'P1' ? 'lookup-hang' : 'ok'));
  for (const r of [audit, lookup]) {
    assert.ok(r.ms < 5000);
    assert.equal(r.res.uncertain, 1);
    assert.equal(r.res.uncertainRows[0].code, 'P1');
  }
  assert.equal(lookup.store.has('products:P1'), false, 'the lookup hung before anything was written - still reported as unknown, never as a certain failure');
});

test('6. a late answer after the timeout changes nothing, and a late rejection is never unhandled', async () => {
  let unhandled = 0;
  const listener = () => { unhandled++; };
  process.on('unhandledRejection', listener);
  try {
    const late = X.waitBounded(new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 30)), 5, undefined, 0);
    assert.deepEqual(await late, { kind: 'timeout' });
    await sleep(60);
    assert.equal(unhandled, 0);
    assert.deepEqual(await X.waitBounded(Promise.resolve('id-1'), 1000, undefined, 0), { kind: 'value', value: 'id-1' });
    const err = await X.waitBounded(Promise.reject(new Error('x')), 1000, undefined, 0);
    assert.equal(err.kind, 'error');
  } finally {
    process.off('unhandledRejection', listener);
  }
  assert.equal(X.IMPORT_RECORD_TIMEOUT_MS, 90_000, 'the production timeout is a named 90 s constant');
});

// ==================================================================================
// B. THE LOCAL CACHE: ABORT, ERROR AND SILENCE ALL SETTLE
// ==================================================================================

/** A minimal IndexedDB stand-in whose transactions behave as `mode` says. */
function fakeIndexedDb(mode: 'complete' | 'abort' | 'error' | 'silent' | 'throw', openMode: 'ok' | 'silent' = 'ok') {
  const db: any = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      if (mode === 'throw') throw new Error('The database connection is closing');
      const tx: any = {};
      const req: any = {};
      tx.objectStore = () => ({ get: () => req, getAll: () => req, put: () => req, delete: () => req });
      setTimeout(() => {
        if (mode === 'complete') { req.result = { key: 'k' }; req.onsuccess?.(); tx.oncomplete?.(); }
        if (mode === 'abort') tx.onabort?.();
        if (mode === 'error') { req.onerror?.(); tx.onerror?.(); }
      }, 1);
      return tx;
    },
  };
  return {
    open: () => {
      const request: any = { result: db };
      if (openMode === 'ok') setTimeout(() => request.onsuccess?.(), 1);
      return request;
    },
  } as any;
}

test('7. IMPORTANT: an aborted cache transaction settles (it used to leave the promise pending forever)', async () => {
  const backend = C.createIndexedDbBackend(fakeIndexedDb('abort'), 50_000);
  const t0 = Date.now();
  await backend.delete('products');
  await backend.put({ key: 'x' });
  assert.equal(await backend.get('x'), undefined);
  assert.deepEqual(await backend.getAllEntries(), []);
  assert.ok(Date.now() - t0 < 1000, 'settled by the abort itself, not by the timeout');
});

test('8. a cache operation that never answers, an error, a throw and a silent open all settle', async () => {
  const t0 = Date.now();
  await C.createIndexedDbBackend(fakeIndexedDb('silent'), 30).delete('products');
  assert.equal(await C.createIndexedDbBackend(fakeIndexedDb('error'), 30).get('x'), undefined);
  await C.createIndexedDbBackend(fakeIndexedDb('throw'), 30).delete('x');
  await C.createIndexedDbBackend(fakeIndexedDb('complete', 'silent'), 30).delete('x');
  assert.ok(Date.now() - t0 < 2000);
  const ok = C.createIndexedDbBackend(fakeIndexedDb('complete'), 30);
  assert.deepEqual(await ok.get('k'), { key: 'k' }, 'a healthy cache still works');
  assert.equal(C.CACHE_OPERATION_TIMEOUT_MS, 10_000);
  assert.equal(C.createIndexedDbBackend(undefined), null, 'no IndexedDB -> no backend, as before');
});

// ==================================================================================
// C. STOPPING
// ==================================================================================

test('9. a stop between batches: no new batch starts', async () => {
  const { rows, ctx } = reviewedRows(packageInput(200, 5, 0));
  const controller = new AbortController();
  const r = await run(rows, ctx, () => 'ok', { loop: { stopSignal: controller.signal }, onProgress: (p: any) => { if (p.processed >= 50) controller.abort(); } });
  assert.equal(r.res.outcome, 'INTERRUPTED');
  assert.ok(r.calls.length <= 50 + 25, `writes after the stop are bounded (${r.calls.length})`);
  assert.ok(r.res.processed < r.res.total);
  assert.match(r.res.error, /stopped by the user/);
});

test('10. IMPORTANT: a stop while a write is pending is honoured within the grace period, and nothing new starts', async () => {
  const { rows, ctx } = reviewedRows(packageInput(40, 2, 0));
  const controller = new AbortController();
  // P3 never answers; the stop comes while it waits. The record timeout is long, so only the stop can end the wait.
  const plan = (code: string) => (code === 'P3' ? 'hang' : 'ok');
  setTimeout(() => controller.abort(), 20);
  const r = await run(rows, ctx, plan, { loop: { stopSignal: controller.signal, recordTimeoutMs: 60_000, stopGraceMs: 30, batchSize: 250 } });
  assert.ok(r.ms < 2000, `stopped in ${r.ms} ms, not after the 60 s timeout`);
  assert.equal(r.res.outcome, 'INTERRUPTED');
  const p3 = r.res.uncertainRows.find((u: any) => u.code === 'P3');
  assert.ok(p3, 'the pending write is reported');
  assert.match(p3.reason, /stopped before the server answered/);
  assert.match(r.res.error, /did not respond before the stop/);
  assert.ok(r.calls.length <= 4, `no write started after the stop (${r.calls.length})`);
  assert.equal(r.res.percent < 100, true);
});

// ==================================================================================
// D. THE FAILURE GUARD
// ==================================================================================

test('11. 25 consecutive confirmed failures stop the run', async () => {
  const { rows, ctx } = reviewedRows(packageInput(120, 2, 0));
  const r = await run(rows, ctx, () => 'reject', { loop: { maxConsecutiveFailures: 25 } });
  assert.equal(r.res.outcome, 'INTERRUPTED');
  assert.ok(r.res.failed >= 25 && r.res.failed < 120);
  assert.match(r.res.error, /25 consecutive failed writes/);
});

test('12. timeouts count toward the same guard: a server that never answers stops the run quickly', async () => {
  const { rows, ctx } = reviewedRows(packageInput(200, 2, 0));
  const r = await run(rows, ctx, () => 'hang', { loop: { maxConsecutiveFailures: 8 } });
  assert.equal(r.res.outcome, 'INTERRUPTED');
  assert.ok(r.res.uncertain >= 8 && r.res.uncertain <= 8 + 3, `${r.res.uncertain} outcome-unknown writes before the stop`);
  assert.match(r.res.error, /consecutive writes that failed or got no answer/);
  assert.ok(r.ms < 5000);
});

// ==================================================================================
// E. UNKNOWN OUTCOMES, DEPENDENCIES AND RE-RUN
// ==================================================================================

test('13. an unknown outcome is represented as such everywhere: counts, rows, lists', async () => {
  const { rows, ctx } = reviewedRows(packageInput(10, 2, 0));
  const r = await run(rows, ctx, (code) => (code === 'P4' ? 'commit-hang' : 'ok'));
  const row = r.out.rows.find((x: any) => x.originalRowData.code === 'P4');
  assert.equal(row.status, 'FAILED', 'kept reviewable in the session');
  assert.ok(row.failureMessage.startsWith(X.OUTCOME_UNKNOWN_PREFIX));
  assert.equal(r.res.failures.length, 0, 'not listed as a confirmed failure');
  assert.equal(r.res.uncertainRows.length, 1);
  assert.equal(r.res.byKind.products.uncertain, 1);
});

test('14. a BOM whose item\'s write outcome is unknown says so, and is not written', async () => {
  const { rows, ctx } = reviewedRows(packageInput(5, 2, 5));
  const r = await run(rows, ctx, (code) => (code === 'P2' ? 'commit-hang' : 'ok'));
  const b2 = r.res.dropped.find((d: any) => d.code === 'B2');
  assert.match(b2.reason, /write outcome of a package item is unknown/);
  assert.equal(r.calls.includes('B2'), false);
});

test('15. IMPORTANT: re-running after a timed-out (but committed) write creates no duplicate', async () => {
  const input = packageInput(30, 3, 10);
  const first = reviewedRows(input);
  const r1 = await run(first.rows, first.ctx, (code) => (code === 'P7' || code === 'M2' ? 'commit-hang' : 'ok'));
  assert.equal(r1.res.uncertain, 2);
  // Everything the server actually committed - including the two timed-out writes.
  const stored = (kind: string) => [...r1.store.entries()].filter(([k]) => k.startsWith(`${kind}:`)).map(([k, id]) => ({ id, code: k.slice(kind.length + 1) }));
  const existing = { products: stored('products'), materials: stored('materials'), boms: [], bomVersions: [] };
  assert.ok(existing.products.some((p) => p.code === 'P7'), 'P7 was committed although it timed out');
  const second = reviewedRows(input, existing);
  const r2 = await run(second.rows, second.ctx, () => 'ok');
  assert.equal(r2.res.outcome, 'COMPLETED');
  const p7 = second.rows.find((x: any) => x.originalRowData.code === 'P7');
  assert.ok(p7.originalRowData.existingId, 'P7 is matched by its code on the re-run');
  const creates = [...r2.store.keys()].filter((k) => !existing.products.some((p) => `products:${p.code}` === k) && !existing.materials.some((m) => `materials:${m.code}` === k) && !k.startsWith('bomPackage:'));
  assert.deepEqual(creates, [], 'no product or material created twice');
});

// ==================================================================================
// F. HEARTBEAT, CONNECTION AND THE SCREEN
// ==================================================================================

test('16. the heartbeat: snapshots between batches carry the time of the last outcome', async () => {
  let fake = 1_000_000;
  const { rows, ctx } = reviewedRows(packageInput(60, 2, 0));
  const r = await run(rows, ctx, () => 'ok', { loop: { batchSize: 1000, clock: () => (fake += 400), heartbeatMs: 1000 } });
  const between = r.snapshots.filter((s: any) => s.state === 'IMPORTING' && s.phase === 'RECORDS' && s.processed > 0 && s.processed < 62);
  assert.ok(between.length >= 5, `${between.length} heartbeat reports inside one batch`);
  for (let i = 1; i < between.length; i++) assert.ok(between[i].lastProgressAt >= between[i - 1].lastProgressAt);
});

test('17. the heartbeat line: last progress, "waiting for the server", connection, and the stop wording', () => {
  const p = { lastProgressAt: 0, inFlight: 1 };
  const fresh = UI.heartbeatState(p, 12_000, true, false, false);
  assert.equal(fresh.lastProgress, 'Last progress: 12 seconds ago');
  assert.equal(fresh.waiting, false);
  assert.equal(fresh.connection, 'Connection: Online');
  assert.equal(fresh.stop, null);
  const stalled = UI.heartbeatState(p, 134_000, false, false, false);
  assert.equal(stalled.waiting, true);
  assert.equal(stalled.waitingText, 'Waiting for the server...');
  assert.equal(stalled.lastProgress, 'Last progress: 2 min 14 sec ago');
  assert.equal(stalled.connection, 'Offline — waiting for connection');
  assert.equal(UI.heartbeatState(p, 2_000, true, true, false).stop, 'Stopping after the current work completes...');
  assert.equal(UI.heartbeatState(p, 15_000, true, true, false).stop, 'Stopping — one server operation did not respond within the timeout.');
  assert.equal(UI.heartbeatState(p, 134_000, true, false, true).lastProgress, 'آخر تقدم: منذ 2 دقيقة 14 ثانية');
  const panel = readCode('src/components/admin/ImportProgressPanel.tsx');
  assert.ok(/addEventListener\('online'/.test(panel) && /addEventListener\('offline'/.test(panel), 'the browser signal is followed live');
  assert.ok(/id="entity-import-heartbeat"/.test(panel) && /id="entity-import-stopping"/.test(panel));
  assert.ok(/Outcome unknown/.test(panel) && /id="entity-import-final-uncertain"/.test(panel));
});

test('18. the three final states keep their closing message and close button; the stop is a real signal', () => {
  assert.equal(UI.closingMessage('COMPLETED', true).icon, '✅');
  assert.equal(UI.closingMessage('COMPLETED_WITH_ERRORS', true).icon, '⚠️');
  assert.equal(UI.closingMessage('INTERRUPTED', true).icon, '⏸️');
  const panel = readCode('src/components/admin/EntityImportPanel.tsx');
  assert.ok(/stopSignal: stopControllerRef\.current\.signal/.test(panel));
  assert.ok(/stopControllerRef\.current\?\.abort\(\)/.test(panel), 'the stop button aborts the signal');
  assert.ok(/onClose=\{finalResult && !busy \? onClose : undefined\}/.test(panel));
});

// ==================================================================================
// G. THE FULL-SIZE PACKAGE, WITH TIMEOUTS
// ==================================================================================

test('19. 30,166 planned rows: all phases, a verified 100%, then one percent of writes hang - and nothing hangs or duplicates', async () => {
  const input = packageInput(15872, 221, 14073);
  const first = reviewedRows(input);
  const clean = await run(first.rows, first.ctx, () => 'ok', { loop: { batchSize: 250 } });
  assert.equal(clean.res.total, 30166);
  assert.deepEqual([clean.res.outcome, clean.res.percent, clean.res.succeeded], ['COMPLETED', 100, 30166]);
  assert.deepEqual(clean.res.phasesCompleted, ['ITEMS', 'DEPENDENCIES', 'BOMS']);

  // Every 100th product commits but never answers.
  const flaky = await run(first.rows, first.ctx, (code, kind) => (kind === 'products' && Number(code.slice(1)) % 100 === 0 ? 'commit-hang' : 'ok'), { loop: { batchSize: 250, recordTimeoutMs: 15 } });
  assert.equal(flaky.res.uncertain, 158);
  assert.equal(flaky.res.outcome, 'COMPLETED_WITH_ERRORS');
  assert.equal(flaky.res.succeeded + flaky.res.failed + flaky.res.uncertain + flaky.res.skipped, flaky.res.processed);
  // Re-run over what the server really holds: every product exactly once.
  const stored = (kind: string) => [...flaky.store.entries()].filter(([k]) => k.startsWith(`${kind}:`)).map(([k, id]) => ({ id, code: k.slice(kind.length + 1) }));
  const existing = { products: stored('products'), materials: stored('materials'), boms: [], bomVersions: [] };
  const again = reviewedRows(input, existing);
  const rerun = await run(again.rows, again.ctx, () => 'ok', { loop: { batchSize: 250 } });
  assert.equal(rerun.res.outcome, 'COMPLETED');
  const productCreates = again.rows.filter((r: any) => r.entityKind === 'products' && !r.originalRowData.existingId).length;
  assert.equal(productCreates, 0, 'every product - including the 158 timed-out ones - is matched, none created twice');
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

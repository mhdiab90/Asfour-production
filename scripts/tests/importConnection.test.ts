/**
 * CONNECTION-AWARE IMPORT (3.21.5).
 *
 * In production (3.21.4) a silent network stall timed out group after group of 4
 * records until the 25-failure guard ended the run at 11,036 / 30,166. These
 * tests run the REAL execution loop with a backend that becomes unreachable (writes
 * never answer, the read-only probe fails or never answers) and then recovers,
 * and prove the run PAUSES and resumes instead of burning the guard - without
 * retrying or duplicating anything. No Firestore.
 *
 * Run: npx tsx scripts/tests/importConnection.test.ts
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

console.log('importConnection.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const readCode = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let S: any;
let L: any;
let X: any;
let R: any;
let UI: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  S = await load('src/services/masterDataPackageSessionPure.ts');
  L = await load('src/services/entityImportPure.ts');
  X = await load('src/services/entityImportExecutionPure.ts');
  R = await load('src/services/referenceResolutionPure.ts');
  UI = await load('src/components/admin/ImportProgressPanel.tsx');
}

const NEVER = () => new Promise<never>(() => {});

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
    importSessionId: 'MDP-CONN', productSheets: [{ fileName: 'pm.xlsx', sheetName: 'S', rows: input.productRows }],
    mixSheets: [{ fileName: 'mx.xlsx', sheetName: 'S', rows: input.mixRows }], exceptionSheets: [], existing, validationContext: ctx,
  });
  return { rows: S.evaluatePackageRows(built, built.staged.map((s: any) => (s.row.warnings.length ? L.acceptRowWarnings(s.row, { user: 'r', at: 'T' }) : s.row))), ctx, built };
}

/**
 * A backend that can go down. While `down`, every write stops at `stopAt`
 * (commit first if 'commit-then-silent') and never answers, and the probe fails
 * (or, with probeMode 'silent', never answers). `recoverAfterProbes` brings it back
 * after that many failed probes.
 */
function backend(opts: { downAt?: number; recoverAfterProbes?: number; stopAt?: string; probeMode?: 'reject' | 'silent'; reject?: (code: string) => boolean } = {}) {
  const state = { down: false, writes: 0, probes: 0, failedProbes: 0, store: new Map<string, string>(), calls: [] as string[] };
  let n = 0;
  const write = async (row: any, _ctx: any, track: (s: string) => void) => {
    const d = row.normalizedData ?? {};
    const code = String(d.code ?? d.bom?.code ?? '');
    state.calls.push(code);
    state.writes++;
    if (opts.downAt !== undefined && state.writes === opts.downAt) state.down = true;
    if (opts.reject?.(code)) throw new Error(`Missing or insufficient permissions (${code})`);
    const existingId = row.entityKind === 'bomPackage' ? d.existingBomId : d.existingId;
    const id = existingId || `fs-${row.entityKind}-${++n}`;
    track('DUPLICATE_LOOKUP');
    if (state.down && opts.stopAt === 'DUPLICATE_LOOKUP') return NEVER();
    track('FIRESTORE_WRITE');
    if (state.down && (opts.stopAt ?? 'FIRESTORE_WRITE') === 'FIRESTORE_WRITE') return NEVER();
    state.store.set(`${row.entityKind}:${code}`, id);
    track('CACHE_CLEANUP');
    if (state.down && opts.stopAt === 'CACHE_CLEANUP') return NEVER();
    track('AUDIT_WRITE');
    if (state.down && opts.stopAt === 'AUDIT_WRITE') return NEVER();
    return id;
  };
  const probe = async () => {
    state.probes++;
    if (!state.down) return 'ok';
    state.failedProbes++;
    if (opts.recoverAfterProbes !== undefined && state.failedProbes >= opts.recoverAfterProbes) state.down = false;
    if (opts.probeMode === 'silent') return NEVER();
    throw new Error('Failed to get documents from server. (client is offline)');
  };
  return { state, write, probe };
}

async function run(rows: any[], ctx: any, be: ReturnType<typeof backend>, loop: Record<string, any> = {}) {
  const snapshots: any[] = [];
  const t0 = Date.now();
  const session = L.createImportSession({ importId: 'MDP-CONN', sourceFile: 'pkg', createdBy: 'r', createdAt: 'T', rows });
  const out = await X.executeImportRows(session, ctx, {
    indexes: R.buildReferenceIndexes({ products: ctx.products, materials: ctx.materials, customers: [], boms: ctx.boms, bomVersions: ctx.bomVersions }),
    user: 'r', at: () => 'T', language: 'en', batchSize: 25, concurrency: 4,
    recordTimeoutMs: 30, stopGraceMs: 10, probe: be.probe, probeTimeoutMs: 15, probeIntervalMs: 2, maxPauseMs: 60_000, maxConsecutiveFailures: 25,
    yieldToUi: async () => {}, onProgress: (p: any) => { snapshots.push(p); loop.onProgress?.(p, snapshots.length); }, ...loop,
  }, be.write);
  return { out, res: out.result, snapshots, ms: Date.now() - t0 };
}

// ==================================================================================
// A. AN OUTAGE PAUSES THE RUN - IT NEITHER HANGS NOR BURNS THE GUARD
// ==================================================================================

test('1. IMPORTANT: the backend is unreachable for "several minutes" (30 failed probes, 5 min at the production cadence), then recovers - the run pauses, resumes and completes', async () => {
  const { rows, ctx } = reviewedRows(packageInput(200, 10, 60));
  const be = backend({ downAt: 41, recoverAfterProbes: 30 });
  const r = await run(rows, ctx, be);
  assert.ok(r.ms < 10_000, `${r.ms} ms`);
  assert.notEqual(r.res.outcome, 'INTERRUPTED', 'an outage is a pause, not the end of the run');
  assert.equal(r.res.connectionPauses.length, 1);
  assert.equal(r.res.connectionPauses[0].recovered, true);
  assert.ok(r.res.connectionPauses[0].probes >= 30);
  assert.ok(r.res.uncertain >= 1 && r.res.uncertain <= 4, `only the records in flight when it went down are unknown (${r.res.uncertain})`);
  assert.equal(r.res.failed, 0);
  assert.deepEqual(r.res.phasesCompleted, ['ITEMS', 'DEPENDENCIES', 'BOMS']);
  assert.equal(r.res.percent, 100);
  assert.equal(r.res.outcome, 'COMPLETED_WITH_ERRORS', 'never a success while some outcomes are unknown');
  assert.equal(r.res.succeeded + r.res.failed + r.res.uncertain + r.res.skipped, r.res.processed);
});

test('2. the same outage WITHOUT the pause would have burned the guard: with 3.21.4 behaviour (no probe) the run stops', async () => {
  const { rows, ctx } = reviewedRows(packageInput(200, 10, 0));
  const be = backend({ downAt: 41 });
  const r = await run(rows, ctx, be, { probe: undefined, maxConsecutiveFailures: 25 });
  assert.equal(r.res.outcome, 'INTERRUPTED');
  assert.ok(r.res.uncertain >= 25);
  // With the probe, the same outage costs at most one group.
  const be2 = backend({ downAt: 41, recoverAfterProbes: 5 });
  const r2 = await run(rows, ctx, be2);
  assert.ok(r2.res.uncertain <= 4);
});

test('3. while paused, no new record starts', async () => {
  const { rows, ctx } = reviewedRows(packageInput(120, 5, 0));
  const be = backend({ downAt: 21, recoverAfterProbes: 20 });
  let writesDuringPause = -1;
  const r = await run(rows, ctx, be, {
    onProgress: (p: any) => {
      if (p.connection === 'LOST') {
        if (writesDuringPause < 0) writesDuringPause = be.state.writes;
        else assert.equal(be.state.writes, writesDuringPause, 'the write count does not move while LOST');
      }
    },
  });
  assert.ok(writesDuringPause > 0);
  assert.equal(r.res.connectionPauses[0].recovered, true);
});

test('4. the unknown records are never retried in the run, and stay explicitly unknown', async () => {
  const { rows, ctx } = reviewedRows(packageInput(80, 5, 0));
  const be = backend({ downAt: 17, recoverAfterProbes: 3 });
  const r = await run(rows, ctx, be);
  const codes = be.state.calls;
  assert.equal(new Set(codes).size, codes.length, 'every record was sent once');
  for (const u of r.res.uncertainRows) {
    assert.match(u.reason, /^OUTCOME UNKNOWN/);
    const row = r.out.rows.find((x: any) => x.rowId === u.rowId);
    assert.equal(row.status, 'FAILED');
    assert.ok(row.failureMessage.startsWith('OUTCOME UNKNOWN'));
  }
  assert.equal(r.res.failures.length, 0);
});

test('5. no duplicate: records committed during the outage are matched on a re-run', async () => {
  const input = packageInput(100, 5, 20);
  const first = reviewedRows(input);
  const be = backend({ downAt: 30, recoverAfterProbes: 4, stopAt: 'AUDIT_WRITE' });      // committed, then silent
  const r1 = await run(first.rows, first.ctx, be);
  assert.ok(r1.res.uncertain >= 1);
  const stored = (kind: string) => [...be.state.store.entries()].filter(([k]) => k.startsWith(`${kind}:`)).map(([k, id]) => ({ id, code: k.slice(kind.length + 1) }));
  const existing = { products: stored('products'), materials: stored('materials'), boms: [], bomVersions: [] };
  for (const u of r1.res.uncertainRows) assert.ok(existing.products.some((p) => p.code === u.code) || existing.materials.some((m) => m.code === u.code), `${u.code} was committed despite the timeout`);
  const second = reviewedRows(input, existing);
  const creates = second.rows.filter((r: any) => (r.entityKind === 'products' || r.entityKind === 'materials') && !r.originalRowData.existingId);
  assert.equal(creates.length, 0, 'every committed item - including the unknown ones - is an update');
  const r2 = await run(second.rows, second.ctx, backend());
  assert.equal(r2.res.outcome, 'COMPLETED');
});

// ==================================================================================
// B. THE GUARDS STAY SEPARATE
// ==================================================================================

test('6. confirmed failures still count normally: 25 rejections stop the run even with a probe', async () => {
  const { rows, ctx } = reviewedRows(packageInput(120, 2, 0));
  const r = await run(rows, ctx, backend({ reject: () => true }));
  assert.equal(r.res.outcome, 'INTERRUPTED');
  assert.match(r.res.error, /25 consecutive failed writes/);
  assert.equal(r.res.connectionPauses.length, 0, 'a rejection is an answer - the connection is fine');
});

test('7. a server that answers the probe but never the writes is a slow server: those timeouts DO count toward the guard', async () => {
  const { rows, ctx } = reviewedRows(packageInput(200, 2, 0));
  const be = backend();
  const r = await run(rows, ctx, { ...be, write: async () => NEVER() } as any);
  assert.equal(r.res.outcome, 'INTERRUPTED');
  assert.match(r.res.error, /server answers, but \d+ consecutive writes got no answer/);
  assert.ok(r.res.uncertain >= 25 && r.res.uncertain <= 28);
  assert.equal(r.res.connectionPauses.length, 0);
});

// ==================================================================================
// C. THE PROBE
// ==================================================================================

test('8. a probe that never answers is bounded, counts as "no answer", and recovery still resumes the run', async () => {
  const { rows, ctx } = reviewedRows(packageInput(80, 2, 0));
  const be = backend({ downAt: 9, recoverAfterProbes: 6, probeMode: 'silent' });
  const r = await run(rows, ctx, be);
  assert.ok(r.ms < 10_000);
  assert.equal(r.res.connectionPauses.length, 1);
  assert.equal(r.res.connectionPauses[0].recovered, true);
  assert.equal(r.res.outcome, 'COMPLETED_WITH_ERRORS');
});

test('9. the pause has a limit: a backend that never returns ends the run as INTERRUPTED, resumable', async () => {
  const { rows, ctx } = reviewedRows(packageInput(80, 2, 0));
  const r = await run(rows, ctx, backend({ downAt: 9 }), { maxPauseMs: 60 });
  assert.equal(r.res.outcome, 'INTERRUPTED');
  assert.match(r.res.error, /did not come back within/);
  assert.equal(r.res.connectionPauses[0].recovered, false);
  assert.equal(r.res.resumable, true);
  assert.ok(r.res.percent < 100);
});

test('10. a stop while the connection is lost ends the run promptly as INTERRUPTED', async () => {
  const { rows, ctx } = reviewedRows(packageInput(80, 2, 0));
  const controller = new AbortController();
  const r = await run(rows, ctx, backend({ downAt: 9 }), {
    stopSignal: controller.signal, probeIntervalMs: 1000,
    onProgress: (p: any) => { if (p.connection === 'LOST') controller.abort(); },
  });
  assert.ok(r.ms < 3000, `${r.ms} ms`);
  assert.equal(r.res.outcome, 'INTERRUPTED');
  assert.match(r.res.error, /stopped by the user/);
  assert.equal(r.res.connectionPauses[0].recovered, false);
});

// ==================================================================================
// D. DIAGNOSTICS, HEARTBEAT AND THE SCREEN
// ==================================================================================

test('11. every timeout records the step it waited for, its times, and the browser signals', async () => {
  for (const step of ['DUPLICATE_LOOKUP', 'FIRESTORE_WRITE', 'CACHE_CLEANUP', 'AUDIT_WRITE']) {
    const { rows, ctx } = reviewedRows(packageInput(20, 2, 0));
    const be = backend({ downAt: 5, recoverAfterProbes: 2, stopAt: step });
    // The page goes to the background and the network drops at the same moment the backend does.
    const r = await run(rows, ctx, be, {
      environment: () => (be.state.down ? { online: false, visibility: 'hidden' } : { online: true, visibility: 'visible' }),
      describeSource: (row: any) => ({ file: 'pm.xlsx', row: row.sourceRowNumber }),
    });
    const u = r.res.uncertainRows[0];
    assert.equal(u.step, step, step);
    assert.match(u.reason, new RegExp(`waiting for ${step}`));
    assert.equal(u.phase, 'RECORDS');
    assert.ok(u.timedOutAt >= u.startedAt);
    assert.deepEqual([u.visibility, u.online], ['hidden', false], 'the page and network state at the timeout');
    assert.equal(u.sourceFile, 'pm.xlsx');
    assert.equal(typeof u.sourceRow, 'number');
  }
});

test('12. the heartbeat keeps reporting during a pause: connection state, paused time, last write, last server answer', async () => {
  const { rows, ctx } = reviewedRows(packageInput(60, 2, 0));
  const r = await run(rows, ctx, backend({ downAt: 9, recoverAfterProbes: 8 }));
  const lost = r.snapshots.filter((s: any) => s.connection === 'LOST');
  assert.ok(lost.length >= 8, `${lost.length} heartbeat reports while paused`);
  assert.ok(lost.every((s: any) => s.pausedSince !== null && s.lastWriteAt !== null));
  assert.ok(r.snapshots.some((s: any) => s.connection === 'CHECKING'));
  const last = r.snapshots[r.snapshots.length - 1];
  assert.equal(last.connection, 'OK');
  assert.ok(last.pausedMs > 0);
  assert.ok(last.lastBackendResponseAt !== null);
  const lines = UI.connectionLines({ connection: 'LOST', pausedSince: 0, pausedMs: 0, lastBackendResponseAt: 1_000, lastWriteAt: 1_000, pendingStep: 'FIRESTORE_WRITE', lastProgressAt: 1_000 }, 134_000, false);
  assert.equal(lines.title, 'Waiting for the server...');
  assert.match(lines.state, /^Connection lost — paused for 2 min 14 sec/);
  assert.equal(lines.lastSuccessfulProgress, 'Last successful progress: 2 min 13 sec ago');
  assert.equal(lines.pending, 'Current operation: Firestore write');
  assert.equal(UI.connectionLines({ ...last, connection: 'CHECKING', pausedSince: null }, Date.now(), false).state, 'Connection: checking...');
  assert.equal(UI.connectionLines({ ...last, connection: 'OK', pausedSince: null }, Date.now(), false).waiting, false);
});

test('13. the write path reports each step, the probe is read-only, and the screen shows the connection', () => {
  const svc = readCode('src/services/masterDataService.ts');
  const create = svc.slice(svc.indexOf('export async function createMasterDataItem'), svc.indexOf('export async function updateMasterDataItem'));
  const order = ['DUPLICATE_LOOKUP', 'checkCodeDuplicate(', 'FIRESTORE_WRITE', 'safeAddDoc(', 'CACHE_CLEANUP', 'invalidateCachedCollection(', 'AUDIT_WRITE', 'logAuditAction('].map((t) => create.indexOf(t));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1])), 'each step is announced right before it runs, and none is removed');
  const probe = svc.slice(svc.indexOf('export async function probeMasterDataBackend'), svc.indexOf('export async function createMasterDataItem'));
  assert.ok(/getDocsFromServer\(query\(collection\(db, 'products'\), limit\(1\)\)\)/.test(probe));
  assert.equal(/addDoc|setDoc|updateDoc|deleteDoc|writeBatch|invalidateCachedCollection/.test(probe), false, 'the probe writes nothing');
  const service = readCode('src/services/entityImportService.ts');
  assert.ok(/probe: options\.probe \?\? probeMasterDataBackend/.test(service));
  assert.ok(/createMasterDataItem\(collectionName, record, steps\)/.test(service));
  const panel = readCode('src/components/admin/EntityImportPanel.tsx');
  assert.ok(/visibility: typeof document === 'undefined' \? null : document\.visibilityState/.test(panel));
  assert.ok(/describeSource: \(row\) =>/.test(panel));
  const progressPanel = readCode('src/components/admin/ImportProgressPanel.tsx');
  for (const id of ['entity-import-connection', 'entity-import-diagnostics', 'entity-import-final-pauses']) assert.ok(progressPanel.includes(`id="${id}"`), id);
  assert.equal(X.CONNECTION_PROBE_TIMEOUT_MS, 15_000);
  assert.equal(X.CONNECTION_PROBE_INTERVAL_MS, 10_000);
  assert.equal(X.CONNECTION_MAX_PAUSE_MS, 30 * 60_000);
});

// ==================================================================================
// E. THE FULL-SIZE PACKAGE
// ==================================================================================

test('14. 30,166 planned rows, normal: every phase, a verified 100%, no pause', async () => {
  const { rows, ctx } = reviewedRows(packageInput(15872, 221, 14073));
  const r = await run(rows, ctx, backend(), { batchSize: 250 });
  assert.equal(r.res.total, 30166);
  assert.deepEqual([r.res.outcome, r.res.percent, r.res.succeeded, r.res.connectionPauses.length], ['COMPLETED', 100, 30166, 0]);
});

test('15. 30,166 planned rows with an outage at record 11,000 (the production stopping point): pause, recover, finish - and a re-run creates nothing twice', async () => {
  const input = packageInput(15872, 221, 14073);
  const first = reviewedRows(input);
  const be = backend({ downAt: 11_001, recoverAfterProbes: 30, stopAt: 'AUDIT_WRITE' });
  const r = await run(first.rows, first.ctx, be, { batchSize: 250 });
  assert.equal(r.res.total, 30166);
  assert.equal(r.res.connectionPauses.length, 1);
  assert.equal(r.res.connectionPauses[0].recovered, true);
  assert.ok(r.res.uncertain <= 4, `${r.res.uncertain} unknown - not 35`);
  assert.deepEqual(r.res.phasesCompleted, ['ITEMS', 'DEPENDENCIES', 'BOMS']);
  assert.equal(r.res.percent, 100);
  const stored = (kind: string) => [...be.state.store.entries()].filter(([k]) => k.startsWith(`${kind}:`)).map(([k, id]) => ({ id, code: k.slice(kind.length + 1) }));
  const existing = { products: stored('products'), materials: stored('materials'), boms: [], bomVersions: [] };
  const again = reviewedRows(input, existing);
  assert.equal(again.rows.filter((x: any) => x.entityKind === 'products' && !x.originalRowData.existingId).length, 0, 'no product created twice');
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

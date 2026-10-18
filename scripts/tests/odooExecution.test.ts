/**
 * ODOO IMPORT - THE WRITE LOOP (3.32.0)
 *
 * The first real write showed a spinner and nothing else: no percentage, no failure reasons, and no
 * way to tell a slow server from a dead one. These tests pin the loop that replaced it, with a fake
 * writer so every rule is proved without a database:
 *   progress and percentage (99 at most until complete), every row bounded (a write that never
 *   answers is OUTCOME UNKNOWN - not a failure, not a success), stop, the two guards, failure
 *   isolation, a re-run that never writes a record twice, and that what is written is only what was
 *   approved. Plus the identity a stored record is matched by, derived from REAL reader output.
 *
 * Run: npx tsx scripts/tests/odooExecution.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0; let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => registered.push({ name, fn });
console.log('odooExecution.test.ts');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let run: any; let sess: any; let wo: any; let prod: any;
async function bootstrap() {
  run = await load('src/services/odooExecutionPure.ts');
  sess = await load('src/services/odooImportSessionPure.ts');
  wo = await load('src/services/odooWorkOrderReaderPure.ts');
  prod = await load('src/services/odooProductionReaderPure.ts');
}

/** A staged row that is ready to write (INCLUDED, no error, warnings accepted, payload present). */
const staged = (id: string, kind: 'odooWorkOrder' | 'odooScrap' | 'odooProduction', over: any = {}): any => ({
  kind,
  sourceType: kind === 'odooScrap' ? 'STOCK_SCRAP' : 'MRP_WORKORDER',
  provenance: { sourceFile: 'f.xlsx', sourceRow: Number(id.replace(/\D/g, '')) || 1 },
  rawRow: {},
  linkedManufacturingOrder: `MO/${id}`,
  linkedRowIds: [],
  orphanKinds: [],
  identityKey: kind === 'odooWorkOrder' ? `key-${id}` : undefined,
  payload: kind === 'odooScrap' ? { reference: `SP/${id}` } : { productCode: 'P' },
  targetStage: kind === 'odooScrap' ? null : 'mixing',
  row: { rowId: id, selection: 'INCLUDED', errors: [], warnings: [], warningsAccepted: true, status: 'READY', importedId: null, failureMessage: null, resolutionHistory: [] },
  ...over,
});
const wos = (n: number) => Array.from({ length: n }, (_, i) => staged(`w${i + 1}`, 'odooWorkOrder'));
const ok = (item: any) => Promise.resolve({ importedId: `id-${item.row.rowId}`, collection: 'c' });

// ==================================================
// A. PROGRESS
// ==================================================

test('A1. every planned row is written once, production first and then scrap', async () => {
  const order: string[] = [];
  const rows = [staged('s1', 'odooScrap'), ...wos(3), staged('s2', 'odooScrap')];
  const r = await run.runOdooWrites(rows, { concurrency: 1, writer: (i: any) => { order.push(i.row.rowId); return ok(i); } });
  assert.deepEqual(order, ['w1', 'w2', 'w3', 's1', 's2'], 'a scrap row can then point at its production record');
  assert.equal(r.final.outcome, 'COMPLETED');
  assert.equal(r.final.succeeded, 5);
  assert.ok(r.staged.every((s: any) => s.row.status === 'IMPORTED' && s.row.importedId));
});

test('A2. the percentage is floor(processed / total), 99 at most while running, and 100 only at the verified end', async () => {
  const seen: Array<[string, number, number]> = [];
  const r = await run.runOdooWrites(wos(8), { concurrency: 1, writer: ok, onProgress: (p: any) => seen.push([p.state, p.processed, p.percent]) });
  for (const [state, processed, percent] of seen) {
    if (state === 'IMPORTING') {
      assert.ok(percent <= 99, `running at ${percent}%`);
      assert.equal(percent, Math.min(99, Math.floor((processed / 8) * 100)));
    }
  }
  assert.deepEqual(seen[seen.length - 1], ['COMPLETED', 8, 100]);
  assert.ok(seen.map((s) => s[2]).every((v, i, a) => i === 0 || v >= a[i - 1]), 'never goes backwards');
  assert.equal(r.final.percent, 100);
  assert.equal(run.odooPercent({ state: 'IMPORTING', processed: 8, total: 8 }), 99, 'all rows done but not yet verified is still 99');
  assert.equal(run.odooPercent({ state: 'COMPLETED', processed: 7, total: 8 }), 87, 'a "complete" run that missed rows is not 100');
});

test('A3. progress carries the counts per stage and the row being written', async () => {
  let last: any = null;
  const rows = [...wos(2), staged('s1', 'odooScrap')];
  await run.runOdooWrites(rows, { concurrency: 1, writer: ok, onProgress: (p: any) => { last = p; } });
  assert.deepEqual(last.byGroup, { mixing: { total: 2, done: 2, failed: 0, unknown: 0 }, scrap: { total: 1, done: 1, failed: 0, unknown: 0 } });
  let current: string | null = null;
  await run.runOdooWrites(wos(1), { writer: ok, onProgress: (p: any) => { if (p.current) current = p.current; } });
  assert.match(String(current), /MO\/w1/);
});

test('A4. only what was approved is planned - context rows, errors and unapproved rows are counted as not planned', async () => {
  const rows = [
    ...wos(2),
    staged('m1', 'odooProduction'),
    staged('e1', 'odooWorkOrder', { row: { ...staged('e1', 'odooWorkOrder').row, errors: [{ field: 'x' }] } }),
    staged('u1', 'odooWorkOrder', { row: { ...staged('u1', 'odooWorkOrder').row, selection: 'EXCLUDED' } }),
  ];
  const written: string[] = [];
  const r = await run.runOdooWrites(rows, { writer: (i: any) => { written.push(i.row.rowId); return ok(i); } });
  assert.deepEqual(written.sort(), ['w1', 'w2']);
  assert.equal(r.final.total, 2);
  assert.equal(r.final.notPlanned, 2, 'the error row and the unselected row; the manufacturing order is context, not a skipped row');
});

// ==================================================
// B. FAILURES
// ==================================================

test('B1. a failed row is isolated: the run continues, the reason and where it came from are kept', async () => {
  const r = await run.runOdooWrites(wos(5), {
    concurrency: 1,
    writer: (i: any) => (i.row.rowId === 'w3' ? Promise.reject(new Error('كود المنتج غير موجود')) : ok(i)),
  });
  assert.equal(r.final.outcome, 'COMPLETED_WITH_ERRORS');
  assert.equal(r.final.percent, 100);
  assert.deepEqual([r.final.succeeded, r.final.failed, r.final.uncertain], [4, 1, 0]);
  const f = r.final.failures[0];
  assert.deepEqual([f.rowId, f.kind, f.reason, f.moReference, f.sourceFile, f.sourceRow, f.group], ['w3', 'FAILED', 'كود المنتج غير موجود', 'MO/w3', 'f.xlsx', 3, 'mixing']);
  assert.equal(r.staged.find((s: any) => s.row.rowId === 'w3').row.status, 'FAILED');
  assert.equal(r.staged.find((s: any) => s.row.rowId === 'w3').row.failureMessage, 'كود المنتج غير موجود');
});

test('B2. the step a failure happened in is recorded', async () => {
  const r = await run.runOdooWrites(wos(1), { writer: (_i: any, track: any) => { track('WORK_ORDER_WRITE'); return Promise.reject(new Error('x')); } });
  assert.equal(r.final.failures[0].step, 'WORK_ORDER_WRITE');
});

test('B3. 25 failures in a row stop the run instead of failing the whole file', async () => {
  const r = await run.runOdooWrites(wos(60), { concurrency: 1, writer: () => Promise.reject(new Error('الخادم رفض')) });
  assert.equal(r.final.outcome, 'INTERRUPTED');
  assert.equal(r.final.failed, run.ODOO_CONSECUTIVE_FAILURE_LIMIT);
  assert.ok(r.final.notStarted > 0);
  assert.match(String(r.final.error), /الخادم رفض/);
});

test('B4. a success resets the failure streak - scattered failures never trip the guard', async () => {
  const r = await run.runOdooWrites(wos(80), { concurrency: 1, writer: (i: any) => (Number(i.row.rowId.slice(1)) % 2 === 0 ? Promise.reject(new Error('x')) : ok(i)) });
  assert.equal(r.final.outcome, 'COMPLETED_WITH_ERRORS');
  assert.equal(r.final.failed, 40);
});

// ==================================================
// C. A WRITE THAT NEVER ANSWERS
// ==================================================

test('C1. a write that never resolves is bounded: OUTCOME UNKNOWN - not a failure, not a success - and the run goes on', async () => {
  const never = new Promise(() => {});
  const r = await run.runOdooWrites(wos(4), {
    concurrency: 1, recordTimeoutMs: 25, graceMs: 5,
    writer: (i: any, track: any) => { if (i.row.rowId === 'w2') { track('PRODUCTION_WRITE'); return never as any; } return ok(i); },
  });
  assert.deepEqual([r.final.succeeded, r.final.failed, r.final.uncertain], [3, 0, 1]);
  assert.equal(r.final.outcome, 'COMPLETED_WITH_ERRORS');
  const u = r.final.uncertainRows[0];
  assert.equal(u.kind, 'UNKNOWN');
  assert.match(u.reason, /OUTCOME UNKNOWN/);
  assert.equal(u.step, 'PRODUCTION_WRITE');
  const row = r.staged.find((s: any) => s.row.rowId === 'w2');
  assert.notEqual(row.row.status, 'IMPORTED');
  assert.notEqual(row.row.status, 'FAILED', 'the server may have committed it, so it is neither');
});

test('C2. five unknown outcomes in a row mean the server is not answering: the run stops and says so', async () => {
  const never = new Promise(() => {});
  const r = await run.runOdooWrites(wos(40), { concurrency: 1, recordTimeoutMs: 10, graceMs: 5, writer: () => never as any });
  assert.equal(r.final.outcome, 'INTERRUPTED');
  assert.equal(r.final.uncertain, run.ODOO_CONSECUTIVE_UNKNOWN_LIMIT);
  assert.ok(r.final.notStarted >= 30);
  assert.match(String(r.final.error), /لم يرد الخادم/);
});

// ==================================================
// D. STOP
// ==================================================

test('D1. stop: no new row starts, the run reports where it stopped, and written rows are kept', async () => {
  const controller = new AbortController();
  let started = 0;
  const r = await run.runOdooWrites(wos(20), {
    concurrency: 1, signal: controller.signal,
    writer: (i: any) => { started += 1; if (started === 3) controller.abort(); return ok(i); },
  });
  assert.equal(r.final.outcome, 'INTERRUPTED');
  assert.equal(started, 3, 'nothing started after the stop');
  assert.equal(r.final.succeeded, 3);
  assert.equal(r.final.notStarted, 17);
  assert.ok(r.final.percent < 100);
  assert.equal(r.staged.filter((s: any) => s.row.status === 'IMPORTED').length, 3);
});

test('D2. a write still in flight at the stop gets a short grace, then is recorded as unknown', async () => {
  const controller = new AbortController();
  const never = new Promise(() => {});
  const r = await run.runOdooWrites(wos(3), {
    concurrency: 1, signal: controller.signal, graceMs: 10, recordTimeoutMs: 60_000,
    writer: (_i: any) => { setTimeout(() => controller.abort(), 5); return never as any; },
  });
  assert.equal(r.final.uncertain, 1);
  assert.match(r.final.uncertainRows[0].reason, /الإيقاف/);
  assert.equal(r.final.notStarted, 2);
});

// ==================================================
// E. A RE-RUN NEVER WRITES A RECORD TWICE
// ==================================================

test('E1. a row whose identity is already in the database is recognised, counted and NOT written again', async () => {
  const written: string[] = [];
  const r = await run.runOdooWrites([...wos(4), staged('s1', 'odooScrap')], {
    concurrency: 1,
    existingKeys: new Set(['wo:key-w1', 'wo:key-w3', 'scrap:sp/s1']),
    identityOf: run.odooRowIdentity,
    writer: (i: any) => { written.push(i.row.rowId); return ok(i); },
  });
  assert.deepEqual(written, ['w2', 'w4']);
  assert.deepEqual([r.final.succeeded, r.final.alreadyImported, r.final.processed], [2, 3, 5]);
  assert.equal(r.final.outcome, 'COMPLETED');
  assert.equal(r.final.percent, 100);
  assert.equal(r.staged.find((s: any) => s.row.rowId === 'w1').row.status, 'IMPORTED');
});

test('E2. identity is only checked against what was ALREADY stored - two rows with one identity in the same file are both written', async () => {
  const twins = [staged('w1', 'odooWorkOrder', { identityKey: 'same' }), staged('w2', 'odooWorkOrder', { identityKey: 'same' })];
  const written: string[] = [];
  await run.runOdooWrites(twins, { concurrency: 1, existingKeys: new Set(), identityOf: run.odooRowIdentity, writer: (i: any) => { written.push(i.row.rowId); return ok(i); } });
  assert.deepEqual(written, ['w1', 'w2'], 'legitimate extra production of the same order is never dropped');
});

test('E3. a row without an identity (a scrap line with no reference) is always written', async () => {
  const noRef = staged('s1', 'odooScrap', { payload: {} });
  assert.equal(run.odooRowIdentity(noRef), null);
  const written: string[] = [];
  await run.runOdooWrites([noRef], { existingKeys: new Set(['scrap:']), identityOf: run.odooRowIdentity, writer: (i: any) => { written.push(i.row.rowId); return ok(i); } });
  assert.deepEqual(written, ['s1']);
});

test('E4. the identity a STORED work order is matched by equals the one the staged row carries (real reader output)', () => {
  const ctx = (f: string) => ({ importSessionId: 'S', fileName: f, sheetName: 'Sheet1' });
  const MO = { Reference: 'خلط/MO/1', 'Product Template/Internal Reference': 'LCC8001', 'Finished Product': '[LCC8001] x', 'Product Unit of Measure': 'Ton', 'Quantity To Produce': 2, 'Work Orders/Work Center': 'الخلاطات', 'Scheduled Date': 46023 };
  const WO = { 'Manufacturing Order': 'خلط/MO/1', 'Scheduled Start Date': 46022.3, Product: '[LCC8001] x', Quantity: 2, Status: 'Finished', 'Work Center': 'الخلاطات', 'Work Order': '2', Employees: 'a' };
  const p = prod.readMrpProduction([MO], ctx('mo.xlsx'));
  const w = wo.readMrpWorkOrder([WO], ctx('wo.xlsx'), []);
  const built = sess.buildOdooImportSession({ importSessionId: 'S', createdBy: 'u', createdAt: 'n', production: p.rows, workOrders: w.rows, scrap: [], approvedWorkCenters: [] });
  const item = built.staged.find((s: any) => s.kind === 'odooWorkOrder');
  const n = w.rows[0].normalized;
  // What the writer stores on the work-order document, by the service's own field names.
  const storedWithoutKey = {
    manufacturingOrderNumber: n.moReference, productCode: n.productCode, rawWorkOrder: n.rawWorkOrder, shiftNumber: n.shiftNumber,
    workCenter: n.workCenter, externalRefs: [],
  };
  assert.equal(run.storedWorkOrderIdentity(storedWithoutKey), run.odooRowIdentity(item), 'an old record with no identityKey is still recognised');
  assert.equal(run.storedWorkOrderIdentity({ ...storedWithoutKey, identityKey: item.identityKey }), run.odooRowIdentity(item), 'and a new one by its own key');
  assert.equal(run.storedScrapIdentity({ reference: 'SP/01785' }), 'scrap:sp/01785');
});

// ==================================================
// F. WIRING
// ==================================================

test('F1. the service reads what is already stored BEFORE writing, and refuses to start if it cannot', () => {
  const src = code('src/services/odooImportService.ts');
  const body = src.slice(src.indexOf('export async function executeOdooImport'));
  assert.ok(/const existingKeys = await loadExistingOdooIdentities\(\);[\s\S]*runOdooWrites\(/.test(body), 'loaded first, so an unreadable database stops the run before any write');
  assert.ok(/identityOf: odooRowIdentity/.test(body) && /existingKeys,/.test(body));
  assert.ok(/identityKey: item\.identityKey \?\? null/.test(body), 'new work orders store the identity they are matched by');
  assert.ok(/identityKey: odooRowIdentity\(item\)/.test(body), 'and so does scrap');
  assert.equal(/for \(const item of staged\)/.test(body), false, 'the old unbounded sequential loop is gone');
});

test('F2. the screen shows percentage, counts, a stop button, a warning on no progress and the failure list', () => {
  const src = code('src/components/admin/OdooHistoricalImportPanel.tsx');
  for (const id of ['odoo-import-progress', 'odoo-import-percent', 'odoo-import-stop', 'odoo-import-final', 'odoo-import-failures', 'odoo-import-uncertain', 'odoo-import-preparing']) {
    assert.ok(src.includes(`id="${id}"`), `${id} must be on screen`);
  }
  assert.ok(/signal: controller\.signal,\s*onProgress:/.test(src), 'the run is stoppable and reports progress');
  assert.ok(/addEventListener\('beforeunload', guard\)/.test(src), 'closing the tab during a write is warned about');
  assert.ok(/clock - runProgress\.lastProgressAt > 60_000/.test(src), 'a stall is visible');
  assert.ok(/setInterval\(\(\) => \{[\s\S]*?\}, 500\)/.test(src), 'progress is flushed twice a second, not per row');
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

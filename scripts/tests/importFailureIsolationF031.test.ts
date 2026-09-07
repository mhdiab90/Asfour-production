/**
 * F-03.1 - row-level failure isolation for the two remaining historical
 * import modules:
 *
 *   - chineseMillsHistoricalImportService.executeChineseMillsBatchImport
 *   - historicalImportService.executeBatchImport   (generic 5-stage path)
 *
 * Both previously wrote one atomic writeBatch per 400-row chunk, so a single
 * rejected row discarded every other already-validated row in that chunk.
 * Both now delegate to runChunkedWriteWithFallback - the SAME orchestrator
 * Tube/Ball Mills and Pressing already use.
 *
 * The orchestrator's control flow is exercised directly with fake write
 * functions (zero Firestore); each module's wiring and its unchanged
 * eligibility/duplicate/validation behaviour are verified by source
 * inspection, the convention every suite in this directory uses.
 *
 * Run: npx tsx scripts/tests/importFailureIsolationF031.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChunkedWriteWithFallback } from '../../src/services/tubeBallMillsChunkedWritePure';
import {
  getRowSelection as getChineseMillsRowSelection,
  isChineseMillsRowWritable,
} from '../../src/services/chineseMillsSelectionPure';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, '../..', rel), 'utf-8');
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const cmSource = read('src/services/chineseMillsHistoricalImportService.ts');
const cmCode = stripComments(cmSource);
const genSource = read('src/services/historicalImportService.ts');
const genCode = stripComments(genSource);
const pressingCode = stripComments(read('src/services/pressingHistoricalImportService.ts'));

function makeWriters(failingIds: Set<number>, chunkFails: (chunkIndex: number) => boolean) {
  const chunkCalls: number[][] = [];
  const oneCalls: number[] = [];
  let chunkIndex = 0;
  return {
    chunkCalls,
    oneCalls,
    writeChunk: async (chunk: Array<{ id: number }>) => {
      const idx = chunkIndex++;
      chunkCalls.push(chunk.map((c) => c.id));
      if (chunkFails(idx)) throw new Error(`simulated atomic batch failure on chunk ${idx}`);
    },
    writeOne: async (item: { id: number }) => {
      oneCalls.push(item.id);
      if (failingIds.has(item.id)) throw new Error(`row ${item.id} rejected`);
    },
  };
}
const mkItems = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

await (async () => {

// ---------------------------------------------------------------------------
// TEST 1-3: the isolation outcomes both modules now inherit
// ---------------------------------------------------------------------------

await test('TEST 1 - 100 rows, 2 genuinely bad -> 98 imported / 2 failed (never 0/100)', async () => {
  const w = makeWriters(new Set([37, 82]), () => true);
  const r = await runChunkedWriteWithFallback({
    items: mkItems(100), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(r.importedIds.length, 98);
  assert.deepEqual(r.failedIds.sort((a, b) => (a as number) - (b as number)), [37, 82]);
});

await test('TEST 2 - 400 rows, ONE bad row -> 399 imported / 1 failed (never 0/400)', async () => {
  const w = makeWriters(new Set([250]), () => true);
  const r = await runChunkedWriteWithFallback({
    items: mkItems(400), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(r.importedIds.length, 399);
  assert.deepEqual(r.failedIds, [250]);
});

await test('TEST 3/4 - 800 rows, chunk 1 fails -> 799 imported, chunk 2 still executed', async () => {
  const w = makeWriters(new Set([7]), (i) => i === 0);
  const r = await runChunkedWriteWithFallback({
    items: mkItems(800), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(w.chunkCalls.length, 2, 'chunk 2 must still be attempted after chunk 1 fails');
  assert.equal(r.importedIds.length, 799);
  assert.deepEqual(r.failedIds, [7]);
  assert.equal(w.oneCalls.every((id) => id <= 400), true, 'chunk 2 rows must never enter the fallback');
});

// ---------------------------------------------------------------------------
// TEST 5-8: write efficiency, duplicate safety, bounded retry
// ---------------------------------------------------------------------------

await test('TEST 5 - a successful batch never triggers individual fallback writes', async () => {
  const w = makeWriters(new Set(), () => false);
  const r = await runChunkedWriteWithFallback({
    items: mkItems(800), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(r.importedIds.length, 800);
  assert.equal(w.oneCalls.length, 0, 'no write amplification on the normal path');
});

await test('TEST 6 - a row written via fallback is never written twice', async () => {
  const w = makeWriters(new Set([3]), (i) => i === 0);
  await runChunkedWriteWithFallback({
    items: mkItems(10), chunkSize: 5, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.deepEqual(w.oneCalls, [1, 2, 3, 4, 5]);
  assert.equal(new Set(w.oneCalls).size, w.oneCalls.length);
});

await test('TEST 7/8 - permanently failing rows are attempted exactly once; no infinite retry', async () => {
  const w = makeWriters(new Set([1, 2, 3]), () => true);
  const r = await runChunkedWriteWithFallback({
    items: mkItems(3), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(r.failedIds.length, 3);
  assert.deepEqual(w.oneCalls, [1, 2, 3]);
  assert.equal(w.chunkCalls.length, 1);
  const orch = stripComments(read('src/services/tubeBallMillsChunkedWritePure.ts'));
  assert.equal(/while\s*\(/.test(orch), false);
  assert.equal(/maxRetries|retryCount|attempt/i.test(orch), false);
});

// ---------------------------------------------------------------------------
// TEST 9-13: eligibility gate (Chinese Mills' own selection semantics)
// ---------------------------------------------------------------------------

const mkCmRow = (over: any = {}) => ({
  rowIndex: 1, errors: [], warnings: [], rowSelection: 'INCLUDED', ...over,
}) as any;

await test('TEST 9 - an unapproved BLOCKING Chinese Mills row is never writable', () => {
  const blocking = mkCmRow({ errors: [{ field: 'date', message: 'bad' }] });
  assert.equal(isChineseMillsRowWritable(blocking), false);
});

await test('TEST 10/12 - EXCLUDED / PENDING (deselected or undecided) rows are never writable', () => {
  const excluded = mkCmRow({ rowSelection: 'EXCLUDED' });
  assert.equal(getChineseMillsRowSelection(excluded), 'EXCLUDED');
  assert.equal(isChineseMillsRowWritable(excluded), false);

  // Chinese Mills has a third state Pressing does not: a row awaiting a
  // selection decision must not be silently imported either.
  const pending = mkCmRow({ rowSelection: 'PENDING' });
  assert.equal(getChineseMillsRowSelection(pending), 'PENDING');
  assert.equal(isChineseMillsRowWritable(pending), false);

  // An unresolved smart-match decision also blocks the write.
  const undecided = mkCmRow({ proposedMatches: [{ decision: 'PENDING' }] });
  assert.equal(isChineseMillsRowWritable(undecided), false);

  // An unaccepted warning blocks it too.
  const warned = mkCmRow({ warnings: [{ field: 'rate', message: 'low' }] });
  assert.equal(isChineseMillsRowWritable(warned), false);
});

await test('TEST 11 - the pre-write eligibility filter still gates what reaches the writer', () => {
  // Chinese Mills writes only its `writable` set...
  assert.match(cmCode, /const entries = writable\.map\(\(row\) => \{/);
  // ...and the generic path only its `writableRows` set.
  assert.match(genCode, /const entries = writableRows\.map\(\(row\) => \{/);
});

await test('TEST 13 - an eligible (corrected/included) row remains writable', () => {
  assert.equal(isChineseMillsRowWritable(mkCmRow()), true);
});

// ---------------------------------------------------------------------------
// TEST 14-15: counters and failed-row reviewability
// ---------------------------------------------------------------------------

await test('TEST 14 - counters derive from the isolated write result, not whole chunks', () => {
  assert.match(cmCode, /importedCount = writeResult\.importedIds\.length;/);
  assert.match(genCode, /success = writeResult\.importedIds\.length;/);
  // The old whole-chunk accounting is gone from both.
  assert.equal(/importedCount \+= chunk\.length/.test(cmCode), false);
  assert.equal(/success \+= chunk\.length/.test(genCode), false);
});

await test('TEST 15 - both modules surface failedRowIndexes for review', () => {
  assert.match(cmCode, /const failedRowIndexes = writeResult\.failedIds as number\[\];/);
  assert.match(cmCode, /failedRowIndexes: number\[\] \}> \{/);
  assert.match(cmCode, /return \{[\s\S]*?failedRowIndexes,[\s\S]*?\};/);
  assert.match(genCode, /const failedRowIndexes = writeResult\.failedIds as number\[\];/);
  assert.match(genCode, /failedRowIndexes: number\[\];/);
});

// ---------------------------------------------------------------------------
// TEST 16-17: duplicate detection and final validation untouched
// ---------------------------------------------------------------------------

await test('TEST 16 - Phase 4F duplicate detection / fail-closed recheck is intact', () => {
  // Generic path keeps its final recheck and its fail-closed exclusion sets.
  assert.match(genCode, /recheckFailedRowIndexes/);
  assert.match(genCode, /duplicateSkippedRowIndexes/);
  // recheckFailedRowIndexes is still distinct from the new failedRowIndexes.
  assert.match(genCode, /recheckFailedCount: recheckFailedRowIndexes\.length,/);
  // Chinese Mills keeps its own duplicate handling.
  assert.match(cmSource, /duplicate|مكرر/i);
});

await test('TEST 17 - final validation / write-eligibility semantics unchanged', () => {
  // Neither module widened what may be written: the writer still consumes
  // only the pre-computed eligible collection.
  assert.equal(/entries = rowsToImport\.map/.test(cmCode), false, 'Chinese Mills must not write raw rowsToImport');
  assert.equal(/entries = validRows\.map/.test(genCode), false, 'generic path must not write raw validRows');
});

// ---------------------------------------------------------------------------
// Wiring + scope
// ---------------------------------------------------------------------------

await test('W1 - both modules reuse the EXISTING orchestrator (no second strategy)', () => {
  for (const [name, code] of [['chineseMills', cmCode], ['generic', genCode]] as const) {
    assert.match(code, /import \{ runChunkedWriteWithFallback \} from '\.\/tubeBallMillsChunkedWritePure';/, name);
    assert.match(code, /await runChunkedWriteWithFallback\(\{/, name);
    assert.match(code, /writeOne: async \(e\) => \{ await safeSetDoc\(e\.docRef, e\.record\); \}|writeOne: async \(e\) => \{ await safeSetDoc\(e\.docRef, e\.payload\); \}/, name);
  }
  // The old manual chunk loops are gone.
  assert.equal(/for \(let i = 0; i < writable\.length; i \+= BATCH_SIZE\)/.test(cmCode), false);
  assert.equal(/for \(let i = 0; i < writableRows\.length; i \+= batchSize\)/.test(genCode), false);
});

await test('W2 - each row keeps a pre-assigned docRef so a retry cannot duplicate it', () => {
  assert.match(cmCode, /return \{ row, docRef, payload \};/);
  assert.match(genCode, /return \{ row, docRef, record \};/);
});

await test('W3 - Chinese Mills cancellation support is preserved', () => {
  assert.match(cmCode, /shouldCancel,/);
  assert.match(cmCode, /cancelledCount = writeResult\.cancelledCount;/);
});

await test('W4 - the Pressing F-03 fix is unchanged by this task', () => {
  assert.match(pressingCode, /await runChunkedWriteWithFallback\(\{/);
  assert.match(pressingCode, /const failedRowIndexes = writeResult\.failedIds as number\[\];/);
  assert.match(pressingCode, /const importedCount = writeResult\.importedIds\.length;/);
});

await test('W5 - the shared orchestrator itself was not modified', () => {
  const orch = read('src/services/tubeBallMillsChunkedWritePure.ts');
  assert.match(orch, /export async function runChunkedWriteWithFallback/);
  assert.match(orch, /const chunk = items\.slice\(i, i \+ chunkSize\);/);
  assert.match(orch, /await writeOne\(item\);/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

})();

/**
 * F-03 - focused tests for ROW-LEVEL failure isolation in the Pressing
 * historical import.
 *
 * THE DEFECT: a Firestore writeBatch().commit() is atomic, so the previous
 * one-batch-per-chunk loop counted all 400 rows of a chunk as failed when any
 * single row in it was rejected - discarding 399 already-validated rows
 * because of one bad neighbour.
 *
 * THE FIX: Pressing now delegates to runChunkedWriteWithFallback - the SAME
 * orchestrator Tube/Ball Mills already uses - rather than a second strategy.
 * These tests exercise that real control flow with fake write functions
 * (zero Firestore), and verify the Pressing wiring plus the eligibility gate
 * by source inspection, the convention every suite here uses.
 *
 * Run: npx tsx scripts/tests/pressingPartialFailureIsolation.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChunkedWriteWithFallback } from '../../src/services/tubeBallMillsChunkedWritePure';
import {
  isRowWritable,
  getRowSelection,
  isRowReadyToImport,
  getRowCategory,
} from '../../src/services/pressingSelectionPure';

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
const pressingSource = read('src/services/pressingHistoricalImportService.ts');
const pressingCode = stripComments(pressingSource);

/** Builds a fake write pair that records every call, so retries/duplicates are observable. */
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
// 1. 100 selected -> 98 success / 2 failure
// ---------------------------------------------------------------------------

await test('1. 100 selected rows, 2 genuinely bad -> 98 IMPORTED and 2 FAILED (never 0/100)', async () => {
  const w = makeWriters(new Set([37, 82]), () => true);
  const r = await runChunkedWriteWithFallback({
    items: mkItems(100), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(r.importedIds.length, 98);
  assert.deepEqual(r.failedIds.sort((a, b) => (a as number) - (b as number)), [37, 82]);
  assert.equal(r.importedIds.includes(37), false);
  assert.equal(r.errors.length, 2);
});

// ---------------------------------------------------------------------------
// 2. 400 selected, one failure -> 399 imported
// ---------------------------------------------------------------------------

await test('2. 400 selected rows, ONE bad row -> 399 imported, 1 failed (not 0/400)', async () => {
  const w = makeWriters(new Set([250]), () => true);
  const r = await runChunkedWriteWithFallback({
    items: mkItems(400), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(r.importedIds.length, 399);
  assert.deepEqual(r.failedIds, [250]);
});

// ---------------------------------------------------------------------------
// 3. 800 selected, first chunk fails -> second chunk still processed
// ---------------------------------------------------------------------------

await test('3. 800 rows, failure in chunk 1 does NOT stop chunk 2', async () => {
  const w = makeWriters(new Set([5]), (i) => i === 0); // only the first chunk's batch fails
  const r = await runChunkedWriteWithFallback({
    items: mkItems(800), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(w.chunkCalls.length, 2, 'both chunks must be attempted');
  assert.equal(r.importedIds.length, 799);
  assert.deepEqual(r.failedIds, [5]);
  // Chunk 2 committed atomically - its rows were never retried individually.
  assert.equal(w.oneCalls.every((id) => id <= 400), true, 'chunk 2 rows must not enter the per-row fallback');
  assert.equal(r.importedIds.includes(750), true);
});

// ---------------------------------------------------------------------------
// 4 & 15. Successful rows are never retried or written twice
// ---------------------------------------------------------------------------

await test('4. a chunk that COMMITS is never retried row-by-row (no write amplification)', async () => {
  const w = makeWriters(new Set(), () => false); // every batch succeeds
  const r = await runChunkedWriteWithFallback({
    items: mkItems(800), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(r.importedIds.length, 800);
  assert.equal(w.oneCalls.length, 0, 'the happy path must never call writeOne');
  assert.equal(w.chunkCalls.length, 2);
});

await test('15. no row is written more than once across chunk + fallback', async () => {
  const w = makeWriters(new Set([3]), (i) => i === 0);
  await runChunkedWriteWithFallback({
    items: mkItems(10), chunkSize: 5, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  // Chunk 1 failed -> its 5 rows retried once each. Chunk 2 committed -> not retried.
  assert.deepEqual(w.oneCalls, [1, 2, 3, 4, 5]);
  assert.equal(new Set(w.oneCalls).size, w.oneCalls.length, 'no row retried twice');
});

// ---------------------------------------------------------------------------
// 5. Failed rows remain identifiable/reviewable
// ---------------------------------------------------------------------------

await test('5a. failed row ids are returned so the UI can keep exactly those reviewable', async () => {
  const w = makeWriters(new Set([2, 9]), () => true);
  const r = await runChunkedWriteWithFallback({
    items: mkItems(10), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.deepEqual(r.failedIds.sort((a, b) => (a as number) - (b as number)), [2, 9]);
  assert.equal(r.errors.some((e) => e.includes('2')), true, 'a per-row reason must be recorded');
});

await test('5b. Pressing surfaces failedRowIndexes in its result contract', () => {
  assert.match(pressingCode, /failedRowIndexes: number\[\];/);
  assert.match(pressingCode, /const failedRowIndexes = writeResult\.failedIds as number\[\];/);
  assert.match(pressingCode, /return \{[\s\S]*?failedRowIndexes,[\s\S]*?\};/);
});

// ---------------------------------------------------------------------------
// 6-10. Eligibility gate - what may and may not reach Firestore
// ---------------------------------------------------------------------------

const mkRow = (over: any = {}) => ({
  rowIndex: 1, errors: [], warnings: [], rowSelection: 'INCLUDED', ...over,
}) as any;

await test('6. a BLOCKING row is never writable', () => {
  const blocking = mkRow({ errors: [{ field: 'date', message: 'bad' }] });
  assert.equal(isRowReadyToImport(blocking), false);
  assert.equal(isRowWritable(blocking), false);
  assert.equal(getRowCategory(blocking), 'BLOCKING');
});

await test('7/8. EXCLUDED / deselected rows are never writable', () => {
  const excluded = mkRow({ rowSelection: 'EXCLUDED' });
  assert.equal(getRowSelection(excluded), 'EXCLUDED');
  assert.equal(isRowWritable(excluded), false);
  assert.equal(getRowCategory(excluded), 'EXCLUDED');
});

await test('9. an UNSELECTED valid row is never writable even though it is valid', () => {
  const valid = mkRow();
  assert.equal(isRowWritable(valid), true);
  const deselected = mkRow({ rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' });
  assert.equal(isRowReadyToImport(deselected), true, 'still intrinsically valid...');
  assert.equal(isRowWritable(deselected), false, '...but must not be written');
});

await test('10. a CORRECTED selected row IS writable', () => {
  const corrected = mkRow({ correctedFields: { date: '2026-01-01' } });
  assert.equal(isRowWritable(corrected), true);
});

// ---------------------------------------------------------------------------
// 11-12. Counters and final revalidation
// ---------------------------------------------------------------------------

await test('11. Pressing derives its counters from the isolated write result', () => {
  assert.match(pressingCode, /const importedCount = writeResult\.importedIds\.length;/);
  assert.match(pressingCode, /const failedCount = writeResult\.failedIds\.length;/);
  assert.match(pressingCode, /const errors = writeResult\.errors;/);
  // skippedCount still derives from the pre-write eligibility filter.
  assert.match(pressingCode, /const skippedCount = rowsToImport\.length - importableRows\.length;/);
  // The old whole-chunk accounting is gone.
  assert.equal(/failedCount \+= chunk\.length/.test(pressingCode), false);
  assert.equal(/importedCount \+= chunk\.length/.test(pressingCode), false);
});

await test('12a. final pre-write eligibility filter is unchanged - blocking rows never reach the writer', () => {
  assert.match(pressingCode, /const importableRows = rowsToImport\.filter\(r => r\.errors\.length === 0\);/);
});

await test('12b. the Phase 4F fail-closed duplicate recheck is untouched', () => {
  assert.match(pressingSource, /DUPLICATE_RECHECK_FAILED/);
  assert.match(pressingSource, /failing closed for this anchor group/);
});

// ---------------------------------------------------------------------------
// 13-14. Bounded retry, no infinite loop
// ---------------------------------------------------------------------------

await test('13/14. the fallback is a single bounded pass - a permanently failing row is attempted exactly once', async () => {
  const w = makeWriters(new Set([1, 2, 3]), () => true); // every row fails, every batch fails
  const r = await runChunkedWriteWithFallback({
    items: mkItems(3), chunkSize: 400, getId: (x) => x.id,
    writeChunk: w.writeChunk, writeOne: w.writeOne,
  });
  assert.equal(r.importedIds.length, 0);
  assert.equal(r.failedIds.length, 3);
  assert.deepEqual(w.oneCalls, [1, 2, 3], 'each row attempted exactly once - no retry loop');
  assert.equal(w.chunkCalls.length, 1, 'the failed chunk is not re-attempted as a chunk');
});

await test('14b. the orchestrator contains no retry loop construct around writeOne', () => {
  const orch = stripComments(read('src/services/tubeBallMillsChunkedWritePure.ts'));
  assert.equal(/while\s*\(/.test(orch), false, 'no while-loop retry');
  assert.equal(/attempt|maxRetries|retryCount/i.test(orch), false, 'no unbounded retry bookkeeping');
});

// ---------------------------------------------------------------------------
// Wiring / scope
// ---------------------------------------------------------------------------

await test('W1. Pressing uses the EXISTING orchestrator, not a second strategy', () => {
  assert.match(pressingCode, /import \{ runChunkedWriteWithFallback \} from '\.\/tubeBallMillsChunkedWritePure';/);
  assert.match(pressingCode, /await runChunkedWriteWithFallback\(\{/);
  assert.match(pressingCode, /writeOne: async \(e\) => \{ await safeSetDoc\(e\.docRef, e\.payload\); \}/);
  // The old manual batch loop is gone.
  assert.equal(/for \(let batchIndex = 0; batchIndex < totalBatches; batchIndex\+\+\)/.test(pressingCode), false);
});

await test('W2. each row carries a pre-assigned docRef, so a retry cannot duplicate it', () => {
  assert.match(pressingCode, /const entries = importableRows\.map\(row => \{/);
  assert.match(pressingCode, /const docRef = doc\(collection\(db, 'production'\)\);/);
  assert.match(pressingCode, /return \{ row, docRef, payload: enrichedPayload \};/);
});

await test('W3. Tube/Ball Mills keeps using the same orchestrator (unchanged by this task)', () => {
  const tb = read('src/services/tubeBallMillsHistoricalImportService.ts');
  assert.match(tb, /runChunkedWriteWithFallback\(\{/);
  assert.match(tb, /writeOne: async \(e\) => \{ await safeSetDoc\(e\.docRef, e\.payload\); \}/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

})();

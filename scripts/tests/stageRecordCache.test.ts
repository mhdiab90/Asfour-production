/**
 * Phase 4B - CACHE BOUNDED STAGE RESULTS tests.
 *
 * `isStageQueryCacheEligible` / `buildStageQueryCacheKey` (stageQueryBoundsPure.ts)
 * are pure/Firebase-free and tested directly. `fetchUniversalStageRecords`
 * itself (stageRecordService.ts) is tightly coupled to the real Firebase
 * SDK - by this project's established convention (see
 * masterDataCacheVerification.test.ts) its cache-dispatch CONTRACT is
 * instead verified two ways: (a) exercising the exact same
 * `runCacheFirstRead` orchestration it delegates to, with a spy standing
 * in for the bounded Firestore read and an injected in-memory
 * LocalCacheStore, and (b) direct source inspection confirming the
 * dispatcher wires eligibility/cache-key correctly and that no unbounded
 * fallback path exists. Never touches real Firestore, never opens a real
 * IndexedDB - zero production reads, zero writes.
 *
 * Run: npx tsx scripts/tests/stageRecordCache.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalCacheStore, CacheEntry, KeyValueBackend, runCacheFirstRead } from '../../src/services/localCacheStore';
import { isStageQueryCacheEligible, buildStageQueryCacheKey } from '../../src/services/stageQueryBoundsPure';

let passed = 0;
let failed = 0;
const registeredTests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registeredTests.push({ name, fn });
}

console.log('stageRecordCache.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const servicePath = path.resolve(__dirname, '../../src/services/stageRecordService.ts');
const source = fs.readFileSync(servicePath, 'utf-8');

function extractFunctionBody(fullSource: string, functionSignatureStart: string): string {
  const startIdx = fullSource.indexOf(functionSignatureStart);
  if (startIdx === -1) throw new Error(`Could not find "${functionSignatureStart}" in source`);
  const firstBraceIdx = fullSource.indexOf('{', startIdx);
  let depth = 0;
  for (let i = firstBraceIdx; i < fullSource.length; i++) {
    if (fullSource[i] === '{') depth++;
    else if (fullSource[i] === '}') {
      depth--;
      if (depth === 0) return fullSource.slice(startIdx, i + 1);
    }
  }
  throw new Error(`Could not find matching closing brace for "${functionSignatureStart}"`);
}

function createInMemoryBackend(): KeyValueBackend {
  const store = new Map<string, CacheEntry>();
  return {
    async get(key) { return store.get(key); },
    async put(entry) { store.set(entry.key, entry); },
    async delete(key) { store.delete(key); },
    async getAllEntries() { return [...store.values()]; },
  };
}

function createSourceSpy<T>(result: T[], delayMs = 0) {
  let callCount = 0;
  const fn = async (): Promise<T[]> => {
    callCount++;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return result;
  };
  return { fn, getCallCount: () => callCount };
}

const DEFAULT_TTL = 5 * 60 * 1000;

function wireCache(store: LocalCacheStore) {
  return {
    cacheGet: (userScope: string, collectionName: string, ttlMs: number) => store.get(userScope, collectionName, ttlMs),
    cacheSet: (userScope: string, collectionName: string, data: any[]) => store.save(userScope, collectionName, data),
  };
}

// ==================================================
// §1/§2 Eligibility rules (pure, direct)
// ==================================================
test('#1 both startDate and endDate present and valid -> eligible', () => {
  assert.equal(isStageQueryCacheEligible({ startDate: '2026-01-01', endDate: '2026-01-31' }), true);
});

test('#2 missing startDate -> NEVER cached', () => {
  assert.equal(isStageQueryCacheEligible({ endDate: '2026-01-31' }), false);
});

test('#3 missing endDate -> NEVER cached', () => {
  assert.equal(isStageQueryCacheEligible({ startDate: '2026-01-01' }), false);
});

test('#4 no filters at all -> NEVER cached (matches Dashboard/DashboardBuilderView\'s unbounded call)', () => {
  assert.equal(isStageQueryCacheEligible(undefined), false);
  assert.equal(isStageQueryCacheEligible({}), false);
});

test('#5 invalid/inverted range (startDate > endDate) -> NEVER cached', () => {
  assert.equal(isStageQueryCacheEligible({ startDate: '2026-02-01', endDate: '2026-01-01' }), false);
});

test('#6 malformed date strings -> NEVER cached', () => {
  assert.equal(isStageQueryCacheEligible({ startDate: '01/01/2026', endDate: '2026-01-31' }), false);
  assert.equal(isStageQueryCacheEligible({ startDate: '2026-01-01', endDate: 'not-a-date' }), false);
  assert.equal(isStageQueryCacheEligible({ startDate: '2026-13-01', endDate: '2026-01-31' }), false, 'month 13 is invalid');
  assert.equal(isStageQueryCacheEligible({ startDate: '2026-02-30', endDate: '2026-03-01' }), false, 'Feb 30 does not exist');
});

test('#7 empty-string startDate/endDate -> NEVER cached (matches the existing "" == absent convention)', () => {
  assert.equal(isStageQueryCacheEligible({ startDate: '', endDate: '2026-01-31' }), false);
});

test('#8 equal startDate === endDate (single-day range) -> eligible (not an inverted range)', () => {
  assert.equal(isStageQueryCacheEligible({ startDate: '2026-01-15', endDate: '2026-01-15' }), true);
});

// ==================================================
// §3 Deterministic cache-key isolation (pure, direct)
// ==================================================
test('#9 distinct date ranges produce distinct cache keys', () => {
  const keyA = buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31' });
  const keyB = buildStageQueryCacheKey({ startDate: '2026-02-01', endDate: '2026-02-28' });
  assert.notEqual(keyA, keyB);
});

test('#10 distinct stageType produces a distinct cache key for the SAME date range', () => {
  const keyAll = buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31' });
  const keyChinese = buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31', stageType: 'chinese_mills' });
  const keySorting = buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31', stageType: 'sorting' });
  assert.notEqual(keyAll, keyChinese);
  assert.notEqual(keyChinese, keySorting);
});

test('#11 the SAME date range and stageType always produce the SAME cache key (deterministic)', () => {
  const key1 = buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31', stageType: 'mixing' });
  const key2 = buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31', stageType: 'mixing' });
  assert.equal(key1, key2);
});

test('#12 stageType "all" and an explicit omission normalize to the same cache key', () => {
  const keyOmitted = buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31' });
  const keyExplicitAll = buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31', stageType: 'all' });
  assert.equal(keyOmitted, keyExplicitAll);
});

// ==================================================
// §4 Cache-orchestration behavior via runCacheFirstRead (the exact
// function fetchUniversalStageRecords delegates to when eligible)
// ==================================================
test('#13 BOUNDED CACHE MISS: empty cache -> source read exactly once, result saved into cache', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const filters = { startDate: '2026-01-01', endDate: '2026-01-31' };
  const key = buildStageQueryCacheKey(filters);
  const sourceResult = [{ id: 'r1', date: '2026-01-15' }];
  const spy = createSourceSpy(sourceResult);

  const result = await runCacheFirstRead({
    userScope: 'user-1', collectionName: key, readFromSource: spy.fn, ...wireCache(store),
  });

  assert.equal(spy.getCallCount(), 1, 'PASS criterion: cache miss = exactly one bounded source read');
  assert.deepEqual(result, sourceResult);
  assert.deepEqual(await store.get('user-1', key, DEFAULT_TTL), sourceResult, 'result must be saved into the cache after a miss');
});

test('#14 BOUNDED CACHE HIT: valid cached data is returned, source read ZERO times', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const filters = { startDate: '2026-01-01', endDate: '2026-01-31' };
  const key = buildStageQueryCacheKey(filters);
  const cachedData = [{ id: 'r1', date: '2026-01-15' }];
  await store.save('user-1', key, cachedData);

  const spy = createSourceSpy([{ id: 'SHOULD-NOT-APPEAR', date: '2026-01-01' }]);
  const result = await runCacheFirstRead({
    userScope: 'user-1', collectionName: key, readFromSource: spy.fn, ...wireCache(store),
  });

  assert.deepEqual(result, cachedData);
  assert.equal(spy.getCallCount(), 0, 'PASS criterion: cache hit = 0 source reads');
});

test('#15 CONCURRENT COLD-CACHE CALLS: 3 concurrent calls for the SAME bounded key share ONE in-flight source read', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const filters = { startDate: '2026-03-01', endDate: '2026-03-31' };
  const key = buildStageQueryCacheKey(filters);
  const spy = createSourceSpy([{ id: 'x1', date: '2026-03-15' }], 10);

  const results = await Promise.all([
    runCacheFirstRead({ userScope: 'user-1', collectionName: key, readFromSource: spy.fn, ...wireCache(store) }),
    runCacheFirstRead({ userScope: 'user-1', collectionName: key, readFromSource: spy.fn, ...wireCache(store) }),
    runCacheFirstRead({ userScope: 'user-1', collectionName: key, readFromSource: spy.fn, ...wireCache(store) }),
  ]);

  assert.equal(spy.getCallCount(), 1, 'FIXED (reused from Phase 1.1): 3 concurrent calls on an empty cache must share exactly 1 source read');
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[1], results[2]);
});

test('#16 CACHE READ FAILURE: a fully unavailable backend never breaks the read - falls back to the source (bounded) read every time, never throws', async () => {
  const store = new LocalCacheStore(null); // simulates IndexedDB unavailable
  const filters = { startDate: '2026-01-01', endDate: '2026-01-31' };
  const key = buildStageQueryCacheKey(filters);
  const sourceResult = [{ id: 'e1', date: '2026-01-10' }];
  const spy = createSourceSpy(sourceResult);

  const result = await runCacheFirstRead({ userScope: 'user-1', collectionName: key, readFromSource: spy.fn, ...wireCache(store) });
  assert.equal(spy.getCallCount(), 1);
  assert.deepEqual(result, sourceResult);

  const result2 = await runCacheFirstRead({ userScope: 'user-1', collectionName: key, readFromSource: spy.fn, ...wireCache(store) });
  assert.equal(spy.getCallCount(), 2, 'CRITICAL SAFETY: a cache-unavailable backend must fall back to the bounded source read every time, never throw, never hang');
  assert.deepEqual(result2, sourceResult);
});

test('#17 CACHE WRITE FAILURE: a backend whose put() always fails still returns the correct bounded result', async () => {
  const throwingPutBackend: KeyValueBackend = {
    async get() { return undefined; },
    async put() { throw new Error('simulated IndexedDB write failure'); },
    async delete() { /* no-op */ },
    async getAllEntries() { return []; },
  };
  const store = new LocalCacheStore(throwingPutBackend);
  const filters = { startDate: '2026-01-01', endDate: '2026-01-31' };
  const key = buildStageQueryCacheKey(filters);
  const sourceResult = [{ id: 'f1', date: '2026-01-20' }];
  const spy = createSourceSpy(sourceResult);

  const result = await runCacheFirstRead({ userScope: 'user-1', collectionName: key, readFromSource: spy.fn, ...wireCache(store) });
  assert.deepEqual(result, sourceResult, 'a cache write failure must never prevent the correct bounded result from being returned');
  assert.equal(spy.getCallCount(), 1);
});

test('#18 CORRUPT CACHE: malformed cached data is treated as a miss, falls back to the bounded source read, and is replaced by the valid result', async () => {
  const backend = createInMemoryBackend();
  const store = new LocalCacheStore(backend);
  const filters = { startDate: '2026-01-01', endDate: '2026-01-31' };
  const key = buildStageQueryCacheKey(filters);
  await backend.put({
    key: `user-1::${key}`,
    collectionName: key,
    userScope: 'user-1',
    schemaVersion: 1,
    savedAt: Date.now(),
    data: 'this is not an array' as any,
  });

  const validResult = [{ id: 'g1', date: '2026-01-05' }];
  const spy = createSourceSpy(validResult);
  const result = await runCacheFirstRead({ userScope: 'user-1', collectionName: key, readFromSource: spy.fn, ...wireCache(store) });

  assert.equal(spy.getCallCount(), 1);
  assert.deepEqual(result, validResult);
  assert.deepEqual(await store.get('user-1', key, DEFAULT_TTL), validResult, 'the corrupt entry must be replaced by the valid result');
});

test('#19 USER ISOLATION: User A\'s cached bounded result never reaches User B for the identical date range/stage', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const filters = { startDate: '2026-01-01', endDate: '2026-01-31' };
  const key = buildStageQueryCacheKey(filters);
  await store.save('user-A', key, [{ id: 'a-only', date: '2026-01-01' }]);

  const spyB = createSourceSpy([{ id: 'b-fresh', date: '2026-01-02' }]);
  const resultB = await runCacheFirstRead({ userScope: 'user-B', collectionName: key, readFromSource: spyB.fn, ...wireCache(store) });

  assert.equal(spyB.getCallCount(), 1, 'User B must never see User A\'s cache - this is a miss for User B');
  assert.deepEqual(resultB, [{ id: 'b-fresh', date: '2026-01-02' }]);
});

test('#20 TTL REUSE: no ttlMs is passed by the stageRecordService dispatcher, so runCacheFirstRead\'s own default (MASTER_DATA_CACHE_TTL_MS, 5 minutes) applies unchanged - verified by source inspection, not a new policy', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchUniversalStageRecords');
  assert.equal(/ttlMs/.test(fnBody), false, 'no custom TTL is passed - the existing 5-minute default from localCacheStore.ts is reused as-is');
});

// ==================================================
// §5 Dispatcher wiring / safety invariants (source inspection)
// ==================================================
test('#21 the public fetchUniversalStageRecords signature is unchanged (still takes an optional MultiDimensionFilter) - every existing caller compiles with zero changes', () => {
  assert.match(source, /export async function fetchUniversalStageRecords\(\s*filters\?\s*:\s*MultiDimensionFilter\s*\)\s*:\s*Promise<UniversalStageRecord\[\]>/);
});

test('#22 the dispatcher checks isStageQueryCacheEligible before ever calling runCacheFirstRead - an ineligible query never touches the cache path', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchUniversalStageRecords');
  assert.match(fnBody, /if \(!isStageQueryCacheEligible\(filters\)\)/);
  const ineligibleIdx = fnBody.indexOf('if (!isStageQueryCacheEligible(filters))');
  const cacheCallIdx = fnBody.indexOf('runCacheFirstRead');
  assert.ok(ineligibleIdx < cacheCallIdx, 'the eligibility check must come before the cache-path call');
});

test('#23 the cache path always calls fetchUniversalStageRecordsUncached (the unchanged Phase 4A bounded fetch) as its readFromSource - never a second/different query implementation', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchUniversalStageRecords');
  assert.match(fnBody, /readFromSource:\s*\(\)\s*=>\s*fetchUniversalStageRecordsUncached\(filters\)/);
});

test('#24 the ineligible branch also calls fetchUniversalStageRecordsUncached directly, with no cache wrapper - byte-identical to the Phase 4A behavior for unbounded/partial/invalid-range queries', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchUniversalStageRecords');
  assert.match(fnBody, /return fetchUniversalStageRecordsUncached\(filters\);/);
});

test('#25 no new limit() was introduced by the Phase 4B dispatcher itself', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchUniversalStageRecords');
  assert.equal(/\blimit\(/.test(fnBody), false);
});

test('#26 Phase 4A\'s bounded Firestore query (inclusive >=/<= on "date", no orderBy, no composite index) is unchanged inside fetchUniversalStageRecordsUncached', () => {
  const fnBody = extractFunctionBody(source, 'async function fetchUniversalStageRecordsUncached');
  assert.match(fnBody, /where\('date',\s*'>=',\s*bounds\.startDate\)/);
  assert.match(fnBody, /where\('date',\s*'<=',\s*bounds\.endDate\)/);
  assert.equal(/orderBy\(/.test(fnBody), false);
});

test('#27 no "cache failure -> fall back to an UNBOUNDED getDocs" path exists anywhere in this file - the only getDocs() calls remain inside fetchUniversalStageRecordsUncached\'s existing bounded/unbounded branch, unchanged from Phase 4A', () => {
  const dispatcherBody = extractFunctionBody(source, 'export async function fetchUniversalStageRecords');
  assert.equal(/getDocs\(/.test(dispatcherBody), false, 'the dispatcher itself must never call getDocs directly - only via fetchUniversalStageRecordsUncached');
});

test('#28 createStageRecord/updateStageRecord/setRecordApprovalStatus remain textually unchanged - no invalidation call was added to any write path (per the documented STOP-and-report finding)', () => {
  const createFn = extractFunctionBody(source, 'export async function createStageRecord');
  const updateFn = extractFunctionBody(source, 'export async function updateStageRecord');
  const approvalFn = extractFunctionBody(source, 'export async function setRecordApprovalStatus');
  assert.equal(/invalidateCachedCollection|invalidate\(/.test(createFn), false);
  assert.equal(/invalidateCachedCollection|invalidate\(/.test(updateFn), false);
  assert.equal(/invalidateCachedCollection|invalidate\(/.test(approvalFn), false);
});

test('#29 ReportsView.tsx and Dashboard/DashboardBuilderView call sites are untouched by Phase 4B (same call sites verified in stageRecordQueryBounds.test.ts #13/#14) - Reports\' bounded filters automatically flow into the new cache path, Dashboard\'s unbounded call automatically stays uncached, with zero changes to either file', () => {
  const reportsPath = path.resolve(__dirname, '../../src/components/reports/ReportsView.tsx');
  const dashPath = path.resolve(__dirname, '../../src/components/dashboard/DashboardView.tsx');
  const builderPath = path.resolve(__dirname, '../../src/components/dashboard/DashboardBuilderView.tsx');
  assert.match(fs.readFileSync(reportsPath, 'utf-8'), /fetchUniversalStageRecords\(filters\)/);
  assert.match(fs.readFileSync(dashPath, 'utf-8'), /fetchUniversalStageRecords\(\)/);
  assert.match(fs.readFileSync(builderPath, 'utf-8'), /fetchUniversalStageRecords\(\)/);
});

test('#30 no new dependency was introduced - stageQueryBoundsPure.ts still has zero imports beyond ../types', () => {
  const purePath = path.resolve(__dirname, '../../src/services/stageQueryBoundsPure.ts');
  const pureSource = fs.readFileSync(purePath, 'utf-8');
  const importLines = [...pureSource.matchAll(/^import .+$/gm)].map(m => m[0]);
  assert.equal(importLines.length, 1);
  assert.match(importLines[0], /from '\.\.\/types'/);
});

async function main() {
  for (const { name, fn } of registeredTests) {
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
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

// ==================================================
// PHASE 5E.2 - cache IDENTITY correctness.
//
// buildStageQueryCacheKey must distinguish any two queries that can return
// different record sets. fetchUniversalStageRecordsUncached applies
// status/productId/customerId/employeeId/searchQuery as client-side filters
// INSIDE the cached function, so those dimensions change the cached payload
// and therefore must change the key. The v1 key omitted them, which let a
// narrowed payload be served as if it were the full result set.
// ==================================================

const BASE = { startDate: '2026-01-01', endDate: '2026-01-31' } as const;

test('5E.2-MANDATORY REGRESSION: same stage+range, status=SUBMITTED vs status=all -> DIFFERENT keys', () => {
  const keyA = buildStageQueryCacheKey({ stageType: 'all', startDate: '2026-01-01', endDate: '2026-01-31', status: 'SUBMITTED' });
  const keyB = buildStageQueryCacheKey({ stageType: 'all', startDate: '2026-01-01', endDate: '2026-01-31', status: 'all' });
  assert.notEqual(keyA, keyB, 'a status-filtered payload must never be cached under the same key as the unfiltered one');
});

test('5E.2-1 identical filter inputs produce an identical key (deterministic)', () => {
  const f = { ...BASE, stageType: 'mixing' as const, status: 'APPROVED' as const, productId: 'p1', customerId: 'c1', employeeId: 'e1', searchQuery: 'abc' };
  assert.equal(buildStageQueryCacheKey({ ...f }), buildStageQueryCacheKey({ ...f }));
});

test('5E.2-2 different status -> different keys', () => {
  assert.notEqual(
    buildStageQueryCacheKey({ ...BASE, status: 'SUBMITTED' }),
    buildStageQueryCacheKey({ ...BASE, status: 'APPROVED' })
  );
});

test('5E.2-3 different searchQuery -> different keys', () => {
  assert.notEqual(
    buildStageQueryCacheKey({ ...BASE, searchQuery: 'alpha' }),
    buildStageQueryCacheKey({ ...BASE, searchQuery: 'beta' })
  );
});

test('5E.2-4 different productId -> different keys', () => {
  assert.notEqual(
    buildStageQueryCacheKey({ ...BASE, productId: 'p1' }),
    buildStageQueryCacheKey({ ...BASE, productId: 'p2' })
  );
});

test('5E.2-5 different customerId -> different keys', () => {
  assert.notEqual(
    buildStageQueryCacheKey({ ...BASE, customerId: 'c1' }),
    buildStageQueryCacheKey({ ...BASE, customerId: 'c2' })
  );
});

test('5E.2-6 different employeeId -> different keys', () => {
  assert.notEqual(
    buildStageQueryCacheKey({ ...BASE, employeeId: 'e1' }),
    buildStageQueryCacheKey({ ...BASE, employeeId: 'e2' })
  );
});

test('5E.2-7 different stageType -> different keys (unchanged from v1)', () => {
  assert.notEqual(
    buildStageQueryCacheKey({ ...BASE, stageType: 'mixing' }),
    buildStageQueryCacheKey({ ...BASE, stageType: 'sorting' })
  );
});

test('5E.2-8 different startDate -> different keys (unchanged from v1)', () => {
  assert.notEqual(
    buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31' }),
    buildStageQueryCacheKey({ startDate: '2026-01-02', endDate: '2026-01-31' })
  );
});

test('5E.2-9 different endDate -> different keys (unchanged from v1)', () => {
  assert.notEqual(
    buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-01-31' }),
    buildStageQueryCacheKey({ startDate: '2026-01-01', endDate: '2026-02-28' })
  );
});

test('5E.2-10 the key carries the v2 version prefix and no longer carries v1', () => {
  const key = buildStageQueryCacheKey(BASE);
  assert.match(key, /^stageRecords::v2::/);
  assert.equal(key.includes('::v1::'), false);
});

test('5E.2-11 undefined/empty normalize per the SERVICE\'s own semantics (no needless fragmentation)', () => {
  // status: falsy and the literal 'all' both mean "no status filter"
  // (stageRecordService line 426 short-circuits on both).
  const omitted = buildStageQueryCacheKey({ ...BASE });
  assert.equal(buildStageQueryCacheKey({ ...BASE, status: 'all' }), omitted);
  assert.equal(buildStageQueryCacheKey({ ...BASE, status: undefined }), omitted);
  // entity ids + searchQuery: falsy means "no filter", so '' === undefined.
  assert.equal(buildStageQueryCacheKey({ ...BASE, productId: '', customerId: '', employeeId: '', searchQuery: '' }), omitted);
  // stageType: omitted and explicit 'all' are the same collection set.
  assert.equal(buildStageQueryCacheKey({ ...BASE, stageType: 'all' }), omitted);
  // searchQuery is lower-cased by the service before matching, so differing
  // case returns an identical payload and must share one cache entry.
  assert.equal(
    buildStageQueryCacheKey({ ...BASE, searchQuery: 'ABC' }),
    buildStageQueryCacheKey({ ...BASE, searchQuery: 'abc' })
  );
});

test('5E.2-12 no collision between an "all" query and any single-dimension filtered query', () => {
  const all = buildStageQueryCacheKey({ ...BASE, stageType: 'all', status: 'all' });
  const variants = [
    buildStageQueryCacheKey({ ...BASE, status: 'SUBMITTED' }),
    buildStageQueryCacheKey({ ...BASE, productId: 'p1' }),
    buildStageQueryCacheKey({ ...BASE, customerId: 'c1' }),
    buildStageQueryCacheKey({ ...BASE, employeeId: 'e1' }),
    buildStageQueryCacheKey({ ...BASE, searchQuery: 'q' }),
    buildStageQueryCacheKey({ ...BASE, stageType: 'mixing' }),
  ];
  for (const v of variants) assert.notEqual(v, all);
  assert.equal(new Set([all, ...variants]).size, variants.length + 1, 'every variant must be a distinct cache entry');
});

test('5E.2-13 free-text values cannot forge another query\'s key (separator injection)', () => {
  // A crafted searchQuery must not be able to emit the `::`/`=` separators
  // and impersonate a different query's key.
  const forged = buildStageQueryCacheKey({ ...BASE, searchQuery: '::status=APPROVED::' });
  const real = buildStageQueryCacheKey({ ...BASE, status: 'APPROVED' });
  assert.notEqual(forged, real);
  assert.equal(forged.split('::').length, real.split('::').length, 'encoded values must not add extra separator segments');
});

test('5E.2-14 dimensions the service NEVER reads are excluded (no cache fragmentation)', () => {
  // stageRecordService reads only stageType/startDate/endDate/status/
  // productId/customerId/employeeId/searchQuery. These six exist on
  // MultiDimensionFilter but cannot change the payload, so they must not
  // split the cache.
  const base = buildStageQueryCacheKey({ ...BASE });
  const withUnused = buildStageQueryCacheKey({
    ...BASE,
    departmentId: 'd1', shiftId: 's1', productTypeId: 'pt1', pressId: 'pr1', furnaceId: 'f1', machineId: 'm1',
  });
  assert.equal(withUnused, base, 'filters the cached function ignores must not produce a separate cache entry');
});

main();

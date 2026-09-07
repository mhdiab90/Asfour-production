/**
 * Phase 1.1 - Local Cache VERIFICATION tests.
 *
 * Exercises `runCacheFirstRead` (localCacheStore.ts) - the exact
 * cache-then-source orchestration `masterDataService.ts`'s
 * `fetchMasterData` delegates to - with a spy standing in for the real
 * Firestore `getDocs` call, and an injected LocalCacheStore backed by an
 * in-memory fake so cache hit/miss/corruption scenarios are fully
 * controllable. Never touches real Firestore, never opens a real
 * IndexedDB - zero production reads, zero writes, matching this project's
 * established pure-logic/fake-backend testing convention.
 *
 * Run: npx tsx scripts/tests/masterDataCacheVerification.test.ts
 */
import assert from 'node:assert/strict';
import { LocalCacheStore, CacheEntry, KeyValueBackend, CACHE_SCHEMA_VERSION, runCacheFirstRead } from '../../src/services/localCacheStore';

let passed = 0;
let failed = 0;
const registeredTests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registeredTests.push({ name, fn });
}

console.log('masterDataCacheVerification.test.ts');

function createInMemoryBackend(): KeyValueBackend {
  const store = new Map<string, CacheEntry>();
  return {
    async get(key) { return store.get(key); },
    async put(entry) { store.set(entry.key, entry); },
    async delete(key) { store.delete(key); },
    async getAllEntries() { return [...store.values()]; },
  };
}

/** A call-counting spy standing in for the real Firestore getDocs() read. */
function createFirestoreSpy<T>(result: T[], delayMs = 0) {
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
// §1 Implementation path inspection (documentation marker - see the
// Phase 1.1 report for the full source-reading verification of
// fetchMasterData -> cache -> Firestore-when-required -> cache update)
// ==================================================
test('§1 (documentation marker) runCacheFirstRead is the exact function masterDataService.ts.fetchMasterData delegates to - verified by direct source inspection in the Phase 1.1 report, not re-derived here', () => {
  assert.equal(typeof runCacheFirstRead, 'function');
});

// ==================================================
// §2 Cache hit test
// ==================================================
test('§2 CACHE HIT: valid cached data is returned, and the Firestore spy is called ZERO times', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const cachedData = [{ id: 'd1', code: '501', name: 'Department 1' }];
  await store.save('user-1', 'departments', cachedData);

  const spy = createFirestoreSpy([{ id: 'SHOULD-NOT-APPEAR' }]);
  const result = await runCacheFirstRead({
    userScope: 'user-1', collectionName: 'departments', readFromSource: spy.fn, ...wireCache(store),
  });

  assert.deepEqual(result, cachedData, 'must return the cached data, never the spy result');
  assert.equal(spy.getCallCount(), 0, 'PASS criterion: cache hit = 0 Firestore reads');
});

// ==================================================
// §3 Cache miss test
// ==================================================
test('§3 CACHE MISS: empty cache -> Firestore called exactly once, correct data returned, result saved into cache', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const firestoreResult = [{ id: 'p1', code: 'PRESS-1' }];
  const spy = createFirestoreSpy(firestoreResult);

  const result = await runCacheFirstRead({
    userScope: 'user-1', collectionName: 'presses', readFromSource: spy.fn, ...wireCache(store),
  });

  assert.equal(spy.getCallCount(), 1, 'PASS criterion: cache miss = exactly one Firestore read');
  assert.deepEqual(result, firestoreResult);

  const nowCached = await store.get('user-1', 'presses', DEFAULT_TTL);
  assert.deepEqual(nowCached, firestoreResult, 'the Firestore result must be saved into the cache after a miss');
});

// ==================================================
// §4 No duplicate read test
// ==================================================
test('§4 NO DUPLICATE READ: 5 sequential calls after the first successful population all use the cache - only 1 total Firestore read', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const spy = createFirestoreSpy([{ id: 'c1' }, { id: 'c2' }]);

  for (let i = 0; i < 5; i++) {
    await runCacheFirstRead({ userScope: 'user-1', collectionName: 'customers', readFromSource: spy.fn, ...wireCache(store) });
  }

  assert.equal(spy.getCallCount(), 1, '5 calls against a warm cache must still total exactly 1 Firestore read (the first, populating call)');
});

// ==================================================
// §5 Concurrent request test - the read-storm finding + fix
// ==================================================
test('§5a FINDING (naive, pre-fix behavior): without request de-duplication, N concurrent calls on an empty cache would each independently miss and read Firestore', async () => {
  // Deliberately reimplements the cache-then-source sequence WITHOUT the
  // in-flight de-dupe runCacheFirstRead actually has, to concretely
  // demonstrate the read-storm this Phase 1.1 verification found and
  // fixed - this is NOT the shipped implementation, it exists only to
  // prove the finding was real.
  const store = new LocalCacheStore(createInMemoryBackend());
  const spy = createFirestoreSpy([{ id: 'x1' }], 10 /* small delay so the 3 calls genuinely overlap */);

  async function naiveCacheFirstRead(userScope: string, collectionName: string) {
    const cached = await store.get(userScope, collectionName, DEFAULT_TTL);
    if (cached) return cached;
    const items = await spy.fn();
    await store.save(userScope, collectionName, items);
    return items;
  }

  await Promise.all([
    naiveCacheFirstRead('user-1', 'materials'),
    naiveCacheFirstRead('user-1', 'materials'),
    naiveCacheFirstRead('user-1', 'materials'),
  ]);

  assert.equal(spy.getCallCount(), 3, 'CONFIRMED FINDING: without de-duplication, 3 concurrent calls on an empty cache cause 3 Firestore reads (a read storm)');
});

test('§5b FIX (actual shipped runCacheFirstRead): the SAME 3 concurrent calls on an empty cache now share ONE in-flight Firestore read', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const spy = createFirestoreSpy([{ id: 'x1' }], 10);

  const results = await Promise.all([
    runCacheFirstRead({ userScope: 'user-1', collectionName: 'materials', readFromSource: spy.fn, ...wireCache(store) }),
    runCacheFirstRead({ userScope: 'user-1', collectionName: 'materials', readFromSource: spy.fn, ...wireCache(store) }),
    runCacheFirstRead({ userScope: 'user-1', collectionName: 'materials', readFromSource: spy.fn, ...wireCache(store) }),
  ]);

  assert.equal(spy.getCallCount(), 1, 'FIXED: 3 concurrent calls on an empty cache must now share exactly 1 Firestore read');
  assert.deepEqual(results[0], [{ id: 'x1' }]);
  assert.deepEqual(results[1], results[0]);
  assert.deepEqual(results[2], results[0]);
});

test('§5c the in-flight dedupe never blocks a later, genuinely separate read once the first one has settled', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  let call = 0;
  const spy = async () => { call++; return [{ id: `v${call}` }]; };

  const first = await runCacheFirstRead({ userScope: 'user-1', collectionName: 'shifts', skipCache: true, readFromSource: spy, ...wireCache(store) });
  const second = await runCacheFirstRead({ userScope: 'user-1', collectionName: 'shifts', skipCache: true, readFromSource: spy, ...wireCache(store) });

  assert.equal(call, 2, 'two genuinely sequential skipCache reads must each hit the source - dedupe must not leak across settled calls');
  assert.notDeepEqual(first, second);
});

test('§5d concurrent calls for DIFFERENT collections are never coalesced into one read - dedupe is scoped per (userScope, collectionName)', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const spyA = createFirestoreSpy([{ id: 'a' }], 5);
  const spyB = createFirestoreSpy([{ id: 'b' }], 5);

  await Promise.all([
    runCacheFirstRead({ userScope: 'user-1', collectionName: 'presses', readFromSource: spyA.fn, ...wireCache(store) }),
    runCacheFirstRead({ userScope: 'user-1', collectionName: 'furnaces', readFromSource: spyB.fn, ...wireCache(store) }),
  ]);

  assert.equal(spyA.getCallCount(), 1);
  assert.equal(spyB.getCallCount(), 1);
});

// ==================================================
// §6 Corrupted cache test
// ==================================================
test('§6 CORRUPTED CACHE: malformed cached data never crashes the app, falls back to Firestore, and the valid result replaces the corrupt entry', async () => {
  const backend = createInMemoryBackend();
  const store = new LocalCacheStore(backend);
  await backend.put({
    key: 'user-1::furnaceCars',
    collectionName: 'furnaceCars',
    userScope: 'user-1',
    schemaVersion: CACHE_SCHEMA_VERSION,
    savedAt: Date.now(),
    data: 'this is not an array' as any,
  });

  const validResult = [{ id: 'fc1', carNumber: '12' }];
  const spy = createFirestoreSpy(validResult);
  const result = await runCacheFirstRead({ userScope: 'user-1', collectionName: 'furnaceCars', readFromSource: spy.fn, ...wireCache(store) });

  assert.equal(spy.getCallCount(), 1, 'a corrupted entry must be treated as a miss, triggering exactly one Firestore fallback read');
  assert.deepEqual(result, validResult);
  assert.deepEqual(await store.get('user-1', 'furnaceCars', DEFAULT_TTL), validResult, 'the corrupt entry must now be replaced by the valid result');
});

// ==================================================
// §7 Cache backend failure test
// ==================================================
test('§7 CACHE BACKEND FAILURE: a fully unavailable backend (null) never breaks Firestore access - behaves as a permanent miss, Firestore path works normally', async () => {
  const store = new LocalCacheStore(null); // simulates IndexedDB unavailable
  const firestoreResult = [{ id: 'e1' }];
  const spy = createFirestoreSpy(firestoreResult);

  const result = await runCacheFirstRead({ userScope: 'user-1', collectionName: 'employees', readFromSource: spy.fn, ...wireCache(store) });

  assert.equal(spy.getCallCount(), 1);
  assert.deepEqual(result, firestoreResult);

  // A second call must ALSO go to Firestore (the backend can never retain anything), never throw, never hang.
  const result2 = await runCacheFirstRead({ userScope: 'user-1', collectionName: 'employees', readFromSource: spy.fn, ...wireCache(store) });
  assert.equal(spy.getCallCount(), 2);
  assert.deepEqual(result2, firestoreResult);
});

// ==================================================
// §8/§9/§10 Successful CREATE/UPDATE/DELETE cache behavior
// (masterDataService.ts's real create/update/toggle/delete functions are
// tightly coupled to the real Firebase SDK - by this project's established
// convention there is no mocking framework to intercept `addDoc`/
// `updateDoc`/`deleteDoc` without touching real Firestore. These tests
// instead verify the CONTRACT those functions rely on: invalidate() is
// only ever reachable AFTER a successful write in the real source
// (confirmed by direct code reading in the Phase 1.1 report - every
// `await invalidateCachedCollection(...)` call in masterDataService.ts
// sits strictly after its corresponding `await safeAddDoc/safeUpdateDoc/
// updateDoc/deleteDoc` inside the same try block, so a thrown/rejected
// write jumps straight to `catch` and never reaches invalidate at all),
// and that invalidate() itself behaves correctly in isolation.
// ==================================================
test('§8 CREATE contract: invalidate() must never be reachable before a write "succeeds" - simulated by a try/catch mirroring masterDataService.createMasterDataItem\'s exact structure', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-1', 'presses', [{ id: 'p1' }]);

  async function simulateCreate(writeSucceeds: boolean) {
    try {
      if (!writeSucceeds) throw new Error('simulated Firestore write failure');
      // ^ mirrors `await safeAddDoc(...)` - only reached on success:
      await store.invalidate('user-1', 'presses');
      return 'created';
    } catch {
      return 'failed';
    }
  }

  const failedOutcome = await simulateCreate(false);
  assert.equal(failedOutcome, 'failed');
  assert.deepEqual(await store.get('user-1', 'presses', DEFAULT_TTL), [{ id: 'p1' }], 'a FAILED write must leave the existing cache completely untouched - no false "it was persisted" state');

  const successOutcome = await simulateCreate(true);
  assert.equal(successOutcome, 'created');
  assert.equal(await store.get('user-1', 'presses', DEFAULT_TTL), null, 'a SUCCESSFUL write must invalidate the cache so the next read gets the real, fresh Firestore state');
});

test('§9 UPDATE/toggleMasterDataActive contract: same invalidate-only-after-success guarantee', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-1', 'furnaces', [{ id: 'f1', name: 'old' }]);

  async function simulateUpdate(writeSucceeds: boolean) {
    try {
      if (!writeSucceeds) throw new Error('simulated Firestore update failure');
      await store.invalidate('user-1', 'furnaces');
    } catch {
      // swallowed, mirrors handleFirestoreError re-throwing to the caller - cache state is what we're checking here
    }
  }

  await simulateUpdate(false);
  assert.notEqual(await store.get('user-1', 'furnaces', DEFAULT_TTL), null, 'failed update must not invalidate - stale-but-accurate cache remains');

  await simulateUpdate(true);
  assert.equal(await store.get('user-1', 'furnaces', DEFAULT_TTL), null);
});

test('§10 DELETE contract: same invalidate-only-after-success guarantee - a failed delete must never make the item appear removed from the authoritative cache', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-1', 'customers', [{ id: 'c1' }, { id: 'c2' }]);

  async function simulateDelete(writeSucceeds: boolean) {
    try {
      if (!writeSucceeds) throw new Error('simulated Firestore delete failure');
      await store.invalidate('user-1', 'customers');
    } catch { /* mirrors handleFirestoreError */ }
  }

  await simulateDelete(false);
  assert.deepEqual(await store.get('user-1', 'customers', DEFAULT_TTL), [{ id: 'c1' }, { id: 'c2' }], 'a failed delete must leave the cache exactly as it was - never falsely drop the record');

  await simulateDelete(true);
  assert.equal(await store.get('user-1', 'customers', DEFAULT_TTL), null);
});

// ==================================================
// §13 User isolation
// ==================================================
test('§13 USER ISOLATION: User B never receives User A\'s cached data, even for the same collection name', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-A', 'departments', [{ id: 'a-dept-1' }]);
  assert.equal(await store.get('user-B', 'departments', DEFAULT_TTL), null, 'User B must get a clean miss, never User A\'s data');

  await store.save('user-B', 'departments', [{ id: 'b-dept-1' }]);
  const aData = await store.get('user-A', 'departments', DEFAULT_TTL);
  const bData = await store.get('user-B', 'departments', DEFAULT_TTL);
  assert.deepEqual(aData, [{ id: 'a-dept-1' }]);
  assert.deepEqual(bData, [{ id: 'b-dept-1' }]);
  assert.notDeepEqual(aData, bData);
});

test('§13b logout (clearForUser) removes only the signing-out user\'s entries, confirmed again at the runCacheFirstRead level', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-A', 'departments', [{ id: 'a1' }]);
  await store.save('user-B', 'departments', [{ id: 'b1' }]);
  await store.clearForUser('user-A');

  const spyA = createFirestoreSpy([{ id: 'a1-fresh' }]);
  const resultA = await runCacheFirstRead({ userScope: 'user-A', collectionName: 'departments', readFromSource: spyA.fn, ...wireCache(store) });
  assert.equal(spyA.getCallCount(), 1, 'user-A must be a clean miss after logout, requiring a fresh Firestore read');
  assert.deepEqual(resultA, [{ id: 'a1-fresh' }]);

  const spyB = createFirestoreSpy([{ id: 'SHOULD-NOT-BE-CALLED' }]);
  const resultB = await runCacheFirstRead({ userScope: 'user-B', collectionName: 'departments', readFromSource: spyB.fn, ...wireCache(store) });
  assert.equal(spyB.getCallCount(), 0, 'user-B\'s cache must be completely unaffected by user-A\'s logout');
  assert.deepEqual(resultB, [{ id: 'b1' }]);
});

// ==================================================
// §14 Cache versioning
// ==================================================
test('§14 CACHE VERSIONING: an old-schema entry never crashes or is returned as valid data - safe invalidation, clean Firestore fallback', async () => {
  const backend = createInMemoryBackend();
  const store = new LocalCacheStore(backend);
  await backend.put({
    key: 'user-1::departments',
    collectionName: 'departments',
    userScope: 'user-1',
    schemaVersion: CACHE_SCHEMA_VERSION - 1,
    savedAt: Date.now(),
    data: [{ id: 'old-shape-record' }],
  });

  const freshResult = [{ id: 'new-shape-record' }];
  const spy = createFirestoreSpy(freshResult);
  const result = await runCacheFirstRead({ userScope: 'user-1', collectionName: 'departments', readFromSource: spy.fn, ...wireCache(store) });

  assert.equal(spy.getCallCount(), 1);
  assert.deepEqual(result, freshResult, 'an old-schema entry must never be handed back as if it were valid current-shape data');
});

// ==================================================
// §15 Read count model - deterministic comparison
// ==================================================
test('§15 READ COUNT MODEL: WITHOUT cache (skipCache=true) every call reads Firestore; WITH a valid cache, only the first of N calls does', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());

  const withoutCacheSpy = createFirestoreSpy([{ id: 'x' }]);
  for (let i = 0; i < 5; i++) {
    await runCacheFirstRead({ userScope: 'user-1', collectionName: 'shifts', skipCache: true, readFromSource: withoutCacheSpy.fn, ...wireCache(store) });
  }
  assert.equal(withoutCacheSpy.getCallCount(), 5, 'WITHOUT CACHE: 5 calls -> 5 Firestore reads (matches the pre-Phase-1 baseline behavior exactly)');

  const withCacheStore = new LocalCacheStore(createInMemoryBackend());
  const withCacheSpy = createFirestoreSpy([{ id: 'y' }]);
  for (let i = 0; i < 5; i++) {
    await runCacheFirstRead({ userScope: 'user-1', collectionName: 'shifts', readFromSource: withCacheSpy.fn, ...wireCache(withCacheStore) });
  }
  assert.equal(withCacheSpy.getCallCount(), 1, 'WITH VALID CACHE: 5 calls -> 1 Firestore read (the initial population) + 4 cache reads');
});

(async () => {
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
})();

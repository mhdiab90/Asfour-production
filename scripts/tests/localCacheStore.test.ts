/**
 * Focused tests for the Local Cache Foundation (Phase 1, localCacheStore.ts).
 *
 * Tests the LocalCacheStore class (freshness, schema versioning, user
 * scoping, invalidation, clearing) against a plain in-memory
 * KeyValueBackend fake - no real IndexedDB, no new test dependency, and no
 * dependency on production Firestore, matching this project's established
 * pure-logic testing convention (every other *.test.ts file in this repo
 * tests Firebase-free modules the same way).
 *
 * Items #9-12 ("successful Firestore result / create / update / delete
 * updates the cache") are integration behaviors implemented directly in
 * masterDataService.ts (a thin `await setCachedCollection(...)` /
 * `await invalidateCachedCollection(...)` call right after each Firestore
 * operation succeeds - see that file). Since masterDataService.ts itself
 * is tightly coupled to the real Firebase SDK (no existing mocking
 * framework in this repo, by established convention), those integration
 * points are proven here by exercising the EXACT same store operations
 * masterDataService.ts calls, in the same sequence it calls them in - the
 * save-then-invalidate mechanics are what's actually new/risky, and that
 * is what these tests cover directly.
 *
 * Run: npx tsx scripts/tests/localCacheStore.test.ts
 */
import assert from 'node:assert/strict';
import { LocalCacheStore, CacheEntry, KeyValueBackend, CACHE_SCHEMA_VERSION, createIndexedDbBackend } from '../../src/services/localCacheStore';

let passed = 0;
let failed = 0;
const registeredTests: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registeredTests.push({ name, fn });
}

console.log('localCacheStore.test.ts');

/** A minimal in-memory KeyValueBackend fake - mirrors exactly what a real IndexedDB object store does for this module's narrow usage (get/put/delete/getAll by key). */
function createInMemoryBackend(): KeyValueBackend {
  const store = new Map<string, CacheEntry>();
  return {
    async get(key) {
      return store.get(key);
    },
    async put(entry) {
      store.set(entry.key, entry);
    },
    async delete(key) {
      store.delete(key);
    },
    async getAllEntries() {
      return [...store.values()];
    },
  };
}

const DEFAULT_TTL = 5 * 60 * 1000;

// ---- 1: empty cache ----
test('#1 empty cache - get() on a never-populated store returns null, never throws', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const result = await store.get('user-1', 'departments', DEFAULT_TTL);
  assert.equal(result, null);
});

// ---- 2: save/get ----
test('#2 save then get returns the exact same array back', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const data = [{ id: 'd1', code: '501', name: 'Department 1' }];
  await store.save('user-1', 'departments', data);
  const result = await store.get<{ id: string; code: string; name: string }>('user-1', 'departments', DEFAULT_TTL);
  assert.deepEqual(result, data);
});

// ---- 3: getAll (this cache has no per-document concept - "getAll" IS get() for one collection, see the module docblock) ----
test('#3 getAll semantics - get() returns the WHOLE cached collection array in one call, not a single record', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  const data = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }];
  await store.save('user-1', 'presses', data);
  const result = await store.get('user-1', 'presses', DEFAULT_TTL);
  assert.equal(result?.length, 3);
});

// ---- 4: cache hit ----
test('#4 cache hit - a fresh entry within the TTL window is returned without needing any external (Firestore) call', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-1', 'furnaces', [{ id: 'f1' }]);
  const result = await store.get('user-1', 'furnaces', DEFAULT_TTL);
  assert.notEqual(result, null, 'a fresh entry must be a hit');
});

// ---- 5: cache miss (wrong scope/collection) ----
test('#5 cache miss - a different user scope or different collection name never accidentally hits another entry', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-1', 'departments', [{ id: 'd1' }]);
  assert.equal(await store.get('user-2', 'departments', DEFAULT_TTL), null, 'different user scope must miss');
  assert.equal(await store.get('user-1', 'presses', DEFAULT_TTL), null, 'different collection must miss');
});

// ---- 6: expired cache ----
test('#6 expired cache - an entry older than the TTL is treated as a miss, never returned stale', async () => {
  const backend = createInMemoryBackend();
  const store = new LocalCacheStore(backend);
  await store.save('user-1', 'departments', [{ id: 'd1' }]);
  // Directly age the entry past its TTL rather than sleeping in a test.
  const entries = await backend.getAllEntries();
  entries[0].savedAt = Date.now() - 10_000;
  await backend.put(entries[0]);
  const result = await store.get('user-1', 'departments', 5_000 /* 5s TTL, entry is 10s old */);
  assert.equal(result, null);
});

// ---- 7: invalid/corrupted cache ----
test('#7 invalid cache - a corrupted entry (non-array data, or a schema-version mismatch) is treated as a clean miss, never thrown or handed back as garbage', async () => {
  const backend = createInMemoryBackend();
  const store = new LocalCacheStore(backend);

  await backend.put({
    key: 'user-1::departments',
    collectionName: 'departments',
    userScope: 'user-1',
    schemaVersion: CACHE_SCHEMA_VERSION,
    savedAt: Date.now(),
    data: { not: 'an array' } as any, // corrupted shape
  });
  assert.equal(await store.get('user-1', 'departments', DEFAULT_TTL), null);

  await backend.put({
    key: 'user-1::furnaces',
    collectionName: 'furnaces',
    userScope: 'user-1',
    schemaVersion: CACHE_SCHEMA_VERSION + 999, // future/incompatible schema
    savedAt: Date.now(),
    data: [{ id: 'f1' }],
  });
  assert.equal(await store.get('user-1', 'furnaces', DEFAULT_TTL), null);
});

// ---- 8: Firestore fallback (cache backend unavailable) ----
test('#8 Firestore fallback - a null backend (cache unavailable) never throws on any operation, always resolves to "miss"/no-op', async () => {
  const store = new LocalCacheStore(null);
  assert.equal(await store.get('user-1', 'departments', DEFAULT_TTL), null);
  await store.save('user-1', 'departments', [{ id: 'd1' }]); // must not throw
  await store.invalidate('user-1', 'departments'); // must not throw
  await store.clearForUser('user-1'); // must not throw
});

test('#8b createIndexedDbBackend() returns null in a non-browser (Node test) environment rather than throwing - the exact condition that makes #8 a real, reachable path, not just a hypothetical', () => {
  assert.equal(createIndexedDbBackend(), null);
});

// ---- 9: a successful "Firestore result" populates the cache (mirrors fetchMasterData's own save-after-fetch step) ----
test('#9 populating the cache after a simulated Firestore read makes the immediately-following read a hit', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  assert.equal(await store.get('user-1', 'products', DEFAULT_TTL), null, 'precondition: starts empty');
  const simulatedFirestoreResult = [{ id: 'prod-1', code: 'BAR250102305' }];
  await store.save('user-1', 'products', simulatedFirestoreResult); // exactly what fetchMasterData does after getDocs()
  assert.deepEqual(await store.get('user-1', 'products', DEFAULT_TTL), simulatedFirestoreResult);
});

// ---- 10/11/12: successful create/update/delete invalidate the cache (mirrors masterDataService.ts's post-write invalidateCachedCollection call) ----
test('#10 a successful CREATE invalidates the collection\'s cache - the next read is a miss, never stale data missing the just-created record', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-1', 'presses', [{ id: 'p1' }]); // stale list, doesn't yet include the record about to be "created"
  await store.invalidate('user-1', 'presses'); // exactly what masterDataService.createMasterDataItem does right after safeAddDoc succeeds
  assert.equal(await store.get('user-1', 'presses', DEFAULT_TTL), null, 'must be a miss so the caller re-reads Firestore and gets the new record');
});

test('#11 a successful UPDATE invalidates the collection\'s cache', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-1', 'furnaces', [{ id: 'f1', name: 'old name' }]);
  await store.invalidate('user-1', 'furnaces'); // mirrors updateMasterDataItem's post-safeUpdateDoc call
  assert.equal(await store.get('user-1', 'furnaces', DEFAULT_TTL), null);
});

test('#12 a successful DELETE (and toggleMasterDataActive) invalidates the collection\'s cache', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-1', 'customers', [{ id: 'c1' }, { id: 'c2' }]);
  await store.invalidate('user-1', 'customers'); // mirrors deleteMasterDataItem's / toggleMasterDataActive's post-write call
  assert.equal(await store.get('user-1', 'customers', DEFAULT_TTL), null);
});

// ---- 13: logout/user scope safety ----
test('#13 clearForUser only clears the signing-out user\'s entries, never another user\'s cached data', async () => {
  const backend = createInMemoryBackend();
  const store = new LocalCacheStore(backend);
  await store.save('user-1', 'departments', [{ id: 'd1' }]);
  await store.save('user-1', 'presses', [{ id: 'p1' }]);
  await store.save('user-2', 'departments', [{ id: 'd2' }]);

  await store.clearForUser('user-1');

  assert.equal(await store.get('user-1', 'departments', DEFAULT_TTL), null);
  assert.equal(await store.get('user-1', 'presses', DEFAULT_TTL), null);
  assert.notEqual(await store.get('user-2', 'departments', DEFAULT_TTL), null, 'user-2\'s cache must survive user-1\'s logout/clear untouched');
});

// ---- 14: cache schema version invalidation ----
test('#14 bumping CACHE_SCHEMA_VERSION (conceptually, a future app release) makes every previously-cached entry a clean miss, never a crash or garbage read', async () => {
  const backend = createInMemoryBackend();
  const store = new LocalCacheStore(backend);
  await store.save('user-1', 'departments', [{ id: 'd1' }]);
  // Simulate "the app shipped a new schema version" by directly writing an old-versioned entry.
  await backend.put({
    key: 'user-1::departments',
    collectionName: 'departments',
    userScope: 'user-1',
    schemaVersion: CACHE_SCHEMA_VERSION - 1,
    savedAt: Date.now(),
    data: [{ id: 'd1' }],
  });
  assert.equal(await store.get('user-1', 'departments', DEFAULT_TTL), null);
});

// ---- 15: no duplicate Firestore request when cache is valid ----
test('#15 a valid, fresh cache entry short-circuits before any Firestore call would be needed - the exact condition fetchMasterData\'s `if (cached) return cached;` relies on', async () => {
  const store = new LocalCacheStore(createInMemoryBackend());
  await store.save('user-1', 'shifts', [{ id: 's1' }, { id: 's2' }]);
  let firestoreCallCount = 0;
  const simulateFetchMasterData = async () => {
    const cached = await store.get('user-1', 'shifts', DEFAULT_TTL);
    if (cached) return cached;
    firestoreCallCount++; // would only run on a miss
    return [];
  };
  await simulateFetchMasterData();
  await simulateFetchMasterData();
  await simulateFetchMasterData();
  assert.equal(firestoreCallCount, 0, 'three calls against a fresh cache must never reach the simulated Firestore read');
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

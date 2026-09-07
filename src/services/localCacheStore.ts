/**
 * ASFOUR ERP - Local Cache Foundation (Phase 1: infrastructure only).
 *
 * A generic, collection-agnostic cache sitting BELOW the existing
 * repository layer (masterDataService.ts) and ABOVE Firestore. Firestore
 * remains the sole authoritative source - every function here either
 * returns already-cached data or misses cleanly, NEVER blocks or replaces
 * a Firestore call, and NEVER throws: a corrupted/unavailable cache
 * backend is always treated as a cache miss, so the caller falls through
 * to Firestore exactly as it did before this cache existed.
 *
 * DESIGN: keyed by (userScope, collectionName) -> one entry holding the
 * WHOLE collection array, matching the actual read pattern this app uses
 * today (masterDataService.ts's fetchMasterData/subscribeMasterData always
 * read/receive a full collection snapshot, never a single document) -
 * there is no per-document cache here because nothing in the current
 * Master Data read path does a per-document `getDoc`.
 *
 * BACKEND ABSTRACTION: the actual storage (IndexedDB in the browser) is
 * injected via the KeyValueBackend interface, so the higher-level cache
 * logic (freshness, schema versioning, user-scoping, clearing) is fully
 * unit-testable with a plain in-memory fake - zero new test dependencies,
 * no real IndexedDB needed in the test run. See
 * scripts/tests/localCacheStore.test.ts.
 *
 * API MAPPING to the requested "save / get / getAll / delete / clear /
 * invalidate": this cache has no separate per-document concept (see DESIGN
 * above), so `get` doubles as "getAll" for one collection, and `invalidate`
 * doubles as "delete" for one collection's cached entry - `clearForUser`/
 * `clearAll` are the broader clears (logout, schema-version hard reset).
 */

export interface CacheEntry<T = unknown> {
  key: string;
  collectionName: string;
  userScope: string;
  schemaVersion: number;
  savedAt: number;
  data: T;
}

/**
 * Minimal key-value contract the cache logic needs - satisfied by
 * IndexedDB in the browser, or an in-memory Map in tests. Every method
 * must resolve, never reject: a backend failure is always treated as
 * "cache unavailable", never surfaced as an error to callers.
 */
export interface KeyValueBackend {
  get(key: string): Promise<CacheEntry | undefined>;
  put(entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  getAllEntries(): Promise<CacheEntry[]>;
}

/** Bump this to invalidate every previously-cached entry app-wide (e.g. after changing what fields a cached record shape carries). Existing entries with a different version are treated as a clean miss, never as corrupted data to repair. */
export const CACHE_SCHEMA_VERSION = 1;

function buildKey(userScope: string, collectionName: string): string {
  return `${userScope || 'anonymous'}::${collectionName}`;
}

export class LocalCacheStore {
  constructor(private backend: KeyValueBackend | null) {}

  private scope(userScope: string): string {
    return userScope || 'anonymous';
  }

  /** Returns the cached collection array, or null on any miss/expiry/corruption/unavailable-backend/schema-mismatch - NEVER throws. */
  async get<T>(userScope: string, collectionName: string, ttlMs: number): Promise<T[] | null> {
    if (!this.backend) return null;
    try {
      const entry = await this.backend.get(buildKey(this.scope(userScope), collectionName));
      if (!entry) return null;
      if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) return null;
      if (Date.now() - entry.savedAt >= ttlMs) return null;
      if (!Array.isArray(entry.data)) return null; // corrupted shape - never hand back garbage
      return entry.data as T[];
    } catch {
      return null;
    }
  }

  /** Saves/overwrites the whole collection array. Never throws - a save failure just means the next read is a cache miss, exactly as if nothing had been cached. */
  async save<T>(userScope: string, collectionName: string, data: T[]): Promise<void> {
    if (!this.backend) return;
    try {
      const entry: CacheEntry<T[]> = {
        key: buildKey(this.scope(userScope), collectionName),
        collectionName,
        userScope: this.scope(userScope),
        schemaVersion: CACHE_SCHEMA_VERSION,
        savedAt: Date.now(),
        data,
      };
      await this.backend.put(entry);
    } catch {
      // Swallowed intentionally - see the module docblock.
    }
  }

  async invalidate(userScope: string, collectionName: string): Promise<void> {
    if (!this.backend) return;
    try {
      await this.backend.delete(buildKey(this.scope(userScope), collectionName));
    } catch {
      // Swallowed intentionally.
    }
  }

  /** Clears every cache entry belonging to one user scope (e.g. on logout) - never touches another user's entries. */
  async clearForUser(userScope: string): Promise<void> {
    if (!this.backend) return;
    try {
      const scope = this.scope(userScope);
      const entries = await this.backend.getAllEntries();
      for (const entry of entries) {
        if (entry.userScope === scope) {
          await this.backend.delete(entry.key);
        }
      }
    } catch {
      // Swallowed intentionally.
    }
  }

  /** Clears EVERY cache entry regardless of user - reserved for a future hard-reset path, never called from normal application flow in this phase. */
  async clearAll(): Promise<void> {
    if (!this.backend) return;
    try {
      const entries = await this.backend.getAllEntries();
      for (const entry of entries) {
        await this.backend.delete(entry.key);
      }
    } catch {
      // Swallowed intentionally.
    }
  }
}

// ==================================================
// Real IndexedDB-backed KeyValueBackend (browser only)
// ==================================================

const DB_NAME = 'asfour_local_cache';
const DB_VERSION = 1;
const OBJECT_STORE_NAME = 'masterDataCollections';

/**
 * Creates the real IndexedDB-backed KeyValueBackend, or null if IndexedDB
 * is unavailable (some private-browsing modes, very old browsers, SSR, or
 * a Node test environment) - callers must treat null exactly like "cache
 * unavailable" and fall through to Firestore, never crash.
 */
export function createIndexedDbBackend(): KeyValueBackend | null {
  if (typeof indexedDB === 'undefined') return null;

  let dbPromise: Promise<IDBDatabase | null> | null = null;
  function openDb(): Promise<IDBDatabase | null> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const idb = request.result;
          if (!idb.objectStoreNames.contains(OBJECT_STORE_NAME)) {
            idb.createObjectStore(OBJECT_STORE_NAME, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }

  return {
    async get(key) {
      const db = await openDb();
      if (!db) return undefined;
      return new Promise((resolve) => {
        try {
          const req = db.transaction(OBJECT_STORE_NAME, 'readonly').objectStore(OBJECT_STORE_NAME).get(key);
          req.onsuccess = () => resolve(req.result as CacheEntry | undefined);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      });
    },
    async put(entry) {
      const db = await openDb();
      if (!db) return;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
          tx.objectStore(OBJECT_STORE_NAME).put(entry);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    },
    async delete(key) {
      const db = await openDb();
      if (!db) return;
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(OBJECT_STORE_NAME, 'readwrite');
          tx.objectStore(OBJECT_STORE_NAME).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
    },
    async getAllEntries() {
      const db = await openDb();
      if (!db) return [];
      return new Promise((resolve) => {
        try {
          const req = db.transaction(OBJECT_STORE_NAME, 'readonly').objectStore(OBJECT_STORE_NAME).getAll();
          req.onsuccess = () => resolve((req.result as CacheEntry[]) || []);
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
    },
  };
}

// ==================================================
// Module-level singleton - what masterDataService.ts actually imports
// ==================================================

let singleton: LocalCacheStore | null = null;
function getSingleton(): LocalCacheStore {
  if (!singleton) singleton = new LocalCacheStore(createIndexedDbBackend());
  return singleton;
}

/** Master Data is "relatively stable" (Phase 1 spec) - 5 minutes balances a real read reduction against staleness risk. Any successful write elsewhere still invalidates immediately, regardless of this window. */
export const MASTER_DATA_CACHE_TTL_MS = 5 * 60 * 1000;

export async function getCachedCollection<T>(
  userScope: string,
  collectionName: string,
  ttlMs: number = MASTER_DATA_CACHE_TTL_MS
): Promise<T[] | null> {
  return getSingleton().get<T>(userScope, collectionName, ttlMs);
}

export async function setCachedCollection<T>(userScope: string, collectionName: string, data: T[]): Promise<void> {
  return getSingleton().save(userScope, collectionName, data);
}

export async function invalidateCachedCollection(userScope: string, collectionName: string): Promise<void> {
  return getSingleton().invalidate(userScope, collectionName);
}

/** Called on logout (AuthContext.tsx) - clears only the signing-out user's cached Master Data, never another user's. */
export async function clearLocalCacheForUser(userScope: string): Promise<void> {
  return getSingleton().clearForUser(userScope);
}

// ==================================================
// Phase 1.1 - cache-first read orchestration, extracted for verification
// ==================================================

export interface CacheFirstReadDeps<T> {
  userScope: string;
  collectionName: string;
  /** Mirrors fetchMasterData's own `skipCache` option verbatim. */
  skipCache?: boolean;
  ttlMs?: number;
  /** The actual Firestore read (or any other source-of-truth read) - injected so this orchestration is testable with a spy/fake, never touching real Firestore in a test. */
  readFromSource: () => Promise<T[]>;
  /**
   * Injectable cache read/write - default to the real singleton-backed
   * cache (getCachedCollection/setCachedCollection), which is what
   * masterDataService.ts's production call always gets by omitting these.
   * Tests inject a LocalCacheStore instance backed by an in-memory fake so
   * cache hit/miss/corruption scenarios are fully controllable without a
   * real browser IndexedDB (unavailable in the Node test environment,
   * which would otherwise make every cache operation an automatic miss -
   * itself a valid, separately-tested "cache backend unavailable" case,
   * but not usable to verify a HIT).
   */
  cacheGet?: (userScope: string, collectionName: string, ttlMs: number) => Promise<T[] | null>;
  cacheSet?: (userScope: string, collectionName: string, data: T[]) => Promise<void>;
}

/**
 * PHASE 1.1 - the exact cache-then-source sequence `fetchMasterData`
 * performs (check cache -> return on hit -> else call the source -> save
 * result -> return), extracted into an independently callable, fully
 * injectable pure function so it can be verified with a fake
 * `readFromSource` (a call-counting spy) instead of ever touching real
 * Firestore in a test. `masterDataService.ts`'s `fetchMasterData` calls
 * this directly with the real cache functions and a closure wrapping
 * `getDocs` - this is a pure extraction of already-existing logic, not a
 * behavior change (verified by the full existing Phase 1 test suite still
 * passing unchanged after this refactor).
 *
 * CONCURRENCY: multiple simultaneous calls for the SAME (userScope,
 * collectionName) while the cache is empty/expired share ONE in-flight
 * `readFromSource()` call rather than each firing their own - this is the
 * Phase 1.1 fix for the read-storm found during verification (see the
 * Phase 1.1 report). The dedupe key intentionally ignores `ttlMs` (every
 * concurrent caller for the same collection gets the same freshly-read
 * result regardless of the exact ttlMs each happened to pass) and is
 * cleared the instant the in-flight read settles (success OR failure), so
 * it never causes a later, genuinely separate read to be skipped.
 */
const inFlightReads = new Map<string, Promise<unknown>>();

export async function runCacheFirstRead<T>(deps: CacheFirstReadDeps<T>): Promise<T[]> {
  const { userScope, collectionName, skipCache, ttlMs = MASTER_DATA_CACHE_TTL_MS, readFromSource } = deps;
  // Explicitly instantiated with THIS call's own T (rather than relying on
  // default-parameter type inference against the standalone generic
  // getCachedCollection/setCachedCollection references, which TypeScript
  // cannot always unify cleanly with the interface's own T).
  const cacheGet = deps.cacheGet ?? ((us: string, cn: string, ttl: number) => getCachedCollection<T>(us, cn, ttl));
  const cacheSet = deps.cacheSet ?? ((us: string, cn: string, data: T[]) => setCachedCollection<T>(us, cn, data));

  if (!skipCache) {
    const cached = await cacheGet(userScope, collectionName, ttlMs);
    if (cached) return cached;
  }

  const dedupeKey = `${userScope || 'anonymous'}::${collectionName}`;
  const existingInFlight = inFlightReads.get(dedupeKey) as Promise<T[]> | undefined;
  if (existingInFlight) return existingInFlight;

  const readPromise = (async () => {
    const items = await readFromSource();
    await cacheSet(userScope, collectionName, items);
    return items;
  })();

  inFlightReads.set(dedupeKey, readPromise);
  try {
    return await readPromise;
  } finally {
    // Only clear if we are still the tracked promise for this key - a
    // brand-new read that started after this one already settled must
    // never have its own in-flight entry wiped out from under it.
    if (inFlightReads.get(dedupeKey) === readPromise) {
      inFlightReads.delete(dedupeKey);
    }
  }
}

/**
 * Master Data Service
 * Manages CRUD operations and real-time synchronization for all 8 Master Data entities:
 * Employees, Departments, Presses, Furnaces, FurnaceCars, Products, Customers, Shifts
 */
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  onSnapshot, 
  serverTimestamp,
  getDocsFromServer,
  limit,
  orderBy,
  startAfter,
  documentId,
  getCountFromServer
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../config/firebase';
import { safeAddDoc, safeUpdateDoc } from '../utils/firestoreSanitizer';
import { setCachedCollection, invalidateCachedCollection, runCacheFirstRead } from './localCacheStore';
import { 
  Employee, 
  Department, 
  Press, 
  Furnace, 
  FurnaceCar, 
  Product, 
  ProductType,
  Customer, 
  Shift, 
  MasterDataTab 
} from '../types';
import { logAuditAction } from './auditService';
import { parseProductCode, normalizeProductCode } from '../utils/productCodeParser';
import { enrichWithNormalizedFields } from '../utils/searchUtils';
import { getCachedProductTypes } from './productTypeService';
import { mergeRowsById, searchTermVariants, isTruncated } from './masterDataBrowsePure';

export const MASTER_DATA_COLLECTIONS: Record<MasterDataTab, string> = {
  products: 'products',
  productTypes: 'productTypes',
  employees: 'employees',
  departments: 'departments',
  presses: 'presses',
  furnaces: 'furnaces',
  furnaceCars: 'furnaceCars',
  // Reuses the existing 'chineseMills' Firestore collection (previously
  // unregistered, populated only via Historical Import - see
  // chineseMillsHistoricalImportService.ts's CHINESE_MILLS_MASTER_COLLECTION)
  // rather than a new collection name, so existing mill master records are
  // never orphaned by giving them a proper Master Data tab.
  mills: 'chineseMills',
  // Existing collections, populated until now only by the Tube/Ball Mills
  // Historical Import (TUBE_BALL_MILL_MASTER_COLLECTION / BUNKER_COLLECTION) -
  // the same names, so no record is orphaned by giving them a Master Data tab.
  tubeBallMills: 'tubeBallMills',
  bunkers: 'bunkers',
  // Rotary Kiln equipment master (Phase 1 Step 1D) - a new collection.
  rotaryKilns: 'rotaryKilns',
  // ASFOUR Job References and Batches (Phase 1 Step 1E) - new collections;
  // document id = ASFOUR identity, business reference stored as a field.
  jobReferences: 'jobReferences',
  batches: 'batches',
  // Bills of Materials (Phase 1 Step 2). Their versions are 'bomVersions'
  // (bomPure.BOM_VERSION_COLLECTION), written through the same services.
  boms: 'boms',
  // Routings (Phase 1 Step 3). Their versions are 'routingVersions'
  // (routingPure.ROUTING_VERSION_COLLECTION), written through the same services.
  routings: 'routings',
  customers: 'customers',
  shifts: 'shifts',
  materials: 'materials',
  // The imported hierarchy - registered so the SAME cache-first read and live
  // subscription serve it, rather than it needing a bespoke reader in the UI.
  costCenterHierarchy: 'costCenterHierarchy',
  machines: 'machines',
  stages: 'stages',
  // Its own collection - see financialAccountsPure.ts for why nothing existed
  // to reuse. Deliberately NOT 'departments', which holds departments.
  financialAccounts: 'financialAccounts',
};

/** Scopes the local cache to the signed-in user (Phase 1 Local Cache Foundation) - mirrors the existing per-user localStorage-key convention already used by the Historical Import draft services (e.g. tubeBallMillsDraftPure.ts's storageKey), just keyed by uid here since that is already read via `auth` elsewhere in this codebase (e.g. auditService.ts). Never a new tenant/permission concept. */
function currentCacheUserScope(): string {
  return auth.currentUser?.uid || 'anonymous';
}

// Check if a code already exists in the collection to prevent duplicates
export async function checkCodeDuplicate(
  collectionName: string, 
  code: string, 
  excludeId?: string
): Promise<boolean> {
  try {
    const q = query(collection(db, collectionName), where('code', '==', code.trim()));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return false;
    
    if (excludeId) {
      return snapshot.docs.some(d => d.id !== excludeId);
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, collectionName);
  }
}

/**
 * Generic Fetch All - CACHE-FIRST (Phase 1 Local Cache Foundation).
 *
 * Checks the local IndexedDB-backed cache first; on a fresh hit, returns
 * immediately with ZERO Firestore reads. On a miss (empty, expired,
 * schema-version bump, or cache genuinely unavailable in this browser),
 * behaves EXACTLY as before: reads Firestore and returns the result - the
 * only addition is writing that result into the cache afterward so the
 * next call within the freshness window is a hit. If the cache backend is
 * unavailable or corrupted, getCachedCollection resolves null (never
 * throws), so this function's behavior and error handling toward the
 * caller are unchanged from before this cache existed.
 *
 * `skipCache` lets a caller force a fresh Firestore read when it genuinely
 * needs the latest data before the freshness window would normally expire
 * (e.g. immediately after a write it just made elsewhere) - optional and
 * defaults to using the cache, so no existing call site's behavior changes
 * unless it opts in.
 *
 * The actual cache-then-source sequence is delegated to
 * runCacheFirstRead (localCacheStore.ts) - a pure extraction of this same
 * logic, kept separate so it can be verified with a fake Firestore reader
 * in tests (see scripts/tests/masterDataCacheVerification.test.ts) without
 * this function's own behavior changing at all. runCacheFirstRead also
 * de-duplicates concurrent calls for the same collection while the cache
 * is empty/expired, so `Promise.all([fetchMasterData(...), ...])` for the
 * same collection never causes a Firestore read storm.
 */
export async function fetchMasterData<T extends { id?: string; code?: string }>(
  collectionName: string,
  options?: { skipCache?: boolean }
): Promise<T[]> {
  try {
    return await runCacheFirstRead<T>({
      userScope: currentCacheUserScope(),
      collectionName,
      skipCache: options?.skipCache,
      readFromSource: async () => {
        const snapshot = await getDocs(collection(db, collectionName));
        return snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as T[];
      },
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, collectionName);
  }
}

/**
 * Real-time listener - UNCHANGED live behavior (still always subscribes,
 * still always delivers every Firestore update immediately to `onData`).
 * The only addition (Phase 1 Local Cache Foundation, §9 "use existing
 * listener updates to keep the cache synchronized") is a fire-and-forget
 * write-through into the same local cache fetchMasterData reads from, so a
 * screen already live-subscribed to a collection keeps that collection's
 * cache warm for OTHER screens/forms that call fetchMasterData for it -
 * without adding a second listener or any extra Firestore read.
 */
export function subscribeMasterData<T>(
  collectionName: string,
  onData: (items: T[]) => void,
  onError?: (err: any) => void
) {
  return onSnapshot(
    collection(db, collectionName),
    (snapshot) => {
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as T[];
      onData(items);
      void setCachedCollection(currentCacheUserScope(), collectionName, items);
    },
    (error) => {
      console.warn(`Master data subscription snapshot notice for ${collectionName}:`, error);
      if (onError) onError(error);
    }
  );
}

/**
 * The awaited steps of one master-data write (3.21.5). An optional `onStep`
 * callback is told which step is starting, so a caller that bounds the whole
 * write (the Master Data import) can say exactly what it was waiting for when
 * the server did not answer. It observes only - no step is skipped or reordered.
 */
export type MasterDataWriteStep = 'DUPLICATE_LOOKUP' | 'FIRESTORE_WRITE' | 'CACHE_CLEANUP' | 'AUDIT_WRITE';
export interface MasterDataWriteOptions {
  onStep?: (step: MasterDataWriteStep) => void;
}

/**
 * A read-only, one-document check that the Firestore backend itself answers
 * (3.21.5). It asks the server, never the local cache, so it is a real test of
 * the path the writes use; the caller bounds it with its own timeout. Nothing is
 * written and no cache is touched.
 */
export async function probeMasterDataBackend(): Promise<void> {
  await getDocsFromServer(query(collection(db, 'products'), limit(1)));
}

/*
 * ---------------------------------------------------------------------------
 * Bounded reads for browsing (3.22.0) - see masterDataBrowsePure.ts.
 *
 * Each of these reads a LIMITED number of documents (or, for the count, none):
 * they are how the Master Data screen shows a page, answers a search and keeps
 * one row current without reading a whole collection. None of them writes the
 * local collection cache - a page or a search result is not the collection,
 * and caching it as one would make fetchMasterData return a partial list.
 * ---------------------------------------------------------------------------
 */

/** One page of a collection, in document-id order - the order the full listener delivers. */
export interface MasterDataPage<T> {
  rows: T[];
  /** The id to continue after, or null before the first page. */
  lastId: string | null;
  /** The page came back short: there is nothing after it. */
  exhausted: boolean;
}

export async function fetchMasterDataPage<T extends { id?: string }>(
  collectionName: string,
  pageSize: number,
  afterId?: string | null,
): Promise<MasterDataPage<T>> {
  const constraints = afterId
    ? [orderBy(documentId()), startAfter(afterId), limit(pageSize)]
    : [orderBy(documentId()), limit(pageSize)];
  const snapshot = await getDocs(query(collection(db, collectionName), ...constraints));
  const rows = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as T[];
  return {
    rows,
    lastId: rows.length ? String(rows[rows.length - 1].id) : (afterId ?? null),
    exhausted: rows.length < pageSize,
  };
}

/** Result of a bounded server search. */
export interface MasterDataSearchResult<T> {
  rows: T[];
  /** At least one query stopped at its limit - more matches may exist on the server. */
  truncated: boolean;
}

/**
 * Records whose code or name STARTS WITH the term, from the server.
 *
 * One range query per field per form of the term (as typed / upper / lower),
 * each limited - a single-field range needs no composite index. Firestore has
 * no "contains"; matching any part of a code needs the full list, which the
 * screen loads only when asked.
 */
export async function searchMasterDataByPrefix<T extends { id?: string }>(
  collectionName: string,
  fields: readonly string[],
  term: string,
  perQueryLimit: number,
): Promise<MasterDataSearchResult<T>> {
  const variants = searchTermVariants(term);
  if (variants.length === 0 || fields.length === 0) return { rows: [], truncated: false };
  const queries = fields.flatMap((field) =>
    variants.map((v) =>
      query(collection(db, collectionName), where(field, '>=', v), where(field, '<=', `${v}\uf8ff`), limit(perQueryLimit)),
    ),
  );
  const snapshots = await Promise.all(queries.map((q) => getDocs(q)));
  const lists = snapshots.map((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })) as T[]);
  return {
    rows: mergeRowsById(...lists),
    truncated: snapshots.some((s) => isTruncated(s.size, perQueryLimit)),
  };
}

/** Records whose field equals a value (the Products prefix filter), limited. */
export async function fetchMasterDataWhereEquals<T extends { id?: string }>(
  collectionName: string,
  field: string,
  value: string,
  max: number,
): Promise<MasterDataSearchResult<T>> {
  const snapshot = await getDocs(query(collection(db, collectionName), where(field, '==', value), limit(max)));
  return {
    rows: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as T[],
    truncated: isTruncated(snapshot.size, max),
  };
}

/**
 * EVERY record whose field equals a value - no limit, for a caller whose rules
 * need the complete set (the versions of one BOM). It reads only the matching
 * documents, never the collection. Not cached: it is not the collection.
 */
export async function fetchMasterDataByField<T extends { id?: string }>(
  collectionName: string,
  field: string,
  value: string,
): Promise<T[]> {
  const snapshot = await getDocs(query(collection(db, collectionName), where(field, '==', value)));
  return snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as T[];
}

/** How many records a collection holds - a server-side count, no documents read. */
export async function countMasterData(collectionName: string): Promise<number> {
  const snapshot = await getCountFromServer(collection(db, collectionName));
  return snapshot.data().count;
}

/** One record, re-read after a write so the row on screen shows what was saved. Null when it no longer exists. */
export async function fetchMasterDataItem<T extends { id?: string }>(collectionName: string, id: string): Promise<T | null> {
  const snapshot = await getDoc(doc(db, collectionName, id));
  return snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null;
}

// Add Item
export async function createMasterDataItem<T extends Record<string, any>>(
  collectionName: string,
  data: T,
  options: MasterDataWriteOptions = {}
): Promise<string | undefined> {
  let itemData: any = { ...data };

  // Normalize and parse Product items
  if (collectionName === 'products' && (itemData.code || itemData.productCode)) {
    const rawCode = itemData.code || itemData.productCode;
    const normalizedCode = normalizeProductCode(rawCode);
    itemData.code = normalizedCode;
    itemData.productCode = normalizedCode;

    const parsed = parseProductCode(normalizedCode);
    itemData.smartParseStatus = parsed.status;

    if (parsed.status === 'SMART_CODE' && parsed.productType) {
      itemData.productTypePrefix = parsed.prefix;
      itemData.productTypeId = parsed.productType.id || '';
      itemData.productTypeName = parsed.productType.nameEn;
      itemData.productTypeNameAr = parsed.productType.nameAr;
      itemData.productIdentifier = parsed.productIdentifier;
      if (itemData.aluminaPercentage === undefined && parsed.aluminaPercentage !== undefined) {
        itemData.aluminaPercentage = parsed.aluminaPercentage;
      }
      if (!itemData.category) {
        itemData.category = parsed.productType.nameAr || parsed.productType.nameEn;
      }
    } else if (parsed.status === 'UNKNOWN_PREFIX') {
      itemData.productTypePrefix = parsed.prefix;
      itemData.productIdentifier = parsed.productIdentifier;
      if (itemData.aluminaPercentage === undefined && parsed.aluminaPercentage !== undefined) {
        itemData.aluminaPercentage = parsed.aluminaPercentage;
      }
    } else {
      // MANUAL_PRODUCT_CODE / Numeric start / custom: NEVER derive alumina or type!
      // Preserve whatever manual values the user explicitly provided (if any)
      if (parsed.isNumericStart) {
        itemData.productTypePrefix = undefined;
        itemData.productIdentifier = undefined;
      }
    }
  }

  // Enrich with normalized searchable fields
  const tabName = collectionName as MasterDataTab;
  itemData = enrichWithNormalizedFields(tabName, itemData);

  // Validate duplicate code if code exists
  if (itemData.code) {
    options.onStep?.('DUPLICATE_LOOKUP');
    const isDuplicate = await checkCodeDuplicate(collectionName, itemData.code);
    if (isDuplicate) {
      throw new Error(`الكود "${itemData.code}" موجود بالفعل في قاعدة البيانات. يرجى استخدام كود مختلف.`);
    }
  }

  const payload = {
    ...itemData,
    active: itemData.active !== undefined ? itemData.active : true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    serverCreatedAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  };

  try {
    options.onStep?.('FIRESTORE_WRITE');
    const docRef = await safeAddDoc(collection(db, collectionName), payload);
    options.onStep?.('CACHE_CLEANUP');
    await invalidateCachedCollection(currentCacheUserScope(), collectionName);
    options.onStep?.('AUDIT_WRITE');
    await logAuditAction('CREATE', collectionName, docRef.id, `إضافة سجل جديد بكود: ${itemData.code || docRef.id}`);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, collectionName);
  }
}

// Update Item
export async function updateMasterDataItem<T extends Record<string, any>>(
  collectionName: string,
  id: string,
  data: Partial<T>,
  options: MasterDataWriteOptions = {}
): Promise<void> {
  let itemData: any = { ...data };

  // Normalize and parse Product items if code is updated
  if (collectionName === 'products' && (itemData.code || itemData.productCode)) {
    const rawCode = itemData.code || itemData.productCode;
    const normalizedCode = normalizeProductCode(rawCode);
    itemData.code = normalizedCode;
    itemData.productCode = normalizedCode;

    const parsed = parseProductCode(normalizedCode);
    itemData.smartParseStatus = parsed.status;

    if (parsed.status === 'SMART_CODE' && parsed.productType) {
      itemData.productTypePrefix = parsed.prefix;
      itemData.productTypeId = parsed.productType.id || '';
      itemData.productTypeName = parsed.productType.nameEn;
      itemData.productTypeNameAr = parsed.productType.nameAr;
      itemData.productIdentifier = parsed.productIdentifier;
      if (itemData.aluminaPercentage === undefined && parsed.aluminaPercentage !== undefined) {
        itemData.aluminaPercentage = parsed.aluminaPercentage;
      }
      if (!itemData.category) {
        itemData.category = parsed.productType.nameAr || parsed.productType.nameEn;
      }
    } else if (parsed.status === 'UNKNOWN_PREFIX') {
      itemData.productTypePrefix = parsed.prefix;
      itemData.productIdentifier = parsed.productIdentifier;
      if (itemData.aluminaPercentage === undefined && parsed.aluminaPercentage !== undefined) {
        itemData.aluminaPercentage = parsed.aluminaPercentage;
      }
    }
  }

  // Enrich with normalized searchable fields
  const tabName = collectionName as MasterDataTab;
  itemData = enrichWithNormalizedFields(tabName, itemData);

  if (itemData.code) {
    options.onStep?.('DUPLICATE_LOOKUP');
    const isDuplicate = await checkCodeDuplicate(collectionName, itemData.code, id);
    if (isDuplicate) {
      throw new Error(`الكود "${itemData.code}" مسجل بالفعل لعنصر آخر.`);
    }
  }

  const payload = {
    ...itemData,
    updatedAt: new Date().toISOString(),
    serverUpdatedAt: serverTimestamp(),
  };

  try {
    const docRef = doc(db, collectionName, id);
    options.onStep?.('FIRESTORE_WRITE');
    await safeUpdateDoc(docRef, payload);
    options.onStep?.('CACHE_CLEANUP');
    await invalidateCachedCollection(currentCacheUserScope(), collectionName);
    options.onStep?.('AUDIT_WRITE');
    await logAuditAction('UPDATE', collectionName, id, `تعديل بيانات السجل: ${itemData.code || id}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${collectionName}/${id}`);
  }
}

// Toggle Active status
export async function toggleMasterDataActive(
  collectionName: string,
  id: string,
  currentStatus: boolean
): Promise<void> {
  const newStatus = !currentStatus;
  try {
    const docRef = doc(db, collectionName, id);
    await updateDoc(docRef, {
      active: newStatus,
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });
    await invalidateCachedCollection(currentCacheUserScope(), collectionName);
    await logAuditAction(
      newStatus ? 'ACTIVATE' : 'DEACTIVATE',
      collectionName, 
      id, 
      `${newStatus ? 'تفعيل' : 'تعطيل'} السجل`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${collectionName}/${id}`);
  }
}

// Delete Item
export async function deleteMasterDataItem(
  collectionName: string,
  id: string,
  itemCode?: string
): Promise<void> {
  try {
    const docRef = doc(db, collectionName, id);
    await deleteDoc(docRef);
    await invalidateCachedCollection(currentCacheUserScope(), collectionName);
    await logAuditAction('DELETE', collectionName, id, `حذف السجل: ${itemCode || id}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`);
  }
}

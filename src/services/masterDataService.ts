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
  serverTimestamp 
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
  customers: 'customers',
  shifts: 'shifts',
  materials: 'materials',
  machines: 'machines',
  stages: 'stages',
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

// Add Item
export async function createMasterDataItem<T extends Record<string, any>>(
  collectionName: string,
  data: T
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
    const docRef = await safeAddDoc(collection(db, collectionName), payload);
    await invalidateCachedCollection(currentCacheUserScope(), collectionName);
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
  data: Partial<T>
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
    await safeUpdateDoc(docRef, payload);
    await invalidateCachedCollection(currentCacheUserScope(), collectionName);
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

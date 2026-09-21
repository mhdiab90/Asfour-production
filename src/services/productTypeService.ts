/**
 * Product Type & Classification Service
 * Manages the single source of truth for 3-letter Product Type prefixes,
 * real-time Firestore synchronization, duplicate validation, and initial seeding.
 */
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../config/firebase';
import { ProductType } from '../types';
import { logAuditAction } from './auditService';
import { INITIAL_PRODUCT_TYPES, computeMissingSeedDocuments } from './productTypeSeedPure';

export { INITIAL_PRODUCT_TYPES, computeMissingSeedDocuments };

// In-memory cache for fast parser lookups
let cachedProductTypes: ProductType[] = [];

// In-flight guard: multiple mounts in the SAME tab (MasterDataView + BulkEntryView
// both call subscribeProductTypes -> seedInitialProductTypes) share one in-flight
// seed call instead of firing redundant concurrent reads/writes. This does not
// replace the deterministic-ID fix above (which is what makes CROSS-TAB/cross-session
// concurrency safe) - it just avoids doing the work twice within one tab.
let inFlightSeed: Promise<void> | null = null;

export function getCachedProductTypes(): ProductType[] {
  if (cachedProductTypes.length === 0) {
    // Return fallback initial mapped definitions until Firestore snapshot loads
    return INITIAL_PRODUCT_TYPES.map((t, index) => ({
      id: `initial-${index}`,
      ...t,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }
  return cachedProductTypes;
}

export function setCachedProductTypes(types: ProductType[]) {
  cachedProductTypes = types;
}

/**
 * Seed initial 27 Product Types into Firestore if they don't already exist.
 *
 * Concurrency-safe via deterministic doc IDs (see computeMissingSeedDocuments):
 * two callers racing this function - two tabs, two components mounting at
 * once - both resolve a missing prefix to the SAME target doc ID, so their
 * writes converge on one document instead of creating duplicates. This only
 * decides where a MISSING prefix gets created; it never touches an existing
 * document (including the 27 pre-existing duplicate pairs from the old
 * random-auto-ID scheme - those are out of scope for this fix and are left
 * exactly as-is).
 */
export async function seedInitialProductTypes(): Promise<void> {
  if (inFlightSeed) return inFlightSeed;
  inFlightSeed = (async () => {
    try {
      const snapshot = await getDocs(collection(db, 'productTypes'));
      const existingPrefixes = new Set<string>();
      snapshot.forEach((d) => {
        const data = d.data();
        if (data.prefixCode) {
          existingPrefixes.add(String(data.prefixCode).toUpperCase());
        }
      });

      const toCreate = computeMissingSeedDocuments(existingPrefixes);
      if (toCreate.length === 0) return;

      const batch = writeBatch(db);
      for (const { id, data } of toCreate) {
        batch.set(doc(db, 'productTypes', id), {
          ...data,
          serverCreatedAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      console.log(`Seeded ${toCreate.length} initial product types to Firestore.`);
    } catch (error) {
      console.warn('Initial product types seeding check notice:', error);
    } finally {
      inFlightSeed = null;
    }
  })();
  return inFlightSeed;
}

/**
 * Check if a 3-character prefixCode already exists.
 */
export async function checkPrefixDuplicate(prefixCode: string, excludeId?: string): Promise<boolean> {
  const normalized = prefixCode.trim().toUpperCase();
  try {
    const q = query(collection(db, 'productTypes'), where('prefixCode', '==', normalized));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return false;
    if (excludeId) {
      return snapshot.docs.some((d) => d.id !== excludeId);
    }
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'productTypes');
    return false;
  }
}

/**
 * Fetch all product types from Firestore.
 */
export async function fetchProductTypes(): Promise<ProductType[]> {
  try {
    const snapshot = await getDocs(collection(db, 'productTypes'));
    if (snapshot.empty) {
      // Auto-seed if empty
      await seedInitialProductTypes();
      const newSnapshot = await getDocs(collection(db, 'productTypes'));
      const items = newSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as ProductType[];
      setCachedProductTypes(items);
      return items;
    }

    const items = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as ProductType[];
    setCachedProductTypes(items);
    return items;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'productTypes');
    return getCachedProductTypes();
  }
}

export const fetchAllProductTypes = fetchProductTypes;

/**
 * Real-time subscription to product types collection.
 */
export function subscribeProductTypes(
  onData: (types: ProductType[]) => void,
  onError?: (err: any) => void
) {
  // Ensure initial seed occurs in background if needed
  seedInitialProductTypes().catch(() => {});

  return onSnapshot(
    collection(db, 'productTypes'),
    (snapshot) => {
      const types = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as ProductType[];
      
      // Sort alphabetically by prefixCode
      types.sort((a, b) => a.prefixCode.localeCompare(b.prefixCode));
      
      setCachedProductTypes(types);
      onData(types);
    },
    (err) => {
      console.warn('Product types subscription error:', err);
      if (onError) onError(err);
    }
  );
}

/**
 * Create a new Product Type.
 */
export async function createProductType(data: {
  prefixCode: string;
  nameEn: string;
  nameAr: string;
  description?: string;
  active?: boolean;
}): Promise<string> {
  const normalizedPrefix = data.prefixCode.trim().toUpperCase();

  if (!/^[A-Z0-9]{3}$/.test(normalizedPrefix)) {
    throw new Error('بادئة الكود (Prefix Code) يجب أن تتكون من 3 أحرف باللغة الإنجليزية بالضبط (مثال: BAR, BHA).');
  }

  const isDuplicate = await checkPrefixDuplicate(normalizedPrefix);
  if (isDuplicate) {
    throw new Error(`البادئة "${normalizedPrefix}" مسجلة بالفعل في جدول تصنيفات المنتجات.`);
  }

  const payload = {
    prefixCode: normalizedPrefix,
    nameEn: data.nameEn.trim(),
    nameAr: data.nameAr.trim(),
    description: data.description?.trim() || '',
    active: data.active !== undefined ? data.active : true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    serverCreatedAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  };

  try {
    const docRef = await addDoc(collection(db, 'productTypes'), payload);
    await logAuditAction(
      'PRODUCT_TYPE_CREATE',
      'productTypes',
      docRef.id,
      `إضافة تصنيف منتج جديد: ${normalizedPrefix} - ${data.nameEn} (${data.nameAr})`
    );
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'productTypes');
    throw error;
  }
}

/**
 * Update an existing Product Type.
 */
export async function updateProductType(
  id: string,
  data: Partial<Omit<ProductType, 'id'>>
): Promise<void> {
  const payload: Record<string, any> = {
    ...data,
    updatedAt: new Date().toISOString(),
    serverUpdatedAt: serverTimestamp(),
  };

  if (data.prefixCode) {
    const normalizedPrefix = data.prefixCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{3}$/.test(normalizedPrefix)) {
      throw new Error('بادئة الكود (Prefix Code) يجب أن تتكون من 3 أحرف باللغة الإنجليزية بالضبط.');
    }
    const isDuplicate = await checkPrefixDuplicate(normalizedPrefix, id);
    if (isDuplicate) {
      throw new Error(`البادئة "${normalizedPrefix}" مسجلة بالفعل لتصنيف آخر.`);
    }
    payload.prefixCode = normalizedPrefix;
  }

  try {
    const docRef = doc(db, 'productTypes', id);
    await updateDoc(docRef, payload);
    await logAuditAction(
      'PRODUCT_TYPE_UPDATE',
      'productTypes',
      id,
      `تعديل تصنيف المنتج: ${payload.prefixCode || id}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `productTypes/${id}`);
    throw error;
  }
}

/**
 * Toggle Active / Inactive status for Product Type.
 */
export async function toggleProductTypeActive(
  id: string,
  currentStatus: boolean,
  prefixCode?: string
): Promise<void> {
  const newStatus = !currentStatus;
  try {
    const docRef = doc(db, 'productTypes', id);
    await updateDoc(docRef, {
      active: newStatus,
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });
    await logAuditAction(
      newStatus ? 'PRODUCT_TYPE_ACTIVATE' : 'PRODUCT_TYPE_DEACTIVATE',
      'productTypes',
      id,
      `${newStatus ? 'تفعيل' : 'تعطيل'} تصنيف المنتج: ${prefixCode || id}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `productTypes/${id}`);
    throw error;
  }
}

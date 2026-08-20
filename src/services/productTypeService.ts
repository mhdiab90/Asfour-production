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

export const INITIAL_PRODUCT_TYPES: Omit<ProductType, 'id'>[] = [
  { prefixCode: 'BAR', nameEn: 'Bricks Acid Resistance', nameAr: 'طوب مقاوم للأحماض', active: true },
  { prefixCode: 'BC2', nameEn: 'Ball Clay', nameAr: 'طين كروي BC2', active: true },
  { prefixCode: 'BC3', nameEn: 'Ball Clay Type B (Bulk)', nameAr: 'طين كروي صب BC3', active: true },
  { prefixCode: 'BCB', nameEn: 'Bricks Chemical Bond', nameAr: 'طوب بروابط كيميائية BCB', active: true },
  { prefixCode: 'BCM', nameEn: 'Bricks Chemical Bond', nameAr: 'طوب بروابط كيميائية BCM', active: true },
  { prefixCode: 'BFC', nameEn: 'Bricks Semi Silica', nameAr: 'طوب نصف سيليكا', active: true },
  { prefixCode: 'BHA', nameEn: 'Bricks High Alumina', nameAr: 'طوب عالي الألومينا BHA', active: true },
  { prefixCode: 'BHS', nameEn: 'Bricks High Alumina', nameAr: 'طوب عالي الألومينا BHS', active: true },
  { prefixCode: 'BLW', nameEn: 'Bricks Lightweight', nameAr: 'طوب خفيف عازل', active: true },
  { prefixCode: 'BMG', nameEn: 'Magnesite Bricks', nameAr: 'مجنزيت', active: true },
  { prefixCode: 'BSI', nameEn: 'Bricks Silicon Carbide', nameAr: 'طوب كربيد السيليكون', active: true },
  { prefixCode: 'CAL', nameEn: 'Calcined Alumina', nameAr: 'ألومينا محروقة', active: true },
  { prefixCode: 'CBA', nameEn: 'Asfour Calcined Bauxite', nameAr: 'بوكسيت عصفور محروق', active: true },
  { prefixCode: 'CBC', nameEn: 'China Calcined Bauxite', nameAr: 'بوكسيت صيني محروق', active: true },
  { prefixCode: 'CHC', nameEn: 'Cordierite Chamotte', nameAr: 'شاموت كورديريت', active: true },
  { prefixCode: 'CHR', nameEn: 'Kaolin', nameAr: 'كاولين', active: true },
  { prefixCode: 'CHS', nameEn: 'Chamotte Sanitaryware', nameAr: 'شاموت أدوات صحية', active: true },
  { prefixCode: 'CLW', nameEn: 'Castable Lightweight', nameAr: 'خرسانة خفيفة عازلة', active: true },
  { prefixCode: 'COC', nameEn: 'Castable Cordierite', nameAr: 'خرسانة كورديريت', active: true },
  { prefixCode: 'FBF', nameEn: 'Bricks Fire Clay', nameAr: 'طوب طيني حراري', active: true },
  { prefixCode: 'FBJ', nameEn: 'Crushed Bricks', nameAr: 'كسر طوب', active: true },
  { prefixCode: 'GPS', nameEn: 'Ref. Gypsum', nameAr: 'جبس حراري', active: true },
  { prefixCode: 'GRA', nameEn: 'Ground Graphite', nameAr: 'جرافيت مطحون', active: true },
  { prefixCode: 'LCC', nameEn: 'Castable LCC', nameAr: 'خرسانة حرارية LCC منخفضة الأسمنت', active: true },
  { prefixCode: 'LCM', nameEn: 'Castable LCM', nameAr: 'خرسانة حرارية LCM متوسطة الأسمنت', active: true },
  { prefixCode: 'LMC', nameEn: 'Castable Cordierite', nameAr: 'خرسانة كورديريت LMC', active: true },
  { prefixCode: 'LWC', nameEn: 'Lightweight Chamotte', nameAr: 'شاموت خفيف الوزن', active: true },
];

// In-memory cache for fast parser lookups
let cachedProductTypes: ProductType[] = [];

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
 */
export async function seedInitialProductTypes(): Promise<void> {
  try {
    const snapshot = await getDocs(collection(db, 'productTypes'));
    const existingPrefixes = new Set<string>();
    snapshot.forEach((d) => {
      const data = d.data();
      if (data.prefixCode) {
        existingPrefixes.add(String(data.prefixCode).toUpperCase());
      }
    });

    const batch = writeBatch(db);
    let addedCount = 0;

    for (const item of INITIAL_PRODUCT_TYPES) {
      const normalizedPrefix = item.prefixCode.toUpperCase();
      if (!existingPrefixes.has(normalizedPrefix)) {
        const newDocRef = doc(collection(db, 'productTypes'));
        batch.set(newDocRef, {
          prefixCode: normalizedPrefix,
          nameEn: item.nameEn,
          nameAr: item.nameAr,
          description: `تصنيف تلقائي لنوع المنتج (${item.prefixCode})`,
          active: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          serverCreatedAt: serverTimestamp(),
          serverUpdatedAt: serverTimestamp(),
        });
        addedCount++;
      }
    }

    if (addedCount > 0) {
      await batch.commit();
      console.log(`Seeded ${addedCount} initial product types to Firestore.`);
    }
  } catch (error) {
    console.warn('Initial product types seeding check notice:', error);
  }
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

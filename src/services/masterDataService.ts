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
import { db, handleFirestoreError, OperationType } from '../config/firebase';
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
  customers: 'customers',
  shifts: 'shifts',
};

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

// Generic Fetch All
export async function fetchMasterData<T extends { id?: string; code?: string }>(
  collectionName: string
): Promise<T[]> {
  try {
    const snapshot = await getDocs(collection(db, collectionName));
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as T[];
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, collectionName);
  }
}

// Real-time listener
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
    const docRef = await addDoc(collection(db, collectionName), payload);
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
    await updateDoc(docRef, payload);
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
    await logAuditAction('DELETE', collectionName, id, `حذف السجل: ${itemCode || id}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${collectionName}/${id}`);
  }
}

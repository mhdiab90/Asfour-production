/**
 * Production Management Service
 * Handles calculation engines, production records CRUD, child collection synchronization,
 * and multi-dimensional filtering.
 */
import { 
  collection, 
  doc, 
  getDocs, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy, 
  onSnapshot, 
  serverTimestamp,
  writeBatch,
  where
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../config/firebase';
import { ProductionRecord, ProductionFilter, DashboardKPIs } from '../types';
import { logAuditAction } from './auditService';
import { matchesSearch, enrichWithNormalizedFields } from '../utils/searchUtils';

// Pure Production Calculation Engine
export function calculateProductionMetrics(
  productionQuantity: number,
  wasteQuantity: number,
  pieceWeight: number,
  faults: {
    mechanicalFaults?: number;
    electricalFaults?: number;
    workshopFaults?: number;
    rawMaterialFaults?: number;
    furnaceFaults?: number;
    pressFaults?: number;
    otherFaults?: number;
  }
) {
  const prodQty = Math.max(0, Number(productionQuantity) || 0);
  const wasteQty = Math.max(0, Number(wasteQuantity) || 0);
  const pWeight = Math.max(0, Number(pieceWeight) || 0);
  
  const goodQuantity = Math.max(0, prodQty - wasteQty);
  const productionWeight = Number((prodQty * pWeight).toFixed(2));
  const goodWeight = Number((goodQuantity * pWeight).toFixed(2));
  const wasteWeight = Number((wasteQty * pWeight).toFixed(2));
  const wastePercentage = prodQty > 0 ? Number(((wasteQty / prodQty) * 100).toFixed(2)) : 0;

  const mechanical = Number(faults.mechanicalFaults) || 0;
  const electrical = Number(faults.electricalFaults) || 0;
  const workshop = Number(faults.workshopFaults) || 0;
  const rawMaterial = Number(faults.rawMaterialFaults) || 0;
  const furnace = Number(faults.furnaceFaults) || 0;
  const press = Number(faults.pressFaults) || 0;
  const other = Number(faults.otherFaults) || 0;

  const totalDowntimeMinutes = mechanical + electrical + workshop + rawMaterial + furnace + press + other;
  const totalDowntimeHours = Number((totalDowntimeMinutes / 60).toFixed(2));

  return {
    productionQuantity: prodQty,
    wasteQuantity: wasteQty,
    goodQuantity,
    pieceWeight: pWeight,
    productionWeight,
    goodWeight,
    wasteWeight,
    wastePercentage,
    mechanicalFaults: mechanical,
    electricalFaults: electrical,
    workshopFaults: workshop,
    rawMaterialFaults: rawMaterial,
    furnaceFaults: furnace,
    pressFaults: press,
    otherFaults: other,
    totalDowntimeMinutes,
    totalDowntimeHours,
  };
}

// Create New Production Record with atomicity & child collection synchronization
export async function createProductionRecord(
  data: Omit<ProductionRecord, 'id' | 'createdBy' | 'createdAt' | 'updatedAt' | 'goodQuantity' | 'productionWeight' | 'goodWeight' | 'wasteWeight' | 'wastePercentage' | 'totalDowntimeMinutes' | 'totalDowntimeHours'>
): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('يجب تسجيل الدخول لإضافة سجل إنتاج.');
  }

  // Calculate metrics
  const metrics = calculateProductionMetrics(
    data.productionQuantity,
    data.wasteQuantity,
    data.pieceWeight,
    {
      mechanicalFaults: data.mechanicalFaults,
      electricalFaults: data.electricalFaults,
      workshopFaults: data.workshopFaults,
      rawMaterialFaults: data.rawMaterialFaults,
      furnaceFaults: data.furnaceFaults,
      pressFaults: data.pressFaults,
      otherFaults: data.otherFaults,
    }
  );

  const newDocRef = doc(collection(db, 'production'));
  const productionId = newDocRef.id;

  const payload: ProductionRecord = {
    ...data,
    ...metrics,
    id: productionId,
    createdBy: currentUser.uid,
    createdByName: currentUser.email || 'Admin',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const batch = writeBatch(db);

  // 1. Production record
  batch.set(newDocRef, {
    ...payload,
    serverCreatedAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  });

  // 2. Production employees mapping
  if (data.employeeIds && data.employeeIds.length > 0) {
    data.employeeIds.forEach((empId, idx) => {
      const peDocRef = doc(collection(db, 'productionEmployees'));
      batch.set(peDocRef, {
        productionId,
        employeeId: empId,
        employeeName: data.employeeNames?.[idx] || '',
        employeeCode: data.employeeCodes?.[idx] || '',
        date: data.date,
        shiftId: data.shiftId,
        createdAt: new Date().toISOString(),
      });
    });
  }

  // 3. Production furnace cars mapping
  if (data.furnaceCarIds && data.furnaceCarIds.length > 0) {
    data.furnaceCarIds.forEach((carId, idx) => {
      const pfcDocRef = doc(collection(db, 'productionFurnaceCars'));
      batch.set(pfcDocRef, {
        productionId,
        furnaceCarId: carId,
        carNumber: data.furnaceCarNumbers?.[idx] || '',
        furnaceId: data.furnaceId || '',
        date: data.date,
        createdAt: new Date().toISOString(),
      });
    });
  }

  // 4. Downtime recording if downtime occurred
  if (metrics.totalDowntimeMinutes > 0) {
    const downtimeDocRef = doc(collection(db, 'downtime'));
    batch.set(downtimeDocRef, {
      productionId,
      date: data.date,
      shiftId: data.shiftId,
      pressId: data.pressId,
      furnaceId: data.furnaceId || '',
      mechanical: metrics.mechanicalFaults,
      electrical: metrics.electricalFaults,
      workshop: metrics.workshopFaults,
      rawMaterial: metrics.rawMaterialFaults,
      furnace: metrics.furnaceFaults,
      press: metrics.pressFaults,
      other: metrics.otherFaults,
      totalMinutes: metrics.totalDowntimeMinutes,
      totalHours: metrics.totalDowntimeHours,
      notes: data.notes || '',
      createdAt: new Date().toISOString(),
    });
  }

  try {
    await batch.commit();
    await logAuditAction(
      'CREATE',
      'production',
      productionId,
      `تسجيل عملية إنتاج: ${data.productName} (${data.productionQuantity} قطعة) - مكبس: ${data.pressName}`
    );
    return productionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'production');
  }
}

// Update Production Record
export async function updateProductionRecord(
  id: string,
  data: Partial<ProductionRecord>
): Promise<void> {
  // Re-calculate if quantities or piece weight provided
  let calculatedUpdates = {};
  if (data.productionQuantity !== undefined || data.wasteQuantity !== undefined || data.pieceWeight !== undefined) {
    const prodQty = data.productionQuantity ?? 0;
    const wasteQty = data.wasteQuantity ?? 0;
    const pWeight = data.pieceWeight ?? 0;
    calculatedUpdates = calculateProductionMetrics(prodQty, wasteQty, pWeight, {
      mechanicalFaults: data.mechanicalFaults,
      electricalFaults: data.electricalFaults,
      workshopFaults: data.workshopFaults,
      rawMaterialFaults: data.rawMaterialFaults,
      furnaceFaults: data.furnaceFaults,
      pressFaults: data.pressFaults,
      otherFaults: data.otherFaults,
    });
  }

  const payload = {
    ...data,
    ...calculatedUpdates,
    updatedAt: new Date().toISOString(),
    serverUpdatedAt: serverTimestamp(),
  };

  try {
    const docRef = doc(db, 'production', id);
    await updateDoc(docRef, payload);
    await logAuditAction('UPDATE', 'production', id, `تعديل سجل إنتاج رقم ${id}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `production/${id}`);
  }
}

// Delete Production Record
export async function deleteProductionRecord(id: string, recordName?: string): Promise<void> {
  try {
    const docRef = doc(db, 'production', id);
    await deleteDoc(docRef);
    await logAuditAction('DELETE', 'production', id, `حذف سجل الإنتاج ${recordName || id}`);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `production/${id}`);
  }
}

// Fetch all production records
export async function fetchProductionRecords(): Promise<ProductionRecord[]> {
  try {
    const q = query(collection(db, 'production'), orderBy('date', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as ProductionRecord[];
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'production');
  }
}

// Real-time subscription to production records
export function subscribeProductionRecords(
  onData: (records: ProductionRecord[]) => void,
  onError?: (err: any) => void
) {
  const q = query(collection(db, 'production'), orderBy('date', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const records = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ProductionRecord[];
      onData(records);
    },
    (error) => {
      console.warn('Production records subscription snapshot notice:', error);
      if (onError) onError(error);
    }
  );
}

// Filter production records helper
export function filterProductionRecords(
  records: ProductionRecord[],
  filter: ProductionFilter
): ProductionRecord[] {
  return records.filter(record => {
    // Date range filter
    if (filter.startDate && record.date < filter.startDate) return false;
    if (filter.endDate && record.date > filter.endDate) return false;

    // Shift filter
    if (filter.shiftId && record.shiftId !== filter.shiftId) return false;

    // Press filter
    if (filter.pressId && record.pressId !== filter.pressId) return false;

    // Furnace filter
    if (filter.furnaceId && record.furnaceId !== filter.furnaceId) return false;

    // Product filter
    if (filter.productId && record.productId !== filter.productId) return false;

    // Customer filter
    if (filter.customerId && record.customerId !== filter.customerId) return false;

    // Employee filter
    if (filter.employeeId && !record.employeeIds?.includes(filter.employeeId)) return false;

    // Search query across order number, product code/name, press, customer, furnace, employees
    if (filter.searchQuery && filter.searchQuery.trim() !== '') {
      const q = filter.searchQuery;
      const matchOrder = matchesSearch(record.customerOrderNumber, q);
      const matchProduct = matchesSearch(record.productName, q) || matchesSearch(record.productCode, q);
      const matchCustomer = matchesSearch(record.customerName, q) || matchesSearch(record.customerCode, q);
      const matchPress = matchesSearch(record.pressName, q) || matchesSearch(record.pressCode, q);
      const matchShift = matchesSearch(record.shiftName, q) || matchesSearch(record.shiftCode, q);
      const matchFurnace = matchesSearch(record.furnaceName, q) || matchesSearch(record.furnaceCode, q);
      const matchEmployees = record.employeeNames?.some(name => matchesSearch(name, q)) ||
                             record.employeeCodes?.some(code => matchesSearch(code, q));

      if (!matchOrder && !matchProduct && !matchCustomer && !matchPress && !matchShift && !matchFurnace && !matchEmployees) {
        return false;
      }
    }

    return true;
  });
}

// Calculate Dashboard / Report KPIs from a list of records
export function calculateKPIsFromRecords(records: ProductionRecord[]): DashboardKPIs {
  let totalProductionCount = 0;
  let totalGoodCount = 0;
  let totalWasteCount = 0;
  let totalProductionWeightKg = 0;
  let totalGoodWeightKg = 0;
  let totalWasteWeightKg = 0;
  let totalDowntimeMinutes = 0;

  records.forEach(r => {
    totalProductionCount += Number(r.productionQuantity) || 0;
    totalGoodCount += Number(r.goodQuantity) || 0;
    totalWasteCount += Number(r.wasteQuantity) || 0;
    totalProductionWeightKg += Number(r.productionWeight) || 0;
    totalGoodWeightKg += Number(r.goodWeight) || 0;
    totalWasteWeightKg += Number(r.wasteWeight) || 0;
    totalDowntimeMinutes += Number(r.totalDowntimeMinutes) || 0;
  });

  const wastePercentage = totalProductionCount > 0 
    ? Number(((totalWasteCount / totalProductionCount) * 100).toFixed(2)) 
    : 0;

  return {
    totalProductionCount,
    totalGoodCount,
    totalWasteCount,
    wastePercentage,
    totalProductionWeightKg: Number(totalProductionWeightKg.toFixed(2)),
    totalGoodWeightKg: Number(totalGoodWeightKg.toFixed(2)),
    totalWasteWeightKg: Number(totalWasteWeightKg.toFixed(2)),
    totalDowntimeMinutes,
    totalDowntimeHours: Number((totalDowntimeMinutes / 60).toFixed(2)),
    totalRecordsCount: records.length,
  };
}

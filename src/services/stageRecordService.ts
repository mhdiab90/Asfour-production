/**
 * Multi-Stage Production Record Service
 * Handles CRUD, status reviews, approval/rejections, and versioned audit history
 * across all 8 production stages.
 */
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../config/firebase';
import { safeAddDoc, safeUpdateDoc, sanitizeForFirestore } from '../utils/firestoreSanitizer';
import { 
  ProductionStageType, 
  RecordStatus, 
  UniversalStageRecord,
  RecordAuditLog,
  RotaryFurnaceRecord,
  ChineseMillsRecord,
  TubeBallMillsRecord,
  MortarConcreteRecord,
  MixingRecord,
  LightweightFoamRecord,
  SortingRecord,
  MultiDimensionFilter
} from '../types';
import { logAuditAction } from './auditService';

export const STAGE_COLLECTION_NAMES: Record<ProductionStageType, string> = {
  pressing: 'production',
  rotary_furnace: 'stage_rotary_furnace',
  chinese_mills: 'stage_chinese_mills',
  tube_ball_mills: 'stage_tube_ball_mills',
  mortar_concrete: 'stage_mortar_concrete',
  mixing: 'stage_mixing',
  lightweight_foam: 'stage_lightweight_foam',
  sorting: 'stage_sorting',
};

export const STAGE_DISPLAY_NAMES: Record<ProductionStageType, string> = {
  pressing: 'التشكيل والمكابس',
  rotary_furnace: 'الفرن الدوار',
  chinese_mills: 'الطواحين الصينية',
  tube_ball_mills: 'طواحين الأنابيب والكرات',
  mortar_concrete: 'المونة والخرسانات',
  mixing: 'الخلط والتجهيز',
  lightweight_foam: 'الشاموت الخفيف / عزل الفوم',
  sorting: 'الفرز والمراقبة',
};

/**
 * Create a new stage-specific production record
 */
export async function createStageRecord(
  stageType: ProductionStageType,
  data: Record<string, any>,
  status: RecordStatus = 'SUBMITTED'
): Promise<string> {
  const currentUser = auth.currentUser;
  const collectionName = STAGE_COLLECTION_NAMES[stageType] || `stage_${stageType}`;

  const payload = {
    ...data,
    stageType,
    stageNameAr: STAGE_DISPLAY_NAMES[stageType],
    status,
    createdBy: currentUser?.uid || 'anonymous',
    createdByName: currentUser?.email || 'مشغل الإنتاج',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    serverCreatedAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  };

  try {
    const docRef = await safeAddDoc(collection(db, collectionName), payload);

    await logAuditAction(
      'CREATE',
      collectionName,
      docRef.id,
      `تسجيل إنتاج مرحلة (${STAGE_DISPLAY_NAMES[stageType]}): ${data.productName || data.customerName || data.mixProductName || docRef.id} - الحالة: ${status}`
    );

    // Also record initial audit history
    await logRecordAudit({
      recordId: docRef.id,
      stageType,
      collection: collectionName,
      action: 'CREATE',
      changedByUid: currentUser?.uid || 'anonymous',
      changedByName: currentUser?.email || 'مشغل الإنتاج',
      changedAt: new Date().toISOString(),
      newStatus: status,
      newValue: data,
      reason: 'إنشاء السجل الأولي',
    });

    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, collectionName);
    throw error;
  }
}

/**
 * Update an existing stage record with versioned change tracking
 */
export async function updateStageRecord(
  stageType: ProductionStageType,
  recordId: string,
  updatedFields: Record<string, any>,
  correctionReason: string = 'تعديل البيانات'
): Promise<void> {
  const currentUser = auth.currentUser;
  const collectionName = STAGE_COLLECTION_NAMES[stageType] || `stage_${stageType}`;

  try {
    const docRef = doc(db, collectionName, recordId);
    const existingSnap = await getDoc(docRef);
    const oldData = existingSnap.exists() ? existingSnap.data() : {};

    await safeUpdateDoc(docRef, {
      ...updatedFields,
      status: 'CORRECTED',
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });

    await logAuditAction(
      'UPDATE',
      collectionName,
      recordId,
      `تعديل سجل مرحلة (${STAGE_DISPLAY_NAMES[stageType]}): سبب التعديل: ${correctionReason}`
    );

    // Save detailed versioned diff log
    await logRecordAudit({
      recordId,
      stageType,
      collection: collectionName,
      action: 'CORRECT',
      changedByUid: currentUser?.uid || 'anonymous',
      changedByName: currentUser?.email || 'المشرف',
      changedAt: new Date().toISOString(),
      oldStatus: oldData.status,
      newStatus: 'CORRECTED',
      oldValue: oldData,
      newValue: updatedFields,
      reason: correctionReason,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${collectionName}/${recordId}`);
    throw error;
  }
}

/**
 * Approve or Reject a production record
 */
export async function setRecordApprovalStatus(
  stageType: ProductionStageType,
  recordId: string,
  newStatus: 'APPROVED' | 'REJECTED',
  notes: string = ''
): Promise<void> {
  const currentUser = auth.currentUser;
  const collectionName = STAGE_COLLECTION_NAMES[stageType] || `stage_${stageType}`;

  try {
    const docRef = doc(db, collectionName, recordId);
    await updateDoc(docRef, {
      status: newStatus,
      reviewerUid: currentUser?.uid || '',
      reviewerName: currentUser?.email || 'المراجع',
      reviewNotes: notes,
      reviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      serverUpdatedAt: serverTimestamp(),
    });

    await logAuditAction(
      newStatus === 'APPROVED' ? 'UPDATE' : 'UPDATE',
      collectionName,
      recordId,
      `${newStatus === 'APPROVED' ? 'اعتماد' : 'رفض'} سجل مرحلة (${STAGE_DISPLAY_NAMES[stageType]}) - ملاحظات: ${notes || 'لا توجد'}`
    );

    await logRecordAudit({
      recordId,
      stageType,
      collection: collectionName,
      action: newStatus === 'APPROVED' ? 'APPROVE' : 'REJECT',
      changedByUid: currentUser?.uid || 'anonymous',
      changedByName: currentUser?.email || 'المراجع',
      changedAt: new Date().toISOString(),
      newStatus,
      reason: notes || (newStatus === 'APPROVED' ? 'اعتماد السجل' : 'رفض السجل'),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${collectionName}/${recordId}`);
    throw error;
  }
}

/**
 * Log record-level versioned audit entry
 */
export async function logRecordAudit(audit: RecordAuditLog): Promise<void> {
  try {
    await addDoc(collection(db, 'recordAuditHistory'), {
      ...audit,
      timestamp: new Date().toISOString(),
      serverCreatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.warn('Record audit logging warning:', err);
  }
}

/**
 * Fetch record-level change history for a given recordId
 */
export async function fetchRecordAuditHistory(recordId: string): Promise<RecordAuditLog[]> {
  try {
    const q = query(
      collection(db, 'recordAuditHistory'),
      where('recordId', '==', recordId)
    );
    const snapshot = await getDocs(q);
    const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as RecordAuditLog[];
    list.sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime());
    return list;
  } catch (err) {
    console.warn('Error fetching record audit history:', err);
    return [];
  }
}

/**
 * Fetch all records across all or selected stages and normalize into UniversalStageRecord
 */
export async function fetchUniversalStageRecords(
  filters?: MultiDimensionFilter
): Promise<UniversalStageRecord[]> {
  const stagesToFetch: ProductionStageType[] = filters?.stageType && filters.stageType !== 'all'
    ? [filters.stageType]
    : [
        'pressing',
        'rotary_furnace',
        'chinese_mills',
        'tube_ball_mills',
        'mortar_concrete',
        'mixing',
        'lightweight_foam',
        'sorting'
      ];

  const results: UniversalStageRecord[] = [];

  for (const st of stagesToFetch) {
    const colName = STAGE_COLLECTION_NAMES[st];
    try {
      const snap = await getDocs(collection(db, colName));
      snap.forEach(docSnap => {
        const d = docSnap.data();
        
        // Derive Tons accurately based on stage and piece weight
        let prodTons: number | null = null;
        let goodTons: number | null = null;
        let wasteTons: number | null = null;
        let prodCount: number | undefined = undefined;
        let pieceWeightKg: number | null = null;

        const rawPieceWeight = d.pieceWeightKg !== undefined && d.pieceWeightKg !== null 
          ? Number(d.pieceWeightKg) 
          : (d.pieceWeight !== undefined && d.pieceWeight !== null ? Number(d.pieceWeight) : null);
        
        if (rawPieceWeight !== null && !isNaN(rawPieceWeight) && rawPieceWeight > 0) {
          pieceWeightKg = rawPieceWeight;
        }

        if (st === 'pressing') {
          prodCount = Number(d.productionQuantity ?? d.productionCount ?? 0);
          if (d.productionTons !== undefined && d.productionTons !== null && d.productionTons > 0) {
            prodTons = Number(d.productionTons);
            goodTons = Number(d.goodTons ?? (prodTons - Number(d.wasteTons || 0)));
            wasteTons = Number(d.wasteTons || 0);
          } else if (pieceWeightKg !== null) {
            prodTons = Number(((prodCount * pieceWeightKg) / 1000).toFixed(3));
            const gCount = Number(d.goodQuantity ?? d.goodCount ?? Math.max(0, prodCount - Number(d.wasteQuantity || 0)));
            const wCount = Number(d.wasteQuantity ?? d.wasteCount ?? 0);
            goodTons = Number(((gCount * pieceWeightKg) / 1000).toFixed(3));
            wasteTons = Number(((wCount * pieceWeightKg) / 1000).toFixed(3));
          }
        } else if (st === 'sorting') {
          prodCount = Number(d.totalCount ?? d.productionQuantity ?? 0);
          if (d.totalTons !== undefined && d.totalTons !== null && d.totalTons > 0) {
            prodTons = Number(d.totalTons);
            goodTons = Number(d.goodTons ?? d.totalTons);
            wasteTons = Number(d.brokenTons ?? 0);
          } else if (pieceWeightKg !== null) {
            prodTons = Number(((prodCount * pieceWeightKg) / 1000).toFixed(3));
            const gCount = Number(d.goodCount ?? Math.max(0, prodCount - Number(d.brokenCount || 0)));
            const wCount = Number(d.brokenCount ?? 0);
            goodTons = Number(((gCount * pieceWeightKg) / 1000).toFixed(3));
            wasteTons = Number(((wCount * pieceWeightKg) / 1000).toFixed(3));
          }
        } else {
          // Direct ton-based stages (Rotary Furnace, Ball Mills, Mixing, etc.)
          prodTons = Number(d.productionQuantity ?? d.quantity ?? d.totalTons ?? 0);
          const wQty = Number(d.wasteQuantity ?? d.rejectedQuantity ?? 0);
          wasteTons = wQty;
          goodTons = Number(d.goodQuantity ?? Math.max(0, prodTons - wQty));
        }

        const gas = Number(d.gasConsumption || 0);
        const elec = Number(d.electricityConsumption || 0);
        const gasPerTon = (prodTons && prodTons > 0 && gas > 0) ? Number((gas / prodTons).toFixed(3)) : null;
        const electricityPerTon = (prodTons && prodTons > 0 && elec > 0) ? Number((elec / prodTons).toFixed(3)) : null;

        // Map stage-specific fields to UniversalStageRecord
        const rec: UniversalStageRecord = {
          id: docSnap.id,
          stageType: st,
          stageNameAr: STAGE_DISPLAY_NAMES[st] || st,
          date: d.date || d.createdAt?.split('T')[0] || '',
          productId: d.productId || '',
          productCode: d.productCode || d.mixProductCode || '',
          productName: d.productName || d.mixProductName || '',
          customerId: d.customerId || '',
          customerName: d.customerName || '',
          quantity: Number(d.productionQuantity ?? d.quantity ?? d.totalTons ?? d.totalCount ?? 0),
          unit: st === 'sorting' || st === 'pressing' ? 'قطعة' : st === 'chinese_mills' ? 'شيكارة' : 'طن',
          productionTons: prodTons,
          goodTons: goodTons,
          wasteTons: wasteTons,
          productionCount: prodCount,
          wasteQuantity: Number(d.wasteQuantity ?? d.rejectedQuantity ?? d.brokenCount ?? 0),
          goodQuantity: Number(d.goodQuantity ?? d.goodCount ?? 0),
          pieceWeightKg: pieceWeightKg,
          totalDowntimeMinutes: Number(d.totalDowntimeMinutes ?? d.downtimeMinutes ?? ((d.downtimeHours || 0) * 60)),
          gasConsumption: gas,
          electricityConsumption: elec,
          gasPerTon,
          electricityPerTon,
          materials: d.materials || [],
          workers: d.productionWorkers || d.workers || (d.employeeNames ? d.employeeNames.map((n: string, i: number) => ({
            employeeId: d.employeeIds?.[i] || '',
            employeeCode: d.employeeCodes?.[i] || '',
            employeeName: n
          })) : []),
          status: (d.status as RecordStatus) || 'SUBMITTED',
          createdBy: d.createdBy || '',
          createdByName: d.createdByName || '',
          createdAt: d.createdAt || '',
          updatedAt: d.updatedAt || '',
          rawData: d
        };

        // Client-side filtering check
        let match = true;
        if (filters?.startDate && rec.date < filters.startDate) match = false;
        if (filters?.endDate && rec.date > filters.endDate) match = false;
        if (filters?.status && filters.status !== 'all' && rec.status !== filters.status) match = false;
        if (filters?.productId && rec.productId !== filters.productId) match = false;
        if (filters?.customerId && rec.customerId !== filters.customerId) match = false;
        if (filters?.employeeId && !rec.workers?.some(w => w.employeeId === filters.employeeId)) match = false;
        if (filters?.searchQuery) {
          const q = filters.searchQuery.toLowerCase();
          const matches = 
            rec.productCode?.toLowerCase().includes(q) ||
            rec.productName?.toLowerCase().includes(q) ||
            rec.customerName?.toLowerCase().includes(q) ||
            rec.stageNameAr.includes(q);
          if (!matches) match = false;
        }

        if (match) {
          results.push(rec);
        }
      });
    } catch (err) {
      console.warn(`Note: error reading stage collection ${colName}:`, err);
    }
  }

  // Sort descending by date
  results.sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime());
  return results;
}

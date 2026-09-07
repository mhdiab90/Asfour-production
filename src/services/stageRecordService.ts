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
import {
  STAGE_COLLECTION_NAMES,
  resolveStageQueryBounds,
  StageQueryBounds,
  isStageQueryCacheEligible,
  buildStageQueryCacheKey
} from './stageQueryBoundsPure';
import { runCacheFirstRead } from './localCacheStore';

// Re-exported verbatim (defined in stageQueryBoundsPure.ts, which has zero
// Firebase dependency and is directly unit-testable) so every existing
// importer of STAGE_COLLECTION_NAMES/resolveStageQueryBounds from this file
// is unaffected by the move - see that file's own docblock.
export { STAGE_COLLECTION_NAMES, resolveStageQueryBounds };
export type { StageQueryBounds };

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
 * Fetch all records across all or selected stages and normalize into UniversalStageRecord.
 *
 * PHASE 4A: when `filters.startDate`/`filters.endDate` are supplied, each
 * stage collection's read is now bounded server-side via Firestore
 * `where('date', >=/<=, ...)` on the SAME field (never a composite index -
 * two inequality clauses on one field use Firestore's automatic
 * single-field index, confirmed safe to deploy without any index change).
 * The date-window client-side check below is kept as-is for callers that
 * omit these filters (unchanged, fully backward compatible) and as a
 * harmless no-op safety net when they are supplied (already-bounded
 * results trivially still pass the same check). No `limit()` is applied -
 * an arbitrary limit could silently drop valid report rows for a wide
 * date range, which is explicitly out of scope for this phase.
 */
/**
 * PHASE 4B - scopes the new bounded-stage-query cache to the signed-in
 * user, identical in shape and intent to masterDataService.ts's own
 * `currentCacheUserScope()` (same `auth.currentUser?.uid || 'anonymous'`
 * convention, kept as its own local copy here rather than importing that
 * one so this file's Firestore-record caching stays independent of
 * Master Data's - they already have separate, independent cache
 * lifecycles going back to the Phase 2 audit's "NO CHANGE NEEDED"
 * conclusion for unrelated collections).
 */
function currentCacheUserScope(): string {
  return auth.currentUser?.uid || 'anonymous';
}

/**
 * PHASE 4B - the exact Phase 4A fetch-and-normalize logic, unchanged,
 * extracted into an internal helper so it can be called either directly
 * (uncached path, for queries that are not cache-eligible) or wrapped by
 * `runCacheFirstRead` (cached path, for bounded queries) from the same
 * source of truth - no duplicated query/normalization logic between the
 * two paths.
 */
async function fetchUniversalStageRecordsUncached(
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

  const bounds = resolveStageQueryBounds(filters);
  const results: UniversalStageRecord[] = [];

  for (const st of stagesToFetch) {
    const colName = STAGE_COLLECTION_NAMES[st];
    try {
      // Same try/catch-and-skip pattern as before (one inaccessible/errored
      // stage collection never aborts the others) - never a "bounded query
      // fails, fall back to unbounded" ladder, which would reintroduce the
      // exact full-collection read this phase removes.
      let snap;
      if (bounds.useServerSideDateBound) {
        const constraints = [];
        if (bounds.startDate) constraints.push(where('date', '>=', bounds.startDate));
        if (bounds.endDate) constraints.push(where('date', '<=', bounds.endDate));
        snap = await getDocs(query(collection(db, colName), ...constraints));
      } else {
        snap = await getDocs(collection(db, colName));
      }
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

/**
 * PHASE 4B - CACHE BOUNDED STAGE RESULTS.
 *
 * Public entry point, signature unchanged from Phase 4A so every existing
 * caller (Dashboard/DashboardBuilderView, ReportsView, Suggested
 * Analytics, Data Review, the AI analytics/business-insights/stage-report
 * tools) keeps working with zero changes on their side.
 *
 * Caches ONLY queries with a valid, well-formed, non-inverted
 * [startDate, endDate] range (`isStageQueryCacheEligible`) - reusing the
 * existing `runCacheFirstRead` orchestration from localCacheStore.ts
 * completely unchanged, exactly as masterDataService.fetchMasterData
 * already does, by passing a deterministic synthetic string
 * (`buildStageQueryCacheKey`, encoding stageType+startDate+endDate) as its
 * `collectionName`. `collectionName` there is only ever used as an opaque
 * cache-key component (see localCacheStore.ts), never validated against a
 * real Firestore collection name, so this is a legitimate reuse rather
 * than a hack.
 *
 * Every other call shape - no dates, only one of startDate/endDate, or an
 * invalid/inverted range - calls the internal helper directly and is
 * byte-identical to today's uncached Phase 4A behavior. This is what
 * keeps Dashboard/DashboardBuilderView's intentionally unbounded calls
 * (no arguments at all) from ever being cached as if they were bounded.
 *
 * CACHE FAILURE SAFETY: `runCacheFirstRead`'s own cache get/set calls
 * (LocalCacheStore.get/save) never throw - any IndexedDB failure or
 * corrupt/undecodable entry is swallowed internally and treated as a
 * cache miss (see localCacheStore.ts). That means a cache failure here
 * can only ever fall through to `readFromSource`, i.e. this file's own
 * BOUNDED `fetchUniversalStageRecordsUncached(filters)` call - never an
 * unbounded Firestore read. No extra error handling is added here beyond
 * what `runCacheFirstRead` already guarantees, since adding a redundant
 * try/catch around it would only ever catch a bug in `readFromSource`
 * itself (the same bounded fetch either path would use).
 *
 * INVALIDATION: intentionally NOT implemented on stage-record writes
 * (createStageRecord/updateStageRecord/setRecordApprovalStatus, all
 * unchanged in this phase). Unlike Master Data - where one write maps
 * cleanly to one collection name to invalidate - a single stage-record
 * write's `date` could fall inside an unbounded number of different
 * already-cached date-range keys (e.g. "this week", "Q1 2026", "last
 * month" could all be independently cached and all legitimately include
 * that date). There is no simple 1:1 write-to-cache-key mapping the way
 * there is for Master Data, and building one (e.g. tracking every cached
 * range and testing each new/edited record's date against it) would be a
 * broad architectural change, not the smallest safe fix. Per this phase's
 * own explicit instruction, this finding is reported rather than acted
 * on: freshness instead relies solely on the existing 5-minute TTL
 * (`MASTER_DATA_CACHE_TTL_MS`, reused unchanged) expiring the entry.
 *
 * DISCLOSED STALE-CACHE RISK: a stage record created, edited, or
 * approved/rejected after a matching bounded query has already been
 * cached may not appear in that query's result for up to 5 minutes, until
 * the cache entry expires and the next call re-reads Firestore. This is
 * an accepted, disclosed tradeoff for this phase, not a silent gap.
 */
export async function fetchUniversalStageRecords(
  filters?: MultiDimensionFilter
): Promise<UniversalStageRecord[]> {
  if (!isStageQueryCacheEligible(filters)) {
    return fetchUniversalStageRecordsUncached(filters);
  }

  return runCacheFirstRead<UniversalStageRecord>({
    userScope: currentCacheUserScope(),
    collectionName: buildStageQueryCacheKey(filters as MultiDimensionFilter),
    readFromSource: () => fetchUniversalStageRecordsUncached(filters),
  });
}

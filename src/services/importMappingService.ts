/**
 * ASFOUR ERP - Import Mapping Memory & Historical Import Audit Service
 * Persists approved fuzzy match mappings across import sessions,
 * logs matching decisions, and provides safe batch rollback (Undo Import).
 */
import {
  collection,
  doc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  writeBatch,
  serverTimestamp
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { logAuditAction } from './auditService';
import { normalizeArabicForComparison } from '../utils/fuzzyMatching';
import { importHistoryEntryFromAuditLog, mergeImportHistorySources, ImportHistorySource } from './importHistoryPure';

export interface ImportMappingRecord {
  id?: string;
  domain: string; // 'press' | 'employee' | 'product' | 'customer' | 'shift' | 'furnace' | 'material'
  originalValue: string;
  normalizedOriginalValue: string;
  mappedEntityId: string;
  mappedEntityName: string;
  mappedEntityCode?: string;
  confidence: number;
  matchType: string;
  approvedBy: string;
  approvedByName?: string;
  approvedAt: string;
}

export interface ImportAuditEntry {
  id?: string;
  importBatchId: string;
  stage: string;
  fileName: string;
  totalRows: number;
  importedCount: number;
  failedCount: number;
  skippedCount: number;
  approvedMappingsCount: number;
  performedBy: string;
  performedByName?: string;
  performedAt: string;
  backupId?: string;
  /**
   * Comprehensive Historical Import Management task, §4/§8: optional richer
   * counts for modules (Chinese Mills first) that track them - never
   * required, so every EXISTING entry (Pressing, written before this field
   * existed) stays perfectly valid and simply renders these as "-" rather
   * than needing a backfill/migration.
   */
  selectedCount?: number;
  cancelledCount?: number;
  remainingCount?: number;
  approvedCount?: number;
  correctedCount?: number;
  warningCount?: number;
  blockingCount?: number;
  /**
   * Which source this entry's metadata actually came from:
   * 'AUDIT_TRAIL' = the full rich importAuditTrail document;
   * 'AUDIT_LOG'   = reconstructed from the readable auditLogs BULK_IMPORT
   *                 record, so most count fields were never recorded and
   *                 stay undefined rather than being invented (§3).
   */
  metadataSource?: ImportHistorySource;
  /** The original recorded audit sentence, carried verbatim so the real wording/numbers are always visible even when they could not be parsed into typed fields. */
  rawDetails?: string;
  /** False when the original import execution never generated/recorded a real, unique ImportId (the legacy executeBatchImport path) - importBatchId is then a synthetic-but-never-fabricated key, never to be displayed as a recorded ImportId. See importHistoryPure.ts. */
  hasRecordedImportId?: boolean;
}

// In-memory quick lookup cache
const MAPPINGS_CACHE: Record<string, Record<string, string>> = {}; // domain -> normalizedOriginal -> mappedEntityId

/**
 * Load all approved mapping dictionaries from Firestore into memory cache
 */
export async function loadApprovedMappings(): Promise<Record<string, Record<string, string>>> {
  try {
    const snap = await getDocs(collection(db, 'importMappings'));
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() as ImportMappingRecord;
      if (data.domain && data.normalizedOriginalValue && data.mappedEntityId) {
        if (!MAPPINGS_CACHE[data.domain]) {
          MAPPINGS_CACHE[data.domain] = {};
        }
        MAPPINGS_CACHE[data.domain][data.normalizedOriginalValue] = data.mappedEntityId;
      }
    });
  } catch (err) {
    console.warn('Could not load importMappings collection, starting with memory cache:', err);
  }
  return MAPPINGS_CACHE;
}

/**
 * Get approved mappings for a specific domain
 */
export function getDomainApprovedMappings(domain: string): Record<string, string> {
  return MAPPINGS_CACHE[domain] || {};
}

/**
 * Save a batch of approved human mapping decisions to Firestore
 */
export async function saveApprovedMappingBatch(
  mappings: Array<{
    domain: string;
    originalValue: string;
    mappedEntityId: string;
    mappedEntityName: string;
    mappedEntityCode?: string;
    confidence: number;
    matchType: string;
  }>
): Promise<void> {
  if (!mappings || mappings.length === 0) return;

  const currentUid = auth.currentUser?.uid || 'SUPER_ADMIN';
  const currentEmail = auth.currentUser?.email || 'مشرف الاستيراد';
  const nowIso = new Date().toISOString();

  const batch = writeBatch(db);

  mappings.forEach((m) => {
    const norm = normalizeArabicForComparison(m.originalValue);
    if (!norm) return;

    // Update in-memory cache
    if (!MAPPINGS_CACHE[m.domain]) {
      MAPPINGS_CACHE[m.domain] = {};
    }
    MAPPINGS_CACHE[m.domain][norm] = m.mappedEntityId;

    // Persist in Firestore
    const docKey = `${m.domain}_${norm.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '_')}`.substring(0, 120);
    const docRef = doc(db, 'importMappings', docKey);

    batch.set(docRef, {
      domain: m.domain,
      originalValue: m.originalValue,
      normalizedOriginalValue: norm,
      mappedEntityId: m.mappedEntityId,
      mappedEntityName: m.mappedEntityName,
      mappedEntityCode: m.mappedEntityCode || '',
      confidence: m.confidence,
      matchType: m.matchType,
      approvedBy: currentUid,
      approvedByName: currentEmail,
      approvedAt: nowIso,
      serverUpdatedAt: serverTimestamp(),
    }, { merge: true });
  });

  try {
    await batch.commit();
  } catch (err) {
    console.warn('Could not persist approved mappings to Firestore:', err);
  }
}

/**
 * Log complete historical import execution audit trail
 */
export async function logHistoricalImportExecution(entry: ImportAuditEntry): Promise<void> {
  try {
    const docRef = doc(db, 'importAuditTrail', entry.importBatchId);
    await setDoc(docRef, {
      ...entry,
      serverCreatedAt: serverTimestamp(),
    });

    await logAuditAction(
      'HISTORICAL_IMPORT_COMPLETED',
      'production',
      entry.importBatchId,
      `استيراد تاريخي: ملف "${entry.fileName}" لمرحلة ${entry.stage} - تم استيراد ${entry.importedCount} سجل، ${entry.approvedMappingsCount} مطابقة ذكية معتمدة.`
    );
  } catch (err) {
    console.warn('Could not log historical import audit entry:', err);
  }
}

/**
 * Rollback / Undo an entire historical import batch by importBatchId
 * Deletes all production documents that were generated in this specific batch.
 */
export async function rollbackImportBatch(
  importBatchId: string,
  stage: string = 'pressing'
): Promise<{ deletedCount: number }> {
  if (!importBatchId) throw new Error('يرجى تحديد رقم دفعة الاستيراد (Import Batch ID).');

  const collectionName = stage === 'pressing' ? 'production' : `stage_${stage}`;
  const q = query(collection(db, collectionName), where('importBatchId', '==', importBatchId));
  const snap = await getDocs(q);

  if (snap.empty) {
    return { deletedCount: 0 };
  }

  const batchSize = 400;
  const docs = snap.docs;
  let deletedCount = 0;

  for (let i = 0; i < docs.length; i += batchSize) {
    const chunk = docs.slice(i, i + batchSize);
    const writeB = writeBatch(db);
    chunk.forEach((d) => writeB.delete(d.ref));
    await writeB.commit();
    deletedCount += chunk.length;
  }

  await logAuditAction(
    'UNDO_HISTORICAL_IMPORT',
    collectionName,
    importBatchId,
    `تراجع عن استيراد: حذف ${deletedCount} سجل من دفعة الاستيراد (${importBatchId})`
  );

  return { deletedCount };
}

export interface ImportHistoryLoadResult {
  entries: ImportAuditEntry[];
  /** Set when the rich importAuditTrail source could not be read (today: PERMISSION_DENIED - it has no firestore.rules entry). Surfaced so the UI never renders a permission failure as a benign "nothing here yet". */
  auditTrailError?: string;
  /** Set when the readable auditLogs fallback source could not be read. */
  auditLogError?: string;
}

/**
 * ROOT-CAUSE FIX for the permanently-empty Import History screen.
 *
 * The rich `importAuditTrail` store this used to read exclusively has no
 * rule in firestore.rules, whose helper section ends in an explicit
 * `match /{document=**} { allow read, write: if false; }` default-deny - so
 * BOTH logHistoricalImportExecution()'s writes AND this function's reads
 * have always been PERMISSION_DENIED, each silently swallowed into a
 * `console.warn` / an empty array. The screen therefore showed "no
 * historical import operations recorded yet" for every module, forever,
 * even though real imports had run.
 *
 * Two changes, neither of which needs a rules or index deployment:
 *   1. The error is no longer swallowed - it is returned so the UI can say
 *      what actually went wrong.
 *   2. A SECOND, genuinely readable source is merged in: the `auditLogs`
 *      collection (`allow read: if isSignedIn()`), where both Pressing and
 *      Chinese Mills already write a BULK_IMPORT entry whose `documentId`
 *      IS the ImportId. See importHistoryPure.ts for the derivation, which
 *      never invents a field that was not actually recorded.
 *
 * Both queries are bounded and metadata-only (§27): one small
 * one-doc-per-import collection, plus a `limit()`-capped auditLogs read -
 * never a scan of any production records collection.
 */
export async function loadHistoricalImportOperations(maxCount = 300): Promise<ImportHistoryLoadResult> {
  let auditTrailError: string | undefined;
  let auditLogError: string | undefined;

  let trailEntries: ImportAuditEntry[] = [];
  try {
    const snap = await getDocs(collection(db, 'importAuditTrail'));
    trailEntries = snap.docs.map((d) => d.data() as ImportAuditEntry);
  } catch (err: any) {
    auditTrailError = err?.code || err?.message || 'unknown-error';
    console.warn('Could not load importAuditTrail history:', err);
  }

  let logEntries: ImportAuditEntry[] = [];
  try {
    // Preferred: server-side ordered + capped. Falls back to an
    // equality-only query if the composite index does not exist, since
    // deploying Firestore indexes is out of scope here.
    let snap;
    try {
      snap = await getDocs(query(collection(db, 'auditLogs'), where('action', '==', 'BULK_IMPORT'), orderBy('timestamp', 'desc'), limit(maxCount)));
    } catch {
      snap = await getDocs(query(collection(db, 'auditLogs'), where('action', '==', 'BULK_IMPORT'), limit(maxCount)));
    }
    logEntries = snap.docs
      .map((d) => importHistoryEntryFromAuditLog({ id: d.id, ...(d.data() as any) }))
      .filter((e): e is NonNullable<typeof e> => e !== null) as ImportAuditEntry[];
  } catch (err: any) {
    auditLogError = err?.code || err?.message || 'unknown-error';
    console.warn('Could not load auditLogs-derived import history:', err);
  }

  return {
    entries: mergeImportHistorySources(trailEntries as any, logEntries as any) as ImportAuditEntry[],
    auditTrailError,
    auditLogError,
  };
}

/**
 * Back-compatible wrapper - existing callers (DataImportView.tsx's shared
 * Import History modal, used by Pressing/Mills/every stage) keep working
 * unchanged and now receive the merged, actually-populated list.
 */
export async function getHistoricalImportHistory(): Promise<ImportAuditEntry[]> {
  const { entries } = await loadHistoricalImportOperations();
  return entries;
}

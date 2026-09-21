/**
 * Central Firestore persistence for user-approved analytics suggestions
 * from the Suggested Analytics screen (Universal Data Intelligence pass,
 * Parts 18-21; Approved Analytics Central Persistence Fix).
 *
 * Fix note: this previously used localStorage (a per-browser store), which
 * did not satisfy "an approved derived metric becomes part of the
 * system/database" - an approval made on one device was invisible on any
 * other device/session. Now backed by the `approvedAnalytics` Firestore
 * collection, using the EXACT SAME service pattern every other Master-Data-
 * style collection in this app already uses (masterDataService.ts's
 * safeAddDoc/safeUpdateDoc/handleFirestoreError) - no second database
 * abstraction.
 *
 * Part 19/38 (unchanged) - this NEVER duplicates raw production data. It
 * stores only the METRIC DEFINITION reference (metric key + optional
 * dimension + stage + scope) plus provenance (Part 20/3) - the actual
 * numbers are always recomputed on demand from live data via
 * analyticsDiscoveryEngine.ts / dashboardRegistry.ts's METRIC_REGISTRY
 * (Part 4/21), so an approved entry can never go stale or diverge from what
 * the rest of the app shows, and a write failure here can never be
 * mistaken for a real save (Part 10/11 - success is only ever reported
 * after the Firestore write actually resolves).
 */
import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, where, orderBy, serverTimestamp } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../config/firebase';
import { safeAddDoc, safeUpdateDoc } from '../utils/firestoreSanitizer';
import { MetricKey, EntityType } from './dashboardRegistry';
import { ProductionStageType } from '../types';
import { logAuditAction } from './auditService';

const COLLECTION_NAME = 'approvedAnalytics';

export interface ApprovedAnalyticsEntry {
  id: string;
  /** Provenance (Part 20/3) - never invented, always the real registered definition this approval points at. */
  metricId: MetricKey;
  entityType?: EntityType;
  stage: ProductionStageType | 'all';
  scope: string;
  /** What this metric is actually computed from - always UniversalStageRecord, the one shared source every METRIC_REGISTRY entry reads (never a fabricated source list). */
  sourceEntities: string[];
  titleAr: string;
  titleEn: string;
  formulaAr: string;
  formulaEn: string;
  status: 'ACTIVE';
  /** Recomputation is always dynamic (Part 4/21); this is only a UI/provenance hint of the definition shape, not a version pin on a stored value. */
  definitionVersion: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

type ApproveInput = Pick<ApprovedAnalyticsEntry, 'metricId' | 'entityType' | 'stage' | 'scope' | 'titleAr' | 'titleEn' | 'formulaAr' | 'formulaEn'>;

function docToEntry(id: string, data: any): ApprovedAnalyticsEntry {
  return {
    id,
    metricId: data.metricId,
    entityType: data.entityType || undefined,
    stage: data.stage,
    scope: data.scope || '',
    sourceEntities: Array.isArray(data.sourceEntities) ? data.sourceEntities : ['UniversalStageRecord'],
    titleAr: data.titleAr || '',
    titleEn: data.titleEn || '',
    formulaAr: data.formulaAr || '',
    formulaEn: data.formulaEn || '',
    status: 'ACTIVE',
    definitionVersion: data.definitionVersion || 1,
    createdBy: data.createdBy || '',
    createdAt: data.createdAt || '',
    updatedAt: data.updatedAt || data.createdAt || '',
  };
}

/**
 * Central, cross-device, cross-user list (Part 8) - any signed-in user who
 * can reach the Suggested Analytics screen (already gated by the existing
 * `reports.view`-backed page permission, see permissions.ts's 'data-quality'
 * case) can read the shared approved set, matching the read-open/write-
 * gated convention every comparable shared-config collection in this app
 * already uses (aiProviderConfig, system_settings, translationOverrides).
 */
export async function listApprovedAnalytics(): Promise<ApprovedAnalyticsEntry[]> {
  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => docToEntry(d.id, d.data()));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, COLLECTION_NAME);
  }
}

/**
 * Part 12 - if the SAME metric+dimension+stage is already approved, this
 * updates that existing document (bumping updatedAt/provenance) instead of
 * creating a duplicate business definition. A client-side equality query on
 * metricId+stage (both single-value `where`s, auto-indexed - no composite
 * index setup needed) then an in-memory entityType comparison, mirroring
 * auditService.ts's fetchAuditLogsForDocument()'s identical "avoid a
 * composite-index requirement" approach.
 */
async function findExistingDefinition(input: ApproveInput): Promise<string | undefined> {
  const q = query(collection(db, COLLECTION_NAME), where('metricId', '==', input.metricId), where('stage', '==', input.stage));
  const snapshot = await getDocs(q);
  const match = snapshot.docs.find((d) => (d.data().entityType || undefined) === (input.entityType || undefined));
  return match?.id;
}

/**
 * Part 18 - "تنفيذ" (Approve). Only ever called on explicit user action,
 * never automatically (Part 37). Throws on failure - the caller (the
 * Suggested Analytics screen) is responsible for catching this and showing
 * the safe "تعذر حفظ المؤشر مركزيًا" message (Part 10/11) rather than ever
 * reporting success before the Firestore write actually resolves.
 */
export async function approveAnalyticsSuggestion(input: ApproveInput): Promise<ApprovedAnalyticsEntry> {
  const now = new Date().toISOString();
  const createdBy = auth.currentUser?.email || '';
  const existingId = await findExistingDefinition(input);

  if (existingId) {
    const payload = {
      scope: input.scope,
      titleAr: input.titleAr, titleEn: input.titleEn,
      formulaAr: input.formulaAr, formulaEn: input.formulaEn,
      updatedAt: now,
      serverUpdatedAt: serverTimestamp(),
    };
    try {
      await safeUpdateDoc(doc(db, COLLECTION_NAME, existingId), payload);
      await logAuditAction('UPDATE', COLLECTION_NAME, existingId, `تحديث مؤشر معتمد: "${input.titleAr}"`);
      return docToEntry(existingId, { ...input, sourceEntities: ['UniversalStageRecord'], definitionVersion: 1, createdBy, createdAt: now, updatedAt: now });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, COLLECTION_NAME);
    }
  }

  const payload = {
    metricId: input.metricId,
    entityType: input.entityType || null,
    stage: input.stage,
    scope: input.scope,
    sourceEntities: ['UniversalStageRecord'],
    titleAr: input.titleAr, titleEn: input.titleEn,
    formulaAr: input.formulaAr, formulaEn: input.formulaEn,
    status: 'ACTIVE' as const,
    definitionVersion: 1,
    createdBy,
    createdAt: now,
    updatedAt: now,
    serverCreatedAt: serverTimestamp(),
    serverUpdatedAt: serverTimestamp(),
  };
  try {
    const docRef = await safeAddDoc(collection(db, COLLECTION_NAME), payload);
    await logAuditAction('CREATE', COLLECTION_NAME, docRef.id, `اعتماد مؤشر مقترح: "${input.titleAr}"`);
    return docToEntry(docRef.id, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, COLLECTION_NAME);
  }
}

/** Part 18 - "تجاهل"/"تأجيل" never persist anything (discovery always recomputes fresh - Part 37), so there is nothing to remove for those. This only ever runs on an explicit "إزالة" of an ALREADY-approved entry. */
export async function removeApprovedAnalytics(id: string, titleAr?: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    await logAuditAction('DELETE', COLLECTION_NAME, id, `إزالة مؤشر معتمد: "${titleAr || id}"`);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, COLLECTION_NAME);
  }
}

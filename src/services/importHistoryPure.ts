/**
 * Historical Import History - source-merging & derivation logic ONLY.
 *
 * Deliberately Firebase-free (no import of ../config/firebase or anything
 * that transitively pulls it in) so this is unit-testable with plain
 * in-memory fixtures via `npx tsx` - see scripts/tests/.
 *
 * ROOT CAUSE THIS MODULE EXISTS FOR
 * ---------------------------------
 * The Import History screen was permanently empty for EVERY module. The
 * `importAuditTrail` collection - the rich, one-doc-per-import metadata
 * store that logHistoricalImportExecution() writes and
 * getHistoricalImportHistory() reads - has NO rule in firestore.rules, and
 * that file ends its helper section with an explicit
 * `match /{document=**} { allow read, write: if false; }` default-deny.
 * Firestore denies any collection with no matching allow rule, so:
 *
 *   - every logHistoricalImportExecution() write was PERMISSION_DENIED and
 *     silently swallowed by its own `try/catch { console.warn }`, so the
 *     collection was never populated for Pressing OR Chinese Mills; and
 *   - every getHistoricalImportHistory() read was PERMISSION_DENIED and
 *     silently swallowed by `catch { return [] }`, rendering as the benign
 *     "no historical import operations recorded yet" empty state instead of
 *     an error.
 *
 * The `auditLogs` collection, by contrast, IS readable (`allow read: if
 * isSignedIn()`), and both Pressing and Chinese Mills separately write a
 * BULK_IMPORT audit entry whose `documentId` IS the ImportId. That gives a
 * real, already-persisted, readable second source for the history list that
 * needs no rules deployment - which is what this module reconstructs.
 *
 * Nothing here invents data (§3): a field that was never recorded stays
 * `undefined` so the UI can render it as "not recorded", and the original
 * recorded sentence is always carried through verbatim as `rawDetails`.
 */

export type ImportHistorySource = 'AUDIT_TRAIL' | 'AUDIT_LOG';

/** The subset of an auditLogs document this module needs. Mirrors auditService.ts's logAuditAction payload. */
export interface AuditLogLike {
  id?: string;
  action?: string;
  collection?: string;
  documentId?: string;
  username?: string;
  userId?: string;
  details?: string;
  timestamp?: string;
}

/** The subset of an importAuditTrail document / ImportAuditEntry this module needs (kept structural to stay Firebase-free). */
export interface ImportHistoryEntryLike {
  importBatchId: string;
  stage: string;
  fileName?: string;
  totalRows?: number;
  importedCount?: number;
  failedCount?: number;
  skippedCount?: number;
  cancelledCount?: number;
  remainingCount?: number;
  selectedCount?: number;
  approvedCount?: number;
  correctedCount?: number;
  warningCount?: number;
  blockingCount?: number;
  approvedMappingsCount?: number;
  performedBy?: string;
  performedByName?: string;
  performedAt?: string;
  backupId?: string;
  metadataSource?: ImportHistorySource;
  rawDetails?: string;
}

/**
 * Maps an auditLogs `collection` value back to the historical-import stage
 * key the History UI groups by. 'production' is Pressing's collection (see
 * pressingHistoricalImportService.ts's logAuditAction call); every other
 * stage writes to `stage_<key>` (see CHINESE_MILLS_COLLECTION =
 * 'stage_chinese_mills'). Returns null when the collection is not a
 * historical-import target at all.
 */
export function stageFromAuditCollection(collectionName: string | undefined): string | null {
  if (!collectionName) return null;
  if (collectionName === 'production') return 'pressing';
  if (collectionName.startsWith('stage_')) return collectionName.slice('stage_'.length) || null;
  return null;
}

/**
 * Whether an auditLogs entry represents a COMPLETED historical import
 * operation (as opposed to one of the many per-row/lifecycle BULK_IMPORT
 * entries this app also writes). Two discriminators, both structural:
 *   - it must carry a non-empty `documentId` - the ImportId (the
 *     lifecycle entries pass `undefined`, which logAuditAction stores as ''); and
 *   - its `details` must NOT start with '[' - the established bracketed-tag
 *     convention for lifecycle events ([ROW_IMPORT_STARTED],
 *     [IMPORT_CANCELLED], [BULK_APPROVAL], [BULK_READY_TO_IMPORT], ...).
 */
export function isCompletedImportAuditLog(log: AuditLogLike): boolean {
  if (log.action !== 'BULK_IMPORT') return false;
  if (!log.documentId || !log.documentId.trim()) return false;
  if ((log.details || '').trimStart().startsWith('[')) return false;
  return stageFromAuditCollection(log.collection) !== null;
}

/**
 * Strictly-anchored count extraction from the two REAL recorded audit
 * sentences. Deliberately conservative (§3): a pattern that does not match
 * exactly yields `undefined` for that count rather than a guessed number,
 * and the untouched original sentence is always preserved separately as
 * `rawDetails` so the user still sees the real recorded wording.
 */
export function extractCountsFromAuditDetails(details: string | undefined): {
  importedCount?: number;
  totalRows?: number;
  skippedCount?: number;
  failedCount?: number;
  cancelledCount?: number;
} {
  const text = (details || '').trim();
  if (!text) return {};

  // Chinese Mills, cancelled variant:
  // "استيراد تاريخي للطواحين الصينية (أُلغي جزئيًا): N سجل بنجاح، C أُلغي قبل التنفيذ، من أصل T"
  const cmCancelled = text.match(/:\s*(\d+)\s*سجل بنجاح،\s*(\d+)\s*أُلغي قبل التنفيذ،\s*من أصل\s*(\d+)/);
  if (cmCancelled) {
    return {
      importedCount: Number(cmCancelled[1]),
      cancelledCount: Number(cmCancelled[2]),
      totalRows: Number(cmCancelled[3]),
    };
  }

  // Chinese Mills, normal variant:
  // "استيراد تاريخي للطواحين الصينية: N سجل بنجاح من أصل T"
  const cmNormal = text.match(/:\s*(\d+)\s*سجل بنجاح من أصل\s*(\d+)/);
  if (cmNormal) {
    return { importedCount: Number(cmNormal[1]), totalRows: Number(cmNormal[2]) };
  }

  // Pressing:
  // "... تم استيراد N سجل بنجاح، وتخطي S سجل، وفشل F سجل."
  const pressing = text.match(/تم استيراد\s*(\d+)\s*سجل بنجاح،\s*وتخطي\s*(\d+)\s*سجل،\s*وفشل\s*(\d+)\s*سجل/);
  if (pressing) {
    return {
      importedCount: Number(pressing[1]),
      skippedCount: Number(pressing[2]),
      failedCount: Number(pressing[3]),
    };
  }

  return {};
}

/** Reconstructs one history entry from a readable auditLogs BULK_IMPORT record. Only structurally-certain fields are populated; everything else stays undefined ("not recorded"). */
export function importHistoryEntryFromAuditLog(log: AuditLogLike): ImportHistoryEntryLike | null {
  if (!isCompletedImportAuditLog(log)) return null;
  const stage = stageFromAuditCollection(log.collection);
  if (!stage) return null;
  const counts = extractCountsFromAuditDetails(log.details);
  return {
    importBatchId: (log.documentId || '').trim(),
    stage,
    performedByName: log.username,
    performedBy: log.userId,
    performedAt: log.timestamp,
    metadataSource: 'AUDIT_LOG',
    rawDetails: log.details,
    ...counts,
  };
}

/**
 * Merges the rich importAuditTrail entries with the auditLogs-derived ones,
 * keyed by ImportId. An authoritative AUDIT_TRAIL entry always wins over a
 * reconstructed AUDIT_LOG one for the same ImportId (never merged
 * field-by-field, so a partially-parsed sentence can never overwrite a real
 * recorded value). Sorted newest-first by performedAt.
 */
export function mergeImportHistorySources(
  auditTrailEntries: ImportHistoryEntryLike[],
  auditLogEntries: ImportHistoryEntryLike[]
): ImportHistoryEntryLike[] {
  const byId = new Map<string, ImportHistoryEntryLike>();
  for (const e of auditLogEntries) {
    if (e.importBatchId) byId.set(e.importBatchId, { ...e, metadataSource: 'AUDIT_LOG' });
  }
  for (const e of auditTrailEntries) {
    if (e.importBatchId) byId.set(e.importBatchId, { ...e, metadataSource: 'AUDIT_TRAIL' });
  }
  return Array.from(byId.values()).sort((a, b) => (b.performedAt || '').localeCompare(a.performedAt || ''));
}

/**
 * §5/§7 Final Status, derived ONLY from actually-recorded counts - never a
 * stored or invented value. Returns 'UNKNOWN' when the underlying counts
 * were never recorded, rather than defaulting to a flattering COMPLETED.
 */
export function deriveImportFinalStatus(entry: ImportHistoryEntryLike): 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED' | 'UNKNOWN' {
  const imported = entry.importedCount;
  if (imported === undefined) return 'UNKNOWN';
  const failed = entry.failedCount || 0;
  const cancelled = entry.cancelledCount || 0;
  if (failed === 0 && cancelled === 0) return 'COMPLETED';
  if (imported === 0) return 'FAILED';
  return 'PARTIALLY_COMPLETED';
}

/** §26: client-side filtering over the already-fetched, bounded list - never a new Firestore query per filter change. */
export function filterImportHistory(
  entries: ImportHistoryEntryLike[],
  filters: { stage?: string; dateFrom?: string; dateTo?: string; importId?: string; user?: string }
): ImportHistoryEntryLike[] {
  return entries.filter((e) => {
    if (filters.stage && filters.stage !== 'ALL' && e.stage !== filters.stage) return false;
    const day = (e.performedAt || '').slice(0, 10);
    if (filters.dateFrom && day < filters.dateFrom) return false;
    if (filters.dateTo && day > filters.dateTo) return false;
    if (filters.importId && !e.importBatchId.toLowerCase().includes(filters.importId.toLowerCase())) return false;
    if (filters.user && !((e.performedByName || '').toLowerCase().includes(filters.user.toLowerCase()))) return false;
    return true;
  });
}

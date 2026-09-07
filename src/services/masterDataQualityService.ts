/**
 * Master Data Quality Report - safe delete/archive/restore orchestration.
 *
 * The read-only analyzers (detectDuplicateCodes, detectDuplicateNames,
 * detectSimilarNames, analyzeCodeSequence, detectInvalidCodes,
 * detectMissingRequiredFields, runMasterDataQualityScan, and all related
 * types/constants) now live in masterDataQualityAnalyzers.ts, which is
 * deliberately Firebase-free so they can be unit-tested in isolation (see
 * scripts/tests/). Everything is re-exported here so existing imports
 * (`from '../../services/masterDataQualityService'`) are unaffected.
 *
 * This file only adds (a) the reference-safety check in front of a hard
 * delete, and (b) a richer supplementary audit entry - it REUSES the
 * existing masterDataService/productTypeService mutation functions
 * (deleteMasterDataItem, toggleMasterDataActive, toggleProductTypeActive)
 * rather than duplicating their Firestore logic. Nothing here auto-deletes
 * or auto-merges records; every action requires explicit selection +
 * confirmation from the caller.
 */
import {
  MASTER_DATA_COLLECTIONS,
  deleteMasterDataItem,
  toggleMasterDataActive,
} from './masterDataService';
import { toggleProductTypeActive } from './productTypeService';
import { logAuditAction } from './auditService';
import { MasterDataTab } from '../types';
import {
  extractCodeAndName,
  HARD_DELETE_UNSUPPORTED,
} from './masterDataQualityAnalyzers';

export type {
  QualityIssueType,
  QualitySeverity,
  QualityIssue,
  ScanCompleteness,
  QualityReportSummary,
} from './masterDataQualityAnalyzers';

export {
  QUALITY_SCANNED_TYPES,
  SIMILAR_NAME_SCAN_MAX_ITEMS,
  PRODUCTION_DEPENDENT_ENTITY_TYPES,
  HARD_DELETE_UNSUPPORTED,
  extractCodeAndName,
  detectMissingRequiredFields,
  detectInvalidCodes,
  detectDuplicateCodes,
  detectDuplicateNames,
  detectSimilarNames,
  analyzeCodeSequence,
  computeReferenceCounts,
  getReferenceCount,
  runMasterDataQualityScan,
} from './masterDataQualityAnalyzers';

// ============================================================================
// Safe delete / archive / restore orchestration - REUSES the existing
// masterDataService/productTypeService mutation functions (which already log
// a basic audit entry each); this layer only (a) enforces the reference-safety
// check in front of a hard delete, and (b) adds ONE supplementary richer
// audit entry with the fields the Quality Report needs (reason, referenceCount,
// previousStatus) that the base functions don't capture.
// ============================================================================

async function logQualityAudit(
  action: 'DELETE' | 'DEACTIVATE' | 'ACTIVATE',
  entityType: MasterDataTab,
  documentId: string,
  code: string,
  name: string,
  reason: string,
  referenceCount: number,
  previousStatus: string
) {
  await logAuditAction(
    action,
    MASTER_DATA_COLLECTIONS[entityType],
    documentId,
    `[تقرير جودة البيانات الأساسية] الكود: ${code || '-'} - الاسم: ${name || '-'} - السبب: ${reason} - عدد الإشارات المرجعية: ${referenceCount} - الحالة السابقة: ${previousStatus}`
  ).catch(() => {});
}

export type SafeDeleteOutcome = 'DELETED' | 'ARCHIVED' | 'BLOCKED';

/**
 * §27 - never hard-deletes a record referenced by production data. §28 - for
 * productTypes, hard delete isn't supported anywhere in this app (mirrors
 * MasterDataView's own delete handler), so it always archives instead.
 */
export async function safeDeleteMasterDataRecord(
  entityType: MasterDataTab,
  item: any,
  referenceCount: number,
  reason: string,
  referenceCountUnknown = false
): Promise<SafeDeleteOutcome> {
  const { code, name } = extractCodeAndName(entityType, item);

  if (HARD_DELETE_UNSUPPORTED.includes(entityType)) {
    await toggleProductTypeActive(item.id, true, item.prefixCode);
    await logQualityAudit('DEACTIVATE', entityType, item.id, code, name, reason, referenceCount, item.active !== false ? 'active' : 'inactive');
    return 'ARCHIVED';
  }

  // §5 - an unverified reference count (production history not fetched for
  // size safety) is never treated as "0 references, safe to delete."
  if (referenceCount > 0 || referenceCountUnknown) {
    return 'BLOCKED';
  }

  await deleteMasterDataItem(MASTER_DATA_COLLECTIONS[entityType], item.id, code);
  await logQualityAudit('DELETE', entityType, item.id, code, name, reason, referenceCount, item.active !== false ? 'active' : 'inactive');
  return 'DELETED';
}

/** §28 - soft delete/archive fallback, used directly when the caller already knows the record is referenced. */
export async function archiveMasterDataRecord(entityType: MasterDataTab, item: any, reason: string, referenceCount: number): Promise<void> {
  const { code, name } = extractCodeAndName(entityType, item);
  if (entityType === 'productTypes') {
    await toggleProductTypeActive(item.id, true, item.prefixCode);
  } else {
    await toggleMasterDataActive(MASTER_DATA_COLLECTIONS[entityType], item.id, true);
  }
  await logQualityAudit('DEACTIVATE', entityType, item.id, code, name, reason, referenceCount, 'active');
}

/** §30 - restore only applies to archived/deactivated records; hard-deleted records are never claimed recoverable. */
export async function restoreMasterDataRecord(entityType: MasterDataTab, item: any): Promise<void> {
  const { code, name } = extractCodeAndName(entityType, item);
  if (entityType === 'productTypes') {
    await toggleProductTypeActive(item.id, false, item.prefixCode);
  } else {
    await toggleMasterDataActive(MASTER_DATA_COLLECTIONS[entityType], item.id, false);
  }
  await logQualityAudit('ACTIVATE', entityType, item.id, code, name, 'استعادة من تقرير جودة البيانات', 0, 'inactive');
}

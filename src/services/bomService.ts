/**
 * BOM version writes - Phase 1 Step 2.
 *
 * Adds no write path of its own: every write goes through the shared
 * createMasterDataItem / updateMasterDataItem (sanitised write, cache
 * invalidation, audit entry), exactly like any Master Data record. What this
 * file adds is the validation in front of each write and a descriptive audit
 * line after it - the same "[TAG] details" pattern the historical import panels
 * already log - naming the version, the status change and the component lines
 * added, removed or edited.
 *
 * BOM headers (`boms`) are saved by the Master Data tab engine; this file is
 * only for `bomVersions`. Nothing here deletes anything, reads production, or
 * touches products, materials, jobs or batches.
 */
import { createMasterDataItem, fetchMasterData, updateMasterDataItem } from './masterDataService';
import { logAuditAction } from './auditService';
import {
  BOM_VERSION_COLLECTION,
  BomVersionContext,
  bomVersionPayloadForSave,
  describeBomVersionChange,
  validateBomVersionForSave,
  validateBomVersionTransition,
} from './bomPure';

type Stored = Record<string, any> & { id?: string };

function refuse(issues: Array<{ messageAr: string; messageEn: string }>, language: 'ar' | 'en'): never {
  throw new Error(issues.map((i) => (language === 'ar' ? i.messageAr : i.messageEn)).join(' | '));
}

/** The stored versions of one BOM, cache-first like every Master Data read. */
export async function listBomVersions(bomId: string, options?: { skipCache?: boolean }): Promise<Stored[]> {
  const all = await fetchMasterData<Stored>(BOM_VERSION_COLLECTION, options);
  return all.filter((v) => v.bomId === bomId);
}

/** Creates a DRAFT (or any valid) version after full validation. Returns the new document id. */
export async function createBomVersion(
  versionsOfBom: readonly Stored[],
  draft: Record<string, unknown>,
  context: BomVersionContext,
  language: 'ar' | 'en',
): Promise<string | undefined> {
  const check = validateBomVersionForSave(versionsOfBom, draft, { ...context, editingId: null });
  if (!check.valid) refuse(check.issues, language);
  const payload = bomVersionPayloadForSave(draft);
  const id = await createMasterDataItem(BOM_VERSION_COLLECTION, payload);
  logAuditAction('CREATE', BOM_VERSION_COLLECTION, id, describeBomVersionChange(null, payload)).catch(() => {});
  return id;
}

/** Saves a draft's header and components. Only a DRAFT may be edited, and its status is kept. */
export async function saveBomVersionDraft(
  versionsOfBom: readonly Stored[],
  stored: Stored,
  draft: Record<string, unknown>,
  context: BomVersionContext,
  language: 'ar' | 'en',
): Promise<void> {
  if (String(stored.status).toUpperCase() !== 'DRAFT') {
    throw new Error(language === 'ar' ? 'يمكن تعديل الإصدارات في حالة المسودة فقط.' : 'Only draft versions can be edited.');
  }
  const next = { ...draft, bomId: stored.bomId, status: 'DRAFT' };
  const check = validateBomVersionForSave(versionsOfBom, next, { ...context, editingId: String(stored.id) });
  if (!check.valid) refuse(check.issues, language);
  const payload = bomVersionPayloadForSave(next);
  await updateMasterDataItem(BOM_VERSION_COLLECTION, String(stored.id), payload);
  logAuditAction('UPDATE', BOM_VERSION_COLLECTION, String(stored.id), describeBomVersionChange(stored, payload)).catch(() => {});
}

/** Activates or retires a version after the lifecycle check. Writes the status only. */
export async function transitionBomVersion(
  versionsOfBom: readonly Stored[],
  stored: Stored,
  next: 'ACTIVE' | 'RETIRED',
  context: BomVersionContext,
  language: 'ar' | 'en',
): Promise<void> {
  const check = validateBomVersionTransition(versionsOfBom, stored, next, context);
  if (!check.valid) refuse(check.issues, language);
  await updateMasterDataItem(BOM_VERSION_COLLECTION, String(stored.id), { status: next });
  logAuditAction(next === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE', BOM_VERSION_COLLECTION, String(stored.id), describeBomVersionChange(stored, { ...stored, status: next })).catch(() => {});
}

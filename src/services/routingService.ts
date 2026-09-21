/**
 * Routing version writes - Phase 1 Step 3.
 *
 * The same shape as bomService: no write path of its own. Every write goes
 * through the shared createMasterDataItem / updateMasterDataItem (sanitised
 * write, cache invalidation, audit entry), with validation in front and a
 * descriptive audit line after - naming the version, whether it was copied,
 * the status change, and the steps added, removed, reordered or changed.
 *
 * Routing headers (`routings`) are saved by the Master Data tab engine; this
 * file is only for `routingVersions`. Nothing is deleted, and nothing here
 * reads or writes production, jobs, batches, BOMs, equipment or cost centres.
 */
import { createMasterDataItem, fetchMasterData, updateMasterDataItem } from './masterDataService';
import { logAuditAction } from './auditService';
import {
  ROUTING_VERSION_COLLECTION,
  RoutingVersionContext,
  describeRoutingVersionChange,
  routingVersionPayloadForSave,
  validateRoutingVersionForSave,
  validateRoutingVersionTransition,
} from './routingPure';

type Stored = Record<string, any> & { id?: string };

function refuse(issues: Array<{ messageAr: string; messageEn: string }>, language: 'ar' | 'en'): never {
  throw new Error(issues.map((i) => (language === 'ar' ? i.messageAr : i.messageEn)).join(' | '));
}

function requireEditor(canEdit: boolean, language: 'ar' | 'en'): void {
  if (!canEdit) throw new Error(language === 'ar' ? 'لا تملك صلاحية تعديل البيانات الأساسية.' : 'You do not have permission to edit Master Data.');
}

/** The stored versions of one routing, cache-first like every Master Data read. */
export async function listRoutingVersions(routingId: string, options?: { skipCache?: boolean }): Promise<Stored[]> {
  const all = await fetchMasterData<Stored>(ROUTING_VERSION_COLLECTION, options);
  return all.filter((v) => v.routingId === routingId);
}

/** Creates a DRAFT version (empty or copied) after full validation. Returns the new document id. */
export async function createRoutingVersion(
  versionsOfRouting: readonly Stored[],
  draft: Record<string, unknown>,
  context: RoutingVersionContext,
  options: { canEdit: boolean; language: 'ar' | 'en'; copiedFrom?: string | null },
): Promise<string | undefined> {
  requireEditor(options.canEdit, options.language);
  const check = validateRoutingVersionForSave(versionsOfRouting, { ...draft, status: 'DRAFT' }, { ...context, editingId: null });
  if (!check.valid) refuse(check.issues, options.language);
  const payload = routingVersionPayloadForSave({ ...draft, status: 'DRAFT' });
  const id = await createMasterDataItem(ROUTING_VERSION_COLLECTION, payload);
  logAuditAction('CREATE', ROUTING_VERSION_COLLECTION, id, describeRoutingVersionChange(null, payload, options.copiedFrom ?? null)).catch(() => {});
  return id;
}

/** Saves a draft's header and steps. Only a DRAFT may be edited, and its status is kept. */
export async function saveRoutingVersionDraft(
  versionsOfRouting: readonly Stored[],
  stored: Stored,
  draft: Record<string, unknown>,
  context: RoutingVersionContext,
  options: { canEdit: boolean; language: 'ar' | 'en' },
): Promise<void> {
  requireEditor(options.canEdit, options.language);
  if (String(stored.status).toUpperCase() !== 'DRAFT') {
    throw new Error(options.language === 'ar' ? 'يمكن تعديل الإصدارات في حالة المسودة فقط.' : 'Only draft versions can be edited.');
  }
  const next = { ...draft, routingId: stored.routingId, status: 'DRAFT' };
  const check = validateRoutingVersionForSave(versionsOfRouting, next, { ...context, editingId: String(stored.id) });
  if (!check.valid) refuse(check.issues, options.language);
  const payload = routingVersionPayloadForSave(next);
  await updateMasterDataItem(ROUTING_VERSION_COLLECTION, String(stored.id), payload);
  logAuditAction('UPDATE', ROUTING_VERSION_COLLECTION, String(stored.id), describeRoutingVersionChange(stored, payload)).catch(() => {});
}

/** Activates or retires a version after the lifecycle check. Writes the status only. */
export async function transitionRoutingVersion(
  versionsOfRouting: readonly Stored[],
  stored: Stored,
  next: 'ACTIVE' | 'RETIRED',
  context: RoutingVersionContext,
  options: { canEdit: boolean; language: 'ar' | 'en' },
): Promise<void> {
  requireEditor(options.canEdit, options.language);
  const check = validateRoutingVersionTransition(versionsOfRouting, stored, next, context);
  if (!check.valid) refuse(check.issues, options.language);
  await updateMasterDataItem(ROUTING_VERSION_COLLECTION, String(stored.id), { status: next });
  logAuditAction(next === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE', ROUTING_VERSION_COLLECTION, String(stored.id), describeRoutingVersionChange(stored, { ...stored, status: next })).catch(() => {});
}

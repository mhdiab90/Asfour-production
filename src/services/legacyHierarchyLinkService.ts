/**
 * Applies the safe reconciliation links.
 *
 * The ONLY thing this file adds is the write loop. Which links are safe was
 * already decided by legacyHierarchyReconciliationPure - this never re-matches,
 * so there is no second chance for a different answer between the dry run the
 * user confirmed and the rows that actually get written.
 *
 * HOW IT WRITES.
 * Through `updateMasterDataItem`, the same path a manual Master Data edit uses,
 * so permission checks, validation, the audit entry and cache invalidation all
 * happen exactly as they already do. No raw Firestore call is made here.
 *
 * WHAT IT WRITES.
 * One field, `hierarchyNodeId`, on one legacy record per link. Never the
 * record's id, never its code, never a hierarchy node, and never a production
 * document - the relationship lives on master data precisely so that history
 * does not have to move.
 *
 * PARTIAL FAILURE IS EXPECTED, NOT EXCEPTIONAL.
 * Each link is applied on its own and its outcome recorded on its own. With 100
 * planned and 3 failing, the other 97 stay written and the 3 remain in the plan
 * next time. There is deliberately no batch and no rollback: undoing 97 correct
 * links because of 3 unrelated failures would be the worse outcome.
 *
 * IDEMPOTENT. A link already pointing at the planned node is skipped, so running
 * it twice writes nothing the second time.
 */
import { updateMasterDataItem, MASTER_DATA_COLLECTIONS } from './masterDataService';
import { SafeLink } from './legacyHierarchyReconciliationPure';

export interface LinkFailure {
  legacyId: string;
  code: string;
  categoryId: string;
  error: string;
  at: string;
}

export interface ApplyLinksOutcome {
  successCount: number;
  failedCount: number;
  skippedCount: number;
  applied: Array<{ legacyId: string; code: string; hierarchyNodeId: string }>;
  failed: LinkFailure[];
  /** Planned links that were already correct - counted, never rewritten. */
  skipped: Array<{ legacyId: string; code: string; reason: string }>;
  plannedCount: number;
}

/** Resolves a category id to the collection the shared service writes to. */
function collectionFor(categoryId: string): string | null {
  const collection = (MASTER_DATA_COLLECTIONS as Record<string, string>)[categoryId];
  return collection ?? null;
}

export interface ApplySafeLinksOptions {
  /**
   * The links' current stored values, so an already-correct row can be skipped
   * without a read. Keyed by legacy record id.
   */
  currentLinks?: Map<string, string | null | undefined>;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Writes the planned links, one record at a time.
 *
 * Sequential on purpose: these are a handful of master-data documents, and a
 * predictable order makes a partial failure easy to reason about and to retry.
 * Nothing is read per record - the plan already carries everything needed.
 */
export async function applySafeLinks(
  plan: readonly SafeLink[],
  options?: ApplySafeLinksOptions,
): Promise<ApplyLinksOutcome> {
  const applied: ApplyLinksOutcome['applied'] = [];
  const failed: LinkFailure[] = [];
  const skipped: ApplyLinksOutcome['skipped'] = [];

  let done = 0;
  for (const link of plan) {
    done += 1;
    try {
      // Idempotency: a row already pointing at the planned node is a no-op.
      const current = options?.currentLinks?.get(link.legacyId);
      if (current && String(current) === link.hierarchyNodeId) {
        skipped.push({ legacyId: link.legacyId, code: link.code, reason: 'already linked to this node' });
        continue;
      }

      const collection = collectionFor(link.categoryId);
      if (!collection) {
        failed.push({
          legacyId: link.legacyId,
          code: link.code,
          categoryId: link.categoryId,
          error: `no master-data collection is registered for category "${link.categoryId}"`,
          at: new Date().toISOString(),
        });
        continue;
      }

      // The shared audited update. One field, one document.
      await updateMasterDataItem(collection, link.legacyId, { hierarchyNodeId: link.hierarchyNodeId });
      applied.push({ legacyId: link.legacyId, code: link.code, hierarchyNodeId: link.hierarchyNodeId });
    } catch (error: any) {
      // One failure never stops the rest, and never undoes what already worked.
      failed.push({
        legacyId: link.legacyId,
        code: link.code,
        categoryId: link.categoryId,
        error: String(error?.message ?? error),
        at: new Date().toISOString(),
      });
    } finally {
      options?.onProgress?.(done, plan.length);
    }
  }

  return {
    successCount: applied.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    applied,
    failed,
    skipped,
    plannedCount: plan.length,
  };
}

/** Bilingual result line. The numbers reconcile against the planned count. */
export function describeApplyOutcome(outcome: ApplyLinksOutcome, language: 'ar' | 'en'): string {
  return language === 'ar'
    ? `تم الربط: ${outcome.successCount} — تم تخطيه: ${outcome.skippedCount} — فشل: ${outcome.failedCount} (من ${outcome.plannedCount} مخطط)`
    : `Linked: ${outcome.successCount} — skipped: ${outcome.skippedCount} — failed: ${outcome.failedCount} (of ${outcome.plannedCount} planned)`;
}

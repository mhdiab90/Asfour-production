/**
 * Production Records bulk delete - the plan and the execution loop.
 *
 * Pure and Firebase-free. The actual delete is INJECTED: the screen passes the
 * existing `deleteProductionRecord` primitive (productionService.ts), which
 * hard-deletes one `production` document and writes its audit entry. There is
 * no second delete service, no batch write and no deleteStageRecord - one
 * record, one call to the primitive that already exists.
 *
 * WHAT CAN BE DELETED. Only ids that are BOTH selected AND currently visible
 * under the screen's filters. The selection is already pruned to the visible
 * rows when filters change; intersecting again here means a stale id can never
 * slip into the batch even if that pruning had not yet run.
 *
 * THIS IS PERMANENT. There is no soft delete, undo, restore or backup in this
 * path, and nothing here pretends otherwise.
 */

export interface BulkDeletePlan {
  /** The exact execution batch - its length is the count the user confirms. */
  targetIds: string[];
  /** Selected ids that are not visible under the current filters, never deleted. */
  excludedIds: string[];
}

/**
 * Selected ∩ visible, deduplicated, in selection order.
 *
 * Identity is the record's document id. Never a row index or position.
 */
export function planBulkDelete(selectedIds: readonly string[], visibleIds: readonly string[]): BulkDeletePlan {
  const visible = new Set(visibleIds.filter(Boolean));
  const seen = new Set<string>();
  const targetIds: string[] = [];
  const excludedIds: string[] = [];
  for (const id of selectedIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (visible.has(id)) targetIds.push(id);
    else excludedIds.push(id);
  }
  return { targetIds, excludedIds };
}

export interface BulkDeleteOutcome {
  selectedCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  succeededIds: string[];
  failed: Array<{ id: string; error: string }>;
  /** Ids no longer present when their turn came - already removed elsewhere. */
  skippedIds: string[];
}

export interface BulkDeleteDeps {
  /**
   * Is the record still present in the live dataset right now? Asked
   * immediately before each delete, so a record removed by someone else while
   * the batch runs is skipped rather than reported as a failure.
   */
  isStillPresent: (id: string) => boolean;
  /** The existing single-record primitive. Throws on failure. */
  deleteOne: (id: string) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Deletes the planned batch one record at a time.
 *
 * Failures are isolated: with 100 targets and 2 failures, 98 stay deleted and
 * the 2 are reported with their ids. Nothing is rolled back, because the
 * primitive has no rollback - a record deleted is deleted.
 */
export async function executeBulkDelete(targetIds: readonly string[], deps: BulkDeleteDeps): Promise<BulkDeleteOutcome> {
  const succeededIds: string[] = [];
  const failed: BulkDeleteOutcome['failed'] = [];
  const skippedIds: string[] = [];

  for (let i = 0; i < targetIds.length; i++) {
    const id = targetIds[i];
    try {
      if (!deps.isStillPresent(id)) {
        skippedIds.push(id);
        continue;
      }
      await deps.deleteOne(id);
      succeededIds.push(id);
    } catch (error: any) {
      failed.push({ id, error: String(error?.message ?? error) });
    } finally {
      deps.onProgress?.(i + 1, targetIds.length);
    }
  }

  return {
    selectedCount: targetIds.length,
    successCount: succeededIds.length,
    failedCount: failed.length,
    skippedCount: skippedIds.length,
    succeededIds,
    failed,
    skippedIds,
  };
}

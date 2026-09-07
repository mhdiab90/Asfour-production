/**
 * Phase 4C - pure, Firebase-free helpers for bounding Production
 * (`production` collection, Pressing stage) Firestore reads by date,
 * mirroring the exact same "*Pure.ts" sibling pattern used for Phase 4A's
 * stageQueryBoundsPure.ts (kept as a separate file rather than reused,
 * since Production and the 8-stage records are separate domains with
 * their own filter types - ProductionFilter vs MultiDimensionFilter -
 * and their own independent evolution).
 *
 * SCHEMA BASIS (verified by direct source inspection, not assumed):
 * productionService.ts's own fetchProductionRecords()/subscribeProductionRecords()
 * already query `orderBy('date', 'desc')` directly, and
 * filterProductionRecords()'s existing client-side check
 * (`record.date < filter.startDate` / `record.date > filter.endDate`)
 * confirms `date` is a plain `YYYY-MM-DD` string, inclusive on both ends -
 * identical to the Phase 4A stage-record convention.
 *
 * BOUNDING RULE: presence-based, not format-validated - mirrors
 * resolveStageQueryBounds() (stageQueryBoundsPure.ts) exactly. Every known
 * caller already produces a well-formed `YYYY-MM-DD` string (native
 * `<input type="date">` in ProductionRecordsView.tsx, or
 * dateRangeResolver.ts's resolveDateRange() for the AI tools), so adding a
 * separate format validator here would diverge from the established Phase
 * 4A precedent for no added safety.
 */
import { ProductionFilter } from '../types';

export interface ProductionQueryBounds {
  /** True when at least one date bound is present and a server-side range filter should be applied. */
  useServerSideDateBound: boolean;
  startDate?: string;
  endDate?: string;
}

export function resolveProductionQueryBounds(
  filters?: Pick<ProductionFilter, 'startDate' | 'endDate'>
): ProductionQueryBounds {
  const startDate = filters?.startDate || undefined;
  const endDate = filters?.endDate || undefined;
  return {
    useServerSideDateBound: Boolean(startDate || endDate),
    startDate,
    endDate,
  };
}

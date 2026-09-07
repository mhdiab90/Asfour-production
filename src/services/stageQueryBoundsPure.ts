/**
 * Phase 4A - pure, Firebase-free helpers extracted from stageRecordService.ts
 * so they are directly unit-testable via `npx tsx` without pulling in the
 * Firebase SDK. stageRecordService.ts's own top-level `../config/firebase`
 * import reads `import.meta.env.VITE_FIREBASE_API_KEY`, which only exists
 * under Vite's bundler - importing anything from that file under plain
 * Node/tsx execution throws. This mirrors the same "*Pure.ts" sibling
 * pattern already used throughout this codebase (e.g.
 * costCenterHierarchyPure.ts alongside costCenterHierarchyService.ts) for
 * every other Firebase-coupled service that needs testable logic.
 *
 * `STAGE_COLLECTION_NAMES` is defined here (it has zero Firebase
 * dependency of its own) and re-exported verbatim from
 * stageRecordService.ts, so every existing importer of
 * `STAGE_COLLECTION_NAMES` from stageRecordService.ts (reportingEngine.ts,
 * DataImportView.tsx, ChineseMillsImportPanel.tsx,
 * ProductionStageSelector.tsx, GranularPermissionEditor.tsx,
 * DataReviewView.tsx) is completely unaffected by this move.
 */
import { ProductionStageType, MultiDimensionFilter } from '../types';

export const STAGE_COLLECTION_NAMES: Record<ProductionStageType, string> = {
  pressing: 'production',
  rotary_furnace: 'stage_rotary_furnace',
  chinese_mills: 'stage_chinese_mills',
  tube_ball_mills: 'stage_tube_ball_mills',
  mortar_concrete: 'stage_mortar_concrete',
  mixing: 'stage_mixing',
  lightweight_foam: 'stage_lightweight_foam',
  sorting: 'stage_sorting',
};

/**
 * PHASE 4A - decides whether a stage collection's Firestore read can be
 * bounded server-side by date, purely from the caller-supplied filters.
 *
 * SCHEMA BASIS for using the `date` field specifically (verified by direct
 * source inspection, not assumed): every write path that creates a stage
 * record sets a `date` field as a plain `YYYY-MM-DD` string -
 * ChineseMillsEntryForm/SortingEntryForm/MixingEntryForm/
 * RotaryFurnaceEntryForm/LightweightFoamEntryForm/MortarConcreteEntryForm/
 * TubeBallMillsEntryForm all declare `const [date] = useState(new
 * Date().toISOString().split('T')[0])` and pass it verbatim into
 * createStageRecord(); ProductionEntryForm/productionService.ts do the same
 * for the `production` (Pressing) collection, which already queries this
 * exact field directly (`orderBy('date', 'desc')`, productionService.ts).
 * All four historical-import services (pressing/chineseMills/tubeBallMills/
 * generic) validate and write the same `date` string shape, and the
 * generic path even defaults it when absent
 * (historicalImportService.ts: `if (!record.date) record.date = ...`).
 *
 * RESIDUAL RISK (reported, not silently accepted): stageRecordService.ts's
 * own fallback `d.date || d.createdAt?.split('T')[0]` implies some
 * hypothetical document could lack `date` entirely - no such document was
 * found in this audit, but Firestore's `where('date', ...)` range filter
 * would exclude one if it existed, whereas today's full-collection
 * client-side filter would still include it via the createdAt fallback.
 * Given every known write path unconditionally sets `date`, this is
 * treated as an accepted, narrow, low-probability edge case rather than a
 * reason to withhold the optimization - flagged explicitly in the Phase 4A
 * report rather than left undocumented.
 */
export interface StageQueryBounds {
  /** True when at least one date bound is present and a server-side range filter should be applied. */
  useServerSideDateBound: boolean;
  startDate?: string;
  endDate?: string;
}

export function resolveStageQueryBounds(filters?: MultiDimensionFilter): StageQueryBounds {
  const startDate = filters?.startDate || undefined;
  const endDate = filters?.endDate || undefined;
  return {
    useServerSideDateBound: Boolean(startDate || endDate),
    startDate,
    endDate,
  };
}

/**
 * PHASE 4B - strict `YYYY-MM-DD` format check for a single date string.
 *
 * Deliberately NOT reusing `normalizeDateInput()` from
 * pressingHistoricalImportService.ts: that helper is import-oriented (Excel
 * serials, ambiguous DD/MM vs MM/DD parsing, Arabic-numeral conversion) and
 * lives in a Firebase-coupled service file, so importing it here would
 * reintroduce the exact `VITE_FIREBASE_API_KEY` Node/tsx crash already fixed
 * once in Phase 4A. Every value this function actually receives is already
 * a canonical `YYYY-MM-DD` string produced either by a native HTML
 * `<input type="date">` (every stage entry form) or by ReportsView's own
 * date filter state - a strict format check is the correct, smallest fit.
 */
function isWellFormedIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  // Reject e.g. 2026-02-30 by round-tripping through UTC Date construction.
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

/**
 * PHASE 4B - CACHE KEY SAFETY / CORE RULE: a bounded stage-record query is
 * eligible for the new results cache only when BOTH startDate and endDate
 * are present, each is a well-formed `YYYY-MM-DD` string, and startDate <=
 * endDate. Any other case (either bound missing, either malformed, or an
 * inverted range) must never be cached - the caller falls back to the
 * existing uncached Phase 4A path unchanged.
 */
export function isStageQueryCacheEligible(filters?: MultiDimensionFilter): boolean {
  const startDate = filters?.startDate;
  const endDate = filters?.endDate;
  if (!startDate || !endDate) return false;
  if (!isWellFormedIsoDate(startDate) || !isWellFormedIsoDate(endDate)) return false;
  return startDate <= endDate;
}

/**
 * PHASE 4B - deterministic cache-key component for a bounded stage query.
 * Encodes every filter field that affects the RESULT SET of
 * fetchUniversalStageRecords() so that distinct queries never collide in
 * the shared LocalCacheStore keyspace. Does NOT encode userScope (that is
 * layered on separately by runCacheFirstRead, exactly as masterDataService
 * already does) so this value is safe to log/inspect without leaking
 * per-user information.
 *
 * Only called when `isStageQueryCacheEligible(filters)` is true, so
 * startDate/endDate are guaranteed present and well-formed here.
 */
/**
 * PHASE 5E.2 - CACHE IDENTITY CORRECTNESS.
 *
 * The v1 key encoded only stageType/startDate/endDate. That was safe while
 * every caller passed only those three, but fetchUniversalStageRecordsUncached
 * ALSO applies status/productId/customerId/employeeId/searchQuery as
 * client-side filters INSIDE the cached function (stageRecordService.ts
 * lines 424-431), so the cached payload is already narrowed by dimensions the
 * v1 key did not record. Two logically different queries could therefore
 * collide on one key and the narrower cached payload could be served as if it
 * were the wider result set - silent under-reporting, not a stale-data blip.
 *
 * Concretely, on the Data Review screen (the only caller that passes `status`
 * and `searchQuery`): filtering to status=SUBMITTED over a date range cached
 * the SUBMITTED-only subset; switching the dropdown back to "all" over the
 * same range hit the same key and re-displayed that subset as the complete
 * data. Reachable today by any user who fills in both date inputs.
 *
 * WHICH DIMENSIONS ARE INCLUDED, and why exactly these: every field the
 * cached function actually reads, and no others. `stageType` selects which
 * collections are read (line 294); `startDate`/`endDate`/`status`/
 * `productId`/`customerId`/`employeeId`/`searchQuery` each filter the
 * returned records (lines 424-431). MultiDimensionFilter also declares
 * departmentId, shiftId, productTypeId, pressId, furnaceId and machineId -
 * these are DELIBERATELY EXCLUDED because stageRecordService never reads
 * them, so they cannot change the payload; including them would only
 * fragment the cache into entries that hold identical data.
 *
 * NORMALIZATION follows the service's own semantics exactly, so that inputs
 * which produce an identical payload also produce an identical key (no
 * needless fragmentation) while any input that can change the payload
 * changes the key:
 *   - status: falsy OR the literal 'all' both mean "no status filter"
 *     (line 426 short-circuits on both) -> all collapse to `all`.
 *   - productId/customerId/employeeId/searchQuery: falsy means "no filter"
 *     (each guard is a plain truthiness check) -> undefined and '' collapse.
 *   - searchQuery is lower-cased by the service before matching (line 431),
 *     so 'ABC' and 'abc' return identical payloads -> lower-cased here too.
 *     It is deliberately NOT trimmed, because the service does not trim and
 *     ' abc' genuinely matches differently from 'abc'.
 *
 * Values are percent-encoded so free-text input (searchQuery especially)
 * can never inject the `::` or `=` separators and forge another query's key.
 *
 * The version prefix moves v1 -> v2 so payloads cached under the old,
 * ambiguous key format can never be read back through the new one.
 */
export function buildStageQueryCacheKey(filters: MultiDimensionFilter): string {
  const enc = (value?: string) => encodeURIComponent(value || '');
  const stageType = filters.stageType && filters.stageType !== 'all' ? filters.stageType : 'all';
  const status = filters.status && filters.status !== 'all' ? filters.status : 'all';

  return [
    'stageRecords',
    'v2',
    `stage=${enc(stageType)}`,
    `start=${enc(filters.startDate)}`,
    `end=${enc(filters.endDate)}`,
    `status=${enc(status)}`,
    `product=${enc(filters.productId)}`,
    `customer=${enc(filters.customerId)}`,
    `employee=${enc(filters.employeeId)}`,
    `search=${enc((filters.searchQuery || '').toLowerCase())}`,
  ].join('::');
}

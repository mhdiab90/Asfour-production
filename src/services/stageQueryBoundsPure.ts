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
export function buildStageQueryCacheKey(filters: MultiDimensionFilter): string {
  const stageType = filters.stageType && filters.stageType !== 'all' ? filters.stageType : 'all';
  return `stageRecords::v1::stage=${stageType}::start=${filters.startDate}::end=${filters.endDate}`;
}

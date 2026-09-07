/**
 * F-02 fix - pure, Firebase-free free-text search predicate for the Data
 * Review screen.
 *
 * WHY THIS EXISTS: DataReviewView's search box stored `searchQuery` and
 * passed it to fetchUniversalStageRecords(), but `searchQuery` was NOT in
 * that effect's dependency array and nothing filtered client-side - so
 * typing did nothing until some other filter changed. The box looked
 * functional and silently was not.
 *
 * WHY CLIENT-SIDE: re-querying Firestore per keystroke would add reads on
 * every character and fragment the Phase 5E.2 stage cache (whose v2 key
 * includes `search`). Filtering the already-loaded, already-bounded records
 * costs zero reads and updates instantly.
 *
 * SEARCH TARGET: deliberately identical to the predicate the stage service
 * already defines for `filters.searchQuery` (stageRecordService.ts lines
 * 430-437) - productCode, productName, customerName, stageNameAr. That is
 * the application's existing definition of "Data Review search", and it
 * matches the input's own placeholder ("بحث بالمنتج أو العميل..." - search
 * by product or customer). No new searchable field is invented here.
 *
 * The one intentional refinement over the service's version: `stageNameAr`
 * is lower-cased on both sides rather than only on the query side. For
 * Arabic text lower-casing is a no-op, so results are unchanged in practice;
 * it only makes a Latin-character stage name match case-insensitively too,
 * which is what the caller asks for.
 *
 * This module is Firebase-free and React-free on purpose, so the behaviour
 * can be unit-tested directly (the component itself cannot be imported by
 * the repo's plain-tsx test scripts - it pulls in React and, transitively,
 * the Firebase config that reads import.meta.env).
 */

/** The subset of a stage record this search reads. Structural, so any record carrying these fields works. */
export interface DataReviewSearchableRecord {
  productCode?: string;
  productName?: string;
  customerName?: string;
  stageNameAr?: string;
}

/**
 * True when the record matches the term. An empty or whitespace-only term
 * matches everything, so clearing the box restores the full filtered set.
 */
export function matchesDataReviewSearch(
  record: DataReviewSearchableRecord,
  searchQuery: string | undefined | null
): boolean {
  const q = (searchQuery || '').trim().toLowerCase();
  if (!q) return true;

  return (
    (record.productCode || '').toLowerCase().includes(q) ||
    (record.productName || '').toLowerCase().includes(q) ||
    (record.customerName || '').toLowerCase().includes(q) ||
    (record.stageNameAr || '').toLowerCase().includes(q)
  );
}

/**
 * Returns the records matching `searchQuery`, NEVER mutating or reordering
 * the input array. An empty/whitespace-only term returns the same records in
 * the same order, so `records` stays the canonical loaded dataset and the
 * search is a pure derived view on top of the existing filters.
 */
export function filterDataReviewRecords<T extends DataReviewSearchableRecord>(
  records: T[],
  searchQuery: string | undefined | null
): T[] {
  const q = (searchQuery || '').trim();
  if (!q) return records;
  return records.filter((r) => matchesDataReviewSearch(r, q));
}

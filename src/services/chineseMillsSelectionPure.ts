/**
 * Chinese Mills Historical Import - selection/eligibility logic ONLY.
 *
 * Deliberately Firebase-free (no import of ../config/firebase or anything
 * that transitively pulls it in) so this is unit-testable with plain
 * in-memory fixtures via `npx tsx` - see scripts/tests/. This is the SINGLE
 * authoritative source for "what counts as Valid / Ready / Corrected /
 * Invalid-Needs-Review" - both ChineseMillsImportPanel.tsx (bulk-select
 * buttons, top summary counts, review windows) and
 * chineseMillsHistoricalImportService.ts (import-time writable check)
 * import from here, so there is never a second/competing definition (§22).
 */
import { ChineseMillsImportRow } from '../types';

/** A row is writable only once it is explicitly INCLUDED (never while EXCLUDED or still parked PENDING), every blocking condition is cleared, every WARNING has been explicitly accepted, and every smart-match proposal has a decision (never left silently PENDING). */
export function isChineseMillsRowWritable(row: ChineseMillsImportRow): boolean {
  if ((row.rowSelection ?? 'INCLUDED') !== 'INCLUDED') return false;
  if (row.errors.length > 0) return false;
  if (row.warnings.length > 0 && !row.warningsAccepted) return false;
  if ((row.proposedMatches || []).some((m) => m.decision === 'PENDING')) return false;
  if (row.actualRateDecision === 'PENDING') return false;
  if (row.customerCodeUpdateProposal?.decision === 'PENDING') return false;
  return true;
}

/** getSelection with the same 'INCLUDED' default used throughout the panel. */
export function getRowSelection(row: ChineseMillsImportRow): 'INCLUDED' | 'EXCLUDED' | 'PENDING' {
  return row.rowSelection ?? 'INCLUDED';
}

/** VALID: no blocking errors AND no warnings at all (stricter than "writable" - a row with an accepted warning is writable but not "clean valid"). */
export function matchesValid(row: ChineseMillsImportRow): boolean {
  return row.errors.length === 0 && row.warnings.length === 0;
}

/** READY: would be writable right now if it were INCLUDED - i.e. every blocking/pending condition is already resolved, regardless of its current INCLUDED/EXCLUDED state. */
export function matchesReady(row: ChineseMillsImportRow): boolean {
  return isChineseMillsRowWritable({ ...row, rowSelection: 'INCLUDED' });
}

/** CORRECTED: has at least one entry in its resolution/edit history (a manual fix was applied at some point). */
export function matchesCorrected(row: ChineseMillsImportRow): boolean {
  return (row.resolutionHistory?.length || 0) > 0;
}

/** WARNING_APPROVED: has warnings and the user has explicitly accepted them. */
export function matchesWarningApproved(row: ChineseMillsImportRow): boolean {
  return row.warnings.length > 0 && !!row.warningsAccepted;
}

/**
 * INVALID / NEEDS REVIEW: rows that require a user decision before they can
 * ever be imported - currently PENDING (blocking error, parked out of the
 * bulk-selectable set entirely, §406 in the panel) OR still INCLUDED/EXCLUDED
 * but carrying an unresolved condition (unaccepted warning, a smart-match
 * proposal still PENDING, an unresolved Actual Rate/Customer Code decision).
 * Deliberately does NOT include a row whose only issue is an ALREADY-accepted
 * warning (matchesWarningApproved) - task §8 requires WARNING to not be
 * reclassified as INVALID unless it genuinely still blocks the row.
 */
export function matchesInvalidNeedsReview(row: ChineseMillsImportRow): boolean {
  if (getRowSelection(row) === 'PENDING') return true;
  if (row.warnings.length > 0 && !row.warningsAccepted) return true;
  if ((row.proposedMatches || []).some((m) => m.decision === 'PENDING')) return true;
  if (row.actualRateDecision === 'PENDING') return true;
  if (row.customerCodeUpdateProposal?.decision === 'PENDING') return true;
  return false;
}

export type BulkSelectionMode = 'ALL' | 'NONE' | 'VALID' | 'READY' | 'CORRECTED' | 'WARNING_APPROVED';

/**
 * Pure decision function behind handleBulkSelection: given one row and a
 * mode, decide its NEW rowSelection. PENDING rows are never touched by bulk
 * selection (§2 - a selected BLOCKING row must never become importable by
 * being swept into a bulk action; it needs its own explicit Re-include).
 * Returns `null` when the row should be left completely unchanged (only
 * happens for PENDING rows).
 */
export function computeBulkSelectionOutcome(
  row: ChineseMillsImportRow,
  mode: BulkSelectionMode
): { rowSelection: 'INCLUDED' | 'EXCLUDED'; exclusionReason?: 'USER_DESELECTED' } | null {
  if (getRowSelection(row) === 'PENDING') return null;
  if (mode === 'ALL') return { rowSelection: 'INCLUDED' };
  if (mode === 'NONE') return { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' };
  const matches =
    mode === 'VALID' ? matchesValid(row) :
    mode === 'READY' ? matchesReady(row) :
    mode === 'CORRECTED' ? matchesCorrected(row) :
    matchesWarningApproved(row); // WARNING_APPROVED
  return matches ? { rowSelection: 'INCLUDED' } : { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' };
}

export interface ChineseMillsSelectionCounts {
  total: number;
  valid: number;
  ready: number;
  corrected: number;
  invalidNeedsReview: number;
  warning: number;
  selected: number;
  excluded: number;
  skipped: number;
  willImport: number;
}

/** §3/§11 - the top-of-screen counts, computed ONLY from actual row state - never invented/estimated. */
export function computeSelectionCounts(rows: ChineseMillsImportRow[]): ChineseMillsSelectionCounts {
  let valid = 0, ready = 0, corrected = 0, invalidNeedsReview = 0, warning = 0, selected = 0, excluded = 0, skipped = 0, willImport = 0;
  for (const row of rows) {
    if (matchesValid(row)) valid++;
    if (matchesReady(row)) ready++;
    if (matchesCorrected(row)) corrected++;
    if (matchesInvalidNeedsReview(row)) invalidNeedsReview++;
    if (row.warnings.length > 0) warning++;
    const sel = getRowSelection(row);
    if (sel === 'INCLUDED') selected++;
    if (sel === 'EXCLUDED') excluded++;
    if (sel === 'EXCLUDED' && row.exclusionReason === 'SKIPPED_ROW') skipped++;
    if (isChineseMillsRowWritable(row)) willImport++;
  }
  return { total: rows.length, valid, ready, corrected, invalidNeedsReview, warning, selected, excluded, skipped, willImport };
}

/**
 * §17-19 - final import eligibility: only rows that are BOTH currently
 * selected for the review window AND writable right now. Splits a candidate
 * set into what would import vs. what would remain, without mutating
 * anything - used for the "X will be imported, Y will remain" confirmation
 * (§20) and to prove invalid rows never block valid ones (§18 test).
 */
export function planImport(rows: ChineseMillsImportRow[]): { willImport: ChineseMillsImportRow[]; willRemain: ChineseMillsImportRow[] } {
  const willImport: ChineseMillsImportRow[] = [];
  const willRemain: ChineseMillsImportRow[] = [];
  for (const row of rows) {
    (isChineseMillsRowWritable(row) ? willImport : willRemain).push(row);
  }
  return { willImport, willRemain };
}

/**
 * §6-7/§9: pure batch-boundary planner behind executeChineseMillsBatchImport's
 * cancellation loop - given how many writable rows there are and which batch
 * index a cancel request landed on (or -1 if never cancelled), returns the
 * same importedCount/cancelledCount split the real Firestore loop produces,
 * WITHOUT touching Firestore. This is the single source of truth for "how
 * many rows count as imported vs. cancelled" so the UI's importResult and
 * the service's return value can never disagree. Batches already started are
 * never partially rolled back (a writeBatch().commit() is atomic) - only
 * whole not-yet-started batches are ever counted as cancelled.
 */
export function planBatchCancellation(
  writableCount: number,
  batchSize: number,
  cancelledAtBatchStartIndex: number
): { importedCount: number; cancelledCount: number; totalBatches: number } {
  const totalBatches = Math.ceil(writableCount / batchSize) || 1;
  if (cancelledAtBatchStartIndex < 0 || cancelledAtBatchStartIndex >= writableCount) {
    return { importedCount: writableCount, cancelledCount: 0, totalBatches };
  }
  return {
    importedCount: cancelledAtBatchStartIndex,
    cancelledCount: writableCount - cancelledAtBatchStartIndex,
    totalBatches,
  };
}

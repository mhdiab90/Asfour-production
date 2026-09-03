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

/**
 * Approve Invalid Records task, §10: which of a row's blocking errors an
 * authorized user's approval decision may safely override, vs. a hard
 * structural rule this business has defined as non-overridable. Determined
 * by inspecting the ACTUAL Firestore write payload in
 * executeChineseMillsBatchImport (chineseMillsHistoricalImportService.ts) -
 * every resolved master-data field (customer/mill/fault/specification
 * type/id) is written with a `|| ''` fallback to the raw imported text, so
 * an unresolved master-data MATCH never blocks the write at the database
 * level and is safely overridable. These five conditions are checked
 * directly off the row's own independently-recomputed typed fields (never
 * by matching freeform, locale-varying error text) because writing past them
 * would corrupt the record or the dataset outright, regardless of any human
 * decision:
 *  - INVALID_DATE: `date` is written as a plain string and is the key half
 *    of the duplicate-detection key and every date-based report/query.
 *  - Mill Type entirely blank (not just unmatched): the record would carry
 *    no press identity at all - `millTypeRaw` has no raw-text fallback to
 *    fall back to when it never had one.
 *  - Invalid Shift: `shiftNumber` is a closed 1/2/3 enum written as `?? null`
 *    - a null/invalid shift breaks shift-based aggregation.
 *  - Production Quantity <= 0: written directly as the raw `quantity`
 *    number, no fallback - this is the row's entire business reason to
 *    exist; a record with none has no meaning.
 *  - Duplicate-in-file: approving this would double-count real, physical
 *    production in every report - a data-integrity safety net, not a
 *    reviewable data-quality question.
 */
export function isNonOverridableBlockingCondition(row: ChineseMillsImportRow): boolean {
  if (row.status === 'INVALID_DATE') return true;
  if (!row.millTypeRaw || !row.millTypeRaw.trim()) return true;
  if (!row.resolvedShiftNumber) return true;
  if (!(row.productionQuantity > 0)) return true;
  if (row.duplicateType === 'FILE') return true;
  return false;
}

/**
 * A row is writable only once it is explicitly INCLUDED (never while
 * EXCLUDED or still parked PENDING), every WARNING has been explicitly
 * accepted, and every smart-match proposal has a decision (never left
 * silently PENDING). A row with blocking errors is writable ONLY if an
 * authorized user has explicitly approved it (row.approved) AND none of its
 * errors are non-overridable per isNonOverridableBlockingCondition above -
 * approval is an override of REVIEWABLE errors, never a bypass of a hard
 * structural/data-integrity rule.
 */
export function isChineseMillsRowWritable(row: ChineseMillsImportRow): boolean {
  if ((row.rowSelection ?? 'INCLUDED') !== 'INCLUDED') return false;
  if (row.errors.length > 0) {
    if (!row.approved) return false;
    if (isNonOverridableBlockingCondition(row)) return false;
  }
  if (row.warnings.length > 0 && !row.warningsAccepted) return false;
  if ((row.proposedMatches || []).some((m) => m.decision === 'PENDING')) return false;
  if (row.actualRateDecision === 'PENDING') return false;
  if (row.customerCodeUpdateProposal?.decision === 'PENDING') return false;
  return true;
}

/** APPROVED (for display/counters): has a blocking error AND has been explicitly approved - independent of whether that approval actually makes it writable (a non-overridable error can still be approved-for-review-tracking but will never count toward Will Import). */
export function matchesApproved(row: ChineseMillsImportRow): boolean {
  return row.errors.length > 0 && row.approved === true;
}

/** getSelection with the same 'INCLUDED' default used throughout the panel. */
export function getRowSelection(row: ChineseMillsImportRow): 'INCLUDED' | 'EXCLUDED' | 'PENDING' {
  return row.rowSelection ?? 'INCLUDED';
}

/**
 * Global Ready-to-Import Override task, §10: whether "Mark as Ready to
 * Import" can succeed for this row AT ALL, regardless of its current
 * validationStatus. Two independent reasons a row can never be forced
 * ready, neither guessed - both read directly off the SAME existing guards
 * isChineseMillsRowWritable already enforces:
 *  - A non-overridable structural error (§10 of the Approve Invalid Records
 *    task, reused verbatim here - never a second overridability model).
 *  - An unresolved smart-match/Actual-Rate/Customer-Code decision still
 *    PENDING - these require the user to pick a SPECIFIC answer, which a
 *    blanket "mark ready" action must never silently decide FOR them.
 */
export function canMarkReadyToImport(row: ChineseMillsImportRow): boolean {
  if (row.errors.length > 0 && isNonOverridableBlockingCondition(row)) return false;
  if ((row.proposedMatches || []).some((m) => m.decision === 'PENDING')) return false;
  if (row.actualRateDecision === 'PENDING') return false;
  if (row.customerCodeUpdateProposal?.decision === 'PENDING') return false;
  return true;
}

/**
 * The field patch "Mark as Ready to Import" applies to a row that already
 * passed canMarkReadyToImport - caller must check that first (this function
 * does not re-check it). Deliberately reuses the EXISTING mechanisms that
 * already drive isChineseMillsRowWritable rather than inventing a parallel
 * writability path: rowSelection -> INCLUDED (undoes EXCLUDED/SKIPPED/
 * PENDING - §8/§9, "Reinclude and Mark Ready"), approved -> true only when
 * the row actually has overridable errors to override (§16 - a clean row
 * never gets a meaningless approved flag), warningsAccepted -> true only
 * when there is an actual unaccepted warning to accept (§17 - never
 * touches/hides the warning itself). validationStatus (status/errors/
 * warnings) is never part of this patch - §11's core rule.
 */
export function computeMarkReadyPatch(row: ChineseMillsImportRow): Partial<ChineseMillsImportRow> {
  const patch: Partial<ChineseMillsImportRow> = { rowSelection: 'INCLUDED', exclusionReason: undefined };
  if (row.errors.length > 0) patch.approved = true;
  if (row.warnings.length > 0 && !row.warningsAccepted) patch.warningsAccepted = true;
  return patch;
}

/** READY_TO_IMPORT (for display/counters) - an explicit "Mark as Ready to Import" decision was recorded for this row, independent of whether it is currently selected/writable (e.g. a later edit could have invalidated it again). */
export function matchesReadyToImport(row: ChineseMillsImportRow): boolean {
  return row.readyToImport === true;
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
 * ever be imported - has a BLOCKING error (INTRINSIC: row.errors.length > 0,
 * never the mutable rowSelection field - see the root-cause note on
 * computeBulkSelectionOutcome below for why) OR still carries an unresolved
 * condition (unaccepted warning, a smart-match proposal still PENDING, an
 * unresolved Actual Rate/Customer Code decision). Deliberately does NOT
 * include a row whose only issue is an ALREADY-accepted warning
 * (matchesWarningApproved) - task §8 requires WARNING to not be reclassified
 * as INVALID unless it genuinely still blocks the row.
 */
export function matchesInvalidNeedsReview(row: ChineseMillsImportRow): boolean {
  if (row.errors.length > 0) return true;
  if (row.warnings.length > 0 && !row.warningsAccepted) return true;
  if ((row.proposedMatches || []).some((m) => m.decision === 'PENDING')) return true;
  if (row.actualRateDecision === 'PENDING') return true;
  if (row.customerCodeUpdateProposal?.decision === 'PENDING') return true;
  return false;
}

export type BulkSelectionMode = 'ALL' | 'NONE' | 'VALID' | 'READY' | 'CORRECTED' | 'WARNING_APPROVED';

/**
 * Pure decision function behind handleBulkSelection: given one row and a
 * mode, decide its NEW rowSelection.
 *
 * ROOT CAUSE FIX: a row with a blocking error is parked as rowSelection
 * 'PENDING' at parse time (§ Row-Based Review Part 6). The PREVIOUS version
 * of this function treated 'PENDING' as "never touched by bulk selection" -
 * intended to stop a blocking row from becoming importable via a careless
 * Select All, but it actually broke Select All/Deselect All entirely for
 * every blocking row: the checkbox in the review modal reads
 * getRowSelection(row) === 'INCLUDED', so a row this function always skipped
 * could NEVER visually check, no matter how many times Select All was
 * clicked - exactly the reported "individual checkbox works, Select All does
 * nothing" bug (manual re-include/exclude call other handlers directly and
 * were never gated here). This mirrors Pressing's OWN proven pattern
 * exactly: Pressing has no PENDING state at all - EVERY row, blocking or
 * not, gets an explicit INCLUDED/EXCLUDED decision from Select All/Deselect
 * All (see pressingSelectionPure.ts's computePressingBulkOutcome), and
 * "blocking" is a purely DERIVED, INTRINSIC classification
 * (isRowReadyToImport/errors.length) that is completely independent of
 * selection state. Selection ("is this row part of my reviewed batch") and
 * writability ("can this row actually be written right now") are two
 * separate questions - isChineseMillsRowWritable's OWN errors.length check
 * already guarantees a blocking row can never be written regardless of
 * whether it is now selected, so there is no safety reason to also gate it
 * here. Never returns null anymore - every row gets a real decision.
 */
export function computeBulkSelectionOutcome(
  row: ChineseMillsImportRow,
  mode: BulkSelectionMode
): { rowSelection: 'INCLUDED' | 'EXCLUDED'; exclusionReason?: 'USER_DESELECTED' } | null {
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
  /** Approve Invalid Records task §19: has a blocking error AND has been explicitly approved. */
  approved: number;
  /** Has a blocking error that approval can never override (§10) - always excluded from Will Import regardless of approval. */
  blocking: number;
  /** Global Ready-to-Import Override task §19: rows with an explicit "Mark as Ready to Import" decision recorded (row.readyToImport) - distinct from the pre-existing `ready` above (matchesReady - "would be writable if included", never requires the explicit decision). */
  markedReadyToImport: number;
}

/** §3/§11 - the top-of-screen counts, computed ONLY from actual row state - never invented/estimated. */
export function computeSelectionCounts(rows: ChineseMillsImportRow[]): ChineseMillsSelectionCounts {
  let valid = 0, ready = 0, corrected = 0, invalidNeedsReview = 0, warning = 0, selected = 0, excluded = 0, skipped = 0, willImport = 0, approved = 0, blocking = 0, markedReadyToImport = 0;
  for (const row of rows) {
    if (matchesValid(row)) valid++;
    if (matchesReady(row)) ready++;
    if (matchesCorrected(row)) corrected++;
    if (matchesInvalidNeedsReview(row)) invalidNeedsReview++;
    if (row.warnings.length > 0) warning++;
    if (matchesApproved(row)) approved++;
    if (row.errors.length > 0 && isNonOverridableBlockingCondition(row)) blocking++;
    if (matchesReadyToImport(row)) markedReadyToImport++;
    const sel = getRowSelection(row);
    if (sel === 'INCLUDED') selected++;
    if (sel === 'EXCLUDED') excluded++;
    if (sel === 'EXCLUDED' && row.exclusionReason === 'SKIPPED_ROW') skipped++;
    if (isChineseMillsRowWritable(row)) willImport++;
  }
  return { total: rows.length, valid, ready, corrected, invalidNeedsReview, warning, selected, excluded, skipped, willImport, approved, blocking, markedReadyToImport };
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

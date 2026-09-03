/**
 * Tube/Ball Mills Historical Import - selection/eligibility logic ONLY.
 *
 * Deliberately Firebase-free (mirrors chineseMillsSelectionPure.ts exactly)
 * so this is unit-testable with plain in-memory fixtures via `npx tsx` - see
 * scripts/tests/. This is the SINGLE authoritative source for "what counts
 * as Valid/Ready/Corrected/Invalid-Needs-Review/Approved/Ready-to-Import"
 * for this stage - both TubeBallMillsImportPanel.tsx and
 * tubeBallMillsHistoricalImportService.ts import from here, never a second/
 * competing definition. `planBatchCancellation` is intentionally NOT
 * duplicated here - it is pure row-count arithmetic with zero row-shape
 * dependency, so the panel/service import it directly from
 * chineseMillsSelectionPure.ts.
 */
import { TubeBallMillsImportRow } from '../types';

/** getSelection with the same 'INCLUDED' default used throughout every import panel in this app. */
export function getRowSelection(row: TubeBallMillsImportRow): 'INCLUDED' | 'EXCLUDED' | 'PENDING' {
  return row.rowSelection ?? 'INCLUDED';
}

/**
 * §10 of the Approve Invalid Records task, reapplied here (never a second
 * overridability model): which of a row's blocking errors an authorized
 * user's approval may safely override, vs. a hard structural/data-integrity
 * rule this business has defined as non-overridable. Determined from TWO
 * authoritative sources, never guessed:
 *  1. The EXISTING generic import field schema for this exact stage
 *     (productionStageConfig.ts's `tube_ball_mills` entry) - the only field
 *     marked `required: true` there is `totalTons` (plus the shared
 *     DATE_FIELD, required for every stage). Mill Type, Material Type,
 *     Hours, Tons Per Hour, and Storage Bunker are ALL `required: false` in
 *     that existing config - so none of them are non-overridable here, and
 *     (see revalidateTubeBallMillsRowFields) a blank value in any of them
 *     is not even an ERROR, matching §J's "for OPTIONAL: allow resolve/
 *     clear/exclude/continue" instruction exactly rather than guessing.
 *  2. The ACTUAL Firestore write payload (executeTubeBallMillsBatchImport)
 *     for what would corrupt the record or the dataset outright regardless
 *     of any human decision:
 *     - INVALID_DATE: required by every stage, and is half of every
 *       duplicate-detection key.
 *     - Total <= 0: the row's entire business reason to exist (§25) - the
 *       one field this stage's own existing schema marks required.
 *     - Duplicate-in-file: would double-count real physical production.
 *     - Invalid bunker allocation (§22, ONLY when bunkers were actually
 *       specified - an empty/optional bunker field is never invalid,
 *       nothing to misallocate): a hard ARITHMETIC integrity rule, not a
 *       master-data-match question.
 * Master-data-match misses (Unknown Mill/Material/Mixture Component/Bunker
 * identity) are all OVERRIDABLE - the write payload falls back to the raw
 * imported text for every one of them, exactly like Chinese Mills' own
 * Customer/Mill Type/Fault Type/Specification Code.
 */
export function isNonOverridableBlockingCondition(row: TubeBallMillsImportRow): boolean {
  if (row.status === 'INVALID_DATE') return true;
  if (!(row.totalTons > 0)) return true;
  if (row.duplicateType === 'FILE') return true;
  if (row.bunkerAllocations.length > 0 && !row.bunkerAllocationValid) return true;
  return false;
}

/**
 * A row is writable only once it is explicitly INCLUDED, every WARNING has
 * been explicitly accepted, and (mirroring isChineseMillsRowWritable
 * exactly) a row with blocking errors is writable ONLY if an authorized
 * user has explicitly approved it AND none of its errors are
 * non-overridable.
 */
export function isTubeBallMillsRowWritable(row: TubeBallMillsImportRow): boolean {
  if (getRowSelection(row) !== 'INCLUDED') return false;
  if (row.errors.length > 0) {
    if (!row.approved) return false;
    if (isNonOverridableBlockingCondition(row)) return false;
  }
  if (row.warnings.length > 0 && !row.warningsAccepted) return false;
  return true;
}

/** VALID: no blocking errors AND no warnings at all. */
export function matchesValid(row: TubeBallMillsImportRow): boolean {
  return row.errors.length === 0 && row.warnings.length === 0;
}

/** READY: would be writable right now if it were INCLUDED - independent of its current INCLUDED/EXCLUDED state. */
export function matchesReady(row: TubeBallMillsImportRow): boolean {
  return isTubeBallMillsRowWritable({ ...row, rowSelection: 'INCLUDED' });
}

/** CORRECTED: has at least one entry in its resolution/edit history (a manual fix was applied at some point). */
export function matchesCorrected(row: TubeBallMillsImportRow): boolean {
  return (row.resolutionHistory?.length || 0) > 0;
}

/** WARNING_APPROVED: has warnings and the user has explicitly accepted them. */
export function matchesWarningApproved(row: TubeBallMillsImportRow): boolean {
  return row.warnings.length > 0 && !!row.warningsAccepted;
}

/** INVALID / NEEDS REVIEW: has a blocking error (intrinsic - errors.length>0, never the mutable rowSelection) OR an unaccepted warning. Never includes a row whose only issue is an already-accepted warning. */
export function matchesInvalidNeedsReview(row: TubeBallMillsImportRow): boolean {
  if (row.errors.length > 0) return true;
  if (row.warnings.length > 0 && !row.warningsAccepted) return true;
  return false;
}

/** APPROVED (for display/counters): has a blocking error AND has been explicitly approved. */
export function matchesApproved(row: TubeBallMillsImportRow): boolean {
  return row.errors.length > 0 && row.approved === true;
}

/** READY_TO_IMPORT (for display/counters): an explicit "Mark as Ready to Import" decision was recorded for this row. */
export function matchesReadyToImport(row: TubeBallMillsImportRow): boolean {
  return row.readyToImport === true;
}

export type BulkSelectionMode = 'ALL' | 'NONE' | 'VALID' | 'READY' | 'CORRECTED' | 'WARNING_APPROVED';

/** Pure decision function behind every Select All/Deselect All/Select Valid/Select Ready/Select Corrected action - reused identically by the main screen and every scoped review window (mirrors computeBulkSelectionOutcome in chineseMillsSelectionPure.ts exactly, including giving EVERY row - blocking included - a real decision, never skipping one). */
export function computeBulkSelectionOutcome(
  row: TubeBallMillsImportRow,
  mode: BulkSelectionMode
): { rowSelection: 'INCLUDED' | 'EXCLUDED'; exclusionReason?: 'USER_DESELECTED' } {
  if (mode === 'ALL') return { rowSelection: 'INCLUDED' };
  if (mode === 'NONE') return { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' };
  const matches =
    mode === 'VALID' ? matchesValid(row) :
    mode === 'READY' ? matchesReady(row) :
    mode === 'CORRECTED' ? matchesCorrected(row) :
    matchesWarningApproved(row);
  return matches ? { rowSelection: 'INCLUDED' } : { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' };
}

/**
 * §10 of the Ready-to-Import task, reapplied here: whether "Mark as Ready
 * to Import" can succeed for this row at all, regardless of its current
 * validationStatus.
 */
export function canMarkReadyToImport(row: TubeBallMillsImportRow): boolean {
  return !(row.errors.length > 0 && isNonOverridableBlockingCondition(row));
}

/** The field patch "Mark as Ready to Import" applies - caller must check canMarkReadyToImport first. Never touches status/errors/warnings (validationStatus stays untouched - only the import DECISION changes). */
export function computeMarkReadyPatch(row: TubeBallMillsImportRow): Partial<TubeBallMillsImportRow> {
  const patch: Partial<TubeBallMillsImportRow> = { rowSelection: 'INCLUDED', exclusionReason: undefined };
  if (row.errors.length > 0) patch.approved = true;
  if (row.warnings.length > 0 && !row.warningsAccepted) patch.warningsAccepted = true;
  return patch;
}

export interface TubeBallMillsSelectionCounts {
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
  approved: number;
  blocking: number;
  markedReadyToImport: number;
}

/** The top-of-screen counts, computed ONLY from actual row state - never invented/estimated. */
export function computeSelectionCounts(rows: TubeBallMillsImportRow[]): TubeBallMillsSelectionCounts {
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
    if (isTubeBallMillsRowWritable(row)) willImport++;
  }
  return { total: rows.length, valid, ready, corrected, invalidNeedsReview, warning, selected, excluded, skipped, willImport, approved, blocking, markedReadyToImport };
}

/** Final import eligibility split - only rows that are BOTH currently selected AND writable right now. Never mutates anything. */
export function planImport(rows: TubeBallMillsImportRow[]): { willImport: TubeBallMillsImportRow[]; willRemain: TubeBallMillsImportRow[] } {
  const willImport: TubeBallMillsImportRow[] = [];
  const willRemain: TubeBallMillsImportRow[] = [];
  for (const row of rows) {
    (isTubeBallMillsRowWritable(row) ? willImport : willRemain).push(row);
  }
  return { willImport, willRemain };
}

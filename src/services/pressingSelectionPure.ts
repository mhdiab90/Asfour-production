/**
 * Pressing Historical Import - row-level selection/category helpers.
 *
 * Extracted verbatim (behavior-preserving, no logic change) from
 * DataImportView.tsx so they can be unit-tested in isolation via `npx tsx`
 * (that component file transitively imports Firebase-touching services,
 * which crash outside Vite's `import.meta.env` handling - see
 * scripts/tests/ for the same pattern used elsewhere in this codebase).
 * DataImportView.tsx imports these instead of defining them locally - this
 * is the single authoritative source, not a second/competing definition.
 *
 * A blocking error on one row must never block the rest of the file. These
 * are pure, derived functions (no new stored status enum) so selection state
 * can never drift out of sync with the row's actual validity.
 */
import { PressingImportRow } from '../types';

/** Undefined is treated as INCLUDED (opt-out default selection model). */
export function getRowSelection(row: PressingImportRow): 'INCLUDED' | 'EXCLUDED' {
  return row.rowSelection ?? 'INCLUDED';
}

export function isRowReadyToImport(row: PressingImportRow): boolean {
  return row.errors.length === 0;
}

/** True once ANY field on this row was resolved via Manual Edit/Select/Add rather than being clean from parsing or a plain Approve. */
export function wasRowManuallyCorrected(row: PressingImportRow): boolean {
  return !!row.proposedMatches?.some(
    (m) => m.decision === 'MANUAL' || (m.matchType && m.matchType.startsWith('MANUAL'))
  );
}

export type RowCategory = 'EXCLUDED' | 'BLOCKING' | 'CORRECTED' | 'WARNING' | 'READY';

export function getRowCategory(row: PressingImportRow): RowCategory {
  if (getRowSelection(row) === 'EXCLUDED') return 'EXCLUDED';
  if (!isRowReadyToImport(row)) return 'BLOCKING';
  if (wasRowManuallyCorrected(row)) return 'CORRECTED';
  if (row.warnings.length > 0) return 'WARNING';
  return 'READY';
}

/** True while a row has business warnings the user has not yet EXPLICITLY accepted - mere selection/inclusion is never treated as approval. */
export function needsWarningAcceptance(row: PressingImportRow): boolean {
  return row.warnings.length > 0 && !row.warningsAccepted;
}

/** A row may be written to Firestore ONLY when: explicitly selected, free of BLOCKING errors, AND (no warnings OR the user explicitly accepted them). WARNING is never treated as BLOCKING. */
export function isRowWritable(row: PressingImportRow): boolean {
  return getRowSelection(row) === 'INCLUDED' && isRowReadyToImport(row) && !needsWarningAcceptance(row);
}

export type PressingBulkSelectionMode = 'ALL' | 'NONE' | 'VALID' | 'CORRECTED' | 'READY' | 'CLEAR';

export interface PressingBulkOutcome {
  rowSelection: 'INCLUDED' | 'EXCLUDED' | undefined;
  exclusionReason: 'USER_DESELECTED' | undefined;
}

/**
 * Pure decision function behind handleBulkSelection - given one row and a
 * mode, decide its new rowSelection/exclusionReason. Unlike Chinese Mills,
 * Pressing has no PENDING state to skip: EVERY row (including BLOCKING ones)
 * gets an explicit INCLUDED/EXCLUDED decision from 'ALL'/'NONE' - blocking
 * rows are still gated from writing by isRowWritable()'s separate
 * isRowReadyToImport() check at execution time, never by being excluded from
 * selection itself (§5: "Select All MUST NOT silently ignore them").
 */
export function computePressingBulkOutcome(row: PressingImportRow, mode: PressingBulkSelectionMode): PressingBulkOutcome {
  if (mode === 'ALL') return { rowSelection: 'INCLUDED', exclusionReason: undefined };
  if (mode === 'NONE') return { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' };
  if (mode === 'CLEAR') return { rowSelection: undefined, exclusionReason: undefined };
  const category = getRowCategory({ ...row, rowSelection: undefined });
  const matches =
    (mode === 'READY' && (category === 'READY' || category === 'CORRECTED')) ||
    (mode === 'VALID' && category === 'READY') ||
    (mode === 'CORRECTED' && category === 'CORRECTED');
  return matches ? { rowSelection: 'INCLUDED', exclusionReason: undefined } : { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' };
}

export interface PressingPartialImportSummary {
  total: number; selected: number; ready: number; corrected: number; warning: number;
  warningsAccepted: number; warningsPending: number; blocking: number; skipped: number;
  excluded: number; willImport: number;
}

/** The exact aggregation behind DataImportView.tsx's partialImportSummary useMemo - extracted so its correctness (§9/§11: counters never drift from the same source of truth) is directly testable. */
export function computePressingPartialImportSummary(rows: PressingImportRow[]): PressingPartialImportSummary {
  const total = rows.length;
  let selected = 0, ready = 0, corrected = 0, warning = 0, warningsAccepted = 0, warningsPending = 0, blocking = 0, skipped = 0, excluded = 0, willImport = 0;
  for (const row of rows) {
    const sel = getRowSelection(row);
    const category = getRowCategory(row);
    if (sel === 'INCLUDED') selected++;
    if (category === 'READY') ready++;
    else if (category === 'CORRECTED') { corrected++; ready++; }
    else if (category === 'WARNING') warning++;
    else if (category === 'BLOCKING') blocking++;
    else if (category === 'EXCLUDED') {
      excluded++;
      if (row.exclusionReason === 'SKIPPED_ROW') skipped++;
    }
    if (row.warnings.length > 0) {
      if (row.warningsAccepted) warningsAccepted++;
      else if (sel === 'INCLUDED') warningsPending++;
    }
    if (isRowWritable(row)) willImport++;
  }
  return { total, selected, ready, corrected, warning, warningsAccepted, warningsPending, blocking, skipped, excluded, willImport };
}

/**
 * Bulk edit - pure planning, validation and result accounting.
 *
 * Deliberately Firebase-free: this decides WHICH rows are touched and WHETHER
 * each one is valid, and the caller performs the writes through the existing
 * updateStageRecord (which keeps the correction reason, the CORRECTED status
 * and the versioned audit log exactly as a single-record edit does).
 *
 * TWO RULES THIS MODULE EXISTS TO ENFORCE:
 *
 *  1. SELECTED ROWS ONLY. The execution set is built from explicitly selected
 *     ids intersected with the rows actually on screen. A row that is hidden,
 *     filtered out, or merely remembered from a previous filter can never be
 *     written to.
 *
 *  2. ONE BAD ROW CANNOT POISON THE REST. Every row is validated on its own and
 *     applied on its own, so 18 valid rows still succeed when 2 are invalid.
 *     There is no all-or-nothing batch.
 *
 * There is NO delete here. `UniversalStageRecord` has no delete primitive -
 * production records are corrected and approved/rejected, never removed - and
 * this module does not invent one.
 */

// --- Field safety ------------------------------------------------------------

/**
 * Which fields may be written to many records at once.
 *
 * The single-record editor already establishes the safe-to-edit set: quantity,
 * wasteQuantity and notes. Of those, only `notes` is semantically coherent to
 * apply to MANY rows - quantity and wasteQuantity are per-record measurements,
 * and setting twenty records to one quantity would corrupt production data
 * rather than correct it.
 *
 * Everything else on the record is one of:
 *   system-managed - status, updatedAt, serverUpdatedAt (written by
 *                    updateStageRecord itself, never by a caller)
 *   immutable      - id, stageType, createdBy, createdAt
 *   derived        - gasPerTon, electricityPerTon and other computed ratios
 *   relational     - productId/productCode/productName, customerId/customerName,
 *                    which are denormalised together and would desync if one
 *                    were written alone
 */
export const BULK_EDITABLE_FIELDS = ['notes'] as const;
export type BulkEditableField = (typeof BULK_EDITABLE_FIELDS)[number];

/** Never writable by a bulk edit, whatever a caller asks for. */
export const BULK_PROTECTED_FIELDS = [
  'id', 'stageType', 'status', 'createdAt', 'createdBy', 'createdByName',
  'updatedAt', 'serverUpdatedAt', 'quantity', 'wasteQuantity', 'goodQuantity',
  'productionTons', 'goodTons', 'wasteTons', 'gasPerTon', 'electricityPerTon',
  'productId', 'productCode', 'productName', 'customerId', 'customerName',
  'date', 'materials', 'workers', 'rawData',
] as const;

export function isBulkEditable(field: string): boolean {
  return (BULK_EDITABLE_FIELDS as readonly string[]).includes(field);
}

export function assertBulkEditableFields(patch: Record<string, unknown>): void {
  const illegal = Object.keys(patch).filter((f) => !isBulkEditable(f));
  if (illegal.length) {
    throw new Error(
      `these field(s) are not safe to bulk edit: ${illegal.join(', ')}. ` +
      `Bulk edit accepts only: ${BULK_EDITABLE_FIELDS.join(', ')}`,
    );
  }
}

// --- Selection ---------------------------------------------------------------

export interface SelectionState {
  /** Explicitly selected record ids. */
  selectedIds: string[];
}

export const EMPTY_SELECTION_STATE: SelectionState = { selectedIds: [] };

export function toggleRow(state: SelectionState, id: string): SelectionState {
  const set = new Set(state.selectedIds);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  return { selectedIds: [...set] };
}

export function selectAllVisible(state: SelectionState, visibleIds: string[]): SelectionState {
  return { selectedIds: [...new Set([...state.selectedIds, ...visibleIds])] };
}

export function deselectAll(): SelectionState {
  return { selectedIds: [] };
}

export function deselectVisible(state: SelectionState, visibleIds: string[]): SelectionState {
  const hidden = new Set(visibleIds);
  return { selectedIds: state.selectedIds.filter((id) => !hidden.has(id)) };
}

/**
 * Drops remembered ids that are no longer on screen.
 *
 * Called whenever the filters change. Keeping a stale id would let a later
 * bulk edit write to a record the user can no longer see - the safe behaviour
 * is to forget it, and the count visibly drops so nothing happens silently.
 */
export function pruneToVisible(state: SelectionState, visibleIds: string[]): SelectionState {
  const visible = new Set(visibleIds);
  return { selectedIds: state.selectedIds.filter((id) => visible.has(id)) };
}

export function selectionCount(state: SelectionState): number {
  return state.selectedIds.length;
}

export function isSelected(state: SelectionState, id: string): boolean {
  return state.selectedIds.includes(id);
}

export function areAllVisibleSelected(state: SelectionState, visibleIds: string[]): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => state.selectedIds.includes(id));
}

// --- Planning ----------------------------------------------------------------

export interface BulkEditTarget {
  id: string;
  stageType: string;
}

export interface BulkRowIssue {
  id: string;
  reason: string;
}

export interface BulkEditPlan {
  targets: BulkEditTarget[];
  invalid: BulkRowIssue[];
  /** Selected but not on screen - never written to. */
  skipped: BulkRowIssue[];
  totalSelected: number;
}

export type RowValidator<T> = (row: T) => string | null;

/**
 * Builds the exact execution set.
 *
 * The intersection with `visibleRows` is the safety boundary: only rows the
 * user can currently see AND has explicitly selected are ever returned.
 */
export function planBulkEdit<T extends { id: string; stageType?: string }>(
  selection: SelectionState,
  visibleRows: T[],
  patch: Record<string, unknown>,
  validate?: RowValidator<T>,
): BulkEditPlan {
  assertBulkEditableFields(patch);

  const byId = new Map(visibleRows.map((r) => [r.id, r]));
  const targets: BulkEditTarget[] = [];
  const invalid: BulkRowIssue[] = [];
  const skipped: BulkRowIssue[] = [];

  for (const id of selection.selectedIds) {
    const row = byId.get(id);
    if (!row) {
      skipped.push({ id, reason: 'no longer visible under the current filters - not modified' });
      continue;
    }
    const problem = validate ? validate(row) : null;
    if (problem) {
      // Recorded and left alone; the other rows still proceed.
      invalid.push({ id, reason: problem });
      continue;
    }
    targets.push({ id: row.id, stageType: String(row.stageType ?? '') });
  }

  return { targets, invalid, skipped, totalSelected: selection.selectedIds.length };
}

// --- Results -----------------------------------------------------------------

export interface BulkRowResult {
  id: string;
  ok: boolean;
  reason?: string;
}

export interface BulkEditOutcome {
  successCount: number;
  failedCount: number;
  skippedCount: number;
  succeeded: string[];
  failed: BulkRowIssue[];
  skipped: BulkRowIssue[];
  totalSelected: number;
}

/**
 * Folds per-row results into the outcome. Rows that failed to validate and rows
 * that were no longer visible are reported separately from rows that failed to
 * write, so a reviewer can tell "rejected" from "errored" from "not attempted".
 */
export function summariseBulkEdit(plan: BulkEditPlan, results: BulkRowResult[]): BulkEditOutcome {
  const succeeded = results.filter((r) => r.ok).map((r) => r.id);
  const writeFailures = results
    .filter((r) => !r.ok)
    .map((r) => ({ id: r.id, reason: r.reason ?? 'update failed' }));

  return {
    successCount: succeeded.length,
    failedCount: writeFailures.length + plan.invalid.length,
    skippedCount: plan.skipped.length,
    succeeded,
    failed: [...plan.invalid, ...writeFailures],
    skipped: plan.skipped,
    totalSelected: plan.totalSelected,
  };
}

/** Bilingual confirmation text; the count is always the exact execution count. */
export function confirmationMessage(count: number, language: 'ar' | 'en'): string {
  return language === 'ar'
    ? `سيتم تعديل ${count} سجل محدد فقط. هل تريد المتابعة؟`
    : `Only ${count} selected record(s) will be modified. Continue?`;
}

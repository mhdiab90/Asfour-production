/**
 * Entity import sessions - Phase 1 Step 8C-2. Pure and Firebase-free.
 *
 * ONE row model for importing the entities the system already defines (jobs and
 * sub-jobs, batches, BOMs and their versions, routings and their versions, and
 * traced production with its consumption lines and outputs). It is the same
 * philosophy the existing historical-import panels already use - a row is
 * reviewed, corrected, included or left out, and one bad row never stops the
 * others - generalised so every entity shares it instead of growing a second
 * import engine.
 *
 * THE SOURCE ROW IS EVIDENCE. `originalRowData` is written once and never
 * changed: a correction is stored beside it in `correctedRowData`, and the
 * payload actually validated and written is the original with the corrections
 * applied. Every decision is appended to `resolutionHistory` with the user, the
 * time and the reason, so "what did the file say, what did we change, and who
 * said so" stays answerable after the import.
 *
 * VALIDATION IS THE EXISTING VALIDATION. This file never decides whether a job,
 * batch, BOM, routing, consumption line or output is valid - it calls the same
 * pure validators the forms use (importEntityValidationPure.ts) and records the
 * result. So a corrected row is re-checked by exactly the rules that refused it.
 *
 * NOTHING IS WRITTEN FROM HERE. `planImport` says which rows are eligible;
 * the service performs each write on its own and reports per-row results, so 98
 * good rows import while 2 unexpected failures stay reviewable and reprocessable
 * under the SAME import id.
 */

export const IMPORT_ROW_STATUSES = [
  'VALID',
  'WARNING',
  'BLOCKING',
  'CORRECTED',
  'SKIPPED',
  'EXCLUDED',
  'READY_TO_IMPORT',
  'IMPORTED',
  'FAILED',
] as const;
export type ImportRowStatus = (typeof IMPORT_ROW_STATUSES)[number];

/** The entities this foundation can import. Stages with no record type are deliberately absent. */
export const IMPORT_ENTITY_KINDS = [
  'jobReferences',
  'batches',
  'boms',
  'bomVersions',
  'routings',
  'routingVersions',
  'production',
  /*
   * Master Data package (the reconciled Product Master / Mixes package):
   *   products     one product of the product master
   *   materials    one raw material of the product master
   *   bomPackage   one BOM together with its single version and components,
   *                because a version cannot exist before its BOM has an id
   * All three are UPSERTS: an existing record is updated, never duplicated.
   */
  'products',
  'materials',
  'bomPackage',
] as const;

/**
 * Line kinds a multi-sheet workbook can produce on their own (Phase 1 Step 8C-4):
 * a consumption or output row that belongs to no production record. They are
 * never selectable and never writable - they exist so an orphan line is VISIBLE
 * in the review instead of being silently attached to a neighbouring record.
 */
export const IMPORT_LINE_KINDS = ['consumptionLine', 'outputLine'] as const;

/**
 * Row kinds of the three-file Odoo import (Phase 1 Step 8D) - see
 * odooImportSessionPure.ts. They reuse this lifecycle unchanged; they are
 * written by their own service, never by executeEntityImport.
 */
export const ODOO_SOURCE_KINDS = ['odooProduction', 'odooWorkOrder', 'odooScrap'] as const;

export type ImportEntityKind =
  | (typeof IMPORT_ENTITY_KINDS)[number]
  | (typeof IMPORT_LINE_KINDS)[number]
  | (typeof ODOO_SOURCE_KINDS)[number];

export type ImportRowSelection = 'INCLUDED' | 'EXCLUDED' | 'SKIPPED';

export interface ImportIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface ImportDecision {
  at: string;
  user: string;
  action: 'CORRECTED' | 'INCLUDED' | 'EXCLUDED' | 'SKIPPED' | 'REVALIDATED' | 'IMPORTED' | 'FAILED' | 'APPROVED_WARNINGS';
  field?: string;
  from?: unknown;
  to?: unknown;
  reason?: string;
}

export interface ImportRow {
  /** Stable within the session, so a decision always names the same row. */
  rowId: string;
  entityKind: ImportEntityKind;
  sourceRowNumber: number;
  /** Exactly what the file said. Written once, never rewritten. */
  originalRowData: Readonly<Record<string, unknown>>;
  /** Only the fields a user changed, never a copy of the whole row. */
  correctedRowData: Record<string, unknown> | null;
  /** What the shared validator produced for the payload - the shape that would be written. */
  normalizedData: Record<string, unknown> | null;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** True once a user accepted the row's warnings. Errors are never "accepted". */
  warningsAccepted: boolean;
  status: ImportRowStatus;
  selection: ImportRowSelection;
  resolutionHistory: ImportDecision[];
  /** Set once the row is written. */
  importedId: string | null;
  /** Set when a write failed unexpectedly - the row stays reviewable. */
  failureMessage: string | null;
}

export interface ImportSession {
  importId: string;
  sourceFile: string;
  sourceSheet: string;
  createdBy: string;
  createdAt: string;
  rows: ImportRow[];
}

function clone(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

/** A new row, straight from the file. Nothing is validated yet. */
export function createImportRow(entityKind: ImportEntityKind, sourceRowNumber: number, originalRowData: Record<string, unknown>, rowId?: string): ImportRow {
  return {
    rowId: rowId ?? `${entityKind}:${sourceRowNumber}`,
    entityKind,
    sourceRowNumber,
    originalRowData: Object.freeze(clone(originalRowData)),
    correctedRowData: null,
    normalizedData: null,
    errors: [],
    warnings: [],
    warningsAccepted: false,
    status: 'BLOCKING',
    selection: 'INCLUDED',
    resolutionHistory: [],
    importedId: null,
    failureMessage: null,
  };
}

export function createImportSession(input: { importId: string; sourceFile: string; sourceSheet?: string; createdBy: string; createdAt: string; rows: ImportRow[] }): ImportSession {
  return {
    importId: input.importId,
    sourceFile: input.sourceFile,
    sourceSheet: input.sourceSheet ?? '',
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    rows: input.rows,
  };
}

/** What is actually validated and written: the source row with the user's corrections applied. */
export function rowPayload(row: ImportRow): Record<string, unknown> {
  return { ...row.originalRowData, ...(row.correctedRowData ?? {}) };
}

/** Whether a user changed anything on this row. */
export function isCorrected(row: ImportRow): boolean {
  return row.correctedRowData !== null && Object.keys(row.correctedRowData).length > 0;
}

/** The status a row's current validation implies, before any write. */
function statusFromValidation(row: ImportRow): ImportRowStatus {
  if (row.selection === 'SKIPPED') return 'SKIPPED';
  if (row.selection === 'EXCLUDED') return 'EXCLUDED';
  if (row.errors.length > 0) return 'BLOCKING';
  if (isCorrected(row)) return 'CORRECTED';
  if (row.warnings.length > 0) return row.warningsAccepted ? 'READY_TO_IMPORT' : 'WARNING';
  return 'VALID';
}

/**
 * Records a correction: the corrected fields, the reason, the user and the
 * time. The source row is untouched, and the row must be revalidated - by the
 * same rules - before it can be written again.
 */
export function applyRowCorrection(row: ImportRow, patch: Record<string, unknown>, meta: { user: string; at: string; reason?: string }): ImportRow {
  const before = rowPayload(row);
  const changedFields = Object.keys(patch).filter((f) => before[f] !== patch[f]);
  if (changedFields.length === 0) return row;
  const corrected = { ...(row.correctedRowData ?? {}), ...patch };
  const history: ImportDecision[] = [
    ...row.resolutionHistory,
    ...changedFields.map((field) => ({ at: meta.at, user: meta.user, action: 'CORRECTED' as const, field, from: before[field], to: patch[field], reason: meta.reason })),
  ];
  return { ...row, correctedRowData: corrected, resolutionHistory: history, failureMessage: null };
}

/** Stores a fresh validation result and the status it implies. Never changes the data. */
export function applyValidation(row: ImportRow, result: { errors: ImportIssue[]; warnings: ImportIssue[]; normalized?: Record<string, unknown> | null }, meta?: { user: string; at: string }): ImportRow {
  const next: ImportRow = {
    ...row,
    errors: [...result.errors],
    warnings: [...result.warnings],
    normalizedData: result.normalized ?? null,
    // A warning acceptance survives only while the same warnings stand.
    warningsAccepted: row.warningsAccepted && result.warnings.length > 0,
  };
  const withStatus = { ...next, status: statusFromValidation(next) };
  return meta ? { ...withStatus, resolutionHistory: [...withStatus.resolutionHistory, { at: meta.at, user: meta.user, action: 'REVALIDATED' }] } : withStatus;
}

/** Include, exclude or skip a row. Excluded and skipped rows are never written. */
export function setRowSelection(row: ImportRow, selection: ImportRowSelection, meta: { user: string; at: string; reason?: string }): ImportRow {
  const next: ImportRow = { ...row, selection };
  return {
    ...next,
    status: statusFromValidation(next),
    resolutionHistory: [...row.resolutionHistory, { at: meta.at, user: meta.user, action: selection === 'INCLUDED' ? 'INCLUDED' : selection === 'SKIPPED' ? 'SKIPPED' : 'EXCLUDED', reason: meta.reason }],
  };
}

/** Accepts the row's warnings. Errors can never be accepted this way. */
export function acceptRowWarnings(row: ImportRow, meta: { user: string; at: string; reason?: string }): ImportRow {
  if (row.warnings.length === 0) return row;
  const next: ImportRow = { ...row, warningsAccepted: true };
  return {
    ...next,
    status: statusFromValidation(next),
    resolutionHistory: [...row.resolutionHistory, { at: meta.at, user: meta.user, action: 'APPROVED_WARNINGS', reason: meta.reason }],
  };
}

/**
 * Whether this row may be written right now: it is INCLUDED, has no blocking
 * error, and any warning was accepted. A BLOCKING, SKIPPED, EXCLUDED or
 * unselected row is never eligible, and an already imported row is never
 * written twice.
 */
export function isRowWritable(row: ImportRow): boolean {
  if (row.selection !== 'INCLUDED') return false;
  if (row.status === 'IMPORTED') return false;
  // A failed row waits for an explicit reprocess decision - it is never retried silently.
  if (row.status === 'FAILED') return false;
  if (row.errors.length > 0) return false;
  if (row.warnings.length > 0 && !row.warningsAccepted) return false;
  return true;
}

/** The rows that will be written, and the ones that will not - stated before anything happens. */
export function planImport(session: ImportSession): { willImport: ImportRow[]; willRemain: ImportRow[] } {
  const willImport = session.rows.filter(isRowWritable);
  const ids = new Set(willImport.map((r) => r.rowId));
  return { willImport, willRemain: session.rows.filter((r) => !ids.has(r.rowId)) };
}

export interface ImportSummary {
  total: number;
  selected: number;
  ready: number;
  corrected: number;
  warnings: number;
  blocking: number;
  skipped: number;
  excluded: number;
  willImport: number;
  imported: number;
  failed: number;
}

export function summariseSession(session: ImportSession): ImportSummary {
  const rows = session.rows;
  const count = (fn: (r: ImportRow) => boolean) => rows.filter(fn).length;
  return {
    total: rows.length,
    selected: count((r) => r.selection === 'INCLUDED'),
    ready: count((r) => isRowWritable(r) && !isCorrected(r)),
    corrected: count((r) => isCorrected(r)),
    warnings: count((r) => r.warnings.length > 0),
    blocking: count((r) => r.status === 'BLOCKING'),
    skipped: count((r) => r.selection === 'SKIPPED'),
    excluded: count((r) => r.selection === 'EXCLUDED'),
    willImport: count(isRowWritable),
    imported: count((r) => r.status === 'IMPORTED'),
    failed: count((r) => r.status === 'FAILED'),
  };
}

/** The confirmation sentence shown before writing - exact counts, never a promise. */
export function importConfirmation(session: ImportSession, language: 'ar' | 'en'): string {
  const s = summariseSession(session);
  const remaining = s.total - s.willImport;
  return language === 'ar'
    ? `سيتم استيراد ${s.willImport} سجل فقط. سيبقى ${remaining} سجل بدون استيراد. هل تريد المتابعة؟`
    : `Only ${s.willImport} records will be imported. ${remaining} records will remain unimported. Continue?`;
}

/** The result of one write, recorded on its own row - one failure never touches another row. */
export function applyRowResult(row: ImportRow, result: { ok: boolean; id?: string | null; error?: string | null }, meta: { user: string; at: string }): ImportRow {
  if (result.ok) {
    return {
      ...row,
      status: 'IMPORTED',
      importedId: result.id ?? null,
      failureMessage: null,
      resolutionHistory: [...row.resolutionHistory, { at: meta.at, user: meta.user, action: 'IMPORTED' }],
    };
  }
  return {
    ...row,
    status: 'FAILED',
    failureMessage: result.error ?? 'unknown error',
    resolutionHistory: [...row.resolutionHistory, { at: meta.at, user: meta.user, action: 'FAILED', reason: result.error ?? undefined }],
  };
}

/** Failed rows stay reviewable, and can be corrected and reprocessed under the same import id. */
export function reprocessableRows(session: ImportSession): ImportRow[] {
  return session.rows.filter((r) => r.status === 'FAILED' && r.selection === 'INCLUDED');
}

/** Puts a failed row back into review without losing its history or its source data. */
export function prepareRowForReprocess(row: ImportRow): ImportRow {
  if (row.status !== 'FAILED') return row;
  const next: ImportRow = { ...row, failureMessage: null };
  return { ...next, status: statusFromValidation(next) };
}

/** Replaces one row in a session, leaving every other row untouched. */
export function replaceRow(session: ImportSession, row: ImportRow): ImportSession {
  return { ...session, rows: session.rows.map((r) => (r.rowId === row.rowId ? row : r)) };
}

/** One audit line per row - what the file said, what was changed, what happened. */
export function describeRowOutcome(session: ImportSession, row: ImportRow): string {
  const corrections = row.resolutionHistory.filter((d) => d.action === 'CORRECTED').map((d) => `${d.field}: ${String(d.from ?? '-')} -> ${String(d.to ?? '-')}`);
  const parts = [
    `[IMPORT_ROW] ${session.importId}`,
    `${row.entityKind} row ${row.sourceRowNumber}`,
    `status ${row.status}`,
    `selection ${row.selection}`,
  ];
  if (row.importedId) parts.push(`id ${row.importedId}`);
  if (corrections.length) parts.push(`corrected: ${corrections.join('; ')}`);
  if (row.failureMessage) parts.push(`failure: ${row.failureMessage}`);
  if (row.errors.length) parts.push(`errors: ${row.errors.map((e) => e.messageEn).join('; ')}`);
  return parts.join(' | ');
}

/** The session-level audit line, for the existing audit log. */
export function describeImportSession(session: ImportSession): string {
  const s = summariseSession(session);
  return `[ENTITY_IMPORT] ${session.importId} file "${session.sourceFile}"${session.sourceSheet ? ` sheet "${session.sourceSheet}"` : ''}: ${s.total} rows, ${s.imported} imported, ${s.failed} failed, ${s.blocking} blocking, ${s.skipped} skipped, ${s.excluded} excluded, ${s.corrected} corrected`;
}

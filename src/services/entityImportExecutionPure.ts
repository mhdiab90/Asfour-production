/**
 * The entity-import execution loop - Firebase-free, so it can be exercised with a
 * stand-in writer. entityImportService passes the real one (the existing audited
 * services); nothing here writes on its own.
 *
 * WHAT IT GUARANTEES
 *   - Every eligible row is revalidated immediately before it is written, with
 *     the SAME function the review used (resolveAndValidateImportRow); a row that
 *     no longer passes is dropped and reported, never written.
 *   - Row isolation: each write sits in its own try/catch and its outcome is
 *     recorded on that row only. Nothing is rolled back.
 *   - Dependency order (Master Data package), in three phases:
 *       1. products and materials are written, and the id each write returns is
 *          captured;
 *       2. every BOM's pending package-item tokens are bound to those ids (a
 *          token whose item was not written is reported and the BOM dropped -
 *          a token is never written);
 *       3. the BOMs are revalidated against the existing items PLUS the items
 *          written in this run, and written.
 *   - A row already written earlier in the same file is seen by the next row of
 *     the SAME kind (`pendingSameKind`), so an in-file duplicate is caught - and a
 *     product can never be mistaken for a BOM of the same code.
 *
 * LARGE IMPORTS (3.21.2). Rows are processed in batches. After every batch the
 * loop reports its progress and yields to the browser, so a 30,000-row package
 * never freezes the page. Within a batch, writes may run a few at a time
 * (`concurrency`, used only for the de-duplicated Master Data package); every
 * other import keeps the strict one-row-at-a-time order. The loop can be asked to
 * stop between batches, stops by itself after a run of consecutive failures (a
 * lost connection, a refused permission), and never throws: an unexpected error
 * ends the run as INTERRUPTED with every completed row kept.
 *
 * THE RESULT IS THE LOOP'S OWN. Counts, the phases completed, the verification
 * and the percentage come from here - the screen never computes them itself.
 *
 * Rows keep their original order in the result, whatever order they were written in.
 */
import { applyRowResult, applyValidation, isRowWritable, planImport, rowPayload } from './entityImportPure';
import type { ImportRow, ImportSession } from './entityImportPure';
import { resolveAndValidateImportRow } from './importEntityValidationPure';
import type { ImportValidationContext, ImportValidationResult } from './importEntityValidationPure';
import type { ReferenceIndexes, ReferenceMappingCache } from './referenceResolutionPure';
import { bindPackageItemReferences, isPackageItemToken, packageItemKey } from './masterDataPackageSessionPure';

type Stored = Record<string, unknown> & { id?: string };

export interface ExecuteRowsOptions {
  indexes: ReferenceIndexes;
  mappingCache?: ReferenceMappingCache;
  user: string;
  at: () => string;
  language: 'ar' | 'en';
  /** Rows per batch; progress is reported and the browser is yielded to after each. Default 250. */
  batchSize?: number;
  /** Writes in flight at once inside a batch. Default 1 (strict order). */
  concurrency?: number;
  /** Called after every batch and at every phase change, with a fresh snapshot. */
  onProgress?: (progress: ImportExecutionProgress) => void;
  /** Hands control back to the browser between batches. Default: a zero-delay timer. */
  yieldToUi?: () => Promise<void>;
  /** Checked between batches; true stops the run as INTERRUPTED (resumable). */
  shouldStop?: () => boolean;
  /** Consecutive failed writes that end the run as INTERRUPTED. Default: never. */
  maxConsecutiveFailures?: number;
}

/** Writes one row through its existing service; returns the ASFOUR id it wrote or updated. */
export type ImportRowWriter = (row: ImportRow, context: ImportValidationContext) => Promise<string | undefined>;

/** Called after every attempted write, with the row's outcome and its final validation. */
export type ImportRowObserver = (row: ImportRow, recheck: ImportValidationResult) => void;

// ==================================================================================
// Progress and result
// ==================================================================================

export type ImportExecutionState = 'IMPORTING' | 'VERIFYING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'INTERRUPTED';
/** RECORDS is the single phase of an import without BOMs; ITEMS / DEPENDENCIES / BOMS are the package's three. */
export type ImportExecutionPhase = 'PREPARING' | 'RECORDS' | 'ITEMS' | 'DEPENDENCIES' | 'BOMS' | 'VERIFYING' | 'DONE';

export interface KindCounts {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export interface ImportExecutionProgress {
  state: ImportExecutionState;
  phase: ImportExecutionPhase;
  /** 1-based number of the running phase, and how many phases this import has (1 or 3). */
  phaseNumber: number;
  phaseCount: number;
  /** Rows the approved plan will write - the whole workload. */
  total: number;
  /** Rows whose outcome is decided: written, failed, or dropped before write. */
  processed: number;
  succeeded: number;
  failed: number;
  /** Planned rows not written because they no longer passed, or their package item was not written. */
  skipped: number;
  /** Written rows that carried (accepted) warnings. */
  warnings: number;
  byKind: Record<string, KindCounts>;
  /** The kind being processed, and the position within the running phase. */
  currentKind: string | null;
  phaseProcessed: number;
  phaseTotal: number;
  /** The last row failure, for the live display. */
  lastError: string | null;
  /** Set when the run stopped early. */
  error: string | null;
  /** Always true while no row was ever written twice: a re-run updates, never duplicates. */
  resumable: boolean;
}

export interface ImportRowIssue {
  rowId: string;
  kind: string;
  code: string;
  reason: string;
}

export interface ImportFinalResult {
  outcome: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'INTERRUPTED';
  /** 100 only when every phase ran and the verification passed. */
  percent: number;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  warnings: number;
  byKind: Record<string, KindCounts>;
  /** Rows the plan never included (blocked, skipped, excluded, warnings not accepted) - by kind. */
  notPlanned: Record<string, number>;
  failures: ImportRowIssue[];
  dropped: ImportRowIssue[];
  phasesCompleted: ImportExecutionPhase[];
  verification: { ok: boolean; issues: string[] };
  /** The phase the run was in when it stopped, and why. */
  stoppedIn: ImportExecutionPhase | null;
  error: string | null;
  resumable: boolean;
}

export interface ExecuteRowsResult {
  rows: ImportRow[];
  droppedBeforeWrite: Array<{ rowId: string; reason: string }>;
  progress: ImportExecutionProgress;
  result: ImportFinalResult;
}

/**
 * The percentage a progress snapshot may show: floor(processed / total), clamped
 * to 0..100 - and never 100 until the run has actually completed and verified.
 */
export function progressPercent(progress: Pick<ImportExecutionProgress, 'state' | 'processed' | 'total'>, verified = false): number {
  const done = (progress.state === 'COMPLETED' || progress.state === 'COMPLETED_WITH_ERRORS') && verified;
  if (done) return 100;
  if (progress.total <= 0) return progress.state === 'VERIFYING' ? 99 : 0;
  const raw = Math.floor((progress.processed / progress.total) * 100);
  return Math.max(0, Math.min(99, raw));
}

/** Items the rest of a run depends on are written first; everything else keeps its file order. */
function phaseOf(row: ImportRow): number {
  return row.entityKind === 'bomPackage' ? 1 : 0;
}

/** True when a payload still carries a pending package-item token anywhere. */
export function carriesPackageItemToken(value: unknown): boolean {
  if (isPackageItemToken(value)) return true;
  if (Array.isArray(value)) return value.some(carriesPackageItemToken);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(carriesPackageItemToken);
  return false;
}

const codeOf = (row: ImportRow): string => {
  const d = (row.normalizedData ?? row.originalRowData) as Record<string, unknown>;
  return String(d.code ?? (d.bom as Record<string, unknown> | undefined)?.code ?? '');
};

const defaultYield = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function executeImportRows(
  session: ImportSession,
  context: ImportValidationContext,
  options: ExecuteRowsOptions,
  write: ImportRowWriter,
  observe?: ImportRowObserver,
): Promise<ExecuteRowsResult> {
  const batchSize = Math.max(1, Math.floor(options.batchSize ?? 250));
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
  const yieldToUi = options.yieldToUi ?? defaultYield;
  const maxConsecutiveFailures = options.maxConsecutiveFailures ?? Number.POSITIVE_INFINITY;

  const droppedBeforeWrite: Array<{ rowId: string; reason: string }> = [];
  const eligible = new Set(planImport(session).willImport.map((r) => r.rowId));
  const pendingByKind = new Map<string, Array<Record<string, unknown> & { id?: string }>>();
  /** Package item key (kind:CODE) -> the ASFOUR id its row wrote in this run. */
  const writtenItemIds = new Map<string, string>();
  /** Items CREATED in this run, so a BOM's final validation knows them. */
  const createdItems: { products: Stored[]; materials: Stored[] } = { products: [], materials: [] };
  const outcome = new Map<string, ImportRow>();
  /**
   * The context every BOM is validated and written against: the existing items
   * plus those created in this run. Built once, in the dependency phase - all
   * items are written by then - so its arrays stay the same objects and the
   * validators' per-list lookups are built once.
   */
  let bomContext: ImportValidationContext | null = null;

  const order = session.rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => phaseOf(a.row) - phaseOf(b.row) || a.index - b.index)
    .map(({ row }) => row);
  const planned = order.filter((row) => eligible.has(row.rowId));
  for (const row of order) if (!eligible.has(row.rowId)) outcome.set(row.rowId, row);
  const itemRows = planned.filter((row) => phaseOf(row) === 0);
  const bomRows = planned.filter((row) => phaseOf(row) === 1);
  const packageMode = bomRows.length > 0;

  const byKind: Record<string, KindCounts> = {};
  for (const row of planned) {
    byKind[row.entityKind] ??= { total: 0, succeeded: 0, failed: 0, skipped: 0 };
    byKind[row.entityKind].total++;
  }
  const progress: ImportExecutionProgress = {
    state: 'IMPORTING',
    phase: 'PREPARING',
    phaseNumber: 0,
    phaseCount: packageMode ? 3 : 1,
    total: planned.length,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    warnings: 0,
    byKind,
    currentKind: null,
    phaseProcessed: 0,
    phaseTotal: 0,
    lastError: null,
    error: null,
    resumable: true,
  };
  const phasesCompleted: ImportExecutionPhase[] = [];
  const failures: ImportRowIssue[] = [];
  const dropped: ImportRowIssue[] = [];
  let consecutiveFailures = 0;
  let stopReason: string | null = null;

  const snapshot = (): ImportExecutionProgress => ({
    ...progress,
    byKind: Object.fromEntries(Object.entries(progress.byKind).map(([k, v]) => [k, { ...v }])),
  });
  const emit = () => options.onProgress?.(snapshot());
  const enterPhase = (phase: ImportExecutionPhase, phaseNumber: number, phaseTotal: number) => {
    progress.phase = phase;
    progress.phaseNumber = phaseNumber;
    progress.phaseTotal = phaseTotal;
    progress.phaseProcessed = 0;
    progress.currentKind = null;
    emit();
  };
  const markDropped = (row: ImportRow, reason: string) => {
    droppedBeforeWrite.push({ rowId: row.rowId, reason });
    dropped.push({ rowId: row.rowId, kind: row.entityKind, code: codeOf(row), reason });
    progress.processed++;
    progress.skipped++;
    byKind[row.entityKind].skipped++;
  };
  /** Between batches: report, hand the browser a turn, and honour a stop request. */
  const afterBatch = async (): Promise<boolean> => {
    emit();
    await yieldToUi();
    if (stopReason) return false;
    if (options.shouldStop?.()) {
      stopReason = options.language === 'ar' ? 'أوقف المستخدم الاستيراد بين دفعتين.' : 'The import was stopped by the user between two batches.';
      return false;
    }
    return true;
  };

  /** One row: final revalidation, then its own write. Never throws. */
  const handleRow = async (row: ImportRow, payload: Record<string, unknown>, rowContext: ImportValidationContext): Promise<void> => {
    let pendingSameKind = pendingByKind.get(row.entityKind);
    if (!pendingSameKind) {
      pendingSameKind = [];
      pendingByKind.set(row.entityKind, pendingSameKind);
    }
    const recheck = resolveAndValidateImportRow(row.entityKind, payload, { ...rowContext, pendingSameKind }, options.indexes, options.mappingCache);
    let current = applyValidation(row, recheck, { user: options.user, at: options.at() });
    if (!isRowWritable(current)) {
      droppedBeforeWrite.push({
        rowId: current.rowId,
        reason: current.errors.map((e) => (options.language === 'ar' ? e.messageAr : e.messageEn)).join(' | ') || 'no longer eligible',
      });
      dropped.push({ rowId: current.rowId, kind: current.entityKind, code: codeOf(current), reason: droppedBeforeWrite[droppedBeforeWrite.length - 1].reason });
      progress.processed++;
      progress.phaseProcessed++;
      progress.skipped++;
      byKind[current.entityKind].skipped++;
      outcome.set(current.rowId, current);
      return;
    }

    try {
      if (carriesPackageItemToken(current.normalizedData)) {
        // Defence in depth: a pending token is never an id and is never written.
        throw new Error('A pending package-item reference was not bound to an ASFOUR id.');
      }
      const id = await write(current, rowContext);
      current = applyRowResult(current, { ok: true, id: id ?? null }, { user: options.user, at: options.at() });
      if (id) {
        pendingSameKind.push({ ...(current.normalizedData ?? {}), id });
        if (row.entityKind === 'products' || row.entityKind === 'materials') {
          const data = (current.normalizedData ?? {}) as Record<string, unknown>;
          const code = String(data.code ?? '');
          if (code) writtenItemIds.set(packageItemKey(row.entityKind, code), id);
          if (!data.existingId) {
            const { existingId: _existingId, upsertAction: _upsertAction, matchedBy: _matchedBy, ...record } = data;
            createdItems[row.entityKind].push({ ...record, id });
          }
        }
      }
    } catch (err: any) {
      // One row's failure is recorded on that row only - never a rollback.
      current = applyRowResult(current, { ok: false, error: String(err?.message ?? err) }, { user: options.user, at: options.at() });
    }
    progress.processed++;
    progress.phaseProcessed++;
    if (current.status === 'IMPORTED') {
      progress.succeeded++;
      byKind[current.entityKind].succeeded++;
      if (current.warnings.length > 0) progress.warnings++;
      consecutiveFailures = 0;
    } else {
      progress.failed++;
      byKind[current.entityKind].failed++;
      progress.lastError = current.failureMessage;
      failures.push({ rowId: current.rowId, kind: current.entityKind, code: codeOf(current), reason: current.failureMessage ?? 'unknown error' });
      consecutiveFailures++;
      if (consecutiveFailures >= maxConsecutiveFailures && !stopReason) {
        stopReason = options.language === 'ar'
          ? `توقف الاستيراد بعد ${consecutiveFailures} عمليات كتابة فاشلة متتالية. آخر خطأ: ${current.failureMessage}`
          : `The import stopped after ${consecutiveFailures} consecutive failed writes. Last error: ${current.failureMessage}`;
      }
    }
    try {
      observe?.(current, recheck);
    } catch {
      // An observer (the audit line) never decides a row's outcome.
    }
    outcome.set(current.rowId, current);
  };

  /** A phase's rows, a batch at a time, each batch written `concurrency` rows at a time. */
  const runRows = async (rows: Array<{ row: ImportRow; payload: Record<string, unknown>; rowContext: ImportValidationContext }>): Promise<boolean> => {
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      progress.currentKind = batch[0]?.row.entityKind ?? null;
      for (let i = 0; i < batch.length; i += concurrency) {
        await Promise.all(batch.slice(i, i + concurrency).map(({ row, payload, rowContext }) => handleRow(row, payload, rowContext)));
        if (stopReason) break;
      }
      if (!(await afterBatch())) return false;
    }
    return true;
  };

  let fatal: string | null = null;
  try {
    emit();
    // --- Phase 1: every row that is not a BOM (the package's products and materials) ---------------
    enterPhase(packageMode ? 'ITEMS' : 'RECORDS', 1, itemRows.length);
    let completed = await runRows(itemRows.map((row) => ({ row, payload: rowPayload(row), rowContext: context })));
    if (completed) phasesCompleted.push(packageMode ? 'ITEMS' : 'RECORDS');

    // --- Phase 2: bind every BOM to the ids its items received ------------------------------------
    const readyBoms: Array<{ row: ImportRow; payload: Record<string, unknown>; rowContext: ImportValidationContext }> = [];
    if (completed && packageMode) {
      enterPhase('DEPENDENCIES', 2, bomRows.length);
      bomContext ??= {
        ...context,
        products: [...(context.products ?? []), ...createdItems.products],
        materials: [...(context.materials ?? []), ...createdItems.materials],
      };
      for (let start = 0; start < bomRows.length && completed; start += batchSize) {
        for (const row of bomRows.slice(start, start + batchSize)) {
          progress.currentKind = row.entityKind;
          const bound = bindPackageItemReferences(rowPayload(row), writtenItemIds);
          progress.phaseProcessed++;
          if (bound.unresolved.length > 0) {
            const codes = bound.unresolved.map((k) => k.slice(k.indexOf(':') + 1)).join(', ');
            markDropped(row, options.language === 'ar'
              ? `صنف من نفس الحزمة لم يُكتب في هذا الاستيراد: ${codes}`
              : `A package item was not written in this import: ${codes}`);
            outcome.set(row.rowId, row);
            continue;
          }
          readyBoms.push({ row, payload: bound.payload, rowContext: bomContext });
        }
        completed = await afterBatch();
      }
      if (completed) phasesCompleted.push('DEPENDENCIES');
    }

    // --- Phase 3: the BOMs, against the items that now exist ---------------------------------------
    if (completed && packageMode) {
      enterPhase('BOMS', 3, readyBoms.length);
      completed = await runRows(readyBoms);
      if (completed) phasesCompleted.push('BOMS');
    }
  } catch (err: any) {
    // Nothing escapes: completed rows are kept, and the run is reported as interrupted.
    fatal = String(err?.message ?? err);
  }

  const rows = session.rows.map((r) => outcome.get(r.rowId) ?? r);

  // --- Final verification: the counters, the phases and every planned row's outcome --------------
  const requiredPhases: ImportExecutionPhase[] = packageMode ? ['ITEMS', 'DEPENDENCIES', 'BOMS'] : ['RECORDS'];
  const interrupted = Boolean(fatal || stopReason) || !requiredPhases.every((p) => phasesCompleted.includes(p));
  const phaseAtStop = progress.phase;
  progress.state = 'VERIFYING';
  progress.phase = 'VERIFYING';
  progress.currentKind = null;
  if (!interrupted) {
    try { emit(); } catch { /* the verification runs regardless */ }
  }
  const issues: string[] = [];
  if (progress.processed !== progress.total) issues.push(`${progress.processed} of ${progress.total} planned rows have an outcome`);
  if (progress.succeeded + progress.failed + progress.skipped !== progress.processed) issues.push('succeeded + failed + skipped does not equal processed');
  const droppedIds = new Set(droppedBeforeWrite.map((d) => d.rowId));
  const undecided = planned.filter((row) => {
    const final = outcome.get(row.rowId);
    return !(final && (final.status === 'IMPORTED' || final.status === 'FAILED' || droppedIds.has(row.rowId)));
  });
  if (undecided.length > 0) issues.push(`${undecided.length} planned row(s) have no recorded outcome`);
  for (const p of requiredPhases) if (!phasesCompleted.includes(p)) issues.push(`phase ${p} did not complete`);
  const verified = issues.length === 0 && !interrupted;

  const outcomeState: ImportFinalResult['outcome'] = interrupted
    ? 'INTERRUPTED'
    : progress.failed === 0 && progress.skipped === 0 && verified ? 'COMPLETED' : 'COMPLETED_WITH_ERRORS';
  progress.state = outcomeState;
  progress.phase = interrupted ? phaseAtStop : 'DONE';
  progress.error = fatal ?? stopReason;

  const notPlanned: Record<string, number> = {};
  for (const row of session.rows) if (!eligible.has(row.rowId)) notPlanned[row.entityKind] = (notPlanned[row.entityKind] ?? 0) + 1;

  const result: ImportFinalResult = {
    outcome: outcomeState,
    percent: progressPercent(progress, verified),
    total: progress.total,
    processed: progress.processed,
    succeeded: progress.succeeded,
    failed: progress.failed,
    skipped: progress.skipped,
    warnings: progress.warnings,
    byKind: snapshot().byKind,
    notPlanned,
    failures,
    dropped,
    phasesCompleted,
    verification: { ok: verified, issues },
    stoppedIn: interrupted ? phaseAtStop : null,
    error: progress.error,
    resumable: true,
  };
  try { emit(); } catch { /* the result is returned regardless */ }
  return { rows, droppedBeforeWrite, progress: snapshot(), result };
}

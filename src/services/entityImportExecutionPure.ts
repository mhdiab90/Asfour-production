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
 * NO WAIT IS UNBOUNDED (3.21.4). A record's write - duplicate lookup, write,
 * cache cleanup and audit line together - may take at most `recordTimeoutMs`
 * (IMPORT_RECORD_TIMEOUT_MS). Past it the loop stops waiting and records the row
 * as OUTCOME UNKNOWN: the server may or may not have committed it. That is never
 * reported as a confirmed failure, never retried in the same run, and never a
 * duplicate on a re-run (the next run matches the record by its identity, and the
 * master-data service refuses a second record with the same code). A stop request
 * (`stopSignal`) is honoured while a write is still pending: in-flight writes get
 * STOP_GRACE_MS to answer, then are recorded as outcome unknown, and no further
 * batch starts. Progress is also reported at most every `heartbeatMs` between
 * batches, with the time of the last recorded outcome, so a stall is visible.
 *
 * CONNECTION-AWARE (3.21.5). In production a silent network stall timed out
 * group after group of 4 records until the failure guard ended the run. Now,
 * after any group in which a record timed out, the loop asks the backend itself
 * (`probe`: a bounded, read-only server read). If the backend does not answer,
 * the run PAUSES in CONNECTION LOST - no new record starts, the timeouts do not
 * consume the failure guard, and the probe is repeated every `probeIntervalMs`
 * until the server answers (the run resumes with the next record), the user
 * stops (INTERRUPTED), or `maxPauseMs` passes (INTERRUPTED). A timed-out record
 * stays OUTCOME UNKNOWN and is never retried in the same run. If the backend
 * DOES answer while writes keep timing out, those count toward the guard.
 * Every timeout records the step it was waiting for (duplicate lookup, write,
 * cache cleanup, audit, BOM version), its times, and the browser's online and
 * visibility signals.
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

/** The longest a single record's write (lookup + write + cache cleanup + audit) is waited for. */
export const IMPORT_RECORD_TIMEOUT_MS = 90_000;
/** After a stop request, how long writes already in flight are still given to answer. */
export const STOP_GRACE_MS = 5_000;
/** At most one progress report per this interval between batches (the heartbeat). */
export const PROGRESS_HEARTBEAT_MS = 1_000;
/** The prefix of every outcome-unknown row message, so it is never mistaken for a confirmed failure. */
export const OUTCOME_UNKNOWN_PREFIX = 'OUTCOME UNKNOWN';
/** How long one backend probe may take before it counts as "no answer". */
export const CONNECTION_PROBE_TIMEOUT_MS = 15_000;
/** How often a paused run asks the backend again. */
export const CONNECTION_PROBE_INTERVAL_MS = 10_000;
/** The longest a run waits for the backend to come back before it stops as INTERRUPTED. */
export const CONNECTION_MAX_PAUSE_MS = 30 * 60_000;

/** The awaited step of a record's write that was running when it timed out. */
export type ImportWriteStep = 'PREPARING' | 'DUPLICATE_LOOKUP' | 'FIRESTORE_WRITE' | 'CACHE_CLEANUP' | 'AUDIT_WRITE' | 'BOM_VERSION_WRITE' | string;
export type ConnectionState = 'OK' | 'CHECKING' | 'LOST';

/** What the browser says about itself at a moment - informational, never proof of reachability. */
export interface ImportEnvironmentSignal {
  online: boolean | null;
  visibility: string | null;
}

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
  /** Consecutive failed or timed-out writes that end the run as INTERRUPTED. Default: never. */
  maxConsecutiveFailures?: number;
  /** A record's longest wait. Default IMPORT_RECORD_TIMEOUT_MS. */
  recordTimeoutMs?: number;
  /** Aborting it stops the run promptly - even while a write is pending. */
  stopSignal?: AbortSignal;
  /** Grace for in-flight writes after a stop. Default STOP_GRACE_MS. */
  stopGraceMs?: number;
  /** Heartbeat interval. Default PROGRESS_HEARTBEAT_MS. */
  heartbeatMs?: number;
  /** The clock (ms). Default Date.now - injectable for tests. */
  clock?: () => number;
  /** A bounded, read-only check that the backend answers. Without it, timeouts count toward the guard (3.21.4 behaviour). */
  probe?: () => Promise<unknown>;
  probeTimeoutMs?: number;
  probeIntervalMs?: number;
  maxPauseMs?: number;
  /** The browser's online / visibility signals, recorded on every timeout. */
  environment?: () => ImportEnvironmentSignal;
  /** Where a row came from, recorded on every timeout. */
  describeSource?: (row: ImportRow) => { file?: string; row?: number } | null;
}

/**
 * Writes one row through its existing service; returns the ASFOUR id it wrote or
 * updated. `track` is told which awaited step starts, so a timeout can name it.
 */
export type ImportRowWriter = (row: ImportRow, context: ImportValidationContext, track: (step: ImportWriteStep) => void) => Promise<string | undefined>;

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
  /** Timed out or cut by a stop: the server may or may not have committed them. */
  uncertain: number;
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
  /** Rows whose write did not answer in time (or was cut by a stop): outcome unknown, not failed. */
  uncertain: number;
  byKind: Record<string, KindCounts>;
  /** When the last row outcome was recorded (clock ms) - the heartbeat. */
  lastProgressAt: number;
  /** Writes currently waiting for the server. */
  inFlight: number;
  /** A stop was requested and is being honoured. */
  stopRequested: boolean;
  /** 3.21.5 - OK, CHECKING (probing the backend) or LOST (paused, waiting for the server). */
  connection: ConnectionState;
  /** When the current pause began (clock ms), or null. */
  pausedSince: number | null;
  /** Total time spent paused for the connection so far. */
  pausedMs: number;
  /** The last time the backend answered anything (a write or a probe). */
  lastBackendResponseAt: number | null;
  /** The last successful write. */
  lastWriteAt: number | null;
  /** The step the most recently started write is in. */
  pendingStep: ImportWriteStep | null;
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
  /** 3.21.5 - timeout diagnostics (outcome-unknown rows only). */
  phase?: string;
  step?: ImportWriteStep;
  startedAt?: number;
  timedOutAt?: number;
  online?: boolean | null;
  visibility?: string | null;
  sourceFile?: string;
  sourceRow?: number;
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
  /** Rows whose outcome is unknown (timed out / cut by a stop) - listed in `uncertainRows`. */
  uncertain: number;
  uncertainRows: ImportRowIssue[];
  byKind: Record<string, KindCounts>;
  /** Rows the plan never included (blocked, skipped, excluded, warnings not accepted) - by kind. */
  notPlanned: Record<string, number>;
  failures: ImportRowIssue[];
  dropped: ImportRowIssue[];
  phasesCompleted: ImportExecutionPhase[];
  verification: { ok: boolean; issues: string[] };
  /** The phase the run was in when it stopped, and why. */
  stoppedIn: ImportExecutionPhase | null;
  /** 3.21.5 - every pause for a lost connection, and the total paused time. */
  connectionPauses: Array<{ startedAt: number; endedAt: number; probes: number; recovered: boolean }>;
  pausedMs: number;
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

type Bounded<T> = { kind: 'value'; value: T } | { kind: 'error'; error: unknown } | { kind: 'timeout' } | { kind: 'stopped' };

/**
 * Waits for `work`, but never longer than `timeoutMs`, and - once `signal` aborts -
 * never longer than `graceMs` more. The work is not cancelled (Firestore writes
 * cannot be): its late settlement is simply ignored, and handled so it can never
 * surface as an unhandled rejection.
 */
export function waitBounded<T>(work: Promise<T>, timeoutMs: number, signal: AbortSignal | undefined, graceMs: number): Promise<Bounded<T>> {
  return new Promise<Bounded<T>>((resolve) => {
    let done = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: Bounded<T>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ kind: 'timeout' }), timeoutMs);
    const onAbort = () => {
      if (!graceTimer) graceTimer = setTimeout(() => finish({ kind: 'stopped' }), graceMs);
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort);
    }
    work.then((value) => finish({ kind: 'value', value }), (error) => finish({ kind: 'error', error }));
  });
}

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
  const recordTimeoutMs = Math.max(1, options.recordTimeoutMs ?? IMPORT_RECORD_TIMEOUT_MS);
  const stopGraceMs = Math.max(0, options.stopGraceMs ?? STOP_GRACE_MS);
  const heartbeatMs = Math.max(0, options.heartbeatMs ?? PROGRESS_HEARTBEAT_MS);
  const clock = options.clock ?? Date.now;
  const stopWanted = () => Boolean(options.stopSignal?.aborted) || Boolean(options.shouldStop?.());
  const probe = options.probe;
  const probeTimeoutMs = Math.max(1, options.probeTimeoutMs ?? CONNECTION_PROBE_TIMEOUT_MS);
  const probeIntervalMs = Math.max(0, options.probeIntervalMs ?? CONNECTION_PROBE_INTERVAL_MS);
  const maxPauseMs = Math.max(0, options.maxPauseMs ?? CONNECTION_MAX_PAUSE_MS);
  const environment = (): ImportEnvironmentSignal => {
    try { return options.environment?.() ?? { online: null, visibility: null }; } catch { return { online: null, visibility: null }; }
  };

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
    byKind[row.entityKind] ??= { total: 0, succeeded: 0, failed: 0, skipped: 0, uncertain: 0 };
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
    uncertain: 0,
    byKind,
    lastProgressAt: clock(),
    inFlight: 0,
    stopRequested: false,
    connection: 'OK',
    pausedSince: null,
    pausedMs: 0,
    lastBackendResponseAt: null,
    lastWriteAt: null,
    pendingStep: null,
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
  const uncertainRows: ImportRowIssue[] = [];
  /** Package items whose write outcome is unknown - a BOM on them says so. */
  const uncertainItemKeys = new Set<string>();
  let consecutiveFailures = 0;
  let stopReason: string | null = null;
  let stoppedWithPendingWrites = 0;
  let lastEmitAt = clock();
  /** Timeouts in the group now running - they decide whether the backend is checked. */
  let groupTimeouts = 0;
  /** Timeouts while the backend DID answer the probe - a slow server, counted toward the guard. */
  let unknownWhileReachable = 0;
  const connectionPauses: Array<{ startedAt: number; endedAt: number; probes: number; recovered: boolean }> = [];

  const snapshot = (): ImportExecutionProgress => ({
    ...progress,
    byKind: Object.fromEntries(Object.entries(progress.byKind).map(([k, v]) => [k, { ...v }])),
  });
  const emit = () => {
    lastEmitAt = clock();
    progress.stopRequested = stopWanted();
    options.onProgress?.(snapshot());
  };
  /** The heartbeat: a report between batches, at most every `heartbeatMs`. */
  const heartbeat = () => {
    if (clock() - lastEmitAt >= heartbeatMs) emit();
  };
  const stopMessage = () => {
    if (stoppedWithPendingWrites > 0) {
      return options.language === 'ar'
        ? `أوقف المستخدم الاستيراد - ${stoppedWithPendingWrites} عملية على الخادم لم ترد قبل التوقف (نتيجتها غير معروفة).`
        : `The import was stopped by the user - ${stoppedWithPendingWrites} server operation(s) did not respond before the stop (outcome unknown).`;
    }
    return options.language === 'ar' ? 'أوقف المستخدم الاستيراد بين دفعتين.' : 'The import was stopped by the user between two batches.';
  };
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
    if (stopWanted()) {
      stopReason = stopMessage();
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
      progress.inFlight++;
      const tracker: { step: ImportWriteStep; startedAt: number } = { step: 'PREPARING', startedAt: clock() };
      const track = (step: ImportWriteStep) => {
        tracker.step = step;
        progress.pendingStep = step;
      };
      let settled: Bounded<string | undefined>;
      try {
        settled = await waitBounded(Promise.resolve().then(() => write(current, rowContext, track)), recordTimeoutMs, options.stopSignal, stopGraceMs);
      } finally {
        progress.inFlight--;
      }
      if (settled.kind === 'timeout' || settled.kind === 'stopped') {
        // Not a confirmed failure: the server may have committed it after all.
        const code = codeOf(current);
        const phaseName = progress.phase;
        const limit = recordTimeoutMs >= 1000 ? `${Math.round(recordTimeoutMs / 1000)} s` : `${recordTimeoutMs} ms`;
        const why = settled.kind === 'timeout'
          ? (options.language === 'ar' ? `لم يرد الخادم خلال ${limit}` : `the server did not answer within ${limit}`)
          : (options.language === 'ar' ? 'أُوقف الاستيراد قبل أن يرد الخادم' : 'the import was stopped before the server answered');
        const message = options.language === 'ar'
          ? `${OUTCOME_UNKNOWN_PREFIX}: ${why} - "${code}" (المرحلة ${phaseName}، الخطوة ${tracker.step}). قد يكون الخادم قد حفظ السجل أو لم يحفظه؛ إعادة الاستيراد تطابقه ولا تكرره.`
          : `${OUTCOME_UNKNOWN_PREFIX}: ${why} - "${code}" (phase ${phaseName}, waiting for ${tracker.step}). The server may or may not have committed this write; a re-run matches it and never duplicates it.`;
        current = applyRowResult(current, { ok: false, error: message }, { user: options.user, at: options.at() });
        if (settled.kind === 'stopped') stoppedWithPendingWrites++;
        if (row.entityKind === 'products' || row.entityKind === 'materials') {
          const itemCode = String(((current.normalizedData ?? {}) as Record<string, unknown>).code ?? '');
          if (itemCode) uncertainItemKeys.add(packageItemKey(row.entityKind, itemCode));
        }
        progress.processed++;
        progress.phaseProcessed++;
        progress.uncertain++;
        byKind[current.entityKind].uncertain++;
        progress.lastError = message;
        progress.lastProgressAt = clock();
        const env = environment();
        const source = (() => { try { return options.describeSource?.(current) ?? null; } catch { return null; } })();
        uncertainRows.push({
          rowId: current.rowId, kind: current.entityKind, code, reason: message,
          phase: phaseName, step: tracker.step, startedAt: tracker.startedAt, timedOutAt: clock(),
          online: env.online, visibility: env.visibility,
          ...(source?.file ? { sourceFile: source.file } : {}),
          ...(source?.row !== undefined ? { sourceRow: source.row } : {}),
        });
        if (settled.kind === 'timeout') groupTimeouts++;
        // With a backend probe, a timeout is judged after the group: a lost connection pauses
        // the run instead of consuming the failure guard. Without one, the 3.21.4 rule applies.
        if (settled.kind === 'timeout' && !probe) {
          consecutiveFailures++;
          if (consecutiveFailures >= maxConsecutiveFailures && !stopReason) {
            stopReason = options.language === 'ar'
              ? `توقف الاستيراد بعد ${consecutiveFailures} عمليات كتابة متتالية فشلت أو لم يرد عليها الخادم. آخر رسالة: ${message}`
              : `The import stopped after ${consecutiveFailures} consecutive writes that failed or got no answer. Last: ${message}`;
          }
        }
        try { observe?.(current, recheck); } catch { /* the audit line never decides an outcome */ }
        outcome.set(current.rowId, current);
        heartbeat();
        return;
      }
      if (settled.kind === 'error') throw settled.error;
      const id = settled.value;
      progress.lastWriteAt = clock();
      progress.lastBackendResponseAt = progress.lastWriteAt;
      unknownWhileReachable = 0;
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
    progress.lastProgressAt = clock();
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
    heartbeat();
  };

  /** Waits `ms`, or less if a stop arrives. */
  const pauseFor = (ms: number) => waitBounded(new Promise<never>(() => {}), ms, options.stopSignal, 0).then(() => undefined);

  /** One bounded read-only backend check. */
  const backendAnswers = async (): Promise<boolean> => {
    if (!probe) return true;
    const answer = await waitBounded(Promise.resolve().then(() => probe()), probeTimeoutMs, undefined, 0);
    if (answer.kind === 'value') {
      progress.lastBackendResponseAt = clock();
      return true;
    }
    return false;
  };

  /**
   * After a group in which a record timed out: is the backend there? If it
   * answers, the timeouts were a slow server and count toward the guard. If it
   * does not, the run pauses here - no new record starts - and asks again every
   * `probeIntervalMs` until it answers, a stop arrives, or `maxPauseMs` passes.
   * Returns false when the run must end.
   */
  const checkConnection = async (): Promise<boolean> => {
    const timeouts = groupTimeouts;
    groupTimeouts = 0;
    if (!probe || timeouts === 0) return true;
    progress.connection = 'CHECKING';
    emit();
    if (await backendAnswers()) {
      progress.connection = 'OK';
      unknownWhileReachable += timeouts;
      if (unknownWhileReachable >= maxConsecutiveFailures && !stopReason) {
        stopReason = options.language === 'ar'
          ? `توقف الاستيراد: الخادم يرد، لكن ${unknownWhileReachable} عمليات كتابة متتالية لم يرد عليها في الوقت المحدد.`
          : `The import stopped: the server answers, but ${unknownWhileReachable} consecutive writes got no answer in time.`;
        return false;
      }
      emit();
      return true;
    }
    // CONNECTION LOST - pause, do not start anything, keep asking.
    const startedAt = clock();
    progress.connection = 'LOST';
    progress.pausedSince = startedAt;
    let probes = 1;
    emit();
    for (;;) {
      if (stopWanted()) {
        stopReason = stopMessage();
        break;
      }
      if (clock() - startedAt >= maxPauseMs) {
        stopReason = options.language === 'ar'
          ? `توقف الاستيراد: لم يعد الاتصال بالخادم خلال ${Math.round(maxPauseMs / 60000)} دقيقة.`
          : `The import stopped: the server did not come back within ${Math.round(maxPauseMs / 60000)} min.`;
        break;
      }
      await pauseFor(probeIntervalMs);
      if (stopWanted()) {
        stopReason = stopMessage();
        break;
      }
      probes++;
      const back = await backendAnswers();
      emit();
      if (back) {
        const endedAt = clock();
        connectionPauses.push({ startedAt, endedAt, probes, recovered: true });
        progress.pausedMs += endedAt - startedAt;
        progress.pausedSince = null;
        progress.connection = 'OK';
        emit();
        return true;
      }
    }
    const endedAt = clock();
    connectionPauses.push({ startedAt, endedAt, probes, recovered: false });
    progress.pausedMs += endedAt - startedAt;
    progress.pausedSince = null;
    return false;
  };

  /** A phase's rows, a batch at a time, each batch written `concurrency` rows at a time. */
  const runRows = async (rows: Array<{ row: ImportRow; payload: Record<string, unknown>; rowContext: ImportValidationContext }>): Promise<boolean> => {
    for (let start = 0; start < rows.length; start += batchSize) {
      const batch = rows.slice(start, start + batchSize);
      progress.currentKind = batch[0]?.row.entityKind ?? null;
      for (let i = 0; i < batch.length; i += concurrency) {
        // A stop is honoured before any new write starts - never after a whole batch.
        if (stopWanted() && !stopReason) stopReason = stopMessage();
        if (stopReason) break;
        await Promise.all(batch.slice(i, i + concurrency).map(({ row, payload, rowContext }) => handleRow(row, payload, rowContext)));
        // A record timed out: is the server there at all? Pauses here while it is not.
        if (!(await checkConnection()) && !stopReason) stopReason = stopMessage();
        if (stopWanted() && !stopReason) stopReason = stopMessage();
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
            const unknown = bound.unresolved.filter((k) => uncertainItemKeys.has(k)).map((k) => k.slice(k.indexOf(':') + 1));
            markDropped(row, unknown.length > 0
              ? (options.language === 'ar'
                ? `نتيجة كتابة صنف من نفس الحزمة غير معروفة (لم يرد الخادم): ${unknown.join(', ')} - أعد الاستيراد لإكمال هذه القائمة.`
                : `The write outcome of a package item is unknown (no server answer): ${unknown.join(', ')} - re-run the import to complete this BOM.`)
              : (options.language === 'ar'
                ? `صنف من نفس الحزمة لم يُكتب في هذا الاستيراد: ${codes}`
                : `A package item was not written in this import: ${codes}`));
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
  if (progress.succeeded + progress.failed + progress.uncertain + progress.skipped !== progress.processed) issues.push('succeeded + failed + uncertain + skipped does not equal processed');
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
    : progress.failed === 0 && progress.skipped === 0 && progress.uncertain === 0 && verified ? 'COMPLETED' : 'COMPLETED_WITH_ERRORS';
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
    uncertain: progress.uncertain,
    uncertainRows,
    byKind: snapshot().byKind,
    notPlanned,
    failures,
    dropped,
    phasesCompleted,
    verification: { ok: verified, issues },
    stoppedIn: interrupted ? phaseAtStop : null,
    connectionPauses,
    pausedMs: progress.pausedMs,
    error: progress.error,
    resumable: true,
  };
  try { emit(); } catch { /* the result is returned regardless */ }
  return { rows, droppedBeforeWrite, progress: snapshot(), result };
}

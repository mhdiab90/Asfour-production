/**
 * The Odoo import WRITE loop - progress, bounded waits, stop and a complete result (3.32.0).
 *
 * The first real write of an export (911 production rows + 310 scrap) showed a spinner and nothing else:
 * no percentage, no way to tell a slow server from a dead one, no list of what failed. The loop here is
 * the Odoo counterpart of the Master Data import's (entityImportExecutionPure.ts) and reuses its bounded
 * wait. It is pure - the Firestore writes are supplied as `writer` - so every rule is tested without a
 * database:
 *
 *  - PROGRESS: processed / total, a percentage that is 99 at most until every planned row has an outcome
 *    (and 100 only then), per-stage counts, the row being written, and the last progress time.
 *  - EVERY ROW IS BOUNDED (90 s): a write that does not answer is recorded as OUTCOME UNKNOWN - the
 *    server may or may not have committed it - never retried in the same run, never counted as a failure
 *    and never as a success.
 *  - STOP: no new row starts after it; writes in flight get a short grace, then are recorded as unknown.
 *  - GUARDS: 5 unknown outcomes in a row (the server is not answering) or 25 failures in a row stop the run
 *    as INTERRUPTED instead of burning the whole file one timeout at a time.
 *  - RE-RUN SAFETY: a row whose identity already exists in the database (a record from an earlier run,
 *    complete or interrupted) is recognised and NOT written again - so retrying after a stop, a timeout or a
 *    reload never duplicates production. Identity inside the one run is never used to drop a row (legitimate
 *    extra production of the same order stays).
 *  - Work orders (production) run first, then scrap, so a scrap row can point at its production record.
 *  - A failure is isolated to its row; the run continues.
 */
import { IMPORT_RECORD_TIMEOUT_MS, STOP_GRACE_MS, waitBounded, OUTCOME_UNKNOWN_PREFIX } from './entityImportExecutionPure';
import { bulkGroupOf, isOdooRowWritable, type OdooStagedRow } from './odooImportSessionPure';
import { productionIdentityKey } from './odooImportLinkingPure';
import { normalizeCode } from '../utils/searchUtils';
import { normaliseUom } from './uomPure';

export const ODOO_WRITE_CONCURRENCY = 4;
export const ODOO_CONSECUTIVE_UNKNOWN_LIMIT = 5;
export const ODOO_CONSECUTIVE_FAILURE_LIMIT = 25;

export type OdooRunState = 'IMPORTING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'INTERRUPTED';
export type OdooRunPhase = 'PRODUCTION' | 'SCRAP' | 'DONE';

export interface OdooRowIssue {
  rowId: string;
  /** The stage of the row, or 'scrap'. */
  group: string;
  kind: 'FAILED' | 'UNKNOWN';
  reason: string;
  moReference: string | null;
  sourceFile: string;
  sourceRow: number;
  /** The step the write was in when it stopped answering (unknown outcomes). */
  step?: string;
}

export interface OdooGroupCounts { total: number; done: number; failed: number; unknown: number }

export interface OdooRunProgress {
  state: OdooRunState;
  phase: OdooRunPhase;
  /** Rows the approved plan writes - the whole workload. */
  total: number;
  /** Rows with a decided outcome: written, failed, unknown, or already in the database. */
  processed: number;
  succeeded: number;
  failed: number;
  uncertain: number;
  alreadyImported: number;
  /** The percentage shown: 99 at most until the run is verified complete. */
  percent: number;
  byGroup: Record<string, OdooGroupCounts>;
  /** What the most recently started write is. */
  current: string | null;
  inFlight: number;
  lastError: string | null;
  startedAt: number;
  lastProgressAt: number;
  stopRequested: boolean;
  /** Set when the run stopped early, and why. */
  error: string | null;
}

export interface OdooRunFinal {
  outcome: OdooRunState;
  percent: number;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  uncertain: number;
  alreadyImported: number;
  /** Planned rows never started because the run stopped. */
  notStarted: number;
  /** Rows the plan never included (errors, warnings not accepted, not selected). */
  notPlanned: number;
  byGroup: Record<string, OdooGroupCounts>;
  failures: OdooRowIssue[];
  uncertainRows: OdooRowIssue[];
  error: string | null;
  /** A re-run is always safe: written rows are recognised and never written twice. */
  resumable: true;
}

export interface OdooWriteOutcome {
  importedId: string;
  collection: string;
}

export type OdooRowWriter = (item: OdooStagedRow, track: (step: string) => void) => Promise<OdooWriteOutcome>;

export interface RunOdooWritesOptions {
  writer: OdooRowWriter;
  /** Identities already in the database (from `identityOf`), loaded once before the run. */
  existingKeys?: ReadonlySet<string>;
  /** The identity of a row for the re-run check; null = the row has none and is always written. */
  identityOf?: (item: OdooStagedRow) => string | null;
  signal?: AbortSignal;
  recordTimeoutMs?: number;
  graceMs?: number;
  concurrency?: number;
  onProgress?: (progress: OdooRunProgress) => void;
  /** Called for a row that failed or is unknown, so its outcome can be saved (errors here are ignored). */
  onRowIssue?: (item: OdooStagedRow, issue: OdooRowIssue) => Promise<void> | void;
  now?: () => number;
}

export interface RunOdooWritesResult {
  staged: OdooStagedRow[];
  progress: OdooRunProgress;
  final: OdooRunFinal;
  /** Rows written by this run, with where they went. */
  written: Array<{ item: OdooStagedRow; outcome: OdooWriteOutcome }>;
}

/**
 * THE COMPONENT LINES OF A PRODUCTION RECORD (3.33.0).
 *
 * The MO sheet gives, for each component, only a code and a quantity - no unit - and the code can be a
 * material OR a product (green bricks go into the kiln). The first real write failed on exactly that: the
 * component was looked up only among materials, and its unit was "not approved" because there was none.
 * Each line is now resolved the way Odoo means it:
 *   - the item is the MATERIAL with that code, else the PRODUCT with that code (a code that fits two
 *     records of the same kind, or none, is not guessed);
 *   - a missing unit is the item's own Master Data unit - in Odoo a component quantity is in the item's
 *     unit - and only when that unit is an approved one;
 * A line that still cannot be resolved is NOT forced and does NOT fail the production record: it is kept on
 * the record as `unattachedComponents` with the reason, so nothing is lost and nothing is invented.
 */
export interface CodeIndexLike { byCode: Map<string, any[]> }
export interface ComponentIndexes { material?: CodeIndexLike; product?: CodeIndexLike }

export interface UnattachedComponent { itemCode: string; quantity: unknown; unit: unknown; reason: string }

function lookupOne(index: CodeIndexLike | undefined, code: string): { record: any | null; ambiguous: boolean } {
  const found = index?.byCode.get(normalizeCode(code)) ?? [];
  return found.length === 1 ? { record: found[0], ambiguous: false } : { record: null, ambiguous: found.length > 1 };
}

export function prepareComponentLines(
  payload: Record<string, unknown>,
  indexes: ComponentIndexes,
): { payload: Record<string, unknown>; attached: number; unattached: UnattachedComponent[] } {
  const lines = Array.isArray(payload.materials) ? (payload.materials as Array<Record<string, unknown>>) : null;
  if (!lines || lines.length === 0) return { payload, attached: 0, unattached: [] };
  const attached: Array<Record<string, unknown>> = [];
  const unattached: UnattachedComponent[] = [];
  for (const line of lines) {
    const code = String(line.itemCode ?? line.materialCode ?? line.productCode ?? '').trim();
    const drop = (reason: string) => unattached.push({ itemCode: code, quantity: line.quantity ?? null, unit: line.unit ?? null, reason });
    if (!code) { drop('الكود فارغ'); continue; }
    const material = lookupOne(indexes.material, code);
    const product = material.record ? { record: null, ambiguous: false } : lookupOne(indexes.product, code);
    const record = material.record ?? product.record;
    if (!record) {
      drop(material.ambiguous || product.ambiguous ? 'الكود مسجل لأكثر من سجل في البيانات الأساسية' : 'الكود غير موجود في الخامات ولا في المنتجات');
      continue;
    }
    const given = String(line.unit ?? '').trim();
    const unit = normaliseUom(given || record.unit);
    if (!unit.normalized) { drop(given ? `وحدة "${given}" غير معتمدة` : 'لا توجد وحدة للمكوّن، ووحدة سجله في البيانات الأساسية غير معتمدة أو فارغة'); continue; }
    attached.push({ ...line, itemSource: material.record ? 'materials' : 'products', unit: unit.normalized });
  }
  const next: Record<string, unknown> = { ...payload, materials: attached };
  if (attached.length === 0) delete next.materials;
  if (unattached.length > 0) next.unattachedComponents = unattached;
  return { payload: next, attached: attached.length, unattached };
}

/** What a failed or refused row's reason is, with the code taken out - so a thousand rows read as a few causes. */
export function reasonPattern(reason: string): string {
  return reason
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\b\d+(\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export interface ReasonGroup { pattern: string; count: number; examples: string[] }

/** Failures grouped by cause: the pattern, how many rows, and a few of the actual reasons. */
export function groupReasons(issues: ReadonlyArray<{ reason: string; rowId: string }>): ReasonGroup[] {
  const groups = new Map<string, ReasonGroup>();
  for (const i of issues) {
    // A row can fail for several reasons joined by " | " - each one is a cause.
    for (const part of i.reason.split(' | ')) {
      const pattern = reasonPattern(part);
      const g = groups.get(pattern) ?? { pattern, count: 0, examples: [] };
      g.count += 1;
      if (g.examples.length < 3 && !g.examples.includes(part)) g.examples.push(part);
      groups.set(pattern, g);
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Business codes the reasons name as DUPLICATED in Master Data - the list to fix there. */
export function duplicateCodesIn(issues: ReadonlyArray<{ reason: string }>): string[] {
  const codes = new Set<string>();
  for (const i of issues) for (const m of i.reason.matchAll(/الكود "([^"]+)" مكرر/g)) codes.add(m[1]);
  return [...codes].sort();
}

/** 99 at most until the run is verified complete; 100 only then. */
export function odooPercent(progress: Pick<OdooRunProgress, 'state' | 'processed' | 'total'>): number {
  const complete = (progress.state === 'COMPLETED' || progress.state === 'COMPLETED_WITH_ERRORS') && progress.processed >= progress.total;
  if (complete) return 100;
  if (progress.total <= 0) return 0;
  return Math.max(0, Math.min(99, Math.floor((progress.processed / progress.total) * 100)));
}

const labelOf = (item: OdooStagedRow) => `${item.linkedManufacturingOrder ?? item.row.rowId} (${bulkGroupOf(item)})`;

export async function runOdooWrites(staged: readonly OdooStagedRow[], options: RunOdooWritesOptions): Promise<RunOdooWritesResult> {
  const now = options.now ?? (() => Date.now());
  const timeoutMs = options.recordTimeoutMs ?? IMPORT_RECORD_TIMEOUT_MS;
  const graceMs = options.graceMs ?? STOP_GRACE_MS;
  const concurrency = Math.max(1, options.concurrency ?? ODOO_WRITE_CONCURRENCY);
  const existing = options.existingKeys ?? new Set<string>();

  const planned = staged.filter(isOdooRowWritable);
  const productionRows = planned.filter((s) => s.kind === 'odooWorkOrder');
  const scrapRows = planned.filter((s) => s.kind === 'odooScrap');
  const notPlanned = staged.filter((s) => s.kind !== 'odooProduction').length - planned.length;

  // The internal controller lets a guard stop the run the same way the user's stop does.
  const controller = new AbortController();
  const external = options.signal;
  const onExternalAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener('abort', onExternalAbort);
  }
  const signal = controller.signal;

  const byGroup: Record<string, OdooGroupCounts> = {};
  for (const s of planned) {
    const g = bulkGroupOf(s);
    byGroup[g] = byGroup[g] ?? { total: 0, done: 0, failed: 0, unknown: 0 };
    byGroup[g].total += 1;
  }
  const startedAt = now();
  const progress: OdooRunProgress = {
    state: 'IMPORTING', phase: 'PRODUCTION', total: planned.length, processed: 0, succeeded: 0, failed: 0, uncertain: 0, alreadyImported: 0,
    percent: 0, byGroup, current: null, inFlight: 0, lastError: null, startedAt, lastProgressAt: startedAt, stopRequested: false, error: null,
  };
  const emit = () => {
    progress.percent = odooPercent(progress);
    progress.stopRequested = signal.aborted;
    options.onProgress?.({ ...progress, byGroup: Object.fromEntries(Object.entries(progress.byGroup).map(([k, v]) => [k, { ...v }])) });
  };

  const replaced = new Map<string, OdooStagedRow>();
  const failures: OdooRowIssue[] = [];
  const uncertainRows: OdooRowIssue[] = [];
  const written: Array<{ item: OdooStagedRow; outcome: OdooWriteOutcome }> = [];
  let unknownStreak = 0;
  let failureStreak = 0;
  let notStarted = 0;
  let stopReason: string | null = null;

  const issueOf = (item: OdooStagedRow, kind: 'FAILED' | 'UNKNOWN', reason: string, step?: string): OdooRowIssue => ({
    rowId: item.row.rowId, group: bulkGroupOf(item), kind, reason, moReference: item.linkedManufacturingOrder,
    sourceFile: item.provenance.sourceFile, sourceRow: item.provenance.sourceRow, ...(step ? { step } : {}),
  });

  const processOne = async (item: OdooStagedRow) => {
    if (signal.aborted) { notStarted += 1; return; }
    const group = progress.byGroup[bulkGroupOf(item)];
    const key = options.identityOf ? options.identityOf(item) : null;
    if (key && existing.has(key)) {
      // Already in the database from an earlier run: recognised, not written again.
      replaced.set(item.row.rowId, { ...item, row: { ...item.row, status: 'IMPORTED', failureMessage: null } });
      progress.alreadyImported += 1; progress.processed += 1; group.done += 1;
      progress.lastProgressAt = now();
      emit();
      return;
    }
    let step = 'PREPARING';
    progress.current = labelOf(item);
    progress.inFlight += 1;
    emit();
    const bounded = await waitBounded(
      Promise.resolve().then(() => options.writer(item, (s) => { step = s; })),
      timeoutMs, signal, graceMs,
    );
    progress.inFlight -= 1;
    progress.processed += 1;
    progress.lastProgressAt = now();

    if (bounded.kind === 'value') {
      replaced.set(item.row.rowId, { ...item, row: { ...item.row, status: 'IMPORTED', importedId: bounded.value.importedId, failureMessage: null } });
      written.push({ item, outcome: bounded.value });
      progress.succeeded += 1; group.done += 1; unknownStreak = 0; failureStreak = 0;
    } else if (bounded.kind === 'error') {
      const message = String((bounded.error as { message?: unknown } | null)?.message ?? bounded.error);
      const issue = issueOf(item, 'FAILED', message, step);
      failures.push(issue);
      replaced.set(item.row.rowId, { ...item, row: { ...item.row, status: 'FAILED', failureMessage: message } });
      progress.failed += 1; group.failed += 1; progress.lastError = `${labelOf(item)}: ${message}`;
      unknownStreak = 0; failureStreak += 1;
      try { await options.onRowIssue?.(item, issue); } catch { /* the outcome is also in the result */ }
      if (failureStreak >= ODOO_CONSECUTIVE_FAILURE_LIMIT && !signal.aborted) {
        stopReason = `${ODOO_CONSECUTIVE_FAILURE_LIMIT} أسطر متتالية فشلت - توقف الاستيراد. آخر سبب: ${message}`;
        controller.abort();
      }
    } else {
      const cut = bounded.kind === 'stopped';
      const reason = `${OUTCOME_UNKNOWN_PREFIX}: ${cut
        ? 'قُطعت الكتابة بسبب الإيقاف قبل أن يرد الخادم'
        : `لم يرد الخادم خلال ${Math.round(timeoutMs / 1000)} ثانية`} (الخطوة: ${step}) - قد يكون السجل كُتب أو لا؛ تحقق قبل إعادة المحاولة.`;
      const issue = issueOf(item, 'UNKNOWN', reason, step);
      uncertainRows.push(issue);
      // The row stays as it was (not FAILED, not IMPORTED): a re-run recognises it if it was committed.
      progress.uncertain += 1; group.unknown += 1; progress.lastError = `${labelOf(item)}: ${reason}`;
      failureStreak = 0;
      if (!cut) unknownStreak += 1;
      try { await options.onRowIssue?.(item, issue); } catch { /* the outcome is also in the result */ }
      if (unknownStreak >= ODOO_CONSECUTIVE_UNKNOWN_LIMIT && !signal.aborted) {
        stopReason = `${ODOO_CONSECUTIVE_UNKNOWN_LIMIT} أسطر متتالية لم يرد الخادم عليها - توقف الاستيراد. تحقق من الاتصال ثم أعد المحاولة (السجلات المكتوبة لن تتكرر).`;
        controller.abort();
      }
    }
    emit();
  };

  const runPhase = async (phase: OdooRunPhase, rows: OdooStagedRow[]) => {
    progress.phase = phase;
    emit();
    let next = 0;
    const worker = async () => {
      while (next < rows.length) {
        const item = rows[next++];
        await processOne(item);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => worker()));
  };

  emit();
  await runPhase('PRODUCTION', productionRows);
  await runPhase('SCRAP', scrapRows);

  external?.removeEventListener('abort', onExternalAbort);
  const stopped = signal.aborted;
  if (stopped) {
    progress.state = 'INTERRUPTED';
    progress.error = stopReason ?? 'أوقفه المستخدم - السجلات المكتوبة محفوظة، وإعادة التشغيل لن تكرر أي سجل.';
  } else {
    progress.state = progress.failed > 0 || progress.uncertain > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
  }
  progress.phase = 'DONE';
  progress.current = null;
  progress.lastProgressAt = now();
  emit();

  const final: OdooRunFinal = {
    outcome: progress.state, percent: progress.percent, total: progress.total, processed: progress.processed,
    succeeded: progress.succeeded, failed: progress.failed, uncertain: progress.uncertain, alreadyImported: progress.alreadyImported,
    notStarted, notPlanned, byGroup: progress.byGroup, failures, uncertainRows, error: progress.error, resumable: true,
  };
  return { staged: staged.map((s) => replaced.get(s.row.rowId) ?? s), progress: { ...progress }, final, written };
}

/**
 * The identity of a row for the re-run check (3.32.0): what makes two rows THE SAME record, so a retry
 * after a stop, a timeout or a reload never writes a record twice.
 */
export function odooRowIdentity(item: OdooStagedRow): string | null {
  if (item.kind === 'odooWorkOrder') return item.identityKey ? `wo:${item.identityKey}` : null;
  if (item.kind === 'odooScrap') {
    const reference = String((item.payload as any)?.reference ?? '').trim().toLowerCase();
    return reference ? `scrap:${reference}` : null;
  }
  return null;
}

/** The same identity from a record already stored - its own `identityKey`, or derived from what it holds. */
export function storedWorkOrderIdentity(doc: Record<string, any>): string | null {
  if (doc.identityKey) return `wo:${doc.identityKey}`;
  const odoo = Array.isArray(doc.externalRefs) ? doc.externalRefs.find((r: any) => r?.system === 'odoo' && r?.model === 'mrp.workorder') : null;
  if (!doc.manufacturingOrderNumber) return null;
  return `wo:${productionIdentityKey({
    moReference: String(doc.manufacturingOrderNumber),
    productCode: doc.productCode ?? null,
    mainCenterId: doc.workCenter?.mainCenterId ?? null,
    equipmentName: doc.workCenter?.equipmentName ?? null,
    workOrderKey: doc.shiftNumber != null ? `shift:${doc.shiftNumber}` : (doc.rawWorkOrder ?? null),
    odooId: odoo?.externalId ?? null,
  })}`;
}

export function storedScrapIdentity(doc: Record<string, any>): string | null {
  const reference = String(doc.reference ?? '').trim().toLowerCase();
  return reference ? `scrap:${reference}` : null;
}


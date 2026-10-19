/**
 * The three-file Odoo import - persistence - Phase 1 Step 8D.
 *
 * LIFECYCLE: upload -> parse -> RAW STAGING -> normalise -> link -> validate ->
 * review -> approve -> persist. Nothing reaches an operational collection at
 * parse time. Every row is staged first (`importStagingRows`), with its raw
 * Excel row, its normalised shape, any correction and its validation outcome, so
 * the review survives a reload and every written value can be traced back.
 *
 * WHAT IS WRITTEN AT APPROVAL, and only for rows that passed review:
 *   a work order  -> the existing production write (createProductionRecord /
 *                    createStageRecord) AND a `workOrders` record linked to it
 *   a scrap row   -> a `stockScrap` record (stock.scrap is the only scrap source)
 *   an MO row     -> nothing: it is context, so a quantity is never counted twice
 *
 * Each row is written on its own: one failure never touches another row, and the
 * staged row keeps the failure so it can be corrected and reprocessed.
 */
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit as fsLimit, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../config/firebase';
import { safeAddDoc, safeSetDoc, safeUpdateDoc, sanitizeForFirestore } from '../utils/firestoreSanitizer';
import type {
  ImportSessionRecord,
  ImportSourceConflict,
  ImportStagingRow,
  OdooSourceType,
  ProductionStageType,
  WorkCenterMapping,
} from '../types';
import { logAuditAction } from './auditService';
import { createProductionRecord } from './productionService';
import { createStageRecord } from './stageRecordService';
import { STAGE_COLLECTION_NAMES } from './stageQueryBoundsPure';
import { resolveAndValidateImportRow } from './importEntityValidationPure';
import type { ImportValidationContext } from './importEntityValidationPure';
import type { ReferenceIndexes, ReferenceMappingCache } from './referenceResolutionPure';
import { describeResolution } from './referenceResolutionPure';
import { carriedContextFromStaging, isOdooRowWritable, type CarriedContext, type OdooStagedRow, type StoredStagingRowLike } from './odooImportSessionPure';
import { odooRowIdentity, prepareComponentLines, runOdooWrites, storedScrapIdentity, storedWorkOrderIdentity, type OdooRunFinal, type OdooRunProgress, type UnattachedComponent } from './odooExecutionPure';
import { normaliseWorkCenterText, type ApprovedWorkCenterMapping } from './workCenterRegistryPure';

export const IMPORT_SESSION_COLLECTION = 'importSessions';
export const IMPORT_STAGING_COLLECTION = 'importStagingRows';
export const WORK_ORDER_COLLECTION = 'workOrders';
export const STOCK_SCRAP_COLLECTION = 'stockScrap';
export const WORK_CENTER_COLLECTION = 'workCenters';

const CHUNK = 300;

const now = () => new Date().toISOString();

/** Saves the session header and every staged row. Called after parsing and after each review change. */
export async function saveOdooImportSession(
  session: { importSessionId: string; files: ImportSessionRecord['files']; counts: Record<string, number>; conflicts: ImportSourceConflict[]; status?: ImportSessionRecord['status'] },
  staged: readonly OdooStagedRow[],
): Promise<void> {
  const user = auth.currentUser;
  const header: ImportSessionRecord = {
    importSessionId: session.importSessionId,
    status: session.status ?? 'REVIEW',
    files: session.files,
    counts: session.counts,
    conflicts: session.conflicts,
    createdBy: user?.uid ?? 'anonymous',
    createdByName: user?.email ?? '',
    createdAt: now(),
    updatedAt: now(),
  };
  try {
    await safeSetDoc(doc(db, IMPORT_SESSION_COLLECTION, session.importSessionId), {
      ...sanitizeForFirestore(header),
      serverUpdatedAt: serverTimestamp(),
    });
    for (let i = 0; i < staged.length; i += CHUNK) {
      const batch = writeBatch(db);
      for (const item of staged.slice(i, i + CHUNK)) {
        batch.set(doc(db, IMPORT_STAGING_COLLECTION, stagingDocId(session.importSessionId, item.row.rowId)), sanitizeForFirestore(stagingRowOf(session.importSessionId, item)));
      }
      await batch.commit();
    }
    await logAuditAction('BULK_IMPORT', IMPORT_SESSION_COLLECTION, session.importSessionId,
      `[ODOO_IMPORT] staged session ${session.importSessionId}: ${staged.length} rows (${session.files.map((f) => `${f.sourceType}:${f.fileName}`).join(', ')})`);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, IMPORT_SESSION_COLLECTION);
    throw error;
  }
}

/** A stable staging document id, so re-saving a session updates its rows instead of duplicating them. */
export function stagingDocId(importSessionId: string, rowId: string): string {
  return `${importSessionId}__${rowId}`.replace(/[/\\#?]/g, '_').slice(0, 1400);
}

export function stagingRowOf(importSessionId: string, item: OdooStagedRow): ImportStagingRow {
  return {
    importSessionId,
    rowId: item.row.rowId,
    sourceType: item.sourceType,
    rawRow: item.rawRow,
    normalizedRow: item.row.normalizedData,
    correctedRow: item.row.correctedRowData,
    status: item.row.status,
    selection: item.row.selection,
    errors: item.row.errors,
    warnings: item.row.warnings,
    orphanKinds: item.orphanKinds,
    linkedManufacturingOrder: item.linkedManufacturingOrder,
    linkedRowIds: item.linkedRowIds,
    provenance: item.provenance,
    importedId: item.row.importedId,
    importedCollection: null,
    failureMessage: item.row.failureMessage,
    createdAt: now(),
    updatedAt: now(),
  };
}

export async function listOdooImportSessions(max = 25): Promise<ImportSessionRecord[]> {
  try {
    const snap = await getDocs(query(collection(db, IMPORT_SESSION_COLLECTION), orderBy('createdAt', 'desc'), fsLimit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as ImportSessionRecord) }));
  } catch {
    return [];
  }
}

/** Reads a staged session back - what makes the review survive a reload. */
export async function loadOdooImportSession(importSessionId: string): Promise<{ session: ImportSessionRecord | null; rows: ImportStagingRow[] }> {
  try {
    const [sessions, rows] = await Promise.all([
      getDocs(query(collection(db, IMPORT_SESSION_COLLECTION), where('importSessionId', '==', importSessionId))),
      getDocs(query(collection(db, IMPORT_STAGING_COLLECTION), where('importSessionId', '==', importSessionId))),
    ]);
    const session = sessions.docs[0] ? ({ id: sessions.docs[0].id, ...(sessions.docs[0].data() as ImportSessionRecord) }) : null;
    return {
      session,
      rows: rows.docs.map((d) => ({ id: d.id, ...(d.data() as ImportStagingRow) })).sort((a, b) => a.provenance.sourceRow - b.provenance.sourceRow),
    };
  } catch {
    return { session: null, rows: [] };
  }
}

export interface WrittenOdooSummary {
  workOrders: number;
  scrap: number;
  /** One line per stage: how many work-order records, the first and last date, and a link check on a sample. */
  byStage: Array<{ stage: string; count: number; firstDate: string | null; lastDate: string | null; sampled: number; found: number }>;
  scrapFirstDate: string | null;
  scrapLastDate: string | null;
  sessions: string[];
}

/**
 * What the Odoo import has REALLY written (3.37.0): the `workOrders` and `stockScrap` documents (each work
 * order points at the production record it created), counted per stage with the dates they cover, and a
 * sample of each stage's production records is read back to prove it is there. Read-only; answers "I wrote
 * it - where is it?" with the database's own answer.
 */
export async function summariseWrittenOdooRecords(sampleSize = 5): Promise<WrittenOdooSummary> {
  const [woSnap, scrapSnap] = await Promise.all([getDocs(collection(db, WORK_ORDER_COLLECTION)), getDocs(collection(db, STOCK_SCRAP_COLLECTION))]);
  const stages = new Map<string, { count: number; first: string | null; last: string | null; links: Array<{ id: string; collection: string }> }>();
  const sessions = new Set<string>();
  woSnap.docs.forEach((d) => {
    const w = d.data() as any;
    const stage = String(w.stageType ?? '-');
    const e = stages.get(stage) ?? { count: 0, first: null, last: null, links: [] };
    e.count += 1;
    const date = typeof w.date === 'string' ? w.date.slice(0, 10) : null;
    if (date) { e.first = !e.first || date < e.first ? date : e.first; e.last = !e.last || date > e.last ? date : e.last; }
    if (e.links.length < sampleSize && w.productionRecordId && w.productionCollection) e.links.push({ id: String(w.productionRecordId), collection: String(w.productionCollection) });
    if (w.provenance?.importSessionId) sessions.add(String(w.provenance.importSessionId));
    stages.set(stage, e);
  });
  let scrapFirst: string | null = null;
  let scrapLast: string | null = null;
  scrapSnap.docs.forEach((d) => {
    const date = typeof (d.data() as any).date === 'string' ? String((d.data() as any).date).slice(0, 10) : null;
    if (date) { scrapFirst = !scrapFirst || date < scrapFirst ? date : scrapFirst; scrapLast = !scrapLast || date > scrapLast ? date : scrapLast; }
  });
  const byStage: WrittenOdooSummary['byStage'] = [];
  for (const [stage, e] of stages) {
    let found = 0;
    for (const link of e.links) {
      try { if ((await getDoc(doc(db, link.collection, link.id))).exists()) found += 1; } catch { /* counted as not found */ }
    }
    byStage.push({ stage, count: e.count, firstDate: e.first, lastDate: e.last, sampled: e.links.length, found });
  }
  return { workOrders: woSnap.size, scrap: scrapSnap.size, byStage: byStage.sort((a, b) => b.count - a.count), scrapFirstDate: scrapFirst, scrapLastDate: scrapLast, sessions: [...sessions] };
}

/**
 * What earlier uploads left in staging, read back as context for this one (3.36.0): the manufacturing orders,
 * work orders and scrap rows of the file kinds the current upload does NOT contain. Read-only; the newest
 * session wins per order; the session being built is excluded. A failed read yields no context, never an error.
 */
export async function loadCarriedOdooContext(
  currentSessionId: string,
  want: { production: boolean; workOrders: boolean; scrap: boolean },
): Promise<CarriedContext> {
  const types = [want.production && 'MRP_PRODUCTION', want.workOrders && 'MRP_WORKORDER', want.scrap && 'STOCK_SCRAP'].filter(Boolean) as string[];
  if (types.length === 0) return { production: [], workOrders: [], scrap: [] };
  try {
    const rows: StoredStagingRowLike[] = [];
    for (const type of types) {
      const snap = await getDocs(query(collection(db, IMPORT_STAGING_COLLECTION), where('sourceType', '==', type)));
      snap.docs.forEach((d) => rows.push(d.data() as StoredStagingRowLike));
    }
    return carriedContextFromStaging(rows, currentSessionId);
  } catch {
    return { production: [], workOrders: [], scrap: [] };
  }
}

/** The Work Center mappings a user approved - the code registry stays authoritative. */
export async function loadApprovedWorkCenterMappings(): Promise<ApprovedWorkCenterMapping[]> {
  try {
    const snap = await getDocs(collection(db, WORK_CENTER_COLLECTION));
    return snap.docs
      .map((d) => d.data() as WorkCenterMapping)
      .filter((m) => m.active !== false)
      .map((m) => ({ rawNormalized: m.rawNormalized, mainCenterId: m.mainCenterId, equipmentName: m.equipmentName ?? null, active: m.active }));
  } catch {
    return [];
  }
}

/** Approves one raw Work Center name for a main centre. Never guessed - a user chooses it. */
export async function saveWorkCenterMapping(raw: string, mainCenterId: string, equipmentName?: string | null): Promise<void> {
  const user = auth.currentUser;
  const rawNormalized = normaliseWorkCenterText(raw);
  const payload: WorkCenterMapping = {
    raw,
    rawNormalized,
    mainCenterId,
    equipmentName: equipmentName ?? null,
    approvedBy: user?.email ?? user?.uid ?? null,
    approvedAt: now(),
    active: true,
    createdAt: now(),
    updatedAt: now(),
  };
  await safeSetDoc(doc(db, WORK_CENTER_COLLECTION, rawNormalized.replace(/[/\\#?\s]/g, '_') || 'unknown'), sanitizeForFirestore(payload));
  await logAuditAction('CREATE', WORK_CENTER_COLLECTION, rawNormalized, `[ODOO_IMPORT] work center "${raw}" mapped to ${mainCenterId}`);
}

export interface OdooExecutionOptions {
  context: ImportValidationContext;
  indexes: ReferenceIndexes;
  mappingCache: ReferenceMappingCache;
  language: 'ar' | 'en';
  productionStatus?: 'DRAFT' | 'SUBMITTED';
  /** Stops the run: no new row starts, writes in flight get a short grace (3.32.0). */
  signal?: AbortSignal;
  /** Told after every row - the progress bar. */
  onProgress?: (progress: OdooRunProgress) => void;
}

export interface OdooExecutionResult {
  staged: OdooStagedRow[];
  writtenProduction: number;
  writtenWorkOrders: number;
  writtenScrap: number;
  failed: number;
  skipped: number;
  messages: string[];
  /** The complete result: percentage, per-stage counts, every failure and every unknown outcome with its reason. */
  final: OdooRunFinal;
}

/**
 * Every work-order and scrap identity already in the database, read once before a run. If it cannot be read
 * the run does not start: writing without knowing what is already there is how records get duplicated.
 */
export async function loadExistingOdooIdentities(): Promise<Set<string>> {
  const keys = new Set<string>();
  const [workOrders, scrap] = await Promise.all([
    getDocs(collection(db, WORK_ORDER_COLLECTION)),
    getDocs(collection(db, STOCK_SCRAP_COLLECTION)),
  ]);
  workOrders.docs.forEach((d) => { const k = storedWorkOrderIdentity(d.data()); if (k) keys.add(k); });
  scrap.docs.forEach((d) => { const k = storedScrapIdentity(d.data()); if (k) keys.add(k); });
  return keys;
}

/** Resolves the payload's business codes with the SAME pipeline the entity import uses. */
function resolvePayload(payload: Record<string, unknown>, options: OdooExecutionOptions) {
  return resolveAndValidateImportRow('production', payload, options.context, options.indexes, options.mappingCache);
}

export interface PreparedOdooRow {
  /** The payload that would be written, with its component lines resolved from Master Data. */
  payload: Record<string, unknown>;
  /** The same validation the write runs - empty when the row can be written. */
  errors: Array<{ messageAr: string; messageEn: string }>;
  warnings: Array<{ messageAr: string; messageEn: string }>;
  unattached: UnattachedComponent[];
  checked: ReturnType<typeof resolvePayload>;
}

/**
 * Everything the write does BEFORE writing, as one step: the component lines are resolved from Master Data
 * (3.33.0), then the payload goes through the entity import's own resolution and validation. The write and
 * the pre-write check (the screen runs it before an approval) both call this, so they can never disagree -
 * a row that passes the check is a row the write accepts.
 */
export function prepareOdooWorkOrderRow(item: OdooStagedRow, options: Pick<OdooExecutionOptions, 'context' | 'indexes' | 'mappingCache' | 'language'>): PreparedOdooRow {
  const components = prepareComponentLines({ ...(item.payload ?? {}) }, { material: options.indexes.material as never, product: options.indexes.product as never });
  const checked = resolvePayload(components.payload, options as OdooExecutionOptions);
  return { payload: components.payload, errors: checked.errors, warnings: checked.warnings ?? [], unattached: components.unattached, checked };
}

/**
 * Writes the approved rows. Each row is written on its own and records its own outcome; nothing is written
 * for a manufacturing-order context row. 3.32.0: bounded per row, with progress, stop, a complete result and
 * a re-run check (see odooExecutionPure.ts).
 */
export async function executeOdooImport(
  importSessionId: string,
  staged: readonly OdooStagedRow[],
  options: OdooExecutionOptions,
): Promise<OdooExecutionResult> {
  let writtenProduction = 0;
  let writtenWorkOrders = 0;
  let writtenScrap = 0;
  const productionIdByRow = new Map<string, { id: string; collection: string; stage: ProductionStageType }>();

  // What is already in the database, so a retry never writes a record twice. Unreadable = do not start.
  const existingKeys = await loadExistingOdooIdentities();

  const writer = async (item: OdooStagedRow, track: (step: string) => void) => {
    if (item.kind === 'odooWorkOrder') {
      const stage = item.targetStage as ProductionStageType;
      track('VALIDATING');
      // Component lines resolved, then the same resolution and validation the entity import runs - one step,
      // shared with the pre-write check, so a row that passed the check is a row this accepts.
      const prepared = prepareOdooWorkOrderRow(item, options);
      if (prepared.errors.length > 0) {
        throw new Error(prepared.errors.map((e) => (options.language === 'ar' ? e.messageAr : e.messageEn)).join(' | '));
      }
      const checked = prepared.checked;
      const data = (checked.normalized ?? prepared.payload) as Record<string, any>;
      const { stageType: _stage, ...record } = data;
      track('PRODUCTION_WRITE');
      const productionId = stage === 'pressing'
        ? await createProductionRecord(record as never)
        : await createStageRecord(stage, record, options.productionStatus ?? 'SUBMITTED');
      const collectionName = STAGE_COLLECTION_NAMES[stage];
      productionIdByRow.set(item.row.rowId, { id: productionId, collection: collectionName, stage });
      writtenProduction += 1;

      track('WORK_ORDER_WRITE');
      const workOrderRef = await safeAddDoc(collection(db, WORK_ORDER_COLLECTION), {
        ...sanitizeForFirestore({
          identityKey: item.identityKey ?? null,
          manufacturingOrderNumber: data.manufacturingOrderNumber ?? item.linkedManufacturingOrder ?? '',
          productionRecordId: productionId,
          productionCollection: collectionName,
          rawWorkOrder: (item.row.normalizedData as any)?.rawWorkOrder ?? '',
          shiftNumber: (item.row.normalizedData as any)?.shiftNumber ?? null,
          workCenter: (item.row.normalizedData as any)?.workCenter ?? null,
          stageType: stage,
          productCode: data.productCode ?? null,
          productName: data.productName ?? null,
          productId: data.productId ?? null,
          bomCode: (item.row.normalizedData as any)?.bomCode ?? null,
          quantity: (item.row.normalizedData as any)?.quantity ?? null,
          secondaryQuantity: (item.row.normalizedData as any)?.secondaryQuantity ?? null,
          unit: (item.row.normalizedData as any)?.unit ?? null,
          realDurationMinutes: (item.row.normalizedData as any)?.realDuration ?? null,
          expectedDurationMinutes: (item.row.normalizedData as any)?.expectedDuration ?? null,
          durationPerUnit: (item.row.normalizedData as any)?.durationPerUnit ?? null,
          durationDeviation: (item.row.normalizedData as any)?.durationDeviation ?? null,
          state: (item.row.normalizedData as any)?.state ?? null,
          date: data.date ?? null,
          startDate: (item.row.normalizedData as any)?.startDate ?? null,
          endDate: (item.row.normalizedData as any)?.endDate ?? null,
          employees: (item.row.normalizedData as any)?.employees ?? [],
          externalRefs: data.externalRefs ?? [],
          provenance: item.provenance,
          status: 'SUBMITTED',
        }),
        createdBy: auth.currentUser?.uid ?? 'anonymous',
        createdByName: auth.currentUser?.email ?? '',
        createdAt: now(),
        updatedAt: now(),
        serverCreatedAt: serverTimestamp(),
      });
      writtenWorkOrders += 1;

      track('AUDIT_WRITE');
      const trail = (checked.resolutions ?? []).filter((r) => r.status !== 'EMPTY').map(describeResolution);
      await logAuditAction('CREATE', collectionName, productionId,
        `[ODOO_IMPORT ${importSessionId}] production from work order ${item.row.rowId} (${item.provenance.sourceFile} row ${item.provenance.sourceRow}); workOrder=${workOrderRef.id}${trail.length ? ` | references: ${trail.join('; ')}` : ''}`).catch(() => {});
      track('STAGING');
      await updateStagingOutcome(importSessionId, item, { importedId: productionId, importedCollection: collectionName, status: 'IMPORTED', failureMessage: null });
      return { importedId: productionId, collection: collectionName };
    }

    // odooScrap
    const payload = item.payload ?? {};
    const related = (item.row.normalizedData as any)?.workOrderRowId as string | undefined;
    const production = related ? productionIdByRow.get(related) : undefined;
    track('SCRAP_WRITE');
    const scrapRef = await safeAddDoc(collection(db, STOCK_SCRAP_COLLECTION), {
      ...sanitizeForFirestore({
        ...payload,
        identityKey: odooRowIdentity(item),
        productionRecordId: production?.id ?? null,
        productionCollection: production?.collection ?? null,
        stageType: (payload as any).stageType ?? production?.stage ?? null,
        provenance: item.provenance,
        status: 'SUBMITTED',
      }),
      createdBy: auth.currentUser?.uid ?? 'anonymous',
      createdByName: auth.currentUser?.email ?? '',
      createdAt: now(),
      updatedAt: now(),
      serverCreatedAt: serverTimestamp(),
    });
    writtenScrap += 1;
    track('AUDIT_WRITE');
    await logAuditAction('CREATE', STOCK_SCRAP_COLLECTION, scrapRef.id,
      `[ODOO_IMPORT ${importSessionId}] scrap from ${item.provenance.sourceFile} row ${item.provenance.sourceRow}`).catch(() => {});
    track('STAGING');
    await updateStagingOutcome(importSessionId, item, { importedId: scrapRef.id, importedCollection: STOCK_SCRAP_COLLECTION, status: 'IMPORTED', failureMessage: null });
    return { importedId: scrapRef.id, collection: STOCK_SCRAP_COLLECTION };
  };

  const run = await runOdooWrites(staged, {
    writer,
    existingKeys,
    identityOf: odooRowIdentity,
    signal: options.signal,
    onProgress: options.onProgress,
    // A failed or unknown row keeps its reason in the staging record too (best effort).
    onRowIssue: (item, issue) => updateStagingOutcome(importSessionId, item, {
      importedId: null, importedCollection: null, status: issue.kind === 'FAILED' ? 'FAILED' : 'REVIEW', failureMessage: issue.reason,
    }),
  });

  const messages = [...run.final.failures, ...run.final.uncertainRows].map((i) => `${i.rowId}: ${i.reason}`);
  const skipped = run.final.notPlanned;
  const clean = run.final.outcome === 'COMPLETED';
  await safeUpdateDoc(doc(db, IMPORT_SESSION_COLLECTION, importSessionId), {
    status: clean ? 'COMPLETED' : 'PARTIALLY_IMPORTED',
    updatedAt: now(),
    serverUpdatedAt: serverTimestamp(),
  }).catch(() => {});
  await logAuditAction('BULK_IMPORT', IMPORT_SESSION_COLLECTION, importSessionId,
    `[ODOO_IMPORT] executed ${importSessionId}: ${run.final.outcome}, production=${writtenProduction}, workOrders=${writtenWorkOrders}, scrap=${writtenScrap}, failed=${run.final.failed}, unknown=${run.final.uncertain}, alreadyImported=${run.final.alreadyImported}, notStarted=${run.final.notStarted}, skipped=${skipped}`).catch(() => {});

  return {
    staged: run.staged, writtenProduction, writtenWorkOrders, writtenScrap, failed: run.final.failed + run.final.uncertain, skipped, messages, final: run.final,
  };
}

async function updateStagingOutcome(
  importSessionId: string,
  item: OdooStagedRow,
  outcome: { importedId: string | null; importedCollection: string | null; status: string; failureMessage: string | null },
): Promise<void> {
  await safeUpdateDoc(doc(db, IMPORT_STAGING_COLLECTION, stagingDocId(importSessionId, item.row.rowId)), {
    ...outcome,
    updatedAt: now(),
  }).catch(() => {});
}

/** The scrap of one manufacturing order - scrap is never folded into a production quantity. */
export async function fetchScrapByManufacturingOrder(moReference: string): Promise<Array<Record<string, any>>> {
  try {
    const snap = await getDocs(query(collection(db, STOCK_SCRAP_COLLECTION), where('manufacturingOrderNumber', '==', moReference)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/** The work orders written for one manufacturing order. */
export async function fetchWorkOrdersByManufacturingOrder(moReference: string): Promise<Array<Record<string, any>>> {
  try {
    const snap = await getDocs(query(collection(db, WORK_ORDER_COLLECTION), where('manufacturingOrderNumber', '==', moReference)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/** Every work order of a date range - the reporting layer reads these, never the import session. */
export async function fetchWorkOrders(filters: { startDate?: string; endDate?: string } = {}): Promise<Array<Record<string, any>>> {
  try {
    const constraints = [] as any[];
    if (filters.startDate) constraints.push(where('date', '>=', filters.startDate));
    if (filters.endDate) constraints.push(where('date', '<=', filters.endDate));
    const snap = await getDocs(constraints.length ? query(collection(db, WORK_ORDER_COLLECTION), ...constraints) : collection(db, WORK_ORDER_COLLECTION));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/** Every scrap record of a date range. */
export async function fetchScrapRecords(filters: { startDate?: string; endDate?: string } = {}): Promise<Array<Record<string, any>>> {
  try {
    const constraints = [] as any[];
    if (filters.startDate) constraints.push(where('date', '>=', filters.startDate));
    if (filters.endDate) constraints.push(where('date', '<=', filters.endDate));
    const snap = await getDocs(constraints.length ? query(collection(db, STOCK_SCRAP_COLLECTION), ...constraints) : collection(db, STOCK_SCRAP_COLLECTION));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export type { OdooSourceType };

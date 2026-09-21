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
import { collection, doc, getDocs, query, where, orderBy, limit as fsLimit, serverTimestamp, writeBatch } from 'firebase/firestore';
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
import { isOdooRowWritable, type OdooStagedRow } from './odooImportSessionPure';
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
}

export interface OdooExecutionResult {
  staged: OdooStagedRow[];
  writtenProduction: number;
  writtenWorkOrders: number;
  writtenScrap: number;
  failed: number;
  skipped: number;
  messages: string[];
}

/** Resolves the payload's business codes with the SAME pipeline the entity import uses. */
function resolvePayload(payload: Record<string, unknown>, options: OdooExecutionOptions) {
  return resolveAndValidateImportRow('production', payload, options.context, options.indexes, options.mappingCache);
}

/**
 * Writes the approved rows. Each row is written on its own and records its own
 * outcome; nothing is written for a manufacturing-order context row.
 */
export async function executeOdooImport(
  importSessionId: string,
  staged: readonly OdooStagedRow[],
  options: OdooExecutionOptions,
): Promise<OdooExecutionResult> {
  const out: OdooStagedRow[] = [];
  const messages: string[] = [];
  let writtenProduction = 0;
  let writtenWorkOrders = 0;
  let writtenScrap = 0;
  let failed = 0;
  let skipped = 0;
  const productionIdByRow = new Map<string, { id: string; collection: string; stage: ProductionStageType }>();

  for (const item of staged) {
    if (!isOdooRowWritable(item)) {
      if (item.kind !== 'odooProduction') skipped += 1;
      out.push(item);
      continue;
    }
    try {
      if (item.kind === 'odooWorkOrder') {
        const stage = item.targetStage as ProductionStageType;
        const payload = { ...(item.payload ?? {}) };
        // The same resolution and validation the entity import runs, immediately before the write.
        const checked = resolvePayload(payload, options);
        if (checked.errors.length > 0) {
          throw new Error(checked.errors.map((e) => (options.language === 'ar' ? e.messageAr : e.messageEn)).join(' | '));
        }
        const data = (checked.normalized ?? payload) as Record<string, any>;
        const { stageType: _stage, ...record } = data;
        const productionId = stage === 'pressing'
          ? await createProductionRecord(record as never)
          : await createStageRecord(stage, record, options.productionStatus ?? 'SUBMITTED');
        const collectionName = STAGE_COLLECTION_NAMES[stage];
        productionIdByRow.set(item.row.rowId, { id: productionId, collection: collectionName, stage });
        writtenProduction += 1;

        const workOrderRef = await safeAddDoc(collection(db, WORK_ORDER_COLLECTION), {
          ...sanitizeForFirestore({
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

        const trail = (checked.resolutions ?? []).filter((r) => r.status !== 'EMPTY').map(describeResolution);
        await logAuditAction('CREATE', collectionName, productionId,
          `[ODOO_IMPORT ${importSessionId}] production from work order ${item.row.rowId} (${item.provenance.sourceFile} row ${item.provenance.sourceRow}); workOrder=${workOrderRef.id}${trail.length ? ` | references: ${trail.join('; ')}` : ''}`).catch(() => {});

        out.push({ ...item, row: { ...item.row, status: 'IMPORTED', importedId: productionId, failureMessage: null } });
        await updateStagingOutcome(importSessionId, item, { importedId: productionId, importedCollection: collectionName, status: 'IMPORTED', failureMessage: null });
        continue;
      }

      if (item.kind === 'odooScrap') {
        const payload = item.payload ?? {};
        const related = (item.row.normalizedData as any)?.workOrderRowId as string | undefined;
        const production = related ? productionIdByRow.get(related) : undefined;
        const scrapRef = await safeAddDoc(collection(db, STOCK_SCRAP_COLLECTION), {
          ...sanitizeForFirestore({
            ...payload,
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
        await logAuditAction('CREATE', STOCK_SCRAP_COLLECTION, scrapRef.id,
          `[ODOO_IMPORT ${importSessionId}] scrap from ${item.provenance.sourceFile} row ${item.provenance.sourceRow}`).catch(() => {});
        out.push({ ...item, row: { ...item.row, status: 'IMPORTED', importedId: scrapRef.id, failureMessage: null } });
        await updateStagingOutcome(importSessionId, item, { importedId: scrapRef.id, importedCollection: STOCK_SCRAP_COLLECTION, status: 'IMPORTED', failureMessage: null });
        continue;
      }

      out.push(item);
    } catch (err: any) {
      failed += 1;
      const message = String(err?.message ?? err);
      messages.push(`${item.row.rowId}: ${message}`);
      out.push({ ...item, row: { ...item.row, status: 'FAILED', failureMessage: message } });
      await updateStagingOutcome(importSessionId, item, { importedId: null, importedCollection: null, status: 'FAILED', failureMessage: message }).catch(() => {});
    }
  }

  await safeUpdateDoc(doc(db, IMPORT_SESSION_COLLECTION, importSessionId), {
    status: failed > 0 ? 'PARTIALLY_IMPORTED' : 'COMPLETED',
    updatedAt: now(),
    serverUpdatedAt: serverTimestamp(),
  }).catch(() => {});
  await logAuditAction('BULK_IMPORT', IMPORT_SESSION_COLLECTION, importSessionId,
    `[ODOO_IMPORT] executed ${importSessionId}: production=${writtenProduction}, workOrders=${writtenWorkOrders}, scrap=${writtenScrap}, failed=${failed}, skipped=${skipped}`).catch(() => {});

  return { staged: out, writtenProduction, writtenWorkOrders, writtenScrap, failed, skipped, messages };
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

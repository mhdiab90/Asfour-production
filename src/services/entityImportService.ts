/**
 * Entity import execution - Phase 1 Step 8C-2.
 *
 * Adds NO write path of its own. Each eligible row is written through the very
 * service its screen uses - the shared audited Master Data write for jobs,
 * batches, BOM and routing headers, bomService / routingService for their
 * versions, and createStageRecord / createProductionRecord for production - so
 * an imported record is indistinguishable from a typed one.
 *
 * ROW ISOLATION. Every row is written on its own, inside its own try/catch, and
 * its result is recorded on that row. Ninety-eight rows succeeding and two
 * failing is exactly that: 98 imported, 2 FAILED and still reviewable. A failure
 * never rolls back or blocks another row.
 *
 * REVALIDATION BEFORE WRITING. A row is validated once more, with the data as it
 * stands, immediately before it is written. Anything that became invalid since
 * the review (a code taken by an earlier row of the same file, a deleted
 * reference) is dropped from the batch and reported - never written anyway.
 *
 * AUDIT. The session and every row decision go to the existing audit log through
 * logAuditAction. Nothing here writes a second audit store.
 */
import { MASTER_DATA_COLLECTIONS, createMasterDataItem, fetchMasterData, updateMasterDataItem } from './masterDataService';
import { UPDATABLE_MASTER_FIELDS } from './masterDataPackagePure';
import { externalReferencesPatch, readExternalReferences, upsertExternalReference } from './externalReferencesPure';
import { BOM_VERSION_COLLECTION } from './bomPure';
import { ROUTING_VERSION_COLLECTION } from './routingPure';
import { loadLogicalItemState } from './logicalItemService';
import { listCostCenterHierarchyNodes } from './costCenterHierarchyService';
import { buildHierarchyIndex } from './hierarchyResolverPure';
import { readOperation } from './operationMasterPure';
import { getCategory } from './masterDataCategoryRegistry';
import { stageEquipmentFields } from './productionReferencePure';
import { logAuditAction } from './auditService';
import { createBomVersion } from './bomService';
import { createRoutingVersion } from './routingService';
import { createStageRecord } from './stageRecordService';
import { createProductionRecord } from './productionService';
import { describeBomChange, describeBomVersionChange } from './bomPure';
import { describeRoutingChange } from './routingPure';
import {
  applyRowResult,
  applyValidation,
  describeImportSession,
  describeRowOutcome,
  isRowWritable,
  planImport,
  rowPayload,
} from './entityImportPure';
import type { ImportRow, ImportSession } from './entityImportPure';
import { resolveAndValidateImportRow } from './importEntityValidationPure';
import type { ImportValidationContext } from './importEntityValidationPure';
import { buildReferenceIndexes, describeResolution } from './referenceResolutionPure';
import type { ReferenceIndexes, ReferenceMappingCache } from './referenceResolutionPure';
import type { ProductionStageType, RecordStatus } from '../types';

export interface ImportExecutionOptions {
  /** Step 8C-3: the session's code dictionaries and its approved mappings. */
  indexes: ReferenceIndexes;
  mappingCache?: ReferenceMappingCache;
  user: string;
  at: () => string;
  language: 'ar' | 'en';
  /** The Master Data edit right, for the version services that ask for it. */
  canEdit: boolean;
  /** The status imported production records are created with. */
  productionStatus?: RecordStatus;
}

export interface ImportExecutionResult {
  session: ImportSession;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  excludedCount: number;
  correctedCount: number;
  remainingBlockingCount: number;
  /** Rows dropped by the final revalidation, with the reason. */
  droppedBeforeWrite: Array<{ rowId: string; reason: string }>;
}


/**
 * Everything the shared validators need, read through the existing cache-first
 * master-data reads. Nothing here reads production.
 */
/** The equipment categories of one stage, or of every stage a multi-sheet file carries (Step 8C-5). */
function equipmentCategoriesOf(stageType?: string | readonly string[]): string[] {
  const stages = Array.isArray(stageType) ? stageType : stageType ? [stageType as string] : [];
  return [...new Set(stages.flatMap((s) => stageEquipmentFields(s).map((e) => e.categoryId)))];
}

export async function loadImportValidationContext(stageType?: string | readonly string[]): Promise<ImportValidationContext> {
  const equipmentCategories = equipmentCategoriesOf(stageType);
  const [jobReferences, batches, boms, bomVersions, routings, routingVersions, products, materials, customers, operations, employees, accounts, logical, equipmentGroups, nodes] = await Promise.all([
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.jobReferences).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.batches).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.boms).catch(() => null),
    fetchMasterData<any>(BOM_VERSION_COLLECTION).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.routings).catch(() => null),
    fetchMasterData<any>(ROUTING_VERSION_COLLECTION).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.products).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.materials).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.customers).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.stages).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.employees).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.financialAccounts).catch(() => null),
    loadLogicalItemState().catch(() => null),
    Promise.all(equipmentCategories.map(async (categoryId) => {
      const collection = getCategory(categoryId)?.collection;
      const rows = collection ? await fetchMasterData<any>(collection).catch(() => []) : [];
      return rows.map((r: any) => ({ id: String(r.id ?? ''), categoryId, active: r.active !== false }));
    })),
    listCostCenterHierarchyNodes().catch(() => null),
  ]);
  return {
    jobReferences, batches, boms, bomVersions, routings, routingVersions, products, materials, customers,
    operations: operations ? operations.map(readOperation) : null,
    logicalItems: logical?.items ?? null,
    equipment: equipmentGroups.flat(),
    hierarchyIndex: nodes ? buildHierarchyIndex(nodes as any) : null,
    employees,
    costCenters: nodes ?? null,
    accounts,
  };
}

/**
 * Step 8C-3: the code dictionaries for one import session, built once from the
 * data already loaded. Equipment keeps its own code, so an equipment code in the
 * file resolves to the right machine of the right category.
 */
export async function buildImportReferenceIndexes(context: ImportValidationContext, stageType?: string | readonly string[]): Promise<ReferenceIndexes> {
  const equipmentCategories = equipmentCategoriesOf(stageType);
  const equipmentRecords = (await Promise.all(equipmentCategories.map(async (categoryId) => {
    const collection = getCategory(categoryId)?.collection;
    const rows = collection ? await fetchMasterData<any>(collection).catch(() => []) : [];
    return rows.map((r: any) => ({ ...r, id: String(r.id ?? ''), categoryId }));
  }))).flat();
  return buildReferenceIndexes({
    products: context.products ?? null,
    materials: context.materials ?? null,
    customers: context.customers ?? null,
    employees: context.employees ?? null,
    jobReferences: context.jobReferences ?? null,
    batches: context.batches ?? null,
    boms: context.boms ?? null,
    bomVersions: context.bomVersions ?? null,
    routings: context.routings ?? null,
    routingVersions: context.routingVersions ?? null,
    operations: (context.operations ?? null) as never,
    equipment: equipmentRecords,
    costCenters: context.costCenters ?? null,
    accounts: context.accounts ?? null,
    logicalItems: context.logicalItems ?? null,
  });
}

/** Writes ONE row through its existing service and returns the new document id. */
async function writeRow(row: ImportRow, context: ImportValidationContext, options: ImportExecutionOptions): Promise<string | undefined> {
  const data = (row.normalizedData ?? rowPayload(row)) as Record<string, any>;
  switch (row.entityKind) {
    /*
     * Master Data package (Step 8E) - UPSERTS. An item already in ASFOUR is
     * updated through the existing audited master-data service; its code is
     * never rewritten and it is never duplicated. Odoo ids are merged into
     * `externalRefs` through the existing external-reference rules.
     */
    case 'products':
    case 'materials': {
      const collectionName = row.entityKind === 'products' ? MASTER_DATA_COLLECTIONS.products : MASTER_DATA_COLLECTIONS.materials;
      const { existingId, upsertAction: _action, matchedBy: _matchedBy, ...record } = data;
      if (existingId) {
        const current = (row.entityKind === 'products' ? context.products : context.materials)?.find((r) => String(r.id ?? '') === String(existingId)) ?? null;
        const patch: Record<string, any> = {};
        for (const field of UPDATABLE_MASTER_FIELDS) {
          if (record[field] === undefined) continue;
          if (field === 'externalRefs') continue;
          patch[field] = record[field];
        }
        // External references are merged, never replaced: an existing reference stays.
        const incoming = Array.isArray(record.externalRefs) ? record.externalRefs : [];
        if (incoming.length > 0) {
          let refs = readExternalReferences(current ?? {});
          for (const ref of incoming) refs = upsertExternalReference(refs, ref).refs;
          Object.assign(patch, externalReferencesPatch(refs));
        }
        if (Object.keys(patch).length > 0) {
          await updateMasterDataItem(collectionName, String(existingId), patch);
        }
        return String(existingId);
      }
      return createMasterDataItem(collectionName, record);
    }
    case 'bomPackage': {
      // One BOM and its single version, written together - a version cannot exist before its BOM has an id.
      const bomDraft = { ...(data.bom ?? {}) } as Record<string, any>;
      const versionDraft = { ...(data.version ?? {}) } as Record<string, any>;
      let bomId = String(data.existingBomId ?? '');
      if (bomId) {
        const current = (context.boms ?? []).find((b) => String(b.id ?? '') === bomId) ?? null;
        let refs = readExternalReferences(current ?? {});
        for (const ref of (Array.isArray(bomDraft.externalRefs) ? bomDraft.externalRefs : [])) refs = upsertExternalReference(refs, ref).refs;
        const { code: _code, ...updatable } = bomDraft;
        await updateMasterDataItem(MASTER_DATA_COLLECTIONS.boms, bomId, { ...updatable, ...externalReferencesPatch(refs) });
      } else {
        bomId = String(await createMasterDataItem(MASTER_DATA_COLLECTIONS.boms, bomDraft) ?? '');
        if (!bomId) throw new Error('The BOM could not be created.');
        logAuditAction('CREATE', MASTER_DATA_COLLECTIONS.boms, bomId, describeBomChange(null, bomDraft)).catch(() => {});
      }
      // The package's version already exists: nothing is rewritten, so re-running
      // the same package never duplicates or overwrites a reviewed version.
      if (String(data.existingVersionId ?? '')) return bomId;
      const versionId = await createBomVersion(context.bomVersions ?? [], { ...versionDraft, bomId }, {
        knownItems: {
          products: context.products ? new Set(context.products.map((p) => String(p.id ?? ''))) : null,
          materials: context.materials ? new Set(context.materials.map((m) => String(m.id ?? ''))) : null,
        },
        bom: { id: bomId, ...bomDraft },
        logicalItems: context.logicalItems ?? [],
      }, options.language);
      if (versionId) logAuditAction('CREATE', 'bomVersions', versionId, describeBomVersionChange(null, versionDraft)).catch(() => {});
      return bomId;
    }
    case 'jobReferences': {
      const id = await createMasterDataItem(MASTER_DATA_COLLECTIONS.jobReferences, data);
      return id;
    }
    case 'batches':
      return createMasterDataItem(MASTER_DATA_COLLECTIONS.batches, data);
    case 'boms': {
      const id = await createMasterDataItem(MASTER_DATA_COLLECTIONS.boms, data);
      logAuditAction('CREATE', MASTER_DATA_COLLECTIONS.boms, id, describeBomChange(null, data)).catch(() => {});
      return id;
    }
    case 'routings': {
      const id = await createMasterDataItem(MASTER_DATA_COLLECTIONS.routings, data);
      logAuditAction('CREATE', MASTER_DATA_COLLECTIONS.routings, id, describeRoutingChange(null, data)).catch(() => {});
      return id;
    }
    case 'bomVersions': {
      const bom = (context.boms ?? []).find((b) => String(b.id ?? '') === String(data.bomId ?? '')) ?? null;
      const id = await createBomVersion(context.bomVersions ?? [], data, {
        knownItems: {
          products: context.products ? new Set(context.products.map((p) => String(p.id ?? ''))) : null,
          materials: context.materials ? new Set(context.materials.map((m) => String(m.id ?? ''))) : null,
        },
        bom,
        logicalItems: context.logicalItems ?? [],
      }, options.language);
      if (id) logAuditAction('CREATE', 'bomVersions', id, describeBomVersionChange(null, data)).catch(() => {});
      return id;
    }
    case 'routingVersions': {
      const routing = (context.routings ?? []).find((r) => String(r.id ?? '') === String(data.routingId ?? '')) ?? null;
      return createRoutingVersion(context.routingVersions ?? [], data, {
        routing,
        operations: context.operations ?? null,
        equipment: (context.equipment ?? null) as never,
      } as never, { canEdit: options.canEdit, language: options.language });
    }
    case 'production': {
      const stageType = String(data.stageType ?? '') as ProductionStageType;
      // The record's own single write - the same function the entry form calls.
      const { stageType: _stage, ...record } = data;
      if (stageType === 'pressing') return createProductionRecord(record as never);
      return createStageRecord(stageType, record, options.productionStatus ?? 'SUBMITTED');
    }
    case 'consumptionLine':
    case 'outputLine':
      // Step 8C-4: an orphan line is never written on its own - it belongs to a production record.
      throw new Error('A consumption or output line cannot be written on its own - it must belong to a production row.');
    default:
      throw new Error(`Unsupported import entity: ${row.entityKind}`);
  }
}

/**
 * Executes an import session: revalidates each eligible row, writes it on its
 * own, and returns the session with every row's outcome recorded.
 */
export async function executeEntityImport(
  session: ImportSession,
  context: ImportValidationContext,
  options: ImportExecutionOptions,
): Promise<ImportExecutionResult> {
  const droppedBeforeWrite: Array<{ rowId: string; reason: string }> = [];
  const { willImport } = planImport(session);
  const eligible = new Set(willImport.map((r) => r.rowId));
  // Rows of this same file that were written already, so an in-file duplicate is caught.
  const pendingSameKind: Array<Record<string, unknown> & { id?: string }> = [];
  const rows: ImportRow[] = [];

  for (const row of session.rows) {
    if (!eligible.has(row.rowId)) {
      rows.push(row);
      continue;
    }
    // Final revalidation - business codes resolved again, with everything written so far in this run.
    const recheck = resolveAndValidateImportRow(row.entityKind, rowPayload(row), { ...context, pendingSameKind }, options.indexes, options.mappingCache);
    let current = applyValidation(row, recheck, { user: options.user, at: options.at() });
    if (!isRowWritable(current)) {
      droppedBeforeWrite.push({ rowId: current.rowId, reason: current.errors.map((e) => (options.language === 'ar' ? e.messageAr : e.messageEn)).join(' | ') || 'no longer eligible' });
      rows.push(current);
      continue;
    }
    try {
      const id = await writeRow(current, context, options);
      current = applyRowResult(current, { ok: true, id: id ?? null }, { user: options.user, at: options.at() });
      if (id) pendingSameKind.push({ ...(current.normalizedData ?? {}), id });
    } catch (err: any) {
      // This row alone fails; every other row continues.
      current = applyRowResult(current, { ok: false, error: String(err?.message ?? err) }, { user: options.user, at: options.at() });
    }
    // One audit line per row, naming every business identifier and how it resolved.
    const resolutionTrail = (recheck.resolutions ?? []).filter((r) => r.status !== 'EMPTY').map(describeResolution);
    logAuditAction(
      current.status === 'IMPORTED' ? 'CREATE' : 'UPDATE',
      'importAuditTrail',
      session.importId,
      `${describeRowOutcome(session, current)}${resolutionTrail.length ? ` | references: ${resolutionTrail.join('; ')}` : ''}`,
    ).catch(() => {});
    rows.push(current);
  }

  const next: ImportSession = { ...session, rows };
  logAuditAction('BULK_IMPORT', 'importAuditTrail', session.importId, describeImportSession(next)).catch(() => {});
  return {
    session: next,
    successCount: rows.filter((r) => r.status === 'IMPORTED').length,
    failedCount: rows.filter((r) => r.status === 'FAILED').length,
    skippedCount: rows.filter((r) => r.selection === 'SKIPPED').length,
    excludedCount: rows.filter((r) => r.selection === 'EXCLUDED').length,
    correctedCount: rows.filter((r) => r.correctedRowData && Object.keys(r.correctedRowData).length > 0).length,
    remainingBlockingCount: rows.filter((r) => r.status === 'BLOCKING').length,
    droppedBeforeWrite,
  };
}

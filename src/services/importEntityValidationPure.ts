/**
 * Import row validation - Phase 1 Step 8C-2. Pure and Firebase-free.
 *
 * ONE rule set for imported and typed data. Every entity kind is handed to the
 * SAME validator its own form uses, so a row refused here is refused for exactly
 * the reason the screen would give, and a corrected row is re-checked by those
 * rules - never by a looser "import mode".
 *
 *   jobReferences   jobBatchPure: unique code, status, source, product /
 *                   customer, external identity, and the Step 8C sub-job rules
 *                   (parent exists, one level, no cycle, customer consistent)
 *   batches         jobBatchPure: product and job links, duplicate scope. A job
 *                   or sub-job may have MANY batches - the job's own selected
 *                   batch never limits them
 *   boms /          bomPure: identity, customer scope, defaults, and the Step 7A
 *   bomVersions     formula rules (BASE totals 100%, additives on top, basis,
 *                   quantity/percentage consistency, duplicate and self item)
 *   routings /      routingPure: logical item, customer scope, steps, operations,
 *   routingVersions equipment category and machine, hierarchy node
 *   production      productionReferencePure (job, batch, operation, equipment,
 *                   hierarchy), actualConsumptionPure for its consumption lines,
 *                   productionGenealogyPure for its outputs and input batches
 *
 * UNITS. Every unit value on a row goes through the Step 8 import rule: an
 * approved unit passes, a known legacy spelling passes as its approved value
 * WITH a warning, anything else blocks the row. Nothing is converted.
 *
 * WARNINGS vs ERRORS. An error blocks the row until it is corrected or left out.
 * A warning is a fact the user must see and accept (a legacy spelling, a missing
 * optional reference) - never a silent fix.
 */
import type { ImportEntityKind, ImportIssue } from './entityImportPure';
import { validateBatchForSave, validateJobReferenceForSave, batchPayloadForSave, jobReferencePayloadForSave } from './jobBatchPure';
import { bomPayloadForSave, bomVersionPayloadForSave, validateBomForSave, validateBomVersionForSave } from './bomPure';
import { routingPayloadForSave, routingVersionPayloadForSave, validateRoutingForSave, validateRoutingVersionForSave } from './routingPure';
import { normaliseActualConsumption, validateActualConsumption } from './actualConsumptionPure';
import { normaliseProductionGenealogy, validateProductionGenealogy } from './productionGenealogyPure';
import { validateProductionReferences } from './productionReferencePure';
import type { ProductionReferenceLookups } from './productionReferencePure';
import { classifyImportedUom } from './uomPure';
import { isLegacyStageKey } from './operationMasterPure';
import { validateFormingMethod, validateProductionAreaRecord } from './productionAreaPure';
import { normalisePackagingActivity, validatePackagingActivity } from './packagingActivityPure';
import { resolveRowReferences, resolutionIssues } from './referenceResolutionPure';
import { validateMasterDataPackageRow } from './masterDataPackagePure';
import type { ReferenceIndexes, ReferenceMappingCache, ReferenceResolution } from './referenceResolutionPure';
import type { LogicalItemRecord } from './logicalItemPure';

type Stored = Record<string, unknown> & { id?: string };

export interface ImportValidationContext {
  /** Records already stored, per kind, so duplicates and references are checked against reality. */
  jobReferences?: readonly Stored[] | null;
  batches?: readonly Stored[] | null;
  boms?: readonly Stored[] | null;
  bomVersions?: readonly Stored[] | null;
  routings?: readonly Stored[] | null;
  routingVersions?: readonly Stored[] | null;
  products?: readonly Stored[] | null;
  materials?: readonly Stored[] | null;
  customers?: readonly Stored[] | null;
  operations?: ProductionReferenceLookups['operations'];
  equipment?: ProductionReferenceLookups['equipment'];
  /** Masters used only to resolve business codes (Step 8C-3). */
  employees?: readonly Stored[] | null;
  costCenters?: readonly Stored[] | null;
  accounts?: readonly Stored[] | null;
  /** The cost-centre hierarchy index the reference layer already uses. */
  hierarchyIndex?: ProductionReferenceLookups['hierarchyIndex'];
  logicalItems?: readonly LogicalItemRecord[] | null;
  /** Rows of the same file that were already accepted, so in-file duplicates are caught too. */
  pendingSameKind?: readonly Stored[];
}

export interface ImportValidationResult {
  errors: ImportIssue[];
  warnings: ImportIssue[];
  normalized: Record<string, unknown> | null;
  /** Step 8C-3: how each business identifier on the row was resolved. */
  resolutions?: ReferenceResolution[];
  /** The row as validated - business codes replaced by the ids they name. */
  resolvedPayload?: Record<string, unknown>;
}

const idSet = (list: readonly Stored[] | null | undefined) => (list ? new Set(list.map((r) => String(r.id ?? ''))) : null);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());

/** Units on a row: approved passes, a legacy spelling warns, anything else blocks. */
function unitIssues(field: string, value: unknown): { errors: ImportIssue[]; warnings: ImportIssue[]; normalized: string | null } {
  if (value === undefined || value === null || text(value) === '') return { errors: [], warnings: [], normalized: null };
  const c = classifyImportedUom(value);
  if (c.severity === 'INFO') return { errors: [], warnings: [], normalized: c.normalized };
  if (c.severity === 'WARNING') {
    return {
      errors: [],
      warnings: [{ field, messageAr: `الوحدة "${text(value)}" تهجئة قديمة - ستُقرأ كـ "${c.normalized}".`, messageEn: `Unit "${text(value)}" is a legacy spelling - it is read as "${c.normalized}".` }],
      normalized: c.normalized,
    };
  }
  return {
    errors: [{ field, messageAr: `الوحدة "${text(value)}" ليست وحدة معتمدة - صححها أو استبعد السطر.`, messageEn: `Unit "${text(value)}" is not an approved unit - correct it or leave the row out.` }],
    warnings: [],
    normalized: null,
  };
}

const asIssues = (issues: ReadonlyArray<{ field: string; messageAr: string; messageEn: string }>, prefix = ''): ImportIssue[] =>
  issues.map((i) => ({ field: prefix ? `${prefix}.${i.field}` : i.field, messageAr: i.messageAr, messageEn: i.messageEn }));

/** Lines a production row carries, as arrays (a file may send none). */
const lines = (payload: Record<string, unknown>, field: string): Array<Record<string, unknown>> =>
  Array.isArray(payload[field]) ? (payload[field] as Array<Record<string, unknown>>) : [];

/**
 * A line's identity within its record: the id and order the file gave, else its
 * position in the file. Applied to BOTH input shapes - a multi-sheet workbook and
 * a nested JSON cell - so neither needs to spell out L1, L2, L3 to be valid.
 */
function withLineIdentity(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  for (const field of ['materials', 'productionOutputs', 'components', 'steps']) {
    const lines = Array.isArray(next[field]) ? (next[field] as Array<Record<string, unknown>>) : null;
    if (!lines) continue;
    next[field] = lines.map((line, i) => ({
      ...line,
      lineId: text(line.lineId) || `L${i + 1}`,
      sequence: typeof line.sequence === 'number' && Number.isFinite(line.sequence) ? line.sequence : Number(text(line.sequence)) || i + 1,
    }));
  }
  return next;
}

/**
 * Step 8C-3: turns the row's business identifiers into ids (referenceResolutionPure)
 * and THEN validates it with the shared rules. A reference that cannot be resolved
 * safely blocks the row with its own message - a suggestion is never applied.
 * A row that already carries ids resolves to itself, so nothing that worked before
 * changes.
 */
export function resolveAndValidateImportRow(
  kind: ImportEntityKind,
  payload: Record<string, unknown>,
  context: ImportValidationContext,
  indexes: ReferenceIndexes,
  cache?: ReferenceMappingCache,
): ImportValidationResult {
  const { payload: resolved, resolutions } = resolveRowReferences(kind, payload, indexes, { cache });
  const resolvedPayload = withLineIdentity(resolved);
  const referenceIssues = resolutionIssues(resolutions);
  const validation = validateImportRow(kind, resolvedPayload, context);
  return {
    errors: [...referenceIssues.errors, ...validation.errors],
    warnings: [...referenceIssues.warnings, ...validation.warnings],
    normalized: referenceIssues.errors.length ? null : validation.normalized,
    resolutions,
    resolvedPayload,
  };
}

/**
 * Validates one row of one entity kind with the shared rules. Never writes,
 * never mutates its inputs, and never converts a unit.
 */
export function validateImportRow(kind: ImportEntityKind, payload: Record<string, unknown>, context: ImportValidationContext = {}): ImportValidationResult {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const existing = (list: readonly Stored[] | null | undefined) => [...(list ?? []), ...(context.pendingSameKind ?? [])];

  switch (kind) {
    case 'jobReferences': {
      const check = validateJobReferenceForSave(existing(context.jobReferences), payload, {
        knownProductIds: idSet(context.products),
        knownCustomerIds: idSet(context.customers),
        jobReferences: context.jobReferences ?? null,
      });
      errors.push(...asIssues(check.issues));
      return { errors, warnings, normalized: errors.length ? null : jobReferencePayloadForSave(payload) };
    }
    case 'batches': {
      const check = validateBatchForSave(existing(context.batches), payload, {
        knownProductIds: idSet(context.products),
        knownCustomerIds: idSet(context.customers),
        knownJobReferenceIds: idSet(context.jobReferences),
      });
      errors.push(...asIssues(check.issues));
      if (!text(payload.jobReferenceId)) {
        warnings.push({ field: 'jobReferenceId', messageAr: 'الدفعة غير مرتبطة بأمر شغل - يمكن ربطها لاحقًا.', messageEn: 'The batch is not linked to a job - it can be linked later.' });
      }
      return { errors, warnings, normalized: errors.length ? null : batchPayloadForSave(payload) };
    }
    case 'products':
    case 'materials': {
      /*
       * Master Data package: one product / raw material. The row is an UPSERT -
       * an existing record with the same ASFOUR code, or the same Odoo external
       * reference, is UPDATED, never duplicated. The code itself is never
       * rewritten, and nothing is matched by name alone.
       */
      const existingRecords = (kind === 'products' ? context.products : context.materials) ?? [];
      const check = validateMasterDataPackageRow(kind, payload, existingRecords);
      errors.push(...asIssues(check.issues));
      warnings.push(...asIssues(check.warnings));
      return { errors, warnings, normalized: errors.length ? null : check.payload };
    }
    case 'bomPackage': {
      /*
       * One BOM together with its single version: a version cannot exist before
       * its BOM has an id, so both are validated here with the SAME Step 2
       * validators the separate `boms` / `bomVersions` kinds use, and written in
       * one upsert (entityImportService).
       */
      const bomDraft = (payload.bom ?? {}) as Record<string, unknown>;
      const versionDraft = (payload.version ?? {}) as Record<string, unknown>;
      const bomCheck = validateBomForSave(existing(context.boms), bomDraft, {
        knownItems: { products: idSet(context.products), materials: idSet(context.materials) },
        knownCustomerIds: idSet(context.customers),
        logicalItems: context.logicalItems ?? [],
      });
      errors.push(...asIssues(bomCheck.issues, 'bom'));
      const components = Array.isArray(versionDraft.components) ? (versionDraft.components as Array<Record<string, unknown>>) : [];
      for (const [i, c] of components.entries()) {
        const u = unitIssues(`version.components.${i + 1}.unit`, c.unit);
        errors.push(...u.errors);
        warnings.push(...u.warnings);
      }
      const basis = unitIssues('version.basisUnit', versionDraft.basisUnit);
      errors.push(...basis.errors);
      warnings.push(...basis.warnings);
      // The BOM this version belongs to is the row's own BOM - existing or about to be written.
      const bomForVersion = { ...bomPayloadForSave(bomDraft), id: text(payload.existingBomId) || 'PENDING' };
      const versionCheck = validateBomVersionForSave(existing(context.bomVersions), { ...versionDraft, bomId: bomForVersion.id }, {
        knownItems: { products: idSet(context.products), materials: idSet(context.materials) },
        bom: bomForVersion,
        logicalItems: context.logicalItems ?? [],
      });
      errors.push(...asIssues(versionCheck.issues, 'version'));
      if (errors.length) return { errors, warnings, normalized: null };
      return {
        errors,
        warnings,
        normalized: {
          bom: bomPayloadForSave(bomDraft),
          version: bomVersionPayloadForSave({ ...versionDraft, bomId: bomForVersion.id }),
          existingBomId: text(payload.existingBomId) || null,
          existingVersionId: text(payload.existingVersionId) || null,
          odooBomId: text(payload.odooBomId) || null,
          externalRefs: payload.externalRefs ?? [],
        },
      };
    }
    case 'boms': {
      const check = validateBomForSave(existing(context.boms), payload, {
        knownItems: { products: idSet(context.products), materials: idSet(context.materials) },
        knownCustomerIds: idSet(context.customers),
        logicalItems: context.logicalItems ?? [],
      });
      errors.push(...asIssues(check.issues));
      return { errors, warnings, normalized: errors.length ? null : bomPayloadForSave(payload) };
    }
    case 'bomVersions': {
      const bom = (context.boms ?? []).find((b) => String(b.id ?? '') === text(payload.bomId)) ?? null;
      if (!bom) errors.push({ field: 'bomId', messageAr: 'قائمة المواد غير موجودة.', messageEn: 'The BOM does not exist.' });
      for (const [i, c] of (Array.isArray(payload.components) ? (payload.components as Array<Record<string, unknown>>) : []).entries()) {
        const u = unitIssues(`components.${i + 1}.unit`, c.unit);
        errors.push(...u.errors);
        warnings.push(...u.warnings);
      }
      const basisUnit = unitIssues('basisUnit', payload.basisUnit);
      errors.push(...basisUnit.errors);
      warnings.push(...basisUnit.warnings);
      // The Step 2 + Step 7A rules, including the ACTIVE formula rules when the row activates the version.
      const check = validateBomVersionForSave(existing(context.bomVersions), payload, {
        knownItems: { products: idSet(context.products), materials: idSet(context.materials) },
        bom,
        logicalItems: context.logicalItems ?? [],
      });
      errors.push(...asIssues(check.issues));
      return { errors, warnings, normalized: errors.length ? null : bomVersionPayloadForSave(payload) };
    }
    case 'routings': {
      const check = validateRoutingForSave(existing(context.routings), payload, {
        knownLogicalItemIds: idSet(context.logicalItems as unknown as readonly Stored[] | null),
        knownCustomerIds: idSet(context.customers),
      } as never);
      errors.push(...asIssues(check.issues));
      return { errors, warnings, normalized: errors.length ? null : routingPayloadForSave(payload) };
    }
    case 'routingVersions': {
      const routing = (context.routings ?? []).find((r) => String(r.id ?? '') === text(payload.routingId)) ?? null;
      if (!routing) errors.push({ field: 'routingId', messageAr: 'المسار غير موجود.', messageEn: 'The routing does not exist.' });
      const check = validateRoutingVersionForSave(existing(context.routingVersions), payload, {
        routing,
        operations: context.operations ?? null,
        equipment: (context.equipment ?? null) as never,
      } as never);
      errors.push(...asIssues(check.issues));
      return { errors, warnings, normalized: errors.length ? null : routingVersionPayloadForSave(payload) };
    }
    case 'production': {
      const stageType = text(payload.stageType);
      if (!stageType) {
        errors.push({ field: 'stageType', messageAr: 'نوع المرحلة إلزامي.', messageEn: 'The stage type is required.' });
      } else if (!isLegacyStageKey(stageType)) {
        // Step 8C-5: a stage that is not one of the known record types is never written to a guessed collection.
        errors.push({ field: 'stageType', messageAr: `المرحلة "${stageType}" غير معروفة.`, messageEn: `Unknown stage "${stageType}".` });
      }
      // Step 8C-5: the new record types' own rules, extrusion on pressing only, packing on packing lines only.
      errors.push(...asIssues(validateProductionAreaRecord(stageType, payload).issues));
      errors.push(...asIssues(validateFormingMethod(stageType, payload.formingMethod)));
      const packagingCheck = validatePackagingActivity(stageType, payload.packaging as never);
      errors.push(...asIssues(packagingCheck.issues));
      const consumption = lines(payload, 'materials');
      const outputs = lines(payload, 'productionOutputs');

      // Units first, so a bad unit is reported as itself rather than as a failed rule.
      consumption.forEach((l, i) => {
        const u = unitIssues(`materials.${i + 1}.unit`, l.unit);
        errors.push(...u.errors);
        warnings.push(...u.warnings);
      });
      outputs.forEach((l, i) => {
        const u = unitIssues(`productionOutputs.${i + 1}.unit`, l.unit);
        errors.push(...u.errors);
        warnings.push(...u.warnings);
      });

      // References: job, sub-job, batch, operation, equipment, hierarchy - the Step 5A rules.
      const selection = {
        jobReferenceId: text(payload.jobReferenceId) || undefined,
        batchId: text(payload.batchId) || undefined,
        logicalItemId: text(payload.logicalItemId) || undefined,
        operationId: text(payload.operationId) || undefined,
        hierarchyNodeId: text(payload.hierarchyNodeId) || undefined,
      };
      const refs = validateProductionReferences(stageType, payload, selection, {
        operations: context.operations ?? null,
        equipment: context.equipment ?? null,
        hierarchyIndex: context.hierarchyIndex ?? null,
        jobs: (context.jobReferences ?? null) as never,
        batches: (context.batches ?? null) as never,
        logicalItems: context.logicalItems ?? null,
        products: (context.products ?? null) as never,
        materials: (context.materials ?? null) as never,
      } as ProductionReferenceLookups);
      errors.push(...asIssues(refs.issues));
      if (!selection.jobReferenceId && !selection.batchId) {
        warnings.push({ field: 'jobReferenceId', messageAr: 'سجل غير مرتبط بأمر شغل أو دفعة - سيُستورد كسجل تاريخي غير متتبع.', messageEn: 'No job or batch - the row imports as an untraced historical record.' });
      }

      // Consumption lines: the Step 5B rules.
      let normalisedConsumption: unknown[] = [];
      if (consumption.length > 0) {
        const cctx = { products: context.products ?? null, materials: context.materials ?? null, logicalItems: context.logicalItems ?? null };
        const check = validateActualConsumption(consumption, cctx);
        errors.push(...asIssues(check.issues));
        if (check.valid) normalisedConsumption = normaliseActualConsumption(consumption, cctx);
      }

      // Outputs and input batches: the Step 6 rules.
      let genealogy: Record<string, unknown> = {};
      if (outputs.length > 0 || consumption.some((l) => text(l.batchId))) {
        const gctx = { products: context.products ?? null, materials: context.materials ?? null, logicalItems: context.logicalItems ?? null, batches: context.batches ?? null };
        const input = { inputs: consumption, outputs, jobReferenceId: selection.jobReferenceId ?? null };
        const check = validateProductionGenealogy(input, gctx);
        errors.push(...asIssues(check.issues));
        if (check.valid) genealogy = normaliseProductionGenealogy(input, gctx) as Record<string, unknown>;
      }

      if (errors.length) return { errors, warnings, normalized: null };
      const normalized: Record<string, unknown> = {
        ...payload,
        ...refs.references,
        ...(normalisedConsumption.length ? { materials: normalisedConsumption } : {}),
        ...genealogy,
      };
      if (payload.packaging !== undefined) {
        const packaging = normalisePackagingActivity(payload.packaging as never, context.operations ?? null);
        if (packaging) normalized.packaging = packaging;
        else delete normalized.packaging;
      }
      if (typeof payload.formingMethod === 'string') normalized.formingMethod = payload.formingMethod.trim().toUpperCase();
      return { errors, warnings, normalized };
    }
    default:
      return {
        errors: [{ field: 'entityKind', messageAr: 'نوع السجل غير مدعوم في الاستيراد.', messageEn: 'This entity kind is not supported by the import.' }],
        warnings,
        normalized: null,
      };
  }
}

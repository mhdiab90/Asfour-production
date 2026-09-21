/**
 * Production reference layer - Phase 1 Step 5A. Pure and Firebase-free.
 *
 * NEW production records may carry stable-id references to the setup built
 * earlier - never codes, names, batch numbers or external ids:
 *
 *   jobReferenceId   the job being produced against (Step 1E / Step 4)
 *   logicalItemId    the job's logical item - taken from the job, never retyped
 *   batchId          the lot (Step 1E), compatible under the Step 4 rules
 *   operationId      the Operation Master record for the record's legacy stage
 *   hierarchyNodeId  optional explicit cost-centre override
 *
 * They live in the shared WithProductionReferences mixin and are merged into the
 * data a form already hands to its existing write (createStageRecord /
 * createProductionRecord) - no second write path, no BOM components or routing
 * steps copied, no job / batch / BOM / routing document touched.
 *
 * TWO MODES (a decided policy).
 *   UNTRACED  no job and no batch selected: the entry behaves exactly as before
 *             and is never refused here. operationId is attached only when the
 *             stage resolves to exactly one ACTIVE operation compatible with the
 *             record's equipment; otherwise it is simply omitted.
 *   TRACED    a job or a batch is selected: EVERY reference must validate -
 *             active job, active logical item, compatible batch, an ACTIVE
 *             operation for the stage, known active equipment allowed by that
 *             operation, an existing hierarchy node, and the form's product
 *             belonging to the job's logical item. Any issue = no write.
 *
 * WHICH OPERATION. Resolved from the Operation Master's own legacyStageKey
 * (Step 1C keeps at most one ACTIVE operation per legacy stage) - this module
 * holds no stage->operation table. WHICH EQUIPMENT. The stage's equipment
 * categories come from the registry's STAGE_EQUIPMENT_CATEGORIES and each
 * category's legacyProductionFields (pressing: pressId -> presses, furnaceId ->
 * furnaces); stages without an equipment master keep their free text untouched.
 *
 * Routing is never executed: operationId is the operation this record IS, not a
 * step inferred from a route.
 */
import type { Operation, ProductionStageType } from '../types';
import type { LogicalItemRecord } from './logicalItemPure';
import { resolveLogicalItemId } from './logicalItemPure';
import { batchIncompatibility } from './jobConfigurationPure';
import { STAGE_EQUIPMENT_CATEGORIES, getCategory } from './masterDataCategoryRegistry';
import { validateEquipmentLink } from './hierarchyResolverPure';
import type { HierarchyIndex } from './hierarchyResolverPure';

type Stored = Record<string, unknown> & { id?: string };

/** What the user selected on the entry screen. */
export interface ProductionReferenceSelection {
  jobReferenceId?: string | null;
  batchId?: string | null;
  /** Optional; when a job is selected it must equal the job's logical item. */
  logicalItemId?: string | null;
  /** Optional; when given it must be the stage's resolved operation. */
  operationId?: string | null;
  hierarchyNodeId?: string | null;
}

export interface ProductionReferenceLookups {
  /** null = not loaded. In TRACED mode anything needed but not loaded is refused. */
  operations?: readonly Operation[] | null;
  jobs?: readonly Stored[] | null;
  batches?: readonly Stored[] | null;
  logicalItems?: readonly LogicalItemRecord[] | null;
  /** Equipment records of the stage's categories: { id, categoryId, active }. */
  equipment?: ReadonlyArray<{ id: string; categoryId: string; active: boolean }> | null;
  hierarchyIndex?: HierarchyIndex<any> | null;
}

export interface ProductionReferenceIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface ProductionReferenceResult {
  valid: boolean;
  traced: boolean;
  issues: ProductionReferenceIssue[];
  /** Only the references to merge into the new record - absent keys are not written. */
  references: Partial<Record<'jobReferenceId' | 'batchId' | 'logicalItemId' | 'operationId' | 'hierarchyNodeId', string>>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

/** Whether a selection opts the entry into the strict traced mode. */
export function isTracedSelection(selection: ProductionReferenceSelection | null | undefined): boolean {
  return Boolean(text(selection?.jobReferenceId) || text(selection?.batchId));
}

/**
 * The ACTIVE Operation Master record for a legacy stage, via the operation's own
 * legacyStageKey. More than one active match is ambiguous and resolves to none.
 */
export function resolveOperationForStage(operations: readonly Operation[] | null | undefined, stageType: ProductionStageType | string): { operation: Operation | null; reasonEn: string; reasonAr: string } {
  const matches = (operations ?? []).filter((o) => o.active !== false && text(o.legacyStageKey) === text(stageType));
  if (matches.length === 1) return { operation: matches[0], reasonEn: '', reasonAr: '' };
  if (matches.length === 0) {
    return { operation: null, reasonEn: `No active operation is mapped to the stage "${stageType}" in the Operation Master.`, reasonAr: `لا توجد عملية نشطة مرتبطة بالمرحلة "${stageType}" في العمليات الإنتاجية.` };
  }
  return { operation: null, reasonEn: `More than one active operation is mapped to the stage "${stageType}".`, reasonAr: `أكثر من عملية نشطة مرتبطة بالمرحلة "${stageType}".` };
}

/** The equipment id fields a stage's record carries, from the registry: [{ field, categoryId }]. */
export function stageEquipmentFields(stageType: ProductionStageType | string): Array<{ field: string; categoryId: string }> {
  return (STAGE_EQUIPMENT_CATEGORIES[text(stageType)] ?? []).flatMap((categoryId) => {
    // Step 8C: a stage equipment field when the category declares one, else the legacy production field.
    const category = getCategory(categoryId);
    const field = category?.stageEquipmentField ?? category?.legacyProductionFields?.[0];
    return field ? [{ field, categoryId }] : [];
  });
}

/** The product reference a stage form writes (productId, or linkedProductId on mixing / foam). */
export function recordProductId(data: Record<string, unknown>): string {
  return text(data.productId) || text(data.linkedProductId);
}

/**
 * Validates the selection against the record about to be written and returns
 * the references to merge. Never mutates its inputs.
 */
export function validateProductionReferences(
  stageType: ProductionStageType | string,
  data: Record<string, unknown>,
  selection: ProductionReferenceSelection | null | undefined,
  lookups: ProductionReferenceLookups,
): ProductionReferenceResult {
  const traced = isTracedSelection(selection);
  const issues: ProductionReferenceIssue[] = [];
  const references: ProductionReferenceResult['references'] = {};
  const add = (field: string, ar: string, en: string) => issues.push({ field, messageAr: ar, messageEn: en });
  const sel = selection ?? {};

  // Operation --------------------------------------------------------------------------
  const resolved = resolveOperationForStage(lookups.operations, stageType);
  const operation = resolved.operation;
  const explicitOperation = text(sel.operationId);
  if (explicitOperation && (!operation || explicitOperation !== String(operation.id))) {
    add('operationId', 'العملية المحددة ليست العملية النشطة لهذه المرحلة.', "The given operation is not this stage's active operation.");
  }

  // Equipment against the operation's allowed categories (configuration only).
  const allowed = operation?.allowedEquipmentCategoryIds ?? [];
  let equipmentCompatible = true;
  for (const { field, categoryId } of stageEquipmentFields(stageType)) {
    const equipmentId = text(data[field]);
    if (!equipmentId) continue;
    if (operation && allowed.length > 0 && !allowed.includes(categoryId)) {
      equipmentCompatible = false;
      if (traced) add(field, `فئة المعدات "${categoryId}" غير مسموحة للعملية "${operation.code}".`, `Equipment category "${categoryId}" is not allowed for operation "${operation.code}".`);
    }
    if (traced) {
      if (!lookups.equipment) add(field, 'تعذر التحقق من المعدة - القائمة غير محملة.', 'The equipment cannot be verified - equipment is not loaded.');
      else {
        const machine = lookups.equipment.find((e) => e.categoryId === categoryId && e.id === equipmentId);
        if (!machine) add(field, 'المعدة المحددة غير موجودة في فئتها.', 'The selected equipment does not exist in its category.');
        else if (!machine.active) add(field, 'المعدة المحددة معطلة.', 'The selected equipment is inactive.');
      }
    }
  }

  if (operation && equipmentCompatible) references.operationId = String(operation.id);
  if (traced && !operation) add('operationId', resolved.reasonAr, resolved.reasonEn);

  if (!traced) {
    // Untraced entries are never refused here; only an explicit bad operation id is.
    if (text(sel.hierarchyNodeId)) add('hierarchyNodeId', 'مركز التكلفة يُحدد فقط مع أمر شغل أو دفعة.', 'A cost-centre override is only accepted with a job or batch.');
    return { valid: issues.length === 0, traced, issues, references: issues.length ? {} : references };
  }

  // Job ------------------------------------------------------------------------------------
  const jobId = text(sel.jobReferenceId);
  let job: Stored | undefined;
  if (jobId) {
    if (!lookups.jobs) add('jobReferenceId', 'تعذر التحقق من أمر الشغل - القائمة غير محملة.', 'The job reference cannot be verified - jobs are not loaded.');
    else {
      job = lookups.jobs.find((j) => String(j.id ?? '') === jobId);
      if (!job) add('jobReferenceId', 'أمر الشغل غير موجود.', 'The job reference does not exist.');
      else if (job.active === false || text(job.status).toUpperCase() !== 'ACTIVE') {
        add('jobReferenceId', `أمر الشغل "${text(job.code)}" ليس نشطًا (${text(job.status)}).`, `Job "${text(job.code)}" is not ACTIVE (${text(job.status)}).`);
      } else references.jobReferenceId = jobId;
    }
  }

  // Logical item: the job's, never retyped --------------------------------------------------
  const jobItem = text(job?.logicalItemId);
  const givenItem = text(sel.logicalItemId);
  if (jobItem && givenItem && jobItem !== givenItem) {
    add('logicalItemId', 'الصنف المنطقي للسجل لا يطابق الصنف المنطقي لأمر الشغل.', "The record's logical item does not match the job's logical item.");
  }
  const logicalItemId = jobItem || givenItem;
  if (logicalItemId) {
    const item = (lookups.logicalItems ?? []).find((i) => i.id === logicalItemId);
    if (!lookups.logicalItems) add('logicalItemId', 'تعذر التحقق من الصنف المنطقي - القائمة غير محملة.', 'The logical item cannot be verified - logical items are not loaded.');
    else if (!item) add('logicalItemId', 'الصنف المنطقي غير موجود.', 'The logical item does not exist.');
    else if (item.status !== 'ACTIVE') add('logicalItemId', 'الصنف المنطقي غير نشط.', 'The logical item is inactive.');
    else references.logicalItemId = logicalItemId;

    const productId = recordProductId(data);
    if (productId && lookups.logicalItems && resolveLogicalItemId(lookups.logicalItems, 'products', productId) !== `logicalItem:${logicalItemId}`) {
      add('productId', 'المنتج المختار في النموذج لا يتبع الصنف المنطقي لأمر الشغل - لم يُستبدل تلقائيًا.', "The form's product does not belong to the job's logical item - it is not replaced automatically.");
    }
  }

  // Batch - the Step 4 compatibility rule ---------------------------------------------------------
  const batchId = text(sel.batchId);
  if (batchId) {
    if (!lookups.batches || !lookups.logicalItems) add('batchId', 'تعذر التحقق من الدفعة - البيانات غير محملة.', 'The batch cannot be verified - batches are not loaded.');
    else {
      const batch = lookups.batches.find((b) => String(b.id ?? '') === batchId);
      if (!batch) add('batchId', 'الدفعة غير موجودة - لا يتم إنشاؤها تلقائيًا.', 'The batch does not exist - it is never created automatically.');
      else if (text(batch.productId) && !logicalItemId) {
        add('batchId', `الدفعة "${text(batch.batchNumber)}" مرتبطة بمنتج - اختر أمر شغل له صنف منطقي.`, `Batch "${text(batch.batchNumber)}" is product-bound - select a job with a logical item.`);
      } else if (text(batch.jobReferenceId) && !jobId) {
        add('batchId', `الدفعة "${text(batch.batchNumber)}" مرتبطة بأمر شغل - اختر أمر الشغل نفسه.`, `Batch "${text(batch.batchNumber)}" is bound to a job - select that job.`);
      } else {
        const why = batchIncompatibility(batch, { logicalItemId }, lookups.logicalItems, jobId || null);
        if (why) add('batchId', `الدفعة "${text(batch.batchNumber)}": ${why.ar}`, `Batch "${text(batch.batchNumber)}": ${why.en}`);
        else references.batchId = batchId;
      }
    }
  }

  // Cost-centre override ----------------------------------------------------------------------------
  const nodeId = text(sel.hierarchyNodeId);
  if (nodeId) {
    const index = lookups.hierarchyIndex;
    if (!index) add('hierarchyNodeId', 'تعذر التحقق من مركز التكلفة - التسلسل الهرمي غير محمل.', 'The cost centre cannot be verified - the hierarchy is not loaded.');
    else {
      const link = validateEquipmentLink(index, nodeId);
      if (!link.valid) add('hierarchyNodeId', link.issues[0].messageAr, link.issues[0].messageEn);
      else if (!index.byId.has(nodeId)) add('hierarchyNodeId', 'يجب تخزين مركز التكلفة بمعرّف العقدة.', 'The cost centre must be stored as its hierarchy node id.');
      else references.hierarchyNodeId = nodeId;
    }
  }

  const valid = issues.length === 0;
  return { valid, traced, issues, references: valid ? references : {} };
}

/** One additive audit line naming the references a new record carries (the existing audit service writes it). */
export function describeProductionReferences(recordId: string, record: Record<string, unknown>): string | null {
  const keys = PRODUCTION_REFERENCE_FIELDS.filter((k) => text(record[k]));
  if (keys.length === 0) return null;
  return `[PRODUCTION_REFERENCES] productionRecordId=${recordId} ${keys.map((k) => `${k}=${text(record[k])}`).join(' ')}`;
}

/** The reference fields a new production record may carry (WithProductionReferences). */
export const PRODUCTION_REFERENCE_FIELDS = ['jobReferenceId', 'batchId', 'logicalItemId', 'operationId', 'hierarchyNodeId'] as const;

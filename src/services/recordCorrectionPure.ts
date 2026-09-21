/**
 * Correcting a SAVED production record - Phase 1 Step 8C-2. Pure and Firebase-free.
 *
 * Until now a record's references, consumption lines and outputs could only be
 * set while it was being created; a mistake could not be fixed afterwards. This
 * decides what may be corrected and validates the correction with EXACTLY the
 * rules that governed the original save - productionReferencePure (job, sub-job,
 * batch, operation, equipment, cost centre), actualConsumptionPure (Step 5B) and
 * productionGenealogyPure (Step 6 outputs and input batches). There is no
 * looser "correction mode".
 *
 * WHAT MAY BE CORRECTED: the job / batch references, the stage's own production
 * quantity, the consumption lines (item, quantity, unit, base/additive, input
 * batch, notes), the outputs (item, quantity, unit, batch, type, notes), and the
 * record's notes.
 *
 * WHAT MAY NEVER BE CORRECTED HERE: the document id, the stage type, the
 * collection, who created it and when, and the approval status - identity and
 * workflow, not data. The operation and cost centre are not typed either: they
 * are resolved from the stage and the references, exactly as on save.
 *
 * NOTHING IS WRITTEN HERE. The service applies the returned patch through the
 * existing updateStageRecord, which stores the old and the new value, the user,
 * the time and the reason in the existing record audit history.
 */
import { normaliseActualConsumption, validateActualConsumption } from './actualConsumptionPure';
import type { ConsumptionContext } from './actualConsumptionPure';
import { normaliseProductionGenealogy, validateProductionGenealogy } from './productionGenealogyPure';
import type { GenealogyContext } from './productionGenealogyPure';
import { validateProductionReferences } from './productionReferencePure';
import type { ProductionReferenceLookups, ProductionReferenceSelection } from './productionReferencePure';
import { stageProductionMeasure } from './uomReadinessPure';
import { describeConsumptionChange } from './actualConsumptionPure';
import { describeOutputChange } from './productionGenealogyPure';
import { validateProductionAreaRecord } from './productionAreaPure';

export interface CorrectionIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

/** Fields a correction may never touch - identity and workflow. */
export const UNCORRECTABLE_FIELDS = ['id', 'stageType', 'stageNameAr', 'createdBy', 'createdByName', 'createdAt', 'status', 'serverCreatedAt'] as const;

export interface RecordCorrectionInput {
  /** The job / batch selection as corrected. */
  references?: ProductionReferenceSelection | null;
  /** The consumption lines as corrected; undefined = leave them as they are. */
  materials?: ReadonlyArray<Record<string, unknown>>;
  /** The outputs as corrected; undefined = leave them as they are. */
  productionOutputs?: ReadonlyArray<Record<string, unknown>>;
  /** The stage's own production quantity, in its own field. */
  productionQuantity?: number | null;
  notes?: string;
  reason: string;
}

export interface RecordCorrectionContext {
  lookups: ProductionReferenceLookups;
  consumption: ConsumptionContext;
  genealogy: GenealogyContext;
}

export interface RecordCorrectionPlan {
  valid: boolean;
  issues: CorrectionIssue[];
  /** Only the fields that actually change; empty when nothing changed. */
  patch: Record<string, unknown>;
  /** Human-readable change lines for the audit reason. */
  changes: string[];
}

type Stored = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

const asIssues = (issues: ReadonlyArray<{ field: string; messageAr: string; messageEn: string }>): CorrectionIssue[] => issues.map((i) => ({ ...i }));

/**
 * Validates a correction against the stored record and returns the patch to
 * write. Never mutates the record or the input.
 */
export function planRecordCorrection(
  stageType: string,
  stored: Stored,
  input: RecordCorrectionInput,
  context: RecordCorrectionContext,
): RecordCorrectionPlan {
  const issues: CorrectionIssue[] = [];
  const patch: Record<string, unknown> = {};
  const changes: string[] = [];

  if (!text(input.reason)) {
    issues.push({ field: 'reason', messageAr: 'سبب التصحيح إلزامي.', messageEn: 'A correction reason is required.' });
  }

  const storedMaterials = Array.isArray(stored.materials) ? (stored.materials as Array<Record<string, unknown>>) : [];
  const storedOutputs = Array.isArray(stored.productionOutputs) ? (stored.productionOutputs as Array<Record<string, unknown>>) : [];
  const materials = input.materials ? [...input.materials] : storedMaterials;
  const outputs = input.productionOutputs ? [...input.productionOutputs] : storedOutputs;

  // --- Consumption lines: the Step 5B rules -------------------------------------------
  let normalisedMaterials = storedMaterials;
  if (input.materials) {
    const check = validateActualConsumption(materials, context.consumption);
    issues.push(...asIssues(check.issues));
    if (check.valid) normalisedMaterials = normaliseActualConsumption(materials, context.consumption) as unknown as Array<Record<string, unknown>>;
  }

  // --- References: the Step 5A rules, with the record as it will be -----------------------
  const selection = input.references ?? {
    jobReferenceId: text(stored.jobReferenceId) || undefined,
    batchId: text(stored.batchId) || undefined,
    logicalItemId: text(stored.logicalItemId) || undefined,
    hierarchyNodeId: text(stored.hierarchyNodeId) || undefined,
  };
  const measure = stageProductionMeasure(stageType, stored);
  const nextRecord: Stored = {
    ...stored,
    ...(input.productionQuantity !== undefined && measure.field ? { [measure.field]: input.productionQuantity } : {}),
    materials: normalisedMaterials,
  };
  const refs = validateProductionReferences(stageType, nextRecord, selection, context.lookups);
  issues.push(...asIssues(refs.issues));
  // Step 8C-5: a corrected thermal concrete / tunnel kiln / hand-made brick record keeps its own rules.
  if (input.productionQuantity !== undefined) issues.push(...asIssues(validateProductionAreaRecord(stageType, nextRecord).issues));

  // --- Outputs and input batches: the Step 6 rules ------------------------------------------
  let genealogy: Record<string, unknown> = {};
  if (input.productionOutputs || input.materials) {
    const genealogyInput = { inputs: materials, outputs, jobReferenceId: selection.jobReferenceId ?? null };
    const check = validateProductionGenealogy(genealogyInput, context.genealogy);
    issues.push(...asIssues(check.issues));
    if (check.valid) genealogy = normaliseProductionGenealogy(genealogyInput, context.genealogy) as Record<string, unknown>;
  }

  if (issues.length > 0) return { valid: false, issues, patch: {}, changes: [] };

  // --- The patch: only what actually changed --------------------------------------------------
  if (input.materials) {
    const line = describeConsumptionChange(storedMaterials, normalisedMaterials);
    if (line) {
      patch.materials = normalisedMaterials;
      changes.push(line);
    }
  }
  if (input.productionOutputs || input.materials) {
    const nextOutputs = (genealogy.productionOutputs as Array<Record<string, unknown>> | undefined) ?? [];
    const line = describeOutputChange(storedOutputs, nextOutputs);
    if (line || (storedOutputs.length > 0 && nextOutputs.length === 0)) {
      patch.productionOutputs = nextOutputs;
      patch.genealogyInputBatchIds = genealogy.genealogyInputBatchIds ?? [];
      patch.genealogyOutputBatchIds = genealogy.genealogyOutputBatchIds ?? [];
      changes.push(line ?? '[PRODUCTION_GENEALOGY] all outputs removed');
    }
  }
  if (input.references) {
    for (const field of ['jobReferenceId', 'batchId', 'logicalItemId', 'operationId', 'hierarchyNodeId'] as const) {
      const before = text(stored[field]);
      const after = text((refs.references as Record<string, string | undefined>)[field] ?? (selection as Record<string, unknown>)[field]);
      if (before !== after) {
        patch[field] = after || null;
        changes.push(`${field} ${before || '-'} -> ${after || '-'}`);
      }
    }
  }
  if (input.productionQuantity !== undefined && measure.field) {
    const before = stored[measure.field];
    if (before !== input.productionQuantity) {
      patch[measure.field] = input.productionQuantity;
      changes.push(`${measure.field} ${String(before ?? '-')} -> ${String(input.productionQuantity ?? '-')} ${measure.unit ?? ''}`.trim());
    }
  }
  if (input.notes !== undefined && text(stored.notes) !== text(input.notes)) {
    patch.notes = text(input.notes);
    changes.push('notes changed');
  }

  // Identity and workflow are never part of a correction.
  for (const field of UNCORRECTABLE_FIELDS) delete patch[field];

  return { valid: true, issues: [], patch, changes };
}

/** The audit reason line: what changed, and why the user said it changed. */
export function describeRecordCorrection(plan: RecordCorrectionPlan, reason: string): string {
  return `[RECORD_CORRECTION] ${reason}${plan.changes.length ? ` | ${plan.changes.join(' | ')}` : ''}`;
}

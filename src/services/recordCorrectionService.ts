/**
 * Correcting a saved production record - Phase 1 Step 8C-2.
 *
 * Loads the same master data the entry screen validates against, plans the
 * correction with the shared rules (recordCorrectionPure), and applies it
 * through the EXISTING updateStageRecord - which stores the old value, the new
 * value, the user, the time and the reason in the existing record audit history
 * and writes the existing audit log line. No second write path, no second audit
 * store, and nothing is written when the correction is refused.
 */
import type { ProductionStageType } from '../types';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from './masterDataService';
import { loadLogicalItemState } from './logicalItemService';
import { listCostCenterHierarchyNodes } from './costCenterHierarchyService';
import { buildHierarchyIndex } from './hierarchyResolverPure';
import { readOperation } from './operationMasterPure';
import { getCategory } from './masterDataCategoryRegistry';
import { stageEquipmentFields } from './productionReferencePure';
import { updateStageRecord } from './stageRecordService';
import { describeRecordCorrection, planRecordCorrection } from './recordCorrectionPure';
import type { RecordCorrectionContext, RecordCorrectionInput, RecordCorrectionPlan } from './recordCorrectionPure';

/** Everything the shared validators need, read fresh - a correction is checked against reality. */
export async function loadRecordCorrectionContext(stageType: string): Promise<RecordCorrectionContext> {
  const equipmentCategories = [...new Set(stageEquipmentFields(stageType).map((e) => e.categoryId))];
  const [operations, jobs, batches, logical, products, materials, equipmentGroups, nodes] = await Promise.all([
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.stages, { skipCache: true }).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.jobReferences, { skipCache: true }).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.batches, { skipCache: true }).catch(() => null),
    loadLogicalItemState({ skipCache: true }).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.products).catch(() => null),
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.materials).catch(() => null),
    Promise.all(equipmentCategories.map(async (categoryId) => {
      const collection = getCategory(categoryId)?.collection;
      const rows = collection ? await fetchMasterData<any>(collection).catch(() => []) : [];
      return rows.map((r: any) => ({ id: String(r.id ?? ''), categoryId, active: r.active !== false }));
    })),
    listCostCenterHierarchyNodes().catch(() => null),
  ]);
  return {
    lookups: {
      operations: operations ? operations.map(readOperation) : null,
      jobs,
      batches,
      logicalItems: logical?.items ?? null,
      equipment: equipmentGroups.flat(),
      hierarchyIndex: nodes ? buildHierarchyIndex(nodes as any) : null,
    },
    consumption: { products, materials, logicalItems: logical?.items ?? null },
    genealogy: { products, materials, logicalItems: logical?.items ?? null, batches },
  };
}

/**
 * Validates a correction and applies it. Returns the plan, so a refusal can be
 * shown field by field. Nothing is written when the plan is invalid or empty.
 */
export async function correctProductionRecord(
  stageType: ProductionStageType,
  recordId: string,
  stored: Record<string, unknown>,
  input: RecordCorrectionInput,
  language: 'ar' | 'en',
): Promise<{ plan: RecordCorrectionPlan; written: boolean }> {
  const context = await loadRecordCorrectionContext(stageType);
  const plan = planRecordCorrection(stageType, stored, input, context);
  if (!plan.valid) {
    throw new Error(plan.issues.map((i) => (language === 'ar' ? i.messageAr : i.messageEn)).join(' | '));
  }
  if (Object.keys(plan.patch).length === 0) return { plan, written: false };
  // The existing correction write: it records the old and new values, the user, the time and the reason.
  await updateStageRecord(stageType, recordId, plan.patch, describeRecordCorrection(plan, input.reason));
  return { plan, written: true };
}

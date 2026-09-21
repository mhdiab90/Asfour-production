/**
 * Production references for NEW entries - Phase 1 Step 5A.
 *
 * `attachProductionReferences` runs in each stage form immediately before the
 * form's EXISTING write (createStageRecord / createProductionRecord), and returns
 * the same data with the validated references merged in. So the record still
 * goes through its one existing write - including Pressing's batched side
 * collections - and the stage audit history (which stores the written data)
 * records the references. Nothing else is written: no job, batch, BOM, routing
 * or logical item is created or changed, and historical records are never read
 * or rewritten here. Historical importers do not call it.
 *
 * UNTRACED entries (no job, no batch) never fail here: if the Operation Master
 * cannot be read or the stage has no single active operation, the entry saves
 * exactly as before, just without operationId. TRACED entries read everything
 * fresh and refuse on any invalid or unverifiable reference - before the write.
 */
import type { ProductionStageType } from '../types';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from './masterDataService';
import { readOperation } from './operationMasterPure';
import { loadLogicalItemState } from './logicalItemService';
import { listCostCenterHierarchyNodes } from './costCenterHierarchyService';
import { buildHierarchyIndex } from './hierarchyResolverPure';
import { getCategory } from './masterDataCategoryRegistry';
import {
  ProductionReferenceLookups,
  ProductionReferenceSelection,
  isTracedSelection,
  stageEquipmentFields,
  validateProductionReferences,
} from './productionReferencePure';

export async function attachProductionReferences<T extends Record<string, any>>(
  stageType: ProductionStageType,
  data: T,
  selection: ProductionReferenceSelection | null | undefined,
  language: 'ar' | 'en' | string,
): Promise<T> {
  const traced = isTracedSelection(selection);
  const isAr = language === 'ar';
  const unavailable = (what: string, err: unknown): never => {
    throw new Error(isAr
      ? `تعذر التحقق من ${what} لسجل مرتبط بأمر شغل أو دفعة - لم يُحفظ شيء. (${String((err as any)?.message ?? err)})`
      : `Could not verify ${what} for a job/batch-linked entry - nothing was saved. (${String((err as any)?.message ?? err)})`);
  };

  const lookups: ProductionReferenceLookups = { operations: null };
  try {
    const rows = await fetchMasterData<any>(MASTER_DATA_COLLECTIONS.stages, { skipCache: traced });
    lookups.operations = rows.map(readOperation);
  } catch (err) {
    if (traced) unavailable(isAr ? 'العمليات الإنتاجية' : 'the Operation Master', err);
    // Untraced: the entry saves as before, without operationId.
  }

  if (traced) {
    try {
      const equipmentCategories = [...new Set(stageEquipmentFields(stageType).map((e) => e.categoryId))];
      const [jobs, batches, logical, equipmentGroups, nodes] = await Promise.all([
        fetchMasterData<any>(MASTER_DATA_COLLECTIONS.jobReferences, { skipCache: true }),
        fetchMasterData<any>(MASTER_DATA_COLLECTIONS.batches, { skipCache: true }),
        loadLogicalItemState({ skipCache: true }),
        Promise.all(equipmentCategories.map(async (categoryId) => {
          const collection = getCategory(categoryId)?.collection;
          const rows = collection ? await fetchMasterData<any>(collection, { skipCache: true }) : [];
          return rows.map((r: any) => ({ id: String(r.id ?? ''), categoryId, active: r.active !== false }));
        })),
        selection?.hierarchyNodeId ? listCostCenterHierarchyNodes({ skipCache: true }) : Promise.resolve(null),
      ]);
      lookups.jobs = jobs;
      lookups.batches = batches;
      lookups.logicalItems = logical.items;
      lookups.equipment = equipmentGroups.flat();
      lookups.hierarchyIndex = nodes
        ? buildHierarchyIndex(nodes.map((node) => ({ ...node, id: node.id, code: node.sheet1Code, parentId: node.parentSheet1Code })))
        : null;
    } catch (err) {
      unavailable(isAr ? 'مراجع أمر الشغل والدفعة' : 'the job and batch references', err);
    }
  }

  const result = validateProductionReferences(stageType, data, selection, lookups);
  if (!result.valid) {
    throw new Error(result.issues.map((i) => (isAr ? i.messageAr : i.messageEn)).join(' | '));
  }
  return { ...data, ...result.references };
}

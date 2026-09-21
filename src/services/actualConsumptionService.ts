/**
 * Actual consumption for NEW production entries - Phase 1 Step 5B.
 *
 * `prepareActualConsumption` runs in a stage form immediately before its
 * existing write and returns the normalised lines for the record's own
 * `materials` array - so consumption is saved in the SAME single write as the
 * record and cannot persist on its own. Invalid or unverifiable lines throw, so
 * the write never runs. It reads products, materials and logical items (the
 * shared cache-first reads) and writes nothing: no BOM, job, batch, logical item,
 * inventory or Material.currentStock is touched. Historical importers do not call it.
 */
import type { MaterialConsumptionItem } from '../types';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from './masterDataService';
import { loadLogicalItemState } from './logicalItemService';
import { normaliseActualConsumption, validateActualConsumption } from './actualConsumptionPure';

export async function prepareActualConsumption(
  input: ReadonlyArray<MaterialConsumptionItem | Record<string, unknown>>,
  language: 'ar' | 'en' | string,
): Promise<MaterialConsumptionItem[]> {
  const lines = input as ReadonlyArray<Record<string, unknown>>;
  if (lines.length === 0) return [];
  const isAr = language === 'ar';
  let context;
  try {
    const [products, materials, logical] = await Promise.all([
      fetchMasterData<any>(MASTER_DATA_COLLECTIONS.products),
      fetchMasterData<any>(MASTER_DATA_COLLECTIONS.materials),
      loadLogicalItemState().catch(() => ({ items: [] })),
    ]);
    context = { products, materials, logicalItems: logical.items };
  } catch (err: any) {
    throw new Error(isAr
      ? `تعذر التحقق من أصناف الاستهلاك - لم يُحفظ شيء. (${String(err?.message ?? err)})`
      : `Could not verify the consumed items - nothing was saved. (${String(err?.message ?? err)})`);
  }
  const check = validateActualConsumption(lines, context);
  if (!check.valid) throw new Error(check.issues.map((i) => (isAr ? i.messageAr : i.messageEn)).join(' | '));
  return normaliseActualConsumption(lines, context);
}

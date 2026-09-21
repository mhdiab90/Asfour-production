/**
 * Production genealogy for NEW entries - Phase 1 Step 6.
 *
 * `prepareProductionGenealogy` runs in each stage form immediately before its
 * existing write and returns the genealogy fields to merge into the record's own
 * data (outputs + the two batch-id index lists) - so genealogy is saved in the
 * SAME single write as the record and never on its own. Invalid or unverifiable
 * genealogy throws, so the write never runs.
 *
 * An entry without output lines and without input batches reads nothing and
 * returns {} - it saves exactly as before. Nothing here writes: no batch, logical
 * item, BOM, job, routing, stock or cost is created or changed, no downstream
 * record is created, and historical records are never read. Importers do not call it.
 */
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from './masterDataService';
import { loadLogicalItemState } from './logicalItemService';
import type { ProductionReferenceSelection } from './productionReferencePure';
import { normaliseProductionGenealogy, validateProductionGenealogy } from './productionGenealogyPure';

export async function prepareProductionGenealogy(
  inputs: ReadonlyArray<object>,
  outputs: ReadonlyArray<object>,
  selection: ProductionReferenceSelection | null | undefined,
  language: 'ar' | 'en' | string,
): Promise<ReturnType<typeof normaliseProductionGenealogy>> {
  const inputLines = inputs as ReadonlyArray<Record<string, unknown>>;
  const outputLines = outputs as ReadonlyArray<Record<string, unknown>>;
  const hasInputBatches = inputLines.some((l) => String(l.batchId ?? '').trim());
  if (outputLines.length === 0 && !hasInputBatches) return {};

  const isAr = language === 'ar';
  let context;
  try {
    const [products, materials, logical, batches] = await Promise.all([
      fetchMasterData<any>(MASTER_DATA_COLLECTIONS.products),
      fetchMasterData<any>(MASTER_DATA_COLLECTIONS.materials),
      loadLogicalItemState({ skipCache: true }),
      fetchMasterData<any>(MASTER_DATA_COLLECTIONS.batches, { skipCache: true }),
    ]);
    context = { products, materials, logicalItems: logical.items, batches };
  } catch (err: any) {
    throw new Error(isAr
      ? `تعذر التحقق من المخرجات والدفعات - لم يُحفظ شيء. (${String(err?.message ?? err)})`
      : `Could not verify the outputs and batches - nothing was saved. (${String(err?.message ?? err)})`);
  }
  const genealogy = { inputs: inputLines, outputs: outputLines, jobReferenceId: selection?.jobReferenceId ?? null };
  const check = validateProductionGenealogy(genealogy, context);
  if (!check.valid) throw new Error(check.issues.map((i) => (isAr ? i.messageAr : i.messageEn)).join(' | '));
  return normaliseProductionGenealogy(genealogy, context);
}

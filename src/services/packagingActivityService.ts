/**
 * Packing sub-activity for the entry forms - Phase 1 Step 8C-5.
 *
 * `preparePackagingActivity` runs in a packing line's form immediately before
 * its existing write and returns `{ packaging }` to merge into that record's
 * own data - so packing is saved in the SAME single write, never on its own.
 * Nothing recorded returns {} and the entry saves exactly as before. Invalid
 * packing throws, so the write never runs. Nothing here writes.
 */
import type { PackagingActivity, ProductionStageType } from '../types';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from './masterDataService';
import { readOperation } from './operationMasterPure';
import { isEmptyPackaging, normalisePackagingActivity, validatePackagingActivity } from './packagingActivityPure';

export async function preparePackagingActivity(
  stageType: ProductionStageType,
  packaging: Partial<PackagingActivity> | null | undefined,
  language: 'ar' | 'en' | string,
): Promise<{ packaging?: PackagingActivity }> {
  if (isEmptyPackaging(packaging)) return {};
  const isAr = language === 'ar';
  const check = validatePackagingActivity(stageType, packaging);
  if (!check.valid) {
    throw new Error(check.issues.map((i) => (isAr ? i.messageAr : i.messageEn)).join(' | '));
  }
  // The packing operation is linked when it resolves; an unreadable Operation Master only omits the link.
  const operations = await fetchMasterData<any>(MASTER_DATA_COLLECTIONS.stages)
    .then((rows) => rows.map(readOperation))
    .catch(() => null);
  const normalised = normalisePackagingActivity(packaging, operations);
  return normalised ? { packaging: normalised } : {};
}

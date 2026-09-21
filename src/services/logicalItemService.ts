/**
 * Logical item decisions - Phase 1 Step 2A.
 *
 * The only write path for `logicalItems` and `itemPairDecisions`. Every call:
 *   1. refuses unless the caller holds the existing Master Data edit gate,
 *   2. re-reads both collections fresh (never a stale cached copy),
 *   3. plans with logicalItemPure - a refused plan throws and writes nothing,
 *   4. writes exactly ONE document through the shared audited
 *      createMasterDataItem / updateMasterDataItem (no raw Firestore write),
 *   5. adds a descriptive audit line naming the product, material, logical item,
 *      the previous and the new state.
 *
 * Registration of a single record (Phase 1 Step 3) re-runs the existing
 * overlap analyzer on fresh reads, so an undecided product/material pair always
 * blocks it - the caller cannot pass a stale or empty list.
 *
 * It never touches a product, material, BOM, job, batch or production record.
 * Nothing is deleted: withdrawing a decision sets it INACTIVE.
 */
import { auth } from '../config/firebase';
import { createMasterDataItem, fetchMasterData, updateMasterDataItem } from './masterDataService';
import { logAuditAction } from './auditService';
import { analyzeProductMaterialOverlap } from './itemOverlapAnalysisPure';
import {
  ITEM_PAIR_DECISION_COLLECTION,
  ItemPairDecisionRecord,
  LOGICAL_ITEM_COLLECTION,
  LogicalItemRecord,
  MappingPlan,
  ProductMaterialPair,
  RecordLabel,
  describeKeepSeparate,
  describeRegistration,
  LogicalItemSource,
  logicalItemRegistrationPayload,
  planSingleRecordRegistration,
  describeMapping,
  describeRetirement,
  itemPairDecisionPayloadForCreate,
  logicalItemPayloadForCreate,
  planKeepSeparate,
  planProductMaterialMapping,
  readItemPairDecision,
  readLogicalItem,
} from './logicalItemPure';

type Language = 'ar' | 'en';

export interface LogicalItemState {
  items: LogicalItemRecord[];
  decisions: ItemPairDecisionRecord[];
}

function currentUserId(): string | null {
  return auth.currentUser?.uid ?? null;
}

function requireEditor(canEdit: boolean, language: Language): void {
  if (!canEdit) {
    throw new Error(language === 'ar' ? 'لا تملك صلاحية تعديل البيانات الأساسية.' : 'You do not have permission to edit Master Data.');
  }
}

/** Both collections, cache-first by default; `skipCache` before any decision. */
export async function loadLogicalItemState(options?: { skipCache?: boolean }): Promise<LogicalItemState> {
  const [items, decisions] = await Promise.all([
    fetchMasterData<Record<string, unknown> & { id?: string }>(LOGICAL_ITEM_COLLECTION, options),
    fetchMasterData<Record<string, unknown> & { id?: string }>(ITEM_PAIR_DECISION_COLLECTION, options),
  ]);
  return { items: items.map(readLogicalItem), decisions: decisions.map(readItemPairDecision) };
}

export interface MappingResult {
  plan: MappingPlan;
  logicalItemId: string | undefined;
  wrote: boolean;
}

/** "Map as Same Logical Item" for one explicitly confirmed pair. */
export async function mapProductToMaterial(
  pair: ProductMaterialPair,
  labels: { product: RecordLabel; material: RecordLabel },
  options: { canEdit: boolean; reason?: string; language: Language },
): Promise<MappingResult> {
  requireEditor(options.canEdit, options.language);
  const state = await loadLogicalItemState({ skipCache: true });
  const plan = planProductMaterialMapping(state.items, state.decisions, pair);
  if (plan.outcome === 'CONFLICT') throw new Error(options.language === 'ar' ? plan.messageAr : plan.messageEn);
  if (plan.outcome === 'ALREADY_MAPPED') return { plan, logicalItemId: plan.logicalItemId, wrote: false };

  const userId = currentUserId();
  if (plan.outcome === 'CREATE') {
    const id = await createMasterDataItem(LOGICAL_ITEM_COLLECTION, logicalItemPayloadForCreate(pair, { reason: options.reason, userId }));
    if (id) logAuditAction('CREATE', LOGICAL_ITEM_COLLECTION, id, describeMapping(plan, labels.product, labels.material, id, null)).catch(() => {});
    return { plan, logicalItemId: id, wrote: true };
  }

  const logicalItemId = String(plan.logicalItemId);
  const previous = state.items.find((i) => i.id === logicalItemId) ?? null;
  const patch: Record<string, unknown> = plan.outcome === 'ATTACH_MATERIAL'
    ? { materialId: pair.materialId, updatedBy: userId }
    : { productId: pair.productId, updatedBy: userId };
  await updateMasterDataItem(LOGICAL_ITEM_COLLECTION, logicalItemId, patch);
  logAuditAction('UPDATE', LOGICAL_ITEM_COLLECTION, logicalItemId, describeMapping(plan, labels.product, labels.material, logicalItemId, previous)).catch(() => {});
  return { plan, logicalItemId, wrote: true };
}

/** "Keep Separate" for one explicitly chosen pair. Idempotent. */
export async function keepProductAndMaterialSeparate(
  pair: ProductMaterialPair,
  labels: { product: RecordLabel; material: RecordLabel },
  options: { canEdit: boolean; reason?: string; language: Language },
): Promise<{ decisionId: string | undefined; wrote: boolean }> {
  requireEditor(options.canEdit, options.language);
  const state = await loadLogicalItemState({ skipCache: true });
  const plan = planKeepSeparate(state.items, state.decisions, pair);
  if (plan.outcome === 'CONFLICT') throw new Error(options.language === 'ar' ? plan.messageAr : plan.messageEn);
  if (plan.outcome === 'ALREADY_KEPT_SEPARATE') return { decisionId: plan.decisionId, wrote: false };
  const id = await createMasterDataItem(ITEM_PAIR_DECISION_COLLECTION, itemPairDecisionPayloadForCreate(pair, { reason: options.reason, userId: currentUserId() }));
  if (id) logAuditAction('CREATE', ITEM_PAIR_DECISION_COLLECTION, id, describeKeepSeparate(labels.product, labels.material, id)).catch(() => {});
  return { decisionId: id, wrote: true };
}

/** "Register as Logical Item" for one product or material on its own. Idempotent. */
export async function registerLogicalItem(
  source: LogicalItemSource,
  record: RecordLabel,
  options: { canEdit: boolean; language: Language },
): Promise<{ logicalItemId: string | undefined; wrote: boolean }> {
  requireEditor(options.canEdit, options.language);
  const [state, materials, products, productTypes] = await Promise.all([
    loadLogicalItemState({ skipCache: true }),
    fetchMasterData<any>('materials', { skipCache: true }),
    fetchMasterData<any>('products', { skipCache: true }),
    fetchMasterData<any>('productTypes', { skipCache: true }),
  ]);
  const rows = analyzeProductMaterialOverlap(materials, products, productTypes).rows;
  const plan = planSingleRecordRegistration(state.items, state.decisions, source, record.id, rows);
  if (plan.outcome === 'CONFLICT') throw new Error(options.language === 'ar' ? plan.messageAr : plan.messageEn);
  if (plan.outcome === 'ALREADY_REGISTERED') return { logicalItemId: plan.logicalItemId, wrote: false };
  const id = await createMasterDataItem(LOGICAL_ITEM_COLLECTION, logicalItemRegistrationPayload(source, record.id, { userId: currentUserId() }));
  if (id) logAuditAction('CREATE', LOGICAL_ITEM_COLLECTION, id, describeRegistration(source, record, id)).catch(() => {});
  return { logicalItemId: id, wrote: true };
}

/** Unlinks a logical item (INACTIVE). The source records are untouched and the document stays readable. */
export async function unlinkLogicalItem(logicalItemId: string, options: { canEdit: boolean; language: Language }): Promise<void> {
  requireEditor(options.canEdit, options.language);
  const state = await loadLogicalItemState({ skipCache: true });
  const item = state.items.find((i) => i.id === logicalItemId);
  if (!item || item.status !== 'ACTIVE') {
    throw new Error(options.language === 'ar' ? 'الصنف المنطقي غير موجود أو غير نشط.' : 'The logical item does not exist or is not active.');
  }
  await updateMasterDataItem(LOGICAL_ITEM_COLLECTION, logicalItemId, { status: 'INACTIVE', updatedBy: currentUserId() });
  logAuditAction('DEACTIVATE', LOGICAL_ITEM_COLLECTION, logicalItemId, describeRetirement('logicalItem', logicalItemId, item)).catch(() => {});
}

/** Withdraws a Keep Separate decision (INACTIVE). */
export async function withdrawKeepSeparate(decisionId: string, options: { canEdit: boolean; language: Language }): Promise<void> {
  requireEditor(options.canEdit, options.language);
  const state = await loadLogicalItemState({ skipCache: true });
  const decision = state.decisions.find((d) => d.id === decisionId);
  if (!decision || decision.status !== 'ACTIVE') {
    throw new Error(options.language === 'ar' ? 'القرار غير موجود أو غير نشط.' : 'The decision does not exist or is not active.');
  }
  await updateMasterDataItem(ITEM_PAIR_DECISION_COLLECTION, decisionId, { status: 'INACTIVE', updatedBy: currentUserId() });
  logAuditAction('DEACTIVATE', ITEM_PAIR_DECISION_COLLECTION, decisionId, describeRetirement('decision', decisionId, decision)).catch(() => {});
}

/**
 * Operation Master - the validation and save-shape rules, pure and
 * Firebase-free.
 *
 * WHERE OPERATIONS LIVE. The `stages` collection that MASTER_DATA_COLLECTIONS
 * already registered. Nothing ever read or wrote it (firestore.rules had no
 * block for it, so the default-deny applied), which is what makes reusing it
 * safe. Writes go through the existing audited createMasterDataItem /
 * updateMasterDataItem / toggleMasterDataActive - there is no second data layer.
 *
 * WHAT IS REUSED, NOT RESTATED:
 *   legacy stage keys        STAGE_COLLECTION_NAMES (stageQueryBoundsPure.ts)
 *   equipment category ids   RECONCILABLE_EQUIPMENT_CATEGORIES - the registry's
 *                            own list of equipment master data categories
 *   cost-centre existence    the shared hierarchy index (hierarchyResolverPure)
 *   code comparison          normalizeCode (searchUtils.ts), the rule behind every
 *                            stored `*CodeNormalized` field
 *
 * THE LEGACY STAGE RULE. A legacy stage may be mapped by at most one ACTIVE
 * operation. An inactive operation keeps its mapping for traceability, and
 * reactivating it is checked the same way as saving.
 *
 * Nothing here decides production behaviour: entry forms, stage collections,
 * reports and permissions keep using ProductionStageType exactly as before.
 */
import type { Operation, ProductionStageType } from '../types';
import { STAGE_COLLECTION_NAMES } from './stageQueryBoundsPure';
import { RECONCILABLE_EQUIPMENT_CATEGORIES } from './legacyHierarchyReconciliationPure';
import type { HierarchyIndex } from './hierarchyResolverPure';
import { normalizeCode } from '../utils/searchUtils';

/** Every legacy stage key, in the legacy order - read from the one existing map. */
export const LEGACY_STAGE_KEYS = Object.keys(STAGE_COLLECTION_NAMES) as ProductionStageType[];

/** Equipment categories an operation may reference - the existing equipment categories, nothing invented. */
export const OPERATION_EQUIPMENT_CATEGORY_IDS: readonly string[] = RECONCILABLE_EQUIPMENT_CATEGORIES;

export function isLegacyStageKey(value: unknown): value is ProductionStageType {
  return typeof value === 'string' && (LEGACY_STAGE_KEYS as string[]).includes(value);
}

export interface OperationIssue {
  field: keyof Operation;
  messageAr: string;
  messageEn: string;
}

export interface OperationValidation {
  valid: boolean;
  issues: OperationIssue[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

/**
 * The exact document shape to write, from an arbitrary form state.
 *
 * Only Operation fields - never `id`, timestamps or `externalRefs`, so an edit
 * cannot overwrite the document id or references a sync attached. Empty
 * optionals become null (stored explicitly, so clearing a link sticks).
 */
export function operationPayloadForSave(input: Partial<Operation> & Record<string, unknown>): Omit<Operation, 'id' | 'createdAt' | 'updatedAt' | 'externalRefs'> {
  const order = input.defaultOrder;
  const orderText = text(order);
  const legacy = text(input.legacyStageKey);
  const node = text(input.hierarchyNodeId);
  const categories = Array.isArray(input.allowedEquipmentCategoryIds) ? input.allowedEquipmentCategoryIds : [];
  return {
    code: text(input.code),
    nameAr: text(input.nameAr),
    nameEn: text(input.nameEn),
    description: text(input.description),
    defaultOrder: orderText === '' ? null : Number(orderText),
    legacyStageKey: legacy === '' ? null : (legacy as ProductionStageType),
    hierarchyNodeId: node === '' ? null : node,
    allowedEquipmentCategoryIds: [...new Set(categories.map((c) => text(c)).filter(Boolean))],
    active: input.active !== false,
  };
}

/**
 * The legacy-stage rule on its own: the key must be a real legacy stage, and an
 * ACTIVE operation may not share it with another active operation. `others`
 * must already exclude the operation being checked.
 */
function legacyStageMappingIssues(
  others: readonly Operation[],
  op: Pick<Operation, 'legacyStageKey' | 'active'>,
): OperationIssue[] {
  if (op.legacyStageKey === null || op.legacyStageKey === undefined) return [];
  if (!isLegacyStageKey(op.legacyStageKey)) {
    return [{ field: 'legacyStageKey', messageAr: `المرحلة القديمة "${op.legacyStageKey}" غير معروفة.`, messageEn: `Unknown legacy stage "${op.legacyStageKey}".` }];
  }
  if (!op.active) return [];
  const clash = others.find((e) => e.active !== false && e.legacyStageKey === op.legacyStageKey);
  if (!clash) return [];
  return [{
    field: 'legacyStageKey',
    messageAr: `المرحلة القديمة "${op.legacyStageKey}" مرتبطة بالفعل بالعملية النشطة "${clash.code}".`,
    messageEn: `Legacy stage "${op.legacyStageKey}" is already mapped to active operation "${clash.code}".`,
  }];
}

/**
 * Validates an operation before it is created or updated.
 *
 * `existing` is every stored operation (active and inactive); `editingId` is the
 * document being edited, so it does not collide with itself. The hierarchy index
 * is the shared one - a cost-centre reference must name a node that exists.
 */
export function validateOperationForSave(
  existing: readonly Operation[],
  draft: Partial<Operation> & Record<string, unknown>,
  context: { hierarchyIndex: HierarchyIndex<any>; editingId?: string | null },
): OperationValidation {
  const op = operationPayloadForSave(draft);
  const issues: OperationIssue[] = [];
  const others = existing.filter((e) => !context.editingId || e.id !== context.editingId);

  if (!op.code) {
    issues.push({ field: 'code', messageAr: 'كود العملية إلزامي.', messageEn: 'Operation code is required.' });
  } else if (others.some((e) => normalizeCode(e.code) === normalizeCode(op.code))) {
    issues.push({ field: 'code', messageAr: `كود العملية "${op.code}" مستخدم بالفعل.`, messageEn: `Operation code "${op.code}" is already used.` });
  }

  if (!op.nameAr) {
    issues.push({ field: 'nameAr', messageAr: 'الاسم بالعربية إلزامي.', messageEn: 'The Arabic name is required.' });
  }

  issues.push(...legacyStageMappingIssues(others, op));

  if (op.hierarchyNodeId && !context.hierarchyIndex.byId.has(op.hierarchyNodeId)) {
    issues.push({
      field: 'hierarchyNodeId',
      messageAr: `مركز التكلفة "${op.hierarchyNodeId}" غير موجود في التسلسل الهرمي.`,
      messageEn: `Cost centre "${op.hierarchyNodeId}" does not exist in the hierarchy.`,
    });
  }

  const unknownCategories = (op.allowedEquipmentCategoryIds ?? []).filter((c) => !OPERATION_EQUIPMENT_CATEGORY_IDS.includes(c));
  if (unknownCategories.length > 0) {
    issues.push({
      field: 'allowedEquipmentCategoryIds',
      messageAr: `فئات معدات غير معروفة: ${unknownCategories.join('، ')}.`,
      messageEn: `Unknown equipment categories: ${unknownCategories.join(', ')}.`,
    });
  }

  if (op.defaultOrder !== null && op.defaultOrder !== undefined && (!Number.isInteger(op.defaultOrder) || op.defaultOrder < 0)) {
    issues.push({ field: 'defaultOrder', messageAr: 'الترتيب الافتراضي يجب أن يكون رقمًا صحيحًا غير سالب.', messageEn: 'Default order must be a whole number of zero or more.' });
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Whether flipping an operation's active flag is allowed.
 *
 * Deactivating is always allowed - retiring never loses history. Reactivating
 * runs the same legacy-stage rule as saving.
 */
export function validateOperationActiveToggle(
  existing: readonly Operation[],
  operation: Operation,
): OperationValidation {
  if (operation.active !== false) return { valid: true, issues: [] };
  const others = existing.filter((e) => !operation.id || e.id !== operation.id);
  const issues = legacyStageMappingIssues(others, { legacyStageKey: operation.legacyStageKey ?? null, active: true });
  return { valid: issues.length === 0, issues };
}

/**
 * Reads a stored operation tolerantly. Inactive operations are returned as-is -
 * retiring an operation never hides it. Nothing is written back.
 */
export function readOperation(raw: Record<string, unknown> & { id?: string }): Operation {
  const payload = operationPayloadForSave(raw as Partial<Operation> & Record<string, unknown>);
  return {
    ...(raw.id ? { id: String(raw.id) } : {}),
    ...payload,
    legacyStageKey: isLegacyStageKey(payload.legacyStageKey) ? payload.legacyStageKey : null,
    allowedEquipmentCategoryIds: payload.allowedEquipmentCategoryIds,
    active: raw.active !== false,
    ...(Array.isArray(raw.externalRefs) ? { externalRefs: raw.externalRefs as Operation['externalRefs'] } : {}),
    ...(typeof raw.createdAt === 'string' ? { createdAt: raw.createdAt } : {}),
    ...(typeof raw.updatedAt === 'string' ? { updatedAt: raw.updatedAt } : {}),
  };
}

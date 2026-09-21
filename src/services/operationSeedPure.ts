/**
 * Approved Operation Master seed - the list, the plan and the execution loop.
 * Pure and Firebase-free.
 *
 * THE LIST is exactly the 13 operations the factory approved - codes, names,
 * legacy stages, default orders and equipment categories as given. It is data,
 * not behaviour: after seeding, operations are maintained in Master Data ->
 * Operations like any other setup record.
 *
 * THE PLAN compares the list with what is already stored and decides, per
 * approved operation, one of:
 *   CREATE                 no operation with this code exists
 *   EXISTS                 same code, same approved values - left as it is
 *   CODE_CONFLICT          same code, different approved values - never overwritten
 *   LEGACY_STAGE_CONFLICT  another ACTIVE operation already holds its legacy stage
 *   INVALID                fails the Operation Master rules for another reason
 * Only CREATE ever writes. Nothing is updated or deleted, so running the seed
 * again after it succeeded yields 13 x EXISTS and writes nothing - idempotent.
 *
 * WHAT IS COMPARED for EXISTS vs CODE_CONFLICT: only the approved fields (Arabic
 * name, English name, legacy stage, default order, equipment categories). A
 * cost centre, description or active flag set later in Master Data is the
 * user's own configuration and does not make a record "different".
 *
 * THE EXECUTION re-plans against a fresh read immediately before writing, then
 * creates the CREATE rows one at a time through the injected create function -
 * in the app, the existing audited createMasterDataItem. Failures are isolated.
 *
 * ROUTING IS NOT HERE. `defaultOrder` is setup/display metadata. A product's
 * route will be its own configuration referencing operation ids; nothing in an
 * Operation stores a product-specific sequence.
 */
import type { Operation, ProductionStageType } from '../types';
import { normalizeCode } from '../utils/searchUtils';
import { operationPayloadForSave, readOperation, validateOperationForSave } from './operationMasterPure';
import { buildHierarchyIndex } from './hierarchyResolverPure';

export type ApprovedOperationSeed = Pick<Operation, 'code' | 'nameAr' | 'nameEn' | 'defaultOrder' | 'allowedEquipmentCategoryIds'> & {
  legacyStageKey: ProductionStageType | null;
};

/** The 13 approved operations, verbatim. */
export const APPROVED_OPERATION_SEED: readonly ApprovedOperationSeed[] = [
  { code: 'OP-PRESS', nameAr: 'التشكيل والكبس', nameEn: 'Pressing', legacyStageKey: 'pressing', defaultOrder: 1, allowedEquipmentCategoryIds: ['presses', 'furnaces'] },
  { code: 'OP-KILN', nameAr: 'الفرن الدوار', nameEn: 'Rotary Kiln', legacyStageKey: 'rotary_furnace', defaultOrder: 2, allowedEquipmentCategoryIds: [] },
  { code: 'OP-CMILL', nameAr: 'الطحن بالطواحين الصينية', nameEn: 'Chinese Milling', legacyStageKey: 'chinese_mills', defaultOrder: 3, allowedEquipmentCategoryIds: [] },
  { code: 'OP-TBM', nameAr: 'الطحن بطواحين الأنابيب والكرات', nameEn: 'Tube & Ball Milling', legacyStageKey: 'tube_ball_mills', defaultOrder: 4, allowedEquipmentCategoryIds: [] },
  { code: 'OP-MIX', nameAr: 'الخلط والتجهيز', nameEn: 'Mixing', legacyStageKey: 'mixing', defaultOrder: 5, allowedEquipmentCategoryIds: [] },
  { code: 'OP-MORTAR', nameAr: 'إنتاج المونة', nameEn: 'Mortar Production', legacyStageKey: 'mortar_concrete', defaultOrder: 6, allowedEquipmentCategoryIds: [] },
  { code: 'OP-TCONC', nameAr: 'إنتاج الخرسانة الحرارية', nameEn: 'Thermal Concrete Production', legacyStageKey: null, defaultOrder: 7, allowedEquipmentCategoryIds: [] },
  { code: 'OP-TUNNEL-KILN', nameAr: 'حريق الفرن النفقي', nameEn: 'Tunnel Kiln', legacyStageKey: null, defaultOrder: 8, allowedEquipmentCategoryIds: [] },
  { code: 'OP-SORT', nameAr: 'الفرز', nameEn: 'Sorting', legacyStageKey: 'sorting', defaultOrder: 9, allowedEquipmentCategoryIds: [] },
  { code: 'OP-PACK', nameAr: 'التعبئة والتغليف', nameEn: 'Packing & Packaging', legacyStageKey: null, defaultOrder: 10, allowedEquipmentCategoryIds: [] },
  { code: 'OP-HAND', nameAr: 'تصنيع الطوب اليدوي', nameEn: 'Hand-made Brick Production', legacyStageKey: null, defaultOrder: 11, allowedEquipmentCategoryIds: [] },
  { code: 'OP-FOAM', nameAr: 'إنتاج الطوب الفوم', nameEn: 'Foam Brick Production', legacyStageKey: 'lightweight_foam', defaultOrder: 12, allowedEquipmentCategoryIds: [] },
  { code: 'OP-EXTRUDER', nameAr: 'البثق', nameEn: 'Extrusion', legacyStageKey: null, defaultOrder: 13, allowedEquipmentCategoryIds: [] },
];

export type OperationSeedOutcome = 'CREATE' | 'EXISTS' | 'CODE_CONFLICT' | 'LEGACY_STAGE_CONFLICT' | 'INVALID';

export interface OperationSeedPlanRow {
  seed: ApprovedOperationSeed;
  outcome: OperationSeedOutcome;
  /** The stored operation involved, for EXISTS / CODE_CONFLICT / LEGACY_STAGE_CONFLICT. */
  existingId?: string;
  existingCode?: string;
  /** Approved fields whose stored value differs (CODE_CONFLICT only). */
  differingFields?: string[];
  /** The stored operation with this code is inactive (EXISTS only). */
  existingInactive?: boolean;
  messageAr: string;
  messageEn: string;
}

export interface OperationSeedPlan {
  rows: OperationSeedPlanRow[];
  toCreate: ApprovedOperationSeed[];
  summary: Record<OperationSeedOutcome, number>;
}

const APPROVED_FIELDS = ['nameAr', 'nameEn', 'legacyStageKey', 'defaultOrder', 'allowedEquipmentCategoryIds'] as const;

function comparable(op: Pick<Operation, (typeof APPROVED_FIELDS)[number]>): Record<string, string> {
  const payload = operationPayloadForSave({ code: 'x', ...op } as Partial<Operation> & Record<string, unknown>);
  return {
    nameAr: payload.nameAr,
    nameEn: payload.nameEn ?? '',
    legacyStageKey: payload.legacyStageKey ?? '',
    defaultOrder: payload.defaultOrder == null ? '' : String(payload.defaultOrder),
    allowedEquipmentCategoryIds: [...(payload.allowedEquipmentCategoryIds ?? [])].sort().join(','),
  };
}

/**
 * Plans the seed against the stored operations. Read-only.
 *
 * `stored` is every document currently in the collection, raw; each is read
 * through readOperation so malformed legacy documents cannot break the plan.
 */
export function planOperationSeed(
  stored: ReadonlyArray<Record<string, unknown> & { id?: string }>,
  seed: readonly ApprovedOperationSeed[] = APPROVED_OPERATION_SEED,
): OperationSeedPlan {
  const existing = stored.map(readOperation);
  const planned: Operation[] = [];
  const rows: OperationSeedPlanRow[] = [];
  const emptyHierarchy = buildHierarchyIndex([]);

  for (const s of seed) {
    const sameCode = existing.find((e) => normalizeCode(e.code) === normalizeCode(s.code));
    if (sameCode) {
      const a = comparable(sameCode);
      const b = comparable(s);
      const differingFields = APPROVED_FIELDS.filter((f) => a[f] !== b[f]);
      if (differingFields.length === 0) {
        rows.push({
          seed: s,
          outcome: 'EXISTS',
          existingId: sameCode.id,
          existingCode: sameCode.code,
          ...(sameCode.active === false ? { existingInactive: true } : {}),
          messageAr: 'موجودة بنفس القيم المعتمدة - لن تُعدَّل.',
          messageEn: 'Already exists with the approved values - left unchanged.',
        });
      } else {
        rows.push({
          seed: s,
          outcome: 'CODE_CONFLICT',
          existingId: sameCode.id,
          existingCode: sameCode.code,
          differingFields: [...differingFields],
          messageAr: `الكود موجود بقيم مختلفة (${differingFields.join('، ')}) - لن يُكتب فوقه.`,
          messageEn: `Code exists with different values (${differingFields.join(', ')}) - not overwritten.`,
        });
      }
      continue;
    }

    const draft = { ...s, active: true } as Partial<Operation> & Record<string, unknown>;
    const check = validateOperationForSave([...existing, ...planned], draft, { hierarchyIndex: emptyHierarchy });
    const legacyIssue = check.issues.find((i) => i.field === 'legacyStageKey');
    if (legacyIssue) {
      const holder = [...existing, ...planned].find((e) => e.active !== false && e.legacyStageKey === s.legacyStageKey);
      rows.push({
        seed: s,
        outcome: 'LEGACY_STAGE_CONFLICT',
        existingId: holder?.id,
        existingCode: holder?.code,
        messageAr: legacyIssue.messageAr,
        messageEn: legacyIssue.messageEn,
      });
      continue;
    }
    if (!check.valid) {
      rows.push({
        seed: s,
        outcome: 'INVALID',
        messageAr: check.issues.map((i) => i.messageAr).join(' | '),
        messageEn: check.issues.map((i) => i.messageEn).join(' | '),
      });
      continue;
    }

    planned.push({ ...operationPayloadForSave(draft) });
    rows.push({ seed: s, outcome: 'CREATE', messageAr: 'سيتم إنشاؤها.', messageEn: 'Will be created.' });
  }

  const summary: Record<OperationSeedOutcome, number> = { CREATE: 0, EXISTS: 0, CODE_CONFLICT: 0, LEGACY_STAGE_CONFLICT: 0, INVALID: 0 };
  for (const r of rows) summary[r.outcome] += 1;
  return { rows, toCreate: rows.filter((r) => r.outcome === 'CREATE').map((r) => r.seed), summary };
}

export interface OperationSeedExecution {
  plan: OperationSeedPlan;
  createdCodes: string[];
  failed: Array<{ code: string; error: string }>;
}

/**
 * Executes the seed: reads the collection fresh, re-plans, and creates ONLY the
 * CREATE rows, one at a time. A failure on one row does not stop the others and
 * nothing is rolled back. Never updates or deletes.
 */
export async function executeOperationSeed(deps: {
  readStored: () => Promise<ReadonlyArray<Record<string, unknown> & { id?: string }>>;
  create: (payload: ReturnType<typeof operationPayloadForSave>) => Promise<unknown>;
  seed?: readonly ApprovedOperationSeed[];
}): Promise<OperationSeedExecution> {
  const plan = planOperationSeed(await deps.readStored(), deps.seed ?? APPROVED_OPERATION_SEED);
  const createdCodes: string[] = [];
  const failed: OperationSeedExecution['failed'] = [];
  for (const s of plan.toCreate) {
    try {
      await deps.create(operationPayloadForSave({ ...s, active: true } as Partial<Operation> & Record<string, unknown>));
      createdCodes.push(s.code);
    } catch (error: any) {
      failed.push({ code: s.code, error: String(error?.message ?? error) });
    }
  }
  return { plan, createdCodes, failed };
}

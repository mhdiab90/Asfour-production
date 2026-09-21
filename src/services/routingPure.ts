/**
 * Setup-driven Routing - Phase 1 Step 3. Pure and Firebase-free.
 *
 * WHAT A ROUTING IS: which operations ONE logical item goes through, in what
 * order. It is configuration data entered by users - there is no route anywhere
 * in code, and nothing here knows a product, a stage or a recipe by name.
 *
 * SEPARATE CONCEPTS, REFERENCED - NEVER COPIED.
 *   Operation   `operationId` points at the Operation Master (stages collection).
 *               Its name, legacy stage and default cost centre stay there, so a
 *               renamed operation still shows correctly on every route. A route
 *               never stores a ProductionStageType.
 *   Cost centre an optional per-step `hierarchyNodeId` OVERRIDES the operation's
 *               default. It must be an existing node of costCenterHierarchy,
 *               checked with the shared hierarchy resolver; nothing is created.
 *   Equipment   an optional category from the existing equipment category list
 *               (OPERATION_EQUIPMENT_CATEGORY_IDS), which must be one the
 *               operation allows when it restricts them, and an optional specific
 *               record that must belong to that category.
 *   BOM         unrelated: a routing owns no BOM and a BOM owns no routing.
 *
 * TWO COLLECTIONS.
 *   routings         header: business `code` (unique among routings), `name`,
 *                    `logicalItemId` (Step 2A identity - a routing is refused for
 *                    an item that has none; identities are never created here),
 *                    optional customer (none = the standard routing), isDefault,
 *                    notes, active. Managed in the shared Master Data tab engine.
 *   routingVersions  one document per revision with its bounded `steps` array.
 *
 * VERSIONS follow the shared lifecycle (versionedSetupPure.ts): DRAFT -> ACTIVE
 * -> RETIRED, only drafts edited, one ACTIVE per routing, nothing deleted,
 * nothing retired automatically. To change an active route, copy it to a draft.
 *
 * STEPS. `sequence` is the order and is unique within a version (renumbered
 * 1..n). The SAME operation may appear more than once - a route may revisit an
 * operation - so operationId is deliberately not unique. `required` is plain
 * metadata for future production logic; there is no branching or execution.
 *
 * DEFAULTS. At most one ACTIVE default routing per (logical item, customer);
 * a second one is refused naming the existing routing's code and name.
 */
import type { Operation } from '../types';
import { OPERATION_EQUIPMENT_CATEGORY_IDS } from './operationMasterPure';
import { validateEquipmentLink } from './hierarchyResolverPure';
import type { HierarchyIndex } from './hierarchyResolverPure';
import type { LogicalItemRecord } from './logicalItemPure';
import {
  SETUP_VERSION_STATUSES,
  effectiveDateIssues,
  findOtherActiveVersion,
  isVersionEditable,
  lineIdentityIssues,
  moveLine,
  nextLineId,
  normaliseSequences,
  otherActiveVersionIssue,
  versionTransitionIssue,
} from './versionedSetupPure';

export { isVersionEditable, nextLineId, normaliseSequences };
export const moveRoutingStep = moveLine;

/** Firestore collection of routing versions (the headers are MASTER_DATA_COLLECTIONS.routings). */
export const ROUTING_VERSION_COLLECTION = 'routingVersions';

export const ROUTING_VERSION_STATUSES = SETUP_VERSION_STATUSES;

export interface RoutingIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface RoutingValidation {
  valid: boolean;
  issues: RoutingIssue[];
}

type Stored = Record<string, unknown> & { id?: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function optionalId(value: unknown): string | null {
  const t = text(value);
  return t === '' ? null : t;
}

/** Same normalisation as the existing Master Data codes: trimmed, upper case, no spaces. */
function codeKey(value: unknown): string {
  return text(value).toUpperCase().replace(/\s+/g, '');
}

// --- Routing header -------------------------------------------------------------------

export function routingPayloadForSave(input: Record<string, unknown>) {
  return {
    code: text(input.code),
    name: text(input.name),
    logicalItemId: text(input.logicalItemId),
    customerId: optionalId(input.customerId),
    isDefault: input.isDefault === true,
    notes: text(input.notes),
    active: input.active !== false,
  };
}

/** The default scope of a routing: its logical item plus its customer ('' = standard). */
export function routingDefaultScopeKey(routing: Record<string, unknown>): string {
  const r = routingPayloadForSave(routing);
  return JSON.stringify([r.logicalItemId, r.customerId ?? '']);
}

export interface RoutingContext {
  editingId?: string | null;
  /** Logical items as read; null = not loaded, in which case no new logical item can be accepted. */
  logicalItems?: readonly LogicalItemRecord[] | null;
  knownCustomerIds?: ReadonlySet<string> | null;
}

/**
 * Validates a routing header before the shared write.
 *
 *   code           required; unique among routings (retired included; an edit keeping its code is not blocked)
 *   name           required
 *   logicalItemId  required; must be an ACTIVE logical item (an edit keeping its item is not re-checked)
 *   customerId     optional; must be a loaded customer when set
 *   isDefault      an ACTIVE default must be the only active default in its scope
 */
export function validateRoutingForSave(existing: readonly Stored[], draft: Record<string, unknown>, context: RoutingContext = {}): RoutingValidation {
  const issues: RoutingIssue[] = [];
  const r = routingPayloadForSave(draft);
  const editingId = context.editingId ?? null;
  const self = editingId ? existing.find((e) => String(e.id ?? '') === editingId) : undefined;
  const others = existing.filter((e) => String(e.id ?? '') !== String(editingId ?? ''));

  if (!r.code) {
    issues.push({ field: 'code', messageAr: 'كود المسار إلزامي.', messageEn: 'The routing code is required.' });
  } else if (!(self && codeKey(self.code) === codeKey(r.code)) && others.some((e) => codeKey(e.code) === codeKey(r.code))) {
    issues.push({ field: 'code', messageAr: `كود المسار "${r.code}" مسجل بالفعل.`, messageEn: `Routing code "${r.code}" already exists.` });
  }
  if (!r.name) issues.push({ field: 'name', messageAr: 'اسم المسار إلزامي.', messageEn: 'The routing name is required.' });

  if (!r.logicalItemId) {
    issues.push({ field: 'logicalItemId', messageAr: 'يجب اختيار الصنف المنطقي. الصنف بدون هوية منطقية يُسجَّل أولًا من مراجعة تداخل المنتجات والخامات.', messageEn: 'Select the logical item. An item without a logical identity must first be registered in the Products & Materials Overlap Review.' });
  } else if (!(self && text(self.logicalItemId) === r.logicalItemId)) {
    const item = (context.logicalItems ?? []).find((i) => i.id === r.logicalItemId);
    if (!item || item.status !== 'ACTIVE') {
      issues.push({ field: 'logicalItemId', messageAr: 'الصنف المنطقي غير موجود أو غير نشط - لا يتم إنشاء هوية تلقائيًا.', messageEn: 'The logical item does not exist or is inactive - no identity is created automatically.' });
    }
  }

  if (r.customerId && context.knownCustomerIds && !context.knownCustomerIds.has(r.customerId)) {
    issues.push({ field: 'customerId', messageAr: 'العميل المحدد غير موجود.', messageEn: 'The selected customer does not exist.' });
  }

  if (r.isDefault && r.active) {
    const scope = routingDefaultScopeKey(r);
    const holder = others.find((e) => e.active !== false && e.isDefault === true && routingDefaultScopeKey(e) === scope);
    if (holder) {
      issues.push({
        field: 'isDefault',
        messageAr: `يوجد بالفعل مسار افتراضي نشط لنفس الصنف المنطقي ونفس العميل: "${text(holder.code)}" - ${text(holder.name)}. ألغِ الافتراضي هناك أولًا.`,
        messageEn: `An active default routing already exists for the same logical item and customer: "${text(holder.code)}" - ${text(holder.name)}. Clear that default first.`,
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

// --- Steps and versions --------------------------------------------------------------------

export interface RoutingStepValue {
  lineId: string;
  sequence: number;
  operationId: string;
  hierarchyNodeId: string | null;
  equipmentCategoryId: string | null;
  equipmentId: string | null;
  required: boolean;
  notes: string;
}

export function routingStepPayload(input: Record<string, unknown>): RoutingStepValue {
  const seq = input.sequence;
  return {
    lineId: text(input.lineId),
    sequence: typeof seq === 'number' ? seq : Number(text(seq)),
    operationId: text(input.operationId),
    hierarchyNodeId: optionalId(input.hierarchyNodeId),
    equipmentCategoryId: optionalId(input.equipmentCategoryId),
    equipmentId: optionalId(input.equipmentId),
    required: input.required !== false,
    notes: text(input.notes),
  };
}

export function routingVersionPayloadForSave(input: Record<string, unknown>) {
  const steps = Array.isArray(input.steps) ? (input.steps as Record<string, unknown>[]).map(routingStepPayload) : [];
  return {
    routingId: text(input.routingId),
    versionCode: text(input.versionCode),
    status: text(input.status).toUpperCase() || 'DRAFT',
    effectiveFrom: optionalId(input.effectiveFrom),
    effectiveTo: optionalId(input.effectiveTo),
    notes: text(input.notes),
    steps: normaliseSequences(steps),
  };
}

/** A specific equipment record as the step validator sees it. */
export interface RoutingEquipmentRef {
  id: string;
  /** The registry category id it belongs to (e.g. presses, mills, rotaryKilns). */
  categoryId: string;
  active: boolean;
}

export interface RoutingVersionContext {
  editingId?: string | null;
  /** The Operation Master records; null = not loaded, so operations cannot be confirmed. */
  operations?: readonly Operation[] | null;
  /** The cost-centre hierarchy index (hierarchyResolverPure.buildHierarchyIndex). */
  hierarchyIndex?: HierarchyIndex<any> | null;
  /** Equipment records of the registered equipment categories; null = not loaded. */
  equipment?: readonly RoutingEquipmentRef[] | null;
  routing?: Record<string, unknown> | null;
}

/**
 * Validates a draft version (header + steps) before the shared write, and a
 * draft about to be activated. Historical ACTIVE / RETIRED versions are never
 * re-validated or rewritten, so their operation references stay as they were.
 */
export function validateRoutingVersionForSave(versionsOfRouting: readonly Stored[], draft: Record<string, unknown>, context: RoutingVersionContext = {}): RoutingValidation {
  const issues: RoutingIssue[] = [];
  const v = routingVersionPayloadForSave(draft);
  const editingId = context.editingId ?? null;
  const siblings = versionsOfRouting.filter((e) => text(e.routingId) === v.routingId && String(e.id ?? '') !== String(editingId ?? ''));

  if (!v.routingId) issues.push({ field: 'routingId', messageAr: 'الإصدار يجب أن يتبع مسارًا.', messageEn: 'A version must belong to a routing.' });
  if (!v.versionCode) {
    issues.push({ field: 'versionCode', messageAr: 'رمز الإصدار إلزامي.', messageEn: 'The version code is required.' });
  } else if (siblings.some((e) => codeKey(e.versionCode) === codeKey(v.versionCode))) {
    issues.push({ field: 'versionCode', messageAr: `الإصدار "${v.versionCode}" موجود بالفعل في هذا المسار.`, messageEn: `Version "${v.versionCode}" already exists in this routing.` });
  }
  if (!(ROUTING_VERSION_STATUSES as readonly string[]).includes(v.status)) {
    issues.push({ field: 'status', messageAr: 'حالة الإصدار غير صالحة.', messageEn: `Invalid version status. Allowed: ${ROUTING_VERSION_STATUSES.join(', ')}.` });
  }
  issues.push(...effectiveDateIssues(v.effectiveFrom, v.effectiveTo));

  const rawSteps = Array.isArray(draft.steps) ? (draft.steps as Record<string, unknown>[]).map(routingStepPayload) : [];
  issues.push(...lineIdentityIssues(rawSteps, 'steps'));

  const operationsById = context.operations ? new Map(context.operations.map((o) => [String(o.id ?? ''), o])) : null;
  const equipmentById = context.equipment ? new Map(context.equipment.map((e) => [`${e.categoryId}::${e.id}`, e])) : null;

  rawSteps.forEach((s, i) => {
    const n = i + 1;
    const step = (ar: string, en: string, field: string) => issues.push({ field: `steps.${field}`, messageAr: `الخطوة ${n}: ${ar}`, messageEn: `Step ${n}: ${en}` });

    let operation: Operation | undefined;
    if (!s.operationId) {
      step('يجب اختيار العملية.', 'select the operation.', 'operationId');
    } else if (s.operationId === v.routingId || (editingId && s.operationId === editingId)) {
      step('المسار أو إصداره لا يمكن أن يكون عملية.', 'a routing or its version cannot be used as an operation.', 'operationId');
    } else if (!operationsById) {
      step('تعذر التحقق من العملية - قائمة العمليات غير محملة.', 'the operation cannot be verified - operations are not loaded.', 'operationId');
    } else {
      operation = operationsById.get(s.operationId);
      if (!operation) step('العملية غير موجودة في العمليات الإنتاجية.', 'the operation does not exist in the Operation Master.', 'operationId');
      else if (operation.active === false) step('العملية معطلة - اختر عملية نشطة (لا يتم استبدالها تلقائيًا).', 'the operation is inactive - choose an active one (it is never substituted automatically).', 'operationId');
    }

    if (s.hierarchyNodeId) {
      const index = context.hierarchyIndex;
      if (!index) {
        step('تعذر التحقق من مركز التكلفة - التسلسل الهرمي غير محمل.', 'the cost centre cannot be verified - the hierarchy is not loaded.', 'hierarchyNodeId');
      } else {
        const link = validateEquipmentLink(index, s.hierarchyNodeId);
        if (!link.valid) step(link.issues[0].messageAr, link.issues[0].messageEn, 'hierarchyNodeId');
        else if (!index.byId.has(s.hierarchyNodeId)) step('يجب اختيار عقدة التسلسل الهرمي بمعرّفها.', 'the cost centre must be stored as its hierarchy node id.', 'hierarchyNodeId');
      }
    }

    if (s.equipmentCategoryId) {
      if (!OPERATION_EQUIPMENT_CATEGORY_IDS.includes(s.equipmentCategoryId)) {
        step('فئة المعدات غير معروفة.', 'unknown equipment category.', 'equipmentCategoryId');
      } else if (operation && (operation.allowedEquipmentCategoryIds ?? []).length > 0 && !(operation.allowedEquipmentCategoryIds ?? []).includes(s.equipmentCategoryId)) {
        step('فئة المعدات غير مسموحة لهذه العملية.', 'this equipment category is not allowed for the operation.', 'equipmentCategoryId');
      }
    }

    if (s.equipmentId) {
      if (!s.equipmentCategoryId) {
        step('اختر فئة المعدات قبل اختيار معدة محددة.', 'choose the equipment category before a specific machine.', 'equipmentId');
      } else if (!equipmentById) {
        step('تعذر التحقق من المعدة - قائمة المعدات غير محملة.', 'the equipment cannot be verified - equipment is not loaded.', 'equipmentId');
      } else {
        const machine = equipmentById.get(`${s.equipmentCategoryId}::${s.equipmentId}`);
        if (!machine) step('المعدة المحددة لا تنتمي إلى فئة المعدات المختارة.', 'the selected equipment does not belong to the selected category.', 'equipmentId');
        else if (!machine.active) step('المعدة المحددة معطلة.', 'the selected equipment is inactive.', 'equipmentId');
      }
    }
  });

  if (v.status === 'ACTIVE' && rawSteps.length === 0) {
    issues.push({ field: 'steps', messageAr: 'لا يمكن تفعيل إصدار بدون خطوات.', messageEn: 'A version cannot be active without steps.' });
  }
  return { valid: issues.length === 0, issues };
}

/**
 * Whether a version may move to `next` - the shared lifecycle, plus: activation
 * needs an active routing, no other ACTIVE version, and full validation.
 */
export function validateRoutingVersionTransition(
  versionsOfRouting: readonly Stored[],
  version: Stored,
  next: string,
  context: RoutingVersionContext = {},
): RoutingValidation {
  const lifecycle = versionTransitionIssue(version.status, next);
  if (lifecycle) return { valid: false, issues: [lifecycle] };
  const issues: RoutingIssue[] = [];
  if (text(next).toUpperCase() === 'ACTIVE') {
    if (context.routing && context.routing.active === false) {
      issues.push({ field: 'status', messageAr: 'المسار معطل - فعّله قبل تفعيل إصدار.', messageEn: 'The routing is inactive - activate it before activating a version.' });
    }
    const otherActive = findOtherActiveVersion(versionsOfRouting, 'routingId', version);
    if (otherActive) issues.push(otherActiveVersionIssue(otherActive.versionCode));
    issues.push(...validateRoutingVersionForSave(versionsOfRouting, { ...version, status: 'ACTIVE' }, { ...context, editingId: String(version.id ?? '') || null }).issues);
  }
  return { valid: issues.length === 0, issues };
}

/** A new DRAFT copying another version's steps - the only way to change an active route. */
export function draftFromRoutingVersion(source: Record<string, unknown>, versionCode: string) {
  const base = routingVersionPayloadForSave(source);
  return { ...base, versionCode: text(versionCode), status: 'DRAFT', effectiveFrom: null, effectiveTo: null };
}

// --- Audit descriptions --------------------------------------------------------------------------

export function describeRoutingChange(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): string {
  const a = routingPayloadForSave(after);
  if (!before) {
    return `[ROUTING_CREATED] ${a.code} - ${a.name} - logical item ${a.logicalItemId} - ${a.customerId ? `customer ${a.customerId}` : 'standard (no customer)'}${a.isDefault ? ' - default' : ''}`;
  }
  const b = routingPayloadForSave(before);
  const changes: string[] = [];
  if (b.code !== a.code) changes.push(`code ${b.code} -> ${a.code}`);
  if (b.name !== a.name) changes.push(`name ${b.name} -> ${a.name}`);
  if (b.logicalItemId !== a.logicalItemId) changes.push(`logical item ${b.logicalItemId} -> ${a.logicalItemId}`);
  if (b.customerId !== a.customerId) changes.push(`customer scope ${b.customerId ?? 'standard'} -> ${a.customerId ?? 'standard'}`);
  if (b.isDefault !== a.isDefault) changes.push(`default ${b.isDefault} -> ${a.isDefault}`);
  if (b.active !== a.active) changes.push(`active ${b.active} -> ${a.active}`);
  if (b.notes !== a.notes) changes.push('notes changed');
  return `[ROUTING_UPDATED] ${a.code}: ${changes.length ? changes.join('; ') : 'no field changes'}`;
}

/** Steps added, removed, reordered, and operation / cost centre / equipment / required changes. */
export function describeRoutingVersionChange(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>, copiedFrom?: string | null): string {
  const a = routingVersionPayloadForSave(after);
  if (!before) {
    return `[ROUTING_VERSION_${copiedFrom ? 'COPIED' : 'CREATED'}] routing ${a.routingId} version ${a.versionCode} (${a.status})${copiedFrom ? ` from version ${copiedFrom}` : ''} - ${a.steps.length} step(s)`;
  }
  const b = routingVersionPayloadForSave(before);
  const changes: string[] = [];
  if (b.status !== a.status) changes.push(`status ${b.status} -> ${a.status}`);
  if (b.versionCode !== a.versionCode) changes.push(`version ${b.versionCode} -> ${a.versionCode}`);
  for (const f of ['effectiveFrom', 'effectiveTo'] as const) {
    if (b[f] !== a[f]) changes.push(`${f} ${b[f] ?? '-'} -> ${a[f] ?? '-'}`);
  }
  if (b.notes !== a.notes) changes.push('notes changed');
  const beforeSteps = new Map(b.steps.map((s) => [s.lineId, s]));
  const afterSteps = new Map(a.steps.map((s) => [s.lineId, s]));
  const added = a.steps.filter((s) => !beforeSteps.has(s.lineId)).map((s) => `${s.lineId} operation ${s.operationId}`);
  const removed = b.steps.filter((s) => !afterSteps.has(s.lineId)).map((s) => `${s.lineId} operation ${s.operationId}`);
  const detail: string[] = [];
  let reordered = false;
  for (const s of a.steps) {
    const o = beforeSteps.get(s.lineId);
    if (!o) continue;
    if (o.sequence !== s.sequence) reordered = true;
    if (o.operationId !== s.operationId) detail.push(`${s.lineId} operation ${o.operationId} -> ${s.operationId}`);
    if (o.hierarchyNodeId !== s.hierarchyNodeId) detail.push(`${s.lineId} cost centre override ${o.hierarchyNodeId ?? '-'} -> ${s.hierarchyNodeId ?? '-'}`);
    if (o.equipmentCategoryId !== s.equipmentCategoryId || o.equipmentId !== s.equipmentId) {
      detail.push(`${s.lineId} equipment ${o.equipmentCategoryId ?? '-'}/${o.equipmentId ?? '-'} -> ${s.equipmentCategoryId ?? '-'}/${s.equipmentId ?? '-'}`);
    }
    if (o.required !== s.required) detail.push(`${s.lineId} required ${o.required} -> ${s.required}`);
    if (o.notes !== s.notes) detail.push(`${s.lineId} notes changed`);
  }
  if (added.length) changes.push(`steps added: ${added.join(', ')}`);
  if (removed.length) changes.push(`steps removed: ${removed.join(', ')}`);
  if (reordered) changes.push(`steps reordered: ${a.steps.map((s) => s.lineId).join(' > ')}`);
  if (detail.length) changes.push(`steps changed: ${detail.join(', ')}`);
  const tag = b.status !== a.status ? (a.status === 'ACTIVE' ? '[ROUTING_VERSION_ACTIVATED]' : a.status === 'RETIRED' ? '[ROUTING_VERSION_RETIRED]' : '[ROUTING_VERSION_UPDATED]') : '[ROUTING_VERSION_UPDATED]';
  return `${tag} routing ${a.routingId} version ${a.versionCode}: ${changes.length ? changes.join('; ') : 'no field changes'}`;
}

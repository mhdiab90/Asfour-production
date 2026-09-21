/**
 * Job execution setup - Phase 1 Step 4. Pure and Firebase-free.
 *
 * A Job Reference (Step 1E) may now say WHAT is being produced and WITH WHICH
 * setup, as four optional references stored on the job itself:
 *
 *   logicalItemId     the item being produced (Step 2A identity) - authoritative;
 *                     the older optional productId stays, but must agree with it
 *   bomVersionId      the intended Bill of Materials version (Step 2)
 *   routingVersionId  the intended Routing version (Step 3)
 *   batchId           the associated batch / lot (Step 1E)
 *
 * CONFIGURATION ONLY. Nothing here executes a route, consumes a BOM, creates a
 * batch, BOM, routing or logical item, or touches production. The job stores
 * version IDS - never copied components or steps - so a later RETIRED version
 * stays referenced exactly as selected; nothing is swapped automatically.
 *
 * WHAT A SELECTION MUST SATISFY (checked when it is new or changed, or when the
 * job's logical item or customer changes; an untouched stored reference is
 * preserved even if its version was retired since):
 *   logical item   exists and is ACTIVE
 *   BOM version    exists, is ACTIVE, its BOM is active, the BOM's item resolves
 *                  (through the shared logical-item resolver) to the job's
 *                  logical item, and the BOM's customer scope EXACTLY matches the
 *                  job's customer (no customer = standard only; customer X =
 *                  customer X only - no implicit fallback, a decided rule)
 *   routing ver.   the same, against the routing header's logicalItemId
 *   batch          exists, is active, if bound to a product that product resolves
 *                  to the job's logical item, and if bound to a job it is this job
 *   BOM + routing  resolve to the same logical item
 *
 * DEFAULTS. "Use Default" resolves the one active default BOM / routing in the
 * job's exact scope to its ACTIVE version and stores that version's id - never a
 * "uses default" flag.
 *
 * LOCKING. COMPLETED and CANCELLED jobs refuse any change to these references;
 * DRAFT and ACTIVE jobs may change them (the existing job model has no other
 * lock). Any refusal means no write.
 */
import { resolveLogicalItemId } from './logicalItemPure';
import type { LogicalItemRecord } from './logicalItemPure';

export const JOB_CONFIGURATION_FIELDS = ['logicalItemId', 'bomVersionId', 'routingVersionId', 'batchId'] as const;
export type JobConfigurationField = (typeof JOB_CONFIGURATION_FIELDS)[number];

/** Job statuses whose configuration can no longer change. */
export const LOCKED_JOB_STATUSES = ['COMPLETED', 'CANCELLED'] as const;

type Stored = Record<string, unknown> & { id?: string };

export interface JobConfigurationIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface JobConfigurationValidation {
  valid: boolean;
  issues: JobConfigurationIssue[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function optionalId(value: unknown): string | null {
  const t = text(value);
  return t === '' ? null : t;
}

/** The four references of a job, normalised (empty = null). */
export function jobConfigurationOf(input: Record<string, unknown> | null | undefined): Record<JobConfigurationField, string | null> {
  const src = input ?? {};
  return {
    logicalItemId: optionalId(src.logicalItemId),
    bomVersionId: optionalId(src.bomVersionId),
    routingVersionId: optionalId(src.routingVersionId),
    batchId: optionalId(src.batchId),
  };
}

/**
 * The configuration fields to include in the job's single update. A field is
 * written when it has a value or when the stored job had one (so clearing is
 * recorded); a job that never had configuration gains no empty fields.
 */
export function jobConfigurationPatch(before: Record<string, unknown> | null | undefined, draft: Record<string, unknown>): Partial<Record<JobConfigurationField, string | null>> {
  const next = jobConfigurationOf(draft);
  const prev = jobConfigurationOf(before);
  const patch: Partial<Record<JobConfigurationField, string | null>> = {};
  for (const f of JOB_CONFIGURATION_FIELDS) {
    if (next[f] !== null || prev[f] !== null) patch[f] = next[f];
  }
  return patch;
}

export interface JobConfigurationContext {
  editingId?: string | null;
  /** Each list as read; null = not loaded, so a selection that needs it cannot be accepted. */
  logicalItems?: readonly LogicalItemRecord[] | null;
  boms?: readonly Stored[] | null;
  bomVersions?: readonly Stored[] | null;
  routings?: readonly Stored[] | null;
  routingVersions?: readonly Stored[] | null;
  batches?: readonly Stored[] | null;
}

const byId = (list: readonly Stored[] | null | undefined, id: string) => (list ?? []).find((x) => String(x.id ?? '') === id);
const sameCustomer = (a: unknown, b: unknown) => (optionalId(a) ?? '') === (optionalId(b) ?? '');

/** The logical identity a BOM header makes, through the shared resolver. */
export function bomLogicalItemKey(bom: Stored, logicalItems: readonly LogicalItemRecord[]): string {
  return resolveLogicalItemId(logicalItems, text(bom.itemSource), text(bom.itemId));
}

/** ACTIVE versions of active BOMs for the job's exact logical item and customer scope - the BOM selector list. */
export function compatibleBomVersions(
  job: { logicalItemId: unknown; customerId?: unknown },
  boms: readonly Stored[],
  bomVersions: readonly Stored[],
  logicalItems: readonly LogicalItemRecord[],
): Array<{ bom: Stored; version: Stored }> {
  const target = `logicalItem:${text(job.logicalItemId)}`;
  if (!text(job.logicalItemId)) return [];
  return bomVersions
    .filter((v) => text(v.status).toUpperCase() === 'ACTIVE')
    .map((v) => ({ version: v, bom: byId(boms, text(v.bomId)) }))
    .filter((x): x is { bom: Stored; version: Stored } => Boolean(x.bom))
    .filter(({ bom }) => bom.active !== false && sameCustomer(bom.customerId, job.customerId) && bomLogicalItemKey(bom, logicalItems) === target);
}

/** ACTIVE versions of active routings for the job's exact logical item and customer scope - the routing selector list. */
export function compatibleRoutingVersions(
  job: { logicalItemId: unknown; customerId?: unknown },
  routings: readonly Stored[],
  routingVersions: readonly Stored[],
): Array<{ routing: Stored; version: Stored }> {
  if (!text(job.logicalItemId)) return [];
  return routingVersions
    .filter((v) => text(v.status).toUpperCase() === 'ACTIVE')
    .map((v) => ({ version: v, routing: byId(routings, text(v.routingId)) }))
    .filter((x): x is { routing: Stored; version: Stored } => Boolean(x.routing))
    .filter(({ routing }) => routing.active !== false && sameCustomer(routing.customerId, job.customerId) && text(routing.logicalItemId) === text(job.logicalItemId));
}

/** Why a batch cannot serve this job, or null when it can. Shared with production references (Step 5A). */
export function batchIncompatibility(batch: Stored, job: { logicalItemId: unknown }, logicalItems: readonly LogicalItemRecord[], editingId: string | null): { ar: string; en: string } | null {
  if (batch.active === false) return { ar: 'الدفعة معطلة.', en: 'the batch is inactive.' };
  const productId = text(batch.productId);
  if (productId && resolveLogicalItemId(logicalItems, 'products', productId) !== `logicalItem:${text(job.logicalItemId)}`) {
    return { ar: 'الدفعة مرتبطة بمنتج لا يتبع الصنف المنطقي لأمر الشغل.', en: "the batch belongs to a product that is not the job's logical item." };
  }
  const jobRef = text(batch.jobReferenceId);
  if (jobRef && jobRef !== text(editingId)) {
    return { ar: 'الدفعة مرتبطة بأمر شغل آخر.', en: 'the batch is bound to another job reference.' };
  }
  return null;
}

/** Active batches this job may reference - the batch selector list. */
export function compatibleBatches(
  job: { logicalItemId: unknown },
  batches: readonly Stored[],
  logicalItems: readonly LogicalItemRecord[],
  editingId: string | null,
): Stored[] {
  if (!text(job.logicalItemId)) return [];
  return batches.filter((b) => batchIncompatibility(b, job, logicalItems, editingId) === null);
}

export interface DefaultResolution {
  versionId: string | null;
  headerId?: string;
  messageAr: string;
  messageEn: string;
}

/** The active default BOM in the job's exact scope, resolved to its ACTIVE version id. */
export function resolveDefaultBomVersion(
  job: { logicalItemId: unknown; customerId?: unknown },
  boms: readonly Stored[],
  bomVersions: readonly Stored[],
  logicalItems: readonly LogicalItemRecord[],
): DefaultResolution {
  const target = `logicalItem:${text(job.logicalItemId)}`;
  const defaults = boms.filter((b) => b.active !== false && b.isDefault === true && sameCustomer(b.customerId, job.customerId) && bomLogicalItemKey(b, logicalItems) === target);
  if (!text(job.logicalItemId) || defaults.length === 0) {
    return { versionId: null, messageAr: 'لا توجد قائمة مواد افتراضية نشطة لهذا الصنف المنطقي وهذا العميل.', messageEn: 'There is no active default BOM for this logical item and customer.' };
  }
  const header = defaults[0];
  const active = bomVersions.filter((v) => text(v.bomId) === String(header.id) && text(v.status).toUpperCase() === 'ACTIVE');
  if (active.length !== 1) {
    return { versionId: null, headerId: String(header.id), messageAr: `قائمة المواد الافتراضية "${text(header.code)}" ليس لها إصدار نشط.`, messageEn: `The default BOM "${text(header.code)}" has no active version.` };
  }
  return { versionId: String(active[0].id), headerId: String(header.id), messageAr: '', messageEn: '' };
}

/** The active default routing in the job's exact scope, resolved to its ACTIVE version id. */
export function resolveDefaultRoutingVersion(
  job: { logicalItemId: unknown; customerId?: unknown },
  routings: readonly Stored[],
  routingVersions: readonly Stored[],
): DefaultResolution {
  const defaults = routings.filter((r) => r.active !== false && r.isDefault === true && sameCustomer(r.customerId, job.customerId) && text(r.logicalItemId) === text(job.logicalItemId));
  if (!text(job.logicalItemId) || defaults.length === 0) {
    return { versionId: null, messageAr: 'لا يوجد مسار افتراضي نشط لهذا الصنف المنطقي وهذا العميل.', messageEn: 'There is no active default routing for this logical item and customer.' };
  }
  const header = defaults[0];
  const active = routingVersions.filter((v) => text(v.routingId) === String(header.id) && text(v.status).toUpperCase() === 'ACTIVE');
  if (active.length !== 1) {
    return { versionId: null, headerId: String(header.id), messageAr: `المسار الافتراضي "${text(header.code)}" ليس له إصدار نشط.`, messageEn: `The default routing "${text(header.code)}" has no active version.` };
  }
  return { versionId: String(active[0].id), headerId: String(header.id), messageAr: '', messageEn: '' };
}

/**
 * Validates a job's execution setup before its single write. `before` is the
 * stored job (null for a new one); `draft` is the whole form.
 */
export function validateJobConfiguration(
  before: Stored | null | undefined,
  draft: Record<string, unknown>,
  context: JobConfigurationContext = {},
): JobConfigurationValidation {
  const issues: JobConfigurationIssue[] = [];
  const add = (field: string, ar: string, en: string) => issues.push({ field, messageAr: ar, messageEn: en });
  const next = jobConfigurationOf(draft);
  const prev = jobConfigurationOf(before);
  const changed = (f: JobConfigurationField) => next[f] !== prev[f];
  const anyChanged = JOB_CONFIGURATION_FIELDS.some(changed);
  const identityChanged = changed('logicalItemId') || !sameCustomer(draft.customerId, before?.customerId) || text(draft.productId) !== text(before?.productId);
  const logicalItems = context.logicalItems ?? null;
  const editingId = context.editingId ?? (before?.id ? String(before.id) : null);

  if (before && anyChanged && (LOCKED_JOB_STATUSES as readonly string[]).includes(text(before.status).toUpperCase())) {
    add('status', `أمر الشغل ${text(before.status)} - لا يمكن تغيير إعداد التنفيذ.`, `The job is ${text(before.status)} - its execution setup can no longer change.`);
    return { valid: false, issues };
  }

  if (!next.logicalItemId && (next.bomVersionId || next.routingVersionId || next.batchId)) {
    add('logicalItemId', 'اختر الصنف المنطقي قبل قائمة المواد أو المسار أو الدفعة.', 'Select the logical item before a BOM, routing or batch.');
    return { valid: false, issues };
  }

  // Logical item --------------------------------------------------------------------
  const item = next.logicalItemId && logicalItems ? logicalItems.find((i) => i.id === next.logicalItemId) : undefined;
  if (next.logicalItemId && (changed('logicalItemId') || !before)) {
    if (!logicalItems) add('logicalItemId', 'تعذر التحقق من الصنف المنطقي - القائمة غير محملة.', 'The logical item cannot be verified - logical items are not loaded.');
    else if (!item) add('logicalItemId', 'الصنف المنطقي غير موجود - لا يتم إنشاؤه تلقائيًا.', 'The logical item does not exist - it is never created automatically.');
    else if (item.status !== 'ACTIVE') add('logicalItemId', 'الصنف المنطقي غير نشط.', 'The logical item is inactive.');
  }
  const productId = text(draft.productId);
  if (next.logicalItemId && productId && identityChanged && logicalItems) {
    if (resolveLogicalItemId(logicalItems, 'products', productId) !== `logicalItem:${next.logicalItemId}`) {
      add('productId', 'المنتج المحدد في أمر الشغل لا يتبع الصنف المنطقي المختار.', "The job's product does not belong to the selected logical item.");
    }
  }

  // BOM version -----------------------------------------------------------------------
  let bomKey: string | null = null;
  if (next.bomVersionId && (changed('bomVersionId') || identityChanged)) {
    if (!context.bomVersions || !context.boms || !logicalItems) {
      add('bomVersionId', 'تعذر التحقق من إصدار قائمة المواد - البيانات غير محملة.', 'The BOM version cannot be verified - BOM data is not loaded.');
    } else {
      const version = byId(context.bomVersions, next.bomVersionId);
      const bom = version ? byId(context.boms, text(version.bomId)) : undefined;
      if (!version || !bom) add('bomVersionId', 'إصدار قائمة المواد غير موجود.', 'The BOM version does not exist.');
      else if (text(version.status).toUpperCase() !== 'ACTIVE') add('bomVersionId', `إصدار قائمة المواد "${text(version.versionCode)}" ليس نشطًا (${text(version.status)}).`, `BOM version "${text(version.versionCode)}" is not ACTIVE (${text(version.status)}).`);
      else if (bom.active === false) add('bomVersionId', `قائمة المواد "${text(bom.code)}" معطلة.`, `BOM "${text(bom.code)}" is inactive.`);
      else {
        bomKey = bomLogicalItemKey(bom, logicalItems);
        if (bomKey !== `logicalItem:${next.logicalItemId}`) add('bomVersionId', `قائمة المواد "${text(bom.code)}" تخص صنفًا منطقيًا آخر.`, `BOM "${text(bom.code)}" is for a different logical item.`);
        if (!sameCustomer(bom.customerId, draft.customerId)) add('bomVersionId', `نطاق العميل لقائمة المواد "${text(bom.code)}" لا يطابق عميل أمر الشغل.`, `BOM "${text(bom.code)}" customer scope does not match the job's customer.`);
      }
    }
  }

  // Routing version -------------------------------------------------------------------------
  let routingKey: string | null = null;
  if (next.routingVersionId && (changed('routingVersionId') || identityChanged)) {
    if (!context.routingVersions || !context.routings) {
      add('routingVersionId', 'تعذر التحقق من إصدار المسار - البيانات غير محملة.', 'The routing version cannot be verified - routing data is not loaded.');
    } else {
      const version = byId(context.routingVersions, next.routingVersionId);
      const routing = version ? byId(context.routings, text(version.routingId)) : undefined;
      if (!version || !routing) add('routingVersionId', 'إصدار المسار غير موجود.', 'The routing version does not exist.');
      else if (text(version.status).toUpperCase() !== 'ACTIVE') add('routingVersionId', `إصدار المسار "${text(version.versionCode)}" ليس نشطًا (${text(version.status)}).`, `Routing version "${text(version.versionCode)}" is not ACTIVE (${text(version.status)}).`);
      else if (routing.active === false) add('routingVersionId', `المسار "${text(routing.code)}" معطل.`, `Routing "${text(routing.code)}" is inactive.`);
      else {
        routingKey = `logicalItem:${text(routing.logicalItemId)}`;
        if (text(routing.logicalItemId) !== next.logicalItemId) add('routingVersionId', `المسار "${text(routing.code)}" يخص صنفًا منطقيًا آخر.`, `Routing "${text(routing.code)}" is for a different logical item.`);
        if (!sameCustomer(routing.customerId, draft.customerId)) add('routingVersionId', `نطاق العميل للمسار "${text(routing.code)}" لا يطابق عميل أمر الشغل.`, `Routing "${text(routing.code)}" customer scope does not match the job's customer.`);
      }
    }
  }

  if (bomKey && routingKey && bomKey !== routingKey) {
    add('routingVersionId', 'قائمة المواد والمسار المختاران يخصان صنفين منطقيين مختلفين.', 'The selected BOM and routing belong to different logical items.');
  }

  // Batch ------------------------------------------------------------------------------------
  if (next.batchId && (changed('batchId') || identityChanged)) {
    if (!context.batches || !logicalItems) {
      add('batchId', 'تعذر التحقق من الدفعة - البيانات غير محملة.', 'The batch cannot be verified - batches are not loaded.');
    } else {
      const batch = byId(context.batches, next.batchId);
      if (!batch) add('batchId', 'الدفعة غير موجودة - لا يتم إنشاؤها تلقائيًا.', 'The batch does not exist - it is never created automatically.');
      else {
        const why = batchIncompatibility(batch, { logicalItemId: next.logicalItemId }, logicalItems, editingId);
        if (why) add('batchId', `الدفعة "${text(batch.batchNumber)}": ${why.ar}`, `Batch "${text(batch.batchNumber)}": ${why.en}`);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

/** "Job X configuration changed from ... to ..." for the existing audit log; labels resolve ids to readable codes. */
export function describeJobConfigurationChange(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  label: (field: JobConfigurationField, id: string | null) => string = (_f, id) => id ?? '-',
): string | null {
  const prev = jobConfigurationOf(before);
  const next = jobConfigurationOf(after);
  if (JOB_CONFIGURATION_FIELDS.every((f) => prev[f] === next[f])) return null;
  const show = (c: Record<JobConfigurationField, string | null>) =>
    `logical item ${label('logicalItemId', c.logicalItemId)} / BOM ${label('bomVersionId', c.bomVersionId)} / Routing ${label('routingVersionId', c.routingVersionId)} / Batch ${label('batchId', c.batchId)}`;
  return `[JOB_CONFIGURATION_CHANGED] Job ${text(after.code) || text(before?.code)} configuration changed from ${show(prev)} to ${show(next)}`;
}

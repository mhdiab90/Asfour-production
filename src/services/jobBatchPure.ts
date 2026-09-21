/**
 * ASFOUR Job Reference + Batch - Phase 1 Step 1E. Pure and Firebase-free.
 *
 * TWO IDENTITY OBJECTS, NOT A MANUFACTURING-ORDER ENGINE.
 *
 *   JobReference  collection `jobReferences`. The ASFOUR identity of a job: the
 *                 Firestore document id, plus a business `code` the user enters
 *                 (it may be a number supplied by the customer, by Odoo or by
 *                 anyone else - it is stored as given, never generated). Optional
 *                 product and customer ids, a minimal status, where the job came
 *                 from (`sourceSystem`), notes and the usual active flag.
 *                 There is no routing, quantity, schedule or workflow here.
 *
 *   Batch         collection `batches`. The identity of a production / stock lot:
 *                 document id plus `batchNumber`, optionally tied to a product
 *                 and/or a job reference. A batch is not a production record (that
 *                 is an event) and not a product (a product has many batches).
 *                 The batch number is never part of, or derived from, a product code.
 *
 * STANDALONE OR ODOO-LINKED, SAME MODEL. A job created in ASFOUR has
 * `sourceSystem: 'asfour'`. When Odoo is connected later, an Odoo Job Order is
 * linked through the generic Step 1A `externalRefs` (system 'odoo', model
 * 'mrp.production', externalId ...) beside the ASFOUR id - never as the document
 * id and never as a dedicated odoo* field. Nothing here reads or writes
 * `externalRefs`; it only checks that stored ones stay valid and unclaimed.
 *
 * LEGACY ORDER AND BATCH FIELDS ARE UNTOUCHED. customerOrderNumber,
 * manufacturingOrderNumber, customerRequestNumber and the free-text batchNumber
 * on stage records keep their meaning. They are not assumed to be job references
 * or batches, and nothing is inferred from them.
 *
 * BATCH NUMBER UNIQUENESS - THE CHOSEN SCOPE. The repository has no factory rule
 * that batch numbers are globally unique (the stage records use batchNumber only
 * to tell apart otherwise-identical rows), so none is invented. The one thing
 * refused is a second batch with the same number for the same product AND the
 * same job reference (a missing product or job counts as its own value) - that
 * is the same lot entered twice. The same number under another product or
 * another job is allowed. Numbers are entered by the user: there is no automatic
 * numbering, so the old `Date.now()` fragment default is not reused.
 */
import type { WithExternalReferences } from '../types';
import { normalizeCode } from '../utils/searchUtils';
import {
  findExternalIdentityConflicts,
  isExternalSystemKey,
  readExternalReferences,
  validateExternalReference,
} from './externalReferencesPure';

/** The source key of a job created inside ASFOUR. External sources use their own system key (e.g. 'odoo'). */
export const ASFOUR_SOURCE_SYSTEM = 'asfour';

/** Minimal lifecycle - a reference state, not a production workflow. Upper case, like RecordStatus. */
export const JOB_REFERENCE_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type JobReferenceStatusValue = (typeof JOB_REFERENCE_STATUSES)[number];

export interface JobBatchIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface JobBatchValidation {
  valid: boolean;
  issues: JobBatchIssue[];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function optionalId(value: unknown): string | null {
  const t = text(value);
  return t === '' ? null : t;
}

type StoredRecord = Record<string, unknown> & { id?: string };

// --- Job Reference -------------------------------------------------------------

/**
 * The exact job document shape to write. Never `id`, timestamps or
 * `externalRefs` - the shared update is a merge, so stored references stay.
 */
export function jobReferencePayloadForSave(input: Record<string, unknown>) {
  return {
    code: text(input.code),
    // Phase 1 Step 8C: set = this job is a SUB-JOB of that main job.
    parentJobReferenceId: optionalId(input.parentJobReferenceId),
    productId: optionalId(input.productId),
    customerId: optionalId(input.customerId),
    status: text(input.status).toUpperCase(),
    sourceSystem: text(input.sourceSystem).toLowerCase() || ASFOUR_SOURCE_SYSTEM,
    notes: text(input.notes),
    active: input.active !== false,
  };
}

export function isJobReferenceStatus(value: unknown): value is JobReferenceStatusValue {
  return (JOB_REFERENCE_STATUSES as readonly string[]).includes(text(value).toUpperCase());
}

export interface ReferenceContext {
  editingId?: string | null;
  /** All job references as stored; null = not loaded, so the parent link is not checked here. */
  jobReferences?: readonly StoredRecord[] | null;
  /** Ids of the loaded products; null = not loaded, so the reference is not checked here. */
  knownProductIds?: ReadonlySet<string> | null;
  /** Ids of the loaded customers; null = not loaded. */
  knownCustomerIds?: ReadonlySet<string> | null;
}

/**
 * Validates a job reference before the shared write.
 *
 *   code          required; unique among job references after the existing code
 *                 normalisation, retired ones included. An edit that keeps its
 *                 code is never blocked.
 *   status        one of JOB_REFERENCE_STATUSES
 *   sourceSystem  a system key, the same rule as ExternalReference.system
 *   productId /   optional; when set, must be a loaded product / customer id
 *   customerId
 *   externalRefs  any stored ones must be valid, and no other job may claim the
 *                 same external identity (one Odoo Job Order -> one ASFOUR job)
 */
export function validateJobReferenceForSave(
  existing: readonly StoredRecord[],
  draft: Record<string, unknown>,
  context: ReferenceContext = {},
): JobBatchValidation {
  const issues: JobBatchIssue[] = [];
  const job = jobReferencePayloadForSave(draft);
  const editingId = context.editingId ?? null;
  const others = existing.filter((e) => String(e.id ?? '') !== String(editingId ?? ''));

  if (!job.code) {
    issues.push({ field: 'code', messageAr: 'رقم أمر الشغل إلزامي.', messageEn: 'The job reference code is required.' });
  } else {
    const self = editingId ? existing.find((e) => String(e.id ?? '') === editingId) : undefined;
    const unchanged = self && normalizeCode(text(self.code)) === normalizeCode(job.code);
    if (!unchanged && others.some((e) => normalizeCode(text(e.code)) === normalizeCode(job.code))) {
      issues.push({
        field: 'code',
        messageAr: `رقم أمر الشغل "${job.code}" مسجل بالفعل.`,
        messageEn: `Job reference "${job.code}" already exists.`,
      });
    }
  }

  if (!isJobReferenceStatus(job.status)) {
    issues.push({
      field: 'status',
      messageAr: `حالة أمر الشغل غير صالحة. القيم المسموحة: ${JOB_REFERENCE_STATUSES.join('، ')}.`,
      messageEn: `Invalid job status. Allowed: ${JOB_REFERENCE_STATUSES.join(', ')}.`,
    });
  }

  if (!isExternalSystemKey(job.sourceSystem)) {
    issues.push({
      field: 'sourceSystem',
      messageAr: 'مصدر أمر الشغل يجب أن يكون مفتاحًا بحروف صغيرة، مثل "asfour" أو "odoo".',
      messageEn: 'The job source must be a lowercase key, e.g. "asfour" or "odoo".',
    });
  }

  if (job.productId && context.knownProductIds && !context.knownProductIds.has(job.productId)) {
    issues.push({ field: 'productId', messageAr: 'المنتج المحدد غير موجود.', messageEn: 'The selected product does not exist.' });
  }
  if (job.customerId && context.knownCustomerIds && !context.knownCustomerIds.has(job.customerId)) {
    issues.push({ field: 'customerId', messageAr: 'العميل المحدد غير موجود.', messageEn: 'The selected customer does not exist.' });
  }

  /*
   * Phase 1 Step 8C - SUB-JOB. A job may belong to a MAIN job: the customer's
   * order stays one commercial reference while its remaining quantity (or any
   * other business reason) is produced under its own sub-job. One level only,
   * so a sub-job is never itself a parent and no cycle can form. The parent's
   * customer wins: a sub-job cannot quietly move the order to another customer.
   */
  const parentId = job.parentJobReferenceId;
  if (parentId) {
    if (editingId && parentId === editingId) {
      issues.push({ field: 'parentJobReferenceId', messageAr: 'لا يمكن أن يكون أمر الشغل أمرًا رئيسيًا لنفسه.', messageEn: 'A job cannot be its own main job.' });
    } else if (!context.jobReferences) {
      issues.push({ field: 'parentJobReferenceId', messageAr: 'تعذر التحقق من أمر الشغل الرئيسي - البيانات غير محملة.', messageEn: 'The main job cannot be verified - job references are not loaded.' });
    } else {
      const parent = context.jobReferences.find((j) => String(j.id ?? '') === parentId);
      if (!parent) {
        issues.push({ field: 'parentJobReferenceId', messageAr: 'أمر الشغل الرئيسي غير موجود.', messageEn: 'The main job does not exist.' });
      } else {
        if (text(parent.parentJobReferenceId)) {
          issues.push({
            field: 'parentJobReferenceId',
            messageAr: `"${text(parent.code)}" هو بالفعل أمر فرعي - المستوى واحد فقط.`,
            messageEn: `"${text(parent.code)}" is already a sub-job - only one level is allowed.`,
          });
        }
        if (editingId && context.jobReferences.some((j) => text(j.parentJobReferenceId) === editingId)) {
          issues.push({
            field: 'parentJobReferenceId',
            messageAr: 'هذا الأمر رئيسي لأوامر فرعية - لا يمكن أن يصبح أمرًا فرعيًا.',
            messageEn: 'This job is the main job of other sub-jobs - it cannot become a sub-job itself.',
          });
        }
        const parentCustomer = optionalId(parent.customerId);
        if (parentCustomer && job.customerId && parentCustomer !== job.customerId) {
          issues.push({
            field: 'customerId',
            messageAr: `عميل الأمر الفرعي يجب أن يطابق عميل الأمر الرئيسي "${text(parent.code)}".`,
            messageEn: `A sub-job's customer must match its main job "${text(parent.code)}".`,
          });
        }
      }
    }
  }

  const storedRefs = (draft as WithExternalReferences).externalRefs;
  if (Array.isArray(storedRefs)) {
    for (const ref of storedRefs) {
      for (const i of validateExternalReference(ref)) {
        issues.push({ field: 'externalRefs', messageAr: i.messageAr, messageEn: i.messageEn });
      }
    }
    const probeId = editingId ?? '__draft__';
    const conflicts = findExternalIdentityConflicts([
      ...others.map((o) => ({ id: String(o.id ?? ''), externalRefs: readExternalReferences(o) })),
      { id: probeId, externalRefs: readExternalReferences(draft) },
    ]).filter((c) => c.recordIds.includes(probeId));
    for (const c of conflicts) {
      issues.push({
        field: 'externalRefs',
        messageAr: `المرجع الخارجي ${c.system}/${c.externalId} مرتبط بأمر شغل آخر.`,
        messageEn: `External reference ${c.system}/${c.externalId} is already linked to another job reference.`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/** The sub-jobs of a job, in stored order. A main job may have many. */
export function subJobsOf(jobs: readonly StoredRecord[], jobReferenceId: string): StoredRecord[] {
  const id = text(jobReferenceId);
  return id ? jobs.filter((j) => text(j.parentJobReferenceId) === id) : [];
}

/** Whether a job is a sub-job of another. */
export function isSubJob(job: Record<string, unknown> | null | undefined): boolean {
  return Boolean(text(job?.parentJobReferenceId));
}

/**
 * The batches of a job (Phase 1 Step 8C). A job or sub-job may have MANY
 * batches: each batch names its own job, so nothing limits the count. The job's
 * own `batchId` (Step 4) stays what it was - the batch its execution setup
 * selected - and is included here when it is not already one of them.
 */
export function batchesOfJob(batches: readonly StoredRecord[], job: Record<string, unknown> | null | undefined): StoredRecord[] {
  const jobId = text(job?.id);
  if (!jobId) return [];
  const linked = batches.filter((b) => text(b.jobReferenceId) === jobId);
  const selectedId = text(job?.batchId);
  if (selectedId && !linked.some((b) => String(b.id ?? '') === selectedId)) {
    const selected = batches.find((b) => String(b.id ?? '') === selectedId);
    if (selected) return [...linked, selected];
  }
  return linked;
}

/** The batches of a job and of all its sub-jobs - the whole customer order's lots. */
export function batchesOfJobTree(jobs: readonly StoredRecord[], batches: readonly StoredRecord[], jobReferenceId: string): StoredRecord[] {
  const root = jobs.find((j) => String(j.id ?? '') === text(jobReferenceId));
  if (!root) return [];
  const tree = [root, ...subJobsOf(jobs, text(jobReferenceId))];
  const seen = new Set<string>();
  return tree.flatMap((j) => batchesOfJob(batches, j)).filter((b) => {
    const id = String(b.id ?? '');
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// --- Batch -----------------------------------------------------------------------

/** The exact batch document shape to write. No product code, no generated number. */
export function batchPayloadForSave(input: Record<string, unknown>) {
  return {
    batchNumber: text(input.batchNumber),
    productId: optionalId(input.productId),
    jobReferenceId: optionalId(input.jobReferenceId),
    notes: text(input.notes),
    active: input.active !== false,
  };
}

/**
 * The duplicate scope of a batch: normalised number + product + job reference.
 * Two batches with equal keys are the same lot entered twice.
 */
export function batchDuplicateScopeKey(batch: Record<string, unknown>): string | null {
  const b = batchPayloadForSave(batch);
  const number = normalizeCode(b.batchNumber);
  if (!number) return null;
  return JSON.stringify([number, b.productId ?? '', b.jobReferenceId ?? '']);
}

export interface BatchContext extends ReferenceContext {
  /** Ids of the loaded job references; null = not loaded. */
  knownJobReferenceIds?: ReadonlySet<string> | null;
}

/**
 * Validates a batch before the shared write.
 *
 *   batchNumber     required; duplicate only within (product, job reference) -
 *                   see the file header. An edit that keeps its scope is never blocked.
 *   productId       optional; when set, must be a loaded product id
 *   jobReferenceId  optional; when set, must be a loaded job reference id
 */
export function validateBatchForSave(
  existing: readonly StoredRecord[],
  draft: Record<string, unknown>,
  context: BatchContext = {},
): JobBatchValidation {
  const issues: JobBatchIssue[] = [];
  const batch = batchPayloadForSave(draft);
  const editingId = context.editingId ?? null;

  if (!batch.batchNumber) {
    issues.push({ field: 'batchNumber', messageAr: 'رقم الدفعة إلزامي.', messageEn: 'The batch number is required.' });
  } else {
    const key = batchDuplicateScopeKey(batch);
    const self = editingId ? existing.find((e) => String(e.id ?? '') === editingId) : undefined;
    const unchanged = self && batchDuplicateScopeKey(self) === key;
    const clash = !unchanged && existing.some((e) => String(e.id ?? '') !== String(editingId ?? '') && batchDuplicateScopeKey(e) === key);
    if (clash) {
      issues.push({
        field: 'batchNumber',
        messageAr: `الدفعة "${batch.batchNumber}" مسجلة بالفعل لنفس المنتج ونفس أمر الشغل.`,
        messageEn: `Batch "${batch.batchNumber}" already exists for the same product and job reference.`,
      });
    }
  }

  if (batch.productId && context.knownProductIds && !context.knownProductIds.has(batch.productId)) {
    issues.push({ field: 'productId', messageAr: 'المنتج المحدد غير موجود.', messageEn: 'The selected product does not exist.' });
  }
  if (batch.jobReferenceId && context.knownJobReferenceIds && !context.knownJobReferenceIds.has(batch.jobReferenceId)) {
    issues.push({ field: 'jobReferenceId', messageAr: 'أمر الشغل المحدد غير موجود.', messageEn: 'The selected job reference does not exist.' });
  }

  return { valid: issues.length === 0, issues };
}

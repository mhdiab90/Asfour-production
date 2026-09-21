/**
 * External references - the identity rules, pure and Firebase-free.
 *
 * ASFOUR OWNS ITS IDENTITY. Every record keeps its Firestore document id and,
 * where it has one, its ASFOUR business code (Product.code, a cost centre's
 * sheet1Code, an account code). An external system - Odoo or any other - is
 * linked through `externalRefs`, a list BESIDE that identity. Nothing here
 * reads, writes or derives an ASFOUR id or code, so ASFOUR works the same with
 * no external system at all.
 *
 * THE EXTERNAL IDENTITY is (system, model, externalId). It is what a future sync
 * matches on, so syncing the same external record twice updates one reference
 * instead of adding a second. `externalCode` is informational only: codes change
 * and differ between systems, so they never identify anything.
 *
 * MATCHING IS EXACT. Values are trimmed when a reference is normalised, and
 * compared by strict equality after that - no case folding, no similarity, no
 * guessing. A reference with no externalId has no identity key and can never be
 * matched or upserted.
 *
 * The shapes are `ExternalReference` and `WithExternalReferences` in
 * types/index.ts. Writes need nothing new: the existing sanitised update path
 * (updateMasterDataItem -> safeUpdateDoc) already persists a nested array, and
 * `externalReferencesPatch` produces a patch that can only touch this one field.
 *
 * No existing record is given this field. It stays optional everywhere.
 */
import type { ExternalReference, WithExternalReferences } from '../types';

/** A system key: lowercase letters, digits and underscores, starting with a letter. */
const SYSTEM_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Whether a value is a valid system key - the same rule `validateExternalReference` applies to `system`. */
export function isExternalSystemKey(value: unknown): boolean {
  return typeof value === 'string' && SYSTEM_KEY_PATTERN.test(value.trim());
}

export interface ExternalReferenceIssue {
  field: keyof ExternalReference | 'reference';
  messageEn: string;
  messageAr: string;
}

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t === '' ? undefined : t;
}

/**
 * Trims every string and drops empty optional fields. Changes no letter case
 * and invents nothing: the result has only the fields the input had.
 */
export function normaliseExternalReference(ref: ExternalReference): ExternalReference {
  const out: ExternalReference = { system: trimmed(ref.system) ?? '' };
  const model = trimmed(ref.model);
  const externalId = trimmed(ref.externalId);
  const externalCode = trimmed(ref.externalCode);
  const syncedAt = trimmed(ref.syncedAt);
  if (model !== undefined) out.model = model;
  if (externalId !== undefined) out.externalId = externalId;
  if (externalCode !== undefined) out.externalCode = externalCode;
  if (syncedAt !== undefined) out.syncedAt = syncedAt;
  return out;
}

/** Field checks for one reference. Empty result = valid. */
export function validateExternalReference(input: unknown): ExternalReferenceIssue[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [{ field: 'reference', messageEn: 'An external reference must be an object.', messageAr: 'المرجع الخارجي يجب أن يكون كائنًا.' }];
  }
  const raw = input as Record<string, unknown>;
  const issues: ExternalReferenceIssue[] = [];

  for (const field of ['system', 'model', 'externalId', 'externalCode', 'syncedAt'] as const) {
    if (raw[field] !== undefined && typeof raw[field] !== 'string') {
      issues.push({ field, messageEn: `${field} must be a string.`, messageAr: `الحقل ${field} يجب أن يكون نصًا.` });
    }
  }
  if (issues.length > 0) return issues;

  const ref = normaliseExternalReference(raw as unknown as ExternalReference);
  if (!ref.system) {
    issues.push({ field: 'system', messageEn: 'system is required.', messageAr: 'اسم النظام الخارجي مطلوب.' });
  } else if (!SYSTEM_KEY_PATTERN.test(ref.system)) {
    issues.push({
      field: 'system',
      messageEn: 'system must be a lowercase key (letters, digits, underscore), e.g. "odoo".',
      messageAr: 'اسم النظام يجب أن يكون مفتاحًا بحروف صغيرة (حروف وأرقام وشرطة سفلية)، مثل "odoo".',
    });
  }
  if (!ref.externalId && !ref.externalCode) {
    issues.push({
      field: 'externalId',
      messageEn: 'Either externalId or externalCode is required.',
      messageAr: 'يجب إدخال المعرف الخارجي أو الكود الخارجي.',
    });
  }
  if (ref.syncedAt !== undefined && Number.isNaN(Date.parse(ref.syncedAt))) {
    issues.push({ field: 'syncedAt', messageEn: 'syncedAt must be an ISO-8601 date-time.', messageAr: 'وقت المزامنة يجب أن يكون تاريخًا بصيغة ISO-8601.' });
  }
  return issues;
}

/**
 * The external identity key of a reference: (system, model, externalId).
 *
 * null when there is no externalId - such a reference identifies nothing.
 * Encoded as JSON so no separator character inside a value can make two
 * different identities collide.
 */
export function externalIdentityKey(ref: Pick<ExternalReference, 'system' | 'model' | 'externalId'>): string | null {
  const system = trimmed(ref.system);
  const externalId = trimmed(ref.externalId);
  if (!system || !externalId) return null;
  return JSON.stringify([system, trimmed(ref.model) ?? '', externalId]);
}

/**
 * Reads `externalRefs` off any stored value, tolerantly.
 *
 * Absent, null or not an array -> []. Entries that fail validation are left out
 * rather than throwing, so a record written before this field existed, or one
 * with a malformed entry, still loads. Nothing is written back.
 */
export function readExternalReferences(record: unknown): ExternalReference[] {
  const refs = record && typeof record === 'object' ? (record as WithExternalReferences).externalRefs : undefined;
  if (!Array.isArray(refs)) return [];
  return refs
    .filter((r) => validateExternalReference(r).length === 0)
    .map((r) => normaliseExternalReference(r));
}

/** Exact lookup by external identity. No partial or case-insensitive matching. */
export function findExternalReference(
  refs: readonly ExternalReference[],
  identity: Pick<ExternalReference, 'system' | 'model' | 'externalId'>,
): ExternalReference | undefined {
  const key = externalIdentityKey(identity);
  if (key === null) return undefined;
  return refs.find((r) => externalIdentityKey(r) === key);
}

export type ExternalReferenceUpsertOutcome = 'ADDED' | 'UPDATED' | 'UNCHANGED' | 'REJECTED';

export interface ExternalReferenceUpsertResult {
  refs: ExternalReference[];
  outcome: ExternalReferenceUpsertOutcome;
  issues: ExternalReferenceIssue[];
}

/**
 * Adds or refreshes one reference, keyed on the external identity.
 *
 * Idempotent: upserting the same (system, model, externalId) again replaces that
 * one entry and never duplicates it. A reference without an externalId is
 * REJECTED, because there is nothing to key an idempotent sync on. Returns a new
 * array; the input is never mutated.
 */
export function upsertExternalReference(
  refs: readonly ExternalReference[],
  incoming: ExternalReference,
): ExternalReferenceUpsertResult {
  const issues = validateExternalReference(incoming);
  const ref = issues.length === 0 ? normaliseExternalReference(incoming) : undefined;
  const key = ref ? externalIdentityKey(ref) : null;
  const current = refs.map((r) => ({ ...r }));

  if (!ref || key === null) {
    return {
      refs: current,
      outcome: 'REJECTED',
      issues: issues.length > 0
        ? issues
        : [{ field: 'externalId', messageEn: 'externalId is required to link a record for sync.', messageAr: 'المعرف الخارجي مطلوب لربط السجل للمزامنة.' }],
    };
  }

  const index = current.findIndex((r) => externalIdentityKey(r) === key);
  if (index === -1) return { refs: [...current, ref], outcome: 'ADDED', issues: [] };
  if (JSON.stringify(normaliseExternalReference(current[index])) === JSON.stringify(ref)) {
    return { refs: current, outcome: 'UNCHANGED', issues: [] };
  }
  current[index] = ref;
  return { refs: current, outcome: 'UPDATED', issues: [] };
}

/**
 * A record with one reference added or refreshed. Returns a copy in which ONLY
 * `externalRefs` can differ - the id, code and every other field are carried
 * over untouched.
 */
export function withExternalReference<T extends WithExternalReferences>(
  record: T,
  incoming: ExternalReference,
): { record: T; outcome: ExternalReferenceUpsertOutcome; issues: ExternalReferenceIssue[] } {
  const result = upsertExternalReference(readExternalReferences(record), incoming);
  if (result.outcome === 'REJECTED' || result.outcome === 'UNCHANGED') {
    return { record, outcome: result.outcome, issues: result.issues };
  }
  return { record: { ...record, externalRefs: result.refs }, outcome: result.outcome, issues: [] };
}

/**
 * The update patch for the existing write path. It contains exactly one key,
 * `externalRefs`, so it cannot overwrite an id, a code or anything else.
 */
export function externalReferencesPatch(refs: readonly ExternalReference[]): { externalRefs: ExternalReference[] } {
  return { externalRefs: readExternalReferences({ externalRefs: refs }) };
}

export interface ExternalIdentityConflict {
  key: string;
  system: string;
  model?: string;
  externalId: string;
  /** The distinct ASFOUR record ids that all claim this one external identity. */
  recordIds: string[];
}

/**
 * External identities claimed by more than one ASFOUR record.
 *
 * One external record must map to exactly one ASFOUR record. A sync that meets a
 * conflict has to stop and report it - never pick one of the records.
 */
export function findExternalIdentityConflicts(
  records: ReadonlyArray<{ id?: string } & WithExternalReferences>,
): ExternalIdentityConflict[] {
  const byKey = new Map<string, { ref: ExternalReference; ids: Set<string> }>();
  for (const record of records) {
    const id = record.id ? String(record.id) : '';
    if (!id) continue;
    for (const ref of readExternalReferences(record)) {
      const key = externalIdentityKey(ref);
      if (key === null) continue;
      const entry = byKey.get(key) ?? { ref, ids: new Set<string>() };
      entry.ids.add(id);
      byKey.set(key, entry);
    }
  }
  const conflicts: ExternalIdentityConflict[] = [];
  for (const [key, { ref, ids }] of byKey) {
    if (ids.size < 2) continue;
    conflicts.push({
      key,
      system: ref.system,
      ...(ref.model ? { model: ref.model } : {}),
      externalId: ref.externalId as string,
      recordIds: [...ids].sort(),
    });
  }
  return conflicts;
}

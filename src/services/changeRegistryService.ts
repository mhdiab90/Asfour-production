/**
 * Change Registry & Release Registry persistence (Layer 3 of the release chain).
 *
 * Complements systemVersionService.ts, which already owns Layers 1-2
 * (systemVersions + versionRollbacks). This module never touches those
 * collections; it adds `changeRegistry`, `releases`, `registryCounters` and
 * `featureFlags`.
 *
 * READ DISCIPLINE (this app has a Firestore quota programme):
 *   - nothing here runs on application startup;
 *   - the counter is read ONLY when an ID is actually minted;
 *   - no polling, no collection scan to find the next id, no N+1 - a release's
 *     changes are fetched with a single `where(documentId(), 'in', ...)` batch;
 *   - the Version Management screen is the only normal reader.
 *
 * All validation lives in changeRegistryPure.ts so it stays testable without
 * Firebase; this file is the Firestore boundary only.
 */
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { logAuditAction } from './auditService';
import {
  ChangeRecord,
  ReleaseRecord,
  ChangePrefix,
  ChangeStatus,
  assertTransition,
  assertUpdateAllowed,
  findDependencyCycle,
  formatChangeId,
  parseChangeId,
  formatReleaseId,
  isValidChangeId,
  isValidReleaseId,
  validateChangeRecord,
  validateDependencies,
  validateReleaseRecord,
} from './changeRegistryPure';

const CHANGES = 'changeRegistry';
const RELEASES = 'releases';
const COUNTERS = 'registryCounters';
const FLAGS = 'featureFlags';
/** Single shared document; see firestore.rules. Absent => everything ON. */
const FLAGS_DOC = 'active';

/** Firestore sets error.code on permission failures; surfaced so the UI can explain rather than look broken. */
export function isPermissionDeniedError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'permission-denied';
}

function actor(): string {
  return auth.currentUser?.email || 'unknown';
}

// --- ID allocation ----------------------------------------------------------

/** One counter for ALL change ids - see allocateChangeId. */
const CHANGE_COUNTER = 'change';

/**
 * Mints the next id inside a transaction, so two admins creating a change at
 * the same moment can never receive the same number. Ids are never reused: the
 * counter only moves forward, and a deleted draft does not free its number
 * (deletion is impossible anyway - see firestore.rules).
 *
 * The sequence is GLOBAL, not per-prefix: MOD-0001, MOD-0002, INFRA-0003...
 * The prefix classifies a change, it does not open a separate number space.
 * A per-prefix counter would make MOD-0001 and FIX-0001 both "the first
 * change", and could never reproduce ids that were declared in a release
 * manifest before the registry existed.
 */
export async function allocateChangeId(prefix: ChangePrefix): Promise<string> {
  const ref = doc(db, COUNTERS, CHANGE_COUNTER);
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? Number(snap.data().seq || 0) : 0;
    const seq = current + 1;
    tx.set(ref, { seq, updatedAt: new Date().toISOString() }, { merge: true });
    return seq;
  });
  return formatChangeId(prefix, next);
}

/**
 * Bootstraps a change whose id was declared in a release manifest before the
 * registry existed - the only path that accepts an id instead of minting one.
 *
 * It refuses if the id is already taken, so registering the same manifest twice
 * cannot create a duplicate, and it drags the shared counter past the id so a
 * later allocateChangeId() can never hand out the same number again.
 */
export async function registerDeclaredChange(
  changeId: string,
  draft: Omit<ChangeRecord, 'changeId' | 'createdAt' | 'createdBy'>,
): Promise<ChangeRecord> {
  const parsed = parseChangeId(changeId);
  if (!parsed) throw new Error(`"${changeId}" is not a valid Change ID`);

  const existing = await getChange(changeId);
  if (existing) throw new Error(`${changeId} already exists - refusing to create a duplicate`);

  const record: ChangeRecord = {
    ...draft,
    changeId,
    createdAt: new Date().toISOString(),
    createdBy: actor(),
  };
  const errors = validateChangeRecord(record);
  if (errors.length) throw new Error(`invalid change record:\n - ${errors.join('\n - ')}`);

  await runTransaction(db, async (tx) => {
    const ref = doc(db, COUNTERS, CHANGE_COUNTER);
    const snap = await tx.get(ref);
    const current = snap.exists() ? Number(snap.data().seq || 0) : 0;
    if (parsed.seq > current) {
      tx.set(ref, { seq: parsed.seq, updatedAt: new Date().toISOString() }, { merge: true });
    }
  });

  await setDoc(doc(db, CHANGES, changeId), record);
  logAuditAction('CREATE', CHANGES, changeId, `تسجيل تغيير معلن ${changeId}: ${record.title}`).catch(() => {});
  return record;
}

export async function allocateReleaseId(year = new Date().getFullYear()): Promise<string> {
  const ref = doc(db, COUNTERS, `release_${year}`);
  const next = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? Number(snap.data().seq || 0) : 0;
    const seq = current + 1;
    tx.set(ref, { seq, year, updatedAt: new Date().toISOString() }, { merge: true });
    return seq;
  });
  return formatReleaseId(year, next);
}

// --- Change Registry --------------------------------------------------------

export async function getChange(changeId: string): Promise<ChangeRecord | null> {
  if (!isValidChangeId(changeId)) throw new Error(`"${changeId}" is not a valid Change ID`);
  const snap = await getDoc(doc(db, CHANGES, changeId));
  return snap.exists() ? ({ ...(snap.data() as ChangeRecord), changeId }) : null;
}

/** Batched by document id - never one read per change. */
export async function getChanges(changeIds: string[]): Promise<ChangeRecord[]> {
  const ids = [...new Set(changeIds.filter(isValidChangeId))];
  if (!ids.length) return [];
  const out: ChangeRecord[] = [];
  // Firestore caps an `in` filter at 30 values, so page rather than N+1.
  for (let i = 0; i < ids.length; i += 30) {
    const batch = ids.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, CHANGES), where(documentId(), 'in', batch)));
    snap.forEach((d) => out.push({ ...(d.data() as ChangeRecord), changeId: d.id }));
  }
  return out;
}

export async function listChanges(max = 100): Promise<ChangeRecord[]> {
  const snap = await getDocs(query(collection(db, CHANGES), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ ...(d.data() as ChangeRecord), changeId: d.id }));
}

/**
 * Creates a change. The id is minted here rather than supplied, so a caller
 * cannot claim an id that is already taken or invent one out of sequence.
 */
export async function createChange(
  prefix: ChangePrefix,
  draft: Omit<ChangeRecord, 'changeId' | 'createdAt' | 'createdBy' | 'status'> & { status?: ChangeStatus },
): Promise<ChangeRecord> {
  const changeId = await allocateChangeId(prefix);
  const record: ChangeRecord = {
    ...draft,
    changeId,
    status: draft.status ?? 'DRAFT',
    createdAt: new Date().toISOString(),
    createdBy: actor(),
  };

  const errors = validateChangeRecord(record);
  if (errors.length) throw new Error(`invalid change record:\n - ${errors.join('\n - ')}`);

  const refs = [...(record.dependencies ?? []), ...(record.relatedChanges ?? []), ...(record.parentChangeId ? [record.parentChangeId] : [])];
  if (refs.length) {
    const existing = await getChanges(refs);
    const known = new Set(existing.map((c) => c.changeId));
    const depErrors = validateDependencies(record, (id) => known.has(id));
    if (depErrors.length) throw new Error(`invalid dependencies:\n - ${depErrors.join('\n - ')}`);

    // Reject a cycle before it is written, not after.
    const graph = new Map(existing.map((c) => [c.changeId, c.dependencies ?? []]));
    graph.set(record.changeId, record.dependencies ?? []);
    const cycle = findDependencyCycle(record.changeId, (id) => graph.get(id));
    if (cycle) throw new Error(`circular dependency: ${cycle.join(' -> ')}`);
  }

  await setDoc(doc(db, CHANGES, changeId), record);
  logAuditAction('CREATE', CHANGES, changeId, `إنشاء سجل تغيير ${changeId}: ${record.title}`).catch(() => {});
  return record;
}

/** Historical identity is frozen once a change ships; only operational fields move. */
export async function updateChange(changeId: string, patch: Partial<ChangeRecord>): Promise<void> {
  const current = await getChange(changeId);
  if (!current) throw new Error(`${changeId} does not exist`);
  assertUpdateAllowed(current, patch);
  if (patch.status && patch.status !== current.status) assertTransition(current.status, patch.status);
  await updateDoc(doc(db, CHANGES, changeId), patch as Record<string, unknown>);
  logAuditAction('UPDATE', CHANGES, changeId, `تحديث سجل التغيير ${changeId}`).catch(() => {});
}

export async function setChangeStatus(changeId: string, status: ChangeStatus): Promise<void> {
  await updateChange(changeId, { status });
}

export async function approveChange(changeId: string): Promise<void> {
  const current = await getChange(changeId);
  if (!current) throw new Error(`${changeId} does not exist`);
  assertTransition(current.status, 'APPROVED');
  await updateDoc(doc(db, CHANGES, changeId), {
    status: 'APPROVED',
    approvedAt: new Date().toISOString(),
    approvedBy: actor(),
  });
  logAuditAction('UPDATE', CHANGES, changeId, `اعتماد سجل التغيير ${changeId}`).catch(() => {});
}

// --- Release Registry -------------------------------------------------------

export async function getRelease(releaseId: string): Promise<ReleaseRecord | null> {
  if (!isValidReleaseId(releaseId)) throw new Error(`"${releaseId}" is not a valid Release ID`);
  const snap = await getDoc(doc(db, RELEASES, releaseId));
  return snap.exists() ? ({ ...(snap.data() as ReleaseRecord), releaseId }) : null;
}

export async function listReleases(max = 50): Promise<ReleaseRecord[]> {
  const snap = await getDocs(query(collection(db, RELEASES), orderBy('createdAt', 'desc'), limit(max)));
  return snap.docs.map((d) => ({ ...(d.data() as ReleaseRecord), releaseId: d.id }));
}

/**
 * Creates a release from APPROVED changes only. A release that could enumerate
 * unapproved work would defeat the gate, so this refuses rather than warns.
 */
export async function createRelease(
  draft: Omit<ReleaseRecord, 'releaseId' | 'createdAt' | 'createdBy'>,
): Promise<ReleaseRecord> {
  const releaseId = await allocateReleaseId();
  const record: ReleaseRecord = {
    ...draft,
    releaseId,
    createdAt: new Date().toISOString(),
    createdBy: actor(),
  };

  const errors = validateReleaseRecord(record);
  if (errors.length) throw new Error(`invalid release record:\n - ${errors.join('\n - ')}`);

  const changes = await getChanges(record.changeIds);
  const found = new Set(changes.map((c) => c.changeId));
  const missing = record.changeIds.filter((id) => !found.has(id));
  if (missing.length) throw new Error(`release names unknown Change ID(s): ${missing.join(', ')}`);

  const unapproved = changes.filter((c) => c.status !== 'APPROVED');
  if (unapproved.length) {
    throw new Error(
      `every change in a release must be APPROVED first. Not approved: ` +
      unapproved.map((c) => `${c.changeId} (${c.status})`).join(', '),
    );
  }

  await setDoc(doc(db, RELEASES, releaseId), record);
  logAuditAction('CREATE', RELEASES, releaseId, `إنشاء إصدار ${releaseId} (${record.version})`).catch(() => {});
  return record;
}

/** Marks the release and every change in it as shipped, recording the deployment. */
export async function markReleaseDeployed(
  releaseId: string,
  deployment: { deploymentId: string; deployedAt?: string },
): Promise<void> {
  const release = await getRelease(releaseId);
  if (!release) throw new Error(`${releaseId} does not exist`);
  const deployedAt = deployment.deployedAt ?? new Date().toISOString();
  const deployedBy = actor();

  await updateDoc(doc(db, RELEASES, releaseId), { deployedAt, deployedBy, deploymentId: deployment.deploymentId });
  for (const changeId of release.changeIds) {
    const current = await getChange(changeId);
    if (!current || current.status !== 'APPROVED') continue;
    await updateDoc(doc(db, CHANGES, changeId), {
      status: 'RELEASED',
      releaseId,
      deployedAt,
      deployedBy,
      deploymentId: deployment.deploymentId,
      commitHash: release.commitSha,
    });
  }
  logAuditAction('UPDATE', RELEASES, releaseId, `تسجيل نشر الإصدار ${releaseId}`).catch(() => {});
}

// --- Feature flags ----------------------------------------------------------

/**
 * Absent document, absent key, or an unreadable Firestore all resolve to ON.
 * A flag system that fails closed would let an outage dark-launch features off,
 * which is a worse failure than the one it protects against.
 */
export async function getFeatureFlags(): Promise<Record<string, boolean>> {
  try {
    const snap = await getDoc(doc(db, FLAGS, FLAGS_DOC));
    return snap.exists() ? ((snap.data().flags as Record<string, boolean>) ?? {}) : {};
  } catch {
    return {};
  }
}

export function isFlagEnabled(flags: Record<string, boolean>, name: string): boolean {
  return flags[name] !== false;
}

export async function setFeatureFlag(name: string, enabled: boolean): Promise<void> {
  await setDoc(doc(db, FLAGS, FLAGS_DOC), { flags: { [name]: enabled }, updatedAt: new Date().toISOString(), updatedBy: actor() }, { merge: true });
  logAuditAction(enabled ? 'ACTIVATE' : 'DEACTIVATE', FLAGS, name, `${enabled ? 'تفعيل' : 'تعطيل'} الخاصية ${name}`).catch(() => {});
}

/**
 * System Version Management & Application Rollback service.
 *
 * CRITICAL: this governs the APPLICATION CODE / DEPLOYED BUILD version only.
 * It NEVER reads or writes production/masterData/stage_* collections, and a
 * rollback here never deletes, restores, or modifies Firestore data - that
 * stays on the existing, separate backup/restore and historical-import-undo
 * systems (backupService.ts/restoreService.ts/importMappingService.ts).
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { logAuditAction } from './auditService';
import { CURRENT_APP_VERSION } from '../config/appVersion';
import { activeDeploymentProvider } from './deploymentProviders/ManualDeploymentProvider';
import {
  SystemVersionRecord,
  RollbackOperation,
  RollbackStatus,
  RollbackReasonCategory,
  HealthCheckResult,
  HealthCheckItemResult,
  SystemVersionHealthStatus,
} from '../types';

const VERSIONS_COLLECTION = 'systemVersions';
const ROLLBACKS_COLLECTION = 'versionRollbacks';

/** §18 CRITICAL: a real Git commit reference, never a branch name or human label alone. Accepts the standard abbreviated (7) to full (40) hex SHA range. */
export function isValidCommitSha(sha: string | undefined | null): boolean {
  return !!sha && /^[0-9a-f]{7,40}$/i.test(sha.trim());
}

/**
 * Firebase Firestore SDK errors set `error.code === 'permission-denied'`.
 * Kept as a small local helper (not imported from chineseMillsHistoricalImportService.ts,
 * an unrelated feature module) so this service has no cross-feature
 * dependency - the two implementations are intentionally independent.
 */
export function isPermissionDeniedError(err: unknown): boolean {
  const anyErr = err as any;
  if (anyErr?.code === 'permission-denied') return true;
  const message = String(anyErr?.message || err || '');
  return message.includes('permission-denied') || message.includes('Missing or insufficient permissions');
}

export interface RunningBuildInfo {
  /** true when this code is executing from `vite dev` (a local development session), false for an actual production build (including one served locally after `vite build && vite preview`) - Vite's own compiled-in flag, never guessed. */
  isLocalDevelopment: boolean;
  versionLabel?: string;
  buildId?: string;
  commitSha?: string;
  environment: 'production' | 'staging' | 'development';
}

/**
 * §4/§9/§15/§22 CRITICAL: identifies what THIS running bundle actually is,
 * independent of Firestore (so it's always knowable, even if Firestore
 * reads fail) and independent of any fabrication - `import.meta.env.DEV`
 * is Vite's own build-time flag, true only for `vite dev` and false for
 * every real `vite build` output (which is what actually gets deployed).
 * A local dev session NEVER claims a production version/deployment; a real
 * production build reports the EXISTING, already-checked-in
 * config/appVersion.ts values (§9: "use the authoritative build/version
 * source already present in the repository") - never invented here.
 */
export function getRunningBuildInfo(): RunningBuildInfo {
  const isLocalDevelopment = Boolean((import.meta as any).env?.DEV);
  if (isLocalDevelopment) {
    return { isLocalDevelopment: true, environment: 'development' };
  }
  return {
    isLocalDevelopment: false,
    versionLabel: CURRENT_APP_VERSION.version,
    buildId: CURRENT_APP_VERSION.buildId,
    commitSha: CURRENT_APP_VERSION.gitCommit,
    environment: CURRENT_APP_VERSION.environment,
  };
}

export class RollbackLockError extends Error {
  constructor(public activeRollback: RollbackOperation) {
    super('Another rollback operation is already in progress.');
    this.name = 'RollbackLockError';
  }
}

interface Actor {
  uid: string;
  email: string;
}

function requireActor(): Actor {
  const user = auth.currentUser;
  if (!user) throw new Error('No authenticated user.');
  return { uid: user.uid, email: user.email || 'admin' };
}

/**
 * The 3 pre-existing releases from config/appVersion.ts's static changelog,
 * merged in read-only at query time (never written to Firestore) so
 * existing release history isn't lost (§35) without inventing a migration.
 * `isLegacyRecord: true` + a non-immutable commitSha means these can NEVER
 * be offered as a rollback target (§18 CRITICAL) - only real checkpoints
 * created through this system, which always carry a validated commit SHA,
 * can be.
 */
function legacySeedVersions(): SystemVersionRecord[] {
  return CURRENT_APP_VERSION.changelog.map((entry, idx) => ({
    id: `legacy-${entry.version}`,
    versionLabel: entry.version,
    commitSha: idx === 0 ? CURRENT_APP_VERSION.gitCommit : `legacy-${entry.version}`,
    branch: 'main',
    buildId: idx === 0 ? CURRENT_APP_VERSION.buildId : 'unknown',
    environment: 'production' as const,
    status: 'HEALTHY' as const,
    health: 'HEALTHY' as SystemVersionHealthStatus,
    isKnownGood: false,
    isLegacyRecord: true,
    checkpointType: 'RELEASE' as const,
    releaseNotes: entry.highlights.join(' | '),
    createdBy: 'system',
    createdByName: 'ASFOUR (pre-existing changelog)',
    createdAt: new Date(entry.date).toISOString(),
  }));
}

export async function listVersions(): Promise<SystemVersionRecord[]> {
  const snap = await getDocs(query(collection(db, VERSIONS_COLLECTION), orderBy('createdAt', 'desc')));
  const live = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SystemVersionRecord));
  return [...live, ...legacySeedVersions()];
}

export async function getVersion(versionId: string): Promise<SystemVersionRecord | null> {
  if (versionId.startsWith('legacy-')) {
    return legacySeedVersions().find((v) => v.id === versionId) || null;
  }
  const snap = await getDoc(doc(db, VERSIONS_COLLECTION, versionId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as SystemVersionRecord;
}

/** §5: creates a RELEASE checkpoint - metadata/references only, never a source-code snapshot. */
export async function createReleaseCheckpoint(input: {
  versionLabel: string;
  commitSha: string;
  branch: string;
  buildId: string;
  deploymentId?: string;
  deploymentReference?: string;
  environment: 'production' | 'staging' | 'development';
  releaseNotes?: string;
}): Promise<string> {
  const actor = requireActor();
  if (!input.versionLabel?.trim()) throw new Error('Version label is required.');
  if (!isValidCommitSha(input.commitSha)) throw new Error('A valid commit SHA (7-40 hex characters) is required.');
  if (!input.branch?.trim()) throw new Error('Branch is required.');

  const docRef = doc(collection(db, VERSIONS_COLLECTION));
  const record: SystemVersionRecord = {
    id: docRef.id,
    versionLabel: input.versionLabel.trim(),
    commitSha: input.commitSha.trim(),
    branch: input.branch.trim(),
    buildId: input.buildId?.trim() || '',
    deploymentId: input.deploymentId?.trim(),
    deploymentReference: input.deploymentReference?.trim(),
    environment: input.environment,
    status: 'DEPLOYING',
    health: 'UNKNOWN',
    isKnownGood: false,
    checkpointType: 'RELEASE',
    releaseNotes: input.releaseNotes?.trim(),
    createdBy: actor.uid,
    createdByName: actor.email,
    createdAt: new Date().toISOString(),
  };
  await setDoc(docRef, record);
  await logAuditAction('VERSION_CHECKPOINT_CREATED', VERSIONS_COLLECTION, docRef.id, `Release checkpoint created: v${record.versionLabel} @ ${record.commitSha} (${record.environment})`);
  return docRef.id;
}

/** §6/§40: only an explicit admin action - never automatic (§41). */
export async function markVersionKnownGood(versionId: string): Promise<void> {
  const actor = requireActor();
  if (versionId.startsWith('legacy-')) throw new Error('Legacy pre-system versions cannot be marked Known Good.');
  const ref = doc(db, VERSIONS_COLLECTION, versionId);
  await updateDoc(ref, {
    isKnownGood: true,
    knownGoodBy: actor.uid,
    knownGoodByName: actor.email,
    knownGoodAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await logAuditAction('VERSION_MARKED_KNOWN_GOOD', VERSIONS_COLLECTION, versionId, `Version marked Known Good by ${actor.email}`);
}

/**
 * Real, client-observable health checks (§15/§16) - reuses the SAME
 * lightweight Firestore-latency ping pattern already used by
 * SystemHealthView.tsx's runDiagnostics(), rather than a second/divergent
 * mechanism. Never fabricates infra-level checks (CDN, edge, DNS) that
 * would require server-side access this app doesn't have.
 */
export async function runHealthCheck(): Promise<HealthCheckResult> {
  const checks: HealthCheckItemResult[] = [];

  // Application responding - trivially true if this code is executing, but
  // still recorded explicitly since it's one of the named checks (§15).
  checks.push({ name: 'application', nameAr: 'التطبيق يستجيب', nameEn: 'Application Responding', passed: true });

  // Firebase initialized / Auth operational
  const authStart = performance.now();
  const authOk = !!auth.app;
  checks.push({
    name: 'firebase_auth',
    nameAr: 'تهيئة Firebase والمصادقة',
    nameEn: 'Firebase Initialization & Authentication',
    passed: authOk,
    durationMs: Math.round(performance.now() - authStart),
    detail: authOk ? undefined : 'Firebase Auth is not initialized.',
  });

  // Firestore reachable
  const fsStart = performance.now();
  let fsOk = false;
  let fsDetail: string | undefined;
  try {
    await getDocs(query(collection(db, 'products'), limit(1)));
    fsOk = true;
  } catch (err: any) {
    fsDetail = 'Firestore query failed.';
  }
  checks.push({
    name: 'firestore',
    nameAr: 'الوصول إلى قاعدة بيانات Firestore',
    nameEn: 'Firestore Reachability',
    passed: fsOk,
    durationMs: Math.round(performance.now() - fsStart),
    detail: fsDetail,
  });

  // Critical API / permission system operational - can the current session read its own authorization record
  let permOk = false;
  const permStart = performance.now();
  try {
    if (auth.currentUser) {
      const snap = await getDoc(doc(db, 'adminUsers', auth.currentUser.uid));
      permOk = snap.exists();
    }
  } catch {
    permOk = false;
  }
  checks.push({
    name: 'permissions',
    nameAr: 'نظام الصلاحيات والتفويض',
    nameEn: 'Permission & Authorization System',
    passed: permOk,
    durationMs: Math.round(performance.now() - permStart),
    detail: permOk ? undefined : 'Could not verify the current user\'s authorization record.',
  });

  const allPassed = checks.every((c) => c.passed);
  const criticalPassed = checks.filter((c) => c.name === 'firebase_auth' || c.name === 'firestore').every((c) => c.passed);
  const overall: SystemVersionHealthStatus = allPassed ? 'HEALTHY' : criticalPassed ? 'DEGRADED' : 'UNHEALTHY';

  return { overall, checkedAt: new Date().toISOString(), checks };
}

/** §32: prevents two simultaneous rollback operations. */
export async function getActiveRollbackLock(): Promise<RollbackOperation | null> {
  const snap = await getDocs(query(collection(db, ROLLBACKS_COLLECTION), where('status', 'in', ['REQUESTED', 'APPROVED', 'RUNNING'])));
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() } as RollbackOperation;
}

export interface RequestRollbackInput {
  fromVersion: SystemVersionRecord;
  toVersion: SystemVersionRecord;
  reason: string;
  reasonCategory: RollbackReasonCategory;
  requiresTwoPersonApproval: boolean;
  isEmergency: boolean;
}

/** §12/§13: creates the audited request. Never blank reason. Never a legacy/unverified target (§18). Blocked by an existing active rollback (§32). */
export async function requestRollback(input: RequestRollbackInput): Promise<string> {
  const actor = requireActor();
  if (!input.reason?.trim()) throw new Error('A rollback reason is required.');
  if (input.toVersion.isLegacyRecord || !isValidCommitSha(input.toVersion.commitSha)) {
    throw new Error('This version has no verified immutable commit reference and cannot be a rollback target.');
  }

  const lock = await getActiveRollbackLock();
  if (lock) throw new RollbackLockError(lock);

  const docRef = doc(collection(db, ROLLBACKS_COLLECTION));
  const now = new Date().toISOString();
  const op: RollbackOperation = {
    id: docRef.id,
    fromVersionId: input.fromVersion.id || '',
    fromVersionLabel: input.fromVersion.versionLabel,
    fromCommitSha: input.fromVersion.commitSha,
    toVersionId: input.toVersion.id || '',
    toVersionLabel: input.toVersion.versionLabel,
    toCommitSha: input.toVersion.commitSha,
    requestedBy: actor.uid,
    requestedByName: actor.email,
    requiresTwoPersonApproval: input.requiresTwoPersonApproval,
    isEmergency: input.isEmergency,
    reason: input.reason.trim(),
    reasonCategory: input.reasonCategory,
    // §14: never impossible to use with a single SUPER_ADMIN - when
    // two-person approval isn't required, the requester's own rollback
    // permission (already checked before this function can be called)
    // constitutes approval.
    status: input.requiresTwoPersonApproval ? 'REQUESTED' : 'APPROVED',
    requestedAt: now,
    ...(input.requiresTwoPersonApproval ? {} : { approvedAt: now, approvedBy: actor.uid, approvedByName: actor.email }),
  };
  await setDoc(docRef, op);
  await logAuditAction('ROLLBACK_REQUESTED', ROLLBACKS_COLLECTION, docRef.id, `Rollback requested: v${op.fromVersionLabel} -> v${op.toVersionLabel}. Reason (${op.reasonCategory}): ${op.reason}`);
  return docRef.id;
}

/** §14: the second person in a two-person approval flow. */
export async function approveRollback(rollbackId: string): Promise<void> {
  const actor = requireActor();
  const ref = doc(db, ROLLBACKS_COLLECTION, rollbackId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Rollback operation not found.');
  const op = snap.data() as RollbackOperation;
  if (op.status !== 'REQUESTED') throw new Error('This rollback is not awaiting approval.');

  await updateDoc(ref, {
    status: 'APPROVED' as RollbackStatus,
    approvedBy: actor.uid,
    approvedByName: actor.email,
    approvedAt: new Date().toISOString(),
  });
  await logAuditAction('ROLLBACK_APPROVED', ROLLBACKS_COLLECTION, rollbackId, `Rollback approved by ${actor.email}`);
}

export async function cancelRollback(rollbackId: string, reason?: string): Promise<void> {
  const actor = requireActor();
  const ref = doc(db, ROLLBACKS_COLLECTION, rollbackId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Rollback operation not found.');
  const op = snap.data() as RollbackOperation;
  if (op.status !== 'REQUESTED' && op.status !== 'APPROVED') {
    throw new Error('Only a pending (not yet running) rollback can be cancelled.');
  }

  await updateDoc(ref, {
    status: 'CANCELLED' as RollbackStatus,
    cancelledBy: actor.uid,
    cancelledByName: actor.email,
    cancelReason: reason || '',
    completedAt: new Date().toISOString(),
  });
  await logAuditAction('ROLLBACK_CANCELLED', ROLLBACKS_COLLECTION, rollbackId, `Rollback cancelled by ${actor.email}${reason ? `: ${reason}` : ''}`);
}

/**
 * Executes an APPROVED rollback (§8-11/§15-17): re-checks the lock, creates
 * the PRE_ROLLBACK_CHECKPOINT for the CURRENT version, runs the pre-rollback
 * health check, marks RUNNING, then delegates to the active
 * DeploymentProvider. With the default ManualDeploymentProvider this always
 * returns requiresManualCompletion - the operation stays RUNNING (never
 * falsely SUCCESS) until confirmManualDeploymentComplete() is called after
 * a human finishes the actual deployment outside this app.
 */
export async function executeRollback(rollbackId: string): Promise<RollbackOperation> {
  const actor = requireActor();
  const ref = doc(db, ROLLBACKS_COLLECTION, rollbackId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Rollback operation not found.');
  let op = { id: snap.id, ...snap.data() } as RollbackOperation;
  if (op.status !== 'APPROVED') throw new Error('Rollback must be APPROVED before it can run.');

  const activeLock = await getActiveRollbackLock();
  if (activeLock && activeLock.id !== rollbackId && activeLock.status === 'RUNNING') {
    throw new RollbackLockError(activeLock);
  }

  const preHealth = await runHealthCheck();

  // §10: PRE_ROLLBACK_CHECKPOINT for the CURRENT version - created even if
  // health is degraded, so nothing is lost and the admin can return forward.
  const checkpointRef = doc(collection(db, VERSIONS_COLLECTION));
  const checkpointRecord: SystemVersionRecord = {
    id: checkpointRef.id,
    versionLabel: op.fromVersionLabel,
    commitSha: op.fromCommitSha,
    branch: CURRENT_APP_VERSION.environment === 'production' ? 'main' : 'unknown',
    buildId: CURRENT_APP_VERSION.buildId,
    environment: CURRENT_APP_VERSION.environment,
    status: 'ROLLED_BACK',
    health: preHealth.overall,
    lastHealthCheck: preHealth,
    isKnownGood: false,
    checkpointType: 'PRE_ROLLBACK_CHECKPOINT',
    linkedRollbackId: rollbackId,
    createdBy: actor.uid,
    createdByName: actor.email,
    createdAt: new Date().toISOString(),
  };
  await setDoc(checkpointRef, checkpointRecord);

  await updateDoc(ref, {
    status: 'RUNNING' as RollbackStatus,
    startedAt: new Date().toISOString(),
    preRollbackHealthCheck: preHealth,
    checkpointVersionId: checkpointRef.id,
  });
  await logAuditAction('ROLLBACK_STARTED', ROLLBACKS_COLLECTION, rollbackId, `Rollback started: v${op.fromVersionLabel} -> v${op.toVersionLabel}. Checkpoint: ${checkpointRef.id}`);

  const deployResult = await activeDeploymentProvider.deploy({
    commitSha: op.toCommitSha,
    branch: 'main',
    environment: CURRENT_APP_VERSION.environment,
    versionLabel: op.toVersionLabel,
  });

  if (deployResult.requiresManualCompletion) {
    await updateDoc(ref, { deploymentReference: deployResult.deploymentReference || '', failureDetails: deployResult.message });
    return { ...op, status: 'RUNNING', checkpointVersionId: checkpointRef.id, preRollbackHealthCheck: preHealth, failureDetails: deployResult.message };
  }

  if (!deployResult.success) {
    await updateDoc(ref, { status: 'FAILED' as RollbackStatus, completedAt: new Date().toISOString(), failureDetails: deployResult.message });
    await logAuditAction('ROLLBACK_FAILED', ROLLBACKS_COLLECTION, rollbackId, `Deployment failed: ${deployResult.message}`);
    return { ...op, status: 'FAILED', failureDetails: deployResult.message };
  }

  return finalizeRollbackAfterDeployment(rollbackId, deployResult.deploymentReference);
}

/**
 * Called once a human confirms the manual deployment step (from
 * ManualDeploymentProvider) is actually complete - runs the post-rollback
 * health check and finalizes SUCCESS/FAILED. Never silently assumes
 * success (§17 CRITICAL: "A failed rollback must not be reported as
 * successful.").
 */
export async function confirmManualDeploymentComplete(rollbackId: string, deploymentReference?: string): Promise<RollbackOperation> {
  const ref = doc(db, ROLLBACKS_COLLECTION, rollbackId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Rollback operation not found.');
  const op = snap.data() as RollbackOperation;
  if (op.status !== 'RUNNING') throw new Error('This rollback is not awaiting manual deployment confirmation.');

  return finalizeRollbackAfterDeployment(rollbackId, deploymentReference);
}

async function finalizeRollbackAfterDeployment(rollbackId: string, deploymentReference?: string): Promise<RollbackOperation> {
  const ref = doc(db, ROLLBACKS_COLLECTION, rollbackId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Rollback operation not found.');
  const op = { id: snap.id, ...snap.data() } as RollbackOperation;

  const postHealth = await runHealthCheck();
  const finalStatus: RollbackStatus = postHealth.overall === 'HEALTHY' ? 'SUCCESS' : 'FAILED';

  await updateDoc(ref, {
    status: finalStatus,
    completedAt: new Date().toISOString(),
    postRollbackHealthCheck: postHealth,
    deploymentReference: deploymentReference || op.deploymentReference || '',
    failureDetails: finalStatus === 'FAILED' ? 'Post-rollback health check did not report Healthy.' : undefined,
  });

  await logAuditAction(
    finalStatus === 'SUCCESS' ? 'ROLLBACK_COMPLETED' : 'ROLLBACK_FAILED',
    ROLLBACKS_COLLECTION,
    rollbackId,
    finalStatus === 'SUCCESS' ? `Rollback completed successfully: v${op.toVersionLabel} is now active.` : `Rollback FAILED post-deployment health check. Checkpoint ${op.checkpointVersionId} preserved.`
  );

  // §17: reflect the outcome on the target version record too - never
  // silently leave it in an ambiguous state.
  if (op.toVersionId && !op.toVersionId.startsWith('legacy-')) {
    await updateDoc(doc(db, VERSIONS_COLLECTION, op.toVersionId), {
      status: finalStatus === 'SUCCESS' ? 'HEALTHY' : 'FAILED',
      health: postHealth.overall,
      lastHealthCheck: postHealth,
      updatedAt: new Date().toISOString(),
    });
  }

  return { ...op, status: finalStatus, postRollbackHealthCheck: postHealth };
}

export async function getRollbackHistory(): Promise<RollbackOperation[]> {
  const snap = await getDocs(query(collection(db, ROLLBACKS_COLLECTION), orderBy('requestedAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as RollbackOperation));
}

export async function getRollback(rollbackId: string): Promise<RollbackOperation | null> {
  const snap = await getDoc(doc(db, ROLLBACKS_COLLECTION, rollbackId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as RollbackOperation;
}

/**
 * §27: metadata-based comparison, never a duplicate source snapshot. If a
 * public repo URL is configured, also returns a credential-free GitHub
 * compare link (no token needed for a public repo's /compare/ page).
 */
export function compareVersions(a: SystemVersionRecord, b: SystemVersionRecord, repoUrl?: string) {
  const githubCompareUrl = repoUrl && isValidCommitSha(a.commitSha) && isValidCommitSha(b.commitSha) ? `${repoUrl.replace(/\/$/, '')}/compare/${a.commitSha}...${b.commitSha}` : undefined;
  return {
    a,
    b,
    githubCompareUrl,
    fieldDiffs: {
      versionLabel: a.versionLabel !== b.versionLabel,
      commitSha: a.commitSha !== b.commitSha,
      branch: a.branch !== b.branch,
      environment: a.environment !== b.environment,
      buildId: a.buildId !== b.buildId,
    },
  };
}

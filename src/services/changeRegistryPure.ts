/**
 * Change Registry - pure logic (Layer 3 of the release chain).
 *
 * The release chain is:
 *   System Version -> Release ID -> Change IDs -> Commit SHA -> Build ID
 *   -> Deployment ID -> Production
 *
 * Layers 1-2 already exist in systemVersionService.ts (systemVersions +
 * versionRollbacks). This module adds the missing layer: every individual
 * modification gets a bounded, immutable identifier so it can be found later
 * without grepping the whole repository.
 *
 * Deliberately Firebase-free so the rules below are testable under plain tsx.
 * Persistence lives in changeRegistryService.ts.
 *
 * The registry stores REFERENCES and metadata only - never Git diffs and never
 * file contents. Git remains the source of truth for code.
 */

// --- Controlled vocabularies ------------------------------------------------

/** Prefix set is closed on purpose: an open set becomes unsearchable. */
export const CHANGE_PREFIXES = [
  'MOD', 'FIX', 'SEC', 'PERF', 'UI', 'DATA', 'DB', 'AI', 'INFRA', 'CONFIG', 'PERM', 'RLB',
] as const;
export type ChangePrefix = (typeof CHANGE_PREFIXES)[number];

export const CHANGE_TYPES = [
  'FEATURE', 'FIX', 'SECURITY', 'PERFORMANCE', 'UI', 'DATA', 'DATABASE', 'AI', 'INFRA', 'CONFIG', 'PERMISSION',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_STATUSES = [
  'DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'RELEASED', 'ACTIVE', 'INACTIVE', 'ROLLED_BACK', 'DEPRECATED', 'FAILED',
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];

export const CHANGE_RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type ChangeRisk = (typeof CHANGE_RISKS)[number];

export const FIRESTORE_IMPACTS = ['NONE', 'READ', 'WRITE', 'RULES', 'SCHEMA'] as const;
export type FirestoreImpact = (typeof FIRESTORE_IMPACTS)[number];

export const ROLLBACK_METHODS = ['NONE', 'FEATURE_FLAG', 'CODE_REVERT'] as const;
export type RollbackMethod = (typeof ROLLBACK_METHODS)[number];

/** Fixed width keeps IDs sortable, quotable and bounded. 0001-9999. */
export const CHANGE_ID_RE = new RegExp(`^(${CHANGE_PREFIXES.join('|')})-[0-9]{4}$`);
export const RELEASE_ID_RE = /^REL-[0-9]{4}-[0-9]{4}$/;

export function isValidChangeId(id: unknown): id is string {
  return typeof id === 'string' && CHANGE_ID_RE.test(id);
}

export function isValidReleaseId(id: unknown): id is string {
  return typeof id === 'string' && RELEASE_ID_RE.test(id);
}

export function formatChangeId(prefix: ChangePrefix, seq: number): string {
  if (!CHANGE_PREFIXES.includes(prefix)) throw new Error(`unknown change prefix: ${prefix}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 9999) {
    throw new Error(`change sequence out of range (1-9999): ${seq}`);
  }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

export function formatReleaseId(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error(`bad release year: ${year}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 9999) throw new Error(`release sequence out of range: ${seq}`);
  return `REL-${year}-${String(seq).padStart(4, '0')}`;
}

export function parseChangeId(id: string): { prefix: ChangePrefix; seq: number } | null {
  if (!isValidChangeId(id)) return null;
  const [prefix, num] = id.split('-');
  return { prefix: prefix as ChangePrefix, seq: Number(num) };
}

// --- Records ----------------------------------------------------------------

export interface ChangeRecord {
  changeId: string;
  releaseId: string | null;
  version: string;
  title: string;
  type: ChangeType;
  module: string;
  summary: string;
  detailedDescription?: string;
  reason: string;
  status: ChangeStatus;
  risk: ChangeRisk;
  affectedFiles: string[];
  affectedModules: string[];
  affectedPermissions: string[];
  firestoreImpact: FirestoreImpact;
  migrationRequired: boolean;
  tests: string[];
  rollbackSupported: boolean;
  rollbackMethod: RollbackMethod;
  createdAt: string;
  createdBy: string;
  approvedAt?: string | null;
  approvedBy?: string | null;
  deployedAt?: string | null;
  deployedBy?: string | null;
  parentChangeId?: string | null;
  relatedChanges?: string[];
  dependencies?: string[];
  featureFlag?: string | null;
  commitHash?: string | null;
  deploymentId?: string | null;
}

export interface ReleaseRecord {
  releaseId: string;
  version: string;
  commitSha: string;
  previousReleaseId: string | null;
  changeIds: string[];
  modules: string[];
  risk: ChangeRisk;
  rollbackSupported: boolean;
  deployedAt?: string | null;
  deployedBy?: string | null;
  deploymentId?: string | null;
  validation?: Record<string, unknown>;
  treeClean: boolean;
  createdAt: string;
  createdBy: string;
}

// --- Immutability -----------------------------------------------------------

/**
 * Once a change has actually shipped, its historical identity is fixed. Only
 * operational fields may move afterwards - otherwise the registry could be
 * quietly rewritten and the audit value disappears. Deletion is never allowed
 * (enforced again in firestore.rules).
 */
export const FROZEN_STATUSES: ChangeStatus[] = ['RELEASED', 'ACTIVE', 'ROLLED_BACK'];

/** Fields that may still change after a record is frozen. */
export const MUTABLE_AFTER_FREEZE = [
  'status', 'deployedAt', 'deployedBy', 'deploymentId', 'relatedChanges', 'featureFlag',
] as const;

export function isFrozen(status: ChangeStatus): boolean {
  return FROZEN_STATUSES.includes(status);
}

export function assertUpdateAllowed(current: ChangeRecord, patch: Partial<ChangeRecord>): void {
  const keys = Object.keys(patch).filter((k) => k !== 'changeId');
  if (!isFrozen(current.status)) return;
  const illegal = keys.filter((k) => !(MUTABLE_AFTER_FREEZE as readonly string[]).includes(k));
  if (illegal.length) {
    throw new Error(
      `${current.changeId} is ${current.status} - historical identity is immutable. ` +
      `Illegal field(s): ${illegal.join(', ')}. Record a new change instead.`,
    );
  }
}

// --- Status transitions -----------------------------------------------------

const TRANSITIONS: Record<ChangeStatus, ChangeStatus[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'DEPRECATED', 'FAILED'],
  READY_FOR_REVIEW: ['APPROVED', 'DRAFT', 'DEPRECATED', 'FAILED'],
  APPROVED: ['RELEASED', 'READY_FOR_REVIEW', 'FAILED'],
  RELEASED: ['ACTIVE', 'ROLLED_BACK', 'FAILED'],
  ACTIVE: ['INACTIVE', 'ROLLED_BACK', 'DEPRECATED'],
  INACTIVE: ['ACTIVE', 'ROLLED_BACK', 'DEPRECATED'],
  ROLLED_BACK: [],
  DEPRECATED: [],
  FAILED: ['DRAFT'],
};

export function canTransition(from: ChangeStatus, to: ChangeStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: ChangeStatus, to: ChangeStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal status transition ${from} -> ${to}`);
  }
}

/** Only a change with a declared featureFlag can be toggled at runtime. */
export function canRuntimeDisable(change: Pick<ChangeRecord, 'featureFlag' | 'rollbackMethod'>): boolean {
  return !!change.featureFlag && change.rollbackMethod === 'FEATURE_FLAG';
}

// --- Dependencies -----------------------------------------------------------

/**
 * Detects a cycle reachable from `startId`. A circular dependency would make
 * "what must ship before this?" unanswerable, so it is rejected rather than
 * silently accepted.
 */
export function findDependencyCycle(
  startId: string,
  resolve: (id: string) => string[] | undefined,
): string[] | null {
  const stack: string[] = [];
  const onStack = new Set<string>();
  const done = new Set<string>();

  function walk(id: string): string[] | null {
    if (onStack.has(id)) return [...stack.slice(stack.indexOf(id)), id];
    if (done.has(id)) return null;
    onStack.add(id);
    stack.push(id);
    for (const dep of resolve(id) ?? []) {
      const cycle = walk(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    onStack.delete(id);
    done.add(id);
    return null;
  }
  return walk(startId);
}

export function validateDependencies(
  change: Pick<ChangeRecord, 'changeId' | 'dependencies' | 'parentChangeId' | 'relatedChanges'>,
  known: (id: string) => boolean,
): string[] {
  const errors: string[] = [];
  const refs: Array<[string, string[]]> = [
    ['dependencies', change.dependencies ?? []],
    ['relatedChanges', change.relatedChanges ?? []],
    ['parentChangeId', change.parentChangeId ? [change.parentChangeId] : []],
  ];
  for (const [field, ids] of refs) {
    for (const id of ids) {
      if (!isValidChangeId(id)) errors.push(`${field}: "${id}" is not a valid Change ID`);
      else if (id === change.changeId) errors.push(`${field}: a change cannot reference itself`);
      else if (!known(id)) errors.push(`${field}: "${id}" does not exist in the registry`);
    }
  }
  return errors;
}

// --- Record validation ------------------------------------------------------

const REQUIRED_TEXT: Array<keyof ChangeRecord> = ['title', 'summary', 'reason', 'module'];

export function validateChangeRecord(rec: Partial<ChangeRecord>): string[] {
  const errors: string[] = [];
  if (!isValidChangeId(rec.changeId)) errors.push(`changeId "${rec.changeId}" must match ${CHANGE_ID_RE}`);
  if (rec.releaseId != null && !isValidReleaseId(rec.releaseId)) errors.push(`releaseId "${rec.releaseId}" is malformed`);
  if (!rec.type || !CHANGE_TYPES.includes(rec.type)) errors.push(`type must be one of: ${CHANGE_TYPES.join(', ')}`);
  if (!rec.status || !CHANGE_STATUSES.includes(rec.status)) errors.push(`status must be one of: ${CHANGE_STATUSES.join(', ')}`);
  if (!rec.risk || !CHANGE_RISKS.includes(rec.risk)) errors.push(`risk must be one of: ${CHANGE_RISKS.join(', ')}`);
  if (!rec.firestoreImpact || !FIRESTORE_IMPACTS.includes(rec.firestoreImpact)) {
    errors.push(`firestoreImpact must be one of: ${FIRESTORE_IMPACTS.join(', ')}`);
  }
  if (!rec.rollbackMethod || !ROLLBACK_METHODS.includes(rec.rollbackMethod)) {
    errors.push(`rollbackMethod must be one of: ${ROLLBACK_METHODS.join(', ')}`);
  }
  for (const f of REQUIRED_TEXT) {
    if (!rec[f] || String(rec[f]).trim() === '') errors.push(`${f} is required`);
  }
  // A bounded change must say what it touches - that is the whole point.
  if (!Array.isArray(rec.affectedFiles) || rec.affectedFiles.length === 0) {
    errors.push('affectedFiles must list at least one file - a change without a boundary is not reviewable');
  }
  if (!Array.isArray(rec.affectedModules) || rec.affectedModules.length === 0) {
    errors.push('affectedModules must list at least one module');
  }
  if (rec.commitHash != null && !/^[0-9a-f]{7,40}$/i.test(rec.commitHash)) {
    errors.push(`commitHash "${rec.commitHash}" is not a real Git SHA`);
  }
  if (rec.rollbackMethod === 'FEATURE_FLAG' && !rec.featureFlag) {
    errors.push('rollbackMethod FEATURE_FLAG requires a featureFlag name');
  }
  return errors;
}

export function validateReleaseRecord(rec: Partial<ReleaseRecord>): string[] {
  const errors: string[] = [];
  if (!isValidReleaseId(rec.releaseId)) errors.push(`releaseId "${rec.releaseId}" must match REL-YYYY-NNNN`);
  if (!rec.version || !/^\d+\.\d+\.\d+$/.test(rec.version)) errors.push(`version "${rec.version}" must be MAJOR.MINOR.PATCH`);
  if (!rec.commitSha || !/^[0-9a-f]{7,40}$/i.test(rec.commitSha)) errors.push('commitSha must be a real Git SHA');
  if (!Array.isArray(rec.changeIds) || rec.changeIds.length === 0) {
    errors.push('a release must enumerate at least one Change ID');
  } else {
    for (const id of rec.changeIds) if (!isValidChangeId(id)) errors.push(`changeIds: "${id}" is malformed`);
    const dupes = rec.changeIds.filter((id, i) => rec.changeIds!.indexOf(id) !== i);
    if (dupes.length) errors.push(`changeIds contains duplicates: ${[...new Set(dupes)].join(', ')}`);
  }
  return errors;
}

// --- Version numbering ------------------------------------------------------

export type VersionBump = 'MAJOR' | 'MINOR' | 'PATCH';

/**
 * MAJOR - breaking API/data/permission contract, or the database schema version moves.
 * MINOR - a new user-visible, backward-compatible capability.
 * PATCH - fix / performance / UI / config with no new capability.
 */
export function decideBump(changes: Array<Pick<ChangeRecord, 'type' | 'migrationRequired' | 'firestoreImpact'>>): VersionBump {
  if (changes.some((c) => c.migrationRequired || c.firestoreImpact === 'SCHEMA')) return 'MAJOR';
  if (changes.some((c) => c.type === 'FEATURE' || c.type === 'AI')) return 'MINOR';
  return 'PATCH';
}

export function applyBump(version: string, bump: VersionBump): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`version "${version}" is not MAJOR.MINOR.PATCH`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (bump === 'MAJOR') return `${major + 1}.0.0`;
  if (bump === 'MINOR') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// --- Rollback linkage -------------------------------------------------------

/**
 * A rollback never edits or deletes the change it reverses - it is recorded as
 * a NEW RLB change pointing back at the original, so history stays additive.
 */
export function buildRollbackChange(
  original: ChangeRecord,
  rlbId: string,
  opts: { reason: string; createdBy: string; createdAt: string; version: string; commitHash?: string | null },
): ChangeRecord {
  if (!isValidChangeId(rlbId) || !rlbId.startsWith('RLB-')) {
    throw new Error(`rollback id "${rlbId}" must be an RLB-NNNN Change ID`);
  }
  return {
    changeId: rlbId,
    releaseId: null,
    version: opts.version,
    title: `Rollback of ${original.changeId}: ${original.title}`,
    type: original.type,
    module: original.module,
    summary: `Reverses ${original.changeId}.`,
    reason: opts.reason,
    status: 'DRAFT',
    risk: 'HIGH',
    affectedFiles: [...original.affectedFiles],
    affectedModules: [...original.affectedModules],
    affectedPermissions: [...original.affectedPermissions],
    firestoreImpact: original.firestoreImpact,
    migrationRequired: original.migrationRequired,
    tests: [...original.tests],
    rollbackSupported: false,
    rollbackMethod: 'NONE',
    createdAt: opts.createdAt,
    createdBy: opts.createdBy,
    parentChangeId: original.changeId,
    relatedChanges: [original.changeId],
    dependencies: [],
    featureFlag: null,
    commitHash: opts.commitHash ?? null,
    deploymentId: null,
  };
}

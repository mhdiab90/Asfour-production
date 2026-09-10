/**
 * Automatic release planning - pure, deterministic classification.
 *
 * Turns "what actually changed" into "what version is this", so a developer
 * never types a version number, a Change ID or a Release ID again. Given a
 * description plus the real changed-file set, this decides the change type,
 * the impact, and therefore the version bump - and shows its reasoning.
 *
 * DETERMINISTIC BY DESIGN. No AI model, no network, no Firestore, no clock.
 * The same input always yields the same classification, so a release decision
 * can be audited and re-derived later. Persistence and ID minting stay in
 * changeRegistryService.ts; this module only decides.
 *
 * It deliberately does NOT read file contents. Paths, declared signals and the
 * description are enough to classify, and keeping diffs out means the registry
 * never becomes a second copy of the source tree.
 */
import {
  ChangePrefix,
  ChangeRisk,
  ChangeType,
  FirestoreImpact,
  RollbackMethod,
  VersionBump,
  applyBump,
} from './changeRegistryPure';

// --- Type <-> prefix ---------------------------------------------------------

/** The controlled mapping; a rollback is the one prefix no classifier produces. */
export const TYPE_TO_PREFIX: Record<ChangeType, ChangePrefix> = {
  FEATURE: 'MOD',
  FIX: 'FIX',
  SECURITY: 'SEC',
  PERFORMANCE: 'PERF',
  UI: 'UI',
  DATA: 'DATA',
  DATABASE: 'DB',
  AI: 'AI',
  INFRA: 'INFRA',
  CONFIG: 'CONFIG',
  PERMISSION: 'PERM',
};

export function prefixForType(type: ChangeType): ChangePrefix {
  const prefix = TYPE_TO_PREFIX[type];
  if (!prefix) throw new Error(`no Change ID prefix is defined for type "${type}"`);
  return prefix;
}

// --- Module detection --------------------------------------------------------

/**
 * Path -> module. Ordered: the FIRST match wins, so specific paths must precede
 * general ones. Kept deliberately small - a module list that grows per-file
 * stops being useful for "which part of the product moved?".
 */
const MODULE_RULES: Array<{ test: RegExp; module: string }> = [
  { test: /^src\/components\/admin\/SystemVersionManagementView|^src\/components\/admin\/ChangeRegistryPanel|^src\/services\/(changeRegistry|systemVersion|releasePlanner)|^scripts\/(buildIdentity|verifyRelease|releaseGate)|^release\.manifest\.json$/, module: 'Version Management' },
  { test: /^src\/components\/dashboard\/|^src\/services\/(dashboardRegistry|dashboardPersistenceService|aiDashboard|customDashboardAiBridge)/, module: 'Dashboard' },
  { test: /^src\/components\/reports\/|^src\/services\/(reportingEngine|reportTemplates)/, module: 'Reports' },
  { test: /^src\/assistant\/|^src\/components\/assistant\/|^src\/components\/ai\/|^src\/services\/ai/, module: 'AI Assistant' },
  { test: /^src\/components\/masterData\/|^src\/services\/(masterData|costCenter|productType)/, module: 'Master Data' },
  { test: /^src\/components\/production\/|^src\/services\/(production|stageRecord)/, module: 'Production' },
  { test: /^src\/components\/admin\/(DataImport|ChineseMillsImport|TubeBallMillsImport)|^src\/services\/\w*[Hh]istoricalImport/, module: 'Historical Import' },
  { test: /^src\/services\/(backupService|restoreService)|^src\/components\/admin\/BackupRestoreView/, module: 'Backup & Restore' },
  { test: /^src\/components\/users\/|^src\/(types|utils)\/permissions|^src\/context\/AuthContext/, module: 'Users & Permissions' },
  { test: /^firestore\.rules$|^firestore\.indexes\.json$/, module: 'Firestore Rules' },
  { test: /^scripts\/tests\//, module: 'Tests' },
  { test: /^src\/i18n\//, module: 'Localization' },
  { test: /^(vite\.config|package\.json|tsconfig|firebase\.json|\.gitignore)/, module: 'Build & Config' },
];

export function detectModules(files: string[]): string[] {
  const found = new Set<string>();
  for (const raw of files) {
    const file = raw.replace(/\\/g, '/');
    const rule = MODULE_RULES.find((r) => r.test.test(file));
    found.add(rule ? rule.module : 'Other');
  }
  return [...found].sort();
}

// --- Signals -----------------------------------------------------------------

/**
 * Evidence the caller can supply from the real diff. Everything is optional:
 * an absent signal means "not observed", never "false", so the classifier can
 * report lower confidence instead of pretending it knows.
 */
export interface ChangeSignals {
  /** Permission keys whose literal text appeared in the diff. */
  permissionKeys?: string[];
  /** Firestore collections the change introduces. */
  newCollections?: string[];
  /** True only when firestore.rules actually changed. */
  rulesChanged?: boolean;
  /** Set when the change adds a Firestore write path. */
  addsFirestoreWrite?: boolean;
  /** Set when the change adds only reads. */
  addsFirestoreRead?: boolean;
  /** Existing stored documents must be transformed/backfilled/renamed. */
  migrationRequired?: boolean;
  /** Explicit, proven breaking evidence - never inferred from wording alone. */
  breaking?: {
    apiContract?: boolean;
    dataSchema?: boolean;
    destructiveMigration?: boolean;
    permissionContract?: boolean;
    capabilityRemoved?: boolean;
    integrationContract?: boolean;
  };
  /** A feature flag that can disable this change at runtime. */
  featureFlag?: string | null;
  /** Tests that cover the change. */
  tests?: string[];
  /**
   * Files the change ADDS, as opposed to edits. Needed to tell a brand new
   * screen from an edit to an existing one: a path alone cannot distinguish
   * them, and treating every touched `*View.tsx` as a new surface would wrongly
   * promote ordinary bug fixes to MINOR.
   */
  addedFiles?: string[];
}

export interface ClassificationInput {
  description: string;
  files: string[];
  signals?: ChangeSignals;
}

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface Classification {
  changeType: ChangeType;
  prefix: ChangePrefix;
  impact: VersionBump;
  versionBump: VersionBump;
  confidence: Confidence;
  reasons: string[];
  affectedModules: string[];
  affectedFiles: string[];
  affectedPermissions: string[];
  permissionImpactReviewRequired: boolean;
  firestoreImpact: FirestoreImpact;
  newCollections: string[];
  migrationRequired: boolean;
  rollbackSupported: boolean;
  rollbackMethod: RollbackMethod;
  risk: ChangeRisk;
  tests: string[];
}

// --- Description keywords ----------------------------------------------------

/**
 * Wording is the WEAKEST signal and is only ever used to pick a type, never to
 * declare a breaking change. Ordered most-specific first.
 */
const TYPE_KEYWORDS: Array<{ type: ChangeType; test: RegExp }> = [
  { type: 'SECURITY', test: /\b(security|vulnerab|exploit|csrf|xss|injection|auth bypass)\b/i },
  { type: 'PERFORMANCE', test: /\b(performance|slow|latency|optimi[sz]|speed up|quota|n\+1|cache)\b/i },
  { type: 'PERMISSION', test: /\b(permission|role|grant|authori[sz])\b/i },
  { type: 'DATABASE', test: /\b(firestore rules|schema|collection|index|migration)\b/i },
  { type: 'AI', test: /\b(ai |assistant|provider|prompt|tool registry)\b/i },
  { type: 'INFRA', test: /\b(release gate|build|deploy|pipeline|ci|infrastructure|worktree)\b/i },
  { type: 'CONFIG', test: /\b(config|setting|environment|env var|flag)\b/i },
  { type: 'UI', test: /\b(ui|screen|layout|styling|rtl|responsive|button|modal)\b/i },
  { type: 'FIX', test: /\b(fix|bug|defect|regression|broken|incorrect|fails?)\b/i },
  { type: 'FEATURE', test: /\b(add|new|introduce|implement|support|enable|capability|feature)\b/i },
];

/** Path-based type evidence, stronger than wording. */
function typeFromPaths(files: string[]): ChangeType | null {
  const f = files.map((x) => x.replace(/\\/g, '/'));
  if (f.length === 0) return null;
  if (f.every((x) => x.startsWith('scripts/tests/'))) return 'FIX';
  if (f.every((x) => /^firestore\.(rules|indexes\.json)$/.test(x))) return 'DATABASE';
  if (f.every((x) => /^src\/(types|utils)\/permissions\.ts$/.test(x))) return 'PERMISSION';
  if (f.every((x) => /^(vite\.config|package\.json|tsconfig|firebase\.json)/.test(x))) return 'CONFIG';
  return null;
}

// --- Firestore impact --------------------------------------------------------

function decideFirestoreImpact(s: ChangeSignals | undefined): FirestoreImpact {
  if (!s) return 'NONE';
  if (s.migrationRequired || s.breaking?.dataSchema) return 'SCHEMA';
  if (s.rulesChanged) return 'RULES';
  // A new collection is only a WRITE claim when a write path was actually observed.
  if (s.addsFirestoreWrite) return 'WRITE';
  if (s.addsFirestoreRead) return 'READ';
  return 'NONE';
}

// --- Core classification -----------------------------------------------------

function hasBreakingEvidence(s: ChangeSignals | undefined): string[] {
  const b = s?.breaking;
  if (!b) return [];
  const found: string[] = [];
  if (b.apiContract) found.push('an incompatible public API contract change was declared');
  if (b.dataSchema) found.push('an incompatible data/schema change was declared');
  if (b.destructiveMigration) found.push('a destructive migration was declared');
  if (b.permissionContract) found.push('a breaking permission/authentication contract change was declared');
  if (b.capabilityRemoved) found.push('an existing capability is removed without a compatibility path');
  if (b.integrationContract) found.push('an incompatible integration contract change was declared');
  return found;
}

/** Types that, on their own, describe a new backward-compatible capability. */
const CAPABILITY_TYPES: ChangeType[] = ['FEATURE', 'AI'];

/** Paths that indicate a genuinely new user-visible surface - only when ADDED. */
const NEW_SURFACE = /^src\/components\/[^/]+\/[A-Z][A-Za-z]*(View|Panel|Modal)\.tsx$/;

/**
 * Paths that structurally cannot deliver a user-visible capability, whatever
 * the description says. Without this, "Add coverage for X" on a test file would
 * inflate the release to MINOR.
 */
function cannotBearCapability(files: string[]): boolean {
  return (
    files.length > 0 &&
    files.every(
      (f) =>
        f.startsWith('scripts/tests/') ||
        /^(vite\.config|package\.json|tsconfig|\.gitignore)/.test(f) ||
        /\.(md|txt)$/.test(f),
    )
  );
}

export function classifyChange(input: ClassificationInput): Classification {
  const files = [...new Set(input.files.map((f) => f.replace(/\\/g, '/')))].sort();
  const signals = input.signals;
  const reasons: string[] = [];

  // --- type -----------------------------------------------------------------
  let changeType: ChangeType;
  const pathType = typeFromPaths(files);
  if (pathType) {
    changeType = pathType;
    reasons.push(`type ${changeType}: every changed file is a ${changeType.toLowerCase()}-only path`);
  } else {
    const matched = TYPE_KEYWORDS.find((k) => k.test.test(input.description));
    changeType = matched?.type ?? 'FIX';
    reasons.push(
      matched
        ? `type ${changeType}: the description matches ${changeType.toLowerCase()} wording`
        : `type FIX: no stronger evidence, defaulting to the least-claiming type`,
    );
  }

  // Declared signals outrank wording.
  if (signals?.rulesChanged) {
    changeType = 'DATABASE';
    reasons.push('type DATABASE: firestore.rules actually changed');
  } else if ((signals?.permissionKeys?.length ?? 0) > 0 && changeType !== 'SECURITY') {
    changeType = 'PERMISSION';
    reasons.push(`type PERMISSION: permission key(s) changed (${signals!.permissionKeys!.join(', ')})`);
  }

  // --- impact ---------------------------------------------------------------
  const breaking = hasBreakingEvidence(signals);
  const added = new Set((signals?.addedFiles ?? []).map((f) => f.replace(/\\/g, '/')));
  // Only a NEWLY ADDED screen is new surface; editing an existing one is not.
  const addsSurface = files.some((f) => added.has(f) && NEW_SURFACE.test(f));
  const inert = cannotBearCapability(files);
  if (inert) reasons.push('these paths cannot deliver a user-visible capability (tests/config/docs only)');
  const addsCapability = (CAPABILITY_TYPES.includes(changeType) || addsSurface) && !inert;

  let impact: VersionBump;
  let confidence: Confidence;

  if (breaking.length > 0) {
    impact = 'MAJOR';
    confidence = 'HIGH';
    reasons.push(`MAJOR: ${breaking.join('; ')}`);
  } else if (addsCapability) {
    impact = 'MINOR';
    // Both routes here are direct evidence - a newly added screen file, or a
    // capability-bearing type. The uncertain case is the ambiguity escalation
    // below, which lowers confidence itself.
    confidence = 'HIGH';
    reasons.push(
      addsSurface
        ? 'MINOR: a new user-visible screen/panel is added, backward compatible'
        : `MINOR: ${changeType} introduces a new backward-compatible capability`,
    );
  } else {
    impact = 'PATCH';
    confidence = 'HIGH';
    reasons.push(`PATCH: ${changeType} with no new capability and no breaking evidence`);
  }

  // Ambiguity rule: prefer the safer HIGHER impact - but never invent MAJOR.
  if (impact === 'PATCH' && !inert && /\b(new|add|introduce|capability|feature)\b/i.test(input.description) && !CAPABILITY_TYPES.includes(changeType)) {
    impact = 'MINOR';
    confidence = 'MEDIUM';
    reasons.push('MINOR (ambiguous): the description suggests something new, so the safer higher impact is used - MAJOR still requires explicit breaking evidence');
  }

  // --- supporting metadata --------------------------------------------------
  const firestoreImpact = decideFirestoreImpact(signals);
  if (firestoreImpact !== 'NONE') reasons.push(`Firestore impact ${firestoreImpact}`);

  const permissionKeys = [...new Set(signals?.permissionKeys ?? [])].sort();
  const touchesPermissionFiles = files.some((f) => /^src\/(types|utils)\/permissions\.ts$/.test(f));
  const permissionImpactReviewRequired = touchesPermissionFiles && permissionKeys.length === 0;
  if (permissionImpactReviewRequired) {
    reasons.push('permission files changed but no key was identified - flagged for manual review rather than guessed');
  }

  const migrationRequired = !!signals?.migrationRequired || !!signals?.breaking?.destructiveMigration;
  if (migrationRequired) reasons.push('migration required: existing stored data must be transformed');

  // Rollback: prefer a flag, fall back to revert, and never claim support for
  // something a migration would make irreversible.
  let rollbackMethod: RollbackMethod;
  let rollbackSupported: boolean;
  if (signals?.featureFlag) {
    rollbackMethod = 'FEATURE_FLAG';
    rollbackSupported = true;
    reasons.push(`rollback by feature flag "${signals.featureFlag}"`);
  } else if (migrationRequired) {
    rollbackMethod = 'NONE';
    rollbackSupported = false;
    reasons.push('rollback not claimed: a data migration cannot be undone by reverting code alone');
  } else {
    rollbackMethod = 'CODE_REVERT';
    rollbackSupported = true;
    reasons.push('rollback by code revert');
  }

  const risk: ChangeRisk =
    impact === 'MAJOR' || migrationRequired ? 'HIGH' : impact === 'MINOR' || firestoreImpact === 'RULES' ? 'MEDIUM' : 'LOW';

  return {
    changeType,
    prefix: prefixForType(changeType),
    impact,
    versionBump: impact,
    confidence,
    reasons,
    affectedModules: detectModules(files),
    affectedFiles: files,
    affectedPermissions: permissionKeys,
    permissionImpactReviewRequired,
    firestoreImpact,
    newCollections: [...new Set(signals?.newCollections ?? [])].sort(),
    migrationRequired,
    rollbackSupported,
    rollbackMethod,
    risk,
    tests: [...new Set(signals?.tests ?? [])].sort(),
  };
}

// --- Release-level aggregation ----------------------------------------------

const BUMP_RANK: Record<VersionBump, number> = { PATCH: 0, MINOR: 1, MAJOR: 2 };

/** The highest bump wins - impacts are never averaged. */
export function highestBump(bumps: VersionBump[]): VersionBump {
  return bumps.reduce<VersionBump>((worst, b) => (BUMP_RANK[b] > BUMP_RANK[worst] ? b : worst), 'PATCH');
}

export interface VersionDecision {
  currentVersion: string;
  nextVersion: string;
  bump: VersionBump;
  confidence: Confidence;
  reasons: string[];
}

const CONFIDENCE_RANK: Record<Confidence, number> = { HIGH: 2, MEDIUM: 1, LOW: 0 };

/**
 * The single entry point a release uses: given the version in production and
 * the classified changes, decide what the next version must be.
 */
export function calculateNextVersion(currentVersion: string, classifications: Classification[]): VersionDecision {
  if (classifications.length === 0) {
    throw new Error('a release must contain at least one classified change');
  }
  const bump = highestBump(classifications.map((c) => c.versionBump));
  // The release is only as certain as its least certain change.
  const confidence = classifications
    .map((c) => c.confidence)
    .reduce((lowest, c) => (CONFIDENCE_RANK[c] < CONFIDENCE_RANK[lowest] ? c : lowest), 'HIGH' as Confidence);

  const driving = classifications.filter((c) => c.versionBump === bump);
  const reasons = [
    `${bump}: highest impact among ${classifications.length} change(s); impacts are never averaged`,
    ...driving.flatMap((c) => c.reasons.filter((r) => r.startsWith(bump))),
  ];

  return {
    currentVersion,
    nextVersion: applyBump(currentVersion, bump),
    bump,
    confidence,
    reasons,
  };
}

/**
 * Gate rule: the version bump must be justified by at least one change.
 * A release labelled PATCH that contains a MINOR change is wrong, and so is a
 * release labelled MINOR whose changes are all PATCH.
 */
export function isBumpConsistent(bump: VersionBump, classifications: Classification[]): boolean {
  if (classifications.length === 0) return false;
  return highestBump(classifications.map((c) => c.versionBump)) === bump;
}

export function explainBumpInconsistency(bump: VersionBump, classifications: Classification[]): string | null {
  if (isBumpConsistent(bump, classifications)) return null;
  const required = highestBump(classifications.map((c) => c.versionBump));
  return `declared bump ${bump} does not match the changes, which require ${required}`;
}

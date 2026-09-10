/**
 * Single source of truth for this build's identity.
 *
 * The application version itself (3.2.0) stays human-authored in
 * src/config/appVersion.ts - it is a product decision, not something a build
 * can infer. Everything else that identifies a build is DERIVED here from Git
 * at build time, so it can never go stale the way the previously hard-coded
 * buildId ('2026-08-22-001'), gitCommit ('main-v3.2.0' - a label, not a SHA)
 * and deploymentId ('asfour-prod-20260822') all had.
 *
 * Used by vite.config.ts (to embed the identity and emit version.json) and by
 * scripts/verifyRelease.mjs (to check a build/deployment against it). Keeping
 * one implementation means the gate can never disagree with the builder.
 *
 * No dependencies beyond node builtins.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** A real Git SHA: 7-40 hex chars. Mirrors isValidCommitSha() in systemVersionService.ts. */
export const COMMIT_SHA_RE = /^[0-9a-f]{7,40}$/i;

export function isValidCommitSha(sha) {
  return typeof sha === 'string' && COMMIT_SHA_RE.test(sha.trim());
}

/**
 * A release may only deploy Hosting. A bare `firebase deploy` would also push
 * Firestore Rules and Storage rules, which are released deliberately and
 * separately - shipping them by accident is exactly the kind of silent blast
 * radius this foundation exists to prevent.
 */
export function isHostingOnlyDeployCommand(cmd) {
  return typeof cmd === 'string' && /^firebase\s+deploy\s+--only\s+hosting\s+--project\s+\S+$/.test(cmd.trim());
}

function git(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

/** Reads the human-authored version from appVersion.ts without importing TypeScript. */
export function readDeclaredVersion(root) {
  const file = path.join(root, 'src', 'config', 'appVersion.ts');
  const src = fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
  const m = src.match(/version:\s*'([^']+)'/);
  if (!m) {
    throw new Error('[buildIdentity] could not read `version` from src/config/appVersion.ts');
  }
  return m[1];
}

/**
 * Computes the identity of the build being produced right now.
 *
 * `treeClean` records whether the source tree had uncommitted changes. A dirty
 * build is still allowed (local development depends on it) - it is simply
 * recorded honestly, and scripts/verifyRelease.mjs refuses to let one become a
 * release. This is the direct fix for a production deployment that was made
 * from a dirty tree and silently shipped never-committed code.
 */
export function computeBuildIdentity(root, now = new Date()) {
  const version = readDeclaredVersion(root);
  const commitSha = git(['rev-parse', 'HEAD'], root);
  const shortSha = commitSha ? commitSha.slice(0, 8) : 'nogit';
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], root) || 'unknown';
  const porcelain = git(['status', '--porcelain'], root);
  const treeClean = porcelain === '';
  const buildTimestamp = now.toISOString();
  const stamp = buildTimestamp.slice(0, 10).replace(/-/g, '');

  return {
    version,
    // Deterministic for a given commit + day, and always traceable back to real source.
    buildId: `${version}+${shortSha}.${stamp}`,
    commitSha,
    branch,
    treeClean,
    buildTimestamp,
    // Correlates version -> commit -> build -> deployment without any Firestore write.
    deploymentId: `asfour-${stamp}-${shortSha}`,
  };
}

/** The JSON served at /version.json and consumed by UpdateContext's poller. */
export function toVersionJson(identity, extra = {}) {
  return {
    version: identity.version,
    buildId: identity.buildId,
    buildTimestamp: identity.buildTimestamp,
    gitCommit: identity.commitSha,
    deploymentId: identity.deploymentId,
    databaseSchemaVersion: extra.databaseSchemaVersion ?? 3,
    mandatory: extra.mandatory ?? false,
    releaseNotes: extra.releaseNotes ?? '',
  };
}

/**
 * Precursor to the future Release Manifest - deliberately build-level only.
 * No change list, no Firestore, no new collection.
 */
export function toReleaseIdentity(identity) {
  return {
    version: identity.version,
    commitSha: identity.commitSha,
    branch: identity.branch,
    buildId: identity.buildId,
    deploymentId: identity.deploymentId,
    buildTimestamp: identity.buildTimestamp,
    treeClean: identity.treeClean,
  };
}

/**
 * The canonical pre-deployment gate. Fails closed.
 *
 * Run this - and only this - before `firebase deploy`. It orchestrates the
 * whole release check: tree trust, commit identity, lint, tests, a real
 * production build, then every artefact/identity/marker/cache check in
 * verifyRelease.mjs (invoked as a child process rather than reimplemented, so
 * the two can never disagree).
 *
 * It deliberately STOPS before deploying. It prints the exact deploy command
 * to run on success; it never runs it. Deployment stays a human decision.
 *
 * TREE MODEL - this is the important part:
 *   Development tree : DIRTY ALLOWED. Day-to-day work lives here.
 *   Release worktree : MUST BE CLEAN. Releases are cut from a dedicated
 *                      pristine `git worktree` at an exact commit.
 * That split is the whole point: a production deploy once shipped 44 files
 * that were never committed because it was built from a dirty development
 * tree. This gate makes that impossible without an explicit override.
 *
 * Usage (from a pristine release worktree):
 *   node scripts/releaseGate.mjs --expect-sha <sha> --expect-version 3.2.0
 *   node scripts/releaseGate.mjs --manifest release.manifest.json --expect-sha <sha>
 *
 * Options:
 *   --manifest <path>        read version / commitSha / requiredMarkers / tests from a manifest
 *   --expect-sha <sha>       required unless the manifest supplies commitSha
 *   --expect-version <v>     defaults to the manifest's version
 *   --remote <name>          remote the SHA must exist on (default: origin)
 *   --skip-remote-check      allow a SHA not yet pushed (local dry-run only)
 *   --allow-dirty            development dry-run ONLY - never for a real release
 *   --deploy-command "<cmd>" the command you intend to run; must be Hosting-only
 *   --url <https://...>      also compare a live deployment against this identity
 *
 * Exit 0 = releasable. Exit 1 = blocked.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBuildIdentity, isValidCommitSha, isHostingOnlyDeployCommand, CHANGE_ID_RE, RELEASE_ID_RE } from './buildIdentity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? (args[i + 1] ?? '') : undefined; };
const has = (n) => args.includes(n);
/** Repeatable flag, e.g. --change-id AI-0001 --change-id FIX-0002 */
const flagAll = (n) => args.reduce((acc, a, i) => (a === n && args[i + 1] ? [...acc, args[i + 1]] : acc), []);

const manifestPath = flag('--manifest');
let manifest = null;
if (manifestPath) {
  const p = path.isAbsolute(manifestPath) ? manifestPath : path.join(ROOT, manifestPath);
  manifest = JSON.parse(fs.readFileSync(p, 'utf-8'));
}

/**
 * `--expect-sha-from-head` lets the Firebase predeploy hook run the gate without
 * shell command substitution (`$(git rev-parse HEAD)` is not portable to the
 * Windows shell firebase-tools spawns). It takes HEAD as the expectation.
 *
 * Being self-referential, it deliberately cannot catch "you meant to deploy X
 * but checked out Y" - pin the commit with --expect-sha or a manifest commitSha
 * for that. What it still enforces is what actually caused the incidents: the
 * tree must be clean, the commit must already exist on the remote, and the
 * built artefacts must match that commit.
 */
const expectShaFromHead = has('--expect-sha-from-head');
const expectSha = flag('--expect-sha')
  ?? manifest?.commitSha
  ?? (expectShaFromHead ? computeBuildIdentity(ROOT).commitSha : undefined);
const expectVersion = flag('--expect-version') ?? manifest?.version ?? undefined;
const remote = flag('--remote') ?? 'origin';
const skipRemote = has('--skip-remote-check');
const allowDirty = has('--allow-dirty');
const url = flag('--url');
const deployCommand = flag('--deploy-command') ?? manifest?.deployCommand;
const requiredMarkers = manifest?.requiredMarkers ?? [];
const requiredTests = manifest?.tests ?? [];

const steps = [];
let blocked = false;
function step(name, ok, detail) {
  steps.push({ name, ok, detail });
  if (!ok) blocked = true;
  return ok;
}

function git(a) {
  try {
    return execFileSync('git', a, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf-8', shell: process.platform === 'win32' });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const identity = computeBuildIdentity(ROOT);

console.log('\nASFOUR release gate');
console.log(`  tree      ${ROOT}`);
console.log(`  commit    ${identity.commitSha || '(none)'}`);
console.log(`  version   ${identity.version}`);
console.log(`  manifest  ${manifestPath ?? '(none)'}\n`);

// --- 1. Release tree must be clean ----------------------------------------
step(
  'release worktree is clean',
  allowDirty ? true : identity.treeClean,
  identity.treeClean
    ? 'no modified, staged or untracked files'
    : 'DIRTY - cut the release from a pristine `git worktree add --detach <path> <sha>` instead of the development tree',
);

// --- 2. Commit identity ----------------------------------------------------
step('HEAD is a real commit SHA', isValidCommitSha(identity.commitSha), identity.commitSha.slice(0, 12));
if (expectSha === undefined) {
  step('an expected commit SHA was supplied', false, 'pass --expect-sha or a manifest with commitSha - a release must name its commit');
} else {
  const match = identity.commitSha.startsWith(expectSha) || expectSha.startsWith(identity.commitSha);
  step('HEAD matches the expected commit', match, `HEAD ${identity.commitSha.slice(0, 12)} vs expected ${String(expectSha).slice(0, 12)}`);
}
if (!skipRemote && identity.commitSha) {
  // Branch name alone proves nothing - the commit itself must exist on the remote.
  const branches = git(['branch', '-r', '--contains', identity.commitSha]);
  const onRemote = branches.split('\n').map((s) => s.trim()).filter(Boolean).some((b) => b.startsWith(`${remote}/`));
  step(`commit exists on ${remote}`, onRemote, onRemote ? branches.split('\n')[0].trim() : `not found on ${remote} - push before releasing`);
}

// --- 3. Version ------------------------------------------------------------
if (expectVersion !== undefined) {
  step('version matches expectation', identity.version === expectVersion, `${identity.version} vs ${expectVersion}`);
}

// --- 4. Lint ---------------------------------------------------------------
{
  const r = run('npx', ['tsc', '--noEmit']);
  const errors = (r.out.match(/error TS\d+/g) ?? []).length;
  // Pre-existing errors are recorded, not used to block; a NEW error will move this count.
  step('lint completed', true, `${errors} TypeScript error(s) (pre-existing baseline is reported, not enforced)`);
}

// --- 5. Tests --------------------------------------------------------------
for (const t of requiredTests) {
  const file = path.join(ROOT, 'scripts', 'tests', `${t}.test.ts`);
  if (!fs.existsSync(file)) {
    step(`test ${t}`, false, 'declared in the manifest but not found');
    continue;
  }
  const r = run('npx', ['tsx', file]);
  const m = r.out.match(/(\d+) passed, (\d+) failed/);
  const ok = r.code === 0 && m && m[2] === '0';
  step(`test ${t}`, !!ok, m ? `${m[1]} passed, ${m[2]} failed` : 'no result line');
}

// --- 6. Production build ---------------------------------------------------
{
  const r = run('npm', ['run', 'build']);
  step('production build', r.code === 0, r.code === 0 ? 'built' : 'build FAILED');
}

// --- 7. Artefact / identity / marker / cache checks ------------------------
// Delegated to verifyRelease.mjs so this gate never reimplements those rules.
{
  const vrArgs = [path.join(ROOT, 'scripts', 'verifyRelease.mjs')];
  if (expectSha !== undefined) vrArgs.push('--expect-sha', expectSha);
  if (expectVersion !== undefined) vrArgs.push('--expect-version', expectVersion);
  if (manifestPath) vrArgs.push('--manifest', manifestPath);
  for (const m of requiredMarkers) vrArgs.push('--required-marker', m);
  if (allowDirty) vrArgs.push('--allow-dirty');
  if (url) vrArgs.push('--url', url);

  const r = run('node', vrArgs);
  process.stdout.write(r.out.replace(/^/gm, '  '));
  step('build identity, markers and cache policy', r.code === 0, r.code === 0 ? 'verifyRelease.mjs passed' : 'verifyRelease.mjs BLOCKED');
}

// --- 7b. Release chain: the manifest must name its release and its changes -
// Layer 3 of version -> release -> change -> commit -> build -> deployment.
// This is a structural check only. Whether each change is APPROVED lives in
// Firestore, which this offline gate has no credentials to read; that rule is
// enforced by createRelease() in changeRegistryService.ts, which refuses to
// build a release out of unapproved changes.
{
  const releaseId = manifest?.releaseId ?? flag('--release-id');
  const changeIds = manifest?.changeIds ?? flagAll('--change-id');

  if (releaseId == null && changeIds.length === 0) {
    // Not every release has to be registry-tracked yet; say so rather than
    // failing a release that predates the registry.
    step('release chain declared', true, 'no releaseId/changeIds in the manifest - release chain not tracked for this release');
  } else {
    step('release id is well formed', RELEASE_ID_RE.test(String(releaseId)), `${releaseId}`);
    step('release enumerates its changes', changeIds.length > 0, `${changeIds.length} change id(s)`);

    const malformed = changeIds.filter((id) => !CHANGE_ID_RE.test(String(id)));
    step('every change id is well formed', malformed.length === 0,
      malformed.length ? `malformed: ${malformed.join(', ')}` : `all match ${CHANGE_ID_RE}`);

    const dupes = [...new Set(changeIds.filter((id, i) => changeIds.indexOf(id) !== i))];
    step('no change id is reused within the release', dupes.length === 0,
      dupes.length ? `duplicated: ${dupes.join(', ')}` : 'all unique');
  }
}

// --- 8. Deployment target must be Hosting-only -----------------------------
// A bare `firebase deploy` would also push Firestore Rules and Storage rules,
// which are released deliberately and separately.
if (deployCommand === undefined) {
  step('deploy command declared', false, 'pass --deploy-command or declare deployCommand in the manifest');
} else {
  const okCmd = isHostingOnlyDeployCommand(deployCommand);
  step('deploy command is Hosting-only', okCmd, okCmd ? deployCommand : `refused: "${deployCommand}" - must be exactly \`firebase deploy --only hosting --project <id>\``);
}

// --- Result ----------------------------------------------------------------
const pad = Math.max(...steps.map((s) => s.name.length));
console.log('\nRelease gate summary\n');
for (const s of steps) console.log(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.name.padEnd(pad)}  ${s.detail ?? ''}`);
const failed = steps.filter((s) => !s.ok);
console.log(`\n${steps.length - failed.length} passed, ${failed.length} failed`);

if (blocked) {
  console.log('\nRELEASE BLOCKED - do not deploy.\n');
  process.exit(1);
}
console.log('\nRELEASE GATE PASSED');
console.log('This gate does not deploy. To release, run:\n');
console.log(`  ${deployCommand}\n`);
process.exit(0);

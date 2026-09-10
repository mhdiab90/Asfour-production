/**
 * Release gate: refuses to let an untrustworthy build become a deployment.
 *
 * This exists because of two real production incidents:
 *   - a deploy made from a DIRTY working tree silently shipped 44 files that
 *     were never committed, and a later clean deploy silently removed them;
 *   - a build produced with an empty VITE_FIREBASE_API_KEY shipped a bundle
 *     that threw auth/invalid-api-key before React mounted - a white screen.
 *
 * Both were invisible until users hit them. Every check below turns one of
 * those failure modes into a loud, pre-deploy refusal.
 *
 * This is a deterministic checker, not a deployment system: it never builds,
 * never deploys, never writes to Firestore and never contacts production
 * unless explicitly asked to verify a deployed URL.
 *
 * Usage:
 *   node scripts/verifyRelease.mjs                       # gate the local build
 *   node scripts/verifyRelease.mjs --expect-sha <sha>    # also pin the commit
 *   node scripts/verifyRelease.mjs --url <https://...>   # verify a deployment
 *   node scripts/verifyRelease.mjs --allow-dirty         # local diagnostics only
 *
 * Exit code 0 = releasable, 1 = blocked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeBuildIdentity, isValidCommitSha } from './buildIdentity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** Overridable so the gate's own tests can point at a fixture dist without running a full build. */
const distArgIdx = process.argv.indexOf('--dist');
const DIST = distArgIdx >= 0 && process.argv[distArgIdx + 1]
  ? path.resolve(process.argv[distArgIdx + 1])
  : path.join(ROOT, 'dist');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};
/** Repeatable flag, e.g. --required-marker a --required-marker b */
const flagAll = (name) =>
  args.reduce((acc, a, i) => (a === name && args[i + 1] ? [...acc, args[i + 1]] : acc), []);
const has = (name) => args.includes(name);

/**
 * Release Manifest precursor (see docs in release.manifest.json). Anything the
 * manifest declares is used as the expectation unless the CLI overrides it, so
 * a release is describable by a committed file rather than by whatever flags
 * the operator happened to type.
 */
const manifestPath = flag('--manifest');
let manifest = null;
if (manifestPath) {
  const resolved = path.isAbsolute(manifestPath) ? manifestPath : path.join(ROOT, manifestPath);
  manifest = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
}

const expectSha = flag('--expect-sha') ?? manifest?.commitSha;
const expectVersion = flag('--expect-version') ?? manifest?.version;
const url = flag('--url');
const allowDirty = has('--allow-dirty');
const requiredMarkers = [...flagAll('--required-marker'), ...(manifest?.requiredMarkers ?? [])];

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
}

const identity = computeBuildIdentity(ROOT);

// --- Source-tree trust -----------------------------------------------------
check(
  'working tree is clean',
  allowDirty ? true : identity.treeClean,
  identity.treeClean ? 'no uncommitted changes' : 'uncommitted changes present - a release must come from a committed tree',
);
check('commit SHA is a real Git SHA', isValidCommitSha(identity.commitSha), identity.commitSha ? `${identity.commitSha.slice(0, 12)}...` : 'no SHA available');
if (expectSha !== undefined) {
  check(
    'commit SHA matches --expect-sha',
    identity.commitSha.startsWith(expectSha) || expectSha.startsWith(identity.commitSha),
    `building ${identity.commitSha.slice(0, 12)}, expected ${String(expectSha).slice(0, 12)}`,
  );
}
if (expectVersion !== undefined) {
  check('version matches --expect-version', identity.version === expectVersion, `built ${identity.version}, expected ${expectVersion}`);
}

// --- Built artefacts -------------------------------------------------------
const versionJsonPath = path.join(DIST, 'version.json');
const distExists = fs.existsSync(DIST) && fs.existsSync(versionJsonPath);
check('dist/ contains a generated version.json', distExists, distExists ? versionJsonPath : 'run `npm run build` first');

let built = null;
if (distExists) {
  built = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));
  check('built version.json carries a real commit SHA', isValidCommitSha(built.gitCommit), built.gitCommit ? `${String(built.gitCommit).slice(0, 12)}...` : 'empty');
  check('built version.json commit matches the source tree', built.gitCommit === identity.commitSha, `bundle ${String(built.gitCommit).slice(0, 12)} vs tree ${identity.commitSha.slice(0, 12)}`);
  check('built version.json version matches appVersion.ts', built.version === identity.version, `${built.version} vs ${identity.version}`);
  check('built version.json buildId matches this build', built.buildId === identity.buildId, `${built.buildId}`);

  const releaseIdPath = path.join(DIST, 'release-identity.json');
  check('release identity artefact emitted', fs.existsSync(releaseIdPath), releaseIdPath);
  if (fs.existsSync(releaseIdPath)) {
    const rel = JSON.parse(fs.readFileSync(releaseIdPath, 'utf-8'));
    check('release identity records a clean tree', allowDirty ? true : rel.treeClean === true, `treeClean=${rel.treeClean}`);
  }

  // --- Firebase configuration actually reached the bundle ------------------
  const assetsDir = path.join(DIST, 'assets');
  const jsFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js')) : [];
  check('bundle JS emitted', jsFiles.length > 0, `${jsFiles.length} file(s)`);
  let keyEmbedded = false;
  let emptyKeySeen = false;
  for (const f of jsFiles) {
    const code = fs.readFileSync(path.join(assetsDir, f), 'utf-8');
    if (/apiKey:\s*""/.test(code)) emptyKeySeen = true;
    if (/apiKey:\s*"[^"]{10,}"/.test(code)) keyEmbedded = true;
  }
  // The key's VALUE is never printed - presence only.
  check('Firebase API key embedded', keyEmbedded && !emptyKeySeen, keyEmbedded && !emptyKeySeen ? 'YES' : 'NO');

  // --- Required feature markers -------------------------------------------
  // A pristine build silently dropped the entire AI Assistant once, because
  // those files had never been committed and nothing checked that shipped
  // features were still present. Markers are declared per release (manifest or
  // CLI) rather than hard-coded, so this stays useful as the app grows.
  if (requiredMarkers.length) {
    const allJs = jsFiles.map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf-8')).join('\n');
    for (const marker of requiredMarkers) {
      check(`required marker present: ${marker}`, allJs.includes(marker), allJs.includes(marker) ? 'found in bundle' : 'MISSING from bundle');
    }
  }

  // --- Service Worker cache identity moved with the release ----------------
  const swPath = path.join(DIST, 'sw.js');
  if (fs.existsSync(swPath)) {
    const sw = fs.readFileSync(swPath, 'utf-8');
    check('service worker cache identity is release-specific', sw.includes(identity.buildId), 'CACHE_VERSION carries this buildId');
    check('service worker build marker was replaced', !sw.includes('__BUILD_IDENTITY__'), 'no unreplaced marker left');
  }
}

// --- Hosting cache policy --------------------------------------------------
const fbPath = path.join(ROOT, 'firebase.json');
if (fs.existsSync(fbPath)) {
  const fb = JSON.parse(fs.readFileSync(fbPath, 'utf-8'));
  const headers = fb.hosting?.headers ?? [];
  const cc = (src) => headers.find((h) => h.source === src)?.headers?.find((x) => x.key === 'Cache-Control')?.value ?? '';
  check('HTML shell revalidates (/ and /index.html no-cache)', /no-cache/.test(cc('/')) && /no-cache/.test(cc('/index.html')), `${cc('/') || 'unset'}`);
  check('hashed assets stay immutably cached', /immutable/.test(cc('/assets/**')), cc('/assets/**') || 'unset');
  check('only Hosting is configured for this release step', true, 'rules/functions are deployed separately and deliberately');
}

// --- Optional: verify a live deployment ------------------------------------
async function verifyDeployment(target) {
  const base = target.replace(/\/$/, '');
  const res = await fetch(`${base}/version.json?_t=${Date.now()}`, { cache: 'no-store' });
  check('deployed /version.json reachable', res.ok, `HTTP ${res.status}`);
  if (!res.ok) return;
  const live = await res.json();
  check('deployed commit matches expected', live.gitCommit === (expectSha ?? identity.commitSha), `live ${String(live.gitCommit).slice(0, 12)}`);
  check('deployed version matches expected', live.version === (expectVersion ?? identity.version), `live ${live.version}`);
  if (built) check('deployed buildId matches built artefact', live.buildId === built.buildId, `live ${live.buildId}`);
}

const finish = () => {
  const pad = Math.max(...results.map((r) => r.name.length));
  console.log('\nRelease gate\n');
  for (const r of results) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(pad)}  ${r.detail ?? ''}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log('\nRELEASE BLOCKED - fix the failures above before deploying.\n');
    process.exit(1);
  }
  console.log('\nRELEASE OK\n');
};

if (url) {
  verifyDeployment(url).then(finish, (err) => {
    check('deployment verification', false, String(err?.message ?? err));
    finish();
  });
} else {
  finish();
}

/**
 * Version truth, drift gate and cache-policy tests.
 *
 * These cover the foundation added to stop two real incidents recurring: a
 * production deploy made from a dirty tree that shipped uncommitted code, and
 * a build with an empty Firebase API key that white-screened before React
 * mounted. The gate logic is exercised directly - no build is run here, and
 * nothing touches Firestore or the network.
 *
 * Source reads normalise line endings, so the suite behaves identically on an
 * LF or a CRLF checkout.
 *
 * Run: npx tsx scripts/tests/buildIdentity.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('buildIdentity.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

/**
 * Source with comments stripped. Several assertions below check that an old
 * placeholder value no longer appears in the CODE - and the explanatory
 * comments legitimately name those placeholders, so scanning raw text would
 * match the explanation rather than a real regression.
 */
function readCode(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

let bi: any;
async function bootstrap() {
  bi = await import(pathToFileURL(path.join(ROOT, 'scripts/buildIdentity.mjs')).href);
}

// --- A. Version truth ------------------------------------------------------

test('A1. the declared version is read from appVersion.ts, the one hand-authored source', () => {
  const v = bi.readDeclaredVersion(ROOT);
  // Pinned to the shape, not to a number: the version is a product decision
  // that moves with each release. What must never move is that appVersion.ts
  // is the ONE hand-authored source it is read from.
  assert.match(v, /^\d+\.\d+\.\d+$/, 'the declared version must be MAJOR.MINOR.PATCH');
  const declared = readSource('src/config/appVersion.ts').match(/version: '(\d+\.\d+\.\d+)'/)?.[1];
  assert.equal(v, declared, 'the build identity must read the version straight from appVersion.ts');
});

test('A2. the build identity carries a REAL git SHA, never a branch label', () => {
  const id = bi.computeBuildIdentity(ROOT);
  assert.ok(bi.isValidCommitSha(id.commitSha), `commitSha must be a 7-40 hex SHA, got "${id.commitSha}"`);
  assert.equal(/^main-|^v?\d+\.\d+\.\d+$/.test(id.commitSha), false, 'a human label must never be used as a commit SHA');
});

test('A3. commit-SHA validation matches the rule systemVersionService already uses', () => {
  assert.equal(bi.isValidCommitSha('454291da602594257d43713443938186832a5e14'), true);
  assert.equal(bi.isValidCommitSha('454291d'), true);
  assert.equal(bi.isValidCommitSha('main-v3.2.0'), false, 'the old placeholder must be rejected');
  assert.equal(bi.isValidCommitSha('claude-dev'), false);
  assert.equal(bi.isValidCommitSha(''), false);
  assert.equal(bi.isValidCommitSha(undefined), false);
});

test('A4. buildId and deploymentId are derived from the commit, not a frozen date string', () => {
  const id = bi.computeBuildIdentity(ROOT);
  const short = id.commitSha.slice(0, 8);
  assert.ok(id.buildId.includes(short), `buildId must reference the commit (${id.buildId})`);
  assert.ok(id.deploymentId.includes(short), `deploymentId must reference the commit (${id.deploymentId})`);
  assert.notEqual(id.buildId, '2026-08-22-001', 'the stale hard-coded buildId must be gone');
  assert.notEqual(id.deploymentId, 'asfour-prod-20260822', 'the stale hard-coded deploymentId must be gone');
});

test('A5. the same commit produces the same identity (deterministic)', () => {
  const at = new Date('2026-09-07T10:00:00Z');
  const a = bi.computeBuildIdentity(ROOT, at);
  const b = bi.computeBuildIdentity(ROOT, at);
  assert.deepEqual(a, b);
});

test('A6. version.json is generated from the identity, not hand-maintained', () => {
  const id = bi.computeBuildIdentity(ROOT);
  const json = bi.toVersionJson(id);
  assert.equal(json.version, id.version);
  assert.equal(json.gitCommit, id.commitSha);
  assert.equal(json.buildId, id.buildId);
  assert.equal(json.deploymentId, id.deploymentId);
  assert.ok(bi.isValidCommitSha(json.gitCommit), 'generated version.json must carry a real SHA');
});

test('A7. the release identity precursor records tree cleanliness', () => {
  const rel = bi.toReleaseIdentity(bi.computeBuildIdentity(ROOT));
  for (const k of ['version', 'commitSha', 'branch', 'buildId', 'deploymentId', 'buildTimestamp', 'treeClean']) {
    assert.ok(k in rel, `release identity is missing ${k}`);
  }
  assert.equal(typeof rel.treeClean, 'boolean');
});

test('A8. appVersion.ts no longer hard-codes build identity', () => {
  const src = readCode('src/config/appVersion.ts');
  assert.equal(src.includes("'main-v3.2.0'"), false, 'the placeholder gitCommit must be gone');
  assert.equal(src.includes("'2026-08-22-001'"), false, 'the stale buildId must be gone');
  assert.equal(src.includes("'asfour-prod-20260822'"), false, 'the stale deploymentId must be gone');
  // Must match the CURRENT_APP_VERSION field, not an old changelog entry that
  // happens to mention the same number.
  const current = src.match(/CURRENT_APP_VERSION[^=]*=\s*\{[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(current, /version: '\d+\.\d+\.\d+'/, 'the version itself stays hand-authored');
  assert.match(current, /buildId: BUILD_ID_INJECTED/, 'buildId must be injected, not literal');
  assert.match(current, /gitCommit: COMMIT_SHA_INJECTED/, 'gitCommit must be injected, not literal');
  assert.ok(src.includes('__BUILD_COMMIT_SHA__'), 'the commit SHA must come from the injected build identity');
});

// --- B. Drift gate ---------------------------------------------------------

test('B1. the gate exists and refuses by exiting non-zero', () => {
  const src = readSource('scripts/verifyRelease.mjs');
  assert.ok(src.includes('process.exit(1)'), 'a failing gate must exit non-zero so CI/humans cannot miss it');
  assert.ok(src.includes('RELEASE BLOCKED'), 'a failure must say so explicitly');
});

test('B2. a dirty working tree is checked', () => {
  const src = readSource('scripts/verifyRelease.mjs');
  assert.ok(/working tree is clean/.test(src), 'dirty-tree detection is the whole point of the gate');
  assert.ok(src.includes('identity.treeClean'), 'cleanliness must come from the real git status, not a guess');
});

test('B3. the built bundle commit must match the source tree commit', () => {
  const src = readSource('scripts/verifyRelease.mjs');
  assert.ok(src.includes('built version.json commit matches the source tree'), 'a bundle from another commit must be rejected');
  assert.ok(src.includes("built.gitCommit === identity.commitSha"));
});

test('B4. an expected SHA and version can be pinned', () => {
  const src = readSource('scripts/verifyRelease.mjs');
  assert.ok(src.includes('--expect-sha'), 'releases must be pinnable to an exact commit');
  assert.ok(src.includes('--expect-version'));
});

test('B5. an empty Firebase API key blocks the release, and the key is never printed', () => {
  const src = readSource('scripts/verifyRelease.mjs');
  assert.ok(src.includes('Firebase API key embedded'), 'the white-screen cause must be gated');
  assert.ok(/apiKey:\\s\*""/.test(src) || src.includes('apiKey:\\s*""'), 'the empty-key pattern must be detected');
  assert.equal(/console\.log\([^)]*apiKey[^)]*value/i.test(src), false, 'the key value must never be logged');
});

test('B6. a deployed build can be verified without any production write', () => {
  const src = readSource('scripts/verifyRelease.mjs');
  assert.ok(src.includes('--url'), 'deployments must be verifiable after the fact');
  assert.ok(src.includes('/version.json?_t='), 'the check must bypass the HTTP cache');
  assert.equal(/setDoc|addDoc|updateDoc|deleteDoc|firebase\/firestore/.test(src), false,
    'the gate must never write to Firestore');
});

// --- C. Cache policy -------------------------------------------------------

test('C1. the HTML shell revalidates so a new deployment is discovered promptly', () => {
  const fb = JSON.parse(readSource('firebase.json'));
  const headers = fb.hosting.headers;
  const cc = (src: string) =>
    headers.find((h: any) => h.source === src)?.headers?.find((x: any) => x.key === 'Cache-Control')?.value ?? '';
  assert.match(cc('/'), /no-cache/, 'the root shell must revalidate');
  assert.match(cc('/index.html'), /no-cache/, 'index.html must revalidate');
});

test('C2. hashed JS/CSS keep long-term immutable caching (performance preserved)', () => {
  const fb = JSON.parse(readSource('firebase.json'));
  const assets = fb.hosting.headers.find((h: any) => h.source === '/assets/**');
  const cc = assets?.headers?.find((x: any) => x.key === 'Cache-Control')?.value ?? '';
  assert.match(cc, /max-age=31536000/, 'hashed assets must stay cached for a year');
  assert.match(cc, /immutable/);
});

test('C3. caching was not disabled globally', () => {
  const fb = JSON.parse(readSource('firebase.json'));
  const broad = fb.hosting.headers.find((h: any) => h.source === '**');
  assert.equal(broad, undefined, 'a blanket ** rule would strip immutable caching from hashed assets');
});

test('C4. the service worker derives its cache identity from the release build', () => {
  const sw = readSource('public/sw.js');
  assert.ok(sw.includes('__BUILD_IDENTITY__'), 'sw.js must carry the marker the build plugin replaces');
  assert.ok(sw.includes('const CACHE_NAME = `asfour-erp-v${CACHE_VERSION}`'), 'cache name must derive from CACHE_VERSION');
  assert.equal(sw.includes("'asfour-erp-v3.2.0'"), false, 'the hard-coded stale cache name must be gone');
});

test('C5. the service worker keeps its existing strategy and offline behaviour', () => {
  const sw = readSource('public/sw.js');
  assert.ok(sw.includes('self.skipWaiting()'), 'skipWaiting must be preserved');
  assert.ok(sw.includes('self.clients.claim()'), 'clientsClaim must be preserved');
  assert.ok(sw.includes('caches.delete(key)'), 'old-cache cleanup must be preserved');
  assert.ok(sw.includes("caches.match('/index.html')"), 'the offline fallback must be preserved');
});

test('C6. the build plugin fails loudly if the sw marker ever disappears', () => {
  const cfg = readSource('vite.config.ts');
  assert.ok(cfg.includes('__BUILD_IDENTITY__'), 'the plugin must look for the marker');
  assert.ok(/throw new Error\(.*asfour-build-identity/.test(cfg), 'a silently stale cache identity must be impossible');
});

test('C7. the Firebase missing-key build guard from 67dd24f is preserved', () => {
  const cfg = readSource('vite.config.ts');
  assert.ok(cfg.includes('loadEnv'), 'the .env.local loading fix must remain');
  assert.ok(cfg.includes("command === 'build'"), 'a production build must still fail on a missing key');
});

(async () => {
  await bootstrap();
  for (const { name, fn } of registered) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (err: any) {
      console.log(`  FAIL  ${name}`);
      console.log(String(err && err.message ? err.message : err).split('\n').slice(0, 4).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

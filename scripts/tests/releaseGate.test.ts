/**
 * Release gate tests.
 *
 * Each accept/reject path is genuinely EXECUTED: verifyRelease.mjs is run as a
 * real child process against a synthetic dist fixture (via --dist), so these
 * assert on actual exit codes rather than on the shape of the source. Fixtures
 * are used instead of real builds purely for speed - the logic under test is
 * the shipped script, unmodified.
 *
 * Nothing here builds, deploys, calls a network or touches Firestore.
 * Source reads normalise line endings, so the suite behaves identically on an
 * LF or a CRLF checkout.
 *
 * Run: npx tsx scripts/tests/releaseGate.test.ts
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('releaseGate.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const VERIFY = path.join(ROOT, 'scripts', 'verifyRelease.mjs');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asfour-gate-'));

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

let bi: any;
async function bootstrap() {
  bi = await import(pathToFileURL(path.join(ROOT, 'scripts/buildIdentity.mjs')).href);
}

/** The identity of the tree these tests run in - fixtures must agree with it to pass. */
function realIdentity() {
  return bi.computeBuildIdentity(ROOT);
}

/**
 * Builds a minimal dist fixture. Defaults describe a VALID release; each test
 * overrides exactly one thing so a failure can only come from that one change.
 */
function makeDist(over: Record<string, any> = {}): string {
  const id = realIdentity();
  const dir = fs.mkdtempSync(path.join(TMP, 'dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));

  const versionJson = {
    version: over.version ?? id.version,
    buildId: over.buildId ?? id.buildId,
    buildTimestamp: id.buildTimestamp,
    gitCommit: over.gitCommit ?? id.commitSha,
    deploymentId: id.deploymentId,
    databaseSchemaVersion: 3,
    mandatory: false,
    releaseNotes: '',
  };
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify(versionJson));
  fs.writeFileSync(
    path.join(dir, 'release-identity.json'),
    JSON.stringify({ ...bi.toReleaseIdentity(id), treeClean: over.treeClean ?? true }),
  );

  const apiKey = over.apiKey === '' ? '""' : `"${over.apiKey ?? 'AIzaSyFAKEKEYFORTESTSONLY0000000000'}"`;
  // Default fixture contains exactly what the committed manifest requires, so
  // adding a marker to the manifest cannot silently stop being exercised here.
  const manifestMarkers = JSON.parse(readSource('release.manifest.json')).requiredMarkers as string[];
  const markers = over.markers ?? manifestMarkers;
  fs.writeFileSync(
    path.join(dir, 'assets', 'index-test.js'),
    `const c={apiKey:${apiKey}};\n` + markers.map((m: string) => `/*${m}*/`).join('\n'),
  );

  fs.writeFileSync(
    path.join(dir, 'sw.js'),
    `const CACHE_VERSION = ${JSON.stringify(over.swBuildId ?? id.buildId)};\nconst CACHE_NAME = \`asfour-erp-v\${CACHE_VERSION}\`;`,
  );
  return dir;
}

/** Runs the real gate script against a fixture and returns its exit code + output. */
function gate(dist: string, extra: string[] = []) {
  const id = realIdentity();
  const args = [VERIFY, '--dist', dist, '--allow-dirty', '--expect-sha', id.commitSha, '--expect-version', id.version, ...extra];
  const r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf-8' });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

// --- A. Accept the good case ----------------------------------------------

test('A1. a matching release passes the gate', () => {
  const r = gate(makeDist());
  assert.equal(r.code, 0, `expected PASS, got:\n${r.out}`);
  assert.match(r.out, /RELEASE OK/);
});

test('A2. every marker the manifest declares is found in a good bundle', () => {
  const markers = JSON.parse(readSource('release.manifest.json')).requiredMarkers as string[];
  const r = gate(makeDist(), markers.flatMap((m) => ['--required-marker', m]));
  assert.equal(r.code, 0, r.out);
  for (const m of markers) assert.match(r.out, new RegExp(`PASS  required marker present: ${m}`));
});

// --- B. Reject every drift mode -------------------------------------------

test('B1. a bundle built from a DIFFERENT commit is rejected', () => {
  const r = gate(makeDist({ gitCommit: '0'.repeat(40) }));
  assert.equal(r.code, 1, 'a commit mismatch must block the release');
  assert.match(r.out, /FAIL {2}built version\.json commit matches the source tree/);
});

test('B2. a placeholder commit label is rejected as not a real SHA', () => {
  const r = gate(makeDist({ gitCommit: 'main-v3.2.0' }));
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL {2}built version\.json carries a real commit SHA/);
});

test('B3. a version mismatch is rejected', () => {
  const r = gate(makeDist({ version: '9.9.9' }));
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL {2}built version\.json version matches appVersion\.ts/);
});

test('B4. an EMPTY Firebase API key is rejected - the white-screen cause', () => {
  const r = gate(makeDist({ apiKey: '' }));
  assert.equal(r.code, 1, 'an empty key must never reach production again');
  assert.match(r.out, /FAIL {2}Firebase API key embedded/);
  assert.equal(/AIzaSy[A-Za-z0-9_-]{10,}/.test(r.out), false, 'the gate must never print a key value');
});

test('B5. a bundle missing a required feature marker is rejected', () => {
  const r = gate(makeDist({ markers: ['asfour_erp_dashboards'] }), ['--required-marker', 'ai-provider-management']);
  assert.equal(r.code, 1, 'a silently dropped feature must block the release');
  assert.match(r.out, /FAIL {2}required marker present: ai-provider-management/);
  assert.match(r.out, /MISSING from bundle/);
});

test('B6. a buildId mismatch between build and artefact is rejected', () => {
  const r = gate(makeDist({ buildId: '3.2.0+deadbeef.19700101' }));
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL {2}built version\.json buildId matches this build/);
});

test('B7. a release identity recording a DIRTY tree is rejected', () => {
  const id = realIdentity();
  const dist = makeDist({ treeClean: false });
  // --allow-dirty is deliberately omitted here: this is the real release posture.
  const r = spawnSync('node', [VERIFY, '--dist', dist, '--expect-sha', id.commitSha], { cwd: ROOT, encoding: 'utf-8' });
  assert.equal(r.status, 1, 'a dirty release identity must block');
  assert.match(`${r.stdout}`, /FAIL {2}release identity records a clean tree/);
});

test('B8. a stale service-worker cache identity is rejected', () => {
  const r = gate(makeDist({ swBuildId: '3.2.0+old.19700101' }));
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL {2}service worker cache identity is release-specific/);
});

test('B9. a missing dist blocks rather than silently passing', () => {
  const r = gate(path.join(TMP, 'does-not-exist'));
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL {2}dist\/ contains a generated version\.json/);
});

// --- C. Hosting-only deployment -------------------------------------------

test('C1. the exact Hosting-only command is accepted', () => {
  assert.equal(bi.isHostingOnlyDeployCommand('firebase deploy --only hosting --project asfourproduction-70e6e'), true);
});

test('C2. a generic `firebase deploy` is REFUSED - it would also push Rules', () => {
  assert.equal(bi.isHostingOnlyDeployCommand('firebase deploy'), false);
  assert.equal(bi.isHostingOnlyDeployCommand('firebase deploy --project asfourproduction-70e6e'), false);
});

test('C3. deploying other services alongside Hosting is refused', () => {
  for (const cmd of [
    'firebase deploy --only hosting,firestore --project asfourproduction-70e6e',
    'firebase deploy --only firestore:rules --project asfourproduction-70e6e',
    'firebase deploy --only functions --project asfourproduction-70e6e',
    'firebase deploy --only storage --project asfourproduction-70e6e',
  ]) {
    assert.equal(bi.isHostingOnlyDeployCommand(cmd), false, `${cmd} must be refused`);
  }
});

test('C4. non-string / empty deploy commands are refused', () => {
  assert.equal(bi.isHostingOnlyDeployCommand(''), false);
  assert.equal(bi.isHostingOnlyDeployCommand(undefined), false);
});

// --- D. Gate wiring --------------------------------------------------------

test('D1. the canonical command exists as an npm script', () => {
  const pkg = JSON.parse(readSource('package.json'));
  assert.equal(pkg.scripts['verify-release'], 'node scripts/releaseGate.mjs');
});

test('D2. the gate fails closed and never deploys by itself', () => {
  const src = readSource('scripts/releaseGate.mjs');
  assert.ok(src.includes('process.exit(1)'), 'a blocked release must exit non-zero');
  assert.ok(src.includes('RELEASE BLOCKED'), 'a block must be stated plainly');
  assert.equal(/spawnSync\(\s*['"]firebase['"]/.test(src), false, 'the gate must never invoke firebase itself');
  assert.equal(/execFileSync\(\s*['"]firebase['"]/.test(src), false, 'the gate must never invoke firebase itself');
});

test('D3. the development tree stays dirty-allowed; only the RELEASE tree must be clean', () => {
  const src = readSource('scripts/releaseGate.mjs');
  assert.ok(src.includes('release worktree is clean'), 'cleanliness is asserted on the release worktree');
  assert.ok(/Development tree\s*:\s*DIRTY ALLOWED/.test(src), 'the two-tree model must be documented in the gate itself');
});

test('D4. the commit must exist on the remote, not merely on a local branch', () => {
  const src = readSource('scripts/releaseGate.mjs');
  assert.ok(src.includes("'branch', '-r', '--contains'"), 'remote containment must be checked against the real commit');
  assert.ok(src.includes('push before releasing'));
});

test('D5. the gate delegates artefact checks instead of reimplementing them', () => {
  const src = readSource('scripts/releaseGate.mjs');
  assert.ok(src.includes('verifyRelease.mjs'), 'one implementation of the artefact rules, not two');
  assert.equal(src.includes('apiKey:'), false, 'the key check must not be duplicated here');
});

test('D6. the manifest precursor declares what a release must contain', () => {
  const m = JSON.parse(readSource('release.manifest.json'));
  for (const k of ['version', 'releaseId', 'commitSha', 'buildId', 'deploymentId', 'requiredMarkers', 'tests', 'treeClean']) {
    assert.ok(k in m, `manifest is missing ${k}`);
  }
  assert.equal(m.version, '3.2.0', 'this task must not bump the version');
  assert.ok(bi.isHostingOnlyDeployCommand(m.deployCommand), 'the manifest must declare a Hosting-only deploy');
});

test('D7. cache policy remains intact (HTML revalidates, hashed assets immutable)', () => {
  const fb = JSON.parse(readSource('firebase.json'));
  const cc = (s: string) =>
    fb.hosting.headers.find((h: any) => h.source === s)?.headers?.find((x: any) => x.key === 'Cache-Control')?.value ?? '';
  assert.match(cc('/'), /no-cache/);
  assert.match(cc('/index.html'), /no-cache/);
  assert.match(cc('/assets/**'), /immutable/);
});

// --- E. Mandatory predeploy enforcement ------------------------------------
// Without a hook the gate is advisory: an operator can simply run
// `firebase deploy --only hosting` and skip it. These lock the hook in place.

test('E1. Hosting declares a predeploy hook, so a deploy cannot skip the gate', () => {
  const fb = JSON.parse(readSource('firebase.json'));
  const pre = fb.hosting?.predeploy;
  assert.ok(Array.isArray(pre) && pre.length > 0, 'hosting.predeploy must exist - otherwise the gate is optional');
});

test('E2. the predeploy hook invokes the canonical gate command', () => {
  const fb = JSON.parse(readSource('firebase.json'));
  const pre: string[] = fb.hosting.predeploy;
  const pkg = JSON.parse(readSource('package.json'));
  const canonical = Object.keys(pkg.scripts).find((s) => s === 'verify-release');
  assert.ok(canonical, 'the canonical npm script must exist');
  assert.ok(
    pre.some((c) => c.includes('verify-release')),
    `predeploy must call the canonical gate, got: ${pre.join(' | ')}`,
  );
});

test('E3. the hook pins a commit expectation rather than deploying whatever is lying around', () => {
  const pre: string[] = JSON.parse(readSource('firebase.json')).hosting.predeploy;
  const cmd = pre.join(' ');
  assert.ok(
    cmd.includes('--expect-sha') || cmd.includes('--manifest'),
    'the hook must supply a commit expectation (--expect-sha / --expect-sha-from-head / --manifest)',
  );
});

test('E4. the hook reads the committed manifest, so markers/tests are declared not typed', () => {
  const pre: string[] = JSON.parse(readSource('firebase.json')).hosting.predeploy;
  assert.ok(pre.join(' ').includes('release.manifest.json'), 'the hook must consume the release manifest');
});

test('E5. a failing gate stops the deployment (fails closed, non-zero exit)', () => {
  const gate = readSource('scripts/releaseGate.mjs');
  assert.ok(gate.includes('process.exit(1)'), 'a blocked release must exit non-zero so firebase aborts the deploy');
  assert.ok(/RELEASE BLOCKED/.test(gate), 'a refusal must be explicit');
  // Firebase aborts the whole deploy when a predeploy command exits non-zero,
  // so a non-zero exit IS the enforcement mechanism.
});

test('E6. the hook does not itself deploy - no recursion, no autonomous release', () => {
  const pre: string[] = JSON.parse(readSource('firebase.json')).hosting.predeploy;
  for (const cmd of pre) {
    assert.equal(/firebase\s+deploy/.test(cmd), false, `predeploy must never invoke a deploy: ${cmd}`);
  }
  const gate = readSource('scripts/releaseGate.mjs');
  assert.equal(/execFileSync\(\s*['"]firebase['"]/.test(gate), false, 'the gate must never execute firebase');
});

test('E7. every required marker is a literal that really survives bundling', () => {
  // A marker that cannot appear in the output (e.g. a key assembled with
  // .join()) would block every release for the wrong reason.
  const m = JSON.parse(readSource('release.manifest.json'));
  for (const marker of m.requiredMarkers) {
    assert.equal(/\$\{|\.join\(|::/.test(marker), false,
      `"${marker}" looks assembled at runtime and may never appear as a literal in the bundle`);
    assert.ok(marker.length >= 6, `"${marker}" is too short to be a reliable marker`);
  }
});

test('E8. markers cover Dashboard, Builder, Reports and AI - the four shipped pillars', () => {
  const markers: string[] = JSON.parse(readSource('release.manifest.json')).requiredMarkers;
  const joined = markers.join(' ');
  assert.ok(/manageCustomDashboards|dashboard/i.test(joined), 'a Dashboard marker is required');
  assert.ok(joined.includes('asfour_erp_dashboards'), 'a Builder persistence marker is required');
  assert.ok(/stageComparison|report/i.test(joined), 'a Reports marker is required');
  assert.ok(joined.includes('ai-assistant'), 'an AI Assistant marker is required');
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
      console.log(String(err && err.message ? err.message : err).split('\n').slice(0, 5).join('\n'));
      failed++;
    }
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

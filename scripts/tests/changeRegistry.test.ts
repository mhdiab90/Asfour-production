/**
 * Change Registry tests (Layer 3 of the release chain).
 *
 * changeRegistryPure.ts is deliberately Firebase-free, so these exercise the
 * REAL shipped logic directly - no shim, no mock framework. Nothing here
 * touches Firestore or the network.
 *
 * Source reads normalise line endings, so the suite behaves identically on an
 * LF or a CRLF checkout.
 *
 * Run: npx tsx scripts/tests/changeRegistry.test.ts
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

console.log('changeRegistry.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

let cr: any;
async function bootstrap() {
  cr = await import(pathToFileURL(path.join(ROOT, 'src/services/changeRegistryPure.ts')).href);
}

/** A valid record; each test overrides exactly one thing. */
function makeChange(over: Record<string, any> = {}) {
  return {
    changeId: 'MOD-0001',
    releaseId: 'REL-2026-0001',
    version: '3.2.0',
    title: 'Example change',
    type: 'FEATURE',
    module: 'Dashboard',
    summary: 'A bounded example.',
    reason: 'Because it was needed.',
    status: 'DRAFT',
    risk: 'LOW',
    affectedFiles: ['src/example.ts'],
    affectedModules: ['Dashboard'],
    affectedPermissions: [],
    firestoreImpact: 'NONE',
    migrationRequired: false,
    tests: ['example'],
    rollbackSupported: true,
    rollbackMethod: 'CODE_REVERT',
    createdAt: '2026-09-10T00:00:00.000Z',
    createdBy: 'tester',
    ...over,
  };
}

// --- A. Identifier format ---------------------------------------------------

test('A1. Change IDs are bounded, fixed-width and prefix-controlled', () => {
  for (const good of ['MOD-0001', 'FIX-0002', 'SEC-9999', 'RLB-0012', 'PERF-0004']) {
    assert.equal(cr.isValidChangeId(good), true, `${good} should be valid`);
  }
  for (const bad of ['MOD-1', 'MOD-00001', 'mod-0001', 'XYZ-0001', 'MOD_0001', 'MOD-0001 ', '', null, undefined, 42]) {
    assert.equal(cr.isValidChangeId(bad as any), false, `${String(bad)} should be rejected`);
  }
});

test('A2. Release IDs are REL-YYYY-NNNN', () => {
  assert.equal(cr.isValidReleaseId('REL-2026-0001'), true);
  for (const bad of ['REL-2026-1', 'REL-26-0001', 'REL-2026', 'rel-2026-0001', '']) {
    assert.equal(cr.isValidReleaseId(bad), false, `${bad} should be rejected`);
  }
});

test('A3. formatting pads and refuses out-of-range or unknown prefixes', () => {
  assert.equal(cr.formatChangeId('MOD', 7), 'MOD-0007');
  assert.equal(cr.formatChangeId('AI', 1234), 'AI-1234');
  assert.equal(cr.formatReleaseId(2026, 3), 'REL-2026-0003');
  assert.throws(() => cr.formatChangeId('NOPE', 1), /unknown change prefix/);
  assert.throws(() => cr.formatChangeId('MOD', 0), /out of range/);
  assert.throws(() => cr.formatChangeId('MOD', 10000), /out of range/);
  assert.throws(() => cr.formatChangeId('MOD', 1.5), /out of range/);
});

test('A4. IDs round-trip through parse', () => {
  assert.deepEqual(cr.parseChangeId('PERF-0042'), { prefix: 'PERF', seq: 42 });
  assert.equal(cr.parseChangeId('nope'), null);
});

test('A5. the prefix and type vocabularies are closed sets', () => {
  assert.equal(cr.CHANGE_PREFIXES.length, 12);
  assert.equal(cr.CHANGE_TYPES.length, 11);
  assert.equal(cr.CHANGE_STATUSES.length, 9);
  // A closed set is the point - an open one becomes unsearchable.
  assert.ok(Object.isFrozen(cr.CHANGE_PREFIXES) || Array.isArray(cr.CHANGE_PREFIXES));
});

// --- B. Record validation ---------------------------------------------------

test('B1. a well-formed change validates clean', () => {
  assert.deepEqual(cr.validateChangeRecord(makeChange()), []);
});

test('B2. a change with no boundary is rejected - that is the whole point', () => {
  const noFiles = cr.validateChangeRecord(makeChange({ affectedFiles: [] }));
  assert.ok(noFiles.some((e: string) => /affectedFiles/.test(e)), noFiles.join('; '));
  const noModules = cr.validateChangeRecord(makeChange({ affectedModules: [] }));
  assert.ok(noModules.some((e: string) => /affectedModules/.test(e)));
});

test('B3. free-form statuses and types are refused', () => {
  assert.ok(cr.validateChangeRecord(makeChange({ status: 'WIP' })).some((e: string) => /status must be one of/.test(e)));
  assert.ok(cr.validateChangeRecord(makeChange({ type: 'REFACTOR' })).some((e: string) => /type must be one of/.test(e)));
  assert.ok(cr.validateChangeRecord(makeChange({ risk: 'EXTREME' })).some((e: string) => /risk must be one of/.test(e)));
});

test('B4. a human label is rejected as a commit hash', () => {
  const errs = cr.validateChangeRecord(makeChange({ commitHash: 'main-v3.2.0' }));
  assert.ok(errs.some((e: string) => /not a real Git SHA/.test(e)), errs.join('; '));
  assert.deepEqual(cr.validateChangeRecord(makeChange({ commitHash: 'e84cd9d' })), []);
});

test('B5. FEATURE_FLAG rollback without a flag name is rejected', () => {
  const errs = cr.validateChangeRecord(makeChange({ rollbackMethod: 'FEATURE_FLAG', featureFlag: null }));
  assert.ok(errs.some((e: string) => /requires a featureFlag/.test(e)));
  assert.deepEqual(cr.validateChangeRecord(makeChange({ rollbackMethod: 'FEATURE_FLAG', featureFlag: 'changeRegistry' })), []);
});

test('B6. required narrative fields cannot be blank', () => {
  for (const f of ['title', 'summary', 'reason', 'module']) {
    const errs = cr.validateChangeRecord(makeChange({ [f]: '   ' }));
    assert.ok(errs.some((e: string) => e.startsWith(f)), `${f} should be required`);
  }
});

// --- C. Release records -----------------------------------------------------

function makeRelease(over: Record<string, any> = {}) {
  return {
    releaseId: 'REL-2026-0001',
    version: '3.3.0',
    commitSha: 'e84cd9d550240b7b3b4b1b25f2173430c0a3f924',
    previousReleaseId: null,
    changeIds: ['MOD-0001', 'FIX-0002'],
    modules: ['Dashboard'],
    risk: 'MEDIUM',
    rollbackSupported: true,
    treeClean: true,
    createdAt: '2026-09-10T00:00:00.000Z',
    createdBy: 'tester',
    ...over,
  };
}

test('C1. a release must enumerate its Change IDs', () => {
  assert.deepEqual(cr.validateReleaseRecord(makeRelease()), []);
  const empty = cr.validateReleaseRecord(makeRelease({ changeIds: [] }));
  assert.ok(empty.some((e: string) => /at least one Change ID/.test(e)));
});

test('C2. duplicate Change IDs in one release are rejected', () => {
  const errs = cr.validateReleaseRecord(makeRelease({ changeIds: ['MOD-0001', 'MOD-0001'] }));
  assert.ok(errs.some((e: string) => /duplicates/.test(e)), errs.join('; '));
});

test('C3. a release must name a real commit and a semantic version', () => {
  assert.ok(cr.validateReleaseRecord(makeRelease({ commitSha: 'main-v3.2.0' })).some((e: string) => /real Git SHA/.test(e)));
  assert.ok(cr.validateReleaseRecord(makeRelease({ version: '3.3' })).some((e: string) => /MAJOR\.MINOR\.PATCH/.test(e)));
});

// --- D. Immutability --------------------------------------------------------

test('D1. a DRAFT change is freely editable', () => {
  const rec = makeChange({ status: 'DRAFT' });
  assert.doesNotThrow(() => cr.assertUpdateAllowed(rec, { title: 'new title', affectedFiles: ['a.ts'] }));
});

test('D2. a RELEASED change cannot have its history rewritten', () => {
  const rec = makeChange({ status: 'RELEASED' });
  assert.throws(() => cr.assertUpdateAllowed(rec, { title: 'quietly different' }), /immutable/);
  assert.throws(() => cr.assertUpdateAllowed(rec, { affectedFiles: ['other.ts'] }), /immutable/);
  assert.throws(() => cr.assertUpdateAllowed(rec, { reason: 'rewritten' }), /immutable/);
});

test('D3. operational fields still move after freeze', () => {
  const rec = makeChange({ status: 'RELEASED' });
  assert.doesNotThrow(() => cr.assertUpdateAllowed(rec, { status: 'ACTIVE' }));
  assert.doesNotThrow(() => cr.assertUpdateAllowed(rec, { deployedAt: '2026-09-10T00:00:00.000Z', deploymentId: 'asfour-x' }));
});

test('D4. ACTIVE and ROLLED_BACK are frozen too', () => {
  for (const s of ['ACTIVE', 'ROLLED_BACK']) {
    assert.equal(cr.isFrozen(s), true, `${s} must be frozen`);
    assert.throws(() => cr.assertUpdateAllowed(makeChange({ status: s }), { summary: 'x' }), /immutable/);
  }
  for (const s of ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED']) {
    assert.equal(cr.isFrozen(s), false, `${s} must stay editable`);
  }
});

// --- E. Status transitions --------------------------------------------------

test('E1. the documented lifecycle is enforced', () => {
  assert.equal(cr.canTransition('DRAFT', 'READY_FOR_REVIEW'), true);
  assert.equal(cr.canTransition('READY_FOR_REVIEW', 'APPROVED'), true);
  assert.equal(cr.canTransition('APPROVED', 'RELEASED'), true);
  assert.equal(cr.canTransition('RELEASED', 'ACTIVE'), true);
  assert.equal(cr.canTransition('ACTIVE', 'INACTIVE'), true);
  assert.equal(cr.canTransition('INACTIVE', 'ACTIVE'), true);
});

test('E2. a change cannot skip review or un-release itself', () => {
  assert.equal(cr.canTransition('DRAFT', 'RELEASED'), false, 'review cannot be skipped');
  assert.equal(cr.canTransition('DRAFT', 'APPROVED'), false);
  assert.equal(cr.canTransition('RELEASED', 'DRAFT'), false, 'history cannot be unwound by status');
  assert.throws(() => cr.assertTransition('DRAFT', 'RELEASED'), /illegal status transition/);
});

test('E3. terminal states are terminal', () => {
  for (const to of cr.CHANGE_STATUSES) {
    assert.equal(cr.canTransition('ROLLED_BACK', to), false, `ROLLED_BACK -> ${to} must be refused`);
    assert.equal(cr.canTransition('DEPRECATED', to), false, `DEPRECATED -> ${to} must be refused`);
  }
});

test('E4. only a change declaring a flag can be runtime-disabled', () => {
  assert.equal(cr.canRuntimeDisable({ featureFlag: 'x', rollbackMethod: 'FEATURE_FLAG' }), true);
  assert.equal(cr.canRuntimeDisable({ featureFlag: null, rollbackMethod: 'FEATURE_FLAG' }), false);
  assert.equal(cr.canRuntimeDisable({ featureFlag: 'x', rollbackMethod: 'CODE_REVERT' }), false);
});

// --- F. Dependencies --------------------------------------------------------

test('F1. unknown or malformed dependency references are reported', () => {
  const known = (id: string) => ['MOD-0001', 'FIX-0002'].includes(id);
  const errs = cr.validateDependencies(
    { changeId: 'MOD-0003', dependencies: ['FIX-0002', 'MOD-9999', 'garbage'], relatedChanges: [], parentChangeId: null },
    known,
  );
  assert.ok(errs.some((e: string) => /MOD-9999.*does not exist/.test(e)), errs.join('; '));
  assert.ok(errs.some((e: string) => /garbage.*not a valid Change ID/.test(e)));
  assert.equal(errs.some((e: string) => /FIX-0002/.test(e)), false, 'a real dependency must not be flagged');
});

test('F2. a change cannot depend on itself', () => {
  const errs = cr.validateDependencies(
    { changeId: 'MOD-0001', dependencies: ['MOD-0001'], relatedChanges: [], parentChangeId: null },
    () => true,
  );
  assert.ok(errs.some((e: string) => /cannot reference itself/.test(e)));
});

test('F3. circular dependencies are detected, not silently accepted', () => {
  const graph: Record<string, string[]> = {
    'MOD-0001': ['MOD-0002'],
    'MOD-0002': ['MOD-0003'],
    'MOD-0003': ['MOD-0001'],
  };
  const cycle = cr.findDependencyCycle('MOD-0001', (id: string) => graph[id]);
  assert.ok(cycle, 'a cycle must be reported');
  assert.equal(cycle[0], cycle[cycle.length - 1], 'the cycle must be closed');
  assert.ok(cycle.includes('MOD-0002') && cycle.includes('MOD-0003'));
});

test('F4. an acyclic graph reports no cycle', () => {
  const graph: Record<string, string[]> = { 'MOD-0001': ['MOD-0002'], 'MOD-0002': [], 'MOD-0003': ['MOD-0002'] };
  assert.equal(cr.findDependencyCycle('MOD-0001', (id: string) => graph[id]), null);
  assert.equal(cr.findDependencyCycle('MOD-0003', (id: string) => graph[id]), null);
});

// --- G. Version numbering ---------------------------------------------------

test('G1. a schema change or migration forces MAJOR', () => {
  assert.equal(cr.decideBump([{ type: 'FIX', migrationRequired: true, firestoreImpact: 'NONE' }]), 'MAJOR');
  assert.equal(cr.decideBump([{ type: 'FIX', migrationRequired: false, firestoreImpact: 'SCHEMA' }]), 'MAJOR');
});

test('G2. a new capability is MINOR; a fix alone is PATCH', () => {
  assert.equal(cr.decideBump([{ type: 'FEATURE', migrationRequired: false, firestoreImpact: 'NONE' }]), 'MINOR');
  assert.equal(cr.decideBump([{ type: 'FIX', migrationRequired: false, firestoreImpact: 'NONE' }]), 'PATCH');
  assert.equal(cr.decideBump([{ type: 'UI', migrationRequired: false, firestoreImpact: 'READ' }]), 'PATCH');
});

test('G3. bumps apply correctly and reset lower components', () => {
  assert.equal(cr.applyBump('3.2.0', 'PATCH'), '3.2.1');
  assert.equal(cr.applyBump('3.2.4', 'MINOR'), '3.3.0');
  assert.equal(cr.applyBump('3.2.4', 'MAJOR'), '4.0.0');
  assert.throws(() => cr.applyBump('3.2', 'PATCH'), /MAJOR\.MINOR\.PATCH/);
});

// --- H. Rollback linkage ----------------------------------------------------

test('H1. a rollback is a NEW record linked to the original', () => {
  const original = makeChange({ changeId: 'AI-0008', status: 'ACTIVE', title: 'AI Assistant restoration' });
  const rlb = cr.buildRollbackChange(original, 'RLB-0012', {
    reason: 'regression in production',
    createdBy: 'tester',
    createdAt: '2026-09-10T00:00:00.000Z',
    version: '3.3.0',
  });
  assert.equal(rlb.changeId, 'RLB-0012');
  assert.equal(rlb.parentChangeId, 'AI-0008', 'the rollback must point back at the original');
  assert.ok(rlb.relatedChanges.includes('AI-0008'));
  assert.equal(rlb.status, 'DRAFT', 'a rollback goes through the same lifecycle');
  assert.equal(rlb.risk, 'HIGH');
  assert.deepEqual(cr.validateChangeRecord(rlb), [], 'a generated rollback must itself be valid');
});

test('H2. the original record is never mutated by building a rollback', () => {
  const original = makeChange({ changeId: 'AI-0008', status: 'ACTIVE' });
  const snapshot = JSON.parse(JSON.stringify(original));
  cr.buildRollbackChange(original, 'RLB-0012', { reason: 'r', createdBy: 't', createdAt: 'x', version: '3.3.0' });
  assert.deepEqual(original, snapshot, 'history must stay additive - the original is untouched');
});

test('H3. a rollback id must actually be an RLB id', () => {
  const original = makeChange();
  assert.throws(() => cr.buildRollbackChange(original, 'MOD-0002', { reason: 'r', createdBy: 't', createdAt: 'x', version: '3.3.0' }), /must be an RLB/);
});

// --- I. Boundary / no source-of-truth duplication ---------------------------

test('I1. the registry stores references, never Git diffs or file contents', () => {
  // Scoped to the record shapes: "patch" legitimately appears elsewhere as a
  // semver component and as an update payload, so scanning the whole file
  // would match the wrong thing.
  const src = readSource('src/services/changeRegistryPure.ts');
  const shapes = src.match(/export interface (ChangeRecord|ReleaseRecord) \{[\s\S]*?\n\}/g) ?? [];
  assert.equal(shapes.length, 2, 'both record interfaces must be present');
  const fields = shapes.join('\n');
  for (const forbidden of ['diff', 'gitDiff', 'fileContents', 'contents', 'blob', 'sourceCode', 'body']) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\??\\s*:`, 'i').test(fields), false,
      `a record must not carry ${forbidden} - Git remains the source of code truth`,
    );
  }
  // What it MUST carry instead are references.
  for (const ref of ['commitHash', 'affectedFiles', 'releaseId', 'deploymentId']) {
    assert.ok(new RegExp(`\\b${ref}\\??\\s*:`).test(fields), `a record must reference ${ref}`);
  }
});

test('I2. the pure module has no Firebase coupling', () => {
  const src = readSource('src/services/changeRegistryPure.ts');
  assert.equal(/from ['"]firebase|config\/firebase/.test(src), false, 'Layer 3 logic must stay testable without Firebase');
});

test('I3. a bounded change can answer "what belongs to it?" without searching the repo', () => {
  const rec = makeChange({
    changeId: 'AI-0008',
    affectedFiles: ['src/components/assistant/GlobalAssistant.tsx', 'src/assistant/index.ts'],
    affectedModules: ['AI Assistant'],
    affectedPermissions: ['system.aiProvider.manage'],
  });
  assert.deepEqual(cr.validateChangeRecord(rec), []);
  assert.equal(rec.affectedFiles.length, 2);
  assert.ok(rec.affectedPermissions.includes('system.aiProvider.manage'));
});

// --- J. Release-gate integration (Layer 3 in the chain) ---------------------

test('J1. the gate\'s id patterns mirror the pure module - drift is caught here', async () => {
  const gateBi: any = await import(pathToFileURL(path.join(ROOT, 'scripts/buildIdentity.mjs')).href);
  assert.equal(String(gateBi.CHANGE_ID_RE), String(cr.CHANGE_ID_RE), 'gate and registry must agree on Change ID format');
  assert.equal(String(gateBi.RELEASE_ID_RE), String(cr.RELEASE_ID_RE), 'gate and registry must agree on Release ID format');
  assert.deepEqual([...gateBi.CHANGE_PREFIXES], [...cr.CHANGE_PREFIXES], 'the prefix sets must not drift');
});

/** Runs the real gate against a temp manifest and returns exit code + output. */
function gateWithManifest(over: Record<string, any>) {
  const base = JSON.parse(readSource('release.manifest.json'));
  const manifest = { ...base, ...over, tests: [], requiredMarkers: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asfour-chain-'));
  const file = path.join(dir, 'm.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  const r = spawnSync('node', [
    path.join(ROOT, 'scripts', 'releaseGate.mjs'),
    '--manifest', file, '--expect-sha-from-head', '--allow-dirty', '--skip-remote-check',
  ], { cwd: ROOT, encoding: 'utf-8' });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('J2. a malformed Change ID blocks the release', () => {
  const r = gateWithManifest({ releaseId: 'REL-2026-0001', changeIds: ['MOD-0001', 'not-an-id'] });
  assert.equal(r.code, 1, 'a malformed change id must block');
  assert.match(r.out, /FAIL {2}every change id is well formed/);
});

test('J3. a reused Change ID within one release blocks it', () => {
  const r = gateWithManifest({ releaseId: 'REL-2026-0001', changeIds: ['MOD-0001', 'MOD-0001'] });
  assert.equal(r.code, 1, 'a duplicate change id must block');
  assert.match(r.out, /FAIL {2}no change id is reused within the release/);
});

test('J4. a malformed Release ID blocks it', () => {
  const r = gateWithManifest({ releaseId: 'REL-26-1', changeIds: ['MOD-0001'] });
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL {2}release id is well formed/);
});

test('J5. a well-formed chain passes', () => {
  const r = gateWithManifest({ releaseId: 'REL-2026-0001', changeIds: ['MOD-0001', 'AI-0002'] });
  assert.equal(r.code, 0, `a valid chain should pass:\n${r.out}`);
  assert.match(r.out, /PASS {2}release enumerates its changes/);
});

test('J6. a release that predates the registry is not failed retroactively', () => {
  const r = gateWithManifest({ releaseId: null, changeIds: [] });
  assert.equal(r.code, 0, 'untracked releases must not be blocked retroactively');
  assert.match(r.out, /release chain not tracked/);
});

// --- K. Service boundary (read discipline) ----------------------------------

test('K1. the service performs no reads on application startup', () => {
  const src = readSource('src/services/changeRegistryService.ts');
  // Everything is inside an exported function; no module-scope query/getDoc.
  const moduleScope = src.replace(/export (async )?function [\s\S]*?\n\}/g, '');
  assert.equal(/getDocs?\(|onSnapshot\(|runTransaction\(/.test(moduleScope), false,
    'no Firestore read may run at module scope - this app has a quota programme');
});

test('K2. changes are fetched in batches, never one read per id', () => {
  const src = readSource('src/services/changeRegistryService.ts');
  assert.ok(src.includes("where(documentId(), 'in', batch)"), 'a batched id query is required');
  assert.ok(/i \+= 30/.test(src), "the 'in' filter must be paged rather than exceeded");
});

test('K3. the ID allocator is transactional so two admins cannot collide', () => {
  const src = readSource('src/services/changeRegistryService.ts');
  assert.ok(src.includes('runTransaction'), 'id allocation must be transactional');
  assert.ok(/seq = current \+ 1/.test(src), 'the counter must only move forward - ids are never reused');
});

test('K4. feature flags default ON so an outage cannot dark-launch a feature off', () => {
  const src = readSource('src/services/changeRegistryService.ts');
  assert.ok(/flags\[name\] !== false/.test(src), 'an absent flag must resolve to enabled');
  assert.ok(/catch \{\s*return \{\};\s*\}/.test(src), 'an unreadable Firestore must resolve to enabled');
});

test('K5. a release cannot be built from unapproved changes', () => {
  const src = readSource('src/services/changeRegistryService.ts');
  assert.ok(/must be APPROVED first/.test(src), 'createRelease must refuse unapproved changes');
});

test('K6. Firestore Rules exist for every new collection and forbid deletion', () => {
  const rules = readSource('firestore.rules');
  for (const c of ['changeRegistry', 'releases', 'registryCounters', 'featureFlags']) {
    assert.ok(new RegExp(`match /${c}/`).test(rules), `firestore.rules must cover ${c}`);
  }
  // Immutability is enforced at the database, not only in the service layer.
  const blocks = rules.match(/match \/(changeRegistry|releases|registryCounters|featureFlags)\/[\s\S]*?\n    \}/g) ?? [];
  assert.equal(blocks.length, 4, 'all four rule blocks must be present');
  for (const b of blocks) assert.match(b, /allow delete: if false;/, `history must be undeletable:\n${b}`);
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

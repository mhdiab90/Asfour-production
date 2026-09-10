/**
 * Automatic release planning tests.
 *
 * releasePlannerPure.ts is deliberately Firebase-free and deterministic, so
 * these exercise the REAL shipped classifier directly - no shim, no mocks,
 * no network, no Firestore.
 *
 * The point of the engine is that a developer never types a version, a Change
 * ID or a Release ID. These tests prove the machine decides, and that it
 * refuses to invent a MAJOR bump without real evidence.
 *
 * Source reads normalise line endings, so the suite behaves identically on an
 * LF or a CRLF checkout.
 *
 * Run: npx tsx scripts/tests/releasePlanner.test.ts
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

console.log('releasePlanner.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

let rp: any;
let cr: any;
async function bootstrap() {
  rp = await import(pathToFileURL(path.join(ROOT, 'src/services/releasePlannerPure.ts')).href);
  cr = await import(pathToFileURL(path.join(ROOT, 'src/services/changeRegistryPure.ts')).href);
}

const CURRENT = '3.3.0';

// --- A. The six required classification cases -------------------------------

test('A1. Case 1 - a bug fix is PATCH: 3.3.0 -> 3.3.1', () => {
  const c = rp.classifyChange({
    description: 'Fix incorrect total shown on the production summary',
    files: ['src/components/production/ProductionRecordsView.tsx'],
  });
  assert.equal(c.changeType, 'FIX');
  assert.equal(c.versionBump, 'PATCH');
  const d = rp.calculateNextVersion(CURRENT, [c]);
  assert.equal(d.nextVersion, '3.3.1');
  assert.equal(d.bump, 'PATCH');
});

test('A2. Case 2 - a new user-visible feature is MINOR: 3.3.0 -> 3.4.0', () => {
  const c = rp.classifyChange({
    description: 'Add a new automatic release planner screen for administrators',
    files: ['src/components/admin/ReleasePlannerPanel.tsx'],
  });
  assert.equal(c.versionBump, 'MINOR');
  const d = rp.calculateNextVersion(CURRENT, [c]);
  assert.equal(d.nextVersion, '3.4.0');
});

test('A3. Case 3 - proven breaking evidence is MAJOR: 3.3.0 -> 4.0.0', () => {
  const c = rp.classifyChange({
    description: 'Change the stored record shape',
    files: ['src/types/index.ts'],
    signals: { breaking: { dataSchema: true } },
  });
  assert.equal(c.versionBump, 'MAJOR');
  const d = rp.calculateNextVersion(CURRENT, [c]);
  assert.equal(d.nextVersion, '4.0.0');
  assert.ok(d.reasons.some((r: string) => /incompatible data\/schema/.test(r)));
});

test('A4. Case 4 - FIX + FEATURE is MINOR, never averaged', () => {
  const fix = rp.classifyChange({ description: 'Fix a broken total', files: ['src/services/reportingEngine.ts'] });
  const feat = rp.classifyChange({ description: 'Add a new export capability', files: ['src/components/reports/ExportPanel.tsx'] });
  assert.equal(fix.versionBump, 'PATCH');
  assert.equal(feat.versionBump, 'MINOR');
  const d = rp.calculateNextVersion(CURRENT, [fix, feat]);
  assert.equal(d.bump, 'MINOR');
  assert.equal(d.nextVersion, '3.4.0');
});

test('A5. Case 5 - FEATURE + BREAKING is MAJOR', () => {
  const feat = rp.classifyChange({ description: 'Add a new capability', files: ['src/components/admin/NewThingView.tsx'] });
  const breaking = rp.classifyChange({
    description: 'Replace the integration contract',
    files: ['src/services/exportService.ts'],
    signals: { breaking: { integrationContract: true } },
  });
  const d = rp.calculateNextVersion(CURRENT, [feat, breaking]);
  assert.equal(d.bump, 'MAJOR');
  assert.equal(d.nextVersion, '4.0.0');
});

test('A6. Case 6 - a tests-only change is PATCH', () => {
  const c = rp.classifyChange({
    description: 'Add coverage for the release gate',
    files: ['scripts/tests/releaseGate.test.ts', 'scripts/tests/buildIdentity.test.ts'],
  });
  assert.equal(c.versionBump, 'PATCH', 'tests alone add no user-visible capability');
  assert.deepEqual(c.affectedModules, ['Tests']);
  assert.equal(rp.calculateNextVersion(CURRENT, [c]).nextVersion, '3.3.1');
});

test('A7. multiple PATCH changes stay PATCH', () => {
  const a = rp.classifyChange({ description: 'Fix a typo in a label', files: ['src/components/production/SortingEntryForm.tsx'] });
  const b = rp.classifyChange({ description: 'Fix a broken date filter', files: ['src/services/productionService.ts'] });
  assert.equal(rp.calculateNextVersion(CURRENT, [a, b]).bump, 'PATCH');
});

test('A8. a NEWLY ADDED screen is new surface; editing an existing one is not', () => {
  const file = 'src/components/admin/SomeView.tsx';
  // Added -> a genuinely new user-visible surface.
  const addedNew = rp.classifyChange({
    description: 'Provide the administrator with this screen',
    files: [file],
    signals: { addedFiles: [file] },
  });
  assert.equal(addedNew.versionBump, 'MINOR');
  assert.equal(addedNew.confidence, 'HIGH');

  // Edited -> a bug fix in an existing screen must stay PATCH. A path alone
  // cannot tell these apart, which is why addedFiles exists.
  const edited = rp.classifyChange({
    description: 'Correct a wrong label on this screen',
    files: [file],
  });
  assert.equal(edited.versionBump, 'PATCH', 'editing an existing screen is not a new capability');
});

test('A9. a tests-only change is never escalated by capability wording', () => {
  const c = rp.classifyChange({
    description: 'Add a new feature test to introduce coverage for the new capability',
    files: ['scripts/tests/x.test.ts'],
  });
  assert.equal(c.versionBump, 'PATCH', 'wording cannot make a test file user-visible');
  assert.ok(c.reasons.some((r: string) => /cannot deliver a user-visible capability/.test(r)));
});

// --- B. MAJOR requires evidence, never wording ------------------------------

test('B1. dramatic wording alone never produces MAJOR', () => {
  for (const description of [
    'BREAKING CHANGE: completely rewrite everything',
    'major overhaul of the entire system',
    'incompatible redesign',
  ]) {
    const c = rp.classifyChange({ description, files: ['src/services/reportingEngine.ts'] });
    assert.notEqual(c.versionBump, 'MAJOR', `"${description}" must not be MAJOR without real evidence`);
  }
});

test('B2. each declared breaking signal independently produces MAJOR', () => {
  for (const key of ['apiContract', 'dataSchema', 'destructiveMigration', 'permissionContract', 'capabilityRemoved', 'integrationContract']) {
    const c = rp.classifyChange({
      description: 'a change',
      files: ['src/services/x.ts'],
      signals: { breaking: { [key]: true } },
    });
    assert.equal(c.versionBump, 'MAJOR', `${key} must force MAJOR`);
    assert.equal(c.risk, 'HIGH');
  }
});

test('B3. ambiguity escalates to MINOR, never to MAJOR', () => {
  const c = rp.classifyChange({
    description: 'Introduce a new option on the settings screen',
    files: ['src/services/settingsService.ts'],
  });
  assert.equal(c.versionBump, 'MINOR');
  assert.equal(c.confidence, 'MEDIUM', 'an ambiguous call must not claim HIGH confidence');
  assert.ok(c.reasons.some((r: string) => /ambiguous/i.test(r)), 'the ambiguity must be stated');
});

test('B4. every classification explains itself', () => {
  const c = rp.classifyChange({ description: 'Fix a bug', files: ['src/services/x.ts'] });
  assert.ok(Array.isArray(c.reasons) && c.reasons.length > 0, 'reasons are required for auditability');
  assert.ok(['HIGH', 'MEDIUM', 'LOW'].includes(c.confidence));
});

// --- C. Type -> prefix ------------------------------------------------------

test('C1. every change type maps to its controlled prefix', () => {
  const expected: Record<string, string> = {
    FEATURE: 'MOD', FIX: 'FIX', SECURITY: 'SEC', PERFORMANCE: 'PERF', UI: 'UI',
    DATA: 'DATA', DATABASE: 'DB', AI: 'AI', INFRA: 'INFRA', CONFIG: 'CONFIG', PERMISSION: 'PERM',
  };
  for (const [type, prefix] of Object.entries(expected)) {
    assert.equal(rp.prefixForType(type), prefix, `${type} must map to ${prefix}`);
  }
  // Every registry type is covered - a new type cannot silently lack a prefix.
  for (const type of cr.CHANGE_TYPES) {
    assert.ok(rp.TYPE_TO_PREFIX[type], `type ${type} has no prefix mapping`);
  }
});

test('C2. RLB is reserved for rollbacks and is never produced by classification', () => {
  assert.equal(Object.values(rp.TYPE_TO_PREFIX).includes('RLB'), false, 'no change type may classify as a rollback');
  assert.ok(cr.CHANGE_PREFIXES.includes('RLB'), 'RLB still exists for rollback records');
});

// --- D. Module detection ----------------------------------------------------

test('D1. modules come from real repository paths', () => {
  const cases: Array<[string, string]> = [
    ['src/components/dashboard/DashboardView.tsx', 'Dashboard'],
    ['src/components/reports/ReportsView.tsx', 'Reports'],
    ['src/components/assistant/GlobalAssistant.tsx', 'AI Assistant'],
    ['src/components/admin/SystemVersionManagementView.tsx', 'Version Management'],
    ['src/services/masterDataService.ts', 'Master Data'],
    ['firestore.rules', 'Firestore Rules'],
    ['scripts/tests/x.test.ts', 'Tests'],
  ];
  for (const [file, module] of cases) {
    assert.deepEqual(rp.detectModules([file]), [module], `${file} should map to ${module}`);
  }
});

test('D2. an unknown path is reported as Other rather than guessed', () => {
  assert.deepEqual(rp.detectModules(['src/something/totally/new.ts']), ['Other']);
});

test('D3. module detection is order-stable and de-duplicated', () => {
  const a = rp.detectModules(['src/components/dashboard/A.tsx', 'src/components/dashboard/B.tsx', 'src/components/reports/C.tsx']);
  assert.deepEqual(a, ['Dashboard', 'Reports']);
});

test('D4. Windows-style separators are handled', () => {
  assert.deepEqual(rp.detectModules(['src\\components\\reports\\ReportsView.tsx']), ['Reports']);
});

// --- E. Permission / Firestore / migration detection ------------------------

test('E1. permission keys are recorded from evidence, not guessed from filenames', () => {
  const withKeys = rp.classifyChange({
    description: 'Grant version management',
    files: ['src/types/permissions.ts'],
    signals: { permissionKeys: ['system.version.manage'] },
  });
  assert.deepEqual(withKeys.affectedPermissions, ['system.version.manage']);
  assert.equal(withKeys.permissionImpactReviewRequired, false);

  const withoutKeys = rp.classifyChange({ description: 'Touch permissions', files: ['src/utils/permissions.ts'] });
  assert.deepEqual(withoutKeys.affectedPermissions, [], 'no key may be invented');
  assert.equal(withoutKeys.permissionImpactReviewRequired, true, 'uncertainty must be flagged for review');
});

test('E2. Firestore impact follows real evidence, not an import', () => {
  const base = { description: 'x', files: ['src/services/x.ts'] };
  assert.equal(rp.classifyChange(base).firestoreImpact, 'NONE');
  assert.equal(rp.classifyChange({ ...base, signals: { addsFirestoreRead: true } }).firestoreImpact, 'READ');
  assert.equal(rp.classifyChange({ ...base, signals: { addsFirestoreWrite: true } }).firestoreImpact, 'WRITE');
  assert.equal(rp.classifyChange({ ...base, signals: { rulesChanged: true } }).firestoreImpact, 'RULES');
  assert.equal(rp.classifyChange({ ...base, signals: { migrationRequired: true } }).firestoreImpact, 'SCHEMA');
});

test('E3. a new collection alone does not claim a write', () => {
  const c = rp.classifyChange({
    description: 'Introduce a registry collection',
    files: ['src/services/x.ts'],
    signals: { newCollections: ['changeRegistry'] },
  });
  assert.equal(c.firestoreImpact, 'NONE', 'declaring a collection is not evidence of a write path');
  assert.deepEqual(c.newCollections, ['changeRegistry']);
});

test('E4. a migration is recorded and blocks a rollback claim', () => {
  const c = rp.classifyChange({
    description: 'Backfill stored records',
    files: ['src/services/x.ts'],
    signals: { migrationRequired: true },
  });
  assert.equal(c.migrationRequired, true);
  assert.equal(c.rollbackSupported, false, 'code revert cannot undo a data migration');
  assert.equal(c.rollbackMethod, 'NONE');
  assert.equal(c.risk, 'HIGH');
});

test('E5. a declared feature flag is preferred for rollback', () => {
  const c = rp.classifyChange({
    description: 'Add a capability',
    files: ['src/components/admin/XView.tsx'],
    signals: { featureFlag: 'automaticReleasePlanner' },
  });
  assert.equal(c.rollbackMethod, 'FEATURE_FLAG');
  assert.equal(c.rollbackSupported, true);
});

// --- F. Version arithmetic --------------------------------------------------

test('F1. bumps apply correctly from any starting version', () => {
  assert.equal(cr.applyBump('3.3.0', 'PATCH'), '3.3.1');
  assert.equal(cr.applyBump('3.3.1', 'MINOR'), '3.4.0');
  assert.equal(cr.applyBump('3.4.0', 'MAJOR'), '4.0.0');
});

test('F2. the engine reads the current version, it never hard-codes one', () => {
  const c = rp.classifyChange({ description: 'Add a capability', files: ['src/components/admin/XView.tsx'] });
  assert.equal(rp.calculateNextVersion('1.0.0', [c]).nextVersion, '1.1.0');
  assert.equal(rp.calculateNextVersion('9.9.9', [c]).nextVersion, '9.10.0');
  // A hard-coded target version would break these.
  const src = readSource('src/services/releasePlannerPure.ts');
  assert.equal(/['"]3\.4\.0['"]/.test(src), false, 'the engine must not contain a special-cased target version');
});

test('F3. a release with no changes is refused rather than silently versioned', () => {
  assert.throws(() => rp.calculateNextVersion('3.3.0', []), /at least one classified change/);
});

test('F4. release confidence is the lowest of its changes', () => {
  const high = rp.classifyChange({ description: 'Fix a bug', files: ['src/services/x.ts'] });
  // Ambiguous: a CONFIG-typed change whose wording hints at something new, so
  // the classifier escalates to MINOR but lowers its own confidence.
  const medium = rp.classifyChange({
    description: 'Introduce a new option on the settings screen',
    files: ['src/services/settingsService.ts'],
  });
  assert.equal(high.confidence, 'HIGH');
  assert.equal(medium.confidence, 'MEDIUM', 'the ambiguous escalation must lower confidence');
  assert.equal(rp.calculateNextVersion(CURRENT, [high, medium]).confidence, 'MEDIUM');
});

// --- G. Gate consistency ----------------------------------------------------

test('G1. a declared bump must match what the changes require', () => {
  const patch = rp.classifyChange({ description: 'Fix a bug', files: ['src/services/x.ts'] });
  const minor = rp.classifyChange({ description: 'Add a capability', files: ['src/components/admin/XView.tsx'] });

  assert.equal(rp.isBumpConsistent('PATCH', [patch]), true);
  assert.equal(rp.isBumpConsistent('MINOR', [patch]), false, 'MINOR is not justified by a PATCH-only release');
  assert.equal(rp.isBumpConsistent('PATCH', [minor]), false, 'a MINOR change cannot ship as a PATCH');
  assert.equal(rp.isBumpConsistent('MINOR', [patch, minor]), true, 'one MINOR change justifies a MINOR release');
});

test('G2. an inconsistent bump explains itself', () => {
  const minor = rp.classifyChange({ description: 'Add a capability', files: ['src/components/admin/XView.tsx'] });
  const msg = rp.explainBumpInconsistency('PATCH', [minor]);
  assert.match(msg, /declared bump PATCH does not match/);
  assert.match(msg, /require MINOR/);
  assert.equal(rp.explainBumpInconsistency('MINOR', [minor]), null);
});

test('G3. highestBump never averages', () => {
  assert.equal(rp.highestBump(['PATCH', 'PATCH']), 'PATCH');
  assert.equal(rp.highestBump(['PATCH', 'MINOR']), 'MINOR');
  assert.equal(rp.highestBump(['PATCH', 'MINOR', 'MAJOR']), 'MAJOR');
  assert.equal(rp.highestBump(['MAJOR', 'PATCH']), 'MAJOR');
});

// --- H. Determinism and boundaries ------------------------------------------

test('H1. classification is deterministic - no clock, no randomness, no network', () => {
  const input = {
    description: 'Add a new administrative capability',
    files: ['src/components/admin/XView.tsx', 'src/services/x.ts'],
    signals: { permissionKeys: ['system.version.manage'], tests: ['releasePlanner'] },
  };
  assert.deepEqual(rp.classifyChange(input), rp.classifyChange(input));

  const src = readSource('src/services/releasePlannerPure.ts');
  for (const forbidden of ['Math.random', 'Date.now', 'new Date(', 'fetch(']) {
    assert.equal(src.includes(forbidden), false, `a deterministic classifier must not use ${forbidden}`);
  }
});

test('H2. the engine has no Firebase or AI coupling', () => {
  const src = readSource('src/services/releasePlannerPure.ts');
  assert.equal(/from ['"]firebase|config\/firebase/.test(src), false, 'classification must be testable without Firebase');
  assert.equal(/anthropic|openai|gemini|callProvider/i.test(src), false, 'release classification must never depend on an AI model');
});

test('H3. the classification captures a bounded package, never source content', () => {
  const c = rp.classifyChange({
    description: 'Add a capability',
    files: ['src/components/admin/XView.tsx'],
    signals: { tests: ['releasePlanner'] },
  });
  for (const k of ['affectedFiles', 'affectedModules', 'affectedPermissions', 'firestoreImpact', 'migrationRequired', 'tests', 'rollbackSupported', 'rollbackMethod']) {
    assert.ok(k in c, `a bounded package must include ${k}`);
  }
  const src = readSource('src/services/releasePlannerPure.ts');
  for (const forbidden of ['diff', 'blob', 'fileContents', 'sourceCode']) {
    assert.equal(new RegExp(`\\b${forbidden}\\??\\s*:`, 'i').test(src), false, `the package must not carry ${forbidden}`);
  }
});

// --- I. Release gate integration --------------------------------------------

/** Runs the real gate against a temp manifest and returns exit code + output. */
function gateWith(over: Record<string, any>) {
  const base = JSON.parse(readSource('release.manifest.json'));
  const manifest = { ...base, ...over, tests: [], requiredMarkers: [] };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asfour-plan-'));
  const file = path.join(dir, 'm.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  const r = spawnSync('node', [
    path.join(ROOT, 'scripts', 'releaseGate.mjs'),
    '--manifest', file, '--expect-sha-from-head', '--allow-dirty', '--skip-remote-check',
  ], { cwd: ROOT, encoding: 'utf-8' });
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

test('I1. the committed manifest is internally consistent', () => {
  const m = JSON.parse(readSource('release.manifest.json'));
  assert.equal(cr.applyBump(m.previousVersion, m.versionBump), m.version,
    `${m.previousVersion} + ${m.versionBump} must equal ${m.version}`);
});

test('I2. a release that under-states its bump is BLOCKED', () => {
  // A MINOR release relabelled PATCH - the exact mislabelling the gate exists for.
  const r = gateWith({ versionBump: 'PATCH' });
  assert.equal(r.code, 1, 'a mislabelled bump must block the release');
  assert.match(r.out, /FAIL {2}declared version matches the classified bump/);
});

test('I3. a release that over-states its bump is BLOCKED', () => {
  const r = gateWith({ versionBump: 'MAJOR' });
  assert.equal(r.code, 1, 'an inflated bump must block too - the version must be earned');
  assert.match(r.out, /FAIL {2}declared version matches the classified bump/);
});

test('I4. a hand-edited version that skips the classifier is BLOCKED', () => {
  const r = gateWith({ version: '9.9.9' });
  assert.equal(r.code, 1, 'nobody may type a version past the classifier');
});

test('I5. a release predating classification is not failed retroactively', () => {
  const r = gateWith({ previousVersion: undefined, versionBump: undefined });
  assert.match(r.out, /not classification-tracked for this release/);
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

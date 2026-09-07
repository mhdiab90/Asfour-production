/**
 * Phase 4D - Restore Preview / System Diagnostics read-optimization tests.
 *
 * restoreService.ts and systemTestService.ts are tightly coupled to the
 * real Firebase SDK (same established convention as every other Firestore
 * service in this codebase - no mocking framework exists here), so this
 * phase is verified by direct source inspection: exact string/regex
 * checks against the committed source confirm getCountFromServer() (not
 * getDocs()) is used for the two count-only read paths identified by the
 * Phase 4D audit, that the same collections/no-filter semantics are
 * preserved, that error handling never falls back to a full download, and
 * that every write/document-read path genuinely requiring content
 * (createDatabaseBackup, fetchBackups, executeSafeRestore, adminUsers
 * verification) is textually unchanged.
 *
 * Run: npx tsx scripts/tests/restoreDiagnosticsCountOptimization.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

console.log('restoreDiagnosticsCountOptimization.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const restorePath = path.resolve(__dirname, '../../src/services/restoreService.ts');
const restoreSource = fs.readFileSync(restorePath, 'utf-8');
const systemTestPath = path.resolve(__dirname, '../../src/services/systemTestService.ts');
const systemTestSource = fs.readFileSync(systemTestPath, 'utf-8');
const backupPath = path.resolve(__dirname, '../../src/services/backupService.ts');
const backupSource = fs.readFileSync(backupPath, 'utf-8');

/**
 * Extracts one top-level function's full source text by brace-depth
 * tracking. Unlike prior phases' identical-looking helper, this first
 * skips past the parameter list by tracking PAREN depth (restoreService's
 * executeSafeRestore has an inline `options: { ... }` object-type
 * parameter, whose `{` would otherwise be mistaken for the function
 * body's opening brace by a naive "first `{` after the signature" scan).
 */
function extractFunctionBody(fullSource: string, functionSignatureStart: string): string {
  const startIdx = fullSource.indexOf(functionSignatureStart);
  if (startIdx === -1) throw new Error(`Could not find "${functionSignatureStart}" in source`);
  const firstParenIdx = fullSource.indexOf('(', startIdx);
  let parenDepth = 0;
  let paramsEndIdx = -1;
  for (let i = firstParenIdx; i < fullSource.length; i++) {
    if (fullSource[i] === '(') parenDepth++;
    else if (fullSource[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) { paramsEndIdx = i; break; }
    }
  }
  if (paramsEndIdx === -1) throw new Error(`Could not find matching closing paren for "${functionSignatureStart}"`);
  const bodyBraceIdx = fullSource.indexOf('{', paramsEndIdx);
  let depth = 0;
  for (let i = bodyBraceIdx; i < fullSource.length; i++) {
    if (fullSource[i] === '{') depth++;
    else if (fullSource[i] === '}') {
      depth--;
      if (depth === 0) return fullSource.slice(startIdx, i + 1);
    }
  }
  throw new Error(`Could not find matching closing brace for "${functionSignatureStart}"`);
}

// ==================================================
// Restore Preview: count path
// ==================================================
test('#1 Restore Preview count path uses count semantics: generateRestorePreview imports and calls getCountFromServer', () => {
  assert.match(restoreSource, /import\s*\{[^}]*getCountFromServer[^}]*\}\s*from\s*'firebase\/firestore'/s);
  const fnBody = extractFunctionBody(restoreSource, 'export async function generateRestorePreview');
  assert.match(fnBody, /getCountFromServer\(collection\(db,\s*colName\)\)/);
});

test('#2 Restore Preview does NOT download complete collections solely to count: no getDocs() call remains inside generateRestorePreview', () => {
  const fnBody = extractFunctionBody(restoreSource, 'export async function generateRestorePreview');
  assert.equal(/getDocs\(/.test(fnBody), false, 'getDocs must not appear - only getCountFromServer should read Firestore here');
});

test('#3/#4 Filtered/collection scope preserved: the count query targets the exact same collection(db, colName) with no added where()/filter and no changed scope', () => {
  const fnBody = extractFunctionBody(restoreSource, 'export async function generateRestorePreview');
  assert.equal(/where\(/.test(fnBody), false, 'the original getDocs(collection(db, colName)) had no filter - none must be introduced');
  assert.match(fnBody, /collection\(db,\s*colName\)/, 'must still target the same collection reference construction as before');
});

test('#5 Authentication/permission path preserved: no new auth/db import or client context change in restoreService.ts', () => {
  assert.match(restoreSource, /import \{ db, auth \} from '\.\.\/config\/firebase';/, 'db/auth import must be unchanged - same authenticated client context');
});

test('#6/#8 Count result semantics preserved, non-empty collection returns correct count: currentCount is read from snap.data().count, assigned exactly once, same as the old snap.size assignment shape', () => {
  const fnBody = extractFunctionBody(restoreSource, 'export async function generateRestorePreview');
  assert.match(fnBody, /currentCount = snap\.data\(\)\.count;/);
});

test('#7 Empty collection returns count 0: the pre-existing default `let currentCount = 0` and catch-fallback to 0 are unchanged', () => {
  const fnBody = extractFunctionBody(restoreSource, 'export async function generateRestorePreview');
  assert.match(fnBody, /let currentCount = 0;/);
  const tryIdx = fnBody.indexOf('try {');
  const catchIdx = fnBody.indexOf('catch {');
  assert.ok(tryIdx > -1 && catchIdx > tryIdx);
  const catchBody = fnBody.slice(catchIdx, fnBody.indexOf('}', catchIdx) + 1);
  assert.match(catchBody, /currentCount = 0;/);
});

test('#16 Count query does not silently become an unbounded document read on error: the catch clause contains no getDocs() fallback', () => {
  const fnBody = extractFunctionBody(restoreSource, 'export async function generateRestorePreview');
  const catchIdx = fnBody.indexOf('catch {');
  const catchBody = fnBody.slice(catchIdx);
  assert.equal(/getDocs\(/.test(catchBody), false);
});

test('backupCount / diff computation and RestorePreview return shape are unchanged', () => {
  const fnBody = extractFunctionBody(restoreSource, 'export async function generateRestorePreview');
  assert.match(fnBody, /const backupCount = backup\.recordCounts\[colName\] \|\| 0;/);
  assert.match(fnBody, /diff: backupCount - currentCount,/);
});

// ==================================================
// System Diagnostics: existence/count path
// ==================================================
test('#9/#11 Diagnostics count/existence check uses count semantics when only a count is required: the 15-collection loop imports and calls getCountFromServer', () => {
  assert.match(systemTestSource, /import \{ collection, doc, setDoc, getDoc, getCountFromServer, deleteDoc, serverTimestamp \} from 'firebase\/firestore';/);
  assert.match(systemTestSource, /getCountFromServer\(collection\(db,\s*colInfo\.name\)\)/);
});

test('#10 Diagnostics does NOT perform a full collection scan for existence: no getDocs() call remains anywhere in systemTestService.ts', () => {
  assert.equal(/getDocs\(/.test(systemTestSource), false);
});

test('the reported document count still comes from an accurate source (snap.data().count) and the message format is unchanged', () => {
  assert.match(systemTestSource, /`المجموعة متصلة ونشطة في السحابة \(عدد الوثائق: \$\{snap\.data\(\)\.count\}\)`/);
});

test('#16b diagnostics count does not silently become an unbounded document read on error: the catch clause for each of the 15 collections contains no getDocs() fallback', () => {
  const loopStart = systemTestSource.indexOf('for (let idx = 0; idx < all15Collections.length; idx++)');
  const loopBody = extractFunctionBody(systemTestSource, systemTestSource.slice(loopStart, loopStart + 60));
  assert.equal(/getDocs\(/.test(loopBody), false);
  assert.match(loopBody, /details: `المجموعة مهيأة وجاهزة في مخطط Firestore`/, 'the exact pre-existing failure-path message must be unchanged');
});

test('#12 diagnostics that require actual document contents still perform the necessary document read: adminUsers/{UID} verification (Step 3) still uses getDoc, unchanged', () => {
  assert.match(systemTestSource, /const adminDoc = await getDoc\(doc\(db, 'adminUsers', currentUser\.uid\)\);/);
  assert.match(systemTestSource, /const d = adminDoc\.data\(\);/);
});

test('#12b Step 6 (systemTests write/delete connectivity probe) is unchanged - still a real setDoc + deleteDoc, not converted to a count', () => {
  const s6Start = systemTestSource.indexOf("const testId = `diag-${Date.now()}`;");
  const s6End = systemTestSource.indexOf('// Steps 7-21', s6Start);
  const s6Body = systemTestSource.slice(s6Start, s6End);
  assert.match(s6Body, /await setDoc\(testRef,/);
  assert.match(s6Body, /await deleteDoc\(testRef\);/);
});

test('limit(1) usage: NOT USED anywhere in this phase - both optimized paths report an actual count (semantics require an accurate number, not mere existence), so getCountFromServer is used instead of limit(1)', () => {
  assert.equal(/\blimit\(/.test(restoreSource), false);
  assert.equal(/\blimit\(/.test(systemTestSource), false);
});

// ==================================================
// Restore data/write paths unchanged (critical safety)
// ==================================================
test('#13/#14 No restore data-read or write path was changed: executeSafeRestore is textually unchanged - still uses writeBatch/doc/collection/setDoc for actual restoration, no getCountFromServer reaches it', () => {
  const fnBody = extractFunctionBody(restoreSource, 'export async function executeSafeRestore');
  assert.equal(/getCountFromServer/.test(fnBody), false, 'the real restore write path must never be touched by this phase');
  assert.match(fnBody, /const batch = writeBatch\(db\);/);
  assert.match(fnBody, /await batch\.commit\(\);/);
});

test('parseBackupFile / verifyBackupChecksum (backup file parsing + integrity check) are untouched by this phase', () => {
  assert.equal(/getCountFromServer/.test(extractFunctionBody(restoreSource, 'export async function parseBackupFile')), false);
  assert.equal(/getCountFromServer/.test(extractFunctionBody(restoreSource, 'export async function verifyBackupChecksum')), false);
});

test('createDatabaseBackup (backupService.ts) is untouched - still reads full document contents via getDocs, since the actual backup payload genuinely requires document data, not just a count', () => {
  const fnBody = extractFunctionBody(backupSource, 'export async function createDatabaseBackup');
  assert.match(fnBody, /const snap = await getDocs\(collection\(db, colName\)\);/, 'backup creation must still download real documents - this is NOT a count-only operation');
  assert.equal(/getCountFromServer/.test(fnBody), false);
});

test('fetchBackups (backupService.ts) is untouched - the backup list UI needs actual metadata document contents (id/date/checksum/etc), not a count', () => {
  const fnBody = extractFunctionBody(backupSource, 'export async function fetchBackups');
  assert.match(fnBody, /const snap = await getDocs\(q\);/);
  assert.equal(/getCountFromServer/.test(fnBody), false);
});

test('deleteBackup / retrySaveBackupMetadata (backupService.ts) are unchanged - no count logic added to any write path', () => {
  assert.equal(/getCountFromServer/.test(extractFunctionBody(backupSource, 'export async function deleteBackup')), false);
  assert.equal(/getCountFromServer/.test(extractFunctionBody(backupSource, 'export async function retrySaveBackupMetadata')), false);
});

// ==================================================
// No cache / no listener changes / no Rules or index changes
// ==================================================
test('Local Cache untouched: restoreService.ts and systemTestService.ts do not import localCacheStore.ts', () => {
  assert.equal(/from '\.\/localCacheStore'/.test(restoreSource), false);
  assert.equal(/from '\.\/localCacheStore'/.test(systemTestSource), false);
});

test('Listeners untouched: neither restoreService.ts nor systemTestService.ts contains an onSnapshot() call (none existed before this phase either)', () => {
  assert.equal(/onSnapshot\(/.test(restoreSource), false);
  assert.equal(/onSnapshot\(/.test(systemTestSource), false);
});

test('#20/#21 no Firestore Rules or index files were touched by this phase (source-level guard on every changed file)', () => {
  for (const content of [restoreSource, systemTestSource, backupSource]) {
    assert.equal(/firestore\.rules|firestore\.indexes\.json/.test(content), false);
  }
});

test('no new dependency was installed: getCountFromServer is imported from the existing "firebase/firestore" package only, in both changed files', () => {
  assert.match(restoreSource, /getCountFromServer[\s\S]*?\}\s*from 'firebase\/firestore';/);
  assert.match(systemTestSource, /from 'firebase\/firestore';/);
});

// ==================================================
// Backup collection naming (FIXED in Phase 5D.1)
// ==================================================
// Phase 4D originally recorded the mismatched names stage_tube_mills /
// stage_lightweight here as a FINDING it deliberately left unfixed, per its
// own scope boundary. Phase 5D.1 corrected them in backupService.ts, so
// these assertions are inverted: they now pin the AUTHORITATIVE names and
// fail if either legacy name is reintroduced. The bug they guarded was real
// - reading a non-existent collection returns zero documents with no error,
// so a backup silently omitted two entire production stages while still
// reporting success.
test('BACKUP_COLLECTIONS uses the authoritative stage collection names (stage_tube_ball_mills / stage_lightweight_foam), and the legacy stage_tube_mills / stage_lightweight names are not reintroduced - fixed in Phase 5D.1', () => {
  // The corrected names are present.
  assert.match(backupSource, /'stage_tube_ball_mills'/);
  assert.match(backupSource, /'stage_lightweight_foam'/);

  // The legacy names are gone. The trailing quote in each pattern makes these
  // unambiguous: 'stage_lightweight' cannot match inside
  // 'stage_lightweight_foam', because the character after "lightweight"
  // there is `_`, not a closing quote.
  assert.doesNotMatch(backupSource, /'stage_tube_mills'/);
  assert.doesNotMatch(backupSource, /'stage_lightweight'/);

  // Source of truth is unchanged.
  const stagePureSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/stageQueryBoundsPure.ts'), 'utf-8');
  assert.match(stagePureSource, /tube_ball_mills: 'stage_tube_ball_mills'/);
  assert.match(stagePureSource, /lightweight_foam: 'stage_lightweight_foam'/);
});

/**
 * Stronger successor to the two-name check above: rather than pinning only
 * the two names that happened to be wrong, this asserts the actual
 * invariant - EVERY `stage_*` entry in BACKUP_COLLECTIONS must be a real
 * value of STAGE_COLLECTION_NAMES. That catches any future drift (a new
 * stage added to one list but not the other, or another rename), not just a
 * regression of these two specific strings.
 */
test('every stage_* entry in BACKUP_COLLECTIONS is an authoritative STAGE_COLLECTION_NAMES value, and every stage collection is covered by the backup', () => {
  const stagePureSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/stageQueryBoundsPure.ts'), 'utf-8');

  const authoritative = new Set(
    Array.from(stagePureSource.matchAll(/^\s*\w+: '(stage_\w+)',/gm)).map((m) => m[1])
  );
  assert.ok(authoritative.size >= 7, `expected at least 7 authoritative stage collections, got ${authoritative.size}`);

  const backupList = /const BACKUP_COLLECTIONS[^=]*=\s*\[([\s\S]*?)\]/.exec(backupSource);
  assert.ok(backupList, 'BACKUP_COLLECTIONS array not found in backupService.ts');
  const backupStageNames = Array.from((backupList as RegExpExecArray)[1].matchAll(/'(stage_\w+)'/g)).map((m) => m[1]);

  // No orphaned/legacy stage name in the backup list.
  for (const name of backupStageNames) {
    assert.ok(authoritative.has(name), `BACKUP_COLLECTIONS contains '${name}', which is not a STAGE_COLLECTION_NAMES value`);
  }
  // No authoritative stage collection missing from the backup list (the
  // silent-omission failure mode Phase 5D.1 fixed).
  for (const name of authoritative) {
    assert.ok(backupStageNames.includes(name), `authoritative stage collection '${name}' is missing from BACKUP_COLLECTIONS`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

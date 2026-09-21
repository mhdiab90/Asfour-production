/**
 * Phase 4C - focused tests for server-side date-bounding added to
 * fetchProductionRecords()/subscribeProductionRecords() (productionService.ts).
 *
 * `resolveProductionQueryBounds` is pure/Firebase-free and tested
 * directly. productionService.ts itself is tightly coupled to the real
 * Firebase SDK (same established convention as stageRecordQueryBounds.test.ts
 * - no mocking framework in this codebase), so the actual query
 * construction is verified by source inspection: exact string/regex
 * checks against the committed source confirm the correct constraints are
 * built, ordering/document-mapping/error-handling are unchanged, no
 * limit() was introduced, and no "bounded query fails -> unbounded
 * fallback" anti-pattern exists. Also verifies the two actual callers
 * (productionQueryTools.ts AI tools, ProductionRecordsView.tsx) wire
 * their already-known date ranges through correctly, and that
 * DataQualityModal.tsx's genuinely-full-history call site is untouched.
 *
 * Run: npx tsx scripts/tests/productionQueryBounds.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProductionQueryBounds } from '../../src/services/productionQueryBoundsPure';
import { resolveDateRange } from '../../src/assistant/tools/dateRangeResolver';

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

console.log('productionQueryBounds.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const servicePath = path.resolve(__dirname, '../../src/services/productionService.ts');
const source = fs.readFileSync(servicePath, 'utf-8');

/** Extracts one top-level function's full source text by brace-depth tracking (reused pattern from stageRecordQueryBounds.test.ts). */
function extractFunctionBody(fullSource: string, functionSignatureStart: string): string {
  const startIdx = fullSource.indexOf(functionSignatureStart);
  if (startIdx === -1) throw new Error(`Could not find "${functionSignatureStart}" in source`);
  const firstBraceIdx = fullSource.indexOf('{', startIdx);
  let depth = 0;
  for (let i = firstBraceIdx; i < fullSource.length; i++) {
    if (fullSource[i] === '{') depth++;
    else if (fullSource[i] === '}') {
      depth--;
      if (depth === 0) return fullSource.slice(startIdx, i + 1);
    }
  }
  throw new Error(`Could not find matching closing brace for "${functionSignatureStart}"`);
}

// ---- 1: pure bounds resolution ----
test('#1 no filters -> no server-side bound requested (backward compatible, unchanged full read)', () => {
  const bounds = resolveProductionQueryBounds(undefined);
  assert.equal(bounds.useServerSideDateBound, false);
  assert.equal(bounds.startDate, undefined);
  assert.equal(bounds.endDate, undefined);
});

test('#2 missing startDate behavior preserved: endDate only -> bound requested with only an upper bound', () => {
  const bounds = resolveProductionQueryBounds({ endDate: '2026-01-31' });
  assert.equal(bounds.useServerSideDateBound, true);
  assert.equal(bounds.startDate, undefined);
  assert.equal(bounds.endDate, '2026-01-31');
});

test('#3 missing endDate behavior preserved: startDate only -> bound requested with only a lower bound', () => {
  const bounds = resolveProductionQueryBounds({ startDate: '2026-01-01' });
  assert.equal(bounds.useServerSideDateBound, true);
  assert.equal(bounds.startDate, '2026-01-01');
  assert.equal(bounds.endDate, undefined);
});

test('#4 both startDate and endDate -> bound requested with both, preserved verbatim', () => {
  const bounds = resolveProductionQueryBounds({ startDate: '2026-01-01', endDate: '2026-01-31' });
  assert.equal(bounds.useServerSideDateBound, true);
  assert.equal(bounds.startDate, '2026-01-01');
  assert.equal(bounds.endDate, '2026-01-31');
});

test('#5 empty-string startDate/endDate treated as absent (matches filterProductionRecords\' own "" == no bound convention)', () => {
  assert.equal(resolveProductionQueryBounds({ startDate: '', endDate: '' }).useServerSideDateBound, false);
});

test('#10 different date ranges produce different bound objects (no shared/cached state leaking between calls)', () => {
  const a = resolveProductionQueryBounds({ startDate: '2026-01-01', endDate: '2026-01-31' });
  const b = resolveProductionQueryBounds({ startDate: '2026-02-01', endDate: '2026-02-28' });
  assert.notEqual(a.startDate, b.startDate);
  assert.notEqual(a.endDate, b.endDate);
});

// ---- fetchProductionRecords: query construction ----
test('#1b fetchProductionRecords: inclusive bounds (>= startDate, <= endDate) on the "date" field', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchProductionRecords');
  assert.match(fnBody, /where\('date',\s*'>=',\s*bounds\.startDate\)/, 'lower bound must be inclusive (>=)');
  assert.match(fnBody, /where\('date',\s*'<=',\s*bounds\.endDate\)/, 'upper bound must be inclusive (<=)');
});

test('#4b fetchProductionRecords: correct canonical date field ("date"), no other field used for bounding', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchProductionRecords');
  const whereClauses = [...fnBody.matchAll(/where\(('[^']+')/g)].map(m => m[1]);
  for (const field of whereClauses) {
    assert.equal(field, "'date'", `unexpected where() field: ${field}`);
  }
});

test('#5 no arbitrary limit() was introduced in fetchProductionRecords', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchProductionRecords');
  assert.equal(/\blimit\(/.test(fnBody), false, 'a limit() call could silently produce incomplete ERP reports - explicitly forbidden this phase');
});

test('#6 no unbounded fallback: fetchProductionRecords never contains a second/fallback getDocs call inside its catch clause', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchProductionRecords');
  const catchIdx = fnBody.indexOf('catch (error)');
  assert.ok(catchIdx > -1, 'expected a catch clause');
  const catchBody = fnBody.slice(catchIdx);
  assert.equal(/getDocs\(/.test(catchBody), false, 'the catch clause must never attempt a second getDocs call');
  assert.match(catchBody, /handleFirestoreError/, 'existing error handling (handleFirestoreError) must be preserved');
});

test('#11 ordering preserved: orderBy(\'date\', \'desc\') is still applied unconditionally in fetchProductionRecords, including in the bounded branch', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchProductionRecords');
  assert.match(fnBody, /orderBy\('date',\s*'desc'\)/);
  // orderBy must be part of the SAME query() call as the where() constraints, not a separate/conditional branch.
  assert.match(fnBody, /query\(collection\(db,\s*'production'\),\s*\.\.\.constraints,\s*orderBy\('date',\s*'desc'\)\)/);
});

test('#12 document mapping preserved: id + spread doc.data(), cast to ProductionRecord[]', () => {
  const fnBody = extractFunctionBody(source, 'export async function fetchProductionRecords');
  assert.match(fnBody, /id:\s*doc\.id,\s*\n\s*\.\.\.doc\.data\(\)/);
  assert.match(fnBody, /as ProductionRecord\[\]/);
});

test('#13 fetchProductionRecords remains additive: existing zero-argument call sites still compile (filters is optional)', () => {
  assert.match(source, /export async function fetchProductionRecords\(\s*filters\?\s*:/);
});

// ---- subscribeProductionRecords: query construction + listener behavior ----
test('#14 onSnapshot bounded when caller has valid bounds: subscribeProductionRecords applies the same where("date",...) constraints', () => {
  const fnBody = extractFunctionBody(source, 'export function subscribeProductionRecords');
  assert.match(fnBody, /where\('date',\s*'>=',\s*bounds\.startDate\)/);
  assert.match(fnBody, /where\('date',\s*'<=',\s*bounds\.endDate\)/);
  assert.match(fnBody, /orderBy\('date',\s*'desc'\)/);
});

test('#5b no arbitrary limit() was introduced in subscribeProductionRecords', () => {
  const fnBody = extractFunctionBody(source, 'export function subscribeProductionRecords');
  assert.equal(/\blimit\(/.test(fnBody), false);
});

test('#15 listener cleanup preserved: subscribeProductionRecords still returns the raw onSnapshot() unsubscribe function unchanged', () => {
  const fnBody = extractFunctionBody(source, 'export function subscribeProductionRecords');
  assert.match(fnBody, /return onSnapshot\(/);
});

test('#16 duplicate listener risk: subscribeProductionRecords contains exactly ONE onSnapshot() call (no second/parallel listener was added)', () => {
  const fnBody = extractFunctionBody(source, 'export function subscribeProductionRecords');
  const onSnapshotCalls = [...fnBody.matchAll(/onSnapshot\(/g)];
  assert.equal(onSnapshotCalls.length, 1);
});

test('#16b subscribeProductionRecords signature is additive: existing 2-argument call sites still compile (filters is a new optional 3rd parameter)', () => {
  assert.match(source, /export function subscribeProductionRecords\(\s*onData:[\s\S]*?onError\?:[\s\S]*?filters\?\s*:/);
});

test('#13b existing error-notice behavior in subscribeProductionRecords is unchanged (console.warn + optional onError)', () => {
  const fnBody = extractFunctionBody(source, 'export function subscribeProductionRecords');
  assert.match(fnBody, /console\.warn\('Production records subscription snapshot notice:', error\)/);
  assert.match(fnBody, /if \(onError\) onError\(error\)/);
});

// ---- write paths / calculateKPIsFromRecords / filterProductionRecords unchanged ----
test('#22 createProductionRecord/updateProductionRecord/deleteProductionRecord remain textually unchanged - no bounding logic reaches any write path', () => {
  const createFn = extractFunctionBody(source, 'export async function createProductionRecord');
  const updateFn = extractFunctionBody(source, 'export async function updateProductionRecord');
  const deleteFn = extractFunctionBody(source, 'export async function deleteProductionRecord');
  assert.equal(/resolveProductionQueryBounds/.test(createFn), false);
  assert.equal(/resolveProductionQueryBounds/.test(updateFn), false);
  assert.equal(/resolveProductionQueryBounds/.test(deleteFn), false);
});

test('#9 filterProductionRecords (existing client-side date/shift/press/product/customer/employee/search filter) is unchanged - kept as a harmless no-op safety net for already-bounded results', () => {
  const fnBody = extractFunctionBody(source, 'export function filterProductionRecords');
  assert.match(fnBody, /if \(filter\.startDate && record\.date < filter\.startDate\) return false;/);
  assert.match(fnBody, /if \(filter\.endDate && record\.date > filter\.endDate\) return false;/);
});

test('local cache: productionService.ts / productionQueryBoundsPure.ts do not import localCacheStore.ts - Phase 4C is server-side bounding only, not a new Production cache', () => {
  assert.equal(/from '\.\/localCacheStore'/.test(source), false);
  const pureSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/productionQueryBoundsPure.ts'), 'utf-8');
  assert.equal(/localCacheStore/.test(pureSource), false);
});

test('no new dependency: productionQueryBoundsPure.ts has exactly one import, from ../types', () => {
  const pureSource = fs.readFileSync(path.resolve(__dirname, '../../src/services/productionQueryBoundsPure.ts'), 'utf-8');
  const importLines = [...pureSource.matchAll(/^import .+$/gm)].map(m => m[0]);
  assert.equal(importLines.length, 1);
  assert.match(importLines[0], /from '\.\.\/types'/);
});

// ---- caller: productionQueryTools.ts (AI) ----
test('#20 AI caller compatibility: productionQueryTools.ts\'s fetchFiltered() passes resolveDateRange()\'s ALWAYS-bounded period into fetchProductionRecords()', () => {
  const toolsPath = path.resolve(__dirname, '../../src/assistant/tools/productionQueryTools.ts');
  const toolsSource = fs.readFileSync(toolsPath, 'utf-8');
  assert.match(toolsSource, /const period = resolveDateRange\(input\);/);
  assert.match(toolsSource, /const all = await fetchProductionRecords\(\{\s*startDate:\s*period\.startDate,\s*endDate:\s*period\.endDate\s*\}\);/);
  // period must be resolved BEFORE the Firestore call (not after), otherwise the bound couldn't reach the query.
  assert.ok(toolsSource.indexOf('const period = resolveDateRange(input);') < toolsSource.indexOf('const all = await fetchProductionRecords('));
});

test('#20b resolveDateRange() genuinely never returns an empty startDate/endDate - the AI caller always has a real bound to pass through', () => {
  assert.equal(resolveDateRange({}).startDate.length > 0, true);
  assert.equal(resolveDateRange({}).endDate.length > 0, true);
  assert.equal(resolveDateRange({ startDate: '2026-01-01' }).startDate, '2026-01-01');
  assert.equal(resolveDateRange({ startDate: '2026-01-01' }).endDate.length > 0, true);
});

test('#20c productionQueryTools.ts still calls filterProductionRecords with the same filter shape afterward (non-date filters still applied client-side, unchanged)', () => {
  const toolsPath = path.resolve(__dirname, '../../src/assistant/tools/productionQueryTools.ts');
  const toolsSource = fs.readFileSync(toolsPath, 'utf-8');
  assert.match(toolsSource, /const records = filterProductionRecords\(all, filter\);/);
});

// ---- caller: ProductionRecordsView.tsx ----
test('#18 Dashboard/Reports untouched: neither file calls productionService.ts at all (both already migrated to fetchUniversalStageRecords per Phase 4A/4B) - PRESERVED, not BROKEN, by having nothing to change', () => {
  const dashPath = path.resolve(__dirname, '../../src/components/dashboard/DashboardView.tsx');
  const buildPath = path.resolve(__dirname, '../../src/components/dashboard/DashboardBuilderView.tsx');
  const reportsPath = path.resolve(__dirname, '../../src/components/reports/ReportsView.tsx');
  const dashSource = fs.readFileSync(dashPath, 'utf-8');
  const buildSource = fs.readFileSync(buildPath, 'utf-8');
  const reportsSource = fs.readFileSync(reportsPath, 'utf-8');
  for (const src of [dashSource, buildSource, reportsSource]) {
    assert.equal(/from ['"].*services\/productionService['"]/.test(src), false);
  }
});

test('#17 date-range change unsubscribes old listener: ProductionRecordsView.tsx\'s production-subscription effect depends on [startDate, endDate], separated from the Master Data effect (which stays [])', () => {
  const viewPath = path.resolve(__dirname, '../../src/components/production/ProductionRecordsView.tsx');
  const viewSource = fs.readFileSync(viewPath, 'utf-8');
  assert.match(viewSource, /\}, \[startDate, endDate\]\);/, 'the production-subscription effect must re-run when the date filter changes');
  // The mount-only effect also loads the hierarchy, products and customers since
  // 3.20.0 (PERM-0027), so its closing `}, []);` sits further from the first fetch.
  // The window only has to reach that closing bracket, never the date effect below.
  assert.match(viewSource, /fetchMasterData<Shift>\('shifts'\)\.then\(setShifts\)\.catch\(\(\) => \{\}\);[^;]*(?:;[^;]*){0,8}?\}, \[\]\);/, 'the Master Data fetch effect must remain mount-only, never re-triggered by the date filter');
});

test('#14b ProductionRecordsView.tsx wires its existing startDate/endDate UI state into subscribeProductionRecords (previously computed but ignored server-side)', () => {
  const viewPath = path.resolve(__dirname, '../../src/components/production/ProductionRecordsView.tsx');
  const viewSource = fs.readFileSync(viewPath, 'utf-8');
  assert.match(viewSource, /subscribeProductionRecords\(\s*\([\s\S]{0,400}\{\s*startDate:\s*startDate \|\| undefined,\s*endDate:\s*endDate \|\| undefined\s*\}/);
});

test('#16c ProductionRecordsView.tsx still contains exactly one subscribeProductionRecords() call (no duplicate/second listener added)', () => {
  const viewPath = path.resolve(__dirname, '../../src/components/production/ProductionRecordsView.tsx');
  const viewSource = fs.readFileSync(viewPath, 'utf-8');
  const calls = [...viewSource.matchAll(/subscribeProductionRecords\(/g)];
  assert.equal(calls.length, 1);
});

test('#15b ProductionRecordsView.tsx still calls the returned unsubscribe function in its effect cleanup', () => {
  const viewPath = path.resolve(__dirname, '../../src/components/production/ProductionRecordsView.tsx');
  const viewSource = fs.readFileSync(viewPath, 'utf-8');
  assert.match(viewSource, /return \(\) => unsubscribe\(\);/);
});

// ---- caller: DataQualityModal.tsx (genuinely unbounded, left unchanged) ----
test('#21 DataQualityModal.tsx\'s full-history data-quality scan is untouched - still calls fetchProductionRecords() with zero arguments', () => {
  const modalPath = path.resolve(__dirname, '../../src/components/admin/DataQualityModal.tsx');
  const modalSource = fs.readFileSync(modalPath, 'utf-8');
  assert.match(modalSource, /const productionRecords = await fetchProductionRecords\(\);/);
});

// ---- permissions / Rules / indexes ----
test('#23/#24 no Firestore Rules or index files were touched by this phase (source-level guard: no reference to firestore.rules or firestore.indexes.json appears in the changed files)', () => {
  const changedFiles = [
    source,
    fs.readFileSync(path.resolve(__dirname, '../../src/services/productionQueryBoundsPure.ts'), 'utf-8'),
    fs.readFileSync(path.resolve(__dirname, '../../src/assistant/tools/productionQueryTools.ts'), 'utf-8'),
    fs.readFileSync(path.resolve(__dirname, '../../src/components/production/ProductionRecordsView.tsx'), 'utf-8'),
  ];
  for (const content of changedFiles) {
    assert.equal(/firestore\.rules|firestore\.indexes\.json/.test(content), false);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

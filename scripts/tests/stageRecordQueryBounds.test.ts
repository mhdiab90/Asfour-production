/**
 * Phase 4A - focused tests for the server-side date-bounding logic added to
 * fetchUniversalStageRecords() (stageRecordService.ts).
 *
 * `resolveStageQueryBounds` is pure/Firebase-free and tested directly.
 * `fetchUniversalStageRecords` itself is tightly coupled to the real
 * Firebase SDK (same as every other Firestore-touching function in this
 * codebase - no mocking framework exists here, by established convention
 * throughout this project), so the actual query-construction code is
 * verified by source inspection: exact string/regex checks against the
 * committed source confirm the correct constraints are built, no limit()
 * was introduced, no collection was dropped, and no
 * "bounded-query-fails-fall-back-to-unbounded" anti-pattern exists. This
 * mirrors the source-inspection convention already used elsewhere in this
 * codebase's test suite for Firebase-coupled write paths.
 *
 * Run: npx tsx scripts/tests/stageRecordQueryBounds.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStageQueryBounds, STAGE_COLLECTION_NAMES } from '../../src/services/stageQueryBoundsPure';

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

console.log('stageRecordQueryBounds.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const servicePath = path.resolve(__dirname, '../../src/services/stageRecordService.ts');
const source = fs.readFileSync(servicePath, 'utf-8');

/** Extracts one top-level function's full source text by brace-depth tracking, robust to nested `{`/`}` (try/catch, object literals, etc.) that break naive non-greedy regexes. */
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

// ---- 1/2: date boundaries + inclusive/exclusive semantics ----
test('#1 no filters -> no server-side bound requested (backward compatible, unchanged full read)', () => {
  const bounds = resolveStageQueryBounds(undefined);
  assert.equal(bounds.useServerSideDateBound, false);
  assert.equal(bounds.startDate, undefined);
  assert.equal(bounds.endDate, undefined);
});

test('#2 startDate only -> server-side bound requested with only a lower bound', () => {
  const bounds = resolveStageQueryBounds({ startDate: '2026-01-01' });
  assert.equal(bounds.useServerSideDateBound, true);
  assert.equal(bounds.startDate, '2026-01-01');
  assert.equal(bounds.endDate, undefined);
});

test('#3 endDate only -> server-side bound requested with only an upper bound', () => {
  const bounds = resolveStageQueryBounds({ endDate: '2026-01-31' });
  assert.equal(bounds.useServerSideDateBound, true);
  assert.equal(bounds.startDate, undefined);
  assert.equal(bounds.endDate, '2026-01-31');
});

test('#4 both startDate and endDate -> server-side bound requested with both, preserved verbatim (no off-by-one adjustment)', () => {
  const bounds = resolveStageQueryBounds({ startDate: '2026-01-01', endDate: '2026-01-31' });
  assert.equal(bounds.useServerSideDateBound, true);
  assert.equal(bounds.startDate, '2026-01-01');
  assert.equal(bounds.endDate, '2026-01-31');
});

test('#5 empty-string startDate/endDate are treated as absent (matches the existing "" == no bound convention already used by filterUniversalRecords/resolveDashboardDateSelection)', () => {
  const bounds = resolveStageQueryBounds({ startDate: '', endDate: '' });
  assert.equal(bounds.useServerSideDateBound, false);
});

test('#6 other filter fields (stageType/status/productId/etc.) never affect date-bound resolution', () => {
  const bounds = resolveStageQueryBounds({ stageType: 'chinese_mills', status: 'APPROVED', productId: 'p1' });
  assert.equal(bounds.useServerSideDateBound, false, 'no date fields present, must not be bounded');
});

// ---- 3: correct query constraints are generated (source-level verification) ----
test('#7 the query uses inclusive bounds (>= startDate, <= endDate) on the "date" field - matches filterUniversalRecords\' own semantics exactly', () => {
  assert.match(source, /where\('date',\s*'>=',\s*bounds\.startDate\)/, 'lower bound must be inclusive (>=)');
  assert.match(source, /where\('date',\s*'<=',\s*bounds\.endDate\)/, 'upper bound must be inclusive (<=)');
});

test('#7b both inequality constraints target the SAME field ("date") - this is what keeps the query a simple single-field range query, never requiring a composite index', () => {
  const dateWhereClauses = [...source.matchAll(/where\('date',/g)];
  assert.ok(dateWhereClauses.length >= 2, 'expected both the >= and <= constraints to reference the date field');
  // No where() clause in the bounded branch references any other field name.
  const boundedBranchMatch = source.match(/if \(bounds\.useServerSideDateBound\) \{[\s\S]*?\n {6}\}/);
  assert.ok(boundedBranchMatch, 'could not locate the bounded-query branch to inspect');
  const otherFieldWhere = /where\((?!'date')/.exec(boundedBranchMatch![0]);
  assert.equal(otherFieldWhere, null, 'the bounded branch must never filter on any field other than "date"');
});

test('#8 no orderBy() was added alongside the new where() clauses (would risk requiring a composite index) - sorting remains the existing in-memory sort after merging all stages', () => {
  const boundedBranchMatch = source.match(/if \(bounds\.useServerSideDateBound\) \{[\s\S]*?\n {6}\}/);
  assert.ok(boundedBranchMatch);
  assert.equal(/orderBy\(/.test(boundedBranchMatch![0]), false);
  // The existing final in-memory sort must still be present, unchanged.
  assert.match(source, /results\.sort\(\(a, b\) => new Date\(b\.date \|\| b\.createdAt\)\.getTime\(\) - new Date\(a\.date \|\| a\.createdAt\)\.getTime\(\)\)/);
});

// ---- 4/5: all applicable stage collections handled, none omitted ----
test('#9 all 8 stage collections are still present in STAGE_COLLECTION_NAMES, none omitted or renamed', () => {
  const expected = {
    pressing: 'production',
    rotary_furnace: 'stage_rotary_furnace',
    chinese_mills: 'stage_chinese_mills',
    tube_ball_mills: 'stage_tube_ball_mills',
    mortar_concrete: 'stage_mortar_concrete',
    mixing: 'stage_mixing',
    lightweight_foam: 'stage_lightweight_foam',
    sorting: 'stage_sorting',
  };
  assert.deepEqual(STAGE_COLLECTION_NAMES, expected);
});

test('#9b the stagesToFetch selection logic (single-stage vs all 8) is untouched by this phase', () => {
  assert.match(source, /const stagesToFetch: ProductionStageType\[\] = filters\?\.stageType && filters\.stageType !== 'all'/);
});

// ---- 6: no arbitrary limit introduced ----
test('#10 no limit() call was introduced anywhere in the fetch-and-normalize logic (now in fetchUniversalStageRecordsUncached, extracted by Phase 4B - see stageRecordCache.test.ts)', () => {
  const fnBody = extractFunctionBody(source, 'async function fetchUniversalStageRecordsUncached');
  assert.equal(/\blimit\(/.test(fnBody), false, 'a limit() call would risk silently dropping valid report rows - explicitly forbidden this phase');
});

// ---- 7: existing client-side filtering remains intact ----
test('#11 the existing client-side date/status/product/customer/employee/search filtering block is still present and unchanged (kept as a harmless no-op safety net for already-bounded results, and as the ONLY filter path when no server-side bound applies)', () => {
  assert.match(source, /if \(filters\?\.startDate && rec\.date < filters\.startDate\) match = false;/);
  assert.match(source, /if \(filters\?\.endDate && rec\.date > filters\.endDate\) match = false;/);
  assert.match(source, /if \(filters\?\.status && filters\.status !== 'all' && rec\.status !== filters\.status\) match = false;/);
});

// ---- 8: existing callers remain compatible / no read fallback anti-pattern ----
test('#12 no "bounded query fails -> fall back to a second unbounded getDocs" ladder exists - the try/catch still only logs and skips that ONE stage, exactly as before', () => {
  const fnBody = extractFunctionBody(source, 'async function fetchUniversalStageRecordsUncached');
  const catchStarts = [...fnBody.matchAll(/catch \(err\) \{/g)];
  assert.equal(catchStarts.length, 1, 'expected exactly one catch clause (per-stage skip-and-continue), not a nested retry/fallback structure');
  const catchBodyStart = catchStarts[0].index! + catchStarts[0][0].length;
  const catchBody = fnBody.slice(catchBodyStart);
  assert.match(catchBody, /console\.warn/, 'the catch clause must warn');
  const getDocsCallsInCatch = [...catchBody.matchAll(/getDocs\(/g)];
  assert.equal(getDocsCallsInCatch.length, 0, 'the catch clause must never attempt a second (e.g. unbounded) getDocs call - that would reintroduce the exact read-risk this phase removes');
});

/**
 * DEFERRED WITH PHASE 5B.
 *
 * Tests #13 and #14 asserted on ReportsView.tsx, DashboardView.tsx and
 * DashboardBuilderView.tsx - the CALLERS of fetchUniversalStageRecords.
 * Those screens belong to Phase 5B and are not part of this release, so the
 * assertions passed only in a working tree that happened to contain that
 * unreleased work and failed on a clean checkout (DashboardBuilderView.tsx
 * does not exist here at all).
 *
 * They should be restored alongside Phase 5B. Everything in this suite
 * verifies stageRecordService.ts itself, which IS released here:
 *   - #13 ReportsView passes its filters object into the fetch
 *   - #14 Dashboard/DashboardBuilder call sites are untouched by Phase 4A
 */

// ---- 9: no cache was added in Phase 4A (superseded by Phase 4B) ----
test('#15 stageRecordService.ts now imports runCacheFirstRead (Phase 4B) but still nothing else from the Local Cache foundation - only the shared cache-first orchestration is reused, not getCachedCollection/setCachedCollection/invalidateCachedCollection directly', () => {
  assert.match(source, /from '\.\/localCacheStore'/);
  assert.match(source, /\brunCacheFirstRead\b/);
  assert.equal(/getCachedCollection|setCachedCollection|invalidateCachedCollection/.test(source), false);
});

// ---- 10: no write behavior changed ----
test('#16 createStageRecord/updateStageRecord/setRecordApprovalStatus/logRecordAudit are textually unchanged by this phase (write behavior preserved)', () => {
  assert.match(source, /export async function createStageRecord\(/);
  assert.match(source, /export async function updateStageRecord\(/);
  assert.match(source, /export async function setRecordApprovalStatus\(/);
  assert.match(source, /export async function logRecordAudit\(/);
  // None of the write functions reference the new bounds helper.
  const createFn = extractFunctionBody(source, 'export async function createStageRecord');
  const updateFn = extractFunctionBody(source, 'export async function updateStageRecord');
  assert.equal(/resolveStageQueryBounds/.test(createFn), false);
  assert.equal(/resolveStageQueryBounds/.test(updateFn), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

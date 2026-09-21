/**
 * Cost Center / Department Hierarchy - Phase 3 real-file integration test.
 *
 * Unlike costCenterHierarchy.test.ts (fully portable, synthetic fixtures
 * only), this file reads the ACTUAL authoritative source
 * ("Cost Center new.xlsx" -> Sheet1) to assert the exact numeric contract
 * the Phase 2/3 tasks specify: 195 source codes, 5 blank-name exclusions,
 * 1 excluded code (6041), 184 READY, 5 REVIEW_REQUIRED, 189 creation
 * candidates, and that the 6 known excluded codes / 5 known REVIEW_REQUIRED
 * codes land exactly where expected.
 *
 * This file is intentionally NOT required for portability/CI - it looks for
 * the real file at the known local path and SKIPS (exits 0, not 1) if the
 * file is not present on the machine running the suite, rather than failing
 * the whole test run on a machine that doesn't have it.
 *
 * Run: npx tsx scripts/tests/costCenterHierarchyRealFile.test.ts
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import {
  parseSheet1HierarchyRows,
  computeHierarchyDryRunSummary,
  getCreationCandidates,
  runPreApprovalValidation,
  buildCostCenterHierarchyCreationPlan,
  validateCreationPlanIdempotency,
  getAncestorChain,
  findNodeByCode,
} from '../../src/services/costCenterHierarchyPure';

const REAL_FILE_PATH = 'C:/Users/mohamed.hamid/Downloads/Cost Center new.xlsx';

console.log('costCenterHierarchyRealFile.test.ts');

if (!fs.existsSync(REAL_FILE_PATH)) {
  console.log(`  SKIP  real Sheet1 file not found at "${REAL_FILE_PATH}" - this integration test only runs on a machine that has it (e.g. this workstation). Not required for CI/other machines; see costCenterHierarchy.test.ts for the portable suite.`);
  process.exit(0);
}

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

const workbook = XLSX.readFile(REAL_FILE_PATH);
const worksheet = workbook.Sheets['Sheet1'];
const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as unknown[][];
const nodes = parseSheet1HierarchyRows(rows);
const summary = computeHierarchyDryRunSummary(nodes);
const candidates = getCreationCandidates(nodes);
const candidateCodes = new Set(candidates.map((n) => n.sheet1Code));

test('#1 total logical source codes = 195', () => {
  assert.equal(summary.totalLogicalSourceNodes, 195);
});

test('#2 total creation candidates = 189', () => {
  assert.equal(summary.creationCandidates, 189);
});

test('#3 READY = 184', () => {
  assert.equal(summary.ready, 184);
});

test('#4 REVIEW_REQUIRED = 5', () => {
  assert.equal(summary.reviewRequired, 5);
});

test('#5 excluded blank-name = 5', () => {
  assert.equal(summary.excludedBlankName, 5);
});

test('#6 excluded code 6041 = 1', () => {
  assert.equal(summary.excludedCode6041, 1);
});

test('#7 6041 never appears in the creation candidate set', () => {
  assert.equal(candidateCodes.has('6041'), false);
});

for (const code of ['901', '913', '60632', '60633', '70440']) {
  test(`#8-12 ${code} never appears in the creation candidate set`, () => {
    assert.equal(candidateCodes.has(code), false);
  });
}

const expectedReviewRequired: Record<string, string> = {
  '6067': 'مباع',
  '6068': 'مباع',
  '6069': 'معطل',
  '70414': 'بدية شهر 10-2022',
  '70416': 'بداية من 10-2022',
};
for (const [code, expectedNote] of Object.entries(expectedReviewRequired)) {
  test(`#13-17 ${code} is REVIEW_REQUIRED, still a creation candidate, and carries its source note verbatim`, () => {
    const n = findNodeByCode(nodes, code);
    assert.ok(n, `${code} must exist in the parsed node set`);
    assert.equal(n!.status, 'REVIEW_REQUIRED');
    assert.equal(candidateCodes.has(code), true, 'REVIEW_REQUIRED nodes ARE valid creation candidates, never excluded');
    assert.ok(n!.notes?.includes(expectedNote), `expected note "${expectedNote}" to be preserved verbatim for ${code}, got ${JSON.stringify(n!.notes)}`);
  });
}

test('#18 51343 full path resolves through 5134 -> 513 -> root 5, matching the required worked example exactly', () => {
  const chain = getAncestorChain(nodes, '51343').map((n) => n.sheet1Code);
  assert.deepEqual(chain, ['513', '5134', '51343']);
  const n = findNodeByCode(nodes, '51343');
  assert.equal(n?.name, 'مكبس لايس 1600');
});

test('#19 60601 parent resolution - resolves to 606, not a naive 1-digit strip', () => {
  const n = findNodeByCode(nodes, '60601');
  assert.equal(n?.parentSheet1Code, '606');
});

test('#20 70401 parent resolution - resolves to 704, not a naive 1-digit strip', () => {
  const n = findNodeByCode(nodes, '70401');
  assert.equal(n?.parentSheet1Code, '704');
});

test('#21 root 9 (المراكز الرأسمالية) is a flat structure - every root-9 node is level 1 with rootCategoryCode "9"', () => {
  const root9Nodes = nodes.filter((n) => n.rootCategoryCode === '9');
  assert.equal(root9Nodes.length, 10);
  assert.ok(root9Nodes.every((n) => n.level === 1), 'root 9 must never be forced into an artificial deeper hierarchy');
});

test('#22 no orphan nodes in the real parsed hierarchy', () => {
  assert.equal(summary.validation.orphanCount, 0);
});

test('#23 no cycles in the real parsed hierarchy', () => {
  assert.equal(summary.validation.cycleCount, 0);
});

test('#24 no duplicate logical nodes in the real parsed hierarchy', () => {
  assert.equal(summary.validation.duplicateCount, 0);
});

test('#25 zero Furnace Car nodes in the real parsed hierarchy', () => {
  const furnaceCarLike = nodes.filter((n) => /عربة|عربات/.test(n.name));
  assert.equal(furnaceCarLike.length, 0);
});

test('per-root counts match the Phase 1/2 audited breakdown exactly (5=68, 6=66, 7=46, 8=5, 9=10)', () => {
  assert.equal(summary.perRoot['5'], 68);
  assert.equal(summary.perRoot['6'], 66);
  assert.equal(summary.perRoot['7'], 46);
  assert.equal(summary.perRoot['8'], 5);
  assert.equal(summary.perRoot['9'], 10);
});

test('runPreApprovalValidation passes end-to-end on the real, unaltered Sheet1 file', () => {
  const result = runPreApprovalValidation(nodes);
  assert.equal(result.passed, true, `expected pre-approval validation to pass on the real file; mismatches: ${JSON.stringify(result.contractMismatches)}`);
  assert.equal(result.contractMismatches.length, 0);
  assert.equal(result.excludedCodesFoundInCandidates.length, 0);
  assert.equal(result.missingReviewRequiredCodes.length, 0);
  assert.equal(result.furnaceCarNamesDetected.length, 0);
  assert.equal(result.invalidTypeCodes.length, 0);
});

// ==================================================
// PHASE 4A - creation plan built from the REAL 189-candidate file
// ==================================================

const IMPORT_BATCH_ID = 'HIST-IMP-CCH-REALFILE-TEST';
const plan = buildCostCenterHierarchyCreationPlan(nodes, IMPORT_BATCH_ID);

test('Phase 4A plan: exactly 189 creation-plan entries from the real file', () => {
  assert.equal(plan.length, 189);
  assert.equal(plan.length, candidates.length);
});

test('Phase 4A plan: the 6 excluded codes never appear as plan entries (901, 913, 60632, 60633, 70440, 6041)', () => {
  const planCodes = new Set(plan.map((p) => p.sheet1Code));
  for (const code of ['901', '913', '60632', '60633', '70440', '6041']) {
    assert.equal(planCodes.has(code), false, `${code} must never appear in the creation plan`);
  }
});

test('Phase 4A plan: the 5 REVIEW_REQUIRED codes are present in the plan with status REVIEW_REQUIRED and their notes intact', () => {
  for (const code of Object.keys(expectedReviewRequired)) {
    const entry = plan.find((p) => p.sheet1Code === code);
    assert.ok(entry, `${code} must be present in the creation plan`);
    assert.equal(entry!.status, 'REVIEW_REQUIRED');
    assert.ok(entry!.notes && entry!.notes.length > 0, `${code} must retain its source note in the plan`);
  }
});

test('Phase 4A plan: deterministic - rebuilding the plan from the same real-file parse with the same importBatchId is byte-identical', () => {
  const planAgain = buildCostCenterHierarchyCreationPlan(nodes, IMPORT_BATCH_ID);
  assert.deepEqual(plan, planAgain);
});

test('Phase 4A plan: validateCreationPlanIdempotency passes (no duplicate sheet1Code / deterministic Firestore doc ID) on the real 189-node plan', () => {
  const result = validateCreationPlanIdempotency(plan);
  assert.equal(result.valid, true);
  assert.deepEqual(result.duplicateCodes, []);
});

test('Phase 4A plan: every plan entry\'s `code` field (the deterministic Firestore document ID that costCenterHierarchyService.ts writes with) equals its own sheet1Code', () => {
  assert.ok(plan.every((p) => p.code === p.sheet1Code));
});

test('Phase 4A plan: 51343 resolves parentSheet1Code to 5134, which is itself a plan entry - the deterministic-ID parent link is always resolvable within the same plan, no external lookup needed', () => {
  const leaf = plan.find((p) => p.sheet1Code === '51343')!;
  assert.equal(leaf.parentSheet1Code, '5134');
  assert.ok(plan.some((p) => p.sheet1Code === '5134'), 'the parent must itself be a plan entry (own deterministic doc ID)');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

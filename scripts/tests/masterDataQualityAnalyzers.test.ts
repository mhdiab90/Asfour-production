/**
 * Focused tests for the Firestore-quota-incident fix (masterDataQualityAnalyzers.ts).
 * Plain Node `assert` + `tsx` - no new test framework/dependency added, matching
 * the existing repo convention of running standalone .ts/.mjs scripts via tsx/node.
 *
 * Run: npx tsx scripts/tests/masterDataQualityAnalyzers.test.ts
 */
import assert from 'node:assert/strict';
import {
  detectDuplicateCodes,
  detectSimilarNames,
  runMasterDataQualityScan,
  SIMILAR_NAME_SCAN_MAX_ITEMS,
  PRODUCTION_DEPENDENT_ENTITY_TYPES,
} from '../../src/services/masterDataQualityAnalyzers';

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

console.log('masterDataQualityAnalyzers.test.ts');

// TEST 4 - Duplicate-code detection still works.
test('detectDuplicateCodes flags a duplicate prefixCode pair and leaves a unique one alone', () => {
  const items = [
    { id: 'a1', prefixCode: 'BAR', nameAr: 'X' },
    { id: 'a2', prefixCode: 'BAR', nameAr: 'Y' },
    { id: 'a3', prefixCode: 'COC', nameAr: 'Z' },
  ];
  const issues = detectDuplicateCodes('productTypes', items);
  assert.equal(issues.length, 2, 'exactly the 2 BAR docs should be flagged');
  assert.ok(issues.every((i) => i.issueType === 'DUPLICATE_CODE'));
  assert.ok(issues.every((i) => i.code === 'BAR'));
  assert.ok(!issues.some((i) => i.documentId === 'a3'), 'the unique COC doc must not be flagged');
});

// TEST 3 - Similar-name analysis does not block with uncontrolled O(n^2):
// verify the size guard actually skips large lists via the orchestrator, and
// that detectSimilarNames itself still works correctly for small lists (its
// own behavior is unchanged - the orchestrator is what gates it).
test('detectSimilarNames still finds a close match for a small list', () => {
  const items = [
    { id: 'p1', code: 'E001', name: 'Ahmad Hassan Ali' },
    { id: 'p2', code: 'E002', name: 'Ahmad Hasan Ali' }, // one-letter typo variant, NOT an exact normalized match
    { id: 'p3', code: 'E003', name: 'Something Completely Different And Long' },
  ];
  const issues = detectSimilarNames('employees', items, 80);
  assert.ok(issues.length >= 1, 'expected at least one SIMILAR_NAME issue for the near-identical pair');
});

test('runMasterDataQualityScan SKIPS the O(n^2) similar-name pass above SIMILAR_NAME_SCAN_MAX_ITEMS and says so in the summary', () => {
  const bigList = Array.from({ length: SIMILAR_NAME_SCAN_MAX_ITEMS + 50 }, (_, i) => ({
    id: `prod-${i}`,
    code: `C${i}`,
    name: `Product Name Number ${i}`,
  }));
  const start = Date.now();
  const { summary } = runMasterDataQualityScan({ products: bigList }, null);
  const elapsedMs = Date.now() - start;

  assert.equal(summary.similarNameScanStatus.products, 'SKIPPED_LARGE_DATASET');
  // Never freeze the browser for tens of seconds (§4) - a skipped scan over
  // ~550 items should complete near-instantly (well under a full O(n^2)
  // Levenshtein pass, which is the whole point of the guard).
  assert.ok(elapsedMs < 2000, `expected the skipped scan to finish quickly, took ${elapsedMs}ms`);
});

test('runMasterDataQualityScan RUNS the similar-name pass at/under the threshold', () => {
  const smallList = Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, code: `C${i}`, name: `Name ${i}` }));
  const { summary } = runMasterDataQualityScan({ presses: smallList }, []);
  assert.equal(summary.similarNameScanStatus.presses, 'COMPLETED');
});

// TEST 2 - Large collections use bounded/paginated/isolated behavior:
// verify that omitting productionRecords (the caller's isolation strategy)
// is honestly reported, and never silently treated as "confirmed zero
// references" for the entity types that actually depend on it.
test('runMasterDataQualityScan(productionRecords=null) marks referenceCountStatus and forces isProtected for production-dependent types', () => {
  const shiftItems = [
    { id: 'sh1', code: 'وردية 1', name: 'وردية 1' },
    { id: 'sh2', code: 'وردية 1', name: 'وردية 1 مكررة' }, // duplicate code -> DUPLICATE_CODE issue
  ];
  const { issues, summary } = runMasterDataQualityScan({ shifts: shiftItems }, null);
  assert.equal(summary.referenceCountStatus, 'NOT_RUN_FOR_LARGE_DATASET');
  const shiftIssues = issues.filter((i) => i.entityType === 'shifts' && i.issueType === 'DUPLICATE_CODE');
  assert.ok(shiftIssues.length > 0);
  for (const issue of shiftIssues) {
    assert.equal(issue.referenceCountUnknown, true, 'shifts depends on production - must be marked unknown, not 0');
    assert.equal(issue.isProtected, true, 'unknown reference count must default to protected, never "safe to delete"');
  }
  assert.ok(PRODUCTION_DEPENDENT_ENTITY_TYPES.includes('shifts'));
});

test('runMasterDataQualityScan(productionRecords=null) does NOT mark productTypes/departments as unknown - they do not depend on production', () => {
  const productTypeItems = [
    { id: 'pt1', prefixCode: 'BAR', nameAr: 'X' },
    { id: 'pt2', prefixCode: 'BAR', nameAr: 'Y' },
  ];
  const products = [{ id: 'prod1', productTypeId: 'pt1' }]; // real reference to pt1
  const { issues } = runMasterDataQualityScan({ productTypes: productTypeItems, products }, null);
  const ptIssues = issues.filter((i) => i.entityType === 'productTypes' && i.issueType === 'DUPLICATE_CODE');
  assert.ok(ptIssues.length > 0);
  for (const issue of ptIssues) {
    assert.equal(issue.referenceCountUnknown, undefined, 'productTypes reference count is derived from products, not production - must stay known');
  }
  const pt1Issue = ptIssues.find((i) => i.documentId === 'pt1');
  assert.equal(pt1Issue?.referenceCount, 1);
  assert.equal(pt1Issue?.isProtected, true);
  const pt2Issue = ptIssues.find((i) => i.documentId === 'pt2');
  assert.equal(pt2Issue?.referenceCount, 0);
  assert.equal(pt2Issue?.isProtected, false, 'the truly unreferenced duplicate should be a real safe candidate, not falsely protected');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

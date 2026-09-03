/**
 * Focused tests for Tube/Ball Mills Historical Import's mixture/BOM
 * detection + percentage normalization (§11-13, CRITICAL #6/#7) and bunker
 * parsing/distribution (§19-22).
 *
 * Plain Node `assert` + `tsx` - no new test framework/dependency added.
 * Run: npx tsx scripts/tests/tubeBallMillsMixture.test.ts
 */
import assert from 'node:assert/strict';
import { parseMaterialTypeField, normalizeToHundred, findEquivalentMixture, ExistingMixtureCandidate, resolveAluminaPayloadValue } from '../../src/services/tubeBallMillsMixturePure';
import { parseBunkerTokens, suggestEqualBunkerDistribution, isBunkerAllocationValid, resolveBunkerAllocationQuantities } from '../../src/services/tubeBallMillsBunkerPure';

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

console.log('tubeBallMillsMixture.test.ts');

// TEST 7 - the exact worked example from the task spec.
test('TEST 7 - the exact mixture example (جريت54ك+كلاى مخلط37ك+فيدرات37ك+فلسبار7ك) parses to total=135, 4 components, ratios summing to exactly 100', () => {
  const result = parseMaterialTypeField('جريت54ك+كلاى مخلط37ك+فيدرات37ك+فلسبار7ك');
  assert.equal(result.kind, 'MIXTURE');
  if (result.kind !== 'MIXTURE') return;
  assert.equal(result.totalQuantityKg, 135);
  assert.equal(result.components.length, 4);
  assert.deepEqual(result.components.map((c) => c.materialNameRaw), ['جريت', 'كلاى مخلط', 'فيدرات', 'فلسبار']);
  assert.deepEqual(result.components.map((c) => c.quantityKg), [54, 37, 37, 7]);
  // 54/135=40.0%, 37/135≈27.4%, 37/135≈27.4%, 7/135≈5.2%
  assert.deepEqual(result.components.map((c) => c.percentage), [40, 27.4, 27.4, 5.2]);
  const sum = result.components.reduce((a, c) => a + c.percentage, 0);
  assert.equal(Math.round(sum * 10) / 10, 100, 'CRITICAL #7 - percentages must normalize to exactly 100');
});

// TEST 6 - single material with embedded alumina percentage.
test('TEST 6 - جريت40% parses as a single material with alumina=40, NOT a mixture', () => {
  const result = parseMaterialTypeField('جريت40%');
  assert.equal(result.kind, 'SINGLE_WITH_ALUMINA');
  if (result.kind !== 'SINGLE_WITH_ALUMINA') return;
  assert.equal(result.materialName, 'جريت');
  assert.equal(result.aluminaPercentage, 40);
});

// Gap-fix TEST 6 - Alumina Firestore payload value.
test('Gap-fix §4 - resolveAluminaPayloadValue carries a detected alumina percentage through for a plain (non-mixture) material', () => {
  assert.equal(resolveAluminaPayloadValue(false, 40), 40);
});
test('Gap-fix §4 - resolveAluminaPayloadValue is null for a plain material with no detected percentage - never invented', () => {
  assert.equal(resolveAluminaPayloadValue(false, undefined), null);
});
test('Gap-fix §4 - resolveAluminaPayloadValue is ALWAYS null for a mixture/BOM row, even if a percentage happened to be computed elsewhere - never confuse alumina with a mixture component', () => {
  assert.equal(resolveAluminaPayloadValue(true, 40), null);
});

test('single plain material name with no quantity/percentage suffix is returned as-is for direct Master Data matching', () => {
  const result = parseMaterialTypeField('طين أبيض');
  assert.equal(result.kind, 'SINGLE_PLAIN');
  if (result.kind !== 'SINGLE_PLAIN') return;
  assert.equal(result.materialName, 'طين أبيض');
});

// CRITICAL #7 - rounding never trusted naively; largest-remainder guarantees exact 100.
test('normalizeToHundred always sums to exactly 100.0 regardless of how badly quantities round individually', () => {
  const cases: number[][] = [
    [1, 1, 1], // 33.3, 33.3, 33.3 -> naive sum = 99.9, must become 100.0
    [10, 10, 10, 10, 10, 10, 10], // 7-way split
    [100],
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    [0.1, 0.2, 0.3],
  ];
  for (const qty of cases) {
    const pcts = normalizeToHundred(qty);
    const sum = Math.round(pcts.reduce((a, b) => a + b, 0) * 10) / 10;
    assert.equal(sum, 100, `quantities ${JSON.stringify(qty)} must normalize to exactly 100, got ${JSON.stringify(pcts)} (sum ${sum})`);
    assert.equal(pcts.length, qty.length);
  }
});

test('normalizeToHundred handles a zero/empty total without dividing by zero', () => {
  assert.deepEqual(normalizeToHundred([]), []);
  assert.deepEqual(normalizeToHundred([0, 0]), [0, 0]);
});

// §9: a mixture must be genuinely detected (parsed from quantities), never just trusted as valid because it contains '+'.
test('a "+" -joined value where one segment has NO parseable quantity is UNPARSEABLE_MIXTURE, never silently dropped or half-parsed', () => {
  const result = parseMaterialTypeField('جريت54ك+كلاى بدون وزن+فيدرات37ك');
  assert.equal(result.kind, 'UNPARSEABLE_MIXTURE');
  if (result.kind !== 'UNPARSEABLE_MIXTURE') return;
  assert.equal(result.rawSegments.length, 3);
  assert.deepEqual(result.unparsedSegments, ['كلاى بدون وزن']);
});

// §11: quantities are the source of truth, never percentages embedded in the text (this module never even looks for embedded '%' inside a mixture segment - only the trailing kg unit).
test('component names with internal spaces/multi-word Arabic names are parsed correctly, not truncated at the first space', () => {
  const result = parseMaterialTypeField('كلاى مخلط37ك+فلسبار بوتاسيومي7ك');
  assert.equal(result.kind, 'MIXTURE');
  if (result.kind !== 'MIXTURE') return;
  assert.equal(result.components[0].materialNameRaw, 'كلاى مخلط');
  assert.equal(result.components[1].materialNameRaw, 'فلسبار بوتاسيومي');
});

// TEST 10/11 - bunker token parsing.
test('TEST 10 - a single bunker value ("54") parses to exactly one token', () => {
  assert.deepEqual(parseBunkerTokens('54'), ['54']);
});

test('TEST 11 - a hyphen-joined multi-bunker value ("54-65-66") parses to exactly three tokens', () => {
  assert.deepEqual(parseBunkerTokens('54-65-66'), ['54', '65', '66']);
});

test('bunker parsing tolerates stray whitespace around hyphens and empty segments', () => {
  assert.deepEqual(parseBunkerTokens(' 54 - 65 -66 '), ['54', '65', '66']);
  assert.deepEqual(parseBunkerTokens(''), []);
});

// TEST 12 - equal distribution suggestion, sums to exactly Total.
test('TEST 12 - Total=300 across 3 bunkers suggests 100/100/100 and the sum matches Total exactly', () => {
  const suggestion = suggestEqualBunkerDistribution(['54', '65', '66'], 300);
  assert.deepEqual(suggestion.map((s) => s.allocatedTons), [100, 100, 100]);
  assert.equal(isBunkerAllocationValid(suggestion, 300), true);
});

test('an unequal split that does not divide evenly still sums to EXACTLY Total (rounding remainder distributed, never dropped)', () => {
  const suggestion = suggestEqualBunkerDistribution(['54', '65', '66'], 100);
  const sum = suggestion.reduce((a, s) => a + s.allocatedTons, 0);
  assert.ok(Math.abs(sum - 100) < 0.001, `expected sum 100, got ${sum}`);
});

// TEST 13 - invalid distribution is correctly flagged blocking.
test('TEST 13 - Total=300 with allocations 100/100/80 (sum=280) is correctly flagged invalid - blocking, never silently imported', () => {
  const allocations = [{ allocatedTons: 100 }, { allocatedTons: 100 }, { allocatedTons: 80 }];
  assert.equal(isBunkerAllocationValid(allocations, 300), false);
});

test('a user-edited allocation that DOES sum to Total is valid, even if not an equal split', () => {
  const allocations = [{ allocatedTons: 150 }, { allocatedTons: 100 }, { allocatedTons: 50 }];
  assert.equal(isBunkerAllocationValid(allocations, 300), true);
});

test('zero bunkers is never considered a valid allocation (nothing to validate against)', () => {
  assert.equal(isBunkerAllocationValid([], 300), false);
});

// Gap-fix TEST 7 - equal bunker distribution is generated automatically when there is no previous allocation.
test('Gap-fix §5 - resolveBunkerAllocationQuantities with no previous allocation generates a fresh equal split (54-65-66, Total=90 -> 30/30/30)', () => {
  const result = resolveBunkerAllocationQuantities(['54', '65', '66'], 90, undefined);
  assert.deepEqual(result.map((r) => r.allocatedTons), [30, 30, 30]);
  assert.equal(isBunkerAllocationValid(result, 90), true);
});

// Gap-fix TEST 8 - a user's manual edit survives a later revalidation instead of being silently reset back to the equal split.
test('Gap-fix §5/§6 - resolveBunkerAllocationQuantities preserves a user-edited allocation across revalidation when the bunker token set is unchanged', () => {
  const edited = [
    { bunkerRaw: '54', allocatedTons: 50 },
    { bunkerRaw: '65', allocatedTons: 25 },
    { bunkerRaw: '66', allocatedTons: 15 },
  ];
  const result = resolveBunkerAllocationQuantities(['54', '65', '66'], 90, edited);
  assert.deepEqual(result, edited, 'the exact edited values must survive, never silently reset to an equal split');
});

test('Gap-fix §5 - a still-invalid (does not yet sum to Total) user edit is ALSO preserved, not silently discarded while the user is mid-correction', () => {
  const edited = [
    { bunkerRaw: '54', allocatedTons: 10 },
    { bunkerRaw: '65', allocatedTons: 10 },
    { bunkerRaw: '66', allocatedTons: 10 },
  ]; // sums to 30, not 90 - deliberately invalid mid-edit state
  const result = resolveBunkerAllocationQuantities(['54', '65', '66'], 90, edited);
  assert.deepEqual(result, edited);
  assert.equal(isBunkerAllocationValid(result, 90), false, 'still correctly reported invalid - preservation does not silently fix or hide the mismatch');
});

test('Gap-fix §5 - when the bunker token SET changes (a bunker added/removed), a fresh equal split is generated instead of a partial/stale preserve', () => {
  const edited = [
    { bunkerRaw: '54', allocatedTons: 50 },
    { bunkerRaw: '65', allocatedTons: 40 },
  ]; // Total=90, valid for 2 bunkers
  const result = resolveBunkerAllocationQuantities(['54', '65', '66'], 90, edited); // a 3rd bunker "66" was added via edit
  assert.deepEqual(result.map((r) => r.allocatedTons), [30, 30, 30], 'token set changed - regenerate fresh rather than keep a now-incomplete preserved set');
});

// TEST 8 - existing equivalent mixture is reused, never duplicated.
test('TEST 8 - a logically equivalent mixture (same materials/ratios, different source formatting) is found and reused, never duplicated', () => {
  const candidates: ExistingMixtureCandidate[] = [
    { productId: 'p1', productName: 'جريت54ك+كلاى مخلط37ك+فيدرات37ك+فلسبار7ك', components: [
      { materialId: 'grit', percentage: 40 },
      { materialId: 'clay', percentage: 27.4 },
      { materialId: 'feldrat', percentage: 27.4 },
      { materialId: 'feldspar', percentage: 5.2 },
    ] },
  ];
  const newComponents = [
    { resolvedMaterialId: 'grit', percentage: 40 },
    { resolvedMaterialId: 'clay', percentage: 27.4 },
    { resolvedMaterialId: 'feldrat', percentage: 27.4 },
    { resolvedMaterialId: 'feldspar', percentage: 5.2 },
  ];
  const match = findEquivalentMixture(newComponents, candidates);
  assert.ok(match, 'the equivalent mixture must be found');
  assert.equal(match!.productId, 'p1');
});

test('a mixture with a genuinely different ratio is NOT matched as equivalent - never over-merged', () => {
  const candidates: ExistingMixtureCandidate[] = [
    { productId: 'p1', productName: 'mix A', components: [{ materialId: 'grit', percentage: 40 }, { materialId: 'clay', percentage: 60 }] },
  ];
  const newComponents = [{ resolvedMaterialId: 'grit', percentage: 70 }, { resolvedMaterialId: 'clay', percentage: 30 }];
  assert.equal(findEquivalentMixture(newComponents, candidates), null);
});

test('a mixture with a different NUMBER of components is never matched, even if some percentages coincide', () => {
  const candidates: ExistingMixtureCandidate[] = [
    { productId: 'p1', productName: 'mix A', components: [{ materialId: 'grit', percentage: 40 }, { materialId: 'clay', percentage: 60 }] },
  ];
  const newComponents = [{ resolvedMaterialId: 'grit', percentage: 40 }, { resolvedMaterialId: 'clay', percentage: 40 }, { resolvedMaterialId: 'x', percentage: 20 }];
  assert.equal(findEquivalentMixture(newComponents, candidates), null);
});

// TEST 9 - one unresolved component never blocks equivalence-checking from being safely skipped (never guesses).
test('TEST 9 - equivalence is never judged while a component is still unresolved (no materialId yet) - returns no match rather than guessing', () => {
  const candidates: ExistingMixtureCandidate[] = [
    { productId: 'p1', productName: 'mix A', components: [{ materialId: 'grit', percentage: 40 }, { materialId: 'clay', percentage: 60 }] },
  ];
  const newComponents = [{ resolvedMaterialId: 'grit', percentage: 40 }, { resolvedMaterialId: undefined, percentage: 60 }];
  assert.equal(findEquivalentMixture(newComponents, candidates), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

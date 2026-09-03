/**
 * Focused tests for Tube/Ball Mills Historical Import's Hours/Total/Tons-
 * Per-Hour field resolution (tubeBallMillsNumericPure.ts) - the actual
 * REQUIRED-vs-OPTIONAL business logic, extracted specifically so it has
 * real unit test coverage (tubeBallMillsHistoricalImportService.ts cannot
 * be imported outside a Vite runtime - verified empirically: it throws on
 * `import.meta.env` under plain Node/tsx).
 *
 * Required/optional status matches productionStageConfig.ts's existing
 * `tube_ball_mills` schema EXACTLY: only totalTons is required: true;
 * operatingHours and tonsPerHour are both required: false.
 *
 * Run: npx tsx scripts/tests/tubeBallMillsNumeric.test.ts
 */
import assert from 'node:assert/strict';
import { resolveNumericFields } from '../../src/services/tubeBallMillsNumericPure';

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

console.log('tubeBallMillsNumeric.test.ts');

// TEST: Required Field Validation - Total.
test('Required Field Validation - a blank Total is invalid (the one required field for this stage)', () => {
  const r = resolveNumericFields('8', '', '12.5');
  assert.equal(r.totalValid, false);
});

test('Required Field Validation - a non-positive Total is invalid', () => {
  assert.equal(resolveNumericFields('8', '0', '12.5').totalValid, false);
  assert.equal(resolveNumericFields('8', '-5', '12.5').totalValid, false);
});

test('Required Field Validation - a non-numeric Total is invalid', () => {
  assert.equal(resolveNumericFields('8', 'abc', '12.5').totalValid, false);
});

test('Required Field Validation - a valid positive Total is valid', () => {
  const r = resolveNumericFields('8', '100', '12.5');
  assert.equal(r.totalValid, true);
  assert.equal(r.totalTons, 100);
});

// TEST: Optional Field Exclusion - Hours.
test('Optional Field Exclusion - a blank Hours is VALID (required: false) and defaults to 0, never blocking', () => {
  const r = resolveNumericFields('', '100', '12.5');
  assert.equal(r.hoursValid, true);
  assert.equal(r.operatingHours, 0);
});

test('Optional Field Exclusion - a PROVIDED but non-numeric Hours is invalid (optional does not mean "never validated when present")', () => {
  const r = resolveNumericFields('abc', '100', '12.5');
  assert.equal(r.hoursValid, false);
});

test('Optional Field Exclusion - a PROVIDED negative Hours is invalid', () => {
  assert.equal(resolveNumericFields('-3', '100', '12.5').hoursValid, false);
});

// TEST: Optional Field Exclusion + derivation - Tons Per Hour.
test('Optional Field Exclusion - a blank Tons/Hour is VALID (required: false), never an error', () => {
  const r = resolveNumericFields('8', '100', '');
  assert.equal(r.tonsPerHourValid, true);
});

test('a blank Tons/Hour is DERIVED from Total/Hours when both are available, and the derivation is explicitly flagged - never silent', () => {
  const r = resolveNumericFields('8', '100', '');
  assert.equal(r.tonsPerHourDerived, true);
  assert.equal(r.tonsPerHour, 12.5); // 100 / 8
});

test('a blank Tons/Hour with Hours also blank/zero is left at 0, NOT derived (nothing to derive from) - never a divide-by-zero guess', () => {
  const r = resolveNumericFields('', '100', '');
  assert.equal(r.tonsPerHourDerived, false);
  assert.equal(r.tonsPerHour, 0);
});

test('a PROVIDED Tons/Hour that matches Total/Hours closely has no mismatch warning, and is never marked as derived', () => {
  const r = resolveNumericFields('8', '100', '12.5');
  assert.equal(r.tonsPerHourDerived, false);
  assert.equal(r.tonsPerHourMismatch, false);
  assert.equal(r.tonsPerHour, 12.5, 'the declared source value is kept exactly, never silently recalculated when provided');
});

test('a PROVIDED Tons/Hour that materially disagrees with Total/Hours is flagged as a mismatch WARNING - the source value is still kept, never overwritten', () => {
  const r = resolveNumericFields('8', '100', '5'); // declared 5, derived 12.5 - a large disagreement
  assert.equal(r.tonsPerHourMismatch, true);
  assert.equal(r.tonsPerHour, 5, 'declared source value preserved exactly despite the mismatch - §I: never silently overwritten');
});

test('a PROVIDED but non-numeric Tons/Hour is invalid', () => {
  const r = resolveNumericFields('8', '100', 'xyz');
  assert.equal(r.tonsPerHourValid, false);
});

// Arabic-Indic digit support - must match the rest of the app's numeric parsing exactly.
test('Arabic-Indic digits parse identically to Western digits (toWesternDigits reused, not a second parser)', () => {
  const r = resolveNumericFields('٨', '١٠٠', '');
  assert.equal(r.operatingHours, 8);
  assert.equal(r.totalTons, 100);
  assert.equal(r.totalValid, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

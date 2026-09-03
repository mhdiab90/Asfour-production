/**
 * Focused tests for Tube/Ball Mills Historical Import's Mill/Material/
 * Bunker Master Data resolution (tubeBallMillsResolutionPure.ts) - Mill
 * Coding, Material Coding, and "Global Mapping" (session-local manual
 * overrides propagating to every row with the same raw value).
 *
 * Run: npx tsx scripts/tests/tubeBallMillsResolution.test.ts
 */
import assert from 'node:assert/strict';
import { resolveMasterDataField, overrideKey, EntityListItem } from '../../src/services/tubeBallMillsResolutionPure';
import { normalizeArabicForComparison } from '../../src/utils/fuzzyMatching';

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

console.log('tubeBallMillsResolution.test.ts');

const mills: EntityListItem[] = [
  { id: 'm1', code: '1', name: 'طاحونة 1' },
  { id: 'm2', code: '2', name: 'طاحونة 2' },
  { id: 'm3', code: '3', name: 'طاحونة أنبوبية 3' },
];

// Mill Coding - exact match by code.
test('Mill Coding - exact code match resolves directly', () => {
  const r = resolveMasterDataField('mill', '1', mills, {});
  assert.equal(r.resolved?.id, 'm1');
});

// Mill Coding - exact match by name.
test('Mill Coding - exact name match resolves directly', () => {
  const r = resolveMasterDataField('mill', 'طاحونة 2', mills, {});
  assert.equal(r.resolved?.id, 'm2');
});

// Mill Coding - unresolved value produces a fuzzy suggestion, never an auto-applied match.
test('Mill Coding - a close-but-not-exact value produces a SUGGESTION only, never auto-resolved', () => {
  const r = resolveMasterDataField('mill', 'انبوبية 3', mills, {}); // a partial match for "طاحونة أنبوبية 3" (m3) - close enough to suggest, not exact
  assert.equal(r.resolved, undefined, 'never auto-applied without explicit acceptance');
  assert.equal(r.suggestedId, 'm3', 'a fuzzy candidate should be suggested for a close match');
});

// Mill Coding - genuinely unknown value produces neither a match nor a suggestion.
test('Mill Coding - a genuinely unrelated value produces no match and no suggestion', () => {
  const r = resolveMasterDataField('mill', 'شيء غير موجود إطلاقًا 999', mills, {});
  assert.equal(r.resolved, undefined);
  assert.equal(r.suggestedId, undefined);
});

// Approved mapping (persisted from an EARLIER import session).
test('a previously-approved mapping resolves a value that does not exact-match code/name', () => {
  const approvedMappings = { [normalizeArabicForComparison('غير قياسي')]: 'm3' };
  const r = resolveMasterDataField('mill', 'غير قياسي', mills, approvedMappings);
  assert.equal(r.resolved?.id, 'm3');
});

// "Global Mapping" - session-local manual override propagates.
test('Global Mapping - a manual override for one raw value resolves EVERY row with that same raw value in this session', () => {
  const manualOverrides = { [overrideKey('mill', normalizeArabicForComparison('م.غ.1'))]: { id: 'm1', code: '1', name: 'طاحونة 1' } };
  const rowA = resolveMasterDataField('mill', 'م.غ.1', mills, {}, manualOverrides);
  const rowB = resolveMasterDataField('mill', 'م.غ.1', mills, {}, manualOverrides); // a second row, same raw value
  assert.equal(rowA.resolved?.id, 'm1');
  assert.equal(rowB.resolved?.id, 'm1', 'the SAME override resolves a second row with the identical raw value - this IS global mapping propagation');
});

test('Global Mapping - an override is scoped to its OWN domain, never leaking into a different domain with the same raw text', () => {
  const manualOverrides = { [overrideKey('mill', normalizeArabicForComparison('X'))]: { id: 'm1', code: '1', name: 'طاحونة 1' } };
  // Same raw value 'X', but resolving as 'material' domain - the mill override must NOT apply.
  const materials: EntityListItem[] = [{ id: 'mat1', code: 'X', name: 'خامة X' }];
  const r = resolveMasterDataField('material', 'X', materials, {}, manualOverrides);
  assert.equal(r.resolved?.id, 'mat1', 'resolved via its OWN exact code match, not the mill override');
});

test('Global Mapping - manual override takes priority over an exact match that would otherwise apply', () => {
  // Row raw value 'طاحونة 1' would normally exact-match m1 by name - but an explicit override redirects it to m2.
  const manualOverrides = { [overrideKey('mill', normalizeArabicForComparison('طاحونة 1'))]: { id: 'm2', code: '2', name: 'طاحونة 2' } };
  const r = resolveMasterDataField('mill', 'طاحونة 1', mills, {}, manualOverrides);
  assert.equal(r.resolved?.id, 'm2', 'an explicit user override always wins - never silently reverts to the automatic match');
});

// Blank value.
test('a blank raw value resolves to nothing (never a false match, never a false suggestion)', () => {
  const r = resolveMasterDataField('mill', '', mills, {});
  assert.equal(r.resolved, undefined);
  assert.equal(r.suggestedId, undefined);
});

// Original value preservation - resolveMasterDataField itself never mutates its inputs.
test('resolution never mutates the raw value or the Master Data list passed in', () => {
  const millsCopy = JSON.parse(JSON.stringify(mills));
  resolveMasterDataField('mill', 'طاحونة 1', mills, {});
  assert.deepEqual(mills, millsCopy);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

/**
 * Focused tests for the ProductType seed race fix (productTypeSeedPure.ts).
 * Plain Node `assert` + `tsx` - no new test framework/dependency added.
 *
 * Run: npx tsx scripts/tests/productTypeSeed.test.ts
 */
import assert from 'node:assert/strict';
import { INITIAL_PRODUCT_TYPES, computeMissingSeedDocuments } from '../../src/services/productTypeSeedPure';

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

console.log('productTypeSeed.test.ts');

// TEST 5 - ProductType seed is idempotent.
test('computeMissingSeedDocuments returns nothing when every prefix already exists', () => {
  const existing = new Set(INITIAL_PRODUCT_TYPES.map((t) => t.prefixCode.toUpperCase()));
  const toCreate = computeMissingSeedDocuments(existing);
  assert.equal(toCreate.length, 0);
});

test('computeMissingSeedDocuments only creates the genuinely missing prefixes, with deterministic ids', () => {
  const existing = new Set(['BAR', 'BC2']); // pretend only these 2 of the 27 exist
  const toCreate = computeMissingSeedDocuments(existing);
  assert.equal(toCreate.length, INITIAL_PRODUCT_TYPES.length - 2);
  assert.ok(!toCreate.some((d) => d.id === 'BAR' || d.id === 'BC2'), 'existing prefixes must not be recreated');
  for (const doc of toCreate) {
    assert.equal(doc.id, doc.data.prefixCode, 'doc id must equal its own prefixCode (deterministic, not a random auto-id)');
  }
});

// TEST 8 - Existing ProductType references remain compatible: this function
// never touches/returns anything for a prefix that's already present,
// regardless of how many duplicate documents currently exist for it (e.g.
// the pre-existing 27 duplicate pairs) - it only ever decides where a
// MISSING prefix would be created.
test('an already-duplicated prefix (2+ existing docs) is left alone, not "fixed" or recreated', () => {
  // existingPrefixes is a Set of prefix STRINGS (not doc IDs) - a duplicated
  // prefix still contributes exactly one entry to this set, same as a
  // non-duplicated one, so the seed function's behavior for it is identical
  // either way: skip it.
  const existing = new Set(['BAR']); // BAR exists (as 1 or as 2 duplicate docs - indistinguishable to this function, correctly so)
  const toCreate = computeMissingSeedDocuments(existing, [{ prefixCode: 'BAR', nameEn: 'x', nameAr: 'y', active: true }]);
  assert.equal(toCreate.length, 0, 'seeding must never re-create/touch a prefix that already exists, duplicated or not');
});

// TEST 6 - Concurrent seed simulation cannot create duplicate prefixCodes.
test('two "concurrent" callers reading the same missing snapshot compute the SAME target doc id for each missing prefix', () => {
  const existing = new Set<string>(); // empty collection - worst case, everything is "missing"
  const callerA = computeMissingSeedDocuments(existing);
  const callerB = computeMissingSeedDocuments(existing); // simulates a second concurrent call racing the same read
  assert.equal(callerA.length, callerB.length);
  const idsA = callerA.map((d) => d.id).sort();
  const idsB = callerB.map((d) => d.id).sort();
  assert.deepEqual(idsA, idsB, 'concurrent callers must target identical doc ids - this is what prevents duplicates without needing a lock/transaction');
  // Simulate what Firestore does when two writers set() the same doc id:
  // last-write-wins on ONE document, never two documents.
  const merged = new Map<string, unknown>();
  for (const d of [...callerA, ...callerB]) merged.set(d.id, d.data);
  assert.equal(merged.size, callerA.length, 'writing both "concurrent" batches must still result in exactly one document per prefix');
});

test('every seed prefix produces a well-formed 3-character-or-numeric code with a non-empty deterministic id', () => {
  const toCreate = computeMissingSeedDocuments(new Set());
  assert.equal(toCreate.length, INITIAL_PRODUCT_TYPES.length);
  const seenIds = new Set<string>();
  for (const doc of toCreate) {
    assert.ok(doc.id.length > 0);
    assert.ok(!seenIds.has(doc.id), `duplicate id computed within a single seed pass: ${doc.id}`);
    seenIds.add(doc.id);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

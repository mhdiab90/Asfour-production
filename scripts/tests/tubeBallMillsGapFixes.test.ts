/**
 * Focused tests for the TARGETED GAP FIXES to the Tube/Ball Mills Historical
 * Import (post pre-live-audit): Mill/Material "Code New" + fuzzy-suggestion
 * acceptance, bunker session/global mapping, Material/Bunker approved-
 * mapping persistence eligibility, and the chunked-write-with-fallback
 * strategy behind multi-chunk importOutcome accuracy / partial failure
 * isolation.
 *
 * Plain Node `assert` + `tsx` - no new test framework/dependency added.
 * Run: npx tsx scripts/tests/tubeBallMillsGapFixes.test.ts
 */
import assert from 'node:assert/strict';
import { resolveMasterDataField, overrideKey, EntityListItem, isEligibleForMappingPersistence, buildMappingEntryCandidates } from '../../src/services/tubeBallMillsResolutionPure';
import { normalizeArabicForComparison, normalizeCodeForComparison } from '../../src/utils/fuzzyMatching';
import { runChunkedWriteWithFallback } from '../../src/services/tubeBallMillsChunkedWritePure';

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  const finish = () => { passed++; console.log(`  PASS  ${name}`); };
  const fail = (err: any) => { failed++; console.error(`  FAIL  ${name}`); console.error(err); };
  try {
    const r = fn();
    if (r && typeof (r as any).then === 'function') {
      return (r as Promise<void>).then(finish, fail);
    }
    finish();
  } catch (err) {
    fail(err);
  }
  return Promise.resolve();
}

async function run() {
  console.log('tubeBallMillsGapFixes.test.ts');

  const mills: EntityListItem[] = [
    { id: 'm1', code: '1', name: 'طاحونة 1' },
    { id: 'm3', code: '3', name: 'طاحونة أنبوبية 3' },
  ];
  const materials: EntityListItem[] = [
    { id: 'mat1', code: 'GR', name: 'جريت' },
  ];

  // ---- 1/2: Code New Mill/Material - resolving a row to a JUST-CREATED
  // record, the same mechanism submitCodeNew/resolveFieldForRow use: a
  // one-off manual override keyed to the raw value, both name- and
  // code-normalized (exactly as the panel builds it), resolved via the
  // SAME resolveMasterDataField the rest of the pipeline uses.
  await test('Gap-fix §1 - Code New Mill: a freshly-created Mill (not yet in the Master Data list) resolves the row once registered as a manual override', () => {
    const newMill = { id: 'm99', code: '99', name: 'طاحونة جديدة' };
    const overrides = {
      [overrideKey('mill', normalizeArabicForComparison('طاحونة جديدة راو'))]: newMill,
      [overrideKey('mill', normalizeCodeForComparison('طاحونة جديدة راو'))]: newMill,
    };
    const r = resolveMasterDataField('mill', 'طاحونة جديدة راو', mills, {}, overrides);
    assert.equal(r.resolved?.id, 'm99', 'the row resolves to the just-created Mill, not left unresolved');
  });

  await test('Gap-fix §2 - Code New Material: a freshly-created Material resolves the row once registered as a manual override, without touching any OTHER row\'s different raw value', () => {
    const newMaterial = { id: 'mat99', code: 'NEW', name: 'خامة جديدة' };
    const overrides = {
      [overrideKey('material', normalizeArabicForComparison('خامة غريبة'))]: newMaterial,
      [overrideKey('material', normalizeCodeForComparison('خامة غريبة'))]: newMaterial,
    };
    const resolvedRow = resolveMasterDataField('material', 'خامة غريبة', materials, {}, overrides);
    assert.equal(resolvedRow.resolved?.id, 'mat99');
    const otherRow = resolveMasterDataField('material', 'جريت', materials, {}, overrides);
    assert.equal(otherRow.resolved?.id, 'mat1', 'an unrelated raw value still resolves normally, unaffected by the other row\'s Code New override');
  });

  // ---- 3: Fuzzy suggestion acceptance for Mill/Material - the suggestion
  // itself is never auto-applied (confirmed by existing resolution tests);
  // this confirms the ACCEPTANCE step (useMillSuggestion/useMaterialSuggestion
  // build an override from the suggested entity and re-resolve).
  await test('Gap-fix §3 - Mill fuzzy suggestion acceptance: accepting a suggested Mill resolves the row exactly like an explicit dropdown pick', () => {
    const suggestion = resolveMasterDataField('mill', 'انبوبية 3', mills, {});
    assert.equal(suggestion.resolved, undefined, 'still only a suggestion before acceptance');
    assert.equal(suggestion.suggestedId, 'm3');
    const accepted = { id: suggestion.suggestedId!, code: suggestion.suggestedCode || '', name: suggestion.suggestedName || '' };
    const overrides = {
      [overrideKey('mill', normalizeArabicForComparison('انبوبية 3'))]: accepted,
      [overrideKey('mill', normalizeCodeForComparison('انبوبية 3'))]: accepted,
    };
    const resolved = resolveMasterDataField('mill', 'انبوبية 3', mills, {}, overrides);
    assert.equal(resolved.resolved?.id, 'm3', 'after explicit acceptance, the row resolves to the suggested Mill');
  });

  await test('Gap-fix §3 - Material fuzzy suggestion acceptance: accepting a suggested Material resolves the row', () => {
    const suggestion = resolveMasterDataField('material', 'جريط', materials, {}); // one-letter typo of جريت
    assert.equal(suggestion.resolved, undefined);
    assert.ok(suggestion.suggestedId, 'a close-but-not-exact Material value should produce a suggestion');
    const accepted = { id: suggestion.suggestedId!, code: suggestion.suggestedCode || '', name: suggestion.suggestedName || '' };
    const overrides = {
      [overrideKey('material', normalizeArabicForComparison('جريط'))]: accepted,
      [overrideKey('material', normalizeCodeForComparison('جريط'))]: accepted,
    };
    const resolved = resolveMasterDataField('material', 'جريط', materials, {}, overrides);
    assert.equal(resolved.resolved?.id, 'mat1');
  });

  // ---- 7: Bunker session/global mapping - the SAME raw bunker value ("54")
  // resolves the same way for every row that has it once one row's
  // resolution is registered as a manual override, exactly what
  // resolveBunkerForRow does across ALL rows in the panel.
  await test('Gap-fix §7 - Bunker Global Mapping: resolving "54" once propagates to every OTHER row that also has raw bunker "54" this session', () => {
    const bunkerEntity = { id: 'b54', code: '54', name: 'بنكر 54' };
    const overrides = {
      [overrideKey('bunker', normalizeArabicForComparison('54'))]: bunkerEntity,
      [overrideKey('bunker', normalizeCodeForComparison('54'))]: bunkerEntity,
    };
    const rowA = resolveMasterDataField('bunker', '54', [], {}, overrides); // row A's bunker list may not even have it yet
    const rowB = resolveMasterDataField('bunker', '54', [], {}, overrides); // row B, same raw value
    assert.equal(rowA.resolved?.id, 'b54');
    assert.equal(rowB.resolved?.id, 'b54', 'the SAME override resolves every row sharing this raw bunker value - true session-wide Global Mapping');
  });

  await test('Gap-fix §7 - Bunker Global Mapping is scoped to the bunker domain only, never leaking into mill/material resolution of the same raw text', () => {
    const bunkerEntity = { id: 'b54', code: '54', name: 'بنكر 54' };
    const overrides = { [overrideKey('bunker', normalizeCodeForComparison('54'))]: bunkerEntity };
    const asMill = resolveMasterDataField('mill', '54', mills, {}, overrides);
    assert.equal(asMill.resolved, undefined, 'a bunker override must never resolve an unrelated mill lookup with the same raw text');
  });

  // ---- 8: Material/Bunker approved-mapping persistence eligibility.
  await test('Gap-fix §8 - isEligibleForMappingPersistence is true only when an actual correction happened (resolved name differs from raw text)', () => {
    assert.equal(isEligibleForMappingPersistence('جريط', 'جريت'), true);
    assert.equal(isEligibleForMappingPersistence('جريت', 'جريت'), false, 'an exact match is not a "correction" worth persisting');
    assert.equal(isEligibleForMappingPersistence('جريط', undefined), false, 'never eligible when nothing was actually resolved');
  });

  await test('Gap-fix §8 - buildMappingEntryCandidates includes Material and Bunker domains (previously Mill-only), gated on an explicit resolution', () => {
    const row = {
      millTypeRaw: 'طاحونة 1', resolvedMillId: 'm1', resolvedMillCode: '1', resolvedMillName: 'طاحونة 1', // exact match - not eligible
      isMixture: false,
      materialTypeRaw: 'جريط', resolvedMaterialId: 'mat1', resolvedMaterialCode: 'GR', resolvedMaterialName: 'جريت', // corrected - eligible
      bunkerAllocations: [
        { bunkerRaw: 'بنكر 54', resolvedBunkerId: 'b54', resolvedBunkerCode: '54', resolvedBunkerName: 'بنكر 54' }, // raw already equals the resolved name exactly - not eligible
        { bunkerRaw: '65X', resolvedBunkerId: 'b65', resolvedBunkerCode: '65', resolvedBunkerName: 'بنكر 65' }, // corrected - eligible
      ],
    };
    const entries = buildMappingEntryCandidates(row);
    const domains = entries.map((e) => e.domain).sort();
    assert.deepEqual(domains, ['tubeBallBunker', 'tubeBallMaterial'], 'Mill was an exact match (not eligible); Material and Bunker each contributed exactly one eligible correction');
    const materialEntry = entries.find((e) => e.domain === 'tubeBallMaterial');
    assert.equal(materialEntry?.mappedEntityId, 'mat1');
    const bunkerEntry = entries.find((e) => e.domain === 'tubeBallBunker');
    assert.equal(bunkerEntry?.mappedEntityId, 'b65');
  });

  await test('Gap-fix §8 - buildMappingEntryCandidates never persists a mixture row\'s "material" (single-material domain is meaningless for a mixture)', () => {
    const row = {
      millTypeRaw: '', isMixture: true,
      materialTypeRaw: 'جريت54ك+كلاى37ك', resolvedMaterialId: undefined, resolvedMaterialName: undefined,
      bunkerAllocations: [],
    };
    const entries = buildMappingEntryCandidates(row);
    assert.equal(entries.length, 0);
  });

  // ---- 13/14: chunked write with fallback - multi-chunk importOutcome
  // accuracy and partial failure isolation, exercising the REAL orchestrator
  // executeTubeBallMillsBatchImport calls (not a parallel/fake abstraction),
  // via injected fake writeChunk/writeOne so no Firestore is touched.
  await test('Gap-fix §13/§14 - a single chunk that succeeds marks every item imported (baseline, no failure)', async () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: i + 1 }));
    const result = await runChunkedWriteWithFallback({
      items, chunkSize: 400, getId: (x) => x.id,
      writeChunk: async () => {},
      writeOne: async () => { throw new Error('should never be called on the happy path'); },
    });
    assert.deepEqual(result.importedIds.sort(), [1, 2, 3, 4, 5]);
    assert.equal(result.failedIds.length, 0);
  });

  await test('Gap-fix §14 - Partial Failure Isolation: within one chunk, 98 rows succeed and 2 fail via the individual-fallback retry - never "all or nothing" reported when the underlying rows differ', async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const badIds = new Set([37, 82]);
    const result = await runChunkedWriteWithFallback({
      items, chunkSize: 400, getId: (x) => x.id,
      writeChunk: async () => { throw new Error('simulated chunk-level batch failure'); }, // atomic batch fails as a whole
      writeOne: async (item) => { if (badIds.has(item.id)) throw new Error(`row ${item.id} rejected`); },
    });
    assert.equal(result.importedIds.length, 98);
    assert.equal(result.failedIds.length, 2);
    assert.deepEqual(result.failedIds.sort(), [37, 82]);
    assert.equal(result.errors.length, 2);
  });

  await test('Gap-fix §13 - Import Outcome Accuracy across multiple chunks: chunk A succeeds fully, chunk B fails partially - chunk A\'s rows are STILL marked imported, never wrongly left unmarked because a LATER chunk had a problem', async () => {
    const items = Array.from({ length: 450 }, (_, i) => ({ id: i + 1 })); // 2 chunks of 400 + 50 at chunkSize=400
    const result = await runChunkedWriteWithFallback({
      items, chunkSize: 400, getId: (x) => x.id,
      writeChunk: async (chunk) => {
        // Chunk 1 (ids 1-400) succeeds as a whole batch; chunk 2 (ids 401-450) fails as a whole batch.
        if (chunk.some((c) => c.id > 400)) throw new Error('simulated failure for the second chunk');
      },
      writeOne: async (item) => { if (item.id === 425) throw new Error('row 425 rejected'); }, // only ONE row in the failed chunk actually fails
    });
    // Chunk 1's 400 rows must all be marked imported, independent of chunk 2's outcome.
    for (let id = 1; id <= 400; id++) assert.ok(result.importedIds.includes(id), `row ${id} from the successful first chunk must be marked imported`);
    // Chunk 2: 49 of its 50 rows succeed via the individual fallback, 1 fails.
    assert.equal(result.importedIds.filter((id) => (id as number) > 400).length, 49);
    assert.deepEqual(result.failedIds, [425]);
    assert.equal(result.importedIds.length, 449);
  });

  await test('Gap-fix §Cancel - shouldCancel is checked only at chunk boundaries: an in-flight chunk always finishes, never interrupted mid-write, and already-committed chunks are never rolled back', async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }));
    let calls = 0;
    const result = await runChunkedWriteWithFallback({
      items, chunkSize: 3, getId: (x) => x.id,
      writeChunk: async () => { calls++; },
      writeOne: async () => {},
      shouldCancel: () => calls >= 2, // cancel after the first two chunks have already committed
    });
    assert.equal(result.importedIds.length, 6, 'the two already-committed chunks (3+3=6 rows) remain imported, never rolled back');
    assert.equal(result.cancelledCount, 4, 'the remaining not-yet-started rows are reported cancelled, not silently dropped');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run();

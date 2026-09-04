/**
 * Focused tests for the Tube/Ball Mills full-file Master Data extraction
 * module (tubeBallMillsMasterDataExtractionPure.ts) - the core new piece of
 * the "Master-Data Extraction + Excel Template + BOM Mixture Coding" task.
 * Firebase-free/deterministic - builds fixtures directly as
 * TubeBallMillsImportRow-shaped objects (the extraction module doesn't
 * itself resolve anything; it aggregates already-resolved row state).
 *
 * Run: npx tsx scripts/tests/tubeBallMillsMasterDataExtraction.test.ts
 */
import assert from 'node:assert/strict';
import { extractTubeBallMillsMasterDataGroups, summarizeMasterDataGroup } from '../../src/services/tubeBallMillsMasterDataExtractionPure';
import type { TubeBallMillsImportRow } from '../../src/types';

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

console.log('tubeBallMillsMasterDataExtraction.test.ts');

/** Minimal fixture builder - only the fields the extraction module reads, rest defaulted. */
function row(overrides: Partial<TubeBallMillsImportRow> & { rowIndex: number }): TubeBallMillsImportRow {
  return {
    date: '2026-01-01',
    millTypeRaw: '',
    materialTypeRaw: '',
    isMixture: false,
    operatingHours: 8,
    tonsPerHour: 10,
    totalTons: 80,
    storageBunkersRaw: '',
    bunkerAllocations: [],
    bunkerAllocationValid: true,
    status: 'VALID',
    errors: [],
    warnings: [],
    isDuplicate: false,
    raw: {},
    ...overrides,
  } as TubeBallMillsImportRow;
}

// ---- Full unique-value extraction / Mill extraction / occurrence counts ----
test('extractTubeBallMillsMasterDataGroups groups repeated raw Mill values into ONE entry with the correct occurrence count', () => {
  const rows = [1, 2, 3].map((i) => row({ rowIndex: i, millTypeRaw: 'Tube Mill 01', resolvedMillId: undefined }));
  const { mills } = extractTubeBallMillsMasterDataGroups(rows);
  assert.equal(mills.length, 1);
  assert.equal(mills[0].occurrences, 3);
  assert.deepEqual(mills[0].rowIndexes, [1, 2, 3]);
  assert.equal(mills[0].resolved, false);
});

test('a resolved Mill group carries its resolvedId/resolvedCode/resolvedName through from the row', () => {
  const rows = [row({ rowIndex: 1, millTypeRaw: 'Mill A', resolvedMillId: 'm1', resolvedMillCode: 'TM-001', resolvedMillName: 'Mill A' })];
  const { mills } = extractTubeBallMillsMasterDataGroups(rows);
  assert.equal(mills[0].resolved, true);
  assert.equal(mills[0].resolvedId, 'm1');
  assert.equal(mills[0].resolvedCode, 'TM-001');
});

test('a Mill fuzzy suggestion (suggestedMillId/Name/Confidence) is carried through unresolved', () => {
  const rows = [row({ rowIndex: 1, millTypeRaw: 'Tube Mil 01', suggestedMillId: 'm1', suggestedMillName: 'Tube Mill 01', suggestedMillConfidence: 78 })];
  const { mills } = extractTubeBallMillsMasterDataGroups(rows);
  assert.equal(mills[0].resolved, false);
  assert.equal(mills[0].suggestedId, 'm1');
  assert.equal(mills[0].suggestedConfidence, 78);
});

test('a blank Mill Type contributes no group at all (optional field, never a false entry)', () => {
  const { mills } = extractTubeBallMillsMasterDataGroups([row({ rowIndex: 1, millTypeRaw: '' })]);
  assert.equal(mills.length, 0);
});

// ---- Material extraction ----
test('a plain (non-mixture) Material groups by its resolved base name with the correct occurrence count', () => {
  const rows = [1, 2].map((i) => row({ rowIndex: i, materialTypeRaw: 'جريت', resolvedMaterialId: 'mat1', resolvedMaterialName: 'جريت' }));
  const { materials } = extractTubeBallMillsMasterDataGroups(rows);
  assert.equal(materials.length, 1);
  assert.equal(materials[0].occurrences, 2);
  assert.equal(materials[0].originalValue, 'جريت');
});

// ---- Alumina suffix (§7) - base-name grouping merges different % suffixes ----
test('§7 - "جريت40%" and "جريت25%" fold into ONE Material group keyed by the parsed BASE name "جريت", never two separate unresolved groups', () => {
  const rows = [
    row({ rowIndex: 1, materialTypeRaw: 'جريت40%', resolvedMaterialId: 'mat1', resolvedMaterialName: 'جريت' }),
    row({ rowIndex: 2, materialTypeRaw: 'جريت25%', resolvedMaterialId: 'mat1', resolvedMaterialName: 'جريت' }),
  ];
  const { materials } = extractTubeBallMillsMasterDataGroups(rows);
  assert.equal(materials.length, 1, 'both alumina-suffixed variants must merge into a single base-material group');
  assert.equal(materials[0].originalValue, 'جريت');
  assert.equal(materials[0].occurrences, 2);
});

// ---- Mixture extraction + component folding into Materials (§11) ----
test('§8/§9 - a mixture row groups by its full raw string under "mixtures", separate from plain materials', () => {
  const mixtureRaw = 'جريت54ك+كلاى مخلط37ك+فيدرات37ك+فلسبار7ك';
  const rows = [
    row({
      rowIndex: 1,
      isMixture: true,
      materialTypeRaw: mixtureRaw,
      mixtureComponents: [
        { materialNameRaw: 'جريت', quantityKg: 54, percentage: 40.0 },
        { materialNameRaw: 'كلاى مخلط', quantityKg: 37, percentage: 27.4 },
        { materialNameRaw: 'فيدرات', quantityKg: 37, percentage: 27.4 },
        { materialNameRaw: 'فلسبار', quantityKg: 7, percentage: 5.2 },
      ],
      mixtureTotalQuantityKg: 135,
    }),
  ];
  const { mixtures, materials } = extractTubeBallMillsMasterDataGroups(rows);
  assert.equal(mixtures.length, 1);
  assert.equal(mixtures[0].originalValue, mixtureRaw);
  assert.equal(mixtures[0].resolved, false);
});

test('§11 - every mixture component contributes its own occurrence to the combined Materials list, resolving against the SAME Material pool as plain-material rows', () => {
  const rows = [
    row({ rowIndex: 1, isMixture: true, materialTypeRaw: 'جريت54ك+فلسبار7ك', mixtureComponents: [
      { materialNameRaw: 'جريت', quantityKg: 54, percentage: 88.5, resolvedMaterialId: 'mat1', resolvedMaterialCode: 'MAT-001', resolvedMaterialName: 'جريت' },
      { materialNameRaw: 'فلسبار', quantityKg: 7, percentage: 11.5 },
    ] }),
    row({ rowIndex: 2, materialTypeRaw: 'جريت', resolvedMaterialId: 'mat1', resolvedMaterialCode: 'MAT-001', resolvedMaterialName: 'جريت' }), // plain row, same material
  ];
  const { materials } = extractTubeBallMillsMasterDataGroups(rows);
  const grit = materials.find((m) => m.originalValue === 'جريت');
  assert.ok(grit, 'جريت must appear once, combining the mixture component AND the plain-row occurrence');
  assert.equal(grit!.occurrences, 2, 'one occurrence from the mixture component, one from the plain row - a single shared pool');
  assert.equal(grit!.resolved, true);
  const feldspar = materials.find((m) => m.originalValue === 'فلسبار');
  assert.ok(feldspar);
  assert.equal(feldspar!.resolved, false);
});

// ---- Bunker extraction ----
test('§17 - "54-65-66" contributes THREE separate bunker groups, one per token, each with its own occurrence count', () => {
  const rows = [
    row({ rowIndex: 1, bunkerAllocations: [
      { bunkerRaw: '54', allocatedTons: 30 },
      { bunkerRaw: '65', allocatedTons: 30 },
      { bunkerRaw: '66', allocatedTons: 30 },
    ] }),
    row({ rowIndex: 2, bunkerAllocations: [{ bunkerRaw: '54', allocatedTons: 90 }] }),
  ];
  const { bunkers } = extractTubeBallMillsMasterDataGroups(rows);
  assert.equal(bunkers.length, 3);
  const b54 = bunkers.find((b) => b.originalValue === '54');
  assert.equal(b54!.occurrences, 2);
  const b65 = bunkers.find((b) => b.originalValue === '65');
  assert.equal(b65!.occurrences, 1);
});

// ---- Summary counts (§15) ----
test('summarizeMasterDataGroup computes unique/resolved/unresolved counts purely from actual group state', () => {
  const rows = [
    row({ rowIndex: 1, millTypeRaw: 'Mill A', resolvedMillId: 'm1' }),
    row({ rowIndex: 2, millTypeRaw: 'Mill B' }), // unresolved
    row({ rowIndex: 3, millTypeRaw: 'Mill C' }), // unresolved
  ];
  const { mills } = extractTubeBallMillsMasterDataGroups(rows);
  const counts = summarizeMasterDataGroup(mills);
  assert.equal(counts.uniqueCount, 3);
  assert.equal(counts.resolvedCount, 1);
  assert.equal(counts.unresolvedCount, 2);
});

test('an empty row set produces an empty extraction and zeroed summary - never throws', () => {
  const extraction = extractTubeBallMillsMasterDataGroups([]);
  assert.deepEqual(extraction, { mills: [], materials: [], mixtures: [], bunkers: [] });
  const counts = summarizeMasterDataGroup([]);
  assert.deepEqual(counts, { uniqueCount: 0, resolvedCount: 0, unresolvedCount: 0 });
});

test('groups are sorted by descending occurrence count, so the most-common unresolved values surface first for the reviewer', () => {
  const rows = [
    row({ rowIndex: 1, millTypeRaw: 'Rare Mill' }),
    row({ rowIndex: 2, millTypeRaw: 'Common Mill' }),
    row({ rowIndex: 3, millTypeRaw: 'Common Mill' }),
    row({ rowIndex: 4, millTypeRaw: 'Common Mill' }),
  ];
  const { mills } = extractTubeBallMillsMasterDataGroups(rows);
  assert.equal(mills[0].originalValue, 'Common Mill');
  assert.equal(mills[0].occurrences, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

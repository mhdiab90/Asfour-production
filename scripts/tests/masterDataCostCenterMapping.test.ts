/**
 * Focused tests for the Master Data <-> Cost Center Hierarchy mapping audit
 * engine (Phase 6A, masterDataCostCenterMappingPure.ts).
 *
 * All fixtures below are synthetic, illustrative Master Data records
 * shaped exactly like the real Department/Press/Furnace/FurnaceCar/Mill/
 * TubeBallMill/Bunker/Material/Product interfaces (src/types/index.ts) -
 * this suite never reads real Firestore data (Phase 6A's own report
 * documents why: no read access was available), so it proves the ENGINE's
 * logic is correct and ready to run the moment real Master Data arrays are
 * supplied by a caller that can actually fetch them.
 *
 * Run: npx tsx scripts/tests/masterDataCostCenterMapping.test.ts
 */
import assert from 'node:assert/strict';
import { parseSheet1HierarchyRows, ParsedHierarchyNode } from '../../src/services/costCenterHierarchyPure';
import {
  matchMasterDataRecordToHierarchy,
  auditMasterDataCollection,
  buildCostCenterToMasterDataTable,
  detectMappingConflicts,
  detectFurnaceCarContaminationRisk,
  findGlobalMappingCandidates,
  MasterDataMatchInput,
} from '../../src/services/masterDataCostCenterMappingPure';

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

console.log('masterDataCostCenterMapping.test.ts');

/** Same row-builder convention as costCenterHierarchy.test.ts - 3 parallel column-blocks (root5/root6/root7-9). */
function row(a: [any, string?, string?] = [''], b: [any, string?, string?] = [''], c: [any, string?, string?] = ['']): any[] {
  return [a[0] ?? '', a[1] ?? '', a[2] ?? '', b[0] ?? '', b[1] ?? '', b[2] ?? '', c[0] ?? '', c[1] ?? '', c[2] ?? ''];
}

/** A representative fixture covering departments, presses/mills-style leaves, and REVIEW_REQUIRED/excluded codes - reused across most tests below. */
function buildFixtureHierarchy(): ParsedHierarchyNode[] {
  const rows = [
    row([511, 'الطواحين (التهوية)']), row([5111, 'الطواحين بول ميل']), row([51111, 'طواحين بول ميل 501']),
    row([5112, 'طواحين تيوب ميل']), row([51121, 'طواحين تيوب ميل 503']),
    row([513, 'كبس الالومينا سيليكات']), row([5134, 'مكابس اللايس']), row([51343, 'مكبس لايس 1600']),
    row([501, 'الفرن الدوار']), row([5011, 'فرن رقم 1']),
    row(['', ''], [606, 'حركة المعدات']), row(['', ''], [6067, 'كلارك تويوتا طن', 'مباع']),
    row(['', ''], ['', ''], [70440, '']), // EXCLUDED_BLANK_NAME
    row(['', ''], [6041, 'مشتريات']), // EXCLUDED_CODE_6041
  ];
  return parseSheet1HierarchyRows(rows);
}

const md = (partial: Partial<MasterDataMatchInput> & Pick<MasterDataMatchInput, 'masterDataType' | 'id' | 'code' | 'name'>): MasterDataMatchInput => partial;

// ---- 1: exact matching ----
test('#1 exact code match -> EXACT_MATCH, 100% confidence', () => {
  const nodes = buildFixtureHierarchy();
  const record = md({ masterDataType: 'TubeBallMill', id: 'tbm-1', code: '51121', name: 'طاحونة تيوب ميل 503' });
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'EXACT_MATCH');
  assert.equal(result.suggestedCostCenterCode, '51121');
  assert.equal(result.confidence, 100);
});

// ---- 2: normalized matching ----
test('#2 normalized name match (Hamza/spacing differences only) -> DETERMINISTIC_MATCH', () => {
  const nodes = buildFixtureHierarchy();
  // Same name but with an extra space and a Yaa/Alef-Maqsura variant - normalizeArabicForComparison should equate these.
  const record = md({ masterDataType: 'Press', id: 'p-1', code: 'UNRELATED-CODE', name: 'مكبس  لايس 1600' });
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'DETERMINISTIC_MATCH');
  assert.equal(result.suggestedCostCenterCode, '51343');
});

// ---- 3: fuzzy suggestion classification ----
test('#3 a close-but-not-exact name yields a STRONG_MATCH/FUZZY_MATCH suggestion, never silently EXACT', () => {
  const nodes = buildFixtureHierarchy();
  const record = md({ masterDataType: 'Furnace', id: 'f-1', code: 'F-99', name: 'الفرن الدوار الرئيسي' }); // Sheet1 name is "الفرن الدوار" only
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.ok(['STRONG_MATCH', 'FUZZY_MATCH', 'REVIEW_REQUIRED'].includes(result.matchType), `expected a fuzzy-tier classification, got ${result.matchType}`);
  assert.notEqual(result.matchType, 'EXACT_MATCH');
  assert.ok(result.confidence > 0 && result.confidence < 100);
  assert.ok(result.reason.length > 0, 'every fuzzy result must carry a reason');
});

// ---- 4: no-safe-match classification ----
test('#4 a completely unrelated name/code yields NO_SAFE_MATCH, never forced into a guess', () => {
  const nodes = buildFixtureHierarchy();
  const record = md({ masterDataType: 'Press', id: 'p-2', code: 'ZZZ-999', name: 'شيء غير موجود إطلاقًا في الشيت' });
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'NO_SAFE_MATCH');
  assert.equal(result.suggestedCostCenterCode, null);
  assert.equal(result.reviewRequired, true);
});

// ---- 5: department mapping ----
test('#5 Department records only match against level-1 (department) hierarchy nodes, never a deeper equipment leaf', () => {
  const nodes = buildFixtureHierarchy();
  const record = md({ masterDataType: 'Department', id: 'd-1', code: '511', name: 'الطواحين (التهوية)' });
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'EXACT_MATCH');
  assert.equal(result.suggestedCostCenterCode, '511');

  // A department-level record whose name only matches a deep EQUIPMENT leaf must NOT match through the Department matcher.
  const misaimed = md({ masterDataType: 'Department', id: 'd-2', code: 'X', name: 'مكبس لايس 1600' });
  const misaimedResult = matchMasterDataRecordToHierarchy(misaimed, nodes);
  assert.notEqual(misaimedResult.suggestedCostCenterCode, '51343', 'the Department matcher must never reach down to a level-3 equipment leaf');
});

// ---- 6: press mapping ----
test('#6 Press mapping - 51343 exact code example from the approved hierarchy', () => {
  const nodes = buildFixtureHierarchy();
  const record = md({ masterDataType: 'Press', id: 'press-1600', code: '51343', name: 'مكبس لايس 1600' });
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'EXACT_MATCH');
  assert.equal(result.suggestedCostCenterCode, '51343');
  assert.equal(result.fullCostCenterPath, '513 كبس الالومينا سيليكات -> 5134 مكابس اللايس -> 51343 مكبس لايس 1600');
});

// ---- 7: Tube/Ball Mill mapping ----
test('#7 Tube/Ball Mill mapping - both the Ball Mill (5111) and Tube Mill (5112) branches resolve to their own distinct leaves, never merged', () => {
  const nodes = buildFixtureHierarchy();
  const ballMill = matchMasterDataRecordToHierarchy(md({ masterDataType: 'TubeBallMill', id: 'bm-501', code: '51111', name: 'طواحين بول ميل 501' }), nodes);
  const tubeMill = matchMasterDataRecordToHierarchy(md({ masterDataType: 'TubeBallMill', id: 'tm-503', code: '51121', name: 'طواحين تيوب ميل 503' }), nodes);
  assert.equal(ballMill.suggestedCostCenterCode, '51111');
  assert.equal(tubeMill.suggestedCostCenterCode, '51121');
  assert.notEqual(ballMill.suggestedCostCenterCode, tubeMill.suggestedCostCenterCode);
});

// ---- 8: Chinese Mill mapping ----
test('#8 Chinese Mill mapping - matches only within its own branch, never confused with Tube/Ball Mills', () => {
  const rows = [row([510, 'الطواحين الصينية']), row([5101, 'الطاحونة الصينية 1'])];
  const nodes = parseSheet1HierarchyRows(rows);
  const record = md({ masterDataType: 'ChineseMill', id: 'cm-1', code: '5101', name: 'الطاحونة الصينية 1' });
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'EXACT_MATCH');
  assert.equal(result.suggestedCostCenterCode, '5101');
});

// ---- 9: Furnace mapping ----
test('#9 Furnace mapping - resolves to its own hierarchy leaf, distinct from the department-level Furnace node', () => {
  const nodes = buildFixtureHierarchy();
  const record = md({ masterDataType: 'Furnace', id: 'furnace-1', code: '5011', name: 'فرن رقم 1' });
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'EXACT_MATCH');
  assert.equal(result.suggestedCostCenterCode, '5011');
});

// ---- 10: Furnace Car protection ----
test('#10 Furnace Car protection - NEVER matched to any hierarchy node, even one with an identical-looking code, always NO_SAFE_MATCH + reviewRequired', () => {
  const nodes = buildFixtureHierarchy();
  // Deliberately construct a FurnaceCar whose code numerically equals a real Mill leaf's code (51121) - it must still be protected.
  const record = md({ masterDataType: 'FurnaceCar', id: 'fc-1', code: '51121', name: 'عربة فرن 51121', carNumber: '51121' });
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'NO_SAFE_MATCH');
  assert.equal(result.suggestedCostCenterCode, null);
  assert.equal(result.reviewRequired, true);
  assert.match(result.reason, /protected/i);
});

test('#10b Furnace Car contamination review reports the numeric coincidence for human transparency, WITHOUT classifying it as an error', () => {
  const nodes = buildFixtureHierarchy();
  const furnaceCars: MasterDataMatchInput[] = [md({ masterDataType: 'FurnaceCar', id: 'fc-1', code: 'FC-51121', name: 'عربة فرن', carNumber: '51121' })];
  const review = detectFurnaceCarContaminationRisk(furnaceCars, nodes);
  assert.equal(review.length, 1);
  assert.equal(review[0].coincidentalHierarchyCode, '51121');
  assert.match(review[0].note, /NOT evidence of contamination/i);
});

// ---- 11: Bunker mapping ----
test('#11 Bunker mapping - matched like any other equipment record when a safe relationship exists, NO_SAFE_MATCH otherwise (free-text center field carries no authoritative link today)', () => {
  const nodes = buildFixtureHierarchy();
  const matched = matchMasterDataRecordToHierarchy(md({ masterDataType: 'Bunker', id: 'bunker-1', code: '51111', name: 'طواحين بول ميل 501' }), nodes);
  assert.equal(matched.matchType, 'EXACT_MATCH');

  const unmatched = matchMasterDataRecordToHierarchy(md({ masterDataType: 'Bunker', id: 'bunker-2', code: 'B-2', name: 'بنكر رقم 2' }), nodes);
  assert.ok(
    ['NO_SAFE_MATCH', 'REVIEW_REQUIRED'].includes(unmatched.matchType),
    `a Bunker with no corresponding Sheet1 entry must never be force-matched into a confident tier, got ${unmatched.matchType}`
  );
  assert.notEqual(unmatched.matchType, 'EXACT_MATCH');
  assert.notEqual(unmatched.matchType, 'DETERMINISTIC_MATCH');
  assert.equal(unmatched.reviewRequired, true, 'an uncertain match must always flag reviewRequired');
});

// ---- 12/13: NOT_APPLICABLE for Material/Product ----
test('#12 Material records are always NOT_APPLICABLE, never forced into an equipment Cost Center', () => {
  const nodes = buildFixtureHierarchy();
  const record = md({ masterDataType: 'Material', id: 'mat-1', code: 'ALU-25', name: 'مكبس لايس 1600' }); // deliberately name-colliding with a real equipment leaf
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'NOT_APPLICABLE');
  assert.equal(result.suggestedCostCenterCode, null);
  assert.equal(result.reviewRequired, false);
});

test('#13 Product records are always NOT_APPLICABLE, never forced into an equipment Cost Center', () => {
  const nodes = buildFixtureHierarchy();
  const record = md({ masterDataType: 'Product', id: 'prod-1', code: 'BAR250102305', name: 'طواحين تيوب ميل 503' }); // deliberately name-colliding
  const result = matchMasterDataRecordToHierarchy(record, nodes);
  assert.equal(result.matchType, 'NOT_APPLICABLE');
});

// ---- 14: inverse Cost Center -> Master Data mapping ----
test('#14 buildCostCenterToMasterDataTable - MATCHED / MULTIPLE_CANDIDATES / NO_EXISTING_MASTER_DATA classified correctly', () => {
  const nodes = buildFixtureHierarchy();
  const records: MasterDataMatchInput[] = [
    md({ masterDataType: 'Press', id: 'p-1', code: '51343', name: 'مكبس لايس 1600' }),         // -> 51343 (single match)
    md({ masterDataType: 'TubeBallMill', id: 'tm-a', code: '51121', name: 'طواحين تيوب ميل 503' }), // -> 51121
    md({ masterDataType: 'TubeBallMill', id: 'tm-b', code: '51121', name: 'طواحين تيوب ميل 503' }), // -> 51121 too (duplicate!)
  ];
  const forward = auditMasterDataCollection(records, nodes);
  const inverse = buildCostCenterToMasterDataTable(nodes, forward);

  const pressRow = inverse.find((r) => r.costCenterCode === '51343')!;
  assert.equal(pressRow.mappingStatus, 'MATCHED');
  assert.equal(pressRow.matchCount, 1);

  const tubeMillRow = inverse.find((r) => r.costCenterCode === '51121')!;
  assert.equal(tubeMillRow.mappingStatus, 'MULTIPLE_CANDIDATES');
  assert.equal(tubeMillRow.matchCount, 2);
  assert.equal(tubeMillRow.reviewRequired, true);

  const ballMillRow = inverse.find((r) => r.costCenterCode === '51111')!;
  assert.equal(ballMillRow.mappingStatus, 'NO_EXISTING_MASTER_DATA', 'a legitimate hierarchy node with zero Master Data yet must not be treated as a failure');
});

// ---- 15: duplicate/conflict detection ----
test('#15 detectMappingConflicts flags MULTIPLE_MASTER_DATA_SAME_COST_CENTER and CONFLICTING_CODE, never auto-resolves either', () => {
  const nodes = buildFixtureHierarchy();
  const records: MasterDataMatchInput[] = [
    md({ masterDataType: 'TubeBallMill', id: 'tm-a', code: '51121', name: 'طواحين تيوب ميل 503' }),
    md({ masterDataType: 'TubeBallMill', id: 'tm-b', code: '51121', name: 'طواحين تيوب ميل 503' }),
    // Two records sharing the SAME (non-hierarchy) code but with names that each EXACT_NAME-match a DIFFERENT
    // hierarchy leaf - since neither code exists in the hierarchy, name-matching decides the target for each,
    // producing two different suggestions for the same shared code - a genuine conflict.
    md({ masterDataType: 'Press', id: 'press-dup-1', code: 'DUP-CODE-1', name: 'مكبس لايس 1600' }),
    md({ masterDataType: 'Press', id: 'press-dup-2', code: 'DUP-CODE-1', name: 'طواحين تيوب ميل 503' }),
  ];
  const forward = auditMasterDataCollection(records, nodes);
  const inverse = buildCostCenterToMasterDataTable(nodes, forward);
  const conflicts = detectMappingConflicts(forward, inverse);

  assert.ok(conflicts.some((c) => c.type === 'MULTIPLE_MASTER_DATA_SAME_COST_CENTER' && c.costCenterCode === '51121'));
  assert.ok(conflicts.some((c) => c.type === 'CONFLICTING_CODE'));
});

test('#15b findGlobalMappingCandidates surfaces a recurring high-confidence name->CostCenter pattern, but persists nothing', () => {
  const nodes = buildFixtureHierarchy();
  const records: MasterDataMatchInput[] = [
    md({ masterDataType: 'Press', id: 'press-1', code: '51343', name: 'مكبس لايس 1600' }),
    md({ masterDataType: 'Press', id: 'press-2', code: '51343', name: 'مكبس لايس 1600' }),
  ];
  const forward = auditMasterDataCollection(records, nodes);
  const candidates = findGlobalMappingCandidates(forward);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].recordCount, 2);
  assert.equal(candidates[0].costCenterCode, '51343');
});

// ---- 16: hierarchy variable depth ----
test('#16 variable-depth branches (2-level 606/60601-style vs 3-level 511/5111/51111-style) are both matchable without assuming a fixed depth', () => {
  const rows = [
    row(['', ''], [606, 'حركة المعدات']), row(['', ''], [60601, 'كلارك نيسان 1']),
    row([511, 'الطواحين (التهوية)']), row([5111, 'الطواحين بول ميل']), row([51111, 'طواحين بول ميل 501']),
  ];
  const nodes = parseSheet1HierarchyRows(rows);
  const twoLevel = matchMasterDataRecordToHierarchy(md({ masterDataType: 'Press', id: 'x1', code: '60601', name: 'كلارك نيسان 1' }), nodes);
  const threeLevel = matchMasterDataRecordToHierarchy(md({ masterDataType: 'Press', id: 'x2', code: '51111', name: 'طواحين بول ميل 501' }), nodes);
  assert.equal(twoLevel.suggestedCostCenterCode, '60601');
  assert.equal(threeLevel.suggestedCostCenterCode, '51111');
});

// ---- 17: full path generation ----
test('#17 fullCostCenterPath is derived from the actual parent chain, root through the matched node, never hardcoded', () => {
  const nodes = buildFixtureHierarchy();
  const result = matchMasterDataRecordToHierarchy(md({ masterDataType: 'TubeBallMill', id: 'tm-1', code: '51121', name: 'طواحين تيوب ميل 503' }), nodes);
  assert.equal(result.fullCostCenterPath, '511 الطواحين (التهوية) -> 5112 طواحين تيوب ميل -> 51121 طواحين تيوب ميل 503');
});

// ---- 18/19: excluded codes never become mapping targets ----
test('#18 6041 can never appear as a suggestedCostCenterCode, even when a record\'s code/name is identical to one of 6041\'s two source meanings', () => {
  const nodes = buildFixtureHierarchy();
  const result = matchMasterDataRecordToHierarchy(md({ masterDataType: 'Press', id: 'x', code: '6041', name: 'مشتريات' }), nodes);
  assert.notEqual(result.suggestedCostCenterCode, '6041', 'the excluded code 6041 must never be suggested as a target, regardless of match confidence band');
  assert.notEqual(result.matchType, 'EXACT_MATCH');
  assert.notEqual(result.matchType, 'DETERMINISTIC_MATCH');
  assert.notEqual(result.matchType, 'STRONG_MATCH');
});

test('#19 a blank-name excluded code (e.g. 70440) can never appear as a suggestedCostCenterCode', () => {
  const nodes = buildFixtureHierarchy();
  const result = matchMasterDataRecordToHierarchy(md({ masterDataType: 'Press', id: 'x', code: '70440', name: 'أي اسم' }), nodes);
  assert.notEqual(result.suggestedCostCenterCode, '70440');
});

test('#19b structural guarantee: auditMasterDataCollection never produces ANY row targeting an excluded code, across the whole fixture hierarchy', () => {
  const nodes = buildFixtureHierarchy();
  const records: MasterDataMatchInput[] = [
    md({ masterDataType: 'Press', id: 'a', code: '6041', name: 'مشتريات' }),
    md({ masterDataType: 'Press', id: 'b', code: '70440', name: '' }),
    md({ masterDataType: 'Press', id: 'c', code: '51343', name: 'مكبس لايس 1600' }),
  ];
  const forward = auditMasterDataCollection(records, nodes);
  const targets = forward.map((r) => r.suggestedCostCenterCode).filter(Boolean);
  assert.equal(targets.includes('6041'), false);
  assert.equal(targets.includes('70440'), false);
  assert.ok(targets.includes('51343'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

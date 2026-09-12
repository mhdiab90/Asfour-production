/**
 * MASTER DATA 2.0 - hierarchy, Financial Accounts, category-first Master Data,
 * and the category-aware production filter/reporting engine.
 *
 * Every module under test is deliberately Firebase-free, so these exercise the
 * REAL shipped logic - no shim, no mocks, no Firestore, no network.
 *
 * The properties that matter most here are safety properties:
 *   - a parent selection resolves to the parent AND every descendant, at any depth;
 *   - overlapping branches are unioned and de-duplicated, so no production
 *     record is ever counted twice;
 *   - a hierarchy cycle is refused on the way IN, and survived on the way out;
 *   - a category with no verified production field NEVER narrows production data
 *     and is never presented as a working filter.
 *
 * Source reads normalise line endings, so the suite behaves identically on an
 * LF or a CRLF checkout.
 *
 * Run: npx tsx scripts/tests/masterData2.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('masterData2.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

/** Source with block and line comments stripped - so a test never matches its own explanation. */
function readCode(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

let hier: any;
let reg: any;
let engine: any;
let accounts: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  hier = await load('src/services/hierarchyResolverPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  engine = await load('src/services/productionFilterEnginePure.ts');
  accounts = await load('src/services/financialAccountsPure.ts');
}

/**
 * The exact hierarchy from the business specification.
 *
 *   Production Equipment
 *     Presses
 *       Bo-kher
 *         Bo-kher 900 2
 *         Bo-kher 900 1
 *       Lys
 *     Furnaces
 *       Rotary
 */
function equipmentTree() {
  return [
    { id: 'EQUIP', code: 'EQUIP', name: 'Production Equipment', parentId: null },
    { id: 'PRESS', code: 'PRESS', name: 'Presses', parentId: 'EQUIP' },
    { id: 'BOKHER', code: 'BOKHER', name: 'Bo-kher', parentId: 'PRESS' },
    { id: 'BOK9002', code: 'BOK9002', name: 'Bo-kher 900 2', parentId: 'BOKHER' },
    { id: 'BOK9001', code: 'BOK9001', name: 'Bo-kher 900 1', parentId: 'BOKHER' },
    { id: 'LYS', code: 'LYS', name: 'Lys', parentId: 'PRESS' },
    { id: 'FURN', code: 'FURN', name: 'Furnaces', parentId: 'EQUIP' },
    { id: 'ROTARY', code: 'ROTARY', name: 'Rotary', parentId: 'FURN' },
  ];
}

const idx = () => hier.buildHierarchyIndex(equipmentTree());

// ============================================================================
// A. HIERARCHY - parent / child / grandchild / arbitrary depth
// ============================================================================

test('A1. an index is built once in O(n) with children, roots and a code lookup', () => {
  const index = idx();
  assert.equal(index.size, 8);
  assert.deepEqual(index.rootIds, ['EQUIP']);
  assert.deepEqual(hier.getChildIds(index, 'PRESS'), ['BOKHER', 'LYS']);
  assert.equal(hier.resolveNodeId(index, 'BOKHER'), 'BOKHER');
});

test('A2. TEST 10 - selecting a top parent resolves it plus every descendant', () => {
  const out = hier.resolveHierarchySelection(idx(), 'PRESS');
  assert.deepEqual(out.sort(), ['BOK9001', 'BOK9002', 'BOKHER', 'LYS', 'PRESS']);
});

test('A3. TEST 11 - selecting a mid-level node resolves it plus its own descendants only', () => {
  const out = hier.resolveHierarchySelection(idx(), 'BOKHER');
  assert.deepEqual(out.sort(), ['BOK9001', 'BOK9002', 'BOKHER']);
  assert.equal(out.includes('LYS'), false, 'a sibling branch must never be pulled in');
});

test('A4. TEST 12 - selecting a leaf resolves exactly that node', () => {
  assert.deepEqual(hier.resolveHierarchySelection(idx(), 'BOK9002'), ['BOK9002']);
});

test('A5. depth is unlimited - a grandchild three levels down is still reached', () => {
  const out = hier.resolveHierarchySelection(idx(), 'EQUIP');
  assert.equal(out.length, 8, 'the whole tree, at any depth');
  assert.ok(out.includes('BOK9002'), 'a great-grandchild must be included');
});

test('A6. arbitrary depth - a ten-level chain resolves end to end', () => {
  const chain = Array.from({ length: 10 }, (_, i) => ({
    id: `N${i}`,
    code: `N${i}`,
    parentId: i === 0 ? null : `N${i - 1}`,
  }));
  assert.equal(hier.resolveHierarchySelection(hier.buildHierarchyIndex(chain), 'N0').length, 10);
  assert.equal(hier.getNodeDepth(hier.buildHierarchyIndex(chain), 'N9'), 9);
});

test('A7. includeSelf:false returns descendants only', () => {
  const out = hier.resolveHierarchySelection(idx(), 'BOKHER', { includeSelf: false });
  assert.deepEqual(out.sort(), ['BOK9001', 'BOK9002']);
});

test('A8. an unknown node resolves to nothing rather than throwing', () => {
  assert.deepEqual(hier.resolveHierarchySelection(idx(), 'NOPE'), []);
});

test('A9. a selection may be expressed as a business code, not only an id', () => {
  const nodes = [
    { id: 'doc-1', code: 'PRESS', parentId: null },
    { id: 'doc-2', code: 'BOKHER', parentId: 'doc-1' },
  ];
  const index = hier.buildHierarchyIndex(nodes);
  assert.deepEqual(hier.resolveHierarchySelection(index, 'PRESS').sort(), ['doc-1', 'doc-2']);
  assert.deepEqual(hier.resolveHierarchyCodes(index, ['PRESS']).sort(), ['BOKHER', 'PRESS']);
});

test('A10. ancestors and a readable path come from parent links alone', () => {
  const index = idx();
  assert.deepEqual(hier.getAncestorIds(index, 'BOK9002'), ['EQUIP', 'PRESS', 'BOKHER']);
  assert.equal(
    hier.getNodePath(index, 'BOK9002', (n: any) => n.name),
    'Production Equipment / Presses / Bo-kher / Bo-kher 900 2',
  );
});

test('A11. a node whose parent is missing is kept as a root and reported, never dropped', () => {
  const index = hier.buildHierarchyIndex([
    { id: 'A', code: 'A', parentId: null },
    { id: 'ORPHAN', code: 'ORPHAN', parentId: 'GONE' },
  ]);
  assert.equal(index.size, 2, 'an orphan must stay visible in Master Data');
  assert.deepEqual(hier.findOrphans(index), ['ORPHAN']);
  assert.deepEqual(hier.resolveHierarchySelection(index, 'ORPHAN'), ['ORPHAN']);
});

test('A12. flattenHierarchy renders depth-first with each node carrying its depth', () => {
  const flat = hier.flattenHierarchy(idx());
  assert.equal(flat[0].id, 'EQUIP');
  assert.equal(flat[0].depth, 0);
  assert.equal(flat.find((f: any) => f.id === 'BOK9002').depth, 3);
  assert.equal(flat.length, 8);
});

// ============================================================================
// B. MULTI-BRANCH SELECTION + DEDUPLICATION
// ============================================================================

test('B1. TEST 14 - two branches are unioned', () => {
  const out = hier.resolveMultipleHierarchySelections(idx(), ['PRESS', 'FURN']);
  assert.deepEqual(out.sort(), ['BOK9001', 'BOK9002', 'BOKHER', 'FURN', 'LYS', 'PRESS', 'ROTARY']);
});

test('B2. overlapping selections yield each node exactly once', () => {
  // PRESS already contains BOKHER, so selecting both must not list it twice.
  const out = hier.resolveMultipleHierarchySelections(idx(), ['PRESS', 'BOKHER', 'BOK9002']);
  assert.equal(new Set(out).size, out.length, 'no duplicates in the resolved set');
  assert.deepEqual(out.sort(), ['BOK9001', 'BOK9002', 'BOKHER', 'LYS', 'PRESS']);
});

test('B3. the code form is de-duplicated too', () => {
  const codes = hier.resolveHierarchyCodes(idx(), ['PRESS', 'PRESS', 'BOKHER']);
  assert.equal(new Set(codes).size, codes.length);
});

test('B4. resolveHierarchyCodeSet gives a membership set for filtering', () => {
  const set = hier.resolveHierarchyCodeSet(idx(), ['BOKHER']);
  assert.ok(set.has('BOK9002'));
  assert.equal(set.has('LYS'), false);
});

// ============================================================================
// C. CYCLE REJECTION + EDIT VALIDATION
// ============================================================================

test('C1. TEST 6 - a move that would close A -> B -> C -> A is rejected', () => {
  const index = hier.buildHierarchyIndex([
    { id: 'A', code: 'A', parentId: null },
    { id: 'B', code: 'B', parentId: 'A' },
    { id: 'C', code: 'C', parentId: 'B' },
  ]);
  const result = hier.validateParentAssignment(index, 'A', 'C');
  assert.equal(result.valid, false);
  assert.equal(result.issues[0].code, 'CYCLE');
  assert.ok(result.issues[0].messageAr && result.issues[0].messageEn, 'bilingual reason');
});

test('C2. a node cannot be made its own parent', () => {
  const r = hier.validateParentAssignment(idx(), 'BOKHER', 'BOKHER');
  assert.equal(r.valid, false);
  assert.equal(r.issues[0].code, 'SELF_PARENT');
});

test('C3. a parent that does not exist is rejected', () => {
  const r = hier.validateParentAssignment(idx(), 'BOKHER', 'GHOST');
  assert.equal(r.valid, false);
  assert.equal(r.issues[0].code, 'UNKNOWN_PARENT');
});

test('C4. a direct-child move is rejected (the one-step cycle)', () => {
  const r = hier.validateParentAssignment(idx(), 'PRESS', 'BOKHER');
  assert.equal(r.valid, false, 'PRESS cannot sit under its own child');
});

test('C5. TEST 5 - a legitimate move to another valid parent is allowed', () => {
  assert.equal(hier.validateParentAssignment(idx(), 'LYS', 'FURN').valid, true);
});

test('C6. promoting a node to a root is allowed', () => {
  assert.equal(hier.validateParentAssignment(idx(), 'BOKHER', null).valid, true);
});

test('C7. duplicate codes are refused when uniqueness is required', () => {
  const r = hier.validateNodeEdit(idx(), 'LYS', { code: 'BOKHER' });
  assert.equal(r.valid, false);
  assert.equal(r.issues[0].code, 'DUPLICATE_CODE');
  // Keeping its own code is not a duplicate of itself.
  assert.equal(hier.validateNodeEdit(idx(), 'LYS', { code: 'LYS' }).valid, true);
});

test('C8. a blank code or blank name is refused', () => {
  assert.equal(hier.validateNodeEdit(idx(), 'LYS', { code: '  ' }).issues[0].code, 'EMPTY_CODE');
  assert.equal(hier.validateNodeEdit(idx(), 'LYS', { name: '' }).issues[0].code, 'EMPTY_NAME');
});

test('C9. every problem with one edit is reported at once, not just the first', () => {
  const r = hier.validateNodeEdit(idx(), 'PRESS', { code: 'BOKHER', name: '', parentId: 'BOKHER' });
  const codes = r.issues.map((i: any) => i.code).sort();
  assert.deepEqual(codes, ['CYCLE', 'DUPLICATE_CODE', 'EMPTY_NAME']);
});

test('C10. a cycle already present in stored data is detected, not hidden', () => {
  const cyclic = hier.buildHierarchyIndex([
    { id: 'A', code: 'A', parentId: 'C' },
    { id: 'B', code: 'B', parentId: 'A' },
    { id: 'C', code: 'C', parentId: 'B' },
  ]);
  const cycles = hier.detectExistingCycles(cyclic);
  assert.equal(cycles.length >= 1, true);
  assert.equal(new Set(cycles[0]).size, 3);
});

test('C11. resolution over already-cyclic data terminates and counts each node once', () => {
  const cyclic = hier.buildHierarchyIndex([
    { id: 'A', code: 'A', parentId: 'C' },
    { id: 'B', code: 'B', parentId: 'A' },
    { id: 'C', code: 'C', parentId: 'B' },
  ]);
  const out = hier.resolveHierarchySelection(cyclic, 'A');
  assert.equal(new Set(out).size, out.length, 'a visited set makes a cycle finite');
  assert.ok(out.length <= 3);
});

test('C12. flatten and ancestors also survive a cyclic import', () => {
  const cyclic = hier.buildHierarchyIndex([
    { id: 'A', code: 'A', parentId: 'C' },
    { id: 'B', code: 'B', parentId: 'A' },
    { id: 'C', code: 'C', parentId: 'B' },
  ]);
  assert.ok(hier.getAncestorIds(cyclic, 'A').length <= 3);
  assert.ok(hier.flattenHierarchy(cyclic).length <= 3);
});

// ============================================================================
// D. HIERARCHY CHANGE IMPACT (§38)
// ============================================================================

test('D1. TEST 5 - after moving B under C, A no longer resolves B and C does', () => {
  const before = hier.buildHierarchyIndex([
    { id: 'A', code: 'A', parentId: null },
    { id: 'B', code: 'B', parentId: 'A' },
    { id: 'C', code: 'C', parentId: null },
  ]);
  assert.ok(hier.resolveHierarchySelection(before, 'A').includes('B'));

  const after = hier.applyParentChange(before, 'B', 'C');
  assert.equal(hier.resolveHierarchySelection(after, 'A').includes('B'), false,
    'reports for A must stop including B');
  assert.ok(hier.resolveHierarchySelection(after, 'C').includes('B'),
    'reports for C must start including B');
});

test('D2. applyParentChange returns a NEW index and never mutates the caller array', () => {
  const nodes = equipmentTree();
  const index = hier.buildHierarchyIndex(nodes);
  hier.applyParentChange(index, 'LYS', 'FURN');
  assert.equal(nodes.find((n) => n.id === 'LYS')!.parentId, 'PRESS', 'the input array is untouched');
});

// ============================================================================
// E. CATEGORY REGISTRY - category-first Master Data
// ============================================================================

test('E1. TEST 1 - each category names exactly one data source', () => {
  for (const c of reg.MASTER_DATA_CATEGORIES) {
    const hasSource = c.collection != null || c.reader != null || c.id === 'productionCenters';
    assert.ok(hasSource, `${c.id} must have a real data source or be the virtual stage list`);
    assert.ok(c.labelAr && c.labelEn, `${c.id} needs both labels`);
    assert.ok(c.codeField, `${c.id} needs a code field`);
  }
});

test('E2. Financial Accounts have their OWN collection, not the departments one', () => {
  const fa = reg.getCategory('financialAccounts');
  assert.equal(fa.collection, 'financialAccounts');
  assert.notEqual(fa.collection, 'departments',
    'accounts stored in departments would corrupt the employee department picker');
  assert.equal(fa.hierarchical, true);
  assert.equal(fa.parentField, 'parentCode');
  assert.equal(fa.supportsImport, true);
  assert.equal(fa.supportsEdit, true);
});

test('E3. Production Centers, Cost Centers and Hierarchical Cost Centers stay three distinct things', () => {
  assert.equal(reg.getCategory('productionCenters').codeField, 'stageType');
  assert.equal(reg.getCategory('costCenters').collection, 'departments');
  assert.equal(reg.getCategory('hierarchicalCostCenters').reader, 'costCenterHierarchy');
  const sources = ['productionCenters', 'costCenters', 'hierarchicalCostCenters']
    .map((id) => reg.getCategory(id))
    .map((c: any) => `${c.collection}|${c.reader}`);
  assert.equal(new Set(sources).size, 3, 'three categories, three different sources');
});

test('E4. TEST 15 - only verified mappings may filter production', () => {
  const filterable = reg.productionFilterCategories().map((c: any) => c.id).sort();
  assert.deepEqual(filterable, ['customers', 'productionCenters', 'products']);
  for (const id of ['financialAccounts', 'costCenters', 'hierarchicalCostCenters', 'materials', 'presses']) {
    assert.equal(reg.supportsProductionFilter(id), false, `${id} has no verified production field`);
  }
});

test('E5. the registry stays data-driven and Firebase-free', () => {
  const src = readSource('src/services/masterDataCategoryRegistry.ts');
  assert.ok(/MASTER_DATA_CATEGORIES: MasterDataCategory\[\]/.test(src));
  assert.equal(/from ['"]firebase|config\/firebase/.test(src), false);
  assert.equal(/getDocs|onSnapshot/.test(readCode('src/services/masterDataCategoryRegistry.ts')), false);
});

test('E6. every category with a tab maps to a real MasterDataTab', () => {
  const tabs = readSource('src/types/index.ts');
  for (const c of reg.MASTER_DATA_CATEGORIES) {
    if (!c.tab) continue;
    assert.ok(new RegExp(`\\|\\s*'${c.tab}'`).test(tabs), `MasterDataTab must include '${c.tab}'`);
  }
});

test('E7. hierarchical categories all declare which field holds the parent', () => {
  for (const c of reg.hierarchicalCategories()) {
    assert.ok(c.parentField, `${c.id} is hierarchical so it must name its parent field`);
  }
  assert.deepEqual(
    reg.hierarchicalCategories().map((c: any) => c.id).sort(),
    ['financialAccounts', 'hierarchicalCostCenters'],
  );
});

test('E8. a future category needs no screen change - both screens read the registry', () => {
  const md = readCode('src/components/masterData/MasterDataView.tsx');
  assert.ok(/MASTER_DATA_CATEGORIES/.test(md), 'Master Data renders categories from the registry');
  const dr = readCode('src/components/production/DataReviewView.tsx');
  assert.ok(/MASTER_DATA_CATEGORIES/.test(dr), 'Production Review renders categories from the registry');
});

// ============================================================================
// F. PRODUCTION FILTER ENGINE - ONE / MULTIPLE / ALL + hierarchy
// ============================================================================

const prodRecords = () => [
  { id: '1', stageType: 'pressing', productId: 'p1', productCode: 'P-100', customerId: 'c1', quantity: 10, productionTons: 1 },
  { id: '2', stageType: 'sorting', productId: 'p2', productCode: 'P-200', customerId: 'c2', quantity: 20, productionTons: 2 },
  { id: '3', stageType: 'mixing', productId: 'p1', productCode: 'P-100', customerId: 'c1', quantity: 30, productionTons: 3 },
];

test('F1. TEST 7 - ONE code returns only matching records', () => {
  const sel = reg.normaliseSelection('productionCenters', ['pressing'], false);
  assert.equal(sel.mode, 'ONE');
  assert.deepEqual(engine.filterProductionRecords(prodRecords(), sel).map((r: any) => r.id), ['1']);
});

test('F2. TEST 8 - MULTIPLE codes match ANY selected code', () => {
  const sel = reg.normaliseSelection('productionCenters', ['pressing', 'mixing'], false);
  assert.equal(sel.mode, 'MULTIPLE');
  assert.deepEqual(engine.filterProductionRecords(prodRecords(), sel).map((r: any) => r.id), ['1', '3']);
});

test('F3. TEST 9 - ALL is a mode and returns everything in the category', () => {
  const sel = reg.normaliseSelection('productionCenters', [], true);
  assert.equal(sel.mode, 'ALL');
  assert.deepEqual(sel.codes, [], 'ALL must never materialise every code');
  assert.equal(engine.filterProductionRecords(prodRecords(), sel).length, 3);
});

test('F4. products match on either id or code', () => {
  assert.deepEqual(
    engine.filterProductionRecords(prodRecords(), reg.normaliseSelection('products', ['P-200'], false)).map((r: any) => r.id),
    ['2'],
  );
  assert.deepEqual(
    engine.filterProductionRecords(prodRecords(), reg.normaliseSelection('products', ['p1'], false)).map((r: any) => r.id),
    ['1', '3'],
  );
});

test('F5. TEST 15 - an unmappable category is refused, with the reason, and narrows nothing', () => {
  const sel = reg.normaliseSelection('financialAccounts', ['1101'], false);
  const resolved = engine.resolveProductionFilter(sel);
  assert.equal(resolved.applicable, false);
  assert.equal(resolved.matchValues, null);
  assert.ok(resolved.reasonAr.length > 0 && resolved.reasonEn.length > 0);
  // It must NOT return zero rows - that would read as "this account has no production".
  assert.equal(engine.filterProductionRecords(prodRecords(), sel).length, 3);
});

test('F6. the unavailable reason names the category and says Master Data still works', () => {
  const reason = engine.unavailableReason(reg.getCategory('financialAccounts'));
  assert.ok(reason.ar.includes('الحسابات المالية'));
  assert.ok(/Master Data/.test(reason.en));
});

test('F7. TEST 10 (filtering) - a hierarchical parent selection expands to its descendants', () => {
  // A synthetic hierarchical category with a verified field, proving the
  // expansion path end to end independently of which categories are
  // hierarchical in production today.
  const records = [
    { id: 'a', stageType: 'PRESS' },
    { id: 'b', stageType: 'BOKHER' },
    { id: 'c', stageType: 'BOK9002' },
    { id: 'd', stageType: 'ROTARY' },
  ];
  const category = { ...reg.getCategory('productionCenters'), hierarchical: true };
  const original = reg.MASTER_DATA_CATEGORIES.findIndex((c: any) => c.id === 'productionCenters');
  const saved = reg.MASTER_DATA_CATEGORIES[original];
  reg.MASTER_DATA_CATEGORIES[original] = category;
  try {
    const sel = reg.normaliseSelection('productionCenters', ['PRESS'], false);
    const out = engine.filterProductionRecords(records, sel, { nodes: equipmentTree() });
    assert.deepEqual(out.map((r: any) => r.id).sort(), ['a', 'b', 'c'],
      'the user selected only PRESS and must still get every press beneath it');
    assert.equal(out.some((r: any) => r.id === 'd'), false, 'a different branch must not appear');
  } finally {
    reg.MASTER_DATA_CATEGORIES[original] = saved;
  }
});

test('F8. a code the hierarchy does not know still narrows - it is never widened away', () => {
  const category = { ...reg.getCategory('productionCenters'), hierarchical: true };
  const original = reg.MASTER_DATA_CATEGORIES.findIndex((c: any) => c.id === 'productionCenters');
  const saved = reg.MASTER_DATA_CATEGORIES[original];
  reg.MASTER_DATA_CATEGORIES[original] = category;
  try {
    const sel = reg.normaliseSelection('productionCenters', ['pressing'], false);
    const out = engine.filterProductionRecords(prodRecords(), sel, { nodes: equipmentTree() });
    assert.deepEqual(out.map((r: any) => r.id), ['1']);
  } finally {
    reg.MASTER_DATA_CATEGORIES[original] = saved;
  }
});

test('F9. resolveProductionFilter reports whether hierarchy expansion happened', () => {
  const flat = engine.resolveProductionFilter(reg.normaliseSelection('products', ['p1'], false));
  assert.equal(flat.expandedFromHierarchy, false);
  assert.equal(flat.resolvedCodeCount, 1);
});

test('F10. no category filter at all leaves the records alone', () => {
  const sel = reg.normaliseSelection(null, [], true);
  assert.equal(engine.filterProductionRecords(prodRecords(), sel).length, 3);
});

test('F11. the engine performs no Firestore access - it filters an already-fetched set', () => {
  const src = readCode('src/services/productionFilterEnginePure.ts');
  assert.equal(/getDocs|onSnapshot|firebase\/firestore|fetch\(/.test(src), false,
    'a query per code or per child would be exactly the N+1 the quota programme forbids');
});

test('F12. the engine does not re-implement descendant walking - it delegates to the resolver', () => {
  const src = readCode('src/services/productionFilterEnginePure.ts');
  assert.ok(/resolveHierarchyCodes/.test(src), 'must call the shared resolver');
  assert.equal(/childrenByParent\s*\.get|while\s*\(\s*frontier/.test(src), false,
    'a second descendant walk would let two screens disagree about a total');
});

// ============================================================================
// G. AGGREGATION SAFETY (§25, §26)
// ============================================================================

test('G1. TEST 13 - a report for a parent aggregates every descendant record', () => {
  const records = [
    { id: 'a', stageType: 'BOKHER', quantity: 10, productionTons: 1 },
    { id: 'b', stageType: 'BOK9002', quantity: 20, productionTons: 2 },
    { id: 'c', stageType: 'LYS', quantity: 5, productionTons: 0.5 },
    { id: 'd', stageType: 'ROTARY', quantity: 100, productionTons: 10 },
  ];
  const original = reg.MASTER_DATA_CATEGORIES.findIndex((c: any) => c.id === 'productionCenters');
  const saved = reg.MASTER_DATA_CATEGORIES[original];
  reg.MASTER_DATA_CATEGORIES[original] = { ...saved, hierarchical: true };
  try {
    const total = engine.aggregateProductionForSelection(
      records,
      reg.normaliseSelection('productionCenters', ['PRESS'], false),
      { nodes: equipmentTree() },
    );
    assert.equal(total.recordCount, 3, 'Bo-kher, Bo-kher 900 2 and Lys - the whole Presses branch');
    assert.equal(total.quantity, 35);
    assert.equal(total.productionTons, 3.5);

    const bokher = engine.aggregateProductionForSelection(
      records,
      reg.normaliseSelection('productionCenters', ['BOKHER'], false),
      { nodes: equipmentTree() },
    );
    assert.equal(bokher.quantity, 30, 'Bo-kher plus its descendants only');

    const leaf = engine.aggregateProductionForSelection(
      records,
      reg.normaliseSelection('productionCenters', ['BOK9002'], false),
      { nodes: equipmentTree() },
    );
    assert.equal(leaf.quantity, 20, 'exactly the leaf');
  } finally {
    reg.MASTER_DATA_CATEGORIES[original] = saved;
  }
});

test('G2. TEST 14 - two selected branches never double-count a shared record', () => {
  const records = [
    { id: 'a', stageType: 'BOKHER', quantity: 10 },
    { id: 'b', stageType: 'ROTARY', quantity: 100 },
  ];
  const original = reg.MASTER_DATA_CATEGORIES.findIndex((c: any) => c.id === 'productionCenters');
  const saved = reg.MASTER_DATA_CATEGORIES[original];
  reg.MASTER_DATA_CATEGORIES[original] = { ...saved, hierarchical: true };
  try {
    // PRESS already contains BOKHER; selecting both must not count 'a' twice.
    const total = engine.aggregateProductionForSelection(
      records,
      reg.normaliseSelection('productionCenters', ['PRESS', 'BOKHER', 'FURN'], false),
      { nodes: equipmentTree() },
    );
    assert.equal(total.recordCount, 2);
    assert.equal(total.quantity, 110);
  } finally {
    reg.MASTER_DATA_CATEGORIES[original] = saved;
  }
});

test('G3. dedupeRecordsById collapses repeats but never discards an id-less record', () => {
  const out = engine.dedupeRecordsById([{ id: 'x' }, { id: 'x' }, { id: 'y' }, {}, {}]);
  assert.equal(out.filter((r: any) => r.id === 'x').length, 1);
  assert.equal(out.filter((r: any) => r.id === undefined).length, 2,
    'dropping data to make a total tidy would be worse than a duplicate');
});

test('G4. aggregation adds a dimension without touching the caller other filters', () => {
  // Only the already-filtered list is narrowed - the engine never re-fetches
  // and never re-applies date/stage/status/search itself.
  const alreadyFiltered = [{ id: '1', stageType: 'pressing', quantity: 7 }];
  const total = engine.aggregateProductionForSelection(
    alreadyFiltered,
    reg.normaliseSelection('productionCenters', [], true),
  );
  assert.equal(total.quantity, 7);
  const src = readCode('src/services/productionFilterEnginePure.ts');
  assert.equal(/startDate|endDate|status\s*===|searchQuery/.test(src), false,
    'the engine must not silently re-decide another dimension');
});

test('G5. an unmappable category never produces a misleading total', () => {
  const total = engine.aggregateProductionForSelection(
    prodRecords(),
    reg.normaliseSelection('financialAccounts', ['1101'], false),
  );
  assert.equal(total.applicable, false, 'the caller is told the number is not account-scoped');
});

// ============================================================================
// H. FINANCIAL ACCOUNTS - model, validation, import, hierarchy
// ============================================================================

const sampleAccounts = () => [
  { id: '1', code: '1', name: 'الأصول', parentCode: null, active: true },
  { id: '2', code: '11', name: 'الأصول المتداولة', parentCode: '1', active: true },
  { id: '3', code: '1101', name: 'النقدية بالخزينة', parentCode: '11', active: true },
  { id: '4', code: '1102', name: 'البنوك', parentCode: '11', active: true },
  { id: '5', code: '2', name: 'الالتزامات', parentCode: null, active: true },
];

test('H1. the account model has exactly the declared fields and no invented ones', () => {
  const src = readSource('src/types/index.ts');
  const block = src.slice(src.indexOf('export interface FinancialAccount {'));
  const body = block.slice(0, block.indexOf('}'));
  for (const f of ['code', 'name', 'nameEn', 'parentCode', 'accountType', 'description', 'active']) {
    assert.ok(new RegExp(`\\b${f}\\??:`).test(body), `${f} must be part of the model`);
  }
  for (const invented of ['balance', 'debit', 'credit', 'currency', 'fiscalYear', 'openingBalance']) {
    assert.equal(new RegExp(`\\b${invented}\\??:`).test(body), false,
      `${invented} would be an accounting engine, not Master Data`);
  }
});

test('H2. TEST 2 - required fields are validated per row, independently', () => {
  assert.deepEqual(accounts.validateAccountFields({ code: 'A', name: 'x' }), []);
  const missing = accounts.validateAccountFields({ code: '', name: '' });
  assert.deepEqual(missing.map((i: any) => i.field).sort(), ['code', 'name']);
  for (const issue of missing) assert.ok(issue.messageAr && issue.messageEn);
});

test('H3. normalisation trims and refuses a self-referencing parent', () => {
  const a = accounts.normaliseAccount({ code: ' 1101 ', name: ' نقدية ', parentCode: ' 1101 ' });
  assert.equal(a.code, '1101');
  assert.equal(a.name, 'نقدية');
  assert.equal(a.parentCode, null, 'a one-node cycle must never be stored');
});

test('H4. accounts adapt to the SHARED resolver - a parent means all descendants', () => {
  const index = hier.buildHierarchyIndex(accounts.toHierarchyNodes(sampleAccounts()));
  assert.deepEqual(hier.resolveHierarchySelection(index, '1').sort(), ['1', '11', '1101', '1102']);
  assert.deepEqual(hier.resolveHierarchySelection(index, '11').sort(), ['11', '1101', '1102']);
  assert.deepEqual(hier.resolveHierarchySelection(index, '1101'), ['1101']);
});

test('H5. a missing parent is inferred only from a code that really exists', () => {
  const derived = accounts.deriveMissingParents([
    { code: '1', name: 'a' },
    { code: '11', name: 'b' },
    { code: '1101', name: 'c' },
    { code: '9999', name: 'orphan' },
  ]);
  assert.equal(derived.find((a: any) => a.code === '11').parentCode, '1');
  assert.equal(derived.find((a: any) => a.code === '1101').parentCode, '11');
  assert.equal(derived.find((a: any) => a.code === '9999').parentCode, null,
    'no parent may be conjured from a code nobody imported');
});

test('H6. an explicitly stated parent is never overwritten by inference', () => {
  const derived = accounts.deriveMissingParents([
    { code: '1', name: 'a' },
    { code: '11', name: 'b' },
    { code: '1101', name: 'c', parentCode: '1' },
  ]);
  assert.equal(derived.find((a: any) => a.code === '1101').parentCode, '1',
    'what the sheet states beats what a prefix suggests');
});

test('H7. inference can be switched off entirely', () => {
  const derived = accounts.deriveMissingParents(
    [{ code: '1', name: 'a' }, { code: '11', name: 'b' }],
    { infer: false },
  );
  assert.equal(derived.find((a: any) => a.code === '11').parentCode, null);
});

test('H8. parent inference reuses the existing cost-centre primitive', () => {
  const src = readCode('src/services/financialAccountsPure.ts');
  assert.ok(/resolveParentCode/.test(src), 'reuses costCenterHierarchyPure rather than a new rule');
});

test('H9. search stays inside the account set and matches its own fields', () => {
  const found = accounts.searchAccounts(sampleAccounts(), 'نقدية');
  assert.deepEqual(found.map((a: any) => a.code), ['1101']);
  assert.equal(accounts.searchAccounts(sampleAccounts(), '11').length, 3, 'code prefix matches');
  assert.equal(accounts.searchAccounts(sampleAccounts(), '').length, 5, 'empty query returns all');
});

test('H10. TEST 3 / §13 - a code change is only called safe when nothing references it', () => {
  const withChildren = accounts.assessCodeChangeImpact(sampleAccounts(), '11');
  assert.equal(withChildren.safe, false);
  assert.equal(withChildren.childCount, 2);
  assert.deepEqual(withChildren.affectedChildCodes.sort(), ['1101', '1102']);

  const leaf = accounts.assessCodeChangeImpact(sampleAccounts(), '1101');
  assert.equal(leaf.safe, true);
  assert.ok(/production/i.test(leaf.reasonEn), 'the reason states why history is unaffected');
});

test('H11. the import goes through the SHARED engine - one schema entry, no second importer', () => {
  const src = readSource('src/services/bulkImportService.ts');
  assert.ok(/financialAccounts:\s*\{/.test(src), 'a schema entry in MASTER_DATA_SCHEMAS');
  assert.ok(/key: 'parentCode'/.test(src), 'the parent column is mappable');
  assert.ok(/key: 'accountType'/.test(src));
  // Required vs optional, exactly as the model states. The schema entry runs
  // from its own key to the end of MASTER_DATA_SCHEMAS - slicing at the first
  // ']' would stop inside the first field's own `aliases` array.
  const start = src.indexOf('financialAccounts: {');
  const fields = src.slice(start, src.indexOf('};', start));
  assert.ok(/key: 'code',[^}]*required: true/.test(fields), 'code is required');
  assert.ok(/key: 'name',[^}]*required: true/.test(fields), 'name is required');
  assert.ok(/key: 'parentCode',[^}]*required: false/.test(fields), 'parentCode is optional');
  assert.ok(/key: 'nameEn',[^}]*required: false/.test(fields), 'nameEn is optional');
});

test('H12. TEST 2 - the shared importer keeps partial import and duplicate detection', () => {
  const src = readCode('src/services/bulkImportService.ts');
  assert.ok(/DUPLICATE_IN_FILE/.test(src), 'duplicate codes inside the uploaded file');
  assert.ok(/DUPLICATE_IN_FIRESTORE/.test(src), 'duplicate codes already stored');
  assert.ok(/blockedByFinalRecheckRows/.test(src), 'a final pre-write recheck');
  assert.ok(/rowsToImport|finalRowsToImport/.test(src), 'valid rows import even when others fail');
});

test('H13. §30 - a bulk import invalidates that collection cache, and only that one', () => {
  const src = readCode('src/services/bulkImportService.ts');
  assert.ok(/invalidateCachedCollection\(\s*auth\.currentUser/.test(src),
    'otherwise a successful import looks like a failed one until the cache expires');
  assert.equal(/clearLocalCacheForUser|clearAll/.test(src), false,
    'never a full cache clear - the app must not re-read the whole database');
});

test('H14. the account service reuses the existing Master Data primitives', () => {
  const src = readCode('src/services/financialAccountService.ts');
  for (const primitive of ['fetchMasterData', 'createMasterDataItem', 'updateMasterDataItem']) {
    assert.ok(new RegExp(primitive).test(src), `must reuse ${primitive}`);
  }
  assert.equal(/addDoc|setDoc|writeBatch|getDocs/.test(src), false,
    'a second CRUD path would mean two audit and cache behaviours to keep in step');
});

test('H15. §33 - the new collection is declared in the rules with the standard pattern', () => {
  const rules = readSource('firestore.rules');
  const start = rules.indexOf('match /financialAccounts/');
  assert.ok(start > 0, 'the new collection must be declared - this ruleset denies everything unmatched');
  // The wildcard `{accountId}` contains the first '}', so measure the body from
  // the opening brace of the block itself.
  const bodyStart = rules.indexOf('{', rules.indexOf('}', start));
  const body = rules.slice(bodyStart, rules.indexOf('}', bodyStart + 1));
  assert.ok(/allow read: if isSignedIn\(\);/.test(body), 'same read rule as every Master Data collection');
  assert.ok(/allow write: if isAdmin\(\);/.test(body), 'same write rule - no new privilege');
});

// ============================================================================
// I. PRESERVED BEHAVIOUR (§37, §42)
// ============================================================================

test('I1. Bulk Edit still writes only `notes`, and its protected list is intact', async () => {
  const bulk: any = await import(pathToFileURL(path.join(ROOT, 'src/services/bulkEditPure.ts')).href);
  assert.deepEqual([...bulk.BULK_EDITABLE_FIELDS], ['notes'],
    'new Master Data categories must not widen what a bulk edit may write');
  for (const f of ['quantity', 'status', 'productId', 'customerId', 'stageType']) {
    assert.equal(bulk.isBulkEditable(f), false);
  }
});

test('I2. Bulk Edit still intersects selected ids with visible rows', async () => {
  const bulk: any = await import(pathToFileURL(path.join(ROOT, 'src/services/bulkEditPure.ts')).href);
  const plan = bulk.planBulkEdit(
    { selectedIds: ['a', 'gone'] },
    [{ id: 'a', stageType: 'pressing' }],
    { notes: 'x' },
  );
  assert.deepEqual(plan.targets.map((t: any) => t.id), ['a']);
  assert.equal(plan.skipped.length, 1, 'a row that is no longer visible is never written to');
});

test('I3. no Bulk Delete was introduced anywhere in this change', () => {
  for (const rel of [
    'src/services/hierarchyResolverPure.ts',
    'src/services/productionFilterEnginePure.ts',
    'src/services/financialAccountsPure.ts',
    'src/services/financialAccountService.ts',
    'src/services/masterDataCategoryRegistry.ts',
  ]) {
    const src = readCode(rel);
    assert.equal(/deleteDoc|bulkDelete|deleteStageRecord|deleteMany/.test(src), false,
      `${rel} must contain no deletion path`);
  }
});

test('I4. stage records still have no delete primitive', () => {
  const svc = readCode('src/services/stageRecordService.ts');
  assert.equal(/export async function deleteStageRecord/.test(svc), false);
});

test('I5. §39 - no production record is rewritten when a hierarchy node moves', () => {
  const src = readCode('src/services/costCenterHierarchyService.ts');
  const editBlock = src.slice(src.indexOf('export async function updateCostCenterHierarchyNode'));
  for (const collection of ['production', 'stage_rotary_furnace', 'stage_sorting', 'stage_mixing']) {
    assert.equal(new RegExp(`['"]${collection}['"]`).test(editBlock), false,
      'a hierarchy move must never touch historical production data');
  }
});

test('I6. hierarchy editing reuses the existing reader and audit, adding neither', () => {
  const src = readCode('src/services/costCenterHierarchyService.ts');
  assert.ok(/listCostCenterHierarchyNodes/.test(src), 'the existing reader is kept');
  assert.equal((src.match(/export async function listCostCenterHierarchyNodes/g) || []).length, 1,
    'exactly one reader - never a second');
  assert.ok(/logAuditAction/.test(src), 'edits go to the existing audit infrastructure');
  assert.ok(/invalidateCachedCollection/.test(src), 'the shared cache is refreshed after an edit');
});

test('I7. the hierarchy document id (sheet1Code) is not editable', () => {
  const src = readCode('src/services/costCenterHierarchyService.ts');
  const patch = src.slice(src.indexOf('export interface CostCenterHierarchyNodePatch'));
  const body = patch.slice(0, patch.indexOf('}'));
  assert.equal(/sheet1Code\??:/.test(body), false,
    'it is the document id and every child parent link - renaming it would orphan a branch');
});

test('I8. there is exactly ONE hierarchy resolver in the codebase', () => {
  const dir = path.join(ROOT, 'src/services');
  const resolverFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && fs.statSync(path.join(dir, f)).isFile())
    .filter((f) => !/hierarchyResolverPure/.test(f))
    .filter((f) => /resolveHierarchySelection/.test(readSource(`src/services/${f}`)));
  for (const f of resolverFiles) {
    const src = readCode(`src/services/${f}`);
    assert.ok(/from '\.\/hierarchyResolverPure'/.test(src) || /hierarchyResolverPure/.test(src),
      `${f} must import the shared resolver rather than define its own`);
  }
});

test('I9. §31 - no new permission key was invented', () => {
  const perms = readSource('src/types/permissions.ts');
  for (const invented of ['financialAccounts.view', 'financialAccounts.edit', 'hierarchy.edit', 'masterdata.edit']) {
    assert.equal(perms.includes(`'${invented}'`), false, `${invented} must not be introduced`);
  }
  assert.ok(perms.includes("'masterdata.view'"), 'the existing view permission is still there');
  assert.ok(perms.includes("'excel.import'"), 'the existing import permission is still there');
});

test('I10. §34 - no new per-code or per-child query was introduced', () => {
  for (const rel of [
    'src/services/hierarchyResolverPure.ts',
    'src/services/productionFilterEnginePure.ts',
    'src/services/financialAccountsPure.ts',
  ]) {
    const src = readCode(rel);
    assert.equal(/getDocs|onSnapshot|firebase\/firestore/.test(src), false, `${rel} must stay Firebase-free`);
  }
});

// ==================================================
// J. FINANCIAL ACCOUNT IMPORT ROUTING (§14 TEST 1-8)
//
// The defect: "Import Financial Accounts" called onNavigate('bulk-entry'), and
// App.tsx routes BOTH `bulk-entry` AND `historical-import` to <DataImportView />
// - the Historical Excel Import centre. So a Master Data import opened the
// historical production importer.
//
// These assertions are about the shipped wiring, so they read the real source.
// Comments are stripped first (readCode), so a test can never be satisfied by
// the prose explaining it.
// ==================================================

const MDV = 'src/components/masterData/MasterDataView.tsx';
const IMPORT_MODAL = 'src/components/masterData/FinancialAccountsImportModal.tsx';

test('J1. TEST 1 - the Financial Accounts import action opens the dedicated importer', () => {
  const src = readCode(MDV);
  const start = src.indexOf("activeTab === 'financialAccounts' && (");
  assert.ok(start > 0, 'the Financial Accounts action block must exist');
  const block = src.slice(start, start + 1200);
  assert.ok(
    /setIsAccountsImportOpen\(true\)/.test(block),
    'the action must open the dedicated Financial Accounts importer',
  );
  assert.ok(
    /<FinancialAccountsImportModal/.test(src) && /isOpen=\{isAccountsImportOpen\}/.test(src),
    'the dedicated importer must actually be rendered inside Master Data',
  );
});

test('J2. TEST 2 - Master Data never navigates to the Historical Import route for accounts', () => {
  const src = readCode(MDV);
  const start = src.indexOf("activeTab === 'financialAccounts' && (");
  const block = src.slice(start, start + 1200);
  for (const route of ["'bulk-entry'", "'historical-import'"]) {
    assert.equal(
      block.includes(`onNavigate(${route})`),
      false,
      `the Financial Accounts import action must not navigate to ${route}`,
    );
  }
  // And the importer itself must never navigate anywhere at all.
  const modal = readCode(IMPORT_MODAL);
  assert.equal(
    /onNavigate|historical-import|bulk-entry/.test(modal),
    false,
    'the dedicated importer must not navigate; it stays inside Master Data',
  );
});

test('J3. TEST 2b - the prefill that pointed at the bulk-entry route is gone', () => {
  assert.equal(
    /BULK_IMPORT_PREFILL_KEY/.test(readCode(MDV)),
    false,
    'Master Data must no longer hand a prefill to the bulk-entry route',
  );
  assert.equal(
    /BULK_IMPORT_PREFILL_KEY/.test(readCode('src/components/bulk/BulkEntryView.tsx')),
    false,
    'the now-unset prefill mechanism must not be left behind',
  );
});

test('J4. TEST 3 - the importer reuses the shipped financialAccounts schema, and defines no second one', () => {
  const src = readCode(IMPORT_MODAL);
  assert.ok(/MASTER_DATA_SCHEMAS/.test(src), 'must read the existing schema registry');
  assert.ok(/MASTER_DATA_SCHEMAS\.financialAccounts/.test(src), 'must use the financialAccounts schema entry');
  assert.equal(/fields:\s*\[/.test(src), false, 'must not declare a second field list of its own');
  assert.equal(/XLSX\.read/.test(src), false, 'must not open a second XLSX reader');
});

test('J5. TEST 4/5 - preview and validation run through the existing import services', () => {
  const src = readCode(IMPORT_MODAL);
  for (const fn of ['listImportSheetNames', 'parseImportFile', 'validateImportData', 'commitBulkImport']) {
    assert.ok(src.includes(fn), `must reuse ${fn} rather than reimplementing it`);
  }
  assert.ok(
    /validateAccountImportRelationships/.test(src),
    'must additionally check the parent relationships the shared importer cannot know about',
  );
});

test('J6. TEST 5 - only importable rows are written; a bad row cannot block the valid ones', () => {
  const src = readCode(IMPORT_MODAL);
  assert.ok(
    /status === 'valid' \|\| row\.status === 'NEW'/.test(src),
    'the writable set must be exactly the shared valid/NEW rule',
  );
  // The execute button is driven by the READY count, never by the whole file being clean.
  assert.ok(/summary\.ready === 0/.test(src), 'execution must be gated on the ready count');
  assert.equal(
    /summary\.invalid > 0|problemRows\.length > 0 \|\|/.test(src),
    false,
    'the presence of a bad row must not block execution',
  );
});

test('J7. TEST 6 - imported accounts appear without a reload', () => {
  const mdv = readCode(MDV);
  // The list is a live listener, so new documents arrive on their own.
  assert.ok(/subscribeMasterData/.test(mdv), 'the Master Data list must stay a live subscription');
  assert.ok(/onImported=\{/.test(mdv), 'the importer must report completion back to the screen');
  assert.equal(
    /window\.location\.reload/.test(mdv + readCode(IMPORT_MODAL)),
    false,
    'a full application reload must never be required',
  );
  assert.ok(
    /invalidateCachedCollection/.test(readCode('src/services/bulkImportService.ts')),
    'the shared commit path must invalidate the cached collection',
  );
});

test('J8. TEST 7 - Historical Import is untouched and still routed', () => {
  const app = readCode('src/App.tsx');
  assert.ok(/currentPage === 'historical-import'/.test(app), 'the historical-import route must still exist');
  assert.ok(/<DataImportView\s*\/>/.test(app), 'Historical Import must still render');
  assert.equal(
    /FinancialAccounts/.test(readCode('src/components/admin/DataImportView.tsx')),
    false,
    'the Historical Import screen must carry no Financial Accounts special-casing',
  );
});

test('J9. TEST 8 - import is gated on the EXISTING Master Data permission, no new key', () => {
  const mdv = readCode(MDV);
  assert.ok(/canImportMasterData/.test(mdv), 'a permission gate must exist');
  assert.ok(/masterData\.inlineAdd|excel\.import/.test(mdv), 'it must reuse existing permission keys');
  const modal = readCode(IMPORT_MODAL);
  assert.ok(/!canImport/.test(modal), 'the importer must honour the gate');
  assert.ok(/disabled=\{!canImport/.test(modal), 'the execute button must be disabled without permission');
  for (const invented of ['financialAccounts.import', 'masterData.import', 'accounts.import']) {
    assert.equal((mdv + modal).includes(invented), false, `must not invent the permission ${invented}`);
  }
});

test('J10. the sheet picker extends the shared parser additively (no caller breaks)', () => {
  const src = readCode('src/services/bulkImportService.ts');
  assert.ok(
    /export async function parseImportFile\(file: File, sheetName\?: string\)/.test(src),
    'sheetName must be OPTIONAL so every existing caller is unaffected',
  );
  assert.ok(/export async function listImportSheetNames/.test(src), 'sheet names must be listable');
  assert.ok(/SheetNames\.includes\(sheetName\)/.test(src), 'an unknown sheet must fall back to the first');
});

test('J11. §12 - no Firestore rule, collection or migration was touched by this fix', () => {
  const modal = readCode(IMPORT_MODAL);
  assert.equal(
    /firebase\/firestore|getDocs|writeBatch|collection\(db/.test(modal),
    false,
    'the importer must go through the existing service layer, never Firestore directly',
  );
  assert.ok(
    /FINANCIAL_ACCOUNTS_COLLECTION/.test(readCode('src/services/financialAccountsPure.ts')),
    'the already-deployed collection must still be the target',
  );
});

(async () => {
  await bootstrap();
  for (const { name, fn } of registered) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (err: any) {
      console.log(`  FAIL  ${name}`);
      console.log(String(err && err.message ? err.message : err).split('\n').slice(0, 4).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

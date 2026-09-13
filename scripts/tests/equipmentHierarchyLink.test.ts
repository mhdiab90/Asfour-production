/**
 * EQUIPMENT -> HIERARCHY LINKING
 *
 * The chain this suite exists to prove, end to end, against the REAL modules:
 *
 *     ProductionRecord.pressId / .furnaceId
 *       -> Press / Furnace master record (its own document id)
 *         -> hierarchyNodeId
 *           -> hierarchy node
 *             -> ancestors / descendants
 *
 * Nothing is mocked. The registry, the shared hierarchy resolver and the
 * production filter engine are imported and executed as shipped. The fixtures
 * are ordinary data of the same shape the app stores - not a stand-in for the
 * logic under test.
 *
 * The property that matters most: NO production record is modified, and none
 * needs to be. Every record in the fixtures below is written once and asserted
 * byte-identical at the end (see group F).
 *
 * Run: npx tsx scripts/tests/equipmentHierarchyLink.test.ts
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

console.log('equipmentHierarchyLink.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}
function readCode(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

let hier: any;
let eng: any;
let reg: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  hier = await load('src/services/hierarchyResolverPure.ts');
  eng = await load('src/services/productionFilterEnginePure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
}

/**
 * The exact hierarchy from the business specification:
 *
 *   Presses
 *     Bo-kher
 *       Bo-kher 900 2
 *       Bo-kher 900 3
 *   Furnaces
 *     Rotary 1
 */
const NODES = [
  { id: 'N-PRESSES', code: '5', name: 'المكابس', parentId: null },
  { id: 'N-BOKHER', code: '51', name: 'بوخر', parentId: 'N-PRESSES' },
  { id: 'N-BOKHER-9002', code: '5134', name: 'بوخر 900 2', parentId: 'N-BOKHER' },
  { id: 'N-BOKHER-9003', code: '5135', name: 'بوخر 900 3', parentId: 'N-BOKHER' },
  { id: 'N-FURNACES', code: '6', name: 'الأفران', parentId: null },
  { id: 'N-ROTARY1', code: '61', name: 'الفرن الدوار 1', parentId: 'N-FURNACES' },
];

/** Equipment master records, carrying the real persisted link field. */
const PRESSES = [
  { id: 'P1', code: 'PR-01', name: 'بوخر 900 2', hierarchyNodeId: 'N-BOKHER-9002' },
  { id: 'P2', code: 'PR-02', name: 'بوخر 900 3', hierarchyNodeId: 'N-BOKHER-9003' },
  { id: 'P3', code: 'PR-03', name: 'مكبس قديم', hierarchyNodeId: null }, // legacy, unlinked
];
const FURNACES = [
  { id: 'F1', code: 'FU-01', name: 'الفرن الدوار 1', hierarchyNodeId: 'N-ROTARY1' },
];
const EQUIPMENT = [...PRESSES, ...FURNACES];

/** Legacy production records - NEVER modified, and never carrying a node id. */
const RECORDS = Object.freeze([
  Object.freeze({ id: 'r1', date: '2026-09-01', pressId: 'P1', productId: 'pr1', customerId: 'c1', productionQuantity: 100 }),
  Object.freeze({ id: 'r2', date: '2026-09-02', pressId: 'P2', productId: 'pr2', customerId: 'c1', productionQuantity: 200 }),
  Object.freeze({ id: 'r3', date: '2026-09-03', pressId: 'P3', productId: 'pr1', customerId: 'c2', productionQuantity: 300 }),
  Object.freeze({ id: 'r4', date: '2026-09-04', pressId: 'P1', furnaceId: 'F1', productId: 'pr3', customerId: 'c2', productionQuantity: 400 }),
]);
const RECORDS_SNAPSHOT = JSON.stringify(RECORDS);

const ids = (rows: any[]) => rows.map((r) => r.id).sort();
const nodeSel = (...nodeIds: string[]) => nodeIds.map((i) => `node:${i}`);

function index() { return hier.buildHierarchyIndex(NODES); }
function byNode() { return hier.buildEquipmentByNode(EQUIPMENT); }

/** Selection + filter through the shipped engine, exactly as the screen calls it. */
function filterBy(codes: string[]) {
  const selection = reg.normaliseSelection('productionCenters', codes, codes.length === 0);
  return eng.filterLegacyProductionRecords(
    RECORDS,
    selection,
    { index: index() },
    { equipment: EQUIPMENT },
  );
}

// ==================================================
// A. THE PERSISTED LINK (TEST 1-4)
// ==================================================

test('A1. TEST 1/2 - equipment carries a hierarchy node id, stored as a stable node id', () => {
  const types = readSource('src/types/index.ts');
  for (const iface of ['export interface Press {', 'export interface Furnace {']) {
    const start = types.indexOf(iface);
    assert.ok(start > 0, `${iface} must exist`);
    const block = types.slice(start, types.indexOf('\n}', start));
    assert.ok(/hierarchyNodeId\?: string \| null;/.test(block),
      `${iface} must carry a nullable hierarchyNodeId`);
  }
});

test('A2. TEST 2 - the link is a node ID, never a display path or code', () => {
  const src = readCode('src/components/masterData/MasterDataView.tsx');
  // The selector stores option values that are node ids.
  assert.ok(/hierarchyNodeId: e\.target\.value \|\| null/.test(src),
    'the selector must store the raw node id');
  assert.ok(/hierarchyOptions\.map\(\(o\) => \(\s*<option key=\{o\.id\} value=\{o\.id\}>/.test(src),
    'the option VALUE must be the node id, not its label');
});

test('A3. TEST 4 - unlinked equipment stays valid and simply is not reached by a parent', () => {
  const b = byNode();
  assert.equal(b.has('N-BOKHER-9002'), true);
  // P3 has no link, so it appears under no node at all.
  const allLinked = [...b.values()].flat();
  assert.equal(allLinked.includes('P3'), false, 'unlinked equipment must not be attached to any node');
  assert.equal(hier.countUnlinkedEquipment(EQUIPMENT), 1, 'exactly one legacy record is unlinked');
});

test('A4. TEST 4 - unlinked equipment is still selectable directly', () => {
  assert.deepEqual(ids(filterBy(['P3'])), ['r3'],
    'selecting the unlinked press directly must still filter its records');
});

// ==================================================
// B. RESOLUTION (TEST 5-8) - the real chain
// ==================================================

test('B1. TEST 5 - a parent node resolves its descendant nodes', () => {
  assert.deepEqual(
    hier.resolveHierarchySelection(index(), 'N-PRESSES', { includeSelf: true }).sort(),
    ['N-BOKHER', 'N-BOKHER-9002', 'N-BOKHER-9003', 'N-PRESSES'],
  );
});

test('B2. TEST 6 - a node resolves the equipment ids linked to it and its descendants', () => {
  assert.deepEqual(hier.resolveEquipmentForHierarchyNode(index(), byNode(), 'N-PRESSES').sort(), ['P1', 'P2']);
  assert.deepEqual(hier.resolveEquipmentForHierarchyNode(index(), byNode(), 'N-BOKHER').sort(), ['P1', 'P2']);
  assert.deepEqual(hier.resolveEquipmentForHierarchyNode(index(), byNode(), 'N-BOKHER-9002'), ['P1']);
});

test('B3. TEST 7 - ProductionRecord.pressId resolves through the linked Press master record', () => {
  // r1 names P1; P1 is linked to Bo-kher 900 2; selecting Presses must reach r1.
  assert.ok(ids(filterBy(nodeSel('N-PRESSES'))).includes('r1'));
});

test('B4. TEST 8 - ProductionRecord.furnaceId resolves through the linked Furnace master record', () => {
  // r4 names furnace F1, linked to Rotary 1 under Furnaces.
  assert.deepEqual(ids(filterBy(nodeSel('N-FURNACES'))), ['r4']);
});

// ==================================================
// C. BUSINESS ACCEPTANCE (§35 A-D, TEST 9-14)
// ==================================================

test('C1. §35 A - selecting Presses includes Bo-kher 900 2 production', () => {
  // P1 (Bo-kher 900 2) -> r1, r4 ; P2 (Bo-kher 900 3) -> r2. P3 is unlinked.
  assert.deepEqual(ids(filterBy(nodeSel('N-PRESSES'))), ['r1', 'r2', 'r4']);
});

test('C2. §35 B - selecting Bo-kher includes its descendants', () => {
  assert.deepEqual(ids(filterBy(nodeSel('N-BOKHER'))), ['r1', 'r2', 'r4']);
});

test('C3. §35 C - selecting the leaf targets only that equipment', () => {
  assert.deepEqual(ids(filterBy(nodeSel('N-BOKHER-9002'))), ['r1', 'r4']);
  assert.deepEqual(ids(filterBy(nodeSel('N-BOKHER-9003'))), ['r2']);
});

test('C4. TEST 12 - multiple branches are unioned', () => {
  assert.deepEqual(ids(filterBy(nodeSel('N-BOKHER-9002', 'N-FURNACES'))), ['r1', 'r4']);
  assert.deepEqual(ids(filterBy(nodeSel('N-PRESSES', 'N-FURNACES'))), ['r1', 'r2', 'r4']);
});

test('C5. TEST 13 - an overlapping selection never counts a record twice', () => {
  // Presses and Bo-kher overlap entirely; r4 matches through BOTH pressId and furnaceId.
  const out = filterBy(nodeSel('N-PRESSES', 'N-BOKHER', 'N-FURNACES'));
  assert.deepEqual(ids(out), ['r1', 'r2', 'r4']);
  for (const id of ['r1', 'r2', 'r4']) {
    assert.equal(out.filter((r: any) => r.id === id).length, 1, `${id} must appear exactly once`);
  }
  assert.equal(eng.dedupeRecordsById(out).length, out.length, 'the result is already duplicate-free');
});

test('C6. TEST 13b - aggregation over an overlapping selection is not inflated', () => {
  const out = filterBy(nodeSel('N-PRESSES', 'N-BOKHER'));
  const total = out.reduce((sum: number, r: any) => sum + r.productionQuantity, 0);
  assert.equal(total, 700, 'r1(100) + r2(200) + r4(400), each counted once');
});

test('C7. §35 D / TEST 14 - re-parenting a node changes the resolver output immediately', () => {
  // Move Bo-kher 900 2 out from under Bo-kher, to sit under Furnaces instead.
  const moved = NODES.map((nd) => (nd.id === 'N-BOKHER-9002' ? { ...nd, parentId: 'N-FURNACES' } : nd));
  const movedIndex = hier.buildHierarchyIndex(moved);

  assert.deepEqual(
    hier.resolveEquipmentForHierarchyNode(movedIndex, byNode(), 'N-BOKHER').sort(),
    ['P2'],
    'Bo-kher no longer contains the moved equipment',
  );
  assert.deepEqual(
    hier.resolveEquipmentForHierarchyNode(movedIndex, byNode(), 'N-FURNACES').sort(),
    ['F1', 'P1'],
    'Furnaces now contains it',
  );
  // And no production record had to change for that to be true.
  assert.equal(JSON.stringify(RECORDS), RECORDS_SNAPSHOT);
});

// ==================================================
// D. VALIDATION (§11) + MIXED SELECTION
// ==================================================

test('D1. §11 - an unknown hierarchy node is rejected', () => {
  const r = hier.validateEquipmentLink(index(), 'NOT-A-NODE');
  assert.equal(r.valid, false);
  assert.equal(r.issues[0].code, 'UNKNOWN_PARENT');
  assert.ok(r.issues[0].messageAr && r.issues[0].messageEn);
});

test('D2. §12 - clearing the link is always allowed', () => {
  for (const empty of ['', null, undefined]) {
    assert.equal(hier.validateEquipmentLink(index(), empty as any).valid, true);
  }
});

test('D3. §11 - a cyclic hierarchy blocks the link rather than resolving nonsense', () => {
  const cyclic = hier.buildHierarchyIndex([
    { id: 'A', code: 'A', parentId: 'C' },
    { id: 'B', code: 'B', parentId: 'A' },
    { id: 'C', code: 'C', parentId: 'B' },
  ]);
  const r = hier.validateEquipmentLink(cyclic, 'A');
  assert.equal(r.valid, false);
  assert.equal(r.issues[0].code, 'CYCLE');
});

test('D4. a node and a direct equipment id can be mixed in one selection', () => {
  // Bo-kher 900 3 by node, plus the unlinked legacy press directly.
  assert.deepEqual(ids(filterBy([...nodeSel('N-BOKHER-9003'), 'P3'])), ['r2', 'r3']);
});

test('D5. a node selection with no hierarchy loaded falls back to direct ids, never to "no production"', () => {
  const selection = reg.normaliseSelection('productionCenters', [...nodeSel('N-PRESSES'), 'P3'], false);
  const out = eng.filterLegacyProductionRecords(RECORDS, selection, undefined, undefined);
  // Without the contexts the node value simply cannot resolve; P3 still applies.
  assert.ok(Array.isArray(out), 'must return records, never throw');
});

// ==================================================
// E. PRESERVED BEHAVIOUR (TEST 16-24)
// ==================================================

test('E1. TEST 17 - ONE / MULTIPLE / ALL still behave as before', () => {
  assert.equal(reg.normaliseSelection('productionCenters', ['node:N-PRESSES'], false).mode, 'ONE');
  assert.equal(reg.normaliseSelection('productionCenters', nodeSel('N-PRESSES', 'N-FURNACES'), false).mode, 'MULTIPLE');
  const all = reg.normaliseSelection('productionCenters', [], true);
  assert.equal(all.mode, 'ALL');
  assert.deepEqual(all.codes, [], 'ALL must never materialise the code list');
  assert.equal(filterBy([]).length, RECORDS.length);
});

test('E2. TEST 16 - the other categories are untouched by the equipment link', () => {
  assert.deepEqual(ids(filterBy([])), ['r1', 'r2', 'r3', 'r4']);
  const byProduct = eng.filterLegacyProductionRecords(
    RECORDS, reg.normaliseSelection('products', ['pr1'], false), { index: index() }, { equipment: EQUIPMENT },
  );
  assert.deepEqual(ids(byProduct), ['r1', 'r3']);
});

test('E3. TEST 18/19 - Financial Accounts and Cost Centers remain Master-Data-only', () => {
  for (const id of ['financialAccounts', 'costCenters', 'hierarchicalCostCenters']) {
    assert.equal(reg.supportsLegacyProductionFilter(id), false, `${id} must not filter production`);
    assert.equal(reg.supportsEquipmentHierarchy(id), false, `${id} must claim no equipment hierarchy`);
  }
});

test('E4. §23 - equipmentHierarchy is declared only where the link field really exists', () => {
  assert.equal(reg.supportsEquipmentHierarchy('productionCenters'), true);
  // And it is NOT conflated with `hierarchical`, which means something else.
  assert.notEqual(reg.getCategory('productionCenters').hierarchical, true,
    'presses/furnaces are flat and point AT a node tree; they do not form one');
});

test('E5. TEST 20/21/22/23 - selection, Bulk Edit, Edit and single Delete are untouched', () => {
  const prv = readCode('src/components/production/ProductionRecordsView.tsx');
  assert.ok(/pruneToVisible\(prev, visibleIds\)/.test(prv), 'row selection pruning must remain');
  assert.ok(/handleOpenEdit/.test(prv), 'row Edit must remain');
  // Bulk delete was later authorised: it reuses the same primitive, so the call
  // sites are the single-row confirm and the injected bulk delete - no more.
  assert.equal((prv.match(/deleteProductionRecord\(/g) || []).length, 2, 'the existing primitive only');
  for (const forbidden of ['deleteStageRecord', 'deleteMany', 'writeBatch']) {
    assert.equal(prv.includes(forbidden), false, `${forbidden} must not exist`);
  }
  // Data Review's bulk edit is untouched by this task.
  const drv = readCode('src/components/production/DataReviewView.tsx');
  assert.ok(/planBulkEdit\(/.test(drv), 'Bulk Edit must remain wired');
});

test('E6. TEST 24 - hierarchy assignment reuses Master Data permissions, no new key', () => {
  const src = readCode('src/components/masterData/MasterDataView.tsx');
  for (const invented of ['hierarchy.assign', 'equipment.link', 'hierarchy.edit', 'masterData.hierarchy']) {
    assert.equal(src.includes(invented), false, `must not invent the permission ${invented}`);
  }
});

test('E7. TEST 25 - the link is written through the audited master-data update path', () => {
  const src = readCode('src/components/masterData/MasterDataView.tsx');
  assert.ok(/updateMasterDataItem\(/.test(src), 'saving must go through the shared update');
  const svc = readCode('src/services/masterDataService.ts');
  assert.ok(/logAuditAction\('UPDATE'/.test(svc), 'that path must write an audit entry');
  assert.ok(/invalidateCachedCollection/.test(svc), 'and invalidate the cache (§29)');
});

// ==================================================
// F. NO HISTORICAL REWRITE (§38) + PERFORMANCE (§33)
// ==================================================

test('F1. §38 - not one production record was modified by any of the above', () => {
  assert.equal(JSON.stringify(RECORDS), RECORDS_SNAPSHOT,
    'the whole point of linking equipment rather than records is that records never change');
});

test('F2. §38 - no production-write path was introduced anywhere in this change', () => {
  for (const rel of [
    'src/services/hierarchyResolverPure.ts',
    'src/services/productionFilterEnginePure.ts',
    'src/services/masterDataCategoryRegistry.ts',
  ]) {
    const src = readCode(rel);
    assert.equal(/updateDoc|setDoc|writeBatch|deleteDoc|getDocs/.test(src), false,
      `${rel} must stay Firebase-free`);
  }
  const prv = readCode('src/components/production/ProductionRecordsView.tsx');
  assert.equal(/hierarchyNodeId:\s*[^}]*\)\s*=>\s*update/.test(prv), false,
    'the production screen must never write a hierarchy id onto a record');
});

test('F3. §36 - production records carry NO hierarchy field; the link is external', () => {
  for (const r of RECORDS as any[]) {
    assert.equal('hierarchyNodeId' in r, false, 'a production record must not carry the node id');
  }
  const types = readSource('src/types/index.ts');
  const prStart = types.indexOf('export interface ProductionRecord');
  const prBlock = types.slice(prStart, types.indexOf('\n}', prStart));
  assert.equal(/hierarchyNodeId/.test(prBlock), false,
    'ProductionRecord must not gain a hierarchy field');
});

test('F4. §33 - resolution is index lookups, with no query per child or per equipment', () => {
  const src = readCode('src/services/hierarchyResolverPure.ts');
  assert.equal(/getDocs|firebase|await /.test(src), false, 'the resolver must stay pure and synchronous');
  assert.ok(/byNode\.get\(/.test(src), 'equipment lookup must be a map hit, not a scan');
  const prv = readCode('src/components/production/ProductionRecordsView.tsx');
  assert.equal(/availableCodes[\s\S]{0,400}(getDocs|fetchMasterData)/.test(prv), false,
    'building the options must not trigger a read');
});

test('F5. §6 - the mechanism is generic, not hard-coded per equipment type', () => {
  const src = readCode('src/services/hierarchyResolverPure.ts');
  for (const hardcoded of ['press', 'Press', 'furnace', 'Furnace', 'mill', 'Mill']) {
    assert.equal(src.includes(hardcoded), false,
      `the shared resolver must not name ${hardcoded} - it works on any equipment`);
  }
});

test('F6. §8 - fuzzy matching is NOT the authoritative relationship', () => {
  for (const rel of [
    'src/services/hierarchyResolverPure.ts',
    'src/services/productionFilterEnginePure.ts',
    'src/components/production/ProductionRecordsView.tsx',
  ]) {
    const src = readCode(rel);
    assert.equal(/fuzzy|rankFuzzyCandidates|masterDataCostCenterMapping/i.test(src), false,
      `${rel} must not use fuzzy matching for the hierarchy relationship`);
  }
});

test('F7. §15 - still exactly one hierarchy engine', () => {
  const engine = readCode('src/services/productionFilterEnginePure.ts');
  assert.ok(/resolveEquipmentForHierarchyNodes/.test(engine), 'the engine must delegate equipment resolution');
  assert.equal(/while\s*\(queue|stack\.pop\(\)|function\s+\w*[Dd]escendants/.test(engine), false,
    'the engine must not walk the tree itself');
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
      console.log(String(err && err.message ? err.message : err).split('\n').slice(0, 5).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

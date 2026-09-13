/**
 * HIERARCHICAL PRODUCTION FILTER UI - multi-select at every level.
 *
 * Rewritten for the multi-select selection state (levels[][] rather than a
 * single drilled path). Every property the previous single-path suite asserted
 * is still asserted here; only the API it is expressed against changed.
 *
 * The rules under test:
 *   - level 1 is the hierarchy's roots; every later level is the UNION of the
 *     children of what is ticked above it, and nothing from an unticked branch
 *   - a deeper tick NARROWS, so a parent and its own child cannot double-count
 *   - unticking a parent takes its descendants' ticks with it
 *   - "select all" means the nodes visible at THAT level only
 *   - a leaf with no children but with equipment IS a valid target
 *
 * The state machine is pure and runs as shipped. The two screens import
 * Firebase, so their wiring is asserted by source inspection with comments
 * stripped.
 *
 * Run: npx tsx scripts/tests/hierarchySelectorUi.test.ts
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

console.log('hierarchySelectorUi.test.ts');

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

let sel: any;
let hier: any;
let reg: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  sel = await load('src/services/hierarchySelectorPure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
}

/**
 * §44's hierarchy exactly, plus a second root and a five-level branch so depth
 * is genuinely exercised rather than assumed.
 *
 *   المكابس
 *     مكابس بوخر -> بوخر 1 / بوخر 2 / بوخر 3
 *     مكابس لايس -> لايس 1600 / لايس 2000
 *     عميق       -> ع2 -> ع3            (level 5)
 *   الأفران
 *     الفرن الدوار
 *   بلا شيء                             (no children, no equipment)
 */
const NODES = [
  { id: 'N-PRESSES', code: '5', name: 'المكابس', parentId: null },
  { id: 'N-BOKHER', code: '51', name: 'مكابس بوخر', parentId: 'N-PRESSES' },
  { id: 'N-B1', code: '5101', name: 'بوخر 1', parentId: 'N-BOKHER' },
  { id: 'N-B2', code: '5102', name: 'بوخر 2', parentId: 'N-BOKHER' },
  { id: 'N-B3', code: '5103', name: 'بوخر 3', parentId: 'N-BOKHER' },
  { id: 'N-LYS', code: '52', name: 'مكابس لايس', parentId: 'N-PRESSES' },
  { id: 'N-L1600', code: '5201', name: 'لايس 1600', parentId: 'N-LYS' },
  { id: 'N-L2000', code: '5202', name: 'لايس 2000', parentId: 'N-LYS' },
  { id: 'N-DEEP', code: '53', name: 'عميق', parentId: 'N-PRESSES' },
  { id: 'N-DEEP2', code: '5301', name: 'ع2', parentId: 'N-DEEP' },
  { id: 'N-DEEP3', code: '530101', name: 'ع3', parentId: 'N-DEEP2' },
  { id: 'N-FURNACES', code: '6', name: 'الأفران', parentId: null },
  { id: 'N-ROTARY', code: '61', name: 'الفرن الدوار', parentId: 'N-FURNACES' },
  { id: 'N-NOTHING', code: '9', name: 'بلا شيء', parentId: null },
];

/** Equipment linked to the LEAVES - so a leaf is the equipment. */
const EQUIPMENT = [
  { id: 'E-B1', hierarchyNodeId: 'N-B1' },
  { id: 'E-B2', hierarchyNodeId: 'N-B2' },
  { id: 'E-B3', hierarchyNodeId: 'N-B3' },
  { id: 'E-L1600', hierarchyNodeId: 'N-L1600' },
  { id: 'E-L2000', hierarchyNodeId: 'N-L2000' },
  { id: 'E-DEEP', hierarchyNodeId: 'N-DEEP3' },
  { id: 'E-F1', hierarchyNodeId: 'N-ROTARY' },
  { id: 'E-ORPHAN', hierarchyNodeId: null },
];

const index = () => hier.buildHierarchyIndex(NODES);
const byNode = () => hier.buildEquipmentByNode(EQUIPMENT);
const EMPTY = () => sel.EMPTY_HIERARCHY_SELECTION;
const resolve = (state: any) => sel.resolveSelectedEquipment(index(), byNode(), state);
const opts = (state: any) => sel.levelOptions(index(), state);

/** Tick a set of nodes at one level. */
function tick(state: any, level: number, ...nodeIds: string[]) {
  let out = state;
  for (const id of nodeIds) out = sel.toggleAtLevel(index(), out, level, id);
  return out;
}

// ==================================================
// A. LEVELS AND UNIONS (§16, §17, §19, §23, §43 C1-C2, C8)
// ==================================================

test('A1. level 1 offers ONLY the hierarchy roots', () => {
  const levels = opts(EMPTY());
  assert.equal(levels.length, 1, 'nothing ticked, so only level 1 is drawn');
  assert.deepEqual(levels[0].optionIds.sort(), ['N-FURNACES', 'N-NOTHING', 'N-PRESSES']);
  assert.equal(levels[0].optionIds.includes('N-BOKHER'), false, 'not a flat list of everything');
});

test('A2. TEST C1 - two ticked roots make level 2 the UNION of their children', () => {
  const state = tick(EMPTY(), 1, 'N-PRESSES', 'N-FURNACES');
  const levels = opts(state);
  assert.equal(levels.length, 2);
  assert.deepEqual(levels[1].optionIds.sort(), ['N-BOKHER', 'N-DEEP', 'N-LYS', 'N-ROTARY']);
});

test('A3. §23 - only descendants of TICKED branches appear', () => {
  const levels = opts(tick(EMPTY(), 1, 'N-PRESSES'));
  assert.equal(levels[1].optionIds.includes('N-ROTARY'), false, 'the unticked furnace branch must not leak');
});

test('A4. TEST C2 - two ticked level-2 nodes make level 3 the union of their children', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-BOKHER', 'N-LYS');
  const levels = opts(state);
  assert.equal(levels.length, 3);
  assert.deepEqual(levels[2].optionIds.sort(), ['N-B1', 'N-B2', 'N-B3', 'N-L1600', 'N-L2000']);
});

test('A5. §17 - ticking one level-2 node flows only ITS children onward', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-BOKHER');
  assert.deepEqual(opts(state)[2].optionIds.sort(), ['N-B1', 'N-B2', 'N-B3']);
});

test('A6. TEST C8 / §19 - five levels work with no special-case code', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-DEEP');
  state = tick(state, 3, 'N-DEEP2');
  const levels = opts(state);
  assert.equal(levels.length, 4);
  assert.deepEqual(levels[3].optionIds, ['N-DEEP3']);
  // And the leaf resolves to its equipment.
  assert.deepEqual(resolve(tick(state, 4, 'N-DEEP3')), ['E-DEEP']);
});

test('A7. §14 / CRITICAL 14 - roots come from data; no centre name is hard-coded', () => {
  const extended = [...NODES, { id: 'N-NEW', code: '7', name: 'مركز جديد', parentId: null }];
  assert.ok(sel.levelOptions(hier.buildHierarchyIndex(extended), EMPTY())[0].optionIds.includes('N-NEW'));
  const src = readCode('src/services/hierarchySelectorPure.ts');
  for (const name of ['المكابس', 'الأفران', 'بوخر', 'الطواحين', 'Presses', 'Furnaces']) {
    assert.equal(src.includes(name), false, `${name} must not be hard-coded`);
  }
});

// ==================================================
// B. LEAF = EQUIPMENT (§12-§15, §42 B1-B4, §27)
// ==================================================

test('B1. TEST B1/B3 / CRITICAL 8 - a childless node WITH equipment is a valid target', () => {
  assert.deepEqual(hier.getChildIds(index(), 'N-B1'), [], 'it genuinely has no children');
  assert.equal(sel.isSelectableNode(index(), byNode(), 'N-B1'), true, 'but it IS selectable');
  assert.equal(sel.isEmptyNode(index(), byNode(), 'N-B1'), false, 'and must never be called empty');
});

test('B2. TEST B2 / §27 - ticking a leaf selects that equipment exactly', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-BOKHER');
  state = tick(state, 3, 'N-B1');
  assert.deepEqual(resolve(state), ['E-B1'], 'the leaf IS the equipment, not "children of the leaf"');
});

test('B3. TEST B4 - a node with no children AND no equipment is genuinely empty', () => {
  assert.equal(sel.isSelectableNode(index(), byNode(), 'N-NOTHING'), false);
  assert.equal(sel.isEmptyNode(index(), byNode(), 'N-NOTHING'), true);
  assert.deepEqual(resolve(tick(EMPTY(), 1, 'N-NOTHING')), [], 'and it resolves to nothing');
});

test('B4. CRITICAL 8 - "no children" is never used on its own to mean "no equipment"', () => {
  const src = readCode('src/services/hierarchySelectorPure.ts');
  // isSelectableNode must consult the equipment map, not just the child list.
  const start = src.indexOf('export function isSelectableNode');
  const body = src.slice(start, src.indexOf('export function isEmptyNode'));
  assert.ok(/getChildIds/.test(body) && /resolveEquipmentForHierarchyNodes/.test(body),
    'both facts must be consulted before calling a node empty');
});

// ==================================================
// C. NARROWING, DEDUPE, BRANCH SAFETY (§21, §22, §24, §43 C3-C5)
// ==================================================

test('C1. §14 - ticking only a parent means the whole branch below it', () => {
  assert.deepEqual(resolve(tick(EMPTY(), 1, 'N-PRESSES')).sort(),
    ['E-B1', 'E-B2', 'E-B3', 'E-DEEP', 'E-L1600', 'E-L2000']);
});

test('C2. TEST C4 / §22 / CRITICAL 12 - parent + child never double-counts', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-BOKHER');
  const out = resolve(state);
  // The deeper tick narrows, so Bo-kher's equipment only - and each once.
  assert.deepEqual(out.sort(), ['E-B1', 'E-B2', 'E-B3']);
  assert.equal(new Set(out).size, out.length, 'no duplicates');
});

test('C3. TEST C3 - ticking several leaves gives exactly that equipment set', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-BOKHER');
  state = tick(state, 3, 'N-B1', 'N-B2');
  assert.deepEqual(resolve(state).sort(), ['E-B1', 'E-B2']);
  assert.equal(resolve(state).includes('E-B3'), false, 'an unticked sibling must not ride along');
});

test('C4. TEST C5 / §24 / CRITICAL 11 - unticking a parent removes its dependent ticks', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES', 'N-FURNACES');
  state = tick(state, 2, 'N-BOKHER', 'N-ROTARY');
  assert.deepEqual(resolve(state).sort(), ['E-B1', 'E-B2', 'E-B3', 'E-F1']);

  // Untick Presses. Bo-kher was only reachable through it.
  const after = sel.toggleAtLevel(index(), state, 1, 'N-PRESSES');
  assert.deepEqual(after.levels[0], ['N-FURNACES']);
  assert.equal((after.levels[1] ?? []).includes('N-BOKHER'), false, 'the stale level-2 tick is gone');
  assert.deepEqual(resolve(after).sort(), ['E-F1']);
});

test('C5. §24 - reconciliation cascades through every level, not just one', () => {
  const stale = { levels: [['N-FURNACES'], ['N-BOKHER'], ['N-B1']], equipmentIds: [] };
  const fixed = sel.reconcileLevels(index(), stale);
  assert.deepEqual(fixed.levels, [['N-FURNACES']], 'nothing below survives an unreachable level');
});

test('C6. §18 - the neutral state narrows nothing at all', () => {
  assert.equal(resolve(EMPTY()), null, 'null = no filtering, not "everything selected"');
  assert.equal(resolve(sel.clearSelection()), null);
  assert.equal(sel.effectiveLevel(EMPTY()), 0);
});

test('C7. §21 - an equipment tick narrows and can never widen', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = sel.toggleEquipment(state, 'E-B1');
  assert.deepEqual(resolve(state), ['E-B1']);
  // A tick from outside the branch simply does not match.
  const outside = { levels: [['N-FURNACES']], equipmentIds: ['E-B1'] };
  assert.deepEqual(resolve(outside), []);
});

// ==================================================
// D. SELECT ALL PER LEVEL (§26, §43 C6-C7)
// ==================================================

test('D1. TEST C6 / §26 - select-all at level 1 ticks the roots only', () => {
  const state = sel.selectAllAtLevel(index(), EMPTY(), 1);
  assert.deepEqual(state.levels[0].sort(), ['N-FURNACES', 'N-NOTHING', 'N-PRESSES']);
  assert.equal(state.levels[0].includes('N-BOKHER'), false, 'never a deeper node');
});

test('D2. TEST C7 / §26 - select-all at level 2 ticks only the VISIBLE children', () => {
  const state = sel.selectAllAtLevel(index(), tick(EMPTY(), 1, 'N-PRESSES'), 2);
  assert.deepEqual(state.levels[1].sort(), ['N-BOKHER', 'N-DEEP', 'N-LYS']);
  assert.equal(state.levels[1].includes('N-ROTARY'), false, 'the unticked furnace branch is not visible');
});

test('D3. §25 - clearing a level clears everything under it', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-BOKHER');
  state = tick(state, 3, 'N-B1');
  const cleared = sel.clearLevel(index(), state, 2);
  assert.deepEqual(cleared.levels, [['N-PRESSES']]);
});

test('D4. select-all equipment covers the current scope only', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-BOKHER');
  const all = sel.selectAllEquipment(index(), byNode(), state);
  assert.deepEqual(all.equipmentIds.sort(), ['E-B1', 'E-B2', 'E-B3']);
  assert.equal(all.equipmentIds.includes('E-F1'), false, 'never the whole system');
});

test('D5. unlinked equipment is reachable from no branch', () => {
  // Each node ticked at the level it actually lives on.
  for (const nodeId of ['N-PRESSES', 'N-FURNACES']) {
    assert.equal(resolve(tick(EMPTY(), 1, nodeId)).includes('E-ORPHAN'), false);
  }
  const bokher = tick(tick(EMPTY(), 1, 'N-PRESSES'), 2, 'N-BOKHER');
  assert.equal(resolve(bokher).includes('E-ORPHAN'), false);
});

test('D6. a node ticked at the wrong level is rejected, not silently honoured', () => {
  // N-BOKHER is a level-2 node; ticking it as a root cannot stand.
  const bogus = sel.toggleAtLevel(index(), EMPTY(), 1, 'N-BOKHER');
  assert.deepEqual(bogus.levels, [], 'reconciliation drops it');
  assert.equal(resolve(bogus), null, 'so the selection narrows nothing rather than narrowing wrongly');
});

// ==================================================
// E. §44 END-TO-END
// ==================================================

test('E1. §44 - Presses > Bo-kher > (1,2) resolves to exactly those two', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-BOKHER');
  state = tick(state, 3, 'N-B1', 'N-B2');
  assert.deepEqual(resolve(state).sort(), ['E-B1', 'E-B2']);
});

test('E2. §44 - ticking both level-2 branches offers all five leaves at level 3', () => {
  let state = tick(EMPTY(), 1, 'N-PRESSES');
  state = tick(state, 2, 'N-BOKHER', 'N-LYS');
  assert.deepEqual(opts(state)[2].optionIds.sort(), ['N-B1', 'N-B2', 'N-B3', 'N-L1600', 'N-L2000']);
  // Any subset may then be ticked.
  const subset = tick(state, 3, 'N-B3', 'N-L2000');
  assert.deepEqual(resolve(subset).sort(), ['E-B3', 'E-L2000']);
});

// ==================================================
// F. DASHBOARD (§30, §45)
// ==================================================

test('F1. the pressing stage offers its real equipment categories', () => {
  assert.deepEqual(reg.equipmentCategoriesForStage('pressing').map((c: any) => c.id).sort(), ['furnaces', 'presses']);
  assert.equal(reg.stageRecordsEquipment('pressing'), true);
});

test('F2. §45 / CRITICAL - a stage that records no equipment offers none', () => {
  for (const stage of ['rotary_furnace', 'chinese_mills', 'tube_ball_mills', 'mixing', 'mortar_concrete', 'lightweight_foam', 'sorting']) {
    assert.deepEqual(reg.equipmentCategoriesForStage(stage), []);
    assert.equal(reg.stageRecordsEquipment(stage), false);
  }
});

test('F3. presses can never be offered for a non-pressing stage', () => {
  for (const stage of ['rotary_furnace', 'chinese_mills', 'sorting']) {
    assert.equal(reg.equipmentCategoriesForStage(stage).map((c: any) => c.id).includes('presses'), false);
  }
});

// The stage-dependent equipment dropdown this test used to pin was replaced
// (by request) with the shared cost-centre hierarchy selector; the organisational
// filter is now the hierarchy, and the fixed press list must stay gone.
test('F4. the Dashboard uses the shared cost-centre selector, not a press list', () => {
  const src = readCode('src/components/dashboard/DashboardView.tsx');
  assert.ok(/<CostCenterScopeSelector/.test(src), 'the shared selector is rendered');
  assert.ok(/filterUniversalRecords\(allRecords, filters, productionScope\)/.test(src), 'its scope reaches the shared filter');
  assert.equal(/id="dashboard-equipment-filter"/.test(src), false, 'the legacy equipment dropdown is gone');
  assert.equal(/<option value="">\{language === 'ar' \? 'كل المكابس'/.test(src), false,
    'the fixed "All Presses" option must be gone');
});

// ==================================================
// G. WIRING + REGRESSION (§29, §31, §40, §47)
// ==================================================

const PRV = 'src/components/production/ProductionRecordsView.tsx';

test('G1. CRITICAL 15 - there is still exactly ONE traversal', () => {
  const selSrc = readCode('src/services/hierarchySelectorPure.ts');
  assert.ok(/resolveEquipmentForHierarchyNodes|getChildIds/.test(selSrc), 'the state machine delegates');
  assert.equal(/while\s*\(queue|stack\.pop\(\)|function\s+\w*[Dd]escendants/.test(selSrc), false);
  for (const rel of [PRV, 'src/components/dashboard/DashboardView.tsx']) {
    assert.equal(/childrenByParent|getDescendants|while\s*\(queue/.test(readCode(rel)), false, `${rel} must not traverse`);
  }
});

test('G2. the multi-level drill-down was superseded by the shared hierarchical selector', () => {
  const src = readCode(PRV);
  assert.equal(/hierarchyLevels|toggleAtLevel|selectAllAtLevel/.test(src), false, 'the per-level columns are gone');
  assert.ok(/<CostCenterScopeSelector/.test(src), 'one shared selector: search, groups, recursive checkboxes');
  // The state machine itself stays available and tested (sections A-E above).
  assert.ok(/export function toggleAtLevel/.test(readCode('src/services/hierarchySelectorPure.ts')));
});

test('G3. §31 - the reconciliation feeds the SAME equipment context everything else uses', () => {
  const src = readCode(PRV);
  assert.ok(/applyReconciliationToEquipment\(/.test(src), 'links are completed from the code match');
  assert.ok(/reconcileLegacyWithHierarchy\(/.test(src));
  assert.ok(/\{ equipment: equipmentLinks \}\)/.test(src), 'and flow into the shared engine');
});

test('G4. §29/§47 - production records are matched by the engine; Edit and single Delete remain', () => {
  const src = readCode(PRV);
  assert.equal(/rec\.pressId|rec\.furnaceId/.test(src), false, 'equipment fields are matched by the shared engine, not by hand');
  assert.ok(/handleOpenEdit/.test(src));
  assert.ok(/await deleteProductionRecord\(\s*deleteConfirmRecord\.id,/.test(src), 'single delete unchanged');
  for (const forbidden of ['deleteStageRecord', 'deleteMany', 'writeBatch']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not exist`);
  }
});

test('G5. row selection still prunes against the filtered set', () => {
  const src = readCode(PRV);
  assert.ok(/pruneToVisible\(prev, visibleIds\)/.test(src));
  assert.ok(/filteredRecords\.map\(\(r\) => r\.id\)/.test(src));
});

test('G6. §31 - Reports and AI were not modified by this task', () => {
  assert.equal(/hierarchySelectorPure|levelOptions/.test(readCode('src/components/reports/ReportsView.tsx')), false);
  assert.equal(/hierarchySelectorPure|levelOptions/.test(readCode('src/assistant/tools/stageReportTools.ts')), false);
});

test('G7. §40 - selection changes cause no reads', () => {
  assert.equal(/getDocs|firebase|await |fetchMasterData/.test(readCode('src/services/hierarchySelectorPure.ts')), false);
  assert.equal(/hierarchySelection[\s\S]{0,200}fetchMasterData/.test(readCode(PRV)), false);
});

test('G8. §39 - no new permission was introduced', () => {
  for (const rel of [PRV, 'src/components/dashboard/DashboardView.tsx', 'src/services/hierarchySelectorPure.ts']) {
    for (const invented of ['hierarchy.filter', 'equipment.select', 'production.hierarchy', 'reconciliation.apply']) {
      assert.equal(readCode(rel).includes(invented), false, `${rel} must not invent ${invented}`);
    }
  }
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

/**
 * HIERARCHICAL PRODUCTION FILTER UI
 *
 * Two screens, one meaning. The Dashboard offers Stage -> Equipment; Production
 * Records offers a multi-level drill-down with checkboxes. §34 is the point of
 * the whole task: both must resolve to the SAME equipment ids, so group E
 * asserts that on the real modules rather than trusting two UIs to agree.
 *
 * The selection state machine is pure and runs here as shipped. The two screens
 * import Firebase, so their wiring is asserted by source inspection with
 * comments stripped - a test can never be satisfied by the prose explaining it.
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
 * §34's hierarchy, plus a second root and a FIVE-level branch so depth is
 * genuinely exercised rather than assumed to be three.
 */
const NODES = [
  { id: 'N-PRESSES', code: '5', name: 'المكابس', parentId: null },
  { id: 'N-BOKHER', code: '51', name: 'بوخر', parentId: 'N-PRESSES' },
  { id: 'N-P1', code: '511', name: 'مكبس بوخر 1', parentId: 'N-BOKHER' },
  { id: 'N-P2', code: '512', name: 'مكبس بوخر 2', parentId: 'N-BOKHER' },
  { id: 'N-P3', code: '513', name: 'مكبس بوخر 3', parentId: 'N-BOKHER' },
  { id: 'N-LYS', code: '52', name: 'لايس', parentId: 'N-PRESSES' },
  { id: 'N-LYS-A', code: '521', name: 'لايس أ', parentId: 'N-LYS' },
  { id: 'N-LYS-A1', code: '5211', name: 'لايس أ-1', parentId: 'N-LYS-A' },   // level 5
  { id: 'N-FURNACES', code: '6', name: 'الأفران', parentId: null },
  { id: 'N-ROTARY', code: '61', name: 'الفرن الدوار', parentId: 'N-FURNACES' },
];

const EQUIPMENT = [
  { id: 'E1', hierarchyNodeId: 'N-P1' },
  { id: 'E2', hierarchyNodeId: 'N-P2' },
  { id: 'E3', hierarchyNodeId: 'N-P3' },
  { id: 'E-LYS', hierarchyNodeId: 'N-LYS-A1' },
  { id: 'E-F1', hierarchyNodeId: 'N-ROTARY' },
  { id: 'E-ORPHAN', hierarchyNodeId: null },
];

const index = () => hier.buildHierarchyIndex(NODES);
const byNode = () => hier.buildEquipmentByNode(EQUIPMENT);
const EMPTY = () => sel.EMPTY_HIERARCHY_SELECTION;
const resolve = (state: any) => sel.resolveSelectedEquipment(index(), byNode(), state);

/** Drill a path in one go, the way the UI does level by level. */
function drill(...nodeIds: string[]) {
  let state = EMPTY();
  nodeIds.forEach((id, i) => { state = sel.selectAtLevel(state, i + 1, id); });
  return state;
}

// ==================================================
// A. LEVELS (§33 P1-P3, P9, P10)
// ==================================================

test('A1. TEST P1 - level 1 offers ONLY the hierarchy roots', () => {
  const levels = sel.levelOptions(index(), EMPTY());
  assert.equal(levels.length, 1, 'nothing chosen yet, so only level 1 is drawn');
  assert.deepEqual(levels[0].optionIds.sort(), ['N-FURNACES', 'N-PRESSES']);
  // Not a flat list of every node.
  assert.equal(levels[0].optionIds.includes('N-BOKHER'), false);
});

test('A2. TEST P2 - level 2 offers ONLY the chosen root\'s children', () => {
  const levels = sel.levelOptions(index(), drill('N-PRESSES'));
  assert.equal(levels.length, 2);
  assert.deepEqual(levels[1].optionIds.sort(), ['N-BOKHER', 'N-LYS']);
  assert.equal(levels[1].optionIds.includes('N-ROTARY'), false, 'no other branch may leak in');
});

test('A3. TEST P3 - level 3 offers only the chosen child\'s children', () => {
  const levels = sel.levelOptions(index(), drill('N-PRESSES', 'N-BOKHER'));
  assert.equal(levels.length, 3);
  assert.deepEqual(levels[2].optionIds.sort(), ['N-P1', 'N-P2', 'N-P3']);
});

test('A4. TEST P10 - depth is whatever the data has, not three', () => {
  const levels = sel.levelOptions(index(), drill('N-PRESSES', 'N-LYS', 'N-LYS-A'));
  assert.equal(levels.length, 4, 'a four-level branch draws four selectors');
  assert.deepEqual(levels[3].optionIds, ['N-LYS-A1']);
  // And a leaf draws no further selector.
  const atLeaf = sel.levelOptions(index(), drill('N-PRESSES', 'N-LYS', 'N-LYS-A', 'N-LYS-A1'));
  assert.equal(atLeaf.length, 4, 'a leaf adds no empty dropdown');
});

test('A5. TEST P9 / CRITICAL 9 - roots come from data; a new root appears automatically', () => {
  const extended = [...NODES, { id: 'N-NEW', code: '7', name: 'مركز جديد تمامًا', parentId: null }];
  const levels = sel.levelOptions(hier.buildHierarchyIndex(extended), EMPTY());
  assert.ok(levels[0].optionIds.includes('N-NEW'), 'no code change needed for a new root');
  // And no centre name is hard-coded in the selector module.
  const src = readCode('src/services/hierarchySelectorPure.ts');
  for (const name of ['المكابس', 'الأفران', 'بوخر', 'الطواحين', 'Presses', 'Furnaces']) {
    assert.equal(src.includes(name), false, `${name} must not be hard-coded`);
  }
});

// ==================================================
// B. SEMANTICS (§34 A-C, §14, §15)
// ==================================================

test('B1. §34 A - stopping at level 1 means the WHOLE branch', () => {
  assert.deepEqual(resolve(drill('N-PRESSES')).sort(), ['E-LYS', 'E1', 'E2', 'E3']);
});

test('B2. §34 B - stopping at level 2 means that sub-branch', () => {
  assert.deepEqual(resolve(drill('N-PRESSES', 'N-BOKHER')).sort(), ['E1', 'E2', 'E3']);
});

test('B3. §34 C / TEST P4/P5 - ticking equipment narrows to exactly those', () => {
  let state = drill('N-PRESSES', 'N-BOKHER');
  state = sel.toggleEquipment(state, 'E1');
  assert.deepEqual(resolve(state), ['E1'], 'one tick = one piece of equipment');
  state = sel.toggleEquipment(state, 'E2');
  assert.deepEqual(resolve(state).sort(), ['E1', 'E2'], 'two ticks = both');
  assert.equal(resolve(state).includes('E3'), false, 'an explicit tick must NARROW, never add');
});

test('B4. §18 - the neutral state narrows nothing at all', () => {
  assert.equal(resolve(EMPTY()), null, 'null = no filtering, not "everything selected"');
  assert.equal(resolve(sel.clearSelection()), null);
});

test('B5. TEST P6 / §13 - select-all covers the current branch only', () => {
  const state = sel.selectAllEquipment(index(), byNode(), drill('N-PRESSES', 'N-BOKHER'));
  assert.deepEqual(state.equipmentIds.sort(), ['E1', 'E2', 'E3']);
  assert.equal(state.equipmentIds.includes('E-F1'), false, 'never the whole system');
  assert.equal(state.equipmentIds.includes('E-LYS'), false, 'never a sibling branch');
});

test('B6. §15 - a tick from another branch can never widen the result', () => {
  // Tick inside Bo-kher, then navigate to the furnace branch by hand.
  const ticked = { path: ['N-FURNACES'], equipmentIds: ['E1', 'E2'] };
  assert.deepEqual(resolve(ticked), [], 'stale ticks are outside the branch, so nothing matches');
  assert.equal(resolve(ticked).includes('E1'), false);
});

test('B7. unlinked equipment is reachable from no branch at all', () => {
  for (const nodeId of ['N-PRESSES', 'N-BOKHER', 'N-FURNACES']) {
    assert.equal(resolve(drill(nodeId)).includes('E-ORPHAN'), false);
  }
});

// ==================================================
// C. NAVIGATION (§33 P7, P8, §17)
// ==================================================

test('C1. TEST P7 - going back one level keeps the levels above it', () => {
  const deep = drill('N-PRESSES', 'N-BOKHER');
  const back = sel.goBack(deep);
  assert.deepEqual(back.path, ['N-PRESSES'], 'only the deepest level is dropped');
  assert.deepEqual(back.equipmentIds, [], 'ticks made inside the branch being left are cleared');
  assert.deepEqual(sel.goBack(sel.goBack(deep)).path, []);
  assert.deepEqual(sel.goBack(EMPTY()).path, [], 'going back from the top is harmless');
});

test('C2. TEST P8 - choosing a different node discards the deeper branch', () => {
  let state = drill('N-PRESSES', 'N-BOKHER');
  state = sel.toggleEquipment(state, 'E1');
  // The user changes level 1 to the other root.
  const switched = sel.selectAtLevel(state, 1, 'N-FURNACES');
  assert.deepEqual(switched.path, ['N-FURNACES'], 'the old level-2 choice cannot survive');
  assert.deepEqual(switched.equipmentIds, [], 'nor can equipment ticked in the old branch');
  assert.deepEqual(resolve(switched), ['E-F1']);
});

test('C3. clearing a level clears everything below it', () => {
  const state = sel.selectAtLevel(drill('N-PRESSES', 'N-BOKHER'), 2, null);
  assert.deepEqual(state.path, ['N-PRESSES']);
});

test('C4. §17 - the breadcrumb reads from the data', () => {
  const labels = sel.selectionPathLabels(index(), drill('N-PRESSES', 'N-BOKHER'), (x: any) => x.name);
  assert.deepEqual(labels, ['المكابس', 'بوخر']);
  const text = sel.selectionPathText(index(), drill('N-PRESSES', 'N-BOKHER'), (x: any) => x.name);
  assert.ok(text.includes('المكابس') && text.includes('بوخر'));
});

// ==================================================
// D. DASHBOARD (§32 D1-D6)
// ==================================================

test('D1. TEST D1 - the pressing stage offers its real equipment categories', () => {
  const cats = reg.equipmentCategoriesForStage('pressing').map((c: any) => c.id);
  assert.deepEqual(cats.sort(), ['furnaces', 'presses'], 'pressing records BOTH pressId and furnaceId');
  assert.equal(reg.stageRecordsEquipment('pressing'), true);
});

test('D2. TEST D2/D3 / CRITICAL 2 - a stage that records no equipment offers NONE', () => {
  for (const stage of ['rotary_furnace', 'chinese_mills', 'tube_ball_mills', 'mixing', 'mortar_concrete', 'lightweight_foam', 'sorting']) {
    assert.deepEqual(reg.equipmentCategoriesForStage(stage), [],
      `${stage} records no equipment reference, so it must offer no equipment filter`);
    assert.equal(reg.stageRecordsEquipment(stage), false);
  }
});

test('D3. CRITICAL 2 - presses can never be offered for a non-pressing stage', () => {
  for (const stage of ['rotary_furnace', 'chinese_mills', 'sorting']) {
    const ids = reg.equipmentCategoriesForStage(stage).map((c: any) => c.id);
    assert.equal(ids.includes('presses'), false, `presses must not appear under ${stage}`);
  }
});

test('D4. TEST D5 - "all" stage offers the union, and it is derived, not hard-coded', () => {
  const all = reg.equipmentCategoriesForStage('all').map((c: any) => c.id).sort();
  assert.deepEqual(all, ['furnaces', 'presses']);
  assert.deepEqual(reg.equipmentCategoriesForStage(undefined).map((c: any) => c.id).sort(), all);
  // Derived from the map, so a stage gaining equipment needs no change here.
  const src = readCode('src/services/masterDataCategoryRegistry.ts');
  assert.ok(/Object\.values\(STAGE_EQUIPMENT_CATEGORIES\)\.flat\(\)/.test(src), 'the union must be computed');
});

test('D5. TEST D4 - the Dashboard clears an equipment selection the new stage cannot use', () => {
  const src = readCode('src/components/dashboard/DashboardView.tsx');
  assert.ok(/const valid = new Set\(equipmentOptions\.flatMap/.test(src), 'validity is checked against the new stage');
  assert.ok(/pressId: pressOk \? prev\.pressId : undefined/.test(src), 'an incompatible press id is dropped');
  assert.ok(/furnaceId: furnaceOk \? prev\.furnaceId : undefined/.test(src), 'and an incompatible furnace id');
});

test('D6. TEST D6 / §6 - Dashboard equipment comes from master data, never a literal', () => {
  const src = readCode('src/components/dashboard/DashboardView.tsx');
  assert.ok(/equipmentCategoriesForStage\(stageType\)/.test(src), 'options must follow the stage');
  assert.ok(/fetchMasterData<Press>\('presses'\)/.test(src), 'presses come from master data');
  assert.ok(/id="dashboard-equipment-filter"/.test(src), 'the selector must be identifiable');
  // The old hard-coded press-only list is gone.
  assert.equal(/<option value="">\{language === 'ar' \? 'كل المكابس'/.test(src), false,
    'the fixed "All Presses" option must no longer exist');
});

// ==================================================
// E. §34 D/E - THE TWO SCREENS AGREE
// ==================================================

test('E1. §34 D/E / §24 - Dashboard ALL and the drill-down resolve the SAME equipment', () => {
  // Production Records: drill to Presses, tick nothing = the whole branch.
  const viaDrillDown = resolve(drill('N-PRESSES')).sort();

  // Dashboard: stage pressing, equipment ALL, restricted to the same branch -
  // both go through the SAME shared resolver, which is why they agree.
  const viaResolver = hier
    .resolveEquipmentForHierarchyNodes(index(), byNode(), ['N-PRESSES'], { includeSelf: true })
    .sort();

  assert.deepEqual(viaDrillDown, viaResolver);
  assert.deepEqual(viaDrillDown, ['E-LYS', 'E1', 'E2', 'E3']);
});

test('E2. §34 E - an explicit tick resolves identically through either path', () => {
  let state = drill('N-PRESSES', 'N-BOKHER');
  state = sel.toggleEquipment(state, 'E1');
  state = sel.toggleEquipment(state, 'E2');
  const branch = hier.resolveEquipmentForHierarchyNodes(index(), byNode(), ['N-BOKHER'], { includeSelf: true });
  const expected = ['E1', 'E2'].filter((id) => branch.includes(id));
  assert.deepEqual(resolve(state).sort(), expected.sort());
});

test('E3. §24/CRITICAL 10 - there is still exactly ONE traversal', () => {
  const selSrc = readCode('src/services/hierarchySelectorPure.ts');
  assert.ok(/resolveEquipmentForHierarchyNodes|getChildIds/.test(selSrc), 'the state machine delegates');
  assert.equal(/while\s*\(queue|stack\.pop\(\)|function\s+\w*[Dd]escendants/.test(selSrc), false,
    'the state machine must not walk the tree');
  for (const rel of ['src/components/production/ProductionRecordsView.tsx', 'src/components/dashboard/DashboardView.tsx']) {
    const src = readCode(rel);
    assert.equal(/childrenByParent|getDescendants|while\s*\(queue/.test(src), false, `${rel} must not traverse`);
  }
});

// ==================================================
// F. COMPOSITION + REGRESSION (§23, §28, §29, §25)
// ==================================================

const PRV = 'src/components/production/ProductionRecordsView.tsx';

test('F1. TEST P11/P12/P13 - the drill-down is one more AND beside the existing filters', () => {
  const src = readCode(PRV);
  assert.ok(/if \(hierarchyEquipmentIds == null\) return true;/.test(src),
    'nothing drilled = identity, so existing behaviour is untouched');
  for (const kept of ['filterShift', 'filterProduct', 'startDate', 'endDate', 'searchQuery', 'codeSelection']) {
    assert.ok(src.includes(kept), `${kept} must still be applied`);
  }
  // It matches the record's own equipment fields, and tests each record once.
  assert.ok(/\[rec\.pressId, rec\.furnaceId\]\.some\(/.test(src),
    'a job belongs to the branch via either field, and is tested once');
});

test('F2. TEST P14 / §28 - row selection still prunes against the newly filtered set', () => {
  const src = readCode(PRV);
  assert.ok(/pruneToVisible\(prev, visibleIds\)/.test(src), 'pruning must remain');
  assert.ok(/filteredRecords\.map\(\(r\) => r\.id\)/.test(src),
    'visibleIds must derive from the SAME list the drill-down filtered');
});

test('F3. TEST P15/P16 / §29 - Edit and single Delete are untouched; no bulk delete', () => {
  const src = readCode(PRV);
  assert.ok(/handleOpenEdit/.test(src), 'row Edit remains');
  assert.equal((src.match(/deleteProductionRecord\(/g) || []).length, 1, 'one delete call site only');
  for (const forbidden of ['handleBulkDelete', 'bulkDelete', 'deleteSelected', 'deleteStageRecord']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not exist`);
  }
});

test('F4. §25 - Reports and AI were not modified by this task', () => {
  const reports = readCode('src/components/reports/ReportsView.tsx');
  assert.equal(/hierarchySelectorPure|levelOptions|selectAtLevel/.test(reports), false,
    'Reports must not gain the drill-down UI');
  const ai = readCode('src/assistant/tools/stageReportTools.ts');
  assert.equal(/hierarchySelectorPure|levelOptions/.test(ai), false, 'AI must not gain it either');
});

test('F5. §25 - the added furnaceId filter is inert for Reports', () => {
  const engine = readCode('src/services/reportingEngine.ts');
  assert.ok(/filters\.furnaceId && \(r\.rawData\?\.furnaceId \|\| ''\) !== filters\.furnaceId/.test(engine),
    'the furnace filter exists');
  // Reports never set it, so their behaviour cannot change.
  const reports = readCode('src/components/reports/ReportsView.tsx');
  assert.equal(/furnaceId:/.test(reports), false, 'the Reports screen never sets furnaceId');
});

test('F6. §26/§27 - no financial-account or cost-centre equipment mapping was invented', () => {
  for (const rel of ['src/services/hierarchySelectorPure.ts', 'src/components/dashboard/DashboardView.tsx']) {
    const src = readCode(rel);
    assert.equal(/financialAccount|costCenterId|accountId/.test(src), false,
      `${rel} must not reference a fabricated mapping`);
  }
  const stageMap = readCode('src/services/masterDataCategoryRegistry.ts');
  const start = stageMap.indexOf('STAGE_EQUIPMENT_CATEGORIES');
  const block = stageMap.slice(start, start + 500);
  assert.equal(/financialAccounts|costCenters/.test(block), false,
    'no stage may claim an account or cost-centre as equipment');
});

test('F7. §35 - selection changes cause no reads', () => {
  const selSrc = readCode('src/services/hierarchySelectorPure.ts');
  assert.equal(/getDocs|firebase|await |fetchMasterData/.test(selSrc), false,
    'the state machine must stay pure and synchronous');
  const src = readCode(PRV);
  assert.equal(/hierarchySelection[\s\S]{0,200}fetchMasterData/.test(src), false,
    'drilling must not trigger a fetch');
});

test('F8. §37 - no new permission was introduced', () => {
  for (const rel of [PRV, 'src/components/dashboard/DashboardView.tsx', 'src/services/hierarchySelectorPure.ts']) {
    const src = readCode(rel);
    for (const invented of ['hierarchy.filter', 'equipment.select', 'production.hierarchy']) {
      assert.equal(src.includes(invented), false, `${rel} must not invent ${invented}`);
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

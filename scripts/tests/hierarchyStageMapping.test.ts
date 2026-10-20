/**
 * COST-CENTRE NODES NARROW THE RECORDS OF THEIR STAGE (3.40.0).
 *
 * Choosing "الفرن الدوار" / "الطواحين الصينى" / a press department in the cost-centre selector narrows the
 * records by the equipment linked beneath it - which only pressing and furnace records carry. Odoo-imported
 * records have a stage and a sub-centre instead. The node -> stage table makes the selector work for them.
 *
 *  R  node selection -> stage rules (parent = itself + everything below; a leaf machine has none)
 *  A  applying the selection to records (equipment OR stage; nothing selected = untouched)
 *  S  source pins: every screen passes the rules
 *
 * Run: npx tsx scripts/tests/hierarchyStageMapping.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0; let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => registered.push({ name, fn });
console.log('hierarchyStageMapping.test.ts');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
let map: any; let resolver: any; let engine: any;

/** reportingEngine imports Firestore through stageRecordService; only its stage name tables are needed, so they are shimmed. */
async function loadEngine() {
  const abs = path.join(ROOT, 'src/services/reportingEngine.ts');
  let src = read('src/services/reportingEngine.ts');
  const needle = "import { STAGE_DISPLAY_NAMES, STAGE_COLLECTION_NAMES } from './stageRecordService';";
  assert.ok(src.includes(needle));
  const stages = ['pressing', 'rotary_furnace', 'chinese_mills', 'tube_ball_mills', 'mortar_concrete', 'mixing', 'lightweight_foam', 'sorting', 'thermal_concrete', 'tunnel_kiln', 'handmade_brick'];
  src = src.replace(needle, `const STAGE_DISPLAY_NAMES: Record<string, string> = ${JSON.stringify(Object.fromEntries(stages.map((x) => [x, x])))};\nconst STAGE_COLLECTION_NAMES: Record<string, string> = ${JSON.stringify(Object.fromEntries(stages.map((x) => [x, 'stage_' + x])))};`);
  src = src.replace(/(from\s*['"])(\.[^'"]+)(['"])/g, (_m, x, spec, c) => {
    const base = path.resolve(path.dirname(abs), spec);
    for (const cand of [base + '.ts', base + '.tsx', base + '/index.ts']) if (fs.existsSync(cand)) return x + pathToFileURL(cand).href + c;
    return x + spec + c;
  });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'asfour-hier-')), 'reportingEngine.ts');
  fs.writeFileSync(out, src, 'utf-8');
  return import(pathToFileURL(out).href);
}
async function bootstrap() {
  map = await load('src/services/hierarchyStageMappingPure.ts');
  resolver = await load('src/services/hierarchyResolverPure.ts');
  engine = await loadEngine();
}

/** The production departments of the live cost-centre tree (codes and parents as read from the screen). */
const TREE: Array<[string, string | null]> = [
  ['5', null],
  ['501', '5'], ['5011', '501'], ['5012', '501'], ['5013', '501'],
  ['510', '5'], ['5101', '510'], ['5102', '510'], ['5103', '510'], ['5104', '510'], ['5105', '510'],
  ['511', '5'], ['5111', '511'], ['51111', '5111'], ['5112', '511'], ['51121', '5112'], ['5113', '511'],
  ['512', '5'], ['5121', '512'],
  ['513', '5'], ['5131', '513'], ['51311', '5131'], ['5132', '513'], ['5135', '513'], ['51351', '5135'], ['51352', '5135'],
  ['514', '5'], ['5141', '514'], ['5146', '514'],
  ['515', '5'], ['5151', '515'], ['5152', '515'], ['5153', '515'],
  ['516', '5'], ['5161', '516'], ['5162', '516'],
  ['517', '5'],
];
const index = () => resolver.buildHierarchyIndex(TREE.map(([code, parent]) => ({ id: code, code, parentId: parent })));
const stagesOf = (rules: any[] | null) => (rules ?? []).map((r) => r.stage + (r.subCenter ? `:${r.subCenter}` : '')).sort();

test('R1. nothing selected means no rules at all (null), never an empty restriction', () => {
  assert.equal(map.resolveStageRulesForNodes([], index()), null);
});

test('R2. the rotary kiln node means the whole stage; its children are its own centres', () => {
  assert.deepEqual(stagesOf(map.resolveStageRulesForNodes(['501'], index())), ['rotary_furnace', 'rotary_furnace:MAIN', 'rotary_furnace:rotary_crushers', 'rotary_furnace:rotary_shakers']);
  assert.deepEqual(stagesOf(map.resolveStageRulesForNodes(['5012'], index())), ['rotary_furnace:rotary_crushers']);
  assert.deepEqual(stagesOf(map.resolveStageRulesForNodes(['5013'], index())), ['rotary_furnace:rotary_shakers']);
  assert.deepEqual(stagesOf(map.resolveStageRulesForNodes(['5011'], index())), ['rotary_furnace:MAIN']);
});

test('R3. each production department stands for its stage', () => {
  for (const [code, stage] of [['510', 'chinese_mills'], ['511', 'tube_ball_mills'], ['512', 'mixing'], ['514', 'tunnel_kiln'], ['515', 'lightweight_foam'], ['516', 'mortar_concrete']]) {
    assert.ok(stagesOf(map.resolveStageRulesForNodes([code], index())).includes(stage), `${code} -> ${stage}`);
  }
});

test('R4. the press department is pressing AND the hand-made brick below it; the hand-made node alone is only that', () => {
  assert.deepEqual(stagesOf(map.resolveStageRulesForNodes(['513'], index())), ['handmade_brick', 'pressing']);
  assert.deepEqual(stagesOf(map.resolveStageRulesForNodes(['5135'], index())), ['handmade_brick']);
  assert.deepEqual(stagesOf(map.resolveStageRulesForNodes(['51352'], index())), [], 'a leaf under it has no rule of its own');
});

test('R5. one machine (a single mill, a single press) stands for no stage - it narrows by its equipment link only', () => {
  assert.deepEqual(map.resolveStageRulesForNodes(['5101'], index()), []);
  assert.deepEqual(map.resolveStageRulesForNodes(['51311'], index()), []);
  assert.deepEqual(map.resolveStageRulesForNodes(['517'], index()), [], 'a service department is not a production stage');
});

test('R6. several nodes together are one deduplicated union', () => {
  const rules = map.resolveStageRulesForNodes(['501', '5012', '510'], index());
  assert.equal(rules.length, new Set(rules.map((r: any) => `${r.stage}|${r.subCenter ?? ''}`)).size);
  assert.ok(stagesOf(rules).includes('chinese_mills') && stagesOf(rules).includes('rotary_furnace'));
});

test('R7. every code in the table is a node of the live tree', () => {
  const codes = new Set(TREE.map(([c]) => c));
  for (const code of Object.keys(map.NODE_STAGE_RULES)) assert.ok(codes.has(code), code);
});

const REC = (id: string, stageType: string, rawData: any = {}) => ({ id, stageType, date: '2025-12-31', quantity: 1, unit: 'طن', status: 'SUBMITTED', createdBy: '', createdAt: '', updatedAt: '', stageNameAr: '', rawData });
const RECORDS = [
  REC('kiln', 'rotary_furnace'), REC('crush', 'rotary_furnace', { subCenterId: 'rotary_crushers' }), REC('shake', 'rotary_furnace', { subCenterId: 'rotary_shakers' }),
  REC('mill', 'chinese_mills'), REC('tube', 'tube_ball_mills'), REC('press', 'pressing', { pressId: 'P1' }), REC('press2', 'pressing', { pressId: 'P2' }), REC('hand', 'handmade_brick'),
];
const pick = (nodes: string[], scope: Set<string> | null = null) => engine.filterUniversalRecords(RECORDS, {}, scope, map.resolveStageRulesForNodes(nodes, index())).map((r: any) => r.id);

test('A1. choosing the rotary kiln node shows ALL its records; a child shows only that centre', () => {
  assert.deepEqual(pick(['501']), ['kiln', 'crush', 'shake']);
  assert.deepEqual(pick(['5012']), ['crush']);
  assert.deepEqual(pick(['5013']), ['shake']);
  assert.deepEqual(pick(['5011']), ['kiln']);
});

test('A2. choosing the mills department shows the Chinese mills records, not the tube mills', () => {
  assert.deepEqual(pick(['510']), ['mill']);
  assert.deepEqual(pick(['511']), ['tube']);
});

test('A3. a stage node and an equipment scope work together: either match keeps the record', () => {
  assert.deepEqual(pick(['513'], new Set(['P1'])).sort(), ['hand', 'press', 'press2'], 'the department: pressing and hand-made, all presses');
  assert.deepEqual(pick(['51311'], new Set(['P1'])), ['press'], 'one press: its equipment link only');
});

test('A4. no selection leaves the records untouched', () => {
  assert.equal(engine.filterUniversalRecords(RECORDS, {}, null, null).length, RECORDS.length);
  assert.equal(engine.filterUniversalRecords(RECORDS, {}, null, []).length, RECORDS.length);
});

test('A5. the stage filter and the cost-centre selection are both applied (a narrowing AND, never a widening)', () => {
  const rules = map.resolveStageRulesForNodes(['501'], index());
  assert.deepEqual(engine.filterUniversalRecords(RECORDS, { stageTypes: ['chinese_mills'] }, null, rules).map((r: any) => r.id), []);
  assert.deepEqual(engine.filterUniversalRecords(RECORDS, { stageTypes: ['rotary_furnace'], subCenterId: 'rotary_shakers' }, null, rules).map((r: any) => r.id), ['shake']);
});

test('S1. the Production Records, Reports and Dashboard screens pass the stage rules to the filter', () => {
  const dash = read('src/components/dashboard/DashboardView.tsx');
  assert.ok(/resolveStageRulesForNodes\(costCenterNodeIds, hierarchyIndex\)/.test(dash) && /filterUniversalRecords\(allRecords, filters, productionScope, stageRules\)/.test(dash));
  const rep = read('src/components/reports/ReportsView.tsx');
  assert.ok(/resolveStageRulesForNodes\(selectedNodes/.test(rep) && /filterUniversalRecords\(records, filters, hierarchyScope, stageRules\)/.test(rep));
  const view = read('src/components/production/ProductionRecordsView.tsx');
  assert.ok(/resolveStageRulesForNodes\(costCenterNodeIds, hierarchyIndex\)/.test(view) && /stageRules=\{stageHierarchyRules\}/.test(view));
  const sec = read('src/components/production/AllStagesRecordsSection.tsx');
  assert.ok(/\}, hierarchyScope, stageRules\);/.test(sec) && /id="all-stages-scope-note"/.test(sec));
});

(async () => {
  await bootstrap();
  for (const { name, fn } of registered) {
    try { await fn(); console.log(`  PASS  ${name}`); passed++; }
    catch (err: any) { console.log(`  FAIL  ${name}`); console.log(String(err?.message ?? err).split('\n').slice(0, 8).join('\n')); failed++; }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

/**
 * PRODUCTION RECORDS FOR EVERY STAGE (3.38.0).
 *
 * The Production Records screen was the pressing list. It is now the cross-stage list: the stage filter takes
 * "all", one stage, or a group of stages (all mills / all kilns), and the screen's other filters apply to it.
 * Only the pressing filter keeps the legacy pressing table.
 *
 *  G  the stage filter value -> stages (groups, unknown values)
 *  F  the cross-stage filter (stageTypes) and the rotary-kiln sub-centre
 *  S  source pins: the screen, the section, no writes in the section
 *
 * Run: npx tsx scripts/tests/allStagesRecords.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0; let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
const test = (name: string, fn: () => void | Promise<void>) => registered.push({ name, fn });
console.log('allStagesRecords.test.ts');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
let groups: any; let engine: any;
/** reportingEngine imports Firestore through stageRecordService; the stage name tables are the only thing it takes from it, so they are shimmed. */
async function loadEngine() {
  const abs = path.join(ROOT, 'src/services/reportingEngine.ts');
  let src = read('src/services/reportingEngine.ts');
  const needle = "import { STAGE_DISPLAY_NAMES, STAGE_COLLECTION_NAMES } from './stageRecordService';";
  assert.ok(src.includes(needle), 'reportingEngine imports changed - update this shim');
  const stages = ['pressing', 'rotary_furnace', 'chinese_mills', 'tube_ball_mills', 'mortar_concrete', 'mixing', 'lightweight_foam', 'sorting', 'thermal_concrete', 'tunnel_kiln', 'handmade_brick'];
  src = src.replace(needle, `const STAGE_DISPLAY_NAMES: Record<string, string> = ${JSON.stringify(Object.fromEntries(stages.map((x) => [x, x])))};
const STAGE_COLLECTION_NAMES: Record<string, string> = ${JSON.stringify(Object.fromEntries(stages.map((x) => [x, 'stage_' + x])))};`);
  src = src.replace(/(from\s*['"])(\.[^'"]+)(['"])/g, (_m, x, spec, c) => {
    const base = path.resolve(path.dirname(abs), spec);
    for (const cand of [base + '.ts', base + '.tsx', base + '/index.ts']) if (fs.existsSync(cand)) return x + pathToFileURL(cand).href + c;
    return x + spec + c;
  });
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'asfour-allstages-')), 'reportingEngine.ts');
  fs.writeFileSync(out, src, 'utf-8');
  return import(pathToFileURL(out).href);
}
async function bootstrap() {
  groups = await load('src/services/stageFilterGroupsPure.ts');
  engine = await loadEngine();
}

test('G1. "all" and nothing mean no stage restriction', () => {
  assert.equal(groups.expandStageFilter('all', engine.ALL_STAGES), null);
  assert.equal(groups.expandStageFilter('', engine.ALL_STAGES), null);
  assert.equal(groups.expandStageFilter(undefined, engine.ALL_STAGES), null);
});

test('G2. one stage is that stage; a group is all its stages', () => {
  assert.deepEqual(groups.expandStageFilter('pressing', engine.ALL_STAGES), ['pressing']);
  assert.deepEqual(groups.expandStageFilter('group:mills', engine.ALL_STAGES), ['chinese_mills', 'tube_ball_mills']);
  assert.deepEqual(groups.expandStageFilter('group:kilns', engine.ALL_STAGES), ['rotary_furnace', 'tunnel_kiln']);
});

test('G3. an unknown value restricts to nothing - it never silently shows everything', () => {
  assert.deepEqual(groups.expandStageFilter('no_such_stage', engine.ALL_STAGES), []);
});

test('G4. every stage of every group is a real stage', () => {
  for (const g of groups.STAGE_FILTER_GROUPS) for (const s of g.stages) assert.ok(engine.ALL_STAGES.includes(s), `${g.id}: ${s}`);
});

test('G5. the rotary sub-centre filter belongs to the rotary kiln and the kilns group only', () => {
  assert.equal(groups.includesRotaryKiln('rotary_furnace'), true);
  assert.equal(groups.includesRotaryKiln('group:kilns'), true);
  for (const v of ['all', 'pressing', 'tunnel_kiln', 'group:mills']) assert.equal(groups.includesRotaryKiln(v), false, v);
});

const REC = (id: string, stageType: string, extra: any = {}) => ({ id, stageType, date: '2025-12-31', quantity: 1, unit: 'طن', status: 'SUBMITTED', createdBy: '', createdAt: '', updatedAt: '', stageNameAr: '', rawData: {}, ...extra });
const ALL = [REC('p', 'pressing'), REC('c', 'chinese_mills'), REC('t', 'tube_ball_mills'), REC('r', 'rotary_furnace'), REC('s', 'rotary_furnace', { rawData: { subCenterId: 'rotary_shakers' } }), REC('k', 'tunnel_kiln'), REC('m', 'mixing')];
const ids = (f: any, scope: any = null) => engine.filterUniversalRecords(ALL, f, scope).map((r: any) => r.id);

test('F1. a group filter keeps exactly the records of its stages - all mills, all kilns', () => {
  assert.deepEqual(ids({ stageTypes: groups.expandStageFilter('group:mills', engine.ALL_STAGES) }), ['c', 't']);
  assert.deepEqual(ids({ stageTypes: groups.expandStageFilter('group:kilns', engine.ALL_STAGES) }), ['r', 's', 'k']);
});

test('F2. one stage keeps only that stage; no stage filter keeps everything', () => {
  assert.deepEqual(ids({ stageTypes: ['pressing'] }), ['p']);
  assert.equal(ids({}).length, ALL.length);
  assert.equal(ids({ stageTypes: [] }).length, ALL.length, 'an empty list is no restriction');
});

test('F3. the kiln group refines to the rotary kiln\'s sub-centres', () => {
  const kilns = groups.expandStageFilter('group:kilns', engine.ALL_STAGES);
  assert.deepEqual(ids({ stageTypes: kilns, subCenterId: 'rotary_shakers' }), ['s']);
  assert.deepEqual(ids({ stageTypes: kilns, subCenterId: engine.SUB_CENTER_MAIN }), ['r', 'k'], 'no sub-centre = the kiln itself (and the tunnel kiln, which has none)');
});

test('F4. the cost-centre (equipment) scope still applies together with the stage group', () => {
  const withEq = [REC('a', 'chinese_mills', { rawData: { millId: 'M1' } }), REC('b', 'chinese_mills', { rawData: { millId: 'M2' } })];
  const out = engine.filterUniversalRecords(withEq, { stageTypes: ['chinese_mills'] }, new Set(['M1'])).map((r: any) => r.id);
  assert.ok(out.length <= 1, 'the scope narrows; it never widens');
});

test('S1. the screen has the stage filter, defaults to all stages, and keeps the legacy table for pressing only', () => {
  const view = read('src/components/production/ProductionRecordsView.tsx');
  assert.ok(/id="production-records-stage-filter"/.test(view));
  assert.ok(/useState<string>\(STAGE_FILTER_ALL\)/.test(view), 'default: all stages');
  assert.ok(/STAGE_FILTER_GROUPS\.map/.test(view) && /ALL_STAGES\.map/.test(view), 'groups and every stage are offered');
  assert.ok(/<AllStagesRecordsSection/.test(view) && /\{isPressingOnly && \(<>/.test(view));
  assert.ok(/stageValue=\{stageFilter\}/.test(view) && /hierarchyScope=\{stageHierarchyScope\}/.test(view), 'the stage value and the cost-centre scope reach the list');
  assert.ok(/productId=\{filterProduct\}/.test(view) && /customerId=\{filterCustomer\}/.test(view) && /shiftId=\{filterShift\}/.test(view) && /searchQuery=\{searchQuery\}/.test(view), 'and so do the other filters');
});

test('S2. the cross-stage list reads the same records the Dashboard and Reports read, and writes nothing', () => {
  const sec = read('src/components/production/AllStagesRecordsSection.tsx');
  assert.ok(/fetchUniversalStageRecords\(/.test(sec) && /filterUniversalRecords\(/.test(sec));
  assert.equal(/setDoc|addDoc|updateDoc|deleteDoc|writeBatch|updateProductionRecord|deleteProductionRecord|createStageRecord/.test(sec), false, 'read-only');
  assert.ok(/id="all-stages-table"/.test(sec) && /id="all-stages-export"/.test(sec) && /id="all-stages-sub-center"/.test(sec));
});

test('S3. the stage records of other stages are not edited here; a pressing row hands over to the legacy dialogs', () => {
  const sec = read('src/components/production/AllStagesRecordsSection.tsx');
  assert.ok(/r\.stageType === 'pressing' && onEditPressing/.test(sec) && /r\.stageType === 'pressing' && onDeletePressing/.test(sec));
});

test('S4. every records / reports screen takes the same stage groups, not just the records screen (3.38.1)', () => {
  for (const [file, marker] of [
    ['src/components/reports/ReportsView.tsx', /STAGE_FILTER_GROUPS\.map/],
    ['src/components/production/DataReviewView.tsx', /STAGE_FILTER_GROUPS\.map/],
    ['src/components/dashboard/DashboardView.tsx', /STAGE_FILTER_GROUPS\.map/],
  ] as Array<[string, RegExp]>) {
    const src = read(file);
    assert.ok(marker.test(src), `${file} offers the stage groups`);
    assert.ok(/expandStageFilter/.test(src), `${file} expands them through the one helper`);
  }
  assert.ok(/stageTypes: stageGroup && stageGroup\.length > 1/.test(read('src/components/dashboard/DashboardView.tsx')), 'a group reaches the Dashboard filters as stageTypes');
  assert.ok(/stageTypes: \(expandStageFilter\(stageFilter, ALL_STAGES\) \?\? \[\]\)\.length > 1/.test(read('src/components/reports/ReportsView.tsx')), 'and the Reports filters');
});

test('S5. an Odoo record is recognised by any of the import own fields, and the stored data can be inspected', () => {
  const sec = read('src/components/production/AllStagesRecordsSection.tsx');
  for (const f of ['identityKey', 'provenance?.importSessionId', 'manufacturingOrderNumber', 'sourceDocumentReference', 'externalRefs']) assert.ok(sec.includes(f), f);
  assert.ok(/id="all-stages-raw"/.test(sec) && /rawDataPreview/.test(sec));
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

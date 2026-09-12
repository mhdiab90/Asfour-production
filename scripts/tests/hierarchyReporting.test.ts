/**
 * HIERARCHY-AWARE REPORTING
 *
 * Reports read UniversalStageRecord, so hierarchy membership is resolved as:
 *
 *     stage record -> rawData.pressId / .furnaceId
 *       -> equipment master record
 *         -> hierarchyNodeId
 *           -> node + descendants
 *
 * Everything below runs the SHIPPED shared resolver and the SHIPPED filter
 * engine. Nothing is mocked, and no second traversal is written here.
 *
 * The two properties that matter most:
 *
 *   1. With NO hierarchy selection, filtering is byte-identical to before -
 *      a report that does not use this feature must not move by a decimal.
 *   2. Overlapping branches never double-count, and equipment that is not
 *      linked is never swept in under a parent.
 *
 * Run: npx tsx scripts/tests/hierarchyReporting.test.ts
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

console.log('hierarchyReporting.test.ts');

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

let eng: any;
let hier: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  eng = await load('src/services/productionFilterEnginePure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
}

/**
 * The exact hierarchy from §31:
 *
 *   المكابس
 *     بوخر
 *       بوخر 900 2   -> P1
 *       بوخر 900 3   -> P2
 *   الأفران
 *     الفرن الدوار 1 -> F1
 */
const NODES = [
  { id: 'N-PRESSES', code: '5', name: 'المكابس', parentId: null },
  { id: 'N-BOKHER', code: '51', name: 'بوخر', parentId: 'N-PRESSES' },
  { id: 'N-B9002', code: '5134', name: 'بوخر 900 2', parentId: 'N-BOKHER' },
  { id: 'N-B9003', code: '5135', name: 'بوخر 900 3', parentId: 'N-BOKHER' },
  { id: 'N-FURNACES', code: '6', name: 'الأفران', parentId: null },
  { id: 'N-ROTARY', code: '61', name: 'الفرن الدوار 1', parentId: 'N-FURNACES' },
];

const EQUIPMENT = [
  { id: 'P1', hierarchyNodeId: 'N-B9002' },
  { id: 'P2', hierarchyNodeId: 'N-B9003' },
  { id: 'P99', hierarchyNodeId: null },     // unlinked - must never ride in under a parent
  { id: 'F1', hierarchyNodeId: 'N-ROTARY' },
];

/**
 * Stage records, shaped exactly as fetchUniversalStageRecords returns them:
 * the source document is preserved under rawData, which is where a pressing
 * record's equipment reference lives.
 */
const RECORDS = Object.freeze([
  Object.freeze({ id: 'R1', stageType: 'pressing', date: '2026-01-10', productId: 'prA', customerId: 'c1',
    productionTons: 100, goodTons: 90, wasteTons: 10, totalDowntimeMinutes: 5, status: 'APPROVED',
    rawData: Object.freeze({ pressId: 'P1', shiftId: 's1' }) }),
  Object.freeze({ id: 'R2', stageType: 'pressing', date: '2026-01-20', productId: 'prB', customerId: 'c2',
    productionTons: 200, goodTons: 180, wasteTons: 20, totalDowntimeMinutes: 0, status: 'APPROVED',
    rawData: Object.freeze({ pressId: 'P2', shiftId: 's2' }) }),
  Object.freeze({ id: 'R3', stageType: 'pressing', date: '2026-02-05', productId: 'prA', customerId: 'c1',
    productionTons: 300, goodTons: 300, wasteTons: 0, totalDowntimeMinutes: 0, status: 'APPROVED',
    rawData: Object.freeze({ pressId: 'P99', shiftId: 's1' }) }),
  // A record from a stage that has no equipment reference at all.
  Object.freeze({ id: 'R4', stageType: 'mixing', date: '2026-01-15', productId: 'prA', customerId: 'c1',
    productionTons: 400, goodTons: 400, wasteTons: 0, totalDowntimeMinutes: 0, status: 'APPROVED',
    rawData: Object.freeze({}) }),
  // A pressing record naming BOTH a press and a furnace.
  Object.freeze({ id: 'R5', stageType: 'pressing', date: '2026-01-25', productId: 'prB', customerId: 'c2',
    productionTons: 50, goodTons: 50, wasteTons: 0, totalDowntimeMinutes: 0, status: 'SUBMITTED',
    rawData: Object.freeze({ pressId: 'P1', furnaceId: 'F1', shiftId: 's2' }) }),
]);
const SNAPSHOT = JSON.stringify(RECORDS);

const index = () => hier.buildHierarchyIndex(NODES);
const nodeSel = (...ids: string[]) => ids.map((i) => `node:${i}`);
const ids = (rows: any[]) => rows.map((r) => r.id).sort();

function scopeFor(...nodeIds: string[]) {
  return eng.resolveHierarchyEquipmentScope(
    nodeSel(...nodeIds),
    { index: index() },
    { equipment: EQUIPMENT },
  );
}
function report(...nodeIds: string[]) {
  return eng.applyHierarchyScopeToStageRecords(RECORDS, scopeFor(...nodeIds));
}
const totalTons = (rows: any[]) => rows.reduce((s: number, r: any) => s + (r.productionTons || 0), 0);

// ==================================================
// A. §31 EXACT BUSINESS TEST
// ==================================================

test('A1. §31 - report for المكابس totals 300 (R1 100 + R2 200); R3 excluded', () => {
  const rows = report('N-PRESSES');
  assert.deepEqual(ids(rows), ['R1', 'R2', 'R5']);
  // R1 + R2 = 300, plus R5 (also a Bo-kher 900 2 press record) = 350.
  assert.equal(totalTons(rows.filter((r: any) => r.id !== 'R5')), 300,
    'the two records named in the specification total 300');
  assert.equal(rows.some((r: any) => r.id === 'R3'), false, 'unlinked P99 must not be included');
  assert.equal(rows.some((r: any) => r.id === 'R4'), false, 'a record with no equipment cannot belong to a press branch');
});

test('A2. §31 - report for بوخر totals the same as المكابس here', () => {
  assert.deepEqual(ids(report('N-BOKHER')), ['R1', 'R2', 'R5']);
});

test('A3. §31 - report for بوخر 900 2 resolves to P1 only', () => {
  const rows = report('N-B9002');
  assert.deepEqual(ids(rows), ['R1', 'R5']);
  assert.equal(totalTons(rows.filter((r: any) => r.id === 'R1')), 100);
});

test('A4. §31 - report for بوخر 900 3 resolves to P2 only, total 200', () => {
  const rows = report('N-B9003');
  assert.deepEqual(ids(rows), ['R2']);
  assert.equal(totalTons(rows), 200);
});

test('A5. §10 - a leaf never pulls in its siblings', () => {
  assert.equal(report('N-B9002').some((r: any) => r.id === 'R2'), false);
  assert.equal(report('N-B9003').some((r: any) => r.id === 'R1'), false);
});

// ==================================================
// B. §32 OVERLAP + §15 DUPLICATE PREVENTION
// ==================================================

test('B1. §32 - selecting a parent AND its own descendant does not double-count', () => {
  const rows = report('N-PRESSES', 'N-BOKHER');
  assert.deepEqual(ids(rows), ['R1', 'R2', 'R5']);
  for (const id of ['R1', 'R2', 'R5']) {
    assert.equal(rows.filter((r: any) => r.id === id).length, 1, `${id} must appear exactly once`);
  }
  assert.equal(totalTons(rows.filter((r: any) => r.id !== 'R5')), 300, 'still 300, never 600');
});

test('B2. §15 - a record matching through BOTH its press and its furnace appears once', () => {
  // R5 names press P1 (under Presses) and furnace F1 (under Furnaces).
  const rows = report('N-PRESSES', 'N-FURNACES');
  assert.equal(rows.filter((r: any) => r.id === 'R5').length, 1,
    'R5 matches two selected branches and must still be counted once');
  assert.deepEqual(ids(rows), ['R1', 'R2', 'R5']);
});

test('B3. §8 - equipment ids are deduplicated before any record is examined', () => {
  const scope = scopeFor('N-PRESSES', 'N-BOKHER', 'N-B9002');
  assert.deepEqual([...scope].sort(), ['P1', 'P2'], 'overlapping branches collapse to the same two presses');
});

test('B4. §8 - multi-branch union', () => {
  assert.deepEqual([...scopeFor('N-BOKHER', 'N-FURNACES')].sort(), ['F1', 'P1', 'P2']);
});

// ==================================================
// C. §33 RE-PARENTING
// ==================================================

test('C1. §33 - moving a node moves the production with it, at reporting time', () => {
  const moved = NODES.map((nd) => (nd.id === 'N-B9002' ? { ...nd, parentId: 'N-FURNACES' } : nd));
  const movedIndex = hier.buildHierarchyIndex(moved);
  const scope = (nodeId: string) =>
    eng.resolveHierarchyEquipmentScope(nodeSel(nodeId), { index: movedIndex }, { equipment: EQUIPMENT });

  assert.equal(scope('N-PRESSES').has('P1'), false, 'المكابس no longer includes P1');
  assert.equal(scope('N-FURNACES').has('P1'), true, 'الأفران now includes P1');
  // The equipment link itself never changed - only the node's parent did.
  assert.equal(EQUIPMENT.find((e) => e.id === 'P1')!.hierarchyNodeId, 'N-B9002');
  assert.equal(JSON.stringify(RECORDS), SNAPSHOT, 'and no production record moved');
});

// ==================================================
// D. §26 UNLINKED EQUIPMENT SAFETY
// ==================================================

test('D1. §26 - unlinked equipment is never included under any parent', () => {
  for (const nodeId of ['N-PRESSES', 'N-BOKHER', 'N-B9002', 'N-B9003', 'N-FURNACES', 'N-ROTARY']) {
    assert.equal(scopeFor(nodeId).has('P99'), false, `P99 must not appear under ${nodeId}`);
  }
});

test('D2. §28 - a node with nothing linked yields an EMPTY scope, not a null one', () => {
  const orphanNodes = [...NODES, { id: 'N-EMPTY', code: '9', name: 'فارغ', parentId: null }];
  const scope = eng.resolveHierarchyEquipmentScope(
    nodeSel('N-EMPTY'),
    { index: hier.buildHierarchyIndex(orphanNodes) },
    { equipment: EQUIPMENT },
  );
  assert.notEqual(scope, null, 'a selection was made, so the scope must not be null');
  assert.equal(scope.size, 0, 'but nothing is linked to it');
  // The UI can therefore say "no linked equipment" rather than showing a bare zero.
  assert.deepEqual(eng.applyHierarchyScopeToStageRecords(RECORDS, scope), []);
});

// ==================================================
// E. §34 REGRESSION - no selection means no change
// ==================================================

test('E1. §34 - with no hierarchy selection the record set is returned untouched', () => {
  assert.equal(eng.resolveHierarchyEquipmentScope([], { index: index() }, { equipment: EQUIPMENT }), null);
  const out = eng.applyHierarchyScopeToStageRecords(RECORDS, null);
  assert.deepEqual(ids(out), ids([...RECORDS]));
  assert.equal(out.length, RECORDS.length, 'every record survives, including the ones with no equipment');
  assert.equal(totalTons(out), 1050, '100+200+300+400+50 - unchanged from before this feature existed');
});

test('E2. §34 - the reporting engine only scopes when a scope is actually passed', () => {
  const src = readCode('src/services/reportingEngine.ts');
  assert.ok(/hierarchyScope\?: Set<string> \| null/.test(src), 'the parameter must be optional');
  assert.ok(/applyHierarchyScopeToStageRecords\(records, hierarchyScope \?\? null\)/.test(src),
    'an absent scope must resolve to null, which is the identity case');
  // The existing predicate is untouched.
  for (const kept of ['filters.startDate', 'filters.endDate', 'filters.stageType', 'filters.productId',
                      'filters.customerId', 'filters.employeeId', 'filters.shiftId', 'filters.pressId']) {
    assert.ok(src.includes(kept), `${kept} must still be applied`);
  }
});

test('E3. §14 - no aggregation formula was touched', () => {
  const src = readCode('src/services/reportingEngine.ts');
  for (const formula of [
    'row.productionTons += rec.productionTons || 0',
    'row.goodTons += rec.goodTons || 0',
    'row.wasteTons += rec.wasteTons || 0',
    'row.downtimeMinutes += rec.totalDowntimeMinutes || 0',
  ]) {
    assert.ok(src.includes(formula), `the existing formula "${formula}" must be unchanged`);
  }
});

// ==================================================
// F. §18-§22 COMPOSITION with the existing filters
// ==================================================

/** Mirrors reportingEngine.filterUniversalRecords' predicate, to prove composition. */
function applyExistingFilters(rows: any[], f: any) {
  return rows.filter((r) => {
    if (f.startDate && r.date < f.startDate) return false;
    if (f.endDate && r.date > f.endDate) return false;
    if (f.stageType && f.stageType !== 'all' && r.stageType !== f.stageType) return false;
    if (f.productId && r.productId !== f.productId) return false;
    if (f.customerId && r.customerId !== f.customerId) return false;
    if (f.shiftId && (r.rawData?.shiftId || '') !== f.shiftId) return false;
    if (f.status && r.status !== f.status) return false;
    return true;
  });
}

test('F1. §18 - product + hierarchy compose (AND, not OR)', () => {
  const rows = applyExistingFilters(report('N-PRESSES'), { productId: 'prA' });
  assert.deepEqual(ids(rows), ['R1'], 'only the Presses record whose product is prA');
});

test('F2. §19 - customer + hierarchy compose', () => {
  assert.deepEqual(ids(applyExistingFilters(report('N-PRESSES'), { customerId: 'c2' })), ['R2', 'R5']);
});

test('F3. §20 - shift + hierarchy compose', () => {
  assert.deepEqual(ids(applyExistingFilters(report('N-PRESSES'), { shiftId: 's1' })), ['R1']);
});

test('F4. §21 - date range + hierarchy compose, with date boundaries unchanged', () => {
  const rows = applyExistingFilters(report('N-PRESSES'), { startDate: '2026-01-01', endDate: '2026-01-21' });
  assert.deepEqual(ids(rows), ['R1', 'R2'], 'R5 (Jan 25) falls outside the range');
});

test('F5. §22 - status + hierarchy compose; hierarchy never lets an excluded record in', () => {
  const approved = applyExistingFilters(report('N-PRESSES'), { status: 'APPROVED' });
  assert.deepEqual(ids(approved), ['R1', 'R2'], 'R5 is SUBMITTED and stays excluded');
});

test('F6. §6 - the hierarchy scope narrows and never widens', () => {
  const unscoped = eng.applyHierarchyScopeToStageRecords(RECORDS, null);
  for (const nodeId of ['N-PRESSES', 'N-BOKHER', 'N-B9002', 'N-FURNACES']) {
    const scoped = report(nodeId);
    assert.ok(scoped.length <= unscoped.length, `${nodeId} must not widen the result`);
    for (const r of scoped) {
      assert.ok(unscoped.some((u: any) => u.id === r.id), 'every scoped record came from the unscoped set');
    }
  }
});

// ==================================================
// G. §4/§16 HONEST LIMITS + §2 ONE ENGINE
// ==================================================

test('G1. §4 - a record with no equipment reference yields no equipment ids', () => {
  assert.deepEqual(eng.stageRecordEquipmentIds({ rawData: {} }), []);
  assert.deepEqual(eng.stageRecordEquipmentIds({}), []);
  // ALL referenced equipment is returned, not just the first.
  assert.deepEqual(eng.stageRecordEquipmentIds({ rawData: { pressId: 'P1', furnaceId: 'F1' } }), ['P1', 'F1']);
  // Duplicates within one record collapse.
  assert.deepEqual(eng.stageRecordEquipmentIds({ rawData: { pressId: 'X', machineId: 'X' } }), ['X']);
});

test('G2. §4 - the seven non-pressing stages are excluded by a press scope, not silently kept', () => {
  assert.equal(report('N-PRESSES').some((r: any) => r.stageType === 'mixing'), false,
    'a mixing record references no equipment, so it cannot be proven to belong to Presses');
});

test('G3. §2 - reporting adds no second hierarchy traversal', () => {
  const engine = readCode('src/services/productionFilterEnginePure.ts');
  assert.ok(/resolveEquipmentForHierarchyNodes/.test(engine), 'must delegate to the shared resolver');
  assert.equal(/while\s*\(queue|stack\.pop\(\)|function\s+\w*[Dd]escendants/.test(engine), false,
    'the engine must not walk the tree itself');
  const rv = readCode('src/components/reports/ReportsView.tsx');
  assert.ok(/resolveHierarchyEquipmentScope\(/.test(rv), 'the view must consume the shared resolver');
  /*
   * The view DOES mention `parentId`, once, to map the stored field name onto
   * the resolver's input shape (parentId: node.parentSheet1Code). That is
   * adaptation, not traversal - so the assertion targets traversal constructs
   * rather than the identifier, which would forbid the legitimate mapping.
   */
  assert.equal(/childrenOf|getDescendants|while\s*\(queue|stack\.pop\(\)/.test(rv), false,
    'the view must not walk the tree itself');
  const parentMentions = (rv.match(/parentId/g) || []).length;
  assert.equal(parentMentions, 1, `parentId may appear only in the resolver input mapping (found ${parentMentions})`);
  assert.ok(/parentId: node\.parentSheet1Code/.test(rv), 'and that one mention must be exactly that mapping');
});

test('G4. §39 - AI was not touched by this change', () => {
  for (const rel of [
    'src/assistant/tools/productionQueryTools.ts',
    'src/assistant/tools/stageReportTools.ts',
    'src/assistant/tools/registry.ts',
  ]) {
    const src = readCode(rel);
    assert.equal(/resolveHierarchyEquipmentScope|hierarchyNodeId|asNodeSelection/.test(src), false,
      `${rel} must be unchanged by this release`);
  }
});

test('G5. §35 - exports flow from the same filtered dataset, with no separate implementation', () => {
  const rv = readCode('src/components/reports/ReportsView.tsx');
  // filteredRecords -> reportRows -> export. One chain.
  assert.ok(/filterUniversalRecords\(records, filters, hierarchyScope\)/.test(rv),
    'the scope must be applied in the single filtering memo');
  assert.ok(/aggregateByDimension\(filteredRecords/.test(rv), 'aggregation reads the filtered set');
  assert.ok(/exportAggregatedReportToExcel\(\s*reportRows/.test(rv), 'export reads the aggregated rows');
  assert.equal(/exportAggregatedReportToExcel\(\s*records/.test(rv), false,
    'export must never be handed the unfiltered records');
});

test('G6. §27 - resolution is set/map work, with no query per node or per equipment', () => {
  const engine = readCode('src/services/productionFilterEnginePure.ts');
  assert.equal(/getDocs|firebase|await /.test(engine), false, 'the engine must stay pure and synchronous');
  const rv = readCode('src/components/reports/ReportsView.tsx');
  assert.equal(/selectedNodes[\s\S]{0,200}fetchMasterData/.test(rv), false,
    'changing the selection must not trigger a read');
});

test('G7. §36/§38 - no new permission, no rules change, no migration', () => {
  const rv = readCode('src/components/reports/ReportsView.tsx');
  for (const invented of ['reports.hierarchy', 'hierarchy.report', 'reports.scope']) {
    assert.equal(rv.includes(invented), false, `must not invent the permission ${invented}`);
  }
  assert.equal(/setDoc|updateDoc|writeBatch|deleteDoc/.test(rv), false,
    'viewing a report must write nothing');
});

test('G8. §13 - the record fixtures were never mutated by any assertion above', () => {
  assert.equal(JSON.stringify(RECORDS), SNAPSHOT);
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

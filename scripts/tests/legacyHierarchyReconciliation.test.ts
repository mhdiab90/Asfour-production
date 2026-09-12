/**
 * LEGACY CODE <-> HIERARCHY RECONCILIATION
 *
 * The same real press can exist twice - once as a legacy master record, once as
 * an imported hierarchy node - with different names and the same code. These
 * assertions cover the rule that decides when those are the same business
 * object, and, more importantly, when the system must refuse to decide.
 *
 * The engine is pure and runs as shipped. Nothing here writes anything: the
 * reconciliation produces a report and a plan, and applying the plan is a
 * separate explicit step.
 *
 * Run: npx tsx scripts/tests/legacyHierarchyReconciliation.test.ts
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

console.log('legacyHierarchyReconciliation.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readCode(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

let rec: any;
let hier: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  rec = await load('src/services/legacyHierarchyReconciliationPure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
}

/** Note the deliberately DIFFERENT names for the same codes. */
const LEGACY = [
  { id: 'L-1', code: '10025', name: 'مكبس الألومينا', categoryId: 'presses' },
  { id: 'L-2', code: '5001', name: 'مكبس بوخر 1', categoryId: 'presses' },
  { id: 'L-3', code: '7777', name: 'مكبس بلا مقابل', categoryId: 'presses' },
  { id: 'L-4', code: '6001', name: 'فرن دوار', categoryId: 'furnaces' },
  { id: 'L-5', code: '8888', name: 'مكبس مكرر أ', categoryId: 'presses' },
  { id: 'L-6', code: '8888', name: 'مكبس مكرر ب', categoryId: 'presses' },
  { id: 'L-7', code: '9999', name: 'مكبس مرتبط سلفًا', categoryId: 'presses', hierarchyNodeId: 'N-9999' },
];

const NODES = [
  { id: 'N-10025', code: '10025', name: 'كبس الالومينا', type: 'EQUIPMENT' },
  { id: 'N-5001', code: '5001', name: 'بوخر 1', type: 'EQUIPMENT' },
  { id: 'N-6001', code: '6001', name: 'الفرن الدوار', type: 'EQUIPMENT' },
  { id: 'N-8888', code: '8888', name: 'مكرر', type: 'EQUIPMENT' },
  { id: 'N-9999', code: '9999', name: 'مرتبط سلفًا', type: 'EQUIPMENT' },
  { id: 'N-ORPHAN', code: '4444', name: 'عقدة بلا مقابل', type: 'WORK_CENTER' },
  { id: 'N-DUP-A', code: '3333', name: 'مزدوج أ', type: 'EQUIPMENT' },
  { id: 'N-DUP-B', code: '3333', name: 'مزدوج ب', type: 'EQUIPMENT' },
];

const run = (legacy = LEGACY, nodes = NODES) => rec.reconcileLegacyWithHierarchy(legacy, nodes);

// ==================================================
// A. THE MATCHING RULE (§41 A1-A6)
// ==================================================

test('A1. TEST A1/A5 - same code, same category, one candidate each side = MATCHED', () => {
  const report = run();
  const m = report.matched.find((x: any) => x.legacyId === 'L-1');
  assert.ok(m, 'the alumina press must match');
  assert.equal(m.hierarchyNodeId, 'N-10025');
  // TEST A5: the names differ and that is irrelevant.
  assert.equal(m.legacyName, 'مكبس الألومينا');
  assert.equal(m.hierarchyName, 'كبس الالومينا');
  assert.ok(m.reason.includes('exact code'), 'the reason must name the actual rule');
});

test('A2. TEST A2 / CRITICAL 2 - a different category is never linked on code alone', () => {
  const withAccount = [...LEGACY, { id: 'A-1', code: '10025', name: 'حساب', categoryId: 'financialAccounts' }];
  const report = run(withAccount);
  assert.equal(report.matched.some((m: any) => m.legacyId === 'A-1'), false,
    'a financial account sharing a production code must never be linked');
  assert.equal(report.unmatchedLegacy.some((u: any) => u.id === 'A-1'), false,
    'and it is not even considered - it is out of scope, not unmatched');
  // Only equipment categories are reconcilable at all.
  assert.deepEqual([...rec.RECONCILABLE_EQUIPMENT_CATEGORIES].sort(), ['furnaces', 'mills', 'presses']);
});

test('A3. §33 - cost centres are not reconciled with equipment either', () => {
  const withCostCentre = [...LEGACY, { id: 'C-1', code: '5001', name: 'مركز تكلفة', categoryId: 'costCenters' }];
  const report = run(withCostCentre);
  assert.equal(report.matched.some((m: any) => m.legacyId === 'C-1'), false);
});

test('A4. TEST A3 - two hierarchy nodes with one code = AMBIGUOUS, never linked', () => {
  const legacy = [{ id: 'L-X', code: '3333', name: 'مكبس', categoryId: 'presses' }];
  const report = run(legacy);
  assert.equal(report.matched.length, 0, 'nothing may be persisted');
  assert.equal(report.ambiguous.length, 1);
  assert.deepEqual(report.ambiguous[0].hierarchyNodeIds.sort(), ['N-DUP-A', 'N-DUP-B']);
  assert.ok(report.ambiguous[0].reason.includes('2 hierarchy nodes'));
});

test('A5. two LEGACY records with one code is also AMBIGUOUS', () => {
  const report = run();
  const amb = report.ambiguous.find((a: any) => a.code === '8888');
  assert.ok(amb, 'the duplicated legacy code must be flagged');
  assert.deepEqual(amb.legacyIds.sort(), ['L-5', 'L-6']);
  assert.equal(report.matched.some((m: any) => m.legacyCode === '8888'), false, 'and never guessed');
});

test('A6. TEST A4 - a legacy record with no counterpart stays valid and UNMATCHED', () => {
  const report = run();
  const u = report.unmatchedLegacy.find((x: any) => x.id === 'L-3');
  assert.ok(u, 'it must be reported');
  assert.equal(u.code, '7777');
  assert.equal(report.matched.some((m: any) => m.legacyId === 'L-3'), false, 'and not linked to anything');
});

test('A7. a hierarchy node with no counterpart is reported too', () => {
  const report = run();
  assert.ok(report.unmatchedHierarchy.some((x: any) => x.id === 'N-ORPHAN'));
});

test('A8. an existing link is reported as already linked, not re-applied', () => {
  const report = run();
  const m = report.matched.find((x: any) => x.legacyId === 'L-7');
  assert.ok(m);
  assert.equal(m.alreadyLinked, true);
  assert.equal(rec.safeLinkPlan(report).some((p: any) => p.legacyId === 'L-7'), false,
    'nothing to write - it is already correct');
});

test('A9. §34 - the report counts every bucket', () => {
  const report = run();
  assert.equal(report.counts.matched, report.matched.length);
  assert.equal(report.counts.ambiguous, report.ambiguous.length);
  assert.equal(report.counts.unmatchedLegacy, report.unmatchedLegacy.length);
  assert.ok(report.counts.matched > 0 && report.counts.ambiguous > 0 && report.counts.unmatchedLegacy > 0,
    'the fixture exercises all three outcomes');
  const summary = rec.summariseReconciliation(report, 'ar');
  assert.ok(summary.includes(String(report.counts.matched)));
});

// ==================================================
// B. THE PLAN IS SAFE BY CONSTRUCTION (§8, §34, §35)
// ==================================================

test('B1. §8 - the plan contains ONLY unambiguous, not-yet-linked matches', () => {
  const report = run();
  const plan = rec.safeLinkPlan(report);
  const ambiguousCodes = new Set(report.ambiguous.map((a: any) => a.code));
  for (const link of plan) {
    assert.equal(ambiguousCodes.has(rec.normaliseCode(link.code)), false, 'no ambiguous code may be planned');
    assert.ok(link.legacyId && link.hierarchyNodeId && link.categoryId, 'every link is fully specified');
  }
  assert.deepEqual(plan.map((p: any) => p.legacyId).sort(), ['L-1', 'L-2', 'L-4']);
});

test('B2. §4/§35 - reconciliation deletes and merges nothing', () => {
  const src = readCode('src/services/legacyHierarchyReconciliationPure.ts');
  assert.equal(/deleteDoc|updateDoc|setDoc|writeBatch|\.splice\(/.test(src), false,
    'the engine must not write or mutate');
  // The inputs are untouched.
  const before = JSON.stringify(LEGACY);
  run();
  assert.equal(JSON.stringify(LEGACY), before, 'the legacy records are not mutated');
});

test('B3. CRITICAL 4 - no fuzzy matching anywhere in the authoritative path', () => {
  const src = readCode('src/services/legacyHierarchyReconciliationPure.ts');
  assert.equal(/rankFuzzyCandidates|levenshtein|similarity|confidence/.test(src), false,
    'name similarity must play no part');
  // Names are carried into the report but never compared.
  assert.equal(/legacyName\s*===|name\s*===\s*.*name/.test(src), false, 'names are never compared');
});

test('B4. code normalisation is canonical, not lossy', () => {
  assert.equal(rec.normaliseCode(' 10025 '), '10025');
  assert.equal(rec.normaliseCode('١٠٠٢٥'), '10025', 'Arabic-Indic digits fold to ASCII');
  // Leading zeros are significant and must survive.
  assert.notEqual(rec.normaliseCode('0501'), rec.normaliseCode('501'));
  assert.equal(rec.normaliseCode(null), '');
});

// ==================================================
// C. LEAF RESOLUTION THROUGH THE RECONCILED LINK (§28, §42)
// ==================================================

test('C1. §28 - a reconciled leaf resolves to the legacy equipment id', () => {
  const report = run();
  const equipment = rec.applyReconciliationToEquipment(
    LEGACY.map((l) => ({ id: l.id, hierarchyNodeId: l.hierarchyNodeId })),
    report,
  );
  const l2 = equipment.find((e: any) => e.id === 'L-2');
  assert.equal(l2.hierarchyNodeId, 'N-5001', 'the code match completed the link');

  // And the shared resolver then reaches it from the node.
  const index = hier.buildHierarchyIndex([{ id: 'N-5001', code: '5001', parentId: null }]);
  const byNode = hier.buildEquipmentByNode(equipment);
  assert.deepEqual(hier.resolveEquipmentForHierarchyNodes(index, byNode, ['N-5001'], { includeSelf: true }), ['L-2']);
});

test('C2. §5 - an explicitly stored link always beats a derived one', () => {
  const report = rec.reconcileLegacyWithHierarchy(
    [{ id: 'L-9', code: '5001', name: 'x', categoryId: 'presses', hierarchyNodeId: 'N-MANUAL' }],
    NODES,
  );
  const equipment = rec.applyReconciliationToEquipment([{ id: 'L-9', hierarchyNodeId: 'N-MANUAL' }], report);
  assert.equal(equipment[0].hierarchyNodeId, 'N-MANUAL', 'a human decision is never overridden');
});

test('C3. ambiguous codes never complete a link', () => {
  const report = run();
  const equipment = rec.applyReconciliationToEquipment(
    [{ id: 'L-5', hierarchyNodeId: null }, { id: 'L-6', hierarchyNodeId: null }],
    report,
  );
  for (const e of equipment) {
    assert.equal(e.hierarchyNodeId ?? null, null, 'an ambiguous record stays unlinked');
  }
});

test('C4. TEST A6 - production records are not touched by any of this', () => {
  const src = readCode('src/services/legacyHierarchyReconciliationPure.ts');
  for (const field of ['pressId', 'furnaceId', 'productionQuantity', 'productionTons', 'ProductionRecord']) {
    assert.equal(src.includes(field), false, `${field} must not appear in the reconciliation engine`);
  }
});

// ==================================================
// D. WIRING (§9, §31, §40)
// ==================================================

test('D1. §31 - the reconciliation feeds the SAME resolver map, not a new path', () => {
  const src = readCode('src/components/production/ProductionRecordsView.tsx');
  assert.ok(/reconcileLegacyWithHierarchy\(/.test(src));
  assert.ok(/applyReconciliationToEquipment\(/.test(src));
  assert.ok(/buildEquipmentByNode\(equipmentLinks\)/.test(src), 'results flow into the shared equipment map');
  // No second resolver.
  assert.equal(/while\s*\(queue|getDescendants/.test(src), false);
});

test('D2. §40 - reconciliation is index work, with no query per code', () => {
  const src = readCode('src/services/legacyHierarchyReconciliationPure.ts');
  assert.equal(/getDocs|firebase|await /.test(src), false, 'the engine must stay pure and synchronous');
  assert.ok(/new Map\(/.test(src), 'grouping must be map-based, not a nested scan');
  assert.equal(/for \([\s\S]{0,80}for \([\s\S]{0,80}for \(/.test(src), false, 'no triple-nested scan');
});

test('D3. §9 - Master Data shows the linked hierarchy path, not an id', () => {
  const src = readCode('src/components/masterData/MasterDataView.tsx');
  assert.ok(/hierarchyLabelFor\(item\.hierarchyNodeId\)/.test(src), 'the path is rendered');
  assert.ok(/غير مرتبط/.test(src), 'and "not linked" is stated plainly');
  assert.ok(/id="equipment-hierarchy-node"/.test(src), 'the link is editable');
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

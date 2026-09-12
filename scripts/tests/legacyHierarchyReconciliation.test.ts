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

// ==================================================
// E. CONFLICT PROTECTION + APPLY (§25 TEST 8-12, §10, §11, §12)
//
// The apply service writes through updateMasterDataItem, which reaches
// Firebase, so its behaviour is exercised by re-implementing nothing: the
// loop's CONTRACT is asserted here against the pure plan, and its wiring by
// source inspection. What matters most is that a conflict can never reach the
// plan at all - that safety is structural, not a check someone can skip.
// ==================================================

test('E1. TEST 9 / §10 / CRITICAL 4 - an existing DIFFERENT link is a CONFLICT, never overwritten', () => {
  const report = rec.reconcileLegacyWithHierarchy(
    [{ id: 'L-C', code: '5001', name: 'press', categoryId: 'presses', hierarchyNodeId: 'N-ELSEWHERE' }],
    NODES,
  );
  assert.equal(report.matched.length, 0, 'it must not be reported as a plain match');
  assert.equal(report.conflicts.length, 1);
  assert.equal(report.conflicts[0].currentHierarchyNodeId, 'N-ELSEWHERE');
  assert.equal(report.conflicts[0].proposedHierarchyNodeId, 'N-5001');
  assert.deepEqual(rec.safeLinkPlan(report), [], 'and it can never reach the write plan');
});

test('E2. TEST 8 / §11 - an existing link to the SAME node is a no-op, not a rewrite', () => {
  const report = rec.reconcileLegacyWithHierarchy(
    [{ id: 'L-S', code: '5001', name: 'press', categoryId: 'presses', hierarchyNodeId: 'N-5001' }],
    NODES,
  );
  assert.equal(report.conflicts.length, 0, 'agreeing with the code is not a conflict');
  assert.equal(report.matched[0].alreadyLinked, true);
  assert.deepEqual(rec.safeLinkPlan(report), [], 'nothing to write');
});

test('E3. §4/§28 - the safe count IS the planned write count', () => {
  const report = run();
  const plan = rec.safeLinkPlan(report);
  // Every planned link corresponds to a matched, not-yet-linked row.
  const writable = report.matched.filter((m: any) => !m.alreadyLinked);
  assert.equal(plan.length, writable.length, 'the number confirmed is the number written');
  for (const p of plan) {
    assert.ok(report.matched.some((m: any) => m.legacyId === p.legacyId && m.hierarchyNodeId === p.hierarchyNodeId));
  }
});

test('E4. §16 - the confirmation states the exact count and the safety guarantee', () => {
  const ar = rec.applyConfirmationMessage(97, 'ar');
  const en = rec.applyConfirmationMessage(97, 'en');
  assert.ok(ar.includes('97') && en.includes('97'), 'the exact count appears');
  assert.ok(ar.includes('لن يتم تعديل السجلات التاريخية'), 'and the historical-data guarantee');
  assert.ok(/Historical production records will not be modified/.test(en));
});

test('E5. §5/CRITICAL 13 - the applier consumes the plan and never re-matches', () => {
  const src = readCode('src/services/legacyHierarchyLinkService.ts');
  assert.equal(/reconcileLegacyWithHierarchy|normaliseCode|groupBy/.test(src), false,
    'the write phase must not contain matching logic of its own');
  assert.ok(/plan: readonly SafeLink\[\]/.test(src), 'it takes the already-validated plan');
});

test('E6. §8/CRITICAL 12 - writes go through the shared audited update, not raw Firestore', () => {
  const src = readCode('src/services/legacyHierarchyLinkService.ts');
  assert.ok(/updateMasterDataItem\(collection, link\.legacyId, \{ hierarchyNodeId: link\.hierarchyNodeId \}\)/.test(src),
    'one field, one document, through the shared path');
  assert.equal(/getDocs|setDoc|writeBatch|deleteDoc|collection\(db/.test(src), false,
    'no raw Firestore call may appear');
  // The shared path is what carries audit + cache invalidation.
  const svc = readCode('src/services/masterDataService.ts');
  assert.ok(/logAuditAction\('UPDATE'/.test(svc) && /invalidateCachedCollection/.test(svc));
});

test('E7. TEST 11 / §12 / CRITICAL 9 - a failure isolates and never rolls back the rest', () => {
  const src = readCode('src/services/legacyHierarchyLinkService.ts');
  assert.ok(/for \(const link of plan\)/.test(src), 'one link at a time');
  assert.ok(/try \{[\s\S]*?\} catch \(error: any\) \{/.test(src), 'each link has its own try/catch');
  assert.equal(/rollback|revert|transaction|runTransaction/.test(src), false,
    'there must be no rollback - 97 good links must survive 3 bad ones');
  assert.ok(/successCount|failedCount|skippedCount/.test(src), 'all three outcomes are counted');
});

test('E8. TEST 12 / §11 - an already-correct row is skipped, so a second run writes nothing', () => {
  const src = readCode('src/services/legacyHierarchyLinkService.ts');
  assert.ok(/String\(current\) === link\.hierarchyNodeId/.test(src), 'the idempotency check exists');
  assert.ok(/skipped\.push/.test(src), 'and is counted as skipped, not applied');
  // The skip happens BEFORE the write.
  const body = src.slice(src.indexOf('for (const link of plan)'));
  assert.ok(body.indexOf('skipped.push') < body.indexOf('updateMasterDataItem'),
    'the skip must short-circuit before writing');
});

test('E9. §7/CRITICAL 5 - the applier cannot touch a production document', () => {
  const src = readCode('src/services/legacyHierarchyLinkService.ts');
  for (const forbidden of ['pressId', 'furnaceId', 'productId', 'customerId', 'quantity', 'ProductionRecord', 'production']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not appear in the applier`);
  }
  // It writes exactly one field.
  const writes = src.match(/updateMasterDataItem\([^)]*\)/g) || [];
  assert.equal(writes.length, 1, 'exactly one write call site');
  assert.ok(writes[0].includes('hierarchyNodeId'), 'writing only the link field');
});

test('E10. §24/CRITICAL 6 - nothing destructive exists in either module', () => {
  for (const rel of ['src/services/legacyHierarchyLinkService.ts', 'src/services/legacyHierarchyReconciliationPure.ts']) {
    const src = readCode(rel);
    assert.equal(/deleteMasterDataItem|deleteDoc|\.remove\(|merge\(/.test(src), false,
      `${rel} must not delete or merge`);
  }
});

test('E11. §15/§22 - the action is gated on the existing Master Data permission', () => {
  const src = readCode('src/components/masterData/MasterDataView.tsx');
  assert.ok(/id="apply-safe-links-btn"/.test(src));
  assert.ok(/disabled=\{!canImportMasterData \|\| plannedLinks\.length === 0/.test(src),
    'no permission or no plan means no button');
  for (const invented of ['reconciliation.apply', 'hierarchy.link', 'masterData.reconcile']) {
    assert.equal(src.includes(invented), false, `must not invent the permission ${invented}`);
  }
});

test('E12. §16 - the UI confirms before writing, and applies only the plan', () => {
  const src = readCode('src/components/masterData/MasterDataView.tsx');
  assert.ok(/window\.confirm\(applyConfirmationMessage\(plannedLinks\.length, language\)\)/.test(src),
    'the confirmation uses the exact planned count');
  assert.ok(/if \(!confirmed\) return;/.test(src), 'cancelling writes nothing');
  assert.ok(/applySafeLinks\(plannedLinks/.test(src), 'only the plan is applied');
  assert.ok(/safeLinkPlan\(reconciliation\)/.test(src), 'and the plan comes from the reconciliation');
});

test('E13. §28 - the outcome numbers reconcile against the plan', () => {
  const src = readCode('src/services/legacyHierarchyLinkService.ts');
  assert.ok(/plannedCount: plan\.length/.test(src), 'the outcome carries what was planned');
  const line = rec.applyConfirmationMessage(3, 'en');
  assert.ok(line.includes('3'));
});

test('E14. §29 - applying issues no per-record read', () => {
  const src = readCode('src/services/legacyHierarchyLinkService.ts');
  assert.equal(/getDoc\(|getDocs\(|fetchMasterData/.test(src), false,
    'current links are passed in, never re-read per row');
  assert.ok(/currentLinks\?: Map</.test(src), 'they arrive as a prebuilt map');
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

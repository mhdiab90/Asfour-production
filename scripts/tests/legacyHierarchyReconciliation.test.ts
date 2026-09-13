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

/** Raw source, line endings normalised - used where the assertion is about literal UI text. */
function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

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
  assert.ok(/\{ equipment: equipmentLinks \}\)/.test(src), 'results flow into the shared engine, which builds the equipment map');
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

test('E11. §22 - no permission was invented for the reconciliation screen', () => {
  /*
   * Retargeted. This asserted the Apply button's WIRING inside MasterDataView,
   * which the read-only release deliberately removed: applying is a separate
   * step, and two entry points were not wanted. The property it guarded -
   * that no new permission exists - is still asserted, here and in F10.
   */
  const src = readCode('src/components/masterData/MasterDataView.tsx');
  for (const invented of ['reconciliation.apply', 'hierarchy.link', 'masterData.reconcile']) {
    assert.equal(src.includes(invented), false, `must not invent the permission ${invented}`);
  }
  /*
   * The apply path IS reachable again - that is this release's purpose, and
   * 3.15.1's read-only state was the deliberate intermediate step. What §22
   * actually requires is that it reuses the existing permission, which the
   * gating below asserts.
   */
  assert.ok(/applySafeLinks\(/.test(src), 'the apply path is wired');
  assert.ok(/disabled=\{!canImportMasterData/.test(src), 'and gated on the existing permission');
});

test('E12. §16 - the confirmation and the plan-only rule live in the shared modules', () => {
  /*
   * Also retargeted, for the same reason. The confirmation text and the
   * "apply only the plan" guarantee are properties of the reconciliation module
   * and the applier service - not of a button that this release removed - so
   * they are asserted where they actually live and cannot be lost.
   */
  const msg = rec.applyConfirmationMessage(42, 'ar');
  assert.ok(msg.includes('42'), 'the confirmation names the exact count');
  assert.ok(msg.includes('لن يتم تعديل السجلات التاريخية'), 'and the historical-data guarantee');

  const svc = readCode('src/services/legacyHierarchyLinkService.ts');
  assert.ok(/plan: readonly SafeLink\[\]/.test(svc), 'the applier takes only the validated plan');
  assert.equal(/reconcileLegacyWithHierarchy|normaliseCode/.test(svc), false,
    'and never re-derives which links are safe');
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
// ==================================================
// F. THE UI IS REACHABLE (§15 TEST 1-10)
//
// V3.15.0 shipped the reconciliation but nobody could find it. The banner was
// gated on THREE conditions at once: being on an equipment tab, AND a non-zero
// matched count, OR a non-zero ambiguous count. With the hierarchy not yet
// imported both counts are zero, so the feature did not exist on screen at all -
// on any tab. These assertions pin the fix so it cannot silently regress.
// ==================================================

const MDV = 'src/components/masterData/MasterDataView.tsx';

test('F1. TEST 1 - a visible entry point exists among the Master Data utilities', () => {
  const src = readCode(MDV);
  assert.ok(/id="master-data-reconcile-btn"/.test(src), 'the button must exist');
  assert.ok(/setIsReconcileOpen\(true\)/.test(src), 'and it must open the panel');
  // It sits with the other utilities, not buried in the code list.
  const btnAt = src.indexOf('master-data-reconcile-btn');
  const qualityAt = src.indexOf('master-data-quality-report-btn');
  assert.ok(qualityAt > 0 && Math.abs(btnAt - qualityAt) < 2500,
    'it belongs beside the existing Master Data utility actions');
});

test('F2. TEST 2 / §5 / §11 - the panel is NOT hidden by zero counts or by the active tab', () => {
  const src = readCode(MDV);
  // The old triple gate is gone.
  assert.equal(/reconciliation\.counts\.matched > 0 \|\| reconciliation\.counts\.ambiguous > 0/.test(src), false,
    'a zero-count gate must never hide the feature again');
  assert.equal(/isEquipmentTab && reconciliation/.test(src), false,
    'and it must not depend on which tab is open');
  // The panel opens purely on user intent.
  assert.ok(/isOpen=\{isReconcileOpen\}/.test(src), 'visibility is the open flag alone');
});

test('F3. §8 - reconciliation spans ALL equipment categories, not the current tab', () => {
  const src = readCode(MDV);
  assert.ok(/RECONCILABLE_EQUIPMENT_CATEGORIES\.map\(/.test(src), 'every equipment category is loaded');
  assert.ok(/allEquipment\.map\(/.test(src), 'and reconciled together');
  assert.equal(/categoryId: activeTab/.test(src), false, 'never scoped to the tab on screen');
});

test('F4. TEST 3 / §3 / §13 - this is NOT the Cost Center hierarchy feature', () => {
  const src = readSource(MDV);
  // Both exist, and they are different controls with different labels.
  assert.ok(src.includes('مطابقة الأكواد مع التسلسل الهرمي'), 'the reconciliation label');
  assert.ok(src.includes('التسلسل الهرمي لمراكز التكلفة'), 'the cost-centre browser label still exists');
  const code = readCode(MDV);
  const reconcileBtn = code.indexOf('master-data-reconcile-btn');
  const costCentreBtn = code.indexOf('master-data-cost-center-hierarchy-btn');
  assert.ok(reconcileBtn > 0 && costCentreBtn > 0 && reconcileBtn !== costCentreBtn,
    'two separate buttons');
  // The reconciliation button must not open the cost-centre panel.
  const block = code.slice(reconcileBtn - 400, reconcileBtn + 400);
  assert.equal(/setIsHierarchyPanelOpen/.test(block), false,
    'the reconciliation entry point must not open the Cost Center browser');
});

test('F5. TEST 4-7 - all four counts are rendered, including zeroes', () => {
  const src = readCode(MDV);
  for (const bucket of ['safe', 'review', 'none', 'conflict']) {
    assert.ok(src.includes(`'${bucket}'`), `the ${bucket} bucket must be rendered`);
  }
  assert.ok(/counts\.matched/.test(src), 'safe matches');
  assert.ok(/counts\.ambiguous/.test(src), 'needs review');
  assert.ok(/counts\.unmatchedLegacy/.test(src), 'no counterpart');
  assert.ok(/counts\.conflicts/.test(src), 'conflicts');
  // The counts are not wrapped in a "> 0" condition.
  assert.equal(/counts\.conflicts > 0 &&[\s\S]{0,80}reconcile-count/.test(src), false,
    'a zero count must still render its card');
});

test('F6. §11 - an explicit empty state replaces the old disappearance', () => {
  const src = readSource(MDV);
  assert.ok(src.includes('لا توجد بيانات للمطابقة'), 'the zero-data message must exist');
  const code = readCode(MDV);
  assert.ok(/allEquipment\.length === 0 \|\| hierarchyNodes\.length === 0/.test(code),
    'and it is chosen by the data state, not by hiding the panel');
});

test('F7. §7 - merely OPENING the panel still writes nothing', () => {
  /*
   * Narrowed from "the screen has no write path" - which was true only while
   * the action was disabled - to the property that outlives that: viewing the
   * reconciliation is read-only, and a write happens only on an explicit,
   * confirmed click.
   */
  const src = readCode(MDV);
  // Opening is just state.
  assert.ok(/onClick=\{\(\) => setIsReconcileOpen\(true\)\}/.test(src), 'the entry point only opens the panel');
  // The write is behind the confirmation, inside the handler.
  const handlerAt = src.indexOf('const handleApplySafeLinks');
  assert.ok(handlerAt > 0, 'the apply handler exists');
  const body = src.slice(handlerAt, handlerAt + 900);
  assert.ok(body.indexOf('window.confirm') < body.indexOf('applySafeLinks('),
    'nothing is written before the user confirms');
  // And the reconciliation itself is a pure computation, not a write.
  assert.equal(/useMemo\([\s\S]{0,200}applySafeLinks/.test(src), false,
    'rendering must never trigger an apply');
});

test('F8. TEST 9 - no production write path exists anywhere on this screen', () => {
  const src = readCode(MDV);
  for (const forbidden of ['pressId', 'productionQuantity', 'ProductionRecord', 'deleteProductionRecord']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not appear in Master Data`);
  }
  // The only master-data write is the pre-existing per-row Edit save.
  const writes = (src.match(/updateMasterDataItem\(/g) || []).length;
  assert.equal(writes, 1, `expected only the existing row-Edit save, found ${writes}`);
});

test('F9. TEST 10 - the existing Master Data category UI is untouched', () => {
  const src = readCode(MDV);
  for (const kept of [
    'master-data-quality-btn', 'master-data-quality-report-btn', 'master-data-export-btn',
    'master-data-add-btn', 'master-data-cost-center-hierarchy-btn', 'equipment-hierarchy-node',
  ]) {
    assert.ok(src.includes(kept), `${kept} must still exist`);
  }
  assert.ok(/subscribeMasterData/.test(src), 'the live category list is unchanged');
});

test('F10. §12 - no new permission was introduced for viewing the reconciliation', () => {
  const src = readCode(MDV);
  for (const invented of ['reconciliation.view', 'hierarchy.reconcile', 'masterData.reconcile']) {
    assert.equal(src.includes(invented), false, `must not invent ${invented}`);
  }
});

test('F11. §6 - the panel uses the existing engine, not a second matcher', () => {
  const src = readCode(MDV);
  assert.ok(/reconcileLegacyWithHierarchy\(/.test(src), 'the shared engine');
  assert.ok(/safeLinkPlan\(reconciliation\)/.test(src), 'and the shared plan');
  assert.equal(/normaliseCode|levenshtein|similarity/.test(src), false,
    'no matching logic may live in the component');
});

test('F12. §10 - rows show business fields, never internal ids', () => {
  const src = readCode(MDV);
  const modalAt = src.indexOf('master-data-reconcile-modal');
  const block = src.slice(modalAt, modalAt + 6000);
  for (const shown of ['legacyCode', 'legacyCategory', 'legacyName', 'hierarchyName']) {
    assert.ok(block.includes(shown), `${shown} must be displayed`);
  }
  // The node/legacy ids are used as React keys only, never rendered as text.
  assert.equal(/<td[^>]*>\{m\.hierarchyNodeId\}/.test(block), false, 'a node id must never be shown');
  assert.equal(/<td[^>]*>\{m\.legacyId\}/.test(block), false, 'a legacy id must never be shown');
});
// ==================================================
// G. THE APPLY ACTION IS ENABLED (§18 TEST 1-11)
//
// The applier service itself is unchanged since 3.15.0 and is still covered by
// group E. What is new is the wiring: the button now has a handler, and after a
// successful write the panel re-reads the equipment so the applied rows stop
// being pending safe matches.
//
// The counts on the live screen (7 safe / 0 review / 1 no-counterpart / 17
// conflicts) come from real Firestore data this suite cannot reach, so what is
// asserted here is the RULE that produces them: the plan is exactly the safe
// matches, and conflicts and no-counterpart rows cannot enter it.
// ==================================================

const MDVIEW = 'src/components/masterData/MasterDataView.tsx';

test('G1. TEST 1 - the plan is exactly the safe matches, whatever the data', () => {
  /*
   * Mirrors the live shape: several safe, several conflicting, one with no
   * counterpart. The plan must equal the safe ones and nothing else.
   */
  const legacy = [
    { id: 'S1', code: '101', name: 'a', categoryId: 'presses' },
    { id: 'S2', code: '102', name: 'b', categoryId: 'presses' },
    { id: 'S3', code: '103', name: 'c', categoryId: 'furnaces' },
    { id: 'C1', code: '201', name: 'd', categoryId: 'presses', hierarchyNodeId: 'N-OTHER-1' },
    { id: 'C2', code: '202', name: 'e', categoryId: 'presses', hierarchyNodeId: 'N-OTHER-2' },
    { id: 'U1', code: '999', name: 'f', categoryId: 'presses' },
  ];
  const nodes = [
    { id: 'N-101', code: '101', name: 'x', type: 'EQUIPMENT' },
    { id: 'N-102', code: '102', name: 'y', type: 'EQUIPMENT' },
    { id: 'N-103', code: '103', name: 'z', type: 'EQUIPMENT' },
    { id: 'N-201', code: '201', name: 'p', type: 'EQUIPMENT' },
    { id: 'N-202', code: '202', name: 'q', type: 'EQUIPMENT' },
  ];
  const report = rec.reconcileLegacyWithHierarchy(legacy, nodes);
  const plan = rec.safeLinkPlan(report);

  assert.equal(report.counts.matched, 3, 'three safe matches');
  assert.equal(report.counts.conflicts, 2, 'two conflicts');
  assert.equal(report.counts.unmatchedLegacy, 1, 'one with no counterpart');
  assert.equal(plan.length, report.counts.matched, 'the plan size IS the safe count');
  assert.deepEqual(plan.map((p: any) => p.legacyId).sort(), ['S1', 'S2', 'S3']);
});

test('G2. TEST 3/4 / §14/§15 - conflicts and no-counterpart rows can never be written', () => {
  const legacy = [
    { id: 'C1', code: '201', name: 'd', categoryId: 'presses', hierarchyNodeId: 'N-OTHER' },
    { id: 'U1', code: '999', name: 'f', categoryId: 'presses' },
  ];
  const nodes = [{ id: 'N-201', code: '201', name: 'p', type: 'EQUIPMENT' }];
  const report = rec.reconcileLegacyWithHierarchy(legacy, nodes);
  assert.deepEqual(rec.safeLinkPlan(report), [], 'zero writes planned');
  assert.equal(report.counts.conflicts, 1);
  assert.equal(report.counts.unmatchedLegacy, 1);
  // Both survive for manual review.
  assert.equal(report.conflicts[0].legacyId, 'C1');
  assert.equal(report.unmatchedLegacy[0].id, 'U1');
});

test('G3. TEST 2 / §2 - the button applies the displayed plan and nothing else', () => {
  const src = readCode(MDVIEW);
  assert.ok(/onClick=\{handleApplySafeLinks\}/.test(src), 'the button is wired');
  assert.ok(/applySafeLinks\(plannedLinks, \{ currentLinks \}\)/.test(src),
    'it applies exactly the plan the panel is showing');
  assert.ok(/const plannedLinks = useMemo\(/.test(src), 'and the plan comes from the reconciliation');
  // No re-matching inside the write path.
  assert.equal(/handleApplySafeLinks[\s\S]{0,700}reconcileLegacyWithHierarchy/.test(src), false,
    'matching must not be re-run during execution');
});

test('G4. §3 - the confirmation names the exact planned count', () => {
  const src = readCode(MDVIEW);
  assert.ok(/window\.confirm\(applyConfirmationMessage\(plannedLinks\.length, language\)\)/.test(src),
    'the confirmation uses the planned count, not a literal');
  assert.ok(/if \(!window\.confirm\([\s\S]{0,80}\) return;/.test(src), 'cancelling writes nothing');
  const msg = rec.applyConfirmationMessage(7, 'ar');
  assert.ok(msg.includes('7'), 'the count appears verbatim');
  assert.ok(msg.includes('لن يتم تعديل السجلات التاريخية'), 'and the historical guarantee');
});

test('G5. §5 / TEST 5/6 - existing-link protection is structural, not a UI check', () => {
  // Same target -> no-op; different target -> conflict, absent from the plan.
  const same = rec.reconcileLegacyWithHierarchy(
    [{ id: 'X', code: '101', name: 'a', categoryId: 'presses', hierarchyNodeId: 'N-101' }],
    [{ id: 'N-101', code: '101', name: 'x', type: 'EQUIPMENT' }],
  );
  assert.deepEqual(rec.safeLinkPlan(same), [], 'already correct - nothing to write');
  assert.equal(same.counts.conflicts, 0, 'agreeing is not a conflict');

  const diff = rec.reconcileLegacyWithHierarchy(
    [{ id: 'Y', code: '101', name: 'a', categoryId: 'presses', hierarchyNodeId: 'N-ELSEWHERE' }],
    [{ id: 'N-101', code: '101', name: 'x', type: 'EQUIPMENT' }],
  );
  assert.deepEqual(rec.safeLinkPlan(diff), [], 'a different link is never overwritten');
  assert.equal(diff.counts.conflicts, 1);
});

test('G6. TEST 7 / §7 - a failure leaves the other links applied', () => {
  const svc = readCode('src/services/legacyHierarchyLinkService.ts');
  assert.ok(/for \(const link of plan\)/.test(svc), 'one link at a time');
  assert.equal(/rollback|runTransaction|writeBatch/.test(svc), false, 'no rollback, no batch');
  assert.ok(/failed\.push\(/.test(svc), 'a failure is recorded and the loop continues');
  // The UI reports the split rather than a bare success.
  const src = readCode(MDVIEW);
  assert.ok(/describeApplyOutcome\(applyOutcome, language\)/.test(src), 'the outcome is shown');
  assert.ok(/applyOutcome\.failedCount > 0/.test(src), 'failures are listed, not hidden');
});

test('G7. TEST 8 / §8 - a second run writes nothing', () => {
  const svc = readCode('src/services/legacyHierarchyLinkService.ts');
  assert.ok(/String\(current\) === link\.hierarchyNodeId/.test(svc), 'the idempotency check');
  const body = svc.slice(svc.indexOf('for (const link of plan)'));
  assert.ok(body.indexOf('skipped.push') < body.indexOf('updateMasterDataItem'),
    'the skip short-circuits before the write');
  // The UI supplies the current links so the check has something to compare.
  const src = readCode(MDVIEW);
  assert.ok(/currentLinks = new Map<string, string \| null \| undefined>\(/.test(src));
  assert.ok(/allEquipment\.map\(\(e\) => \[String\(e\.id \?\? ''\), e\.hierarchyNodeId\]\)/.test(src),
    'built from what is actually stored');
});

test('G8. TEST 11 / §10/§16 - the panel re-reads after a successful apply', () => {
  const src = readCode(MDVIEW);
  assert.ok(/if \(outcome\.successCount > 0\) setEquipmentRefresh/.test(src),
    'a successful write triggers a refresh');
  assert.ok(/skipCache: equipmentRefresh > 0/.test(src),
    'and the refresh bypasses the cache so it sees what was written');
  assert.ok(/\}, \[equipmentRefresh\]\);/.test(src), 'the load effect re-runs on it');
  // Master Data shows the resulting path.
  assert.ok(/hierarchyLabelFor\(item\.hierarchyNodeId\)/.test(src), 'the linked path is rendered');
});

test('G9. TEST 9/10 / §4/§11 - one field is written, and nothing production-side', () => {
  const svc = readCode('src/services/legacyHierarchyLinkService.ts');
  const writes = svc.match(/updateMasterDataItem\([^)]*\)/g) || [];
  assert.equal(writes.length, 1, 'exactly one write call site');
  assert.ok(writes[0].includes('hierarchyNodeId'), 'writing only the link field');
  for (const forbidden of ['pressId', 'furnaceId', 'productId', 'customerId', 'quantity', 'ProductionRecord']) {
    assert.equal(svc.includes(forbidden), false, `${forbidden} must not appear in the applier`);
  }
  // The audited path is what carries the audit entry and the invalidation.
  const md = readCode('src/services/masterDataService.ts');
  assert.ok(/logAuditAction\('UPDATE'/.test(md) && /invalidateCachedCollection/.test(md));
});

test('G10. §6 - the apply path writes through the shared service, never raw Firestore', () => {
  /*
   * Scoped to the reconciliation path. MasterDataView legitimately contains one
   * pre-existing writeBatch - the "Analyze Current Codes" products update,
   * which predates all of this work - so forbidding raw Firestore across the
   * whole 2800-line component would assert something that was never true.
   */
  const src = readCode(MDVIEW);
  assert.ok(/applySafeLinks\(/.test(src), 'the apply goes through the service');
  const handlerAt = src.indexOf('const handleApplySafeLinks');
  const body = src.slice(handlerAt, handlerAt + 1200);
  assert.equal(/getDocs|setDoc|writeBatch|deleteDoc|collection\(db|doc\(db/.test(body), false,
    'the apply handler itself must contain no raw Firestore call');
  // And the service it calls is equally clean.
  assert.equal(/getDocs|setDoc|writeBatch|deleteDoc|collection\(db/.test(readCode('src/services/legacyHierarchyLinkService.ts')), false,
    'nor may the applier service');
});

test('G11. §12/§13 - Reports, AI, Dashboard and Production Records were not modified', () => {
  for (const rel of [
    'src/components/reports/ReportsView.tsx',
    'src/assistant/tools/stageReportTools.ts',
    'src/components/dashboard/DashboardView.tsx',
    'src/components/production/ProductionRecordsView.tsx',
  ]) {
    const src = readCode(rel);
    assert.equal(/applySafeLinks|legacyHierarchyLinkService/.test(src), false,
      `${rel} must not gain a write path`);
  }
});

test('G12. §1 - permission gating is unchanged and no key was invented', () => {
  const src = readCode(MDVIEW);
  assert.ok(/disabled=\{!canImportMasterData \|\| plannedLinks\.length === 0/.test(src),
    'no permission or an empty plan disables the action');
  assert.ok(/if \(plannedLinks\.length === 0 \|\| !canImportMasterData\) return;/.test(src),
    'and the handler refuses too, not just the button');
  for (const invented of ['reconciliation.apply', 'hierarchy.link', 'masterData.reconcile']) {
    assert.equal(src.includes(invented), false, `must not invent ${invented}`);
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

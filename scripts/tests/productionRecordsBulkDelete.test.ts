/**
 * PRODUCTION RECORDS - CANONICAL COST-CENTRE FILTER + SAFE BULK DELETE
 *
 * F  the filter panel: one shared hierarchical cost-centre selector, the old
 *    drill-down / equipment list / code-type controls gone, and the cost-centre
 *    scope resolved by the SHARED engine against real legacy record shapes
 * D  bulk delete: the plan (selected ∩ visible), the confirmation, permission,
 *    one existing-primitive call per record, partial failure, stale records
 * R  regression: edit, single delete, selection, master data, other screens
 *
 * The planner/executor and the filter engine are pure and run as shipped, with
 * the delete primitive injected as a recording fake - no Firestore document is
 * touched by this suite. The screen imports Firebase, so its wiring is asserted
 * by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/productionRecordsBulkDelete.test.ts
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

console.log('productionRecordsBulkDelete.test.ts');

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

let bulk: any;
let eng: any;
let hier: any;
let reg: any;
let dash: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  bulk = await load('src/services/productionRecordsBulkDeletePure.ts');
  eng = await load('src/services/productionFilterEnginePure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  dash = await load('src/services/costCenterDashboardPure.ts');
}

const PRV = 'src/components/production/ProductionRecordsView.tsx';

/*
 *   5 الأقسام الإنتاجية
 *   ├─ 513 المكابس ─┬─ 5131 مكابس بوخر ─┬─ 51311 بوخر 1   (leaf, press B1)
 *   │               │                     └─ 51312 بوخر 2   (leaf, press B2)
 *   │               └─ 5132 مكابس لايس ─── 51321 لايس 1600 (leaf, press L1)
 *   └─ 514 الأفران ──── 5141 فرن 1 (leaf, furnace F1)
 *   6 الأقسام الخدمية ── 61 الورشة (no equipment)
 */
const NODES = [
  ['5', null], ['513', '5'], ['5131', '513'], ['51311', '5131'], ['51312', '5131'],
  ['5132', '513'], ['51321', '5132'], ['514', '5'], ['5141', '514'], ['6', null], ['61', '6'],
] as const;
function index() {
  return hier.buildHierarchyIndex(NODES.map(([c, p]) => ({ id: c, code: c, sheet1Code: c, parentId: p })));
}
const EQUIPMENT = [
  { id: 'B1', hierarchyNodeId: '51311' },
  { id: 'B2', hierarchyNodeId: '51312' },
  { id: 'L1', hierarchyNodeId: '51321' },
  { id: 'F1', hierarchyNodeId: '5141' },
  { id: 'OLD', hierarchyNodeId: null },
];
/** Legacy `production` records, shaped like ProductionRecord (pressId / furnaceId). */
const RECORDS = [
  { id: 'r1', date: '2026-08-01', pressId: 'B1', shiftId: 'night', productId: 'X' },
  { id: 'r2', date: '2026-08-02', pressId: 'B2', shiftId: 'day', productId: 'X' },
  { id: 'r3', date: '2026-08-03', pressId: 'L1', furnaceId: 'F1', shiftId: 'night', productId: 'Y' },
  { id: 'r4', date: '2026-08-04', pressId: 'OLD', shiftId: 'night', productId: 'X' },
  { id: 'r5', date: '2026-09-01', pressId: 'B1', shiftId: 'night', productId: 'X' },
];
const RECORDS_SNAPSHOT = JSON.stringify(RECORDS);

/** Exactly what the screen does: node ids -> shared selection -> shared engine. */
function filterByCostCentres(nodeIds: string[], records = RECORDS) {
  const selection = reg.normaliseSelection('productionCenters', nodeIds.map(eng.asNodeSelection), nodeIds.length === 0);
  return eng.filterLegacyProductionRecords(records, selection, { index: index() }, { equipment: EQUIPMENT });
}
const ids = (rows: any[]) => rows.map((r) => r.id).sort();

// ==================================================
// F. FILTER UI
// ==================================================

test('F1. one canonical cost-centre selector - the SAME component the dashboards use', () => {
  const src = readCode(PRV);
  assert.equal((src.match(/<CostCenterScopeSelector/g) || []).length, 1, 'exactly one organisational selector');
  assert.ok(/import \{ CostCenterScopeSelector \} from '\.\.\/dashboard\/CostCenterScopeSelector'/.test(src), 'the shared component, not a copy');
  assert.ok(/<CostCenterScopeSelector\s+index=\{hierarchyIndex\}\s+selectedNodeIds=\{costCenterNodeIds\}\s+onChange=\{setCostCenterNodeIds\}/.test(src));
  assert.ok(/buildCostCenterHierarchyIndex\(hierarchyNodes\)/.test(src), 'the canonical index (id = sheet1Code)');
  const files = fs.readdirSync(path.join(ROOT, 'src/components/production'));
  assert.equal(files.some((f) => /CostCenter.*Selector/i.test(f)), false, 'no Production Records copy of the selector');
});

test('F2. the old drill-down columns and equipment checklist are gone - no hidden state', () => {
  const src = readCode(PRV);
  assert.equal(/hierarchySelection|hierarchySelectorPure|levelOptions|toggleAtLevel|equipmentUnderSelection|branchEquipment/.test(src), false);
  assert.equal(/production-records-hierarchy-level-|production-records-hierarchy-path/.test(src), false);
  assert.equal(/لا توجد معدة مرتبطة بالاختيار الحالي/.test(src), false, 'no "no equipment" message for a childless node');
});

test('F3. the Code Type -> Codes controls are gone - no hidden state', () => {
  const src = readCode(PRV);
  assert.equal(/filterCategoryId|filterCodes|availableCodes|legacyProductionCategories|legacyCodeSourceCategories/.test(src), false);
  assert.equal(/production-records-code-category|production-records-codes/.test(src), false);
  assert.equal(/نوع الأكواد/.test(readSource(PRV)), false);
});

test('F4. one unified filter panel holds period, cost centres, shift, product, customer and search', () => {
  const src = readCode(PRV);
  const a = src.indexOf('id="production-records-filter-panel"');
  const b = src.indexOf('grid grid-cols-2 sm:grid-cols-4 gap-3');
  assert.ok(a >= 0 && b > a, 'the panel precedes the KPI strip');
  const panel = src.slice(a, b);
  for (const [name, re] of [
    ['start date', /value=\{startDate\}/], ['end date', /value=\{endDate\}/], ['cost centres', /<CostCenterScopeSelector/],
    ['shift', /value=\{filterShift\}/], ['product', /value=\{filterProduct\}/], ['customer', /value=\{filterCustomer\}/],
    ['search', /id="records-search-input"/], ['export', /id="export-records-btn"/], ['new entry', /id="new-production-entry-btn"/],
  ] as Array<[string, RegExp]>) {
    assert.ok(re.test(panel), `${name} is inside the one panel`);
  }
  assert.ok(/className=\{DASHBOARD_FILTER_PANEL\}/.test(panel), 'the Dashboard filter-panel style');
  assert.ok(/id="production-records-filter-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2/.test(panel), 'responsive grid');
  assert.equal((src.match(/Top Filter & Control Panel/g) || []).length, 0, 'the old separate strip is gone');
  assert.equal(/setIsHierarchyPanelOpen|onNavigate\('master-data'\)/.test(panel), false, 'normal filtering never opens hierarchy maintenance');
});

test('F5. hierarchy search is the shared selector search', () => {
  const idx = index();
  const nodes = NODES.map(([c]) => ({ id: c, code: c, sheet1Code: c, name: c === '5131' ? 'مكابس بوخر' : c === '51311' ? 'بوخر 1' : `n${c}` }));
  const named = hier.buildHierarchyIndex(nodes.map((n) => ({ ...n, parentId: NODES.find(([c]) => c === n.id)![1] })));
  const r = dash.searchCostCenterNodes(named, 'بوخر 1');
  assert.deepEqual([...r.matchedIds], ['51311']);
  assert.ok(r.visibleIds.has('5131') && r.visibleIds.has('513'), 'with its path');
  assert.ok(dash.searchCostCenterNodes(idx, '5132').matchedIds.has('5132'), 'by code');
});

test('F6. a parent selects every descendant\'s records', () => {
  assert.deepEqual(ids(filterByCostCentres(['513'])), ['r1', 'r2', 'r3', 'r5']);
  assert.deepEqual(ids(filterByCostCentres(['5131'])), ['r1', 'r2', 'r5'], 'middle node -> its branch');
  assert.deepEqual(ids(filterByCostCentres(['514'])), ['r3'], 'a record matches through its furnace too');
});

test('F7. a leaf IS its equipment - never "no equipment"', () => {
  assert.deepEqual(ids(filterByCostCentres(['51311'])), ['r1', 'r5']);
  assert.deepEqual(ids(filterByCostCentres(['61'])), [], 'a node with no linked equipment narrows to nothing, not everything');
  assert.deepEqual(ids(filterByCostCentres([])), ['r1', 'r2', 'r3', 'r4', 'r5'], 'nothing ticked = all records, including unlinked equipment');
});

test('F8. several cost centres union, and a record reachable twice appears once', () => {
  assert.deepEqual(ids(filterByCostCentres(['51311', '5132'])), ['r1', 'r3', 'r5']);
  assert.deepEqual(ids(filterByCostCentres(['5132', '514'])), ['r3'], 'press AND furnace in scope -> one row');
  const recursive = dash.toggleCostCenterNode(index(), [], '513');
  assert.deepEqual(ids(filterByCostCentres(recursive)), ids(filterByCostCentres(['513'])), 'the selector\'s materialised branch reads the same');
});

test('F9. the screen filters through the shared engine, composed with the other filters', () => {
  const src = readCode(PRV);
  assert.ok(/normaliseSelection\('productionCenters', costCenterNodeIds\.map\(asNodeSelection\), costCenterNodeIds\.length === 0\)/.test(src));
  assert.ok(/filterLegacyProductionRecords\(records\.filter\(/.test(src), 'date/shift/product/customer/search first, then the engine');
  assert.ok(/\}\), costCenterSelection, \{ index: hierarchyIndex \}, \{ equipment: equipmentLinks \}\);/.test(src));
  assert.equal(/rec\.pressId|rec\.furnaceId/.test(src), false, 'no equipment field is matched by hand');
  assert.ok(/filterCustomer !== 'all' && rec\.customerId !== filterCustomer/.test(src), 'customer stays a real filter');
});

// ==================================================
// D. BULK DELETE
// ==================================================

function fakeDeps(opts: { present?: Set<string>; failOn?: Set<string>; onDelete?: (id: string) => void } = {}) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      isStillPresent: (id: string) => (opts.present ? opts.present.has(id) : true),
      deleteOne: async (id: string) => {
        calls.push(id);
        opts.onDelete?.(id);
        if (opts.failOn?.has(id)) throw new Error(`permission-denied ${id}`);
      },
    },
  };
}

test('D1. nothing selected -> nothing to delete and no action rendered', () => {
  assert.deepEqual(bulk.planBulkDelete([], ['r1', 'r2']).targetIds, []);
  const src = readCode(PRV);
  assert.ok(/\{canDeleteRecords && bulkDeleteCount > 0 && \(\s*<button\s+id="production-records-bulk-delete-btn"/.test(src), 'rendered only with permission AND a non-empty batch');
});

test('D2. one row selected -> the action is available with that one record', () => {
  assert.deepEqual(bulk.planBulkDelete(['r2'], ['r1', 'r2', 'r3']).targetIds, ['r2']);
});

test('D3. the action and the confirmation show the exact batch count', () => {
  const plan = bulk.planBulkDelete(['r1', 'r3', 'r3', 'r5'], ['r1', 'r3', 'r5']);
  assert.equal(plan.targetIds.length, 3, 'deduplicated');
  const src = readCode(PRV);
  assert.ok(/const bulkDeleteCount = planBulkDelete\(selection\.selectedIds, visibleIds\)\.targetIds\.length;/.test(src));
  assert.ok(/حذف السجلات المحددة \(\{bulkDeleteCount\}\)/.test(src));
  assert.ok(/`سيتم حذف \$\{bulkDeletePlan\.targetIds\.length\} سجل من سجلات الإنتاج نهائيًا\. هذا الإجراء لا يمكن التراجع عنه من خلال النظام الحالي\. هل تريد المتابعة؟`/.test(src), 'confirmation count = the frozen batch');
  assert.ok(/production records will be permanently deleted\. This action cannot be undone through the current system\. Continue\?/.test(src));
  assert.ok(/تأكيد الحذف/.test(src) && /إلغاء/.test(src));
});

test('D4. Select All is the visible rows only, and the batch can never exceed them', () => {
  const visible = ['r1', 'r2'];
  const plan = bulk.planBulkDelete(['r1', 'r2', 'r9-hidden'], visible);
  assert.deepEqual(plan.targetIds, ['r1', 'r2']);
  assert.deepEqual(plan.excludedIds, ['r9-hidden'], 'a hidden selected id is excluded, never deleted');
  const src = readCode(PRV);
  assert.ok(/selectAllVisible\(selection, visibleIds\)/.test(src));
});

test('D5. after a filter change the selection is pruned, and the plan re-intersects anyway', () => {
  const src = readCode(PRV);
  assert.ok(/pruneToVisible\(prev, visibleIds\)/.test(src) && /\}, \[visibleIds\]\);/.test(src));
  // August + بوخر branch + product X + night shift, then Select All:
  const scoped = filterByCostCentres(['5131']).filter((r: any) => r.date.startsWith('2026-08') && r.productId === 'X' && r.shiftId === 'night');
  assert.deepEqual(ids(scoped), ['r1'], 'the combined scope');
  const plan = bulk.planBulkDelete(['r1', 'r2', 'r5'], scoped.map((r: any) => r.id));
  assert.deepEqual(plan.targetIds, ['r1'], 'only records visible under THAT combined scope');
});

test('D6. cancelling issues zero deletions - nothing runs until confirm', () => {
  const src = readCode(PRV);
  assert.ok(/const openBulkDelete = \(\) => \{[\s\S]*?setBulkDeletePlan\(plan\);\s*\};/.test(src));
  const open = /const openBulkDelete = \(\) => \{([\s\S]*?)\n  \};/.exec(src)![1];
  assert.equal(/deleteProductionRecord|executeBulkDelete/.test(open), false, 'opening the dialog deletes nothing');
  assert.ok(/onClick=\{\(\) => setBulkDeletePlan\(null\)\}/.test(src), 'cancel only closes');
  assert.ok(/id="production-records-bulk-delete-confirm-btn"\s+type="button"\s+onClick=\{handleConfirmBulkDelete\}/.test(src), 'only the confirm button runs the batch');
});

test('D7. confirming one record = one primitive call', async () => {
  const f = fakeDeps();
  const out = await bulk.executeBulkDelete(['r2'], f.deps);
  assert.deepEqual(f.calls, ['r2']);
  assert.equal(out.successCount, 1);
});

test('D8. confirming several = one existing-primitive call per record, by id', async () => {
  const f = fakeDeps();
  const out = await bulk.executeBulkDelete(['r1', 'r3', 'r5'], f.deps);
  assert.deepEqual(f.calls, ['r1', 'r3', 'r5']);
  assert.deepEqual(out.succeededIds, ['r1', 'r3', 'r5']);
  const src = readCode(PRV);
  assert.ok(/deleteOne: \(id\) => deleteProductionRecord\(id, labelById\.get\(id\)\)/.test(src), 'the injected primitive IS deleteProductionRecord');
  assert.equal(/writeBatch|deleteDoc|deleteStageRecord|deleteMany/.test(src), false, 'no batch write and no second delete path');
});

test('D9. partial failure: successes stay deleted, failures reported with ids, nothing rolled back', async () => {
  const targets = Array.from({ length: 100 }, (_, i) => `r${i}`);
  const f = fakeDeps({ failOn: new Set(['r17', 'r64']) });
  const out = await bulk.executeBulkDelete(targets, f.deps);
  assert.equal(f.calls.length, 100, 'a failure does not stop the batch');
  assert.equal(out.successCount, 98);
  assert.equal(out.failedCount, 2);
  assert.deepEqual(out.failed.map((x: any) => x.id), ['r17', 'r64']);
  assert.equal(out.selectedCount, 100);
  assert.equal(/rollback|restore|undo/i.test(readCode('src/services/productionRecordsBulkDeletePure.ts')), false, 'no rollback path exists');
});

test('D10. a record already removed is skipped and the batch continues', async () => {
  const present = new Set(['r1', 'r3']);
  const f = fakeDeps({ present });
  const out = await bulk.executeBulkDelete(['r1', 'r2', 'r3'], f.deps);
  assert.deepEqual(f.calls, ['r1', 'r3'], 'the missing record is never sent to the primitive');
  assert.deepEqual(out.skippedIds, ['r2']);
  assert.deepEqual([out.successCount, out.failedCount, out.skippedCount], [2, 0, 1]);
  // Presence is checked at each record's turn, against the LIVE snapshot.
  const live = new Set(['a', 'b']);
  const g = fakeDeps({ present: live, onDelete: (id) => { if (id === 'a') live.delete('b'); } });
  const out2 = await bulk.executeBulkDelete(['a', 'b'], g.deps);
  assert.deepEqual(out2.skippedIds, ['b'], 'removed while the batch ran -> skipped');
  const src = readCode(PRV);
  assert.ok(/isStillPresent: \(id\) => recordsRef\.current\.some\(\(r\) => r\.id === id\)/.test(src));
  assert.ok(/recordsRef\.current = records;/.test(src), 'the live subscription, not a stale closure');
});

test('D11. the existing production.delete permission gates the action AND the handlers', () => {
  const src = readCode(PRV);
  assert.ok(/const canDeleteRecords = hasPermission\('production\.delete'\);/.test(src));
  assert.ok(/const openBulkDelete = \(\) => \{\s*if \(!canDeleteRecords\) return;/.test(src), 'opening refuses without it');
  assert.ok(/if \(!canDeleteRecords \|\| !plan \|\| bulkDeleteProgress\) return;/.test(src), 'executing refuses without it');
  const perms = readCode('src/types/permissions.ts');
  assert.equal(/production\.bulkDelete|production\.deleteSelected/.test(perms + src), false, 'no new permission key');
});

test('D12. bulk delete touches production records only - never master data or the hierarchy', () => {
  const src = readCode(PRV);
  assert.equal(/deleteMasterDataItem|updateMasterDataItem|createMasterDataItem|updateCostCenterHierarchyNode|financialAccount/i.test(src), false);
  const pure = readCode('src/services/productionRecordsBulkDeletePure.ts');
  assert.equal(/import /.test(pure), false, 'the planner imports nothing - it can only call what it is given');
  const svc = readCode('src/services/productionService.ts');
  assert.ok(/export async function deleteProductionRecord\(id: string, recordName\?: string\): Promise<void> \{\s*try \{\s*const docRef = doc\(db, 'production', id\);\s*await deleteDoc\(docRef\);\s*await logAuditAction\('DELETE', 'production', id,/.test(svc),
    'the primitive is unchanged: one production document, with its existing audit entry');
});

test('D13. unrelated records are untouched - the fixture never mutates and only targets are deleted', async () => {
  const f = fakeDeps();
  const plan = bulk.planBulkDelete(['r1'], ids(filterByCostCentres(['51311'])));
  await bulk.executeBulkDelete(plan.targetIds, f.deps);
  assert.deepEqual(f.calls, ['r1'], 'r5 shares the leaf but was not selected');
  assert.equal(JSON.stringify(RECORDS), RECORDS_SNAPSHOT);
});

test('D14. the result summary reports success, failed, skipped and selected; failures stay reviewable', () => {
  const src = readCode(PRV);
  assert.ok(/id="production-records-bulk-delete-summary"/.test(src));
  for (const field of ['successCount', 'failedCount', 'skippedCount', 'selectedCount']) {
    assert.ok(new RegExp(`bulkDeleteOutcome\\.${field}`).test(src), field);
  }
  assert.ok(/bulkDeleteOutcome\.failed\.map\(\(f\) => \(/.test(src), 'failed ids listed');
  assert.equal(/setSelection\([^)]*succeededIds|setRecords\(/.test(src.slice(src.indexOf('const handleConfirmBulkDelete'))), false,
    'rows leave only through the live snapshot - a failed row is never hidden');
  const withoutWarning = src.replace('لا يمكن التراجع عنه', '').replace('cannot be undone', '');
  assert.equal(/undo|تراجع عن الحذف|استرجاع|soft delete|brestoreb/i.test(withoutWarning), false, 'no undo or restore is claimed');
});

// ==================================================
// R. REGRESSION
// ==================================================

test('R1/R2. edit and single-record delete are unchanged', () => {
  const src = readCode(PRV);
  assert.ok(/updateProductionRecord\(editingRecord\.id, editingRecord\)/.test(src));
  assert.ok(/onClick=\{\(\) => setDeleteConfirmRecord\(rec\)\}/.test(src));
  assert.ok(/await deleteProductionRecord\(\s*deleteConfirmRecord\.id,/.test(src));
  assert.equal((src.match(/deleteProductionRecord\(/g) || []).length, 2, 'the single-row confirm and the injected bulk primitive - nothing else');
});

test('R3/R4. row selection and Select All are unchanged', () => {
  const src = readCode(PRV);
  for (const re of [/toggleRow\(selection, rec\.id\)/, /isSelected\(selection, rec\.id\)/, /id="production-records-select-all"/, /id="production-records-selected-count"/, /deselectAll\(\)/]) {
    assert.ok(re.test(src), String(re));
  }
});

test('R5-R8. Dashboard, Reports, AI and Financial Accounts do not consume the bulk delete', () => {
  for (const rel of ['src/components/dashboard/DashboardView.tsx', 'src/components/dashboard/DashboardBuilderView.tsx', 'src/components/reports/ReportsView.tsx', 'src/assistant/tools/stageReportTools.ts', 'src/components/masterData/MasterDataView.tsx']) {
    assert.equal(/productionRecordsBulkDeletePure|executeBulkDelete/.test(readCode(rel)), false, rel);
  }
  assert.equal(/deleteDoc/.test(readCode('src/services/stageRecordService.ts').replace(/import[^;]*;/g, '')), false, 'stage records still have no delete primitive');
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

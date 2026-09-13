/**
 * DASHBOARD COST-CENTRE UNIFICATION + FINANCIAL VALUES
 *
 * D  the shared cost-centre scope (both Dashboards, one definition)
 * F  financial transactions: parsing, exact-code validation, partial import,
 *    aggregation - and that money is never mixed with quantity
 * C  consistency: a Dashboard selection and the same Reports selection keep
 *    exactly the same production records
 * S  selector search by code/name with path context, and recursive tri-state
 *    checkbox selection resolved against the full hierarchy
 * P  Custom Dashboard visual parity with the classic Dashboard
 * W  wiring, asserted by source inspection with comments stripped (the screens
 *    import Firebase, so they cannot run here)
 *
 * Run: npx tsx scripts/tests/costCenterDashboard.test.ts
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

console.log('costCenterDashboard.test.ts');

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

let dash: any;
let fin: any;
let hier: any;
let eng: any;
let panels: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  dash = await load('src/services/costCenterDashboardPure.ts');
  fin = await load('src/services/financialTransactionsPure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
  eng = await load('src/services/productionFilterEnginePure.ts');
  panels = await load('src/services/masterDataPanelsPure.ts');
}

/*
 * A small hierarchy shaped like the real one: the document id IS the sheet1Code.
 *   5 -> 51 -> 511 (leaf)        6 -> 61 (leaf)       9 (root, no children)
 */
const NODES = [
  { id: '5', sheet1Code: '5', parentSheet1Code: null, name: 'Factories' },
  { id: '51', sheet1Code: '51', parentSheet1Code: '5', name: 'Pressing' },
  { id: '511', sheet1Code: '511', parentSheet1Code: '51', name: 'Press line 1' },
  { id: '6', sheet1Code: '6', parentSheet1Code: null, name: 'Services' },
  { id: '61', sheet1Code: '61', parentSheet1Code: '6', name: 'Workshop' },
  { id: '9', sheet1Code: '9', parentSheet1Code: null, name: 'Other' },
];
const EQUIPMENT = [
  { id: 'P1', hierarchyNodeId: '511' },
  { id: 'P2', hierarchyNodeId: '51' },
  { id: 'F1', hierarchyNodeId: '61' },
  { id: 'P9', hierarchyNodeId: null },
];

/** The same index construction the Dashboards use (buildCostCenterHierarchyIndex, which imports Firebase). */
function canonicalIndex() {
  return hier.buildHierarchyIndex(
    NODES.map((n) => ({ ...n, id: n.sheet1Code || n.id, code: n.sheet1Code, parentId: n.parentSheet1Code ?? null })),
  );
}
/** The construction ReportsView uses. */
function reportsIndex() {
  return hier.buildHierarchyIndex(NODES.map((n) => ({ ...n, id: n.id, code: n.sheet1Code, parentId: n.parentSheet1Code })));
}

const RECORDS = [
  { id: 'r1', date: '2026-09-01', stageType: 'pressing', quantity: 10, rawData: { pressId: 'P1' } },
  { id: 'r2', date: '2026-09-02', stageType: 'pressing', quantity: 20, rawData: { pressId: 'P2' } },
  { id: 'r3', date: '2026-09-03', stageType: 'pressing', quantity: 30, rawData: { pressId: 'P9', furnaceId: 'F1' } },
  { id: 'r4', date: '2026-09-04', stageType: 'pressing', quantity: 40, rawData: { pressId: 'P9' } },
  { id: 'r5', date: '2026-09-05', stageType: 'sorting', quantity: 50, rawData: {} },
];

const ids = (rows: any[]) => rows.map((r) => r.id).sort();

// ==================================================
// D. SHARED COST-CENTRE SCOPE
// ==================================================

test('D1. nothing selected = no narrowing (null, not an empty set)', () => {
  assert.equal(dash.resolveCostCenterProductionScope([], canonicalIndex(), EQUIPMENT), null);
  assert.equal(dash.resolveCostCenterCodeScope([], canonicalIndex()), null);
});

test('D2. a leaf is itself the target', () => {
  assert.deepEqual([...dash.resolveCostCenterProductionScope(['511'], canonicalIndex(), EQUIPMENT)].sort(), ['P1']);
  assert.deepEqual([...dash.resolveCostCenterCodeScope(['511'], canonicalIndex())].sort(), ['511']);
});

test('D3. a parent includes every descendant', () => {
  assert.deepEqual([...dash.resolveCostCenterProductionScope(['5'], canonicalIndex(), EQUIPMENT)].sort(), ['P1', 'P2']);
  assert.deepEqual([...dash.resolveCostCenterCodeScope(['5'], canonicalIndex())].sort(), ['5', '51', '511']);
});

test('D4. multi-select unions branches', () => {
  assert.deepEqual([...dash.resolveCostCenterProductionScope(['511', '6'], canonicalIndex(), EQUIPMENT)].sort(), ['F1', 'P1']);
  assert.deepEqual([...dash.resolveCostCenterCodeScope(['511', '6'], canonicalIndex())].sort(), ['511', '6', '61']);
});

test('D5. parent + its own descendant selected together count once', () => {
  assert.deepEqual([...dash.resolveCostCenterProductionScope(['5', '511'], canonicalIndex(), EQUIPMENT)].sort(), ['P1', 'P2']);
  assert.deepEqual([...dash.resolveCostCenterCodeScope(['5', '51', '511'], canonicalIndex())].sort(), ['5', '51', '511']);
});

test('D6. a node with no linked equipment is an EMPTY scope, not "everything"', () => {
  const scope = dash.resolveCostCenterProductionScope(['9'], canonicalIndex(), EQUIPMENT);
  assert.ok(scope instanceof Set);
  assert.equal(scope.size, 0);
  assert.deepEqual(eng.applyHierarchyScopeToStageRecords(RECORDS, scope), []);
});

test('D7. options are grouped under the existing 5/6/7/8/9 classification', () => {
  const groups = dash.classificationGroups(canonicalIndex(), (n: any) => n.sheet1Code);
  assert.deepEqual(groups.map((g: any) => g.digit), panels.costCenterSubCategories().map((s: any) => s.digit));
  const byDigit = Object.fromEntries(groups.map((g: any) => [g.digit, g.rootIds]));
  assert.deepEqual(byDigit['5'], ['5']);
  assert.deepEqual(byDigit['6'], ['6']);
  assert.deepEqual(byDigit['9'], ['9']);
  assert.deepEqual(byDigit['7'], []);
});

test('D8. the module delegates to the shared resolver and walks no tree itself', () => {
  const src = readCode('src/services/costCenterDashboardPure.ts');
  assert.ok(/resolveHierarchyEquipmentScope\(/.test(src));
  assert.ok(/resolveMultipleHierarchySelections\(/.test(src));
  assert.equal(/childrenByParent|while\s*\(queue|stack\.pop\(\)/.test(src), false);
  assert.equal(/firebase|getDocs|fetchMasterData/.test(src), false, 'pure');
});

test('D9. metric mode: two checkboxes, never an empty state', () => {
  assert.equal(dash.metricModeFromFlags(true, false), 'QUANTITY');
  assert.equal(dash.metricModeFromFlags(false, true), 'FINANCIAL');
  assert.equal(dash.metricModeFromFlags(true, true), 'BOTH');
  assert.equal(dash.metricModeFromFlags(false, false), 'QUANTITY');
  assert.deepEqual(dash.metricFlags('BOTH'), { quantity: true, financial: true });
  assert.deepEqual(dash.metricFlags('FINANCIAL'), { quantity: false, financial: true });
});

test('D10. production-only filters do not apply to money', () => {
  for (const f of ['product', 'customer', 'shift', 'stage', 'employee']) {
    assert.equal(dash.filterAppliesTo(f, 'FINANCIAL'), false, f);
    assert.equal(dash.filterAppliesTo(f, 'QUANTITY'), true, f);
  }
  for (const f of ['date', 'costCenter']) {
    assert.equal(dash.filterAppliesTo(f, 'FINANCIAL'), true, f);
    assert.equal(dash.filterAppliesTo(f, 'QUANTITY'), true, f);
  }
});

// ==================================================
// F. FINANCIAL TRANSACTIONS
// ==================================================

const ACCOUNTS = new Set(['4101', '4102']);
const CENTRES = new Set(NODES.map((n) => n.sheet1Code));

test('F1. amounts: separators and Arabic digits parse; unreadable is null, never 0', () => {
  assert.equal(fin.parseAmount('1,250.50'), 1250.5);
  assert.equal(fin.parseAmount('١٢٣٤'), 1234);
  assert.equal(fin.parseAmount(99), 99);
  assert.equal(fin.parseAmount(''), null);
  assert.equal(fin.parseAmount('abc'), null);
  assert.equal(fin.parseAmount(Infinity), null);
});

test('F2. dates: ISO, slashes and Excel serials; impossible days rejected', () => {
  assert.equal(fin.parseTxDate('2026-09-01'), '2026-09-01');
  assert.equal(fin.parseTxDate('2026/9/1'), '2026-09-01');
  assert.equal(fin.parseTxDate(46266), '2026-09-01');
  assert.equal(fin.parseTxDate('2026-02-30'), null);
  assert.equal(fin.parseTxDate('01/09/2026'), null);
});

test('F3. account and cost centre are checked by EXACT code', () => {
  const ok = fin.validateFinancialRow(2, { date: '2026-09-01', accountCode: '4101', costCenterCode: '511', amount: '100' }, ACCOUNTS, CENTRES);
  assert.equal(ok.valid, true);
  assert.deepEqual(ok.transaction, { date: '2026-09-01', accountCode: '4101', costCenterCode: '511', amount: 100 });

  const badAccount = fin.validateFinancialRow(3, { date: '2026-09-01', accountCode: '04101', costCenterCode: '511', amount: 1 }, ACCOUNTS, CENTRES);
  assert.equal(badAccount.valid, false);
  assert.deepEqual(badAccount.issues.map((i: any) => i.field), ['accountCode']);

  const badCentre = fin.validateFinancialRow(4, { date: '2026-09-01', accountCode: '4101', costCenterCode: 'Press line 1', amount: 1 }, ACCOUNTS, CENTRES);
  assert.deepEqual(badCentre.issues.map((i: any) => i.field), ['costCenterCode'], 'a name is never accepted for a code');
});

test('F4. partial import: valid rows are planned, invalid rows kept with reasons', () => {
  const plan = fin.planFinancialImport([
    { date: '2026-09-01', accountCode: '4101', costCenterCode: '511', amount: 100 },
    { date: 'bad', accountCode: '4101', costCenterCode: '511', amount: 100 },
    { date: '2026-09-02', accountCode: '4102', costCenterCode: '61', amount: '2,000' },
    { date: '2026-09-02', accountCode: 'X', costCenterCode: 'Y', amount: '' },
  ], ACCOUNTS, CENTRES);
  assert.equal(plan.validCount, 2);
  assert.equal(plan.invalidCount, 2);
  assert.deepEqual(plan.toWrite.map((t: any) => t.amount), [100, 2000]);
  assert.deepEqual(plan.rows.map((r: any) => r.rowNumber), [2, 3, 4, 5], 'row numbers match the sheet (header is row 1)');
  assert.equal(plan.rows[3].issues.length, 3);
});

test('F5. Arabic and English headers map to the canonical fields', () => {
  assert.deepEqual(
    fin.mapFinancialRowHeaders({ 'التاريخ': '2026-09-01', 'كود الحساب': '4101', 'مركز التكلفة': '511', 'المبلغ': 5, 'extra': 'x' }),
    { date: '2026-09-01', accountCode: '4101', costCenterCode: '511', amount: 5 },
  );
  assert.deepEqual(
    fin.mapFinancialRowHeaders({ ' Date ': '2026-09-01', 'Account Code': '4101', 'Cost Center Code': '61', 'Amount': 1, 'Reference': 'INV-1' }),
    { date: '2026-09-01', accountCode: '4101', costCenterCode: '61', amount: 1, reference: 'INV-1' },
  );
});

const TX = [
  { id: 't1', date: '2026-09-01', accountCode: '4101', costCenterCode: '511', amount: 100 },
  { id: 't2', date: '2026-09-10', accountCode: '4102', costCenterCode: '51', amount: 250.25 },
  { id: 't3', date: '2026-09-15', accountCode: '4101', costCenterCode: '61', amount: 1000 },
  { id: 't4', date: '2026-10-01', accountCode: '4101', costCenterCode: '511', amount: 7 },
  { id: 't1', date: '2026-09-01', accountCode: '4101', costCenterCode: '511', amount: 100 },
];

test('F6. aggregation: cost-centre scope with descendants, inclusive dates, each document once', () => {
  const codes = dash.resolveCostCenterCodeScope(['5'], canonicalIndex());
  assert.deepEqual(fin.aggregateFinancialValue(TX, { costCenterCodes: codes, startDate: '2026-09-01', endDate: '2026-09-30' }), { total: 350.25, count: 2 });
  assert.deepEqual(fin.aggregateFinancialValue(TX, { costCenterCodes: null, startDate: '2026-09-01', endDate: '2026-09-15' }), { total: 1350.25, count: 3 });
  assert.deepEqual(fin.aggregateFinancialValue(TX, { costCenterCodes: dash.resolveCostCenterCodeScope(['9'], canonicalIndex()) }), { total: 0, count: 0 });
});

test('F7. money is never added to quantity - the aggregate reads amounts only', () => {
  const src = readCode('src/services/financialTransactionsPure.ts');
  assert.equal(/quantity|tonnage|weight/i.test(src), false, 'no production field is read');
  // The aggregation moved into the shared metric controls both dashboards use.
  const shared = readCode('src/components/dashboard/DashboardMetricControls.tsx');
  const call = /aggregateFinancialValue\(transactions, \{([\s\S]*?)\}\)/.exec(shared);
  assert.ok(call, 'the dashboards aggregate from actual transactions');
  assert.equal(/productId|customerId|shiftId|stageType|employeeId/.test(call![1]), false, 'no production-only filter reaches money');
  for (const rel of ['src/components/dashboard/DashboardView.tsx', 'src/components/dashboard/DashboardBuilderView.tsx']) {
    const view = readCode(rel);
    assert.equal(/financialValue\.total\s*[+*/-]|[+*/-]\s*financialValue\.total/.test(view), false, `${rel}: the financial total is never combined arithmetically`);
    const hook = /useFinancialValue\(show\w*, \{([\s\S]*?)\}\)/.exec(view);
    assert.ok(hook, `${rel} uses the shared financial hook`);
    assert.equal(/productId|customerId|shiftId|stageType|employeeId/.test(hook![1]), false, `${rel}: only date and cost-centre scope reach money`);
  }
});

// ==================================================
// C. DASHBOARD == REPORTS FOR THE SAME SCOPE
// ==================================================

for (const selection of [['5'], ['511'], ['6'], ['5', '6'], ['9']]) {
  test(`C1. selection [${selection.join(',')}] keeps the same records in Dashboard and Reports`, () => {
    const dashboardScope = dash.resolveCostCenterProductionScope(selection, canonicalIndex(), EQUIPMENT);
    const reportsScope = eng.resolveHierarchyEquipmentScope(
      selection.map((id) => eng.asNodeSelection(id)),
      { index: reportsIndex() },
      { equipment: EQUIPMENT },
    );
    const d = eng.applyHierarchyScopeToStageRecords(RECORDS, dashboardScope);
    const r = eng.applyHierarchyScopeToStageRecords(RECORDS, reportsScope);
    assert.deepEqual(ids(d), ids(r));
    const sum = (rows: any[]) => rows.reduce((s, x) => s + x.quantity, 0);
    assert.equal(sum(d), sum(r));
  });
}

test('C2. a record reachable through both press and furnace is counted once', () => {
  const both = [{ id: 'rx', date: '2026-09-01', quantity: 5, rawData: { pressId: 'P1', furnaceId: 'F1' } }];
  const scope = dash.resolveCostCenterProductionScope(['5', '6'], canonicalIndex(), EQUIPMENT);
  assert.equal(eng.applyHierarchyScopeToStageRecords(both, scope).length, 1);
});

test('C3. the concrete selections produce the expected records', () => {
  const pick = (sel: string[]) => ids(eng.applyHierarchyScopeToStageRecords(RECORDS, dash.resolveCostCenterProductionScope(sel, canonicalIndex(), EQUIPMENT)));
  assert.deepEqual(pick(['5']), ['r1', 'r2']);
  assert.deepEqual(pick(['6']), ['r3']);
  assert.deepEqual(pick([]), ['r1', 'r2', 'r3', 'r4', 'r5']);
});

test('C4. both Dashboards and Reports pass the scope into the SAME shared record filter', () => {
  assert.ok(/filterUniversalRecords\(allRecords, filters, productionScope\)/.test(readCode('src/components/dashboard/DashboardView.tsx')));
  assert.ok(/\}, hierarchyScope\);/.test(readCode('src/components/dashboard/WidgetRenderer.tsx')));
  assert.ok(/filterUniversalRecords\(records, filters, hierarchyScope\)/.test(readCode('src/components/reports/ReportsView.tsx')));
  assert.ok(/\}, hierarchyScope\);/.test(readCode('src/services/exportService.ts')), 'the Builder Excel export matches the screen');
});

// ==================================================
// W. WIRING
// ==================================================

const DV = 'src/components/dashboard/DashboardView.tsx';
const BV = 'src/components/dashboard/DashboardBuilderView.tsx';
const LCB = 'src/components/dashboard/LiveControlBar.tsx';
const SEL = 'src/components/dashboard/CostCenterScopeSelector.tsx';

test('W1. ONE selector component, used by both Dashboards', () => {
  assert.ok(/<CostCenterScopeSelector/.test(readCode(DV)), 'classic Dashboard');
  assert.ok(/<CostCenterScopeSelector/.test(readCode(LCB)), 'Builder control bar');
  const selectors = fs.readdirSync(path.join(ROOT, 'src/components/dashboard')).filter((f) => /CostCenter.*Selector/.test(f));
  assert.deepEqual(selectors, ['CostCenterScopeSelector.tsx']);
});

test('W2. the legacy press/furnace dropdowns are gone from both Dashboards', () => {
  assert.equal(/id="dashboard-equipment-filter"/.test(readCode(DV)), false);
  assert.equal(/equipmentCategoriesForStage/.test(readCode(DV)), false);
  assert.equal(/presses\.map\(\(p\) => <option/.test(readCode(LCB)), false);
});

test('W3. the selector renders checkboxes, grouped by classification, with children from the resolver', () => {
  const src = readCode(SEL);
  assert.ok(/type="checkbox"/.test(src));
  assert.ok(/classificationGroups\(index, codeOf\)/.test(src));
  assert.ok(/getChildIds\(index, id\)/.test(src));
  assert.equal(/childrenByParent|fetchMasterData|getDocs/.test(src), false);
});

test('W4. the Builder resolves the scope once and hands it to every widget, the print view and the export', () => {
  const src = readCode(BV);
  assert.ok(/resolveCostCenterProductionScope\(\s*globalFilters\.costCenterNodeIds \?\? \[\]/.test(src));
  assert.ok(/buildCostCenterHierarchyIndex\(hierarchyNodes\)/.test(src));
  assert.ok((src.match(/hierarchyScope=\{hierarchyScope\}/g) || []).length >= 2, 'widgets and print view');
  assert.ok(/\.xlsx`, hierarchyScope\)/.test(src), 'Excel export');
  assert.ok(/costCenterNodeIds\?: string\[\];/.test(readCode('src/services/dashboardRegistry.ts')), 'the shared filter model carries it');
});

test('W5. the Dashboard metric type and financial card exist, and money is read only when shown', () => {
  const src = readCode(DV);
  const shared = readCode('src/components/dashboard/DashboardMetricControls.tsx');
  assert.ok(/id = 'dashboard-metric-mode'/.test(shared) && /<MetricModeToggle mode=\{metricMode\}/.test(src));
  assert.ok(/id = 'dashboard-financial-value'/.test(shared));
  assert.ok(/if \(!enabled\) return;\s*setError\(null\);\s*listFinancialTransactions\(\)/.test(shared), 'money is read only while shown');
  assert.ok(/useFinancialValue\(showFinancial,/.test(src));
  assert.ok((src.match(/\{showQuantity && \(/g) || []).length >= 2, 'quantity sections hide in financial-only mode');
  assert.ok(/\{showFinancial && <FinancialValueCard value=\{financialValue\}/.test(src), 'the financial card is its own section');
});

test('W6. the financial import is dedicated and never routes through Historical Import', () => {
  const modal = readCode('src/components/masterData/FinancialTransactionsImportModal.tsx');
  assert.ok(/id="financial-transactions-import-modal"/.test(modal));
  assert.ok(/planFinancialImport\(/.test(modal) && /importFinancialTransactions\(/.test(modal));
  assert.equal(/onNavigate|historical-import|bulk-entry|DataImportView|executeBatchImport/.test(modal), false);
  const view = readCode('src/components/masterData/MasterDataView.tsx');
  assert.ok(/id="master-data-import-financial-transactions-btn"/.test(view));
  assert.ok(/<FinancialTransactionsImportModal/.test(view));
  assert.ok(/<FinancialAccountsImportModal/.test(view), 'the accounts importer is untouched');
});

test('W7. writes go through the audited shared path; the rule exists and grants no new privilege', () => {
  const svc = readCode('src/services/financialTransactionService.ts');
  assert.ok(/createMasterDataItem\(FINANCIAL_TRANSACTIONS_COLLECTION/.test(svc));
  assert.equal(/writeBatch|setDoc|addDoc|deleteDoc/.test(svc), false);
  const rules = readSource('firestore.rules');
  const block = /match \/financialTransactions\/\{txId\} \{([\s\S]*?)\}/.exec(rules);
  assert.ok(block, 'rule block present');
  assert.ok(/allow read: if isSignedIn\(\);/.test(block![1]));
  assert.ok(/allow write: if isAdmin\(\);/.test(block![1]));
});

test('W8. the reconciliation utility is kept (unresolved conflicts remain)', () => {
  const view = readCode('src/components/masterData/MasterDataView.tsx');
  assert.ok(/id="master-data-reconcile-btn"/.test(view));
});

test('W9. Master Data still has exactly the 7 categories', () => {
  assert.equal(panels.PANEL_CATEGORY_IDS.length, 7);
  assert.equal(panels.PANEL_CATEGORY_IDS.includes('financialTransactions'), false, 'transactions are not an eighth category');
});

// ==================================================
// S. SELECTOR SEARCH + RECURSIVE CHECKBOX SELECTION
// ==================================================

/*
 *   5  الأقسام الإنتاجية
 *   └─ 513  المكابس  (Presses)
 *      ├─ 5131  مكابس بوخر  (Bokher presses)
 *      │   ├─ 51311  بوخر 1
 *      │   ├─ 51312  بوخر 2
 *      │   └─ 51313  بوخر 3
 *      └─ 5132  مكابس لايس
 *          ├─ 51321  لايس 1600
 *          └─ 51322  لايس 2000
 *   └─ 514  الأفران  └─ 5141  فرن 1
 *   6  الأقسام الخدمية
 *   └─ 61  الورشة
 */
const S_NODES = [
  { sheet1Code: '5', parentSheet1Code: null, name: 'الأقسام الإنتاجية' },
  { sheet1Code: '513', parentSheet1Code: '5', name: 'المكابس', nameEn: 'Presses' },
  { sheet1Code: '5131', parentSheet1Code: '513', name: 'مكابس بوخر', nameEn: 'Bokher Presses' },
  { sheet1Code: '51311', parentSheet1Code: '5131', name: 'بوخر 1' },
  { sheet1Code: '51312', parentSheet1Code: '5131', name: 'بوخر 2' },
  { sheet1Code: '51313', parentSheet1Code: '5131', name: 'بوخر 3' },
  { sheet1Code: '5132', parentSheet1Code: '513', name: 'مكابس لايس' },
  { sheet1Code: '51321', parentSheet1Code: '5132', name: 'لايس 1600' },
  { sheet1Code: '51322', parentSheet1Code: '5132', name: 'لايس 2000' },
  { sheet1Code: '514', parentSheet1Code: '5', name: 'الأفران' },
  { sheet1Code: '5141', parentSheet1Code: '514', name: 'فرن 1' },
  { sheet1Code: '6', parentSheet1Code: null, name: 'الأقسام الخدمية' },
  { sheet1Code: '61', parentSheet1Code: '6', name: 'الورشة' },
];
const S_EQUIPMENT = [
  { id: 'B1', hierarchyNodeId: '51311' },
  { id: 'B2', hierarchyNodeId: '51312' },
  { id: 'B3', hierarchyNodeId: '51313' },
  { id: 'L1600', hierarchyNodeId: '51321' },
  { id: 'L2000', hierarchyNodeId: '51322' },
  { id: 'W1', hierarchyNodeId: '61' },
];
function sIndex() {
  return hier.buildHierarchyIndex(
    S_NODES.map((n) => ({ ...n, id: n.sheet1Code, code: n.sheet1Code, parentId: n.parentSheet1Code ?? null })),
  );
}
const sorted = (xs: Iterable<string>) => [...xs].sort();
const BOKHER_BRANCH = ['5131', '51311', '51312', '51313'];
const PRESSES_BRANCH = ['513', '5131', '51311', '51312', '51313', '5132', '51321', '51322'];

test('S1. search by exact code finds the node', () => {
  const r = dash.searchCostCenterNodes(sIndex(), '5131');
  assert.ok(r.matchedIds.has('5131'));
  assert.equal(r.matchedIds.has('5132'), false);
});

test('S2. search by partial code finds every node containing it', () => {
  assert.deepEqual(sorted(dash.searchCostCenterNodes(sIndex(), '513').matchedIds), PRESSES_BRANCH.slice().sort());
  assert.deepEqual(sorted(dash.searchCostCenterNodes(sIndex(), '5132').matchedIds), ['5132', '51321', '51322']);
});

test('S3. search by Arabic name - including spelling variants and extra spaces', () => {
  assert.deepEqual(sorted(dash.searchCostCenterNodes(sIndex(), 'مكابس').matchedIds), ['513', '5131', '5132']);
  assert.deepEqual(sorted(dash.searchCostCenterNodes(sIndex(), 'بوخر').matchedIds), ['5131', '51311', '51312', '51313']);
  assert.deepEqual(sorted(dash.searchCostCenterNodes(sIndex(), '  بوخر   1 ').matchedIds), ['51311']);
  assert.deepEqual(sorted(dash.searchCostCenterNodes(sIndex(), 'بوخر1').matchedIds), ['51311'], 'missing space tolerated');
  assert.deepEqual(sorted(dash.searchCostCenterNodes(sIndex(), 'الاقسام الانتاجيه').matchedIds), ['5'], 'alef / ta marbuta variants');
});

test('S4. search by English name, case-insensitive', () => {
  assert.deepEqual(sorted(dash.searchCostCenterNodes(sIndex(), 'PRESSES').matchedIds), ['513', '5131']);
  assert.deepEqual(sorted(dash.searchCostCenterNodes(sIndex(), 'bokher').matchedIds), ['5131']);
});

test('S5. a child match shows its full path; a parent match shows its branch', () => {
  const child = dash.searchCostCenterNodes(sIndex(), 'بوخر 1');
  assert.deepEqual(sorted(child.visibleIds), ['5', '513', '5131', '51311'], 'path context, nothing unrelated');
  const parent = dash.searchCostCenterNodes(sIndex(), 'المكابس');
  assert.deepEqual(sorted(parent.visibleIds), ['5', ...PRESSES_BRANCH].sort(), 'the matched parent shows its scope');
  assert.equal(dash.searchCostCenterNodes(sIndex(), '   ').visibleIds, null, 'blank search shows everything');
  assert.equal(dash.searchCostCenterNodes(sIndex(), 'zzz').matchedIds.size, 0);
});

test('S6. checking a parent selects it and ALL descendants', () => {
  assert.deepEqual(sorted(dash.toggleCostCenterNode(sIndex(), [], '513')), PRESSES_BRANCH.slice().sort());
  const scope = dash.resolveCostCenterProductionScope(dash.toggleCostCenterNode(sIndex(), [], '513'), sIndex(), S_EQUIPMENT);
  assert.deepEqual(sorted(scope), ['B1', 'B2', 'B3', 'L1600', 'L2000']);
});

test('S7. checking a middle node selects it and its descendants only', () => {
  const sel = dash.toggleCostCenterNode(sIndex(), [], '5131');
  assert.deepEqual(sorted(sel), BOKHER_BRANCH);
  assert.deepEqual(sorted(dash.resolveCostCenterProductionScope(sel, sIndex(), S_EQUIPMENT)), ['B1', 'B2', 'B3']);
});

test('S8. checking a leaf selects the leaf itself, and it IS the equipment scope', () => {
  const sel = dash.toggleCostCenterNode(sIndex(), [], '51311');
  assert.deepEqual(sel, ['51311']);
  assert.deepEqual(sorted(dash.resolveCostCenterProductionScope(sel, sIndex(), S_EQUIPMENT)), ['B1']);
  assert.equal(dash.costCenterCheckState(sIndex(), new Set(sel), '51311'), 'checked');
});

test('S9. unchecking a parent removes its branch and nothing from other branches', () => {
  let sel = dash.toggleCostCenterNode(sIndex(), [], '513');
  sel = dash.toggleCostCenterNode(sIndex(), sel, '61');
  sel = dash.toggleCostCenterNode(sIndex(), sel, '513');
  assert.deepEqual(sorted(sel), ['6', '61'].filter((id) => sel.includes(id)).sort());
  assert.ok(sel.includes('61'), 'the other branch survives');
  assert.equal(PRESSES_BRANCH.some((id) => sel.includes(id)), false);
  // Unchecking one child of a checked parent un-ticks only that child and its ancestors.
  let partial = dash.toggleCostCenterNode(sIndex(), [], '5131');
  partial = dash.toggleCostCenterNode(sIndex(), partial, '51313');
  assert.deepEqual(sorted(partial), ['51311', '51312']);
});

test('S10. a partly selected branch shows its parents as indeterminate', () => {
  const eff = dash.effectiveCostCenterSelection(sIndex(), ['51311', '51312']);
  assert.equal(dash.costCenterCheckState(sIndex(), eff, '5131'), 'indeterminate');
  assert.equal(dash.costCenterCheckState(sIndex(), eff, '513'), 'indeterminate');
  assert.equal(dash.costCenterCheckState(sIndex(), eff, '5'), 'indeterminate');
  assert.equal(dash.costCenterCheckState(sIndex(), eff, '5132'), 'unchecked');
  assert.equal(dash.costCenterCheckState(sIndex(), eff, '51313'), 'unchecked');
});

test('S11. selecting every child individually checks the parent (and upward while complete)', () => {
  let sel: string[] = [];
  for (const leaf of ['51311', '51312', '51313']) sel = dash.toggleCostCenterNode(sIndex(), sel, leaf);
  assert.ok(sel.includes('5131'), 'parent auto-selected');
  assert.equal(sel.includes('513'), false, '513 is not complete - لايس is unticked');
  assert.equal(dash.costCenterCheckState(sIndex(), new Set(sel), '5131'), 'checked');
  sel = dash.toggleCostCenterNode(sIndex(), sel, '5132');
  assert.ok(sel.includes('513'), 'completing the last press branch completes المكابس');
  assert.equal(sel.includes('5'), false, 'but not 5 - الأفران is still unticked');
  sel = dash.toggleCostCenterNode(sIndex(), sel, '5141');
  assert.ok(sel.includes('514') && sel.includes('5'), 'completion propagates upward only while every child is complete');
});

test('S12. searching after selecting does not change the selection', () => {
  const sel = dash.toggleCostCenterNode(sIndex(), [], '513');
  const before = sorted(sel);
  dash.searchCostCenterNodes(sIndex(), 'بوخر 1');
  assert.deepEqual(sorted(sel), before, 'search is a pure function of index + query');
  const src = readCode(SEL);
  assert.equal(/setQuery\([^)]*\)[\s\S]{0,40}onChange\(/.test(src), false);
  assert.equal(/onChange\(\[\]\)[\s\S]{0,80}setQuery/.test(src), false, 'Clear (selection) and Clear search are separate');
});

test('S13. clearing the search restores the full tree and keeps the selection', () => {
  assert.equal(dash.searchCostCenterNodes(sIndex(), '').visibleIds, null);
  const src = readCode(SEL);
  assert.ok(/id="cost-center-scope-search-clear"[\s\S]{0,80}onClick=\{\(\) => setQuery\(''\)\}/.test(src), 'clear search only resets the query');
});

test('S14. checking a parent while searching selects the FULL branch, not the visible subset', () => {
  const idx = sIndex();
  const search = dash.searchCostCenterNodes(idx, 'بوخر 1');
  assert.ok(search.visibleIds.has('513') && !search.visibleIds.has('5132'), 'only the path is visible');
  const sel = dash.toggleCostCenterNode(idx, [], '513');
  assert.deepEqual(sorted(sel), PRESSES_BRANCH.slice().sort(), 'hidden لايس nodes are still selected');
  const src = readCode(SEL);
  assert.ok(/toggleCostCenterNode\(index, selectedNodeIds, id\)/.test(src), 'the component toggles against the full index');
});

test('S15. parent + child selected together: no duplicate ids or equipment', () => {
  let sel = dash.toggleCostCenterNode(sIndex(), [], '51311');
  sel = dash.toggleCostCenterNode(sIndex(), sel, '513');
  assert.equal(new Set(sel).size, sel.length);
  const all = dash.selectAllCostCenterNodes(sIndex(), sel, ['5', '6', '513']);
  assert.equal(new Set(all).size, all.length);
  const scope = dash.resolveCostCenterProductionScope(all, sIndex(), S_EQUIPMENT);
  assert.deepEqual(sorted(scope), ['B1', 'B2', 'B3', 'L1600', 'L2000', 'W1']);
});

test('S16. Select All adds every target branch without dropping existing selections', () => {
  const idx = sIndex();
  const withRoots = dash.selectAllCostCenterNodes(idx, [], idx.rootIds);
  assert.equal(withRoots.length, S_NODES.length);
  const matched = [...dash.searchCostCenterNodes(idx, 'لايس').matchedIds];
  const sel = dash.selectAllCostCenterNodes(idx, ['61'], matched);
  assert.deepEqual(sorted(sel), ['5132', '51321', '51322', '61']);
});

test('S17. the production filter reads a materialised selection exactly like a parent-only one', () => {
  const idx = sIndex();
  for (const parent of ['5', '513', '5131', '51311']) {
    const materialised = dash.toggleCostCenterNode(idx, [], parent);
    assert.deepEqual(
      sorted(dash.resolveCostCenterProductionScope(materialised, idx, S_EQUIPMENT)),
      sorted(dash.resolveCostCenterProductionScope([parent], idx, S_EQUIPMENT)),
    );
    assert.deepEqual(sorted(dash.resolveCostCenterCodeScope(materialised, idx)), sorted(dash.resolveCostCenterCodeScope([parent], idx)));
  }
  // A selection stored as just a parent still shows every descendant ticked.
  const eff = dash.effectiveCostCenterSelection(idx, ['513']);
  assert.equal(dash.costCenterCheckState(idx, eff, '51322'), 'checked');
});

test('S18. the selector renders search, tri-state checkboxes and Select All', () => {
  const src = readCode(SEL);
  assert.ok(/id="cost-center-scope-search"/.test(src));
  assert.ok(/id="cost-center-scope-select-all"/.test(src));
  assert.ok(/el\.indeterminate = state === 'indeterminate'/.test(src));
  assert.ok(/checked=\{state === 'checked'\}/.test(src));
  assert.ok(/getChildIds\(index, id\)\.filter\(isVisible\)/.test(src), 'children come from the resolver, filtered for display only');
  assert.equal(/key=\{i\}|key=\{index\}|\.indexOf\(/.test(src), false, 'no position-based identity');
});

test('S19. performance: no reads, writes or tree walks of its own while typing or ticking', () => {
  const src = readCode(SEL);
  assert.equal(/fetchMasterData|getDocs|onSnapshot|firebase|listCostCenter|await /.test(src), false, 'the selector issues no reads');
  assert.equal(/setDoc|addDoc|updateDoc|writeBatch|createMasterDataItem|updateMasterDataItem/.test(src), false, 'and no writes');
  const pure = readCode('src/services/costCenterDashboardPure.ts');
  assert.equal(/firebase|getDocs|fetchMasterData/.test(pure), false);
  assert.equal(/childrenByParent|while\s*\(queue|frontier/.test(pure), false, 'descendants only through the shared resolver');
  assert.ok(/resolveHierarchySelection\(index, nodeId, \{ includeSelf: true \}\)/.test(pure));
  assert.ok(/getAncestorIds\(index, id\)/.test(pure));
  assert.ok(/normaliseLookupText/.test(pure), 'the existing Arabic normaliser, not a new one');
});

test('S20. Reports, AI and Production Records selectors were not touched', () => {
  for (const rel of ['src/components/reports/ReportsView.tsx', 'src/assistant/tools/stageReportTools.ts', 'src/components/production/ProductionRecordsView.tsx']) {
    assert.equal(/toggleCostCenterNode|searchCostCenterNodes|CostCenterScopeSelector/.test(readCode(rel)), false, rel);
  }
});

// ==================================================
// P. CUSTOM DASHBOARD VISUAL PARITY
// ==================================================

const LCBP = 'src/components/dashboard/LiveControlBar.tsx';
const BVP = 'src/components/dashboard/DashboardBuilderView.tsx';
const STYLES = 'src/components/dashboard/dashboardFilterStyles.ts';

test('P1. both dashboards render inside the same page container (no nested width cap)', () => {
  const dv = readCode(DV);
  assert.ok(/viewMode === 'custom' \? \(\s*<DashboardBuilderView/.test(dv), 'the Custom Dashboard is rendered in the classic Dashboard page itself');
  for (const rel of [BVP, LCBP]) {
    assert.equal(/max-w-(?:sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl|\[\d)/.test(readCode(rel).replace(/maxWidth="[^"]*"/g, '')), false, `${rel} caps its own width`);
  }
  assert.ok(/id="custom-dashboard-page" className="space-y-6"/.test(readCode(BVP)), 'same vertical rhythm as the classic Dashboard');
});

test('P2. no horizontal scroll strip in the filter panel', () => {
  const src = readCode(LCBP);
  assert.equal(/overflow-x-auto/.test(src), false, 'the overflow strip that clipped the dropdown is gone');
  assert.equal(/shrink-0" title=\{t\./.test(src), false, 'no non-shrinking filter controls');
});

test('P3. the filter panel is a responsive grid using the classic Dashboard panel style', () => {
  const src = readCode(LCBP);
  assert.ok(/id="custom-dashboard-filter-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2"/.test(src));
  assert.ok(/className=\{DASHBOARD_FILTER_PANEL\}/.test(src));
  const dv = readCode(DV);
  for (const token of ['DASHBOARD_FILTER_PANEL', 'DASHBOARD_FILTER_SELECT', 'DASHBOARD_PRESET_GROUP', 'dashboardPresetButton', 'DASHBOARD_PANEL_BUTTON']) {
    assert.ok(new RegExp(token).test(dv) && new RegExp(token).test(src), `${token} shared by both dashboards`);
  }
  const styles = readCode(STYLES);
  assert.ok(/'bg-slate-900 border border-slate-800 p-3 flex flex-col gap-3'/.test(styles), 'the classic panel classes, unchanged');
  assert.ok(/'bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1\.5 text-xs font-bold'/.test(styles));
});

test('P4. the cost-centre selector opens wide enough and is not clipped', () => {
  const sel = readCode(SEL);
  assert.ok(/w-\[24rem\] min-w-full max-w-\[90vw\]/.test(sel), 'wide panel, never wider than the screen');
  assert.ok(/start-0/.test(sel), 'anchored to the start edge in both RTL and LTR');
  const lcb = readCode(LCBP);
  assert.ok(/<CostCenterScopeSelector[\s\S]{0,300}tone="dark"\s*block/.test(lcb), 'fills its grid cell in the dark panel style');
});

test('P5. the Custom Dashboard uses the SAME selector and scope as the classic Dashboard', () => {
  const lcb = readCode(LCBP);
  assert.ok(/import \{ CostCenterScopeSelector \} from '\.\/CostCenterScopeSelector'/.test(lcb));
  assert.equal(/presses\.map\(\(p\) => <option/.test(lcb), false, 'no legacy press dropdown');
  const bv = readCode(BVP);
  assert.ok(/resolveCostCenterProductionScope\(\s*globalFilters\.costCenterNodeIds \?\? \[\]/.test(bv));
  assert.ok(/resolveCostCenterCodeScope\(globalFilters\.costCenterNodeIds \?\? \[\], hierarchyIndex\)/.test(bv));
});

test('P6. quantity, financial and both remain separate in the Custom Dashboard', () => {
  const lcb = readCode(LCBP);
  assert.ok(/<MetricModeToggle[\s\S]{0,120}mode=\{globalFilters\.metricMode \?\? 'QUANTITY'\}[\s\S]{0,120}onChangeFilters\(\{ metricMode \}\)/.test(lcb));
  const bv = readCode(BVP);
  assert.ok(/metricFlags\(globalFilters\.metricMode \?\? 'QUANTITY'\)/.test(bv));
  assert.ok(/\{showFinancial && <FinancialValueCard id="custom-dashboard-financial-value"/.test(bv), 'money in its own card');
  assert.ok(/\{!showQuantity \? null : isLoading/.test(bv), 'quantity widgets hide only when quantities are unticked');
  assert.ok(/metricMode\?: DashboardMetricMode;/.test(readCode('src/services/dashboardRegistry.ts')), 'one shared filter model, optional field');
});

test('P7. every Custom Dashboard capability is still wired', () => {
  const bv = readCode(BVP);
  const wired: Array<[string, RegExp]> = [
    ['add widget', /setWidgetFormState\(\{ sectionId: section\.sectionId \}\)/],
    ['edit widget', /onEdit=\{\(\) => setWidgetFormState\(\{ sectionId: section\.sectionId, widget \}\)\}/],
    ['delete widget', /onRemove=\{\(\) => handleRemoveWidget\(/],
    ['duplicate widget', /onDuplicate=\{\(\) => handleDuplicateWidget\(/],
    ['drag reorder', /onDragStart=\{\(\) => handleDragStart\(/],
    ['grid move', /handleMoveWidgetGrid\(section\.sectionId, widget\.widgetId, 'left'\)/],
    ['move to section', /setMoveToSectionState\(\{ sectionId: section\.sectionId, widgetId: widget\.widgetId \}\)/],
    ['resize', /handleSetWidgetSize\(section\.sectionId, widget\.widgetId/],
    ['section columns', /handleSetSectionColumns\(/],
    ['add section', /onClick=\{handleAddSection\}/],
    ['save', /onClick=\{handleSave\}/],
    ['my dashboards / load', /setShowDashboardList\(true\)/],
    ['new dashboard', /onClick=\{handleCreateDashboard\}/],
    ['templates', /setShowTemplatePicker\(true\)/],
    ['AI designer', /setShowAiDesigner\(true\)/],
    ['export', /onClick=\{handleExportExcel\}/],
    ['print', /setShowPrintView\(true\)/],
    ['rename', /onClick=\{handleRename\}/],
    ['duplicate dashboard', /onClick=\{handleDuplicate\}/],
    ['set default', /onClick=\{handleSetDefault\}/],
    ['delete dashboard', /onClick=\{handleDelete\}/],
    ['favorite', /onToggleFavorite=/],
    ['permission gate', /const canManage = isSuperAdmin \|\| hasPermission\('dashboard\.manageCustomDashboards'\)/],
    ['no-access screen', /if \(!canManage\) \{/],
  ];
  for (const [name, re] of wired) assert.ok(re.test(bv), `${name} still wired`);
});

test('P8. the open dashboard is the page title, not a narrow strip repeated in the filter bar', () => {
  const bv = readCode(BVP);
  assert.ok(/id="custom-dashboard-header"/.test(bv));
  assert.ok(/<h1 className="text-lg font-black text-slate-800 truncate">\{draft \? draft\.name : t\.title\}<\/h1>/.test(bv));
  assert.equal(/<span className="text-sm font-bold text-slate-800 truncate">\{draft\.name\}<\/span>/.test(bv), false, 'the separate identity strip is gone');
  assert.equal(/\{dashboardName\}/.test(readCode(LCBP)), false, 'the filter panel no longer repeats the name');
});

test('P9. widgets use the configured size in a responsive grid, with no fixed widths', () => {
  const bv = readCode(BVP);
  assert.ok(/gridColumn: `span \$\{widgetSpanForSize\(widget\.size, section\.columns\)\}`/.test(bv), 'configured size respected');
  assert.ok(/grid \$\{columnsClass\[section\.columns\]\} gap-4/.test(bv));
  assert.ok(/4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'/.test(bv), 'columns adapt to the screen');
  for (const rel of [BVP, LCBP, 'src/components/dashboard/WidgetRenderer.tsx']) {
    assert.equal(/\bw-\[\d+px\]|min-w-\[\d{3,}px\]/.test(readCode(rel)), false, `${rel} has no fixed pixel width`);
  }
});

test('P10. RTL and LTR both follow the language', () => {
  const bv = readCode(BVP);
  assert.ok(/id="custom-dashboard-page" className="space-y-6" dir=\{isRtl \? 'rtl' : 'ltr'\}/.test(bv));
  const lcb = readCode(LCBP);
  assert.equal(/\b(?:ml|mr|pl|pr|left|right)-\d/.test(lcb), false, 'logical spacing only (ms/me/ps/pe/start/end)');
});

test('P11. no new reads or subscriptions were introduced for the layout', () => {
  for (const rel of [LCBP, STYLES, SEL]) {
    assert.equal(/fetchMasterData|getDocs|onSnapshot|subscribe/.test(readCode(rel)), false, rel);
  }
  const shared = readCode('src/components/dashboard/DashboardMetricControls.tsx');
  assert.equal((shared.match(/listFinancialTransactions\(\)/g) || []).length, 1, 'one gated financial read, shared');
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

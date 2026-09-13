/**
 * DASHBOARD COST-CENTRE UNIFICATION + FINANCIAL VALUES
 *
 * D  the shared cost-centre scope (both Dashboards, one definition)
 * F  financial transactions: parsing, exact-code validation, partial import,
 *    aggregation - and that money is never mixed with quantity
 * C  consistency: a Dashboard selection and the same Reports selection keep
 *    exactly the same production records
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
  const view = readCode('src/components/dashboard/DashboardView.tsx');
  assert.equal(/financialTotal\.total\s*[+*/-]|[+*/-]\s*financialTotal\.total/.test(view), false, 'the financial total is never combined arithmetically');
  const call = /aggregateFinancialValue\(financialTransactions, \{([\s\S]*?)\}\)/.exec(view);
  assert.ok(call, 'the Dashboard aggregates from actual transactions');
  assert.equal(/productId|customerId|shiftId|stageType|employeeId/.test(call![1]), false, 'no production-only filter reaches money');
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
  assert.ok(/id="dashboard-metric-mode"/.test(src));
  assert.ok(/id="dashboard-financial-value"/.test(src));
  assert.ok(/if \(!showFinancial\) return;\s*setFinancialError\(null\);\s*listFinancialTransactions\(\)/.test(src));
  assert.ok((src.match(/\{showQuantity && \(/g) || []).length >= 2, 'quantity sections hide in financial-only mode');
  assert.ok(/\{showFinancial && \(\s*<div id="dashboard-financial-value"/.test(src), 'the financial card is its own section');
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

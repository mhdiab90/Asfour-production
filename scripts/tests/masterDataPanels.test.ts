/**
 * MASTER DATA THREE-PANEL ORGANISATION
 *
 * Area 1 picks categories, Area 2 shows exactly those, Area 3 shows the active
 * one's data. Plus the cost-centre 5/6/7/8/9 sub-classification.
 *
 * THE POINT OF THE COST-CENTRE GROUP: the rule is NOT invented here. It is the
 * existing one from the Sheet1 import (ROOT_CATEGORY_CODES / ROOT_CATEGORY_LABELS,
 * root = the code's first character), and group C asserts the module re-exports
 * that definition rather than carrying a copy that could drift.
 *
 * The selection module is pure and runs as shipped; the screen imports Firebase,
 * so its wiring is asserted by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/masterDataPanels.test.ts
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

console.log('masterDataPanels.test.ts');

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

let panels: any;
let cch: any;
let reg: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  panels = await load('src/services/masterDataPanelsPure.ts');
  cch = await load('src/services/costCenterHierarchyPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
}

const VIEW = 'src/components/masterData/MasterDataView.tsx';
const EMPTY = () => panels.EMPTY_PANEL_SELECTION;

/** Tick several categories in order. */
function pick(...ids: string[]) {
  let state = EMPTY();
  for (const id of ids) state = panels.toggleCategory(state, id);
  return state;
}

// ==================================================
// A. AREA 1 / AREA 2 (§27 TEST 1-8)
// ==================================================

test('A1. TEST 1 - the seven top-level categories all come from the registry', () => {
  const ids = [...panels.PANEL_CATEGORY_IDS];
  assert.deepEqual(ids.sort(), ['costCenters', 'customers', 'employees', 'financialAccounts', 'materials', 'products', 'shifts']);
  // Every one resolves to a real registry entry with a label and a tab.
  for (const category of panels.panelCategories()) {
    assert.ok(category.labelAr && category.labelEn, `${category.id} must carry both labels`);
    assert.ok(category.tab, `${category.id} must map to an existing tab`);
    assert.ok(reg.getCategory(category.id), `${category.id} must exist in the shared registry`);
  }
  assert.equal(panels.panelCategories().length, 7);
});

test('A2. TEST 2 - selecting one category shows it in Area 2 and makes it active', () => {
  const state = pick('products');
  assert.deepEqual(state.selectedCategoryIds, ['products']);
  assert.equal(state.activeCategoryId, 'products', 'the first selection becomes active');
  assert.equal(panels.isEmptyState(state), false);
});

test('A3. TEST 3 - selecting two shows both, and the first stays active', () => {
  const state = pick('products', 'customers');
  assert.deepEqual(state.selectedCategoryIds.sort(), ['customers', 'products']);
  assert.equal(state.activeCategoryId, 'products', 'adding a second must not steal focus');
});

test('A4. TEST 4 - unticking removes it from Area 2, with nothing stale left', () => {
  const state = panels.toggleCategory(pick('products', 'customers'), 'customers');
  assert.deepEqual(state.selectedCategoryIds, ['products']);
  assert.equal(state.selectedCategoryIds.includes('customers'), false);
});

test('A5. §17 - unticking the ACTIVE category moves focus to another selected one', () => {
  const state = panels.toggleCategory(pick('products', 'customers'), 'products');
  assert.deepEqual(state.selectedCategoryIds, ['customers']);
  assert.equal(state.activeCategoryId, 'customers', 'Area 3 must never point at a removed category');
});

test('A6. TEST 5/6 - clicking a category in Area 2 makes it active', () => {
  const state = panels.setActiveCategory(pick('products', 'customers'), 'customers');
  assert.equal(state.activeCategoryId, 'customers');
  // And only ONE category is ever active, so Area 3 never merges datasets.
  assert.equal(typeof state.activeCategoryId, 'string');
});

test('A7. §5 - a category that is not selected can never become active', () => {
  const state = panels.setActiveCategory(pick('products'), 'shifts');
  assert.equal(state.activeCategoryId, 'products', 'the request is refused');
  assert.equal(state.selectedCategoryIds.includes('shifts'), false);
});

test('A8. TEST 7 - select-all shows all seven', () => {
  const state = panels.selectAllCategories(EMPTY());
  assert.equal(state.selectedCategoryIds.length, 7);
  assert.ok(state.activeCategoryId, 'something becomes active');
});

test('A9. TEST 8 - clearing empties Area 2 and puts Area 3 in its empty state', () => {
  const state = panels.clearCategories();
  assert.deepEqual(state.selectedCategoryIds, []);
  assert.equal(state.activeCategoryId, null);
  assert.equal(panels.isEmptyState(state), true);
  // Unticking the last one does the same.
  assert.equal(panels.isEmptyState(panels.toggleCategory(pick('products'), 'products')), true);
});

test('A10. selection order is canonical, not click order, so Area 2 is stable', () => {
  const a = pick('shifts', 'products');
  const b = pick('products', 'shifts');
  assert.deepEqual(a.selectedCategoryIds, b.selectedCategoryIds);
});

// ==================================================
// B. COST-CENTRE SUB-CATEGORIES (§28 TEST 9-17)
// ==================================================

/** Codes shaped like the real ones, including two the rule must NOT classify. */
const COST_CENTERS = [
  { id: 'a', code: '5001', name: 'إنتاج 1' },
  { id: 'b', code: '5120', name: 'إنتاج 2' },
  { id: 'c', code: '6120', name: 'خدمي' },
  { id: 'd', code: '7340', name: 'تسويقي' },
  { id: 'e', code: '8120', name: 'إداري' },
  { id: 'f', code: '9020', name: 'رأسمالي' },
  { id: 'g', code: '0501', name: 'كود يبدأ بصفر' },
  { id: 'h', code: '1234', name: 'خارج النطاق' },
];
const ids = (rows: any[]) => rows.map((r) => r.id).sort();
const filt = (digits: string[]) => panels.filterByCostCenterSubCategories(COST_CENTERS, digits, 'code');

test('B1. TEST 9 - the five sub-categories come from the EXISTING rule', () => {
  const subs = panels.costCenterSubCategories();
  assert.deepEqual(subs.map((s: any) => s.digit), ['5', '6', '7', '8', '9']);
  // Each label is the one already used by the Sheet1 import - not a new string.
  for (const sub of subs) {
    assert.equal(sub.labelAr, cch.ROOT_CATEGORY_LABELS[sub.digit], `${sub.digit} must reuse the existing label`);
  }
});

test('B2. TEST 10-14 - each digit filters to codes beginning with it', () => {
  assert.deepEqual(ids(filt(['5'])), ['a', 'b']);
  assert.deepEqual(ids(filt(['6'])), ['c']);
  assert.deepEqual(ids(filt(['7'])), ['d']);
  assert.deepEqual(ids(filt(['8'])), ['e']);
  assert.deepEqual(ids(filt(['9'])), ['f']);
});

test('B3. TEST 15 - two digits give the union', () => {
  assert.deepEqual(ids(filt(['5', '6'])), ['a', 'b', 'c']);
  assert.deepEqual(ids(filt(['7', '9'])), ['d', 'f']);
});

test('B4. TEST 16 - select-all covers the five supported classifications', () => {
  assert.deepEqual(panels.selectAllSubCategories(), ['5', '6', '7', '8', '9']);
  assert.deepEqual(ids(filt(panels.selectAllSubCategories())), ['a', 'b', 'c', 'd', 'e', 'f'],
    'the two unclassifiable codes are still not swept in');
});

test('B5. TEST 17 / CRITICAL 7 - "0501" is NOT a 5; the leading zero is significant', () => {
  assert.equal(panels.costCenterRootDigit('0501'), null, 'a leading zero is never stripped to force a match');
  assert.equal(filt(['5']).some((r: any) => r.id === 'g'), false);
  // It is not silently dropped either - it is counted as unclassified.
  const counts = panels.costCenterSubCategoryCounts(COST_CENTERS, 'code');
  assert.equal(counts.unclassified, 2, '0501 and 1234');
  assert.equal(counts.total, COST_CENTERS.length);
});

test('B6. §8 - the root is the first character, taken from a trimmed string code', () => {
  assert.equal(panels.costCenterRootDigit(' 5001 '), '5', 'whitespace only');
  assert.equal(panels.costCenterRootDigit('1234'), null, 'outside 5-9');
  assert.equal(panels.costCenterRootDigit(''), null);
  assert.equal(panels.costCenterRootDigit(null), null);
  // Numeric input is handled without assuming the schema stores a number.
  assert.equal(panels.costCenterRootDigit(5001), '5');
});

test('B7. §10/§11 - counts per digit, and an empty one is reported not hidden', () => {
  const counts = panels.costCenterSubCategoryCounts(COST_CENTERS, 'code');
  assert.equal(counts.byDigit['5'], 2);
  assert.equal(counts.byDigit['6'], 1);
  // A digit with no records still has an entry, so the classification stays visible.
  const sparse = panels.costCenterSubCategoryCounts([{ code: '5001' }], 'code');
  for (const digit of ['5', '6', '7', '8', '9']) {
    assert.equal(typeof sparse.byDigit[digit], 'number', `${digit} must be present even at zero`);
  }
  assert.equal(sparse.byDigit['9'], 0);
});

test('B8. nothing ticked means no narrowing, as everywhere else', () => {
  assert.equal(filt([]).length, COST_CENTERS.length);
});

test('B9. toggling keeps the canonical 5..9 order', () => {
  let digits: string[] = [];
  digits = panels.toggleSubCategory(digits, '9');
  digits = panels.toggleSubCategory(digits, '5');
  assert.deepEqual(digits, ['5', '9'], 'stable order regardless of click order');
  digits = panels.toggleSubCategory(digits, '5');
  assert.deepEqual(digits, ['9']);
});

// ==================================================
// C. THE RULE IS REUSED, NOT COPIED (§14, CRITICAL 5-8, 12)
// ==================================================

test('C1. the 5/6/7/8/9 definition is re-exported from the existing module', () => {
  const src = readCode('src/services/masterDataPanelsPure.ts');
  assert.ok(/from '\.\/costCenterHierarchyPure'/.test(src), 'it must import the existing rule');
  assert.ok(/export \{ ROOT_CATEGORY_CODES, ROOT_CATEGORY_LABELS \}/.test(src), 'and re-export it');
  // No second copy of the digits or the labels.
  assert.equal(/ROOT_CATEGORY_LABELS\s*[:=]\s*\{/.test(src), false, 'no local copy of the labels');
  assert.equal(/\['5',\s*'6',\s*'7',\s*'8',\s*'9'\]/.test(src), false, 'no local copy of the digits');
  // Identity, not just equality.
  assert.equal(panels.ROOT_CATEGORY_CODES, cch.ROOT_CATEGORY_CODES);
  assert.equal(panels.ROOT_CATEGORY_LABELS, cch.ROOT_CATEGORY_LABELS);
});

test('C2. CRITICAL 12 - no second category registry was created', () => {
  const src = readCode('src/services/masterDataPanelsPure.ts');
  assert.ok(/from '\.\/masterDataCategoryRegistry'/.test(src), 'labels/collections come from the registry');
  // Only ids are listed here; no label, collection or code field is restated.
  assert.equal(/labelAr:\s*'/.test(src), false, 'no label may be duplicated');
  assert.equal(/collection:\s*'/.test(src), false, 'no collection may be duplicated');
  assert.equal(/codeField:\s*'/.test(src), false, 'no code field may be duplicated');
});

test('C3. CRITICAL 8 - cost centres are not equated with production equipment', () => {
  const src = readCode('src/services/masterDataPanelsPure.ts');
  for (const forbidden of ['presses', 'furnaces', 'mills', 'hierarchyNodeId', 'pressId']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not appear in the cost-centre classification`);
  }
  // The cost-centre category is the departments collection, distinct from equipment.
  assert.equal(reg.getCategory('costCenters').collection, 'departments');
});

// ==================================================
// D. WIRING AND REGRESSION (§6, §24, §25, §26, §29)
// ==================================================

test('D1. §20 - the three areas are rendered and identifiable', () => {
  const src = readCode(VIEW);
  assert.ok(/id="master-data-code-type-menu"/.test(src), 'Area 1 - the checkbox menu');
  assert.ok(/id="master-data-selected-categories"/.test(src), 'Area 2 - the selected categories');
  assert.ok(/id="master-data-empty-state"/.test(src), 'Area 3 - the empty state');
  assert.ok(/id="cost-center-subcategories"/.test(src), 'the cost-centre sub-category controls');
});

test('D2. §2/§3 - Area 1 is a checkbox multi-select driven by the registry', () => {
  const src = readCode(VIEW);
  assert.ok(/areaCategories\.map\(\(category\) =>/.test(src), 'the list comes from the registry');
  /*
   * The window is generous on purpose: between the input and its handler sit
   * the className and the `checked` binding, and pinning a tight character
   * count would make this assertion fail on formatting rather than on the
   * behaviour it is meant to guard.
   */
  assert.ok(/type="checkbox"[\s\S]{0,400}toggleCategory\(prev, category\.id\)/.test(src),
    'each category has a checkbox that toggles selection');
  assert.ok(/checked=\{isCategorySelected\(panelSelection, category\.id\)\}/.test(src),
    'and reflects the current selection');
  assert.ok(/panelCategories\(\)/.test(src), 'via the shared helper');
  // No hard-coded category list in the component.
  assert.equal(/'products',\s*'customers',\s*'materials'/.test(src), false, 'no literal category list');
});

test('D3. §4/§5 - Area 2 shows only selected categories and drives Area 3', () => {
  const src = readCode(VIEW);
  assert.ok(/panelSelection\.selectedCategoryIds\.map\(\(categoryId\) =>/.test(src),
    'Area 2 iterates the SELECTED ids, not every category');
  assert.ok(/setActiveCategory\(prev, categoryId\)/.test(src), 'clicking makes it active');
  assert.ok(/if \(category\?\.tab\) setActiveTab\(category\.tab as MasterDataTab\)/.test(src),
    'and the active category drives the existing tab engine');
});

test('D4. §6 - Area 3 keeps every existing capability', () => {
  const src = readCode(VIEW);
  for (const kept of [
    'searchQuery', 'statusFilter', 'handleOpenEdit', 'handleExport',
    'updateMasterDataItem', 'createMasterDataItem', 'selectedCodes',
  ]) {
    assert.ok(src.includes(kept), `${kept} must still exist`);
  }
});

test('D5. §9/§10 - the cost-centre filter composes with the existing filters', () => {
  const src = readCode(VIEW);
  assert.ok(/filterByCostCenterSubCategories\(filteredItems, costCenterDigits, 'code'\)/.test(src),
    'it narrows the ALREADY filtered rows rather than replacing them');
  assert.ok(/isCostCenterActive \? filterByCostCenterSubCategories/.test(src),
    'and only when cost centres are active');
  // Everything the table renders uses the sub-filtered list.
  assert.ok(/visibleItems\.map\(\(item\) =>/.test(src), 'the table renders the sub-filtered rows');
});

test('D6. §17 - the table is hidden, not stale, when nothing is selected', () => {
  const src = readCode(VIEW);
  assert.ok(/\{!isEmptyState\(panelSelection\) && \(/.test(src), 'Area 3 content is guarded');
  assert.ok(/isEmptyState\(panelSelection\) && \(/.test(src), 'and an empty state is shown instead');
});

test('D7. TEST 20/§24 - Financial Account import still opens its dedicated modal', () => {
  const src = readCode(VIEW);
  assert.ok(/<FinancialAccountsImportModal/.test(src), 'the dedicated importer is still rendered');
  assert.ok(/setIsAccountsImportOpen\(true\)/.test(src), 'and still opened by the action');
  assert.equal(/onNavigate\('bulk-entry'\)[\s\S]{0,100}financialAccounts/.test(src), false,
    'it must never route to Historical Import');
});

test('D8. TEST 21/22 / §25/§26 - the two hierarchy utilities remain separate', () => {
  const src = readSource(VIEW);
  assert.ok(src.includes('التسلسل الهرمي لمراكز التكلفة'), 'the Cost Center Hierarchy utility remains');
  assert.ok(src.includes('مطابقة الأكواد مع التسلسل الهرمي'), 'the reconciliation utility remains');
  assert.ok(/id="master-data-reconcile-btn"/.test(src), 'reconciliation is still reachable');
  assert.ok(/<CostCenterHierarchyPanel/.test(src), 'the hierarchy panel is still rendered');
  // Neither is inside the category list.
  const code = readCode(VIEW);
  const menuAt = code.indexOf('id="master-data-code-type-menu"');
  const menuBlock = code.slice(menuAt, menuAt + 900);
  assert.equal(/reconcile|CostCenterHierarchyPanel/.test(menuBlock), false,
    'utilities must not appear as categories');
});

test('D9. TEST 23-26 / §13 - the hierarchy, Production Records, Reports and AI are untouched', () => {
  for (const rel of [
    'src/services/hierarchyResolverPure.ts',
    'src/services/hierarchySelectorPure.ts',
    'src/components/production/ProductionRecordsView.tsx',
    'src/components/reports/ReportsView.tsx',
    'src/assistant/tools/stageReportTools.ts',
  ]) {
    const src = readCode(rel);
    assert.equal(/masterDataPanelsPure|PANEL_CATEGORY_IDS|costCenterRootDigit/.test(src), false,
      `${rel} must not be touched by a Master Data UI change`);
  }
});

test('D10. §15/§30/§31 - selection is UI state only: no writes, no extra reads', () => {
  const src = readCode('src/services/masterDataPanelsPure.ts');
  assert.equal(/getDocs|firebase|await |fetchMasterData|updateDoc|setDoc/.test(src), false,
    'the selection module must stay pure and synchronous');
  const view = readCode(VIEW);
  // Ticking a category must not trigger a fetch.
  assert.equal(/toggleCategory[\s\S]{0,160}fetchMasterData/.test(view), false,
    'selecting a category must not read');
  // Counts come from rows already loaded.
  assert.ok(/costCenterSubCategoryCounts\(items, 'code'\)/.test(view),
    'counts are computed from the loaded rows, not a new query');
});

test('D11. §23 - no new permission was introduced', () => {
  const src = readCode(VIEW) + readCode('src/services/masterDataPanelsPure.ts');
  for (const invented of ['masterData.categories', 'panel.view', 'costCenter.view', 'masterData.panels']) {
    assert.equal(src.includes(invented), false, `must not invent ${invented}`);
  }
  assert.ok(/canImportMasterData/.test(readCode(VIEW)), 'the existing permission gate remains');
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

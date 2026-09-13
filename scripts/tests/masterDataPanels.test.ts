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

// ==================================================
// A. UNIFIED PRIMARY NAVIGATION (§26 TEST 1-4)
//
// The multi-select panel is gone; one row is the whole navigation. These
// assertions cover which categories it offers and, just as importantly, which
// it must NOT - the duplicates that made one machine look like two master
// records.
// ==================================================

test('A1. TEST 2 - the primary navigation is exactly the seven categories', () => {
  const ids = [...panels.PANEL_CATEGORY_IDS];
  assert.deepEqual(
    ids.sort(),
    ['customers', 'employees', 'financialAccounts', 'hierarchicalCostCenters', 'materials', 'products', 'shifts'],
  );
  assert.equal(panels.panelCategories().length, 7);
  // Every one resolves to a real registry entry with labels and a tab.
  for (const category of panels.panelCategories()) {
    assert.ok(category.labelAr && category.labelEn, `${category.id} must carry both labels`);
    assert.ok(category.tab, `${category.id} must map to a tab the shared loader can serve`);
    assert.ok(reg.getCategory(category.id), `${category.id} must exist in the shared registry`);
  }
});

test('A2. TEST 3 / CRITICAL 3 - the duplicate primary categories are gone', () => {
  const ids = [...panels.PANEL_CATEGORY_IDS];
  for (const removed of ['presses', 'furnaces', 'mills', 'costCenters', 'productTypes', 'furnaceCars']) {
    assert.equal(ids.includes(removed), false, `${removed} must not be a primary category`);
  }
  // They still EXIST as data - this is a presentation change, not a deletion.
  for (const kept of ['presses', 'furnaces', 'mills', 'costCenters']) {
    assert.ok(reg.getCategory(kept), `${kept} must remain in the registry for internal use`);
  }
});

test('A3. CRITICAL 4 - cost centres are served by the HIERARCHY, not the legacy list', () => {
  assert.equal(panels.COST_CENTER_CATEGORY_ID, 'hierarchicalCostCenters');
  const category = reg.getCategory(panels.COST_CENTER_CATEGORY_ID);
  assert.equal(category.collection, 'costCenterHierarchy', 'the imported tree is the source');
  assert.equal(category.codeField, 'sheet1Code');
  assert.equal(panels.COST_CENTER_CODE_FIELD, 'sheet1Code');
  // And the legacy flat list is still a distinct, untouched registry entry.
  assert.equal(reg.getCategory('costCenters').collection, 'departments');
});

test('A4. TEST 1 - the removed multi-select leaves no selection API behind', () => {
  for (const gone of ['toggleCategory', 'selectAllCategories', 'clearCategories', 'setActiveCategory', 'isCategorySelected', 'isEmptyState', 'EMPTY_PANEL_SELECTION']) {
    assert.equal(typeof panels[gone], 'undefined', `${gone} must not survive as dead API`);
  }
});

test('A5. §15 - Financial Accounts stay a separate category from cost centres', () => {
  assert.ok([...panels.PANEL_CATEGORY_IDS].includes('financialAccounts'));
  assert.notEqual(panels.COST_CENTER_CATEGORY_ID, 'financialAccounts');
  assert.equal(reg.getCategory('financialAccounts').collection, 'financialAccounts',
    'their own collection, never merged into the hierarchy');
});

// ==================================================
// B. COST-CENTRE SUB-CATEGORIES (§28 TEST 9-17)
// ==================================================

/** Codes shaped like the real ones, including two the rule must NOT classify. */
const COST_CENTERS = [
  { id: 'a', sheet1Code: '5001', name: 'إنتاج 1' },
  { id: 'b', sheet1Code: '5120', name: 'إنتاج 2' },
  { id: 'c', sheet1Code: '6120', name: 'خدمي' },
  { id: 'd', sheet1Code: '7340', name: 'تسويقي' },
  { id: 'e', sheet1Code: '8120', name: 'إداري' },
  { id: 'f', sheet1Code: '9020', name: 'رأسمالي' },
  { id: 'g', sheet1Code: '0501', name: 'كود يبدأ بصفر' },
  { id: 'h', sheet1Code: '1234', name: 'خارج النطاق' },
];
const ids = (rows: any[]) => rows.map((r) => r.id).sort();
const filt = (digits: string[]) => panels.filterByCostCenterSubCategories(COST_CENTERS, digits, panels.COST_CENTER_CODE_FIELD);

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
  const counts = panels.costCenterSubCategoryCounts(COST_CENTERS, panels.COST_CENTER_CODE_FIELD);
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
  const counts = panels.costCenterSubCategoryCounts(COST_CENTERS, panels.COST_CENTER_CODE_FIELD);
  assert.equal(counts.byDigit['5'], 2);
  assert.equal(counts.byDigit['6'], 1);
  // A digit with no records still has an entry, so the classification stays visible.
  const sparse = panels.costCenterSubCategoryCounts([{ sheet1Code: '5001' }], panels.COST_CENTER_CODE_FIELD);
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
// D. WIRING AND REGRESSION (§24, §21, §30)
// ==================================================

test('D1. TEST 1/§2 - the redundant multi-select panel is gone from the screen', () => {
  const src = readCode(VIEW);
  for (const gone of [
    'master-data-code-type-menu',      // the checkbox panel
    'master-data-selected-categories', // the second, derived row
    'master-data-category-select',     // the older dropdown that opened the modal
  ]) {
    assert.equal(src.includes(gone), false, `${gone} must no longer be rendered`);
  }
  // Exactly one navigation control remains.
  assert.ok(/id="master-data-primary-categories"/.test(src), 'the single primary row');
});

test('D2. §24 - the primary row is built from the registry, not a literal list', () => {
  const src = readCode(VIEW);
  assert.ok(/areaCategories\.map\(\(category\) =>/.test(src), 'it iterates the registry categories');
  assert.ok(/panelCategories\(\)/.test(src), 'via the shared helper');
  assert.ok(/setActiveCategoryId\(category\.id\)/.test(src), 'clicking one makes it active');
  assert.equal(/'products',\s*'customers',\s*'materials'/.test(src), false, 'no literal category list');
});

test('D3. TEST 18 / §21 / CRITICAL 11 - choosing Cost Centers does NOT open the hierarchy modal', () => {
  const src = readCode(VIEW);
  // The only opener left is the dedicated maintenance utility button.
  const openers = src.split('setIsHierarchyPanelOpen(true)').length - 1;
  assert.equal(openers, 1, `expected exactly one opener, found ${openers}`);
  assert.ok(/id="master-data-cost-center-hierarchy-btn"[\s\S]{0,300}setIsHierarchyPanelOpen\(true\)/.test(src),
    'and it is the utility button, not a category choice');
  // No category handler may open it.
  assert.equal(/setActiveCategoryId\([\s\S]{0,120}setIsHierarchyPanelOpen/.test(src), false,
    'selecting a category must never open the modal');
  assert.equal(/reader === .costCenterHierarchy.[\s\S]{0,120}setIsHierarchyPanelOpen/.test(src), false,
    'the old reader-based redirect must be gone');
});

test('D4. §14 - the data area keeps every existing capability', () => {
  const src = readCode(VIEW);
  for (const kept of [
    'searchQuery', 'statusFilter', 'handleOpenEdit', 'handleExport',
    'updateMasterDataItem', 'createMasterDataItem', 'selectedCodes',
  ]) {
    assert.ok(src.includes(kept), `${kept} must still exist`);
  }
});

test('D5. TEST 4/§9 - the cost-centre classifications are INLINE and compose with the filters', () => {
  const src = readCode(VIEW);
  assert.ok(/id="cost-center-subcategories"/.test(src), 'rendered inline on the same screen');
  assert.ok(/filterByCostCenterSubCategories\(filteredItems, costCenterDigits, COST_CENTER_CODE_FIELD\)/.test(src),
    'it narrows the ALREADY filtered rows rather than replacing them');
  assert.ok(/isCostCenterActive \? filterByCostCenterSubCategories/.test(src), 'and only when cost centres are active');
  assert.ok(/visibleItems\.map\(\(item\) =>/.test(src), 'the table renders the sub-filtered rows');
});

test('D6. §11 - the hierarchy path is shown for the hierarchical category', () => {
  const src = readCode(VIEW);
  assert.ok(/currentCategory\?\.hierarchical/.test(src), 'the category declares itself hierarchical');
  assert.ok(/getNodePath\(/.test(src), 'and the path comes from the shared resolver');
  assert.equal(reg.getCategory(panels.COST_CENTER_CATEGORY_ID).hierarchical, true);
});

test('D7. TEST 21/§24 - Financial Account import still opens its dedicated modal', () => {
  const src = readCode(VIEW);
  assert.ok(/<FinancialAccountsImportModal/.test(src), 'the dedicated importer is still rendered');
  assert.ok(/setIsAccountsImportOpen\(true\)/.test(src), 'and still opened by the action');
  assert.equal(/onNavigate\('bulk-entry'\)[\s\S]{0,100}financialAccounts/.test(src), false,
    'it must never route to Historical Import');
});

test('D8. TEST 16/17 / §22/§23 - both utilities remain, separate from browsing', () => {
  const src = readSource(VIEW);
  assert.ok(src.includes('التسلسل الهرمي لمراكز التكلفة'), 'the hierarchy maintenance utility remains');
  assert.ok(src.includes('مطابقة الأكواد مع التسلسل الهرمي'), 'the reconciliation utility remains');
  assert.ok(/id="master-data-reconcile-btn"/.test(src), 'reconciliation is still reachable');
  assert.ok(/<CostCenterHierarchyPanel/.test(src), 'the hierarchy panel is still rendered');
  // Neither is a category.
  const ids = [...panels.PANEL_CATEGORY_IDS];
  assert.equal(ids.includes('reconciliation'), false);
});

test('D9. TEST 15 / §17-§20 - hierarchy, Production Records, Reports, AI and Dashboard untouched', () => {
  for (const rel of [
    'src/services/hierarchyResolverPure.ts',
    'src/services/hierarchySelectorPure.ts',
    'src/services/legacyHierarchyReconciliationPure.ts',
    'src/components/production/ProductionRecordsView.tsx',
    'src/components/reports/ReportsView.tsx',
    'src/assistant/tools/stageReportTools.ts',
    'src/components/dashboard/DashboardView.tsx',
  ]) {
    const src = readCode(rel);
    assert.equal(/masterDataPanelsPure|PANEL_CATEGORY_IDS|costCenterRootDigit/.test(src), false,
      `${rel} must not be touched by a Master Data UI change`);
  }
});

test('D10. §5/CRITICAL 14-16 - no second registry, resolver or import system', () => {
  const src = readCode('src/services/masterDataPanelsPure.ts');
  assert.ok(/from '\.\/masterDataCategoryRegistry'/.test(src), 'labels/collections come from the registry');
  assert.equal(/labelAr:\s*'/.test(src), false, 'no label duplicated');
  assert.equal(/collection:\s*'/.test(src), false, 'no collection duplicated');
  assert.equal(/getChildIds|descendant/i.test(src), false, 'no traversal of its own');
  // The generic importer still refuses the hierarchy - it has its own Sheet1 panel.
  const bulk = readCode('src/services/bulkImportService.ts');
  assert.ok(/Exclude<MasterDataTab, 'costCenterHierarchy'>/.test(bulk),
    'the hierarchy is excluded from the generic importer at the type level');
});

test('D11. §31/§33 - no writes, no extra reads, no new permission', () => {
  const src = readCode('src/services/masterDataPanelsPure.ts');
  assert.equal(/getDocs|firebase|await |fetchMasterData|updateDoc|setDoc/.test(src), false,
    'the module must stay pure and synchronous');
  const view = readCode(VIEW);
  assert.ok(/costCenterSubCategoryCounts\(items, COST_CENTER_CODE_FIELD\)/.test(view),
    'counts are computed from the loaded rows, not a new query');
  for (const invented of ['masterData.categories', 'costCenter.view', 'masterData.panels']) {
    assert.equal(view.includes(invented), false, `must not invent ${invented}`);
  }
  assert.ok(/canImportMasterData/.test(view), 'the existing permission gate remains');
});

test('D12. §6/§13 - the hierarchy uses the SHARED loader; legacy data is untouched', () => {
  const md = readCode('src/services/masterDataService.ts');
  assert.ok(/costCenterHierarchy: 'costCenterHierarchy'/.test(md),
    'registered so the shared cache-first read and subscription serve it');
  // The legacy departments collection is still registered and still used.
  assert.ok(/departments: 'departments'/.test(md), 'the legacy collection is not removed');
  const view = readCode(VIEW);
  assert.equal(/deleteMasterDataItem\([\s\S]{0,80}departments/.test(view), false,
    'nothing deletes the legacy list');
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

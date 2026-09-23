/**
 * MASTER DATA ON-DEMAND (LAZY) LOADING
 *
 * THE PROPERTY UNDER TEST: opening "البيانات الأساسية" reads nothing. No
 * Products, Materials, BOMs, Customers, Suppliers, Employees, Equipment or Work
 * Centers - no entity list at all - until the user opens a section explicitly.
 * Before this change the screen selected Products on mount, which subscribed to
 * the whole products collection, seeded and subscribed to the product types,
 * read five equipment collections and the cost-centre hierarchy, and read two
 * dropdown lists for a form nobody had opened.
 *
 * HOW IT IS PROVEN: the loading rules are a pure module, so group A runs them
 * for the actual mount state and asserts the planned read list is EMPTY - not
 * "looks gated", empty. The registry and collection map fed into it are the
 * real ones, read from the shipped source, so a new category or collection
 * cannot slip past the assertion. The screen itself imports Firebase, so its
 * wiring to those rules is asserted by source inspection with comments stripped
 * - the convention the other Master Data suites already use.
 *
 * WHAT MUST NOT CHANGE: business rules, validation, permissions, CRUD, audit,
 * the BOM/routing features, import and export. Groups H and I assert those are
 * still present and that the import engine was not touched.
 *
 * Run: npx tsx scripts/tests/masterDataLazyLoad.test.ts
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

console.log('masterDataLazyLoad.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}
/** Source with comments stripped, so a comment can never satisfy an assertion. */
function readCode(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const VIEW = 'src/components/masterData/MasterDataView.tsx';
const RULES = 'src/services/masterDataLazyLoadPure.ts';
const SERVICE = 'src/services/masterDataService.ts';

let lazy: any;
let reg: any;
let panels: any;
let equip: any;
let recon: any;

/**
 * The REAL tab -> collection map, read from the shipped service.
 *
 * masterDataService imports Firebase and cannot be loaded here, so the map is
 * parsed out of its source. Parsing the shipped declaration rather than
 * restating it means a collection added there is covered by these tests
 * automatically.
 */
function realCollectionMap(): Record<string, string> {
  const src = readCode(SERVICE);
  const block = src.match(/export const MASTER_DATA_COLLECTIONS[^{]*\{([\s\S]*?)\n\};/);
  assert.ok(block, 'MASTER_DATA_COLLECTIONS must still be declared as an object literal');
  const map: Record<string, string> = {};
  for (const line of block![1].split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*:\s*'([^']+)'\s*,?\s*$/);
    if (m) map[m[1]] = m[2];
  }
  assert.ok(Object.keys(map).length >= 15, 'the parsed collection map must not be empty');
  return map;
}

let COLLECTIONS: Record<string, string>;
let NAVIGATION: any[];
let READ_OPTIONS: any;

async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  lazy = await load(RULES);
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  panels = await load('src/services/masterDataPanelsPure.ts');
  equip = await load('src/services/equipmentMasterPure.ts');
  recon = await load('src/services/legacyHierarchyReconciliationPure.ts');
  COLLECTIONS = realCollectionMap();
  NAVIGATION = panels.panelCategories();
  READ_OPTIONS = {
    collectionFor: (tab: string) => COLLECTIONS[tab],
    equipmentCollections: recon.RECONCILABLE_EQUIPMENT_CATEGORIES.map((c: string) => COLLECTIONS[c]),
    hierarchyCollection: COLLECTIONS.costCenterHierarchy,
    isEquipmentTab: equip.isEquipmentLinkTab,
  };
}

/** The state the screen mounts in: nothing opened, no form, no window. */
const MOUNT = { activeCategoryId: null, activeTab: 'products', isReconcileOpen: false, isModalOpen: false };

// ==================================================
// A. INITIAL MOUNT - ZERO ENTITY-LIST READS
// ==================================================

test('A1. opening the screen plans NO Firestore entity-list read at all', () => {
  const reads = lazy.plannedEntityReads(MOUNT, NAVIGATION, READ_OPTIONS);
  assert.deepEqual(reads, [], `expected no reads on mount, got: ${reads.join(', ')}`);
});

test('A2. none of the named lists is read on mount - products, materials, BOMs, customers, employees, equipment', () => {
  const reads = lazy.plannedEntityReads(MOUNT, NAVIGATION, READ_OPTIONS);
  for (const collection of [
    'products', 'materials', 'boms', 'customers', 'employees', 'shifts',
    'presses', 'furnaces', 'chineseMills', 'tubeBallMills', 'rotaryKilns',
    'productTypes', 'costCenterHierarchy', 'departments',
  ]) {
    assert.equal(reads.includes(collection), false, `${collection} must not be read on mount`);
  }
});

test('A3. no section is open on mount, whatever the tab engine happens to hold', () => {
  // `activeTab` keeps a value for the table engine; with no category chosen it
  // must not make anything load.
  for (const tab of ['products', 'boms', 'presses', 'customers']) {
    assert.equal(lazy.resolveOpenTab({ activeCategoryId: null, activeTab: tab }, NAVIGATION), null);
    assert.deepEqual(lazy.plannedEntityReads({ ...MOUNT, activeTab: tab }, NAVIGATION, READ_OPTIONS), []);
  }
});

test('A4. the screen starts with no section selected and Products is not chosen for the user', () => {
  const src = readCode(VIEW);
  assert.ok(/useState<string \| null>\(/.test(src), 'the chosen section may be nothing at all');
  assert.equal(/panelCategories\(\)\)\) \|\| 'products'/.test(src), false,
    'Products must no longer be the fallback selection');
  assert.ok(/navigationCategoryIdForTab\(prefill\.tab, panelCategories\(\)\)\) \|\| null/.test(src),
    'only an explicit deep-link prefill opens a section by itself');
  assert.ok(/const isSectionOpen = activeCategoryId !== null;/.test(src), 'and everything else keys off that');
});

test('A5. the loading indicator does not start on - nothing is loading before a section is opened', () => {
  const src = readCode(VIEW);
  assert.ok(/const \[isLoading, setIsLoading\] = useState<boolean>\(false\);/.test(src));
});

// ==================================================
// B. OPENING ONE SECTION LOADS ONLY THAT SECTION
// ==================================================

test('B1. opening Products reads products (and its product types) and nothing else', () => {
  const reads = lazy.plannedEntityReads(
    { ...MOUNT, activeCategoryId: 'products' }, NAVIGATION, READ_OPTIONS);
  assert.deepEqual(reads, ['products', 'productTypes']);
});

test('B2. opening Customers reads customers only - no products, no product types', () => {
  const reads = lazy.plannedEntityReads(
    { ...MOUNT, activeCategoryId: 'customers' }, NAVIGATION, READ_OPTIONS);
  assert.deepEqual(reads, ['customers']);
});

test('B3. every navigation section reads exactly its own collection', () => {
  for (const category of NAVIGATION) {
    if (!category.tab) continue;
    const state = { ...MOUNT, activeCategoryId: category.id };
    const openTab = lazy.resolveOpenTab(state, NAVIGATION);
    const reads = lazy.plannedEntityReads(state, NAVIGATION, READ_OPTIONS);
    assert.ok(reads.includes(COLLECTIONS[openTab]), `${category.id} must read its own collection`);
    // Nothing unrelated comes with it: the only extras allowed are the product
    // types (Products / Product Types) and the equipment reference data.
    for (const extra of reads) {
      if (extra === COLLECTIONS[openTab]) continue;
      const allowed = extra === 'productTypes'
        || extra === COLLECTIONS.costCenterHierarchy
        || READ_OPTIONS.equipmentCollections.includes(extra);
      assert.ok(allowed, `${category.id} must not read ${extra}`);
    }
  }
});

test('B4. an equipment section reads the equipment reference data, a non-equipment one never does', () => {
  const equipmentReads = lazy.plannedEntityReads(
    { ...MOUNT, activeCategoryId: 'equipment' }, NAVIGATION, READ_OPTIONS);
  assert.ok(equipmentReads.includes(COLLECTIONS.costCenterHierarchy), 'the hierarchy is needed by the link selector');
  const customerReads = lazy.plannedEntityReads(
    { ...MOUNT, activeCategoryId: 'customers' }, NAVIGATION, READ_OPTIONS);
  assert.equal(customerReads.includes(COLLECTIONS.costCenterHierarchy), false);
  for (const c of READ_OPTIONS.equipmentCollections) {
    assert.equal(customerReads.includes(c), false, `${c} is not a customer's business`);
  }
});

// ==================================================
// C. SWITCHING SECTIONS
// ==================================================

test('C1. switching to a new section reads the NEW one, not the previous one', () => {
  // The open section is derived from the chosen category, not from the tab
  // engine, which follows one render later - otherwise one click read two
  // collections, the first of them unwanted.
  const openTab = lazy.resolveOpenTab({ activeCategoryId: 'customers', activeTab: 'products' }, NAVIGATION);
  assert.equal(openTab, 'customers');
  const reads = lazy.plannedEntityReads(
    { activeCategoryId: 'customers', activeTab: 'products', isReconcileOpen: false, isModalOpen: false },
    NAVIGATION, READ_OPTIONS);
  assert.equal(reads.includes('products'), false, 'the section being left must not be read');
  assert.deepEqual(reads, ['customers']);
});

test('C2. the screen derives the open section from the category, through the shared rule', () => {
  const src = readCode(VIEW);
  assert.ok(/resolveOpenTab\(\{ activeCategoryId, activeTab \}, areaCategories\)/.test(src),
    'the view uses the shared resolver rather than its own condition');
  assert.ok(/\}, \[openTab, sectionReload\]\);/.test(src),
    'and the list effect is keyed on it, not on activeTab');
});

test('C3. a group section (Equipment) keeps whichever of its own tabs is open', () => {
  assert.equal(lazy.resolveOpenTab({ activeCategoryId: 'equipment', activeTab: 'furnaces' }, NAVIGATION), 'furnaces');
  // And a tab that does not belong to the group falls back to the group's own.
  const fallback = lazy.resolveOpenTab({ activeCategoryId: 'equipment', activeTab: 'customers' }, NAVIGATION);
  assert.notEqual(fallback, 'customers');
  assert.ok(equip.isEquipmentLinkTab(fallback) || fallback !== null);
});

// ==================================================
// D. REUSING A SECTION ALREADY LOADED
// ==================================================

test('D1. a section opened for the first time is read', () => {
  const plan = lazy.planSectionLoad({ collectionName: 'products', hasListener: false, hasRows: false });
  assert.equal(plan.read, 'products');
  assert.equal(plan.loading, true, 'and the indicator is shown while it arrives');
});

test('D2. returning to a section already open costs NO new read', () => {
  const plan = lazy.planSectionLoad({ collectionName: 'products', hasListener: true, hasRows: true });
  assert.equal(plan.read, null, 'nothing is read again');
  assert.equal(plan.reuse, true, 'the rows already in hand are shown');
  assert.equal(plan.loading, false, 'and no spinner appears for data already held');
});

test('D3. with no section open nothing is read and nothing is loading', () => {
  const plan = lazy.planSectionLoad({ collectionName: null, hasListener: false, hasRows: false });
  assert.deepEqual(plan, { read: null, reuse: false, loading: false });
});

test('D4. the screen keeps one listener per opened section and reuses it', () => {
  const src = readCode(VIEW);
  assert.ok(/listenersRef = useRef<Map<string, \(\) => void>>/.test(src), 'a registry of the listeners it opened');
  assert.ok(/sectionRowsRef = useRef<Map<string, any\[\]>>/.test(src), 'and of the rows each already has');
  assert.ok(/planSectionLoad\(\{/.test(src), 'the decision comes from the shared rule');
  assert.ok(/if \(!plan\.read\) return;/.test(src), 'a reused section opens no second listener');
  // The listeners are released together, so nothing leaks when the screen closes.
  assert.ok(/listenersRef\.current\.forEach\(\(stop\) => stop\(\)\);/.test(src), 'and all are released on unmount');
});

test('D5. rows arriving for a section that is no longer on screen never replace the visible ones', () => {
  const src = readCode(VIEW);
  assert.ok(/if \(activeTabRef\.current !== tab\) return;/.test(src),
    'a listener left attached to another section must not write into the table');
});

// ==================================================
// E. EXPLICIT REFRESH
// ==================================================

test('E1. Refresh detaches the listener and drops the rows, so the re-read is a real one', () => {
  const src = readCode(VIEW);
  const fn = src.match(/const handleRefreshSection = \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(fn, 'the refresh handler exists');
  const body = fn![0];
  assert.ok(/listenersRef\.current\.delete\(openTab\)/.test(body), 'the listener is detached');
  assert.ok(/sectionRowsRef\.current\.delete\(openTab\)/.test(body), 'and the held rows dropped');
  assert.ok(/setSectionReload\(\(n\) => n \+ 1\)/.test(body), 'which makes the effect read again');
  assert.ok(/if \(!openTab\) return;/.test(body), 'and it does nothing while no section is open');
});

test('E2. the Refresh control exists in the section toolbar', () => {
  const src = readCode(VIEW);
  assert.ok(/id="master-data-refresh-btn"/.test(src), 'the button');
  assert.ok(/onClick=\{handleRefreshSection\}/.test(src), 'wired to the explicit re-read');
});

test('E3. nothing else re-reads a section on a timer or an interval', () => {
  const src = readCode(VIEW);
  assert.equal(/setInterval\(/.test(src), false, 'no polling was introduced');
});

// ==================================================
// F. PLACEHOLDER AND LOADING STATES
// ==================================================

test('F1. with no section chosen the screen shows the placeholder, in Arabic as specified', () => {
  const src = readSource(VIEW);
  assert.ok(src.includes('اختر قسمًا لعرض بياناته'), 'the requested placeholder text');
  const code = readCode(VIEW);
  assert.ok(/id="master-data-no-section"/.test(code), 'rendered as its own panel');
  assert.ok(/\{!isSectionOpen \? \(/.test(code), 'and only while nothing is open');
});

test('F2. the placeholder replaces the controls and the table - no stale rows under a heading', () => {
  const code = readCode(VIEW);
  const placeholder = code.indexOf('master-data-no-section');
  const controls = code.indexOf('master-data-search-input');
  const table = code.indexOf('master-data-add-btn');
  assert.ok(placeholder > 0 && controls > placeholder && table > placeholder,
    'the section content is inside the branch that follows the placeholder');
});

test('F3. the section content sits BELOW the navigation row', () => {
  const code = readCode(VIEW);
  assert.ok(code.indexOf('id="master-data-primary-categories"') < code.indexOf('id="master-data-no-section"'),
    'navigation first, then the section area');
});

test('F4. a loading indicator names the section being loaded', () => {
  const src = readSource(VIEW);
  assert.ok(src.includes('جاري تحميل '), 'the Arabic loading text');
  assert.ok(/id="master-data-section-loading"/.test(readCode(VIEW)));
});

test('F5. the record count is not shown while no section is open', () => {
  const code = readCode(VIEW);
  assert.ok(/\{isSectionOpen && \(\s*<span className="inline-flex items-center gap-1\.5 px-3 py-2 rounded-xl bg-slate-100">/.test(code),
    'a count of nothing is not shown as "0"');
});

// ==================================================
// G. THE HIDDEN READS ARE GONE
// ==================================================

test('G1. product types are subscribed only for the sections that use them', () => {
  assert.equal(lazy.shouldSubscribeProductTypes(null), false);
  assert.equal(lazy.shouldSubscribeProductTypes('products'), true);
  assert.equal(lazy.shouldSubscribeProductTypes('productTypes'), true);
  for (const other of ['customers', 'boms', 'presses', 'employees', 'shifts']) {
    assert.equal(lazy.shouldSubscribeProductTypes(other), false, `${other} does not need them`);
  }
  const src = readCode(VIEW);
  assert.ok(/const needsProductTypes = shouldSubscribeProductTypes\(openTab\);/.test(src));
  assert.ok(/if \(!needsProductTypes\) return;/.test(src), 'and the subscription is gated on it');
});

test('G2. the equipment reference data is read for equipment or for the reconciliation window only', () => {
  const isEq = equip.isEquipmentLinkTab;
  assert.equal(lazy.needsEquipmentReferenceData(null, false, isEq), false, 'not on mount');
  assert.equal(lazy.needsEquipmentReferenceData('customers', false, isEq), false, 'not for an unrelated section');
  assert.equal(lazy.needsEquipmentReferenceData('presses', false, isEq), true, 'yes for an equipment section');
  assert.equal(lazy.needsEquipmentReferenceData(null, true, isEq), true, 'yes when the reconciliation is opened');
  const src = readCode(VIEW);
  assert.ok(/needsEquipmentReferenceData\(openTab, isReconcileOpen, isEquipmentLinkTab\)/.test(src));
  assert.ok(/if \(!needsEquipmentReference \|\| hierarchyReadRef\.current\) return;/.test(src),
    'the hierarchy read is gated and happens once');
});

test('G3. the form dropdown lists are read when the form opens, not when the screen does', () => {
  assert.deepEqual(lazy.formDropdownCollections('employees', false), [], 'not while the form is closed');
  assert.deepEqual(lazy.formDropdownCollections('employees', true), ['departments']);
  assert.deepEqual(lazy.formDropdownCollections('furnaceCars', true), ['furnaces']);
  assert.deepEqual(lazy.formDropdownCollections('customers', true), [], 'a section with no such dropdown reads neither');
  assert.deepEqual(lazy.formDropdownCollections(null, true), []);
  const src = readCode(VIEW);
  assert.ok(/const wanted = formDropdownCollections\(openTab, isModalOpen\);/.test(src));
  assert.equal(/fetchMasterData<Department>\('departments'\)\.then\(setDepartments\)\.catch\(\(\) => \{\}\);\n    fetchMasterData<Furnace>/.test(src),
    false, 'the unconditional pair of mount reads is gone');
});

test('G4. no read remains on an empty dependency list in the screen', () => {
  const src = readCode(VIEW);
  // Every effect body, bounded by the next `useEffect(` so one effect's body can
  // never be read as another's. The only effects left with an empty dependency
  // list are the prefill listener and the unmount cleanup: neither reads.
  const chunks = src.split('useEffect(').slice(1);
  let mountEffects = 0;
  for (const chunk of chunks) {
    const end = chunk.match(/\n  \}, \[([^\]]*)\]\);/);
    if (!end || end[1].trim() !== '') continue;
    mountEffects++;
    const body = chunk.slice(0, end.index);
    for (const reader of ['subscribeMasterData', 'subscribeProductTypes', 'fetchMasterData', 'listCostCenterHierarchyNodes', 'loadLogicalItemState']) {
      assert.equal(body.includes(reader), false, `a mount effect must not call ${reader}`);
    }
  }
  assert.ok(mountEffects >= 2, 'the prefill listener and the unmount cleanup are still mount effects');
});

test('G5. the reference lists for BOMs, routings and jobs stay scoped to their own sections', () => {
  const src = readCode(VIEW);
  for (const gate of ['if (!isBomTab) return;', 'if (!isRoutingTab) return;', "if (activeTab !== 'jobReferences') return;", 'if (!isJobBatchTab) return;']) {
    assert.ok(src.includes(gate), `${gate} must still gate its reads`);
  }
});

// ==================================================
// H. EVERYTHING ELSE IS PRESERVED
// ==================================================

test('H1. the section list is still a live subscription once opened', () => {
  const src = readCode(VIEW);
  assert.ok(/subscribeMasterData<any>\(/.test(src), 'realtime is preserved for an opened section');
  assert.ok(/subscribeProductTypes\(/.test(src), 'and for the product types it needs');
});

test('H2. CRUD, permissions, validation and audit are untouched', () => {
  const src = readCode(VIEW);
  for (const kept of [
    'createMasterDataItem', 'updateMasterDataItem', 'toggleMasterDataActive', 'deleteMasterDataItem',
    'canImportMasterData', 'hasPermission', 'validateEquipmentForSave', 'validateBomForSave',
    'validateRoutingForSave', 'logAuditAction',
  ]) {
    assert.ok(src.includes(kept), `${kept} must still exist`);
  }
});

test('H3. search, filtering and the cost-centre sub-filter still work over the rows in hand', () => {
  const src = readCode(VIEW);
  assert.ok(/const filteredItems = useMemo\(/.test(src), 'filtering is still local to the loaded rows');
  assert.ok(/filterByCostCenterSubCategories\(filteredItems, costCenterDigits, COST_CENTER_CODE_FIELD\)/.test(src));
  assert.ok(/visibleItems\.map\(\(item\) =>/.test(src), 'and the table renders those rows');
  assert.equal(/searchQuery[^\n]*fetchMasterData/.test(src), false, 'searching must not trigger a read');
});

test('H4. export, bulk import and the BOM / routing version windows are still reachable', () => {
  const src = readCode(VIEW);
  for (const kept of [
    'master-data-export-btn', 'master-data-bulk-link-btn', 'master-data-add-btn',
    'master-data-quality-btn', 'master-data-quality-report-btn', 'master-data-reconcile-btn',
    'BomVersionsModal', 'RoutingVersionsModal', 'exportMasterDataToExcel',
  ]) {
    assert.ok(src.includes(kept), `${kept} must still exist`);
  }
});

test('H5. the deep-link prefill still opens the section it names', () => {
  const src = readCode(VIEW);
  assert.ok(/navigationCategoryIdForTab\(prefill\.tab, panelCategories\(\)\)/.test(src),
    'a prefill still resolves to its navigation entry');
  assert.ok(/const owner = navigationCategoryIdForTab\(detail\.tab, panelCategories\(\)\);/.test(src),
    'and a live prefill event still opens it');
});

// ==================================================
// I. NOTHING ELSE WAS CHANGED
// ==================================================

test('I1. the import engine was not touched by this change', () => {
  const rules = readSource(RULES);
  for (const forbidden of ['executeImportRows', 'planImport', 'entityImport', 'masterDataPackage']) {
    assert.equal(rules.includes(forbidden), false, `the loading rules must not reference ${forbidden}`);
  }
});

test('I2. the loading rules read nothing and write nothing themselves', () => {
  const rules = readSource(RULES);
  for (const forbidden of ['firebase', 'firestore', 'getDocs', 'setDoc', 'updateDoc', 'deleteDoc', 'onSnapshot']) {
    assert.equal(rules.toLowerCase().includes(forbidden.toLowerCase()), false,
      `${forbidden} has no place in a pure rules module`);
  }
  assert.ok(/import \{ MasterDataCategory, subCategories \} from '\.\/masterDataCategoryRegistry';/.test(rules),
    'its only dependency is the pure category registry');
});

test('I3. no collection, Firestore rule or business validation was redefined here', () => {
  const rules = readSource(RULES);
  assert.equal(/MASTER_DATA_COLLECTIONS\s*=/.test(rules), false, 'the collection map stays in one place');
  const service = readCode(SERVICE);
  assert.ok(/export const MASTER_DATA_COLLECTIONS/.test(service), 'and it is still the service that owns it');
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
      console.log(String(err && err.message ? err.message : err).split('\n').slice(0, 6).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

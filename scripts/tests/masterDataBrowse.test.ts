/**
 * MASTER DATA BROWSING - ONE SCREEN, SEARCH, LOAD ALL ON REQUEST (3.22.0)
 *
 * THE PROPERTY UNDER TEST: opening a Master Data section reads ONE SCREEN of
 * records, not the collection. The full list - what every section read on open
 * before - is read only when the user presses "Load all data", for the few
 * sections that cannot be paged, or when a save's validation needs every record.
 *
 * AND WHAT MUST NOT WEAKEN: a validation that compares against every record
 * (duplicate codes, one active default, parent cycles) must still receive the
 * FULL list - never a page. Group F proves the save paths bind to the full list.
 *
 * The rules are a pure module and run as shipped; the service and the screen
 * import Firebase, so their wiring is asserted on source with comments stripped,
 * the convention of the other Master Data suites.
 *
 * Run: npx tsx scripts/tests/masterDataBrowse.test.ts
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

console.log('masterDataBrowse.test.ts');

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
/** The body of a `const name = ... => {` function in a source file. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = `);
  assert.ok(start >= 0, `${name} must exist`);
  const open = src.indexOf('{', src.indexOf('=>', start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`${name}: unbalanced body`);
}

const VIEW = 'src/components/masterData/MasterDataView.tsx';
const RULES = 'src/services/masterDataBrowsePure.ts';
const SERVICE = 'src/services/masterDataService.ts';

let b: any;
let reg: any;

async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  b = await load(RULES);
  reg = await load('src/services/masterDataCategoryRegistry.ts');
}

// ==================================================
// A. ONE SCREEN OF ROWS
// ==================================================

test('A1. a page is about one screen: window height / row height, kept between the bounds', () => {
  assert.equal(b.pageSizeForViewport(900), Math.ceil(900 / b.TABLE_ROW_HEIGHT_PX));
  assert.equal(b.pageSizeForViewport(300), b.PAGE_SIZE_MIN, 'a short window still gets a useful page');
  assert.equal(b.pageSizeForViewport(5000), b.PAGE_SIZE_MAX, 'a tall window never turns a page into a bulk read');
  assert.equal(b.pageSizeForViewport(null), b.PAGE_SIZE_MIN);
  assert.equal(b.pageSizeForViewport(Number.NaN), b.PAGE_SIZE_MIN);
  assert.ok(b.PAGE_SIZE_MAX <= 50, 'a page stays small');
});

test('A2. large sections open page by page; hierarchies and the small reference lists open whole', () => {
  for (const tab of ['products', 'materials', 'boms', 'routings', 'customers', 'employees', 'presses', 'jobReferences', 'batches']) {
    assert.equal(b.sectionBrowseMode(tab, reg.categoryForTab(tab)), 'PAGED', `${tab} opens one page at a time`);
  }
  assert.equal(b.sectionBrowseMode('financialAccounts', reg.categoryForTab('financialAccounts')), 'FULL', 'a tree needs its parents');
  assert.equal(b.sectionBrowseMode('costCenterHierarchy', { hierarchical: true }), 'FULL');
  assert.equal(b.sectionBrowseMode('productTypes', reg.categoryForTab('productTypes')), 'FULL');
  assert.equal(b.sectionBrowseMode('stages', reg.categoryForTab('stages')), 'FULL');
});

test('A3. opening a section reads one page and a count - never the whole collection', () => {
  const src = readCode(VIEW);
  const open = functionBody(src, 'loadFirstPage');
  assert.ok(/fetchMasterDataPage<any>\(collectionName, pageSize\)/.test(open), 'one page of pageSize records');
  assert.ok(/countMasterData\(collectionName\)/.test(open), 'and the total, from a count that reads no documents');
  assert.equal(/subscribeMasterData|fetchMasterData</.test(open), false, 'no full read on open');
  // The open effect chooses the page unless the section cannot be paged.
  assert.ok(/if \(mode === 'FULL' \|\| reloadFullRef\.current\.has\(openTab\)\) \{[\s\S]*?attachFullListener\(openTab\);[\s\S]*?return;[\s\S]*?\}\s*void loadFirstPage\(openTab\);/.test(src));
});

test('A4. the page read is bounded, ordered like the old listener, and never cached as the collection', () => {
  const svc = readCode(SERVICE);
  const fn = svc.slice(svc.indexOf('export async function fetchMasterDataPage'), svc.indexOf('export interface MasterDataSearchResult'));
  assert.ok(/orderBy\(documentId\(\)\)/.test(fn), 'document-id order - the order the full listener delivered');
  assert.ok(/limit\(pageSize\)/.test(fn), 'limited to one page');
  assert.ok(/startAfter\(afterId\)/.test(fn), 'the next page continues after the last id');
  assert.equal(/setCachedCollection/.test(fn), false, 'a page must never be cached as the whole collection');
});

test('A5. the table draws one screen at a time, while selection and export still cover every match', () => {
  const src = readCode(VIEW);
  assert.ok(/const renderedItems = useMemo\(\(\) => visibleItems\.slice\(0, renderLimit\)/.test(src));
  assert.ok(/\{renderedItems\.map\(\(item\) =>/.test(src), 'the table body is windowed');
  assert.ok(/setSelectedCodes\(\[\.\.\.new Set\(visibleItems\.map\(codeOfItem\)/.test(src), 'select-all still covers every match');
  assert.ok(/exportMasterDataToExcel\(\s*visibleItems,/.test(src), 'export still covers every match');
});

// ==================================================
// B. SEARCH ASKS THE SERVER
// ==================================================

test('B1. a term is sent as typed, upper and lower case - and not at all below the minimum', () => {
  assert.deepEqual(b.searchTermVariants('bar25'), ['bar25', 'BAR25']);
  assert.deepEqual(b.searchTermVariants('Bar'), ['Bar', 'BAR', 'bar']);
  assert.deepEqual(b.searchTermVariants('  7 '), [], 'one character would match a large share of a collection');
  assert.deepEqual(b.searchTermVariants(''), []);
  assert.deepEqual(b.searchTermVariants(null), []);
});

test('B2. the server search matches the start of the category\'s own search fields', () => {
  assert.deepEqual(b.serverSearchFields(reg.categoryForTab('products')), ['code', 'name']);
  assert.deepEqual(b.serverSearchFields(undefined), ['code', 'name']);
  const cc = b.serverSearchFields({ codeField: 'sheet1Code', searchFields: ['name'] });
  assert.equal(cc[0], 'sheet1Code', 'the code field is always searched');
});

test('B3. the server is asked only for a paged section, and never once the full list is in hand', () => {
  const ask = (over: any) => b.shouldSearchServer({ mode: 'PAGED', fullLoaded: false, term: 'BAR', equalsFilter: null, ...over });
  assert.equal(ask({}), true);
  assert.equal(ask({ fullLoaded: true }), false, 'the local search then matches anywhere');
  assert.equal(ask({ mode: 'FULL' }), false);
  assert.equal(ask({ term: 'B' }), false, 'too short to be selective');
  assert.equal(ask({ term: '', equalsFilter: 'BAR' }), true, 'the product prefix filter alone is selective');
});

test('B4. every server search query is a limited single-field range - no collection read, no index to create', () => {
  const svc = readCode(SERVICE);
  const fn = svc.slice(svc.indexOf('export async function searchMasterDataByPrefix'), svc.indexOf('export async function fetchMasterDataWhereEquals'));
  assert.ok(/where\(field, '>=', v\), where\(field, '<=', `\$\{v\}\\uf8ff`\), limit\(perQueryLimit\)/.test(fn));
  assert.equal(/orderBy/.test(fn), false, 'a range plus another order would need a composite index');
  assert.equal(/setCachedCollection/.test(fn), false);
  const eq = svc.slice(svc.indexOf('export async function fetchMasterDataWhereEquals'), svc.indexOf('export async function fetchMasterDataByField'));
  assert.ok(/where\(field, '==', value\), limit\(max\)/.test(eq), 'the prefix filter is limited too');
});

test('B5. the screen debounces the search, drops stale answers and never waits forever', () => {
  const src = readCode(VIEW);
  assert.ok(/setTimeout\(async \(\) => \{[\s\S]*?searchMasterDataByPrefix<any>\(/.test(src), 'the server is asked after a pause');
  assert.ok(/\}, SEARCH_DEBOUNCE_MS\);/.test(src));
  assert.ok(/if \(seq !== searchSeqRef\.current\) return;/.test(src), 'an answer to an older term is dropped');
  assert.ok(/withTimeout\(searchMasterDataByPrefix/.test(src), 'bounded');
  assert.ok(b.BROWSE_FETCH_TIMEOUT_MS > 0 && b.BROWSE_FETCH_TIMEOUT_MS <= 60_000);
});

test('B6. search results and the pages in hand are merged, each record once, then filtered locally', () => {
  const rows = b.browseRows({
    fullRows: null,
    pageRows: [{ id: 'p1' }, { id: 'p2' }],
    searchRows: [{ id: 's1' }, { id: 'p2' }],
    searchActive: true,
  });
  assert.deepEqual(rows.map((r: any) => r.id), ['s1', 'p2', 'p1']);
  assert.deepEqual(b.browseRows({ fullRows: null, pageRows: [{ id: 'p1' }], searchRows: [{ id: 's1' }], searchActive: false }).map((r: any) => r.id), ['p1']);
  assert.deepEqual(b.browseRows({ fullRows: [{ id: 'f' }], pageRows: [{ id: 'p' }], searchRows: [], searchActive: true }).map((r: any) => r.id), ['f'],
    'once loaded, the full list is the whole truth');
  const src = readCode(VIEW);
  assert.ok(/const filteredItems = useMemo\(\(\) => \{\s*return items\.filter/.test(src), 'the existing local filter still decides what matches');
});

test('B7. the screen says the server search matches the START of a code - it does not pretend otherwise', () => {
  const src = readSource(VIEW);
  assert.ok(src.includes('البحث في قاعدة البيانات يطابق بداية الكود أو الاسم'), 'the scope of the server search');
  assert.ok(src.includes('«تحميل كل البيانات»'), 'and how to search any part of the code');
  assert.ok(/id="master-data-search-scope"/.test(readCode(VIEW)));
});

// ==================================================
// C. MORE, AND LOAD ALL
// ==================================================

test('C1. rows in hand are shown first; the server is asked for a page only after them', () => {
  const m = (over: any) => b.moreAction({ rendered: 20, available: 20, fullLoaded: false, pageExhausted: false, searchActive: false, ...over });
  assert.equal(m({ available: 45 }), 'SHOW_MORE', 'no read while rows in hand are hidden');
  assert.equal(m({}), 'FETCH_PAGE');
  assert.equal(m({ pageExhausted: true }), 'NONE');
  assert.equal(m({ searchActive: true }), 'NONE', 'a search result is not a page of the collection');
  assert.equal(m({ fullLoaded: true }), 'NONE');
});

test('C2. "Load all data" is an explicit button, and it is the full live list', () => {
  const src = readCode(VIEW);
  assert.ok(/id="master-data-load-all-btn"[\s\S]{0,200}onClick=\{handleLoadAll\}/.test(src));
  assert.ok(/const handleLoadAll = \(\) => \{\s*if \(openTab\) attachFullListener\(openTab\);/.test(src));
  const attach = functionBody(src, 'attachFullListener');
  assert.ok(/subscribeMasterData<any>\(\s*MASTER_DATA_COLLECTIONS\[tab\]/.test(attach), 'the existing live listener');
  assert.ok(/if \(listenersRef\.current\.has\(tab\)\) return;/.test(attach), 'attached once per visit');
  assert.ok(src.includes('تحميل كل البيانات'), 'labelled in Arabic');
});

test('C3. "Load more" continues after the last id and appends', () => {
  const src = readCode(VIEW);
  const more = functionBody(src, 'handleLoadMorePage');
  assert.ok(/fetchMasterDataPage<any>\(MASTER_DATA_COLLECTIONS\[tab\], pageSize, afterId\)/.test(more));
  assert.ok(/mergeRowsById\(s\.pageRows, page\.rows\)/.test(more));
  assert.ok(/id="master-data-load-more-btn"/.test(src) && /id="master-data-show-more-btn"/.test(src));
});

test('C4. the total is shown from the count, so a page is never mistaken for the whole section', () => {
  const src = readCode(VIEW);
  assert.ok(/\(section\?\.total \?\? items\.length\)\.toLocaleString\('en-US'\)/.test(src), 'the header count is the total');
  assert.ok(readSource(VIEW).includes('إجمالي السجلات في القاعدة'));
  const svc = readCode(SERVICE);
  assert.ok(/getCountFromServer\(collection\(db, collectionName\)\)/.test(svc), 'a server-side count');
});

// ==================================================
// D. REUSE AND REFRESH
// ==================================================

test('D1. a section opened once keeps what it has - going back reads nothing', () => {
  const src = readCode(VIEW);
  assert.ok(/if \(initializedRef\.current\.has\(openTab\)\) return;/.test(src));
  assert.ok(/\}, \[openTab, sectionReload\]\);/.test(src));
});

test('D2. Refresh drops everything held and reads again - the full list again if it had been loaded', () => {
  const src = readCode(VIEW);
  const body = functionBody(src, 'handleRefreshSection');
  assert.ok(/reloadFullRef\.current\.add\(openTab\)/.test(body));
  assert.ok(/initializedRef\.current\.delete\(openTab\)/.test(body));
  assert.ok(/fullRowsRef\.current\.delete\(openTab\)/.test(body));
  assert.ok(/dropBrowse\(openTab\)/.test(body));
  assert.ok(/setSectionReload\(\(n\) => n \+ 1\)/.test(body));
});

// ==================================================
// E. ROWS STAY CURRENT AFTER A WRITE
// ==================================================

test('E1. a page is not live, so a saved, toggled or deleted row is re-read or dropped', () => {
  const src = readCode(VIEW);
  assert.ok(/void syncRowAfterWrite\(activeTab, savedId, editingItem \? 'update' : 'create'\);/.test(src), 'after a save');
  assert.ok(/void syncRowAfterWrite\(activeTab, item\.id, 'update'\);/.test(src), 'after a status change');
  assert.ok(/void syncRowAfterWrite\(activeTab, deleteConfirmItem\.id,/.test(src), 'after a delete');
  const sync = functionBody(src, 'syncRowAfterWrite');
  assert.ok(/fetchMasterDataItem<any>\(collectionName, id\)/.test(sync), 'one document, not the collection');
  assert.ok(/if \(!id \|\| fullRowsRef\.current\.has\(tab\)/.test(sync), 'a live full list needs nothing');
});

test('E2. upsert replaces in place or adds on top; remove drops', () => {
  const rows = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }];
  assert.deepEqual(b.upsertRowById(rows, { id: 'b', v: 2 }), [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
  assert.deepEqual(b.upsertRowById(rows, { id: 'c', v: 1 }).map((r: any) => r.id), ['c', 'a', 'b']);
  assert.deepEqual(b.removeRowById(rows, 'a').map((r: any) => r.id), ['b']);
  assert.deepEqual(b.mergeRowsById([{ id: 'x' }], null, [{ id: 'x' }, { id: '' }, { id: 'y' }]).map((r: any) => r.id), ['x', 'y']);
});

// ==================================================
// F. VALIDATION IS NOT WEAKENED
// ==================================================

test('F1. every section whose save compares against all records is on the full-list list', () => {
  const src = readCode(VIEW);
  // Each validator that receives `items` belongs to one of these sections.
  const checks: Array<[RegExp, string[]]> = [
    [/validateAccountForSave\(items,/, ['financialAccounts']],
    [/validateOperationForSave\(items\.map\(readOperation\)/, ['stages']],
    [/validateEquipmentForSave\(activeTab, items,/, ['tubeBallMills', 'bunkers', 'rotaryKilns']],
    [/validateJobReferenceForSave\(items,/, ['jobReferences']],
    [/validateBatchForSave\(items,/, ['batches']],
    [/validateBomForSave\(items,/, ['boms']],
    [/validateRoutingForSave\(items,/, ['routings']],
  ];
  for (const [pattern, tabs] of checks) {
    assert.ok(pattern.test(src), `${pattern} must still receive items`);
    for (const tab of tabs) assert.equal(b.saveNeedsFullList(tab), true, `${tab} must save against the full list`);
  }
  assert.equal(b.saveNeedsFullList('products'), false, 'products save through the service\'s own duplicate lookup');
});

test('F2. save and status change bind `items` to the FULL list for those sections - never the page', () => {
  const src = readCode(VIEW);
  for (const fn of ['handleSave', 'handleToggleStatus']) {
    const body = functionBody(src, fn);
    assert.ok(/const items = saveNeedsFullList\(activeTab\) \? await ensureFullRows\(activeTab\) : loadedItems;/.test(body),
      `${fn} must compare against the full list`);
    const bind = body.indexOf('const items = ');
    const firstUse = body.search(/validate\w+\(|items\.map\(readOperation\)/);
    assert.ok(firstUse < 0 || bind < firstUse, `${fn}: the binding comes before any validation`);
  }
});

test('F3. the full list for a save is waited for with a bound, and a failure refuses the save', () => {
  const src = readCode(VIEW);
  const body = functionBody(src, 'ensureFullRows');
  assert.ok(/fullRowsRef\.current\.get\(tab\)/.test(body), 'a list already in hand is used directly');
  assert.ok(/\}, FULL_LIST_WAIT_MS\);/.test(body), 'bounded');
  assert.ok(/attachFullListener\(tab\)/.test(body));
  assert.ok(/reject\(new Error\(/.test(body), 'refused with a reason, never saved against less');
});

test('F4. "Analyze current codes" still analyses EVERY product', () => {
  const src = readCode(VIEW);
  const body = functionBody(src, 'handleOpenAnalyzeCodes');
  assert.ok(/items = await ensureFullRows\('products'\);/.test(body));
});

// ==================================================
// G. NOTHING ELSE CHANGED
// ==================================================

test('G1. the rules module is pure', () => {
  const rules = readSource(RULES);
  for (const forbidden of ['firebase', 'getDocs', 'onSnapshot', 'setDoc', 'updateDoc', 'deleteDoc']) {
    assert.equal(rules.includes(forbidden), false, `${forbidden} does not belong in the rules`);
  }
});

test('G2. the new service reads are read-only', () => {
  const svc = readCode(SERVICE);
  const block = svc.slice(svc.indexOf('export async function fetchMasterDataPage'), svc.indexOf('export async function addMasterDataItem') > 0 ? svc.indexOf('export async function addMasterDataItem') : undefined);
  const reads = block.slice(0, block.indexOf('export async function fetchMasterDataItem') + 400);
  for (const write of ['addDoc', 'updateDoc', 'deleteDoc', 'safeAddDoc', 'safeUpdateDoc', 'setCachedCollection', 'invalidateCachedCollection']) {
    assert.equal(reads.includes(write), false, `${write} must not appear in the browse reads`);
  }
});

test('G3. the import engine is untouched', () => {
  const rules = readSource(RULES);
  for (const name of ['executeImportRows', 'entityImport', 'masterDataPackage']) {
    assert.equal(rules.includes(name), false);
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
      console.log(String(err && err.message ? err.message : err).split('\n').slice(0, 6).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

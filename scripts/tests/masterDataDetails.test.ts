/**
 * MASTER DATA DETAILS, SECTION ORDER AND PRINT BRANDING (3.23.0)
 *
 * - Under Products the sections read Routing, BOM, Products - in that order -
 *   while opening Products still lands on the Products list.
 * - A double-click on a row opens it in full: a BOM opens its versions window
 *   with the ACTIVE version's components on screen (printable from there), a
 *   routing its active version's steps, any other record its details. A
 *   double-click on a control inside the row is left alone.
 * - The printed mixture carries the company logo at the top left and a footer
 *   on every page: the developer on the right, Finance & Costing in the centre,
 *   in small but legible type.
 *
 * Pure rules run as shipped; the screens import Firebase, so their wiring is
 * asserted on source with comments stripped.
 *
 * Run: npx tsx scripts/tests/masterDataDetails.test.ts
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

console.log('masterDataDetails.test.ts');

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

const VIEW = 'src/components/masterData/MasterDataView.tsx';
const BOM_MODAL = 'src/components/masterData/BomVersionsModal.tsx';
const ROUTING_MODAL = 'src/components/masterData/RoutingVersionsModal.tsx';
const DETAILS_MODAL = 'src/components/masterData/RecordDetailsModal.tsx';
const RULES = 'src/services/masterDataDetailsPure.ts';

let d: any;
let reg: any;
let lazy: any;
let panels: any;
let print: any;

async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  d = await load(RULES);
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  lazy = await load('src/services/masterDataLazyLoadPure.ts');
  panels = await load('src/services/masterDataPanelsPure.ts');
  print = await load('src/services/bomPrintPure.ts');
}

// ==================================================
// A. SECTION ORDER UNDER PRODUCTS
// ==================================================

test('A1. under Products the sections read Products, BOM, Routing (3.24.1)', () => {
  assert.deepEqual(reg.subCategories('products').map((c: any) => c.tab), ['products', 'boms', 'routings']);
});

test('A2. clicking Products opens on Routing, not on Products (3.24.1)', () => {
  const nav = panels.panelCategories();
  assert.equal(reg.getCategory('products').defaultSubCategoryTab, 'routings');
  // Coming from another section, the group opens on its default: Routing.
  assert.equal(lazy.resolveOpenTab({ activeCategoryId: 'products', activeTab: 'customers' }, nav), 'routings');
  // The button sets it explicitly, in the same render as the category, so only Routing is read.
  const view = readCode(VIEW);
  assert.ok(/setActiveCategoryId\(category\.id\);\s*if \(category\.defaultSubCategoryTab\) setActiveTab\(category\.defaultSubCategoryTab as MasterDataTab\);/.test(view));
  // A section chosen inside the group stays chosen.
  assert.equal(lazy.resolveOpenTab({ activeCategoryId: 'products', activeTab: 'boms' }, nav), 'boms');
  assert.equal(lazy.resolveOpenTab({ activeCategoryId: 'products', activeTab: 'products' }, nav), 'products');
});

test('A3. groups without a default keep their behaviour - Equipment still opens on its own tab', () => {
  const nav = panels.panelCategories();
  const equipment = reg.getCategory('equipment');
  assert.equal(equipment.defaultSubCategoryTab, undefined);
  assert.equal(lazy.resolveOpenTab({ activeCategoryId: 'equipment', activeTab: 'customers' }, nav), equipment.tab);
});

// ==================================================
// B. DOUBLE-CLICK
// ==================================================

test('B1. every row opens on double-click', () => {
  const src = readCode(VIEW);
  assert.ok(/onDoubleClick=\{\(e\) => handleRowDoubleClick\(e, item\)\}/.test(src));
  assert.ok(readSource(VIEW).includes('انقر نقرًا مزدوجًا لعرض التفاصيل'), 'the row says so');
  assert.ok(/id="master-data-double-click-hint"/.test(src), 'and so does the footer');
});

test('B2. a BOM opens with its components; a routing with its steps; anything else its details', () => {
  const src = readCode(VIEW);
  const at = src.indexOf('const handleRowDoubleClick');
  const body = src.slice(at, src.indexOf('const resolveDetailValue', at));
  assert.ok(/if \(activeTab === 'boms'\) \{\s*setOpenVersionOnLoad\(true\);\s*setBomForVersions\(item\);/.test(body));
  assert.ok(/if \(activeTab === 'routings'\) \{\s*setOpenVersionOnLoad\(true\);\s*setRoutingForVersions\(item\);/.test(body));
  assert.ok(/setDetailsItem\(item\);/.test(body));
});

test('B3. a double-click on the checkbox or an action button is left alone', () => {
  const src = readCode(VIEW);
  assert.ok(/\?\.closest\?\.\(ROW_CONTROL_SELECTOR\)\) return;/.test(src));
  for (const control of ['input', 'button', 'select', 'a', 'label']) {
    assert.ok(d.ROW_CONTROL_SELECTOR.split(',').map((s: string) => s.trim()).includes(control), `${control} is a control`);
  }
});

test('B4. the row\'s own versions buttons still open the plain list', () => {
  const src = readCode(VIEW);
  assert.ok(/onClick=\{\(\) => \{ setOpenVersionOnLoad\(false\); setBomForVersions\(item\); \}\}/.test(src));
  assert.ok(/onClick=\{\(\) => \{ setOpenVersionOnLoad\(false\); setRoutingForVersions\(item\); \}\}/.test(src));
});

test('B5. the version opened first is the ACTIVE one, else the newest', () => {
  const v = (id: string, status: string, createdAt: string) => ({ id, status, createdAt });
  assert.equal(d.versionToShowFirst([v('a', 'RETIRED', '2026-01'), v('b', 'ACTIVE', '2026-02'), v('c', 'DRAFT', '2026-03')]).id, 'b');
  assert.equal(d.versionToShowFirst([v('a', 'RETIRED', '2026-01'), v('c', 'DRAFT', '2026-03')]).id, 'c', 'no active: the newest');
  assert.equal(d.versionToShowFirst([v('a', 'ACTIVE', '2026-01'), v('b', 'active', '2026-05')]).id, 'b', 'two active: the newest of them');
  assert.equal(d.versionToShowFirst([]), null);
});

test('B6. both versions windows open that version as soon as the list arrives - only when asked', () => {
  for (const file of [BOM_MODAL, ROUTING_MODAL]) {
    const src = readCode(file);
    assert.ok(/openVersionOnLoad\?: boolean;/.test(src), `${file}: the prop`);
    assert.ok(/openOnLoadRef\.current = Boolean\(openVersionOnLoad\);/.test(src), `${file}: read when the window opens`);
    assert.ok(/if \(openOnLoadRef\.current\) \{\s*openOnLoadRef\.current = false;\s*const first = versionToShowFirst\(list\);/.test(src),
      `${file}: consumed by the load, once`);
  }
  const view = readCode(VIEW);
  assert.equal((view.match(/openVersionOnLoad=\{openVersionOnLoad\}/g) || []).length, 2, 'both windows receive it');
});

test('B7. from the opened BOM the mixture can be printed', () => {
  const src = readCode(BOM_MODAL);
  assert.ok(/id="bom-print-btn"/.test(src), 'the print button is in the opened version');
});

// ==================================================
// C. THE DETAILS WINDOW
// ==================================================

test('C1. identity first, everything else alphabetically, bookkeeping last', () => {
  const fields = d.recordDetailFields({
    id: 'x1', updatedAt: '2026-01-02', active: true, weight: 4.5, code: 'BAR25', dimensions: '230x114x65', name: 'Brick',
    codeNormalized: 'bar25', nameNormalized: 'brick', __categoryId: 'products',
  }, 'ar');
  assert.deepEqual(fields.map((f: any) => f.key), ['code', 'name', 'dimensions', 'weight', 'active', 'updatedAt', 'id']);
});

test('C2. only the search-index copies are hidden - nothing the user could need', () => {
  assert.equal(d.isSearchIndexField('codeNormalized'), true);
  assert.equal(d.isSearchIndexField('code'), false);
  const fields = d.recordDetailFields({ code: 'A', someUnusualField: 7 }, 'en');
  assert.ok(fields.some((f: any) => f.key === 'someUnusualField' && f.labelEn === 'someUnusualField' && f.value === '7'),
    'an unknown field is shown under its own key');
});

test('C3. values read as people read them', () => {
  assert.equal(d.formatDetailValue(true, 'ar').text, 'نعم');
  assert.equal(d.formatDetailValue(false, 'en').text, 'No');
  assert.equal(d.formatDetailValue(1234.5, 'ar').text, '1,234.5');
  assert.equal(d.formatDetailValue(null, 'ar').text, '-');
  // Shown in the viewer's own time zone, like a clock.
  assert.equal(d.formatDetailValue({ seconds: 0, nanoseconds: 0 }, 'ar').text, d.localDateTime(new Date(0)), 'a stored timestamp');
  const read = new Date(2026, 8, 28, 10, 30);
  assert.equal(d.formatDetailValue({ toDate: () => read }, 'ar').text, '2026-09-28 10:30', 'a read timestamp');
  const nested = d.formatDetailValue({ odoo: { id: 5 } }, 'ar');
  assert.equal(nested.block, true);
  assert.ok(nested.text.includes('"odoo"'));
});

test('C4. an id is shown as the label the table shows, when the caller can resolve it', () => {
  const fields = d.recordDetailFields({ code: 'J1', customerId: 'c9' }, 'ar', (key: string) => (key === 'customerId' ? 'C-009 - Acme' : null));
  assert.equal(fields.find((f: any) => f.key === 'customerId').value, 'C-009 - Acme');
  assert.equal(fields.find((f: any) => f.key === 'customerId').labelAr, 'العميل');
});

test('C5. the details window is read-only and reads nothing', () => {
  const src = readCode(DETAILS_MODAL);
  for (const forbidden of ['fetchMasterData', 'updateMasterDataItem', 'createMasterDataItem', 'deleteMasterDataItem', 'onSnapshot', 'firebase']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} has no place in the details window`);
  }
  assert.ok(/recordDetailFields\(record,/.test(src));
  const view = readCode(VIEW);
  assert.ok(/<RecordDetailsModal[\s\S]{0,200}record=\{detailsItem\}/.test(view));
});

// ==================================================
// D. PRINT BRANDING
// ==================================================

const model = (over: any = {}) => print.buildBomPrintModel({
  language: 'ar', bom: { code: 'B1', name: 'n', itemSource: 'products', itemId: 'p' },
  version: { versionCode: 'V1', status: 'ACTIVE', components: [] },
  itemLabel: () => 'x', customerLabel: 'c', printedAt: 'now', ...over,
});

test('D1. the company logo is printed at the top left', () => {
  const html = print.bomPrintHtml(model({ logoUrl: 'https://erp.example/branding/company-logo.png' }));
  assert.ok(/<img class="logo" id="bom-print-logo" src="https:\/\/erp\.example\/branding\/company-logo\.png"/.test(html));
  assert.ok(html.indexOf('id="bom-print-logo"') < html.indexOf('</header>'), 'inside the page header');
  // Right to left: the titles take the start (right), the logo is pushed to the left.
  assert.ok(/header \.logo \{[^}]*order: 2; margin-inline-start: auto;/.test(html));
  assert.ok(/html\[dir="ltr"\] header \.logo \{[^}]*order: -1;/.test(html), 'and on the left in English too');
  assert.equal(print.bomPrintHtml(model()).includes('id="bom-print-logo"'), false, 'no logo address, no broken image');
});

test('D2. the logo printed is the one the app shows, loaded before the dialog opens', () => {
  const src = readCode(BOM_MODAL);
  assert.ok(/logoSrc = useBranding\(\)\.companyLogoSrc \|\| ORIGINAL_LOGO_SRC;/.test(src));
  assert.ok(/logoUrl: new URL\(logoSrc, window\.location\.href\)\.href,/.test(src), 'as an absolute address');
  assert.ok(/Array\.from\(doc\.images\)/.test(src) && /setTimeout\(done, 3000\)/.test(src), 'waited for, at most 3 s');
});

test('D3. the footer: developer on the right, Finance & Costing in the centre, on every page', () => {
  const html = print.bomPrintHtml(model());
  assert.ok(html.includes('id="bom-print-footer"'));
  assert.ok(html.includes('إدارة المالية والتكاليف'));
  assert.ok(html.includes(print.PRINT_FOOTER_DEVELOPER) && print.PRINT_FOOTER_DEVELOPER === 'Developed by MHDIAB');
  assert.ok(/footer \{ position: fixed; bottom: 0;[^}]*direction: ltr;/.test(html), 'fixed - repeated on every printed page - and laid out left to right');
  assert.ok(/<footer id="bom-print-footer">\s*<span><\/span>\s*<span class="department"[^>]*>[^<]+<\/span>\s*<span class="developer">/.test(html),
    'left empty, department centre, developer right');
  assert.ok(/footer \.developer \{ justify-self: end; \}/.test(html));
  assert.ok(/footer \.department \{ justify-self: center;/.test(html));
  const size = Number((html.match(/footer \{[^}]*font-size: ([\d.]+)px/) || [])[1]);
  assert.ok(size >= 8 && size <= 10, `small but legible (${size}px)`);
  assert.ok(/padding-bottom: 26px/.test(html), 'the page keeps room so the footer covers nothing');
  assert.ok(print.bomPrintHtml(model({ language: 'en' })).includes('Finance &amp; Costing Department'));
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

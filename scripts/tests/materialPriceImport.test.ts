/**
 * MATERIAL PRICE IMPORT FROM EXCEL (3.25.0)
 *
 * THE PROPERTIES UNDER TEST:
 * - a row is matched to exactly ONE material by code; not found, found twice
 *   in Master Data, or repeated in the file is an error - never a guess;
 * - an empty price cell leaves the price as it is; a filled one must be a
 *   number >= 0 (separators, currency words, Arabic-Indic digits read);
 * - the unit, when given, must be approved (a known spelling is accepted);
 * - only READY rows are written, with ONLY the changed price fields, the date
 *   and the source EXCEL_IMPORT - never a code, a name or a unit;
 * - the template round-trips: download it, fill it, import it back;
 * - the screen writes through the shared audited service, one bounded write at
 *   a time, behind the existing edit gate.
 *
 * The workbook round-trip uses the same xlsx library and the same
 * sheet_to_json({ defval: '' }) call the shared reader (parseImportFile) makes.
 *
 * Run: npx tsx scripts/tests/materialPriceImport.test.ts
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

console.log('materialPriceImport.test.ts');

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

const RULES = 'src/services/materialPriceImportPure.ts';
const MODAL = 'src/components/masterData/MaterialPriceImportModal.tsx';
const VIEW = 'src/components/masterData/MasterDataView.tsx';

let p: any;
let XLSX: any;

async function bootstrap() {
  p = await import(pathToFileURL(path.join(ROOT, RULES)).href);
  const mod: any = await import(pathToFileURL(path.join(ROOT, 'node_modules/xlsx/xlsx.js')).href);
  XLSX = mod.default ?? mod;
}

const MATERIALS = [
  { id: 'm1', code: 'M-ALU60', name: 'Alumina 60', unit: 'طن', lastPurchasePrice: 18000, averageIssuePrice: 17250 },
  { id: 'm2', code: 'M-CR', name: 'Chromite', unit: 'طن' },
  { id: 'm3', code: 'M-BND', name: 'Binder', unit: 'كجم', priceUnit: 'كجم', lastPurchasePrice: 25 },
  { id: 'd1', code: 'DUP', name: 'Twin A', unit: 'طن' },
  { id: 'd2', code: 'dup', name: 'Twin B', unit: 'طن' },
];
const MAP = { code: 'code', lastPurchasePrice: 'last', averageIssuePrice: 'avg', priceUnit: 'unit' };
const NOW = '2026-09-28T12:00:00.000Z';
const plan = (rows: any[], mapping: any = MAP) => p.planPriceImport(rows, mapping, MATERIALS, NOW);

// ==================================================
// A. COLUMNS
// ==================================================

test('A1. Arabic and English headers are recognised, whatever their case, spacing or alef form', () => {
  assert.deepEqual(p.detectPriceColumns(['كود الخامة', 'اسم الخامة', 'اخر سعر شراء', 'متوسط سعر المنصرف', 'وحدة السعر']), {
    code: 'كود الخامة', lastPurchasePrice: 'اخر سعر شراء', averageIssuePrice: 'متوسط سعر المنصرف', priceUnit: 'وحدة السعر',
  });
  assert.deepEqual(p.detectPriceColumns(['Material Code', 'Last Purchase Price', 'Average Cost']), {
    code: 'Material Code', lastPurchasePrice: 'Last Purchase Price', averageIssuePrice: 'Average Cost',
  });
  assert.equal(p.detectPriceColumns(['Name', 'Qty']).code, undefined, 'nothing is guessed');
});

test('A2. a sheet column is used for one field only', () => {
  const m = p.detectPriceColumns(['code', 'unit']);
  assert.equal(m.code, 'code');
  assert.equal(m.priceUnit, 'unit');
});

// ==================================================
// B. CELLS
// ==================================================

test('B1. prices are read as people write them; anything else is refused', () => {
  assert.equal(p.parsePriceCell(18500), 18500);
  assert.equal(p.parsePriceCell('18,500.50'), 18500.5);
  assert.equal(p.parsePriceCell('18500 ج.م'), 18500);
  assert.equal(p.parsePriceCell('١٨٥٠٠'), 18500, 'Arabic-Indic digits');
  assert.equal(p.parsePriceCell('١٨٬٥٠٠٫٥'), 18500.5, 'Arabic separators');
  assert.equal(p.parsePriceCell(''), null, 'empty = leave as it is');
  assert.equal(p.parsePriceCell(null), null);
  assert.ok(Number.isNaN(p.parsePriceCell('about 18k')));
  assert.equal(p.parsePriceCell(0), 0, 'zero is a price');
});

// ==================================================
// C. THE PLAN
// ==================================================

test('C1. a READY row writes only the changed prices, the date and the source', () => {
  const r = plan([{ code: 'm-alu60', last: '19000', avg: '17250', unit: '' }]).rows[0];
  assert.equal(r.status, 'READY');
  assert.equal(r.materialId, 'm1', 'matched case-insensitively');
  assert.deepEqual(r.patch, { lastPurchasePrice: 19000, pricesUpdatedAt: NOW, pricesSource: 'EXCEL_IMPORT' },
    'the average did not change, the unit was not given - neither is written');
  for (const k of ['code', 'name', 'unit', 'active']) assert.equal(k in r.patch, false, `${k} is never written`);
});

test('C2. an empty price cell leaves that price as it is', () => {
  const r = plan([{ code: 'M-ALU60', last: '', avg: '17000', unit: '' }]).rows[0];
  assert.equal(r.next.lastPurchasePrice, 18000);
  assert.deepEqual(Object.keys(r.patch).sort(), ['averageIssuePrice', 'pricesSource', 'pricesUpdatedAt']);
});

test('C3. a row that changes nothing is UNCHANGED and writes nothing', () => {
  const r = plan([{ code: 'M-ALU60', last: 18000, avg: 17250, unit: '' }]).rows[0];
  assert.equal(r.status, 'UNCHANGED');
  assert.deepEqual(r.patch, {});
});

test('C4. every code problem is an error, never a guess', () => {
  const res = plan([
    { code: '', last: '1', avg: '', unit: '' },
    { code: 'NOPE', last: '1', avg: '', unit: '' },
    { code: 'DUP', last: '1', avg: '', unit: '' },
    { code: 'M-CR', last: '9000', avg: '', unit: '' },
    { code: 'm-cr', last: '9100', avg: '', unit: '' },
  ]);
  assert.deepEqual(res.rows.map((r: any) => r.errors[0]), ['CODE_MISSING', 'CODE_NOT_FOUND', 'CODE_AMBIGUOUS', 'DUPLICATE_IN_FILE', 'DUPLICATE_IN_FILE']);
  assert.equal(res.ready, 0);
  assert.ok(res.rows.every((r: any) => Object.keys(r.patch).length === 0), 'an error row writes nothing');
});

test('C5. bad prices, no price and an unknown unit are refused', () => {
  const res = plan([
    { code: 'M-CR', last: '-5', avg: '', unit: '' },
    { code: 'M-BND', last: 'x', avg: '', unit: '' },
    { code: 'M-ALU60', last: '', avg: '', unit: '' },
  ]);
  assert.deepEqual(res.rows.map((r: any) => r.errors), [['INVALID_LAST_PRICE'], ['INVALID_LAST_PRICE'], ['NO_PRICE']]);
  const unit = plan([{ code: 'M-CR', last: '9000', avg: '', unit: 'bucket' }]).rows[0];
  assert.deepEqual(unit.errors, ['INVALID_UNIT']);
});

test('C6. the unit is written only when it changes the unit the prices are read in', () => {
  // M-CR reads its prices per its own unit (طن): giving طن again changes nothing about the unit.
  const same = plan([{ code: 'M-CR', last: '9000', avg: '8800', unit: 'طن' }]).rows[0];
  assert.equal('priceUnit' in same.patch, false);
  assert.equal(same.patch.lastPurchasePrice, 9000);
  const other = plan([{ code: 'M-CR', last: '9', avg: '', unit: 'كجم' }]).rows[0];
  assert.equal(other.patch.priceUnit, 'كجم', 'a different unit is written');
  const bag = p.planPriceImport([{ code: 'B1', last: '300', avg: '', unit: 'شيكارة' }], MAP, [{ id: 'b1', code: 'B1', unit: 'طن' }], NOW).rows[0];
  assert.equal(bag.patch.priceUnit, 'شكارة', 'a legacy spelling becomes the approved one');
});

test('C7. rows are numbered as in the sheet (header = row 1) and counted', () => {
  const res = plan([{ code: 'M-CR', last: '1', avg: '', unit: '' }, { code: 'NOPE', last: '1', avg: '', unit: '' }]);
  assert.deepEqual(res.rows.map((r: any) => r.rowNumber), [2, 3]);
  assert.deepEqual([res.ready, res.errors, res.unchanged], [1, 1, 0]);
});

// ==================================================
// D. TEMPLATE ROUND TRIP
// ==================================================

test('D1. download the template, fill a price, import it back: exactly that price changes', () => {
  const template = p.priceTemplateRows(MATERIALS.slice(0, 3), 'ar');
  // The user types a new average price for the chromite.
  const cr = template.find((r: any) => r['كود الخامة'] === 'M-CR');
  cr['متوسط سعر المنصرف'] = 8800;
  const ws = XLSX.utils.json_to_sheet(template);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'أسعار الخامات');
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  // The same read the shared parseImportFile makes.
  const back = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { defval: '' });
  const mapping = p.detectPriceColumns(Object.keys(rows[0]));
  assert.deepEqual(Object.keys(mapping).sort(), ['aluminaPercentage', 'averageIssuePrice', 'code', 'lastPurchasePrice', 'origin', 'priceUnit'], 'every column recognised');
  const res = p.planPriceImport(rows, mapping, MATERIALS, NOW);
  const ready = res.rows.filter((r: any) => r.status === 'READY');
  assert.equal(ready.length, 1, 'only the edited row');
  assert.equal(ready[0].code, 'M-CR');
  assert.equal(ready[0].patch.averageIssuePrice, 8800);
  assert.equal(res.errors, 0);
});

test('D2. the English template is recognised too', () => {
  const rows = p.priceTemplateRows(MATERIALS.slice(0, 1), 'en');
  assert.deepEqual(Object.keys(p.detectPriceColumns(Object.keys(rows[0]))).sort(), ['aluminaPercentage', 'averageIssuePrice', 'code', 'lastPurchasePrice', 'origin', 'priceUnit']);
});

// ==================================================
// F. ALUMINA AND LOCAL / IMPORTED (3.26.0)
// ==================================================

const AMAP = { code: 'code', aluminaPercentage: 'al', origin: 'org' };

test('F1. alumina and origin headers are recognised, with or without %', () => {
  assert.deepEqual(p.detectPriceColumns(['كود الخامة', 'نسبة الألومينا %', 'محلي / مستورد']), {
    code: 'كود الخامة', aluminaPercentage: 'نسبة الألومينا %', origin: 'محلي / مستورد',
  });
  assert.deepEqual(p.detectPriceColumns(['Code', 'Alumina', 'Origin']), { code: 'Code', aluminaPercentage: 'Alumina', origin: 'Origin' });
});

test('F2. alumina cells: "36", "36%", Arabic digits read; outside 0-100 or text refused; empty leaves it', () => {
  assert.equal(p.parseAluminaCell(36), 36);
  assert.equal(p.parseAluminaCell('36.5 %'), 36.5);
  assert.equal(p.parseAluminaCell('٤٥٪'), 45);
  assert.equal(p.parseAluminaCell(''), null);
  assert.ok(Number.isNaN(p.parseAluminaCell('high')));
  const res = p.planPriceImport([{ code: 'M-CR', al: '120', org: '' }, { code: 'M-BND', al: 'x', org: '' }], AMAP, MATERIALS, NOW);
  assert.deepEqual(res.rows.map((r: any) => r.errors), [['INVALID_ALUMINA'], ['INVALID_ALUMINA']]);
});

test('F3. origin cells: Arabic, English and short forms; anything else refused', () => {
  for (const v of ['محلي', 'محلية', 'Local', 'LOCAL', 'L']) assert.equal(p.parseOriginCell(v), 'LOCAL', v);
  for (const v of ['مستورد', 'مستوردة', 'Imported', 'IMPORT', 'i']) assert.equal(p.parseOriginCell(v), 'IMPORTED', v);
  assert.equal(p.parseOriginCell(''), null);
  assert.equal(p.parseOriginCell('China'), 'INVALID');
  const r = p.planPriceImport([{ code: 'M-CR', al: '', org: 'Egypt' }], AMAP, MATERIALS, NOW).rows[0];
  assert.deepEqual(r.errors, ['INVALID_ORIGIN']);
});

test('F4. only the changed alumina / origin is written - and the PRICE date is not stamped for them', () => {
  const r = p.planPriceImport([{ code: 'M-CR', al: '12', org: 'مستورد' }], AMAP, MATERIALS, NOW).rows[0];
  assert.equal(r.status, 'READY');
  assert.deepEqual(r.patch, { aluminaPercentage: 12, origin: 'IMPORTED' }, 'no pricesUpdatedAt / pricesSource without a price change');
  const same = p.planPriceImport([{ code: 'M-CR', al: '12', org: 'مستورد' }], AMAP,
    [{ id: 'm2', code: 'M-CR', unit: 'طن', aluminaPercentage: 12, origin: 'IMPORTED' }], NOW).rows[0];
  assert.equal(same.status, 'UNCHANGED');
});

test('F5. prices and attributes in one row: both written, the price date only because a price changed', () => {
  const r = p.planPriceImport([{ code: 'M-CR', last: '9000', al: '12', org: 'محلي' }],
    { code: 'code', lastPurchasePrice: 'last', aluminaPercentage: 'al', origin: 'org' }, MATERIALS, NOW).rows[0];
  assert.deepEqual(r.patch, { lastPurchasePrice: 9000, pricesUpdatedAt: NOW, pricesSource: 'EXCEL_IMPORT', aluminaPercentage: 12, origin: 'LOCAL' });
});

test('F6. a row with no price, alumina or origin is "nothing to import"', () => {
  const r = p.planPriceImport([{ code: 'M-CR', al: '', org: '' }], AMAP, MATERIALS, NOW).rows[0];
  assert.deepEqual(r.errors, ['NO_PRICE']);
});

test('F7. the template carries alumina and origin, and filling them round-trips', () => {
  const template = p.priceTemplateRows([{ id: 'm2', code: 'M-CR', name: 'Chromite', unit: 'طن' }], 'ar');
  template[0]['نسبة الألومينا %'] = 12;
  template[0]['محلي / مستورد'] = 'مستورد';
  const ws = XLSX.utils.json_to_sheet(template);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'x');
  const back = XLSX.read(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), { type: 'array' });
  const rows = XLSX.utils.sheet_to_json(back.Sheets[back.SheetNames[0]], { defval: '' });
  const res = p.planPriceImport(rows, p.detectPriceColumns(Object.keys(rows[0])), [{ id: 'm2', code: 'M-CR', unit: 'طن' }], NOW);
  assert.deepEqual(res.rows[0].patch, { aluminaPercentage: 12, origin: 'IMPORTED' });
  // An existing origin is written back as a word the import reads.
  const t2 = p.priceTemplateRows([{ id: 'm1', code: 'A', unit: 'طن', origin: 'LOCAL', aluminaPercentage: 60 }], 'en');
  assert.equal(t2[0]['Local / Imported'], 'Local');
  assert.equal(t2[0]['Alumina %'], 60);
});

test('F8. the screen accepts a sheet with only alumina / origin columns', () => {
  const src = readCode(MODAL);
  assert.ok(/!DATA_COLUMNS\.some\(\(c\) => mapping\[c\]\)/.test(src));
  assert.deepEqual([...p.DATA_COLUMNS], ['lastPurchasePrice', 'averageIssuePrice', 'aluminaPercentage', 'origin']);
});

// ==================================================
// E. THE SCREEN
// ==================================================

test('E1. reads with the shared reader, writes with the shared audited service, bounded, behind the edit gate', () => {
  const src = readCode(MODAL);
  assert.ok(/import \{ listImportSheetNames, parseImportFile \} from '\.\.\/\.\.\/services\/bulkImportService';/.test(src));
  assert.ok(/await withTimeout\(updateMasterDataItem\(MASTER_DATA_COLLECTIONS\.materials, row\.materialId as string, row\.patch\), 30_000\);/.test(src));
  assert.ok(/plan\.rows\.filter\(\(r\) => r\.status === 'READY' && r\.materialId\)/.test(src), 'only READY rows are written');
  assert.ok(/if \(!canImport \|\| !plan \|\| mappingIssue \|\| plan\.ready === 0\) return;/.test(src), 'gated');
  assert.ok(/window\.confirm\(/.test(src), 'confirmed before writing');
  assert.ok(/logAuditAction\(\s*'BULK_IMPORT',/.test(src), 'one summary line in the audit log');
  for (const forbidden of ['setDoc', 'updateDoc(', 'writeBatch', 'deleteMasterDataItem', 'createMasterDataItem']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not be used`);
  }
  const view = readCode(VIEW);
  assert.ok(/<MaterialPriceImportModal[\s\S]{0,200}canImport=\{canImportMasterData\}/.test(view), 'the existing Master Data edit gate');
  assert.ok(/id="master-data-material-price-import-btn"/.test(view));
});

test('E2. the rules module is pure', () => {
  const src = readSource(RULES);
  for (const forbidden of ['firebase', 'getDocs', 'updateDoc', 'setDoc', 'updateMasterDataItem', 'xlsx']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} does not belong in the rules`);
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

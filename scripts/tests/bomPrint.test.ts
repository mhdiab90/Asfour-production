/**
 * BOM PRINT (3.22.0)
 *
 * THE PROPERTY UNDER TEST: the printed mixture is the version as the BOM
 * versions window shows it - the same lines in the same order, the same
 * percentages, quantities and units, the same Base / Additives / Total Applied
 * summary - because it is computed by the same bomPure functions. And printing
 * is read-only: it builds a document and hands it to the browser, nothing else.
 *
 * The print builder is pure and runs as shipped; the window imports Firebase,
 * so its wiring is asserted on source with comments stripped.
 *
 * Run: npx tsx scripts/tests/bomPrint.test.ts
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

console.log('bomPrint.test.ts');

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

const PRINT = 'src/services/bomPrintPure.ts';
const MODAL = 'src/components/masterData/BomVersionsModal.tsx';
const BOM_SERVICE = 'src/services/bomService.ts';

let p: any;
let bomPure: any;

async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  p = await load(PRINT);
  bomPure = await load('src/services/bomPure.ts');
}

const BOM = { id: 'bom1', code: 'BOM-CHR36', name: 'Chrome brick 36', itemSource: 'products', itemId: 'p1' };
const LABELS: Record<string, string> = { 'products:p1': 'CHR36 - Chrome brick', 'materials:m1': 'M-ALU - Alumina', 'materials:m2': 'M-CR - Chromite', 'materials:m3': 'M-BND - Binder' };
const itemLabel = (source: string, id: string) => LABELS[`${source}:${id}`] ?? id;

/** A version with a basis, two base lines (one by percentage, one by quantity), and an additive. */
const VERSION = {
  bomId: 'bom1',
  versionCode: 'V1',
  status: 'ACTIVE',
  effectiveFrom: '2026-01-01',
  basisQuantity: 1000,
  basisUnit: 'كجم',
  expectedYieldPercent: 97.5,
  notes: 'Mix 10 minutes',
  components: [
    { lineId: 'L2', componentType: 'BASE', itemSource: 'materials', itemId: 'm2', quantity: 400, unit: 'كجم', sequence: 2, notes: '' },
    { lineId: 'L1', componentType: 'BASE', itemSource: 'materials', itemId: 'm1', percentage: 60, unit: 'كجم', sequence: 1, notes: 'dry' },
    { lineId: 'L3', componentType: 'ADDITIVE', itemSource: 'materials', itemId: 'm3', percentage: 2.5, unit: 'كجم', sequence: 3, notes: '' },
  ],
};

const model = (over: any = {}) => p.buildBomPrintModel({
  language: 'ar', bom: BOM, version: VERSION, itemLabel, customerLabel: 'قياسية (بدون عميل)', previewQuantity: null, printedAt: '27/09/2026, 10:00:00', ...over,
});

// ==================================================
// A. THE PRINT IS WHAT THE WINDOW SHOWS
// ==================================================

test('A1. lines print in sequence order, with the window\'s item labels', () => {
  const m = model();
  assert.deepEqual(m.lines.map((l: any) => l.sequence), ['1', '2', '3']);
  assert.deepEqual(m.lines.map((l: any) => l.item), ['M-ALU - Alumina', 'M-CR - Chromite', 'M-BND - Binder']);
});

test('A2. percentages, derived values and the additive "+" match bomPure exactly', () => {
  const m = model();
  const f = bomPure.bomFormula(bomPure.bomVersionPayloadForSave(VERSION));
  const byId = (id: string) => f.lines.find((l: any) => l.lineId === id);
  assert.equal(m.lines[0].percentage, bomPure.formatFormulaPercentage('BASE', byId('L1').percentage));
  assert.equal(m.lines[0].quantityDerived, '= 600 كجم', 'quantity derived from 60% of 1000 kg');
  assert.equal(m.lines[1].percentage, '-', 'no stored percentage');
  assert.equal(m.lines[1].percentageDerived, '= 40.0%', 'percentage derived from 400 of 1000');
  assert.equal(m.lines[2].percentage, '+2.5%', 'an additive keeps its "+"');
  assert.equal(m.lines[2].additive, true);
});

test('A3. the summary is Base Formula / Additives / Total Applied, from the same formula', () => {
  const m = model();
  assert.equal(m.summary.baseTotal, '100.0%');
  assert.equal(m.summary.additiveTotal, '+2.5%');
  assert.equal(m.summary.totalApplied, '102.5%');
  assert.equal(m.summary.basis, '1,000 كجم');
  assert.deepEqual(m.summary.issues, [], 'a complete formula prints as complete');
});

test('A4. an incomplete formula prints its activation issues', () => {
  const broken = { ...VERSION, components: [VERSION.components[1]] }; // 60% base only
  const m = model({ version: broken });
  assert.ok(m.summary.issues.length > 0);
  assert.deepEqual(m.summary.issues, bomPure.bomFormulaIssues(bomPure.bomVersionPayloadForSave(broken)).map((i: any) => i.messageAr));
});

test('A5. the header carries the BOM, its item, the customer scope and the version facts', () => {
  const m = model();
  assert.equal(m.bomCode, 'BOM-CHR36');
  assert.equal(m.itemLabel, 'CHR36 - Chrome brick');
  assert.equal(m.customerLabel, 'قياسية (بدون عميل)');
  assert.equal(m.versionCode, 'V1');
  assert.equal(m.status, 'ACTIVE');
  assert.equal(m.effectiveFrom, '2026-01-01');
  assert.equal(m.effectiveTo, '-');
  assert.equal(m.expectedYield, '97.5%');
  assert.equal(m.quantityHeader, 'الكمية / 1,000 كجم');
});

test('A6. the scaling preview prints only when a quantity was typed, scaled like the window', () => {
  assert.equal(model().previewHeader, null);
  const m = model({ previewQuantity: '2000' });
  assert.equal(m.previewHeader, 'لإنتاج 2,000 كجم');
  assert.deepEqual(m.lines.map((l: any) => l.preview), ['1,200 كجم', '800 كجم', '50 كجم']);
});

test('A7. English prints in English, left to right', () => {
  const m = model({ language: 'en' });
  assert.equal(m.lines[2].type, '+ Additive');
  const html = p.bomPrintHtml(m);
  assert.ok(html.includes('dir="ltr"') && html.includes('Bill of Materials (Mixture)'));
});

// ==================================================
// B. THE DOCUMENT
// ==================================================

test('B1. an Arabic document is right-to-left and contains every line and the summary', () => {
  const html = p.bomPrintHtml(model());
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('dir="rtl"') && html.includes('lang="ar"'));
  for (const label of ['M-ALU - Alumina', 'M-CR - Chromite', 'M-BND - Binder', '102.5%', 'BOM-CHR36', 'V1', 'Mix 10 minutes']) {
    assert.ok(html.includes(label), `${label} must be printed`);
  }
  assert.ok(html.includes('id="bom-print-lines"') && html.includes('id="bom-print-summary"'));
  assert.equal((html.match(/<tr class="(additive)?">/g) || []).length, 3, 'one row per component');
});

test('B2. the preview column exists only when a preview quantity was set', () => {
  assert.equal(p.bomPrintHtml(model()).includes('لإنتاج'), false);
  assert.ok(p.bomPrintHtml(model({ previewQuantity: '2000' })).includes('لإنتاج 2,000 كجم'));
});

test('B3. codes, names and notes can never become markup', () => {
  assert.equal(p.escapeHtml('<script>alert("x")</script> & \'y\''), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
  const html = p.bomPrintHtml(model({ version: { ...VERSION, notes: '<img src=x onerror=alert(1)>' } }));
  assert.equal(html.includes('<img src=x'), false);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('B4. a version without components prints an explicit empty row', () => {
  const html = p.bomPrintHtml(model({ version: { ...VERSION, components: [] } }));
  assert.ok(html.includes('لا توجد مكونات'));
});

// ==================================================
// C. THE WINDOW
// ==================================================

test('C1. the opened version has a "Print mixture" button, and every version in the list can be printed', () => {
  const src = readCode(MODAL);
  assert.ok(/id="bom-print-btn"/.test(src));
  assert.ok(readSource(MODAL).includes('طباعة الخلطة'));
  assert.ok(/onClick=\{\(\) => printVersion\(\{ \.\.\.draft, status: selected\.status \}, true\)\}/.test(src), 'the editor prints what is on screen');
  assert.ok(/data-bom-print-version=\{v\.id\}[\s\S]{0,80}onClick=\{\(\) => printVersion\(v, false\)\}/.test(src), 'a listed version prints as stored');
});

test('C2. printing is available to every user who can open the BOM - it is not behind the edit gate', () => {
  const src = readCode(MODAL);
  const at = src.indexOf('id="bom-print-btn"');
  const before = src.slice(Math.max(0, at - 400), at);
  assert.equal(/canEdit &&/.test(before.slice(before.lastIndexOf('<div'))), false);
});

test('C3. printing writes nothing - no service call, only the browser print dialog', () => {
  const print = readCode(PRINT);
  for (const forbidden of ['firebase', 'fetchMasterData', 'updateMasterDataItem', 'createMasterDataItem', 'logAuditAction']) {
    assert.equal(print.includes(forbidden), false, `${forbidden} has no place in printing`);
  }
  const modal = readCode(MODAL);
  const fn = modal.slice(modal.indexOf('function printDocument'), modal.indexOf('export const BomVersionsModal'));
  assert.ok(/win\.print\(\)/.test(fn), 'the browser print dialog');
  assert.ok(/frame\.remove\(\)/.test(fn), 'and the hidden frame is removed afterwards');
  assert.equal(/createMasterDataItem|updateMasterDataItem|saveBomVersionDraft|transitionBomVersion/.test(fn), false);
});

test('C4. the customer scope printed is the one the Master Data table shows', () => {
  const view = readCode('src/components/masterData/MasterDataView.tsx');
  assert.ok(/customerLabel=\{bomForVersions \? scopeLabel\(bomForVersions\.customerId\) : ''\}/.test(view));
});

// ==================================================
// D. OPENING A BOM READS ONLY ITS OWN VERSIONS
// ==================================================

test('D1. a BOM\'s versions are asked of the server by bomId - not the whole versions collection', () => {
  const svc = readCode(BOM_SERVICE);
  const fn = svc.slice(svc.indexOf('export async function listBomVersions'), svc.indexOf('export async function createBomVersion'));
  assert.ok(/fetchMasterDataByField<Stored>\(BOM_VERSION_COLLECTION, 'bomId', bomId\)/.test(fn));
  assert.equal(/fetchMasterData<Stored>\(BOM_VERSION_COLLECTION/.test(fn), false, 'no full read to open one BOM');
});

test('D2. that read is complete (no limit), so the version rules still see every version of the BOM', () => {
  const svc = readCode('src/services/masterDataService.ts');
  const fn = svc.slice(svc.indexOf('export async function fetchMasterDataByField'), svc.indexOf('export async function countMasterData'));
  assert.ok(/where\(field, '==', value\)/.test(fn));
  assert.equal(/limit\(/.test(fn), false, 'a limit could hide a second ACTIVE version from the rules');
  assert.equal(/setCachedCollection/.test(fn), false, 'one BOM\'s versions are not the collection');
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

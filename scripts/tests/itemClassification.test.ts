/**
 * ITEM CLASSIFICATION + PRODUCTS/MATERIALS OVERLAP - Phase 1 Step 1B.
 *
 * K  ItemKind: supported values, optional, resolution order, never inferred
 * O  overlap analysis: deterministic exact code / name matching, no automatic
 *    merge, ambiguity needs review, inputs never mutated
 * S  safety: product-code normalisation, production references and the Step 1A
 *    external-reference foundation are unchanged; the UI is review-only
 *
 * The two modules are pure and run as shipped. Screens and Firebase-backed
 * services are pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/itemClassification.test.ts
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

console.log('itemClassification.test.ts');

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

let cls: any;
let ovl: any;
let ext: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  cls = await load('src/services/itemClassificationPure.ts');
  ovl = await load('src/services/itemOverlapAnalysisPure.ts');
  ext = await load('src/services/externalReferencesPure.ts');
}

const CLS = 'src/services/itemClassificationPure.ts';
const OVL = 'src/services/itemOverlapAnalysisPure.ts';
const MODAL = 'src/components/masterData/ItemOverlapReviewModal.tsx';
const VIEW = 'src/components/masterData/MasterDataView.tsx';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value as any).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// ==================================================
// K. ITEM KIND
// ==================================================

test('K1. ItemKind accepts exactly the supported values', () => {
  assert.deepEqual([...cls.ITEM_KINDS], ['RAW_MATERIAL', 'INTERMEDIATE', 'FINISHED_PRODUCT', 'OTHER']);
  for (const k of cls.ITEM_KINDS) assert.equal(cls.isItemKind(k), true, k);
  for (const bad of ['raw_material', 'FINISHED', 'Raw Material', '', null, undefined, 1, {}]) {
    assert.equal(cls.isItemKind(bad), false, String(bad));
  }
  for (const k of cls.ITEM_KINDS) assert.ok(cls.ITEM_KIND_LABELS[k].ar && cls.ITEM_KIND_LABELS[k].en);
  const types = readCode('src/types/index.ts');
  assert.ok(/export type ItemKind = 'RAW_MATERIAL' \| 'INTERMEDIATE' \| 'FINISHED_PRODUCT' \| 'OTHER';/.test(types));
});

test('K2. records without an item kind remain valid and resolve to unclassified', () => {
  assert.deepEqual(cls.resolveItemKind({ id: 'p1', code: 'BAR25' }), { kind: null, source: 'UNCLASSIFIED' });
  assert.deepEqual(cls.resolveItemKind(undefined), { kind: null, source: 'UNCLASSIFIED' });
  assert.deepEqual(cls.resolveItemKind({ itemKind: 'finished' }), { kind: null, source: 'UNCLASSIFIED' }, 'an invalid stored value is ignored, never guessed');
  const types = readCode('src/types/index.ts');
  for (const name of ['ProductType', 'Product', 'Material']) {
    // The interface may extend a mixin (Step 8E added WithExternalReferences) - what is pinned is the optional field.
    const start = Math.max(types.indexOf(`export interface ${name} {`), types.indexOf(`export interface ${name} extends`));
    const block = types.slice(start, types.indexOf('\n}', start));
    assert.ok(/\bitemKind\?: ItemKind;/.test(block), `${name}.itemKind is optional`);
  }
});

test('K3/K11. an item can be classified as RAW_MATERIAL', () => {
  assert.deepEqual(cls.resolveItemKind({ itemKind: 'RAW_MATERIAL' }), { kind: 'RAW_MATERIAL', source: 'ITEM' });
});

test('K4/K12. an item can be classified as INTERMEDIATE', () => {
  assert.deepEqual(cls.resolveItemKind({ itemKind: 'INTERMEDIATE' }), { kind: 'INTERMEDIATE', source: 'ITEM' });
});

test('K5/K13. an item can be classified as FINISHED_PRODUCT', () => {
  assert.deepEqual(cls.resolveItemKind({ itemKind: 'FINISHED_PRODUCT' }), { kind: 'FINISHED_PRODUCT', source: 'ITEM' });
});

test('K6/K14. an item can remain OTHER', () => {
  assert.deepEqual(cls.resolveItemKind({ itemKind: 'OTHER' }), { kind: 'OTHER', source: 'ITEM' });
});

test('K7. the record\'s own kind wins over its product type default', () => {
  const type = { id: 't1', prefixCode: 'CHR', itemKind: 'RAW_MATERIAL' };
  assert.deepEqual(cls.resolveItemKind({ productTypeId: 't1' }, type), { kind: 'RAW_MATERIAL', source: 'PRODUCT_TYPE' });
  assert.deepEqual(cls.resolveItemKind({ itemKind: 'INTERMEDIATE' }, type), { kind: 'INTERMEDIATE', source: 'ITEM' }, 'calcined kaolin under a Kaolin type');
  assert.equal(cls.findProductTypeFor({ productTypeId: 't1' }, [type]), type);
  assert.equal(cls.findProductTypeFor({ productTypePrefix: 'CHR' }, [type]), type);
  assert.equal(cls.findProductTypeFor({ productTypePrefix: 'CHR' }, [type, { id: 't2', prefixCode: 'CHR' }]), undefined, 'two types with one prefix -> no guess');
});

test('K8. a kind is never inferred from which collection a record lives in', () => {
  const report = ovl.analyzeProductMaterialOverlap([{ id: 'm1', code: 'X', name: 'x' }], [{ id: 'p1', code: 'Y', name: 'y' }]);
  assert.equal(report.rows[0].materialItemKind, null, 'a material is not assumed to be a raw material');
  assert.equal(report.unmatchedProducts[0].productItemKind, null, 'a product is not assumed to be finished');
  assert.equal(/materials?\s*[:=]+\s*'RAW_MATERIAL'|'products'.*FINISHED_PRODUCT/.test(readCode(CLS) + readCode(OVL)), false);
});

// ==================================================
// O. OVERLAP ANALYSIS
// ==================================================

test('O1/T3. exact normalized code match is deterministic', () => {
  const run = () => ovl.analyzeProductMaterialOverlap(
    [{ id: 'm1', code: ' kaolin-green ', name: 'كاولين خام' }],
    [{ id: 'p1', code: 'KAOLIN-GREEN', name: 'Green Kaolin' }],
  );
  const a = run();
  assert.equal(a.rows.length, 1);
  assert.equal(a.rows[0].matchType, 'EXACT_CODE_MATCH');
  assert.deepEqual(a.rows[0].matchedOn, ['CODE']);
  assert.equal(a.rows[0].recommendedAction, 'REVIEW', 'names differ, so a human decides');
  assert.deepEqual(run(), a, 'same input -> same output');
});

test('O2/T4. exact normalized name match is deterministic and needs review', () => {
  const run = () => ovl.analyzeProductMaterialOverlap(
    [{ id: 'm1', code: 'MAT-CK', name: 'الكاولين المُحروق' }],
    [{ id: 'p1', code: 'CHR30001', name: 'الكاولين  المحروق' }],
  );
  const a = run();
  assert.equal(a.rows[0].matchType, 'EXACT_NAME_MATCH');
  assert.equal(a.rows[0].recommendedAction, 'REVIEW');
  assert.equal(a.rows[0].needsReview, true);
  assert.match(a.rows[0].reasonEn, /codes differ/);
  assert.deepEqual(run(), a);
});

test('O3. code AND name on exactly one product is the only mapping candidate', () => {
  const r = ovl.analyzeProductMaterialOverlap(
    [{ id: 'm1', code: 'CAL95', name: 'Calcined Alumina' }],
    [{ id: 'p1', code: 'cal95', name: 'CALCINED ALUMINA' }],
  );
  assert.equal(r.rows[0].matchType, 'CODE_AND_NAME_MATCH');
  assert.equal(r.rows[0].recommendedAction, 'CANDIDATE_FOR_MAPPING');
  assert.equal(r.rows[0].needsReview, false);
  assert.equal(r.summary.codeAndNameMatches, 1);
});

test('O4/T5. different codes + similar (not identical) names are NOT matched or merged', () => {
  const r = ovl.analyzeProductMaterialOverlap(
    [{ id: 'm1', code: 'MAT-01', name: 'Kaolin' }, { id: 'm2', code: 'MAT-02', name: 'كاولين' }],
    [{ id: 'p1', code: 'CHR01', name: 'Kaolin 40' }, { id: 'p2', code: 'CHR02', name: 'الكاولين' }],
  );
  assert.deepEqual(r.rows.map((x: any) => x.matchType), ['NO_MATCH', 'NO_MATCH']);
  assert.equal(r.rows.every((x: any) => x.recommendedAction === 'KEEP_SEPARATE'), true);
  assert.equal(r.summary.unmatchedProducts, 2);
  const code = readCode(OVL);
  assert.equal(/fuzzy|levenshtein|similarity|rankFuzzyCandidates|includes\(nameKey|startsWith/i.test(code), false, 'no similarity scoring');
  assert.equal(/merge|delete|remove|consolidat/i.test(code.replace(/mergedFilters/g, '')), false, 'no merge or delete path exists');
});

test('O5/T6. ambiguous candidates are reported and need review', () => {
  const twoProducts = ovl.analyzeProductMaterialOverlap(
    [{ id: 'm1', code: 'CK1', name: 'Calcined Kaolin' }],
    [{ id: 'p1', code: 'CK1', name: 'Something' }, { id: 'p2', code: 'OTHER', name: 'calcined kaolin' }],
  );
  assert.equal(twoProducts.rows.length, 2, 'one row per candidate');
  assert.equal(twoProducts.rows.every((x: any) => x.matchType === 'AMBIGUOUS' && x.needsReview && x.recommendedAction === 'REVIEW'), true);
  assert.equal(twoProducts.summary.ambiguousMaterials, 1);

  const twoMaterials = ovl.analyzeProductMaterialOverlap(
    [{ id: 'm1', code: 'GRA', name: 'Graphite' }, { id: 'm2', code: 'GRA', name: 'Graphite powder' }],
    [{ id: 'p1', code: 'GRA', name: 'Graphite' }],
  );
  assert.equal(twoMaterials.rows.every((x: any) => x.matchType === 'AMBIGUOUS'), true, 'one product claimed by two materials is not a clean match');
  assert.equal(twoMaterials.summary.ambiguousMaterials, 2);
  assert.equal(twoMaterials.summary.codeAndNameMatches, 0);
});

test('O6. empty codes and names never match each other', () => {
  const r = ovl.analyzeProductMaterialOverlap([{ id: 'm1', code: '', name: '  ' }], [{ id: 'p1', code: '', name: '' }]);
  assert.equal(r.rows[0].matchType, 'NO_MATCH');
  assert.equal(r.summary.unmatchedProducts, 1);
});

test('O7. summary counts match the rows, and records without an id are skipped', () => {
  const r = ovl.analyzeProductMaterialOverlap(
    [
      { id: 'm1', code: 'A', name: 'a' }, { id: 'm2', code: 'B', name: 'nope' }, { id: 'm3', code: 'Z', name: 'shared' },
      { id: 'm4', code: 'Q', name: 'q' }, { code: 'NOID', name: 'x' },
    ],
    [{ id: 'p1', code: 'A', name: 'a' }, { id: 'p2', code: 'B', name: 'b' }, { id: 'p3', code: 'Y', name: 'shared' }, { id: 'p4', code: 'U', name: 'u', isMixtureBOM: true }],
  );
  assert.deepEqual(r.summary, {
    totalProducts: 4, totalMaterials: 4, codeAndNameMatches: 1, exactCodeMatches: 1, exactNameMatches: 1,
    ambiguousMaterials: 0, unmatchedMaterials: 1, unmatchedProducts: 1, skippedWithoutId: 1,
  });
  assert.deepEqual(r.unmatchedProducts, [{ productId: 'p4', productCode: 'U', productName: 'u', productItemKind: null, productIsMixture: true }]);
});

test('O8. product kinds come from the product first, then its type', () => {
  const r = ovl.analyzeProductMaterialOverlap(
    [{ id: 'm1', code: 'CHR01', name: 'Kaolin', itemKind: 'RAW_MATERIAL' }, { id: 'm2', code: 'BAR25', name: 'Brick' }],
    [
      { id: 'p1', code: 'CHR01', name: 'Kaolin', productTypeId: 't1' },
      { id: 'p2', code: 'BAR25', name: 'Brick', productTypeId: 't2', itemKind: 'OTHER' },
    ],
    [{ id: 't1', prefixCode: 'CHR', itemKind: 'INTERMEDIATE' }, { id: 't2', prefixCode: 'BAR', itemKind: 'FINISHED_PRODUCT' }],
  );
  assert.equal(r.rows[0].materialItemKind, 'RAW_MATERIAL');
  assert.equal(r.rows[0].productItemKind, 'INTERMEDIATE', 'from the type');
  assert.equal(r.rows[1].productItemKind, 'OTHER', 'the product overrides its type');
});

// ==================================================
// S. SAFETY
// ==================================================

test('S1/T7/T8. analysis never changes product or material ids, codes or any input', () => {
  const materials = deepFreeze([{ id: 'matDoc01', code: 'cal95 ', name: 'Calcined Alumina', itemKind: 'RAW_MATERIAL' }]);
  const products = deepFreeze([{ id: 'prodDoc01', code: 'CAL95', productCode: 'CAL95', name: 'calcined alumina' }]);
  const r = ovl.analyzeProductMaterialOverlap(materials, products);
  assert.equal(r.rows[0].materialId, 'matDoc01');
  assert.equal(r.rows[0].productId, 'prodDoc01');
  assert.equal(r.rows[0].materialCode, 'cal95 ', 'the stored code is reported as-is, not rewritten');
  assert.equal(r.rows[0].productCode, 'CAL95');
  assert.equal(materials[0].id, 'matDoc01');
  assert.equal(products[0].id, 'prodDoc01');
  assert.equal(r.rows[0].materialCode === materials[0].code && r.rows[0] !== (materials[0] as any), true);
});

test('S2. the analysis modules are pure: no Firebase, no writes, no AI', () => {
  for (const rel of [CLS, OVL]) {
    const code = readCode(rel);
    assert.equal(/firebase|getDocs|setDoc|updateDoc|addDoc|deleteDoc|writeBatch|createMasterDataItem|updateMasterDataItem|fetch\(/.test(code), false, rel);
    assert.equal(/assistant|aiService|provider|llm/i.test(code), false, `${rel} uses no AI`);
  }
  const imports = (readCode(OVL).match(/^import .+$/gm) || []).join('\n');
  assert.ok(/from '\.\.\/utils\/searchUtils'/.test(imports), 'reuses the repository\'s existing normalizers');
});

test('S3/T9. product-code normalisation is unchanged, and the reused normalizers are the existing ones', () => {
  const parser = readCode('src/utils/productCodeParser.ts');
  assert.ok(parser.includes(
    "export function normalizeProductCode(rawCode: string | null | undefined): string {\n  if (!rawCode) return '';\n  const converted = toWesternDigits(String(rawCode)).trim();\n  return converted.replace(/\\s+/g, '').toUpperCase();\n}",
  ));
  const search = readCode('src/utils/searchUtils.ts');
  assert.ok(search.includes("export function normalizeCode(value: string | number | null | undefined): string {\n  if (value === null || value === undefined) return '';\n  const str = toWesternDigits(String(value)).trim().toUpperCase();\n  return str.replace(/\\s+/g, '');\n}"));
  assert.equal(/itemKind|ItemKind/.test(parser + search), false);
});

test('S4/T10. no historical production reference is rewritten', () => {
  const types = readCode('src/types/index.ts');
  const pr = types.slice(types.indexOf('export interface ProductionRecord'), types.indexOf('\n}', types.indexOf('export interface ProductionRecord')));
  for (const f of ['productId: string;', 'productName: string;', 'productCode: string;']) assert.ok(pr.includes(f), f);
  assert.equal(/itemKind/.test(pr), false, 'production records gain no field');
  const mci = types.slice(types.indexOf('export interface MaterialConsumptionItem'), types.indexOf('\n}', types.indexOf('export interface MaterialConsumptionItem')));
  assert.ok(mci.includes('materialId: string;') && !/itemKind/.test(mci));
  for (const rel of [CLS, OVL, MODAL]) {
    assert.equal(/productionService|stageRecordService|STAGE_COLLECTION_NAMES|'production'/.test(readCode(rel)), false, rel);
  }
});

test('S5. the review UI reuses Master Data, writes nothing itself, and adds no page or navigation', () => {
  const modal = readCode(MODAL);
  assert.ok(/import \{ Modal \} from '\.\.\/common\/Modal'/.test(modal), 'the existing dialog');
  assert.ok(/fetchMasterData<Material>\('materials'/.test(modal) && /fetchMasterData<Product>\('products'/.test(modal) && /fetchMasterData<ProductType>\('productTypes'/.test(modal), 'the shared cache-first reads');
  // Step 2A added explicit decisions, written only through logicalItemService - never directly here.
  assert.equal(/createMasterDataItem|updateMasterDataItem|deleteMasterDataItem|safeUpdateDoc|setDoc|addDoc|writeBatch|<select|onChange=\{\(e\) => set\w*Decision/.test(modal), false, 'no direct write and no auto-applied decision control');
  const view = readCode(VIEW);
  assert.ok(/\{\(activeTab === 'products' \|\| activeTab === 'materials'\) && \(\s*<button\s+id="master-data-item-overlap-btn"/.test(view), 'entry point on the existing Products / Materials tabs');
  assert.ok(/<ItemOverlapReviewModal\s+isOpen=\{isItemOverlapOpen\}/.test(view));
  const nav = readCode('src/types/index.ts');
  assert.equal(/'item-master'|'item-overlap'/.test(nav), false, 'no new NavigationPage');
});

test('S6/T15. Step 1A external references still work alongside item kinds', () => {
  const product = { id: 'p1', code: 'CHR01', itemKind: 'INTERMEDIATE' };
  const { record, outcome } = ext.withExternalReference(product, { system: 'odoo', model: 'product.product', externalId: '12' });
  assert.equal(outcome, 'ADDED');
  assert.equal(record.itemKind, 'INTERMEDIATE');
  assert.equal(record.code, 'CHR01');
  assert.equal(cls.resolveItemKind(record).kind, 'INTERMEDIATE');
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

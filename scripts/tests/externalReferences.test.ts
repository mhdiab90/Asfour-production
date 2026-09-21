/**
 * EXTERNAL REFERENCES - Phase 1 Step 1A identity foundation.
 *
 * A  a record with no externalRefs, one reference, several systems
 * B  the external identity (system, model, externalId): exact, idempotent,
 *    conflict-detecting
 * C  ASFOUR identity is never touched: internal id, business code, product-code
 *    normalisation and cost-centre document ids stay exactly as they were
 *
 * The module is pure and runs as shipped. productCodeParser and the hierarchy
 * service import Firebase config, so their unchanged behaviour is pinned by
 * source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/externalReferences.test.ts
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

console.log('externalReferences.test.ts');

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

let ext: any;
async function bootstrap() {
  ext = await import(pathToFileURL(path.join(ROOT, 'src/services/externalReferencesPure.ts')).href);
}

const MODULE = 'src/services/externalReferencesPure.ts';
const SYNCED = '2026-09-14T08:30:00.000Z';

/** Shaped like a real Product record: Firestore id + ASFOUR code. */
const product = () => ({ id: 'aB3xK9pQ2mZ7', code: 'BAR250102305', productCode: 'BAR250102305', name: 'طوب مقاوم للأحماض', active: true });

// ==================================================
// A. VALIDITY AND BACKWARD COMPATIBILITY
// ==================================================

test('A1. a record without externalRefs stays valid and reads as no references', () => {
  assert.deepEqual(ext.readExternalReferences(product()), []);
  assert.deepEqual(ext.readExternalReferences({ ...product(), externalRefs: undefined }), []);
  assert.deepEqual(ext.readExternalReferences({ ...product(), externalRefs: null }), []);
  assert.deepEqual(ext.readExternalReferences(undefined), [], 'even no record at all');
  assert.deepEqual(ext.findExternalIdentityConflicts([product(), { id: 'x' }]), []);
});

test('A2. one external reference is valid', () => {
  const ref = { system: 'odoo', model: 'product.product', externalId: '4812', externalCode: 'BAR-25', syncedAt: SYNCED };
  assert.deepEqual(ext.validateExternalReference(ref), []);
  assert.deepEqual(ext.readExternalReferences({ ...product(), externalRefs: [ref] }), [ref]);
});

test('A3. references to several systems on one record are valid and kept apart', () => {
  const refs = [
    { system: 'odoo', model: 'product.product', externalId: '4812' },
    { system: 'another_erp', model: 'items', externalId: 'IT-77' },
    { system: 'legacy', externalCode: 'OLD-BAR25' },
  ];
  for (const r of refs) assert.deepEqual(ext.validateExternalReference(r), [], JSON.stringify(r));
  assert.equal(ext.readExternalReferences({ externalRefs: refs }).length, 3);
});

test('A4. invalid references are reported, and skipped on read instead of breaking the record', () => {
  const fields = (r: unknown) => ext.validateExternalReference(r).map((i: any) => i.field);
  assert.deepEqual(fields({ model: 'x', externalId: '1' }), ['system']);
  assert.deepEqual(fields({ system: 'Odoo', externalId: '1' }), ['system'], 'system keys are lowercase - never case-folded silently');
  assert.deepEqual(fields({ system: 'odoo', model: 'product.product' }), ['externalId'], 'an id or a code is required');
  assert.deepEqual(fields({ system: 'odoo', externalId: 4812 }), ['externalId'], 'ids are strings');
  assert.deepEqual(fields({ system: 'odoo', externalId: '1', syncedAt: 'yesterday' }), ['syncedAt']);
  assert.deepEqual(fields('odoo:4812'), ['reference']);
  const mixed = { externalRefs: [{ system: 'odoo', externalId: '1' }, { system: '' }, 'junk', null] };
  assert.deepEqual(ext.readExternalReferences(mixed), [{ system: 'odoo', externalId: '1' }]);
});

test('A5. normalising trims and drops empties, but never changes case or invents fields', () => {
  assert.deepEqual(
    ext.normaliseExternalReference({ system: ' odoo ', model: ' product.product', externalId: ' AbC-12 ', externalCode: '   ', syncedAt: '' }),
    { system: 'odoo', model: 'product.product', externalId: 'AbC-12' },
  );
});

// ==================================================
// B. EXTERNAL IDENTITY = system + model + externalId
// ==================================================

test('B1. the identity key is (system, model, externalId) and nothing else', () => {
  const k = ext.externalIdentityKey;
  assert.equal(k({ system: 'odoo', model: 'product.product', externalId: '7' }), JSON.stringify(['odoo', 'product.product', '7']));
  assert.notEqual(k({ system: 'odoo', model: 'product.product', externalId: '7' }), k({ system: 'odoo', model: 'res.partner', externalId: '7' }), 'model is part of it');
  assert.notEqual(k({ system: 'odoo', model: 'm', externalId: '7' }), k({ system: 'legacy', model: 'm', externalId: '7' }), 'system is part of it');
  assert.equal(k({ system: 'odoo', model: 'm', externalId: '7', externalCode: 'A' }), k({ system: 'odoo', model: 'm', externalId: '7', externalCode: 'B' }), 'externalCode is not');
  assert.equal(k({ system: 'odoo', externalCode: 'BAR-25' }), null, 'no externalId -> no identity');
  assert.notEqual(k({ system: 'a', model: 'b","c', externalId: 'd' }), k({ system: 'a', model: 'b', externalId: 'c","d' }), 'no separator collision');
});

test('B2. matching is exact - no case folding, no partial or fuzzy match', () => {
  const refs = [{ system: 'odoo', model: 'product.product', externalId: 'ABC-12' }];
  assert.ok(ext.findExternalReference(refs, { system: 'odoo', model: 'product.product', externalId: 'ABC-12' }));
  assert.equal(ext.findExternalReference(refs, { system: 'odoo', model: 'product.product', externalId: 'abc-12' }), undefined);
  assert.equal(ext.findExternalReference(refs, { system: 'odoo', model: 'product.product', externalId: 'ABC-1' }), undefined);
  assert.equal(ext.findExternalReference(refs, { system: 'odoo', model: 'product.template', externalId: 'ABC-12' }), undefined);
  assert.equal(/fuzzy|levenshtein|similarity|toLowerCase|localeCompare/i.test(readCode(MODULE)), false);
});

test('B3. upsert is idempotent on the external identity', () => {
  const ref = { system: 'odoo', model: 'product.product', externalId: '4812', externalCode: 'BAR-25', syncedAt: SYNCED };
  const first = ext.upsertExternalReference([], ref);
  assert.equal(first.outcome, 'ADDED');
  const again = ext.upsertExternalReference(first.refs, { ...ref });
  assert.equal(again.outcome, 'UNCHANGED');
  assert.equal(again.refs.length, 1, 'the same identity twice is still one reference');
  const later = ext.upsertExternalReference(again.refs, { ...ref, externalCode: 'BAR-25-NEW', syncedAt: '2026-09-15T00:00:00.000Z' });
  assert.equal(later.outcome, 'UPDATED');
  assert.equal(later.refs.length, 1);
  assert.equal(later.refs[0].externalCode, 'BAR-25-NEW');
  const other = ext.upsertExternalReference(later.refs, { system: 'legacy', model: 'product.product', externalId: '4812' });
  assert.equal(other.outcome, 'ADDED', 'another system is another identity');
  assert.equal(other.refs.length, 2);
});

test('B4. a reference that cannot be keyed is rejected, and the input is never mutated', () => {
  const refs = Object.freeze([Object.freeze({ system: 'odoo', model: 'product.product', externalId: '1' })]);
  const noId = ext.upsertExternalReference(refs, { system: 'odoo', externalCode: 'BAR-25' });
  assert.equal(noId.outcome, 'REJECTED');
  assert.deepEqual(noId.issues.map((i: any) => i.field), ['externalId']);
  const bad = ext.upsertExternalReference(refs, { system: 'ODOO', externalId: '2' });
  assert.equal(bad.outcome, 'REJECTED');
  assert.deepEqual(bad.refs, [{ system: 'odoo', model: 'product.product', externalId: '1' }]);
  ext.upsertExternalReference(refs, { system: 'odoo', model: 'product.product', externalId: '1', externalCode: 'X' });
  assert.equal(refs[0].externalCode, undefined, 'frozen input untouched');
});

test('B5. one external identity claimed by two ASFOUR records is reported as a conflict', () => {
  const shared = { system: 'odoo', model: 'product.product', externalId: '4812' };
  const conflicts = ext.findExternalIdentityConflicts([
    { id: 'p1', externalRefs: [shared] },
    { id: 'p2', externalRefs: [{ ...shared }] },
    { id: 'p3', externalRefs: [{ system: 'odoo', model: 'product.product', externalId: '9' }] },
    { id: 'p1', externalRefs: [shared] },
  ]);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].recordIds, ['p1', 'p2'], 'a record repeated is still one record');
  assert.equal(conflicts[0].externalId, '4812');
});

// ==================================================
// C. ASFOUR IDENTITY IS NEVER TOUCHED
// ==================================================

test('C1. attaching a reference never changes the internal id', () => {
  const before = product();
  const { record, outcome } = ext.withExternalReference(before, { system: 'odoo', model: 'product.product', externalId: '4812' });
  assert.equal(outcome, 'ADDED');
  assert.equal(record.id, 'aB3xK9pQ2mZ7');
  assert.deepEqual(before, product(), 'the original record object is not mutated');
});

test('C2. attaching a reference never changes the business code or any other field', () => {
  const before = product();
  const { record } = ext.withExternalReference(before, { system: 'odoo', model: 'product.product', externalId: '4812', externalCode: 'SOMETHING-ELSE' });
  const { externalRefs, ...rest } = record;
  assert.deepEqual(rest, before, 'only externalRefs differs');
  assert.equal(record.code, 'BAR250102305', 'externalCode never replaces Product.code');
  assert.equal(externalRefs.length, 1);
  const rejected = ext.withExternalReference(before, { system: 'odoo', externalCode: 'X' });
  assert.equal(rejected.record, before, 'a rejected reference returns the record as-is');
});

test('C3. the write patch can only ever touch externalRefs', () => {
  const patch = ext.externalReferencesPatch([
    { system: ' odoo ', model: 'res.partner', externalId: '55' },
    { system: 'odoo' },
  ]);
  assert.deepEqual(Object.keys(patch), ['externalRefs']);
  assert.deepEqual(patch.externalRefs, [{ system: 'odoo', model: 'res.partner', externalId: '55' }], 'invalid entries are not written');
  const code = readCode(MODULE);
  assert.equal(/\bcode\s*:|\.code\b|sheet1Code|\bid\s*:/.test(code.replace(/externalCode|recordIds|\bid: string/g, '')), false, 'the module never assigns an id or a code');
});

test('C4. the module is pure: no Firebase, no network, no ASFOUR identity helpers', () => {
  const code = readCode(MODULE);
  assert.equal(/firebase|getDocs|setDoc|updateDoc|addDoc|writeBatch|fetch\(|axios|XMLHttpRequest/.test(code), false);
  assert.equal(/normalizeProductCode|productCodeParser|costCenterHierarchy|masterDataService/.test(code), false);
  const imports = code.match(/^import .+$/gm) || [];
  assert.deepEqual(imports, ["import type { ExternalReference, WithExternalReferences } from '../types';"]);
});

test('C5. product-code normalisation is unchanged', () => {
  const parser = readCode('src/utils/productCodeParser.ts');
  assert.ok(parser.includes(
    "export function normalizeProductCode(rawCode: string | null | undefined): string {\n  if (!rawCode) return '';\n  const converted = toWesternDigits(String(rawCode)).trim();\n  return converted.replace(/\\s+/g, '').toUpperCase();\n}",
  ), 'normalizeProductCode body is exactly as before');
  assert.equal(/externalRefs|ExternalReference/.test(parser), false);
});

test('C6. cost-centre document identity is unchanged (document id = sheet1Code)', () => {
  const svc = readCode('src/services/costCenterHierarchyService.ts');
  assert.ok(svc.includes('const docRef = doc(db, COST_CENTER_HIERARCHY_COLLECTION, planNode.sheet1Code);'));
  assert.ok(svc.includes('id: planNode.sheet1Code,'));
  assert.equal(/externalRefs|ExternalReference/.test(svc), false);
});

test('C7. the types stay optional; only the entities a later step approved carry them', () => {
  const types = readCode('src/types/index.ts');
  assert.ok(/export interface ExternalReference \{\s*system: string;\s*model\?: string;\s*externalId\?: string;\s*externalCode\?: string;\s*syncedAt\?: string;\s*\}/.test(types));
  assert.ok(/export interface WithExternalReferences \{\s*externalRefs\?: ExternalReference\[\];\s*\}/.test(types), 'optional');
  /*
   * Step 1A attached the mixin to nothing. Later steps attached it where the
   * business approved an external identity - by EXTENDING the interface, never
   * by adding a field to it: Step 8D (production, work orders, scrap) and Step
   * 8E (Product and Material, so an Odoo product id can be kept as a reference).
   * The mixin itself is still the only declaration of the field.
   */
  assert.equal((types.match(/externalRefs\?: ExternalReference\[\];/g) || []).length, 1, 'the field is declared once, on the mixin');
  for (const name of ['Product', 'Material']) {
    assert.ok(new RegExp(`export interface ${name} extends WithExternalReferences \\{`).test(types), `${name} carries external references by extension`);
  }
  for (const [name, field] of [['Product', 'code: string;'], ['FinancialTransaction', null]] as const) {
    if (!field) continue;
    const start = types.indexOf(`export interface ${name} extends`);
    assert.ok(types.slice(start, types.indexOf('\n}', start)).includes(field), `${name} keeps its code field`);
  }
  const tx = readCode('src/services/financialTransactionsPure.ts');
  assert.ok(/accountCode: string;/.test(tx) && /costCenterCode: string;/.test(tx), 'financial transaction fields untouched');
  assert.equal(/externalRefs/.test(tx), false);
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

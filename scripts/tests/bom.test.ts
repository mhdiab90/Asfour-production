/**
 * BILL OF MATERIALS FOUNDATION - Phase 1 Step 2.
 *
 * I  identity: BOM and version ids, item ownership, many BOMs / many versions
 * V  versions: status lifecycle, effective dates, basis, yield, one active
 * S  scope: standard and customer-specific BOMs, one active default per scope
 * C  components: internal item ids, quantity, unit, percentage, sequence
 * X  separation: no routing, operations, production or costing
 * L  legacy and neighbours: mixtures, products, materials, jobs, batches untouched
 * U  reuse: Master Data tab engine, audited services, permission gate, rules
 *
 * Pure modules run as shipped; the screen, modal and service import Firebase,
 * so their wiring is pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/bom.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('bom.test.ts');

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
function interfaceBlock(name: string): string {
  const types = readCode('src/types/index.ts').replace(/[ \t]*\/\/.*$/gm, '');
  const start = types.search(new RegExp(`export interface ${name}\\b`));
  assert.ok(start >= 0, `${name} interface exists`);
  return types.slice(start, types.indexOf('\n}', start));
}

let bom: any;
let jb: any;
let reg: any;
let panels: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  bom = await load('src/services/bomPure.ts');
  jb = await load('src/services/jobBatchPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  panels = await load('src/services/masterDataPanelsPure.ts');
}

const PURE = 'src/services/bomPure.ts';
const SERVICE = 'src/services/bomService.ts';
const MODAL = 'src/components/masterData/BomVersionsModal.tsx';
const VIEW = 'src/components/masterData/MasterDataView.tsx';
const fields = (v: any) => v.issues.map((i: any) => i.field);

const known = { products: new Set(['brickA', 'calcinedKaolin']), materials: new Set(['clayA', 'clayB', 'binder']) };
const customers = new Set(['custX', 'custY']);
const bomBrick = { id: 'bom1', code: 'BOM-BRICK-A-STD', name: 'Brick A Standard', itemSource: 'products', itemId: 'brickA', customerId: null, isDefault: true, active: true };

const line = (n: number, over: Record<string, unknown> = {}) => ({ lineId: `L${n}`, itemSource: 'materials', itemId: ['clayA', 'clayB', 'binder'][n - 1] ?? `m${n}`, quantity: 100 * n, unit: 'كجم', sequence: n, percentage: null, notes: '', ...over });
const draft = (over: Record<string, unknown> = {}) => ({ bomId: 'bom1', versionCode: 'V1', status: 'DRAFT', components: [line(1), line(2)], ...over });
const vctx = { knownItems: known, bom: bomBrick };

// ==================================================
// I. IDENTITY
// ==================================================

test('1. a BOM has a stable internal identity: the document id, with its code as a field', () => {
  const block = interfaceBlock('Bom');
  assert.ok(block.includes('id?: string;') && block.includes('code: string;') && block.includes('name: string;'));
  const payload = bom.bomPayloadForSave({ ...bomBrick, createdAt: 'x', externalRefs: [{ system: 'odoo', model: 'mrp.bom', externalId: '7' }] });
  assert.deepEqual(Object.keys(payload).sort(), ['active', 'code', 'customerId', 'isDefault', 'itemId', 'itemSource', 'name', 'notes']);
  assert.equal('id' in payload, false);
  assert.equal('externalRefs' in payload, false, 'external references are kept by the merge update, never typed in');
});

test('2. a BOM belongs to an item referenced by (itemSource, itemId) - products or materials, by document id', () => {
  assert.ok(interfaceBlock('Bom').includes('itemSource: BomItemSource;') && interfaceBlock('Bom').includes('itemId: string;'));
  assert.equal(bom.validateBomForSave([], bomBrick, { knownItems: known }).valid, true);
  assert.equal(bom.validateBomForSave([], { ...bomBrick, itemSource: 'materials', itemId: 'clayA', isDefault: false }, { knownItems: known }).valid, true, 'a material-made BOM is allowed');
  assert.deepEqual(fields(bom.validateBomForSave([], { ...bomBrick, itemId: '' }, { knownItems: known })), ['itemId']);
  assert.deepEqual(fields(bom.validateBomForSave([], { ...bomBrick, itemId: 'BFC400100001' }, { knownItems: known })), ['itemId'], 'a product code is not an id');
  assert.deepEqual(fields(bom.validateBomForSave([], { ...bomBrick, itemSource: 'stages' }, { knownItems: known })), ['itemSource']);
});

test('3. one product can have many BOMs; the product alone never identifies a BOM', () => {
  const stored = [bomBrick, { ...bomBrick, id: 'bom2', code: 'BOM-BRICK-A-LOWFE', name: 'Brick A low iron', isDefault: false }];
  const v = bom.validateBomForSave(stored, { ...bomBrick, code: 'BOM-BRICK-A-TRIAL', name: 'Trial', isDefault: false }, { knownItems: known });
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  assert.deepEqual(fields(bom.validateBomForSave(stored, { ...bomBrick, code: 'bom-brick-a-std ', name: 'x', isDefault: false })), ['code'], 'the BOM code is the unique key, not the product');
  assert.equal(bom.validateBomForSave(stored, { ...bomBrick, notes: 'edited' }, { editingId: 'bom1' }).valid, true, 'an edit keeping its code is not blocked');
});

test('4. a BOM version has its own stable identity and belongs to a BOM by id', () => {
  const block = interfaceBlock('BomVersion');
  assert.ok(block.includes('id?: string;') && block.includes('bomId: string;') && block.includes('versionCode: string;'));
  const payload = bom.bomVersionPayloadForSave({ ...draft(), id: 'v1', createdAt: 'x', externalRefs: [] });
  assert.equal('id' in payload, false);
  assert.deepEqual(Object.keys(payload).sort(), ['basisQuantity', 'basisUnit', 'bomId', 'components', 'effectiveFrom', 'effectiveTo', 'expectedYieldPercent', 'notes', 'status', 'versionCode']);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ bomId: '' }), vctx)), ['bomId']);
  assert.equal(bom.BOM_VERSION_COLLECTION, 'bomVersions');
});

test('5. a BOM can have many versions; the version code is unique within its BOM only', () => {
  const stored = [{ id: 'v1', ...draft({ status: 'RETIRED' }) }, { id: 'v2', ...draft({ versionCode: 'V2', status: 'ACTIVE' }) }];
  assert.equal(bom.validateBomVersionForSave(stored, draft({ versionCode: 'V3' }), vctx).valid, true);
  assert.deepEqual(fields(bom.validateBomVersionForSave(stored, draft({ versionCode: 'v2' }), vctx)), ['versionCode']);
  assert.equal(bom.validateBomVersionForSave(stored, draft({ bomId: 'bom2', versionCode: 'V2' }), { knownItems: known }).valid, true, 'V2 of another BOM is fine');
  assert.equal(bom.validateBomVersionForSave(stored, { ...stored[1], notes: 'n' }, { ...vctx, editingId: 'v2' }).valid, true, 'editing itself');
});

// ==================================================
// V. VERSIONS
// ==================================================

test('6. version status validation and the minimal lifecycle DRAFT -> ACTIVE -> RETIRED', () => {
  assert.deepEqual([...bom.BOM_VERSION_STATUSES], ['DRAFT', 'ACTIVE', 'RETIRED']);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ status: 'APPROVED' }), vctx)), ['status']);
  const d = { id: 'v1', ...draft() };
  assert.equal(bom.validateBomVersionTransition([d], d, 'ACTIVE', vctx).valid, true, 'draft -> active');
  assert.equal(bom.validateBomVersionTransition([d], d, 'RETIRED', vctx).valid, true, 'unused draft -> retired');
  const a = { ...d, status: 'ACTIVE' };
  assert.equal(bom.validateBomVersionTransition([a], a, 'RETIRED', vctx).valid, true, 'active -> retired');
  assert.equal(bom.validateBomVersionTransition([a], a, 'DRAFT', vctx).valid, false, 'active never returns to draft');
  const r = { ...d, status: 'RETIRED' };
  assert.equal(bom.validateBomVersionTransition([r], r, 'ACTIVE', vctx).valid, false, 'retired is final');
  assert.equal(bom.isVersionEditable(d), true);
  assert.equal(bom.isVersionEditable(a) || bom.isVersionEditable(r), false, 'components change only in a draft');
});

test('6b. one ACTIVE version per BOM - a second activation is refused with the conflict named, nothing retired automatically', () => {
  const active = { id: 'v1', ...draft({ status: 'ACTIVE' }) };
  const next = { id: 'v2', ...draft({ versionCode: 'V2' }) };
  const v = bom.validateBomVersionTransition([active, next], next, 'ACTIVE', vctx);
  assert.equal(v.valid, false);
  assert.ok(v.issues.some((i: any) => /V1/.test(i.messageEn) && /Retire it first/.test(i.messageEn)));
  assert.equal(active.status, 'ACTIVE', 'the other version is untouched');
  assert.equal(bom.validateBomVersionTransition([next], next, 'ACTIVE', { ...vctx, bom: { ...bomBrick, active: false } }).valid, false, 'an inactive BOM cannot activate a version');
  const empty = { id: 'v3', ...draft({ versionCode: 'V3', components: [] }) };
  assert.equal(bom.validateBomVersionTransition([empty], empty, 'ACTIVE', vctx).valid, false, 'no components, no activation');
});

test('7. effective dates are valid YYYY-MM-DD dates and never inverted', () => {
  assert.equal(bom.validateBomVersionForSave([], draft({ effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }), vctx).valid, true);
  assert.equal(bom.validateBomVersionForSave([], draft({ effectiveFrom: '2026-01-01' }), vctx).valid, true, 'open-ended');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ effectiveFrom: '2026-02-30' }), vctx)), ['effectiveFrom']);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ effectiveFrom: '01/01/2026' }), vctx)), ['effectiveFrom']);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ effectiveFrom: '2026-06-01', effectiveTo: '2026-05-31' }), vctx)), ['effectiveTo']);
});

test('7b. optional basis and expected yield - validated, never assumed', () => {
  assert.equal(bom.validateBomVersionForSave([], draft({ basisQuantity: 1000, basisUnit: 'كجم' }), vctx).valid, true);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ basisQuantity: 1000 }), vctx)), ['basisUnit'], 'quantity and unit together');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ basisQuantity: -5, basisUnit: 'كجم' }), vctx)), ['basisQuantity']);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ basisQuantity: 1, basisUnit: 'pounds' }), vctx)), ['basisUnit']);
  assert.equal(bom.validateBomVersionForSave([], draft({ expectedYieldPercent: 96.5 }), vctx).valid, true);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ expectedYieldPercent: 120 }), vctx)), ['expectedYieldPercent']);
  const block = interfaceBlock('BomVersion');
  assert.equal(/scrap|actualYield|loss\w*:/i.test(block), false, 'no actual scrap tracking');
});

// ==================================================
// S. SCOPE
// ==================================================

test('8. a customer-specific BOM is optional; the customer must exist when set', () => {
  assert.equal(bom.validateBomForSave([], { ...bomBrick, code: 'BOM-X', customerId: 'custX' }, { knownItems: known, knownCustomerIds: customers }).valid, true);
  assert.deepEqual(fields(bom.validateBomForSave([], { ...bomBrick, code: 'BOM-X', customerId: 'ghost' }, { knownCustomerIds: customers })), ['customerId']);
  assert.equal(bom.bomPayloadForSave({ ...bomBrick, customerId: '' }).customerId, null);
});

test('9. a standard BOM exists without a customer, and variants share the product without copying it', () => {
  const standard = bomBrick;
  const custX = { ...bomBrick, id: 'bomX', code: 'BOM-BRICK-A-X', name: 'Brick A for X', customerId: 'custX', isDefault: true };
  const custY = { ...bomBrick, id: 'bomY', code: 'BOM-BRICK-A-Y', name: 'Brick A for Y', customerId: 'custY', isDefault: true };
  assert.equal(bom.validateBomForSave([custX, custY], standard, { knownItems: known, knownCustomerIds: customers }).valid, true, 'a default per scope: standard, X and Y coexist');
  assert.equal(bom.validateBomForSave([standard, custY], custX, { editingId: 'bomX', knownItems: known, knownCustomerIds: customers }).valid, true);
  assert.equal(new Set([standard, custX, custY].map((b) => b.itemId)).size, 1, 'one product, three BOMs');
});

test('9b. at most one ACTIVE default BOM per (item, customer) scope - reported, never resolved silently', () => {
  const v = bom.validateBomForSave([bomBrick], { ...bomBrick, id: undefined, code: 'BOM-BRICK-A-2', name: 'Second' }, { knownItems: known });
  assert.deepEqual(fields(v), ['isDefault']);
  assert.ok(/BOM-BRICK-A-STD/.test(v.issues[0].messageEn), 'the holder is named');
  assert.equal(bomBrick.isDefault, true, 'the holder is not changed');
  assert.equal(bom.validateBomForSave([{ ...bomBrick, active: false }], { ...bomBrick, id: undefined, code: 'BOM-2', name: 'x' }).valid, true, 'an inactive default does not block');
  assert.equal(bom.validateBomForSave([bomBrick], { ...bomBrick, id: undefined, code: 'BOM-2', name: 'x', isDefault: false }).valid, true, 'a non-default BOM is fine');
  assert.notEqual(bom.bomDefaultScopeKey(bomBrick), bom.bomDefaultScopeKey({ ...bomBrick, customerId: 'custX' }));
});

// ==================================================
// C. COMPONENTS
// ==================================================

test('10. a component references an internal item id from products or materials - intermediates and products included', () => {
  const block = interfaceBlock('BomComponent');
  assert.ok(block.includes('itemSource: BomItemSource;') && block.includes('itemId: string;'));
  assert.equal(/materialId|productCode|itemCode|itemName|materialName/.test(block), false, 'no code or name as identity');
  const v = bom.validateBomVersionForSave([], draft({ components: [line(1), line(2, { itemSource: 'products', itemId: 'calcinedKaolin' })] }), vctx);
  assert.equal(v.valid, true, 'a product-kept intermediate is a valid component');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { itemId: 'KAO-01' })] }), vctx)), ['components.itemId'], 'a code is not an id');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { itemId: '' })] }), vctx)), ['components.itemId']);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { itemSource: 'products', itemId: 'brickA' })] }), vctx)), ['components.itemId'], 'not its own component');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1), line(2, { itemId: 'clayA' })] }), vctx)), ['components.itemId'], 'the same item twice in one version');
});

test('11. a component needs no Odoo id and carries no cost fields', () => {
  const block = interfaceBlock('BomComponent') + interfaceBlock('BomVersion') + interfaceBlock('Bom');
  assert.equal(/odoo/i.test(block), false);
  assert.equal(/cost|price|amount|value\s*:/i.test(block), false);
  const payload = bom.componentPayload({ ...line(1), odooProductId: '99', unitCost: 5 });
  // Phase 1 Step 7A adds the controlled formula group (BASE / ADDITIVE) - still no cost or external id.
  assert.deepEqual(Object.keys(payload).sort(), ['componentType', 'itemId', 'itemSource', 'lineId', 'notes', 'percentage', 'quantity', 'sequence', 'unit']);
});

test('12. quantity is required, numeric and greater than zero - never converted', () => {
  for (const bad of [0, -1, '', 'abc', null, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { quantity: bad })] }), vctx)), ['components.quantity'], String(bad));
  }
  assert.equal(bom.componentPayload(line(1, { quantity: '12.5' })).quantity, 12.5);
  assert.equal(bom.componentPayload(line(1, { quantity: 250, unit: 'طن' })).quantity, 250, 'tons stay tons');
});

test('13. the unit is required and must be one of the unit values the app already stores', () => {
  // "m²" and "متر" were approved as real ASFOUR units for the master data package.
  assert.deepEqual([...bom.BOM_UNITS], ['طن', 'كجم', 'م3', 'لتر', 'شكارة', 'قطعة', 'm²', 'متر']);
  const raw = readSource('src/components/admin/RawMaterialsView.tsx');
  const existing = [...raw.slice(raw.indexOf('UNIT_OPTIONS'), raw.indexOf('];', raw.indexOf('UNIT_OPTIONS'))).matchAll(/value: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(existing.length >= 5);
  for (const u of existing) assert.ok(bom.BOM_UNITS.includes(u), `material unit ${u} is a BOM unit`);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { unit: '' })] }), vctx)), ['components.unit'], 'no silent kg default');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { unit: 'kg' })] }), vctx)), ['components.unit']);
});

test('14. percentage is optional and validated against its range, the total and a declared basis', () => {
  assert.equal(bom.validateBomVersionForSave([], draft(), vctx).valid, true, 'no percentages at all');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { percentage: 0 })] }), vctx)), ['components.percentage']);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { percentage: 101 })] }), vctx)), ['components.percentage']);
  assert.equal(bom.validateBomVersionForSave([], draft({ components: [line(1, { percentage: 60 }), line(2)] }), vctx).valid, true, 'partial percentages up to 100');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { percentage: 70 }), line(2, { percentage: 40 })] }), vctx)), ['components.percentage'], 'above 100 in total');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1, { percentage: 50 }), line(2, { percentage: 40 })] }), vctx)), ['components.percentage'], 'all set but not 100');
  // Basis 1000 kg: 600 kg = 60%, 400 kg = 40% - consistent.
  const basis = { basisQuantity: 1000, basisUnit: 'كجم' };
  assert.equal(bom.validateBomVersionForSave([], draft({ ...basis, components: [line(1, { quantity: 600, percentage: 60 }), line(2, { quantity: 400, percentage: 40 })] }), vctx).valid, true);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ ...basis, components: [line(1, { quantity: 500, percentage: 60 }), line(2, { quantity: 400, percentage: 40 })] }), vctx)), ['components.percentage'], 'quantity contradicts its percentage of the basis');
  // A different unit is never converted to compare.
  assert.equal(bom.validateBomVersionForSave([], draft({ ...basis, components: [line(1, { quantity: 0.6, unit: 'طن', percentage: 60 }), line(2, { quantity: 400, percentage: 40 })] }), vctx).valid, true);
});

test('15. component sequence can be changed safely: move up/down and removal renumber 1..n, line ids stay stable', () => {
  const lines = [line(1), line(2), line(3)];
  const moved = bom.moveComponent(lines, 'L3', 'up');
  assert.deepEqual(moved.map((c: any) => [c.lineId, c.sequence]), [['L1', 1], ['L3', 2], ['L2', 3]]);
  assert.deepEqual(bom.moveComponent(lines, 'L1', 'up').map((c: any) => c.lineId), ['L1', 'L2', 'L3'], 'past the top changes nothing');
  assert.deepEqual(bom.moveComponent(lines, 'L9', 'down').map((c: any) => c.lineId), ['L1', 'L2', 'L3'], 'unknown line changes nothing');
  assert.deepEqual(bom.normaliseSequences([line(2, { sequence: 7 }), line(1, { sequence: 3 })]).map((c: any) => [c.lineId, c.sequence]), [['L1', 1], ['L2', 2]]);
  assert.equal(bom.nextLineId([line(1), { lineId: 'L7' }]), 'L8', 'never reuses a line id');
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1), line(2, { sequence: 1 })] }), vctx)), ['components.sequence']);
  assert.deepEqual(fields(bom.validateBomVersionForSave([], draft({ components: [line(1), line(2, { lineId: 'L1' })] }), vctx)), ['components.lineId']);
  assert.deepEqual(bom.bomVersionPayloadForSave(draft({ components: [line(2, { sequence: 5 }), line(1, { sequence: 2 })] })).components.map((c: any) => c.sequence), [1, 2], 'stored order is renumbered');
});

test('15b. a new version copies another as a DRAFT - the only way to change an active recipe', () => {
  const active = { id: 'v1', ...draft({ status: 'ACTIVE', effectiveFrom: '2026-01-01', basisQuantity: 1000, basisUnit: 'كجم' }) };
  const copy = bom.draftFromVersion(active, 'V2');
  assert.equal(copy.status, 'DRAFT');
  assert.equal(copy.versionCode, 'V2');
  assert.equal(copy.effectiveFrom, null);
  assert.deepEqual(copy.components, bom.bomVersionPayloadForSave(active).components);
  assert.equal('id' in copy, false);
  assert.equal(active.status, 'ACTIVE', 'the source is untouched');
});

// ==================================================
// X. SEPARATION
// ==================================================

test('16/17. a BOM is not Routing and embeds no operations, stages, equipment or cost centres', () => {
  for (const name of ['Bom', 'BomVersion', 'BomComponent']) {
    assert.equal(/operation|stage|routing|route|hierarchyNodeId|costCenter|equipment|press|furnace|workCenter/i.test(interfaceBlock(name)), false, name);
  }
  const code = readCode(PURE) + readCode(SERVICE);
  assert.equal(/operationMasterPure|legacyStageKey|STAGE_COLLECTION_NAMES|routing|hierarchyResolver|equipmentMasterPure/i.test(code), false);
});

test('18. BOM code never creates production, jobs, batches or costs', () => {
  const code = readCode(PURE) + readCode(SERVICE) + readCode(MODAL);
  assert.equal(/stage_|'production'|productionService|stageRecordService|jobReferences|'batches'|financialTransactions|costing/i.test(code), false);
  const service = readCode(SERVICE);
  assert.equal(/deleteMasterDataItem|deleteDoc|writeBatch|setDoc/.test(service), false, 'no delete or raw writes');
  assert.equal((service.match(/createMasterDataItem\(/g) || []).length, 1);
  assert.equal((service.match(/updateMasterDataItem\(/g) || []).length, 2, 'draft save + status transition');
});

// ==================================================
// L. LEGACY AND NEIGHBOURS
// ==================================================

test('19. legacy mixture products stay readable - partial data included - and are only displayed', () => {
  const legacy = {
    id: 'mix1', code: '', name: 'خلطة 70/30', category: 'MIXTURE_BOM', isMixtureBOM: true,
    mixtureComponents: [
      { materialId: 'clayA', materialCode: 'C-A', materialName: 'Clay A', quantityKg: 700, percentage: 70 },
      { materialId: 'clayB', materialName: 'Clay B', quantityKg: 300, percentage: 30 },
    ],
  };
  const read = bom.readLegacyMixture(legacy);
  assert.equal(read.isLegacyMixture, true);
  assert.deepEqual(read.lines.map((l: any) => [l.materialId, l.quantityKg, l.percentage]), [['clayA', 700, 70], ['clayB', 300, 30]]);
  assert.equal(bom.readLegacyMixture({ category: 'MIXTURE_BOM' }).isLegacyMixture, true, 'category alone');
  assert.equal(bom.readLegacyMixture({ code: 'BAR1' }).isLegacyMixture, false);
  assert.deepEqual(bom.readLegacyMixture({ isMixtureBOM: true, mixtureComponents: [{ quantityKg: 'x' }] }).lines[0], { materialId: '', materialCode: '', materialName: '', quantityKg: null, percentage: null });
  const modal = readCode(MODAL);
  assert.ok(/id="bom-legacy-mixture"/.test(modal));
  assert.equal(/mixtureComponents\s*[:=]|isMixtureBOM\s*[:=]/.test(modal + readCode(SERVICE)), false, 'never written');
});

test('20. Product.mixtureComponents, Product and Material models are untouched', () => {
  const product = interfaceBlock('Product');
  assert.ok(product.includes('isMixtureBOM?: boolean;') && product.includes('mixtureComponents?: Array<{'));
  assert.equal(/bomId|bomVersion|boms/i.test(product), false, 'no BOM embedded in Product');
  assert.equal(/bomId|bomVersion/i.test(interfaceBlock('Material')), false);
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--',
    'src/services/tubeBallMillsMixturePure.ts', 'src/services/tubeBallMillsHistoricalImportService.ts',
    'src/services/materialService.ts', 'src/services/productTypeSeedPure.ts',
  ], { cwd: ROOT, encoding: 'utf-8' }).trim();
  assert.equal(changed, '', `mixture import and material services unchanged: ${changed}`);
  const view = readCode(VIEW);
  assert.equal(/mixtureComponents\s*:/.test(view.slice(view.indexOf("activeTab === 'boms'"))), false);
});

test('21. Job References stay compatible - a future job can point at a version id without changing either model', () => {
  const job = interfaceBlock('JobReference');
  // Phase 1 Step 4: the job references a BOM version by id only - no copied components.
  assert.ok(job.includes('bomVersionId?: string | null;'));
  assert.equal(/bom/i.test(job.replace(/\bbomVersionId\b/g, '')) || /components/.test(job), false);
  assert.equal(jb.validateJobReferenceForSave([], { code: 'JR-1', status: 'ACTIVE' }).valid, true);
  assert.ok(interfaceBlock('BomVersion').includes('id?: string;'), 'the id a future selection would store');
});

test('22. Batches stay compatible', () => {
  assert.equal(/bom/i.test(interfaceBlock('Batch')), false);
  assert.equal(jb.validateBatchForSave([], { batchNumber: 'B-1', productId: 'brickA' }).valid, true);
  assert.deepEqual(Object.keys(jb.batchPayloadForSave({ batchNumber: 'B-1', bomVersionId: 'v1' })).sort(), ['active', 'batchNumber', 'jobReferenceId', 'notes', 'productId']);
});

// ==================================================
// U. REUSE
// ==================================================

test('U1. Bills of Materials sit beneath Products in the existing Master Data navigation - no new page or manager', () => {
  // Routings (Phase 1 Step 3) joined the same Products sub-row.
  assert.deepEqual(reg.subCategories('products').map((c: any) => c.tab), ['products', 'boms', 'routings']);
  assert.equal(reg.categoryForTab('products').id, 'products', 'Products is still its own category');
  assert.equal(reg.categoryForTab('boms').collection, 'boms');
  assert.equal(reg.navigationCategoryIdForTab('boms', panels.panelCategories()), 'products');
  assert.equal([...panels.PANEL_CATEGORY_IDS].includes('boms'), false, 'not a primary category');
  assert.ok(/boms: 'boms'/.test(readCode('src/services/masterDataService.ts')));
  assert.equal(/'bom|Bom(View|Page|Manager)/.test(readCode('src/App.tsx')), false, 'no top-level BOM page');
  const view = readCode(VIEW);
  assert.equal((view.match(/updateMasterDataItem\(/g) || []).length, 1, 'one shared update in the view');
  assert.equal((view.match(/createMasterDataItem\(/g) || []).length, 1, 'one shared create in the view');
});

test('U2. BOM headers save through the validated shape behind the existing gate, with a descriptive audit line; no delete', () => {
  const view = readCode(VIEW);
  assert.ok(/if \(isBomTab\) \{\s*if \(!canImportMasterData\) \{\s*throw new Error/.test(view));
  assert.ok(/validateBomForSave\(items, formData, \{/.test(view) && /dataToWrite = bomPayloadForSave\(formData\);/.test(view));
  assert.ok(/logAuditAction\(editingItem \? 'UPDATE' : 'CREATE', MASTER_DATA_COLLECTIONS\.boms, savedId, describeBomChange\(editingItem, dataToWrite\)\)/.test(view));
  assert.ok(/if \(isBomTab\) \{ setDeleteConfirmItem\(null\); return; \}/.test(view));
  assert.ok(/const isRetireOnlyTab = isCompletedEquipment \|\| isJobBatchTab \|\| isBomTab\b/.test(view), 'no delete button, Add/Edit hidden without the gate');
  assert.ok(/<BomVersionsModal[\s\S]*?canEdit=\{canImportMasterData\}/.test(view));
  assert.equal(/'(bom[A-Za-z]*|boms)\./i.test(readCode('src/types/permissions.ts')), false, 'no new permission keys');
});

test('U3. versions are written only through the validated service, gated in the modal, and never deleted', () => {
  const service = readCode(SERVICE);
  assert.ok(/validateBomVersionForSave\(versionsOfBom, draft, \{ \.\.\.context, editingId: null \}\)/.test(service));
  assert.ok(/String\(stored\.status\)\.toUpperCase\(\) !== 'DRAFT'/.test(service), 'only drafts are edited');
  assert.ok(/validateBomVersionTransition\(versionsOfBom, stored, next, context\)/.test(service));
  assert.ok(/logAuditAction\(next === 'ACTIVE' \? 'ACTIVATE' : 'DEACTIVATE'/.test(service), 'activation and retirement audited');
  const modal = readCode(MODAL);
  assert.ok(/if \(!canEdit\) return;/.test(modal));
  assert.equal(/deleteMasterDataItem|deleteDoc/.test(modal), false);
  assert.ok(/window\.confirm\(/.test(modal), 'retirement is confirmed');
});

test('U4. audit descriptions name identity, scope, status and component changes', () => {
  const created = bom.describeBomChange(null, { ...bomBrick, customerId: 'custX' });
  assert.ok(/\[BOM_CREATED\]/.test(created) && /customer custX/.test(created));
  const scope = bom.describeBomChange(bomBrick, { ...bomBrick, customerId: 'custY', code: 'BOM-NEW' });
  assert.ok(/customer scope standard -> custY/.test(scope) && /code BOM-BRICK-A-STD -> BOM-NEW/.test(scope));
  const before = { id: 'v1', ...draft() };
  const after = { ...before, components: [line(1, { quantity: 150 }), line(3)] };
  const d = bom.describeBomVersionChange(before, after);
  assert.ok(/components added: L3/.test(d) && /components removed: L2/.test(d) && /components changed: L1/.test(d), d);
  assert.ok(/\[BOM_VERSION_ACTIVATED\]/.test(bom.describeBomVersionChange(before, { ...before, status: 'ACTIVE' })));
  assert.ok(/\[BOM_VERSION_RETIRED\]/.test(bom.describeBomVersionChange({ ...before, status: 'ACTIVE' }, { ...before, status: 'RETIRED' })));
});

test('U5. rules follow the Master Data pattern for boms and bomVersions - nothing public', () => {
  const rules = readSource('firestore.rules');
  for (const [coll, param] of [['boms', 'bomId'], ['bomVersions', 'bomVersionId']]) {
    const m = rules.match(new RegExp(`match /${coll}/\\{${param}\\} \\{([\\s\\S]*?)\\n\\s*\\}`));
    assert.ok(m, coll);
    assert.deepEqual(m![1].split('\n').map((l) => l.trim()).filter(Boolean), ['allow read: if isSignedIn();', 'allow write: if isAdmin();'], coll);
  }
});

test('U6. no automatic BOM creation, migration or import', () => {
  const all = readCode(PURE) + readCode(SERVICE) + readCode(MODAL);
  assert.equal(/fetchMasterData<[^>]*>\(MASTER_DATA_COLLECTIONS\.products\)[\s\S]{0,200}createBomVersion|migrat|import(er|Bom)|xlsx/i.test(all), false);
  assert.equal(/boms/.test(readCode('src/services/bulkImportService.ts').replace(/type FormOnlyEquipmentTab[^\n]*/, '')), false, 'not a bulk-import target');
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

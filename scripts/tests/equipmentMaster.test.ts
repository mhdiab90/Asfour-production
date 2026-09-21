/**
 * EQUIPMENT COMPLETION + HIERARCHY / OPERATION READINESS - Phase 1 Step 1D.
 *
 * E  equipment models: Tube/Ball Mill, Bunker, Rotary Kiln, Furnace Car
 * V  validation: codes, names, optional hierarchy link through the shared resolver
 * R  reconciliation: the existing engine, extended - never a second one
 * H  historical safety: stage types, stage collections, record models untouched
 * U  Master Data reuse: one Equipment group, the shared tab engine, permissions
 *
 * Pure modules run as shipped; the screen imports Firebase, so its wiring is
 * pinned by source inspection with comments stripped.
 *
 * Run: npx tsx scripts/tests/equipmentMaster.test.ts
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

console.log('equipmentMaster.test.ts');

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
/** One `export interface X ... {...}` block, comments stripped. */
function interfaceBlock(name: string): string {
  const types = readCode('src/types/index.ts').replace(/[ \t]*\/\/.*$/gm, '');
  const start = types.search(new RegExp(`export interface ${name}\\b`));
  assert.ok(start >= 0, `${name} interface exists`);
  return types.slice(start, types.indexOf('\n}', start));
}

let eq: any;
let hier: any;
let rec: any;
let reg: any;
let panels: any;
let ops: any;
let stageBounds: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  eq = await load('src/services/equipmentMasterPure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
  rec = await load('src/services/legacyHierarchyReconciliationPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  panels = await load('src/services/masterDataPanelsPure.ts');
  ops = await load('src/services/operationMasterPure.ts');
  stageBounds = await load('src/services/stageQueryBoundsPure.ts');
}

const EQ = 'src/services/equipmentMasterPure.ts';
const VIEW = 'src/components/masterData/MasterDataView.tsx';

/** A hierarchy shaped like the real Sheet1 import: document id = sheet1Code. */
const index = () => hier.buildHierarchyIndex([
  { id: '501', code: '501', parentId: null },
  { id: '5011', code: '5011', parentId: '501' },
  { id: '511', code: '511', parentId: null },
  { id: '5112', code: '5112', parentId: '511' },
  { id: '51121', code: '51121', parentId: '5112' },
]);
const ctx = (editingId: string | null = null) => ({ hierarchyIndex: index(), editingId });
const fields = (v: any) => v.issues.map((i: any) => i.field);

// ==================================================
// E. EQUIPMENT MODELS
// ==================================================

test('E1. TubeBallMill carries an optional hierarchyNodeId and the Step 1A external references', () => {
  const block = interfaceBlock('TubeBallMill');
  assert.ok(block.includes('extends WithExternalReferences'));
  assert.ok(block.includes('hierarchyNodeId?: string | null;'), 'optional and nullable');
  for (const kept of ['code: string;', 'name: string;', 'active: boolean;', 'millCodeNormalized?: string;']) assert.ok(block.includes(kept), kept);
  assert.equal(eq.isEquipmentLinkTab('tubeBallMills'), true);
  assert.equal(eq.validateEquipmentForSave('tubeBallMills', [], { code: 'TM-503', name: 'طواحين تيوب ميل 503', hierarchyNodeId: '51121' }, ctx()).valid, true);
});

test('E2. Bunker carries an optional hierarchyNodeId; bunkerNumber stays its identity and code stays optional', () => {
  const block = interfaceBlock('Bunker');
  assert.ok(block.includes('extends WithExternalReferences'));
  assert.ok(block.includes('hierarchyNodeId?: string | null;'));
  assert.ok(block.includes('code?: string;') && block.includes('bunkerNumber: string;'), 'existing shape kept');
  assert.equal(eq.isEquipmentLinkTab('bunkers'), true);
  const v = eq.validateEquipmentForSave('bunkers', [], { bunkerNumber: '7', hierarchyNodeId: '511' }, ctx());
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  assert.deepEqual(fields(eq.validateEquipmentForSave('bunkers', [], { code: 'B-1' }, ctx())), ['bunkerNumber']);
});

test('E3. FurnaceCar is explicitly left unchanged: no hierarchy link, not reconciled', () => {
  const block = interfaceBlock('FurnaceCar');
  assert.equal(block.includes('hierarchyNodeId'), false);
  assert.ok(block.includes('furnaceId?: string;'), 'its cost location stays reachable through the furnace');
  assert.equal(eq.isEquipmentLinkTab('furnaceCars'), false);
  assert.equal(eq.isCompletedEquipmentTab('furnaceCars'), false);
  assert.equal([...rec.RECONCILABLE_EQUIPMENT_CATEGORIES].includes('furnaceCars'), false);
});

test('E4. the Rotary Kiln equipment master: stable id, code, name, status, optional link, description, external references', () => {
  const block = interfaceBlock('RotaryKiln');
  assert.ok(block.includes('extends WithExternalReferences'));
  for (const f of ['id?: string;', 'code: string;', 'name: string;', 'description?: string;', 'hierarchyNodeId?: string | null;', 'active: boolean;']) {
    assert.ok(block.includes(f), f);
  }
  assert.equal(/odoo|routing|route|operationId|jobRef|batch/i.test(block), false, 'no Odoo, routing or production-job fields');
  const service = readCode('src/services/masterDataService.ts');
  assert.ok(/rotaryKilns: 'rotaryKilns'/.test(service), 'registered collection');
  const category = reg.getCategory('rotaryKilns');
  assert.equal(category.collection, 'rotaryKilns');
  assert.equal(category.productionFilter, null, 'Rotary Furnace records store free text only');
  const payload = eq.equipmentPayloadForSave('rotaryKilns', { id: 'x', createdAt: 't', externalRefs: [{ system: 'other' }], code: ' RK-01 ', name: ' الفرن الدوار ', model: '', description: 'd', hierarchyNodeId: '5011' });
  assert.deepEqual(Object.keys(payload).sort(), ['active', 'code', 'description', 'hierarchyNodeId', 'model', 'name', 'status']);
  assert.equal(payload.code, 'RK-01');
  assert.equal(payload.status, 'active');
  assert.equal(eq.validateEquipmentForSave('rotaryKilns', [], payload, ctx()).valid, true);
});

test('E5. the rotaryKilns rule matches every other equipment master: signed-in read, admin write', () => {
  const rules = readSource('firestore.rules');
  const m = rules.match(/match \/rotaryKilns\/\{kilnId\} \{([\s\S]*?)\n\s*\}/);
  assert.ok(m, 'rule block present');
  assert.deepEqual(m![1].split('\n').map((l) => l.trim()).filter(Boolean), ['allow read: if isSignedIn();', 'allow write: if isAdmin();']);
  for (const existing of ['tubeBallMills/{millId}', 'bunkers/{bunkerId}']) {
    const block = rules.match(new RegExp(`match /${existing.replace(/[{}/]/g, (c) => `\\${c}`)} \\{([\\s\\S]*?)\\n\\s*\\}`));
    assert.deepEqual(block![1].split('\n').map((l) => l.trim()).filter(Boolean), ['allow read: if isSignedIn();', 'allow write: if isAdmin();'], `${existing} unchanged`);
  }
});

test('E6. no Extruder, Packing or other speculative equipment category was invented', () => {
  for (const id of ['extruders', 'packing', 'packingEquipment', 'foam', 'handMade']) {
    assert.equal(reg.getCategory(id), undefined, id);
  }
  const collections = readCode('src/services/masterDataService.ts');
  assert.equal(/extruder|packing/i.test(collections), false);
});

// ==================================================
// V. VALIDATION
// ==================================================

test('V1. equipment codes are unique within their category (existing code normalisation, inactive included)', () => {
  const stored = [{ id: 'm1', code: 'TM-503', name: 'x', active: false }];
  assert.deepEqual(fields(eq.validateEquipmentForSave('tubeBallMills', stored, { code: 'tm-503 ', name: 'y' }, ctx())), ['code']);
  assert.equal(eq.validateEquipmentForSave('tubeBallMills', stored, { code: 'TM-504', name: 'y' }, ctx()).valid, true, 'no near-matching');
  assert.equal(eq.validateEquipmentForSave('tubeBallMills', stored, { ...stored[0] }, ctx('m1')).valid, true, 'editing itself');
  assert.deepEqual(fields(eq.validateEquipmentForSave('tubeBallMills', [], { code: '', name: 'y' }, ctx())), ['code']);
  assert.deepEqual(fields(eq.validateEquipmentForSave('bunkers', [{ id: 'b1', bunkerNumber: '12' }], { bunkerNumber: ' 12' }, ctx())), ['bunkerNumber'], 'no duplicate bunker identity');
});

test('V2. an edit never creates a new duplicate, but does not block a record that already shared its code', () => {
  const stored = [{ id: 'a', code: 'RK-1', name: 'a' }, { id: 'b', code: 'RK-1', name: 'b' }];
  assert.equal(eq.validateEquipmentForSave('rotaryKilns', stored, { ...stored[1], hierarchyNodeId: '5011' }, ctx('b')).valid, true, 'linking a pre-existing duplicate is allowed');
  const other = [{ id: 'a', code: 'RK-1', name: 'a' }, { id: 'c', code: 'RK-2', name: 'c' }];
  assert.deepEqual(fields(eq.validateEquipmentForSave('rotaryKilns', other, { ...other[1], code: 'rk-1' }, ctx('c'))), ['code']);
});

test('V3. names are required per the existing types', () => {
  assert.deepEqual(fields(eq.validateEquipmentForSave('tubeBallMills', [], { code: 'A' }, ctx())), ['name']);
  assert.deepEqual(fields(eq.validateEquipmentForSave('rotaryKilns', [], { code: 'A', name: '  ' }, ctx())), ['name']);
  assert.equal(eq.validateEquipmentForSave('bunkers', [], { bunkerNumber: '3' }, ctx()).valid, true, 'a bunker name is optional');
});

test('V4. an invalid hierarchyNodeId is rejected - unknown node, or a node code instead of its id', () => {
  assert.deepEqual(fields(eq.validateEquipmentForSave('tubeBallMills', [], { code: 'A', name: 'a', hierarchyNodeId: 'nope' }, ctx())), ['hierarchyNodeId']);
  const codeKeyed = hier.buildHierarchyIndex([{ id: 'doc-5011', code: '5011', parentId: null }]);
  const v = eq.validateEquipmentForSave('rotaryKilns', [], { code: 'A', name: 'a', hierarchyNodeId: '5011' }, { hierarchyIndex: codeKeyed });
  assert.deepEqual(fields(v), ['hierarchyNodeId'], 'the stored link must be the stable node id');
  assert.equal(eq.validateEquipmentForSave('rotaryKilns', [], { code: 'A', name: 'a', hierarchyNodeId: 'doc-5011' }, { hierarchyIndex: codeKeyed }).valid, true);
});

test('V5. a missing hierarchyNodeId is valid and stored as null', () => {
  for (const tab of ['tubeBallMills', 'bunkers', 'rotaryKilns']) {
    const draft = { code: 'X-1', name: 'x', bunkerNumber: '1', hierarchyNodeId: '' };
    assert.equal(eq.validateEquipmentForSave(tab, [], draft, ctx()).valid, true, tab);
    assert.equal(eq.equipmentPayloadForSave(tab, draft).hierarchyNodeId, null, tab);
  }
  assert.equal(eq.validateEquipmentForSave('tubeBallMills', [], { code: 'A', name: 'a' }, { hierarchyIndex: hier.buildHierarchyIndex([]) }).valid, true, 'valid with no hierarchy imported at all');
});

test('V6. existing records without the new fields stay valid and readable (inactive included)', () => {
  const imported = [
    { id: 'tbm1', code: '', name: 'طاحونة 505', active: true },
    { id: 'tbm2', code: 'TM-506', name: 'طاحونة 506', active: false },
  ];
  const v = eq.validateEquipmentForSave('tubeBallMills', imported, { ...imported[1] }, ctx('tbm2'));
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  const bunker = { id: 'bk1', code: '', bunkerNumber: '4', name: '4', active: true };
  assert.equal(eq.validateEquipmentForSave('bunkers', [bunker], { ...bunker }, ctx('bk1')).valid, true, 'import-created bunker with no code');
  assert.equal(eq.equipmentPayloadForSave('tubeBallMills', { code: 'A', name: 'a', active: false }).active, false, 'inactive preserved');
});

test('V7. the save shape never carries id, timestamps or external references (the shared update merges the rest)', () => {
  for (const tab of ['tubeBallMills', 'bunkers', 'rotaryKilns']) {
    const payload = eq.equipmentPayloadForSave(tab, { id: 'x', createdAt: 'c', updatedAt: 'u', externalRefs: [], serverUpdatedAt: 1, code: 'A', name: 'a', bunkerNumber: '1' });
    for (const k of ['id', 'createdAt', 'updatedAt', 'externalRefs', 'serverUpdatedAt']) assert.equal(k in payload, false, `${tab}.${k}`);
  }
});

// ==================================================
// R. RECONCILIATION + OPERATION COMPATIBILITY
// ==================================================

const NODES = [
  { id: '5011', code: '5011', name: 'الفرن الدوار', type: 'EQUIPMENT' },
  { id: '51121', code: '51121', name: 'طواحين تيوب ميل 503', type: 'EQUIPMENT' },
  { id: '51311', code: '51311', name: 'مكبس توجل 4', type: 'EQUIPMENT' },
];

test('R1. the existing reconciliation engine now finds exact-code matches for Tube/Ball Mills and Rotary Kilns', () => {
  const report = rec.reconcileLegacyWithHierarchy([
    { id: 'tbm', code: '51121', categoryId: 'tubeBallMills' },
    { id: 'rk', code: '5011', categoryId: 'rotaryKilns' },
  ], NODES);
  assert.deepEqual(report.matched.map((m: any) => [m.legacyId, m.hierarchyNodeId]).sort(), [['rk', '5011'], ['tbm', '51121']]);
  assert.equal(rec.safeLinkPlan(report).length, 2, 'offered through the existing manual Apply workflow only');
});

test('R2. bunkers and furnace cars are never reconciled by code', () => {
  const report = rec.reconcileLegacyWithHierarchy([
    { id: 'bk', code: '5011', categoryId: 'bunkers' },
    { id: 'car', code: '51311', categoryId: 'furnaceCars' },
  ], NODES);
  assert.equal(report.matched.length + report.unmatchedLegacy.length + report.ambiguous.length, 0, 'out of scope, not unmatched');
});

test('R3. a code claimed in two equipment categories is AMBIGUOUS and never linked', () => {
  const report = rec.reconcileLegacyWithHierarchy([
    { id: 'press', code: '5011', categoryId: 'presses' },
    { id: 'kiln', code: '5011', categoryId: 'rotaryKilns' },
  ], NODES);
  assert.equal(report.matched.length, 0);
  assert.equal(report.ambiguous.length, 2);
  assert.equal(rec.safeLinkPlan(report).length, 0);
  assert.ok(report.ambiguous.every((a: any) => /equipment categories/.test(a.reason)));
});

test('R4. an existing link is never overwritten and nothing applies automatically', () => {
  const report = rec.reconcileLegacyWithHierarchy([{ id: 'rk', code: '5011', categoryId: 'rotaryKilns', hierarchyNodeId: '501' }], NODES);
  assert.equal(report.conflicts.length, 1);
  assert.equal(rec.safeLinkPlan(report).length, 0);
  const view = readCode(VIEW);
  assert.ok(/if \(!window\.confirm\(applyConfirmationMessage\(plannedLinks\.length, language\)\)\) return;/.test(view), 'apply still needs explicit confirmation');
  assert.equal(/applySafeLinks\(/.test(readCode(EQ)), false);
});

test('R5. one reconciliation engine and one hierarchy resolver - the shared ones are reused', () => {
  const code = readCode(EQ);
  assert.ok(/import \{ validateEquipmentLink \} from '\.\/hierarchyResolverPure'/.test(code));
  assert.equal(/getChildIds|getAncestorIds|childrenByParent|function\s+\w*(resolve|reconcile)\w*/i.test(code), false, 'no traversal or matching of its own');
  const services = fs.readdirSync(path.join(ROOT, 'src/services'));
  assert.deepEqual(services.filter((f) => /resolver/i.test(f)), ['hierarchyResolverPure.ts']);
  assert.deepEqual(services.filter((f) => /reconcil/i.test(f)), ['legacyHierarchyReconciliationPure.ts']);
});

test('R6. operations reference equipment CATEGORIES from the shared list; the 13 approved definitions are unchanged', async () => {
  assert.deepEqual([...ops.OPERATION_EQUIPMENT_CATEGORY_IDS], [...rec.RECONCILABLE_EQUIPMENT_CATEGORIES]);
  for (const id of ops.OPERATION_EQUIPMENT_CATEGORY_IDS) assert.ok(reg.getCategory(id), id);
  assert.equal(ops.validateOperationForSave([], { code: 'OP-X', nameAr: 'x', allowedEquipmentCategoryIds: ['rotaryKilns', 'tubeBallMills'] }, { hierarchyIndex: index() }).valid, true);
  assert.deepEqual(ops.validateOperationForSave([], { code: 'OP-X', nameAr: 'x', allowedEquipmentCategoryIds: ['bunkers'] }, { hierarchyIndex: index() }).issues.map((i: any) => i.field), ['allowedEquipmentCategoryIds'], 'storage is not an operation equipment category');
  const seed = await import(pathToFileURL(path.join(ROOT, 'src/services/operationSeedPure.ts')).href);
  assert.equal(seed.APPROVED_OPERATION_SEED.length, 13);
  assert.deepEqual(seed.APPROVED_OPERATION_SEED.filter((s: any) => s.allowedEquipmentCategoryIds.length).map((s: any) => [s.code, s.allowedEquipmentCategoryIds]), [['OP-PRESS', ['presses', 'furnaces']]]);
  assert.equal(/equipmentId|equipmentIds/.test(interfaceBlock('Operation')), false, 'no equipment record hard-wired into an operation');
});

// ==================================================
// H. HISTORICAL SAFETY
// ==================================================

test('H1. ProductionStageType keeps its eight stages (Step 8C-5 appends three)', () => {
  const types = readSource('src/types/index.ts');
  const start = types.indexOf('export type ProductionStageType');
  const block = types.slice(start, types.indexOf(';', start));
  const keys = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['pressing', 'rotary_furnace', 'chinese_mills', 'tube_ball_mills', 'mortar_concrete', 'mixing', 'lightweight_foam', 'sorting', 'thermal_concrete', 'tunnel_kiln', 'handmade_brick']);
});

test('H2. the stage collections are unchanged (Step 8C-5 appends three)', () => {
  assert.deepEqual(stageBounds.STAGE_COLLECTION_NAMES, {
    pressing: 'production',
    rotary_furnace: 'stage_rotary_furnace',
    chinese_mills: 'stage_chinese_mills',
    tube_ball_mills: 'stage_tube_ball_mills',
    mortar_concrete: 'stage_mortar_concrete',
    mixing: 'stage_mixing',
    lightweight_foam: 'stage_lightweight_foam',
    sorting: 'stage_sorting',
    // Phase 1 Step 8C-5 (approved): the three remaining production areas, appended.
    thermal_concrete: 'stage_thermal_concrete',
    tunnel_kiln: 'stage_tunnel_kiln',
    handmade_brick: 'stage_handmade_brick',
  });
});

test('H3. historical record models keep their free-text and id fields exactly', () => {
  const tbm = interfaceBlock('TubeBallMillsRecord');
  for (const f of ['millType: string;', 'millTypeId?: string;', 'storageBunker?: string;']) assert.ok(tbm.includes(f), f);
  assert.ok(interfaceBlock('RotaryFurnaceRecord').includes('machineInfo?: string;'));
  for (const name of ['TubeBallMillsRecord', 'RotaryFurnaceRecord', 'ProductionRecord']) {
    assert.equal(/rotaryKilnId|equipmentId|bunkerHierarchy/.test(interfaceBlock(name)), false, `${name} gained no new field`);
  }
});

test('H4. the equipment module reads and writes no production or stage data', () => {
  const code = readCode(EQ);
  assert.equal(/firebase|getDocs|addDoc|setDoc|updateDoc|stage_|'production'|machineInfo|storageBunker|millType\b/.test(code.replace(/^import type.*$/gm, '')), false);
});

// ==================================================
// U. MASTER DATA REUSE
// ==================================================

test('U1. one Equipment group in the navigation; the machine types are its sub-categories, not primary categories', () => {
  const ids = [...panels.PANEL_CATEGORY_IDS];
  assert.ok(ids.includes('equipment'));
  for (const t of ['presses', 'furnaces', 'furnaceCars', 'mills', 'tubeBallMills', 'bunkers', 'rotaryKilns']) assert.equal(ids.includes(t), false, t);
  assert.deepEqual(reg.subCategories('equipment').map((c: any) => c.tab), ['presses', 'furnaces', 'furnaceCars', 'mills', 'tubeBallMills', 'bunkers', 'rotaryKilns']);
  const group = reg.getCategory('equipment');
  assert.equal(group.collection, null, 'a group, not a store');
  assert.equal(reg.browsableCategories().some((c: any) => c.id === 'equipment'), false);
  assert.equal(reg.navigationCategoryIdForTab('rotaryKilns', panels.panelCategories()), 'equipment');
  assert.equal(reg.navigationCategoryIdForTab('products', panels.panelCategories()), 'products');
  assert.equal(reg.categoryForTab('presses').id, 'presses', 'the group never shadows a real category');
});

test('U2. the screen switches the existing tab engine - no second equipment page or navigation', () => {
  const view = readCode(VIEW);
  assert.ok(/id="master-data-equipment-subcategories"/.test(view));
  assert.ok(/onClick=\{\(\) => setActiveTab\(sc\.tab as MasterDataTab\)\}/.test(view));
  assert.equal((view.match(/updateMasterDataItem\(/g) || []).length, 1, 'still one shared update');
  assert.equal((view.match(/createMasterDataItem\(/g) || []).length, 1, 'still one shared create');
  const app = readCode('src/App.tsx');
  assert.equal(/Equipment(Management|View|Page)/.test(app), false, 'no new top-level page');
  const components = fs.readdirSync(path.join(ROOT, 'src/components/masterData'));
  assert.equal(components.some((f) => /equipment/i.test(f)), false, 'no separate equipment component');
});

test('U3. completed equipment saves through the validated shape, admin-gated, and is retired rather than deleted', () => {
  const view = readCode(VIEW);
  assert.ok(/if \(isCompletedEquipmentTab\(activeTab\)\) \{\s*if \(!canImportMasterData\)[\s\S]*?validateEquipmentForSave\(activeTab, items, formData, \{\s*hierarchyIndex: linkHierarchyIndex,/.test(view));
  assert.ok(/dataToWrite = equipmentPayloadForSave\(activeTab, formData\);/.test(view));
  assert.ok(/if \(isCompletedEquipmentTab\(activeTab\)\) \{ setDeleteConfirmItem\(null\); return; \}/.test(view), 'delete refused');
  // Step 1E widened the same gate to Job References and Batches (isRetireOnlyTab).
  assert.ok(/const isRetireOnlyTab = isCompletedEquipment \|\| isJobBatchTab\b/.test(view));
  assert.ok(/onClick=\{\(\) => setDeleteConfirmItem\(item\)\}\s+className=\{`w-7 h-7 rounded-lg \$\{isRetireOnlyTab \? 'hidden' : 'flex'\}/.test(view), 'delete button hidden');
  assert.ok(/id="master-data-add-btn"[\s\S]{0,120}\$\{isRetireOnlyTab && !canImportMasterData \? 'hidden' : 'flex'\}/.test(view), 'Add hidden without the gate');
  assert.ok(/onClick=\{\(\) => handleOpenEdit\(item\)\}\s+className=\{`w-7 h-7 rounded-lg \$\{isRetireOnlyTab && !canImportMasterData \? 'hidden' : 'flex'\}/.test(view), 'Edit hidden without the gate');
  assert.ok(/if \(isCompletedEquipmentTab\(activeTab\) && !canImportMasterData\) return;/.test(view), 'toggle gated');
  assert.ok(/!isCompletedEquipment && \(\s*<button\s+id="master-data-bulk-link-btn"/.test(view), 'no bulk import for them');
});

test('U4. the hierarchy-link selector and column cover the linked equipment tabs through the shared list; permissions are the existing ones', () => {
  const view = readCode(VIEW);
  assert.ok(/const isEquipmentTab = isEquipmentLinkTab\(activeTab\);/.test(view));
  assert.ok(/validateEquipmentLink\(linkHierarchyIndex, formData\.hierarchyNodeId\)/.test(view), 'existing link check kept for every linked tab');
  const perms = readCode('src/types/permissions.ts');
  assert.equal(/rotaryKiln|tubeBallMill|bunker/i.test(perms), false, 'no new permission keys');
  const header = view.slice(view.indexOf("'Active Status'"), view.indexOf("'Actions'"));
  assert.ok(header.includes("'Hierarchy'"), 'the Hierarchy header sits after Active Status, matching its row cell');
});

test('U5. no Odoo-specific equipment fields', () => {
  for (const name of ['TubeBallMill', 'Bunker', 'RotaryKiln', 'Press', 'Furnace', 'Mill']) {
    assert.equal(/odoo/i.test(interfaceBlock(name)), false, name);
  }
  assert.equal(/odoo/i.test(readCode(EQ)), false);
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

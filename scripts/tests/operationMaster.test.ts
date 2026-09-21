/**
 * OPERATION MASTER - Phase 1 Step 1C.
 *
 * V  validation: code, names, active state, legacy-stage mapping, cost-centre
 *    reference through the shared hierarchy, equipment categories
 * L  the legacy stage architecture is unchanged and only read
 * U  Master Data reuse: the registered `stages` collection, the existing
 *    screen, audited services, existing permission gate, no delete
 *
 * The rules module is pure and runs as shipped. The screen and services import
 * Firebase, so their wiring is pinned by source inspection with comments
 * stripped.
 *
 * Run: npx tsx scripts/tests/operationMaster.test.ts
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

console.log('operationMaster.test.ts');

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

let ops: any;
let hier: any;
let stageBounds: any;
let reg: any;
let panels: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  ops = await load('src/services/operationMasterPure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
  stageBounds = await load('src/services/stageQueryBoundsPure.ts');
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  panels = await load('src/services/masterDataPanelsPure.ts');
}

const OPS = 'src/services/operationMasterPure.ts';
const VIEW = 'src/components/masterData/MasterDataView.tsx';

/** A hierarchy shaped like costCenterHierarchy: document id = sheet1Code. */
const index = () => hier.buildHierarchyIndex([
  { id: '5', code: '5', parentId: null },
  { id: '511', code: '511', parentId: '5' },
  { id: '5111', code: '5111', parentId: '511' },
]);
const ctx = (editingId: string | null = null) => ({ hierarchyIndex: index(), editingId });
const fields = (v: any) => v.issues.map((i: any) => i.field);

const rotaryKiln = { id: 'autoId01', code: 'OP-RK', nameAr: 'الفرن الدوار', nameEn: 'Rotary Kiln', legacyStageKey: 'rotary_furnace', hierarchyNodeId: '511', allowedEquipmentCategoryIds: [], defaultOrder: 2, active: true };
const pressing = { id: 'autoId02', code: 'OP-PR', nameAr: 'التشكيل والمكابس', nameEn: 'Pressing', legacyStageKey: 'pressing', allowedEquipmentCategoryIds: ['presses', 'furnaces'], defaultOrder: 1, active: true };

// ==================================================
// V. VALIDATION
// ==================================================

test('V1. an operation with a valid code is valid, and the save shape carries only operation fields', () => {
  const v = ops.validateOperationForSave([], { code: ' OP-EXT ', nameAr: 'البثق', nameEn: 'Extruder' }, ctx());
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  const payload = ops.operationPayloadForSave({ id: 'x', createdAt: 't', externalRefs: [{ system: 'odoo', externalId: '1' }], code: ' OP-EXT ', nameAr: 'البثق', nameEn: 'Extruder' });
  assert.deepEqual(Object.keys(payload).sort(), ['active', 'allowedEquipmentCategoryIds', 'code', 'defaultOrder', 'description', 'hierarchyNodeId', 'legacyStageKey', 'nameAr', 'nameEn']);
  assert.equal(payload.code, 'OP-EXT');
});

test('V2. duplicate operation codes are rejected (exact after the existing code normalisation), inactive included', () => {
  assert.deepEqual(fields(ops.validateOperationForSave([rotaryKiln], { code: 'op-rk', nameAr: 'x' }, ctx())), ['code']);
  assert.deepEqual(fields(ops.validateOperationForSave([{ ...rotaryKiln, active: false }], { code: 'OP-RK', nameAr: 'x' }, ctx())), ['code'], 'retired codes stay reserved');
  assert.equal(ops.validateOperationForSave([rotaryKiln], { ...rotaryKiln }, ctx('autoId01')).valid, true, 'editing itself is not a duplicate');
  assert.equal(ops.validateOperationForSave([rotaryKiln], { code: 'OP-RK2', nameAr: 'x' }, ctx()).valid, true, 'a different code is not a near-match');
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: '  ', nameAr: 'x' }, ctx())), ['code']);
});

test('V3. Arabic and English names are preserved exactly (trimmed only); Arabic is required', () => {
  const p = ops.operationPayloadForSave({ code: 'OP-RK', nameAr: '  الفرن الدوار ', nameEn: ' Rotary Kiln ' });
  assert.equal(p.nameAr, 'الفرن الدوار');
  assert.equal(p.nameEn, 'Rotary Kiln');
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: 'OP-X', nameEn: 'Only English' }, ctx())), ['nameAr']);
});

test('V4. active / inactive state works; retiring is always allowed', () => {
  assert.equal(ops.operationPayloadForSave({ code: 'A', nameAr: 'a' }).active, true, 'active by default');
  assert.equal(ops.operationPayloadForSave({ code: 'A', nameAr: 'a', active: false }).active, false);
  assert.equal(ops.validateOperationActiveToggle([rotaryKiln], rotaryKiln).valid, true, 'deactivating is always allowed');
});

test('V5/V7. legacy stage mapping is optional - a new operation with no legacy stage is valid', () => {
  const v = ops.validateOperationForSave([pressing, rotaryKiln], { code: 'OP-PACK', nameAr: 'التعبئة', nameEn: 'Packing', legacyStageKey: '' }, ctx());
  assert.equal(v.valid, true);
  assert.equal(ops.operationPayloadForSave({ code: 'OP-PACK', nameAr: 'x', legacyStageKey: '' }).legacyStageKey, null);
});

test('V6. every existing legacy stage can map to an operation', () => {
  assert.deepEqual([...ops.LEGACY_STAGE_KEYS], Object.keys(stageBounds.STAGE_COLLECTION_NAMES), 'read from the one existing map');
  const existing: any[] = [];
  ops.LEGACY_STAGE_KEYS.forEach((key: string, i: number) => {
    const draft = { code: `OP-${i + 1}`, nameAr: key, legacyStageKey: key, defaultOrder: i + 1 };
    const v = ops.validateOperationForSave(existing, draft, ctx());
    assert.equal(v.valid, true, `${key}: ${JSON.stringify(v.issues)}`);
    existing.push({ id: `id${i}`, ...ops.operationPayloadForSave(draft) });
  });
  assert.equal(existing.length, 11, 'eight legacy stages + the three Step 8C-5 record types');
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: 'X', nameAr: 'x', legacyStageKey: 'rotary_kiln' }, ctx())), ['legacyStageKey'], 'no invented stage keys');
});

test('V6b. one legacy stage may not map to two ACTIVE operations; reactivation is checked too', () => {
  assert.deepEqual(fields(ops.validateOperationForSave([rotaryKiln], { code: 'OP-RK-NEW', nameAr: 'x', legacyStageKey: 'rotary_furnace' }, ctx())), ['legacyStageKey']);
  assert.equal(ops.validateOperationForSave([rotaryKiln], { code: 'OP-RK-OLD', nameAr: 'x', legacyStageKey: 'rotary_furnace', active: false }, ctx()).valid, true, 'an inactive operation may keep the mapping');
  const retired = { id: 'autoId09', code: 'OP-RK-OLD', nameAr: 'x', legacyStageKey: 'rotary_furnace', active: false };
  assert.deepEqual(fields(ops.validateOperationActiveToggle([rotaryKiln, retired], retired)), ['legacyStageKey'], 'cannot reactivate while another active operation holds the stage');
  assert.equal(ops.validateOperationActiveToggle([{ ...rotaryKiln, active: false }, retired], retired).valid, true);
});

test('V8. the cost-centre reference is checked against the shared hierarchy index', () => {
  assert.equal(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', hierarchyNodeId: '5111' }, ctx()).valid, true);
  assert.equal(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', hierarchyNodeId: '' }, ctx()).valid, true, 'optional');
  assert.ok(/context\.hierarchyIndex\.byId\.has\(op\.hierarchyNodeId\)/.test(readCode(OPS)), 'uses the resolver index, no copy of the hierarchy');
  const view = readCode(VIEW);
  assert.ok(/validateOperationForSave\(items\.map\(readOperation\), formData, \{\s*hierarchyIndex: linkHierarchyIndex,/.test(view), 'the screen passes the existing cost-centre index');
});

test('V9. invalid hierarchy references are rejected - never matched by name or prefix', () => {
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', hierarchyNodeId: '9999' }, ctx())), ['hierarchyNodeId']);
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', hierarchyNodeId: '51' }, ctx())), ['hierarchyNodeId'], 'a code prefix is not a node');
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', hierarchyNodeId: '511' }, { hierarchyIndex: hier.buildHierarchyIndex([]) })), ['hierarchyNodeId'], 'an unloaded hierarchy fails closed');
});

test('V10. allowed equipment categories must be existing equipment category ids', () => {
  // Phase 1 Step 1D added Tube/Ball Mills and Rotary Kilns to the shared equipment categories.
  assert.deepEqual([...ops.OPERATION_EQUIPMENT_CATEGORY_IDS], ['presses', 'furnaces', 'mills', 'tubeBallMills', 'rotaryKilns']);
  for (const id of ops.OPERATION_EQUIPMENT_CATEGORY_IDS) assert.ok(reg.getCategory(id), `${id} is a registry category`);
  assert.equal(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', allowedEquipmentCategoryIds: ['presses', 'furnaces', 'presses'] }, ctx()).valid, true);
  assert.deepEqual(ops.operationPayloadForSave({ code: 'A', nameAr: 'a', allowedEquipmentCategoryIds: ['presses', 'presses'] }).allowedEquipmentCategoryIds, ['presses'], 'deduplicated');
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', allowedEquipmentCategoryIds: ['extruders'] }, ctx())), ['allowedEquipmentCategoryIds']);
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', allowedEquipmentCategoryIds: ['products'] }, ctx())), ['allowedEquipmentCategoryIds'], 'a non-equipment category is refused');
});

test('V10b. default order is optional metadata: a whole number of zero or more', () => {
  assert.equal(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', defaultOrder: '' }, ctx()).valid, true);
  assert.equal(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', defaultOrder: '3' }, ctx()).valid, true);
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', defaultOrder: '2.5' }, ctx())), ['defaultOrder']);
  assert.deepEqual(fields(ops.validateOperationForSave([], { code: 'A', nameAr: 'a', defaultOrder: '-1' }, ctx())), ['defaultOrder']);
});

test('V11. an inactive operation remains readable, with its references intact', () => {
  const stored = { id: 'autoId07', code: 'OP-OLD', nameAr: 'قديمة', legacyStageKey: 'sorting', active: false, externalRefs: [{ system: 'odoo', model: 'mrp.workcenter', externalId: '7' }], createdAt: '2026-01-01T00:00:00.000Z' };
  const op = ops.readOperation(stored);
  assert.equal(op.active, false);
  assert.equal(op.id, 'autoId07');
  assert.equal(op.legacyStageKey, 'sorting');
  assert.deepEqual(op.externalRefs, stored.externalRefs, 'Step 1A references survive a read');
  assert.equal(ops.readOperation({ id: 'y', code: 'Z', nameAr: 'z', legacyStageKey: 'bogus' }).legacyStageKey, null, 'an unknown stored key reads as none');
});

// ==================================================
// L. LEGACY STAGE ARCHITECTURE UNCHANGED
// ==================================================

test('L1/T12. no production record is changed: the module writes nothing and touches no stage collection', () => {
  const code = readCode(OPS);
  assert.equal(/firebase|getDocs|setDoc|updateDoc|addDoc|deleteDoc|writeBatch|createMasterDataItem|updateMasterDataItem/.test(code), false);
  assert.equal(/'production'|stage_rotary|stage_chinese|createStageRecord|updateStageRecord|productionService|stageRecordService/.test(code), false);
  const view = readCode(VIEW);
  const start = view.indexOf('let dataToWrite: Record<string, any> = formData;');
  const saveBranch = view.slice(start, view.indexOf('setIsModalOpen(false);', start));
  assert.ok(start > 0 && saveBranch.length > 0);
  assert.equal(/'production'|STAGE_COLLECTION_NAMES|stage_/.test(saveBranch), false, 'saves write only the active master-data collection');
  assert.ok(/MASTER_DATA_COLLECTIONS\[activeTab\]/.test(saveBranch), 'the one shared write call, keyed by tab (stages -> stages)');
});

test('L2/T13. ProductionStageType keeps its eight stages (Step 8C-5 appends three)', () => {
  const types = readCode('src/types/index.ts').replace(/[ \t]*\/\/.*$/gm, '');
  assert.ok(/export type ProductionStageType = \s*\| 'pressing'\s*\| 'rotary_furnace'\s*\| 'chinese_mills'\s*\| 'tube_ball_mills'\s*\| 'mortar_concrete'\s*\| 'mixing'\s*\| 'lightweight_foam'\s*\| 'sorting'\s*\| 'thermal_concrete'\s*\| 'tunnel_kiln'\s*\| 'handmade_brick';/.test(types));
});

test('L3/T14. STAGE_COLLECTION_NAMES is unchanged (Step 8C-5 appends three)', () => {
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
  const reportingEngine = readCode('src/services/reportingEngine.ts');
  assert.ok(/export const ALL_STAGES: ProductionStageType\[\] = Object\.keys\(STAGE_COLLECTION_NAMES\)/.test(reportingEngine), 'reports still enumerate the legacy stages');
});

// ==================================================
// U. MASTER DATA REUSE
// ==================================================

test('U1. the registered `stages` collection is reused - no new collection', () => {
  const svc = readCode('src/services/masterDataService.ts');
  assert.ok(/stages: 'stages',/.test(svc));
  const category = reg.getCategory('operations');
  assert.equal(category.collection, 'stages');
  assert.equal(category.tab, 'stages');
  assert.equal(category.productionFilter, null, 'not offered as a production filter');
  const rules = readSource('firestore.rules');
  const block = /match \/stages\/\{operationId\} \{([\s\S]*?)\}/.exec(rules);
  assert.ok(block, 'rules block present');
  assert.ok(/allow read: if isSignedIn\(\);/.test(block![1]) && /allow write: if isAdmin\(\);/.test(block![1]), 'the Master Data pattern, no new privilege');
  assert.equal((rules.match(/match \/operations/g) || []).length, 0);
});

test('U2. Operations appear in the existing Master Data navigation - no new page', () => {
  assert.ok(panels.PANEL_CATEGORY_IDS.includes('operations'));
  const view = readCode(VIEW);
  assert.ok(/\{ id: 'stages', label: language === 'ar' \? 'العمليات الإنتاجية' : 'Operations', icon: Workflow \}/.test(view));
  assert.ok(/id="operation-master-form"/.test(view));
  assert.equal(/'operations-page'|'operation-master'/.test(readCode('src/types/index.ts')), false, 'no new NavigationPage');
});

test('U3. writes use the audited master-data services; operations are retired, never deleted', () => {
  const view = readCode(VIEW);
  assert.ok(/dataToWrite = operationPayloadForSave\(formData\);/.test(view), 'only Operation fields reach the write');
  assert.ok(/await updateMasterDataItem\(MASTER_DATA_COLLECTIONS\[activeTab\], editingItem\.id, dataToWrite\);/.test(view));
  assert.ok(/await createMasterDataItem\(MASTER_DATA_COLLECTIONS\[activeTab\], dataToWrite\);/.test(view));
  assert.equal((view.match(/updateMasterDataItem\(/g) || []).length, 1, 'no second write path');
  assert.ok(/validateOperationActiveToggle\(items\.map\(readOperation\), readOperation\(item\)\)/.test(view), 'toggle goes through toggleMasterDataActive after the check');
  assert.ok(/if \(activeTab === 'stages'\) \{ setDeleteConfirmItem\(null\); return; \}/.test(view), 'the delete handler refuses');
  assert.ok(/\{activeTab !== 'stages' && \(\s*<button\s+type="button"\s+onClick=\{\(\) => setDeleteConfirmItem\(item\)\}/.test(view), 'no delete button');
  const svc = readCode('src/services/masterDataService.ts');
  assert.ok(/logAuditAction\('CREATE', collectionName/.test(svc) && /logAuditAction\('UPDATE', collectionName/.test(svc), 'existing audit on both paths');
});

test('U4. the existing Master Data permission gate controls operation edits - no new permission', () => {
  const view = readCode(VIEW);
  assert.ok(/if \(!canImportMasterData\) \{\s*throw new Error/.test(view), 'save refuses');
  assert.ok(/if \(activeTab === 'stages'\) \{\s*if \(!canImportMasterData\) return;/.test(view), 'toggle refuses');
  assert.ok(/\{\(activeTab !== 'stages' \|\| canImportMasterData\) && \(\s*<button\s+id="master-data-add-btn"/.test(view), 'no Add button without it');
  assert.ok(/\{\(activeTab !== 'stages' \|\| canImportMasterData\) && \(\s*<button\s+type="button"\s+onClick=\{\(\) => handleOpenEdit\(item\)\}/.test(view), 'no Edit button without it');
  const perms = readCode('src/types/permissions.ts');
  assert.equal(/operations\.|operation\.edit|stages\.manage/.test(perms), false);
});

test('U5. Operation is the configuration type; distinct fields for process, cost centre and equipment', () => {
  const types = readCode('src/types/index.ts');
  const start = types.indexOf('export interface Operation extends WithExternalReferences {');
  assert.ok(start >= 0, 'Step 1A external references are available on operations');
  const block = types.slice(start, types.indexOf('\n}', start));
  for (const f of ['code: string;', 'nameAr: string;', 'nameEn?: string;', 'legacyStageKey?: ProductionStageType | null;', 'hierarchyNodeId?: string | null;', 'allowedEquipmentCategoryIds?: string[];', 'defaultOrder?: number | null;', 'active: boolean;']) {
    assert.ok(block.includes(f), f);
  }
  assert.equal(/odoo/i.test(block), false, 'no Odoo-specific fields');
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

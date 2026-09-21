/**
 * OPERATION MASTER SEED + SETUP-DRIVEN ROUTING FOUNDATION - Phase 1 Step 1C-Final.
 *
 * S  the approved seed list and its safe, idempotent plan / execution
 * R  routing foundation: an Operation is setup data, never a product route
 * W  wiring: existing Operations tab, audited create, admin gate, rule unchanged
 *
 * The planner is pure and runs as shipped against in-memory "stored" documents.
 * The dialog imports Firebase, so its wiring is pinned by source inspection.
 *
 * Run: npx tsx scripts/tests/operationSeed.test.ts
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

console.log('operationSeed.test.ts');

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

let seed: any;
let ops: any;
let hier: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  seed = await load('src/services/operationSeedPure.ts');
  ops = await load('src/services/operationMasterPure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
}

const SEED = 'src/services/operationSeedPure.ts';
const MODAL = 'src/components/masterData/OperationSeedModal.tsx';
const VIEW = 'src/components/masterData/MasterDataView.tsx';

/** An in-memory `stages` collection that behaves like the audited create. */
function memoryStore(initial: any[] = []) {
  const docs = initial.map((d) => ({ ...d }));
  let n = 0;
  const writes: any[] = [];
  return {
    docs,
    writes,
    readStored: async () => docs.map((d) => ({ ...d })),
    create: async (payload: any) => {
      writes.push(payload);
      docs.push({ id: `auto${++n}`, ...payload });
    },
  };
}

const APPROVED: Array<[string, string, string, string | null, string[]]> = [
  ['OP-PRESS', 'التشكيل والكبس', 'Pressing', 'pressing', ['presses', 'furnaces']],
  ['OP-KILN', 'الفرن الدوار', 'Rotary Kiln', 'rotary_furnace', []],
  ['OP-CMILL', 'الطحن بالطواحين الصينية', 'Chinese Milling', 'chinese_mills', []],
  ['OP-TBM', 'الطحن بطواحين الأنابيب والكرات', 'Tube & Ball Milling', 'tube_ball_mills', []],
  ['OP-MIX', 'الخلط والتجهيز', 'Mixing', 'mixing', []],
  ['OP-MORTAR', 'إنتاج المونة', 'Mortar Production', 'mortar_concrete', []],
  ['OP-TCONC', 'إنتاج الخرسانة الحرارية', 'Thermal Concrete Production', null, []],
  ['OP-TUNNEL-KILN', 'حريق الفرن النفقي', 'Tunnel Kiln', null, []],
  ['OP-SORT', 'الفرز', 'Sorting', 'sorting', []],
  ['OP-PACK', 'التعبئة والتغليف', 'Packing & Packaging', null, []],
  ['OP-HAND', 'تصنيع الطوب اليدوي', 'Hand-made Brick Production', null, []],
  ['OP-FOAM', 'إنتاج الطوب الفوم', 'Foam Brick Production', 'lightweight_foam', []],
  ['OP-EXTRUDER', 'البثق', 'Extrusion', null, []],
];

// ==================================================
// S. SEED
// ==================================================

test('S1. all 13 approved operations are represented exactly, in the approved order', () => {
  assert.equal(seed.APPROVED_OPERATION_SEED.length, 13);
  seed.APPROVED_OPERATION_SEED.forEach((s: any, i: number) => {
    const [code, nameAr, nameEn, legacy, equipment] = APPROVED[i];
    assert.deepEqual(
      { code: s.code, nameAr: s.nameAr, nameEn: s.nameEn, legacyStageKey: s.legacyStageKey, defaultOrder: s.defaultOrder, allowedEquipmentCategoryIds: s.allowedEquipmentCategoryIds },
      { code, nameAr, nameEn, legacyStageKey: legacy, defaultOrder: i + 1, allowedEquipmentCategoryIds: equipment },
    );
  });
  const code = readCode(SEED);
  assert.equal(/castable/i.test(code), false, 'no Castable / OP-CASTABLE');
});

test('S2. operation codes are unique (also after code normalisation) and every row passes the Operation Master rules', () => {
  const codes = seed.APPROVED_OPERATION_SEED.map((s: any) => s.code.trim().toUpperCase());
  assert.equal(new Set(codes).size, 13);
  const existing: any[] = [];
  for (const s of seed.APPROVED_OPERATION_SEED) {
    const v = ops.validateOperationForSave(existing, { ...s, active: true }, { hierarchyIndex: hier.buildHierarchyIndex([]) });
    assert.equal(v.valid, true, `${s.code}: ${JSON.stringify(v.issues)}`);
    existing.push(ops.operationPayloadForSave({ ...s, active: true }));
  }
});

test('S3. an empty collection plans and creates all 13 through the injected create, with the save shape only', async () => {
  const plan = seed.planOperationSeed([]);
  assert.equal(plan.summary.CREATE, 13);
  assert.equal(plan.toCreate.length, 13);
  const store = memoryStore();
  const r = await seed.executeOperationSeed({ readStored: store.readStored, create: store.create });
  assert.equal(r.createdCodes.length, 13);
  assert.deepEqual(r.failed, []);
  for (const w of store.writes) {
    assert.deepEqual(Object.keys(w).sort(), ['active', 'allowedEquipmentCategoryIds', 'code', 'defaultOrder', 'description', 'hierarchyNodeId', 'legacyStageKey', 'nameAr', 'nameEn']);
    assert.equal(w.active, true);
    assert.equal(w.hierarchyNodeId, null);
  }
});

test('S4. re-running the seed is idempotent: 13 x EXISTS and zero writes', async () => {
  const store = memoryStore();
  await seed.executeOperationSeed({ readStored: store.readStored, create: store.create });
  const writesAfterFirst = store.writes.length;
  const second = await seed.executeOperationSeed({ readStored: store.readStored, create: store.create });
  assert.equal(second.plan.summary.EXISTS, 13);
  assert.equal(second.createdCodes.length, 0);
  assert.equal(store.writes.length, writesAfterFirst);
  assert.equal(store.docs.length, 13, 'no duplicates');
});

test('S5. existing records are preserved and never overwritten; only the missing ones are created', async () => {
  const configuredKiln = {
    id: 'kept1', code: 'OP-KILN', nameAr: 'الفرن الدوار', nameEn: 'Rotary Kiln', legacyStageKey: 'rotary_furnace',
    defaultOrder: 2, allowedEquipmentCategoryIds: [], hierarchyNodeId: '511', description: 'user note', active: false,
    externalRefs: [{ system: 'other', externalId: '9' }],
  };
  const store = memoryStore([configuredKiln]);
  const r = await seed.executeOperationSeed({ readStored: store.readStored, create: store.create });
  const row = r.plan.rows.find((x: any) => x.seed.code === 'OP-KILN');
  assert.equal(row.outcome, 'EXISTS', 'user configuration (cost centre, description, inactive) is not a difference');
  assert.equal(row.existingInactive, true);
  assert.equal(r.createdCodes.length, 12);
  assert.equal(store.writes.some((w: any) => w.code === 'OP-KILN'), false);
  assert.deepEqual(store.docs.find((d: any) => d.id === 'kept1'), configuredKiln, 'stored record untouched');
  const seedSrc = readCode(SEED);
  assert.equal(/update|delete|setDoc|merge/i.test(seedSrc.replace(/operationPayloadForSave|validateOperationForSave/g, '')), false, 'the seed module has no update/delete path');
});

test('S6. same code with different approved values is a CODE_CONFLICT, reported and not written', async () => {
  const stored = [{ id: 'x1', code: 'op-press', nameAr: 'التشكيل والمكابس', nameEn: 'Pressing', legacyStageKey: 'pressing', defaultOrder: 1, allowedEquipmentCategoryIds: ['presses'], active: true }];
  const store = memoryStore(stored);
  const r = await seed.executeOperationSeed({ readStored: store.readStored, create: store.create });
  const row = r.plan.rows.find((x: any) => x.seed.code === 'OP-PRESS');
  assert.equal(row.outcome, 'CODE_CONFLICT');
  assert.equal(row.existingId, 'x1');
  assert.deepEqual(row.differingFields, ['nameAr', 'allowedEquipmentCategoryIds']);
  assert.equal(store.writes.some((w: any) => w.code === 'OP-PRESS'), false);
  assert.equal(store.docs.find((d: any) => d.id === 'x1').nameAr, 'التشكيل والمكابس', 'not overwritten');
  assert.equal(r.plan.summary.CREATE, 12, 'other rows still proceed');
  const reordered = seed.planOperationSeed([{ ...stored[0], nameAr: 'التشكيل والكبس', allowedEquipmentCategoryIds: ['furnaces', 'presses'] }]);
  assert.equal(reordered.rows[0].outcome, 'EXISTS', 'category order is not a difference');
});

test('S7. a legacy stage already held by another active operation is a LEGACY_STAGE_CONFLICT - no second active mapping', async () => {
  const holder = { id: 'h1', code: 'OP-SORTING-OLD', nameAr: 'فرز', legacyStageKey: 'sorting', active: true };
  const store = memoryStore([holder]);
  const r = await seed.executeOperationSeed({ readStored: store.readStored, create: store.create });
  const row = r.plan.rows.find((x: any) => x.seed.code === 'OP-SORT');
  assert.equal(row.outcome, 'LEGACY_STAGE_CONFLICT');
  assert.equal(row.existingId, 'h1');
  assert.equal(row.existingCode, 'OP-SORTING-OLD');
  assert.equal(store.writes.some((w: any) => w.legacyStageKey === 'sorting'), false);
  assert.equal(store.docs.filter((d: any) => d.active !== false && d.legacyStageKey === 'sorting').length, 1);
  const retiredHolder = seed.planOperationSeed([{ ...holder, active: false }]);
  assert.equal(retiredHolder.rows.find((x: any) => x.seed.code === 'OP-SORT').outcome, 'CREATE', 'an inactive holder does not block');
});

test('S8. operations with no legacy stage are allowed and several coexist', () => {
  const plan = seed.planOperationSeed([]);
  const nonLegacy = plan.rows.filter((r: any) => r.seed.legacyStageKey === null);
  assert.deepEqual(nonLegacy.map((r: any) => r.seed.code), ['OP-TCONC', 'OP-TUNNEL-KILN', 'OP-PACK', 'OP-HAND', 'OP-EXTRUDER']);
  assert.ok(nonLegacy.every((r: any) => r.outcome === 'CREATE'));
});

test('S9. execution re-reads immediately before writing and isolates a failing create', async () => {
  const store = memoryStore();
  let reads = 0;
  const r = await seed.executeOperationSeed({
    readStored: async () => { reads++; return [{ id: 'late', code: 'OP-MIX', nameAr: 'الخلط والتجهيز', nameEn: 'Mixing', legacyStageKey: 'mixing', defaultOrder: 5, allowedEquipmentCategoryIds: [], active: true }]; },
    create: async (p: any) => { if (p.code === 'OP-FOAM') throw new Error('permission-denied'); await store.create(p); },
  });
  assert.equal(reads, 1);
  assert.equal(store.writes.some((w: any) => w.code === 'OP-MIX'), false, 'a record created by someone else meanwhile is not duplicated');
  assert.deepEqual(r.failed, [{ code: 'OP-FOAM', error: 'permission-denied' }]);
  assert.equal(r.createdCodes.length, 11);
});

test('S10. malformed stored documents do not break the plan', () => {
  const plan = seed.planOperationSeed([{ id: 'junk' }, { id: 'junk2', code: 42 }, { id: 'legacyStage', name: 'Old stage' }] as any);
  assert.equal(plan.rows.length, 13);
});

// ==================================================
// R. ROUTING FOUNDATION
// ==================================================

test('R1. defaultOrder is metadata, not routing: duplicates are allowed and no product sequence exists on an Operation', () => {
  const plan = seed.planOperationSeed([{ id: 'o', code: 'OP-OTHER', nameAr: 'أخرى', defaultOrder: 1, active: true }]);
  assert.equal(plan.rows.find((r: any) => r.seed.code === 'OP-PRESS').outcome, 'CREATE', 'a shared default order is not a conflict');
  const types = readCode('src/types/index.ts');
  const start = types.indexOf('export interface Operation extends WithExternalReferences {');
  const block = types.slice(start, types.indexOf('\n}', start));
  assert.equal(/productId|productTypeId|routing|route|sequence|steps|version|effective/i.test(block), false, 'no product-specific routing fields');
});

test('R2. hierarchyNodeId is optional (a default only) and no equipment category is required', () => {
  const v = ops.validateOperationForSave([], { code: 'OP-NEW', nameAr: 'جديدة', active: true }, { hierarchyIndex: hier.buildHierarchyIndex([]) });
  assert.equal(v.valid, true, JSON.stringify(v.issues));
  const p = ops.operationPayloadForSave({ code: 'OP-NEW', nameAr: 'جديدة' });
  assert.equal(p.hierarchyNodeId, null);
  assert.deepEqual(p.allowedEquipmentCategoryIds, []);
  assert.equal(seed.APPROVED_OPERATION_SEED.filter((s: any) => s.allowedEquipmentCategoryIds.length > 0).map((s: any) => s.code).join(), 'OP-PRESS');
  assert.equal(seed.APPROVED_OPERATION_SEED.some((s: any) => 'hierarchyNodeId' in s), false, 'no cost centre invented by the seed');
});

test('R3. no routing, BOM or Odoo artefacts are introduced', () => {
  for (const rel of [SEED, MODAL]) {
    const code = readCode(rel);
    assert.equal(/odoo/i.test(code), false, `${rel}: no Odoo reference`);
    assert.equal(/routing|routeStep|bom\b|billOfMaterial/i.test(code), false, `${rel}: no routing/BOM`);
  }
  const src = path.join(ROOT, 'src');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [e.name]);
  // Routing arrived in Phase 1 Step 3 as configuration only; no other routing module or page exists.
  assert.deepEqual(walk(src).filter((f) => /routing/i.test(f)).sort(), ['RoutingVersionsModal.tsx', 'routingPure.ts', 'routingService.ts'], 'only the Step 3 routing setup files');
});

// ==================================================
// W. WIRING
// ==================================================

test('W1. the seed runs from the existing Operations tab, admin-gated, with no second operations manager', () => {
  const view = readCode(VIEW);
  assert.ok(/activeTab === 'stages' && canImportMasterData && \(\s*<button\s+id="master-data-operation-seed-btn"/.test(view));
  assert.ok(/<OperationSeedModal\s+isOpen=\{isOperationSeedOpen\}[\s\S]*?canSeed=\{canImportMasterData\}/.test(view));
  assert.equal((view.match(/updateMasterDataItem\(/g) || []).length, 1, 'still one shared update call');
});

test('W2. the dialog creates only through the audited createMasterDataItem on the stages collection, reading fresh', () => {
  const modal = readCode(MODAL);
  assert.ok(modal.includes('createMasterDataItem(MASTER_DATA_COLLECTIONS.stages, payload)'));
  assert.ok(/fetchMasterData<[^(]*>\(MASTER_DATA_COLLECTIONS\.stages, \{ skipCache: true \}\)/.test(modal));
  assert.equal(/updateMasterDataItem|deleteMasterDataItem|toggleMasterDataActive|firebase\/firestore|addDoc|setDoc|writeBatch/.test(modal), false);
  assert.ok(/disabled=\{!canSeed/.test(modal) && /if \(!canSeed/.test(modal), 'the button and the handler both respect the gate');
});

test('W3. the stages Firestore rule is exactly signed-in read / admin write', () => {
  const rules = readSource('firestore.rules');
  const m = rules.match(/match \/stages\/\{operationId\} \{([\s\S]*?)\n\s*\}/);
  assert.ok(m, 'stages block present');
  const body = m![1].split('\n').map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(body, ['allow read: if isSignedIn();', 'allow write: if isAdmin();']);
  assert.equal((rules.match(/match \/stages\//g) || []).length, 1);
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

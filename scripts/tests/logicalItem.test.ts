/**
 * NON-DESTRUCTIVE LOGICAL ITEM MAPPING - Phase 1 Step 2A.
 *
 * M  mapping: explicit pair -> one logical item, attach, idempotency
 * Q  uniqueness and conflicts: planned before any write, one write per decision
 * K  Keep Separate: persisted, distinguishable, withdrawable
 * R  records: products, materials, codes, mixtures never touched
 * A  analyzer and review dialog: reused, nothing automatic
 * B  BOM: record references kept, compared by logical identity
 * U  service, rules, permissions, audit
 *
 * Pure modules run as shipped. The service and dialog import Firebase, so
 * their wiring is pinned by source inspection with comments stripped; an
 * in-memory store drives the pure planner the way the service does.
 *
 * Run: npx tsx scripts/tests/logicalItem.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Phase 1 Step 8A: stageRecordService.ts may differ from HEAD only by the approved unit-label correction.
import { stageRecordServiceChangedBeyondApproved } from './stageRecordServiceBaseline';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('logicalItem.test.ts');

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

let li: any;
let ovl: any;
let bom: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  li = await load('src/services/logicalItemPure.ts');
  ovl = await load('src/services/itemOverlapAnalysisPure.ts');
  bom = await load('src/services/bomPure.ts');
}

const PURE = 'src/services/logicalItemPure.ts';
const SERVICE = 'src/services/logicalItemService.ts';
const MODAL = 'src/components/masterData/ItemOverlapReviewModal.tsx';
const VIEW = 'src/components/masterData/MasterDataView.tsx';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.values(o as any).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
}

/**
 * An in-memory store driven exactly the way logicalItemService drives Firestore:
 * plan from the stored state, refuse on CONFLICT, write at most one document.
 */
function store() {
  const items: any[] = [];
  const decisions: any[] = [];
  let seq = 0;
  const writes: Array<{ collection: string; op: 'create' | 'update'; id: string; data: any }> = [];
  const state = () => ({ items: items.map(li.readLogicalItem), decisions: decisions.map(li.readItemPairDecision) });
  return {
    items, decisions, writes, state,
    map(pair: any) {
      const s = state();
      const plan = li.planProductMaterialMapping(s.items, s.decisions, pair);
      if (plan.outcome === 'CONFLICT') throw new Error(plan.messageEn);
      if (plan.outcome === 'ALREADY_MAPPED') return plan;
      if (plan.outcome === 'CREATE') {
        const id = `li${++seq}`;
        const data = li.logicalItemPayloadForCreate(pair, { reason: 'CODE_AND_NAME_MATCH', userId: 'u1' });
        items.push({ id, ...data });
        writes.push({ collection: li.LOGICAL_ITEM_COLLECTION, op: 'create', id, data });
        return { ...plan, logicalItemId: id };
      }
      const target = items.find((i) => i.id === plan.logicalItemId);
      const patch = plan.outcome === 'ATTACH_MATERIAL' ? { materialId: pair.materialId } : { productId: pair.productId };
      Object.assign(target, patch);
      writes.push({ collection: li.LOGICAL_ITEM_COLLECTION, op: 'update', id: target.id, data: patch });
      return plan;
    },
    keep(pair: any) {
      const s = state();
      const plan = li.planKeepSeparate(s.items, s.decisions, pair);
      if (plan.outcome === 'CONFLICT') throw new Error(plan.messageEn);
      if (plan.outcome === 'ALREADY_KEPT_SEPARATE') return plan;
      const id = `d${++seq}`;
      const data = li.itemPairDecisionPayloadForCreate(pair, { reason: 'EXACT_NAME_MATCH', userId: 'u1' });
      decisions.push({ id, ...data });
      writes.push({ collection: li.ITEM_PAIR_DECISION_COLLECTION, op: 'create', id, data });
      return { ...plan, decisionId: id };
    },
  };
}

const product = deepFreeze({ id: 'p-kaolin', code: 'KAO-CAL', name: 'كاولين مكلسن', category: 'INTERMEDIATE', mixtureComponents: undefined });
const material = deepFreeze({ id: 'm-kaolin', code: 'KAO-CAL', name: 'كاولين مكلسن', costPerUnit: 1200, unit: 'طن' });
const pair = { productId: 'p-kaolin', materialId: 'm-kaolin' };

// ==================================================
// M. MAPPING
// ==================================================

test('1. a product and a material can be explicitly mapped', () => {
  const st = store();
  const plan = st.map(pair);
  assert.equal(plan.outcome, 'CREATE');
  assert.equal(st.writes.length, 1);
  assert.deepEqual(st.items[0], { id: plan.logicalItemId, productId: 'p-kaolin', materialId: 'm-kaolin', preferredSource: null, status: 'ACTIVE', reason: 'CODE_AND_NAME_MATCH', createdBy: 'u1', updatedBy: 'u1' });
});

test('2. the mapping creates one stable logical item identity that is neither record id, code nor external id', () => {
  const block = interfaceBlock('LogicalItem');
  assert.ok(block.includes('extends WithExternalReferences') && block.includes('productId?: string | null;') && block.includes('materialId?: string | null;'));
  const payload = li.logicalItemPayloadForCreate(pair, {});
  assert.equal('id' in payload, false, 'the id is the generated document id');
  assert.deepEqual(Object.keys(payload).sort(), ['createdBy', 'materialId', 'preferredSource', 'productId', 'reason', 'status', 'updatedBy']);
  assert.equal(payload.preferredSource, null, 'neither record wins by default');
  const svc = readCode(SERVICE);
  assert.ok(/const id = await createMasterDataItem\(LOGICAL_ITEM_COLLECTION, logicalItemPayloadForCreate\(pair,/.test(svc), 'Firestore generates the logicalItemId');
  const st = store();
  const id = st.map(pair).logicalItemId;
  assert.equal(li.resolveLogicalItemId(st.state().items, 'products', 'p-kaolin'), `logicalItem:${id}`);
  assert.equal(li.resolveLogicalItemId(st.state().items, 'materials', 'm-kaolin'), `logicalItem:${id}`, 'both records resolve to the same identity');
  assert.deepEqual(li.logicalItemSources(st.state().items[0]), [{ source: 'products', recordId: 'p-kaolin' }, { source: 'materials', recordId: 'm-kaolin' }]);
});

test('3/4. the product and material records are unchanged - mapping never receives or writes them', () => {
  const st = store();
  st.map(pair);
  st.keep({ productId: 'p-other', materialId: 'm-other' });
  assert.ok(st.writes.every((w) => w.collection === 'logicalItems' || w.collection === 'itemPairDecisions'));
  assert.deepEqual(product, { id: 'p-kaolin', code: 'KAO-CAL', name: 'كاولين مكلسن', category: 'INTERMEDIATE', mixtureComponents: undefined });
  assert.equal(material.costPerUnit, 1200);
  const svc = readCode(SERVICE);
  for (const m of svc.matchAll(/(createMasterDataItem|updateMasterDataItem)\(([A-Z_]+),/g)) {
    assert.ok(['LOGICAL_ITEM_COLLECTION', 'ITEM_PAIR_DECISION_COLLECTION'].includes(m[2]), `writes only the mapping stores, not ${m[2]}`);
  }
  // Step 3 registration READS products/materials (to re-run the analyzer); writes stay on the mapping stores.
  assert.equal(/(createMasterDataItem|updateMasterDataItem)\((MASTER_DATA_COLLECTIONS|'products'|'materials')/.test(svc), false, 'the service never writes a product or material collection');
});

test('5/6. product and material codes (and names, categories, costs) are never written', () => {
  const payloads = [li.logicalItemPayloadForCreate(pair, {}), li.itemPairDecisionPayloadForCreate(pair, {})];
  for (const p of payloads) {
    assert.equal(/code|name|category|cost|unit|stock|mixture/i.test(Object.keys(p).join(',')), false);
  }
  const code = readCode(PURE) + readCode(SERVICE);
  assert.equal(/\.code\s*=|\.name\s*=|productCode\s*:|materialCode\s*:/.test(code), false);
});

test('M2. attaching: a single-record logical item gains the other record instead of a second identity', () => {
  const productOnly = [{ id: 'li-p', productId: 'p-kaolin', materialId: null, status: 'ACTIVE' }].map(li.readLogicalItem);
  const plan = li.planProductMaterialMapping(productOnly, [], pair);
  assert.equal(plan.outcome, 'ATTACH_MATERIAL');
  assert.equal(plan.logicalItemId, 'li-p');
  const materialOnly = [{ id: 'li-m', productId: null, materialId: 'm-kaolin', status: 'ACTIVE' }].map(li.readLogicalItem);
  assert.equal(li.planProductMaterialMapping(materialOnly, [], pair).outcome, 'ATTACH_PRODUCT');
});

// ==================================================
// Q. UNIQUENESS AND CONFLICTS
// ==================================================

test('7. the same product cannot be actively mapped to two logical items', () => {
  const st = store();
  st.map(pair);
  assert.throws(() => st.map({ productId: 'p-kaolin', materialId: 'm-alumina' }), /product is already mapped to another logical item \(li1\)/);
  assert.equal(st.items.length, 1);
});

test('8. the same material cannot be actively mapped to two logical items', () => {
  const st = store();
  st.map(pair);
  assert.throws(() => st.map({ productId: 'p-alumina', materialId: 'm-kaolin' }), /material is already mapped to another logical item \(li1\)/);
});

test('9. a duplicate product+material mapping is never stored twice', () => {
  const st = store();
  st.map(pair);
  st.map(pair);
  st.map({ ...pair });
  assert.equal(st.items.length, 1);
  assert.equal(st.state().items.filter((i: any) => i.productId === 'p-kaolin' && i.materialId === 'm-kaolin').length, 1);
});

test('10. mapping is idempotent: resubmitting the same pair writes nothing and returns the same identity', () => {
  const st = store();
  const first = st.map(pair);
  const writes = st.writes.length;
  const again = st.map(pair);
  assert.equal(again.outcome, 'ALREADY_MAPPED');
  assert.equal(again.logicalItemId, first.logicalItemId);
  assert.equal(st.writes.length, writes);
  const svc = readCode(SERVICE);
  assert.ok(/if \(plan\.outcome === 'ALREADY_MAPPED'\) return \{ plan, logicalItemId: plan\.logicalItemId, wrote: false \};/.test(svc));
});

test('11. conflicts are detected before any write - a refused decision writes nothing, and each decision is one write', () => {
  const st = store();
  st.map(pair);
  const productOnly = { id: 'li-x', productId: 'p-2', materialId: null, status: 'ACTIVE' };
  const materialOnly = { id: 'li-y', productId: null, materialId: 'm-2', status: 'ACTIVE' };
  st.items.push(productOnly, materialOnly);
  const before = st.writes.length;
  const split = li.planProductMaterialMapping(st.state().items, [], { productId: 'p-2', materialId: 'm-2' });
  assert.equal(split.outcome, 'CONFLICT');
  assert.equal(split.conflicts[0].kind, 'SPLIT_IDENTITIES', 'identities are never merged');
  assert.throws(() => st.map({ productId: 'p-2', materialId: 'm-2' }));
  assert.equal(st.writes.length, before, 'no partial write');
  const svc = readCode(SERVICE);
  const mapFn = svc.slice(svc.indexOf('export async function mapProductToMaterial'), svc.indexOf('export async function keepProductAndMaterialSeparate'));
  assert.ok(mapFn.indexOf("if (plan.outcome === 'CONFLICT') throw") < mapFn.indexOf('createMasterDataItem('), 'refuse before writing');
  assert.ok(/loadLogicalItemState\(\{ skipCache: true \}\)/.test(mapFn), 'plans against a fresh read');
  assert.equal((mapFn.match(/(createMasterDataItem|updateMasterDataItem)\(/g) || []).length, 2, 'CREATE and ATTACH are separate single-write branches');
  assert.equal(/writeBatch|runTransaction|Promise\.all\(\[\s*(create|update)/.test(svc), false);
});

test('Q2. inactive (unlinked) mappings free both records; nothing is deleted', () => {
  const retired = [{ id: 'li-old', productId: 'p-kaolin', materialId: 'm-kaolin', status: 'INACTIVE' }].map(li.readLogicalItem);
  assert.equal(li.planProductMaterialMapping(retired, [], pair).outcome, 'CREATE');
  assert.equal(li.resolveLogicalItemId(retired, 'products', 'p-kaolin'), 'record:products/p-kaolin');
  const svc = readCode(SERVICE);
  assert.ok(/updateMasterDataItem\(LOGICAL_ITEM_COLLECTION, logicalItemId, \{ status: 'INACTIVE'/.test(svc));
  assert.equal(/deleteMasterDataItem|deleteDoc/.test(svc + readCode(MODAL)), false);
});

// ==================================================
// K. KEEP SEPARATE
// ==================================================

test('12. an explicit Keep Separate is persisted and distinguishable from not reviewed and from mapped', () => {
  const st = store();
  const row = { productId: 'p-kaolin', materialId: 'm-kaolin', recommendedAction: 'CANDIDATE_FOR_MAPPING' };
  assert.equal(li.overlapRowState(row, [], []).state, 'CANDIDATE', 'not reviewed yet');
  assert.equal(li.overlapRowState({ ...row, recommendedAction: 'REVIEW' }, [], []).state, 'NOT_REVIEWED');
  st.keep(pair);
  assert.equal(li.overlapRowState(row, st.state().items, st.state().decisions).state, 'KEPT_SEPARATE');
  assert.equal(st.keep(pair).outcome, 'ALREADY_KEPT_SEPARATE', 'idempotent');
  assert.equal(st.decisions.length, 1);
  assert.throws(() => st.map(pair), /explicitly kept separate/, 'mapping a kept-separate pair needs the decision withdrawn first');
  const withdrawn = st.state().decisions.map((d: any) => ({ ...d, status: 'INACTIVE' }));
  assert.equal(li.planProductMaterialMapping([], withdrawn, pair).outcome, 'CREATE');
  const mapped = store();
  mapped.map(pair);
  assert.equal(li.overlapRowState(row, mapped.state().items, []).state, 'MAPPED');
  assert.throws(() => mapped.keep(pair), /Unlink them first/);
  assert.ok(interfaceBlock('ItemPairDecision').includes("decision: 'KEEP_SEPARATE';"));
});

// ==================================================
// R. RECORDS STAY VALID
// ==================================================

test('13/14. an unmapped product and an unmapped material stay valid and resolve to themselves', () => {
  assert.equal(li.resolveLogicalItemId([], 'products', 'p-lonely'), 'record:products/p-lonely');
  assert.equal(li.resolveLogicalItemId([], 'materials', 'm-lonely'), 'record:materials/m-lonely');
  assert.notEqual(li.resolveLogicalItemId([], 'products', 'x'), li.resolveLogicalItemId([], 'materials', 'x'), 'same id in two collections is not the same item');
  assert.equal(li.planProductMaterialMapping([], [], { productId: 'p-lonely', materialId: '' }).outcome, 'CONFLICT', 'a mapping needs both records');
  const bomValid = bom.validateBomVersionForSave([], { bomId: 'b1', versionCode: 'V1', status: 'DRAFT', components: [{ lineId: 'L1', itemSource: 'materials', itemId: 'm-lonely', quantity: 1, unit: 'طن', sequence: 1 }] }, { logicalItems: [] });
  assert.equal(bomValid.valid, true, 'unmapped records remain usable');
});

test('25. legacy mixture data stays compatible and is never mapped automatically', () => {
  const code = readCode(PURE) + readCode(SERVICE) + readCode(MODAL);
  assert.equal(/mixtureComponents\s*[:=]|isMixtureBOM\s*[:=]/.test(code), false);
  const changed = [execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/services/tubeBallMillsMixturePure.ts', 'src/services/tubeBallMillsHistoricalImportService.ts', 'src/services/materialService.ts', 'src/services/productionService.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim(), stageRecordServiceChangedBeyondApproved(ROOT)].filter(Boolean).join('\n');
  assert.equal(changed, '', changed);
  const r = ovl.analyzeProductMaterialOverlap([{ id: 'm1', code: '', name: 'Clay' }], [{ id: 'mix', code: '', name: 'Clay', isMixtureBOM: true }]);
  assert.equal(r.rows[0].productIsMixture, true, 'still flagged in the review, still only a suggestion');
  const product = interfaceBlock('Product');
  assert.ok(product.includes('isMixtureBOM?: boolean;') && !/logicalItem/i.test(product));
  assert.equal(/logicalItem/i.test(interfaceBlock('Material')), false);
});

// ==================================================
// A. ANALYZER AND REVIEW DIALOG
// ==================================================

test('15/16. nothing is mapped automatically - no exact-match, name-match or fuzzy mapping path exists', () => {
  const code = readCode(PURE) + readCode(SERVICE);
  // The service reuses the Step 1B analyzer for registration checks (Step 3); it still matches nothing itself.
  assert.equal(/analyzeProductMaterialOverlap/.test(readCode(PURE)), false);
  assert.equal(/normalizeName|normalizeCode|similar|levenshtein|fuzzy/i.test(code), false, 'the mapping layer does no matching of its own');
  const modal = readCode(MODAL);
  assert.equal(/useEffect\([^)]*mapProductToMaterial|\.forEach\([^)]*mapProductToMaterial|rows\.map\([^)]*mapProductToMaterial/.test(modal), false);
  const calls = [...modal.matchAll(/mapProductToMaterial\(/g)];
  assert.equal(calls.length, 1, 'one call site');
  const runPending = modal.slice(modal.indexOf('const runPending'), modal.indexOf('const actionButton'));
  assert.ok(runPending.includes('mapProductToMaterial(') && /if \(!pending \|\| !canEdit/.test(runPending), 'only from a confirmed pending action');
  assert.ok(/onClick=\{\(\) => void runPending\(\)\}/.test(modal) && /id="item-overlap-confirm-btn"/.test(modal), 'the Confirm button');
  assert.ok(/setPending\(\{ kind: 'MAP', row: r \}\)/.test(modal), 'Map only opens the confirmation');
  assert.ok(modal.includes('سيتم ربط المنتج والخامة كصنف منطقي واحد بدون حذف أو تعديل أي من السجلين. هل تريد المتابعة؟'));
  assert.ok(modal.includes('The product and material will be linked as one logical item. Neither existing record will be deleted or modified. Continue?'));
});

test('17. the existing overlap analyzer is reused unchanged and its results stay correct', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'src/services/itemOverlapAnalysisPure.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim();
  const status = execFileSync('git', ['status', '--short', '--', 'src/services/itemOverlapAnalysisPure.ts'], { cwd: ROOT, encoding: 'utf-8' }).trim();
  assert.ok(changed === '' || status.startsWith('??'), 'no diff against the committed analyzer');
  const materials = [{ id: 'm1', code: 'KAO', name: 'Kaolin' }, { id: 'm2', code: 'ALU', name: 'Alumina' }, { id: 'm3', code: 'X', name: 'Only material' }];
  const products = [{ id: 'p1', code: 'KAO', name: 'Kaolin' }, { id: 'p2', code: 'ALU', name: 'Alumina 90' }];
  const r = ovl.analyzeProductMaterialOverlap(materials, products);
  assert.deepEqual(r.rows.map((x: any) => [x.materialId, x.productId ?? null, x.matchType, x.recommendedAction]), [
    ['m1', 'p1', 'CODE_AND_NAME_MATCH', 'CANDIDATE_FOR_MAPPING'],
    ['m2', 'p2', 'EXACT_CODE_MATCH', 'REVIEW'],
    ['m3', null, 'NO_MATCH', 'KEEP_SEPARATE'],
  ]);
  const modal = readCode(MODAL);
  assert.ok(/analyzeProductMaterialOverlap\(materials, products, productTypes\)/.test(modal), 'the dialog still runs the analyzer');
  assert.ok(/overlapRowState\(r, decisions\.items, decisions\.decisions\)/.test(modal), 'decisions are layered on top');
});

test('A3. the review dialog is the only mapping UI - no page, category or navigation', () => {
  const files = fs.readdirSync(path.join(ROOT, 'src/components'), { recursive: true } as any) as string[];
  assert.equal(files.some((f) => /logical/i.test(String(f))), false);
  assert.equal(/logical/i.test(readCode('src/services/masterDataCategoryRegistry.ts') + readCode('src/services/masterDataPanelsPure.ts') + readCode('src/App.tsx')), false);
  assert.equal(/logicalItems/.test(readCode('src/services/masterDataService.ts')), false, 'not a Master Data tab');
  assert.ok(/<ItemOverlapReviewModal\s+isOpen=\{isItemOverlapOpen\}\s+onClose=\{\(\) => setIsItemOverlapOpen\(false\)\}\s+canEdit=\{canImportMasterData\}/.test(readCode(VIEW)));
});

// ==================================================
// B. BOM
// ==================================================

const mapped = () => [{ id: 'li1', productId: 'p-kaolin', materialId: 'm-kaolin', status: 'ACTIVE' }].map((x) => li.readLogicalItem(x));
const version = (components: any[]) => ({ bomId: 'bom1', versionCode: 'V1', status: 'DRAFT', components });
const comp = (n: number, itemSource: string, itemId: string) => ({ lineId: `L${n}`, itemSource, itemId, quantity: 10, unit: 'طن', sequence: n });

test('24. BOM new writes keep record references and are validated by logical identity', () => {
  const both = version([comp(1, 'products', 'p-kaolin'), comp(2, 'materials', 'm-kaolin')]);
  assert.equal(bom.validateBomVersionForSave([], both, { logicalItems: [] }).valid, true, 'unmapped: two different items');
  const v = bom.validateBomVersionForSave([], both, { logicalItems: mapped() });
  assert.deepEqual(v.issues.map((i: any) => i.field), ['components.itemId'], 'mapped: the same logical item listed twice');
  const own = bom.validateBomVersionForSave([], version([comp(1, 'materials', 'm-kaolin')]), { logicalItems: mapped(), bom: { itemSource: 'products', itemId: 'p-kaolin' } });
  assert.deepEqual(own.issues.map((i: any) => i.field), ['components.itemId'], 'a BOM cannot contain its own logical item under the other collection');
  const payload = bom.bomVersionPayloadForSave(both);
  // Phase 1 Step 7A adds only the formula group (componentType) - still no logicalItemId stored.
  assert.deepEqual(Object.keys(payload.components[0]).sort(), ['componentType', 'itemId', 'itemSource', 'lineId', 'notes', 'percentage', 'quantity', 'sequence', 'unit'], 'no logicalItemId stored, no second identity');
  const bomHeader = { code: 'B1', name: 'n', itemSource: 'products', itemId: 'p-kaolin', isDefault: true, active: true };
  const other = { id: 'b2', code: 'B2', name: 'n2', itemSource: 'materials', itemId: 'm-kaolin', isDefault: true, active: true };
  assert.equal(bom.validateBomForSave([other], bomHeader, { logicalItems: [] }).valid, true);
  assert.deepEqual(bom.validateBomForSave([other], bomHeader, { logicalItems: mapped() }).issues.map((i: any) => i.field), ['isDefault'], 'one default per logical item');
  const modal = readCode('src/components/masterData/BomVersionsModal.tsx');
  assert.ok(/loadLogicalItemState\(/.test(modal) && /\{ knownItems, bom, logicalItems \}/.test(modal), 'the versions window validates with current mappings');
  assert.ok(/logicalItems: referenceLogicalItems/.test(readCode(VIEW)), 'the BOM header save too');
});

test('18. no BOM, job, batch or production record is migrated or rewritten', () => {
  const code = readCode(PURE) + readCode(SERVICE);
  assert.equal(/bomVersions|'boms'|jobReferences|'batches'|stage_|'production'|financialTransactions/.test(code), false);
});

// ==================================================
// U. SERVICE, RULES, PERMISSIONS, AUDIT
// ==================================================

test('U1. only authorised users can decide - service refuses without the gate, dialog hides actions', () => {
  const svc = readCode(SERVICE);
  for (const fn of ['mapProductToMaterial', 'keepProductAndMaterialSeparate', 'unlinkLogicalItem', 'withdrawKeepSeparate']) {
    const body = svc.slice(svc.indexOf(`export async function ${fn}`));
    assert.ok(/^[\s\S]*?\{\s*requireEditor\(options\.canEdit, options\.language\);/.test(body), `${fn} checks the gate first`);
  }
  const modal = readCode(MODAL);
  assert.ok(/\{canEdit && r\.productId && \(/.test(modal), 'actions only for editors; others still see the state');
  assert.ok(/canEdit = false/.test(modal), 'read-only unless the caller grants the gate');
  assert.equal(/'(logicalItem[A-Za-z]*|itemMapping)\./i.test(readCode('src/types/permissions.ts')), false, 'no new permission keys');
});

test('U2. audit lines name product, material, logical item, previous and new state, through the existing audit service', () => {
  const plan = { outcome: 'CREATE', conflicts: [], messageAr: '', messageEn: '' };
  const text = li.describeMapping(plan, { id: 'p-kaolin', code: 'KAO-CAL', name: 'Kaolin' }, { id: 'm-kaolin', code: 'KAO-CAL', name: 'Kaolin' }, 'li1', null);
  assert.ok(/Product KAO-CAL - Kaolin \[p-kaolin\] was mapped to Material KAO-CAL - Kaolin \[m-kaolin\] as the same Logical Item li1/.test(text));
  assert.ok(/previous: none/.test(text) && /new: product p-kaolin, material m-kaolin, ACTIVE/.test(text));
  const attach = li.describeMapping({ ...plan, outcome: 'ATTACH_MATERIAL' }, { id: 'p' }, { id: 'm' }, 'li9', li.readLogicalItem({ id: 'li9', productId: 'p', status: 'ACTIVE' }));
  assert.ok(/previous: product p, material -, ACTIVE/.test(attach));
  assert.ok(/\[ITEM_KEPT_SEPARATE\]/.test(li.describeKeepSeparate({ id: 'p' }, { id: 'm' }, 'd1')));
  assert.ok(/\[LOGICAL_ITEM_UNLINKED\].*new: INACTIVE/.test(li.describeRetirement('logicalItem', 'li1', { productId: 'p', materialId: 'm' })));
  const svc = readCode(SERVICE);
  assert.ok(/import \{ logAuditAction \} from '\.\/auditService';/.test(svc));
  assert.equal((svc.match(/logAuditAction\(/g) || []).length, 6, 'create, attach, register (Step 3), keep separate, unlink, withdraw');
  assert.ok(/createdBy: optionalId\(meta\.userId\)/.test(readCode(PURE)) && /auth\.currentUser\?\.uid/.test(svc), 'the user is recorded on the document too');
});

test('U3. rules follow the Master Data pattern for logicalItems and itemPairDecisions - nothing public', () => {
  const rules = readSource('firestore.rules');
  for (const [coll, param] of [['logicalItems', 'logicalItemId'], ['itemPairDecisions', 'decisionId']]) {
    const m = rules.match(new RegExp(`match /${coll}/\\{${param}\\} \\{([\\s\\S]*?)\\n\\s*\\}`));
    assert.ok(m, coll);
    assert.deepEqual(m![1].split('\n').map((l) => l.trim()).filter(Boolean), ['allow read: if isSignedIn();', 'allow write: if isAdmin();'], coll);
  }
});

test('U4. no Odoo fields or calls; external links reuse Step 1A externalRefs', () => {
  const code = readCode(PURE) + readCode(SERVICE) + interfaceBlock('LogicalItem') + interfaceBlock('ItemPairDecision');
  assert.equal(/odoo|fetch\(|axios|jsonrpc/i.test(code), false);
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

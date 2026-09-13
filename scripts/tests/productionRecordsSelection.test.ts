/**
 * PRODUCTION RECORDS - ROW SELECTION FOUNDATION
 *
 * Two kinds of assertion, deliberately:
 *
 *   1. BEHAVIOUR - run against the REAL selection primitives (bulkEditPure.ts),
 *      no mocks and no shim. These are the same functions the Data Review screen
 *      has used in production since 3.5.0; this task reuses them rather than
 *      introducing a second selection architecture, so exercising them here is
 *      exercising the shipped logic.
 *
 *   2. WIRING - read the real ProductionRecordsView source to prove the screen
 *      is actually connected to those primitives, keys on the document id rather
 *      than the row index, prunes on filter change, and introduces NO deletion.
 *      Comments are stripped before matching, so a test can never be satisfied
 *      by the prose explaining it.
 *
 * The last group matters most: this is a selection FOUNDATION, and the screen it
 * was added to already has a hard delete for a single row. These tests exist to
 * make it obvious if a bulk delete is ever quietly attached to the selection.
 *
 * Run: npx tsx scripts/tests/productionRecordsSelection.test.ts
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

console.log('productionRecordsSelection.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const VIEW = 'src/components/production/ProductionRecordsView.tsx';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

/** Source with block and line comments stripped. */
function readCode(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

let sel: any;
async function bootstrap() {
  sel = await import(pathToFileURL(path.join(ROOT, 'src/services/bulkEditPure.ts')).href);
}

/** Five records standing in for a page of production rows. */
const ROWS = [
  { id: 'rec-a', stageType: 'pressing' },
  { id: 'rec-b', stageType: 'pressing' },
  { id: 'rec-c', stageType: 'pressing' },
  { id: 'rec-d', stageType: 'pressing' },
  { id: 'rec-e', stageType: 'pressing' },
];
const ALL_IDS = ROWS.map((r) => r.id);

// ==================================================
// A. BEHAVIOUR (§13 TEST 1-7)
// ==================================================

test('A1. TEST 1 - one row selected gives Selected = 1', () => {
  const s = sel.toggleRow(sel.EMPTY_SELECTION_STATE, 'rec-b');
  assert.equal(sel.selectionCount(s), 1);
  assert.equal(sel.isSelected(s, 'rec-b'), true);
  assert.equal(sel.isSelected(s, 'rec-a'), false);
});

test('A2. TEST 2 - three rows selected gives Selected = 3', () => {
  let s = sel.EMPTY_SELECTION_STATE;
  for (const id of ['rec-a', 'rec-c', 'rec-e']) s = sel.toggleRow(s, id);
  assert.equal(sel.selectionCount(s), 3);
  assert.deepEqual([...s.selectedIds].sort(), ['rec-a', 'rec-c', 'rec-e']);
});

test('A3. TEST 3 - Select All Visible selects exactly the visible rows', () => {
  const s = sel.selectAllVisible(sel.EMPTY_SELECTION_STATE, ALL_IDS);
  assert.equal(sel.selectionCount(s), 5);
  assert.equal(sel.areAllVisibleSelected(s, ALL_IDS), true);
});

test('A4. TEST 3b - Select All Visible NEVER reaches beyond the visible set', () => {
  // Only two rows pass the current filter.
  const visible = ['rec-a', 'rec-b'];
  const s = sel.selectAllVisible(sel.EMPTY_SELECTION_STATE, visible);
  assert.equal(sel.selectionCount(s), 2);
  for (const hidden of ['rec-c', 'rec-d', 'rec-e']) {
    assert.equal(sel.isSelected(s, hidden), false, `${hidden} is not visible and must not be selected`);
  }
});

test('A5. TEST 4 - Deselect All returns Selected = 0', () => {
  const full = sel.selectAllVisible(sel.EMPTY_SELECTION_STATE, ALL_IDS);
  assert.equal(sel.selectionCount(full), 5);
  assert.equal(sel.selectionCount(sel.deselectAll()), 0);
});

test('A6. TEST 5 - select one row then deselect it returns to 0', () => {
  const on = sel.toggleRow(sel.EMPTY_SELECTION_STATE, 'rec-d');
  assert.equal(sel.selectionCount(on), 1);
  const off = sel.toggleRow(on, 'rec-d');
  assert.equal(sel.selectionCount(off), 0);
});

test('A7. TEST 6 - after a filter change, hidden rows cannot stay selected', () => {
  const all = sel.selectAllVisible(sel.EMPTY_SELECTION_STATE, ALL_IDS);
  assert.equal(sel.selectionCount(all), 5);
  // The user narrows the filter; only two rows remain on screen.
  const pruned = sel.pruneToVisible(all, ['rec-a', 'rec-b']);
  assert.equal(sel.selectionCount(pruned), 2);
  assert.deepEqual([...pruned.selectedIds].sort(), ['rec-a', 'rec-b']);
  for (const gone of ['rec-c', 'rec-d', 'rec-e']) {
    assert.equal(sel.isSelected(pruned, gone), false, `${gone} left the filter and must be dropped`);
  }
});

test('A8. TEST 6b - a widened filter does NOT silently re-select what was pruned', () => {
  const pruned = sel.pruneToVisible(sel.selectAllVisible(sel.EMPTY_SELECTION_STATE, ALL_IDS), ['rec-a']);
  assert.equal(sel.selectionCount(pruned), 1);
  // Filter widens again - the previously pruned rows must stay unselected.
  const widened = sel.pruneToVisible(pruned, ALL_IDS);
  assert.equal(sel.selectionCount(widened), 1, 'pruning is not reversible; nothing is re-selected behind the user');
});

test('A9. TEST 7 - selection is deterministic across re-render and refresh', () => {
  const s = sel.selectAllVisible(sel.EMPTY_SELECTION_STATE, ['rec-b', 'rec-c']);
  // A live snapshot re-delivers the same ids in a different order.
  const reordered = ['rec-c', 'rec-a', 'rec-b'];
  const after = sel.pruneToVisible(s, reordered);
  assert.equal(sel.selectionCount(after), 2, 'the same rows stay selected regardless of order');
  assert.deepEqual([...after.selectedIds].sort(), ['rec-b', 'rec-c']);
  // Re-running the same pruning is idempotent.
  assert.deepEqual(sel.pruneToVisible(after, reordered).selectedIds.sort(), ['rec-b', 'rec-c']);
});

test('A10. selection is keyed on identity, so it survives reordering of the row list', () => {
  const s = sel.toggleRow(sel.EMPTY_SELECTION_STATE, 'rec-e');
  // rec-e is now first rather than last; an index-keyed selection would break here.
  const resorted = ['rec-e', 'rec-d', 'rec-c', 'rec-b', 'rec-a'];
  assert.equal(sel.isSelected(sel.pruneToVisible(s, resorted), 'rec-e'), true);
});

// ==================================================
// B. WIRING - the screen is really connected (§1-§8, §11)
// ==================================================

test('B1. the screen reuses the shared primitives, and defines no second selection engine', () => {
  const src = readCode(VIEW);
  assert.ok(/from '\.\.\/\.\.\/services\/bulkEditPure'/.test(src), 'must import the shared primitives');
  for (const fn of [
    'EMPTY_SELECTION_STATE', 'toggleRow', 'selectAllVisible',
    'deselectAll', 'pruneToVisible', 'selectionCount', 'isSelected', 'areAllVisibleSelected',
  ]) {
    assert.ok(src.includes(fn), `must use the shared ${fn}`);
  }
  assert.equal(
    /function (toggleRow|selectAllVisible|pruneToVisible|deselectAll)\b/.test(src),
    false,
    'must not redefine a selection primitive locally',
  );
});

test('B2. §2 - a checkbox exists per row AND in the header', () => {
  const src = readCode(VIEW);
  const boxes = src.match(/type="checkbox"/g) || [];
  assert.ok(boxes.length >= 2, `expected a header and a row checkbox, found ${boxes.length}`);
  assert.ok(/id="production-records-select-all"/.test(src), 'the header select-all must be identifiable');
});

test('B3. §2 - the existing actions column and row actions are untouched', () => {
  const src = readSource(VIEW);
  assert.ok(src.includes('الإجراءات'), 'the actions column must remain');
  assert.ok(/handleOpenEdit/.test(src), 'row Edit must remain');
  assert.ok(/setDeleteConfirmRecord/.test(src), 'the existing single-row delete confirm must remain');
});

test('B4. §3 - Select All is bound to the VISIBLE ids, never the full record set', () => {
  const src = readCode(VIEW);
  assert.ok(/selectAllVisible\(selection, visibleIds\)/.test(src), 'select-all must pass visibleIds');
  assert.equal(
    /selectAllVisible\(\s*selection\s*,\s*records/.test(src),
    false,
    'select-all must never be handed the unfiltered record set',
  );
  // visibleIds is derived from the same filtered list the table renders.
  assert.ok(/visibleIds\s*=\s*useMemo\(/.test(src), 'visibleIds must be memoised');
  assert.ok(/filteredRecords\.map\(\(r\) => r\.id\)/.test(src), 'visibleIds must come from filteredRecords');
});

test('B5. §4 - selection is keyed on the document id, never the row index', () => {
  const src = readCode(VIEW);
  assert.ok(/toggleRow\(selection, rec\.id\)/.test(src), 'the row checkbox must toggle by rec.id');
  assert.ok(/isSelected\(selection, rec\.id\)/.test(src), 'checked state must be read by rec.id');
  // A row whose id is missing cannot be addressed, so it must be disabled rather
  // than given a positional key.
  assert.ok(/disabled=\{!rec\.id\}/.test(src), 'a record without an id must not be selectable');
  assert.equal(
    /map\(\((rec|r), ?(i|idx|index)\)/.test(src),
    false,
    'the row map must not introduce an index for selection purposes',
  );
});

test('B6. §5 - stale selections are pruned when the filters change', () => {
  const src = readCode(VIEW);
  assert.ok(/pruneToVisible\(prev, visibleIds\)/.test(src), 'must prune against the current visible ids');
  assert.ok(/\}, \[visibleIds\]\);/.test(src), 'pruning must be driven by a change in the visible ids');
});

test('B7. §6 - the selection counter is rendered', () => {
  const src = readCode(VIEW);
  assert.ok(/id="production-records-selected-count"/.test(src), 'the counter must be identifiable');
  assert.ok(/selectionCount\(selection\)/.test(src), 'the counter must read the real selection size');
});

test('B8. §7 - select-all and deselect-all controls exist', () => {
  const src = readSource(VIEW);
  assert.ok(src.includes('تحديد الكل'), 'the select-all control must exist');
  assert.ok(src.includes('إلغاء تحديد الكل'), 'the deselect-all control must exist');
});

test('B9. §8 - the checkbox is selection only; it opens nothing and edits nothing', () => {
  const src = readCode(VIEW);
  // Every checkbox onChange in this file must only ever call setSelection.
  const handlers = src.match(/onChange=\{[^}]*\}/g) || [];
  const checkboxHandlers = handlers.filter((h) => /setSelection/.test(h));
  assert.ok(checkboxHandlers.length >= 2, 'both checkboxes must drive selection state');
  for (const h of checkboxHandlers) {
    assert.equal(/handleOpenEdit|updateProductionRecord|setIsEditModalOpen|setDeleteConfirmRecord/.test(h), false,
      `a selection handler must not trigger edit or delete: ${h}`);
  }
});

test('B10. §11 - selection is pure UI state: no Firestore read or write was added', () => {
  const src = readCode(VIEW);
  // The selection state itself must never be persisted.
  assert.equal(/setDoc|addDoc|writeBatch|updateDoc\(.*selection/.test(src), false,
    'selection must never be written to Firestore');
  assert.equal(/selectedIds.*getDocs|getDocs.*selectedIds/.test(src), false,
    'selection must never trigger a read');
  // And no new fetch was introduced to make select-all possible.
  assert.equal(/fetchAll|loadAllRecords|getAllRecords/.test(src), false,
    'select-all must not fetch additional records');
});

// ==================================================
// C. ONE DELETION ARCHITECTURE (§1, §9, §15)
//
// Bulk delete of selected records was later authorised explicitly. What these
// assertions still guarantee: it reuses the ONE existing primitive through the
// shared planner, never a second delete path, a batch write or a soft-delete
// state - and selecting a row by itself deletes nothing.
// (Full behaviour: productionRecordsBulkDelete.test.ts.)
// ==================================================

test('C1. §15 - no second delete architecture exists on this screen', () => {
  const src = readCode(VIEW);
  for (const forbidden of ['deleteMany', 'deleteStageRecord', 'softDelete', 'markDeleted', 'writeBatch', 'deleteDoc']) {
    assert.equal(src.includes(forbidden), false, `a deletion path named ${forbidden} must not exist`);
  }
  assert.ok(/from '\.\.\/\.\.\/services\/productionRecordsBulkDeletePure'/.test(src), 'bulk delete goes through the shared planner/executor');
});

test('C2. §15 - the selection reaches the primitive only through the confirmed plan', () => {
  const src = readCode(VIEW);
  const calls = src.match(/deleteProductionRecord\(/g) || [];
  assert.equal(calls.length, 2, `expected the single-row confirm and the injected bulk primitive, found ${calls.length}`);
  assert.ok(/deleteOne: \(id\) => deleteProductionRecord\(id, labelById\.get\(id\)\)/.test(src), 'one call per planned id');
  assert.equal(/deleteProductionRecord\([^)]*(selection|selectedIds|map|forEach)/.test(src), false,
    'delete is never applied over the raw selection');
  assert.ok(/planBulkDelete\(selection\.selectedIds, visibleIds\)/.test(src), 'the batch is selected ∩ visible');
});

test('C3. §15 - no deleted/voided record state was introduced', () => {
  const src = readCode(VIEW);
  for (const forbidden of ['isDeleted', 'deletedAt', 'voided', 'VOIDED', 'DELETED']) {
    assert.equal(src.includes(forbidden), false, `a ${forbidden} record state must not be introduced`);
  }
});

test('C4. §12 - the stage record service still has no delete primitive', () => {
  const src = readCode('src/services/stageRecordService.ts');
  // `deleteDoc` IS imported at the top of that file, and always has been - it is
  // an unused import, never invoked. So the meaningful assertions are that it is
  // never CALLED and that no delete function is exported, rather than that the
  // identifier is absent from the file.
  assert.equal(/deleteDoc\s*\(/.test(src), false,
    'stageRecordService must never actually call deleteDoc');
  assert.equal(/export\s+(async\s+)?function\s+delete/.test(src), false,
    'stageRecordService must export no delete function');
  assert.equal(/deleteStageRecord/.test(src), false,
    'deleteStageRecord must not exist');
});

test('C5. §10 - no new permission was introduced for selection', () => {
  const src = readCode(VIEW);
  for (const invented of [
    'production.select', 'records.select', 'selection.view', 'production.bulkDelete',
  ]) {
    assert.equal(src.includes(invented), false, `must not invent the permission ${invented}`);
  }
});

// ==================================================
// D. PRODUCTION RECORDS CODE FILTER (§22 TEST 1-18, §23)
//
// The legacy `production` collection is a DIFFERENT record shape from
// UniversalStageRecord: no stageType, but real pressId / furnaceId / shiftId.
// These exercise the real registry + real engine against that shape.
// ==================================================

let reg: any;
let eng: any;
let hier: any;
async function bootstrapCodeFilter() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  reg = await load('src/services/masterDataCategoryRegistry.ts');
  eng = await load('src/services/productionFilterEnginePure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
}

/** Legacy production records, shaped exactly like ProductionRecord. */
const LEGACY = [
  { id: 'r1', date: '2026-09-01', shiftId: 's1', pressId: 'p1', furnaceId: 'f1', productId: 'pr1', productCode: 'BAR25', customerId: 'c1' },
  { id: 'r2', date: '2026-09-02', shiftId: 's1', pressId: 'p2', furnaceId: 'f1', productId: 'pr2', productCode: 'BHA30', customerId: 'c1' },
  { id: 'r3', date: '2026-09-03', shiftId: 's2', pressId: 'p1', productId: 'pr1', productCode: 'BAR25', customerId: 'c2' },
  { id: 'r4', date: '2026-09-04', shiftId: 's2', pressId: 'p3', furnaceId: 'f2', productId: 'pr3', productCode: 'BSI10', customerId: 'c2' },
];
const ids = (rows: any[]) => rows.map((r) => r.id).sort();

test('D1. TEST 1 - Production Centers is a real category for this screen', () => {
  const c = reg.getCategory('productionCenters');
  assert.deepEqual(c.legacyProductionFields, ['pressId', 'furnaceId'],
    'a centre is the press that ran the job OR the furnace that fired it');
  assert.deepEqual(c.legacyCodeSources, ['presses', 'furnaces'],
    'its codes come from the two equipment collections, not from a hard-coded list');
});

test('D2. TEST 2 - Products maps to the verified product fields', () => {
  assert.deepEqual(reg.getCategory('products').legacyProductionFields, ['productId', 'productCode']);
});

test('D3. TEST 3 - switching category changes which codes are relevant', () => {
  const centres = reg.legacyCodeSourceCategories('productionCenters').map((c: any) => c.id);
  const products = reg.legacyCodeSourceCategories('products').map((c: any) => c.id);
  assert.deepEqual(centres, ['presses', 'furnaces']);
  assert.deepEqual(products, ['products']);
  // No overlap - a product code can never appear under production centres.
  assert.equal(centres.some((c: string) => products.includes(c)), false);
});

test('D4. TEST 4 - ONE code returns only the matching records', () => {
  const sel = reg.normaliseSelection('productionCenters', ['p1'], false);
  assert.equal(sel.mode, 'ONE');
  assert.deepEqual(ids(eng.filterLegacyProductionRecords(LEGACY, sel)), ['r1', 'r3']);
});

test('D5. TEST 5 - MULTIPLE codes match ANY of them', () => {
  const sel = reg.normaliseSelection('productionCenters', ['p1', 'p3'], false);
  assert.equal(sel.mode, 'MULTIPLE');
  assert.deepEqual(ids(eng.filterLegacyProductionRecords(LEGACY, sel)), ['r1', 'r3', 'r4']);
});

test('D6. TEST 6 - ALL returns everything and stays a MODE', () => {
  const sel = reg.normaliseSelection('productionCenters', [], true);
  assert.equal(sel.mode, 'ALL');
  assert.deepEqual(sel.codes, [], 'ALL must never materialise the code list');
  const resolved = eng.resolveLegacyProductionFilter(sel);
  assert.equal(resolved.matchValues, null, 'ALL must not build a match set');
  assert.equal(eng.filterLegacyProductionRecords(LEGACY, sel).length, LEGACY.length);
});

test('D7. an empty code list IS ALL - the same semantics used everywhere else', () => {
  const sel = reg.normaliseSelection('productionCenters', [], false);
  assert.equal(sel.mode, 'ALL');
});

test('D8. a production centre matches on EITHER field, never both', () => {
  // f1 is a furnace; r1 and r2 were fired in it despite different presses.
  const sel = reg.normaliseSelection('productionCenters', ['f1'], false);
  assert.deepEqual(ids(eng.filterLegacyProductionRecords(LEGACY, sel)), ['r1', 'r2']);
});

test('D9. TEST 10 - a record matching two selected codes appears ONCE', () => {
  // r1 has pressId p1 AND furnaceId f1 - both selected.
  const sel = reg.normaliseSelection('productionCenters', ['p1', 'f1'], false);
  const out = eng.filterLegacyProductionRecords(LEGACY, sel);
  assert.deepEqual(ids(out), ['r1', 'r2', 'r3']);
  assert.equal(out.filter((r: any) => r.id === 'r1').length, 1, 'r1 must not be emitted twice');
  assert.equal(eng.dedupeRecordsById(out).length, out.length, 'the result is already duplicate-free');
});

test('D10. TEST 4 - Products filter by id or by code', () => {
  assert.deepEqual(
    ids(eng.filterLegacyProductionRecords(LEGACY, reg.normaliseSelection('products', ['pr1'], false))),
    ['r1', 'r3'],
  );
  assert.deepEqual(
    ids(eng.filterLegacyProductionRecords(LEGACY, reg.normaliseSelection('products', ['BSI10'], false))),
    ['r4'],
  );
});

test('D11. TEST 5 - Customers use the verified customerId', () => {
  assert.deepEqual(reg.getCategory('customers').legacyProductionFields, ['customerId']);
  assert.deepEqual(
    ids(eng.filterLegacyProductionRecords(LEGACY, reg.normaliseSelection('customers', ['c2'], false))),
    ['r3', 'r4'],
  );
});

test('D12. TEST 11 - Financial Accounts stay Master-Data-only', () => {
  const c = reg.getCategory('financialAccounts');
  assert.equal(c.legacyProductionFields ?? undefined, undefined,
    'no production field may be claimed for financial accounts');
  assert.equal(reg.supportsLegacyProductionFilter('financialAccounts'), false);
  const resolved = eng.resolveLegacyProductionFilter(reg.normaliseSelection('financialAccounts', ['1101'], false));
  assert.equal(resolved.applicable, false);
  assert.ok(resolved.reasonAr.length > 0 && resolved.reasonEn.length > 0, 'the gap must be stated, not hidden');
  // Critically: it must NOT silently return an empty table.
  assert.equal(eng.filterLegacyProductionRecords(LEGACY, reg.normaliseSelection('financialAccounts', ['1101'], false)).length,
    LEGACY.length, 'an unmappable category must not look like "no production"');
});

test('D13. TEST 12 - Cost Centers stay Master-Data-only', () => {
  for (const id of ['costCenters', 'hierarchicalCostCenters']) {
    assert.equal(reg.supportsLegacyProductionFilter(id), false, `${id} must not filter production records`);
  }
});

test('D14. §24 - the filterable set is EXACTLY the verified relationships', () => {
  const filterable = reg.legacyProductionCategories().map((c: any) => c.id).sort();
  assert.deepEqual(filterable,
    ['customers', 'furnaces', 'presses', 'productionCenters', 'products', 'shifts'].sort(),
    'no category may become filterable without a verified field');
  // Every claimed field must be a real ProductionRecord field.
  const REAL = new Set(['pressId', 'furnaceId', 'productId', 'productCode', 'customerId', 'shiftId']);
  for (const c of reg.legacyProductionCategories()) {
    for (const f of c.legacyProductionFields) {
      assert.ok(REAL.has(f), `${c.id} claims ${f}, which is not a verified ProductionRecord field`);
    }
  }
});

test('D15. TEST 7/8/9 + §23 - hierarchy expansion works, but no legacy category is hierarchical today', () => {
  // The mechanism is real and shared - prove it expands parent -> descendants.
  const nodes = [
    { id: 'presses', code: 'presses', parentId: null },
    { id: 'bokher', code: 'bokher', parentId: 'presses' },
    { id: 'bokher-900-2', code: 'bokher-900-2', parentId: 'bokher' },
    { id: 'bokher-900-3', code: 'bokher-900-3', parentId: 'bokher' },
  ];
  const index = hier.buildHierarchyIndex(nodes);
  assert.deepEqual(hier.resolveHierarchyCodes(index, ['presses'], { includeSelf: true }).sort(),
    ['bokher', 'bokher-900-2', 'bokher-900-3', 'presses']);
  assert.deepEqual(hier.resolveHierarchyCodes(index, ['bokher'], { includeSelf: true }).sort(),
    ['bokher', 'bokher-900-2', 'bokher-900-3']);
  assert.deepEqual(hier.resolveHierarchyCodes(index, ['bokher-900-2'], { includeSelf: true }),
    ['bokher-900-2']);

  // But NONE of the categories that can filter this screen is hierarchical, so
  // that expansion cannot currently apply here. This asserts the honest state of
  // the system: presses/furnaces master data carries no parent field, and no
  // production record references a hierarchy node.
  for (const c of reg.legacyProductionCategories()) {
    assert.notEqual(c.hierarchical, true,
      `${c.id} is marked hierarchical but nothing links production records to hierarchy nodes`);
  }
});

test('D16. §24 - no hierarchy field was invented ON A PRODUCTION RECORD', () => {
  /*
   * Narrowed deliberately. When this was written, `hierarchyNodeId` existed
   * nowhere, so forbidding the identifier outright was the right guard. It is
   * now a REAL persisted field on equipment master data (Press/Furnace), and
   * reading it is the whole point of the equipment link - so the guard now
   * targets what actually matters: the identifier must never appear on the
   * PRODUCTION RECORD type, and the screen must never write one onto a record.
   */
  const types = readSource('src/types/index.ts');
  const start = types.indexOf('export interface ProductionRecord');
  const block = types.slice(start, types.indexOf('\n}', start));
  for (const invented of ['hierarchyNodeId', 'productionCenterId', 'pressHierarchyId', 'costCenterId']) {
    assert.equal(block.includes(invented), false, `ProductionRecord must not carry ${invented}`);
  }
  // And these names must exist nowhere at all - they were never real.
  for (const rel of [
    'src/services/masterDataCategoryRegistry.ts',
    'src/services/productionFilterEnginePure.ts',
    'src/components/production/ProductionRecordsView.tsx',
  ]) {
    const src = readCode(rel);
    for (const invented of ['productionCenterId', 'pressHierarchyId', 'costCenterId']) {
      assert.equal(src.includes(invented), false, `${rel} must not invent ${invented}`);
    }
  }
});

test('D17. §8 - there is still exactly ONE descendant walk in the system', () => {
  const engine = readCode('src/services/productionFilterEnginePure.ts');
  assert.ok(/resolveHierarchyCodes/.test(engine), 'the engine must delegate expansion');
  assert.equal(/function\s+\w*[Dd]escendant|while\s*\(queue|stack\.pop\(\)/.test(engine), false,
    'the engine must not walk the tree itself');
  // Both resolvers share one expansion helper.
  const shared = (engine.match(/expandSelectionCodes\(/g) || []).length;
  assert.ok(shared >= 3, `both resolvers must call the shared expansion (found ${shared} references)`);
});

// --- wiring ---------------------------------------------------------------

const PRV = 'src/components/production/ProductionRecordsView.tsx';

test('D18. TEST 13 - the organisational options come from loaded data, never hard-coded', () => {
  const src = readCode(PRV);
  assert.ok(/listCostCenterHierarchyNodes\(\)/.test(src), 'the hierarchy is read through the cache-first reader');
  assert.ok(/fetchMasterData<Furnace>\('furnaces'\)/.test(src), 'furnace master data must be loaded');
  assert.equal(/const\s+(PRESSES|CENTERS|CODE_LIST)\s*=/.test(src), false, 'no hard-coded code list');
});

test('D19. §2 - the press-only and code-type selectors are gone, replaced by the cost-centre hierarchy', () => {
  const src = readCode(PRV);
  assert.equal(/filterPress/.test(src), false, 'the press-only filter state must be gone');
  assert.equal(/id="production-records-code-category"|id="production-records-codes"|filterCategoryId|filterCodes/.test(src), false,
    'the Code Type -> Codes pair was superseded by the canonical hierarchy selector');
  assert.ok(/<CostCenterScopeSelector/.test(src), 'the shared hierarchical selector must exist');
});

test('D20. §18 - filtering goes through the shared engine, not a local reimplementation', () => {
  const src = readCode(PRV);
  assert.ok(/filterLegacyProductionRecords\(/.test(src), 'must call the shared engine');
  assert.ok(/normaliseSelection\(/.test(src), 'must use the shared selection semantics');
  assert.equal(/rec\.pressId ===|rec\.furnaceId ===/.test(src), false,
    'the component must not match production fields by hand');
});

test('D21. TEST 14/15 - the existing date, shift, product and search filters survive', () => {
  const src = readCode(PRV);
  for (const kept of ['filterShift', 'filterProduct', 'startDate', 'endDate', 'searchQuery']) {
    assert.ok(src.includes(kept), `${kept} must still exist`);
  }
  // They are applied BEFORE the code filter, so the two compose.
  assert.ok(/filterLegacyProductionRecords\(records\.filter\(/.test(src),
    'the code filter must compose with the existing predicate, not replace it');
});

test('D22. TEST 16 - row selection still prunes against the newly filtered set', () => {
  const src = readCode(PRV);
  assert.ok(/pruneToVisible\(prev, visibleIds\)/.test(src), 'pruning must remain');
  assert.ok(/filteredRecords\.map\(\(r\) => r\.id\)/.test(src),
    'visibleIds must derive from the SAME filtered list the code filter produced');
});

test('D23. TEST 17/18 - Edit and individual Delete are untouched', () => {
  const src = readCode(PRV);
  assert.ok(/handleOpenEdit/.test(src), 'row Edit must remain');
  assert.ok(/updateProductionRecord\(/.test(src), 'the edit write path must remain');
  assert.ok(/await deleteProductionRecord\(\s*deleteConfirmRecord\.id,/.test(src), 'the single-row delete must remain');
  for (const forbidden of ['deleteStageRecord', 'handleBulkEdit', 'deleteMany']) {
    assert.equal(src.includes(forbidden), false, `${forbidden} must not be introduced`);
  }
});

test('D24. §19 - filtering issues no query per code and no extra read', () => {
  const src = readCode(PRV);
  assert.equal(/getDocs|query\(collection/.test(src), false, 'no direct Firestore query may be added');
  // The only master-data reads are the cache-first fetches, one per collection.
  const fetches = (src.match(/fetchMasterData</g) || []).length;
  assert.ok(fetches <= 5, `expected at most one cache-first read per collection, found ${fetches}`);
  assert.equal(/availableCodes[\s\S]{0,300}fetchMasterData/.test(src), false,
    'building the code list must not trigger a read');
});

(async () => {
  await bootstrap();
  await bootstrapCodeFilter();
  for (const { name, fn } of registered) {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
      passed++;
    } catch (err: any) {
      console.log(`  FAIL  ${name}`);
      console.log(String(err && err.message ? err.message : err).split('\n').slice(0, 4).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

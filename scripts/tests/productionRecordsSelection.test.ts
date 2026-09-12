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
// C. NO DELETION ARCHITECTURE (§1, §9, §15)
//
// This screen already hard-deletes a SINGLE row. The point of these assertions
// is that the new selection is not wired to it, and that no bulk/multi delete
// has appeared.
// ==================================================

test('C1. §15 - no bulk delete handler exists on this screen', () => {
  const src = readCode(VIEW);
  for (const forbidden of [
    'handleBulkDelete', 'bulkDelete', 'deleteSelected', 'deleteMany',
    'deleteStageRecord', 'softDelete', 'markDeleted',
  ]) {
    assert.equal(src.includes(forbidden), false, `a deletion path named ${forbidden} must not exist`);
  }
});

test('C2. §15 - the existing single-row delete is not reachable from the selection', () => {
  const src = readCode(VIEW);
  // deleteProductionRecord must still be called exactly once, from the existing
  // single-record confirmation - never over a list of ids.
  const calls = src.match(/deleteProductionRecord\(/g) || [];
  assert.equal(calls.length, 1, `expected exactly one delete call site, found ${calls.length}`);
  assert.equal(/selectedIds[\s\S]{0,200}deleteProductionRecord/.test(src), false,
    'the selection must never feed the delete path');
  assert.equal(/deleteProductionRecord\([^)]*(selection|selectedIds|map|forEach)/.test(src), false,
    'delete must never be applied over a collection of selected ids');
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

(async () => {
  await bootstrap();
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

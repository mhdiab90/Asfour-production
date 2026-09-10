/**
 * Master Data category registry + Production Review selection/bulk-edit tests.
 *
 * Both modules under test are deliberately Firebase-free, so these exercise the
 * REAL shipped logic directly - no shim, no mocks, no Firestore, no network.
 *
 * The two properties that matter most here are safety properties:
 *   - a bulk edit can only ever touch explicitly selected, currently visible rows;
 *   - one invalid row cannot poison the valid ones.
 *
 * Source reads normalise line endings, so the suite behaves identically on an
 * LF or a CRLF checkout.
 *
 * Run: npx tsx scripts/tests/masterDataBulk.test.ts
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

console.log('masterDataBulk.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}

let reg: any;
let bulk: any;
async function bootstrap() {
  reg = await import(pathToFileURL(path.join(ROOT, 'src/services/masterDataCategoryRegistry.ts')).href);
  bulk = await import(pathToFileURL(path.join(ROOT, 'src/services/bulkEditPure.ts')).href);
}

function rows(n: number, over: Partial<Record<string, any>> = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `r${i + 1}`,
    stageType: 'pressing',
    quantity: 10,
    notes: '',
    ...over,
  }));
}

// --- A. Category registry ---------------------------------------------------

test('A1. the six required categories are present with bilingual labels', () => {
  const ids = reg.MASTER_DATA_CATEGORIES.map((c: any) => c.id);
  for (const id of ['productionCenters', 'products', 'materials', 'financialAccounts', 'costCenters', 'hierarchicalCostCenters']) {
    assert.ok(ids.includes(id), `category ${id} is required`);
  }
  for (const c of reg.MASTER_DATA_CATEGORIES) {
    assert.ok(c.labelAr && c.labelEn, `${c.id} needs both labels`);
    assert.equal(reg.categoryLabel(c, 'ar'), c.labelAr);
    assert.equal(reg.categoryLabel(c, 'en'), c.labelEn);
  }
});

test('A2. only categories with a VERIFIED production field may filter production', () => {
  const filterable = reg.productionFilterCategories().map((c: any) => c.id).sort();
  assert.deepEqual(filterable, ['customers', 'productionCenters', 'products'],
    'exactly the three verified mappings, no more');
});

test('A3. Financial Accounts and Cost Centers are Master-Data-only', () => {
  // UniversalStageRecord has no accountId/costCenterId/costCenterCode/
  // financialAccount - verified absent, so claiming a filter would silently
  // return wrong production data.
  for (const id of ['financialAccounts', 'costCenters', 'hierarchicalCostCenters', 'materials']) {
    assert.equal(reg.supportsProductionFilter(id), false, `${id} must not be offered as a production filter`);
    assert.equal(reg.getCategory(id).productionFilter, null);
  }
});

test('A4. the verified mappings name the real record fields', () => {
  assert.equal(reg.getCategory('productionCenters').productionFilter, 'stageType');
  assert.equal(reg.getCategory('products').productionFilter, 'productId');
  assert.equal(reg.getCategory('customers').productionFilter, 'customerId');
});

test('A5. the registry is extensible without touching a screen', () => {
  const src = readSource('src/services/masterDataCategoryRegistry.ts');
  assert.ok(/MASTER_DATA_CATEGORIES: MasterDataCategory\[\]/.test(src), 'categories are data, not code branches');
  assert.equal(/from ['"]firebase|config\/firebase/.test(src), false, 'the registry must stay Firebase-free');
});

test('A6. the hierarchical category uses the existing dedicated reader', () => {
  const c = reg.getCategory('hierarchicalCostCenters');
  assert.equal(c.reader, 'costCenterHierarchy', 'must reuse listCostCenterHierarchyNodes, not a new store');
  assert.equal(c.hierarchical, true);
  assert.equal(c.codeField, 'sheet1Code', 'must use the real persisted code field');
});

// --- B. Selection model: ONE / MULTIPLE / ALL --------------------------------

test('B1. one, multiple and all are distinct modes', () => {
  assert.equal(reg.normaliseSelection('products', ['P1'], false).mode, 'ONE');
  assert.equal(reg.normaliseSelection('products', ['P1', 'P2'], false).mode, 'MULTIPLE');
  assert.equal(reg.normaliseSelection('products', [], true).mode, 'ALL');
});

test('B2. ALL is a mode, never a materialised list of every code', () => {
  const all = reg.normaliseSelection('products', ['P1', 'P2', 'P3'], true);
  assert.equal(all.mode, 'ALL');
  assert.deepEqual(all.codes, [], 'ALL must not carry a code array - that would defeat the query');
});

test('B3. an empty selection means ALL, not "nothing"', () => {
  const sel = reg.normaliseSelection('products', [], false);
  assert.equal(sel.mode, 'ALL', 'no codes chosen must not silently return zero rows');
});

test('B4. selections are de-duplicated and ordered', () => {
  const sel = reg.normaliseSelection('products', ['P2', 'P1', 'P2'], false);
  assert.deepEqual(sel.codes, ['P1', 'P2']);
});

test('B5. TEST 3 - multiple codes match ANY selected code', () => {
  const recs = [
    { id: '1', stageType: 'pressing' }, { id: '2', stageType: 'sorting' },
    { id: '3', stageType: 'mixing' }, { id: '4', stageType: 'pressing' },
  ];
  const sel = reg.normaliseSelection('productionCenters', ['pressing', 'mixing'], false);
  const out = reg.filterRecordsBySelection(recs, sel);
  assert.deepEqual(out.map((r: any) => r.id), ['1', '3', '4']);
});

test('B6. TEST 4 - ALL returns every record in the category, unfiltered', () => {
  const recs = [{ id: '1', stageType: 'pressing' }, { id: '2', stageType: 'sorting' }];
  const all = reg.normaliseSelection('productionCenters', [], true);
  assert.equal(reg.filterRecordsBySelection(recs, all).length, 2);
});

test('B7. a category with no verified mapping never narrows production data', () => {
  const recs = [{ id: '1', stageType: 'pressing' }, { id: '2', stageType: 'sorting' }];
  const sel = reg.normaliseSelection('costCenters', ['CC-1'], false);
  // It must not silently return zero rows, and it must not invent a match.
  assert.equal(reg.filterRecordsBySelection(recs, sel).length, 2);
});

test('B8. products match on either id or code, matching the denormalised record', () => {
  const recs = [
    { id: '1', productId: 'pid-1', productCode: 'P-100' },
    { id: '2', productId: 'pid-2', productCode: 'P-200' },
  ];
  assert.deepEqual(
    reg.filterRecordsBySelection(recs, reg.normaliseSelection('products', ['P-200'], false)).map((r: any) => r.id),
    ['2'],
  );
  assert.deepEqual(
    reg.filterRecordsBySelection(recs, reg.normaliseSelection('products', ['pid-1'], false)).map((r: any) => r.id),
    ['1'],
  );
});

test('B9. filtering is in-memory over an already-bounded fetch, not per-code queries', () => {
  const src = readSource('src/services/masterDataCategoryRegistry.ts');
  assert.equal(/getDocs|onSnapshot|firebase\/firestore/.test(src), false,
    'a per-code query loop would be exactly the N+1 the quota programme forbids');
});

// --- C. Row selection -------------------------------------------------------

test('C1. TEST 5 - selecting one row gives a count of one', () => {
  const s = bulk.toggleRow(bulk.EMPTY_SELECTION_STATE, 'r1');
  assert.equal(bulk.selectionCount(s), 1);
  assert.equal(bulk.isSelected(s, 'r1'), true);
});

test('C2. TEST 6 - selecting twenty visible rows gives a count of twenty', () => {
  const visible = rows(20).map((r) => r.id);
  const s = bulk.selectAllVisible(bulk.EMPTY_SELECTION_STATE, visible);
  assert.equal(bulk.selectionCount(s), 20);
  assert.equal(bulk.areAllVisibleSelected(s, visible), true);
});

test('C3. toggling is idempotent in both directions', () => {
  let s = bulk.toggleRow(bulk.EMPTY_SELECTION_STATE, 'r1');
  s = bulk.toggleRow(s, 'r1');
  assert.equal(bulk.selectionCount(s), 0);
});

test('C4. deselect all clears, deselect-visible clears only what is on screen', () => {
  let s = bulk.selectAllVisible(bulk.EMPTY_SELECTION_STATE, ['r1', 'r2', 'r3']);
  assert.equal(bulk.selectionCount(bulk.deselectAll()), 0);
  s = bulk.deselectVisible(s, ['r1', 'r2']);
  assert.deepEqual(s.selectedIds, ['r3']);
});

test('C5. TEST 7 - changing filters drops rows that are no longer visible', () => {
  const s = bulk.selectAllVisible(bulk.EMPTY_SELECTION_STATE, ['r1', 'r2', 'r3']);
  // The filter now shows only r1.
  const pruned = bulk.pruneToVisible(s, ['r1']);
  assert.deepEqual(pruned.selectedIds, ['r1'], 'stale ids must not survive a filter change');
  assert.equal(bulk.selectionCount(pruned), 1, 'the visible count must drop so nothing happens silently');
});

// --- D. Bulk edit: selected rows only ---------------------------------------

test('D1. TEST 8 - a bulk edit targets exactly the selected rows', () => {
  const visible = rows(50);
  const selectedIds = visible.slice(0, 20).map((r) => r.id);
  const plan = bulk.planBulkEdit({ selectedIds }, visible, { notes: 'batch note' });
  assert.equal(plan.targets.length, 20);
  assert.equal(plan.totalSelected, 20);
  assert.deepEqual(plan.targets.map((t: any) => t.id).sort(), selectedIds.sort());
});

test('D2. unselected rows are never in the execution set', () => {
  const visible = rows(50);
  const plan = bulk.planBulkEdit({ selectedIds: ['r1', 'r2'] }, visible, { notes: 'x' });
  const ids = new Set(plan.targets.map((t: any) => t.id));
  for (const r of visible.slice(2)) {
    assert.equal(ids.has(r.id), false, `${r.id} was never selected and must not be targeted`);
  }
});

test('D3. a selected row that is no longer visible is SKIPPED, never written', () => {
  const visible = rows(3);
  const plan = bulk.planBulkEdit({ selectedIds: ['r1', 'r99'] }, visible, { notes: 'x' });
  assert.deepEqual(plan.targets.map((t: any) => t.id), ['r1']);
  assert.equal(plan.skipped.length, 1);
  assert.equal(plan.skipped[0].id, 'r99');
  assert.match(plan.skipped[0].reason, /no longer visible/);
});

test('D4. an empty selection produces an empty execution set', () => {
  const plan = bulk.planBulkEdit(bulk.EMPTY_SELECTION_STATE, rows(10), { notes: 'x' });
  assert.equal(plan.targets.length, 0, 'a bulk edit with nothing selected must do nothing');
});

// --- E. Field safety --------------------------------------------------------

test('E1. only fields proven safe for many-row writes are editable', () => {
  assert.deepEqual([...bulk.BULK_EDITABLE_FIELDS], ['notes']);
  assert.equal(bulk.isBulkEditable('notes'), true);
});

test('E2. protected, derived, relational and system fields are refused', () => {
  for (const f of ['id', 'status', 'createdAt', 'updatedAt', 'stageType', 'quantity',
                   'wasteQuantity', 'productionTons', 'gasPerTon', 'productId',
                   'productCode', 'customerId', 'date', 'rawData']) {
    assert.equal(bulk.isBulkEditable(f), false, `${f} must not be bulk-editable`);
    assert.throws(() => bulk.assertBulkEditableFields({ [f]: 'x' }), /not safe to bulk edit/, `${f} must be rejected`);
  }
});

test('E3. quantity is per-record and deliberately excluded even though single edit allows it', () => {
  // The single-record editor exposes quantity/wasteQuantity/notes. Applying one
  // quantity to twenty records would corrupt production data, not correct it.
  assert.equal(bulk.isBulkEditable('quantity'), false);
  assert.equal(bulk.isBulkEditable('wasteQuantity'), false);
  const src = readSource('src/services/bulkEditPure.ts');
  assert.ok(/per-record measurements/.test(src), 'the exclusion must be explained, not silent');
});

test('E4. an unsafe field is refused before any row is planned', () => {
  assert.throws(() => bulk.planBulkEdit({ selectedIds: ['r1'] }, rows(1), { quantity: 999 }), /not safe to bulk edit/);
});

// --- F. Per-row validation and partial failure ------------------------------

test('F1. TEST 9 - 18 valid + 2 invalid: the 18 still succeed', () => {
  const visible = rows(20);
  const bad = new Set(['r5', 'r12']);
  const plan = bulk.planBulkEdit(
    { selectedIds: visible.map((r) => r.id) },
    visible,
    { notes: 'batch' },
    (row: any) => (bad.has(row.id) ? 'row failed validation' : null),
  );
  assert.equal(plan.targets.length, 18, 'the valid rows must still be executed');
  assert.equal(plan.invalid.length, 2);
  assert.deepEqual(plan.invalid.map((i: any) => i.id).sort(), ['r12', 'r5']);
  // Critically: the invalid rows are not in the execution set at all.
  const ids = new Set(plan.targets.map((t: any) => t.id));
  assert.equal(ids.has('r5'), false);
  assert.equal(ids.has('r12'), false);
});

test('F2. validation runs per row, not once for the batch', () => {
  const visible = rows(5);
  const seen: string[] = [];
  bulk.planBulkEdit({ selectedIds: visible.map((r) => r.id) }, visible, { notes: 'x' }, (row: any) => {
    seen.push(row.id);
    return null;
  });
  assert.equal(seen.length, 5, 'every row must be validated individually');
});

test('F3. a write failure is isolated and reported without touching the successes', () => {
  const visible = rows(20);
  const plan = bulk.planBulkEdit({ selectedIds: visible.map((r) => r.id) }, visible, { notes: 'x' });
  const results = plan.targets.map((t: any, i: number) =>
    i < 18 ? { id: t.id, ok: true } : { id: t.id, ok: false, reason: 'permission-denied' });
  const outcome = bulk.summariseBulkEdit(plan, results);
  assert.equal(outcome.successCount, 18);
  assert.equal(outcome.failedCount, 2);
  assert.equal(outcome.succeeded.length, 18, 'the successful writes are NOT rolled back');
});

test('F4. rejected, errored and not-attempted rows are distinguishable', () => {
  const visible = rows(5);
  const plan = bulk.planBulkEdit(
    { selectedIds: [...visible.map((r) => r.id), 'gone'] },
    visible,
    { notes: 'x' },
    (row: any) => (row.id === 'r1' ? 'invalid' : null),
  );
  const results = plan.targets.map((t: any) => ({ id: t.id, ok: t.id !== 'r2', reason: 'write failed' }));
  const outcome = bulk.summariseBulkEdit(plan, results);

  assert.equal(outcome.successCount, 3, 'r3 r4 r5 succeed');
  assert.equal(outcome.failedCount, 2, 'r1 rejected + r2 errored');
  assert.equal(outcome.skippedCount, 1, 'the id that vanished was never attempted');
  assert.equal(outcome.totalSelected, 6);
  assert.ok(outcome.failed.some((f: any) => f.id === 'r1' && f.reason === 'invalid'));
  assert.ok(outcome.failed.some((f: any) => f.id === 'r2'));
  assert.ok(outcome.skipped.some((s: any) => s.id === 'gone'));
});

test('F5. the confirmation always states the exact execution count, bilingually', () => {
  assert.match(bulk.confirmationMessage(25, 'en'), /Only 25 selected record\(s\) will be modified/);
  assert.match(bulk.confirmationMessage(25, 'ar'), /سيتم تعديل 25 سجل محدد فقط/);
});

// --- G. No deletion architecture --------------------------------------------

test('G1. no delete primitive is introduced anywhere by this work', () => {
  for (const f of ['src/services/bulkEditPure.ts', 'src/services/masterDataCategoryRegistry.ts']) {
    const src = readSource(f);
    assert.equal(/deleteDoc|deleteStageRecord|bulkDelete|softDelete|voided/i.test(src), false,
      `${f} must not introduce any deletion path`);
  }
});

test('G2. stage records still have no delete function in the service layer', () => {
  const svc = readSource('src/services/stageRecordService.ts');
  assert.equal(/export async function deleteStageRecord/.test(svc), false,
    'production records are corrected and approved/rejected, never deleted - that design is preserved');
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

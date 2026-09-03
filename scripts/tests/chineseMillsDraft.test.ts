/**
 * Focused tests for Chinese Mills Draft save/reopen/delete (chineseMillsDraftPure.ts).
 * Uses a tiny in-memory localStorage mock installed on globalThis BEFORE
 * importing the module under test, so no browser/jsdom dependency is needed.
 *
 * Run: npx tsx scripts/tests/chineseMillsDraft.test.ts
 */
import assert from 'node:assert/strict';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  removeItem(key: string) { this.store.delete(key); }
  clear() { this.store.clear(); }
}

(globalThis as any).window = { localStorage: new MemoryStorage() };

const { buildDraft, saveDraftLocal, getDraftLocal, deleteDraftLocal, storageKey } = await import('../../src/services/chineseMillsDraftPure');

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(err);
  }
}

console.log('chineseMillsDraft.test.ts');

function makeRow(rowIndex: number, overrides: Record<string, any> = {}) {
  return {
    rowIndex,
    raw: {},
    date: '2026-05-01',
    customerNameRaw: '',
    specificationCodeRaw: '',
    millTypeRaw: '5101',
    shiftRaw: '1',
    productionQuantity: 3,
    numberOfBags: 5,
    rejectedQuantity: 0,
    operatingMinutes: 30,
    operatingHours: 3,
    totalOperatingTimeHours: 3,
    downtimeHours: 0,
    actualRateDecision: 'NOT_APPLICABLE',
    status: 'VALID',
    errors: [],
    warnings: [],
    isDuplicate: false,
    rowSelection: 'INCLUDED',
    ...overrides,
  };
}

const summaryFixture = {
  totalRows: 3, validRows: 3, warningRows: 0, errorRows: 0, duplicateRows: 0,
  unknownCustomersCount: 0, unknownMillsCount: 0, unknownFaultTypesCount: 0,
  shiftErrorsCount: 0, bagWeightMismatchCount: 0, actualRateSuggestionsCount: 0,
} as any;

// TEST 10: Save Draft preserves state
test('TEST 10 - saveDraftLocal preserves the exact row array and summary passed in', () => {
  (globalThis as any).window.localStorage.clear();
  const rows = [makeRow(1), makeRow(2, { errors: ['unknown mill'], rowSelection: 'PENDING' })];
  const outcome = saveDraftLocal('test.xlsx', rows as any, summaryFixture, 'user@asfour.com');
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.draft.rows.length, 2);
  assert.deepEqual(outcome.draft.rows[1].errors, ['unknown mill']);
  assert.equal(outcome.draft.fileName, 'test.xlsx');
  assert.equal(outcome.draft.createdBy, 'user@asfour.com');
});

// TEST 11: Reopen Draft preserves state
test('TEST 11 - getDraftLocal returns exactly what was saved (round-trip through JSON)', () => {
  (globalThis as any).window.localStorage.clear();
  const rows = [makeRow(1, { notes: 'حمولة أولى' }), makeRow(2, { resolutionHistory: [{ timestamp: 't', actor: 'a', action: 'FULL_ROW_EDIT', summary: 's' }] })];
  saveDraftLocal('roundtrip.xlsx', rows as any, summaryFixture, 'user@asfour.com');
  const reopened = getDraftLocal('user@asfour.com');
  assert.ok(reopened);
  assert.equal(reopened!.rows.length, 2);
  assert.equal(reopened!.rows[0].notes, 'حمولة أولى');
  assert.equal(reopened!.rows[1].resolutionHistory?.length, 1);
  assert.equal(reopened!.fileName, 'roundtrip.xlsx');
});

// TEST 12: Delete Draft deletes the draft only
test('TEST 12 - deleteDraftLocal removes only the calling user\'s draft, leaving other users\' drafts and other storage keys untouched', () => {
  (globalThis as any).window.localStorage.clear();
  saveDraftLocal('userA.xlsx', [makeRow(1)] as any, summaryFixture, 'a@asfour.com');
  saveDraftLocal('userB.xlsx', [makeRow(1)] as any, summaryFixture, 'b@asfour.com');
  (globalThis as any).window.localStorage.setItem('unrelated.key', 'untouched');

  const deleted = deleteDraftLocal('a@asfour.com');
  assert.ok(deleted);
  assert.equal(deleted!.fileName, 'userA.xlsx');
  assert.equal(getDraftLocal('a@asfour.com'), null, 'a@asfour.com draft must be gone');
  assert.ok(getDraftLocal('b@asfour.com'), 'b@asfour.com draft must be UNTOUCHED');
  assert.equal((globalThis as any).window.localStorage.getItem('unrelated.key'), 'untouched', 'unrelated storage keys must never be touched');
});

// TEST 13: Cancel does not destroy draft (Cancel = simply not calling delete/save; verify a plain read after "opening" a draft leaves it intact)
test('TEST 13 - reading/reopening a draft (equivalent to Cancel after Open Draft) never mutates or removes it', () => {
  (globalThis as any).window.localStorage.clear();
  saveDraftLocal('cancel-test.xlsx', [makeRow(1), makeRow(2)] as any, summaryFixture, 'c@asfour.com');
  const before = getDraftLocal('c@asfour.com');
  // Simulate "Cancel": just read again without calling save/delete.
  const after = getDraftLocal('c@asfour.com');
  assert.deepEqual(before, after);
  assert.equal(after!.rows.length, 2);
});

// TEST 16: Original row data remains unchanged after correction
test('TEST 16 - raw (original Excel row data) survives a full save/reopen cycle unchanged, separate from any corrected fields', () => {
  (globalThis as any).window.localStorage.clear();
  const originalRaw = { 'التاريخ': '2026-05-01', 'نوع الطاحونة': 'BADVALUE' };
  const row = makeRow(1, {
    raw: originalRaw,
    millTypeRaw: 'BADVALUE',
    editedRowData: { millTypeRaw: '5101' }, // corrected value stored SEPARATELY
    resolutionHistory: [{ timestamp: 't', actor: 'a', action: 'FULL_ROW_EDIT', summary: 'fixed mill type' }],
  });
  saveDraftLocal('preserve-raw.xlsx', [row] as any, summaryFixture, 'd@asfour.com');
  const reopened = getDraftLocal('d@asfour.com')!;
  assert.deepEqual(reopened.rows[0].raw, originalRaw, 'original Excel row data must be byte-identical after save/reopen');
  assert.equal(reopened.rows[0].millTypeRaw, 'BADVALUE', 'the raw imported value itself is untouched by correction');
  assert.deepEqual(reopened.rows[0].editedRowData, { millTypeRaw: '5101' }, 'the CORRECTED value lives in a separate field, never overwriting the original');
});

// buildDraft id/timestamp stability (backs TEST 10/11: re-saving updates the SAME draft).
test('buildDraft keeps the same id/createdAt across an update, refreshes updatedAt', async () => {
  const first = buildDraft('f.xlsx', [], summaryFixture, 'e@asfour.com', null);
  await new Promise((r) => setTimeout(r, 5));
  const second = buildDraft('f.xlsx', [], summaryFixture, 'e@asfour.com', first);
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.notEqual(second.updatedAt, first.updatedAt);
});

test('storageKey namespaces by user email', () => {
  assert.notEqual(storageKey('a@asfour.com'), storageKey('b@asfour.com'));
  assert.equal(storageKey(''), storageKey('')); // consistent for anonymous
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

/**
 * Focused tests for Tube/Ball Mills Draft save/reopen/delete
 * (tubeBallMillsDraftPure.ts) - mirrors chineseMillsDraft.test.ts's exact
 * coverage, adapted to this stage's row shape.
 *
 * Run: npx tsx scripts/tests/tubeBallMillsDraft.test.ts
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

const { buildDraft, saveDraftLocal, getDraftLocal, deleteDraftLocal, storageKey } = await import('../../src/services/tubeBallMillsDraftPure');

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

console.log('tubeBallMillsDraft.test.ts');

function makeRow(rowIndex: number, overrides: Record<string, any> = {}) {
  return {
    rowIndex,
    raw: {},
    date: '2026-05-01',
    millTypeRaw: 'طاحونة 1',
    materialTypeRaw: 'جريت',
    isMixture: false,
    operatingHours: 8,
    tonsPerHour: 12.5,
    totalTons: 100,
    storageBunkersRaw: '54',
    bunkerAllocations: [{ bunkerRaw: '54', allocatedTons: 100 }],
    bunkerAllocationValid: true,
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
  unknownMillsCount: 0, unknownMaterialsCount: 0, unresolvedMixtureCount: 0,
  unknownBunkersCount: 0, invalidBunkerAllocationCount: 0,
} as any;

// TEST 24: Save/Open Draft.
test('TEST 24 - saveDraftLocal preserves the exact row array and summary passed in', () => {
  (globalThis as any).window.localStorage.clear();
  const rows = [makeRow(1), makeRow(2, { errors: ['unknown mill'], rowSelection: 'PENDING' })];
  const outcome = saveDraftLocal('tube-mills.xlsx', rows as any, summaryFixture, 'user@asfour.com');
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.draft.rows.length, 2);
  assert.deepEqual(outcome.draft.rows[1].errors, ['unknown mill']);
  assert.equal(outcome.draft.fileName, 'tube-mills.xlsx');
});

test('TEST 24 - getDraftLocal (Open Draft) round-trips the state exactly, including mixture components', () => {
  (globalThis as any).window.localStorage.clear();
  const rows = [makeRow(1, {
    isMixture: true,
    mixtureComponents: [{ materialNameRaw: 'جريت', quantityKg: 54, percentage: 40 }, { materialNameRaw: 'كلاى مخلط', quantityKg: 37, percentage: 27.4 }],
    mixtureTotalQuantityKg: 91,
  })];
  saveDraftLocal('roundtrip.xlsx', rows as any, summaryFixture, 'user@asfour.com');
  const reopened = getDraftLocal('user@asfour.com');
  assert.ok(reopened);
  assert.equal(reopened!.rows[0].mixtureComponents?.length, 2);
  assert.equal(reopened!.rows[0].mixtureComponents?.[0].percentage, 40);
});

test('deleteDraftLocal removes only the calling user\'s draft, other users\' drafts untouched', () => {
  (globalThis as any).window.localStorage.clear();
  saveDraftLocal('userA.xlsx', [makeRow(1)] as any, summaryFixture, 'a@asfour.com');
  saveDraftLocal('userB.xlsx', [makeRow(1)] as any, summaryFixture, 'b@asfour.com');
  const deleted = deleteDraftLocal('a@asfour.com');
  assert.ok(deleted);
  assert.equal(getDraftLocal('a@asfour.com'), null);
  assert.ok(getDraftLocal('b@asfour.com'));
});

// §26: original Excel data preserved through a save/reopen cycle.
test('§26 - raw (original Excel row data) survives a full save/reopen cycle unchanged, separate from corrected fields', () => {
  (globalThis as any).window.localStorage.clear();
  const originalRaw = { 'التاريخ': '2026-05-01', 'نوع الطاحونة': 'BADVALUE' };
  const row = makeRow(1, {
    raw: originalRaw,
    millTypeRaw: 'BADVALUE',
    editedRowData: { millTypeRaw: 'طاحونة 1' },
    resolutionHistory: [{ timestamp: 't', actor: 'a', action: 'FULL_ROW_EDIT', summary: 'fixed mill type' }],
  });
  saveDraftLocal('preserve-raw.xlsx', [row] as any, summaryFixture, 'd@asfour.com');
  const reopened = getDraftLocal('d@asfour.com')!;
  assert.deepEqual(reopened.rows[0].raw, originalRaw);
  assert.equal(reopened.rows[0].millTypeRaw, 'BADVALUE', 'the raw imported value itself is untouched by correction');
  assert.deepEqual(reopened.rows[0].editedRowData, { millTypeRaw: 'طاحونة 1' });
});

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
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

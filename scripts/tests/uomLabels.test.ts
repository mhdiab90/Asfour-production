/**
 * UOM LABEL CORRECTION - CHINESE MILLS + SORTING - Phase 1 Step 8A.
 *
 * The Data Review list unit (UniversalStageRecord.unit, built in
 * stageRecordService) now follows the field its `quantity` came from. A label
 * correction only: the quantity expression, every calculation, every write and
 * every stored value are unchanged.
 *
 * Run: npx tsx scripts/tests/uomLabels.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STEP_8A_APPROVED_STAGE_RECORD_CHANGES, stageRecordServiceChangedBeyondApproved } from './stageRecordServiceBaseline';
import { changedBeyondStep8C5 } from './step8c5Baseline';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('uomLabels.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SERVICE = 'src/services/stageRecordService.ts';

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}
const head = (rel: string) => execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, encoding: 'utf-8' }).replace(/\r\n/g, '\n');

let rd: any;
let uom: any;
let bom: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  rd = await load('src/services/uomReadinessPure.ts');
  uom = await load('src/services/uomPure.ts');
  bom = await load('src/services/bomPure.ts');
}

/** The list quantity exactly as stageRecordService computes it (unchanged). */
const listQuantity = (d: any) => Number(d.productionQuantity ?? d.quantity ?? d.totalTons ?? d.totalCount ?? 0);
/** The label as it was before Step 8A. */
const oldLabel = (st: string) => (st === 'sorting' || st === 'pressing' ? 'قطعة' : st === 'chinese_mills' ? 'شيكارة' : 'طن');

test('1. Chinese Mills production quantity is labelled طن - never شيكارة, never شكارة', () => {
  for (const d of [{ quantity: 12, numberOfBags: 300 }, { productionQuantity: 12, numberOfBags: 300 }, { productionQuantity: 3.75 }, {}]) {
    assert.equal(rd.stageListQuantityUnit('chinese_mills', d), 'طن', JSON.stringify(d));
  }
  assert.equal(listQuantity({ quantity: 12, numberOfBags: 300 }), 12, 'the number shown is the production quantity, not the bag count');
});

test('2. the Chinese Mills bag count stays a separate شكارة quantity, never merged with the tons', () => {
  const row = rd.STAGE_UOM_MATRIX.find((r: any) => r.stageType === 'chinese_mills');
  assert.deepEqual([row.production.fields, row.production.unit], [['productionQuantity', 'quantity'], 'طن']);
  assert.deepEqual(row.otherMeasures.map((m: any) => [m.fields, m.unit]), [[['numberOfBags'], 'شكارة']]);
  assert.deepEqual([row.reviewListUnit, row.status], ['طن', 'READY']);
  assert.equal(rd.STAGE_LIST_QUANTITY_FIELDS.includes('numberOfBags'), false, 'the bag count never becomes the list quantity');
});

test('3. Sorting piece counts are labelled قطعة', () => {
  assert.equal(rd.stageListQuantityUnit('sorting', { totalCount: 1500 }), 'قطعة');
  assert.equal(rd.stageListQuantityUnit('sorting', { productionQuantity: 1500, totalCount: 1500, totalTons: 6.75 }), 'قطعة');
  assert.equal(rd.stageListQuantityUnit('sorting', {}), 'قطعة');
  const row = rd.STAGE_UOM_MATRIX.find((r: any) => r.stageType === 'sorting');
  assert.deepEqual([row.production.fields, row.production.unit, row.status], [['totalCount'], 'قطعة', 'READY']);
});

test('4. when the Sorting list quantity is the derived totalTons, it is labelled طن - never pieces', () => {
  const d = { totalCount: 1500, totalTons: 6.75, pieceWeight: 4.5 };
  assert.equal(listQuantity(d), 6.75, 'the list shows the same number as before');
  assert.equal(rd.stageListQuantityUnit('sorting', d), 'طن');
  const row = rd.STAGE_UOM_MATRIX.find((r: any) => r.stageType === 'sorting');
  assert.deepEqual(row.otherMeasures.map((m: any) => [m.fields, m.unit]), [[['totalTons'], 'طن']]);
});

test('5. no production number changed: the list quantity expression and the unit source order are identical', () => {
  const quantityLine = "          quantity: Number(d.productionQuantity ?? d.quantity ?? d.totalTons ?? d.totalCount ?? 0),\n";
  assert.ok(head(SERVICE).includes(quantityLine) && readSource(SERVICE).includes(quantityLine));
  assert.deepEqual([...rd.STAGE_LIST_QUANTITY_FIELDS], ['productionQuantity', 'quantity', 'totalTons', 'totalCount'], 'the label reads the same fields in the same order');
});

test('6. no calculation, query or write changed: stageRecordService differs from HEAD only by the approved label change', () => {
  assert.equal(stageRecordServiceChangedBeyondApproved(ROOT), '');
  // Step 8A: one import and one unit line. Step 8C-5 (approved, separate): the three new stages' names,
  // their place in the unified read, and hand-made brick measured like pressing.
  assert.equal(STEP_8A_APPROVED_STAGE_RECORD_CHANGES.length, 5, 'one import and one unit line, plus the three Step 8C-5 entries - nothing else');
  assert.ok(readSource(SERVICE).includes('prodTons = Number(((prodCount * pieceWeightKg) / 1000).toFixed(3));'), 'piece-weight tons unchanged');
  // Step 8C-5's approved stage additions are not a quantity change (step8c5Baseline.ts).
  const others = changedBeyondStep8C5(ROOT, ['src/utils/productionCalculations.ts', 'src/services/productionService.ts', 'src/services/stageQueryBoundsPure.ts', 'src/components/production/SortingEntryForm.tsx', 'src/components/production/ChineseMillsEntryForm.tsx', 'firestore.rules']).split('\n').filter(Boolean);
  // Those two forms and the rules already carried earlier-step uncommitted changes; the label fix touches none of their quantities.
  for (const f of others) assert.ok(['src/components/production/SortingEntryForm.tsx', 'src/components/production/ChineseMillsEntryForm.tsx', 'firestore.rules'].includes(f), f);
  assert.ok(readSource('src/components/production/SortingEntryForm.tsx').includes('const totalTons = Number(((totalCount * pieceWeight) / 1000).toFixed(2));'), 'sorting piece-weight calculation unchanged');
  assert.equal(/stageListQuantityUnit/.test(readSource('src/components/production/SortingEntryForm.tsx') + readSource('src/components/production/ChineseMillsEntryForm.tsx')), false, 'entry forms and their writes untouched');
});

test('7. no other stage label changed', () => {
  const fixtures = [{}, { productionQuantity: 5 }, { quantity: 5 }, { totalTons: 5 }, { totalCount: 5 }, { productionQuantity: 5, totalTons: 2, totalCount: 9 }];
  for (const st of ['pressing', 'rotary_furnace', 'tube_ball_mills', 'mortar_concrete', 'mixing', 'lightweight_foam']) {
    for (const d of fixtures) assert.equal(rd.stageListQuantityUnit(st, d), oldLabel(st), `${st} ${JSON.stringify(d)}`);
  }
});

test('8. the Step 8 legacy alias handling is kept: "شيكارة" still normalises to "شكارة" for validation', () => {
  assert.deepEqual([uom.normaliseUom('شيكارة').status, uom.normaliseUom('شيكارة').normalized], ['LEGACY_ALIAS', 'شكارة']);
  assert.equal(bom.approvedUnitSpelling('شيكارة'), 'شكارة');
  assert.equal(readSource(SERVICE).includes('شيكارة'), false, 'the list no longer emits the legacy spelling');
});

async function run() {
  await bootstrap();
  for (const { name, fn } of registered) {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${name}`);
      console.log(err);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
run();

/**
 * Reports - focused behavioural tests for the reporting layer.
 *
 * WHY A LOADER SHIM: reportingEngine.ts is pure logic, but it imports two
 * CONSTANTS (STAGE_DISPLAY_NAMES / STAGE_COLLECTION_NAMES) from
 * stageRecordService.ts, which reaches ../config/firebase and reads
 * `import.meta.env` at module scope - so it throws under plain tsx. Rather
 * than settle for string-matching the source, this loads the REAL
 * reportingEngine with only that one import replaced by the same constant
 * values, and relative specifiers rewritten to absolute file URLs so the
 * copy can live outside the repository. Aggregation, filtering and ranking
 * below are the actual shipped implementations, exercised with fixtures.
 *
 * ReportsView.tsx itself is React-coupled and cannot be imported here, so
 * its wiring (bounded fetch, All Time, export input) is verified by source
 * inspection - the established convention for this repo's UI files.
 *
 * Zero Firestore: 0 reads, 0 writes, 0 deletes.
 *
 * Run: npx tsx scripts/tests/reportsView.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('reportsView.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asfour-reports-'));

const viewSource = fs.readFileSync(path.join(ROOT, 'src/components/reports/ReportsView.tsx'), 'utf-8');
const viewCode = viewSource.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

function absolutise(source: string, originalPath: string): string {
  const dir = path.dirname(originalPath);
  return source.replace(/(from\s*['"])(\.[^'"]+)(['"])/g, (_m, a, spec, c) => {
    const base = path.resolve(dir, spec);
    for (const cand of [base + '.ts', base + '.tsx', base + '/index.ts']) {
      if (fs.existsSync(cand)) return a + pathToFileURL(cand).href + c;
    }
    return a + spec + c;
  });
}

let engine: any;

async function loadEngine() {
  const abs = path.join(ROOT, 'src/services/reportingEngine.ts');
  let src = fs.readFileSync(abs, 'utf-8');
  const needle = "import { STAGE_DISPLAY_NAMES, STAGE_COLLECTION_NAMES } from './stageRecordService';";
  assert.ok(src.includes(needle), 'reportingEngine imports changed - update this shim');
  src = src.replace(
    needle,
    "const STAGE_DISPLAY_NAMES: Record<string, string> = { pressing: 'التشكيل والمكابس', rotary_furnace: 'الفرن الدوار', chinese_mills: 'الطواحين الصينية', tube_ball_mills: 'طواحين الأنابيب والكرات', mortar_concrete: 'المونة والخرسانات', mixing: 'الخلط والتجهيز', lightweight_foam: 'الشاموت الخفيف / عزل الفوم', sorting: 'الفرز والمراقبة' };\n" +
    "const STAGE_COLLECTION_NAMES: Record<string, string> = { pressing: 'production', rotary_furnace: 'stage_rotary_furnace', chinese_mills: 'stage_chinese_mills', tube_ball_mills: 'stage_tube_ball_mills', mortar_concrete: 'stage_mortar_concrete', mixing: 'stage_mixing', lightweight_foam: 'stage_lightweight_foam', sorting: 'stage_sorting' };"
  );
  src = absolutise(src, abs);
  const out = path.join(TMP, 'reportingEngine.ts');
  fs.writeFileSync(out, src, 'utf-8');
  engine = await import(pathToFileURL(out).href);
}

/** Representative cross-stage fixtures shaped like real UniversalStageRecord rows. */
function rec(over: Record<string, any>) {
  return {
    id: 'r', stageType: 'pressing', stageNameAr: 'التشكيل والمكابس', date: '2026-03-10',
    quantity: 0, unit: 'قطعة', productionTons: 0, goodTons: 0, wasteTons: 0,
    totalDowntimeMinutes: 0, status: 'APPROVED', createdBy: 'u', createdAt: '', updatedAt: '',
    workers: [], ...over,
  } as any;
}

const RECORDS = [
  rec({ id: 'p1', stageType: 'pressing', date: '2026-03-01', productionTons: 10, goodTons: 9, wasteTons: 1,
        productId: 'PR-1', productName: 'طوب حراري', customerId: 'C1', customerName: 'شركة الحديد',
        totalDowntimeMinutes: 30, workers: [{ employeeId: 'E1', employeeName: 'أحمد' }] }),
  rec({ id: 'p2', stageType: 'pressing', date: '2026-03-15', productionTons: 20, goodTons: 18, wasteTons: 2,
        productId: 'PR-1', productName: 'طوب حراري', customerId: 'C2', customerName: 'مصنع الأسمنت',
        totalDowntimeMinutes: 10, workers: [{ employeeId: 'E2', employeeName: 'سعيد' }] }),
  rec({ id: 'm1', stageType: 'mixing', stageNameAr: 'الخلط والتجهيز', date: '2026-03-20',
        productionTons: 5, goodTons: 5, wasteTons: 0, productId: 'PR-2', productName: 'خلطة',
        customerId: 'C1', customerName: 'شركة الحديد', totalDowntimeMinutes: 0,
        workers: [{ employeeId: 'E1', employeeName: 'أحمد' }] }),
  rec({ id: 's1', stageType: 'sorting', stageNameAr: 'الفرز والمراقبة', date: '2026-04-05',
        productionTons: 7, goodTons: 6, wasteTons: 1, productId: 'PR-3', productName: 'فرز',
        customerId: 'C3', customerName: 'ACME', totalDowntimeMinutes: 5, workers: [] }),
];

const sumTons = (rows: any[]) => rows.reduce((s, r) => s + (r.productionTons || 0), 0);

// ---------------------------------------------------------------------------
// A. Cross-stage aggregation
// ---------------------------------------------------------------------------

test('A1. aggregates across MULTIPLE production stages, not just Pressing', () => {
  const rows = engine.aggregateByDimension(RECORDS, 'stage', 'ar');
  assert.ok(rows.length >= 3, `expected at least 3 stages, got ${rows.length}`);
  assert.equal(Number(sumTons(rows).toFixed(2)), 42, 'total tons must span all four fixture records');
});

test('A2. ALL_STAGES covers the eight production stages', () => {
  assert.equal(engine.ALL_STAGES.length, 8);
  for (const s of ['pressing', 'mixing', 'sorting', 'lightweight_foam']) {
    assert.ok(engine.ALL_STAGES.includes(s), `${s} must be a known stage`);
  }
});

// ---------------------------------------------------------------------------
// B. Date filtering - the ACTUAL current semantics, not a redefinition
// ---------------------------------------------------------------------------

test('B1. startDate filters out earlier records', () => {
  const out = engine.filterUniversalRecords(RECORDS, { startDate: '2026-03-15' });
  assert.deepEqual(out.map((r: any) => r.id), ['p2', 'm1', 's1']);
});

test('B2. endDate filters out later records', () => {
  const out = engine.filterUniversalRecords(RECORDS, { endDate: '2026-03-15' });
  assert.deepEqual(out.map((r: any) => r.id), ['p1', 'p2']);
});

test('B3. both boundaries are INCLUSIVE (matches where(date,>=)/where(date,<=))', () => {
  const out = engine.filterUniversalRecords(RECORDS, { startDate: '2026-03-01', endDate: '2026-03-15' });
  assert.deepEqual(out.map((r: any) => r.id), ['p1', 'p2'], 'records exactly on each boundary are included');
  const single = engine.filterUniversalRecords(RECORDS, { startDate: '2026-03-15', endDate: '2026-03-15' });
  assert.deepEqual(single.map((r: any) => r.id), ['p2'], 'a single-day range returns that day');
});

// ---------------------------------------------------------------------------
// C. All Time
// ---------------------------------------------------------------------------

test('C1. absent/empty bounds apply NO date filter (All Time)', () => {
  assert.equal(engine.filterUniversalRecords(RECORDS, {}).length, RECORDS.length);
  assert.equal(engine.filterUniversalRecords(RECORDS, { startDate: '', endDate: '' }).length, RECORDS.length);
  assert.equal(engine.filterUniversalRecords(RECORDS, { startDate: undefined, endDate: undefined }).length, RECORDS.length);
});

test('C2. ReportsView\'s own defaults produce the All Time path', () => {
  assert.match(viewCode, /useState<string>\(prefill\?\.startDate \|\| ''\)/);
  assert.match(viewCode, /useState<string>\(prefill\?\.endDate \|\| ''\)/);
  assert.match(viewCode, /startDate: startDate \|\| undefined,/);
  assert.match(viewCode, /endDate: endDate \|\| undefined,/);
});

// ---------------------------------------------------------------------------
// D. Aggregation / KPI correctness
// ---------------------------------------------------------------------------

test('D1. per-dimension totals are correct (product dimension)', () => {
  const rows = engine.aggregateByDimension(RECORDS, 'product', 'ar');
  const pr1 = rows.find((r: any) => r.label.includes('طوب') || r.key === 'PR-1');
  assert.ok(pr1, 'the repeated product must appear as one aggregated row');
  assert.equal(Number(pr1.productionTons.toFixed(2)), 30, 'PR-1 = 10 + 20 tons');
  assert.equal(Number(pr1.goodTons.toFixed(2)), 27);
  assert.equal(Number(pr1.wasteTons.toFixed(2)), 3);
  assert.equal(pr1.operationsCount, 2);
});

test('D2. waste percentage and downtime are derived, not summed blindly', () => {
  const rows = engine.aggregateByDimension(RECORDS, 'product', 'ar');
  const pr1 = rows.find((r: any) => r.key === 'PR-1') || rows[0];
  assert.ok(pr1.wastePercentage >= 0 && pr1.wastePercentage <= 100, 'waste % must be a percentage');
  assert.equal(Number(pr1.downtimeMinutes.toFixed(1)), 40, 'downtime = 30 + 10 minutes');
});

test('D3. customer and employee dimensions aggregate independently', () => {
  const byCustomer = engine.aggregateByDimension(RECORDS, 'customer', 'ar');
  assert.ok(byCustomer.length >= 3, 'three distinct customers in the fixtures');
  const c1 = byCustomer.find((r: any) => r.key === 'C1');
  assert.ok(c1 && Number(c1.productionTons.toFixed(2)) === 15, 'C1 = 10 (pressing) + 5 (mixing)');

  const byEmployee = engine.aggregateByDimension(RECORDS, 'employee', 'ar');
  const e1 = byEmployee.find((r: any) => r.key === 'E1');
  assert.ok(e1, 'employee dimension must resolve from the workers array');
});

// ---------------------------------------------------------------------------
// E. Non-date filters
// ---------------------------------------------------------------------------

test('E1. stageType narrows to a single stage', () => {
  const out = engine.filterUniversalRecords(RECORDS, { stageType: 'pressing' });
  assert.deepEqual(out.map((r: any) => r.id), ['p1', 'p2']);
});

test('E2. entity filters compose with the date range', () => {
  const out = engine.filterUniversalRecords(RECORDS, { customerId: 'C1', startDate: '2026-03-16' });
  assert.deepEqual(out.map((r: any) => r.id), ['m1'], 'customer AND date must both apply');
});

// ---------------------------------------------------------------------------
// F. Ranking / derived rows
// ---------------------------------------------------------------------------

test('F1. rankRows orders by the requested metric, best and worst', () => {
  const rows = engine.aggregateByDimension(RECORDS, 'product', 'ar');
  const best = engine.rankRows(rows, 'productionTons', 'best', 2);
  assert.ok(best.length <= 2);
  assert.ok(best[0].productionTons >= (best[1]?.productionTons ?? -Infinity), 'best is descending');

  const worst = engine.rankRows(rows, 'productionTons', 'worst', 2);
  assert.ok(worst[0].productionTons <= (worst[1]?.productionTons ?? Infinity), 'worst is ascending');
});

test('F2. report categories are defined and each names a dimension', () => {
  assert.ok(Array.isArray(engine.REPORT_CATEGORIES) && engine.REPORT_CATEGORIES.length > 0);
  for (const c of engine.REPORT_CATEGORIES) {
    assert.ok(c.id && c.dimension, 'every category needs an id and a dimension');
  }
});

// ---------------------------------------------------------------------------
// G. Export input integrity
// ---------------------------------------------------------------------------

test('G1. export receives the AGGREGATED filtered rows, never the raw record set', () => {
  assert.match(viewCode, /exportAggregatedReportToExcel\(\s*reportRows,/);
  assert.match(viewCode, /const reportRows = useMemo\(/);
  assert.match(viewCode, /aggregateByDimension\(filteredRecords,/);
  assert.match(viewCode, /const filteredRecords = useMemo\(\(\) => filterUniversalRecords\(records, filters\)/);
  assert.equal(/exportAggregatedReportToExcel\(\s*records\b/.test(viewCode), false,
    'export must not be handed the unfiltered record set');
});

test('G2. the export path performs no Firestore read of its own', () => {
  const exportSrc = fs.readFileSync(path.join(ROOT, 'src/services/exportService.ts'), 'utf-8');
  const code = exportSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.equal(/from 'firebase\/firestore'/.test(code), false);
  assert.equal(/getDocs\(|onSnapshot\(|fetchUniversalStageRecords/.test(code), false);
});

// ---------------------------------------------------------------------------
// H. Empty data
// ---------------------------------------------------------------------------

test('H1. no records produces empty results rather than throwing', () => {
  assert.doesNotThrow(() => engine.filterUniversalRecords([], { startDate: '2026-01-01' }));
  assert.deepEqual(engine.filterUniversalRecords([], {}), []);
  assert.deepEqual(engine.aggregateByDimension([], 'product', 'ar'), []);
  assert.deepEqual(engine.rankRows([], 'productionTons', 'best', 5), []);
});

test('H2. a filter matching nothing yields an empty aggregation', () => {
  const none = engine.filterUniversalRecords(RECORDS, { startDate: '2030-01-01' });
  assert.deepEqual(none, []);
  assert.deepEqual(engine.aggregateByDimension(none, 'stage', 'ar'), []);
});

test('H3. records with missing optional fields do not break aggregation', () => {
  const sparse = [rec({ id: 'x', productionTons: undefined, goodTons: undefined, wasteTons: undefined, workers: undefined })];
  assert.doesNotThrow(() => engine.aggregateByDimension(sparse, 'product', 'ar'));
  assert.doesNotThrow(() => engine.aggregateByDimension(sparse, 'employee', 'ar'));
});

// ---------------------------------------------------------------------------
// I. Refresh / data flow
// ---------------------------------------------------------------------------

test('I1. a refreshed record set is re-aggregated from the new data', () => {
  const before = engine.aggregateByDimension(RECORDS, 'stage', 'ar');
  const after = engine.aggregateByDimension(
    [...RECORDS, rec({ id: 'p3', stageType: 'pressing', date: '2026-03-02', productionTons: 100, goodTons: 100 })],
    'stage', 'ar'
  );
  assert.equal(Number(sumTons(after).toFixed(2)), Number(sumTons(before).toFixed(2)) + 100);
});

test('I2. the fetch is bounded by the filters and re-runs when they change', () => {
  assert.match(viewCode, /fetchUniversalStageRecords\(filters\)/);
  assert.match(viewCode, /\}, \[refreshTrigger, filters\]\);/);
  assert.equal(/fetchUniversalStageRecords\(\s*\)/.test(viewCode), false, 'no zero-argument (unbounded) fetch');
  assert.equal(/from 'firebase\/firestore'/.test(viewSource), false, 'Reports must not build its own Firestore query');
});

// ---------------------------------------------------------------------------

async function main() {
  await loadEngine();
  for (const { name, fn } of registered) {
    try {
      await fn();
      passed++;
      console.log(`  PASS  ${name}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL  ${name}`);
      console.error(err);
    }
  }
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();

/**
 * Custom Dashboard Builder - focused behavioural tests.
 *
 * WHY A LOADER SHIM: dashboardPersistenceService.ts and dashboardRegistry.ts
 * are pure logic, but both transitively reach ../config/firebase, which reads
 * `import.meta.env` at module scope and therefore throws under plain tsx (the
 * same constraint every suite in this directory documents). Rather than
 * settle for string-matching the source - which would prove nothing about
 * save/load correctness - this loads the REAL production modules with only
 * their Firebase-coupled imports replaced by inert stubs, and every relative
 * specifier rewritten to an absolute file URL so the rewritten copy can live
 * outside the repository. The logic under test is the actual shipped code,
 * not a re-implementation.
 *
 * Nothing here touches Firestore: 0 reads, 0 writes, 0 deletes. localStorage
 * is a plain in-memory fake, matching the Builder's real (localStorage-only)
 * persistence model - see dashboardPersistenceService.ts's header.
 *
 * Run: npx tsx scripts/tests/dashboardBuilder.test.ts
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

console.log('dashboardBuilder.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asfour-builder-'));

/** Rewrites relative specifiers to absolute file URLs so a copy can be imported from outside the repo. */
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

/** Loads a real production module with the given import lines replaced by stubs. */
async function loadReal(relPath: string, replacements: Array<[string, string]>) {
  const abs = path.join(ROOT, relPath);
  let src = fs.readFileSync(abs, 'utf-8');
  for (const [needle, stub] of replacements) {
    assert.ok(src.includes(needle), `expected to find import "${needle}" in ${relPath} - production imports changed, update this shim`);
    src = src.replace(needle, stub);
  }
  src = absolutise(src, abs);
  const out = path.join(TMP, path.basename(relPath));
  fs.writeFileSync(out, src, 'utf-8');
  return import(pathToFileURL(out).href);
}

/** In-memory localStorage fake - the Builder persists ONLY here, never to Firestore. */
function installFakeLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  return store;
}

let persistence: any;
let registry: any;
let storage: Map<string, string>;

async function bootstrap() {
  storage = installFakeLocalStorage();

  registry = await loadReal('src/services/dashboardRegistry.ts', [
    [
      "import {\n  ReportDimension,\n  AggregatedReportRow,\n  aggregateByDimension,\n  rankRows,\n  RankingMetric,\n  ALL_STAGES,\n  getStageDisplayName,\n} from './reportingEngine';",
      "import {\n  ReportDimension,\n  AggregatedReportRow,\n  aggregateByDimension,\n  rankRows,\n  RankingMetric,\n  ALL_STAGES,\n  getStageDisplayName,\n} from './__reportingEngine_shim.ts';",
    ],
  ]);

  persistence = await loadReal('src/services/dashboardPersistenceService.ts', [
    ["import { logAuditAction } from './auditService';", "const logAuditAction = async () => {};"],
    ["import { auth } from '../config/firebase';", "const auth = { currentUser: { email: 'tester@asfour.local' } };"],
  ]);
}

/** reportingEngine's only Firebase coupling is two constants; stub them and keep the real logic. */
function writeReportingEngineShim() {
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
  fs.writeFileSync(path.join(TMP, '__reportingEngine_shim.ts'), src, 'utf-8');
}

/** Minimal valid widget, built from the registry's own vocabulary rather than invented shapes. */
function makeWidget(id: string, over: Record<string, any> = {}) {
  return {
    widgetId: id,
    title: `widget-${id}`,
    metric: 'productionTons',
    entityType: 'employee',
    chartType: 'BAR',
    timeRangePreset: 'inherit',
    productionStage: 'inherit',
    filters: {},
    ...over,
  };
}

function makeLayout(over: Record<string, any> = {}) {
  return {
    name: 'Test Dashboard',
    ownerName: '',
    sections: [{ sectionId: 's1', title: 'Section One', columns: 2, widgets: [makeWidget('w1')] }],
    defaultFilters: { timeRangePreset: 'LAST_30_DAYS', stageType: 'all' },
    ...over,
  };
}

// ---------------------------------------------------------------------------
// A. Initial / default state
// ---------------------------------------------------------------------------

test('A1. an empty store lists no dashboards and has no default', () => {
  storage.clear();
  assert.deepEqual(persistence.listDashboards(), []);
  assert.equal(persistence.getDefaultDashboardId(), null);
});

test('A2. the registry exposes its own time-range vocabulary with a usable default', () => {
  const r = registry.resolveTimeRangePreset('LAST_30_DAYS');
  assert.ok(r.startDate && r.endDate, 'LAST_30_DAYS must resolve to concrete bounds');
  assert.ok(r.startDate <= r.endDate);
});

// ---------------------------------------------------------------------------
// B/C. Widget configuration, add and remove
// ---------------------------------------------------------------------------

test('B1. a saved dashboard preserves its widget configuration verbatim', () => {
  storage.clear();
  const saved = persistence.saveDashboard(makeLayout());
  const loaded = persistence.getDashboard(saved.dashboardId);
  assert.equal(loaded.sections[0].widgets.length, 1);
  assert.deepEqual(loaded.sections[0].widgets[0], makeWidget('w1'));
});

test('C1. adding a widget is persisted; removing it is persisted', () => {
  storage.clear();
  const saved = persistence.saveDashboard(makeLayout());

  const withTwo = JSON.parse(JSON.stringify(saved));
  withTwo.sections[0].widgets.push(makeWidget('w2', { metric: 'wasteTons' }));
  persistence.saveDashboard(withTwo);
  assert.equal(persistence.getDashboard(saved.dashboardId).sections[0].widgets.length, 2);

  const withOne = JSON.parse(JSON.stringify(persistence.getDashboard(saved.dashboardId)));
  withOne.sections[0].widgets = withOne.sections[0].widgets.filter((w: any) => w.widgetId !== 'w2');
  persistence.saveDashboard(withOne);
  const after = persistence.getDashboard(saved.dashboardId);
  assert.equal(after.sections[0].widgets.length, 1);
  assert.equal(after.sections[0].widgets[0].widgetId, 'w1');
});

// ---------------------------------------------------------------------------
// D. Layout / reorder - the ACTUAL mechanism (explicit controls, not drag-drop)
// ---------------------------------------------------------------------------

test('D1. computeGridMoveTarget reorders within the grid and returns null at the edges', () => {
  // Real signature: (index, totalCount, columns, direction); an illegal move
  // yields null rather than a clamped index, so the caller can ignore it.
  const total = 4, cols = 2; // grid: [0 1] / [2 3]
  const move = (i: number, d: string) => registry.computeGridMoveTarget(i, total, cols, d);

  assert.equal(move(0, 'right'), 1, 'right from col 0 moves one slot along the row');
  assert.equal(move(0, 'down'), 2, 'down moves by one full row');
  assert.equal(move(3, 'up'), 1, 'up moves back by one full row');
  assert.equal(move(1, 'left'), 0, 'left from col 1 moves back along the row');

  assert.equal(move(0, 'left'), null, 'left from the first column must not wrap to the previous row');
  assert.equal(move(1, 'right'), null, 'right from the last column must not wrap to the next row');
  assert.equal(move(0, 'up'), null, 'up from the first row is out of bounds');
  assert.equal(move(3, 'down'), null, 'down from the last row is out of bounds');

  for (const d of ['up', 'down', 'left', 'right']) {
    for (let i = 0; i < total; i++) {
      const t = move(i, d);
      assert.ok(t === null || (t >= 0 && t < total), `move(${i},${d}) must be null or in range, got ${t}`);
    }
  }
});

test('D2. widgetSpanForSize maps every size to a positive column span', () => {
  for (const size of ['SMALL', 'MEDIUM', 'LARGE']) {
    const span = registry.widgetSpanForSize(size, 2);
    assert.ok(Number.isFinite(span) && span >= 1, `${size} must yield a span >= 1, got ${span}`);
  }
});

// ---------------------------------------------------------------------------
// E. Sections
// ---------------------------------------------------------------------------

test('E1. multiple sections and their widgets survive a save/load round-trip', () => {
  storage.clear();
  const layout = makeLayout({
    sections: [
      { sectionId: 's1', title: 'One', columns: 2, widgets: [makeWidget('a')] },
      { sectionId: 's2', title: 'Two', columns: 3, widgets: [makeWidget('b'), makeWidget('c')] },
    ],
  });
  const saved = persistence.saveDashboard(layout);
  const loaded = persistence.getDashboard(saved.dashboardId);
  assert.equal(loaded.sections.length, 2);
  assert.equal(loaded.sections[1].title, 'Two');
  assert.equal(loaded.sections[1].columns, 3);
  assert.deepEqual(loaded.sections[1].widgets.map((w: any) => w.widgetId), ['b', 'c']);
});

// ---------------------------------------------------------------------------
// F. Save / load persistence (REQUIRED)
// ---------------------------------------------------------------------------

test('F1. a saved dashboard loads back equivalent to what was saved', () => {
  storage.clear();
  const saved = persistence.saveDashboard(makeLayout({ name: 'Round Trip' }));
  const loaded = persistence.getDashboard(saved.dashboardId);
  assert.deepEqual(loaded, saved, 'the loaded dashboard must equal the saved one');
  assert.equal(loaded.name, 'Round Trip');
  assert.ok(loaded.dashboardId && loaded.createdAt && loaded.updatedAt);
});

test('F2. saving assigns a stable id and a unique dashboardNumber', () => {
  storage.clear();
  const a = persistence.saveDashboard(makeLayout({ name: 'A' }));
  const b = persistence.saveDashboard(makeLayout({ name: 'B' }));
  assert.notEqual(a.dashboardId, b.dashboardId);
  assert.notEqual(a.dashboardNumber, b.dashboardNumber);
  assert.equal(persistence.listDashboards().length, 2);
});

test('F3. re-saving an existing dashboard updates in place rather than duplicating', () => {
  storage.clear();
  const a = persistence.saveDashboard(makeLayout({ name: 'Original' }));
  persistence.saveDashboard({ ...a, name: 'Edited' });
  assert.equal(persistence.listDashboards().length, 1);
  assert.equal(persistence.getDashboard(a.dashboardId).name, 'Edited');
});

// ---------------------------------------------------------------------------
// G/H/I/J. Rename, duplicate, delete, default/favourite
// ---------------------------------------------------------------------------

test('G1. rename changes only the name', () => {
  storage.clear();
  const a = persistence.saveDashboard(makeLayout({ name: 'Before' }));
  persistence.renameDashboard(a.dashboardId, 'After');
  const loaded = persistence.getDashboard(a.dashboardId);
  assert.equal(loaded.name, 'After');
  assert.deepEqual(loaded.sections, a.sections, 'rename must not disturb the layout');
});

test('H1. duplicate creates an INDEPENDENT copy - editing one never affects the other', () => {
  storage.clear();
  const a = persistence.saveDashboard(makeLayout({ name: 'Source' }));
  const copy = persistence.duplicateDashboard(a.dashboardId, 'Copy');
  assert.ok(copy, 'duplicate must return the new dashboard');
  assert.notEqual(copy.dashboardId, a.dashboardId);
  assert.equal(copy.name, 'Copy');
  assert.equal(persistence.listDashboards().length, 2);

  const edited = JSON.parse(JSON.stringify(copy));
  edited.sections[0].widgets.push(makeWidget('extra'));
  persistence.saveDashboard(edited);

  assert.equal(persistence.getDashboard(a.dashboardId).sections[0].widgets.length, 1,
    'editing the duplicate must not mutate the source dashboard');
  assert.equal(persistence.getDashboard(copy.dashboardId).sections[0].widgets.length, 2);
});

test('I1. delete removes only the targeted dashboard', () => {
  storage.clear();
  const a = persistence.saveDashboard(makeLayout({ name: 'Keep' }));
  const b = persistence.saveDashboard(makeLayout({ name: 'Drop' }));
  persistence.deleteDashboard(b.dashboardId);
  const remaining = persistence.listDashboards();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].dashboardId, a.dashboardId);
  assert.equal(persistence.getDashboard(b.dashboardId), undefined);
});

test('J1. default dashboard can be set and cleared', () => {
  storage.clear();
  const a = persistence.saveDashboard(makeLayout());
  persistence.setDefaultDashboard(a.dashboardId);
  assert.equal(persistence.getDefaultDashboardId(), a.dashboardId);
  persistence.setDefaultDashboard(null);
  assert.equal(persistence.getDefaultDashboardId(), null);
});

test('J2. favourite is a persisted per-dashboard flag', () => {
  storage.clear();
  const a = persistence.saveDashboard(makeLayout());
  persistence.setFavoriteDashboard(a.dashboardId, true);
  assert.equal(persistence.getDashboard(a.dashboardId).isFavorite, true);
  persistence.setFavoriteDashboard(a.dashboardId, false);
  assert.equal(persistence.getDashboard(a.dashboardId).isFavorite, false);
});

// ---------------------------------------------------------------------------
// K. localStorage isolation - the documented persistence model
// ---------------------------------------------------------------------------

test('K1. persistence writes ONLY to localStorage, under one namespaced key', () => {
  storage.clear();
  persistence.saveDashboard(makeLayout());
  const keys = Array.from(storage.keys());
  assert.equal(keys.length, 1, `expected exactly one storage key, got ${keys.join(', ')}`);
  assert.match(keys[0], /^asfour_erp_dashboards$/);
  const parsed = JSON.parse(storage.get(keys[0])!);
  assert.ok(Array.isArray(parsed.dashboards));
  assert.ok('defaultDashboardId' in parsed);
});

test('K2. the persistence module contains no Firestore write path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/services/dashboardPersistenceService.ts'), 'utf-8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.equal(/from 'firebase\/firestore'/.test(code), false);
  assert.equal(/setDoc\(|addDoc\(|updateDoc\(|deleteDoc\(|writeBatch\(|collection\(/.test(code), false);
});

test('K3. wiping storage loses saved dashboards - the documented device-local limitation', () => {
  storage.clear();
  persistence.saveDashboard(makeLayout());
  assert.equal(persistence.listDashboards().length, 1);
  storage.clear(); // simulates the user clearing site data / switching device
  assert.deepEqual(persistence.listDashboards(), [], 'dashboards are device-local by design');
});

// ---------------------------------------------------------------------------
// L. Invalid / missing configuration must not crash
// ---------------------------------------------------------------------------

test('L1. corrupt stored JSON degrades to an empty list instead of throwing', () => {
  storage.clear();
  storage.set('asfour_erp_dashboards', '{ this is not json');
  assert.doesNotThrow(() => persistence.listDashboards());
  assert.deepEqual(persistence.listDashboards(), []);
});

test('L2. unknown ids return undefined and deleting them is a no-op', () => {
  storage.clear();
  const a = persistence.saveDashboard(makeLayout());
  assert.equal(persistence.getDashboard('does-not-exist'), undefined);
  assert.doesNotThrow(() => persistence.deleteDashboard('does-not-exist'));
  assert.doesNotThrow(() => persistence.renameDashboard('does-not-exist', 'x'));
  assert.equal(persistence.duplicateDashboard('does-not-exist', 'x'), undefined);
  assert.equal(persistence.listDashboards().length, 1, 'the real dashboard must survive');
  assert.equal(a.name, 'Test Dashboard');
});

test('L3. a widget inheriting everything resolves against the dashboard globals', () => {
  const resolved = registry.resolveWidgetFilters(
    makeWidget('inh'),
    { timeRangePreset: 'LAST_30_DAYS', stageType: 'all' }
  );
  assert.ok(resolved.startDate && resolved.endDate, 'inherited range must resolve to concrete bounds');
  assert.equal(resolved.stageType, 'all');
  assert.equal(resolved.isOverridden, false, 'a fully-inheriting widget is not an override');
});

test('L4. a widget overriding the range is flagged and uses its own bounds', () => {
  const resolved = registry.resolveWidgetFilters(
    makeWidget('ovr', { timeRangePreset: 'TODAY' }),
    { timeRangePreset: 'LAST_30_DAYS', stageType: 'all' }
  );
  assert.equal(resolved.isOverridden, true);
  assert.equal(resolved.startDate, resolved.endDate, 'TODAY is a single day');
});

// ---------------------------------------------------------------------------

async function main() {
  writeReportingEngineShim();
  await bootstrap();
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

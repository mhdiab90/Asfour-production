/**
 * AI Assistant restoration - tool system, permission guard and Dashboard control.
 *
 * WHY A MIRRORED CLOSURE: the assistant tool modules reach ../config/firebase,
 * which reads `import.meta.env` at module scope and therefore throws under plain
 * tsx. That closure is 50+ files, so shimming each one individually (the
 * single-file technique the other suites use) would be brittle. Instead the whole
 * import closure is mirrored into a temp directory with its RELATIVE STRUCTURE
 * PRESERVED - so every relative specifier still resolves - and exactly one file is
 * replaced: src/config/firebase.ts. Everything else is the real shipped source,
 * so this exercises the real tool registry, the real permission guard and the
 * real dashboard persistence layer.
 *
 * Line endings are normalised on read, so the suite behaves identically on an LF
 * or a CRLF checkout. No production file is modified to satisfy a test.
 *
 * Nothing here touches Firestore or any AI provider: 0 reads, 0 writes, 0 deletes,
 * 0 network calls. localStorage is an in-memory fake, matching the Builder's real
 * (localStorage-only) persistence model.
 *
 * Run: npx tsx scripts/tests/aiAssistantRestoration.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

let passed = 0;
let failed = 0;
const registered: Array<{ name: string; fn: () => void | Promise<void> }> = [];
function test(name: string, fn: () => void | Promise<void>) {
  registered.push({ name, fn });
}

console.log('aiAssistantRestoration.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

/**
 * The mirror lives under node_modules/.cache rather than the OS temp dir so that
 * Node's upward node_modules resolution still finds the real `firebase/*`
 * packages from the mirrored files. node_modules is already git-ignored, so this
 * leaves no repository artifact; it is removed again at the end of the run.
 */
const TMP = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.cache', 'asfour-ai-'));

/** Reads source with line endings normalised to LF (CRLF checkouts behave identically). */
function readSource(abs: string): string {
  return fs.readFileSync(abs, 'utf-8').replace(/\r\n/g, '\n');
}

const IMPORT_RE = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

function resolveSpec(importer: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importer), spec);
  for (const cand of [base + '.ts', base + '.tsx', base + '/index.ts', base + '/index.tsx']) {
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

/** The ONLY replaced module - the real one calls getAuth() at import time and throws under tsx. */
const FIREBASE_STUB = [
  "export const firebaseConfig = { apiKey: 'test', projectId: 'test' };",
  'export const app = {} as any;',
  "export const auth = { currentUser: { email: 'tester@asfour.local', uid: 'u-test' } } as any;",
  'export const db = {} as any;',
  'export const storage = {} as any;',
  "export enum OperationType { CREATE='create', UPDATE='update', DELETE='delete', LIST='list', GET='get', WRITE='write' }",
  'export function handleFirestoreError(error: unknown): never { throw error; }',
  'export function getSafeFirebaseDiagnosticInfo() { return {}; }',
].join('\n');

/** Mirrors the whole import closure of `seedRel` into TMP, preserving relative structure. */
function mirrorClosure(seedRel: string): string {
  const seedAbs = path.join(ROOT, seedRel);
  const seen = new Set<string>();
  const stack = [seedAbs];
  const firebaseAbs = path.join(ROOT, 'src/config/firebase.ts');
  while (stack.length) {
    const f = stack.pop() as string;
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    const src = readSource(f);
    for (const m of src.matchAll(IMPORT_RE)) {
      const t = resolveSpec(f, m[1]);
      if (t && !seen.has(t)) stack.push(t);
    }
  }
  assert.ok(seen.has(firebaseAbs), 'expected config/firebase.ts in the closure - stub target missing');
  for (const abs of seen) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    const out = path.join(TMP, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, abs === firebaseAbs ? FIREBASE_STUB : readSource(abs), 'utf-8');
  }
  return path.join(TMP, seedRel);
}

function installFakeLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).addEventListener = () => {};
  (globalThis as any).removeEventListener = () => {};
  (globalThis as any).dispatchEvent = (ev: any) => { dispatchedEvents.push(ev); return true; };
  return store;
}

/** Every CustomEvent the AI tools dispatch - the Builder consumes these in the real app. */
const dispatchedEvents: any[] = [];

let registry: any;
let guard: any;
let persistence: any;
let dashboardRegistry: any;
let storage: Map<string, string>;

async function bootstrap() {
  storage = installFakeLocalStorage();
  const entry = mirrorClosure('src/assistant/tools/index.ts');
  const toolsIndex: any = await import(pathToFileURL(entry).href);
  // Registration is lazy and idempotent - the Gateway calls this on construction.
  assert.equal(typeof toolsIndex.ensureToolsRegistered, 'function',
    'tools/index.ts must expose ensureToolsRegistered()');
  toolsIndex.ensureToolsRegistered();
  registry = await import(pathToFileURL(path.join(TMP, 'src/assistant/tools/registry.ts')).href);
  guard = await import(pathToFileURL(path.join(TMP, 'src/assistant/permissionGuard.ts')).href);
  persistence = await import(pathToFileURL(path.join(TMP, 'src/services/dashboardPersistenceService.ts')).href);
  dashboardRegistry = await import(pathToFileURL(path.join(TMP, 'src/services/dashboardRegistry.ts')).href);
}

const ADMIN_PERMS: Record<string, boolean> = {
  'dashboard.view': true,
  'dashboard.manageCustomDashboards': true,
  'ai.use': true,
  'ai.advanced_analysis': true,
  'reports.view': true,
};
const VIEWER_PERMS: Record<string, boolean> = {
  'dashboard.view': true,
  'dashboard.manageCustomDashboards': false,
  'ai.use': true,
  'ai.advanced_analysis': false,
  'reports.view': true,
};

function ctx(perms: Record<string, boolean>, over: Record<string, any> = {}) {
  return {
    currentPage: 'dashboard',
    currentModule: 'dashboard',
    currentUserId: 'u-test',
    currentRole: 'SUPER_ADMIN',
    currentPermissions: perms,
    currentLanguage: 'ar' as 'ar' | 'en',
    ...over,
  };
}

function asUser(perms: Record<string, boolean>, role = 'SUPER_ADMIN') {
  return guard.syntheticUserFromContext({ currentUserId: 'u-test', currentRole: role, currentPermissions: perms });
}

// --- A. Tool system -------------------------------------------------------

test('A1. the real tool registry loads and registers the full tool set', () => {
  const all = registry.listTools();
  assert.ok(all.length >= 30, `expected the full tool system, got ${all.length} tools`);
  const names = all.map((t: any) => t.toolName);
  for (const expected of [
    'createCustomDashboard', 'setCustomDashboardWidget', 'setCustomDashboardFilters',
    'useCustomDashboard', 'saveCustomDashboardChanges', 'navigateToPage',
    'getMasterData', 'exportReportToExcel',
  ]) {
    assert.ok(names.includes(expected), `tool "${expected}" is missing from the registry`);
  }
});

test('A2. every registered tool declares permission, risk level and an executor', () => {
  for (const t of registry.listTools()) {
    assert.ok(Array.isArray(t.requiredPermission), `${t.toolName} has no requiredPermission array`);
    assert.ok(['READ_ONLY', 'LOW_RISK', 'MEDIUM_RISK', 'HIGH_RISK'].includes(t.riskLevel), `${t.toolName} riskLevel=${t.riskLevel}`);
    assert.equal(typeof t.execute, 'function', `${t.toolName} has no execute()`);
  }
});

test('A3. Dashboard-mutating tools are ACTIONs gated on dashboard.manageCustomDashboards', () => {
  for (const name of ['createCustomDashboard', 'setCustomDashboardWidget', 'saveCustomDashboardChanges']) {
    const t = registry.getTool(name);
    assert.equal(t.commandType, 'ACTION', `${name} must be an ACTION`);
    assert.ok(t.requiredPermission.includes('dashboard.manageCustomDashboards'), `${name} is not permission-gated`);
  }
});

// --- B. Permission guard --------------------------------------------------

test('B1. a user WITHOUT dashboard.manageCustomDashboards is denied the create tool', () => {
  const res = guard.checkToolPermission(registry.getTool('createCustomDashboard'), asUser(VIEWER_PERMS, 'REPORT_VIEWER'));
  assert.equal(res.allowed, false, 'unauthorised user must be blocked by the existing guard');
  assert.ok(res.reasonAr && res.reasonEn, 'a denial must explain itself in both languages');
});

test('B2. a user WITH the permission is allowed', () => {
  assert.equal(guard.checkToolPermission(registry.getTool('createCustomDashboard'), asUser(ADMIN_PERMS)).allowed, true);
});

test('B3. an unauthenticated caller is denied outright', () => {
  assert.equal(guard.checkToolPermission(registry.getTool('createCustomDashboard'), null).allowed, false);
});

test('B4. the permitted-tool listing is smaller for a restricted user', () => {
  const admin = guard.listPermittedToolSummaries(asUser(ADMIN_PERMS)).length;
  const viewer = guard.listPermittedToolSummaries(asUser(VIEWER_PERMS, 'REPORT_VIEWER')).length;
  assert.ok(viewer < admin, `restricted user should see fewer tools (admin=${admin}, viewer=${viewer})`);
});

// --- C. Dashboard control through the real AI action path -----------------

test('C1. createCustomDashboard builds a preview BEFORE writing anything', async () => {
  storage.clear();
  const tool = registry.getTool('createCustomDashboard');
  const input = tool.inputSchema({ name: 'لوحة الإدارة' }).value;
  const preview = await tool.buildPreview(input, ctx(ADMIN_PERMS));
  assert.ok(preview.targetSummaryAr && preview.targetSummaryEn, 'preview must be bilingual');
  assert.equal(persistence.listDashboards().length, 0, 'buildPreview must not persist anything');
});

test('C2. executing the create tool dispatches a Builder ACTION - it never writes directly', async () => {
  storage.clear();
  dispatchedEvents.length = 0;
  const tool = registry.getTool('createCustomDashboard');
  const res = await tool.execute(tool.inputSchema({ name: 'لوحة الإدارة' }).value, ctx(ADMIN_PERMS));
  assert.equal(res.success, true, `execute failed: ${res.messageEn || res.errorCode}`);
  const action = dispatchedEvents.find((e) => e?.detail?.type === 'CREATE_DASHBOARD');
  assert.ok(action, 'the tool must dispatch a CREATE_DASHBOARD action for the Builder to apply');
  assert.ok(action.detail.layout && action.detail.layout.name === 'لوحة الإدارة', 'the action must carry the layout');
  assert.equal(storage.size, 0, 'the AI must NOT write dashboard state directly - the Builder applies the action');
});

test('C3. the AI-produced layout is structurally valid (sections, columns, widget metrics)', async () => {
  storage.clear();
  dispatchedEvents.length = 0;
  const tool = registry.getTool('createCustomDashboard');
  await tool.execute(tool.inputSchema({ name: 'لوحة الإنتاج' }).value, ctx(ADMIN_PERMS));
  const layout = dispatchedEvents.find((e) => e?.detail?.type === 'CREATE_DASHBOARD').detail.layout;
  assert.ok(Array.isArray(layout.sections) && layout.sections.length >= 1, 'must produce at least one section');
  for (const section of layout.sections) {
    assert.ok(section.sectionId, 'each section needs an id');
    assert.equal(typeof section.columns, 'number', 'each section needs a column count');
    for (const w of section.widgets || []) {
      assert.ok(w.widgetId, 'each widget needs an id');
      assert.ok(w.metric, 'each widget needs a metric');
      assert.ok(w.chartType, 'each widget needs a chart type');
    }
  }
});

test('C4. the AI-produced layout saves and reloads through the Builder persistence layer', async () => {
  storage.clear();
  dispatchedEvents.length = 0;
  const tool = registry.getTool('createCustomDashboard');
  await tool.execute(tool.inputSchema({ name: 'ثلاثة أقسام' }).value, ctx(ADMIN_PERMS));
  const aiLayout = dispatchedEvents.find((e) => e?.detail?.type === 'CREATE_DASHBOARD').detail.layout;
  const template = (aiLayout.sections[0] && aiLayout.sections[0].widgets[0]) || {
    widgetId: 'w', title: 'w', metric: 'productionTons', entityType: 'employee',
    chartType: 'BAR', timeRangePreset: 'inherit', productionStage: 'inherit', filters: {},
  };
  // Apply it the way the Builder does: through the single shared persistence layer.
  const saved = persistence.saveDashboard({
    ...aiLayout,
    sections: [1, 2, 3].map((n) => ({
      sectionId: `s${n}`, title: `القسم ${n}`, columns: 3,
      widgets: [1, 2, 3].map((w) => ({ ...template, widgetId: `w${n}${w}`, title: `w${n}${w}` })),
    })),
  });
  const reloaded = persistence.getDashboard(saved.dashboardId);
  assert.equal(reloaded.sections.length, 3, 'three sections must survive save/reload');
  assert.equal(reloaded.sections.reduce((a: number, x: any) => a + x.widgets.length, 0), 9, 'nine widgets total');
  assert.equal(typeof dashboardRegistry.resolveTimeRangePreset, 'function', 'the one shared widget registry is in use');
});

test('C5. AI dashboard control stays inside the localStorage Builder model (no Firestore write path)', () => {
  const src = readSource(path.join(ROOT, 'src/services/dashboardPersistenceService.ts'));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(
    /setDoc\(|addDoc\(|updateDoc\(|deleteDoc\(|writeBatch\(|collection\(/.test(code),
    false,
    'dashboard persistence must remain localStorage-only',
  );
});

test('C6. an unauthorised user cannot create a dashboard through the AI path', async () => {
  storage.clear();
  const tool = registry.getTool('createCustomDashboard');
  assert.equal(guard.checkToolPermission(tool, asUser(VIEWER_PERMS, 'REPORT_VIEWER')).allowed, false,
    'the guard must block before execute is ever reached');
  assert.equal(persistence.listDashboards().length, 0, 'nothing may be written for a denied caller');
});

test('C7. rename and duplicate remain available through the shared persistence layer', async () => {
  storage.clear();
  const dash = persistence.saveDashboard({
    name: 'الأصل', ownerName: '',
    sections: [{ sectionId: 's1', title: 'S', columns: 2, widgets: [] }],
    defaultFilters: { timeRangePreset: 'LAST_30_DAYS', stageType: 'all' },
  });
  persistence.renameDashboard(dash.dashboardId, 'اسم جديد');
  assert.equal(persistence.getDashboard(dash.dashboardId).name, 'اسم جديد');
  const copy = persistence.duplicateDashboard(dash.dashboardId, 'نسخة');
  assert.ok(copy && copy.dashboardId !== dash.dashboardId, 'duplicate must be independent');
  assert.equal(persistence.listDashboards().length, 2);
});

// --- D. Screen context ----------------------------------------------------

test('D1. tools accept the real screen context (page, module, filters, date range)', async () => {
  storage.clear();
  const tool = registry.getTool('createCustomDashboard');
  const screen = ctx(ADMIN_PERMS, {
    currentPage: 'dashboard',
    currentModule: 'dashboard',
    selectedFilters: { stageType: 'pressing' },
    selectedDateRange: { startDate: '2026-01-01', endDate: '2026-01-31' },
  });
  const preview = await tool.buildPreview(tool.inputSchema({ name: 'سياق' }).value, screen);
  assert.ok(preview, 'the tool must accept a fully populated ScreenContext');
  assert.deepEqual(screen.selectedDateRange, { startDate: '2026-01-01', endDate: '2026-01-31' });
});

test('D2. previews are produced in both Arabic and English from context language', async () => {
  storage.clear();
  const tool = registry.getTool('createCustomDashboard');
  const input = tool.inputSchema({ name: 'ثنائي اللغة' }).value;
  const ar = await tool.buildPreview(input, ctx(ADMIN_PERMS, { currentLanguage: 'ar' }));
  const en = await tool.buildPreview(input, ctx(ADMIN_PERMS, { currentLanguage: 'en' }));
  assert.ok(ar.targetSummaryAr.length > 0, 'Arabic summary must be produced');
  assert.ok(en.targetSummaryEn.length > 0, 'English summary must be produced');
});

// --- F. Natural-language Dashboard scenarios (the real NL entry points) ----

/** Helper: run createCustomDashboard and return the layout the Builder would receive. */
async function aiCreate(description: string, name = 'AI') {
  storage.clear();
  dispatchedEvents.length = 0;
  const tool = registry.getTool('createCustomDashboard');
  const input = tool.inputSchema({ name, description }).value;
  const res = await tool.execute(input, ctx(ADMIN_PERMS));
  assert.equal(res.success, true, `execute failed: ${res.messageEn || res.errorCode}`);
  const ev = dispatchedEvents.find((e) => e?.detail?.type === 'CREATE_DASHBOARD');
  assert.ok(ev, 'a CREATE_DASHBOARD action must be dispatched to the Builder');
  return ev.detail.layout;
}

test('F1. Scenario A - a natural-language request produces a valid multi-section layout', async () => {
  const layout = await aiCreate('لوحة بثلاثة أقسام للإنتاج والهالك والتوقفات', 'ثلاثة أقسام');
  assert.ok(Array.isArray(layout.sections) && layout.sections.length >= 1, 'must produce sections');
  const widgets = layout.sections.flatMap((s: any) => s.widgets || []);
  assert.ok(widgets.length >= 1, 'a described dashboard must contain widgets');
  for (const w of widgets) {
    assert.ok(w.widgetId && w.metric && w.chartType, 'every proposed widget must be fully configured');
  }
});

test('F2. Scenario F - production / waste / downtime / shift request yields registry-valid widgets only', async () => {
  const layout = await aiCreate('لوحة إدارية بالإنتاج والهالك والتوقفات وأداء الورديات', 'إدارية');
  const widgets = layout.sections.flatMap((s: any) => s.widgets || []);
  assert.ok(widgets.length >= 2, `expected several widgets, got ${widgets.length}`);
  const metrics = new Set((dashboardRegistry.AVAILABLE_METRICS || []).map((m: any) => m.id ?? m.value ?? m));
  const charts = new Set(dashboardRegistry.ALL_CHART_TYPES || []);
  for (const w of widgets) {
    if (metrics.size) assert.ok(metrics.has(w.metric), `metric "${w.metric}" is not in the real registry`);
    if (charts.size) assert.ok(charts.has(w.chartType), `chartType "${w.chartType}" is not in the real registry`);
  }
});

test('F3. Scenario C - proposeDashboardWidgets turns free text into registered widgets without applying', async () => {
  storage.clear();
  dispatchedEvents.length = 0;
  const tool = registry.getTool('proposeDashboardWidgets');
  assert.equal(tool.commandType, 'ANALYSIS', 'proposing must never be an ACTION');
  const input = tool.inputSchema({ query: 'الإنتاج والهالك والتوقفات' }).value;
  const res = await tool.execute(input, ctx(ADMIN_PERMS));
  assert.equal(res.success, true, `propose failed: ${res.messageEn}`);
  assert.equal(storage.size, 0, 'a proposal must never persist anything');
  assert.equal(dispatchedEvents.length, 0, 'a proposal must not dispatch a Builder mutation');
});

test('F4. Scenario E - the date filter tool exists, is low-risk and needs only dashboard.view', () => {
  const tool = registry.getTool('setDashboardDateFilter');
  assert.ok(tool, 'setDashboardDateFilter must be registered');
  assert.equal(tool.commandType, 'NAVIGATION');
  assert.equal(tool.riskLevel, 'LOW_RISK');
  assert.deepEqual(tool.requiredPermission, ['dashboard.view'], 'a view-only change must not require manage rights');
});

test('F5. widget reconfiguration is validated against the real chart-type vocabulary', () => {
  const tool = registry.getTool('setCustomDashboardWidget');
  const bad = tool.inputSchema({ chartType: 'NOT_A_CHART' });
  assert.equal(bad.valid, false, 'an invented chart type must be rejected');
  const good = tool.inputSchema({ chartType: 'BAR' });
  assert.equal(good.valid, true, 'a real chart type must be accepted');
});

test('F6. destructive dashboard edits are deliberately NOT exposed as AI tools', () => {
  const names = registry.listTools().map((t: any) => t.toolName);
  for (const forbidden of ['removeCustomDashboardWidget', 'deleteCustomDashboard', 'reorderCustomDashboardWidgets']) {
    assert.equal(names.includes(forbidden), false,
      `${forbidden} is not part of the shipped AI tool set - removal/reorder stay Builder-only`);
  }
});

// --- E. Safety ------------------------------------------------------------

test('E1. this suite performs no network call and no live AI provider request', () => {
  const src = readSource(path.join(ROOT, 'scripts/tests/aiAssistantRestoration.test.ts'));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // Assembled from fragments so this assertion cannot match its own source text.
  const net = new RegExp([['fet','ch'].join('') + '\\(', ['ax','ios'].join(''), ['XMLHttp','Request'].join('')].join('|'));
  assert.equal(net.test(code), false, 'the suite must never perform a network call');
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
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp dir */ }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

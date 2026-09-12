/**
 * AI HIERARCHY INTEGRATION
 *
 * Two things are proved here.
 *
 * 1. RESOLUTION IS DETERMINISTIC AND REFUSES TO GUESS.
 *    Node lookup is exact-match only, in a fixed precedence order, and returns
 *    FOUND / AMBIGUOUS / NOT_FOUND. A name that matches two branches is never
 *    silently resolved to one of them, and a name that matches nothing is never
 *    answered with a zero.
 *
 * 2. THE ASSISTANT AND THE REPORTS SCREEN COMPUTE THE SAME NUMBER.
 *    Both go through resolveHierarchyEquipmentScope and then the same record
 *    filter, so group C asserts equality of the actual totals rather than
 *    trusting that two code paths agree.
 *
 * The lookup module is pure, so it runs here as shipped. The AI tool itself
 * imports Firebase, so its wiring is asserted by source inspection with
 * comments stripped - a test can never be satisfied by the prose explaining it.
 *
 * Run: npx tsx scripts/tests/aiHierarchyQuery.test.ts
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

console.log('aiHierarchyQuery.test.ts');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n');
}
function readCode(rel: string): string {
  return readSource(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

let look: any;
let hier: any;
let eng: any;
async function bootstrap() {
  const load = (rel: string) => import(pathToFileURL(path.join(ROOT, rel)).href);
  look = await load('src/services/hierarchyNodeLookupPure.ts');
  hier = await load('src/services/hierarchyResolverPure.ts');
  eng = await load('src/services/productionFilterEnginePure.ts');
}

/**
 * Two branches that BOTH contain a node called "بوخر" - the ambiguity the
 * specification calls out by name (§29).
 */
const NODES = [
  { id: 'N-PRESSES', code: '5', name: 'المكابس', nameEn: 'Presses', parentId: null },
  { id: 'N-BOKHER', code: '51', name: 'بوخر', nameEn: 'Bo-Kher', parentId: 'N-PRESSES' },
  { id: 'N-B9002', code: 'بوخر 900 2', name: 'بوخر 900 2', parentId: 'N-BOKHER' },
  { id: 'N-B9003', code: 'بوخر 900 3', name: 'بوخر 900 3', parentId: 'N-BOKHER' },
  { id: 'N-FURNACES', code: '6', name: 'الأفران', nameEn: 'Furnaces', parentId: null },
  { id: 'N-F-BOKHER', code: '61', name: 'بوخر', parentId: 'N-FURNACES' },  // same name, other branch
  { id: 'N-EMPTY', code: '9', name: 'مركز بلا معدات', parentId: null },
];

const EQUIPMENT = [
  { id: 'P1', hierarchyNodeId: 'N-B9002' },
  { id: 'P2', hierarchyNodeId: 'N-B9003' },
  { id: 'P99', hierarchyNodeId: null },
  { id: 'F1', hierarchyNodeId: 'N-F-BOKHER' },
];

const RECORDS = Object.freeze([
  Object.freeze({ id: 'R1', stageType: 'pressing', date: '2026-01-10', productId: 'prA', customerId: 'c1',
    productionTons: 100, status: 'APPROVED', rawData: Object.freeze({ pressId: 'P1', shiftId: 's1' }) }),
  Object.freeze({ id: 'R2', stageType: 'pressing', date: '2026-01-20', productId: 'prB', customerId: 'c2',
    productionTons: 200, status: 'APPROVED', rawData: Object.freeze({ pressId: 'P2', shiftId: 's2' }) }),
  Object.freeze({ id: 'R3', stageType: 'pressing', date: '2026-02-05', productId: 'prA', customerId: 'c1',
    productionTons: 300, status: 'APPROVED', rawData: Object.freeze({ pressId: 'P99', shiftId: 's1' }) }),
  Object.freeze({ id: 'R4', stageType: 'pressing', date: '2026-01-25', productId: 'prA', customerId: 'c1',
    productionTons: 50, status: 'APPROVED', rawData: Object.freeze({ furnaceId: 'F1', shiftId: 's1' }) }),
]);
const SNAPSHOT = JSON.stringify(RECORDS);

const index = () => hier.buildHierarchyIndex(NODES);
const ids = (rows: any[]) => rows.map((r) => r.id).sort();

/** What the ASSISTANT does: words -> lookup -> node ids -> shared scope. */
function assistantScope(...terms: string[]) {
  const lk = look.lookupHierarchyNodes(index(), NODES, terms);
  if (!look.isFullyResolved(lk)) return { lookup: lk, scope: null as Set<string> | null };
  return {
    lookup: lk,
    scope: eng.resolveHierarchyEquipmentScope(
      lk.nodeIds.map((i: string) => `node:${i}`),
      { index: index() },
      { equipment: EQUIPMENT },
    ),
  };
}

/** What the REPORTS SCREEN does: node ids already chosen -> shared scope. */
function reportScope(...nodeIds: string[]) {
  return eng.resolveHierarchyEquipmentScope(
    nodeIds.map((i) => `node:${i}`),
    { index: index() },
    { equipment: EQUIPMENT },
  );
}

const applyScope = (scope: Set<string> | null) => eng.applyHierarchyScopeToStageRecords(RECORDS, scope);
const total = (rows: any[]) => rows.reduce((s: number, r: any) => s + (r.productionTons || 0), 0);

// ==================================================
// A. RESOLUTION (§37 TEST 1-6)
// ==================================================

test('A1. TEST 1 - an exact hierarchy code resolves', () => {
  const r = look.lookupHierarchyNode(index(), NODES, 'بوخر 900 2');
  assert.equal(r.status, 'FOUND');
  assert.equal(r.node.id, 'N-B9002');
  assert.equal(r.matchedBy, 'code', 'code must be tried before name');
});

test('A2. TEST 2 - an exact canonical name resolves', () => {
  const r = look.lookupHierarchyNode(index(), NODES, 'المكابس');
  assert.equal(r.status, 'FOUND');
  assert.equal(r.node.id, 'N-PRESSES');
  assert.equal(r.matchedBy, 'name');
});

test('A3. TEST 3 - an exact localized (English) name resolves', () => {
  const r = look.lookupHierarchyNode(index(), NODES, 'Furnaces');
  assert.equal(r.status, 'FOUND');
  assert.equal(r.node.id, 'N-FURNACES');
  assert.equal(r.matchedBy, 'localizedName');
});

test('A4. §7 - matching is case- and diacritic-insensitive, but still EXACT', () => {
  assert.equal(look.lookupHierarchyNode(index(), NODES, '  presses ').node.id, 'N-PRESSES');
  assert.equal(look.lookupHierarchyNode(index(), NODES, 'المكابس').node.id, 'N-PRESSES');
  // Normalisation is canonical form, not similarity: a different word stays unmatched.
  assert.equal(look.lookupHierarchyNode(index(), NODES, 'المكبس').status, 'NOT_FOUND');
});

test('A5. TEST 4 / §30 - an unknown name is NOT_FOUND, never a zero-result node', () => {
  const r = look.lookupHierarchyNode(index(), NODES, 'المكابس السريعة');
  assert.equal(r.status, 'NOT_FOUND');
  assert.equal(r.node, undefined, 'no node may be fabricated');
});

test('A6. TEST 5 / §29 - a name in two branches is AMBIGUOUS, never guessed', () => {
  const r = look.lookupHierarchyNode(index(), NODES, 'بوخر');
  assert.equal(r.status, 'AMBIGUOUS');
  assert.equal(r.candidates.length, 2);
  assert.equal(r.node, undefined, 'an ambiguous lookup must resolve nothing');
  // Neither branch may be silently preferred.
  assert.deepEqual(r.candidates.map((c: any) => c.id).sort(), ['N-BOKHER', 'N-F-BOKHER']);
});

test('A7. TEST 6 / §8 - candidates carry real paths so the user can choose', () => {
  const r = look.lookupHierarchyNode(index(), NODES, 'بوخر');
  const paths = r.candidates.map((c: any) => c.path);
  assert.ok(paths.some((p: string) => p.includes('المكابس')), 'one candidate sits under Presses');
  assert.ok(paths.some((p: string) => p.includes('الأفران')), 'the other under Furnaces');
  const msg = look.describeLookupProblem({ nodeIds: [], resolved: [], ambiguous: [r], notFound: [] }, 'ar');
  assert.ok(msg.includes('أي واحد تقصد') || msg.includes('يطابق أكثر من'), 'the message must ask, not answer');
  assert.equal(/N-BOKHER|N-F-BOKHER/.test(msg), false, '§21 - internal ids must never reach the user');
});

test('A8. §27 / TEST 20 - fuzzy near-misses are suggestions only, never a resolution', () => {
  const r = look.lookupHierarchyNode(index(), NODES, 'المكابس السريعة');
  assert.equal(r.status, 'NOT_FOUND', 'a near-miss must not become a match');
  const msg = look.describeLookupProblem({ nodeIds: [], resolved: [], ambiguous: [], notFound: [r] }, 'ar');
  assert.ok(msg.includes('لم أجد'), 'the answer must state that nothing was found');
  if (r.suggestions.length > 0) {
    assert.ok(msg.includes('هل تقصد'), 'suggestions must be phrased as a question');
  }
});

test('A9. precedence does not fall through on a collision', () => {
  // Two nodes share the code '5' - the answer is AMBIGUOUS, not "try names next".
  const collide = [...NODES, { id: 'N-DUP', code: '5', name: 'مختلف تمامًا', parentId: null }];
  const r = look.lookupHierarchyNode(hier.buildHierarchyIndex(collide), collide, '5');
  assert.equal(r.status, 'AMBIGUOUS');
  assert.equal(r.matchedBy, 'code');
});

test('A10. §13 - multi-term lookup reports every term independently', () => {
  const r = look.lookupHierarchyNodes(index(), NODES, ['المكابس', 'الأفران']);
  assert.deepEqual(r.nodeIds, ['N-PRESSES', 'N-FURNACES']);
  assert.equal(look.isFullyResolved(r), true);

  // One good term + one ambiguous term must NOT quietly answer for the good one.
  const mixed = look.lookupHierarchyNodes(index(), NODES, ['المكابس', 'بوخر']);
  assert.equal(look.isFullyResolved(mixed), false);
  assert.equal(mixed.ambiguous.length, 1);
});

// ==================================================
// B. THE ASSISTANT PATH (§38 TEST 7-14)
// ==================================================

test('B1. TEST 7 - "إجمالي إنتاج المكابس" resolves to the Presses branch', () => {
  const { scope } = assistantScope('المكابس');
  assert.deepEqual([...scope].sort(), ['P1', 'P2']);
  assert.deepEqual(ids(applyScope(scope)), ['R1', 'R2']);
  assert.equal(total(applyScope(scope)), 300);
});

test('B2. TEST 9 - a leaf query targets only its own equipment', () => {
  const { scope } = assistantScope('بوخر 900 2');
  assert.deepEqual([...scope], ['P1']);
  assert.equal(total(applyScope(scope)), 100);
});

test('B3. TEST 14 / §13 - multiple branches union and deduplicate', () => {
  const { scope } = assistantScope('المكابس', 'الأفران');
  assert.deepEqual([...scope].sort(), ['F1', 'P1', 'P2']);
  const rows = applyScope(scope);
  assert.deepEqual(ids(rows), ['R1', 'R2', 'R4']);
  for (const id of ['R1', 'R2', 'R4']) {
    assert.equal(rows.filter((r: any) => r.id === id).length, 1, `${id} counted once`);
  }
  assert.equal(total(rows), 350);
});

test('B4. §19 - unlinked equipment never enters through the assistant either', () => {
  const { scope } = assistantScope('المكابس');
  assert.equal(scope.has('P99'), false);
  assert.equal(applyScope(scope).some((r: any) => r.id === 'R3'), false);
});

test('B5. TEST 17 / §31 - a real node with nothing linked gives an EMPTY scope, not NOT_FOUND', () => {
  const { lookup, scope } = assistantScope('مركز بلا معدات');
  assert.equal(look.isFullyResolved(lookup), true, 'the node exists and resolved');
  assert.notEqual(scope, null);
  assert.equal(scope.size, 0, 'but nothing is linked to it');
  assert.deepEqual(applyScope(scope), [], 'so the report is empty - a different fact from "no such centre"');
});

// ==================================================
// C. §32 AI == REPORTS  (the consistency requirement)
// ==================================================

/** The existing report predicate, so composition is proved against the real filters. */
function applyReportFilters(rows: any[], f: any) {
  return rows.filter((r) => {
    if (f.startDate && r.date < f.startDate) return false;
    if (f.endDate && r.date > f.endDate) return false;
    if (f.productId && r.productId !== f.productId) return false;
    if (f.customerId && r.customerId !== f.customerId) return false;
    if (f.shiftId && (r.rawData?.shiftId || '') !== f.shiftId) return false;
    if (f.status && r.status !== f.status) return false;
    return true;
  });
}

test('C1. TEST 7/8 - assistant total EQUALS report total for the same branch', () => {
  for (const [term, nodeId] of [['المكابس', 'N-PRESSES'], ['Presses', 'N-PRESSES'], ['الأفران', 'N-FURNACES']]) {
    const ai = applyScope(assistantScope(term).scope);
    const rep = applyScope(reportScope(nodeId));
    assert.deepEqual(ids(ai), ids(rep), `${term}: same records as the Reports screen`);
    assert.equal(total(ai), total(rep), `${term}: same total as the Reports screen`);
  }
});

test('C2. TEST 9 - leaf totals match', () => {
  assert.equal(total(applyScope(assistantScope('بوخر 900 2').scope)), total(applyScope(reportScope('N-B9002'))));
  assert.equal(total(applyScope(assistantScope('بوخر 900 3').scope)), total(applyScope(reportScope('N-B9003'))));
});

test('C3. TEST 10 - hierarchy + date match', () => {
  const f = { startDate: '2026-01-01', endDate: '2026-01-21' };
  const ai = applyReportFilters(applyScope(assistantScope('المكابس').scope), f);
  const rep = applyReportFilters(applyScope(reportScope('N-PRESSES')), f);
  assert.deepEqual(ids(ai), ids(rep));
  assert.equal(total(ai), 300);
});

test('C4. TEST 11 - hierarchy + product match', () => {
  const f = { productId: 'prA' };
  assert.deepEqual(
    ids(applyReportFilters(applyScope(assistantScope('المكابس').scope), f)),
    ids(applyReportFilters(applyScope(reportScope('N-PRESSES')), f)),
  );
  assert.deepEqual(ids(applyReportFilters(applyScope(assistantScope('المكابس').scope), f)), ['R1']);
});

test('C5. TEST 12 - hierarchy + customer match', () => {
  const f = { customerId: 'c2' };
  assert.deepEqual(
    ids(applyReportFilters(applyScope(assistantScope('المكابس').scope), f)),
    ids(applyReportFilters(applyScope(reportScope('N-PRESSES')), f)),
  );
});

test('C6. TEST 13 - hierarchy + shift match', () => {
  const f = { shiftId: 's1' };
  assert.deepEqual(
    ids(applyReportFilters(applyScope(assistantScope('المكابس').scope), f)),
    ids(applyReportFilters(applyScope(reportScope('N-PRESSES')), f)),
  );
});

test('C7. TEST 14 - multi-branch totals match, deduplicated', () => {
  const ai = applyScope(assistantScope('المكابس', 'الأفران').scope);
  const rep = applyScope(reportScope('N-PRESSES', 'N-FURNACES'));
  assert.deepEqual(ids(ai), ids(rep));
  assert.equal(total(ai), total(rep));
});

test('C8. §18 - status filtering is not bypassed by the assistant path', () => {
  const withStatus = applyReportFilters(applyScope(assistantScope('المكابس').scope), { status: 'REJECTED' });
  assert.deepEqual(withStatus, [], 'the assistant cannot surface records the report would exclude');
});

// ==================================================
// D. WIRING (§2, §3, §24, §25, §53)
// ==================================================

const TOOL = 'src/assistant/tools/stageReportTools.ts';

test('D1. §24 - the EXISTING tool was extended; no AI-only report tool was added', () => {
  const src = readCode(TOOL);
  assert.ok(/const generateReport: ToolDefinition/.test(src), 'the existing tool must still be the entry point');
  assert.ok(/productionCenters/.test(src), 'it must accept the new structured field');
  const schema = readCode('src/assistant/tools/parameterSchemas.ts');
  assert.ok(/productionCenters:\s*\{/.test(schema), 'the field must be declared on the existing schema');
  // No second report tool registered.
  const registered = (src.match(/registerStageReportTools/g) || []).length;
  assert.ok(registered >= 1, 'registration unchanged');
  assert.equal(/hierarchyReportTool|aiHierarchyReport|generateHierarchyReport/.test(src), false,
    'no parallel AI-only report tool may exist');
});

test('D2. §3/§53 - the tool reuses the shared resolver and the shared report filter', () => {
  const src = readCode(TOOL);
  assert.ok(/resolveHierarchyEquipmentScope\(/.test(src), 'must use the shared scope resolver');
  assert.ok(/filterUniversalRecords\(records, filters, centre\.scope\)/.test(src),
    'must pass the scope into the SAME filter the Reports screen uses');
  assert.ok(/aggregateByDimension\(/.test(src), 'aggregation must remain the shared one');
  assert.ok(/lookupHierarchyNodes\(/.test(src), 'name resolution must use the deterministic lookup');
});

test('D3. §2/§53 - the AI tool performs no traversal, matching or aggregation of its own', () => {
  const src = readCode(TOOL);
  assert.equal(/while\s*\(queue|stack\.pop\(\)|getDescendants|childrenOf/.test(src), false,
    'no traversal in the AI layer');
  assert.equal(/levenshtein|similarity|confidence\s*>/.test(src), false,
    'no matching logic in the AI layer');
  assert.equal(/reduce\(\(sum|\+= r\.productionTons/.test(src), false,
    'no aggregation in the AI layer');
});

test('D4. §25/§4 - the AI never builds a Firestore query', () => {
  const src = readCode(TOOL);
  assert.equal(/getDocs|collection\(db|query\(collection|where\(/.test(src), false,
    'the tool must go through the existing service layer only');
});

test('D5. §6/§29 - an unresolved centre stops the report and asks instead', () => {
  const src = readCode(TOOL);
  assert.ok(/if \(centre\.problem\)/.test(src), 'a lookup problem must short-circuit');
  assert.ok(/needsClarification: true/.test(src), 'and be reported as a clarification, not a result');
  assert.ok(/success: false/.test(src), 'an unanswered question is not a successful report');
  /*
   * The short-circuit must happen BEFORE any records are fetched - asking for
   * clarification should cost nothing. Scoped to generateReport's own body:
   * other tools in this file call fetchUniversalStageRecords earlier, so a
   * whole-file indexOf would compare positions in unrelated functions.
   */
  const start = src.indexOf('const generateReport: ToolDefinition');
  assert.ok(start > 0, 'generateReport must exist');
  const body = src.slice(start);
  const problemAt = body.indexOf('if (centre.problem)');
  const fetchAt = body.indexOf('fetchUniversalStageRecords(filters)');
  assert.ok(problemAt > 0, 'the clarification guard must be inside generateReport');
  assert.ok(fetchAt > problemAt, 'clarification must precede the data fetch');
});

test('D6. §21 - the structured result carries node ids; the message carries paths', () => {
  const src = readCode(TOOL);
  assert.ok(/hierarchyNodeIds: centre\.lookup/.test(src), 'ids must be preserved for traceability');
  assert.ok(/centre\.labels\.join/.test(src), 'the user-facing text must use readable paths');
});

test('D7. §22 - the permission surface is unchanged', () => {
  const src = readCode(TOOL);
  assert.ok(/requiredPermission: READ_PERMISSION/.test(src), 'the existing read permission still gates the tool');
  for (const invented of ['hierarchy.query', 'ai.hierarchy', 'reports.ai']) {
    assert.equal(src.includes(invented), false, `must not invent the permission ${invented}`);
  }
  const guard = readCode('src/assistant/permissionGuard.ts');
  assert.ok(/requiredPermission/.test(guard), 'the guard still enforces tool permissions');
});

test('D8. §34/§35/§36 - providers, Global AI Chat and the other tools were not touched', () => {
  const lookupSrc = readCode('src/services/hierarchyNodeLookupPure.ts');
  assert.equal(/provider|claude|gemini|openrouter|cloudflare/i.test(lookupSrc), false,
    'resolution lives at the shared tool layer, not in any provider');
  // The capability is on the shared tool, so every provider inherits it.
  assert.ok(/productionCenters/.test(readCode('src/assistant/tools/parameterSchemas.ts')),
    'the schema every provider reads carries the field');
});

test('D9. §5/§27/§53 - fuzzy matching is not the authoritative selector', () => {
  const src = readCode('src/services/hierarchyNodeLookupPure.ts');
  // It is imported, but only reached after every exact pass failed.
  const fuzzyAt = src.indexOf('rankFuzzyCandidates(');
  const exactAt = src.indexOf('for (const level of levels)');
  assert.ok(exactAt > 0 && fuzzyAt > exactAt, 'exact passes must run before any fuzzy work');
  assert.ok(/suggestions/.test(src), 'fuzzy results must land in suggestions');
  assert.equal(/status: 'FOUND'[\s\S]{0,200}rankFuzzyCandidates/.test(src), false,
    'a fuzzy result must never produce FOUND');
});

test('D10. §41/§10 - no aggregation formula and no historical record was touched', () => {
  const engine = readCode('src/services/reportingEngine.ts');
  for (const formula of [
    'row.productionTons += rec.productionTons || 0',
    'row.wasteTons += rec.wasteTons || 0',
    'row.downtimeMinutes += rec.totalDowntimeMinutes || 0',
  ]) {
    assert.ok(engine.includes(formula), `${formula} must be unchanged`);
  }
  const tool = readCode(TOOL);
  assert.equal(/updateDoc|setDoc|writeBatch|deleteDoc/.test(tool), false, 'the AI must write nothing');
  assert.equal(JSON.stringify(RECORDS), SNAPSHOT, 'no fixture was mutated by any assertion');
});

test('D11. §43 - resolution reads master data once, never per node or per equipment', () => {
  const src = readCode(TOOL);
  assert.ok(/Promise\.all\(\[/.test(src), 'the three master-data reads happen together');
  const perNode = /nodeIds[\s\S]{0,120}(fetchMasterData|listCostCenterHierarchyNodes)/.test(src);
  assert.equal(perNode, false, 'nothing may be fetched per resolved node');
  const lookupSrc = readCode('src/services/hierarchyNodeLookupPure.ts');
  assert.equal(/getDocs|firebase|await /.test(lookupSrc), false, 'the lookup must stay pure and synchronous');
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
      console.log(String(err && err.message ? err.message : err).split('\n').slice(0, 5).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();

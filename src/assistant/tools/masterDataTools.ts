/**
 * Master Data tools - the only way the assistant can read or create master
 * data. Every write goes through the EXISTING masterDataService (which
 * itself sanitizes payloads and enforces code-duplicate checks) - the
 * assistant never talks to Firestore directly.
 */
import {
  fetchMasterData,
  checkCodeDuplicate,
  createMasterDataItem,
  MASTER_DATA_COLLECTIONS,
} from '../../services/masterDataService';
import { parseFurnaceCarBrickPairs } from '../../utils/multiCodeParser';
import { rankFuzzyCandidates, FuzzyCandidate } from '../../utils/fuzzyMatching';
import { normalizeCode } from '../../utils/searchUtils';
import { ToolDefinition, ToolExecutionResult, PreviewItem } from '../types';
import { registerTool } from './registry';
import {
  MASTER_DATA_DOMAIN_QUERY_SCHEMA,
  CHECK_DUPLICATE_SCHEMA,
  ADD_MASTER_DATA_SCHEMA,
  ADD_FURNACE_CARS_SCHEMA,
  ADD_PRESSES_SCHEMA,
  ADD_SHIFTS_SCHEMA,
  ADD_NAMED_ENTITY_SCHEMA,
  ADD_PRODUCTS_SCHEMA,
} from './parameterSchemas';

type AddResult = {
  added: Array<{ code: string; id: string }>;
  alreadyExisted: string[];
  failed: Array<{ code: string; error: string }>;
};

async function addMasterDataItems(
  collectionName: string,
  items: Array<{ code: string; extra?: Record<string, any> }>
): Promise<AddResult> {
  const result: AddResult = { added: [], alreadyExisted: [], failed: [] };
  const seen = new Set<string>();

  for (const item of items) {
    const code = item.code.trim();
    if (!code) continue;
    const normKey = code.toLowerCase();
    if (seen.has(normKey)) continue; // don't create the same value twice within one call
    seen.add(normKey);

    try {
      const exists = await checkCodeDuplicate(collectionName, code);
      if (exists) {
        result.alreadyExisted.push(code);
        continue;
      }
      const id = await createMasterDataItem(collectionName, {
        code,
        active: true,
        ...item.extra,
      });
      if (id) {
        result.added.push({ code, id });
      } else {
        result.failed.push({ code, error: 'CREATE_RETURNED_NO_ID' });
      }
    } catch (err: any) {
      result.failed.push({ code, error: err?.message || 'UNKNOWN_ERROR' });
    }
  }

  return result;
}

/**
 * §1-§8 - every requested item gets its OWN independent status/message, never
 * collapsed into one generic "some exist, some are new" sentence. Detects a
 * value repeated within the SAME request (addMasterDataItems already silently
 * dedupes this at execute() time - here it is surfaced to the user instead of
 * silently dropped).
 */
function markRequestDuplicates(rawValues: string[]): Set<number> {
  const seen = new Set<string>();
  const dupIndexes = new Set<number>();
  rawValues.forEach((v, idx) => {
    const key = v.trim().toLowerCase();
    if (!key) return;
    if (seen.has(key)) dupIndexes.add(idx);
    else seen.add(key);
  });
  return dupIndexes;
}

/** Read-only dry-check used to build a per-item confirmation preview before execute() runs - for CODE-identified entities (no fuzzy name matching at execute() time). */
async function previewCodeItems(
  collectionName: string,
  domainLabelAr: string,
  domainLabelEn: string,
  codes: string[]
): Promise<PreviewItem[]> {
  const dupIndexes = markRequestDuplicates(codes);
  const items: PreviewItem[] = [];
  for (let idx = 0; idx < codes.length; idx++) {
    const code = codes[idx].trim();
    const key = code.toLowerCase();
    if (dupIndexes.has(idx)) {
      items.push({
        key,
        displayValue: code,
        status: 'INVALID',
        messageAr: `${domainLabelAr} ${code}: مكرر داخل نفس الطلب - تم تجاهل التكرار.`,
        messageEn: `${domainLabelEn} ${code}: duplicated within this request - the repeat was ignored.`,
      });
      continue;
    }
    const exists = await checkCodeDuplicate(collectionName, code);
    items.push(exists
      ? {
          key,
          displayValue: code,
          status: 'ALREADY_EXISTS',
          messageAr: `${domainLabelAr} ${code} موجود بالفعل. لن يتم إنشاء نسخة جديدة.`,
          messageEn: `${domainLabelEn} ${code} already exists. No new record will be created.`,
        }
      : {
          key,
          displayValue: code,
          status: 'NEW',
          messageAr: `${domainLabelAr} ${code} غير موجود ويمكن إضافته.`,
          messageEn: `${domainLabelEn} ${code} does not exist yet and can be added.`,
        });
  }
  return items;
}

/** Same as previewCodeItems, but for NAME-identified entities that also run the fuzzy near-duplicate check at execute() time (customers/employees/presses) - mirrors checkFuzzyDuplicate exactly so the preview never disagrees with what execute() actually does. */
async function previewNamedItems(
  collectionName: string,
  domainLabelAr: string,
  domainLabelEn: string,
  entries: Array<{ code: string; name: string }>
): Promise<PreviewItem[]> {
  const dupIndexes = markRequestDuplicates(entries.map((e) => e.name));
  const items: PreviewItem[] = [];
  for (let idx = 0; idx < entries.length; idx++) {
    const { code, name } = entries[idx];
    const key = name.trim().toLowerCase();
    if (dupIndexes.has(idx)) {
      items.push({
        key,
        displayValue: name,
        status: 'INVALID',
        messageAr: `"${name}": مكرر داخل نفس الطلب - تم تجاهل التكرار.`,
        messageEn: `"${name}": duplicated within this request - the repeat was ignored.`,
      });
      continue;
    }

    const check = await checkFuzzyDuplicate(collectionName, domainLabelAr, domainLabelEn, name);
    if (check.status === 'LIKELY_DUPLICATE') {
      const top = check.candidates[0];
      items.push({
        key,
        displayValue: name,
        status: 'LIKELY_DUPLICATE',
        messageAr: `"${name}" يشبه عنصراً موجوداً بالفعل: "${top.name}" (${top.code}). لن يتم إنشاء نسخة جديدة.`,
        messageEn: `"${name}" closely matches an existing record: "${top.name}" (${top.code}). No new record will be created.`,
      });
      continue;
    }
    if (check.status === 'AMBIGUOUS') {
      const listAr = check.candidates.map(candidateLine).join(' / ');
      const listEn = check.candidates.map(candidateLine).join(' / ');
      items.push({
        key,
        displayValue: name,
        status: 'AMBIGUOUS',
        messageAr: `"${name}" غير مؤكد - يشبه أكثر من عنصر موجود: ${listAr}. لن تتم إضافته حتى يتم توضيح المقصود.`,
        messageEn: `"${name}" is ambiguous - it resembles more than one existing record: ${listEn}. It will not be added until clarified.`,
        candidates: check.candidates.map((c) => ({ name: c.name, code: c.code, confidence: c.confidence })),
      });
      continue;
    }

    // No near-duplicate by name - still mirror addMasterDataItems' own exact
    // CODE check, in case a different-looking name was given the same code.
    const codeExists = await checkCodeDuplicate(collectionName, code);
    items.push(codeExists
      ? {
          key,
          displayValue: name,
          status: 'ALREADY_EXISTS',
          messageAr: `"${name}": الكود "${code}" موجود بالفعل. لن يتم إنشاء نسخة جديدة.`,
          messageEn: `"${name}": code "${code}" already exists. No new record will be created.`,
        }
      : {
          key,
          displayValue: name,
          status: 'NEW',
          messageAr: `"${name}" غير موجود ويمكن إضافته.`,
          messageEn: `"${name}" does not exist yet and can be added.`,
        });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Furnace Car duplicate detection - Furnace Car identity is the car NUMBER,
// NOT the generic `code` field. Traced root cause (search finds 209, create
// preview didn't): the real furnace-car creation path
// (InlineMasterDataAddModal.tsx, "HISTORICAL_IMPORT_INLINE_ADD" source) sets
// code = typed-code || `CAR-${carNumber}` whenever the operator only typed
// the car number and left "code" blank - furnaceCar is the one Master Data
// domain where a separate `code` is NOT required. So a real record for car
// "209" commonly has carNumber="209" but code="CAR-209" - the generic
// checkCodeDuplicate() (code-field-only, exact string match) never finds it,
// misclassifying an EXISTING car as NEW. This is now the ONE authoritative
// furnace-car existence check, reused by preview, create, and the pre-write
// recheck - it uses normalizeCode() (utils/searchUtils.ts), the SAME
// normalization the rest of the app already uses to compute
// carNumberNormalized, so "209" / " 209 " / "٢٠٩" all resolve consistently
// without ever stripping a meaningful leading zero (normalizeCode never
// parses the value as a number - it only converts digits/case/whitespace).
// ---------------------------------------------------------------------------

async function findExistingFurnaceCarByNumber(carNumber: string): Promise<{ id: string; code?: string; carNumber?: string; name?: string } | null> {
  const target = normalizeCode(carNumber);
  if (!target) return null;
  const all = await fetchMasterData<any>('furnaceCars');
  return all.find((item) => normalizeCode(item.carNumber ?? '') === target) || null;
}

/** Mirrors previewCodeItems, but keyed off the authoritative carNumber check above instead of the generic `code` field. */
async function previewFurnaceCarItems(carNumbers: string[]): Promise<PreviewItem[]> {
  const dupIndexes = markRequestDuplicates(carNumbers);
  const items: PreviewItem[] = [];
  for (let idx = 0; idx < carNumbers.length; idx++) {
    const carNumber = carNumbers[idx].trim();
    const key = carNumber.toLowerCase();
    if (dupIndexes.has(idx)) {
      items.push({
        key,
        displayValue: carNumber,
        status: 'INVALID',
        messageAr: `العربة ${carNumber}: مكرر داخل نفس الطلب - تم تجاهل التكرار.`,
        messageEn: `Furnace Car ${carNumber}: duplicated within this request - the repeat was ignored.`,
      });
      continue;
    }
    const existing = await findExistingFurnaceCarByNumber(carNumber);
    items.push(existing
      ? {
          key,
          displayValue: carNumber,
          status: 'ALREADY_EXISTS',
          messageAr: `العربة ${carNumber} موجودة بالفعل. لن يتم إنشاء نسخة جديدة.`,
          messageEn: `Furnace Car ${carNumber} already exists. No new record will be created.`,
        }
      : {
          key,
          displayValue: carNumber,
          status: 'NEW',
          messageAr: `العربة ${carNumber} غير موجودة ويمكن إضافتها.`,
          messageEn: `Furnace Car ${carNumber} does not exist yet and can be added.`,
        });
  }
  return items;
}

/**
 * Mirrors addMasterDataItems, but for furnace cars specifically - checks the
 * authoritative carNumber-based existence immediately before EACH write (a
 * fresh Firestore read, not the cached preview value), so a car that was NEW
 * when the preview was built but got created by someone else in the meantime
 * is caught instead of duplicated. This is the same "check immediately
 * before create" pattern addMasterDataItems already uses for every other
 * domain - not a new architecture, just the correct check for this domain.
 */
async function addFurnaceCarItems(items: Array<{ carNumber: string; extra?: Record<string, any> }>): Promise<AddResult> {
  const result: AddResult = { added: [], alreadyExisted: [], failed: [] };
  const seen = new Set<string>();

  for (const item of items) {
    const carNumber = item.carNumber.trim();
    if (!carNumber) continue;
    const normKey = normalizeCode(carNumber);
    if (seen.has(normKey)) continue;
    seen.add(normKey);

    try {
      const existing = await findExistingFurnaceCarByNumber(carNumber);
      if (existing) {
        result.alreadyExisted.push(carNumber);
        continue;
      }
      const id = await createMasterDataItem('furnaceCars', {
        code: carNumber,
        carNumber,
        active: true,
        ...item.extra,
      });
      if (id) {
        result.added.push({ code: carNumber, id });
      } else {
        result.failed.push({ code: carNumber, error: 'CREATE_RETURNED_NO_ID' });
      }
    } catch (err: any) {
      result.failed.push({ code: carNumber, error: err?.message || 'UNKNOWN_ERROR' });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Phase 2 - fuzzy "search before create" for NAME-driven entities (customers,
// employees, presses). Reuses the EXACT SAME fuzzy engine Historical Import
// already uses (src/utils/fuzzyMatching.ts) - no second matching
// implementation. checkCodeDuplicate() (used inside addMasterDataItems)
// already catches EXACT code/name collisions; this adds the NEAR-duplicate
// layer that plain equality can't ("شركة النور" vs "شركة النور للتوريدات",
// Hamza/space variants, etc.) - never silently picks a match, only ever
// classifies NEW / LIKELY_DUPLICATE (skip, near-certain) / AMBIGUOUS (skip,
// ask the user to choose).
// ---------------------------------------------------------------------------

type FuzzyDuplicateStatus = 'NEW' | 'LIKELY_DUPLICATE' | 'AMBIGUOUS';

interface FuzzyDuplicateCheck {
  status: FuzzyDuplicateStatus;
  candidates: FuzzyCandidate[];
}

/** Names/codes above this confidence are treated as "this already exists" - never re-created. */
const LIKELY_DUPLICATE_CONFIDENCE = 90;

async function checkFuzzyDuplicate(
  collectionName: string,
  domainLabelAr: string,
  domainLabelEn: string,
  inputName: string
): Promise<FuzzyDuplicateCheck> {
  const existing = await fetchMasterData<any>(collectionName);
  const candidates = rankFuzzyCandidates(inputName, existing, { domainLabelAr, domainLabelEn, minConfidence: 55, maxResults: 5 });
  if (candidates.length === 0) return { status: 'NEW', candidates: [] };
  if (candidates[0].confidence >= LIKELY_DUPLICATE_CONFIDENCE) return { status: 'LIKELY_DUPLICATE', candidates: [candidates[0]] };
  return { status: 'AMBIGUOUS', candidates };
}

function candidateLine(c: { name: string; code: string; confidence: number }): string {
  return `${c.name} (${c.code}) - ${c.confidence}%`;
}

/**
 * §12 - the post-execution result must itemize what happened, not just state
 * a count: Created / Already existed / Failed each get their own labeled
 * line listing the actual codes, plus a one-line total.
 */
function summarizeAddResult(entityLabelAr: string, entityLabelEn: string, r: AddResult): ToolExecutionResult<AddResult> {
  const success = r.failed.length === 0;
  // §8/§67 - a batch that created nothing because every item already existed
  // is a DUPLICATE outcome, not a silent no-op - distinct from a genuine
  // failure (r.failed) or a mixed partial success.
  const errorCode = r.added.length === 0 && r.alreadyExisted.length > 0 && r.failed.length === 0 ? 'DUPLICATE' : undefined;

  const linesAr = [`${entityLabelAr}:`];
  const linesEn = [`${entityLabelEn}:`];
  if (r.added.length) {
    linesAr.push(`تم الإنشاء (${r.added.length}): ${r.added.map((a) => a.code).join('، ')}`);
    linesEn.push(`Created (${r.added.length}): ${r.added.map((a) => a.code).join(', ')}`);
  }
  if (r.alreadyExisted.length) {
    linesAr.push(`موجود بالفعل (${r.alreadyExisted.length}): ${r.alreadyExisted.join('، ')}`);
    linesEn.push(`Already existed (${r.alreadyExisted.length}): ${r.alreadyExisted.join(', ')}`);
  }
  if (r.failed.length) {
    linesAr.push(`فشل (${r.failed.length}): ${r.failed.map((f) => f.code).join('، ')}`);
    linesEn.push(`Failed (${r.failed.length}): ${r.failed.map((f) => f.code).join(', ')}`);
  }
  if (r.added.length === 0 && r.alreadyExisted.length === 0 && r.failed.length === 0) {
    linesAr.push('لا توجد عناصر لمعالجتها.');
    linesEn.push('No items to process.');
  }

  return {
    success,
    data: r,
    affectedCount: r.added.length,
    errorCode,
    messageAr: linesAr.join('\n'),
    messageEn: linesEn.join('\n'),
  };
}

interface FuzzyAwareAddResult extends AddResult {
  likelyDuplicates: Array<{ input: string; matchedName: string; matchedCode: string; confidence: number }>;
  ambiguous: Array<{ input: string; candidates: Array<{ name: string; code: string; confidence: number }> }>;
}

/**
 * §7/§9/§60 - search-before-create for name-driven entities. Each item is
 * independently classified NEW / LIKELY_DUPLICATE / AMBIGUOUS (never
 * all-or-nothing - one ambiguous item must not block the other, unrelated
 * items from being created). Only NEW items are actually written; the other
 * two categories are reported back for the user (or a natural-language
 * follow-up) to resolve - never silently created, never silently skipped
 * without explanation.
 */
async function addNamedEntitiesWithFuzzyCheck(
  collectionName: string,
  domainLabelAr: string,
  domainLabelEn: string,
  items: Array<{ code: string; name: string }>
): Promise<FuzzyAwareAddResult> {
  const ready: Array<{ code: string; extra?: Record<string, any> }> = [];
  const likelyDuplicates: FuzzyAwareAddResult['likelyDuplicates'] = [];
  const ambiguous: FuzzyAwareAddResult['ambiguous'] = [];

  for (const item of items) {
    const check = await checkFuzzyDuplicate(collectionName, domainLabelAr, domainLabelEn, item.name);
    if (check.status === 'LIKELY_DUPLICATE') {
      const top = check.candidates[0];
      likelyDuplicates.push({ input: item.name, matchedName: top.name, matchedCode: top.code, confidence: top.confidence });
    } else if (check.status === 'AMBIGUOUS') {
      ambiguous.push({ input: item.name, candidates: check.candidates.map((c) => ({ name: c.name, code: c.code, confidence: c.confidence })) });
    } else {
      ready.push({ code: item.code, extra: { name: item.name } });
    }
  }

  const base = await addMasterDataItems(collectionName, ready);
  return { ...base, likelyDuplicates, ambiguous };
}

function summarizeFuzzyAddResult(entityLabelAr: string, entityLabelEn: string, r: FuzzyAwareAddResult): ToolExecutionResult<FuzzyAwareAddResult> {
  const plain = summarizeAddResult(entityLabelAr, entityLabelEn, r);
  const linesAr = [plain.messageAr!];
  const linesEn = [plain.messageEn!];

  if (r.likelyDuplicates.length > 0) {
    const listAr = r.likelyDuplicates.map((d) => `"${d.input}" ≈ "${d.matchedName}" (${d.matchedCode})`).join('، ');
    const listEn = r.likelyDuplicates.map((d) => `"${d.input}" ≈ "${d.matchedName}" (${d.matchedCode})`).join(', ');
    linesAr.push(`يشبه بيانات موجودة ولم تتم إضافته (${r.likelyDuplicates.length}): ${listAr}`);
    linesEn.push(`Matches existing data, NOT added (${r.likelyDuplicates.length}): ${listEn}`);
  }
  if (r.ambiguous.length > 0) {
    const listAr = r.ambiguous.map((a) => `"${a.input}": ${a.candidates.map((c) => candidateLine(c)).join(' / ')}`).join(' | ');
    const listEn = r.ambiguous.map((a) => `"${a.input}": ${a.candidates.map((c) => candidateLine(c)).join(' / ')}`).join(' | ');
    linesAr.push(`غير مؤكد ويحتاج اختيارك قبل الإضافة (${r.ambiguous.length}): ${listAr}`);
    linesEn.push(`Ambiguous, needs your choice before adding (${r.ambiguous.length}): ${listEn}`);
  }

  const total = r.added.length + r.alreadyExisted.length + r.likelyDuplicates.length + r.ambiguous.length + r.failed.length;
  linesAr.push(`الملخص: من إجمالي ${total} عنصر مطلوب، تم إنشاء ${r.added.length} سجل جديد.`);
  linesEn.push(`Summary: out of ${total} item(s) requested, ${r.added.length} new record(s) created.`);

  const hasBlockedItems = r.likelyDuplicates.length > 0 || r.ambiguous.length > 0;
  const errorCode = r.added.length === 0 && hasBlockedItems
    ? (r.ambiguous.length > 0 ? 'AMBIGUOUS_ENTITY' : 'DUPLICATE')
    : undefined;

  return {
    success: r.failed.length === 0,
    data: r,
    affectedCount: r.added.length,
    errorCode,
    messageAr: linesAr.join('\n'),
    messageEn: linesEn.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Generic read tools
// ---------------------------------------------------------------------------

/**
 * Critical Analytics/Workflow Correction, Rule 3 - "الوردية 2"/"Shift 2"/
 * "الشفت 2"/"الشيفت الثاني" must resolve to the actual numbered shift
 * DETERMINISTICALLY, never via fuzzy text-similarity scoring. Live evidence
 * showed the fuzzy fallback silently resolving "الوردية 2" to Shift 1 (a
 * different shift's name happened to score higher against a non-matching-
 * language query) and the caller then trusting that single wrong match
 * with no way to notice - Rule 1/2 ("never silently substitute", "Master
 * Data is authoritative"). A shift's real number is unambiguous once
 * extracted, so this is checked BEFORE the generic substring/fuzzy path
 * below ever runs, and only for the 'shifts' collection - press/furnace-car
 * names routinely embed unrelated model/instance numbers (e.g. "مكبس بوخر
 * 900 (2)"), so the SAME blind digit-match would misfire there; this fix is
 * deliberately scoped to the one entity type the live bug actually proved
 * broken, not generalized without evidence.
 */
const ARABIC_SHIFT_ORDINAL_TO_NUMBER: Record<string, number> = {
  'الأول': 1, 'الاول': 1, 'أول': 1, 'اول': 1,
  'الثاني': 2, 'ثاني': 2,
  'الثالث': 3, 'ثالث': 3,
};

/** Exported so gateway.ts's Dashboard-mutation-priority logic (Targeted Dashboard Workflow Fix) can deterministically resolve a pending "shift" mutation from the raw user text using this EXACT SAME extractor - never a second, drifting shift-number parser. */
export function extractShiftNumber(query: string): number | null {
  const digitMatch = query.match(/\b([123])\b/);
  if (digitMatch) return Number(digitMatch[1]);
  for (const [word, num] of Object.entries(ARABIC_SHIFT_ORDINAL_TO_NUMBER)) {
    if (query.includes(word)) return num;
  }
  return null;
}

/**
 * Returns shifts whose OWN name/code contains the exact requested number -
 * null (not an empty array) when the query names no number at all, so the
 * caller falls through to the normal substring/fuzzy path unchanged for
 * queries like "الوردية الصباحية" that don't name a number.
 */
function resolveNumberedShift(query: string, shifts: any[]): any[] | null {
  const num = extractShiftNumber(query);
  if (num === null) return null;
  const numRe = new RegExp(`\\b${num}\\b`);
  return shifts.filter((s) => numRe.test(String(s.name || '')) || String(s.code || '').trim() === String(num) || numRe.test(String(s.code || '')));
}

/**
 * The ONE master-data lookup implementation - union of plain substring
 * matching (code/name/carNumber) with the SAME fuzzy engine Historical
 * Import already uses (catches near-duplicates/typos/Arabic-normalization
 * variants a substring check would miss). Exported so Phase 4's
 * openMasterDataRecord tool (navigationTools.ts) reuses this exact logic
 * instead of a second, drifting implementation (§5/§6).
 */
export async function findMasterDataMatches(collectionName: string, query: string): Promise<any[]> {
  const items = await fetchMasterData<any>(collectionName);
  if (!query) return items;

  if (collectionName === 'shifts') {
    const numbered = resolveNumberedShift(query, items);
    if (numbered) return numbered;
  }
  const q = query.toLowerCase();
  const substringMatches = items.filter((i) =>
    String(i.code || '').toLowerCase().includes(q) ||
    String(i.name || '').toLowerCase().includes(q) ||
    String(i.carNumber || '').toLowerCase().includes(q)
  );
  const fuzzyCandidates = rankFuzzyCandidates(query, items, { minConfidence: 40, maxResults: 20 });
  const byId = new Map<string, any>();
  for (const m of substringMatches) byId.set(m.id, m);
  for (const c of fuzzyCandidates) byId.set(c.id, c.entity);
  return Array.from(byId.values());
}

/**
 * AI Architecture Consolidation - the ONE "resolve exactly one master-data
 * match, or fail honestly" pattern. setDashboardShiftFilter/
 * setDashboardEntityFilter/openMasterDataRecord (navigationTools.ts) and
 * setCustomDashboardFilters's per-field loop (customDashboardTools.ts) each
 * repeated this same 0-matches/1-match/>1-matches shape inline with only
 * their own wording differing - never a second lookup, always
 * findMasterDataMatches() above. Message fragments are supplied by the
 * caller (not hardcoded here) so every existing site's exact Arabic/English
 * phrasing is preserved byte-for-byte.
 */
export type SingleMatchResult =
  | { outcome: 'FOUND'; match: any }
  | { outcome: 'NOT_FOUND' | 'AMBIGUOUS'; candidates?: any[]; result: { success: false; errorCode: string; data?: { candidates: any[] }; messageAr: string; messageEn: string } };

export async function resolveSingleMasterDataMatch(
  collectionName: string,
  query: string,
  options: {
    notFoundAr: string;
    notFoundEn: string;
    ambiguousPrefixAr: string;
    ambiguousPrefixEn: string;
    ambiguousSuffixAr: string;
    ambiguousSuffixEn: string;
    labelFn?: (m: any) => string;
  }
): Promise<SingleMatchResult> {
  const matches = await findMasterDataMatches(collectionName, query);
  if (matches.length === 0) {
    return { outcome: 'NOT_FOUND', result: { success: false, errorCode: 'NOT_FOUND', messageAr: options.notFoundAr, messageEn: options.notFoundEn } };
  }
  if (matches.length > 1) {
    const shown = matches.slice(0, 8);
    const labelFn = options.labelFn || ((m: any) => m.name || m.code);
    return {
      outcome: 'AMBIGUOUS',
      candidates: shown,
      result: {
        success: false,
        errorCode: 'AMBIGUOUS_ENTITY',
        data: { candidates: shown },
        messageAr: `${options.ambiguousPrefixAr}${shown.map(labelFn).join('، ')}${options.ambiguousSuffixAr}`,
        messageEn: `${options.ambiguousPrefixEn}${shown.map(labelFn).join(', ')}${options.ambiguousSuffixEn}`,
      },
    };
  }
  return { outcome: 'FOUND', match: matches[0] };
}

const searchMasterData: ToolDefinition = {
  toolName: 'searchMasterData',
  descriptionAr: 'البحث في البيانات الأساسية (موظفين، مكابس، عربات أفران، أصناف، عملاء، ورديات)',
  descriptionEn: 'Search master data (employees, presses, furnace cars, products, customers, shifts)',
  commandType: 'QUERY',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['masterdata.view'],
  parameterSchema: MASTER_DATA_DOMAIN_QUERY_SCHEMA,
  inputSchema: (input) => {
    const domain = String(input?.domain || '').trim();
    const collectionName = (MASTER_DATA_COLLECTIONS as Record<string, string>)[domain];
    if (!collectionName) {
      return { valid: false, errors: [`Unknown master data domain: ${domain}`] };
    }
    return { valid: true, value: { domain, collectionName, query: String(input?.query || '').trim().toLowerCase() } };
  },
  execute: async (input) => {
    const matches = await findMasterDataMatches(input.collectionName, input.query);

    // §22/§23/§25/§59 - list actual names/codes (not just a count) so a
    // conversational follow-up ("أضفها" / "add it") has enough context in
    // history to resolve which entity the user means, and so the user sees
    // real candidates instead of an opaque number.
    const shown = matches.slice(0, 10);
    const label = (m: any) => `${m.name || m.carNumber || m.code || '?'} (${m.code || m.carNumber || '-'})`;
    const moreNoteAr = matches.length > shown.length ? ` (عرض أول ${shown.length})` : '';
    const moreNoteEn = matches.length > shown.length ? ` (showing first ${shown.length})` : '';

    return {
      success: true,
      data: matches.slice(0, 50),
      affectedCount: matches.length,
      errorCode: input.query && matches.length === 0 ? 'NOT_FOUND' : undefined,
      messageAr: matches.length > 0
        ? `تم العثور على ${matches.length} نتيجة${moreNoteAr}: ${shown.map(label).join('، ')}.`
        : `لم يتم العثور على أي نتيجة مطابقة${input.query ? ` لـ "${input.query}"` : ''}.`,
      messageEn: matches.length > 0
        ? `Found ${matches.length} result(s)${moreNoteEn}: ${shown.map(label).join(', ')}.`
        : `No results found${input.query ? ` matching "${input.query}"` : ''}.`,
    };
  },
};

const getMasterData: ToolDefinition = {
  toolName: 'getMasterData',
  descriptionAr: 'عرض كافة عناصر بيانات أساسية محددة',
  descriptionEn: 'List all items of a given master data domain',
  commandType: 'QUERY',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['masterdata.view'],
  parameterSchema: MASTER_DATA_DOMAIN_QUERY_SCHEMA,
  inputSchema: (input) => {
    const domain = String(input?.domain || '').trim();
    const collectionName = (MASTER_DATA_COLLECTIONS as Record<string, string>)[domain];
    if (!collectionName) return { valid: false, errors: [`Unknown master data domain: ${domain}`] };
    return { valid: true, value: { domain, collectionName } };
  },
  execute: async (input) => {
    const items = await fetchMasterData<any>(input.collectionName);
    return {
      success: true,
      data: items,
      affectedCount: items.length,
      messageAr: `يوجد ${items.length} عنصر في (${input.domain}).`,
      messageEn: `There are ${items.length} item(s) in (${input.domain}).`,
    };
  },
};

const checkDuplicateMasterData: ToolDefinition = {
  toolName: 'checkDuplicateMasterData',
  descriptionAr: 'التحقق مما إذا كان كود بيانات أساسية موجوداً مسبقاً',
  descriptionEn: 'Check whether a master data code already exists',
  commandType: 'QUERY',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: ['masterdata.view'],
  parameterSchema: CHECK_DUPLICATE_SCHEMA,
  inputSchema: (input) => {
    const domain = String(input?.domain || '').trim();
    const collectionName = (MASTER_DATA_COLLECTIONS as Record<string, string>)[domain];
    const code = String(input?.code || '').trim();
    if (!collectionName || !code) return { valid: false, errors: ['domain and code are required'] };
    return { valid: true, value: { collectionName, code } };
  },
  execute: async (input) => {
    const exists = await checkCodeDuplicate(input.collectionName, input.code);
    return {
      success: true,
      data: { exists },
      messageAr: exists ? `الكود "${input.code}" موجود مسبقاً.` : `الكود "${input.code}" غير موجود.`,
      messageEn: exists ? `Code "${input.code}" already exists.` : `Code "${input.code}" does not exist.`,
    };
  },
};

// ---------------------------------------------------------------------------
// Generic write tools
// ---------------------------------------------------------------------------

const addMasterData: ToolDefinition = {
  toolName: 'addMasterData',
  descriptionAr: 'إضافة عنصر بيانات أساسية جديد (استخدم الأدوات المخصصة عند الإمكان)',
  descriptionEn: 'Add a new master data item (prefer the domain-specific tools when possible)',
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'WHEN_MULTIPLE_RECORDS',
  requiredPermission: ['masterData.inlineAdd', 'masterdata.view'],
  parameterSchema: ADD_MASTER_DATA_SCHEMA,
  inputSchema: (input) => {
    const domain = String(input?.domain || '').trim();
    const collectionName = (MASTER_DATA_COLLECTIONS as Record<string, string>)[domain];
    const codes = Array.isArray(input?.codes) ? input.codes.map((c: any) => String(c).trim()).filter(Boolean) : [];
    if (!collectionName || codes.length === 0) {
      return { valid: false, errors: ['domain and a non-empty codes[] array are required'] };
    }
    return { valid: true, value: { domain, collectionName, codes } };
  },
  execute: async (input) => {
    const r = await addMasterDataItems(input.collectionName, input.codes.map((code: string) => ({ code })));
    return summarizeAddResult(input.domain, input.domain, r);
  },
  buildPreview: async (input) => {
    const items = await previewCodeItems(input.collectionName, input.domain, input.domain, input.codes);
    return { targetSummaryAr: `${input.domain}: ${input.codes.join(', ')}`, targetSummaryEn: `${input.domain}: ${input.codes.join(', ')}`, items };
  },
};

const updateMasterData: ToolDefinition = {
  toolName: 'updateMasterData',
  descriptionAr: 'تحديث بيانات عنصر أساسي موجود',
  descriptionEn: 'Update an existing master data item',
  commandType: 'ACTION',
  riskLevel: 'MEDIUM_RISK',
  confirmationPolicy: 'ALWAYS',
  requiredPermission: ['masterdata.view'],
  inputSchema: (input) => {
    const domain = String(input?.domain || '').trim();
    const collectionName = (MASTER_DATA_COLLECTIONS as Record<string, string>)[domain];
    const id = String(input?.id || '').trim();
    if (!collectionName || !id || typeof input?.data !== 'object') {
      return { valid: false, errors: ['domain, id and data are required'] };
    }
    return { valid: true, value: { collectionName, id, data: input.data } };
  },
  // Deliberately not wired to a live write in this foundational phase - update
  // touches arbitrary fields and is MEDIUM_RISK, always-confirm; left as a
  // structurally-complete, explicitly-unimplemented tool rather than a silent
  // Firestore write, so it never claims a success it didn't perform.
  execute: async () => ({
    success: false,
    errorCode: 'NOT_YET_ENABLED',
    messageAr: 'تعذر تنفيذ العملية. تحديث البيانات الأساسية عبر المساعد غير مفعل بعد.',
    messageEn: 'Unable to complete the operation. Updating master data via the assistant is not yet enabled.',
  }),
};

// ---------------------------------------------------------------------------
// Domain-specific wrappers
// ---------------------------------------------------------------------------

const addFurnaceCars: ToolDefinition = {
  toolName: 'addFurnaceCars',
  descriptionAr: 'إضافة عربة/عربات أفران جديدة',
  descriptionEn: 'Add new furnace car(s)',
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'WHEN_MULTIPLE_RECORDS',
  requiredPermission: ['furnaceCars.create', 'masterData.inlineAdd'],
  parameterSchema: ADD_FURNACE_CARS_SCHEMA,
  inputSchema: (input) => {
    // Furnace Car identity is ALWAYS just the car number - brickCount (if the
    // caller supplies structured { carNumber, brickCount } pairs, per the
    // "أضف العربة 278 وعدد الطوب عليها 453" assistant use case) is
    // transactional data and is deliberately never used to create or match
    // Master Data here; it is only carried through in the result for any
    // future production-entry tool to consume.
    let tokens: string[] = [];
    let brickCountByCarNumber: Record<string, number> = {};

    if (Array.isArray(input?.pairs)) {
      for (const p of input.pairs) {
        const carNumber = String(p?.carNumber ?? '').trim();
        if (!carNumber) continue;
        tokens.push(carNumber);
        if (typeof p?.brickCount === 'number' && Number.isFinite(p.brickCount)) {
          brickCountByCarNumber[carNumber] = p.brickCount;
        }
      }
    } else if (Array.isArray(input?.codes)) {
      tokens = input.codes.map((c: any) => String(c).trim()).filter(Boolean);
    } else {
      // A raw string uses the SAME CAR-BRICKS/CAR-BRICKS pair parser as
      // historical import - never the old flat multi-code split, which would
      // wrongly treat "278-453" as two independent furnace cars.
      const pairs = parseFurnaceCarBrickPairs(String(input?.codes ?? ''));
      for (const p of pairs) {
        if (!p.isValid || !p.carNumber) continue;
        tokens.push(p.carNumber);
        if (p.brickCount !== null) brickCountByCarNumber[p.carNumber] = p.brickCount;
      }
    }

    if (tokens.length === 0) return { valid: false, errors: ['At least one furnace car number is required'] };
    return { valid: true, value: { codes: tokens, brickCountByCarNumber } };
  },
  execute: async (input) => {
    // §9-§17 - furnace cars use the authoritative carNumber-based check
    // (findExistingFurnaceCarByNumber), never the generic code-field check -
    // see the block above for why.
    const r = await addFurnaceCarItems(
      input.codes.map((carNumber: string) => ({ carNumber, extra: { name: carNumber } }))
    );
    return {
      ...summarizeAddResult('عربات الأفران', 'Furnace Cars', r),
      data: { ...r, brickCountByCarNumber: input.brickCountByCarNumber },
    };
  },
  buildPreview: async (input) => {
    const items = await previewFurnaceCarItems(input.codes);
    return {
      targetSummaryAr: `عربات الأفران: ${input.codes.join(', ')}`,
      targetSummaryEn: `Furnace Cars: ${input.codes.join(', ')}`,
      items,
    };
  },
};

const addPresses: ToolDefinition = {
  toolName: 'addPresses',
  descriptionAr: 'إضافة مكبس/مكابس جديدة',
  descriptionEn: 'Add new press(es)',
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'WHEN_MULTIPLE_RECORDS',
  requiredPermission: ['presses.create', 'masterData.inlineAdd'],
  parameterSchema: ADD_PRESSES_SCHEMA,
  inputSchema: (input) => {
    // Press is a SINGLE_ENTITY_FIELD - never hyphen-split. Only an explicit array is accepted.
    const codes = Array.isArray(input?.codes) ? input.codes.map((c: any) => String(c).trim()).filter(Boolean) : [];
    if (codes.length === 0) return { valid: false, errors: ['At least one press code is required'] };
    return { valid: true, value: { codes } };
  },
  execute: async (input) => {
    const r = await addNamedEntitiesWithFuzzyCheck(
      'presses',
      'المكابس',
      'Presses',
      input.codes.map((code: string) => ({ code, name: code }))
    );
    return summarizeFuzzyAddResult('المكابس', 'Presses', r);
  },
  buildPreview: async (input) => {
    const items = await previewNamedItems('presses', 'المكبس', 'Press', input.codes.map((code: string) => ({ code, name: code })));
    return { targetSummaryAr: `المكابس: ${input.codes.join(', ')}`, targetSummaryEn: `Presses: ${input.codes.join(', ')}`, items };
  },
};

const addShifts: ToolDefinition = {
  toolName: 'addShifts',
  descriptionAr: 'إضافة وردية/ورديات جديدة',
  descriptionEn: 'Add new shift(s)',
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'WHEN_MULTIPLE_RECORDS',
  requiredPermission: ['shifts.create', 'masterData.inlineAdd'],
  parameterSchema: ADD_SHIFTS_SCHEMA,
  inputSchema: (input) => {
    const codes = Array.isArray(input?.codes) ? input.codes.map((c: any) => String(c).trim()).filter(Boolean) : [];
    if (codes.length === 0) return { valid: false, errors: ['At least one shift code is required'] };
    return { valid: true, value: { codes } };
  },
  execute: async (input) => {
    const r = await addMasterDataItems('shifts', input.codes.map((code: string) => ({ code, extra: { name: code } })));
    return summarizeAddResult('الورديات', 'Shifts', r);
  },
  buildPreview: async (input) => {
    const items = await previewCodeItems('shifts', 'الوردية', 'Shift', input.codes);
    return { targetSummaryAr: `الورديات: ${input.codes.join(', ')}`, targetSummaryEn: `Shifts: ${input.codes.join(', ')}`, items };
  },
};

const addEmployees: ToolDefinition = {
  toolName: 'addEmployees',
  descriptionAr: 'إضافة موظف/موظفين جدد',
  descriptionEn: 'Add new employee(s)',
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'WHEN_MULTIPLE_RECORDS',
  requiredPermission: ['employees.create', 'masterData.inlineAdd'],
  parameterSchema: ADD_NAMED_ENTITY_SCHEMA,
  inputSchema: (input) => {
    const items = Array.isArray(input?.items) ? input.items : [];
    const normalized = items
      .map((i: any) => ({ name: String(i?.name || '').trim(), code: String(i?.code || i?.name || '').trim() }))
      .filter((i: any) => i.name && i.code);
    if (normalized.length === 0) return { valid: false, errors: ['At least one employee { name } is required'] };
    return { valid: true, value: { items: normalized } };
  },
  execute: async (input) => {
    const r = await addNamedEntitiesWithFuzzyCheck(
      'employees',
      'الموظفون',
      'Employees',
      input.items.map((i: any) => ({ code: i.code, name: i.name }))
    );
    return summarizeFuzzyAddResult('الموظفون', 'Employees', r);
  },
  buildPreview: async (input) => {
    const items = await previewNamedItems('employees', 'الموظف', 'Employee', input.items);
    return { targetSummaryAr: `الموظفون: ${input.items.map((i: any) => i.name).join(', ')}`, targetSummaryEn: `Employees: ${input.items.map((i: any) => i.name).join(', ')}`, items };
  },
};

const addProducts: ToolDefinition = {
  toolName: 'addProducts',
  descriptionAr: 'إضافة صنف/أصناف منتجات جديدة',
  descriptionEn: 'Add new product(s)',
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'WHEN_MULTIPLE_RECORDS',
  requiredPermission: ['products.create', 'masterData.inlineAdd'],
  parameterSchema: ADD_PRODUCTS_SCHEMA,
  inputSchema: (input) => {
    // Product codes are SINGLE_ENTITY_FIELD - each item's code is treated as
    // one atomic value, never split (e.g. "BAR-250-102-305" stays intact).
    const items = Array.isArray(input?.items) ? input.items : [];
    const normalized = items
      .map((i: any) => ({ code: String(i?.code || '').trim(), name: String(i?.name || i?.code || '').trim() }))
      .filter((i: any) => i.code);
    if (normalized.length === 0) return { valid: false, errors: ['At least one product { code } is required'] };
    return { valid: true, value: { items: normalized } };
  },
  execute: async (input) => {
    const r = await addMasterDataItems(
      'products',
      input.items.map((i: any) => ({ code: i.code, extra: { name: i.name } }))
    );
    return summarizeAddResult('الأصناف', 'Products', r);
  },
  buildPreview: async (input) => {
    const items = await previewCodeItems('products', 'الصنف', 'Product', input.items.map((i: any) => i.code));
    return { targetSummaryAr: `الأصناف: ${input.items.map((i: any) => i.code).join(', ')}`, targetSummaryEn: `Products: ${input.items.map((i: any) => i.code).join(', ')}`, items };
  },
};

const addCustomers: ToolDefinition = {
  toolName: 'addCustomers',
  descriptionAr: 'إضافة عميل/عملاء جدد',
  descriptionEn: 'Add new customer(s)',
  commandType: 'ACTION',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'WHEN_MULTIPLE_RECORDS',
  requiredPermission: ['customers.create', 'masterData.inlineAdd'],
  parameterSchema: ADD_NAMED_ENTITY_SCHEMA,
  inputSchema: (input) => {
    const items = Array.isArray(input?.items) ? input.items : [];
    const normalized = items
      .map((i: any) => ({ name: String(i?.name || '').trim(), code: String(i?.code || i?.name || '').trim() }))
      .filter((i: any) => i.name && i.code);
    if (normalized.length === 0) return { valid: false, errors: ['At least one customer { name } is required'] };
    return { valid: true, value: { items: normalized } };
  },
  execute: async (input) => {
    const r = await addNamedEntitiesWithFuzzyCheck(
      'customers',
      'العملاء',
      'Customers',
      input.items.map((i: any) => ({ code: i.code, name: i.name }))
    );
    return summarizeFuzzyAddResult('العملاء', 'Customers', r);
  },
  buildPreview: async (input) => {
    const items = await previewNamedItems('customers', 'العميل', 'Customer', input.items);
    return { targetSummaryAr: `العملاء: ${input.items.map((i: any) => i.name).join(', ')}`, targetSummaryEn: `Customers: ${input.items.map((i: any) => i.name).join(', ')}`, items };
  },
};

export function registerMasterDataTools(): void {
  [
    searchMasterData,
    getMasterData,
    checkDuplicateMasterData,
    addMasterData,
    updateMasterData,
    addFurnaceCars,
    addPresses,
    addShifts,
    addEmployees,
    addProducts,
    addCustomers,
  ].forEach(registerTool);
}

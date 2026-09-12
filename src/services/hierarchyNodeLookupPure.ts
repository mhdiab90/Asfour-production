/**
 * Deterministic hierarchy-node lookup: text or code -> node.
 *
 * WHY THIS EXISTS.
 * The assistant hears "المكابس", but every layer below it works in stable node
 * ids. Something has to bridge that, and the dangerous way to do it is fuzzy
 * similarity: "مكابس البوخر" scores well against "المكابس", and silently
 * picking the winner would attribute one branch's production to another. A
 * wrong total that looks plausible is worse than no answer.
 *
 * So this module is exact-match only, in a fixed precedence order, and it
 * REFUSES rather than guesses:
 *
 *   FOUND      exactly one node matched
 *   AMBIGUOUS  several matched - the caller must ask which one
 *   NOT_FOUND  none matched - the caller must say so, never return zero
 *
 * NOT_FOUND and "found but no production" are deliberately different results.
 * Collapsing them would let "إنتاج المكابس السريعة" (a node that does not
 * exist) answer "0", which reads as a fact about production rather than a
 * missing node.
 *
 * FUZZY MATCHING IS PRESENT BUT NEVER AUTHORITATIVE. `suggestions` is populated
 * only when the exact passes found nothing, and it exists so the caller can ask
 * "did you mean…?". Nothing in this module ever resolves a node from it.
 *
 * Pure and Firebase-free: it is handed the nodes, it never fetches them.
 */
import { rankFuzzyCandidates } from '../utils/fuzzyMatching';
import { HierarchyIndex, HierarchyNodeInput, getNodePath } from './hierarchyResolverPure';

export type HierarchyLookupStatus = 'FOUND' | 'AMBIGUOUS' | 'NOT_FOUND';

/** How a node matched, so the caller can explain itself and tests can assert precedence. */
export type HierarchyMatchKind = 'code' | 'name' | 'localizedName';

export interface HierarchyNodeCandidate {
  id: string;
  code: string;
  name: string;
  /** Root-first readable path, for disambiguation. Never shown as an id. */
  path: string;
}

export interface HierarchyLookupResult {
  status: HierarchyLookupStatus;
  /** Set only when status is FOUND. */
  node?: HierarchyNodeCandidate;
  matchedBy?: HierarchyMatchKind;
  /** Every node that matched. One entry when FOUND, several when AMBIGUOUS. */
  candidates: HierarchyNodeCandidate[];
  /**
   * Fuzzy near-misses, offered ONLY when nothing matched exactly. Never used to
   * resolve - the caller shows them and waits for the user to choose.
   */
  suggestions: HierarchyNodeCandidate[];
  /** The text that was looked up, echoed back for the caller's message. */
  query: string;
}

/**
 * Deterministic normalisation - NOT similarity.
 *
 * Two strings a human would call identical must compare equal: surrounding
 * whitespace, letter case, Arabic diacritics, and the alef/ya/ta-marbuta
 * variants that the same word is routinely typed with. This is a canonical
 * form, so it is reversible in meaning and cannot promote a near-miss into a
 * match the way a similarity score can.
 */
export function normaliseLookupText(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    // Arabic diacritics and tatweel carry no lexical meaning here.
    .replace(/[ً-ْـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا') // alef variants -> alef
    .replace(/ى/g, 'ي')                      // alef maqsura -> ya
    .replace(/ة/g, 'ه')                      // ta marbuta   -> ha
    .replace(/\s+/g, ' ');
}

/** Fields a hierarchy node can be named by. `name` is canonical; the rest are localized. */
interface NameFields {
  code: string;
  canonical: string;
  localized: string[];
}

function namesOf(node: Record<string, any>): NameFields {
  return {
    code: String(node.code ?? node.sheet1Code ?? ''),
    canonical: String(node.name ?? ''),
    // Read from the record rather than hard-coded here, so a node that gains an
    // English or alias field is matchable without touching this module.
    localized: [node.nameEn, node.nameAr, node.displayName, node.alias]
      .filter((v) => v != null && String(v).trim() !== '')
      .map((v) => String(v)),
  };
}

function toCandidate<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  node: Record<string, any>,
): HierarchyNodeCandidate {
  const id = String(node.id ?? '');
  return {
    id,
    code: String(node.code ?? node.sheet1Code ?? ''),
    name: String(node.name ?? node.sheet1Code ?? id),
    path:
      getNodePath(index, id, (x: any) => x.name || x.sheet1Code || x.code || x.id, ' ← ') ||
      String(node.name ?? id),
  };
}

export interface LookupOptions {
  /** Offer fuzzy near-misses when nothing matched exactly. Default true. */
  suggest?: boolean;
  /** How many suggestions at most. Default 5. */
  suggestionLimit?: number;
}

/**
 * Resolves one piece of user text to a hierarchy node.
 *
 * Precedence is fixed and checked in order - code, then canonical name, then a
 * localized name. The first level that matches ANYTHING decides the outcome:
 * if two nodes share a code the answer is AMBIGUOUS, and the search does not
 * fall through to names hoping for a cleaner result. Falling through would make
 * the answer depend on how many nodes happened to collide, which is exactly the
 * kind of instability this module exists to prevent.
 */
export function lookupHierarchyNode<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  nodes: readonly Record<string, any>[],
  query: string,
  options?: LookupOptions,
): HierarchyLookupResult {
  const wanted = normaliseLookupText(query);
  const base: HierarchyLookupResult = { status: 'NOT_FOUND', candidates: [], suggestions: [], query: String(query ?? '') };
  if (!wanted) return base;

  const levels: Array<{ kind: HierarchyMatchKind; test: (n: NameFields) => boolean }> = [
    { kind: 'code', test: (n) => normaliseLookupText(n.code) === wanted },
    { kind: 'name', test: (n) => normaliseLookupText(n.canonical) === wanted },
    { kind: 'localizedName', test: (n) => n.localized.some((v) => normaliseLookupText(v) === wanted) },
  ];

  for (const level of levels) {
    const hits = nodes.filter((node) => level.test(namesOf(node)));
    if (hits.length === 0) continue;

    const candidates = hits.map((n) => toCandidate(index, n));
    if (candidates.length === 1) {
      return { status: 'FOUND', node: candidates[0], matchedBy: level.kind, candidates, suggestions: [], query: base.query };
    }
    // Several nodes answer to the same text. The caller must ask which, and the
    // paths are what makes that question answerable.
    return { status: 'AMBIGUOUS', matchedBy: level.kind, candidates, suggestions: [], query: base.query };
  }

  // Nothing matched exactly. Near-misses are offered as a QUESTION, never as an answer.
  if (options?.suggest === false) return base;
  const ranked = rankFuzzyCandidates(
    query,
    nodes.map((n) => ({ id: String(n.id ?? ''), code: String(n.code ?? n.sheet1Code ?? ''), name: String(n.name ?? ''), record: n })),
    { maxResults: options?.suggestionLimit ?? 5 },
  );
  const suggestions = ranked
    .map((r) => r.entity?.record)
    .filter(Boolean)
    .map((n) => toCandidate(index, n));

  return { ...base, suggestions };
}

export interface MultiLookupResult {
  /** Node ids for every term that resolved to exactly one node. */
  nodeIds: string[];
  resolved: Array<{ query: string; node: HierarchyNodeCandidate }>;
  ambiguous: HierarchyLookupResult[];
  notFound: HierarchyLookupResult[];
}

/**
 * Resolves several terms at once ("المكابس والأفران").
 *
 * Every term is reported on independently, and an unusable term NEVER silently
 * disappears: a caller that finds anything in `ambiguous` or `notFound` is
 * expected to ask about it rather than quietly answering for the rest. That is
 * the difference between "production for presses and furnaces" and "production
 * for presses, and I ignored the word furnaces".
 */
export function lookupHierarchyNodes<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  nodes: readonly Record<string, any>[],
  queries: readonly string[],
  options?: LookupOptions,
): MultiLookupResult {
  const out: MultiLookupResult = { nodeIds: [], resolved: [], ambiguous: [], notFound: [] };
  const seen = new Set<string>();

  for (const query of queries) {
    const result = lookupHierarchyNode(index, nodes, query, options);
    if (result.status === 'FOUND' && result.node) {
      out.resolved.push({ query: result.query, node: result.node });
      if (!seen.has(result.node.id)) {
        seen.add(result.node.id);
        out.nodeIds.push(result.node.id);
      }
    } else if (result.status === 'AMBIGUOUS') {
      out.ambiguous.push(result);
    } else {
      out.notFound.push(result);
    }
  }
  return out;
}

/** True when every term resolved - the only case a caller may proceed to query. */
export function isFullyResolved(result: MultiLookupResult): boolean {
  return result.ambiguous.length === 0 && result.notFound.length === 0 && result.nodeIds.length > 0;
}

/**
 * The clarification/notice text for a lookup that could not proceed.
 *
 * Shows readable paths, never ids - an id in a chat answer is noise the user
 * cannot act on.
 */
export function describeLookupProblem(result: MultiLookupResult, language: 'ar' | 'en'): string {
  const parts: string[] = [];

  for (const amb of result.ambiguous) {
    const paths = amb.candidates.map((c) => c.path).join(language === 'ar' ? ' — ' : ' | ');
    parts.push(
      language === 'ar'
        ? `"${amb.query}" يطابق أكثر من مركز إنتاجي. أي واحد تقصد؟ ${paths}`
        : `"${amb.query}" matches more than one production centre. Which did you mean? ${paths}`,
    );
  }

  for (const miss of result.notFound) {
    if (miss.suggestions.length > 0) {
      const paths = miss.suggestions.map((c) => c.path).join(language === 'ar' ? ' — ' : ' | ');
      parts.push(
        language === 'ar'
          ? `لم أجد مركزًا إنتاجيًا باسم "${miss.query}". هل تقصد: ${paths}؟`
          : `No production centre named "${miss.query}". Did you mean: ${paths}?`,
      );
    } else {
      parts.push(
        language === 'ar'
          ? `لم أجد مركزًا إنتاجيًا بهذا الاسم في البيانات الأساسية: "${miss.query}".`
          : `No production centre named "${miss.query}" exists in Master Data.`,
      );
    }
  }

  return parts.join(language === 'ar' ? ' ' : ' ');
}

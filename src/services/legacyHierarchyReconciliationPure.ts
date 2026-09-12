/**
 * Legacy equipment <-> hierarchy node reconciliation.
 *
 * THE PROBLEM.
 * The same real press can exist twice: once as a legacy Master Data record
 * (presses/furnaces/chineseMills) and once as a node in the imported hierarchy.
 * The names rarely agree - "مكبس الألومينا" against "كبس الالومينا" - so the
 * only trustworthy identity is the business CODE.
 *
 * WHAT IS AND IS NOT AUTHORITATIVE.
 * Code equality inside the same category is the identity. Name similarity is
 * not used at all, not even as a tie-breaker: two presses called "بوخر 1" and
 * "بوخر ١" would score well against each other and against a third, and a wrong
 * link silently attributes one machine's production to another.
 *
 * CATEGORY IS PART OF THE IDENTITY.
 * `checkCodeDuplicate` scopes uniqueness to one collection, so the schema
 * genuinely permits the same code in two categories. Financial account 10025
 * and production centre 10025 are different objects, and only equipment
 * categories are reconciled here at all.
 *
 * THREE OUTCOMES, AND ONLY ONE OF THEM IS SAFE TO PERSIST.
 *   MATCHED    exactly one legacy record and exactly one node share the code
 *   AMBIGUOUS  more than one candidate on either side - left for a human
 *   UNMATCHED  no counterpart - the record stays valid and simply unlinked
 *
 * Nothing here deletes, merges or rewrites anything. It reports, and it can
 * produce a plan of the safe links; applying that plan is a separate, explicit
 * step through the existing audited master-data update.
 *
 * Pure and Firebase-free.
 */

/** Categories whose records are production equipment. Nothing else is reconciled. */
export const RECONCILABLE_EQUIPMENT_CATEGORIES = ['presses', 'furnaces', 'mills'] as const;
export type ReconcilableCategory = (typeof RECONCILABLE_EQUIPMENT_CATEGORIES)[number];

export interface LegacyEquipmentRecord {
  id: string;
  code: string;
  name?: string;
  /** Which master-data collection it came from - part of its identity. */
  categoryId: string;
  /** An existing link, if one was already set. */
  hierarchyNodeId?: string | null;
}

export interface HierarchyNodeRecord {
  id: string;
  code: string;
  name?: string;
  /** CATEGORY | DEPARTMENT | WORK_CENTER | EQUIPMENT - reported, never used to gate a match. */
  type?: string;
}

export interface MatchedPair {
  legacyId: string;
  legacyCategory: string;
  legacyCode: string;
  legacyName: string;
  hierarchyNodeId: string;
  hierarchyCode: string;
  hierarchyName: string;
  hierarchyType: string;
  /** Already linked to this exact node before reconciliation ran. */
  alreadyLinked: boolean;
  reason: string;
}

export interface AmbiguousMatch {
  code: string;
  category: string;
  legacyIds: string[];
  hierarchyNodeIds: string[];
  reason: string;
}

export interface ReconciliationReport {
  matched: MatchedPair[];
  ambiguous: AmbiguousMatch[];
  unmatchedLegacy: Array<{ id: string; code: string; name: string; category: string }>;
  unmatchedHierarchy: Array<{ id: string; code: string; name: string; type: string }>;
  counts: { matched: number; ambiguous: number; unmatchedLegacy: number; unmatchedHierarchy: number };
}

/**
 * Canonical code form - deterministic, not similarity.
 *
 * Trims, folds case, and maps Arabic-Indic digits onto ASCII so "١٠٠٢٥" and
 * "10025" are the same code. Nothing here can turn one code into a different
 * one, which is the property that separates normalisation from fuzzy matching.
 *
 * Leading zeros are deliberately NOT stripped: "0501" and "501" are different
 * codes in a chart of accounts, and collapsing them would invent a match.
 */
export function normaliseCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, '');
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export interface ReconcileOptions {
  /** Restrict to these categories. Defaults to the equipment categories. */
  categories?: readonly string[];
}

/**
 * The dry run. Reports what WOULD be linked; changes nothing.
 *
 * A legacy record already carrying a hierarchyNodeId is still reported, marked
 * `alreadyLinked`, so the audit shows the full picture rather than silently
 * omitting the rows that happen to be done.
 */
export function reconcileLegacyWithHierarchy(
  legacy: readonly LegacyEquipmentRecord[],
  nodes: readonly HierarchyNodeRecord[],
  options?: ReconcileOptions,
): ReconciliationReport {
  const allowed = new Set<string>(options?.categories ?? RECONCILABLE_EQUIPMENT_CATEGORIES);
  const eligible = legacy.filter((l) => allowed.has(l.categoryId) && normaliseCode(l.code));

  const nodesByCode = groupBy(nodes, (n) => normaliseCode(n.code));
  const legacyByCodeCategory = groupBy(eligible, (l) => `${l.categoryId}::${normaliseCode(l.code)}`);

  const matched: MatchedPair[] = [];
  const ambiguous: AmbiguousMatch[] = [];
  const unmatchedLegacy: ReconciliationReport['unmatchedLegacy'] = [];
  const consumedNodeIds = new Set<string>();

  for (const [key, records] of legacyByCodeCategory) {
    const [categoryId, code] = key.split('::');
    const candidates = nodesByCode.get(code) ?? [];

    if (candidates.length === 0) {
      for (const r of records) {
        unmatchedLegacy.push({ id: r.id, code: r.code, name: r.name ?? '', category: r.categoryId });
      }
      continue;
    }

    // Ambiguity on EITHER side blocks the link. Two legacy presses sharing a
    // code is itself a data problem, and guessing which one owns the node would
    // bury it rather than surface it.
    if (candidates.length > 1 || records.length > 1) {
      ambiguous.push({
        code,
        category: categoryId,
        legacyIds: records.map((r) => r.id),
        hierarchyNodeIds: candidates.map((c) => c.id),
        reason:
          candidates.length > 1
            ? `${candidates.length} hierarchy nodes share code "${code}"`
            : `${records.length} ${categoryId} records share code "${code}"`,
      });
      for (const c of candidates) consumedNodeIds.add(c.id);
      continue;
    }

    const record = records[0];
    const node = candidates[0];
    consumedNodeIds.add(node.id);
    matched.push({
      legacyId: record.id,
      legacyCategory: record.categoryId,
      legacyCode: record.code,
      legacyName: record.name ?? '',
      hierarchyNodeId: node.id,
      hierarchyCode: node.code,
      hierarchyName: node.name ?? '',
      hierarchyType: node.type ?? '',
      alreadyLinked: String(record.hierarchyNodeId ?? '') === node.id,
      reason: `exact code "${code}" within category "${categoryId}", exactly one candidate on each side`,
    });
  }

  const unmatchedHierarchy = nodes
    .filter((n) => normaliseCode(n.code) && !consumedNodeIds.has(n.id))
    .map((n) => ({ id: n.id, code: n.code, name: n.name ?? '', type: n.type ?? '' }));

  return {
    matched,
    ambiguous,
    unmatchedLegacy,
    unmatchedHierarchy,
    counts: {
      matched: matched.length,
      ambiguous: ambiguous.length,
      unmatchedLegacy: unmatchedLegacy.length,
      unmatchedHierarchy: unmatchedHierarchy.length,
    },
  };
}

export interface SafeLink {
  legacyId: string;
  categoryId: string;
  hierarchyNodeId: string;
  code: string;
}

/**
 * The links that are safe to write: unambiguous, and not already set.
 *
 * Ambiguous rows are absent by construction - they never reach this function -
 * so there is no way for a caller to persist a guess.
 */
export function safeLinkPlan(report: ReconciliationReport): SafeLink[] {
  return report.matched
    .filter((m) => !m.alreadyLinked)
    .map((m) => ({
      legacyId: m.legacyId,
      categoryId: m.legacyCategory,
      hierarchyNodeId: m.hierarchyNodeId,
      code: m.legacyCode,
    }));
}

/**
 * Fills in hierarchy links from the reconciliation WITHOUT writing anything.
 *
 * This is what makes a leaf resolve to its equipment before an administrator
 * has applied the plan: the resolver is handed equipment whose link is already
 * known from the code match. An explicit stored link always wins - a human
 * decision is never overridden by a derived one.
 */
export function applyReconciliationToEquipment<T extends { id?: string; hierarchyNodeId?: string | null }>(
  equipment: readonly T[],
  report: ReconciliationReport,
): T[] {
  const byLegacyId = new Map(report.matched.map((m) => [m.legacyId, m.hierarchyNodeId]));
  return equipment.map((e) => {
    if (e.hierarchyNodeId) return e;
    const derived = byLegacyId.get(String(e.id ?? ''));
    return derived ? { ...e, hierarchyNodeId: derived } : e;
  });
}

/** Bilingual one-line summary for the Master Data banner. */
export function summariseReconciliation(report: ReconciliationReport, language: 'ar' | 'en'): string {
  const { matched, ambiguous, unmatchedLegacy } = report.counts;
  return language === 'ar'
    ? `مطابق: ${matched} — يحتاج مراجعة: ${ambiguous} — بدون مقابل: ${unmatchedLegacy}`
    : `Matched: ${matched} — needs review: ${ambiguous} — no counterpart: ${unmatchedLegacy}`;
}

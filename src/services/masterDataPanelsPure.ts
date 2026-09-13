/**
 * Master Data navigation and the cost-centre sub-classification.
 *
 * One navigation row, one active category, and - for cost centres - the
 * 5/6/7/8/9 classification applied inline. The multi-select panel this file
 * once backed was removed: it offered the same categories as the row beneath
 * it, so a category had to be chosen twice.
 *
 * This module renders nothing and fetches nothing.
 *
 * THE COST-CENTRE RULE IS NOT INVENTED HERE.
 * The 5/6/7/8/9 classification already exists: `ROOT_CATEGORY_CODES` and
 * `ROOT_CATEGORY_LABELS` in costCenterHierarchyPure.ts, derived from the real
 * Sheet1 import, where a code's root is its FIRST CHARACTER (`code[0]`). This
 * file re-exports and applies that rule rather than restating it, so the two
 * can never drift apart.
 *
 * A consequence worth stating: a code whose first character is not one of those
 * five digits has NO root category. "0501" is not a 5 - the leading zero is
 * significant and is never stripped to force a match. Such codes are reported
 * as unclassified rather than filed under a category they do not belong to.
 *
 * Pure and Firebase-free.
 */
import { ROOT_CATEGORY_CODES, ROOT_CATEGORY_LABELS } from './costCenterHierarchyPure';
import { MasterDataCategory, getCategory } from './masterDataCategoryRegistry';

/** Re-exported so callers use one definition of the rule, never a copy. */
export { ROOT_CATEGORY_CODES, ROOT_CATEGORY_LABELS };

/**
 * The primary Master Data categories - the whole navigation, in order.
 *
 * Ids only; every label, collection, code field and tab comes from the shared
 * registry, so adding a category is a registry edit and not a change here.
 *
 * WHAT IS DELIBERATELY ABSENT, and why:
 *
 *   presses / furnaces / mills   These are production EQUIPMENT. Their current
 *                                organisational representation lives inside the
 *                                cost-centre hierarchy, and they remain fully
 *                                available through the equipment -> hierarchyNodeId
 *                                relationship that Production Records, Reports
 *                                and the assistant already use. Listing them
 *                                again here presented the same machines as a
 *                                second, competing master source.
 *
 *   costCenters (departments)    The legacy flat list. The imported hierarchy
 *                                below supersedes it as the user-facing source;
 *                                the collection itself is untouched and still
 *                                backs the employee department picker and every
 *                                historical reference.
 *
 * Nothing is deleted by their absence - this is which source the screen shows,
 * not which data exists.
 */
export const PANEL_CATEGORY_IDS = [
  'products',
  'customers',
  'materials',
  'employees',
  'shifts',
  'financialAccounts',
  // The imported hierarchy IS the cost-centre master data now.
  'hierarchicalCostCenters',
] as const;

export type PanelCategoryId = (typeof PANEL_CATEGORY_IDS)[number];

/**
 * The category whose records carry the 5/6/7/8/9 classification.
 *
 * The hierarchy, not the legacy `departments` list: its codes are the ones the
 * Sheet1 import classified, so the root rule applies to them directly.
 */
export const COST_CENTER_CATEGORY_ID = 'hierarchicalCostCenters';

/** The field holding a cost-centre code on those records. */
export const COST_CENTER_CODE_FIELD = 'sheet1Code';

export function panelCategories(): MasterDataCategory[] {
  return PANEL_CATEGORY_IDS.map((id) => getCategory(id)).filter((c): c is MasterDataCategory => Boolean(c));
}

// --- Cost-centre sub-categories ----------------------------------------------

export interface CostCenterSubCategory {
  digit: string;
  labelAr: string;
}

/** The five sub-categories, straight from the existing rule. */
export function costCenterSubCategories(): CostCenterSubCategory[] {
  return ROOT_CATEGORY_CODES.map((digit) => ({ digit, labelAr: ROOT_CATEGORY_LABELS[digit] ?? digit }));
}

/**
 * The root digit of a cost-centre code, or null when it has none.
 *
 * Whitespace is trimmed; nothing else is altered. Leading zeros are preserved,
 * so "0501" yields null rather than "5" - classifying it as a production centre
 * would be inventing membership the code does not claim.
 */
export function costCenterRootDigit(code: unknown): string | null {
  const trimmed = String(code ?? '').trim();
  if (!trimmed) return null;
  const first = trimmed[0];
  return (ROOT_CATEGORY_CODES as readonly string[]).includes(first) ? first : null;
}

/**
 * Filters cost-centre records by the ticked sub-categories.
 *
 * An empty selection means no narrowing at all - the same "nothing ticked is
 * not a filter" rule used everywhere else in this codebase.
 */
export function filterByCostCenterSubCategories<T extends Record<string, any>>(
  records: readonly T[],
  digits: readonly string[],
  codeField = 'code',
): T[] {
  if (digits.length === 0) return [...records];
  const wanted = new Set(digits);
  return records.filter((r) => {
    const root = costCenterRootDigit(r[codeField]);
    return root != null && wanted.has(root);
  });
}

/**
 * How many records fall under each sub-category, plus how many fall under none.
 *
 * `unclassified` is reported rather than hidden: codes outside 5-9 exist in the
 * real data and a user looking at a total needs to know they are not in any of
 * the five buckets.
 */
export function costCenterSubCategoryCounts<T extends Record<string, any>>(
  records: readonly T[],
  codeField = 'code',
): { byDigit: Record<string, number>; unclassified: number; total: number } {
  const byDigit: Record<string, number> = {};
  for (const digit of ROOT_CATEGORY_CODES) byDigit[digit] = 0;
  let unclassified = 0;

  for (const record of records) {
    const root = costCenterRootDigit(record[codeField]);
    if (root == null) unclassified += 1;
    else byDigit[root] += 1;
  }

  return { byDigit, unclassified, total: records.length };
}

/** Ticks every sub-category digit. */
export function selectAllSubCategories(): string[] {
  return [...ROOT_CATEGORY_CODES];
}

export function toggleSubCategory(digits: readonly string[], digit: string): string[] {
  const set = new Set(digits);
  if (set.has(digit)) set.delete(digit);
  else set.add(digit);
  // Kept in the canonical 5..9 order rather than click order, so the UI is stable.
  return ROOT_CATEGORY_CODES.filter((d) => set.has(d));
}

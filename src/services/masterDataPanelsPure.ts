/**
 * Master Data three-panel organisation - the SELECTION STATE.
 *
 * Area 1 picks which top-level categories are in play, Area 2 shows exactly
 * those, and Area 3 shows the data of whichever one is active. This module owns
 * that state and the cost-centre sub-classification; it renders nothing and
 * fetches nothing.
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
 * The top-level categories Area 1 offers.
 *
 * Ids only - every label, collection, code field and tab comes from the shared
 * registry, so adding a category is a registry edit and not a change here.
 */
export const PANEL_CATEGORY_IDS = [
  'products',
  'customers',
  'materials',
  'employees',
  'financialAccounts',
  'shifts',
  'costCenters',
] as const;

export type PanelCategoryId = (typeof PANEL_CATEGORY_IDS)[number];

/** The category id whose records carry the 5/6/7/8/9 cost-centre classification. */
export const COST_CENTER_CATEGORY_ID = 'costCenters';

export function panelCategories(): MasterDataCategory[] {
  return PANEL_CATEGORY_IDS.map((id) => getCategory(id)).filter((c): c is MasterDataCategory => Boolean(c));
}

// --- Area 1 / Area 2 selection ----------------------------------------------

export interface PanelSelection {
  /** Ticked in Area 1, and therefore shown in Area 2. */
  selectedCategoryIds: string[];
  /** Whose data Area 3 shows. Null when nothing is selected. */
  activeCategoryId: string | null;
}

export const EMPTY_PANEL_SELECTION: PanelSelection = { selectedCategoryIds: [], activeCategoryId: null };

/**
 * Ticks or unticks one category.
 *
 * Two rules that keep the three areas consistent:
 *   - ticking the first category makes it active, so Area 3 is never blank while
 *     something is selected;
 *   - unticking the ACTIVE one moves focus to another selected category rather
 *     than leaving Area 3 showing a category that is no longer in Area 2.
 */
export function toggleCategory(selection: PanelSelection, categoryId: string): PanelSelection {
  const selected = new Set(selection.selectedCategoryIds);

  if (selected.has(categoryId)) {
    selected.delete(categoryId);
    const remaining = PANEL_CATEGORY_IDS.filter((id) => selected.has(id));
    const active =
      selection.activeCategoryId === categoryId
        ? remaining[0] ?? null // focus moves; never left pointing at a removed category
        : selection.activeCategoryId;
    return { selectedCategoryIds: remaining, activeCategoryId: active };
  }

  selected.add(categoryId);
  const remaining = PANEL_CATEGORY_IDS.filter((id) => selected.has(id));
  return {
    selectedCategoryIds: remaining,
    activeCategoryId: selection.activeCategoryId ?? categoryId,
  };
}

/** Ticks every category. The first becomes active if none was. */
export function selectAllCategories(selection: PanelSelection): PanelSelection {
  return {
    selectedCategoryIds: [...PANEL_CATEGORY_IDS],
    activeCategoryId: selection.activeCategoryId ?? PANEL_CATEGORY_IDS[0],
  };
}

/** Back to nothing selected - Area 2 empty, Area 3 showing its empty state. */
export function clearCategories(): PanelSelection {
  return EMPTY_PANEL_SELECTION;
}

/** Makes a category active. Refuses one that is not selected, so Area 3 can never diverge from Area 2. */
export function setActiveCategory(selection: PanelSelection, categoryId: string): PanelSelection {
  if (!selection.selectedCategoryIds.includes(categoryId)) return selection;
  return { ...selection, activeCategoryId: categoryId };
}

export function isCategorySelected(selection: PanelSelection, categoryId: string): boolean {
  return selection.selectedCategoryIds.includes(categoryId);
}

/** True when Area 3 should show its "choose a code type" state. */
export function isEmptyState(selection: PanelSelection): boolean {
  return selection.selectedCategoryIds.length === 0 || selection.activeCategoryId == null;
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

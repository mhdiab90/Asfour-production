/**
 * Dashboard cost-centre scope and metric mode - one definition for both
 * Dashboards.
 *
 * The classic Dashboard and the Custom Dashboard Builder used to each carry
 * their own organisational filter, and both were a flat list of legacy presses.
 * This module is the single place that turns a cost-centre selection into a
 * scope, so the two screens cannot disagree about what "Presses" includes.
 *
 * NOTHING HERE WALKS A TREE. Every descendant and every equipment lookup goes
 * through the shared resolver (hierarchyResolverPure / productionFilterEnginePure)
 * that Production Records, Reports and the assistant already use.
 *
 * TWO SCOPES, BECAUSE THERE ARE TWO DATASETS.
 * A cost-centre selection means different concrete things for the two measures:
 *
 *   QUANTITY   production records name EQUIPMENT (pressId / furnaceId), not a
 *              cost centre - so the selection resolves node -> descendants ->
 *              linked equipment ids, and filters records by those
 *   FINANCIAL  a transaction names its cost centre directly - so the selection
 *              resolves node -> descendants -> cost-centre codes
 *
 * They share the selection and the date range. They are never joined row by
 * row, and their numbers are never added together.
 *
 * Pure and Firebase-free.
 */
import {
  EquipmentLink,
  HierarchyIndex,
  HierarchyNodeInput,
  getAncestorIds,
  getChildIds,
  resolveHierarchySelection,
  resolveMultipleHierarchySelections,
} from './hierarchyResolverPure';
import { normaliseLookupText } from './hierarchyNodeLookupPure';
import { resolveHierarchyEquipmentScope } from './productionFilterEnginePure';
import { costCenterRootDigit, costCenterSubCategories } from './masterDataPanelsPure';

// --- Metric mode -------------------------------------------------------------

export type DashboardMetricMode = 'QUANTITY' | 'FINANCIAL' | 'BOTH';

/**
 * Two checkboxes to one mode.
 *
 * Unticking both is not a valid state - a Dashboard showing nothing is not a
 * choice anyone makes - so it falls back to QUANTITY, the measure the Dashboard
 * has always shown.
 */
export function metricModeFromFlags(quantity: boolean, financial: boolean): DashboardMetricMode {
  if (quantity && financial) return 'BOTH';
  if (financial) return 'FINANCIAL';
  return 'QUANTITY';
}

export function metricFlags(mode: DashboardMetricMode): { quantity: boolean; financial: boolean } {
  return { quantity: mode !== 'FINANCIAL', financial: mode !== 'QUANTITY' };
}

// --- Scope ---------------------------------------------------------------------

/**
 * The equipment ids a cost-centre selection covers - for QUANTITY.
 *
 * null when nothing is selected, so the Dashboard keeps its existing behaviour
 * exactly. An EMPTY set when something is selected but no equipment is linked
 * beneath it, which the UI states rather than showing a bare zero.
 */
export function resolveCostCenterProductionScope<T extends HierarchyNodeInput>(
  nodeIds: readonly string[],
  index: HierarchyIndex<T>,
  equipment: readonly EquipmentLink[],
): Set<string> | null {
  if (nodeIds.length === 0) return null;
  return resolveHierarchyEquipmentScope(
    nodeIds.map((id) => `node:${id}`),
    { index },
    { equipment },
  );
}

/**
 * The cost-centre codes a selection covers - for FINANCIAL.
 *
 * The selected nodes plus every descendant, as codes, because a transaction
 * references its cost centre by code. Parent + descendant selected together
 * collapse to one set, so a transaction is counted once.
 */
export function resolveCostCenterCodeScope<T extends HierarchyNodeInput>(
  nodeIds: readonly string[],
  index: HierarchyIndex<T>,
): Set<string> | null {
  if (nodeIds.length === 0) return null;
  const ids = resolveMultipleHierarchySelections(index, nodeIds, { includeSelf: true });
  const codes = new Set<string>();
  for (const id of ids) {
    const node = index.byId.get(id) as Record<string, any> | undefined;
    const code = String(node?.code ?? node?.sheet1Code ?? id).trim();
    if (code) codes.add(code);
  }
  return codes;
}

// --- Selector options ------------------------------------------------------------

export interface ClassificationGroup {
  digit: string;
  labelAr: string;
  /** Root nodes of the hierarchy whose code starts with this digit. */
  rootIds: string[];
}

/**
 * The hierarchy's roots grouped under 5/6/7/8/9.
 *
 * The labels and digits are the existing Sheet1 rule (reused through
 * masterDataPanelsPure, which re-exports ROOT_CATEGORY_CODES/LABELS) - never a
 * second copy. A root whose code does not start with one of those digits is
 * not forced into a group.
 */
export function classificationGroups<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  codeOf: (node: T) => string,
): ClassificationGroup[] {
  return costCenterSubCategories().map((sub) => ({
    digit: sub.digit,
    labelAr: sub.labelAr,
    rootIds: index.rootIds.filter((id) => {
      const node = index.byId.get(id);
      return node ? costCenterRootDigit(codeOf(node)) === sub.digit : false;
    }),
  }));
}

// --- Filter applicability ---------------------------------------------------------

/**
 * Which filters are meaningful for which dataset.
 *
 * Production records carry product, customer, shift and stage; financial
 * transactions carry an account and a cost centre. Applying a production-only
 * filter to money would narrow it by a relationship it does not have, so the
 * Dashboard asks here instead of guessing.
 */
export const FILTER_APPLICABILITY = {
  QUANTITY: ['date', 'stage', 'costCenter', 'product', 'customer', 'shift', 'employee'],
  FINANCIAL: ['date', 'costCenter', 'account'],
} as const;

export function filterAppliesTo(filter: string, dataset: 'QUANTITY' | 'FINANCIAL'): boolean {
  return (FILTER_APPLICABILITY[dataset] as readonly string[]).includes(filter);
}

// --- Selector search -------------------------------------------------------------

/*
 * Search and selection for the cost-centre selector. UI state only: nothing
 * here reads or writes anything, and every descendant, ancestor and child comes
 * from the shared resolver over the hierarchy that is already loaded.
 */

/** The texts a node can be found by: its code and every name it carries. */
function searchableTexts(node: Record<string, any>): string[] {
  return [node.sheet1Code, node.code, node.name, node.nameAr, node.nameEn, node.displayName]
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => normaliseLookupText(v));
}

/**
 * Case-insensitive for English, tolerant of repeated or missing spaces, and
 * of the Arabic spelling variants the shared lookup normaliser already folds
 * (diacritics, alef forms, ya/alef maqsura, ta marbuta).
 */
export function costCenterNodeMatches(node: Record<string, any>, query: string): boolean {
  const q = normaliseLookupText(query);
  if (!q) return true;
  const qCompact = q.replace(/ /g, '');
  return searchableTexts(node).some((text) => text.includes(q) || text.replace(/ /g, '').includes(qCompact));
}

export interface CostCenterSearchResult {
  /** Nodes whose own code or name matches. */
  matchedIds: Set<string>;
  /**
   * What to render: the matches, their ancestors (so a child is shown where it
   * belongs) and their descendants (so a matched parent shows its scope).
   * null = no search, render everything.
   */
  visibleIds: Set<string> | null;
}

export function searchCostCenterNodes<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  query: string,
): CostCenterSearchResult {
  if (!normaliseLookupText(query)) return { matchedIds: new Set(), visibleIds: null };
  const matchedIds = new Set<string>();
  for (const [id, node] of index.byId) {
    if (costCenterNodeMatches(node as Record<string, any>, query)) matchedIds.add(id);
  }
  const visibleIds = new Set<string>(resolveMultipleHierarchySelections(index, [...matchedIds], { includeSelf: true }));
  for (const id of matchedIds) {
    for (const ancestor of getAncestorIds(index, id)) visibleIds.add(ancestor);
  }
  return { matchedIds, visibleIds };
}

// --- Recursive checkbox selection ---------------------------------------------------

export type CostCenterCheckState = 'checked' | 'indeterminate' | 'unchecked';

/**
 * The selection as the full set of nodes it covers.
 *
 * A stored id always means that node AND its whole branch, which is also how
 * the production and financial scopes read it - so a selection saved as just a
 * parent still shows every descendant ticked.
 */
export function effectiveCostCenterSelection<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selectedIds: readonly string[],
): Set<string> {
  return new Set(resolveMultipleHierarchySelections(index, selectedIds, { includeSelf: true }));
}

/** checked = the whole branch is selected; indeterminate = part of it; unchecked = none. */
export function costCenterCheckState<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  effective: ReadonlySet<string>,
  nodeId: string,
): CostCenterCheckState {
  const branch = resolveHierarchySelection(index, nodeId, { includeSelf: true });
  if (branch.length === 0) return effective.has(nodeId) ? 'checked' : 'unchecked';
  let hit = 0;
  for (const id of branch) if (effective.has(id)) hit += 1;
  if (hit === 0) return 'unchecked';
  return hit === branch.length ? 'checked' : 'indeterminate';
}

/**
 * Walks up from a node and ticks each ancestor whose children are now ALL
 * selected, stopping at the first that is not. The selection stays closed
 * downward (a selected node's branch is always entirely selected), so checking
 * the direct children is enough.
 */
function promoteAncestors<T extends HierarchyNodeInput>(index: HierarchyIndex<T>, effective: Set<string>, nodeId: string): void {
  for (const ancestor of getAncestorIds(index, nodeId).reverse()) {
    const children = getChildIds(index, ancestor);
    if (children.length > 0 && children.every((c) => effective.has(c))) effective.add(ancestor);
    else break;
  }
}

/**
 * One checkbox click.
 *
 * Checking selects the node and its ENTIRE branch from the full hierarchy -
 * never just the rows a search left visible. Unchecking removes that branch
 * and un-ticks its ancestors (they are no longer fully selected), and nothing
 * in any other branch. Returns ids, deduplicated.
 */
export function toggleCostCenterNode<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selectedIds: readonly string[],
  nodeId: string,
): string[] {
  const effective = effectiveCostCenterSelection(index, selectedIds);
  const branch = resolveHierarchySelection(index, nodeId, { includeSelf: true });
  if (branch.length === 0) return [...effective];

  if (costCenterCheckState(index, effective, nodeId) === 'checked') {
    for (const id of branch) effective.delete(id);
    for (const ancestor of getAncestorIds(index, nodeId)) effective.delete(ancestor);
  } else {
    for (const id of branch) effective.add(id);
    promoteAncestors(index, effective, nodeId);
  }
  return [...effective];
}

/** Select All: every target with its full branch, added to - never replacing - the selection. */
export function selectAllCostCenterNodes<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selectedIds: readonly string[],
  targetIds: readonly string[],
): string[] {
  const effective = effectiveCostCenterSelection(index, selectedIds);
  for (const id of resolveMultipleHierarchySelections(index, targetIds, { includeSelf: true })) effective.add(id);
  for (const id of targetIds) promoteAncestors(index, effective, id);
  return [...effective];
}

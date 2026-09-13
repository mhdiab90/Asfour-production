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
  resolveMultipleHierarchySelections,
} from './hierarchyResolverPure';
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

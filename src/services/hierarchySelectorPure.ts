/**
 * Multi-level hierarchy selector - the SELECTION STATE, not the traversal.
 *
 * This module owns what the user has drilled into and ticked. Every question
 * about the shape of the tree ("what are the roots", "what are this node's
 * children", "what equipment hangs below here") is delegated to the shared
 * resolver in hierarchyResolverPure. There is no second traversal here, and
 * adding one would be the bug this file is written to avoid.
 *
 * THE SEMANTIC RULE THAT MATTERS (and the one easiest to get wrong):
 *
 *   drilled to a node, nothing ticked  ->  the WHOLE branch below that node
 *   drilled to a node, some ticked     ->  ONLY what is ticked
 *
 * Those two must never blend. Combining "everything under Presses" with "and
 * also these two specific machines" silently widens the result past what the
 * user asked for, so an explicit tick always narrows and never adds.
 *
 * Depth is whatever the data has. Nothing here counts levels, caps them at
 * three, or knows the name of a single production centre.
 *
 * Pure and Firebase-free.
 */
import {
  EquipmentByNode,
  HierarchyIndex,
  HierarchyNodeInput,
  getChildIds,
  getNodePath,
  resolveEquipmentForHierarchyNodes,
} from './hierarchyResolverPure';

export interface HierarchySelection {
  /**
   * The drilled path, root first. `path[0]` is the level-1 node, `path[1]` its
   * chosen child, and so on - so the path length IS the current depth, and no
   * level count is hard-coded anywhere.
   */
  path: string[];
  /** Explicitly ticked equipment ids. Empty means "the whole current branch". */
  equipmentIds: string[];
}

export const EMPTY_HIERARCHY_SELECTION: HierarchySelection = { path: [], equipmentIds: [] };

/** The node the user has drilled to, or null while still at the top. */
export function currentNodeId(selection: HierarchySelection): string | null {
  return selection.path.length > 0 ? selection.path[selection.path.length - 1] : null;
}

/**
 * The options to render at each level, in order.
 *
 * Level 1 is the hierarchy's own roots; every later level is exactly the
 * children of the node chosen above it - never a flat list, and never another
 * branch's children. A trailing level is included only when the chosen node
 * actually has children, so the UI stops rendering selectors at a leaf instead
 * of showing an empty dropdown.
 */
export function levelOptions<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selection: HierarchySelection,
): Array<{ level: number; parentId: string | null; optionIds: string[]; selectedId: string | null }> {
  const levels: Array<{ level: number; parentId: string | null; optionIds: string[]; selectedId: string | null }> = [];

  levels.push({ level: 1, parentId: null, optionIds: [...index.rootIds], selectedId: selection.path[0] ?? null });

  for (let depth = 0; depth < selection.path.length; depth++) {
    const parentId = selection.path[depth];
    const children = getChildIds(index, parentId);
    if (children.length === 0) break; // a leaf - no further selector to draw
    levels.push({
      level: depth + 2,
      parentId,
      optionIds: children,
      selectedId: selection.path[depth + 1] ?? null,
    });
  }

  return levels;
}

/**
 * Chooses a node at one level.
 *
 * Everything below that level is discarded, because it belonged to a different
 * branch. Keeping it would let a stale level-3 choice survive under a newly
 * chosen level-2 parent - the leak §33's TEST P8 is about. Ticked equipment is
 * cleared for the same reason: it was ticked inside the old branch.
 *
 * Choosing the empty value at a level clears that level and everything under it.
 */
export function selectAtLevel(
  selection: HierarchySelection,
  level: number,
  nodeId: string | null,
): HierarchySelection {
  const keep = Math.max(0, level - 1);
  const path = selection.path.slice(0, keep);
  if (nodeId) path.push(nodeId);
  return { path, equipmentIds: [] };
}

/**
 * Steps back one level.
 *
 * Only the deepest level is dropped; the levels above it are left alone, so
 * going up does not throw away the navigation the user still wants. Ticked
 * equipment is cleared because it was chosen inside the branch being left.
 */
export function goBack(selection: HierarchySelection): HierarchySelection {
  if (selection.path.length === 0) return EMPTY_HIERARCHY_SELECTION;
  return { path: selection.path.slice(0, -1), equipmentIds: [] };
}

/** Back to neutral - which must mean "no narrowing", never "everything selected". */
export function clearSelection(): HierarchySelection {
  return EMPTY_HIERARCHY_SELECTION;
}

/**
 * Every equipment id under the branch the user has drilled to.
 *
 * This is what the checkbox list shows, and what "select all" ticks. Resolved
 * through the shared resolver, so it is the node plus all of its descendants at
 * any depth - never just the node's direct children.
 *
 * An empty path means nothing has been drilled into, so there is no branch and
 * no list.
 */
export function equipmentUnderSelection<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  byNode: EquipmentByNode,
  selection: HierarchySelection,
): string[] {
  const nodeId = currentNodeId(selection);
  if (!nodeId) return [];
  return resolveEquipmentForHierarchyNodes(index, byNode, [nodeId], { includeSelf: true });
}

export function toggleEquipment(selection: HierarchySelection, equipmentId: string): HierarchySelection {
  const set = new Set(selection.equipmentIds);
  if (set.has(equipmentId)) set.delete(equipmentId);
  else set.add(equipmentId);
  return { ...selection, equipmentIds: [...set] };
}

/** Ticks every piece of equipment under the CURRENT branch - never the whole system. */
export function selectAllEquipment<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  byNode: EquipmentByNode,
  selection: HierarchySelection,
): HierarchySelection {
  return { ...selection, equipmentIds: equipmentUnderSelection(index, byNode, selection) };
}

export function deselectAllEquipment(selection: HierarchySelection): HierarchySelection {
  return { ...selection, equipmentIds: [] };
}

/**
 * The equipment the filter should actually use.
 *
 * The whole semantic rule, in one place:
 *
 *   no branch drilled      -> null  (no narrowing at all; the screen behaves
 *                             exactly as it did before anything was selected)
 *   branch, nothing ticked -> the entire branch
 *   branch, some ticked    -> only those, and only the ones genuinely inside
 *                             the branch
 *
 * The intersection in the last case is the safety boundary. A tick left over
 * from another branch can never widen the result, which is what keeps "select,
 * navigate away, filter" from quietly including something the user can no
 * longer see.
 */
export function resolveSelectedEquipment<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  byNode: EquipmentByNode,
  selection: HierarchySelection,
): string[] | null {
  const branch = equipmentUnderSelection(index, byNode, selection);
  if (currentNodeId(selection) == null) return null;
  if (selection.equipmentIds.length === 0) return branch;
  const inBranch = new Set(branch);
  return selection.equipmentIds.filter((id) => inBranch.has(id));
}

/** Readable breadcrumb for the current path. Labels come from the data, never from a constant. */
export function selectionPathLabels<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selection: HierarchySelection,
  labelOf: (node: T) => string,
): string[] {
  return selection.path.map((id) => {
    const node = index.byId.get(id);
    return node ? labelOf(node) : id;
  });
}

/** Full root-first path of the current node, for a one-line scope display. */
export function selectionPathText<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selection: HierarchySelection,
  labelOf: (node: T) => string,
  separator = ' ← ',
): string {
  const nodeId = currentNodeId(selection);
  if (!nodeId) return '';
  return getNodePath(index, nodeId, labelOf, separator);
}

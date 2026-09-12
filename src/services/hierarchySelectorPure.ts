/**
 * Multi-level hierarchy selector - the SELECTION STATE, not the traversal.
 *
 * Every question about the shape of the tree ("what are the roots", "what are
 * these nodes' children", "what equipment hangs below here") is delegated to
 * the shared resolver in hierarchyResolverPure. There is no second traversal
 * here, and adding one would be the bug this file exists to avoid.
 *
 * EVERY LEVEL IS MULTI-SELECT. `levels[0]` holds the ticked roots, `levels[1]`
 * the ticked nodes chosen from the union of those roots' children, and so on.
 * Depth is whatever the data has; nothing counts levels or caps them.
 *
 * TWO RULES THAT DECIDE WHAT THE FILTER MEANS:
 *
 *  1. A DEEPER TICK NARROWS. The effective scope is the deepest level that has
 *     anything ticked. Ticking "Presses" then ticking "Bo-kher Presses" beneath
 *     it means Bo-kher, not Presses - which is also why a parent and its own
 *     child can never double-count: only one of them is ever in play.
 *
 *  2. EXPLICIT EQUIPMENT NARROWS FURTHER. With equipment ticked, the scope is
 *     exactly those - intersected with the branch, so a tick left over from a
 *     branch that has since been unticked can only ever shrink the result.
 *
 * A LEAF CAN BE THE EQUIPMENT. Having no children says nothing about whether a
 * node has equipment: the equipment link is a separate fact. So "no children"
 * is never treated as "no equipment" anywhere in this file.
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
  /** Ticked node ids per level, level 1 first. Length IS the depth in play. */
  levels: string[][];
  /** Explicitly ticked equipment ids. Empty means "everything in the branch". */
  equipmentIds: string[];
}

export const EMPTY_HIERARCHY_SELECTION: HierarchySelection = { levels: [], equipmentIds: [] };

function ticked(selection: HierarchySelection, level: number): string[] {
  return selection.levels[level - 1] ?? [];
}

/**
 * The deepest level with anything ticked - the level that defines the scope.
 * 0 when nothing is ticked at all.
 */
export function effectiveLevel(selection: HierarchySelection): number {
  for (let i = selection.levels.length; i >= 1; i--) {
    if ((selection.levels[i - 1] ?? []).length > 0) return i;
  }
  return 0;
}

/** The nodes actually in play: the ticks at the deepest ticked level. */
export function effectiveNodeIds(selection: HierarchySelection): string[] {
  const level = effectiveLevel(selection);
  return level === 0 ? [] : [...ticked(selection, level)];
}

/**
 * The options to render at each level, in order.
 *
 * Level 1 is the hierarchy's own roots. Every later level is the UNION of the
 * direct children of the nodes ticked above it - so ticking two sibling
 * branches shows both branches' children together, and nothing from a branch
 * that was not ticked.
 *
 * A level is only offered when the level above it actually produced children,
 * so the UI stops rendering selectors at a leaf instead of showing an empty one.
 */
export function levelOptions<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selection: HierarchySelection,
): Array<{ level: number; optionIds: string[]; selectedIds: string[] }> {
  const levels: Array<{ level: number; optionIds: string[]; selectedIds: string[] }> = [];

  let options = [...index.rootIds];
  let level = 1;

  while (options.length > 0) {
    const selectedIds = ticked(selection, level).filter((id) => options.includes(id));
    levels.push({ level, optionIds: options, selectedIds });
    if (selectedIds.length === 0) break; // nothing ticked here, so no next level

    const next: string[] = [];
    const seen = new Set<string>();
    for (const parentId of selectedIds) {
      for (const childId of getChildIds(index, parentId)) {
        if (seen.has(childId)) continue; // union, deduplicated
        seen.add(childId);
        next.push(childId);
      }
    }
    options = next;
    level += 1;
  }

  return levels;
}

/**
 * Drops ticks that the levels above no longer justify.
 *
 * Unticking a root must take its descendants' ticks with it, otherwise a
 * selection from an abandoned branch survives invisibly and widens the filter.
 * Applied from the top down, so one untick cascades the whole way.
 *
 * Equipment ticks are kept here and filtered against the branch at resolve
 * time - they can only ever narrow, so a stale one is harmless and reversible
 * if the user re-ticks the branch.
 */
export function reconcileLevels<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selection: HierarchySelection,
): HierarchySelection {
  const out: string[][] = [];
  let allowed = new Set(index.rootIds);

  for (let level = 1; level <= selection.levels.length; level++) {
    const kept = ticked(selection, level).filter((id) => allowed.has(id));
    if (kept.length === 0) break; // nothing survives here, so nothing below can either
    out.push(kept);
    const next = new Set<string>();
    for (const id of kept) for (const child of getChildIds(index, id)) next.add(child);
    allowed = next;
  }

  return { levels: out, equipmentIds: selection.equipmentIds };
}

/** Ticks or unticks one node at one level, then cascades the consequences. */
export function toggleAtLevel<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selection: HierarchySelection,
  level: number,
  nodeId: string,
): HierarchySelection {
  const levels = selection.levels.map((l) => [...l]);
  while (levels.length < level) levels.push([]);
  const current = new Set(levels[level - 1]);
  if (current.has(nodeId)) current.delete(nodeId);
  else current.add(nodeId);
  levels[level - 1] = [...current];
  // A change at this level invalidates equipment ticked under the old branch.
  return reconcileLevels(index, { levels, equipmentIds: [] });
}

/**
 * Ticks every node CURRENTLY VISIBLE at one level.
 *
 * Visible means the options that level is actually offering - the children of
 * what is ticked above it - never every node in the hierarchy.
 */
export function selectAllAtLevel<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selection: HierarchySelection,
  level: number,
): HierarchySelection {
  const options = levelOptions(index, selection).find((l) => l.level === level);
  if (!options) return selection;
  const levels = selection.levels.map((l) => [...l]);
  while (levels.length < level) levels.push([]);
  levels[level - 1] = [...options.optionIds];
  return reconcileLevels(index, { levels, equipmentIds: [] });
}

/** Clears one level and everything the levels below it depended on. */
export function clearLevel<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selection: HierarchySelection,
  level: number,
): HierarchySelection {
  const levels = selection.levels.slice(0, Math.max(0, level - 1));
  return reconcileLevels(index, { levels, equipmentIds: [] });
}

/** Back to neutral - which must mean "no narrowing", never "everything selected". */
export function clearSelection(): HierarchySelection {
  return EMPTY_HIERARCHY_SELECTION;
}

/**
 * Every equipment id reachable from the nodes currently in play.
 *
 * Goes through the shared resolver, so it is each node PLUS all of its
 * descendants at any depth - and a leaf with no children resolves to the
 * equipment linked to the leaf itself. Overlapping branches deduplicate.
 */
export function equipmentUnderSelection<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  byNode: EquipmentByNode,
  selection: HierarchySelection,
): string[] {
  const nodeIds = effectiveNodeIds(selection);
  if (nodeIds.length === 0) return [];
  return resolveEquipmentForHierarchyNodes(index, byNode, nodeIds, { includeSelf: true });
}

export function toggleEquipment(selection: HierarchySelection, equipmentId: string): HierarchySelection {
  const set = new Set(selection.equipmentIds);
  if (set.has(equipmentId)) set.delete(equipmentId);
  else set.add(equipmentId);
  return { ...selection, equipmentIds: [...set] };
}

/** Ticks every piece of equipment under the CURRENT scope - never the whole system. */
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
 *   nothing ticked        -> null  (no narrowing at all; the screen behaves
 *                            exactly as it did before anything was selected)
 *   nodes, no equipment   -> everything under those nodes
 *   nodes and equipment   -> exactly those, intersected with the branch
 *
 * The intersection is the safety boundary: an equipment tick can only ever
 * narrow, so one left behind by a branch change cannot widen the result.
 */
export function resolveSelectedEquipment<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  byNode: EquipmentByNode,
  selection: HierarchySelection,
): string[] | null {
  if (effectiveLevel(selection) === 0) return null;
  const branch = equipmentUnderSelection(index, byNode, selection);
  if (selection.equipmentIds.length === 0) return branch;
  const inBranch = new Set(branch);
  return selection.equipmentIds.filter((id) => inBranch.has(id));
}

/**
 * Whether a node is a usable selection target.
 *
 * True when it has children (a group to drill into) OR equipment resolves from
 * it (it is, or contains, real equipment). A childless node linked to equipment
 * is therefore a perfectly valid target - "no children" is never by itself a
 * reason to call something empty.
 */
export function isSelectableNode<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  byNode: EquipmentByNode,
  nodeId: string,
): boolean {
  if (getChildIds(index, nodeId).length > 0) return true;
  return resolveEquipmentForHierarchyNodes(index, byNode, [nodeId], { includeSelf: true }).length > 0;
}

/** True only when a node genuinely has nothing: no children AND no equipment. */
export function isEmptyNode<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  byNode: EquipmentByNode,
  nodeId: string,
): boolean {
  return !isSelectableNode(index, byNode, nodeId);
}

/** Readable labels for the nodes in play. Labels come from the data, never a constant. */
export function selectionLabels<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  selection: HierarchySelection,
  labelOf: (node: T) => string,
): string[] {
  return effectiveNodeIds(selection).map((id) => {
    const node = index.byId.get(id);
    return node ? labelOf(node) : id;
  });
}

/** Root-first path of a single node, for a one-line scope display. */
export function nodePathText<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  nodeId: string,
  labelOf: (node: T) => string,
  separator = ' ← ',
): string {
  return getNodePath(index, nodeId, labelOf, separator);
}

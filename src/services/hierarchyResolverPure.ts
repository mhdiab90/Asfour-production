/**
 * THE hierarchy resolver - one generic implementation, reused everywhere.
 *
 * The hierarchy in this system is not a display device. It is the business
 * statement of how production data is collected and reported: asking for a
 * parent means asking for the parent AND everything beneath it, to any depth.
 * "Presses" must answer with Bo-kher and Bo-kher 900 2 without the user naming
 * either of them.
 *
 * So this module exists exactly once. Master Data browsing, Master Data
 * editing, the Production Review code filter and production reporting all call
 * these same functions - there is deliberately no second descendant walk
 * anywhere in the codebase.
 *
 * WHAT IT IS NOT COUPLED TO:
 *   - not to cost centres. `HierarchyNodeInput` is {id, code, parentId}, so a
 *     financial-account tree, an equipment tree or any future tree resolves
 *     through the same code path. Nothing here says "press", "furnace" or
 *     "cost centre".
 *   - not to Firebase. Pure functions over arrays the caller already has, so
 *     resolution costs zero reads and is directly unit-testable.
 *
 * PERFORMANCE: one O(n) index build, then every resolution is a bounded walk
 * over that index. Never a query per child - that N+1 is the exact thing this
 * codebase's quota work exists to prevent.
 *
 * CYCLE SAFETY: real imported data can contain a cycle (A->B->C->A). Every
 * walk here carries a visited set, so a cycle yields a finite answer instead of
 * hanging. Editing is stricter: `validateParentAssignment` refuses to CREATE
 * one in the first place.
 */

// --- Shape -------------------------------------------------------------------

/** The minimum any record must expose to take part in a hierarchy. */
export interface HierarchyNodeInput {
  id: string;
  /** Business code. Defaults to `id` when a record keys itself by its code. */
  code?: string;
  /** Parent's id (or code, when ids are codes). `null`/absent = a root. */
  parentId?: string | null;
  [key: string]: unknown;
}

export interface HierarchyIndex<T extends HierarchyNodeInput = HierarchyNodeInput> {
  byId: Map<string, T>;
  /** Parent id -> child ids, in input order. Roots live under `''`. */
  childrenByParent: Map<string, string[]>;
  rootIds: string[];
  /** code -> id, for selections expressed as codes. */
  idByCode: Map<string, string>;
  size: number;
}

const ROOT_KEY = '';

function nodeId(node: HierarchyNodeInput): string {
  return String(node.id ?? '');
}

function nodeCode(node: HierarchyNodeInput): string {
  return String(node.code ?? node.id ?? '');
}

function parentKey(node: HierarchyNodeInput): string {
  const p = node.parentId;
  if (p === null || p === undefined || p === '') return ROOT_KEY;
  return String(p);
}

// --- Index -------------------------------------------------------------------

/**
 * Builds the descendant index once, in O(n).
 *
 * A node whose declared parent is not present in the set is treated as a root
 * rather than dropped: an orphan must still be visible and selectable in Master
 * Data, otherwise a bad import would silently hide records. `findOrphans`
 * reports them separately so the UI can flag them honestly.
 */
export function buildHierarchyIndex<T extends HierarchyNodeInput>(nodes: readonly T[]): HierarchyIndex<T> {
  const byId = new Map<string, T>();
  const idByCode = new Map<string, string>();

  for (const node of nodes) {
    const id = nodeId(node);
    if (!id) continue;
    byId.set(id, node);
    const code = nodeCode(node);
    if (code && !idByCode.has(code)) idByCode.set(code, id);
  }

  const childrenByParent = new Map<string, string[]>();
  const rootIds: string[] = [];

  for (const node of nodes) {
    const id = nodeId(node);
    if (!id) continue;
    const parent = parentKey(node);
    const attachTo = parent !== ROOT_KEY && byId.has(parent) ? parent : ROOT_KEY;
    if (attachTo === ROOT_KEY) rootIds.push(id);
    const bucket = childrenByParent.get(attachTo);
    if (bucket) bucket.push(id);
    else childrenByParent.set(attachTo, [id]);
  }

  return { byId, childrenByParent, rootIds, idByCode, size: byId.size };
}

/** Accepts an id or a business code and returns the id, or null. */
export function resolveNodeId<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  idOrCode: string,
): string | null {
  if (index.byId.has(idOrCode)) return idOrCode;
  return index.idByCode.get(idOrCode) ?? null;
}

export function getChildIds<T extends HierarchyNodeInput>(index: HierarchyIndex<T>, nodeIdValue: string): string[] {
  return index.childrenByParent.get(nodeIdValue) ?? [];
}

// --- Resolution (the core requirement) ---------------------------------------

export interface ResolveOptions {
  /** Include the selected node itself. Default true - "Presses" means Presses AND below. */
  includeSelf?: boolean;
  /** Stop after this many levels below the node. Default: unlimited depth. */
  maxDepth?: number;
}

/**
 * Selected node -> that node plus every descendant, to any depth.
 *
 * Breadth-first over the prebuilt index, with a visited set so a cyclic import
 * terminates. Returns ids in a stable order: the node, then level 1, level 2,
 * and so on.
 */
export function resolveHierarchySelection<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  idOrCode: string,
  options?: ResolveOptions,
): string[] {
  const includeSelf = options?.includeSelf !== false;
  const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY;

  const start = resolveNodeId(index, idOrCode);
  if (start == null) return [];

  const out: string[] = [];
  const visited = new Set<string>([start]);
  if (includeSelf) out.push(start);

  let frontier = [start];
  let depth = 0;
  while (frontier.length > 0 && depth < maxDepth) {
    const next: string[] = [];
    for (const parent of frontier) {
      for (const child of getChildIds(index, parent)) {
        if (visited.has(child)) continue; // cycle or diamond - counted once
        visited.add(child);
        out.push(child);
        next.push(child);
      }
    }
    frontier = next;
    depth += 1;
  }

  return out;
}

/**
 * Several selected branches -> ONE deduplicated set.
 *
 * Presses + Furnaces returns the union. A node reachable from both branches
 * appears exactly once, which is what stops a production record being counted
 * twice when the totals are computed downstream.
 */
export function resolveMultipleHierarchySelections<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  idsOrCodes: readonly string[],
  options?: ResolveOptions,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sel of idsOrCodes) {
    for (const id of resolveHierarchySelection(index, sel, options)) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** The same union expressed as business codes - what a code-keyed filter needs. */
export function resolveHierarchyCodes<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  idsOrCodes: readonly string[],
  options?: ResolveOptions,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of resolveMultipleHierarchySelections(index, idsOrCodes, options)) {
    const node = index.byId.get(id);
    const code = node ? nodeCode(node) : id;
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/** Set form, for callers that only ever test membership. */
export function resolveHierarchyCodeSet<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  idsOrCodes: readonly string[],
  options?: ResolveOptions,
): Set<string> {
  return new Set(resolveHierarchyCodes(index, idsOrCodes, options));
}

// --- Navigation --------------------------------------------------------------

/** Root-first ancestor chain, excluding the node. Cycle-safe. */
export function getAncestorIds<T extends HierarchyNodeInput>(index: HierarchyIndex<T>, idOrCode: string): string[] {
  const start = resolveNodeId(index, idOrCode);
  if (start == null) return [];
  const chain: string[] = [];
  const visited = new Set<string>([start]);
  let current = index.byId.get(start);
  while (current) {
    const parent = parentKey(current);
    if (parent === ROOT_KEY || visited.has(parent)) break;
    const parentNode = index.byId.get(parent);
    if (!parentNode) break;
    visited.add(parent);
    chain.unshift(parent);
    current = parentNode;
  }
  return chain;
}

/** 0 for a root, 1 for its children, and so on. */
export function getNodeDepth<T extends HierarchyNodeInput>(index: HierarchyIndex<T>, idOrCode: string): number {
  return getAncestorIds(index, idOrCode).length;
}

/** Human-readable path built purely from parent links, e.g. "Presses / Bo-kher / Bo-kher 900 2". */
export function getNodePath<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  idOrCode: string,
  labelOf: (node: T) => string,
  separator = ' / ',
): string {
  const start = resolveNodeId(index, idOrCode);
  if (start == null) return '';
  const ids = [...getAncestorIds(index, start), start];
  return ids
    .map((id) => {
      const node = index.byId.get(id);
      return node ? labelOf(node) : id;
    })
    .join(separator);
}

/** Depth-first order for rendering a tree, each entry carrying its own depth. */
export function flattenHierarchy<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  rootIds?: readonly string[],
): Array<{ id: string; node: T; depth: number }> {
  const out: Array<{ id: string; node: T; depth: number }> = [];
  const visited = new Set<string>();

  const walk = (id: string, depth: number) => {
    if (visited.has(id)) return; // cycle guard
    visited.add(id);
    const node = index.byId.get(id);
    if (node) out.push({ id, node, depth });
    for (const child of getChildIds(index, id)) walk(child, depth + 1);
  };

  for (const id of rootIds ?? index.rootIds) walk(id, 0);
  return out;
}

/** Nodes naming a parent that is not in the set. Reported, never silently dropped. */
export function findOrphans<T extends HierarchyNodeInput>(index: HierarchyIndex<T>): string[] {
  const orphans: string[] = [];
  for (const [id, node] of index.byId) {
    const parent = parentKey(node);
    if (parent !== ROOT_KEY && !index.byId.has(parent)) orphans.push(id);
  }
  return orphans;
}

// --- Edit validation ---------------------------------------------------------

export type HierarchyIssueCode =
  | 'UNKNOWN_NODE'
  | 'SELF_PARENT'
  | 'CYCLE'
  | 'UNKNOWN_PARENT'
  | 'DUPLICATE_CODE'
  | 'EMPTY_CODE'
  | 'EMPTY_NAME'
  | 'PARENT_REQUIRED';

export interface HierarchyIssue {
  code: HierarchyIssueCode;
  messageAr: string;
  messageEn: string;
}

export interface HierarchyValidation {
  valid: boolean;
  issues: HierarchyIssue[];
}

const OK: HierarchyValidation = { valid: true, issues: [] };

function fail(...issues: HierarchyIssue[]): HierarchyValidation {
  return { valid: false, issues };
}

/**
 * Can `nodeId` be re-parented under `newParentId`?
 *
 * Rejects, in this order:
 *   - an unknown node or unknown parent (a dangling reference silently
 *     detaches a whole branch from every report that walks it);
 *   - a node parented to itself;
 *   - any move that would close a cycle - i.e. the proposed parent is the node
 *     itself or one of its own descendants. A->B, B->C, C->A is refused at the
 *     C->A step, because A is already below C.
 *
 * Detection is by descendant membership rather than by walking upward from the
 * new parent, so it is correct even if the stored data ALREADY contains a cycle.
 */
export function validateParentAssignment<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  idOrCode: string,
  newParentIdOrCode: string | null,
): HierarchyValidation {
  const id = resolveNodeId(index, idOrCode);
  if (id == null) {
    return fail({
      code: 'UNKNOWN_NODE',
      messageAr: `العنصر "${idOrCode}" غير موجود في التسلسل الهرمي.`,
      messageEn: `Node "${idOrCode}" does not exist in the hierarchy.`,
    });
  }

  if (newParentIdOrCode === null || newParentIdOrCode === '') return OK; // promoted to root

  const parent = resolveNodeId(index, newParentIdOrCode);
  if (parent == null) {
    return fail({
      code: 'UNKNOWN_PARENT',
      messageAr: `الأصل "${newParentIdOrCode}" غير موجود - لا يمكن ربط عنصر بأصل غير معروف.`,
      messageEn: `Parent "${newParentIdOrCode}" does not exist - a node cannot point at an unknown parent.`,
    });
  }

  if (parent === id) {
    return fail({
      code: 'SELF_PARENT',
      messageAr: 'لا يمكن جعل العنصر أصلاً لنفسه.',
      messageEn: 'A node cannot be its own parent.',
    });
  }

  const descendants = new Set(resolveHierarchySelection(index, id, { includeSelf: true }));
  if (descendants.has(parent)) {
    return fail({
      code: 'CYCLE',
      messageAr: `الأصل المطلوب "${newParentIdOrCode}" يقع أسفل العنصر نفسه - هذا ينشئ حلقة مغلقة في التسلسل الهرمي.`,
      messageEn: `Proposed parent "${newParentIdOrCode}" already sits below this node - that would create a cycle.`,
    });
  }

  return OK;
}

export interface NodeEditPatch {
  code?: string;
  name?: string;
  parentId?: string | null;
}

export interface NodeEditRules {
  /** Codes must be unique across the set. Default true. */
  requireUniqueCode?: boolean;
  /** A non-root node must keep a parent. Default false. */
  requireParent?: boolean;
}

/**
 * Full pre-save check for one hierarchy edit: code, name and parent together.
 *
 * Every issue is collected rather than returning on the first, so the editor
 * can show everything wrong with the row at once.
 */
export function validateNodeEdit<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  idOrCode: string,
  patch: NodeEditPatch,
  rules?: NodeEditRules,
): HierarchyValidation {
  const requireUniqueCode = rules?.requireUniqueCode !== false;
  const issues: HierarchyIssue[] = [];

  const id = resolveNodeId(index, idOrCode);
  if (id == null) {
    return fail({
      code: 'UNKNOWN_NODE',
      messageAr: `العنصر "${idOrCode}" غير موجود في التسلسل الهرمي.`,
      messageEn: `Node "${idOrCode}" does not exist in the hierarchy.`,
    });
  }

  if (patch.code !== undefined) {
    const code = String(patch.code).trim();
    if (!code) {
      issues.push({
        code: 'EMPTY_CODE',
        messageAr: 'الكود مطلوب ولا يمكن تركه فارغاً.',
        messageEn: 'Code is required and cannot be blank.',
      });
    } else if (requireUniqueCode) {
      const owner = index.idByCode.get(code);
      if (owner && owner !== id) {
        issues.push({
          code: 'DUPLICATE_CODE',
          messageAr: `الكود "${code}" مستخدم بالفعل بواسطة عنصر آخر.`,
          messageEn: `Code "${code}" is already used by another node.`,
        });
      }
    }
  }

  if (patch.name !== undefined && !String(patch.name).trim()) {
    issues.push({
      code: 'EMPTY_NAME',
      messageAr: 'الاسم مطلوب ولا يمكن تركه فارغاً.',
      messageEn: 'Name is required and cannot be blank.',
    });
  }

  if (patch.parentId !== undefined) {
    if (rules?.requireParent && (patch.parentId === null || patch.parentId === '')) {
      issues.push({
        code: 'PARENT_REQUIRED',
        messageAr: 'هذا التصنيف يتطلب أصلاً - لا يمكن جعل العنصر جذراً.',
        messageEn: 'This category requires a parent - the node cannot be made a root.',
      });
    } else {
      const parentCheck = validateParentAssignment(index, id, patch.parentId ?? null);
      issues.push(...parentCheck.issues);
    }
  }

  return issues.length === 0 ? OK : { valid: false, issues };
}

/** Every cycle already present in stored data, as its member ids. Diagnostics only. */
export function detectExistingCycles<T extends HierarchyNodeInput>(index: HierarchyIndex<T>): string[][] {
  const state = new Map<string, 'visiting' | 'done'>();
  const cycles: string[][] = [];

  for (const startId of index.byId.keys()) {
    if (state.get(startId) === 'done') continue;

    const path: string[] = [];
    let current: string | null = startId;

    while (current != null && state.get(current) !== 'done') {
      if (state.get(current) === 'visiting') {
        const at = path.indexOf(current);
        if (at >= 0) cycles.push(path.slice(at));
        break;
      }
      state.set(current, 'visiting');
      path.push(current);
      const node = index.byId.get(current);
      const parent = node ? parentKey(node) : ROOT_KEY;
      current = parent !== ROOT_KEY && index.byId.has(parent) ? parent : null;
    }

    for (const id of path) state.set(id, 'done');
  }

  return cycles;
}

/**
 * A NEW index with one node re-parented - the caller's array is never mutated.
 *
 * This is what makes a hierarchy move take effect everywhere at once (§38):
 * move B from A to C and the very next resolution of A no longer contains B,
 * while C now does. No production record is touched by this - the hierarchy
 * states today's relationship, and history keeps its own recorded values.
 */
export function applyParentChange<T extends HierarchyNodeInput>(
  index: HierarchyIndex<T>,
  idOrCode: string,
  newParentIdOrCode: string | null,
  parentField: keyof T & string = 'parentId',
): HierarchyIndex<T> {
  const id = resolveNodeId(index, idOrCode);
  if (id == null) return index;
  const parent = newParentIdOrCode ? resolveNodeId(index, newParentIdOrCode) : null;

  const rebuilt = [...index.byId.values()].map((node) =>
    nodeId(node) === id ? ({ ...node, parentId: parent, [parentField]: parent } as T) : node,
  );
  return buildHierarchyIndex(rebuilt);
}

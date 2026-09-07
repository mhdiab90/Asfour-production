/**
 * ASFOUR ERP - Cost Center / Department Hierarchy (Phase 2).
 *
 * Firebase-free and deterministic - parses Sheet1's raw row array (as
 * returned by `XLSX.utils.sheet_to_json(worksheet, { header: 1 })`) into a
 * deduplicated, validated set of hierarchy nodes. This module never touches
 * the filesystem or Firestore itself - it only operates on already-extracted
 * rows, so it is directly unit-testable via `npx tsx`.
 *
 * SOURCE LAYOUT (Phase 1 audit finding): Sheet1 lists three root categories
 * side-by-side in three column-blocks (cols 0-2, 3-5, 6-8) for its first
 * ~127 rows, then RESTATES categories 6/7 a second time as flat single-
 * column lists and ADDS categories 8/9 (never shown in the parallel block)
 * the same way. The SAME logical code can therefore appear multiple times
 * in the raw rows - this module collapses every occurrence of one code into
 * exactly ONE logical node (see collapseByCode), never creating duplicates.
 *
 * PARENT RESOLUTION (Phase 1 audit finding): the digit-per-level convention
 * is NOT uniform - most branches add exactly one digit per level
 * (511 -> 5111 -> 51111), but department 606 (حركة المعدات) and 704
 * (عمليات خارجية) both jump straight to a TWO-digit child suffix
 * (606 -> 60601, 704 -> 70401). resolveParentCode tries progressively
 * longer stripped suffixes rather than assuming a fixed digit-per-level
 * rule, exactly as Phase 1 verified.
 *
 * EXCLUSION RULES (Phase 1 approval, applied here verbatim, never
 * reinterpreted):
 *  - A code whose name is blank on every occurrence is EXCLUDED_BLANK_NAME.
 *  - Code 6041 is EXCLUDED_CODE_6041 unconditionally - Sheet1 itself
 *    contains two irreconcilable meanings for this one code ("مشتريات" /
 *    "سيارة بيجو 897"); this implementation never attempts to decide which
 *    is correct, per the explicit business rule.
 *  - A code whose ONLY name is a genuine conflict (two or more distinct
 *    non-empty names, other than the special-cased 6041) is CONFLICT -
 *    Phase 1 found none of these beyond 6041, but the classifier still
 *    detects the general case rather than assuming 6041 is the only one.
 *  - A code that carries a non-empty status/notes annotation in the source
 *    (e.g. "مباع" sold, "معطل" out of service, a start-date note) is
 *    REVIEW_REQUIRED - it is still a valid node to create, just flagged for
 *    human attention, never auto-deleted or deactivated.
 */

export type HierarchyNodeType = 'CATEGORY' | 'DEPARTMENT' | 'WORK_CENTER' | 'EQUIPMENT';

export type HierarchyNodeStatus =
  | 'READY'
  | 'REVIEW_REQUIRED'
  | 'EXCLUDED_BLANK_NAME'
  | 'EXCLUDED_CODE_6041'
  | 'CONFLICT';

export const ROOT_CATEGORY_LABELS: Record<string, string> = {
  '5': 'الأقسام الإنتاجية',
  '6': 'الأقسام الخدمية',
  '7': 'اقسام التسويق والبيع',
  '8': 'الإدارة العامة',
  '9': 'المراكز الرأسمالية',
};

/** The five root category digits, in the exact order Sheet1 presents them - never invented, never extended. */
export const ROOT_CATEGORY_CODES = ['5', '6', '7', '8', '9'] as const;

const SECTION_HEADER_TEXTS = new Set([
  'الاقسام الإنتاجية',
  'الأقسام الخدمية',
  'اقسام التسويق والبيع',
  'الإدارة العامة',
  'المراكز الرأسمالية',
]);

const EXCLUDED_CODE_6041 = '6041';

/** The three parallel column-blocks Sheet1 uses (code, name, status/notes). */
const COLUMN_BLOCKS: Array<{ code: number; name: number; status: number }> = [
  { code: 0, name: 1, status: 2 },
  { code: 3, name: 4, status: 5 },
  { code: 6, name: 7, status: 8 },
];

export interface ParsedHierarchyNode {
  sheet1Code: string;
  name: string;
  /** null for a level-1 (department) node - its parent is the implicit root category, denormalized via rootCategoryCode rather than a materialized root document (see the Phase 2 report's architecture note). */
  parentSheet1Code: string | null;
  /** 1 = direct child of the root category, 2 = next level, etc. Variable per branch - never assumed uniform. */
  level: number;
  type: HierarchyNodeType;
  rootCategoryCode: string;
  rootCategoryName: string;
  /** How many times this logical code was restated across Sheet1's parallel/flat layout blocks - always collapsed to ONE node regardless of this count. */
  occurrences: number;
  status: HierarchyNodeStatus;
  /** Present only for REVIEW_REQUIRED nodes - the exact source status/notes text(s), preserved verbatim, never interpreted as a deletion/deactivation instruction. */
  notes?: string[];
  /** Present only for CONFLICT/EXCLUDED_CODE_6041 nodes - every distinct name Sheet1 attached to this one code. */
  distinctNames?: string[];
  /** Human-readable full path, root category through this node, derived purely from parent relationships. */
  path: string;
}

interface RawOccurrence {
  code: string;
  name: string;
  status: string;
}

function normalizeCell(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

/** Extracts every non-empty (code,name,status) triple from all three column-blocks across every row, skipping the 5 section-header pseudo-rows (which occupy the code column but are section titles, not real codes). */
function extractRawOccurrences(rows: unknown[][]): RawOccurrence[] {
  const out: RawOccurrence[] = [];
  for (const row of rows) {
    for (const block of COLUMN_BLOCKS) {
      const codeCell = normalizeCell(row?.[block.code]);
      if (!codeCell) continue;
      if (SECTION_HEADER_TEXTS.has(codeCell)) continue;
      if (!/^\d+$/.test(codeCell)) continue;
      out.push({
        code: codeCell,
        name: normalizeCell(row?.[block.name]),
        status: normalizeCell(row?.[block.status]),
      });
    }
  }
  return out;
}

interface CollapsedCode {
  code: string;
  distinctNames: string[];
  occurrences: number;
  notes: string[];
}

/** Collapses every raw occurrence of the same code into ONE logical entry - Sheet1's own dual-layout restatement (§ module docblock) must never become duplicate hierarchy nodes. */
function collapseByCode(raw: RawOccurrence[]): Map<string, CollapsedCode> {
  const byCode = new Map<string, CollapsedCode>();
  for (const occ of raw) {
    let entry = byCode.get(occ.code);
    if (!entry) {
      entry = { code: occ.code, distinctNames: [], occurrences: 0, notes: [] };
      byCode.set(occ.code, entry);
    }
    entry.occurrences += 1;
    if (occ.name && !entry.distinctNames.includes(occ.name)) entry.distinctNames.push(occ.name);
    if (occ.status && !entry.notes.includes(occ.status)) entry.notes.push(occ.status);
  }
  return byCode;
}

/**
 * Finds the parent of `code` by trying progressively longer stripped
 * suffixes (1 digit, then 2, then 3, ...) against the set of known codes -
 * never assumes a fixed 1-digit-per-level rule, since Sheet1's 606 and 704
 * branches use a 2-digit child suffix. Returns null for a level-1
 * (department) code, which has no code-parent - only an implicit root
 * category.
 */
export function resolveParentCode(code: string, knownCodes: ReadonlySet<string>): string | null {
  for (let stripLen = 1; stripLen < code.length; stripLen++) {
    const candidate = code.slice(0, code.length - stripLen);
    if (knownCodes.has(candidate)) return candidate;
  }
  return null;
}

function computeLevel(code: string, knownCodes: ReadonlySet<string>): number {
  let level = 1;
  let current = code;
  let parent = resolveParentCode(current, knownCodes);
  while (parent) {
    level += 1;
    current = parent;
    parent = resolveParentCode(current, knownCodes);
  }
  return level;
}

/**
 * Parses Sheet1's raw row array into deduplicated, classified hierarchy
 * nodes. Pure - takes rows already extracted by the caller (e.g.
 * XLSX.utils.sheet_to_json(ws, { header: 1 })) and returns the full node
 * set INCLUDING excluded/review-required entries, each carrying its final
 * status - callers decide what to do with each status, this function never
 * silently drops information.
 */
export function parseSheet1HierarchyRows(rows: unknown[][]): ParsedHierarchyNode[] {
  const raw = extractRawOccurrences(rows);
  const collapsed = collapseByCode(raw);
  const knownCodes = new Set(collapsed.keys());

  // Pre-compute which codes have at least one child, needed for type classification.
  const hasChildren = new Set<string>();
  for (const code of knownCodes) {
    const parent = resolveParentCode(code, knownCodes);
    if (parent) hasChildren.add(parent);
  }

  const nameOf = (code: string): string => collapsed.get(code)?.distinctNames[0] || '(بدون اسم)';

  function buildPath(code: string): string {
    const chain: string[] = [];
    let current: string | null = code;
    while (current) {
      chain.unshift(`${current} ${nameOf(current)}`);
      current = resolveParentCode(current, knownCodes);
    }
    const root = code[0];
    return `${root} ${ROOT_CATEGORY_LABELS[root] || '(UNKNOWN ROOT)'} -> ${chain.join(' -> ')}`;
  }

  function classifyType(level: number, isLeaf: boolean): HierarchyNodeType {
    if (level === 1) return 'DEPARTMENT';
    return isLeaf ? 'EQUIPMENT' : 'WORK_CENTER';
  }

  const nodes: ParsedHierarchyNode[] = [];
  for (const [code, entry] of collapsed.entries()) {
    const root = code[0];
    const parent = resolveParentCode(code, knownCodes);
    const level = computeLevel(code, knownCodes);
    const isLeaf = !hasChildren.has(code);
    const distinctNonEmptyNames = entry.distinctNames.filter(Boolean);

    let status: HierarchyNodeStatus;
    let name: string;
    let notes: string[] | undefined;
    let distinctNames: string[] | undefined;

    if (code === EXCLUDED_CODE_6041) {
      status = 'EXCLUDED_CODE_6041';
      name = distinctNonEmptyNames.join(' / ');
      distinctNames = distinctNonEmptyNames;
    } else if (distinctNonEmptyNames.length === 0) {
      status = 'EXCLUDED_BLANK_NAME';
      name = '';
    } else if (distinctNonEmptyNames.length > 1) {
      status = 'CONFLICT';
      name = distinctNonEmptyNames.join(' / ');
      distinctNames = distinctNonEmptyNames;
    } else if (entry.notes.length > 0) {
      status = 'REVIEW_REQUIRED';
      name = distinctNonEmptyNames[0];
      notes = entry.notes;
    } else {
      status = 'READY';
      name = distinctNonEmptyNames[0];
    }

    nodes.push({
      sheet1Code: code,
      name,
      parentSheet1Code: parent,
      level,
      type: classifyType(level, isLeaf),
      rootCategoryCode: root,
      rootCategoryName: ROOT_CATEGORY_LABELS[root] || '(UNKNOWN ROOT)',
      occurrences: entry.occurrences,
      status,
      notes,
      distinctNames,
      path: buildPath(code),
    });
  }

  nodes.sort((a, b) => a.sheet1Code.localeCompare(b.sheet1Code, undefined, { numeric: true }));
  return nodes;
}

export interface HierarchyValidationIssue {
  code: string;
  issue: 'ORPHAN' | 'CYCLE' | 'DUPLICATE_CODE';
  detail: string;
}

export interface HierarchyValidationResult {
  valid: boolean;
  issues: HierarchyValidationIssue[];
  orphanCount: number;
  cycleCount: number;
  duplicateCount: number;
}

/**
 * Validates a parsed node set for structural integrity - every non-level-1
 * node's parent must exist among the parsed nodes (no orphans), no code may
 * appear twice (no duplicates - collapseByCode already guarantees this for
 * anything produced by parseSheet1HierarchyRows, but this function is
 * exported separately so it can validate ANY node set, including a
 * hand-built test fixture), and no parent chain may revisit a code it has
 * already visited (no cycles).
 */
export function validateHierarchy(nodes: ParsedHierarchyNode[]): HierarchyValidationResult {
  const issues: HierarchyValidationIssue[] = [];
  const byCode = new Map<string, ParsedHierarchyNode>();
  const seenCodes = new Set<string>();

  for (const node of nodes) {
    if (seenCodes.has(node.sheet1Code)) {
      issues.push({ code: node.sheet1Code, issue: 'DUPLICATE_CODE', detail: `code ${node.sheet1Code} appears more than once in the node set` });
    }
    seenCodes.add(node.sheet1Code);
    byCode.set(node.sheet1Code, node);
  }

  for (const node of nodes) {
    if (node.parentSheet1Code && !byCode.has(node.parentSheet1Code)) {
      issues.push({ code: node.sheet1Code, issue: 'ORPHAN', detail: `parent ${node.parentSheet1Code} does not exist in the node set` });
    }
  }

  for (const node of nodes) {
    const visited = new Set<string>();
    let current: string | null = node.sheet1Code;
    while (current) {
      if (visited.has(current)) {
        issues.push({ code: node.sheet1Code, issue: 'CYCLE', detail: `parent chain revisits code ${current}` });
        break;
      }
      visited.add(current);
      const parentNode = byCode.get(current);
      current = parentNode ? parentNode.parentSheet1Code : null;
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    orphanCount: issues.filter((i) => i.issue === 'ORPHAN').length,
    cycleCount: issues.filter((i) => i.issue === 'CYCLE').length,
    duplicateCount: issues.filter((i) => i.issue === 'DUPLICATE_CODE').length,
  };
}

export interface HierarchyDryRunSummary {
  totalLogicalSourceNodes: number;
  excludedBlankName: number;
  excludedCode6041: number;
  ready: number;
  reviewRequired: number;
  conflict: number;
  creationCandidates: number;
  perRoot: Record<string, number>;
  validation: HierarchyValidationResult;
}

/** Computes the exact dry-run summary counts - never writes anything, purely derived from the already-parsed node set. */
export function computeHierarchyDryRunSummary(nodes: ParsedHierarchyNode[]): HierarchyDryRunSummary {
  const perRoot: Record<string, number> = {};
  for (const root of ROOT_CATEGORY_CODES) perRoot[root] = 0;
  let excludedBlankName = 0, excludedCode6041 = 0, ready = 0, reviewRequired = 0, conflict = 0;

  for (const node of nodes) {
    perRoot[node.rootCategoryCode] = (perRoot[node.rootCategoryCode] || 0) + 1;
    if (node.status === 'EXCLUDED_BLANK_NAME') excludedBlankName++;
    else if (node.status === 'EXCLUDED_CODE_6041') excludedCode6041++;
    else if (node.status === 'READY') ready++;
    else if (node.status === 'REVIEW_REQUIRED') reviewRequired++;
    else if (node.status === 'CONFLICT') conflict++;
  }

  // Only READY + REVIEW_REQUIRED nodes are creation candidates - excluded/conflict nodes are never created (§ "CREATION RULE").
  const creationNodes = nodes.filter((n) => n.status === 'READY' || n.status === 'REVIEW_REQUIRED');

  return {
    totalLogicalSourceNodes: nodes.length,
    excludedBlankName,
    excludedCode6041,
    ready,
    reviewRequired,
    conflict,
    creationCandidates: creationNodes.length,
    perRoot,
    validation: validateHierarchy(nodes),
  };
}

/** The exact node set a future "create in Firestore" step would create - READY + REVIEW_REQUIRED only, never excluded/conflict codes. */
export function getCreationCandidates(nodes: ParsedHierarchyNode[]): ParsedHierarchyNode[] {
  return nodes.filter((n) => n.status === 'READY' || n.status === 'REVIEW_REQUIRED');
}

/**
 * PHASE 4A - the exact shape a Firestore document would be written with.
 * `sheet1Code` doubles as the deterministic Firestore document ID (see
 * costCenterHierarchyService.ts) - the SAME Sheet1 code always produces the
 * SAME plan entry and the SAME document identity, so `parentId` can simply
 * equal `parentSheet1Code` with no separate ID-mapping pass. Write-time-only
 * fields that cannot be pure (createdBy/createdByName from auth.currentUser,
 * createdAt from the write moment) are deliberately NOT part of this plan -
 * they are added by the Firebase-aware service layer at actual write time.
 */
export interface CostCenterHierarchyCreationPlanNode {
  sheet1Code: string;
  code: string;
  name: string;
  parentSheet1Code: string | null;
  level: number;
  type: HierarchyNodeType;
  rootCategoryCode: string;
  rootCategoryName: string;
  status: HierarchyNodeStatus;
  notes?: string[];
  active: boolean;
  importBatchId: string;
}

/**
 * PHASE 4A - builds the exact, deterministic Firestore creation plan for
 * the READY + REVIEW_REQUIRED candidate nodes. Pure - never touches
 * Firestore, never reads auth.currentUser, never generates a timestamp.
 * Calling this twice with the same `nodes` and the same `importBatchId`
 * produces a deep-equal plan every time (see costCenterHierarchy.test.ts's
 * determinism tests) - the caller supplies `importBatchId` rather than this
 * function generating one internally, keeping the function itself
 * side-effect-free and independently testable.
 *
 * This is the SINGLE place the sheet1Code -> Firestore-document field
 * mapping is defined - costCenterHierarchyService.ts's
 * createCostCenterHierarchyNodes reuses this function rather than
 * duplicating the mapping inline.
 */
export function buildCostCenterHierarchyCreationPlan(
  nodes: ParsedHierarchyNode[],
  importBatchId: string
): CostCenterHierarchyCreationPlanNode[] {
  return getCreationCandidates(nodes).map((n) => ({
    sheet1Code: n.sheet1Code,
    code: n.sheet1Code,
    name: n.name,
    parentSheet1Code: n.parentSheet1Code,
    level: n.level,
    type: n.type,
    rootCategoryCode: n.rootCategoryCode,
    rootCategoryName: n.rootCategoryName,
    status: n.status,
    notes: n.notes,
    active: true,
    importBatchId,
  }));
}

export interface CreationPlanIdempotencyResult {
  valid: boolean;
  duplicateCodes: string[];
}

/**
 * PHASE 4A - pure idempotency guard for a creation plan: confirms no
 * sheet1Code (== Firestore document ID) appears twice. Defense in depth -
 * parseSheet1HierarchyRows -> collapseByCode already guarantees this for any
 * plan built from a real parse, but this function validates ANY plan,
 * including a hand-built test fixture, exactly mirroring how
 * validateHierarchy is exported separately from parseSheet1HierarchyRows.
 * Never reads or writes Firestore - a duplicate sheet1Code in the plan is
 * structurally impossible to cause an actual Firestore duplicate anyway
 * (the deterministic ID means a repeat would silently overwrite, not
 * duplicate) but this still flags it as a plan-quality problem worth
 * surfacing before Phase 4B runs.
 */
export function validateCreationPlanIdempotency(plan: CostCenterHierarchyCreationPlanNode[]): CreationPlanIdempotencyResult {
  const seen = new Set<string>();
  const duplicateCodes: string[] = [];
  for (const entry of plan) {
    if (seen.has(entry.sheet1Code)) duplicateCodes.push(entry.sheet1Code);
    seen.add(entry.sheet1Code);
  }
  return { valid: duplicateCodes.length === 0, duplicateCodes };
}

/** Finds one node by its Sheet1 code - used by the hierarchy browser's search feature. Returns undefined if not found (never guesses/fuzzy-matches a code search). */
export function findNodeByCode(nodes: ParsedHierarchyNode[], code: string): ParsedHierarchyNode | undefined {
  const trimmed = code.trim();
  return nodes.find((n) => n.sheet1Code === trimmed);
}

/** Returns the full ancestor chain (root-most first) for one node, purely derived from parentSheet1Code links - never a hardcoded string. */
export function getAncestorChain(nodes: ParsedHierarchyNode[], code: string): ParsedHierarchyNode[] {
  const byCode = new Map(nodes.map((n) => [n.sheet1Code, n]));
  const chain: ParsedHierarchyNode[] = [];
  let current: string | undefined = code;
  const visited = new Set<string>();
  while (current) {
    if (visited.has(current)) break; // cycle guard - never infinite-loop even on malformed input
    visited.add(current);
    const node: ParsedHierarchyNode | undefined = byCode.get(current);
    if (!node) break;
    chain.unshift(node);
    current = node.parentSheet1Code || undefined;
  }
  return chain;
}

/**
 * PHASE 5 - given a predicate over nodes, returns the set of codes that
 * should be visible in a FILTERED tree view: every matching node PLUS its
 * full ancestor chain, so a matched deep node stays reachable from the root
 * instead of being stranded with its parent branch hidden. One shared
 * implementation, reused by every independent filter in the hierarchy
 * browser (search, status, root category, type) rather than each filter
 * duplicating this same ancestor-expansion loop.
 */
export function computeAncestorInclusiveVisibleCodes(
  nodes: ParsedHierarchyNode[],
  predicate: (node: ParsedHierarchyNode) => boolean
): Set<string> {
  const visible = new Set<string>();
  for (const node of nodes) {
    if (!predicate(node)) continue;
    for (const ancestor of getAncestorChain(nodes, node.sheet1Code)) {
      visible.add(ancestor.sheet1Code);
    }
  }
  return visible;
}

/** Direct children of one code (or of a root category when code is a root digit like '5') - used to drive expand/collapse in the hierarchy browser. */
export function getChildren(nodes: ParsedHierarchyNode[], parentCode: string | null): ParsedHierarchyNode[] {
  if (parentCode === null) return [];
  if (ROOT_CATEGORY_CODES.includes(parentCode as (typeof ROOT_CATEGORY_CODES)[number])) {
    return nodes.filter((n) => n.rootCategoryCode === parentCode && n.level === 1);
  }
  return nodes.filter((n) => n.parentSheet1Code === parentCode);
}

/**
 * PHASE 4B - the "may the Execute Creation button actually be clicked"
 * decision, extracted as a pure function so it is unit-testable without a
 * React renderer (this project has no React testing infrastructure - see
 * costCenterHierarchy.test.ts's tests below). CostCenterHierarchyPanel.tsx
 * calls this on every render to compute the execution button's disabled
 * state; it never bypasses this gate.
 *
 * `isAuthorizedAdmin` is computed by the panel from useAuth() (SUPER_ADMIN
 * or ADMIN role, signed in) - the existing app-wide admin model, reused
 * verbatim, never a new permission key. This function does not itself know
 * about Firebase Auth - it only combines a boolean the caller already
 * computed, keeping this module Firebase-free like every other export here.
 */
export type CostCenterHierarchyApprovalState = 'DRAFT' | 'VALIDATION_FAILED' | 'VALIDATION_PASSED' | 'APPROVED';
export type CostCenterHierarchyExecutionState = 'idle' | 'confirming' | 'creating' | 'success' | 'error';

export interface ExecutionGateInput {
  approvalState: CostCenterHierarchyApprovalState;
  preApproval: PreApprovalValidationResult | null;
  isAuthorizedAdmin: boolean;
  executionState: CostCenterHierarchyExecutionState;
}

export interface ExecutionGateResult {
  canExecute: boolean;
  /** Machine-readable reason codes, most-relevant first - used for the button's disabled tooltip and asserted individually in tests. Empty exactly when canExecute is true. */
  blockedReasons: string[];
}

export function evaluateExecutionGate(input: ExecutionGateInput): ExecutionGateResult {
  const reasons: string[] = [];

  if (input.approvalState !== 'APPROVED') reasons.push('NOT_APPROVED');
  if (!input.isAuthorizedAdmin) reasons.push('NOT_AUTHORIZED');

  if (!input.preApproval || !input.preApproval.passed) {
    reasons.push('VALIDATION_NOT_PASSED');
  } else {
    // Defense-in-depth: preApproval.passed already implies every one of
    // these is clean, but each is asserted individually (rather than
    // trusting the single boolean) so a future regression in
    // runPreApprovalValidation's own `passed` computation cannot silently
    // re-open the execution gate.
    if (input.preApproval.excludedCodesFoundInCandidates.length > 0) reasons.push('EXCLUDED_CODE_IN_CANDIDATES');
    if (input.preApproval.missingReviewRequiredCodes.length > 0) reasons.push('REVIEW_REQUIRED_NOT_PROTECTED');
    if (input.preApproval.furnaceCarNamesDetected.length > 0) reasons.push('FURNACE_CAR_DETECTED');
    if (input.preApproval.invalidTypeCodes.length > 0) reasons.push('INVALID_TYPE');
    if (!input.preApproval.summary.validation.valid) reasons.push('STRUCTURAL_VALIDATION_FAILED');
    if (input.preApproval.summary.validation.duplicateCount > 0) reasons.push('DUPLICATE_LOGICAL_NODES');
  }

  if (input.executionState === 'creating') reasons.push('EXECUTION_IN_PROGRESS');
  if (input.executionState === 'success') reasons.push('ALREADY_EXECUTED');

  return { canExecute: reasons.length === 0, blockedReasons: reasons };
}

/**
 * PHASE 3 - the known-correct result contract for the ONE authoritative
 * source this whole effort is scoped to (Cost Center new.xlsx / Sheet1),
 * independently re-verified against the real file immediately before this
 * contract was written. This is used ONLY as a validation cross-check
 * inside runPreApprovalValidation below - every number actually DISPLAYED
 * in the UI is always the freshly computed value from
 * computeHierarchyDryRunSummary, never this constant. If a differently
 * edited or wrong file is ever uploaded, its computed totals will not
 * match this contract and pre-approval validation will correctly FAIL -
 * that is the intended safety behavior, not a bug.
 */
export const EXPECTED_SHEET1_CONTRACT = {
  totalLogicalSourceNodes: 195,
  excludedBlankName: 5,
  excludedCode6041: 1,
  ready: 184,
  reviewRequired: 5,
  creationCandidates: 189,
  perRoot: { '5': 68, '6': 66, '7': 46, '8': 5, '9': 10 } as Record<string, number>,
  /** These 6 codes must NEVER appear in the creation-candidate set (5 blank-name + code 6041). */
  excludedCodesMustNotBeCandidates: ['901', '913', '60632', '60633', '70440', '6041'],
  /** These 5 codes must be present AND carry REVIEW_REQUIRED status - never silently excluded, never silently promoted to READY. */
  reviewRequiredCodesMustBePresent: ['6067', '6068', '6069', '70414', '70416'],
};

/** Heuristic terms that would indicate a Furnace Car accidentally leaked into the parsed hierarchy - Sheet1 is confirmed (Phase 1 audit) to contain zero real Furnace Car entries, so any match here is a hard validation failure, never auto-corrected. */
const FURNACE_CAR_NAME_TERMS = ['عربة فرن', 'عربة الفرن', 'عربات الأفران', 'furnace car'];

const ALLOWED_HIERARCHY_TYPES: ReadonlySet<HierarchyNodeType> = new Set(['CATEGORY', 'DEPARTMENT', 'WORK_CENTER', 'EQUIPMENT']);

export interface PreApprovalValidationResult {
  passed: boolean;
  summary: HierarchyDryRunSummary;
  /** Human-readable list of any expected-vs-actual mismatch against EXPECTED_SHEET1_CONTRACT. Always empty for the correct, unaltered Sheet1. */
  contractMismatches: string[];
  /** Any of the 6 must-never-exist codes that were found among the actual creation candidates. Always empty when parsing behaved correctly. */
  excludedCodesFoundInCandidates: string[];
  /** Any of the 5 required REVIEW_REQUIRED codes that are missing or were not classified REVIEW_REQUIRED. Always empty when parsing behaved correctly. */
  missingReviewRequiredCodes: string[];
  /** Any node whose name matches a Furnace Car term - must always be empty (§ Furnace Car Safety). */
  furnaceCarNamesDetected: string[];
  /** Any node carrying a type outside the 4 allowed hierarchy types - must always be empty (guarded by the TypeScript union already, checked again here as a genuine runtime safety net). */
  invalidTypeCodes: string[];
}

/**
 * PHASE 3 - runs the complete pre-approval validation pass: structural
 * integrity (orphan/cycle/duplicate, via validateHierarchy), the numeric
 * contract cross-check against the known-correct Sheet1 result, and every
 * explicit safety assertion the Phase 3 spec requires (excluded codes never
 * candidates, REVIEW_REQUIRED codes never silently dropped, zero Furnace
 * Cars, only the 4 allowed hierarchy types). Never touches Firestore -
 * operates purely on the already-parsed node set.
 */
export function runPreApprovalValidation(nodes: ParsedHierarchyNode[]): PreApprovalValidationResult {
  const summary = computeHierarchyDryRunSummary(nodes);
  const candidates = getCreationCandidates(nodes);
  const candidateCodes = new Set(candidates.map((n) => n.sheet1Code));
  const c = EXPECTED_SHEET1_CONTRACT;

  const contractMismatches: string[] = [];
  if (summary.totalLogicalSourceNodes !== c.totalLogicalSourceNodes) contractMismatches.push(`total logical codes: expected ${c.totalLogicalSourceNodes}, got ${summary.totalLogicalSourceNodes}`);
  if (summary.excludedBlankName !== c.excludedBlankName) contractMismatches.push(`excluded blank-name: expected ${c.excludedBlankName}, got ${summary.excludedBlankName}`);
  if (summary.excludedCode6041 !== c.excludedCode6041) contractMismatches.push(`excluded 6041: expected ${c.excludedCode6041}, got ${summary.excludedCode6041}`);
  if (summary.ready !== c.ready) contractMismatches.push(`READY: expected ${c.ready}, got ${summary.ready}`);
  if (summary.reviewRequired !== c.reviewRequired) contractMismatches.push(`REVIEW_REQUIRED: expected ${c.reviewRequired}, got ${summary.reviewRequired}`);
  if (summary.creationCandidates !== c.creationCandidates) contractMismatches.push(`creation candidates: expected ${c.creationCandidates}, got ${summary.creationCandidates}`);
  for (const root of Object.keys(c.perRoot)) {
    const expected = c.perRoot[root];
    const actual = summary.perRoot[root] || 0;
    if (actual !== expected) contractMismatches.push(`root ${root} count: expected ${expected}, got ${actual}`);
  }

  const excludedCodesFoundInCandidates = c.excludedCodesMustNotBeCandidates.filter((code) => candidateCodes.has(code));

  const missingReviewRequiredCodes = c.reviewRequiredCodesMustBePresent.filter((code) => {
    const node = nodes.find((n) => n.sheet1Code === code);
    return !node || node.status !== 'REVIEW_REQUIRED';
  });

  const furnaceCarNamesDetected = nodes
    .filter((n) => FURNACE_CAR_NAME_TERMS.some((term) => n.name.includes(term)))
    .map((n) => n.sheet1Code);

  const invalidTypeCodes = candidates.filter((n) => !ALLOWED_HIERARCHY_TYPES.has(n.type)).map((n) => n.sheet1Code);

  const passed =
    summary.validation.valid &&
    contractMismatches.length === 0 &&
    excludedCodesFoundInCandidates.length === 0 &&
    missingReviewRequiredCodes.length === 0 &&
    furnaceCarNamesDetected.length === 0 &&
    invalidTypeCodes.length === 0;

  return {
    passed,
    summary,
    contractMismatches,
    excludedCodesFoundInCandidates,
    missingReviewRequiredCodes,
    furnaceCarNamesDetected,
    invalidTypeCodes,
  };
}

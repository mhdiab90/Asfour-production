/**
 * The category-aware production filter engine.
 *
 * ONE place turns
 *
 *     category + selection mode + selected codes  (+ hierarchy, when there is one)
 *
 * into an actual production-record filter. Production Review, production
 * reporting and any future production analytics call this rather than each
 * re-deriving "what does 'Presses' mean" for itself - which is how two screens
 * end up quietly disagreeing about a total.
 *
 * IT WILL NOT INVENT A RELATIONSHIP.
 * A category filters production only when the production record genuinely
 * carries that relationship (`MasterDataCategory.productionFilter`, set only
 * where the field was verified to exist). For every other category this engine
 * returns `applicable: false` with the reason spelled out, so the UI can say
 * "not available for Production Review" instead of showing a filter that
 * silently matches nothing - or worse, matches the wrong thing.
 *
 * HIERARCHY.
 * When the selected category is hierarchical, a selected parent is expanded to
 * the parent plus every descendant through the shared resolver
 * (hierarchyResolverPure.ts) before matching. Selecting several branches unions
 * them and deduplicates, so a node reachable from two selected branches is
 * counted once. There is no descendant walk in this file - it delegates.
 *
 * COST: pure set membership over records the caller already fetched. No query
 * per code, no query per child, no Firestore access of any kind.
 */
import {
  CodeSelection,
  LegacyProductionField,
  MasterDataCategory,
  ProductionFilterField,
  getCategory,
  isNarrowing,
} from './masterDataCategoryRegistry';
import {
  EquipmentByNode,
  EquipmentLink,
  HierarchyIndex,
  HierarchyNodeInput,
  buildEquipmentByNode,
  buildHierarchyIndex,
  resolveEquipmentForHierarchyNodes,
  resolveHierarchyCodes,
} from './hierarchyResolverPure';

export interface ResolvedProductionFilter {
  /** False when this category cannot filter production at all. */
  applicable: boolean;
  /** Which production-record field is matched. Null when not applicable. */
  field: ProductionFilterField | null;
  /** Null means ALL - do not narrow on this dimension. */
  matchValues: Set<string> | null;
  /** True when a parent selection was expanded into descendants. */
  expandedFromHierarchy: boolean;
  /** How many codes the selection became after expansion and deduplication. */
  resolvedCodeCount: number;
  reasonAr: string;
  reasonEn: string;
}

const ALL_FILTER = (categoryId: string | null): ResolvedProductionFilter => ({
  applicable: true,
  field: categoryId ? getCategory(categoryId)?.productionFilter ?? null : null,
  matchValues: null,
  expandedFromHierarchy: false,
  resolvedCodeCount: 0,
  reasonAr: 'الكل - لا يتم تضييق هذا البعد.',
  reasonEn: 'ALL - this dimension is not narrowed.',
});

/**
 * Why a category is unavailable for Production Review, in the user's words.
 *
 * Worth stating plainly rather than hiding the option: the user explicitly
 * asked for Financial Accounts here, and "the option is missing" is a worse
 * answer than "the option exists and here is exactly what is missing".
 */
export function unavailableReason(category: MasterDataCategory): { ar: string; en: string } {
  return {
    ar: `لا يوجد حقل في سجلات الإنتاج يربطها بـ"${category.labelAr}"، لذلك لا يمكن استخدامها كمرشّح لمراجعة الإنتاج. متاحة بالكامل في البيانات الأساسية.`,
    en: `Production records carry no field linking them to "${category.labelEn}", so it cannot filter Production Review. Fully available in Master Data.`,
  };
}

export interface HierarchyContext {
  /** Nodes for the selected category, when it is hierarchical. */
  nodes?: readonly HierarchyNodeInput[];
  /** A prebuilt index, when the caller already has one (avoids rebuilding per keystroke). */
  index?: HierarchyIndex;
}

/**
 * Expands a selection through the hierarchy, when the category has one.
 *
 * Returns null for a flat category, so the caller falls through to matching the
 * selected codes verbatim. Extracted so BOTH the stage-record resolver and the
 * legacy-record resolver below share one expansion - there is exactly one
 * descendant walk in this system, and it lives in hierarchyResolverPure.
 */
function expandSelectionCodes(
  selection: CodeSelection,
  category: MasterDataCategory,
  hierarchy?: HierarchyContext,
): { codes: string[]; expanded: boolean } | null {
  if (!category.hierarchical) return null;
  const index = hierarchy?.index ?? (hierarchy?.nodes ? buildHierarchyIndex(hierarchy.nodes) : null);
  if (!index) return null;

  const codes = resolveHierarchyCodes(index, selection.codes, { includeSelf: true });
  // Codes the hierarchy does not know are still honoured verbatim rather than
  // dropped - an unknown code must narrow, never silently widen.
  const known = new Set(codes);
  for (const c of selection.codes) if (!known.has(c)) codes.push(c);
  return { codes, expanded: codes.length > selection.codes.length };
}

/**
 * Selection -> concrete filter.
 *
 * Order matters here: a category with no verified mapping is refused BEFORE any
 * hierarchy work, so an unmappable category can never accidentally produce a
 * populated match set.
 */
export function resolveProductionFilter(
  selection: CodeSelection,
  hierarchy?: HierarchyContext,
): ResolvedProductionFilter {
  const category = selection.categoryId ? getCategory(selection.categoryId) : undefined;

  if (!selection.categoryId || !category) return ALL_FILTER(null);

  if (category.productionFilter == null) {
    const reason = unavailableReason(category);
    return {
      applicable: false,
      field: null,
      matchValues: null,
      expandedFromHierarchy: false,
      resolvedCodeCount: 0,
      reasonAr: reason.ar,
      reasonEn: reason.en,
    };
  }

  if (!isNarrowing(selection)) return ALL_FILTER(selection.categoryId);

  // Hierarchical category: parent selection means parent + all descendants.
  const expanded = expandSelectionCodes(selection, category, hierarchy);
  if (expanded) {
    return {
      applicable: true,
      field: category.productionFilter,
      matchValues: new Set(expanded.codes),
      expandedFromHierarchy: expanded.expanded,
      resolvedCodeCount: expanded.codes.length,
      reasonAr: `تم توسيع ${selection.codes.length} عنصر مختار إلى ${expanded.codes.length} كود شامل كل الفروع التابعة.`,
      reasonEn: `${selection.codes.length} selected node(s) expanded to ${expanded.codes.length} code(s) including all descendants.`,
    };
  }

  const values = new Set(selection.codes);
  return {
    applicable: true,
    field: category.productionFilter,
    matchValues: values,
    expandedFromHierarchy: false,
    resolvedCodeCount: values.size,
    reasonAr: `${values.size} كود مختار.`,
    reasonEn: `${values.size} selected code(s).`,
  };
}

/**
 * Applies a resolved filter to already-fetched records.
 *
 * An inapplicable category returns the records UNCHANGED rather than empty.
 * Returning nothing would look exactly like "this account has no production",
 * which is the misleading answer this engine exists to avoid; the UI states the
 * unavailability instead.
 *
 * Products are matched on productId OR productCode because records carry both
 * and a selection may legitimately be keyed by either.
 */
export function applyProductionFilter<T extends Record<string, any>>(
  records: readonly T[],
  resolved: ResolvedProductionFilter,
): T[] {
  if (!resolved.applicable || !resolved.field || resolved.matchValues == null) return [...records];
  const field = resolved.field;
  const wanted = resolved.matchValues;

  return records.filter((r) => {
    const value = r[field];
    if (value != null && wanted.has(String(value))) return true;
    if (field === 'productId' && r.productCode != null && wanted.has(String(r.productCode))) return true;
    return false;
  });
}

/** One call: selection in, filtered records out. */
export function filterProductionRecords<T extends Record<string, any>>(
  records: readonly T[],
  selection: CodeSelection,
  hierarchy?: HierarchyContext,
): T[] {
  return applyProductionFilter(records, resolveProductionFilter(selection, hierarchy));
}

// --- Aggregation safety ------------------------------------------------------

/**
 * Collapses records to one entry per record id.
 *
 * The union of several hierarchy branches can present the same record twice
 * when branches overlap. Totals must count it once, so every aggregation here
 * runs through this first. Records without an id are kept as-is rather than
 * discarded - dropping data to make a total tidy would be worse than a
 * duplicate.
 */
export function dedupeRecordsById<T extends { id?: string }>(records: readonly T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of records) {
    const id = r.id == null ? '' : String(r.id);
    if (!id) {
      out.push(r);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

export interface ProductionAggregate {
  recordCount: number;
  quantity: number;
  productionTons: number;
  goodTons: number;
  wasteTons: number;
}

const EMPTY_AGGREGATE: ProductionAggregate = {
  recordCount: 0,
  quantity: 0,
  productionTons: 0,
  goodTons: 0,
  wasteTons: 0,
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Sums an already-deduplicated set. Kept separate so the dedupe step is visible at every call site. */
export function aggregateProduction<T extends Record<string, any>>(records: readonly T[]): ProductionAggregate {
  return records.reduce<ProductionAggregate>(
    (acc, r) => ({
      recordCount: acc.recordCount + 1,
      quantity: acc.quantity + num(r.quantity),
      productionTons: acc.productionTons + num(r.productionTons),
      goodTons: acc.goodTons + num(r.goodTons),
      wasteTons: acc.wasteTons + num(r.wasteTons),
    }),
    { ...EMPTY_AGGREGATE },
  );
}

/**
 * The reporting entry point: selection -> descendants -> records -> total.
 *
 * "Total production for Presses" and "total production for Bo-kher" differ only
 * in which node is selected; the expansion, the deduplication and the sum are
 * the same code either way. Every other filter the caller already applied
 * (date, stage, status, product, customer, search) is preserved, because this
 * only ever narrows the list it is handed - it never re-fetches or re-filters
 * on any other dimension.
 */
export function aggregateProductionForSelection<T extends Record<string, any>>(
  records: readonly T[],
  selection: CodeSelection,
  hierarchy?: HierarchyContext,
): ProductionAggregate & { applicable: boolean; expandedFromHierarchy: boolean } {
  const resolved = resolveProductionFilter(selection, hierarchy);
  const filtered = dedupeRecordsById(applyProductionFilter(records, resolved) as Array<T & { id?: string }>);
  return {
    ...aggregateProduction(filtered),
    applicable: resolved.applicable,
    expandedFromHierarchy: resolved.expandedFromHierarchy,
  };
}

// --- Legacy production records ----------------------------------------------
//
// The Production Records screen reads the `production` collection, whose
// documents are ProductionRecord - a DIFFERENT shape from UniversalStageRecord.
// It has no stageType, but it does have pressId, furnaceId and shiftId. So the
// same category means a different field here, declared separately on the
// registry (`legacyProductionFields`) rather than guessed from the other one.
//
// Everything else is shared: the same CodeSelection, the same ONE/MULTIPLE/ALL
// semantics, the same hierarchy expansion, the same dedupe. This is a second
// FIELD MAPPING, not a second engine.

export interface ResolvedLegacyProductionFilter {
  /** False when this category cannot filter the legacy production records. */
  applicable: boolean;
  /** Every record field matched. A record matching ANY of them is included. */
  fields: LegacyProductionField[];
  /** Null means ALL - do not narrow on this dimension. */
  matchValues: Set<string> | null;
  expandedFromHierarchy: boolean;
  resolvedCodeCount: number;
  reasonAr: string;
  reasonEn: string;
}

const ALL_LEGACY = (fields: LegacyProductionField[]): ResolvedLegacyProductionFilter => ({
  applicable: true,
  fields,
  matchValues: null,
  expandedFromHierarchy: false,
  resolvedCodeCount: 0,
  reasonAr: 'الكل - لا يتم تضييق هذا البعد.',
  reasonEn: 'ALL - this dimension is not narrowed.',
});

/** Why a category cannot filter the Production Records screen, in the user's words. */
export function legacyUnavailableReason(category: MasterDataCategory): { ar: string; en: string } {
  return {
    ar: `لا يوجد حقل في سجلات الإنتاج يربطها بـ"${category.labelAr}"، لذلك لا يمكن استخدامها كمرشّح هنا. متاحة بالكامل في البيانات الأساسية.`,
    en: `Production records carry no field linking them to "${category.labelEn}", so it cannot filter this screen. Fully available in Master Data.`,
  };
}

/**
 * Selection -> concrete filter, for a legacy production record.
 *
 * Refuses an unmapped category BEFORE any hierarchy work, exactly as the
 * stage-record resolver does, so a category with no verified relationship can
 * never produce a populated match set.
 */
export function resolveLegacyProductionFilter(
  selection: CodeSelection,
  hierarchy?: HierarchyContext,
  equipment?: EquipmentContext,
): ResolvedLegacyProductionFilter {
  if (equipment && selection.codes.some(isNodeSelection)) {
    return resolveLegacyProductionFilterWithEquipment(selection, hierarchy, equipment);
  }
  const category = selection.categoryId ? getCategory(selection.categoryId) : undefined;
  if (!selection.categoryId || !category) return ALL_LEGACY([]);

  const fields = category.legacyProductionFields ?? [];
  if (fields.length === 0) {
    const reason = legacyUnavailableReason(category);
    return {
      applicable: false,
      fields: [],
      matchValues: null,
      expandedFromHierarchy: false,
      resolvedCodeCount: 0,
      reasonAr: reason.ar,
      reasonEn: reason.en,
    };
  }

  if (!isNarrowing(selection)) return ALL_LEGACY(fields);

  const expanded = expandSelectionCodes(selection, category, hierarchy);
  if (expanded) {
    return {
      applicable: true,
      fields,
      matchValues: new Set(expanded.codes),
      expandedFromHierarchy: expanded.expanded,
      resolvedCodeCount: expanded.codes.length,
      reasonAr: `تم توسيع ${selection.codes.length} عنصر مختار إلى ${expanded.codes.length} كود شامل كل الفروع التابعة.`,
      reasonEn: `${selection.codes.length} selected node(s) expanded to ${expanded.codes.length} code(s) including all descendants.`,
    };
  }

  const values = new Set(selection.codes);
  return {
    applicable: true,
    fields,
    matchValues: values,
    expandedFromHierarchy: false,
    resolvedCodeCount: values.size,
    reasonAr: `${values.size} كود مختار.`,
    reasonEn: `${values.size} selected code(s).`,
  };
}

/**
 * Applies a resolved legacy filter to already-fetched records.
 *
 * A record is included when ANY mapped field matches - a job belongs to a
 * production centre whether that centre is the press that ran it or the furnace
 * that fired it. Matching ALL fields would return almost nothing.
 *
 * An inapplicable category returns the records UNCHANGED rather than empty, for
 * the same reason as the stage-record path: an empty table is indistinguishable
 * from "this really has no production", which is the misleading answer this
 * engine exists to prevent. The UI states the unavailability instead.
 *
 * Each record is tested once, so a record cannot be emitted twice even when two
 * of its fields both match the selection.
 */
export function applyLegacyProductionFilter<T extends Record<string, any>>(
  records: readonly T[],
  resolved: ResolvedLegacyProductionFilter,
): T[] {
  if (!resolved.applicable || resolved.fields.length === 0 || resolved.matchValues == null) {
    return [...records];
  }
  const wanted = resolved.matchValues;
  return records.filter((r) =>
    resolved.fields.some((f) => {
      const value = r[f];
      return value != null && wanted.has(String(value));
    }),
  );
}

/** One call: selection in, filtered legacy records out. */
export function filterLegacyProductionRecords<T extends Record<string, any>>(
  records: readonly T[],
  selection: CodeSelection,
  hierarchy?: HierarchyContext,
  equipment?: EquipmentContext,
): T[] {
  return applyLegacyProductionFilter(
    records,
    resolveLegacyProductionFilter(selection, hierarchy, equipment),
  );
}

// --- Equipment-linked hierarchy ---------------------------------------------
//
// THE LINK THAT MAKES THE HIERARCHY REAL.
//
// A production record names its equipment (pressId / furnaceId). Equipment
// master data now names its hierarchy node. So a node selection resolves:
//
//     node -> descendant nodes -> linked equipment ids -> matching records
//
// and not one historical production document had to change for it to work.
//
// A selected value is a NODE when it carries the `node:` prefix, and a direct
// equipment id otherwise - so every value a previous release stored keeps
// meaning exactly what it meant. The two kinds can be mixed freely in one
// selection; the results are unioned and deduplicated.

/** Marks a selected value as a hierarchy node rather than a direct equipment id. */
export const HIERARCHY_NODE_PREFIX = 'node:';

export function asNodeSelection(nodeId: string): string {
  return `${HIERARCHY_NODE_PREFIX}${nodeId}`;
}

export function isNodeSelection(value: string): boolean {
  return value.startsWith(HIERARCHY_NODE_PREFIX);
}

export function nodeIdFromSelection(value: string): string {
  return isNodeSelection(value) ? value.slice(HIERARCHY_NODE_PREFIX.length) : value;
}

export interface EquipmentContext {
  /** Equipment master records, each carrying its own id and hierarchyNodeId. */
  equipment?: readonly EquipmentLink[];
  /** A prebuilt node -> equipment index, when the caller already has one. */
  byNode?: EquipmentByNode;
}

/**
 * Splits a selection into the equipment ids it actually means.
 *
 * Returns null when there is nothing hierarchy-related to do, so the caller
 * falls through to its existing behaviour unchanged.
 */
function resolveSelectedEquipment(
  selection: CodeSelection,
  hierarchy?: HierarchyContext,
  equipment?: EquipmentContext,
): { ids: string[]; expanded: boolean } | null {
  const nodeSelections = selection.codes.filter(isNodeSelection);
  if (nodeSelections.length === 0) return null;

  const index = hierarchy?.index ?? (hierarchy?.nodes ? buildHierarchyIndex(hierarchy.nodes) : null);
  const byNode = equipment?.byNode ?? (equipment?.equipment ? buildEquipmentByNode(equipment.equipment) : null);

  // A node was selected but the hierarchy or the links are not loaded. Matching
  // nothing would read as "this branch has no production", so the node
  // selections are dropped and only the directly-selected equipment applies.
  const direct = selection.codes.filter((c) => !isNodeSelection(c));
  if (!index || !byNode) return { ids: direct, expanded: false };

  const linked = resolveEquipmentForHierarchyNodes(
    index,
    byNode,
    nodeSelections.map(nodeIdFromSelection),
    { includeSelf: true },
  );

  const ids = [...new Set([...direct, ...linked])];
  return { ids, expanded: linked.length > 0 };
}

/**
 * The equipment-aware resolver.
 *
 * Delegates everything that is not about equipment to
 * `resolveLegacyProductionFilter`, so there is one place that decides whether a
 * category may filter at all, and one descendant walk in the whole system.
 */
export function resolveLegacyProductionFilterWithEquipment(
  selection: CodeSelection,
  hierarchy?: HierarchyContext,
  equipment?: EquipmentContext,
): ResolvedLegacyProductionFilter {
  const base = resolveLegacyProductionFilter(selection, hierarchy);
  if (!base.applicable || base.matchValues == null) return base;

  const resolved = resolveSelectedEquipment(selection, hierarchy, equipment);
  if (!resolved) return base;

  return {
    ...base,
    matchValues: new Set(resolved.ids),
    expandedFromHierarchy: resolved.expanded,
    resolvedCodeCount: resolved.ids.length,
    reasonAr: resolved.expanded
      ? `تم توسيع الاختيار إلى ${resolved.ids.length} معدة مرتبطة عبر التسلسل الهرمي.`
      : `${resolved.ids.length} معدة مختارة.`,
    reasonEn: resolved.expanded
      ? `Expanded to ${resolved.ids.length} linked equipment record(s) through the hierarchy.`
      : `${resolved.ids.length} selected equipment record(s).`,
  };
}

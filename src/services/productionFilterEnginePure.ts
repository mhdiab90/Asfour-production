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
  MasterDataCategory,
  ProductionFilterField,
  getCategory,
  isNarrowing,
} from './masterDataCategoryRegistry';
import {
  HierarchyIndex,
  HierarchyNodeInput,
  buildHierarchyIndex,
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
  if (category.hierarchical) {
    const index = hierarchy?.index ?? (hierarchy?.nodes ? buildHierarchyIndex(hierarchy.nodes) : null);
    if (index) {
      const codes = resolveHierarchyCodes(index, selection.codes, { includeSelf: true });
      // Codes the hierarchy does not know are still honoured verbatim rather
      // than dropped - an unknown code must narrow, never silently widen.
      const known = new Set(codes);
      for (const c of selection.codes) if (!known.has(c)) codes.push(c);
      return {
        applicable: true,
        field: category.productionFilter,
        matchValues: new Set(codes),
        expandedFromHierarchy: codes.length > selection.codes.length,
        resolvedCodeCount: codes.length,
        reasonAr: `تم توسيع ${selection.codes.length} عنصر مختار إلى ${codes.length} كود شامل كل الفروع التابعة.`,
        reasonEn: `${selection.codes.length} selected node(s) expanded to ${codes.length} code(s) including all descendants.`,
      };
    }
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

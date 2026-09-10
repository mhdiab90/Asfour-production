/**
 * Master Data category registry - the category-first organisation layer.
 *
 * A category is a named group of codes the user picks BEFORE picking codes.
 * Adding a future category means adding one entry here; no screen is rewritten.
 * Every screen that offers categories reads this list, so the Master Data
 * selector, the Production Review selector and the import targets can never
 * drift apart.
 *
 * This is an organisation layer over the EXISTING collections and the existing
 * cache-first master-data service. It renames nothing and migrates nothing.
 *
 * THE IMPORTANT RULE - `productionFilter`:
 * A category may only be offered as a Production Review filter when the
 * production record genuinely carries that relationship. `UniversalStageRecord`
 * was inspected field by field: it has stageType, productId/productCode,
 * customerId/customerName, materials[] and workers[] - and it has NO
 * accountId, costCenterId, costCenterCode or financialAccount (all verified
 * absent, and re-verified for this release). So Financial Accounts and Cost
 * Centers are Master-Data-only here. Inventing a mapping would silently return
 * wrong production data.
 *
 * Pure and Firebase-free so the mappings stay unit-testable.
 */
import { ProductionStageType } from '../types';

/** Which field of a production record this category filters on. */
export type ProductionFilterField = 'stageType' | 'productId' | 'productCode' | 'customerId';

export interface MasterDataCategory {
  id: string;
  labelAr: string;
  labelEn: string;
  /**
   * The existing Firestore collection, read through fetchMasterData's
   * cache-first path. `null` means the category is served by its own dedicated
   * reader instead (see `reader`).
   */
  collection: string | null;
  /** Names the dedicated service function when the category is not a plain collection. */
  reader?: 'costCenterHierarchy';
  /**
   * The existing MasterDataTab this category maps to, when one exists. This is
   * what lets the category selector drive the already-built table, Add/Edit
   * modal, export and bulk import without any of that being rewritten.
   */
  tab?: string;
  /** Field holding the code on the master record. */
  codeField: string;
  /** Fields shown to the user, in order of preference. */
  displayFields: string[];
  /** Fields searched by the code selector. */
  searchFields: string[];
  /** Hierarchical categories render as a tree/level column rather than a flat list. */
  hierarchical?: boolean;
  /** Field naming this record's parent, for hierarchical categories. */
  parentField?: string;
  /** Whether the shared Excel importer can target this category. */
  supportsImport?: boolean;
  /** Whether records here can be edited in place. */
  supportsEdit?: boolean;
  /**
   * Set ONLY when a real production-record relationship was verified.
   * `null` means: usable in Master Data, never offered as a production filter.
   */
  productionFilter: ProductionFilterField | null;
}

export const MASTER_DATA_CATEGORIES: MasterDataCategory[] = [
  {
    id: 'productionCenters',
    labelAr: 'مراكز الإنتاج',
    labelEn: 'Production Centers',
    // Production centres are the eight production STAGES; the codes come from
    // the stage registry rather than a master collection.
    collection: null,
    reader: undefined,
    codeField: 'stageType',
    displayFields: ['stageNameAr', 'stageType'],
    searchFields: ['stageType', 'stageNameAr'],
    supportsImport: false,
    supportsEdit: false,
    // VERIFIED: every production record carries stageType.
    // The eight stages are a flat enum - there is no parent stage in the
    // codebase, so this category is not marked hierarchical. Marking it so
    // would promise descendants that do not exist.
    productionFilter: 'stageType',
  },
  {
    id: 'products',
    labelAr: 'المنتجات',
    labelEn: 'Products',
    collection: 'products',
    tab: 'products',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: true,
    supportsEdit: true,
    // VERIFIED: production records carry productId and productCode.
    productionFilter: 'productId',
  },
  {
    id: 'customers',
    labelAr: 'العملاء',
    labelEn: 'Customers',
    collection: 'customers',
    tab: 'customers',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: true,
    supportsEdit: true,
    // VERIFIED: production records carry customerId.
    productionFilter: 'customerId',
  },
  {
    id: 'materials',
    labelAr: 'الخامات',
    labelEn: 'Materials',
    collection: 'materials',
    tab: 'materials',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: true,
    supportsEdit: true,
    // Materials appear only inside the nested materials[] array, not as a
    // top-level filterable field, so no production filter is claimed.
    productionFilter: null,
  },
  {
    id: 'employees',
    labelAr: 'العمال والموظفون',
    labelEn: 'Employees',
    collection: 'employees',
    tab: 'employees',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: true,
    supportsEdit: true,
    // Employees appear only inside the nested workers[] array, never as a
    // top-level record field.
    productionFilter: null,
  },
  {
    id: 'presses',
    labelAr: 'المكابس',
    labelEn: 'Presses',
    collection: 'presses',
    tab: 'presses',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: true,
    supportsEdit: true,
    // Pressing records DO carry pressId/pressCode, but only pressing ones -
    // the field is absent from the other seven stage collections. Offering it
    // as a top-level Production Review filter would silently drop seven
    // stages' records, so it stays Master-Data-only until the relationship
    // exists across the record set rather than in one stage.
    productionFilter: null,
  },
  {
    id: 'furnaces',
    labelAr: 'الأفران',
    labelEn: 'Furnaces',
    collection: 'furnaces',
    tab: 'furnaces',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: true,
    supportsEdit: true,
    productionFilter: null,
  },
  {
    id: 'mills',
    labelAr: 'الطواحين الصينية',
    labelEn: 'Chinese Mills',
    collection: 'chineseMills',
    tab: 'mills',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: true,
    supportsEdit: true,
    productionFilter: null,
  },
  {
    id: 'shifts',
    labelAr: 'ورديات العمل',
    labelEn: 'Shifts',
    collection: 'shifts',
    tab: 'shifts',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: true,
    supportsEdit: true,
    productionFilter: null,
  },
  {
    id: 'financialAccounts',
    labelAr: 'الحسابات المالية',
    labelEn: 'Financial Accounts',
    // Its OWN collection. This previously pointed at `departments`, which would
    // have listed department records under a "Financial Accounts" heading -
    // corrected here, and the real structure is defined in
    // financialAccountsPure.ts (code, name, nameEn, parentCode, accountType,
    // description, active) rather than borrowed from another entity.
    collection: 'financialAccounts',
    tab: 'financialAccounts',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name', 'nameEn', 'accountType'],
    hierarchical: true,
    parentField: 'parentCode',
    supportsImport: true,
    supportsEdit: true,
    // NOT a production filter: no accountId/financialAccount field exists on
    // a production record. Verified absent, never inferred.
    productionFilter: null,
  },
  {
    id: 'costCenters',
    labelAr: 'مراكز التكلفة (الأقسام)',
    labelEn: 'Cost Centers (Departments)',
    // The flat `departments` collection - the cost-centre list this ERP has
    // always used (it is what the Employee department picker reads). Kept
    // distinct from Production Centers, which are the eight stages, and from
    // the imported Sheet1 tree below.
    collection: 'departments',
    tab: 'departments',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: true,
    supportsEdit: true,
    // NOT a production filter: no costCenterId/costCenterCode on production records.
    productionFilter: null,
  },
  {
    id: 'hierarchicalCostCenters',
    labelAr: 'مراكز التكلفة الهرمية',
    labelEn: 'Hierarchical Cost Centers',
    // Served by listCostCenterHierarchyNodes(), which itself goes through the
    // shared cache-first master-data read.
    collection: null,
    reader: 'costCenterHierarchy',
    codeField: 'sheet1Code',
    displayFields: ['name', 'sheet1Code'],
    searchFields: ['sheet1Code', 'name', 'rootCategoryName'],
    hierarchical: true,
    parentField: 'parentSheet1Code',
    // Imported through the dedicated Sheet1 hierarchy panel, not the generic
    // column-mapped importer.
    supportsImport: false,
    supportsEdit: true,
    // NOT a production filter: production records store no cost-centre link.
    productionFilter: null,
  },
];

export function getCategory(id: string): MasterDataCategory | undefined {
  return MASTER_DATA_CATEGORIES.find((c) => c.id === id);
}

export function categoryLabel(category: MasterDataCategory, language: 'ar' | 'en'): string {
  return language === 'ar' ? category.labelAr : category.labelEn;
}

/** Only categories with a verified production relationship may filter Production Review. */
export function productionFilterCategories(): MasterDataCategory[] {
  return MASTER_DATA_CATEGORIES.filter((c) => c.productionFilter !== null);
}

export function supportsProductionFilter(id: string): boolean {
  return getCategory(id)?.productionFilter != null;
}

/** Categories backed by a real, browsable store - i.e. everything except the virtual stage list. */
export function browsableCategories(): MasterDataCategory[] {
  return MASTER_DATA_CATEGORIES.filter((c) => c.collection != null || c.reader != null);
}

export function hierarchicalCategories(): MasterDataCategory[] {
  return MASTER_DATA_CATEGORIES.filter((c) => c.hierarchical === true);
}

/** The MasterDataTab a category drives, when it maps to one. */
export function categoryTab(id: string): string | null {
  return getCategory(id)?.tab ?? null;
}

/** Reverse lookup, so an existing tab can highlight the right category. */
export function categoryForTab(tab: string): MasterDataCategory | undefined {
  return MASTER_DATA_CATEGORIES.find((c) => c.tab === tab);
}

// --- Selection model ---------------------------------------------------------

/**
 * ONE / MULTIPLE / ALL, kept as a mode rather than materialising every code.
 * "ALL" must never be expanded into a huge array - it means "every code in the
 * selected category", which the query layer expresses by simply not filtering
 * on that dimension.
 */
export type SelectionMode = 'ONE' | 'MULTIPLE' | 'ALL';

export interface CodeSelection {
  categoryId: string | null;
  mode: SelectionMode;
  /** Empty when mode is ALL. */
  codes: string[];
}

export const EMPTY_SELECTION: CodeSelection = { categoryId: null, mode: 'ALL', codes: [] };

export function selectionMode(codes: string[], all: boolean): SelectionMode {
  if (all) return 'ALL';
  return codes.length === 1 ? 'ONE' : 'MULTIPLE';
}

export function normaliseSelection(categoryId: string | null, codes: string[], all: boolean): CodeSelection {
  const unique = [...new Set(codes.filter(Boolean))].sort();
  if (all || unique.length === 0) return { categoryId, mode: 'ALL', codes: [] };
  return { categoryId, mode: selectionMode(unique, false), codes: unique };
}

/** True when the selection actually narrows anything. */
export function isNarrowing(sel: CodeSelection): boolean {
  return sel.categoryId != null && sel.mode !== 'ALL' && sel.codes.length > 0;
}

/**
 * Applies a selection to already-fetched records, client-side.
 *
 * This is the NON-hierarchical base case. Hierarchy expansion (parent means
 * parent plus every descendant) lives in productionFilterEnginePure.ts, which
 * calls into the shared resolver and then matches exactly as this does - there
 * is one descendant walk in the codebase, not two.
 *
 * Deliberately NOT a per-code Firestore query: the existing bounded stage query
 * already fetches the period once, and filtering that result in memory costs
 * zero extra reads. Looping code -> query would be the N+1 this codebase's
 * quota programme exists to prevent.
 */
export function filterRecordsBySelection<T extends Record<string, any>>(
  records: T[],
  sel: CodeSelection,
): T[] {
  if (!isNarrowing(sel)) return records;
  const category = getCategory(sel.categoryId!);
  const field = category?.productionFilter;
  // A category with no verified mapping never narrows production data.
  if (!field) return records;
  const wanted = new Set(sel.codes);
  return records.filter((r) => {
    const value = r[field];
    if (value != null && wanted.has(String(value))) return true;
    // Products carry both an id and a code; match either so a code-based
    // selection still works against id-keyed records.
    if (field === 'productId' && r.productCode != null && wanted.has(String(r.productCode))) return true;
    return false;
  });
}

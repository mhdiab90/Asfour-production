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

/**
 * Fields verified to exist on a LEGACY production record - the documents in the
 * `production` collection that the Production Records screen reads.
 *
 * This is a DIFFERENT record type from UniversalStageRecord, with a different
 * verified field set, which is why it needs its own declaration rather than
 * reusing ProductionFilterField:
 *
 *   - `stageType` does NOT exist here (every document in this collection is a
 *     pressing record; the stage is implied, not stored).
 *   - `pressId` / `furnaceId` / `shiftId` DO exist here, and are written by
 *     ProductionEntryForm on every save. They are absent from the other seven
 *     stage collections, which is exactly why `productionFilter` above leaves
 *     presses and furnaces unmapped for Production Review.
 *
 * Each name below was read off the ProductionRecord interface and the form that
 * writes it. Nothing is inferred.
 */
export type LegacyProductionField =
  | 'pressId'
  | 'furnaceId'
  | 'productId'
  | 'productCode'
  | 'customerId'
  | 'shiftId';

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
  /**
   * How this category matches a LEGACY production record, when it does at all.
   *
   * A LIST because one category can legitimately match on more than one field:
   * a production centre is identified by the press that ran the job OR the
   * furnace that fired it, and a record naming either belongs to that centre.
   * ANY listed field matching includes the record - never all of them.
   *
   * Undefined/empty means the same thing `productionFilter: null` means one
   * field up: fully usable in Master Data, never offered as a filter here.
   */
  legacyProductionFields?: LegacyProductionField[];
  /**
   * Which categories supply this one's code list on the legacy screen.
   *
   * Defaults to the category itself. It exists because "production centres" is
   * not a collection - the actual centres live in `presses` and `furnaces`, and
   * the selector has to offer both under one heading.
   */
  legacyCodeSources?: string[];
  /**
   * Whether a code for this category may be a HIERARCHY NODE resolved through
   * an equipment link, rather than a direct master-data id.
   *
   * Deliberately NOT the same thing as `hierarchical`. `hierarchical` means the
   * category's OWN records form a tree through `parentField` - financial
   * accounts do that. Presses and furnaces do not: they are a flat list that
   * POINTS AT a separate node tree via `hierarchyNodeId`. Marking them
   * `hierarchical` would make the engine expand press ids as if they were
   * nodes, which is wrong.
   *
   * Set only where the equipment master records genuinely carry that field.
   */
  equipmentHierarchy?: boolean;
  /**
   * A navigation GROUP rather than a store: the categories offered beneath it,
   * in order. The group's own `tab` is the one opened first. Used only by the
   * Equipment group, so equipment keeps one entry in the Master Data navigation
   * instead of one per machine type.
   *
   * A real category may list sub-categories too (Products lists itself and
   * Bills of Materials): it stays a real store, and its own tab is the first.
   */
  subCategoryIds?: string[];
  /**
   * Phase 1 Step 8C: the field a STAGE RECORD stores to name the machine of this
   * equipment category (e.g. a rotary kiln record's `rotaryKilnId`). Distinct
   * from `legacyProductionFields`, which are the pressing-record fields the
   * Production Review filters by - a stage equipment field adds no filter.
   */
  stageEquipmentField?: string;
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
    // On the legacy `production` collection there is no stageType; a centre is
    // identified by the press that ran the job or the furnace that fired it.
    // Both fields were verified present on ProductionRecord and are written by
    // ProductionEntryForm. The codes come from those two collections.
    legacyProductionFields: ['pressId', 'furnaceId'],
    legacyCodeSources: ['presses', 'furnaces'],
    // Press and Furnace master records carry hierarchyNodeId, so a selected
    // node resolves through them to the records that name that equipment.
    equipmentHierarchy: true,
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
    legacyProductionFields: ['productId', 'productCode'],
    // Bills of Materials (Phase 1 Step 2) and Routings (Step 3) sit beneath Products.
    subCategoryIds: ['products', 'boms', 'routings'],
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
    legacyProductionFields: ['customerId'],
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
    // On the legacy pressing collection, though, pressId is present on every
    // document - so presses DO filter that screen.
    legacyProductionFields: ['pressId'],
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
    // furnaceId is optional on a legacy record (a job may not be fired), but
    // when present it is a real reference to this collection.
    legacyProductionFields: ['furnaceId'],
  },
  {
    id: 'mills',
    // Step 8C: the Chinese Mills form now names the mill from this master.
    stageEquipmentField: 'millId',
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
    id: 'furnaceCars',
    labelAr: 'عربات الأفران',
    labelEn: 'Furnace Cars',
    collection: 'furnaceCars',
    tab: 'furnaceCars',
    codeField: 'code',
    displayFields: ['carNumber', 'code'],
    searchFields: ['code', 'carNumber'],
    supportsImport: true,
    supportsEdit: true,
    // No production record stores a car id.
    productionFilter: null,
  },
  {
    id: 'tubeBallMills',
    labelAr: 'طواحين الأنابيب والكرات',
    labelEn: 'Tube & Ball Mills',
    // The existing collection the Tube/Ball Mills Historical Import codes mills
    // into. A distinct equipment type from Chinese Mills (`mills`).
    collection: 'tubeBallMills',
    tab: 'tubeBallMills',
    // Step 8C: the Tube/Ball Mills form now names the mill from this master.
    stageEquipmentField: 'tubeBallMillId',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: false,
    supportsEdit: true,
    // Imported stage records carry millTypeId, but the manual entry form writes
    // only free-text millType, so the relationship does not exist across the
    // record set - no production filter is claimed.
    productionFilter: null,
  },
  {
    id: 'bunkers',
    labelAr: 'البناكر',
    labelEn: 'Bunkers',
    // The existing collection the Tube/Ball Mills Historical Import codes
    // bunkers into. A bunker's own identity is its bunkerNumber; code is optional.
    collection: 'bunkers',
    tab: 'bunkers',
    // Step 8C: the Tube/Ball Mills form now names the bunker from this master.
    stageEquipmentField: 'bunkerId',
    codeField: 'code',
    displayFields: ['name', 'bunkerNumber', 'code'],
    searchFields: ['code', 'bunkerNumber', 'name'],
    supportsImport: false,
    supportsEdit: true,
    // storageBunker is free text; bunkerAllocations exist only on imported rows.
    productionFilter: null,
  },
  {
    id: 'rotaryKilns',
    labelAr: 'الأفران الدوارة',
    labelEn: 'Rotary Kilns',
    // Rotary Kiln equipment master (Phase 1 Step 1D). Rotary Furnace records
    // store free-text machineInfo only, so nothing filters on it.
    collection: 'rotaryKilns',
    tab: 'rotaryKilns',
    // Step 8C: the Rotary Kiln form now names the kiln from this master.
    stageEquipmentField: 'rotaryKilnId',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: false,
    supportsEdit: true,
    productionFilter: null,
  },
  {
    id: 'equipment',
    labelAr: 'المعدات',
    labelEn: 'Equipment',
    // A navigation group, not a store: the equipment categories stay their own
    // collections and tabs. One entry keeps the navigation from listing every
    // machine type as a competing primary source, while still letting users
    // manage equipment - and its optional hierarchy link - from Master Data.
    collection: null,
    tab: 'presses',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name'],
    supportsImport: false,
    supportsEdit: true,
    productionFilter: null,
    subCategoryIds: ['presses', 'furnaces', 'furnaceCars', 'mills', 'tubeBallMills', 'bunkers', 'rotaryKilns'],
  },
  {
    id: 'jobReferences',
    labelAr: 'أوامر الشغل',
    labelEn: 'Job References',
    // ASFOUR Job References (Phase 1 Step 1E) - rules in jobBatchPure.ts.
    collection: 'jobReferences',
    tab: 'jobReferences',
    codeField: 'code',
    displayFields: ['code'],
    searchFields: ['code', 'notes'],
    supportsImport: false,
    supportsEdit: true,
    // No production record stores a job reference yet.
    productionFilter: null,
  },
  {
    id: 'batches',
    labelAr: 'الدفعات',
    labelEn: 'Batches',
    // Batches (Phase 1 Step 1E) - identity only; no genealogy or consumption.
    collection: 'batches',
    tab: 'batches',
    codeField: 'batchNumber',
    displayFields: ['batchNumber'],
    searchFields: ['batchNumber', 'notes'],
    supportsImport: false,
    supportsEdit: true,
    // Historical stage records carry a free-text batchNumber, not a batch id.
    productionFilter: null,
  },
  {
    id: 'boms',
    labelAr: 'قوائم المواد (BOM)',
    labelEn: 'Bills of Materials',
    // Bills of Materials (Phase 1 Step 2) - headers here, versions in
    // 'bomVersions'. Rules in bomPure.ts. Shown beneath Products.
    collection: 'boms',
    tab: 'boms',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name', 'notes'],
    supportsImport: false,
    supportsEdit: true,
    // No production record stores a BOM or version id.
    productionFilter: null,
  },
  {
    id: 'routings',
    labelAr: 'مسارات التصنيع (Routing)',
    labelEn: 'Routings',
    // Routings (Phase 1 Step 3) - headers here, versions in 'routingVersions'.
    // Rules in routingPure.ts. Shown beneath Products.
    collection: 'routings',
    tab: 'routings',
    codeField: 'code',
    displayFields: ['name', 'code'],
    searchFields: ['code', 'name', 'notes'],
    supportsImport: false,
    supportsEdit: true,
    // No production record stores a routing or version id.
    productionFilter: null,
  },
  {
    id: 'jobsAndBatches',
    labelAr: 'أوامر الشغل والدفعات',
    labelEn: 'Jobs & Batches',
    // A navigation group like Equipment: one entry, two existing-engine tabs.
    collection: null,
    tab: 'jobReferences',
    codeField: 'code',
    displayFields: ['code'],
    searchFields: ['code'],
    supportsImport: false,
    supportsEdit: true,
    productionFilter: null,
    subCategoryIds: ['jobReferences', 'batches'],
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
    legacyProductionFields: ['shiftId'],
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
    collection: 'costCenterHierarchy',
    reader: 'costCenterHierarchy',
    tab: 'costCenterHierarchy',
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
  {
    id: 'operations',
    labelAr: 'العمليات الإنتاجية',
    labelEn: 'Operations',
    // The Operation Master, stored in the already-registered `stages`
    // collection (MASTER_DATA_COLLECTIONS.stages). A configuration layer beside
    // the legacy stage architecture - it replaces nothing. Rules and the save
    // shape: operationMasterPure.ts.
    collection: 'stages',
    tab: 'stages',
    codeField: 'code',
    displayFields: ['nameAr', 'code'],
    searchFields: ['code', 'nameAr', 'nameEn'],
    supportsImport: false,
    supportsEdit: true,
    // NOT a production filter: production records store their legacy stage
    // (collection / stageType), not an operation id.
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

/** Categories that can filter the LEGACY Production Records screen. */
export function legacyProductionCategories(): MasterDataCategory[] {
  return MASTER_DATA_CATEGORIES.filter((c) => (c.legacyProductionFields?.length ?? 0) > 0);
}

export function supportsLegacyProductionFilter(id: string): boolean {
  return (getCategory(id)?.legacyProductionFields?.length ?? 0) > 0;
}

/**
 * Which equipment categories each production STAGE actually records.
 *
 * Read off the entry forms, one by one, not assumed:
 *
 *   pressing        ProductionEntryForm writes pressId AND furnaceId on every
 *                   save, into the legacy `production` collection.
 *   everything else writes NO equipment reference at all. RotaryFurnaceEntryForm
 *                   stores no furnaceId; the two mill forms store `millType`,
 *                   which is a free-text box ("مثال: طاحونة صينية 1"), not a
 *                   reference to a mill master record.
 *
 * So an equipment filter is only meaningful on the pressing stage. Offering one
 * elsewhere would match nothing while looking like it worked - which is exactly
 * the defect this map exists to end: the Dashboard used to show the PRESS list
 * no matter which stage was chosen.
 *
 * Adding a stage that starts recording equipment is one line here.
 */
export const STAGE_EQUIPMENT_CATEGORIES: Record<string, string[]> = {
  pressing: ['presses', 'furnaces'],
  // Phase 1 Step 8C: these three stages now name their machine from the
  // existing equipment masters; their free-text fields are kept untouched.
  rotary_furnace: ['rotaryKilns'],
  chinese_mills: ['mills'],
  tube_ball_mills: ['tubeBallMills', 'bunkers'],
  mortar_concrete: [],
  mixing: [],
  lightweight_foam: [],
  sorting: [],
  // Phase 1 Step 8C-5: the tunnel kiln names its kiln from the existing Furnaces
  // master (the same furnaceId a pressing record carries). Thermal concrete and
  // hand-made brick record no machine.
  thermal_concrete: [],
  tunnel_kiln: ['furnaces'],
  handmade_brick: [],
};

/**
 * The equipment categories selectable for a stage.
 *
 * `all` means no stage has been chosen, so every category that ANY stage
 * records is offered - the union, never a hard-coded list.
 */
export function equipmentCategoriesForStage(stage: string | undefined | null): MasterDataCategory[] {
  const ids =
    !stage || stage === 'all'
      ? [...new Set(Object.values(STAGE_EQUIPMENT_CATEGORIES).flat())]
      : STAGE_EQUIPMENT_CATEGORIES[stage] ?? [];
  return ids.map((id) => getCategory(id)).filter((c): c is MasterDataCategory => Boolean(c));
}

/** True when this stage records any equipment at all - what decides whether the selector is usable. */
export function stageRecordsEquipment(stage: string | undefined | null): boolean {
  return equipmentCategoriesForStage(stage).length > 0;
}

/** True when this category's codes may be hierarchy nodes resolved via equipment links. */
export function supportsEquipmentHierarchy(id: string): boolean {
  return getCategory(id)?.equipmentHierarchy === true;
}

/**
 * Which categories supply the code list for one category on the legacy screen.
 * Returns the category itself unless it names other sources.
 */
export function legacyCodeSourceCategories(id: string): MasterDataCategory[] {
  const category = getCategory(id);
  if (!category) return [];
  const sources = category.legacyCodeSources;
  if (!sources || sources.length === 0) return [category];
  return sources.map((s) => getCategory(s)).filter((c): c is MasterDataCategory => Boolean(c));
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
  // A pure navigation group never shadows the real category; a real store that
  // also lists sub-categories (Products) is still its own tab's category.
  return MASTER_DATA_CATEGORIES.find((c) => c.tab === tab && !c.subCategoryIds)
    ?? MASTER_DATA_CATEGORIES.find((c) => c.tab === tab && c.collection != null);
}

/** The categories listed under a navigation group, in order. Empty for a plain category. */
export function subCategories(id: string): MasterDataCategory[] {
  return (getCategory(id)?.subCategoryIds ?? [])
    .map((s) => getCategory(s))
    .filter((c): c is MasterDataCategory => Boolean(c));
}

/**
 * Which of the given navigation categories owns a tab: the one whose own tab it
 * is, or the group listing a category with that tab. So a tab opened from
 * elsewhere (e.g. the assistant) highlights the right navigation entry.
 */
export function navigationCategoryIdForTab(tab: string, navigation: readonly MasterDataCategory[]): string | null {
  const direct = navigation.find((c) => c.tab === tab && !c.subCategoryIds);
  if (direct) return direct.id;
  const group = navigation.find((c) => subCategories(c.id).some((s) => s.tab === tab));
  return group ? group.id : null;
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

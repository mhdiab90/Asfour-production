/**
 * ASFOUR Factory Management System - Master TypeScript Types
 */

import { GranularPermissions } from './permissions';

export type UserRole = 
  | 'SUPER_ADMIN' 
  | 'ADMIN' 
  | 'SUPERVISOR' 
  | 'PRODUCTION_SUPERVISOR'
  | 'PRODUCTION_USER' 
  | 'PRODUCTION_OPERATOR'
  | 'QUALITY_CONTROL'
  | 'DATA_ENTRY'
  | 'ACCOUNTING'
  | 'REPORT_VIEWER'
  | 'MAINTENANCE'
  | 'VIEWER'
  | 'CUSTOM';

export interface UserPermission {
  recordsReadOwn: boolean;
  recordsReadShift: boolean;
  recordsReadAll: boolean;
  recordsCreate: boolean;
  recordsEditOwn: boolean;
  recordsEditAll: boolean;
  recordsApprove: boolean;
  recordsDelete: boolean;
  masterDataView: boolean;
  masterDataCreate: boolean;
  masterDataEdit: boolean;
  masterDataDelete: boolean;
  usersManage: boolean;
  importHistorical: boolean;
  exportData: boolean;
  analyticsView: boolean;
  aiUse: boolean;
}

export interface AdminUser {
  uid: string;
  email: string;
  username: string;
  role: UserRole;
  active: boolean;
  fullName?: string;
  employeeId?: string;
  employeeCode?: string;
  employeeName?: string;
  operatorCode?: string;
  operatorStation?: string;
  permissions?: Partial<GranularPermissions> | Partial<UserPermission>;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
  lastLogin?: string;
  lastActivity?: string;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  employeeId?: string;
  employeeCode?: string;
  employeeName?: string;
  role: UserRole;
  active: boolean;
  fullName?: string;
  username?: string;
  operatorStation?: string;
  permissions?: Partial<GranularPermissions>;
}

export interface UpdateUserPayload {
  email?: string;
  role?: UserRole;
  active?: boolean;
  employeeId?: string;
  employeeCode?: string;
  employeeName?: string;
  fullName?: string;
  operatorStation?: string;
  permissions?: Partial<GranularPermissions>;
}

/**
 * A link from an ASFOUR record to the same record in an external system
 * (Odoo, another ERP, a legacy source). ASFOUR keeps its own identity - the
 * Firestore document id and its business code - and a reference only ever
 * sits BESIDE that identity, never in place of it.
 *
 * Rules and helpers: services/externalReferencesPure.ts.
 */
export interface ExternalReference {
  /** Lowercase system key, e.g. 'odoo' or 'legacy'. Never assumed to be Odoo. */
  system: string;
  /** The external model/table, e.g. 'product.product'. Optional. */
  model?: string;
  /** The external record id, as a string. With system + model it is the external identity. */
  externalId?: string;
  /** The external business code, e.g. an Odoo default_code. Informational - never ASFOUR's code. */
  externalCode?: string;
  /** ISO-8601 time of the last sync - the same string format as createdAt / updatedAt. */
  syncedAt?: string;
}

/**
 * Mixin for any ASFOUR entity that may carry external references. Optional:
 * a record without it is valid, and no existing entity is required to have it.
 */
export interface WithExternalReferences {
  externalRefs?: ExternalReference[];
}

/**
 * Logical item (Phase 1 Step 2A) - collection 'logicalItems', document id =
 * the logicalItemId (generated; never a product/material id, code or external
 * id). An internal identity joining at most one product and one material that
 * a user explicitly confirmed are the same item. Both records stay as they are;
 * nothing is copied between them. Withdrawn = INACTIVE, never deleted. A future
 * Odoo product links through `externalRefs`. Rules: services/logicalItemPure.ts.
 */
export interface LogicalItem extends WithExternalReferences {
  id?: string;
  productId?: string | null;
  materialId?: string | null;
  /** An explicit, reversible preference - null unless someone chooses; neither record "wins" by default. */
  preferredSource?: 'products' | 'materials' | null;
  status: 'ACTIVE' | 'INACTIVE';
  /** The match type or note behind the decision. */
  reason?: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** An explicit "Keep Separate" review decision for one product/material pair (Phase 1 Step 2A) - collection 'itemPairDecisions'. */
export interface ItemPairDecision {
  id?: string;
  productId: string;
  materialId: string;
  decision: 'KEEP_SEPARATE';
  status: 'ACTIVE' | 'INACTIVE';
  reason?: string;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Where a BOM item lives: the existing item collections (Phase 1 Step 2). */
export type BomItemSource = 'products' | 'materials';

/**
 * Bill of Materials (Phase 1 Step 2) - collection 'boms'. WHAT items make one
 * item; never operations, stages, cost centres or costs (that is Routing and
 * Costing). The item it makes and every component are referenced by
 * (itemSource, itemId) - a document id, never a code, a name or an external id.
 * `customerId` makes a customer-specific variant; none = the standard BOM.
 * Versions live in their own documents (BomVersion), never inside the Product.
 * Rules: services/bomPure.ts.
 */
export interface Bom extends WithExternalReferences {
  id?: string;
  /** Business BOM code, unique among BOMs. A product may have many BOMs. */
  code: string;
  name: string;
  itemSource: BomItemSource;
  itemId: string;
  customerId?: string | null;
  /** The preferred BOM in its (item, customer) scope - at most one active default per scope. */
  isDefault: boolean;
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** One line of a BOM version. Quantity and unit are explicit; nothing is converted. No cost fields. */
export interface BomComponent {
  /** Stable within its version (L1, L2, ...), so audits can name the line that changed. */
  lineId: string;
  /**
   * Phase 1 Step 7A: BASE (part of the 100% base formula) or ADDITIVE (applied on
   * top, never in the 100%). Absent on lines saved before Step 7A = BASE.
   */
  componentType?: 'BASE' | 'ADDITIVE';
  itemSource: BomItemSource;
  itemId: string;
  /** Null only on a percentage-only line; its quantity is derived from the basis for display. */
  quantity: number | null;
  /** One of the unit values the app already stores (see bomPure.BOM_UNITS). */
  unit: string;
  sequence: number;
  percentage?: number | null;
  notes?: string;
}

/**
 * A revision of a BOM (Phase 1 Step 2) - collection 'bomVersions'.
 * DRAFT -> ACTIVE -> RETIRED; components change only in DRAFT, nothing is
 * deleted, so a version production may later reference stays as it was. A
 * future Job Reference can point at a version id without changing this model.
 */
export interface BomVersion extends WithExternalReferences {
  id?: string;
  bomId: string;
  /** Unique within its BOM, e.g. "V1". */
  versionCode: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  /** Optional basis the quantities make, e.g. 1000 كجم - percentages are checked against it. */
  basisQuantity?: number | null;
  basisUnit?: string | null;
  /** Optional planning figure for a future yield/loss model; no actual scrap is tracked. */
  expectedYieldPercent?: number | null;
  notes?: string;
  components: BomComponent[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Routing (Phase 1 Step 3) - collection 'routings'. WHICH operations one
 * logical item goes through, in what order - configuration data only, never
 * hard-coded. Belongs to a Step 2A logical item; `customerId` makes a
 * customer-specific variant (none = the standard routing). Owns no BOM.
 * Versions live in RoutingVersion documents. Rules: services/routingPure.ts.
 */
export interface Routing extends WithExternalReferences {
  id?: string;
  /** Business routing code, unique among routings. */
  code: string;
  name: string;
  logicalItemId: string;
  customerId?: string | null;
  /** The preferred routing in its (logical item, customer) scope - at most one active default per scope. */
  isDefault: boolean;
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * One ordered step of a routing version. References the Operation Master by id
 * - never a copied operation name or a ProductionStageType. The cost centre,
 * equipment category and machine are optional overrides / selections.
 */
export interface RoutingStep {
  /** Stable within its version (L1, L2, ...), so audits can name the step that changed. */
  lineId: string;
  /** Process order, unique within the version. The same operation may repeat. */
  sequence: number;
  operationId: string;
  /** Optional costCenterHierarchy node overriding the operation's default. */
  hierarchyNodeId?: string | null;
  /** Optional registered equipment category (one the operation allows). */
  equipmentCategoryId?: string | null;
  /** Optional specific machine; must belong to equipmentCategoryId. */
  equipmentId?: string | null;
  /** Metadata for future production logic - no branching or execution. */
  required: boolean;
  notes?: string;
}

/**
 * A revision of a routing (Phase 1 Step 3) - collection 'routingVersions'.
 * DRAFT -> ACTIVE -> RETIRED; steps change only in DRAFT; nothing deleted.
 * A future Job Reference can select a version id without changing this model.
 */
export interface RoutingVersion extends WithExternalReferences {
  id?: string;
  routingId: string;
  /** Unique within its routing, e.g. "R1". */
  versionCode: string;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  notes?: string;
  steps: RoutingStep[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * ASFOUR Job Reference (Phase 1 Step 1E) - collection 'jobReferences'.
 *
 * The ASFOUR identity of a job: the document id, plus the business `code` the
 * user enters (it may come from a customer, from Odoo or anyone else). Works
 * the same with no external system; an Odoo Job Order is linked through
 * `externalRefs` (system 'odoo', model 'mrp.production'), never as the id.
 * A reference object - no routing, quantities, schedule or workflow.
 * Not the legacy customerOrderNumber / manufacturingOrderNumber /
 * customerRequestNumber, which stay free text on their records.
 * Rules: services/jobBatchPure.ts.
 */
export interface JobReference extends WithExternalReferences {
  id?: string;
  /** Business job reference, unique among job references. */
  code: string;
  /**
   * Phase 1 Step 8C: the MAIN job this one belongs to, making this record a
   * SUB-JOB (a remaining quantity, a re-run, or any other business reason -
   * the reason is the job's own notes, never inferred). A main job has none.
   * Only one level: a sub-job cannot itself be a parent.
   */
  parentJobReferenceId?: string | null;
  /** Optional Product document id - never the product code. */
  productId?: string | null;
  /** Optional Customer document id. */
  customerId?: string | null;
  status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  /** Where the job originated: 'asfour', or an external system key such as 'odoo'. */
  sourceSystem: string;
  notes?: string;
  /*
   * Execution setup (Phase 1 Step 4) - all optional, so every existing job stays
   * valid. References only: never copied BOM components or routing steps, and a
   * version retired later stays referenced. Rules: services/jobConfigurationPure.ts.
   */
  /** The logical item being produced (Step 2A) - the authoritative item identity. */
  logicalItemId?: string | null;
  /** The intended BOM version (an ACTIVE version when selected). */
  bomVersionId?: string | null;
  /** The intended routing version (an ACTIVE version when selected). */
  routingVersionId?: string | null;
  /** The associated batch / lot. */
  batchId?: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Batch (Phase 1 Step 1E) - collection 'batches'. The identity of a production /
 * stock lot: document id plus `batchNumber`. Not a production record (an event)
 * and not a product (one product has many batches); the number is never part of
 * a product code. Optional links to a product and a job reference. The
 * free-text batchNumber on historical stage records is a different, untouched
 * field. Rules and the duplicate scope: services/jobBatchPure.ts.
 */
export interface Batch extends WithExternalReferences {
  id?: string;
  batchNumber: string;
  productId?: string | null;
  jobReferenceId?: string | null;
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Optional links a FUTURE production write may carry (Phase 1 Step 1E). Not
 * applied to any existing record type yet: historical records have neither, and
 * no form writes them. A stage record type opts in when its form starts
 * selecting a job reference or batch.
 */
export interface WithProductionReferences {
  jobReferenceId?: string | null;
  batchId?: string | null;
  /** Phase 1 Step 5A: the job's logical item (never retyped on the record). */
  logicalItemId?: string | null;
  /** Phase 1 Step 5A: the Operation Master record the record's stage resolves to. */
  operationId?: string | null;
  /** Phase 1 Step 5A: optional explicit costCenterHierarchy node override. */
  hierarchyNodeId?: string | null;
}

export interface Employee {
  id?: string;
  code: string;
  name: string;
  departmentId?: string;
  departmentName?: string;
  department?: string;
  jobTitle?: string;
  phone?: string;
  active: boolean;
  employeeCodeNormalized?: string;
  nameNormalized?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Department {
  id?: string;
  code: string;
  name: string;
  description?: string;
  active: boolean;
  departmentCodeNormalized?: string;
  nameNormalized?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Financial Account - Master Data only.
 *
 * The full rationale for this being a new structure (nothing existed to reuse)
 * and the exact field list live in services/financialAccountsPure.ts. Kept
 * deliberately small: account codes and their parent/child structure, not an
 * accounting engine. No production record references a financial account.
 */
export interface FinancialAccount {
  id?: string;
  code: string;
  name: string;
  nameEn?: string;
  /** Parent account's `code`. Absent/null = a root account. */
  parentCode?: string | null;
  /** Free text as supplied by the source sheet - never a forced enum. */
  accountType?: string;
  description?: string;
  active: boolean;
  codeNormalized?: string;
  nameNormalized?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * The business role of an item: what it IS in the flow of materials, not how
 * it is labelled. Deliberately separate from product category, product type,
 * cost centre, stage and customer - none of those fields is overloaded.
 *
 * One physical item can play several roles over time (green kaolin is bought
 * raw, calcined into an intermediate, and may also be sold), so a kind is a
 * classification of the RECORD, never proof that two records are different
 * items. Rules and helpers: services/itemClassificationPure.ts.
 */
export type ItemKind = 'RAW_MATERIAL' | 'INTERMEDIATE' | 'FINISHED_PRODUCT' | 'OTHER';

export interface ProductType {
  id?: string;
  prefixCode: string; // 3 uppercase characters (e.g. BAR, BHA, BSI)
  nameEn: string; // e.g. Bricks Acid Resistance
  nameAr: string; // e.g. طوب مقاوم للأحماض
  description?: string;
  /** Default item kind for products of this type. Optional - unset means unclassified; a product's own itemKind wins. */
  itemKind?: ItemKind;
  active: boolean;
  prefixCodeNormalized?: string;
  nameNormalized?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type SmartParseStatus = 
  | 'SMART_CODE' 
  | 'UNKNOWN_PREFIX' 
  | 'MANUAL_PRODUCT_CODE' 
  | 'INVALID_FORMAT'
  | 'RECOGNIZED' 
  | 'PARTIAL' 
  | 'NOT_APPLICABLE';

export type ProductionInputUnit = 'COUNT' | 'KG' | 'TON' | 'MIXED';
export type QuantitySource = 
  | 'DIRECT_ENTRY' 
  | 'CALCULATED_FROM_COUNT' 
  | 'CALCULATED_FROM_WEIGHT' 
  | 'IMPORTED_HISTORICAL' 
  | 'MANUAL_OVERRIDE';
export type CalculationMethod = 
  | 'COUNT_X_PIECE_WEIGHT' 
  | 'DIRECT_TON' 
  | 'DIRECT_KG' 
  | 'NOT_CALCULATED';

export interface Product extends WithExternalReferences {
  id?: string;
  code: string; // Product Code (e.g. BAR250102305, 123456789, or CUSTOM-BRICK-001)
  productCode?: string; // Alias for code compatibility
  name: string; // Product Name
  productName?: string; // Alias for name
  category?: string; // Category or productTypeName
  productTypePrefix?: string; // e.g. BAR
  productTypeId?: string; // Firestore Doc ID in productTypes
  productTypeName?: string; // e.g. Bricks Acid Resistance
  productTypeNameAr?: string; // e.g. طوب مقاوم للأحماض
  productIdentifier?: string; // e.g. 0102305
  aluminaPercentage?: number | null; // e.g. 25 (optional / nullable - MUST remain null for numeric codes)
  pieceWeight?: number | null; // in kg (e.g. 4.5)
  pieceWeightKg?: number | null; // alias for pieceWeight
  defaultProductionUnit?: ProductionInputUnit; // Default input unit (COUNT, TON, MIXED)
  pieceWeightSource?: string; // Origin of piece weight data (e.g. MASTER_DATA, SMART_CODE, MANUAL)
  conversionMethod?: CalculationMethod;
  unit?: string; // e.g. "قطعة" / "كجم" / "طن"
  dimensions?: string;
  description?: string;
  isManualClassification?: boolean; // If legacy or custom override
  /** Explicit item kind for THIS product. Optional - when unset, the product type's itemKind applies, else unclassified. */
  itemKind?: ItemKind;
  /**
   * The role the reconciled master data package states for this item, e.g.
   * EXISTING_PRODUCT, RAW_MATERIAL_PURCHASED, SCRAP_REJECT_OUTPUT. Kept as the
   * source wrote it beside `itemKind` - it never replaces the ItemKind model.
   */
  businessRole?: string;
  smartParseStatus?: SmartParseStatus;
  productCodeNormalized?: string;
  nameNormalized?: string;
  productTypePrefixNormalized?: string;
  productTypeNameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;

  /**
   * Mixture/BOM support (Comprehensive Historical Import task, §14) - a
   * Product can ALSO represent a mixture/BOM composed of existing Material
   * components, reusing the existing Products/Master Data collection
   * exactly as the task instructs ("Mixtures must be stored in the existing
   * Products/Master Data architecture") rather than a new collection.
   * isMixtureBOM distinguishes the two cases; a plain product never sets it.
   */
  isMixtureBOM?: boolean;
  /** Present only when isMixtureBOM is true. Percentages always sum to 100 (normalized from source quantities - §11/§12, never trusted from embedded text alone). */
  mixtureComponents?: Array<{
    materialId: string;
    materialCode?: string;
    materialName: string;
    quantityKg: number;
    percentage: number;
  }>;
}

export interface ProductCodeParseResult {
  rawCode: string;
  normalizedCode: string;
  status: SmartParseStatus;
  smartParseStatus: SmartParseStatus;
  isValid: boolean; // true if SMART_CODE / RECOGNIZED
  isSmart?: boolean;
  prefix: string; // 3-letter prefix or empty
  productType?: ProductType;
  isUnknownPrefix: boolean;
  aluminaPercentage?: number;
  isInvalidAlumina: boolean;
  isNumericStart?: boolean;
  productIdentifier: string;
  statusMessage?: string;
  errorMessage?: string;
  suggestedNameAr?: string;
  suggestedNameEn?: string;
}

export interface Customer {
  id?: string;
  code: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  customerCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Shift {
  id?: string;
  code: string;
  name: string;
  startTime?: string;
  endTime?: string;
  hours: number;
  shiftCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Press {
  id?: string;
  code: string;
  name: string;
  tonnage?: number;
  model?: string;
  status?: 'active' | 'maintenance' | 'inactive';
  /**
   * The hierarchy node this equipment belongs to, as a stable node id.
   *
   * THIS IS THE LINK that makes the hierarchy a real business dimension.
   * A production record already names its equipment (pressId / furnaceId), and
   * the equipment now names its hierarchy node, so
   *
   *     production record -> equipment -> hierarchy node -> ancestors
   *
   * resolves without a single historical production document being touched.
   * That is the whole reason the link lives here rather than on the record.
   *
   * Stores the node's own id (costCenterHierarchy document id), never its
   * display path or code, so renaming or re-parenting a node cannot break the
   * link. Optional and nullable: equipment with no link is still a perfectly
   * valid production centre, it simply is not reached by selecting a parent.
   */
  hierarchyNodeId?: string | null;
  pressCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Furnace {
  id?: string;
  code: string;
  name: string;
  capacity?: number; // in tons
  maxTemperature?: number; // in Celsius
  status?: 'active' | 'maintenance' | 'inactive';
  /** The hierarchy node this equipment belongs to - see Press.hierarchyNodeId for why the link lives on the equipment rather than on the production record. */
  hierarchyNodeId?: string | null;
  furnaceCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Chinese Mills equipment - mirrors Press exactly. Reuses the existing (previously-unregistered) 'chineseMills' Firestore collection, already populated via Historical Import - no data migration. */
export interface Mill {
  id?: string;
  code: string;
  name: string;
  model?: string;
  status?: 'active' | 'maintenance' | 'inactive';
  /** The hierarchy node this equipment belongs to - see Press.hierarchyNodeId. Mills have no production-record reference yet, so this is stored but not yet used as a filter. */
  hierarchyNodeId?: string | null;
  millCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Tube/Ball Mills equipment (Comprehensive Historical Import task) - a
 * DISTINCT physical equipment type from `Mill` above (Chinese Mills), never
 * to be confused/merged with it. Mirrors Mill/Press/Furnace's exact shape,
 * following the SAME evolutionary precedent already established for `Mill`
 * itself: an equipment master data type that starts life populated only via
 * Historical Import's own "Code New Mill" action (collection 'tubeBallMills'),
 * not a dedicated pre-existing admin screen - see masterDataService.ts's
 * generic fetchMasterData/createMasterDataItem, called directly with this
 * collection name rather than adding a MasterDataTab entry (out of scope for
 * this task - see the panel's own comments).
 */
export interface TubeBallMill extends WithExternalReferences {
  id?: string;
  code: string;
  name: string;
  model?: string;
  status?: 'active' | 'maintenance' | 'inactive';
  /** Phase 1 Step 8C-5: TUBE or BALL; absent = not identified. */
  millKind?: TubeBallMillKind | null;
  /**
   * The hierarchy node this mill belongs to (Phase 1 Step 1D) - optional, the
   * same stable-node-id link Press/Furnace/Mill carry; see Press.hierarchyNodeId.
   * Records created before this field existed simply have none.
   */
  hierarchyNodeId?: string | null;
  millCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Storage Bunker / Silo Master Data ("البناكر", §20) - no existing
 * bunker/silo collection was found anywhere in the codebase (the current
 * TubeBallMillsRecord.storageBunker is plain free text), so this is a new,
 * minimal collection ('bunkers') following the exact same established
 * equipment-master-data pattern as Mill/TubeBallMill/Press/Furnace, not a
 * new pattern. Source data may be incomplete (§20) - only `bunkerNumber` is
 * ever required to create a review-time coding candidate; everything else
 * may be filled in later.
 */
export interface Bunker extends WithExternalReferences {
  id?: string;
  code?: string;
  bunkerNumber: string;
  name?: string;
  center?: string;
  notes?: string;
  status?: 'active' | 'maintenance' | 'inactive';
  /**
   * Optional current / default hierarchy location (Phase 1 Step 1D). Chosen by
   * the user - no hierarchy EQUIPMENT node represents a bunker, so it is never
   * derived by code reconciliation. `center` above stays the original free text.
   */
  hierarchyNodeId?: string | null;
  bunkerCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Rotary Kiln equipment master (Phase 1 Step 1D) - collection 'rotaryKilns'.
 *
 * Mirrors Mill/TubeBallMill. Until now the rotary kiln existed only as free text
 * on historical Rotary Furnace records (RotaryFurnaceRecord.machineInfo), which
 * stays exactly as stored; this is the master new setup can reference. Kept out
 * of `furnaces`, whose records are the tunnel kilns a pressing record selects.
 * Like the other equipment masters it has a single `name` (no English name).
 */
export interface RotaryKiln extends WithExternalReferences {
  id?: string;
  code: string;
  name: string;
  model?: string;
  description?: string;
  status?: 'active' | 'maintenance' | 'inactive';
  /** Optional current / default hierarchy node - see Press.hierarchyNodeId. */
  hierarchyNodeId?: string | null;
  kilnCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Furnace cars carry no hierarchyNodeId by design (Phase 1 Step 1D): a car is a
 * sub-resource of its furnace (furnaceId), and its cost location is the
 * furnace's. See equipmentMasterPure.ts.
 */
export interface FurnaceCar {
  id?: string;
  code: string;
  carNumber: string;
  furnaceId?: string;
  furnaceName?: string;
  capacity?: number;
  carCodeNormalized?: string;
  carNumberNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductionFaults {
  mechanicalFaults: number; // in minutes
  electricalFaults: number; // in minutes
  workshopFaults: number; // in minutes
  rawMaterialFaults: number; // in minutes
  furnaceFaults: number; // in minutes
  pressFaults: number; // in minutes
  otherFaults: number; // in minutes
}

/**
 * Phase 1 Step 8C-5: the source document a production record came from, as the
 * file named it - an Odoo manufacturing order reference ("كبس/MO/02492") and its
 * free-text Source column ("PS03950", "ps04097/car65/car244"). Import provenance:
 * never an id, never parsed into anything the file did not say.
 */
export interface WithSourceDocument {
  manufacturingOrderNumber?: string;
  sourceDocumentReference?: string;
}

/**
 * Phase 1 Step 8C-5: packing is a SUB-ACTIVITY of the lines that pack their own
 * output (sorting & packing, mortar / thermal concrete, rotary kiln, chinese and
 * tube / ball mills) - never a mandatory standalone production record, and never
 * on pressing, mixing, extrusion or the tunnel kiln. Optional: absent means no
 * packing was recorded. Quantities stay in their own unit - never converted.
 * Rules: services/packagingActivityPure.ts.
 */
export interface PackagingActivity {
  /** The Operation Master record for packing (OP-PACK) - set only when it resolves. */
  operationId?: string | null;
  packedQuantity?: number | null;
  packedUnit?: string | null;
  /** Number of packages, e.g. bags (شكارة). */
  packageCount?: number | null;
  packageUnit?: string | null;
  notes?: string;
}

export interface WithPackagingActivity {
  packaging?: PackagingActivity | null;
}

/**
 * Phase 1 Step 8C-5: how a pressing-stage record was formed. Extrusion is not a
 * separate record family - it is forming done on an extruder (OP-EXTRUDER).
 * Absent (every historical record) means pressing.
 */
export type FormingMethod = 'PRESSING' | 'EXTRUSION';

/**
 * Phase 1 Step 8C-5: Tube Mill and Ball Mill are distinct equipment types kept in
 * one master. Absent means the type has not been identified - never guessed.
 */
export type TubeBallMillKind = 'TUBE' | 'BALL';

/** Phase 1 Step 5A: new pressing records may carry WithProductionReferences; historical ones have none. */
export interface ProductionRecord extends ProductionFaults, WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithExternalReferences {
  /** Phase 1 Step 6: actual consumption (genealogy inputs) on new pressing entries; historical records have none. */
  materials?: MaterialConsumptionItem[];
  /** Phase 1 Step 8C-5: PRESSING or EXTRUSION; absent = pressing. */
  formingMethod?: FormingMethod;
  id?: string;
  date: string; // YYYY-MM-DD
  
  // Shift (Stable ID & Snapshots)
  shiftId: string;
  shiftName: string;
  shiftCode?: string;
  
  // Team (Stable IDs & Snapshots)
  employeeId?: string;
  employeeIds: string[];
  employeeNames: string[];
  employeeCodes: string[];
  productionEmployees?: Array<{
    id: string;
    name: string;
    code: string;
    departmentName?: string;
  }>;
  
  // Equipment (Stable IDs & Snapshots)
  pressId: string;
  pressName: string;
  pressCode?: string;
  
  furnaceId?: string;
  furnaceName?: string;
  furnaceCode?: string;
  
  furnaceCarIds?: string[];
  furnaceCarNumbers?: string[];
  /** Parallel to furnaceCarIds/furnaceCarNumbers (same index = same car). Transactional data - never stored on the Furnace Car Master Data document. */
  furnaceCarBrickCounts?: number[];
  carCode?: string;
  carCodes?: string[];
  originalFurnaceCars?: string;
  
  // Customer & Order (Stable ID & Snapshots)
  customerOrderNumber?: string;
  customerId?: string;
  customerName?: string;
  customerCode?: string;
  
  // Product & Specs (Stable ID & Snapshots)
  productId: string;
  productName: string;
  productCode: string;
  productTypePrefix?: string;
  productTypeName?: string;
  productTypeId?: string;
  aluminaPercentage: number;
  pieceWeight: number; // in kg
  
  // Quantities & Calculations (Factory Standard: TON is primary, COUNT is operational)
  productionQuantity: number; // total pressed/produced pieces
  wasteQuantity: number; // defective pieces
  goodQuantity: number; // productionQuantity - wasteQuantity
  
  // Weights (Kg)
  productionWeight: number; // productionQuantity * pieceWeight (kg) or pieceWeight * count
  goodWeight: number; // goodQuantity * pieceWeight (kg)
  wasteWeight: number; // wasteQuantity * pieceWeight (kg)

  // Weights (Tons) - Primary Factory Metric
  productionTons?: number | null; // Production in Tons
  goodTons?: number | null; // Good production in Tons
  wasteTons?: number | null; // Waste in Tons
  
  // Normalized Explicit Fields
  productionCount?: number;
  wasteCount?: number;
  goodCount?: number;
  pieceWeightKg?: number | null;
  productionKg?: number | null;
  goodKg?: number | null;
  wasteKg?: number | null;
  
  // Tracking and Provenance
  productionUnit?: ProductionInputUnit;
  quantitySource?: QuantitySource;
  calculationMethod?: CalculationMethod;
  
  // Rates & KPIs
  wastePercentage: number; // Ton-based waste % or Count-based fallback
  productionRateTonsPerHour?: number | null;
  laborProductivityTonsPerHour?: number | null;
  
  // Downtime
  totalDowntimeMinutes: number;
  totalDowntimeHours: number;
  
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface DowntimeRecord {
  id?: string;
  productionId?: string;
  date: string;
  shiftId: string;
  pressId?: string;
  furnaceId?: string;
  category: 'mechanical' | 'electrical' | 'workshop' | 'raw_material' | 'furnace' | 'press' | 'other';
  durationMinutes: number;
  reason?: string;
  createdAt?: string;
}

export interface AuditLog {
  id?: string;
  userId: string;
  username: string;
  action: 
    | 'CREATE' 
    | 'UPDATE' 
    | 'DELETE' 
    | 'LOGIN' 
    | 'LOGOUT' 
    | 'BULK_IMPORT' 
    | 'EXPORT' 
    | 'ACTIVATE' 
    | 'DEACTIVATE'
    | 'CREATE_USER'
    | 'UPDATE_USER'
    | 'ACTIVATE_USER'
    | 'DEACTIVATE_USER'
    | 'DELETE_USER'
    | 'PASSWORD_RESET_REQUESTED'
    | 'PRODUCT_TYPE_CREATE'
    | 'PRODUCT_TYPE_UPDATE'
    | 'PRODUCT_TYPE_ACTIVATE'
    | 'PRODUCT_TYPE_DEACTIVATE'
    | 'BULK_UPDATE_PRODUCT_INTELLIGENCE'
    | 'BACKUP_CREATE'
    | 'BACKUP_DELETE'
    | 'RESTORE_EXECUTE'
    | 'HISTORICAL_IMPORT_COMPLETED'
    | 'UNDO_HISTORICAL_IMPORT'
    | 'PERMISSION_UPDATE'
    | 'TRANSLATION_OVERRIDE_SET'
    | 'TRANSLATION_OVERRIDE_RESTORE'
    // System Version Management & Application Rollback (§38) - distinct from
    // BACKUP_CREATE/RESTORE_EXECUTE above, which govern Firestore DATA, never
    // the application code/deployment itself.
    | 'VERSION_CHECKPOINT_CREATED'
    | 'VERSION_MARKED_KNOWN_GOOD'
    | 'ROLLBACK_REQUESTED'
    | 'ROLLBACK_APPROVED'
    | 'ROLLBACK_STARTED'
    | 'ROLLBACK_COMPLETED'
    | 'ROLLBACK_FAILED'
    | 'ROLLBACK_CANCELLED';

  collection: string;
  documentId?: string;
  details: string;
  timestamp: string;
}

export type MasterDataTab = 
  | 'products'
  | 'productTypes'
  | 'employees' 
  | 'departments' 
  | 'presses'
  | 'furnaces'
  | 'furnaceCars'
  | 'mills'
  /** Existing collections, managed from Master Data from Phase 1 Step 1D. */
  | 'tubeBallMills'
  | 'bunkers'
  /** Rotary Kiln equipment master (Phase 1 Step 1D). */
  | 'rotaryKilns'
  /** ASFOUR Job References and Batches (Phase 1 Step 1E). */
  | 'jobReferences'
  | 'batches'
  /** Bills of Materials (Phase 1 Step 2); versions are in 'bomVersions'. */
  | 'boms'
  /** Routings (Phase 1 Step 3); versions are in 'routingVersions'. */
  | 'routings'
  | 'customers'
  | 'shifts'
  | 'materials'
  | 'machines'
  | 'stages'
  | 'financialAccounts'
  /**
   * The imported cost-centre hierarchy, now the user-facing Cost Centers
   * source. It was previously readable only through its own panel, which is
   * what let a legacy `departments` list and this tree compete as two separate
   * "cost centres" in the same screen.
   */
  | 'costCenterHierarchy';

export type NavigationPage = 
  | 'dashboard' 
  | 'production'
  | 'production-entry' 
  | 'production-records'
  | 'data-review'
  | 'historical-import'
  | 'raw-materials'
  | 'ai-assistant'
  | 'material-traceability'
  | 'data-quality'
  | 'backup-restore'
  | 'backups'
  | 'restore'
  | 'system-health'
  | 'versions'
  | 'master-data' 
  | 'bulk-entry' 
  | 'reports' 
  | 'settings' 
  | 'branding'
  | 'user-management'
  | 'admin-panel'
  | 'translation-manager'
  | 'language-audit'
  | 'ai-provider-management';

export type RecordStatus = 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'APPROVED' | 'REJECTED' | 'CORRECTED';

export type ProductionStageType = 
  | 'pressing'             // 1. التشكيل والمكابس
  | 'rotary_furnace'      // 2. الفرن الدوار
  | 'chinese_mills'       // 3. الطواحين الصينية
  | 'tube_ball_mills'     // 4. طواحين الأنابيب والكرات
  | 'mortar_concrete'     // 5. المونة والخرسانات
  | 'mixing'              // 6. الخلط والتجهيز
  | 'lightweight_foam'    // 7. الشاموت الخفيف / عزل الفوم
  | 'sorting'             // 8. الفرز والمراقبة
  // Phase 1 Step 8C-5: the remaining production areas.
  | 'thermal_concrete'    // 9. الخرسانة الحرارية
  | 'tunnel_kiln'         // 10. الفرن النفقي
  | 'handmade_brick';     // 11. الطوب اليدوي

/**
 * Draft metadata shape for the legacy stages - never read or written anywhere.
 * The configurable Operation Master below is what the `stages` collection holds.
 */
export interface ProductionStage {
  id: ProductionStageType;
  code: string;
  nameAr: string;
  nameEn: string;
  iconName: string;
  descriptionAr: string;
  order: number;
  active: boolean;
}

/**
 * Operation Master - a configurable production operation (Rotary Kiln, Pressing,
 * Packing, an extruder line...). Stored in the registered `stages` collection
 * with a Firestore auto-id; `code` is its ASFOUR business code.
 *
 * It sits BESIDE the legacy stage architecture, never in place of it:
 * ProductionStageType, STAGE_COLLECTION_NAMES and every stage collection stay
 * authoritative for historical storage. `legacyStageKey` only records which
 * legacy stage an operation corresponds to; an operation with no legacy stage
 * (a new one) is equally valid.
 *
 * Operation, cost centre and equipment stay three separate things: what process
 * runs, where its cost accumulates (`hierarchyNodeId`), and which equipment
 * categories may perform it. Rules: services/operationMasterPure.ts.
 */
export interface Operation extends WithExternalReferences {
  id?: string;
  code: string;
  nameAr: string;
  nameEn?: string;
  description?: string;
  /** Default display/sequence metadata only - NOT a routing. */
  defaultOrder?: number | null;
  /** The legacy stage this operation corresponds to, if any. */
  legacyStageKey?: ProductionStageType | null;
  /** Default cost centre: a costCenterHierarchy document id, the same link convention equipment uses. */
  hierarchyNodeId?: string | null;
  /** Equipment Master Data category ids that may perform this operation. */
  allowedEquipmentCategoryIds?: string[];
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Material extends WithExternalReferences {
  id?: string;
  code: string;
  name: string;
  unit: string; // e.g. "كجم", "طن", "شيكارة"
  category?: string;
  description?: string;
  density?: number;
  currentStock?: number;
  reorderLevel?: number;
  costPerUnit?: number;
  notes?: string;
  /** Optional (Comprehensive Historical Import task, §13) - mirrors Product.aluminaPercentage's exact meaning for a raw material, e.g. detected from an embedded "جريت40%" pattern during import. Never guessed - only set when explicitly present in the source or already on the record. */
  aluminaPercentage?: number | null;
  /** Explicit item kind for this material. Optional - unset means unclassified. Not implied by living in `materials`. */
  itemKind?: ItemKind;
  /** The role the reconciled master data package states, e.g. RAW_MATERIAL_PURCHASED - kept as written. */
  businessRole?: string;
  materialCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Machine {
  id?: string;
  code: string;
  name: string;
  stageType: ProductionStageType;
  model?: string;
  capacity?: number;
  active: boolean;
  machineCodeNormalized?: string;
  nameNormalized?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MaterialConsumptionItem {
  /** The consumed SOURCE record id - a material, or (new writes, itemSource 'products') a product. */
  materialId: string;
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: string;
  /*
   * Actual consumption (Phase 1 Step 5B) - optional fields written by new
   * entries only; historical lines have none of them and stay valid.
   * Rules: services/actualConsumptionPure.ts.
   */
  /** Stable line id (L1, L2, ...). */
  lineId?: string;
  /** Display order 1..n - not an identity. */
  sequence?: number;
  /** Where materialId lives; absent (historical) means 'materials'. */
  itemSource?: 'products' | 'materials';
  /** Set only when the source already resolves to an active logical item - never created. */
  logicalItemId?: string | null;
  notes?: string;
  /** Phase 1 Step 6: the input batch (lot) this line was drawn from - the genealogy input link. */
  batchId?: string | null;
  /**
   * Phase 1 Step 7A: recorded as BASE formula or ADDITIVE consumption - chosen by
   * the user, never inferred from the BOM. Absent on historical lines = BASE.
   */
  componentType?: 'BASE' | 'ADDITIVE';
}

/**
 * One OUTPUT of a production record (Phase 1 Step 6) - what came out, of which
 * batch, how much, of which kind. Inputs are the record's consumption lines;
 * there is no separate input line. Rules: services/productionGenealogyPure.ts.
 */
export interface ProductionOutputLine {
  lineId: string;
  sequence: number;
  /** The produced item's real record: a product or a material. */
  itemSource: 'products' | 'materials';
  itemId: string;
  itemCode: string;
  itemName: string;
  /** Set only when the item already resolves to an active logical item - never created. */
  logicalItemId?: string | null;
  /** The output lot - required for PRIMARY and BYPRODUCT, optional for SCRAP. Selected, never generated. */
  batchId?: string | null;
  quantity: number;
  unit: string;
  outputType: 'PRIMARY' | 'BYPRODUCT' | 'SCRAP';
  notes?: string;
}

/**
 * Genealogy fields a NEW production record may carry (Phase 1 Step 6). The two
 * id lists make "which records consumed / produced batch X" queryable with
 * array-contains, since Firestore cannot query inside arrays of objects.
 */
export interface WithProductionGenealogy {
  productionOutputs?: ProductionOutputLine[];
  genealogyInputBatchIds?: string[];
  genealogyOutputBatchIds?: string[];
}

export interface StageWorkerItem {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  role?: 'production' | 'maintenance' | 'operator' | 'helper' | 'supervisor';
  hours?: number;
}

// Stage 2: Rotary Furnace Record
export interface RotaryFurnaceRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithPackagingActivity, WithExternalReferences {
  id?: string;
  date: string;
  operationPeriod?: string;
  batchNumber?: string;
  productId: string;
  productCode: string;
  productName: string;
  productOperatingHours?: number;
  
  // Consumption Mode: 'batch' or 'per_ton'
  consumptionMode: 'batch' | 'per_ton';
  gasConsumption: number; // m3 or units
  electricityConsumption: number; // kWh
  gasPerTon?: number;
  electricityPerTon?: number;
  
  // Materials used (Multiple)
  materials: MaterialConsumptionItem[];
  
  // Labor
  productionWorkers: StageWorkerItem[];
  maintenanceWorkers: StageWorkerItem[];
  
  productionQuantity: number; // in tons or units
  wasteQuantity: number;
  goodQuantity: number;
  wastePercentage: number;
  
  downtimeMinutes: number;
  faultType?: string;
  machineInfo?: string;
  shiftId: string;
  shiftName: string;
  
  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Stage 3: Chinese Mills Record
export interface ChineseMillsRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithPackagingActivity, WithExternalReferences {
  /** Phase 1 Step 6: actual consumption (genealogy inputs) on new entries; historical records have none. */
  materials?: MaterialConsumptionItem[];
  id?: string;
  date: string;
  customerId?: string;
  customerCode?: string;
  customerName?: string;
  specificationCode?: string;
  /** Resolved against Master Data Products from the "المواصفة" import column (Master Data Consolidation task) - specification/specificationCode above stay as the original free-text display values. */
  productId?: string;
  productCode?: string;
  productName?: string;
  millType: string;
  shiftType: string;
  quantity: number;
  numberOfBags: number;
  rejectedQuantity: number;
  operatingDays: number;
  operatingHours: number;
  totalOperatingTimeHours: number;
  downtimeHours: number;
  faultType?: string;
  specification?: string;
  weightCategory?: string;
  dayName?: string;
  theoreticalRatePerHour?: number;
  actualRatePerHour?: number;
  efficiencyPercentage?: number;
  
  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Stage 4: Tube & Ball Mills Record
export interface TubeBallMillsRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithPackagingActivity, WithExternalReferences {
  /** Phase 1 Step 6: actual consumption (genealogy inputs) on new entries; historical records have none. */
  materials?: MaterialConsumptionItem[];
  id?: string;
  date: string;
  millType: string;
  /** Resolved against the 'tubeBallMills' Master Data collection (Comprehensive Historical Import task) - millType above stays the original free-text display value, exactly mirroring ChineseMillsRecord's own millType/millTypeId split. Optional: the existing manual TubeBallMillsEntryForm never resolves this and continues to work unchanged. */
  millTypeId?: string;
  millTypeName?: string;
  rawMaterialType: string;
  /** Resolved against Material Master Data (single material) OR a mixture/BOM Product (isMixtureBOM) - never both. */
  materialId?: string;
  materialCode?: string;
  materialName?: string;
  isMixtureMaterial?: boolean;
  /** Only for a single (non-mixture) raw material with an embedded alumina percentage detected during Historical Import (e.g. "جريت40%") - never set for a mixture/BOM row, never invented when not present in the source. */
  aluminaPercentage?: number | null;
  operatingHours: number;
  tonsPerHour: number;
  storageBunker?: string;
  /** Per-bunker allocation of totalTons when the Historical Import resolved multiple bunkers (§19-22) - the existing manual entry form's single free-text storageBunker above is always still populated (joined) for backward-compatible display/reporting. */
  bunkerAllocations?: Array<{ bunkerId?: string; bunkerCode?: string; bunkerNumber: string; allocatedTons: number }>;
  totalTons: number;

  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Stage 5: Mortar & Concrete Record
export interface MortarConcreteRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithPackagingActivity, WithExternalReferences {
  id?: string;
  date: string;
  productId: string;
  productCode: string;
  productName: string;
  customerId?: string;
  customerCode?: string;
  customerName?: string;
  batchNumber?: string;
  manufacturingOrderNumber?: string;
  customerRequestNumber?: string;
  productionQuantity: number;
  materials: MaterialConsumptionItem[];
  operatingHours: number;
  workers: StageWorkerItem[];
  
  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Stage 6: Mixing Record
export interface MixingRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithExternalReferences {
  id?: string;
  date: string;
  mixProductName: string;
  mixProductCode?: string;
  materials: MaterialConsumptionItem[];
  workers: StageWorkerItem[];
  productionQuantity: number;
  operatingHours: number;
  batchNumber?: string;
  wasteQuantity?: number;
  yieldPercentage?: number;
  
  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Stage 7: Lightweight Foam Record
export interface LightweightFoamRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithExternalReferences {
  id?: string;
  date: string;
  productName: string;
  productCode?: string;
  materials: MaterialConsumptionItem[];
  workers: StageWorkerItem[];
  productionQuantity: number;
  operatingHours: number;
  batchNumber?: string;
  wasteQuantity?: number;
  yieldPercentage?: number;
  
  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Stage 8: Sorting / Inspection Record
export interface SortingRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithPackagingActivity, WithExternalReferences {
  /** Phase 1 Step 6: actual consumption (genealogy inputs) on new entries; historical records have none. */
  materials?: MaterialConsumptionItem[];
  id?: string;
  date: string;
  dischargeDate?: string;
  customerOrderNumber?: string;
  truckNumber?: string;
  customerId?: string;
  customerCode?: string;
  customerName?: string;
  productId: string;
  productCode: string;
  productName: string;
  pieceWeight: number; // in kg
  ratioCode?: string;
  
  totalCount: number;
  totalTons: number;
  goodCount: number;
  goodTons: number;
  brokenCount: number;
  brokenTons: number;
  
  // Defect breakdown categories (Preserving Arabic factory terminology)
  shiverDefectCount: number;      // شطف
  crackDefectCount: number;       // شروخ
  ironDefectCount: number;        // بقع حديد
  contaminationDefectCount: number; // شوائب
  kilnDefectCount: number;        // حريق فرن
  returnDefectCount: number;      // مرتجع
  returnTons?: number;
  returnType?: string;
  
  month?: string;
  goodPercentage?: number;
  brokenPercentage?: number;
  returnPercentage?: number;
  
  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

/*
 * Phase 1 Step 8C-5 - the remaining production areas. Each record reuses the
 * shape of the closest existing stage instead of inventing one:
 *   thermal concrete  the Mortar & Concrete record (a castable is a composite mix)
 *   tunnel kiln       firing: green bricks in, fired bricks out, on a furnace and
 *                     its cars (the pressing record's furnace fields)
 *   hand-made brick   forming by hand: pieces and piece weight (the pressing
 *                     measure), no press
 * Labour and energy stay optional; no meter is assumed.
 */

// Stage 9: Thermal Concrete Record
export interface ThermalConcreteRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithPackagingActivity, WithExternalReferences {
  id?: string;
  date: string;
  productId: string;
  productCode: string;
  productName: string;
  customerId?: string;
  customerCode?: string;
  customerName?: string;
  batchNumber?: string;
  customerRequestNumber?: string;
  /** In tons (طن), as the mortar record. */
  productionQuantity: number;
  materials: MaterialConsumptionItem[];
  operatingHours?: number;
  workers?: StageWorkerItem[];

  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Stage 10: Tunnel Kiln Record
export interface TunnelKilnRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithExternalReferences {
  id?: string;
  date: string;
  /** The fired product. */
  productId: string;
  productCode: string;
  productName: string;
  batchNumber?: string;
  /** Fired output in tons (طن) - the unit the source records. */
  productionQuantity: number;
  wasteQuantity?: number | null;
  /** The green bricks fired (and their batches) - actual consumption. */
  materials: MaterialConsumptionItem[];
  /** The kiln - the existing Furnaces master, as on a pressing record. */
  furnaceId?: string;
  furnaceCode?: string;
  furnaceName?: string;
  /** The cars fired - car numbers as the source gives them, as on a pressing record. */
  furnaceCarIds?: string[];
  furnaceCarNumbers?: string[];
  operatingHours?: number;
  workers?: StageWorkerItem[];

  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Stage 11: Hand-made Brick Record
export interface HandmadeBrickRecord extends WithProductionReferences, WithProductionGenealogy, WithSourceDocument, WithExternalReferences {
  id?: string;
  date: string;
  productId: string;
  productCode: string;
  productName: string;
  batchNumber?: string;
  /** Pieces formed (قطعة), as the pressing record. */
  productionQuantity: number;
  /** Optional kg per piece; tons are derived only when it is given. */
  pieceWeightKg?: number | null;
  wasteQuantity?: number | null;
  materials: MaterialConsumptionItem[];
  operatingHours?: number;
  workers?: StageWorkerItem[];

  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

/*
 * ===========================================================================
 * Phase 1 Step 8D - the Odoo historical manufacturing import (three files).
 *
 * THREE SOURCES, NEVER MERGED BY HAND: mrp.production, mrp.workorder and
 * stock.scrap are uploaded as they were exported, parsed separately, kept as
 * raw rows, normalised, linked and only then - after review and approval -
 * written into the existing ASFOUR collections.
 *
 * RAW STAYS RAW. Every staged row keeps the original Excel row, its file,
 * sheet and row number, the normalised shape, any correction, and its
 * validation outcome (services/odooImportSessionPure.ts).
 * ===========================================================================
 */

/** The three Odoo reports this import reads. */
export type OdooSourceType = 'MRP_PRODUCTION' | 'MRP_WORKORDER' | 'STOCK_SCRAP';

/** Where one normalised value came from - kept on every staged row and on what is written. */
export interface ImportProvenance {
  importSessionId: string;
  sourceFile: string;
  sourceType: OdooSourceType;
  sourceSheet: string;
  /** The Excel row number (header = 1). */
  sourceRow: number;
  /** The external system the row came from, e.g. 'odoo'. */
  sourceSystem: string;
  /** The normalisation rule applied, when one was (e.g. a Work Center alias). */
  normalizationRule?: string | null;
}

/** How a raw Odoo Work Center name resolved - raw text is never replaced. */
export type WorkCenterResolutionStatus = 'RESOLVED' | 'UNMAPPED_CENTER' | 'NO_STAGE_MAPPING' | 'EMPTY';

export interface WorkCenterResolution {
  /** Exactly what the source said. */
  raw: string;
  /** The ASFOUR main production centre id, or null when the name is not in the registry. */
  mainCenterId: string | null;
  mainCenterNameAr: string | null;
  /** The production record type this centre writes to, or null when it has none yet. */
  stageType: ProductionStageType | null;
  /** The specific machine named inside the raw text, when it names one. */
  equipmentName: string | null;
  /** TUBE or BALL when the raw text says so - never inferred otherwise. */
  millKind?: TubeBallMillKind | null;
  /** The alias that matched, and the rule that produced this result. */
  matchedAlias: string | null;
  rule: string;
  status: WorkCenterResolutionStatus;
}

/**
 * A work order (Odoo mrp.workorder) - collection 'workOrders'. Its own record:
 * it carries the work centre, the equipment, the raw work-order text (NEVER
 * globally read as a shift) and the employees the source listed. It never
 * replaces a production record and never carries good production of its own.
 */
export interface WorkOrderRecord extends WithExternalReferences {
  id?: string;
  /** The MO reference exactly as the source wrote it. */
  manufacturingOrderNumber: string;
  /** The ASFOUR production record this work order produced, when one was written. */
  productionRecordId?: string | null;
  productionCollection?: string | null;
  /** The raw work-order text ("1", "2", "فرز", ...). Never rewritten. */
  rawWorkOrder: string;
  /** Only set when the stage's own semantics say the work order is a shift. */
  shiftNumber?: number | null;
  workCenter: WorkCenterResolution;
  stageType?: ProductionStageType | null;
  productCode?: string | null;
  productName?: string | null;
  productId?: string | null;
  bomCode?: string | null;
  quantity?: number | null;
  secondaryQuantity?: number | null;
  unit?: string | null;
  realDurationMinutes?: number | null;
  expectedDurationMinutes?: number | null;
  durationPerUnit?: number | null;
  durationDeviation?: number | null;
  state?: string | null;
  date?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  /** The employees the source named on this work order (never invented, never counted for the user). */
  employees?: StageWorkerItem[];
  provenance: ImportProvenance;
  status: RecordStatus;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * A scrap record (Odoo stock.scrap) - collection 'stockScrap'. stock.scrap is
 * the ONLY source that creates one; scrap columns in the other two reports are
 * cross-checks. Many scrap records per MO are normal. Scrap is never good
 * production and is never subtracted from a production quantity here.
 */
export interface ScrapRecord extends WithExternalReferences {
  id?: string;
  date: string;
  manufacturingOrderNumber?: string | null;
  productionRecordId?: string | null;
  productionCollection?: string | null;
  workOrderId?: string | null;
  rawWorkOrder?: string | null;
  workCenter?: WorkCenterResolution | null;
  stageType?: ProductionStageType | null;
  productCode?: string | null;
  productName?: string | null;
  productId?: string | null;
  quantity: number;
  unit: string;
  reference?: string | null;
  scrapLocation?: string | null;
  sourceLocation?: string | null;
  state?: string | null;
  provenance: ImportProvenance;
  status: RecordStatus;
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** A disagreement between two sources about the same logical record - never resolved by guessing. */
export interface ImportSourceConflict {
  /** The logical entity the two values describe, e.g. "MO/00386-003". */
  logicalKey: string;
  field: string;
  sourceA: OdooSourceType;
  valueA: unknown;
  rowA: number;
  fileA: string;
  sourceB: OdooSourceType;
  valueB: unknown;
  rowB: number;
  fileB: string;
  severity: 'WARNING' | 'BLOCKING';
  resolutionStatus: 'OPEN' | 'RESOLVED' | 'ACCEPTED';
  resolvedValue?: unknown;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  messageAr: string;
  messageEn: string;
}

/** A row that belongs to nothing - reported, never attached to a neighbour and never discarded. */
export type ImportOrphanKind =
  | 'WORK_ORDER_WITHOUT_MO'
  | 'SCRAP_WITHOUT_MO'
  /** A manufacturing order with no work order: kept and reviewable, but no production centre is invented for it. */
  | 'MO_WITHOUT_WORK_ORDER'
  | 'UNRESOLVED_WORK_CENTER'
  | 'UNRESOLVED_PRODUCT'
  | 'UNRESOLVED_STAGE';

/** One staged row of an Odoo import session - collection 'importStagingRows'. */
export interface ImportStagingRow {
  id?: string;
  importSessionId: string;
  rowId: string;
  sourceType: OdooSourceType;
  /** Exactly what the file said - written once, never rewritten. */
  rawRow: Record<string, unknown>;
  /** The ASFOUR shape derived from the raw row. */
  normalizedRow: Record<string, unknown> | null;
  /** Only the fields a reviewer changed. */
  correctedRow: Record<string, unknown> | null;
  status: string;
  selection: string;
  errors: Array<{ field: string; messageAr: string; messageEn: string }>;
  warnings: Array<{ field: string; messageAr: string; messageEn: string }>;
  orphanKinds?: ImportOrphanKind[];
  /** The MO this row belongs to, once linked. */
  linkedManufacturingOrder?: string | null;
  linkedRowIds?: string[];
  provenance: ImportProvenance;
  importedId?: string | null;
  importedCollection?: string | null;
  failureMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** An Odoo import session - collection 'importSessions'. Survives a reload. */
export interface ImportSessionRecord {
  id?: string;
  importSessionId: string;
  status: 'DRAFT' | 'REVIEW' | 'PARTIALLY_IMPORTED' | 'COMPLETED' | 'CANCELLED';
  files: Array<{ sourceType: OdooSourceType; fileName: string; sheetName: string; rowCount: number; uploadedAt: string }>;
  counts: Record<string, number>;
  conflicts: ImportSourceConflict[];
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
}

/** A Work Center mapping a user approved - collection 'workCenters'. The code registry stays authoritative. */
export interface WorkCenterMapping {
  id?: string;
  /** The raw Odoo work-centre text, normalised for comparison only. */
  rawNormalized: string;
  raw: string;
  mainCenterId: string;
  equipmentName?: string | null;
  approvedBy?: string | null;
  approvedAt?: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Generic Unified Stage Record for unified query & review
export interface UniversalStageRecord {
  id: string;
  stageType: ProductionStageType;
  stageNameAr: string;
  date: string;
  productId?: string;
  productCode?: string;
  productName?: string;
  customerId?: string;
  customerName?: string;
  quantity: number;
  unit: string;
  productionTons?: number | null;
  goodTons?: number | null;
  wasteTons?: number | null;
  productionCount?: number;
  wasteQuantity?: number;
  goodQuantity?: number;
  pieceWeightKg?: number | null;
  totalDowntimeMinutes?: number;
  gasConsumption?: number;
  electricityConsumption?: number;
  gasPerTon?: number | null;
  electricityPerTon?: number | null;
  materials?: MaterialConsumptionItem[];
  workers?: StageWorkerItem[];
  status: RecordStatus;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt: string;
  rawData?: any;
}

export interface RecordAuditLog {
  id?: string;
  recordId: string;
  stageType: ProductionStageType | 'pressing';
  collection: string;
  action: 'CREATE' | 'UPDATE' | 'STATUS_CHANGE' | 'APPROVE' | 'REJECT' | 'CORRECT';
  changedByUid: string;
  changedByName: string;
  changedAt: string;
  oldStatus?: RecordStatus;
  newStatus?: RecordStatus;
  oldValue?: Record<string, any>;
  newValue?: Record<string, any>;
  reason: string;
}

export interface MultiDimensionFilter {
  startDate?: string;
  endDate?: string;
  stageType?: ProductionStageType | 'all';
  employeeId?: string;
  departmentId?: string;
  shiftId?: string;
  productId?: string;
  productTypeId?: string;
  customerId?: string;
  pressId?: string;
  furnaceId?: string;
  machineId?: string;
  status?: RecordStatus | 'all';
  searchQuery?: string;
}

export interface ProductionFilter {
  startDate?: string;
  endDate?: string;
  shiftId?: string;
  pressId?: string;
  furnaceId?: string;
  productId?: string;
  customerId?: string;
  employeeId?: string;
  searchQuery?: string;
}

export interface DashboardKPIs {
  // Factory Primary Metric: TON
  totalProductionTons: number;
  totalGoodTons: number;
  totalWasteTons: number;
  
  // Operational Counts & Weights (Kg)
  totalProductionCount: number;
  totalGoodCount: number;
  totalWasteCount: number;
  wastePercentage: number;
  totalProductionWeightKg: number;
  totalGoodWeightKg: number;
  totalWasteWeightKg: number;
  
  // Downtime & Production Rates
  totalDowntimeMinutes: number;
  totalDowntimeHours: number;
  totalRecordsCount: number;
  productionRateTonsPerHour?: number;
  recordsWithMissingPieceWeightCount?: number;
}

export type BulkImportRowStatus = 
  | 'valid' 
  | 'error' 
  | 'duplicate'
  | 'NEW'
  | 'DUPLICATE_IN_FILE'
  | 'DUPLICATE_IN_FIRESTORE'
  | 'UNKNOWN_PRODUCT_TYPE'
  | 'INVALID';

export interface BulkImportRow {
  rowNumber: number;
  data: Record<string, any>;
  status: BulkImportRowStatus;
  errors: string[];
  derivedData?: {
    productCode: string;
    productName: string;
    prefix: string;
    productTypeName?: string;
    productTypeNameAr?: string;
    aluminaPercentage?: number;
    productIdentifier?: string;
    isUnknownPrefix?: boolean;
    isInvalidAlumina?: boolean;
  };
}

export interface BulkImportResult {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  errorRows: number;
  unknownTypeRows?: number;
  duplicateInFileRows?: number;
  duplicateInFirestoreRows?: number;
  importedRows: number;
  /** Phase 4F: rows that passed preview-time validation but were caught by the final live duplicate recheck immediately before write (a record with the same code was created by someone else during the review window) - never silently written, never counted as imported. */
  blockedByFinalRecheckRows?: number;
}

export interface SystemTestStepResult {
  stepId: number;
  stepName: string;
  category: 'AUTH' | 'FIRESTORE' | 'ADMIN' | 'CALCULATIONS' | 'MASTER_DATA' | 'COLLECTIONS' | 'SECURITY';
  status: 'PASS' | 'FAIL' | 'WARN';
  details: string;
  durationMs?: number;
}

export interface SystemTestReport {
  passed: boolean;
  timestamp: string;
  durationMs: number;
  results: SystemTestStepResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warned: number;
  };
}

export type BackupType = 'MANUAL' | 'SCHEDULED' | 'PRE_IMPORT' | 'PRE_MIGRATION' | 'SAFETY_CHECKPOINT';
export type BackupStatus = 'SUCCESS' | 'FILE_READY_METADATA_FAILED' | 'PARTIAL' | 'FAILED' | 'IN_PROGRESS';

// VALID: calculated SHA-256 matches the stored checksum.
// INVALID: calculated SHA-256 does NOT match the stored checksum (tampered/corrupted file) - restore MUST NOT proceed.
// MISSING: the backup metadata has no checksum at all - integrity cannot be fully verified.
export type ChecksumStatus = 'VALID' | 'INVALID' | 'MISSING';

export interface SystemBackup {
  id: string;
  backupId: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  type: BackupType;
  schemaVersion: number;
  appVersion: string;
  buildId: string;
  status: BackupStatus;
  notes?: string;
  collections: string[];
  recordCounts: Record<string, number>;
  totalRecords: number;
  sizeBytes: number;
  checksum: string;
  storageLocation?: 'LOCAL_JSON' | 'CLOUD_MANAGED' | 'SESSION_MEMORY';
  fileName?: string;
  retentionTag?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  dataPayload?: string; // In-memory/session JSON serialized backup data (NOT persisted to Firestore doc)
  errorMessage?: string;
}

export interface RestorePreview {
  backupId: string;
  createdAt: string;
  appVersion: string;
  schemaVersion: number;
  totalRecords: number;
  collectionDiffs: {
    collectionName: string;
    currentCount: number;
    backupCount: number;
    diff: number;
  }[];
}

export interface RestoreResult {
  success: boolean;
  safetyBackupId?: string;
  restoredCollections: string[];
  totalRestored: number;
  durationMs: number;
  errors: string[];
  timestamp: string;
  checksumStatus: ChecksumStatus;
}

export interface RemoteVersionManifest {
  version: string;
  buildId: string;
  buildTimestamp: string;
  gitCommit: string;
  deploymentId: string;
  databaseSchemaVersion: number;
  mandatory?: boolean;
  releaseNotes?: string;
}

/**
 * ASFOUR ERP - System Version Management & Application Rollback.
 *
 * CRITICAL DISTINCTION: this governs the APPLICATION CODE / DEPLOYED BUILD
 * version only - never Firestore data. Firestore data rollback/undo stays
 * on the EXISTING, separate systems: BackupMetadata/RestoreResult above
 * (full-database backup/restore), ImportAuditEntry (historical import undo),
 * RowVersion (per-row import edit history). None of the types below ever
 * read or write a production/masterData/stage_* collection.
 */
export type SystemVersionDeploymentStatus = 'DEPLOYING' | 'HEALTH_CHECK' | 'HEALTHY' | 'FAILED' | 'ROLLED_BACK';

export type SystemVersionHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';

export interface HealthCheckItemResult {
  name: string;
  nameAr: string;
  nameEn: string;
  passed: boolean;
  detail?: string;
  durationMs?: number;
}

export interface HealthCheckResult {
  overall: SystemVersionHealthStatus;
  checkedAt: string;
  checks: HealthCheckItemResult[];
}

export interface SystemVersionRecord {
  id?: string;
  versionLabel: string; // semantic MAJOR.MINOR.PATCH where practical (§24)
  /** Immutable Git commit SHA - the authoritative version identity (§18/§24). Never a branch name or human label alone. */
  commitSha: string;
  branch: string;
  buildId: string;
  deploymentId?: string;
  deploymentReference?: string;
  environment: 'production' | 'staging' | 'development';
  status: SystemVersionDeploymentStatus;
  health: SystemVersionHealthStatus;
  lastHealthCheck?: HealthCheckResult;
  isKnownGood: boolean;
  knownGoodBy?: string;
  knownGoodByName?: string;
  knownGoodAt?: string;
  releaseNotes?: string;
  /** True only for the 3 pre-existing entries seeded from config/appVersion.ts's static changelog, which predate this system and only ever had a human label ("main-v3.2.0") rather than a real commit SHA - never offered as a rollback target (§18 CRITICAL). */
  isLegacyRecord?: boolean;
  /** RELEASE = a normal checkpoint (§5); PRE_ROLLBACK_CHECKPOINT = auto-created for the CURRENT version immediately before a rollback executes (§10), linked back via linkedRollbackId. */
  checkpointType: 'RELEASE' | 'PRE_ROLLBACK_CHECKPOINT';
  linkedRollbackId?: string;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
  updatedAt?: string;
}

export type RollbackStatus = 'REQUESTED' | 'APPROVED' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'REVERTED' | 'CANCELLED';

export type RollbackReasonCategory =
  | 'REGRESSION'
  | 'BROKEN_DEPLOYMENT'
  | 'INCORRECT_FEATURE'
  | 'PERFORMANCE_ISSUE'
  | 'SECURITY_ISSUE'
  | 'DATA_DISPLAY_ISSUE'
  | 'OTHER';

export interface RollbackOperation {
  id?: string; // rollbackId
  fromVersionId: string;
  fromVersionLabel: string;
  fromCommitSha: string;
  toVersionId: string;
  toVersionLabel: string;
  toCommitSha: string;
  requestedBy: string;
  requestedByName?: string;
  approvedBy?: string;
  approvedByName?: string;
  /** §14: optional two-person approval - configurable, never a hard blocker when only one SUPER_ADMIN exists (the requester and approver may be the same SUPER_ADMIN in that case). */
  requiresTwoPersonApproval: boolean;
  isEmergency: boolean;
  reason: string;
  reasonCategory: RollbackReasonCategory;
  status: RollbackStatus;
  requestedAt: string;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
  preRollbackHealthCheck?: HealthCheckResult;
  postRollbackHealthCheck?: HealthCheckResult;
  deploymentReference?: string;
  /** The systemVersions doc id of the PRE_ROLLBACK_CHECKPOINT created for the CURRENT version before this rollback executed (§10/§12's "checkpointReference"). */
  checkpointVersionId?: string;
  failureDetails?: string;
  cancelledBy?: string;
  cancelledByName?: string;
  cancelReason?: string;
}

/**
 * Furnace Car + Brick Count structured pair, parsed from the new
 * "CAR-BRICKS/CAR-BRICKS" business format (see multiCodeParser.ts::parseFurnaceCarBrickPairs).
 * Only `carNumber` is ever a Master Data identity; `brickCount` is always
 * transactional/import data and must never be treated as a Furnace Car code.
 */
export interface FurnaceCarBrickPair {
  raw: string;
  carNumber: string;
  brickCountRaw: string;
  brickCount: number | null;
  isValid: boolean;
  errorReason?: 'MISSING_BRICK_COUNT' | 'INVALID_BRICK_COUNT' | 'MISSING_CAR_NUMBER' | 'MALFORMED';
}

export type PressingImportStatus =
  | 'NEW'
  | 'VALID'
  | 'WARNING'
  | 'DUPLICATE'
  | 'DUPLICATE_IN_FILE'
  | 'DUPLICATE_IN_DATABASE'
  | 'UNKNOWN_EMPLOYEE'
  | 'EMPLOYEE_MISMATCH'
  | 'UNKNOWN_PRODUCT'
  | 'PRODUCT_MISMATCH'
  | 'UNKNOWN_PRESS'
  | 'UNKNOWN_FURNACE_CAR'
  | 'INVALID_SHIFT'
  | 'INVALID_DATE'
  | 'INVALID_NUMBER'
  | 'FAULT_TOTAL_MISMATCH'
  | 'MISSING_PIECE_WEIGHT'
  | 'INVALID_ROW'
  | 'DUPLICATE_FURNACE_CAR'
  | 'INCOMPLETE_FURNACE_CAR_ENTRY'
  /** Phase 4F.2: the final live pre-write duplicate recheck could not be completed for this row (e.g. a transient Firestore query error) - distinct from DUPLICATE_IN_DATABASE (a CONFIRMED duplicate). Fails closed: the row is blocked from import until it can be successfully re-verified, never silently written. */
  | 'DUPLICATE_RECHECK_FAILED';

export interface RowFieldChange {
  fieldName: string;
  oldValue: any;
  newValue: any;
}

/**
 * One versioned, revertible snapshot of a PressingImportRow's editable data
 * (§11-16). Append-only - reverting to an earlier version creates a NEW
 * version with source 'REVERT', it never deletes or rewrites history.
 */
export interface RowVersion {
  editId: string;
  importId: string;
  rowId: number;
  timestamp: string;
  userId: string;
  reason: string;
  source: 'ORIGINAL' | 'FULL_ROW_EDIT' | 'FIELD_EDIT' | 'BULK_REPAIR' | 'REVERT';
  beforeData: Record<string, any>;
  afterData: Record<string, any>;
  changedFields: RowFieldChange[];
  validationBefore: { status: string; errorCount: number; errors: string[] };
  validationAfter: { status: string; errorCount: number; errors: string[] };
}

export interface PressingImportRow {
  rowIndex: number;
  raw: Record<string, any>;
  date: string;
  
  // Workers
  worker1Name: string;
  worker1Code: string;
  resolvedWorker1?: { id: string; name: string; code: string; departmentName?: string };
  worker2Name?: string;
  worker2Code?: string;
  resolvedWorker2?: { id: string; name: string; code: string; departmentName?: string };
  productionEmployees?: Array<{ id: string; name: string; code: string; departmentName?: string }>;
  employeeIds?: string[];
  employeeNames?: string[];
  employeeCodes?: string[];
  
  // Furnace Cars + Brick Count (CAR-BRICKS/CAR-BRICKS pair format - see multiCodeParser.ts::parseFurnaceCarBrickPairs)
  furnaceCarsRaw: string;
  /** Car numbers only (extracted from furnaceCarBrickPairs), kept for any code still comparing plain identifiers. */
  furnaceCarTokens?: string[];
  /** Full parsed CAR-BRICKS pairs for this row, including invalid/incomplete ones for review-matrix display. */
  furnaceCarBrickPairs?: FurnaceCarBrickPair[];
  resolvedFurnaceCars: Array<{ id?: string; code: string; carNumber: string; brickCount?: number | null }>;
  furnaceCarNumbers: string[];
  furnaceCarIds: string[];
  /** Parallel to furnaceCarIds/furnaceCarNumbers - brick count is transactional, never Master Data. */
  furnaceCarBrickCounts?: number[];
  carCodes: string[];
  
  // Press
  pressRaw: string;
  resolvedPress?: { id: string; name: string; code: string };
  
  // Customer & Order
  customerOrder: string;
  resolvedCustomerId?: string;
  resolvedCustomerName?: string;
  
  // Shift
  shiftRaw: string | number;
  resolvedShift?: { id: string; name: string; code: string; hours?: number };
  
  // Product & Specs
  productCodeRaw: string;
  productNameRaw: string;
  resolvedProduct?: { id: string; name: string; code: string; pieceWeight?: number; aluminaPercentage?: number };
  productTypePrefix?: string;
  productTypeName?: string;
  aluminaPercentage: number;
  pieceWeight: number;
  
  // Quantities & Calculations
  productionQuantity: number;
  wasteQuantity: number;
  goodQuantity: number;
  wastePercentage: number;
  productionWeight: number;
  goodWeight: number;
  wasteWeight: number;
  
  // Downtime / Faults
  mechanicalFaults: number;
  electricalFaults: number;
  workshopFaults: number;
  rawMaterialFaults: number;
  otherFaults: number;
  calculatedTotalFaults: number;
  excelTotalFaults?: number;
  
  // Status & Diagnostics
  status: PressingImportStatus;
  errors: string[];
  warnings: string[];
  isDuplicate: boolean;
  duplicateType?: 'FILE' | 'DATABASE';

  // Partial-import row selection (orthogonal to `status`/`errors`, which
  // reflect DATA VALIDITY - this reflects the user's explicit decision on
  // whether the row participates in the final Firestore write). Undefined
  // is treated as 'INCLUDED' (opt-out default). `raw` above already serves
  // as the untouched original Excel row for audit - no separate
  // originalRowData/correctedRowData copy is needed for this.
  rowSelection?: 'INCLUDED' | 'EXCLUDED';
  /** Set only when rowSelection becomes 'EXCLUDED', for audit/report distinction between the three user actions. */
  exclusionReason?: 'USER_DESELECTED' | 'SKIPPED_ROW' | 'EXCLUDED_ROW';
  /** Who/when a row was last excluded - for the "Excluded Records" screen. Cleared on re-include. */
  excludedBy?: string;
  excludedAt?: string;
  /** Set once a real Firestore write was attempted for this row in a partial-import run. */
  importOutcome?: 'IMPORTED' | 'FAILED';

  /**
   * Snapshot of every field as of the last full-row edit ("Edit Entire Row"),
   * kept SEPARATE from `raw` (the untouched original Excel row) so the UI can
   * always show Original vs Current Edited Version without destroying either.
   * Undefined means the row has never been through the full-row editor.
   */
  editedRowData?: Record<string, any>;
  /** Append-only trail of full-row/field-level correction events for this row, for audit/transparency (distinct from the global auditLogs collection, which only gets a summary entry). */
  resolutionHistory?: Array<{ timestamp: string; actor: string; action: string; summary: string }>;

  /** Full validation-error text captured at the moment this row most recently became EXCLUDED - stays visible even after later edits/repairs, distinct from the row's live/current `errors`/`status`. Cleared on re-include. */
  originalExclusionReason?: string;

  /**
   * Explicit user override of this row's business WARNINGS (§14: mere
   * inclusion/visibility is never treated as approval). A row with
   * `warnings.length > 0` is only writable once this is explicitly true -
   * see isRowWritable(). Reset to false whenever the row's data changes and
   * a NEW warning set is computed, so a stale override can never silently
   * carry over to a different warning.
   */
  warningsAccepted?: boolean;
  warningOverrideBy?: string;
  warningOverrideAt?: string;
  /** Machine-readable codes parallel to `warnings` (from businessValidationRules.ts), for the override audit trail (§17). */
  warningCodes?: string[];
  /** Versioned, revertible edit history - see RowVersion. Empty/undefined until the row's first manual edit. */
  rowVersions?: RowVersion[];

  // Smart Fuzzy Matching Proposals & Human Review
  proposedMatches?: Array<{
    fieldDomain: string; // 'press' | 'employee1' | 'employee2' | 'product' | 'customer' | 'shift' | 'furnaceCar'
    fieldNameAr: string;
    fieldNameEn: string;
    importedValue: string;
    suggestedId?: string;
    suggestedCode?: string;
    suggestedName?: string;
    confidence: number;
    matchType: string;
    reasonAr: string;
    reasonEn: string;
    decision: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'MANUAL';
    manualId?: string;
    manualName?: string;
    /**
     * The user's manually typed correction of the imported value, kept
     * SEPARATE from `importedValue` (the original, never overwritten) and
     * from `manualName`/`resolvedEntityValue` (the final resolved Master
     * Data record). Only set when the user used "Manual Edit" to retype the
     * value before searching/selecting/adding - absent for a direct
     * "Choose Existing" selection of the unedited original value.
     */
    manualEditedValue?: string;
    candidates?: Array<{
      id: string;
      code: string;
      name: string;
      confidence: number;
      matchType: string;
      reasonAr: string;
      reasonEn: string;
    }>;
  }>;
}

export interface PressingImportSummary {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  unknownEmployeesCount: number;
  unknownProductsCount: number;
  unknownPressesCount: number;
  unknownFurnaceCarsCount: number;
  shiftErrorsCount: number;
  faultMismatchesCount: number;
  highConfidenceMatchesCount?: number;
  unresolvedMismatchesCount?: number;
  rows: PressingImportRow[];
}

/**
 * Chinese Mills Historical Import - stage-specific parallel to
 * PressingImportRow/PressingImportSummary above, reusing the same generic
 * RowVersion/RowFieldChange history types. Deliberately does NOT reuse
 * PressingImportRow itself: Chinese Mills has its own real fields (Mill
 * Type, Number of Bags, Operating Minutes, Fault Type, Weight Class,
 * Theoretical/Actual Rate) and none of Pressing's Furnace Car + Brick Count
 * concept.
 */
export type ChineseMillsImportStatus =
  | 'NEW'
  | 'VALID'
  | 'WARNING'
  | 'DUPLICATE_IN_FILE'
  | 'DUPLICATE_IN_DATABASE'
  | 'UNKNOWN_CUSTOMER'
  | 'UNKNOWN_MILL'
  | 'UNKNOWN_FAULT_TYPE'
  | 'UNKNOWN_SPECIFICATION'
  | 'INVALID_SHIFT'
  | 'INVALID_DATE'
  | 'INVALID_NUMBER'
  | 'INVALID_ROW';

export interface ChineseMillsImportRow {
  rowIndex: number;
  raw: Record<string, any>;
  date: string;

  // Customer (§2-5: may be created Name-only, no invented code)
  customerNameRaw: string;
  /** Only recognized if the uploaded file happens to carry an extra "Customer Code" column - not part of the official 17-column template, but the future-code-update proposal (§5) needs somewhere to read an imported code from. */
  customerCodeRaw?: string;
  resolvedCustomerId?: string;
  resolvedCustomerName?: string;
  resolvedCustomerCode?: string;
  /** True when "Add" created this customer with no business code (name-only), per §2/§6.2. */
  customerCreatedNameOnly?: boolean;
  /** §5: existing customer has an empty code AND this row's file carries a Customer Code value - never auto-applied. */
  customerCodeUpdateProposal?: {
    currentCode: string;
    proposedCode: string;
    decision: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  };

  // Specification Code - §33: NEVER blocking by itself
  specificationCodeRaw: string;

  // Mill Type (§7-8: matches ONLY Chinese Mills Master Data, never unrelated numeric entities)
  millTypeRaw: string;
  resolvedMillId?: string;
  resolvedMillCode?: string;
  resolvedMillName?: string;

  // Shift (§9: all of 1/2/3 valid)
  shiftRaw: string | number;
  resolvedShiftNumber?: 1 | 2 | 3;
  resolvedShiftId?: string;
  resolvedShiftName?: string;

  // Quantities & durations (§10-16)
  productionQuantity: number; // tons
  numberOfBags: number;
  rejectedQuantity: number;
  operatingMinutes: number;
  operatingHours: number;
  /** operatingHours + operatingMinutes/60 - a DERIVED value used only for the Actual Rate suggestion (§15/§22); the two original fields are never collapsed/overwritten. */
  totalOperatingTimeHours: number;
  downtimeHours: number;

  // Fault Type (§17: reuse Fault Type Master Data when available)
  faultTypeRaw?: string;
  resolvedFaultTypeId?: string;
  resolvedFaultTypeName?: string;

  // Specification ("المواصفة") - Chinese Mills' Product Code identity field
  // (Master Data Consolidation task), resolved against Master Data Products
  // the SAME way millType resolves against Chinese Mills - separate from
  // Specification Code ("كود المواصفة" / specificationCodeRaw above), which
  // stays untouched free text exactly as before (§18/§33).
  specification?: string;
  resolvedProductId?: string;
  resolvedProductCode?: string;
  resolvedProductName?: string;

  // Weight Class (§19: transactional kg value, not Master Data - avoids a duplicate data architecture)
  weightClassKg?: number;
  /** §20: bag-count x weight-class vs production-quantity consistency check result. */
  bagWeightExpectedTons?: number;
  bagWeightMismatch?: boolean;

  // Rates (§21-23)
  theoreticalRate?: number;
  /** The value exactly as imported - never silently altered. */
  actualRateImported?: number;
  /** Calculated from productionQuantity / totalOperatingTimeHours when there's enough data - never auto-applied. */
  actualRateSuggested?: number;
  actualRateDecision: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'NOT_APPLICABLE';
  /** The value actually written to Firestore on import: importedValue unless the user explicitly Accepted the suggestion. */
  actualRateFinal?: number;

  notes?: string;

  // Status & diagnostics
  status: ChineseMillsImportStatus;
  errors: string[];
  warnings: string[];
  warningCodes?: string[];
  isDuplicate: boolean;
  duplicateType?: 'FILE' | 'DATABASE';

  // Partial-import row selection (§34-38) - same convention as PressingImportRow,
  // extended with 'PENDING' (Row-Based Review Part 6): a row that currently
  // has a BLOCKING error is parked here automatically rather than being lost
  // or silently sitting unusable in the main list - distinct from EXCLUDED
  // (a deliberate user decision to leave a row out) and from INCLUDED
  // (actively selected for import). Undefined is treated as 'INCLUDED'.
  rowSelection?: 'INCLUDED' | 'EXCLUDED' | 'PENDING';
  exclusionReason?: 'USER_DESELECTED' | 'SKIPPED_ROW' | 'EXCLUDED_ROW';
  excludedBy?: string;
  excludedAt?: string;
  importOutcome?: 'IMPORTED' | 'FAILED';

  // Full row edit + history (§29-30, §46)
  editedRowData?: Record<string, any>;
  resolutionHistory?: Array<{ timestamp: string; actor: string; action: string; summary: string }>;
  originalExclusionReason?: string;

  // Warning override (§31-32)
  warningsAccepted?: boolean;
  warningOverrideBy?: string;
  warningOverrideAt?: string;
  rowVersions?: RowVersion[];

  /**
   * Approval (Approve Invalid Records task): an explicit administrative
   * decision that an authorized user reviewed a BLOCKING/NEEDS_REVIEW row
   * and accepted it for import despite its current overridable errors -
   * NEVER a correction (originalRowData/errors/warnings are all preserved
   * exactly as-is; see isNonOverridableBlockingCondition in
   * chineseMillsSelectionPure.ts for which errors approval can and cannot
   * override). Cleared automatically whenever the row is edited/revalidated
   * afterward - an approval decision is tied to the specific errors it was
   * made against, never silently carried forward onto a materially changed
   * row.
   */
  approved?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  approvalMethod?: 'INDIVIDUAL' | 'BULK';

  /**
   * Global Ready-to-Import Override task: a DISTINCT, explicit "I want this
   * record in the final import" decision, deliberately layered ON TOP of the
   * existing writability mechanism rather than replacing it - marking a row
   * Ready to Import never changes its validationStatus (status/errors/
   * warnings are all untouched); for a row that still has overridable
   * errors or an unaccepted warning it also sets approved/warningsAccepted
   * (reusing those EXACT existing mechanisms, never a parallel one) so the
   * row is genuinely writable, not just labeled so. Distinct from `approved`
   * (§16): a row can be APPROVED without being marked Ready, and marking
   * Ready implies approving where needed but is tracked separately so the
   * UI can show "Validation: BLOCKING / Decision: READY_TO_IMPORT" without
   * ever implying the original validation passed. Does NOT gate
   * isChineseMillsRowWritable - a plain valid/selected row that was never
   * explicitly marked stays importable exactly as before this task (see
   * chineseMillsSelectionPure.ts's canMarkReadyToImport/
   * computeMarkReadyPatch for the full reasoning).
   */
  readyToImport?: boolean;
  readyToImportBy?: string;
  readyToImportAt?: string;
  readyToImportMethod?: 'INDIVIDUAL' | 'BULK_SELECTED' | 'BULK_ALL';
  /** Snapshot of the row's selection/approval/warning-acceptance state taken immediately before marking it Ready, so "Remove Ready-to-Import Decision" (§15) restores the row's actual PRIOR decision instead of guessing a default. */
  preReadyToImportState?: {
    rowSelection?: 'INCLUDED' | 'EXCLUDED' | 'PENDING';
    exclusionReason?: 'USER_DESELECTED' | 'SKIPPED_ROW' | 'EXCLUDED_ROW';
    approved?: boolean;
    approvedBy?: string;
    approvedAt?: string;
    approvalMethod?: 'INDIVIDUAL' | 'BULK';
    warningsAccepted?: boolean;
  };

  // Smart matching proposals (§25-28) - customer/millType/faultType/specification
  proposedMatches?: Array<{
    fieldDomain: 'customer' | 'millType' | 'faultType' | 'specification';
    fieldNameAr: string;
    fieldNameEn: string;
    importedValue: string;
    suggestedId?: string;
    suggestedCode?: string;
    suggestedName?: string;
    confidence: number;
    matchType: string;
    reasonAr: string;
    reasonEn: string;
    decision: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'MANUAL';
    manualId?: string;
    manualName?: string;
    manualEditedValue?: string;
    candidates?: Array<{ id: string; code: string; name: string; confidence: number; matchType: string; reasonAr: string; reasonEn: string }>;
  }>;
}

export interface ChineseMillsImportSummary {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  unknownCustomersCount: number;
  unknownMillsCount: number;
  unknownFaultTypesCount: number;
  shiftErrorsCount: number;
  bagWeightMismatchCount: number;
  actualRateSuggestionsCount: number;
  rows: ChineseMillsImportRow[];
  /** Master Data collections (Customer/Chinese Mill/Fault Type/Specification-Product) that failed to load for THIS parse - never thrown past the parser (§8), surfaced here so the UI can show a controlled "Permission Error" banner instead of crashing or silently importing with broken matching. */
  masterDataLoadErrors?: Array<{ domain: 'customer' | 'millType' | 'faultType' | 'specification'; labelAr: string; labelEn: string; isPermissionDenied: boolean }>;
}

// ============================================================================
// Tube/Ball Mills Historical Import (Comprehensive Historical Import task) -
// mirrors ChineseMillsImportRow/ChineseMillsImportSummary's exact shape and
// conventions (row-based review, rowSelection/approved/readyToImport,
// resolutionHistory) rather than a second import architecture. Domain-
// specific additions are limited to what this stage's own Excel columns and
// business rules genuinely require: Mill/Material/Mixture/Bunker resolution.
// ============================================================================

export type TubeBallMillsImportStatus =
  | 'VALID'
  | 'WARNING'
  | 'UNKNOWN_MILL'
  | 'UNKNOWN_MATERIAL'
  | 'UNRESOLVED_MIXTURE_COMPONENT'
  | 'UNKNOWN_BUNKER'
  | 'INVALID_BUNKER_ALLOCATION'
  | 'INVALID_DATE'
  | 'INVALID_NUMBER'
  | 'DUPLICATE_IN_FILE'
  | 'DUPLICATE_IN_DATABASE'
  | 'INVALID_ROW';

/** One resolved (or unresolved) component of a detected mixture - §11/§12/§16. Quantities are the source of truth for the ratio; percentage is always DERIVED (quantityKg / mixtureTotalQuantityKg × 100), never trusted from embedded text. */
export interface TubeBallMillsMixtureComponent {
  materialNameRaw: string;
  quantityKg: number;
  /** Normalized 0-100, derived from quantityKg - see mixturePure.ts. The full component set for one row always sums to exactly 100 (rounding remainder assigned to the largest component - never silently dropped). */
  percentage: number;
  resolvedMaterialId?: string;
  resolvedMaterialCode?: string;
  resolvedMaterialName?: string;
  /** Only when explicitly detected (e.g. "جريت40%" §13) or already present on the resolved Material master record - never invented. */
  aluminaPercentage?: number;
}

/** One bunker this row's Total production is allocated to - §19-22. */
export interface TubeBallMillsBunkerAllocation {
  bunkerRaw: string;
  resolvedBunkerId?: string;
  resolvedBunkerCode?: string;
  resolvedBunkerName?: string;
  /** Defaults to an equal split of Total across all parsed bunkers (§22 - a SUGGESTION only, user-editable) - never assumed to be historically true without the user confirming it. */
  allocatedTons: number;
}

export interface TubeBallMillsImportRow {
  rowIndex: number;
  raw: Record<string, any>;
  date: string;

  // Mill Type ("نوع الطاحونة") - §7-8
  millTypeRaw: string;
  resolvedMillId?: string;
  resolvedMillCode?: string;
  resolvedMillName?: string;
  /** A fuzzy-match candidate for an unresolved Mill Type (never auto-applied - the user must explicitly accept it via "Use Suggestion", or pick a different existing Mill, or Code New). */
  suggestedMillId?: string;
  suggestedMillCode?: string;
  suggestedMillName?: string;
  suggestedMillConfidence?: number;

  // Material Type ("نوع الخامة") - §9-14: either a single raw material OR a mixture/BOM.
  materialTypeRaw: string;
  isMixture: boolean;
  // Single-material resolution (used only when !isMixture)
  resolvedMaterialId?: string;
  resolvedMaterialCode?: string;
  resolvedMaterialName?: string;
  /** Parsed from an embedded "٪"/"%" pattern (§13, e.g. "جريت40%") - the RAW material's own alumina content, distinct from a mixture component's. */
  detectedAluminaPercentage?: number;
  /** A fuzzy-match candidate for an unresolved single (non-mixture) Material (never auto-applied). */
  suggestedMaterialId?: string;
  suggestedMaterialCode?: string;
  suggestedMaterialName?: string;
  suggestedMaterialConfidence?: number;
  // Mixture/BOM resolution (used only when isMixture) - §11-16
  mixtureComponents?: TubeBallMillsMixtureComponent[];
  mixtureTotalQuantityKg?: number;
  /** Set once the user accepts an existing Product(isMixtureBOM) or creates a new one - never auto-created (§14/§48). */
  resolvedMixtureProductId?: string;
  resolvedMixtureProductCode?: string;
  resolvedMixtureProductName?: string;
  /** A candidate found via composition-aware duplicate search (§14/§48) - shown to the user, never silently applied. */
  suggestedMixtureProductId?: string;
  suggestedMixtureProductName?: string;
  suggestedMixtureMatchReason?: string;

  // Hours / Rate / Total - §22-25
  operatingHours: number;
  tonsPerHour: number;
  totalTons: number;
  /** Set when the declared Tons/Hour materially disagrees with Total/Hours (§24) - a WARNING, never blocking on its own, and the source value is never silently overwritten. */
  tonsPerHourMismatch?: boolean;
  /** Tons Per Hour is OPTIONAL per the existing import schema (productionStageConfig.ts) - when the source left it blank, it is DERIVED as Total/Hours rather than left at a misleading 0, but NEVER silently: this flag is always set so the UI can visibly label it "derived", never presented as if the source actually provided it. */
  tonsPerHourDerived?: boolean;

  // Storage Bunkers ("بناكر التخزين") - §19-22
  storageBunkersRaw: string;
  bunkerAllocations: TubeBallMillsBunkerAllocation[];
  /** True only once every parsed bunker is resolved AND the allocations sum to exactly totalTons (§22 - a hard blocking rule, not overridable by approval). */
  bunkerAllocationValid: boolean;

  status: TubeBallMillsImportStatus;
  errors: string[];
  warnings: string[];
  warningCodes?: string[];
  isDuplicate: boolean;
  duplicateType?: 'FILE' | 'DATABASE';

  // Partial-import row selection - identical convention to ChineseMillsImportRow/PressingImportRow (§4/§33).
  rowSelection?: 'INCLUDED' | 'EXCLUDED' | 'PENDING';
  exclusionReason?: 'USER_DESELECTED' | 'SKIPPED_ROW' | 'EXCLUDED_ROW';
  excludedBy?: string;
  excludedAt?: string;
  importOutcome?: 'IMPORTED' | 'FAILED';

  // Full row edit + history - §26-28
  editedRowData?: Record<string, any>;
  resolutionHistory?: Array<{ timestamp: string; actor: string; action: string; summary: string }>;

  // Warning override - same convention as ChineseMillsImportRow.
  warningsAccepted?: boolean;
  warningOverrideBy?: string;
  warningOverrideAt?: string;

  // Approval (§22 of this task / reused verbatim from the Approve Invalid Records task) - an explicit override of OVERRIDABLE blocking errors, never a correction.
  approved?: boolean;
  approvedBy?: string;
  approvedAt?: string;
  approvalMethod?: 'INDIVIDUAL' | 'BULK';

  // Ready-to-Import (reused verbatim from the Global Ready-to-Import Override task) - §24-27/§32.
  readyToImport?: boolean;
  readyToImportBy?: string;
  readyToImportAt?: string;
  readyToImportMethod?: 'INDIVIDUAL' | 'BULK_SELECTED' | 'BULK_ALL';
  preReadyToImportState?: {
    rowSelection?: 'INCLUDED' | 'EXCLUDED' | 'PENDING';
    exclusionReason?: 'USER_DESELECTED' | 'SKIPPED_ROW' | 'EXCLUDED_ROW';
    approved?: boolean;
    approvedBy?: string;
    approvedAt?: string;
    approvalMethod?: 'INDIVIDUAL' | 'BULK';
    warningsAccepted?: boolean;
  };
}

export interface TubeBallMillsImportSummary {
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  duplicateRows: number;
  unknownMillsCount: number;
  unknownMaterialsCount: number;
  unresolvedMixtureCount: number;
  unknownBunkersCount: number;
  invalidBunkerAllocationCount: number;
  rows: TubeBallMillsImportRow[];
  /** Same controlled-degradation pattern as ChineseMillsImportSummary.masterDataLoadErrors (§8 of this task's Firestore-load safety). */
  masterDataLoadErrors?: Array<{ domain: 'mill' | 'material' | 'bunker'; labelAr: string; labelEn: string; isPermissionDenied: boolean }>;
}

export interface BrandingSettings {
  id?: string;
  brandingStorageMode?: 'STATIC_ASSET' | string;
  // Company Logo
  companyLogoUrl?: string | null;
  companyLogoPublicId?: string | null;
  companyLogoPath?: string | null;
  companyLogoFileName?: string | null;
  companyLogoContentType?: string | null;
  companyLogoSize?: number | null;
  companyLogoWidth?: number | null;
  companyLogoHeight?: number | null;
  companyLogoUpdatedAt?: string | null;
  companyLogoUpdatedByUid?: string | null;

  // Developer Image
  developerImageUrl?: string | null;
  developerImagePublicId?: string | null;
  developerImagePath?: string | null;
  developerImageFileName?: string | null;
  developerImageContentType?: string | null;
  developerImageSize?: number | null;
  developerImageWidth?: number | null;
  developerImageHeight?: number | null;
  developerImageUpdatedAt?: string | null;
  developerImageUpdatedByUid?: string | null;

  updatedAt?: string;
  serverUpdatedAt?: any;
  updatedByUid?: string;
  updatedByEmail?: string;
}



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

export interface ProductType {
  id?: string;
  prefixCode: string; // 3 uppercase characters (e.g. BAR, BHA, BSI)
  nameEn: string; // e.g. Bricks Acid Resistance
  nameAr: string; // e.g. طوب مقاوم للأحماض
  description?: string;
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

export interface Product {
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
  smartParseStatus?: SmartParseStatus;
  productCodeNormalized?: string;
  nameNormalized?: string;
  productTypePrefixNormalized?: string;
  productTypeNameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  furnaceCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface TubeBallMill {
  id?: string;
  code: string;
  name: string;
  model?: string;
  status?: 'active' | 'maintenance' | 'inactive';
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
export interface Bunker {
  id?: string;
  code?: string;
  bunkerNumber: string;
  name?: string;
  center?: string;
  notes?: string;
  status?: 'active' | 'maintenance' | 'inactive';
  bunkerCodeNormalized?: string;
  nameNormalized?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

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

export interface ProductionRecord extends ProductionFaults {
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
    | 'PERMISSION_UPDATE';

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
  | 'customers' 
  | 'shifts'
  | 'materials'
  | 'machines'
  | 'stages';

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
  | 'admin-panel';

export type RecordStatus = 'DRAFT' | 'SUBMITTED' | 'REVIEWED' | 'APPROVED' | 'REJECTED' | 'CORRECTED';

export type ProductionStageType = 
  | 'pressing'             // 1. التشكيل والمكابس
  | 'rotary_furnace'      // 2. الفرن الدوار
  | 'chinese_mills'       // 3. الطواحين الصينية
  | 'tube_ball_mills'     // 4. طواحين الأنابيب والكرات
  | 'mortar_concrete'     // 5. المونة والخرسانات
  | 'mixing'              // 6. الخلط والتجهيز
  | 'lightweight_foam'    // 7. الشاموت الخفيف / عزل الفوم
  | 'sorting';            // 8. الفرز والمراقبة

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

export interface Material {
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
  materialId: string;
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: string;
}

export interface StageWorkerItem {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  role?: 'production' | 'maintenance' | 'operator' | 'helper' | 'supervisor';
  hours?: number;
}

// Stage 2: Rotary Furnace Record
export interface RotaryFurnaceRecord {
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
export interface ChineseMillsRecord {
  id?: string;
  date: string;
  customerId?: string;
  customerCode?: string;
  customerName?: string;
  specificationCode?: string;
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
export interface TubeBallMillsRecord {
  id?: string;
  date: string;
  millType: string;
  rawMaterialType: string;
  operatingHours: number;
  tonsPerHour: number;
  storageBunker?: string;
  totalTons: number;
  
  status: RecordStatus;
  notes?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Stage 5: Mortar & Concrete Record
export interface MortarConcreteRecord {
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
export interface MixingRecord {
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
export interface LightweightFoamRecord {
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
export interface SortingRecord {
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
  | 'INVALID_ROW';

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
  
  // Furnace Cars
  furnaceCarsRaw: string;
  furnaceCarTokens?: string[];
  resolvedFurnaceCars: Array<{ id?: string; code: string; carNumber: string }>;
  furnaceCarNumbers: string[];
  furnaceCarIds: string[];
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



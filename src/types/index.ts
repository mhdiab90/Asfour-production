/**
 * ASFOUR Factory Management System - Master TypeScript Types
 */

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPERVISOR' | 'PRODUCTION_USER' | 'VIEWER';

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
  permissions?: Partial<UserPermission>;
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
  
  // Quantities & Calculations
  productionQuantity: number; // total pressed/produced pieces
  wasteQuantity: number; // defective pieces
  goodQuantity: number; // productionQuantity - wasteQuantity
  productionWeight: number; // productionQuantity * pieceWeight (kg)
  goodWeight: number; // goodQuantity * pieceWeight (kg)
  wasteWeight: number; // wasteQuantity * pieceWeight (kg)
  wastePercentage: number; // (wasteQuantity / productionQuantity) * 100
  
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
    | 'RESTORE_EXECUTE';
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
  wasteQuantity?: number;
  goodQuantity?: number;
  totalDowntimeMinutes?: number;
  gasConsumption?: number;
  electricityConsumption?: number;
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
  totalProductionCount: number;
  totalGoodCount: number;
  totalWasteCount: number;
  wastePercentage: number;
  totalProductionWeightKg: number;
  totalGoodWeightKg: number;
  totalWasteWeightKg: number;
  totalDowntimeMinutes: number;
  totalDowntimeHours: number;
  totalRecordsCount: number;
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
export type BackupStatus = 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'IN_PROGRESS';

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



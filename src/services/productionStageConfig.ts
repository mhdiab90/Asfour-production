/**
 * Production Stage Configuration Registry (Part 3 §10 / Part 13).
 *
 * ONE shared Production Entry framework + ONE shared Historical Import
 * framework + per-stage configuration - NOT eight duplicated
 * implementations. Every field declared here is grounded in what ALREADY
 * exists for that stage: the stage's real interface in `types/index.ts`
 * (RotaryFurnaceRecord, ChineseMillsRecord, TubeBallMillsRecord,
 * MortarConcreteRecord, MixingRecord, LightweightFoamRecord,
 * SortingRecord) and what its entry form already writes via
 * `createStageRecord`. Nothing here invents a field, a Master Data
 * relationship, or a business rule that doesn't already exist for that
 * stage (Part 16, CRITICAL) - where a stage's real schema has no shift
 * field, no product reference, etc., this config says so explicitly
 * (`hasShift: false`, `masterDataFields: []`) rather than adding one.
 *
 * Consumers:
 *  - The 8 Production Entry forms use `getStageWarningContext()` to map
 *    their OWN field names into `evaluateProductionWarnings()`'s generic
 *    shape (businessValidationRules.ts) - one shared warning engine, eight
 *    different field mappings.
 *  - Historical Import (`historicalImportService.ts`) uses
 *    `IMPORT_FIELD_DEFS` to validate required fields and build a correct,
 *    stage-appropriate Excel template - instead of one hardcoded
 *    Pressing-shaped template reused (wrongly) for every stage.
 */
import { ProductionStageType } from '../types';
import { EntityType } from '../components/common/SmartEntitySelect';

export interface StageMasterDataField {
  /** The field name as written on the stage's real record type/payload. */
  field: string;
  entityType: EntityType;
  labelAr: string;
  labelEn: string;
  required: boolean;
  /** Whether this stage's real schema stores this as a list (StageWorkerItem[]/MaterialConsumptionItem[]) rather than a single id. */
  multi: boolean;
}

/** Maps a stage's own field names onto evaluateProductionWarnings()'s generic ProductionWarningContext shape - undefined when that stage's schema has no such concept (never fabricated). */
export interface StageWarningFieldMap {
  productionField: string;
  wasteField?: string;
  downtimeField?: string;
  /** Only stages with a real shift relationship (rotary_furnace, chinese_mills) can compute shiftHours for the HIGH_DOWNTIME check. */
  hasShiftHours: boolean;
}

export interface ImportFieldDef {
  key: string;
  labelAr: string;
  labelEn: string;
  /** Every Arabic/English column-header spelling the parser will recognize for this field. */
  columnAliases: string[];
  type: 'date' | 'text' | 'number' | 'masterData';
  entityType?: EntityType;
  required: boolean;
}

export interface ProductionStageConfig {
  stageId: ProductionStageType;
  /** Real Master Data / multi-value fields this stage's own type actually declares - drives which pickers the entry form shows and which fields Historical Import can resolve against Master Data. Empty where the stage genuinely has none (e.g. Tube/Ball Mills). */
  masterDataFields: StageMasterDataField[];
  hasShift: boolean;
  /** Furnace Car + Brick Count is a Pressing-only concept (Part 4) - true for exactly one stage. */
  hasFurnaceCarBrickCount: boolean;
  warningContext: StageWarningFieldMap;
  importFields: ImportFieldDef[];
}

const DATE_FIELD: ImportFieldDef = {
  key: 'date', labelAr: 'التاريخ', labelEn: 'Date', columnAliases: ['التاريخ', 'date', 'Date'], type: 'date', required: true,
};

export const PRODUCTION_STAGE_CONFIGS: Record<ProductionStageType, ProductionStageConfig> = {
  // Pressing is intentionally NOT reconfigured here - it keeps its own
  // dedicated, already-complete pipeline (ProductionEntryForm.tsx +
  // pressingHistoricalImportService.ts). Listed for completeness/typing
  // only; nothing reads this entry for Pressing.
  pressing: {
    stageId: 'pressing',
    masterDataFields: [
      { field: 'pressId', entityType: 'press', labelAr: 'المكبس', labelEn: 'Press', required: true, multi: false },
      { field: 'productId', entityType: 'product', labelAr: 'المنتج', labelEn: 'Product', required: true, multi: false },
      { field: 'employeeIds', entityType: 'employee', labelAr: 'العمال', labelEn: 'Workers', required: false, multi: true },
      { field: 'customerId', entityType: 'customer', labelAr: 'العميل', labelEn: 'Customer', required: false, multi: false },
    ],
    hasShift: true,
    hasFurnaceCarBrickCount: true,
    warningContext: { productionField: 'productionQuantity', wasteField: 'wasteQuantity', downtimeField: 'totalDowntime', hasShiftHours: true },
    importFields: [],
  },

  rotary_furnace: {
    stageId: 'rotary_furnace',
    masterDataFields: [
      { field: 'productId', entityType: 'product', labelAr: 'المنتج المصنع', labelEn: 'Product', required: true, multi: false },
      { field: 'shiftId', entityType: 'shift', labelAr: 'الوردية', labelEn: 'Shift', required: false, multi: false },
      { field: 'materials', entityType: 'material', labelAr: 'الخامات المستخدمة', labelEn: 'Materials Used', required: false, multi: true },
      { field: 'productionWorkers', entityType: 'employee', labelAr: 'عمالة التشغيل', labelEn: 'Production Workers', required: false, multi: true },
    ],
    hasShift: true, // RotaryFurnaceRecord.shiftId/shiftName - real field, currently unwired in the UI
    hasFurnaceCarBrickCount: false,
    warningContext: { productionField: 'productionQuantity', wasteField: 'wasteQuantity', downtimeField: 'downtimeMinutes', hasShiftHours: true },
    importFields: [
      DATE_FIELD,
      { key: 'batchNumber', labelAr: 'رقم الدفعة', labelEn: 'Batch Number', columnAliases: ['رقم الدفعة', 'batchNumber', 'Batch'], type: 'text', required: false },
      { key: 'productCode', labelAr: 'كود المنتج', labelEn: 'Product Code', columnAliases: ['كود المنتج', 'productCode'], type: 'masterData', entityType: 'product', required: true },
      { key: 'productName', labelAr: 'اسم المنتج', labelEn: 'Product Name', columnAliases: ['اسم المنتج', 'productName'], type: 'text', required: false },
      { key: 'operatingHours', labelAr: 'ساعات التشغيل', labelEn: 'Operating Hours', columnAliases: ['ساعات التشغيل', 'operatingHours'], type: 'number', required: false },
      { key: 'gasConsumption', labelAr: 'استهلاك الغاز م3', labelEn: 'Gas Consumption (m3)', columnAliases: ['استهلاك الغاز م3', 'gasConsumption'], type: 'number', required: false },
      { key: 'electricityConsumption', labelAr: 'استهلاك الكهرباء kWh', labelEn: 'Electricity Consumption (kWh)', columnAliases: ['استهلاك الكهرباء kWh', 'electricityConsumption'], type: 'number', required: false },
      { key: 'productionQuantity', labelAr: 'الإنتاج طن', labelEn: 'Production (tons)', columnAliases: ['الإنتاج طن', 'productionQuantity'], type: 'number', required: true },
      { key: 'wasteQuantity', labelAr: 'الهالك طن', labelEn: 'Waste (tons)', columnAliases: ['الهالك طن', 'wasteQuantity'], type: 'number', required: false },
      { key: 'downtimeMinutes', labelAr: 'توقفات دقيقة', labelEn: 'Downtime (minutes)', columnAliases: ['توقفات دقيقة', 'downtimeMinutes'], type: 'number', required: false },
      { key: 'notes', labelAr: 'ملاحظات', labelEn: 'Notes', columnAliases: ['ملاحظات', 'notes'], type: 'text', required: false },
    ],
  },

  chinese_mills: {
    stageId: 'chinese_mills',
    masterDataFields: [
      { field: 'customerId', entityType: 'customer', labelAr: 'العميل', labelEn: 'Customer', required: false, multi: false },
      // shiftType is a real field on ChineseMillsRecord, but is currently
      // stored as free text rather than a genuine shift selection - fixed
      // to route through the real Shift Master Data, same relationship
      // Rotary Furnace already declares (Part 5: shift 1/2/3 recognized).
      { field: 'shiftId', entityType: 'shift', labelAr: 'الوردية', labelEn: 'Shift', required: false, multi: false },
    ],
    hasShift: true,
    hasFurnaceCarBrickCount: false,
    warningContext: { productionField: 'quantity', wasteField: 'rejectedQuantity', downtimeField: 'downtimeHours', hasShiftHours: true },
    importFields: [
      DATE_FIELD,
      { key: 'customerName', labelAr: 'اسم العميل', labelEn: 'Customer Name', columnAliases: ['اسم العميل', 'customerName'], type: 'masterData', entityType: 'customer', required: false },
      { key: 'specificationCode', labelAr: 'كود المواصفة', labelEn: 'Specification Code', columnAliases: ['كود المواصفة', 'specificationCode'], type: 'text', required: false },
      { key: 'millType', labelAr: 'نوع الطاحونة', labelEn: 'Mill Type', columnAliases: ['نوع الطاحونة', 'millType'], type: 'text', required: false },
      { key: 'shiftType', labelAr: 'الوردية', labelEn: 'Shift', columnAliases: ['الوردية', 'shift', 'shiftType'], type: 'masterData', entityType: 'shift', required: false },
      { key: 'quantity', labelAr: 'الإنتاج طن', labelEn: 'Production (tons)', columnAliases: ['الإنتاج طن', 'quantity'], type: 'number', required: true },
      { key: 'numberOfBags', labelAr: 'عدد الشكائر', labelEn: 'Number of Bags', columnAliases: ['عدد الشكائر', 'numberOfBags'], type: 'number', required: false },
      { key: 'rejectedQuantity', labelAr: 'الهالك طن', labelEn: 'Waste (tons)', columnAliases: ['الهالك طن', 'rejectedQuantity'], type: 'number', required: false },
      { key: 'operatingHours', labelAr: 'ساعات التشغيل', labelEn: 'Operating Hours', columnAliases: ['ساعات التشغيل', 'operatingHours'], type: 'number', required: false },
      { key: 'downtimeHours', labelAr: 'ساعات التوقف', labelEn: 'Downtime Hours', columnAliases: ['ساعات التوقف', 'downtimeHours'], type: 'number', required: false },
    ],
  },

  tube_ball_mills: {
    stageId: 'tube_ball_mills',
    // TubeBallMillsRecord has NO productId/employeeId/shiftId in its real
    // schema (millType/rawMaterialType/storageBunker are plain text there
    // too) - no Master Data fields are invented here.
    masterDataFields: [],
    hasShift: false,
    hasFurnaceCarBrickCount: false,
    warningContext: { productionField: 'totalTons', hasShiftHours: false },
    importFields: [
      DATE_FIELD,
      { key: 'millType', labelAr: 'نوع الطاحونة', labelEn: 'Mill Type', columnAliases: ['نوع الطاحونة', 'millType'], type: 'text', required: false },
      { key: 'rawMaterialType', labelAr: 'نوع الخامة', labelEn: 'Raw Material Type', columnAliases: ['نوع الخامة', 'rawMaterialType'], type: 'text', required: false },
      { key: 'operatingHours', labelAr: 'ساعات التشغيل', labelEn: 'Operating Hours', columnAliases: ['ساعات التشغيل', 'operatingHours'], type: 'number', required: false },
      { key: 'tonsPerHour', labelAr: 'معدل الطن/ساعة', labelEn: 'Tons per Hour', columnAliases: ['معدل الطن/ساعة', 'tonsPerHour'], type: 'number', required: false },
      { key: 'storageBunker', labelAr: 'الصومعة', labelEn: 'Storage Bunker', columnAliases: ['الصومعة', 'storageBunker'], type: 'text', required: false },
      { key: 'totalTons', labelAr: 'إجمالي الطن', labelEn: 'Total Tons', columnAliases: ['إجمالي الطن', 'totalTons'], type: 'number', required: true },
    ],
  },

  mortar_concrete: {
    stageId: 'mortar_concrete',
    masterDataFields: [
      { field: 'productId', entityType: 'product', labelAr: 'المنتج', labelEn: 'Product', required: true, multi: false },
      { field: 'customerId', entityType: 'customer', labelAr: 'العميل', labelEn: 'Customer', required: false, multi: false },
      { field: 'materials', entityType: 'material', labelAr: 'الخامات المستخدمة', labelEn: 'Materials Used', required: false, multi: true },
      { field: 'workers', entityType: 'employee', labelAr: 'العمالة', labelEn: 'Workers', required: false, multi: true },
    ],
    hasShift: false, // MortarConcreteRecord has no shiftId field
    hasFurnaceCarBrickCount: false,
    warningContext: { productionField: 'productionQuantity', hasShiftHours: false },
    importFields: [
      DATE_FIELD,
      { key: 'productCode', labelAr: 'كود المنتج', labelEn: 'Product Code', columnAliases: ['كود المنتج', 'productCode'], type: 'masterData', entityType: 'product', required: true },
      { key: 'customerName', labelAr: 'العميل', labelEn: 'Customer', columnAliases: ['العميل', 'customerName'], type: 'masterData', entityType: 'customer', required: false },
      { key: 'batchNumber', labelAr: 'رقم الدفعة', labelEn: 'Batch Number', columnAliases: ['رقم الدفعة', 'batchNumber'], type: 'text', required: false },
      { key: 'manufacturingOrderNumber', labelAr: 'رقم أمر التصنيع', labelEn: 'Manufacturing Order #', columnAliases: ['رقم أمر التصنيع', 'manufacturingOrderNumber'], type: 'text', required: false },
      { key: 'productionQuantity', labelAr: 'كمية الإنتاج', labelEn: 'Production Quantity', columnAliases: ['كمية الإنتاج', 'productionQuantity'], type: 'number', required: true },
      { key: 'operatingHours', labelAr: 'ساعات التشغيل', labelEn: 'Operating Hours', columnAliases: ['ساعات التشغيل', 'operatingHours'], type: 'number', required: false },
    ],
  },

  mixing: {
    stageId: 'mixing',
    masterDataFields: [
      // MixingRecord stores mixProductName/mixProductCode as its own
      // fields (not a productId FK), but the form should still resolve
      // them against real Product master data rather than free text, the
      // same way Rotary Furnace/Mortar Concrete/Sorting already do -
      // fixing a form bug, not inventing a new field.
      { field: 'mixProductCode', entityType: 'product', labelAr: 'المنتج', labelEn: 'Product', required: true, multi: false },
      { field: 'materials', entityType: 'material', labelAr: 'الخامات المستخدمة', labelEn: 'Materials Used', required: false, multi: true },
      { field: 'workers', entityType: 'employee', labelAr: 'العمالة', labelEn: 'Workers', required: false, multi: true },
    ],
    hasShift: false,
    hasFurnaceCarBrickCount: false,
    warningContext: { productionField: 'productionQuantity', wasteField: 'wasteQuantity', hasShiftHours: false },
    importFields: [
      DATE_FIELD,
      { key: 'mixProductCode', labelAr: 'كود المنتج', labelEn: 'Product Code', columnAliases: ['كود المنتج', 'mixProductCode'], type: 'masterData', entityType: 'product', required: false },
      { key: 'mixProductName', labelAr: 'اسم المنتج', labelEn: 'Product Name', columnAliases: ['اسم المنتج', 'mixProductName'], type: 'text', required: true },
      { key: 'batchNumber', labelAr: 'رقم الدفعة', labelEn: 'Batch Number', columnAliases: ['رقم الدفعة', 'batchNumber'], type: 'text', required: false },
      { key: 'productionQuantity', labelAr: 'كمية الإنتاج', labelEn: 'Production Quantity', columnAliases: ['كمية الإنتاج', 'productionQuantity'], type: 'number', required: true },
      { key: 'wasteQuantity', labelAr: 'الهالك', labelEn: 'Waste', columnAliases: ['الهالك', 'wasteQuantity'], type: 'number', required: false },
      { key: 'operatingHours', labelAr: 'ساعات التشغيل', labelEn: 'Operating Hours', columnAliases: ['ساعات التشغيل', 'operatingHours'], type: 'number', required: false },
    ],
  },

  lightweight_foam: {
    stageId: 'lightweight_foam',
    masterDataFields: [
      { field: 'productCode', entityType: 'product', labelAr: 'المنتج', labelEn: 'Product', required: true, multi: false },
      { field: 'materials', entityType: 'material', labelAr: 'الخامات المستخدمة', labelEn: 'Materials Used', required: false, multi: true },
      { field: 'workers', entityType: 'employee', labelAr: 'العمالة', labelEn: 'Workers', required: false, multi: true },
    ],
    hasShift: false,
    hasFurnaceCarBrickCount: false,
    warningContext: { productionField: 'productionQuantity', wasteField: 'wasteQuantity', hasShiftHours: false },
    importFields: [
      DATE_FIELD,
      { key: 'productCode', labelAr: 'كود المنتج', labelEn: 'Product Code', columnAliases: ['كود المنتج', 'productCode'], type: 'masterData', entityType: 'product', required: false },
      { key: 'productName', labelAr: 'اسم المنتج', labelEn: 'Product Name', columnAliases: ['اسم المنتج', 'productName'], type: 'text', required: true },
      { key: 'batchNumber', labelAr: 'رقم الدفعة', labelEn: 'Batch Number', columnAliases: ['رقم الدفعة', 'batchNumber'], type: 'text', required: false },
      { key: 'productionQuantity', labelAr: 'كمية الإنتاج', labelEn: 'Production Quantity', columnAliases: ['كمية الإنتاج', 'productionQuantity'], type: 'number', required: true },
      { key: 'wasteQuantity', labelAr: 'الهالك', labelEn: 'Waste', columnAliases: ['الهالك', 'wasteQuantity'], type: 'number', required: false },
      { key: 'operatingHours', labelAr: 'ساعات التشغيل', labelEn: 'Operating Hours', columnAliases: ['ساعات التشغيل', 'operatingHours'], type: 'number', required: false },
    ],
  },

  sorting: {
    stageId: 'sorting',
    masterDataFields: [
      { field: 'productId', entityType: 'product', labelAr: 'المنتج', labelEn: 'Product', required: true, multi: false },
      { field: 'customerId', entityType: 'customer', labelAr: 'العميل', labelEn: 'Customer', required: false, multi: false },
    ],
    hasShift: false, // SortingRecord has no shiftId field
    hasFurnaceCarBrickCount: false,
    // Sorting's real "warning-shaped" relationship is goodCount+brokenCount vs totalCount (defect-sum reconciliation), not a generic waste-vs-production ratio - handled by its own dedicated rule (see SortingEntryForm.tsx), not the shared productionField/wasteField mapping.
    warningContext: { productionField: 'totalCount', wasteField: 'brokenCount', hasShiftHours: false },
    importFields: [
      DATE_FIELD,
      { key: 'dischargeDate', labelAr: 'تاريخ خروج الفرن', labelEn: 'Furnace Discharge Date', columnAliases: ['تاريخ خروج الفرن', 'dischargeDate'], type: 'date', required: false },
      { key: 'customerOrderNumber', labelAr: 'رقم أمر العميل', labelEn: 'Customer Order #', columnAliases: ['رقم أمر العميل', 'customerOrderNumber'], type: 'text', required: false },
      { key: 'productCode', labelAr: 'كود المنتج', labelEn: 'Product Code', columnAliases: ['كود المنتج', 'productCode'], type: 'masterData', entityType: 'product', required: true },
      { key: 'pieceWeight', labelAr: 'وزن القطعة كجم', labelEn: 'Piece Weight (kg)', columnAliases: ['وزن القطعة كجم', 'pieceWeight'], type: 'number', required: false },
      { key: 'totalCount', labelAr: 'إجمالي العدد', labelEn: 'Total Count', columnAliases: ['إجمالي العدد', 'totalCount'], type: 'number', required: true },
      { key: 'brokenCount', labelAr: 'عدد الكسر المعيب', labelEn: 'Broken/Defect Count', columnAliases: ['عدد الكسر المعيب', 'brokenCount'], type: 'number', required: false },
      { key: 'shiverDefectCount', labelAr: 'شطف', labelEn: 'Shiver Defects', columnAliases: ['شطف', 'shiverDefectCount'], type: 'number', required: false },
      { key: 'crackDefectCount', labelAr: 'شروخ', labelEn: 'Crack Defects', columnAliases: ['شروخ', 'crackDefectCount'], type: 'number', required: false },
      { key: 'ironDefectCount', labelAr: 'بقع حديد', labelEn: 'Iron Spot Defects', columnAliases: ['بقع حديد', 'ironDefectCount'], type: 'number', required: false },
      { key: 'contaminationDefectCount', labelAr: 'شوائب', labelEn: 'Contamination Defects', columnAliases: ['شوائب', 'contaminationDefectCount'], type: 'number', required: false },
      { key: 'kilnDefectCount', labelAr: 'حريق فرن', labelEn: 'Kiln Fire Defects', columnAliases: ['حريق فرن', 'kilnDefectCount'], type: 'number', required: false },
      { key: 'returnDefectCount', labelAr: 'مرتجع', labelEn: 'Returns', columnAliases: ['مرتجع', 'returnDefectCount'], type: 'number', required: false },
    ],
  },
};

export function getStageConfig(stage: ProductionStageType): ProductionStageConfig {
  return PRODUCTION_STAGE_CONFIGS[stage];
}

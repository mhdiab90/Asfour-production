/**
 * UOM data readiness - Phase 1 Step 8. Pure, deterministic, Firebase-free.
 *
 * READ-ONLY DIAGNOSTICS before Costing: which unit values are approved, missing,
 * unknown or legacy spellings, and where a later calculation would need a
 * conversion nobody configured. It receives data the caller already loaded -
 * it never scans Firestore - and it changes nothing: a finding recommends an
 * action through the existing edit screens, it never applies one.
 *
 * PROCESS vs PRODUCT vs MATERIAL QUANTITY are different fields and stay
 * different: a stage's production measure, its output lines and its consumption
 * lines are analysed separately, each in its own unit, never folded into one.
 *
 * THE STAGE UOM MATRIX records, per stage, the field that holds its production
 * quantity and that field's unit as the entry form and importer define it
 * (records store the number, not a unit). Operations that are a sub-activity of
 * another record (packing, extrusion - Step 8C-5) are listed as such.
 */
import type { ProductionStageType } from '../types';
import { bomFormula } from './bomPure';
import type { UomCategory, UomConversionContext, UomSeverity, BusinessUomConversion } from './uomPure';
import { normaliseUom, uomCompatibility } from './uomPure';

// --- Stage UOM matrix -------------------------------------------------------------------

export type StageUomStatus = 'READY' | 'UNIT_MISMATCH_RISK' | 'NO_PRODUCTION_RECORD_TYPE' | 'SUB_ACTIVITY';

export interface StageMeasure {
  /** Fields read in order; the first holding a number is used. */
  fields: readonly string[];
  unit: string;
  noteEn: string;
}

export interface StageUomRow {
  operationCode: string;
  nameAr: string;
  nameEn: string;
  stageType: ProductionStageType | null;
  /** The stage's own production quantity (process output measure). */
  production: StageMeasure | null;
  /** Other quantities the record stores, each in its own unit. */
  otherMeasures: readonly StageMeasure[];
  outputUnits: string;
  consumptionUnits: string;
  /** The unit the existing Data Review list shows next to its quantity. */
  reviewListUnit: string | null;
  status: StageUomStatus;
  noteAr: string;
  noteEn: string;
}

const OUTPUTS = 'productionOutputs[].unit - stored per line (Step 6)';
const CONSUMPTION = 'materials[].unit - stored per line (Step 5B / 6)';

/** Deterministic, from the repository's entry forms, importers and record types. */
export const STAGE_UOM_MATRIX: readonly StageUomRow[] = [
  {
    operationCode: 'OP-PRESS', nameAr: 'التشكيل والكبس', nameEn: 'Pressing', stageType: 'pressing',
    production: { fields: ['productionQuantity'], unit: 'قطعة', noteEn: 'pressed pieces' },
    otherMeasures: [
      { fields: ['productionWeight', 'productionKg'], unit: 'كجم', noteEn: 'pieces x piece weight' },
      { fields: ['productionTons'], unit: 'طن', noteEn: 'weight / 1000 (production weight reporting)' },
    ],
    outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'قطعة', status: 'READY',
    noteAr: 'الإنتاج بالقطعة؛ الوزن محسوب من وزن القطعة لكل منتج.', noteEn: 'Production in pieces; weight derived from each product\'s piece weight.',
  },
  {
    operationCode: 'OP-KILN', nameAr: 'الفرن الدوار', nameEn: 'Rotary Kiln', stageType: 'rotary_furnace',
    production: { fields: ['productionQuantity'], unit: 'طن', noteEn: 'form label: ton' },
    otherMeasures: [],
    outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'طن', status: 'READY',
    noteAr: 'الغاز (م³) والكهرباء طاقة وليست وحدات مواد - خارج نطاق هذه الخطوة.', noteEn: 'Gas (m³) and electricity are energy, not material units - outside this step.',
  },
  {
    operationCode: 'OP-CMILL', nameAr: 'الطحن بالطواحين الصينية', nameEn: 'Chinese Milling', stageType: 'chinese_mills',
    production: { fields: ['productionQuantity', 'quantity'], unit: 'طن', noteEn: 'importer header "كمية الإنتاج (طن)"; bag-weight check compares it with tons' },
    otherMeasures: [{ fields: ['numberOfBags'], unit: 'شكارة', noteEn: 'bags packed - a separate count, never a conversion of the tons' }],
    outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'طن', status: 'READY',
    noteAr: 'كمية الإنتاج بالطن (تصحيح Step 8A لوحدة قائمة المراجعة)؛ عدد الشكائر عدد مستقل بوحدة شكارة.',
    noteEn: 'Production in tons (Data Review list unit corrected in Step 8A); the bag count is a separate count in شكارة.',
  },
  {
    operationCode: 'OP-TBM', nameAr: 'الطحن بطواحين الأنابيب والكرات', nameEn: 'Tube & Ball Milling', stageType: 'tube_ball_mills',
    production: { fields: ['totalTons'], unit: 'طن', noteEn: 'operating hours x tons per hour' },
    otherMeasures: [{ fields: [], unit: 'كجم', noteEn: 'historical product mixture components (quantityKg) - material quantities, read-only' }],
    outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'طن', status: 'READY',
    noteAr: 'الإنتاج بالطن؛ مكونات الخلطة القديمة بالكيلو - كميات مختلفة لا تُدمج.', noteEn: 'Output in tons; legacy mixture inputs in kg - different quantities, never merged.',
  },
  {
    operationCode: 'OP-MIX', nameAr: 'الخلط والتجهيز', nameEn: 'Mixing', stageType: 'mixing',
    production: { fields: ['productionQuantity'], unit: 'طن', noteEn: 'form label: ton' },
    otherMeasures: [], outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'طن', status: 'READY', noteAr: '', noteEn: '',
  },
  {
    operationCode: 'OP-MORTAR', nameAr: 'إنتاج المونة', nameEn: 'Mortar Production', stageType: 'mortar_concrete',
    production: { fields: ['productionQuantity'], unit: 'طن', noteEn: 'form label: ton' },
    otherMeasures: [], outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'طن', status: 'READY',
    noteAr: 'سجل "المونة والخرسانات" يخدم المونة.', noteEn: 'The "mortar & concrete" record type serves mortar.',
  },
  {
    // Phase 1 Step 8C-5: its own record type, the mortar shape.
    operationCode: 'OP-TCONC', nameAr: 'إنتاج الخرسانة الحرارية', nameEn: 'Thermal Concrete Production', stageType: 'thermal_concrete',
    production: { fields: ['productionQuantity'], unit: 'طن', noteEn: 'form label: ton; the Odoo sheet gives Ton' },
    otherMeasures: [], outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'طن', status: 'READY',
    noteAr: 'نوع سجل مستقل (Step 8C-5) بنفس شكل سجل المونة.', noteEn: 'Its own record type (Step 8C-5), shaped like the mortar record.',
  },
  {
    // Phase 1 Step 8C-5: its own record type - green bricks in, fired bricks out.
    operationCode: 'OP-TUNNEL-KILN', nameAr: 'حريق الفرن النفقي', nameEn: 'Tunnel Kiln', stageType: 'tunnel_kiln',
    production: { fields: ['productionQuantity'], unit: 'طن', noteEn: 'fired output; the Odoo sheet gives Ton' },
    otherMeasures: [], outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'طن', status: 'READY',
    noteAr: 'الإنتاج المحروق بالطن؛ الطوب الأخضر المحروق سطور استهلاك بوحدتها.', noteEn: 'Fired output in tons; the green bricks fired are consumption lines in their own unit.',
  },
  {
    operationCode: 'OP-SORT', nameAr: 'الفرز', nameEn: 'Sorting', stageType: 'sorting',
    production: { fields: ['totalCount'], unit: 'قطعة', noteEn: 'pieces sorted' },
    otherMeasures: [{ fields: ['totalTons'], unit: 'طن', noteEn: 'pieces x piece weight / 1000' }],
    outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'قطعة', status: 'READY',
    noteAr: 'الإنتاج بالقطعة؛ عندما تعرض قائمة المراجعة الأطنان المحسوبة (totalTons) تظهر بوحدة طن (تصحيح Step 8A).',
    noteEn: 'Production in pieces; when the Data Review list shows the derived tons (totalTons) they are labelled طن (Step 8A correction).',
  },
  {
    // Phase 1 Step 8C-5: a sub-activity of the lines that pack (packaging on their record).
    operationCode: 'OP-PACK', nameAr: 'التعبئة والتغليف', nameEn: 'Packing & Packaging', stageType: null,
    production: null,
    otherMeasures: [
      { fields: ['packaging.packedQuantity'], unit: 'packaging.packedUnit', noteEn: 'packed quantity in its own recorded unit - never converted' },
      { fields: ['packaging.packageCount'], unit: 'packaging.packageUnit', noteEn: 'number of packages, e.g. شكارة' },
    ],
    outputUnits: '-', consumptionUnits: '-', reviewListUnit: null, status: 'SUB_ACTIVITY',
    noteAr: 'نشاط فرعي داخل سجلات الخطوط التي تعبئ إنتاجها - ليس سجل إنتاج مستقل.', noteEn: 'A sub-activity inside the records of the lines that pack their output - not a standalone production record.',
  },
  {
    // Phase 1 Step 8C-5: its own record type, the pressing measure.
    operationCode: 'OP-HAND', nameAr: 'تصنيع الطوب اليدوي', nameEn: 'Hand-made Brick Production', stageType: 'handmade_brick',
    production: { fields: ['productionQuantity'], unit: 'قطعة', noteEn: 'pieces formed by hand' },
    otherMeasures: [{ fields: ['pieceWeightKg'], unit: 'كجم', noteEn: 'kg per piece - tons derived only when given' }],
    outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'قطعة', status: 'READY',
    noteAr: 'الإنتاج بالقطعة كالمكابس؛ الوزن من وزن القطعة عند إدخاله فقط.', noteEn: 'Production in pieces, as pressing; weight only from an entered piece weight.',
  },
  {
    operationCode: 'OP-FOAM', nameAr: 'إنتاج الطوب الفوم', nameEn: 'Foam Brick Production', stageType: 'lightweight_foam',
    production: { fields: ['productionQuantity'], unit: 'طن', noteEn: 'form label: ton' },
    otherMeasures: [], outputUnits: OUTPUTS, consumptionUnits: CONSUMPTION, reviewListUnit: 'طن', status: 'READY', noteAr: '', noteEn: '',
  },
  {
    // Phase 1 Step 8C-5: extrusion is recorded on a pressing record (formingMethod EXTRUSION).
    operationCode: 'OP-EXTRUDER', nameAr: 'البثق', nameEn: 'Extrusion', stageType: null,
    production: null, otherMeasures: [], outputUnits: '-', consumptionUnits: '-', reviewListUnit: 'قطعة', status: 'SUB_ACTIVITY',
    noteAr: 'يُسجل ضمن سجل المكابس (طريقة التشكيل: بثق) بنفس وحدة القطعة.', noteEn: 'Recorded on a pressing record (forming method: extrusion) in the same piece unit.',
  },
];

/** The fields the universal stage-record read takes its list `quantity` from, in that order (stageRecordService). */
export const STAGE_LIST_QUANTITY_FIELDS = ['productionQuantity', 'quantity', 'totalTons', 'totalCount'] as const;

/**
 * The unit of the Data Review list quantity (Phase 1 Step 8A) - the unit of the
 * field that quantity actually came from, so the label never contradicts the
 * number. A label only: the number, its field and every calculation are unchanged.
 *   chinese_mills  طن - production quantity (the bag count, شكارة, is a separate field)
 *   sorting        قطعة for a count field; طن when the number is the derived totalTons
 *   pressing       قطعة; every other stage طن - as before
 *   handmade_brick قطعة - pieces, as pressing (Step 8C-5)
 */
export function stageListQuantityUnit(stageType: string | null | undefined, data: Record<string, unknown> | null | undefined): string {
  const d = data ?? {};
  const source = STAGE_LIST_QUANTITY_FIELDS.find((f) => d[f] !== null && d[f] !== undefined) ?? null;
  if (stageType === 'sorting') return source === 'totalTons' ? 'طن' : 'قطعة';
  if (stageType === 'pressing' || stageType === 'handmade_brick') return 'قطعة';
  return 'طن';
}

export function stageUomRow(stageType: string | null | undefined): StageUomRow | null {
  return STAGE_UOM_MATRIX.find((r) => r.stageType !== null && r.stageType === stageType) ?? null;
}

/**
 * A record's own production quantity in its true unit, from the matrix - not the
 * review list label. Null quantity when the field holds no number.
 */
export function stageProductionMeasure(stageType: string | null | undefined, data: Record<string, unknown> | null | undefined): { field: string | null; quantity: number | null; unit: string | null } {
  const row = stageUomRow(stageType);
  if (!row?.production) return { field: null, quantity: null, unit: null };
  const src = data ?? {};
  const field = row.production.fields.find((f) => typeof src[f] === 'number' && Number.isFinite(src[f] as number)) ?? null;
  return { field: field ?? row.production.fields[0], quantity: field ? (src[field] as number) : null, unit: row.production.unit };
}

// --- Findings ------------------------------------------------------------------------------

export type UomEntityType = 'STAGE' | 'BOM_VERSION' | 'PRODUCTION_RECORD' | 'CONSUMPTION_LINE' | 'PRODUCTION_OUTPUT' | 'MATERIAL' | 'PRODUCT';

export type UomIssue =
  | 'READY'
  | 'MISSING_UOM'
  | 'UNKNOWN_UOM'
  | 'LEGACY_ALIAS'
  | 'CONVERSION_NOT_CONFIGURED'
  | 'BASIS_UNIT_NOT_COMPATIBLE'
  | 'MISSING_BOM_BASIS'
  | 'UNIT_MISMATCH_RISK'
  | 'VARIANCE_REQUIRES_EXPLICIT_NORMALIZATION'
  | 'NOT_POSITIVE_QUANTITY'
  | 'UNKNOWN_ITEM';

export interface UomFinding {
  entityType: UomEntityType;
  recordId: string;
  lineId: string | null;
  stage: string | null;
  /** BOM code / version, job, or other context when known. */
  context: string | null;
  field: string;
  originalUom: string | null;
  normalizedUom: string | null;
  category: UomCategory | null;
  severity: UomSeverity;
  issue: UomIssue;
  reasonAr: string;
  reasonEn: string;
  recommendedActionAr: string;
  recommendedActionEn: string;
}

type Stored = Record<string, unknown> & { id?: string };

export interface UomReadinessInput {
  /** Stage records as stored, each with its stage type. */
  stageRecords?: ReadonlyArray<{ id: string; stageType: string; data: Record<string, unknown> }>;
  bomVersions?: readonly Stored[];
  boms?: readonly Stored[];
  jobs?: readonly Stored[];
  products?: readonly Stored[];
  materials?: readonly Stored[];
  /** Explicitly configured business conversions, if any. None exist today. */
  businessConversions?: readonly BusinessUomConversion[];
}

export interface UomReadinessSummary {
  totalAnalyzed: number;
  ready: number;
  warnings: number;
  blocking: number;
  unknownUom: number;
  legacyAliases: number;
  conversionNotConfigured: number;
  unitMismatches: number;
  bomVersionsAnalyzed: number;
  productionRecordsAnalyzed: number;
  consumptionLinesAnalyzed: number;
  productionOutputsAnalyzed: number;
}

export const UOM_SUMMARY_LABELS: Readonly<Record<'totalAnalyzed' | 'ready' | 'warnings' | 'blocking' | 'unknownUom' | 'legacyAliases' | 'conversionNotConfigured' | 'unitMismatches', { ar: string; en: string }>> = {
  totalAnalyzed: { ar: 'إجمالي السجلات', en: 'Total analyzed' },
  ready: { ar: 'جاهز', en: 'Ready' },
  warnings: { ar: 'تحذيرات', en: 'Warnings' },
  blocking: { ar: 'أخطاء مانعة', en: 'Blocking' },
  unknownUom: { ar: 'وحدات غير معروفة', en: 'Unknown UOM' },
  legacyAliases: { ar: 'مرادفات قديمة', en: 'Legacy aliases' },
  conversionNotConfigured: { ar: 'تحويلات غير مهيأة', en: 'Conversion not configured' },
  unitMismatches: { ar: 'اختلافات الوحدات', en: 'Unit mismatches' },
};

const ACTIONS: Record<UomIssue, { ar: string; en: string }> = {
  READY: { ar: 'لا يلزم إجراء.', en: 'No action needed.' },
  MISSING_UOM: { ar: 'أدخل وحدة معتمدة من الشاشة الأصلية للسجل.', en: 'Enter an approved unit through the record\'s existing screen.' },
  UNKNOWN_UOM: { ar: 'استبدل القيمة بوحدة معتمدة بعد مراجعتها - لا يتم الاستبدال تلقائيًا.', en: 'Review and replace the value with an approved unit - it is not replaced automatically.' },
  LEGACY_ALIAS: { ar: 'استبدل التهجئة القديمة بالوحدة المعتمدة.', en: 'Replace the legacy spelling with the approved unit label.' },
  CONVERSION_NOT_CONFIGURED: { ar: 'هيئ تحويلًا معتمدًا صريحًا من الإدارة، أو سجّل الكمية بنفس الوحدة.', en: 'Configure an explicit business conversion, or record the quantity in the same unit.' },
  BASIS_UNIT_NOT_COMPATIBLE: { ar: 'استخدم وحدة الأساس للمكوّن، أو هيئ تحويلًا معتمدًا صريحًا.', en: 'Use the basis unit for the component, or configure an explicit business conversion.' },
  MISSING_BOM_BASIS: { ar: 'أدخل كمية الأساس ووحدتها المعتمدة في إصدار قائمة المواد.', en: 'Enter the basis quantity and an approved basis unit on the BOM version.' },
  UNIT_MISMATCH_RISK: { ar: 'راجع الوحدة مع صنفها أو مع تعريف المرحلة قبل التكاليف.', en: 'Review the unit against its item or stage definition before costing.' },
  VARIANCE_REQUIRES_EXPLICIT_NORMALIZATION: { ar: 'سجّل الإنتاج بوحدة أساس قائمة المواد، أو اعتمد تحويلًا صريحًا للمقارنة.', en: 'Record production in the BOM basis unit, or approve an explicit conversion for the comparison.' },
  NOT_POSITIVE_QUANTITY: { ar: 'صحح الكمية من الشاشة الأصلية للسجل.', en: 'Correct the quantity through the record\'s existing screen.' },
  UNKNOWN_ITEM: { ar: 'اربط السطر بصنف موجود من الشاشة الأصلية.', en: 'Link the line to an existing item through its existing screen.' },
};

const ENTITY_ORDER: readonly UomEntityType[] = ['STAGE', 'BOM_VERSION', 'PRODUCTION_RECORD', 'CONSUMPTION_LINE', 'PRODUCTION_OUTPUT', 'MATERIAL', 'PRODUCT'];
const SEVERITY_RANK: Record<UomSeverity, number> = { BLOCKING: 0, WARNING: 1, INFO: 2 };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

interface Base {
  entityType: UomEntityType;
  recordId: string;
  lineId?: string | null;
  stage?: string | null;
  context?: string | null;
  field: string;
}

function finding(base: Base, value: unknown, severity: UomSeverity, issue: UomIssue, reasonAr: string, reasonEn: string): UomFinding {
  const n = normaliseUom(value);
  return {
    entityType: base.entityType,
    recordId: base.recordId,
    lineId: base.lineId ?? null,
    stage: base.stage ?? null,
    context: base.context ?? null,
    field: base.field,
    originalUom: n.original,
    normalizedUom: n.normalized,
    category: n.definition?.category ?? null,
    severity,
    issue,
    reasonAr,
    reasonEn,
    recommendedActionAr: ACTIONS[issue].ar,
    recommendedActionEn: ACTIONS[issue].en,
  };
}

/** The data-quality finding for one stored unit value. `required` = absence is a problem. */
function unitFinding(base: Base, value: unknown, required: boolean): UomFinding | null {
  const n = normaliseUom(value);
  switch (n.status) {
    case 'APPROVED':
      return finding(base, value, 'INFO', 'READY', 'وحدة معتمدة.', 'Approved unit.');
    case 'LEGACY_ALIAS':
      return finding(base, value, 'WARNING', 'LEGACY_ALIAS', `تهجئة قديمة للوحدة "${n.normalized}".`, `Legacy spelling of "${n.normalized}".`);
    case 'UNKNOWN':
      return finding(base, value, 'BLOCKING', 'UNKNOWN_UOM', `"${n.original}" ليست وحدة معتمدة.`, `"${n.original}" is not an approved unit.`);
    default:
      return required ? finding(base, value, 'BLOCKING', 'MISSING_UOM', 'الوحدة غير مسجلة.', 'No unit recorded.') : null;
  }
}

const isPositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Line unit vs its item's master unit: exact, a physical relation only, or unrelated. */
function itemUnitFinding(base: Base, lineUnit: unknown, itemUnit: unknown, context: UomConversionContext, configured: readonly BusinessUomConversion[]): UomFinding | null {
  if (normaliseUom(itemUnit).status !== 'APPROVED' && normaliseUom(itemUnit).status !== 'LEGACY_ALIAS') return null;
  const c = uomCompatibility(lineUnit, itemUnit, context, configured);
  if (c.status === 'EXACT_MATCH' || c.status === 'BUSINESS_CONVERSION_ALLOWED' || c.status === 'UNKNOWN_UOM' || c.status === 'MISSING_UOM') return null;
  const itemU = c.to.normalized;
  if (c.status === 'PHYSICALLY_CONVERTIBLE') {
    return finding(base, lineUnit, 'WARNING', 'CONVERSION_NOT_CONFIGURED', `الوحدة تختلف عن وحدة الصنف (${itemU}) - علاقة فيزيائية معروفة لكن لا يوجد تحويل معتمد.`, `The unit differs from the item's unit (${itemU}) - physically related, but no business conversion is configured.`);
  }
  return finding(base, lineUnit, 'WARNING', 'UNIT_MISMATCH_RISK', `الوحدة تختلف عن وحدة الصنف (${itemU}) ولا يوجد تحويل بينهما.`, `The unit differs from the item's unit (${itemU}) and no conversion exists between them.`);
}

/**
 * Analyses the given data. Deterministic: the same input always gives the same
 * findings in the same order and the same summary. Nothing is mutated.
 */
export function analyzeUomReadiness(input: UomReadinessInput): { findings: UomFinding[]; summary: UomReadinessSummary } {
  const findings: UomFinding[] = [];
  const push = (f: UomFinding | null) => { if (f) findings.push(f); };
  const configured = input.businessConversions ?? [];
  const byId = (list: readonly Stored[] | undefined, id: string) => (list ?? []).find((r) => String(r.id ?? '') === id);
  const itemOf = (source: string, id: string) => (source === 'products' ? byId(input.products, id) : byId(input.materials, id));
  const itemsLoaded = (source: string) => (source === 'products' ? input.products !== undefined : input.materials !== undefined);
  const records = input.stageRecords ?? [];
  let consumptionLines = 0;
  let outputLines = 0;

  // Stages present in the data: the matrix's code-level status.
  const stagesPresent = [...new Set(records.map((r) => r.stageType))].sort();
  for (const st of stagesPresent) {
    const row = stageUomRow(st);
    const base: Base = { entityType: 'STAGE', recordId: st, stage: st, field: 'production unit (Data Review list)' };
    if (!row) {
      push(finding(base, null, 'BLOCKING', 'MISSING_UOM', 'مرحلة غير معروفة - لا توجد وحدة إنتاج معرفة.', 'Unknown stage - no production unit is defined.'));
      continue;
    }
    const count = records.filter((r) => r.stageType === st).length;
    if (row.status === 'UNIT_MISMATCH_RISK') {
      push({ ...finding(base, row.reviewListUnit, 'WARNING', 'UNIT_MISMATCH_RISK', row.noteAr, row.noteEn), context: `${count} record(s)`, normalizedUom: row.production?.unit ?? null, category: normaliseUom(row.production?.unit).definition?.category ?? null });
    } else {
      push({ ...finding(base, row.production?.unit, 'INFO', 'READY', 'وحدة الإنتاج معرفة للمرحلة.', 'The stage production unit is defined.'), context: `${count} record(s)` });
    }
  }

  // BOM versions.
  const versions = input.bomVersions ?? [];
  for (const v of versions) {
    const id = String(v.id ?? '');
    const header = byId(input.boms, text(v.bomId));
    const context = `${header ? text(header.code) : text(v.bomId)} / ${text(v.versionCode)}`;
    const f = bomFormula(v);
    const hasBasisInput = (v.basisQuantity !== null && v.basisQuantity !== undefined && v.basisQuantity !== '') || text(v.basisUnit) !== '';
    const basisBase: Base = { entityType: 'BOM_VERSION', recordId: id, context, field: 'basisUnit' };
    if (hasBasisInput) {
      push(unitFinding(basisBase, v.basisUnit, true));
      if (!isPositive(v.basisQuantity)) push(finding({ ...basisBase, field: 'basisQuantity' }, v.basisUnit, 'BLOCKING', 'MISSING_BOM_BASIS', 'كمية الأساس يجب أن تكون أكبر من صفر.', 'The basis quantity must be greater than zero.'));
    } else if (f.basisRequired) {
      push(finding(basisBase, null, 'BLOCKING', 'MISSING_BOM_BASIS', 'الإصدار يحتوي نسبًا أو إضافات بدون أساس.', 'The version has percentages or additives but no basis.'));
    }
    const components = Array.isArray(v.components) ? (v.components as Array<Record<string, unknown>>) : [];
    components.forEach((c, i) => {
      const lineBase: Base = { entityType: 'BOM_VERSION', recordId: id, lineId: text(c.lineId) || null, context, field: 'components.unit' };
      push(unitFinding(lineBase, c.unit, true));
      const line = f.lines[i];
      if (!f.basisValid || !line || normaliseUom(c.unit).status !== 'APPROVED' || text(c.unit) === f.basisUnit) return;
      if (line.percentage === null) return; // quantity-only line: nothing to check against the basis
      const compat = uomCompatibility(c.unit, f.basisUnit, 'BOM_BASIS_CONSISTENCY', configured);
      if (compat.status === 'BUSINESS_CONVERSION_ALLOWED') return;
      const blocking = line.quantity === null; // a percentage-only line cannot even be given a quantity
      if (compat.status === 'PHYSICALLY_CONVERTIBLE') {
        push(finding(lineBase, c.unit, blocking ? 'BLOCKING' : 'WARNING', 'CONVERSION_NOT_CONFIGURED', `وحدة المكوّن تختلف عن وحدة الأساس (${f.basisUnit}) - لا يُتحقق من النسبة إلا بوحدة الأساس.`, `The component unit differs from the basis unit (${f.basisUnit}) - the percentage is checked only in the basis unit.`));
      } else {
        push(finding(lineBase, c.unit, blocking ? 'BLOCKING' : 'WARNING', 'BASIS_UNIT_NOT_COMPATIBLE', `وحدة المكوّن لا ترتبط بوحدة الأساس (${f.basisUnit}).`, `The component unit has no relation to the basis unit (${f.basisUnit}).`));
      }
    });
  }

  // Production records: consumption lines, outputs, and the production unit vs the job's BOM basis.
  for (const r of records) {
    const data = r.data ?? {};
    const materials = Array.isArray(data.materials) ? (data.materials as Array<Record<string, unknown>>) : [];
    materials.forEach((line) => {
      consumptionLines++;
      const base: Base = { entityType: 'CONSUMPTION_LINE', recordId: r.id, lineId: text(line.lineId) || null, stage: r.stageType, field: 'materials.unit' };
      const unit = unitFinding(base, line.unit, true);
      push(unit);
      if (!isPositive(line.quantity)) push(finding({ ...base, field: 'materials.quantity' }, line.unit, 'BLOCKING', 'NOT_POSITIVE_QUANTITY', 'الكمية ليست رقمًا أكبر من صفر.', 'The quantity is not a number greater than zero.'));
      const source = text(line.itemSource) || 'materials';
      const itemId = text(line.materialId);
      if (itemsLoaded(source)) {
        const item = itemId ? itemOf(source, itemId) : undefined;
        if (!item) push(finding({ ...base, field: 'materials.materialId' }, line.unit, 'BLOCKING', 'UNKNOWN_ITEM', 'الصنف غير موجود.', 'The item does not exist.'));
        else if (unit?.issue === 'READY' || unit?.issue === 'LEGACY_ALIAS') push(itemUnitFinding(base, line.unit, item.unit, 'COSTING', configured));
      }
    });
    const outputs = Array.isArray(data.productionOutputs) ? (data.productionOutputs as Array<Record<string, unknown>>) : [];
    outputs.forEach((line) => {
      outputLines++;
      const base: Base = { entityType: 'PRODUCTION_OUTPUT', recordId: r.id, lineId: text(line.lineId) || null, stage: r.stageType, field: 'productionOutputs.unit' };
      const unit = unitFinding(base, line.unit, true);
      push(unit);
      if (!isPositive(line.quantity)) push(finding({ ...base, field: 'productionOutputs.quantity' }, line.unit, 'BLOCKING', 'NOT_POSITIVE_QUANTITY', 'الكمية ليست رقمًا أكبر من صفر.', 'The quantity is not a number greater than zero.'));
      const source = text(line.itemSource);
      const itemId = text(line.itemId);
      if ((source === 'products' || source === 'materials') && itemsLoaded(source)) {
        const item = itemId ? itemOf(source, itemId) : undefined;
        if (!item) push(finding({ ...base, field: 'productionOutputs.itemId' }, line.unit, 'BLOCKING', 'UNKNOWN_ITEM', 'الصنف غير موجود.', 'The item does not exist.'));
        else if (unit?.issue === 'READY' || unit?.issue === 'LEGACY_ALIAS') push(itemUnitFinding(base, line.unit, item.unit, 'COSTING', configured));
      }
    });

    // A stored unit on the record itself (none of today's record types has one) is checked as stored.
    for (const field of ['productionUnit', 'unit']) {
      if (field in data) push(unitFinding({ entityType: 'PRODUCTION_RECORD', recordId: r.id, stage: r.stageType, field }, data[field], true));
    }

    const measure = stageProductionMeasure(r.stageType, data);
    const jobId = text(data.jobReferenceId);
    const job = jobId ? byId(input.jobs, jobId) : undefined;
    const version = job && text(job.bomVersionId) ? byId(input.bomVersions, text(job.bomVersionId)) : undefined;
    if (!version) continue;
    const f = bomFormula(version);
    if (!f.basisValid) continue; // reported on the BOM version itself
    const base: Base = { entityType: 'PRODUCTION_RECORD', recordId: r.id, stage: r.stageType, context: `job ${text(job!.code) || jobId}`, field: `production unit (${measure.field ?? '-'}) vs BOM basis` };
    if (!measure.unit) {
      push(finding(base, null, 'BLOCKING', 'MISSING_UOM', 'لا توجد وحدة إنتاج معرفة لهذه المرحلة.', 'No production unit is defined for this stage.'));
      continue;
    }
    const compat = uomCompatibility(measure.unit, f.basisUnit, 'QUANTITY_VARIANCE', configured);
    if (compat.status === 'EXACT_MATCH' || compat.status === 'BUSINESS_CONVERSION_ALLOWED') {
      push(finding(base, measure.unit, 'INFO', 'READY', `وحدة الإنتاج تطابق أساس قائمة المواد (${f.basisUnit}).`, `The production unit matches the BOM basis (${f.basisUnit}).`));
    } else if (compat.status === 'PHYSICALLY_CONVERTIBLE') {
      push(finding(base, measure.unit, 'WARNING', 'VARIANCE_REQUIRES_EXPLICIT_NORMALIZATION', `الإنتاج بوحدة ${measure.unit} والأساس ${f.basisQuantity} ${f.basisUnit} - علاقة فيزيائية معروفة، لكن مقارنة الكميات تتطلب توحيدًا صريحًا.`, `Production is in ${measure.unit}, the basis is ${f.basisQuantity} ${f.basisUnit} - physically convertible, but the variance requires explicit normalization.`));
    } else {
      push(finding(base, measure.unit, 'BLOCKING', 'CONVERSION_NOT_CONFIGURED', `الإنتاج بوحدة ${measure.unit} والأساس ${f.basisUnit} - لا يوجد تحويل معتمد، ولا يمكن حساب الكميات المعيارية.`, `Production is in ${measure.unit}, the basis in ${f.basisUnit} - no conversion is configured, so standard quantities cannot be scaled.`));
    }
  }

  // Master data units.
  for (const m of input.materials ?? []) push(unitFinding({ entityType: 'MATERIAL', recordId: String(m.id ?? ''), context: text(m.code) || null, field: 'unit' }, m.unit, true));
  for (const p of input.products ?? []) push(unitFinding({ entityType: 'PRODUCT', recordId: String(p.id ?? ''), context: text(p.code ?? p.productCode) || null, field: 'unit' }, p.unit, false));

  findings.sort((a, b) =>
    ENTITY_ORDER.indexOf(a.entityType) - ENTITY_ORDER.indexOf(b.entityType)
    || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.recordId.localeCompare(b.recordId)
    || (a.lineId ?? '').localeCompare(b.lineId ?? '')
    || a.field.localeCompare(b.field)
    || a.issue.localeCompare(b.issue));

  const count = (issue: UomIssue) => findings.filter((x) => x.issue === issue).length;
  const summary: UomReadinessSummary = {
    totalAnalyzed: findings.length,
    ready: findings.filter((x) => x.severity === 'INFO').length,
    warnings: findings.filter((x) => x.severity === 'WARNING').length,
    blocking: findings.filter((x) => x.severity === 'BLOCKING').length,
    unknownUom: count('UNKNOWN_UOM'),
    legacyAliases: count('LEGACY_ALIAS'),
    conversionNotConfigured: count('CONVERSION_NOT_CONFIGURED'),
    unitMismatches: count('UNIT_MISMATCH_RISK') + count('BASIS_UNIT_NOT_COMPATIBLE') + count('VARIANCE_REQUIRES_EXPLICIT_NORMALIZATION'),
    bomVersionsAnalyzed: versions.length,
    productionRecordsAnalyzed: records.length,
    consumptionLinesAnalyzed: consumptionLines,
    productionOutputsAnalyzed: outputLines,
  };
  return { findings, summary };
}

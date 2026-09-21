/**
 * The remaining production areas - Phase 1 Step 8C-5. Pure and Firebase-free.
 *
 * THREE NEW RECORD TYPES, each the shape of the closest existing stage
 * (types/index.ts documents the fields):
 *   thermal_concrete  the mortar record: product, tons, composite consumption
 *   tunnel_kiln       firing: fired product in tons, green bricks consumed, kiln and cars
 *   handmade_brick    forming by hand: pieces, optional piece weight
 * They use the same job / sub-job / batch / operation references (5A),
 * consumption (5B), outputs and genealogy (6), quantity variance (7), units (8),
 * costing period by date (8C) and write path (createStageRecord) as every stage.
 *
 * TWO OPERATIONS THAT ARE NOT RECORD FAMILIES:
 *   extrusion   a pressing record with formingMethod EXTRUSION (OP-EXTRUDER keeps
 *               its own operation; the record stays in the pressing collection)
 *   packing     an optional sub-activity block - packagingActivityPure.ts
 *
 * TUBE vs BALL MILL are distinct equipment types in one master. A mill whose type
 * was never recorded is NOT_IDENTIFIED - never guessed from its name.
 *
 * LABOUR, ENERGY AND STANDARD RATES are future-ready only: optional fields and a
 * rate shape with a validator. Nothing here calculates a rate, a cost or an
 * allocation, and no meter is assumed.
 */
import type { FormingMethod, ProductionStageType, TubeBallMillKind } from '../types';

export type ProductionAreaStage = Extract<ProductionStageType, 'thermal_concrete' | 'tunnel_kiln' | 'handmade_brick'>;

export const PRODUCTION_AREA_STAGES: readonly ProductionAreaStage[] = ['thermal_concrete', 'tunnel_kiln', 'handmade_brick'];

export function isProductionAreaStage(stageType: unknown): stageType is ProductionAreaStage {
  return (PRODUCTION_AREA_STAGES as readonly unknown[]).includes(stageType);
}

export interface ProductionAreaFieldSpec {
  /** Must be present on every new record of the stage. */
  required: readonly string[];
  /** Recorded when known. */
  optional: readonly string[];
  /** Accepted now, used only once the business supplies the data. */
  futureReady: readonly string[];
  /** The operation the record IS (resolved from the Operation Master's legacy stage). */
  operationCode: string;
  productionUnit: string;
}

/** Required vs optional vs future-ready, per new record type. */
export const PRODUCTION_AREA_FIELDS: Readonly<Record<ProductionAreaStage, ProductionAreaFieldSpec>> = {
  thermal_concrete: {
    required: ['date', 'productId', 'productionQuantity'],
    optional: ['customerId', 'batchNumber', 'manufacturingOrderNumber', 'customerRequestNumber', 'sourceDocumentReference', 'materials', 'productionOutputs', 'packaging', 'notes'],
    futureReady: ['operatingHours', 'workers'],
    operationCode: 'OP-TCONC',
    productionUnit: 'طن',
  },
  tunnel_kiln: {
    required: ['date', 'productId', 'productionQuantity'],
    optional: ['batchNumber', 'manufacturingOrderNumber', 'sourceDocumentReference', 'furnaceId', 'furnaceCarNumbers', 'furnaceCarIds', 'wasteQuantity', 'materials', 'productionOutputs', 'notes'],
    futureReady: ['operatingHours', 'workers'],
    operationCode: 'OP-TUNNEL-KILN',
    productionUnit: 'طن',
  },
  handmade_brick: {
    required: ['date', 'productId', 'productionQuantity'],
    optional: ['batchNumber', 'manufacturingOrderNumber', 'sourceDocumentReference', 'pieceWeightKg', 'wasteQuantity', 'materials', 'productionOutputs', 'notes'],
    futureReady: ['operatingHours', 'workers'],
    operationCode: 'OP-HAND',
    productionUnit: 'قطعة',
  },
};

/** Fields no new record type carries: packing on a kiln or on hand-made brick is refused. */
const FORBIDDEN_FIELDS: Readonly<Record<ProductionAreaStage, readonly string[]>> = {
  thermal_concrete: ['formingMethod'],
  tunnel_kiln: ['formingMethod', 'packaging'],
  handmade_brick: ['formingMethod', 'packaging'],
};

export interface ProductionAreaIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());
const blank = (value: unknown) => value === null || value === undefined || text(value) === '' || (Array.isArray(value) && value.length === 0);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function numberCheck(issues: ProductionAreaIssue[], data: Record<string, unknown>, field: string, rule: 'positive' | 'nonNegative', label: { ar: string; en: string }) {
  const value = data[field];
  if (blank(value)) return;
  const n = typeof value === 'number' ? value : Number(text(value));
  const ok = Number.isFinite(n) && (rule === 'positive' ? n > 0 : n >= 0);
  if (!ok) {
    issues.push({
      field,
      messageAr: rule === 'positive' ? `${label.ar} يجب أن تكون أكبر من صفر.` : `${label.ar} يجب ألا تكون سالبة.`,
      messageEn: rule === 'positive' ? `${label.en} must be greater than zero.` : `${label.en} must not be negative.`,
    });
  }
}

/**
 * The record-level rules of the three new record types. Consumption, outputs,
 * references and units keep their own shared validators - this adds only what
 * is specific to the new stages. Other stages return no issues.
 */
export function validateProductionAreaRecord(stageType: unknown, data: Record<string, unknown>): { valid: boolean; issues: ProductionAreaIssue[] } {
  if (!isProductionAreaStage(stageType)) return { valid: true, issues: [] };
  const spec = PRODUCTION_AREA_FIELDS[stageType];
  const issues: ProductionAreaIssue[] = [];

  for (const field of spec.required) {
    if (blank(data[field])) {
      issues.push({ field, messageAr: `الحقل "${field}" إلزامي لهذه المرحلة.`, messageEn: `"${field}" is required for this stage.` });
    }
  }
  if (!blank(data.date) && !ISO_DATE.test(text(data.date))) {
    issues.push({ field: 'date', messageAr: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD.', messageEn: 'The date must be YYYY-MM-DD.' });
  }
  numberCheck(issues, data, 'productionQuantity', 'positive', { ar: 'كمية الإنتاج', en: 'The production quantity' });
  numberCheck(issues, data, 'wasteQuantity', 'nonNegative', { ar: 'كمية الهالك', en: 'The waste quantity' });
  numberCheck(issues, data, 'operatingHours', 'nonNegative', { ar: 'ساعات التشغيل', en: 'Operating hours' });
  numberCheck(issues, data, 'pieceWeightKg', 'positive', { ar: 'وزن القطعة', en: 'The piece weight' });

  if (stageType === 'handmade_brick' && !blank(data.productionQuantity) && !Number.isInteger(Number(data.productionQuantity))) {
    issues.push({ field: 'productionQuantity', messageAr: 'عدد القطع يجب أن يكون عددًا صحيحًا.', messageEn: 'The piece count must be a whole number.' });
  }
  if (stageType === 'tunnel_kiln') {
    for (const field of ['furnaceCarNumbers', 'furnaceCarIds']) {
      const list = data[field];
      if (blank(list)) continue;
      if (!Array.isArray(list) || list.some((v) => typeof v !== 'string' || !v.trim())) {
        issues.push({ field, messageAr: 'قائمة العربات يجب أن تكون نصوصًا غير فارغة.', messageEn: 'The car list must hold non-empty text values.' });
      }
    }
    const ids = Array.isArray(data.furnaceCarIds) ? data.furnaceCarIds : [];
    const numbers = Array.isArray(data.furnaceCarNumbers) ? data.furnaceCarNumbers : [];
    if (ids.length > 0 && numbers.length > 0 && ids.length !== numbers.length) {
      issues.push({ field: 'furnaceCarIds', messageAr: 'عدد معرفات العربات لا يطابق عدد أرقامها.', messageEn: 'The car ids do not line up with the car numbers.' });
    }
  }
  for (const field of FORBIDDEN_FIELDS[stageType]) {
    if (!blank(data[field])) {
      issues.push({ field, messageAr: `الحقل "${field}" لا يُسجل على هذه المرحلة.`, messageEn: `"${field}" is not recorded on this stage.` });
    }
  }
  return { valid: issues.length === 0, issues };
}

// --- Extrusion inside pressing ---------------------------------------------------------

export const FORMING_METHODS: readonly FormingMethod[] = ['PRESSING', 'EXTRUSION'];
export const EXTRUSION_OPERATION_CODE = 'OP-EXTRUDER';

/** A pressing record's forming method; every record without one is pressing. */
export function formingMethodOf(record: Record<string, unknown> | null | undefined): FormingMethod {
  return text(record?.formingMethod).toUpperCase() === 'EXTRUSION' ? 'EXTRUSION' : 'PRESSING';
}

/** formingMethod is a pressing-only field, and only PRESSING or EXTRUSION. */
export function validateFormingMethod(stageType: unknown, value: unknown): ProductionAreaIssue[] {
  if (blank(value)) return [];
  if (text(stageType) !== 'pressing') {
    return [{ field: 'formingMethod', messageAr: 'طريقة التشكيل تُسجل على سجلات المكابس فقط.', messageEn: 'The forming method is recorded on pressing records only.' }];
  }
  if (!(FORMING_METHODS as readonly string[]).includes(text(value).toUpperCase())) {
    return [{ field: 'formingMethod', messageAr: 'طريقة التشكيل يجب أن تكون كبس أو بثق.', messageEn: 'The forming method must be PRESSING or EXTRUSION.' }];
  }
  return [];
}

// --- Tube vs Ball mill -------------------------------------------------------------------

export const TUBE_BALL_MILL_KINDS: readonly TubeBallMillKind[] = ['TUBE', 'BALL'];
export const EQUIPMENT_TYPE_NOT_IDENTIFIED = 'EQUIPMENT TYPE NOT IDENTIFIED IN SOURCE';

/** TUBE or BALL as recorded on the mill master; NOT_IDENTIFIED otherwise - never read from the name. */
export function tubeBallMillKindOf(mill: Record<string, unknown> | null | undefined): TubeBallMillKind | 'NOT_IDENTIFIED' {
  const kind = text(mill?.millKind).toUpperCase();
  return kind === 'TUBE' || kind === 'BALL' ? kind : 'NOT_IDENTIFIED';
}

export function validateTubeBallMillKind(value: unknown): ProductionAreaIssue[] {
  if (blank(value)) return [];
  return (TUBE_BALL_MILL_KINDS as readonly string[]).includes(text(value).toUpperCase())
    ? []
    : [{ field: 'millKind', messageAr: 'نوع الطاحونة يجب أن يكون أنبوبية أو كرات.', messageEn: 'The mill type must be TUBE or BALL.' }];
}

// --- Source document references (the Odoo "Source" column) -------------------------------

/**
 * Splits a Source cell into the references it plainly contains: press-slip
 * references ("PS03950", "ps04097") and furnace car numbers ("car65" -> "65").
 * Whatever is left is returned untouched as `unparsed` - never discarded, never
 * interpreted. The original text is always kept by the caller.
 */
export function parseSourceDocumentReference(value: unknown): { pressSlipReferences: string[]; furnaceCarNumbers: string[]; unparsed: string[] } {
  const raw = text(value);
  const pressSlipReferences: string[] = [];
  const furnaceCarNumbers: string[] = [];
  const unparsed: string[] = [];
  if (!raw) return { pressSlipReferences, furnaceCarNumbers, unparsed };
  for (const part of raw.split(/[\/,+]+/)) {
    let rest = part.trim();
    if (!rest) continue;
    rest = rest.replace(/ps\s*(\d+)/gi, (_m, digits: string) => {
      pressSlipReferences.push(`PS${digits}`);
      return ' ';
    });
    rest = rest.replace(/car\s*(\d+)/gi, (_m, digits: string) => {
      furnaceCarNumbers.push(digits);
      return ' ';
    });
    rest = rest.trim();
    if (rest) unparsed.push(rest);
  }
  return { pressSlipReferences, furnaceCarNumbers, unparsed };
}

// --- Future-ready foundations (no calculation) -----------------------------------------------

export const LABOR_DATA_SOURCE_STATUS = 'LABOR DATA SOURCE NOT AVAILABLE';
export const ENERGY_DATA_SOURCE_STATUS = 'ENERGY METER DATA SOURCE NOT AVAILABLE';

/**
 * A standard production rate - the shape only. Stored nowhere yet, used by no
 * calculation; it exists so the rate can be captured once the business
 * supplies it.
 */
export interface StandardProductionRate {
  operationId: string;
  logicalItemId?: string | null;
  equipmentId?: string | null;
  quantityPerHour: number;
  unit: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export function validateStandardProductionRate(rate: Partial<StandardProductionRate>): ProductionAreaIssue[] {
  const issues: ProductionAreaIssue[] = [];
  if (blank(rate.operationId)) issues.push({ field: 'operationId', messageAr: 'العملية إلزامية.', messageEn: 'The operation is required.' });
  if (!(typeof rate.quantityPerHour === 'number' && Number.isFinite(rate.quantityPerHour) && rate.quantityPerHour > 0)) {
    issues.push({ field: 'quantityPerHour', messageAr: 'المعدل يجب أن يكون أكبر من صفر.', messageEn: 'The rate must be greater than zero.' });
  }
  if (blank(rate.unit)) issues.push({ field: 'unit', messageAr: 'الوحدة إلزامية.', messageEn: 'The unit is required.' });
  if (!ISO_DATE.test(text(rate.effectiveFrom))) issues.push({ field: 'effectiveFrom', messageAr: 'تاريخ البداية بصيغة YYYY-MM-DD.', messageEn: 'effectiveFrom must be YYYY-MM-DD.' });
  if (!blank(rate.effectiveTo)) {
    if (!ISO_DATE.test(text(rate.effectiveTo))) issues.push({ field: 'effectiveTo', messageAr: 'تاريخ النهاية بصيغة YYYY-MM-DD.', messageEn: 'effectiveTo must be YYYY-MM-DD.' });
    else if (text(rate.effectiveTo) < text(rate.effectiveFrom)) issues.push({ field: 'effectiveTo', messageAr: 'تاريخ النهاية قبل البداية.', messageEn: 'effectiveTo is before effectiveFrom.' });
  }
  return issues;
}

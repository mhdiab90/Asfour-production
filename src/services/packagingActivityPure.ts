/**
 * Packing as a sub-activity - Phase 1 Step 8C-5. Pure and Firebase-free.
 *
 * Packing is NOT a production record of its own. It is something a production
 * line does to its own output, so it lives on that line's record as an optional
 * `packaging` block (types/index.ts PackagingActivity):
 *
 *   applicable   sorting (the "sorting & packing" line), mortar_concrete,
 *                thermal_concrete, rotary_furnace, chinese_mills, tube_ball_mills
 *   never        pressing (and extrusion, which is recorded on pressing), mixing,
 *                tunnel_kiln, lightweight_foam, handmade_brick
 *
 * Nothing is fabricated: no block means no packing was recorded. Quantities stay
 * in the unit they were recorded in - an approved unit, never converted - and a
 * number without its unit is refused. The packing operation (OP-PACK) is linked
 * only when exactly one active Operation Master record carries that code.
 */
import type { Operation, PackagingActivity, ProductionStageType } from '../types';
import { normaliseUom } from './uomPure';
import { normalizeCode } from '../utils/searchUtils';

export const PACKAGING_OPERATION_CODE = 'OP-PACK';

/** The lines that pack their own output - an explicit list, never inferred. */
export const PACKAGING_APPLICABLE_STAGES: readonly ProductionStageType[] = [
  'sorting',
  'mortar_concrete',
  'thermal_concrete',
  'rotary_furnace',
  'chinese_mills',
  'tube_ball_mills',
];

export interface PackagingIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());
const blank = (value: unknown) => value === null || value === undefined || text(value) === '';

export function packagingApplies(stageType: ProductionStageType | string | null | undefined): boolean {
  return (PACKAGING_APPLICABLE_STAGES as readonly string[]).includes(text(stageType));
}

/** True when the block records nothing at all - treated exactly like no block. */
export function isEmptyPackaging(packaging: Partial<PackagingActivity> | null | undefined): boolean {
  if (!packaging) return true;
  return blank(packaging.packedQuantity) && blank(packaging.packageCount) && blank(packaging.notes);
}

/** The active packing operation, or null when none or more than one carries OP-PACK. */
export function resolvePackagingOperation(operations: readonly Operation[] | null | undefined): Operation | null {
  const matches = (operations ?? []).filter((o) => o.active !== false && normalizeCode(o.code) === PACKAGING_OPERATION_CODE);
  return matches.length === 1 ? matches[0] : null;
}

function checkQuantity(
  issues: PackagingIssue[],
  field: string,
  unitField: string,
  quantity: unknown,
  unit: unknown,
  options: { integer: boolean; label: { ar: string; en: string } },
) {
  if (blank(quantity)) {
    if (!blank(unit)) issues.push({ field, messageAr: `${options.label.ar}: وحدة بدون كمية.`, messageEn: `${options.label.en}: a unit without a quantity.` });
    return;
  }
  const n = typeof quantity === 'number' ? quantity : Number(text(quantity));
  if (!Number.isFinite(n) || n < 0) {
    issues.push({ field, messageAr: `${options.label.ar} يجب أن تكون رقمًا غير سالب.`, messageEn: `${options.label.en} must be a non-negative number.` });
    return;
  }
  if (options.integer && !Number.isInteger(n)) {
    issues.push({ field, messageAr: `${options.label.ar} يجب أن يكون عددًا صحيحًا.`, messageEn: `${options.label.en} must be a whole number.` });
  }
  const u = normaliseUom(unit);
  if (u.status === 'MISSING') {
    issues.push({ field: unitField, messageAr: `${options.label.ar}: الوحدة إلزامية - لا تُفترض وحدة.`, messageEn: `${options.label.en}: the unit is required - no unit is assumed.` });
  } else if (u.status === 'UNKNOWN') {
    issues.push({ field: unitField, messageAr: `الوحدة "${text(unit)}" ليست وحدة معتمدة.`, messageEn: `Unit "${text(unit)}" is not an approved unit.` });
  }
}

/**
 * Checks a packaging block against the stage it is recorded on. An empty or
 * absent block is always valid. Never mutates its input.
 */
export function validatePackagingActivity(
  stageType: ProductionStageType | string | null | undefined,
  packaging: Partial<PackagingActivity> | null | undefined,
): { valid: boolean; issues: PackagingIssue[] } {
  if (isEmptyPackaging(packaging)) return { valid: true, issues: [] };
  const issues: PackagingIssue[] = [];
  if (!packagingApplies(stageType)) {
    issues.push({
      field: 'packaging',
      messageAr: `التعبئة لا تُسجل على مرحلة "${text(stageType)}" - هي نشاط فرعي لخطوط الفرز والتعبئة والمونة والخرسانة والفرن الدوار والطواحين فقط.`,
      messageEn: `Packing is not recorded on the "${text(stageType)}" stage - it is a sub-activity of the sorting & packing, mortar / concrete, rotary kiln and mill lines only.`,
    });
    return { valid: false, issues };
  }
  const p = packaging as Partial<PackagingActivity>;
  checkQuantity(issues, 'packaging.packedQuantity', 'packaging.packedUnit', p.packedQuantity, p.packedUnit, { integer: false, label: { ar: 'الكمية المعبأة', en: 'The packed quantity' } });
  checkQuantity(issues, 'packaging.packageCount', 'packaging.packageUnit', p.packageCount, p.packageUnit, { integer: true, label: { ar: 'عدد العبوات', en: 'The package count' } });
  return { valid: issues.length === 0, issues };
}

/**
 * The block to store: trimmed, units in their approved spelling, numbers as
 * numbers, and OP-PACK linked when it resolves. Null when nothing was recorded.
 * Call only after validatePackagingActivity passed.
 */
export function normalisePackagingActivity(
  packaging: Partial<PackagingActivity> | null | undefined,
  operations?: readonly Operation[] | null,
): PackagingActivity | null {
  if (isEmptyPackaging(packaging)) return null;
  const p = packaging as Partial<PackagingActivity>;
  const out: PackagingActivity = {};
  const operation = resolvePackagingOperation(operations);
  if (operation?.id) out.operationId = String(operation.id);
  if (!blank(p.packedQuantity)) {
    out.packedQuantity = Number(p.packedQuantity);
    out.packedUnit = normaliseUom(p.packedUnit).normalized;
  }
  if (!blank(p.packageCount)) {
    out.packageCount = Number(p.packageCount);
    out.packageUnit = normaliseUom(p.packageUnit).normalized;
  }
  if (!blank(p.notes)) out.notes = text(p.notes);
  return out;
}

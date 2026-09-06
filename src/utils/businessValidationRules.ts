/**
 * Centralized Business Validation Warning system (§5-19).
 *
 * Distinguishes two fundamentally different kinds of validation problem:
 *
 * - BLOCKING: the record cannot be safely stored/interpreted (missing
 *   required identifier, malformed date, unresolved relational entity,
 *   invalid data type, corrupted structure...). These never gain an
 *   override option - the application literally cannot save the data.
 *
 * - WARNING: the values are technically valid and CAN be stored, but are
 *   logically unusual/suspicious (e.g. waste > production). These CAN be
 *   overridden by a user with the `validation.overrideWarnings` permission,
 *   and the original values are NEVER altered to "fix" the warning.
 *
 * This module is the single source of truth for which rule codes are which
 * severity, so the classification isn't scattered as ad-hoc if-statements
 * across DataImportView.tsx / ProductionEntryForm.tsx / the import service.
 */

export type ValidationSeverity = 'INFO' | 'WARNING' | 'BLOCKING';

export interface ValidationResult {
  severity: ValidationSeverity;
  code: string;
  message: string;
  field?: string;
  metadata?: Record<string, any>;
  canOverride: boolean;
}

export interface BusinessValidationRuleDef {
  severity: ValidationSeverity;
  canOverride: boolean;
  messageAr: (ctx: Record<string, any>) => string;
  messageEn: (ctx: Record<string, any>) => string;
  field?: string;
}

/**
 * Central registry (§19). Adding a new business rule means adding ONE entry
 * here plus a small evaluator function below - never a new scattered
 * if/blocking-push in a component.
 */
export const BUSINESS_VALIDATION_RULES: Record<string, BusinessValidationRuleDef> = {
  WASTE_GREATER_THAN_PRODUCTION: {
    severity: 'WARNING',
    canOverride: true,
    field: 'wasteQuantity',
    messageAr: () => 'كمية الهالك أكبر من كمية الإنتاج.',
    messageEn: () => 'Waste quantity is greater than production quantity.',
  },
  HIGH_WASTE_PERCENTAGE: {
    severity: 'WARNING',
    canOverride: true,
    field: 'wasteQuantity',
    messageAr: (ctx) => `نسبة الهالك مرتفعة بشكل غير معتاد (${ctx.wastePercentage}%).`,
    messageEn: (ctx) => `Waste percentage is unusually high (${ctx.wastePercentage}%).`,
  },
  HIGH_DOWNTIME: {
    severity: 'WARNING',
    canOverride: true,
    field: 'downtime',
    messageAr: () => 'مدة التوقف مرتفعة مقارنة بالإنتاج المسجل.',
    messageEn: () => 'Downtime is unusually high compared with the recorded production.',
  },
  INVALID_SHIFT: {
    severity: 'BLOCKING',
    canOverride: false,
    field: 'shift',
    messageAr: (ctx) => `رقم الوردية (${ctx.shiftRaw ?? 'فارغ'}) غير صالح. الورديات المسموح بها: 1، 2، 3.`,
    messageEn: (ctx) => `Shift number (${ctx.shiftRaw ?? 'empty'}) is invalid. Allowed shifts: 1, 2, 3.`,
  },
  /** Chinese Mills only (§20): number-of-bags x weight-class vs. production-quantity consistency - never auto-corrected, technically valid to store as-is. */
  BAG_WEIGHT_MISMATCH: {
    severity: 'WARNING',
    canOverride: true,
    field: 'numberOfBags',
    messageAr: () => 'عدد الجواني × فئة الوزن لا يتوافق مع كمية الإنتاج.',
    messageEn: () => 'Bag count multiplied by weight class does not match the production quantity.',
  },
};

/** Configurable thresholds for the WARNING rules - deliberately conservative and centralized, not scattered magic numbers. */
export const BUSINESS_VALIDATION_THRESHOLDS = {
  /** Waste as a percentage of production above which HIGH_WASTE_PERCENTAGE fires. Deliberately well above ordinary/expected waste ratios (e.g. TEST 5's 50% waste is normal and must stay VALID with zero warnings) - only flags a genuinely unusual ratio. */
  HIGH_WASTE_PERCENTAGE_THRESHOLD: 80,
  /** Total fault/downtime minutes as a fraction of the shift's total minutes above which HIGH_DOWNTIME fires. */
  HIGH_DOWNTIME_RATIO_THRESHOLD: 0.5,
  /** Relative difference between (bags x weightClass) and the recorded production quantity above which BAG_WEIGHT_MISMATCH fires - generous enough to absorb ordinary bag-count/weight rounding, per TEST 8 (750kg, exact match => VALID) vs TEST 9 (500kg, ~33% off => WARNING). */
  BAG_WEIGHT_MISMATCH_RATIO_THRESHOLD: 0.1,
};

function buildResult(code: keyof typeof BUSINESS_VALIDATION_RULES, ctx: Record<string, any>, language: 'ar' | 'en'): ValidationResult {
  const rule = BUSINESS_VALIDATION_RULES[code];
  return {
    severity: rule.severity,
    code,
    message: language === 'ar' ? rule.messageAr(ctx) : rule.messageEn(ctx),
    field: rule.field,
    metadata: ctx,
    canOverride: rule.canOverride,
  };
}

export interface ProductionWarningContext {
  productionQuantity: number;
  wasteQuantity: number;
  calculatedTotalFaults?: number;
  shiftHours?: number;
}

/**
 * Evaluates every configured WARNING-tier business rule for a production
 * record (used by both direct Production Entry and Historical Import row
 * validation) and returns whichever ones actually fire. Never returns
 * BLOCKING rules - those stay in the existing required-field validation.
 */
export function evaluateProductionWarnings(ctx: ProductionWarningContext, language: 'ar' | 'en' = 'ar'): ValidationResult[] {
  const results: ValidationResult[] = [];
  const { productionQuantity, wasteQuantity, calculatedTotalFaults, shiftHours } = ctx;

  if (productionQuantity > 0 && wasteQuantity > productionQuantity) {
    results.push(buildResult('WASTE_GREATER_THAN_PRODUCTION', ctx, language));
  }

  if (productionQuantity > 0 && wasteQuantity <= productionQuantity) {
    const wastePercentage = Math.round((wasteQuantity / productionQuantity) * 10000) / 100;
    if (wastePercentage > BUSINESS_VALIDATION_THRESHOLDS.HIGH_WASTE_PERCENTAGE_THRESHOLD) {
      results.push(buildResult('HIGH_WASTE_PERCENTAGE', { ...ctx, wastePercentage }, language));
    }
  }

  if (calculatedTotalFaults != null && shiftHours && shiftHours > 0) {
    const shiftMinutes = shiftHours * 60;
    if (calculatedTotalFaults / shiftMinutes > BUSINESS_VALIDATION_THRESHOLDS.HIGH_DOWNTIME_RATIO_THRESHOLD) {
      results.push(buildResult('HIGH_DOWNTIME', ctx, language));
    }
  }

  return results;
}

/** Builds the INVALID_SHIFT BLOCKING message via the same central registry, for consistent wording everywhere. */
export function buildInvalidShiftMessage(shiftRaw: any, language: 'ar' | 'en' = 'ar'): string {
  return buildResult('INVALID_SHIFT', { shiftRaw }, language).message;
}

/**
 * Chinese Mills Historical Import only (§20). Only evaluated when BOTH
 * numberOfBags and weightClassKg are present and positive - a missing
 * Weight Class must never fabricate a mismatch warning out of nothing.
 */
export function evaluateBagWeightConsistency(
  productionQuantityTons: number,
  numberOfBags: number,
  weightClassKg: number,
  language: 'ar' | 'en' = 'ar'
): { expectedTons: number; result: ValidationResult | null } {
  const expectedTons = Number(((numberOfBags * weightClassKg) / 1000).toFixed(3));
  if (!(productionQuantityTons > 0) || !(numberOfBags > 0) || !(weightClassKg > 0)) {
    return { expectedTons, result: null };
  }
  const diffRatio = Math.abs(expectedTons - productionQuantityTons) / productionQuantityTons;
  if (diffRatio > BUSINESS_VALIDATION_THRESHOLDS.BAG_WEIGHT_MISMATCH_RATIO_THRESHOLD) {
    return { expectedTons, result: buildResult('BAG_WEIGHT_MISMATCH', { productionQuantityTons, numberOfBags, weightClassKg, expectedTons }, language) };
  }
  return { expectedTons, result: null };
}

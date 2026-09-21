/**
 * Shared Production Validation Engine (Part 9 §24-26).
 *
 * A thin, stage-aware wrapper around the EXISTING
 * `evaluateProductionWarnings()`/`buildInvalidShiftMessage()`
 * (businessValidationRules.ts) - not a second validation engine. Each
 * stage's entry form calls `evaluateStageWarnings()` with its OWN field
 * values; this maps them onto the shared engine's generic
 * `ProductionWarningContext` via that stage's `warningContext` config
 * (productionStageConfig.ts), so the exact same WASTE_GREATER_THAN_
 * PRODUCTION / HIGH_WASTE_PERCENTAGE / HIGH_DOWNTIME rules apply
 * consistently everywhere they're genuinely meaningful, and are silently
 * skipped (not fabricated) where a stage has no waste/downtime/shift-hours
 * concept in its real schema.
 */
import { ProductionStageType } from '../types';
import { getStageConfig } from '../services/productionStageConfig';
import { evaluateProductionWarnings, ValidationResult } from './businessValidationRules';

export interface StageWarningInput {
  production: number;
  waste?: number;
  downtimeMinutes?: number;
  shiftHours?: number;
}

/** Evaluates the shared WARNING-tier rules for one stage's record, using that stage's own field semantics via productionStageConfig.ts - never a Pressing-only rule applied blindly elsewhere. */
export function evaluateStageWarnings(
  stage: ProductionStageType,
  input: StageWarningInput,
  language: 'ar' | 'en'
): ValidationResult[] {
  const config = getStageConfig(stage);
  return evaluateProductionWarnings(
    {
      productionQuantity: input.production || 0,
      wasteQuantity: input.waste || 0,
      calculatedTotalFaults: input.downtimeMinutes,
      shiftHours: config.warningContext.hasShiftHours ? input.shiftHours : undefined,
    },
    language
  );
}

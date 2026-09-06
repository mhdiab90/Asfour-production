/**
 * Phase 4F - pure, Firebase-free per-stage duplicate-identity/fingerprint
 * helpers for the Generic Historical Import path (historicalImportService.ts's
 * validateImportRows()/executeBatchImport(), used for every stage except
 * pressing/chinese_mills/tube_ball_mills, each of which already has its
 * own dedicated import service).
 *
 * The Phase 3/4F audit found ZERO duplicate detection anywhere in this
 * path. Unlike Pressing (which already had an established composite key
 * to extract), no business identity existed here to reuse - so this is
 * built ENTIRELY from fields productionStageConfig.ts's own
 * `importFields` already declares as required/identity-shaped for each
 * stage (never invented): the stage's primary "what was produced" field
 * plus any batch/order-number-like field that stage's config declares.
 * Every field referenced below is copied verbatim from
 * PRODUCTION_STAGE_CONFIGS (productionStageConfig.ts) - not guessed.
 *
 * Stages intentionally NOT covered here (`hasSafeDuplicateIdentity`
 * returns false): `pressing`, `chinese_mills`, `tube_ball_mills` - each
 * has its own dedicated, independently-hardened duplicate-detection
 * system; folding them into this generic table would risk two competing
 * definitions of the same stage's identity.
 */
import { ProductionStageType } from '../types';

export interface GenericStageIdentityConfig {
  /** Tried in order, first non-empty value wins (mirrors Pressing's own code-then-name fallback convention). All are fields declared in that stage's own importFields (productionStageConfig.ts). */
  productLikeFields: string[];
  /** Optional batch/order-number-like fields for that stage, appended to the key when present - narrows false-positive matches without ever being required (never invents a value when absent). */
  disambiguatorFields: string[];
}

/**
 * One entry per stage the Generic Historical Import path actually serves.
 * Every field name here is taken directly from that stage's
 * `importFields` array in productionStageConfig.ts.
 */
export const GENERIC_STAGE_DUPLICATE_IDENTITY: Partial<Record<ProductionStageType, GenericStageIdentityConfig>> = {
  rotary_furnace: {
    productLikeFields: ['productCode'],
    disambiguatorFields: ['batchNumber'],
  },
  mortar_concrete: {
    productLikeFields: ['productCode'],
    disambiguatorFields: ['batchNumber', 'manufacturingOrderNumber'],
  },
  mixing: {
    productLikeFields: ['mixProductCode', 'mixProductName'],
    disambiguatorFields: ['batchNumber'],
  },
  lightweight_foam: {
    productLikeFields: ['productCode', 'productName'],
    disambiguatorFields: ['batchNumber'],
  },
  sorting: {
    productLikeFields: ['productCode'],
    disambiguatorFields: ['customerOrderNumber'],
  },
};

export function hasSafeDuplicateIdentity(stage: ProductionStageType): boolean {
  return stage in GENERIC_STAGE_DUPLICATE_IDENTITY;
}

/**
 * `readField(key)` reads a single import field's already-extracted string
 * value (the caller supplies this - historicalImportService.ts already
 * has readImportFieldValue() for this exact purpose, reused rather than
 * duplicated). Returns `null` when the stage has no safe identity
 * configured (NO SAFE DUPLICATE IDENTITY - DEFERRED; the caller must skip
 * duplicate detection entirely for that stage rather than guess).
 */
export function buildGenericStageDuplicateKey(
  stage: ProductionStageType,
  normalizedDate: string,
  readField: (key: string) => string
): string | null {
  const config = GENERIC_STAGE_DUPLICATE_IDENTITY[stage];
  if (!config) return null;

  const productPart = config.productLikeFields.map(readField).find((v) => v && v.trim() !== '') || '';
  const disambiguatorParts = config.disambiguatorFields.map((f) => (readField(f) || '').trim());

  return [normalizedDate, productPart.trim(), ...disambiguatorParts].join('#').toLowerCase();
}

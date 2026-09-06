/**
 * ASFOUR ERP - Multi-Code Parser Utility for Composite Master Data Values
 *
 * Accurately parses composite Excel cells into independent, normalized tokens
 * for fields configured as MULTI_ENTITY_FIELD (e.g. Furnace Cars).
 *
 * Strict Rules:
 * - Hyphen splitting is ONLY active for explicitly configured multi-code fields.
 * - Single-entity fields (e.g. Product Codes like BAR-250-102-305) are NEVER split by hyphens.
 * - Deduplicates tokens while preserving original raw string for full auditability.
 * - Trims whitespace around all tokens and filters out empty strings.
 *
 * IMPORTANT - Furnace Cars business-rule change: the flat MULTI_ENTITY_FIELD
 * split below (treating every '-' and '/' as an equal-priority separator) is
 * NO LONGER used for Furnace Cars. The field now carries a structured
 * "CAR-BRICKS/CAR-BRICKS" pair format - use parseFurnaceCarBrickPairs() at
 * the bottom of this file instead. The `furnaceCars`/`furnaceCar` entries in
 * MULTI_CODE_FIELD_CONFIGS below are kept only for backward-compatible type
 * shape / any generic caller that still wants the old flat-token behavior;
 * no ASFOUR furnace-car code path should call parseMultiCodeValue(x,
 * 'furnaceCars') anymore.
 */
import { FurnaceCarBrickPair } from '../types';
import { toWesternDigits } from './formatters';

export type MultiEntityFieldType = 'MULTI_ENTITY_FIELD' | 'SINGLE_ENTITY_FIELD';

export interface MultiCodeFieldConfig {
  fieldKey: string;
  fieldNameAr: string;
  fieldNameEn: string;
  type: MultiEntityFieldType;
  entityType: 'FURNACE_CAR' | 'EMPLOYEE' | 'PRESS' | 'PRODUCT' | 'MATERIAL' | 'CUSTOMER' | 'SHIFT' | string;
  allowHyphenSplit: boolean;
  separators?: RegExp;
}

/**
 * Registry of multi-code configurations per field key
 */
export const MULTI_CODE_FIELD_CONFIGS: Record<string, MultiCodeFieldConfig> = {
  furnaceCars: {
    fieldKey: 'furnaceCars',
    fieldNameAr: 'عربات الأفران',
    fieldNameEn: 'Furnace Cars',
    type: 'MULTI_ENTITY_FIELD',
    entityType: 'FURNACE_CAR',
    allowHyphenSplit: true,
    separators: /[-*/,،|;\s\n\r]+/,
  },
  furnaceCar: {
    fieldKey: 'furnaceCar',
    fieldNameAr: 'عربة الفرن',
    fieldNameEn: 'Furnace Car',
    type: 'MULTI_ENTITY_FIELD',
    entityType: 'FURNACE_CAR',
    allowHyphenSplit: true,
    separators: /[-*/,،|;\s\n\r]+/,
  },
  employees: {
    fieldKey: 'employees',
    fieldNameAr: 'الموظفون',
    fieldNameEn: 'Employees',
    type: 'MULTI_ENTITY_FIELD',
    entityType: 'EMPLOYEE',
    allowHyphenSplit: false, // Default preserve hyphens in employee codes unless configured
    separators: /[*/,،|;\s\n\r]+/,
  },
  product: {
    fieldKey: 'product',
    fieldNameAr: 'كود الصنف',
    fieldNameEn: 'Product Code',
    type: 'SINGLE_ENTITY_FIELD',
    entityType: 'PRODUCT',
    allowHyphenSplit: false, // Protected: never split BAR-250-102-305
  },
  press: {
    fieldKey: 'press',
    fieldNameAr: 'المكبس',
    fieldNameEn: 'Press Machine',
    type: 'SINGLE_ENTITY_FIELD',
    entityType: 'PRESS',
    allowHyphenSplit: false, // Protected: never split P-01
  },
};

export interface MultiCodeParseResult {
  originalValue: string;
  tokens: string[];
  tokenCount: number;
  isMulti: boolean;
  config: MultiCodeFieldConfig;
}

/**
 * Parse an imported string value according to field configuration.
 * If the field is not a MULTI_ENTITY_FIELD, returns the single trimmed value.
 */
export function parseMultiCodeValue(
  rawValue: any,
  fieldKey: string = 'furnaceCars',
  customConfig?: Partial<MultiCodeFieldConfig>
): MultiCodeParseResult {
  const originalStr = rawValue !== undefined && rawValue !== null ? String(rawValue).trim() : '';

  const baseConfig = MULTI_CODE_FIELD_CONFIGS[fieldKey] || {
    fieldKey,
    fieldNameAr: fieldKey,
    fieldNameEn: fieldKey,
    type: 'SINGLE_ENTITY_FIELD' as MultiEntityFieldType,
    entityType: fieldKey.toUpperCase(),
    allowHyphenSplit: false,
  };

  const config: MultiCodeFieldConfig = {
    ...baseConfig,
    ...customConfig,
  };

  if (!originalStr) {
    return {
      originalValue: '',
      tokens: [],
      tokenCount: 0,
      isMulti: false,
      config,
    };
  }

  // If SINGLE_ENTITY_FIELD, return as single item without splitting
  if (config.type !== 'MULTI_ENTITY_FIELD') {
    return {
      originalValue: originalStr,
      tokens: [originalStr],
      tokenCount: 1,
      isMulti: false,
      config,
    };
  }

  // Choose separator regex based on allowHyphenSplit
  let sepRegex = config.separators;
  if (!sepRegex) {
    sepRegex = config.allowHyphenSplit
      ? /[-*/,،|;\s\n\r]+/
      : /[*/,،|;\s\n\r]+/;
  }

  // Split string and normalize
  const rawParts = originalStr.split(sepRegex);
  const seenSet = new Set<string>();
  const tokens: string[] = [];

  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // Check for uniqueness (case-insensitive for code matching, preserved casing)
    const normKey = trimmed.toLowerCase();
    if (!seenSet.has(normKey)) {
      seenSet.add(normKey);
      tokens.push(trimmed);
    }
  }

  return {
    originalValue: originalStr,
    tokens,
    tokenCount: tokens.length,
    isMulti: tokens.length > 1,
    config,
  };
}

/**
 * Format structured tokens back to human-readable chips description
 */
export function formatTokensAuditSummary(
  originalValue: string,
  tokens: string[],
  language: 'ar' | 'en' = 'ar'
): string {
  if (tokens.length <= 1) return originalValue;
  if (language === 'ar') {
    return `تم تقسيم البيان "${originalValue}" إلى ${tokens.length} عناصر منفصلة: [${tokens.join(', ')}]`;
  }
  return `The imported value "${originalValue}" was parsed into ${tokens.length} separate items: [${tokens.join(', ')}]`;
}

/**
 * Furnace Car + Brick Count structured pair parser.
 *
 * NEW business format: "CAR-BRICKS/CAR-BRICKS/CAR-BRICKS..."
 *   '/' = next furnace car record
 *   '-' = separates the car number from its brick count within ONE record
 *
 * Example: "278-453/254-880/284-1332/601-52" ->
 *   [{ carNumber: '278', brickCount: 453 }, { carNumber: '254', brickCount: 880 },
 *    { carNumber: '284', brickCount: 1332 }, { carNumber: '601', brickCount: 52 }]
 *
 * This deliberately does NOT reuse the flat MULTI_ENTITY_FIELD splitter above -
 * that treats every '-' as an equal-priority separator, which would (wrongly,
 * under the new rule) shred "278-453" into two independent furnace cars.
 * Only the car NUMBER is ever a Master Data identity; brickCount is always
 * transactional/import data and is never matched against or created as
 * Furnace Car master data.
 */
export function parseFurnaceCarBrickPairs(rawValue: any): FurnaceCarBrickPair[] {
  const str = rawValue !== undefined && rawValue !== null ? String(rawValue).trim() : '';
  if (!str) return [];

  const segments = str.split('/').map(s => s.trim()).filter(s => s.length > 0);
  return segments.map((segment) => parseSingleCarBrickPair(segment));
}

function parseSingleCarBrickPair(segment: string): FurnaceCarBrickPair {
  const trimmedSeg = segment.trim();
  const hyphenIdx = trimmedSeg.indexOf('-');

  // No hyphen at all: a bare car number with the brick count missing entirely.
  if (hyphenIdx === -1) {
    const carNumber = toWesternDigits(trimmedSeg).trim();
    return {
      raw: segment,
      carNumber,
      brickCountRaw: '',
      brickCount: null,
      isValid: false,
      errorReason: carNumber ? 'MISSING_BRICK_COUNT' : 'MALFORMED',
    };
  }

  const carNumber = toWesternDigits(trimmedSeg.slice(0, hyphenIdx).trim()).trim();
  // Only the FIRST hyphen separates car from bricks - a value like "278-453-20"
  // therefore lands the extra "-20" inside brickCountRaw, which then fails the
  // integer check below and is correctly rejected as malformed rather than
  // silently guessing which side it belongs to.
  const brickCountRaw = toWesternDigits(trimmedSeg.slice(hyphenIdx + 1).trim()).trim();

  if (!carNumber) {
    return { raw: segment, carNumber: '', brickCountRaw, brickCount: null, isValid: false, errorReason: 'MISSING_CAR_NUMBER' };
  }
  if (!brickCountRaw) {
    return { raw: segment, carNumber, brickCountRaw: '', brickCount: null, isValid: false, errorReason: 'MISSING_BRICK_COUNT' };
  }
  if (!/^\d+$/.test(brickCountRaw)) {
    return { raw: segment, carNumber, brickCountRaw, brickCount: null, isValid: false, errorReason: 'INVALID_BRICK_COUNT' };
  }

  return { raw: segment, carNumber, brickCountRaw, brickCount: parseInt(brickCountRaw, 10), isValid: true };
}

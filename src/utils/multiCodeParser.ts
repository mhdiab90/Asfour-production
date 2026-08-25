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
 */

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

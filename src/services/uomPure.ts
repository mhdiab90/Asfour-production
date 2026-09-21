/**
 * Units of measure - Phase 1 Step 8. Pure and Firebase-free.
 *
 * The ONE place that says what each approved unit IS. It does not add units:
 * the approved values stay bomPure.BOM_UNITS (the values materials, BOM lines,
 * consumption lines and production outputs already store), with their labels
 * (BOM_UNIT_LABELS) and legacy spellings (UNIT_SPELLING_ALIASES). This file adds
 * a stable code, a category and the conversion facts - and converts nothing.
 *
 * FIVE SEPARATE QUESTIONS.
 *   identity      the stored unit value (e.g. "كجم"), code KG
 *   label         Arabic / English display text
 *   compatibility exact match, or which conversion would be needed
 *   conversion    PHYSICAL (a fact of nature: 1 طن = 1000 كجم) is NOT permission.
 *                 A conversion is BUSINESS-ALLOWED only in a named context where
 *                 the business configured it or existing code already applies it
 *   data quality  missing, unknown, or a legacy spelling
 *
 * NOTHING IS INVENTED. The only physical relation represented is طن <-> كجم.
 * A bag (شكارة), a piece (قطعة), a litre (لتر) or a cubic metre (م3) has no
 * factor to mass here: those are CONVERSION_NOT_CONFIGURED until the business
 * configures one explicitly. Quantity variance (Step 7) stays exact-unit.
 */
import { BOM_UNITS, BOM_UNIT_LABELS, UNIT_SPELLING_ALIASES } from './bomPure';

export const UOM_CATEGORIES = ['MASS', 'VOLUME', 'COUNT', 'PACKAGE', 'AREA', 'LENGTH'] as const;
export type UomCategory = (typeof UOM_CATEGORIES)[number];

export interface UomDefinition {
  /** Stable key, independent of the Arabic display value. */
  code: 'TON' | 'KG' | 'M3' | 'LITER' | 'BAG' | 'PIECE' | 'M2' | 'METER';
  /** The stored value - one of bomPure.BOM_UNITS. */
  value: string;
  labelAr: string;
  labelEn: string;
  category: UomCategory;
  /**
   * A MASS or VOLUME quantity - the only kinds this system knows a physical
   * relation for (PHYSICAL_UOM_RELATIONS). A count, a package, an area or a
   * length is not: no factor exists for them and none is invented.
   */
  measurable: boolean;
}

const CATEGORY_BY_VALUE: Readonly<Record<string, { code: UomDefinition['code']; category: UomCategory }>> = {
  'طن': { code: 'TON', category: 'MASS' },
  'كجم': { code: 'KG', category: 'MASS' },
  'م3': { code: 'M3', category: 'VOLUME' },
  'لتر': { code: 'LITER', category: 'VOLUME' },
  'شكارة': { code: 'BAG', category: 'PACKAGE' },
  'قطعة': { code: 'PIECE', category: 'COUNT' },
  // Approved for the master data package. Their own categories, with no
  // relation to mass or volume - so any cross-category use reports
  // CONVERSION_NOT_CONFIGURED instead of silently converting.
  'm²': { code: 'M2', category: 'AREA' },
  'متر': { code: 'METER', category: 'LENGTH' },
};

/** One definition per approved unit, in the BOM_UNITS order - never a second official unit. */
export const UOM_DEFINITIONS: readonly UomDefinition[] = BOM_UNITS.map((value) => {
  const meta = CATEGORY_BY_VALUE[value];
  return {
    code: meta.code,
    value,
    labelAr: BOM_UNIT_LABELS[value].ar,
    labelEn: BOM_UNIT_LABELS[value].en,
    category: meta.category,
    measurable: meta.category === 'MASS' || meta.category === 'VOLUME',
  };
});

/**
 * Physical relations known as metadata - facts, not permission. One entry per
 * pair; the reverse direction is the reciprocal. Deliberately only طن <-> كجم.
 */
export const PHYSICAL_UOM_RELATIONS: ReadonlyArray<{ from: string; to: string; factor: number }> = [{ from: 'طن', to: 'كجم', factor: 1000 }];

/** Contexts in which a conversion may be permitted. */
export type UomConversionContext = 'QUANTITY_VARIANCE' | 'BOM_BASIS_CONSISTENCY' | 'PRODUCTION_WEIGHT_REPORTING' | 'IMPORT' | 'COSTING';

/** A business-approved conversion: explicit context, units and factor. */
export interface BusinessUomConversion {
  context: UomConversionContext;
  from: string;
  to: string;
  /** quantity in `to` = quantity in `from` x factor. */
  factor: number;
  /** Where the permission comes from (configuration record, code path...). */
  source: string;
}

/**
 * Conversions the EXISTING code already applies, recorded so they are visible.
 * Production weight reporting (utils/productionCalculations.ts, the universal
 * stage-record read) turns كجم into طن. Its piece -> كجم step uses each
 * product's / record's own piece weight - a per-record value, so it is not a
 * constant factor and is not listed. Nothing in quantity variance, BOM
 * consistency, import or costing is permitted.
 */
export const EXISTING_BUSINESS_UOM_CONVERSIONS: readonly BusinessUomConversion[] = [
  { context: 'PRODUCTION_WEIGHT_REPORTING', from: 'كجم', to: 'طن', factor: 1 / 1000, source: 'utils/productionCalculations.ts' },
  { context: 'PRODUCTION_WEIGHT_REPORTING', from: 'طن', to: 'كجم', factor: 1000, source: 'utils/productionCalculations.ts' },
];

export type UomNormalizationStatus = 'APPROVED' | 'LEGACY_ALIAS' | 'MISSING' | 'UNKNOWN';

export interface UomNormalization {
  /** The value as found (trimmed); null when absent. Never rewritten at the source. */
  original: string | null;
  /** The approved value it stands for; null when missing or unknown. */
  normalized: string | null;
  status: UomNormalizationStatus;
  definition: UomDefinition | null;
}

export function getUomDefinition(value: unknown): UomDefinition | null {
  return typeof value === 'string' ? UOM_DEFINITIONS.find((d) => d.value === value.trim()) ?? null : null;
}

/**
 * What a stored unit value means. An explicit function for validation, import
 * and readiness - it never writes, so historical values stay as they are.
 */
export function normaliseUom(value: unknown): UomNormalization {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return { original: null, normalized: null, status: 'MISSING', definition: null };
  }
  const original = typeof value === 'string' ? value.trim() : String(value);
  const approved = typeof value === 'string' ? getUomDefinition(original) : null;
  if (approved) return { original, normalized: approved.value, status: 'APPROVED', definition: approved };
  const alias = UNIT_SPELLING_ALIASES[original];
  if (alias) return { original, normalized: alias, status: 'LEGACY_ALIAS', definition: getUomDefinition(alias) };
  return { original, normalized: null, status: 'UNKNOWN', definition: null };
}

export type UomCompatibilityStatus =
  | 'EXACT_MATCH'
  | 'BUSINESS_CONVERSION_ALLOWED'
  | 'PHYSICALLY_CONVERTIBLE'
  | 'CONVERSION_NOT_CONFIGURED'
  | 'UNKNOWN_UOM'
  | 'MISSING_UOM';

export interface UomCompatibility {
  status: UomCompatibilityStatus;
  from: UomNormalization;
  to: UomNormalization;
  sameCategory: boolean | null;
  /** A known physical factor (information only). */
  physicalFactor: number | null;
  /** The factor to use - set ONLY when a business conversion is allowed in this context. */
  businessFactor: number | null;
}

function physicalFactor(from: string, to: string): number | null {
  const direct = PHYSICAL_UOM_RELATIONS.find((r) => r.from === from && r.to === to);
  if (direct) return direct.factor;
  const reverse = PHYSICAL_UOM_RELATIONS.find((r) => r.from === to && r.to === from);
  return reverse ? 1 / reverse.factor : null;
}

/** A configured conversion is usable only if its units are approved and its factor is a positive number. */
export function isValidBusinessUomConversion(c: BusinessUomConversion): boolean {
  return getUomDefinition(c.from) !== null && getUomDefinition(c.to) !== null && c.from !== c.to && typeof c.factor === 'number' && Number.isFinite(c.factor) && c.factor > 0;
}

/**
 * Whether a quantity in `from` can be used where `to` is expected, in a
 * context. Exact match needs nothing; otherwise only an explicit business
 * conversion for that context is allowed. A physical relation alone is
 * reported, never applied.
 */
export function uomCompatibility(
  from: unknown,
  to: unknown,
  context: UomConversionContext,
  configured: readonly BusinessUomConversion[] = [],
): UomCompatibility {
  const f = normaliseUom(from);
  const t = normaliseUom(to);
  const base = { from: f, to: t, sameCategory: null, physicalFactor: null, businessFactor: null };
  if (f.status === 'MISSING' || t.status === 'MISSING') return { ...base, status: 'MISSING_UOM' };
  if (f.status === 'UNKNOWN' || t.status === 'UNKNOWN') return { ...base, status: 'UNKNOWN_UOM' };
  const fv = f.normalized as string;
  const tv = t.normalized as string;
  const sameCategory = f.definition!.category === t.definition!.category;
  if (fv === tv) return { ...base, sameCategory, status: 'EXACT_MATCH' };
  const phys = physicalFactor(fv, tv);
  const business = [...EXISTING_BUSINESS_UOM_CONVERSIONS, ...configured].find(
    (c) => c.context === context && c.from === fv && c.to === tv && isValidBusinessUomConversion(c),
  );
  if (business) return { ...base, sameCategory, physicalFactor: phys, businessFactor: business.factor, status: 'BUSINESS_CONVERSION_ALLOWED' };
  if (phys !== null) return { ...base, sameCategory, physicalFactor: phys, status: 'PHYSICALLY_CONVERTIBLE' };
  return { ...base, sameCategory, status: 'CONVERSION_NOT_CONFIGURED' };
}

export type UomSeverity = 'INFO' | 'WARNING' | 'BLOCKING';

/**
 * How an IMPORTED unit value is treated: approved values pass, a known legacy
 * spelling passes as its approved value with a warning, anything else blocks
 * the row until a user reviews it.
 */
export function classifyImportedUom(value: unknown): { accepted: boolean; normalized: string | null; severity: UomSeverity; status: UomNormalizationStatus } {
  const n = normaliseUom(value);
  if (n.status === 'APPROVED') return { accepted: true, normalized: n.normalized, severity: 'INFO', status: n.status };
  if (n.status === 'LEGACY_ALIAS') return { accepted: true, normalized: n.normalized, severity: 'WARNING', status: n.status };
  return { accepted: false, normalized: null, severity: 'BLOCKING', status: n.status };
}

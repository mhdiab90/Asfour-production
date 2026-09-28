/**
 * BOM costing view - the value, alumina and imported share of a BOM version (3.24.0).
 *
 * A BOM version can be read two ways: QUANTITIES (what it was) or COST - every
 * component valued at a material price the user chooses:
 *   LAST_PURCHASE   the last purchase price       (costing design: PRICING_REFERENCE_PRICE)
 *   AVERAGE_ISSUE   the average price of the stores' issues to manufacturing
 *                   (costing design: ACTUAL_ISSUE_COST)
 * Both are held on the material record, entered through the component
 * attributes screen - the costing design's MANUAL_APPROVED_INPUT source - and
 * neither overwrites the other (costingSetupPure.ts, "MATERIAL COST HAS TWO
 * PURPOSES"). Nothing here invents a price: a component without one is shown
 * without a value and counted, never valued at zero.
 *
 * VALUE OF A LINE = its quantity for the version's basis x the chosen price.
 * The price is per the material's price unit. A line in another unit is valued
 * only through an approved COSTING conversion (uomPure.uomCompatibility); the
 * only one approved here is the mass pair طن <-> كجم (1 طن = 1000 كجم), a
 * physical identity, recorded as COSTING_UOM_CONVERSIONS. Any other pair
 * (a bag against a ton, a piece against a kilogram) is reported, never guessed.
 *
 * ALUMINA OF THE MIX = the average of the components' alumina %, each weighted
 * by its effective percentage of the basis (additives included - they are part
 * of the mix). A component without an alumina % makes the total "incomplete"
 * and is left out of the average rather than counted as zero.
 *
 * IMPORTED SHARE = the value of the IMPORTED components / the total value.
 *
 * Pure: it computes from records already loaded. It reads and writes nothing.
 */
import { bomFormula, bomVersionPayloadForSave } from './bomPure';
import { BusinessUomConversion, uomCompatibility } from './uomPure';

export const MATERIAL_ORIGINS = ['LOCAL', 'IMPORTED'] as const;
export type MaterialOrigin = (typeof MATERIAL_ORIGINS)[number];
export const MATERIAL_ORIGIN_LABELS: Record<MaterialOrigin, { ar: string; en: string }> = {
  LOCAL: { ar: 'محلي', en: 'Local' },
  IMPORTED: { ar: 'مستورد', en: 'Imported' },
};

export const PRICE_BASES = ['LAST_PURCHASE', 'AVERAGE_ISSUE'] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];
/** Where each price basis lives on a material record. */
export const PRICE_BASIS_FIELD: Record<PriceBasis, 'lastPurchasePrice' | 'averageIssuePrice'> = {
  LAST_PURCHASE: 'lastPurchasePrice',
  AVERAGE_ISSUE: 'averageIssuePrice',
};
export const PRICE_BASIS_LABELS: Record<PriceBasis, { ar: string; en: string }> = {
  LAST_PURCHASE: { ar: 'آخر سعر شراء', en: 'Last purchase price' },
  AVERAGE_ISSUE: { ar: 'متوسط سعر المنصرف', en: 'Average issue price' },
};

export type BomView = 'QUANTITIES' | 'COST';

/**
 * The one conversion approved for COSTING: mass, طن <-> كجم. A physical
 * identity, applied only to value a line whose unit differs from the price unit.
 */
export const COSTING_UOM_CONVERSIONS: readonly BusinessUomConversion[] = [
  { context: 'COSTING', from: 'كجم', to: 'طن', factor: 1 / 1000, source: 'bomCostingPure.ts - BOM costing view (3.24.0)' },
  { context: 'COSTING', from: 'طن', to: 'كجم', factor: 1000, source: 'bomCostingPure.ts - BOM costing view (3.24.0)' },
];

/** What a component contributes, as read from its product or material record. */
export interface ComponentAttributes {
  code: string;
  name: string;
  aluminaPercentage: number | null;
  origin: MaterialOrigin | null;
  lastPurchasePrice: number | null;
  averageIssuePrice: number | null;
  /** The unit the prices are per - the price unit, else the material's own unit. */
  priceUnit: string | null;
  found: boolean;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export function readOrigin(value: unknown): MaterialOrigin | null {
  const v = txt(value).toUpperCase();
  return (MATERIAL_ORIGINS as readonly string[]).includes(v) ? (v as MaterialOrigin) : null;
}

/**
 * A component's attributes from its record.
 *
 * A PRODUCT used as a component is made in-house, so it counts as LOCAL; its
 * alumina is the product's own aluminaPercentage. Products carry no purchase or
 * issue price, so a product component is shown without a value.
 */
export function componentAttributes(source: string, record: Record<string, any> | null | undefined): ComponentAttributes {
  if (!record) {
    return { code: '', name: '', aluminaPercentage: null, origin: null, lastPurchasePrice: null, averageIssuePrice: null, priceUnit: null, found: false };
  }
  const isProduct = source === 'products';
  const alumina = num(record.aluminaPercentage);
  return {
    code: txt(record.code || record.productCode),
    name: txt(record.name),
    aluminaPercentage: alumina !== null && alumina >= 0 && alumina <= 100 ? alumina : null,
    origin: isProduct ? (readOrigin(record.origin) ?? 'LOCAL') : readOrigin(record.origin),
    lastPurchasePrice: isProduct ? null : num(record.lastPurchasePrice),
    averageIssuePrice: isProduct ? null : num(record.averageIssuePrice),
    priceUnit: txt(record.priceUnit) || txt(record.unit) || null,
    found: true,
  };
}

/** Why a line has no value. */
export type ValueReason = 'NO_QUANTITY' | 'NO_PRICE' | 'NO_UNIT' | 'UNIT_MISMATCH' | null;

/**
 * A line's value: its quantity, in the price unit, times the price.
 * The quantity is converted only through an approved COSTING conversion.
 */
export function lineValue(quantity: number | null, lineUnit: string | null | undefined, price: number | null, priceUnit: string | null | undefined): { value: number | null; reason: ValueReason; factor: number | null } {
  if (quantity === null || !(quantity > 0)) return { value: null, reason: 'NO_QUANTITY', factor: null };
  if (price === null || price < 0) return { value: null, reason: 'NO_PRICE', factor: null };
  // Without a unit on both sides there is no way to know the price fits the quantity - never assumed.
  if (!txt(lineUnit) || !txt(priceUnit)) return { value: null, reason: 'NO_UNIT', factor: null };
  const c = uomCompatibility(lineUnit, priceUnit, 'COSTING', COSTING_UOM_CONVERSIONS);
  if (c.status === 'EXACT_MATCH') return { value: quantity * price, reason: null, factor: 1 };
  if (c.status === 'BUSINESS_CONVERSION_ALLOWED' && c.businessFactor !== null) {
    return { value: quantity * c.businessFactor * price, reason: null, factor: c.businessFactor };
  }
  return { value: null, reason: 'UNIT_MISMATCH', factor: null };
}

export interface CostedLine {
  lineId: string;
  sequence: number;
  itemSource: string;
  itemId: string;
  attributes: ComponentAttributes;
  /** The line's quantity for the basis (stored, or derived from its percentage). */
  quantity: number | null;
  unit: string;
  /** The line's effective percentage of the basis, when known. */
  percentage: number | null;
  price: number | null;
  value: number | null;
  valueReason: ValueReason;
}

export interface BomCosting {
  lines: CostedLine[];
  priceBasis: PriceBasis;
  /** The sum of the valued lines. */
  totalCost: number;
  /** Every line has a value. */
  costComplete: boolean;
  unvaluedLines: number;
  importedValue: number;
  /** importedValue / totalCost x 100; null when nothing is valued. */
  importedShare: number | null;
  /** Lines with no origin recorded - the imported share cannot be complete without them. */
  missingOrigin: number;
  /** The mix's alumina %, weighted by effective percentage; null when no line can be weighed. */
  aluminaTotal: number | null;
  aluminaComplete: boolean;
  missingAlumina: number;
}

/**
 * The costing of one version (stored or the draft on screen).
 *
 * `lookup` returns the product / material record of a component, from the lists
 * the window already holds.
 */
export function bomCosting(
  version: Record<string, unknown>,
  lookup: (source: string, id: string) => Record<string, any> | null | undefined,
  priceBasis: PriceBasis,
): BomCosting {
  const normalised = bomVersionPayloadForSave(version);
  const formula = bomFormula(normalised);
  const lines: CostedLine[] = [...normalised.components]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map((c) => {
      const fl = formula.lines.find((l) => l.lineId === c.lineId) ?? null;
      const attributes = componentAttributes(c.itemSource, lookup(c.itemSource, c.itemId));
      const price = priceBasis === 'LAST_PURCHASE' ? attributes.lastPurchasePrice : attributes.averageIssuePrice;
      const quantity = fl?.effectiveQuantity ?? null;
      // A derived quantity is in the basis unit; a stored one in the line's own unit.
      const unit = fl?.quantityDerived ? (formula.basisUnit ?? c.unit) : c.unit;
      const v = lineValue(quantity, unit, price, attributes.priceUnit);
      return {
        lineId: c.lineId,
        sequence: c.sequence ?? 0,
        itemSource: c.itemSource,
        itemId: c.itemId,
        attributes,
        quantity,
        unit,
        percentage: fl?.effectivePercentage ?? null,
        price,
        value: v.value,
        valueReason: v.reason,
      };
    });

  const valued = lines.filter((l) => l.value !== null);
  const totalCost = valued.reduce((s, l) => s + (l.value as number), 0);
  const importedValue = valued.filter((l) => l.attributes.origin === 'IMPORTED').reduce((s, l) => s + (l.value as number), 0);

  const weighable = lines.filter((l) => l.percentage !== null && l.percentage > 0 && l.attributes.aluminaPercentage !== null);
  const weight = weighable.reduce((s, l) => s + (l.percentage as number), 0);
  const aluminaTotal = weight > 0
    ? weighable.reduce((s, l) => s + (l.percentage as number) * (l.attributes.aluminaPercentage as number), 0) / weight
    : null;
  const missingAlumina = lines.filter((l) => l.attributes.aluminaPercentage === null).length;

  return {
    lines,
    priceBasis,
    totalCost,
    costComplete: lines.length > 0 && valued.length === lines.length,
    unvaluedLines: lines.length - valued.length,
    importedValue,
    importedShare: totalCost > 0 ? (importedValue * 100) / totalCost : null,
    missingOrigin: lines.filter((l) => l.attributes.origin === null).length,
    aluminaTotal,
    aluminaComplete: lines.length > 0 && weighable.length === lines.length,
    missingAlumina,
  };
}

/** Money as shown in the window and on paper: two decimals, thousands separated. */
export function formatMoney(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '-';
}

/** A percentage to two decimals. */
export function formatShare(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
    : '-';
}

export function valueReasonLabel(reason: ValueReason, language: 'ar' | 'en'): string {
  switch (reason) {
    case 'NO_PRICE': return language === 'ar' ? 'لا يوجد سعر' : 'No price';
    case 'NO_QUANTITY': return language === 'ar' ? 'لا توجد كمية' : 'No quantity';
    case 'NO_UNIT': return language === 'ar' ? 'الوحدة غير محددة' : 'No unit';
    case 'UNIT_MISMATCH': return language === 'ar' ? 'وحدة السعر مختلفة' : 'Price unit differs';
    default: return '';
  }
}

// --- The component attributes screen -------------------------------------------------

/** The fields the component attributes screen maintains on a material record. */
export interface MaterialCostAttributesDraft {
  aluminaPercentage: string;
  origin: string;
  lastPurchasePrice: string;
  averageIssuePrice: string;
  priceUnit: string;
}

export function draftFromMaterial(material: Record<string, any>): MaterialCostAttributesDraft {
  const show = (v: unknown) => (num(v) === null ? '' : String(num(v)));
  return {
    aluminaPercentage: show(material.aluminaPercentage),
    origin: readOrigin(material.origin) ?? '',
    lastPurchasePrice: show(material.lastPurchasePrice),
    averageIssuePrice: show(material.averageIssuePrice),
    priceUnit: txt(material.priceUnit) || txt(material.unit),
  };
}

export interface AttributeIssue { field: keyof MaterialCostAttributesDraft; messageAr: string; messageEn: string }

/** Refuses what cannot be right: alumina outside 0-100, a negative or non-numeric price, an unknown origin or unit. */
export function validateMaterialCostAttributes(draft: MaterialCostAttributesDraft, allowedUnits: readonly string[]): AttributeIssue[] {
  const issues: AttributeIssue[] = [];
  const a = txt(draft.aluminaPercentage);
  if (a !== '' && (num(a) === null || (num(a) as number) < 0 || (num(a) as number) > 100)) {
    issues.push({ field: 'aluminaPercentage', messageAr: 'نسبة الألومينا يجب أن تكون رقمًا من 0 إلى 100.', messageEn: 'Alumina % must be a number from 0 to 100.' });
  }
  for (const field of ['lastPurchasePrice', 'averageIssuePrice'] as const) {
    const p = txt(draft[field]);
    if (p !== '' && (num(p) === null || (num(p) as number) < 0)) {
      issues.push({ field, messageAr: 'السعر يجب أن يكون رقمًا لا يقل عن صفر.', messageEn: 'A price must be a number, zero or more.' });
    }
  }
  if (txt(draft.origin) !== '' && readOrigin(draft.origin) === null) {
    issues.push({ field: 'origin', messageAr: 'اختر محلي أو مستورد.', messageEn: 'Choose Local or Imported.' });
  }
  const unit = txt(draft.priceUnit);
  if (unit !== '' && !allowedUnits.includes(unit)) {
    issues.push({ field: 'priceUnit', messageAr: 'وحدة السعر غير معتمدة.', messageEn: 'The price unit is not an approved unit.' });
  }
  return issues;
}

/**
 * The fields to write for a changed row - only the fields that changed, so a
 * save never touches anything else on the material. An emptied field is
 * written as null (cleared), never as zero.
 */
export function materialCostAttributesPatch(
  original: MaterialCostAttributesDraft,
  draft: MaterialCostAttributesDraft,
  now: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const numeric = (v: string) => (txt(v) === '' ? null : num(v));
  if (txt(draft.aluminaPercentage) !== txt(original.aluminaPercentage)) patch.aluminaPercentage = numeric(draft.aluminaPercentage);
  if (txt(draft.origin) !== txt(original.origin)) patch.origin = readOrigin(draft.origin);
  let pricesChanged = false;
  for (const field of ['lastPurchasePrice', 'averageIssuePrice'] as const) {
    if (txt(draft[field]) !== txt(original[field])) {
      patch[field] = numeric(draft[field]);
      pricesChanged = true;
    }
  }
  if (txt(draft.priceUnit) !== txt(original.priceUnit)) {
    patch.priceUnit = txt(draft.priceUnit) || null;
    pricesChanged = true;
  }
  if (pricesChanged) patch.pricesUpdatedAt = now;
  return patch;
}

/** Which attributes a material still lacks - what the "missing only" filter shows. */
export function missingAttributes(material: Record<string, any>): Array<'aluminaPercentage' | 'origin' | 'lastPurchasePrice' | 'averageIssuePrice'> {
  const a = componentAttributes('materials', material);
  const out: Array<'aluminaPercentage' | 'origin' | 'lastPurchasePrice' | 'averageIssuePrice'> = [];
  if (a.aluminaPercentage === null) out.push('aluminaPercentage');
  if (a.origin === null) out.push('origin');
  if (a.lastPurchasePrice === null) out.push('lastPurchasePrice');
  if (a.averageIssuePrice === null) out.push('averageIssuePrice');
  return out;
}

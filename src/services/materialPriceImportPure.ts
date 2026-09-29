/**
 * Material price import from Excel - the rules (3.25.0).
 *
 * The BOM cost view values each component at one of two prices held on the
 * material: the LAST PURCHASE price and the AVERAGE ISSUE price (the costing
 * design's PRICING_REFERENCE_PRICE and ACTUAL_ISSUE_COST). Typing them one by
 * one in the component attributes screen does not scale, so a sheet can carry
 * them: one row per material, matched by its CODE.
 *
 * WHAT A ROW DOES
 *   - it is matched to exactly one material by code (trimmed, case-insensitive);
 *     a code not found, found twice in Master Data, or repeated in the file is
 *     an error - never a guess;
 *   - a price cell that is EMPTY leaves that price as it is; a filled cell must
 *     be a number, zero or more ("12,500", "12500 ج.م" and Arabic-Indic digits
 *     are read); anything else is an error;
 *   - the price unit cell, when present, must be an approved unit (a known
 *     spelling of one is accepted); empty keeps the material's price unit;
 *   - a row that would change nothing is reported as UNCHANGED and not written.
 * Only the fields that change are written, with the date and the source
 * (EXCEL_IMPORT) - a material's code, name, unit or anything else is never
 * touched. Clearing a price is done in the attributes screen, not by import.
 *
 * 3.26.0: the same sheet may also carry the ALUMINA % (0-100; "36%" and
 * Arabic-Indic digits read) and LOCAL / IMPORTED ("محلي" / "مستورد", "local" /
 * "imported" and their short forms). Same rules: an empty cell leaves the value
 * as it is, anything unreadable is an error, only a change is written. The
 * price date and source are stamped only when a PRICE changed.
 *
 * Pure: it plans. The screen reads the file and writes the plan.
 */
import { normaliseUom } from './uomPure';
import { MaterialOrigin, readOrigin } from './bomCostingPure';

/** Where a price came from - kept beside the prices on the material. */
export const PRICE_SOURCES = ['MANUAL', 'EXCEL_IMPORT'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export type PriceColumn = 'code' | 'lastPurchasePrice' | 'averageIssuePrice' | 'priceUnit' | 'aluminaPercentage' | 'origin';
export const PRICE_COLUMNS: readonly PriceColumn[] = ['code', 'lastPurchasePrice', 'averageIssuePrice', 'priceUnit', 'aluminaPercentage', 'origin'];
/** The columns that carry data - at least one must be mapped. */
export const DATA_COLUMNS: readonly PriceColumn[] = ['lastPurchasePrice', 'averageIssuePrice', 'aluminaPercentage', 'origin'];

export const PRICE_COLUMN_LABELS: Record<PriceColumn, { ar: string; en: string }> = {
  code: { ar: 'كود الخامة', en: 'Material code' },
  lastPurchasePrice: { ar: 'آخر سعر شراء', en: 'Last purchase price' },
  averageIssuePrice: { ar: 'متوسط سعر المنصرف', en: 'Average issue price' },
  priceUnit: { ar: 'السعر لكل (وحدة)', en: 'Price per (unit)' },
  aluminaPercentage: { ar: 'نسبة الألومينا %', en: 'Alumina %' },
  origin: { ar: 'محلي / مستورد', en: 'Local / Imported' },
};

/**
 * Header spellings recognised for each column, compared after normalisation
 * (lower case, no diacritics, أ/إ/آ -> ا, ة -> ه, spaces and punctuation
 * dropped). The screen shows the detected mapping and lets the user change it.
 */
export const PRICE_HEADER_ALIASES: Record<PriceColumn, readonly string[]> = {
  code: ['كود الخامة', 'كود', 'الكود', 'كود الصنف', 'رقم الصنف', 'code', 'material code', 'item code', 'default_code', 'internal reference', 'reference'],
  lastPurchasePrice: ['آخر سعر شراء', 'اخر سعر شراء', 'آخر سعر', 'سعر الشراء', 'سعر آخر شراء', 'last purchase price', 'last price', 'purchase price', 'latest purchase price'],
  averageIssuePrice: ['متوسط سعر المنصرف', 'متوسط سعر', 'متوسط السعر', 'متوسط التكلفة', 'سعر المنصرف', 'average issue price', 'average price', 'average cost', 'avg cost', 'avg price', 'standard_price'],
  priceUnit: ['السعر لكل', 'وحدة السعر', 'الوحدة', 'price unit', 'price per', 'unit', 'uom'],
  aluminaPercentage: ['نسبة الألومينا', 'الألومينا', 'ألومينا', 'نسبة الالومنيا', 'الالومنيا', 'alumina', 'alumina percentage', 'al2o3'],
  origin: ['محلي / مستورد', 'محلي أو مستورد', 'محلي مستورد', 'المنشأ', 'منشأ الخامة', 'مستورد', 'origin', 'local / imported', 'local or imported', 'imported'],
};

/** A header as compared: case, diacritics, alef/teh-marbuta forms and separators ignored. */
export function normaliseHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\s_\-./()%]+/g, '')
    .trim();
}

/**
 * The sheet column for each field, from its headers. Exact alias matches win;
 * each sheet column is used at most once; an unrecognised field is left unset
 * for the user to choose.
 */
export function detectPriceColumns(headers: readonly string[]): Partial<Record<PriceColumn, string>> {
  const used = new Set<string>();
  const out: Partial<Record<PriceColumn, string>> = {};
  for (const field of PRICE_COLUMNS) {
    // The template's own headers are always recognised, in either language.
    const aliases = [...PRICE_HEADER_ALIASES[field], PRICE_COLUMN_LABELS[field].ar, PRICE_COLUMN_LABELS[field].en].map(normaliseHeader);
    const hit = headers.find((h) => !used.has(h) && aliases.includes(normaliseHeader(h)));
    if (hit !== undefined) {
      out[field] = hit;
      used.add(hit);
    }
  }
  return out;
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const EXTENDED_ARABIC_INDIC = '۰۱۲۳۴۵۶۷۸۹';

/**
 * A price cell as a number. Empty -> null (leave the price as it is). A number
 * stays a number; text may carry thousands separators, a currency word and
 * Arabic-Indic digits. Anything else -> NaN, which the plan reports.
 */
export function parsePriceCell(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  let text = String(value).trim();
  if (text === '') return null;
  text = text.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d))).replace(/[۰-۹]/g, (d) => String(EXTENDED_ARABIC_INDIC.indexOf(d)));
  text = text.replace(/٫/g, '.').replace(/[٬,]/g, '');
  text = text.replace(/(ج\.?\s*م\.?|جنيه|egp|le|£)/gi, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return Number.NaN;
  return Number(text);
}

export function normaliseMaterialCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

export type PriceRowStatus = 'READY' | 'UNCHANGED' | 'ERROR';
export type PriceRowError =
  | 'CODE_MISSING'
  | 'CODE_NOT_FOUND'
  | 'CODE_AMBIGUOUS'
  | 'DUPLICATE_IN_FILE'
  | 'NO_PRICE'
  | 'INVALID_LAST_PRICE'
  | 'INVALID_AVERAGE_PRICE'
  | 'INVALID_UNIT'
  | 'INVALID_ALUMINA'
  | 'INVALID_ORIGIN';

export const PRICE_ROW_ERROR_LABELS: Record<PriceRowError, { ar: string; en: string }> = {
  CODE_MISSING: { ar: 'الكود فارغ', en: 'No code' },
  CODE_NOT_FOUND: { ar: 'الكود غير موجود في الخامات', en: 'Code not found in materials' },
  CODE_AMBIGUOUS: { ar: 'الكود مسجل لأكثر من خامة', en: 'Code belongs to more than one material' },
  DUPLICATE_IN_FILE: { ar: 'الكود مكرر في الملف', en: 'Code repeated in the file' },
  NO_PRICE: { ar: 'لا توجد بيانات للاستيراد في السطر', en: 'Nothing to import in the row' },
  INVALID_LAST_PRICE: { ar: 'آخر سعر شراء غير صالح', en: 'Invalid last purchase price' },
  INVALID_AVERAGE_PRICE: { ar: 'متوسط سعر المنصرف غير صالح', en: 'Invalid average issue price' },
  INVALID_UNIT: { ar: 'وحدة السعر غير معتمدة', en: 'Price unit not approved' },
  INVALID_ALUMINA: { ar: 'نسبة الألومينا يجب أن تكون من 0 إلى 100', en: 'Alumina % must be 0 to 100' },
  INVALID_ORIGIN: { ar: 'اكتب محلي أو مستورد', en: 'Write Local or Imported' },
};

/**
 * An alumina cell: empty -> null (leave it); "36", "36%", "36.5 %", Arabic-Indic
 * digits -> the number; anything else -> NaN (reported). A value outside 0-100
 * is refused by the plan, never clipped.
 */
export function parseAluminaCell(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  const text = String(value).trim().replace(/[%٪]/g, '').trim();
  if (text === '') return null;
  return parsePriceCell(text);
}

const LOCAL_WORDS = ['محلي', 'محليه', 'local', 'l', 'loc', 'domestic'];
const IMPORTED_WORDS = ['مستورد', 'مستورده', 'استيراد', 'imported', 'import', 'i', 'imp', 'foreign'];

/**
 * A local / imported cell: empty -> null (leave it); the Arabic or English word
 * or its short form -> LOCAL / IMPORTED; anything else -> 'INVALID'.
 */
export function parseOriginCell(value: unknown): MaterialOrigin | null | 'INVALID' {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const direct = readOrigin(raw);
  if (direct) return direct;
  const key = normaliseHeader(raw);
  if (LOCAL_WORDS.map(normaliseHeader).includes(key)) return 'LOCAL';
  if (IMPORTED_WORDS.map(normaliseHeader).includes(key)) return 'IMPORTED';
  return 'INVALID';
}

export interface RowValues {
  lastPurchasePrice: number | null;
  averageIssuePrice: number | null;
  priceUnit: string | null;
  aluminaPercentage: number | null;
  origin: MaterialOrigin | null;
}

export interface PlannedPriceRow {
  /** The row number in the sheet (the header is row 1). */
  rowNumber: number;
  code: string;
  materialId: string | null;
  materialName: string;
  current: RowValues;
  next: RowValues;
  status: PriceRowStatus;
  errors: PriceRowError[];
  /** The fields to write - empty unless READY. */
  patch: Record<string, unknown>;
}

export interface PriceImportPlan {
  rows: PlannedPriceRow[];
  ready: number;
  unchanged: number;
  errors: number;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * The plan for a sheet: every row checked against Master Data and the file
 * itself, with the exact fields a READY row will write.
 */
export function planPriceImport(
  rows: ReadonlyArray<Record<string, unknown>>,
  mapping: Partial<Record<PriceColumn, string>>,
  materials: ReadonlyArray<Record<string, any>>,
  now: string,
): PriceImportPlan {
  const byCode = new Map<string, Array<Record<string, any>>>();
  for (const m of materials) {
    const key = normaliseMaterialCode(m.code);
    if (!key) continue;
    byCode.set(key, [...(byCode.get(key) ?? []), m]);
  }
  const cell = (row: Record<string, unknown>, field: PriceColumn) => (mapping[field] ? row[mapping[field] as string] : undefined);

  // A code on more than one row: every such row is refused - which price wins is the user's decision.
  const seen = new Map<string, number>();
  for (const row of rows) {
    const code = normaliseMaterialCode(cell(row, 'code'));
    if (code) seen.set(code, (seen.get(code) ?? 0) + 1);
  }

  const planned = rows.map((row, i): PlannedPriceRow => {
    const code = normaliseMaterialCode(cell(row, 'code'));
    const errors: PriceRowError[] = [];
    const matches = code ? byCode.get(code) ?? [] : [];
    if (!code) errors.push('CODE_MISSING');
    else if ((seen.get(code) ?? 0) > 1) errors.push('DUPLICATE_IN_FILE');
    else if (matches.length === 0) errors.push('CODE_NOT_FOUND');
    else if (matches.length > 1) errors.push('CODE_AMBIGUOUS');
    const material = matches.length === 1 ? matches[0] : null;

    const last = parsePriceCell(cell(row, 'lastPurchasePrice'));
    const average = parsePriceCell(cell(row, 'averageIssuePrice'));
    if (last !== null && (Number.isNaN(last) || last < 0)) errors.push('INVALID_LAST_PRICE');
    if (average !== null && (Number.isNaN(average) || average < 0)) errors.push('INVALID_AVERAGE_PRICE');
    const alumina = parseAluminaCell(cell(row, 'aluminaPercentage'));
    if (alumina !== null && (Number.isNaN(alumina) || alumina < 0 || alumina > 100)) errors.push('INVALID_ALUMINA');
    const origin = parseOriginCell(cell(row, 'origin'));
    if (origin === 'INVALID') errors.push('INVALID_ORIGIN');
    if (last === null && average === null && alumina === null && origin === null) errors.push('NO_PRICE');

    const rawUnit = String(cell(row, 'priceUnit') ?? '').trim();
    let unit: string | null = null;
    if (rawUnit) {
      const u = normaliseUom(rawUnit);
      if (u.normalized) unit = u.normalized;
      else errors.push('INVALID_UNIT');
    }

    const current = {
      lastPurchasePrice: num(material?.lastPurchasePrice),
      averageIssuePrice: num(material?.averageIssuePrice),
      priceUnit: (material?.priceUnit ? String(material.priceUnit) : null) || (material?.unit ? String(material.unit) : null),
      aluminaPercentage: num(material?.aluminaPercentage),
      origin: readOrigin(material?.origin),
    };
    const next = {
      lastPurchasePrice: last !== null && !Number.isNaN(last) ? last : current.lastPurchasePrice,
      averageIssuePrice: average !== null && !Number.isNaN(average) ? average : current.averageIssuePrice,
      priceUnit: unit ?? current.priceUnit,
      aluminaPercentage: alumina !== null && !Number.isNaN(alumina) ? alumina : current.aluminaPercentage,
      origin: origin !== null && origin !== 'INVALID' ? origin : current.origin,
    };

    const patch: Record<string, unknown> = {};
    if (errors.length === 0 && material) {
      if (next.lastPurchasePrice !== current.lastPurchasePrice) patch.lastPurchasePrice = next.lastPurchasePrice;
      if (next.averageIssuePrice !== current.averageIssuePrice) patch.averageIssuePrice = next.averageIssuePrice;
      // The unit is written only when it CHANGES the unit the prices are read in (the price unit, else the
      // material's own unit) - so re-importing an untouched template writes nothing.
      if (unit && unit !== current.priceUnit) patch.priceUnit = unit;
      // The price date and source describe the PRICES - stamped only when one of them changed.
      if (Object.keys(patch).length > 0) {
        patch.pricesUpdatedAt = now;
        patch.pricesSource = 'EXCEL_IMPORT';
      }
      if (next.aluminaPercentage !== current.aluminaPercentage) patch.aluminaPercentage = next.aluminaPercentage;
      if (next.origin !== current.origin) patch.origin = next.origin;
    }
    const status: PriceRowStatus = errors.length > 0 ? 'ERROR' : Object.keys(patch).length > 0 ? 'READY' : 'UNCHANGED';
    return {
      rowNumber: i + 2,
      code,
      materialId: material ? String(material.id) : null,
      materialName: material ? String(material.name ?? '') : '',
      current,
      next,
      status,
      errors,
      patch: status === 'READY' ? patch : {},
    };
  });

  return {
    rows: planned,
    ready: planned.filter((r) => r.status === 'READY').length,
    unchanged: planned.filter((r) => r.status === 'UNCHANGED').length,
    errors: planned.filter((r) => r.status === 'ERROR').length,
  };
}

/**
 * The template: every material with its code, name and unit and its current
 * prices, alumina % and local / imported, under the headers the import
 * recognises - fill in what is missing and import the same file back.
 */
export function priceTemplateRows(materials: ReadonlyArray<Record<string, any>>, language: 'ar' | 'en'): Array<Record<string, unknown>> {
  const h = (field: PriceColumn) => (language === 'ar' ? PRICE_COLUMN_LABELS[field].ar : PRICE_COLUMN_LABELS[field].en);
  const nameHeader = language === 'ar' ? 'اسم الخامة' : 'Material name';
  const unitHeader = language === 'ar' ? 'وحدة الخامة' : 'Material unit';
  return [...materials]
    .sort((a, b) => String(a.code ?? '').localeCompare(String(b.code ?? '')))
    .map((m) => ({
      [h('code')]: String(m.code ?? ''),
      [nameHeader]: String(m.name ?? ''),
      [unitHeader]: String(m.unit ?? ''),
      [h('lastPurchasePrice')]: num(m.lastPurchasePrice) ?? '',
      [h('averageIssuePrice')]: num(m.averageIssuePrice) ?? '',
      [h('priceUnit')]: String(m.priceUnit || m.unit || ''),
      [h('aluminaPercentage')]: num(m.aluminaPercentage) ?? '',
      [h('origin')]: originWord(readOrigin(m.origin), language),
    }));
}

/** LOCAL / IMPORTED as the template writes it - a word the import reads back. */
function originWord(origin: MaterialOrigin | null, language: 'ar' | 'en'): string {
  if (!origin) return '';
  if (language === 'ar') return origin === 'IMPORTED' ? 'مستورد' : 'محلي';
  return origin === 'IMPORTED' ? 'Imported' : 'Local';
}

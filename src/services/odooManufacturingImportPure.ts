/**
 * Odoo manufacturing-order sheets - Phase 1 Step 8C-5. Pure and Firebase-free.
 *
 * THE SOURCE FORMAT (the factory's "Odoo انتاجيات" export) is one sheet per
 * production area, every sheet with the same columns:
 *
 *   Reference                              MO reference, e.g. "كبس/MO/02492"
 *   Product Template/Internal Reference    the finished product code
 *   Finished Product                       "[CODE] name"
 *   Quantity Producing / Product Unit of Measure
 *   Source                                 free text: "PS03950", "ps04097/car65/car244", "رصيد"
 *   Scheduled Date                         an Excel date serial
 *   State                                  "Done"
 *   Components/Product Template            "[CODE] name"
 *   Components/Quantity Done / Components/UoM
 *   Components/Warehouse, /Product Category, /Product On Hand Quantity, /Source Location
 *
 * One MO is a header row (Reference filled) followed by continuation rows
 * (Reference blank) holding further components - or, on some sheets, only a
 * further "Finished Product".
 *
 * THE RESULT is exactly what the multi-sheet workbook produces (Step 8C-4): one
 * production payload per MO with its `materials`, handed to the SAME resolution
 * and validators. Nothing is written here and nothing is imported by this module.
 *
 * WHAT IS NEVER GUESSED - each of these blocks the record or is reported:
 *   the stage of the "المونة والخرسانة" sheet (mortar or thermal concrete)      -> choose explicitly
 *   the mill type of "الطواحين العادية" (tube or ball)                          -> reported, not set
 *   a quantity whose unit the stage does not record (pressing / sorting count
 *     pieces; the source gives tons)                                           -> blocked, never converted
 *   a further finished product listed without a quantity or output type       -> reported, not imported
 *   a component listed with zero quantity done                                 -> reported, not imported
 * Odoo unit NAMES ("Ton", "Kg", "m³", "pc") are translated to the approved unit
 * they name through an explicit table and reported on the record - a name
 * mapping, never a quantity conversion.
 */
import type { ProductionStageType } from '../types';
import { stageUomRow } from './uomReadinessPure';
import { normaliseUom } from './uomPure';
import { parseSourceDocumentReference, EQUIPMENT_TYPE_NOT_IDENTIFIED } from './productionAreaPure';
import type { RowOrigin, WorkbookIssue, WorkbookNormalisation, WorkbookRecord } from './workbookImportPure';

export const ODOO_MO_COLUMNS = {
  reference: 'Reference',
  productCode: 'Product Template/Internal Reference',
  finishedProduct: 'Finished Product',
  quantity: 'Quantity Producing',
  unit: 'Product Unit of Measure',
  source: 'Source',
  date: 'Scheduled Date',
  component: 'Components/Product Template',
  state: 'State',
  componentWarehouse: 'Components/Warehouse',
  componentQuantity: 'Components/Quantity Done',
  componentUnit: 'Components/UoM',
  componentCategory: 'Components/Product Category',
  componentOnHand: 'Components/Product On Hand Quantity',
  componentLocation: 'Components/Source Location',
} as const;

/** Columns that must all be present for a sheet to be read as an Odoo MO sheet. */
const REQUIRED_COLUMNS = ['reference', 'finishedProduct', 'quantity', 'unit', 'date', 'component', 'componentQuantity', 'componentUnit'] as const;

/** Columns kept only as provenance - shown in the review, never written. */
export const ODOO_PROVENANCE_ONLY_COLUMNS: readonly string[] = [
  ODOO_MO_COLUMNS.componentWarehouse,
  ODOO_MO_COLUMNS.componentCategory,
  ODOO_MO_COLUMNS.componentOnHand,
  ODOO_MO_COLUMNS.componentLocation,
];

export function isOdooManufacturingSheet(headers: readonly string[]): boolean {
  const set = new Set(headers.map((h) => String(h).trim()));
  return REQUIRED_COLUMNS.every((key) => set.has(ODOO_MO_COLUMNS[key]));
}

/** Odoo unit NAME -> the approved ASFOUR unit it names. A name table, not a conversion. */
export const ODOO_UOM_NAMES: Readonly<Record<string, string>> = {
  ton: 'طن',
  tons: 'طن',
  kg: 'كجم',
  'm³': 'م3',
  m3: 'م3',
  pc: 'قطعة',
  pcs: 'قطعة',
  units: 'قطعة',
  'لتر': 'لتر',
  l: 'لتر',
  liter: 'لتر',
  litre: 'لتر',
};

export const AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE = 'AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE';
export type OdooSheetStage = ProductionStageType | typeof AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE;

/** Arabic spelling differences that do not change the name (ى/ي, ة/ه, أ/إ/آ/ا, spacing). */
export function normaliseArabicName(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .replace(/ و /g, ' و')
    .toLowerCase();
}

/**
 * Sheet (or warehouse) name -> stage. Explicit; a name that is not here is not
 * read. "المونة والخرسانة" serves two record types and is AMBIGUOUS on purpose.
 */
const SHEET_STAGE_ENTRIES: ReadonlyArray<[string, OdooSheetStage]> = [
  ['كبس', 'pressing'],
  ['المكابس', 'pressing'],
  ['الفرن النفقي', 'tunnel_kiln'],
  ['الفرز', 'sorting'],
  ['الفرز و التغليف', 'sorting'],
  ['الفرز والتغليف', 'sorting'],
  ['الفرن الدوار', 'rotary_furnace'],
  ['الطواحين الصيني', 'chinese_mills'],
  ['طواحين صيني', 'chinese_mills'],
  ['الطواحين العادية', 'tube_ball_mills'],
  ['خلط', 'mixing'],
  ['الخلاطات', 'mixing'],
  ['المونة والخرسانة', AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE],
];
export const ODOO_SHEET_STAGES: ReadonlyMap<string, OdooSheetStage> = new Map(
  SHEET_STAGE_ENTRIES.map(([name, stage]) => [normaliseArabicName(name), stage]),
);

export function odooSheetStage(sheetName: string): OdooSheetStage | null {
  return ODOO_SHEET_STAGES.get(normaliseArabicName(sheetName)) ?? null;
}

/**
 * The record field an Odoo "Quantity Producing" goes to, per stage - only a
 * field whose unit is tons. Pressing and sorting count pieces: no field.
 */
export const ODOO_QUANTITY_FIELD: Readonly<Record<string, string | null>> = {
  pressing: null,
  sorting: null,
  rotary_furnace: 'productionQuantity',
  chinese_mills: 'quantity',
  tube_ball_mills: 'totalTons',
  mortar_concrete: 'productionQuantity',
  thermal_concrete: 'productionQuantity',
  mixing: 'productionQuantity',
  lightweight_foam: 'productionQuantity',
  tunnel_kiln: 'productionQuantity',
  handmade_brick: null,
};

/** "[CODE] name" -> { code, name }; a value without brackets is a name only. */
export function splitBracketCode(value: unknown): { code: string; name: string } {
  const raw = String(value ?? '').trim();
  const match = /^\[([^\]]+)\]\s*(.*)$/.exec(raw);
  return match ? { code: match[1].trim(), name: match[2].trim() } : { code: '', name: raw };
}

/** An Excel date serial (or a date / ISO string) -> YYYY-MM-DD; null when unreadable. The time of day is dropped. */
export function odooDateToIso(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Excel's 1900 date system, as wall-clock days: day 25569 is 1970-01-01.
    const d = new Date(Math.round((Math.floor(value) - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  if (/^\d+(\.\d+)?$/.test(text)) return odooDateToIso(Number(text));
  return null;
}

export function mapOdooUnit(value: unknown): { unit: string | null; mapped: boolean; original: string } {
  const original = String(value ?? '').trim();
  if (!original) return { unit: null, mapped: false, original };
  const approved = normaliseUom(original);
  if (approved.status === 'APPROVED') return { unit: approved.normalized, mapped: false, original };
  const named = ODOO_UOM_NAMES[original.toLowerCase()];
  return named ? { unit: named, mapped: true, original } : { unit: null, mapped: false, original };
}

export interface OdooSheetOptions {
  /** Required for the mortar / thermal concrete sheet; ignored otherwise unless set explicitly. */
  stageOverride?: ProductionStageType | null;
}

export interface OdooRecordExtras {
  /** Reviewable, acceptable findings on one record (unit names mapped, lines not imported). */
  warnings: WorkbookIssue[];
}

export type OdooWorkbookRecord = WorkbookRecord & OdooRecordExtras;

export interface OdooSheetNormalisation extends Omit<WorkbookNormalisation, 'records'> {
  sheetName: string;
  stage: OdooSheetStage | null;
  records: OdooWorkbookRecord[];
  /** Facts about the whole sheet worth showing once (e.g. mill type not in source). */
  notices: string[];
}

const blank = (value: unknown) => value === null || value === undefined || String(value).trim() === '';
const num = (value: unknown): number | null => {
  if (blank(value)) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
};
const issue = (sheet: WorkbookIssue['sheet'], sourceRowNumber: number, sourceRowId: string, field: string, messageAr: string, messageEn: string): WorkbookIssue =>
  ({ sheet, sourceRowNumber, sourceRowId, field, messageAr, messageEn });

/**
 * Folds one Odoo MO sheet into production payloads. Pure and deterministic; the
 * input rows are never mutated. `sourceRowNumber` is the Excel row (header = 1).
 */
export function normaliseOdooManufacturingSheet(
  sheetName: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  options: OdooSheetOptions = {},
): OdooSheetNormalisation {
  const C = ODOO_MO_COLUMNS;
  const sheetIssues: WorkbookIssue[] = [];
  const notices: string[] = [];
  const records: OdooWorkbookRecord[] = [];
  const orphans: WorkbookNormalisation['orphans'] = [];
  const detected = odooSheetStage(sheetName);
  let stage: ProductionStageType | null = null;

  const headers = rows.length ? Object.keys(rows.reduce((acc, r) => Object.assign(acc, r), {} as Record<string, unknown>)) : [];
  if (!isOdooManufacturingSheet(headers)) {
    sheetIssues.push(issue('production', 0, '', 'sheet', `الورقة "${sheetName}" ليست بتنسيق أوامر تصنيع أودو.`, `Sheet "${sheetName}" is not in the Odoo manufacturing-order format.`));
  }
  if (options.stageOverride) {
    stage = options.stageOverride;
  } else if (detected === AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE) {
    sheetIssues.push(issue('production', 0, '', 'stageType',
      `الورقة "${sheetName}" تجمع المونة والخرسانة الحرارية - اختر المرحلة صراحة؛ لا يتم التخمين من اسم المنتج.`,
      `Sheet "${sheetName}" holds both mortar and thermal concrete - choose the stage explicitly; it is never guessed from the product name.`));
  } else if (detected) {
    stage = detected;
  } else {
    sheetIssues.push(issue('production', 0, '', 'stageType', `لا توجد مرحلة معروفة للورقة "${sheetName}" - اختر المرحلة.`, `No known stage for sheet "${sheetName}" - choose the stage.`));
  }
  if (stage === 'tube_ball_mills') notices.push(EQUIPMENT_TYPE_NOT_IDENTIFIED);

  const quantityField = stage ? ODOO_QUANTITY_FIELD[stage] ?? null : null;
  const stageUnit = stage ? stageUomRow(stage)?.production?.unit ?? null : null;
  let current: OdooWorkbookRecord | null = null;
  const seen = new Map<string, OdooWorkbookRecord[]>();
  /** Odoo unit names read on each record's lines - reported once per record. */
  const mappedLineUnits = new Map<OdooWorkbookRecord, Map<string, string>>();

  const addComponent = (record: OdooWorkbookRecord, raw: Record<string, unknown>, rowNumber: number) => {
    const { code, name } = splitBracketCode(raw[C.component]);
    const qty = num(raw[C.componentQuantity]);
    const unit = mapOdooUnit(raw[C.componentUnit]);
    const key = record.sourceRowId;
    if (qty === 0) {
      record.warnings.push(issue('consumption', rowNumber, key, 'materials.quantity',
        `المكوّن "${code || name}" مدرج بكمية منفذة صفر - لم يُستورد كاستهلاك.`,
        `Component "${code || name}" is listed with zero quantity done - not imported as consumption.`));
      return;
    }
    const list = Array.isArray(record.payload.materials) ? (record.payload.materials as Array<Record<string, unknown>>) : [];
    const line: Record<string, unknown> = {
      lineId: `L${list.length + 1}`,
      sequence: list.length + 1,
      itemCode: code,
      quantity: qty ?? raw[C.componentQuantity],
      unit: unit.unit ?? unit.original,
    };
    if (!code) {
      record.issues.push(issue('consumption', rowNumber, key, 'materials.itemCode', `المكوّن "${name}" بلا كود بين أقواس.`, `Component "${name}" has no bracketed code.`));
    }
    if (qty === null) {
      record.issues.push(issue('consumption', rowNumber, key, 'materials.quantity', `كمية المكوّن "${code || name}" غير رقمية.`, `The quantity of component "${code || name}" is not a number.`));
    }
    if (unit.mapped && unit.unit) {
      const names = mappedLineUnits.get(record) ?? new Map<string, string>();
      names.set(unit.original, unit.unit);
      mappedLineUnits.set(record, names);
    }
    record.payload.materials = [...list, line];
    record.consumptionCount += 1;
    record.origins.push({ sheet: 'consumption', sourceRowNumber: rowNumber, sourceRowId: key, originalRowData: { ...raw } });
  };

  rows.forEach((raw, i) => {
    const rowNumber = i + 2;
    const reference = String(raw[C.reference] ?? '').trim();

    if (reference) {
      const finished = splitBracketCode(raw[C.finishedProduct]);
      const productCode = String(raw[C.productCode] ?? '').trim() || finished.code;
      const unit = mapOdooUnit(raw[C.unit]);
      const quantity = num(raw[C.quantity]);
      const date = odooDateToIso(raw[C.date]);
      const sourceText = String(raw[C.source] ?? '').trim();
      const record: OdooWorkbookRecord = {
        sourceRowId: reference,
        sourceRowNumber: rowNumber,
        payload: {
          sourceRowId: reference,
          ...(stage ? { stageType: stage } : {}),
          ...(date ? { date } : {}),
          productCode,
          productName: finished.name,
          manufacturingOrderNumber: reference,
          ...(sourceText ? { sourceDocumentReference: sourceText } : {}),
        },
        origins: [{ sheet: 'production', sourceRowNumber: rowNumber, sourceRowId: reference, originalRowData: { ...raw, __sheet: sheetName } }],
        consumptionCount: 0,
        outputCount: 0,
        issues: [],
        warnings: [],
      };
      if (stage === 'mixing') {
        record.payload.mixProductCode = productCode;
        record.payload.mixProductName = finished.name;
      }
      if (!date) record.issues.push(issue('production', rowNumber, reference, 'date', 'تاريخ الجدولة غير مقروء.', 'The scheduled date cannot be read.'));
      if (!productCode) record.issues.push(issue('production', rowNumber, reference, 'productCode', 'كود المنتج النهائي غير موجود.', 'The finished product code is missing.'));

      const state = String(raw[C.state] ?? '').trim();
      if (state && state.toLowerCase() !== 'done') {
        record.issues.push(issue('production', rowNumber, reference, 'state',
          `حالة أمر التصنيع "${state}" - تُستورد الأوامر المنتهية (Done) فقط.`,
          `The MO state is "${state}" - only finished (Done) orders are imported.`));
      }

      // Quantity: only into a field of the same unit - never converted.
      if (quantity === null || quantity <= 0) {
        record.issues.push(issue('production', rowNumber, reference, 'productionQuantity', 'كمية الإنتاج غير صالحة.', 'The production quantity is not valid.'));
      } else if (stage) {
        if (!unit.unit) {
          record.issues.push(issue('production', rowNumber, reference, 'productionUnit', `وحدة الإنتاج "${unit.original}" غير معروفة.`, `Production unit "${unit.original}" is unknown.`));
        } else if (!quantityField || unit.unit !== 'طن') {
          record.issues.push(issue('production', rowNumber, reference, 'productionQuantity',
            `عدم تطابق الوحدة: المرحلة تسجل الإنتاج بوحدة "${stageUnit ?? '-'}" والمصدر يعطي "${unit.original}" - لا يتم التحويل، والعدد بالقطعة غير موجود في المصدر.`,
            `Unit mismatch: this stage records production in "${stageUnit ?? '-'}" and the source gives "${unit.original}" - nothing is converted, and a piece count is not in the source.`));
        } else {
          record.payload[quantityField] = quantity;
          record.payload.productionUnit = unit.unit;
          if (unit.mapped) {
            record.warnings.push(issue('production', rowNumber, reference, 'productionUnit',
              `وحدة الإنتاج "${unit.original}" قُرئت كـ "${unit.unit}" (اسم وحدة أودو - بدون تحويل).`,
              `Production unit "${unit.original}" read as "${unit.unit}" (an Odoo unit name - no conversion).`));
          }
        }
      }

      // Source: kept verbatim; the kiln's car numbers are read out of it, nothing else.
      if (stage === 'tunnel_kiln' && sourceText) {
        const parsed = parseSourceDocumentReference(sourceText);
        if (parsed.furnaceCarNumbers.length) record.payload.furnaceCarNumbers = parsed.furnaceCarNumbers;
        if (parsed.unparsed.length) {
          record.warnings.push(issue('production', rowNumber, reference, 'sourceDocumentReference',
            `جزء من المصدر غير مفهوم ("${parsed.unparsed.join(' / ')}") - محفوظ كنص فقط.`,
            `Part of the source is not understood ("${parsed.unparsed.join(' / ')}") - kept as text only.`));
        }
      }

      if (!blank(raw[C.component])) addComponent(record, raw, rowNumber);
      seen.set(reference, [...(seen.get(reference) ?? []), record]);
      records.push(record);
      current = record;
      return;
    }

    const hasComponent = !blank(raw[C.component]);
    const hasFinished = !blank(raw[C.finishedProduct]);
    if (!hasComponent && !hasFinished) return; // an empty row belongs to nothing and says nothing

    const origin: RowOrigin = { sheet: hasComponent ? 'consumption' : 'outputs', sourceRowNumber: rowNumber, sourceRowId: '', originalRowData: { ...raw, __sheet: sheetName } };
    if (!current) {
      orphans.push({
        origin,
        payload: { ...raw },
        issue: issue(origin.sheet, rowNumber, '', 'Reference', 'سطر متابعة قبل أي أمر تصنيع - لم يُربط بشيء.', 'A continuation row before any manufacturing order - attached to nothing.'),
      });
      return;
    }
    if (hasComponent) {
      addComponent(current, raw, rowNumber);
      return;
    }
    // A further finished product with no quantity and no output type: shown, never invented.
    const extra = splitBracketCode(raw[C.finishedProduct]);
    current.warnings.push(issue('outputs', rowNumber, current.sourceRowId, 'productionOutputs',
      `منتج نهائي إضافي "${extra.code || extra.name}" بدون كمية أو نوع مخرج في المصدر - لم يُستورد كمخرج.`,
      `A further finished product "${extra.code || extra.name}" has no quantity or output type in the source - not imported as an output.`));
    current.origins.push({ ...origin, sourceRowId: current.sourceRowId });
  });

  for (const [record, names] of mappedLineUnits) {
    const list = [...names].map(([from, to]) => `${from} -> ${to}`).join(', ');
    record.warnings.push(issue('consumption', record.sourceRowNumber, record.sourceRowId, 'materials.unit',
      `وحدات المكونات قُرئت بأسماء أودو (${list}) - بدون تحويل للكميات.`,
      `Component units read from Odoo unit names (${list}) - quantities are not converted.`));
  }

  let duplicates = 0;
  for (const [key, group] of seen) {
    if (group.length < 2) continue;
    duplicates += group.length;
    for (const record of group) {
      record.issues.push(issue('production', record.sourceRowNumber, key, 'sourceRowId',
        `مرجع أمر التصنيع "${key}" مكرر في الورقة (${group.length}).`,
        `MO reference "${key}" appears more than once in the sheet (${group.length}).`));
    }
  }

  const consumption = records.reduce((n, r) => n + r.consumptionCount, 0);
  return {
    sheetName,
    stage: stage ?? detected,
    records,
    orphans,
    sheetIssues,
    notices,
    counts: { production: records.length, consumption, outputs: 0, orphans: orphans.length, duplicates },
  };
}

/** A record's acceptable findings, as import-row warnings. */
export function odooRecordWarnings(record: OdooWorkbookRecord): Array<{ field: string; messageAr: string; messageEn: string }> {
  return record.warnings.map((w) => ({
    field: `${w.sheet}.${w.field}`,
    messageAr: `صف ${w.sourceRowNumber}: ${w.messageAr}`,
    messageEn: `Row ${w.sourceRowNumber}: ${w.messageEn}`,
  }));
}

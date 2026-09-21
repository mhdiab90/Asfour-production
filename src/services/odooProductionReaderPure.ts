/**
 * Reader for the Odoo `mrp.production` export - Phase 1 Step 8D.
 * Pure and Firebase-free: it reads rows, it writes nothing.
 *
 * ONE MANUFACTURING ORDER IS MANY EXCEL ROWS. Odoo repeats an MO across rows
 * for its components, its work orders and its finished moves, usually leaving
 * the reference blank on the continuation rows. This reader groups by the MO
 * reference and treats a blank reference as "same MO as the row above" - it
 * NEVER creates a second manufacturing order from a continuation row.
 *
 * PLANNED IS NOT ACTUAL. "Quantity To Produce" is the planned figure and is
 * stored as `quantityToProduce`. A produced quantity is taken ONLY from a column
 * that explicitly says produced/done. A planned quantity of 0 is kept as 0
 * planned - it never becomes actual production, and it never becomes a record's
 * production quantity.
 *
 * SCRAP HERE IS A CROSS-CHECK. Any scrap column in this report is read into
 * `scrapCrossCheck` and never creates a scrap record - stock.scrap is the only
 * source that does (odooScrapReaderPure.ts).
 *
 * NOTHING IS INVENTED. A missing quantity stays null, an unknown unit stays
 * unmapped and is reported, a component with no code is reported, and a row that
 * cannot be read blocks only itself.
 */
import type { OdooSourceType } from '../types';
import {
  type OdooSourceRow,
  type ReaderContext,
  type ReaderResult,
  type SourceIssue,
  applySourceMapping,
  blank,
  buildSourceMapping,
  duration,
  issue,
  mapUnit,
  num,
  odooDateToIso,
  productOf,
  provenanceOf,
  sheetHeaders,
  splitBracketCode,
  text,
} from './odooSourcePure';

const SOURCE: OdooSourceType = 'MRP_PRODUCTION';

/** The ASFOUR fields this report can supply. */
export const MRP_PRODUCTION_FIELDS = [
  'moReference',
  'odooId',
  'productCode',
  'productName',
  'quantityToProduce',
  'producedQuantity',
  'secondaryQuantity',
  'unit',
  'bomCode',
  'componentCode',
  'componentName',
  'componentQuantity',
  'componentUnit',
  'scheduledDate',
  'startDate',
  'endDate',
  'realDuration',
  'expectedDuration',
  'responsible',
  'workOrderRaw',
  'workCenterRaw',
  'scrapQuantity',
  'scrapProduct',
  'state',
  'sourceDocument',
] as const;

/** Accepted column spellings, English and Arabic. Explicit - never a pattern. */
export const MRP_PRODUCTION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  moReference: ['Reference', 'Manufacturing Order', 'MO', 'Name', 'Production Order', 'أمر التصنيع', 'المرجع', 'رقم أمر التصنيع'],
  odooId: ['ID', 'Id', 'Database ID', 'External ID', 'odooId', 'odoo id', 'معرف أودو'],
  productCode: ['Product Template/Internal Reference', 'Product/Internal Reference', 'Internal Reference', 'Product Code', 'Default Code', 'كود المنتج', 'المرجع الداخلي'],
  productName: ['Finished Product', 'Product', 'Product Template', 'Product/Display Name', 'المنتج', 'المنتج النهائي'],
  quantityToProduce: ['Quantity To Produce', 'Quantity To Be Produced', 'Product Quantity', 'Quantity Producing', 'Expected Quantity', 'الكمية المطلوب إنتاجها', 'الكمية المخططة'],
  producedQuantity: ['Quantity Produced', 'Produced Quantity', 'Qty Produced', 'Quantity Done', 'Real Quantity', 'الكمية المنتجة', 'الكمية الفعلية'],
  secondaryQuantity: ['Secondary Quantity', 'Secondary Qty', 'Secondary UoM Quantity', 'الكمية الثانوية'],
  unit: ['Product Unit of Measure', 'Unit of Measure', 'UoM', 'Uom', 'وحدة القياس', 'الوحدة'],
  bomCode: ['Bill of Material', 'BoM', 'BOM', 'Bill of Materials', 'قائمة المواد'],
  componentCode: ['Components/Product Template/Internal Reference', 'Components/Internal Reference', 'Component Code', 'كود المكون'],
  componentName: ['Components/Product Template', 'Components/Product', 'Component', 'المكون'],
  componentQuantity: ['Components/Quantity Done', 'Components/Quantity', 'Component Quantity', 'كمية المكون'],
  componentUnit: ['Components/UoM', 'Components/Unit of Measure', 'Component UoM', 'وحدة المكون'],
  scheduledDate: ['Scheduled Date', 'Planned Date', 'Date Planned Start', 'التاريخ المجدول', 'تاريخ الجدولة'],
  startDate: ['Start Date', 'Date Start', 'Actual Start', 'Start', 'تاريخ البدء'],
  endDate: ['End Date', 'Date Finished', 'Actual End', 'Finished', 'تاريخ الانتهاء'],
  realDuration: ['Real Duration', 'Duration', 'Actual Duration', 'المدة الفعلية'],
  expectedDuration: ['Expected Duration', 'Planned Duration', 'المدة المتوقعة'],
  responsible: ['Responsible', 'User', 'Assigned To', 'المسؤول'],
  workOrderRaw: ['Work Orders/Operation', 'Work Orders/Work Order', 'Work Order', 'Operation', 'أمر العمل'],
  workCenterRaw: ['Work Orders/Work Center', 'Work Center', 'Workcenter', 'مركز العمل', 'مركز الإنتاج'],
  scrapQuantity: ['Scraps/Quantity', 'Scrap Quantity', 'Scrapped Quantity', 'كمية الهالك'],
  scrapProduct: ['Scraps/Product', 'Scrap Product', 'منتج الهالك'],
  state: ['State', 'Status', 'الحالة'],
  sourceDocument: ['Source', 'Source Document', 'Origin', 'المصدر'],
};

/** Without an MO reference the file cannot be read at all. */
export const MRP_PRODUCTION_REQUIRED = ['moReference'] as const;

export interface OdooComponentLine {
  code: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  unitOriginal: string;
  sourceRow: number;
}

export interface OdooProductionDraft {
  moReference: string;
  odooId: string | null;
  productCode: string;
  productName: string;
  /** PLANNED. Never actual production, never a record's production quantity. */
  quantityToProduce: number | null;
  /** ACTUAL - only from a column that explicitly says produced/done. */
  producedQuantity: number | null;
  secondaryQuantity: number | null;
  unit: string | null;
  unitOriginal: string;
  bomCode: string | null;
  components: OdooComponentLine[];
  scheduledDate: string | null;
  startDate: string | null;
  endDate: string | null;
  realDuration: number | null;
  expectedDuration: number | null;
  responsible: string | null;
  /** Work order / work centre text this report mentions - mrp.workorder stays authoritative. */
  workOrderRefs: string[];
  workCenterRefs: string[];
  /** Read for cross-checking only - never a scrap record. */
  scrapCrossCheck: Array<{ product: string; quantity: number | null; sourceRow: number }>;
  state: string | null;
  sourceDocument: string | null;
  /** Every Excel row that contributed to this MO. */
  sourceRows: number[];
}

export type OdooProductionRow = OdooSourceRow<OdooProductionDraft>;

/**
 * Reads the mrp.production sheet into one draft per manufacturing order.
 * Deterministic and non-mutating.
 */
export function readMrpProduction(
  rows: ReadonlyArray<Record<string, unknown>>,
  context: ReaderContext,
): ReaderResult<OdooProductionRow> {
  const headers = sheetHeaders(rows);
  const mapping = buildSourceMapping(SOURCE, MRP_PRODUCTION_FIELDS as unknown as string[], MRP_PRODUCTION_ALIASES, MRP_PRODUCTION_REQUIRED, headers, context.manualMapping ?? {});
  const sheetIssues: SourceIssue[] = mapping.missingRequired.map((field) =>
    issue(field, `عمود مطلوب غير موجود في ملف mrp.production: ${field}.`, `A required column is missing from the mrp.production file: ${field}.`));

  const out: OdooProductionRow[] = [];
  const byReference = new Map<string, OdooProductionRow>();
  let current: OdooProductionRow | null = null;
  let continuationBeforeMo = 0;
  let componentCount = 0;

  if (mapping.missingRequired.length > 0) {
    return { sourceType: SOURCE, fileName: context.fileName, sheetName: context.sheetName, mapping, rows: out, sheetIssues, counts: { manufacturingOrders: 0, sourceRows: rows.length, components: 0, continuationBeforeMo: 0 } };
  }

  const addComponent = (target: OdooProductionRow, mapped: Record<string, unknown>, sourceRow: number) => {
    if (blank(mapped.componentName) && blank(mapped.componentCode)) return;
    const { code, name } = productOf(mapped.componentCode, mapped.componentName);
    const quantity = num(mapped.componentQuantity);
    const unit = mapUnit(mapped.componentUnit);
    componentCount += 1;
    target.normalized.components.push({ code, name, quantity, unit: unit.unit, unitOriginal: unit.original, sourceRow });
    if (!code) {
      target.warnings.push(issue('components.code', `المكوّن "${name}" بلا كود - لا يمكن ربطه بصنف.`, `Component "${name}" has no code - it cannot be linked to an item.`));
    }
    if (unit.original && !unit.unit) {
      target.warnings.push(issue('components.unit', `وحدة المكوّن "${unit.original}" غير معروفة.`, `Component unit "${unit.original}" is unknown.`));
    }
  };

  const addScrapCrossCheck = (target: OdooProductionRow, mapped: Record<string, unknown>, sourceRow: number) => {
    if (blank(mapped.scrapQuantity) && blank(mapped.scrapProduct)) return;
    target.normalized.scrapCrossCheck.push({ product: splitBracketCode(mapped.scrapProduct).code || text(mapped.scrapProduct), quantity: num(mapped.scrapQuantity), sourceRow });
  };

  rows.forEach((raw, index) => {
    const sourceRow = index + 2;
    const mapped = applySourceMapping(raw, mapping);
    const reference = text(mapped.moReference);

    if (!reference) {
      if (!current) {
        continuationBeforeMo += 1;
        return;
      }
      addComponent(current, mapped, sourceRow);
      addScrapCrossCheck(current, mapped, sourceRow);
      const wo = text(mapped.workOrderRaw);
      const wc = text(mapped.workCenterRaw);
      if (wo && !current.normalized.workOrderRefs.includes(wo)) current.normalized.workOrderRefs.push(wo);
      if (wc && !current.normalized.workCenterRefs.includes(wc)) current.normalized.workCenterRefs.push(wc);
      current.normalized.sourceRows.push(sourceRow);
      return;
    }

    const existing = byReference.get(reference);
    if (existing) {
      // The same MO stated again (Odoo repeats the reference on some exports): the extra rows are its lines, not a new MO.
      addComponent(existing, mapped, sourceRow);
      addScrapCrossCheck(existing, mapped, sourceRow);
      existing.normalized.sourceRows.push(sourceRow);
      const wo = text(mapped.workOrderRaw);
      const wc = text(mapped.workCenterRaw);
      if (wo && !existing.normalized.workOrderRefs.includes(wo)) existing.normalized.workOrderRefs.push(wo);
      if (wc && !existing.normalized.workCenterRefs.includes(wc)) existing.normalized.workCenterRefs.push(wc);
      current = existing;
      return;
    }

    const product = productOf(mapped.productCode, mapped.productName);
    const unit = mapUnit(mapped.unit);
    const row: OdooProductionRow = {
      rowId: `${SOURCE}:${reference}`,
      sourceType: SOURCE,
      sourceRow,
      raw: { ...raw },
      issues: [],
      warnings: [],
      provenance: provenanceOf(context, SOURCE, sourceRow),
      normalized: {
        moReference: reference,
        odooId: text(mapped.odooId) || null,
        productCode: product.code,
        productName: product.name,
        quantityToProduce: num(mapped.quantityToProduce),
        producedQuantity: num(mapped.producedQuantity),
        secondaryQuantity: num(mapped.secondaryQuantity),
        unit: unit.unit,
        unitOriginal: unit.original,
        bomCode: text(mapped.bomCode) || null,
        components: [],
        scheduledDate: odooDateToIso(mapped.scheduledDate),
        startDate: odooDateToIso(mapped.startDate),
        endDate: odooDateToIso(mapped.endDate),
        realDuration: duration(mapped.realDuration),
        expectedDuration: duration(mapped.expectedDuration),
        responsible: text(mapped.responsible) || null,
        workOrderRefs: text(mapped.workOrderRaw) ? [text(mapped.workOrderRaw)] : [],
        workCenterRefs: text(mapped.workCenterRaw) ? [text(mapped.workCenterRaw)] : [],
        scrapCrossCheck: [],
        state: text(mapped.state) || null,
        sourceDocument: text(mapped.sourceDocument) || null,
        sourceRows: [sourceRow],
      },
    };

    if (!product.code) {
      row.issues.push(issue('productCode', 'كود المنتج النهائي غير موجود.', 'The finished product code is missing.'));
    }
    if (!row.normalized.scheduledDate && !row.normalized.startDate && !row.normalized.endDate) {
      row.warnings.push(issue('scheduledDate', 'لا يوجد تاريخ مقروء لأمر التصنيع.', 'The manufacturing order has no readable date.'));
    }
    if (unit.original && !unit.unit) {
      row.warnings.push(issue('unit', `وحدة الإنتاج "${unit.original}" غير معروفة - لم يتم تحويل أي كمية.`, `Production unit "${unit.original}" is unknown - no quantity was converted.`));
    } else if (unit.mapped) {
      row.warnings.push(issue('unit', `وحدة "${unit.original}" قُرئت كـ "${unit.unit}" (اسم وحدة أودو - بدون تحويل).`, `Unit "${unit.original}" read as "${unit.unit}" (an Odoo unit name - no conversion).`));
    }
    if (row.normalized.producedQuantity === null && row.normalized.quantityToProduce !== null) {
      row.warnings.push(issue('producedQuantity',
        'الكمية الفعلية غير موجودة في هذا الملف - الكمية المخططة لا تُستخدم كإنتاج فعلي.',
        'No actual quantity in this file - the planned quantity is never used as actual production.'));
    }

    addComponent(row, mapped, sourceRow);
    addScrapCrossCheck(row, mapped, sourceRow);
    byReference.set(reference, row);
    out.push(row);
    current = row;
  });

  if (continuationBeforeMo > 0) {
    sheetIssues.push(issue('moReference',
      `${continuationBeforeMo} صف قبل أول أمر تصنيع - لم تُربط بأي أمر.`,
      `${continuationBeforeMo} row(s) appear before any manufacturing order - they are attached to nothing.`));
  }

  return {
    sourceType: SOURCE,
    fileName: context.fileName,
    sheetName: context.sheetName,
    mapping,
    rows: out,
    sheetIssues,
    counts: { manufacturingOrders: out.length, sourceRows: rows.length, components: componentCount, continuationBeforeMo },
  };
}

/**
 * Reader for the Odoo `stock.scrap` export - Phase 1 Step 8D.
 * Pure and Firebase-free.
 *
 * stock.scrap is the ONLY source that creates a scrap record. Scrap columns in
 * mrp.production and mrp.workorder are read by those readers as cross-checks and
 * never produce a record, so the same scrap can never be counted twice.
 *
 * MANY SCRAP ROWS PER MO ARE NORMAL. Every row is its own scrap record; rows are
 * never merged, summed or deduplicated by MO.
 *
 * SCRAP IS NOT PRODUCTION. Nothing here touches a production quantity, and a
 * missing scrap value is left missing - a blank never becomes zero.
 */
import type { OdooSourceType } from '../types';
import {
  type OdooSourceRow,
  type ReaderContext,
  type ReaderResult,
  type SourceIssue,
  applySourceMapping,
  buildSourceMapping,
  issue,
  mapUnit,
  num,
  odooDateToIso,
  productOf,
  provenanceOf,
  sheetHeaders,
  text,
} from './odooSourcePure';

const SOURCE: OdooSourceType = 'STOCK_SCRAP';

export const STOCK_SCRAP_FIELDS = [
  'date',
  'moReference',
  'odooId',
  'productCode',
  'productName',
  'quantity',
  'unit',
  'reference',
  'scrapLocation',
  'sourceLocation',
  'state',
  'workOrderRaw',
] as const;

export const STOCK_SCRAP_ALIASES: Readonly<Record<string, readonly string[]>> = {
  date: ['Date', 'Scrap Date', 'Create Date', 'التاريخ', 'تاريخ الهالك'],
  moReference: ['Manufacturing Order', 'Production Order', 'Source Document', 'Origin', 'MO', 'أمر التصنيع'],
  odooId: ['ID', 'Id', 'Database ID', 'External ID', 'معرف أودو'],
  productCode: ['Product/Internal Reference', 'Internal Reference', 'Product Code', 'Default Code', 'كود المنتج'],
  productName: ['Product', 'Product Template', 'Product/Display Name', 'المنتج'],
  quantity: ['Quantity', 'Scrap Quantity', 'Qty', 'الكمية'],
  unit: ['Unit of Measure', 'UoM', 'Product Unit of Measure', 'الوحدة', 'وحدة القياس'],
  reference: ['Reference', 'Name', 'Scrap Reference', 'المرجع'],
  scrapLocation: ['Scrap Location', 'Scrap Location/Display Name', 'موقع الهالك', 'مخزن الهالك'],
  sourceLocation: ['Source Location', 'Location', 'Source Location/Display Name', 'الموقع المصدر', 'موقع المصدر'],
  state: ['State', 'Status', 'الحالة'],
  workOrderRaw: ['Work Order', 'Operation', 'أمر العمل'],
};

export const STOCK_SCRAP_REQUIRED = ['quantity', 'unit'] as const;

export interface OdooScrapDraft {
  date: string | null;
  moReference: string | null;
  odooId: string | null;
  productCode: string;
  productName: string;
  quantity: number | null;
  unit: string | null;
  unitOriginal: string;
  reference: string | null;
  scrapLocation: string | null;
  sourceLocation: string | null;
  state: string | null;
  rawWorkOrder: string | null;
  sourceRows: number[];
}

export type OdooScrapRow = OdooSourceRow<OdooScrapDraft>;

export function readStockScrap(
  rows: ReadonlyArray<Record<string, unknown>>,
  context: ReaderContext,
): ReaderResult<OdooScrapRow> {
  const headers = sheetHeaders(rows);
  const mapping = buildSourceMapping(SOURCE, STOCK_SCRAP_FIELDS as unknown as string[], STOCK_SCRAP_ALIASES, STOCK_SCRAP_REQUIRED, headers, context.manualMapping ?? {});
  const sheetIssues: SourceIssue[] = mapping.missingRequired.map((field) =>
    issue(field, `عمود مطلوب غير موجود في ملف stock.scrap: ${field}.`, `A required column is missing from the stock.scrap file: ${field}.`));

  const out: OdooScrapRow[] = [];
  if (mapping.missingRequired.length > 0) {
    return { sourceType: SOURCE, fileName: context.fileName, sheetName: context.sheetName, mapping, rows: out, sheetIssues, counts: { scrapRows: 0, sourceRows: rows.length } };
  }

  rows.forEach((raw, index) => {
    const sourceRow = index + 2;
    const mapped = applySourceMapping(raw, mapping);
    const product = productOf(mapped.productCode, mapped.productName);
    const unit = mapUnit(mapped.unit);
    const quantity = num(mapped.quantity);

    const row: OdooScrapRow = {
      rowId: `${SOURCE}:${sourceRow}`,
      sourceType: SOURCE,
      sourceRow,
      raw: { ...raw },
      issues: [],
      warnings: [],
      provenance: provenanceOf(context, SOURCE, sourceRow),
      normalized: {
        date: odooDateToIso(mapped.date),
        moReference: text(mapped.moReference) || null,
        odooId: text(mapped.odooId) || null,
        productCode: product.code,
        productName: product.name,
        quantity,
        unit: unit.unit,
        unitOriginal: unit.original,
        reference: text(mapped.reference) || null,
        scrapLocation: text(mapped.scrapLocation) || null,
        sourceLocation: text(mapped.sourceLocation) || null,
        state: text(mapped.state) || null,
        rawWorkOrder: text(mapped.workOrderRaw) || null,
        sourceRows: [sourceRow],
      },
    };

    if (quantity === null) {
      row.issues.push(issue('quantity', 'كمية الهالك غير رقمية - لا تُفترض صفرًا.', 'The scrap quantity is not a number - it is never assumed to be zero.'));
    } else if (quantity <= 0) {
      row.warnings.push(issue('quantity', 'كمية الهالك ليست أكبر من صفر.', 'The scrap quantity is not greater than zero.'));
    }
    if (!unit.unit) {
      row.issues.push(issue('unit', `وحدة الهالك "${unit.original}" غير معروفة - بدون تحويل.`, `Scrap unit "${unit.original}" is unknown - nothing is converted.`));
    } else if (unit.mapped) {
      row.warnings.push(issue('unit', `وحدة "${unit.original}" قُرئت كـ "${unit.unit}" (بدون تحويل).`, `Unit "${unit.original}" read as "${unit.unit}" (no conversion).`));
    }
    if (!row.normalized.date) {
      row.issues.push(issue('date', 'تاريخ الهالك غير مقروء.', 'The scrap date cannot be read.'));
    }
    if (!product.code) {
      row.warnings.push(issue('productCode', 'كود صنف الهالك غير موجود.', 'The scrapped item has no code.'));
    }
    if (!row.normalized.moReference) {
      row.warnings.push(issue('moReference', 'سطر هالك بلا أمر تصنيع - يُراجع كسطر يتيم.', 'A scrap row with no manufacturing order - reviewed as an orphan.'));
    }

    out.push(row);
  });

  return {
    sourceType: SOURCE,
    fileName: context.fileName,
    sheetName: context.sheetName,
    mapping,
    rows: out,
    sheetIssues,
    counts: { scrapRows: out.length, sourceRows: rows.length },
  };
}

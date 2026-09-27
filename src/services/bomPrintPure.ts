/**
 * Printing a BOM version - the mixture as the versions window shows it.
 *
 * The print carries exactly what is on screen for that version: the BOM and
 * its item, the version header (code, status, effective dates, basis, expected
 * yield), every component line in sequence order (type, source, item,
 * percentage, quantity, unit, the scaling preview when one is set, notes), the
 * Base Formula / Additives / Total Applied summary with any activation issue,
 * and the version notes. The numbers come from the same bomPure functions the
 * window uses (bomVersionPayloadForSave, bomFormula, formatFormulaPercentage),
 * so the paper can never disagree with the screen.
 *
 * Pure: it builds a model and an HTML document and nothing else - the window
 * hands the document to the browser's print dialog. It reads nothing, writes
 * nothing and changes no BOM.
 */
import {
  BOM_UNIT_LABELS,
  bomFormula,
  bomFormulaIssues,
  bomVersionPayloadForSave,
  formatFormulaPercentage,
} from './bomPure';

export interface BomPrintLine {
  sequence: string;
  type: string;
  source: string;
  item: string;
  percentage: string;
  /** "= 12.5%" when the percentage is derived from the quantity, else empty. */
  percentageDerived: string;
  quantity: string;
  /** "= 125 kg" when the quantity is derived from the percentage, else empty. */
  quantityDerived: string;
  unit: string;
  preview: string;
  notes: string;
  additive: boolean;
}

export interface BomPrintModel {
  language: 'ar' | 'en';
  bomCode: string;
  bomName: string;
  itemLabel: string;
  customerLabel: string;
  versionCode: string;
  status: string;
  effectiveFrom: string;
  effectiveTo: string;
  basis: string;
  expectedYield: string;
  quantityHeader: string;
  /** Set when a production quantity was entered for the scaling preview. */
  previewHeader: string | null;
  lines: BomPrintLine[];
  summary: {
    baseTotal: string;
    additiveTotal: string;
    totalApplied: string;
    basis: string;
    issues: string[];
  };
  notes: string;
  printedAt: string;
}

const pct = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 4 });
const qty = (n: number | null) => (n === null ? '-' : Number(n.toFixed(6)).toLocaleString('en-US', { maximumFractionDigits: 6 }));

/**
 * The print model of one version, as the window renders it.
 *
 * `version` may be a stored version or the draft on screen (form values); both
 * are normalised through bomVersionPayloadForSave first, exactly as the window
 * does before computing the formula.
 */
export function buildBomPrintModel(input: {
  language: 'ar' | 'en';
  bom: Record<string, any> | null;
  version: Record<string, any>;
  /** The window's own label for an item (code - name), by source and id. */
  itemLabel: (source: string, id: string) => string;
  customerLabel: string;
  /** The scaling-preview quantity typed in the window, if any. */
  previewQuantity?: string | null;
  printedAt: string;
}): BomPrintModel {
  const isAr = input.language === 'ar';
  const unitLabel = (u: string | null | undefined) =>
    (u && BOM_UNIT_LABELS[u] ? (isAr ? BOM_UNIT_LABELS[u].ar : BOM_UNIT_LABELS[u].en) : u || '');
  const normalised = bomVersionPayloadForSave(input.version);
  const formula = bomFormula(normalised);
  const issues = bomFormulaIssues(normalised);
  const previewValue = Number(input.previewQuantity);
  const previewFactor = formula.basisValid && String(input.previewQuantity ?? '').trim() !== '' && Number.isFinite(previewValue) && previewValue > 0
    ? previewValue / (formula.basisQuantity as number)
    : null;
  const basis = formula.basisValid ? `${qty(formula.basisQuantity)} ${unitLabel(formula.basisUnit)}` : (isAr ? 'غير محدد' : 'not set');

  const lines: BomPrintLine[] = [...normalised.components]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map((c) => {
      const fl = formula.lines.find((l) => l.lineId === c.lineId) ?? null;
      const additive = fl?.componentType === 'ADDITIVE';
      return {
        sequence: String(c.sequence ?? ''),
        type: additive ? (isAr ? '+ إضافة' : '+ Additive') : (isAr ? 'خلطة أساسية' : 'Base formula'),
        source: c.itemSource === 'products' ? (isAr ? 'منتج' : 'Product') : (isAr ? 'خامة' : 'Material'),
        item: input.itemLabel(c.itemSource, c.itemId),
        percentage: formatFormulaPercentage(fl?.componentType ?? 'BASE', fl?.percentage),
        percentageDerived: fl?.percentageDerived ? `= ${formatFormulaPercentage(fl.componentType, fl.effectivePercentage)}` : '',
        quantity: typeof c.quantity === 'number' && Number.isFinite(c.quantity) ? qty(c.quantity) : '-',
        quantityDerived: fl?.quantityDerived ? `= ${qty(fl.effectiveQuantity)} ${unitLabel(formula.basisUnit)}` : '',
        unit: unitLabel(c.unit) || '-',
        preview: previewFactor !== null
          ? (fl?.effectiveQuantity != null ? `${qty(fl.effectiveQuantity * previewFactor)} ${unitLabel(fl.unit)}` : '-')
          : '',
        notes: c.notes || '',
        additive,
      };
    });

  return {
    language: input.language,
    bomCode: String(input.bom?.code ?? ''),
    bomName: String(input.bom?.name ?? ''),
    itemLabel: input.bom ? input.itemLabel(String(input.bom.itemSource ?? ''), String(input.bom.itemId ?? '')) : '',
    customerLabel: input.customerLabel,
    versionCode: normalised.versionCode,
    status: normalised.status,
    effectiveFrom: normalised.effectiveFrom || '-',
    effectiveTo: normalised.effectiveTo || '-',
    basis,
    expectedYield: typeof normalised.expectedYieldPercent === 'number' ? `${pct(normalised.expectedYieldPercent)}%` : '-',
    quantityHeader: formula.basisValid
      ? `${isAr ? 'الكمية /' : 'Qty /'} ${qty(formula.basisQuantity)} ${unitLabel(formula.basisUnit)}`
      : (isAr ? 'الكمية' : 'Quantity'),
    previewHeader: previewFactor !== null
      ? `${isAr ? 'لإنتاج' : 'For'} ${qty(previewValue)} ${unitLabel(formula.basisUnit)}`
      : null,
    lines,
    summary: {
      baseTotal: `${pct(formula.baseTotal)}%`,
      additiveTotal: `+${pct(formula.additiveTotal)}%`,
      totalApplied: `${pct(formula.totalApplied)}%`,
      basis,
      issues: issues.map((i) => (isAr ? i.messageAr : i.messageEn)),
    },
    notes: normalised.notes,
    printedAt: input.printedAt,
  };
}

/** Text made safe to place inside HTML - a code or note can never become markup. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** The printable document: one A4 page per BOM version, right-to-left in Arabic. */
export function bomPrintHtml(model: BomPrintModel): string {
  const isAr = model.language === 'ar';
  const e = escapeHtml;
  const L = (ar: string, en: string) => e(isAr ? ar : en);
  const withPreview = model.previewHeader !== null;

  const headerRows: Array<[string, string]> = [
    [isAr ? 'كود قائمة المواد' : 'BOM code', model.bomCode],
    [isAr ? 'اسم قائمة المواد' : 'BOM name', model.bomName],
    [isAr ? 'الصنف' : 'Item', model.itemLabel],
    [isAr ? 'نطاق العميل' : 'Customer scope', model.customerLabel],
    [isAr ? 'الإصدار' : 'Version', model.versionCode],
    [isAr ? 'الحالة' : 'Status', model.status],
    [isAr ? 'يسري من' : 'Effective from', model.effectiveFrom],
    [isAr ? 'يسري حتى' : 'Effective to', model.effectiveTo],
    [isAr ? 'كمية الأساس' : 'Basis', model.basis],
    [isAr ? 'المردود المتوقع' : 'Expected yield', model.expectedYield],
  ];

  const lineRows = model.lines.length === 0
    ? `<tr><td colspan="${withPreview ? 9 : 8}" class="empty">${L('لا توجد مكونات', 'No components')}</td></tr>`
    : model.lines.map((l) => `
        <tr class="${l.additive ? 'additive' : ''}">
          <td class="num">${e(l.sequence)}</td>
          <td>${e(l.type)}</td>
          <td>${e(l.source)}</td>
          <td class="item">${e(l.item)}</td>
          <td class="num">${e(l.percentage)}${l.percentageDerived ? `<div class="derived">${e(l.percentageDerived)}</div>` : ''}</td>
          <td class="num">${e(l.quantity)}${l.quantityDerived ? `<div class="derived">${e(l.quantityDerived)}</div>` : ''}</td>
          <td>${e(l.unit)}</td>
          ${withPreview ? `<td class="num strong">${e(l.preview)}</td>` : ''}
          <td>${e(l.notes)}</td>
        </tr>`).join('');

  const issues = model.summary.issues.length
    ? `<ul class="issues">${model.summary.issues.map((i) => `<li>${e(i)}</li>`).join('')}</ul>`
    : `<p class="ok">${L('الخلطة مكتملة لقواعد التفعيل.', 'The formula meets the activation rules.')}</p>`;

  return `<!DOCTYPE html>
<html lang="${isAr ? 'ar' : 'en'}" dir="${isAr ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8" />
<title>${e(`${isAr ? 'قائمة المواد' : 'BOM'} ${model.bomCode} - ${model.versionCode}`)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; }
  header h1 { font-size: 16px; margin: 0; }
  header .company { font-size: 12px; font-weight: 700; color: #b45309; }
  header .printed { font-size: 10px; color: #475569; }
  table { width: 100%; border-collapse: collapse; }
  .head td { padding: 3px 6px; border: 1px solid #cbd5e1; }
  .head td.k { background: #f1f5f9; font-weight: 700; width: 18%; }
  .lines { margin-top: 10px; }
  .lines th { background: #0f172a; color: #fff; padding: 5px 4px; font-size: 10px; text-align: start; }
  .lines td { padding: 4px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  .lines tr.additive td { background: #faf5ff; }
  .num { font-family: Consolas, 'Courier New', monospace; direction: ltr; unicode-bidi: plaintext; }
  .strong { font-weight: 700; }
  .item { width: 30%; }
  .derived { color: #64748b; font-size: 9px; }
  .empty { text-align: center; color: #94a3b8; padding: 12px; }
  .summary { margin-top: 10px; border: 1px solid #cbd5e1; padding: 6px 8px; display: flex; gap: 18px; flex-wrap: wrap; font-weight: 700; }
  .summary span b { font-family: Consolas, 'Courier New', monospace; }
  /* A percentage inside Arabic text keeps its sign and % where they belong: +2.5%, never %+2.5. */
  .pct { direction: ltr; unicode-bidi: isolate; display: inline-block; }
  .issues { color: #9f1239; font-weight: 700; margin: 6px 0 0; }
  .ok { color: #065f46; font-weight: 700; margin: 6px 0 0; }
  .notes { margin-top: 10px; border: 1px solid #cbd5e1; padding: 6px 8px; min-height: 30px; white-space: pre-wrap; }
  @media print { thead { display: table-header-group; } tr { page-break-inside: avoid; } }
</style>
</head>
<body>
  <header>
    <div>
      <div class="company">${L('شركة عصفور للتعدين والحراريات', 'ASFOUR for Mining & Refractories')}</div>
      <h1>${L('قائمة المواد (الخلطة)', 'Bill of Materials (Mixture)')} - ${e(model.bomCode)}</h1>
    </div>
    <div class="printed">${L('تاريخ الطباعة', 'Printed')}: <span class="num">${e(model.printedAt)}</span></div>
  </header>

  <table class="head" id="bom-print-header">
    <tbody>
      ${headerRows.reduce<string[]>((rows, _, i) => (i % 2 === 0 ? [...rows, `<tr>
        <td class="k">${e(headerRows[i][0])}</td><td>${e(headerRows[i][1])}</td>
        ${headerRows[i + 1] ? `<td class="k">${e(headerRows[i + 1][0])}</td><td>${e(headerRows[i + 1][1])}</td>` : '<td></td><td></td>'}
      </tr>`] : rows), []).join('')}
    </tbody>
  </table>

  <table class="lines" id="bom-print-lines">
    <thead>
      <tr>
        <th>#</th>
        <th>${L('النوع', 'Type')}</th>
        <th>${L('المصدر', 'Source')}</th>
        <th>${L('الصنف', 'Item')}</th>
        <th>%</th>
        <th>${e(model.quantityHeader)}</th>
        <th>${L('الوحدة', 'Unit')}</th>
        ${withPreview ? `<th>${e(model.previewHeader)}</th>` : ''}
        <th>${L('ملاحظات', 'Notes')}</th>
      </tr>
    </thead>
    <tbody>${lineRows}
    </tbody>
  </table>

  <div class="summary" id="bom-print-summary">
    <span>${L('الخلطة الأساسية', 'Base Formula')}: <b class="pct">${e(model.summary.baseTotal)}</b></span>
    <span>${L('الإضافات', 'Additives')}: <b class="pct">${e(model.summary.additiveTotal)}</b></span>
    <span>${L('إجمالي المطبق', 'Total Applied')}: <b class="pct">${e(model.summary.totalApplied)}</b></span>
    <span>${L('الأساس', 'Basis')}: <b>${e(model.summary.basis)}</b></span>
  </div>
  ${issues}

  <div class="notes"><b>${L('ملاحظات الإصدار', 'Version notes')}:</b> ${e(model.notes)}</div>
</body>
</html>`;
}

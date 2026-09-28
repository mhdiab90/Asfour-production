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
 * 3.23.0: the page carries the company logo at the top left, and a footer on
 * every printed page - the developer on the right, the issuing department
 * (Finance & Costing) in the centre - in a small but legible type.
 *
 * 3.24.0: the columns follow the window - #, type, source, item CODE, item,
 * alumina %, percentage, quantity, unit, and (in the cost view) the item's value
 * - and the summary adds the mix's alumina %, and in the cost view the total
 * cost, the imported value and the imported share, from bomCostingPure.
 *
 * Pure: it builds a model and an HTML document and nothing else - the window
 * hands the document to the browser's print dialog. It reads nothing, writes
 * nothing and changes no BOM.
 */
import {
  BomView,
  PRICE_BASIS_LABELS,
  PriceBasis,
  bomCosting,
  formatMoney,
  formatShare,
  valueReasonLabel,
} from './bomCostingPure';
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
  /** The item's code - its own column (3.24.0). Empty when the item is not in the loaded lists. */
  code: string;
  item: string;
  /** "Imported" beside an imported item; empty otherwise. */
  origin: string;
  alumina: string;
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
  /** The item's value in the cost view, or why it has none. */
  value: string;
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
    /** The mix's alumina %. */
    aluminaTotal: string;
    /** "(incomplete)" when a component has no alumina %, else empty - kept apart so it never sits inside the number. */
    aluminaNote: string;
  };
  view: BomView;
  /** Set in the cost view. */
  costing: {
    priceBasisLabel: string;
    totalCost: string;
    importedValue: string;
    importedShare: string;
    /** What the totals do not cover - components without a value or an origin. */
    notes: string[];
  } | null;
  notes: string;
  printedAt: string;
  /** Absolute address of the company logo, or null to print without one. */
  logoUrl: string | null;
}

/** The footer: who built the system, and which department issues the document. */
export const PRINT_FOOTER_DEVELOPER = 'Developed by MHDIAB';
export const PRINT_FOOTER_DEPARTMENT = { ar: 'إدارة المالية والتكاليف', en: 'Finance & Costing Department' };

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
  /** Absolute address of the company logo. */
  logoUrl?: string | null;
  /** The product / material record of a component - codes, alumina, origin and prices come from it. */
  lookup?: (source: string, id: string) => Record<string, any> | null | undefined;
  /** QUANTITIES (default) or COST, as chosen in the window. */
  view?: BomView;
  priceBasis?: PriceBasis;
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
  const view: BomView = input.view ?? 'QUANTITIES';
  const priceBasis: PriceBasis = input.priceBasis ?? 'LAST_PURCHASE';
  const costing = bomCosting(normalised, input.lookup ?? (() => null), priceBasis);
  const costed = (lineId: string) => costing.lines.find((l) => l.lineId === lineId) ?? null;

  const lines: BomPrintLine[] = [...normalised.components]
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map((c) => {
      const fl = formula.lines.find((l) => l.lineId === c.lineId) ?? null;
      const additive = fl?.componentType === 'ADDITIVE';
      return {
        sequence: String(c.sequence ?? ''),
        type: additive ? (isAr ? '+ إضافة' : '+ Additive') : (isAr ? 'خلطة أساسية' : 'Base formula'),
        source: c.itemSource === 'products' ? (isAr ? 'منتج' : 'Product') : (isAr ? 'خامة' : 'Material'),
        code: costed(c.lineId)?.attributes.code ?? '',
        item: costed(c.lineId)?.attributes.found ? (costed(c.lineId)?.attributes.name || input.itemLabel(c.itemSource, c.itemId)) : input.itemLabel(c.itemSource, c.itemId),
        origin: costed(c.lineId)?.attributes.origin === 'IMPORTED' ? (isAr ? 'مستورد' : 'Imported') : '',
        alumina: costed(c.lineId)?.attributes.aluminaPercentage != null ? `${pct(costed(c.lineId)?.attributes.aluminaPercentage as number)}%` : '-',
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
        value: costed(c.lineId)?.value != null
          ? formatMoney(costed(c.lineId)?.value)
          : valueReasonLabel(costed(c.lineId)?.valueReason ?? 'NO_PRICE', input.language),
      };
    });

  const costNotes: string[] = [];
  if (costing.unvaluedLines > 0) {
    costNotes.push(isAr ? `${costing.unvaluedLines} مكون بدون قيمة - الإجمالي لا يشملها.` : `${costing.unvaluedLines} component(s) without a value - not in the total.`);
  }
  if (costing.missingOrigin > 0) {
    costNotes.push(isAr ? `${costing.missingOrigin} مكون غير محدد محلي/مستورد.` : `${costing.missingOrigin} component(s) not marked local / imported.`);
  }

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
      aluminaTotal: formatShare(costing.aluminaTotal),
      aluminaNote: costing.aluminaTotal !== null && !costing.aluminaComplete ? (isAr ? '(غير مكتمل)' : '(incomplete)') : '',
    },
    view,
    costing: view === 'COST'
      ? {
        priceBasisLabel: isAr ? PRICE_BASIS_LABELS[priceBasis].ar : PRICE_BASIS_LABELS[priceBasis].en,
        totalCost: formatMoney(costing.totalCost),
        importedValue: formatMoney(costing.importedValue),
        importedShare: formatShare(costing.importedShare),
        notes: costNotes,
      }
      : null,
    notes: normalised.notes,
    printedAt: input.printedAt,
    logoUrl: input.logoUrl || null,
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
  const withValue = model.costing !== null;
  const columns = 10 + (withPreview ? 1 : 0) + (withValue ? 1 : 0);

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
    ? `<tr><td colspan="${columns}" class="empty">${L('لا توجد مكونات', 'No components')}</td></tr>`
    : model.lines.map((l) => `
        <tr class="${l.additive ? 'additive' : ''}">
          <td class="num">${e(l.sequence)}</td>
          <td>${e(l.type)}</td>
          <td>${e(l.source)}</td>
          <td class="num code">${e(l.code || '-')}</td>
          <td class="item">${e(l.item)}${l.origin ? ` <span class="origin">${e(l.origin)}</span>` : ''}</td>
          <td class="num">${e(l.alumina)}</td>
          <td class="num">${e(l.percentage)}${l.percentageDerived ? `<div class="derived">${e(l.percentageDerived)}</div>` : ''}</td>
          <td class="num">${e(l.quantity)}${l.quantityDerived ? `<div class="derived">${e(l.quantityDerived)}</div>` : ''}</td>
          <td>${e(l.unit)}</td>
          ${withValue ? `<td class="num strong">${e(l.value)}</td>` : ''}
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
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #0f172a; font-size: 11px; margin: 0; padding-bottom: 26px; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 6px; margin-bottom: 10px; gap: 12px; }
  /* The logo sits at the top LEFT in either language. */
  header .logo { height: 54px; width: auto; object-fit: contain; order: 2; margin-inline-start: auto; }
  html[dir="ltr"] header .logo { order: -1; margin-inline-start: 0; margin-inline-end: auto; }
  header .titles { order: 1; }
  /* The footer repeats at the bottom of every printed page. */
  /* Laid out left to right in either language, so the developer is always on the RIGHT and the department in the centre. */
  footer { position: fixed; bottom: 0; left: 0; right: 0; height: 18px; border-top: 1px solid #cbd5e1; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; direction: ltr; font-size: 8.5px; font-weight: 600; color: #334155; background: #fff; }
  footer .developer { justify-self: end; }
  footer .department { justify-self: center; font-weight: 700; }
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
  .item { width: 26%; }
  .code { white-space: nowrap; }
  .origin { display: inline-block; margin-inline-start: 4px; padding: 0 4px; border-radius: 3px; background: #e0f2fe; color: #075985; font-size: 9px; font-weight: 700; }
  .cost { margin-top: 6px; border: 1px solid #0f172a; padding: 6px 8px; display: flex; gap: 18px; flex-wrap: wrap; font-weight: 700; background: #f8fafc; }
  .incomplete { color: #9a3412; font-weight: 600; font-size: 10px; }
  .cost .note { width: 100%; font-weight: 600; color: #9a3412; font-size: 10px; }
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
    <div class="titles">
      <div class="company">${L('شركة عصفور للتعدين والحراريات', 'ASFOUR for Mining & Refractories')}</div>
      <h1>${L('قائمة المواد (الخلطة)', 'Bill of Materials (Mixture)')} - ${e(model.bomCode)}</h1>
      <div class="printed">${L('تاريخ الطباعة', 'Printed')}: <span class="num">${e(model.printedAt)}</span></div>
    </div>
    ${model.logoUrl ? `<img class="logo" id="bom-print-logo" src="${e(model.logoUrl)}" alt="${L('شعار الشركة', 'Company logo')}" />` : ''}
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
        <th>${L('كود الصنف', 'Item code')}</th>
        <th>${L('الصنف', 'Item')}</th>
        <th>${L('الألومينا %', 'Alumina %')}</th>
        <th>${L('النسبة %', '%')}</th>
        <th>${e(model.quantityHeader)}</th>
        <th>${L('الوحدة', 'Unit')}</th>
        ${withValue ? `<th>${L('قيمة الصنف (ج.م)', 'Item value (EGP)')}</th>` : ''}
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
    <span>${L('نسبة الألومينا الإجمالية', 'Total alumina')}: <b class="pct">${e(model.summary.aluminaTotal)}</b>${model.summary.aluminaNote ? ` <span class="incomplete">${e(model.summary.aluminaNote)}</span>` : ''}</span>
  </div>
  ${model.costing ? `
  <div class="cost" id="bom-print-cost">
    <span>${L('إجمالي تكلفة البند', 'Total cost')} (${e(model.costing.priceBasisLabel)}): <b class="pct">${e(model.costing.totalCost)}</b> ${L('ج.م', 'EGP')}</span>
    <span>${L('قيمة المستورد', 'Imported value')}: <b class="pct">${e(model.costing.importedValue)}</b> ${L('ج.م', 'EGP')}</span>
    <span>${L('نسبة المستورد', 'Imported share')}: <b class="pct">${e(model.costing.importedShare)}</b></span>
    <span>${L('نسبة الألومينا الإجمالية', 'Total alumina')}: <b class="pct">${e(model.summary.aluminaTotal)}</b>${model.summary.aluminaNote ? ` <span class="incomplete">${e(model.summary.aluminaNote)}</span>` : ''}</span>
    ${model.costing.notes.map((n) => `<span class="note">${e(n)}</span>`).join('')}
  </div>` : ''}
  ${issues}

  <div class="notes"><b>${L('ملاحظات الإصدار', 'Version notes')}:</b> ${e(model.notes)}</div>

  <footer id="bom-print-footer">
    <span></span>
    <span class="department" dir="${isAr ? 'rtl' : 'ltr'}">${e(isAr ? PRINT_FOOTER_DEPARTMENT.ar : PRINT_FOOTER_DEPARTMENT.en)}</span>
    <span class="developer">${e(PRINT_FOOTER_DEVELOPER)}</span>
  </footer>
</body>
</html>`;
}

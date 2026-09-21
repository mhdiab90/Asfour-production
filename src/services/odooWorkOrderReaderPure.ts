/**
 * Reader for the Odoo `mrp.workorder` export - Phase 1 Step 8D.
 * Pure and Firebase-free.
 *
 * THIS IS THE WORK CENTRE SOURCE. The raw work-centre text is kept exactly as
 * exported and resolved through the Work Center registry
 * (workCenterRegistryPure.ts) into a main centre plus, when the text names one,
 * a specific machine. An unknown name is reported, never attached to a centre
 * that merely looks similar.
 *
 * A WORK ORDER IS NOT A SHIFT. `rawWorkOrder` is stored as written. A shift
 * number is derived ONLY for the work CENTRES whose own semantics say the work
 * order numbers the shift (WORK_ORDER_IS_SHIFT_CENTERS below: chinese mills,
 * presses and rotary sorting / السرد); everywhere else the field stays null and
 * the raw text is all that is kept.
 *
 * EMPLOYEE-ONLY AND CONTINUATION ROWS. Odoo repeats a work order over several
 * rows to list its employees: the first row carries the production, the rows
 * after it carry only an employee, or repeat the same MO / work order / work
 * centre with no quantity. Both are attached to the work order above them as
 * PARTICIPATION - they never create a second work order, never add a quantity
 * and never become a second production event. A quantity is read once, from the
 * row that carries it, and `isProductionEvent` says which row that was.
 *
 * SCRAP columns here are cross-checks; stock.scrap is the only scrap source.
 */
import type { OdooSourceType, StageWorkerItem, WorkCenterResolution } from '../types';
import { resolveWorkCenter, type ApprovedWorkCenterMapping } from './workCenterRegistryPure';
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
  text,
} from './odooSourcePure';

const SOURCE: OdooSourceType = 'MRP_WORKORDER';

export const MRP_WORKORDER_FIELDS = [
  'moReference',
  'odooId',
  'workOrderRaw',
  'workCenterRaw',
  'equipmentRaw',
  'productCode',
  'productName',
  'bomCode',
  'quantity',
  'secondaryQuantity',
  'unit',
  'realDuration',
  'expectedDuration',
  'durationPerUnit',
  'durationDeviation',
  'employeeName',
  'employeeCode',
  'state',
  'date',
  'startDate',
  'endDate',
  'scrapQuantity',
  'pauseSummary',
] as const;

export const MRP_WORKORDER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  moReference: ['Manufacturing Order', 'Production Order', 'Reference', 'MO', 'Production', 'أمر التصنيع', 'رقم أمر التصنيع'],
  odooId: ['ID', 'Id', 'Database ID', 'External ID', 'معرف أودو'],
  workOrderRaw: ['Work Order', 'Operation', 'Name', 'Work Orders/Operation', 'أمر العمل', 'العملية'],
  workCenterRaw: ['Work Center', 'Workcenter', 'Work Center/Name', 'مركز العمل', 'مركز الإنتاج'],
  equipmentRaw: ['Equipment', 'Machine', 'Work Center/Equipment', 'المعدة', 'الماكينة'],
  productCode: ['Product/Internal Reference', 'Product Template/Internal Reference', 'Internal Reference', 'Product Code', 'كود المنتج'],
  productName: ['Product', 'Finished Product', 'Product Template', 'المنتج'],
  bomCode: ['Bill of Material', 'BoM', 'BOM', 'قائمة المواد'],
  quantity: ['Quantity', 'Quantity Produced', 'Qty Produced', 'Quantity Done', 'Produced Quantity', 'الكمية', 'الكمية المنتجة'],
  secondaryQuantity: ['Secondary Quantity', 'Secondary Qty', 'الكمية الثانوية'],
  unit: ['Unit of Measure', 'Product Unit of Measure', 'UoM', 'الوحدة', 'وحدة القياس'],
  realDuration: ['Real Duration', 'Duration', 'Actual Duration', 'المدة الفعلية'],
  expectedDuration: ['Expected Duration', 'Planned Duration', 'Duration Expected', 'المدة المتوقعة'],
  durationPerUnit: ['Duration Per Unit', 'Duration/Unit', 'المدة لكل وحدة'],
  durationDeviation: ['Duration Deviation', 'Deviation', 'انحراف المدة'],
  employeeName: ['Employee', 'Employees', 'Worker', 'Employee/Name', 'العامل', 'الموظف', 'العمالة'],
  employeeCode: ['Employee Code', 'Employee/Barcode', 'كود الموظف', 'كود العامل'],
  state: ['State', 'Status', 'الحالة'],
  date: ['Date', 'Scheduled Date', 'التاريخ'],
  startDate: ['Start Date', 'Date Start', 'Actual Start', 'تاريخ البدء'],
  endDate: ['End Date', 'Date Finished', 'Actual End', 'تاريخ الانتهاء'],
  scrapQuantity: ['Scraps/Quantity', 'Scrap Quantity', 'كمية الهالك'],
  pauseSummary: ['Pause Summary', 'Blocked Time', 'Downtime', 'ملخص التوقف'],
};

export const MRP_WORKORDER_REQUIRED = ['moReference', 'workCenterRaw'] as const;

/**
 * The WORK CENTRES whose own source semantics number the shift in the
 * work-order column - keyed by centre, not by stage, so a centre that has no
 * production record type yet (السرد) still reads its shift correctly:
 *   chinese_mills  work order 1/2 = shift 1/2
 *   pressing       the source numbers the shift the same way
 *   sard           rotary sorting: 1 = shift 1, 2 = shift 2 (confirmed rule)
 * Everywhere else the work order is stage text and stays raw.
 */
export const WORK_ORDER_IS_SHIFT_CENTERS: readonly string[] = ['chinese_mills', 'pressing', 'sard'];

/** The shift a work order names, only for the centres above and only for a plain number. */
export function shiftFromWorkOrder(mainCenterId: string | null | undefined, rawWorkOrder: unknown): number | null {
  if (!mainCenterId || !WORK_ORDER_IS_SHIFT_CENTERS.includes(mainCenterId)) return null;
  const value = text(rawWorkOrder).replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48));
  const match = /^(?:shift\s*|وردية\s*|و\s*)?([1-3])$/i.exec(value);
  return match ? Number(match[1]) : null;
}

export interface OdooWorkOrderDraft {
  moReference: string;
  odooId: string | null;
  rawWorkOrder: string;
  workCenterRaw: string;
  workCenter: WorkCenterResolution;
  stageType: string | null;
  /** Only set for the centres whose work order genuinely numbers the shift. */
  shiftNumber: number | null;
  /**
   * True only when this row records an actual production quantity. A row that
   * repeats a work order to carry employees or continuation text is NOT a
   * production event and never becomes a production record.
   */
  isProductionEvent: boolean;
  equipmentRaw: string | null;
  productCode: string;
  productName: string;
  bomCode: string | null;
  quantity: number | null;
  secondaryQuantity: number | null;
  unit: string | null;
  unitOriginal: string;
  realDuration: number | null;
  expectedDuration: number | null;
  durationPerUnit: number | null;
  durationDeviation: number | null;
  state: string | null;
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Everyone the source named on this work order - never invented, never counted into a quantity. */
  employees: StageWorkerItem[];
  /** Rows that carried only an employee, kept for provenance. */
  employeeOnlyRows: number[];
  /** Cross-check only - never a scrap record. */
  scrapCrossCheck: Array<{ quantity: number | null; sourceRow: number }>;
  pauseSummary: string | null;
  sourceRows: number[];
}

export type OdooWorkOrderRow = OdooSourceRow<OdooWorkOrderDraft>;

const employeeOf = (mapped: Record<string, unknown>): StageWorkerItem | null => {
  const name = text(mapped.employeeName);
  const code = text(mapped.employeeCode);
  if (!name && !code) return null;
  return { employeeId: '', employeeCode: code, employeeName: name };
};

/** True when the row carries nothing but an employee - it belongs to the work order above it. */
function isEmployeeOnlyRow(mapped: Record<string, unknown>): boolean {
  const hasEmployee = !blank(mapped.employeeName) || !blank(mapped.employeeCode);
  if (!hasEmployee) return false;
  return ['workOrderRaw', 'workCenterRaw', 'quantity', 'secondaryQuantity', 'realDuration', 'productCode', 'productName', 'state']
    .every((field) => blank(mapped[field]));
}

/**
 * True when the row REPEATS the work order above it (same MO, same work order,
 * same work centre) and carries no quantity of its own - a continuation row
 * Odoo writes to list employees or extra text. It is attached to that work
 * order, never counted as a second production event.
 */
function isContinuationOf(current: OdooWorkOrderRow | null, mapped: Record<string, unknown>): boolean {
  if (!current) return false;
  if (!blank(mapped.quantity) || !blank(mapped.secondaryQuantity)) return false;
  const sameOrBlank = (value: unknown, previous: string) => {
    const next = text(value);
    return next === '' || next === previous;
  };
  return sameOrBlank(mapped.moReference, current.normalized.moReference)
    && sameOrBlank(mapped.workOrderRaw, current.normalized.rawWorkOrder)
    && sameOrBlank(mapped.workCenterRaw, current.normalized.workCenterRaw)
    && (!blank(mapped.employeeName) || !blank(mapped.employeeCode) || blank(mapped.productCode));
}

export function readMrpWorkOrder(
  rows: ReadonlyArray<Record<string, unknown>>,
  context: ReaderContext,
  approvedWorkCenters: readonly ApprovedWorkCenterMapping[] = [],
): ReaderResult<OdooWorkOrderRow> {
  const headers = sheetHeaders(rows);
  const mapping = buildSourceMapping(SOURCE, MRP_WORKORDER_FIELDS as unknown as string[], MRP_WORKORDER_ALIASES, MRP_WORKORDER_REQUIRED, headers, context.manualMapping ?? {});
  const sheetIssues: SourceIssue[] = mapping.missingRequired.map((field) =>
    issue(field, `عمود مطلوب غير موجود في ملف mrp.workorder: ${field}.`, `A required column is missing from the mrp.workorder file: ${field}.`));

  const out: OdooWorkOrderRow[] = [];
  let current: OdooWorkOrderRow | null = null;
  let employeeOnlyRows = 0;
  let employeeOnlyOrphans = 0;
  let continuationRows = 0;

  if (mapping.missingRequired.length > 0) {
    return { sourceType: SOURCE, fileName: context.fileName, sheetName: context.sheetName, mapping, rows: out, sheetIssues, counts: { workOrders: 0, sourceRows: rows.length, employeeOnlyRows: 0, employeeOnlyOrphans: 0, continuationRows: 0, productionEvents: 0 } };
  }

  rows.forEach((raw, index) => {
    const sourceRow = index + 2;
    const mapped = applySourceMapping(raw, mapping);

    if (isEmployeeOnlyRow(mapped)) {
      employeeOnlyRows += 1;
      const employee = employeeOf(mapped);
      if (!current || !employee) {
        employeeOnlyOrphans += 1;
        if (current && !employee) return;
        return;
      }
      // Participation only: no quantity, no second work order.
      current.normalized.employees.push(employee);
      current.normalized.employeeOnlyRows.push(sourceRow);
      current.normalized.sourceRows.push(sourceRow);
      return;
    }

    // A row that repeats the work order above it without a quantity is that
    // work order's continuation - it adds its employees and nothing else.
    if (isContinuationOf(current, mapped)) {
      continuationRows += 1;
      const employee = employeeOf(mapped);
      if (employee && current) {
        current.normalized.employees.push(employee);
        current.normalized.employeeOnlyRows.push(sourceRow);
      }
      current!.normalized.sourceRows.push(sourceRow);
      return;
    }

    const reference = text(mapped.moReference);
    const workCenterRaw = text(mapped.workCenterRaw);
    const workCenter = resolveWorkCenter(workCenterRaw, approvedWorkCenters);
    const product = productOf(mapped.productCode, mapped.productName);
    const unit = mapUnit(mapped.unit);
    const rawWorkOrder = text(mapped.workOrderRaw);
    const stageType = workCenter.stageType;

    const row: OdooWorkOrderRow = {
      rowId: `${SOURCE}:${sourceRow}`,
      sourceType: SOURCE,
      sourceRow,
      raw: { ...raw },
      issues: [],
      warnings: [],
      provenance: provenanceOf(context, SOURCE, sourceRow, workCenter.rule),
      normalized: {
        moReference: reference,
        odooId: text(mapped.odooId) || null,
        rawWorkOrder,
        workCenterRaw,
        workCenter,
        stageType,
        shiftNumber: shiftFromWorkOrder(workCenter.mainCenterId, rawWorkOrder),
        isProductionEvent: num(mapped.quantity) !== null,
        equipmentRaw: text(mapped.equipmentRaw) || workCenter.equipmentName,
        productCode: product.code,
        productName: product.name,
        bomCode: text(mapped.bomCode) || null,
        quantity: num(mapped.quantity),
        secondaryQuantity: num(mapped.secondaryQuantity),
        unit: unit.unit,
        unitOriginal: unit.original,
        realDuration: duration(mapped.realDuration),
        expectedDuration: duration(mapped.expectedDuration),
        durationPerUnit: num(mapped.durationPerUnit),
        durationDeviation: num(mapped.durationDeviation),
        state: text(mapped.state) || null,
        date: odooDateToIso(mapped.date),
        startDate: odooDateToIso(mapped.startDate),
        endDate: odooDateToIso(mapped.endDate),
        employees: [],
        employeeOnlyRows: [],
        scrapCrossCheck: blank(mapped.scrapQuantity) ? [] : [{ quantity: num(mapped.scrapQuantity), sourceRow }],
        pauseSummary: text(mapped.pauseSummary) || null,
        sourceRows: [sourceRow],
      },
    };

    const ownEmployee = employeeOf(mapped);
    if (ownEmployee) row.normalized.employees.push(ownEmployee);

    if (!reference) {
      row.issues.push(issue('moReference', 'أمر العمل بلا رقم أمر تصنيع.', 'The work order has no manufacturing order reference.'));
    }
    if (workCenter.status === 'EMPTY') {
      row.issues.push(issue('workCenterRaw', 'مركز العمل فارغ.', 'The work center is empty.'));
    } else if (workCenter.status === 'UNMAPPED_CENTER') {
      row.issues.push(issue('workCenterRaw',
        `مركز العمل "${workCenterRaw}" غير معروف - يحتاج ربطًا معتمدًا.`,
        `Work center "${workCenterRaw}" is not in the registry - it needs an approved mapping.`));
    } else if (workCenter.status === 'NO_STAGE_MAPPING') {
      row.issues.push(issue('workCenterRaw',
        `مركز "${workCenter.mainCenterNameAr}" لا يملك نوع سجل إنتاج - لا يمكن كتابة إنتاجه.`,
        `Center "${workCenter.mainCenterNameAr}" has no production record type - its production cannot be written.`));
    }
    if (unit.original && !unit.unit) {
      row.warnings.push(issue('unit', `وحدة "${unit.original}" غير معروفة - لم يتم تحويل أي كمية.`, `Unit "${unit.original}" is unknown - no quantity was converted.`));
    } else if (unit.mapped) {
      row.warnings.push(issue('unit', `وحدة "${unit.original}" قُرئت كـ "${unit.unit}" (بدون تحويل).`, `Unit "${unit.original}" read as "${unit.unit}" (no conversion).`));
    }
    if (row.normalized.quantity === null) {
      row.warnings.push(issue('quantity',
        'أمر عمل بلا كمية - ليس حدث إنتاج ولن يُنشئ سجل إنتاج.',
        'A work order with no quantity - it is not a production event and creates no production record.'));
    }
    if (rawWorkOrder && workCenter.mainCenterId && !WORK_ORDER_IS_SHIFT_CENTERS.includes(workCenter.mainCenterId)) {
      row.warnings.push(issue('rawWorkOrder',
        `"${rawWorkOrder}" نص أمر عمل - لا يُفسَّر كوردية في هذه المرحلة.`,
        `"${rawWorkOrder}" is work-order text - it is not read as a shift for this stage.`));
    }

    out.push(row);
    current = row;
  });

  if (employeeOnlyOrphans > 0) {
    sheetIssues.push(issue('employeeName',
      `${employeeOnlyOrphans} صف عمالة قبل أي أمر عمل - لم يُربط بشيء.`,
      `${employeeOnlyOrphans} employee row(s) appear before any work order - they are attached to nothing.`));
  }

  return {
    sourceType: SOURCE,
    fileName: context.fileName,
    sheetName: context.sheetName,
    mapping,
    rows: out,
    sheetIssues,
    counts: {
      workOrders: out.length,
      sourceRows: rows.length,
      employeeOnlyRows,
      employeeOnlyOrphans,
      continuationRows,
      productionEvents: out.filter((r) => r.normalized.isProductionEvent).length,
    },
  };
}

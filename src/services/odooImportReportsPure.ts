/**
 * Reports over the imported Odoo data - Phase 1 Step 8D. Pure and Firebase-free.
 *
 * READ-ONLY, ALWAYS. Every function here takes records the caller already
 * loaded and returns rows to display. Nothing writes, and nothing changes a
 * stored quantity - in particular the Employee Share below is a division done
 * for the report and never written anywhere.
 *
 * QUANTITIES ARE ONLY ADDED WITHIN ONE UNIT. A group whose rows use different
 * units reports `unitMismatch: true` and a null total instead of a number that
 * would silently mix tons and pieces. No conversion is ever applied.
 *
 * SCRAP IS NOT PRODUCTION. Scrap is reported on its own; it is never subtracted
 * from a production total here.
 *
 * WHO COUNTS AS A PARTICIPANT. Only the stages that genuinely record individual
 * workers (odooImportSessionPure.EMPLOYEE_PARTICIPATION_STAGES). Sorting and the
 * tunnel kiln work as one team, so they never produce participation or share
 * rows - and a head count is never assumed.
 */
import type { ImportSourceConflict, ProductionStageType, StageWorkerItem } from '../types';
import { recordsEmployeeParticipation } from './odooImportSessionPure';
import type { OrphanRecord } from './odooImportLinkingPure';

/** The shape the reports read - what a written `workOrders` record carries. */
export interface WorkOrderLike {
  id?: string;
  manufacturingOrderNumber: string;
  productionRecordId?: string | null;
  rawWorkOrder?: string | null;
  shiftNumber?: number | null;
  stageType?: ProductionStageType | string | null;
  workCenter?: { mainCenterId?: string | null; mainCenterNameAr?: string | null; equipmentName?: string | null; raw?: string } | null;
  productCode?: string | null;
  productName?: string | null;
  quantity?: number | null;
  unit?: string | null;
  date?: string | null;
  employees?: StageWorkerItem[];
  provenance?: { sourceFile?: string; sourceRow?: number; sourceType?: string; importSessionId?: string };
}

export interface ScrapLike {
  id?: string;
  manufacturingOrderNumber?: string | null;
  productCode?: string | null;
  productName?: string | null;
  stageType?: ProductionStageType | string | null;
  workCenter?: { mainCenterId?: string | null; mainCenterNameAr?: string | null } | null;
  quantity?: number | null;
  unit?: string | null;
  date?: string | null;
  provenance?: { sourceFile?: string; sourceRow?: number };
}

export interface QuantityGroupRow {
  key: string;
  label: string;
  /** Null when the rows use more than one unit - never a mixed sum. */
  total: number | null;
  unit: string | null;
  unitMismatch: boolean;
  rowCount: number;
  records: string[];
}

function groupQuantities<T>(
  rows: readonly T[],
  keyOf: (row: T) => { key: string; label: string } | null,
  quantityOf: (row: T) => { quantity: number | null; unit: string | null; id: string },
): QuantityGroupRow[] {
  const map = new Map<string, QuantityGroupRow>();
  for (const row of rows) {
    const group = keyOf(row);
    if (!group) continue;
    const { quantity, unit, id } = quantityOf(row);
    const existing = map.get(group.key) ?? { key: group.key, label: group.label, total: null, unit: null, unitMismatch: false, rowCount: 0, records: [] };
    existing.rowCount += 1;
    if (id) existing.records.push(id);
    if (typeof quantity === 'number' && Number.isFinite(quantity)) {
      if (existing.unit === null && !existing.unitMismatch) {
        existing.unit = unit ?? null;
        existing.total = (existing.total ?? 0) + quantity;
      } else if (existing.unit === (unit ?? null)) {
        existing.total = (existing.total ?? 0) + quantity;
      } else {
        // Two units in one group: the total is not a number anyone may use.
        existing.unitMismatch = true;
        existing.total = null;
      }
    }
    map.set(group.key, existing);
  }
  return [...map.values()]
    .map((r) => ({ ...r, total: r.total === null ? null : Number(r.total.toFixed(6)) }))
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.key.localeCompare(b.key));
}

// --- production ------------------------------------------------------------------------------

export function productionByManufacturingOrder(workOrders: readonly WorkOrderLike[]): QuantityGroupRow[] {
  return groupQuantities(workOrders,
    (w) => (w.manufacturingOrderNumber ? { key: w.manufacturingOrderNumber, label: w.manufacturingOrderNumber } : null),
    (w) => ({ quantity: w.quantity ?? null, unit: w.unit ?? null, id: String(w.id ?? '') }));
}

export function productionByWorkCenter(workOrders: readonly WorkOrderLike[]): QuantityGroupRow[] {
  return groupQuantities(workOrders,
    (w) => {
      const id = w.workCenter?.mainCenterId ?? null;
      return id ? { key: id, label: w.workCenter?.mainCenterNameAr ?? id } : { key: 'UNRESOLVED', label: 'UNRESOLVED_WORK_CENTER' };
    },
    (w) => ({ quantity: w.quantity ?? null, unit: w.unit ?? null, id: String(w.id ?? '') }));
}

export function productionByEquipment(workOrders: readonly WorkOrderLike[]): QuantityGroupRow[] {
  return groupQuantities(workOrders,
    (w) => {
      const equipment = w.workCenter?.equipmentName ?? null;
      return equipment ? { key: equipment, label: equipment } : null;
    },
    (w) => ({ quantity: w.quantity ?? null, unit: w.unit ?? null, id: String(w.id ?? '') }));
}

/** Only rows whose stage genuinely numbers the shift - a work order is never globally a shift. */
export function productionByShift(workOrders: readonly WorkOrderLike[]): QuantityGroupRow[] {
  return groupQuantities(workOrders.filter((w) => w.shiftNumber != null),
    (w) => ({ key: `shift-${w.shiftNumber}`, label: `Shift ${w.shiftNumber}` }),
    (w) => ({ quantity: w.quantity ?? null, unit: w.unit ?? null, id: String(w.id ?? '') }));
}

// --- scrap ------------------------------------------------------------------------------------

export function scrapByManufacturingOrder(scrap: readonly ScrapLike[]): QuantityGroupRow[] {
  return groupQuantities(scrap,
    (s) => ({ key: s.manufacturingOrderNumber ?? 'NO_MO', label: s.manufacturingOrderNumber ?? 'NO_MO' }),
    (s) => ({ quantity: s.quantity ?? null, unit: s.unit ?? null, id: String(s.id ?? '') }));
}

export function scrapByProduct(scrap: readonly ScrapLike[]): QuantityGroupRow[] {
  return groupQuantities(scrap,
    (s) => ({ key: s.productCode ?? 'NO_PRODUCT', label: s.productName || s.productCode || 'NO_PRODUCT' }),
    (s) => ({ quantity: s.quantity ?? null, unit: s.unit ?? null, id: String(s.id ?? '') }));
}

export function scrapByWorkCenter(scrap: readonly ScrapLike[]): QuantityGroupRow[] {
  return groupQuantities(scrap,
    (s) => {
      const id = s.workCenter?.mainCenterId ?? null;
      return { key: id ?? 'UNRESOLVED', label: s.workCenter?.mainCenterNameAr ?? 'UNRESOLVED_WORK_CENTER' };
    },
    (s) => ({ quantity: s.quantity ?? null, unit: s.unit ?? null, id: String(s.id ?? '') }));
}

export function scrapByStage(scrap: readonly ScrapLike[]): QuantityGroupRow[] {
  return groupQuantities(scrap,
    (s) => ({ key: String(s.stageType ?? 'NO_STAGE'), label: String(s.stageType ?? 'NO_STAGE') }),
    (s) => ({ quantity: s.quantity ?? null, unit: s.unit ?? null, id: String(s.id ?? '') }));
}

// --- employees ---------------------------------------------------------------------------------

export interface ParticipationOrder {
  manufacturingOrderNumber: string;
  workOrderId: string | null;
  rawWorkOrder: string | null;
  shiftNumber: number | null;
  stageType: string | null;
  workCenter: string | null;
  equipment: string | null;
  productCode: string | null;
  productName: string | null;
  date: string | null;
  /** The ACTUAL total production of that manufacturing order - never divided here. */
  orderTotalQuantity: number | null;
  unit: string | null;
  unitMismatch: boolean;
}

export interface EmployeeParticipationRow {
  employeeKey: string;
  employeeName: string;
  employeeCode: string;
  orders: ParticipationOrder[];
  orderCount: number;
}

const employeeKeyOf = (employee: StageWorkerItem): string =>
  String(employee.employeeId || employee.employeeCode || employee.employeeName || '').trim().toLowerCase();

/** The MO totals, computed once and reused by both employee reports. */
export function manufacturingOrderTotals(workOrders: readonly WorkOrderLike[]): Map<string, QuantityGroupRow> {
  return new Map(productionByManufacturingOrder(workOrders).map((row) => [row.key, row]));
}

/**
 * Every order an employee took part in, with the order's own actual total. The
 * stored quantity is shown as it is - this report never divides it.
 */
export function employeeParticipation(workOrders: readonly WorkOrderLike[]): EmployeeParticipationRow[] {
  const totals = manufacturingOrderTotals(workOrders);
  const byEmployee = new Map<string, EmployeeParticipationRow>();
  for (const order of workOrders) {
    if (!recordsEmployeeParticipation(order.stageType)) continue;
    const total = totals.get(order.manufacturingOrderNumber);
    for (const employee of order.employees ?? []) {
      const key = employeeKeyOf(employee);
      if (!key) continue;
      const row = byEmployee.get(key) ?? {
        employeeKey: key,
        employeeName: employee.employeeName ?? '',
        employeeCode: employee.employeeCode ?? '',
        orders: [],
        orderCount: 0,
      };
      row.orders.push({
        manufacturingOrderNumber: order.manufacturingOrderNumber,
        workOrderId: order.id ?? null,
        rawWorkOrder: order.rawWorkOrder ?? null,
        shiftNumber: order.shiftNumber ?? null,
        stageType: (order.stageType as string) ?? null,
        workCenter: order.workCenter?.mainCenterNameAr ?? null,
        equipment: order.workCenter?.equipmentName ?? null,
        productCode: order.productCode ?? null,
        productName: order.productName ?? null,
        date: order.date ?? null,
        orderTotalQuantity: total?.total ?? null,
        unit: total?.unit ?? null,
        unitMismatch: total?.unitMismatch ?? false,
      });
      row.orderCount = row.orders.length;
      byEmployee.set(key, row);
    }
  }
  return [...byEmployee.values()].sort((a, b) => b.orderCount - a.orderCount || a.employeeName.localeCompare(b.employeeName));
}

export interface EmployeeShareRow {
  manufacturingOrderNumber: string;
  stageType: string | null;
  /** The stored actual total - unchanged. */
  orderTotalQuantity: number | null;
  unit: string | null;
  unitMismatch: boolean;
  participantCount: number;
  participants: Array<{ employeeKey: string; employeeName: string; employeeCode: string }>;
  /** total / participants - ANALYTICAL ONLY. Never stored, never written back. */
  sharePerEmployee: number | null;
  note: string;
}

export const EMPLOYEE_SHARE_NOTE = 'ANALYTICAL ONLY - the stored production quantity is never changed.';

/**
 * Employee Share per manufacturing order: the order's actual total divided by
 * the number of employees who took part. Null when the total is unknown, the
 * units disagree, or nobody is recorded - never a guessed head count.
 */
export function employeeShare(workOrders: readonly WorkOrderLike[]): EmployeeShareRow[] {
  const totals = manufacturingOrderTotals(workOrders);
  const byMo = new Map<string, EmployeeShareRow>();
  for (const order of workOrders) {
    if (!recordsEmployeeParticipation(order.stageType)) continue;
    const mo = order.manufacturingOrderNumber;
    if (!mo) continue;
    const total = totals.get(mo);
    const row = byMo.get(mo) ?? {
      manufacturingOrderNumber: mo,
      stageType: (order.stageType as string) ?? null,
      orderTotalQuantity: total?.total ?? null,
      unit: total?.unit ?? null,
      unitMismatch: total?.unitMismatch ?? false,
      participantCount: 0,
      participants: [],
      sharePerEmployee: null,
      note: EMPLOYEE_SHARE_NOTE,
    };
    for (const employee of order.employees ?? []) {
      const key = employeeKeyOf(employee);
      if (!key || row.participants.some((p) => p.employeeKey === key)) continue;
      row.participants.push({ employeeKey: key, employeeName: employee.employeeName ?? '', employeeCode: employee.employeeCode ?? '' });
    }
    row.participantCount = row.participants.length;
    row.sharePerEmployee = row.orderTotalQuantity !== null && !row.unitMismatch && row.participantCount > 0
      ? Number((row.orderTotalQuantity / row.participantCount).toFixed(6))
      : null;
    byMo.set(mo, row);
  }
  return [...byMo.values()].sort((a, b) => a.manufacturingOrderNumber.localeCompare(b.manufacturingOrderNumber));
}

// --- import reports -------------------------------------------------------------------------------

export interface ConflictReportRow {
  logicalKey: string;
  field: string;
  severity: string;
  resolutionStatus: string;
  sourceA: string;
  valueA: string;
  locationA: string;
  sourceB: string;
  valueB: string;
  locationB: string;
  message: string;
}

export function conflictReport(conflicts: readonly ImportSourceConflict[], language: 'ar' | 'en' = 'en'): ConflictReportRow[] {
  return conflicts.map((c) => ({
    logicalKey: c.logicalKey,
    field: c.field,
    severity: c.severity,
    resolutionStatus: c.resolutionStatus,
    sourceA: c.sourceA,
    valueA: String(c.valueA ?? '-'),
    locationA: `${c.fileA || '-'}:${c.rowA || '-'}`,
    sourceB: c.sourceB,
    valueB: String(c.valueB ?? '-'),
    locationB: `${c.fileB || '-'}:${c.rowB || '-'}`,
    message: language === 'ar' ? c.messageAr : c.messageEn,
  }));
}

export function orphanReport(orphans: readonly OrphanRecord[], language: 'ar' | 'en' = 'en'): Array<{ kind: string; sourceType: string; sourceRow: number; reference: string; message: string }> {
  return orphans.map((o) => ({
    kind: o.kind,
    sourceType: o.sourceType,
    sourceRow: o.sourceRow,
    reference: o.reference,
    message: language === 'ar' ? o.messageAr : o.messageEn,
  }));
}

/** Where each written record came from - the import audit / provenance report. */
export function provenanceReport(records: ReadonlyArray<{ id?: string; provenance?: WorkOrderLike['provenance'] }>): Array<{ recordId: string; importSessionId: string; sourceFile: string; sourceType: string; sourceRow: number }> {
  return records.map((r) => ({
    recordId: String(r.id ?? ''),
    importSessionId: r.provenance?.importSessionId ?? '',
    sourceFile: r.provenance?.sourceFile ?? '',
    sourceType: String(r.provenance?.sourceType ?? ''),
    sourceRow: Number(r.provenance?.sourceRow ?? 0),
  }));
}

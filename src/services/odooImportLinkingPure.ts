/**
 * Linking, conflicts, orphans and production identity - Phase 1 Step 8D.
 * Pure and Firebase-free.
 *
 * THE LINK IS THE MANUFACTURING ORDER. A work order and a scrap row belong to
 * the manufacturing order whose reference they carry - compared exactly, after
 * trimming and case folding only. Nothing is attached by similarity, by date
 * proximity or to "the nearest" MO. A row whose MO is not in the production file
 * is an ORPHAN: it is reported and stays reviewable, never silently dropped and
 * never silently attached.
 *
 * PRODUCTION IDENTITY IS MO + WORK CENTRE. The same MO and product legitimately
 * produce several records when the work centre, the machine or (where the stage
 * genuinely numbers it) the shift differ. The identity key therefore carries MO,
 * product, main centre, equipment, work order / shift and the Odoo id, so four
 * chinese-mill rows of one MO stay four records - never collapsed into one, and
 * never summed.
 *
 * CONFLICTS ARE KEPT, NOT DECIDED. When two files disagree about the same
 * logical record, both values are recorded with their file, row and severity,
 * and the row is held for review. No source "wins" automatically.
 */
import type { ImportOrphanKind, ImportSourceConflict, OdooSourceType } from '../types';
import type { OdooProductionRow } from './odooProductionReaderPure';
import type { OdooWorkOrderRow } from './odooWorkOrderReaderPure';
import type { OdooScrapRow } from './odooScrapReaderPure';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());

/** MO references compared exactly, ignoring case and outer spaces only. */
export function moKey(reference: unknown): string {
  return text(reference).toLowerCase();
}

export interface ProductionIdentityParts {
  moReference: string;
  productCode?: string | null;
  mainCenterId?: string | null;
  equipmentName?: string | null;
  /** The raw work-order text, or the shift when the stage genuinely numbers it. */
  workOrderKey?: string | null;
  odooId?: string | null;
}

/**
 * The exact identity of one production row. Two rows are the same record only
 * when every part matches; anything else is additional production.
 */
export function productionIdentityKey(parts: ProductionIdentityParts): string {
  return [
    moKey(parts.moReference),
    text(parts.productCode).toLowerCase(),
    text(parts.mainCenterId).toLowerCase(),
    text(parts.equipmentName).toLowerCase(),
    text(parts.workOrderKey).toLowerCase(),
    text(parts.odooId).toLowerCase(),
  ].join('#');
}

/** The identity of one work-order row, from what the source actually said. */
export function workOrderIdentityKey(row: OdooWorkOrderRow): string {
  const n = row.normalized;
  return productionIdentityKey({
    moReference: n.moReference,
    productCode: n.productCode,
    mainCenterId: n.workCenter.mainCenterId,
    equipmentName: n.equipmentRaw ?? n.workCenter.equipmentName,
    workOrderKey: n.shiftNumber != null ? `shift:${n.shiftNumber}` : n.rawWorkOrder,
    odooId: n.odooId,
  });
}

export interface OrphanRecord {
  kind: ImportOrphanKind;
  rowId: string;
  sourceType: OdooSourceType;
  sourceRow: number;
  reference: string;
  messageAr: string;
  messageEn: string;
}

export interface MoLink {
  moReference: string;
  /** The production row, when the mrp.production file carries this MO. */
  productionRowId: string | null;
  workOrderRowIds: string[];
  scrapRowIds: string[];
}

export interface LinkResult {
  links: MoLink[];
  orphans: OrphanRecord[];
  conflicts: ImportSourceConflict[];
  /** Work-order rows that share one identity key - reported, never merged. */
  duplicateGroups: Array<{ identityKey: string; rowIds: string[] }>;
  counts: Record<string, number>;
}

const conflict = (
  input: Omit<ImportSourceConflict, 'resolutionStatus'>,
): ImportSourceConflict => ({ ...input, resolutionStatus: 'OPEN' });

/** Sums only the values a source actually gave; all-null stays null (never 0). */
function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  const present = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

const round = (value: number): number => Number(value.toFixed(6));

/**
 * Links the three sources, reports every row that belongs to nothing, and
 * records every disagreement. Never mutates its inputs.
 */
export function linkOdooSources(input: {
  production: readonly OdooProductionRow[];
  workOrders: readonly OdooWorkOrderRow[];
  scrap: readonly OdooScrapRow[];
}): LinkResult {
  const production = input.production ?? [];
  const workOrders = input.workOrders ?? [];
  const scrap = input.scrap ?? [];

  const byMo = new Map<string, MoLink>();
  const orphans: OrphanRecord[] = [];
  const conflicts: ImportSourceConflict[] = [];

  const linkOf = (reference: string): MoLink => {
    const key = moKey(reference);
    const existing = byMo.get(key);
    if (existing) return existing;
    const created: MoLink = { moReference: text(reference), productionRowId: null, workOrderRowIds: [], scrapRowIds: [] };
    byMo.set(key, created);
    return created;
  };

  for (const row of production) {
    linkOf(row.normalized.moReference).productionRowId = row.rowId;
  }

  // --- work orders ------------------------------------------------------------------------
  const workOrdersByMo = new Map<string, OdooWorkOrderRow[]>();
  for (const row of workOrders) {
    const n = row.normalized;
    const key = moKey(n.moReference);
    const link = byMo.get(key);
    if (!key || !link || !link.productionRowId) {
      orphans.push({
        kind: 'WORK_ORDER_WITHOUT_MO',
        rowId: row.rowId,
        sourceType: row.sourceType,
        sourceRow: row.sourceRow,
        reference: n.moReference,
        messageAr: `أمر عمل بأمر تصنيع "${n.moReference || '-'}" غير موجود في ملف mrp.production.`,
        messageEn: `A work order whose manufacturing order "${n.moReference || '-'}" is not in the mrp.production file.`,
      });
    }
    if (key) {
      linkOf(n.moReference).workOrderRowIds.push(row.rowId);
      workOrdersByMo.set(key, [...(workOrdersByMo.get(key) ?? []), row]);
    }
    if (n.workCenter.status === 'UNMAPPED_CENTER' || n.workCenter.status === 'EMPTY') {
      orphans.push({
        kind: 'UNRESOLVED_WORK_CENTER',
        rowId: row.rowId,
        sourceType: row.sourceType,
        sourceRow: row.sourceRow,
        reference: n.workCenterRaw,
        messageAr: `مركز عمل غير معروف: "${n.workCenterRaw || '-'}".`,
        messageEn: `Unknown work center: "${n.workCenterRaw || '-'}".`,
      });
    } else if (n.workCenter.status === 'NO_STAGE_MAPPING') {
      orphans.push({
        kind: 'UNRESOLVED_STAGE',
        rowId: row.rowId,
        sourceType: row.sourceType,
        sourceRow: row.sourceRow,
        reference: n.workCenter.mainCenterNameAr ?? n.workCenterRaw,
        messageAr: `المركز "${n.workCenter.mainCenterNameAr}" بلا نوع سجل إنتاج.`,
        messageEn: `Center "${n.workCenter.mainCenterNameAr}" has no production record type.`,
      });
    }
    if (!n.productCode) {
      orphans.push({
        kind: 'UNRESOLVED_PRODUCT',
        rowId: row.rowId,
        sourceType: row.sourceType,
        sourceRow: row.sourceRow,
        reference: n.productName,
        messageAr: 'أمر عمل بلا كود منتج.',
        messageEn: 'A work order with no product code.',
      });
    }
  }

  // --- scrap ------------------------------------------------------------------------------
  const scrapByMo = new Map<string, OdooScrapRow[]>();
  for (const row of scrap) {
    const n = row.normalized;
    const key = moKey(n.moReference);
    const link = key ? byMo.get(key) : undefined;
    if (!key || !link || !link.productionRowId) {
      orphans.push({
        kind: 'SCRAP_WITHOUT_MO',
        rowId: row.rowId,
        sourceType: row.sourceType,
        sourceRow: row.sourceRow,
        reference: n.moReference ?? '',
        messageAr: `سطر هالك بأمر تصنيع "${n.moReference || '-'}" غير موجود في ملف mrp.production.`,
        messageEn: `A scrap row whose manufacturing order "${n.moReference || '-'}" is not in the mrp.production file.`,
      });
    }
    if (key) {
      linkOf(n.moReference ?? '').scrapRowIds.push(row.rowId);
      scrapByMo.set(key, [...(scrapByMo.get(key) ?? []), row]);
    }
    if (!n.productCode) {
      orphans.push({
        kind: 'UNRESOLVED_PRODUCT',
        rowId: row.rowId,
        sourceType: row.sourceType,
        sourceRow: row.sourceRow,
        reference: n.productName,
        messageAr: 'سطر هالك بلا كود منتج.',
        messageEn: 'A scrap row with no product code.',
      });
    }
  }

  // --- conflicts between the sources --------------------------------------------------------
  for (const row of production) {
    const p = row.normalized;
    const key = moKey(p.moReference);
    const orders = workOrdersByMo.get(key) ?? [];

    // Product: the MO and its work orders must name the same finished product.
    for (const order of orders) {
      const o = order.normalized;
      if (p.productCode && o.productCode && p.productCode.toLowerCase() !== o.productCode.toLowerCase()) {
        conflicts.push(conflict({
          logicalKey: p.moReference,
          field: 'productCode',
          sourceA: row.sourceType, valueA: p.productCode, rowA: row.sourceRow, fileA: row.provenance.sourceFile,
          sourceB: order.sourceType, valueB: o.productCode, rowB: order.sourceRow, fileB: order.provenance.sourceFile,
          severity: 'BLOCKING',
          messageAr: `المنتج يختلف بين الملفين لأمر التصنيع "${p.moReference}".`,
          messageEn: `The product differs between the two files for manufacturing order "${p.moReference}".`,
        }));
      }
      if (p.unit && o.unit && p.unit !== o.unit) {
        conflicts.push(conflict({
          logicalKey: p.moReference,
          field: 'unit',
          sourceA: row.sourceType, valueA: p.unit, rowA: row.sourceRow, fileA: row.provenance.sourceFile,
          sourceB: order.sourceType, valueB: o.unit, rowB: order.sourceRow, fileB: order.provenance.sourceFile,
          severity: 'BLOCKING',
          messageAr: `الوحدة تختلف بين الملفين - لا يتم أي تحويل.`,
          messageEn: `The unit differs between the two files - nothing is converted.`,
        }));
      }
    }

    // Quantity: the MO's own actual quantity against the sum of its work orders.
    const orderTotal = orders.length ? sumOrNull(orders.map((o) => o.normalized.quantity)) : null;
    if (p.producedQuantity !== null && orderTotal !== null && round(p.producedQuantity) !== round(orderTotal)) {
      conflicts.push(conflict({
        logicalKey: p.moReference,
        field: 'quantity',
        sourceA: 'MRP_PRODUCTION', valueA: p.producedQuantity, rowA: row.sourceRow, fileA: row.provenance.sourceFile,
        sourceB: 'MRP_WORKORDER', valueB: round(orderTotal), rowB: orders[0]?.sourceRow ?? row.sourceRow, fileB: orders[0]?.provenance.sourceFile ?? row.provenance.sourceFile,
        severity: 'WARNING',
        messageAr: `كمية أمر التصنيع (${p.producedQuantity}) لا تساوي مجموع أوامر العمل (${round(orderTotal)}) - القيمتان محفوظتان للمراجعة.`,
        messageEn: `The manufacturing order quantity (${p.producedQuantity}) differs from the sum of its work orders (${round(orderTotal)}) - both values are kept for review.`,
      }));
    }

    // Scrap: stock.scrap is the source of record; the other files' scrap columns only cross-check it.
    const scrapRows = scrapByMo.get(key) ?? [];
    const scrapTotal = sumOrNull(scrapRows.map((s) => s.normalized.quantity));
    const crossCheck = sumOrNull([
      ...p.scrapCrossCheck.map((s) => s.quantity),
      ...orders.flatMap((o) => o.normalized.scrapCrossCheck.map((s) => s.quantity)),
    ]);
    if (scrapTotal !== null && crossCheck !== null && round(scrapTotal) !== round(crossCheck)) {
      conflicts.push(conflict({
        logicalKey: p.moReference,
        field: 'scrapQuantity',
        sourceA: 'STOCK_SCRAP', valueA: round(scrapTotal), rowA: scrapRows[0].sourceRow, fileA: scrapRows[0].provenance.sourceFile,
        sourceB: p.scrapCrossCheck.length ? 'MRP_PRODUCTION' : 'MRP_WORKORDER', valueB: round(crossCheck), rowB: row.sourceRow, fileB: row.provenance.sourceFile,
        severity: 'WARNING',
        messageAr: `هالك stock.scrap (${round(scrapTotal)}) لا يطابق الهالك المذكور في الملف الآخر (${round(crossCheck)}) - stock.scrap هو المصدر، والقيمة الأخرى للمراجعة فقط.`,
        messageEn: `stock.scrap (${round(scrapTotal)}) does not match the scrap mentioned in the other file (${round(crossCheck)}) - stock.scrap is the source of record; the other value is a cross-check only.`,
      }));
    }
    if (crossCheck !== null && scrapTotal === null) {
      conflicts.push(conflict({
        logicalKey: p.moReference,
        field: 'scrapQuantity',
        sourceA: 'STOCK_SCRAP', valueA: null, rowA: 0, fileA: '',
        sourceB: p.scrapCrossCheck.length ? 'MRP_PRODUCTION' : 'MRP_WORKORDER', valueB: round(crossCheck), rowB: row.sourceRow, fileB: row.provenance.sourceFile,
        severity: 'WARNING',
        messageAr: 'هالك مذكور في ملف آخر بلا سطر في stock.scrap - لا يتم إنشاء سجل هالك من مصدر غير أساسي.',
        messageEn: 'Scrap mentioned in another file with no stock.scrap row - a scrap record is never created from a non-primary source.',
      }));
    }
  }

  // --- a manufacturing order with no work order ------------------------------------------------
  // It is kept in full and reported: without a work order there is no work
  // centre, and a production centre is never invented for it.
  for (const row of production) {
    const orders = workOrdersByMo.get(moKey(row.normalized.moReference)) ?? [];
    if (orders.length > 0) continue;
    orphans.push({
      kind: 'MO_WITHOUT_WORK_ORDER',
      rowId: row.rowId,
      sourceType: row.sourceType,
      sourceRow: row.sourceRow,
      reference: row.normalized.moReference,
      messageAr: `أمر التصنيع "${row.normalized.moReference}" بلا أمر عمل - يبقى للمراجعة ولا يُنشأ له سجل إنتاج بمركز مُفترض.`,
      messageEn: `Manufacturing order "${row.normalized.moReference}" has no work order - it stays for review and no production record with an assumed centre is created for it.`,
    });
  }

  // --- work-order rows that claim the same identity ------------------------------------------
  const byIdentity = new Map<string, string[]>();
  for (const row of workOrders) {
    const key = workOrderIdentityKey(row);
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), row.rowId]);
  }
  const duplicateGroups = [...byIdentity.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([identityKey, rowIds]) => ({ identityKey, rowIds }));

  const links = [...byMo.values()];
  return {
    links,
    orphans,
    conflicts,
    duplicateGroups,
    counts: {
      manufacturingOrders: production.length,
      workOrders: workOrders.length,
      scrapRows: scrap.length,
      linkedWorkOrders: workOrders.length - orphans.filter((o) => o.kind === 'WORK_ORDER_WITHOUT_MO').length,
      linkedScrapRows: scrap.length - orphans.filter((o) => o.kind === 'SCRAP_WITHOUT_MO').length,
      orphans: orphans.length,
      manufacturingOrdersWithoutWorkOrder: orphans.filter((o) => o.kind === 'MO_WITHOUT_WORK_ORDER').length,
      conflicts: conflicts.length,
      duplicateGroups: duplicateGroups.length,
    },
  };
}

/** The orphan kinds recorded for one row - used by the review to show why a row is held. */
export function orphanKindsOf(orphans: readonly OrphanRecord[], rowId: string): ImportOrphanKind[] {
  return [...new Set(orphans.filter((o) => o.rowId === rowId).map((o) => o.kind))];
}

/** The conflicts recorded for one MO. */
export function conflictsOf(conflicts: readonly ImportSourceConflict[], moReference: string): ImportSourceConflict[] {
  const key = moKey(moReference);
  return conflicts.filter((c) => moKey(c.logicalKey) === key);
}

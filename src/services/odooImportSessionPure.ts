/**
 * The three-file Odoo import session - Phase 1 Step 8D. Pure and Firebase-free.
 *
 * ONE SESSION, THREE FILES. mrp.production, mrp.workorder and stock.scrap are
 * read by their own readers, linked by manufacturing order, and turned into the
 * SAME `ImportRow` lifecycle the entity import already uses (entityImportPure):
 * original row, corrections, validation, warnings, selection, outcome. Nothing
 * here writes, and no second lifecycle is invented.
 *
 * WHAT EACH ROW BECOMES
 *   odooProduction   the manufacturing order - CONTEXT ONLY. It supplies the
 *                    date, product, planned quantity and components, and is
 *                    never written as a production record on its own, so a
 *                    quantity can never be counted twice.
 *   odooWorkOrder    one production record per PRODUCTION EVENT: a work-order
 *                    row that carries an actual quantity, identified by MO +
 *                    work centre (+ machine, + shift where the centre numbers
 *                    it). A row that only repeats a work order to list
 *                    employees or continuation text carries no quantity, is
 *                    attached to its work order by the reader, and never
 *                    becomes a record. Four chinese-mill rows of one MO stay
 *                    four records.
 *   odooScrap        one scrap record per row, from stock.scrap only.
 *
 * PLANNED NEVER BECOMES ACTUAL. `quantityToProduce` is carried as planned; the
 * production quantity of a written record is the work order's own quantity.
 *
 * UNITS ARE NEVER CONVERTED. A work order whose unit is not the unit the stage
 * records (pieces vs tons) is blocked with that reason; no piece count is
 * derived from a weight.
 */
import type {
  ImportOrphanKind,
  ImportProvenance,
  ImportSourceConflict,
  OdooSourceType,
  ProductionStageType,
  StageWorkerItem,
} from '../types';
import { applyValidation, createImportRow, type ImportIssue, type ImportRow } from './entityImportPure';
import { ODOO_QUANTITY_FIELD } from './odooManufacturingImportPure';
import { stageUomRow } from './uomReadinessPure';
import { summariseWorkCenters, type ApprovedWorkCenterMapping } from './workCenterRegistryPure';
import type { OdooProductionRow } from './odooProductionReaderPure';
import type { OdooWorkOrderRow } from './odooWorkOrderReaderPure';
import type { OdooScrapRow } from './odooScrapReaderPure';
import {
  conflictsOf,
  linkOdooSources,
  moKey,
  orphanKindsOf,
  workOrderIdentityKey,
  type LinkResult,
} from './odooImportLinkingPure';

/** The row kinds a three-file Odoo session produces. */
export const ODOO_IMPORT_KINDS = ['odooProduction', 'odooWorkOrder', 'odooScrap'] as const;
export type OdooImportKind = (typeof ODOO_IMPORT_KINDS)[number];

/** Stages that record who worked on the order. Sorting and the tunnel kiln work as one team. */
export const EMPLOYEE_PARTICIPATION_STAGES: readonly ProductionStageType[] = ['pressing', 'chinese_mills', 'mixing'];

/** Stages where the source lists no individual workers - a team, never invented names or a head count. */
export const TEAM_ONLY_STAGES: readonly ProductionStageType[] = ['sorting', 'tunnel_kiln'];

export type StageOperationalRule = 'CONTINUOUS_NO_DOWNTIME' | 'STANDARD';

/**
 * The tunnel kiln runs continuously: a blank pause summary is the rule, not an
 * unknown. No pause record is ever invented for it.
 */
export function stageOperationalRule(stageType: ProductionStageType | string | null | undefined): StageOperationalRule {
  return stageType === 'tunnel_kiln' ? 'CONTINUOUS_NO_DOWNTIME' : 'STANDARD';
}

export function recordsEmployeeParticipation(stageType: ProductionStageType | string | null | undefined): boolean {
  return (EMPLOYEE_PARTICIPATION_STAGES as readonly string[]).includes(String(stageType ?? ''));
}

export interface OdooStagedRow {
  row: ImportRow;
  kind: OdooImportKind;
  sourceType: OdooSourceType;
  provenance: ImportProvenance;
  /** The raw Excel row, kept untouched beside the row's own frozen copy. */
  rawRow: Record<string, unknown>;
  linkedManufacturingOrder: string | null;
  linkedRowIds: string[];
  orphanKinds: ImportOrphanKind[];
  /** Only for a work order: the exact identity that keeps legitimate extra production separate. */
  identityKey?: string;
  /** The payload that would be written, when the row is writable. */
  payload?: Record<string, unknown>;
  /** The collection the payload belongs to, for scrap and work orders. */
  targetStage?: ProductionStageType | null;
}

export interface OdooSessionInput {
  importSessionId: string;
  createdBy: string;
  createdAt: string;
  production: readonly OdooProductionRow[];
  workOrders: readonly OdooWorkOrderRow[];
  scrap: readonly OdooScrapRow[];
  approvedWorkCenters?: readonly ApprovedWorkCenterMapping[];
}

export interface OdooSessionResult {
  importSessionId: string;
  staged: OdooStagedRow[];
  link: LinkResult;
  conflicts: ImportSourceConflict[];
  workCenters: ReturnType<typeof summariseWorkCenters>;
  counts: Record<string, number>;
}

const issue = (field: string, messageAr: string, messageEn: string): ImportIssue => ({ field, messageAr, messageEn });

/**
 * The production payload one work order would write, using the MO row for the
 * date and product. Returns the payload and the reasons it cannot be written.
 */
export function productionPayloadFromWorkOrder(
  workOrder: OdooWorkOrderRow,
  mo: OdooProductionRow | null,
  options: { attachComponents: boolean },
): { payload: Record<string, unknown> | null; errors: ImportIssue[]; warnings: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const n = workOrder.normalized;
  const stage = n.workCenter.stageType;

  if (!stage) {
    errors.push(issue('stageType',
      `لا يمكن كتابة إنتاج: المركز "${n.workCenterRaw}" غير مرتبط بنوع سجل إنتاج.`,
      `No production can be written: center "${n.workCenterRaw}" has no production record type.`));
    return { payload: null, errors, warnings };
  }

  if (!n.isProductionEvent) {
    errors.push(issue('quantity',
      'هذا السطر لا يسجل كمية إنتاج - ليس حدث إنتاج ولا يُنشأ منه سجل.',
      'This row records no production quantity - it is not a production event and creates no record.'));
    return { payload: null, errors, warnings };
  }

  const quantityField = ODOO_QUANTITY_FIELD[stage] ?? null;
  const stageUnit = stageUomRow(stage)?.production?.unit ?? null;
  const date = n.date ?? n.startDate ?? mo?.normalized.scheduledDate ?? mo?.normalized.startDate ?? null;
  const productCode = n.productCode || mo?.normalized.productCode || '';

  if (!date) errors.push(issue('date', 'لا يوجد تاريخ للسجل.', 'The record has no date.'));
  if (!productCode) errors.push(issue('productCode', 'لا يوجد كود منتج.', 'There is no product code.'));
  if (n.quantity === null) {
    errors.push(issue('quantity', 'لا توجد كمية فعلية على أمر العمل - الكمية المخططة لا تُستخدم.', 'The work order has no actual quantity - the planned quantity is never used.'));
  }
  if (!n.unit) {
    errors.push(issue('unit', `وحدة "${n.unitOriginal || '-'}" غير معتمدة.`, `Unit "${n.unitOriginal || '-'}" is not an approved unit.`));
  } else if (!quantityField || (stageUnit && n.unit !== stageUnit)) {
    errors.push(issue('quantity',
      `عدم تطابق الوحدة: المرحلة تسجل الإنتاج بوحدة "${stageUnit ?? '-'}" والمصدر يعطي "${n.unit}" - لا يتم أي تحويل.`,
      `Unit mismatch: this stage records production in "${stageUnit ?? '-'}" and the source gives "${n.unit}" - nothing is converted.`));
  }

  if (errors.length > 0) return { payload: null, errors, warnings };

  const payload: Record<string, unknown> = {
    stageType: stage,
    date,
    productCode,
    productName: n.productName || mo?.normalized.productName || '',
    [quantityField as string]: n.quantity,
    productionUnit: n.unit,
    manufacturingOrderNumber: n.moReference,
    sourceDocumentReference: mo?.normalized.sourceDocument ?? null,
    externalRefs: [
      ...(n.odooId ? [{ system: 'odoo', model: 'mrp.workorder', externalId: n.odooId, externalCode: n.rawWorkOrder || undefined }] : []),
      ...(mo?.normalized.odooId ? [{ system: 'odoo', model: 'mrp.production', externalId: mo.normalized.odooId, externalCode: n.moReference }] : []),
    ],
  };

  if (n.shiftNumber != null) payload.shiftNumber = n.shiftNumber;
  if (mo?.normalized.quantityToProduce !== undefined && mo?.normalized.quantityToProduce !== null) {
    // Planned, kept as planned - never a production quantity.
    payload.plannedQuantity = mo.normalized.quantityToProduce;
  }
  if (recordsEmployeeParticipation(stage) && n.employees.length > 0) {
    payload.workers = n.employees as StageWorkerItem[];
  } else if (n.employees.length > 0) {
    warnings.push(issue('workers',
      'هذه المرحلة تعمل كفريق واحد - لا تُسجَّل مشاركة عمالة فردية.',
      'This stage works as one team - individual employee participation is not recorded.'));
  }
  if (stageOperationalRule(stage) === 'CONTINUOUS_NO_DOWNTIME') {
    payload.operationalRule = 'CONTINUOUS_NO_DOWNTIME';
    if (!n.pauseSummary) {
      warnings.push(issue('pauseSummary',
        'الفرن النفقي تشغيل مستمر - غياب ملخص التوقف ليس توقفًا مجهولًا.',
        'The tunnel kiln runs continuously - a blank pause summary is not unknown downtime.'));
    }
  }
  if (options.attachComponents && mo && mo.normalized.components.length > 0) {
    payload.materials = mo.normalized.components.map((c, i) => ({
      lineId: `L${i + 1}`,
      sequence: i + 1,
      itemCode: c.code,
      quantity: c.quantity,
      unit: c.unit ?? c.unitOriginal,
    }));
  } else if (mo && mo.normalized.components.length > 0) {
    // Odoo gives no component-to-work-order linkage, so nothing is allocated.
    warnings.push(issue('materials',
      'المكوّنات مسجلة على أمر التصنيع وله أكثر من أمر عمل، ولا يوجد ربط صريح في المصدر - تبقى على مستوى أمر التصنيع ولا تُوزَّع.',
      'Components belong to the manufacturing order, it has several work orders and the source gives no explicit linkage - they stay at manufacturing-order level and are never split.'));
  }

  return { payload, errors, warnings };
}

/** The scrap payload one stock.scrap row would write. */
export function scrapPayloadFromRow(
  scrap: OdooScrapRow,
  workCenterStage: ProductionStageType | null,
): { payload: Record<string, unknown> | null; errors: ImportIssue[]; warnings: ImportIssue[] } {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const n = scrap.normalized;
  if (n.quantity === null) errors.push(issue('quantity', 'كمية الهالك غير موجودة.', 'The scrap quantity is missing.'));
  if (!n.unit) errors.push(issue('unit', 'وحدة الهالك غير معتمدة.', 'The scrap unit is not approved.'));
  if (!n.date) errors.push(issue('date', 'تاريخ الهالك غير مقروء.', 'The scrap date cannot be read.'));
  if (errors.length > 0) return { payload: null, errors, warnings };

  return {
    payload: {
      date: n.date,
      manufacturingOrderNumber: n.moReference,
      productCode: n.productCode || null,
      productName: n.productName || null,
      quantity: n.quantity,
      unit: n.unit,
      reference: n.reference,
      scrapLocation: n.scrapLocation,
      sourceLocation: n.sourceLocation,
      state: n.state,
      rawWorkOrder: n.rawWorkOrder,
      stageType: workCenterStage,
      externalRefs: n.odooId ? [{ system: 'odoo', model: 'stock.scrap', externalId: n.odooId, externalCode: n.reference ?? undefined }] : [],
    },
    errors,
    warnings,
  };
}

/**
 * Builds the session: every row of the three files as a reviewable import row,
 * with its links, orphan reasons, conflicts and the payload it would write.
 */
export function buildOdooImportSession(input: OdooSessionInput): OdooSessionResult {
  const link = linkOdooSources({ production: input.production, workOrders: input.workOrders, scrap: input.scrap });
  const staged: OdooStagedRow[] = [];

  const moByKey = new Map(input.production.map((row) => [moKey(row.normalized.moReference), row]));
  const workOrderCountByMo = new Map<string, number>();
  for (const wo of input.workOrders) {
    const key = moKey(wo.normalized.moReference);
    workOrderCountByMo.set(key, (workOrderCountByMo.get(key) ?? 0) + 1);
  }

  // --- manufacturing orders: context only ------------------------------------------------
  for (const row of input.production) {
    const importRow = createImportRow('odooProduction' as never, row.sourceRow, row.raw, row.rowId);
    const warnings = [...row.warnings];
    const orderCount = workOrderCountByMo.get(moKey(row.normalized.moReference)) ?? 0;
    if (orderCount === 0) {
      // Kept in full and reviewable - a production centre is never invented for it.
      warnings.push(issue('workOrders',
        'لا توجد أوامر عمل لهذا الأمر - يبقى للمراجعة ولا يُكتب منه سجل إنتاج بمركز مُفترض.',
        'This manufacturing order has no work orders - it stays for review and no production record with an assumed centre is written from it.'));
    }
    warnings.push(issue('quantityToProduce',
      'الكمية المطلوب إنتاجها كمية مخططة - لا تُكتب كإنتاج فعلي.',
      'The quantity to produce is planned - it is never written as actual production.'));
    const validated = applyValidation(importRow, {
      errors: row.issues,
      warnings,
      normalized: { ...row.normalized },
    });
    staged.push({
      row: { ...validated, selection: 'EXCLUDED' },
      kind: 'odooProduction',
      sourceType: row.sourceType,
      provenance: row.provenance,
      rawRow: row.raw,
      linkedManufacturingOrder: row.normalized.moReference,
      linkedRowIds: [
        ...input.workOrders.filter((w) => moKey(w.normalized.moReference) === moKey(row.normalized.moReference)).map((w) => w.rowId),
        ...input.scrap.filter((s) => moKey(s.normalized.moReference) === moKey(row.normalized.moReference)).map((s) => s.rowId),
      ],
      orphanKinds: orphanKindsOf(link.orphans, row.rowId),
      targetStage: null,
    });
  }

  // --- work orders: one production record each --------------------------------------------
  for (const row of input.workOrders) {
    const mo = moByKey.get(moKey(row.normalized.moReference)) ?? null;
    const single = (workOrderCountByMo.get(moKey(row.normalized.moReference)) ?? 0) === 1;
    const built = productionPayloadFromWorkOrder(row, mo, { attachComponents: single });
    const orphanKinds = orphanKindsOf(link.orphans, row.rowId);
    const conflicts = conflictsOf(link.conflicts, row.normalized.moReference);
    const errors: ImportIssue[] = [...row.issues, ...built.errors];
    const warnings: ImportIssue[] = [...row.warnings, ...built.warnings];

    for (const c of conflicts) {
      const text = `${c.field}: ${c.sourceA}=${String(c.valueA)} / ${c.sourceB}=${String(c.valueB)}`;
      const entry = issue(`conflict.${c.field}`, `${c.messageAr} (${text})`, `${c.messageEn} (${text})`);
      if (c.severity === 'BLOCKING') errors.push(entry);
      else warnings.push(entry);
    }
    if (orphanKinds.includes('WORK_ORDER_WITHOUT_MO')) {
      warnings.push(issue('moReference',
        'أمر عمل بلا أمر تصنيع مطابق في ملف mrp.production.',
        'A work order with no matching manufacturing order in the mrp.production file.'));
    }

    const validated = applyValidation(createImportRow('odooWorkOrder' as never, row.sourceRow, row.raw, row.rowId), {
      errors,
      warnings,
      normalized: built.payload ? { ...row.normalized, payload: built.payload } : null,
    });
    staged.push({
      row: validated,
      kind: 'odooWorkOrder',
      sourceType: row.sourceType,
      provenance: row.provenance,
      rawRow: row.raw,
      linkedManufacturingOrder: row.normalized.moReference,
      linkedRowIds: mo ? [mo.rowId] : [],
      orphanKinds,
      identityKey: workOrderIdentityKey(row),
      payload: built.payload ?? undefined,
      targetStage: row.normalized.workCenter.stageType,
    });
  }

  // --- scrap: one record per row ------------------------------------------------------------
  for (const row of input.scrap) {
    const related = input.workOrders.find((w) =>
      moKey(w.normalized.moReference) === moKey(row.normalized.moReference ?? '')
      && (!row.normalized.rawWorkOrder || w.normalized.rawWorkOrder === row.normalized.rawWorkOrder));
    const stage = related?.normalized.workCenter.stageType ?? null;
    const built = scrapPayloadFromRow(row, stage);
    const orphanKinds = orphanKindsOf(link.orphans, row.rowId);
    const validated = applyValidation(createImportRow('odooScrap' as never, row.sourceRow, row.raw, row.rowId), {
      errors: [...row.issues, ...built.errors],
      warnings: [...row.warnings, ...built.warnings],
      normalized: built.payload ? { ...built.payload, workOrderRowId: related?.rowId ?? null } : null,
    });
    staged.push({
      row: validated,
      kind: 'odooScrap',
      sourceType: row.sourceType,
      provenance: row.provenance,
      rawRow: row.raw,
      linkedManufacturingOrder: row.normalized.moReference ?? null,
      linkedRowIds: related ? [related.rowId] : [],
      orphanKinds,
      payload: built.payload ?? undefined,
      targetStage: stage,
    });
  }

  const workCenters = summariseWorkCenters(
    input.workOrders.map((w) => w.normalized.workCenterRaw),
    input.approvedWorkCenters ?? [],
  );

  const counts: Record<string, number> = {
    manufacturingOrders: input.production.length,
    workOrders: input.workOrders.length,
    scrapRows: input.scrap.length,
    productionRowsToWrite: staged.filter((s) => s.kind === 'odooWorkOrder' && s.payload).length,
    linkedWorkOrders: link.counts.linkedWorkOrders ?? 0,
    linkedScrapRows: link.counts.linkedScrapRows ?? 0,
    unresolved: staged.filter((s) => s.orphanKinds.length > 0).length,
    conflicts: link.conflicts.length,
    warnings: staged.filter((s) => s.row.warnings.length > 0).length,
    errors: staged.filter((s) => s.row.errors.length > 0).length,
    skipped: staged.filter((s) => s.row.selection === 'SKIPPED').length,
    excluded: staged.filter((s) => s.row.selection === 'EXCLUDED').length,
    unresolvedWorkCenters: workCenters.filter((w) => w.resolution.status !== 'RESOLVED').length,
  };

  return { importSessionId: input.importSessionId, staged, link, conflicts: link.conflicts, workCenters, counts };
}

/** A manufacturing-order row is context: it is never written, however it is selected. */
export function isOdooRowWritable(staged: OdooStagedRow): boolean {
  if (staged.kind === 'odooProduction') return false;
  if (staged.row.selection !== 'INCLUDED') return false;
  if (staged.row.errors.length > 0) return false;
  if (staged.row.warnings.length > 0 && !staged.row.warningsAccepted) return false;
  if (staged.row.status === 'IMPORTED') return false;
  return Boolean(staged.payload);
}

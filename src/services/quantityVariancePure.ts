/**
 * Standard vs actual consumption - QUANTITY variance - Phase 1 Step 7 (+ 7A).
 * Pure and Firebase-free. READ-ONLY ANALYSIS: nothing here writes, and the
 * result is derived on demand from the record and its references - never stored.
 *
 * STANDARD = the components of the BOM version the record's JOB selected
 * (JobReference.bomVersionId), that exact version: never the item's default
 * BOM, never another ACTIVE version, never a standard BOM in place of a
 * customer one. A RETIRED version still referenced is used as it is; one that
 * no longer exists is an integrity error, never substituted.
 * ACTUAL = the record's own consumption lines (`materials`, Step 5B).
 * VARIANCE = actual - standard, in quantity only. No money, no cost.
 * Routing and genealogy outputs are not a consumption baseline and are not read.
 *
 * NO BASELINE. A record without a job, or whose job has no BOM version, is
 * NO_STANDARD_BOM - still a valid record; no baseline is invented.
 *
 * FORMULA GROUPS (Step 7A). The formula group is part of the comparison
 * identity: BASE BOM lines are compared with BASE actual lines, ADDITIVE with
 * ADDITIVE. The actual group is what the user recorded (absent on historical
 * lines = BASE) - never inferred from the BOM. The same item recorded in the
 * other group than the BOM lists it is FORMULA_TYPE_MISMATCH, never merged into
 * one number. An additive consumed but not in the BOM is OFF_BOM_ADDITIVE.
 *
 * IDENTITY. Both sides go through the shared resolver (logicalItemPure):
 * a mapped product and material are one logical item; an unmapped record keeps
 * its exact (collection, document id). Nothing is matched by name, code or
 * similarity. Where a match cannot be proven either way the rows are
 * UNRESOLVED_ITEM_IDENTITY instead of a guess:
 *   - a line with no item id or an invalid source;
 *   - a line whose stored logicalItemId is not what its source resolves to today
 *     (the mapping changed since it was saved);
 *   - an unmatched unmapped standard item and an unmatched unmapped actual item
 *     from the OTHER item collection - they may be the same physical item that
 *     was never mapped, so neither is called MISSING / OFF_BOM.
 *
 * AGGREGATION (analysis only, sources untouched). Components and lines with the
 * same identity and group are summed per side. A side whose lines disagree on
 * the unit is UNIT_MISMATCH - never converted.
 *
 * UNITS. Standard and actual are compared only in the exact same unit value
 * (bomPure.BOM_UNITS). The project has no approved conversion framework, so a
 * different unit is UNIT_MISMATCH with no numeric variance. The only unit
 * rewrite is a legacy SPELLING of the same unit ("شيكارة" is "شكارة",
 * bomPure.approvedUnitSpelling) - never a factor.
 *
 * STANDARD QUANTITY. A line's stored quantity, or - for a percentage-only line -
 * basis x percentage / 100 (bomPure.bomFormula). Base and additive lines use the
 * same rule.
 *
 * BASIS / SCALING (decided policy). A quantity-only version without a basis is
 * compared as written. A version with percentages or additives needs a basis;
 * without one every comparable row is MISSING_BOM_BASIS - no basis is invented.
 * A version with a basis is scaled by (the record's own production quantity /
 * the basis quantity) - base and additives alike - ONLY when the record's
 * production unit is exactly the basis unit and its quantity is > 0. Otherwise
 * numeric variance is withheld (SCALING_NOT_SUPPORTED) and the missing data is
 * named. Expected yield is not applied.
 */
import type { LogicalItemRecord } from './logicalItemPure';
import { resolveLogicalItemId } from './logicalItemPure';
import { lineLogicalItemKey, lineSource } from './actualConsumptionPure';
import { approvedUnitSpelling, bomFormula, componentTypeOf } from './bomPure';
import type { BomComponentTypeValue } from './bomPure';

export const VARIANCE_STATUSES = [
  'MATCHED',
  'OVER_CONSUMED',
  'UNDER_CONSUMED',
  'MISSING',
  'OFF_BOM',
  'OFF_BOM_ADDITIVE',
  'FORMULA_TYPE_MISMATCH',
  'UNIT_MISMATCH',
  'UNRESOLVED_ITEM_IDENTITY',
  'NO_STANDARD_QUANTITY',
  'INVALID_ACTUAL_QUANTITY',
  'MISSING_BOM_BASIS',
  'SCALING_NOT_SUPPORTED',
] as const;
export type VarianceStatus = (typeof VARIANCE_STATUSES)[number];

export type VarianceReportState = 'COMPARED' | 'NO_STANDARD_BOM' | 'INTEGRITY_ERROR' | 'DATA_NOT_LOADED';
export type BasisState = 'NO_BASIS' | 'SCALED' | 'SCALING_NOT_SUPPORTED';
export type ScalingGap = 'MISSING_BOM_BASIS' | 'INVALID_BASIS' | 'PRODUCTION_QUANTITY_MISSING' | 'PRODUCTION_UNIT_MISSING' | 'UNIT_DIFFERS';

type Stored = Record<string, unknown> & { id?: string };

export interface VarianceMessage {
  code: string;
  messageAr: string;
  messageEn: string;
}

/** What the analysis reads from the production record - nothing else. */
export interface VarianceRecordInput {
  jobReferenceId?: string | null;
  /** The record's actual consumption lines. */
  materials?: ReadonlyArray<object> | null;
  /** The record's own production quantity and unit, as the existing review shows them. */
  productionQuantity?: number | null;
  productionUnit?: string | null;
}

export interface VarianceContext {
  /** Lists as read; null = not loaded. */
  jobs?: readonly Stored[] | null;
  bomVersions?: readonly Stored[] | null;
  boms?: readonly Stored[] | null;
  logicalItems?: readonly LogicalItemRecord[] | null;
  /** Display names only - never used to match. */
  products?: readonly Stored[] | null;
  materials?: readonly Stored[] | null;
}

export interface VarianceRow {
  /** The identity key the item was matched by ('logicalItem:ID' | 'record:source/id' | 'unresolved:...'). */
  key: string;
  /** Step 7A: the formula group of this row - part of the comparison identity. */
  componentType: BomComponentTypeValue;
  identityBasis: 'LOGICAL_ITEM' | 'SOURCE_RECORD' | 'UNRESOLVED';
  logicalItemId: string | null;
  itemSource: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  inBom: boolean;
  actualFound: boolean;
  /** Standard per the version's basis (stored, or derived from the percentage), summed, before scaling. */
  standardQuantity: number | null;
  standardUnit: string | null;
  /** The standard actually compared: as written (no basis) or scaled; null when not calculable. */
  expectedQuantity: number | null;
  actualQuantity: number | null;
  actualUnit: string | null;
  varianceQuantity: number | null;
  variancePercent: number | null;
  status: VarianceStatus;
  bomLineIds: string[];
  consumptionLineIds: string[];
}

export interface VarianceSummary {
  standardItems: number;
  actualItems: number;
  matched: number;
  overConsumed: number;
  underConsumed: number;
  missing: number;
  offBom: number;
  offBomAdditive: number;
  formulaTypeMismatch: number;
  unitMismatch: number;
  unresolvedIdentity: number;
  noStandardQuantity: number;
  invalidActualQuantity: number;
  missingBomBasis: number;
  scalingNotSupported: number;
}

export interface VarianceBasis {
  state: BasisState;
  basisQuantity: number | null;
  basisUnit: string | null;
  productionQuantity: number | null;
  productionUnit: string | null;
  scaleFactor: number | null;
  gap: ScalingGap | null;
}

export interface QuantityVarianceReport {
  state: VarianceReportState;
  message: VarianceMessage | null;
  jobReferenceId: string | null;
  bomVersionId: string | null;
  bomVersionCode: string | null;
  bomVersionStatus: string | null;
  bomId: string | null;
  bomCode: string | null;
  /** The selected BOM's customer scope (null = standard) - shown, never substituted. */
  bomCustomerId: string | null;
  basis: VarianceBasis | null;
  rows: VarianceRow[];
  summary: VarianceSummary;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

const isPositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const byId = (list: readonly Stored[] | null | undefined, id: string) => (list ?? []).find((r) => String(r.id ?? '') === id);

const EMPTY_SUMMARY: VarianceSummary = {
  standardItems: 0, actualItems: 0, matched: 0, overConsumed: 0, underConsumed: 0, missing: 0, offBom: 0, offBomAdditive: 0,
  formulaTypeMismatch: 0, unitMismatch: 0, unresolvedIdentity: 0, noStandardQuantity: 0, invalidActualQuantity: 0, missingBomBasis: 0, scalingNotSupported: 0,
};

function emptyReport(state: VarianceReportState, message: VarianceMessage | null, over: Partial<QuantityVarianceReport> = {}): QuantityVarianceReport {
  return {
    state, message, jobReferenceId: null, bomVersionId: null, bomVersionCode: null, bomVersionStatus: null,
    bomId: null, bomCode: null, bomCustomerId: null, basis: null, rows: [], summary: { ...EMPTY_SUMMARY }, ...over,
  };
}

/** The scaling decision for one version and one record - see the header policy. */
export function resolveVarianceBasis(version: Record<string, unknown>, record: VarianceRecordInput): VarianceBasis {
  const rawBasisQty = version.basisQuantity;
  const basisUnit = approvedUnitSpelling(version.basisUnit) || null;
  const hasBasis = (rawBasisQty !== null && rawBasisQty !== undefined && rawBasisQty !== '') || basisUnit !== null;
  const productionQuantity = typeof record.productionQuantity === 'number' && Number.isFinite(record.productionQuantity) ? record.productionQuantity : null;
  const productionUnit = approvedUnitSpelling(record.productionUnit) || null;
  const base = { basisQuantity: typeof rawBasisQty === 'number' ? rawBasisQty : null, basisUnit, productionQuantity, productionUnit };
  const unsupported = (gap: ScalingGap): VarianceBasis => ({ state: 'SCALING_NOT_SUPPORTED', ...base, scaleFactor: null, gap });
  if (!hasBasis) {
    // Step 7A: percentages and additives only mean something against a basis - none is invented.
    return bomFormula(version).basisRequired ? unsupported('MISSING_BOM_BASIS') : { state: 'NO_BASIS', ...base, scaleFactor: 1, gap: null };
  }
  if (!isPositive(rawBasisQty) || !basisUnit) return unsupported('INVALID_BASIS');
  if (!isPositive(productionQuantity)) return unsupported('PRODUCTION_QUANTITY_MISSING');
  if (!productionUnit) return unsupported('PRODUCTION_UNIT_MISSING');
  if (productionUnit !== basisUnit) return unsupported('UNIT_DIFFERS');
  return { state: 'SCALED', ...base, scaleFactor: productionQuantity / rawBasisQty, gap: null };
}

interface Side {
  key: string;
  type: BomComponentTypeValue;
  source: string;
  itemId: string;
  quantities: unknown[];
  units: Set<string>;
  lineIds: string[];
  code: string;
  name: string;
  /** Standard side: every line has a quantity or a percentage (something to derive from). */
  defined: boolean;
}

const groupKey = (type: BomComponentTypeValue, key: string) => `${type}|${key}`;

function addTo(map: Map<string, Side>, key: string, type: BomComponentTypeValue, source: string, itemId: string, quantity: unknown, unit: string, lineId: string, code = '', name = '', defined = true) {
  const g = groupKey(type, key);
  const side = map.get(g) ?? { key, type, source, itemId, quantities: [], units: new Set<string>(), lineIds: [], code, name, defined: true };
  side.quantities.push(quantity);
  side.units.add(unit);
  if (lineId) side.lineIds.push(lineId);
  if (!side.code && code) side.code = code;
  if (!side.name && name) side.name = name;
  if (!defined) side.defined = false;
  map.set(g, side);
}

/** Summed quantity of a side, or null when any quantity is not a positive number. */
function total(side: Side): number | null {
  if (!side.quantities.every(isPositive)) return null;
  return (side.quantities as number[]).reduce((s, q) => s + q, 0);
}

/**
 * The quantity variance of one production record against its job's selected
 * BOM version. Never mutates anything it is given.
 */
export function analyseQuantityVariance(record: VarianceRecordInput, context: VarianceContext): QuantityVarianceReport {
  const jobReferenceId = text(record.jobReferenceId) || null;
  if (!jobReferenceId) {
    return emptyReport('NO_STANDARD_BOM', { code: 'NO_JOB', messageAr: 'السجل غير مرتبط بأمر شغل - لا يوجد معيار للمقارنة.', messageEn: 'The record has no job reference - there is no standard to compare with.' });
  }
  if (!context.jobs) {
    return emptyReport('DATA_NOT_LOADED', { code: 'JOBS_NOT_LOADED', messageAr: 'تعذر تحميل أوامر الشغل.', messageEn: 'Job references could not be loaded.' }, { jobReferenceId });
  }
  const job = byId(context.jobs, jobReferenceId);
  if (!job) {
    return emptyReport('INTEGRITY_ERROR', { code: 'JOB_NOT_FOUND', messageAr: `أمر الشغل المرجعي (${jobReferenceId}) غير موجود.`, messageEn: `The referenced job (${jobReferenceId}) does not exist.` }, { jobReferenceId });
  }
  const bomVersionId = text(job.bomVersionId) || null;
  if (!bomVersionId) {
    return emptyReport('NO_STANDARD_BOM', { code: 'NO_BOM_VERSION', messageAr: 'أمر الشغل لا يحدد إصدار قائمة مواد - لا يوجد معيار للمقارنة.', messageEn: 'The job has no selected BOM version - there is no standard to compare with.' }, { jobReferenceId });
  }
  if (!context.bomVersions || !context.logicalItems) {
    return emptyReport('DATA_NOT_LOADED', { code: 'BOM_DATA_NOT_LOADED', messageAr: 'تعذر تحميل قوائم المواد أو الأصناف المنطقية.', messageEn: 'BOM versions or logical items could not be loaded.' }, { jobReferenceId, bomVersionId });
  }
  // The exact version the job selected - whatever its status. Never another one.
  const version = byId(context.bomVersions, bomVersionId);
  if (!version) {
    return emptyReport('INTEGRITY_ERROR', { code: 'BOM_VERSION_NOT_FOUND', messageAr: `إصدار قائمة المواد المحدد في أمر الشغل (${bomVersionId}) غير موجود - لم يُستبدل بإصدار آخر.`, messageEn: `The BOM version selected by the job (${bomVersionId}) no longer exists - no other version is substituted.` }, { jobReferenceId, bomVersionId });
  }
  const bom = byId(context.boms, text(version.bomId));
  const logicalItems = context.logicalItems;
  const header = {
    jobReferenceId,
    bomVersionId,
    bomVersionCode: text(version.versionCode) || null,
    bomVersionStatus: text(version.status).toUpperCase() || null,
    bomId: text(version.bomId) || null,
    bomCode: bom ? text(bom.code) || null : null,
    bomCustomerId: bom ? text(bom.customerId) || null : null,
  };
  const basis = resolveVarianceBasis(version, record);
  const formula = bomFormula(version);

  // --- Standard side ---------------------------------------------------------------
  const standard = new Map<string, Side>();
  const components = Array.isArray(version.components) ? (version.components as Array<Record<string, unknown>>) : [];
  const unresolved: VarianceRow[] = [];
  const displayOf = (source: string, id: string) => {
    const r = source === 'products' ? byId(context.products, id) : source === 'materials' ? byId(context.materials, id) : undefined;
    return { code: text(r?.code ?? r?.productCode), name: text(r?.name ?? r?.productName) };
  };
  components.forEach((c, i) => {
    const source = text(c.itemSource);
    const id = text(c.itemId);
    const type = componentTypeOf(c);
    const fl = formula.lines[i];
    if ((source !== 'products' && source !== 'materials') || !id) {
      unresolved.push(unresolvedRow(`unresolved:bom:${text(c.lineId)}`, type, source, id, '', '', { inBom: true, standardQuantity: fl?.effectiveQuantity ?? null, standardUnit: text(c.unit) || null, bomLineIds: [text(c.lineId)] }));
      return;
    }
    const d = displayOf(source, id);
    const defined = Boolean(fl && (fl.quantity !== null || fl.percentage !== null));
    addTo(standard, resolveLogicalItemId(logicalItems, source, id), type, source, id, fl?.effectiveQuantity ?? null, approvedUnitSpelling(c.unit), text(c.lineId), d.code, d.name, defined);
  });

  // --- Actual side ---------------------------------------------------------------------
  const actual = new Map<string, Side>();
  for (const line of (record.materials ?? []) as ReadonlyArray<Record<string, unknown>>) {
    const source = lineSource(line);
    const id = text(line.materialId);
    const lineId = text(line.lineId);
    const stored = text(line.logicalItemId);
    const type = componentTypeOf(line);
    const key = id && (source === 'products' || source === 'materials') ? lineLogicalItemKey(line, logicalItems) : '';
    if (!key || (stored && key !== `logicalItem:${stored}`)) {
      unresolved.push(unresolvedRow(`unresolved:line:${lineId || unresolved.length}`, type, source, id, text(line.materialCode), text(line.materialName), {
        actualFound: true,
        actualQuantity: typeof line.quantity === 'number' ? line.quantity : null,
        actualUnit: text(line.unit) || null,
        consumptionLineIds: lineId ? [lineId] : [],
      }));
      continue;
    }
    const d = displayOf(source, id);
    addTo(actual, key, type, source, id, line.quantity, approvedUnitSpelling(line.unit), lineId, d.code || text(line.materialCode), d.name || text(line.materialName));
  }

  // Identity keys present on each side, whatever the formula group.
  const identities = (m: Map<string, Side>) => new Set([...m.values()].map((s) => s.key));
  const standardKeys = identities(standard);
  const actualKeys = identities(actual);

  // Unmatched unmapped items on opposite sides from different collections cannot be told apart safely.
  const loose = (from: Map<string, Side>, otherKeys: Set<string>) => [...from.values()].filter((s) => !otherKeys.has(s.key) && s.key.startsWith('record:'));
  const ambiguous = new Set<string>();
  for (const s of loose(standard, actualKeys)) for (const a of loose(actual, standardKeys)) if (s.source !== a.source) { ambiguous.add(s.key); ambiguous.add(a.key); }

  const withheld: VarianceStatus = basis.gap === 'MISSING_BOM_BASIS' ? 'MISSING_BOM_BASIS' : 'SCALING_NOT_SUPPORTED';
  const rows: VarianceRow[] = [];
  const groups = [...standard.keys(), ...[...actual.keys()].filter((k) => !standard.has(k))];
  for (const g of groups) {
    const s = standard.get(g);
    const a = actual.get(g);
    const rep = s ?? a!;
    const key = rep.key;
    const standardUnit = s ? (s.units.size === 1 ? [...s.units][0] : null) : null;
    const actualUnit = a ? (a.units.size === 1 ? [...a.units][0] : null) : null;
    const standardQuantity = s ? total(s) : null;
    const actualQuantity = a ? total(a) : null;
    const row: VarianceRow = {
      key,
      componentType: rep.type,
      identityBasis: key.startsWith('logicalItem:') ? 'LOGICAL_ITEM' : 'SOURCE_RECORD',
      logicalItemId: key.startsWith('logicalItem:') ? key.slice('logicalItem:'.length) : null,
      itemSource: rep.source,
      itemId: rep.itemId,
      itemCode: s?.code || a?.code || '',
      itemName: s?.name || a?.name || '',
      inBom: Boolean(s),
      actualFound: Boolean(a),
      standardQuantity,
      standardUnit: s ? standardUnit ?? [...s.units].join(' / ') : null,
      expectedQuantity: null,
      actualQuantity,
      actualUnit: a ? actualUnit ?? [...a.units].join(' / ') : null,
      varianceQuantity: null,
      variancePercent: null,
      status: 'MATCHED',
      bomLineIds: s?.lineIds ?? [],
      consumptionLineIds: a?.lineIds ?? [],
    };
    const expected = standardQuantity !== null && basis.scaleFactor !== null ? standardQuantity * basis.scaleFactor : null;
    // Present on the other side, but only in the other formula group.
    const typeMismatch = (s && !a && actualKeys.has(key)) || (a && !s && standardKeys.has(key));

    if (ambiguous.has(key)) row.status = 'UNRESOLVED_ITEM_IDENTITY';
    else if (typeMismatch) row.status = 'FORMULA_TYPE_MISMATCH';
    else if ((s && s.units.size > 1) || (a && a.units.size > 1)) row.status = 'UNIT_MISMATCH';
    else if (s && !s.defined) row.status = 'NO_STANDARD_QUANTITY';
    else if (!a) { row.status = 'MISSING'; row.expectedQuantity = expected; }
    else if (!s) row.status = a.type === 'ADDITIVE' ? 'OFF_BOM_ADDITIVE' : 'OFF_BOM';
    else if (standardUnit !== actualUnit) row.status = 'UNIT_MISMATCH';
    else if (actualQuantity === null) row.status = 'INVALID_ACTUAL_QUANTITY';
    else if (standardQuantity === null) row.status = basis.gap === 'MISSING_BOM_BASIS' ? 'MISSING_BOM_BASIS' : 'NO_STANDARD_QUANTITY';
    else if (expected === null) row.status = withheld;
    else {
      row.expectedQuantity = expected;
      const variance = actualQuantity - expected;
      // Floating-point noise only (e.g. 0.1 + 0.2) - not a business tolerance.
      const equal = Math.abs(variance) <= 1e-9 * Math.max(1, Math.abs(expected));
      row.varianceQuantity = equal ? 0 : variance;
      row.variancePercent = equal ? 0 : (variance / expected) * 100;
      row.status = equal ? 'MATCHED' : variance > 0 ? 'OVER_CONSUMED' : 'UNDER_CONSUMED';
    }
    rows.push(row);
  }
  rows.push(...unresolved);

  const count = (st: VarianceStatus) => rows.filter((r) => r.status === st).length;
  const summary: VarianceSummary = {
    standardItems: rows.filter((r) => r.inBom).length,
    actualItems: rows.filter((r) => r.actualFound).length,
    matched: count('MATCHED'),
    overConsumed: count('OVER_CONSUMED'),
    underConsumed: count('UNDER_CONSUMED'),
    missing: count('MISSING'),
    offBom: count('OFF_BOM'),
    offBomAdditive: count('OFF_BOM_ADDITIVE'),
    formulaTypeMismatch: count('FORMULA_TYPE_MISMATCH'),
    unitMismatch: count('UNIT_MISMATCH'),
    unresolvedIdentity: count('UNRESOLVED_ITEM_IDENTITY'),
    noStandardQuantity: count('NO_STANDARD_QUANTITY'),
    invalidActualQuantity: count('INVALID_ACTUAL_QUANTITY'),
    missingBomBasis: count('MISSING_BOM_BASIS'),
    scalingNotSupported: count('SCALING_NOT_SUPPORTED'),
  };

  const message = basis.state === 'SCALING_NOT_SUPPORTED' ? scalingMessage(basis) : null;
  return { state: 'COMPARED', message, ...header, basis, rows, summary };
}

function unresolvedRow(key: string, type: BomComponentTypeValue, source: string, id: string, code: string, name: string, over: Partial<VarianceRow>): VarianceRow {
  return {
    key, componentType: type, identityBasis: 'UNRESOLVED', logicalItemId: null, itemSource: source, itemId: id, itemCode: code, itemName: name,
    inBom: false, actualFound: false, standardQuantity: null, standardUnit: null, expectedQuantity: null,
    actualQuantity: null, actualUnit: null, varianceQuantity: null, variancePercent: null,
    status: 'UNRESOLVED_ITEM_IDENTITY', bomLineIds: [], consumptionLineIds: [], ...over,
  };
}

/** Which data is missing for scaling - named, never guessed. */
export function scalingMessage(basis: VarianceBasis): VarianceMessage {
  const b = `${basis.basisQuantity ?? '-'} ${basis.basisUnit ?? ''}`.trim();
  switch (basis.gap) {
    case 'MISSING_BOM_BASIS':
      return { code: 'MISSING_BOM_BASIS', messageAr: 'إصدار قائمة المواد يحتوي نسبًا أو إضافات بدون كمية أساس - لا يمكن حساب الكميات المعيارية. البيانات المطلوبة لهذا الحساب غير متوفرة حاليًا.', messageEn: 'The BOM version has percentages or additives but no basis - standard quantities cannot be calculated. Data required for this calculation is not currently available.' };
    case 'INVALID_BASIS':
      return { code: 'INVALID_BASIS', messageAr: 'أساس الكميات في إصدار قائمة المواد غير مكتمل - لا يمكن حساب الفرق.', messageEn: 'The BOM version basis is incomplete - variance cannot be calculated.' };
    case 'PRODUCTION_QUANTITY_MISSING':
      return { code: 'PRODUCTION_QUANTITY_MISSING', messageAr: `قائمة المواد محسوبة على أساس ${b} لكن كمية الإنتاج في السجل غير متوفرة - البيانات المطلوبة لهذا الحساب غير متوفرة حاليًا.`, messageEn: `The BOM is defined per ${b} but the record has no production quantity - data required for this calculation is not currently available.` };
    case 'PRODUCTION_UNIT_MISSING':
      return { code: 'PRODUCTION_UNIT_MISSING', messageAr: `قائمة المواد محسوبة على أساس ${b} لكن وحدة الإنتاج في السجل غير معروفة - البيانات المطلوبة لهذا الحساب غير متوفرة حاليًا.`, messageEn: `The BOM is defined per ${b} but the record's production unit is unknown - data required for this calculation is not currently available.` };
    case 'UNIT_DIFFERS':
    default:
      return { code: 'UNIT_DIFFERS', messageAr: `قائمة المواد محسوبة على أساس ${b} والإنتاج مسجل بوحدة ${basis.productionUnit ?? '-'} - لا يتم تحويل الوحدات، لذلك لم يُحسب الفرق.`, messageEn: `The BOM is defined per ${b} but production is recorded in ${basis.productionUnit ?? '-'} - units are not converted, so no variance is calculated.` };
  }
}

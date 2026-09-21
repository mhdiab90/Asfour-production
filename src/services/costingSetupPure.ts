/**
 * Costing SETUP - Phase 1 Step 8C. Pure and Firebase-free.
 *
 * Configuration only. Nothing here multiplies, allocates or values anything:
 * it defines what the factory can CONFIGURE so a future costing engine never
 * needs a percentage, a driver or a behaviour hard-coded in application code.
 *
 * ALLOCATION SETUP. One row = "this source cost centre gives cost to this
 * target cost centre, by this method, in this order, during this window".
 *   method PERCENTAGE     an explicit configured percentage (what the historical
 *                         spreadsheet did) - the number is configuration, never code
 *   method DRIVER_BASED   a configured driver (production tons, machine hours,
 *                         labour hours, energy, headcount, or one added later)
 *                         plus the SOURCE that driver's value comes from
 * `sequence` is the step-down order (1, 2, 3...), configurable per window, so a
 * later period may allocate in a different order without touching a closed one.
 * `effectiveFrom`/`effectiveTo` are how the same centre uses one driver in H1
 * and another in H2: the old row stays exactly as it was.
 *
 * DRIVER SOURCE HONESTY. `driverSourceAvailability` reports what this repository
 * can actually supply today (production quantity yes; labour hours and energy
 * per stage no). A driver whose source is not connected is configurable but
 * reported as DRIVER SOURCE NOT AVAILABLE - never filled with an invented value.
 *
 * MATERIAL COST HAS TWO PURPOSES, never one field:
 *   ACTUAL_ISSUE_COST        what the material actually cost when issued - the
 *                            authoritative source is the Odoo average cost import
 *   PRICING_REFERENCE_PRICE  the latest applicable purchase / reference price,
 *                            used for customer pricing studies
 * They may differ at any moment, and neither overwrites the other.
 *
 * ACCOUNT BEHAVIOUR (FIXED / VARIABLE / STUDY_MANUAL / SALARY_MIX) is likewise
 * configuration per account, per window.
 *
 * COST CENTRE != OPERATION != EQUIPMENT. A historical "line" mixes them; this
 * mapping keeps them separate and records how a historical line maps onto an
 * ASFOUR cost centre, operation, equipment (or category) and production line.
 *
 * HISTORICAL RESULTS. `PeriodCostSnapshotReference` is the set of ids a future
 * result must carry to stay reproducible: the period AND its calculation
 * version, the allocation rows used, the BOM and routing versions, the material
 * cost source, and the production scope. A period cost snapshot is a PERIOD
 * level result; a job's cost is accumulated per job / sub-job / batch. The two
 * are reconciled, never merged.
 */
import { effectiveDateIssues } from './versionedSetupPure';
import type { CostingIssue, CostingValidation } from './costingPeriodPure';

type Stored = Record<string, unknown> & { id?: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}
function optionalId(value: unknown): string | null {
  const t = text(value);
  return t === '' ? null : t;
}
function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : NaN;
}

// --- Firestore collections (defined here; created by the app, never migrated) ----------

export const ALLOCATION_SETUP_COLLECTION = 'allocationSetups';
export const ACCOUNT_BEHAVIOR_COLLECTION = 'accountBehaviors';
export const COST_CENTER_MAP_COLLECTION = 'costCenterOperationMap';
export const PERIOD_COST_SNAPSHOT_COLLECTION = 'periodCostSnapshots';

// --- Drivers and their sources ---------------------------------------------------------

export const COST_DRIVERS = [
  'PRODUCTION_TONS',
  'PRODUCTION_PIECES',
  'MACHINE_HOURS',
  'LABOR_HOURS',
  'ENERGY_CONSUMPTION',
  'HEADCOUNT',
  'MANUAL_PERCENTAGE',
  'CUSTOM',
] as const;
export type CostDriverValue = (typeof COST_DRIVERS)[number];

export const DRIVER_SOURCES = [
  'PRODUCTION_RECORDS',
  'EQUIPMENT_RECORDS',
  'LABOR_RECORDS',
  'METER_IMPORT',
  'EMPLOYEE_MASTER',
  'ODOO_IMPORT',
  'EXTERNAL_IMPORT',
  'MANUAL_APPROVED_INPUT',
] as const;
export type DriverSourceValue = (typeof DRIVER_SOURCES)[number];

export type DriverSourceAvailability = 'AVAILABLE' | 'PARTIAL' | 'NOT_AVAILABLE';

/**
 * What each source can supply from THIS repository today - read off the
 * production records and masters, not assumed. A future connector changes only
 * this table.
 */
export const DRIVER_SOURCE_AVAILABILITY: Readonly<Record<DriverSourceValue, { availability: DriverSourceAvailability; noteEn: string; noteAr: string }>> = {
  PRODUCTION_RECORDS: { availability: 'AVAILABLE', noteEn: 'Every stage records its production quantity in a known unit.', noteAr: 'كل مرحلة تسجل كمية إنتاجها بوحدة معروفة.' },
  EQUIPMENT_RECORDS: { availability: 'PARTIAL', noteEn: 'Operating hours exist on most stage records; equipment identity is missing on several stages.', noteAr: 'ساعات التشغيل موجودة في معظم السجلات، لكن هوية المعدة غير مسجلة في عدة مراحل.' },
  LABOR_RECORDS: { availability: 'PARTIAL', noteEn: 'Workers are recorded on Pressing, Rotary Kiln, Mortar, Mixing and Foam; no labour hours per stage.', noteAr: 'العمالة مسجلة في الكبس والفرن الدوار والمونة والخلط والفوم؛ لا توجد ساعات عمل لكل مرحلة.' },
  METER_IMPORT: { availability: 'NOT_AVAILABLE', noteEn: 'Only Rotary Kiln records gas and electricity; there is no meter import.', noteAr: 'الفرن الدوار فقط يسجل الغاز والكهرباء؛ لا يوجد استيراد عدادات.' },
  EMPLOYEE_MASTER: { availability: 'AVAILABLE', noteEn: 'The employee master exists and carries departments.', noteAr: 'بيانات الموظفين موجودة وتحمل الأقسام.' },
  ODOO_IMPORT: { availability: 'NOT_AVAILABLE', noteEn: 'The Odoo Excel import is not built yet (Step 8D).', noteAr: 'استيراد ملفات أودو لم يُبنَ بعد (الخطوة 8D).' },
  EXTERNAL_IMPORT: { availability: 'NOT_AVAILABLE', noteEn: 'No external import path exists for driver values.', noteAr: 'لا يوجد مسار استيراد خارجي لقيم المحركات.' },
  MANUAL_APPROVED_INPUT: { availability: 'AVAILABLE', noteEn: 'A value entered and approved by a user, recorded as configuration.', noteAr: 'قيمة يدخلها المستخدم وتُعتمد وتُسجل كإعداد.' },
};

/** The sources that can serve each driver - configuration, not a calculation. */
export const DRIVER_ALLOWED_SOURCES: Readonly<Record<CostDriverValue, readonly DriverSourceValue[]>> = {
  PRODUCTION_TONS: ['PRODUCTION_RECORDS', 'MANUAL_APPROVED_INPUT', 'EXTERNAL_IMPORT'],
  PRODUCTION_PIECES: ['PRODUCTION_RECORDS', 'MANUAL_APPROVED_INPUT', 'EXTERNAL_IMPORT'],
  MACHINE_HOURS: ['EQUIPMENT_RECORDS', 'PRODUCTION_RECORDS', 'MANUAL_APPROVED_INPUT'],
  LABOR_HOURS: ['LABOR_RECORDS', 'MANUAL_APPROVED_INPUT', 'EXTERNAL_IMPORT'],
  ENERGY_CONSUMPTION: ['METER_IMPORT', 'PRODUCTION_RECORDS', 'MANUAL_APPROVED_INPUT', 'EXTERNAL_IMPORT'],
  HEADCOUNT: ['EMPLOYEE_MASTER', 'MANUAL_APPROVED_INPUT'],
  MANUAL_PERCENTAGE: ['MANUAL_APPROVED_INPUT'],
  CUSTOM: [...DRIVER_SOURCES],
};

/** What a configured driver + source can supply today; the reason is reported, never guessed around. */
export function driverSourceAvailability(driver: unknown, source: unknown): { availability: DriverSourceAvailability; noteEn: string; noteAr: string } {
  const s = text(source).toUpperCase() as DriverSourceValue;
  const known = DRIVER_SOURCE_AVAILABILITY[s];
  if (!known) return { availability: 'NOT_AVAILABLE', noteEn: 'DRIVER SOURCE NOT AVAILABLE - unknown source.', noteAr: 'مصدر المحرك غير متاح - مصدر غير معروف.' };
  const d = text(driver).toUpperCase() as CostDriverValue;
  const allowed = DRIVER_ALLOWED_SOURCES[d];
  if (allowed && !allowed.includes(s)) {
    return { availability: 'NOT_AVAILABLE', noteEn: `DRIVER SOURCE NOT AVAILABLE - ${s} does not serve ${d}.`, noteAr: `مصدر المحرك غير متاح - ${s} لا يخدم ${d}.` };
  }
  return known;
}

// --- Allocation setup -------------------------------------------------------------------

export const ALLOCATION_METHODS = ['PERCENTAGE', 'DRIVER_BASED'] as const;
export type AllocationMethodValue = (typeof ALLOCATION_METHODS)[number];

export function allocationSetupPayloadForSave(input: Record<string, unknown>) {
  return {
    /** Cost-centre CODES - the stable identity of a hierarchy node in this system. */
    sourceCostCenterCode: text(input.sourceCostCenterCode),
    targetCostCenterCode: text(input.targetCostCenterCode),
    method: (text(input.method).toUpperCase() || 'DRIVER_BASED') as AllocationMethodValue,
    driver: optionalId(text(input.driver).toUpperCase()) as CostDriverValue | null,
    driverSource: optionalId(text(input.driverSource).toUpperCase()) as DriverSourceValue | null,
    /** Only for method PERCENTAGE: the configured share, 0 < p <= 100. */
    percentage: optionalNumber(input.percentage),
    /** Step-down order within its window. */
    sequence: optionalNumber(input.sequence),
    effectiveFrom: optionalId(input.effectiveFrom),
    effectiveTo: optionalId(input.effectiveTo),
    notes: text(input.notes),
    active: input.active !== false,
  };
}

export interface AllocationSetupContext {
  editingId?: string | null;
  /** Cost-centre codes that exist; null = not loaded, so codes are not checked here. */
  knownCostCenterCodes?: ReadonlySet<string> | null;
}

const overlaps = (aFrom: string | null, aTo: string | null, bFrom: string | null, bTo: string | null) =>
  (!aTo || !bFrom || bFrom <= aTo) && (!bTo || !aFrom || aFrom <= bTo);

/**
 * Validates one allocation row.
 *   source / target  required, different, and existing cost-centre codes
 *   method           PERCENTAGE needs a percentage; DRIVER_BASED needs a driver
 *                    AND the source that driver's value comes from
 *   sequence         a whole number >= 1, unique per source centre within
 *                    overlapping windows - the step-down order must be decidable
 *   dates            valid, never inverted
 *   duplicates       the same source -> target may not be configured twice for
 *                    overlapping windows
 */
export function validateAllocationSetupForSave(existing: readonly Stored[], draft: Record<string, unknown>, context: AllocationSetupContext = {}): CostingValidation {
  const issues: CostingIssue[] = [];
  const a = allocationSetupPayloadForSave(draft);
  const editingId = context.editingId ?? null;
  const others = existing.filter((e) => String(e.id ?? '') !== String(editingId ?? '') && e.active !== false);

  if (!a.sourceCostCenterCode) issues.push({ field: 'sourceCostCenterCode', messageAr: 'مركز التكلفة المصدر إلزامي.', messageEn: 'The source cost centre is required.' });
  if (!a.targetCostCenterCode) issues.push({ field: 'targetCostCenterCode', messageAr: 'مركز التكلفة المستهدف إلزامي.', messageEn: 'The target cost centre is required.' });
  if (a.sourceCostCenterCode && a.sourceCostCenterCode === a.targetCostCenterCode) {
    issues.push({ field: 'targetCostCenterCode', messageAr: 'لا يمكن توزيع مركز التكلفة على نفسه.', messageEn: 'A cost centre cannot be allocated to itself.' });
  }
  const known = context.knownCostCenterCodes;
  for (const [field, code] of [['sourceCostCenterCode', a.sourceCostCenterCode], ['targetCostCenterCode', a.targetCostCenterCode]] as const) {
    if (code && known && !known.has(code)) {
      issues.push({ field, messageAr: `مركز التكلفة "${code}" غير موجود.`, messageEn: `Cost centre "${code}" does not exist.` });
    }
  }

  if (!(ALLOCATION_METHODS as readonly string[]).includes(a.method)) {
    issues.push({ field: 'method', messageAr: 'طريقة التوزيع غير صالحة.', messageEn: `Invalid allocation method. Allowed: ${ALLOCATION_METHODS.join(', ')}.` });
  } else if (a.method === 'PERCENTAGE') {
    if (!(typeof a.percentage === 'number' && Number.isFinite(a.percentage) && a.percentage > 0 && a.percentage <= 100)) {
      issues.push({ field: 'percentage', messageAr: 'النسبة يجب أن تكون أكبر من صفر وحتى 100.', messageEn: 'The percentage must be greater than 0 and at most 100.' });
    }
  } else {
    if (!a.driver || !(COST_DRIVERS as readonly string[]).includes(a.driver)) {
      issues.push({ field: 'driver', messageAr: 'يجب اختيار محرك تكلفة.', messageEn: `A cost driver is required. Allowed: ${COST_DRIVERS.join(', ')}.` });
    }
    if (!a.driverSource || !(DRIVER_SOURCES as readonly string[]).includes(a.driverSource)) {
      issues.push({ field: 'driverSource', messageAr: 'يجب تحديد مصدر بيانات المحرك.', messageEn: `The driver source is required. Allowed: ${DRIVER_SOURCES.join(', ')}.` });
    } else if (a.driver && !(DRIVER_ALLOWED_SOURCES[a.driver] ?? []).includes(a.driverSource)) {
      issues.push({ field: 'driverSource', messageAr: `المصدر "${a.driverSource}" لا يخدم المحرك "${a.driver}".`, messageEn: `Source "${a.driverSource}" does not serve driver "${a.driver}".` });
    }
  }

  if (!(typeof a.sequence === 'number' && Number.isFinite(a.sequence) && a.sequence >= 1 && Number.isInteger(a.sequence))) {
    issues.push({ field: 'sequence', messageAr: 'ترتيب التوزيع يجب أن يكون رقمًا صحيحًا يبدأ من 1.', messageEn: 'The allocation sequence must be a whole number starting at 1.' });
  }

  issues.push(...effectiveDateIssues(a.effectiveFrom, a.effectiveTo));

  if (a.active && a.sourceCostCenterCode) {
    const sameWindow = others.filter((e) => text(e.sourceCostCenterCode) === a.sourceCostCenterCode && overlaps(a.effectiveFrom, a.effectiveTo, optionalId(e.effectiveFrom), optionalId(e.effectiveTo)));
    const duplicate = sameWindow.find((e) => text(e.targetCostCenterCode) === a.targetCostCenterCode);
    if (duplicate) {
      issues.push({
        field: 'targetCostCenterCode',
        messageAr: `يوجد بالفعل توزيع من "${a.sourceCostCenterCode}" إلى "${a.targetCostCenterCode}" في نفس الفترة.`,
        messageEn: `An allocation from "${a.sourceCostCenterCode}" to "${a.targetCostCenterCode}" already exists for an overlapping period.`,
      });
    }
    const clash = sameWindow.find((e) => optionalNumber(e.sequence) === a.sequence && text(e.targetCostCenterCode) !== a.targetCostCenterCode);
    if (clash && typeof a.sequence === 'number') {
      issues.push({
        field: 'sequence',
        messageAr: `الترتيب ${a.sequence} مستخدم بالفعل لمركز التكلفة "${a.sourceCostCenterCode}" في نفس الفترة.`,
        messageEn: `Sequence ${a.sequence} is already used by cost centre "${a.sourceCostCenterCode}" in an overlapping period.`,
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

/**
 * The allocation rows in force on a date, in step-down order. A row with no
 * dates is always in force; a closed period keeps the rows its own window
 * selected, because the window is what decides - never "the current setup".
 */
export function allocationSetupsForDate(setups: readonly Stored[], date: string): Stored[] {
  const d = text(date);
  return setups
    .filter((s) => s.active !== false)
    .filter((s) => {
      const from = text(s.effectiveFrom);
      const to = text(s.effectiveTo);
      return (!from || !d || from <= d) && (!to || !d || d <= to);
    })
    .sort((a, b) => (optionalNumber(a.sequence) ?? 0) - (optionalNumber(b.sequence) ?? 0) || text(a.sourceCostCenterCode).localeCompare(text(b.sourceCostCenterCode)));
}

/** One audit line for the existing audit log. */
export function describeAllocationSetupChange(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): string {
  const a = allocationSetupPayloadForSave(after);
  const shape = `${a.sourceCostCenterCode} -> ${a.targetCostCenterCode} seq ${a.sequence ?? '-'} ${a.method}${a.method === 'PERCENTAGE' ? ` ${a.percentage ?? '-'}%` : ` ${a.driver ?? '-'} / ${a.driverSource ?? '-'}`} ${a.effectiveFrom ?? '-'}..${a.effectiveTo ?? '-'}`;
  if (!before) return `[ALLOCATION_SETUP_CREATED] ${shape}`;
  const b = allocationSetupPayloadForSave(before);
  const changes: string[] = [];
  for (const f of ['sourceCostCenterCode', 'targetCostCenterCode', 'method', 'driver', 'driverSource', 'percentage', 'sequence', 'effectiveFrom', 'effectiveTo', 'active'] as const) {
    if (String(b[f] ?? '') !== String(a[f] ?? '')) changes.push(`${f} ${String(b[f] ?? '-')} -> ${String(a[f] ?? '-')}`);
  }
  if (b.notes !== a.notes) changes.push('notes changed');
  return `[ALLOCATION_SETUP_UPDATED] ${shape}: ${changes.length ? changes.join('; ') : 'no field changes'}`;
}

// --- Account behaviour --------------------------------------------------------------------

export const ACCOUNT_BEHAVIORS = ['FIXED', 'VARIABLE', 'STUDY_MANUAL', 'SALARY_MIX'] as const;
export type AccountBehaviorValue = (typeof ACCOUNT_BEHAVIORS)[number];

export function accountBehaviorPayloadForSave(input: Record<string, unknown>) {
  return {
    accountCode: text(input.accountCode),
    behavior: (text(input.behavior).toUpperCase() || 'VARIABLE') as AccountBehaviorValue,
    effectiveFrom: optionalId(input.effectiveFrom),
    effectiveTo: optionalId(input.effectiveTo),
    notes: text(input.notes),
    active: input.active !== false,
  };
}

/** An account's behaviour is configuration per window - never hard-coded in costing code. */
export function validateAccountBehaviorForSave(existing: readonly Stored[], draft: Record<string, unknown>, context: { editingId?: string | null; knownAccountCodes?: ReadonlySet<string> | null } = {}): CostingValidation {
  const issues: CostingIssue[] = [];
  const a = accountBehaviorPayloadForSave(draft);
  const others = existing.filter((e) => String(e.id ?? '') !== String(context.editingId ?? '') && e.active !== false);
  if (!a.accountCode) issues.push({ field: 'accountCode', messageAr: 'كود الحساب إلزامي.', messageEn: 'The account code is required.' });
  else if (context.knownAccountCodes && !context.knownAccountCodes.has(a.accountCode)) {
    issues.push({ field: 'accountCode', messageAr: `الحساب "${a.accountCode}" غير موجود.`, messageEn: `Account "${a.accountCode}" does not exist.` });
  }
  if (!(ACCOUNT_BEHAVIORS as readonly string[]).includes(a.behavior)) {
    issues.push({ field: 'behavior', messageAr: 'سلوك الحساب غير صالح.', messageEn: `Invalid account behaviour. Allowed: ${ACCOUNT_BEHAVIORS.join(', ')}.` });
  }
  issues.push(...effectiveDateIssues(a.effectiveFrom, a.effectiveTo));
  if (a.active && a.accountCode && others.some((e) => text(e.accountCode) === a.accountCode && overlaps(a.effectiveFrom, a.effectiveTo, optionalId(e.effectiveFrom), optionalId(e.effectiveTo)))) {
    issues.push({ field: 'accountCode', messageAr: `للحساب "${a.accountCode}" سلوك مُعرّف بالفعل في نفس الفترة.`, messageEn: `Account "${a.accountCode}" already has a behaviour configured for an overlapping period.` });
  }
  return { valid: issues.length === 0, issues };
}

// --- Cost centre <-> operation <-> equipment mapping -------------------------------------

/**
 * A historical "production line" often means a cost centre, an operation and a
 * machine at once. This mapping records how one historical line name maps onto
 * the three ASFOUR concepts, without collapsing them into one.
 */
export function costCenterMapPayloadForSave(input: Record<string, unknown>) {
  return {
    /** The name/code as the historical sheet writes it. */
    historicalLineCode: text(input.historicalLineCode),
    costCenterCode: text(input.costCenterCode),
    operationId: optionalId(input.operationId),
    equipmentCategoryId: optionalId(input.equipmentCategoryId),
    equipmentId: optionalId(input.equipmentId),
    /** The production-line identity this row belongs to, as the factory names it. */
    productionLineCode: text(input.productionLineCode),
    effectiveFrom: optionalId(input.effectiveFrom),
    effectiveTo: optionalId(input.effectiveTo),
    notes: text(input.notes),
    active: input.active !== false,
  };
}

export function validateCostCenterMapForSave(existing: readonly Stored[], draft: Record<string, unknown>, context: { editingId?: string | null; knownCostCenterCodes?: ReadonlySet<string> | null; knownOperationIds?: ReadonlySet<string> | null } = {}): CostingValidation {
  const issues: CostingIssue[] = [];
  const m = costCenterMapPayloadForSave(draft);
  const others = existing.filter((e) => String(e.id ?? '') !== String(context.editingId ?? '') && e.active !== false);
  if (!m.historicalLineCode) issues.push({ field: 'historicalLineCode', messageAr: 'اسم/كود الخط التاريخي إلزامي.', messageEn: 'The historical line code is required.' });
  if (!m.costCenterCode) issues.push({ field: 'costCenterCode', messageAr: 'مركز التكلفة إلزامي.', messageEn: 'The cost centre is required.' });
  else if (context.knownCostCenterCodes && !context.knownCostCenterCodes.has(m.costCenterCode)) {
    issues.push({ field: 'costCenterCode', messageAr: `مركز التكلفة "${m.costCenterCode}" غير موجود.`, messageEn: `Cost centre "${m.costCenterCode}" does not exist.` });
  }
  if (m.operationId && context.knownOperationIds && !context.knownOperationIds.has(m.operationId)) {
    issues.push({ field: 'operationId', messageAr: 'العملية المحددة غير موجودة.', messageEn: 'The selected operation does not exist.' });
  }
  issues.push(...effectiveDateIssues(m.effectiveFrom, m.effectiveTo));
  if (m.active && m.historicalLineCode && others.some((e) => text(e.historicalLineCode) === m.historicalLineCode && overlaps(m.effectiveFrom, m.effectiveTo, optionalId(e.effectiveFrom), optionalId(e.effectiveTo)))) {
    issues.push({ field: 'historicalLineCode', messageAr: `الخط "${m.historicalLineCode}" مرتبط بالفعل في نفس الفترة.`, messageEn: `Line "${m.historicalLineCode}" is already mapped for an overlapping period.` });
  }
  return { valid: issues.length === 0, issues };
}

// --- Material cost: two purposes, never one field ----------------------------------------

export const MATERIAL_COST_PURPOSES = ['ACTUAL_ISSUE_COST', 'PRICING_REFERENCE_PRICE'] as const;
export type MaterialCostPurposeValue = (typeof MATERIAL_COST_PURPOSES)[number];

export const MATERIAL_COST_SOURCES = ['ODOO_AVERAGE_COST', 'LATEST_PURCHASE_PRICE', 'MANUAL_APPROVED_INPUT'] as const;
export type MaterialCostSourceValue = (typeof MATERIAL_COST_SOURCES)[number];

/**
 * Which source may serve which purpose. The actual issue cost is the factory's
 * Odoo average cost; a pricing study uses the latest applicable purchase /
 * reference price. A manually approved value is allowed for either, but only
 * as an explicit, recorded decision.
 */
export const MATERIAL_COST_PURPOSE_SOURCES: Readonly<Record<MaterialCostPurposeValue, readonly MaterialCostSourceValue[]>> = {
  ACTUAL_ISSUE_COST: ['ODOO_AVERAGE_COST', 'MANUAL_APPROVED_INPUT'],
  PRICING_REFERENCE_PRICE: ['LATEST_PURCHASE_PRICE', 'MANUAL_APPROVED_INPUT'],
};

/** The default source of each purpose - the business rule, stated once. */
export const DEFAULT_MATERIAL_COST_SOURCE: Readonly<Record<MaterialCostPurposeValue, MaterialCostSourceValue>> = {
  ACTUAL_ISSUE_COST: 'ODOO_AVERAGE_COST',
  PRICING_REFERENCE_PRICE: 'LATEST_PURCHASE_PRICE',
};

/** Why a source cannot serve a purpose, or an empty list when it can. No amount is read here. */
export function materialCostSourceIssues(purpose: unknown, source: unknown): CostingIssue[] {
  const p = text(purpose).toUpperCase() as MaterialCostPurposeValue;
  const s = text(source).toUpperCase() as MaterialCostSourceValue;
  if (!(MATERIAL_COST_PURPOSES as readonly string[]).includes(p)) {
    return [{ field: 'purpose', messageAr: 'غرض تكلفة المادة غير صالح.', messageEn: `Invalid material cost purpose. Allowed: ${MATERIAL_COST_PURPOSES.join(', ')}.` }];
  }
  if (!(MATERIAL_COST_SOURCES as readonly string[]).includes(s)) {
    return [{ field: 'source', messageAr: 'مصدر تكلفة المادة غير صالح.', messageEn: `Invalid material cost source. Allowed: ${MATERIAL_COST_SOURCES.join(', ')}.` }];
  }
  if (!MATERIAL_COST_PURPOSE_SOURCES[p].includes(s)) {
    return [{
      field: 'source',
      messageAr: `المصدر "${s}" لا يخدم الغرض "${p}" - التكلفة الفعلية من متوسط تكلفة أودو، ودراسة التسعير من أحدث سعر شراء.`,
      messageEn: `Source "${s}" does not serve purpose "${p}" - actual cost comes from the Odoo average cost, a pricing study from the latest purchase price.`,
    }];
  }
  return [];
}

// --- Historical snapshot references -------------------------------------------------------

/**
 * Everything a future costing result must name so it stays reproducible. No
 * amounts: this is the reference set a snapshot document carries.
 */
export interface PeriodCostSnapshotReference {
  periodId: string;
  /** The period's calculation version at the moment of the run. */
  calculationVersion: number;
  /** The allocation rows that were in force, by document id. */
  allocationSetupIds: string[];
  /** The BOM and routing versions used, by document id. */
  bomVersionIds: string[];
  routingVersionIds: string[];
  /** Where material cost came from, per purpose. */
  materialCostSource: MaterialCostSourceValue;
  materialCostPurpose: MaterialCostPurposeValue;
  /** Which production data the run covered. */
  productionScope: { startDate: string; endDate: string; stageTypes: string[] };
  /** Account behaviour and cost-centre mapping rows used, by document id. */
  accountBehaviorIds: string[];
  costCenterMapIds: string[];
}

/** The reference set is complete only when every part names its source. */
export function snapshotReferenceIssues(ref: Partial<PeriodCostSnapshotReference> | null | undefined): CostingIssue[] {
  const issues: CostingIssue[] = [];
  const add = (field: string, ar: string, en: string) => issues.push({ field, messageAr: ar, messageEn: en });
  if (!ref || !text(ref.periodId)) add('periodId', 'اللقطة يجب أن تنتمي إلى فترة.', 'A snapshot must belong to a period.');
  const version = Number(ref?.calculationVersion);
  if (!(Number.isFinite(version) && version >= 1)) add('calculationVersion', 'إصدار الحساب إلزامي.', 'The calculation version is required.');
  if (!ref?.productionScope || !text(ref.productionScope.startDate) || !text(ref.productionScope.endDate)) {
    add('productionScope', 'نطاق بيانات الإنتاج إلزامي.', 'The production data scope is required.');
  }
  if (ref?.materialCostPurpose || ref?.materialCostSource) issues.push(...materialCostSourceIssues(ref?.materialCostPurpose, ref?.materialCostSource));
  else add('materialCostSource', 'مصدر تكلفة المادة إلزامي.', 'The material cost source is required.');
  return issues;
}

/**
 * Whether a stored snapshot belongs to the configuration in force today, or is
 * a historical result that must be read as it was. Current and historical are
 * distinguishable - never silently mixed.
 */
export function isHistoricalSnapshot(ref: Pick<PeriodCostSnapshotReference, 'calculationVersion'>, period: Record<string, unknown>): boolean {
  const current = Number((period as { calculationVersion?: unknown }).calculationVersion ?? 1);
  return Number(ref.calculationVersion) !== (Number.isFinite(current) ? current : 1) || text(period.status).toUpperCase() === 'CLOSED';
}

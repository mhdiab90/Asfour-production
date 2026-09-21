/**
 * Costing periods - Phase 1 Step 8C. Pure and Firebase-free.
 *
 * A costing period is the window a future costing run belongs to, and the thing
 * that makes a historical result reproducible. NOTHING here calculates money:
 * this file defines the period, its lifecycle, and the rule that a CLOSED period
 * never changes quietly.
 *
 * ANY WINDOW. `startDate`..`endDate` are explicit dates in the same YYYY-MM-DD
 * form production records and financial transactions already use, so a month, a
 * quarter, six months, a year or any other agreed window is just two dates.
 * `periodType` names the intent; it never derives the dates.
 *
 * LIFECYCLE. OPEN -> CALCULATED -> REVIEWED -> APPROVED -> CLOSED, each step
 * stamped with who and when. While a period is OPEN its results may be
 * recalculated freely. From CLOSED there is exactly one way back: a REOPEN that
 * demands a reason, is audited, and starts a NEW calculation version - the
 * closed snapshot itself is never edited or deleted.
 *
 * CALCULATION VERSIONS. `calculationVersion` starts at 1 and increases on every
 * reopen. A future costing result carries the period id AND that version, so
 * "what was closed in June" stays answerable after any later recalculation.
 *
 * WHAT A PERIOD IS NOT. Not an accounting journal, not a lock on production
 * entry, and not a job: a job's cost is accumulated per job / sub-job / batch,
 * a period result is a period-level snapshot. They are reconciled later, never
 * merged (see costingSetupPure.ts for the snapshot reference model).
 */
import { effectiveDateIssues } from './versionedSetupPure';

export const COSTING_PERIOD_TYPES = ['MONTH', 'QUARTER', 'HALF_YEAR', 'YEAR', 'CUSTOM'] as const;
export type CostingPeriodTypeValue = (typeof COSTING_PERIOD_TYPES)[number];

export const COSTING_PERIOD_STATUSES = ['OPEN', 'CALCULATED', 'REVIEWED', 'APPROVED', 'CLOSED'] as const;
export type CostingPeriodStatusValue = (typeof COSTING_PERIOD_STATUSES)[number];

/** Firestore collection of costing periods. */
export const COSTING_PERIOD_COLLECTION = 'costingPeriods';

/** Statuses whose stored result must not change in place. */
export const IMMUTABLE_COSTING_PERIOD_STATUSES: readonly CostingPeriodStatusValue[] = ['CLOSED'];

/** Forward lifecycle steps. A reopen is not a transition - it is its own audited action. */
const FORWARD: Record<CostingPeriodStatusValue, readonly CostingPeriodStatusValue[]> = {
  OPEN: ['CALCULATED'],
  CALCULATED: ['REVIEWED', 'OPEN'],
  REVIEWED: ['APPROVED', 'OPEN'],
  APPROVED: ['CLOSED', 'OPEN'],
  CLOSED: [],
};

export interface CostingIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface CostingValidation {
  valid: boolean;
  issues: CostingIssue[];
}

type Stored = Record<string, unknown> & { id?: string };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function optionalId(value: unknown): string | null {
  const t = text(value);
  return t === '' ? null : t;
}

const isStatus = (v: unknown): v is CostingPeriodStatusValue => (COSTING_PERIOD_STATUSES as readonly string[]).includes(text(v).toUpperCase());

/** The exact period document to write. The lifecycle stamps are kept as stored. */
export function costingPeriodPayloadForSave(input: Record<string, unknown>) {
  const version = Number(input.calculationVersion);
  return {
    code: text(input.code),
    name: text(input.name),
    periodType: (text(input.periodType).toUpperCase() || 'MONTH') as CostingPeriodTypeValue,
    startDate: text(input.startDate),
    endDate: text(input.endDate),
    status: (text(input.status).toUpperCase() || 'OPEN') as CostingPeriodStatusValue,
    calculationVersion: Number.isFinite(version) && version >= 1 ? Math.floor(version) : 1,
    notes: text(input.notes),
    active: input.active !== false,
    reviewedBy: optionalId(input.reviewedBy),
    reviewedAt: optionalId(input.reviewedAt),
    approvedBy: optionalId(input.approvedBy),
    approvedAt: optionalId(input.approvedAt),
    closedBy: optionalId(input.closedBy),
    closedAt: optionalId(input.closedAt),
    reopenedBy: optionalId(input.reopenedBy),
    reopenedAt: optionalId(input.reopenedAt),
    reopenReason: text(input.reopenReason),
  };
}

export interface CostingPeriodContext {
  editingId?: string | null;
}

/**
 * Validates a period before the shared write.
 *   code / name  required; the code is unique among periods
 *   dates        both required, valid, start <= end
 *   periodType   one of COSTING_PERIOD_TYPES - a label, never the source of the dates
 *   status       one of COSTING_PERIOD_STATUSES
 *   overlap      two ACTIVE periods may not cover the same day: a production day
 *                belongs to exactly one costing period
 */
export function validateCostingPeriodForSave(existing: readonly Stored[], draft: Record<string, unknown>, context: CostingPeriodContext = {}): CostingValidation {
  const issues: CostingIssue[] = [];
  const p = costingPeriodPayloadForSave(draft);
  const editingId = context.editingId ?? null;
  const others = existing.filter((e) => String(e.id ?? '') !== String(editingId ?? ''));

  if (!p.code) issues.push({ field: 'code', messageAr: 'كود الفترة إلزامي.', messageEn: 'The period code is required.' });
  else if (others.some((e) => text(e.code).toUpperCase() === p.code.toUpperCase())) {
    issues.push({ field: 'code', messageAr: `كود الفترة "${p.code}" مسجل بالفعل.`, messageEn: `Period code "${p.code}" already exists.` });
  }
  if (!p.name) issues.push({ field: 'name', messageAr: 'اسم الفترة إلزامي.', messageEn: 'The period name is required.' });
  if (!(COSTING_PERIOD_TYPES as readonly string[]).includes(p.periodType)) {
    issues.push({ field: 'periodType', messageAr: 'نوع الفترة غير صالح.', messageEn: `Invalid period type. Allowed: ${COSTING_PERIOD_TYPES.join(', ')}.` });
  }
  if (!p.startDate) issues.push({ field: 'startDate', messageAr: 'تاريخ بداية الفترة إلزامي.', messageEn: 'The period start date is required.' });
  if (!p.endDate) issues.push({ field: 'endDate', messageAr: 'تاريخ نهاية الفترة إلزامي.', messageEn: 'The period end date is required.' });
  // The existing effective-date rules: real YYYY-MM-DD dates, never inverted.
  issues.push(...effectiveDateIssues(p.startDate || null, p.endDate || null).map((i) => ({ ...i, field: i.field === 'effectiveFrom' ? 'startDate' : 'endDate' })));
  if (!isStatus(p.status)) {
    issues.push({ field: 'status', messageAr: 'حالة الفترة غير صالحة.', messageEn: `Invalid period status. Allowed: ${COSTING_PERIOD_STATUSES.join(', ')}.` });
  }

  if (p.active && p.startDate && p.endDate && p.startDate <= p.endDate) {
    const clash = others.find((e) => {
      if (e.active === false) return false;
      const s = text(e.startDate);
      const en = text(e.endDate);
      return Boolean(s && en) && s <= p.endDate && p.startDate <= en;
    });
    if (clash) {
      issues.push({
        field: 'startDate',
        messageAr: `الفترة تتداخل مع "${text(clash.code)}" (${text(clash.startDate)} - ${text(clash.endDate)}).`,
        messageEn: `The period overlaps "${text(clash.code)}" (${text(clash.startDate)} - ${text(clash.endDate)}).`,
      });
    }
  }
  return { valid: issues.length === 0, issues };
}

/** Whether a stored period is closed - its results are then read-only. */
export function isCostingPeriodClosed(period: Record<string, unknown> | null | undefined): boolean {
  return (IMMUTABLE_COSTING_PERIOD_STATUSES as readonly string[]).includes(text(period?.status).toUpperCase());
}

/** Fields a CLOSED period keeps frozen; only an audited reopen may change its status. */
const FROZEN_FIELDS = ['code', 'name', 'periodType', 'startDate', 'endDate', 'status', 'calculationVersion', 'active'] as const;

/**
 * What refuses an edit of a stored period. A closed period accepts no field
 * change at all - the way back is `planCostingPeriodReopen`, which is audited
 * and raises the calculation version instead of editing the closed result.
 */
export function costingPeriodEditIssues(before: Record<string, unknown> | null | undefined, draft: Record<string, unknown>): CostingIssue[] {
  if (!before || !isCostingPeriodClosed(before)) return [];
  const b = costingPeriodPayloadForSave(before);
  const a = costingPeriodPayloadForSave(draft);
  const changed = FROZEN_FIELDS.filter((f) => String(b[f] ?? '') !== String(a[f] ?? ''));
  if (changed.length === 0) return [];
  return [{
    field: changed[0],
    messageAr: `الفترة "${b.code}" مقفلة - لا تتغير نتائجها. استخدم إعادة الفتح الموثقة لإنشاء إصدار حساب جديد.`,
    messageEn: `Period "${b.code}" is closed - its result never changes. Use the audited reopen to start a new calculation version.`,
  }];
}

export interface LifecycleActor {
  userId?: string | null;
  at?: string | null;
}

/**
 * The patch for a lifecycle step, or the issue that refuses it. Only the
 * status and its own stamp change; nothing else is touched.
 */
export function planCostingPeriodTransition(period: Record<string, unknown>, next: string, actor: LifecycleActor = {}): { valid: boolean; issues: CostingIssue[]; patch: Record<string, unknown> } {
  const from = text(period.status).toUpperCase();
  const to = text(next).toUpperCase();
  const refuse = (ar: string, en: string): { valid: boolean; issues: CostingIssue[]; patch: Record<string, unknown> } => ({ valid: false, issues: [{ field: 'status', messageAr: ar, messageEn: en }], patch: {} });
  if (!isStatus(from)) return refuse('حالة الفترة الحالية غير صالحة.', 'The period has an invalid current status.');
  if (!isStatus(to)) return refuse('الحالة المطلوبة غير صالحة.', `Invalid target status. Allowed: ${COSTING_PERIOD_STATUSES.join(', ')}.`);
  if (from === 'CLOSED') {
    return refuse('الفترة مقفلة - استخدم إعادة الفتح الموثقة.', 'The period is closed - use the audited reopen instead.');
  }
  if (!FORWARD[from as CostingPeriodStatusValue].includes(to as CostingPeriodStatusValue)) {
    return refuse(`لا يمكن الانتقال من ${from} إلى ${to}.`, `A period cannot move from ${from} to ${to}.`);
  }
  const by = optionalId(actor.userId);
  const at = optionalId(actor.at);
  const stamp: Record<string, unknown> = { status: to };
  if (to === 'REVIEWED') { stamp.reviewedBy = by; stamp.reviewedAt = at; }
  if (to === 'APPROVED') { stamp.approvedBy = by; stamp.approvedAt = at; }
  if (to === 'CLOSED') { stamp.closedBy = by; stamp.closedAt = at; }
  return { valid: true, issues: [], patch: stamp };
}

/**
 * Reopening a CLOSED period: allowed only with a reason, recorded with who and
 * when, and it raises `calculationVersion` so the closed result stays readable
 * under its own version instead of being overwritten.
 */
export function planCostingPeriodReopen(period: Record<string, unknown>, reason: string, actor: LifecycleActor = {}): { valid: boolean; issues: CostingIssue[]; patch: Record<string, unknown> } {
  const issues: CostingIssue[] = [];
  if (!isCostingPeriodClosed(period)) {
    issues.push({ field: 'status', messageAr: 'إعادة الفتح تخص الفترات المقفلة فقط.', messageEn: 'Only a closed period can be reopened.' });
  }
  const why = text(reason);
  if (!why) issues.push({ field: 'reopenReason', messageAr: 'سبب إعادة الفتح إلزامي.', messageEn: 'A reason for reopening is required.' });
  if (issues.length > 0) return { valid: false, issues, patch: {} };
  const current = costingPeriodPayloadForSave(period).calculationVersion;
  return {
    valid: true,
    issues: [],
    patch: {
      status: 'OPEN' as CostingPeriodStatusValue,
      calculationVersion: current + 1,
      reopenReason: why,
      reopenedBy: optionalId(actor.userId),
      reopenedAt: optionalId(actor.at),
    },
  };
}

/** The period a date belongs to: at most one active period covers any day. */
export function costingPeriodForDate(periods: readonly Stored[], date: string): Stored | null {
  const d = text(date);
  if (!d) return null;
  return periods.find((p) => p.active !== false && text(p.startDate) <= d && d <= text(p.endDate)) ?? null;
}

/** One audit line for the existing audit log - what changed on a period. */
export function describeCostingPeriodChange(before: Record<string, unknown> | null | undefined, after: Record<string, unknown>): string {
  const a = costingPeriodPayloadForSave(after);
  if (!before) return `[COSTING_PERIOD_CREATED] ${a.code} - ${a.name} ${a.startDate}..${a.endDate} (${a.periodType}, ${a.status}, v${a.calculationVersion})`;
  const b = costingPeriodPayloadForSave(before);
  const changes: string[] = [];
  for (const f of ['code', 'name', 'periodType', 'startDate', 'endDate', 'status', 'calculationVersion', 'active'] as const) {
    if (String(b[f] ?? '') !== String(a[f] ?? '')) changes.push(`${f} ${String(b[f] ?? '-')} -> ${String(a[f] ?? '-')}`);
  }
  if (b.reopenReason !== a.reopenReason && a.reopenReason) changes.push(`reopened: ${a.reopenReason}`);
  if (b.notes !== a.notes) changes.push('notes changed');
  const tag = b.status !== a.status
    ? a.status === 'CLOSED' ? '[COSTING_PERIOD_CLOSED]' : b.status === 'CLOSED' ? '[COSTING_PERIOD_REOPENED]' : '[COSTING_PERIOD_STATUS]'
    : '[COSTING_PERIOD_UPDATED]';
  return `${tag} ${a.code}: ${changes.length ? changes.join('; ') : 'no field changes'}`;
}

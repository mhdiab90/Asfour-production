/**
 * Versioned setup records - the shared lifecycle, dates and ordered lines.
 * Pure and Firebase-free. Phase 1 Step 3 (extracted from the Step 2 BOM rules).
 *
 * Bills of Materials and Routings are both a header plus independently
 * versioned revisions holding an ordered list of lines. The rules that make
 * such a revision safe to keep and reference are identical, so they live here
 * once and bomPure / routingPure use them:
 *
 *   LIFECYCLE   DRAFT -> ACTIVE -> RETIRED; a draft may also be retired unused.
 *               RETIRED is final and ACTIVE never returns to DRAFT. Only a DRAFT
 *               may be edited. Nothing is deleted.
 *   ONE ACTIVE  at most one ACTIVE revision per parent; a second activation is
 *               refused with the active one named, never resolved automatically.
 *   DATES       optional effective dates are real YYYY-MM-DD dates, never inverted.
 *   LINES       every line has a stable `lineId` (L1, L2, ... never reused) and a
 *               `sequence`; stored order is renumbered 1..n.
 *
 * The domain rules - what a BOM component or a routing step may contain - stay
 * in their own modules.
 */

export const SETUP_VERSION_STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export type SetupVersionStatus = (typeof SETUP_VERSION_STATUSES)[number];

export interface SetupIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

const TRANSITIONS: Record<SetupVersionStatus, readonly SetupVersionStatus[]> = {
  DRAFT: ['ACTIVE', 'RETIRED'],
  ACTIVE: ['RETIRED'],
  RETIRED: [],
};

export function isSetupVersionStatus(value: unknown): value is SetupVersionStatus {
  return (SETUP_VERSION_STATUSES as readonly string[]).includes(text(value).toUpperCase());
}

/** Lines and header fields may change only while a version is a draft. */
export function isVersionEditable(version: Record<string, unknown> | null | undefined): boolean {
  return text(version?.status).toUpperCase() === 'DRAFT';
}

/** The lifecycle check alone; null when `current -> next` is allowed. */
export function versionTransitionIssue(current: unknown, next: unknown): SetupIssue | null {
  const from = text(current).toUpperCase() as SetupVersionStatus;
  const to = text(next).toUpperCase() as SetupVersionStatus;
  if ((TRANSITIONS[from] ?? []).includes(to)) return null;
  return { field: 'status', messageAr: `لا يمكن نقل الإصدار من ${from} إلى ${to}.`, messageEn: `A version cannot move from ${from} to ${to}.` };
}

/** Another ACTIVE version of the same parent, if one exists. */
export function findOtherActiveVersion<T extends Record<string, unknown> & { id?: string }>(
  versions: readonly T[],
  parentField: string,
  version: Record<string, unknown> & { id?: string },
): T | undefined {
  return versions.find(
    (e) => text(e[parentField]) === text(version[parentField]) && String(e.id ?? '') !== String(version.id ?? '') && text(e.status).toUpperCase() === 'ACTIVE',
  );
}

export function otherActiveVersionIssue(versionCode: unknown): SetupIssue {
  return {
    field: 'status',
    messageAr: `الإصدار "${text(versionCode)}" نشط بالفعل. أوقفه (Retire) أولًا ثم فعّل هذا الإصدار.`,
    messageEn: `Version "${text(versionCode)}" is already active. Retire it first, then activate this one.`,
  };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD form (2026-02-30 is not). */
export function isValidIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Issues for optional effective dates: each must be valid, and the end never before the start. */
export function effectiveDateIssues(effectiveFrom: string | null, effectiveTo: string | null): SetupIssue[] {
  const issues: SetupIssue[] = [];
  for (const [field, value] of [['effectiveFrom', effectiveFrom], ['effectiveTo', effectiveTo]] as const) {
    if (value && !isValidIsoDate(value)) {
      issues.push({ field, messageAr: 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD.', messageEn: 'Dates must be valid YYYY-MM-DD dates.' });
    }
  }
  if (effectiveFrom && effectiveTo && isValidIsoDate(effectiveFrom) && isValidIsoDate(effectiveTo) && effectiveFrom > effectiveTo) {
    issues.push({ field: 'effectiveTo', messageAr: 'تاريخ الانتهاء يجب ألا يسبق تاريخ البدء.', messageEn: 'The effective end date cannot be before the start date.' });
  }
  return issues;
}

/** Lines ordered by sequence and renumbered 1..n - the stored order. */
export function normaliseSequences<T extends { sequence: number }>(lines: readonly T[]): T[] {
  return [...lines]
    .map((c, index) => ({ c, index }))
    .sort((a, b) => (Number(a.c.sequence) || 0) - (Number(b.c.sequence) || 0) || a.index - b.index)
    .map(({ c }, i) => ({ ...c, sequence: i + 1 }));
}

/** Moves one line up or down and renumbers. Unknown lines and moves past either end change nothing. */
export function moveLine<T extends { lineId: string; sequence: number }>(lines: readonly T[], lineId: string, direction: 'up' | 'down'): T[] {
  const ordered = normaliseSequences(lines);
  const from = ordered.findIndex((c) => c.lineId === lineId);
  const to = direction === 'up' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= ordered.length) return ordered;
  const next = [...ordered];
  [next[from], next[to]] = [next[to], next[from]];
  return next.map((c, i) => ({ ...c, sequence: i + 1 }));
}

/** A line id unique within the version: L1, L2, ... after the highest existing one. */
export function nextLineId(lines: ReadonlyArray<{ lineId?: string }>): string {
  const max = lines.reduce((m, c) => {
    const n = /^L(\d+)$/.exec(text(c.lineId));
    return n ? Math.max(m, Number(n[1])) : m;
  }, 0);
  return `L${max + 1}`;
}

/** Issues for the line ids and sequences of one version, with 1-based line numbers in the messages. */
export function lineIdentityIssues(lines: ReadonlyArray<{ lineId: string; sequence: number }>, fieldPrefix: string): SetupIssue[] {
  const issues: SetupIssue[] = [];
  const ids = new Set<string>();
  const sequences = new Set<number>();
  lines.forEach((l, i) => {
    const n = i + 1;
    if (!l.lineId) issues.push({ field: `${fieldPrefix}.lineId`, messageAr: `السطر ${n}: معرّف السطر مفقود.`, messageEn: `Line ${n}: missing line id.` });
    else if (ids.has(l.lineId)) issues.push({ field: `${fieldPrefix}.lineId`, messageAr: `السطر ${n}: معرّف السطر مكرر.`, messageEn: `Line ${n}: duplicate line id.` });
    ids.add(l.lineId);
    if (!(Number.isInteger(l.sequence) && l.sequence >= 1)) {
      issues.push({ field: `${fieldPrefix}.sequence`, messageAr: `السطر ${n}: الترتيب يجب أن يكون عددًا صحيحًا موجبًا.`, messageEn: `Line ${n}: sequence must be a positive whole number.` });
    } else if (sequences.has(l.sequence)) {
      issues.push({ field: `${fieldPrefix}.sequence`, messageAr: `السطر ${n}: الترتيب مكرر.`, messageEn: `Line ${n}: duplicate sequence.` });
    }
    sequences.add(l.sequence);
  });
  return issues;
}

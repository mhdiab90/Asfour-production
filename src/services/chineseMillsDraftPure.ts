/**
 * Chinese Mills Historical Import Draft - pure serialization + localStorage
 * I/O, no audit logging (so no Firebase import at all - see
 * chineseMillsDraftStorage.ts's header comment for why localStorage rather
 * than a new Firestore collection). Unit-testable via `npx tsx` with a
 * simple in-memory `window.localStorage` mock - see scripts/tests/.
 * chineseMillsDraftStorage.ts wraps these with the existing logAuditAction()
 * calls and is the one everything else in the app should import.
 */
import { ChineseMillsImportRow, ChineseMillsImportSummary } from '../types';

export interface ChineseMillsDraft {
  id: string;
  stage: 'chinese_mills';
  fileName: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  rows: ChineseMillsImportRow[];
  summary: Omit<ChineseMillsImportSummary, 'rows'>;
}

const STORAGE_PREFIX = 'asfour.chineseMillsDraft.';

/** One draft slot per user per browser - saving again overwrites the previous draft for that user, matching "a Draft" (singular) in the task spec rather than an unbounded draft list. */
export function storageKey(userEmail: string): string {
  return `${STORAGE_PREFIX}${userEmail || 'anonymous'}`;
}

/** Pure serialization (no storage access) - the id and createdAt are carried over from `existing` so re-saving updates the SAME draft rather than creating a new one. */
export function buildDraft(
  fileName: string,
  rows: ChineseMillsImportRow[],
  summary: Omit<ChineseMillsImportSummary, 'rows'>,
  userEmail: string,
  existing?: ChineseMillsDraft | null
): ChineseMillsDraft {
  const now = new Date().toISOString();
  return {
    id: existing?.id || `CM-DRAFT-${Date.now()}`,
    stage: 'chinese_mills',
    fileName,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    createdBy: userEmail || 'unknown',
    rows,
    summary,
  };
}

export type SaveDraftOutcome = { ok: true; draft: ChineseMillsDraft } | { ok: false; error: 'STORAGE_UNAVAILABLE' | 'STORAGE_QUOTA_EXCEEDED' };

export function getDraftLocal(userEmail: string): ChineseMillsDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userEmail));
    if (!raw) return null;
    return JSON.parse(raw) as ChineseMillsDraft;
  } catch {
    return null;
  }
}

export function saveDraftLocal(
  fileName: string,
  rows: ChineseMillsImportRow[],
  summary: Omit<ChineseMillsImportSummary, 'rows'>,
  userEmail: string
): SaveDraftOutcome {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: false, error: 'STORAGE_UNAVAILABLE' };
  }
  try {
    const existing = getDraftLocal(userEmail);
    const draft = buildDraft(fileName, rows, summary, userEmail, existing);
    window.localStorage.setItem(storageKey(userEmail), JSON.stringify(draft));
    return { ok: true, draft };
  } catch {
    return { ok: false, error: 'STORAGE_QUOTA_EXCEEDED' };
  }
}

/** Returns the draft that was deleted (or null if there wasn't one) so the caller can decide whether an audit entry is warranted. */
export function deleteDraftLocal(userEmail: string): ChineseMillsDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const existing = getDraftLocal(userEmail);
  window.localStorage.removeItem(storageKey(userEmail));
  return existing;
}

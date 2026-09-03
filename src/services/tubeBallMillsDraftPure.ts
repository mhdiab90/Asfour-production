/**
 * Tube/Ball Mills Historical Import Draft - pure serialization + localStorage
 * I/O. Mirrors chineseMillsDraftPure.ts exactly - see that file's header for
 * why localStorage (no Firestore Rules changes in this task) rather than a
 * new Firestore collection. Unit-testable via `npx tsx`.
 */
import { TubeBallMillsImportRow, TubeBallMillsImportSummary } from '../types';

export interface TubeBallMillsDraft {
  id: string;
  stage: 'tube_ball_mills';
  fileName: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  rows: TubeBallMillsImportRow[];
  summary: Omit<TubeBallMillsImportSummary, 'rows'>;
}

const STORAGE_PREFIX = 'asfour.tubeBallMillsDraft.';

export function storageKey(userEmail: string): string {
  return `${STORAGE_PREFIX}${userEmail || 'anonymous'}`;
}

export function buildDraft(
  fileName: string,
  rows: TubeBallMillsImportRow[],
  summary: Omit<TubeBallMillsImportSummary, 'rows'>,
  userEmail: string,
  existing?: TubeBallMillsDraft | null
): TubeBallMillsDraft {
  const now = new Date().toISOString();
  return {
    id: existing?.id || `TBM-DRAFT-${Date.now()}`,
    stage: 'tube_ball_mills',
    fileName,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    createdBy: userEmail || 'unknown',
    rows,
    summary,
  };
}

export type SaveDraftOutcome = { ok: true; draft: TubeBallMillsDraft } | { ok: false; error: 'STORAGE_UNAVAILABLE' | 'STORAGE_QUOTA_EXCEEDED' };

export function getDraftLocal(userEmail: string): TubeBallMillsDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userEmail));
    if (!raw) return null;
    return JSON.parse(raw) as TubeBallMillsDraft;
  } catch {
    return null;
  }
}

export function saveDraftLocal(
  fileName: string,
  rows: TubeBallMillsImportRow[],
  summary: Omit<TubeBallMillsImportSummary, 'rows'>,
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

export function deleteDraftLocal(userEmail: string): TubeBallMillsDraft | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const existing = getDraftLocal(userEmail);
  window.localStorage.removeItem(storageKey(userEmail));
  return existing;
}

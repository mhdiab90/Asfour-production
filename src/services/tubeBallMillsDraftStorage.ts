/**
 * Tube/Ball Mills Historical Import - Draft save/reopen/delete.
 * Mirrors chineseMillsDraftStorage.ts exactly - see that file's header for
 * the localStorage-not-Firestore reasoning. Audit trail reuses the EXISTING
 * logAuditAction()/auditLogs collection - no second audit mechanism.
 */
import { TubeBallMillsImportRow, TubeBallMillsImportSummary } from '../types';
import { logAuditAction } from './auditService';
import {
  TubeBallMillsDraft,
  SaveDraftOutcome,
  getDraftLocal,
  saveDraftLocal,
  deleteDraftLocal,
} from './tubeBallMillsDraftPure';

export type { TubeBallMillsDraft, SaveDraftOutcome };

export function getDraft(userEmail: string): TubeBallMillsDraft | null {
  return getDraftLocal(userEmail);
}

export function saveDraft(
  fileName: string,
  rows: TubeBallMillsImportRow[],
  summary: Omit<TubeBallMillsImportSummary, 'rows'>,
  userEmail: string
): SaveDraftOutcome {
  const outcome = saveDraftLocal(fileName, rows, summary, userEmail);
  if (outcome.ok) {
    logAuditAction('UPDATE', 'historicalImportSession', outcome.draft.id, `[DRAFT_SAVED] استيراد الطواحين الأنبوبية والكرات - ${outcome.draft.rows.length} صف - الملف: ${fileName}`).catch(() => {});
  }
  return outcome;
}

export function deleteDraft(userEmail: string): void {
  const deleted = deleteDraftLocal(userEmail);
  if (deleted) {
    logAuditAction('DELETE', 'historicalImportSession', deleted.id, `[DRAFT_DELETED] استيراد الطواحين الأنبوبية والكرات - ${deleted.rows.length} صف - الملف: ${deleted.fileName}`).catch(() => {});
  }
}

export function logDraftOpened(draft: TubeBallMillsDraft): void {
  logAuditAction('UPDATE', 'historicalImportSession', draft.id, `[DRAFT_OPENED] استيراد الطواحين الأنبوبية والكرات - ${draft.rows.length} صف - الملف: ${draft.fileName}`).catch(() => {});
}

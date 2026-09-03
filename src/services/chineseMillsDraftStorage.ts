/**
 * Chinese Mills Historical Import - Draft save/reopen/delete.
 *
 * IMPORTANT ARCHITECTURE NOTE: there is no existing Firestore-backed
 * "import session" persistence to reuse - `historicalImportSession` is only
 * a label passed to logAuditAction (an audit-trail tag), never a collection
 * that stores row/decision state. Firestore's security rules default-deny
 * any collection not explicitly listed (`match /{document=**} { allow read,
 * write: if false; }` in firestore.rules), and this task explicitly
 * forbids modifying Firestore Rules/architecture. A brand-new Firestore
 * collection for drafts is therefore not available without a rules change
 * outside this task's scope.
 *
 * Drafts are instead persisted to the browser's localStorage, namespaced per
 * signed-in user + import stage (chineseMillsDraftPure.ts). This is LOCAL TO
 * THE BROWSER/DEVICE the draft was saved on - it does not sync across
 * devices or users. That limitation is a direct consequence of the "do not
 * touch Firestore Rules" constraint, not an oversight; report it as a known
 * gap if cross-device drafts are wanted later (would need a rules change, a
 * separate task).
 *
 * Audit trail: every save/delete still goes through the EXISTING
 * logAuditAction() against the EXISTING auditLogs collection (already
 * covered by Firestore Rules, already used by every other action in this
 * screen) - no second audit mechanism.
 */
import { ChineseMillsImportRow, ChineseMillsImportSummary } from '../types';
import { logAuditAction } from './auditService';
import {
  ChineseMillsDraft,
  SaveDraftOutcome,
  getDraftLocal,
  saveDraftLocal,
  deleteDraftLocal,
} from './chineseMillsDraftPure';

export type { ChineseMillsDraft, SaveDraftOutcome };

export function getDraft(userEmail: string): ChineseMillsDraft | null {
  return getDraftLocal(userEmail);
}

export function saveDraft(
  fileName: string,
  rows: ChineseMillsImportRow[],
  summary: Omit<ChineseMillsImportSummary, 'rows'>,
  userEmail: string
): SaveDraftOutcome {
  const outcome = saveDraftLocal(fileName, rows, summary, userEmail);
  if (outcome.ok) {
    logAuditAction('UPDATE', 'historicalImportSession', outcome.draft.id, `[DRAFT_SAVED] استيراد الطواحين الصينية - ${outcome.draft.rows.length} صف - الملف: ${fileName}`).catch(() => {});
  }
  return outcome;
}

export function deleteDraft(userEmail: string): void {
  const deleted = deleteDraftLocal(userEmail);
  if (deleted) {
    logAuditAction('DELETE', 'historicalImportSession', deleted.id, `[DRAFT_DELETED] استيراد الطواحين الصينية - ${deleted.rows.length} صف - الملف: ${deleted.fileName}`).catch(() => {});
  }
}

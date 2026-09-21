/**
 * Translation Override Layer (§4/§11/§12/§15 of the localization task).
 *
 * "Default Translation + Admin Translation Override" - the source
 * dictionaries (ar.ts/en.ts) are NEVER rewritten by an admin edit. Instead,
 * each override is one document in the `translationOverrides` Firestore
 * collection, doc id `${language}__${key}`, and LanguageContext.tsx layers
 * it on top of the static dictionary at read time: override -> default ->
 * key. This is a genuinely shared, cross-user setting (unlike the Dashboard
 * Builder's per-user localStorage layout), so it belongs in Firestore, not
 * localStorage - "use the existing system configuration architecture...
 * otherwise create a dedicated translation override collection using the
 * project's existing secure architecture" (§12).
 *
 * History reuses the EXISTING auditLogs collection/service exactly the way
 * Master Data Edit History already does (auditService.ts's
 * fetchAuditLogsForDocument) - no second history mechanism.
 */
import { collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { logAuditAction, fetchAuditLogsForDocument } from './auditService';
import { Language } from '../i18n/types';
import { AuditLog } from '../types';

const COLLECTION = 'translationOverrides';

export interface TranslationOverrideDoc {
  key: string;
  language: Language;
  value: string;
  reason?: string;
  updatedBy: string;
  updatedByName: string;
  updatedAt: string;
}

function docId(key: string, language: Language): string {
  return `${language}__${key}`;
}

/** Live-subscribes to every override, keyed `${language}__${key}` -> value, for LanguageContext to layer on top of ar.ts/en.ts. */
export function subscribeTranslationOverrides(
  onUpdate: (overrides: Record<string, TranslationOverrideDoc>) => void,
  onError?: (err: any) => void
): () => void {
  return onSnapshot(
    collection(db, COLLECTION),
    (snapshot) => {
      const map: Record<string, TranslationOverrideDoc> = {};
      snapshot.forEach((d) => {
        map[d.id] = d.data() as TranslationOverrideDoc;
      });
      onUpdate(map);
    },
    (err) => {
      console.warn('Translation overrides subscription warning:', err);
      if (onError) onError(err);
    }
  );
}

export async function setTranslationOverride(
  key: string,
  language: Language,
  value: string,
  oldValue: string,
  reason?: string
): Promise<void> {
  const currentUser = auth.currentUser;
  const id = docId(key, language);
  const payload: TranslationOverrideDoc = {
    key,
    language,
    value,
    reason: reason || '',
    updatedBy: currentUser?.uid || '',
    updatedByName: currentUser?.email || 'Admin',
    updatedAt: new Date().toISOString(),
  };
  await setDoc(doc(db, COLLECTION, id), { ...payload, serverTime: serverTimestamp() });
  await logAuditAction(
    'TRANSLATION_OVERRIDE_SET',
    COLLECTION,
    id,
    JSON.stringify({ key, language, oldValue, newValue: value, reason: reason || '' })
  );
}

export async function restoreDefaultTranslation(key: string, language: Language, oldValue: string): Promise<void> {
  const id = docId(key, language);
  await deleteDoc(doc(db, COLLECTION, id));
  await logAuditAction(
    'TRANSLATION_OVERRIDE_RESTORE',
    COLLECTION,
    id,
    JSON.stringify({ key, language, oldValue, newValue: null })
  );
}

/** Reuses the exact same auditLogs-by-documentId lookup Master Data Edit History uses (auditService.ts). */
export async function getTranslationHistory(key: string, language: Language): Promise<AuditLog[]> {
  return fetchAuditLogsForDocument(COLLECTION, docId(key, language));
}

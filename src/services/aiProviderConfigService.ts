/**
 * Central AI Provider Manager - persistence layer. The active provider
 * selection is application CONFIGURATION, stored in the existing Firestore
 * settings pattern (a single document, same shape as system_settings/
 * branding), never hardcoded per-component. Firestore rules
 * (aiProviderConfig/{docId}) restrict writes to the granular
 * 'system.aiProvider.manage' permission - this service performs no
 * authorization of its own, it relies entirely on those rules plus the
 * application-layer hasPermission() check the Admin screen already runs.
 *
 * Every change is also written to the EXISTING auditLogs mechanism (§35) -
 * no parallel audit system.
 */
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { AIProviderId } from '../assistant/config';
import { logAuditAction } from './auditService';
import { createSharedListener } from './sharedListenerPure';

const CONFIG_DOC_PATH = 'aiProviderConfig/active';

export interface ActiveProviderConfig {
  activeProvider: AIProviderId;
  updatedByUid?: string;
  updatedByName?: string;
  updatedAt?: string;
  reason?: string;
}

export async function fetchActiveProviderConfig(): Promise<ActiveProviderConfig | null> {
  const snap = await getDoc(doc(db, CONFIG_DOC_PATH));
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    activeProvider: (data.activeProvider as AIProviderId) || 'mock',
    updatedByUid: data.updatedByUid,
    updatedByName: data.updatedByName,
    updatedAt: data.updatedAt,
    reason: data.reason,
  };
}

function parseActiveProviderDoc(data: Record<string, any>): ActiveProviderConfig {
  return {
    activeProvider: (data.activeProvider as AIProviderId) || 'mock',
    updatedByUid: data.updatedByUid,
    updatedByName: data.updatedByName,
    updatedAt: data.updatedAt,
    reason: data.reason,
  };
}

/**
 * PHASE 4E - App.tsx (always, for the whole authenticated session - the
 * Global Assistant's runtime provider) and AIProviderManagementView.tsx
 * (only while that admin screen is mounted) both previously called
 * subscribeActiveProviderConfig() independently, each creating its OWN
 * onSnapshot listener on the identical aiProviderConfig/active document -
 * a confirmed duplicate (Phase 3 audit). createSharedListener()
 * (sharedListenerPure.ts, Firebase-free and independently unit-tested)
 * reference-counts every caller of subscribeActiveProviderConfig() behind
 * this ONE underlying onSnapshot, created lazily on first subscribe and
 * torn down only once the last subscriber unsubscribes.
 */
const sharedActiveProviderListener = createSharedListener<ActiveProviderConfig | null>((onValue, onError) =>
  onSnapshot(
    doc(db, CONFIG_DOC_PATH),
    (snap) => onValue(snap.exists() ? parseActiveProviderDoc(snap.data()) : null),
    (err) => onError(err)
  )
);

/**
 * Live-updates the config across every open tab/session (§24 - never show
 * a provider that isn't really active).
 *
 * PHASE 4E: every caller now shares ONE underlying Firestore listener via
 * sharedActiveProviderListener above, instead of each caller creating its
 * own. A consumer that joins after the shared listener already has a
 * value is delivered that value immediately (synchronously, from memory -
 * no extra Firestore read), exactly mirroring onSnapshot's own "deliver
 * current data immediately on subscribe" contract for a brand-new
 * listener. The underlying listener is torn down only when the LAST
 * consumer unsubscribes, so one consumer unmounting never affects another
 * that is still mounted.
 */
export function subscribeActiveProviderConfig(
  onUpdate: (config: ActiveProviderConfig | null) => void,
  onError?: (err: any) => void
): () => void {
  return sharedActiveProviderListener.subscribe(onUpdate, onError);
}

/**
 * Persists the newly-activated provider and records the change in the
 * existing audit trail (oldProvider/newProvider/changedBy/timestamp/reason -
 * §35). Never writes API keys or secrets - there are none to write, this
 * document only ever holds a provider id string.
 */
export async function setActiveProviderConfig(
  newProvider: AIProviderId,
  previousProvider: AIProviderId | null,
  reason: string
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Not signed in.');

  await setDoc(
    doc(db, CONFIG_DOC_PATH),
    {
      activeProvider: newProvider,
      updatedByUid: currentUser.uid,
      updatedByName: currentUser.email || currentUser.uid,
      updatedAt: new Date().toISOString(),
      reason: reason || '',
      serverUpdatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  await logAuditAction(
    'UPDATE',
    'aiProviderConfig',
    'active',
    `تغيير مزود الذكاء الاصطناعي: ${previousProvider || 'غير محدد'} → ${newProvider}. السبب: ${reason || '-'}`
  ).catch(() => {
    // Audit failure must never block the provider switch itself - matches
    // the existing auditAssistantAction() convention.
  });
}

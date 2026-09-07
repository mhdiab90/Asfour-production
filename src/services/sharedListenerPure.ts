/**
 * Phase 4E - generic, Firebase-free reference-counted listener sharing.
 *
 * Wraps ANY "subscribe to a live source" function (e.g. Firestore's
 * onSnapshot) so that N independent callers of the resulting subscribe()
 * share exactly ONE underlying source subscription: the source starts on
 * the first subscriber and stops only when the LAST subscriber
 * unsubscribes. A consumer that joins after the source already delivered
 * a value is replayed that value immediately (synchronously, from
 * memory, no extra read) - matching onSnapshot's own "deliver current
 * data immediately on subscribe" contract for a brand-new listener.
 *
 * Deliberately a single small factory function, not a state-management
 * framework - it has zero dependencies (no Firebase import, no React
 * import) and is reused wherever this codebase needs to consolidate
 * confirmed duplicate listeners that call the SAME exported subscribe
 * function (aiProviderConfig/active being the first case - see the Phase
 * 3/4E audit in aiProviderConfigService.ts).
 */

export interface SharedListenerConsumer<T> {
  onUpdate: (value: T) => void;
  onError?: (err: any) => void;
}

export interface SharedListener<T> {
  subscribe(onUpdate: (value: T) => void, onError?: (err: any) => void): () => void;
}

export function createSharedListener<T>(
  subscribeToSource: (onValue: (value: T) => void, onError: (err: any) => void) => () => void
): SharedListener<T> {
  let sourceUnsubscribe: (() => void) | null = null;
  let hasValue = false;
  let latestValue: T | undefined;
  const consumers = new Set<SharedListenerConsumer<T>>();

  function ensureSource(): void {
    if (sourceUnsubscribe) return;
    sourceUnsubscribe = subscribeToSource(
      (value) => {
        latestValue = value;
        hasValue = true;
        // Snapshot the current consumers before fan-out - if an onUpdate
        // handler synchronously subscribes/unsubscribes another consumer,
        // that mutation must never affect the set of listeners notified
        // for THIS delivery.
        Array.from(consumers).forEach((c) => c.onUpdate(value));
      },
      (err) => {
        // A source error permanently ends that underlying subscription
        // (Firestore's onSnapshot never auto-retries after an error, and
        // this must not invent new retry behavior) - clearing
        // sourceUnsubscribe lets a FUTURE subscribe() call start a
        // genuinely new source subscription instead of assuming a dead
        // one is still active.
        sourceUnsubscribe = null;
        hasValue = false;
        latestValue = undefined;
        Array.from(consumers).forEach((c) => c.onError?.(err));
      }
    );
  }

  return {
    subscribe(onUpdate, onError) {
      const consumer: SharedListenerConsumer<T> = { onUpdate, onError };
      consumers.add(consumer);
      ensureSource();

      if (hasValue) {
        onUpdate(latestValue as T);
      }

      return () => {
        consumers.delete(consumer);
        if (consumers.size === 0 && sourceUnsubscribe) {
          sourceUnsubscribe();
          sourceUnsubscribe = null;
          hasValue = false;
          latestValue = undefined;
        }
      };
    },
  };
}

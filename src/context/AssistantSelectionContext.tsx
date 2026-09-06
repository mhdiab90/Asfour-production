/**
 * Publishes "what's currently on screen" (production stage, selected
 * record/entity, active filters, active date range) so the Global AI
 * Assistant's ScreenContext reflects live UI state instead of just the
 * current page. Views opt in by calling useSetAssistantSelection() in a
 * useEffect and clearing on unmount - nothing is required from views that
 * don't; their fields simply stay undefined, exactly as before this existed.
 *
 * This is presentation-layer plumbing only: it never touches Firestore,
 * permissions, or tool execution - it only feeds src/assistant/context.ts's
 * buildScreenContext(), which already validates/narrows what actually
 * reaches the AI provider.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface AssistantSelectionState {
  currentStage?: string;
  selectedRecordId?: string;
  selectedEntityType?: string;
  selectedFilters?: Record<string, any>;
  selectedDateRange?: { startDate?: string; endDate?: string };
}

const EMPTY_SELECTION: AssistantSelectionState = {};

interface AssistantSelectionContextValue {
  selection: AssistantSelectionState;
  setSelection: (patch: AssistantSelectionState) => void;
}

const AssistantSelectionContext = createContext<AssistantSelectionContextValue | null>(null);

export const AssistantSelectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selection, setSelectionState] = useState<AssistantSelectionState>(EMPTY_SELECTION);

  const setSelection = useCallback((patch: AssistantSelectionState) => {
    setSelectionState(patch);
  }, []);

  const value = useMemo(() => ({ selection, setSelection }), [selection, setSelection]);

  return <AssistantSelectionContext.Provider value={value}>{children}</AssistantSelectionContext.Provider>;
};

/** Read-only hook used by GlobalAssistant to build ScreenContext. */
export function useAssistantSelection(): AssistantSelectionState {
  const ctx = useContext(AssistantSelectionContext);
  return ctx?.selection || EMPTY_SELECTION;
}

/**
 * Publisher hook for views. Call in a useEffect with the current
 * stage/record/filters/date-range, and clear it (call with {}) on unmount so
 * a screen you navigated away from doesn't keep "haunting" the assistant's
 * context. A view outside the provider (e.g. in isolated tests) gets a
 * harmless no-op setter instead of a crash.
 */
export function useSetAssistantSelection(): (patch: AssistantSelectionState) => void {
  const ctx = useContext(AssistantSelectionContext);
  return ctx?.setSelection || (() => {});
}

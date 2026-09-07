/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** AI Assistant: provider selection only - never a secret. 'mock' | 'claude' | 'gemini' */
  readonly VITE_AI_PROVIDER?: string;
  readonly VITE_CLAUDE_MODEL?: string;
  readonly VITE_GEMINI_MODEL?: string;
  readonly VITE_ASSISTANT_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

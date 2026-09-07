/**
 * AI Provider selection - NOT a secret. This only chooses which AIProvider
 * adapter the Gateway instantiates on the client; it never contains an API
 * key. Real provider credentials (CLAUDE_API_KEY / GEMINI_API_KEY) must live
 * server-side only (e.g. a Cloudflare Worker secret binding) behind a future
 * secure endpoint - see src/assistant/providers/ClaudeProvider.ts and
 * GeminiProvider.ts for that boundary.
 *
 * Switching AI_PROVIDER never requires changing any ERP tool code.
 */
export type AIProviderId = 'mock' | 'claude' | 'gemini' | 'cloudflare_workers_ai' | 'openrouter';

const VALID_PROVIDER_IDS: AIProviderId[] = ['mock', 'claude', 'gemini', 'cloudflare_workers_ai', 'openrouter'];

const RAW_PROVIDER = (import.meta.env.VITE_AI_PROVIDER || 'mock').toLowerCase();

/**
 * Build-time DEVELOPMENT DEFAULT ONLY (§38 - "mock for local development
 * only"). The application's real, admin-controlled active provider lives in
 * Firestore (aiProviderConfig/active, see src/services/aiProviderConfigService.ts)
 * and overrides this at runtime via src/assistant/providerRuntime.ts - this
 * constant is only the fallback used before that config has loaded, or if
 * no admin has ever set one yet.
 */
export const AI_PROVIDER: AIProviderId =
  (VALID_PROVIDER_IDS as string[]).includes(RAW_PROVIDER) ? (RAW_PROVIDER as AIProviderId) : 'mock';

/**
 * Non-secret model identifiers only. Actual API keys are NEVER read here and
 * NEVER shipped to the frontend bundle - see the provider stub files for why.
 * The real model id Claude uses is ultimately whatever the Worker's own
 * ANTHROPIC_MODEL secret/var is set to server-side - these are only ever
 * forwarded as a hint and never trusted as the source of truth.
 */
export const CLAUDE_MODEL = import.meta.env.VITE_CLAUDE_MODEL || '';
export const GEMINI_MODEL = import.meta.env.VITE_GEMINI_MODEL || '';

/**
 * Non-secret URL of the secure server-side AI gateway (Cloudflare Worker or
 * equivalent) that actually holds ANTHROPIC_API_KEY / GEMINI_API_KEY and
 * calls the real provider APIs. This is just an endpoint address - safe to
 * expose - never an API key. ClaudeProvider/GeminiProvider only become
 * `isConfigured = true` once this is set AND deployed; until then they keep
 * failing loudly rather than pretending to work. See cloudflare/ai-gateway/
 * for the Worker implementation and deployment instructions.
 */
export const AI_GATEWAY_URL = (import.meta.env.VITE_AI_GATEWAY_URL || '').trim();

/** Whether the floating assistant is shown at all in this build/session. */
export const ASSISTANT_ENABLED = (import.meta.env.VITE_ASSISTANT_ENABLED ?? 'true') !== 'false';

/**
 * Shared HTTP client for talking to the secure AI Gateway (Cloudflare
 * Worker) - used by every real (non-Mock) provider adapter so the
 * fetch/auth/error-handling logic exists exactly once. Each provider class
 * still owns its own system-prompt/tool-mapping/response-shaping - this
 * module only knows "send this envelope to the gateway, get a normalized
 * reply back."
 *
 * SECURITY BOUNDARY: this file contains no API key for any provider. It
 * only ever calls AI_GATEWAY_URL (a non-secret Cloudflare Worker endpoint)
 * carrying the current ASFOUR user's real Firebase ID token, exactly like
 * ClaudeProvider did before this file existed.
 */
import { AI_GATEWAY_URL } from '../config';
import { auth } from '../../config/firebase';

export type GatewayProviderId = 'claude' | 'gemini' | 'cloudflare_workers_ai' | 'openrouter';

export interface GatewayChatRequest {
  provider: GatewayProviderId;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, any> }>;
}

export interface GatewayChatResponse {
  ok: boolean;
  type?: 'tool_use' | 'text';
  toolName?: string;
  arguments?: Record<string, any>;
  text?: string;
  model?: string;
  error?: string;
}

export interface GatewayHealthResponse {
  ok: boolean;
  status?: 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'ERROR' | 'QUOTA_EXHAUSTED';
  model?: string;
  latencyMs?: number;
  reasonAr?: string;
  reasonEn?: string;
  error?: string;
}

export function isGatewayConfigured(): boolean {
  return AI_GATEWAY_URL.length > 0;
}

async function authorizedFetch(path: string, body: Record<string, any>): Promise<Response> {
  if (!isGatewayConfigured()) {
    throw new Error('AI gateway is not configured - VITE_AI_GATEWAY_URL is unset.');
  }
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('No signed-in ASFOUR user - cannot call the AI gateway.');
  }
  const idToken = await currentUser.getIdToken();

  return fetch(`${AI_GATEWAY_URL.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });
}

export async function callGatewayChat(request: GatewayChatRequest): Promise<GatewayChatResponse> {
  const res = await authorizedFetch('/chat', request);
  let payload: GatewayChatResponse;
  try {
    payload = await res.json();
  } catch {
    throw new Error(`AI gateway returned an invalid response (HTTP ${res.status}).`);
  }
  if (!res.ok || !payload.ok) {
    throw new Error(`AI gateway error: ${payload.error || res.status}`);
  }
  // Deliberately NO content inspection here (leaked tool-call protocol,
  // announcement-only text, etc.) - this is a pure transport layer. Every
  // real provider adapter goes through this SAME function, but only
  // gateway.ts has the Tool Registry needed to tell a genuine answer, a
  // recoverable textual tool call, and unrecoverable leaked protocol apart
  // - see src/assistant/toolCallNormalizer.ts, the ONE authoritative place
  // that decision is made, at the shared gateway boundary.
  return payload;
}

/**
 * Live, on-demand health check ONLY - never called automatically/silently
 * on page load, since a real check spends a small amount of real API
 * quota on the underlying provider. Only the Admin AI Provider Manager's
 * explicit "Test Connection" action should call this.
 */
export async function callGatewayHealth(provider: GatewayProviderId): Promise<GatewayHealthResponse> {
  const res = await authorizedFetch('/health', { provider });
  let payload: GatewayHealthResponse;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, status: 'ERROR', error: `Invalid gateway response (HTTP ${res.status})` };
  }
  return payload;
}

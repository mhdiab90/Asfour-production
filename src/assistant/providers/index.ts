import { AI_PROVIDER, AIProviderId } from '../config';
import { AIProvider } from '../types';
import { getRuntimeActiveProvider } from '../providerRuntime';
import { MockProvider } from './MockProvider';
import { ClaudeProvider } from './ClaudeProvider';
import { GeminiProvider } from './GeminiProvider';
import { CloudflareWorkersAIProvider } from './CloudflareWorkersAIProvider';
import { OpenRouterProvider } from './OpenRouterProvider';

let cachedProvider: AIProvider | null = null;

/**
 * Provider factory - the ONLY place that decides which AIProvider
 * implementation is active. Resolves the admin-controlled runtime
 * selection (providerRuntime.ts, backed by Firestore) first, falling back
 * to the build-time AI_PROVIDER default only before that has loaded. Every
 * other part of the assistant (Gateway, tools, UI) only ever talks to the
 * AIProvider interface, so switching this never requires touching ERP tool
 * code (§16/§31).
 */
export function resolveActiveProviderId(): AIProviderId {
  return getRuntimeActiveProvider() ?? AI_PROVIDER;
}

export function getAIProvider(): AIProvider {
  const activeId = resolveActiveProviderId();
  if (cachedProvider && cachedProvider.providerId === activeId) return cachedProvider;

  switch (activeId) {
    case 'claude':
      cachedProvider = new ClaudeProvider();
      break;
    case 'gemini':
      cachedProvider = new GeminiProvider();
      break;
    case 'cloudflare_workers_ai':
      cachedProvider = new CloudflareWorkersAIProvider();
      break;
    case 'openrouter':
      cachedProvider = new OpenRouterProvider();
      break;
    case 'mock':
    default:
      cachedProvider = new MockProvider();
      break;
  }
  return cachedProvider;
}

export { MockProvider, ClaudeProvider, GeminiProvider, CloudflareWorkersAIProvider, OpenRouterProvider };

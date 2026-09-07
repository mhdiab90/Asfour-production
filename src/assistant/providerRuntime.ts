/**
 * The application's REAL active AI provider - admin-controlled, loaded from
 * Firestore (aiProviderConfig/active) rather than hardcoded per-component.
 * Everything reads this through getAIProvider() (providers/index.ts); it is
 * set exactly twice: once at app boot (App.tsx subscribes via
 * aiProviderConfigService) and again immediately after the Admin AI
 * Provider Manager successfully activates a new provider.
 *
 * Before that first Firestore read resolves (or if it's unreachable), this
 * stays null and getAIProvider() falls back to the build-time AI_PROVIDER
 * default (config.ts) - always "mock" unless VITE_AI_PROVIDER was
 * explicitly set, so an unreachable config document can never silently
 * activate a real cloud provider nobody configured.
 */
import { AIProviderId } from './config';

let runtimeActiveProviderId: AIProviderId | null = null;

export function setRuntimeActiveProvider(id: AIProviderId | null): void {
  runtimeActiveProviderId = id;
}

export function getRuntimeActiveProvider(): AIProviderId | null {
  return runtimeActiveProviderId;
}

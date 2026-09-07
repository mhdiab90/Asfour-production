/**
 * AI Provider Registry (§16/§17/§18/§19) - the single source of truth for
 * which providers exist, what each one is capable of, and how to run a
 * real, on-demand health check against it. The Admin AI Provider Manager
 * screen and the provider-activation flow both read this - neither invents
 * provider metadata of its own.
 */
import { AIProviderId } from './config';
import { AIProvider } from './types';
import { MockProvider, ClaudeProvider, GeminiProvider, CloudflareWorkersAIProvider, OpenRouterProvider } from './providers';
import { callGatewayHealth, isGatewayConfigured, GatewayProviderId } from './providers/gatewayClient';

export type ProviderCapability = 'chat' | 'toolCalling' | 'structuredOutput' | 'streaming' | 'analysis' | 'multiStep';

/** §19 - a provider must support at least these to be activated as the production provider. */
export const MINIMUM_REQUIRED_CAPABILITIES: ProviderCapability[] = ['chat', 'toolCalling', 'structuredOutput'];

/**
 * Consolidated UX pass Item 5 - QUOTA_EXHAUSTED is a distinct status from
 * generic ERROR/UNAVAILABLE: it means the provider's free tier/allocation is
 * temporarily used up (an account-level resource limit), never that the
 * ERP application itself is broken. Must never collapse into ERROR - see
 * healthResultFromError()'s Cloudflare Workers AI 4006 classification in the
 * Worker and buildQuotaExhaustedErrorMessage() in gateway.ts for the live-chat-path equivalent.
 */
export type ProviderConfigurationStatus = 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE' | 'ERROR' | 'DISABLED' | 'QUOTA_EXHAUSTED';

export interface ProviderHealthCheckResult {
  status: ProviderConfigurationStatus;
  checkedAt: string;
  model?: string;
  latencyMs?: number;
  reasonAr?: string;
  reasonEn?: string;
}

export interface AIProviderDefinition {
  id: AIProviderId;
  displayNameAr: string;
  displayNameEn: string;
  capabilities: ProviderCapability[];
  /** True only for Mock - never requires configuration, never a real model. */
  isAlwaysAvailable: boolean;
  /** True only for Mock - the UI must never present this as a real AI provider (§10/§40). */
  isDevelopmentOnly: boolean;
  descriptionAr: string;
  descriptionEn: string;
  /** §34 - shown in the activation confirmation dialog when a provider's
   * upstream data-retention/training policy needs explicit admin awareness
   * before activating it. Omitted for providers with no such caveat. */
  activationWarningAr?: string;
  activationWarningEn?: string;
  /** §30 - a safe, non-binding usage notice (e.g. free-tier rate limits) shown
   * in the Admin screen. Never treated as an enforced application constant. */
  usageNoticeAr?: string;
  usageNoticeEn?: string;
  checkHealth: () => Promise<ProviderHealthCheckResult>;
  providerFactory: () => AIProvider;
}

function meetsMinimumCapabilities(capabilities: ProviderCapability[]): boolean {
  return MINIMUM_REQUIRED_CAPABILITIES.every((c) => capabilities.includes(c));
}

async function checkGatewayBackedHealth(gatewayProviderId: GatewayProviderId): Promise<ProviderHealthCheckResult> {
  const checkedAt = new Date().toISOString();
  if (!isGatewayConfigured()) {
    return {
      status: 'NOT_CONFIGURED',
      checkedAt,
      reasonAr: 'لم يتم إعداد رابط البوابة الآمنة (VITE_AI_GATEWAY_URL).',
      reasonEn: 'The secure gateway URL (VITE_AI_GATEWAY_URL) is not configured.',
    };
  }
  const startedAt = Date.now();
  try {
    const result = await callGatewayHealth(gatewayProviderId);
    const latencyMs = Date.now() - startedAt;
    if (!result.ok) {
      return { status: 'ERROR', checkedAt, latencyMs, reasonAr: 'فشل الاتصال بالبوابة.', reasonEn: 'Failed to reach the AI gateway.' };
    }
    return {
      status: result.status || 'ERROR',
      checkedAt,
      latencyMs,
      model: result.model,
      reasonAr: result.reasonAr,
      reasonEn: result.reasonEn,
    };
  } catch (err: any) {
    return {
      status: 'ERROR',
      checkedAt,
      latencyMs: Date.now() - startedAt,
      reasonAr: 'تعذر تنفيذ فحص الاتصال.',
      reasonEn: err?.message || 'Health check failed.',
    };
  }
}

export const PROVIDER_DEFINITIONS: AIProviderDefinition[] = [
  {
    id: 'claude',
    displayNameAr: 'Claude (Anthropic)',
    displayNameEn: 'Claude (Anthropic)',
    capabilities: ['chat', 'toolCalling', 'structuredOutput', 'streaming', 'analysis', 'multiStep'],
    isAlwaysAvailable: false,
    isDevelopmentOnly: false,
    descriptionAr: 'مزود ذكاء اصطناعي حقيقي عبر بوابة Cloudflare Worker الآمنة.',
    descriptionEn: 'Real AI provider via the secure Cloudflare Worker gateway.',
    checkHealth: () => checkGatewayBackedHealth('claude'),
    providerFactory: () => new ClaudeProvider(),
  },
  {
    id: 'gemini',
    displayNameAr: 'Gemini (Google)',
    displayNameEn: 'Gemini (Google)',
    capabilities: ['chat', 'toolCalling', 'structuredOutput', 'analysis'],
    isAlwaysAvailable: false,
    isDevelopmentOnly: false,
    descriptionAr: 'مزود ذكاء اصطناعي حقيقي عبر نفس البوابة الآمنة.',
    descriptionEn: 'Real AI provider via the same secure gateway.',
    checkHealth: () => checkGatewayBackedHealth('gemini'),
    providerFactory: () => new GeminiProvider(),
  },
  {
    id: 'cloudflare_workers_ai',
    displayNameAr: 'Cloudflare Workers AI',
    displayNameEn: 'Cloudflare Workers AI',
    capabilities: ['chat', 'toolCalling', 'structuredOutput', 'analysis'],
    isAlwaysAvailable: false,
    isDevelopmentOnly: false,
    descriptionAr: 'يعمل عبر ربط (Binding) داخل نفس حساب Cloudflare - لا يتطلب مفتاح API منفصل.',
    descriptionEn: 'Runs via a native binding inside the same Cloudflare account - no separate API key required.',
    checkHealth: () => checkGatewayBackedHealth('cloudflare_workers_ai'),
    providerFactory: () => new CloudflareWorkersAIProvider(),
  },
  {
    id: 'openrouter',
    displayNameAr: 'OpenRouter Free',
    displayNameEn: 'OpenRouter Free',
    capabilities: ['chat', 'toolCalling', 'structuredOutput', 'analysis'],
    isAlwaysAvailable: false,
    isDevelopmentOnly: false,
    descriptionAr: 'يوجّه الطلب تلقائياً بين النماذج المجانية المتاحة حالياً عبر OpenRouter (openrouter/free) التي تدعم استدعاء الأدوات.',
    descriptionEn: 'Dynamically routes across whichever free models OpenRouter currently has available (openrouter/free) that support tool calling.',
    // §34 - accurate, non-false data-flow disclosure: ASFOUR -> Worker ->
    // OpenRouter -> whichever upstream model OpenRouter's free router picks.
    // Free-tier models on OpenRouter do not uniformly guarantee the same
    // data-retention/training policy - never claim data "never leaves
    // OpenRouter", since the actual upstream model provider varies per request.
    activationWarningAr: 'يوجّه "openrouter/free" الطلبات ديناميكياً بين عدة نماذج مجانية من مزودين مختلفين. قد تختلف سياسة الاحتفاظ بالبيانات/التدريب حسب النموذج الذي يتم اختياره فعلياً في كل طلب، ولا يمكن ضمان سياسة موحدة لجميع النماذج المجانية.',
    activationWarningEn: '"openrouter/free" dynamically routes requests across several free models from different upstream providers. The data-retention/training policy can differ depending on which model is actually selected for a given request - there is no single guaranteed policy across all free models.',
    usageNoticeAr: 'يخضع OpenRouter Free لحدود الاستخدام المجانية الحالية لدى OpenRouter (تقريباً 50 طلب/يوم و20 طلب/دقيقة وقت كتابة هذا - قد تتغير هذه الحدود من جانب OpenRouter).',
    usageNoticeEn: "OpenRouter Free is subject to OpenRouter's current free-tier request limits (approximately 50 requests/day and 20 requests/minute as documented at the time of writing - subject to change by OpenRouter).",
    checkHealth: () => checkGatewayBackedHealth('openrouter'),
    providerFactory: () => new OpenRouterProvider(),
  },
  {
    id: 'mock',
    displayNameAr: 'Mock (تجريبي محلي)',
    displayNameEn: 'Mock (Local Development)',
    // Deliberately declared WITHOUT structuredOutput/multiStep - Mock is
    // pure keyword matching, not a real model, so it never claims to meet
    // the minimum production capability bar (§19) even though it can still
    // drive the same tool pipeline via deterministic pattern matching.
    capabilities: ['chat', 'toolCalling', 'analysis'],
    isAlwaysAvailable: true,
    isDevelopmentOnly: true,
    descriptionAr: 'مطابقة أنماط محلية وحتمية - لإثبات البنية والتطوير فقط، وليس ذكاءً اصطناعياً حقيقياً.',
    descriptionEn: 'Local, deterministic pattern matching - proves the architecture for development only, not real AI.',
    checkHealth: async () => ({ status: 'READY', checkedAt: new Date().toISOString(), model: 'mock-pattern-matcher' }),
    providerFactory: () => new MockProvider(),
  },
];

export function getProviderDefinition(id: AIProviderId): AIProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find((p) => p.id === id);
}

export function listProviderDefinitions(): AIProviderDefinition[] {
  return PROVIDER_DEFINITIONS;
}

/** §19 - whether a provider is even eligible to be activated as the production provider. */
export function isEligibleForActivation(id: AIProviderId): boolean {
  const def = getProviderDefinition(id);
  if (!def) return false;
  if (def.isAlwaysAvailable) return true; // Mock is always eligible for its own dev-only purpose
  return meetsMinimumCapabilities(def.capabilities);
}

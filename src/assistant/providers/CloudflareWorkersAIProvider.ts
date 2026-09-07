/**
 * Cloudflare Workers AI provider adapter - same shared gateway client and
 * security boundary as ClaudeProvider/GeminiProvider. Unlike the other two,
 * this provider needs NO external API key at all: the Worker calls Workers
 * AI through its native `env.AI` binding, authenticated by simply running
 * inside the same Cloudflare account - see cloudflare/ai-gateway/worker.js.
 * The model id is controlled server-side via the Worker's CLOUDFLARE_AI_MODEL
 * var, never hardcoded here.
 */
import {
  AIProvider,
  AIProviderTurn,
  AssistantMessage,
  CommandType,
  ScreenContext,
  ToolExecutionResult,
  ToolResultAnalysis,
  ToolSummary,
} from '../types';
import { buildSystemPrompt, historyToMessages, buildInferencePrompt } from './promptBuilder';
import { callGatewayChat, isGatewayConfigured } from './gatewayClient';

// Mirrors providerRegistry.ts's displayNameEn for 'cloudflare_workers_ai' -
// kept as a local literal to avoid a circular import (see ClaudeProvider.ts).
const PROVIDER_DISPLAY_NAME = 'Cloudflare Workers AI';

export class CloudflareWorkersAIProvider implements AIProvider {
  readonly providerId = 'cloudflare_workers_ai' as const;

  get isConfigured(): boolean {
    return isGatewayConfigured();
  }

  private notConfiguredError(): never {
    throw new Error(
      'CloudflareWorkersAIProvider is not configured. Set VITE_AI_GATEWAY_URL to a deployed ' +
      'secure AI gateway with the Workers AI binding enabled (see cloudflare/ai-gateway/README.md).'
    );
  }

  async generateWithTools(
    userText: string,
    context: ScreenContext,
    availableTools: ToolSummary[],
    history: AssistantMessage[]
  ): Promise<AIProviderTurn> {
    if (!this.isConfigured) this.notConfiguredError();

    const tools = availableTools
      .filter((t) => t.parameterSchema)
      .map((t) => ({
        name: t.toolName,
        description: context.currentLanguage === 'ar' ? t.descriptionAr : t.descriptionEn,
        input_schema: t.parameterSchema as Record<string, any>,
      }));

    const messages = [...historyToMessages(history), { role: 'user' as const, content: userText }];
    const response = await callGatewayChat({ provider: 'cloudflare_workers_ai', system: buildSystemPrompt(context, PROVIDER_DISPLAY_NAME), messages, tools });

    if (response.type === 'tool_use' && response.toolName) {
      const matchedTool = availableTools.find((t) => t.toolName === response.toolName);
      const commandType: CommandType = matchedTool?.commandType || 'UNKNOWN';
      return { commandType, toolCall: { toolName: response.toolName, arguments: response.arguments || {} } };
    }

    return { commandType: 'UNKNOWN', responseText: response.text || '' };
  }

  async analyzeToolResult(toolName: string, result: ToolExecutionResult, context: ScreenContext): Promise<ToolResultAnalysis> {
    if (!this.isConfigured) this.notConfiguredError();

    const factualSummaryAr = result.messageAr || 'تم تنفيذ العملية.';
    const factualSummaryEn = result.messageEn || 'Operation completed.';
    if (!result.success) {
      return { factualSummaryAr, factualSummaryEn };
    }

    try {
      const response = await callGatewayChat({
        provider: 'cloudflare_workers_ai',
        system: buildSystemPrompt(context, PROVIDER_DISPLAY_NAME),
        messages: [{ role: 'user', content: buildInferencePrompt(toolName, result.data) }],
      });
      const parsed = JSON.parse((response.text || '').trim());
      if (parsed && typeof parsed.inferenceAr === 'string' && typeof parsed.inferenceEn === 'string') {
        return { factualSummaryAr, factualSummaryEn, inferenceAr: parsed.inferenceAr, inferenceEn: parsed.inferenceEn };
      }
    } catch {
      // Never let a failed inference call break the already-correct factual response.
    }
    return { factualSummaryAr, factualSummaryEn };
  }

  async generateResponse(userText: string, context: ScreenContext, history: AssistantMessage[]): Promise<string> {
    if (!this.isConfigured) this.notConfiguredError();

    const messages = [...historyToMessages(history), { role: 'user' as const, content: userText }];
    const response = await callGatewayChat({ provider: 'cloudflare_workers_ai', system: buildSystemPrompt(context, PROVIDER_DISPLAY_NAME), messages });
    return response.text || (context.currentLanguage === 'ar' ? 'تعذر تنفيذ العملية.' : 'Unable to complete the operation.');
  }

  async streamResponse(userText: string, context: ScreenContext, onChunk: (chunk: string) => void): Promise<void> {
    const text = await this.generateResponse(userText, context, []);
    onChunk(text);
  }
}

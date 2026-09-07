/**
 * Gemini provider adapter - real implementation, same security boundary and
 * shared gateway client as ClaudeProvider. GEMINI_API_KEY lives only in the
 * Worker's Cloudflare secret store; this class never sees it. Until that
 * secret is actually deployed server-side, the gateway's /chat endpoint
 * returns GEMINI_NOT_CONFIGURED and this provider surfaces that honestly -
 * it never pretends to be ready.
 */
import { GEMINI_MODEL } from '../config';
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

// Mirrors providerRegistry.ts's displayNameEn for 'gemini' - kept as a
// local literal to avoid a circular import (see ClaudeProvider.ts).
const PROVIDER_DISPLAY_NAME = 'Gemini (Google)';

export class GeminiProvider implements AIProvider {
  readonly providerId = 'gemini' as const;

  get isConfigured(): boolean {
    // Same rule as ClaudeProvider: only true once the gateway URL exists.
    // Whether GEMINI_API_KEY is actually set server-side is a separate,
    // provider-specific question answered by the Admin Provider Manager's
    // health check (GATEWAY_NOT_CONFIGURED vs GEMINI_NOT_CONFIGURED), not
    // by this flag - this flag only means "there is a gateway to ask."
    return isGatewayConfigured();
  }

  private notConfiguredError(): never {
    throw new Error(
      'GeminiProvider is not configured. Set VITE_AI_GATEWAY_URL to a deployed ' +
      `secure AI gateway, and ensure GEMINI_API_KEY is set as a Worker secret. Model hint: ${GEMINI_MODEL || 'unset'}.`
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
    const response = await callGatewayChat({ provider: 'gemini', system: buildSystemPrompt(context, PROVIDER_DISPLAY_NAME), messages, tools });

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
        provider: 'gemini',
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
    const response = await callGatewayChat({ provider: 'gemini', system: buildSystemPrompt(context, PROVIDER_DISPLAY_NAME), messages });
    return response.text || (context.currentLanguage === 'ar' ? 'تعذر تنفيذ العملية.' : 'Unable to complete the operation.');
  }

  async streamResponse(userText: string, context: ScreenContext, onChunk: (chunk: string) => void): Promise<void> {
    const text = await this.generateResponse(userText, context, []);
    onChunk(text);
  }
}

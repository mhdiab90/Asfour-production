/**
 * AssistantGateway - the orchestrator. This is the ONLY object the frontend
 * talks to; it never exposes provider secrets (there are none on the
 * client - see config.ts) and it is the single choke point through which
 * every AI-originated action must pass:
 *
 *   AIProvider -> Tool Registry -> Permission Guard -> Validation
 *   -> ERP Service (via the tool's execute()) -> Firestore
 *
 * The AIProvider itself never sees a Firestore handle, an ERP service
 * function, or anything beyond: the user's text, screen context, and the
 * list of tool NAMES/descriptions it may request.
 */
import { AdminUser } from '../types';
import { getAIProvider } from './providers';
import { ensureToolsRegistered, getTool, listToolSummaries } from './tools';
import { checkToolPermission, listPermittedToolSummaries } from './permissionGuard';
import { auditAssistantAction } from './audit';
import { extractExplicitMonthRange } from './tools/dateRangeResolver';
import { parseTextualToolCall, containsToolProtocolLeak } from './toolCallNormalizer';
import { extractShiftNumber } from './tools/masterDataTools';
import { detectStages } from '../services/aiDashboardDesigner';
import {
  ActionPreview,
  AssistantMessage,
  AuditItemResult,
  DashboardMutationKind,
  ScreenContext,
  ToolDefinition,
  ToolExecutionResult,
  WorkflowState,
  WorkflowStepRecord,
} from './types';

function newMessageId(): string {
  return `MSG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** All registered tool names, regardless of the current user's permissions - used ONLY for leak/recovery DETECTION (a name a user can't call still shouldn't leak), never for execution eligibility (Permission Guard still runs on the actual tool call afterward). */
function getRegisteredToolNames(): Set<string> {
  return new Set(listToolSummaries().map((t) => t.toolName));
}

function recordCountFromInput(value: any): number {
  if (Array.isArray(value?.codes)) return value.codes.length;
  if (Array.isArray(value?.items)) return value.items.length;
  return 1;
}

function needsConfirmation(tool: ToolDefinition, input: any): boolean {
  if (tool.riskLevel === 'HIGH_RISK') return true;
  if (tool.confirmationPolicy === 'ALWAYS') return true;
  if (tool.confirmationPolicy === 'WHEN_MULTIPLE_RECORDS') return recordCountFromInput(input) > 1;
  return false;
}

function safeParametersSummary(args: Record<string, any>): string {
  try {
    const json = JSON.stringify(args);
    return json.length > 500 ? `${json.slice(0, 500)}...` : json;
  } catch {
    return '[unserializable arguments]';
  }
}

/**
 * §27 - differentiated safe error messages. A single generic
 * "تعذر تنفيذ العملية" for every failure hides what actually happened and
 * makes ordinary conversation look identically broken to a real ERP
 * failure - each category gets its own honest, still-secret-free message.
 */
type SafeErrorCode =
  | 'PROVIDER_ERROR'
  | 'NOT_SIGNED_IN'
  | 'GATEWAY_NOT_CONFIGURED'
  | 'NETWORK_ERROR'
  | 'ERP_QUERY_FAILED'
  | 'INVALID_REQUEST'
  | 'GENERAL_CONVERSATION_FAILED'
  | 'TOOL_PIPELINE_FAILED'
  | 'TOOL_EXECUTION_TIMEOUT'
  | 'TOOL_NOT_COMPLETED'
  // Phase 7 §7.4 - distinct from the generic PROVIDER_ERROR bucket so a real
  // rate-limit (429/"too many requests", surfaced identically by every real
  // provider's HTTP error text) reads as "try again shortly", not as a
  // generic outage.
  | 'RATE_LIMIT'
  // Consolidated UX pass Item 5 - a provider's free tier/allocation is
  // temporarily used up (e.g. Cloudflare Workers AI's daily neuron quota,
  // error 4006). Distinct from RATE_LIMIT (a short-lived per-minute cap) and
  // from the generic PROVIDER_ERROR bucket: the ERP application itself is
  // fine, only this specific provider's free quota needs to reset or the
  // user needs to switch providers - must never be presented as if the
  // program itself were broken.
  | 'QUOTA_EXHAUSTED'
  // Phase 5 - a multi-part auto-chained request (see continueWorkflow())
  // that could not continue after a genuine step failure, or that the user
  // explicitly cancelled mid-chain via the existing cancelPendingAction().
  | 'WORKFLOW_FAILED'
  | 'WORKFLOW_CANCELLED';

const SAFE_ERROR_MESSAGES: Record<SafeErrorCode, { ar: string; en: string }> = {
  PROVIDER_ERROR: {
    ar: 'تعذر الوصول إلى مزود الذكاء الاصطناعي حالياً. حاول مرة أخرى بعد قليل.',
    en: 'Unable to reach the AI provider right now. Please try again shortly.',
  },
  // Urgent Regression Diagnosis - a live wrangler-tail investigation proved
  // requests can fail BEFORE ever reaching the Worker (zero invocations
  // logged for a real, confirmed browser attempt, while the Worker itself
  // was independently verified healthy via direct curl). All three
  // pre-network failure points in gatewayClient.ts's authorizedFetch() throw
  // distinct, recognizable error messages - classifyProviderError() below
  // maps them to their own codes instead of collapsing everything into the
  // one generic PROVIDER_ERROR bucket, so the NEXT occurrence is
  // self-diagnosing without needing a live tail session again.
  NOT_SIGNED_IN: {
    ar: 'انتهت صلاحية جلستك. يرجى تسجيل الخروج والدخول مرة أخرى.',
    en: 'Your session has expired. Please sign out and sign in again.',
  },
  GATEWAY_NOT_CONFIGURED: {
    ar: 'خدمة الذكاء الاصطناعي غير مهيأة على هذا الجهاز حالياً. تواصل مع المسؤول.',
    en: 'The AI service is not configured on this device right now. Contact your administrator.',
  },
  NETWORK_ERROR: {
    ar: 'تعذر الاتصال بخدمة الذكاء الاصطناعي عبر الشبكة. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.',
    en: 'Could not reach the AI service over the network. Check your connection and try again.',
  },
  ERP_QUERY_FAILED: {
    ar: 'تعذر تنفيذ الاستعلام على بيانات النظام. حاول مرة أخرى أو أعد صياغة السؤال.',
    en: 'The ERP query could not be completed. Try again or rephrase the question.',
  },
  INVALID_REQUEST: {
    ar: 'تعذر فهم بيانات الطلب.',
    en: 'The request could not be understood.',
  },
  GENERAL_CONVERSATION_FAILED: {
    ar: 'تعذر الرد على هذه الرسالة حالياً.',
    en: 'Unable to respond to this message right now.',
  },
  // §3/§7/§9/Part 6 - the tool pipeline itself (permission/validation/date
  // injection/preview building, or an unexpected error escaping execute())
  // broke somewhere after the model chose a tool - distinct from a normal
  // ERP query returning no data, and distinct from the provider itself being
  // unreachable, so the user can tell what actually happened.
  TOOL_PIPELINE_FAILED: {
    ar: 'تعذر إكمال هذا الطلب بسبب خطأ داخلي غير متوقع. حاول مرة أخرى.',
    en: 'This request could not be completed due to an unexpected internal error. Please try again.',
  },
  TOOL_EXECUTION_TIMEOUT: {
    ar: 'استغرق تنفيذ العملية وقتاً طويلاً جداً. حاول مرة أخرى.',
    en: 'The operation took too long to complete. Please try again.',
  },
  // §1/§7/§11 - the model announced an intended action in plain text but
  // never actually invoked the tool (even after one retry) - never present
  // this to the user as if it were a complete answer.
  TOOL_NOT_COMPLETED: {
    ar: 'فهمت طلبك، لكن تعذر تنفيذه تلقائياً بالكامل. حاول إعادة صياغة السؤال بشكل أكثر تحديداً.',
    en: "I understood your request, but couldn't complete it automatically. Try rephrasing it more specifically.",
  },
  RATE_LIMIT: {
    ar: 'تم تجاوز الحد المسموح به من الطلبات لمزود الذكاء الاصطناعي حالياً. حاول مرة أخرى بعد قليل.',
    en: 'The AI provider is temporarily rate-limited. Please try again in a moment.',
  },
  QUOTA_EXHAUSTED: {
    ar: 'انتهت الحصة المجانية المتاحة لمزود الذكاء الاصطناعي حاليًا. البرنامج نفسه يعمل، ويمكنك استخدام مزود آخر أو المحاولة مرة أخرى بعد تجدد الحصة.',
    en: 'The free quota currently available for this AI provider has run out right now. The application itself is working fine - you can switch to another provider or try again once the quota resets.',
  },
  WORKFLOW_FAILED: {
    ar: 'تعذر إكمال باقي خطوات الطلب. راجع نتائج الخطوات التي تمت أعلاه.',
    en: 'The remaining steps of this request could not continue. Review the completed steps above.',
  },
  WORKFLOW_CANCELLED: {
    ar: 'تم إلغاء باقي خطوات الطلب. الخطوات المنفذة بالفعل تبقى كما هي.',
    en: 'The remaining steps of this request were cancelled. Steps already completed remain as they are.',
  },
};

function safeErrorMessage(code: SafeErrorCode, isAr: boolean): string {
  return isAr ? SAFE_ERROR_MESSAGES[code].ar : SAFE_ERROR_MESSAGES[code].en;
}

/**
 * Urgent Regression Diagnosis - classifies a caught provider.generateWithTools()/
 * generateResponse() failure by the ACTUAL error thrown, instead of collapsing
 * every case into one opaque "unable to reach the provider" bucket. The three
 * pre-network throws in gatewayClient.ts's authorizedFetch() (config missing,
 * not signed in, real gateway HTTP error) plus a generic network/fetch
 * failure each get their own recognizable code - all secret-free by
 * construction (these messages never contained a key or token to begin with).
 */
function classifyProviderError(err: unknown): SafeErrorCode {
  const message = String((err as any)?.message || err || '');
  if (message.includes('not configured') || message.includes('VITE_AI_GATEWAY_URL')) return 'GATEWAY_NOT_CONFIGURED';
  if (message.includes('No signed-in ASFOUR user')) return 'NOT_SIGNED_IN';
  // Phase 7 §7.4 - checked BEFORE the generic "AI gateway error:" match below,
  // since a 429 response is itself relayed through that same generic prefix
  // by gatewayClient.ts - the rate-limit signal would otherwise never be reached.
  // Consolidated UX pass Item 5 - checked BEFORE the generic 429/rate-limit
  // match below, same reasoning as RATE_LIMIT above: the worker relays this
  // through the same generic "AI gateway error:" prefix.
  if (message.includes('QUOTA_EXHAUSTED')) return 'QUOTA_EXHAUSTED';
  if (/\b429\b|rate.?limit|too many requests/i.test(message)) return 'RATE_LIMIT';
  if (message.includes('AI gateway error:') || message.includes('invalid response')) return 'PROVIDER_ERROR';
  if (/fetch|network|failed to fetch|networkerror/i.test(message) || (err as any)?.name === 'TypeError') return 'NETWORK_ERROR';
  return 'PROVIDER_ERROR';
}

const SHOULD_AUDIT_COMMAND_TYPES = new Set(['ACTION', 'EXPORT', 'NAVIGATION']);

/**
 * §23 - derives the audit trail's per-item breakdown from a batch
 * create-tool's own result shape (AddResult/FuzzyAwareAddResult from
 * masterDataTools.ts) - never invents fields the tool didn't actually
 * report, and simply returns undefined for tools without this shape (most
 * QUERY/ANALYSIS/NAVIGATION tools) so their audit entries are unaffected.
 */
function deriveAuditItemResults(data: any): AuditItemResult[] | undefined {
  if (!data || !Array.isArray(data.added) || !Array.isArray(data.alreadyExisted)) return undefined;
  const items: AuditItemResult[] = [];
  for (const a of data.added as Array<{ code: string }>) {
    items.push({ requestedValue: a.code, status: 'NEW', decision: 'CREATE', result: 'CREATED' });
  }
  for (const code of data.alreadyExisted as string[]) {
    items.push({ requestedValue: code, status: 'ALREADY_EXISTS', decision: 'SKIP', result: 'NOT_CREATED' });
  }
  for (const f of (data.failed || []) as Array<{ code: string }>) {
    items.push({ requestedValue: f.code, status: 'NEW', decision: 'CREATE', result: 'FAILED' });
  }
  for (const d of (data.likelyDuplicates || []) as Array<{ input: string }>) {
    items.push({ requestedValue: d.input, status: 'LIKELY_DUPLICATE', decision: 'SKIP', result: 'NOT_CREATED' });
  }
  for (const a of (data.ambiguous || []) as Array<{ input: string }>) {
    items.push({ requestedValue: a.input, status: 'AMBIGUOUS', decision: 'SKIP', result: 'NOT_CREATED' });
  }
  return items.length > 0 ? items : undefined;
}

async function buildPreview(tool: ToolDefinition, input: any, context: ScreenContext): Promise<ActionPreview> {
  if (tool.buildPreview) {
    const p = await tool.buildPreview(input, context);
    return {
      actionLabelAr: tool.descriptionAr,
      actionLabelEn: tool.descriptionEn,
      toolCall: { toolName: tool.toolName, arguments: input },
      targetSummaryAr: p.targetSummaryAr,
      targetSummaryEn: p.targetSummaryEn,
      items: p.items,
      affectedRecordCount: p.items.filter((i) => i.status === 'NEW').length,
      riskLevel: tool.riskLevel,
    };
  }
  // A tool without a per-item preview builder (no name/code-driven batch to
  // classify) still needs a coherent confirmation card - a single
  // informational item, never a fabricated per-item breakdown.
  return {
    actionLabelAr: tool.descriptionAr,
    actionLabelEn: tool.descriptionEn,
    toolCall: { toolName: tool.toolName, arguments: input },
    targetSummaryAr: safeParametersSummary(input),
    targetSummaryEn: safeParametersSummary(input),
    items: [{
      key: '*',
      displayValue: tool.descriptionAr,
      status: 'NEW',
      messageAr: 'سيتم تنفيذ هذا الإجراء بعد التأكيد.',
      messageEn: 'This action will run once you confirm.',
    }],
    affectedRecordCount: recordCountFromInput(input),
    riskLevel: tool.riskLevel,
  };
}

/** §3/§21 - a hung tool.execute() (a stuck Firestore query, etc.) must surface as a distinct TIMEOUT, never an infinite spinner. */
const TOOL_EXECUTION_TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TOOL_EXECUTION_TIMEOUT')), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

async function runToolAndRespond(
  tool: ToolDefinition,
  input: any,
  context: ScreenContext,
  user: AdminUser | null | undefined,
  confirmationUsed: boolean
): Promise<AssistantMessage> {
  const provider = getAIProvider();
  const isAr = context.currentLanguage === 'ar';
  let result: ToolExecutionResult;

  try {
    result = await withTimeout(tool.execute(input, context), TOOL_EXECUTION_TIMEOUT_MS);
  } catch (err: any) {
    // A thrown error - or a hang - must never be presented as a success.
    const isTimeout = err?.message === 'TOOL_EXECUTION_TIMEOUT';
    result = {
      success: false,
      errorCode: isTimeout ? 'TOOL_EXECUTION_TIMEOUT' : 'TOOL_EXECUTION_EXCEPTION',
      messageAr: isTimeout ? safeErrorMessage('TOOL_EXECUTION_TIMEOUT', true) : safeErrorMessage('ERP_QUERY_FAILED', true),
      messageEn: isTimeout ? safeErrorMessage('TOOL_EXECUTION_TIMEOUT', false) : safeErrorMessage('ERP_QUERY_FAILED', false),
    };
  }

  // Phase 4B Part 4/Part 11 - a choiceRequest means "ask the user which of
  // N options they want", not a completed action - the tool's own
  // deterministic question (messageAr/messageEn) IS the reply text; running
  // it through provider.analyzeToolResult() would risk the model inventing
  // commentary about options it never actually decided (§11 "recommendation
  // must not auto-apply" applies equally to how the reply is worded).
  if (result.choiceRequest) {
    return {
      id: newMessageId(),
      role: 'assistant',
      text: isAr ? (result.messageAr || '') : (result.messageEn || ''),
      createdAt: new Date().toISOString(),
      toolCall: { toolName: tool.toolName, arguments: input },
      toolResult: result,
      commandType: tool.commandType,
      isFactual: true,
      choiceRequest: result.choiceRequest,
    };
  }

  if (SHOULD_AUDIT_COMMAND_TYPES.has(tool.commandType)) {
    await auditAssistantAction({
      userId: context.currentUserId || 'unknown',
      screen: context.currentPage,
      module: context.currentModule,
      tool: tool.toolName,
      safeParametersSummary: safeParametersSummary(input),
      result: result.success ? 'SUCCESS' : 'FAILURE',
      affectedCount: result.affectedCount || 0,
      success: result.success,
      confirmationUsed,
      provider: provider.providerId,
      itemResults: deriveAuditItemResults(result.data),
    });
  }

  // §18/§19/Part 4 - a successful, real ERP result must NEVER be discarded
  // just because the second AI turn (turning the fact into prose) fails.
  // result.messageAr/messageEn are ALREADY the deterministic, tool-computed,
  // real (non-AI-generated) bilingual summary every tool builds directly
  // from real data - falling back to exactly that text is the "deterministic
  // human-readable summary" the task asks for, using data already present,
  // never fabricating anything new.
  let analysis: { factualSummaryAr: string; factualSummaryEn: string; inferenceAr?: string; inferenceEn?: string };
  try {
    analysis = await provider.analyzeToolResult(tool.toolName, result, context);
  } catch {
    analysis = {
      factualSummaryAr: result.messageAr || safeErrorMessage('TOOL_PIPELINE_FAILED', true),
      factualSummaryEn: result.messageEn || safeErrorMessage('TOOL_PIPELINE_FAILED', false),
    };
  }

  // buildInferencePrompt() (promptBuilder.ts) literally hands the model
  // JSON.stringify(result.data) and asks for "1-2 short sentences" back - a
  // weak model can misunderstand and echo the raw structured data instead
  // ("النتائج: {...}", observed live), or leak internal tool-call protocol
  // syntax the same way generateWithTools() can. This is the ONE shared
  // point every real provider's inference result passes through, so
  // discarding a leaked inference here - falling back to the tool's own
  // clean factual summary - protects all providers uniformly with no
  // provider file touched.
  if (analysis.inferenceAr && (
    looksLikeRawDataLeak(analysis.inferenceAr) || looksLikeRawDataLeak(analysis.inferenceEn) ||
    containsToolProtocolLeak(analysis.inferenceAr, getRegisteredToolNames()) || containsToolProtocolLeak(analysis.inferenceEn, getRegisteredToolNames())
  )) {
    analysis = { factualSummaryAr: analysis.factualSummaryAr, factualSummaryEn: analysis.factualSummaryEn };
  }

  const text = analysis.inferenceAr
    ? (isAr
        ? `${analysis.factualSummaryAr}\n\n💡 ${analysis.inferenceAr}`
        : `${analysis.factualSummaryEn}\n\n💡 ${analysis.inferenceEn}`)
    : (isAr ? analysis.factualSummaryAr : analysis.factualSummaryEn);

  return {
    id: newMessageId(),
    role: 'assistant',
    text,
    createdAt: new Date().toISOString(),
    toolCall: { toolName: tool.toolName, arguments: input },
    toolResult: result,
    commandType: tool.commandType,
    isFactual: !analysis.inferenceAr,
  };
}

/**
 * §1/§7/§11 - a plain-text response that merely ANNOUNCES an intended tool
 * action ("سأستخدم أداة...", "I will use the tool...") without ever making a
 * REAL structured tool call is a known LLM failure mode, especially on
 * weaker/free models - the model correctly understood the request but never
 * actually invoked anything, so no ERP data was ever fetched. Detected
 * narrowly (a SHORT response STARTING WITH a recognized announcement
 * phrase) to avoid false-positiving on a genuine longer answer that happens
 * to open with similar wording.
 */
const TOOL_ANNOUNCEMENT_PATTERNS: RegExp[] = [
  /^\s*(سأستخدم|سوف أستخدم|سأقوم باستخدام|دعني أستخدم|سأتحقق|سأبحث|دعني أتحقق|دعني أبحث|سأقوم بالبحث|سأقوم بالتحقق)/,
  /^\s*(I will use|I'll use|let me use|I will check|I'll check|let me check|I will look up|I'll look up|let me look up|I am going to use|I'm going to use)/i,
];

function looksLikeUnexecutedAnnouncement(text: string | undefined): boolean {
  if (!text || text.length > 160) return false;
  return TOOL_ANNOUNCEMENT_PATTERNS.some((p) => p.test(text));
}

/**
 * Item 6 (OpenRouter Dashboard reliability) - a SECOND, DISTINCT LLM failure
 * mode from the future-tense announcement above: mid-workflow (§5.1 - a
 * multi-part request already had at least one real completed step), the
 * model's final turn produces NO tool call but its plain text CLAIMS a
 * later action already happened ("تم تطبيق فلتر الوردية...", "Applied the
 * shift filter...") - a PAST-TENSE completion claim with nothing behind it:
 * no tool call on this turn, so nothing was actually dispatched to the
 * Dashboard. Live-reproduced against production with OpenRouter Free: the
 * model narrated "تم تطبيق فلتر الوردية في لوحة التحكم" while the
 * Dashboard's own shift dropdown never left "كل الورديات" - proving the
 * claim was false. Deliberately scoped to WORKFLOW CONTINUATION turns only
 * (never the very first turn of an ordinary message) - a real completed
 * action inside an active workflow is ALWAYS already recorded as its own
 * verified "✓" step (afterStepCompletion()), so a "تم/applied/done" opener
 * appearing INSTEAD of a real step is never legitimate: either the model
 * should have called the tool (recoverable via parseTextualToolCall above,
 * tried first), or it is fabricating completion - in both remaining cases
 * this must never reach the user unverified.
 */
// NOTE: the Arabic alternatives use a (?=\s|$) lookahead instead of \b -
// JavaScript's \b is defined in terms of \w, which never matches Arabic
// letters, so a trailing \b after an Arabic word silently never matches
// ANYTHING (verified live: it failed to catch the exact reproduced false-
// completion text "تم تطبيق فلتر الوردية..." during testing). \b is fine for
// the English alternatives below since those letters are all \w.
const UNVERIFIED_COMPLETION_CLAIM_PATTERNS: RegExp[] = [
  /^\s*(?:تم|سيتم|جارٍ|جاري|قمت بـ|قمت ب)(?=\s|$)/,
  /^\s*(applied|done|completed|updated|changed|configured|set)\b/i,
];

function looksLikeUnverifiedCompletionClaim(text: string | undefined): boolean {
  if (!text || text.length > 250) return false;
  return UNVERIFIED_COMPLETION_CLAIM_PATTERNS.some((p) => p.test(text.trim()));
}

/**
 * §1-§10/Part 2 - detects a raw structured-data leak in what should be a
 * short natural-language "inference" sentence: a JSON-object-like fragment
 * (a brace followed eventually by a quoted key and colon - "{"recordCount":"
 * etc.) which essentially never appears in genuine Arabic/English prose, or
 * simple excessive length for what buildInferencePrompt() explicitly asked
 * to be "1-2 short sentences".
 */
const RAW_DATA_LEAK_PATTERN = /\{[^{}]*"[A-Za-z_][A-Za-z0-9_]*"\s*:/;
const MAX_INFERENCE_LENGTH = 600;

function looksLikeRawDataLeak(text: string | undefined): boolean {
  if (!text) return false;
  if (text.length > MAX_INFERENCE_LENGTH) return true;
  return RAW_DATA_LEAK_PATTERN.test(text);
}

/**
 * Every real provider's generateResponse() has its OWN internal
 * `response.text || 'تعذر تنفيذ العملية.'/'Unable to complete the
 * operation.'` fallback for when callGatewayChat() comes back empty.
 * Gateway.ts must never blindly trust that literal string as if it were
 * real conversational content - every one of ITS OWN call sites below uses
 * provider.generateResponse() as a FALLBACK path, so silently accepting the
 * provider's own generic fallback string there just re-surfaces the same
 * unhelpful, non-differentiated sentence the rest of this file works hard
 * to avoid. Detecting it here (a single shared spot) instead of editing all
 * 4 real provider files keeps the fix provider-agnostic - Claude/Mock are
 * never touched, and Gemini/OpenRouter/Cloudflare all get the exact same
 * treatment automatically.
 */
const PROVIDER_GENERIC_FALLBACK_TEXTS = new Set(['تعذر تنفيذ العملية.', 'Unable to complete the operation.']);

/**
 * Part 5 - "a safety optimization, not a replacement for model reasoning":
 * exposing all 26 tools for an unmistakable "Hello" only invites an
 * accidental tool call. Matched narrowly - the WHOLE trimmed message (not a
 * substring) against a short exact/near-exact greeting-or-identity list,
 * and only up to a small length cap - so a genuine short ERP question
 * ("أفضل مكبس؟") is never misrouted into the no-tools path; anything even
 * slightly off this exact list falls through to full model reasoning with
 * the complete permitted tool set, unchanged.
 */
const GENERAL_CONVERSATION_EXACT_PHRASES = new Set([
  'hello', 'hi', 'hey', 'hi there', 'help', 'مرحبا', 'مرحباً', 'اهلا', 'أهلا', 'أهلاً', 'السلام عليكم', 'مساعدة',
]);
const GENERAL_CONVERSATION_PATTERNS: RegExp[] = [
  /^(who are you|what can you do|what are you|identify yourself)$/i,
  /^(من أنت|من انت|مين انت|مين إنت|إيه اللي تقدر تعمله|ايه اللي تقدر تعمله|ايه انت|بتعمل ايه)$/,
];

function looksLikeObviousGeneralConversation(userText: string): boolean {
  const trimmed = (userText || '').trim();
  if (!trimmed || trimmed.length > 40) return false;
  // Arabic questions end in "؟" (U+061F), not the ASCII "?" - strip either
  // (and "!"/".") before matching so both punctuation conventions work.
  const normalized = trimmed.toLowerCase().replace(/[!.؟?]+$/, '').trim();
  if (GENERAL_CONVERSATION_EXACT_PHRASES.has(normalized)) return true;
  return GENERAL_CONVERSATION_PATTERNS.some((p) => p.test(normalized));
}

async function safeGenerateResponse(
  provider: ReturnType<typeof getAIProvider>,
  userText: string,
  context: ScreenContext,
  history: AssistantMessage[]
): Promise<string | null> {
  try {
    const text = await provider.generateResponse(userText, context, history);
    if (!text || PROVIDER_GENERIC_FALLBACK_TEXTS.has(text.trim())) return null;
    if (containsToolProtocolLeak(text, getRegisteredToolNames())) return null;
    return text;
  } catch {
    return null;
  }
}

function newWorkflowId(): string {
  return `WF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Phase 5 §5.1/§5.14-§5.18 - the ONLY gate that engages the multi-step
 * workflow loop (continueWorkflow()). A message that does NOT match this
 * takes the exact pre-Phase-5 single-tool-call path, with zero extra
 * provider calls and zero behavior change - this is a cheap, local,
 * deterministic check (same style as looksLikeObviousGeneralConversation()),
 * never an LLM call of its own, so it costs nothing for the overwhelmingly
 * common single-intent message. Matched on explicit sequencing language
 * ("ثم"/"وبعدها"/"then"/"after that") OR at least two distinct recognized
 * action verbs in the same message - both are how every Phase 5 example in
 * the task itself is actually phrased.
 */
const MULTI_STEP_CONNECTORS: RegExp[] = [/\bثم\b/, /وبعدها/, /بعد كده/, /\bthen\b/i, /after that/i];
const MULTI_STEP_ACTION_VERBS: string[] = [
  'حلل', 'قارن', 'رتب', 'صدر', 'افتح', 'اعرض', 'غير', 'ابحث', 'أضف', 'اضف', 'لخص',
  'analyze', 'compare', 'rank', 'export', 'open', 'show', 'change', 'search', 'add', 'summarize',
];

function looksLikeMultiStepRequest(userText: string): boolean {
  const text = (userText || '').trim();
  if (!text) return false;
  if (MULTI_STEP_CONNECTORS.some((r) => r.test(text))) return true;
  const lower = text.toLowerCase();
  const hits = MULTI_STEP_ACTION_VERBS.filter((v) => lower.includes(v));
  return hits.length >= 2;
}

/** Phase 5 §5.1 - a bounded cap on auto-chained steps within one user turn, so a misbehaving provider can never loop indefinitely (Phase 7 §7.12 "avoid excessive provider retries"). */
const MAX_WORKFLOW_STEPS = 6;

/**
 * Workflow Execution Efficiency fix - the only tools whose SUCCESS is worth
 * remembering across steps for duplicate-detection: real UI-state mutations,
 * never a read-only query/analytics tool (asking the same analytics
 * question twice is a legitimate thing a user or a multi-part request might
 * actually want; re-applying the identical Dashboard filter is never
 * useful). Kept as a small explicit list, not schema-derived, so this can
 * never accidentally start suppressing a QUERY/ANALYSIS tool's repeat call.
 */
const DASHBOARD_MUTATION_TOOL_NAMES = new Set([
  'setDashboardDateFilter', 'setDashboardStageFilter', 'setDashboardShiftFilter',
  'setDashboardEntityFilter', 'setDashboardSort', 'setCustomDashboardFilters',
]);

/**
 * Rule 1-3 - "actual state is authoritative": an earlier step's own
 * ALREADY-VERIFIED tool.execute() success (never a fresh re-read, never the
 * model's own claim) is what "already applied" means. A later step in the
 * SAME workflow requesting the exact same mutation with the exact same
 * validated arguments is a real, structural duplicate - not a guess.
 */
function findDuplicateMutationStep(workflow: WorkflowState | undefined, toolName: string, normalizedInput: Record<string, any>): WorkflowStepRecord | undefined {
  if (!workflow || !DASHBOARD_MUTATION_TOOL_NAMES.has(toolName)) return undefined;
  const key = JSON.stringify(normalizedInput);
  return workflow.steps.find((s) => s.toolName === toolName && s.status === 'SUCCESS' && s.normalizedState !== undefined && JSON.stringify(s.normalizedState) === key);
}

/**
 * Targeted Dashboard Workflow Fix, Rule 1-9 - which of the 4 classic-
 * Dashboard mutations the ORIGINAL request explicitly named, using ONLY
 * existing deterministic extractors (extractExplicitMonthRange - the SAME
 * one executeToolCall() already uses to override date arguments;
 * detectStages - the SAME one aiDashboardDesigner.ts's AI Report Designer
 * already uses; extractShiftNumber - the SAME one masterDataTools.ts's
 * numbered-shift resolution fix already uses) - never a new NLP engine.
 * Computed ONCE at workflow creation, scoped to the classic Dashboard
 * screen only (Custom Dashboard uses a single combined-filter tool with a
 * different shape - deliberately not covered by this pass, see the final
 * report).
 */
function detectRequestedDashboardMutations(userText: string, context: ScreenContext): DashboardMutationKind[] {
  if (context.currentPage !== 'dashboard') return [];
  const kinds: DashboardMutationKind[] = [];
  if (extractExplicitMonthRange(userText)) kinds.push('date');
  if (detectStages(userText).length === 1) kinds.push('stage');
  if (extractShiftNumber(userText) !== null) kinds.push('shift');
  if (/رتب|\bsort\b/i.test(userText)) kinds.push('sort');
  return kinds;
}

const DASHBOARD_MUTATION_TOOL_TO_KIND: Partial<Record<string, DashboardMutationKind>> = {
  setDashboardDateFilter: 'date',
  setDashboardStageFilter: 'stage',
  setDashboardShiftFilter: 'shift',
  setDashboardSort: 'sort',
};

/** Rule 4 - pendingDashboardMutations = requestedDashboardMutations - verifiedCompletedMutations, where "verified" means a real (non-skipped) SUCCESS step already recorded for that kind's tool - never the model's own claim. */
function computePendingDashboardMutations(workflow: WorkflowState | undefined): DashboardMutationKind[] {
  if (!workflow?.requestedDashboardMutations?.length) return [];
  const completed = new Set(
    workflow.steps
      .filter((s) => s.status === 'SUCCESS')
      .map((s) => DASHBOARD_MUTATION_TOOL_TO_KIND[s.toolName])
      .filter((k): k is DashboardMutationKind => !!k)
  );
  return workflow.requestedDashboardMutations.filter((k) => !completed.has(k));
}

/** Small, reused keyword set (the SAME vocabulary METRIC_LABEL_AR/EN already use elsewhere) - not a new metric taxonomy, just enough to pick the sort field a "رتب حسب X" phrase actually named. Defaults to productionTons, matching both setDashboardSort's own default and the exact live-reported bug's own phrase ("رتب حسب الإنتاج"). */
function detectSortMetricFromText(userText: string): string {
  const t = userText.toLowerCase();
  if (/هالك|waste/.test(t)) return /نسبة|rate|percent/.test(t) ? 'wastePercentage' : 'wasteTons';
  if (/توقف|downtime/.test(t)) return 'downtimeMinutes';
  if (/سليم|good/.test(t)) return 'goodTons';
  if (/تشغيل|operation/.test(t)) return 'operationsCount';
  return 'productionTons';
}

/**
 * Rule 8 - turns ONE pending mutation kind into the exact tool call that
 * would apply it, reusing the SAME extractors detectRequestedDashboardMutations()
 * used to decide the kind was requested in the first place - so a kind is
 * never "pending" without also being resolvable here (both read the exact
 * same source text with the exact same functions). Returns null only if the
 * text no longer parses (should not normally happen - defensive, not relied
 * upon) - the caller falls back to letting the model's own original tool
 * choice through unblocked rather than ever forcing a broken redirect.
 */
function resolveDeterministicDashboardMutation(kind: DashboardMutationKind, userText: string): { toolName: string; arguments: Record<string, any> } | null {
  if (kind === 'date') {
    const range = extractExplicitMonthRange(userText);
    if (!range) return null;
    return { toolName: 'setDashboardDateFilter', arguments: { preset: 'namedMonth', month: Number(range.startDate.slice(5, 7)), year: Number(range.startDate.slice(0, 4)) } };
  }
  if (kind === 'stage') {
    const stages = detectStages(userText);
    if (stages.length !== 1) return null;
    return { toolName: 'setDashboardStageFilter', arguments: { stageType: stages[0] } };
  }
  if (kind === 'shift') {
    const num = extractShiftNumber(userText);
    if (num === null) return null;
    return { toolName: 'setDashboardShiftFilter', arguments: { shift: String(num) } };
  }
  if (kind === 'sort') {
    if (!/رتب|\bsort\b/i.test(userText)) return null;
    const direction = /الأقل\s*(?:ل|إلى|الى)\s*الأعلى|ascending|lowest to highest/i.test(userText) ? 'worst' : 'best';
    return { toolName: 'setDashboardSort', arguments: { field: detectSortMetricFromText(userText), direction } };
  }
  return null;
}

/**
 * Fix #2 (Data-Grounded Final Response) - a Markdown table (a row containing
 * "|" immediately followed by a canonical "|---|---|"-style separator row)
 * appearing in a NO-TOOL-CALL closing turn is never something any tool's
 * own messageAr/messageEn produces anywhere in this codebase - every tool
 * renders a plain sentence or a numbered "N. label — value" list (see
 * rankDimension()'s own Rule 8/9 format in stageReportTools.ts). Its
 * presence here can only mean the model invented its own tabular
 * presentation, with no way to verify the numbers inside it against a real
 * tool result - treated the same as a protocol leak (Rule 15/17/18/26):
 * retried once, then honestly rejected rather than shown as fact.
 */
const MARKDOWN_TABLE_SEPARATOR_ROW = /^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)+\|?[ \t]*$/m;

function looksLikeUngroundedMarkdownTable(text: string | undefined): boolean {
  if (!text) return false;
  return MARKDOWN_TABLE_SEPARATOR_ROW.test(text);
}

/** Phase 5 §5.5 - the ONE place a multi-step request's final answer is assembled: a deterministic per-step ✓/✗/○ list built directly from each step's own already-rendered result text, NEVER a blanket "workflow failed" when independent steps actually succeeded. */
function buildWorkflowCompletionMessage(workflow: WorkflowState, modelClosingText: string | undefined, isAr: boolean, capReached = false): AssistantMessage {
  const lines = workflow.steps.map((s) => `${s.status === 'SKIPPED' ? '○' : (s.success ? '✓' : '✗')} ${s.resultMessage}`);
  const capNote = capReached
    ? (isAr ? `\n(تم الوصول للحد الأقصى لعدد الخطوات التلقائية: ${MAX_WORKFLOW_STEPS})` : `\n(Reached the maximum of ${MAX_WORKFLOW_STEPS} auto-chained steps)`)
    : '';
  const header = workflow.steps.length > 1 ? (isAr ? 'ملخص الخطوات:\n' : 'Steps summary:\n') : '';
  const text = `${header}${lines.join('\n')}${capNote}${modelClosingText ? `\n\n${modelClosingText}` : ''}`;
  return {
    id: newMessageId(),
    role: 'assistant',
    text: text.trim(),
    createdAt: new Date().toISOString(),
    commandType: 'UNKNOWN',
    isFactual: true,
  };
}

export class AssistantGateway {
  constructor() {
    ensureToolsRegistered();
  }

  async handleMessage(
    userText: string,
    context: ScreenContext,
    user: AdminUser | null | undefined,
    history: AssistantMessage[]
  ): Promise<AssistantMessage> {
    const provider = getAIProvider();
    const isAr = context.currentLanguage === 'ar';

    // Part 5 - a safety optimization, never a substitute for model
    // reasoning: an unmistakable, very short greeting/identity message gets
    // no tools offered at all, since exposing the full registry to the
    // model for "Hello" only invites an accidental tool call. Anything even
    // slightly ambiguous falls through to the normal, full-reasoning path
    // below - this never decides an ERP question on its own.
    if (looksLikeObviousGeneralConversation(userText)) {
      const text = await safeGenerateResponse(provider, userText, context, history);
      return {
        id: newMessageId(),
        role: 'assistant',
        text: text || safeErrorMessage('GENERAL_CONVERSATION_FAILED', isAr),
        createdAt: new Date().toISOString(),
        commandType: 'UNKNOWN',
      };
    }

    // Phase 5 §5.1/§5.14-§5.18 - only a message that itself reads as
    // multi-part ("حلل مايو، قارن الورديات، صدر النتيجة") engages the
    // auto-chaining loop below; an ordinary single-intent message gets
    // `workflow: undefined` and continueWorkflow() behaves EXACTLY like the
    // original single-call handleMessage() did (same calls, same fallbacks,
    // zero extra provider round-trips).
    const workflow: WorkflowState | undefined = looksLikeMultiStepRequest(userText)
      ? { workflowId: newWorkflowId(), originalUserText: userText, steps: [], requestedDashboardMutations: detectRequestedDashboardMutations(userText, context) }
      : undefined;

    return this.continueWorkflow(userText, context, user, history, provider, isAr, workflow);
  }

  /**
   * Phase 5 - runs ONE turn of the (possibly multi-step) request: ask the
   * provider for the next tool call, execute it through the EXACT SAME
   * pipeline as a single-shot request (executeToolCall()), and either
   * return immediately (workflow undefined/paused/done) or recurse for the
   * next step (afterStepCompletion()). With `workflow: undefined` this is
   * byte-equivalent to the pre-Phase-5 body of handleMessage().
   */
  private async continueWorkflow(
    userText: string,
    context: ScreenContext,
    user: AdminUser | null | undefined,
    history: AssistantMessage[],
    provider: ReturnType<typeof getAIProvider>,
    isAr: boolean,
    workflow: WorkflowState | undefined
  ): Promise<AssistantMessage> {
    let turn;
    try {
      turn = await provider.generateWithTools(userText, context, listPermittedToolSummaries(user), history);
    } catch (err) {
      // §1/§27 - tool-selection failing must never be presented as the whole
      // conversation failing. A plain conversational call (no tools offered)
      // is a materially simpler request and often succeeds even when the
      // tool-selection call didn't - try it before giving up. Phase 5: if
      // earlier steps already completed, their results are preserved ahead
      // of the error (never erased by a later provider hiccup - §5.5).
      const prefix = workflow && workflow.steps.length > 0 ? `${buildWorkflowCompletionMessage(workflow, undefined, isAr).text}\n\n` : '';
      const text = await safeGenerateResponse(provider, userText, context, history);
      if (text) {
        return { id: newMessageId(), role: 'assistant', text: prefix + text, createdAt: new Date().toISOString(), commandType: 'UNKNOWN' };
      }
      return {
        id: newMessageId(),
        role: 'assistant',
        text: prefix + safeErrorMessage(workflow && workflow.steps.length > 0 ? 'WORKFLOW_FAILED' : classifyProviderError(err), isAr),
        createdAt: new Date().toISOString(),
        commandType: 'UNKNOWN',
      };
    }

    if (turn.toolCall) {
      return this.executeToolCall(turn.toolCall, turn.commandType, userText, context, user, provider, isAr, history, workflow);
    }
    // Item 6 (OpenRouter Dashboard reliability) - a "no tool call" turn is
    // ALWAYS routed through the SAME recovery/leak/announcement/completion-
    // claim safety net as the very first turn, even mid-workflow. Before
    // this fix, a workflow continuation turn's plain text was accepted as a
    // trustworthy closing remark unconditionally - live-reproduced against
    // production: a model claimed "تم تطبيق فلتر الوردية..." with no real
    // tool call behind it, and the Dashboard never actually changed.
    // handleNoToolCallResponse() below now builds the correct final message
    // itself (deterministic step summary + verified/rejected text) whether
    // or not a workflow is in progress.
    return this.handleNoToolCallResponse(turn.responseText, turn.commandType, userText, context, user, provider, isAr, history, true, workflow);
  }

  /**
   * Phase 5 §5.4/§5.5/§5.8 - the ONE place a completed step (success or
   * failure) is folded back into the workflow and the chain either resumes
   * (recurses into continueWorkflow with the step's real message appended
   * to history) or - with `workflow: undefined` - passes the message
   * through untouched, exactly as every pre-Phase-5 call site did.
   */
  private async afterStepCompletion(
    stepMessage: AssistantMessage,
    toolName: string,
    userText: string,
    context: ScreenContext,
    user: AdminUser | null | undefined,
    history: AssistantMessage[],
    workflow: WorkflowState | undefined,
    isAr: boolean,
    mutationInput?: Record<string, any>,
    isSkippedDuplicate?: boolean
  ): Promise<AssistantMessage> {
    if (!workflow) return stepMessage;
    // Part 4B interactive choice - PAUSE the chain, carry workflowState so
    // the clicked option can resume it (§5.9/§5.10 - reuses the existing
    // requestId/contextFingerprint stale-choice protection unchanged).
    if (stepMessage.choiceRequest) {
      return { ...stepMessage, workflowState: workflow };
    }
    const stepRecord: WorkflowStepRecord = {
      toolName,
      success: isSkippedDuplicate ? true : !!stepMessage.toolResult?.success,
      status: isSkippedDuplicate ? 'SKIPPED' : (stepMessage.toolResult?.success ? 'SUCCESS' : 'FAILED'),
      resultMessage: stepMessage.text,
      // Recorded ONLY for a genuine (non-skipped) successful Dashboard
      // mutation - the exact input findDuplicateMutationStep() compares a
      // LATER step's request against, never overwritten once set.
      normalizedState: (!isSkippedDuplicate && DASHBOARD_MUTATION_TOOL_NAMES.has(toolName) && stepMessage.toolResult?.success && mutationInput) ? mutationInput : undefined,
    };
    const updated: WorkflowState = { ...workflow, steps: [...workflow.steps, stepRecord] };
    // Rule 9 - a SKIPPED duplicate never consumes step budget the way a real action does.
    const realStepCount = updated.steps.filter((s) => s.status !== 'SKIPPED').length;
    if (realStepCount >= MAX_WORKFLOW_STEPS) {
      return buildWorkflowCompletionMessage(updated, undefined, isAr, true);
    }
    const provider = getAIProvider();
    return this.continueWorkflow(userText, context, user, [...history, stepMessage], provider, isAr, updated);
  }

  /**
   * Part 1/Part 2/Part 3 - the ONE authoritative place a provider's plain
   * text (no structured tool call) is judged: genuine prose, a RECOVERABLE
   * textual tool-call attempt (see toolCallNormalizer.ts), or unrecoverable
   * leaked internal protocol - never a silent guess. Replaces what used to
   * be inline, duplicated logic; also reused after the one bounded retry
   * below so a leak/announcement on the retry's own text gets the identical
   * treatment, not a second, unbounded retry loop (`allowRetry` prevents that).
   */
  private async handleNoToolCallResponse(
    responseText: string | undefined,
    turnCommandType: string,
    userText: string,
    context: ScreenContext,
    user: AdminUser | null | undefined,
    provider: ReturnType<typeof getAIProvider>,
    isAr: boolean,
    history: AssistantMessage[],
    allowRetry: boolean,
    workflow?: WorkflowState
  ): Promise<AssistantMessage> {
    const registeredToolNames = getRegisteredToolNames();

    // Part 2 - a weak/free model's failed attempt to use native structured
    // tool_calls, but whose text still cleanly names a REAL, REGISTERED
    // tool with parseable arguments, becomes a genuine successful execution
    // instead of a wasted turn - routed through the EXACT SAME
    // executeToolCall() pipeline (Permission Guard, date injection,
    // validation, confirmation, Tool Registry) as a native tool call. Never
    // a shortcut: parseTextualToolCall() only ever returns a candidate whose
    // name is an exact registry match, and execution still runs the full
    // pipeline from scratch.
    const recovered = parseTextualToolCall(responseText, registeredToolNames);
    if (recovered) {
      return this.executeToolCall({ toolName: recovered.toolName, arguments: recovered.arguments }, turnCommandType, userText, context, user, provider, isAr, history, workflow);
    }

    const isLeak = containsToolProtocolLeak(responseText, registeredToolNames);
    const isAnnouncement = looksLikeUnexecutedAnnouncement(responseText);
    // Item 6 - a PAST-TENSE "I already did X" claim with no tool call behind
    // it is only ever suspicious mid-workflow (§ doc on
    // looksLikeUnverifiedCompletionClaim above) - a real completed action
    // would already exist as its own verified "✓" step by this point.
    const isUnverifiedClaim = !!workflow && workflow.steps.length > 0 && looksLikeUnverifiedCompletionClaim(responseText);
    // Fix #2 (Data-Grounded Final Response) - a Markdown table in the
    // model's own closing prose is never something any tool actually
    // produces, so its numbers can never be verified against a real result.
    const isUngroundedTable = looksLikeUngroundedMarkdownTable(responseText);

    // §1/§7/§11/Part 2/Part 3/Item 6/Fix 2 - leaked protocol, a bare "I will
    // use tool X" announcement, an unverified "I already did X" claim, or an
    // ungrounded Markdown table of invented numbers may never reach the
    // user as if it were a complete answer - give the model exactly one
    // bounded retry.
    if ((isLeak || isAnnouncement || isUnverifiedClaim || isUngroundedTable) && allowRetry) {
      try {
        const retryTurn = await provider.generateWithTools(userText, context, listPermittedToolSummaries(user), history);
        if (retryTurn.toolCall) {
          return this.executeToolCall(retryTurn.toolCall, retryTurn.commandType, userText, context, user, provider, isAr, history, workflow);
        }
        return this.handleNoToolCallResponse(retryTurn.responseText, retryTurn.commandType, userText, context, user, provider, isAr, history, false, workflow);
      } catch {
        // fall through to the honest fallback below
      }
    }

    if (isLeak || isAnnouncement || isUnverifiedClaim || isUngroundedTable) {
      // §5.5/Item 6 - never let an unbacked claim erase real, already-
      // verified steps: prefix the deterministic step summary (if any)
      // ahead of the honest "could not complete" fallback.
      const prefix = workflow && workflow.steps.length > 0 ? `${buildWorkflowCompletionMessage(workflow, undefined, isAr).text}\n\n` : '';
      return {
        id: newMessageId(),
        role: 'assistant',
        text: prefix + safeErrorMessage('TOOL_NOT_COMPLETED', isAr),
        createdAt: new Date().toISOString(),
        commandType: turnCommandType as any,
      };
    }

    // Genuine prose, verified against every check above - mid-workflow this
    // is the model's real closing remark, shown alongside (never instead
    // of) the deterministic per-step summary (§5.5); otherwise unchanged
    // pre-Phase-5 behavior.
    if (workflow && workflow.steps.length > 0) {
      return buildWorkflowCompletionMessage(workflow, responseText, isAr);
    }
    const text = responseText || (await safeGenerateResponse(provider, userText, context, history)) || safeErrorMessage('GENERAL_CONVERSATION_FAILED', isAr);
    return {
      id: newMessageId(),
      role: 'assistant',
      text,
      createdAt: new Date().toISOString(),
      commandType: turnCommandType as any,
    };
  }

  /**
   * §3/§5/§7/§9/Part 6 - everything from tool resolution through execution,
   * wrapped in ONE top-level safety net. Before this fix, an uncaught
   * exception ANYWHERE in this block (permission check, date injection,
   * validation, preview building, or an error escaping runToolAndRespond()
   * itself) rejected the whole handleMessage() promise - and the UI's
   * handleSend() awaits it inside try{...}finally{} with NO catch, so
   * pushMessage() never ran and the user was left staring at whatever
   * message was already on screen (e.g. the model's own preceding "سأستخدم
   * الأداة..." announcement from the SAME turn), with no visible error and
   * no result. This method now ALWAYS resolves to a real AssistantMessage.
   */
  private async executeToolCall(
    toolCall: { toolName: string; arguments: Record<string, any> },
    turnCommandType: string,
    userText: string,
    context: ScreenContext,
    user: AdminUser | null | undefined,
    provider: ReturnType<typeof getAIProvider>,
    isAr: boolean,
    history: AssistantMessage[],
    workflow?: WorkflowState
  ): Promise<AssistantMessage> {
    try {
      const tool = getTool(toolCall.toolName);
      if (!tool) {
        // §1/§18/§27 - an unrecognized/hallucinated tool name (weaker models
        // occasionally guess a plausible-sounding tool that isn't registered)
        // must not hard-fail the whole message - fall back to a plain
        // conversational answer, exactly like the NAVIGATION validation-failure
        // fallback below.
        const fallbackText = await safeGenerateResponse(provider, userText, context, history);
        return {
          id: newMessageId(),
          role: 'assistant',
          text: fallbackText || safeErrorMessage('GENERAL_CONVERSATION_FAILED', isAr),
          createdAt: new Date().toISOString(),
          commandType: 'UNKNOWN',
        };
      }

      // Targeted Dashboard Workflow Fix, Rule 1-9 - an explicit Dashboard-
      // mutation request must finish its own pending mutations before
      // spending workflow steps on an unrelated QUERY/ANALYSIS tool (live
      // evidence: the model repeatedly called getProductionByStage/
      // searchMasterData while the user's explicitly-named stage/shift were
      // never actually applied). Redirects to the NEXT pending mutation
      // using the exact same deterministic extractors that decided it was
      // requested in the first place - if that redirect can't be resolved
      // (defensive - should not normally happen), the model's original
      // tool choice proceeds unblocked rather than ever forcing a dead end.
      if (workflow && (tool.commandType === 'QUERY' || tool.commandType === 'ANALYSIS')) {
        const pending = computePendingDashboardMutations(workflow);
        if (pending.length > 0) {
          const redirect = resolveDeterministicDashboardMutation(pending[0], workflow.originalUserText);
          if (redirect && getTool(redirect.toolName)) {
            return this.executeToolCall(redirect, 'NAVIGATION', userText, context, user, provider, isAr, history, workflow);
          }
        }
      }

      // §7/§10/§13 - a user-named month ("مايو 2026", "شهر 5 - 2026") must
      // become explicit, deterministic dates REGARDLESS of what the model did
      // with them - if it omitted startDate/endDate, or computed something
      // else, the app's own extraction from the RAW user text overrides it for
      // any tool whose schema declares startDate/endDate (data-driven, not a
      // hardcoded tool-name list - covers every ranking/query/analysis/export
      // tool that supports date filtering; a tool like comparePeriods, whose
      // schema uses nested periodA/periodB instead, is correctly left alone -
      // a single month reference can't safely resolve which of two periods it
      // belongs to). Relative phrases ("آخر 30 يوم", "آخر 5 شهور") are not
      // month references and extractExplicitMonthRange() returns null for
      // them, leaving resolveDateRange()'s own default/model-computed path
      // untouched - the deterministic resolver owns explicit months only.
      const dateSchemaProps = tool.parameterSchema?.properties as Record<string, any> | undefined;
      if (dateSchemaProps?.startDate && dateSchemaProps?.endDate) {
        const explicitMonth = extractExplicitMonthRange(userText);
        if (explicitMonth) {
          toolCall.arguments = {
            ...toolCall.arguments,
            startDate: explicitMonth.startDate,
            endDate: explicitMonth.endDate,
          };
        }
      }

      // Permission Guard - runs BEFORE validation/execution, exactly per the architecture.
      const permission = checkToolPermission(tool, user);
      if (!permission.allowed) {
        await auditAssistantAction({
          userId: context.currentUserId || 'unknown',
          screen: context.currentPage,
          module: context.currentModule,
          tool: tool.toolName,
          safeParametersSummary: safeParametersSummary(toolCall.arguments),
          result: 'DENIED',
          affectedCount: 0,
          success: false,
          confirmationUsed: false,
        });
        return {
          id: newMessageId(),
          role: 'assistant',
          text: isAr ? permission.reasonAr : permission.reasonEn,
          createdAt: new Date().toISOString(),
          toolCall,
          commandType: tool.commandType,
        };
      }

      // Validation Layer.
      const validation = tool.inputSchema(toolCall.arguments);
      if (!validation.valid) {
        // §15 - screen/page context is supplemental, never a hard prerequisite
        // for ordinary conversation. A NAVIGATION call is the one class of
        // tool failure that is always safe to swallow into a normal
        // conversational reply instead of a raw error: it carries no data risk,
        // and a bad/unsupported page argument almost always means the model
        // misfired on a generic message (e.g. "hello") rather than the user
        // actually asking to navigate - so fall back instead of blocking chat.
        if (tool.commandType === 'NAVIGATION') {
          const fallbackText = await safeGenerateResponse(provider, userText, context, history);
          return {
            id: newMessageId(),
            role: 'assistant',
            text: fallbackText || safeErrorMessage('GENERAL_CONVERSATION_FAILED', isAr),
            createdAt: new Date().toISOString(),
            commandType: 'UNKNOWN',
          };
        }
        return {
          id: newMessageId(),
          role: 'assistant',
          text: `${safeErrorMessage('INVALID_REQUEST', isAr)} ${(validation.errors || []).join(' ')}`.trim(),
          createdAt: new Date().toISOString(),
          toolCall,
          commandType: tool.commandType,
        };
      }

      // Workflow Execution Efficiency fix (Rule 1-4/9/13) - a Dashboard
      // mutation tool requested with the EXACT SAME validated arguments as
      // an already-successful step earlier in THIS SAME workflow is a real,
      // structural no-op (never re-executed, never billed against the step
      // budget) - live-reproduced against production: OpenRouter Free
      // called setDashboardDateFilter with identical arguments 3 times in
      // one request, burning half its step budget before ever reaching the
      // stage/shift/sort parts of the same combined command.
      const duplicateOf = findDuplicateMutationStep(workflow, tool.toolName, validation.value);
      if (duplicateOf) {
        const skippedMessage: AssistantMessage = {
          id: newMessageId(),
          role: 'assistant',
          text: isAr
            ? `${duplicateOf.resultMessage} (مطبق بالفعل - لا حاجة للتكرار)`
            : `${duplicateOf.resultMessage} (already applied - no repeat needed)`,
          createdAt: new Date().toISOString(),
          toolCall: { toolName: tool.toolName, arguments: validation.value },
          commandType: tool.commandType,
          isFactual: true,
        };
        return this.afterStepCompletion(skippedMessage, tool.toolName, userText, context, user, history, workflow, isAr, undefined, true);
      }

      // Risk classification / confirmation policy.
      if (needsConfirmation(tool, validation.value)) {
        const preview = await buildPreview(tool, validation.value, context);
        // §4/§9 - each item below has its OWN independent decision; this line
        // is never phrased as one global "add them all?" gate - it only tells
        // the user how many items need their attention and why.
        const blockedCount = preview.items.length - preview.affectedRecordCount;
        const text = isAr
          ? (preview.items.length > 1
              ? `يوجد ${preview.items.length} عنصر مطلوب - راجع قرار كل عنصر على حدة أدناه (${blockedCount > 0 ? `${blockedCount} موجود/غير مؤكد لن يُنشأ من جديد بأي حال، ` : ''}${preview.affectedRecordCount} جديد قابل للإضافة) ثم اضغط تنفيذ.`
              : `${blockedCount > 0 ? 'هذا العنصر موجود بالفعل - راجع التفاصيل أدناه.' : 'راجع تفاصيل هذا العنصر أدناه ثم اعتمد قرارك.'}`)
          : (preview.items.length > 1
              ? `${preview.items.length} item(s) requested - review each item's own decision below (${blockedCount > 0 ? `${blockedCount} existing/unresolved will never be recreated, ` : ''}${preview.affectedRecordCount} new and eligible), then press Execute.`
              : `${blockedCount > 0 ? 'This item already exists - review the details below.' : 'Review this item below, then set your decision.'}`);
        return {
          id: newMessageId(),
          role: 'assistant',
          text,
          createdAt: new Date().toISOString(),
          toolCall: { toolName: tool.toolName, arguments: validation.value },
          commandType: tool.commandType,
          requiresConfirmation: true,
          actionPreview: preview,
          // Phase 5 §5.8/§5.9 - PAUSE here carries the in-progress workflow
          // so confirming resumes the remaining chain instead of ending it.
          workflowState: workflow,
        };
      }

      const stepMessage = await runToolAndRespond(tool, validation.value, context, user, false);
      return this.afterStepCompletion(stepMessage, tool.toolName, userText, context, user, history, workflow, isAr, validation.value);
    } catch {
      // Top-level safety net - see this method's docstring. Never a silent rejection.
      return {
        id: newMessageId(),
        role: 'assistant',
        text: safeErrorMessage('TOOL_PIPELINE_FAILED', isAr),
        createdAt: new Date().toISOString(),
        commandType: turnCommandType as any,
      };
    }
  }

  async confirmPendingAction(
    preview: ActionPreview,
    context: ScreenContext,
    user: AdminUser | null | undefined,
    history: AssistantMessage[] = [],
    workflowState?: WorkflowState
  ): Promise<AssistantMessage> {
    const isAr = context.currentLanguage === 'ar';
    const tool = getTool(preview.toolCall.toolName);
    if (!tool) {
      return {
        id: newMessageId(),
        role: 'assistant',
        text: safeErrorMessage('INVALID_REQUEST', isAr),
        createdAt: new Date().toISOString(),
      };
    }
    // Re-check permission at confirmation time too (defense in depth).
    const permission = checkToolPermission(tool, user);
    if (!permission.allowed) {
      return {
        id: newMessageId(),
        role: 'assistant',
        text: isAr ? permission.reasonAr : permission.reasonEn,
        createdAt: new Date().toISOString(),
      };
    }
    const stepMessage = await runToolAndRespond(tool, preview.toolCall.arguments, context, user, true);
    // Phase 5 §5.8 - resumes the remaining chain when this confirmation was
    // paused mid-workflow; with no workflowState (the pre-Phase-5 case) this
    // returns stepMessage untouched.
    return this.afterStepCompletion(stepMessage, tool.toolName, workflowState?.originalUserText || '', context, user, history, workflowState, isAr);
  }

  /**
   * Phase 4B Part 4/§8/Part 11 - applies a FULLY-RESOLVED tool call (name +
   * arguments already known, e.g. from a clicked interactive choice option)
   * through the EXACT SAME Permission Guard -> Validation -> Tool Registry
   * pipeline as a normal LLM-issued tool call, just skipping the "ask the
   * model which tool to use" step - nothing about a deterministic button
   * click needs the model's interpretation, and skipping it also means a
   * misbehaving provider can never distort an already-fully-specified
   * action. Never a bypass of permission checks or auditing:
   * runToolAndRespond() below still audits ACTION/EXPORT/NAVIGATION tools
   * exactly as any other execution path does.
   */
  async runResolvedToolCall(
    toolName: string,
    args: Record<string, any>,
    context: ScreenContext,
    user: AdminUser | null | undefined,
    history: AssistantMessage[] = [],
    workflowState?: WorkflowState
  ): Promise<AssistantMessage> {
    const isAr = context.currentLanguage === 'ar';
    const tool = getTool(toolName);
    if (!tool) {
      return { id: newMessageId(), role: 'assistant', text: safeErrorMessage('INVALID_REQUEST', isAr), createdAt: new Date().toISOString() };
    }
    const permission = checkToolPermission(tool, user);
    if (!permission.allowed) {
      return { id: newMessageId(), role: 'assistant', text: isAr ? permission.reasonAr : permission.reasonEn, createdAt: new Date().toISOString() };
    }
    const validation = tool.inputSchema(args);
    if (!validation.valid) {
      return {
        id: newMessageId(),
        role: 'assistant',
        text: `${safeErrorMessage('INVALID_REQUEST', isAr)} ${(validation.errors || []).join(' ')}`.trim(),
        createdAt: new Date().toISOString(),
      };
    }
    const stepMessage = await runToolAndRespond(tool, validation.value, context, user, true);
    // Phase 5 §5.8/§5.9 - resumes the remaining chain when this choice
    // resolution was paused mid-workflow (e.g. a chart-type pick); with no
    // workflowState this returns stepMessage untouched (Phase 4B behavior).
    return this.afterStepCompletion(stepMessage, tool.toolName, workflowState?.originalUserText || '', context, user, history, workflowState, isAr);
  }

  /**
   * Phase 5 §5.7 - deliberately NEVER resumes a workflow, even when
   * `workflowState` is passed for a better message: cancelling a pending
   * write must stop the chain there. Steps that already completed before
   * this pause stay completed (their real messages are already in the
   * conversation) - cancel only prevents the ONE pending write and
   * everything that would have come after it.
   */
  async cancelPendingAction(preview: ActionPreview, context: ScreenContext, workflowState?: WorkflowState): Promise<AssistantMessage> {
    await auditAssistantAction({
      userId: context.currentUserId || 'unknown',
      screen: context.currentPage,
      module: context.currentModule,
      tool: preview.toolCall.toolName,
      safeParametersSummary: safeParametersSummary(preview.toolCall.arguments),
      result: 'CANCELLED',
      affectedCount: 0,
      success: false,
      confirmationUsed: false,
    });
    const isAr = context.currentLanguage === 'ar';
    const text = workflowState && workflowState.steps.length > 0
      ? safeErrorMessage('WORKFLOW_CANCELLED', isAr)
      : (isAr ? 'تم إلغاء العملية.' : 'The action was cancelled.');
    return {
      id: newMessageId(),
      role: 'assistant',
      text,
      createdAt: new Date().toISOString(),
    };
  }
}

let sharedGateway: AssistantGateway | null = null;
export function getAssistantGateway(): AssistantGateway {
  if (!sharedGateway) sharedGateway = new AssistantGateway();
  return sharedGateway;
}

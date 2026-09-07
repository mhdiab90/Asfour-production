/**
 * ASFOUR AI Assistant - Core Types
 *
 * Provider-agnostic architecture:
 *   User -> Global Assistant UI -> Assistant Gateway -> AIProvider abstraction
 *   -> Tool Registry -> Permission Guard -> Validation -> ERP Services -> Firestore
 *
 * The AIProvider NEVER touches Firestore, ERP services, or arbitrary JS execution.
 * It only ever produces a ToolCallRequest (a tool name + arguments) which the
 * Gateway resolves against the Tool Registry, permission-checks, validates,
 * and executes through existing ERP services.
 */
import { PermissionKey, GranularPermissions } from '../types/permissions';
import { NavigationPage } from '../types';

export type RiskLevel = 'LOW_RISK' | 'MEDIUM_RISK' | 'HIGH_RISK';

/** When a tool requires the user to explicitly confirm before execution. */
export type ConfirmationPolicy =
  | 'NONE'
  | 'ALWAYS'
  | 'WHEN_MULTIPLE_RECORDS';

export type CommandType = 'QUERY' | 'ANALYSIS' | 'ACTION' | 'EXPORT' | 'NAVIGATION' | 'UNKNOWN';

/** Structured, minimal screen context - never the whole database. */
export interface ScreenContext {
  currentPage: NavigationPage | string;
  currentModule: string;
  currentStage?: string;
  currentUserId?: string;
  currentEmployeeId?: string;
  currentRole?: string;
  currentPermissions?: Partial<GranularPermissions>;
  currentLanguage: 'ar' | 'en';
  selectedRecordId?: string;
  selectedEntityType?: string;
  selectedFilters?: Record<string, any>;
  selectedDateRange?: { startDate?: string; endDate?: string };
}

export interface ToolCallRequest {
  toolName: string;
  arguments: Record<string, any>;
}

export interface ToolExecutionResult<T = any> {
  success: boolean;
  data?: T;
  affectedCount?: number;
  /** Bilingual, safe (no secrets) human-readable summary of what happened. */
  messageAr?: string;
  messageEn?: string;
  errorCode?: string;
  /** Phase 4B Part 4/Part 11 - a tool that needs the user to pick ONE of several named options before anything is applied (chart type, ambiguous chart/dashboard target) attaches this instead of (or alongside) success/message - see AssistantChoiceRequest. */
  choiceRequest?: AssistantChoiceRequest;
}

/** One clickable, safe option in an interactive choice request - never free text the model re-interprets. */
export interface AssistantChoiceOption {
  /** Safe value substituted into `resolution.argKey` when chosen - e.g. a ChartType like 'BAR', never arbitrary text. */
  id: string;
  labelAr: string;
  labelEn: string;
  descriptionAr?: string;
  descriptionEn?: string;
}

/**
 * Phase 4B Part 4/§7-9/Part 11 - a typed interactive-choice message a tool
 * result can carry when the next step genuinely needs the user to pick ONE
 * of several named, safe options (chart type, which chart to change, which
 * dashboard was meant). Rendered as real clickable buttons by GlobalAssistant
 * (never "type the option name") and resolved via
 * AssistantGateway.runResolvedToolCall() - the SAME permission-guarded
 * execution pipeline as any other tool call, bypassing the LLM entirely
 * since a clicked choice needs no further interpretation.
 */
export interface AssistantChoiceRequest {
  /** Correlates this choice to the turn that produced it (§25) - a click on a stale/superseded choice message is rejected, never applied (§26). */
  requestId: string;
  questionAr: string;
  questionEn: string;
  options: AssistantChoiceOption[];
  /** The tool call to run when an option is picked: {...baseArguments, [argKey]: option.id}. */
  resolution: { toolName: string; argKey: string; baseArguments: Record<string, any> };
  /**
   * A short string identifying the screen state this choice was generated
   * for (e.g. "dashboardId:widgetId"). Recomputed fresh from the LIVE screen
   * context at click time and compared before applying - if the user
   * switched dashboards/widgets since this choice was shown, the click is
   * safely rejected instead of silently modifying the wrong target (§26).
   */
  contextFingerprint: string;
}

export interface ToolValidationResult<TInput = any> {
  valid: boolean;
  errors?: string[];
  value?: TInput;
}

/**
 * A single, centrally-registered, typed tool. This is the ONLY way the AI
 * provider can ever cause a side effect - it can never write to Firestore,
 * run arbitrary JS, or run arbitrary Firestore queries.
 */
export interface ToolDefinition<TInput = any, TResult = any> {
  toolName: string;
  descriptionAr: string;
  descriptionEn: string;
  commandType: CommandType;
  riskLevel: RiskLevel;
  confirmationPolicy: ConfirmationPolicy;
  /** Any one of these existing granular permissions (or SUPER_ADMIN) is sufficient. No parallel permission model. */
  requiredPermission: PermissionKey[];
  /** Also allow when the equivalent page is accessible (used by read-only query/analysis tools). */
  requiredPage?: NavigationPage;
  /**
   * Declarative JSON Schema (Anthropic tool-use `input_schema` shape) describing
   * this tool's arguments to a real LLM provider so it knows what to send.
   * Optional because MockProvider needs no schema (keyword matching only) -
   * but every tool a real provider should be able to call declares one.
   * This is advisory only: `inputSchema()` above is still the sole source of
   * truth for validation and runs regardless of what the model sent.
   */
  parameterSchema?: Record<string, any>;
  inputSchema: (input: any) => ToolValidationResult<TInput>;
  execute: (input: TInput, context: ScreenContext) => Promise<ToolExecutionResult<TResult>>;
  /**
   * Optional read-only preview builder, used by the Gateway to show
   * Action/Target/Existing items/New items/Affected count BEFORE executing
   * a MEDIUM/HIGH risk or multi-record action, per the confirmation UI.
   */
  buildPreview?: (input: TInput, context: ScreenContext) => Promise<{
    targetSummaryAr: string;
    targetSummaryEn: string;
    items: PreviewItem[];
  }>;
}

export interface ToolSummary {
  toolName: string;
  descriptionAr: string;
  descriptionEn: string;
  commandType: CommandType;
  /** JSON Schema for this tool's arguments, if the tool declares one (see ToolDefinition.parameterSchema). */
  parameterSchema?: Record<string, any>;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: string;
  toolCall?: ToolCallRequest;
  toolResult?: ToolExecutionResult;
  commandType?: CommandType;
  /** true = derived directly from tool/ERP data (fact); false = AI interpretation (inference). */
  isFactual?: boolean;
  requiresConfirmation?: boolean;
  actionPreview?: ActionPreview;
  /** Phase 4B - present when this reply asks the user to pick one of several named options (see AssistantChoiceRequest). */
  choiceRequest?: AssistantChoiceRequest;
  /** Phase 5 - present when this reply PAUSED a multi-part request mid-chain (awaiting confirmation or a choice) - the UI must pass it back on confirm/choice so the Gateway can resume the remaining steps instead of restarting (see WorkflowState). */
  workflowState?: WorkflowState;
}

/** Phase 5 - one completed step within an auto-chained multi-part request (§5.2/§5.5). Deliberately minimal: no tool arguments/raw result stored here (already covered by the individual AssistantMessage already pushed into conversation history) - just enough to render an honest, deterministic per-step summary line. */
export interface WorkflowStepRecord {
  toolName: string;
  success: boolean;
  /** Workflow Execution Efficiency fix - 'SKIPPED' marks a step the Gateway itself declined to re-execute because an earlier step in this SAME workflow already succeeded with the identical normalized arguments (a real duplicate, never a guess) - it never consumes MAX_WORKFLOW_STEPS budget the way a real SUCCESS/FAILED step does. */
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  /** The step's own already-rendered (current-language) summary text - reused verbatim, never re-translated or re-interpreted. */
  resultMessage: string;
  /** Workflow Execution Efficiency fix - the tool's OWN validated input arguments, recorded ONLY for a real (non-skipped) SUCCESS on one of the Dashboard-mutation tools, so a LATER step in this SAME workflow that requests the exact same mutation can be recognized as a no-op and skipped instead of re-executed (Rule 1-3: the earlier step's own verified tool.execute() success is the "actual state", never a fresh guess). */
  normalizedState?: Record<string, any>;
}

/**
 * Phase 5 - internal-only state for a multi-part request ("حلل مايو، قارن
 * الورديات، صدر النتيجة") auto-chained across several tool calls within one
 * user turn. NOT a tool, NOT persisted, NOT a general execution engine -
 * a bounded, linear accumulator the Gateway threads through
 * continueWorkflow()/afterStepCompletion() so a step that needs confirmation
 * or an interactive choice can PAUSE and later RESUME the remaining chain
 * (§5.8) instead of restarting it. Only ever engaged when the Gateway's own
 * looksLikeMultiStepRequest() recognizes explicit sequencing language in the
 * user's text - an ordinary single-intent message never touches this (zero
 * extra provider calls, behavior identical to before Phase 5).
 */
/** Targeted Dashboard Workflow Fix - the 4 classic-Dashboard mutation categories, each backed by exactly one existing tool (setDashboardDateFilter/setDashboardStageFilter/setDashboardShiftFilter/setDashboardSort). */
export type DashboardMutationKind = 'date' | 'stage' | 'shift' | 'sort';

export interface WorkflowState {
  workflowId: string;
  originalUserText: string;
  steps: WorkflowStepRecord[];
  /** Targeted Dashboard Workflow Fix - which of the 4 kinds the ORIGINAL request explicitly named, computed ONCE at workflow creation via existing deterministic extractors (never re-derived from the model's own interpretation). Empty/undefined for a request with no explicit classic-Dashboard mutation intent, leaving all prior behavior untouched. */
  requestedDashboardMutations?: DashboardMutationKind[];
}

export type PreviewItemStatus = 'NEW' | 'ALREADY_EXISTS' | 'LIKELY_DUPLICATE' | 'AMBIGUOUS' | 'INVALID';

/**
 * One requested item's own independent status/message, shown separately in
 * the confirmation UI - a mixed batch (some existing, some new) must never
 * be collapsed into a single generic "some exist, some are new" sentence.
 */
export interface PreviewItem {
  /** Normalized (trimmed, lowercased) value - lets the UI filter this item out of toolCall.arguments if the user deselects it before confirming. */
  key: string;
  /** The raw value as requested, for display. */
  displayValue: string;
  status: PreviewItemStatus;
  messageAr: string;
  messageEn: string;
  /** AMBIGUOUS only - the actual candidates found; never auto-selected. */
  candidates?: Array<{ name: string; code: string; confidence: number }>;
}

/** Shown to the user before a MEDIUM/HIGH risk or multi-record action executes. */
export interface ActionPreview {
  actionLabelAr: string;
  actionLabelEn: string;
  toolCall: ToolCallRequest;
  targetSummaryAr: string;
  targetSummaryEn: string;
  /** Independent per-item status/message - see PreviewItem. */
  items: PreviewItem[];
  affectedRecordCount: number;
  riskLevel: RiskLevel;
}

/** One turn of provider output: either a direct answer, or a request to call one tool. */
export interface AIProviderTurn {
  commandType: CommandType;
  toolCall?: ToolCallRequest;
  /** Direct text answer when no tool call is needed (or provider commentary). */
  responseText?: string;
}

export interface ToolResultAnalysis {
  factualSummaryAr: string;
  factualSummaryEn: string;
  inferenceAr?: string;
  inferenceEn?: string;
}

/**
 * Provider-neutral interface. ClaudeProvider / GeminiProvider / MockProvider
 * all implement this identically from the Gateway's point of view - the rest
 * of the application never knows which one is active.
 */
export interface AIProvider {
  readonly providerId: 'mock' | 'claude' | 'gemini' | string;
  readonly isConfigured: boolean;

  /** Classify the user's free text and, if applicable, produce ONE tool call request. */
  generateWithTools(
    userText: string,
    context: ScreenContext,
    availableTools: ToolSummary[],
    history: AssistantMessage[]
  ): Promise<AIProviderTurn>;

  /** Turn a tool's structured, factual result into a human-readable response. */
  analyzeToolResult(
    toolName: string,
    result: ToolExecutionResult,
    context: ScreenContext
  ): Promise<ToolResultAnalysis>;

  /** Plain conversational response when no tool is applicable. */
  generateResponse(userText: string, context: ScreenContext, history: AssistantMessage[]): Promise<string>;

  /** Optional streaming - providers that can't stream just call onChunk once. */
  streamResponse?(userText: string, context: ScreenContext, onChunk: (chunk: string) => void): Promise<void>;
}

/** §23 - one requested value's own outcome, for the audit trail's item-level breakdown. */
export interface AuditItemResult {
  requestedValue: string;
  status: PreviewItemStatus;
  decision: 'CREATE' | 'SKIP';
  result: 'CREATED' | 'NOT_CREATED' | 'FAILED';
}

export interface AssistantActionAuditEntry {
  assistantActionId: string;
  userId: string;
  timestamp: string;
  screen: string;
  module: string;
  tool: string;
  safeParametersSummary: string;
  result: 'SUCCESS' | 'FAILURE' | 'DENIED' | 'CANCELLED';
  affectedCount: number;
  success: boolean;
  confirmationUsed: boolean;
  /** The active AI provider at the time of this action - never a secret, just an id like "claude"/"gemini". */
  provider?: string;
  /** §23 - per-item breakdown when the tool's result carries one (batch create tools); omitted otherwise. */
  itemResults?: AuditItemResult[];
}

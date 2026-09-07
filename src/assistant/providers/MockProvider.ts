/**
 * MockProvider - a deterministic, local, pattern-matching "AI" used to
 * exercise the entire assistant pipeline (UI, tool registry, permission
 * guard, validation, execution, audit) WITHOUT any real AI provider or API
 * key. This is the default provider (AI_PROVIDER = "mock").
 *
 * It intentionally does simple keyword/pattern parsing - it is not meant to
 * be smart, only to prove the architecture end-to-end and let developers
 * test locally. ClaudeProvider/GeminiProvider implement the exact same
 * AIProvider interface and can replace this without touching any tool code.
 */
import { parseMultiCodeValue, parseFurnaceCarBrickPairs } from '../../utils/multiCodeParser';
import { ALL_STAGES, getStageDisplayName } from '../../services/reportingEngine';
import {
  AIProvider,
  AIProviderTurn,
  AssistantMessage,
  CommandType,
  ScreenContext,
  ToolCallRequest,
  ToolExecutionResult,
  ToolResultAnalysis,
  ToolSummary,
} from '../types';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
function toWesternDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function lastMonthRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 86400000);
  const firstOfPrevMonth = new Date(lastOfPrevMonth.getFullYear(), lastOfPrevMonth.getMonth(), 1);
  return { startDate: firstOfPrevMonth.toISOString().slice(0, 10), endDate: lastOfPrevMonth.toISOString().slice(0, 10) };
}

const ADD_KEYWORDS = ['أضف', 'اضف', 'إضافة', 'ضيف', 'add', 'create'];
const EXPORT_KEYWORDS = ['صدر', 'تصدير', 'export'];
const EXCEL_KEYWORDS = ['excel', 'اكسل', 'إكسل', 'xlsx'];
const REPORT_KEYWORDS = ['تقرير', 'report'];
const MAKE_REPORT_KEYWORDS = ['اعمل', 'أعمل', 'انشئ', 'أنشئ', 'جهز', 'حضر', 'make', 'generate', 'build'];
const NAV_KEYWORDS = ['افتح', 'اذهب', 'انتقل', 'open', 'go to', 'navigate'];
const WHY_KEYWORDS = ['لماذا', 'ليش', 'سبب', 'why'];
const PRODUCTION_KEYWORDS = ['إنتاج', 'انتاج', 'production'];
const BEST_KEYWORDS = ['أفضل', 'افضل', 'best', 'top'];
const WORST_KEYWORDS = ['أسوأ', 'اسوأ', 'أقل', 'اقل', 'worst', 'bottom', 'lowest'];
const EMPLOYEE_Q_KEYWORDS = ['موظف', 'عامل', 'عمال', 'employee', 'worker'];
const SHIFT_Q_KEYWORDS = ['وردية', 'ورديات', 'shift'];
const EQUIPMENT_Q_KEYWORDS = ['مكبس', 'مكابس', 'فرن', 'آلة', 'press', 'furnace', 'machine', 'equipment'];
const PRODUCT_Q_KEYWORDS = ['منتج', 'أصناف', 'صنف', 'product'];
const COMPARE_KEYWORDS = ['قارن', 'مقارنة', 'compare', 'مقابل', ' vs '];
const STAGE_Q_KEYWORDS = ['مرحلة', 'مراحل', 'stage'];
// Connector words used to recognize a bare conversational follow-up
// ("وكمان 602") as a continuation of the previous ACTION, per the
// short-lived session-context requirement (no explicit verb repeated).
const CONTINUATION_HINT_MAX_LENGTH = 40;

const DOMAIN_HINTS: Array<{ toolName: string; keywords: string[]; moduleHints: string[] }> = [
  { toolName: 'addFurnaceCars', keywords: ['عربة', 'عربات', 'furnace car', 'furnacecar'], moduleHints: ['furnacecars', 'furnace-cars', 'furnace_cars'] },
  { toolName: 'addPresses', keywords: ['مكبس', 'مكابس', 'press'], moduleHints: ['presses', 'press'] },
  { toolName: 'addShifts', keywords: ['وردية', 'ورديات', 'shift'], moduleHints: ['shifts', 'shift'] },
  { toolName: 'addEmployees', keywords: ['موظف', 'عامل', 'عمال', 'employee'], moduleHints: ['employees', 'employee'] },
  { toolName: 'addProducts', keywords: ['صنف', 'أصناف', 'منتج', 'product'], moduleHints: ['products', 'product'] },
  { toolName: 'addCustomers', keywords: ['عميل', 'عملاء', 'customer'], moduleHints: ['customers', 'customer'] },
];

const PAGE_HINTS: Array<{ page: string; keywords: string[] }> = [
  { page: 'production-entry', keywords: ['المكابس', 'مكبس', 'press', 'production-entry', 'تسجيل الإنتاج'] },
  { page: 'dashboard', keywords: ['لوحة التحكم', 'dashboard'] },
  { page: 'master-data', keywords: ['البيانات الأساسية', 'master data', 'master-data'] },
  { page: 'historical-import', keywords: ['الاستيراد', 'استيراد', 'import'] },
  { page: 'reports', keywords: ['التقارير', 'تقرير', 'reports'] },
  { page: 'backup-restore', keywords: ['النسخ الاحتياطي', 'استعادة', 'backup', 'restore'] },
  { page: 'production-records', keywords: ['سجلات الإنتاج', 'production-records', 'production records'] },
];

function extractCodeListSubstring(text: string): string | null {
  // Matches runs of digit/letter tokens joined by -, /, ,, ، or spaces, e.g. "209/201/602"
  const match = text.match(/[0-9A-Za-z٠-٩]+(?:[\s,،/\-]+[0-9A-Za-z٠-٩]+)+|[0-9A-Za-z٠-٩]{2,}/g);
  if (!match) return null;
  // Prefer the longest match (most likely the actual code list, not a stray number)
  return match.sort((a, b) => b.length - a.length)[0];
}

function detectDomainFromContext(context: ScreenContext): string | null {
  const hay = `${context.currentPage} ${context.currentModule} ${context.selectedEntityType || ''}`.toLowerCase();
  for (const d of DOMAIN_HINTS) {
    if (d.moduleHints.some((h) => hay.includes(h))) return d.toolName;
  }
  return null;
}

function detectDomainFromText(text: string): string | null {
  const lower = text.toLowerCase();
  for (const d of DOMAIN_HINTS) {
    if (d.keywords.some((k) => lower.includes(k))) return d.toolName;
  }
  return null;
}

function detectDomainFromHistory(history: AssistantMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i].toolCall?.toolName;
    if (t && DOMAIN_HINTS.some((d) => d.toolName === t)) return t;
  }
  return null;
}

/**
 * Furnace Car + Brick Count extraction from free text, e.g.:
 *   "أضف العربة 278 وعدد الطوب عليها 453"
 *   "أضف العربات 278 عليها 453 طوبة و254 عليها 880"
 *   "add car 278 with 453 bricks"
 * Produces structured { carNumber, brickCount } pairs - brickCount is NEVER
 * interpreted as another furnace car. Falls back to the structured
 * "CAR-BRICKS/CAR-BRICKS" pair format (parseFurnaceCarBrickPairs) if no
 * natural-language phrasing is found.
 */
function extractFurnaceCarBrickPairsFromText(text: string): Array<{ carNumber: string; brickCount: number }> {
  const pairs: Array<{ carNumber: string; brickCount: number }> = [];

  const arRegex = /(\d+)\s*(?:و\s*)?(?:عدد\s*الطوب\s*)?عليه[اه]?\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = arRegex.exec(text)) !== null) {
    pairs.push({ carNumber: m[1], brickCount: parseInt(m[2], 10) });
  }
  if (pairs.length > 0) return pairs;

  const enRegex = /(\d+)\s*(?:with|has|carrying)?\s*(\d+)\s*bricks?/gi;
  while ((m = enRegex.exec(text)) !== null) {
    pairs.push({ carNumber: m[1], brickCount: parseInt(m[2], 10) });
  }
  if (pairs.length > 0) return pairs;

  const codeSubstring = extractCodeListSubstring(text);
  if (codeSubstring) {
    return parseFurnaceCarBrickPairs(codeSubstring)
      .filter((p) => p.isValid)
      .map((p) => ({ carNumber: p.carNumber, brickCount: p.brickCount as number }));
  }
  return [];
}

function classifyAndBuildToolCall(userText: string, context: ScreenContext, history: AssistantMessage[]): AIProviderTurn {
  const text = toWesternDigits(userText.trim());
  const lower = text.toLowerCase();

  // ---- ACTION: add master data (multi-code aware) ----
  if (ADD_KEYWORDS.some((k) => lower.includes(k))) {
    const codeSubstring = extractCodeListSubstring(text);
    const domainTool = detectDomainFromText(text) || detectDomainFromContext(context) || detectDomainFromHistory(history);

    if (domainTool === 'addFurnaceCars') {
      // Furnace Cars now use the CAR-BRICKS pair format, never the old flat
      // multi-code split - "أضف العربات 278 عليها 453 طوبة و254 عليها 880"
      // must produce structured pairs, not four independent car codes.
      const pairs = extractFurnaceCarBrickPairsFromText(text);
      if (pairs.length > 0) {
        return { commandType: 'ACTION', toolCall: { toolName: 'addFurnaceCars', arguments: { pairs } } };
      }
    }
    if (codeSubstring && domainTool === 'addPresses') {
      const tokens = parseMultiCodeValue(codeSubstring, 'press').tokens; // single-entity: never hyphen-split
      return { commandType: 'ACTION', toolCall: { toolName: 'addPresses', arguments: { codes: tokens } } };
    }
    if (codeSubstring && domainTool === 'addShifts') {
      return { commandType: 'ACTION', toolCall: { toolName: 'addShifts', arguments: { codes: [codeSubstring.trim()] } } };
    }
    if (codeSubstring && (domainTool === 'addEmployees' || domainTool === 'addCustomers')) {
      return {
        commandType: 'ACTION',
        toolCall: { toolName: domainTool, arguments: { items: [{ name: codeSubstring.trim() }] } },
      };
    }
    if (codeSubstring && domainTool === 'addProducts') {
      const tokens = parseMultiCodeValue(codeSubstring, 'product').tokens; // single-entity: never split
      return { commandType: 'ACTION', toolCall: { toolName: 'addProducts', arguments: { items: tokens.map((c) => ({ code: c })) } } };
    }

    if (codeSubstring && !domainTool) {
      return {
        commandType: 'ACTION',
        responseText:
          'لم أستطع تحديد نوع البيان المطلوب إضافته (عربة فرن؟ مكبس؟ موظف؟). يرجى التوضيح أو فتح الشاشة المناسبة أولاً. / ' +
          "I couldn't determine which entity type to add (furnace car? press? employee?). Please clarify, or open the relevant screen first.",
      };
    }
  }

  // ---- NAVIGATION ----
  if (NAV_KEYWORDS.some((k) => lower.includes(k))) {
    const hit = PAGE_HINTS.find((p) => p.keywords.some((k) => lower.includes(k.toLowerCase())));
    if (hit) {
      return { commandType: 'NAVIGATION', toolCall: { toolName: 'navigateToPage', arguments: { page: hit.page } } };
    }
  }

  // ---- EXPORT / REPORT GENERATION ("صدر ... إلى Excel" OR "اعمل تقرير ...") ----
  const wantsReport =
    EXPORT_KEYWORDS.some((k) => lower.includes(k)) ||
    EXCEL_KEYWORDS.some((k) => lower.includes(k)) ||
    (REPORT_KEYWORDS.some((k) => lower.includes(k)) && MAKE_REPORT_KEYWORDS.some((k) => lower.includes(k)));

  if (wantsReport) {
    let reportType: 'production' | 'waste' | 'downtime' | 'faults' = 'production';
    if (lower.includes('هالك') || lower.includes('waste')) reportType = 'waste';
    else if (lower.includes('توقف') || lower.includes('downtime')) reportType = 'downtime';
    else if (lower.includes('أعطال') || lower.includes('اعطال') || lower.includes('fault')) reportType = 'faults';

    let dateArgs: Record<string, string> = {};
    if (lower.includes('الشهر') || lower.includes('month')) dateArgs = lastMonthRange();
    else if (lower.includes('الأسبوع') || lower.includes('week')) dateArgs = { startDate: isoDaysAgo(7), endDate: todayIso() };
    else if (lower.includes('اليوم') || lower.includes('today')) dateArgs = { startDate: todayIso(), endDate: todayIso() };

    return {
      commandType: 'EXPORT',
      toolCall: { toolName: 'exportReportToExcel', arguments: { reportType, ...dateArgs } },
    };
  }

  // ---- ANALYSIS (why / cause) ----
  if (WHY_KEYWORDS.some((k) => lower.includes(k)) && PRODUCTION_KEYWORDS.some((k) => lower.includes(k))) {
    let dateArgs: Record<string, string> = { startDate: isoDaysAgo(14), endDate: todayIso() };
    if (lower.includes('الأسبوع') || lower.includes('week')) dateArgs = { startDate: isoDaysAgo(14), endDate: todayIso() };
    return { commandType: 'ANALYSIS', toolCall: { toolName: 'analyzeProductionTrend', arguments: dateArgs } };
  }

  // ---- COMPARISON ("قارن الوردية 1 والوردية 2", "compare press A and press B", "قارن بين مرحلتي...") ----
  if (COMPARE_KEYWORDS.some((k) => lower.includes(k))) {
    let dateArgs: Record<string, string> = {};
    if (lower.includes('الشهر') || lower.includes('month')) dateArgs = lastMonthRange();
    else if (lower.includes('الأسبوع') || lower.includes('week')) dateArgs = { startDate: isoDaysAgo(7), endDate: todayIso() };

    if (STAGE_Q_KEYWORDS.some((k) => lower.includes(k))) {
      const matchedStages = ALL_STAGES.filter((s) =>
        lower.includes(s) || lower.includes(getStageDisplayName(s, 'ar').toLowerCase()) || lower.includes(getStageDisplayName(s, 'en').toLowerCase())
      );
      if (matchedStages.length >= 2) {
        return { commandType: 'ANALYSIS', toolCall: { toolName: 'compareStages', arguments: { stages: matchedStages, ...dateArgs } } };
      }
      return {
        commandType: 'ANALYSIS',
        responseText:
          'يرجى تحديد اسم مرحلتين على الأقل للمقارنة (مثال: "قارن التشكيل والمكابس بالفرن الدوار"). / ' +
          'Please name at least two stages to compare (e.g. "compare Pressing and Rotary Furnace").',
      };
    }
    if (EQUIPMENT_Q_KEYWORDS.some((k) => lower.includes(k))) {
      return { commandType: 'ANALYSIS', toolCall: { toolName: 'comparePresses', arguments: dateArgs } };
    }
    // Default comparison target is shifts (§30 example: "Compare Shift 1 vs Shift 2 vs Shift 3").
    return { commandType: 'ANALYSIS', toolCall: { toolName: 'compareShifts', arguments: dateArgs } };
  }

  // ---- RANKING ("مين أفضل موظف؟", "which press is best?", "أسوأ وردية") ----
  if (BEST_KEYWORDS.some((k) => lower.includes(k)) || WORST_KEYWORDS.some((k) => lower.includes(k))) {
    const direction = WORST_KEYWORDS.some((k) => lower.includes(k)) ? 'worst' : 'best';
    let dateArgs: Record<string, string> = {};
    if (lower.includes('الشهر') || lower.includes('month')) dateArgs = lastMonthRange();
    else if (lower.includes('الأسبوع') || lower.includes('week')) dateArgs = { startDate: isoDaysAgo(7), endDate: todayIso() };
    else if (lower.includes('اليوم') || lower.includes('today')) dateArgs = { startDate: todayIso(), endDate: todayIso() };

    let toolName: string | null = null;
    if (EMPLOYEE_Q_KEYWORDS.some((k) => lower.includes(k))) toolName = 'getTopEmployees';
    else if (SHIFT_Q_KEYWORDS.some((k) => lower.includes(k))) toolName = 'getTopShifts';
    else if (EQUIPMENT_Q_KEYWORDS.some((k) => lower.includes(k))) toolName = 'getTopPresses';
    else if (PRODUCT_Q_KEYWORDS.some((k) => lower.includes(k))) toolName = 'getTopProducts';

    if (toolName) {
      return { commandType: 'ANALYSIS', toolCall: { toolName, arguments: { direction, ...dateArgs } } };
    }
  }

  // ---- QUERY (production numbers) ----
  if (PRODUCTION_KEYWORDS.some((k) => lower.includes(k))) {
    if (lower.includes('اليوم') || lower.includes('today')) {
      return { commandType: 'QUERY', toolCall: { toolName: 'getProductionByDate', arguments: { date: todayIso() } } };
    }
    if (lower.includes('أمس') || lower.includes('yesterday')) {
      return { commandType: 'QUERY', toolCall: { toolName: 'getProductionByDate', arguments: { date: isoDaysAgo(1) } } };
    }
    if (lower.includes('الأسبوع') || lower.includes('week')) {
      return { commandType: 'QUERY', toolCall: { toolName: 'getProductionSummary', arguments: { startDate: isoDaysAgo(7), endDate: todayIso() } } };
    }
    return { commandType: 'QUERY', toolCall: { toolName: 'getProductionSummary', arguments: {} } };
  }

  // ---- Conversational continuation ("أضف العربة 209" ... then "وكمان 602") ----
  // A short follow-up with no recognized verb, but a bare code list, after a
  // prior ACTION-type add tool call in this session, is treated as adding
  // the same entity type again - per the short-lived conversation-context
  // requirement. Deliberately checked LAST so it never overrides a stronger
  // NAV/EXPORT/ANALYSIS/QUERY classification, and only for short messages so
  // it doesn't misfire on an unrelated sentence that happens to contain a number.
  if (text.length <= CONTINUATION_HINT_MAX_LENGTH) {
    const priorAddDomain = detectDomainFromHistory(history);
    const bareCodeSubstring = extractCodeListSubstring(text);
    if (priorAddDomain && bareCodeSubstring) {
      if (priorAddDomain === 'addFurnaceCars') {
        // A bare follow-up ("وكمان 602") carries no brick count - extract
        // car numbers only (never the old flat multi-code split, so
        // "602-450" here is still read as ONE car+brickCount pair, not two cars).
        const brickPairs = extractFurnaceCarBrickPairsFromText(text);
        if (brickPairs.length > 0) {
          return { commandType: 'ACTION', toolCall: { toolName: 'addFurnaceCars', arguments: { pairs: brickPairs } } };
        }
        const tokens = parseFurnaceCarBrickPairs(bareCodeSubstring).map((p) => p.carNumber).filter(Boolean);
        return { commandType: 'ACTION', toolCall: { toolName: 'addFurnaceCars', arguments: { codes: tokens } } };
      }
      if (priorAddDomain === 'addPresses') {
        const tokens = parseMultiCodeValue(bareCodeSubstring, 'press').tokens;
        return { commandType: 'ACTION', toolCall: { toolName: 'addPresses', arguments: { codes: tokens } } };
      }
      if (priorAddDomain === 'addShifts') {
        return { commandType: 'ACTION', toolCall: { toolName: 'addShifts', arguments: { codes: [bareCodeSubstring.trim()] } } };
      }
      if (priorAddDomain === 'addProducts') {
        const tokens = parseMultiCodeValue(bareCodeSubstring, 'product').tokens;
        return { commandType: 'ACTION', toolCall: { toolName: 'addProducts', arguments: { items: tokens.map((c) => ({ code: c })) } } };
      }
      if (priorAddDomain === 'addEmployees' || priorAddDomain === 'addCustomers') {
        return { commandType: 'ACTION', toolCall: { toolName: priorAddDomain, arguments: { items: [{ name: bareCodeSubstring.trim() }] } } };
      }
    }
  }

  return {
    commandType: 'UNKNOWN',
    responseText:
      'يمكنني مساعدتك في استعلامات الإنتاج، التحليل، إضافة بيانات أساسية، التصدير إلى Excel، والتنقل بين الشاشات. جرّب مثلاً: "ما إنتاج اليوم؟" / ' +
      'I can help with production queries, analysis, adding master data, Excel export, and navigation. Try e.g. "What is today\'s production?"',
  };
}

export class MockProvider implements AIProvider {
  readonly providerId = 'mock' as const;
  readonly isConfigured = true; // always usable, no credentials needed

  async generateWithTools(
    userText: string,
    context: ScreenContext,
    _availableTools: ToolSummary[],
    history: AssistantMessage[]
  ): Promise<AIProviderTurn> {
    return classifyAndBuildToolCall(userText, context, history);
  }

  async analyzeToolResult(toolName: string, result: ToolExecutionResult, context: ScreenContext): Promise<ToolResultAnalysis> {
    const factualSummaryAr = result.messageAr || 'تم تنفيذ العملية.';
    const factualSummaryEn = result.messageEn || 'Operation completed.';

    // Only ANALYSIS-type tool results get an inference sentence, and it is
    // always explicitly templated/hedged - MockProvider never invents a
    // specific causal claim, since it has no real reasoning capability.
    const isAnalysis = toolName.startsWith('analyze') || toolName.startsWith('compare');
    if (!result.success || !isAnalysis) {
      return { factualSummaryAr, factualSummaryEn };
    }

    return {
      factualSummaryAr,
      factualSummaryEn,
      inferenceAr: '(تفسير آلي مبدئي - يتطلب مزود ذكاء اصطناعي حقيقي لتحليل أعمق) قد تكون الأرقام أعلاه مرتبطة بعدة عوامل تشغيلية؛ راجع البيانات التفصيلية أعلاه لتأكيد السبب.',
      inferenceEn:
        '(preliminary automated note - a real AI provider is needed for deeper analysis) The figures above may relate to several operational factors; review the detailed data to confirm the cause.',
    };
  }

  async generateResponse(userText: string, context: ScreenContext, _history: AssistantMessage[]): Promise<string> {
    return context.currentLanguage === 'ar'
      ? 'هذا رد تجريبي من المزود المحلي (Mock). لم يتم التعرف على أمر أو استعلام محدد في رسالتك.'
      : 'This is a local Mock provider response. No specific command or query was recognized in your message.';
  }

  async streamResponse(userText: string, context: ScreenContext, onChunk: (chunk: string) => void): Promise<void> {
    const text = await this.generateResponse(userText, context, []);
    onChunk(text);
  }
}

/**
 * AI Assistant screen (full-page layout).
 *
 * This screen used to run its own, separate AI logic (askFactoryAI() in
 * services/aiService.ts) that read the raw `production` Firestore
 * collection directly on every question, with no per-query permission
 * check, no audit trail, and no Tool Registry - a second, disconnected "AI
 * brain" alongside the floating Global Assistant. That direct-Firestore
 * path has been removed from the active AI execution path entirely: this
 * screen now drives the SAME AssistantGateway / Tool Registry / Permission
 * Guard / ERP services as the floating Global Assistant
 * (src/components/assistant/GlobalAssistant.tsx) - there is exactly one
 * authoritative AI architecture in this application.
 */
import React, { useState } from 'react';
import {
  Sparkles,
  Send,
  Bot,
  User,
  Lightbulb,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Copy,
  Check,
} from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { getAssistantGateway, buildScreenContext } from '../../assistant';
import { ActionPreview, AssistantMessage, PreviewItemStatus } from '../../assistant/types';

/** Visual treatment per per-item preview status - shared shape with GlobalAssistant.tsx's own copy (each screen owns its confirmation card, same as the rest of this block). */
const PREVIEW_STATUS_STYLE: Record<PreviewItemStatus, { box: string; text: string; labelAr: string; labelEn: string }> = {
  NEW: { box: 'border-emerald-300 bg-emerald-50', text: 'text-emerald-700', labelAr: 'جديد', labelEn: 'New' },
  ALREADY_EXISTS: { box: 'border-slate-300 bg-slate-100', text: 'text-slate-600', labelAr: 'موجود بالفعل', labelEn: 'Already exists' },
  LIKELY_DUPLICATE: { box: 'border-slate-300 bg-slate-100', text: 'text-slate-600', labelAr: 'يشبه موجود', labelEn: 'Resembles existing' },
  AMBIGUOUS: { box: 'border-amber-400 bg-amber-100', text: 'text-amber-800', labelAr: 'غير مؤكد', labelEn: 'Ambiguous' },
  INVALID: { box: 'border-rose-300 bg-rose-50', text: 'text-rose-600', labelAr: 'غير صالح', labelEn: 'Invalid' },
};

/**
 * §1-§4/§20-§22 - each requested item carries its OWN independent decision.
 * Only NEW items are ever decidable (APPROVED/SKIPPED) since they're the
 * only category whose choice changes the outcome - existing/likely-
 * duplicate/ambiguous/invalid items are never created no matter what (the
 * tool's own execute() re-derives their status independently of anything
 * sent here), so giving them clickable "decision" buttons would be
 * decoration, not a real choice. NEW items default to APPROVED so a single
 * new item needs no extra click, but each can be flipped to SKIPPED
 * independently - changing one item's decision never touches another's.
 */
type ItemDecision = 'APPROVED' | 'SKIPPED';

/**
 * Only APPROVED NEW items are kept in the execution payload - §22: the
 * payload must contain only approved create items, never the full original
 * request. Checks BOTH `code` and `name` on an items[] entry (not `code ||
 * name`, which would pick the wrong field) because different tools key their
 * PreviewItem differently: addProducts keys by CODE (previewCodeItems),
 * while addCustomers/addEmployees key by NAME (previewNamedItems) - when
 * code and name differ (e.g. a customer added with an explicit code), a
 * code-first check would silently drop an item the user approved.
 */
function buildApprovedArguments(args: Record<string, any>, approvedKeys: Set<string>): Record<string, any> {
  const next: Record<string, any> = { ...args };
  if (Array.isArray(next.codes)) {
    next.codes = next.codes.filter((c: string) => approvedKeys.has(String(c).trim().toLowerCase()));
  }
  if (Array.isArray(next.items)) {
    next.items = next.items.filter((i: any) => {
      const codeKey = String(i.code || '').trim().toLowerCase();
      const nameKey = String(i.name || '').trim().toLowerCase();
      return approvedKeys.has(codeKey) || approvedKeys.has(nameKey);
    });
  }
  return next;
}

const SUGGESTED_QUERIES: Record<'ar' | 'en', string[]> = {
  ar: [
    'ما هو أكثر سبب أعطال أثر على الإنتاج هذا الشهر؟',
    'مين أفضل موظف خلال آخر 30 يوم؟',
    'ما هي الوردية الأعلى إنتاجية؟',
    'ما هي نسبة الهالك هذا الأسبوع؟',
    'اعمل تقرير إنتاج آخر 30 يوم',
  ],
  en: [
    'What was the top downtime cause affecting production this month?',
    'Who is the best employee over the last 30 days?',
    'Which shift has the highest productivity?',
    'What is the waste rate this week?',
    'Build a production report for the last 30 days',
  ],
};

export const AIAssistantView: React.FC = () => {
  const { language, isRtl } = useLanguage();
  const { adminUser } = useAuth();

  const tr = {
    engineLabel: language === 'ar' ? 'محرك التحليل الذكي لمصنع عصفور (ASFOUR Factory Intelligence)' : 'ASFOUR Factory Intelligence Engine',
    title: language === 'ar' ? 'المساعد الذكي وتحليلات اللغة الطبيعية' : 'AI Assistant & Natural Language Analytics',
    subtitle: language === 'ar' ? 'اطرح أي استفسار حول الإنتاج، الأعطال، الهالك، أو أضف بيانات أساسية' : 'Ask about production, faults, waste, or add master data',
    suggestedQuestions: language === 'ar' ? 'أسئلة مقترحة:' : 'Suggested Questions:',
    analyzing: language === 'ar' ? 'جاري المعالجة...' : 'Processing...',
    inputPlaceholder: language === 'ar' ? 'اكتب سؤالك أو طلبك هنا...' : 'Type your question or request...',
    send: language === 'ar' ? 'إرسال' : 'Send',
    welcome: language === 'ar'
      ? 'أهلاً بك في المساعد الذكي لمصنع عصفور للحراريات! 🏭\nيمكنك سؤالي عن الإنتاج، الهالك، الأعطال، أو إضافة بيانات أساسية.'
      : 'Welcome to the ASFOUR Refractories AI Assistant! 🏭\nAsk me about production, waste, faults, or add master data.',
    // §4/§14 - never a global "Confirm All"; this button only EXECUTES
    // whatever each item's own decision already is, it does not itself
    // approve anything.
    executeApproved: language === 'ar' ? 'تنفيذ القرارات المعتمدة' : 'Execute Approved Decisions',
    createDashboard: language === 'ar' ? 'إنشاء اللوحة' : 'Create Dashboard',
    cancelAll: language === 'ar' ? 'إلغاء' : 'Cancel',
    approve: language === 'ar' ? 'تأكيد الإضافة' : 'Confirm Add',
    reject: language === 'ar' ? 'عدم الإضافة' : "Don't Add",
    riskLabel: language === 'ar' ? 'مستوى الخطورة: ' : 'Risk level: ',
  };

  const isAr = language === 'ar';
  const gateway = getAssistantGateway();
  const context = buildScreenContext({ currentPage: 'ai-assistant', adminUser, language });

  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [messages, setMessages] = useState<AssistantMessage[]>([
    { id: 'welcome', role: 'assistant', text: tr.welcome, createdAt: new Date().toISOString() },
  ]);
  const [pendingConfirmation, setPendingConfirmation] = useState<ActionPreview | null>(null);
  // §1-§4 - one independent decision per NEW item, keyed by PreviewItem.key.
  // Absence of an entry means the default (APPROVED) for that item.
  const [itemDecisions, setItemDecisions] = useState<Record<string, ItemDecision>>({});
  /** Consolidated UX pass Item 2 - transient per-message copy feedback, mirrors GlobalAssistant.tsx's identical affordance. */
  const [copyState, setCopyState] = useState<{ id: string; ok: boolean } | null>(null);

  const pushMessage = (msg: AssistantMessage) => setMessages((prev) => [...prev, msg]);

  /** Copies ONLY the human-readable reply text (`msg.text`) - never tool calls/results/JSON/internal IDs. */
  const handleCopyMessage = async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ id: messageId, ok: true });
    } catch {
      setCopyState({ id: messageId, ok: false });
    }
    setTimeout(() => setCopyState((prev) => (prev?.id === messageId ? null : prev)), 2000);
  };

  const handleSend = async (questionToSend?: string) => {
    const text = questionToSend || query;
    if (!text.trim() || isLoading) return;

    const userMsg: AssistantMessage = { id: `MSG-${Date.now()}-u`, role: 'user', text, createdAt: new Date().toISOString() };
    pushMessage(userMsg);
    setQuery('');
    setPendingConfirmation(null);
    setItemDecisions({});
    setIsLoading(true);

    try {
      const reply = await gateway.handleMessage(text, context, adminUser, [...messages, userMsg]);
      pushMessage(reply);
      if (reply.requiresConfirmation && reply.actionPreview) {
        setPendingConfirmation(reply.actionPreview);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // §20/§21 - changing one item's decision never affects any other item's
  // decision, and the execution payload always reflects the CURRENT state
  // (computed fresh at execute time below), never a stale snapshot.
  const setItemDecision = (key: string, decision: ItemDecision) => {
    setItemDecisions((prev) => ({ ...prev, [key]: decision }));
  };

  const handleExecuteApproved = async () => {
    if (!pendingConfirmation) return;
    setIsLoading(true);
    try {
      // §6/§7/§22 - the payload contains ONLY items that are (a) NEW and
      // (b) currently APPROVED - existing/likely-duplicate/ambiguous/invalid
      // items are never included regardless of any decision, and execute()
      // independently re-checks each approved item immediately before write.
      const approvedKeys = new Set(
        pendingConfirmation.items
          .filter((i) => i.status === 'NEW' && (itemDecisions[i.key] ?? 'APPROVED') === 'APPROVED')
          .map((i) => i.key)
      );
      const approvedArgs = buildApprovedArguments(pendingConfirmation.toolCall.arguments, approvedKeys);
      const previewToRun: ActionPreview = { ...pendingConfirmation, toolCall: { ...pendingConfirmation.toolCall, arguments: approvedArgs } };
      const reply = await gateway.confirmPendingAction(previewToRun, context, adminUser);
      pushMessage(reply);
    } finally {
      setPendingConfirmation(null);
      setItemDecisions({});
      setIsLoading(false);
    }
  };

  const handleCancelAll = async () => {
    if (!pendingConfirmation) return;
    const reply = await gateway.cancelPendingAction(pendingConfirmation, context);
    pushMessage(reply);
    setPendingConfirmation(null);
    setItemDecisions({});
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="bg-gradient-to-r from-red-600 to-rose-700 p-6 rounded-3xl text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold mb-3">
            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
            {tr.engineLabel}
          </div>
          <h1 className="text-2xl font-black mb-1">{tr.title}</h1>
          <p className="text-xs text-red-100 max-w-2xl">{tr.subtitle}</p>
        </div>
      </div>

      {/* Suggested Quick Queries */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-thin">
        <span className="text-xs font-bold text-slate-500 whitespace-nowrap flex items-center gap-1">
          <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
          {tr.suggestedQuestions}
        </span>
        {SUGGESTED_QUERIES[language].map((sq, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => handleSend(sq)}
            className="px-3.5 py-1.5 bg-white hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-200 hover:border-red-200 rounded-xl text-xs font-bold whitespace-nowrap transition-all shadow-2xs cursor-pointer"
          >
            {sq}
          </button>
        ))}
      </div>

      {/* Chat Messages Log */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-4 sm:p-6 min-h-[420px] max-h-[600px] overflow-y-auto space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex items-start gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 font-bold ${
              msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-red-600 text-white'
            }`}>
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-5 h-5" />}
            </div>
            <div className={`max-w-[85%] sm:max-w-2xl rounded-2xl p-4 text-xs whitespace-pre-wrap leading-relaxed ${
              msg.role === 'user' ? 'bg-slate-900 text-white' : 'bg-slate-50 border border-slate-200 text-slate-900'
            }`}>
              <div className="flex items-start gap-1.5">
                <span className="flex-1 min-w-0">{msg.text}</span>
                {msg.role === 'assistant' && msg.text && (
                  <button
                    type="button"
                    onClick={() => handleCopyMessage(msg.id, msg.text)}
                    title={
                      copyState?.id === msg.id
                        ? (copyState.ok ? (isAr ? 'تم النسخ' : 'Copied') : (isAr ? 'تعذر نسخ النص. حاول مرة أخرى.' : 'Could not copy text. Try again.'))
                        : (isAr ? 'نسخ' : 'Copy')
                    }
                    aria-label={isAr ? 'نسخ' : 'Copy'}
                    className={`shrink-0 p-1 rounded-md cursor-pointer transition-colors ${
                      copyState?.id === msg.id
                        ? (copyState.ok ? 'text-emerald-600' : 'text-rose-500')
                        : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/60'
                    }`}
                  >
                    {copyState?.id === msg.id && copyState.ok ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  </button>
                )}
              </div>
              {copyState?.id === msg.id && (
                <div className={`mt-0.5 text-[10px] font-bold ${copyState.ok ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {copyState.ok ? (isAr ? 'تم النسخ' : 'Copied') : (isAr ? 'تعذر نسخ النص. حاول مرة أخرى.' : 'Could not copy text. Try again.')}
                </div>
              )}
              {msg.toolResult && (
                // Presentation Fix §9/§10 - a small status affordance only
                // (real ERP data succeeded/failed); the internal tool name
                // (e.g. "getTopEmployees") is never shown to normal users.
                <div className={`mt-1.5 flex items-center gap-1 text-[10px] ${msg.toolResult.success ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {msg.toolResult.success ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                </div>
              )}
            </div>
          </div>
        ))}

        {pendingConfirmation && (
          <div className="border border-amber-300 bg-amber-50 rounded-2xl p-4 text-xs space-y-2 max-w-2xl">
            <div className="flex items-center gap-1.5 font-bold text-amber-800">
              <ShieldCheck className="w-4 h-4" />
              <span>{isAr ? pendingConfirmation.actionLabelAr : pendingConfirmation.actionLabelEn}</span>
            </div>
            <div className="text-slate-700">{isAr ? pendingConfirmation.targetSummaryAr : pendingConfirmation.targetSummaryEn}</div>

            {/* §1-§4/§19 - every item is its own independent card; only NEW items get a real decision toggle since they're the only category whose choice changes the outcome. */}
            <div className="space-y-1.5">
              {pendingConfirmation.items.map((item) => {
                const style = PREVIEW_STATUS_STYLE[item.status];
                const isNew = item.status === 'NEW';
                const decision: ItemDecision = itemDecisions[item.key] ?? 'APPROVED';
                return (
                  <div key={`${item.key}-${item.displayValue}`} className={`rounded-lg border p-2 ${style.box}`}>
                    <div className={`font-bold ${style.text}`}>{item.displayValue} — {isAr ? style.labelAr : style.labelEn}</div>
                    <div className="text-slate-600">{isAr ? item.messageAr : item.messageEn}</div>
                    {isNew ? (
                      <div className="flex items-center gap-1.5 pt-1.5">
                        <button
                          type="button"
                          onClick={() => setItemDecision(item.key, 'APPROVED')}
                          className={`px-2.5 py-1 rounded-md font-bold text-[11px] cursor-pointer ${
                            decision === 'APPROVED' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:border-emerald-400'
                          }`}
                        >
                          {tr.approve}
                        </button>
                        <button
                          type="button"
                          onClick={() => setItemDecision(item.key, 'SKIPPED')}
                          className={`px-2.5 py-1 rounded-md font-bold text-[11px] cursor-pointer ${
                            decision === 'SKIPPED' ? 'bg-slate-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:border-slate-400'
                          }`}
                        >
                          {tr.reject}
                        </button>
                      </div>
                    ) : (
                      <div className="text-[10px] text-slate-500 pt-1">
                        {isAr ? 'لن يتم إنشاء نسخة جديدة لهذا العنصر.' : 'No new record will be created for this item.'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* §5 - informational summary only, never a second approval gate. */}
            {(() => {
              const total = pendingConfirmation.items.length;
              const existingCount = pendingConfirmation.items.filter((i) => i.status === 'ALREADY_EXISTS' || i.status === 'LIKELY_DUPLICATE').length;
              const newItems = pendingConfirmation.items.filter((i) => i.status === 'NEW');
              const approvedItems = newItems.filter((i) => (itemDecisions[i.key] ?? 'APPROVED') === 'APPROVED');
              const skippedItems = newItems.filter((i) => (itemDecisions[i.key] ?? 'APPROVED') === 'SKIPPED');
              return (
                <div className="text-[10px] text-slate-500 border-t border-amber-200 pt-1.5 space-y-0.5">
                  <div>{isAr ? `إجمالي الطلبات: ${total}` : `Total requested: ${total}`}</div>
                  {approvedItems.length > 0 && (
                    <div>{isAr ? 'سيتم الإضافة: ' : 'Will be added: '}{approvedItems.map((i) => i.displayValue).join('، ')}</div>
                  )}
                  {(skippedItems.length > 0 || existingCount > 0) && (
                    <div>
                      {isAr ? 'لن تتم الإضافة: ' : 'Will NOT be added: '}
                      {[...skippedItems.map((i) => i.displayValue), ...pendingConfirmation.items.filter((i) => i.status !== 'NEW').map((i) => i.displayValue)].join('، ')}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="text-[10px] text-slate-500">{tr.riskLabel}<span className="font-bold">{pendingConfirmation.riskLevel}</span></div>
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={handleExecuteApproved} disabled={isLoading} className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold disabled:opacity-50 cursor-pointer">
                {pendingConfirmation.toolCall.toolName === 'createCustomDashboard' ? tr.createDashboard : tr.executeApproved}
              </button>
              <button type="button" onClick={handleCancelAll} disabled={isLoading} className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-bold disabled:opacity-50 cursor-pointer">
                {tr.cancelAll}
              </button>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-2xl bg-red-600 text-white flex items-center justify-center">
              <Bot className="w-5 h-5" />
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex items-center gap-2 text-xs font-bold text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin text-red-600" />
              {tr.analyzing}
            </div>
          </div>
        )}
      </div>

      {/* Input Bar */}
      <form
        onSubmit={(e) => { e.preventDefault(); handleSend(); }}
        className="bg-white rounded-2xl border border-slate-200 p-2 shadow-sm flex items-center gap-2"
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={tr.inputPlaceholder}
          className="flex-1 px-4 py-2.5 text-xs bg-transparent border-none outline-none font-bold text-slate-900 placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className="flex items-center gap-1.5 px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-all cursor-pointer"
        >
          <Send className={`w-3.5 h-3.5 ${isRtl ? 'rotate-180' : ''}`} />
          {tr.send}
        </button>
      </form>
    </div>
  );
};

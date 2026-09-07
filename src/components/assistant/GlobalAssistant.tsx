/**
 * Global floating AI Assistant - button + panel. Mounted once, globally,
 * after authentication (see App.tsx). Talks ONLY to AssistantGateway; never
 * touches Firestore, ERP services, or provider secrets directly.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, X, Send, Trash2, Loader2, CheckCircle2, AlertTriangle, ShieldCheck, Bot, Copy, Check } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAssistantSelection } from '../../context/AssistantSelectionContext';
import { NavigationPage } from '../../types';
import { getAssistantGateway, buildScreenContext, ASSISTANT_ENABLED } from '../../assistant';
import { setNavigationHandler, clearNavigationHandler } from '../../assistant/navigationBridge';
import { ActionPreview, AssistantChoiceRequest, AssistantMessage, PreviewItemStatus, WorkflowState } from '../../assistant/types';
import { AIProviderId } from '../../assistant/config';
import { getProviderDefinition } from '../../assistant/providerRegistry';

/** Visual treatment per per-item preview status - own copy, mirrors AIAssistantView.tsx's confirmation card (this file already duplicates the whole confirmation block rather than sharing a component). */
const PREVIEW_STATUS_STYLE: Record<PreviewItemStatus, { box: string; text: string; labelAr: string; labelEn: string }> = {
  NEW: { box: 'border-emerald-300 bg-emerald-50', text: 'text-emerald-700', labelAr: 'جديد', labelEn: 'New' },
  ALREADY_EXISTS: { box: 'border-slate-300 bg-slate-100', text: 'text-slate-600', labelAr: 'موجود بالفعل', labelEn: 'Already exists' },
  LIKELY_DUPLICATE: { box: 'border-slate-300 bg-slate-100', text: 'text-slate-600', labelAr: 'يشبه موجود', labelEn: 'Resembles existing' },
  AMBIGUOUS: { box: 'border-amber-400 bg-amber-100', text: 'text-amber-800', labelAr: 'غير مؤكد', labelEn: 'Ambiguous' },
  INVALID: { box: 'border-rose-300 bg-rose-50', text: 'text-rose-600', labelAr: 'غير صالح', labelEn: 'Invalid' },
};

/**
 * §1-§4/§20-§22 - each requested item carries its OWN independent decision.
 * Only NEW items are ever decidable (APPROVED/SKIPPED); existing/likely-
 * duplicate/ambiguous/invalid items are never created no matter what, so
 * they get no decision buttons - see AIAssistantView.tsx's identical note.
 */
type ItemDecision = 'APPROVED' | 'SKIPPED';

/**
 * Only APPROVED NEW items are kept in the execution payload - §22. Checks
 * BOTH `code` and `name` on an items[] entry (see AIAssistantView.tsx's
 * identical note) since different tools key their PreviewItem by different
 * fields (products: code, customers/employees: name).
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

interface GlobalAssistantProps {
  currentPage: NavigationPage;
  currentModule?: string;
  onNavigate: (page: NavigationPage) => void;
  /** The REAL, admin-controlled active provider (App.tsx, live-synced from Firestore) - never inferred locally. */
  activeProviderId: AIProviderId;
}

export const GlobalAssistant: React.FC<GlobalAssistantProps> = ({ currentPage, onNavigate, activeProviderId }) => {
  const { adminUser } = useAuth();
  const { language, isRtl } = useLanguage();
  const liveSelection = useAssistantSelection();

  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<ActionPreview | null>(null);
  const [itemDecisions, setItemDecisions] = useState<Record<string, ItemDecision>>({});
  /** Phase 5 §5.8 - carried alongside a paused confirmation/choice so confirming/choosing can RESUME the remaining auto-chained steps instead of ending the request. undefined for an ordinary (non-workflow) confirmation - Phase 4B behavior, unchanged. */
  const [pendingWorkflowState, setPendingWorkflowState] = useState<WorkflowState | undefined>(undefined);
  /** Phase 4B Part 11 §25/§26 - only the MOST RECENT interactive choice is clickable; an older one still shown in scrollback is visually inert (§26 - never applies to the wrong/stale target). */
  const [activeChoiceRequestId, setActiveChoiceRequestId] = useState<string | null>(null);
  /** Consolidated UX pass Item 2 - transient per-message copy feedback (copy icon -> "تم النسخ"/"Copied" or the failure notice), auto-clears after 2s. */
  const [copyState, setCopyState] = useState<{ id: string; ok: boolean } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const gateway = useMemo(() => getAssistantGateway(), []);

  // Bridge navigateToPage tool calls to the app's real, permission-enforcing handler.
  useEffect(() => {
    setNavigationHandler(onNavigate);
    return () => clearNavigationHandler();
  }, [onNavigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isOpen]);

  if (!ASSISTANT_ENABLED || !adminUser) return null;

  const context = buildScreenContext({
    currentPage,
    adminUser,
    language,
    currentStage: liveSelection.currentStage,
    selectedRecordId: liveSelection.selectedRecordId,
    selectedEntityType: liveSelection.selectedEntityType,
    selectedFilters: liveSelection.selectedFilters,
    selectedDateRange: liveSelection.selectedDateRange,
  });

  const isAr = language === 'ar';

  const pushMessage = (msg: AssistantMessage) => setMessages((prev) => [...prev, msg]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isProcessing) return;
    setInput('');
    setPendingConfirmation(null);
    setItemDecisions({});
    setActiveChoiceRequestId(null);
    setPendingWorkflowState(undefined);

    const userMsg: AssistantMessage = {
      id: `MSG-${Date.now()}-u`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    pushMessage(userMsg);
    setIsProcessing(true);

    try {
      const reply = await gateway.handleMessage(text, context, adminUser, [...messages, userMsg]);
      pushMessage(reply);
      if (reply.requiresConfirmation && reply.actionPreview) {
        setPendingConfirmation(reply.actionPreview);
        setPendingWorkflowState(reply.workflowState);
      }
      if (reply.choiceRequest) {
        setActiveChoiceRequestId(reply.choiceRequest.requestId);
        setPendingWorkflowState(reply.workflowState);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Phase 4B Part 4 §8/Part 11 §24-26 - a clicked interactive choice option
   * returns a STRUCTURED selection (choiceRequest.resolution + the option's
   * own safe `id`), never free text the model re-interprets. Rejects safely
   * (§26) if this choice is no longer the active one, OR if the dashboard
   * context it was generated for no longer matches the live screen context
   * (the user switched dashboards since this choice was shown) - never
   * silently applies a stale choice to the wrong target.
   */
  /**
   * Consolidated UX pass Item 2 - copies ONLY the human-readable reply text
   * (`m.text`) to the clipboard. Never the tool call, tool result, choice
   * request, workflow state, or any other internal/protocol data attached to
   * the message - those are never passed in by the caller in the first
   * place, so there is nothing to accidentally leak here.
   */
  const handleCopyMessage = async (messageId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState({ id: messageId, ok: true });
    } catch {
      setCopyState({ id: messageId, ok: false });
    }
    setTimeout(() => setCopyState((prev) => (prev?.id === messageId ? null : prev)), 2000);
  };

  const handleChoiceSelect = async (choiceRequest: AssistantChoiceRequest, optionId: string) => {
    if (isProcessing) return;
    const isAr = language === 'ar';
    const liveFingerprint = String(context.selectedFilters?.dashboardId || '');
    if (choiceRequest.requestId !== activeChoiceRequestId || liveFingerprint !== choiceRequest.contextFingerprint) {
      setActiveChoiceRequestId(null);
      pushMessage({
        id: `MSG-${Date.now()}-stale`,
        role: 'assistant',
        text: isAr ? 'انتهت صلاحية هذا الاختيار (تغيّر السياق) - يرجى إعادة الطلب.' : 'This choice is no longer valid (the context changed) - please ask again.',
        createdAt: new Date().toISOString(),
      });
      return;
    }
    setActiveChoiceRequestId(null);
    setIsProcessing(true);
    try {
      const args = { ...choiceRequest.resolution.baseArguments, [choiceRequest.resolution.argKey]: optionId };
      const reply = await gateway.runResolvedToolCall(choiceRequest.resolution.toolName, args, context, adminUser, messages, pendingWorkflowState);
      pushMessage(reply);
      setPendingWorkflowState(undefined);
      if (reply.requiresConfirmation && reply.actionPreview) {
        setPendingConfirmation(reply.actionPreview);
        setPendingWorkflowState(reply.workflowState);
      }
      if (reply.choiceRequest) {
        setActiveChoiceRequestId(reply.choiceRequest.requestId);
        setPendingWorkflowState(reply.workflowState);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const setItemDecision = (key: string, decision: ItemDecision) => {
    setItemDecisions((prev) => ({ ...prev, [key]: decision }));
  };

  const handleExecuteApproved = async () => {
    if (!pendingConfirmation) return;
    setIsProcessing(true);
    try {
      // §6/§7/§22 - only NEW items currently APPROVED are sent; execute()
      // independently re-checks each one immediately before write.
      const approvedKeys = new Set(
        pendingConfirmation.items
          .filter((i) => i.status === 'NEW' && (itemDecisions[i.key] ?? 'APPROVED') === 'APPROVED')
          .map((i) => i.key)
      );
      const approvedArgs = buildApprovedArguments(pendingConfirmation.toolCall.arguments, approvedKeys);
      const previewToRun: ActionPreview = { ...pendingConfirmation, toolCall: { ...pendingConfirmation.toolCall, arguments: approvedArgs } };
      const reply = await gateway.confirmPendingAction(previewToRun, context, adminUser, messages, pendingWorkflowState);
      pushMessage(reply);
      // Phase 5 §5.8 - a confirmed step can itself resume into ANOTHER step
      // that also needs confirmation (a chained write-after-write); only
      // clear the pending-confirmation state when the reply doesn't ask for
      // one, instead of unconditionally nulling it in `finally` below.
      if (reply.requiresConfirmation && reply.actionPreview) {
        setPendingConfirmation(reply.actionPreview);
        setItemDecisions({});
        setPendingWorkflowState(reply.workflowState);
      } else {
        setPendingConfirmation(null);
        setItemDecisions({});
        setPendingWorkflowState(reply.choiceRequest ? reply.workflowState : undefined);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCancelAll = async () => {
    if (!pendingConfirmation) return;
    const reply = await gateway.cancelPendingAction(pendingConfirmation, context, pendingWorkflowState);
    pushMessage(reply);
    setPendingConfirmation(null);
    setItemDecisions({});
    setPendingWorkflowState(undefined);
  };

  const handleClear = () => {
    setMessages([]);
    setPendingConfirmation(null);
    setItemDecisions({});
    setActiveChoiceRequestId(null);
    setPendingWorkflowState(undefined);
  };

  return (
    <>
      {/* Floating Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={`no-print fixed bottom-20 lg:bottom-6 ${isRtl ? 'left-4' : 'right-4'} z-40 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xl shadow-indigo-600/30 flex items-center justify-center transition-transform hover:scale-105 cursor-pointer`}
          title={isAr ? 'المساعد الذكي لعصفور' : 'ASFOUR Assistant'}
        >
          <Sparkles className="w-6 h-6" />
        </button>
      )}

      {/* Panel */}
      {isOpen && (
        <div
          dir={isRtl ? 'rtl' : 'ltr'}
          className={`no-print fixed z-50 bg-white shadow-2xl border border-slate-200 flex flex-col
            inset-x-0 bottom-0 h-[85vh] rounded-t-2xl
            sm:inset-auto sm:bottom-6 ${isRtl ? 'sm:left-4' : 'sm:right-4'} sm:w-[380px] sm:h-[560px] sm:rounded-2xl`}
        >
          {/* Header */}
          <div className="px-4 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-t-2xl flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Bot className="w-5 h-5 shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-bold truncate">{isAr ? 'مساعد عصفور الذكي' : 'ASFOUR Assistant'}</div>
                <div className="text-[10px] text-indigo-100 truncate">
                  {isAr ? 'الشاشة: ' : 'Screen: '}{context.currentPage} · {isAr ? 'الوحدة: ' : 'Module: '}{context.currentModule}
                  {context.currentStage && ` · ${isAr ? 'المرحلة: ' : 'Stage: '}${context.currentStage}`}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={handleClear} title={isAr ? 'مسح المحادثة' : 'Clear'} className="p-1.5 hover:bg-white/15 rounded-lg cursor-pointer">
                <Trash2 className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => setIsOpen(false)} title={isAr ? 'إغلاق' : 'Close'} className="p-1.5 hover:bg-white/15 rounded-lg cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Meta strip */}
          <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-200 text-[10px] text-slate-500 flex flex-wrap gap-x-3 gap-y-0.5 shrink-0">
            <span>{isAr ? 'المستخدم: ' : 'User: '}{adminUser?.fullName || adminUser?.username}</span>
            <span>{isAr ? 'اللغة: ' : 'Language: '}{isAr ? 'العربية' : 'English'}</span>
            <span className={activeProviderId === 'mock' ? 'text-amber-600 font-bold' : 'text-indigo-600 font-bold'}>
              {isAr ? 'المزود: ' : 'Provider: '}
              {getProviderDefinition(activeProviderId)?.[isAr ? 'displayNameAr' : 'displayNameEn'] || activeProviderId}
              {activeProviderId === 'mock' && ` (${isAr ? 'وضع تطوير' : 'Development'})`}
            </span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {messages.length === 0 && (
              <div className="text-center text-xs text-slate-400 py-8">
                {isAr
                  ? 'اسألني عن الإنتاج، أضف بيانات أساسية، صدّر تقريراً، أو انتقل بين الشاشات.'
                  : 'Ask about production, add master data, export a report, or navigate between screens.'}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    <span className="flex-1 min-w-0">{m.text}</span>
                    {m.role === 'assistant' && m.text && (
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(m.id, m.text)}
                        title={
                          copyState?.id === m.id
                            ? (copyState.ok ? (isAr ? 'تم النسخ' : 'Copied') : (isAr ? 'تعذر نسخ النص. حاول مرة أخرى.' : 'Could not copy text. Try again.'))
                            : (isAr ? 'نسخ' : 'Copy')
                        }
                        aria-label={isAr ? 'نسخ' : 'Copy'}
                        className={`shrink-0 p-1 rounded-md cursor-pointer transition-colors ${
                          copyState?.id === m.id
                            ? (copyState.ok ? 'text-emerald-600' : 'text-rose-500')
                            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/60'
                        }`}
                      >
                        {copyState?.id === m.id && copyState.ok ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                  {copyState?.id === m.id && (
                    <div className={`mt-0.5 text-[10px] font-bold ${copyState.ok ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {copyState.ok ? (isAr ? 'تم النسخ' : 'Copied') : (isAr ? 'تعذر نسخ النص. حاول مرة أخرى.' : 'Could not copy text. Try again.')}
                    </div>
                  )}
                  {m.toolResult && (
                    // Presentation Fix §9/§10 - a small status affordance
                    // only; the internal tool name is never shown to normal
                    // users.
                    <div className={`mt-1.5 flex items-center gap-1 text-[10px] ${m.toolResult.success ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {m.toolResult.success ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    </div>
                  )}

                  {/* Phase 4B Part 4 §7-9/Part 11 - real clickable choice buttons, never "type the option name" (§8). Only the MOST RECENT choice message is interactive (§25/§26) - an older one in scrollback renders inert. */}
                  {m.choiceRequest && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.choiceRequest.options.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          disabled={m.choiceRequest!.requestId !== activeChoiceRequestId || isProcessing}
                          onClick={() => handleChoiceSelect(m.choiceRequest!, opt.id)}
                          title={isAr ? opt.descriptionAr : opt.descriptionEn}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                            m.choiceRequest!.requestId !== activeChoiceRequestId
                              ? 'border-slate-200 text-slate-300 cursor-not-allowed bg-white'
                              : 'border-indigo-300 text-indigo-700 bg-white hover:bg-indigo-50'
                          }`}
                        >
                          {isAr ? opt.labelAr : opt.labelEn}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Action Preview / Confirmation */}
            {pendingConfirmation && (
              <div className="border border-amber-300 bg-amber-50 rounded-2xl p-3 text-xs space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-amber-800">
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isAr ? pendingConfirmation.actionLabelAr : pendingConfirmation.actionLabelEn}</span>
                </div>
                <div className="text-slate-700">{isAr ? pendingConfirmation.targetSummaryAr : pendingConfirmation.targetSummaryEn}</div>

                {/* §1-§4/§19 - independent per-item card; only NEW items get a real decision toggle. */}
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
                              className={`px-2 py-1 rounded-md font-bold text-[11px] cursor-pointer ${
                                decision === 'APPROVED' ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:border-emerald-400'
                              }`}
                            >
                              {isAr ? 'تأكيد الإضافة' : 'Confirm Add'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setItemDecision(item.key, 'SKIPPED')}
                              className={`px-2 py-1 rounded-md font-bold text-[11px] cursor-pointer ${
                                decision === 'SKIPPED' ? 'bg-slate-600 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:border-slate-400'
                              }`}
                            >
                              {isAr ? 'عدم الإضافة' : "Don't Add"}
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
                  const newItems = pendingConfirmation.items.filter((i) => i.status === 'NEW');
                  const approvedItems = newItems.filter((i) => (itemDecisions[i.key] ?? 'APPROVED') === 'APPROVED');
                  const skippedItems = newItems.filter((i) => (itemDecisions[i.key] ?? 'APPROVED') === 'SKIPPED');
                  const nonNewItems = pendingConfirmation.items.filter((i) => i.status !== 'NEW');
                  return (
                    <div className="text-[10px] text-slate-500 border-t border-amber-200 pt-1.5 space-y-0.5">
                      <div>{isAr ? `إجمالي الطلبات: ${total}` : `Total requested: ${total}`}</div>
                      {approvedItems.length > 0 && (
                        <div>{isAr ? 'سيتم الإضافة: ' : 'Will be added: '}{approvedItems.map((i) => i.displayValue).join('، ')}</div>
                      )}
                      {(skippedItems.length > 0 || nonNewItems.length > 0) && (
                        <div>
                          {isAr ? 'لن تتم الإضافة: ' : 'Will NOT be added: '}
                          {[...skippedItems.map((i) => i.displayValue), ...nonNewItems.map((i) => i.displayValue)].join('، ')}
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="text-[10px] text-slate-500">
                  {isAr ? 'مستوى الخطورة: ' : 'Risk level: '}<span className="font-bold">{pendingConfirmation.riskLevel}</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleExecuteApproved}
                    disabled={isProcessing}
                    className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold disabled:opacity-50 cursor-pointer"
                  >
                    {pendingConfirmation.toolCall.toolName === 'createCustomDashboard'
                      ? (isAr ? 'إنشاء اللوحة' : 'Create Dashboard')
                      : (isAr ? 'تنفيذ القرارات المعتمدة' : 'Execute Approved Decisions')}
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelAll}
                    disabled={isProcessing}
                    className="flex-1 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-bold disabled:opacity-50 cursor-pointer"
                  >
                    {isAr ? 'إلغاء' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}

            {isProcessing && (
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{isAr ? 'جاري المعالجة...' : 'Processing...'}</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="p-2.5 border-t border-slate-200 flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
              placeholder={isAr ? 'اكتب سؤالك أو طلبك هنا...' : 'Type your question or request...'}
              disabled={isProcessing}
              className="flex-1 min-w-0 px-3 py-2 text-xs border border-slate-300 rounded-xl focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isProcessing || !input.trim()}
              className="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl cursor-pointer"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
};

/**
 * Central AI Provider Manager (Admin-only) - lets an authorized
 * administrator choose which AIProvider (Claude / Gemini / Cloudflare
 * Workers AI / OpenRouter Free / Mock) the entire application's AI
 * Assistant uses, without
 * touching the Tool Registry, Permission Guard, or ERP services (those are
 * shared by every provider - see src/assistant/providerRegistry.ts).
 *
 * The active provider is real application configuration (Firestore
 * aiProviderConfig/active), never hardcoded per component. Switching it
 * never silently happens - always an explicit Test -> Activate -> Confirm
 * flow, and an unavailable provider is reported honestly rather than
 * silently swapped for another one.
 */
import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Loader2,
  ShieldCheck,
  Zap,
  Clock,
  Ban,
} from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { AIProviderId } from '../../assistant/config';
import {
  AIProviderDefinition,
  ProviderConfigurationStatus,
  ProviderHealthCheckResult,
  listProviderDefinitions,
  isEligibleForActivation,
  MINIMUM_REQUIRED_CAPABILITIES,
} from '../../assistant/providerRegistry';
import { setRuntimeActiveProvider } from '../../assistant/providerRuntime';
import {
  ActiveProviderConfig,
  subscribeActiveProviderConfig,
  setActiveProviderConfig,
} from '../../services/aiProviderConfigService';

function t(ar: string, en: string, language: 'ar' | 'en'): string {
  return language === 'ar' ? ar : en;
}

type DisplayStatus = ProviderConfigurationStatus | 'UNTESTED';

const STATUS_BADGE: Record<DisplayStatus, { ar: string; en: string; cls: string; icon: React.ComponentType<{ className?: string }> }> = {
  READY: { ar: 'جاهز', en: 'Ready', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: CheckCircle2 },
  NOT_CONFIGURED: { ar: 'غير مُهيأ', en: 'Not Configured', cls: 'bg-slate-100 text-slate-600 border-slate-300', icon: HelpCircle },
  UNAVAILABLE: { ar: 'غير متاح', en: 'Unavailable', cls: 'bg-amber-100 text-amber-800 border-amber-300', icon: AlertTriangle },
  QUOTA_EXHAUSTED: { ar: 'انتهت الحصة المجانية', en: 'Free Quota Exhausted', cls: 'bg-orange-100 text-orange-800 border-orange-300', icon: Clock },
  ERROR: { ar: 'خطأ', en: 'Error', cls: 'bg-red-100 text-red-800 border-red-300', icon: XCircle },
  DISABLED: { ar: 'معطل', en: 'Disabled', cls: 'bg-slate-100 text-slate-500 border-slate-300', icon: Ban },
  UNTESTED: { ar: 'لم يُختبر بعد', en: 'Not tested yet', cls: 'bg-sky-50 text-sky-700 border-sky-200', icon: Clock },
};

const CAPABILITY_LABEL: Record<string, { ar: string; en: string }> = {
  chat: { ar: 'محادثة', en: 'Chat' },
  toolCalling: { ar: 'استدعاء الأدوات', en: 'Tool Calling' },
  structuredOutput: { ar: 'مخرجات منظمة', en: 'Structured Output' },
  streaming: { ar: 'بث مباشر', en: 'Streaming' },
  analysis: { ar: 'تحليل', en: 'Analysis' },
  multiStep: { ar: 'خطوات متعددة', en: 'Multi-step' },
};

const SECRET_NAME_BY_PROVIDER: Partial<Record<AIProviderId, string>> = {
  claude: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

function suggestedAction(status: DisplayStatus, providerId: AIProviderId, language: 'ar' | 'en'): string | null {
  if (status === 'NOT_CONFIGURED') {
    const secretName = SECRET_NAME_BY_PROVIDER[providerId];
    return secretName
      ? t(
          `يتطلب هذا المزود إعداد سر (Secret) على بوابة Cloudflare Worker (wrangler secret put ${secretName})، ثم إعادة النشر.`,
          `This provider needs a secret configured on the Cloudflare Worker gateway (wrangler secret put ${secretName}), then a redeploy.`,
          language
        )
      : t(
          'يتطلب هذا المزود إعداد ربط (Binding) على بوابة Cloudflare Worker، ثم إعادة النشر.',
          'This provider needs a binding configured on the Cloudflare Worker gateway, then a redeploy.',
          language
        );
  }
  if (status === 'UNAVAILABLE') {
    return t('تحقق من رصيد/حصة الاستخدام لدى مزود الخدمة.', "Check the provider's account credits/usage quota.", language);
  }
  if (status === 'QUOTA_EXHAUSTED') {
    return t(
      'انتهت الحصة المجانية المتاحة لمزود الذكاء الاصطناعي حاليًا. البرنامج نفسه يعمل، ويمكنك استخدام مزود آخر أو المحاولة مرة أخرى بعد تجدد الحصة.',
      'The free quota currently available for this AI provider has run out. The application itself is working fine - you can switch to another provider or try again once the quota resets.',
      language
    );
  }
  if (status === 'ERROR') {
    return t('تحقق من سجلات Cloudflare Worker وصلاحية بيانات الاعتماد.', 'Check the Cloudflare Worker logs and credential validity.', language);
  }
  return null;
}

export const AIProviderManagementView: React.FC = () => {
  const { language, isRtl } = useLanguage();
  const { hasPermission, isSuperAdmin, adminUser } = useAuth();

  const canManage = isSuperAdmin || hasPermission('system.aiProvider.manage');
  const definitions = listProviderDefinitions();

  const [activeConfig, setActiveConfig] = useState<ActiveProviderConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [healthResults, setHealthResults] = useState<Partial<Record<AIProviderId, ProviderHealthCheckResult>>>({});
  const [testingId, setTestingId] = useState<AIProviderId | null>(null);
  const [confirmTargetId, setConfirmTargetId] = useState<AIProviderId | null>(null);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeActiveProviderConfig(
      (config) => {
        setActiveConfig(config);
        setConfigLoading(false);
      },
      () => setConfigLoading(false)
    );
    return () => unsubscribe();
  }, []);

  const displayStatusFor = (def: AIProviderDefinition): DisplayStatus => {
    if (def.isAlwaysAvailable) return 'READY';
    return healthResults[def.id]?.status ?? 'UNTESTED';
  };

  const runTest = async (def: AIProviderDefinition) => {
    if (def.isAlwaysAvailable) return;
    setTestingId(def.id);
    try {
      const result = await def.checkHealth();
      setHealthResults((prev) => ({ ...prev, [def.id]: result }));
    } finally {
      setTestingId(null);
    }
  };

  const canActivate = (def: AIProviderDefinition): boolean => {
    if (!isEligibleForActivation(def.id)) return false;
    if (def.isAlwaysAvailable) return true;
    return healthResults[def.id]?.status === 'READY';
  };

  const requestActivate = (def: AIProviderDefinition) => {
    setActivateError(null);
    setConfirmTargetId(def.id);
  };

  const confirmActivate = async () => {
    if (!confirmTargetId) return;
    setActivating(true);
    setActivateError(null);
    try {
      await setActiveProviderConfig(confirmTargetId, activeConfig?.activeProvider ?? null, 'Changed via AI Provider Management screen');
      setRuntimeActiveProvider(confirmTargetId); // takes effect immediately in this tab
      setConfirmTargetId(null);
    } catch (err: any) {
      setActivateError(err?.message || t('تعذر حفظ التغيير.', 'Failed to save the change.', language));
    } finally {
      setActivating(false);
    }
  };

  if (!canManage) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 p-8 text-center space-y-2">
        <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto" />
        <p className="text-sm font-bold text-slate-600">
          {t('لا تملك صلاحية الوصول لهذه الشاشة.', 'You do not have permission to access this screen.', language)}
        </p>
      </div>
    );
  }

  const confirmTargetDef = confirmTargetId ? definitions.find((d) => d.id === confirmTargetId) : null;

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-violet-700 p-6 rounded-3xl text-white shadow-lg">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold mb-3">
          <Sparkles className="w-3.5 h-3.5 text-amber-300" />
          {t('إدارة مركزية لمزود الذكاء الاصطناعي', 'Central AI Provider Manager', language)}
        </div>
        <h1 className="text-2xl font-black mb-1">{t('إدارة مزود الذكاء الاصطناعي', 'AI Provider Management', language)}</h1>
        <p className="text-xs text-indigo-100 max-w-2xl">
          {t(
            'اختر مزود الذكاء الاصطناعي النشط للمساعد الذكي في كامل النظام. يبقى سجل الأدوات ونظام الصلاحيات كما هو دون تغيير مهما كان المزود المختار.',
            "Choose the active AI provider for the assistant across the whole system. The Tool Registry and Permission Guard stay exactly the same regardless of which provider is active.",
            language
          )}
        </p>
      </div>

      {/* Current Provider Summary */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xs p-5">
        <div className="text-xs font-bold text-slate-400 uppercase mb-3">{t('المزود الحالي', 'Current Provider', language)}</div>
        {configLoading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> {t('جاري التحميل...', 'Loading...', language)}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-lg font-black text-slate-900">
              {definitions.find((d) => d.id === (activeConfig?.activeProvider || 'mock'))?.[language === 'ar' ? 'displayNameAr' : 'displayNameEn'] || 'Mock'}
            </span>
            {(activeConfig?.activeProvider || 'mock') === 'mock' && (
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-300">
                {t('وضع تطوير (Development Mock)', 'Development Mock', language)}
              </span>
            )}
            {activeConfig?.updatedByName && (
              <span className="text-[11px] text-slate-400">
                {t('آخر تغيير بواسطة', 'Last changed by', language)} {activeConfig.updatedByName}
                {activeConfig.updatedAt && ` · ${new Date(activeConfig.updatedAt).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {definitions.map((def) => {
          const status = displayStatusFor(def);
          const badge = STATUS_BADGE[status];
          const BadgeIcon = badge.icon;
          const isActive = (activeConfig?.activeProvider || 'mock') === def.id;
          const health = healthResults[def.id];
          const reasonText = health ? (language === 'ar' ? health.reasonAr : health.reasonEn) : null;
          const suggestion = suggestedAction(status, def.id, language);
          const meetsMinimum = MINIMUM_REQUIRED_CAPABILITIES.every((c) => def.capabilities.includes(c));

          return (
            <div
              key={def.id}
              className={`bg-white rounded-3xl border shadow-xs p-5 space-y-3 ${isActive ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-slate-900">
                      {language === 'ar' ? def.displayNameAr : def.displayNameEn}
                    </span>
                    {isActive && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-300">
                        {t('نشط', 'Active', language)}
                      </span>
                    )}
                    {def.isDevelopmentOnly && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-300">
                        {t('تطوير فقط', 'Dev Only', language)}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-xs">{language === 'ar' ? def.descriptionAr : def.descriptionEn}</p>
                  {(def.usageNoticeAr || def.usageNoticeEn) && (
                    <p className="text-[10px] text-slate-400 mt-1 max-w-xs italic">
                      {language === 'ar' ? def.usageNoticeAr : def.usageNoticeEn}
                    </p>
                  )}
                </div>
                <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border ${badge.cls}`}>
                  <BadgeIcon className="w-3.5 h-3.5" />
                  {language === 'ar' ? badge.ar : badge.en}
                </span>
              </div>

              {/* Capabilities */}
              <div className="flex flex-wrap gap-1.5">
                {def.capabilities.map((c) => (
                  <span key={c} className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                    {language === 'ar' ? CAPABILITY_LABEL[c]?.ar || c : CAPABILITY_LABEL[c]?.en || c}
                  </span>
                ))}
                {!meetsMinimum && (
                  <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-red-50 text-red-600 border border-red-200">
                    {t('لا يفي بالحد الأدنى', 'Below minimum', language)}
                  </span>
                )}
              </div>

              {/* Health detail */}
              {health && (
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  {health.model && <div>{t('النموذج', 'Model', language)}: <span className="font-mono">{health.model}</span></div>}
                  {typeof health.latencyMs === 'number' && <div>{t('زمن الاستجابة', 'Latency', language)}: {health.latencyMs}ms</div>}
                  <div>{t('آخر فحص', 'Last checked', language)}: {new Date(health.checkedAt).toLocaleTimeString(language === 'ar' ? 'ar-EG' : 'en-US')}</div>
                  {reasonText && <div className="text-amber-600 font-bold">{reasonText}</div>}
                  {suggestion && status !== 'READY' && <div className="text-slate-400 italic">{suggestion}</div>}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                {!def.isAlwaysAvailable && (
                  <button
                    type="button"
                    onClick={() => runTest(def)}
                    disabled={testingId === def.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold disabled:opacity-50 cursor-pointer"
                  >
                    {testingId === def.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                    {t('اختبار الاتصال', 'Test Connection', language)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => requestActivate(def)}
                  disabled={isActive || !canActivate(def)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  title={
                    !canActivate(def) && !isActive
                      ? t('يجب اجتياز اختبار الاتصال أولاً', 'Must pass Test Connection first', language)
                      : undefined
                  }
                >
                  {isActive ? t('نشط حالياً', 'Currently Active', language) : t('تفعيل', 'Activate', language)}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Confirmation Modal */}
      <Modal
        isOpen={!!confirmTargetId}
        onClose={() => !activating && setConfirmTargetId(null)}
        title={t('تأكيد تغيير المزود', 'Confirm Provider Change', language)}
      >
        <div className="space-y-4 text-sm">
          <p className="text-slate-700 font-bold">
            {t(
              'أنت بصدد تغيير مزود الذكاء الاصطناعي المستخدم في مساعد نظام ASFOUR. هل تريد المتابعة؟',
              'You are changing the AI provider used by the ERP Assistant. Continue?',
              language
            )}
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs space-y-1">
            <div>
              {t('من', 'From', language)}: <span className="font-bold">{definitions.find((d) => d.id === (activeConfig?.activeProvider || 'mock'))?.[language === 'ar' ? 'displayNameAr' : 'displayNameEn']}</span>
            </div>
            <div>
              {t('إلى', 'To', language)}: <span className="font-bold">{confirmTargetDef ? (language === 'ar' ? confirmTargetDef.displayNameAr : confirmTargetDef.displayNameEn) : ''}</span>
            </div>
          </div>
          {confirmTargetDef && (confirmTargetDef.activationWarningAr || confirmTargetDef.activationWarningEn) && (
            <div className="flex items-start gap-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{language === 'ar' ? confirmTargetDef.activationWarningAr : confirmTargetDef.activationWarningEn}</span>
            </div>
          )}
          {activateError && (
            <div className="text-xs font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-2">{activateError}</div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={confirmActivate}
              disabled={activating}
              className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
            >
              {activating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {t('تأكيد', 'Confirm', language)}
            </button>
            <button
              type="button"
              onClick={() => setConfirmTargetId(null)}
              disabled={activating}
              className="flex-1 px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-bold text-xs disabled:opacity-50 cursor-pointer"
            >
              {t('إلغاء', 'Cancel', language)}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

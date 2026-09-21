/**
 * Suggested Analytics screen (Universal Data Intelligence pass, Parts 22-27).
 *
 * "التحليلات والمؤشرات المقترحة" - a central, read-only discovery screen that
 * surfaces every metric/dimension/trend/data-quality finding
 * analyticsDiscoveryEngine.ts can derive from CURRENT real data, organized by
 * category (Part 22). Nothing here writes to Firestore or persists anything
 * automatically (Part 37) - the only write path is the explicit "تنفيذ"
 * (Approve) action per suggestion, which records a metric DEFINITION
 * reference via approvedAnalyticsService.ts, never raw data (Part 38).
 *
 * Reuses fetchUniversalStageRecords()/METRIC_REGISTRY/PRODUCTION_STAGE_REGISTRY
 * - the SAME data + metric catalog every other screen in this app already
 * shares (CRITICAL: no second reporting engine).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Lightbulb, RefreshCw, CheckCircle2, XCircle, Clock3, TrendingUp, Sparkles, AlertTriangle, PlusCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { fetchUniversalStageRecords } from '../../services/stageRecordService';
import { UniversalStageRecord, ProductionStageType, NavigationPage } from '../../types';
import { ALL_STAGES, getStageDisplayName } from '../../services/reportingEngine';
import {
  discoverMetricSuggestions, discoverDimensionSuggestions, discoverTrendSuggestions,
  discoverDataQualityFindings, discoverAccountingFindings,
  DerivedMetricSuggestion, DataQualityFinding, SuggestionCategory,
} from '../../services/analyticsDiscoveryEngine';
import { approveAnalyticsSuggestion, listApprovedAnalytics, removeApprovedAnalytics, ApprovedAnalyticsEntry } from '../../services/approvedAnalyticsService';
import { ENTITY_TO_DIMENSION, WidgetConfig } from '../../services/dashboardRegistry';
import { CUSTOM_DASHBOARD_ACTION_EVENT, CustomDashboardAction } from '../dashboard/DashboardBuilderView';

interface SuggestedAnalyticsViewProps {
  onNavigate?: (page: NavigationPage) => void;
}

type PeriodPreset = 'LAST_30_DAYS' | 'THIS_MONTH' | 'THIS_YEAR' | 'ALL_TIME';

function resolvePeriod(preset: PeriodPreset): { startDate: string; endDate: string } {
  const now = new Date();
  const toStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = toStr(now);
  if (preset === 'ALL_TIME') return { startDate: '', endDate: '' };
  if (preset === 'THIS_YEAR') return { startDate: `${now.getFullYear()}-01-01`, endDate: today };
  if (preset === 'THIS_MONTH') return { startDate: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`, endDate: today };
  const start = new Date(now); start.setDate(start.getDate() - 29);
  return { startDate: toStr(start), endDate: today };
}

/** Equal-length prior period immediately before the given range - the SAME deterministic baseline businessInsightsTools.ts's generateBusinessInsights uses. */
function previousPeriodOf(startDate: string, endDate: string): { startDate: string; endDate: string } {
  if (!startDate || !endDate) return { startDate: '', endDate: '' };
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - (spanDays - 1) * 86400000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: fmt(prevStart), endDate: fmt(prevEnd) };
}

const AVAILABILITY_BADGE: Record<string, { ar: string; en: string; cls: string }> = {
  AVAILABLE: { ar: 'متاح', en: 'Available', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300' },
  PARTIAL: { ar: 'جزئي', en: 'Partial', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  NOT_AVAILABLE: { ar: 'غير متاح', en: 'Not Available', cls: 'bg-slate-100 text-slate-500 border-slate-300' },
};

const CATEGORY_LABEL: Record<SuggestionCategory, { ar: string; en: string }> = {
  PRODUCTION: { ar: 'الإنتاج', en: 'Production' },
  QUALITY: { ar: 'الجودة والهالك', en: 'Quality & Waste' },
  DOWNTIME: { ar: 'التوقف', en: 'Downtime' },
  FAULTS: { ar: 'الأعطال', en: 'Faults' },
  EMPLOYEES: { ar: 'الموظفون', en: 'Employees' },
  EQUIPMENT: { ar: 'المعدات', en: 'Equipment' },
  SHIFTS: { ar: 'الورديات', en: 'Shifts' },
  PRODUCTS: { ar: 'المنتجات', en: 'Products' },
  CUSTOMERS: { ar: 'العملاء', en: 'Customers' },
  STAGES: { ar: 'المراحل', en: 'Stages' },
  ACCOUNTING: { ar: 'المحاسبة', en: 'Accounting' },
  DATA_QUALITY: { ar: 'جودة البيانات', en: 'Data Quality' },
  OTHER: { ar: 'أخرى', en: 'Other' },
};
const CATEGORY_ORDER: SuggestionCategory[] = ['PRODUCTION', 'QUALITY', 'DOWNTIME', 'FAULTS', 'EMPLOYEES', 'EQUIPMENT', 'SHIFTS', 'PRODUCTS', 'CUSTOMERS', 'STAGES', 'ACCOUNTING', 'DATA_QUALITY', 'OTHER'];

export const SuggestedAnalyticsView: React.FC<SuggestedAnalyticsViewProps> = ({ onNavigate }) => {
  const { language, isRtl } = useLanguage();
  const { hasPermission, isSuperAdmin } = useAuth();
  const isAr = language === 'ar';
  const canApprove = isSuperAdmin || hasPermission('reports.view');

  const [stage, setStage] = useState<ProductionStageType | 'all'>('all');
  const [period, setPeriod] = useState<PeriodPreset>('LAST_30_DAYS');
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<UniversalStageRecord[]>([]);
  const [previousRecords, setPreviousRecords] = useState<UniversalStageRecord[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [approvedVersion, setApprovedVersion] = useState(0);
  const [activeCategory, setActiveCategory] = useState<SuggestionCategory | 'ALL'>('ALL');
  const [approved, setApproved] = useState<ApprovedAnalyticsEntry[]>([]);
  const [approvedLoading, setApprovedLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setApprovedLoading(true);
    listApprovedAnalytics()
      .then((entries) => { if (!cancelled) setApproved(entries); })
      .catch(() => { /* handleFirestoreError already threw a structured, logged error - the list simply stays whatever it was, never a false empty/stale claim */ })
      .finally(() => { if (!cancelled) setApprovedLoading(false); });
    return () => { cancelled = true; };
  }, [approvedVersion]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const { startDate, endDate } = resolvePeriod(period);
    const prev = previousPeriodOf(startDate, endDate);
    Promise.all([
      fetchUniversalStageRecords({ startDate: startDate || undefined, endDate: endDate || undefined }),
      prev.startDate ? fetchUniversalStageRecords({ startDate: prev.startDate, endDate: prev.endDate }) : Promise.resolve([]),
    ]).then(([cur, prevRecs]) => {
      if (cancelled) return;
      setRecords(cur);
      setPreviousRecords(prevRecs);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period]);

  const t = {
    title: isAr ? 'التحليلات والمؤشرات المقترحة' : 'Suggested Analytics',
    subtitle: isAr ? 'اكتشاف تلقائي لكل مؤشر يمكن اشتقاقه من البيانات الحالية - لا يُحفظ أي شيء إلا بموافقتك الصريحة' : 'Automatic discovery of every metric derivable from current data - nothing is saved without your explicit approval',
    stage: isAr ? 'المرحلة' : 'Stage', allStages: isAr ? 'كل المراحل' : 'All Stages',
    period: isAr ? 'الفترة' : 'Period',
    refresh: isAr ? 'تحديث' : 'Refresh',
    approve: isAr ? 'تنفيذ' : 'Approve',
    ignore: isAr ? 'تجاهل' : 'Ignore',
    defer: isAr ? 'تأجيل' : 'Defer',
    addToDashboard: isAr ? 'إضافة إلى لوحة' : 'Add to Dashboard',
    approvedSection: isAr ? 'المؤشرات المعتمدة' : 'Approved Metrics',
    remove: isAr ? 'إزالة' : 'Remove',
    noApproved: isAr ? 'لم تعتمد أي مؤشر بعد.' : 'No metrics approved yet.',
    loading: isAr ? 'جارٍ التحليل...' : 'Analyzing...',
    all: isAr ? 'الكل' : 'All',
    formula: isAr ? 'الصيغة' : 'Formula',
    scope: isAr ? 'النطاق' : 'Scope',
    approveSuccess: isAr ? 'تم اعتماد المؤشر وحفظه بنجاح.' : 'Metric approved and saved successfully.',
    approveFailure: isAr ? 'تعذر حفظ المؤشر مركزيًا. لم يتم اعتماد التغيير.' : 'Unable to save the metric centrally. The change was not approved.',
    removeFailure: isAr ? 'تعذر إزالة المؤشر المعتمد. حاول مرة أخرى.' : 'Unable to remove the approved metric. Please try again.',
  };

  const periodOptions: { id: PeriodPreset; ar: string; en: string }[] = [
    { id: 'LAST_30_DAYS', ar: 'آخر 30 يومًا', en: 'Last 30 Days' },
    { id: 'THIS_MONTH', ar: 'هذا الشهر', en: 'This Month' },
    { id: 'THIS_YEAR', ar: 'هذا العام', en: 'This Year' },
    { id: 'ALL_TIME', ar: 'كل الفترات', en: 'All Time' },
  ];

  const metricSuggestions = useMemo(() => loading ? [] : discoverMetricSuggestions(records, language, stage), [records, language, stage, loading]);
  const dimensionSuggestions = useMemo(() => loading ? [] : discoverDimensionSuggestions(records, language, stage), [records, language, stage, loading]);
  const trendSuggestions = useMemo(() => loading || period === 'ALL_TIME' ? [] : discoverTrendSuggestions(records, previousRecords, language, stage), [records, previousRecords, language, stage, loading, period]);
  const accountingFindings = useMemo(() => discoverAccountingFindings(language), [language]);
  const dataQualityFindings: DataQualityFinding[] = useMemo(() => loading ? [] : discoverDataQualityFindings(records), [records, loading]);

  const allSuggestions: DerivedMetricSuggestion[] = useMemo(
    () => [...metricSuggestions, ...dimensionSuggestions, ...trendSuggestions, ...accountingFindings]
      .filter((s) => !dismissed.has(s.suggestionId))
      .sort((a, b) => {
        const rank = { AVAILABLE: 0, PARTIAL: 1, NOT_AVAILABLE: 2 } as const;
        if (rank[a.availability] !== rank[b.availability]) return rank[a.availability] - rank[b.availability];
        const conf = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
        return conf[a.confidence] - conf[b.confidence];
      }),
    [metricSuggestions, dimensionSuggestions, trendSuggestions, accountingFindings, dismissed]
  );

  const grouped = useMemo(() => {
    const map = new Map<SuggestionCategory, DerivedMetricSuggestion[]>();
    for (const s of allSuggestions) {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category)!.push(s);
    }
    return map;
  }, [allSuggestions]);

  /**
   * Part 10/11 - success is reported ONLY after the Firestore write actually
   * resolves; on failure the suggestion is left exactly as it was (never
   * dismissed, never a false local-only "approved" state) and a clear,
   * safe error is shown instead.
   */
  const handleApprove = async (s: DerivedMetricSuggestion) => {
    if (!s.metric || savingId) return;
    setSavingId(s.suggestionId);
    setStatusMessage(null);
    try {
      await approveAnalyticsSuggestion({
        metricId: s.metric,
        entityType: s.entityType,
        stage: s.stage,
        scope: isAr ? s.scopeLabelAr : s.scopeLabelEn,
        titleAr: s.titleAr, titleEn: s.titleEn,
        formulaAr: s.formulaAr, formulaEn: s.formulaEn,
      });
      setDismissed((prev) => new Set(prev).add(s.suggestionId));
      setApprovedVersion((v) => v + 1);
      setStatusMessage({ ok: true, text: t.approveSuccess });
    } catch {
      setStatusMessage({ ok: false, text: t.approveFailure });
    } finally {
      setSavingId(null);
    }
  };

  const handleRemoveApproved = async (entry: ApprovedAnalyticsEntry) => {
    if (savingId) return;
    setSavingId(entry.id);
    setStatusMessage(null);
    try {
      await removeApprovedAnalytics(entry.id, entry.titleAr);
      setApprovedVersion((v) => v + 1);
    } catch {
      setStatusMessage({ ok: false, text: t.removeFailure });
    } finally {
      setSavingId(null);
    }
  };

  const handleDismiss = (id: string) => setDismissed((prev) => new Set(prev).add(id));

  /** Part 26 - real Dashboard integration: builds a genuine WidgetConfig and reuses the EXISTING CREATE_DASHBOARD event DashboardBuilderView already listens for - never a parallel dashboard-creation path. */
  const handleAddToDashboard = (s: DerivedMetricSuggestion) => {
    if (!s.metric) return;
    const widget: WidgetConfig = s.entityType
      ? {
          widgetId: `wid_sa_${Date.now()}`, widgetType: 'RANKING', analysisMode: 'RANKING', metric: s.metric,
          entityType: s.entityType, rankingDirection: 'best', limit: 5, chartType: 'HORIZONTAL_BAR', chartTypeIsOverride: false,
          timeRangePreset: 'inherit', filters: {}, productionStage: s.stage,
        }
      : {
          widgetId: `wid_sa_${Date.now()}`, widgetType: 'KPI_CARD', analysisMode: 'SINGLE_METRIC', metric: s.metric,
          chartType: 'KPI', chartTypeIsOverride: false, timeRangePreset: 'inherit', filters: {}, productionStage: s.stage, size: 'SMALL',
        };
    const layout = {
      name: s.titleAr,
      sections: [{ sectionId: `sec_sa_${Date.now()}`, title: s.titleAr, columns: 1 as const, widgets: [widget] }],
    };
    window.dispatchEvent(new CustomEvent(CUSTOM_DASHBOARD_ACTION_EVENT, { detail: { type: 'CREATE_DASHBOARD', layout } as CustomDashboardAction }));
    onNavigate?.('dashboard');
  };

  const categoriesWithData = CATEGORY_ORDER.filter((c) => grouped.has(c) || (c === 'DATA_QUALITY'));

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-black text-slate-900 flex items-center gap-2"><Lightbulb className="w-5 h-5 text-amber-500" />{t.title}</h1>
          <p className="text-xs text-slate-500 mt-0.5">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={stage} onChange={(e) => setStage(e.target.value as ProductionStageType | 'all')} className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-700">
            <option value="all">{t.allStages}</option>
            {ALL_STAGES.map((s) => <option key={s} value={s}>{getStageDisplayName(s, language)}</option>)}
          </select>
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-[11px] font-bold">
            {periodOptions.map((p) => (
              <button key={p.id} type="button" onClick={() => setPeriod(p.id)} className={`px-2 py-1 rounded cursor-pointer ${period === p.id ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500'}`}>
                {isAr ? p.ar : p.en}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex items-center gap-1.5 flex-wrap border-b border-slate-200 pb-2">
        <button type="button" onClick={() => setActiveCategory('ALL')} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${activeCategory === 'ALL' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{t.all} ({allSuggestions.length})</button>
        {categoriesWithData.map((c) => (
          <button key={c} type="button" onClick={() => setActiveCategory(c)} className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer ${activeCategory === c ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
            {isAr ? CATEGORY_LABEL[c].ar : CATEGORY_LABEL[c].en} {c !== 'DATA_QUALITY' ? `(${(grouped.get(c) || []).length})` : ''}
          </button>
        ))}
      </div>

      {statusMessage && (
        <div className={`rounded-xl border px-3.5 py-2.5 text-xs font-bold flex items-center gap-2 ${statusMessage.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
          {statusMessage.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          {statusMessage.text}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2"><Loader2 className="w-5 h-5 animate-spin" />{t.loading}</div>
      ) : (
        <>
          {/* Approved section - central, cross-device (Firestore-backed) */}
          {(approvedLoading || approved.length > 0) && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-3.5">
              <h2 className="text-xs font-black text-emerald-800 flex items-center gap-1.5 mb-2">
                <CheckCircle2 className="w-4 h-4" />{t.approvedSection} {approvedLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : `(${approved.length})`}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {approved.map((a: ApprovedAnalyticsEntry) => (
                  <div key={a.id} className="bg-white border border-emerald-200 rounded-lg p-2.5 text-xs">
                    <div className="font-bold text-slate-800">{isAr ? a.titleAr : a.titleEn}</div>
                    <div className="text-slate-400 text-[10px] mt-0.5">{isAr ? a.formulaAr : a.formulaEn}</div>
                    <button type="button" disabled={savingId === a.id} onClick={() => handleRemoveApproved(a)} className="mt-1.5 text-[10px] font-bold text-rose-500 hover:text-rose-700 disabled:opacity-40 cursor-pointer">{t.remove}</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data quality findings (Part 15/22) */}
          {(activeCategory === 'ALL' || activeCategory === 'DATA_QUALITY') && dataQualityFindings.length > 0 && (
            <div>
              <h2 className="text-xs font-black text-slate-700 flex items-center gap-1.5 mb-2"><AlertTriangle className="w-4 h-4 text-amber-500" />{isAr ? CATEGORY_LABEL.DATA_QUALITY.ar : CATEGORY_LABEL.DATA_QUALITY.en}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {dataQualityFindings.map((f) => (
                  <div key={f.findingId} className={`rounded-xl border p-3 text-xs ${f.severity === 'WARNING' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="font-bold text-slate-800">{isAr ? f.titleAr : f.titleEn}</div>
                    <div className="text-slate-500 mt-0.5">{isAr ? f.descriptionAr : f.descriptionEn}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Suggestion cards grouped by category */}
          {(activeCategory === 'ALL' ? CATEGORY_ORDER.filter((c) => c !== 'DATA_QUALITY' && grouped.has(c)) : [activeCategory].filter((c) => c !== 'DATA_QUALITY')).map((cat) => (
            <div key={cat}>
              <h2 className="text-xs font-black text-slate-700 mb-2">{isAr ? CATEGORY_LABEL[cat as SuggestionCategory].ar : CATEGORY_LABEL[cat as SuggestionCategory].en}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {(grouped.get(cat as SuggestionCategory) || []).map((s) => {
                  const badge = AVAILABILITY_BADGE[s.availability];
                  return (
                    <div key={s.suggestionId} className="bg-white border border-slate-200 rounded-2xl p-3.5 space-y-2 shadow-xs">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-xs font-black text-slate-800">{isAr ? s.titleAr : s.titleEn}</h3>
                        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${badge.cls}`}>{isAr ? badge.ar : badge.en}</span>
                      </div>
                      <p className="text-[11px] text-slate-500">{isAr ? s.benefitAr : s.benefitEn}</p>
                      <div className="text-[11px] text-slate-400"><span className="font-bold">{t.formula}:</span> {isAr ? s.formulaAr : s.formulaEn}</div>
                      <div className="text-sm font-black text-indigo-700 flex items-center gap-1"><TrendingUp className="w-3.5 h-3.5" />{isAr ? s.previewAr : s.previewEn}</div>
                      {s.availability !== 'NOT_AVAILABLE' && canApprove && (
                        <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-100">
                          <button type="button" disabled={savingId === s.suggestionId} onClick={() => handleApprove(s)} className="flex items-center gap-1 px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-bold disabled:opacity-50 cursor-pointer">
                            {savingId === s.suggestionId ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}{t.approve}
                          </button>
                          {s.metric && (
                            <button type="button" onClick={() => handleAddToDashboard(s)} className="flex items-center gap-1 px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[10px] font-bold cursor-pointer"><PlusCircle className="w-3 h-3" />{t.addToDashboard}</button>
                          )}
                          <button type="button" onClick={() => handleDismiss(s.suggestionId)} className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg text-[10px] font-bold cursor-pointer"><XCircle className="w-3 h-3" />{t.ignore}</button>
                          <button type="button" onClick={() => handleDismiss(s.suggestionId)} className="flex items-center gap-1 px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-lg text-[10px] font-bold cursor-pointer" title={t.defer}><Clock3 className="w-3 h-3" /></button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

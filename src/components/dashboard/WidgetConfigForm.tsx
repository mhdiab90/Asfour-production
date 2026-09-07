/**
 * Widget configuration form (§1, 13-14) - the ONE place a widget's shape is
 * chosen: metric + dimension + analysis mode + chart type (recommended, or
 * an explicit override) + time range + stage, all drawn from
 * dashboardRegistry.ts's registries so the AI Report Designer and this form
 * can never disagree on what a valid widget looks like.
 *
 * Scoping note: COMPARISON here compares the top-N ranked entities (reusing
 * the same ranking engine as RANKING) rather than two hand-picked specific
 * entities, since a specific-entity picker would require extra master-data
 * dropdowns (employee/press/shift lists) beyond this task's registry-driven
 * core. Local (widget-level) filtering is limited to time range + stage +
 * entity dimension - fine-grained field filters (specific employee/customer
 * id) are not exposed in this form for the same reason.
 */
import React, { useState, useMemo } from 'react';
import { X, Wand2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { ChartGalleryPicker } from './ChartGalleryPicker';
import {
  WidgetConfig, WidgetType, ChartType, AnalysisMode, EntityType, MetricKey,
  TimeRangePreset, METRIC_REGISTRY, getMetricLabel, recommendChartType,
  TIME_RANGE_LABELS, ALL_STAGES, getStageDisplayName, WidgetSize, ALL_CHART_TYPES,
} from '../../services/dashboardRegistry';
import { ProductionStageType } from '../../types';

interface WidgetConfigFormProps {
  language: 'ar' | 'en';
  initial?: WidgetConfig;
  onCancel: () => void;
  onSave: (widget: WidgetConfig) => void;
}

const WIDGET_TYPES: WidgetType[] = ['KPI_CARD', 'RANKING', 'COMPARISON', 'CHART', 'TABLE'];
const ENTITY_TYPES: EntityType[] = ['EMPLOYEE', 'SHIFT', 'EQUIPMENT', 'PRODUCT', 'CUSTOMER', 'STAGE'];
const CHART_TYPES: ChartType[] = ALL_CHART_TYPES;

function genWidgetId(): string { return `wid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function defaultAnalysisModeFor(widgetType: WidgetType): AnalysisMode {
  if (widgetType === 'RANKING') return 'RANKING';
  if (widgetType === 'COMPARISON') return 'COMPARISON';
  if (widgetType === 'KPI_CARD') return 'SINGLE_METRIC';
  return 'SINGLE_METRIC';
}

export const WidgetConfigForm: React.FC<WidgetConfigFormProps> = ({ language, initial, onCancel, onSave }) => {
  const [widgetType, setWidgetType] = useState<WidgetType>(initial?.widgetType || 'CHART');
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>(initial?.analysisMode || defaultAnalysisModeFor(initial?.widgetType || 'CHART'));
  const [customTitle, setCustomTitle] = useState(initial?.customTitle || '');
  const [metric, setMetric] = useState<MetricKey>(initial?.metric || 'PRODUCTION_TONS');
  const [secondaryMetrics, setSecondaryMetrics] = useState<MetricKey[]>(initial?.secondaryMetrics || []);
  const [entityType, setEntityType] = useState<EntityType | ''>(initial?.entityType || '');
  const [rankingDirection, setRankingDirection] = useState<'best' | 'worst'>(initial?.rankingDirection || 'best');
  const [limit, setLimit] = useState<number>(initial?.limit || 10);
  const [chartType, setChartType] = useState<ChartType>(initial?.chartType || 'BAR');
  const [chartTypeIsOverride, setChartTypeIsOverride] = useState(initial?.chartTypeIsOverride || false);
  const [timeRangePreset, setTimeRangePreset] = useState<TimeRangePreset | 'inherit'>(initial?.timeRangePreset || 'inherit');
  const [productionStage, setProductionStage] = useState<ProductionStageType | 'all' | 'inherit'>(initial?.productionStage || 'inherit');
  const [size, setSize] = useState<WidgetSize>(initial?.size || 'MEDIUM');

  const t = {
    title: initial ? (language === 'ar' ? 'تعديل العنصر' : 'Edit Widget') : (language === 'ar' ? 'إضافة عنصر جديد' : 'Add New Widget'),
    widgetType: language === 'ar' ? 'نوع العنصر' : 'Widget Type',
    customTitle: language === 'ar' ? 'عنوان مخصص (اختياري)' : 'Custom Title (optional)',
    metric: language === 'ar' ? 'المقياس' : 'Metric',
    secondaryMetrics: language === 'ar' ? 'مقاييس إضافية' : 'Secondary Metrics',
    dimension: language === 'ar' ? 'التجميع حسب' : 'Group By',
    none: language === 'ar' ? 'بدون (قيمة إجمالية واحدة)' : 'None (single total value)',
    direction: language === 'ar' ? 'الترتيب' : 'Ranking',
    best: language === 'ar' ? 'الأفضل' : 'Best',
    worst: language === 'ar' ? 'الأسوأ' : 'Worst',
    limit: language === 'ar' ? 'عدد العناصر المعروضة' : 'Number of Items Shown',
    chartType: language === 'ar' ? 'نوع الرسم البياني' : 'Chart Type',
    recommended: language === 'ar' ? 'موصى به' : 'Recommended',
    useRecommended: language === 'ar' ? 'استخدام الموصى به' : 'Use Recommended',
    period: language === 'ar' ? 'الفترة الزمنية' : 'Time Range',
    inherit: language === 'ar' ? 'حسب اللوحة (عام)' : 'Follow Dashboard (global)',
    stage: language === 'ar' ? 'المرحلة الإنتاجية' : 'Production Stage',
    allStages: language === 'ar' ? 'كل المراحل' : 'All Stages',
    cancel: language === 'ar' ? 'إلغاء' : 'Cancel',
    save: language === 'ar' ? 'حفظ العنصر' : 'Save Widget',
    analysisMode: language === 'ar' ? 'نمط التحليل' : 'Analysis Mode',
    size: language === 'ar' ? 'الحجم' : 'Size',
    small: language === 'ar' ? 'صغير' : 'Small',
    medium: language === 'ar' ? 'متوسط' : 'Medium',
    large: language === 'ar' ? 'كبير' : 'Large',
  };

  const widgetTypeLabels: Record<WidgetType, string> = {
    KPI_CARD: language === 'ar' ? 'بطاقة مؤشر' : 'KPI Card',
    RANKING: language === 'ar' ? 'ترتيب' : 'Ranking',
    COMPARISON: language === 'ar' ? 'مقارنة' : 'Comparison',
    CHART: language === 'ar' ? 'رسم بياني' : 'Chart',
    TABLE: language === 'ar' ? 'جدول' : 'Table',
  };
  const entityLabels: Record<EntityType, string> = {
    EMPLOYEE: language === 'ar' ? 'الموظفين' : 'Employees',
    SHIFT: language === 'ar' ? 'الورديات' : 'Shifts',
    EQUIPMENT: language === 'ar' ? 'المعدات' : 'Equipment',
    PRODUCT: language === 'ar' ? 'المنتجات' : 'Products',
    CUSTOMER: language === 'ar' ? 'العملاء' : 'Customers',
    STAGE: language === 'ar' ? 'المراحل الإنتاجية' : 'Production Stages',
  };
  const analysisModeLabels: Record<AnalysisMode, string> = {
    SINGLE_METRIC: language === 'ar' ? 'مقياس واحد' : 'Single Metric',
    MULTI_METRIC: language === 'ar' ? 'عدة مقاييس' : 'Multiple Metrics',
    RANKING: language === 'ar' ? 'ترتيب' : 'Ranking',
    COMPARISON: language === 'ar' ? 'مقارنة' : 'Comparison',
    TREND: language === 'ar' ? 'اتجاه زمني' : 'Trend Over Time',
    PERIOD_COMPARISON: language === 'ar' ? 'مقارنة فترتين' : 'Period Comparison',
    CROSS_TAB: language === 'ar' ? 'مقارنة بعدين' : 'Cross-Tab (two dimensions)',
  };

  const recommendation = useMemo(
    () => recommendChartType(analysisMode, { entityCount: limit, metricCount: secondaryMetrics.length + 1 }),
    [analysisMode, limit, secondaryMetrics.length]
  );

  const effectiveChartType = chartTypeIsOverride ? chartType : recommendation.chartType;

  const toggleSecondaryMetric = (m: MetricKey) => {
    setSecondaryMetrics((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const handleSubmit = () => {
    const widget: WidgetConfig = {
      widgetId: initial?.widgetId || genWidgetId(),
      widgetType,
      customTitle: customTitle.trim() || undefined,
      analysisMode,
      metric,
      secondaryMetrics: analysisMode === 'MULTI_METRIC' ? secondaryMetrics : undefined,
      entityType: entityType || undefined,
      rankingDirection: widgetType === 'RANKING' || widgetType === 'COMPARISON' ? rankingDirection : undefined,
      limit,
      chartType: effectiveChartType,
      chartTypeIsOverride,
      timeRangePreset,
      filters: initial?.filters || {},
      productionStage,
      refreshInterval: initial?.refreshInterval,
      size,
    };
    onSave(widget);
  };

  return (
    <Modal isOpen onClose={onCancel} title={t.title} maxWidth="2xl">
      <div className="space-y-4" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        {/* Widget type */}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.widgetType}</label>
          <div className="grid grid-cols-5 gap-1.5">
            {WIDGET_TYPES.map((wt) => (
              <button
                key={wt}
                type="button"
                onClick={() => { setWidgetType(wt); setAnalysisMode(defaultAnalysisModeFor(wt)); setChartTypeIsOverride(false); }}
                className={`px-2 py-1.5 rounded text-[11px] font-bold border cursor-pointer ${widgetType === wt ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
              >
                {widgetTypeLabels[wt]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.customTitle}</label>
          <input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm" placeholder={getMetricLabel(metric, language)} />
        </div>

        {/* Analysis mode (only meaningful for CHART widgets - others imply their own mode) */}
        {widgetType === 'CHART' && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.analysisMode}</label>
            <select value={analysisMode} onChange={(e) => { setAnalysisMode(e.target.value as AnalysisMode); setChartTypeIsOverride(false); }} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm">
              {(['SINGLE_METRIC', 'MULTI_METRIC', 'TREND', 'CROSS_TAB'] as AnalysisMode[]).map((m) => <option key={m} value={m}>{analysisModeLabels[m]}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.metric}</label>
            <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm">
              {Object.values(METRIC_REGISTRY).map((m) => <option key={m.key} value={m.key}>{getMetricLabel(m.key, language)}</option>)}
            </select>
          </div>
          {widgetType !== 'KPI_CARD' && (
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.dimension}</label>
              <select value={entityType} onChange={(e) => setEntityType(e.target.value as EntityType | '')} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm">
                {widgetType === 'TABLE' && <option value="">{t.none}</option>}
                {ENTITY_TYPES.map((e) => <option key={e} value={e}>{entityLabels[e]}</option>)}
              </select>
            </div>
          )}
        </div>

        {analysisMode === 'MULTI_METRIC' && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.secondaryMetrics}</label>
            <div className="flex flex-wrap gap-1.5">
              {Object.values(METRIC_REGISTRY).filter((m) => m.key !== metric).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => toggleSecondaryMetric(m.key)}
                  className={`px-2 py-1 rounded text-[10px] font-bold border cursor-pointer ${secondaryMetrics.includes(m.key) ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-500'}`}
                >
                  {getMetricLabel(m.key, language)}
                </button>
              ))}
            </div>
          </div>
        )}

        {(widgetType === 'RANKING' || widgetType === 'COMPARISON') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.direction}</label>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setRankingDirection('best')} className={`flex-1 px-2 py-1.5 rounded text-xs font-bold border cursor-pointer ${rankingDirection === 'best' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200'}`}>{t.best}</button>
                <button type="button" onClick={() => setRankingDirection('worst')} className={`flex-1 px-2 py-1.5 rounded text-xs font-bold border cursor-pointer ${rankingDirection === 'worst' ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-200'}`}>{t.worst}</button>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.limit}</label>
              <input type="number" min={1} max={50} value={limit} onChange={(e) => setLimit(Number(e.target.value) || 10)} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm" />
            </div>
          </div>
        )}

        {/* Chart type gallery - visual mini-previews, never a bare text list (Part 4 §14-16) */}
        {widgetType !== 'KPI_CARD' && widgetType !== 'TABLE' && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-slate-600">{t.chartType}</label>
              <span className="text-[10px] text-slate-400 flex items-center gap-1"><Wand2 className="w-3 h-3" />{t.recommended}: {language === 'ar' ? recommendation.reasonAr : recommendation.reasonEn}</span>
            </div>
            <ChartGalleryPicker
              value={effectiveChartType}
              recommended={recommendation.chartType}
              onChange={(ct) => { setChartType(ct); setChartTypeIsOverride(ct !== recommendation.chartType); }}
              language={language}
              options={CHART_TYPES}
            />
            {chartTypeIsOverride && (
              <button type="button" onClick={() => setChartTypeIsOverride(false)} className="mt-1.5 text-[10px] text-indigo-600 font-bold underline cursor-pointer">{t.useRecommended}</button>
            )}
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.size}</label>
          <div className="flex gap-1.5">
            {(['SMALL', 'MEDIUM', 'LARGE'] as WidgetSize[]).map((s) => (
              <button key={s} type="button" onClick={() => setSize(s)} className={`flex-1 px-2 py-1.5 rounded text-xs font-bold border cursor-pointer ${size === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200'}`}>
                {t[s.toLowerCase() as 'small' | 'medium' | 'large']}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.period}</label>
            <select value={timeRangePreset} onChange={(e) => setTimeRangePreset(e.target.value as TimeRangePreset | 'inherit')} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm">
              <option value="inherit">{t.inherit}</option>
              {(Object.keys(TIME_RANGE_LABELS) as TimeRangePreset[]).map((p) => <option key={p} value={p}>{language === 'ar' ? TIME_RANGE_LABELS[p].ar : TIME_RANGE_LABELS[p].en}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.stage}</label>
            <select value={productionStage} onChange={(e) => setProductionStage(e.target.value as ProductionStageType | 'all' | 'inherit')} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm">
              <option value="inherit">{t.inherit}</option>
              <option value="all">{t.allStages}</option>
              {ALL_STAGES.map((s) => <option key={s} value={s}>{getStageDisplayName(s, language)}</option>)}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onCancel} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded cursor-pointer">{t.cancel}</button>
          <button type="button" onClick={handleSubmit} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded cursor-pointer">{t.save}</button>
        </div>
      </div>
    </Modal>
  );
};

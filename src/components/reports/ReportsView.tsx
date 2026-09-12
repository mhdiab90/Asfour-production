/**
 * Extensible, Stage-Aware Analytical Reports Module (Part 2/3).
 *
 * Reuses the shared reportingEngine.ts aggregation layer (also used by the
 * AI Assistant's report/analysis tools - never a second reporting engine)
 * on top of fetchUniversalStageRecords(), which already normalizes ALL 8
 * production stages - not just Pressing - into one comparable shape.
 *
 * Adding a new report category or a new production stage does not require
 * changes to this file's rendering logic: categories come from
 * REPORT_CATEGORIES (reportingEngine.ts), and stages come from
 * fetchUniversalStageRecords()'s own stage list.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Download,
  Printer,
  Layers,
  TrendingUp,
  X,
  FileSearch,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { UniversalStageRecord, NavigationPage, ProductionStageType, MultiDimensionFilter } from '../../types';
import { fetchUniversalStageRecords } from '../../services/stageRecordService';
import { exportAggregatedReportToExcel } from '../../services/exportService';
/*
 * Hierarchy scope for reports.
 *
 * Everything here is the SAME machinery Production Records already uses: the
 * same node reader, the same shared resolver, the same node: selection
 * encoding. Reports consume it - they do not reimplement it.
 */
import { fetchMasterData } from '../../services/masterDataService';
import { listCostCenterHierarchyNodes, CostCenterHierarchyRecord } from '../../services/costCenterHierarchyService';
import { buildHierarchyIndex, getNodePath } from '../../services/hierarchyResolverPure';
import { asNodeSelection, resolveHierarchyEquipmentScope } from '../../services/productionFilterEnginePure';
import { Press, Furnace } from '../../types';
import {
  REPORT_CATEGORIES,
  aggregateByDimension,
  filterUniversalRecords,
  getStageDisplayName,
  ALL_STAGES,
  AggregatedReportRow,
} from '../../services/reportingEngine';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { formatNumber, formatDecimal } from '../../utils/formatters';
import { useLanguage } from '../../i18n/LanguageContext';
import { useSetAssistantSelection } from '../../context/AssistantSelectionContext';

interface ReportsViewProps {
  onNavigate: (page: NavigationPage) => void;
}

const PIE_COLORS = ['#10b981', '#6366f1', '#f59e0b', '#f43f5e', '#0ea5e9', '#8b5cf6', '#14b8a6', '#eab308'];

/**
 * Drill-through handoff from the Dashboard Builder (Part 3 §10) - a widget's
 * "Open full report" action stores its category/stage/date-range here right
 * before navigating, and ReportsView reads (and clears) it on mount, session-
 * local only. Same session-local handoff pattern already used for the
 * Translation Manager's audit-to-edit jump.
 */
export const REPORT_PREFILL_KEY = 'asfour_reports_prefill';

/**
 * Phase 4 - the sessionStorage handoff above only applies on MOUNT (a fresh
 * navigation into this screen). If the user is ALREADY on Reports and asks
 * the assistant to change the category/stage/date without navigating away
 * (React bails out of a setState('reports') to the same page - no remount,
 * so the sessionStorage read never re-fires), this live event lets
 * openReportView (src/assistant/tools/navigationTools.ts) apply the SAME
 * prefill shape immediately, in place - still just a normal React state
 * update through this component's own setters, never direct DOM/state
 * mutation from outside.
 */
export const REPORT_PREFILL_EVENT = 'asfour:reports-prefill-update';

/** Phase 4 completion - re-triggers the SAME fetchUniversalStageRecords() call this screen already runs on mount; a genuine data reload, not a fake spinner. */
export const REPORT_REFRESH_EVENT = 'asfour:reports-refresh';

/** Phase 4 completion - restores categoryId/stageFilter/startDate/endDate to their real defaults. */
export const REPORT_RESET_EVENT = 'asfour:reports-reset';

export interface ReportPrefill {
  categoryId?: string;
  stageType?: ProductionStageType | 'all';
  startDate?: string;
  endDate?: string;
}

function readReportPrefill(): ReportPrefill | null {
  try {
    const raw = sessionStorage.getItem(REPORT_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(REPORT_PREFILL_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const ReportsView: React.FC<ReportsViewProps> = () => {
  const { language, isRtl } = useLanguage();
  const [records, setRecords] = useState<UniversalStageRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [prefill] = useState<ReportPrefill | null>(() => readReportPrefill());
  const [categoryId, setCategoryId] = useState<string>(prefill?.categoryId || 'production');
  const [stageFilter, setStageFilter] = useState<ProductionStageType | 'all'>(prefill?.stageType || 'all');
  const [startDate, setStartDate] = useState<string>(prefill?.startDate || '');
  const [endDate, setEndDate] = useState<string>(prefill?.endDate || '');
  const [drillDownRow, setDrillDownRow] = useState<AggregatedReportRow | null>(null);

  /*
   * Hierarchy scope - an ADDITIONAL report dimension.
   *
   * Empty selection means no scope at all, and the report then behaves exactly
   * as it did before this existed. That equivalence is the point: a report
   * without a hierarchy selection must not change by so much as a decimal.
   */
  const [hierarchyNodes, setHierarchyNodes] = useState<CostCenterHierarchyRecord[]>([]);
  const [equipment, setEquipment] = useState<Array<Press | Furnace>>([]);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const setAssistantSelection = useSetAssistantSelection();

  const category = REPORT_CATEGORIES.find((c) => c.id === categoryId) || REPORT_CATEGORIES[0];

  // Phase 4 - apply a prefill update live, without requiring a remount (see REPORT_PREFILL_EVENT above).
  useEffect(() => {
    function handlePrefillUpdate(e: Event) {
      const detail = (e as CustomEvent<ReportPrefill>).detail;
      if (!detail) return;
      if (detail.categoryId) setCategoryId(detail.categoryId);
      if (detail.stageType) setStageFilter(detail.stageType);
      if (detail.startDate !== undefined) setStartDate(detail.startDate || '');
      if (detail.endDate !== undefined) setEndDate(detail.endDate || '');
    }
    window.addEventListener(REPORT_PREFILL_EVENT, handlePrefillUpdate as EventListener);
    return () => window.removeEventListener(REPORT_PREFILL_EVENT, handlePrefillUpdate as EventListener);
  }, []);

  // Phase 4 - publish the live filter state so the AI Assistant's ScreenContext
  // reflects what's actually on screen (§2/§3/§54), same pattern already used
  // by StageProductionEntryView.tsx - never required, purely additive.
  useEffect(() => {
    setAssistantSelection({
      currentStage: stageFilter !== 'all' ? stageFilter : undefined,
      selectedEntityType: 'report',
      selectedFilters: { reportCategory: categoryId },
      selectedDateRange: (startDate || endDate) ? { startDate: startDate || undefined, endDate: endDate || undefined } : undefined,
    });
    return () => setAssistantSelection({});
  }, [stageFilter, categoryId, startDate, endDate, setAssistantSelection]);

  // Phase 4 completion - "حدّث البيانات" (refresh): bumping this counter
  // re-runs the SAME fetch effect below - a real reload, not a fake action.
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  useEffect(() => {
    function handleRefresh() { setRefreshTrigger((n) => n + 1); }
    window.addEventListener(REPORT_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(REPORT_REFRESH_EVENT, handleRefresh);
  }, []);

  // Phase 4 completion - "Reset للفلاتر": restores the screen's real defaults.
  useEffect(() => {
    function handleReset() {
      setCategoryId('production');
      setStageFilter('all');
      setStartDate('');
      setEndDate('');
    }
    window.addEventListener(REPORT_RESET_EVENT, handleReset);
    return () => window.removeEventListener(REPORT_RESET_EVENT, handleReset);
  }, []);

  const filters: MultiDimensionFilter = useMemo(() => ({
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    stageType: stageFilter,
  }), [startDate, endDate, stageFilter]);

  /**
   * Phase 4A - the fetch itself is now bounded by the SAME startDate/
   * endDate/stageType the filter bar above already exposes. Before this
   * change, `filters` only ever narrowed the already-fully-downloaded
   * `records` via filterUniversalRecords below, while this fetch always
   * downloaded all 8 stage collections in full regardless of the selected
   * period. Passing `filters` into fetchUniversalStageRecords pushes the
   * date range (and, when one stage is selected, the collection choice)
   * down to Firestore's own query - stageRecordService.ts handles an
   * absent startDate/endDate exactly as before (full read), so this is
   * purely additive for whichever range the user has actually selected.
   *
   * Behavior change (intentional, not silent): changing the date range or
   * stage filter now re-fetches from Firestore instead of only
   * re-filtering the already-loaded dataset in memory - the loading
   * indicator can reappear on a filter change where it previously did not.
   * The resulting report numbers are unchanged (filterUniversalRecords
   * still runs afterward as a harmless no-op safety net, since the fetch
   * already applied the same bounds).
   */
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchUniversalStageRecords(filters)
      .then((data) => { if (!cancelled) setRecords(data); })
      .catch((err) => console.error('Error fetching cross-stage records for reports:', err))
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTrigger, filters]);

  /* Nodes and equipment, read once through the existing cache-first paths. */
  useEffect(() => {
    listCostCenterHierarchyNodes()
      .then(setHierarchyNodes)
      .catch(() => { /* an unavailable hierarchy only costs the scope selector */ });
    Promise.all([
      fetchMasterData<Press>('presses').catch(() => [] as Press[]),
      fetchMasterData<Furnace>('furnaces').catch(() => [] as Furnace[]),
    ])
      .then(([p, f]) => setEquipment([...p, ...f]))
      .catch(() => { /* same */ });
  }, []);

  const hierarchyIndex = useMemo(
    () =>
      buildHierarchyIndex(
        hierarchyNodes.map((node) => ({
          ...node,
          id: node.id,
          code: node.sheet1Code,
          parentId: node.parentSheet1Code,
        })),
      ),
    [hierarchyNodes],
  );

  const equipmentLinks = useMemo(
    () => equipment.map((e) => ({ id: e.id, hierarchyNodeId: (e as any).hierarchyNodeId })),
    [equipment],
  );

  /**
   * The selected nodes expanded to the equipment ids the report may include.
   *
   * Resolved ONCE per selection - never a walk per node and never a query per
   * child - and deduplicated before a single record is examined, which is what
   * makes overlapping branches safe to select together.
   *
   * null = nothing selected = no scope. An empty Set = nodes selected but
   * nothing linked to them, which the empty state reports differently from
   * "no production".
   */
  const hierarchyScope = useMemo(
    () =>
      resolveHierarchyEquipmentScope(
        selectedNodes,
        { index: hierarchyIndex },
        { equipment: equipmentLinks },
      ),
    [selectedNodes, hierarchyIndex, equipmentLinks],
  );

  /** Node options, labelled by full path so branches are distinguishable. */
  const nodeOptions = useMemo(
    () =>
      hierarchyNodes.map((node) => ({
        value: asNodeSelection(node.id),
        label:
          getNodePath(hierarchyIndex, node.id, (x: any) => x.name || x.sheet1Code, ' ← ') ||
          node.name ||
          node.sheet1Code,
      })),
    [hierarchyNodes, hierarchyIndex],
  );

  const filteredRecords = useMemo(
    () => filterUniversalRecords(records, filters, hierarchyScope),
    [records, filters, hierarchyScope],
  );

  const reportRows = useMemo(
    () => aggregateByDimension(filteredRecords, category.dimension, language),
    [filteredRecords, category.dimension, language]
  );

  const kpis = useMemo(() => {
    const productionTons = filteredRecords.reduce((s, r) => s + (r.productionTons || 0), 0);
    const goodTons = filteredRecords.reduce((s, r) => s + (r.goodTons || 0), 0);
    const wasteTons = filteredRecords.reduce((s, r) => s + (r.wasteTons || 0), 0);
    const downtimeMinutes = filteredRecords.reduce((s, r) => s + (r.totalDowntimeMinutes || 0), 0);
    const wastePercentage = productionTons > 0 ? Number(((wasteTons / productionTons) * 100).toFixed(2)) : 0;
    return { productionTons, goodTons, wasteTons, downtimeMinutes, wastePercentage, operations: filteredRecords.length };
  }, [filteredRecords]);

  /** Production trend by date, for the always-available trend line chart. */
  const trendData = useMemo(() => {
    const byDate = new Map<string, { date: string; productionTons: number; wasteTons: number }>();
    for (const r of filteredRecords) {
      if (!r.date) continue;
      if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, productionTons: 0, wasteTons: 0 });
      const entry = byDate.get(r.date)!;
      entry.productionTons += r.productionTons || 0;
      entry.wasteTons += r.wasteTons || 0;
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredRecords]);

  const chartData = useMemo(
    () => reportRows.slice(0, 10).map((r) => ({ ...r, productionTons: Number(r.productionTons.toFixed(2)), wasteTons: Number(r.wasteTons.toFixed(2)) })),
    [reportRows]
  );

  const handleExport = () => {
    exportAggregatedReportToExcel(
      reportRows,
      language === 'ar' ? category.nameAr : category.nameEn,
      language,
      `${category.id}-report-${new Date().toISOString().split('T')[0]}.xlsx`
    );
  };

  const handlePrint = () => window.print();

  const t = {
    title: language === 'ar' ? 'التقارير التحليلية متعددة المراحل' : 'Multi-Stage Analytical Reports',
    subtitle: language === 'ar' ? 'تجميع وتحليل الإنتاج والهالك والتوقف عبر كل مراحل التصنيع الثمانية' : 'Aggregating production, waste, and downtime across all 8 manufacturing stages',
    print: language === 'ar' ? 'طباعة التقرير' : 'Print Report',
    export: language === 'ar' ? 'تصدير Excel' : 'Export to Excel',
    stage: language === 'ar' ? 'المرحلة الإنتاجية' : 'Production Stage',
    allStages: language === 'ar' ? 'كل المراحل' : 'All Stages',
    period: language === 'ar' ? 'الفترة' : 'Period',
    to: language === 'ar' ? 'إلى' : 'to',
    totalProduction: language === 'ar' ? 'إجمالي الإنتاج (طن)' : 'Total Production (t)',
    goodProduction: language === 'ar' ? 'الإنتاج السليم (طن)' : 'Good Production (t)',
    waste: language === 'ar' ? 'الهالك (طن)' : 'Waste (t)',
    wasteRate: language === 'ar' ? 'نسبة الهالك' : 'Waste Rate',
    downtime: language === 'ar' ? 'التوقف (دقيقة)' : 'Downtime (min)',
    operations: language === 'ar' ? 'عدد التشغيلات' : 'Operations',
    trend: language === 'ar' ? 'اتجاه الإنتاج خلال الفترة' : 'Production Trend Over Period',
    breakdown: language === 'ar' ? 'التوزيع حسب' : 'Breakdown by',
    table: language === 'ar' ? 'جدول النتائج المجمعة' : 'Aggregated Results Table',
    item: language === 'ar' ? 'البيان / الفئة' : 'Category',
    noData: language === 'ar' ? 'لا توجد بيانات كافية لعرض الرسم البياني.' : 'Not enough data to display this chart.',
    noRecords: language === 'ar' ? 'لا توجد سجلات مطابقة للفلاتر الحالية.' : 'No records match the current filters.',
    drillDownTitle: language === 'ar' ? 'السجلات الداعمة لهذه القيمة' : 'Records Supporting This Value',
    date: language === 'ar' ? 'التاريخ' : 'Date',
    stageCol: language === 'ar' ? 'المرحلة' : 'Stage',
    product: language === 'ar' ? 'المنتج' : 'Product',
    view: language === 'ar' ? 'عرض السجلات' : 'View Records',
    loading: language === 'ar' ? 'جاري تحميل بيانات كل مراحل الإنتاج...' : 'Loading data across all production stages...',
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header & Actions */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-500" />
            <span>{t.title}</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2 self-stretch md:self-auto">
          <button type="button" onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer">
            <Printer className="w-3.5 h-3.5" />
            <span>{t.print}</span>
          </button>
          <button type="button" onClick={handleExport} disabled={reportRows.length === 0} className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50">
            <Download className="w-3.5 h-3.5" />
            <span>{t.export}</span>
          </button>
        </div>
      </div>

      {/* Report Category Catalog (§10/§22) */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
        <div className="flex items-center gap-1.5 flex-wrap">
          {REPORT_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoryId(c.id)}
              title={language === 'ar' ? c.descriptionAr : c.descriptionEn}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${categoryId === c.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {language === 'ar' ? c.nameAr : c.nameEn}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs">
          <Layers className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-slate-500 font-bold">{t.stage}:</span>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value as any)} className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold">
            <option value="all">{t.allStages}</option>
            {ALL_STAGES.map((s) => <option key={s} value={s}>{getStageDisplayName(s, language)}</option>)}
          </select>
        </div>
        {/*
          Hierarchy scope - an ADDITIONAL dimension beside stage and period.

          Leaving it empty means no scope, and the report is then identical to
          what it produced before this control existed. Selecting a parent node
          includes every descendant node's linked equipment.
        */}
        {nodeOptions.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500 font-bold">
              {language === 'ar' ? 'المركز الإنتاجي' : 'Production centre'}:
            </span>
            <select
              id="reports-hierarchy-scope"
              multiple
              size={1}
              value={selectedNodes}
              onChange={(e) => setSelectedNodes(Array.from(e.target.selectedOptions, (o) => o.value))}
              className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold max-w-[260px]"
              title={language === 'ar'
                ? 'اترك الاختيار فارغًا ليشمل التقرير كل البيانات كالمعتاد. اختيار عقدة يشمل كل المراكز التابعة لها.'
                : 'Leave empty for the report to cover everything as before. Selecting a node includes all of its descendants.'}
            >
              {nodeOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {selectedNodes.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedNodes([])}
                className="text-[11px] font-bold text-amber-700 hover:text-amber-900 cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء النطاق' : 'Clear scope'}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 font-bold">{t.period}:</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs" />
          <span className="text-slate-400">{t.to}</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs" />
        </div>
      </div>

      {/*
        What the current scope actually means, in the user's words - never an
        internal id. Distinguishes "nothing is linked to these nodes" from
        "these nodes had no production", which are very different answers.
      */}
      {selectedNodes.length > 0 && (
        <div
          id="reports-hierarchy-scope-note"
          className={`rounded-2xl px-4 py-3 text-xs font-bold border ${
            hierarchyScope && hierarchyScope.size === 0
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-sky-50 border-sky-200 text-sky-900'
          }`}
        >
          {hierarchyScope && hierarchyScope.size === 0
            ? (language === 'ar'
                ? 'لا توجد معدات مرتبطة بهذا التسلسل - التقرير فارغ لعدم وجود ارتباط، وليس لعدم وجود إنتاج. يمكن ربط المعدات من البيانات الأساسية.'
                : 'No equipment is linked to this hierarchy selection - the report is empty because nothing is linked, not because there is no production. Equipment can be linked from Master Data.')
            : (language === 'ar'
                ? `نطاق التقرير: ${selectedNodes.length} عقدة مختارة، ويشمل جميع المراكز التابعة لها (${hierarchyScope ? hierarchyScope.size : 0} معدة مرتبطة).`
                : `Report scope: ${selectedNodes.length} selected node(s), including all descendants (${hierarchyScope ? hierarchyScope.size : 0} linked equipment record(s)).`)}
        </div>
      )}

      {isLoading ? (
        <div className="bg-white rounded-2xl p-10 border border-slate-200 shadow-xs text-center text-xs text-slate-400">{t.loading}</div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: t.operations, value: formatNumber(kpis.operations), color: 'text-slate-800' },
              { label: t.totalProduction, value: formatDecimal(kpis.productionTons, 2), color: 'text-slate-900' },
              { label: t.goodProduction, value: formatDecimal(kpis.goodTons, 2), color: 'text-emerald-700' },
              { label: t.waste, value: formatDecimal(kpis.wasteTons, 2), color: 'text-rose-700' },
              { label: t.wasteRate, value: `${formatDecimal(kpis.wastePercentage, 2)}%`, color: kpis.wastePercentage > 5 ? 'text-rose-700' : 'text-amber-700' },
              { label: t.downtime, value: formatNumber(kpis.downtimeMinutes), color: 'text-indigo-700' },
            ].map((k) => (
              <div key={k.label} className="bg-white rounded-2xl p-3.5 border border-slate-200 shadow-xs text-center">
                <span className="text-[10px] font-bold text-slate-500 block">{k.label}</span>
                <span className={`text-base font-black ${k.color}`}>{k.value}</span>
              </div>
            ))}
          </div>

          {/* Production Trend (Line) - always available */}
          {categoryId === 'production' && (
            <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <TrendingUp className="w-4 h-4 text-indigo-500" />
                  {t.trend}
                </h3>
                <Badge variant="indigo">{language === 'ar' ? 'اتجاه زمني' : 'Trend'}</Badge>
              </div>
              <div className="h-64 w-full">
                {trendData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">{t.noData}</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                      <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                      <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', fontSize: '11px', border: 'none' }} />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Line type="monotone" dataKey="productionTons" name={t.totalProduction} stroke="#6366f1" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="wasteTons" name={t.waste} stroke="#f43f5e" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}

          {/* Category Chart: Horizontal ranking bar for most categories, Donut for stage composition */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900">
                {t.breakdown} {language === 'ar' ? category.nameAr : category.nameEn}
              </h3>
              <Badge variant="indigo">{language === 'ar' ? 'تحليل مقارن' : 'Comparative'}</Badge>
            </div>
            <div className="h-72 w-full">
              {chartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">{t.noData}</div>
              ) : categoryId === 'downtime' ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={chartData} dataKey="downtimeMinutes" nameKey="label" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={2}>
                      {chartData.map((_, idx) => <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', fontSize: '11px', border: 'none' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 10, fill: '#475569' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', fontSize: '11px', border: 'none' }} />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Bar dataKey="productionTons" name={t.goodProduction} fill="#10b981" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="wasteTons" name={t.waste} fill="#f43f5e" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Aggregate Table + Drill-Down (§21) */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h4 className="text-xs font-extrabold text-slate-800">{t.table} ({reportRows.length})</h4>
              <span className="text-[11px] text-slate-500">{t.operations}: {filteredRecords.length}</span>
            </div>
            <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-460px)] lg:max-h-[calc(100vh-400px)]">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3">{t.item}</th>
                    <th className="px-4 py-3">{t.operations}</th>
                    <th className="px-4 py-3">{t.totalProduction}</th>
                    <th className="px-4 py-3">{t.goodProduction}</th>
                    <th className="px-4 py-3">{t.waste}</th>
                    <th className="px-4 py-3">{t.wasteRate}</th>
                    <th className="px-4 py-3">{t.downtime}</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {reportRows.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">{t.noRecords}</td></tr>
                  )}
                  {reportRows.map((row) => (
                    <tr key={row.key} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-bold text-slate-900">{row.label}</td>
                      <td className="px-4 py-3 font-mono">{formatNumber(row.operationsCount)}</td>
                      <td className="px-4 py-3 font-extrabold text-slate-900">{formatDecimal(row.productionTons, 2)}</td>
                      <td className="px-4 py-3 font-bold text-emerald-600">{formatDecimal(row.goodTons, 2)}</td>
                      <td className="px-4 py-3 font-bold text-rose-600">{formatDecimal(row.wasteTons, 2)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-bold ${row.wastePercentage > 5 ? 'text-rose-600' : 'text-amber-600'}`}>{formatDecimal(row.wastePercentage, 2)}%</span>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">{formatNumber(row.downtimeMinutes)}</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => setDrillDownRow(row)} className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-[10px] font-bold cursor-pointer flex items-center gap-1">
                          <FileSearch className="w-3 h-3" />{t.view}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Drill-Down Modal (§21) */}
      {drillDownRow && (
        <Modal isOpen={true} onClose={() => setDrillDownRow(null)} title={`${t.drillDownTitle}: ${drillDownRow.label}`} maxWidth="4xl">
          <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-96">
            <table className="w-full text-right text-[11px]">
              <thead className="bg-slate-50 text-slate-700 font-black sticky top-0 border-b border-slate-200">
                <tr>
                  <th className="p-2">{t.date}</th>
                  <th className="p-2">{t.stageCol}</th>
                  <th className="p-2">{t.product}</th>
                  <th className="p-2">{t.totalProduction}</th>
                  <th className="p-2">{t.waste}</th>
                  <th className="p-2">{t.downtime}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono">
                {drillDownRow.records.map((rec) => (
                  <tr key={rec.id}>
                    <td className="p-2">{rec.date}</td>
                    <td className="p-2 font-sans">{getStageDisplayName(rec.stageType, language)}</td>
                    <td className="p-2 font-sans">{rec.productName || '-'}</td>
                    <td className="p-2">{formatDecimal(rec.productionTons || 0, 2)}</td>
                    <td className="p-2">{formatDecimal(rec.wasteTons || 0, 2)}</td>
                    <td className="p-2">{formatNumber(rec.totalDowntimeMinutes || 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
};

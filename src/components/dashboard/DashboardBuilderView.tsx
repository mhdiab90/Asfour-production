/**
 * Dashboard Builder (§1, 15-17, 25, 31) - fully configurable custom
 * dashboards built from the shared Widget/Metric/Chart registry
 * (dashboardRegistry.ts) and rendered by WidgetRenderer.tsx.
 *
 * Deliberate scoping choices (disclosed in the final report, not hidden
 * here): reordering/resizing use explicit controls (move up/down, column
 * count, span) rather than pixel drag-and-drop, to avoid pulling in a new
 * drag library; widget-level entity filters are limited to the dimension
 * picker (entityType) rather than a full employee/shift/product picker,
 * since those would need extra master-data fetches beyond this task's core
 * ask. Everything else - sections, widgets, metrics, chart types, ranking,
 * comparison, global+local filters, save/rename/duplicate/delete/default,
 * drill-down, AI proposal preview - is real and wired to live data.
 *
 * Data is fetched ONCE (fetchUniversalStageRecords(), same as
 * ReportsView.tsx) and shared across every widget on the dashboard; each
 * widget then filters/aggregates client-side via reportingEngine.ts. This
 * avoids N redundant Firestore reads for N widgets on one dashboard.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  LayoutDashboard, Plus, Save, Trash2, Copy, Star, Pencil, X, Check,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Sparkles, Printer, FolderOpen,
  FileSpreadsheet, FileDown, FilterX, Filter, GripVertical, LayoutTemplate, MoveRight, ArrowRightLeft, RefreshCw,
} from 'lucide-react';
import { UniversalStageRecord, NavigationPage, Shift, Press, Product, Customer, Employee } from '../../types';
import { fetchUniversalStageRecords } from '../../services/stageRecordService';
import { fetchMasterData } from '../../services/masterDataService';
import { listCostCenterHierarchyNodes, buildCostCenterHierarchyIndex, CostCenterHierarchyRecord } from '../../services/costCenterHierarchyService';
import { resolveCostCenterProductionScope, resolveCostCenterCodeScope, metricFlags, toRuntimeDashboardFilters } from '../../services/costCenterDashboardPure';
import { FinancialValueCard, useFinancialValue } from './DashboardMetricControls';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { WidgetRenderer } from './WidgetRenderer';
import { WidgetConfigForm } from './WidgetConfigForm';
import { AIReportDesignerPanel } from './AIReportDesignerPanel';
import { PrintReportView } from './PrintReportView';
import { LiveControlBar } from './LiveControlBar';
import { SavedDashboardsManager } from './SavedDashboardsManager';
import {
  WidgetConfig, DashboardSection, DashboardLayout, GlobalDashboardFilters,
  getStageDisplayName,
  computeGridMoveTarget, widgetSpanForSize, CrossFilterState, WidgetSize,
  resolveWidgetFilters, EntityType, resolveTimeRangePreset,
} from '../../services/dashboardRegistry';
import { unionDateRange, type DateRangeBounds } from '../../services/dashboardPeriodPure';
import {
  listDashboards, getDashboard, saveDashboard, renameDashboard,
  duplicateDashboard, deleteDashboard, deleteDashboards, setDefaultDashboard, getDefaultDashboardId,
  setFavoriteDashboard,
} from '../../services/dashboardPersistenceService';
import { exportDashboardToExcel } from '../../services/exportService';
import { REPORT_PREFILL_KEY } from '../reports/ReportsView';
import { REPORT_TEMPLATES } from '../../services/reportTemplates';
import { useSetAssistantSelection } from '../../context/AssistantSelectionContext';
import { widgetDisplayLabel } from '../../services/customDashboardAiBridge';

/**
 * PHASE 5B - the custom-dashboard builder's own default period.
 *
 * This moved from THIS_MONTH to LAST_30_DAYS for the same reason the classic
 * Dashboard's default did: it is the period the shared cross-stage fetch is
 * bounded by, so the default must be a real bounded window rather than
 * something that leaves the very first query wide open. It applies ONLY when
 * a dashboard has no persisted `defaultFilters` of its own - a saved
 * dashboard still opens on exactly the period its author saved, unchanged.
 *
 * Reuses the builder's OWN existing TimeRangePreset vocabulary
 * (dashboardRegistry.ts) - Phase 5B does not introduce a second preset
 * system here and does not alter the persisted dashboard schema.
 */
export const BUILDER_DEFAULT_GLOBAL_FILTERS: GlobalDashboardFilters = {
  timeRangePreset: 'LAST_30_DAYS',
  stageType: 'all',
};

/**
 * PHASE 5B - the bounds the ONE shared cross-stage fetch must cover.
 *
 * The builder deliberately fetches once and lets every widget filter that
 * shared dataset client-side (see this file's header). That makes bounding
 * the fetch to the GLOBAL period alone unsafe: a widget may legitimately
 * OVERRIDE the global time range (`widget.timeRangePreset !== 'inherit'`)
 * or carry a period-vs-period comparison window, and either can reach
 * outside the global range. Bounding to the global range only would have
 * silently starved those widgets - wrong numbers, no error. So the fetch is
 * bounded by the UNION of every period actually rendered on the dashboard.
 *
 * An ALL_TIME global filter or an ALL_TIME widget yields an empty bound on
 * that side, i.e. an unbounded read - correct, because that is the user's
 * own explicit, visible configuration.
 */
export function resolveBuilderFetchRange(
  globalFilters: GlobalDashboardFilters,
  layout: DashboardLayout | null
): DateRangeBounds {
  const ranges: Array<DateRangeBounds | null> = [
    resolveTimeRangePreset(
      globalFilters.timeRangePreset,
      globalFilters.customStart,
      globalFilters.customEnd,
      globalFilters.namedMonth
    ),
  ];

  for (const section of layout?.sections || []) {
    for (const widget of section.widgets || []) {
      if (widget.timeRangePreset !== 'inherit') {
        ranges.push(
          resolveTimeRangePreset(
            widget.timeRangePreset,
            widget.filters.startDate || globalFilters.customStart,
            widget.filters.endDate || globalFilters.customEnd,
            globalFilters.namedMonth
          )
        );
      }
      // Period-vs-period comparison windows are explicit absolute dates and
      // are frequently OUTSIDE the currently selected period by design.
      if (widget.comparePeriods) {
        ranges.push({ startDate: widget.comparePeriods.startA, endDate: widget.comparePeriods.endA });
        ranges.push({ startDate: widget.comparePeriods.startB, endDate: widget.comparePeriods.endB });
      }
    }
  }

  return unionDateRange(ranges);
}

interface DashboardBuilderViewProps {
  onNavigate: (page: NavigationPage) => void;
}

/**
 * Phase 4B - session-local handoff for "open custom dashboard N", the SAME
 * pattern as REPORT_PREFILL_KEY/MASTER_DATA_PREFILL_KEY: sessionStorage for
 * the cold-navigation case, a live CustomEvent for the already-mounted case.
 */
export const CUSTOM_DASHBOARD_PREFILL_KEY = 'asfour_custom_dashboard_prefill';
export const CUSTOM_DASHBOARD_PREFILL_EVENT = 'asfour:customdashboard-prefill-update';
export interface CustomDashboardPrefill {
  dashboardId?: string;
}

/**
 * Phase 4B Part 3/Part 15 - the ONE live-control channel for every AI-driven
 * edit to the dashboard that is ALREADY open here. Every action below is
 * applied through this component's OWN EXISTING handler functions
 * (updateDraft/setGlobalFilters/saveDashboard/etc.) - the same ones a human
 * click already uses - so there is exactly ONE authoritative dashboard
 * state, never a parallel "AI shadow state" (Part 15 CRITICAL).
 */
export const CUSTOM_DASHBOARD_ACTION_EVENT = 'asfour:customdashboard-ai-action';
export type CustomDashboardAction =
  | { type: 'SELECT_DASHBOARD'; dashboardId: string }
  | { type: 'SET_FILTERS'; patch: Partial<GlobalDashboardFilters> }
  | { type: 'SET_WIDGET'; widgetId: string; patch: Partial<Pick<WidgetConfig, 'chartType' | 'chartTypeIsOverride' | 'rankingDirection' | 'metric'>> }
  | { type: 'SELECT_WIDGET'; widgetId: string | null }
  | { type: 'SAVE_CURRENT'; asDefaultFilters?: boolean }
  | { type: 'CREATE_DASHBOARD'; layout: Omit<DashboardLayout, 'dashboardId' | 'dashboardNumber' | 'createdAt' | 'updatedAt'> };

function genSectionId(): string { return `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }
function genWidgetId(): string { return `wid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function blankLayout(name: string): Omit<DashboardLayout, 'dashboardId' | 'dashboardNumber' | 'createdAt' | 'updatedAt'> {
  return {
    name,
    sections: [{ sectionId: genSectionId(), title: name, columns: 3, widgets: [] }],
  };
}

/** Drill-through target (Part 3 §10) - maps a widget's own entity dimension onto the closest matching Reports category id, so "Open full report" lands somewhere genuinely relevant. */
const ENTITY_TO_REPORT_CATEGORY: Record<EntityType, string> = {
  EMPLOYEE: 'employee', SHIFT: 'shift', EQUIPMENT: 'equipment', PRODUCT: 'production', CUSTOMER: 'production', STAGE: 'stageComparison',
};

export const DashboardBuilderView: React.FC<DashboardBuilderViewProps> = ({ onNavigate }) => {
  const { language, isRtl } = useLanguage();
  const { isSuperAdmin, hasPermission, adminUser } = useAuth();
  const canManage = isSuperAdmin || hasPermission('dashboard.manageCustomDashboards');

  const [allRecords, setAllRecords] = useState<UniversalStageRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dashboards, setDashboards] = useState<DashboardLayout[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showDashboardList, setShowDashboardList] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showPrintView, setShowPrintView] = useState(false);
  const [crossFilter, setCrossFilter] = useState<CrossFilterState | null>(null);
  const dragRef = useRef<{ sectionId: string; widgetId: string } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<{ sectionId: string; index: number } | null>(null);
  const [renamingSectionId, setRenamingSectionId] = useState<string | null>(null);
  const [widgetFormState, setWidgetFormState] = useState<{ sectionId: string; widget?: WidgetConfig } | null>(null);
  const [drillDown, setDrillDown] = useState<{ title: string; records: UniversalStageRecord[] } | null>(null);
  const [showAiDesigner, setShowAiDesigner] = useState(false);
  const [deleteSectionState, setDeleteSectionState] = useState<{ sectionId: string } | null>(null);
  const [moveToSectionState, setMoveToSectionState] = useState<{ sectionId: string; widgetId: string } | null>(null);
  const sectionDragRef = useRef<string | null>(null);
  /** Phase 4B Part 4 §14/§21 - a lightweight click-to-select on a widget's own controls strip so "غير شكله" can resolve to it with no clarification needed, exactly like a text field's cursor focus. Purely a UI/AI-context affordance - never affects rendering or persistence. */
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const setAssistantSelection = useSetAssistantSelection();

  /*
   * THE dashboard filter state - the only one. The filter bar writes it, every
   * widget, the financial card, the print view and the export read it.
   *
   * Every write goes through setGlobalFilters below, which normalises the value
   * to the dimensions this dashboard offers (toRuntimeDashboardFilters). That
   * covers the bar, a loaded or template dashboard's saved defaults, the
   * assistant's filter action and the AI designer alike, so a dimension the bar
   * no longer shows can never survive as an invisible filter.
   */
  const [globalFilters, setGlobalFiltersState] = useState<GlobalDashboardFilters>({ ...BUILDER_DEFAULT_GLOBAL_FILTERS });
  const setGlobalFilters = useCallback(
    (next: GlobalDashboardFilters | ((prev: GlobalDashboardFilters) => GlobalDashboardFilters)) => {
      setGlobalFiltersState((prev) => toRuntimeDashboardFilters(typeof next === 'function' ? next(prev) : next));
    },
    [],
  );

  // Live Control Bar master-data lookups (Part 4 §16) - fetched ONCE, same
  // as the shift/press/product/customer lookups every entry form already
  // does; never re-fetched on every filter click.
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [presses, setPresses] = useState<Press[]>([]);
  /*
   * The cost-centre hierarchy and the furnaces are what let a selected node
   * reach the production records beneath it: records name a press or furnace,
   * and those carry the hierarchyNodeId.
   */
  const [furnaces, setFurnaces] = useState<Array<{ id?: string; hierarchyNodeId?: string | null }>>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<CostCenterHierarchyRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  /**
   * PHASE 5B - the bounds this screen's ONE shared fetch is limited to.
   * Recomputed from the visible global period plus every widget that
   * overrides it (see resolveBuilderFetchRange above for why the union,
   * not just the global period, is the correct bound).
   */
  const fetchRange = useMemo(
    () => resolveBuilderFetchRange(globalFilters, draft),
    [globalFilters, draft]
  );

  /**
   * PHASE 5B - previously called fetchUniversalStageRecords() with NO
   * arguments, which read all 8 stage collections in full on every mount and
   * every refresh and could never satisfy the Phase 4B cache's
   * both-dates-present eligibility rule. It now passes the resolved bounds
   * into the SAME existing service call - no query logic is duplicated here,
   * no second cache is introduced, and stageRecordService.ts is untouched.
   */
  const loadRecords = useCallback((isManualRefresh: boolean, range: DateRangeBounds) => {
    if (isManualRefresh) setIsRefreshing(true); else setIsLoading(true);
    return fetchUniversalStageRecords({ startDate: range.startDate, endDate: range.endDate })
      .then((data) => { setAllRecords(data); setLastUpdated(new Date()); })
      .catch((err) => console.error('Error fetching cross-stage records for dashboard builder:', err))
      .finally(() => { setIsLoading(false); setIsRefreshing(false); });
  }, []);

  /**
   * PHASE 5B - the shared cross-stage fetch now re-runs whenever the
   * RESOLVED bounds change (a global period change, or a widget starting/
   * stopping an override), not only on mount. Keyed on the resolved date
   * STRINGS rather than the range object, so unrelated draft edits
   * (renaming a widget, reordering a section) never trigger a refetch.
   */
  useEffect(() => {
    loadRecords(false, { startDate: fetchRange.startDate, endDate: fetchRange.endDate });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchRange.startDate, fetchRange.endDate]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchMasterData<Shift>('shifts'),
      fetchMasterData<Press>('presses'),
      fetchMasterData<Product>('products'),
      fetchMasterData<Customer>('customers'),
      fetchMasterData<Employee>('employees'),
      fetchMasterData<any>('furnaces').catch(() => []),
      listCostCenterHierarchyNodes().catch(() => [] as CostCenterHierarchyRecord[]),
    ]).then(([s, p, pr, c, e, f, h]) => {
      if (cancelled) return;
      setShifts(s); setPresses(p); setProducts(pr); setCustomers(c); setEmployees(e);
      setFurnaces(f); setHierarchyNodes(h);
    }).catch((err) => console.error('Error fetching Live Control Bar lookups:', err));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The canonical hierarchy index - the same builder Master Data uses. */
  const hierarchyIndex = useMemo(() => buildCostCenterHierarchyIndex(hierarchyNodes), [hierarchyNodes]);

  /**
   * The selected cost centres resolved to equipment, ONCE for the whole
   * dashboard - not once per widget - through the same resolver the classic
   * Dashboard and Reports use.
   */
  const hierarchyScope = useMemo(
    () => resolveCostCenterProductionScope(
      globalFilters.costCenterNodeIds ?? [],
      hierarchyIndex,
      [...presses, ...furnaces].map((e: any) => ({ id: e.id, hierarchyNodeId: e.hierarchyNodeId })),
    ),
    [globalFilters.costCenterNodeIds, hierarchyIndex, presses, furnaces],
  );

  /*
   * Metric type, from the shared filter model. Money uses the same hook, scope
   * rule and card as the classic Dashboard, over the dashboard's global period
   * and cost-centre selection; nothing is read unless financial values show.
   */
  const { quantity: showQuantity, financial: showFinancial } = metricFlags(globalFilters.metricMode ?? 'QUANTITY');
  const costCenterCodeScope = useMemo(
    () => resolveCostCenterCodeScope(globalFilters.costCenterNodeIds ?? [], hierarchyIndex),
    [globalFilters.costCenterNodeIds, hierarchyIndex],
  );
  const globalPeriod = useMemo(
    () => resolveTimeRangePreset(globalFilters.timeRangePreset, globalFilters.customStart, globalFilters.customEnd, globalFilters.namedMonth),
    [globalFilters.timeRangePreset, globalFilters.customStart, globalFilters.customEnd, globalFilters.namedMonth],
  );
  const financialValue = useFinancialValue(showFinancial, {
    costCenterCodes: costCenterCodeScope,
    startDate: globalPeriod.startDate || undefined,
    endDate: globalPeriod.endDate || undefined,
  });

  const refreshDashboardList = useCallback(() => {
    const list = listDashboards();
    setDashboards(list);
    return list;
  }, []);

  useEffect(() => {
    const list = refreshDashboardList();
    // Phase 4B - a cold-navigation prefill ("open dashboard #1") takes
    // priority over the usual default/first-dashboard fallback, the SAME
    // sessionStorage handoff ReportsView/MasterDataView already use.
    let prefillId: string | undefined;
    try {
      const raw = sessionStorage.getItem(CUSTOM_DASHBOARD_PREFILL_KEY);
      if (raw) {
        const prefill: CustomDashboardPrefill = JSON.parse(raw);
        prefillId = prefill.dashboardId;
        sessionStorage.removeItem(CUSTOM_DASHBOARD_PREFILL_KEY);
      }
    } catch { /* ignore - falls through to the normal default */ }

    const defaultId = getDefaultDashboardId();
    const initial = (prefillId && list.find((d) => d.dashboardId === prefillId))
      || (defaultId && list.find((d) => d.dashboardId === defaultId))
      || list[0];
    if (initial) {
      setActiveId(initial.dashboardId);
      setDraft(JSON.parse(JSON.stringify(initial)));
      // Part 5/§6 - open with the dashboard's own PERSISTED default filters
      // when it has one; otherwise use BUILDER_DEFAULT_GLOBAL_FILTERS
      // default, exactly as before this field existed.
      if (initial.defaultFilters) setGlobalFilters(initial.defaultFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshDashboardList]);

  // Phase 4B Part 3 §4 - publishes the dashboard the user actually has open
  // (id/number/name/owner/editability/live filters/widget summaries/
  // selected widget) so the AI's ScreenContext reflects real state, the SAME
  // screen->AI channel every other Phase 4 view already uses. Capped widget
  // summary (never raw record data - §31/§32) keeps this payload small.
  useEffect(() => {
    if (!draft) { setAssistantSelection({}); return; }
    const widgetSummaries = draft.sections.flatMap((s) => s.widgets).slice(0, 30).map((w) => ({
      widgetId: w.widgetId,
      label: widgetDisplayLabel(w, language),
      chartType: w.chartType,
      metric: w.metric,
      entityType: w.entityType,
      analysisMode: w.analysisMode,
      limit: w.limit,
      secondaryMetricsCount: w.secondaryMetrics?.length || 0,
      rankingDirection: w.rankingDirection,
    }));
    setAssistantSelection({
      selectedEntityType: 'customDashboard',
      selectedFilters: {
        dashboardId: draft.dashboardId,
        dashboardNumber: draft.dashboardNumber,
        dashboardName: draft.name,
        dashboardOwner: draft.ownerName,
        editable: canManage,
        currentDashboardPage: 'builder',
        filters: globalFilters,
        widgets: widgetSummaries,
        selectedWidgetId,
      },
    });
    return () => setAssistantSelection({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, globalFilters, selectedWidgetId, canManage, language]);

  /** Phase 4B - persists the CURRENT on-screen draft, optionally folding the CURRENT temporary globalFilters into the dashboard's persisted defaultFilters (Part 5/§6 - only on an EXPLICIT save, never automatically). Computes the exact object to save directly rather than chaining updateDraft()+handleSave(), since those would otherwise race against React's async state batching. */
  const handleAiSaveCurrent = useCallback((asDefaultFilters?: boolean) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const toSave = asDefaultFilters ? { ...prev, defaultFilters: globalFilters } : prev;
      const saved = saveDashboard(toSave);
      setActiveId(saved.dashboardId);
      setDirty(false);
      refreshDashboardList();
      return saved;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalFilters, refreshDashboardList]);

  /** Phase 4B Part 5 §15-19 - a fully-formed, already-user-confirmed draft (the chat's own confirm/cancel flow already ran) is persisted immediately and opened, mirroring handleCreateFromTemplate()'s exact behavior. */
  const handleAiCreateDashboard = useCallback((layout: Omit<DashboardLayout, 'dashboardId' | 'dashboardNumber' | 'createdAt' | 'updatedAt'>) => {
    const created = saveDashboard(layout);
    refreshDashboardList();
    setActiveId(created.dashboardId);
    setDraft(JSON.parse(JSON.stringify(created)));
    setDirty(false);
    if (created.defaultFilters) setGlobalFilters(created.defaultFilters);
  }, [refreshDashboardList]);

  // Phase 4B Part 3 - the ONE live-control channel for AI-driven edits to
  // whichever dashboard is open here, applied through this component's own
  // existing handlers (Part 15 - one authoritative state, never a shadow one).
  useEffect(() => {
    function handleAction(e: Event) {
      const action = (e as CustomEvent<CustomDashboardAction>).detail;
      if (!action) return;
      if (action.type === 'SELECT_DASHBOARD') {
        const found = getDashboard(action.dashboardId);
        if (found) {
          setActiveId(action.dashboardId);
          setDraft(JSON.parse(JSON.stringify(found)));
          setDirty(false);
          setSelectedWidgetId(null);
          setGlobalFilters(found.defaultFilters || { ...BUILDER_DEFAULT_GLOBAL_FILTERS });
        }
      } else if (action.type === 'SET_FILTERS') {
        setGlobalFilters((f) => ({ ...f, ...action.patch }));
      } else if (action.type === 'SET_WIDGET') {
        setDraft((prev) => {
          if (!prev) return prev;
          const next = { ...prev, sections: prev.sections.map((s) => ({ ...s, widgets: s.widgets.map((w) => (w.widgetId === action.widgetId ? { ...w, ...action.patch } : w)) })) };
          return next;
        });
        setDirty(true);
      } else if (action.type === 'SELECT_WIDGET') {
        setSelectedWidgetId(action.widgetId);
      } else if (action.type === 'SAVE_CURRENT') {
        handleAiSaveCurrent(action.asDefaultFilters);
      } else if (action.type === 'CREATE_DASHBOARD') {
        handleAiCreateDashboard(action.layout);
      }
    }
    function handlePrefill(e: Event) {
      const prefill = (e as CustomEvent<CustomDashboardPrefill>).detail;
      if (prefill?.dashboardId) {
        const found = getDashboard(prefill.dashboardId);
        if (found) {
          setActiveId(prefill.dashboardId);
          setDraft(JSON.parse(JSON.stringify(found)));
          setDirty(false);
          if (found.defaultFilters) setGlobalFilters(found.defaultFilters);
        }
      }
    }
    window.addEventListener(CUSTOM_DASHBOARD_ACTION_EVENT, handleAction as EventListener);
    window.addEventListener(CUSTOM_DASHBOARD_PREFILL_EVENT, handlePrefill as EventListener);
    return () => {
      window.removeEventListener(CUSTOM_DASHBOARD_ACTION_EVENT, handleAction as EventListener);
      window.removeEventListener(CUSTOM_DASHBOARD_PREFILL_EVENT, handlePrefill as EventListener);
    };
  }, [handleAiSaveCurrent, handleAiCreateDashboard]);

  const t = {
    title: language === 'ar' ? 'لوحة معلومات مخصصة' : 'Custom Dashboard Builder',
    subtitle: language === 'ar' ? 'صمم لوحة تحكم خاصة بك من عناصر مرنة مبنية على بيانات المصنع الفعلية' : 'Design your own dashboard from flexible widgets built on real factory data',
    myDashboards: language === 'ar' ? 'لوحاتي المحفوظة' : 'My Dashboards',
    newDashboard: language === 'ar' ? 'لوحة جديدة' : 'New Dashboard',
    save: language === 'ar' ? 'حفظ' : 'Save',
    saved: language === 'ar' ? 'تم الحفظ' : 'Saved',
    rename: language === 'ar' ? 'إعادة تسمية' : 'Rename',
    duplicate: language === 'ar' ? 'نسخ' : 'Duplicate',
    delete: language === 'ar' ? 'حذف' : 'Delete',
    setDefault: language === 'ar' ? 'تعيين كافتراضي' : 'Set as Default',
    default: language === 'ar' ? 'افتراضي' : 'Default',
    addSection: language === 'ar' ? 'إضافة قسم' : 'Add Section',
    addWidget: language === 'ar' ? 'إضافة عنصر' : 'Add Widget',
    columns: language === 'ar' ? 'أعمدة' : 'Columns',
    period: language === 'ar' ? 'الفترة (عامة)' : 'Period (global)',
    stage: language === 'ar' ? 'المرحلة (عامة)' : 'Stage (global)',
    allStages: language === 'ar' ? 'كل المراحل' : 'All Stages',
    aiDesigner: language === 'ar' ? 'مصمم التقارير بالذكاء الاصطناعي' : 'AI Report Designer',
    print: language === 'ar' ? 'طباعة' : 'Print',
    noDashboards: language === 'ar' ? 'لا توجد لوحات محفوظة بعد. أنشئ أول لوحة.' : 'No saved dashboards yet. Create your first one.',
    noAccess: language === 'ar' ? 'لا تملك صلاحية إدارة اللوحات المخصصة. تواصل مع المسؤول.' : 'You do not have permission to manage custom dashboards. Contact your administrator.',
    loading: language === 'ar' ? 'جاري تحميل بيانات المصنع...' : 'Loading factory data...',
    emptySection: language === 'ar' ? 'لا توجد عناصر في هذا القسم بعد.' : 'No widgets in this section yet.',
    confirmDeleteSection: language === 'ar' ? 'حذف هذا القسم وكل عناصره؟' : 'Delete this section and all its widgets?',
    confirmDeleteDashboard: language === 'ar' ? 'حذف هذه اللوحة نهائيًا؟' : 'Permanently delete this dashboard?',
    confirmRemoveWidget: language === 'ar' ? 'إزالة هذا العنصر؟' : 'Remove this widget?',
    drillDownTitle: language === 'ar' ? 'السجلات الداعمة لهذه القيمة' : 'Records supporting this value',
    unsaved: language === 'ar' ? 'تغييرات غير محفوظة' : 'Unsaved changes',
    newReport: language === 'ar' ? 'تقرير جديد' : 'New Report',
    chooseTemplate: language === 'ar' ? 'اختر قالب تقرير' : 'Choose a Report Template',
    useTemplate: language === 'ar' ? 'استخدام هذا القالب' : 'Use This Template',
    exportExcel: language === 'ar' ? 'تصدير Excel' : 'Export to Excel',
    resetFilters: language === 'ar' ? 'إعادة ضبط كل الفلاتر' : 'Reset All Filters',
    crossFilterActive: (label: string) => language === 'ar' ? `مُفلتر حسب: ${label}` : `Filtered by: ${label}`,
    clearFilter: language === 'ar' ? 'إزالة' : 'Clear',
    size: language === 'ar' ? 'الحجم' : 'Size',
    small: language === 'ar' ? 'صغير' : 'Small',
    medium: language === 'ar' ? 'متوسط' : 'Medium',
    large: language === 'ar' ? 'كبير' : 'Large',
    reportBadge: language === 'ar' ? 'تقرير' : 'Report',
    moveToSection: language === 'ar' ? 'نقل إلى قسم' : 'Move to Section',
    sectionHasWidgets: (n: number) => language === 'ar' ? `يحتوي هذا القسم على ${n} عنصر. اختر ما تريد فعله بها قبل حذف القسم.` : `This section contains ${n} widget(s). Choose what to do with them before deleting the section.`,
    moveWidgetsToAnother: language === 'ar' ? 'نقل العناصر إلى قسم آخر' : 'Move Widgets to Another Section',
    deleteWidgetsToo: language === 'ar' ? 'حذف العناصر أيضًا' : 'Delete Widgets Too',
    chooseTargetSection: language === 'ar' ? 'اختر القسم الهدف' : 'Choose the target section',
    noOtherSections: language === 'ar' ? 'لا يوجد قسم آخر - أنشئ قسمًا جديدًا أولاً.' : 'No other section exists - create a new section first.',
    cancel: language === 'ar' ? 'إلغاء' : 'Cancel',
  };

  if (!canManage) {
    return (
      <div className="p-10 text-center text-sm text-slate-500 bg-white border border-slate-200" dir={isRtl ? 'rtl' : 'ltr'}>
        <LayoutDashboard className="w-8 h-8 mx-auto mb-3 text-slate-300" />
        {t.noAccess}
      </div>
    );
  }

  const updateDraft = (fn: (d: DashboardLayout) => DashboardLayout) => {
    setDraft((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  };

  const handleCreateDashboard = () => {
    const name = language === 'ar' ? `لوحة جديدة ${dashboards.length + 1}` : `New Dashboard ${dashboards.length + 1}`;
    const created = saveDashboard(blankLayout(name));
    refreshDashboardList();
    setActiveId(created.dashboardId);
    setDraft(JSON.parse(JSON.stringify(created)));
    setDirty(false);
  };

  const handleSelectDashboard = (id: string) => {
    const found = getDashboard(id);
    if (found) {
      setActiveId(id);
      setDraft(JSON.parse(JSON.stringify(found)));
      setDirty(false);
      setSelectedWidgetId(null);
      setGlobalFilters(found.defaultFilters || { ...BUILDER_DEFAULT_GLOBAL_FILTERS });
      setShowDashboardList(false);
    }
  };

  const handleSave = () => {
    if (!draft) return;
    const saved = saveDashboard(draft);
    setDraft(saved);
    setActiveId(saved.dashboardId);
    setDirty(false);
    refreshDashboardList();
  };

  const handleRename = () => {
    if (!draft) return;
    const name = window.prompt(language === 'ar' ? 'اسم اللوحة الجديد' : 'New dashboard name', draft.name);
    if (name && name.trim()) {
      updateDraft((d) => ({ ...d, name: name.trim() }));
      renameDashboard(draft.dashboardId, name.trim());
      refreshDashboardList();
    }
  };

  const handleDuplicate = () => {
    if (!draft) return;
    const name = `${draft.name} (${language === 'ar' ? 'نسخة' : 'copy'})`;
    const copy = duplicateDashboard(draft.dashboardId, name);
    if (copy) {
      refreshDashboardList();
      setActiveId(copy.dashboardId);
      setDraft(JSON.parse(JSON.stringify(copy)));
      setDirty(false);
    }
  };

  const handleDelete = () => {
    if (!draft) return;
    if (!window.confirm(t.confirmDeleteDashboard)) return;
    deleteDashboard(draft.dashboardId);
    const list = refreshDashboardList();
    if (list[0]) handleSelectDashboard(list[0].dashboardId);
    else { setDraft(null); setActiveId(null); }
  };

  const handleSetDefault = () => {
    if (!draft) return;
    setDefaultDashboard(draft.dashboardId);
    refreshDashboardList();
  };

  const handleAddSection = () => {
    updateDraft((d) => ({
      ...d,
      sections: [...d.sections, { sectionId: genSectionId(), title: language === 'ar' ? 'قسم جديد' : 'New Section', columns: 3, widgets: [] }],
    }));
  };

  const handleRenameSection = (sectionId: string, title: string) => {
    updateDraft((d) => ({ ...d, sections: d.sections.map((s) => (s.sectionId === sectionId ? { ...s, title } : s)) }));
    setRenamingSectionId(null);
  };

  const handleSetSectionColumns = (sectionId: string, columns: 1 | 2 | 3 | 4) => {
    updateDraft((d) => ({ ...d, sections: d.sections.map((s) => (s.sectionId === sectionId ? { ...s, columns } : s)) }));
  };

  /** Deleting a section with widgets in it must never silently delete those widgets (Part 2 §8) - route through a choice dialog instead. An empty section deletes immediately, no dialog needed. */
  const handleDeleteSection = (sectionId: string) => {
    const section = draft?.sections.find((s) => s.sectionId === sectionId);
    if (!section || section.widgets.length === 0) {
      updateDraft((d) => ({ ...d, sections: d.sections.filter((s) => s.sectionId !== sectionId) }));
      return;
    }
    setDeleteSectionState({ sectionId });
  };

  const handleDeleteSectionAndWidgets = (sectionId: string) => {
    if (!window.confirm(t.confirmDeleteSection)) return;
    updateDraft((d) => ({ ...d, sections: d.sections.filter((s) => s.sectionId !== sectionId) }));
    setDeleteSectionState(null);
  };

  const handleMoveWidgetsThenDeleteSection = (sectionId: string, targetSectionId: string) => {
    updateDraft((d) => {
      const source = d.sections.find((s) => s.sectionId === sectionId);
      if (!source) return d;
      const sections = d.sections
        .map((s) => (s.sectionId === targetSectionId ? { ...s, widgets: [...s.widgets, ...source.widgets] } : s))
        .filter((s) => s.sectionId !== sectionId);
      return { ...d, sections };
    });
    setDeleteSectionState(null);
  };

  const handleMoveSection = (sectionId: string, dir: -1 | 1) => {
    updateDraft((d) => {
      const idx = d.sections.findIndex((s) => s.sectionId === sectionId);
      const newIdx = idx + dir;
      if (idx < 0 || newIdx < 0 || newIdx >= d.sections.length) return d;
      const sections = [...d.sections];
      [sections[idx], sections[newIdx]] = [sections[newIdx], sections[idx]];
      return { ...d, sections };
    });
  };

  // Section drag-and-drop reordering (Part 2 §6), separate from widget DnD - reorders the sections array itself.
  const handleSectionDragStart = (sectionId: string) => { sectionDragRef.current = sectionId; };
  const handleSectionDrop = (targetSectionId: string) => {
    const draggedId = sectionDragRef.current;
    sectionDragRef.current = null;
    if (!draggedId || draggedId === targetSectionId) return;
    updateDraft((d) => {
      const sections = [...d.sections];
      const fromIdx = sections.findIndex((s) => s.sectionId === draggedId);
      const toIdx = sections.findIndex((s) => s.sectionId === targetSectionId);
      if (fromIdx < 0 || toIdx < 0) return d;
      const [moved] = sections.splice(fromIdx, 1);
      sections.splice(toIdx, 0, moved);
      return { ...d, sections };
    });
  };

  /** Explicit "Move to Section" action (Part 1 §3) - moves a widget to a DIFFERENT section by id, preserving every field on the widget itself (only its section membership/position changes). */
  const handleMoveWidgetToSection = (sourceSectionId: string, widgetId: string, targetSectionId: string) => {
    if (sourceSectionId === targetSectionId) { setMoveToSectionState(null); return; }
    updateDraft((d) => {
      const source = d.sections.find((s) => s.sectionId === sourceSectionId);
      const widget = source?.widgets.find((w) => w.widgetId === widgetId);
      if (!widget) return d;
      const sections = d.sections.map((s) => {
        if (s.sectionId === sourceSectionId) return { ...s, widgets: s.widgets.filter((w) => w.widgetId !== widgetId) };
        if (s.sectionId === targetSectionId) return { ...s, widgets: [...s.widgets, widget] };
        return s;
      });
      return { ...d, sections };
    });
    setMoveToSectionState(null);
  };

  const handleSaveWidget = (sectionId: string, widget: WidgetConfig) => {
    updateDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => {
        if (s.sectionId !== sectionId) return s;
        const exists = s.widgets.some((w) => w.widgetId === widget.widgetId);
        return { ...s, widgets: exists ? s.widgets.map((w) => (w.widgetId === widget.widgetId ? widget : w)) : [...s.widgets, widget] };
      }),
    }));
    setWidgetFormState(null);
  };

  const handleRemoveWidget = (sectionId: string, widgetId: string) => {
    if (!window.confirm(t.confirmRemoveWidget)) return;
    updateDraft((d) => ({ ...d, sections: d.sections.map((s) => (s.sectionId === sectionId ? { ...s, widgets: s.widgets.filter((w) => w.widgetId !== widgetId) } : s)) }));
  };

  const handleDuplicateWidget = (sectionId: string, widget: WidgetConfig) => {
    updateDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.sectionId === sectionId ? { ...s, widgets: [...s.widgets, { ...widget, widgetId: genWidgetId() }] } : s)),
    }));
  };

  /**
   * 4-direction grid move (Part 1 §2-3) - up/down jump a full row, left/
   * right move one cell within the same row, using the section's own
   * column count. When Up/Down would be a no-op AT the section's own
   * boundary (top/bottom row) and an adjacent section exists, the widget
   * crosses into that section instead of doing nothing - moving it into
   * the END of the previous section (Up) or the START of the next section
   * (Down), so the arrow controls alone can relocate a widget across
   * sections without drag-and-drop or the "Move to Section" dialog.
   */
  const handleMoveWidgetGrid = (sectionId: string, widgetId: string, direction: 'up' | 'down' | 'left' | 'right') => {
    updateDraft((d) => {
      const sIdx = d.sections.findIndex((s) => s.sectionId === sectionId);
      if (sIdx < 0) return d;
      const section = d.sections[sIdx];
      const idx = section.widgets.findIndex((w) => w.widgetId === widgetId);
      if (idx < 0) return d;
      const target = computeGridMoveTarget(idx, section.widgets.length, section.columns, direction);

      if (target !== null) {
        const widgets = [...section.widgets];
        [widgets[idx], widgets[target]] = [widgets[target], widgets[idx]];
        const sections = [...d.sections];
        sections[sIdx] = { ...section, widgets };
        return { ...d, sections };
      }

      if (direction === 'up' && sIdx > 0) {
        const widget = section.widgets[idx];
        const sections = [...d.sections];
        sections[sIdx] = { ...section, widgets: section.widgets.filter((w) => w.widgetId !== widgetId) };
        const prev = sections[sIdx - 1];
        sections[sIdx - 1] = { ...prev, widgets: [...prev.widgets, widget] };
        return { ...d, sections };
      }
      if (direction === 'down' && sIdx < d.sections.length - 1) {
        const widget = section.widgets[idx];
        const sections = [...d.sections];
        sections[sIdx] = { ...section, widgets: section.widgets.filter((w) => w.widgetId !== widgetId) };
        const next = sections[sIdx + 1];
        sections[sIdx + 1] = { ...next, widgets: [widget, ...next.widgets] };
        return { ...d, sections };
      }
      return d;
    });
  };

  const handleSetWidgetSize = (sectionId: string, widgetId: string, size: WidgetSize) => {
    updateDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => (s.sectionId === sectionId ? { ...s, widgets: s.widgets.map((w) => (w.widgetId === widgetId ? { ...w, size } : w)) } : s)),
    }));
  };

  // Native HTML5 drag-and-drop reordering (Part 1 §2) - no new dependency.
  // Supports both reordering within a section and moving a widget across
  // sections (e.g. dragging a widget from the Pressing section into the
  // Mills section).
  const handleDragStart = (sectionId: string, widgetId: string) => {
    dragRef.current = { sectionId, widgetId };
  };
  const handleDragOverWidget = (e: React.DragEvent, sectionId: string, index: number) => {
    e.preventDefault();
    setDragOverTarget({ sectionId, index });
  };
  const handleDrop = (targetSectionId: string, targetIndex: number) => {
    const dragged = dragRef.current;
    dragRef.current = null;
    setDragOverTarget(null);
    if (!dragged) return;
    updateDraft((d) => {
      const sourceSection = d.sections.find((s) => s.sectionId === dragged.sectionId);
      const draggedWidget = sourceSection?.widgets.find((w) => w.widgetId === dragged.widgetId);
      if (!sourceSection || !draggedWidget) return d;
      const sections = d.sections.map((s) => {
        if (s.sectionId === dragged.sectionId) {
          return { ...s, widgets: s.widgets.filter((w) => w.widgetId !== dragged.widgetId) };
        }
        return s;
      }).map((s) => {
        if (s.sectionId !== targetSectionId) return s;
        const widgets = [...s.widgets];
        const insertAt = Math.min(targetIndex, widgets.length);
        widgets.splice(insertAt, 0, draggedWidget);
        return { ...s, widgets };
      });
      return { ...d, sections };
    });
  };

  // Power BI-style cross-filtering (Part 3 §8/§13).
  const handleCrossFilterRequest = (entityType: NonNullable<WidgetConfig['entityType']>, key: string, label: string, sourceWidgetId: string) => {
    setCrossFilter((prev) => (prev && prev.sourceWidgetId === sourceWidgetId && prev.key === key ? null : { entityType, key, label, sourceWidgetId }));
  };
  const handleClearCrossFilter = () => setCrossFilter(null);
  const handleResetAllFilters = () => {
    setCrossFilter(null);
    setGlobalFilters({ ...BUILDER_DEFAULT_GLOBAL_FILTERS });
  };

  // Drill-through (Part 3 §10) - jump from a widget to the matching Reports
  // category, carrying the widget's own resolved date range/stage as a
  // prefill so the exported/report view reflects the SAME filters (§34).
  const handleDrillThrough = (widget: WidgetConfig) => {
    const categoryId = widget.entityType ? ENTITY_TO_REPORT_CATEGORY[widget.entityType] : 'production';
    const resolved = resolveWidgetFilters(widget, globalFilters);
    try {
      sessionStorage.setItem(REPORT_PREFILL_KEY, JSON.stringify({
        categoryId, stageType: resolved.stageType, startDate: resolved.startDate, endDate: resolved.endDate,
      }));
    } catch { /* ignore */ }
    onNavigate('reports');
  };

  const handleExportExcel = () => {
    if (!draft) return;
    exportDashboardToExcel(draft, allRecords, globalFilters, language, `${draft.name.replace(/\s+/g, '_')}.xlsx`, hierarchyScope);
  };

  const handleCreateFromTemplate = (templateId: string) => {
    const template = REPORT_TEMPLATES.find((tpl) => tpl.id === templateId);
    if (!template) return;
    const built = template.build();
    const created = saveDashboard(built);
    refreshDashboardList();
    setActiveId(created.dashboardId);
    setDraft(JSON.parse(JSON.stringify(created)));
    setDirty(false);
    setShowTemplatePicker(false);
  };

  const handleApplyAiSections = (sections: DashboardSection[]) => {
    updateDraft((d) => ({ ...d, sections: [...d.sections, ...sections] }));
    setShowAiDesigner(false);
  };

  const columnsClass: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-1 sm:grid-cols-2', 3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3', 4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' };

  // Dedicated print/report view (Part 7) replaces the builder canvas
  // entirely while open - it is the ONLY thing in the DOM, so there is no
  // ambiguity about what gets printed.
  if (showPrintView && draft) {
    return (
      <PrintReportView
        dashboard={draft}
        allRecords={allRecords}
        globalFilters={globalFilters}
        hierarchyScope={hierarchyScope}
        language={language}
        generatedByName={adminUser?.fullName || adminUser?.username || ''}
        onClose={() => setShowPrintView(false)}
      />
    );
  }

  return (
    <div id="custom-dashboard-page" className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/*
        Page header - the same geometry as the classic Dashboard: the open
        dashboard's name is the page title, its own actions sit beside it, and
        the dashboard-wide actions sit on the other side. This replaces a
        generic title plus a separate narrow identity strip that repeated the
        name a third time inside the filter bar.
      */}
      <div id="custom-dashboard-header" className="bg-white border border-slate-200 shadow-xs p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div className="w-10 h-10 rounded-sm bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
            <LayoutDashboard className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-black text-slate-800 truncate">{draft ? draft.name : t.title}</h1>
              {draft && getDefaultDashboardId() === draft.dashboardId && <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded shrink-0">{t.default}</span>}
              {draft && dirty && <span className="text-[11px] text-amber-600 font-bold shrink-0">{t.unsaved}</span>}
              {draft && (
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={handleRename} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded cursor-pointer" title={t.rename}><Pencil className="w-4 h-4" /></button>
                  <button type="button" onClick={handleDuplicate} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded cursor-pointer" title={t.duplicate}><Copy className="w-4 h-4" /></button>
                  <button type="button" onClick={handleSetDefault} className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-slate-50 rounded cursor-pointer" title={t.setDefault}><Star className="w-4 h-4" /></button>
                  <button type="button" onClick={handleDelete} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-slate-50 rounded cursor-pointer" title={t.delete}><Trash2 className="w-4 h-4" /></button>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">{draft ? t.title : t.subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowDashboardList(true)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded cursor-pointer">
            <FolderOpen className="w-3.5 h-3.5" />{t.myDashboards}
          </button>
          <button type="button" onClick={handleCreateDashboard} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded border border-slate-200 cursor-pointer">
            <Plus className="w-3.5 h-3.5" />{t.newDashboard}
          </button>
          <button type="button" onClick={() => setShowTemplatePicker(true)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded border border-slate-200 cursor-pointer">
            <LayoutTemplate className="w-3.5 h-3.5" />{t.newReport}
          </button>
          {draft && (
            <>
              <button type="button" onClick={() => setShowAiDesigner(true)} className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded cursor-pointer">
                <Sparkles className="w-3.5 h-3.5" />{t.aiDesigner}
              </button>
              <button type="button" onClick={handleExportExcel} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded border border-slate-200 cursor-pointer">
                <FileSpreadsheet className="w-3.5 h-3.5" />{t.exportExcel}
              </button>
              <button type="button" onClick={() => setShowPrintView(true)} className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded border border-slate-200 cursor-pointer">
                <Printer className="w-3.5 h-3.5" />{t.print}
              </button>
              <button type="button" onClick={handleSave} className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded cursor-pointer ${dirty ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 'bg-emerald-50 text-emerald-600 border border-emerald-200'}`}>
                {dirty ? <Save className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}{dirty ? t.save : t.saved}
              </button>
            </>
          )}
        </div>
      </div>

      {draft && (
        <>
          {/* Live Control Bar (Part 4) */}
          <LiveControlBar
            dashboardName={draft.name}
            globalFilters={globalFilters}
            onChangeFilters={(patch) => setGlobalFilters((f) => ({ ...f, ...patch }))}
            onReset={handleResetAllFilters}
            onRefresh={() => loadRecords(true, fetchRange)}
            lastUpdated={lastUpdated}
            isRefreshing={isRefreshing}
            crossFilter={crossFilter}
            onClearCrossFilter={handleClearCrossFilter}
            shifts={shifts}
            presses={presses}
            hierarchyIndex={hierarchyIndex}
            products={products}
            customers={customers}
            employees={employees}
            language={language}
          />

          {/*
            THE dashboard. Everything below the filter bar is this one tree and
            it is never swapped out: a refetch after a date change used to
            replace the whole widget grid with a loading box and rebuild it, and
            unticking quantities used to drop it entirely. Now loading, "no data"
            and "quantities not shown" are states INSIDE each widget, and the
            financial value is a section of the same dashboard, not a separate
            area above it.
          */}
          <div id="custom-dashboard-sections" className="space-y-6" aria-busy={isLoading}>
              {isLoading && (
                <div id="custom-dashboard-loading" className="flex items-center gap-2 bg-white border border-slate-200 shadow-xs px-4 py-2 text-xs font-bold text-indigo-600">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {t.loading}
                </div>
              )}

              {showFinancial && (
                <div className="space-y-3" data-section-id="financial-values">
                  <div className="bg-white border border-slate-200 shadow-xs px-4 py-2.5">
                    <h2 className="font-bold text-slate-700 text-sm">{language === 'ar' ? 'القيم المالية' : 'Financial values'}</h2>
                  </div>
                  <FinancialValueCard id="custom-dashboard-financial-value" value={financialValue} language={language} />
                </div>
              )}

              {draft.sections.map((section, sIdx) => (
                <div
                  key={section.sectionId}
                  className="space-y-3"
                  data-section-id={section.sectionId}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.stopPropagation(); handleSectionDrop(section.sectionId); }}
                >
                  <div className="bg-white border border-slate-200 shadow-xs px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div
                      className="flex items-center gap-2 min-w-0 cursor-grab"
                      draggable
                      onDragStart={() => handleSectionDragStart(section.sectionId)}
                    >
                      <GripVertical className="w-4 h-4 text-slate-300 shrink-0" />
                      {renamingSectionId === section.sectionId ? (
                        <input
                          autoFocus
                          defaultValue={section.title}
                          onBlur={(e) => handleRenameSection(section.sectionId, e.target.value.trim() || section.title)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                          className="text-sm font-bold text-slate-800 border-b border-indigo-400 outline-none px-1"
                        />
                      ) : (
                        <h2 className="font-bold text-slate-700 text-sm truncate cursor-pointer" onClick={() => setRenamingSectionId(section.sectionId)}>{section.title}</h2>
                      )}
                      <button type="button" onClick={() => setRenamingSectionId(section.sectionId)} className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer"><Pencil className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select value={section.columns} onChange={(e) => handleSetSectionColumns(section.sectionId, Number(e.target.value) as 1 | 2 | 3 | 4)} className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-xs font-bold text-slate-600">
                        {[1, 2, 3, 4].map((c) => <option key={c} value={c}>{t.columns}: {c}</option>)}
                      </select>
                      <button type="button" onClick={() => handleMoveSection(section.sectionId, -1)} disabled={sIdx === 0} className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-30 cursor-pointer"><ChevronUp className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => handleMoveSection(section.sectionId, 1)} disabled={sIdx === draft.sections.length - 1} className="p-1 text-slate-400 hover:text-indigo-600 disabled:opacity-30 cursor-pointer"><ChevronDown className="w-3.5 h-3.5" /></button>
                      <button type="button" onClick={() => setWidgetFormState({ sectionId: section.sectionId })} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded cursor-pointer"><Plus className="w-3.5 h-3.5" />{t.addWidget}</button>
                      <button type="button" onClick={() => handleDeleteSection(section.sectionId)} className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>

                  {section.widgets.length === 0 ? (
                    <div
                      className="border-2 border-dashed border-slate-200 bg-white/60 p-10 text-center text-xs text-slate-400"
                      onDragOver={(e) => handleDragOverWidget(e, section.sectionId, 0)}
                      onDrop={() => handleDrop(section.sectionId, 0)}
                    >
                      {t.emptySection}
                    </div>
                  ) : (
                    <div className={`grid ${columnsClass[section.columns]} gap-4`}>
                      {section.widgets.map((widget, wIdx) => (
                        <div
                          key={widget.widgetId}
                          draggable
                          onDragStart={() => handleDragStart(section.sectionId, widget.widgetId)}
                          onDragOver={(e) => handleDragOverWidget(e, section.sectionId, wIdx)}
                          onDrop={() => handleDrop(section.sectionId, wIdx)}
                          onClick={() => setSelectedWidgetId((prev) => (prev === widget.widgetId ? null : widget.widgetId))}
                          title={language === 'ar' ? 'انقر لتحديد هذا الرسم (لسياق المساعد الذكي)' : 'Click to select this chart (for the AI assistant context)'}
                          style={{ gridColumn: `span ${widgetSpanForSize(widget.size, section.columns)}` }}
                          className={`flex flex-col min-w-0 cursor-pointer ${
                            dragOverTarget?.sectionId === section.sectionId && dragOverTarget.index === wIdx
                              ? 'ring-2 ring-indigo-400 rounded'
                              : selectedWidgetId === widget.widgetId
                                ? 'ring-2 ring-emerald-400 rounded'
                                : ''
                          }`}
                        >
                          {/* Move (4-direction) + size controls - explicit precision alongside drag-and-drop (Part 1 §3/§4) */}
                          <div className="flex items-center justify-between gap-1 mb-1.5 px-1 py-0.5 bg-slate-100 border border-slate-200">
                            <div className="flex items-center gap-0.5 text-slate-400 cursor-grab" title={language === 'ar' ? 'اسحب لإعادة الترتيب' : 'Drag to reorder'}>
                              <GripVertical className="w-4 h-4" />
                            </div>
                            <div className="flex items-center gap-0.5">
                              <button type="button" onClick={() => handleMoveWidgetGrid(section.sectionId, widget.widgetId, 'left')} className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-white rounded cursor-pointer" title={language === 'ar' ? 'نقل لليسار' : 'Move left'}><ChevronLeft className="w-3.5 h-3.5" /></button>
                              <button type="button" onClick={() => handleMoveWidgetGrid(section.sectionId, widget.widgetId, 'up')} className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-white rounded cursor-pointer" title={language === 'ar' ? 'نقل لأعلى' : 'Move up'}><ChevronUp className="w-3.5 h-3.5" /></button>
                              <button type="button" onClick={() => handleMoveWidgetGrid(section.sectionId, widget.widgetId, 'down')} className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-white rounded cursor-pointer" title={language === 'ar' ? 'نقل لأسفل' : 'Move down'}><ChevronDown className="w-3.5 h-3.5" /></button>
                              <button type="button" onClick={() => handleMoveWidgetGrid(section.sectionId, widget.widgetId, 'right')} className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-white rounded cursor-pointer" title={language === 'ar' ? 'نقل لليمين' : 'Move right'}><ChevronRight className="w-3.5 h-3.5" /></button>
                              {draft.sections.length > 1 && (
                                <button type="button" onClick={() => setMoveToSectionState({ sectionId: section.sectionId, widgetId: widget.widgetId })} className="p-1 text-slate-500 hover:text-indigo-600 hover:bg-white rounded cursor-pointer" title={t.moveToSection}><MoveRight className="w-3.5 h-3.5" /></button>
                              )}
                              <select
                                value={widget.size || 'MEDIUM'}
                                onChange={(e) => handleSetWidgetSize(section.sectionId, widget.widgetId, e.target.value as WidgetSize)}
                                className="ms-1 bg-white border border-slate-200 rounded px-1.5 py-0.5 text-[11px] font-bold text-slate-600 cursor-pointer"
                                title={t.size}
                              >
                                <option value="SMALL">{t.small}</option>
                                <option value="MEDIUM">{t.medium}</option>
                                <option value="LARGE">{t.large}</option>
                              </select>
                            </div>
                          </div>
                          <WidgetRenderer
                            config={widget}
                            allRecords={allRecords}
                            globalFilters={globalFilters}
                            hierarchyScope={hierarchyScope}
                            language={language}
                            editable
                            crossFilter={crossFilter}
                            onCrossFilterRequest={handleCrossFilterRequest}
                            onClearCrossFilter={handleClearCrossFilter}
                            onDrillThrough={handleDrillThrough}
                            onDrillDown={(records, title) => setDrillDown({ title, records })}
                            onEdit={() => setWidgetFormState({ sectionId: section.sectionId, widget })}
                            onDuplicate={() => handleDuplicateWidget(section.sectionId, widget)}
                            onRemove={() => handleRemoveWidget(section.sectionId, widget.widgetId)}
                            isLoading={isLoading}
                            quantityHidden={!showQuantity}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <button type="button" onClick={handleAddSection} className="w-full py-3 border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 rounded text-xs font-bold text-slate-400 hover:text-indigo-600 cursor-pointer flex items-center justify-center gap-1.5">
                <Plus className="w-4 h-4" />{t.addSection}
              </button>
          </div>
        </>
      )}

      {!draft && (
        <div className="p-16 text-center text-sm text-slate-400 bg-white border border-slate-200">{t.noDashboards}</div>
      )}

      {/* Saved Dashboards Manager (Part 3) */}
      <Modal isOpen={showDashboardList} onClose={() => setShowDashboardList(false)} title={t.myDashboards} maxWidth="2xl">
        <SavedDashboardsManager
          dashboards={dashboards}
          activeId={activeId}
          defaultDashboardId={getDefaultDashboardId()}
          language={language}
          canDelete={canManage}
          onOpen={(id) => handleSelectDashboard(id)}
          onRename={(id, name) => { renameDashboard(id, name); refreshDashboardList(); if (id === draft?.dashboardId) updateDraft((d) => ({ ...d, name })); }}
          onDuplicate={(id) => {
            const source = dashboards.find((d) => d.dashboardId === id);
            if (!source) return;
            const copy = duplicateDashboard(id, `${source.name} (${language === 'ar' ? 'نسخة' : 'copy'})`);
            refreshDashboardList();
            if (copy) handleSelectDashboard(copy.dashboardId);
          }}
          onSetDefault={(id) => { setDefaultDashboard(id); refreshDashboardList(); }}
          onToggleFavorite={(id, next) => { setFavoriteDashboard(id, next); refreshDashboardList(); }}
          onDelete={(id) => {
            deleteDashboard(id);
            const list = refreshDashboardList();
            if (id === draft?.dashboardId) { if (list[0]) handleSelectDashboard(list[0].dashboardId); else { setDraft(null); setActiveId(null); } }
          }}
          onBulkDelete={(ids) => {
            deleteDashboards(ids);
            const list = refreshDashboardList();
            if (draft && ids.includes(draft.dashboardId)) { if (list[0]) handleSelectDashboard(list[0].dashboardId); else { setDraft(null); setActiveId(null); } }
          }}
        />
      </Modal>

      {/* Delete-section choice: move widgets elsewhere, or delete them too (Part 2 §8) - never silent */}
      {deleteSectionState && draft && (() => {
        const section = draft.sections.find((s) => s.sectionId === deleteSectionState.sectionId);
        const otherSections = draft.sections.filter((s) => s.sectionId !== deleteSectionState.sectionId);
        if (!section) return null;
        return (
          <Modal isOpen onClose={() => setDeleteSectionState(null)} title={section.title} subtitle={t.sectionHasWidgets(section.widgets.length)} maxWidth="sm">
            <div className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
              {otherSections.length > 0 ? (
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">{t.moveWidgetsToAnother}</label>
                  <div className="space-y-1.5">
                    {otherSections.map((s) => (
                      <button key={s.sectionId} type="button" onClick={() => handleMoveWidgetsThenDeleteSection(deleteSectionState.sectionId, s.sectionId)} className="w-full text-start px-3 py-2 border border-slate-200 rounded text-xs font-bold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer">
                        {s.title}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">{t.noOtherSections}</p>
              )}
              <button type="button" onClick={() => handleDeleteSectionAndWidgets(deleteSectionState.sectionId)} className="w-full px-3 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded text-xs font-bold cursor-pointer">
                {t.deleteWidgetsToo}
              </button>
              <button type="button" onClick={() => setDeleteSectionState(null)} className="w-full px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 rounded cursor-pointer">
                {t.cancel}
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* Move to Section (Part 1 §3) */}
      {moveToSectionState && draft && (
        <Modal isOpen onClose={() => setMoveToSectionState(null)} title={t.moveToSection} subtitle={t.chooseTargetSection} maxWidth="sm">
          <div className="space-y-1.5" dir={isRtl ? 'rtl' : 'ltr'}>
            {draft.sections.filter((s) => s.sectionId !== moveToSectionState.sectionId).map((s) => (
              <button key={s.sectionId} type="button" onClick={() => handleMoveWidgetToSection(moveToSectionState.sectionId, moveToSectionState.widgetId, s.sectionId)} className="w-full text-start px-3 py-2 border border-slate-200 rounded text-xs font-bold text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/40 cursor-pointer">
                {s.title}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Report template picker (Part 6 §25) */}
      <Modal isOpen={showTemplatePicker} onClose={() => setShowTemplatePicker(false)} title={t.chooseTemplate} maxWidth="2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {REPORT_TEMPLATES.map((tpl) => (
            <div key={tpl.id} className="border border-slate-200 rounded p-3 hover:border-indigo-300 transition-colors">
              <h4 className="text-sm font-bold text-slate-800">{language === 'ar' ? tpl.nameAr : tpl.nameEn}</h4>
              <p className="text-[11px] text-slate-500 mt-1">{language === 'ar' ? tpl.descriptionAr : tpl.descriptionEn}</p>
              <button type="button" onClick={() => handleCreateFromTemplate(tpl.id)} className="mt-2 w-full text-center px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded cursor-pointer">
                {t.useTemplate}
              </button>
            </div>
          ))}
        </div>
      </Modal>

      {/* Widget config form modal */}
      {widgetFormState && (
        <WidgetConfigForm
          language={language}
          initial={widgetFormState.widget}
          onCancel={() => setWidgetFormState(null)}
          onSave={(w) => handleSaveWidget(widgetFormState.sectionId, w)}
        />
      )}

      {/* AI Report Designer preview */}
      {showAiDesigner && draft && (
        <AIReportDesignerPanel
          language={language}
          currentSections={draft.sections}
          shifts={shifts}
          onCancel={() => setShowAiDesigner(false)}
          onApply={handleApplyAiSections}
          onMoveWidget={(action) => { handleMoveWidgetToSection(action.sourceSectionId, action.widgetId, action.targetSectionId); setShowAiDesigner(false); }}
          onSetFilters={(action) => { setGlobalFilters((f) => ({ ...f, ...action.patch })); setShowAiDesigner(false); }}
        />
      )}

      {/* Drill-down modal */}
      <Modal isOpen={!!drillDown} onClose={() => setDrillDown(null)} title={t.drillDownTitle} subtitle={drillDown?.title} maxWidth="4xl">
        {drillDown && (
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[9px] sticky top-0">
                <tr>
                  <th className="p-2 text-start">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                  <th className="p-2 text-start">{language === 'ar' ? 'المرحلة' : 'Stage'}</th>
                  <th className="p-2 text-start">{language === 'ar' ? 'المنتج' : 'Product'}</th>
                  <th className="p-2 text-end">{language === 'ar' ? 'الإنتاج (طن)' : 'Production (t)'}</th>
                  <th className="p-2 text-end">{language === 'ar' ? 'الهالك (طن)' : 'Waste (t)'}</th>
                  <th className="p-2 text-end">{language === 'ar' ? 'التوقف (د)' : 'Downtime (min)'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drillDown.records.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="p-2 font-mono">{r.date}</td>
                    <td className="p-2">{getStageDisplayName(r.stageType, language)}</td>
                    <td className="p-2">{r.productName || '-'}</td>
                    <td className="p-2 text-end font-mono">{(r.productionTons || 0).toFixed(2)}</td>
                    <td className="p-2 text-end font-mono text-rose-600">{(r.wasteTons || 0).toFixed(2)}</td>
                    <td className="p-2 text-end font-mono text-amber-600">{r.totalDowntimeMinutes || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
};

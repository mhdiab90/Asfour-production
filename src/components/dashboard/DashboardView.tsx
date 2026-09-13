/**
 * Executive Industrial Dashboard
 * Geometric Balance Design Theme
 * Provides real-time production analytics, KPIs, equipment breakdown charts,
 * downtime distribution, and quick operational shortcuts.
 *
 * Dashboard Capability Upgrade - the classic Dashboard's data source moved
 * from the Pressing-only `subscribeProductionRecords()` live subscription to
 * the SAME cross-stage `fetchUniversalStageRecords()` + `filterUniversalRecords()`
 * + `aggregateByDimension()` pipeline ReportsView.tsx already uses (see
 * reportingEngine.ts) - this is the ONLY way to genuinely support real
 * stage/shift/press/employee/customer/product filtering, since no live
 * multi-stage subscription exists anywhere in this codebase and
 * subscribeProductionRecords() only ever covers the `production` (Pressing)
 * collection. This is a deliberate, disclosed tradeoff: the classic
 * Dashboard is no longer push-live: it loads once (like Reports already
 * does) and exposes a REAL Refresh action instead. All KPI/ton math is
 * delegated entirely to reportingEngine.ts's aggregateByDimension() - this
 * file performs no independent business calculation, only sums the
 * already-computed AggregatedReportRow totals it returns.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Factory,
  Flame,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Plus,
  UploadCloud,
  Database,
  LayoutGrid,
  LayoutDashboard,
  RotateCcw,
  RefreshCw,
  ArrowUpDown,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { ProductionStageType, NavigationPage, UniversalStageRecord, Press, Furnace, MultiDimensionFilter } from '../../types';
import { fetchUniversalStageRecords } from '../../services/stageRecordService';
import { fetchMasterData } from '../../services/masterDataService';
/*
 * Which equipment a stage actually records - declared once on the shared
 * registry, read off the entry forms rather than assumed. This is what stops
 * the equipment selector offering presses while a furnace stage is selected.
 */
/*
 * The organisational dimension is the canonical cost-centre HIERARCHY, not the
 * legacy press list. Scope resolution is the shared one Production Records and
 * Reports use, so a Dashboard total means the same thing on every screen.
 */
import { CostCenterScopeSelector } from './CostCenterScopeSelector';
import {
  listCostCenterHierarchyNodes,
  buildCostCenterHierarchyIndex,
  CostCenterHierarchyRecord,
} from '../../services/costCenterHierarchyService';
import {
  metricModeFromFlags,
  metricFlags,
  resolveCostCenterProductionScope,
  resolveCostCenterCodeScope,
} from '../../services/costCenterDashboardPure';
import { aggregateFinancialValue, FinancialTransaction } from '../../services/financialTransactionsPure';
import { listFinancialTransactions } from '../../services/financialTransactionService';
import {
  ALL_STAGES,
  getStageDisplayName,
  aggregateByDimension,
  filterUniversalRecords,
  rankRows,
  RankingMetric,
} from '../../services/reportingEngine';
import { todayLocalIso, resolveNamedMonthRange } from '../../assistant/tools/dateRangeResolver';
import {
  DASHBOARD_DEFAULT_DATE_PRESET as DASHBOARD_DEFAULT_DATE_PRESET_VALUE,
  isValidCustomRange as isValidCustomRangeFn,
  resolveDashboardDateSelection as resolveDashboardDateSelectionPure,
  type DashboardDatePreset as DashboardDatePresetType,
  type DashboardDateSelection as DashboardDateSelectionType,
  type ResolvedDashboardRange,
} from '../../services/dashboardPeriodPure';
import { StatCard } from '../common/StatCard';
import { Badge } from '../common/Badge';
import { formatNumber, formatDecimal } from '../../utils/formatters';
import { useLanguage } from '../../i18n/LanguageContext';
import { DashboardBuilderView, CUSTOM_DASHBOARD_PREFILL_KEY, CUSTOM_DASHBOARD_PREFILL_EVENT } from './DashboardBuilderView';
import { useSetAssistantSelection } from '../../context/AssistantSelectionContext';

interface DashboardViewProps {
  onNavigate: (page: NavigationPage) => void;
}

/**
 * PHASE 5B - the Dashboard's date-preset vocabulary and preset->bounds math
 * now live in the Firebase-free, deterministically testable
 * services/dashboardPeriodPure.ts, and are RE-EXPORTED here unchanged so
 * every existing importer of these symbols (notably
 * assistant/tools/navigationTools.ts's setDashboardDateFilter contract,
 * which is out of scope for this phase and is not modified) keeps compiling
 * and behaving exactly as before.
 *
 * Phase 5B additions, all disclosed rather than silent: two new presets
 * ('last90days', 'prevMonth'), a DEFAULT that moves from calendar
 * month-to-date to 'last30days', and rejection (instead of silent
 * substitution) of an inverted custom range. See dashboardPeriodPure.ts's
 * own header for the reasoning behind each.
 */
export type { DashboardDatePreset, DashboardDateSelection } from '../../services/dashboardPeriodPure';
export { DASHBOARD_DATE_PRESETS, DASHBOARD_DEFAULT_DATE_PRESET, isValidCustomRange } from '../../services/dashboardPeriodPure';

export interface DashboardEntityFilters {
  pressId?: string;
  furnaceId?: string;
  employeeId?: string;
  customerId?: string;
  productId?: string;
}

export const DASHBOARD_DEFAULT_ENTITY_FILTERS: DashboardEntityFilters = {};
export const DASHBOARD_DEFAULT_SORT_FIELD: RankingMetric = 'productionTons';
export const DASHBOARD_DEFAULT_SORT_DIRECTION: 'best' | 'worst' = 'best';

/**
 * Thin production wrapper that injects the REAL "today" and the codebase's
 * existing canonical named-month resolver into the pure resolver. Keeps this
 * module's long-standing one-argument signature intact for existing callers
 * while the underlying math becomes unit-testable with deterministic dates.
 */
export function resolveDashboardDateSelection(sel: DashboardDateSelectionType): ResolvedDashboardRange {
  return resolveDashboardDateSelectionPure(sel, {
    today: todayLocalIso(),
    resolveNamedMonth: (year, month) => {
      const r = resolveNamedMonthRange(year, month);
      return { startDate: r.startDate, endDate: r.endDate };
    },
  });
}

/**
 * Dashboard Capability Upgrade - single live-control channel for every real
 * Dashboard filter (date/stage/shift/entity/sort). One event, one listener,
 * partial patches merged into state - keeps "one source of truth for
 * Dashboard filter state" instead of five parallel event types.
 */
export const DASHBOARD_FILTER_UPDATE_EVENT = 'asfour:dashboard-filter-update';
export interface DashboardFilterPatch {
  date?: DashboardDateSelectionType;
  stageType?: ProductionStageType | 'all';
  /** Empty string or null clears the shift filter. */
  shiftId?: string | null;
  entity?: Partial<DashboardEntityFilters>;
  sortField?: RankingMetric;
  sortDirection?: 'best' | 'worst';
}

/** Restores every real Dashboard filter to its documented default - the SAME reset resetCurrentViewFilters dispatches. */
export const DASHBOARD_FILTER_RESET_EVENT = 'asfour:dashboard-filter-reset';

/** Re-runs the SAME fetchUniversalStageRecords() call this screen already runs on mount - a genuine data reload (the classic Dashboard is a one-time fetch, not a live subscription - see this file's top comment), never a fake spinner. */
export const DASHBOARD_REFRESH_EVENT = 'asfour:dashboard-refresh';

const SORT_FIELD_LABELS: Record<RankingMetric, { ar: string; en: string }> = {
  productionTons: { ar: 'الإنتاج (طن)', en: 'Production (t)' },
  goodTons: { ar: 'الإنتاج السليم (طن)', en: 'Good Production (t)' },
  wasteTons: { ar: 'الهالك (طن)', en: 'Waste (t)' },
  wastePercentage: { ar: 'نسبة الهالك', en: 'Waste %' },
  downtimeMinutes: { ar: 'دقائق التوقف', en: 'Downtime (min)' },
  operationsCount: { ar: 'عدد التشغيلات', en: 'Operations Count' },
};
const SORT_FIELDS: RankingMetric[] = ['productionTons', 'goodTons', 'wasteTons', 'wastePercentage', 'downtimeMinutes', 'operationsCount'];

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { language, isRtl } = useLanguage();
  // Phase 4B - "افتح اللوحة رقم 1" (opening a specific CUSTOM dashboard) must
  // land directly on the Custom Dashboards tab, not the Classic one - same
  // sessionStorage prefill peek every other cold-navigation handoff uses.
  // Only PEEKS (never removes the key) - DashboardBuilderView.tsx itself
  // consumes/clears it on its own mount to select the specific dashboard.
  const [viewMode, setViewMode] = useState<'classic' | 'custom'>(() => {
    try {
      const raw = sessionStorage.getItem(CUSTOM_DASHBOARD_PREFILL_KEY);
      if (raw && JSON.parse(raw)?.dashboardId) return 'custom';
    } catch { /* ignore - defaults to classic */ }
    return 'classic';
  });

  useEffect(() => {
    function handleCustomDashboardPrefill() { setViewMode('custom'); }
    window.addEventListener(CUSTOM_DASHBOARD_PREFILL_EVENT, handleCustomDashboardPrefill);
    return () => window.removeEventListener(CUSTOM_DASHBOARD_PREFILL_EVENT, handleCustomDashboardPrefill);
  }, []);

  const [allRecords, setAllRecords] = useState<UniversalStageRecord[]>([]);
  const [presses, setPresses] = useState<Press[]>([]);
  const [furnaces, setFurnaces] = useState<Furnace[]>([]);
  const [shifts, setShifts] = useState<Array<{ id?: string; code?: string; name?: string }>>([]);
  const [employees, setEmployees] = useState<Array<{ id?: string; code?: string; name?: string }>>([]);
  const [customers, setCustomers] = useState<Array<{ id?: string; code?: string; name?: string }>>([]);
  const [products, setProducts] = useState<Array<{ id?: string; code?: string; name?: string }>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  const [dateSelection, setDateSelection] = useState<DashboardDateSelectionType>({ preset: DASHBOARD_DEFAULT_DATE_PRESET_VALUE });
  const [stageType, setStageType] = useState<ProductionStageType | 'all'>('all');
  const [shiftId, setShiftId] = useState<string>('');
  const [entityFilters, setEntityFilters] = useState<DashboardEntityFilters>(DASHBOARD_DEFAULT_ENTITY_FILTERS);
  const [sortField, setSortField] = useState<RankingMetric>(DASHBOARD_DEFAULT_SORT_FIELD);
  const [sortDirection, setSortDirection] = useState<'best' | 'worst'>(DASHBOARD_DEFAULT_SORT_DIRECTION);

  /*
   * Organisational scope: the cost-centre hierarchy.
   *
   * The equipment dropdown that used to live here listed legacy presses and
   * furnaces - a flat list that no longer matches how the organisation is
   * structured. The hierarchy replaces it as the organisational filter. The
   * legacy equipment data is untouched; it is how a selected node reaches the
   * production records beneath it.
   */
  const [hierarchyNodes, setHierarchyNodes] = useState<CostCenterHierarchyRecord[]>([]);
  const [costCenterNodeIds, setCostCenterNodeIds] = useState<string[]>([]);

  /** Metric type. Two checkboxes; unticking both falls back to quantity. */
  const [metricMode, setMetricMode] = useState<'QUANTITY' | 'FINANCIAL' | 'BOTH'>('QUANTITY');
  const { quantity: showQuantity, financial: showFinancial } = metricFlags(metricMode);

  const [financialTransactions, setFinancialTransactions] = useState<FinancialTransaction[]>([]);
  const [financialError, setFinancialError] = useState<string | null>(null);

  useEffect(() => {
    listCostCenterHierarchyNodes()
      .then(setHierarchyNodes)
      .catch(() => { /* an unavailable hierarchy only costs the cost-centre selector */ });
  }, []);

  /*
   * Financial transactions are read only when money is actually being shown -
   * a quantity-only Dashboard issues no financial read at all.
   */
  useEffect(() => {
    if (!showFinancial) return;
    setFinancialError(null);
    listFinancialTransactions()
      .then(setFinancialTransactions)
      .catch((err) => setFinancialError(String(err?.message ?? err)));
  }, [showFinancial]);

  /* The canonical hierarchy index - the same builder Master Data uses. */
  const hierarchyIndex = useMemo(() => buildCostCenterHierarchyIndex(hierarchyNodes), [hierarchyNodes]);

  /** Presses and furnaces carry the hierarchyNodeId that links a record to a node. */
  const equipmentLinks = useMemo(
    () => [...presses, ...furnaces].map((e) => ({ id: e.id, hierarchyNodeId: (e as any).hierarchyNodeId })),
    [presses, furnaces],
  );

  /** For QUANTITY: the equipment beneath the selected nodes. null = no narrowing. */
  const productionScope = useMemo(
    () => resolveCostCenterProductionScope(costCenterNodeIds, hierarchyIndex, equipmentLinks),
    [costCenterNodeIds, hierarchyIndex, equipmentLinks],
  );

  /** For FINANCIAL: the cost-centre codes beneath the selected nodes. */
  const costCenterCodeScope = useMemo(
    () => resolveCostCenterCodeScope(costCenterNodeIds, hierarchyIndex),
    [costCenterNodeIds, hierarchyIndex],
  );

  const setAssistantSelection = useSetAssistantSelection();

  const resetFilters = () => {
    setDateSelection({ preset: DASHBOARD_DEFAULT_DATE_PRESET_VALUE });
    setStageType('all');
    setShiftId('');
    setEntityFilters(DASHBOARD_DEFAULT_ENTITY_FILTERS);
    setSortField(DASHBOARD_DEFAULT_SORT_FIELD);
    setSortDirection(DASHBOARD_DEFAULT_SORT_DIRECTION);
  };

  // Live external control of every real Dashboard filter - same event-driven
  // pattern already used by ReportsView's prefill (this is the AI/tool ->
  // screen direction; the screen -> AI direction is AssistantSelectionContext below).
  useEffect(() => {
    function handlePatch(e: Event) {
      const patch = (e as CustomEvent<DashboardFilterPatch>).detail;
      if (!patch) return;
      if (patch.date) setDateSelection(patch.date);
      if (patch.stageType !== undefined) setStageType(patch.stageType);
      if (patch.shiftId !== undefined) setShiftId(patch.shiftId || '');
      if (patch.entity) setEntityFilters((prev) => ({ ...prev, ...patch.entity }));
      if (patch.sortField) setSortField(patch.sortField);
      if (patch.sortDirection) setSortDirection(patch.sortDirection);
    }
    function handleReset() { resetFilters(); }
    function handleRefresh() { setRefreshTrigger((t) => t + 1); }
    window.addEventListener(DASHBOARD_FILTER_UPDATE_EVENT, handlePatch as EventListener);
    window.addEventListener(DASHBOARD_FILTER_RESET_EVENT, handleReset);
    window.addEventListener(DASHBOARD_REFRESH_EVENT, handleRefresh);
    return () => {
      window.removeEventListener(DASHBOARD_FILTER_UPDATE_EVENT, handlePatch as EventListener);
      window.removeEventListener(DASHBOARD_FILTER_RESET_EVENT, handleReset);
      window.removeEventListener(DASHBOARD_REFRESH_EVENT, handleRefresh);
    };
  }, []);

  const resolvedDate = useMemo(() => resolveDashboardDateSelection(dateSelection), [dateSelection]);

  /**
   * PHASE 5B - bilingual, always-on-screen description of the period the
   * numbers below actually cover. Uses the SAME inline
   * `language === 'ar' ? ... : ...` convention every other label in this
   * file already uses (the app's existing i18n approach for these views) -
   * no new translation mechanism is introduced.
   */
  const activePeriodLabel = useMemo(() => {
    const presetName: Record<DashboardDatePresetType, { ar: string; en: string }> = {
      today: { ar: 'اليوم', en: 'Today' },
      week: { ar: 'آخر 7 أيام', en: 'Last 7 Days' },
      month: { ar: 'هذا الشهر', en: 'This Month' },
      prevMonth: { ar: 'الشهر السابق', en: 'Previous Month' },
      last30days: { ar: 'آخر 30 يوم', en: 'Last 30 Days' },
      last90days: { ar: 'آخر 90 يوم', en: 'Last 90 Days' },
      all: { ar: 'كل الفترات', en: 'All Time' },
      custom: { ar: 'فترة مخصصة', en: 'Custom Range' },
      namedMonth: { ar: 'شهر محدد', en: 'Named Month' },
    };
    const name = presetName[dateSelection.preset];
    const title = language === 'ar' ? name.ar : name.en;
    if (dateSelection.preset === 'all') return title;
    return `${title} (${resolvedDate.startDate} → ${resolvedDate.endDate})`;
  }, [dateSelection.preset, resolvedDate.startDate, resolvedDate.endDate, language]);

  /** PHASE 5B - true only while the user is mid-edit or has inverted the custom range. */
  const customRangeInvalid =
    dateSelection.preset === 'custom' && !isValidCustomRangeFn(dateSelection.startDate, dateSelection.endDate);

  // Publish live filter state so the AI Assistant's ScreenContext reflects
  // what's actually on screen, same pattern as ReportsView/StageProductionEntryView.
  useEffect(() => {
    setAssistantSelection({
      currentStage: stageType !== 'all' ? stageType : undefined,
      selectedEntityType: 'dashboard',
      selectedDateRange: { startDate: resolvedDate.startDate, endDate: resolvedDate.endDate },
      selectedFilters: {
        datePreset: dateSelection.preset,
        stageType,
        shiftId: shiftId || undefined,
        ...entityFilters,
        sortField,
        sortDirection,
      },
    });
    return () => setAssistantSelection({});
  }, [resolvedDate, dateSelection.preset, stageType, shiftId, entityFilters, sortField, sortDirection, setAssistantSelection]);

  // Cross-stage fetch (re-run on refreshTrigger AND on a period change) -
  // the SAME fetchUniversalStageRecords() ReportsView.tsx already uses. See
  // this file's top comment for why this replaced the old Pressing-only live
  // subscription: real stage/shift/entity filtering requires all 8 stages,
  // and no live multi-stage subscription exists anywhere in this codebase.
  //
  // PHASE 5B - the fetch is now bounded by the SAME visible period the
  // filter bar above already exposes. Previously this called
  // fetchUniversalStageRecords() with NO arguments, so
  // resolveStageQueryBounds() saw no bounds and stageRecordService.ts read
  // all 8 stage collections in full on every mount and every refresh - and,
  // because isStageQueryCacheEligible() requires BOTH dates, the Phase 4B
  // bounded cache could never engage either. Passing the resolved
  // startDate/endDate pushes the range down to Firestore's own query
  // (Phase 4A's where('date','>=' / '<=')) and simultaneously makes the
  // result cache-eligible. NOTHING inside stageRecordService.ts changes -
  // this screen simply stops discarding the bounds it already computed.
  //
  // Only the DATE bounds are sent to Firestore. Every other Dashboard filter
  // (stage/shift/press/employee/customer/product) keeps working exactly as
  // before through filterUniversalRecords() below - their semantics are
  // untouched by this phase.
  useEffect(() => {
    // An incomplete or inverted CUSTOM range must not query at all. It must
    // never silently widen into the full-history read this phase removes.
    if (resolvedDate.invalid) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    fetchUniversalStageRecords({ startDate: resolvedDate.startDate, endDate: resolvedDate.endDate })
      .then((data) => { if (!cancelled) setAllRecords(data); })
      .catch((err) => console.error('Error fetching cross-stage records for dashboard:', err))
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTrigger, resolvedDate.startDate, resolvedDate.endDate, resolvedDate.invalid]);

  // Master data for filter dropdowns + the existing Furnace/Press summary card - fetched once, not tied to refreshTrigger (rarely changes).
  useEffect(() => {
    fetchMasterData<Press>('presses').then(setPresses).catch(() => {});
    fetchMasterData<Furnace>('furnaces').then(setFurnaces).catch(() => {});
    fetchMasterData<any>('shifts').then(setShifts).catch(() => {});
    fetchMasterData<any>('employees').then(setEmployees).catch(() => {});
    fetchMasterData<any>('customers').then(setCustomers).catch(() => {});
    fetchMasterData<any>('products').then(setProducts).catch(() => {});
  }, []);

  const filters: MultiDimensionFilter = useMemo(() => ({
    startDate: resolvedDate.startDate,
    endDate: resolvedDate.endDate,
    stageType: stageType === 'all' ? undefined : stageType,
    shiftId: shiftId || undefined,
    pressId: entityFilters.pressId,
    furnaceId: entityFilters.furnaceId,
    employeeId: entityFilters.employeeId,
    customerId: entityFilters.customerId,
    productId: entityFilters.productId,
  }), [resolvedDate, stageType, shiftId, entityFilters]);

  const filteredRecords = useMemo(
    () => filterUniversalRecords(allRecords, filters, productionScope),
    [allRecords, filters, productionScope],
  );

  /*
   * Financial value, from actual transactions only - never derived from
   * quantities. It shares the date range and the cost-centre scope with the
   * production figures, and nothing else: product, customer, shift and stage
   * are production dimensions a transaction does not carry.
   */
  const financialTotal = useMemo(
    () => aggregateFinancialValue(financialTransactions, {
      costCenterCodes: costCenterCodeScope,
      startDate: resolvedDate.startDate,
      endDate: resolvedDate.endDate,
    }),
    [financialTransactions, costCenterCodeScope, resolvedDate],
  );

  // All KPI ton math is delegated to reportingEngine.ts - this only sums the
  // already-computed per-stage rows it returns (§ "Do NOT put business
  // calculations in DashboardView").
  const stageRows = useMemo(() => aggregateByDimension(filteredRecords, 'stage', language), [filteredRecords, language]);
  const totals = useMemo(() => stageRows.reduce((acc, row) => ({
    productionTons: acc.productionTons + row.productionTons,
    goodTons: acc.goodTons + row.goodTons,
    wasteTons: acc.wasteTons + row.wasteTons,
    downtimeMinutes: acc.downtimeMinutes + row.downtimeMinutes,
    operationsCount: acc.operationsCount + row.operationsCount,
  }), { productionTons: 0, goodTons: 0, wasteTons: 0, downtimeMinutes: 0, operationsCount: 0 }), [stageRows]);

  const missingPieceWeightRecordsCount = useMemo(
    () => filteredRecords.filter((r) => r.productionTons === null || r.productionTons === undefined).length,
    [filteredRecords]
  );

  const qualityRate = totals.productionTons > 0 ? ((totals.goodTons / totals.productionTons) * 100).toFixed(1) : '100';
  const wasteRate = totals.productionTons > 0 ? ((totals.wasteTons / totals.productionTons) * 100).toFixed(2) : '0';

  // Equipment (press/furnace/machine) breakdown - real sort applied here via
  // the shared rankRows() (reportingEngine.ts), the same ranking logic every
  // "best/worst" AI analytics tool already uses.
  const equipmentRows = useMemo(() => aggregateByDimension(filteredRecords, 'equipment', language), [filteredRecords, language]);
  const sortedEquipmentRows = useMemo(() => rankRows(equipmentRows, sortField, sortDirection, 50), [equipmentRows, sortField, sortDirection]);
  const equipmentTotalTons = useMemo(() => equipmentRows.reduce((acc, r) => acc + (r.productionTons || 0), 0) || 1, [equipmentRows]);

  // Daily Trend Data - reuses UniversalStageRecord's already-normalized
  // productionTons/wasteTons directly, no piece-weight math needed here.
  const dailyTrendData = useMemo(() => {
    const map: Record<string, { date: string; weightTon: number; wasteTon: number }> = {};
    const sorted = [...filteredRecords].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
    sorted.forEach((r) => {
      const rawDate = String(r?.date || '');
      const d = rawDate || todayLocalIso();
      if (!map[d]) map[d] = { date: d.length > 5 ? d.substring(5) : d, weightTon: 0, wasteTon: 0 };
      map[d].weightTon += r.productionTons || 0;
      map[d].wasteTon += r.wasteTons || 0;
    });
    return Object.values(map).map((item) => ({
      ...item,
      weightTon: Number(item.weightTon.toFixed(2)),
      wasteTon: Number(item.wasteTon.toFixed(2)),
    }));
  }, [filteredRecords]);

  const latestRecords = useMemo(
    () => [...filteredRecords].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 7),
    [filteredRecords]
  );

  // Human-readable filter summary (Dashboard Capability Upgrade §6).
  const filterSummary = useMemo(() => {
    const stageLabel = stageType === 'all' ? (language === 'ar' ? 'كل المراحل' : 'All Stages') : getStageDisplayName(stageType, language);
    const shiftLabel = shiftId
      ? (shifts.find((s) => (s.id || s.code) === shiftId)?.name || shiftId)
      : (language === 'ar' ? 'كل الورديات' : 'All Shifts');
    const entityParts = [
      entityFilters.pressId ? `${language === 'ar' ? 'مكبس' : 'Press'}: ${presses.find((p) => p.id === entityFilters.pressId)?.code || entityFilters.pressId}` : null,
      entityFilters.furnaceId ? `${language === 'ar' ? 'فرن' : 'Furnace'}: ${furnaces.find((f) => f.id === entityFilters.furnaceId)?.code || entityFilters.furnaceId}` : null,
      entityFilters.employeeId ? `${language === 'ar' ? 'موظف' : 'Employee'}: ${employees.find((e) => e.id === entityFilters.employeeId)?.name || entityFilters.employeeId}` : null,
      entityFilters.customerId ? `${language === 'ar' ? 'عميل' : 'Customer'}: ${customers.find((c) => c.id === entityFilters.customerId)?.name || entityFilters.customerId}` : null,
      entityFilters.productId ? `${language === 'ar' ? 'منتج' : 'Product'}: ${products.find((p) => p.id === entityFilters.productId)?.name || entityFilters.productId}` : null,
    ].filter(Boolean);
    const sortLabel = `${language === 'ar' ? 'الترتيب' : 'Sort'}: ${SORT_FIELD_LABELS[sortField][language]} (${sortDirection === 'best' ? (language === 'ar' ? 'الأفضل' : 'Best') : (language === 'ar' ? 'الأسوأ' : 'Worst')})`;
    const dateLabel = dateSelection.preset === 'all' ? (language === 'ar' ? 'كل الفترات' : 'All Time') : resolvedDate.label;
    return [dateLabel, stageLabel, shiftLabel, ...entityParts, sortLabel].join(' · ');
  }, [resolvedDate, dateSelection.preset, stageType, shiftId, entityFilters, sortField, sortDirection, shifts, presses, employees, customers, products, language]);

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Classic / Custom Dashboards mode toggle - purely additive, defaults to Classic */}
      <div className="flex items-center gap-1 bg-slate-800 p-1 rounded text-xs font-bold w-fit">
        <button
          type="button"
          onClick={() => setViewMode('classic')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors cursor-pointer ${viewMode === 'classic' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <LayoutDashboard className="w-3.5 h-3.5" />
          {language === 'ar' ? 'اللوحة الأساسية' : 'Classic Dashboard'}
        </button>
        <button
          type="button"
          onClick={() => setViewMode('custom')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded transition-colors cursor-pointer ${viewMode === 'custom' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          {language === 'ar' ? 'لوحات مخصصة' : 'Custom Dashboards'}
        </button>
      </div>

      {viewMode === 'custom' ? (
        <DashboardBuilderView onNavigate={onNavigate} />
      ) : (
      <>
      {/* Missing Piece Weight Notice */}
      {missingPieceWeightRecordsCount > 0 && (
        <div className="bg-amber-950/40 border border-amber-800/80 rounded p-3 text-xs text-amber-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              {language === 'ar' ? (
                <>تنبيه: يوجد <strong>{missingPieceWeightRecordsCount}</strong> سجل إنتاج بدون وزن قطعة مسجل. تظهر أوزانها كـ "غير محسوب" طبقاً للقواعد القياسية للمصنع.</>
              ) : (
                <>Notice: <strong>{missingPieceWeightRecordsCount}</strong> production record(s) have no recorded piece weight. Their weight shows as "not calculated" per the factory's standard rules.</>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('master-data')}
            className="text-amber-400 underline hover:text-amber-200 cursor-pointer font-bold shrink-0 ml-2"
          >
            {language === 'ar' ? 'تحديث أوزان المنتجات' : 'Update Product Weights'}
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="bg-slate-900 border border-slate-800 p-3 flex flex-col gap-3">
        {/* PHASE 5B - the active period is always visible. The Dashboard
            defaults to the last 30 days and that default is stated here on
            screen; it is a disclosed product decision, never a hidden cap. */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400 font-bold">
            {language === 'ar' ? 'فترة لوحة التحكم:' : 'Dashboard Period:'}
          </span>
          {resolvedDate.invalid ? (
            <span className="px-2 py-1 rounded bg-red-500/15 text-red-300 border border-red-500/40 font-bold">
              {language === 'ar'
                ? 'نطاق تاريخ غير صالح - يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساوياً له. لم يتم تحديث البيانات.'
                : 'Invalid date range - the start date must be on or before the end date. Data was not refreshed.'}
            </span>
          ) : (
            <span className="px-2 py-1 rounded bg-slate-800 text-slate-200 border border-slate-700 font-bold">
              {activePeriodLabel}
            </span>
          )}
          {isLoading && !resolvedDate.invalid && (
            <span className="flex items-center gap-1.5 text-indigo-300">
              <RefreshCw className="w-3 h-3 animate-spin" />
              {language === 'ar' ? 'جارٍ تحميل الفترة المحددة...' : 'Loading selected period...'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Date presets - PHASE 5B added 'last90days' and 'prevMonth', and
              relabelled 'week' to the "Last 7 Days" it has always computed. */}
          <div className="flex items-center gap-1 bg-slate-800 p-1 rounded text-xs font-bold">
            {(['today', 'week', 'last30days', 'last90days', 'month', 'prevMonth', 'all'] as DashboardDatePresetType[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDateSelection({ preset: p })}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${dateSelection.preset === p ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {p === 'today' ? (language === 'ar' ? 'اليوم' : 'Today') : null}
                {p === 'week' ? (language === 'ar' ? 'آخر 7 أيام' : 'Last 7 Days') : null}
                {p === 'last30days' ? (language === 'ar' ? 'آخر 30 يوم' : 'Last 30 Days') : null}
                {p === 'last90days' ? (language === 'ar' ? 'آخر 90 يوم' : 'Last 90 Days') : null}
                {p === 'month' ? (language === 'ar' ? 'هذا الشهر' : 'This Month') : null}
                {p === 'prevMonth' ? (language === 'ar' ? 'الشهر السابق' : 'Previous Month') : null}
                {p === 'all' ? (language === 'ar' ? 'كل الفترات' : 'All Time') : null}
              </button>
            ))}
          </div>

          {/* Custom date range - PHASE 5B marks an incomplete/inverted range
              visibly; resolveDashboardDateSelection() reports it as invalid
              and the fetch effect above refuses to query until it is fixed. */}
          <div className="flex items-center gap-1 text-xs">
            <input
              type="date"
              aria-invalid={customRangeInvalid}
              value={dateSelection.preset === 'custom' ? (dateSelection.startDate || '') : ''}
              onChange={(e) => setDateSelection({ preset: 'custom', startDate: e.target.value, endDate: dateSelection.preset === 'custom' ? dateSelection.endDate : e.target.value })}
              className={`bg-slate-800 text-slate-200 border rounded px-1.5 py-1 text-[11px] ${customRangeInvalid ? 'border-red-500' : 'border-slate-700'}`}
            />
            <span className="text-slate-500">→</span>
            <input
              type="date"
              aria-invalid={customRangeInvalid}
              value={dateSelection.preset === 'custom' ? (dateSelection.endDate || '') : ''}
              onChange={(e) => setDateSelection({ preset: 'custom', startDate: dateSelection.preset === 'custom' ? dateSelection.startDate : e.target.value, endDate: e.target.value })}
              className={`bg-slate-800 text-slate-200 border rounded px-1.5 py-1 text-[11px] ${customRangeInvalid ? 'border-red-500' : 'border-slate-700'}`}
            />
          </div>

          {/* Named month */}
          <div className="flex items-center gap-1 text-xs">
            <select
              value={dateSelection.preset === 'namedMonth' && dateSelection.month ? dateSelection.month : ''}
              onChange={(e) => {
                const month = Number(e.target.value);
                const year = dateSelection.preset === 'namedMonth' && dateSelection.year ? dateSelection.year : new Date().getFullYear();
                if (month) setDateSelection({ preset: 'namedMonth', month, year });
              }}
              className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-1.5 py-1 text-[11px]"
            >
              <option value="">{language === 'ar' ? 'شهر محدد...' : 'Named month...'}</option>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              type="number"
              placeholder={String(new Date().getFullYear())}
              value={dateSelection.preset === 'namedMonth' && dateSelection.year ? dateSelection.year : ''}
              onChange={(e) => {
                const year = Number(e.target.value);
                const month = dateSelection.preset === 'namedMonth' && dateSelection.month ? dateSelection.month : new Date().getMonth() + 1;
                if (year) setDateSelection({ preset: 'namedMonth', month, year });
              }}
              className="w-16 bg-slate-800 text-slate-200 border border-slate-700 rounded px-1.5 py-1 text-[11px]"
            />
          </div>

          <div className="flex-grow" />

          <button
            type="button"
            onClick={() => setRefreshTrigger((t) => t + 1)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded border border-slate-700 transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {language === 'ar' ? 'تحديث' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={resetFilters}
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded border border-slate-700 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {language === 'ar' ? 'إعادة ضبط' : 'Reset'}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Stage filter */}
          <select
            value={stageType}
            onChange={(e) => setStageType(e.target.value as ProductionStageType | 'all')}
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs font-bold"
          >
            <option value="all">{language === 'ar' ? 'كل المراحل' : 'All Stages'}</option>
            {ALL_STAGES.map((s) => (
              <option key={s} value={s}>{getStageDisplayName(s, language)}</option>
            ))}
          </select>

          {/* Shift filter */}
          <select
            value={shiftId}
            onChange={(e) => setShiftId(e.target.value)}
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs font-bold"
          >
            <option value="">{language === 'ar' ? 'كل الورديات' : 'All Shifts'}</option>
            {shifts.map((s) => (
              <option key={s.id || s.code} value={s.id || s.code}>{s.name || s.code}</option>
            ))}
          </select>

          {/*
            Cost centres - the organisational filter, from the hierarchy.
            Replaces the legacy press/furnace dropdown.
          */}
          <CostCenterScopeSelector
            index={hierarchyIndex}
            selectedNodeIds={costCenterNodeIds}
            onChange={setCostCenterNodeIds}
            language={language}
            tone="dark"
          />

          {/*
            Metric type. Quantity and money are separate measures and are never
            added together - ticking both shows both, side by side.
          */}
          <div id="dashboard-metric-mode" className="flex items-center gap-2 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs font-bold text-slate-200">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-amber-400 cursor-pointer"
                checked={showQuantity}
                onChange={() => setMetricMode(metricModeFromFlags(!showQuantity, showFinancial))}
              />
              {language === 'ar' ? 'الكميات' : 'Quantities'}
            </label>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                className="w-3.5 h-3.5 accent-amber-400 cursor-pointer"
                checked={showFinancial}
                onChange={() => setMetricMode(metricModeFromFlags(showQuantity, !showFinancial))}
              />
              {language === 'ar' ? 'القيم المالية' : 'Financial values'}
            </label>
          </div>

          {/* Employee filter */}
          <select
            value={entityFilters.employeeId || ''}
            onChange={(e) => setEntityFilters((prev) => ({ ...prev, employeeId: e.target.value || undefined }))}
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs font-bold"
          >
            <option value="">{language === 'ar' ? 'كل الموظفين' : 'All Employees'}</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name || e.code}</option>
            ))}
          </select>

          {/* Customer filter */}
          <select
            value={entityFilters.customerId || ''}
            onChange={(e) => setEntityFilters((prev) => ({ ...prev, customerId: e.target.value || undefined }))}
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs font-bold"
          >
            <option value="">{language === 'ar' ? 'كل العملاء' : 'All Customers'}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name || c.code}</option>
            ))}
          </select>

          {/* Product filter */}
          <select
            value={entityFilters.productId || ''}
            onChange={(e) => setEntityFilters((prev) => ({ ...prev, productId: e.target.value || undefined }))}
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded px-2 py-1.5 text-xs font-bold"
          >
            <option value="">{language === 'ar' ? 'كل المنتجات' : 'All Products'}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name || p.code}</option>
            ))}
          </select>
        </div>

        {/* Human-readable filter summary */}
        <p className="text-[11px] text-slate-500 font-mono">{filterSummary}</p>
      </div>

      {/*
        Financial value - a separate measure in its own card. It is never added
        to, averaged with, or normalised against the production tonnage.
      */}
      {showFinancial && (
        <div id="dashboard-financial-value" className="bg-white rounded-2xl border border-emerald-200 p-4 shadow-xs">
          <p className="text-[11px] font-black text-emerald-800">
            {language === 'ar' ? 'القيم المالية - المصروفات الفعلية' : 'Financial values - actual spending'}
          </p>
          {financialError ? (
            <p className="text-xs font-bold text-rose-700 mt-1">
              {language === 'ar'
                ? `تعذر قراءة المعاملات المالية: ${financialError}`
                : `Could not read financial transactions: ${financialError}`}
            </p>
          ) : (
            <>
              <p className="text-2xl font-black text-slate-900 mt-1">{formatNumber(financialTotal.total)}</p>
              <p className="text-[11px] text-slate-500">
                {language === 'ar'
                  ? `عدد المعاملات: ${formatNumber(financialTotal.count)} — نطاق التاريخ ومراكز التكاليف نفسها`
                  : `Transactions: ${formatNumber(financialTotal.count)} — same period and cost-centre scope`}
              </p>
            </>
          )}
        </div>
      )}

      {/* 4-Column Geometric KPI Grid (Primary Factory Unit: TON) */}
      {showQuantity && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Production in Tons */}
        <StatCard
          id="stat-total-production"
          title={language === 'ar' ? 'إجمالي الإنتاج (طن)' : 'Total Production (t)'}
          value={totals.productionTons.toFixed(2)}
          unit={language === 'ar' ? 'طن' : 't'}
          color="indigo"
          icon={Factory}
          subtitle={language === 'ar' ? `عدد التشغيلات: ${formatNumber(totals.operationsCount)}` : `Operations: ${formatNumber(totals.operationsCount)}`}
          trend={{ value: language === 'ar' ? 'الوحدة القياسية للمصنع (طن)' : "Factory's standard unit (t)", isPositive: true }}
        />

        {/* Good Products in Tons */}
        <StatCard
          id="stat-good-production"
          title={language === 'ar' ? 'الإنتاج السليم (طن)' : 'Good Production (t)'}
          value={totals.goodTons.toFixed(2)}
          unit={language === 'ar' ? 'طن' : 't'}
          color="emerald"
          icon={CheckCircle2}
          subtitle={language === 'ar' ? `${qualityRate}% كفاءة الجودة بالوزن` : `${qualityRate}% weight-based quality rate`}
          trend={{ value: language === 'ar' ? `${qualityRate}% كفاءة الجودة بالوزن` : `${qualityRate}% weight-based quality rate`, isPositive: true }}
        />

        {/* Waste Quantity in Tons */}
        <StatCard
          id="stat-waste-production"
          title={language === 'ar' ? 'الهالك والتالف (طن)' : 'Waste (t)'}
          value={totals.wasteTons.toFixed(2)}
          unit={language === 'ar' ? 'طن' : 't'}
          color="rose"
          icon={AlertTriangle}
          subtitle={language === 'ar' ? `${wasteRate}% نسبة الهالك بالوزن` : `${wasteRate}% weight-based waste rate`}
          trend={{ value: language === 'ar' ? `${wasteRate}% نسبة الهالك بالوزن` : `${wasteRate}% weight-based waste rate`, isPositive: false }}
        />

        {/* Downtime Hours */}
        <StatCard
          id="stat-downtime-hours"
          title={language === 'ar' ? 'ساعات التوقف والأعطال' : 'Downtime Hours'}
          value={`${(totals.downtimeMinutes / 60).toFixed(1)} hr`}
          color="amber"
          icon={Clock}
          subtitle={language === 'ar' ? `إجمالي: ${totals.downtimeMinutes} دقيقة` : `Total: ${totals.downtimeMinutes} min`}
          trend={totals.productionTons > 0 ? { value: language === 'ar' ? `${(totals.productionTons / Math.max(1, (totals.operationsCount * 8))).toFixed(2)} طن/ساعة عمل تقريبية` : `~${(totals.productionTons / Math.max(1, (totals.operationsCount * 8))).toFixed(2)} t/labor-hour`, isPositive: true } : undefined}
        />
      </div>
      )}

      {/* Operational Shortcuts Bar */}
      <div className="bg-slate-900 p-4 border border-slate-800 shadow-md text-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
            {language === 'ar' ? 'إجراءات سريعة:' : 'Quick Actions:'}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('production-entry')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? 'تسجيل إنتاج جديد' : 'New Production Entry'}</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('bulk-entry')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded border border-slate-700 transition-colors cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5 text-indigo-400" />
              <span>{language === 'ar' ? 'استيراد Excel / CSV' : 'Import Excel / CSV'}</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('master-data')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded border border-slate-700 transition-colors cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-sky-400" />
              <span>{language === 'ar' ? 'البيانات الأساسية' : 'Master Data'}</span>
            </button>
          </div>
        </div>

        <div className="text-xs text-slate-400">
          {language === 'ar' ? `${formatNumber(filteredRecords.length)} سجل مطابق` : `${formatNumber(filteredRecords.length)} matching records`}
        </div>
      </div>

      {/* Quantity sections - hidden when only financial values are chosen. */}
      {showQuantity && (<>
      {/* Main 3-Column Layout: Records Table (2 cols) + Right Side Gauges (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Recent Production Records Table */}
        <div className="lg:col-span-2 bg-white border border-slate-200 shadow-xs flex flex-col">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h2 className="font-bold text-slate-700 text-sm">{language === 'ar' ? 'أحدث سجلات الإنتاج (كل المراحل)' : 'Latest Production Records (All Stages)'}</h2>
            <button
              type="button"
              onClick={() => onNavigate('production-records')}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
            >
              {language === 'ar' ? <>عرض الكل &larr;</> : <>View All &rarr;</>}
            </button>
          </div>

          <div className="flex-grow overflow-x-auto">
            {isLoading ? (
              <div className="p-10 text-center text-xs text-slate-400">
                {language === 'ar' ? 'جاري تحميل البيانات...' : 'Loading data...'}
              </div>
            ) : latestRecords.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-400">
                {language === 'ar'
                  ? 'لا توجد سجلات مطابقة للفلاتر الحالية.'
                  : 'No records match the current filters.'}
              </div>
            ) : (
              <table className="w-full text-right">
                <thead className="bg-slate-100 text-[10px] text-slate-500 uppercase tracking-tighter">
                  <tr className="border-b border-slate-200">
                    <th className="p-3 font-bold">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                    <th className="p-3 font-bold">{language === 'ar' ? 'المرحلة / المكبس' : 'Stage / Press'}</th>
                    <th className="p-3 font-bold">{language === 'ar' ? 'المنتج' : 'Product'}</th>
                    <th className="p-3 font-bold">{language === 'ar' ? 'سليم (طن)' : 'Good (t)'}</th>
                    <th className="p-3 font-bold">{language === 'ar' ? 'هالك (طن)' : 'Waste (t)'}</th>
                    <th className="p-3 font-bold">{language === 'ar' ? 'الوزن (طن)' : 'Weight (t)'}</th>
                    <th className="p-3 font-bold">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-slate-100">
                  {latestRecords.map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono text-xs text-slate-600">{rec.date || '-'}</td>
                      <td className="p-3 font-medium text-slate-800">{rec.rawData?.pressName || getStageDisplayName(rec.stageType, language)}</td>
                      <td className="p-3 font-medium text-slate-900">{rec.productName || '-'}</td>
                      <td className="p-3 font-mono text-emerald-600 font-bold">{formatDecimal(rec.goodTons || 0, 2)}</td>
                      <td className="p-3 font-mono text-rose-600 font-bold">{formatDecimal(rec.wasteTons || 0, 2)}</td>
                      <td className="p-3 font-mono font-bold text-slate-900">{formatDecimal(rec.productionTons || 0, 2)}</td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">
                          {language === 'ar' ? 'مكتمل' : 'Complete'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right 1 Column: Equipment Distribution (sortable) & Furnace Master Data Card */}
        <div className="flex flex-col gap-6">
          {/* Equipment (Press/Furnace/Machine) Distribution - real data + real sort */}
          <div className="bg-white border border-slate-200 p-4 shadow-xs flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-4">
              <h2 className="font-bold text-slate-700 text-sm">
                {language === 'ar' ? 'توزيع الإنتاج حسب المعدة' : 'Production Distribution by Equipment'}
              </h2>
              <div className="flex items-center gap-1">
                <select
                  value={sortField}
                  onChange={(e) => setSortField(e.target.value as RankingMetric)}
                  className="text-[10px] bg-slate-50 border border-slate-200 rounded px-1 py-0.5"
                >
                  {SORT_FIELDS.map((f) => (
                    <option key={f} value={f}>{SORT_FIELD_LABELS[f][language]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSortDirection((d) => (d === 'best' ? 'worst' : 'best'))}
                  title={language === 'ar' ? 'عكس اتجاه الترتيب' : 'Toggle sort direction'}
                  className="p-1 bg-slate-50 border border-slate-200 rounded hover:bg-slate-100 cursor-pointer"
                >
                  <ArrowUpDown className="w-3 h-3 text-slate-500" />
                </button>
              </div>
            </div>
            {sortedEquipmentRows.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-4">
                {language === 'ar' ? 'لا توجد بيانات كافية لعرض التوزيع.' : 'Not enough data to display this distribution.'}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {sortedEquipmentRows.slice(0, 4).map((item, idx) => {
                  const colors = ['bg-indigo-600', 'bg-indigo-500', 'bg-indigo-400', 'bg-slate-400'];
                  const barColor = colors[idx % colors.length];
                  const pct = Math.round(((item.productionTons || 0) / equipmentTotalTons) * 100);
                  return (
                    <div key={item.key} className="space-y-1">
                      <div className="flex justify-between text-xs font-bold">
                        <span className="text-slate-600">{item.label}</span>
                        <span className="text-slate-800 font-mono">{formatDecimal(item[sortField] as number, 2)}</span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${barColor} rounded-full transition-all duration-500`}
                          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Furnaces Master Data Summary Card (real counts, no fabricated temperatures) */}
          <div className="bg-slate-900 p-5 rounded border border-slate-800 text-white shadow-lg flex-grow flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-indigo-400 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <span>{language === 'ar' ? 'إحصائيات الأفران والحراريات' : 'Furnace & Refractory Overview'}</span>
                </h3>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                {furnaces.length === 0 && presses.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    {language === 'ar' ? 'لا توجد بيانات أساسية للأفران أو المكابس بعد.' : 'No furnace or press master data yet.'}
                  </p>
                ) : (
                  <>
                    <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                      <span className="text-xs text-slate-400">{language === 'ar' ? 'عدد الأفران المسجلة' : 'Registered Furnaces'}</span>
                      <span className="text-sm font-bold text-orange-400 font-mono">{formatNumber(furnaces.length)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-400">{language === 'ar' ? 'عدد المكابس المسجلة' : 'Registered Presses'}</span>
                      <span className="text-sm font-bold text-emerald-400 font-mono">{formatNumber(presses.length)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('master-data')}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold mt-4 transition-colors cursor-pointer text-center"
            >
              {language === 'ar' ? 'لوحة الأفران والبيانات الأساسية' : 'Furnaces & Master Data'}
            </button>
          </div>
        </div>
      </div>

      {/* Production Trend Line Chart */}
      <div className="bg-white border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{language === 'ar' ? 'مسار الإنتاج اليومي والأوزان (طن)' : 'Daily Production & Weight Trend (t)'}</h3>
            <p className="text-[11px] text-slate-500">{language === 'ar' ? 'مراقبة الأداء التراكمي وتدفق خامات الحراريات' : 'Tracking cumulative performance and refractory material flow'}</p>
          </div>
          <Badge variant="indigo">{language === 'ar' ? 'أطنان حراريات' : 'Refractory Tons'}</Badge>
        </div>

        <div className="h-64 w-full">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              {language === 'ar' ? 'جاري تحميل البيانات...' : 'Loading data...'}
            </div>
          ) : dailyTrendData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              {language === 'ar' ? 'لا توجد بيانات كافية لعرض الرسم البياني.' : 'Not enough data to display this chart.'}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="indigoWeightGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip contentStyle={{ backgroundColor: '#0f172a', borderRadius: '4px', color: '#fff', fontSize: '11px', border: '1px solid #334155' }} />
                <Area type="monotone" dataKey="weightTon" name={language === 'ar' ? 'الوزن (طن)' : 'Weight (t)'} stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#indigoWeightGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
      </>)}
      </>
      )}
    </div>
  );
};

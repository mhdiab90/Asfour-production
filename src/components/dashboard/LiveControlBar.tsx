/**
 * Live Control Bar (Part 4 §15-22, Part 5 §23-25) - a persistent bar near
 * the top of the Dashboard/Report canvas for quick, real-time control of
 * the visible analytical data: date-range shortcuts, Stage/Shift/
 * Equipment/Product/Customer dropdowns, a lightweight live-status readout,
 * manual Refresh (+ optional low-frequency Auto Refresh), Reset, and
 * removable chips for every active filter (field filters AND the Power
 * BI-style cross-filter from clicking a chart element).
 *
 * Filter state itself is `GlobalDashboardFilters` (dashboardRegistry.ts) -
 * the SAME shared shape already used by resolveWidgetFilters()/widget
 * rendering, so this bar doesn't introduce a second filter model (Part 31).
 *
 * Layout: the SAME dark filter panel as the classic Dashboard, built from the
 * shared dashboardFilterStyles tokens - period + actions, then presets, then a
 * responsive filter grid (1 / 2 / 4 columns). It used to squeeze every filter
 * into one `overflow-x-auto` strip, which both forced horizontal scrolling and
 * clipped the cost-centre dropdown (an overflow container clips its absolutely
 * positioned children); nothing here scrolls sideways any more.
 *
 * Performance: no Firestore calls originate here - `onRefresh` triggers the
 * SAME one-time fetch the Dashboard Builder already does; there is no
 * continuous polling loop unless the user explicitly turns Auto Refresh on,
 * and even then the interval is a conservative 60s (Part 11/§22 "sensible
 * intervals... do not create excessive Firestore reads").
 */
import React, { useEffect, useState } from 'react';
import { CostCenterScopeSelector } from './CostCenterScopeSelector';
import { HierarchyIndex } from '../../services/hierarchyResolverPure';
import { RotateCcw, RefreshCw, Circle, X } from 'lucide-react';
import { Shift, Press, Product, Customer, Employee } from '../../types';
import { GlobalDashboardFilters, TimeRangePreset, TIME_RANGE_LABELS, CrossFilterState, resolveTimeRangePreset } from '../../services/dashboardRegistry';
import { MetricModeToggle } from './DashboardMetricControls';
import {
  DASHBOARD_FILTER_PANEL,
  DASHBOARD_FILTER_SELECT,
  DASHBOARD_PRESET_GROUP,
  dashboardPresetButton,
  DASHBOARD_DATE_INPUT,
  DASHBOARD_PANEL_BUTTON,
} from './dashboardFilterStyles';

interface LiveControlBarProps {
  /** Shown in the page header now, not repeated inside the filter panel. */
  dashboardName: string;
  globalFilters: GlobalDashboardFilters;
  onChangeFilters: (patch: Partial<GlobalDashboardFilters>) => void;
  onReset: () => void;
  onRefresh: () => void;
  lastUpdated: Date | null;
  isRefreshing: boolean;
  crossFilter: CrossFilterState | null;
  onClearCrossFilter: () => void;
  shifts: Shift[];
  /** Kept for the chip label of a pressId set elsewhere (e.g. by the assistant); no longer a dropdown. */
  presses: Press[];
  /** The cost-centre hierarchy, for the organisational selector. */
  hierarchyIndex: HierarchyIndex<any>;
  products: Product[];
  customers: Customer[];
  employees: Employee[];
  language: 'ar' | 'en';
}

/**
 * Consolidated UX pass Item 1 - the full requested preset vocabulary
 * (Today/This Week/This Month/Last Month/Last 7 Days/Last 30 Days/Last 3
 * Months/Last 6 Months/This Year/All Time/Custom Range/Named Month), reusing
 * the SAME TimeRangePreset enum and resolveTimeRangePreset() the Live Control
 * Bar, widget rendering, and the AI's setCustomDashboardFilters tool all
 * already share - no second date vocabulary was introduced.
 *
 * PHASE 5B.1 - 'LAST_MONTH' (the whole PREVIOUS calendar month) is surfaced
 * here as a quick preset. It was already a fully supported member of the
 * TimeRangePreset enum, already had bilingual labels in TIME_RANGE_LABELS,
 * and was already resolved by resolveTimeRangePreset() - it simply was not
 * reachable from this bar, so the Dashboard Builder could not offer the
 * "previous month" period the classic Dashboard already offered. This is a
 * pure UI-exposure change: no new preset, no new label system, no new date
 * math, and no change to any existing preset's behavior.
 *
 * The ~90-day period is intentionally NOT given a new preset: 'LAST_3_MONTHS'
 * is this product's existing representation of it and is already listed
 * below, so adding a competing 'LAST_90_DAYS' would have created two
 * near-identical presets for one concept.
 */
const QUICK_PRESETS: TimeRangePreset[] = ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_3_MONTHS', 'LAST_6_MONTHS', 'THIS_YEAR', 'ALL_TIME', 'NAMED_MONTH', 'CUSTOM'];

const MONTH_NAMES: { ar: string; en: string }[] = [
  { ar: 'يناير', en: 'January' }, { ar: 'فبراير', en: 'February' }, { ar: 'مارس', en: 'March' },
  { ar: 'أبريل', en: 'April' }, { ar: 'مايو', en: 'May' }, { ar: 'يونيو', en: 'June' },
  { ar: 'يوليو', en: 'July' }, { ar: 'أغسطس', en: 'August' }, { ar: 'سبتمبر', en: 'September' },
  { ar: 'أكتوبر', en: 'October' }, { ar: 'نوفمبر', en: 'November' }, { ar: 'ديسمبر', en: 'December' },
];

function timeAgo(date: Date, language: 'ar' | 'en'): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 5) return language === 'ar' ? 'الآن' : 'just now';
  if (seconds < 60) return language === 'ar' ? `منذ ${seconds} ثانية` : `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return language === 'ar' ? `منذ ${minutes} دقيقة` : `${minutes}m ago`;
}

export const LiveControlBar: React.FC<LiveControlBarProps> = ({
  globalFilters, onChangeFilters, onReset, onRefresh, lastUpdated, isRefreshing,
  crossFilter, onClearCrossFilter, shifts, presses, products, customers, employees, language, hierarchyIndex,
}) => {
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [, forceTick] = useState(0);
  const today = new Date();
  const [customStartDraft, setCustomStartDraft] = useState(globalFilters.customStart || '');
  const [customEndDraft, setCustomEndDraft] = useState(globalFilters.customEnd || '');
  const [namedMonthDraft, setNamedMonthDraft] = useState({ year: globalFilters.namedMonth?.year || today.getFullYear(), month: globalFilters.namedMonth?.month || today.getMonth() + 1 });

  // Re-render every 15s purely to refresh the "updated Xs ago" text - no network activity.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(onRefresh, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  const t = {
    reset: language === 'ar' ? 'إعادة ضبط الفلاتر' : 'Reset Filters',
    refresh: language === 'ar' ? 'تحديث' : 'Refresh',
    autoRefresh: language === 'ar' ? 'تحديث تلقائي' : 'Auto Refresh',
    live: language === 'ar' ? 'مباشر' : 'Live',
    refreshingLabel: language === 'ar' ? 'جارٍ التحديث...' : 'Refreshing...',
    updated: (s: string) => language === 'ar' ? `تم التحديث ${s}` : `Updated ${s}`,
    shift: language === 'ar' ? 'الوردية' : 'Shift',
    employee: language === 'ar' ? 'الموظف' : 'Employee',
    press: language === 'ar' ? 'المكبس/المعدة' : 'Press/Equipment',
    product: language === 'ar' ? 'المنتج' : 'Product',
    customer: language === 'ar' ? 'العميل' : 'Customer',
    all: language === 'ar' ? 'الكل' : 'All',
    activeFilters: language === 'ar' ? 'فلاتر نشطة:' : 'Active filters:',
    from: language === 'ar' ? 'من' : 'From',
    to: language === 'ar' ? 'إلى' : 'To',
    apply: language === 'ar' ? 'تطبيق' : 'Apply',
    rangeInvalid: language === 'ar' ? 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية أو يساويه' : 'End date must be on or after the start date',
    year: language === 'ar' ? 'السنة' : 'Year',
    period: language === 'ar' ? 'فترة اللوحة:' : 'Dashboard Period:',
  };

  const presetLabel = language === 'ar' ? TIME_RANGE_LABELS[globalFilters.timeRangePreset].ar : TIME_RANGE_LABELS[globalFilters.timeRangePreset].en;
  const periodBounds = resolveTimeRangePreset(globalFilters.timeRangePreset, globalFilters.customStart, globalFilters.customEnd, globalFilters.namedMonth);
  const periodLabel = periodBounds.startDate && periodBounds.endDate
    ? `${presetLabel} (${periodBounds.startDate} → ${periodBounds.endDate})`
    : presetLabel;
  const fullWidthSelect = `${DASHBOARD_FILTER_SELECT} w-full min-w-0`;

  const shiftLabel = globalFilters.shiftId ? shifts.find((s) => s.id === globalFilters.shiftId)?.name : undefined;
  const employeeLabel = globalFilters.employeeId ? employees.find((e) => e.id === globalFilters.employeeId)?.name : undefined;
  const pressLabel = globalFilters.pressId ? presses.find((p) => p.id === globalFilters.pressId)?.name : undefined;
  const productLabel = globalFilters.productId ? products.find((p) => p.id === globalFilters.productId)?.name : undefined;
  const customerLabel = globalFilters.customerId ? customers.find((c) => c.id === globalFilters.customerId)?.name : undefined;

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  if (shiftLabel) chips.push({ key: 'shift', label: `${t.shift}: ${shiftLabel}`, onRemove: () => onChangeFilters({ shiftId: undefined }) });
  if (employeeLabel) chips.push({ key: 'employee', label: `${t.employee}: ${employeeLabel}`, onRemove: () => onChangeFilters({ employeeId: undefined }) });
  if (pressLabel) chips.push({ key: 'press', label: `${t.press}: ${pressLabel}`, onRemove: () => onChangeFilters({ pressId: undefined }) });
  if (productLabel) chips.push({ key: 'product', label: `${t.product}: ${productLabel}`, onRemove: () => onChangeFilters({ productId: undefined }) });
  if (customerLabel) chips.push({ key: 'customer', label: `${t.customer}: ${customerLabel}`, onRemove: () => onChangeFilters({ customerId: undefined }) });
  if (crossFilter) chips.push({ key: 'cross', label: crossFilter.label, onRemove: onClearCrossFilter });

  return (
    <div id="custom-dashboard-filter-panel" className={DASHBOARD_FILTER_PANEL}>
      {/* Row 1 - the active period, live status and the panel actions. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400 font-bold">{t.period}</span>
        <span className="px-2 py-1 rounded bg-slate-800 text-slate-200 border border-slate-700 font-bold">{periodLabel}</span>
        <div className="flex-grow" />
        <span className="flex items-center gap-1 text-[11px] font-bold text-slate-400">
          <Circle className={`w-2 h-2 ${isRefreshing ? 'fill-amber-400 text-amber-400 animate-pulse' : 'fill-emerald-400 text-emerald-400'}`} />
          {isRefreshing ? t.refreshingLabel : lastUpdated ? t.updated(timeAgo(lastUpdated, language)) : t.live}
        </span>
        <label className="flex items-center gap-1 text-[11px] font-bold text-slate-400 cursor-pointer">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="w-3.5 h-3.5 accent-amber-400 cursor-pointer" />
          {t.autoRefresh}
        </label>
        <button type="button" onClick={onRefresh} disabled={isRefreshing} className={`${DASHBOARD_PANEL_BUTTON} disabled:opacity-40`} title={t.refresh}>
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          {t.refresh}
        </button>
        <button type="button" onClick={onReset} className={DASHBOARD_PANEL_BUTTON}>
          <RotateCcw className="w-3.5 h-3.5" />
          {t.reset}
        </button>
      </div>

      {/* Row 2 - period presets; the group wraps instead of scrolling. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className={`${DASHBOARD_PRESET_GROUP} flex-wrap`}>
          {QUICK_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChangeFilters({ timeRangePreset: p })}
              className={`${dashboardPresetButton(globalFilters.timeRangePreset === p)} whitespace-nowrap`}
            >
              {language === 'ar' ? TIME_RANGE_LABELS[p].ar : TIME_RANGE_LABELS[p].en}
            </button>
          ))}
        </div>

        {/* Custom Range date inputs - only shown once CUSTOM is the active preset; endDate >= startDate is enforced before Apply is enabled. */}
        {globalFilters.timeRangePreset === 'CUSTOM' && (
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="text-[11px] font-bold text-slate-400">{t.from}</span>
            <input type="date" value={customStartDraft} max={customEndDraft || undefined} onChange={(e) => setCustomStartDraft(e.target.value)} className={`${DASHBOARD_DATE_INPUT} border-slate-700`} />
            <span className="text-[11px] font-bold text-slate-400">{t.to}</span>
            <input type="date" value={customEndDraft} min={customStartDraft || undefined} onChange={(e) => setCustomEndDraft(e.target.value)} className={`${DASHBOARD_DATE_INPUT} ${customStartDraft && customEndDraft && customEndDraft < customStartDraft ? 'border-red-500' : 'border-slate-700'}`} />
            <button
              type="button"
              disabled={!customStartDraft || !customEndDraft || customEndDraft < customStartDraft}
              onClick={() => onChangeFilters({ timeRangePreset: 'CUSTOM', customStart: customStartDraft, customEnd: customEndDraft })}
              className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {t.apply}
            </button>
            {customStartDraft && customEndDraft && customEndDraft < customStartDraft && (
              <span className="px-2 py-1 rounded bg-red-500/15 text-red-300 border border-red-500/40 text-[11px] font-bold">{t.rangeInvalid}</span>
            )}
          </div>
        )}

        {/* Named Month picker - only shown once NAMED_MONTH is the active preset. */}
        {globalFilters.timeRangePreset === 'NAMED_MONTH' && (
          <div className="flex items-center gap-1.5 text-xs">
            <select
              value={namedMonthDraft.month}
              onChange={(e) => setNamedMonthDraft((d) => ({ ...d, month: Number(e.target.value) }))}
              className={`${DASHBOARD_DATE_INPUT} border-slate-700`}
            >
              {MONTH_NAMES.map((m, idx) => <option key={idx + 1} value={idx + 1}>{language === 'ar' ? m.ar : m.en}</option>)}
            </select>
            <input
              type="number"
              value={namedMonthDraft.year}
              onChange={(e) => setNamedMonthDraft((d) => ({ ...d, year: Number(e.target.value) }))}
              className={`${DASHBOARD_DATE_INPUT} border-slate-700 w-20`}
              title={t.year}
            />
            <button
              type="button"
              onClick={() => onChangeFilters({ timeRangePreset: 'NAMED_MONTH', namedMonth: { year: namedMonthDraft.year, month: namedMonthDraft.month } })}
              className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold cursor-pointer"
            >
              {t.apply}
            </button>
          </div>
        )}
      </div>

      {/*
        Row 3 - the filters, in a responsive grid: one column on phones, two on
        tablets, four on desktop. Every control fills its cell, so nothing is
        cramped and nothing scrolls sideways.
      */}
      <div id="custom-dashboard-filter-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {/*
          Cost centres from the hierarchy - THE organisational filter, the same
          selector the classic Dashboard uses (search, 5/6/7/8/9 groups,
          recursive checkboxes). There is deliberately no dashboard-wide Stage
          or press dropdown beside it: those showed the same organisational
          dimension twice ("التشكيل والمكابس" next to "المكابس"). A widget's own
          stage lives in its widget settings.
        */}
        <CostCenterScopeSelector
          index={hierarchyIndex}
          selectedNodeIds={globalFilters.costCenterNodeIds ?? []}
          onChange={(ids) => onChangeFilters({ costCenterNodeIds: ids.length > 0 ? ids : undefined })}
          language={language}
          tone="dark"
          block
        />
        <select value={globalFilters.shiftId || ''} onChange={(e) => onChangeFilters({ shiftId: e.target.value || undefined })} className={fullWidthSelect} title={t.shift}>
          <option value="">{t.shift}: {t.all}</option>
          {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={globalFilters.productId || ''} onChange={(e) => onChangeFilters({ productId: e.target.value || undefined })} className={fullWidthSelect} title={t.product}>
          <option value="">{t.product}: {t.all}</option>
          {products.slice(0, 200).map((p) => <option key={p.id} value={p.id}>{p.name || p.productName}</option>)}
        </select>
        <select value={globalFilters.customerId || ''} onChange={(e) => onChangeFilters({ customerId: e.target.value || undefined })} className={fullWidthSelect} title={t.customer}>
          <option value="">{t.customer}: {t.all}</option>
          {customers.slice(0, 200).map((c) => <option key={c.id} value={c.id}>{c.name || c.company}</option>)}
        </select>
        <select value={globalFilters.employeeId || ''} onChange={(e) => onChangeFilters({ employeeId: e.target.value || undefined })} className={fullWidthSelect} title={t.employee}>
          <option value="">{t.employee}: {t.all}</option>
          {employees.slice(0, 200).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <MetricModeToggle
          id="custom-dashboard-metric-mode"
          mode={globalFilters.metricMode ?? 'QUANTITY'}
          onChange={(metricMode) => onChangeFilters({ metricMode })}
          language={language}
        />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-800 pt-2">
          <span className="text-[11px] font-bold text-slate-400">{t.activeFilters}</span>
          {chips.map((c) => (
            <span key={c.key} className="flex items-center gap-1 bg-indigo-500/20 text-indigo-200 border border-indigo-500/40 text-[11px] font-bold px-2 py-0.5 rounded-full">
              {c.label}
              <button type="button" onClick={c.onRemove} className="cursor-pointer hover:text-white"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

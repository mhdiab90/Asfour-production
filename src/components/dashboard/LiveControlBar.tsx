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
import { Shift, Press, Product, Customer, Employee, ProductionStageType } from '../../types';
import { GlobalDashboardFilters, TimeRangePreset, TIME_RANGE_LABELS, ALL_STAGES, getStageDisplayName, CrossFilterState } from '../../services/dashboardRegistry';

interface LiveControlBarProps {
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
  dashboardName, globalFilters, onChangeFilters, onReset, onRefresh, lastUpdated, isRefreshing,
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
    stage: language === 'ar' ? 'المرحلة' : 'Stage',
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
  };

  const stageLabel = globalFilters.stageType === 'all' ? t.all : getStageDisplayName(globalFilters.stageType, language);
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
    <div className="bg-white border border-slate-200 shadow-xs">
      <div className="p-3 flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-slate-800 truncate shrink-0">{dashboardName}</span>

        {/* Date range quick-select - horizontally scrollable on mobile (Part 12) */}
        <div className="flex items-center gap-1 overflow-x-auto max-w-full bg-slate-100 p-1 rounded text-[11px] font-bold shrink-0">
          {QUICK_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onChangeFilters({ timeRangePreset: p })}
              className={`px-2 py-1 rounded whitespace-nowrap cursor-pointer ${globalFilters.timeRangePreset === p ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500'}`}
            >
              {language === 'ar' ? TIME_RANGE_LABELS[p].ar : TIME_RANGE_LABELS[p].en}
            </button>
          ))}
        </div>

        {/* Custom Range date inputs - only shown once CUSTOM is the active preset; endDate >= startDate is enforced before Apply is enabled. */}
        {globalFilters.timeRangePreset === 'CUSTOM' && (
          <div className="flex items-center gap-1.5 flex-wrap bg-slate-50 border border-slate-200 rounded px-2 py-1 shrink-0">
            <span className="text-[10px] font-bold text-slate-500">{t.from}</span>
            <input type="date" value={customStartDraft} max={customEndDraft || undefined} onChange={(e) => setCustomStartDraft(e.target.value)} className="border border-slate-200 rounded px-1.5 py-0.5 text-[11px]" />
            <span className="text-[10px] font-bold text-slate-500">{t.to}</span>
            <input type="date" value={customEndDraft} min={customStartDraft || undefined} onChange={(e) => setCustomEndDraft(e.target.value)} className="border border-slate-200 rounded px-1.5 py-0.5 text-[11px]" />
            <button
              type="button"
              disabled={!customStartDraft || !customEndDraft || customEndDraft < customStartDraft}
              onClick={() => onChangeFilters({ timeRangePreset: 'CUSTOM', customStart: customStartDraft, customEnd: customEndDraft })}
              className="px-2 py-0.5 rounded bg-indigo-600 text-white text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {t.apply}
            </button>
            {customStartDraft && customEndDraft && customEndDraft < customStartDraft && (
              <span className="text-[10px] font-bold text-rose-600">{t.rangeInvalid}</span>
            )}
          </div>
        )}

        {/* Named Month picker - only shown once NAMED_MONTH is the active preset. */}
        {globalFilters.timeRangePreset === 'NAMED_MONTH' && (
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded px-2 py-1 shrink-0">
            <select
              value={namedMonthDraft.month}
              onChange={(e) => setNamedMonthDraft((d) => ({ ...d, month: Number(e.target.value) }))}
              className="border border-slate-200 rounded px-1.5 py-0.5 text-[11px]"
            >
              {MONTH_NAMES.map((m, idx) => <option key={idx + 1} value={idx + 1}>{language === 'ar' ? m.ar : m.en}</option>)}
            </select>
            <input
              type="number"
              value={namedMonthDraft.year}
              onChange={(e) => setNamedMonthDraft((d) => ({ ...d, year: Number(e.target.value) }))}
              className="border border-slate-200 rounded px-1.5 py-0.5 text-[11px] w-16"
              title={t.year}
            />
            <button
              type="button"
              onClick={() => onChangeFilters({ timeRangePreset: 'NAMED_MONTH', namedMonth: { year: namedMonthDraft.year, month: namedMonthDraft.month } })}
              className="px-2 py-0.5 rounded bg-indigo-600 text-white text-[11px] font-bold cursor-pointer"
            >
              {t.apply}
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 overflow-x-auto">
          <select value={globalFilters.stageType} onChange={(e) => onChangeFilters({ stageType: e.target.value as ProductionStageType | 'all' })} className="border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-700 shrink-0" title={t.stage}>
            <option value="all">{t.stage}: {t.all}</option>
            {ALL_STAGES.map((s) => <option key={s} value={s}>{getStageDisplayName(s, language)}</option>)}
          </select>
          <select value={globalFilters.shiftId || ''} onChange={(e) => onChangeFilters({ shiftId: e.target.value || undefined })} className="border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-700 shrink-0" title={t.shift}>
            <option value="">{t.shift}: {t.all}</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={globalFilters.employeeId || ''} onChange={(e) => onChangeFilters({ employeeId: e.target.value || undefined })} className="border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-700 shrink-0" title={t.employee}>
            <option value="">{t.employee}: {t.all}</option>
            {employees.slice(0, 200).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          {/*
            Cost centres from the hierarchy - the same selector the classic
            Dashboard uses. It replaces the flat legacy press list, which no
            longer matches how the organisation is structured.
          */}
          <div className="shrink-0">
            <CostCenterScopeSelector
              index={hierarchyIndex}
              selectedNodeIds={globalFilters.costCenterNodeIds ?? []}
              onChange={(ids) => onChangeFilters({ costCenterNodeIds: ids.length > 0 ? ids : undefined })}
              language={language}
              tone="light"
            />
          </div>
          <select value={globalFilters.productId || ''} onChange={(e) => onChangeFilters({ productId: e.target.value || undefined })} className="border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-700 shrink-0" title={t.product}>
            <option value="">{t.product}: {t.all}</option>
            {products.slice(0, 200).map((p) => <option key={p.id} value={p.id}>{p.name || p.productName}</option>)}
          </select>
          <select value={globalFilters.customerId || ''} onChange={(e) => onChangeFilters({ customerId: e.target.value || undefined })} className="border border-slate-200 rounded px-2 py-1 text-xs font-semibold text-slate-700 shrink-0" title={t.customer}>
            <option value="">{t.customer}: {t.all}</option>
            {customers.slice(0, 200).map((c) => <option key={c.id} value={c.id}>{c.name || c.company}</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 ms-auto shrink-0">
          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
            <Circle className={`w-2 h-2 ${isRefreshing ? 'fill-amber-400 text-amber-400 animate-pulse' : 'fill-emerald-400 text-emerald-400'}`} />
            {isRefreshing ? t.refreshingLabel : lastUpdated ? t.updated(timeAgo(lastUpdated, language)) : t.live}
          </span>
          <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="cursor-pointer" />
            {t.autoRefresh}
          </label>
          <button type="button" onClick={onRefresh} disabled={isRefreshing} className="p-1.5 text-slate-400 hover:text-indigo-600 disabled:opacity-40 cursor-pointer" title={t.refresh}>
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button type="button" onClick={onReset} className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-slate-400 hover:text-rose-600 cursor-pointer">
            <RotateCcw className="w-3 h-3" />{t.reset}
          </button>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="px-3 pb-2.5 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
          <span className="text-[10px] font-bold text-slate-400">{t.activeFilters}</span>
          {chips.map((c) => (
            <span key={c.key} className="flex items-center gap-1 bg-indigo-50 text-indigo-700 text-[11px] font-bold px-2 py-0.5 rounded-full">
              {c.label}
              <button type="button" onClick={c.onRemove} className="cursor-pointer hover:text-indigo-900"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

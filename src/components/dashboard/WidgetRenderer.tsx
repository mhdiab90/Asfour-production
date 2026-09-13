/**
 * Generic Dashboard Widget renderer (§1-3, 13-14).
 *
 * Turns ONE WidgetConfig into a live chart/KPI/table/ranking/comparison,
 * computed entirely from data that already went through
 * reportingEngine.ts's aggregateByDimension()/filterUniversalRecords() - the
 * SAME functions the Reports screen uses - so a number shown here can never
 * diverge from the equivalent Reports number. Never fabricates a value: a
 * metric/dimension combination with no matching records renders an explicit
 * "not enough data" state instead of a fake zero-look chart.
 */
import React, { useMemo } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, ScatterChart, Scatter, RadarChart, Radar,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, Tooltip,
  CartesianGrid, Legend,
} from 'recharts';
import { GripVertical, Settings2, Copy, Trash2, Info, Search, FileBarChart2, Filter, X as XIcon } from 'lucide-react';
import { UniversalStageRecord } from '../../types';
import { aggregateByDimension, filterUniversalRecords, getStageDisplayName, AggregatedReportRow } from '../../services/reportingEngine';
import {
  WidgetConfig, METRIC_REGISTRY, getMetricLabel, ENTITY_TO_DIMENSION,
  computeRankingForEntity, resolveWidgetFilters, GlobalDashboardFilters,
  isMetricSupportedForStage, TIME_RANGE_LABELS, isCrossFilterCompatible, CrossFilterState,
} from '../../services/dashboardRegistry';
import { formatNumber, formatDecimal } from '../../utils/formatters';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#8b5cf6', '#14b8a6', '#eab308', '#64748b'];

interface ChartRow {
  key: string;
  label: string;
  value: number;
  records: UniversalStageRecord[];
}

interface WidgetRendererProps {
  config: WidgetConfig;
  allRecords: UniversalStageRecord[];
  globalFilters: GlobalDashboardFilters;
  language: 'ar' | 'en';
  onDrillDown?: (rows: UniversalStageRecord[], title: string) => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onRemove?: () => void;
  editable?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  /** Power BI-style cross-filtering (Part 3 §8) - the currently active dashboard-wide filter, and the callbacks to set/clear it by clicking a chart element. */
  crossFilter?: CrossFilterState | null;
  onCrossFilterRequest?: (entityType: NonNullable<WidgetConfig['entityType']>, key: string, label: string, sourceWidgetId: string) => void;
  onClearCrossFilter?: () => void;
  /** Drill-through (Part 3 §10) - jump from this widget to the matching full Report. */
  onDrillThrough?: (config: WidgetConfig) => void;
  /**
   * Equipment ids the selected cost centres resolve to, computed ONCE by the
   * Builder through the shared resolver. null = no cost-centre narrowing.
   */
  hierarchyScope?: Set<string> | null;
}

export const WidgetRenderer: React.FC<WidgetRendererProps> = ({
  config, allRecords, globalFilters, language, onDrillDown, onEdit, onDuplicate, onRemove, editable, dragHandleProps,
  crossFilter, onCrossFilterRequest, onClearCrossFilter, onDrillThrough, hierarchyScope = null,
}) => {
  const resolved = useMemo(() => resolveWidgetFilters(config, globalFilters), [config, globalFilters]);
  const metricDef = METRIC_REGISTRY[config.metric];

  const filteredRecords = useMemo(() => {
    // The third argument is the same hierarchy scope Reports and the classic
    // Dashboard pass, so a widget total agrees with them for the same selection.
    return filterUniversalRecords(allRecords, {
      startDate: resolved.startDate,
      endDate: resolved.endDate,
      stageType: resolved.stageType,
      ...resolved.filters,
    }, hierarchyScope);
  }, [allRecords, resolved, hierarchyScope]);

  const stageSupported = isMetricSupportedForStage(config.metric, resolved.stageType);

  const rowsBeforeCrossFilter: ChartRow[] = useMemo(() => {
    if (!stageSupported) return [];
    if (config.analysisMode === 'TREND') {
      const byDate = new Map<string, UniversalStageRecord[]>();
      for (const r of filteredRecords) {
        if (!r.date) continue;
        if (!byDate.has(r.date)) byDate.set(r.date, []);
        byDate.get(r.date)!.push(r);
      }
      return Array.from(byDate.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, recs]) => ({ key: date, label: date, value: metricDef.compute(recs), records: recs }));
    }
    if (config.entityType) {
      const dimension = ENTITY_TO_DIMENSION[config.entityType];
      if (config.widgetType === 'RANKING' || config.analysisMode === 'RANKING') {
        const ranked = computeRankingForEntity(filteredRecords, config.entityType, config.metric, config.rankingDirection || 'best', config.limit || 10, language);
        return ranked.map((r) => ({ key: r.key, label: r.label, value: metricDef.compute(r.records), records: r.records }));
      }
      let aggRows: AggregatedReportRow[] = aggregateByDimension(filteredRecords, dimension, language);
      if (config.widgetType === 'COMPARISON' && config.compareEntityIds && config.compareEntityIds.length > 0) {
        aggRows = aggRows.filter((r) => config.compareEntityIds!.includes(r.key));
      } else {
        aggRows = aggRows.slice(0, config.limit || 10);
      }
      return aggRows.map((r) => ({ key: r.key, label: r.label, value: metricDef.compute(r.records), records: r.records }));
    }
    // No dimension - a single aggregate value (KPI or single-bar chart).
    return [{ key: 'total', label: getMetricLabel(config.metric, language), value: metricDef.compute(filteredRecords), records: filteredRecords }];
  }, [filteredRecords, config, language, metricDef, stageSupported]);

  // Power BI-style cross-filtering (Part 3 §8): when an active cross-filter
  // is compatible with THIS widget's own dimension, narrow the already-
  // computed rows down to the matching one - reusing the aggregation that
  // already ran, never re-querying. An incompatible or absent filter leaves
  // the widget completely unchanged, exactly as specified.
  const isCrossFilterActive = !!crossFilter && crossFilter.sourceWidgetId !== config.widgetId && !!config.entityType && isCrossFilterCompatible(config, crossFilter.entityType);
  const rows: ChartRow[] = isCrossFilterActive ? rowsBeforeCrossFilter.filter((r) => r.key === crossFilter!.key) : rowsBeforeCrossFilter;
  const isThisWidgetTheFilterSource = !!crossFilter && crossFilter.sourceWidgetId === config.widgetId;

  const secondaryValues = useMemo(() => {
    if (!config.secondaryMetrics || config.secondaryMetrics.length === 0) return [];
    return config.secondaryMetrics
      .filter((m) => isMetricSupportedForStage(m, resolved.stageType))
      .map((m) => ({ metric: m, label: getMetricLabel(m, language), value: METRIC_REGISTRY[m].compute(filteredRecords), unit: METRIC_REGISTRY[m].unit }));
  }, [config.secondaryMetrics, filteredRecords, language, resolved.stageType]);

  const title = config.customTitle || `${getMetricLabel(config.metric, language)}${config.entityType ? ` — ${language === 'ar' ? entityLabelAr(config.entityType) : entityLabelEn(config.entityType)}` : ''}`;
  const unitSuffix = metricDef.unit === 'TONS' ? (language === 'ar' ? 'طن' : 't') : metricDef.unit === 'PERCENT' ? '%' : metricDef.unit === 'MINUTES' ? (language === 'ar' ? 'دقيقة' : 'min') : '';

  // Primary click = set the dashboard-wide cross-filter (Power BI behavior).
  // Widgets with no entityType (a plain total) have nothing to cross-filter
  // by, so clicking them is a no-op here - they're still drillable via the
  // dedicated icon button below.
  const handleElementClick = (row: ChartRow) => {
    if (config.entityType && onCrossFilterRequest) {
      onCrossFilterRequest(config.entityType, row.key, row.label, config.widgetId);
    }
  };

  const allVisibleRecords = useMemo(() => rows.flatMap((r) => r.records), [rows]);
  const handleDrillDownClick = () => {
    if (onDrillDown && allVisibleRecords.length > 0) onDrillDown(allVisibleRecords, title);
  };

  return (
    <div className={`bg-white border shadow-xs p-4 flex flex-col h-full min-h-[240px] min-w-0 ${isThisWidgetTheFilterSource ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-slate-200'}`} dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 mb-3">
        <div className="flex items-start gap-1.5 min-w-0">
          {editable && dragHandleProps && (
            <div {...dragHandleProps} className="cursor-grab text-slate-300 hover:text-slate-500 pt-0.5 shrink-0">
              <GripVertical className="w-4 h-4" />
            </div>
          )}
          <div className="min-w-0">
            <h4 className="font-bold text-slate-700 text-sm truncate">{title}</h4>
            <p className="text-[10px] text-slate-400 flex items-center gap-1 flex-wrap">
              {language === 'ar' ? TIME_RANGE_LABELS[config.timeRangePreset === 'inherit' ? globalFilters.timeRangePreset : config.timeRangePreset].ar : TIME_RANGE_LABELS[config.timeRangePreset === 'inherit' ? globalFilters.timeRangePreset : config.timeRangePreset].en}
              {resolved.isOverridden && (
                <span className="text-amber-500 flex items-center gap-0.5" title={language === 'ar' ? 'يستخدم هذا العنصر فلترًا مختلفًا عن فلتر اللوحة العام' : 'This widget uses a filter different from the dashboard-wide filter'}>
                  <Info className="w-2.5 h-2.5" />
                  {language === 'ar' ? 'فلتر مخصص' : 'custom filter'}
                </span>
              )}
              {(isCrossFilterActive || isThisWidgetTheFilterSource) && (
                <span className="text-indigo-600 font-bold flex items-center gap-0.5">
                  <Filter className="w-2.5 h-2.5" />
                  {crossFilter!.label}
                  {onClearCrossFilter && (
                    <button type="button" onClick={onClearCrossFilter} className="cursor-pointer hover:text-indigo-800" title={language === 'ar' ? 'إزالة الفلتر' : 'Clear filter'}><XIcon className="w-2.5 h-2.5" /></button>
                  )}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onDrillDown && (
            <button type="button" onClick={handleDrillDownClick} className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer" title={language === 'ar' ? 'عرض السجلات التفصيلية' : 'View detailed records'}><Search className="w-3.5 h-3.5" /></button>
          )}
          {onDrillThrough && (
            <button type="button" onClick={() => onDrillThrough(config)} className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer" title={language === 'ar' ? 'فتح التقرير الكامل' : 'Open full report'}><FileBarChart2 className="w-3.5 h-3.5" /></button>
          )}
          {editable && onEdit && <button type="button" onClick={onEdit} className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer" title={language === 'ar' ? 'تعديل' : 'Edit'}><Settings2 className="w-3.5 h-3.5" /></button>}
          {editable && onDuplicate && <button type="button" onClick={onDuplicate} className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer" title={language === 'ar' ? 'نسخ' : 'Duplicate'}><Copy className="w-3.5 h-3.5" /></button>}
          {editable && onRemove && <button type="button" onClick={onRemove} className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer" title={language === 'ar' ? 'حذف' : 'Remove'}><Trash2 className="w-3.5 h-3.5" /></button>}
        </div>
      </div>

      <div className="flex-1 min-h-0">
        {!stageSupported ? (
          <EmptyState language={language} text={language === 'ar' ? 'هذا المقياس غير متاح لهذه المرحلة الإنتاجية.' : 'This metric is not available for the selected production stage.'} />
        ) : rows.length === 0 || rows.every((r) => r.value === 0 && r.records.length === 0) ? (
          <EmptyState language={language} text={language === 'ar' ? 'لا توجد بيانات كافية لعرض هذا العنصر.' : 'Not enough data to display this widget.'} />
        ) : config.widgetType === 'KPI_CARD' ? (
          <KpiBody rows={rows} unitSuffix={unitSuffix} secondaryValues={secondaryValues} language={language} onClick={() => rows[0] && handleElementClick(rows[0])} />
        ) : config.widgetType === 'TABLE' || config.chartType === 'TABLE' ? (
          <TableBody rows={rows} unitSuffix={unitSuffix} language={language} onRowClick={handleElementClick} />
        ) : config.chartType === 'RANKING_LIST' ? (
          <RankingListBody rows={rows} unitSuffix={unitSuffix} onClick={handleElementClick} />
        ) : (
          <ChartBody chartType={config.chartType} rows={rows} unitSuffix={unitSuffix} language={language} onClick={handleElementClick} />
        )}
      </div>
    </div>
  );
};

function entityLabelAr(e: string) { return { EMPLOYEE: 'الموظفين', SHIFT: 'الورديات', EQUIPMENT: 'المعدات', PRODUCT: 'المنتجات', CUSTOMER: 'العملاء', STAGE: 'المراحل' }[e] || e; }
function entityLabelEn(e: string) { return { EMPLOYEE: 'Employees', SHIFT: 'Shifts', EQUIPMENT: 'Equipment', PRODUCT: 'Products', CUSTOMER: 'Customers', STAGE: 'Stages' }[e] || e; }

const EmptyState: React.FC<{ language: 'ar' | 'en'; text: string }> = ({ text }) => (
  <div className="h-full flex items-center justify-center text-[11px] text-slate-400 text-center px-4">{text}</div>
);

const KpiBody: React.FC<{ rows: ChartRow[]; unitSuffix: string; secondaryValues: { label: string; value: number; unit: string }[]; language: 'ar' | 'en'; onClick: () => void }> = ({ rows, unitSuffix, secondaryValues, language, onClick }) => {
  const value = rows[0]?.value ?? 0;
  return (
    <div className="h-full flex flex-col justify-center cursor-pointer" onClick={onClick}>
      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-black text-slate-800 font-mono tracking-tight">{formatDecimal(value, 2)}</span>
        {unitSuffix && <span className="text-xs font-semibold text-slate-500">{unitSuffix}</span>}
      </div>
      {secondaryValues.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {secondaryValues.map((s) => (
            <div key={s.label} className="bg-slate-50 rounded px-2 py-1.5 border border-slate-100">
              <p className="text-[9px] text-slate-500 truncate">{s.label}</p>
              <p className="text-xs font-bold text-slate-700 font-mono">{formatDecimal(s.value, 2)}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-slate-400 mt-2">{rows[0]?.records.length ? `${language === 'ar' ? 'عدد السجلات:' : 'Records:'} ${formatNumber(rows[0].records.length)}` : ''}</p>
    </div>
  );
};

const TableBody: React.FC<{ rows: ChartRow[]; unitSuffix: string; language: 'ar' | 'en'; onRowClick: (r: ChartRow) => void }> = ({ rows, unitSuffix, language, onRowClick }) => (
  <div className="h-full overflow-auto">
    <table className="w-full text-[11px]">
      <thead className="bg-slate-50 text-slate-500 uppercase text-[9px]">
        <tr><th className="p-1.5 text-start font-bold">{language === 'ar' ? 'البند' : 'Item'}</th><th className="p-1.5 text-end font-bold">{language === 'ar' ? 'القيمة' : 'Value'}</th></tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.key} className="hover:bg-slate-50 cursor-pointer" onClick={() => onRowClick(r)}>
            <td className="p-1.5 font-medium text-slate-700">{r.label}</td>
            <td className="p-1.5 text-end font-mono font-bold text-slate-800">{formatDecimal(r.value, 2)} {unitSuffix}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const RankingListBody: React.FC<{ rows: ChartRow[]; unitSuffix: string; onClick: (r: ChartRow) => void }> = ({ rows, unitSuffix, onClick }) => {
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);
  return (
    <div className="h-full overflow-auto flex flex-col gap-2 pr-1">
      {rows.map((r, idx) => (
        <div key={r.key} className="cursor-pointer" onClick={() => onClick(r)}>
          <div className="flex justify-between text-[11px] font-bold mb-0.5">
            <span className="text-slate-600 truncate">{idx + 1}. {r.label}</span>
            <span className="text-slate-800 font-mono">{formatDecimal(r.value, 2)} {unitSuffix}</span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, backgroundColor: COLORS[idx % COLORS.length] }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const tooltipStyle = { backgroundColor: '#0f172a', borderRadius: '4px', color: '#fff', fontSize: '11px', border: '1px solid #334155' };

const ChartBody: React.FC<{ chartType: string; rows: ChartRow[]; unitSuffix: string; language: 'ar' | 'en'; onClick: (r: ChartRow) => void }> = ({ chartType, rows, unitSuffix, language, onClick }) => {
  const data = rows.map((r) => ({ ...r, name: r.label }));

  const handleClick = (e: any) => {
    const idx = e?.activeTooltipIndex;
    if (typeof idx === 'number' && rows[idx]) onClick(rows[idx]);
  };

  if (chartType === 'HORIZONTAL_BAR') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 5, bottom: 5 }} onClick={handleClick}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10, fill: '#64748b' }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${formatDecimal(v, 2)} ${unitSuffix}`, '']} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} cursor="pointer">
            {data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === 'LINE' || chartType === 'MULTI_LINE') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }} onClick={handleClick}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${formatDecimal(v, 2)} ${unitSuffix}`, '']} />
          <Line type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3, cursor: 'pointer' }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === 'AREA' || chartType === 'STACKED_AREA') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }} onClick={handleClick}>
          <defs>
            <linearGradient id={`grad-${chartType}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${formatDecimal(v, 2)} ${unitSuffix}`, '']} />
          <Area type="monotone" dataKey="value" stroke="#4f46e5" strokeWidth={2} fill={`url(#grad-${chartType})`} />
        </AreaChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === 'PIE' || chartType === 'DONUT') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <PieChart onClick={handleClick}>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={chartType === 'DONUT' ? '55%' : 0} outerRadius="80%" cursor="pointer">
            {data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${formatDecimal(v, 2)} ${unitSuffix}`, '']} />
          <Legend wrapperStyle={{ fontSize: '10px' }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === 'SCATTER') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis type="category" dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} />
          <YAxis type="number" dataKey="value" tick={{ fontSize: 10, fill: '#64748b' }} />
          <Tooltip contentStyle={tooltipStyle} />
          <Scatter data={data} fill="#4f46e5" cursor="pointer" onClick={handleClick} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === 'RADAR') {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} />
          <PolarRadiusAxis tick={{ fontSize: 8, fill: '#94a3b8' }} />
          <Radar dataKey="value" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.35} />
          <Tooltip contentStyle={tooltipStyle} />
        </RadarChart>
      </ResponsiveContainer>
    );
  }
  if (chartType === 'HEATMAP') {
    return <HeatmapBody rows={rows} language={language} onClick={onClick} />;
  }
  // BAR / GROUPED_BAR / STACKED_BAR / COMBO default
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 5 }} onClick={handleClick}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748b' }} />
        <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${formatDecimal(v, 2)} ${unitSuffix}`, '']} />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} cursor="pointer">
          {data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

/** Lightweight colored-grid Heatmap - recharts has no native heatmap component, so this is a plain CSS grid, kept simple by design (§14 shift x equipment). */
const HeatmapBody: React.FC<{ rows: ChartRow[]; language: 'ar' | 'en'; onClick: (r: ChartRow) => void }> = ({ rows, language, onClick }) => {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="h-full overflow-auto grid grid-cols-2 sm:grid-cols-3 gap-1.5 content-start">
      {rows.map((r) => {
        const intensity = Math.min(1, r.value / max);
        return (
          <div
            key={r.key}
            onClick={() => onClick(r)}
            className="rounded p-2 cursor-pointer text-center"
            style={{ backgroundColor: `rgba(79, 70, 229, ${0.12 + intensity * 0.7})` }}
            title={language === 'ar' ? 'انقر لعرض السجلات' : 'Click to view records'}
          >
            <p className={`text-[10px] font-bold truncate ${intensity > 0.55 ? 'text-white' : 'text-slate-700'}`}>{r.label}</p>
            <p className={`text-xs font-mono font-black ${intensity > 0.55 ? 'text-white' : 'text-slate-800'}`}>{formatDecimal(r.value, 1)}</p>
          </div>
        );
      })}
    </div>
  );
};

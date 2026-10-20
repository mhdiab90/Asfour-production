/**
 * The cross-stage part of the Production Records screen (3.38.0).
 *
 * The screen is no longer tied to pressing: with the stage filter on "all", on one stage, or on a group of
 * stages (all mills, all kilns) it lists the records of EVERY stage - the same normalised records the
 * Dashboard and Reports read (fetchUniversalStageRecords), narrowed by the screen's own filters (period,
 * product, customer, shift, search, cost-centre scope). Only the pressing filter keeps the legacy pressing
 * table, with its own edit / bulk delete.
 *
 * Reading only. A pressing row's edit / delete here opens the legacy dialogs of the screen; the other stages
 * are corrected where they always were (Audit & Approval).
 */
import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertCircle, Download, Edit, RefreshCw, Trash2, FileSearch } from 'lucide-react';
import type { ProductionStageType, UniversalStageRecord } from '../../types';
import { fetchUniversalStageRecords } from '../../services/stageRecordService';
import { ALL_STAGES, filterUniversalRecords, getStageDisplayName, SUB_CENTER_MAIN } from '../../services/reportingEngine';
import { expandStageFilter, includesRotaryKiln } from '../../services/stageFilterGroupsPure';
import { Modal } from '../common/Modal';
import { formatDecimal, formatNumber } from '../../utils/formatters';
import { DASHBOARD_FILTER_SELECT } from '../dashboard/dashboardFilterStyles';

export interface AllStagesRecordsSectionProps {
  language: 'ar' | 'en';
  startDate: string;
  endDate: string;
  /** 'all', a stage id, or a stage group id (see stageFilterGroupsPure). */
  stageValue: string;
  productId: string;
  customerId: string;
  shiftId: string;
  searchQuery: string;
  /** The cost-centre selection resolved to equipment ids; null = none selected. */
  hierarchyScope: Set<string> | null;
  /** Pressing rows only: open the legacy edit / delete dialogs the screen already has. */
  onEditPressing?: (id: string) => void;
  onDeletePressing?: (id: string) => void;
}

const SOURCE_ODOO = 'odoo';

/** The machine / centre a record ran on, wherever its stage keeps it. */
export function recordEquipmentLabel(r: UniversalStageRecord): string {
  const d = (r.rawData ?? {}) as Record<string, any>;
  return String(d.subCenterName || d.pressName || d.furnaceName || d.machineName || d.millName || d.equipmentName || d.workCenterName || d.workCenter?.equipmentName || d.workCenter?.mainCenterNameAr || '').trim();
}

export function isOdooRecord(r: UniversalStageRecord): boolean {
  const d = (r.rawData ?? {}) as Record<string, any>;
  return Boolean(d.identityKey || d.provenance?.importSessionId || (Array.isArray(d.externalRefs) && d.externalRefs.some((x: any) => String(x?.system).toLowerCase() === SOURCE_ODOO)));
}

export const AllStagesRecordsSection: React.FC<AllStagesRecordsSectionProps> = ({
  language, startDate, endDate, stageValue, productId, customerId, shiftId, searchQuery, hierarchyScope, onEditPressing, onDeletePressing,
}) => {
  const isAr = language === 'ar';
  const [records, setRecords] = useState<UniversalStageRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subCenter, setSubCenter] = useState('');
  const [details, setDetails] = useState<UniversalStageRecord | null>(null);
  const [reload, setReload] = useState(0);

  const stages = useMemo(() => expandStageFilter(stageValue, ALL_STAGES), [stageValue]);
  // One stage is pushed down to the query; a group is fetched with all stages and narrowed here.
  const queryStage: ProductionStageType | 'all' = stages && stages.length === 1 ? stages[0] : 'all';

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    fetchUniversalStageRecords({ startDate: startDate || undefined, endDate: endDate || undefined, stageType: queryStage })
      .then((data) => { if (!cancelled) setRecords(data); })
      .catch((err) => { if (!cancelled) setLoadError(String(err?.message ?? err)); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [startDate, endDate, queryStage, reload]);

  useEffect(() => { if (!includesRotaryKiln(stageValue)) setSubCenter(''); }, [stageValue]);

  const shown = useMemo(() => {
    const base = filterUniversalRecords(records, {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      stageTypes: stages ?? undefined,
      productId: productId !== 'all' ? productId : undefined,
      customerId: customerId !== 'all' ? customerId : undefined,
      shiftId: shiftId !== 'all' ? shiftId : undefined,
      subCenterId: subCenter || undefined,
    }, hierarchyScope);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((r) => [r.productCode, r.productName, r.customerName, r.stageNameAr, recordEquipmentLabel(r), ...(r.workers ?? []).map((w) => w.employeeName)]
      .some((v) => String(v ?? '').toLowerCase().includes(q)));
  }, [records, startDate, endDate, stages, productId, customerId, shiftId, subCenter, hierarchyScope, searchQuery]);

  const totals = useMemo(() => {
    const production = shown.reduce((s, r) => s + (r.productionTons || 0), 0);
    const good = shown.reduce((s, r) => s + (r.goodTons || 0), 0);
    const waste = shown.reduce((s, r) => s + (r.wasteTons || 0), 0);
    const downtime = shown.reduce((s, r) => s + (r.totalDowntimeMinutes || 0), 0);
    return { production, good, waste, downtime, wastePct: production > 0 ? (waste / production) * 100 : 0 };
  }, [shown]);

  const exportRows = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(shown.map((r) => ({
      'التاريخ': r.date, 'المرحلة': getStageDisplayName(r.stageType, 'ar'), 'المعدة / المركز': recordEquipmentLabel(r),
      'كود المنتج': r.productCode ?? '', 'المنتج': r.productName ?? '', 'العميل': r.customerName ?? '',
      'الكمية': r.quantity, 'الوحدة': r.unit, 'الإنتاج (طن)': r.productionTons ?? '', 'السليم (طن)': r.goodTons ?? '', 'الهالك (طن)': r.wasteTons ?? '',
      'التوقف (دقيقة)': r.totalDowntimeMinutes ?? 0, 'العمال': (r.workers ?? []).map((w) => w.employeeName).join(' ، '),
      'الحالة': r.status, 'المصدر': isOdooRecord(r) ? 'استيراد أودو' : 'إدخال',
    }))), 'records');
    XLSX.writeFile(wb, `production-records-all-stages-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const cell = 'px-3 py-2.5';
  return (
    <div id="all-stages-records" className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">{isAr ? 'عدد السجلات' : 'Records'}</span>
          <span id="all-stages-count" className="text-xl font-extrabold text-slate-900">{formatNumber(shown.length)}</span>
        </div>
        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">{isAr ? 'إجمالي الإنتاج (طن)' : 'Total production (t)'}</span>
          <span className="text-xl font-extrabold text-slate-900">{formatDecimal(totals.production, 2)}</span>
          <span className="text-[10px] text-emerald-600 font-semibold block">{isAr ? `سليم: ${formatDecimal(totals.good, 2)} طن` : `Good: ${formatDecimal(totals.good, 2)} t`}</span>
        </div>
        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">{isAr ? 'متوسط نسبة الهالك' : 'Average waste rate'}</span>
          <span className={`text-xl font-extrabold ${totals.wastePct > 5 ? 'text-rose-600' : 'text-amber-600'}`}>{formatDecimal(totals.wastePct, 2)}%</span>
          <span className="text-[10px] text-rose-600 font-semibold block">{isAr ? `هالك: ${formatDecimal(totals.waste, 2)} طن` : `Waste: ${formatDecimal(totals.waste, 2)} t`}</span>
        </div>
        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">{isAr ? 'إجمالي وقت التوقف' : 'Total downtime'}</span>
          <span className="text-xl font-extrabold text-slate-900">{(totals.downtime / 60).toFixed(1)}</span>
          <span className="text-xs text-slate-500"> {isAr ? 'ساعة' : 'hr'}</span>
        </div>
      </div>
      <p className="text-[10px] text-slate-500 font-bold">
        {isAr ? 'الأرقام بالطن تشمل السجلات التي تُسجَّل بالطن، ومراحل عدّ القطع تظهر كميتها في عمود الكمية بوحدتها (لا تُحوَّل ولا تُجمع مع الطن).' : 'Tonnage covers records kept in tons; piece-counting stages show their quantity in the quantity column in their own unit (never converted or added to tons).'}
      </p>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center gap-3 text-xs">
          {includesRotaryKiln(stageValue) && (
            <label className="flex items-center gap-1.5 font-bold text-slate-600">
              {isAr ? 'المركز التابع للفرن الدوار' : 'Rotary kiln sub-centre'}
              <select id="all-stages-sub-center" value={subCenter} onChange={(e) => setSubCenter(e.target.value)} className={`${DASHBOARD_FILTER_SELECT}`}>
                <option value="">{isAr ? 'كل المراكز' : 'All centres'}</option>
                <option value={SUB_CENTER_MAIN}>{isAr ? 'الفرن الدوار نفسه' : 'The rotary kiln itself'}</option>
                <option value="rotary_shakers">{isAr ? 'الهزازات' : 'Shakers'}</option>
                <option value="rotary_crushers">{isAr ? 'الكسارات' : 'Crushers'}</option>
              </select>
            </label>
          )}
          {hierarchyScope && (
            <span className="font-bold text-amber-700">
              {hierarchyScope.size === 0
                ? (isAr ? 'المراكز المختارة بلا معدات مرتبطة بها.' : 'The selected cost centres have no linked equipment.')
                : (isAr ? `نطاق مراكز التكاليف: ${hierarchyScope.size} معدة (السجلات غير المرتبطة بمعدة لا تظهر).` : `Cost-centre scope: ${hierarchyScope.size} equipment record(s) (records not tied to equipment are not shown).`)}
            </span>
          )}
          <div className="flex-grow" />
          <button type="button" onClick={() => setReload((n) => n + 1)} className="flex items-center gap-1.5 px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" />{isAr ? 'تحديث' : 'Refresh'}
          </button>
          <button id="all-stages-export" type="button" onClick={exportRows} disabled={shown.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer">
            <Download className="w-3.5 h-3.5" />{isAr ? 'تصدير Excel' : 'Export Excel'}
          </button>
        </div>

        {isLoading ? (
          <div className="py-16 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
            <p className="text-xs font-semibold">{isAr ? 'جارٍ تحميل سجلات كل المراحل...' : 'Loading records of every stage...'}</p>
          </div>
        ) : loadError ? (
          <div className="py-12 text-center text-rose-700 text-xs font-bold">{loadError}</div>
        ) : shown.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">{isAr ? 'لا توجد سجلات مطابقة للشروط المحددة' : 'No records match the selected criteria'}</p>
            <p className="text-xs text-slate-400 mt-1">{isAr ? 'جرّب تغيير الفترة أو المرحلة - السجلات المستوردة من أودو تواريخها تاريخية.' : 'Try another period or stage - records imported from Odoo carry historical dates.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
            <table id="all-stages-table" className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold sticky top-0">
                <tr>
                  <th className={cell}>{isAr ? 'التاريخ' : 'Date'}</th>
                  <th className={cell}>{isAr ? 'المرحلة' : 'Stage'}</th>
                  <th className={cell}>{isAr ? 'المعدة / المركز' : 'Equipment / centre'}</th>
                  <th className={cell}>{isAr ? 'المنتج' : 'Product'}</th>
                  <th className={cell}>{isAr ? 'الكمية' : 'Quantity'}</th>
                  <th className={cell}>{isAr ? 'الإنتاج (طن) / الهالك' : 'Production (t) / waste'}</th>
                  <th className={cell}>{isAr ? 'العمال' : 'Workers'}</th>
                  <th className={cell}>{isAr ? 'الحالة' : 'Status'}</th>
                  <th className={`${cell} text-center`}>{isAr ? 'إجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {shown.slice(0, 500).map((r) => (
                  <tr key={`${r.stageType}-${r.id}`} className="hover:bg-slate-50/80">
                    <td className={`${cell} font-mono font-bold text-slate-900`}>{r.date}</td>
                    <td className={cell}>{getStageDisplayName(r.stageType, language)}{isOdooRecord(r) && <span className="ms-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 border border-violet-200 text-violet-800 font-bold">Odoo</span>}</td>
                    <td className={cell}>{recordEquipmentLabel(r) || '-'}</td>
                    <td className={cell}><div className="font-bold text-slate-900">{r.productName || '-'}</div><div className="text-[10px] text-slate-500 font-mono">{r.productCode}</div></td>
                    <td className={`${cell} font-mono`}>{formatNumber(r.quantity)} <span className="text-slate-500">{r.unit}</span></td>
                    <td className={`${cell} font-mono`}>{r.productionTons ? formatDecimal(r.productionTons, 3) : '-'}{r.wasteTons ? <span className="text-rose-600"> / {formatDecimal(r.wasteTons, 3)}</span> : null}</td>
                    <td className={cell}>{(r.workers ?? []).length > 0 ? (r.workers ?? []).map((w) => w.employeeName).filter(Boolean).slice(0, 3).join('، ') + ((r.workers ?? []).length > 3 ? ` +${(r.workers ?? []).length - 3}` : '') : '-'}</td>
                    <td className={cell}>{r.status}</td>
                    <td className={`${cell} text-center`}>
                      <div className="flex items-center justify-center gap-1">
                        <button type="button" onClick={() => setDetails(r)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer" title={isAr ? 'تفاصيل' : 'Details'}><FileSearch className="w-3.5 h-3.5" /></button>
                        {r.stageType === 'pressing' && onEditPressing && (
                          <button type="button" onClick={() => onEditPressing(r.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer" title={isAr ? 'تعديل' : 'Edit'}><Edit className="w-3.5 h-3.5" /></button>
                        )}
                        {r.stageType === 'pressing' && onDeletePressing && (
                          <button type="button" onClick={() => onDeletePressing(r.id)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer" title={isAr ? 'حذف' : 'Delete'}><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 500 && <p className="px-4 py-2 text-[10px] text-slate-500 font-bold">{isAr ? `أول 500 من ${shown.length} معروضة - ضيّق الفلاتر أو صدّر Excel للكل.` : `The first 500 of ${shown.length} are shown - narrow the filters or export all to Excel.`}</p>}
          </div>
        )}
      </div>

      <Modal
        isOpen={!!details}
        onClose={() => setDetails(null)}
        title={details ? `${getStageDisplayName(details.stageType, language)} - ${details.date}` : ''}
        subtitle={details ? `${details.productName ?? ''} ${details.productCode ? `(${details.productCode})` : ''}` : ''}
        maxWidth="lg"
      >
        {details && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              {[
                [isAr ? 'المعدة / المركز' : 'Equipment / centre', recordEquipmentLabel(details) || '-'],
                [isAr ? 'الكمية' : 'Quantity', `${formatNumber(details.quantity)} ${details.unit}`],
                [isAr ? 'الإنتاج (طن)' : 'Production (t)', details.productionTons != null ? formatDecimal(details.productionTons, 3) : '-'],
                [isAr ? 'الهالك (طن)' : 'Waste (t)', details.wasteTons != null ? formatDecimal(details.wasteTons, 3) : '-'],
                [isAr ? 'التوقف (دقيقة)' : 'Downtime (min)', String(details.totalDowntimeMinutes ?? 0)],
                [isAr ? 'العميل' : 'Customer', details.customerName || '-'],
                [isAr ? 'الحالة' : 'Status', details.status],
                [isAr ? 'المصدر' : 'Source', isOdooRecord(details) ? (isAr ? 'استيراد أودو' : 'Odoo import') : (isAr ? 'إدخال مباشر' : 'Direct entry')],
              ].map(([k, v]) => (<div key={String(k)} className="p-2 rounded-lg bg-slate-50 border border-slate-200"><div className="text-[10px] text-slate-500 font-bold">{k}</div><div className="font-bold text-slate-900">{v}</div></div>))}
            </div>
            {(details.workers ?? []).length > 0 && (
              <div><p className="font-black text-slate-800 mb-1">{isAr ? 'العمال' : 'Workers'}</p><p>{(details.workers ?? []).map((w) => w.employeeName).filter(Boolean).join(' ، ')}</p></div>
            )}
            {(details.materials ?? []).length > 0 && (
              <div>
                <p className="font-black text-slate-800 mb-1">{isAr ? 'المكوّنات المستهلكة' : 'Consumed components'}</p>
                <ul className="space-y-0.5">{(details.materials ?? []).map((m: any, i) => (<li key={i} className="font-mono">{m.itemCode || m.materialCode || m.productCode} - {m.quantity} {m.unit}</li>))}</ul>
              </div>
            )}
            {Array.isArray((details.rawData as any)?.unattachedComponents) && (details.rawData as any).unattachedComponents.length > 0 && (
              <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                <p className="font-black text-amber-900 mb-1">{isAr ? 'مكوّنات لم تُرفق بالسجل (محفوظة بسببها)' : 'Components not attached to the record (kept with the reason)'}</p>
                <ul className="space-y-0.5">{((details.rawData as any).unattachedComponents as any[]).map((u, i) => (<li key={i} className="font-mono">{u.itemCode}: {u.quantity ?? '-'} - {u.reason}</li>))}</ul>
              </div>
            )}
            <p className="text-[10px] text-slate-500 font-bold">{isAr ? 'تصحيح سجلات المراحل غير الكبس يتم من "التدقيق والاعتماد".' : 'Records of stages other than pressing are corrected in Audit & Approval.'}</p>
          </div>
        )}
      </Modal>
    </div>
  );
};

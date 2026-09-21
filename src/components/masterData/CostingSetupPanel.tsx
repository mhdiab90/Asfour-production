/**
 * Costing setup - Phase 1 Step 8C. Opened from Master Data, beside the cost
 * centre hierarchy: one small panel, not a second Costing application.
 *
 * Two settings the factory must own before any costing runs:
 *   PERIODS       any window (a month, six months, a year - two dates), with the
 *                 lifecycle OPEN -> CALCULATED -> REVIEWED -> APPROVED -> CLOSED.
 *                 A closed period is read-only here; reopening asks for a reason
 *                 and starts a new calculation version.
 *   ALLOCATION    which source cost centre gives cost to which target, by an
 *                 explicit percentage or by a driver (and the SOURCE that
 *                 driver's value comes from), in which step-down order, during
 *                 which window. The same centre can use another driver in a
 *                 later period; the old row stays as it was.
 *
 * NOTHING IS CALCULATED HERE. No amount, no allocation, no cost. Where a driver's
 * data does not exist in this system yet, the panel says so instead of implying
 * a value.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, Info, Loader2, Plus, RefreshCw, Share2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from '../../services/masterDataService';
import {
  COSTING_PERIOD_STATUSES,
  COSTING_PERIOD_TYPES,
  isCostingPeriodClosed,
} from '../../services/costingPeriodPure';
import {
  ALLOCATION_METHODS,
  COST_DRIVERS,
  DRIVER_ALLOWED_SOURCES,
  DRIVER_SOURCES,
  driverSourceAvailability,
} from '../../services/costingSetupPure';
import {
  listAllocationSetups,
  listCostingPeriods,
  reopenCostingPeriod,
  saveAllocationSetup,
  saveCostingPeriod,
  transitionCostingPeriod,
} from '../../services/costingSetupService';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** The existing Master Data edit gate, decided by the caller. */
  canEdit: boolean;
}

const NEXT_STATUS: Record<string, string> = { OPEN: 'CALCULATED', CALCULATED: 'REVIEWED', REVIEWED: 'APPROVED', APPROVED: 'CLOSED' };

export const CostingSetupPanel: React.FC<Props> = ({ isOpen, onClose, canEdit }) => {
  const { language } = useLanguage();
  const { adminUser } = useAuth();
  const isAr = language === 'ar';
  const [tab, setTab] = useState<'periods' | 'allocation'>('periods');
  const [periods, setPeriods] = useState<any[]>([]);
  const [setups, setSetups] = useState<any[]>([]);
  const [costCenters, setCostCenters] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodDraft, setPeriodDraft] = useState<any | null>(null);
  const [setupDraft, setSetupDraft] = useState<any | null>(null);

  const load = useCallback(async (skipCache = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const [p, s, cc] = await Promise.all([
        listCostingPeriods({ skipCache }),
        listAllocationSetups({ skipCache }),
        fetchMasterData<any>(MASTER_DATA_COLLECTIONS.costCenterHierarchy).catch(() => []),
      ]);
      p.sort((a, b) => String(b.startDate ?? '').localeCompare(String(a.startDate ?? '')));
      s.sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0));
      setPeriods(p);
      setSetups(s);
      setCostCenters(cc ?? []);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setPeriodDraft(null);
      setSetupDraft(null);
      void load();
    }
  }, [isOpen, load]);

  const run = async (action: () => Promise<void>) => {
    if (!canEdit) return;
    setIsBusy(true);
    setError(null);
    try {
      await action();
      await load(true);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsBusy(false);
    }
  };

  const actor = () => ({ userId: adminUser?.uid ?? adminUser?.email ?? null, at: new Date().toISOString() });
  const costCenterCodes = useMemo(() => costCenters.map((c) => String(c.sheet1Code ?? c.code ?? '')).filter(Boolean), [costCenters]);
  const knownCostCenterCodes = useMemo(() => (costCenterCodes.length ? new Set(costCenterCodes) : null), [costCenterCodes]);
  const input = 'w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs';
  const centreLabel = (code: string) => {
    const node = costCenters.find((c) => String(c.sheet1Code ?? c.code ?? '') === code);
    return node ? `${code} - ${node.nameAr ?? node.name ?? ''}` : code;
  };

  const savePeriod = () => run(async () => {
    const stored = periodDraft?.id ? periods.find((p) => p.id === periodDraft.id) ?? null : null;
    await saveCostingPeriod(periods, stored, periodDraft, language === 'ar' ? 'ar' : 'en');
    setPeriodDraft(null);
  });

  const saveSetup = () => run(async () => {
    const stored = setupDraft?.id ? setups.find((s) => s.id === setupDraft.id) ?? null : null;
    await saveAllocationSetup(setups, stored, setupDraft, { knownCostCenterCodes }, language === 'ar' ? 'ar' : 'en');
    setSetupDraft(null);
  });

  const advance = (period: any) => run(async () => {
    await transitionCostingPeriod(period, NEXT_STATUS[String(period.status ?? 'OPEN').toUpperCase()] ?? 'CALCULATED', actor(), language === 'ar' ? 'ar' : 'en');
  });

  const reopen = (period: any) => {
    const reason = window.prompt(isAr ? 'سبب إعادة فتح الفترة (إلزامي):' : 'Reason for reopening this period (required):');
    if (!reason || !reason.trim()) return;
    return run(async () => {
      await reopenCostingPeriod(period, reason, actor(), language === 'ar' ? 'ar' : 'en');
    });
  };

  return (
    <Modal
      id="costing-setup-panel"
      isOpen={isOpen}
      onClose={() => { if (!isBusy) onClose(); }}
      title={isAr ? 'إعداد التكاليف' : 'Costing setup'}
      subtitle={isAr ? 'فترات التكلفة وقواعد توزيع مراكز التكلفة - إعداد فقط، بدون أي حساب' : 'Costing periods and cost-centre allocation rules - configuration only, nothing is calculated'}
      maxWidth="4xl"
    >
      <div className="space-y-4 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 text-sky-900">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="font-semibold leading-relaxed">
            {isAr
              ? 'هذه الشاشة إعداد فقط: لا تحسب تكلفة ولا توزع مبالغ. الفترة المقفلة لا تتغير - إعادة الفتح توثَّق وتنشئ إصدار حساب جديد. النِسب والمحركات إعداد قابل للتغيير لكل فترة، وليست قواعد داخل الكود.'
              : 'Configuration only: nothing here calculates or allocates money. A closed period never changes - reopening is recorded and starts a new calculation version. Percentages and drivers are configuration per period, never rules inside the code.'}
          </p>
        </div>

        {error && <p className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold text-rose-800">{error}</p>}

        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setTab('periods')} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold cursor-pointer ${tab === 'periods' ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-700'}`}>
            <CalendarRange className="w-3.5 h-3.5" />{isAr ? 'فترات التكلفة' : 'Costing periods'}
          </button>
          <button type="button" onClick={() => setTab('allocation')} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold cursor-pointer ${tab === 'allocation' ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-700'}`}>
            <Share2 className="w-3.5 h-3.5" />{isAr ? 'توزيع مراكز التكلفة' : 'Cost-centre allocation'}
          </button>
          <button type="button" onClick={() => void load(true)} disabled={isLoading} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer ms-auto" title={isAr ? 'تحديث' : 'Refresh'}>
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {tab === 'periods' && (
          <div className="space-y-3">
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table id="costing-period-list" className="w-full text-[11px] min-w-[720px]">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-start px-3 py-2">{isAr ? 'الكود' : 'Code'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'الاسم' : 'Name'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'النوع' : 'Type'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'من - إلى' : 'From - To'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'الحالة' : 'Status'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'إصدار الحساب' : 'Calc. version'}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {periods.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">{isLoading ? '...' : (isAr ? 'لا توجد فترات بعد' : 'No periods yet')}</td></tr>}
                  {periods.map((p) => {
                    const closed = isCostingPeriodClosed(p);
                    return (
                      <tr key={p.id} className={periodDraft?.id === p.id ? 'bg-amber-50' : ''}>
                        <td className="px-3 py-2 font-mono font-bold">{p.code}</td>
                        <td className="px-3 py-2">{p.name}</td>
                        <td className="px-3 py-2">{p.periodType}</td>
                        <td className="px-3 py-2 font-mono">{p.startDate} → {p.endDate}</td>
                        <td className="px-3 py-2"><Badge variant={closed ? 'neutral' : p.status === 'APPROVED' ? 'success' : 'warning'}>{p.status}</Badge></td>
                        <td className="px-3 py-2 font-mono">v{p.calculationVersion ?? 1}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" onClick={() => setPeriodDraft({ ...p })} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold cursor-pointer">
                              {canEdit && !closed ? (isAr ? 'تعديل' : 'Edit') : (isAr ? 'عرض' : 'View')}
                            </button>
                            {canEdit && !closed && (
                              <button type="button" disabled={isBusy} onClick={() => void advance(p)} className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 hover:bg-emerald-200 font-bold cursor-pointer disabled:opacity-50">
                                {NEXT_STATUS[String(p.status ?? 'OPEN').toUpperCase()] ?? '-'}
                              </button>
                            )}
                            {canEdit && closed && (
                              <button id="costing-period-reopen" type="button" disabled={isBusy} onClick={() => void reopen(p)} className="px-2 py-1 rounded-lg bg-amber-100 text-amber-900 hover:bg-amber-200 font-bold cursor-pointer disabled:opacity-50">
                                {isAr ? 'إعادة فتح موثقة' : 'Audited reopen'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {canEdit && (
              <button id="costing-period-add" type="button" onClick={() => setPeriodDraft({ code: '', name: '', periodType: 'MONTH', startDate: '', endDate: '', status: 'OPEN', calculationVersion: 1, notes: '', active: true })} className="inline-flex items-center gap-1.5 px-3 py-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
                <Plus className="w-3.5 h-3.5" />{isAr ? 'فترة جديدة' : 'New period'}
              </button>
            )}

            {periodDraft && (
              <div id="costing-period-form" className="border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'الكود *' : 'Code *'}</span>
                    <input value={periodDraft.code ?? ''} onChange={(e) => setPeriodDraft({ ...periodDraft, code: e.target.value })} className={`${input} font-mono`} />
                  </label>
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'الاسم *' : 'Name *'}</span>
                    <input value={periodDraft.name ?? ''} onChange={(e) => setPeriodDraft({ ...periodDraft, name: e.target.value })} className={input} />
                  </label>
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'النوع' : 'Type'}</span>
                    <select value={periodDraft.periodType ?? 'MONTH'} onChange={(e) => setPeriodDraft({ ...periodDraft, periodType: e.target.value })} className={input}>
                      {COSTING_PERIOD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'من *' : 'From *'}</span>
                    <input type="date" value={periodDraft.startDate ?? ''} onChange={(e) => setPeriodDraft({ ...periodDraft, startDate: e.target.value })} className={input} />
                  </label>
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'إلى *' : 'To *'}</span>
                    <input type="date" value={periodDraft.endDate ?? ''} onChange={(e) => setPeriodDraft({ ...periodDraft, endDate: e.target.value })} className={input} />
                  </label>
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'الحالة' : 'Status'}</span>
                    <select disabled value={periodDraft.status ?? 'OPEN'} className={input}>
                      {COSTING_PERIOD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block space-y-1"><span className="font-bold text-slate-600">{isAr ? 'ملاحظات' : 'Notes'}</span>
                  <input value={periodDraft.notes ?? ''} onChange={(e) => setPeriodDraft({ ...periodDraft, notes: e.target.value })} className={input} />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setPeriodDraft(null)} className="px-3 py-1.5 font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">{isAr ? 'إلغاء' : 'Cancel'}</button>
                  {canEdit && (
                    <button id="costing-period-save" type="button" disabled={isBusy} onClick={() => void savePeriod()} className="inline-flex items-center gap-1.5 px-4 py-2 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50">
                      {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{isAr ? 'حفظ الفترة' : 'Save period'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'allocation' && (
          <div className="space-y-3">
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table id="allocation-setup-list" className="w-full text-[11px] min-w-[860px]">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="text-start px-3 py-2">{isAr ? 'الترتيب' : 'Seq'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'من مركز' : 'Source centre'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'إلى مركز' : 'Target centre'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'الطريقة' : 'Method'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'المحرك / المصدر' : 'Driver / source'}</th>
                    <th className="text-start px-3 py-2">{isAr ? 'الفترة' : 'Window'}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {setups.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-slate-400">{isLoading ? '...' : (isAr ? 'لا توجد قواعد توزيع بعد' : 'No allocation rules yet')}</td></tr>}
                  {setups.map((s) => {
                    const availability = s.method === 'DRIVER_BASED' ? driverSourceAvailability(s.driver, s.driverSource) : null;
                    return (
                      <tr key={s.id} className={setupDraft?.id === s.id ? 'bg-amber-50' : ''}>
                        <td className="px-3 py-2 font-mono font-bold">{s.sequence ?? '-'}</td>
                        <td className="px-3 py-2">{centreLabel(String(s.sourceCostCenterCode ?? ''))}</td>
                        <td className="px-3 py-2">{centreLabel(String(s.targetCostCenterCode ?? ''))}</td>
                        <td className="px-3 py-2">{s.method}{s.method === 'PERCENTAGE' ? ` ${s.percentage ?? '-'}%` : ''}</td>
                        <td className="px-3 py-2">
                          {s.method === 'DRIVER_BASED' ? (
                            <>
                              <div className="font-mono">{s.driver} / {s.driverSource}</div>
                              {availability && availability.availability !== 'AVAILABLE' && (
                                <div className={availability.availability === 'NOT_AVAILABLE' ? 'text-rose-700 font-bold' : 'text-amber-700'}>
                                  {availability.availability === 'NOT_AVAILABLE' ? (isAr ? 'مصدر المحرك غير متاح' : 'DRIVER SOURCE NOT AVAILABLE') : (isAr ? 'المصدر متاح جزئيًا' : 'Source partially available')}
                                  : {isAr ? availability.noteAr : availability.noteEn}
                                </div>
                              )}
                            </>
                          ) : '-'}
                        </td>
                        <td className="px-3 py-2 font-mono">{s.effectiveFrom || '-'} → {s.effectiveTo || '-'}</td>
                        <td className="px-3 py-2 text-end">
                          <button type="button" onClick={() => setSetupDraft({ ...s })} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold cursor-pointer">
                            {canEdit ? (isAr ? 'تعديل' : 'Edit') : (isAr ? 'عرض' : 'View')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {canEdit && (
              <button id="allocation-setup-add" type="button" onClick={() => setSetupDraft({ sourceCostCenterCode: '', targetCostCenterCode: '', method: 'DRIVER_BASED', driver: 'PRODUCTION_TONS', driverSource: 'PRODUCTION_RECORDS', percentage: '', sequence: setups.length + 1, effectiveFrom: '', effectiveTo: '', notes: '', active: true })} className="inline-flex items-center gap-1.5 px-3 py-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
                <Plus className="w-3.5 h-3.5" />{isAr ? 'قاعدة توزيع جديدة' : 'New allocation rule'}
              </button>
            )}

            {setupDraft && (
              <div id="allocation-setup-form" className="border border-slate-200 rounded-xl p-3 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'مركز التكلفة المصدر *' : 'Source cost centre *'}</span>
                    <input list="costing-setup-centres" value={setupDraft.sourceCostCenterCode ?? ''} onChange={(e) => setSetupDraft({ ...setupDraft, sourceCostCenterCode: e.target.value })} className={`${input} font-mono`} />
                  </label>
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'مركز التكلفة المستهدف *' : 'Target cost centre *'}</span>
                    <input list="costing-setup-centres" value={setupDraft.targetCostCenterCode ?? ''} onChange={(e) => setSetupDraft({ ...setupDraft, targetCostCenterCode: e.target.value })} className={`${input} font-mono`} />
                  </label>
                  <datalist id="costing-setup-centres">
                    {costCenterCodes.map((c) => <option key={c} value={c}>{centreLabel(c)}</option>)}
                  </datalist>
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'ترتيب التوزيع *' : 'Sequence *'}</span>
                    <input type="number" min="1" step="1" value={setupDraft.sequence ?? ''} onChange={(e) => setSetupDraft({ ...setupDraft, sequence: e.target.value })} className={`${input} font-mono`} />
                  </label>
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'الطريقة *' : 'Method *'}</span>
                    <select value={setupDraft.method ?? 'DRIVER_BASED'} onChange={(e) => setSetupDraft({ ...setupDraft, method: e.target.value })} className={input}>
                      {ALLOCATION_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </label>
                  {setupDraft.method === 'PERCENTAGE' ? (
                    <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'النسبة % *' : 'Percentage % *'}</span>
                      <input type="number" step="any" min="0" max="100" value={setupDraft.percentage ?? ''} onChange={(e) => setSetupDraft({ ...setupDraft, percentage: e.target.value })} className={`${input} font-mono`} />
                    </label>
                  ) : (
                    <>
                      <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'المحرك *' : 'Driver *'}</span>
                        <select value={setupDraft.driver ?? ''} onChange={(e) => setSetupDraft({ ...setupDraft, driver: e.target.value, driverSource: (DRIVER_ALLOWED_SOURCES[e.target.value as keyof typeof DRIVER_ALLOWED_SOURCES] ?? DRIVER_SOURCES)[0] })} className={input}>
                          {COST_DRIVERS.map((d) => <option key={d} value={d}>{d}</option>)}
                        </select>
                      </label>
                      <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'مصدر بيانات المحرك *' : 'Driver source *'}</span>
                        <select value={setupDraft.driverSource ?? ''} onChange={(e) => setSetupDraft({ ...setupDraft, driverSource: e.target.value })} className={input}>
                          {(DRIVER_ALLOWED_SOURCES[setupDraft.driver as keyof typeof DRIVER_ALLOWED_SOURCES] ?? DRIVER_SOURCES).map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </label>
                    </>
                  )}
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'يسري من' : 'Effective from'}</span>
                    <input type="date" value={setupDraft.effectiveFrom ?? ''} onChange={(e) => setSetupDraft({ ...setupDraft, effectiveFrom: e.target.value })} className={input} />
                  </label>
                  <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'يسري حتى' : 'Effective to'}</span>
                    <input type="date" value={setupDraft.effectiveTo ?? ''} onChange={(e) => setSetupDraft({ ...setupDraft, effectiveTo: e.target.value })} className={input} />
                  </label>
                </div>
                {setupDraft.method === 'DRIVER_BASED' && (() => {
                  const a = driverSourceAvailability(setupDraft.driver, setupDraft.driverSource);
                  return a.availability === 'AVAILABLE' ? null : (
                    <p className={`px-2.5 py-2 rounded-lg border font-bold ${a.availability === 'NOT_AVAILABLE' ? 'bg-rose-50 border-rose-200 text-rose-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                      {a.availability === 'NOT_AVAILABLE' ? (isAr ? 'مصدر المحرك غير متاح - يمكن حفظ الإعداد، لكن لا توجد بيانات لقراءته منها بعد.' : 'DRIVER SOURCE NOT AVAILABLE - the rule can be saved, but nothing supplies this value yet.') : (isAr ? 'المصدر متاح جزئيًا.' : 'The source is partially available.')}
                      {' '}{isAr ? a.noteAr : a.noteEn}
                    </p>
                  );
                })()}
                <label className="block space-y-1"><span className="font-bold text-slate-600">{isAr ? 'ملاحظات' : 'Notes'}</span>
                  <input value={setupDraft.notes ?? ''} onChange={(e) => setSetupDraft({ ...setupDraft, notes: e.target.value })} className={input} />
                </label>
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setSetupDraft(null)} className="px-3 py-1.5 font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">{isAr ? 'إلغاء' : 'Cancel'}</button>
                  {canEdit && (
                    <button id="allocation-setup-save" type="button" disabled={isBusy} onClick={() => void saveSetup()} className="inline-flex items-center gap-1.5 px-4 py-2 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50">
                      {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}{isAr ? 'حفظ القاعدة' : 'Save rule'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

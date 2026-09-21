/**
 * Approved Operation Master seed - opened from Master Data -> Operations.
 *
 * Not a second operations manager: it only creates the 13 approved operations
 * that are missing, and after that every operation is maintained in the
 * Operations table like any other setup record.
 *
 * Safe by construction (operationSeedPure.ts): it previews the plan against the
 * stored collection, never overwrites or deletes, reports code and legacy-stage
 * conflicts instead of resolving them, re-reads the collection immediately
 * before writing, and creates through the existing audited createMasterDataItem
 * as the signed-in user - so firestore.rules (admin write) and the audit log
 * apply exactly as for a manual Add. Running it again creates nothing.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../i18n/LanguageContext';
import { fetchMasterData, createMasterDataItem, MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import {
  executeOperationSeed,
  planOperationSeed,
  OperationSeedExecution,
  OperationSeedOutcome,
  OperationSeedPlan,
} from '../../services/operationSeedPure';

interface OperationSeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The existing Master Data create permission - decided by the caller. */
  canSeed: boolean;
}

const OUTCOME_LABELS: Record<OperationSeedOutcome, { ar: string; en: string; tone: string }> = {
  CREATE: { ar: 'سيتم الإنشاء', en: 'Create', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  EXISTS: { ar: 'موجودة', en: 'Exists', tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  CODE_CONFLICT: { ar: 'تعارض في الكود', en: 'Code conflict', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
  LEGACY_STAGE_CONFLICT: { ar: 'تعارض في المرحلة القديمة', en: 'Legacy stage conflict', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  INVALID: { ar: 'غير صالحة', en: 'Invalid', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
};

export const OperationSeedModal: React.FC<OperationSeedModalProps> = ({ isOpen, onClose, canSeed }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [plan, setPlan] = useState<OperationSeedPlan | null>(null);
  const [result, setResult] = useState<OperationSeedExecution | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readStored = useCallback(
    () => fetchMasterData<Record<string, unknown> & { id?: string }>(MASTER_DATA_COLLECTIONS.stages, { skipCache: true }),
    [],
  );

  const loadPlan = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setPlan(planOperationSeed(await readStored()));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsLoading(false);
    }
  }, [readStored]);

  useEffect(() => {
    if (isOpen) {
      setResult(null);
      void loadPlan();
    }
  }, [isOpen, loadPlan]);

  const handleSeed = useCallback(async () => {
    if (!canSeed || !plan || plan.toCreate.length === 0) return;
    setIsSeeding(true);
    setError(null);
    try {
      const execution = await executeOperationSeed({
        readStored,
        create: (payload) => createMasterDataItem(MASTER_DATA_COLLECTIONS.stages, payload),
      });
      setResult(execution);
      setPlan(planOperationSeed(await readStored()));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsSeeding(false);
    }
  }, [canSeed, plan, readStored]);

  return (
    <Modal
      id="operation-seed-modal"
      isOpen={isOpen}
      onClose={() => { if (!isSeeding) onClose(); }}
      title={isAr ? 'إنشاء العمليات الإنتاجية المعتمدة' : 'Create Approved Operations'}
      subtitle={isAr
        ? 'ينشئ العمليات المعتمدة الناقصة فقط - لا يعدّل ولا يحذف أي عملية موجودة'
        : 'Creates only the missing approved operations - never edits or deletes an existing one'}
      maxWidth="4xl"
    >
      <div className="space-y-4 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 text-sky-900">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="font-semibold leading-relaxed">
            {isAr
              ? 'التعارضات تُعرض ولا تُحل تلقائيًا. إعادة التشغيل لا تنشئ نسخًا مكررة. العمليات إعدادات فقط ولا تغيّر سجلات الإنتاج أو المراحل القديمة.'
              : 'Conflicts are reported, never resolved automatically. Running again creates no duplicates. Operations are setup only and change no production records or legacy stages.'}
          </p>
        </div>

        {error && (
          <p className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold text-rose-800">
            {isAr ? `تعذر إكمال العملية: ${error}` : `Could not complete: ${error}`}
          </p>
        )}

        {plan && (
          <div id="operation-seed-summary" className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(Object.keys(OUTCOME_LABELS) as OperationSeedOutcome[]).map((o) => (
              <div key={o} className={`rounded-xl px-3 py-2 border ${OUTCOME_LABELS[o].tone}`}>
                <p className="text-[10px] font-bold opacity-80">{isAr ? OUTCOME_LABELS[o].ar : OUTCOME_LABELS[o].en}</p>
                <p className="text-lg font-black leading-tight">{plan.summary[o]}</p>
              </div>
            ))}
          </div>
        )}

        <div className="overflow-x-auto max-h-[50vh] overflow-y-auto border border-slate-200 rounded-xl">
          <table className="w-full text-[11px] min-w-[760px]">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr className="text-slate-600 border-b border-slate-200">
                <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'الترتيب' : 'Order'}</th>
                <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'الكود' : 'Code'}</th>
                <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'الاسم بالعربية' : 'Arabic Name'}</th>
                <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'الاسم بالإنجليزية' : 'English Name'}</th>
                <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'المرحلة القديمة' : 'Legacy Stage'}</th>
                <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'فئات المعدات' : 'Equipment'}</th>
                <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'النتيجة' : 'Outcome'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && !plan ? (
                <tr><td colSpan={7} className="py-6 text-center text-slate-400"><RefreshCw className="w-4 h-4 animate-spin inline" /></td></tr>
              ) : (plan?.rows ?? []).map((r) => (
                <tr key={r.seed.code}>
                  <td className="py-1.5 px-2.5 font-mono">{r.seed.defaultOrder}</td>
                  <td className="py-1.5 px-2.5 font-mono font-bold text-slate-900">{r.seed.code}</td>
                  <td className="py-1.5 px-2.5 text-slate-800">{r.seed.nameAr}</td>
                  <td className="py-1.5 px-2.5 text-slate-800" dir="ltr">{r.seed.nameEn}</td>
                  <td className="py-1.5 px-2.5 font-mono text-slate-600">{r.seed.legacyStageKey ?? '—'}</td>
                  <td className="py-1.5 px-2.5 text-slate-600">{r.seed.allowedEquipmentCategoryIds?.length ? r.seed.allowedEquipmentCategoryIds.join(', ') : '—'}</td>
                  <td className="py-1.5 px-2.5">
                    <span className={`inline-block px-1.5 py-0.5 rounded border font-bold ${OUTCOME_LABELS[r.outcome].tone}`} title={isAr ? r.messageAr : r.messageEn}>
                      {isAr ? OUTCOME_LABELS[r.outcome].ar : OUTCOME_LABELS[r.outcome].en}
                    </span>
                    {r.outcome !== 'CREATE' && r.outcome !== 'EXISTS' && (
                      <p className="text-[10px] text-slate-500 mt-0.5">{isAr ? r.messageAr : r.messageEn}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {result && (
          <div id="operation-seed-result" className={`flex items-start gap-2 rounded-xl px-3 py-2.5 border ${result.failed.length ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-900'}`}>
            {result.failed.length ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
            <div className="font-bold">
              <p>{isAr ? `تم إنشاء ${result.createdCodes.length} عملية.` : `Created ${result.createdCodes.length} operation(s).`}</p>
              {result.failed.length > 0 && (
                <p>{isAr ? `فشل: ${result.failed.map((f) => f.code).join('، ')}` : `Failed: ${result.failed.map((f) => f.code).join(', ')}`}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void loadPlan()}
            disabled={isLoading || isSeeding}
            className="flex items-center gap-1.5 px-3 py-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isAr ? 'تحديث المعاينة' : 'Refresh preview'}
          </button>
          <button
            id="operation-seed-execute"
            type="button"
            onClick={() => void handleSeed()}
            disabled={!canSeed || !plan || plan.toCreate.length === 0 || isSeeding || isLoading}
            className="px-4 py-2 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-xl cursor-pointer"
          >
            {isSeeding
              ? (isAr ? 'جارٍ الإنشاء...' : 'Creating...')
              : (isAr ? `إنشاء الناقص (${plan?.toCreate.length ?? 0})` : `Create missing (${plan?.toCreate.length ?? 0})`)}
          </button>
        </div>
      </div>
    </Modal>
  );
};

/**
 * Financial Transactions import - a DEDICATED Master Data workflow.
 *
 * Actual spending (date, account, cost centre, amount) for the Dashboard's
 * financial values. It lives beside the Financial Accounts importer and, like
 * it, never navigates: Historical Import is for production records and is not
 * involved at any point.
 *
 * WHAT IT REUSES (no second import architecture):
 *   listImportSheetNames / parseImportFile   the shared XLSX reader
 *   planFinancialImport                      exact-code validation per row
 *   importFinancialTransactions              audited writes, per-row isolation
 *   listFinancialAccounts / listCostCenterHierarchyNodes
 *                                            the codes a row must match
 *   Modal                                    the app's existing dialog
 *
 * Partial import: valid rows are written, invalid rows stay on screen with
 * their reason. Nothing is ever guessed - an account or cost centre that does
 * not exist by exact code rejects the row.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Info } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../i18n/LanguageContext';
import { listImportSheetNames, parseImportFile } from '../../services/bulkImportService';
import {
  FINANCIAL_TX_HEADER_ALIASES,
  FinancialImportPlan,
  mapFinancialRowHeaders,
  planFinancialImport,
} from '../../services/financialTransactionsPure';
import { importFinancialTransactions, FinancialImportOutcome } from '../../services/financialTransactionService';
import { listFinancialAccounts } from '../../services/financialAccountService';
import { listCostCenterHierarchyNodes } from '../../services/costCenterHierarchyService';

interface FinancialTransactionsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Existing Master Data import permission - decided by the caller, never re-derived here. */
  canImport: boolean;
}

type Phase = 'choose' | 'previewing' | 'preview' | 'importing' | 'done';

export const FinancialTransactionsImportModal: React.FC<FinancialTransactionsImportModalProps> = ({
  isOpen,
  onClose,
  canImport,
}) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const [phase, setPhase] = useState<Phase>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState('');
  const [plan, setPlan] = useState<FinancialImportPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FinancialImportOutcome | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const reset = useCallback(() => {
    setPhase('choose');
    setFile(null);
    setSheetNames([]);
    setSheet('');
    setPlan(null);
    setError(null);
    setResult(null);
    setProgress(null);
  }, []);

  const closeAndReset = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  /**
   * Reads one sheet and validates it against the codes stored NOW - read
   * fresh, so an account created a minute ago is recognised.
   */
  const loadSheet = useCallback(
    async (targetFile: File, targetSheet: string) => {
      setPhase('previewing');
      setError(null);
      try {
        const [raw, accounts, nodes] = await Promise.all([
          parseImportFile(targetFile, targetSheet),
          listFinancialAccounts({ skipCache: true }),
          listCostCenterHierarchyNodes({ skipCache: true }),
        ]);
        if (raw.length === 0) {
          setPlan(null);
          setError(isAr ? `الورقة "${targetSheet}" لا تحتوي على أي صفوف بيانات.` : `Sheet "${targetSheet}" contains no data rows.`);
          setPhase('preview');
          return;
        }
        const accountCodes = new Set(accounts.map((a: any) => String(a.code ?? '').trim()).filter(Boolean));
        const costCenterCodes = new Set(nodes.map((n) => String(n.sheet1Code ?? '').trim()).filter(Boolean));
        setPlan(planFinancialImport(raw.map(mapFinancialRowHeaders), accountCodes, costCenterCodes));
        setPhase('preview');
      } catch (err: any) {
        setError(err?.message || (isAr ? 'تعذر قراءة الملف.' : 'Could not read the file.'));
        setPhase('choose');
      }
    },
    [isAr],
  );

  const handleFile = useCallback(
    async (chosen: File) => {
      setFile(chosen);
      setError(null);
      setResult(null);
      try {
        const names = await listImportSheetNames(chosen);
        setSheetNames(names);
        const first = names[0] || '';
        setSheet(first);
        await loadSheet(chosen, first);
      } catch (err: any) {
        setError(err?.message || (isAr ? 'تعذر قراءة الملف.' : 'Could not read the file.'));
        setPhase('choose');
      }
    },
    [loadSheet, isAr],
  );

  const totalAmount = useMemo(
    () => Math.round((plan?.toWrite.reduce((sum, tx) => sum + tx.amount, 0) ?? 0) * 100) / 100,
    [plan],
  );

  /** Writes exactly the rows the preview showed as valid - never re-validated in between. */
  const handleImport = useCallback(async () => {
    if (!canImport || !plan || plan.validCount === 0) return;
    setPhase('importing');
    setError(null);
    setProgress({ done: 0, total: plan.validCount });
    try {
      const outcome = await importFinancialTransactions(plan.toWrite, (done, total) => setProgress({ done, total }));
      setResult(outcome);
      setPhase('done');
    } catch (err: any) {
      setError(err?.message || (isAr ? 'فشل الاستيراد.' : 'Import failed.'));
      setPhase('preview');
    } finally {
      setProgress(null);
    }
  }, [canImport, plan, isAr]);

  return (
    <Modal
      id="financial-transactions-import-modal"
      isOpen={isOpen}
      onClose={closeAndReset}
      title={isAr ? 'استيراد المعاملات المالية' : 'Import Financial Transactions'}
      subtitle={
        isAr
          ? 'المصروفات الفعلية حسب الحساب ومركز التكلفة - منفصل تمامًا عن استيراد البيانات التاريخية'
          : 'Actual spending by account and cost centre - entirely separate from Historical Data Import'
      }
      maxWidth="4xl"
    >
      <div className="space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
        {!canImport && (
          <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            <XCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-800 font-bold">
              {isAr
                ? 'لا تملك صلاحية استيراد البيانات الأساسية. يمكنك مراجعة الملف دون تنفيذ الاستيراد.'
                : 'You do not have the Master Data import permission. You may review a file, but not import it.'}
            </p>
          </div>
        )}

        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <h3 className="text-xs font-black text-slate-800">{isAr ? '1. اختر ملف Excel' : '1. Choose an Excel file'}</h3>
          <label
            htmlFor="financial-transactions-import-file"
            className="flex items-center gap-2 w-fit px-4 py-2.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            {phase === 'previewing' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{isAr ? 'اختر ملف Excel' : 'Choose Excel file'}</span>
          </label>
          <input
            id="financial-transactions-import-file"
            type="file"
            accept=".xlsx,.xls,.csv,.tsv"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void handleFile(chosen);
              e.target.value = '';
            }}
          />
          {file && (
            <p className="text-[11px] text-slate-600 font-bold flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              {file.name}
            </p>
          )}
          {sheetNames.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="financial-transactions-import-sheet" className="text-[11px] font-bold text-slate-600">
                {isAr ? 'الورقة (Sheet)' : 'Sheet'}
              </label>
              <select
                id="financial-transactions-import-sheet"
                value={sheet}
                onChange={(e) => {
                  setSheet(e.target.value);
                  if (file) void loadSheet(file, e.target.value);
                }}
                className="bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800"
              >
                {sheetNames.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-start gap-2 text-[11px] text-slate-600">
            <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <p>
              {isAr ? 'الأعمدة: ' : 'Columns: '}
              {Object.entries(FINANCIAL_TX_HEADER_ALIASES)
                .map(([field, aliases]) => `${field}${['description', 'reference'].includes(field) ? '' : '*'} (${aliases.filter((a) => /[؀-ۿ]/.test(a))[0] ?? ''})`)
                .join('، ')}
              {isAr
                ? ' — يجب أن يطابق كود الحساب وكود مركز التكلفة كودًا موجودًا تمامًا.'
                : ' — the account and cost-centre codes must match an existing code exactly.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-800 font-bold">{error}</p>
          </div>
        )}

        {plan && (
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <h3 className="text-xs font-black text-slate-800">{isAr ? '2. ملخص المراجعة والتحقق' : '2. Preview & validation summary'}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: isAr ? 'إجمالي الصفوف' : 'Total Rows', value: plan.rows.length, tone: 'bg-slate-100 text-slate-800' },
                { label: isAr ? 'صالح للاستيراد' : 'Ready to Import', value: plan.validCount, tone: 'bg-emerald-50 text-emerald-800 border border-emerald-200' },
                { label: isAr ? 'غير صالح' : 'Invalid', value: plan.invalidCount, tone: 'bg-rose-50 text-rose-800 border border-rose-200' },
                { label: isAr ? 'إجمالي المبالغ الصالحة' : 'Valid amount total', value: totalAmount.toLocaleString(), tone: 'bg-sky-50 text-sky-800 border border-sky-200' },
              ].map((c) => (
                <div key={c.label} className={`rounded-xl px-3 py-2 ${c.tone}`}>
                  <p className="text-[10px] font-bold opacity-80">{c.label}</p>
                  <p className="text-lg font-black leading-tight">{c.value}</p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-[11px] min-w-[640px]">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="text-slate-600 border-b border-slate-200">
                    <th className="text-start py-2 px-2.5 font-bold">#</th>
                    <th className="text-start py-2 px-2.5 font-bold">date</th>
                    <th className="text-start py-2 px-2.5 font-bold">accountCode</th>
                    <th className="text-start py-2 px-2.5 font-bold">costCenterCode</th>
                    <th className="text-start py-2 px-2.5 font-bold">amount</th>
                    <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {plan.rows.map((row) => (
                    <tr key={row.rowNumber} className={row.valid ? '' : 'bg-rose-50/40'}>
                      <td className="py-1.5 px-2.5 text-slate-500 font-mono">{row.rowNumber}</td>
                      <td className="py-1.5 px-2.5 text-slate-700">{row.transaction?.date ?? '—'}</td>
                      <td className="py-1.5 px-2.5 text-slate-700 font-mono">{row.transaction?.accountCode ?? '—'}</td>
                      <td className="py-1.5 px-2.5 text-slate-700 font-mono">{row.transaction?.costCenterCode ?? '—'}</td>
                      <td className="py-1.5 px-2.5 text-slate-700">{row.transaction ? row.transaction.amount.toLocaleString() : '—'}</td>
                      <td className="py-1.5 px-2.5">
                        {row.valid ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                            <CheckCircle2 className="w-3 h-3" />
                            {isAr ? 'جاهز' : 'Ready'}
                          </span>
                        ) : (
                          <span className="text-rose-700 font-bold" title={row.issues.map((i) => (isAr ? i.messageAr : i.messageEn)).join(' | ')}>
                            {row.issues.map((i) => (isAr ? i.messageAr : i.messageEn)).join(' ')}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {plan.invalidCount > 0 && (
              <p className="text-[11px] font-bold text-slate-600">
                {isAr
                  ? `${plan.invalidCount} صف لن يتم استيراده وسيبقى معروضًا بسبب الخطأ. الصفوف الصالحة تُستورد بشكل طبيعي.`
                  : `${plan.invalidCount} row(s) will not be imported and stay listed with their reason. The valid rows import normally.`}
              </p>
            )}
          </div>
        )}

        {result && (
          <div id="financial-transactions-import-result" className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-2">
            <h3 className="text-xs font-black text-emerald-900">{isAr ? '3. نتيجة الاستيراد' : '3. Import result'}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-bold text-slate-800">
              <p>{isAr ? 'تم استيراد' : 'Imported'}: <span className="text-emerald-700">{result.successCount}</span></p>
              <p>{isAr ? 'فشل الحفظ' : 'Failed to save'}: <span className="text-rose-700">{result.failedCount}</span></p>
              <p>{isAr ? 'صفوف غير صالحة' : 'Invalid rows'}: <span className="text-rose-700">{plan?.invalidCount ?? 0}</span></p>
            </div>
            {result.failed.length > 0 && (
              <p className="text-[11px] font-bold text-rose-800">
                {result.failed.slice(0, 3).map((f) => f.error).join(' | ')}
              </p>
            )}
          </div>
        )}

        {progress && (
          <p className="text-xs font-bold text-slate-600">
            {isAr ? 'جارٍ الاستيراد' : 'Importing'}: {progress.done} / {progress.total}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={closeAndReset}
            disabled={phase === 'importing'}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl cursor-pointer"
          >
            {isAr ? 'إغلاق' : 'Close'}
          </button>
          <button
            id="financial-transactions-import-execute"
            type="button"
            onClick={() => void handleImport()}
            disabled={!canImport || !plan || plan.validCount === 0 || phase === 'importing' || phase === 'done'}
            className="px-4 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-xl shadow-xs cursor-pointer"
          >
            {phase === 'importing'
              ? (isAr ? 'جارٍ الاستيراد...' : 'Importing...')
              : (isAr ? `استيراد المعاملات (${plan?.validCount ?? 0})` : `Import Transactions (${plan?.validCount ?? 0})`)}
          </button>
        </div>
      </div>
    </Modal>
  );
};

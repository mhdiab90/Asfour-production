/**
 * Financial Accounts import - a DEDICATED Master Data workflow.
 *
 * WHY THIS EXISTS.
 * The "Import Financial Accounts" action used to call `onNavigate('bulk-entry')`,
 * and App.tsx routes BOTH `historical-import` AND `bulk-entry` to
 * `<DataImportView />` - the Historical Excel Import centre. So the user asked
 * to import a chart of accounts and landed in historical production import.
 * That is a routing defect, not a naming quibble: the two workflows review
 * different things and mean different things.
 *
 * This modal keeps the user inside Master Data -> Financial Accounts from the
 * first click to the final result. It never navigates anywhere.
 *
 * WHAT IT REUSES (no second import architecture):
 *   MASTER_DATA_SCHEMAS.financialAccounts  the one schema, already shipped
 *   listImportSheetNames / parseImportFile  the shared XLSX reader
 *   validateImportData                      required fields, in-file and
 *                                           in-Firestore duplicate detection
 *   validateAccountImportRelationships      parent resolution + cycle check,
 *                                           through the shared resolver
 *   commitBulkImport                        chunked write, final duplicate
 *                                           recheck, audit log, cache invalidation
 *   Modal                                   the app's existing dialog
 *
 * The only thing written here is the screen itself.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Info,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../i18n/LanguageContext';
import { BulkImportRow, BulkImportResult } from '../../types';
import {
  MASTER_DATA_SCHEMAS,
  listImportSheetNames,
  parseImportFile,
  validateImportData,
  commitBulkImport,
  downloadMasterDataTemplate,
} from '../../services/bulkImportService';
import { validateAccountImportRelationships } from '../../services/financialAccountsPure';

interface FinancialAccountsImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Codes already stored, so a parent naming an existing account resolves. */
  existingCodes: string[];
  /** Called after a successful import so the list behind the modal refreshes. */
  onImported: () => void;
  /** Existing Master Data import permission - decided by the caller, never re-derived here. */
  canImport: boolean;
}

type Phase = 'choose' | 'previewing' | 'preview' | 'importing' | 'done';

const SCHEMA = MASTER_DATA_SCHEMAS.financialAccounts;

/** Rows the importer will actually write - the same rule commitBulkImport applies. */
function isImportable(row: BulkImportRow): boolean {
  return row.status === 'valid' || row.status === 'NEW';
}

export const FinancialAccountsImportModal: React.FC<FinancialAccountsImportModalProps> = ({
  isOpen,
  onClose,
  existingCodes,
  onImported,
  canImport,
}) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';

  const [phase, setPhase] = useState<Phase>('choose');
  const [file, setFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string>('');
  const [rows, setRows] = useState<BulkImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const reset = useCallback(() => {
    setPhase('choose');
    setFile(null);
    setSheetNames([]);
    setSheet('');
    setRows([]);
    setError(null);
    setResult(null);
    setProgress(null);
  }, []);

  const closeAndReset = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  /**
   * Reads one sheet and validates it.
   *
   * Two validation passes, deliberately in this order: the shared importer
   * first (required fields, duplicate codes in-file and in Firestore), then the
   * account-specific relationship checks. Relationship errors are merged onto
   * the row rather than replacing its status, so a row that is already a
   * duplicate keeps saying so.
   */
  const loadSheet = useCallback(
    async (targetFile: File, targetSheet: string) => {
      setPhase('previewing');
      setError(null);
      try {
        const raw = await parseImportFile(targetFile, targetSheet);
        if (raw.length === 0) {
          setRows([]);
          setError(
            isAr
              ? `الورقة "${targetSheet}" لا تحتوي على أي صفوف بيانات.`
              : `Sheet "${targetSheet}" contains no data rows.`,
          );
          setPhase('preview');
          return;
        }

        const validated = await validateImportData('financialAccounts', raw);

        // Parent must resolve, and the file must not describe a cycle. Only
        // rows the shared importer would otherwise write are checked - a row
        // already rejected does not need a second reason.
        const candidates = validated.filter(isImportable);
        const relationshipIssues = validateAccountImportRelationships(
          candidates.map((r) => ({ rowNumber: r.rowNumber, data: r.data })),
          new Set(existingCodes),
        );
        const issuesByRow = new Map(relationshipIssues.map((i) => [i.rowNumber, i.errors]));

        const merged = validated.map((row) => {
          const extra = issuesByRow.get(row.rowNumber);
          if (!extra || !isImportable(row)) return row;
          return { ...row, status: 'INVALID' as BulkImportRow['status'], errors: [...row.errors, ...extra] };
        });

        setRows(merged);
        setPhase('preview');
      } catch (err: any) {
        setError(err?.message || (isAr ? 'تعذر قراءة الملف.' : 'Could not read the file.'));
        setPhase('choose');
      }
    },
    [existingCodes, isAr],
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

  const summary = useMemo(() => {
    const total = rows.length;
    const ready = rows.filter(isImportable).length;
    const duplicates = rows.filter(
      (r) => r.status === 'DUPLICATE_IN_FILE' || r.status === 'DUPLICATE_IN_FIRESTORE' || r.status === 'duplicate',
    ).length;
    const invalid = total - ready - duplicates;
    return { total, ready, duplicates, invalid: invalid < 0 ? 0 : invalid };
  }, [rows]);

  const problemRows = useMemo(() => rows.filter((r) => !isImportable(r)), [rows]);

  /**
   * Writes ONLY the importable rows.
   *
   * Partial import is the whole point: 95 valid rows go in while 5 bad rows
   * stay on screen with their reasons. commitBulkImport itself filters to
   * valid/NEW, so an invalid row cannot be written even if it were passed.
   */
  const handleImport = useCallback(async () => {
    if (!canImport || summary.ready === 0) return;
    setPhase('importing');
    setError(null);
    setProgress({ done: 0, total: summary.ready });
    try {
      const outcome = await commitBulkImport('financialAccounts', rows, (done, total) =>
        setProgress({ done, total }),
      );
      setResult(outcome);
      setPhase('done');
      // commitBulkImport already invalidated this collection's cache entry;
      // this tells the screen behind the modal to re-read it now rather than
      // after the freshness window.
      onImported();
    } catch (err: any) {
      setError(err?.message || (isAr ? 'فشل الاستيراد.' : 'Import failed.'));
      setPhase('preview');
    } finally {
      setProgress(null);
    }
  }, [canImport, summary.ready, rows, onImported, isAr]);

  const previewColumns = SCHEMA.fields.map((f) => f.key);

  return (
    <Modal
      id="financial-accounts-import-modal"
      isOpen={isOpen}
      onClose={closeAndReset}
      title={isAr ? 'استيراد الحسابات المالية' : 'Import Financial Accounts'}
      subtitle={
        isAr
          ? 'استيراد البيانات الأساسية للحسابات المالية - منفصل تمامًا عن استيراد البيانات التاريخية'
          : 'Financial Accounts Master Data import - entirely separate from Historical Data Import'
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

        {/* Step 1 - file */}
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-xs font-black text-slate-800">
              {isAr ? '1. اختر ملف Excel' : '1. Choose an Excel file'}
            </h3>
            <button
              type="button"
              onClick={() => downloadMasterDataTemplate('financialAccounts', 'xlsx')}
              className="text-[11px] font-bold text-sky-700 hover:text-sky-900 cursor-pointer"
            >
              {isAr ? 'تنزيل قالب فارغ' : 'Download a blank template'}
            </button>
          </div>

          <label
            htmlFor="financial-accounts-import-file"
            className="flex items-center gap-2 w-fit px-4 py-2.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            {phase === 'previewing' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            <span>{isAr ? 'اختر ملف Excel' : 'Choose Excel file'}</span>
          </label>
          <input
            id="financial-accounts-import-file"
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
              <label htmlFor="financial-accounts-import-sheet" className="text-[11px] font-bold text-slate-600">
                {isAr ? 'الورقة (Sheet)' : 'Sheet'}
              </label>
              <select
                id="financial-accounts-import-sheet"
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
              {isAr ? 'الأعمدة المدعومة: ' : 'Supported columns: '}
              {SCHEMA.fields.map((f) => `${f.key}${f.required ? '*' : ''}`).join('، ')}
              {isAr ? ' — يتم التعرف على أسماء الأعمدة بالعربية والإنجليزية تلقائيًا.' : ' — Arabic and English column headers are matched automatically.'}
            </p>
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <p className="text-xs text-rose-800 font-bold">{error}</p>
          </div>
        )}

        {/* Step 2 - validation summary */}
        {rows.length > 0 && (
          <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <h3 className="text-xs font-black text-slate-800">
              {isAr ? '2. ملخص المراجعة والتحقق' : '2. Preview & validation summary'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: isAr ? 'إجمالي الصفوف' : 'Total Rows', value: summary.total, tone: 'bg-slate-100 text-slate-800' },
                { label: isAr ? 'صالح للاستيراد' : 'Ready to Import', value: summary.ready, tone: 'bg-emerald-50 text-emerald-800 border border-emerald-200' },
                { label: isAr ? 'مكرر' : 'Duplicates', value: summary.duplicates, tone: 'bg-amber-50 text-amber-800 border border-amber-200' },
                { label: isAr ? 'غير صالح' : 'Invalid', value: summary.invalid, tone: 'bg-rose-50 text-rose-800 border border-rose-200' },
              ].map((c) => (
                <div key={c.label} className={`rounded-xl px-3 py-2 ${c.tone}`}>
                  <p className="text-[10px] font-bold opacity-80">{c.label}</p>
                  <p className="text-lg font-black leading-tight">{c.value}</p>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-[11px] min-w-[720px]">
                <thead className="sticky top-0 bg-slate-50 z-10">
                  <tr className="text-slate-600 border-b border-slate-200">
                    <th className="text-start py-2 px-2.5 font-bold">#</th>
                    {previewColumns.map((c) => (
                      <th key={c} className="text-start py-2 px-2.5 font-bold">{c}</th>
                    ))}
                    <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const ok = isImportable(row);
                    return (
                      <tr key={row.rowNumber} className={ok ? '' : 'bg-rose-50/40'}>
                        <td className="py-1.5 px-2.5 text-slate-500 font-mono">{row.rowNumber}</td>
                        {previewColumns.map((c) => (
                          <td key={c} className="py-1.5 px-2.5 text-slate-700">{String(row.data[c] ?? '')}</td>
                        ))}
                        <td className="py-1.5 px-2.5">
                          {ok ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                              <CheckCircle2 className="w-3 h-3" />
                              {isAr ? 'جاهز' : 'Ready'}
                            </span>
                          ) : (
                            <span className="text-rose-700 font-bold" title={row.errors.join(' | ')}>
                              {row.errors[0] || row.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {problemRows.length > 0 && (
              <p className="text-[11px] font-bold text-slate-600">
                {isAr
                  ? `${problemRows.length} صف لن يتم استيراده وسيبقى معروضًا بسبب الخطأ. الصفوف الصالحة تُستورد بشكل طبيعي.`
                  : `${problemRows.length} row(s) will not be imported and stay listed with their reason. The valid rows import normally.`}
              </p>
            )}
          </div>
        )}

        {/* Step 3 - result */}
        {result && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 space-y-2">
            <h3 className="text-xs font-black text-emerald-900">
              {isAr ? '3. نتيجة الاستيراد' : '3. Import result'}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-bold text-slate-800">
              <p>{isAr ? 'تم استيراد' : 'Imported'}: <span className="text-emerald-700">{result.importedRows}</span></p>
              <p>{isAr ? 'تم تخطيه' : 'Skipped'}: <span className="text-amber-700">{result.duplicateRows}</span></p>
              <p>{isAr ? 'أخطاء' : 'Failed'}: <span className="text-rose-700">{result.errorRows}</span></p>
              <p>
                {isAr ? 'أخطاء متبقية' : 'Remaining Errors'}:{' '}
                <span className="text-rose-700">{problemRows.length}</span>
              </p>
            </div>
            {(result.blockedByFinalRecheckRows ?? 0) > 0 && (
              <p className="text-[11px] font-bold text-amber-800">
                {isAr
                  ? `${result.blockedByFinalRecheckRows} صف تم منعه عند الفحص النهائي لأن نفس الكود أُنشئ أثناء المراجعة.`
                  : `${result.blockedByFinalRecheckRows} row(s) were blocked by the final recheck because the same code was created during review.`}
              </p>
            )}
          </div>
        )}

        {progress && (
          <p className="text-xs font-bold text-slate-600">
            {isAr ? 'جارٍ الاستيراد' : 'Importing'}: {progress.done} / {progress.total}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={closeAndReset}
            disabled={phase === 'importing'}
            className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl cursor-pointer"
          >
            {isAr ? 'إلغاء' : 'Cancel'}
          </button>
          <button
            id="financial-accounts-import-execute"
            type="button"
            onClick={() => void handleImport()}
            disabled={!canImport || summary.ready === 0 || phase === 'importing' || phase === 'done'}
            className="px-4 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 rounded-xl shadow-xs cursor-pointer"
          >
            {phase === 'importing'
              ? (isAr ? 'جارٍ الاستيراد...' : 'Importing...')
              : (isAr ? `استيراد الحسابات (${summary.ready})` : `Import Accounts (${summary.ready})`)}
          </button>
        </div>
      </div>
    </Modal>
  );
};

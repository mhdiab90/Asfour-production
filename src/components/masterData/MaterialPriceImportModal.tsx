/**
 * Material price import from Excel (3.25.0) - and, since 3.26.0, the alumina %
 * and LOCAL / IMPORTED of each material from the same sheet.
 *
 * One row per material, matched by its code: the last purchase price, the
 * average issue price and, optionally, the unit the prices are per. The file is
 * read with the shared XLSX reader, the columns are detected from the headers
 * (and can be changed), and every row is checked BEFORE anything is written -
 * code found exactly once, prices numeric and not negative, unit approved, no
 * code twice in the file. Only READY rows are written; errors are shown and
 * skipped; unchanged rows are not written at all.
 *
 * Each write goes through updateMasterDataItem (sanitised, cache-invalidating,
 * audited) with ONLY the changed price fields, the date and the source
 * EXCEL_IMPORT - one bounded write at a time, and a failed write keeps its row
 * marked with the reason. Behind the existing Master Data edit gate.
 *
 * "Download template" gives the current materials and prices under the headers
 * this screen recognises: fill in the prices and import the same file back.
 */
import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Download, FileSpreadsheet, RefreshCw, UploadCloud } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../i18n/LanguageContext';
import { BOM_UNIT_LABELS } from '../../services/bomPure';
import { fetchMasterData, updateMasterDataItem, MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import { listImportSheetNames, parseImportFile } from '../../services/bulkImportService';
import { logAuditAction } from '../../services/auditService';
import { MATERIAL_ORIGIN_LABELS, MaterialOrigin, formatMoney } from '../../services/bomCostingPure';
import {
  DATA_COLUMNS,
  PRICE_COLUMNS,
  PRICE_COLUMN_LABELS,
  PRICE_ROW_ERROR_LABELS,
  PriceColumn,
  PlannedPriceRow,
  detectPriceColumns,
  planPriceImport,
  priceTemplateRows,
} from '../../services/materialPriceImportPure';

interface MaterialPriceImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The existing Master Data edit gate, decided by the caller. */
  canImport: boolean;
  /** Told after prices were written, so lists already on screen are read again. */
  onImported?: () => void;
}

/** One write, bounded - a write that does not answer is reported, never waited on forever. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

type RowFilter = 'ALL' | 'READY' | 'ERROR' | 'UNCHANGED';

export const MaterialPriceImportModal: React.FC<MaterialPriceImportModalProps> = ({ isOpen, onClose, canImport, onImported }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [materials, setMaterials] = useState<any[]>([]);
  const [isLoadingMaterials, setIsLoadingMaterials] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[]>([]);
  const [sheet, setSheet] = useState<string>('');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<PriceColumn, string>>>({});
  const [readError, setReadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RowFilter>('ALL');
  const [isImporting, setIsImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [writeErrors, setWriteErrors] = useState<Record<number, string>>({});
  const [result, setResult] = useState<string | null>(null);
  /** The time stamped on this run's writes - fixed per plan so the preview shows exactly what is written. */
  const [runAt, setRunAt] = useState<string>(() => new Date().toISOString());

  const loadMaterials = async () => {
    setIsLoadingMaterials(true);
    try {
      // Fresh from the server, so the plan compares against the prices as they are now.
      setMaterials(await fetchMasterData<any>(MASTER_DATA_COLLECTIONS.materials, { skipCache: true }));
    } catch (err: any) {
      setReadError(String(err?.message ?? err));
    } finally {
      setIsLoadingMaterials(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setFile(null); setSheets([]); setSheet(''); setRows([]); setHeaders([]); setMapping({});
    setReadError(null); setWriteErrors({}); setResult(null); setProgress(null); setFilter('ALL');
    void loadMaterials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const readSheet = async (f: File, name?: string) => {
    setReadError(null);
    setResult(null);
    setWriteErrors({});
    try {
      const data = await parseImportFile(f, name);
      const cols = data.length ? Object.keys(data[0]) : [];
      setRows(data);
      setHeaders(cols);
      setMapping(detectPriceColumns(cols));
      setRunAt(new Date().toISOString());
      if (data.length === 0) setReadError(isAr ? 'الورقة المختارة لا تحتوي على بيانات.' : 'The chosen sheet has no rows.');
    } catch (err: any) {
      setRows([]); setHeaders([]); setMapping({});
      setReadError(String(err?.message ?? err));
    }
  };

  const handleFile = async (f: File | null) => {
    setFile(f);
    if (!f) return;
    try {
      const names = await listImportSheetNames(f);
      setSheets(names);
      setSheet(names[0] ?? '');
      await readSheet(f, names[0]);
    } catch (err: any) {
      setReadError(String(err?.message ?? err));
    }
  };

  const plan = useMemo(
    () => (rows.length && mapping.code ? planPriceImport(rows, mapping, materials, runAt) : null),
    [rows, mapping, materials, runAt],
  );
  const mappingIssue = !mapping.code
    ? (isAr ? 'اختر عمود كود الخامة.' : 'Choose the material code column.')
    : !DATA_COLUMNS.some((c) => mapping[c])
      ? (isAr ? 'اختر عمودًا واحدًا على الأقل من: آخر سعر شراء، متوسط سعر المنصرف، نسبة الألومينا، محلي / مستورد.' : 'Choose at least one of: last purchase price, average issue price, alumina %, local / imported.')
      : null;
  const visibleRows = useMemo(
    () => (plan ? plan.rows.filter((r) => filter === 'ALL' || r.status === filter) : []),
    [plan, filter],
  );

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet(priceTemplateRows(materials, isAr ? 'ar' : 'en'));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, isAr ? 'خصائص وأسعار الخامات' : 'Material data');
    XLSX.writeFile(wb, `ASFOUR_Material_Data_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  /** Writes every READY row, one bounded write at a time; stops nothing else on a failure. */
  const handleImport = async () => {
    if (!canImport || !plan || mappingIssue || plan.ready === 0) return;
    const ready = plan.rows.filter((r) => r.status === 'READY' && r.materialId);
    if (!window.confirm(isAr
      ? `سيتم تحديث بيانات ${ready.length} خامة. متابعة؟`
      : `${ready.length} material(s) will be updated. Continue?`)) return;
    setIsImporting(true);
    setResult(null);
    setProgress({ done: 0, total: ready.length });
    const errors: Record<number, string> = {};
    let written = 0;
    for (let i = 0; i < ready.length; i++) {
      const row = ready[i];
      try {
        await withTimeout(updateMasterDataItem(MASTER_DATA_COLLECTIONS.materials, row.materialId as string, row.patch), 30_000);
        written++;
      } catch (err: any) {
        errors[row.rowNumber] = err?.message === 'TIMEOUT'
          ? (isAr ? 'لم يرد الخادم - قد يكون السعر حُفظ أو لا؛ أعد الاستيراد بعد التحقق من الاتصال.' : 'The server did not answer - the price may or may not be saved; import again once the connection is back.')
          : String(err?.message ?? err);
      }
      setProgress({ done: i + 1, total: ready.length });
    }
    const failed = Object.keys(errors).length;
    // One summary line in the audit log, beside the per-material entries the shared update already wrote.
    if (written > 0) {
      logAuditAction(
        'BULK_IMPORT',
        MASTER_DATA_COLLECTIONS.materials,
        'material-prices',
        `استيراد خصائص وأسعار الخامات من Excel (${file?.name ?? ''}${sheet ? ` / ${sheet}` : ''}): تم تحديث ${written} خامة${failed ? `، تعذر ${failed}` : ''}`,
      ).catch(() => {});
      onImported?.();
    }
    setWriteErrors(errors);
    setIsImporting(false);
    setResult(isAr
      ? `تم تحديث بيانات ${written} خامة${failed ? ` - تعذر ${failed}، راجع الأسطر المعلّمة` : ''}.`
      : `${written} material(s) updated${failed ? ` - ${failed} failed, see the marked rows` : ''}.`);
    // Re-read, so the preview now compares against what was written (written rows turn UNCHANGED).
    await loadMaterials();
    setRunAt(new Date().toISOString());
  };

  const unitLabel = (u: string | null) => (u ? (BOM_UNIT_LABELS[u] ? (isAr ? BOM_UNIT_LABELS[u].ar : BOM_UNIT_LABELS[u].en) : u) : '-');
  const priceCell = (from: number | null, to: number | null) => (
    from === to
      ? <span className="font-mono">{formatMoney(to)}</span>
      : <span className="font-mono"><span className="text-slate-400 line-through">{formatMoney(from)}</span> <span className="font-black text-emerald-700">{formatMoney(to)}</span></span>
  );
  const valueCell = (from: string, to: string) => (
    from === to
      ? <span>{to}</span>
      : <span><span className="text-slate-400 line-through">{from}</span> <span className="font-black text-emerald-700">{to}</span></span>
  );
  const aluminaText = (v: number | null) => (v === null ? '-' : `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`);
  const originText = (v: MaterialOrigin | null) => (v ? (isAr ? MATERIAL_ORIGIN_LABELS[v].ar : MATERIAL_ORIGIN_LABELS[v].en) : '-');
  const statusBadge = (r: PlannedPriceRow) => {
    if (writeErrors[r.rowNumber]) return <span className="px-1.5 rounded bg-rose-100 text-rose-800 font-bold">{isAr ? 'فشل الحفظ' : 'Save failed'}</span>;
    if (r.status === 'READY') return <span className="px-1.5 rounded bg-emerald-100 text-emerald-800 font-bold">{isAr ? 'جاهز' : 'Ready'}</span>;
    if (r.status === 'UNCHANGED') return <span className="px-1.5 rounded bg-slate-100 text-slate-600 font-bold">{isAr ? 'بدون تغيير' : 'Unchanged'}</span>;
    return <span className="px-1.5 rounded bg-rose-100 text-rose-800 font-bold">{isAr ? 'خطأ' : 'Error'}</span>;
  };

  return (
    <Modal
      id="material-price-import-modal"
      isOpen={isOpen}
      onClose={() => { if (!isImporting) onClose(); }}
      title={isAr ? 'استيراد خصائص وأسعار الخامات من Excel' : 'Import material data from Excel'}
      subtitle={isAr
        ? 'آخر سعر شراء، متوسط سعر المنصرف، نسبة الألومينا، ومحلي أو مستورد - بالربط على كود الخامة'
        : 'Last purchase price, average issue price, alumina % and local / imported - matched by material code'}
      maxWidth="4xl"
    >
      <div className="space-y-3 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        {/* Step 1 - the file */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`flex items-center gap-1.5 px-3 py-2 font-bold rounded-xl border cursor-pointer ${isImporting ? 'opacity-50 pointer-events-none' : 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100'}`}>
            <UploadCloud className="w-3.5 h-3.5" />
            {isAr ? 'اختيار ملف Excel' : 'Choose an Excel file'}
            <input
              id="material-price-import-file"
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => { void handleFile(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />
          </label>
          {file && <span className="flex items-center gap-1 font-semibold text-slate-700"><FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />{file.name}</span>}
          {sheets.length > 1 && (
            <select
              id="material-price-import-sheet"
              value={sheet}
              onChange={(e) => { setSheet(e.target.value); if (file) void readSheet(file, e.target.value); }}
              className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 font-bold"
            >
              {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <button
            id="material-price-template-btn"
            type="button"
            onClick={handleDownloadTemplate}
            disabled={isLoadingMaterials || materials.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer disabled:opacity-50 ms-auto"
            title={isAr ? 'كل الخامات ببياناتها الحالية - املأ الناقص ثم استورد نفس الملف' : 'Every material with its current data - fill in what is missing, then import the same file'}
          >
            <Download className="w-3.5 h-3.5" />
            {isAr ? 'تحميل نموذج Excel' : 'Download template'}
          </button>
        </div>

        {isLoadingMaterials && <p className="text-slate-500 flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5 animate-spin" />{isAr ? 'جاري تحميل الخامات...' : 'Loading materials...'}</p>}
        {readError && <p className="font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{readError}</p>}

        {/* Step 2 - which column is which */}
        {headers.length > 0 && (
          <div id="material-price-import-mapping" className="border border-slate-200 rounded-xl p-3 space-y-2">
            <p className="font-black text-slate-700">{isAr ? 'ربط الأعمدة' : 'Columns'}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {PRICE_COLUMNS.map((field) => (
                <label key={field} className="space-y-1">
                  <span className="font-bold text-slate-600">
                    {isAr ? PRICE_COLUMN_LABELS[field].ar : PRICE_COLUMN_LABELS[field].en}
                    {field === 'code' && <span className="text-rose-600"> *</span>}
                  </span>
                  <select
                    value={mapping[field] ?? ''}
                    disabled={isImporting}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value || undefined }))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5"
                  >
                    <option value="">{isAr ? '- لا يوجد -' : '- none -'}</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {mappingIssue && <p className="font-bold text-amber-800">{mappingIssue}</p>}
            <p className="text-[10px] text-slate-500">
              {isAr
                ? 'الخلية الفارغة تترك القيمة الحالية كما هي. نسبة الألومينا من 0 إلى 100، ومحلي/مستورد تُكتب "محلي" أو "مستورد". عمود الوحدة اختياري.'
                : 'An empty cell leaves the current value as it is. Alumina is 0 to 100; write "Local" or "Imported". The unit column is optional.'}
            </p>
          </div>
        )}

        {/* Step 3 - the check, then the import */}
        {plan && !mappingIssue && (
          <>
            <div id="material-price-import-summary" className="flex items-center gap-2 flex-wrap">
              {([['ALL', isAr ? `الكل (${plan.rows.length})` : `All (${plan.rows.length})`],
                ['READY', isAr ? `جاهز (${plan.ready})` : `Ready (${plan.ready})`],
                ['ERROR', isAr ? `أخطاء (${plan.errors})` : `Errors (${plan.errors})`],
                ['UNCHANGED', isAr ? `بدون تغيير (${plan.unchanged})` : `Unchanged (${plan.unchanged})`]] as Array<[RowFilter, string]>).map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-lg font-bold cursor-pointer ${filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
                >
                  {label}
                </button>
              ))}
              {canImport ? (
                <button
                  id="material-price-import-btn"
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={isImporting || plan.ready === 0}
                  className="flex items-center gap-1.5 px-4 py-2 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50 ms-auto"
                >
                  {isImporting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                  {isImporting && progress
                    ? (isAr ? `جاري الحفظ ${progress.done} / ${progress.total}` : `Saving ${progress.done} / ${progress.total}`)
                    : (isAr ? `استيراد البيانات (${plan.ready})` : `Import (${plan.ready})`)}
                </button>
              ) : (
                <span className="ms-auto font-semibold text-slate-500">{isAr ? 'للمراجعة فقط - لا تملك صلاحية تعديل البيانات الأساسية.' : 'Review only - you do not have permission to edit Master Data.'}</span>
              )}
            </div>
            {result && <p id="material-price-import-result" className="font-bold text-slate-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{result}</p>}

            <div className="border border-slate-200 rounded-xl overflow-auto max-h-[50vh]">
              <table id="material-price-import-preview" className="w-full text-[11px] min-w-[1040px]">
                <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10">
                  <tr>
                    <th className="text-start px-2 py-2">{isAr ? 'السطر' : 'Row'}</th>
                    <th className="text-start px-2 py-2">{isAr ? 'الكود' : 'Code'}</th>
                    <th className="text-start px-2 py-2">{isAr ? 'الخامة' : 'Material'}</th>
                    <th className="text-start px-2 py-2">{isAr ? 'آخر سعر شراء' : 'Last purchase price'}</th>
                    <th className="text-start px-2 py-2">{isAr ? 'متوسط سعر المنصرف' : 'Average issue price'}</th>
                    <th className="text-start px-2 py-2">{isAr ? 'السعر لكل' : 'Per'}</th>
                    <th className="text-start px-2 py-2">{isAr ? 'الألومينا %' : 'Alumina %'}</th>
                    <th className="text-start px-2 py-2">{isAr ? 'محلي / مستورد' : 'Local / Imported'}</th>
                    <th className="text-start px-2 py-2">{isAr ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleRows.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">{isAr ? 'لا توجد أسطر' : 'No rows'}</td></tr>
                  )}
                  {visibleRows.slice(0, 1000).map((r) => (
                    <tr key={r.rowNumber} className={r.status === 'ERROR' || writeErrors[r.rowNumber] ? 'bg-rose-50/50' : r.status === 'READY' ? 'bg-emerald-50/40' : ''}>
                      <td className="px-2 py-1.5 font-mono text-slate-500">{r.rowNumber}</td>
                      <td className="px-2 py-1.5 font-mono font-bold">{r.code || '-'}</td>
                      <td className="px-2 py-1.5">{r.materialName || '-'}</td>
                      <td className="px-2 py-1.5">{priceCell(r.current.lastPurchasePrice, r.next.lastPurchasePrice)}</td>
                      <td className="px-2 py-1.5">{priceCell(r.current.averageIssuePrice, r.next.averageIssuePrice)}</td>
                      <td className="px-2 py-1.5">{unitLabel(r.next.priceUnit)}</td>
                      <td className="px-2 py-1.5 font-mono">{valueCell(aluminaText(r.current.aluminaPercentage), aluminaText(r.next.aluminaPercentage))}</td>
                      <td className="px-2 py-1.5">{valueCell(originText(r.current.origin), originText(r.next.origin))}</td>
                      <td className="px-2 py-1.5">
                        {statusBadge(r)}
                        {r.errors.length > 0 && (
                          <div className="text-[10px] font-semibold text-rose-700 mt-0.5">
                            {r.errors.map((e) => (isAr ? PRICE_ROW_ERROR_LABELS[e].ar : PRICE_ROW_ERROR_LABELS[e].en)).join(' - ')}
                          </div>
                        )}
                        {writeErrors[r.rowNumber] && <div className="text-[10px] font-semibold text-rose-700 mt-0.5">{writeErrors[r.rowNumber]}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleRows.length > 1000 && (
              <p className="text-[10px] text-slate-500">{isAr ? `معروض أول 1000 سطر من ${visibleRows.length}.` : `Showing the first 1000 of ${visibleRows.length} rows.`}</p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
};

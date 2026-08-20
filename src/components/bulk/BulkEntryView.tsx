/**
 * SMART PRODUCT BULK IMPORT & MASTER DATA BULK ENTRY VIEW
 * Minimal Input Columns: productCode, productName
 * Automatic derivation of Prefix, Product Type, Alumina %, and Product Identifier.
 * Handles duplicate detection (in file & Firestore), Unknown Prefix with inline Create Type modal,
 * and chunked batch writes.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  UploadCloud, 
  FileSpreadsheet, 
  ClipboardPaste, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  RefreshCw, 
  ArrowRight, 
  Layers, 
  Sparkles,
  Info,
  PlusCircle,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  ChevronDown,
  Filter
} from 'lucide-react';
import { 
  MasterDataTab, 
  BulkImportRow, 
  BulkImportResult, 
  ProductType, 
  NavigationPage 
} from '../../types';
import { 
  MASTER_DATA_SCHEMAS, 
  parseImportFile, 
  parsePastedText, 
  validateImportData, 
  commitBulkImport, 
  downloadMasterDataTemplate 
} from '../../services/bulkImportService';
import { 
  subscribeProductTypes, 
  createProductType 
} from '../../services/productTypeService';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { toWesternDigits } from '../../utils/formatters';

interface BulkEntryViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const BulkEntryView: React.FC<BulkEntryViewProps> = ({ onNavigate }) => {
  const [selectedTab, setSelectedTab] = useState<MasterDataTab>('products');
  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState<string>('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [rawParsedRows, setRawParsedRows] = useState<Record<string, any>[]>([]);

  // Product Types state for live intelligent parsing
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);

  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [validatedRows, setValidatedRows] = useState<BulkImportRow[]>([]);
  const [hasParsed, setHasParsed] = useState<boolean>(false);
  const [filterPreviewStatus, setFilterPreviewStatus] = useState<string>('all');

  // Import Progress & Summary
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

  // Quick Create Product Type Modal State
  const [isCreateTypeModalOpen, setIsCreateTypeModalOpen] = useState<boolean>(false);
  const [newPrefixCode, setNewPrefixCode] = useState<string>('');
  const [newNameEn, setNewNameEn] = useState<string>('');
  const [newNameAr, setNewNameAr] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [createTypeError, setCreateTypeError] = useState<string | null>(null);
  const [isSavingType, setIsSavingType] = useState<boolean>(false);

  // Subscribe to live product types
  useEffect(() => {
    const unsubscribe = subscribeProductTypes(
      (types) => {
        setProductTypes(types);
      },
      (err) => console.warn('Product types listener in Bulk View:', err)
    );
    return () => unsubscribe();
  }, []);

  const currentSchema = MASTER_DATA_SCHEMAS[selectedTab];

  // Re-run validation whenever productTypes changes and we have raw parsed rows
  const revalidateWithTypes = async (typesList: ProductType[], rowsToValidate?: Record<string, any>[]) => {
    const data = rowsToValidate || rawParsedRows;
    if (!data || data.length === 0) return;

    setIsProcessing(true);
    try {
      const rows = await validateImportData(selectedTab, data, typesList);
      setValidatedRows(rows);
      setHasParsed(true);
    } catch (err: any) {
      console.error('Revalidation error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadedFile(file);
    await processRawData(file);
  };

  const handlePasteProcess = async () => {
    if (!pastedText.trim()) return;
    await processRawData(pastedText);
  };

  const processRawData = async (source: File | string) => {
    setIsProcessing(true);
    setImportResult(null);
    try {
      let rawRows: Record<string, any>[] = [];
      if (typeof source === 'string') {
        rawRows = parsePastedText(source);
      } else {
        rawRows = await parseImportFile(source);
      }

      if (rawRows.length === 0) {
        throw new Error('الملف فارغ أو لا يحتوي على صفوف صالحة.');
      }

      setRawParsedRows(rawRows);
      const rows = await validateImportData(selectedTab, rawRows, productTypes);
      setValidatedRows(rows);
      setHasParsed(true);
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء معالجة البيانات.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Open modal to create unknown product type
  const handleOpenCreateType = (prefix: string) => {
    setNewPrefixCode(prefix.toUpperCase());
    setNewNameEn('');
    setNewNameAr('');
    setNewDescription('');
    setCreateTypeError(null);
    setIsCreateTypeModalOpen(true);
  };

  // Submit new Product Type and auto re-validate rows
  const handleSaveProductType = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateTypeError(null);

    const prefix = newPrefixCode.trim().toUpperCase();
    if (!prefix || prefix.length !== 3) {
      setCreateTypeError('بادئة الكود يجب أن تتكون من 3 أحرف لاتينية بالضبط (مثال: BAR, BHA).');
      return;
    }
    if (!newNameEn.trim()) {
      setCreateTypeError('الاسم بالإنجليزية (Name EN) مطلوب.');
      return;
    }

    setIsSavingType(true);
    try {
      await createProductType({
        prefixCode: prefix,
        nameEn: newNameEn.trim(),
        nameAr: newNameAr.trim() || newNameEn.trim(),
        description: newDescription.trim(),
        active: true,
      });

      setIsCreateTypeModalOpen(false);

      // Create a temporary updated product types list to immediately re-validate
      const updatedTypes = [
        ...productTypes,
        {
          prefixCode: prefix,
          nameEn: newNameEn.trim(),
          nameAr: newNameAr.trim() || newNameEn.trim(),
          description: newDescription.trim(),
          active: true,
        }
      ];

      // Re-run parsing for current rows
      await revalidateWithTypes(updatedTypes);
    } catch (err: any) {
      setCreateTypeError(err.message || 'فشل حفظ نوع المنتج في قاعدة البيانات.');
    } finally {
      setIsSavingType(false);
    }
  };

  const handleCommitImport = async () => {
    const validCount = validatedRows.filter(r => r.status === 'valid' || r.status === 'NEW').length;
    if (validCount === 0) {
      alert('لا توجد صفوف صالحة للاستيراد. يرجى مراجعة الأخطاء في الجدول.');
      return;
    }

    setIsImporting(true);
    setProgress({ current: 0, total: validCount });

    try {
      const result = await commitBulkImport(
        selectedTab,
        validatedRows,
        (current, total) => setProgress({ current, total })
      );
      setImportResult(result);
      setValidatedRows([]);
      setRawParsedRows([]);
      setHasParsed(false);
      setUploadedFile(null);
      setPastedText('');
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء حفظ البيانات في Firestore.');
    } finally {
      setIsImporting(false);
    }
  };

  // Metrics
  const totalCount = validatedRows.length;
  const newValidCount = validatedRows.filter(r => r.status === 'valid' || r.status === 'NEW').length;
  const duplicateInFileCount = validatedRows.filter(r => r.status === 'DUPLICATE_IN_FILE').length;
  const duplicateInDbCount = validatedRows.filter(r => r.status === 'DUPLICATE_IN_FIRESTORE').length;
  const unknownTypeCount = validatedRows.filter(r => r.status === 'UNKNOWN_PRODUCT_TYPE').length;
  const invalidCount = validatedRows.filter(r => r.status === 'error' || r.status === 'INVALID').length;

  const filteredPreviewRows = useMemo(() => {
    return validatedRows.filter(r => {
      if (filterPreviewStatus === 'all') return true;
      if (filterPreviewStatus === 'NEW') return r.status === 'NEW' || r.status === 'valid';
      if (filterPreviewStatus === 'DUPLICATE') return r.status === 'DUPLICATE_IN_FILE' || r.status === 'DUPLICATE_IN_FIRESTORE' || r.status === 'duplicate';
      if (filterPreviewStatus === 'UNKNOWN_PRODUCT_TYPE') return r.status === 'UNKNOWN_PRODUCT_TYPE';
      if (filterPreviewStatus === 'INVALID') return r.status === 'INVALID' || r.status === 'error';
      return true;
    });
  }, [validatedRows, filterPreviewStatus]);

  return (
    <div className="space-y-6" dir="rtl">
      {/* Target Entity Selection & Template Downloader */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">
            1. اختر جدول البيانات الأساسية المستهدفة:
          </label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(MASTER_DATA_SCHEMAS) as MasterDataTab[]).map((tabKey) => {
              const isSelected = selectedTab === tabKey;
              return (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => {
                    setSelectedTab(tabKey);
                    setHasParsed(false);
                    setValidatedRows([]);
                    setRawParsedRows([]);
                    setImportResult(null);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {MASTER_DATA_SCHEMAS[tabKey].title}
                </button>
              );
            })}
          </div>
        </div>

        {/* Download Clean Minimal Template */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => downloadMasterDataTemplate(selectedTab, 'xlsx')}
            className="px-3.5 py-2 bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تحميل قالب Excel</span>
          </button>
          <button
            type="button"
            onClick={() => downloadMasterDataTemplate(selectedTab, 'csv')}
            className="px-3 py-2 bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Smart Intelligence Notice for Products */}
      {selectedTab === 'products' && (
        <div className="p-4 bg-indigo-50/80 border border-indigo-200 rounded-2xl flex items-start gap-3 shadow-xs">
          <Sparkles className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div className="text-xs text-indigo-950 space-y-1">
            <p className="font-bold text-indigo-900">
              الاستيراد الذكي للمنتجات الحرارية (Smart Product Derivation):
            </p>
            <p className="text-indigo-800 leading-relaxed">
              يتطلب القالب عمودين فقط: <code className="font-mono bg-indigo-100/80 px-1 py-0.5 rounded text-indigo-900 font-bold">productCode</code> و <code className="font-mono bg-indigo-100/80 px-1 py-0.5 rounded text-indigo-900 font-bold">productName</code>.
              يتم استخراج البادئة، تصنيف نوع المنتج، نسبة الألومينا (الخانتان 4 و 5)، ورقم المعرف التسلسلي تلقائياً بدون أي بيانات مصطنعة.
            </p>
          </div>
        </div>
      )}

      {/* Upload Box / Clipboard Input */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
        {/* Toggle Mode Tabs */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h2 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <span>2. إدخال أو تحميل بيانات: {currentSchema.title}</span>
          </h2>

          <div className="flex items-center bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setInputMode('upload')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                inputMode === 'upload' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>رفع ملف (Excel / CSV)</span>
            </button>
            <button
              type="button"
              onClick={() => setInputMode('paste')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                inputMode === 'paste' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>نسخ ولصق من Sheets/Excel</span>
            </button>
          </div>
        </div>

        {/* Input Mode 1: File Drag & Drop */}
        {inputMode === 'upload' && (
          <div className="border-2 border-dashed border-slate-200 hover:border-indigo-500 rounded-2xl p-8 text-center transition-colors bg-slate-50/50">
            <input
              type="file"
              id="bulk-file-upload"
              accept=".xlsx, .xls, .csv, .tsv"
              onChange={handleFileChange}
              className="hidden"
            />
            <label htmlFor="bulk-file-upload" className="cursor-pointer block space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-700">
                  {uploadedFile ? uploadedFile.name : 'انقر لاختيار ملف أو اسحب الملف هنا'}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  يدعم صيغ Excel (.xlsx, .xls) وصيغ CSV مع مطابقة الأعمدة تلقائياً
                </p>
              </div>
            </label>
          </div>
        )}

        {/* Input Mode 2: Clipboard Paste */}
        {inputMode === 'paste' && (
          <div className="space-y-3">
            <textarea
              rows={6}
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder={`انسخ صف العناوين والبيانات من Excel أو Google Sheets والصقها هنا...\nمثال:\nproductCode\tproductName\nBAR250102305\tطوب مقاوم للأحماض 25%\nBHA70123456\tطوب عالي الألومينا 70%`}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
            />
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handlePasteProcess}
                disabled={!pastedText.trim() || isProcessing}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isProcessing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>معالجة والتحقق من البيانات</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Import Result Notification */}
      {importResult && (
        <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-3 shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="text-xs text-emerald-950 space-y-1">
            <p className="font-bold text-emerald-900 text-sm">
              تم إكمال الاستيراد المجمع بنجاح!
            </p>
            <p className="text-emerald-800">
              تم حفظ <strong className="font-mono">{toWesternDigits(importResult.importedRows)}</strong> سجل جديد في قاعدة البيانات السحابية Firestore وتدوين العملية في سجل التدقيق.
            </p>
            {importResult.duplicateRows > 0 && (
              <p className="text-amber-800 text-[11px]">
                تم تجاوز {toWesternDigits(importResult.duplicateRows)} سجل مكرر مسبقاً لحماية البيانات.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Processing Loader */}
      {isProcessing && (
        <div className="p-8 text-center bg-white rounded-2xl border border-slate-200 text-xs text-slate-500">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <span>جارٍ فحص الأعمدة، استخراج تصنيفات الأكواد الذكية، والتحقق من التكرار السحابي...</span>
        </div>
      )}

      {/* Validation & Preview Section */}
      {hasParsed && !isProcessing && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden space-y-4 p-5">
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Total */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[11px] font-bold text-slate-500">إجمالي الصفوف</span>
              <p className="text-lg font-black text-slate-800 mt-1">{toWesternDigits(totalCount)}</p>
            </div>

            {/* Valid NEW */}
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <span className="text-[11px] font-bold text-emerald-700">سجلات جديدة صالحة</span>
              <p className="text-lg font-black text-emerald-600 mt-1">{toWesternDigits(newValidCount)}</p>
            </div>

            {/* Duplicate in DB */}
            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
              <span className="text-[11px] font-bold text-amber-700">مكرر بقاعدة البيانات</span>
              <p className="text-lg font-black text-amber-600 mt-1">{toWesternDigits(duplicateInDbCount)}</p>
            </div>

            {/* Duplicate in File */}
            <div className="p-3 bg-amber-50/70 rounded-xl border border-amber-200/70">
              <span className="text-[11px] font-bold text-amber-700">مكرر بالملف المرفوع</span>
              <p className="text-lg font-black text-amber-600 mt-1">{toWesternDigits(duplicateInFileCount)}</p>
            </div>

            {/* Unknown Types */}
            <div className="p-3 bg-purple-50 rounded-xl border border-purple-200">
              <span className="text-[11px] font-bold text-purple-700">بادئات غير مسجلة</span>
              <p className="text-lg font-black text-purple-600 mt-1">{toWesternDigits(unknownTypeCount)}</p>
            </div>

            {/* Invalid / Errors */}
            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
              <span className="text-[11px] font-bold text-rose-700">أخطاء وهيكل غير صالح</span>
              <p className="text-lg font-black text-rose-600 mt-1">{toWesternDigits(invalidCount)}</p>
            </div>
          </div>

          {/* Action Banner for Unknown Prefixes */}
          {unknownTypeCount > 0 && selectedTab === 'products' && (
            <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-purple-900">
                <AlertTriangle className="w-4 h-4 text-purple-600 shrink-0" />
                <span>
                  يوجد <strong>{toWesternDigits(unknownTypeCount)}</strong> منتج يحتوي على بادئة غير مسجلة في قائمة <code>productTypes</code>. يمكنك تسجيل البادئة الآن وسيتم إعادة تصنيف الصفوف تلقائياً.
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const firstUnknownRow = validatedRows.find(r => r.status === 'UNKNOWN_PRODUCT_TYPE');
                  const prefix = firstUnknownRow?.derivedData?.prefix || '';
                  handleOpenCreateType(prefix);
                }}
                className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg text-xs transition-colors shrink-0 cursor-pointer"
              >
                + إنشاء نوع منتج جديد
              </button>
            </div>
          )}

          {/* Table Filters & Commit Action Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-2 text-xs w-full sm:w-auto">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-bold text-slate-600">تصفية العرض:</span>
              <select
                value={filterPreviewStatus}
                onChange={(e) => setFilterPreviewStatus(e.target.value)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="all">جميع الصفوف ({toWesternDigits(totalCount)})</option>
                <option value="NEW">الصالحة للاستيراد فقط ({toWesternDigits(newValidCount)})</option>
                <option value="DUPLICATE">المكررة ({toWesternDigits(duplicateInDbCount + duplicateInFileCount)})</option>
                <option value="UNKNOWN_PRODUCT_TYPE">بادئة غير مسجلة ({toWesternDigits(unknownTypeCount)})</option>
                <option value="INVALID">الأخطاء ({toWesternDigits(invalidCount)})</option>
              </select>
            </div>

            {/* Commit Button */}
            <button
              type="button"
              id="btn-commit-bulk-import"
              disabled={newValidCount === 0 || isImporting}
              onClick={handleCommitImport}
              className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isImporting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>جارٍ الاستيراد ({progress.current}/{progress.total})...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تأكيد استيراد {toWesternDigits(newValidCount)} منتج جديد</span>
                </>
              )}
            </button>
          </div>

          {/* Data Preview Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="p-3 text-center">#</th>
                  <th className="p-3">الحالة (Status)</th>
                  <th className="p-3">كود المنتج (Code)</th>
                  <th className="p-3">اسم المنتج (Name)</th>
                  {selectedTab === 'products' ? (
                    <>
                      <th className="p-3">البادئة (Prefix)</th>
                      <th className="p-3">نوع المنتج (Product Type)</th>
                      <th className="p-3">نسبة الألومينا</th>
                      <th className="p-3">المعرف التسلسلي</th>
                    </>
                  ) : (
                    currentSchema.fields.map(f => <th key={f.key} className="p-3">{f.label}</th>)
                  )}
                  <th className="p-3">الملاحظات / الأخطاء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPreviewRows.map((row) => {
                  const isNew = row.status === 'NEW' || row.status === 'valid';
                  const isDupFile = row.status === 'DUPLICATE_IN_FILE';
                  const isDupDb = row.status === 'DUPLICATE_IN_FIRESTORE' || row.status === 'duplicate';
                  const isUnknown = row.status === 'UNKNOWN_PRODUCT_TYPE';
                  const isInvalid = row.status === 'INVALID' || row.status === 'error';

                  return (
                    <tr 
                      key={row.rowNumber} 
                      className={`hover:bg-slate-50/80 transition-colors ${
                        isNew ? 'bg-emerald-50/20' : isUnknown ? 'bg-purple-50/20' : isInvalid ? 'bg-rose-50/20' : ''
                      }`}
                    >
                      {/* Row Number */}
                      <td className="p-3 text-center text-slate-400 font-mono text-[11px]">
                        {toWesternDigits(row.rowNumber)}
                      </td>

                      {/* Status Badge */}
                      <td className="p-3">
                        {isNew && (
                          <Badge variant="success">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>NEW</span>
                          </Badge>
                        )}
                        {isDupFile && (
                          <Badge variant="warning">
                            <span>DUPLICATE_IN_FILE</span>
                          </Badge>
                        )}
                        {isDupDb && (
                          <Badge variant="warning">
                            <span>DUPLICATE_IN_FIRESTORE</span>
                          </Badge>
                        )}
                        {isUnknown && (
                          <Badge variant="neutral">
                            <AlertTriangle className="w-3 h-3 text-purple-600" />
                            <span className="text-purple-800 font-bold">UNKNOWN_PRODUCT_TYPE</span>
                          </Badge>
                        )}
                        {isInvalid && (
                          <Badge variant="danger">
                            <XCircle className="w-3 h-3" />
                            <span>INVALID</span>
                          </Badge>
                        )}
                      </td>

                      {/* Product Code */}
                      <td className="p-3 font-mono font-bold text-slate-800">
                        {row.derivedData?.productCode || row.data.productCode || row.data.code || '-'}
                      </td>

                      {/* Product Name */}
                      <td className="p-3 font-bold text-slate-700">
                        {row.derivedData?.productName || row.data.productName || row.data.name || '-'}
                      </td>

                      {/* Product Intelligence Derived Columns */}
                      {selectedTab === 'products' ? (
                        <>
                          {/* Prefix */}
                          <td className="p-3 font-mono font-bold text-indigo-600">
                            {row.derivedData?.prefix || '-'}
                          </td>

                          {/* Product Type */}
                          <td className="p-3 text-slate-700">
                            {row.derivedData?.productTypeName ? (
                              <div>
                                <p className="font-bold text-slate-800">{row.derivedData.productTypeName}</p>
                                {row.derivedData.productTypeNameAr && (
                                  <p className="text-[10px] text-slate-500">{row.derivedData.productTypeNameAr}</p>
                                )}
                              </div>
                            ) : isUnknown ? (
                              <span className="text-purple-600 text-[11px] font-bold">غير معرف</span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          {/* Alumina % */}
                          <td className="p-3 font-mono text-slate-700">
                            {row.derivedData?.aluminaPercentage !== undefined ? (
                              <span className="inline-block px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded font-bold">
                                {toWesternDigits(row.derivedData.aluminaPercentage)}%
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          {/* Product Identifier */}
                          <td className="p-3 font-mono text-slate-600">
                            {row.derivedData?.productIdentifier ? toWesternDigits(row.derivedData.productIdentifier) : '-'}
                          </td>
                        </>
                      ) : (
                        currentSchema.fields.map(f => (
                          <td key={f.key} className="p-3 text-slate-700">
                            {String(row.data[f.key] !== undefined ? row.data[f.key] : '-')}
                          </td>
                        ))
                      )}

                      {/* Errors & Inline Actions */}
                      <td className="p-3">
                        {row.errors.length > 0 ? (
                          <div className="space-y-1">
                            {row.errors.map((err, idx) => (
                              <p key={idx} className="text-[11px] text-rose-600 flex items-center gap-1">
                                <span>&bull;</span>
                                <span>{err}</span>
                              </p>
                            ))}
                            {isUnknown && row.derivedData?.prefix && (
                              <button
                                type="button"
                                onClick={() => handleOpenCreateType(row.derivedData!.prefix)}
                                className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 hover:bg-purple-200 text-purple-800 text-[10px] font-bold rounded cursor-pointer transition-colors"
                              >
                                <PlusCircle className="w-3 h-3" />
                                <span>إضافة النوع ({row.derivedData.prefix})</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-emerald-600 text-[11px] flex items-center gap-1 font-bold">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>جاهز للاستيراد</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* QUICK MODAL: Create Unknown Product Type from Bulk Import Preview */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isCreateTypeModalOpen}
        onClose={() => setIsCreateTypeModalOpen(false)}
        title="إنشاء تصنيف نوع منتج جديد (Product Type)"
        subtitle="سيتم حفظ التصنيف في Firestore وإعادة تصنيف المنتجات المعلقة فوراً"
        maxWidth="md"
      >
        <form onSubmit={handleSaveProductType} className="space-y-4" dir="rtl">
          {createTypeError && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
              <span>{createTypeError}</span>
            </div>
          )}

          {/* Prefix Code */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              بادئة الكود (Prefix Code - 3 أحرف لاتينية) *
            </label>
            <input
              type="text"
              required
              maxLength={3}
              value={newPrefixCode}
              onChange={(e) => setNewPrefixCode(e.target.value.toUpperCase())}
              placeholder="مثال: BAR"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono font-bold text-slate-800 uppercase focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Name EN */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              اسم نوع المنتج بالإنجليزية (Name EN) *
            </label>
            <input
              type="text"
              required
              value={newNameEn}
              onChange={(e) => setNewNameEn(e.target.value)}
              placeholder="e.g. Bricks Acid Resistance"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Name AR */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              اسم نوع المنتج بالعربية (Name AR)
            </label>
            <input
              type="text"
              value={newNameAr}
              onChange={(e) => setNewNameAr(e.target.value)}
              placeholder="مثال: طوب مقاوم للأحماض"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              الوصف / البيان
            </label>
            <textarea
              rows={2}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="وصف وتطبيقات تصنيف المنتج..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsCreateTypeModalOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={isSavingType}
              className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {isSavingType ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>جارٍ الحفظ وإعادة التصنيف...</span>
                </>
              ) : (
                <span>حفظ وإعادة تصنيف الصفوف</span>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

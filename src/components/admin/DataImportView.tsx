/**
 * ASFOUR Factory Management ERP - Historical Data Import Center
 * 
 * Specialized Historical Excel Importer:
 * - Full support for مرحلة التشكيل والمكابس (Pressing) with 21 strict columns.
 * - Deep validation: Multi-worker resolution, multi-furnace car splitting,
 *   press & shift (1/2) resolution, smart vs manual product code intelligence,
 *   fault summation breakdown verification, in-file & database duplicate checks.
 * - Pre-import safety: One-click Firestore Backup generation.
 * - Granular preview with multi-status filtering & diagnostics.
 * - Safe chunked batch commits (400 per batch) and complete audit logging.
 */
import React, { useState } from 'react';
import { 
  FileSpreadsheet, 
  UploadCloud, 
  Download, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle, 
  FileText, 
  Loader2, 
  Database,
  RefreshCw,
  ShieldCheck,
  Users,
  Layers,
  Sparkles,
  Info,
  Copy,
  SlidersHorizontal,
  ChevronDown
} from 'lucide-react';
import { 
  ProductionStageType, 
  PressingImportSummary, 
  PressingImportRow, 
  PressingImportStatus 
} from '../../types';
import { 
  downloadStageExcelTemplate, 
  downloadPressingExcelTemplate,
  parseAndValidatePressingExcel,
  executePressingBatchImport,
  parseExcelFile, 
  validateImportRows, 
  executeBatchImport,
  StageImportRow,
  ImportValidationResult
} from '../../services/historicalImportService';
import { STAGE_DISPLAY_NAMES } from '../../services/stageRecordService';
import { createDatabaseBackup } from '../../services/backupService';
import { Badge } from '../common/Badge';
import { formatNumber, formatDecimal } from '../../utils/formatters';

type FilterTab = 'ALL' | 'VALID' | 'WARNINGS' | 'ERRORS' | 'DUPLICATES';

export const DataImportView: React.FC = () => {
  const [selectedStage, setSelectedStage] = useState<ProductionStageType>('pressing');
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  
  // Pressing Stage Dedicated State
  const [pressingSummary, setPressingSummary] = useState<PressingImportSummary | null>(null);
  const [activeFilterTab, setActiveFilterTab] = useState<FilterTab>('ALL');
  
  // Generic Stage Fallback State (for other 7 stages)
  const [genericRawRows, setGenericRawRows] = useState<StageImportRow[]>([]);
  const [genericValidation, setGenericValidation] = useState<ImportValidationResult | null>(null);
  const [autoCreateMasterData, setAutoCreateMasterData] = useState<boolean>(true);

  // Import Execution & Safety
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [backupStatusMessage, setBackupStatusMessage] = useState<string | null>(null);
  
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [currentBatchNum, setCurrentBatchNum] = useState<number>(0);
  const [totalBatchCount, setTotalBatchCount] = useState<number>(0);
  const [importResult, setImportResult] = useState<{
    total: number;
    imported: number;
    failed: number;
    skipped: number;
    importId: string;
  } | null>(null);

  // Clear all parsed state when switching stage or uploading new file
  const resetFileState = () => {
    setFile(null);
    setPressingSummary(null);
    setGenericRawRows([]);
    setGenericValidation(null);
    setImportResult(null);
    setImportProgress(0);
    setActiveFilterTab('ALL');
  };

  const handleStageChange = (newStage: ProductionStageType) => {
    setSelectedStage(newStage);
    resetFileState();
  };

  const handleFileDrop = async (e: React.DragEvent | React.ChangeEvent<HTMLInputElement>) => {
    let uploadedFile: File | null = null;
    if ('dataTransfer' in e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        uploadedFile = e.dataTransfer.files[0];
      }
    } else if (e.target.files && e.target.files[0]) {
      uploadedFile = e.target.files[0];
    }

    if (!uploadedFile) return;
    setFile(uploadedFile);
    setIsParsing(true);
    setImportResult(null);

    try {
      if (selectedStage === 'pressing') {
        const buffer = await uploadedFile.arrayBuffer();
        const summary = await parseAndValidatePressingExcel(buffer);
        setPressingSummary(summary);
      } else {
        const rows = await parseExcelFile(uploadedFile);
        setGenericRawRows(rows);
        const valResult = await validateImportRows(selectedStage, rows);
        setGenericValidation(valResult);
      }
    } catch (err: any) {
      console.error('File parsing error:', err);
      alert('فشل قراءة ملف الـ Excel: ' + (err.message || 'تأكد من تنسيق الأعطال والبيانات'));
    } finally {
      setIsParsing(false);
    }
  };

  // One-click Backup before Import
  const handleCreateSafetyBackup = async () => {
    setIsCreatingBackup(true);
    setBackupStatusMessage('جاري توليد نسخة احتياطية وقائية وحفظها...');
    try {
      const backup = await createDatabaseBackup(
        'PRE_IMPORT',
        `نسخة أمان وقائية قبل استيراد الإنتاج التاريخي لمرحلة ${STAGE_DISPLAY_NAMES[selectedStage]}`,
        (stage, pct) => setBackupStatusMessage(`${stage} (${pct}%)`),
        true
      );
      setBackupId(backup.backupId);
      setBackupStatusMessage(`تم إنشاء النسخة الوقائية بنجاح (${backup.backupId}) وتنزيل الملف.`);
    } catch (err: any) {
      console.error('Backup creation error:', err);
      setBackupStatusMessage('تعذر إنشاء النسخة الاحتياطية تلقائياً: ' + err.message);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  // Start Actual Import
  const handleStartImport = async () => {
    if (selectedStage === 'pressing') {
      if (!pressingSummary) return;
      const validAndWarningRows = pressingSummary.rows.filter(r => r.errors.length === 0);
      if (validAndWarningRows.length === 0) {
        alert('لا توجد صفوف صالحة للاستيراد. يرجى تصحيح الأخطاء أولاً.');
        return;
      }

      setIsImporting(true);
      setImportProgress(0);
      try {
        const result = await executePressingBatchImport(
          validAndWarningRows,
          backupId || undefined,
          (pct, currBatch, totBatches) => {
            setImportProgress(pct);
            setCurrentBatchNum(currBatch);
            setTotalBatchCount(totBatches);
          }
        );

        setImportResult({
          total: pressingSummary.totalRows,
          imported: result.importedCount,
          failed: result.failedCount,
          skipped: result.skippedCount,
          importId: result.importId,
        });
        setPressingSummary(null);
      } catch (err: any) {
        alert('حدث خطأ أثناء تنفيذ الاستيراد: ' + (err.message || 'خطأ غير معروف'));
      } finally {
        setIsImporting(false);
      }
    } else {
      // Generic stages fallback
      if (!genericValidation || genericValidation.validRows.length === 0) return;
      setIsImporting(true);
      setImportProgress(0);
      try {
        const summary = await executeBatchImport(
          selectedStage,
          genericValidation.validRows,
          autoCreateMasterData,
          (progress) => setImportProgress(progress)
        );
        setImportResult({
          total: genericValidation.validRows.length,
          imported: summary.success,
          failed: summary.errors.length,
          skipped: genericValidation.errors.length,
          importId: `IMPORT-${Date.now()}`,
        });
        setGenericRawRows([]);
        setGenericValidation(null);
      } catch (err: any) {
        alert('حدث خطأ أثناء الاستيراد: ' + (err.message || 'خطأ غير معروف'));
      } finally {
        setIsImporting(false);
      }
    }
  };

  // Filter pressing rows based on active tab
  const getFilteredPressingRows = (): PressingImportRow[] => {
    if (!pressingSummary) return [];
    switch (activeFilterTab) {
      case 'VALID':
        return pressingSummary.rows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate);
      case 'WARNINGS':
        return pressingSummary.rows.filter(r => r.warnings.length > 0 && r.errors.length === 0);
      case 'ERRORS':
        return pressingSummary.rows.filter(r => r.errors.length > 0);
      case 'DUPLICATES':
        return pressingSummary.rows.filter(r => r.isDuplicate);
      case 'ALL':
      default:
        return pressingSummary.rows;
    }
  };

  const filteredPressingRows = getFilteredPressingRows();

  // Helper for Status Badge Rendering
  const renderStatusBadge = (row: PressingImportRow) => {
    if (row.errors.length > 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-800 border border-red-200">
          <AlertCircle className="w-3 h-3 text-red-600" />
          {row.status === 'UNKNOWN_EMPLOYEE' && 'عامل غير مسجل'}
          {row.status === 'EMPLOYEE_MISMATCH' && 'تعارض كود العامل'}
          {row.status === 'UNKNOWN_PRODUCT' && 'صنف غير مسجل'}
          {row.status === 'PRODUCT_MISMATCH' && 'تعارض كود الصنف'}
          {row.status === 'UNKNOWN_PRESS' && 'مكبس غير مسجل'}
          {row.status === 'UNKNOWN_FURNACE_CAR' && 'عربة فرن غير مسجلة'}
          {row.status === 'INVALID_SHIFT' && 'وردية غير صالحة'}
          {row.status === 'INVALID_DATE' && 'تاريخ غير صالح'}
          {row.status === 'INVALID_NUMBER' && 'أرقام غير صالحة'}
          {row.status === 'DUPLICATE_IN_FILE' && 'تكرار في الملف'}
          {row.status === 'INVALID_ROW' && 'خطأ بالبيانات'}
        </span>
      );
    }

    if (row.warnings.length > 0 || row.isDuplicate) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          {row.status === 'FAULT_TOTAL_MISMATCH' && 'فروق أعطال'}
          {row.status === 'MISSING_PIECE_WEIGHT' && 'وزن مفقود'}
          {row.status === 'DUPLICATE_IN_DATABASE' && 'مكرر في النظام'}
          {row.status === 'WARNING' && 'تنبيه'}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
        جاهز
      </span>
    );
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
            مركز استيراد بيانات الإنتاج التاريخي (Historical Production Import)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            استيراد السجلات السابقة عبر ملفات Excel الرسمية مع المطابقة الذكية للبيانات الأساسية وتدقيق الأعطال
          </p>
        </div>

        <button
          type="button"
          onClick={() => downloadStageExcelTemplate(selectedStage)}
          className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
          تحميل قالب Excel الرسمي ({STAGE_DISPLAY_NAMES[selectedStage]})
        </button>
      </div>

      {/* Stage Selector Tabs */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-bold text-slate-700">
            اختر المرحلة الإنتاجية المراد استيراد بياناتها:
          </label>
          {selectedStage === 'pressing' && (
            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              تنسيق المكابس المتقدم (21 عمود معتمد)
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {(Object.keys(STAGE_DISPLAY_NAMES) as ProductionStageType[]).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => handleStageChange(st)}
              className={`p-2.5 text-center text-xs font-bold rounded-xl border transition-all cursor-pointer ${
                selectedStage === st
                  ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {STAGE_DISPLAY_NAMES[st]}
            </button>
          ))}
        </div>
      </div>

      {/* Safety & Backup Banner */}
      <div className="bg-linear-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xs font-black text-blue-950">
              إجراء وقائي: أخذ نسخة احتياطية فورية قبل الاستيراد
            </h3>
            <p className="text-[11px] text-blue-800 mt-0.5">
              يوصى بشدة بإنشاء نسخة احتياطية من قاعدة البيانات الحالية لضمان استرجاع البيانات بأمان في أي وقت.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {backupId ? (
            <span className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              النسخة الوقائية جاهزة ({backupId})
            </span>
          ) : (
            <button
              type="button"
              disabled={isCreatingBackup}
              onClick={handleCreateSafetyBackup}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isCreatingBackup ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  <span>إنشاء نسخة احتياطية وقائية الآن</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
      {backupStatusMessage && (
        <div className="text-[11px] font-bold text-blue-900 bg-blue-100/60 px-4 py-1.5 rounded-xl border border-blue-200">
          {backupStatusMessage}
        </div>
      )}

      {/* Upload Dropzone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
        className="bg-white rounded-2xl border-2 border-dashed border-slate-300 hover:border-emerald-500 p-8 sm:p-12 text-center transition-colors relative cursor-pointer"
      >
        <input
          type="file"
          accept=".xlsx, .xls, .csv"
          onChange={handleFileDrop}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        <div className="flex flex-col items-center justify-center space-y-3 pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shadow-xs">
            <UploadCloud className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              اسحب وأفلت ملف Excel لمرحلة ({STAGE_DISPLAY_NAMES[selectedStage]}) هنا أو اضغط للاختيار
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              يدعم ملفات .xlsx و .csv. يتم معالجة الصفوف في دفعات سريعة من 400 سجل.
            </p>
          </div>
          {file && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-100 text-emerald-900 rounded-lg text-xs font-bold font-mono">
              <FileText className="w-3.5 h-3.5" />
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </span>
          )}
        </div>
      </div>

      {isParsing && (
        <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center flex flex-col items-center gap-2">
          <Loader2 className="w-7 h-7 animate-spin text-emerald-600" />
          <span className="text-xs font-bold text-slate-600">
            جاري قراءة وفحص أعمدة وبيانات ملف Excel والمطابقة مع البيانات الأساسية...
          </span>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PRESSING STAGE SPECIFIC RICH PREVIEW & VALIDATION SUMMARY                 */}
      {/* ========================================================================= */}
      {selectedStage === 'pressing' && pressingSummary && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-6 animate-in fade-in duration-200">
          {/* Header & Metrics */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                نتيجة الفحص الشامل لاستيراد المكابس (Pressing Import Dry-Run)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تم تدقيق {pressingSummary.totalRows} صف في الملف المرفوع وفق الأعمدة الـ 21 المعتمدة
              </p>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <span className="text-[11px] font-bold text-slate-500 block">إجمالي الصفوف</span>
                <span className="text-base font-black text-slate-900">{pressingSummary.totalRows}</span>
              </div>
              <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-center">
                <span className="text-[11px] font-bold text-emerald-700 block">جاهز للاستيراد</span>
                <span className="text-base font-black text-emerald-600">{pressingSummary.validRows}</span>
              </div>
              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-center">
                <span className="text-[11px] font-bold text-amber-800 block">تنبيهات وفروق</span>
                <span className="text-base font-black text-amber-600">{pressingSummary.warningRows}</span>
              </div>
              <div className="p-2.5 bg-red-50 rounded-xl border border-red-200 text-center">
                <span className="text-[11px] font-bold text-red-800 block">أخطاء مانعة</span>
                <span className="text-base font-black text-red-600">{pressingSummary.errorRows}</span>
              </div>
            </div>
          </div>

          {/* Diagnostic Breakdown Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">عمال غير مسجلين</span>
              <span className={`text-xs font-black ${pressingSummary.unknownEmployeesCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownEmployeesCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">أصناف غير مسجلة</span>
              <span className={`text-xs font-black ${pressingSummary.unknownProductsCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownProductsCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">مكابس غير مسجلة</span>
              <span className={`text-xs font-black ${pressingSummary.unknownPressesCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownPressesCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">عربات غير مسجلة</span>
              <span className={`text-xs font-black ${pressingSummary.unknownFurnaceCarsCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownFurnaceCarsCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">أخطاء الوردية (1/2)</span>
              <span className={`text-xs font-black ${pressingSummary.shiftErrorsCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.shiftErrorsCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">فروق مجموع الأعطال</span>
              <span className={`text-xs font-black ${pressingSummary.faultMismatchesCount > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                {pressingSummary.faultMismatchesCount}
              </span>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200 pb-2 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveFilterTab('ALL')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              كافة الصفوف ({pressingSummary.totalRows})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilterTab('VALID')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'VALID'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              جاهزة وسليمة ({pressingSummary.validRows})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilterTab('WARNINGS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'WARNINGS'
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
            >
              تنبيهات وفروق ({pressingSummary.warningRows})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilterTab('ERRORS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'ERRORS'
                  ? 'bg-red-600 text-white'
                  : 'bg-red-50 text-red-800 hover:bg-red-100'
              }`}
            >
              أخطاء مانعة ({pressingSummary.errorRows})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilterTab('DUPLICATES')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'DUPLICATES'
                  ? 'bg-purple-600 text-white'
                  : 'bg-purple-50 text-purple-800 hover:bg-purple-100'
              }`}
            >
              سجلات مكررة ({pressingSummary.duplicateRows})
            </button>
          </div>

          {/* Full Rich Preview Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>معاينة الصفوف المفحوصة ({filteredPressingRows.length} صف معروض):</span>
              <span className="text-[11px] text-slate-400 font-mono">21 عمود مطابق لقالب المكابس</span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-96">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-700 font-black sticky top-0 z-10 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2.5 whitespace-nowrap">م</th>
                    <th className="p-2.5 whitespace-nowrap">الحالة</th>
                    <th className="p-2.5 whitespace-nowrap">التاريخ</th>
                    <th className="p-2.5 whitespace-nowrap">عامل 1 (الاسم / السجل)</th>
                    <th className="p-2.5 whitespace-nowrap">عامل 2 (الاسم / السجل)</th>
                    <th className="p-2.5 whitespace-nowrap">رقم العربات</th>
                    <th className="p-2.5 whitespace-nowrap">المكبس</th>
                    <th className="p-2.5 whitespace-nowrap">طلب العميل</th>
                    <th className="p-2.5 whitespace-nowrap">الوردية</th>
                    <th className="p-2.5 whitespace-nowrap">كود الصنف</th>
                    <th className="p-2.5 whitespace-nowrap">اسم الصنف</th>
                    <th className="p-2.5 whitespace-nowrap">الألومينا %</th>
                    <th className="p-2.5 whitespace-nowrap">وزن القطعة</th>
                    <th className="p-2.5 whitespace-nowrap">الإنتاج</th>
                    <th className="p-2.5 whitespace-nowrap">الهالك</th>
                    <th className="p-2.5 whitespace-nowrap">ميكانيكا</th>
                    <th className="p-2.5 whitespace-nowrap">كهرباء</th>
                    <th className="p-2.5 whitespace-nowrap">ورشة</th>
                    <th className="p-2.5 whitespace-nowrap">خامات</th>
                    <th className="p-2.5 whitespace-nowrap">أخرى</th>
                    <th className="p-2.5 whitespace-nowrap">إجمالي الأعطال (محسوب / ملف)</th>
                    <th className="p-2.5 whitespace-nowrap min-w-[220px]">الملاحظات والأخطاء</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {filteredPressingRows.map((row) => (
                    <tr 
                      key={row.rowIndex}
                      className={`hover:bg-slate-50 transition-colors ${
                        row.errors.length > 0 
                          ? 'bg-red-50/40' 
                          : row.warnings.length > 0 
                            ? 'bg-amber-50/30' 
                            : ''
                      }`}
                    >
                      <td className="p-2.5 font-bold text-slate-500">{row.rowIndex}</td>
                      <td className="p-2.5">{renderStatusBadge(row)}</td>
                      <td className="p-2.5 whitespace-nowrap text-slate-900 font-bold">{row.date || '-'}</td>
                      
                      {/* Worker 1 */}
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-sans font-bold text-slate-900">{row.worker1Name || '-'}</div>
                        <div className="text-[10px] text-slate-500">كود: {row.worker1Code || '-'}</div>
                      </td>

                      {/* Worker 2 */}
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-sans font-bold text-slate-700">{row.worker2Name || '-'}</div>
                        {row.worker2Code && <div className="text-[10px] text-slate-500">كود: {row.worker2Code}</div>}
                      </td>

                      {/* Furnace Cars */}
                      <td className="p-2.5 whitespace-nowrap font-bold text-blue-700">
                        {row.furnaceCarsRaw || '-'}
                      </td>

                      {/* Press */}
                      <td className="p-2.5 whitespace-nowrap font-sans font-bold text-slate-800">
                        {row.resolvedPress?.name || row.pressRaw || '-'}
                      </td>

                      {/* Customer Order */}
                      <td className="p-2.5 whitespace-nowrap font-sans text-slate-700">
                        {row.customerOrder || '-'}
                      </td>

                      {/* Shift */}
                      <td className="p-2.5 whitespace-nowrap font-bold text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] ${row.resolvedShift ? 'bg-slate-100 text-slate-800' : 'bg-red-100 text-red-800'}`}>
                          {row.resolvedShift?.name || row.shiftRaw || '-'}
                        </span>
                      </td>

                      {/* Product Code */}
                      <td className="p-2.5 whitespace-nowrap font-bold text-indigo-700">
                        {row.productCodeRaw || '-'}
                      </td>

                      {/* Product Name */}
                      <td className="p-2.5 whitespace-nowrap font-sans font-bold text-slate-900">
                        {row.resolvedProduct?.name || row.productNameRaw || '-'}
                      </td>

                      {/* Alumina % */}
                      <td className="p-2.5 whitespace-nowrap text-center font-bold text-purple-700">
                        {row.aluminaPercentage}%
                      </td>

                      {/* Piece Weight */}
                      <td className="p-2.5 whitespace-nowrap text-center">
                        {row.pieceWeight > 0 ? `${row.pieceWeight} كجم` : '-'}
                      </td>

                      {/* Production & Waste */}
                      <td className="p-2.5 whitespace-nowrap text-emerald-700 font-bold text-center">
                        {formatNumber(row.productionQuantity)}
                      </td>
                      <td className="p-2.5 whitespace-nowrap text-red-700 font-bold text-center">
                        {formatNumber(row.wasteQuantity)}
                      </td>

                      {/* Faults breakdown */}
                      <td className="p-2.5 text-center text-slate-600">{row.mechanicalFaults || 0}</td>
                      <td className="p-2.5 text-center text-slate-600">{row.electricalFaults || 0}</td>
                      <td className="p-2.5 text-center text-slate-600">{row.workshopFaults || 0}</td>
                      <td className="p-2.5 text-center text-slate-600">{row.rawMaterialFaults || 0}</td>
                      <td className="p-2.5 text-center text-slate-600">{row.otherFaults || 0}</td>

                      {/* Calculated vs Excel Total Faults */}
                      <td className="p-2.5 whitespace-nowrap text-center font-bold">
                        <span className="text-slate-900">{row.calculatedTotalFaults} د</span>
                        {row.excelTotalFaults !== undefined && (
                          <span className={`text-[10px] mr-1 ${row.excelTotalFaults === row.calculatedTotalFaults ? 'text-slate-400' : 'text-amber-700 font-bold'}`}>
                            ({row.excelTotalFaults} د)
                          </span>
                        )}
                      </td>

                      {/* Notes / Issues */}
                      <td className="p-2.5 font-sans">
                        {row.errors.length > 0 ? (
                          <div className="text-red-700 font-bold text-[11px] space-y-0.5">
                            {row.errors.map((e, idx) => (
                              <div key={idx}>• {e}</div>
                            ))}
                          </div>
                        ) : row.warnings.length > 0 ? (
                          <div className="text-amber-800 text-[11px] space-y-0.5">
                            {row.warnings.map((w, idx) => (
                              <div key={idx}>• {w}</div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-emerald-700 text-[11px] font-bold">بيانات مطابقة تماماً</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Footer */}
          {isImporting ? (
            <div className="space-y-3 pt-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  جاري استيراد الدفعة {currentBatchNum} من {totalBatchCount} إلى قاعدة بيانات الإنتاج (Firestore)...
                </span>
                <span>{importProgress}%</span>
              </div>
              <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-slate-100">
              <div className="text-xs text-slate-600">
                <span>سيتم استيراد: </span>
                <strong className="text-emerald-700 font-bold">
                  {pressingSummary.validRows + pressingSummary.warningRows} سجل
                </strong>
                {pressingSummary.errorRows > 0 && (
                  <span className="text-red-600 mr-1">
                    (سيتم تخطي {pressingSummary.errorRows} سجل خطأ تلقائياً)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPressingSummary(null)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  إلغاء المعاينة
                </button>
                <button
                  type="button"
                  disabled={pressingSummary.validRows + pressingSummary.warningRows === 0}
                  onClick={handleStartImport}
                  className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  تنفيذ الاستيراد الفعلي ({pressingSummary.validRows + pressingSummary.warningRows} سجل)
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* GENERIC DRY-RUN FOR OTHER 7 STAGES (FALLBACK)                             */}
      {/* ========================================================================= */}
      {selectedStage !== 'pressing' && genericValidation && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                نتيجة الفحص الأولي لمرحلة {STAGE_DISPLAY_NAMES[selectedStage]}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تم فحص {genericRawRows.length} صف في الملف المرفوع
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">صفوف جاهزة</span>
                <span className="text-base font-black text-emerald-600">{genericValidation.validRows.length}</span>
              </div>
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">أخطاء</span>
                <span className="text-base font-black text-red-600">{genericValidation.errors.length}</span>
              </div>
            </div>
          </div>

          {/* Action */}
          {isImporting ? (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>جاري إرسال السجلات إلى Firestore...</span>
                <span>{importProgress}%</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${importProgress}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setGenericValidation(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={genericValidation.validRows.length === 0}
                onClick={handleStartImport}
                className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                تنفيذ الاستيراد ({genericValidation.validRows.length} سجل)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Post-Import Audit Summary */}
      {importResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-4 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-black text-emerald-950">
              تم الانتهاء من عملية الاستيراد التاريخي لمرحلة ({STAGE_DISPLAY_NAMES[selectedStage]}) بنجاح!
            </h2>
            <p className="text-xs text-emerald-800 font-mono mt-1">
              رقم العملية الموثقة: {importResult.importId} {backupId ? `| رقم النسخة الوقائية: ${backupId}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-bold text-emerald-900 bg-white/70 p-4 rounded-xl border border-emerald-200 max-w-xl mx-auto">
            <div>
              <span className="text-slate-500 block text-[11px]">إجمالي السجلات</span>
              <span className="text-base font-black text-slate-800">{importResult.total}</span>
            </div>
            <div>
              <span className="text-emerald-700 block text-[11px]">تم استيرادها بنجاح</span>
              <span className="text-base font-black text-emerald-600">{importResult.imported}</span>
            </div>
            <div>
              <span className="text-amber-700 block text-[11px]">تم تخطيها</span>
              <span className="text-base font-black text-amber-600">{importResult.skipped}</span>
            </div>
            {importResult.failed > 0 && (
              <div>
                <span className="text-red-700 block text-[11px]">فشلت</span>
                <span className="text-base font-black text-red-600">{importResult.failed}</span>
              </div>
            )}
          </div>

          <p className="text-[11px] text-emerald-700 font-sans">
            السجلات المستوردة متاحة الآن فورياً في سجلات الإنتاج، لوحة المتابعة، التقارير التحليلية، ومساعد الذكاء الاصطناعي.
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * Historical Data Import Center (استيراد البيانات والإنتاج التاريخي)
 * Features:
 * - Download standard Arabic Excel templates for all 8 production stages
 * - Drag-and-drop / file upload for .xlsx and .csv files
 * - Pre-import Dry-run schema validation with real-time error table
 * - Missing master data resolution (automatic on-the-fly creation toggle)
 * - Atomic Firestore batch chunking (up to 500 records per batch)
 * - Post-import audit summary
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
  ArrowRight,
  Database,
  RefreshCw,
  Plus
} from 'lucide-react';
import { ProductionStageType } from '../../types';
import { 
  downloadStageExcelTemplate, 
  parseExcelFile, 
  validateImportRows, 
  executeBatchImport,
  StageImportRow,
  ImportValidationResult
} from '../../services/historicalImportService';
import { STAGE_DISPLAY_NAMES } from '../../services/stageRecordService';

export const DataImportView: React.FC = () => {
  const [selectedStage, setSelectedStage] = useState<ProductionStageType>('pressing');
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [rawRows, setRawRows] = useState<StageImportRow[]>([]);
  const [validation, setValidation] = useState<ImportValidationResult | null>(null);
  
  // Options
  const [autoCreateMasterData, setAutoCreateMasterData] = useState<boolean>(true);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [importSummary, setImportSummary] = useState<{ total: number; success: number; errors: number } | null>(null);

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
    setImportSummary(null);

    try {
      const rows = await parseExcelFile(uploadedFile);
      setRawRows(rows);

      // Validate parsed rows
      const valResult = await validateImportRows(selectedStage, rows);
      setValidation(valResult);
    } catch (err: any) {
      alert('فشل قراءة الملف: ' + (err.message || 'تأكد من صيغة Excel'));
    } finally {
      setIsParsing(false);
    }
  };

  const handleStartImport = async () => {
    if (!validation || validation.validRows.length === 0) return;

    setIsImporting(true);
    setImportProgress(0);
    try {
      const summary = await executeBatchImport(
        selectedStage,
        validation.validRows,
        autoCreateMasterData,
        (progress) => setImportProgress(progress)
      );

      setImportSummary({
        total: summary.total,
        success: summary.success,
        errors: summary.errors.length,
      });
      // Reset rows after success
      setRawRows([]);
      setValidation(null);
    } catch (err: any) {
      alert('حدث خطأ أثناء الاستيراد: ' + (err.message || 'خطأ غير معروف'));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
            مركز استيراد بيانات الإنتاج التاريخي (Historical Production Import)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            استيراد آلاف سجلات الإنتاج السابقة عبر ملفات Excel و CSV مع الفحص والتدقيق التلقائي
          </p>
        </div>

        <button
          type="button"
          onClick={() => downloadStageExcelTemplate(selectedStage)}
          className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-xl transition-colors cursor-pointer"
        >
          <Download className="w-4 h-4" />
          تحميل قالب Excel للمرحلة ({STAGE_DISPLAY_NAMES[selectedStage]})
        </button>
      </div>

      {/* Stage Selector Tabs for Import */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <label className="block text-xs font-bold text-slate-700">
          اختر المرحلة الإنتاجية المراد استيراد ملفها:
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
          {(Object.keys(STAGE_DISPLAY_NAMES) as ProductionStageType[]).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => {
                setSelectedStage(st);
                setFile(null);
                setRawRows([]);
                setValidation(null);
                setImportSummary(null);
              }}
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

      {/* Upload Box */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleFileDrop}
        className="bg-white rounded-2xl border-2 border-dashed border-slate-300 hover:border-emerald-500 p-8 sm:p-12 text-center transition-colors relative"
      >
        <input
          type="file"
          accept=".xlsx, .xls, .csv"
          onChange={handleFileDrop}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        <div className="flex flex-col items-center justify-center space-y-3 pointer-events-none">
          <div className="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <UploadCloud className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              اسحب وأفلت ملف Excel أو اضغط للاختيار
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              يدعم ملفات .xlsx و .csv بحد أقصى 10,000 صف لكل ملف
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
          <span className="text-xs font-bold text-slate-600">جاري قراءة وفحص صفوف ملف Excel...</span>
        </div>
      )}

      {/* Validation Dry-run Result */}
      {validation && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                نتيجة الفحص الأولي (Validation Dry-Run)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                تم فحص {rawRows.length} صف في الملف المرفوع لمرحلة {STAGE_DISPLAY_NAMES[selectedStage]}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">صفوف جاهزة</span>
                <span className="text-base font-black text-emerald-600">{validation.validRows.length}</span>
              </div>
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">أخطاء</span>
                <span className="text-base font-black text-red-600">{validation.errors.length}</span>
              </div>
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">بيانات أساسية جديدة</span>
                <span className="text-base font-black text-purple-600">{validation.missingMasterData.length}</span>
              </div>
            </div>
          </div>

          {/* Missing Master Data Warning & Auto-create Option */}
          {validation.missingMasterData.length > 0 && (
            <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-purple-900 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-purple-600" />
                  تم رصد بيانات أساسية جديدة غير مسجلة بالنظام ({validation.missingMasterData.length} عنصر):
                </span>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-purple-900">
                  <input
                    type="checkbox"
                    checked={autoCreateMasterData}
                    onChange={(e) => setAutoCreateMasterData(e.target.checked)}
                    className="w-4 h-4 text-purple-600 rounded border-slate-300 focus:ring-purple-500"
                  />
                  <span>إنشاء البيانات الأساسية المفقودة تلقائياً أثناء الاستيراد</span>
                </label>
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {validation.missingMasterData.slice(0, 15).map((m, idx) => (
                  <span key={idx} className="text-[11px] font-bold bg-white text-purple-800 px-2 py-0.5 rounded border border-purple-200">
                    {m.type}: {m.name}
                  </span>
                ))}
                {validation.missingMasterData.length > 15 && (
                  <span className="text-[11px] font-bold text-purple-600 self-center">
                    + {validation.missingMasterData.length - 15} عناصر أخرى
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Errors Table if any */}
          {validation.errors.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-red-800 flex items-center gap-1">
                <AlertCircle className="w-4 h-4 text-red-600" />
                قائمة الأخطاء التي تم رصدها ({validation.errors.length}):
              </h3>
              <div className="max-h-40 overflow-y-auto bg-red-50/50 p-3 rounded-xl border border-red-200 text-xs text-red-800 space-y-1.5">
                {validation.errors.map((err, idx) => (
                  <div key={idx} className="flex items-center gap-2 font-mono">
                    <span className="font-bold bg-red-100 px-1.5 py-0.5 rounded">الصف {err.rowIndex}</span>
                    <span>العمود: <strong>{err.field}</strong> — {err.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions & Progress */}
          {isImporting ? (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>جاري إرسال السجلات إلى قاعدة بيانات Firestore (دفعات 500)...</span>
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
                onClick={() => setValidation(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={validation.validRows.length === 0}
                onClick={handleStartImport}
                className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                تنفيذ الاستيراد الفعلي ({validation.validRows.length} سجل)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Summary Report Card */}
      {importSummary && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-3 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-black text-emerald-950">
            تم الانتهاء من عملية الاستيراد التاريخي بنجاح!
          </h2>
          <div className="flex items-center justify-center gap-6 text-xs font-bold text-emerald-800">
            <span>إجمالي السجلات: {importSummary.total}</span>
            <span>تم الاستيراد بنجاح: {importSummary.success}</span>
            {importSummary.errors > 0 && <span className="text-red-700">أخطاء: {importSummary.errors}</span>}
          </div>
        </div>
      )}
    </div>
  );
};

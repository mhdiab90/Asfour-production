import React, { useState, useEffect, useRef } from 'react';
import { 
  Database, 
  Download, 
  RotateCcw, 
  Trash2, 
  Plus, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  FileText, 
  HardDrive, 
  Layers, 
  Eye, 
  RefreshCw,
  Search,
  Lock,
  ArrowRight,
  Upload,
  FileJson,
  Cloud,
  Server,
  Info,
  ExternalLink,
  XCircle,
  Check,
  Copy
} from 'lucide-react';
import { SystemBackup, RestorePreview, RestoreResult } from '../../types';
import { 
  fetchBackups, 
  createDatabaseBackup, 
  deleteBackup, 
  exportBackupToFile, 
  evaluateBackupHealth, 
  BackupHealthStats,
  memoryBackupCache,
  triggerBrowserFileDownload,
  retrySaveBackupMetadata
} from '../../services/backupService';
import { 
  generateRestorePreview, 
  executeSafeRestore, 
  parseBackupFile 
} from '../../services/restoreService';
import { CURRENT_APP_VERSION, DATABASE_SCHEMA_VERSION } from '../../config/appVersion';
import { useAuth } from '../../context/AuthContext';

interface BackupRestoreViewProps {
  initialTab?: 'backups' | 'restore';
}

export const BackupRestoreView: React.FC<BackupRestoreViewProps> = ({ initialTab = 'backups' }) => {
  const { adminUser, isSuperAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<'backups' | 'restore' | 'server-export'>(initialTab);
  const [backups, setBackups] = useState<SystemBackup[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Synchronize with initialTab if it changes via routing/sidebar
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Backup Creation State
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [backupProgressMsg, setBackupProgressMsg] = useState<string>('');
  const [backupPercent, setBackupPercent] = useState<number>(0);
  const [backupNote, setBackupNote] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [latestCreatedBackup, setLatestCreatedBackup] = useState<SystemBackup | null>(null);
  const [backupErrorDetails, setBackupErrorDetails] = useState<string | null>(null);
  const [showErrorModal, setShowErrorModal] = useState<boolean>(false);

  // Restore State
  const [selectedBackupForRestore, setSelectedBackupForRestore] = useState<SystemBackup | null>(null);
  const [uploadedBackupFile, setUploadedBackupFile] = useState<{ file: File; backup: SystemBackup } | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [showRestoreModal, setShowRestoreModal] = useState<boolean>(false);
  const [confirmationCode, setConfirmationCode] = useState<string>('');
  const [createSafetyCheckpoint, setCreateSafetyCheckpoint] = useState<boolean>(true);
  const [isRestoring, setIsRestoring] = useState<boolean>(false);
  const [restoreProgressMsg, setRestoreProgressMsg] = useState<string>('');
  const [restorePercent, setRestorePercent] = useState<number>(0);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  // Verification State
  const [verifiedBackup, setVerifiedBackup] = useState<SystemBackup | null>(null);
  const [isRetryingMetadata, setIsRetryingMetadata] = useState<boolean>(false);
  const [copiedBackupId, setCopiedBackupId] = useState<string | null>(null);

  // Deletion State
  const [backupToDelete, setBackupToDelete] = useState<SystemBackup | null>(null);

  // Feedback Notification
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string; details?: string } | null>(null);

  const loadBackups = async () => {
    setIsLoading(true);
    try {
      const data = await fetchBackups();
      setBackups(data);
    } catch (err: any) {
      setFeedback({ 
        type: 'error', 
        message: `فشل في تحميل سجلات النسخ الاحتياطي: ${err.message}` 
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBackups();
  }, []);

  const healthStats: BackupHealthStats = evaluateBackupHealth(backups);

  // Handle Copy Backup ID to Clipboard
  const handleCopyBackupCode = (code: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setCopiedBackupId(code);
      setTimeout(() => setCopiedBackupId(null), 2500);
    }
  };

  // Handle Retry Saving Metadata for existing backup
  const handleRetrySaveMetadata = async () => {
    if (!latestCreatedBackup) return;
    setIsRetryingMetadata(true);
    try {
      const updated = await retrySaveBackupMetadata(latestCreatedBackup);
      setLatestCreatedBackup(updated);
      setFeedback({
        type: 'success',
        message: `✅ تم تسجيل وتوثيق البيانات الوصفية للنسخة الاحتياطية (${updated.backupId}) في Firestore بنجاح!`
      });
      await loadBackups();
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: `تعذر حفظ البيانات الوصفية: ${err.message}`
      });
    } finally {
      setIsRetryingMetadata(false);
    }
  };

  // Handle Manual Backup Creation & Download
  const handleCreateBackup = async () => {
    if (!isSuperAdmin) {
      setFeedback({ type: 'error', message: 'عذراً، هذه العملية مقصورة على المشرفين العامين (SUPER_ADMIN) فقط.' });
      return;
    }

    setIsCreatingBackup(true);
    setBackupPercent(0);
    setBackupProgressMsg('جاري بدء بروتوكول النسخ الاحتياطي...');
    setBackupErrorDetails(null);

    try {
      const newBackup = await createDatabaseBackup(
        'MANUAL',
        backupNote,
        (msg, percent) => {
          setBackupProgressMsg(msg);
          setBackupPercent(percent);
        },
        true // Automatically trigger browser file download
      );

      // Verify file exists and payload is ready
      if (!newBackup.dataPayload || newBackup.sizeBytes === 0) {
        throw new Error('فشل التحقق من ملف النسخة الاحتياطية - حجم الملف 0 بايت.');
      }

      setLatestCreatedBackup(newBackup);
      setShowCreateModal(false);
      setBackupNote('');

      if (newBackup.status === 'SUCCESS') {
        setFeedback({
          type: 'success',
          message: `✅ تم إنشاء النسخة الاحتياطية وتنزيل الملف (${newBackup.fileName || newBackup.backupId}) بنجاح! تم حفظ ${newBackup.totalRecords.toLocaleString()} سجل.`
        });
      } else if (newBackup.status === 'FILE_READY_METADATA_FAILED') {
        setFeedback({
          type: 'info',
          message: '⚠️ تم إنشاء ملف النسخ الاحتياطي وتنزيله محلياً، ولكن تعذر تسجيل بيانات النسخة في Firestore.',
          details: newBackup.errorMessage
        });
      }

      await loadBackups();
    } catch (err: any) {
      console.error('Backup creation error:', err);
      const errorMsg = err.message || 'خطأ غير متوقع أثناء معالجة البيانات.';
      setBackupErrorDetails(errorMsg);
      setFeedback({ 
        type: 'error', 
        message: 'فشل إنشاء النسخة الاحتياطية',
        details: errorMsg
      });
    } finally {
      setIsCreatingBackup(false);
    }
  };

  // Handle File Upload for Restore
  const handleFileUpload = async (file: File) => {
    if (!file.name.endsWith('.json')) {
      setFeedback({ type: 'error', message: 'يرجى اختيار ملف بصيغة JSON صحيح.' });
      return;
    }

    setIsPreviewLoading(true);
    try {
      const parsed = await parseBackupFile(file);
      setUploadedBackupFile({ file, backup: parsed.backup });
      setSelectedBackupForRestore(parsed.backup);
      
      const preview = await generateRestorePreview(parsed.backup);
      setRestorePreview(preview);
      setShowRestoreModal(true);
      setConfirmationCode('');
      setRestoreResult(null);
      setFeedback({
        type: 'info',
        message: `تم فحص الملف (${file.name}) بنجاح! يحتوي على ${parsed.backup.totalRecords.toLocaleString()} سجل عبر ${parsed.backup.collections.length} مجموعة.`
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: `فشل قراءة ملف النسخة: ${err.message}` });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Handle Restore Preview from History
  const handleOpenRestorePreview = async (backup: SystemBackup) => {
    setSelectedBackupForRestore(backup);
    setIsPreviewLoading(true);
    setShowRestoreModal(true);
    setConfirmationCode('');
    setRestoreResult(null);

    try {
      const preview = await generateRestorePreview(backup);
      setRestorePreview(preview);
    } catch (err: any) {
      setFeedback({ type: 'error', message: `فشل توليد معاينة الاستعادة: ${err.message}` });
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Handle Safe Restore Execution
  const handleExecuteRestore = async () => {
    if (!selectedBackupForRestore) return;
    if (confirmationCode.trim().toUpperCase() !== 'RESTORE ASFOUR DATA') {
      setFeedback({ type: 'error', message: 'يرجى كتابة رمز التأكيد بدقة (RESTORE ASFOUR DATA) لتأكيد العملية.' });
      return;
    }

    setIsRestoring(true);
    setRestorePercent(0);
    setRestoreProgressMsg('جاري بدء بروتوكول الاستعادة الآمنة...');

    try {
      const result = await executeSafeRestore(selectedBackupForRestore, {
        createCheckpointFirst: createSafetyCheckpoint,
        onProgress: (msg, percent) => {
          setRestoreProgressMsg(msg);
          setRestorePercent(percent);
        }
      });

      setRestoreResult(result);
      if (result.success) {
        setFeedback({
          type: 'success',
          message: `تمت استعادة ${result.totalRestored.toLocaleString()} سجل بنجاح عبر ${result.restoredCollections.length} مجموعة! ${result.safetyBackupId ? `تم توثيق نقطة الأمان الوقائية: (${result.safetyBackupId})` : ''}`
        });
      } else {
        setFeedback({
          type: 'error',
          message: `تمت الاستعادة جزئياً مع بعض التنبيهات. يرجى مراجعة التفاصيل.`
        });
      }
      await loadBackups();
    } catch (err: any) {
      setFeedback({ type: 'error', message: `فشل تنفيذ الاستعادة: ${err.message}` });
    } finally {
      setIsRestoring(false);
    }
  };

  // Handle Download from Table
  const handleDownloadRow = (backup: SystemBackup) => {
    const success = exportBackupToFile(backup);
    if (!success) {
      setFeedback({
        type: 'info',
        message: `النسخة (${backup.backupId}) مسجلة كبيانات وصفية وتم تنزيل ملفها مسبقاً. لاستعادتها أو فحصها، يرجى رفع ملف JSON من جهازك.`
      });
    } else {
      setFeedback({
        type: 'success',
        message: `جاري تنزيل ملف النسخة الاحتياطية (${backup.fileName || backup.backupId}).`
      });
    }
  };

  // Handle Delete Backup
  const handleDeleteConfirm = async () => {
    if (!backupToDelete) return;
    try {
      await deleteBackup(backupToDelete.id, backupToDelete.backupId);
      setFeedback({ type: 'success', message: `تم حذف سجل النسخة الاحتياطية (${backupToDelete.backupId}) بنجاح.` });
      setBackupToDelete(null);
      await loadBackups();
    } catch (err: any) {
      setFeedback({ type: 'error', message: `فشل حذف النسخة الاحتياطية: ${err.message}` });
    }
  };

  const filteredBackups = backups.filter(b => 
    b.backupId.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (b.notes && b.notes.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (b.fileName && b.fileName.toLowerCase().includes(searchQuery.toLowerCase())) ||
    b.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 pb-12" dir="rtl">
      {/* Top Banner / Feedback */}
      {feedback && (
        <div className={`p-4 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-3 text-sm shadow-md animate-in fade-in ${
          feedback.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' :
          feedback.type === 'error' ? 'bg-rose-500/10 border border-rose-500/30 text-rose-300' :
          'bg-blue-500/10 border border-blue-500/30 text-blue-300'
        }`}>
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' && <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400 mt-0.5" />}
            {feedback.type === 'error' && <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />}
            {feedback.type === 'info' && <Info className="w-5 h-5 shrink-0 text-blue-400 mt-0.5" />}
            <div>
              <span className="font-bold">{feedback.message}</span>
              {feedback.details && (
                <p className="text-xs text-rose-200/90 font-mono mt-1 bg-black/30 p-2 rounded-xl border border-rose-500/20">
                  {feedback.details}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-center">
            {feedback.details && (
              <button 
                onClick={() => {
                  setBackupErrorDetails(feedback.details || '');
                  setShowErrorModal(true);
                }}
                className="text-xs bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 px-3 py-1 rounded-xl border border-rose-500/30 font-bold"
              >
                عرض التفاصيل
              </button>
            )}
            <button onClick={() => setFeedback(null)} className="text-xs hover:underline opacity-80 px-2 py-1">إغلاق</button>
          </div>
        </div>
      )}

      {/* Latest Backup Download Action Card */}
      {latestCreatedBackup && (
        <div className={`bg-gradient-to-r ${
          latestCreatedBackup.status === 'SUCCESS' 
            ? 'from-amber-500/20 via-slate-900 to-slate-900 border-amber-500/60' 
            : 'from-amber-600/30 via-slate-900 to-slate-900 border-amber-500/80'
        } border-2 rounded-3xl p-6 shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-5 animate-in fade-in zoom-in-95`}>
          <div className="flex items-center gap-4 w-full lg:w-auto">
            <div className={`w-14 h-14 rounded-2xl ${
              latestCreatedBackup.status === 'SUCCESS' ? 'bg-amber-500 text-slate-950' : 'bg-amber-600 text-white'
            } flex items-center justify-center font-bold shadow-lg shrink-0`}>
              <Download className="w-7 h-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-white font-bold text-base">
                  {latestCreatedBackup.status === 'SUCCESS' 
                    ? '✅ النسخة الاحتياطية جاهزة وموثقة' 
                    : '⚠️ تم إنشاء ملف النسخ الاحتياطي، ولكن تعذر تسجيل بيانات النسخة في Firestore'}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                  latestCreatedBackup.status === 'SUCCESS'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                }`}>
                  {latestCreatedBackup.status === 'SUCCESS' ? 'سليم ومتحقق' : 'ملف جاهز - تنبيه توثيق سحابي'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>الملف: <span className="font-mono text-amber-400 font-bold">{latestCreatedBackup.fileName || latestCreatedBackup.backupId}</span></span>
                <span>• الحجم: <span className="font-mono text-white font-bold">{(latestCreatedBackup.sizeBytes / 1024).toFixed(1)} KB</span></span>
                <span>• السجلات: <span className="font-mono text-emerald-400 font-bold">{latestCreatedBackup.totalRecords.toLocaleString()}</span></span>
                <span>• البصمة: <span className="font-mono text-slate-400 text-[11px]" title={latestCreatedBackup.checksum}>{latestCreatedBackup.checksum.substring(0, 16)}...</span></span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto shrink-0 justify-end">
            <button
              onClick={() => exportBackupToFile(latestCreatedBackup)}
              className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold px-5 py-2.5 rounded-2xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>تحميل النسخة الاحتياطية</span>
            </button>

            <button
              onClick={() => handleCopyBackupCode(latestCreatedBackup.backupId)}
              className="bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 font-bold px-4 py-2.5 rounded-2xl text-xs flex items-center justify-center gap-1.5 border border-slate-700 transition cursor-pointer"
              title="نسخ رقم النسخة"
            >
              {copiedBackupId === latestCreatedBackup.backupId ? (
                <>
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">تم النسخ</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 text-slate-400" />
                  <span>نسخ رقم النسخة</span>
                </>
              )}
            </button>

            {latestCreatedBackup.status === 'FILE_READY_METADATA_FAILED' && (
              <button
                onClick={handleRetrySaveMetadata}
                disabled={isRetryingMetadata}
                className="bg-amber-500/20 hover:bg-amber-500 active:scale-95 text-amber-300 hover:text-slate-950 font-bold px-4 py-2.5 rounded-2xl text-xs flex items-center justify-center gap-1.5 border border-amber-500/40 transition cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isRetryingMetadata ? 'animate-spin' : ''}`} />
                <span>{isRetryingMetadata ? 'جاري إعادة الحفظ...' : 'إعادة محاولة حفظ البيانات الوصفية'}</span>
              </button>
            )}

            <button
              onClick={() => setLatestCreatedBackup(null)}
              className="p-2.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition cursor-pointer"
              title="إغلاق"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Header & Actions */}
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Database className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <span>مركز النسخ الاحتياطي والاستعادة الشامل</span>
                <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-0.5 rounded-full font-mono">
                  Schema v{DATABASE_SCHEMA_VERSION}
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                حماية البيانات الكاملة، التصدير المحلي الفوري، وتأمين المنظومة من الكوارث
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold px-5 py-3 rounded-2xl text-sm flex items-center gap-2 shadow-lg shadow-amber-500/10 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>إنشاء نسخة احتياطية وتنزيلها</span>
            </button>

            <button
              onClick={loadBackups}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 p-3 rounded-2xl border border-slate-700 transition"
              title="تحديث السجلات"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Health Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-800">
          <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <ShieldCheck className={`w-4 h-4 ${
                healthStats.healthState === 'GREEN' ? 'text-emerald-400' :
                healthStats.healthState === 'YELLOW' ? 'text-amber-400' : 'text-rose-400'
              }`} />
              <span>حالة النسخ الاحتياطي</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${
                healthStats.healthState === 'GREEN' ? 'bg-emerald-400' :
                healthStats.healthState === 'YELLOW' ? 'bg-amber-400' : 'bg-rose-400'
              }`} />
              <span className="font-bold text-sm text-white">
                {healthStats.healthState === 'GREEN' ? 'آمن ومطابق (سليم)' :
                 healthStats.healthState === 'YELLOW' ? 'تنبيه (مطلوب تحديث)' : 'حرج (لا توجد نسخ حديثة)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 truncate">{healthStats.healthMessage}</p>
          </div>

          <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Clock className="w-4 h-4 text-blue-400" />
              <span>آخر نسخة احتياطية</span>
            </div>
            <div className="font-mono font-bold text-sm text-white">
              {healthStats.lastBackupHoursAgo !== null ? `منذ ${healthStats.lastBackupHoursAgo} ساعة` : 'لا يوجد'}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {healthStats.lastBackupDate ? new Date(healthStats.lastBackupDate).toLocaleDateString('ar-EG') : '—'}
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <HardDrive className="w-4 h-4 text-purple-400" />
              <span>إجمالي النسخ المسجلة</span>
            </div>
            <div className="font-mono font-bold text-sm text-purple-300">
              {healthStats.totalBackups} نسخة
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">
              {healthStats.latestChecksum ? `Checksum: ${healthStats.latestChecksum}` : 'جاهز للأرشفة'}
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-800 p-4 rounded-2xl">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Layers className="w-4 h-4 text-amber-400" />
              <span>إجمالي السجلات المحمية</span>
            </div>
            <div className="font-mono font-bold text-sm text-amber-400">
              {healthStats.totalRecordsProtected.toLocaleString()} سجل
            </div>
            <p className="text-[11px] text-slate-400 mt-1">عبر كافة مجموعات المصنع الـ 23</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-3 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('backups')}
          className={`px-5 py-2.5 rounded-2xl text-sm font-bold transition flex items-center gap-2 ${
            activeTab === 'backups' 
              ? 'bg-amber-500 text-slate-950 shadow-md' 
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>سجل النسخ الاحتياطية ({backups.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('restore')}
          className={`px-5 py-2.5 rounded-2xl text-sm font-bold transition flex items-center gap-2 ${
            activeTab === 'restore' 
              ? 'bg-amber-500 text-slate-950 shadow-md' 
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <RotateCcw className="w-4 h-4" />
          <span>مركز الاستعادة والتحقق الآمن</span>
        </button>

        <button
          onClick={() => setActiveTab('server-export')}
          className={`px-5 py-2.5 rounded-2xl text-sm font-bold transition flex items-center gap-2 ${
            activeTab === 'server-export' 
              ? 'bg-amber-500 text-slate-950 shadow-md' 
              : 'text-slate-400 hover:text-white hover:bg-slate-800'
          }`}
        >
          <Server className="w-4 h-4" />
          <span>النسخ الخادمي المدار (Cloud Export)</span>
        </button>
      </div>

      {/* Tab 1: Backups Table */}
      {activeTab === 'backups' && (
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 absolute right-4 top-3.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث برقم النسخة، اسم الملف، الملاحظات، أو النوع..."
              className="w-full bg-slate-900 border border-slate-800 rounded-2xl pr-11 pl-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/50"
            />
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-800/80 text-slate-400 border-b border-slate-700 font-medium">
                  <tr>
                    <th className="py-3.5 px-4">رقم النسخة (Backup ID)</th>
                    <th className="py-3.5 px-4">التاريخ والوقت</th>
                    <th className="py-3.5 px-4">النوع والمصدر</th>
                    <th className="py-3.5 px-4">الإصدار والمخطط</th>
                    <th className="py-3.5 px-4">السجلات</th>
                    <th className="py-3.5 px-4">الحجم والبصمة</th>
                    <th className="py-3.5 px-4">الحالة والتخزين</th>
                    <th className="py-3.5 px-4 text-center">الإجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-200">
                  {isLoading ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
                        <span>جاري تحميل سجلات النسخ الاحتياطي...</span>
                      </td>
                    </tr>
                  ) : filteredBackups.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <Database className="w-8 h-8 mx-auto mb-2 text-slate-600" />
                        <span>لا توجد نسخ احتياطية مسجلة مطابقة للبحث</span>
                      </td>
                    </tr>
                  ) : (
                    filteredBackups.map((backup) => (
                      <tr key={backup.id} className="hover:bg-slate-800/40 transition">
                        <td className="py-3.5 px-4">
                          <div className="font-mono font-bold text-amber-400">{backup.backupId}</div>
                          {backup.fileName && (
                            <div className="text-[11px] text-slate-400 font-mono">{backup.fileName}</div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          <div>{new Date(backup.createdAt).toLocaleDateString('ar-EG')}</div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {new Date(backup.createdAt).toLocaleTimeString('ar-EG')}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                            backup.type === 'MANUAL' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                            backup.type === 'PRE_IMPORT' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' :
                            backup.type === 'SAFETY_CHECKPOINT' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                            'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            {backup.type === 'MANUAL' ? 'يدوي' :
                             backup.type === 'PRE_IMPORT' ? 'قبل الاستيراد' :
                             backup.type === 'SAFETY_CHECKPOINT' ? 'نقطة أمان' : 'مجدول'}
                          </span>
                          {backup.notes && (
                            <div className="text-[11px] text-slate-400 mt-1 max-w-xs truncate" title={backup.notes}>
                              {backup.notes}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono">
                          <div>v{backup.appVersion}</div>
                          <div className="text-[11px] text-emerald-400">Schema v{backup.schemaVersion}</div>
                        </td>
                        <td className="py-3.5 px-4 font-mono font-bold text-white">
                          {backup.totalRecords.toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-mono text-slate-300">
                            {(backup.sizeBytes / 1024).toFixed(1)} KB
                          </div>
                          <div className="text-[10px] text-slate-500 font-mono truncate max-w-[100px]" title={backup.checksum}>
                            {backup.checksum}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-col gap-1">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-block text-center ${
                              backup.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                              backup.status === 'FILE_READY_METADATA_FAILED' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                              'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            }`}>
                              {backup.status === 'SUCCESS' ? 'ناجح ومحقق' :
                               backup.status === 'FILE_READY_METADATA_FAILED' ? 'ملف جاهز (تنبيه توثيق)' : 'فشل'}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {backup.storageLocation === 'LOCAL_JSON' ? 'ملف محلي (JSON)' : 'سحابي'}
                            </span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleDownloadRow(backup)}
                              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                              title="تحميل النسخة الاحتياطية"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setVerifiedBackup(backup)}
                              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-blue-300 hover:text-white transition cursor-pointer"
                              title="فحص تفاصيل النسخة"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => handleOpenRestorePreview(backup)}
                              className="p-2 rounded-xl bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/30 transition cursor-pointer"
                              title="معاينة واستعادة النسخة"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => setBackupToDelete(backup)}
                              className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white transition cursor-pointer"
                              title="حذف سجل النسخة"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Safe Restore Center */}
      {activeTab === 'restore' && (
        <div className="space-y-6">
          {/* File Dropzone / Upload Box */}
          <div className="bg-slate-900 border-2 border-dashed border-slate-700 hover:border-amber-500/50 rounded-3xl p-8 text-center transition shadow-xl">
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
              className="hidden"
            />

            <div className="w-16 h-16 rounded-3xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4 border border-amber-500/30">
              <Upload className="w-8 h-8" />
            </div>

            <h3 className="text-lg font-bold text-white mb-1">رفع ملف نسخة احتياطية (JSON) للاستعادة الآمنة</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mb-4">
              قم بسحب وإفلات ملف <span className="font-mono text-amber-400">ASFOUR_Backup_*.json</span> هنا أو اضغط للاختيار من جهازك
            </p>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="bg-amber-500 hover:bg-amber-600 active:scale-95 text-slate-950 font-bold px-6 py-3 rounded-2xl text-xs inline-flex items-center gap-2 shadow-lg shadow-amber-500/10 transition cursor-pointer"
            >
              <FileJson className="w-4 h-4" />
              <span>اختيار ملف النسخة من الجهاز</span>
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <h3 className="text-base font-bold text-white flex items-center gap-2 mb-2">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <span>إجراءات الأمان واستعادة البيانات من نقطة زمنية محددة</span>
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              تتيح لك هذه الواجهة استعادة بيانات النظام بأعلى معايير الأمان المعتمدة مع إنشاء نقطة أمان وقائية تلقائياً:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <div className="bg-slate-800/50 border border-slate-700/60 p-4 rounded-2xl">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-sm mb-2">
                  1
                </div>
                <h4 className="font-bold text-sm text-white mb-1">المعاينة وحساب الفروق</h4>
                <p className="text-xs text-slate-400">
                  مقارنة فورية بين أعداد السجلات الحالية في Firestore وأعداد السجلات في النسخة الاحتياطية قبل أي تعديل.
                </p>
              </div>

              <div className="bg-slate-800/50 border border-slate-700/60 p-4 rounded-2xl">
                <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-sm mb-2">
                  2
                </div>
                <h4 className="font-bold text-sm text-white mb-1">نقطة الأمان التلقائية</h4>
                <p className="text-xs text-slate-400">
                  إنشاء نسخة احتياطية وقائية (Safety Checkpoint) لقاعدة البيانات الحالية قبل إجراء الاستبدال لحمايتها من أي خطأ.
                </p>
              </div>

              <div className="bg-slate-800/50 border border-slate-700/60 p-4 rounded-2xl">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-sm mb-2">
                  3
                </div>
                <h4 className="font-bold text-sm text-white mb-1">الكتابة على دفعات موثقة</h4>
                <p className="text-xs text-slate-400">
                  تنفيذ الاستعادة على دفعات مجزأة (Batches of 400) وتوثيق كامل العملية في سجل التدقيق التاريخي (Audit Logs).
                </p>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl">
            <h4 className="text-sm font-bold text-white mb-4">أو اختر نسخة مسجلة من الجلسة الحالية:</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {backups.slice(0, 6).map((backup) => (
                <div 
                  key={backup.id}
                  className="bg-slate-800/40 border border-slate-800 hover:border-amber-500/50 p-4 rounded-2xl transition flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="font-mono font-bold text-amber-400 text-sm">{backup.backupId}</div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(backup.createdAt).toLocaleString('ar-EG')} • {backup.totalRecords.toLocaleString()} سجل
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenRestorePreview(backup)}
                    className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <span>معاينة واستعادة</span>
                    <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Cloud Server Export Option */}
      {activeTab === 'server-export' && (
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Server className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">النسخ الخادمي المدار لقواعد البيانات الكبيرة (Cloud Managed Export)</h3>
              <p className="text-xs text-slate-400 mt-1">
                تصدير وإدارة قواعد البيانات الضخمة مباشرة على مستوى Cloud Firestore و Cloud Storage
              </p>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-xs text-amber-300 flex items-start gap-3">
            <Info className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
            <div>
              <h4 className="font-bold text-sm mb-1 text-white">متطلبات النسخ الخادمي المباشر:</h4>
              <p className="leading-relaxed">
                النسخ الخادمي المدار المباشر عبر Google Cloud Firestore يتطلب تفعيل خطة <span className="font-bold text-white">Billing / Blaze</span> وإنشاء حاوية تخزين <span className="font-mono text-white">gs://[BUCKET_NAME]</span> مع صلاحيات Service Account.
              </p>
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h4 className="text-xs font-bold text-white">أمر التصدير الخادمي عبر Google Cloud CLI:</h4>
            <div className="bg-slate-950 p-4 rounded-xl font-mono text-xs text-emerald-400 border border-slate-800 flex items-center justify-between" dir="ltr">
              <code>gcloud firestore export gs://asfour-erp-backups/$(date +%Y%m%d_%H%M%S)</code>
            </div>
            <p className="text-xs text-slate-400">
              يقوم هذا الأمر بتصدير كافة المجموعات مباشرة من خوادم Google دون المرور بذاكرة المتصفح.
            </p>
          </div>

          <div className="bg-slate-800/50 border border-slate-800 rounded-2xl p-5 space-y-3">
            <h4 className="text-xs font-bold text-white">الفرق بين النسخ المحلي والنسخ الخادمي:</h4>
            <ul className="text-xs text-slate-300 space-y-2">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span><strong>النسخ المحلي (JSON Backup):</strong> مناسب لقواعد البيانات الحالية ويتم تنزيله فورياً على جهاز المشرف دون تكلفة إضافية.</span>
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                <span><strong>النسخ الخادمي (Cloud Export):</strong> موصى به عند تجاوز البيانات 500,000 سجل أو 100 ميجابايت.</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* Modal: Create Backup */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                <Database className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg">إنشاء نسخة احتياطية وتنزيلها</h3>
                <p className="text-xs text-slate-400">سيتم تجميع كافة مجموعات المصنع وتنزيل ملف JSON فوراً</p>
              </div>
            </div>

            <div className="space-y-4 my-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5">ملاحظات النسخة (اختياري)</label>
                <input
                  type="text"
                  value={backupNote}
                  onChange={(e) => setBackupNote(e.target.value)}
                  placeholder="مثال: نسخة احتياطية شاملة معتمدة..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="bg-slate-800/60 p-3.5 rounded-2xl border border-slate-700/50 text-xs text-slate-300 space-y-1.5">
                <div className="flex justify-between">
                  <span>المجموعات المشمولة:</span>
                  <span className="font-bold text-amber-400">23 مجموعة رئيسية</span>
                </div>
                <div className="flex justify-between">
                  <span>إصدار المخطط:</span>
                  <span className="font-mono text-emerald-400">Schema v{DATABASE_SCHEMA_VERSION}</span>
                </div>
                <div className="flex justify-between">
                  <span>معمارية التخزين:</span>
                  <span className="text-blue-300">ملف JSON محلي + بيانات وصفية مشفرة</span>
                </div>
              </div>

              {isCreatingBackup && (
                <div className="space-y-2 pt-2">
                  <div className="flex justify-between text-xs text-slate-400">
                    <span className="font-bold text-white">{backupProgressMsg}</span>
                    <span className="font-mono text-amber-400">{backupPercent}%</span>
                  </div>
                  <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-amber-500 h-full transition-all duration-300"
                      style={{ width: `${backupPercent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => setShowCreateModal(false)}
                disabled={isCreatingBackup}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition disabled:opacity-50"
              >
                إلغاء
              </button>
              <button
                onClick={handleCreateBackup}
                disabled={isCreatingBackup}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition flex items-center gap-2 shadow-lg shadow-amber-500/10 disabled:opacity-50 cursor-pointer"
              >
                {isCreatingBackup ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{isCreatingBackup ? 'جاري التنفيذ...' : 'بدء النسخ والتنزيل'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Error Details */}
      {showErrorModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-slate-900 border border-rose-500/50 rounded-3xl max-w-lg w-full p-6 shadow-2xl text-white">
            <div className="flex items-center gap-3 text-rose-400 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 flex items-center justify-center">
                <XCircle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">تفاصيل الخطأ التقني</h3>
                <p className="text-xs text-slate-400">سجل الخطأ المسترجع من المنظومة</p>
              </div>
            </div>

            <div className="bg-black/50 p-4 rounded-2xl border border-slate-800 font-mono text-xs text-rose-300 break-all space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
              <p>{backupErrorDetails || 'لم يتم تسجيل تفاصيل إضافية.'}</p>
            </div>

            <div className="flex justify-end pt-4 mt-4 border-t border-slate-800">
              <button
                onClick={() => setShowErrorModal(false)}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Verify Details */}
      {verifiedBackup && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 shadow-2xl text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
                <Eye className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg">فحص البيانات الوصفية للنسخة</h3>
                <p className="text-xs text-slate-400 font-mono">{verifiedBackup.backupId}</p>
              </div>
            </div>

            <div className="space-y-3 text-xs bg-slate-800/50 p-4 rounded-2xl border border-slate-800">
              <div className="flex justify-between py-1 border-b border-slate-700/50">
                <span className="text-slate-400">اسم الملف:</span>
                <span className="font-mono text-amber-400">{verifiedBackup.fileName || 'N/A'}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-700/50">
                <span className="text-slate-400">إجمالي السجلات:</span>
                <span className="font-bold text-white">{verifiedBackup.totalRecords.toLocaleString()} سجل</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-700/50">
                <span className="text-slate-400">الحجم:</span>
                <span className="font-mono text-slate-300">{(verifiedBackup.sizeBytes / 1024).toFixed(2)} KB</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-700/50">
                <span className="text-slate-400">البصمة الرقمية (Checksum):</span>
                <span className="font-mono text-emerald-400">{verifiedBackup.checksum}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">موقع التخزين:</span>
                <span className="text-blue-300">{verifiedBackup.storageLocation || 'LOCAL_JSON'}</span>
              </div>
            </div>

            <div className="flex justify-end pt-4 mt-4 border-t border-slate-800">
              <button
                onClick={() => setVerifiedBackup(null)}
                className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Restore Preview & Safe Execution */}
      {showRestoreModal && selectedBackupForRestore && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto" dir="rtl">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full p-6 shadow-2xl text-white my-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <RotateCcw className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">معاينة واستعادة النسخة الاحتياطية</h3>
                  <p className="text-xs font-mono text-amber-400">{selectedBackupForRestore.backupId}</p>
                </div>
              </div>

              <button
                onClick={() => setShowRestoreModal(false)}
                className="text-slate-400 hover:text-white p-2"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-4 space-y-4 custom-scrollbar">
              {isPreviewLoading ? (
                <div className="py-12 text-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
                  <span>جاري فحص ومقارنة أعداد السجلات في Firestore...</span>
                </div>
              ) : restorePreview ? (
                <>
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-xs text-amber-300 flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-sm mb-1 text-white">تحذير أمان عالي: استعادة البيانات</h4>
                      <p>
                        سيتم دمج وتحديث السجلات الحالية ببيانات هذه النسخة الاحتياطية. لضمان الأمان التام، سيقوم النظام تلقائياً بإنشاء نقطة أمان قبل البدء.
                      </p>
                    </div>
                  </div>

                  {/* Summary Comparison Grid */}
                  <div className="bg-slate-800/40 border border-slate-800 rounded-2xl p-4">
                    <h4 className="text-xs font-bold text-slate-300 mb-3">مقارنة أعداد السجلات بين الحالي والنسخة:</h4>
                    <div className="max-h-52 overflow-y-auto space-y-1.5 custom-scrollbar pr-1 text-xs">
                      {restorePreview.collectionDiffs.map((diff, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-slate-800/80 px-3 py-2 rounded-xl">
                          <span className="font-mono text-slate-200">{diff.collectionName}</span>
                          <div className="flex items-center gap-4 text-xs font-mono">
                            <span className="text-slate-400">الحالي: {diff.currentCount}</span>
                            <span className="text-amber-400 font-bold">النسخة: {diff.backupCount}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Checkpoint Safety Toggle */}
                  <div className="flex items-center justify-between bg-slate-800/60 p-4 rounded-2xl border border-slate-700">
                    <div>
                      <div className="text-xs font-bold text-white">إنشاء نقطة أمان احتياطية تلقائياً قبل الاستعادة</div>
                      <div className="text-[11px] text-slate-400">يوفر إمكانية التراجع الفوري إذا دعت الحاجة</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={createSafetyCheckpoint}
                      onChange={(e) => setCreateSafetyCheckpoint(e.target.checked)}
                      className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
                    />
                  </div>

                  {/* Strict Confirmation Input */}
                  <div className="bg-rose-500/10 border border-rose-500/30 p-4 rounded-2xl space-y-2">
                    <label className="block text-xs font-bold text-rose-300">
                      لتأكيد الاستعادة، يرجى كتابة العبارة التالية بدقة: <span className="font-mono text-white underline">RESTORE ASFOUR DATA</span>
                    </label>
                    <input
                      type="text"
                      value={confirmationCode}
                      onChange={(e) => setConfirmationCode(e.target.value)}
                      placeholder="اكتب RESTORE ASFOUR DATA هنا..."
                      className="w-full bg-slate-900 border border-rose-500/50 rounded-xl px-4 py-2 text-sm text-white font-mono placeholder-slate-600 focus:outline-none focus:border-rose-400"
                    />
                  </div>

                  {/* Progress Indicator */}
                  {isRestoring && (
                    <div className="space-y-2 pt-2">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>{restoreProgressMsg}</span>
                        <span className="font-mono text-amber-400">{restorePercent}%</span>
                      </div>
                      <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-amber-500 h-full transition-all duration-300"
                          style={{ width: `${restorePercent}%` }}
                        />
                      </div>
                    </div>
                  )}
                </>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800 shrink-0">
              <button
                onClick={() => setShowRestoreModal(false)}
                disabled={isRestoring}
                className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                إلغاء
              </button>
              <button
                onClick={handleExecuteRestore}
                disabled={isRestoring || confirmationCode.trim().toUpperCase() !== 'RESTORE ASFOUR DATA'}
                className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-amber-500/10 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>تنفيذ الاستعادة الآن</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {backupToDelete && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 shadow-2xl text-white">
            <div className="flex items-center gap-3 text-rose-400 mb-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 flex items-center justify-center">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">حذف سجل النسخة الاحتياطية</h3>
                <p className="text-xs text-slate-400 font-mono">{backupToDelete.backupId}</p>
              </div>
            </div>

            <p className="text-sm text-slate-300 my-4">
              هل أنت متأكد من رغبتك في حذف سجل هذه النسخة الاحتياطية من قاعدة البيانات؟ لن يحذف هذا الملفات المنزلة على جهازك.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setBackupToDelete(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300"
              >
                إلغاء
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                <span>تأكيد الحذف</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

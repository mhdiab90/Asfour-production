/**
 * System Version Management - Admin-only application version history,
 * release checkpoints, and application-code rollback governance.
 *
 * CRITICAL DISTINCTION: this screen manages the APPLICATION CODE / DEPLOYED
 * BUILD version only. It is NOT Firestore data rollback (see
 * BackupRestoreView for that, entirely separate). See
 * systemVersionService.ts for the full rationale.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  GitBranch,
  GitCommit,
  ShieldCheck,
  ShieldAlert,
  History,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Plus,
  Star,
  Lock,
  Clock,
  User,
  ArrowRight,
  X,
  Zap,
  FileText,
  Layers,
} from 'lucide-react';
import { SystemVersionRecord, RollbackOperation, RollbackReasonCategory, RollbackStatus } from '../../types';
import { CURRENT_APP_VERSION } from '../../config/appVersion';
import {
  listVersions,
  getActiveRollbackLock,
  createReleaseCheckpoint,
  markVersionKnownGood,
  requestRollback,
  approveRollback,
  cancelRollback,
  executeRollback,
  confirmManualDeploymentComplete,
  getRollbackHistory,
  runHealthCheck,
  isValidCommitSha,
  isPermissionDeniedError,
  getRunningBuildInfo,
  RollbackLockError,
} from '../../services/systemVersionService';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { ChangeRegistryPanel } from './ChangeRegistryPanel';

function t(ar: string, en: string, language: 'ar' | 'en'): string {
  return language === 'ar' ? ar : en;
}

const REASON_CATEGORIES: { key: RollbackReasonCategory; ar: string; en: string }[] = [
  { key: 'REGRESSION', ar: 'تراجع في الأداء الوظيفي', en: 'Regression' },
  { key: 'BROKEN_DEPLOYMENT', ar: 'نشر معطوب', en: 'Broken deployment' },
  { key: 'INCORRECT_FEATURE', ar: 'ميزة غير صحيحة', en: 'Incorrect feature' },
  { key: 'PERFORMANCE_ISSUE', ar: 'مشكلة أداء', en: 'Performance issue' },
  { key: 'SECURITY_ISSUE', ar: 'مشكلة أمنية', en: 'Security issue' },
  { key: 'DATA_DISPLAY_ISSUE', ar: 'مشكلة في عرض البيانات', en: 'Data display issue' },
  { key: 'OTHER', ar: 'أخرى', en: 'Other' },
];

const STATUS_BADGE: Record<string, { ar: string; en: string; cls: string }> = {
  DEPLOYING: { ar: 'جاري النشر', en: 'Deploying', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  HEALTH_CHECK: { ar: 'فحص الصحة', en: 'Health Check', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  HEALTHY: { ar: 'سليم', en: 'Healthy', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  FAILED: { ar: 'فشل', en: 'Failed', cls: 'bg-red-100 text-red-800 border-red-300' },
  ROLLED_BACK: { ar: 'تم الإرجاع عنه', en: 'Rolled Back', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  REQUESTED: { ar: 'مطلوب', en: 'Requested', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  APPROVED: { ar: 'معتمد', en: 'Approved', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
  RUNNING: { ar: 'قيد التنفيذ', en: 'Running', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  SUCCESS: { ar: 'نجاح', en: 'Success', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  REVERTED: { ar: 'تم التراجع', en: 'Reverted', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  CANCELLED: { ar: 'ملغى', en: 'Cancelled', cls: 'bg-slate-100 text-slate-500 border-slate-300' },
};

const HEALTH_BADGE: Record<string, { ar: string; en: string; cls: string }> = {
  HEALTHY: { ar: 'سليم', en: 'Healthy', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  DEGRADED: { ar: 'متدهور', en: 'Degraded', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  UNHEALTHY: { ar: 'غير سليم', en: 'Unhealthy', cls: 'bg-red-100 text-red-800 border-red-300' },
  UNKNOWN: { ar: 'غير معروف', en: 'Unknown', cls: 'bg-slate-100 text-slate-500 border-slate-300' },
};

function StatusPill({ value, map, language }: { value: string; map: typeof STATUS_BADGE; language: 'ar' | 'en' }) {
  const info = map[value] || { ar: value, en: value, cls: 'bg-slate-100 text-slate-700 border-slate-300' };
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${info.cls}`}>{language === 'ar' ? info.ar : info.en}</span>;
}

export const SystemVersionManagementView: React.FC = () => {
  const { language, isRtl } = useLanguage();
  const { adminUser, isSuperAdmin, hasPermission } = useAuth();

  const canView = isSuperAdmin || hasPermission('versions.view') || hasPermission('system.version.manage');
  const canManage = isSuperAdmin || hasPermission('system.version.manage');
  const canRollback = isSuperAdmin || hasPermission('system.version.rollback');

  const [versions, setVersions] = useState<SystemVersionRecord[]>([]);
  const [rollbackHistory, setRollbackHistory] = useState<RollbackOperation[]>([]);
  const [activeLock, setActiveLock] = useState<RollbackOperation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  /** §14: distinct states rather than one generic error - LOADING/PERMISSION_DENIED/FAILED_TO_LOAD/READY. "No versions yet" and per-field "Unavailable" are derived from READY data below, not separate top-level states. */
  const [loadState, setLoadState] = useState<'LOADING' | 'PERMISSION_DENIED' | 'FAILED_TO_LOAD' | 'READY'>('LOADING');
  /** §4/§9/§15/§22: what THIS running bundle actually is - computed once, locally, with zero Firestore dependency, so it's always available even if every read below fails. */
  const runningBuild = useMemo(() => getRunningBuildInfo(), []);

  const [showCheckpointForm, setShowCheckpointForm] = useState(false);
  const [checkpointDraft, setCheckpointDraft] = useState({ versionLabel: '', commitSha: '', branch: 'main', buildId: '', deploymentReference: '', environment: 'production' as 'production' | 'staging' | 'development', releaseNotes: '' });
  const [isSavingCheckpoint, setIsSavingCheckpoint] = useState(false);

  const [detailVersion, setDetailVersion] = useState<SystemVersionRecord | null>(null);
  const [compareState, setCompareState] = useState<{ a?: SystemVersionRecord; b?: SystemVersionRecord } | null>(null);

  const [rollbackWizard, setRollbackWizard] = useState<{
    step: 'SELECT' | 'REVIEW' | 'HEALTH' | 'CONFIRM' | 'RUNNING' | 'DONE';
    target?: SystemVersionRecord;
    reason: string;
    reasonCategory: RollbackReasonCategory;
    requiresTwoPersonApproval: boolean;
    isEmergency: boolean;
    preHealth?: Awaited<ReturnType<typeof runHealthCheck>>;
    rollbackId?: string;
    result?: RollbackOperation;
    error?: string;
  } | null>(null);
  const [isProcessingWizard, setIsProcessingWizard] = useState(false);

  const [rollbackDetail, setRollbackDetail] = useState<RollbackOperation | null>(null);
  const [manualConfirmRef, setManualConfirmRef] = useState('');

  /**
   * §23: one controlled load on mount/permission-change - never re-queries
   * per render. §14: classifies WHY a load failed (permission vs anything
   * else) instead of one generic message, so an admin actually knows what
   * to do about it - a permission-denied here means the Firestore rules for
   * `systemVersions`/`versionRollbacks` (present in this repo's
   * firestore.rules) have most likely not been deployed to the live
   * project yet, since every other admin permission check already passed
   * to even reach this screen.
   */
  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadState('LOADING');
    try {
      const [v, h, lock] = await Promise.all([listVersions(), getRollbackHistory(), getActiveRollbackLock()]);
      setVersions(v);
      setRollbackHistory(h);
      setActiveLock(lock);
      setLoadState('READY');
    } catch (err: any) {
      console.error('[SystemVersionManagement] load failed:', err);
      setLoadState(isPermissionDeniedError(err) ? 'PERMISSION_DENIED' : 'FAILED_TO_LOAD');
    } finally {
      setIsLoading(false);
    }
  }, [language]);

  useEffect(() => {
    if (canView) load();
  }, [canView, load]);

  // §10 CRITICAL: "Current"/"Previous" summary cards only ever reflect a
  // REAL checkpoint created THROUGH this system (never the read-only
  // legacy/seed entries, which are historical display data only, shown in
  // Version History below with their own "Legacy" badge) - so nothing here
  // is ever fabricated when no real checkpoint exists yet.
  const realCheckpoints = useMemo(() => versions.filter((v) => !v.isLegacyRecord && v.checkpointType === 'RELEASE'), [versions]);
  const currentVersion = realCheckpoints[0];
  const previousVersion = realCheckpoints[1];
  const hasNoRealCheckpointsYet = loadState === 'READY' && realCheckpoints.length === 0;
  const rollbackTargets = useMemo(() => versions.filter((v) => !v.isLegacyRecord && isValidCommitSha(v.commitSha) && v.id !== currentVersion?.id && v.checkpointType === 'RELEASE'), [versions, currentVersion]);
  const knownGoodTargets = useMemo(() => rollbackTargets.filter((v) => v.isKnownGood), [rollbackTargets]);

  if (!canView) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-2" dir={isRtl ? 'rtl' : 'ltr'}>
        <AlertCircle className="w-6 h-6 text-red-600 mx-auto" />
        <p className="text-xs font-bold text-red-800">{t('لا توجد لديك صلاحية الوصول إلى إدارة إصدارات النظام.', 'You do not have permission to access System Version Management.', language)}</p>
      </div>
    );
  }

  const handleCreateCheckpoint = async () => {
    setIsSavingCheckpoint(true);
    setFeedback(null);
    try {
      await createReleaseCheckpoint(checkpointDraft);
      setFeedback({ type: 'success', message: t('تم إنشاء نقطة الإصدار بنجاح.', 'Release checkpoint created successfully.', language) });
      setShowCheckpointForm(false);
      setCheckpointDraft({ versionLabel: '', commitSha: '', branch: 'main', buildId: '', deploymentReference: '', environment: 'production', releaseNotes: '' });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || t('فشل إنشاء نقطة الإصدار.', 'Failed to create checkpoint.', language) });
    } finally {
      setIsSavingCheckpoint(false);
    }
  };

  const handleMarkKnownGood = async (versionId: string) => {
    setFeedback(null);
    try {
      await markVersionKnownGood(versionId);
      setFeedback({ type: 'success', message: t('تم اعتماد الإصدار كنسخة مستقرة.', 'Version marked as Known Good.', language) });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || t('فشل التحديث.', 'Update failed.', language) });
    }
  };

  const openRollbackWizard = (target: SystemVersionRecord, isEmergency = false) => {
    setRollbackWizard({
      step: 'SELECT',
      target,
      reason: '',
      reasonCategory: 'REGRESSION',
      requiresTwoPersonApproval: false,
      isEmergency,
    });
  };

  const advanceToReview = () => setRollbackWizard((w) => (w ? { ...w, step: 'REVIEW' } : w));

  const advanceToHealthCheck = async () => {
    if (!rollbackWizard) return;
    setIsProcessingWizard(true);
    try {
      const health = await runHealthCheck();
      setRollbackWizard((w) => (w ? { ...w, step: 'HEALTH', preHealth: health } : w));
    } finally {
      setIsProcessingWizard(false);
    }
  };

  const advanceToConfirm = () => {
    if (!rollbackWizard?.reason.trim()) {
      setRollbackWizard((w) => (w ? { ...w, error: t('يجب إدخال سبب التراجع.', 'A rollback reason is required.', language) } : w));
      return;
    }
    setRollbackWizard((w) => (w ? { ...w, step: 'CONFIRM', error: undefined } : w));
  };

  const handleConfirmRollback = async () => {
    if (!rollbackWizard?.target || !currentVersion) return;
    setIsProcessingWizard(true);
    setRollbackWizard((w) => (w ? { ...w, error: undefined } : w));
    try {
      const rollbackId = await requestRollback({
        fromVersion: currentVersion,
        toVersion: rollbackWizard.target,
        reason: rollbackWizard.reason,
        reasonCategory: rollbackWizard.reasonCategory,
        requiresTwoPersonApproval: rollbackWizard.requiresTwoPersonApproval,
        isEmergency: rollbackWizard.isEmergency,
      });
      if (!rollbackWizard.requiresTwoPersonApproval) {
        const result = await executeRollback(rollbackId);
        setRollbackWizard((w) => (w ? { ...w, step: 'DONE', rollbackId, result } : w));
      } else {
        setRollbackWizard((w) => (w ? { ...w, step: 'DONE', rollbackId } : w));
      }
      await load();
    } catch (err: any) {
      if (err instanceof RollbackLockError) {
        setRollbackWizard((w) => (w ? { ...w, error: t('يوجد تراجع آخر قيد التنفيذ حاليًا - يرجى الانتظار حتى انتهائه.', 'Another rollback is currently in progress - please wait for it to finish.', language) } : w));
      } else {
        setRollbackWizard((w) => (w ? { ...w, error: err.message || t('فشل تنفيذ التراجع.', 'Rollback execution failed.', language) } : w));
      }
    } finally {
      setIsProcessingWizard(false);
    }
  };

  const handleApproveRollback = async (rollbackId: string) => {
    setFeedback(null);
    try {
      await approveRollback(rollbackId);
      const result = await executeRollback(rollbackId);
      setFeedback({ type: result.status === 'SUCCESS' || result.status === 'RUNNING' ? 'success' : 'error', message: t(`حالة التراجع: ${result.status}`, `Rollback status: ${result.status}`, language) });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || t('فشل الاعتماد.', 'Approval failed.', language) });
    }
  };

  const handleCancelRollback = async (rollbackId: string) => {
    setFeedback(null);
    try {
      await cancelRollback(rollbackId, t('ألغيت من واجهة إدارة الإصدارات.', 'Cancelled from System Version Management.', language));
      setFeedback({ type: 'success', message: t('تم إلغاء طلب التراجع.', 'Rollback request cancelled.', language) });
      await load();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || t('فشل الإلغاء.', 'Cancel failed.', language) });
    }
  };

  const handleConfirmManualDeployment = async (rollbackId: string) => {
    setFeedback(null);
    try {
      const result = await confirmManualDeploymentComplete(rollbackId, manualConfirmRef || undefined);
      setFeedback({ type: result.status === 'SUCCESS' ? 'success' : 'error', message: t(`نتيجة التراجع: ${result.status}`, `Rollback outcome: ${result.status}`, language) });
      setManualConfirmRef('');
      setRollbackDetail(null);
      await load();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || t('فشل التأكيد.', 'Confirmation failed.', language) });
    }
  };

  const formatDuration = (op: RollbackOperation) => {
    if (!op.startedAt || !op.completedAt) return '-';
    const ms = new Date(op.completedAt).getTime() - new Date(op.startedAt).getTime();
    return `${Math.round(ms / 1000)}s`;
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-emerald-600" />
            <span>{t('إدارة إصدارات النظام', 'System Version Management', language)}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {t('إدارة إصدارات كود التطبيق والنشر - منفصلة تمامًا عن استعادة بيانات Firestore.', 'Manages the application code/deployment version - entirely separate from Firestore data restore.', language)}
          </p>
        </div>
        {canManage && (
          <button type="button" onClick={() => setShowCheckpointForm(true)} className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs cursor-pointer">
            <Plus className="w-4 h-4" />
            {t('إنشاء نقطة إصدار', 'Create Release Checkpoint', language)}
          </button>
        )}
      </div>

      {/* Data Safety Warning - always visible (§29 CRITICAL) */}
      <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs font-bold text-amber-900">
          {t('إرجاع إصدار البرنامج لا يعيد بيانات Firestore تلقائيًا.', 'Rolling back the application version does not automatically roll back Firestore data.', language)}
        </p>
      </div>

      {/* Running Build (§4/§9/§15/§22) - zero Firestore dependency, so this is
          always accurate even when the reads below fail entirely. Never
          claims a production deployment for a local dev session. */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
        <span className="font-black text-slate-700">{t('البيئة الحالية', 'Running Build', language)}</span>
        {runningBuild.isLocalDevelopment ? (
          <>
            <span className="font-bold px-2 py-0.5 rounded border bg-sky-100 text-sky-800 border-sky-300">{t('تطوير محلي', 'Local Development', language)}</span>
            <span className="text-slate-500">{t('النشر', 'Deployment', language)}: <span className="font-bold text-slate-600">{t('غير منشور', 'Not Deployed', language)}</span></span>
          </>
        ) : (
          <>
            <span className="font-bold px-2 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-300">{runningBuild.environment}</span>
            <span className="text-slate-500">{t('الإصدار المُجمّع', 'Compiled Version', language)}: <span className="font-mono font-bold text-slate-700">v{runningBuild.versionLabel}</span></span>
            <span className="text-slate-500">Build: <span className="font-mono font-bold text-slate-700">{runningBuild.buildId}</span></span>
            <span className="text-slate-500">Commit: <span className="font-mono font-bold text-slate-700">{runningBuild.commitSha}</span></span>
          </>
        )}
      </div>

      {/* Rollback lock banner (§32) */}
      {activeLock && (
        <div className="bg-sky-50 border border-sky-300 rounded-2xl p-4 flex items-center gap-3">
          <Lock className="w-5 h-5 text-sky-600 shrink-0" />
          <div className="text-xs font-bold text-sky-900">
            {t('تراجع قيد التنفيذ', 'Rollback In Progress', language)}: v{activeLock.fromVersionLabel} → v{activeLock.toVersionLabel} ({t('الحالة', 'status', language)}: <StatusPill value={activeLock.status} map={STATUS_BADGE} language={language} />)
          </div>
          <button type="button" onClick={() => setRollbackDetail(activeLock)} className="ms-auto text-[11px] font-bold text-sky-700 underline cursor-pointer">{t('التفاصيل', 'Details', language)}</button>
        </div>
      )}

      {feedback && (
        <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {loadState === 'LOADING' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 flex items-center justify-center gap-2 text-slate-500 text-xs font-bold">
          <Loader2 className="w-5 h-5 animate-spin" />
          {t('جاري التحميل...', 'Loading...', language)}
        </div>
      )}

      {/* §13/§14: Permission Denied is its own distinct, actionable state - never lumped into one generic error, and never a raw Firestore/JSON error shown to the user. */}
      {loadState === 'PERMISSION_DENIED' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-2">
          <AlertCircle className="w-6 h-6 text-red-600 mx-auto" />
          <p className="text-xs font-black text-red-900">{t('تم رفض الوصول إلى بيانات إصدارات النظام.', 'Access to system version data was denied.', language)}</p>
          <p className="text-[11px] text-red-700">
            {t(
              'إذا كنت مديرًا أعلى (SUPER_ADMIN) وتتوقع الوصول، فمن المرجح أن قواعد أمان Firestore الخاصة بمجموعتي systemVersions وversionRollbacks (الموجودة في ملف firestore.rules ضمن المستودع) لم يتم نشرها بعد على مشروع Firebase الفعلي.',
              'If you are a SUPER_ADMIN and expected access, the Firestore security rules for the systemVersions/versionRollbacks collections (present in this repository\'s firestore.rules) have most likely not yet been deployed to the live Firebase project.',
              language
            )}
          </p>
          <button type="button" onClick={() => load()} className="text-[11px] font-bold text-red-800 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg cursor-pointer">{t('إعادة المحاولة', 'Retry', language)}</button>
        </div>
      )}

      {loadState === 'FAILED_TO_LOAD' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-2">
          <AlertCircle className="w-6 h-6 text-red-600 mx-auto" />
          <p className="text-xs font-black text-red-900">{t('معلومات إصدارات النظام غير متاحة حاليًا.', 'Version information is currently unavailable.', language)}</p>
          <button type="button" onClick={() => load()} className="text-[11px] font-bold text-red-800 bg-red-100 hover:bg-red-200 px-3 py-1.5 rounded-lg cursor-pointer">{t('إعادة المحاولة', 'Retry', language)}</button>
        </div>
      )}

      {loadState === 'READY' && (
        <>
          {hasNoRealCheckpointsYet && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-[11px] font-bold text-slate-600">
              {t('لا توجد نقاط إصدار حقيقية بعد. استخدم "إنشاء نقطة إصدار" لتسجيل أول إصدار فعلي.', 'No real release checkpoints exist yet. Use "Create Release Checkpoint" to record the first real release.', language)}
            </div>
          )}
          {/* Current / Previous Version summary cards (§3) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: t('الإصدار الحالي', 'Current Version', language), v: currentVersion, accent: 'emerald' },
              { label: t('الإصدار السابق', 'Previous Version', language), v: previousVersion, accent: 'slate' },
            ].map(({ label, v, accent }) => (
              <div key={label} className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-2">
                <span className="text-[11px] font-bold text-slate-500">{label}</span>
                {v ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono font-black text-lg text-${accent}-700`}>v{v.versionLabel}</span>
                      <StatusPill value={v.status} map={STATUS_BADGE} language={language} />
                      <StatusPill value={v.health} map={HEALTH_BADGE} language={language} />
                      {v.isKnownGood && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded border bg-violet-100 text-violet-800 border-violet-300 flex items-center gap-1">
                          <Star className="w-3 h-3" />
                          {t('نسخة مستقرة', 'Known Good', language)}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono flex items-center gap-1.5">
                      <GitCommit className="w-3.5 h-3.5" />
                      {v.commitSha}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {t('صدر في', 'Released', language)}: {new Date(v.createdAt).toLocaleString()} · {t('بواسطة', 'by', language)} {v.createdByName || '-'}
                    </div>
                    <button type="button" onClick={() => setDetailVersion(v)} className="text-[11px] font-bold text-sky-700 underline cursor-pointer">{t('التفاصيل', 'Details', language)}</button>
                  </>
                ) : (
                  <span className="text-xs text-slate-400">{t('غير متاح - لا توجد نقطة إصدار حقيقية مسجلة بعد', 'Not available - no real release checkpoint recorded yet', language)}</span>
                )}
              </div>
            ))}
          </div>

          {/* Rollback quick actions (§7) */}
          {canRollback && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
              <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><RotateCcw className="w-4 h-4 text-red-600" />{t('التراجع', 'Rollback', language)}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {previousVersion && isValidCommitSha(previousVersion.commitSha) && (
                  <button type="button" disabled={!!activeLock} onClick={() => openRollbackWizard(previousVersion)} className="text-xs font-bold px-3 py-2 bg-red-50 hover:bg-red-100 text-red-800 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
                    {t(`الرجوع إلى الإصدار السابق v${previousVersion.versionLabel}`, `Rollback to Previous Version v${previousVersion.versionLabel}`, language)}
                  </button>
                )}
                {isSuperAdmin && currentVersion && (
                  <button type="button" disabled={!!activeLock || rollbackTargets.length === 0} onClick={() => rollbackTargets[0] && openRollbackWizard(rollbackTargets[0], true)} className="text-xs font-black px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5" />
                    {t('تراجع طارئ', 'Emergency Rollback', language)}
                  </button>
                )}
              </div>
              {/* §16 CRITICAL: rollback stays disabled with this exact message until a real target exists - never a synthesized/fake target. */}
              {rollbackTargets.length === 0 ? (
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 font-bold">
                  {t('لا توجد أهداف تراجع متاحة حاليًا.', 'No rollback target is currently available.', language)}
                </p>
              ) : knownGoodTargets.length === 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  {t('لا توجد نسخة معتمدة كمستقرة بعد - يمكنك الاختيار من سجل الإصدارات أدناه (§7: لا تُعرض إصدارات غير موثوقة كأهداف موصى بها).', 'No version is marked Known Good yet - you may still select a target from the version history below (§7: unverified versions are never shown as a recommended target).', language)}
                </p>
              )}
            </div>
          )}

          {/* Change Registry (Layer 3) - its own component so this file, which
              already owns version history and rollback, stays reviewable. */}
          <ChangeRegistryPanel />

          {/* Version History (§4) */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3 overflow-x-auto">
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><History className="w-4 h-4 text-slate-600" />{t('سجل الإصدارات', 'Version History', language)}</h2>
            <table className="w-full text-xs min-w-[820px]">
              <thead>
                <tr className="text-[11px] text-slate-500 border-b border-slate-100">
                  <th className="text-start py-2 font-bold">{t('الإصدار', 'Version', language)}</th>
                  <th className="text-start py-2 font-bold">{t('التاريخ', 'Date', language)}</th>
                  <th className="text-start py-2 font-bold">{t('الكود المرجعي', 'Commit', language)}</th>
                  <th className="text-start py-2 font-bold">{t('بواسطة', 'Author', language)}</th>
                  <th className="text-start py-2 font-bold">{t('الحالة', 'Status', language)}</th>
                  <th className="text-start py-2 font-bold">{t('الصحة', 'Health', language)}</th>
                  <th className="text-start py-2 font-bold">{t('التراجع متاح', 'Rollback Available', language)}</th>
                  <th className="text-start py-2 font-bold">{t('إجراءات', 'Actions', language)}</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const canBeRollbackTarget = !v.isLegacyRecord && isValidCommitSha(v.commitSha) && v.id !== currentVersion?.id && v.checkpointType === 'RELEASE';
                  return (
                    <tr key={v.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="py-2 font-mono font-bold text-slate-800">
                        v{v.versionLabel} {v.checkpointType === 'PRE_ROLLBACK_CHECKPOINT' && <span className="text-[9px] text-slate-400">({t('نقطة استعادة', 'checkpoint', language)})</span>}
                        {v.isKnownGood && <Star className="inline w-3 h-3 text-violet-600 ms-1" />}
                        {v.isLegacyRecord && <span className="ms-1 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-slate-100 text-slate-500 border-slate-300">{t('قديم - بدون كود التزام موثوق', 'Legacy - no verified commit', language)}</span>}
                      </td>
                      <td className="py-2 text-slate-500">{new Date(v.createdAt).toLocaleDateString()}</td>
                      <td className="py-2 font-mono text-slate-500">{v.commitSha.slice(0, 10)}</td>
                      <td className="py-2 text-slate-600">{v.createdByName || '-'}</td>
                      <td className="py-2"><StatusPill value={v.status} map={STATUS_BADGE} language={language} /></td>
                      <td className="py-2"><StatusPill value={v.health} map={HEALTH_BADGE} language={language} /></td>
                      <td className="py-2">{canBeRollbackTarget ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <span className="text-slate-300">-</span>}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => setDetailVersion(v)} className="text-[11px] font-bold text-sky-700 underline cursor-pointer">{t('عرض', 'View', language)}</button>
                          {canManage && !v.isKnownGood && !v.isLegacyRecord && v.checkpointType === 'RELEASE' && (
                            <button type="button" onClick={() => handleMarkKnownGood(v.id!)} className="text-[11px] font-bold text-violet-700 underline cursor-pointer">{t('اعتماد كمستقرة', 'Mark Known Good', language)}</button>
                          )}
                          {canRollback && canBeRollbackTarget && (
                            <button type="button" disabled={!!activeLock} onClick={() => openRollbackWizard(v)} className="text-[11px] font-bold text-red-700 underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">{t('تراجع', 'Rollback', language)}</button>
                          )}
                          <button
                            type="button"
                            onClick={() => setCompareState((c) => (!c?.a ? { a: v } : { a: c.a, b: v }))}
                            className="text-[11px] font-bold text-slate-500 underline cursor-pointer"
                          >
                            {t('مقارنة', 'Compare', language)}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Rollback History (§34) */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3 overflow-x-auto">
            <h2 className="text-sm font-black text-slate-900 flex items-center gap-2"><Layers className="w-4 h-4 text-slate-600" />{t('سجل عمليات التراجع', 'Rollback History', language)}</h2>
            {rollbackHistory.length === 0 ? (
              <p className="text-xs text-slate-400">{t('لا توجد عمليات تراجع بعد.', 'No rollback operations yet.', language)}</p>
            ) : (
              <table className="w-full text-xs min-w-[820px]">
                <thead>
                  <tr className="text-[11px] text-slate-500 border-b border-slate-100">
                    <th className="text-start py-2 font-bold">{t('التاريخ', 'Date', language)}</th>
                    <th className="text-start py-2 font-bold">{t('من', 'From', language)}</th>
                    <th className="text-start py-2 font-bold">{t('إلى', 'To', language)}</th>
                    <th className="text-start py-2 font-bold">{t('المستخدم', 'User', language)}</th>
                    <th className="text-start py-2 font-bold">{t('السبب', 'Reason', language)}</th>
                    <th className="text-start py-2 font-bold">{t('الحالة', 'Status', language)}</th>
                    <th className="text-start py-2 font-bold">{t('المدة', 'Duration', language)}</th>
                    <th className="text-start py-2 font-bold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rollbackHistory.map((op) => (
                    <tr key={op.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="py-2 text-slate-500">{new Date(op.requestedAt).toLocaleString()}</td>
                      <td className="py-2 font-mono">v{op.fromVersionLabel}</td>
                      <td className="py-2 font-mono">v{op.toVersionLabel}</td>
                      <td className="py-2 text-slate-600">{op.requestedByName || '-'}</td>
                      <td className="py-2 text-slate-600">{REASON_CATEGORIES.find((r) => r.key === op.reasonCategory)?.[language] || op.reasonCategory}</td>
                      <td className="py-2"><StatusPill value={op.status} map={STATUS_BADGE} language={language} /></td>
                      <td className="py-2 text-slate-500">{formatDuration(op)}</td>
                      <td className="py-2">
                        <button type="button" onClick={() => setRollbackDetail(op)} className="text-[11px] font-bold text-sky-700 underline cursor-pointer">{t('التفاصيل', 'Details', language)}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Release Checkpoint creation modal (§5) */}
      {showCheckpointForm && (
        <Modal isOpen onClose={() => setShowCheckpointForm(false)} title={t('إنشاء نقطة إصدار', 'Create Release Checkpoint', language)} maxWidth="lg">
          <div className="space-y-3 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
            {/* §8/§22 CRITICAL: a checkpoint is a claim about a REAL deployed
                commit - this session cannot verify that on its own, so an
                admin testing locally is told explicitly not to record a
                fake production release. */}
            {runningBuild.isLocalDevelopment && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 font-bold">
                {t('أنت تعمل حاليًا في بيئة تطوير محلية. أنشئ نقطة إصدار فقط لكود التزام تم نشره فعليًا - لا تُسجّل هذه الجلسة المحلية كإصدار إنتاج.', 'You are currently running in a local development environment. Only create a checkpoint for a commit that was actually deployed - do not record this local session as a production release.', language)}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-600 mb-1">{t('رقم الإصدار (مثال 1.8.2)', 'Version Label (e.g. 1.8.2)', language)}</label>
                <input type="text" value={checkpointDraft.versionLabel} onChange={(e) => setCheckpointDraft((d) => ({ ...d, versionLabel: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5" />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">{t('كود الالتزام (Commit SHA)', 'Commit SHA', language)}</label>
                <input type="text" value={checkpointDraft.commitSha} onChange={(e) => setCheckpointDraft((d) => ({ ...d, commitSha: e.target.value }))} placeholder="a1b2c3d" className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono" />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">{t('الفرع', 'Branch', language)}</label>
                <input type="text" value={checkpointDraft.branch} onChange={(e) => setCheckpointDraft((d) => ({ ...d, branch: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5" />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">{t('معرّف البناء (Build ID)', 'Build ID', language)}</label>
                <input type="text" value={checkpointDraft.buildId} onChange={(e) => setCheckpointDraft((d) => ({ ...d, buildId: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5" />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">{t('مرجع النشر', 'Deployment Reference', language)}</label>
                <input type="text" value={checkpointDraft.deploymentReference} onChange={(e) => setCheckpointDraft((d) => ({ ...d, deploymentReference: e.target.value }))} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5" />
              </div>
              <div>
                <label className="block font-bold text-slate-600 mb-1">{t('البيئة', 'Environment', language)}</label>
                <select value={checkpointDraft.environment} onChange={(e) => setCheckpointDraft((d) => ({ ...d, environment: e.target.value as any }))} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5">
                  <option value="production">{t('إنتاج', 'production', language)}</option>
                  <option value="staging">{t('تجريبي', 'staging', language)}</option>
                  <option value="development">{t('تطوير', 'development', language)}</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-bold text-slate-600 mb-1">{t('ملاحظات الإصدار', 'Release Notes', language)}</label>
              <textarea value={checkpointDraft.releaseNotes} onChange={(e) => setCheckpointDraft((d) => ({ ...d, releaseNotes: e.target.value }))} rows={3} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5" />
            </div>
            {!isValidCommitSha(checkpointDraft.commitSha) && checkpointDraft.commitSha.length > 0 && (
              <p className="text-[11px] text-red-600 font-bold">{t('كود الالتزام يجب أن يكون 7-40 حرفًا سداسيًا عشريًا.', 'Commit SHA must be 7-40 hexadecimal characters.', language)}</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setShowCheckpointForm(false)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
              <button type="button" disabled={isSavingCheckpoint} onClick={handleCreateCheckpoint} className="px-4 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer disabled:opacity-50">
                {isSavingCheckpoint ? <Loader2 className="w-4 h-4 animate-spin" /> : t('حفظ', 'Save', language)}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Version Detail (§25) */}
      {detailVersion && (
        <Modal isOpen onClose={() => setDetailVersion(null)} title={`v${detailVersion.versionLabel}`} maxWidth="md">
          <div className="space-y-2 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
            {[
              [t('الإصدار', 'Version', language), detailVersion.versionLabel],
              [t('كود الالتزام', 'Commit SHA', language), detailVersion.commitSha],
              [t('الفرع', 'Branch', language), detailVersion.branch],
              [t('معرّف البناء', 'Build ID', language), detailVersion.buildId],
              [t('معرّف النشر', 'Deployment ID', language), detailVersion.deploymentId || '-'],
              [t('تاريخ الإنشاء', 'Created At', language), new Date(detailVersion.createdAt).toLocaleString()],
              [t('بواسطة', 'Created By', language), detailVersion.createdByName || '-'],
              [t('البيئة', 'Environment', language), detailVersion.environment],
              [t('الحالة', 'Status', language), detailVersion.status],
              [t('الصحة', 'Health', language), detailVersion.health],
              [t('نسخة مستقرة', 'Known Good', language), detailVersion.isKnownGood ? t('نعم', 'Yes', language) : t('لا', 'No', language)],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between border-b border-slate-50 py-1">
                <span className="font-bold text-slate-500">{k}</span>
                <span className="font-mono text-slate-800">{v}</span>
              </div>
            ))}
            {detailVersion.releaseNotes && (
              <div className="pt-2">
                <span className="font-bold text-slate-500 flex items-center gap-1"><FileText className="w-3.5 h-3.5" />{t('ملاحظات الإصدار', 'Release Notes', language)}</span>
                <p className="text-slate-700 mt-1 whitespace-pre-line">{detailVersion.releaseNotes}</p>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Version Comparison (§27) */}
      {compareState?.a && compareState?.b && (
        <Modal isOpen onClose={() => setCompareState(null)} title={t(`مقارنة v${compareState.a.versionLabel} مقابل v${compareState.b.versionLabel}`, `Compare v${compareState.a.versionLabel} vs v${compareState.b.versionLabel}`, language)} maxWidth="lg">
          <div className="grid grid-cols-2 gap-4 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
            {[compareState.a, compareState.b].map((v, idx) => (
              <div key={idx} className="space-y-1.5 border border-slate-200 rounded-xl p-3">
                <span className="font-mono font-black text-slate-800">v{v.versionLabel}</span>
                <div className="text-slate-500 font-mono">{v.commitSha}</div>
                <div>{t('الفرع', 'Branch', language)}: {v.branch}</div>
                <div>{t('البيئة', 'Environment', language)}: {v.environment}</div>
                <div className="whitespace-pre-line text-slate-600">{v.releaseNotes}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 mt-3">{t('يتم الاعتماد على معرّفات الالتزام (Commit) للمقارنة الدقيقة بدلاً من الاحتفاظ بنسخة مكررة من الشيفرة المصدرية.', 'Comparison relies on commit references rather than maintaining a duplicate source snapshot.', language)}</p>
        </Modal>
      )}

      {/* Rollback Wizard (§8) */}
      {rollbackWizard && (
        <Modal isOpen onClose={() => (rollbackWizard.step !== 'RUNNING' ? setRollbackWizard(null) : undefined)} title={t('معالج التراجع', 'Rollback Wizard', language)} maxWidth="lg">
          <div className="space-y-4 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
            {/* Step indicator */}
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
              {['SELECT', 'REVIEW', 'HEALTH', 'CONFIRM', 'DONE'].map((s, i) => (
                <React.Fragment key={s}>
                  <span className={rollbackWizard.step === s ? 'text-emerald-700' : ''}>{i + 1}</span>
                  {i < 4 && <ArrowRight className="w-3 h-3" />}
                </React.Fragment>
              ))}
            </div>

            {rollbackWizard.step === 'SELECT' && rollbackWizard.target && (
              <div className="space-y-3">
                <p className="font-bold text-slate-700">{t('الهدف المحدد:', 'Selected target:', language)} <span className="font-mono">v{rollbackWizard.target.versionLabel}</span></p>
                <button type="button" onClick={advanceToReview} className="px-4 py-2 text-xs font-black text-white bg-slate-700 hover:bg-slate-800 rounded-lg cursor-pointer">{t('التالي: مراجعة التفاصيل', 'Next: Review Details', language)}</button>
              </div>
            )}

            {rollbackWizard.step === 'REVIEW' && rollbackWizard.target && currentVersion && (
              <div className="space-y-3">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
                  <div>{t('الإصدار الحالي', 'Current Version', language)}: <span className="font-mono font-bold">v{currentVersion.versionLabel}</span></div>
                  <div>{t('الهدف', 'Target', language)}: <span className="font-mono font-bold">v{rollbackWizard.target.versionLabel}</span></div>
                  <div className="text-slate-500">{t('نقطة استعادة', 'Checkpoint', language)}: {t('سيتم إنشاؤها', 'Will be created', language)}</div>
                  <div className="text-slate-500">{t('الأثر المتوقع', 'Estimated impact', language)}: {t('نشر التطبيق فقط', 'Application deployment only', language)}</div>
                  <div className="text-red-600 font-bold">{t('البيانات', 'Data', language)}: {t('لن يتم إرجاع بيانات Firestore', 'Firestore data will NOT be rolled back', language)}</div>
                </div>
                <div>
                  <label className="block font-bold text-slate-600 mb-1">{t('سبب التراجع (إجباري)', 'Rollback Reason (required)', language)}</label>
                  <select value={rollbackWizard.reasonCategory} onChange={(e) => setRollbackWizard((w) => (w ? { ...w, reasonCategory: e.target.value as RollbackReasonCategory } : w))} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 mb-1.5">
                    {REASON_CATEGORIES.map((r) => <option key={r.key} value={r.key}>{language === 'ar' ? r.ar : r.en}</option>)}
                  </select>
                  <textarea value={rollbackWizard.reason} onChange={(e) => setRollbackWizard((w) => (w ? { ...w, reason: e.target.value } : w))} rows={2} placeholder={t('تفاصيل السبب...', 'Reason details...', language)} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5" />
                </div>
                <label className="flex items-center gap-2 text-[11px] font-bold text-slate-600">
                  <input type="checkbox" checked={rollbackWizard.requiresTwoPersonApproval} onChange={(e) => setRollbackWizard((w) => (w ? { ...w, requiresTwoPersonApproval: e.target.checked } : w))} />
                  {t('طلب اعتماد شخصين (اختياري)', 'Require two-person approval (optional)', language)}
                </label>
                {rollbackWizard.error && <p className="text-[11px] text-red-600 font-bold">{rollbackWizard.error}</p>}
                <button type="button" onClick={advanceToHealthCheck} disabled={isProcessingWizard} className="px-4 py-2 text-xs font-black text-white bg-slate-700 hover:bg-slate-800 rounded-lg cursor-pointer disabled:opacity-50">
                  {isProcessingWizard ? <Loader2 className="w-4 h-4 animate-spin" /> : t('التالي: فحص الصحة', 'Next: Health Check', language)}
                </button>
              </div>
            )}

            {rollbackWizard.step === 'HEALTH' && rollbackWizard.preHealth && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-700">{t('نتيجة فحص الصحة الحالية:', 'Current health check result:', language)}</span>
                  <StatusPill value={rollbackWizard.preHealth.overall} map={HEALTH_BADGE} language={language} />
                </div>
                <div className="space-y-1">
                  {rollbackWizard.preHealth.checks.map((c) => (
                    <div key={c.name} className="flex items-center justify-between text-[11px]">
                      <span>{language === 'ar' ? c.nameAr : c.nameEn}</span>
                      {c.passed ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertCircle className="w-3.5 h-3.5 text-red-600" />}
                    </div>
                  ))}
                </div>
                {rollbackWizard.preHealth.overall === 'UNHEALTHY' && !rollbackWizard.isEmergency && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{t('النظام غير سليم حاليًا - لا يزال بإمكانك المتابعة إذا كنت تملك الصلاحية (تراجع طارئ).', 'The system is currently unhealthy - you may still proceed if you have permission (emergency rollback).', language)}</p>
                )}
                <button type="button" onClick={advanceToConfirm} className="px-4 py-2 text-xs font-black text-white bg-slate-700 hover:bg-slate-800 rounded-lg cursor-pointer">{t('التالي: التأكيد', 'Next: Confirmation', language)}</button>
              </div>
            )}

            {rollbackWizard.step === 'CONFIRM' && rollbackWizard.target && (
              <div className="space-y-3">
                <p className="font-bold text-slate-800">
                  {t('سيتم إرجاع النظام إلى الإصدار المحدد. سيتم أولاً حفظ نقطة استعادة للإصدار الحالي. هل تريد المتابعة؟', 'The system will be rolled back to the selected version. A recovery checkpoint for the current version will be created first. Continue?', language)}
                </p>
                {rollbackWizard.error && <p className="text-[11px] text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">{rollbackWizard.error}</p>}
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setRollbackWizard(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
                  <button type="button" disabled={isProcessingWizard} onClick={handleConfirmRollback} className="px-4 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                    {isProcessingWizard ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    {t('تراجع', 'Rollback', language)}
                  </button>
                </div>
              </div>
            )}

            {rollbackWizard.step === 'DONE' && (
              <div className="space-y-3">
                {rollbackWizard.result ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{t('النتيجة:', 'Result:', language)}</span>
                      <StatusPill value={rollbackWizard.result.status} map={STATUS_BADGE} language={language} />
                    </div>
                    {rollbackWizard.result.status === 'RUNNING' && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">{t('بانتظار إتمام النشر يدويًا خارج التطبيق، ثم التأكيد من سجل عمليات التراجع.', 'Awaiting manual deployment completion outside the app, then confirmation from Rollback History.', language)}</p>
                    )}
                    {rollbackWizard.result.status === 'FAILED' && (
                      <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{t('فشل التراجع بعد فحص الصحة اللاحق - تم الحفاظ على نقطة الاستعادة.', 'Rollback failed the post-deployment health check - the checkpoint has been preserved.', language)}</p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-600">{t('تم تسجيل طلب التراجع وينتظر اعتماد الطرف الثاني.', 'Rollback request recorded and awaiting second-person approval.', language)}</p>
                )}
                <button type="button" onClick={() => setRollbackWizard(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إغلاق', 'Close', language)}</button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Rollback operation detail / manual-completion confirmation */}
      {rollbackDetail && (
        <Modal isOpen onClose={() => setRollbackDetail(null)} title={t('تفاصيل عملية التراجع', 'Rollback Operation Details', language)} maxWidth="lg">
          <div className="space-y-2 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
            {[
              [t('من', 'From', language), `v${rollbackDetail.fromVersionLabel}`],
              [t('إلى', 'To', language), `v${rollbackDetail.toVersionLabel}`],
              [t('الحالة', 'Status', language), rollbackDetail.status],
              [t('طلب بواسطة', 'Requested By', language), rollbackDetail.requestedByName || '-'],
              [t('السبب', 'Reason', language), rollbackDetail.reason],
              [t('وقت الطلب', 'Requested At', language), new Date(rollbackDetail.requestedAt).toLocaleString()],
              [t('نقطة الاستعادة', 'Checkpoint', language), rollbackDetail.checkpointVersionId || '-'],
              [t('مرجع النشر', 'Deployment Reference', language), rollbackDetail.deploymentReference || '-'],
            ].map(([k, v]) => (
              <div key={k as string} className="flex items-center justify-between border-b border-slate-50 py-1">
                <span className="font-bold text-slate-500">{k}</span>
                <span className="font-mono text-slate-800">{v}</span>
              </div>
            ))}
            {rollbackDetail.failureDetails && <p className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{rollbackDetail.failureDetails}</p>}

            {rollbackDetail.status === 'REQUESTED' && canRollback && (
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => handleApproveRollback(rollbackDetail.id!)} className="px-3 py-1.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer">{t('اعتماد وتنفيذ', 'Approve & Execute', language)}</button>
                <button type="button" onClick={() => handleCancelRollback(rollbackDetail.id!)} className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
              </div>
            )}
            {rollbackDetail.status === 'RUNNING' && canRollback && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <p className="text-[11px] text-slate-600">{t('بعد إتمام النشر اليدوي خارج التطبيق، أدخل مرجع النشر (اختياري) واضغط تأكيد الإتمام.', 'After completing the manual deployment outside the app, optionally enter the deployment reference and confirm completion.', language)}</p>
                <input type="text" value={manualConfirmRef} onChange={(e) => setManualConfirmRef(e.target.value)} placeholder={t('مرجع النشر (اختياري)', 'Deployment reference (optional)', language)} className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5" />
                <button type="button" onClick={() => handleConfirmManualDeployment(rollbackDetail.id!)} className="px-3 py-1.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer">{t('تأكيد إتمام النشر وتشغيل فحص الصحة', 'Confirm Deployment Complete & Run Health Check', language)}</button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};

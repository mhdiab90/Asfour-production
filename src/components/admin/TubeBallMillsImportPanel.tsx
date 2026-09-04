/**
 * Tube/Ball Mills Historical Import Panel.
 *
 * Mirrors ChineseMillsImportPanel.tsx's architecture and conventions
 * closely (row-based review, rowSelection/approved/readyToImport, review
 * windows, a single consolidated "Needs Review" table + row-level Edit
 * modal rather than four separate single-purpose coding popups - see the
 * Edit Row modal's own comment for why that consolidation is a deliberate,
 * reasoned simplification, not a corner cut) - never a second/divergent
 * import architecture. Domain-specific pieces (Mill/Material/Mixture/
 * Bunker resolution) live in tubeBallMillsHistoricalImportService.ts and
 * its pure helpers.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Edit3, Loader2, Upload, Ban, History, X, RotateCcw, FileSpreadsheet, Download, ListChecks } from 'lucide-react';
import * as XLSX from 'xlsx';
import { TubeBallMillsImportRow, TubeBallMillsImportSummary } from '../../types';
import {
  parseAndValidateTubeBallMillsExcel,
  revalidateTubeBallMillsRowFields,
  extractFieldsFromRow,
  executeTubeBallMillsBatchImport,
  recheckDatabaseDuplicates,
  createMixtureBOMProduct,
  fetchMasterDataSafe,
  describeMasterDataLoadError,
  getTubeBallMillsImportedRowsByBatch,
  downloadTubeBallMillsExcelTemplate,
  TUBE_BALL_MILL_MASTER_COLLECTION,
  BUNKER_COLLECTION,
  MasterDataLoadError,
} from '../../services/tubeBallMillsHistoricalImportService';
import { extractTubeBallMillsMasterDataGroups, summarizeMasterDataGroup, TubeBallMillsMasterDataExtraction, MasterDataEntityGroup } from '../../services/tubeBallMillsMasterDataExtractionPure';
import {
  isTubeBallMillsRowWritable,
  isNonOverridableBlockingCondition,
  canMarkReadyToImport,
  computeMarkReadyPatch,
  matchesInvalidNeedsReview,
  computeBulkSelectionOutcome,
  computeSelectionCounts,
  getRowSelection,
  BulkSelectionMode,
} from '../../services/tubeBallMillsSelectionPure';
import { planBatchCancellation } from '../../services/chineseMillsSelectionPure';
import { parseMaterialTypeField } from '../../services/tubeBallMillsMixturePure';
import { overrideKey, ManualOverrideMap } from '../../services/tubeBallMillsResolutionPure';
import { normalizeArabicForComparison, normalizeCodeForComparison } from '../../utils/fuzzyMatching';
import { createMasterDataItem, checkCodeDuplicate } from '../../services/masterDataService';
import { loadApprovedMappings, loadHistoricalImportOperations, rollbackImportBatch, ImportAuditEntry } from '../../services/importMappingService';
import { deriveImportFinalStatus, filterImportHistory } from '../../services/importHistoryPure';
import { logAuditAction } from '../../services/auditService';
import { createDatabaseBackup } from '../../services/backupService';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { SearchableCombobox, ComboboxOption } from '../common/SearchableCombobox';
import { TubeBallMillsDraft, saveDraft, getDraft, deleteDraft, logDraftOpened } from '../../services/tubeBallMillsDraftStorage';

type FilterTab = 'ALL' | 'VALID' | 'WARNING' | 'DUPLICATE' | 'EXCLUDED';
type MasterDataEntityGroupTab = 'mill' | 'material' | 'mixture' | 'bunker';

function t(ar: string, en: string, language: 'ar' | 'en'): string {
  return language === 'ar' ? ar : en;
}

const STATUS_LABELS: Record<string, { ar: string; en: string; cls: string }> = {
  VALID: { ar: 'صالح', en: 'Valid', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  WARNING: { ar: 'تحذير', en: 'Warning', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  UNKNOWN_MILL: { ar: 'طاحونة غير معروفة', en: 'Unknown Mill', cls: 'bg-red-100 text-red-800 border-red-300' },
  UNKNOWN_MATERIAL: { ar: 'خامة غير معروفة', en: 'Unknown Material', cls: 'bg-red-100 text-red-800 border-red-300' },
  UNRESOLVED_MIXTURE_COMPONENT: { ar: 'خلطة تحتاج مراجعة', en: 'Mixture Needs Review', cls: 'bg-red-100 text-red-800 border-red-300' },
  UNKNOWN_BUNKER: { ar: 'بنكر غير معروف', en: 'Unknown Bunker', cls: 'bg-red-100 text-red-800 border-red-300' },
  INVALID_BUNKER_ALLOCATION: { ar: 'توزيع بناكر غير صحيح', en: 'Invalid Bunker Allocation', cls: 'bg-red-100 text-red-800 border-red-300' },
  INVALID_DATE: { ar: 'تاريخ غير صالح', en: 'Invalid Date', cls: 'bg-red-100 text-red-800 border-red-300' },
  INVALID_ROW: { ar: 'صف غير صالح', en: 'Invalid Row', cls: 'bg-red-100 text-red-800 border-red-300' },
  DUPLICATE_IN_FILE: { ar: 'مكرر بالملف', en: 'Duplicate in File', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
  DUPLICATE_IN_DATABASE: { ar: 'مشابه بقاعدة البيانات', en: 'Similar in Database', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
};

export const TubeBallMillsImportPanel: React.FC = () => {
  const { language, isRtl } = useLanguage();
  const { adminUser, isSuperAdmin, hasPermission, isLoading: authLoading, isAuthenticated } = useAuth();

  const canOverrideWarnings = isSuperAdmin || hasPermission('validation.overrideWarnings');
  const canEditPending = isSuperAdmin || hasPermission('historical.import.approve_matching') || hasPermission('excel.import');
  const canManageImport = isSuperAdmin || hasPermission('historical.import.execute') || hasPermission('excel.import');
  const canDeletePermanently = isSuperAdmin || hasPermission('historical.import.undo') || hasPermission('excel.import');
  /** §8/§46: Import permission alone lets a user select existing/edit/skip/exclude - creating new Master Data (Mill/Material/Mixture/Bunker) requires the SAME Master Data Add permission the rest of the app already gates on. */
  const canAddMasterData = isSuperAdmin || hasPermission('masterData.inlineAdd') || hasPermission('excel.import');

  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [summary, setSummary] = useState<TubeBallMillsImportSummary | null>(null);
  const [activeFilterTab, setActiveFilterTab] = useState<FilterTab>('ALL');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [mills, setMills] = useState<ComboboxOption[]>([]);
  const [materials, setMaterials] = useState<ComboboxOption[]>([]);
  const [bunkers, setBunkers] = useState<ComboboxOption[]>([]);
  const [mixtures, setMixtures] = useState<Array<{ id: string; code: string; name: string; components: Array<{ materialId: string; percentage: number }> }>>([]);
  const [approvedMappings, setApprovedMappings] = useState<Record<string, Record<string, string>>>({});
  const [masterDataErrors, setMasterDataErrors] = useState<MasterDataLoadError[]>([]);
  const [isLoadingMasterData, setIsLoadingMasterData] = useState(false);

  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [backupId, setBackupId] = useState<string | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [importResult, setImportResult] = useState<{ total: number; imported: number; failed: number; skipped: number; pending: number; excluded: number; cancelled: number; importId: string } | null>(null);
  const cancelImportRef = useRef(false);
  const isConfirmingImportRef = useRef(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [showCancelEntireConfirm, setShowCancelEntireConfirm] = useState(false);

  const [editRowState, setEditRowState] = useState<{ rowIndex: number } | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string> | null>(null);
  const [mixtureCreateDraft, setMixtureCreateDraft] = useState<{ name: string; components: Array<{ materialNameRaw: string; quantityKg: number; percentage: number; resolvedMaterialId?: string }> } | null>(null);

  /** Gap-fix §7: session-local "Global Mapping" - a value the user explicitly resolves (accept suggestion / Code New / bunker pick) is remembered for every OTHER row sharing that same raw value for the rest of this session, without a second mapping system (reuses tubeBallMillsResolutionPure.ts's own ManualOverrideMap, already used by the pure resolution engine but never wired into this panel until now). */
  const [manualOverrides, setManualOverrides] = useState<ManualOverrideMap>({});
  /** Gap-fix §1/§2: inline "Code New Mill/Material/Bunker" mini-form target. */
  const [codeNewTarget, setCodeNewTarget] = useState<
    | { mode: 'ROW'; rowIndex: number; domain: 'mill' | 'material' | 'bunker'; bunkerIndex?: number }
    | { mode: 'GLOBAL'; domain: 'mill' | 'material' | 'bunker'; rawValue: string }
    | null
  >(null);
  const [codeNewForm, setCodeNewForm] = useState<{ code: string; name: string }>({ code: '', name: '' });

  /** §3/§20: the dedicated Master Data Review Window - opens automatically right after a successful Excel parse (before any row is imported), scanning the WHOLE uploaded dataset for distinct Mill/Material/Mixture/Bunker values needing coding. Firebase-free/no writes - purely aggregates state already computed by parseAndValidateTubeBallMillsExcel. */
  const [showMasterDataReview, setShowMasterDataReview] = useState(false);
  const [masterDataReviewTab, setMasterDataReviewTab] = useState<MasterDataEntityGroupTab>('mill');
  const [expandedMixtureGroups, setExpandedMixtureGroups] = useState<Set<string>>(new Set());

  const [reviewWindow, setReviewWindow] = useState<{ mode: 'VALID' | 'READY' | 'CORRECTED' | 'INVALID' | 'ALL'; source: 'LIVE' | 'DRAFT' } | null>(null);
  const [approveAllConfirm, setApproveAllConfirm] = useState<{ scopeRowIndexes: Set<number>; count: number } | null>(null);
  const [markAllReadyConfirm, setMarkAllReadyConfirm] = useState<{ scopeRowIndexes: Set<number>; count: number } | null>(null);
  const [showExcludedPanel, setShowExcludedPanel] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ rowIndexes: number[] } | null>(null);

  const [savedDraft, setSavedDraft] = useState<TubeBallMillsDraft | null>(null);

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [importHistory, setImportHistory] = useState<ImportAuditEntry[]>([]);
  const [historyErrors, setHistoryErrors] = useState<{ auditTrailError?: string; auditLogError?: string }>({});
  const [historyDetail, setHistoryDetail] = useState<ImportAuditEntry | null>(null);
  const [historyDetailRows, setHistoryDetailRows] = useState<any[] | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<ImportAuditEntry | null>(null);
  const [rollbackMessage, setRollbackMessage] = useState<string | null>(null);

  const loadMasterData = async () => {
    if (authLoading || !isAuthenticated) return;
    setIsLoadingMasterData(true);
    const [millsRes, materialsRes, bunkersRes, productsRes, mappings] = await Promise.all([
      fetchMasterDataSafe<any>(TUBE_BALL_MILL_MASTER_COLLECTION, 'mill'),
      fetchMasterDataSafe<any>('materials', 'material'),
      fetchMasterDataSafe<any>(BUNKER_COLLECTION, 'bunker'),
      fetchMasterDataSafe<any>('products', 'material'),
      loadApprovedMappings().catch(() => ({})),
    ]);
    setMills(millsRes.data.map((m: any) => ({ id: m.id, code: m.code || '', name: m.name || '' })));
    setMaterials(materialsRes.data.map((m: any) => ({ id: m.id, code: m.code || '', name: m.name || '' })));
    setBunkers(bunkersRes.data.map((b: any) => ({ id: b.id, code: b.code || b.bunkerNumber || '', name: b.name || b.bunkerNumber || '' })));
    setMixtures(
      (productsRes.data || [])
        .filter((p: any) => p.isMixtureBOM && p.mixtureComponents?.length > 0)
        .map((p: any) => ({ id: p.id, code: p.code || '', name: p.name, components: p.mixtureComponents.map((c: any) => ({ materialId: c.materialId, percentage: c.percentage })) }))
    );
    setApprovedMappings(mappings);
    setMasterDataErrors([millsRes.error, materialsRes.error, bunkersRes.error].filter((e): e is MasterDataLoadError => !!e));
    setIsLoadingMasterData(false);
  };

  useEffect(() => { loadMasterData(); }, [authLoading, isAuthenticated]);

  useEffect(() => {
    if (!adminUser?.email) return;
    setSavedDraft(getDraft(adminUser.email));
  }, [adminUser?.email]);

  const updateRows = (updater: (rows: TubeBallMillsImportRow[]) => TubeBallMillsImportRow[]) => {
    setSummary((prev) => {
      if (!prev) return prev;
      const rows = updater(prev.rows);
      const counts = computeSelectionCounts(rows);
      return {
        ...prev,
        rows,
        validRows: rows.filter((r) => r.errors.length === 0 && r.warnings.length === 0).length,
        warningRows: rows.filter((r) => r.errors.length === 0 && r.warnings.length > 0).length,
        errorRows: rows.filter((r) => r.errors.length > 0).length,
        duplicateRows: rows.filter((r) => r.isDuplicate).length,
        unknownMillsCount: rows.filter((r) => r.status === 'UNKNOWN_MILL').length,
        unknownMaterialsCount: rows.filter((r) => r.status === 'UNKNOWN_MATERIAL').length,
        unresolvedMixtureCount: rows.filter((r) => r.status === 'UNRESOLVED_MIXTURE_COMPONENT').length,
        unknownBunkersCount: rows.filter((r) => r.status === 'UNKNOWN_BUNKER').length,
        invalidBunkerAllocationCount: rows.filter((r) => r.status === 'INVALID_BUNKER_ALLOCATION').length,
      };
    });
  };
  const updateOneRow = (rowIndex: number, patch: Partial<TubeBallMillsImportRow>) => {
    updateRows((rows) => rows.map((r) => (r.rowIndex === rowIndex ? { ...r, ...patch } : r)));
  };
  const getSelection = (row: TubeBallMillsImportRow): 'INCLUDED' | 'EXCLUDED' | 'PENDING' => row.rowSelection ?? 'INCLUDED';

  const masterDataBundle = useMemo(
    () => ({
      mills: mills.map((m) => ({ id: m.id, code: m.code, name: m.name })),
      materials: materials.map((m) => ({ id: m.id, code: m.code, name: m.name })),
      bunkers: bunkers.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      mixtures: mixtures.map((m) => ({ productId: m.id, productName: m.name, components: m.components })),
    }),
    [mills, materials, bunkers, mixtures]
  );

  const revalidateAll = (rows: TubeBallMillsImportRow[]): TubeBallMillsImportRow[] =>
    rows.map((row) => {
      const fields = extractFieldsFromRow(row);
      const resolved = revalidateTubeBallMillsRowFields(fields, masterDataBundle, approvedMappings, language, manualOverrides, {}, row.bunkerAllocations);
      return { ...row, ...resolved, isDuplicate: row.isDuplicate, duplicateType: row.duplicateType };
    });

  // ---- Upload ----
  const handleFileDrop = async (e: React.DragEvent | React.ChangeEvent<HTMLInputElement>) => {
    let uploaded: File | null = null;
    if ('dataTransfer' in e) {
      e.preventDefault();
      uploaded = e.dataTransfer.files?.[0] || null;
    } else {
      uploaded = e.target.files?.[0] || null;
    }
    if (!uploaded) return;
    setFile(uploaded);
    setIsParsing(true);
    setFeedback(null);
    try {
      const buffer = await uploaded.arrayBuffer();
      const parsed = await parseAndValidateTubeBallMillsExcel(buffer, language);
      setSummary(parsed);
      // §2/§3: after the full-file scan, open the Master Data Review Window
      // BEFORE any row is imported - the user reviews/resolves Mills,
      // Materials, Mixtures, and Bunkers first; nothing is written to
      // Firestore by parsing or by opening this window.
      setShowMasterDataReview(true);
      setMasterDataReviewTab('mill');
      if (canManageImport) {
        setIsCreatingBackup(true);
        try {
          const backup = await createDatabaseBackup('PRE_IMPORT' as any, `نسخة أمان وقائية قبل استيراد الطواحين الأنبوبية والكرات`, ['stage_tube_ball_mills'] as any);
          setBackupId((backup as any)?.id || (backup as any)?.backupId || null);
        } catch {
          /* backup is best-effort - never blocks the import screen */
        } finally {
          setIsCreatingBackup(false);
        }
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: language === 'ar' ? `تعذر قراءة الملف: ${err.message}` : `Could not read file: ${err.message}` });
    } finally {
      setIsParsing(false);
    }
  };

  // ---- Row selection ----
  const handleExcludeRow = (rowIndex: number, reason: TubeBallMillsImportRow['exclusionReason'] = 'USER_DESELECTED') => {
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const action = reason === 'SKIPPED_ROW' ? 'ROW_SKIPPED' : 'ROW_EXCLUDED';
        return {
          ...r,
          rowSelection: 'EXCLUDED',
          exclusionReason: reason,
          excludedBy: adminUser?.email || 'admin',
          excludedAt: new Date().toISOString(),
          resolutionHistory: [...(r.resolutionHistory || []), { timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action, summary: reason === 'SKIPPED_ROW' ? t('تخطي السجل', 'Row skipped', language) : t('استبعاد السجل', 'Row excluded', language) }],
        };
      })
    );
  };

  const handleReincludeRow = (rowIndex: number) => {
    updateRows((rows) => {
      const target = rows.find((r) => r.rowIndex === rowIndex);
      if (!target) return rows;
      const fromState = getSelection(target);
      const revalidated = revalidateAll([{ ...target, rowSelection: 'INCLUDED', exclusionReason: undefined }])[0];
      return rows.map((r) =>
        r.rowIndex === rowIndex
          ? { ...revalidated, resolutionHistory: [...(target.resolutionHistory || []), { timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'RE_INCLUDE', summary: t(`إعادة إدراج: ${fromState} → مُدرج`, `Re-include: ${fromState} → Included`, language) }] }
          : r
      );
    });
  };

  const handleAcceptWarnings = (rowIndex: number) => {
    updateOneRow(rowIndex, { warningsAccepted: true, warningOverrideBy: adminUser?.email || 'admin', warningOverrideAt: new Date().toISOString() });
  };

  const handleBulkSelection = (mode: BulkSelectionMode) => {
    updateRows((rows) => rows.map((r) => ({ ...r, ...computeBulkSelectionOutcome(r, mode) })));
  };

  const handleScopedBulkSelection = (mode: 'ALL' | 'NONE', scopeRowIndexes: Set<number>) => {
    updateRows((rows) => rows.map((r) => (scopeRowIndexes.has(r.rowIndex) ? { ...r, ...computeBulkSelectionOutcome(r, mode) } : r)));
  };

  // ---- Approval ----
  const handleApproveRow = (rowIndex: number, method: 'INDIVIDUAL' | 'BULK') => {
    const actor = adminUser?.email || 'admin';
    const now = new Date().toISOString();
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        if (r.errors.length === 0 || isNonOverridableBlockingCondition(r)) return r;
        return { ...r, approved: true, approvedBy: actor, approvedAt: now, approvalMethod: method, resolutionHistory: [...(r.resolutionHistory || []), { timestamp: now, actor, action: 'ROW_APPROVED', summary: t(`اعتماد السجل (${method === 'BULK' ? 'جماعي' : 'فردي'})`, `Row approved (${method === 'BULK' ? 'bulk' : 'individual'})`, language) }] };
      })
    );
    if (method === 'INDIVIDUAL') {
      logAuditAction('UPDATE', 'stage_tube_ball_mills', undefined, `[ROW_APPROVED] استيراد الطواحين الأنبوبية والكرات - صف #${rowIndex} - المستخدم: ${actor}`).catch(() => {});
    }
  };

  const handleRevokeApproval = (rowIndex: number) => {
    const actor = adminUser?.email || 'admin';
    updateRows((rows) =>
      rows.map((r) => (r.rowIndex === rowIndex && r.approved ? { ...r, approved: false, approvedBy: undefined, approvedAt: undefined, approvalMethod: undefined, resolutionHistory: [...(r.resolutionHistory || []), { timestamp: new Date().toISOString(), actor, action: 'ROW_APPROVAL_REVOKED', summary: t('إلغاء الاعتماد', 'Approval revoked', language) }] } : r))
    );
    logAuditAction('UPDATE', 'stage_tube_ball_mills', undefined, `[ROW_APPROVAL_REVOKED] استيراد الطواحين الأنبوبية والكرات - صف #${rowIndex} - المستخدم: ${actor}`).catch(() => {});
  };

  const handleApproveAllInWindow = (scopeRowIndexes: Set<number>) => {
    const actor = adminUser?.email || 'admin';
    const now = new Date().toISOString();
    const approvedCount = (summary?.rows || []).filter((r) => scopeRowIndexes.has(r.rowIndex) && r.errors.length > 0 && !isNonOverridableBlockingCondition(r)).length;
    updateRows((rows) =>
      rows.map((r) => {
        if (!scopeRowIndexes.has(r.rowIndex) || r.errors.length === 0 || isNonOverridableBlockingCondition(r)) return r;
        return { ...r, approved: true, approvedBy: actor, approvedAt: now, approvalMethod: 'BULK' as const, resolutionHistory: [...(r.resolutionHistory || []), { timestamp: now, actor, action: 'ROW_APPROVED', summary: t('اعتماد جماعي', 'Bulk approval', language) }] };
      })
    );
    setApproveAllConfirm(null);
    logAuditAction('BULK_IMPORT', 'stage_tube_ball_mills', undefined, `[BULK_APPROVAL] استيراد الطواحين الأنبوبية والكرات - اعتماد جماعي - عدد السجلات: ${approvedCount} - المستخدم: ${actor}`).catch(() => {});
  };

  // ---- Ready to Import ----
  const handleMarkRowReady = (rowIndex: number) => {
    const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
    if (!row) return;
    if (!canMarkReadyToImport(row)) {
      setFeedback({ type: 'error', message: t('لا يمكن تحويل السجل إلى جاهز للرفع بسبب خطأ أساسي غير قابل للتجاوز.', 'This record cannot be marked Ready to Import because it has a non-overridable validation error.', language) });
      return;
    }
    const actor = adminUser?.email || 'admin';
    const now = new Date().toISOString();
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const patch = computeMarkReadyPatch(r);
        if (patch.warningsAccepted && !canOverrideWarnings) delete patch.warningsAccepted;
        return {
          ...r,
          ...patch,
          readyToImport: true,
          readyToImportBy: actor,
          readyToImportAt: now,
          readyToImportMethod: 'INDIVIDUAL' as const,
          preReadyToImportState: { rowSelection: r.rowSelection, exclusionReason: r.exclusionReason, approved: r.approved, approvedBy: r.approvedBy, approvedAt: r.approvedAt, approvalMethod: r.approvalMethod, warningsAccepted: r.warningsAccepted },
          resolutionHistory: [...(r.resolutionHistory || []), { timestamp: now, actor, action: 'ROW_READY_TO_IMPORT', summary: t('تحويل إلى جاهز للرفع (فردي)', 'Marked Ready to Import (individual)', language) }],
        };
      })
    );
    logAuditAction('UPDATE', 'stage_tube_ball_mills', undefined, `[ROW_READY_TO_IMPORT] استيراد الطواحين الأنبوبية والكرات - صف #${rowIndex} - طريقة: فردي - المستخدم: ${actor}`).catch(() => {});
  };

  const handleUndoReady = (rowIndex: number) => {
    const actor = adminUser?.email || 'admin';
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex || !r.readyToImport) return r;
        const prior = r.preReadyToImportState || {};
        return {
          ...r,
          rowSelection: prior.rowSelection,
          exclusionReason: prior.exclusionReason,
          approved: prior.approved,
          approvedBy: prior.approvedBy,
          approvedAt: prior.approvedAt,
          approvalMethod: prior.approvalMethod,
          warningsAccepted: prior.warningsAccepted,
          readyToImport: false,
          readyToImportBy: undefined,
          readyToImportAt: undefined,
          readyToImportMethod: undefined,
          preReadyToImportState: undefined,
          resolutionHistory: [...(r.resolutionHistory || []), { timestamp: new Date().toISOString(), actor, action: 'ROW_READY_TO_IMPORT_REVOKED', summary: t('إلغاء الجاهزية', 'Ready-to-Import removed', language) }],
        };
      })
    );
    logAuditAction('UPDATE', 'stage_tube_ball_mills', undefined, `[ROW_READY_TO_IMPORT_REVOKED] استيراد الطواحين الأنبوبية والكرات - صف #${rowIndex} - المستخدم: ${actor}`).catch(() => {});
  };

  const applyBulkMarkReady = (scopeRowIndexes: Set<number>, method: 'BULK_SELECTED' | 'BULK_ALL') => {
    const actor = adminUser?.email || 'admin';
    const now = new Date().toISOString();
    const inScope = (summary?.rows || []).filter((r) => scopeRowIndexes.has(r.rowIndex) && (method === 'BULK_ALL' || getSelection(r) === 'INCLUDED'));
    const eligibleIndexes = new Set(inScope.filter(canMarkReadyToImport).map((r) => r.rowIndex));
    const blockedCount = inScope.length - eligibleIndexes.size;
    updateRows((rows) =>
      rows.map((r) => {
        if (!eligibleIndexes.has(r.rowIndex)) return r;
        const patch = computeMarkReadyPatch(r);
        if (patch.warningsAccepted && !canOverrideWarnings) delete patch.warningsAccepted;
        return {
          ...r,
          ...patch,
          readyToImport: true,
          readyToImportBy: actor,
          readyToImportAt: now,
          readyToImportMethod: method,
          preReadyToImportState: { rowSelection: r.rowSelection, exclusionReason: r.exclusionReason, approved: r.approved, approvedBy: r.approvedBy, approvedAt: r.approvedAt, approvalMethod: r.approvalMethod, warningsAccepted: r.warningsAccepted },
          resolutionHistory: [...(r.resolutionHistory || []), { timestamp: now, actor, action: 'ROW_READY_TO_IMPORT', summary: t(`تحويل جماعي (${method === 'BULK_ALL' ? 'الكل' : 'المحدد'}) إلى جاهز للرفع`, `Bulk (${method === 'BULK_ALL' ? 'All' : 'Selected'}) marked Ready`, language) }],
        };
      })
    );
    setFeedback({
      type: blockedCount > 0 ? 'error' : 'success',
      message: blockedCount === 0
        ? t(`تم تحويل ${eligibleIndexes.size} سجل إلى جاهز للرفع.`, `${eligibleIndexes.size} record(s) marked Ready to Import.`, language)
        : t(`تم تحويل ${eligibleIndexes.size} سجل. تعذر تحويل ${blockedCount} سجل بسبب خطأ غير قابل للتجاوز.`, `${eligibleIndexes.size} record(s) marked Ready. ${blockedCount} record(s) could not be converted due to a non-overridable error.`, language),
    });
    logAuditAction('BULK_IMPORT', 'stage_tube_ball_mills', undefined, `[BULK_READY_TO_IMPORT] استيراد الطواحين الأنبوبية والكرات - نطاق: ${method} - المحول: ${eligibleIndexes.size} - تعذر: ${blockedCount} - المستخدم: ${actor}`).catch(() => {});
  };

  // ---- Manual field resolution (used by the Edit Row modal + row detail) ----
  /** Builds the two override keys (name-normalized and code-normalized) resolveMasterDataField will check for this raw value, so a session-wide manual resolution is found regardless of how the value was originally typed. */
  const overrideKeysFor = (domain: 'mill' | 'material' | 'bunker', rawValue: string): string[] => [
    overrideKey(domain, normalizeArabicForComparison(rawValue)),
    overrideKey(domain, normalizeCodeForComparison(rawValue)),
  ];

  /**
   * The single shared propagation mechanism behind every "Apply to All"
   * action (§4/§7/§12 of the Master-Data-Extraction task) across all three
   * domains - Mill, Material, and Bunker. Registers the resolution as a
   * session-wide manual override (the SAME ManualOverrideMap the Global
   * Mapping mechanism already uses), then re-runs the authoritative
   * revalidateTubeBallMillsRowFields on EVERY row. Because a mixture
   * component's own material is resolved via the identical
   * resolveMasterDataField('material', ..., manualOverrides) call inside
   * that same revalidation (see the service's MIXTURE branch), a Material
   * "Apply to All" correctly resolves BOTH plain-material rows AND every
   * BOM component sharing that raw name in one pass - no separate
   * component-patching logic needed (§11).
   */
  const applyGlobalResolution = (domain: 'mill' | 'material' | 'bunker', rawValue: string, entity: { id: string; code: string; name: string }, resolutionMethod: 'SUGGESTION_ACCEPTED' | 'MANUAL_SELECTION' | 'NEW_MASTER_DATA' = 'MANUAL_SELECTION') => {
    const nextOverrides: ManualOverrideMap = { ...manualOverrides };
    overrideKeysFor(domain, rawValue).forEach((k) => { nextOverrides[k] = entity; });
    setManualOverrides(nextOverrides);
    updateRows((rows) =>
      rows.map((r) => {
        const fields = extractFieldsFromRow(r);
        const resolved = revalidateTubeBallMillsRowFields(fields, masterDataBundle, approvedMappings, language, nextOverrides, {}, r.bunkerAllocations);
        return { ...r, ...resolved, isDuplicate: r.isDuplicate, duplicateType: r.duplicateType };
      })
    );
    // §19: audit every Master Data resolution decision - EntityType/OriginalValue/SelectedMasterDataId/SelectedCode/ResolutionMethod/User/Timestamp (User+Timestamp captured internally by logAuditAction) - reuses the existing bracketed-tag auditLogs convention, never a second audit architecture.
    logAuditAction('UPDATE', 'stage_tube_ball_mills', entity.id, `[MASTER_DATA_RESOLVED] النوع: ${domain} - القيمة الأصلية: ${rawValue} - المحدد: ${entity.name} (${entity.code}) - الطريقة: ${resolutionMethod}`).catch(() => {});
  };
  /** Mill/Material: resolves ONE row's field to an explicit entity (existing-dropdown pick, accepted suggestion, or a just-coded new record) and immediately re-runs the SAME authoritative revalidation the rest of the pipeline uses, so the matching error/status clear correctly instead of only patching the id/code/name fields. Scoped to this row only, via a one-off override never saved to session state - see applyGlobalResolution above for the "Apply to All" variant used by the Master Data Review Window. */
  const resolveFieldForRow = (rowIndex: number, domain: 'mill' | 'material', entity: { id: string; code: string; name: string }) => {
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const rawValue = domain === 'mill' ? r.millTypeRaw : r.materialTypeRaw;
        const oneOffOverrides: ManualOverrideMap = {};
        overrideKeysFor(domain, rawValue).forEach((k) => { oneOffOverrides[k] = entity; });
        const fields = extractFieldsFromRow(r);
        const resolved = revalidateTubeBallMillsRowFields(fields, masterDataBundle, approvedMappings, language, { ...manualOverrides, ...oneOffOverrides }, {}, r.bunkerAllocations);
        return { ...r, ...resolved, isDuplicate: r.isDuplicate, duplicateType: r.duplicateType };
      })
    );
  };
  const applyMillSelection = (rowIndex: number, option: ComboboxOption | undefined) => {
    if (!option) return;
    resolveFieldForRow(rowIndex, 'mill', { id: option.id, code: option.code, name: option.name });
  };
  const applyMaterialSelection = (rowIndex: number, option: ComboboxOption | undefined) => {
    if (!option) return;
    resolveFieldForRow(rowIndex, 'material', { id: option.id, code: option.code, name: option.name });
  };
  /** Gap-fix §3: accept the fuzzy suggestion already computed by revalidation - never auto-applied, only on this explicit call. */
  const useMillSuggestion = (rowIndex: number, row: TubeBallMillsImportRow) => {
    if (!row.suggestedMillId) return;
    resolveFieldForRow(rowIndex, 'mill', { id: row.suggestedMillId, code: row.suggestedMillCode || '', name: row.suggestedMillName || '' });
  };
  const useMaterialSuggestion = (rowIndex: number, row: TubeBallMillsImportRow) => {
    if (!row.suggestedMaterialId) return;
    resolveFieldForRow(rowIndex, 'material', { id: row.suggestedMaterialId, code: row.suggestedMaterialCode || '', name: row.suggestedMaterialName || '' });
  };
  const applyMixtureComponentSelection = (rowIndex: number, componentIndex: number, option: ComboboxOption | undefined) => {
    if (!option) return;
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex || !r.mixtureComponents) return r;
        const components = r.mixtureComponents.map((c, i) => (i === componentIndex ? { ...c, resolvedMaterialId: option.id, resolvedMaterialCode: option.code, resolvedMaterialName: option.name } : c));
        return { ...r, mixtureComponents: components };
      })
    );
  };
  /** Gap-fix §7: bunker resolution DOES propagate - the same raw bunker value ("54") resolves the same way for every row in this session that has it, via applyGlobalResolution, while a row can still be individually overridden/excluded afterward through the same per-row controls. */
  const resolveBunkerForRow = (rowIndex: number, bunkerIndex: number, entity: { id: string; code: string; name: string }) => {
    const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
    const bunkerRaw = row?.bunkerAllocations[bunkerIndex]?.bunkerRaw;
    if (!bunkerRaw) return;
    applyGlobalResolution('bunker', bunkerRaw, entity);
  };
  const applyBunkerSelection = (rowIndex: number, bunkerIndex: number, option: ComboboxOption | undefined) => {
    if (!option) return;
    resolveBunkerForRow(rowIndex, bunkerIndex, { id: option.id, code: option.code, name: option.name });
  };
  /** Gap-fix §5/§6: edits the ONE bunker's allocated tonnage, then re-derives bunkerAllocationValid/errors/status via the authoritative revalidation path (previousBunkerAllocations = the just-edited set, so resolveBunkerAllocationQuantities preserves this exact edit rather than resetting it back to an equal split). */
  const applyBunkerAllocationEdit = (rowIndex: number, bunkerIndex: number, newTons: number) => {
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const allocations = r.bunkerAllocations.map((b, i) => (i === bunkerIndex ? { ...b, allocatedTons: newTons } : b));
        const fields = extractFieldsFromRow(r);
        const resolved = revalidateTubeBallMillsRowFields(fields, masterDataBundle, approvedMappings, language, manualOverrides, {}, allocations);
        return { ...r, ...resolved, isDuplicate: r.isDuplicate, duplicateType: r.duplicateType };
      })
    );
  };

  /**
   * §9/§13/§14: accept the suggested existing mixture rather than creating
   * a duplicate. Propagates to EVERY row sharing the exact same raw mixture
   * string (§12 "Global Mapping" applied to mixtures) - not just the one
   * row this action was triggered from, mirroring applyGlobalResolution's
   * domain-wide propagation for Mill/Material/Bunker.
   */
  const acceptSuggestedMixture = (rowIndex: number) => {
    const source = summary?.rows.find((r) => r.rowIndex === rowIndex);
    if (!source || !source.suggestedMixtureProductId) return;
    const { suggestedMixtureProductId, suggestedMixtureProductName, materialTypeRaw } = source;
    updateRows((rows) =>
      rows.map((r) => {
        if (r.materialTypeRaw !== materialTypeRaw || !r.isMixture || r.resolvedMixtureProductId) return r;
        const remainingErrors = r.errors.filter((e) => !e.includes('لا توجد خلطة') && !e.toLowerCase().includes('no matching mixture'));
        return {
          ...r,
          resolvedMixtureProductId: suggestedMixtureProductId,
          resolvedMixtureProductName: suggestedMixtureProductName,
          errors: remainingErrors,
          status: remainingErrors.length > 0 ? r.status : 'VALID',
        };
      })
    );
    logAuditAction('UPDATE', 'stage_tube_ball_mills', suggestedMixtureProductId, `[MASTER_DATA_RESOLVED] النوع: mixture - القيمة الأصلية: ${materialTypeRaw} - المحدد: ${suggestedMixtureProductName} - الطريقة: SUGGESTION_ACCEPTED`).catch(() => {});
  };

  /** §13: "Choose Existing BOM" - an explicit user pick of any existing mixture/BOM Product for this raw mixture string, distinct from acceptSuggestedMixture's auto-computed findEquivalentMixture suggestion. Propagates to every row sharing the exact same raw mixture string, same as the other mixture-level actions. */
  const chooseExistingMixtureGlobal = (originalMixtureValue: string, option: ComboboxOption | undefined) => {
    if (!option) return;
    updateRows((rows) =>
      rows.map((r) => {
        if (r.materialTypeRaw !== originalMixtureValue || !r.isMixture) return r;
        const remainingErrors = r.errors.filter((e) => !e.includes('لا توجد خلطة') && !e.toLowerCase().includes('no matching mixture'));
        return { ...r, resolvedMixtureProductId: option.id, resolvedMixtureProductCode: option.code, resolvedMixtureProductName: option.name, errors: remainingErrors, status: remainingErrors.length > 0 ? r.status : 'VALID' };
      })
    );
    logAuditAction('UPDATE', 'stage_tube_ball_mills', option.id, `[MASTER_DATA_RESOLVED] النوع: mixture - القيمة الأصلية: ${originalMixtureValue} - المحدد: ${option.name} - الطريقة: MANUAL_SELECTION`).catch(() => {});
  };

  /**
   * §9/§12/§14/§46: creates a new mixture/BOM Product from this row's
   * resolved components - gated on Master Data Add permission, never
   * automatic - then propagates the newly-created mixture to every OTHER
   * row sharing the exact same raw mixture string, so a mixture appearing
   * in hundreds of historical rows is coded once, not once per row.
   */
  const createMixtureFromRow = async (rowIndex: number) => {
    const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
    if (!row || !row.mixtureComponents) return;
    if (!canAddMasterData) {
      setFeedback({ type: 'error', message: t('لا تملك صلاحية إضافة بيانات أساسية جديدة.', 'You do not have permission to add new Master Data.', language) });
      return;
    }
    const unresolved = row.mixtureComponents.filter((c) => !c.resolvedMaterialId);
    if (unresolved.length > 0) {
      setFeedback({ type: 'error', message: t('يجب حل جميع مكونات الخلطة أولاً.', 'All mixture components must be resolved first.', language) });
      return;
    }
    try {
      const id = await createMixtureBOMProduct(
        row.materialTypeRaw,
        row.mixtureComponents.map((c) => ({ materialId: c.resolvedMaterialId!, materialCode: c.resolvedMaterialCode, materialName: c.resolvedMaterialName || c.materialNameRaw, quantityKg: c.quantityKg, percentage: c.percentage }))
      );
      logAuditAction('CREATE', 'products', id, `[MASTER_DATA_CREATED] إنشاء خلطة/BOM جديدة (خلطات BOM): ${row.materialTypeRaw} - المستخدم: ${adminUser?.email || 'admin'}`).catch(() => {});
      const materialTypeRaw = row.materialTypeRaw;
      updateRows((rows) =>
        rows.map((r) => {
          if (r.materialTypeRaw !== materialTypeRaw || !r.isMixture || r.resolvedMixtureProductId) return r;
          const remainingErrors = r.errors.filter((e) => !e.includes('لا توجد خلطة') && !e.toLowerCase().includes('no matching mixture'));
          return { ...r, resolvedMixtureProductId: id, resolvedMixtureProductName: materialTypeRaw, errors: remainingErrors, status: remainingErrors.length > 0 ? r.status : 'VALID' };
        })
      );
      await loadMasterData();
      setFeedback({ type: 'success', message: t('تم إنشاء الخلطة بنجاح.', 'Mixture created successfully.', language) });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || t('تعذر إنشاء الخلطة.', 'Could not create mixture.', language) });
    }
  };

  /** §7-8/§16/§20: "Code New" for Mill/Material/Bunker - gated on Master Data Add permission, duplicate-checked, audited. */
  const codeNewMasterDataItem = async (domain: 'mill' | 'material' | 'bunker', code: string, name: string): Promise<{ id: string; code: string; name: string } | null> => {
    if (!canAddMasterData) {
      setFeedback({ type: 'error', message: t('لا تملك صلاحية إضافة بيانات أساسية جديدة.', 'You do not have permission to add new Master Data.', language) });
      return null;
    }
    const collectionName = domain === 'mill' ? TUBE_BALL_MILL_MASTER_COLLECTION : domain === 'material' ? 'materials' : BUNKER_COLLECTION;
    const trimmedCode = code.trim();
    if (trimmedCode) {
      const dup = await checkCodeDuplicate(collectionName, trimmedCode);
      if (dup) {
        setFeedback({ type: 'error', message: t('الكود موجود بالفعل.', 'This code already exists.', language) });
        return null;
      }
    }
    const payload: Record<string, any> = domain === 'bunker'
      ? { bunkerNumber: name, code: trimmedCode, name, active: true }
      : { code: trimmedCode, name, active: true };
    const id = await createMasterDataItem(collectionName, payload);
    if (!id) return null;
    logAuditAction('CREATE', collectionName, id, `[MASTER_DATA_CREATED] ${domain} - ${name} - المستخدم: ${adminUser?.email || 'admin'}`).catch(() => {});
    await loadMasterData();
    return { id, code: trimmedCode, name };
  };

  /** Gap-fix §1/§2/§7, extended by the Master-Data-Extraction task's "Apply to All"/"Create New" for a whole aggregated group: submits the inline "Code New Mill/Material/Bunker" mini-form - creates the record via the existing permission-gated/duplicate-checked/audited codeNewMasterDataItem, then resolves either just the ONE row (mode ROW) or every row sharing that raw value this session (mode GLOBAL, via applyGlobalResolution) - never leaves it dangling after creation. */
  const submitCodeNew = async () => {
    if (!codeNewTarget) return;
    const name = codeNewForm.name.trim();
    if (!name) {
      setFeedback({ type: 'error', message: t('يجب إدخال الاسم.', 'Name is required.', language) });
      return;
    }
    const created = await codeNewMasterDataItem(codeNewTarget.domain, codeNewForm.code, name);
    if (!created) return;
    if (codeNewTarget.mode === 'GLOBAL') {
      applyGlobalResolution(codeNewTarget.domain, codeNewTarget.rawValue, created, 'NEW_MASTER_DATA');
    } else if (codeNewTarget.domain === 'bunker' && codeNewTarget.bunkerIndex !== undefined) {
      resolveBunkerForRow(codeNewTarget.rowIndex, codeNewTarget.bunkerIndex, created);
    } else if (codeNewTarget.domain === 'mill' || codeNewTarget.domain === 'material') {
      resolveFieldForRow(codeNewTarget.rowIndex, codeNewTarget.domain, created);
    }
    setCodeNewTarget(null);
    setCodeNewForm({ code: '', name: '' });
    setFeedback({ type: 'success', message: t('تم الترميز وربط السجل.', 'Coded and linked to the record.', language) });
  };

  // ---- Row edit ----
  const openEditRow = (rowIndex: number) => {
    const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
    if (!row) return;
    setEditDraft({
      date: row.date,
      millTypeRaw: row.millTypeRaw,
      materialTypeRaw: row.materialTypeRaw,
      hoursRaw: String(row.operatingHours ?? ''),
      tonsPerHourRaw: String(row.tonsPerHour ?? ''),
      storageBunkersRaw: row.storageBunkersRaw,
      totalRaw: String(row.totalTons ?? ''),
    });
    setEditRowState({ rowIndex });
  };

  const saveEditRow = () => {
    if (!editRowState || !editDraft || !summary) return;
    const row = summary.rows.find((r) => r.rowIndex === editRowState.rowIndex);
    if (!row) return;
    const resolved = revalidateTubeBallMillsRowFields(editDraft as any, masterDataBundle, approvedMappings, language, manualOverrides, {}, row.bunkerAllocations);
    const changedFields = Object.keys(editDraft).filter((k) => (extractFieldsFromRow(row) as any)[k] !== (editDraft as any)[k]);

    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== editRowState.rowIndex) return r;
        const history = [...(r.resolutionHistory || []), { timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'FULL_ROW_EDIT', summary: t(`تعديل كامل للصف - حقول معدلة: ${changedFields.join(', ') || 'لا شيء'}`, `Full row edit - changed fields: ${changedFields.join(', ') || 'none'}`, language) }];
        if (r.approved) history.push({ timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'ROW_APPROVAL_REVOKED', summary: t('إلغاء الاعتماد تلقائيًا - تم تعديل السجل.', 'Approval automatically revoked - row was edited.', language) });
        if (r.readyToImport) history.push({ timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'ROW_READY_TO_IMPORT_REVOKED', summary: t('إلغاء الجاهزية تلقائيًا - تم تعديل السجل.', 'Ready-to-Import automatically removed - row was edited.', language) });
        return {
          ...r,
          ...resolved,
          isDuplicate: r.isDuplicate,
          duplicateType: r.duplicateType,
          editedRowData: { ...editDraft },
          approved: false, approvedBy: undefined, approvedAt: undefined, approvalMethod: undefined,
          readyToImport: false, readyToImportBy: undefined, readyToImportAt: undefined, readyToImportMethod: undefined, preReadyToImportState: undefined,
          resolutionHistory: history,
        };
      })
    );
    setEditRowState(null);
    setEditDraft(null);
  };

  // ---- Cancel Entire Import ----
  const handleCancelEntireImport = () => {
    setShowCancelEntireConfirm(false);
    if (isImporting) {
      cancelImportRef.current = true;
      setCancelRequested(true);
      return;
    }
    const counts = summary ? computeSelectionCounts(summary.rows) : null;
    logAuditAction('BULK_IMPORT', 'stage_tube_ball_mills', undefined, `[IMPORT_CANCELLED] استيراد الطواحين الأنبوبية والكرات - تم إلغاء عملية الرفع بالكامل قبل التنفيذ - المحدد: ${counts?.selected ?? 0} - سيتم استيراده: ${counts?.willImport ?? 0} - المستخدم: ${adminUser?.email || 'admin'}`).catch(() => {});
    setReviewWindow(null);
    setShowFinalConfirm(false);
    setImportResult(null);
    setSummary(null);
    setFile(null);
    setBackupId(null);
    setActiveFilterTab('ALL');
    setFeedback({ type: 'success', message: t('تم إلغاء عملية الرفع بالكامل. لم يتم تسجيل أي سجل.', 'The entire import operation was cancelled. No records were written.', language) });
  };

  // ---- Import execution ----
  const writableRows = useMemo(() => (summary ? summary.rows.filter(isTubeBallMillsRowWritable) : []), [summary]);
  const handleStartImport = () => setShowFinalConfirm(true);

  const handleConfirmImport = async () => {
    if (isConfirmingImportRef.current) return;
    isConfirmingImportRef.current = true;
    setShowFinalConfirm(false);
    if (writableRows.length === 0 || !summary) {
      isConfirmingImportRef.current = false;
      return;
    }
    setIsImporting(true);
    setImportProgress(0);
    cancelImportRef.current = false;
    setCancelRequested(false);
    logAuditAction('BULK_IMPORT', 'stage_tube_ball_mills', undefined, `[ROW_IMPORT_STARTED] استيراد الطواحين الأنبوبية والكرات - بدء رفع ${writableRows.length} سجل`).catch(() => {});
    try {
      let candidates = writableRows.map((row) => {
        const fields = extractFieldsFromRow(row);
        const resolved = revalidateTubeBallMillsRowFields(fields, masterDataBundle, approvedMappings, language, manualOverrides, {}, row.bunkerAllocations);
        const merged: TubeBallMillsImportRow = { ...row, ...resolved, isDuplicate: row.isDuplicate, duplicateType: row.duplicateType };
        return resolved.errors.length > 0 ? { ...merged, rowSelection: 'PENDING' as const } : merged;
      });
      candidates = await recheckDatabaseDuplicates(candidates, language);
      const stillWritable = candidates.filter(isTubeBallMillsRowWritable);
      const droppedAtLastMoment = candidates.length - stillWritable.length;

      const counts = computeSelectionCounts(summary.rows);
      const result = await executeTubeBallMillsBatchImport(
        stillWritable,
        backupId || undefined,
        (pct) => setImportProgress(pct),
        () => cancelImportRef.current,
        { fileName: file?.name, totalRowsInSession: summary.totalRows, selectedCount: counts.selected, approvedCount: counts.approved, correctedCount: counts.corrected, warningCount: counts.warning, blockingCount: counts.blocking }
      );

      // Gap-fix §9: mark each row's outcome from the PRECISE per-row result
      // (importedRowIndexes/failedRowIndexes), never from a single "did the
      // whole call have zero errors" flag - so a chunk that failed does not
      // wrongly leave a DIFFERENT, genuinely-committed chunk's rows without
      // their IMPORTED outcome.
      updateRows((rows) =>
        rows.map((r) => {
          if (result.importedRowIndexes.includes(r.rowIndex)) return { ...r, importOutcome: 'IMPORTED' };
          if (result.failedRowIndexes.includes(r.rowIndex)) return { ...r, importOutcome: 'FAILED' };
          return r;
        })
      );

      const pendingAfter = summary.rows.filter((r) => getSelection(r) === 'PENDING').length;
      const excludedAfter = summary.rows.filter((r) => getSelection(r) === 'EXCLUDED').length;
      setImportResult({
        total: summary.totalRows,
        imported: result.importedCount,
        failed: result.failedCount,
        skipped: droppedAtLastMoment,
        pending: pendingAfter,
        excluded: excludedAfter,
        cancelled: result.cancelledCount,
        importId: result.importId,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || t('حدث خطأ أثناء الاستيراد.', 'An error occurred during import.', language) });
    } finally {
      setIsImporting(false);
      cancelImportRef.current = false;
      setCancelRequested(false);
      isConfirmingImportRef.current = false;
    }
  };

  /**
   * §Q: Error Report - reuses the SAME xlsx client-side export infra Chinese
   * Mills' own handleExportErrorReport already uses, never a new export
   * pipeline. Covers every row that will NOT import right now, with the
   * exact columns §Q asks for, sourced from data that already exists on the
   * row - nothing invented.
   */
  const handleExportErrorReport = () => {
    if (!summary) return;
    const rows = summary.rows.filter((r) => !isTubeBallMillsRowWritable(r));
    if (rows.length === 0) return;
    const reportRows = rows.map((r) => {
      const lastResolution = r.resolutionHistory?.[r.resolutionHistory.length - 1];
      const user = r.excludedBy || r.warningOverrideBy || lastResolution?.actor || '';
      const timestamp = r.excludedAt || r.warningOverrideAt || lastResolution?.timestamp || '';
      return {
        [t('رقم الصف', 'Row #', language)]: r.rowIndex,
        [t('القيمة الأصلية', 'Original Value', language)]: `${r.millTypeRaw || ''} / ${r.materialTypeRaw || ''} / ${r.storageBunkersRaw || ''}`,
        [t('القيمة المصححة', 'Corrected Value', language)]: `${r.resolvedMillName || ''} / ${r.resolvedMaterialName || r.resolvedMixtureProductName || ''}`,
        [t('الخطأ', 'Error', language)]: r.errors.join(' | '),
        [t('الحل المقترح', 'Suggested Solution', language)]: r.suggestedMixtureProductName || '',
        [t('القيمة المصححة', 'Suggested Value', language)]: r.suggestedMixtureProductName || '',
        [t('الحل', 'Resolution', language)]: r.resolutionHistory?.map((h) => h.summary).join(' | ') || '',
        [t('طريقة الحل', 'Resolution Method', language)]: lastResolution?.action || '',
        [t('الحالة', 'Status', language)]: r.status,
        [t('القرار', 'Decision', language)]: `${getSelection(r)}${r.exclusionReason ? ` (${r.exclusionReason})` : ''}`,
        [t('المستخدم', 'User', language)]: user,
        [t('التوقيت', 'Timestamp', language)]: timestamp,
      };
    });
    const worksheet = XLSX.utils.json_to_sheet(reportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, t('تقرير الأخطاء', 'Error Report', language));
    XLSX.writeFile(workbook, `tube-ball-mills-import-errors-${Date.now()}.xlsx`);
  };

  // ---- Draft ----
  const handleSaveDraft = () => {
    if (!summary || !adminUser?.email) return;
    const { rows, ...rest } = summary;
    const outcome = saveDraft(file?.name || 'tube-ball-mills.xlsx', rows, rest, adminUser.email);
    if (outcome.ok) {
      setSavedDraft(outcome.draft);
      setFeedback({ type: 'success', message: t('تم حفظ المسودة.', 'Draft saved.', language) });
    } else {
      setFeedback({ type: 'error', message: t('تعذر حفظ المسودة (مساحة التخزين المحلية ممتلئة أو غير متاحة).', 'Could not save draft (local storage full or unavailable).', language) });
    }
  };
  const handleOpenDraft = () => {
    if (!savedDraft) return;
    setSummary({ ...savedDraft.summary, rows: savedDraft.rows });
    setFile({ name: savedDraft.fileName } as File);
    logDraftOpened(savedDraft);
  };
  const handleDeleteDraft = () => {
    if (!adminUser?.email) return;
    deleteDraft(adminUser.email);
    setSavedDraft(null);
  };

  // ---- History ----
  const openHistoryModal = async () => {
    setShowHistoryModal(true);
    setIsLoadingHistory(true);
    setHistoryErrors({});
    try {
      const { entries, auditTrailError, auditLogError } = await loadHistoricalImportOperations();
      setImportHistory(filterImportHistory(entries as any, { stage: 'tube_ball_mills' }) as ImportAuditEntry[]);
      setHistoryErrors({ auditTrailError, auditLogError });
    } catch (err: any) {
      setHistoryErrors({ auditLogError: err?.message || 'unknown-error' });
    } finally {
      setIsLoadingHistory(false);
    }
  };
  const openHistoryDetail = async (entry: ImportAuditEntry) => {
    setHistoryDetail(entry);
    setHistoryDetailRows(null);
    logAuditAction('UPDATE', 'stage_tube_ball_mills', entry.importBatchId, `[IMPORT_VIEWED] عرض تفاصيل عملية الرفع ${entry.importBatchId}`).catch(() => {});
    try {
      const rows = await getTubeBallMillsImportedRowsByBatch(entry.importBatchId);
      setHistoryDetailRows(rows);
    } catch {
      setHistoryDetailRows([]);
    }
  };
  const openRollbackConfirm = (entry: ImportAuditEntry) => {
    setRollbackTarget(entry);
    setRollbackMessage(null);
  };
  const confirmRollback = async () => {
    if (!rollbackTarget) return;
    try {
      const res = await rollbackImportBatch(rollbackTarget.importBatchId, 'tube_ball_mills');
      logAuditAction('DELETE', 'stage_tube_ball_mills', rollbackTarget.importBatchId, `[IMPORT_DELETE_COMPLETED] حذف ${res.deletedCount} سجل من عملية الرفع ${rollbackTarget.importBatchId}`).catch(() => {});
      setRollbackMessage(t(`تم حذف ${res.deletedCount} سجل.`, `${res.deletedCount} record(s) deleted.`, language));
      const refreshed = await loadHistoricalImportOperations();
      setImportHistory(filterImportHistory(refreshed.entries as any, { stage: 'tube_ball_mills' }) as ImportAuditEntry[]);
    } catch (err: any) {
      setRollbackMessage(err.message || t('تعذر التراجع.', 'Rollback failed.', language));
    }
  };

  const filteredRows = useMemo(() => {
    if (!summary) return [];
    let rows = summary.rows;
    if (activeFilterTab === 'VALID') rows = rows.filter((r) => r.errors.length === 0 && r.warnings.length === 0);
    if (activeFilterTab === 'WARNING') rows = rows.filter((r) => r.warnings.length > 0);
    if (activeFilterTab === 'DUPLICATE') rows = rows.filter((r) => r.isDuplicate);
    if (activeFilterTab === 'EXCLUDED') rows = rows.filter((r) => getSelection(r) === 'EXCLUDED');
    return rows.filter((r) => !matchesInvalidNeedsReview(r));
  }, [summary, activeFilterTab]);

  const excludedRows = useMemo(() => (summary ? summary.rows.filter((r) => getSelection(r) === 'EXCLUDED') : []), [summary]);
  const pendingRows = useMemo(() => (summary ? summary.rows.filter((r) => r.errors.length > 0) : []), [summary]);
  const selectionCounts = useMemo(() => computeSelectionCounts(summary?.rows || []), [summary]);
  /** §2/§15: full-file Master Data extraction - deterministic, no Firestore access, recomputed whenever row state changes (a resolution action updates its own group's resolved/suggested fields immediately). */
  const masterDataExtraction: TubeBallMillsMasterDataExtraction = useMemo(
    () => extractTubeBallMillsMasterDataGroups(summary?.rows || []),
    [summary]
  );
  const millGroupCounts = useMemo(() => summarizeMasterDataGroup(masterDataExtraction.mills), [masterDataExtraction]);
  const materialGroupCounts = useMemo(() => summarizeMasterDataGroup(masterDataExtraction.materials), [masterDataExtraction]);
  const mixtureGroupCounts = useMemo(() => summarizeMasterDataGroup(masterDataExtraction.mixtures), [masterDataExtraction]);
  const bunkerGroupCounts = useMemo(() => summarizeMasterDataGroup(masterDataExtraction.bunkers), [masterDataExtraction]);

  const reviewWindowRows = useMemo(() => {
    if (!reviewWindow || !summary) return [];
    if (reviewWindow.mode === 'INVALID') return summary.rows.filter(matchesInvalidNeedsReview);
    if (reviewWindow.mode === 'ALL') return summary.rows;
    return summary.rows;
  }, [reviewWindow, summary]);
  const reviewWindowSelectedCount = useMemo(() => reviewWindowRows.filter((r) => getSelection(r) === 'INCLUDED').length, [reviewWindowRows]);
  const reviewWindowWillImportCount = useMemo(() => reviewWindowRows.filter(isTubeBallMillsRowWritable).length, [reviewWindowRows]);
  const reviewWindowApprovableRows = useMemo(() => reviewWindowRows.filter((r) => r.errors.length > 0 && !isNonOverridableBlockingCondition(r)), [reviewWindowRows]);
  const reviewWindowMarkReadyEligibleRows = useMemo(() => reviewWindowRows.filter(canMarkReadyToImport), [reviewWindowRows]);
  const reviewWindowSelectedMarkReadyEligibleRows = useMemo(() => reviewWindowRows.filter((r) => getSelection(r) === 'INCLUDED' && canMarkReadyToImport(r)), [reviewWindowRows]);

  const toggleExpandRow = (rowIndex: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex); else next.add(rowIndex);
      return next;
    });
  };

  if (!summary) {
    return (
      <div className="space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-3">
          <h2 className="text-sm font-black text-slate-900">{t('استيراد بيانات الطواحين الأنبوبية والكرات التاريخية', 'Tube/Ball Mills Historical Import', language)}</h2>
          {masterDataErrors.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-1">
              {masterDataErrors.map((e) => (
                <p key={e.domain} className="text-[11px] text-amber-900">{describeMasterDataLoadError(e, language)}</p>
              ))}
            </div>
          )}
          {savedDraft && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
              <div className="text-[11px] text-indigo-900">
                <span className="font-black">{t('المسودات', 'Drafts', language)}: </span>
                {t('استيراد الطواحين الأنبوبية والكرات', 'Tube/Ball Mills Historical Import', language)} · {t('أُنشئت', 'Created', language)} {new Date(savedDraft.createdAt).toLocaleString()} · {t('عدد الصفوف', 'Rows', language)}: {savedDraft.rows.length}
                <div className="text-amber-700 mt-1">{t('هذه المسودة محفوظة محليًا على هذا المتصفح.', 'This draft is stored locally in this browser.', language)}</div>
              </div>
              <div className="flex items-center gap-2">
                {canManageImport && <button type="button" onClick={handleOpenDraft} className="px-3 py-1.5 text-[11px] font-bold text-indigo-800 bg-indigo-100 hover:bg-indigo-200 rounded-lg cursor-pointer">{t('فتح المسودة', 'Open Draft', language)}</button>}
                {canDeletePermanently && <button type="button" onClick={handleDeleteDraft} className="px-3 py-1.5 text-[11px] font-bold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg cursor-pointer">{t('حذف المسودة', 'Delete Draft', language)}</button>}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between">
            <label className="flex-1 border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors" onDrop={handleFileDrop} onDragOver={(e) => e.preventDefault()}>
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileDrop} />
              <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">{t('اسحب ملف Excel هنا أو انقر للاختيار', 'Drag an Excel file here or click to select', language)}</p>
              <p className="text-[11px] text-slate-400 mt-1">{getTubeBallMillsImportHeadersDisplay(language)}</p>
            </label>
            <div className="ms-3 flex flex-col gap-2 shrink-0">
              <button type="button" onClick={() => downloadTubeBallMillsExcelTemplate(language)} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl cursor-pointer">
                <Download className="w-4 h-4" />
                <span>{t('تحميل نموذج Excel', 'Download Excel Template', language)}</span>
              </button>
              <button type="button" onClick={openHistoryModal} className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
                <History className="w-4 h-4" />
                <span>{t('سجل عمليات الرفع التاريخية', 'Historical Import History', language)}</span>
              </button>
            </div>
          </div>
          {(isParsing || isCreatingBackup) && (
            <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin" />{isParsing ? t('جاري تحليل الملف...', 'Parsing file...', language) : t('جاري إنشاء نسخة احتياطية وقائية...', 'Creating safety backup...', language)}</div>
          )}
          {feedback && <div className={`text-[11px] p-2 rounded-lg ${feedback.type === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{feedback.message}</div>}
        </div>
        {renderHistoryModal()}
      </div>
    );
  }

  return (
    <div className="space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      {feedback && <div className={`text-[11px] p-2.5 rounded-lg ${feedback.type === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200'}`}>{feedback.message}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500 font-bold truncate">{file?.name || ''}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={openHistoryModal} className="px-3 py-1.5 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer flex items-center gap-1"><History className="w-3.5 h-3.5" />{t('السجل', 'History', language)}</button>
            {canManageImport && <button type="button" onClick={() => setShowCancelEntireConfirm(true)} className="px-3 py-1.5 text-[11px] font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer">{t('إلغاء عملية الرفع بالكامل', 'Cancel Entire Import', language)}</button>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            { label: t('إجمالي السجلات', 'Total Rows', language), value: selectionCounts.total, cls: 'text-slate-700' },
            { label: t('الصالحة', 'Valid', language), value: selectionCounts.valid, cls: 'text-emerald-600' },
            { label: t('جاهزة', 'Ready', language), value: selectionCounts.ready, cls: 'text-emerald-600' },
            { label: t('جاهز للرفع', 'Marked Ready to Import', language), value: selectionCounts.markedReadyToImport, cls: 'text-emerald-800' },
            { label: t('تم تصحيحه', 'Corrected', language), value: selectionCounts.corrected, cls: 'text-sky-600' },
            { label: t('يحتاج مراجعة', 'Needs Review', language), value: selectionCounts.invalidNeedsReview, cls: 'text-red-600' },
            { label: t('معتمد', 'Approved', language), value: selectionCounts.approved, cls: 'text-sky-700' },
            { label: t('أخطاء مانعة', 'Non-Overridable Blocking', language), value: selectionCounts.blocking, cls: 'text-red-700' },
            { label: t('تحذيرات', 'Warnings', language), value: selectionCounts.warning, cls: 'text-amber-600' },
            { label: t('تم التخطي', 'Skipped', language), value: selectionCounts.skipped, cls: 'text-slate-500' },
            { label: t('مستبعد', 'Excluded', language), value: selectionCounts.excluded, cls: 'text-slate-500' },
            { label: t('المحدد', 'Selected', language), value: selectionCounts.selected, cls: 'text-slate-900' },
            { label: t('سيتم رفعه', 'Will Import', language), value: selectionCounts.willImport, cls: 'text-emerald-700' },
          ].map((s) => (
            <div key={s.label} className="text-center px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50/60">
              <span className="text-[10px] font-bold text-slate-500 block">{s.label}</span>
              <span className={`text-sm font-black block ${s.cls}`}>{s.value}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {[
            { key: 'ALL', label: t('الكل', 'All', language), value: summary.totalRows },
            { key: 'VALID', label: t('صالح', 'Valid', language), value: summary.validRows },
            { key: 'WARNING', label: t('تحذير', 'Warning', language), value: summary.warningRows },
            { key: 'DUPLICATE', label: t('مكرر', 'Duplicate', language), value: summary.duplicateRows },
            { key: 'EXCLUDED', label: t('مستبعد', 'Excluded', language), value: excludedRows.length },
          ].map((tab) => (
            <button key={tab.key} type="button" onClick={() => setActiveFilterTab(tab.key as FilterTab)} className={`text-center px-3 py-1.5 rounded-lg border ${activeFilterTab === tab.key ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}>
              <span className="text-[11px] font-bold text-slate-500 block">{tab.label}</span>
              <span className="text-base font-black block text-slate-700">{tab.value}</span>
            </button>
          ))}
          <button type="button" onClick={() => document.getElementById('tbm-pending-section')?.scrollIntoView({ behavior: 'smooth' })} className="text-center px-3 py-1.5 rounded-lg border border-red-200 bg-red-50/60 cursor-pointer">
            <span className="text-[11px] font-bold text-red-600 block">{t('يحتاج مراجعة', 'Needs Review', language)}</span>
            <span className="text-base font-black block text-red-700">{pendingRows.length}</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          <button type="button" onClick={() => handleBulkSelection('ALL')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('تحديد الكل', 'Select All', language)}</button>
          <button type="button" onClick={() => handleBulkSelection('NONE')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء تحديد الكل', 'Deselect All', language)}</button>
          <button type="button" onClick={() => handleBulkSelection('VALID')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('تحديد الصالح', 'Select Valid', language)}</button>
          <button type="button" onClick={() => handleBulkSelection('READY')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('تحديد الجاهز', 'Select Ready', language)}</button>
          <button type="button" onClick={() => handleBulkSelection('CORRECTED')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('تحديد المصحح', 'Select Corrected', language)}</button>
          <button type="button" onClick={() => setShowMasterDataReview(true)} className="px-2.5 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-800 rounded-lg cursor-pointer flex items-center gap-1.5">
            <ListChecks className="w-3.5 h-3.5" />
            {t('مراجعة البيانات الأساسية', 'Master Data Review', language)}
            {(millGroupCounts.unresolvedCount + materialGroupCounts.unresolvedCount + mixtureGroupCounts.unresolvedCount + bunkerGroupCounts.unresolvedCount) > 0 && (
              <span className="px-1.5 py-0.5 bg-red-600 text-white rounded-full text-[10px] font-black">{millGroupCounts.unresolvedCount + materialGroupCounts.unresolvedCount + mixtureGroupCounts.unresolvedCount + bunkerGroupCounts.unresolvedCount}</span>
            )}
          </button>
          {canManageImport && <button type="button" onClick={() => setReviewWindow({ mode: 'ALL', source: 'LIVE' })} className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-lg cursor-pointer">{t('فتح نافذة المراجعة الكاملة', 'Open Full Review Window', language)}</button>}
          {canManageImport && <button type="button" onClick={() => setReviewWindow({ mode: 'INVALID', source: 'LIVE' })} className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-800 rounded-lg cursor-pointer">{t('مراجعة السجلات التي تحتاج مراجعة', 'Review Needs-Review Records', language)}</button>}
          {canManageImport && <button type="button" onClick={handleSaveDraft} className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 rounded-lg cursor-pointer">{t('حفظ كمسودة', 'Save as Draft', language)}</button>}
          <button type="button" onClick={() => setShowExcludedPanel((v) => !v)} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('السجلات المستبعدة', 'Excluded Rows', language)} ({excludedRows.length})</button>
          <button type="button" disabled={selectionCounts.willImport === selectionCounts.total} onClick={handleExportErrorReport} className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 rounded-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">{t('تقرير الأخطاء', 'Error Report', language)}</button>
        </div>

        {showExcludedPanel && (
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            {excludedRows.length === 0 ? (
              <p className="text-[11px] text-slate-500">{t('لا توجد صفوف مستبعدة.', 'No excluded rows.', language)}</p>
            ) : (
              excludedRows.map((row) => (
                <div key={row.rowIndex} className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200 text-[11px]">
                  <span className="font-bold text-slate-700">#{row.rowIndex} - {row.millTypeRaw} ({row.exclusionReason})</span>
                  <div className="flex items-center gap-1.5">
                    {canEditPending && <button type="button" onClick={() => openEditRow(row.rowIndex)} className="px-2 py-1 bg-sky-50 text-sky-700 rounded-md cursor-pointer">{t('تعديل', 'Edit', language)}</button>}
                    {canManageImport && <button type="button" onClick={() => handleReincludeRow(row.rowIndex)} className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md cursor-pointer">{t('إعادة إدراج', 'Re-include', language)}</button>}
                    {canManageImport && (
                      <button type="button" disabled={!canMarkReadyToImport(row)} onClick={() => handleMarkRowReady(row.rowIndex)} className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded-md cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
                        {t('إعادة إدراج وجاهز للرفع', 'Reinclude and Mark Ready', language)}
                      </button>
                    )}
                    {canDeletePermanently && <button type="button" onClick={() => setDeleteConfirm({ rowIndexes: [row.rowIndex] })} className="px-2 py-1 bg-red-50 text-red-700 rounded-md cursor-pointer">{t('حذف نهائي', 'Delete Permanently', language)}</button>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {renderMainReviewTable(filteredRows)}

        <div id="tbm-pending-section" className="p-3 bg-red-50/40 border border-red-200 rounded-xl space-y-2 scroll-mt-4">
          <h3 className="text-xs font-black text-red-900 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" />{t(`السجلات التي تحتاج مراجعة (${pendingRows.length})`, `Needs Review (${pendingRows.length})`, language)}</h3>
          {renderNeedsReviewTable(pendingRows)}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <span className="text-[11px] text-slate-500">{t(`سيتم رفع ${selectionCounts.willImport} سجل من أصل ${selectionCounts.total}`, `${selectionCounts.willImport} of ${selectionCounts.total} records will be imported`, language)}</span>
          {canManageImport && <button type="button" disabled={selectionCounts.willImport === 0} onClick={handleStartImport} className="px-5 py-2.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">{t('اعتماد ورفع السجلات المحددة', 'Import Selected Rows', language)}</button>}
        </div>
      </div>

      {isImporting && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
          <div className="flex items-center justify-between text-xs font-bold">
            <span>{cancelRequested ? t('جارٍ إلغاء الرفع بعد إتمام الدفعة الحالية', 'Canceling import after the current batch completes', language) : t('جاري إرسال السجلات...', 'Writing records...', language)}</span>
            <span>{importProgress}%</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${importProgress}%` }} /></div>
          {canManageImport && !cancelRequested && <button type="button" onClick={() => { cancelImportRef.current = true; setCancelRequested(true); }} className="px-3 py-1.5 text-[11px] font-bold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg cursor-pointer">{t('إلغاء الرفع', 'Cancel Import', language)}</button>}
        </div>
      )}

      {importResult && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-2">
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4 text-emerald-600" />{t('نتيجة الاستيراد', 'Import Result', language)}</h3>
          <p className="text-xs text-emerald-800 font-mono">{t('رقم العملية', 'ImportId', language)}: {importResult.importId}</p>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span>{t('تم الاستيراد', 'Imported', language)}: {importResult.imported}</span>
            <span>{t('فشل', 'Failed', language)}: {importResult.failed}</span>
            <span>{t('متبقي معلق', 'Remaining Pending', language)}: {importResult.pending}</span>
            <span>{t('مستبعد', 'Excluded', language)}: {importResult.excluded}</span>
            <span>{t('ملغى', 'Cancelled', language)}: {importResult.cancelled}</span>
          </div>
        </div>
      )}

      {/* Review Window Modal */}
      {reviewWindow && summary && (
        <Modal isOpen onClose={() => setReviewWindow(null)} title={reviewWindow.mode === 'INVALID' ? t('مراجعة السجلات التي تحتاج مراجعة', 'Review Needs-Review Records', language) : t('مراجعة كاملة', 'Full Review', language)} maxWidth="4xl">
          <div className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
            <p className="text-[11px] text-slate-500">{t(`عدد السجلات: ${reviewWindowRows.length} · المحدد: ${reviewWindowSelectedCount} · سيتم استيراده: ${reviewWindowWillImportCount}`, `Records: ${reviewWindowRows.length} · Selected: ${reviewWindowSelectedCount} · Will Import: ${reviewWindowWillImportCount}`, language)}</p>
            <div className="max-h-[60vh] overflow-y-auto space-y-4">
              {reviewWindow.mode === 'INVALID' ? renderNeedsReviewTable(reviewWindowRows) : (
                <>
                  {renderNeedsReviewTable(reviewWindowRows.filter(matchesInvalidNeedsReview))}
                  {renderMainReviewTable(reviewWindowRows.filter((r) => !matchesInvalidNeedsReview(r)))}
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-100 text-[11px] font-bold">
              <button type="button" onClick={() => handleScopedBulkSelection('ALL', new Set(reviewWindowRows.map((r) => r.rowIndex)))} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('تحديد الكل', 'Select All', language)}</button>
              <button type="button" onClick={() => handleScopedBulkSelection('NONE', new Set(reviewWindowRows.map((r) => r.rowIndex)))} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء تحديد الكل', 'Deselect All', language)}</button>
              {canManageImport && reviewWindowApprovableRows.length > 0 && (
                <button type="button" onClick={() => setApproveAllConfirm({ scopeRowIndexes: new Set(reviewWindowApprovableRows.map((r) => r.rowIndex)), count: reviewWindowApprovableRows.length })} className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-lg cursor-pointer">{t(`اعتماد الكل (${reviewWindowApprovableRows.length})`, `Approve All (${reviewWindowApprovableRows.length})`, language)}</button>
              )}
              {canManageImport && reviewWindowSelectedMarkReadyEligibleRows.length > 0 && (
                <button type="button" onClick={() => applyBulkMarkReady(new Set(reviewWindowSelectedMarkReadyEligibleRows.map((r) => r.rowIndex)), 'BULK_SELECTED')} className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg cursor-pointer">{t(`تحويل المحدد إلى جاهز للرفع (${reviewWindowSelectedMarkReadyEligibleRows.length})`, `Mark Selected as Ready (${reviewWindowSelectedMarkReadyEligibleRows.length})`, language)}</button>
              )}
              {canManageImport && reviewWindowMarkReadyEligibleRows.length > 0 && (
                <button type="button" onClick={() => setMarkAllReadyConfirm({ scopeRowIndexes: new Set(reviewWindowMarkReadyEligibleRows.map((r) => r.rowIndex)), count: reviewWindowMarkReadyEligibleRows.length })} className="px-2.5 py-1.5 bg-emerald-100 hover:bg-emerald-200 text-emerald-900 rounded-lg cursor-pointer">{t(`تحويل الكل إلى جاهز للرفع (${reviewWindowMarkReadyEligibleRows.length})`, `Mark All as Ready (${reviewWindowMarkReadyEligibleRows.length})`, language)}</button>
              )}
              <button type="button" onClick={() => setReviewWindow(null)} className="ms-auto px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg cursor-pointer">{t('إغلاق', 'Close', language)}</button>
            </div>
          </div>
        </Modal>
      )}

      {approveAllConfirm && (
        <Modal isOpen onClose={() => setApproveAllConfirm(null)} title={t('اعتماد جميع السجلات', 'Approve All Records', language)} maxWidth="sm">
          <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
            <p className="text-slate-800">{t(`سيتم اعتماد ${approveAllConfirm.count} سجل. هل تريد المتابعة؟`, `${approveAllConfirm.count} records will be approved. Continue?`, language)}</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setApproveAllConfirm(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
              <button type="button" onClick={() => handleApproveAllInWindow(approveAllConfirm.scopeRowIndexes)} className="px-4 py-2 text-xs font-black text-white bg-sky-600 hover:bg-sky-700 rounded-lg cursor-pointer">{t('اعتماد', 'Approve', language)}</button>
            </div>
          </div>
        </Modal>
      )}

      {markAllReadyConfirm && (
        <Modal isOpen onClose={() => setMarkAllReadyConfirm(null)} title={t('تحويل الكل إلى جاهز للرفع', 'Mark All as Ready to Import', language)} maxWidth="sm">
          <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
            <p className="text-slate-800">{t(`سيتم تحويل ${markAllReadyConfirm.count} سجل إلى جاهز للرفع. هل تريد المتابعة؟`, `${markAllReadyConfirm.count} record(s) will be marked Ready to Import. Continue?`, language)}</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setMarkAllReadyConfirm(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
              <button type="button" onClick={() => { applyBulkMarkReady(markAllReadyConfirm.scopeRowIndexes, 'BULK_ALL'); setMarkAllReadyConfirm(null); }} className="px-4 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer">{t('تحويل', 'Convert', language)}</button>
            </div>
          </div>
        </Modal>
      )}

      {showCancelEntireConfirm && (
        <Modal isOpen onClose={() => setShowCancelEntireConfirm(false)} title={t('إلغاء عملية الرفع بالكامل', 'Cancel Entire Import', language)} maxWidth="sm">
          <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
            <p className="text-slate-800">{t('سيتم إلغاء عملية الرفع بالكامل ولن يتم تسجيل السجلات المتبقية. هل تريد المتابعة؟', 'The entire import operation will be cancelled and the remaining records will not be imported. Continue?', language)}</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setShowCancelEntireConfirm(false)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('رجوع', 'Back', language)}</button>
              <button type="button" onClick={handleCancelEntireImport} className="px-4 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer">{t('إلغاء عملية الرفع', 'Cancel Import', language)}</button>
            </div>
          </div>
        </Modal>
      )}

      {showFinalConfirm && (
        <Modal isOpen onClose={() => setShowFinalConfirm(false)} title={t('اعتماد ورفع السجلات المحددة', 'Approve & Import Selected Records', language)} maxWidth="sm">
          <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
            <p className="font-bold text-slate-900">{t(`سيتم رفع ${writableRows.length} سجل فقط. سيتم ترك ${summary.totalRows - writableRows.length} سجل دون تسجيل. هل تريد المتابعة؟`, `Only ${writableRows.length} records will be imported. ${summary.totalRows - writableRows.length} records will remain unimported. Continue?`, language)}</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setShowFinalConfirm(false)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء الرفع', 'Cancel', language)}</button>
              <button type="button" disabled={isImporting} onClick={handleConfirmImport} className="px-4 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">{t('تأكيد', 'Confirm', language)}</button>
            </div>
          </div>
        </Modal>
      )}

      {renderEditRowModal()}
      {renderCodeNewModal()}
      {renderMasterDataReviewModal()}
      {renderHistoryModal()}

      {deleteConfirm && (
        <Modal isOpen onClose={() => setDeleteConfirm(null)} title={t('حذف نهائي', 'Delete Permanently', language)} maxWidth="sm">
          <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
            <p className="text-slate-800">{t(`سيتم حذف ${deleteConfirm.rowIndexes.length} سجل نهائيًا من جلسة الاستيراد الحالية. هل تريد المتابعة؟`, `${deleteConfirm.rowIndexes.length} record(s) will be permanently removed from this import session. Continue?`, language)}</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
              <button type="button" onClick={() => { updateRows((rows) => rows.filter((r) => !deleteConfirm.rowIndexes.includes(r.rowIndex))); setDeleteConfirm(null); }} className="px-4 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer">{t('حذف', 'Delete', language)}</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );

  function renderMainReviewTable(rows: TubeBallMillsImportRow[]) {
    return (
      <div className="overflow-x-auto max-h-[calc(100vh-540px)] lg:max-h-[calc(100vh-480px)] overflow-y-auto border border-slate-200 rounded-xl">
        <table className="w-full text-[11px] min-w-[900px]">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr className="text-slate-500 border-b border-slate-200">
              <th className="text-start py-2 px-2"></th>
              <th className="text-start py-2 px-2 font-bold">#</th>
              <th className="text-start py-2 px-2 font-bold">{t('التاريخ', 'Date', language)}</th>
              <th className="text-start py-2 px-2 font-bold">{t('نوع الطاحونة', 'Mill Type', language)}</th>
              <th className="text-start py-2 px-2 font-bold">{t('نوع الخامة', 'Material', language)}</th>
              <th className="text-end py-2 px-2 font-bold">{t('الساعات', 'Hours', language)}</th>
              <th className="text-end py-2 px-2 font-bold">{t('الطن/ساعة', 'Tons/Hr', language)}</th>
              <th className="text-start py-2 px-2 font-bold">{t('البناكر', 'Bunkers', language)}</th>
              <th className="text-end py-2 px-2 font-bold">{t('الإجمالي', 'Total', language)}</th>
              <th className="text-start py-2 px-2 font-bold">{t('الحالة', 'Status', language)}</th>
              <th className="text-start py-2 px-2 font-bold">{t('القرار', 'Decision', language)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const statusInfo = STATUS_LABELS[row.status] || STATUS_LABELS.VALID;
              const isExpanded = expandedRows.has(row.rowIndex);
              return (
                <React.Fragment key={row.rowIndex}>
                  <tr className={`border-b border-slate-100 ${isExpanded ? 'bg-slate-50/60' : 'hover:bg-slate-50/40'}`}>
                    <td className="py-2 px-2"><input type="checkbox" checked={getSelection(row) === 'INCLUDED'} onChange={(e) => (e.target.checked ? handleReincludeRow(row.rowIndex) : handleExcludeRow(row.rowIndex))} /></td>
                    <td className="py-2 px-2 font-mono text-slate-400">{row.rowIndex}</td>
                    <td className="py-2 px-2 text-slate-700">{row.date}</td>
                    <td className="py-2 px-2 text-slate-700">{row.resolvedMillName || row.millTypeRaw}</td>
                    <td className="py-2 px-2 text-slate-700">{row.isMixture ? `${row.materialTypeRaw} (${t('خلطة', 'Mixture', language)})` : (row.resolvedMaterialName || row.materialTypeRaw)}</td>
                    <td className="py-2 px-2 text-end">{row.operatingHours}</td>
                    <td className="py-2 px-2 text-end">{row.tonsPerHour}</td>
                    <td className="py-2 px-2 text-slate-600">{row.bunkerAllocations.map((b) => b.bunkerRaw).join('-')}</td>
                    <td className="py-2 px-2 text-end font-bold text-slate-800">{row.totalTons}</td>
                    <td className="py-2 px-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${statusInfo.cls}`}>{language === 'ar' ? statusInfo.ar : statusInfo.en}</span>
                      {row.readyToImport && <span className="ms-1 text-[10px] font-black px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-300">{t('جاهز للرفع', 'READY', language)}</span>}
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => toggleExpandRow(row.rowIndex)} className="px-1.5 py-1 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer font-bold">{isExpanded ? '−' : '+'}</button>
                        {canEditPending && <button type="button" onClick={() => openEditRow(row.rowIndex)} className="p-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded cursor-pointer"><Edit3 className="w-3.5 h-3.5" /></button>}
                        {row.warnings.length > 0 && !row.warningsAccepted && <button type="button" disabled={!canOverrideWarnings} onClick={() => handleAcceptWarnings(row.rowIndex)} className="px-1.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded cursor-pointer font-bold disabled:opacity-40">{t('اعتماد', 'Approve', language)}</button>}
                        {getSelection(row) === 'INCLUDED' && <button type="button" onClick={() => handleExcludeRow(row.rowIndex, 'EXCLUDED_ROW')} className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded cursor-pointer"><Ban className="w-3.5 h-3.5" /></button>}
                        {canManageImport && (row.readyToImport
                          ? <button type="button" onClick={() => handleUndoReady(row.rowIndex)} className="px-1.5 py-1 bg-amber-50 text-amber-700 rounded cursor-pointer font-bold">{t('إلغاء الجاهزية', 'Undo Ready', language)}</button>
                          : <button type="button" disabled={!canMarkReadyToImport(row)} onClick={() => handleMarkRowReady(row.rowIndex)} className="px-1.5 py-1 bg-emerald-50 text-emerald-700 rounded cursor-pointer font-bold disabled:opacity-40 disabled:cursor-not-allowed">{t('جاهز للرفع', 'Mark Ready', language)}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && <tr className="border-b border-slate-100 bg-slate-50/30"><td colSpan={11} className="p-3">{renderRowDetail(row)}</td></tr>}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={11} className="text-center py-6 text-slate-400 text-xs">{t('لا توجد سجلات مطابقة لهذا الاختيار.', 'No records match this selection.', language)}</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  function renderNeedsReviewTable(rows: TubeBallMillsImportRow[]) {
    return (
      <div className="overflow-x-auto max-h-[calc(100vh-540px)] lg:max-h-[calc(100vh-480px)] overflow-y-auto border border-red-100 rounded-xl">
        <table className="w-full text-[11px] min-w-[900px]">
          <thead className="sticky top-0 bg-red-50 z-10">
            <tr className="text-slate-500 border-b border-red-100">
              <th className="text-start py-1.5 px-1"></th>
              <th className="text-start py-1.5 px-1 font-bold">{t('رقم الصف', 'Row #', language)}</th>
              <th className="text-start py-1.5 px-1 font-bold">{t('البيانات', 'Data', language)}</th>
              <th className="text-start py-1.5 px-1 font-bold">{t('المشكلة', 'Problem', language)}</th>
              <th className="text-start py-1.5 px-1 font-bold">{t('إجراءات', 'Actions', language)}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isReady = row.errors.length === 0;
              const isExpanded = expandedRows.has(row.rowIndex);
              return (
                <React.Fragment key={row.rowIndex}>
                  <tr className="border-b border-red-100/60 align-top">
                    <td className="py-1.5 px-1"><input type="checkbox" checked={getSelection(row) === 'INCLUDED'} onChange={(e) => (e.target.checked ? handleReincludeRow(row.rowIndex) : handleExcludeRow(row.rowIndex))} /></td>
                    <td className="py-1.5 px-1 font-mono font-bold text-slate-700">
                      <button type="button" onClick={() => toggleExpandRow(row.rowIndex)} className="me-1 px-1 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer">{isExpanded ? '−' : '+'}</button>
                      #{row.rowIndex}
                    </td>
                    <td className="py-1.5 px-1 text-slate-700">{row.date} · {row.millTypeRaw} · {row.materialTypeRaw} · {row.totalTons} {t('طن', 'tons', language)}{isReady && <span className="ms-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-300">{t('جاهز', 'Ready', language)}</span>}</td>
                    <td className="py-1.5 px-1 text-red-700">
                      {row.approved && (
                        <div className="mb-1 flex items-center gap-1">
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded border bg-sky-100 text-sky-800 border-sky-300">{t('معتمد', 'APPROVED', language)}</span>
                        </div>
                      )}
                      {row.readyToImport && (
                        <div className="mb-1 flex items-center gap-1">
                          <span className="text-[10px] font-black px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-300">{t('جاهز للرفع', 'READY TO IMPORT', language)}</span>
                        </div>
                      )}
                      {row.errors.map((e, i) => <div key={i}>• {e}</div>)}
                    </td>
                    <td className="py-1.5 px-1">
                      <div className="flex items-center gap-1 flex-wrap">
                        {canEditPending && <button type="button" onClick={() => openEditRow(row.rowIndex)} className="px-1.5 py-1 bg-sky-50 text-sky-700 rounded cursor-pointer font-bold">{t('تعديل يدوي', 'Manual Edit', language)}</button>}
                        {canManageImport && (
                          row.approved
                            ? <button type="button" onClick={() => handleRevokeApproval(row.rowIndex)} className="px-1.5 py-1 bg-amber-50 text-amber-700 rounded cursor-pointer font-bold">{t('إلغاء الاعتماد', 'Revoke Approval', language)}</button>
                            : <button type="button" disabled={isNonOverridableBlockingCondition(row)} onClick={() => handleApproveRow(row.rowIndex, 'INDIVIDUAL')} className="px-1.5 py-1 bg-sky-50 text-sky-700 rounded cursor-pointer font-bold disabled:opacity-40 disabled:cursor-not-allowed">{t('اعتماد', 'Approve', language)}</button>
                        )}
                        {canManageImport && (row.readyToImport
                          ? <button type="button" onClick={() => handleUndoReady(row.rowIndex)} className="px-1.5 py-1 bg-amber-50 text-amber-700 rounded cursor-pointer font-bold">{t('إلغاء الجاهزية', 'Undo Ready', language)}</button>
                          : <button type="button" disabled={!canMarkReadyToImport(row)} onClick={() => handleMarkRowReady(row.rowIndex)} className="px-1.5 py-1 bg-emerald-50 text-emerald-700 rounded cursor-pointer font-bold disabled:opacity-40 disabled:cursor-not-allowed">{getSelection(row) === 'EXCLUDED' ? t('إعادة إدراج وجاهز للرفع', 'Reinclude and Mark Ready', language) : t('جاهز للرفع', 'Mark Ready', language)}</button>
                        )}
                        {getSelection(row) !== 'EXCLUDED' && (
                          <>
                            <button type="button" onClick={() => handleExcludeRow(row.rowIndex, 'SKIPPED_ROW')} className="px-1.5 py-1 bg-slate-100 text-slate-600 rounded cursor-pointer font-bold">{t('تخطي السجل', 'Skip Row', language)}</button>
                            <button type="button" onClick={() => handleExcludeRow(row.rowIndex, 'EXCLUDED_ROW')} className="px-1.5 py-1 bg-slate-100 text-slate-600 rounded cursor-pointer font-bold">{t('استبعاد السجل', 'Exclude Row', language)}</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && <tr className="border-b border-red-100/60 bg-white"><td colSpan={5} className="p-3">{renderRowDetail(row)}</td></tr>}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={5} className="text-center py-6 text-slate-400 text-xs">{t('لا توجد سجلات.', 'No records.', language)}</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  /**
   * §11/Error Explanation: Problem/Field/Current Value/Reason/Suggested
   * Solution/Actions for the specific unresolved concern(s) this row has -
   * Mill, single Material, Mixture components, or Bunkers - shown inline in
   * the expandable row detail rather than a separate popup per field, so
   * multiple problems in one row (§20) can all be resolved without
   * repeated reopen/close steps.
   */
  function renderRowDetail(row: TubeBallMillsImportRow) {
    return (
      <div className="space-y-2 text-[11px]">
        {/* §I/§24: a derived Tons/Hour is NEVER silent - always shown distinctly from a source-provided value. */}
        {row.tonsPerHourDerived && (
          <div className="p-2 bg-sky-50 border border-sky-200 rounded-lg text-sky-800">
            {t(`الطن بالساعة (${row.tonsPerHour}) محسوب تلقائيًا من الإجمالي ÷ الساعات - لم يرد في الملف المصدر.`, `Tons/Hour (${row.tonsPerHour}) was automatically derived from Total ÷ Hours - not provided in the source file.`, language)}
          </div>
        )}
        {!row.resolvedMillId && row.millTypeRaw && (
          <div className="p-2 bg-red-50 border border-red-200 rounded-lg space-y-1">
            <div className="font-bold text-red-800">{t('المشكلة: نوع الطاحونة غير موجود في البيانات الأساسية.', 'Problem: Mill Type not found in Master Data.', language)}</div>
            <div className="text-slate-600">{t('القيمة الحالية', 'Current Value', language)}: {row.millTypeRaw}</div>
            {row.suggestedMillId && (
              <div className="p-1.5 bg-sky-50 border border-sky-200 rounded-lg flex items-center justify-between gap-2">
                <span className="text-sky-800">{t('اقتراح مطابق', 'Suggested Match', language)}: {row.suggestedMillName} ({row.suggestedMillConfidence}%)</span>
                {canEditPending && <button type="button" onClick={() => useMillSuggestion(row.rowIndex, row)} className="px-2 py-1 bg-sky-600 text-white rounded cursor-pointer shrink-0">{t('استخدام الاقتراح', 'Use Suggestion', language)}</button>}
              </div>
            )}
          </div>
        )}
        {row.isMixture && row.mixtureComponents && (
          <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
            <div className="font-bold text-slate-800">{t(`مكونات الخلطة (الإجمالي: ${row.mixtureTotalQuantityKg} كجم)`, `Mixture Components (Total: ${row.mixtureTotalQuantityKg} kg)`, language)}</div>
            {row.mixtureComponents.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-32 truncate">{c.materialNameRaw}</span>
                <span className="w-16 text-end font-mono">{c.quantityKg} {t('كجم', 'kg', language)}</span>
                <span className="w-14 text-end font-mono">{c.percentage}%</span>
                {c.resolvedMaterialId ? (
                  <span className="text-emerald-700 font-bold">{c.resolvedMaterialName}</span>
                ) : (
                  <div className="flex-1 max-w-xs"><SearchableCombobox options={materials} value={undefined} onChange={(_, opt) => applyMixtureComponentSelection(row.rowIndex, i, opt)} placeholder={t('اختر خامة موجودة...', 'Choose existing material...', language)} /></div>
                )}
              </div>
            ))}
            {row.suggestedMixtureProductId && !row.resolvedMixtureProductId && (
              <div className="p-2 bg-sky-50 border border-sky-200 rounded-lg flex items-center justify-between">
                <span className="text-sky-800">{t('الحل المقترح', 'Suggested Solution', language)}: {row.suggestedMixtureProductName}</span>
                {canEditPending && <button type="button" onClick={() => acceptSuggestedMixture(row.rowIndex)} className="px-2 py-1 bg-sky-600 text-white rounded cursor-pointer">{t('استخدام الحل المقترح', 'Apply Suggested Solution', language)}</button>}
              </div>
            )}
            {!row.resolvedMixtureProductId && !row.suggestedMixtureProductId && row.mixtureComponents.every((c) => c.resolvedMaterialId) && canAddMasterData && (
              <button type="button" onClick={() => createMixtureFromRow(row.rowIndex)} className="px-2 py-1 bg-emerald-600 text-white rounded cursor-pointer">{t('إنشاء خلطة/BOM جديدة', 'Create New Mixture/BOM', language)}</button>
            )}
            {row.resolvedMixtureProductId && <div className="text-emerald-700 font-bold">{t('الخلطة المستخدمة', 'Mixture in use', language)}: {row.resolvedMixtureProductName}</div>}
          </div>
        )}
        {!row.isMixture && row.detectedAluminaPercentage !== undefined && (
          <div className="p-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700">
            <span className="font-bold">{t('الألومينا', 'Alumina', language)}</span>: {row.detectedAluminaPercentage}%
          </div>
        )}
        {!row.isMixture && !row.resolvedMaterialId && row.materialTypeRaw && (
          <div className="p-2 bg-red-50 border border-red-200 rounded-lg space-y-1">
            <div className="font-bold text-red-800">{t('المشكلة: الخامة غير موجودة في البيانات الأساسية.', 'Problem: Material not found in Master Data.', language)}</div>
            <div className="text-slate-600">{t('القيمة الحالية', 'Current Value', language)}: {row.materialTypeRaw}</div>
            {row.suggestedMaterialId && (
              <div className="p-1.5 bg-sky-50 border border-sky-200 rounded-lg flex items-center justify-between gap-2">
                <span className="text-sky-800">{t('اقتراح مطابق', 'Suggested Match', language)}: {row.suggestedMaterialName} ({row.suggestedMaterialConfidence}%)</span>
                {canEditPending && <button type="button" onClick={() => useMaterialSuggestion(row.rowIndex, row)} className="px-2 py-1 bg-sky-600 text-white rounded cursor-pointer shrink-0">{t('استخدام الاقتراح', 'Use Suggestion', language)}</button>}
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 flex-wrap">
              <div className="max-w-xs"><SearchableCombobox options={materials} value={row.resolvedMaterialId} onChange={(_, opt) => applyMaterialSelection(row.rowIndex, opt)} placeholder={t('اختر خامة موجودة...', 'Choose existing material...', language)} /></div>
              {canAddMasterData && <button type="button" onClick={() => { setCodeNewTarget({ mode: 'ROW', rowIndex: row.rowIndex, domain: 'material' }); setCodeNewForm({ code: '', name: row.materialTypeRaw }); }} className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded cursor-pointer font-bold shrink-0">{t('ترميز خامة جديدة', 'Code New Material', language)}</button>}
            </div>
          </div>
        )}
        {!row.resolvedMillId && row.millTypeRaw && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="max-w-xs"><SearchableCombobox options={mills} value={row.resolvedMillId} onChange={(_, opt) => applyMillSelection(row.rowIndex, opt)} placeholder={t('اختر طاحونة موجودة...', 'Choose existing mill...', language)} /></div>
            {canAddMasterData && <button type="button" onClick={() => { setCodeNewTarget({ mode: 'ROW', rowIndex: row.rowIndex, domain: 'mill' }); setCodeNewForm({ code: '', name: row.millTypeRaw }); }} className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded cursor-pointer font-bold shrink-0">{t('ترميز طاحونة جديدة', 'Code New Mill', language)}</button>}
          </div>
        )}
        {row.bunkerAllocations.length > 0 && (() => {
          const allocated = row.bunkerAllocations.reduce((a, b) => a + (Number(b.allocatedTons) || 0), 0);
          const remaining = Math.round((row.totalTons - allocated) * 100) / 100;
          return (
            <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
              <div className="font-bold text-slate-800 flex items-center gap-3 flex-wrap">
                <span>{t('توزيع البناكر', 'Bunker Allocation', language)} {row.bunkerAllocationValid ? <span className="text-emerald-700">✓</span> : <span className="text-red-700">{t('لا يساوي الإجمالي', '≠ Total', language)}</span>}</span>
                <span className="text-[10px] font-mono text-slate-500 flex items-center gap-2">
                  <span>{t('المخصص', 'Allocated', language)}: {allocated}</span>
                  <span>{t('الإجمالي', 'Total', language)}: {row.totalTons}</span>
                  <span className={remaining === 0 ? 'text-emerald-700' : 'text-red-700'}>{t('المتبقي', 'Remaining', language)}: {remaining}</span>
                </span>
              </div>
              {row.bunkerAllocations.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-20 font-mono">{b.bunkerRaw}</span>
                  {b.resolvedBunkerId ? (
                    <span className="text-emerald-700 font-bold w-32 truncate">{b.resolvedBunkerName}</span>
                  ) : (
                    <>
                      <div className="w-40"><SearchableCombobox options={bunkers} value={undefined} onChange={(_, opt) => applyBunkerSelection(row.rowIndex, i, opt)} placeholder={t('اختر بنكر...', 'Choose bunker...', language)} /></div>
                      {canAddMasterData && <button type="button" onClick={() => { setCodeNewTarget({ mode: 'ROW', rowIndex: row.rowIndex, domain: 'bunker', bunkerIndex: i }); setCodeNewForm({ code: '', name: b.bunkerRaw }); }} className="px-1.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded cursor-pointer font-bold text-[10px] shrink-0">{t('ترميز بنكر جديد', 'Code New Bunker', language)}</button>}
                    </>
                  )}
                  <input type="number" value={b.allocatedTons} onChange={(e) => applyBunkerAllocationEdit(row.rowIndex, i, Number(e.target.value))} className="w-24 px-2 py-1 border border-slate-300 rounded text-end font-mono" />
                  <span className="text-slate-400">{t('طن', 'tons', language)}</span>
                </div>
              ))}
            </div>
          );
        })()}
        {row.resolutionHistory && row.resolutionHistory.length > 0 && (
          <div className="text-slate-400">{t('السجل', 'History', language)}: {row.resolutionHistory.map((h) => h.summary).join(' | ')}</div>
        )}
      </div>
    );
  }

  /**
   * §19/§27-28: Edit Row - consolidated multi-field correction (Date/Mill/
   * Material/Hours/Tons-per-Hour/Bunkers/Total) with "Save & Revalidate"
   * (§20), rather than four separate single-purpose Mill/Material/Mixture/
   * Bunker coding popups. This is a deliberate reuse of Chinese Mills' own
   * proven pattern (ONE edit modal, full-row revalidation on save) - §4 of
   * this task explicitly asks to reuse existing modal patterns rather than
   * proliferate near-identical ones, and §20 explicitly asks to avoid
   * "unnecessary repeated reopen/close steps" for a row with multiple
   * problems. Mill/Material/Bunker dropdown pickers and mixture-component
   * resolution are handled inline in the expandable row detail
   * (renderRowDetail) for problems that don't require retyping the whole
   * row - both paths trigger the SAME revalidateTubeBallMillsRowFields.
   */
  function renderEditRowModal() {
    if (!editRowState || !editDraft) return null;
    // Gap-fix §11: a live preview of what Save & Revalidate would produce,
    // reusing the SAME revalidateTubeBallMillsRowFields the actual save
    // already calls - never a second/divergent validation path, just shown
    // earlier (on every keystroke) instead of only after saving.
    const editRow = summary?.rows.find((r) => r.rowIndex === editRowState.rowIndex);
    const preview = revalidateTubeBallMillsRowFields(editDraft as any, masterDataBundle, approvedMappings, language, manualOverrides, {}, editRow?.bunkerAllocations);
    return (
      <Modal isOpen onClose={() => setEditRowState(null)} title={t('تعديل يدوي للصف', 'Manual Row Edit', language)} maxWidth="lg">
        <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
          {[
            { key: 'date', label: t('التاريخ', 'Date', language) },
            { key: 'millTypeRaw', label: t('نوع الطاحونة', 'Mill Type', language) },
            { key: 'materialTypeRaw', label: t('نوع الخامة', 'Material Type', language) },
            { key: 'hoursRaw', label: t('عدد الساعات', 'Hours', language) },
            { key: 'tonsPerHourRaw', label: t('الطن بالساعه', 'Tons Per Hour', language) },
            { key: 'storageBunkersRaw', label: t('بناكر التخزين', 'Storage Bunkers', language) },
            { key: 'totalRaw', label: t('الإجمالي', 'Total', language) },
          ].map((f) => (
            <div key={f.key}>
              <label className="block text-[11px] font-bold text-slate-600 mb-1">{f.label}</label>
              <input type="text" value={editDraft[f.key] || ''} onChange={(e) => setEditDraft({ ...editDraft, [f.key]: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
            </div>
          ))}
          {(preview.errors.length > 0 || preview.warnings.length > 0) && (
            <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-[11px] space-y-0.5">
              <div className="font-bold text-amber-900">{t('معاينة حية', 'Live Preview', language)}</div>
              {preview.errors.map((e, i) => <div key={`e${i}`} className="text-red-700">• {e}</div>)}
              {preview.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-700">• {w}</div>)}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setEditRowState(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
            <button type="button" onClick={saveEditRow} className="px-4 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer">{t('حفظ وإعادة التحقق', 'Save & Revalidate', language)}</button>
          </div>
        </div>
      </Modal>
    );
  }

  /** Gap-fix §1/§2/§7: the "Code New Mill/Material/Bunker" inline mini-form modal - a small code+name capture reusing the existing permission-gated/duplicate-checked/audited codeNewMasterDataItem, wired to submitCodeNew. */
  function renderCodeNewModal() {
    if (!codeNewTarget) return null;
    const titleAr = codeNewTarget.domain === 'mill' ? 'ترميز طاحونة جديدة' : codeNewTarget.domain === 'material' ? 'ترميز خامة جديدة' : 'ترميز بنكر جديد';
    const titleEn = codeNewTarget.domain === 'mill' ? 'Code New Mill' : codeNewTarget.domain === 'material' ? 'Code New Material' : 'Code New Bunker';
    return (
      <Modal isOpen onClose={() => setCodeNewTarget(null)} title={t(titleAr, titleEn, language)} maxWidth="sm">
        <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('الكود (اختياري)', 'Code (optional)', language)}</label>
            <input type="text" value={codeNewForm.code} onChange={(e) => setCodeNewForm({ ...codeNewForm, code: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-600 mb-1">{t('الاسم', 'Name', language)}</label>
            <input type="text" value={codeNewForm.name} onChange={(e) => setCodeNewForm({ ...codeNewForm, name: e.target.value })} className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg" />
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setCodeNewTarget(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
            <button type="button" onClick={submitCodeNew} className="px-4 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer">{t('إنشاء وربط', 'Create & Link', language)}</button>
          </div>
        </div>
      </Modal>
    );
  }

  /**
   * §3/§4/§15/§20: the dedicated Master Data Review Window - opens
   * automatically right after a full-file parse, before any row import.
   * Four tabs (Mill/Material/Mixture/Bunker), each showing the aggregated,
   * occurrence-counted groups from masterDataExtraction with Use
   * Suggestion/Choose Existing/Create New/Apply to All actions - every
   * action here calls applyGlobalResolution (or the mixture-level
   * equivalents), which propagate to every row sharing that raw value AND
   * never perform a Firestore write themselves (only Code New/Create BOM
   * create Master Data, explicitly gated on canAddMasterData, exactly like
   * the existing per-row actions).
   */
  function renderMasterDataReviewModal() {
    if (!showMasterDataReview || !summary) return null;
    const tabs: Array<{ key: MasterDataEntityGroupTab; labelAr: string; labelEn: string; groups: MasterDataEntityGroup[]; counts: { uniqueCount: number; resolvedCount: number; unresolvedCount: number } }> = [
      { key: 'mill', labelAr: 'الطواحين', labelEn: 'Mills', groups: masterDataExtraction.mills, counts: millGroupCounts },
      { key: 'material', labelAr: 'الخامات', labelEn: 'Materials', groups: masterDataExtraction.materials, counts: materialGroupCounts },
      { key: 'mixture', labelAr: 'خلطات BOM', labelEn: 'BOM Mixtures', groups: masterDataExtraction.mixtures, counts: mixtureGroupCounts },
      { key: 'bunker', labelAr: 'البناكر', labelEn: 'Bunkers', groups: masterDataExtraction.bunkers, counts: bunkerGroupCounts },
    ];
    const active = tabs.find((tb) => tb.key === masterDataReviewTab) || tabs[0];

    return (
      <Modal isOpen onClose={() => setShowMasterDataReview(false)} title={t('مراجعة البيانات الأساسية', 'Master Data Review', language)} maxWidth="4xl">
        <div className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
          {/* §15: Master-Data Review Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px]">
            <div><span className="font-bold text-slate-500 block">{t('إجمالي الصفوف', 'Total Rows', language)}</span><span className="text-sm font-black text-slate-800">{summary.totalRows}</span></div>
            <div><span className="font-bold text-slate-500 block">{t('جاهزة', 'Ready', language)}</span><span className="text-sm font-black text-emerald-700">{selectionCounts.willImport}</span></div>
            <div><span className="font-bold text-slate-500 block">{t('مانعة', 'Blocking', language)}</span><span className="text-sm font-black text-red-700">{selectionCounts.blocking}</span></div>
            <div><span className="font-bold text-slate-500 block">{t('محدد', 'Selected', language)}</span><span className="text-sm font-black text-slate-800">{selectionCounts.selected}</span></div>
            <div><span className="font-bold text-slate-500 block">{t('مستبعد/متخطى', 'Excluded/Skipped', language)}</span><span className="text-sm font-black text-slate-800">{selectionCounts.excluded}</span></div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {tabs.map((tb) => (
              <button
                key={tb.key}
                type="button"
                onClick={() => setMasterDataReviewTab(tb.key)}
                className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${masterDataReviewTab === tb.key ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {t(tb.labelAr, tb.labelEn, language)} ({tb.counts.resolvedCount}/{tb.counts.uniqueCount})
              </button>
            ))}
          </div>
          <div className="max-h-[55vh] overflow-y-auto border border-slate-100 rounded-xl p-2">
            {active.key === 'mixture' ? renderMixtureGroupTable(active.groups) : renderEntityGroupTable(active.key as 'mill' | 'material' | 'bunker', active.groups)}
          </div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button type="button" onClick={() => setShowMasterDataReview(false)} className="px-4 py-2 text-xs font-black text-white bg-violet-600 hover:bg-violet-700 rounded-lg cursor-pointer">{t('إغلاق ومتابعة المراجعة', 'Close & Continue Review', language)}</button>
          </div>
        </div>
      </Modal>
    );
  }

  /** §4/§5/§6/§17: Mill/Material/Bunker aggregated resolution table - one row per distinct value, occurrence count, existing-suggestion, dropdown for Choose Existing, Use Suggestion/Create New (permission-gated) Apply-to-All actions (every action here IS "apply to all" by construction - see applyGlobalResolution). */
  function renderEntityGroupTable(domain: 'mill' | 'material' | 'bunker', groups: MasterDataEntityGroup[]) {
    const options = domain === 'mill' ? mills : domain === 'material' ? materials : bunkers;
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[11px] min-w-[820px]">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr className="text-slate-500 border-b border-slate-200">
              <th className="text-start py-1.5 px-2 font-bold">{t('القيمة الأصلية', 'Original Value', language)}</th>
              <th className="text-end py-1.5 px-2 font-bold">{t('التكرار', 'Occurrences', language)}</th>
              <th className="text-start py-1.5 px-2 font-bold">{t('المقترح', 'Suggested', language)}</th>
              <th className="text-start py-1.5 px-2 font-bold">{t('المحدد', 'Selected', language)}</th>
              <th className="text-start py-1.5 px-2 font-bold">{t('الحالة', 'Status', language)}</th>
              <th className="text-start py-1.5 px-2 font-bold">{t('إجراءات', 'Action', language)}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.originalValue} className="border-b border-slate-100 align-top hover:bg-slate-50/40">
                <td className="py-1.5 px-2 font-bold text-slate-800">{g.originalValue}</td>
                <td className="py-1.5 px-2 text-end font-mono text-slate-600">{g.occurrences}</td>
                <td className="py-1.5 px-2">
                  {g.suggestedId ? <span className="text-sky-700">{g.suggestedName} {g.suggestedConfidence !== undefined ? `(${g.suggestedConfidence}%)` : ''}</span> : <span className="text-slate-300">—</span>}
                </td>
                <td className="py-1.5 px-2">
                  {g.resolved ? (
                    <span className="text-emerald-700 font-bold">{g.resolvedName}{g.resolvedCode ? ` (${g.resolvedCode})` : ''}</span>
                  ) : (
                    <div className="w-40"><SearchableCombobox options={options} value={undefined} onChange={(_, opt) => opt && applyGlobalResolution(domain, g.originalValue, { id: opt.id, code: opt.code, name: opt.name })} placeholder={t('اختر موجود...', 'Choose existing...', language)} /></div>
                  )}
                </td>
                <td className="py-1.5 px-2">
                  {g.resolved
                    ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-300">{t('محلول', 'Resolved', language)}</span>
                    : <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-red-100 text-red-800 border-red-300">{t('غير محلول', 'Unresolved', language)}</span>}
                </td>
                <td className="py-1.5 px-2">
                  {!g.resolved && (
                    <div className="flex items-center gap-1 flex-wrap">
                      {g.suggestedId && <button type="button" onClick={() => applyGlobalResolution(domain, g.originalValue, { id: g.suggestedId!, code: g.suggestedCode || '', name: g.suggestedName || '' }, 'SUGGESTION_ACCEPTED')} className="px-1.5 py-1 bg-sky-600 text-white rounded cursor-pointer font-bold">{t('استخدام الاقتراح', 'Use Suggestion', language)}</button>}
                      {canAddMasterData && <button type="button" onClick={() => { setCodeNewTarget({ mode: 'GLOBAL', domain, rawValue: g.originalValue }); setCodeNewForm({ code: '', name: g.originalValue }); }} className="px-1.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded cursor-pointer font-bold">{t('إنشاء جديد', 'Create New', language)}</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {groups.length === 0 && <tr><td colSpan={6} className="text-center py-4 text-slate-400 text-xs">{t('لا توجد قيم لهذا النوع.', 'No values for this type.', language)}</td></tr>}
          </tbody>
        </table>
      </div>
    );
  }

  /** §9/§10/§11/§13: BOM Mixtures aggregated table - one entry per distinct raw mixture string, expandable to the full BOM component table (نسبة الخامة بالخلطة/كود الخامة/إسم الخامة/السعر/الإجمالي), Use Suggested BOM / Choose Existing BOM / Create New BOM actions. */
  function renderMixtureGroupTable(groups: MasterDataEntityGroup[]) {
    return (
      <div className="space-y-2">
        {groups.map((g) => {
          const sampleRow = summary?.rows.find((r) => r.rowIndex === g.rowIndexes[0]);
          const isExpanded = expandedMixtureGroups.has(g.originalValue);
          const allComponentsResolved = !!sampleRow?.mixtureComponents?.every((c) => c.resolvedMaterialId);
          return (
            <div key={g.originalValue} className="border border-slate-200 rounded-xl p-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <button type="button" onClick={() => setExpandedMixtureGroups((prev) => { const next = new Set(prev); if (next.has(g.originalValue)) next.delete(g.originalValue); else next.add(g.originalValue); return next; })} className="px-1.5 py-1 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer font-bold shrink-0">{isExpanded ? '−' : '+'}</button>
                  <span className="font-bold text-slate-800 truncate">{g.originalValue}</span>
                  <span className="text-[10px] text-slate-500 shrink-0">{t('تكرار', 'occ.', language)}: {g.occurrences}</span>
                  {sampleRow?.mixtureTotalQuantityKg !== undefined && <span className="text-[10px] text-slate-500 shrink-0">{sampleRow.mixtureTotalQuantityKg} {t('كجم', 'kg', language)}</span>}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {g.resolved ? (
                    <span className="text-[10px] font-black px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-300">{t('خلطات BOM — محلول', 'BOM Mixture — Resolved', language)}: {g.resolvedName}</span>
                  ) : (
                    <>
                      {g.suggestedId && <button type="button" onClick={() => acceptSuggestedMixture(g.rowIndexes[0])} className="px-1.5 py-1 bg-sky-600 text-white rounded cursor-pointer font-bold">{t('استخدام الخلطة المقترحة', 'Use Suggested BOM', language)}</button>}
                      <div className="w-44"><SearchableCombobox options={mixtures.map((m) => ({ id: m.id, code: m.code, name: m.name }))} value={undefined} onChange={(_, opt) => chooseExistingMixtureGlobal(g.originalValue, opt)} placeholder={t('اختر خلطة موجودة...', 'Choose existing BOM...', language)} /></div>
                      {canAddMasterData && <button type="button" disabled={!allComponentsResolved} onClick={() => createMixtureFromRow(g.rowIndexes[0])} className="px-1.5 py-1 bg-emerald-600 text-white rounded cursor-pointer font-bold disabled:opacity-40 disabled:cursor-not-allowed">{t('إنشاء خلطة BOM جديدة', 'Create New BOM', language)}</button>}
                    </>
                  )}
                </div>
              </div>
              {isExpanded && sampleRow?.mixtureComponents && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] min-w-[560px]">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-200">
                        <th className="text-start py-1 px-1 font-bold">{t('نسبة الخامة بالخلطة', '% in Mixture', language)}</th>
                        <th className="text-start py-1 px-1 font-bold">{t('كود الخامة', 'Material Code', language)}</th>
                        <th className="text-start py-1 px-1 font-bold">{t('إسم الخامة', 'Material Name', language)}</th>
                        <th className="text-start py-1 px-1 font-bold">{t('السعر', 'Price', language)}</th>
                        <th className="text-end py-1 px-1 font-bold">{t('الإجمالي', 'Total', language)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleRow.mixtureComponents.map((c, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-1 px-1 font-mono">{c.percentage.toFixed(1)}%</td>
                          <td className="py-1 px-1">{c.resolvedMaterialCode || <span className="text-red-600">—</span>}</td>
                          <td className="py-1 px-1">
                            {c.resolvedMaterialId ? (
                              <span className="text-emerald-700 font-bold">{c.resolvedMaterialName}</span>
                            ) : (
                              <div className="w-36"><SearchableCombobox options={materials} value={undefined} onChange={(_, opt) => opt && applyGlobalResolution('material', c.materialNameRaw, { id: opt.id, code: opt.code, name: opt.name })} placeholder={t('اختر خامة...', 'Choose material...', language)} /></div>
                            )}
                          </td>
                          <td className="py-1 px-1 text-slate-300">—</td>
                          <td className="py-1 px-1 text-end font-mono">{c.quantityKg} {t('كجم', 'kg', language)}</td>
                        </tr>
                      ))}
                      <tr className="font-bold text-slate-800">
                        <td className="py-1 px-1">100.0%</td>
                        <td className="py-1 px-1"></td>
                        <td className="py-1 px-1"></td>
                        <td className="py-1 px-1"></td>
                        <td className="py-1 px-1 text-end font-mono">{sampleRow.mixtureTotalQuantityKg} {t('كجم', 'kg', language)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && <p className="text-center py-4 text-slate-400 text-xs">{t('لا توجد خلطات في هذا الملف.', 'No mixtures in this file.', language)}</p>}
      </div>
    );
  }

  function renderHistoryModal() {
    return (
      <>
        {showHistoryModal && (
          <Modal isOpen onClose={() => setShowHistoryModal(false)} title={t('سجل عمليات الرفع التاريخية - الطواحين الأنبوبية والكرات', 'Historical Import History - Tube/Ball Mills', language)} maxWidth="4xl">
            <div className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
              {historyErrors.auditTrailError && <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2.5">{t('تعذّر قراءة بيانات السجل الكاملة - يتم عرض بيانات محدودة من سجل التدقيق.', 'Could not read the full history store - showing limited data from the audit trail.', language)}</div>}
              {isLoadingHistory ? (
                <div className="p-8 text-center text-slate-500 flex flex-col items-center gap-2"><Loader2 className="w-6 h-6 animate-spin" />{t('جاري تحميل السجل...', 'Loading history...', language)}</div>
              ) : importHistory.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500"><FileSpreadsheet className="w-8 h-8 mx-auto mb-2" />{t('لا توجد عمليات استيراد سابقة مسجلة.', 'No historical import operations recorded yet.', language)}</div>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {importHistory.map((h) => {
                    const status = deriveImportFinalStatus(h as any);
                    return (
                      <div key={h.importBatchId} className="p-3 flex items-center justify-between gap-3 hover:bg-slate-50">
                        <div>
                          <div className="font-mono text-[11px] font-bold text-slate-800">{h.importBatchId}</div>
                          <div className="text-[10px] text-slate-500">{h.performedAt ? new Date(h.performedAt).toLocaleString() : '-'} · {h.performedByName || t('غير معروف', 'unknown', language)} · {status}</div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button type="button" onClick={() => openHistoryDetail(h)} className="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-md cursor-pointer font-bold text-[11px]">{t('عرض التفاصيل', 'View Details', language)}</button>
                          {canDeletePermanently && <button type="button" onClick={() => openRollbackConfirm(h)} className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-700 rounded-md cursor-pointer font-bold text-[11px] flex items-center gap-1"><RotateCcw className="w-3 h-3" />{t('حذف', 'Delete', language)}</button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="flex justify-end pt-2 border-t border-slate-100"><button type="button" onClick={() => setShowHistoryModal(false)} className="px-4 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إغلاق', 'Close', language)}</button></div>
            </div>
          </Modal>
        )}

        {historyDetail && (
          <Modal isOpen onClose={() => { setHistoryDetail(null); setHistoryDetailRows(null); }} title={t('تفاصيل عملية الرفع', 'Import Details', language)} subtitle={historyDetail.importBatchId} maxWidth="2xl">
            <div className="space-y-3 text-[11px]" dir={isRtl ? 'rtl' : 'ltr'}>
              <div>{t('الإجمالي', 'Total', language)}: {historyDetail.totalRows} · {t('تم الاستيراد', 'Imported', language)}: {historyDetail.importedCount} · {t('فشل', 'Failed', language)}: {historyDetail.failedCount}</div>
              {isLoadingHistory === false && historyDetailRows === null ? (
                <div className="text-slate-400">{t('جاري التحميل...', 'Loading...', language)}</div>
              ) : (
                <div className="max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-[10px]">
                    <thead className="bg-slate-50 sticky top-0"><tr><th className="p-1.5 text-start">{t('التاريخ', 'Date', language)}</th><th className="p-1.5 text-start">{t('الطاحونة', 'Mill', language)}</th><th className="p-1.5 text-start">{t('الخامة', 'Material', language)}</th><th className="p-1.5 text-end">{t('الإجمالي', 'Total', language)}</th></tr></thead>
                    <tbody>{(historyDetailRows || []).map((r: any) => <tr key={r.id} className="border-t border-slate-100"><td className="p-1.5">{r.date}</td><td className="p-1.5">{r.millType}</td><td className="p-1.5">{r.materialName || r.rawMaterialType}</td><td className="p-1.5 text-end">{r.totalTons}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
              <div className="flex justify-end"><button type="button" onClick={() => { setHistoryDetail(null); setHistoryDetailRows(null); }} className="px-4 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إغلاق', 'Close', language)}</button></div>
            </div>
          </Modal>
        )}

        {rollbackTarget && (
          <Modal isOpen onClose={() => { setRollbackTarget(null); setRollbackMessage(null); }} title={t('تأكيد حذف عملية الرفع', 'Confirm Delete Import', language)} maxWidth="sm">
            <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
              {!rollbackMessage ? (
                <>
                  <p className="text-slate-800">{t(`سيتم حذف السجلات المرتبطة بعملية الرفع ${rollbackTarget.importBatchId} وعددها ${rollbackTarget.importedCount} سجلًا. هذا الإجراء قد يؤثر على بيانات إنتاجية فعلية. هل تريد المتابعة؟`, `This will delete ${rollbackTarget.importedCount} records associated with import ${rollbackTarget.importBatchId}. This may affect actual production data. Continue?`, language)}</p>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    <button type="button" onClick={() => setRollbackTarget(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
                    <button type="button" onClick={confirmRollback} className="px-4 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer">{t('حذف', 'Delete', language)}</button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-slate-800">{rollbackMessage}</p>
                  <div className="flex justify-end"><button type="button" onClick={() => { setRollbackTarget(null); setRollbackMessage(null); }} className="px-4 py-2 text-xs font-bold text-white bg-slate-700 hover:bg-slate-800 rounded-lg cursor-pointer">{t('إغلاق', 'Close', language)}</button></div>
                </>
              )}
            </div>
          </Modal>
        )}
      </>
    );
  }
};

function getTubeBallMillsImportHeadersDisplay(language: 'ar' | 'en'): string {
  return language === 'ar'
    ? 'التاريخ، نوع الطاحونة، نوع الخامة، عدد الساعات، الطن بالساعه، بناكر التخزين، الإجمالي'
    : 'Date, Mill Type, Material Type, Hours, Tons Per Hour, Storage Bunkers, Total';
}

/**
 * Chinese Mills Historical Import - dedicated stage-specific smart-import
 * screen, mounted by DataImportView.tsx only when selectedStage ===
 * 'chinese_mills'. Gives Chinese Mills the SAME generic capabilities as the
 * Pressing importer (exact/normalized/fuzzy matching, mapping propagation,
 * manual select/edit/add/skip, full-row-edit, partial import, excluded-row
 * repair, bulk "Add All Master Data", warning override, audit) built on the
 * shared engines (fuzzyMatching.ts, businessValidationRules.ts,
 * importMappingService.ts) - never Pressing's own row shape or its
 * Furnace-Car-only concepts.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  UploadCloud,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Trash2,
  Edit3,
  X,
  Plus,
  Search,
  ShieldCheck,
  History,
  Ban,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Customer, Product, ChineseMillsImportRow, ChineseMillsImportSummary } from '../../types';
import { loadApprovedMappings } from '../../services/importMappingService';
import { logAuditAction } from '../../services/auditService';
import {
  downloadChineseMillsExcelTemplate,
  parseAndValidateChineseMillsExcel,
  executeChineseMillsBatchImport,
  revalidateChineseMillsRowFields,
  registerManualOverride,
  isChineseMillsRowWritable,
  createCustomerFromImport,
  createChineseMillFromImport,
  createFaultTypeFromImport,
  createProductFromImport,
  applyCustomerCodeUpdate,
  fetchMasterDataSafe,
  describeMasterDataLoadError,
  isPermissionDeniedError,
  recheckDatabaseDuplicates,
  CHINESE_MILLS_MASTER_COLLECTION,
  FAULT_TYPES_COLLECTION,
  ManualOverrideMap,
  MasterDataDomain,
  MasterDataLoadError,
} from '../../services/chineseMillsHistoricalImportService';
import { createDatabaseBackup } from '../../services/backupService';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { SearchableCombobox, ComboboxOption } from '../common/SearchableCombobox';
import { BatchAddMasterDataModal, MissingEntityItem } from './BatchAddMasterDataModal';
import { normalizeArabicForComparison } from '../../utils/fuzzyMatching';
import {
  computeBulkSelectionOutcome,
  computeSelectionCounts,
  matchesValid,
  matchesReady,
  matchesCorrected,
  matchesInvalidNeedsReview,
  matchesApproved,
  isNonOverridableBlockingCondition,
  BulkSelectionMode,
} from '../../services/chineseMillsSelectionPure';
import { ChineseMillsDraft, SaveDraftOutcome, saveDraft, getDraft, deleteDraft, logDraftOpened } from '../../services/chineseMillsDraftStorage';

type FilterTab = 'ALL' | 'VALID' | 'WARNING' | 'ERROR' | 'DUPLICATE' | 'EXCLUDED';
type EntityListItem = { id?: string; code?: string; name?: string };

function t(ar: string, en: string, language: 'ar' | 'en'): string {
  return language === 'ar' ? ar : en;
}

/** §20: turns any caught error into a clean, bilingual message - never the raw Firestore/JSON text. Logs the technical detail to console for diagnostics. */
function cleanErrorMessage(err: unknown, language: 'ar' | 'en', context: string): string {
  console.error(`[ChineseMillsImport] ${context}:`, err);
  if (isPermissionDeniedError(err)) {
    return t('تم رفض الوصول - لا تملك الصلاحية اللازمة لهذا الإجراء.', 'Permission denied - you do not have the required permission for this action.', language);
  }
  return t('حدث خطأ غير متوقع. حاول مرة أخرى.', 'An unexpected error occurred. Please try again.', language);
}

function extractFieldsFromRow(row: ChineseMillsImportRow) {
  return {
    date: row.date,
    customerNameRaw: row.customerNameRaw,
    customerCodeRaw: row.customerCodeRaw,
    specificationCodeRaw: row.specificationCodeRaw,
    millTypeRaw: row.millTypeRaw,
    shiftRaw: String(row.shiftRaw ?? ''),
    productionQuantityRaw: String(row.productionQuantity || ''),
    numberOfBagsRaw: String(row.numberOfBags || ''),
    rejectedQuantityRaw: String(row.rejectedQuantity || ''),
    operatingMinutesRaw: String(row.operatingMinutes || ''),
    operatingHoursRaw: String(row.operatingHours || ''),
    downtimeHoursRaw: String(row.downtimeHours || ''),
    faultTypeRaw: row.faultTypeRaw || '',
    specification: row.specification || '',
    weightClassRaw: row.weightClassKg !== undefined ? String(row.weightClassKg) : '',
    theoreticalRateRaw: row.theoreticalRate !== undefined ? String(row.theoreticalRate) : '',
    actualRateRaw: row.actualRateImported !== undefined ? String(row.actualRateImported) : '',
    notes: row.notes || '',
  };
}

function recomputeSummaryCounts(rows: ChineseMillsImportRow[]): Omit<ChineseMillsImportSummary, 'rows'> {
  let validRows = 0, warningRows = 0, errorRows = 0, duplicateRows = 0;
  let unknownCustomersCount = 0, unknownMillsCount = 0, unknownFaultTypesCount = 0, shiftErrorsCount = 0, bagWeightMismatchCount = 0, actualRateSuggestionsCount = 0;
  rows.forEach((r) => {
    if (r.isDuplicate) duplicateRows++;
    if (r.errors.length > 0) errorRows++;
    else if (r.warnings.length > 0) warningRows++;
    else validRows++;
    if (r.status === 'UNKNOWN_CUSTOMER') unknownCustomersCount++;
    if (r.status === 'UNKNOWN_MILL') unknownMillsCount++;
    if (r.status === 'UNKNOWN_FAULT_TYPE') unknownFaultTypesCount++;
    if (r.status === 'INVALID_SHIFT') shiftErrorsCount++;
    if (r.bagWeightMismatch) bagWeightMismatchCount++;
    if (r.actualRateDecision === 'PENDING') actualRateSuggestionsCount++;
  });
  return { totalRows: rows.length, validRows, warningRows, errorRows, duplicateRows, unknownCustomersCount, unknownMillsCount, unknownFaultTypesCount, shiftErrorsCount, bagWeightMismatchCount, actualRateSuggestionsCount };
}

const STATUS_LABELS: Record<string, { ar: string; en: string; cls: string }> = {
  VALID: { ar: 'صالح', en: 'Valid', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  WARNING: { ar: 'تحذير', en: 'Warning', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  DUPLICATE_IN_FILE: { ar: 'مكرر بالملف', en: 'Duplicate in File', cls: 'bg-red-100 text-red-800 border-red-300' },
  DUPLICATE_IN_DATABASE: { ar: 'موجود مسبقًا', en: 'Already in DB', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
  UNKNOWN_CUSTOMER: { ar: 'عميل غير معروف', en: 'Unknown Customer', cls: 'bg-red-100 text-red-800 border-red-300' },
  UNKNOWN_MILL: { ar: 'طاحونة غير معروفة', en: 'Unknown Mill', cls: 'bg-red-100 text-red-800 border-red-300' },
  UNKNOWN_FAULT_TYPE: { ar: 'نوع عطل غير معروف', en: 'Unknown Fault Type', cls: 'bg-red-100 text-red-800 border-red-300' },
  INVALID_SHIFT: { ar: 'وردية غير صالحة', en: 'Invalid Shift', cls: 'bg-red-100 text-red-800 border-red-300' },
  INVALID_DATE: { ar: 'تاريخ غير صالح', en: 'Invalid Date', cls: 'bg-red-100 text-red-800 border-red-300' },
  INVALID_ROW: { ar: 'صف غير صالح', en: 'Invalid Row', cls: 'bg-red-100 text-red-800 border-red-300' },
  NEW: { ar: 'جديد', en: 'New', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
};

export const ChineseMillsImportPanel: React.FC = () => {
  const { language, isRtl } = useLanguage();
  const { adminUser, isSuperAdmin, hasPermission, isLoading: authLoading, isAuthenticated } = useAuth();

  const canOverrideWarnings = isSuperAdmin || hasPermission('validation.overrideWarnings');
  const canAddMasterData = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    const perms = adminUser.permissions as Record<string, any> | undefined;
    return perms?.['masterData.inlineAdd'] === true || perms?.masterDataCreate === true || perms?.['masterdata.view'] === true;
  }, [adminUser, isSuperAdmin]);
  /**
   * Baseline READ access to Master Data (Customers/Chinese Mills/Fault
   * Types) - mirrors the SAME granular-permission category DataImportView.tsx
   * already uses for Master Data viewing (§2: reuse the existing category,
   * never a new per-collection permission). Firestore itself governs the
   * actual read (`isSignedIn()` for every Master Data collection, same as
   * every other one - see firestore.rules); this only decides whether the
   * UI should even attempt the request.
   */
  const canViewMasterData = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    if ((adminUser.permissions as Record<string, any> | undefined)?.['masterdata.view'] === true) return true;
    return canAddMasterData;
  }, [adminUser, isSuperAdmin, canAddMasterData]);
  /**
   * Part 14: reuse the EXISTING granular historical-import permission keys
   * (never a second permission architecture) - approve_matching already
   * means "review/edit/confirm matching decisions", the closest existing fit
   * for editing/revalidating a Pending row; execute already governs
   * committing rows toward import, the closest fit for Re-include; undo is
   * the existing "remove import-session data" permission, the closest fit
   * for Delete Permanently.
   */
  const canEditPending = isSuperAdmin || hasPermission('historical.import.approve_matching') || hasPermission('excel.import');
  const canManageImport = isSuperAdmin || hasPermission('historical.import.execute') || hasPermission('excel.import');
  const canDeletePermanently = isSuperAdmin || hasPermission('historical.import.undo') || hasPermission('excel.import');

  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [summary, setSummary] = useState<ChineseMillsImportSummary | null>(null);
  const [activeFilterTab, setActiveFilterTab] = useState<FilterTab>('ALL');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [mills, setMills] = useState<EntityListItem[]>([]);
  const [faultTypes, setFaultTypes] = useState<EntityListItem[]>([]);
  const [products, setProducts] = useState<EntityListItem[]>([]);
  const [approvedMappings, setApprovedMappings] = useState<Record<string, Record<string, string>>>({});
  const overridesRef = useRef<ManualOverrideMap>({});

  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [backupStatusMessage, setBackupStatusMessage] = useState<string | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);
  const [showCancelEntireConfirm, setShowCancelEntireConfirm] = useState(false);
  /** Approve Invalid Records task §6: holds the CURRENT review window's approvable scope for the confirmation dialog - never approved until the user explicitly confirms. */
  const [approveAllConfirm, setApproveAllConfirm] = useState<{ scopeRowIndexes: Set<number>; count: number } | null>(null);
  const [importResult, setImportResult] = useState<{ total: number; imported: number; failed: number; skipped: number; pending: number; excluded: number; cancelled: number; importId: string } | null>(null);
  /** §7: checked at BATCH BOUNDARIES only (see executeChineseMillsBatchImport's shouldCancel param) - a ref, not state, so the running import loop reads the latest value synchronously without needing to be re-created on every render. */
  const cancelImportRef = useRef(false);
  const [cancelRequested, setCancelRequested] = useState(false);

  const [editRowState, setEditRowState] = useState<{ rowIndex: number } | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string> | null>(null);

  const [manualSelectState, setManualSelectState] = useState<{ rowIndex: number; matchIndex: number } | null>(null);
  const [manualEditText, setManualEditText] = useState('');

  const [bulkAddDomain, setBulkAddDomain] = useState<'customer' | 'chineseMill' | 'faultType' | 'product' | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ rowIndexes: number[] } | null>(null);
  const [showExcludedPanel, setShowExcludedPanel] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [pendingSelected, setPendingSelected] = useState<Set<number>>(new Set());
  const [isRevalidatingPending, setIsRevalidatingPending] = useState(false);

  const [masterDataErrors, setMasterDataErrors] = useState<MasterDataLoadError[]>([]);
  const [isLoadingMasterData, setIsLoadingMasterData] = useState(true);

  // ---- Review windows + Draft (Simplified Selection task) ----
  /** Which bounded review window is open, and whether it's reviewing the LIVE in-progress session or a reopened Draft (§16: the reopened-draft footer is Delete/Cancel/Import only, no "Save Draft"). */
  const [reviewWindow, setReviewWindow] = useState<{ mode: 'ALL' | 'VALID' | 'READY' | 'CORRECTED' | 'INVALID'; source: 'LIVE' | 'DRAFT' } | null>(null);
  const [savedDraft, setSavedDraft] = useState<ChineseMillsDraft | null>(null);
  const [draftFeedback, setDraftFeedback] = useState<string | null>(null);

  /** §9/§13: a domain whose collection failed to load is treated as unavailable everywhere (parse, revalidate, full-row-edit) - matching is skipped for it instead of being attempted against an empty list. */
  const unavailable = useMemo<Partial<Record<MasterDataDomain, boolean>>>(() => {
    const map: Partial<Record<MasterDataDomain, boolean>> = {};
    masterDataErrors.forEach((e) => { map[e.domain] = true; });
    return map;
  }, [masterDataErrors]);

  /**
   * Fetches Customers/Chinese Mills/Fault Types INDEPENDENTLY (never one
   * Promise.all that dies on the first rejection) so a permission failure
   * on ONE collection (the reported bug: `faultTypes`) can never prevent
   * the others from loading, and can never throw an uncaught error that
   * breaks the screen (§8/§11). Skips the read entirely (§13/§14) until
   * Firebase Auth + the admin/permission record have both finished loading,
   * and again if the user's own permission model says they cannot view
   * Master Data at all - never issues a request that's guaranteed to fail.
   */
  const loadMasterData = useCallback(async () => {
    if (authLoading) return;
    setIsLoadingMasterData(true);
    if (!isAuthenticated || !canViewMasterData) {
      setCustomers([]);
      setMills([]);
      setFaultTypes([]);
      setProducts([]);
      setMasterDataErrors([]);
      setIsLoadingMasterData(false);
      return;
    }
    const [c, m, f, p, mappings] = await Promise.all([
      fetchMasterDataSafe<Customer>('customers', 'customer'),
      fetchMasterDataSafe<EntityListItem>(CHINESE_MILLS_MASTER_COLLECTION, 'millType'),
      fetchMasterDataSafe<EntityListItem>(FAULT_TYPES_COLLECTION, 'faultType'),
      fetchMasterDataSafe<Product>('products', 'specification'),
      loadApprovedMappings().catch(() => ({})),
    ]);
    setCustomers(c.data);
    setMills(m.data);
    setFaultTypes(f.data);
    setProducts(p.data);
    setApprovedMappings(mappings);
    setMasterDataErrors([c.error, m.error, f.error, p.error].filter((e): e is MasterDataLoadError => !!e));
    setIsLoadingMasterData(false);
  }, [authLoading, isAuthenticated, canViewMasterData]);

  useEffect(() => {
    loadMasterData();
  }, [loadMasterData]);

  // §15: discover an existing Draft for this user/browser on mount (local
  // read only - no Firestore involved, see chineseMillsDraftStorage.ts).
  useEffect(() => {
    if (!adminUser?.email) return;
    setSavedDraft(getDraft(adminUser.email));
  }, [adminUser?.email]);

  const masterDataBundle = useMemo(() => ({ customers, mills, faultTypes, products }), [customers, mills, faultTypes, products]);

  /** Re-runs revalidateChineseMillsRowFields for EVERY row using its CURRENT field values - the single mechanism behind global mapping propagation (§4/§39), full-row-edit revalidation (§29), and re-include revalidation (§37). Never a second/divergent revalidation path. */
  const revalidateAll = useCallback(
    (rows: ChineseMillsImportRow[]): ChineseMillsImportRow[] => {
      return rows.map((row) => {
        const fields = extractFieldsFromRow(row);
        const resolved = revalidateChineseMillsRowFields(fields, masterDataBundle, approvedMappings, language, row.actualRateDecision, overridesRef.current, unavailable);
        return { ...row, ...resolved, isDuplicate: row.isDuplicate, duplicateType: row.duplicateType };
      });
    },
    [masterDataBundle, approvedMappings, language, unavailable]
  );

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
    setImportResult(null);
    setFeedback(null);
    overridesRef.current = {};
    try {
      const buffer = await uploaded.arrayBuffer();
      const result = await parseAndValidateChineseMillsExcel(buffer, language);
      setSummary(result);
      setActiveFilterTab('ALL');
      // parseAndValidateChineseMillsExcel never throws on a Master Data
      // permission failure (fetchMasterDataSafe catches it) - it reports
      // failures back on the summary instead, so merge them into the same
      // banner state used for the initial mount-time load (§8/§20).
      if (result.masterDataLoadErrors && result.masterDataLoadErrors.length > 0) {
        setMasterDataErrors(result.masterDataLoadErrors as MasterDataLoadError[]);
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: cleanErrorMessage(err, language, 'File parse error') });
    } finally {
      setIsParsing(false);
    }
  };

  const handleCreateBackup = async () => {
    setIsCreatingBackup(true);
    setBackupStatusMessage(t('جاري توليد نسخة احتياطية وقائية...', 'Generating safety backup...', language));
    try {
      const backup = await createDatabaseBackup('PRE_IMPORT', t('نسخة أمان وقائية قبل استيراد الطواحين الصينية', 'Safety backup before Chinese Mills import', language), (stage, pct) => setBackupStatusMessage(`${stage} (${pct}%)`), true);
      setBackupId(backup.backupId);
      setBackupStatusMessage(t(`تم إنشاء النسخة الوقائية (${backup.backupId}).`, `Safety backup created (${backup.backupId}).`, language));
    } catch (err: any) {
      setBackupStatusMessage(t('تعذر إنشاء النسخة الاحتياطية: ', 'Failed to create backup: ', language) + err.message);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const updateRows = (updater: (rows: ChineseMillsImportRow[]) => ChineseMillsImportRow[]) => {
    setSummary((prev) => {
      if (!prev) return prev;
      const rows = updater(prev.rows);
      return { ...prev, ...recomputeSummaryCounts(rows), rows };
    });
  };

  const updateOneRow = (rowIndex: number, patch: Partial<ChineseMillsImportRow>) => {
    updateRows((rows) => rows.map((r) => (r.rowIndex === rowIndex ? { ...r, ...patch } : r)));
  };

  // ---- Row selection (partial import + Pending, Row-Based Review Part 6) ----
  const getSelection = (row: ChineseMillsImportRow): 'INCLUDED' | 'EXCLUDED' | 'PENDING' => row.rowSelection ?? 'INCLUDED';

  /** §8-9: ROW_SKIPPED/ROW_EXCLUDED - recorded via the SAME per-row resolutionHistory mechanism already used by Re-include/Revalidate below, never a second/divergent history model. */
  const handleExcludeRow = (rowIndex: number, reason: ChineseMillsImportRow['exclusionReason'] = 'USER_DESELECTED') => {
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
          resolutionHistory: [
            ...(r.resolutionHistory || []),
            { timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action, summary: reason === 'SKIPPED_ROW' ? t('تخطي السجل', 'Row skipped', language) : t('استبعاد السجل', 'Row excluded', language) },
          ],
        };
      })
    );
  };

  /** Moves a row (from EXCLUDED or PENDING) back to INCLUDED and revalidates it against current Master Data - used by both the Excluded panel and the Pending Records section (§27: "Re-include" - never bypasses validation). */
  const handleReincludeRow = (rowIndex: number) => {
    updateRows((rows) => {
      const target = rows.find((r) => r.rowIndex === rowIndex);
      if (!target) return rows;
      const fromState = getSelection(target);
      const revalidated = revalidateAll([{ ...target, rowSelection: 'INCLUDED', exclusionReason: undefined }])[0];
      // §39: record the PENDING/EXCLUDED -> INCLUDED (READY_TO_IMPORT) transition using the SAME edit-history mechanism as Full Row Edit - never a second/divergent history model.
      const withHistory: ChineseMillsImportRow = {
        ...revalidated,
        resolutionHistory: [
          ...(target.resolutionHistory || []),
          { timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'RE_INCLUDE', summary: t(`إعادة إدراج: ${fromState} → مُدرج`, `Re-include: ${fromState} → Included`, language) },
        ],
      };
      return rows.map((r) => (r.rowIndex === rowIndex ? withHistory : r));
    });
  };

  /** Re-runs validation for a Pending row IN PLACE, WITHOUT changing its selection - §25: "Revalidate" is a separate step from "Re-include", so the user can see whether a fix actually worked before committing it back to the includable pool. */
  const handleRevalidateRow = (rowIndex: number) => {
    updateRows((rows) => {
      const target = rows.find((r) => r.rowIndex === rowIndex);
      if (!target) return rows;
      const revalidated = revalidateAll([target])[0];
      const history = [...(target.resolutionHistory || [])];
      history.push({ timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'REVALIDATE', summary: revalidated.errors.length === 0 ? t('إعادة فحص: أصبح جاهزًا (PENDING → READY_TO_IMPORT).', 'Revalidate: now Ready (PENDING → READY_TO_IMPORT).', language) : t(`إعادة فحص: لا يزال معلقًا - ${revalidated.errors.length} مشكلة متبقية.`, `Revalidate: still Pending - ${revalidated.errors.length} remaining issue(s).`, language) });
      // §14: an approval decision was made against the row's PREVIOUS validation
      // state - never silently carried forward onto a re-validated one, whether
      // it improved or is still failing.
      if (target.approved) {
        history.push({ timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'ROW_APPROVAL_REVOKED', summary: t('إلغاء الاعتماد تلقائيًا - تم إعادة فحص السجل.', 'Approval automatically revoked - row was revalidated.', language) });
      }
      const withHistory: ChineseMillsImportRow = { ...revalidated, approved: false, approvedBy: undefined, approvedAt: undefined, approvalMethod: undefined, resolutionHistory: history };
      return rows.map((r) => (r.rowIndex === rowIndex ? withHistory : r));
    });
  };

  /** §26: Bulk Revalidate for multiple selected Pending rows - important after Master Data was added since the original parse. */
  const handleRevalidateSelectedPending = () => {
    if (pendingSelected.size === 0) return;
    setIsRevalidatingPending(true);
    updateRows((rows) => {
      const targets = rows.filter((r) => pendingSelected.has(r.rowIndex));
      const revalidatedMap = new Map(
        revalidateAll(targets).map((revalidated) => {
          const before = targets.find((t) => t.rowIndex === revalidated.rowIndex);
          const history = [...(before?.resolutionHistory || [])];
          history.push({ timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'REVALIDATE', summary: revalidated.errors.length === 0 ? t('إعادة فحص جماعي: أصبح جاهزًا.', 'Bulk revalidate: now Ready.', language) : t(`إعادة فحص جماعي: لا يزال معلقًا - ${revalidated.errors.length} مشكلة متبقية.`, `Bulk revalidate: still Pending - ${revalidated.errors.length} remaining issue(s).`, language) });
          // §14: never silently carry an approval decision forward onto revalidated data.
          if (before?.approved) {
            history.push({ timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'ROW_APPROVAL_REVOKED', summary: t('إلغاء الاعتماد تلقائيًا - تم إعادة فحص السجل.', 'Approval automatically revoked - row was revalidated.', language) });
          }
          return [
            revalidated.rowIndex,
            { ...revalidated, approved: false, approvedBy: undefined, approvedAt: undefined, approvalMethod: undefined, resolutionHistory: history } as ChineseMillsImportRow,
          ] as const;
        })
      );
      return rows.map((r) => revalidatedMap.get(r.rowIndex) || r);
    });
    setIsRevalidatingPending(false);
  };

  /**
   * §1-2/§22-23: the SINGLE authoritative selection decision - delegates to
   * computeBulkSelectionOutcome (chineseMillsSelectionPure.ts) so this panel,
   * the top summary counts, and the review windows can never drift apart on
   * what "Select Valid/Ready/Corrected" actually means. "Select All" always
   * selects every eligible (non-PENDING) row - it is never disabled by the
   * presence of invalid rows, and never bypasses validation: a PENDING row
   * stays PENDING and therefore stays unwritable regardless of selection.
   */
  const handleBulkSelection = (mode: BulkSelectionMode) => {
    updateRows((rows) =>
      rows.map((r) => {
        const outcome = computeBulkSelectionOutcome(r, mode);
        if (!outcome) return r; // PENDING rows are never touched by bulk selection
        return { ...r, rowSelection: outcome.rowSelection, exclusionReason: outcome.exclusionReason };
      })
    );
  };

  /**
   * Scoped Select All/Deselect All for a review window, matching Pressing's
   * own established pattern of a scope restricted to "the rows this specific
   * view is showing" (selectedExcludedRowIndices in DataImportView.tsx's
   * excluded-rows sub-panel, and this file's own pendingSelected) rather than
   * a single global selection actor. ROOT CAUSE: the review window's own
   * "Select All"/"Deselect All" buttons previously called the PLAIN
   * handleBulkSelection('ALL'/'NONE') above, which always operates on the
   * ENTIRE dataset (summary.rows) - so clicking "Select All" while reviewing
   * only the 10 rows shown in the "Invalid" window would silently reach past
   * that window and flip rows never displayed there, and vice versa for a
   * window with a NARROWER shown set than "everything eligible." This variant
   * restricts the SAME computeBulkSelectionOutcome decision to exactly the
   * rowIndexes currently visible in the open review window.
   */
  const handleScopedBulkSelection = (mode: 'ALL' | 'NONE', scopeRowIndexes: Set<number>) => {
    updateRows((rows) =>
      rows.map((r) => {
        if (!scopeRowIndexes.has(r.rowIndex)) return r;
        const outcome = computeBulkSelectionOutcome(r, mode);
        if (!outcome) return r; // PENDING rows are never touched by bulk selection
        return { ...r, rowSelection: outcome.rowSelection, exclusionReason: outcome.exclusionReason };
      })
    );
  };

  /**
   * Approve Invalid Records task §4/§17: an explicit administrative decision
   * that the row is accepted for import despite its current (overridable)
   * errors - NEVER a correction. Preserves everything (errors, warnings,
   * originalRowData/editedRowData, resolutionHistory) exactly as-is; only
   * adds the approval fields plus one resolutionHistory entry, using the
   * SAME row-level history mechanism as every other decision here (never a
   * second/divergent history model). A non-overridable row (§10) is never
   * reachable here - the "Approve" button is disabled for it in the UI.
   */
  const handleApproveRow = (rowIndex: number, method: 'INDIVIDUAL' | 'BULK') => {
    const actor = adminUser?.email || 'admin';
    const now = new Date().toISOString();
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        if (r.errors.length === 0 || isNonOverridableBlockingCondition(r)) return r;
        return {
          ...r,
          approved: true,
          approvedBy: actor,
          approvedAt: now,
          approvalMethod: method,
          resolutionHistory: [
            ...(r.resolutionHistory || []),
            {
              timestamp: now,
              actor,
              action: 'ROW_APPROVED',
              summary: t(`اعتماد السجل (${method === 'BULK' ? 'جماعي' : 'فردي'}) - الأخطاء الأصلية محفوظة: ${r.errors.join(' · ')}`, `Row approved (${method === 'BULK' ? 'bulk' : 'individual'}) - original errors preserved: ${r.errors.join(' · ')}`, language),
            },
          ],
        };
      })
    );
    if (method === 'INDIVIDUAL') {
      const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
      logAuditAction(
        'UPDATE',
        'stage_chinese_mills',
        undefined,
        `[ROW_APPROVED] استيراد الطواحين الصينية - صف #${rowIndex} - طريقة الاعتماد: فردي - المستخدم: ${actor} - الأخطاء الأصلية: ${(row?.errors || []).join(' | ')} - التحذيرات الأصلية: ${(row?.warnings || []).join(' | ')}`
      ).catch(() => {});
    }
  };

  /**
   * §13: Revoke Approval - safe, explicit undo BEFORE import. The row
   * returns to its previous review state (still BLOCKING/NEEDS_REVIEW since
   * errors were never cleared, only overridden) and becomes non-importable
   * again. Distinct from Delete/Skip/Exclude - selection state (rowSelection)
   * is completely untouched here.
   */
  const handleRevokeApproval = (rowIndex: number) => {
    const actor = adminUser?.email || 'admin';
    const now = new Date().toISOString();
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex || !r.approved) return r;
        return {
          ...r,
          approved: false,
          approvedBy: undefined,
          approvedAt: undefined,
          approvalMethod: undefined,
          resolutionHistory: [
            ...(r.resolutionHistory || []),
            { timestamp: now, actor, action: 'ROW_APPROVAL_REVOKED', summary: t('إلغاء الاعتماد - عاد السجل إلى حالة يحتاج مراجعة.', 'Approval revoked - row returned to needs-review state.', language) },
          ],
        };
      })
    );
    logAuditAction('UPDATE', 'stage_chinese_mills', undefined, `[ROW_APPROVAL_REVOKED] استيراد الطواحين الصينية - صف #${rowIndex} - المستخدم: ${actor}`).catch(() => {});
  };

  /**
   * §5-6/§21-22: Approve All Records - approves every APPROVABLE row
   * (has a blocking error AND is overridable) within the CURRENT REVIEW
   * WINDOW SCOPE exactly, mirroring handleScopedBulkSelection's own scoping
   * pattern (never the whole dataset, never dependent on scroll/rendered
   * DOM). Non-overridable rows in scope are left untouched/still blocking -
   * never silently approved. One Firestore audit write for the whole batch
   * (§18 - never one write per row for an in-session decision), while every
   * affected row keeps its own resolutionHistory entry in-memory exactly
   * like the individual path.
   */
  const handleApproveAllInWindow = (scopeRowIndexes: Set<number>) => {
    const actor = adminUser?.email || 'admin';
    const now = new Date().toISOString();
    // Computed from the CURRENT snapshot (never inside the updateRows updater
    // callback) so the audit log's count is never at risk of double-counting
    // if React invokes that updater more than once for the same commit.
    const approvedCount = (summary?.rows || []).filter((r) => scopeRowIndexes.has(r.rowIndex) && r.errors.length > 0 && !isNonOverridableBlockingCondition(r)).length;
    updateRows((rows) =>
      rows.map((r) => {
        if (!scopeRowIndexes.has(r.rowIndex)) return r;
        if (r.errors.length === 0 || isNonOverridableBlockingCondition(r)) return r;
        return {
          ...r,
          approved: true,
          approvedBy: actor,
          approvedAt: now,
          approvalMethod: 'BULK' as const,
          resolutionHistory: [
            ...(r.resolutionHistory || []),
            { timestamp: now, actor, action: 'ROW_APPROVED', summary: t(`اعتماد جماعي - الأخطاء الأصلية محفوظة: ${r.errors.join(' · ')}`, `Bulk approval - original errors preserved: ${r.errors.join(' · ')}`, language) },
          ],
        };
      })
    );
    setApproveAllConfirm(null);
    logAuditAction(
      'BULK_IMPORT',
      'stage_chinese_mills',
      undefined,
      `[BULK_APPROVAL] استيراد الطواحين الصينية - اعتماد جماعي لنطاق المراجعة الحالي - عدد السجلات المعتمدة: ${approvedCount} - المستخدم: ${actor}`
    ).catch(() => {});
  };

  /**
   * §20: Download Error/Skipped-Excluded Report - reuses the SAME xlsx
   * client-side export infra DataImportView.tsx's Pressing importer already
   * uses (handleExportErrorReport there), never a new export pipeline.
   * Covers every row that will NOT import right now (blocking errors,
   * Pending, or Excluded/Skipped) with the row-level audit fields §20 asks
   * for, sourced from data that already exists on the row (raw/resolved
   * fields, resolutionHistory, exclusionReason/excludedBy/excludedAt) -
   * nothing invented.
   */
  const handleExportErrorReport = () => {
    if (!summary) return;
    const rows = summary.rows.filter((r) => !isChineseMillsRowWritable(r));
    if (rows.length === 0) return;

    const reportRows = rows.map((r) => {
      const lastResolution = r.resolutionHistory?.[r.resolutionHistory.length - 1];
      const user = r.excludedBy || r.warningOverrideBy || lastResolution?.actor || '';
      const timestamp = r.excludedAt || r.warningOverrideAt || lastResolution?.timestamp || '';
      return {
        [t('رقم الصف', 'Row #', language)]: r.rowIndex,
        [t('القيمة الأصلية', 'Original Value', language)]: `${r.customerNameRaw || ''} / ${r.millTypeRaw || ''} / ${r.specificationCodeRaw || ''}`,
        [t('القيمة المصححة', 'Corrected Value', language)]: `${r.resolvedCustomerName || ''} / ${r.resolvedMillName || ''} / ${r.resolvedProductName || ''}`,
        [t('الخطأ', 'Error', language)]: r.errors.join(' | '),
        [t('التحذير', 'Warning', language)]: r.warnings.join(' | '),
        [t('الحل', 'Resolution', language)]: r.resolutionHistory?.map((h) => h.summary).join(' | ') || '',
        [t('القرار', 'Decision', language)]: `${getSelection(r)}${r.exclusionReason ? ` (${r.exclusionReason})` : ''}`,
        [t('الحالة', 'Status', language)]: r.status,
        [t('المستخدم', 'User', language)]: user,
        [t('التوقيت', 'Timestamp', language)]: timestamp,
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(reportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, t('أخطاء ومستبعد', 'Errors-Skipped', language));
    XLSX.writeFile(workbook, `chinese-mills-import-errors-${Date.now()}.xlsx`);
  };

/** §4-9/§24-25: opens the bounded review window for a given selection mode -
   * every selection shortcut must produce a VISIBLE, observable result, never
   * just a silent state change (root cause of the reported "dead button" bug:
   * ALL/NONE previously only called handleBulkSelection() and never opened
   * anything, so a click was indistinguishable from doing nothing unless the
   * user happened to notice the small counter/checkbox change). VALID/READY/
   * CORRECTED/ALL apply the matching bulk selection first (so the window
   * shows exactly what's now selected); INVALID never changes selection -
   * PENDING rows already have their own explicit per-row resolution actions,
   * this just gives them a focused, scrollable window instead of only the
   * always-inline section. */
  const openReviewWindow = (mode: 'ALL' | 'VALID' | 'READY' | 'CORRECTED' | 'INVALID') => {
    if (mode !== 'INVALID') handleBulkSelection(mode === 'ALL' ? 'ALL' : mode);
    setReviewWindow({ mode, source: 'LIVE' });
  };

  const closeReviewWindow = () => setReviewWindow(null);

  // ---- Draft (§7, §15-17) ----
  const handleSaveDraft = () => {
    if (!summary) return;
    const { rows: _rows, ...summaryWithoutRows } = summary;
    const outcome: SaveDraftOutcome = saveDraft(file?.name || t('ملف غير معروف', 'unknown file', language), summary.rows, summaryWithoutRows, adminUser?.email || '');
    if (outcome.ok === true) {
      setSavedDraft(outcome.draft);
      setDraftFeedback(t(`تم حفظ المسودة (${outcome.draft.rows.length} صف).`, `Draft saved (${outcome.draft.rows.length} rows).`, language));
      return;
    }
    const errorCode: 'STORAGE_UNAVAILABLE' | 'STORAGE_QUOTA_EXCEEDED' = outcome.ok === false ? outcome.error : 'STORAGE_UNAVAILABLE';
    setDraftFeedback(
      errorCode === 'STORAGE_QUOTA_EXCEEDED'
        ? t('تعذر حفظ المسودة - المساحة المحلية للمتصفح ممتلئة.', 'Could not save draft - browser local storage is full.', language)
        : t('تعذر حفظ المسودة - التخزين المحلي غير متاح.', 'Could not save draft - local storage is unavailable.', language)
    );
  };

  /** §16-17: reopening a Draft loads its saved rows/summary back into the SAME review architecture (rowSelection etc. preserved exactly as saved) - never a separate draft-only data shape. */
  const handleOpenDraft = () => {
    if (!savedDraft) return;
    setSummary({ ...savedDraft.summary, rows: savedDraft.rows } as ChineseMillsImportSummary);
    setActiveFilterTab('ALL');
    setReviewWindow({ mode: 'INVALID', source: 'DRAFT' });
    logDraftOpened(savedDraft);
  };

  const handleDeleteDraft = () => {
    deleteDraft(adminUser?.email || '');
    setSavedDraft(null);
    setDraftFeedback(t('تم حذف المسودة.', 'Draft deleted.', language));
    if (reviewWindow?.source === 'DRAFT') setReviewWindow(null);
  };

  const handleDeletePermanently = (rowIndexes: number[]) => {
    updateRows((rows) => rows.filter((r) => !rowIndexes.includes(r.rowIndex)));
    setDeleteConfirm(null);
  };

  // ---- Warning override ----
  const handleAcceptWarnings = (rowIndex: number) => {
    updateOneRow(rowIndex, { warningsAccepted: true, warningOverrideBy: adminUser?.email || 'admin', warningOverrideAt: new Date().toISOString() });
  };

  // ---- Actual Rate accept/reject (§23) ----
  const handleActualRateDecision = (rowIndex: number, decision: 'ACCEPTED' | 'REJECTED') => {
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const actualRateFinal = decision === 'ACCEPTED' ? r.actualRateSuggested : r.actualRateImported;
        return { ...r, actualRateDecision: decision, actualRateFinal };
      })
    );
  };

  // ---- Customer Future Code proposal (§5) ----
  const handleCustomerCodeDecision = async (rowIndex: number, decision: 'ACCEPTED' | 'REJECTED') => {
    const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
    if (!row?.customerCodeUpdateProposal || !row.resolvedCustomerId) return;
    if (decision === 'ACCEPTED') {
      try {
        await applyCustomerCodeUpdate(row.resolvedCustomerId, row.customerCodeUpdateProposal.proposedCode);
        await loadMasterData();
      } catch (err: any) {
        setFeedback({ type: 'error', message: cleanErrorMessage(err, language, 'Customer code update failed') });
        return;
      }
    }
    updateOneRow(rowIndex, {
      customerCodeUpdateProposal: { ...row.customerCodeUpdateProposal, decision },
      resolvedCustomerCode: decision === 'ACCEPTED' ? row.customerCodeUpdateProposal.proposedCode : row.resolvedCustomerCode,
    });
  };

  // ---- Smart-match resolution actions (§3, §25-28) ----
  const applyGlobalResolution = (fieldDomain: 'customer' | 'millType' | 'faultType' | 'specification', importedValue: string, resolved: { id: string; code: string; name: string }) => {
    overridesRef.current = registerManualOverride(overridesRef.current, fieldDomain, importedValue, resolved);
    updateRows((rows) => revalidateAll(rows));
  };

  const handleApproveMatch = (rowIndex: number, matchIndex: number) => {
    const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
    const match = row?.proposedMatches?.[matchIndex];
    if (!match || !match.suggestedId) return;
    applyGlobalResolution(match.fieldDomain, match.importedValue, { id: match.suggestedId, code: match.suggestedCode || '', name: match.suggestedName || '' });
  };

  const handleChooseExisting = (rowIndex: number, matchIndex: number, option: ComboboxOption) => {
    const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
    const match = row?.proposedMatches?.[matchIndex];
    if (!match) return;
    applyGlobalResolution(match.fieldDomain, match.importedValue, { id: option.id, code: option.code, name: option.name });
    setManualSelectState(null);
  };

  const handleSkipMatch = (rowIndex: number, matchIndex: number) => {
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const proposedMatches = (r.proposedMatches || []).map((m, idx) => (idx === matchIndex ? { ...m, decision: 'REJECTED' as const } : m));
        // Skipping an OPTIONAL field (customer/faultType) clears the "unknown" error for it - Mill Type stays required and cannot be skipped away.
        const match = r.proposedMatches?.[matchIndex];
        let errors = r.errors;
        if (match && match.fieldDomain !== 'millType') {
          errors = errors.filter((e) => !e.includes(match.importedValue));
        }
        const status = errors.length > 0 ? r.status : r.warnings.length > 0 ? 'WARNING' : 'VALID';
        return { ...r, proposedMatches, errors, status };
      })
    );
  };

  const handleAddSingle = async (rowIndex: number, matchIndex: number) => {
    const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
    const match = row?.proposedMatches?.[matchIndex];
    if (!match) return;
    const value = match.manualEditedValue || match.importedValue;
    try {
      let newId: string | undefined;
      if (match.fieldDomain === 'customer') {
        newId = await createCustomerFromImport(value);
      } else if (match.fieldDomain === 'millType') {
        newId = await createChineseMillFromImport(value, value === match.importedValue ? t('طاحونة صينية ', 'Chinese Mill ', language) + value : value);
      } else if (match.fieldDomain === 'specification') {
        newId = await createProductFromImport(value, value);
      } else {
        newId = await createFaultTypeFromImport(value);
      }
      if (!newId) throw new Error(t('تعذر الإنشاء.', 'Creation failed.', language));
      await loadMasterData();
      applyGlobalResolution(match.fieldDomain, match.importedValue, { id: newId, code: match.fieldDomain === 'millType' || match.fieldDomain === 'specification' ? value : '', name: value });
    } catch (err: any) {
      setFeedback({ type: 'error', message: cleanErrorMessage(err, language, 'Single Master Data add failed') });
    }
  };

  const handleManualEditConfirm = (rowIndex: number, matchIndex: number) => {
    if (!manualEditText.trim()) return;
    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const proposedMatches = (r.proposedMatches || []).map((m, idx) => (idx === matchIndex ? { ...m, manualEditedValue: manualEditText.trim(), importedValue: manualEditText.trim() } : m));
        return { ...r, proposedMatches };
      })
    );
    setManualEditText('');
  };

  // ---- Bulk "Add All Master Data" (§41-44) ----
  const missingEntitiesForBulkAdd = useMemo<MissingEntityItem[]>(() => {
    if (!summary) return [];
    const map = new Map<string, MissingEntityItem>();
    summary.rows.forEach((row) => {
      (row.proposedMatches || []).forEach((m) => {
        if (m.decision !== 'PENDING') return;
        const key = `${m.fieldDomain}#${normalizeArabicForComparison(m.importedValue)}`;
        if (map.has(key)) return;
        const domain = m.fieldDomain === 'millType' ? 'chineseMill' : m.fieldDomain === 'specification' ? 'product' : m.fieldDomain;
        // Master Data Consolidation fix - even an unresolved token can carry
        // a real (below-auto-accept) fuzzy candidate right here on `m`
        // (suggestedCode/suggestedName). Deriving a code/name from the RAW
        // token instead (the old behavior) meant BatchAddMasterDataModal's
        // exact-match duplicate check could never find it, silently
        // offering to CREATE a near-duplicate (e.g. mill "1" vs the
        // existing "5101") instead of "Use Existing" - prefer the real
        // candidate whenever one exists, for every domain.
        // CRITICAL SCHEMA CORRECTION: `m.importedValue` for the 'specification'
        // domain is now specificationCodeRaw ("SP-250"), i.e. the intended
        // Product CODE itself - unlike customer/faultType (name-only-capable,
        // CODE_OPTIONAL_DOMAINS in BatchAddMasterDataModal.tsx), a Product's
        // identity IS its code, so the fallback must carry it through rather
        // than leaving it blank.
        const fallbackCode = m.fieldDomain === 'millType' ? m.importedValue.replace(/\D/g, '') || m.importedValue : m.fieldDomain === 'specification' ? m.importedValue : '';
        const fallbackName = m.fieldDomain === 'millType' ? `${t('طاحونة صينية', 'Chinese Mill', language)} ${m.importedValue}` : m.importedValue;
        map.set(key, {
          id: key,
          domain: domain as MissingEntityItem['domain'],
          token: m.importedValue,
          suggestedCode: m.suggestedCode || fallbackCode,
          suggestedName: m.suggestedName || fallbackName,
          collectionName: m.fieldDomain === 'customer' ? 'customers' : m.fieldDomain === 'millType' ? CHINESE_MILLS_MASTER_COLLECTION : m.fieldDomain === 'specification' ? 'products' : FAULT_TYPES_COLLECTION,
          selected: true,
        });
      });
    });
    return Array.from(map.values());
  }, [summary, language]);

  const existingItemsForBulkDomain = useMemo(() => {
    if (bulkAddDomain === 'customer') return customers;
    if (bulkAddDomain === 'chineseMill') return mills;
    if (bulkAddDomain === 'faultType') return faultTypes;
    if (bulkAddDomain === 'product') return products;
    return [];
  }, [bulkAddDomain, customers, mills, faultTypes, products]);

  const handleBulkCreated = async (createdItems: Array<{ domain: string; token: string; item: any }>) => {
    await loadMasterData();
    createdItems.forEach((c) => {
      const fieldDomain = c.domain === 'chineseMill' ? 'millType' : c.domain === 'product' ? 'specification' : (c.domain as 'customer' | 'faultType');
      overridesRef.current = registerManualOverride(overridesRef.current, fieldDomain, c.token, { id: c.item.id, code: c.item.code || '', name: c.item.name || c.item.carNumber || c.token });
    });
    updateRows((rows) => revalidateAll(rows));
    setBulkAddDomain(null);
  };

  // ---- Full Row Edit (§29) ----
  const openEditRow = (rowIndex: number) => {
    const row = summary?.rows.find((r) => r.rowIndex === rowIndex);
    if (!row) return;
    setEditDraft({
      date: row.date,
      customerNameRaw: row.customerNameRaw,
      customerCodeRaw: row.customerCodeRaw || '',
      specificationCodeRaw: row.specificationCodeRaw,
      millTypeRaw: row.millTypeRaw,
      shiftRaw: String(row.shiftRaw ?? ''),
      productionQuantityRaw: String(row.productionQuantity || ''),
      numberOfBagsRaw: String(row.numberOfBags || ''),
      rejectedQuantityRaw: String(row.rejectedQuantity || ''),
      operatingMinutesRaw: String(row.operatingMinutes || ''),
      operatingHoursRaw: String(row.operatingHours || ''),
      downtimeHoursRaw: String(row.downtimeHours || ''),
      faultTypeRaw: row.faultTypeRaw || '',
      specification: row.specification || '',
      weightClassRaw: row.weightClassKg !== undefined ? String(row.weightClassKg) : '',
      theoreticalRateRaw: row.theoreticalRate !== undefined ? String(row.theoreticalRate) : '',
      actualRateRaw: row.actualRateImported !== undefined ? String(row.actualRateImported) : '',
      notes: row.notes || '',
    });
    setEditRowState({ rowIndex });
  };

  const saveEditRow = () => {
    if (!editRowState || !editDraft || !summary) return;
    const row = summary.rows.find((r) => r.rowIndex === editRowState.rowIndex);
    if (!row) return;
    const before: Record<string, any> = extractFieldsFromRow(row);
    const resolved = revalidateChineseMillsRowFields(editDraft as any, masterDataBundle, approvedMappings, language, undefined, overridesRef.current, unavailable);
    const changedFields = Object.keys(editDraft).filter((k) => (before as any)[k] !== (editDraft as any)[k]);

    updateRows((rows) =>
      rows.map((r) => {
        if (r.rowIndex !== editRowState.rowIndex) return r;
        const history = [
          ...(r.resolutionHistory || []),
          {
            timestamp: new Date().toISOString(),
            actor: adminUser?.email || 'admin',
            action: 'FULL_ROW_EDIT',
            summary: t(`تعديل كامل للصف - حقول معدلة: ${changedFields.join(', ') || 'لا شيء'}`, `Full row edit - changed fields: ${changedFields.join(', ') || 'none'}`, language),
          },
        ];
        // §14: the row was materially changed - an approval decision made
        // against its PREVIOUS data/errors is now stale and must never be
        // silently preserved, whether the edit fixed the row or not.
        if (r.approved) {
          history.push({ timestamp: new Date().toISOString(), actor: adminUser?.email || 'admin', action: 'ROW_APPROVAL_REVOKED', summary: t('إلغاء الاعتماد تلقائيًا - تم تعديل السجل.', 'Approval automatically revoked - row was edited.', language) });
        }
        return {
          ...r,
          ...resolved,
          isDuplicate: r.isDuplicate,
          duplicateType: r.duplicateType,
          editedRowData: { ...editDraft },
          approved: false,
          approvedBy: undefined,
          approvedAt: undefined,
          approvalMethod: undefined,
          resolutionHistory: history,
        };
      })
    );
    setEditRowState(null);
    setEditDraft(null);
  };

  // ---- Import execution ----
  const writableRows = useMemo(() => (summary ? summary.rows.filter(isChineseMillsRowWritable) : []), [summary]);

  const handleStartImport = () => setShowFinalConfirm(true);

  /**
   * §31 CRITICAL: revalidates every SELECTED row against CURRENT Master
   * Data + a fresh duplicate check immediately before writing to Firestore
   * - a row that was writable when the user selected it may no longer be
   * (Master Data changed, or it was already imported elsewhere since).
   * Anything that drops out of the writable set here is preserved (moved
   * back to Pending, never silently discarded) rather than removed from the
   * review session (§32: isolate, don't fail the whole batch).
   */
  const handleConfirmImport = async () => {
    setShowFinalConfirm(false);
    if (writableRows.length === 0 || !summary) return;
    setIsImporting(true);
    setImportProgress(0);
    cancelImportRef.current = false;
    setCancelRequested(false);
    logAuditAction('BULK_IMPORT', 'stage_chinese_mills', undefined, `[ROW_IMPORT_STARTED] استيراد الطواحين الصينية - بدء رفع ${writableRows.length} سجل`).catch(() => {});
    try {
      const [freshCustomers, freshMills, freshFaultTypes, freshProducts] = await Promise.all([
        fetchMasterDataSafe<Customer>('customers', 'customer'),
        fetchMasterDataSafe<EntityListItem>(CHINESE_MILLS_MASTER_COLLECTION, 'millType'),
        fetchMasterDataSafe<EntityListItem>(FAULT_TYPES_COLLECTION, 'faultType'),
        fetchMasterDataSafe<Product>('products', 'specification'),
      ]);
      const freshBundle = { customers: freshCustomers.data, mills: freshMills.data, faultTypes: freshFaultTypes.data, products: freshProducts.data };

      let candidates = writableRows.map((row) => {
        const fields = extractFieldsFromRow(row);
        const resolved = revalidateChineseMillsRowFields(fields, freshBundle, approvedMappings, language, row.actualRateDecision, overridesRef.current, unavailable);
        const merged: ChineseMillsImportRow = { ...row, ...resolved, isDuplicate: row.isDuplicate, duplicateType: row.duplicateType };
        return resolved.errors.length > 0 ? { ...merged, rowSelection: 'PENDING' as const } : merged;
      });
      candidates = await recheckDatabaseDuplicates(candidates, language);

      const stillWritable = candidates.filter(isChineseMillsRowWritable);
      const droppedAtLastMoment = candidates.length - stillWritable.length;

      const result = await executeChineseMillsBatchImport(
        stillWritable,
        backupId || undefined,
        (pct) => setImportProgress(pct),
        () => cancelImportRef.current
      );

      // Reflect the fresh state back into the review session so any row the
      // last-moment check caught stays visible and repairable - never lost.
      // Rows in batches that never started because of a cancellation are
      // NOT in `candidates`' patch map with a changed status here - they
      // simply remain whatever they already were (still selected/INCLUDED,
      // just not yet written), so the user can re-open Import immediately
      // to continue, exactly like a normal partial import.
      updateRows((rows) => {
        const patchMap = new Map(candidates.map((r) => [r.rowIndex, r]));
        return rows.map((r) => patchMap.get(r.rowIndex) || r);
      });

      const pendingAfter = candidates.filter((r) => (r.rowSelection ?? 'INCLUDED') === 'PENDING').length;
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
      setFeedback({ type: 'error', message: cleanErrorMessage(err, language, 'Import execution error') });
    } finally {
      setIsImporting(false);
      cancelImportRef.current = false;
      setCancelRequested(false);
    }
  };

  /** §7: requests cancellation at the next batch boundary - never mid-batch (a writeBatch().commit() already in flight always finishes; rows already committed stay committed, matching "never fake atomic cancellation"). */
  const handleCancelDuringImport = () => {
    cancelImportRef.current = true;
    setCancelRequested(true);
  };

  /**
   * §11-16: "Cancel Entire Import" - abandons the CURRENT import
   * session/operation, distinct from Deselect All (rows only) or the
   * pre-execution "Cancel Import" button on the Final Confirmation modal
   * (which only declines THAT confirmation, leaving the session open for the
   * user to resume/reconfigure and try again).
   *
   * - Mid-execution: reuses the EXACT SAME batch-boundary cancellation as
   *   handleCancelDuringImport - never a second cancellation mechanism.
   *   Rows already committed stay committed; remaining rows stay reviewable;
   *   ImportId is preserved (it lives in the in-flight executeChineseMills-
   *   BatchImport call, untouched here).
   * - Before execution: writes ZERO rows (executeChineseMillsBatchImport is
   *   never called), closes any open review window, and resets the loaded
   *   session (file/summary/backupId/importResult) back to the upload
   *   screen - but deliberately does NOT touch the saved Draft (§19: only an
   *   explicit "Delete Draft" removes a draft, never this action).
   */
  const handleCancelEntireImport = () => {
    setShowCancelEntireConfirm(false);
    if (isImporting) {
      handleCancelDuringImport();
      return;
    }
    logAuditAction(
      'BULK_IMPORT',
      'stage_chinese_mills',
      undefined,
      `[IMPORT_CANCELLED] استيراد الطواحين الصينية - تم إلغاء عملية الرفع بالكامل قبل التنفيذ - المحدد: ${selectionCounts.selected} - سيتم استيراده: ${selectionCounts.willImport} - المستخدم: ${adminUser?.email || 'admin'}`
    ).catch(() => {});
    setReviewWindow(null);
    setShowFinalConfirm(false);
    setImportResult(null);
    setSummary(null);
    setFile(null);
    setBackupId(null);
    setActiveFilterTab('ALL');
    setFeedback({ type: 'success', message: t('تم إلغاء عملية الرفع بالكامل. لم يتم تسجيل أي سجل.', 'The entire import operation was cancelled. No records were written.', language) });
  };

  const filteredRows = useMemo(() => {
    if (!summary) return [];
    return summary.rows.filter((r) => {
      // Pending (blocking) and Excluded rows live in their own dedicated
      // sections below, never in the main review table - Part 6/§21.
      if (getSelection(r) === 'PENDING') return false;
      if (activeFilterTab === 'EXCLUDED') return getSelection(r) === 'EXCLUDED';
      if (getSelection(r) === 'EXCLUDED') return false;
      if (activeFilterTab === 'ALL') return true;
      if (activeFilterTab === 'VALID') return r.errors.length === 0 && r.warnings.length === 0;
      if (activeFilterTab === 'WARNING') return r.warnings.length > 0;
      if (activeFilterTab === 'ERROR') return r.errors.length > 0;
      if (activeFilterTab === 'DUPLICATE') return r.isDuplicate;
      return true;
    });
  }, [summary, activeFilterTab]);

  const excludedRows = useMemo(() => (summary ? summary.rows.filter((r) => getSelection(r) === 'EXCLUDED') : []), [summary]);
  /**
   * §ROOT-CAUSE: "Pending Records" membership must be based on the row's
   * INTRINSIC blocking condition (errors.length > 0) - the same one
   * rowSelection='PENDING' was always derived FROM at parse/recheck time
   * (see chineseMillsHistoricalImportService.ts) - not on the mutable
   * rowSelection field itself. Select All can now flip a blocking row's
   * rowSelection to INCLUDED (so its checkbox actually shows checked, fixing
   * the reported bug), and that row must still show up here with its error
   * detail/manual-fix actions until the underlying issue is actually gone -
   * never disappear from this section just because it was "selected."
   */
  const pendingRows = useMemo(() => (summary ? summary.rows.filter((r) => r.errors.length > 0) : []), [summary]);
  const selectionCounts = useMemo(() => computeSelectionCounts(summary?.rows || []), [summary]);
  const validRowsForWindow = useMemo(() => (summary ? summary.rows.filter(matchesValid) : []), [summary]);
  const readyRowsForWindow = useMemo(() => (summary ? summary.rows.filter(matchesReady) : []), [summary]);
  const correctedRowsForWindow = useMemo(() => (summary ? summary.rows.filter(matchesCorrected) : []), [summary]);
  const invalidRowsForWindow = useMemo(() => (summary ? summary.rows.filter(matchesInvalidNeedsReview) : []), [summary]);
  const reviewWindowRows = useMemo(() => {
    if (!reviewWindow) return [];
    if (reviewWindow.mode === 'VALID') return validRowsForWindow;
    if (reviewWindow.mode === 'READY') return readyRowsForWindow;
    if (reviewWindow.mode === 'CORRECTED') return correctedRowsForWindow;
    if (reviewWindow.mode === 'INVALID') return invalidRowsForWindow;
    return summary?.rows || []; // ALL
  }, [reviewWindow, validRowsForWindow, readyRowsForWindow, correctedRowsForWindow, invalidRowsForWindow, summary]);

  /** §7: "Select All" opens a MIXED-state window - the needs-review subset renders with the invalid-style table (error/reason/manual-edit actions) and everything else with the main review table (checkbox/status/decision), exactly mirroring how the main screen itself already separates Pending Records from the main table - never a third/divergent row layout. */
  const allWindowInvalidRows = useMemo(() => reviewWindowRows.filter(matchesInvalidNeedsReview), [reviewWindowRows]);
  const allWindowMainRows = useMemo(() => reviewWindowRows.filter((r) => !matchesInvalidNeedsReview(r)), [reviewWindowRows]);
  /** §11/§15: Selected/Will Import counts SCOPED to exactly this window's own rows - computed from the same reviewWindowRows the Select All button now operates on (see handleScopedBulkSelection), so the header can never show a number that disagrees with what Select All just did. */
  const reviewWindowSelectedCount = useMemo(() => reviewWindowRows.filter((r) => getSelection(r) === 'INCLUDED').length, [reviewWindowRows]);
  const reviewWindowWillImportCount = useMemo(() => reviewWindowRows.filter(isChineseMillsRowWritable).length, [reviewWindowRows]);
  /**
   * Approve Invalid Records task §5-6/§21: "Approve All Records" scope -
   * EXACTLY the blocking, overridable rows this window is currently showing
   * (the 'ALL' window's own Needs-Review subsection for mode 'ALL', or the
   * whole window for mode 'INVALID') - never the whole dataset, never rows
   * outside the current filter/window, and never a non-overridable row (§10).
   */
  const reviewWindowApprovableRows = useMemo(() => {
    if (!reviewWindow) return [];
    const source = reviewWindow.mode === 'ALL' ? allWindowInvalidRows : reviewWindow.mode === 'INVALID' ? reviewWindowRows : [];
    return source.filter((r) => r.errors.length > 0 && !isNonOverridableBlockingCondition(r));
  }, [reviewWindow, allWindowInvalidRows, reviewWindowRows]);

  const millOptions: ComboboxOption[] = mills.map((m) => ({ id: m.id || '', code: m.code || '', name: m.name || '' }));
  const customerOptions: ComboboxOption[] = customers.map((c) => ({ id: c.id || '', code: c.code || '', name: c.name || '' }));
  const faultTypeOptions: ComboboxOption[] = faultTypes.map((f) => ({ id: f.id || '', code: f.code || '', name: f.name || '' }));
  const productOptions: ComboboxOption[] = products.map((p) => ({ id: p.id || '', code: p.code || '', name: p.name || '' }));

  const optionsForDomain = (domain: 'customer' | 'millType' | 'faultType' | 'specification') =>
    domain === 'customer' ? customerOptions : domain === 'millType' ? millOptions : domain === 'specification' ? productOptions : faultTypeOptions;

  // §13/§14: never issue a protected read before Auth + permission state is
  // known, and never show the upload screen to a signed-out user - a
  // controlled state instead of a guaranteed-to-fail Firestore request.
  if (authLoading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-8 flex flex-col items-center justify-center gap-2" dir={isRtl ? 'rtl' : 'ltr'}>
        <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        <span className="text-xs font-bold text-slate-600">{t('جاري تحميل الصلاحيات...', 'Loading permissions...', language)}</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-2" dir={isRtl ? 'rtl' : 'ltr'}>
        <AlertCircle className="w-6 h-6 text-red-600 mx-auto" />
        <p className="text-xs font-bold text-red-800">{t('يجب تسجيل الدخول للوصول إلى استيراد بيانات الطواحين الصينية.', 'You must be signed in to access the Chinese Mills historical import.', language)}</p>
      </div>
    );
  }

  if (!canViewMasterData) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center space-y-2" dir={isRtl ? 'rtl' : 'ltr'}>
        <AlertCircle className="w-6 h-6 text-red-600 mx-auto" />
        <p className="text-xs font-bold text-red-800">{t('لا توجد لديك صلاحية الاطلاع على البيانات الأساسية اللازمة لاستيراد بيانات الطواحين الصينية.', 'You do not have permission to view the Master Data required for the Chinese Mills import.', language)}</p>
      </div>
    );
  }

  /**
   * Shared inline smart-review panel (Part 2/§5) - errors, warnings +
   * Approve Despite Warning, per-field Master Data proposed matches
   * (Approve/Choose Existing/Manual Edit/Add/Skip), Actual Rate
   * accept/reject, Customer Future Code accept/reject, and edit history.
   * Used identically by BOTH the main review table's expandable row AND the
   * Pending Records section, so a row keeps the EXACT same resolution
   * controls no matter which section currently holds it - never a
   * second/divergent review UI.
   */
  const renderSmartPanel = (row: ChineseMillsImportRow) => {
    const pendingMatches = (row.proposedMatches || []).filter((m) => m.decision === 'PENDING');
    return (
      <div className="space-y-2">
        {row.errors.length > 0 && (
          <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2 space-y-0.5">
            {row.errors.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}
        {row.warnings.length > 0 && (
          <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 space-y-1">
            {row.warnings.map((w, i) => <div key={i}>• {w}</div>)}
            {!row.warningsAccepted && (
              <button type="button" disabled={!canOverrideWarnings} onClick={() => handleAcceptWarnings(row.rowIndex)} className="text-[11px] font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 disabled:opacity-40 px-2 py-1 rounded-md cursor-pointer">
                {t('اعتماد رغم التحذير', 'Approve Despite Warning', language)}
              </button>
            )}
            {row.warningsAccepted && <span className="text-[10px] font-bold text-emerald-700">{t('تم الاعتماد', 'Accepted', language)}</span>}
          </div>
        )}

        {pendingMatches.map((m) => {
          const originalIndex = (row.proposedMatches || []).indexOf(m);
          const opts = optionsForDomain(m.fieldDomain);
          const isManualOpen = manualSelectState?.rowIndex === row.rowIndex && manualSelectState.matchIndex === originalIndex;
          return (
            <div key={originalIndex} className="text-[11px] bg-sky-50 border border-sky-200 rounded-lg p-2 space-y-1.5">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <span className="font-bold text-sky-900">{language === 'ar' ? m.fieldNameAr : m.fieldNameEn}: "{m.importedValue}"</span>
                {m.suggestedName && <span className="text-sky-700">{t('مقترح:', 'Suggested:', language)} {m.suggestedName} ({m.confidence}%)</span>}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {m.suggestedId && (
                  <button type="button" onClick={() => handleApproveMatch(row.rowIndex, originalIndex)} className="px-2 py-1 bg-emerald-100 text-emerald-800 rounded-md cursor-pointer font-bold">{t('اعتماد', 'Approve', language)}</button>
                )}
                <button type="button" onClick={() => setManualSelectState(isManualOpen ? null : { rowIndex: row.rowIndex, matchIndex: originalIndex })} className="px-2 py-1 bg-slate-100 text-slate-700 rounded-md cursor-pointer font-bold">{t('اختيار موجود', 'Choose Existing', language)}</button>
                {canAddMasterData && (
                  <button type="button" onClick={() => handleAddSingle(row.rowIndex, originalIndex)} className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded-md cursor-pointer font-bold">{t('إضافة', 'Add', language)}</button>
                )}
                {m.fieldDomain !== 'millType' && (
                  <button type="button" onClick={() => handleSkipMatch(row.rowIndex, originalIndex)} className="px-2 py-1 bg-slate-100 text-slate-500 rounded-md cursor-pointer font-bold">{t('تخطي', 'Skip', language)}</button>
                )}
              </div>
              {isManualOpen && (
                <div className="pt-1.5 border-t border-sky-200 space-y-1.5">
                  <SearchableCombobox id={`cm-manual-${row.rowIndex}-${originalIndex}`} options={opts} value={null} onChange={(_id, opt) => opt && handleChooseExisting(row.rowIndex, originalIndex, opt)} placeholder={t('ابحث...', 'Search...', language)} />
                  <div className="flex items-center gap-1.5">
                    <input type="text" defaultValue={m.importedValue} onChange={(e) => setManualEditText(e.target.value)} placeholder={t('تعديل يدوي للقيمة...', 'Manually edit the value...', language)} className="flex-1 border border-slate-300 rounded-md px-2 py-1 text-[11px]" />
                    <button type="button" onClick={() => handleManualEditConfirm(row.rowIndex, originalIndex)} className="px-2 py-1 bg-slate-700 text-white rounded-md cursor-pointer font-bold">{t('حفظ التعديل', 'Save Edit', language)}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {row.actualRateDecision === 'PENDING' && (
          <div className="text-[11px] bg-violet-50 border border-violet-200 rounded-lg p-2 space-y-1">
            <p className="text-violet-900 font-bold">
              {t(`المعدل الفعلي (طن) المستورد: ${row.actualRateImported} طن - المقترح: ${row.actualRateSuggested} طن. هل تريد اعتماد القيمة المقترحة؟`, `Imported Actual Rate (Tons): ${row.actualRateImported} Tons - Suggested: ${row.actualRateSuggested} Tons. Apply the suggested value?`, language)}
            </p>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => handleActualRateDecision(row.rowIndex, 'REJECTED')} className="px-2 py-1 bg-slate-100 text-slate-700 rounded-md cursor-pointer font-bold">{t('رفض', 'Reject', language)}</button>
              <button type="button" onClick={() => handleActualRateDecision(row.rowIndex, 'ACCEPTED')} className="px-2 py-1 bg-violet-100 text-violet-800 rounded-md cursor-pointer font-bold">{t('اعتماد', 'Accept', language)}</button>
            </div>
          </div>
        )}

        {row.customerCodeUpdateProposal?.decision === 'PENDING' && (
          <div className="text-[11px] bg-indigo-50 border border-indigo-200 rounded-lg p-2 space-y-1">
            <p className="text-indigo-900 font-bold">
              {t(`تحديث كود العميل المقترح: ${row.customerCodeUpdateProposal.proposedCode}؟`, `Proposed Customer Code update: ${row.customerCodeUpdateProposal.proposedCode}?`, language)}
            </p>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => handleCustomerCodeDecision(row.rowIndex, 'REJECTED')} className="px-2 py-1 bg-slate-100 text-slate-700 rounded-md cursor-pointer font-bold">{t('رفض', 'Reject', language)}</button>
              <button type="button" onClick={() => handleCustomerCodeDecision(row.rowIndex, 'ACCEPTED')} className="px-2 py-1 bg-indigo-100 text-indigo-800 rounded-md cursor-pointer font-bold">{t('اعتماد', 'Accept', language)}</button>
            </div>
          </div>
        )}

        {(row.resolutionHistory?.length || 0) > 0 && (
          <details className="text-[10px] text-slate-500">
            <summary className="cursor-pointer font-bold flex items-center gap-1"><History className="w-3 h-3" />{t('سجل التعديلات', 'Edit History', language)}</summary>
            {row.resolutionHistory!.map((h, i) => <div key={i} className="pl-4">{h.summary} - {h.actor} - {new Date(h.timestamp).toLocaleString()}</div>)}
          </details>
        )}
      </div>
    );
  };

  /** §6: the full 17-field read-only detail view shown when a row is expanded. */
  const renderFullFieldDetail = (row: ChineseMillsImportRow) => {
    const fields: Array<[string, any]> = [
      [t('التاريخ', 'Date', language), row.date],
      [t('اسم العميل', 'Customer Name', language), row.resolvedCustomerName || row.customerNameRaw || '-'],
      [t('كود المواصفة', 'Specification Code', language), row.specificationCodeRaw || '-'],
      [t('نوع الطاحونة', 'Mill Type', language), row.resolvedMillName || row.millTypeRaw || '-'],
      [t('الوردية', 'Shift', language), row.resolvedShiftNumber ?? row.shiftRaw ?? '-'],
      [t('كمية الإنتاج (طن)', 'Production Quantity (Tons)', language), row.productionQuantity],
      [t('عدد الجواني', 'Number of Bags', language), row.numberOfBags],
      [t('المرفوض', 'Rejected Quantity', language), row.rejectedQuantity],
      [t('دقائق التشغيل', 'Operating Minutes', language), row.operatingMinutes],
      [t('ساعات التشغيل', 'Operating Hours', language), row.operatingHours],
      [t('ساعات الأعطال', 'Downtime Hours', language), row.downtimeHours],
      [t('نوع العطل', 'Fault Type', language), row.resolvedFaultTypeName || row.faultTypeRaw || '-'],
      [t('المواصفة', 'Specification', language), row.specification || '-'],
      [t('فئة الوزن (كجم)', 'Weight Class (kg)', language), row.weightClassKg ?? '-'],
      [t('المعدل النظري (طن)', 'Theoretical Rate (Tons)', language), row.theoreticalRate ?? '-'],
      [t('المعدل الفعلي (طن)', 'Actual Rate (Tons)', language), row.actualRateFinal ?? row.actualRateImported ?? '-'],
      [t('ملاحظات', 'Notes', language), row.notes || '-'],
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-3">
        {fields.map(([label, value]) => (
          <div key={label as string}>
            <span className="block text-slate-400 font-bold">{label}</span>
            <span className="text-slate-800">{String(value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const toggleExpandRow = (rowIndex: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  };

  /**
   * §9-10: shared "invalid/needs-review" row table - Row #, Status
   * (Original/Current data), Problematic Field/Reason, Existing/Proposed
   * Master Data (via the expandable smart panel), and the existing per-row
   * actions (Manual Edit, Revalidate/Choose Existing/Add/Skip via the smart
   * panel, Re-include, Delete). Used identically by the always-inline
   * Pending Records section AND the bounded "Invalid / Needs Review" review
   * window (§9) - never a second/divergent table for the same data.
   *
   * ROOT CAUSE of the reported "individual checkbox works, Select All does
   * not" bug: this table's row checkbox used to ALWAYS read/write
   * `pendingSelected` (a completely separate local Set, scoped to the
   * unrelated "Revalidate Selected" bulk-action on the main-page Pending
   * section) - a state Select All/Deselect All (handleScopedBulkSelection,
   * computeBulkSelectionOutcome) never touches. So a manual click worked
   * (its own onChange updates that same Set) while Select All had literally
   * nothing to change here. `selectionMode` makes this table context-aware:
   * 'PENDING_REVALIDATE' (the main-page Pending Records section - unchanged,
   * still the Revalidate-Selected picker) vs 'REVIEW' (the review modal -
   * the checkbox now reads/writes rowSelection via getSelection/
   * handleReincludeRow/handleExcludeRow, the EXACT SAME authoritative state
   * and handlers the main review table's checkbox already uses, so Select
   * All updates the one state every checkbox actually reads - never a second
   * selection architecture).
   */
  const renderInvalidStyleTable = (rows: ChineseMillsImportRow[], selectionMode: 'PENDING_REVALIDATE' | 'REVIEW' = 'PENDING_REVALIDATE') => (
    <div className="overflow-x-auto max-h-[calc(100vh-540px)] lg:max-h-[calc(100vh-480px)] overflow-y-auto">
      <table className="w-full text-[11px] min-w-[760px]">
        <thead className="sticky top-0 bg-red-50 z-10">
          <tr className="text-slate-500 border-b border-red-100">
            <th className="text-start py-1.5 px-1"></th>
            <th className="text-start py-1.5 px-1 font-bold">{t('رقم الصف', 'Row #', language)}</th>
            <th className="text-start py-1.5 px-1 font-bold">{t('البيانات الأصلية', 'Original Data', language)}</th>
            <th className="text-start py-1.5 px-1 font-bold">{t('البيانات الحالية', 'Current Data', language)}</th>
            <th className="text-start py-1.5 px-1 font-bold">{t('السبب / البيانات الناقصة', 'Reason / Missing Data', language)}</th>
            <th className="text-start py-1.5 px-1 font-bold">{t('آخر تعديل', 'Last Modified', language)}</th>
            <th className="text-start py-1.5 px-1 font-bold">{t('إجراءات', 'Actions', language)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const lastModified = row.resolutionHistory?.length ? row.resolutionHistory[row.resolutionHistory.length - 1].timestamp : null;
            const isReady = row.errors.length === 0;
            const isExpanded = expandedRows.has(row.rowIndex);
            return (
              <React.Fragment key={row.rowIndex}>
                <tr className="border-b border-red-100/60 align-top">
                  <td className="py-1.5 px-1">
                    {selectionMode === 'REVIEW' ? (
                      <input type="checkbox" checked={getSelection(row) === 'INCLUDED'} onChange={(e) => (e.target.checked ? handleReincludeRow(row.rowIndex) : handleExcludeRow(row.rowIndex))} />
                    ) : (
                      <input type="checkbox" checked={pendingSelected.has(row.rowIndex)} onChange={(e) => setPendingSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(row.rowIndex); else next.delete(row.rowIndex); return next; })} />
                    )}
                  </td>
                  <td className="py-1.5 px-1 font-mono font-bold text-slate-700">
                    <button type="button" onClick={() => toggleExpandRow(row.rowIndex)} className="me-1 px-1 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer">{isExpanded ? '−' : '+'}</button>
                    #{row.rowIndex}
                  </td>
                  <td className="py-1.5 px-1 text-slate-400 font-mono">
                    {Object.values(row.raw).slice(0, 4).map((v) => String(v ?? '')).filter(Boolean).join(' · ') || '-'}
                  </td>
                  <td className="py-1.5 px-1 text-slate-700">
                    {row.date} · {row.resolvedCustomerName || row.customerNameRaw || '-'} · {t('طاحونة', 'Mill', language)} {row.resolvedMillName || row.millTypeRaw || '-'} · {t('وردية', 'Shift', language)} {row.resolvedShiftNumber ?? row.shiftRaw ?? '-'}
                    {isReady && <span className="ms-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded border bg-emerald-100 text-emerald-800 border-emerald-300">{t('جاهز', 'Ready', language)}</span>}
                  </td>
                  <td className="py-1.5 px-1 text-red-700">
                    {/* §12: never hide the original error, even once approved - "Status: APPROVED" + "Original Error: ..." + "Decision: Approved by user" all shown together, never one replacing the other. */}
                    {row.approved && (
                      <div className="mb-1 flex items-center gap-1">
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded border bg-sky-100 text-sky-800 border-sky-300">{t('معتمد', 'APPROVED', language)}</span>
                        <span className="text-[10px] text-slate-500">{t(`اعتماد ${row.approvalMethod === 'BULK' ? 'جماعي' : 'فردي'} بواسطة ${row.approvedBy || ''}`, `${row.approvalMethod === 'BULK' ? 'Bulk' : 'Individual'} approval by ${row.approvedBy || ''}`, language)}</span>
                      </div>
                    )}
                    {row.errors.map((e, i) => <div key={i}>• {e}</div>)}
                  </td>
                  <td className="py-1.5 px-1 text-slate-500 font-mono">{lastModified ? new Date(lastModified).toLocaleString() : '-'}</td>
                  <td className="py-1.5 px-1">
                    <div className="flex items-center gap-1 flex-wrap">
                      {canEditPending && <button type="button" onClick={() => openEditRow(row.rowIndex)} className="px-1.5 py-1 bg-sky-50 text-sky-700 rounded cursor-pointer font-bold">{t('تعديل يدوي', 'Manual Edit', language)}</button>}
                      {canEditPending && <button type="button" onClick={() => handleRevalidateRow(row.rowIndex)} className="px-1.5 py-1 bg-slate-100 text-slate-700 rounded cursor-pointer font-bold">{t('إعادة الفحص', 'Revalidate', language)}</button>}
                      {canManageImport && (
                        <button type="button" disabled={!isReady} onClick={() => handleReincludeRow(row.rowIndex)} className="px-1.5 py-1 bg-emerald-50 text-emerald-700 rounded cursor-pointer font-bold disabled:opacity-40 disabled:cursor-not-allowed">{t('إعادة إدراج', 'Re-include', language)}</button>
                      )}
                      {/* §4/§10/§13: Approve/Revoke Approval - independent of Re-include (which requires the row to already be error-free). Disabled + explained when the row's only errors are non-overridable structural rules (§10). */}
                      {canManageImport && !isReady && (
                        row.approved ? (
                          <button type="button" onClick={() => handleRevokeApproval(row.rowIndex)} className="px-1.5 py-1 bg-amber-50 text-amber-700 rounded cursor-pointer font-bold">{t('إلغاء الاعتماد', 'Revoke Approval', language)}</button>
                        ) : (
                          <button
                            type="button"
                            disabled={isNonOverridableBlockingCondition(row)}
                            onClick={() => handleApproveRow(row.rowIndex, 'INDIVIDUAL')}
                            title={isNonOverridableBlockingCondition(row) ? t('لا يمكن الاعتماد - يوجد شرط أساسي غير قابل للتجاوز (تاريخ غير صالح/نوع طاحونة مفقود/وردية غير صالحة/كمية إنتاج غير صالحة/صف مكرر داخل الملف).', 'Cannot approve - a non-overridable structural rule applies (invalid date / missing Mill Type / invalid shift / invalid Production Quantity / duplicate within the file).', language) : undefined}
                            className="px-1.5 py-1 bg-sky-50 text-sky-700 rounded cursor-pointer font-bold disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            {t('اعتماد', 'Approve', language)}
                          </button>
                        )
                      )}
                      {getSelection(row) !== 'EXCLUDED' && (
                        <>
                          {/* §10: "Skip Row" (SKIPPED_ROW) and "Exclude Row" (EXCLUDED_ROW) are
                              both genuinely non-destructive - same EXCLUDED state as Deselect,
                              just a different exclusionReason for audit/display, recoverable via
                              Re-include. Bug fix: this button was previously mislabeled "Skip Row"
                              while actually wired to Delete Permanently - it now does what its
                              label says. */}
                          <button type="button" onClick={() => handleExcludeRow(row.rowIndex, 'SKIPPED_ROW')} className="px-1.5 py-1 bg-slate-100 text-slate-600 rounded cursor-pointer font-bold">{t('تخطي السجل', 'Skip Row', language)}</button>
                          <button type="button" onClick={() => handleExcludeRow(row.rowIndex, 'EXCLUDED_ROW')} className="px-1.5 py-1 bg-slate-100 text-slate-600 rounded cursor-pointer font-bold">{t('استبعاد السجل', 'Exclude Row', language)}</button>
                        </>
                      )}
                      {canDeletePermanently && <button type="button" onClick={() => setDeleteConfirm({ rowIndexes: [row.rowIndex] })} className="px-1.5 py-1 bg-red-50 text-red-700 rounded cursor-pointer font-bold">{t('حذف نهائي', 'Delete Permanently', language)}</button>}
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-red-100/60 bg-white">
                    <td colSpan={7} className="p-3 space-y-3">
                      {renderFullFieldDetail(row)}
                      {renderSmartPanel(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="text-center py-6 text-slate-400 text-xs">{t('لا توجد سجلات مطابقة لهذا الاختيار.', 'No records match this selection.', language)}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  /**
   * §5-6: shared "row-based review" table (one Excel row = one review row) -
   * Row #, Include checkbox, resolved data columns, Status, Action. Used
   * identically by the main filterable review table AND the bounded
   * Valid/Ready/Corrected review windows (§4) - never a second/divergent
   * table for the same data.
   */
  const renderMainReviewTable = (rows: ChineseMillsImportRow[]) => (
    <div className="overflow-x-auto max-h-[calc(100vh-540px)] lg:max-h-[calc(100vh-480px)] overflow-y-auto border border-slate-200 rounded-xl">
      <table className="w-full text-[11px] min-w-[980px]">
        <thead className="sticky top-0 bg-slate-50 z-10">
          <tr className="text-slate-500 border-b border-slate-200">
            <th className="text-start py-2 px-2"></th>
            <th className="text-start py-2 px-2 font-bold">#</th>
            <th className="text-start py-2 px-2 font-bold">{t('التاريخ', 'Date', language)}</th>
            <th className="text-start py-2 px-2 font-bold">{t('العميل', 'Customer', language)}</th>
            <th className="text-start py-2 px-2 font-bold">{t('كود المواصفة', 'Spec. Code', language)}</th>
            <th className="text-start py-2 px-2 font-bold">{t('الطاحونة', 'Mill', language)}</th>
            <th className="text-start py-2 px-2 font-bold">{t('الوردية', 'Shift', language)}</th>
            <th className="text-end py-2 px-2 font-bold">{t('الإنتاج', 'Production', language)}</th>
            <th className="text-end py-2 px-2 font-bold">{t('الجواني', 'Bags', language)}</th>
            <th className="text-end py-2 px-2 font-bold">{t('المرفوض', 'Rejected', language)}</th>
            <th className="text-start py-2 px-2 font-bold">{t('زمن التشغيل', 'Operating Time', language)}</th>
            <th className="text-start py-2 px-2 font-bold">{t('الحالة', 'Status', language)}</th>
            <th className="text-start py-2 px-2 font-bold">{t('القرار', 'Decision', language)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const statusInfo = STATUS_LABELS[row.status] || STATUS_LABELS.NEW;
            const isExpanded = expandedRows.has(row.rowIndex);
            const hasUnresolved = row.warnings.length > 0 || (row.proposedMatches || []).some((m) => m.decision === 'PENDING') || row.actualRateDecision === 'PENDING' || row.customerCodeUpdateProposal?.decision === 'PENDING';
            const opHours = Math.floor(row.totalOperatingTimeHours);
            const opMins = Math.round((row.totalOperatingTimeHours - opHours) * 60);
            return (
              <React.Fragment key={row.rowIndex}>
                <tr className={`border-b border-slate-100 ${isExpanded ? 'bg-slate-50/60' : 'hover:bg-slate-50/40'}`}>
                  <td className="py-2 px-2">
                    <input type="checkbox" checked={getSelection(row) === 'INCLUDED'} onChange={(e) => (e.target.checked ? handleReincludeRow(row.rowIndex) : handleExcludeRow(row.rowIndex))} />
                  </td>
                  <td className="py-2 px-2 font-mono text-slate-400">{row.rowIndex}</td>
                  <td className="py-2 px-2 text-slate-700">{row.date}</td>
                  <td className="py-2 px-2 text-slate-700">{row.resolvedCustomerName || row.customerNameRaw || '-'}</td>
                  <td className="py-2 px-2 text-slate-500 font-mono">{row.specificationCodeRaw || '-'}</td>
                  <td className="py-2 px-2 text-slate-700">{row.resolvedMillName || row.millTypeRaw || '-'}</td>
                  <td className="py-2 px-2 text-slate-700">{row.resolvedShiftNumber ?? row.shiftRaw ?? '-'}</td>
                  <td className="py-2 px-2 text-end font-bold text-slate-800">{row.productionQuantity}</td>
                  <td className="py-2 px-2 text-end text-slate-600">{row.numberOfBags}</td>
                  <td className="py-2 px-2 text-end text-slate-600">{row.rejectedQuantity}</td>
                  <td className="py-2 px-2 text-slate-600 font-mono">{opHours}:{String(opMins).padStart(2, '0')}</td>
                  <td className="py-2 px-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${statusInfo.cls}`}>{language === 'ar' ? statusInfo.ar : statusInfo.en}</span>
                    {hasUnresolved && <AlertTriangle className="inline w-3 h-3 text-amber-600 ms-1" />}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => toggleExpandRow(row.rowIndex)} className="px-1.5 py-1 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer font-bold">
                        {isExpanded ? '−' : '+'}
                      </button>
                      {canEditPending && (
                        <button type="button" onClick={() => openEditRow(row.rowIndex)} className="p-1 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded cursor-pointer" title={t('تعديل السجل بالكامل', 'Edit Entire Row', language)}>
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {row.warnings.length > 0 && !row.warningsAccepted && (
                        <button type="button" disabled={!canOverrideWarnings} onClick={() => handleAcceptWarnings(row.rowIndex)} className="px-1.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded cursor-pointer font-bold disabled:opacity-40">{t('اعتماد', 'Approve', language)}</button>
                      )}
                      {getSelection(row) === 'INCLUDED' && (
                        <button type="button" onClick={() => handleExcludeRow(row.rowIndex, 'EXCLUDED_ROW')} className="p-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded cursor-pointer" title={t('استبعاد', 'Exclude', language)}>
                          <Ban className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-slate-100 bg-slate-50/30">
                    <td colSpan={13} className="p-3 space-y-3">
                      {renderFullFieldDetail(row)}
                      {renderSmartPanel(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={13} className="text-center py-6 text-slate-400 text-xs">{t('لا توجد سجلات مطابقة لهذا الاختيار.', 'No records match this selection.', language)}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Permission Error banner (§8/§20) - a domain that failed to load never
          crashes the screen; shown alongside the rest of a still-usable panel
          since optional fields (Customer/Fault Type) can be skipped. */}
      {masterDataErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2">
          <h3 className="text-xs font-black text-red-900 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            {t('خطأ صلاحيات', 'Permission Error', language)}
          </h3>
          {masterDataErrors.map((e) => (
            <div key={e.domain} className="text-[11px] text-red-800 bg-white/60 border border-red-200 rounded-lg p-2">
              <div><span className="font-bold">{t('الكيان: ', 'Entity: ', language)}</span>{language === 'ar' ? e.labelAr : e.labelEn}</div>
              <div><span className="font-bold">{t('العملية: ', 'Operation: ', language)}</span>{t('قراءة', 'Read', language)}</div>
              <div>{describeMasterDataLoadError(e, language)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black text-slate-900">{t('استيراد بيانات تاريخية - الطواحين الصينية', 'Historical Import - Chinese Mills', language)}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{t('17 حقلاً مخصصًا لمرحلة الطواحين الصينية', '17 fields specific to the Chinese Mills stage', language)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => downloadChineseMillsExcelTemplate(language)} className="flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-2 rounded-xl cursor-pointer">
              <Download className="w-4 h-4" />
              {t('تحميل القالب (17 حقلاً)', 'Download Template (17 fields)', language)}
            </button>
            <button type="button" disabled={isCreatingBackup} onClick={handleCreateBackup} className="flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-xl cursor-pointer disabled:opacity-50">
              {isCreatingBackup ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
              {t('نسخة احتياطية وقائية', 'Safety Backup', language)}
            </button>
          </div>
        </div>
        {backupStatusMessage && <p className="text-[11px] text-slate-500 font-mono">{backupStatusMessage}</p>}

        {isLoadingMasterData ? (
          <div className="flex items-center justify-center gap-2 border-2 border-dashed border-slate-200 rounded-xl p-8 text-xs font-bold text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('جاري تحميل البيانات الأساسية...', 'Loading Master Data...', language)}
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 hover:border-emerald-400 rounded-xl p-8 cursor-pointer transition-colors" onDragOver={(e) => e.preventDefault()} onDrop={handleFileDrop}>
            <UploadCloud className="w-8 h-8 text-slate-400" />
            <span className="text-xs font-bold text-slate-600">{file ? file.name : t('اسحب وأفلت ملف Excel هنا أو اضغط للاختيار', 'Drop the Excel file here or click to browse', language)}</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileDrop} />
          </label>
        )}
        {isParsing && (
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('جاري فحص الملف...', 'Validating file...', language)}
          </div>
        )}
      </div>

      {feedback && (
        <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {summary && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 sm:p-6 space-y-4">
          {/* §11-16: "Cancel Entire Import" - abandons the CURRENT import
              session/operation entirely, distinct from Deselect All (rows
              only), closing the review window, or the pre-execution "Cancel
              Import" button on the Final Confirmation modal (which only
              declines that one confirmation, leaving the session open).
              Always reachable at the top of the loaded session, regardless
              of scroll position or which review window is open. */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500 font-bold truncate">{file?.name || ''}</span>
            {canManageImport && (
              <button type="button" onClick={() => setShowCancelEntireConfirm(true)} className="shrink-0 px-3 py-1.5 text-[11px] font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg cursor-pointer">
                {t('إلغاء عملية الرفع بالكامل', 'Cancel Entire Import', language)}
              </button>
            )}
          </div>

          {/* §3: top-of-screen counts, computed ONLY from actual row state (computeSelectionCounts) - never invented. */}
          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: t('إجمالي السجلات', 'Total Rows', language), value: selectionCounts.total, cls: 'text-slate-700' },
              { label: t('الصالحة', 'Valid', language), value: selectionCounts.valid, cls: 'text-emerald-600' },
              { label: t('الجاهزة', 'Ready', language), value: selectionCounts.ready, cls: 'text-emerald-600' },
              { label: t('المصححة', 'Corrected', language), value: selectionCounts.corrected, cls: 'text-sky-600' },
              { label: t('تحتاج مراجعة', 'Invalid / Needs Review', language), value: selectionCounts.invalidNeedsReview, cls: 'text-red-600' },
              { label: t('معتمد', 'Approved', language), value: selectionCounts.approved, cls: 'text-sky-700' },
              { label: t('حظر غير قابل للتجاوز', 'Non-Overridable Blocking', language), value: selectionCounts.blocking, cls: 'text-red-700' },
              { label: t('تحذير', 'Warning', language), value: selectionCounts.warning, cls: 'text-amber-600' },
              { label: t('متخطى', 'Skipped', language), value: selectionCounts.skipped, cls: 'text-slate-500' },
              { label: t('المستبعدة', 'Excluded', language), value: selectionCounts.excluded, cls: 'text-slate-500' },
              { label: t('المحددة', 'Selected', language), value: selectionCounts.selected, cls: 'text-slate-900' },
              { label: t('سيتم استيراده', 'Will Import', language), value: selectionCounts.willImport, cls: 'text-emerald-700' },
              { label: t('مسودة', 'Draft', language), value: savedDraft?.rows.length ?? 0, cls: 'text-indigo-600' },
            ].map((s) => (
              <div key={s.label} className="text-center px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50/60">
                <span className="text-[10px] font-bold text-slate-500 block">{s.label}</span>
                <span className={`text-sm font-black block ${s.cls}`}>{s.value}</span>
              </div>
            ))}
          </div>

          {/* Filter tabs for the main review table below (unchanged filtering behavior). */}
          <div className="flex flex-wrap items-center gap-4">
            {[
              { key: 'ALL', label: t('الكل', 'All', language), value: summary.totalRows, cls: 'text-slate-700' },
              { key: 'VALID', label: t('صالح', 'Valid', language), value: summary.validRows, cls: 'text-emerald-600' },
              { key: 'WARNING', label: t('تحذير', 'Warning', language), value: summary.warningRows, cls: 'text-amber-600' },
              { key: 'DUPLICATE', label: t('مكرر', 'Duplicate', language), value: summary.duplicateRows, cls: 'text-slate-500' },
              { key: 'EXCLUDED', label: t('مستبعد', 'Excluded', language), value: excludedRows.length, cls: 'text-slate-500' },
            ].map((tab) => (
              <button key={tab.key} type="button" onClick={() => setActiveFilterTab(tab.key as FilterTab)} className={`text-center px-3 py-1.5 rounded-lg border ${activeFilterTab === tab.key ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'}`}>
                <span className="text-[11px] font-bold text-slate-500 block">{tab.label}</span>
                <span className={`text-base font-black block ${tab.cls}`}>{tab.value}</span>
              </button>
            ))}
            {/* Pending (blocking) rows live in their own section below, not the filterable main table - clicking jumps there (Part 6). */}
            <button type="button" onClick={() => document.getElementById('cm-pending-section')?.scrollIntoView({ behavior: 'smooth' })} className="text-center px-3 py-1.5 rounded-lg border border-red-200 bg-red-50/60 cursor-pointer">
              <span className="text-[11px] font-bold text-red-600 block">{t('معلق', 'Pending', language)}</span>
              <span className="text-base font-black block text-red-700">{pendingRows.length}</span>
            </button>
          </div>

          {/* §15: reopenable Draft banner. */}
          {savedDraft && (
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-indigo-50 border border-indigo-200 rounded-xl">
              <div className="text-[11px] text-indigo-900">
                <span className="font-black">{t('المسودات', 'Drafts', language)}: </span>
                {t('استيراد الطواحين الصينية', 'Chinese Mills Historical Import', language)} · {t('أُنشئت', 'Created', language)} {new Date(savedDraft.createdAt).toLocaleString()} · {t('عدد الصفوف', 'Rows', language)}: {savedDraft.rows.length}
              </div>
              {canManageImport && (
                <button type="button" onClick={handleOpenDraft} className="px-3 py-1.5 text-[11px] font-bold text-indigo-800 bg-indigo-100 hover:bg-indigo-200 rounded-lg cursor-pointer">{t('فتح المسودة', 'Open Draft', language)}</button>
              )}
            </div>
          )}
          {draftFeedback && (
            <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-bold text-slate-700 flex items-center justify-between">
              <span>{draftFeedback}</span>
              <button type="button" onClick={() => setDraftFeedback(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {/* Missing master data / Add All Missing (§10-13) */}
          {missingEntitiesForBulkAdd.length > 0 && canAddMasterData && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
              <h3 className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                {t('إضافة جميع البيانات الناقصة', 'Add All Missing', language)}
              </h3>
              {(['customer', 'chineseMill', 'faultType', 'product'] as const).map((domain) => {
                const items = missingEntitiesForBulkAdd.filter((i) => i.domain === domain);
                if (items.length === 0) return null;
                const label = domain === 'customer' ? t('العملاء', 'Customers', language) : domain === 'chineseMill' ? t('الطواحين الصينية', 'Chinese Mills', language) : domain === 'product' ? t('المنتجات (كود المواصفة)', 'Products (Specification Code)', language) : t('أنواع الأعطال', 'Fault Types', language);
                return (
                  <div key={domain} className="flex items-center justify-between bg-white p-2 rounded-lg border border-amber-200">
                    <span className="text-[11px] font-bold text-slate-700">{label} ({items.length}): {items.map((i) => i.token).join('، ')}</span>
                    <button type="button" onClick={() => setBulkAddDomain(domain)} className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 px-2.5 py-1.5 rounded-lg cursor-pointer">
                      <Plus className="w-3.5 h-3.5" />
                      {t(`إضافة جميع ${label} الناقصة (${items.length})`, `Add All Missing ${label} (${items.length})`, language)}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bulk selection actions (§1, §29). Select All is never disabled by
              the presence of invalid rows - it always selects every eligible
              (non-PENDING) row; PENDING rows keep their own explicit
              resolution actions and are never swept in. Valid/Ready/Corrected
              apply their selection AND open a bounded review window (§4);
              Invalid/Needs Review opens the review window without touching
              selection (§8-9). */}
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <button type="button" onClick={() => openReviewWindow('ALL')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('تحديد الكل', 'Select All', language)}</button>
            <button type="button" onClick={() => handleBulkSelection('NONE')} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء تحديد الكل', 'Deselect All', language)}</button>
            <button type="button" onClick={() => openReviewWindow('VALID')} className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg cursor-pointer">{t(`تحديد الصالح (${selectionCounts.valid})`, `Select Valid (${selectionCounts.valid})`, language)}</button>
            <button type="button" onClick={() => openReviewWindow('READY')} className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg cursor-pointer">{t(`تحديد الجاهز (${selectionCounts.ready})`, `Select Ready (${selectionCounts.ready})`, language)}</button>
            <button type="button" onClick={() => openReviewWindow('CORRECTED')} className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-lg cursor-pointer">{t(`تحديد المصحح (${selectionCounts.corrected})`, `Select Corrected (${selectionCounts.corrected})`, language)}</button>
            <button type="button" onClick={() => openReviewWindow('INVALID')} className="px-2.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-800 rounded-lg cursor-pointer">{t(`تحديد غير الصالح (${selectionCounts.invalidNeedsReview})`, `Select Invalid / Needs Review (${selectionCounts.invalidNeedsReview})`, language)}</button>
            <button type="button" onClick={() => handleBulkSelection('WARNING_APPROVED')} className="px-2.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg cursor-pointer">{t('تحديد التحذيرات المعتمدة', 'Select Warning Approved', language)}</button>
            <button type="button" onClick={() => setShowExcludedPanel((v) => !v)} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t(`الصفوف المستبعدة (${excludedRows.length})`, `Excluded Rows (${excludedRows.length})`, language)}</button>
            <button
              type="button"
              onClick={handleExportErrorReport}
              disabled={summary.totalRows - selectionCounts.willImport === 0}
              className="px-2.5 py-1.5 text-amber-700 hover:bg-amber-50 border border-amber-200 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              {t('تصدير تقرير الأخطاء/المستبعد', 'Export Error/Skipped Report', language)}
            </button>
          </div>

          {/* Excluded rows repair panel (§36-38) */}
          {showExcludedPanel && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
              {excludedRows.length === 0 ? (
                <p className="text-[11px] text-slate-500">{t('لا توجد صفوف مستبعدة.', 'No excluded rows.', language)}</p>
              ) : (
                excludedRows.map((row) => (
                  <div key={row.rowIndex} className="flex items-center justify-between bg-white p-2 rounded-lg border border-slate-200 text-[11px]">
                    <span className="font-bold text-slate-700">#{row.rowIndex} - {row.customerNameRaw || row.millTypeRaw} ({row.exclusionReason})</span>
                    <div className="flex items-center gap-1.5">
                      {canEditPending && <button type="button" onClick={() => openEditRow(row.rowIndex)} className="px-2 py-1 bg-sky-50 text-sky-700 rounded-md cursor-pointer">{t('تعديل', 'Edit', language)}</button>}
                      {canManageImport && <button type="button" onClick={() => handleReincludeRow(row.rowIndex)} className="px-2 py-1 bg-emerald-50 text-emerald-700 rounded-md cursor-pointer">{t('إعادة إدراج', 'Re-include', language)}</button>}
                      {canDeletePermanently && <button type="button" onClick={() => setDeleteConfirm({ rowIndexes: [row.rowIndex] })} className="px-2 py-1 bg-red-50 text-red-700 rounded-md cursor-pointer">{t('حذف نهائي', 'Delete Permanently', language)}</button>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Pending Records (Part 6 CRITICAL) - a row that cannot currently be
              completed is parked here, never permanently lost. */}
          <div id="cm-pending-section" className="p-3 bg-red-50/40 border border-red-200 rounded-xl space-y-2 scroll-mt-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="text-xs font-black text-red-900 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" />
                {t(`السجلات المعلقة (${pendingRows.length})`, `Pending Records (${pendingRows.length})`, language)}
              </h3>
              {pendingRows.length > 0 && canEditPending && (
                <button
                  type="button"
                  disabled={pendingSelected.size === 0 || isRevalidatingPending}
                  onClick={handleRevalidateSelectedPending}
                  className="text-[11px] font-bold text-red-800 bg-red-100 hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1.5 rounded-lg cursor-pointer flex items-center gap-1"
                >
                  {isRevalidatingPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {t(`إعادة الفحص المحدد (${pendingSelected.size})`, `Revalidate Selected (${pendingSelected.size})`, language)}
                </button>
              )}
            </div>
            {pendingRows.length === 0 ? (
              <p className="text-[11px] text-slate-500">{t('لا توجد سجلات معلقة.', 'No pending records.', language)}</p>
            ) : (
              renderInvalidStyleTable(pendingRows)
            )}
          </div>

          {/* Row-Based Review table (Part 1 §1-2): one Excel row = one review row */}
          {renderMainReviewTable(filteredRows)}

          {/* Import execution - sticky so it stays reachable without extra
              page scrolling once the table above is viewport-bounded. */}
          {isImporting ? (
            <div className="space-y-2 pt-2 border-t border-slate-100 sticky bottom-0 bg-white z-10">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>{cancelRequested ? t('جارٍ إلغاء الرفع بعد إتمام الدفعة الحالية', 'Canceling import after the current batch completes', language) : t('جاري إرسال السجلات...', 'Writing records...', language)}</span>
                <span>{importProgress}%</span>
              </div>
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className={`h-full transition-all duration-300 ${cancelRequested ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{ width: `${importProgress}%` }} />
              </div>
              {/* §7: cancellation is only ever applied at the NEXT batch boundary (400 rows/batch) - never mid-batch, since a writeBatch().commit() already in flight cannot be safely interrupted without rebuilding the import engine. */}
              <div className="flex justify-end">
                <button type="button" disabled={cancelRequested} onClick={handleCancelDuringImport} className="px-3 py-1.5 text-[11px] font-bold text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer">
                  {cancelRequested ? t('تم طلب الإلغاء...', 'Cancellation requested...', language) : t('إلغاء الرفع', 'Cancel Import', language)}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 sticky bottom-0 bg-white z-10">
              <button type="button" disabled={writableRows.length === 0} onClick={handleStartImport} className="flex items-center gap-2 px-6 py-2.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-md cursor-pointer">
                <CheckCircle2 className="w-4 h-4" />
                {t(`اعتماد ورفع السجلات المحددة (${writableRows.length})`, `Approve & Import Selected Records (${writableRows.length})`, language)}
              </button>
            </div>
          )}
        </div>
      )}

      {importResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto"><CheckCircle2 className="w-7 h-7" /></div>
          <h2 className="text-lg font-black text-emerald-950">{t('تم الانتهاء من عملية الاستيراد', 'Import completed', language)}</h2>
          <p className="text-xs text-emerald-800 font-mono">{t('رقم العملية', 'Batch ID', language)}: {importResult.importId}</p>
          <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-bold bg-white/70 p-4 rounded-xl border border-emerald-200 max-w-2xl mx-auto">
            <div><span className="text-slate-500 block text-[11px]">{t('الإجمالي', 'Total', language)}</span><span className="text-base font-black">{importResult.total}</span></div>
            <div><span className="text-emerald-700 block text-[11px]">{t('مستورد', 'Imported', language)}</span><span className="text-base font-black text-emerald-600">{importResult.imported}</span></div>
            <div><span className="text-red-700 block text-[11px]">{t('معلق', 'Pending', language)}</span><span className="text-base font-black text-red-600">{importResult.pending}</span></div>
            <div><span className="text-slate-600 block text-[11px]">{t('مستبعد', 'Excluded', language)}</span><span className="text-base font-black text-slate-700">{importResult.excluded}</span></div>
            <div><span className="text-amber-700 block text-[11px]">{t('متخطى', 'Skipped', language)}</span><span className="text-base font-black text-amber-600">{importResult.skipped}</span></div>
            {importResult.failed > 0 && <div><span className="text-red-700 block text-[11px]">{t('فشل', 'Failed', language)}</span><span className="text-base font-black text-red-600">{importResult.failed}</span></div>}
            {importResult.cancelled > 0 && <div><span className="text-orange-700 block text-[11px]">{t('ملغى', 'Cancelled', language)}</span><span className="text-base font-black text-orange-600">{importResult.cancelled}</span></div>}
          </div>
          {importResult.cancelled > 0 && (
            <p className="text-[11px] text-orange-800 bg-orange-50 border border-orange-200 rounded-lg p-2 max-w-2xl mx-auto">
              {t('تم إلغاء الرفع قبل اكتمال جميع السجلات. السجلات المستوردة بالفعل باقية كما هي، والسجلات المتبقية ما زالت محددة وجاهزة - يمكنك الضغط على "اعتماد ورفع" مرة أخرى لإكمالها.', 'Import was cancelled before all records finished. Already-imported records remain as-is, and the remaining records are still selected and ready - click "Approve & Import" again to continue.', language)}
            </p>
          )}
        </div>
      )}

      {/* Approve Invalid Records task §6: Approve All Records confirmation - a consequential business decision, never applied silently. */}
      {approveAllConfirm && (
        <Modal isOpen onClose={() => setApproveAllConfirm(null)} title={t('اعتماد جميع السجلات', 'Approve All Records', language)} maxWidth="sm">
          <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
            <p className="text-slate-800">
              {t(
                `سيتم اعتماد ${approveAllConfirm.count} سجل من السجلات التي تحتاج مراجعة، وستصبح مؤهلة للرفع وفقًا لسياسة الاعتماد. هل تريد المتابعة؟`,
                `${approveAllConfirm.count} records requiring review will be approved and become eligible for import under the approval policy. Continue?`,
                language
              )}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setApproveAllConfirm(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
              <button type="button" onClick={() => handleApproveAllInWindow(approveAllConfirm.scopeRowIndexes)} className="px-4 py-2 text-xs font-black text-white bg-sky-600 hover:bg-sky-700 rounded-lg cursor-pointer">{t('اعتماد', 'Approve', language)}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* §15: Cancel Entire Import confirmation - distinct action, distinct dialog. */}
      {showCancelEntireConfirm && (
        <Modal isOpen onClose={() => setShowCancelEntireConfirm(false)} title={t('إلغاء عملية الرفع بالكامل', 'Cancel Entire Import', language)} maxWidth="sm">
          <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
            <p className="text-slate-800">
              {t('سيتم إلغاء عملية الرفع بالكامل ولن يتم تسجيل السجلات المتبقية. هل تريد المتابعة؟', 'The entire import operation will be cancelled and the remaining records will not be imported. Continue?', language)}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setShowCancelEntireConfirm(false)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('رجوع', 'Back', language)}</button>
              <button type="button" onClick={handleCancelEntireImport} className="px-4 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer">{t('إلغاء عملية الرفع', 'Cancel Import', language)}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Final Import Confirmation (§20-21) */}
      {showFinalConfirm && summary && (
        <Modal isOpen onClose={() => setShowFinalConfirm(false)} title={t('اعتماد ورفع السجلات المحددة', 'Approve & Import Selected Records', language)} maxWidth="sm">
          <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
            <p className="font-bold text-slate-900">
              {t(`سيتم رفع ${writableRows.length} سجل`, `${writableRows.length} records will be imported`, language)}
              <br />
              {t(`وسيبقى ${summary.totalRows - writableRows.length} سجل دون رفع`, `and ${summary.totalRows - writableRows.length} records will remain unimported`, language)}
            </p>
            <p className="text-xs text-slate-600">{t('سيتم إعادة فحص السجلات المحددة مقابل أحدث البيانات الأساسية قبل الرفع مباشرة. السجلات المعلقة أو المستبعدة أو ذات التحذيرات غير المعتمدة لن يتم استيرادها الآن ويمكن معالجتها لاحقًا دون إعادة رفع الملف.', 'The selected records will be revalidated against the latest Master Data immediately before writing. Pending, Excluded, or warning-not-yet-approved records will not be imported now and can be fixed later without re-uploading the file.', language)}</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setShowFinalConfirm(false);
                  logAuditAction('BULK_IMPORT', 'stage_chinese_mills', undefined, `[ROW_REVIEW_CANCELLED] استيراد الطواحين الصينية - تم إلغاء الرفع قبل التنفيذ - ${writableRows.length} سجل كان سيتم رفعه`).catch(() => {});
                }}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                {t('إلغاء الرفع', 'Cancel Import', language)}
              </button>
              <button type="button" onClick={handleConfirmImport} className="px-4 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer">{t('تأكيد', 'Confirm', language)}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* §4/§9: bounded Review Window - Valid/Ready/Corrected reuse the main
          review table; Invalid/Needs Review (live or reopened Draft) reuses
          the Pending-style table. A custom wide shell (not the shared Modal,
          which caps at max-w-4xl) so a 12+ column table has room, while
          matching the SAME established scroll convention used everywhere
          else in this app (overflow-x/y-auto, max-h, sticky header, sticky
          footer, §24-25). */}
      {reviewWindow && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60" onClick={closeReviewWindow}>
          <div className="w-full max-w-[96vw] xl:max-w-[1400px] max-h-[92vh] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()} dir={isRtl ? 'rtl' : 'ltr'}>
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50/70 shrink-0">
              <div>
                <h3 className="text-sm font-black text-slate-900">
                  {reviewWindow.mode === 'ALL' && t('مراجعة جميع السجلات المحددة', 'Review All Selected Records', language)}
                  {reviewWindow.mode === 'VALID' && t('مراجعة السجلات الصالحة', 'Review Valid Records', language)}
                  {reviewWindow.mode === 'READY' && t('مراجعة السجلات الجاهزة', 'Review Ready Records', language)}
                  {reviewWindow.mode === 'CORRECTED' && t('مراجعة السجلات المصححة', 'Review Corrected Records', language)}
                  {reviewWindow.mode === 'INVALID' && reviewWindow.source === 'DRAFT' && t('فتح مسودة - الطواحين الصينية', 'Open Draft - Chinese Mills', language)}
                  {reviewWindow.mode === 'INVALID' && reviewWindow.source === 'LIVE' && t('مراجعة السجلات التي تحتاج مراجعة', 'Review Invalid / Needs-Review Records', language)}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {t(
                    `عدد السجلات: ${reviewWindowRows.length} · المحدد: ${reviewWindowSelectedCount} · سيتم استيراده: ${reviewWindowWillImportCount}`,
                    `Records: ${reviewWindowRows.length} · Selected: ${reviewWindowSelectedCount} · Will Import: ${reviewWindowWillImportCount}`,
                    language
                  )}
                </p>
              </div>
              <button type="button" onClick={closeReviewWindow} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            {/* Body: bounded, internally scrollable table(s) */}
            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {reviewWindow.mode === 'ALL' ? (
                <>
                  {allWindowInvalidRows.length > 0 && (
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-black text-red-800">{t(`يحتاج مراجعة (${allWindowInvalidRows.length})`, `Needs Review (${allWindowInvalidRows.length})`, language)}</h4>
                      {renderInvalidStyleTable(allWindowInvalidRows, 'REVIEW')}
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <h4 className="text-xs font-black text-emerald-800">{t(`جاهز/صالح (${allWindowMainRows.length})`, `Ready/Valid (${allWindowMainRows.length})`, language)}</h4>
                    {renderMainReviewTable(allWindowMainRows)}
                  </div>
                </>
              ) : reviewWindow.mode === 'INVALID' ? (
                renderInvalidStyleTable(reviewWindowRows, 'REVIEW')
              ) : (
                renderMainReviewTable(reviewWindowRows)
              )}
            </div>

            {/* Footer: mode-dependent action bar (§6/§13/§16), always reachable. */}
            <div className="px-5 py-3.5 border-t border-slate-100 bg-white shrink-0 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[11px] font-bold">
                {/* §2-4/§17: scoped to exactly the rows THIS window is showing (reviewWindowRows), never the whole dataset - the fix for the reported bug. Works regardless of scroll position/off-screen rows since it iterates the underlying row array, never the rendered DOM. */}
                <button type="button" onClick={() => handleScopedBulkSelection('ALL', new Set(reviewWindowRows.map((r) => r.rowIndex)))} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('تحديد الكل', 'Select All', language)}</button>
                <button type="button" onClick={() => handleScopedBulkSelection('NONE', new Set(reviewWindowRows.map((r) => r.rowIndex)))} className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء تحديد الكل', 'Deselect All', language)}</button>
                {/* §5-6: Approve All Records - only where this window can actually show blocking rows, and only enabled when at least one is approvable right now. */}
                {canManageImport && reviewWindowApprovableRows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setApproveAllConfirm({ scopeRowIndexes: new Set(reviewWindowApprovableRows.map((r) => r.rowIndex)), count: reviewWindowApprovableRows.length })}
                    className="px-2.5 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 rounded-lg cursor-pointer"
                  >
                    {t(`اعتماد جميع السجلات (${reviewWindowApprovableRows.length})`, `Approve All Records (${reviewWindowApprovableRows.length})`, language)}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {reviewWindow.source === 'LIVE' && canManageImport && (
                  <button type="button" onClick={handleSaveDraft} className="px-4 py-2 text-xs font-bold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer">{t('حفظ كمسودة', 'Save as Draft', language)}</button>
                )}
                {reviewWindow.mode === 'INVALID' && canDeletePermanently && (
                  <button
                    type="button"
                    onClick={() => {
                      if (reviewWindow.source === 'DRAFT') {
                        handleDeleteDraft();
                        closeReviewWindow();
                      } else {
                        setDeleteConfirm({ rowIndexes: reviewWindowRows.map((r) => r.rowIndex) });
                      }
                    }}
                    className="px-4 py-2 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg cursor-pointer"
                  >
                    {t('مسح', 'Delete', language)}
                  </button>
                )}
                <button type="button" onClick={closeReviewWindow} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
                <button
                  type="button"
                  disabled={writableRows.length === 0}
                  onClick={() => { closeReviewWindow(); handleStartImport(); }}
                  className="px-4 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer"
                >
                  {t(`استيراد البيانات (${writableRows.length})`, `Import Data (${writableRows.length})`, language)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Permanently Confirmation (§38 - current session only) */}
      {deleteConfirm && (
        <Modal isOpen onClose={() => setDeleteConfirm(null)} title={t('حذف نهائي', 'Delete Permanently', language)} maxWidth="sm">
          <div className="space-y-3 text-sm" dir={isRtl ? 'rtl' : 'ltr'}>
            <p>{t('سيتم حذف هذا الصف من جلسة الاستيراد الحالية فقط. لن يتم حذف أي بيانات إنتاج أو بيانات أساسية أو الملف الأصلي.', 'This row will be removed from the CURRENT import session only. No production data, Master Data, or the original file will be deleted.', language)}</p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
              <button type="button" onClick={() => handleDeletePermanently(deleteConfirm.rowIndexes)} className="px-4 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer">{t('حذف', 'Delete', language)}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bulk Add Master Data */}
      {bulkAddDomain && (
        <BatchAddMasterDataModal
          isOpen={!!bulkAddDomain}
          onClose={() => setBulkAddDomain(null)}
          items={missingEntitiesForBulkAdd.filter((i) => i.domain === bulkAddDomain)}
          existingItemsForDomain={existingItemsForBulkDomain}
          onBatchCreated={handleBulkCreated}
        />
      )}

      {/* Full Row Edit Modal (§29) */}
      {editRowState && editDraft && (
        <Modal isOpen onClose={() => { setEditRowState(null); setEditDraft(null); }} title={t('تعديل السجل بالكامل', 'Edit Entire Row', language)} maxWidth="2xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
            {[
              { key: 'date', label: t('التاريخ', 'Date', language), type: 'date' },
              { key: 'customerNameRaw', label: t('اسم العميل', 'Customer Name', language), type: 'text' },
              { key: 'specificationCodeRaw', label: t('كود المواصفة', 'Specification Code', language), type: 'text' },
              { key: 'millTypeRaw', label: t('نوع الطاحونة', 'Mill Type', language), type: 'text' },
              { key: 'shiftRaw', label: t('الوردية', 'Shift', language), type: 'text' },
              { key: 'productionQuantityRaw', label: t('كمية الإنتاج (طن)', 'Production Quantity (Tons)', language), type: 'number' },
              { key: 'numberOfBagsRaw', label: t('عدد الجواني', 'Number of Bags', language), type: 'number' },
              { key: 'rejectedQuantityRaw', label: t('المرفوض', 'Rejected Quantity', language), type: 'number' },
              { key: 'operatingMinutesRaw', label: t('دقائق التشغيل', 'Operating Minutes', language), type: 'number' },
              { key: 'operatingHoursRaw', label: t('ساعات التشغيل', 'Operating Hours', language), type: 'number' },
              { key: 'downtimeHoursRaw', label: t('ساعات الأعطال', 'Downtime Hours', language), type: 'number' },
              { key: 'faultTypeRaw', label: t('نوع العطل', 'Fault Type', language), type: 'text' },
              { key: 'specification', label: t('المواصفة', 'Specification', language), type: 'text' },
              { key: 'weightClassRaw', label: t('فئة الوزن (كجم)', 'Weight Class (kg)', language), type: 'number' },
              { key: 'theoreticalRateRaw', label: t('المعدل النظري (طن)', 'Theoretical Rate (Tons)', language), type: 'number' },
              { key: 'actualRateRaw', label: t('المعدل الفعلي (طن)', 'Actual Rate (Tons)', language), type: 'number' },
              { key: 'notes', label: t('ملاحظات', 'Notes', language), type: 'text' },
            ].map((f) => (
              <div key={f.key}>
                <label className="block font-bold text-slate-600 mb-1">{f.label}</label>
                <input
                  type={f.type}
                  value={(editDraft as any)[f.key]}
                  onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))}
                  className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 pt-4 mt-2 border-t border-slate-100">
            <button type="button" onClick={() => { setEditRowState(null); setEditDraft(null); }} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{t('إلغاء', 'Cancel', language)}</button>
            <button type="button" onClick={saveEditRow} className="px-4 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer">{t('حفظ وإعادة الفحص', 'Save & Revalidate', language)}</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

/**
 * ASFOUR Factory Management ERP - Historical Data Import Center
 * 
 * Specialized Historical Excel Importer:
 * - Full support for مرحلة التشكيل والمكابس (Pressing) with 21 strict columns.
 * - Smart Fuzzy Matching with Human Review & Interactive Decision Matrix.
 * - Deep validation: Multi-worker resolution, multi-furnace car splitting,
 *   press & shift (1/2) resolution, smart vs manual product code intelligence,
 *   fault summation breakdown verification, in-file & database duplicate checks.
 * - Pre-import safety: One-click Firestore Backup generation.
 * - Granular preview with multi-status filtering & diagnostics.
 * - Safe chunked batch commits (400 per batch), approved mappings persistence, and batch rollback.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  ChevronDown,
  Check,
  X,
  History,
  RotateCcw,
  CheckCheck,
  Search,
  Plus,
  ShieldAlert,
  CheckCircle,
  Ban,
  Edit3
} from 'lucide-react';
import {
  ProductionStageType,
  PressingImportSummary,
  PressingImportRow,
  PressingImportStatus,
  RowVersion,
  RowFieldChange,
} from '../../types';
import {
  downloadStageExcelTemplate,
  downloadPressingExcelTemplate,
  parseAndValidatePressingExcel,
  executePressingBatchImport,
  recheckPressingDatabaseDuplicates,
  parseExcelFile,
  validateImportRows,
  executeBatchImport,
  StageImportRow,
  ImportValidationResult
} from '../../services/historicalImportService';
import { EntityType } from '../common/SmartEntitySelect';
import { STAGE_DISPLAY_NAMES } from '../../services/stageRecordService';
import { createDatabaseBackup } from '../../services/backupService';
import { 
  getHistoricalImportHistory, 
  rollbackImportBatch, 
  saveApprovedMappingBatch,
  ImportAuditEntry 
} from '../../services/importMappingService';
import { fetchMasterData } from '../../services/masterDataService';
import { logAuditAction } from '../../services/auditService';
import * as XLSX from 'xlsx';
import { parseMultiCodeValue, parseFurnaceCarBrickPairs } from '../../utils/multiCodeParser';
import { VALID_SHIFT_NUMBERS, parseShiftNumber, buildShiftDisplayName, buildShiftCode } from '../../utils/shiftUtils';
import { evaluateProductionWarnings, buildInvalidShiftMessage } from '../../utils/businessValidationRules';
import { normalizeArabicForComparison, normalizeCodeForComparison } from '../../utils/fuzzyMatching';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { SearchableCombobox, ComboboxOption } from '../common/SearchableCombobox';
import { formatNumber, formatDecimal, formatDateTime } from '../../utils/formatters';
import { useLanguage } from '../../i18n/LanguageContext';
import { getStatusLabel } from '../../i18n/statusLabels';
import { useAuth } from '../../context/AuthContext';
import { useSetAssistantSelection } from '../../context/AssistantSelectionContext';
import { InlineMasterDataAddModal } from './InlineMasterDataAddModal';
import { BatchAddMasterDataModal, MissingEntityItem } from './BatchAddMasterDataModal';
import { ChineseMillsImportPanel } from './ChineseMillsImportPanel';
import { TubeBallMillsImportPanel } from './TubeBallMillsImportPanel';
import {
  getRowSelection,
  isRowReadyToImport,
  wasRowManuallyCorrected,
  getRowCategory,
  needsWarningAcceptance,
  isRowWritable,
  computePressingBulkOutcome,
  computePressingPartialImportSummary,
} from '../../services/pressingSelectionPure';

type FilterTab = 'ALL' | 'VALID' | 'MATCHES' | 'WARNINGS' | 'ERRORS' | 'DUPLICATES';

/**
 * Value-level mapping key for global propagation of Approve/Add/Skip decisions
 * across every row of the CURRENT uploaded file that shares the same field
 * context + normalized imported value. Uses the SAME canonical normalizers
 * already used by the fuzzy-matching engine (src/utils/fuzzyMatching.ts) -
 * normalizeCodeForComparison for code-shaped multi-entity fields (furnace
 * cars), normalizeArabicForComparison for everything else - so this never
 * introduces a second, incompatible normalization scheme, and never merges
 * values across different fieldDomains (press "209" stays separate from
 * furnaceCar "209").
 */
const DOMAIN_BULK_LABELS: Record<'furnaceCar' | 'employee' | 'press' | 'product', { ar: string; en: string; arButton: string; enButton: string }> = {
  furnaceCar: { ar: 'عربات الأفران', en: 'Furnace Cars', arButton: 'إضافة جميع العربات', enButton: 'Add All Furnace Cars' },
  employee: { ar: 'العمال', en: 'Employees', arButton: 'إضافة جميع العمال', enButton: 'Add All Employees' },
  press: { ar: 'المكابس', en: 'Presses', arButton: 'إضافة جميع المكابس', enButton: 'Add All Presses' },
  product: { ar: 'الأصناف', en: 'Products', arButton: 'إضافة جميع الأصناف', enButton: 'Add All Products' },
};

function buildValueMappingKey(fieldDomain: string, rawValue: string): string {
  const normalized = (fieldDomain === 'furnaceCar' || fieldDomain === 'car')
    ? normalizeCodeForComparison(rawValue)
    : normalizeArabicForComparison(rawValue);
  return `${fieldDomain}::${normalized}`;
}

// ============================================================================
// PARTIAL IMPORT - row-level selection/category helpers
// A blocking error on one row must never block the rest of the file. These
// are pure, derived functions (no new stored status enum) so selection state
// can never drift out of sync with the row's actual validity. Moved to
// pressingSelectionPure.ts (Firebase-free, unit-tested) - this is the single
// authoritative source, imported below, never redefined here.
// ============================================================================

// ============================================================================
// PART 2 - Structured "what's missing" instead of a generic incomplete-row
// message. Maps the actual error strings the parser already produces (see
// pressingHistoricalImportService.ts) to a canonical REQUIRED field label -
// this is presentation only, it never changes which fields are required.
// ============================================================================
const REQUIRED_FIELD_LABELS: Array<{ keyword: string; ar: string; en: string }> = [
  { keyword: 'تاريخ', ar: 'التاريخ', en: 'Date' },
  { keyword: 'عامل 1', ar: 'عامل 1', en: 'Worker 1' },
  { keyword: 'المكبس', ar: 'المكبس', en: 'Press' },
  { keyword: 'الوردية', ar: 'الوردية', en: 'Shift' },
  { keyword: 'الصنف', ar: 'الصنف / المنتج', en: 'Product' },
  { keyword: 'المنتج', ar: 'الصنف / المنتج', en: 'Product' },
  { keyword: 'كمية الإنتاج', ar: 'كمية الإنتاج', en: 'Production Quantity' },
  { keyword: 'الهالك', ar: 'كمية الهالك', en: 'Waste Quantity' },
  { keyword: 'عربة', ar: 'عربات الأفران', en: 'Furnace Cars' },
  { keyword: 'عامل 2', ar: 'عامل 2 (اختياري، لكن القيمة المُدخلة غير مطابقة)', en: 'Worker 2 (optional, but the entered value did not resolve)' },
];

function deriveMissingRequiredFields(row: PressingImportRow): Array<{ ar: string; en: string }> {
  const found: Array<{ ar: string; en: string }> = [];
  const seen = new Set<string>();
  for (const err of row.errors) {
    for (const item of REQUIRED_FIELD_LABELS) {
      if (err.includes(item.keyword) && !seen.has(item.ar)) {
        seen.add(item.ar);
        found.push({ ar: item.ar, en: item.en });
      }
    }
  }
  return found;
}

// ============================================================================
// Versioned, revertible row edit history (§11-16). Each RowVersion is a FULL
// snapshot of the row's editable fields (not a diff-only patch), so reverting
// to any earlier version is a plain snapshot restore - never a partial/lossy
// merge. changedFields is a derived display convenience computed from two
// snapshots, never the source of truth for revert.
// ============================================================================

const VERSIONED_FIELD_KEYS: Array<keyof PressingImportRow> = [
  'date', 'worker1Name', 'worker1Code', 'resolvedWorker1', 'worker2Name', 'worker2Code', 'resolvedWorker2',
  'pressRaw', 'resolvedPress', 'productCodeRaw', 'productNameRaw', 'resolvedProduct',
  'furnaceCarsRaw', 'furnaceCarTokens', 'resolvedFurnaceCars', 'furnaceCarNumbers', 'furnaceCarIds', 'furnaceCarBrickCounts', 'carCodes',
  'customerOrder', 'shiftRaw', 'resolvedShift', 'aluminaPercentage', 'pieceWeight',
  'productionQuantity', 'wasteQuantity', 'goodQuantity', 'productionWeight', 'wasteWeight', 'goodWeight', 'wastePercentage',
  'mechanicalFaults', 'electricalFaults', 'workshopFaults', 'rawMaterialFaults', 'otherFaults', 'calculatedTotalFaults',
];

function snapshotRowFields(row: PressingImportRow): Record<string, any> {
  const snap: Record<string, any> = {};
  for (const key of VERSIONED_FIELD_KEYS) {
    const value = (row as any)[key];
    snap[key] = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  return snap;
}

function applySnapshotToRow(row: PressingImportRow, snapshot: Record<string, any>): PressingImportRow {
  return { ...row, ...JSON.parse(JSON.stringify(snapshot)) };
}

/** Human-readable subset of VERSIONED_FIELD_KEYS shown in the changedFields diff / History UI. */
const DISPLAY_FIELD_LABELS: Record<string, { ar: string; en: string }> = {
  date: { ar: 'التاريخ', en: 'Date' },
  worker1Name: { ar: 'عامل 1', en: 'Worker 1' },
  worker2Name: { ar: 'عامل 2', en: 'Worker 2' },
  pressRaw: { ar: 'المكبس', en: 'Press' },
  productNameRaw: { ar: 'الصنف', en: 'Product' },
  productCodeRaw: { ar: 'كود الصنف', en: 'Product Code' },
  furnaceCarsRaw: { ar: 'عربات الأفران وعدد الطوب', en: 'Furnace Cars & Brick Count' },
  customerOrder: { ar: 'طلب العميل', en: 'Customer Order' },
  shiftRaw: { ar: 'الوردية', en: 'Shift' },
  aluminaPercentage: { ar: 'الألومينا %', en: 'Alumina %' },
  pieceWeight: { ar: 'وزن القطعة', en: 'Piece Weight' },
  productionQuantity: { ar: 'كمية الإنتاج', en: 'Production Quantity' },
  wasteQuantity: { ar: 'كمية الهالك', en: 'Waste Quantity' },
  mechanicalFaults: { ar: 'أعطال ميكانيكا', en: 'Mechanical Faults' },
  electricalFaults: { ar: 'أعطال كهرباء', en: 'Electrical Faults' },
  workshopFaults: { ar: 'أعطال ورشة', en: 'Workshop Faults' },
  rawMaterialFaults: { ar: 'أعطال خامات', en: 'Raw Material Faults' },
  otherFaults: { ar: 'أعطال أخرى', en: 'Other Faults' },
};

function diffRowSnapshots(before: Record<string, any>, after: Record<string, any>): RowFieldChange[] {
  const changes: RowFieldChange[] = [];
  for (const key of Object.keys(DISPLAY_FIELD_LABELS)) {
    const oldValue = before[key];
    const newValue = after[key];
    if (JSON.stringify(oldValue ?? null) !== JSON.stringify(newValue ?? null)) {
      changes.push({ fieldName: key, oldValue, newValue });
    }
  }
  return changes;
}

function validationSnapshot(row: PressingImportRow): RowVersion['validationBefore'] {
  return { status: row.status, errorCount: row.errors.length, errors: [...row.errors] };
}

/**
 * Re-runs the SAME required-field checks handleSaveRowEdit applies, but
 * purely from the row's OWN current resolved fields rather than a draft form
 * - powers the standalone "Revalidate" action (§6/§22) and bulk repair
 * (§23), which change a row's data without going through the full editor.
 */
function computeRowValidation(row: PressingImportRow): { errors: string[]; warnings: string[]; warningCodes: string[]; status: PressingImportStatus } {
  const FIELD_ERROR_KEYWORDS = ['تاريخ', 'عامل 1', 'عامل 2', 'المكبس', 'الوردية', 'الصنف', 'المنتج', 'عربة', 'كمية الإنتاج'];
  const preservedErrors = row.errors.filter((e) => !FIELD_ERROR_KEYWORDS.some((kw) => e.includes(kw)));
  const newErrors = [...preservedErrors];
  // Waste-related BUSINESS warnings (waste > production, high waste %) live in
  // `warnings`, never `errors` - only a genuinely invalid/negative number is
  // a technical BLOCKING failure. Preserve any other pre-existing warning
  // this function doesn't recompute (e.g. fault-total mismatch from parsing).
  const BUSINESS_WARNING_CODES = ['WASTE_GREATER_THAN_PRODUCTION', 'HIGH_WASTE_PERCENTAGE', 'HIGH_DOWNTIME'];
  const BUSINESS_WARNING_KEYWORDS = ['كمية الهالك أكبر من كمية الإنتاج', 'نسبة الهالك مرتفعة', 'مدة التوقف مرتفعة'];
  const preservedWarnings = row.warnings.filter((w) => !BUSINESS_WARNING_KEYWORDS.some((kw) => w.includes(kw)));
  const preservedWarningCodes = (row.warningCodes || []).filter((c) => !BUSINESS_WARNING_CODES.includes(c));
  const newWarnings = [...preservedWarnings];
  const newWarningCodes = [...preservedWarningCodes];

  if (!row.date) newErrors.push('يرجى تحديد تاريخ عملية الإنتاج.');
  if (!row.resolvedWorker1) newErrors.push('لم يتم اختيار عامل 1 (حقل إلزامي).');
  if ((row.worker2Name || row.worker2Code) && !row.resolvedWorker2) newErrors.push('عامل 2 المحدد غير موجود ببيانات الموظفين.');
  if (!row.resolvedPress) newErrors.push('لم يتم اختيار المكبس (حقل إلزامي).');
  if (!row.resolvedShift) newErrors.push(buildInvalidShiftMessage(row.shiftRaw, 'ar'));
  if (!row.resolvedProduct) newErrors.push('لم يتم اختيار الصنف (حقل إلزامي).');
  if (!row.productionQuantity || isNaN(row.productionQuantity) || row.productionQuantity <= 0) newErrors.push('إجمالي كمية الإنتاج يجب أن تكون أكبر من الصفر.');
  if (isNaN(row.wasteQuantity) || row.wasteQuantity < 0) newErrors.push('كمية الهالك غير صالحة.');
  else {
    for (const w of evaluateProductionWarnings({ productionQuantity: row.productionQuantity, wasteQuantity: row.wasteQuantity, calculatedTotalFaults: row.calculatedTotalFaults, shiftHours: row.resolvedShift?.hours }, 'ar')) {
      newWarnings.push(w.message);
      newWarningCodes.push(w.code);
    }
  }

  const seenCarIds = new Set<string>();
  (row.resolvedFurnaceCars || []).forEach((c) => {
    if (c.id) {
      if (seenCarIds.has(c.id)) newErrors.push(`العربة ${c.carNumber} مكررة بأكثر من إدخال في نفس الصف.`);
      seenCarIds.add(c.id);
    }
    if (c.brickCount == null || c.brickCount < 0 || !Number.isInteger(c.brickCount)) newErrors.push(`عدد الطوب للعربة ${c.carNumber} غير صالح.`);
  });

  let status: PressingImportStatus = row.status;
  if (newErrors.length === 0) status = newWarnings.length > 0 ? 'WARNING' : 'VALID';
  else if (row.status === 'VALID' || row.status === 'WARNING') status = 'INVALID_ROW';

  return { errors: newErrors, warnings: newWarnings, warningCodes: newWarningCodes, status };
}

/** Captured once, at the moment a row becomes EXCLUDED, and kept visible afterward even as the row is edited/repaired (§3). */
function buildExclusionReasonText(row: PressingImportRow, language: 'ar' | 'en'): string {
  if (row.errors.length > 0) return row.errors.join(' | ');
  if (row.warnings.length > 0) return language === 'ar' ? `تنبيهات: ${row.warnings.join(' | ')}` : `Warnings: ${row.warnings.join(' | ')}`;
  return language === 'ar' ? 'استبعاد يدوي (لا توجد أخطاء مانعة وقت الاستبعاد)' : 'Manually excluded (no blocking errors at the time of exclusion)';
}

export const DataImportView: React.FC = () => {
  const { language, isRtl } = useLanguage();
  const { adminUser, isSuperAdmin, hasPermission } = useAuth();
  const [selectedStage, setSelectedStage] = useState<ProductionStageType>('pressing');
  const setAssistantSelection = useSetAssistantSelection();

  useEffect(() => {
    setAssistantSelection({ currentStage: selectedStage, selectedEntityType: 'historicalImportRow' });
    return () => setAssistantSelection({});
  }, [selectedStage, setAssistantSelection]);

  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  
  // Pressing Stage Dedicated State
  const [pressingSummary, setPressingSummary] = useState<PressingImportSummary | null>(null);
  /** Stable client-side id for the current review session, used as RowVersion.importId so undo/history never crosses two different file uploads (§20). Regenerated every time a new file is parsed. */
  const [importSessionId, setImportSessionId] = useState<string>(() => `SESSION-${Date.now()}`);
  const [activeFilterTab, setActiveFilterTab] = useState<FilterTab>('ALL');

  // Transient feedback banner (e.g. "mapping applied to N matching records")
  const [feedback, setFeedback] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  // Inline Master Data Quick Add Modal State
  const [addedMasterDataCount, setAddedMasterDataCount] = useState<number>(0);
  const [existingMasterDataList, setExistingMasterDataList] = useState<any[]>([]);
  // Per-domain lists (same fetch, kept separate) - used for client-side
  // duplicate detection in the entity-specific Bulk Add table and for the
  // "Choose Existing" manual-selection dropdown, both scoped to ONE entity type.
  const [masterDataByDomain, setMasterDataByDomain] = useState<Record<'employee' | 'press' | 'product' | 'furnaceCar', any[]>>({
    employee: [],
    press: [],
    product: [],
    furnaceCar: [],
  });
  // Which entity-type's Bulk Add popup is currently open (null = closed). Only
  // one entity type's table is ever shown at a time - never mixed.
  const [bulkAddDomain, setBulkAddDomain] = useState<'furnaceCar' | 'employee' | 'press' | 'product' | null>(null);
  // Manual "Choose Existing" / "Manual Edit" picker state
  const [manualSelectState, setManualSelectState] = useState<{
    isOpen: boolean;
    domain: 'furnaceCar' | 'employee' | 'press' | 'product';
    importedValue: string;
    rowIndex: number;
    matchIndex?: number;
    /** The editable "corrected value" text - defaults to importedValue, user may retype it entirely. */
    editedValue: string;
    /** Whether this was opened via "تعديل يدوي" (emphasizes the edit field) vs "اختيار موجود" (goes straight to search). Purely a UX/focus hint - both offer the full edit+search+add capability. */
    mode: 'CHOOSE_EXISTING' | 'MANUAL_EDIT';
  } | null>(null);
  const [inlineAddModalState, setInlineAddModalState] = useState<{
    isOpen: boolean;
    domain: string;
    importedValue: string;
    targetRowIndex?: number;
    extraContext?: any;
    /**
     * The ORIGINAL row value to match/propagate against, when it differs
     * from `importedValue` (which is used only to pre-fill the Add form).
     * Set when opening from Manual Edit: importedValue = the user's
     * corrected text (what gets created), matchValue = the original
     * imported text (what other rows still contain and must match).
     */
    matchValue?: string;
  }>({
    isOpen: false,
    domain: 'product',
    importedValue: '',
  });

  // Partial Import: row-level "Edit Entire Row" modal state.
  // - autoReinclude: true when opened via "Edit & Re-import" on an already-EXCLUDED
  //   row (§12) - saving both validates AND flips rowSelection back to INCLUDED.
  // - queue: remaining rowIndexes still to edit when the user picked "Edit Selected"
  //   on multiple excluded rows at once (§13) - saving pops the next one open.
  const [editRowState, setEditRowState] = useState<{ isOpen: boolean; rowIndex: number; autoReinclude: boolean; queue: number[] } | null>(null);
  const [editRowDraft, setEditRowDraft] = useState<{
    date: string;
    worker1Id: string | null;
    worker2Id: string | null;
    pressId: string | null;
    productId: string | null;
    productCode: string;
    productName: string;
    furnaceCarEntries: Array<{ carId: string; brickCount: string }>;
    customerOrder: string;
    shift: '1' | '2' | '3' | '';
    aluminaPercentage: string;
    pieceWeight: string;
    productionQuantity: string;
    wasteQuantity: string;
    mechanicalFaults: string;
    electricalFaults: string;
    workshopFaults: string;
    rawMaterialFaults: string;
    otherFaults: string;
  } | null>(null);
  // Partial Import: final selective-import confirmation dialog
  const [showFinalImportConfirm, setShowFinalImportConfirm] = useState<boolean>(false);

  // Excluded Records screen (§11-16): its own selection scope, independent of the
  // main review table's row checkboxes, plus permanent-delete confirmation state.
  const [showExcludedRowsPanel, setShowExcludedRowsPanel] = useState<boolean>(false);
  const [selectedExcludedRowIndices, setSelectedExcludedRowIndices] = useState<Set<number>>(new Set());
  const [deleteConfirmState, setDeleteConfirmState] = useState<{ rowIndexes: number[] } | null>(null);
  /** §27 - search/filter within the Excluded Records screen only. */
  const [excludedSearchQuery, setExcludedSearchQuery] = useState<string>('');
  /** §11-16 - Version History modal (view/compare/revert), lazily opened per row (§31 performance: nothing is computed until opened). */
  const [historyModalRowIndex, setHistoryModalRowIndex] = useState<number | null>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [revertConfirmState, setRevertConfirmState] = useState<{ rowIndex: number; editId: string } | null>(null);
  /** §23 - Bulk Repair panel state, scoped to the currently-selected excluded rows. */
  const [showBulkRepairPanel, setShowBulkRepairPanel] = useState<boolean>(false);
  const [bulkRepairField, setBulkRepairField] = useState<'shift' | 'press' | 'worker1' | 'product'>('shift');
  const [bulkRepairValue, setBulkRepairValue] = useState<string>('');
  const [bulkRepairConfirm, setBulkRepairConfirm] = useState<boolean>(false);
  /** §3/§14 - single-row "Review Warnings -> Edit Data / Save Despite Warning" dialog. */
  const [warningReviewRowIndex, setWarningReviewRowIndex] = useState<number | null>(null);
  const [showBulkWarningAcceptConfirm, setShowBulkWarningAcceptConfirm] = useState<boolean>(false);
  /** §26 - running session counters for the Excluded Records summary panel (rows leave the `rows` array on delete, so these can't be derived after the fact). */
  const [sessionDeletedCount, setSessionDeletedCount] = useState<number>(0);
  const [sessionReincludedCount, setSessionReincludedCount] = useState<number>(0);

  // Preload master data items for duplicate validation
  useEffect(() => {
    const loadMasterDataForChecker = async () => {
      try {
        const [emps, presses, prods, cars] = await Promise.all([
          fetchMasterData('employees').catch(() => []),
          fetchMasterData('presses').catch(() => []),
          fetchMasterData('products').catch(() => []),
          fetchMasterData('furnaceCars').catch(() => []),
        ]);
        setExistingMasterDataList([...emps, ...presses, ...prods, ...cars]);
        setMasterDataByDomain({ employee: emps, press: presses, product: prods, furnaceCar: cars });
      } catch (err) {
        console.warn('Failed to preload master data for duplicate checker:', err);
      }
    };
    loadMasterDataForChecker();
  }, []);

  // Granular Permission Check for Inline Master Data Creation
  const canAddMasterData = React.useMemo(() => {
    if (isSuperAdmin) return true;
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    const perms = adminUser.permissions as Record<string, any> | undefined;
    if (perms?.['masterData.inlineAdd'] === true) return true;
    if (perms?.masterDataCreate === true) return true;
    if (perms?.['masterdata.view'] === true) return true;
    return false;
  }, [adminUser, isSuperAdmin]);

  // Manual Edit / Choose Existing (search+select, never creates anything)
  // requires only VIEW access to master data - a lower bar than Add, per the
  // existing granular permission model. A user without create/inline-add
  // permission can still search and select an existing record if they can
  // view master data at all.
  const canViewMasterData = React.useMemo(() => {
    if (isSuperAdmin) return true;
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    if (hasPermission('masterdata.view' as any)) return true;
    return canAddMasterData; // any role that can add can certainly also view/select
  }, [adminUser, isSuperAdmin, hasPermission, canAddMasterData]);

  /** §20 - reuses the existing granular permission system (no parallel architecture). Without this, a user can SEE a warning but never Save/Import Despite Warning - the button is disabled, not hidden, so the restriction is visible rather than silently bypassable. */
  const canOverrideWarnings = React.useMemo(() => {
    if (isSuperAdmin) return true;
    return hasPermission('validation.overrideWarnings');
  }, [isSuperAdmin, hasPermission]);

  // Generic Stage Fallback State (for other 7 stages)
  const [genericRawRows, setGenericRawRows] = useState<StageImportRow[]>([]);
  const [genericValidation, setGenericValidation] = useState<ImportValidationResult | null>(null);
  const [genericBulkAddEntityType, setGenericBulkAddEntityType] = useState<EntityType | null>(null);
  const [genericMasterDataByType, setGenericMasterDataByType] = useState<Partial<Record<EntityType, any[]>>>({});
  /**
   * Master Data Consolidation task - the ONE authoritative selection state
   * for the 6 generic-stage import screens (Rotary Furnace/Tube-Ball Mills/
   * Mortar & Concrete/Mixing/Lightweight Foam/Sorting), mirroring the
   * "selectedRowIds" convention Pressing already established via its own
   * row.rowSelection field. Previously these screens had NO selection
   * concept at all - Select All/Valid buttons didn't exist, and
   * handleStartImport's generic branch imported every valid row
   * unconditionally with no way to exclude any of them.
   */
  const [genericSelectedRowIndexes, setGenericSelectedRowIndexes] = useState<Set<number>>(new Set());

  /** Defaults to "every currently-valid row selected" whenever validation re-runs (new upload, bulk-add re-resolution, stage change) - mirrors Pressing's own select-all-valid-by-default behavior. */
  useEffect(() => {
    if (!genericValidation) {
      setGenericSelectedRowIndexes(new Set());
      return;
    }
    setGenericSelectedRowIndexes(new Set(genericValidation.validRows.map((r) => r.rowIndex)));
  }, [genericValidation]);

  const genericWillImportCount = useMemo(() => {
    if (!genericValidation) return 0;
    return genericValidation.validRows.filter((r) => genericSelectedRowIndexes.has(r.rowIndex)).length;
  }, [genericValidation, genericSelectedRowIndexes]);

  // Import Execution & Safety
  const [isCreatingBackup, setIsCreatingBackup] = useState<boolean>(false);
  const [backupId, setBackupId] = useState<string | null>(null);
  const [backupStatusMessage, setBackupStatusMessage] = useState<string | null>(null);
  
  const [isImporting, setIsImporting] = useState<boolean>(false);
  /**
   * AUDIT FINDING (Complete Historical Import History task, §3/§8): the
   * Pressing "Confirm" button had no disabled/guard state - only
   * setIsImporting(true) (async React state) protected against a second
   * invocation, which does not close a fast-double-click race. Each
   * invocation generates its own fresh ImportId and writes a full batch, so
   * a double-click could double-import the SAME rows under two different
   * ImportIds. A ref updates synchronously, closing the race
   * `disabled={isImporting}` alone cannot.
   */
  const isConfirmingPressingImportRef = useRef(false);
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

  // Import History & Rollback State
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [importHistory, setImportHistory] = useState<ImportAuditEntry[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [rollbackTargetBatch, setRollbackTargetBatch] = useState<ImportAuditEntry | null>(null);
  const [isRollingBack, setIsRollingBack] = useState<boolean>(false);
  const [rollbackSuccessMsg, setRollbackSuccessMsg] = useState<string | null>(null);

  // Clear all parsed state when switching stage or uploading new file
  const resetFileState = () => {
    setFile(null);
    setPressingSummary(null);
    setGenericRawRows([]);
    setGenericValidation(null);
    setImportResult(null);
    setImportProgress(0);
    setActiveFilterTab('ALL');
    setFeedback(null);
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
        setImportSessionId(`SESSION-${Date.now()}`);
        const hasProposedMatches = summary.rows.some(r => r.proposedMatches && r.proposedMatches.length > 0);
        if (hasProposedMatches) {
          setActiveFilterTab('MATCHES');
        }
      } else {
        const rows = await parseExcelFile(uploadedFile);
        setGenericRawRows(rows);
        const valResult = await validateImportRows(selectedStage, rows, language);
        setGenericValidation(valResult);
      }
    } catch (err: any) {
      console.error('File parsing error:', err);
      alert(language === 'ar' ? 'فشل قراءة ملف الـ Excel: ' + (err.message || 'تأكد من تنسيق الأعطال والبيانات') : 'Failed to parse Excel file: ' + err.message);
    } finally {
      setIsParsing(false);
    }
  };

  // One-click Backup before Import
  const handleCreateSafetyBackup = async () => {
    setIsCreatingBackup(true);
    setBackupStatusMessage(language === 'ar' ? 'جاري توليد نسخة احتياطية وقائية وحفظها...' : 'Generating safety backup snapshot...');
    try {
      const backup = await createDatabaseBackup(
        'PRE_IMPORT',
        `نسخة أمان وقائية قبل استيراد الإنتاج التاريخي لمرحلة ${STAGE_DISPLAY_NAMES[selectedStage]}`,
        (stage, pct) => setBackupStatusMessage(`${stage} (${pct}%)`),
        true
      );
      setBackupId(backup.backupId);
      setBackupStatusMessage(language === 'ar' ? `تم إنشاء النسخة الوقائية بنجاح (${backup.backupId}) وتنزيل الملف.` : `Safety backup created (${backup.backupId}).`);
    } catch (err: any) {
      console.error('Backup creation error:', err);
      setBackupStatusMessage((language === 'ar' ? 'تعذر إنشاء النسخة الاحتياطية تلقائياً: ' : 'Failed to create backup: ') + err.message);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  // Open Inline Master Data Quick Add Modal
  const handleOpenInlineAdd = (
    domain: string,
    importedValue: string,
    targetRowIndex?: number,
    extraContext?: any,
    matchValue?: string
  ) => {
    if (!canAddMasterData) {
      alert(language === 'ar' ? 'ليس لديك صلاحية إضافة بيانات أساسية أثناء الاستيراد (masterData.inlineAdd).' : 'You do not have permission to add master data during import.');
      return;
    }
    setInlineAddModalState({
      isOpen: true,
      domain,
      importedValue,
      targetRowIndex,
      extraContext,
      matchValue,
    });
  };

  // Callback when a Master Data record is created via inline modal
  const handleMasterDataCreated = async (createdItem: { id: string; code: string; name: string; [key: string]: any }) => {
    if (!pressingSummary) return;

    setAddedMasterDataCount(prev => prev + 1);
    setExistingMasterDataList(prev => [...prev, createdItem]);

    const domain = inlineAddModalState.domain;
    const targetRowIndex = inlineAddModalState.targetRowIndex;
    // Row-matching/propagation always uses the ORIGINAL imported value
    // (matchValue), even when the created record's name/code came from a
    // Manual Edit correction (importedValue pre-filled the Add form with the
    // corrected text) - other rows in the file still contain the original text.
    const importedVal = (inlineAddModalState.matchValue || inlineAddModalState.importedValue || '').trim();
    const normVal = importedVal.toLowerCase();
    const wasManualEdit = !!inlineAddModalState.matchValue && inlineAddModalState.matchValue.trim().toLowerCase() !== (inlineAddModalState.importedValue || '').trim().toLowerCase();

    // Persist approved mapping in Firestore for audit & future imports
    if (importedVal) {
      const mappingDomain = (domain === 'worker1' || domain === 'worker2' || domain === 'employee1' || domain === 'employee2') ? 'employee' : (domain === 'furnaceCar' || domain === 'car' ? 'furnace_car' : domain);
      saveApprovedMappingBatch([{
        domain: mappingDomain,
        originalValue: importedVal,
        mappedEntityId: createdItem.id,
        mappedEntityName: createdItem.name,
        mappedEntityCode: createdItem.code,
        confidence: 100,
        matchType: wasManualEdit ? 'MANUAL_EDIT_ADD' : 'MANUAL_INLINE_ADD',
      }]).catch(err => console.warn('Could not persist mapping:', err));
    }

    let affectedRowCount = 0;

    const updatedRows = pressingSummary.rows.map((row) => {
      let rowModified = false;
      const updatedRow = { ...row };

      // Worker 1
      if (domain === 'employee' || domain === 'worker1' || domain === 'employee1') {
        const isMatch = (row.worker1Name && row.worker1Name.trim().toLowerCase() === normVal) ||
                        (row.worker1Code && row.worker1Code.trim() === createdItem.code) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && !row.resolvedWorker1);
        if (isMatch) {
          updatedRow.worker1Code = createdItem.code || updatedRow.worker1Code;
          updatedRow.resolvedWorker1 = { id: createdItem.id, name: createdItem.name, code: createdItem.code };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 1'));
          rowModified = true;
        }
      }

      // Worker 2
      if (domain === 'employee' || domain === 'worker2' || domain === 'employee2') {
        const isMatch = (row.worker2Name && row.worker2Name.trim().toLowerCase() === normVal) ||
                        (row.worker2Code && row.worker2Code.trim() === createdItem.code) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && row.worker2Name && !row.resolvedWorker2);
        if (isMatch) {
          updatedRow.worker2Code = createdItem.code || updatedRow.worker2Code;
          updatedRow.resolvedWorker2 = { id: createdItem.id, name: createdItem.name, code: createdItem.code };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 2'));
          rowModified = true;
        }
      }

      // Press
      if (domain === 'press') {
        const isMatch = (row.pressRaw && row.pressRaw.trim().toLowerCase() === normVal) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && !row.resolvedPress);
        if (isMatch) {
          updatedRow.resolvedPress = { id: createdItem.id, name: createdItem.name, code: createdItem.code };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('المكبس') && !e.includes('مكبس'));
          rowModified = true;
        }
      }

      // Product
      if (domain === 'product') {
        const isMatch = (row.productCodeRaw && row.productCodeRaw.trim().toLowerCase() === normVal) ||
                        (row.productNameRaw && row.productNameRaw.trim().toLowerCase() === normVal) ||
                        (row.productCodeRaw && row.productCodeRaw.trim() === createdItem.code) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && !row.resolvedProduct);
        if (isMatch) {
          updatedRow.productCodeRaw = createdItem.code || updatedRow.productCodeRaw;
          updatedRow.resolvedProduct = { 
            id: createdItem.id, 
            name: createdItem.name, 
            code: createdItem.code,
            pieceWeight: createdItem.pieceWeight || updatedRow.pieceWeight,
            aluminaPercentage: createdItem.aluminaPercentage || updatedRow.aluminaPercentage,
          };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('الصنف') && !e.includes('كود الصنف'));
          rowModified = true;
        }
      }

      // Furnace Car (Multi-token aware)
      if (domain === 'furnaceCar' || domain === 'car') {
        const rowTokens = row.furnaceCarTokens || (row.furnaceCarsRaw ? parseFurnaceCarBrickPairs(row.furnaceCarsRaw).map(p => p.carNumber).filter(Boolean) : []);
        const isMatch = rowTokens.some(t => t.toLowerCase() === normVal) ||
                        (row.furnaceCarsRaw && row.furnaceCarsRaw.toLowerCase().includes(normVal)) ||
                        (targetRowIndex !== undefined && row.rowIndex === targetRowIndex);
        if (isMatch) {
          const currentCars = updatedRow.resolvedFurnaceCars || [];
          const carNumber = createdItem.carNumber || createdItem.name || createdItem.code || importedVal;
          // Brick count is always row-specific - read it from THIS row's own
          // parsed pairs, never copied from another row's occurrence of the
          // same car number.
          const brickCount = row.furnaceCarBrickPairs?.find(p => p.carNumber.toLowerCase() === normVal)?.brickCount ?? null;
          if (!currentCars.some(c => c.id === createdItem.id || (c.code && c.code.toLowerCase() === normVal) || (c.carNumber && c.carNumber.toLowerCase() === normVal))) {
            updatedRow.resolvedFurnaceCars = [
              ...currentCars,
              { id: createdItem.id, code: createdItem.code || importedVal, carNumber, brickCount }
            ];
          }
          if (!updatedRow.furnaceCarIds?.includes(createdItem.id)) {
            updatedRow.furnaceCarIds = [...(updatedRow.furnaceCarIds || []), createdItem.id];
            updatedRow.furnaceCarBrickCounts = [...(updatedRow.furnaceCarBrickCounts || []), brickCount ?? 0];
          }
          if (!updatedRow.furnaceCarNumbers?.includes(carNumber)) {
            updatedRow.furnaceCarNumbers = [...(updatedRow.furnaceCarNumbers || []), carNumber];
          }
          if (!updatedRow.carCodes?.includes(createdItem.code || importedVal)) {
            updatedRow.carCodes = [...(updatedRow.carCodes || []), createdItem.code || importedVal];
          }

          // Remove specific error for this token
          updatedRow.errors = updatedRow.errors.filter(e => {
            if (e.includes(`العربة ${importedVal}`) || e.includes(`"${importedVal}"`) || e.includes(importedVal)) return false;
            const remainingTokens = rowTokens.filter(t => !updatedRow.resolvedFurnaceCars?.some(rc => rc.code.toLowerCase() === t.toLowerCase() || rc.carNumber.toLowerCase() === t.toLowerCase()));
            if (remainingTokens.length === 0 && (e.includes('عربة') || e.includes('عربات'))) {
              return false;
            }
            return true;
          });
          rowModified = true;
        }
      }

      // Update proposed match item on row if present
      if (updatedRow.proposedMatches) {
        updatedRow.proposedMatches = updatedRow.proposedMatches.map(pm => {
          if (pm.importedValue.toLowerCase() === normVal || (targetRowIndex !== undefined && row.rowIndex === targetRowIndex && pm.fieldDomain === domain)) {
            return {
              ...pm,
              suggestedId: createdItem.id,
              suggestedName: createdItem.name,
              suggestedCode: createdItem.code,
              confidence: 100,
              decision: 'ACCEPTED' as const,
              ...(wasManualEdit ? { manualEditedValue: inlineAddModalState.importedValue } : {}),
            };
          }
          return pm;
        });
      }

      // Re-evaluate status
      if (rowModified) {
        affectedRowCount++;
        if (updatedRow.errors.length === 0) {
          updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
        }
      }

      return updatedRow;
    });

    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({
      ...pressingSummary,
      rows: updatedRows,
      validRows,
      warningRows,
      errorRows,
    });

    if (importedVal) {
      logAuditAction(
        'CREATE',
        'historicalImportSession',
        buildValueMappingKey(domain, importedVal),
        `إضافة بيان أساسي جديد (${domain}): "${importedVal}" -> "${createdItem.name || createdItem.code}" (${createdItem.id}) - عدد السجلات المتأثرة: ${affectedRowCount}`
      ).catch(() => {});
    }

    if (affectedRowCount > 1) {
      setFeedback({
        type: 'success',
        message: language === 'ar'
          ? `تمت إضافة "${importedVal}" وتطبيقها على ${affectedRowCount} سجلًا مطابقًا.`
          : `"${importedVal}" was added and applied to ${affectedRowCount} matching records.`
      });
    }
  };

  // Collect all unique unresolved missing entities across the entire file for Batch Add
  /**
   * Master Data Consolidation fix - a still-unresolved token can still carry
   * a real (below-auto-accept-threshold) fuzzy candidate on row.proposedMatches
   * (suggestedId/suggestedCode/suggestedName, decision PENDING). Both bulk
   * "Add All Master Data" builders below used to derive suggestedCode/Name
   * from the RAW imported token instead, so BatchAddMasterDataModal's exact
   * duplicate check (findExistingMatch) could never find the existing match
   * and silently offered to CREATE a near-duplicate (e.g. mill "1" vs the
   * existing "5101") instead of "Use Existing". Preferring the real
   * candidate here - never inventing one, never lowering the confidence bar
   * used elsewhere - fixes that for every domain in one place.
   */
  function pendingFuzzySuggestion(row: any, fieldDomains: string[], norm: string): { code?: string; name?: string } | null {
    const match = row.proposedMatches?.find((m: any) =>
      fieldDomains.includes(m.fieldDomain) &&
      String(m.importedValue || '').trim().toLowerCase() === norm &&
      m.decision === 'PENDING' &&
      (m.suggestedCode || m.suggestedName)
    );
    return match ? { code: match.suggestedCode, name: match.suggestedName } : null;
  }

  const missingEntitiesForBatchAdd = useMemo<MissingEntityItem[]>(() => {
    if (!pressingSummary) return [];

    const itemsMap = new Map<string, MissingEntityItem>();

    pressingSummary.rows.forEach(row => {
      // 1. Furnace cars per parsed token
      const carTokens = row.furnaceCarTokens || (row.furnaceCarsRaw ? parseFurnaceCarBrickPairs(row.furnaceCarsRaw).map(p => p.carNumber).filter(Boolean) : []);
      carTokens.forEach(token => {
        const norm = token.trim().toLowerCase();
        if (!norm) return;
        const isResolved = row.resolvedFurnaceCars?.some(c => 
          (c.code && c.code.toLowerCase() === norm) || 
          (c.carNumber && c.carNumber.toLowerCase() === norm)
        );
        const isMatchAccepted = row.proposedMatches?.some(m => m.fieldDomain === 'furnaceCar' && m.importedValue.toLowerCase() === norm && m.decision === 'ACCEPTED');
        
        if (!isResolved && !isMatchAccepted) {
          const key = `furnaceCar#${norm}`;
          if (!itemsMap.has(key)) {
            const pending = pendingFuzzySuggestion(row, ['furnaceCar'], norm);
            itemsMap.set(key, {
              id: key,
              domain: 'furnaceCar',
              token: token.trim(),
              suggestedCode: pending?.code || `CAR-${token.trim().replace(/[^0-9A-Za-z]/g, '') || token.trim()}`,
              suggestedName: pending?.name || `عربة فرن رقم ${token.trim()}`,
              collectionName: 'furnaceCars',
              selected: true,
            });
          }
        }
      });

      // 2. Worker 1
      if (row.worker1Name && !row.resolvedWorker1 && !row.proposedMatches?.some(m => (m.fieldDomain === 'worker1' || m.fieldDomain === 'employee1') && m.decision === 'ACCEPTED')) {
        const norm = row.worker1Name.trim().toLowerCase();
        const key = `employee#${norm}`;
        if (!itemsMap.has(key)) {
          const pending = pendingFuzzySuggestion(row, ['worker1', 'employee1'], norm);
          itemsMap.set(key, {
            id: key,
            domain: 'employee',
            token: row.worker1Name.trim(),
            suggestedCode: pending?.code || row.worker1Code || `EMP-${Date.now().toString().slice(-4)}`,
            suggestedName: pending?.name || row.worker1Name.trim(),
            collectionName: 'employees',
            selected: true,
            extraProps: { jobTitle: 'مشغل مكبس', departmentName: 'قسم التشكيل والمكابس' },
          });
        }
      }

      // 3. Press
      if (row.pressRaw && !row.resolvedPress && !row.proposedMatches?.some(m => m.fieldDomain === 'press' && m.decision === 'ACCEPTED')) {
        const norm = row.pressRaw.trim().toLowerCase();
        const key = `press#${norm}`;
        if (!itemsMap.has(key)) {
          const pending = pendingFuzzySuggestion(row, ['press'], norm);
          itemsMap.set(key, {
            id: key,
            domain: 'press',
            token: row.pressRaw.trim(),
            suggestedCode: pending?.code || row.pressRaw.trim().replace(/\s+/g, '-').toUpperCase(),
            suggestedName: pending?.name || row.pressRaw.trim(),
            collectionName: 'presses',
            selected: true,
          });
        }
      }

      // 4. Product
      if (row.productCodeRaw && !row.resolvedProduct && !row.proposedMatches?.some(m => m.fieldDomain === 'product' && m.decision === 'ACCEPTED')) {
        const norm = row.productCodeRaw.trim().toLowerCase();
        const key = `product#${norm}`;
        if (!itemsMap.has(key)) {
          const pending = pendingFuzzySuggestion(row, ['product'], norm);
          itemsMap.set(key, {
            id: key,
            domain: 'product',
            token: row.productCodeRaw.trim(),
            suggestedCode: pending?.code || row.productCodeRaw.trim(),
            suggestedName: pending?.name || row.productNameRaw || row.productCodeRaw.trim(),
            collectionName: 'products',
            selected: true,
            extraProps: { pieceWeight: row.pieceWeight || 4.5, aluminaPercentage: row.aluminaPercentage || 40 },
          });
        }
      }
    });

    return Array.from(itemsMap.values());
  }, [pressingSummary]);

  /**
   * Same "Add All Master Data" idea as `missingEntitiesForBatchAdd` above,
   * but for the generic (non-pressing) stage import path - one row per
   * unique unresolved token PER entityType (never mixing e.g. a Customer
   * token with a Shift token, and never reusing the pressing-only
   * furnaceCar/press special cases).
   */
  const genericMissingEntitiesForBatchAdd = useMemo<MissingEntityItem[]>(() => {
    if (!genericValidation) return [];
    return genericValidation.missingMasterData.map((m) => ({
      id: `${m.entityType}#${m.name}`,
      domain: m.entityType as MissingEntityItem['domain'],
      token: m.name,
      suggestedCode: m.name,
      suggestedName: m.name,
      collectionName: `${m.entityType}s`,
      selected: true,
    }));
  }, [genericValidation]);

  /**
   * Master Data Consolidation task - the generic-stage counterpart of
   * Pressing's own handleBulkSelection, operating on genericSelectedRowIndexes
   * instead of a per-row rowSelection field (the generic ImportValidationResult
   * model has no such field to mutate). 'CORRECTED'/'READY' are deliberately
   * NOT offered here (unlike Pressing/Chinese Mills): the generic validation
   * model has no correction-review workflow and no "resolved but not yet
   * re-validated" concept, so those two would have no real distinct behavior
   * from 'VALID' - rendering them as fake aliases would mislead, not help.
   */
  const handleGenericBulkSelection = (mode: 'ALL' | 'NONE' | 'VALID') => {
    if (!genericValidation) return;
    if (mode === 'NONE') {
      setGenericSelectedRowIndexes(new Set());
      return;
    }
    if (mode === 'VALID') {
      setGenericSelectedRowIndexes(new Set(genericValidation.validRows.map((r) => r.rowIndex)));
      return;
    }
    // ALL - every row currently in the raw upload, valid or not; the actual
    // Execute step (handleStartImport) still only imports rows that are BOTH
    // selected here AND currently valid, matching Pressing's own "select all,
    // let the readiness gate at execution time do the real filtering" contract.
    setGenericSelectedRowIndexes(new Set(genericRawRows.map((r) => r.rowIndex)));
  };

  /** After the generic "Add All Master Data" modal creates the missing records, re-fetch that entityType's list and re-run validation on the same parsed rows so the newly created records resolve. */
  const handleGenericBatchMasterDataCreated = async () => {
    if (!genericBulkAddEntityType || genericRawRows.length === 0) return;
    const refreshed = await fetchMasterData<any>(`${genericBulkAddEntityType}s` as any);
    setGenericMasterDataByType((prev) => ({ ...prev, [genericBulkAddEntityType]: refreshed }));
    const valResult = await validateImportRows(selectedStage, genericRawRows, language);
    setGenericValidation(valResult);
  };

  /** Loads the existing Master Data list for this entityType (for the modal's client-side duplicate detection) before opening the generic "Add All Master Data" modal. */
  const openGenericBulkAdd = async (entityType: EntityType) => {
    if (!genericMasterDataByType[entityType]) {
      const list = await fetchMasterData<any>(`${entityType}s` as any);
      setGenericMasterDataByType((prev) => ({ ...prev, [entityType]: list }));
    }
    setGenericBulkAddEntityType(entityType);
  };

  /**
   * Part 3 / #21 - Unresolved Value Summary. Scans every row's raw field
   * values (not just proposedMatches, since a pure "no fuzzy candidates"
   * value never gets a proposedMatches entry until explicitly resolved) and
   * groups occurrences by the SAME canonical value-mapping key used for
   * propagation, so one distinct value counts once regardless of how many
   * rows repeat it. matchType on the row's proposedMatches entry (if any)
   * classifies HOW it was resolved; a resolved field with no matching entry
   * is classified as "added" (the only resolution path that doesn't touch
   * proposedMatches).
   */
  const unresolvedValueSummary = useMemo(() => {
    if (!pressingSummary) return { uniqueValues: 0, affectedRows: 0, resolvedByApproval: 0, addedMasterData: 0, manualSelections: 0, remainingBlocking: 0 };

    type Bucket = 'APPROVED' | 'ADDED' | 'MANUAL' | 'PENDING';
    const valueKeys = new Map<string, Bucket>();
    const affectedRowKeys = new Set<string>();

    const classify = (fieldDomain: string, rawValue: string, isResolved: boolean): Bucket => {
      const key = buildValueMappingKey(fieldDomain, rawValue);
      const match = (pressingSummary!.rows
        .flatMap(r => r.proposedMatches || [])
        .find(pm => buildValueMappingKey(pm.fieldDomain, pm.importedValue) === key));
      if (!isResolved) return 'PENDING';
      if (match?.matchType === 'BATCH_INLINE_ADD' || match?.matchType === 'MANUAL_INLINE_ADD' || match?.matchType === 'MANUAL_EDIT_ADD') return 'ADDED';
      if (match?.decision === 'MANUAL' || match?.matchType === 'MANUAL_SELECTION' || match?.matchType === 'MANUAL_EDIT_SELECT') return 'MANUAL';
      if (match) return 'APPROVED';
      return 'ADDED'; // resolved with no proposedMatches entry at all -> only the Add path does this
    };

    for (const row of pressingSummary.rows) {
      let rowHasIssue = false;

      if (row.worker1Name) {
        const key = buildValueMappingKey('employee1', row.worker1Name);
        if (!valueKeys.has(key) || valueKeys.get(key) === 'PENDING') valueKeys.set(key, classify('employee1', row.worker1Name, !!row.resolvedWorker1));
        if (!row.resolvedWorker1) { rowHasIssue = true; affectedRowKeys.add(key + row.rowIndex); }
      }
      if (row.pressRaw) {
        const key = buildValueMappingKey('press', row.pressRaw);
        if (!valueKeys.has(key) || valueKeys.get(key) === 'PENDING') valueKeys.set(key, classify('press', row.pressRaw, !!row.resolvedPress));
        if (!row.resolvedPress) { rowHasIssue = true; affectedRowKeys.add(key + row.rowIndex); }
      }
      const productRaw = row.productCodeRaw || row.productNameRaw;
      if (productRaw) {
        const key = buildValueMappingKey('product', productRaw);
        if (!valueKeys.has(key) || valueKeys.get(key) === 'PENDING') valueKeys.set(key, classify('product', productRaw, !!row.resolvedProduct));
        if (!row.resolvedProduct) { rowHasIssue = true; affectedRowKeys.add(key + row.rowIndex); }
      }
      const tokens = row.furnaceCarTokens || (row.furnaceCarsRaw ? parseFurnaceCarBrickPairs(row.furnaceCarsRaw).map(p => p.carNumber).filter(Boolean) : []);
      for (const token of tokens) {
        const key = buildValueMappingKey('furnaceCar', token);
        const isResolved = !!row.resolvedFurnaceCars?.some(rc => rc.code?.toLowerCase() === token.toLowerCase() || rc.carNumber?.toLowerCase() === token.toLowerCase());
        if (!valueKeys.has(key) || valueKeys.get(key) === 'PENDING') valueKeys.set(key, classify('furnaceCar', token, isResolved));
        if (!isResolved) { rowHasIssue = true; affectedRowKeys.add(key + row.rowIndex); }
      }

      if (rowHasIssue) affectedRowKeys.add(`__row__${row.rowIndex}`);
    }

    let resolvedByApproval = 0, addedMasterData = 0, manualSelections = 0, remainingBlocking = 0;
    valueKeys.forEach((bucket) => {
      if (bucket === 'APPROVED') resolvedByApproval++;
      else if (bucket === 'ADDED') addedMasterData++;
      else if (bucket === 'MANUAL') manualSelections++;
      else remainingBlocking++;
    });

    const affectedRows = pressingSummary.rows.filter(r => affectedRowKeys.has(`__row__${r.rowIndex}`)).length;

    return { uniqueValues: valueKeys.size, affectedRows, resolvedByApproval, addedMasterData, manualSelections, remainingBlocking };
  }, [pressingSummary]);

  /**
   * Partial Import selection/readiness summary (§4/§30). Purely derived from
   * each row's status + rowSelection - no separate counters to keep in sync.
   */
  const partialImportSummary = useMemo(() => {
    if (!pressingSummary) {
      return { total: 0, selected: 0, ready: 0, corrected: 0, warning: 0, warningsAccepted: 0, warningsPending: 0, blocking: 0, skipped: 0, excluded: 0, willImport: 0 };
    }
    return computePressingPartialImportSummary(pressingSummary.rows);
  }, [pressingSummary]);

  // Callback when a batch of Master Data records is created via BatchAddMasterDataModal
  const handleBatchMasterDataCreated = (createdItems: Array<{ domain: string; token: string; item: any; wasNewlyCreated?: boolean }>) => {
    if (!pressingSummary) return;

    const newlyCreated = createdItems.filter(c => c.wasNewlyCreated !== false);
    setAddedMasterDataCount(prev => prev + newlyCreated.length);
    if (newlyCreated.length > 0) {
      setExistingMasterDataList(prev => [...prev, ...newlyCreated.map(c => c.item)]);
      setMasterDataByDomain(prev => {
        const next = { ...prev };
        for (const c of newlyCreated) {
          const key = c.domain as keyof typeof next;
          if (next[key]) next[key] = [...next[key], c.item];
        }
        return next;
      });
    }

    let affectedRowCount = 0;

    const updatedRows = pressingSummary.rows.map(row => {
      let rowModified = false;
      const updatedRow = { ...row };

      for (const { domain, token, item } of createdItems) {
        const normToken = token.toLowerCase();

        // Furnace Cars (Per token)
        if (domain === 'furnaceCar') {
          const rowTokens = row.furnaceCarTokens || (row.furnaceCarsRaw ? parseFurnaceCarBrickPairs(row.furnaceCarsRaw).map(p => p.carNumber).filter(Boolean) : []);
          if (rowTokens.some(t => t.toLowerCase() === normToken) || (row.furnaceCarsRaw && row.furnaceCarsRaw.toLowerCase().includes(normToken))) {
            const currentCars = updatedRow.resolvedFurnaceCars || [];
            const carNumber = item.carNumber || item.name || item.code || token;
            // Row-specific brick count - never copied from another row.
            const brickCount = row.furnaceCarBrickPairs?.find(p => p.carNumber.toLowerCase() === normToken)?.brickCount ?? null;
            if (!currentCars.some(c => c.id === item.id || (c.code && c.code.toLowerCase() === normToken) || (c.carNumber && c.carNumber.toLowerCase() === normToken))) {
              updatedRow.resolvedFurnaceCars = [
                ...currentCars,
                { id: item.id, code: item.code || token, carNumber, brickCount }
              ];
            }
            if (!updatedRow.furnaceCarIds?.includes(item.id)) {
              updatedRow.furnaceCarIds = [...(updatedRow.furnaceCarIds || []), item.id];
              updatedRow.furnaceCarBrickCounts = [...(updatedRow.furnaceCarBrickCounts || []), brickCount ?? 0];
            }
            if (!updatedRow.furnaceCarNumbers?.includes(carNumber)) {
              updatedRow.furnaceCarNumbers = [...(updatedRow.furnaceCarNumbers || []), carNumber];
            }
            if (!updatedRow.carCodes?.includes(item.code || token)) {
              updatedRow.carCodes = [...(updatedRow.carCodes || []), item.code || token];
            }

            // Remove errors for this token
            updatedRow.errors = updatedRow.errors.filter(e => {
              if (e.includes(`العربة ${token}`) || e.includes(`"${token}"`) || e.includes(token)) return false;
              const remainingUnresolved = rowTokens.filter(t => !updatedRow.resolvedFurnaceCars?.some(rc => rc.code.toLowerCase() === t.toLowerCase() || rc.carNumber.toLowerCase() === t.toLowerCase()));
              if (remainingUnresolved.length === 0 && (e.includes('عربة') || e.includes('عربات'))) {
                return false;
              }
              return true;
            });

            // Update proposed match if any
            if (updatedRow.proposedMatches) {
              updatedRow.proposedMatches = updatedRow.proposedMatches.map(pm => {
                if (pm.fieldDomain === 'furnaceCar' && pm.importedValue.toLowerCase() === normToken) {
                  return {
                    ...pm,
                    suggestedId: item.id,
                    suggestedName: item.name,
                    suggestedCode: item.code,
                    confidence: 100,
                    decision: 'ACCEPTED' as const,
                  };
                }
                return pm;
              });
            }
            rowModified = true;
          }
        }

        // Employee / Worker 1
        if (domain === 'employee' || domain === 'worker1') {
          if ((row.worker1Name && row.worker1Name.trim().toLowerCase() === normToken) || (row.worker1Code && row.worker1Code.trim() === item.code)) {
            updatedRow.worker1Code = item.code || updatedRow.worker1Code;
            updatedRow.resolvedWorker1 = { id: item.id, name: item.name, code: item.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 1'));
            rowModified = true;
          }
        }

        // Press
        if (domain === 'press') {
          if (row.pressRaw && row.pressRaw.trim().toLowerCase() === normToken) {
            updatedRow.resolvedPress = { id: item.id, name: item.name, code: item.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('المكبس') && !e.includes('مكبس'));
            rowModified = true;
          }
        }

        // Product
        if (domain === 'product') {
          if ((row.productCodeRaw && row.productCodeRaw.trim().toLowerCase() === normToken) || (row.productNameRaw && row.productNameRaw.trim().toLowerCase() === normToken)) {
            updatedRow.productCodeRaw = item.code || updatedRow.productCodeRaw;
            updatedRow.resolvedProduct = { id: item.id, name: item.name, code: item.code, pieceWeight: item.pieceWeight || updatedRow.pieceWeight, aluminaPercentage: item.aluminaPercentage || updatedRow.aluminaPercentage };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('الصنف') && !e.includes('كود الصنف'));
            rowModified = true;
          }
        }
      }

      if (rowModified) {
        affectedRowCount++;
        if (updatedRow.errors.length === 0) {
          updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
        }
      }

      return updatedRow;
    });

    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({
      ...pressingSummary,
      rows: updatedRows,
      validRows,
      warningRows,
      errorRows,
    });

    logAuditAction(
      'CREATE',
      'historicalImportSession',
      undefined,
      `إضافة جماعية لبيانات أساسية مفقودة (${createdItems.length} عنصر) - عدد السجلات المتأثرة: ${affectedRowCount}`
    ).catch(() => {});

    if (createdItems.length > 0) {
      setFeedback({
        type: 'success',
        message: language === 'ar'
          ? `تمت إضافة ${createdItems.length} بيان أساسي جديد وتطبيقها على ${affectedRowCount} سجلًا مطابقًا.`
          : `${createdItems.length} new master-data records were added and applied to ${affectedRowCount} matching records.`
      });
    }
  };

  // Accept a proposed match for a specific row and fieldDomain
  const handleAcceptProposedMatch = (
    rowIndex: number,
    matchIndex: number,
    chosenCandidate?: { id: string; name: string; code?: string; confidence: number }
  ) => {
    if (!pressingSummary) return;

    const originRow = pressingSummary.rows.find(r => r.rowIndex === rowIndex);
    const prop = originRow?.proposedMatches?.[matchIndex];
    if (!prop) return;

    const candidateToUse = chosenCandidate || {
      id: prop.suggestedId || '',
      name: prop.suggestedName || '',
      code: prop.suggestedCode || '',
      confidence: prop.confidence
    };

    const fieldDomain = prop.fieldDomain;
    const propagationKey = buildValueMappingKey(fieldDomain, prop.importedValue);

    // Applies the approved entity to one row's matching field. This mirrors
    // exactly what this handler previously did for only the originating row -
    // now shared so every row sharing the same field+normalized value gets
    // identical treatment (global value-level mapping propagation).
    const applyResolution = (row: PressingImportRow, matchedValue: string): PressingImportRow => {
      const updatedRow: PressingImportRow = { ...row };

      if (fieldDomain === 'employee1' || fieldDomain === 'worker1') {
        updatedRow.worker1Code = candidateToUse.code || updatedRow.worker1Code;
        updatedRow.resolvedWorker1 = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code || '' };
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 1'));
      } else if (fieldDomain === 'employee2' || fieldDomain === 'worker2') {
        updatedRow.worker2Code = candidateToUse.code || updatedRow.worker2Code;
        updatedRow.resolvedWorker2 = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code || '' };
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 2'));
      } else if (fieldDomain === 'press') {
        updatedRow.resolvedPress = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code || '' };
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('المكبس') && !e.includes('مكبس'));
      } else if (fieldDomain === 'product') {
        updatedRow.productCodeRaw = candidateToUse.code || updatedRow.productCodeRaw;
        updatedRow.resolvedProduct = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code || '' };
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('الصنف') && !e.includes('كود الصنف'));
      } else if (fieldDomain === 'furnaceCar') {
        const currentCars = updatedRow.resolvedFurnaceCars || [];
        const carNumber = candidateToUse.name || candidateToUse.code || matchedValue;
        // Row-specific brick count - read from THIS row's own parsed pairs only.
        const brickCount = row.furnaceCarBrickPairs?.find(p => p.carNumber.toLowerCase() === matchedValue.toLowerCase())?.brickCount ?? null;
        if (!currentCars.some(c => c.id === candidateToUse.id || (c.code && c.code.toLowerCase() === matchedValue.toLowerCase()))) {
          updatedRow.resolvedFurnaceCars = [
            ...currentCars,
            { id: candidateToUse.id, code: candidateToUse.code || matchedValue, carNumber, brickCount }
          ];
        }
        if (!updatedRow.furnaceCarIds?.includes(candidateToUse.id)) {
          updatedRow.furnaceCarIds = [...(updatedRow.furnaceCarIds || []), candidateToUse.id];
          updatedRow.furnaceCarBrickCounts = [...(updatedRow.furnaceCarBrickCounts || []), brickCount ?? 0];
        }
        if (!updatedRow.furnaceCarNumbers?.includes(carNumber)) {
          updatedRow.furnaceCarNumbers = [...(updatedRow.furnaceCarNumbers || []), carNumber];
        }
        if (!updatedRow.carCodes?.includes(candidateToUse.code || matchedValue)) {
          updatedRow.carCodes = [...(updatedRow.carCodes || []), candidateToUse.code || matchedValue];
        }

        const rowTokens = row.furnaceCarTokens || (row.furnaceCarsRaw ? parseFurnaceCarBrickPairs(row.furnaceCarsRaw).map(p => p.carNumber).filter(Boolean) : []);
        updatedRow.errors = updatedRow.errors.filter(e => {
          if (e.includes(`العربة ${matchedValue}`) || e.includes(`"${matchedValue}"`) || e.includes(matchedValue)) return false;
          const remainingTokens = rowTokens.filter(t => !updatedRow.resolvedFurnaceCars?.some(rc => rc.code.toLowerCase() === t.toLowerCase() || rc.carNumber.toLowerCase() === t.toLowerCase()));
          if (remainingTokens.length === 0 && (e.includes('عربة') || e.includes('عربات'))) {
            return false;
          }
          return true;
        });
      }

      // Re-evaluate row status
      if (updatedRow.errors.length === 0) {
        updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
      }

      return updatedRow;
    };

    let affectedRowCount = 0;

    const updatedRows = pressingSummary.rows.map((row) => {
      // The originating row: update the exact proposedMatches entry the user acted on.
      if (row.rowIndex === rowIndex) {
        if (!row.proposedMatches) return row;
        const updatedMatches = [...row.proposedMatches];
        updatedMatches[matchIndex] = {
          ...prop,
          suggestedId: candidateToUse.id,
          suggestedName: candidateToUse.name,
          suggestedCode: candidateToUse.code,
          confidence: candidateToUse.confidence,
          decision: 'ACCEPTED',
        };
        affectedRowCount++;
        return applyResolution({ ...row, proposedMatches: updatedMatches }, prop.importedValue);
      }

      // Global propagation (CURRENT FILE ONLY): any other still-unresolved row
      // with a PENDING suggestion for the same field + normalized imported
      // value gets the same resolution automatically, without re-running
      // fuzzy matching or prompting the user again. Different fieldDomains
      // (e.g. press "209" vs furnaceCar "209") never match each other because
      // fieldDomain is part of the propagation key.
      if (!row.proposedMatches) return row;
      const matchIdx = row.proposedMatches.findIndex(
        pm => pm.fieldDomain === fieldDomain && pm.decision === 'PENDING' && buildValueMappingKey(pm.fieldDomain, pm.importedValue) === propagationKey
      );
      if (matchIdx === -1) return row;

      const otherProp = row.proposedMatches[matchIdx];
      const updatedMatches = [...row.proposedMatches];
      updatedMatches[matchIdx] = {
        ...otherProp,
        suggestedId: candidateToUse.id,
        suggestedName: candidateToUse.name,
        suggestedCode: candidateToUse.code,
        confidence: candidateToUse.confidence,
        decision: 'ACCEPTED',
      };
      affectedRowCount++;
      return applyResolution({ ...row, proposedMatches: updatedMatches }, otherProp.importedValue);
    });

    // Recompute stats
    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({
      ...pressingSummary,
      rows: updatedRows,
      validRows,
      warningRows,
      errorRows,
    });

    // Persist the value-level decision to mapping history (existing mechanism)
    // so future imports of the same value auto-resolve too.
    const mappingDomain = (fieldDomain === 'worker1' || fieldDomain === 'employee1' || fieldDomain === 'worker2' || fieldDomain === 'employee2')
      ? 'employee'
      : (fieldDomain === 'furnaceCar' || fieldDomain === 'car') ? 'furnace_car' : fieldDomain;
    saveApprovedMappingBatch([{
      domain: mappingDomain,
      originalValue: prop.importedValue,
      mappedEntityId: candidateToUse.id,
      mappedEntityName: candidateToUse.name,
      mappedEntityCode: candidateToUse.code,
      confidence: candidateToUse.confidence,
      matchType: 'MANUAL_APPROVED_SUGGESTION',
    }]).catch(err => console.warn('Could not persist approved mapping:', err));

    // Audit trail for the value-level decision (current import session only).
    logAuditAction(
      'UPDATE',
      'historicalImportSession',
      propagationKey,
      `اعتماد مطابقة مقترحة (${fieldDomain}): "${prop.importedValue}" -> "${candidateToUse.name || candidateToUse.code}" (${candidateToUse.id}) - عدد السجلات المتأثرة: ${affectedRowCount}`
    ).catch(() => {});

    // Tell the user when one decision resolved more than just the row they clicked.
    if (affectedRowCount > 1) {
      setFeedback({
        type: 'success',
        message: language === 'ar'
          ? `تم اعتماد البيان "${prop.importedValue}" وتطبيقه على ${affectedRowCount} سجلًا مطابقًا.`
          : `Mapping "${prop.importedValue}" approved and applied to ${affectedRowCount} matching records.`
      });
    }
  };

  // Skip a proposed match (with strict check if field is mandatory)
  const handleSkipProposedMatch = (rowIndex: number, matchIndex: number) => {
    if (!pressingSummary) return;

    const targetRow = pressingSummary.rows.find(r => r.rowIndex === rowIndex);
    const prop = targetRow?.proposedMatches?.[matchIndex];
    if (!prop) return;

    // Check if mandatory
    const isMandatory = prop.fieldDomain === 'worker1' || 
                        prop.fieldDomain === 'employee1' || 
                        prop.fieldDomain === 'press' || 
                        prop.fieldDomain === 'product' || 
                        prop.fieldDomain === 'furnaceCar';

    if (isMandatory) {
      const confirmSkip = window.confirm(
        language === 'ar'
          ? `تنبيه: حقل (${prop.fieldNameAr || prop.fieldDomain}) إلزامي لإتمام الاستيراد.\nتخطي هذا البيان لن يجعل الصف صالحاً، وسيبقى كخطأ مانع للاستيراد حتى يتم اعتماده أو إضافته.\n\nهل تريد تأكيد التخطي؟`
          : `Notice: Field (${prop.fieldDomain}) is required to complete the import.\nSkipping will keep this row as a blocking error until resolved.\n\nDo you want to confirm skipping?`
      );
      if (!confirmSkip) return;
    }

    const fieldDomain = prop.fieldDomain;
    const propagationKey = buildValueMappingKey(fieldDomain, prop.importedValue);
    let affectedRowCount = 0;

    // Skip only rejects the suggestion (row.errors are left exactly as the
    // existing single-row logic already treats them per fieldDomain) - it
    // never resolves a required blocking field, so propagating it across
    // equivalent rows is safe: it just spares the user from clicking Skip
    // once per row for the same repeated value.
    const updatedRows = pressingSummary.rows.map((row) => {
      const isOrigin = row.rowIndex === rowIndex;
      if (!row.proposedMatches) return row;

      const matchIdx = isOrigin
        ? matchIndex
        : row.proposedMatches.findIndex(
            pm => pm.fieldDomain === fieldDomain && pm.decision === 'PENDING' && buildValueMappingKey(pm.fieldDomain, pm.importedValue) === propagationKey
          );
      if (matchIdx === -1) return row;
      const rowProp = row.proposedMatches[matchIdx];
      if (!isOrigin && !rowProp) return row;

      const updatedMatches = [...row.proposedMatches];
      updatedMatches[matchIdx] = {
        ...(isOrigin ? prop : rowProp),
        decision: 'REJECTED',
      };

      const updatedRow = { ...row, proposedMatches: updatedMatches };
      affectedRowCount++;

      // If non-mandatory worker2, clear warning/error
      if (fieldDomain === 'employee2' || fieldDomain === 'worker2') {
        updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 2'));
        if (updatedRow.errors.length === 0) {
          updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
        }
      }

      return updatedRow;
    });

    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({
      ...pressingSummary,
      rows: updatedRows,
      validRows,
      warningRows,
      errorRows,
    });

    if (affectedRowCount > 1) {
      setFeedback({
        type: 'info',
        message: language === 'ar'
          ? `تم تخطي البيان "${prop.importedValue}" في ${affectedRowCount} سجلًا مطابقًا.`
          : `Skipped "${prop.importedValue}" across ${affectedRowCount} matching records.`
      });
    }
  };

  /**
   * Part 2 - Manual Master Data Selection. Used when fuzzy matching could not
   * confidently identify the correct existing record (no proposedMatches
   * entry, or only a low-confidence one). The operator explicitly picks the
   * real entity from a searchable list of ALL existing records of the SAME
   * entity type. Reuses the exact field-resolution logic already used by
   * Approve/Add, sets decision 'MANUAL' (already part of the existing
   * proposedMatches schema), and propagates via the same canonical
   * normalization key used everywhere else in this file - never merging
   * across different fieldDomains or different normalized values.
   */
  const handleManualSelectConfirm = (option: { id: string; code: string; name: string }) => {
    if (!manualSelectState || !pressingSummary) return;
    const { domain, importedValue, editedValue } = manualSelectState;
    // Canonical fieldDomain values as actually emitted by the matching engine
    // (pressingHistoricalImportService.ts) - 'employee1' not 'worker1', etc.
    const fieldDomain = domain === 'employee' ? 'employee1' : domain;
    const candidateToUse = { id: option.id, name: option.name, code: option.code };
    // Propagation ALWAYS keys off the ORIGINAL imported value, never the
    // manual correction text - other rows in the file still contain the
    // original wrong value, not what the user retyped.
    const propagationKey = buildValueMappingKey(fieldDomain, importedValue);
    const trimmedEdited = (editedValue || '').trim();
    const wasManuallyEdited = trimmedEdited.length > 0 && trimmedEdited.toLowerCase() !== importedValue.trim().toLowerCase();

    let affectedRowCount = 0;

    const updatedRows = pressingSummary.rows.map((row) => {
      let rowModified = false;
      const updatedRow: PressingImportRow = { ...row };
      let matchedRawValue: string | null = null;

      if (fieldDomain === 'employee1') {
        if (row.worker1Name && buildValueMappingKey('employee1', row.worker1Name) === propagationKey && !row.resolvedWorker1) {
          matchedRawValue = row.worker1Name;
          updatedRow.worker1Code = candidateToUse.code || updatedRow.worker1Code;
          updatedRow.resolvedWorker1 = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 1'));
          rowModified = true;
        }
      } else if (fieldDomain === 'press') {
        if (row.pressRaw && buildValueMappingKey('press', row.pressRaw) === propagationKey && !row.resolvedPress) {
          matchedRawValue = row.pressRaw;
          updatedRow.resolvedPress = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('المكبس') && !e.includes('مكبس'));
          rowModified = true;
        }
      } else if (fieldDomain === 'product') {
        const rawVal = row.productCodeRaw || row.productNameRaw;
        if (rawVal && buildValueMappingKey('product', rawVal) === propagationKey && !row.resolvedProduct) {
          matchedRawValue = rawVal;
          updatedRow.productCodeRaw = candidateToUse.code || updatedRow.productCodeRaw;
          updatedRow.resolvedProduct = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
          updatedRow.errors = updatedRow.errors.filter(e => !e.includes('الصنف') && !e.includes('كود الصنف'));
          rowModified = true;
        }
      } else if (fieldDomain === 'furnaceCar') {
        const rowTokens = row.furnaceCarTokens || (row.furnaceCarsRaw ? parseFurnaceCarBrickPairs(row.furnaceCarsRaw).map(p => p.carNumber).filter(Boolean) : []);
        const matchedToken = rowTokens.find(t => buildValueMappingKey('furnaceCar', t) === propagationKey);
        const alreadyResolved = matchedToken && row.resolvedFurnaceCars?.some(rc =>
          (rc.code && rc.code.toLowerCase() === matchedToken.toLowerCase()) || (rc.carNumber && rc.carNumber.toLowerCase() === matchedToken.toLowerCase())
        );
        if (matchedToken && !alreadyResolved) {
          matchedRawValue = matchedToken;
          const currentCars = updatedRow.resolvedFurnaceCars || [];
          // Row-specific brick count - read from THIS row's own parsed pairs only.
          const brickCount = row.furnaceCarBrickPairs?.find(p => p.carNumber.toLowerCase() === matchedToken.toLowerCase())?.brickCount ?? null;
          updatedRow.resolvedFurnaceCars = [...currentCars, { id: candidateToUse.id, code: candidateToUse.code || matchedToken, carNumber: candidateToUse.name || candidateToUse.code || matchedToken, brickCount }];
          if (!updatedRow.furnaceCarIds?.includes(candidateToUse.id)) {
            updatedRow.furnaceCarIds = [...(updatedRow.furnaceCarIds || []), candidateToUse.id];
            updatedRow.furnaceCarBrickCounts = [...(updatedRow.furnaceCarBrickCounts || []), brickCount ?? 0];
          }
          updatedRow.errors = updatedRow.errors.filter(e => {
            if (e.includes(`العربة ${matchedToken}`) || e.includes(`"${matchedToken}"`) || e.includes(matchedToken)) return false;
            const remaining = rowTokens.filter(t => !updatedRow.resolvedFurnaceCars?.some(rc => rc.code.toLowerCase() === t.toLowerCase() || rc.carNumber.toLowerCase() === t.toLowerCase()));
            if (remaining.length === 0 && (e.includes('عربة') || e.includes('عربات'))) return false;
            return true;
          });
          rowModified = true;
        }
      }

      if (!rowModified) return row;

      // Record/refresh the proposedMatches entry so the review matrix always
      // shows the decision, even for rows that originally had zero fuzzy
      // candidates (no prior proposedMatches entry to update).
      const existingIdx = (updatedRow.proposedMatches || []).findIndex(
        pm => pm.fieldDomain === fieldDomain && buildValueMappingKey(pm.fieldDomain, pm.importedValue) === propagationKey
      );
      const manualEntry = {
        fieldDomain,
        fieldNameAr: DOMAIN_BULK_LABELS[domain]?.ar || fieldDomain,
        fieldNameEn: DOMAIN_BULK_LABELS[domain]?.en || fieldDomain,
        importedValue: matchedRawValue || importedValue,
        suggestedId: candidateToUse.id,
        suggestedCode: candidateToUse.code,
        suggestedName: candidateToUse.name,
        confidence: 100,
        matchType: wasManuallyEdited ? 'MANUAL_EDIT_SELECT' : 'MANUAL_SELECTION',
        reasonAr: wasManuallyEdited
          ? `تم تصحيح القيمة يدوياً إلى "${trimmedEdited}" ثم اختيار بيان أساسي موجود.`
          : 'تم الاختيار يدوياً من قائمة البيانات الأساسية الموجودة.',
        reasonEn: wasManuallyEdited
          ? `Value manually corrected to "${trimmedEdited}", then matched to an existing master data record.`
          : 'Manually selected from the existing master data list.',
        decision: 'MANUAL' as const,
        manualId: candidateToUse.id,
        manualName: candidateToUse.name,
        ...(wasManuallyEdited ? { manualEditedValue: trimmedEdited } : {}),
      };
      updatedRow.proposedMatches = existingIdx >= 0
        ? (updatedRow.proposedMatches || []).map((pm, i) => (i === existingIdx ? { ...pm, ...manualEntry } : pm))
        : [...(updatedRow.proposedMatches || []), manualEntry];

      if (updatedRow.errors.length === 0) {
        updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
      }
      affectedRowCount++;
      return updatedRow;
    });

    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({ ...pressingSummary, rows: updatedRows, validRows, warningRows, errorRows });
    setManualSelectState(null);

    const mappingDomain = fieldDomain === 'employee1' ? 'employee' : fieldDomain === 'furnaceCar' ? 'furnace_car' : fieldDomain;
    saveApprovedMappingBatch([{
      domain: mappingDomain,
      originalValue: importedValue,
      mappedEntityId: candidateToUse.id,
      mappedEntityName: candidateToUse.name,
      mappedEntityCode: candidateToUse.code,
      confidence: 100,
      matchType: wasManuallyEdited ? 'MANUAL_EDIT_SELECT' : 'MANUAL_SELECTION',
    }]).catch(err => console.warn('Could not persist manual-selection mapping:', err));

    logAuditAction(
      'UPDATE',
      'historicalImportSession',
      propagationKey,
      wasManuallyEdited
        ? `تعديل يدوي واختيار (${fieldDomain}): "${importedValue}" -> تصحيح: "${trimmedEdited}" -> "${candidateToUse.name}" (${candidateToUse.id}) - عدد السجلات المتأثرة: ${affectedRowCount}`
        : `اختيار يدوي (${fieldDomain}): "${importedValue}" -> "${candidateToUse.name}" (${candidateToUse.id}) - عدد السجلات المتأثرة: ${affectedRowCount}`
    ).catch(() => {});

    setFeedback({
      type: 'success',
      message: language === 'ar'
        ? `تم اعتماد "${candidateToUse.name}" وتطبيقه على ${affectedRowCount} سجل.`
        : `"${candidateToUse.name}" approved and applied to ${affectedRowCount} record(s).`,
    });
  };

  // Accept all high-confidence proposed matches (≥ 90%) in one click
  const handleAcceptAllHighConfidence = () => {
    if (!pressingSummary) return;

    const updatedRows = pressingSummary.rows.map((row) => {
      if (!row.proposedMatches || row.proposedMatches.length === 0) return row;

      let updatedRow = { ...row };
      const updatedMatches = row.proposedMatches.map((prop) => {
        if (prop.confidence >= 90 && prop.decision !== 'REJECTED') {
          const candidateToUse = {
            id: prop.suggestedId || '',
            name: prop.suggestedName || '',
            code: prop.suggestedCode || '',
            confidence: prop.confidence
          };
          
          if (prop.fieldDomain === 'employee1' || prop.fieldDomain === 'worker1') {
            updatedRow.worker1Code = candidateToUse.code || updatedRow.worker1Code;
            updatedRow.resolvedWorker1 = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 1'));
          } else if (prop.fieldDomain === 'employee2' || prop.fieldDomain === 'worker2') {
            updatedRow.worker2Code = candidateToUse.code || updatedRow.worker2Code;
            updatedRow.resolvedWorker2 = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عامل 2'));
          } else if (prop.fieldDomain === 'press') {
            updatedRow.resolvedPress = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('المكبس') && !e.includes('مكبس'));
          } else if (prop.fieldDomain === 'product') {
            updatedRow.productCodeRaw = candidateToUse.code || updatedRow.productCodeRaw;
            updatedRow.resolvedProduct = { id: candidateToUse.id, name: candidateToUse.name, code: candidateToUse.code };
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('الصنف') && !e.includes('كود الصنف'));
          } else if (prop.fieldDomain === 'furnaceCar') {
            // Row-specific brick count - read from THIS row's own parsed pairs only.
            const brickCount = row.furnaceCarBrickPairs?.find(p => p.carNumber.toLowerCase() === prop.importedValue.toLowerCase())?.brickCount ?? null;
            updatedRow.resolvedFurnaceCars = [{ id: candidateToUse.id, code: candidateToUse.code, carNumber: candidateToUse.name || candidateToUse.code, brickCount }];
            updatedRow.errors = updatedRow.errors.filter(e => !e.includes('عربة') && !e.includes('عربات'));
          }

          return {
            ...prop,
            decision: 'ACCEPTED' as const,
          };
        }
        return prop;
      });

      updatedRow.proposedMatches = updatedMatches;
      if (updatedRow.errors.length === 0) {
        updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
      }
      return updatedRow;
    });

    // Recompute stats
    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({
      ...pressingSummary,
      rows: updatedRows,
      validRows,
      warningRows,
      errorRows,
    });
  };

  // ==========================================================================
  // PARTIAL IMPORT - row selection (Include/Exclude/Skip/Re-include)
  // ==========================================================================

  const actorName = adminUser?.fullName || adminUser?.username || adminUser?.email || 'مستخدم';

  /** Append-only per-row correction/decision trail (§4 Original Data Preservation). */
  const pushHistory = (row: PressingImportRow, action: string, summary: string): PressingImportRow => ({
    ...row,
    resolutionHistory: [...(row.resolutionHistory || []), { timestamp: new Date().toISOString(), actor: actorName, action, summary }],
  });

  /**
   * Records ONE new versioned, revertible snapshot for `rowBefore` -> `rowAfter`
   * (§11-16). Lazily seeds an 'ORIGINAL' version the first time a row is ever
   * edited, so version 1 always represents the as-parsed state. Append-only -
   * never mutates or removes an earlier entry.
   */
  const recordRowVersion = (
    rowBefore: PressingImportRow,
    rowAfter: PressingImportRow,
    source: RowVersion['source'],
    reason: string
  ): RowVersion[] => {
    const versions = [...(rowBefore.rowVersions || [])];
    const beforeSnapshot = snapshotRowFields(rowBefore);
    if (versions.length === 0) {
      versions.push({
        editId: `v-${rowBefore.rowIndex}-orig-${Date.now()}`,
        importId: importSessionId,
        rowId: rowBefore.rowIndex,
        timestamp: new Date().toISOString(),
        userId: actorName,
        reason: language === 'ar' ? 'النسخة الأصلية كما تم استيرادها من الملف' : 'Original version as imported from the file',
        source: 'ORIGINAL',
        beforeData: beforeSnapshot,
        afterData: beforeSnapshot,
        changedFields: [],
        validationBefore: validationSnapshot(rowBefore),
        validationAfter: validationSnapshot(rowBefore),
      });
    }
    const afterSnapshot = snapshotRowFields(rowAfter);
    versions.push({
      editId: `v-${rowBefore.rowIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      importId: importSessionId,
      rowId: rowBefore.rowIndex,
      timestamp: new Date().toISOString(),
      userId: actorName,
      reason,
      source,
      beforeData: beforeSnapshot,
      afterData: afterSnapshot,
      changedFields: diffRowSnapshots(beforeSnapshot, afterSnapshot),
      validationBefore: validationSnapshot(rowBefore),
      validationAfter: validationSnapshot(rowAfter),
    });
    return versions;
  };

  const updateRowSelection = (rowIndex: number, selection: 'INCLUDED' | 'EXCLUDED', reason?: PressingImportRow['exclusionReason']) => {
    if (!pressingSummary) return;
    const updatedRows = pressingSummary.rows.map((r) => {
      if (r.rowIndex !== rowIndex) return r;
      const actionLabel = selection === 'INCLUDED' ? 'إعادة إدراج' : reason === 'SKIPPED_ROW' ? 'تخطي' : reason === 'EXCLUDED_ROW' ? 'استبعاد' : 'إلغاء تحديد';
      return pushHistory(
        {
          ...r,
          rowSelection: selection,
          exclusionReason: selection === 'EXCLUDED' ? reason : undefined,
          excludedBy: selection === 'EXCLUDED' ? actorName : undefined,
          excludedAt: selection === 'EXCLUDED' ? new Date().toISOString() : undefined,
          originalExclusionReason: selection === 'EXCLUDED' ? buildExclusionReasonText(r, language) : undefined,
        },
        'ROW_SELECTION',
        `${actionLabel} الصف ${rowIndex}`
      );
    });
    setPressingSummary({ ...pressingSummary, rows: updatedRows });
    if (selection === 'INCLUDED') setSessionReincludedCount((c) => c + 1);
    logAuditAction(
      'UPDATE',
      'historicalImportSession',
      String(rowIndex),
      selection === 'INCLUDED'
        ? `إعادة إدراج الصف ${rowIndex} في الاستيراد`
        : `${reason === 'SKIPPED_ROW' ? 'تخطي' : reason === 'EXCLUDED_ROW' ? 'استبعاد' : 'إلغاء تحديد'} الصف ${rowIndex}`
    ).catch(() => {});
  };

  const handleToggleRowSelection = (rowIndex: number, checked: boolean) => {
    updateRowSelection(rowIndex, checked ? 'INCLUDED' : 'EXCLUDED', checked ? undefined : 'USER_DESELECTED');
  };
  const handleSkipRow = (rowIndex: number) => updateRowSelection(rowIndex, 'EXCLUDED', 'SKIPPED_ROW');
  const handleExcludeRow = (rowIndex: number) => updateRowSelection(rowIndex, 'EXCLUDED', 'EXCLUDED_ROW');
  const handleReincludeRow = (rowIndex: number) => updateRowSelection(rowIndex, 'INCLUDED');

  /** Bulk re-include (§13): every row is independently re-included - a row that is
   * still BLOCKING stays BLOCKING (never auto-marked Ready) until its own errors
   * are actually resolved. */
  const handleBulkReincludeExcluded = (rowIndexes: number[]) => {
    if (!pressingSummary || rowIndexes.length === 0) return;
    const idxSet = new Set(rowIndexes);
    const updatedRows = pressingSummary.rows.map((r) =>
      idxSet.has(r.rowIndex)
        ? pushHistory({ ...r, rowSelection: 'INCLUDED' as const, exclusionReason: undefined, excludedBy: undefined, excludedAt: undefined, originalExclusionReason: undefined }, 'ROW_SELECTION', `إعادة إدراج جماعية للصف ${r.rowIndex}`)
        : r
    );
    setPressingSummary({ ...pressingSummary, rows: updatedRows });
    setSelectedExcludedRowIndices(new Set());
    setSessionReincludedCount((c) => c + rowIndexes.length);
    logAuditAction('UPDATE', 'historicalImportSession', rowIndexes.join(','), `إعادة إدراج جماعية لـ ${rowIndexes.length} صف مستبعد`).catch(() => {});
  };

  /**
   * §1-3/§9: the SINGLE authoritative selection decision for Pressing -
   * delegates to computePressingBulkOutcome (pressingSelectionPure.ts) so
   * this component, the summary counters, and any future review UI can never
   * drift apart on what "Select All/Valid/Ready/Corrected" means. "Select
   * All" always operates on the FULL pressingSummary.rows array (never a
   * filtered/paginated/visible-only subset) and is never disabled by the
   * presence of BLOCKING rows - they still get rowSelection=INCLUDED (§5:
   * "Select All MUST NOT silently ignore them"), isRowWritable()'s separate
   * error check is what keeps them from actually being written.
   */
  const handleBulkSelection = (mode: 'ALL' | 'NONE' | 'VALID' | 'CORRECTED' | 'READY' | 'CLEAR') => {
    if (!pressingSummary) return;
    const updatedRows = pressingSummary.rows.map((r) => {
      const outcome = computePressingBulkOutcome(r, mode);
      const isExcluded = outcome.rowSelection === 'EXCLUDED';
      return {
        ...r,
        rowSelection: outcome.rowSelection,
        exclusionReason: outcome.exclusionReason,
        excludedBy: isExcluded ? actorName : undefined,
        excludedAt: isExcluded ? new Date().toISOString() : undefined,
        originalExclusionReason: isExcluded ? buildExclusionReasonText(r, language) : undefined,
      };
    });
    setPressingSummary({ ...pressingSummary, rows: updatedRows });
  };

  /** Permanently removes rows from the CURRENT IMPORT SESSION ONLY (§14/§15).
   * Never touches Firestore, Master Data, or the original Excel file - it just
   * filters the in-memory rows array and recounts the summary totals. */
  const handleDeleteRowsPermanently = (rowIndexes: number[]) => {
    if (!pressingSummary || rowIndexes.length === 0) return;
    const idxSet = new Set(rowIndexes);
    const remainingRows = pressingSummary.rows.filter((r) => !idxSet.has(r.rowIndex));
    const validRows = remainingRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = remainingRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = remainingRows.filter(r => r.errors.length > 0).length;
    const duplicateRows = remainingRows.filter(r => r.isDuplicate).length;

    setPressingSummary({
      ...pressingSummary,
      rows: remainingRows,
      totalRows: remainingRows.length,
      validRows,
      warningRows,
      errorRows,
      duplicateRows,
    });
    setSelectedExcludedRowIndices((prev) => {
      const next = new Set(prev);
      rowIndexes.forEach((i) => next.delete(i));
      return next;
    });
    setDeleteConfirmState(null);
    setSessionDeletedCount((c) => c + rowIndexes.length);
    logAuditAction(
      'DELETE',
      'historicalImportSession',
      rowIndexes.join(','),
      `حذف نهائي لـ ${rowIndexes.length} صف من جلسة الاستيراد الحالية (لم يتم رفعهم إلى Firestore ولم يتأثر الملف الأصلي أو أي استيراد سابق)`
    ).catch(() => {});
  };

  // ==========================================================================
  // PARTIAL IMPORT - "Edit Entire Row" (§1-7): covers EVERY importable field
  // for a pressing row - date, both workers, press, furnace cars + brick count
  // per car, customer order, shift, product, piece weight, alumina %,
  // production/waste quantities, and all 5 fault-breakdown fields. Reuses the
  // SAME master-data lists (masterDataByDomain) and SearchableCombobox/
  // MultiSearchableCombobox components already used for field-level Manual
  // Edit/Choose Existing - field-level correction (per proposedMatches entry)
  // remains available separately (§7), this is the complementary "whole row
  // at once" path.
  // ==========================================================================

  const handleOpenEditEntireRow = (rowIndex: number, opts?: { autoReinclude?: boolean; queue?: number[] }) => {
    const row = pressingSummary?.rows.find((r) => r.rowIndex === rowIndex);
    if (!row) return;
    setEditRowDraft({
      date: row.date || '',
      worker1Id: row.resolvedWorker1?.id || null,
      worker2Id: row.resolvedWorker2?.id || null,
      pressId: row.resolvedPress?.id || null,
      productId: row.resolvedProduct?.id || null,
      productCode: row.productCodeRaw || row.resolvedProduct?.code || '',
      productName: row.productNameRaw || row.resolvedProduct?.name || '',
      furnaceCarEntries: (row.resolvedFurnaceCars || []).map((c) => ({ carId: c.id || '', brickCount: c.brickCount != null ? String(c.brickCount) : '' })).filter((e) => e.carId),
      customerOrder: row.customerOrder || '',
      shift: (() => {
        const n = parseShiftNumber(row.resolvedShift?.code?.replace('SHIFT-', '') || row.shiftRaw);
        return n ? (String(n) as '1' | '2' | '3') : '';
      })(),
      aluminaPercentage: String(row.aluminaPercentage ?? ''),
      pieceWeight: String(row.pieceWeight ?? ''),
      productionQuantity: String(row.productionQuantity ?? ''),
      wasteQuantity: String(row.wasteQuantity ?? ''),
      mechanicalFaults: String(row.mechanicalFaults ?? 0),
      electricalFaults: String(row.electricalFaults ?? 0),
      workshopFaults: String(row.workshopFaults ?? 0),
      rawMaterialFaults: String(row.rawMaterialFaults ?? 0),
      otherFaults: String(row.otherFaults ?? 0),
    });
    setEditRowState({ isOpen: true, rowIndex, autoReinclude: !!opts?.autoReinclude, queue: opts?.queue || [] });
  };
  /** "Edit & Re-import" (§12): opens the full editor on an excluded row; saving
   * both validates AND flips it back to INCLUDED in one step. */
  const handleEditAndReimport = (rowIndex: number) => handleOpenEditEntireRow(rowIndex, { autoReinclude: true });

  /** "[Edit Selected]" on the Excluded Records screen (§13): walks through every
   * selected row's full editor one at a time (fields differ per row, so they
   * cannot share one form) - saving one automatically opens the next. */
  const handleEditSelectedExcluded = () => {
    const indexes = Array.from(selectedExcludedRowIndices);
    if (indexes.length === 0) return;
    const [first, ...rest] = indexes;
    handleOpenEditEntireRow(first, { autoReinclude: true, queue: rest });
  };

  const handleSaveRowEdit = () => {
    if (!editRowState || !editRowDraft || !pressingSummary) return;

    const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
    const productionQuantity = num(editRowDraft.productionQuantity);
    const wasteQuantity = num(editRowDraft.wasteQuantity);
    const mechanicalFaults = num(editRowDraft.mechanicalFaults) || 0;
    const electricalFaults = num(editRowDraft.electricalFaults) || 0;
    const workshopFaults = num(editRowDraft.workshopFaults) || 0;
    const rawMaterialFaults = num(editRowDraft.rawMaterialFaults) || 0;
    const otherFaults = num(editRowDraft.otherFaults) || 0;

    const employees = masterDataByDomain.employee || [];
    const presses = masterDataByDomain.press || [];
    const products = masterDataByDomain.product || [];
    const furnaceCarsList = masterDataByDomain.furnaceCar || [];

    const matchedWorker1 = editRowDraft.worker1Id ? employees.find((e: any) => e.id === editRowDraft.worker1Id) : null;
    const matchedWorker2 = editRowDraft.worker2Id ? employees.find((e: any) => e.id === editRowDraft.worker2Id) : null;
    const matchedPress = editRowDraft.pressId ? presses.find((p: any) => p.id === editRowDraft.pressId) : null;
    const matchedProduct = editRowDraft.productId ? products.find((p: any) => p.id === editRowDraft.productId) : null;

    // Furnace cars: OPTIONAL as a whole (business rule - the cell can be blank),
    // but every entry the user adds must resolve to a real car with a valid
    // non-negative integer brick count, and no car may repeat within the row.
    const carEntries = editRowDraft.furnaceCarEntries.filter((e) => e.carId);
    const seenCarIds = new Set<string>();
    const furnaceCarErrors: string[] = [];
    const resolvedFurnaceCars: PressingImportRow['resolvedFurnaceCars'] = [];
    carEntries.forEach((entry) => {
      const car = furnaceCarsList.find((c: any) => c.id === entry.carId);
      if (!car) return;
      const carNumber = car.carNumber || car.code || '';
      if (seenCarIds.has(entry.carId)) {
        furnaceCarErrors.push(`العربة ${carNumber} مكررة بأكثر من إدخال في نفس الصف.`);
        return;
      }
      seenCarIds.add(entry.carId);
      const brickCountNum = entry.brickCount.trim() === '' ? NaN : Number(entry.brickCount);
      if (isNaN(brickCountNum) || brickCountNum < 0 || !Number.isInteger(brickCountNum)) {
        furnaceCarErrors.push(`عدد الطوب للعربة ${carNumber} غير صالح.`);
      }
      resolvedFurnaceCars.push({ id: car.id, code: car.code || carNumber, carNumber, brickCount: isNaN(brickCountNum) ? null : brickCountNum });
    });

    const shiftNum = parseShiftNumber(editRowDraft.shift);
    const resolvedShift = shiftNum
      ? { id: `shift-${shiftNum}`, code: buildShiftCode(shiftNum), name: buildShiftDisplayName(shiftNum, 'ar'), hours: 8 }
      : undefined;

    const updatedRows = pressingSummary.rows.map((row) => {
      if (row.rowIndex !== editRowState.rowIndex) return row;

      const updatedRow: PressingImportRow = {
        ...row,
        date: editRowDraft.date,
        worker1Name: matchedWorker1?.name || row.worker1Name,
        worker1Code: matchedWorker1?.code || row.worker1Code,
        resolvedWorker1: matchedWorker1
          ? { id: matchedWorker1.id, name: matchedWorker1.name, code: matchedWorker1.code, departmentName: matchedWorker1.departmentName }
          : undefined,
        worker2Name: matchedWorker2?.name || (editRowDraft.worker2Id ? row.worker2Name : ''),
        worker2Code: matchedWorker2?.code || (editRowDraft.worker2Id ? row.worker2Code : ''),
        resolvedWorker2: matchedWorker2
          ? { id: matchedWorker2.id, name: matchedWorker2.name, code: matchedWorker2.code, departmentName: matchedWorker2.departmentName }
          : undefined,
        pressRaw: matchedPress?.name || matchedPress?.code || row.pressRaw,
        resolvedPress: matchedPress ? { id: matchedPress.id, name: matchedPress.name, code: matchedPress.code } : undefined,
        productCodeRaw: editRowDraft.productCode || matchedProduct?.code || row.productCodeRaw,
        productNameRaw: editRowDraft.productName || matchedProduct?.name || row.productNameRaw,
        resolvedProduct: matchedProduct
          ? { id: matchedProduct.id, name: matchedProduct.name, code: matchedProduct.code, pieceWeight: matchedProduct.pieceWeight, aluminaPercentage: matchedProduct.aluminaPercentage }
          : undefined,
        furnaceCarsRaw: resolvedFurnaceCars.length > 0 ? resolvedFurnaceCars.map((c) => `${c.carNumber}-${c.brickCount ?? ''}`).join('/') : '',
        furnaceCarTokens: resolvedFurnaceCars.map((c) => c.carNumber),
        resolvedFurnaceCars,
        furnaceCarNumbers: resolvedFurnaceCars.map((c) => c.carNumber),
        furnaceCarIds: resolvedFurnaceCars.map((c) => c.id || ''),
        furnaceCarBrickCounts: resolvedFurnaceCars.map((c) => c.brickCount ?? 0),
        carCodes: resolvedFurnaceCars.map((c) => c.code),
        customerOrder: editRowDraft.customerOrder,
        shiftRaw: editRowDraft.shift,
        resolvedShift,
        aluminaPercentage: num(editRowDraft.aluminaPercentage) || 0,
        pieceWeight: num(editRowDraft.pieceWeight) || 0,
        productionQuantity,
        wasteQuantity,
        mechanicalFaults,
        electricalFaults,
        workshopFaults,
        rawMaterialFaults,
        otherFaults,
        calculatedTotalFaults: mechanicalFaults + electricalFaults + workshopFaults + rawMaterialFaults + otherFaults,
      };

      // Revalidate the COMPLETE row against the SAME required-field rules the
      // initial parse applies (§5.3/§5.4) - strip every error this editor can
      // possibly fix, then reapply fresh checks against the saved values. Any
      // error this editor does NOT cover (e.g. cross-row file-duplicate) is
      // left exactly as-is, never silently cleared.
      const FIELD_ERROR_KEYWORDS = ['تاريخ', 'عامل 1', 'عامل 2', 'المكبس', 'الوردية', 'الصنف', 'المنتج', 'عربة', 'كمية الإنتاج'];
      const preservedErrors = updatedRow.errors.filter((e) => !FIELD_ERROR_KEYWORDS.some((kw) => e.includes(kw)));
      const newErrors = [...preservedErrors];
      const BUSINESS_WARNING_CODES = ['WASTE_GREATER_THAN_PRODUCTION', 'HIGH_WASTE_PERCENTAGE', 'HIGH_DOWNTIME'];
      const BUSINESS_WARNING_KEYWORDS = ['كمية الهالك أكبر من كمية الإنتاج', 'نسبة الهالك مرتفعة', 'مدة التوقف مرتفعة'];
      const preservedWarnings = updatedRow.warnings.filter((w) => !BUSINESS_WARNING_KEYWORDS.some((kw) => w.includes(kw)));
      const preservedWarningCodes = (updatedRow.warningCodes || []).filter((c) => !BUSINESS_WARNING_CODES.includes(c));
      const newWarnings = [...preservedWarnings];
      const newWarningCodes = [...preservedWarningCodes];

      if (!updatedRow.date) newErrors.push('يرجى تحديد تاريخ عملية الإنتاج.');
      if (!matchedWorker1) newErrors.push('لم يتم اختيار عامل 1 (حقل إلزامي).');
      if (editRowDraft.worker2Id && !matchedWorker2) newErrors.push('عامل 2 المحدد غير موجود ببيانات الموظفين.');
      if (!matchedPress) newErrors.push('لم يتم اختيار المكبس (حقل إلزامي).');
      if (!resolvedShift) newErrors.push(buildInvalidShiftMessage(editRowDraft.shift, 'ar'));
      if (!matchedProduct) newErrors.push('لم يتم اختيار الصنف (حقل إلزامي).');
      if (!productionQuantity || isNaN(productionQuantity) || productionQuantity <= 0) newErrors.push('إجمالي كمية الإنتاج يجب أن تكون أكبر من الصفر.');
      if (isNaN(wasteQuantity) || wasteQuantity < 0) newErrors.push('كمية الهالك غير صالحة.');
      else {
        // Business (non-blocking) warning - technically valid, logically unusual (§6/§18: values are never altered).
        for (const w of evaluateProductionWarnings({ productionQuantity, wasteQuantity, calculatedTotalFaults: updatedRow.calculatedTotalFaults, shiftHours: resolvedShift?.hours }, 'ar')) {
          newWarnings.push(w.message);
          newWarningCodes.push(w.code);
        }
      }
      newErrors.push(...furnaceCarErrors);
      updatedRow.errors = newErrors;
      updatedRow.warnings = newWarnings;
      updatedRow.warningCodes = newWarningCodes;
      updatedRow.warningsAccepted = false;
      updatedRow.warningOverrideBy = undefined;
      updatedRow.warningOverrideAt = undefined;

      updatedRow.goodQuantity = Math.max(0, (productionQuantity || 0) - (wasteQuantity || 0));
      if (updatedRow.pieceWeight > 0) {
        updatedRow.productionWeight = Number((((productionQuantity || 0) * updatedRow.pieceWeight) / 1000).toFixed(3));
        updatedRow.wasteWeight = Number((((wasteQuantity || 0) * updatedRow.pieceWeight) / 1000).toFixed(3));
        updatedRow.goodWeight = Number((updatedRow.productionWeight - updatedRow.wasteWeight).toFixed(3));
      }
      updatedRow.wastePercentage = productionQuantity > 0 ? Number((((wasteQuantity || 0) / productionQuantity) * 100).toFixed(2)) : 0;

      if (updatedRow.errors.length === 0) {
        updatedRow.status = updatedRow.warnings.length > 0 ? 'WARNING' : 'VALID';
      } else if (updatedRow.status === 'VALID' || updatedRow.status === 'WARNING') {
        updatedRow.status = 'INVALID_ROW';
      }

      // Original Data Preservation (§4): `raw` (the untouched Excel row) is
      // NEVER modified here - only the separate editedRowData snapshot is,
      // so Original vs Current Edited Version always stays distinguishable.
      updatedRow.editedRowData = {
        date: updatedRow.date,
        worker1: updatedRow.worker1Name,
        worker2: updatedRow.worker2Name,
        press: updatedRow.pressRaw,
        furnaceCars: updatedRow.furnaceCarsRaw,
        customerOrder: updatedRow.customerOrder,
        shift: updatedRow.shiftRaw,
        product: updatedRow.productNameRaw,
        productCode: updatedRow.productCodeRaw,
        pieceWeight: updatedRow.pieceWeight,
        aluminaPercentage: updatedRow.aluminaPercentage,
        productionQuantity: updatedRow.productionQuantity,
        wasteQuantity: updatedRow.wasteQuantity,
        mechanicalFaults: updatedRow.mechanicalFaults,
        electricalFaults: updatedRow.electricalFaults,
        workshopFaults: updatedRow.workshopFaults,
        rawMaterialFaults: updatedRow.rawMaterialFaults,
        otherFaults: updatedRow.otherFaults,
      };

      updatedRow.rowVersions = recordRowVersion(
        row,
        updatedRow,
        'FULL_ROW_EDIT',
        language === 'ar'
          ? `تعديل السجل بالكامل - الحالة: ${updatedRow.errors.length === 0 ? 'جاهز للاستيراد' : 'لا يزال به أخطاء مانعة'}`
          : `Edit Entire Row - status: ${updatedRow.errors.length === 0 ? 'ready to import' : 'still blocking'}`
      );

      let finalRow = pushHistory(
        updatedRow,
        'FULL_ROW_EDIT',
        `تعديل السجل بالكامل للصف ${editRowState.rowIndex} - الحالة الجديدة: ${updatedRow.errors.length === 0 ? 'جاهز للاستيراد' : 'لا يزال به أخطاء مانعة'}`
      );

      // "Edit & Re-import" (§12): re-inclusion is automatic, but ONLY the
      // selection flips - a still-invalid row stays BLOCKING, never forced Ready.
      if (editRowState.autoReinclude) {
        finalRow = pushHistory(
          { ...finalRow, rowSelection: 'INCLUDED' as const, exclusionReason: undefined, excludedBy: undefined, excludedAt: undefined, originalExclusionReason: undefined },
          'ROW_SELECTION',
          `إعادة إدراج الصف ${editRowState.rowIndex} بعد التعديل والتصحيح`
        );
      }

      return finalRow;
    });

    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;

    setPressingSummary({ ...pressingSummary, rows: updatedRows, validRows, warningRows, errorRows });
    if (editRowState.autoReinclude) setSessionReincludedCount((c) => c + 1);

    const editedRow = updatedRows.find(r => r.rowIndex === editRowState.rowIndex)!;
    logAuditAction(
      'UPDATE',
      'historicalImportSession',
      String(editRowState.rowIndex),
      `تعديل السجل بالكامل للصف ${editRowState.rowIndex} - الحالة الجديدة: ${editedRow.errors.length === 0 ? 'جاهز' : 'لا يزال به أخطاء مانعة'}`
    ).catch(() => {});

    // Bulk "Edit Selected" queue (§13): open the next selected excluded row.
    if (editRowState.queue.length > 0) {
      const [next, ...rest] = editRowState.queue;
      handleOpenEditEntireRow(next, { autoReinclude: editRowState.autoReinclude, queue: rest });
      return;
    }

    setEditRowState(null);
    setEditRowDraft(null);
  };

  // Furnace-car add/remove/brick-count handlers for the "Edit Entire Row"
  // modal - same SearchableCombobox-as-picker + local list composition
  // pattern already used in ProductionEntryForm.tsx.
  const handleAddFurnaceCarToEdit = (carId: string | null) => {
    if (!carId || !editRowDraft) return;
    if (editRowDraft.furnaceCarEntries.some((e) => e.carId === carId)) return;
    setEditRowDraft({ ...editRowDraft, furnaceCarEntries: [...editRowDraft.furnaceCarEntries, { carId, brickCount: '' }] });
  };
  const handleRemoveFurnaceCarFromEdit = (carId: string) => {
    if (!editRowDraft) return;
    setEditRowDraft({ ...editRowDraft, furnaceCarEntries: editRowDraft.furnaceCarEntries.filter((e) => e.carId !== carId) });
  };
  const handleFurnaceCarBrickCountChangeInEdit = (carId: string, value: string) => {
    if (!editRowDraft) return;
    setEditRowDraft({ ...editRowDraft, furnaceCarEntries: editRowDraft.furnaceCarEntries.map((e) => (e.carId === carId ? { ...e, brickCount: value } : e)) });
  };

  /** Explicit "Revalidate" action (§22) - re-checks a row's CURRENT data without
   * opening the editor. Also called automatically after Save (handleSaveRowEdit
   * already revalidates inline) and after bulk repair. */
  const handleRevalidateRow = (rowIndex: number) => {
    if (!pressingSummary) return;
    const updatedRows = pressingSummary.rows.map((row) => {
      if (row.rowIndex !== rowIndex) return row;
      const { errors, warnings, warningCodes, status } = computeRowValidation(row);
      const updatedRow: PressingImportRow = { ...row, errors, warnings, warningCodes, status, warningsAccepted: false, warningOverrideBy: undefined, warningOverrideAt: undefined };
      updatedRow.rowVersions = recordRowVersion(row, updatedRow, 'FIELD_EDIT', language === 'ar' ? 'إعادة فحص يدوية' : 'Manual revalidation');
      return pushHistory(
        updatedRow,
        'REVALIDATE',
        `إعادة فحص الصف ${rowIndex} - الحالة: ${errors.length === 0 ? 'جاهز للاستيراد' : 'لا يزال به أخطاء مانعة'}`
      );
    });
    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;
    setPressingSummary({ ...pressingSummary, rows: updatedRows, validRows, warningRows, errorRows });
  };

  /**
   * Undo/Revert (§13/§16): restores a row to the snapshot captured by a
   * SPECIFIC prior version - never a blind reset to the original Excel data.
   * Creates a NEW 'REVERT' version; the reverted-past version(s) stay exactly
   * as they were in history (append-only).
   */
  const handleRevertToVersion = (rowIndex: number, editId: string) => {
    if (!pressingSummary) return;
    const updatedRows = pressingSummary.rows.map((row) => {
      if (row.rowIndex !== rowIndex) return row;
      const targetVersion = (row.rowVersions || []).find((v) => v.editId === editId);
      if (!targetVersion) return row;

      const restoredRow = applySnapshotToRow(row, targetVersion.afterData);
      const { errors, warnings, warningCodes, status } = computeRowValidation(restoredRow);
      const finalRow: PressingImportRow = { ...restoredRow, errors, warnings, warningCodes, status, warningsAccepted: false, warningOverrideBy: undefined, warningOverrideAt: undefined };
      finalRow.editedRowData = snapshotRowFields(finalRow);
      finalRow.rowVersions = recordRowVersion(
        row,
        finalRow,
        'REVERT',
        language === 'ar' ? `تراجع إلى نسخة سابقة (${new Date(targetVersion.timestamp).toLocaleString('ar-EG')})` : `Reverted to a previous version (${new Date(targetVersion.timestamp).toLocaleString()})`
      );
      return pushHistory(finalRow, 'REVERT', `تراجع عن التعديل للصف ${rowIndex} إلى نسخة سابقة`);
    });
    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;
    setPressingSummary({ ...pressingSummary, rows: updatedRows, validRows, warningRows, errorRows });
    logAuditAction('UPDATE', 'historicalImportSession', String(rowIndex), `تراجع (Revert) عن تعديل الصف ${rowIndex}`).catch(() => {});
  };

  /**
   * Bulk Repair (§23): applies ONE field correction to every selected
   * (typically excluded) row sharing the same problem, then revalidates each
   * independently. Deliberately scoped to single-entity-reference fields
   * (Shift/Press/Worker1/Product) - furnace-car brick counts vary per row and
   * don't have a sensible "set the same value for everyone" semantic.
   */
  const handleBulkRepair = (
    rowIndexes: number[],
    field: 'shift' | 'press' | 'worker1' | 'product',
    value: { id?: string; shiftValue?: '1' | '2' | '3' }
  ) => {
    if (!pressingSummary || rowIndexes.length === 0) return;
    const idxSet = new Set(rowIndexes);
    const employees = masterDataByDomain.employee || [];
    const presses = masterDataByDomain.press || [];
    const products = masterDataByDomain.product || [];

    const updatedRows = pressingSummary.rows.map((row) => {
      if (!idxSet.has(row.rowIndex)) return row;
      let patched: PressingImportRow = { ...row };
      let reasonAr = '';
      let reasonEn = '';

      if (field === 'shift' && value.shiftValue) {
        const shiftNum = parseShiftNumber(value.shiftValue)!;
        patched.shiftRaw = value.shiftValue;
        patched.resolvedShift = { id: `shift-${shiftNum}`, code: buildShiftCode(shiftNum), name: buildShiftDisplayName(shiftNum, 'ar'), hours: 8 };
        reasonAr = `تصحيح جماعي: تعيين الوردية = ${patched.resolvedShift.name}`;
        reasonEn = `Bulk repair: set Shift = ${shiftNum}`;
      } else if (field === 'press' && value.id) {
        const press = presses.find((p: any) => p.id === value.id);
        if (press) {
          patched.pressRaw = press.name || press.code;
          patched.resolvedPress = { id: press.id, name: press.name, code: press.code };
          reasonAr = `تصحيح جماعي: تعيين المكبس = ${press.name}`;
          reasonEn = `Bulk repair: set Press = ${press.name}`;
        }
      } else if (field === 'worker1' && value.id) {
        const emp = employees.find((e: any) => e.id === value.id);
        if (emp) {
          patched.worker1Name = emp.name;
          patched.worker1Code = emp.code;
          patched.resolvedWorker1 = { id: emp.id, name: emp.name, code: emp.code, departmentName: emp.departmentName };
          reasonAr = `تصحيح جماعي: تعيين عامل 1 = ${emp.name}`;
          reasonEn = `Bulk repair: set Worker 1 = ${emp.name}`;
        }
      } else if (field === 'product' && value.id) {
        const prod = products.find((p: any) => p.id === value.id);
        if (prod) {
          patched.productCodeRaw = prod.code;
          patched.productNameRaw = prod.name;
          patched.resolvedProduct = { id: prod.id, name: prod.name, code: prod.code, pieceWeight: prod.pieceWeight, aluminaPercentage: prod.aluminaPercentage };
          reasonAr = `تصحيح جماعي: تعيين الصنف = ${prod.name}`;
          reasonEn = `Bulk repair: set Product = ${prod.name}`;
        }
      }

      if (!reasonAr) return row; // nothing matched this row's field (e.g. no id provided)

      const { errors, warnings, warningCodes, status } = computeRowValidation(patched);
      patched.errors = errors;
      patched.warnings = warnings;
      patched.warningCodes = warningCodes;
      patched.status = status;
      // §14 - any data change resets warning acceptance; a stale approval must
      // never silently carry over to a recomputed (possibly different) warning.
      patched.warningsAccepted = false;
      patched.warningOverrideBy = undefined;
      patched.warningOverrideAt = undefined;
      patched.editedRowData = snapshotRowFields(patched);
      patched.rowVersions = recordRowVersion(row, patched, 'BULK_REPAIR', language === 'ar' ? reasonAr : reasonEn);
      return pushHistory(patched, 'BULK_REPAIR', `${reasonAr} (تصحيح جماعي لـ ${rowIndexes.length} صف)`);
    });

    const validRows = updatedRows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate).length;
    const warningRows = updatedRows.filter(r => r.warnings.length > 0 && r.errors.length === 0).length;
    const errorRows = updatedRows.filter(r => r.errors.length > 0).length;
    setPressingSummary({ ...pressingSummary, rows: updatedRows, validRows, warningRows, errorRows });
    logAuditAction('UPDATE', 'historicalImportSession', rowIndexes.join(','), `تصحيح جماعي (${field}) لـ ${rowIndexes.length} صف`).catch(() => {});
  };

  /**
   * Explicit Warning Override (§7/§14/§17): approving a warning is a
   * deliberate action, never inferred from mere selection/inclusion. Values
   * are NEVER touched - the audit entry's originalData/finalData are
   * identical, proving nothing was silently altered to "fix" the warning (§18).
   * Gated on the `validation.overrideWarnings` permission (§20).
   */
  const handleAcceptRowWarnings = (rowIndex: number) => {
    if (!pressingSummary || !canOverrideWarnings) return;
    const row = pressingSummary.rows.find((r) => r.rowIndex === rowIndex);
    if (!row || row.warnings.length === 0) return;
    const dataSnapshot = snapshotRowFields(row);

    const updatedRows = pressingSummary.rows.map((r) => {
      if (r.rowIndex !== rowIndex) return r;
      const updated: PressingImportRow = { ...r, warningsAccepted: true, warningOverrideBy: actorName, warningOverrideAt: new Date().toISOString() };
      return pushHistory(updated, 'OVERRIDE_WARNING', `تسجيل رغم التحذير للصف ${rowIndex}: ${r.warnings.join(' | ')}`);
    });
    setPressingSummary({ ...pressingSummary, rows: updatedRows });

    logAuditAction(
      'UPDATE',
      'historicalImportSession',
      String(rowIndex),
      `[OVERRIDE_WARNING] importId=${importSessionId} rowId=${rowIndex} userId=${actorName} warningCodes=${(row.warningCodes || []).join(',')} warningMessage="${row.warnings.join(' | ')}" originalData=${JSON.stringify(dataSnapshot)} finalData=${JSON.stringify(dataSnapshot)}`
    ).catch(() => {});
  };

  /** Bulk "Approve & Import Despite Warnings" (§13/§16) - each row is still individually recorded in history/audit, matching a shared bulk operation. */
  const handleBulkAcceptWarnings = (rowIndexes: number[]) => {
    if (!pressingSummary || !canOverrideWarnings || rowIndexes.length === 0) return;
    const idxSet = new Set(rowIndexes);
    const updatedRows = pressingSummary.rows.map((r) => {
      if (!idxSet.has(r.rowIndex) || r.warnings.length === 0) return r;
      const updated: PressingImportRow = { ...r, warningsAccepted: true, warningOverrideBy: actorName, warningOverrideAt: new Date().toISOString() };
      return pushHistory(updated, 'OVERRIDE_WARNING', `اعتماد التحذيرات جماعيًا للصف ${r.rowIndex}: ${r.warnings.join(' | ')}`);
    });
    setPressingSummary({ ...pressingSummary, rows: updatedRows });
    logAuditAction('UPDATE', 'historicalImportSession', rowIndexes.join(','), `[OVERRIDE_WARNING] اعتماد جماعي للتحذيرات - importId=${importSessionId} - ${rowIndexes.length} صف`).catch(() => {});
  };

  // Start Actual Import
  const handleStartImport = async () => {
    if (selectedStage === 'pressing') {
      // The pressing importer now uses selective/partial import: this button
      // only opens the final confirmation dialog (showing exact counts) -
      // handleConfirmFinalImport does the actual write. See §16-19.
      if (!pressingSummary) return;
      const writable = pressingSummary.rows.filter(isRowWritable);
      if (writable.length === 0) {
        alert(language === 'ar' ? 'لا توجد صفوف محددة وجاهزة للاستيراد.' : 'No rows are both selected and ready to import.');
        return;
      }
      setShowFinalImportConfirm(true);
    } else {
      // Generic stages fallback - only rows that are BOTH currently selected
      // AND currently valid actually import (Part 7/§25: never the raw
      // validRows list unconditionally - that was the actual bug: Select
      // All/Valid had no effect on what got written).
      if (!genericValidation) return;
      const selectedValidRows = genericValidation.validRows.filter((r) => genericSelectedRowIndexes.has(r.rowIndex));
      if (selectedValidRows.length === 0) return;
      setIsImporting(true);
      setImportProgress(0);
      try {
        const summary = await executeBatchImport(
          selectedStage,
          selectedValidRows,
          (progress) => setImportProgress(progress)
        );
        setImportResult({
          total: selectedValidRows.length,
          imported: summary.success,
          failed: summary.errors.length,
          // PHASE 4F: includes rows caught by executeBatchImport's final
          // live duplicate recheck (a record created by someone else
          // since this file was validated), not just pre-write validation
          // errors - so the reported skip count is never understated.
          // PHASE 4F.2: also includes rows whose final recheck could not be
          // completed (fails closed - excluded rather than risking a
          // silent double-write), distinct from a CONFIRMED duplicate but
          // still correctly reflected in the total skipped count.
          skipped: genericValidation.errors.length + summary.duplicateSkippedCount + summary.recheckFailedCount,
          importId: `IMPORT-${Date.now()}`,
        });
        setGenericRawRows([]);
        setGenericValidation(null);
      } catch (err: any) {
        alert(language === 'ar' ? 'حدث خطأ أثناء الاستيراد: ' + (err.message || 'خطأ غير معروف') : 'Import error: ' + err.message);
      } finally {
        setIsImporting(false);
      }
    }
  };

  /**
   * Executes the actual write for the pressing importer's PARTIAL/selective
   * import, after the user has explicitly confirmed the exact counts.
   *
   * Safety rule (#7/#19): a row is revalidated with isRowWritable() a second
   * time, immediately before executing - a row that somehow became
   * unwritable between opening the confirmation dialog and clicking Confirm
   * (e.g. another action changed it) is silently dropped from the execution
   * batch and reflected in the result, never written.
   *
   * pressingSummary is intentionally NOT cleared afterward: rows that were
   * excluded/skipped/still-blocking remain visible and actionable so the
   * user can correct and re-import them without re-uploading the file (§23).
   */
  const handleConfirmFinalImport = async () => {
    if (isConfirmingPressingImportRef.current) return;
    isConfirmingPressingImportRef.current = true;
    if (!pressingSummary) {
      isConfirmingPressingImportRef.current = false;
      return;
    }
    setShowFinalImportConfirm(false);

    const toImport = pressingSummary.rows.filter(isRowWritable);
    if (toImport.length === 0) {
      isConfirmingPressingImportRef.current = false;
      return;
    }

    setIsImporting(true);
    setImportProgress(0);
    try {
      // PHASE 4F - FINAL LIVE DUPLICATE RECHECK: parseAndValidatePressingExcel's
      // own duplicate check was a snapshot taken when the file was first
      // reviewed; the user may have reviewed/corrected rows for a while
      // since then, during which another user/process could have written a
      // matching production record. Re-verify live, immediately before
      // writing, via a narrow per-(date,product) query - never a full
      // collection re-scan (see recheckPressingDatabaseDuplicates's own
      // doc comment). Newly-caught duplicates are pushed a new blocking
      // error and excluded from this run, but remain visible in the review
      // table (pressingSummary.rows is updated below) so the user can see
      // exactly why - never silently dropped.
      const rechecked = await recheckPressingDatabaseDuplicates(toImport);
      const stillWritable = rechecked.filter(isRowWritable);

      const rowsAfterRecheck = pressingSummary.rows.map((r) => {
        const updated = rechecked.find((rr) => rr.rowIndex === r.rowIndex);
        return updated || r;
      });
      setPressingSummary({ ...pressingSummary, rows: rowsAfterRecheck });

      if (stillWritable.length === 0) {
        setIsImporting(false);
        isConfirmingPressingImportRef.current = false;
        return;
      }

      const result = await executePressingBatchImport(
        stillWritable,
        backupId || undefined,
        (pct, currBatch, totBatches) => {
          setImportProgress(pct);
          setCurrentBatchNum(currBatch);
          setTotalBatchCount(totBatches);
        }
      );

      // The underlying batch commit is atomic per 400-row chunk (existing
      // architecture) - if the whole run reported zero failures, every
      // attempted row genuinely made it in; otherwise mark the whole
      // attempted set FAILED rather than guessing which specific rows
      // within a failed chunk succeeded (no false precision).
      const attemptedIds = new Set(stillWritable.map(r => r.rowIndex));
      const outcome: 'IMPORTED' | 'FAILED' = result.failedCount === 0 ? 'IMPORTED' : 'FAILED';
      const updatedRows = rowsAfterRecheck.map(r =>
        attemptedIds.has(r.rowIndex) ? { ...r, importOutcome: outcome } : r
      );
      setPressingSummary({ ...pressingSummary, rows: updatedRows });

      setImportResult({
        total: pressingSummary.totalRows,
        imported: result.importedCount,
        failed: result.failedCount,
        skipped: pressingSummary.totalRows - stillWritable.length,
        importId: result.importId,
      });

      logAuditAction(
        'BULK_IMPORT',
        'production',
        result.importId,
        `استيراد جزئي: ${result.importedCount} سجل مستورد، ${result.failedCount} فشل، ${pressingSummary.totalRows - toImport.length} غير محدد/مستبعد/متخطى من إجمالي ${pressingSummary.totalRows}`
      ).catch(() => {});
    } catch (err: any) {
      alert(language === 'ar' ? 'حدث خطأ أثناء تنفيذ الاستيراد: ' + (err.message || 'خطأ غير معروف') : 'Import error: ' + err.message);
    } finally {
      setIsImporting(false);
      isConfirmingPressingImportRef.current = false;
    }
  };

  /**
   * Exports every row that will NOT be imported (blocking-error, skipped, or
   * excluded) so the user has an offline record of what needs follow-up,
   * without re-uploading the source file (§29).
   */
  const handleExportErrorReport = () => {
    if (!pressingSummary) return;
    const rows = pressingSummary.rows.filter((r) => !isRowWritable(r));
    if (rows.length === 0) return;

    const reportRows = rows.map((r) => ({
      [language === 'ar' ? 'رقم الصف' : 'Row #']: r.rowIndex,
      [language === 'ar' ? 'الحالة' : 'Status']: getStatusLabel(getRowCategory(r), language),
      [language === 'ar' ? 'سبب الاستبعاد' : 'Exclusion Reason']: r.exclusionReason || '',
      [language === 'ar' ? 'التاريخ' : 'Date']: r.date || '',
      [language === 'ar' ? 'عامل 1' : 'Worker 1']: r.worker1Name || '',
      [language === 'ar' ? 'المكبس' : 'Press']: r.pressRaw || '',
      [language === 'ar' ? 'كود الصنف' : 'Product Code']: r.productCodeRaw || '',
      [language === 'ar' ? 'الأخطاء' : 'Errors']: r.errors.join(' | '),
      [language === 'ar' ? 'التنبيهات' : 'Warnings']: r.warnings.join(' | '),
    }));

    const worksheet = XLSX.utils.json_to_sheet(reportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, language === 'ar' ? 'أخطاء ومستبعد' : 'Errors-Skipped');
    XLSX.writeFile(workbook, `pressing-import-errors-${Date.now()}.xlsx`);
  };

  // Open Import History Modal
  const openHistoryModal = async () => {
    setIsHistoryModalOpen(true);
    setIsLoadingHistory(true);
    try {
      const history = await getHistoricalImportHistory();
      setImportHistory(history);
    } catch (err) {
      console.warn('Failed to load history:', err);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Handle Rollback Batch
  const handleConfirmRollback = async () => {
    if (!rollbackTargetBatch) return;
    setIsRollingBack(true);
    setRollbackSuccessMsg(null);
    try {
      const res = await rollbackImportBatch(rollbackTargetBatch.importBatchId, rollbackTargetBatch.stage);
      setRollbackSuccessMsg(
        language === 'ar'
          ? `تم التراجع بنجاح وحذف ${res.deletedCount} سجل من دفعة (${rollbackTargetBatch.importBatchId}).`
          : `Successfully rolled back ${res.deletedCount} records for batch (${rollbackTargetBatch.importBatchId}).`
      );
      // Refresh history list
      const refreshed = await getHistoricalImportHistory();
      setImportHistory(refreshed);
      setRollbackTargetBatch(null);
    } catch (err: any) {
      alert(language === 'ar' ? 'فشل التراجع عن الدفعة: ' + err.message : 'Rollback failed: ' + err.message);
    } finally {
      setIsRollingBack(false);
    }
  };

  // Filter pressing rows based on active tab
  const getFilteredPressingRows = (): PressingImportRow[] => {
    if (!pressingSummary) return [];
    switch (activeFilterTab) {
      case 'VALID':
        return pressingSummary.rows.filter(r => r.errors.length === 0 && r.warnings.length === 0 && !r.isDuplicate);
      case 'MATCHES':
        return pressingSummary.rows.filter(r => r.proposedMatches && r.proposedMatches.length > 0);
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

  // Count total proposed matches across all rows
  const totalProposedMatchesCount = pressingSummary?.rows.reduce(
    (acc, r) => acc + (r.proposedMatches?.length || 0), 
    0
  ) || 0;

  // Helper for Status Badge Rendering
  const renderStatusBadge = (row: PressingImportRow) => {
    if (getRowSelection(row) === 'EXCLUDED') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-200 text-slate-600 border border-slate-300">
          <Ban className="w-3 h-3 text-slate-500" />
          {row.exclusionReason === 'SKIPPED_ROW'
            ? (language === 'ar' ? 'متخطى' : 'Skipped')
            : (language === 'ar' ? 'مستبعد' : 'Excluded')}
        </span>
      );
    }
    if (row.errors.length > 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-red-100 text-red-800 border border-red-200">
          <AlertCircle className="w-3 h-3 text-red-600" />
          {row.status === 'UNKNOWN_EMPLOYEE' && (language === 'ar' ? 'عامل غير مسجل' : 'Unknown Employee')}
          {row.status === 'EMPLOYEE_MISMATCH' && (language === 'ar' ? 'تعارض كود العامل' : 'Employee Code Mismatch')}
          {row.status === 'UNKNOWN_PRODUCT' && (language === 'ar' ? 'صنف غير مسجل' : 'Unknown Product')}
          {row.status === 'PRODUCT_MISMATCH' && (language === 'ar' ? 'تعارض كود الصنف' : 'Product Code Mismatch')}
          {row.status === 'UNKNOWN_PRESS' && (language === 'ar' ? 'مكبس غير مسجل' : 'Unknown Press')}
          {row.status === 'UNKNOWN_FURNACE_CAR' && (language === 'ar' ? 'عربة غير مسجلة' : 'Unknown Furnace Car')}
          {row.status === 'INVALID_SHIFT' && (language === 'ar' ? 'وردية غير صالحة' : 'Invalid Shift')}
          {row.status === 'INVALID_DATE' && (language === 'ar' ? 'تاريخ غير صالح' : 'Invalid Date')}
          {row.status === 'INVALID_NUMBER' && (language === 'ar' ? 'أرقام غير صالحة' : 'Invalid Number')}
          {row.status === 'DUPLICATE_IN_FILE' && (language === 'ar' ? 'تكرار في الملف' : 'Duplicate in File')}
          {row.status === 'INVALID_ROW' && (language === 'ar' ? 'خطأ بالبيانات' : 'Invalid Row')}
          {row.status === 'DUPLICATE_RECHECK_FAILED' && (language === 'ar' ? 'تعذر التحقق النهائي' : 'Final Check Failed')}
        </span>
      );
    }

    if (row.warnings.length > 0 || row.isDuplicate) {
      // §4: warnings must be clearly distinguished from blocking errors, using
      // "تحذير" / "Warning" - never generic "Error" wording.
      const specificLabel =
        row.status === 'FAULT_TOTAL_MISMATCH' ? (language === 'ar' ? 'فروق أعطال' : 'Fault Mismatch')
        : row.status === 'MISSING_PIECE_WEIGHT' ? (language === 'ar' ? 'وزن مفقود' : 'Missing Weight')
        : row.status === 'DUPLICATE_IN_DATABASE' ? (language === 'ar' ? 'مكرر في النظام' : 'Duplicate in Database')
        : null;
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
          <AlertTriangle className="w-3 h-3 text-amber-600" />
          {specificLabel || (language === 'ar' ? 'تحذير' : 'Warning')}
          {row.warnings.length > 0 && needsWarningAcceptance(row) && (
            <span className="text-[9px] font-bold text-amber-700">({language === 'ar' ? 'بانتظار الموافقة' : 'awaiting approval'})</span>
          )}
          {row.warnings.length > 0 && row.warningsAccepted && (
            <span className="text-[9px] font-bold text-emerald-700">({language === 'ar' ? 'تم الاعتماد' : 'accepted'})</span>
          )}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
        {language === 'ar' ? 'جاهز' : 'Valid'}
      </span>
    );
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Header Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <FileSpreadsheet className="w-6 h-6 text-emerald-600" />
            <span>{language === 'ar' ? 'مركز استيراد بيانات الإنتاج التاريخي' : 'Historical Production Data Import'}</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            {language === 'ar' 
              ? 'استيراد السجلات السابقة عبر ملفات Excel الرسمية مع المطابقة الذكية للبيانات الأساسية وتدقيق الأعطال'
              : 'Import historical production records with smart AI-assisted fuzzy entity matching and complete audit rollback.'}
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={openHistoryModal}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <History className="w-4 h-4 text-slate-600" />
            <span>{language === 'ar' ? 'سجل العمليات والتراجع' : 'Import History & Rollback'}</span>
          </button>

          {selectedStage !== 'chinese_mills' && selectedStage !== 'tube_ball_mills' && (
            <button
              type="button"
              onClick={() => downloadStageExcelTemplate(selectedStage)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>{language === 'ar' ? `تحميل قالب Excel الرسمي (${STAGE_DISPLAY_NAMES[selectedStage]})` : `Download Template (${STAGE_DISPLAY_NAMES[selectedStage]})`}</span>
            </button>
          )}
        </div>
      </div>

      {/* Stage Selector Tabs */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-bold text-slate-700">
            {language === 'ar' ? 'اختر المرحلة الإنتاجية المراد استيراد بياناتها:' : 'Select Production Stage:'}
          </label>
          {selectedStage === 'pressing' && (
            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-emerald-600" />
              {language === 'ar' ? 'تنسيق المكابس المتقدم (21 عمود معتمد + مطابقة ذكية)' : 'Advanced Pressing Format (21 Columns + Smart Fuzzy Matching)'}
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

      {/* ========================================================================= */}
      {/* CHINESE MILLS - dedicated stage-specific smart-import panel (17-field    */}
      {/* schema, own upload/backup/review/execute) - self-contained, replaces the */}
      {/* shared dropzone/pressing/generic-fallback blocks below for this stage.   */}
      {/* ========================================================================= */}
      {selectedStage === 'chinese_mills' && <ChineseMillsImportPanel />}

      {/* ========================================================================= */}
      {/* TUBE/BALL MILLS - dedicated stage-specific smart-import panel (7-field   */}
      {/* schema: Mill/Material-or-Mixture/Bunker resolution) - self-contained,    */}
      {/* mirrors the Chinese Mills mount above exactly, replaces the shared       */}
      {/* dropzone/pressing/generic-fallback blocks below for this stage only.     */}
      {/* ========================================================================= */}
      {selectedStage === 'tube_ball_mills' && <TubeBallMillsImportPanel />}

      {selectedStage !== 'chinese_mills' && selectedStage !== 'tube_ball_mills' && (
      <>
      {/* Safety & Backup Banner */}
      <div className="bg-linear-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-xs font-black text-blue-950">
              {language === 'ar' ? 'إجراء وقائي: أخذ نسخة احتياطية فورية قبل الاستيراد' : 'Safety Check: Pre-import Backup Snapshot'}
            </h3>
            <p className="text-[11px] text-blue-800 mt-0.5">
              {language === 'ar' 
                ? 'يوصى بشدة بإنشاء نسخة احتياطية من قاعدة البيانات الحالية لضمان استرجاع البيانات بأمان في أي وقت.'
                : 'Recommended to generate a backup snapshot of current Firestore documents before batch execution.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {backupId ? (
            <span className="text-xs font-bold text-emerald-800 bg-emerald-100 border border-emerald-300 px-3 py-1.5 rounded-xl flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{language === 'ar' ? `النسخة الوقائية جاهزة (${backupId})` : `Safety Backup Ready (${backupId})`}</span>
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
                  <span>{language === 'ar' ? 'جاري الحفظ...' : 'Creating...'}</span>
                </>
              ) : (
                <>
                  <Database className="w-4 h-4" />
                  <span>{language === 'ar' ? 'إنشاء نسخة احتياطية وقائية الآن' : 'Create Safety Backup Now'}</span>
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
              {language === 'ar' 
                ? `اسحب وأفلت ملف Excel لمرحلة (${STAGE_DISPLAY_NAMES[selectedStage]}) هنا أو اضغط للاختيار`
                : `Drop Excel file for (${STAGE_DISPLAY_NAMES[selectedStage]}) or click to browse`}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {language === 'ar' 
                ? 'يدعم ملفات .xlsx و .csv. يتم تدقيق الأسماء والأكواد مع المطابقة الذكية في دفعات من 400 سجل.'
                : 'Supports .xlsx & .csv. Automated entity validation and batch commit.'}
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
            {language === 'ar' 
              ? 'جاري قراءة وفحص أعمدة وبيانات ملف Excel والمطابقة الذكية مع البيانات الأساسية...'
              : 'Reading and validating Excel sheet with smart fuzzy matching...'}
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
                <span>{language === 'ar' ? 'نتيجة الفحص الشامل لاستيراد المكابس (Pressing Dry-Run)' : 'Pressing Import Dry-Run & Audit'}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {language === 'ar' 
                  ? `تم تدقيق ${pressingSummary.totalRows} صف في الملف المرفوع وفق الأعمدة الـ 21 المعتمدة`
                  : `Validated ${pressingSummary.totalRows} rows against 21 standard columns`}
              </p>
            </div>

            {/* Comprehensive Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-center">
                <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'إجمالي الصفوف' : 'Total Rows'}</span>
                <span className="text-sm font-black text-slate-900">{pressingSummary.totalRows}</span>
              </div>
              <div className="p-2.5 bg-emerald-50 rounded-xl border border-emerald-200 text-center">
                <span className="text-[10px] font-bold text-emerald-700 block">{language === 'ar' ? 'جاهز وسليم' : 'Valid'}</span>
                <span className="text-sm font-black text-emerald-600">{pressingSummary.validRows}</span>
              </div>
              <div className="p-2.5 bg-indigo-50 rounded-xl border border-indigo-200 text-center">
                <span className="text-[10px] font-bold text-indigo-700 block">{language === 'ar' ? 'مطابقات معتمدة' : 'Approved Matches'}</span>
                <span className="text-sm font-black text-indigo-600">
                  {pressingSummary.rows.reduce((acc, r) => acc + (r.proposedMatches?.filter(m => m.decision === 'ACCEPTED').length || 0), 0)}
                </span>
              </div>
              <div className="p-2.5 bg-blue-50 rounded-xl border border-blue-200 text-center">
                <span className="text-[10px] font-bold text-blue-700 block">{language === 'ar' ? 'بيانات أساسية مضافة' : 'Added Entities'}</span>
                <span className="text-sm font-black text-blue-600">{addedMasterDataCount}</span>
              </div>
              <div className="p-2.5 bg-slate-100 rounded-xl border border-slate-300 text-center">
                <span className="text-[10px] font-bold text-slate-600 block">{language === 'ar' ? 'تم التخطي' : 'Skipped Items'}</span>
                <span className="text-sm font-black text-slate-700">
                  {pressingSummary.rows.reduce((acc, r) => acc + (r.proposedMatches?.filter(m => m.decision === 'REJECTED').length || 0), 0)}
                </span>
              </div>
              <div className="p-2.5 bg-amber-50 rounded-xl border border-amber-200 text-center">
                <span className="text-[10px] font-bold text-amber-800 block">{language === 'ar' ? 'تنبيهات وفروق' : 'Warnings'}</span>
                <span className="text-sm font-black text-amber-600">{pressingSummary.warningRows}</span>
              </div>
              <div className="p-2.5 bg-red-50 rounded-xl border border-red-200 text-center">
                <span className="text-[10px] font-bold text-red-800 block">{language === 'ar' ? 'أخطاء مانعة' : 'Blocking Errors'}</span>
                <span className="text-sm font-black text-red-600">{pressingSummary.errorRows}</span>
              </div>
            </div>
          </div>

          {/* Value-Level Global Mapping Feedback (Approve/Add/Skip propagation result) */}
          {feedback && (
            <div className={`rounded-2xl p-3.5 flex items-start gap-3 border ${
              feedback.type === 'success' ? 'bg-emerald-50 border-emerald-300 text-emerald-800' :
              feedback.type === 'error' ? 'bg-red-50 border-red-300 text-red-800' :
              'bg-slate-50 border-slate-300 text-slate-700'
            }`}>
              {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> : <Info className="w-4 h-4 shrink-0 mt-0.5" />}
              <span className="text-xs font-bold flex-1">{feedback.message}</span>
              <button
                type="button"
                onClick={() => setFeedback(null)}
                className="text-current opacity-60 hover:opacity-100 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Smart Match Banner if proposals exist */}
          {totalProposedMatchesCount > 0 && (
            <div className="bg-linear-to-r from-emerald-50 via-teal-50 to-indigo-50 border border-emerald-300/80 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-black text-emerald-950 flex items-center gap-1.5">
                    <span>{language === 'ar' ? 'المطابقة الذكية للبيانات والأسماء التاريخية' : 'Smart Historical Entity Matching'}</span>
                    <span className="px-2 py-0.5 bg-emerald-200 text-emerald-900 rounded-full text-[10px] font-bold">
                      {totalProposedMatchesCount} {language === 'ar' ? 'مطابقة مقترحة' : 'proposals'}
                    </span>
                  </h4>
                  <p className="text-[11px] text-emerald-800 mt-0.5">
                    {language === 'ar' 
                      ? 'تم التعرف الذكي على عمال ومكابس وأصناف وعربات أفران متقاربة. يمكنك اعتماد المطابقات لتصحيح الصفوف تلقائياً.'
                      : 'Fuzzy candidates found. Review and approve to automatically resolve unknown entity errors.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleAcceptAllHighConfidence}
                  className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <CheckCheck className="w-4 h-4" />
                  <span>{language === 'ar' ? 'اعتماد كافة التطابقات المؤكدة (≥ 90%)' : 'Accept High-Confidence Matches (≥ 90%)'}</span>
                </button>

                {/* One dedicated "Add All" button PER entity type - never a mixed table. */}
                {canAddMasterData && (['furnaceCar', 'employee', 'press', 'product'] as const).map((domain) => {
                  const domainItems = missingEntitiesForBatchAdd.filter((i) => i.domain === domain);
                  if (domainItems.length === 0) return null;
                  const labels = DOMAIN_BULK_LABELS[domain];
                  return (
                    <button
                      key={domain}
                      type="button"
                      onClick={() => setBulkAddDomain(domain)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>{`${language === 'ar' ? labels.arButton : labels.enButton} (${domainItems.length})`}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Diagnostic Breakdown Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 pt-1">
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'عمال غير مسجلين' : 'Unknown Workers'}</span>
              <span className={`text-xs font-black ${pressingSummary.unknownEmployeesCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownEmployeesCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'أصناف غير مسجلة' : 'Unknown Products'}</span>
              <span className={`text-xs font-black ${pressingSummary.unknownProductsCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownProductsCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'مكابس غير مسجلة' : 'Unknown Presses'}</span>
              <span className={`text-xs font-black ${pressingSummary.unknownPressesCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownPressesCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'عربات غير مسجلة' : 'Unknown Cars'}</span>
              <span className={`text-xs font-black ${pressingSummary.unknownFurnaceCarsCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.unknownFurnaceCarsCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'أخطاء الوردية' : 'Shift Errors'}</span>
              <span className={`text-xs font-black ${pressingSummary.shiftErrorsCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                {pressingSummary.shiftErrorsCount}
              </span>
            </div>
            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-bold text-slate-500 block">{language === 'ar' ? 'فروق مجموع الأعطال' : 'Fault Mismatches'}</span>
              <span className={`text-xs font-black ${pressingSummary.faultMismatchesCount > 0 ? 'text-amber-600' : 'text-slate-700'}`}>
                {pressingSummary.faultMismatchesCount}
              </span>
            </div>
          </div>

          {/* Unresolved Value Summary (Part 3 / #21) */}
          {unresolvedValueSummary.uniqueValues > 0 && (
            <div className="bg-indigo-50/60 border border-indigo-200 rounded-2xl p-3.5">
              <h4 className="text-xs font-bold text-indigo-900 mb-2">{language === 'ar' ? 'ملخص القيم غير المتطابقة' : 'Unresolved Value Summary'}</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                <div className="p-2 bg-white rounded-lg border border-indigo-200 text-center">
                  <span className="text-[10px] font-bold text-indigo-700 block">{language === 'ar' ? 'قيم فريدة' : 'Unique Values'}</span>
                  <span className="text-xs font-black text-indigo-900">{unresolvedValueSummary.uniqueValues}</span>
                </div>
                <div className="p-2 bg-white rounded-lg border border-indigo-200 text-center">
                  <span className="text-[10px] font-bold text-indigo-700 block">{language === 'ar' ? 'صفوف متأثرة' : 'Affected Rows'}</span>
                  <span className="text-xs font-black text-indigo-900">{unresolvedValueSummary.affectedRows}</span>
                </div>
                <div className="p-2 bg-white rounded-lg border border-emerald-200 text-center">
                  <span className="text-[10px] font-bold text-emerald-700 block">{language === 'ar' ? 'اعتماد مطابقة' : 'By Approval'}</span>
                  <span className="text-xs font-black text-emerald-800">{unresolvedValueSummary.resolvedByApproval}</span>
                </div>
                <div className="p-2 bg-white rounded-lg border border-blue-200 text-center">
                  <span className="text-[10px] font-bold text-blue-700 block">{language === 'ar' ? 'بيانات مضافة' : 'Added'}</span>
                  <span className="text-xs font-black text-blue-800">{unresolvedValueSummary.addedMasterData}</span>
                </div>
                <div className="p-2 bg-white rounded-lg border border-sky-200 text-center">
                  <span className="text-[10px] font-bold text-sky-700 block">{language === 'ar' ? 'اختيار يدوي' : 'Manual Selections'}</span>
                  <span className="text-xs font-black text-sky-800">{unresolvedValueSummary.manualSelections}</span>
                </div>
                <div className="p-2 bg-white rounded-lg border border-red-200 text-center">
                  <span className="text-[10px] font-bold text-red-700 block">{language === 'ar' ? 'متبقي مانع' : 'Remaining Blocking'}</span>
                  <span className={`text-xs font-black ${unresolvedValueSummary.remainingBlocking > 0 ? 'text-red-600' : 'text-slate-700'}`}>{unresolvedValueSummary.remainingBlocking}</span>
                </div>
              </div>
            </div>
          )}

          {/* Partial Import Selection Summary (§4/§30) */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 space-y-3">
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
              {[
                { label: language === 'ar' ? 'الإجمالي' : 'Total', value: partialImportSummary.total, color: 'text-slate-800 border-slate-200' },
                { label: language === 'ar' ? 'محدد' : 'Selected', value: partialImportSummary.selected, color: 'text-indigo-800 border-indigo-200' },
                { label: language === 'ar' ? 'جاهز' : 'Ready', value: partialImportSummary.ready, color: 'text-emerald-800 border-emerald-200' },
                { label: language === 'ar' ? 'مصحح' : 'Corrected', value: partialImportSummary.corrected, color: 'text-sky-800 border-sky-200' },
                { label: language === 'ar' ? 'تحذيرات' : 'Warnings', value: partialImportSummary.warning, color: 'text-amber-800 border-amber-200' },
                { label: language === 'ar' ? 'تم اعتماد التحذيرات' : 'Warnings Accepted', value: partialImportSummary.warningsAccepted, color: 'text-emerald-700 border-emerald-200' },
                { label: language === 'ar' ? 'أخطاء مانعة' : 'Blocking', value: partialImportSummary.blocking, color: 'text-red-700 border-red-200' },
                { label: language === 'ar' ? 'متخطى' : 'Skipped', value: partialImportSummary.skipped, color: 'text-amber-800 border-amber-200' },
                { label: language === 'ar' ? 'مستبعد' : 'Excluded', value: partialImportSummary.excluded, color: 'text-slate-500 border-slate-200' },
                { label: language === 'ar' ? 'سيتم استيراده' : 'Will Import', value: partialImportSummary.willImport, color: 'text-emerald-900 border-emerald-300 bg-emerald-50' },
              ].map((item) => (
                <div key={item.label} className={`p-2 bg-white rounded-lg border text-center ${item.color}`}>
                  <span className="text-[10px] font-bold block opacity-80">{item.label}</span>
                  <span className="text-sm font-black">{item.value}</span>
                </div>
              ))}
            </div>

            {/* Bulk Selection Controls */}
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200">
              <span className="text-[11px] font-bold text-slate-500 ml-1">{language === 'ar' ? 'تحديد جماعي:' : 'Bulk selection:'}</span>
              <button type="button" onClick={() => handleBulkSelection('ALL')} className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 cursor-pointer">
                {language === 'ar' ? 'تحديد الكل' : 'Select All'}
              </button>
              <button type="button" onClick={() => handleBulkSelection('NONE')} className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 cursor-pointer">
                {language === 'ar' ? 'إلغاء تحديد الكل' : 'Deselect All'}
              </button>
              <button type="button" onClick={() => handleBulkSelection('VALID')} className="px-2 py-1 bg-white hover:bg-slate-100 border border-emerald-200 rounded-lg text-[10px] font-bold text-emerald-700 cursor-pointer">
                {language === 'ar' ? 'تحديد الصفوف الصالحة فقط' : 'Select Valid Only'}
              </button>
              <button type="button" onClick={() => handleBulkSelection('CORRECTED')} className="px-2 py-1 bg-white hover:bg-slate-100 border border-sky-200 rounded-lg text-[10px] font-bold text-sky-700 cursor-pointer">
                {language === 'ar' ? 'تحديد الصفوف المصححة فقط' : 'Select Corrected Only'}
              </button>
              <button type="button" onClick={() => handleBulkSelection('READY')} className="px-2 py-1 bg-white hover:bg-slate-100 border border-indigo-200 rounded-lg text-[10px] font-bold text-indigo-700 cursor-pointer">
                {language === 'ar' ? 'تحديد جميع الصفوف الجاهزة' : 'Select All Ready Rows'}
              </button>
              <button type="button" onClick={() => handleBulkSelection('CLEAR')} className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-500 cursor-pointer">
                {language === 'ar' ? 'مسح التحديد' : 'Clear Selection'}
              </button>
              {partialImportSummary.warningsPending > 0 && (
                <button
                  type="button"
                  disabled={!canOverrideWarnings}
                  onClick={() => setShowBulkWarningAcceptConfirm(true)}
                  className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed text-amber-900 rounded-lg text-[10px] font-bold cursor-pointer flex items-center gap-1"
                  title={!canOverrideWarnings ? (language === 'ar' ? 'لا تملك صلاحية اعتماد التحذيرات' : 'You do not have permission to approve warnings') : ''}
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>{language === 'ar' ? `الموافقة رغم التحذيرات (${partialImportSummary.warningsPending})` : `Approve Despite Warnings (${partialImportSummary.warningsPending})`}</span>
                </button>
              )}
              {partialImportSummary.excluded > 0 && (
                <button
                  type="button"
                  onClick={() => setShowExcludedRowsPanel((v) => !v)}
                  className="mr-auto px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-[10px] font-bold cursor-pointer flex items-center gap-1"
                >
                  <Ban className="w-3 h-3" />
                  <span>{language === 'ar' ? `السجلات المستبعدة (${partialImportSummary.excluded})` : `Excluded Records (${partialImportSummary.excluded})`}</span>
                </button>
              )}
            </div>
          </div>

          {/* ================================================================= */}
          {/* PART 3 - Excluded Records screen (§11-16)                        */}
          {/* ================================================================= */}
          {showExcludedRowsPanel && (() => {
            const allExcludedRows = pressingSummary.rows.filter((r) => getRowSelection(r) === 'EXCLUDED');
            const q = excludedSearchQuery.trim().toLowerCase();
            const excludedRows = q === '' ? allExcludedRows : allExcludedRows.filter((row) => {
              const haystack = [
                String(row.rowIndex),
                row.originalExclusionReason || '',
                row.errors.join(' '),
                row.excludedBy || '',
                row.excludedAt || '',
                row.worker1Name || '', row.worker1Code || '',
                row.pressRaw || '', row.productNameRaw || '', row.productCodeRaw || '',
                row.exclusionReason || '',
                getRowCategory(row),
              ].join(' ').toLowerCase();
              return haystack.includes(q);
            });

            const stillBlocking = allExcludedRows.filter((r) => r.errors.length > 0).length;
            const readyAfterRepair = allExcludedRows.filter((r) => r.errors.length === 0).length;

            const allSelected = excludedRows.length > 0 && excludedRows.every((r) => selectedExcludedRowIndices.has(r.rowIndex));
            const toggleExcludedSelectAll = () => {
              setSelectedExcludedRowIndices(allSelected ? new Set() : new Set(excludedRows.map((r) => r.rowIndex)));
            };
            const toggleExcludedOne = (rowIndex: number) => {
              setSelectedExcludedRowIndices((prev) => {
                const next = new Set(prev);
                if (next.has(rowIndex)) next.delete(rowIndex); else next.add(rowIndex);
                return next;
              });
            };

            const bulkRepairOptions = bulkRepairField === 'shift'
              ? VALID_SHIFT_NUMBERS.map((n) => ({ id: String(n), label: buildShiftDisplayName(n as 1 | 2 | 3, language) }))
              : (masterDataByDomain[bulkRepairField === 'worker1' ? 'employee' : bulkRepairField] || []).map((it: any) => ({ id: it.id, label: it.name }));

            return (
              <div className="bg-slate-50 border border-slate-300 rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black text-slate-800">{language === 'ar' ? 'السجلات المستبعدة' : 'Excluded Records'}</h4>
                  <button type="button" onClick={() => setShowExcludedRowsPanel(false)} className="text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer">
                    {language === 'ar' ? 'إخفاء' : 'Hide'}
                  </button>
                </div>

                {/* Excluded Row Summary (§26) */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { label: language === 'ar' ? 'مستبعد' : 'Excluded', value: allExcludedRows.length, cls: 'text-slate-800' },
                    { label: language === 'ar' ? 'قابل للإصلاح' : 'Repairable', value: stillBlocking, cls: 'text-amber-800' },
                    { label: language === 'ar' ? 'لا يزال مانعًا' : 'Still Blocking', value: stillBlocking, cls: 'text-red-700' },
                    { label: language === 'ar' ? 'جاهز بعد الإصلاح' : 'Ready After Repair', value: readyAfterRepair, cls: 'text-emerald-700' },
                    { label: language === 'ar' ? 'محذوف نهائيًا' : 'Deleted Permanently', value: sessionDeletedCount, cls: 'text-slate-500' },
                    { label: language === 'ar' ? 'أعيد إدراجه' : 'Re-included', value: sessionReincludedCount, cls: 'text-indigo-700' },
                  ].map((s) => (
                    <div key={s.label} className="p-2 bg-white border border-slate-200 rounded-lg text-center">
                      <span className="text-[9px] font-bold text-slate-500 block">{s.label}</span>
                      <span className={`text-sm font-black ${s.cls}`}>{s.value}</span>
                    </div>
                  ))}
                </div>

                {allExcludedRows.length === 0 ? (
                  <p className="text-xs text-slate-500">{language === 'ar' ? 'لا توجد سجلات مستبعدة حالياً.' : 'No excluded records right now.'}</p>
                ) : (
                  <>
                    {/* Search/Filter (§27) */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={excludedSearchQuery}
                        onChange={(e) => setExcludedSearchQuery(e.target.value)}
                        placeholder={language === 'ar' ? 'بحث برقم الصف، السبب، الحقل، الحالة، المستخدم، التاريخ، الكود أو الاسم...' : 'Search by row #, reason, field, status, user, date, code or name...'}
                        className="w-full pr-8 pl-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 cursor-pointer">
                        <input type="checkbox" checked={allSelected} onChange={toggleExcludedSelectAll} className="w-3.5 h-3.5 cursor-pointer" />
                        {language === 'ar' ? 'تحديد الكل' : 'Select All'}
                      </label>
                      <span className="text-[11px] text-slate-400">({selectedExcludedRowIndices.size} {language === 'ar' ? 'محدد' : 'selected'})</span>
                      <button
                        type="button"
                        disabled={selectedExcludedRowIndices.size === 0}
                        onClick={handleEditSelectedExcluded}
                        className="px-2 py-1 bg-blue-50 hover:bg-blue-100 disabled:opacity-40 disabled:cursor-not-allowed border border-blue-200 rounded-lg text-[10px] font-bold text-blue-700 cursor-pointer"
                      >
                        {language === 'ar' ? 'تعديل المحدد' : 'Edit Selected'}
                      </button>
                      <button
                        type="button"
                        disabled={selectedExcludedRowIndices.size === 0}
                        onClick={() => handleBulkReincludeExcluded(Array.from(selectedExcludedRowIndices))}
                        className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed border border-emerald-200 rounded-lg text-[10px] font-bold text-emerald-700 cursor-pointer"
                      >
                        {language === 'ar' ? 'إعادة إدراج المحدد' : 'Re-include Selected'}
                      </button>
                      <button
                        type="button"
                        disabled={selectedExcludedRowIndices.size === 0}
                        onClick={() => setShowBulkRepairPanel((v) => !v)}
                        className="px-2 py-1 bg-purple-50 hover:bg-purple-100 disabled:opacity-40 disabled:cursor-not-allowed border border-purple-200 rounded-lg text-[10px] font-bold text-purple-700 cursor-pointer"
                      >
                        {language === 'ar' ? 'تعديل البيانات المحددة (جماعي)' : 'Bulk Repair Selected'}
                      </button>
                      <button
                        type="button"
                        disabled={selectedExcludedRowIndices.size === 0}
                        onClick={() => setDeleteConfirmState({ rowIndexes: Array.from(selectedExcludedRowIndices) })}
                        className="px-2 py-1 bg-red-50 hover:bg-red-100 disabled:opacity-40 disabled:cursor-not-allowed border border-red-200 rounded-lg text-[10px] font-bold text-red-700 cursor-pointer"
                      >
                        {language === 'ar' ? 'حذف المحدد نهائيًا' : 'Delete Selected Permanently'}
                      </button>
                    </div>

                    {/* Bulk Repair panel (§23) */}
                    {showBulkRepairPanel && (
                      <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl space-y-2">
                        <p className="text-[11px] font-bold text-purple-900">
                          {language === 'ar'
                            ? `تطبيق تصحيح واحد على ${selectedExcludedRowIndices.size} صف محدد. استخدم هذا فقط عندما تشترك الصفوف في نفس المشكلة (مثال: كلها بدون وردية).`
                            : `Apply one correction to ${selectedExcludedRowIndices.size} selected rows. Use this only when the rows share the same problem (e.g. all missing shift).`}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            value={bulkRepairField}
                            onChange={(e) => { setBulkRepairField(e.target.value as any); setBulkRepairValue(''); }}
                            className="px-2 py-1.5 text-xs border border-purple-300 rounded-lg"
                          >
                            <option value="shift">{language === 'ar' ? 'الوردية' : 'Shift'}</option>
                            <option value="press">{language === 'ar' ? 'المكبس' : 'Press'}</option>
                            <option value="worker1">{language === 'ar' ? 'عامل 1' : 'Worker 1'}</option>
                            <option value="product">{language === 'ar' ? 'الصنف' : 'Product'}</option>
                          </select>
                          <select
                            value={bulkRepairValue}
                            onChange={(e) => setBulkRepairValue(e.target.value)}
                            className="px-2 py-1.5 text-xs border border-purple-300 rounded-lg flex-1 min-w-[160px]"
                          >
                            <option value="">{language === 'ar' ? '-- اختر قيمة --' : '-- choose a value --'}</option>
                            {bulkRepairOptions.map((opt: any) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                          </select>
                          <button
                            type="button"
                            disabled={!bulkRepairValue}
                            onClick={() => setBulkRepairConfirm(true)}
                            className="px-3 py-1.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer"
                          >
                            {language === 'ar' ? 'تطبيق' : 'Apply'}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 max-h-[min(20rem,calc(100vh-600px))] lg:max-h-[min(20rem,calc(100vh-540px))]">
                      <table className="w-full text-right text-[11px]">
                        <thead className="bg-white text-slate-700 font-black sticky top-0 z-10 border-b border-slate-200">
                          <tr>
                            <th className="p-2"></th>
                            <th className="p-2">#</th>
                            <th className="p-2">{language === 'ar' ? 'البيانات الأصلية' : 'Original Data'}</th>
                            <th className="p-2">{language === 'ar' ? 'البيانات الحالية' : 'Current Data'}</th>
                            <th className="p-2">{language === 'ar' ? 'الحالة الحالية' : 'Current Status'}</th>
                            <th className="p-2">{language === 'ar' ? 'سبب الاستبعاد الأصلي' : 'Original Exclusion Reason'}</th>
                            <th className="p-2">{language === 'ar' ? 'نتيجة الفحص الحالية' : 'Current Validation Result'}</th>
                            <th className="p-2">{language === 'ar' ? 'آخر تعديل' : 'Last Modified'}</th>
                            <th className="p-2">{language === 'ar' ? 'بواسطة' : 'Modified By'}</th>
                            <th className="p-2">{language === 'ar' ? 'إجراءات' : 'Actions'}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 font-mono">
                          {excludedRows.map((row) => {
                            const lastVersion = row.rowVersions && row.rowVersions.length > 0 ? row.rowVersions[row.rowVersions.length - 1] : null;
                            return (
                            <tr key={row.rowIndex} className="hover:bg-white">
                              <td className="p-2">
                                <input type="checkbox" checked={selectedExcludedRowIndices.has(row.rowIndex)} onChange={() => toggleExcludedOne(row.rowIndex)} className="w-3.5 h-3.5 cursor-pointer" />
                              </td>
                              <td className="p-2 font-bold text-slate-500">{row.rowIndex}</td>
                              <td className="p-2 max-w-[160px] truncate font-sans" title={JSON.stringify(row.raw)}>
                                {row.worker1Name || row.worker1Code || '-'} / {row.productNameRaw || row.productCodeRaw || '-'}
                              </td>
                              <td className="p-2 max-w-[160px] truncate font-sans" title={row.editedRowData ? JSON.stringify(row.editedRowData) : ''}>
                                {row.editedRowData ? (language === 'ar' ? 'تم تعديله' : 'Edited') : (language === 'ar' ? 'بدون تعديل' : 'Unedited')}
                              </td>
                              <td className="p-2">{renderStatusBadge(row)}</td>
                              <td className="p-2 max-w-[180px] truncate font-sans text-red-700" title={row.originalExclusionReason || ''}>
                                {row.originalExclusionReason || '-'}
                              </td>
                              <td className="p-2 max-w-[180px] truncate font-sans" title={row.errors.join(' | ') || (row.warnings.join(' | ') || '')}>
                                {row.errors.length > 0
                                  ? <span className="text-red-700 font-bold">{language === 'ar' ? `مانع (${row.errors.length})` : `Blocking (${row.errors.length})`}</span>
                                  : <span className="text-emerald-700 font-bold">{language === 'ar' ? 'جاهز للاستيراد' : 'Ready to import'}</span>}
                              </td>
                              <td className="p-2 font-sans">{lastVersion ? formatDateTime(lastVersion.timestamp) : (row.excludedAt ? formatDateTime(row.excludedAt) : '-')}</td>
                              <td className="p-2 font-sans">{lastVersion?.userId || row.excludedBy || '-'}</td>
                              <td className="p-2">
                                <div className="flex flex-wrap items-center gap-1">
                                  <button type="button" onClick={() => handleEditAndReimport(row.rowIndex)} className="px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-bold cursor-pointer">
                                    {language === 'ar' ? 'تعديل وإعادة رفع' : 'Edit & Re-import'}
                                  </button>
                                  <button type="button" onClick={() => handleRevalidateRow(row.rowIndex)} className="px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded text-[10px] font-bold cursor-pointer">
                                    {language === 'ar' ? 'إعادة الفحص' : 'Revalidate'}
                                  </button>
                                  <button type="button" onClick={() => handleReincludeRow(row.rowIndex)} className="px-1.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold cursor-pointer">
                                    {language === 'ar' ? 'إعادة إدراج' : 'Re-include'}
                                  </button>
                                  {row.rowVersions && row.rowVersions.length > 0 && (
                                    <button type="button" onClick={() => setHistoryModalRowIndex(row.rowIndex)} className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold cursor-pointer flex items-center gap-0.5">
                                      <History className="w-3 h-3" />{language === 'ar' ? 'السجل' : 'History'}
                                    </button>
                                  )}
                                  <button type="button" onClick={() => setDeleteConfirmState({ rowIndexes: [row.rowIndex] })} className="px-1.5 py-0.5 bg-red-50 hover:bg-red-100 text-red-700 rounded text-[10px] font-bold cursor-pointer">
                                    {language === 'ar' ? 'حذف نهائي' : 'Delete Permanently'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                            );
                          })}
                          {excludedRows.length === 0 && (
                            <tr><td colSpan={10} className="p-4 text-center text-slate-400 font-sans">{language === 'ar' ? 'لا توجد نتائج مطابقة للبحث.' : 'No results match your search.'}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

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
              {language === 'ar' ? `كافة الصفوف (${pressingSummary.totalRows})` : `All Rows (${pressingSummary.totalRows})`}
            </button>

            {totalProposedMatchesCount > 0 && (
              <button
                type="button"
                onClick={() => setActiveFilterTab('MATCHES')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  activeFilterTab === 'MATCHES'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{language === 'ar' ? `مراجعة المطابقات الذكية (${totalProposedMatchesCount})` : `Smart Matches (${totalProposedMatchesCount})`}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveFilterTab('VALID')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                activeFilterTab === 'VALID'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              }`}
            >
              {language === 'ar' ? `جاهزة وسليمة (${pressingSummary.validRows})` : `Valid (${pressingSummary.validRows})`}
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
              {language === 'ar' ? `تنبيهات وفروق (${pressingSummary.warningRows})` : `Warnings (${pressingSummary.warningRows})`}
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
              {language === 'ar' ? `أخطاء مانعة (${pressingSummary.errorRows})` : `Errors (${pressingSummary.errorRows})`}
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
              {language === 'ar' ? `سجلات مكررة (${pressingSummary.duplicateRows})` : `Duplicates (${pressingSummary.duplicateRows})`}
            </button>
          </div>

          {/* Full Rich Preview Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>{language === 'ar' ? `معاينة الصفوف المفحوصة (${filteredPressingRows.length} صف معروض):` : `Row Preview (${filteredPressingRows.length} rows):`}</span>
              <span className="text-[11px] text-slate-400 font-mono">{language === 'ar' ? '21 عمود مطابق لقالب المكابس' : '21 Column Standard Matrix'}</span>
            </div>

            <div className="overflow-x-auto overflow-y-auto rounded-xl border border-slate-200 max-h-[calc(100vh-540px)] lg:max-h-[calc(100vh-480px)]">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 text-slate-700 font-black sticky top-0 z-10 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2.5 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={partialImportSummary.selected > 0 && partialImportSummary.selected === partialImportSummary.total}
                        onChange={(e) => handleBulkSelection(e.target.checked ? 'ALL' : 'NONE')}
                        className="w-3.5 h-3.5 cursor-pointer"
                        title={language === 'ar' ? 'تحديد/إلغاء تحديد الكل' : 'Select/Deselect All'}
                      />
                    </th>
                    <th className="p-2.5 whitespace-nowrap">#</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'المطابقات الذكية والقرارات' : 'Smart Matches & Actions'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'عامل 1 (الاسم / السجل)' : 'Worker 1'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'عامل 2 (الاسم / السجل)' : 'Worker 2'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'رقم العربات' : 'Furnace Cars'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'المكبس' : 'Press'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'طلب العميل' : 'Customer Order'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الوردية' : 'Shift'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'كود الصنف' : 'Product Code'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'اسم الصنف' : 'Product Name'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الألومينا %' : 'Alumina %'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'وزن القطعة' : 'Piece Weight'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الإنتاج' : 'Production'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'الهالك' : 'Waste'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'ميكانيكا' : 'Mechanical'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'كهرباء' : 'Electrical'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'ورشة' : 'Workshop'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'خامات' : 'Raw Material'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'أخرى' : 'Other'}</th>
                    <th className="p-2.5 whitespace-nowrap">{language === 'ar' ? 'إجمالي الأعطال' : 'Total Faults'}</th>
                    <th className="p-2.5 whitespace-nowrap min-w-[220px]">{language === 'ar' ? 'الملاحظات والأخطاء' : 'Notes & Errors'}</th>
                    <th className="p-2.5 whitespace-nowrap min-w-[180px]">{language === 'ar' ? 'إجراءات الصف' : 'Row Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                  {filteredPressingRows.map((row) => (
                    <tr
                      key={row.rowIndex}
                      className={`hover:bg-slate-50 transition-colors ${
                        getRowSelection(row) === 'EXCLUDED'
                          ? 'bg-slate-100/70 opacity-50'
                          : row.errors.length > 0
                            ? 'bg-red-50/40'
                            : row.warnings.length > 0
                              ? 'bg-amber-50/30'
                              : ''
                      }`}
                    >
                      <td className="p-2.5">
                        <input
                          type="checkbox"
                          checked={getRowSelection(row) === 'INCLUDED'}
                          onChange={() => handleToggleRowSelection(row.rowIndex, getRowSelection(row) !== 'INCLUDED')}
                          className="w-3.5 h-3.5 cursor-pointer"
                        />
                      </td>
                      <td className="p-2.5 font-bold text-slate-500">{row.rowIndex}</td>
                      <td className="p-2.5">{renderStatusBadge(row)}</td>

                      {/* Smart Fuzzy Match Decision & Action Column */}
                      <td className="p-2.5 font-sans min-w-[260px]">
                        <div className="space-y-2">
                          {row.proposedMatches && row.proposedMatches.length > 0 && (
                            <div className="space-y-2">
                              {row.proposedMatches.map((prop, mIdx) => (
                                <div 
                                  key={mIdx}
                                  className={`p-2 rounded-lg border text-[11px] ${
                                    prop.decision === 'ACCEPTED'
                                      ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                                      : prop.decision === 'REJECTED'
                                        ? 'bg-slate-100 border-slate-200 text-slate-500'
                                        : 'bg-indigo-50/70 border-indigo-200 text-indigo-950'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-1 font-bold">
                                    <span className="flex items-center gap-1">
                                      <Sparkles className="w-3 h-3 text-indigo-600 shrink-0" />
                                      {prop.fieldNameAr || prop.fieldDomain}
                                    </span>
                                    <span className={`px-1.5 py-0.2 rounded text-[10px] ${
                                      prop.confidence >= 90 
                                        ? 'bg-emerald-100 text-emerald-800' 
                                        : 'bg-amber-100 text-amber-800'
                                    }`}>
                                      {prop.confidence}%
                                    </span>
                                  </div>

                                  <div className="mt-1 text-[11px]">
                                    <span className="text-slate-500">{language === 'ar' ? 'الملف: ' : 'Imported: '}</span>
                                    <span className="font-bold">{prop.importedValue}</span>
                                    <span className="text-indigo-600 mx-1">&rarr;</span>
                                    <span className="font-black text-indigo-900">{prop.suggestedName}</span>
                                  </div>

                                  {/* Actions: Approve / Add / Skip */}
                                  <div className="mt-2 pt-1 border-t border-indigo-100/80">
                                    {prop.decision === 'ACCEPTED' ? (
                                      <span className="text-emerald-700 font-bold flex items-center gap-1 text-[10px]">
                                        <Check className="w-3 h-3" />
                                        {language === 'ar' ? 'تم الاعتماد' : 'Approved'}
                                      </span>
                                    ) : prop.decision === 'REJECTED' ? (
                                      <div className="flex items-center justify-between gap-1">
                                        <span className="text-slate-500 font-bold flex items-center gap-1 text-[10px]">
                                          <Ban className="w-3 h-3 text-slate-400" />
                                          {language === 'ar' ? 'تم التخطي' : 'Skipped'}
                                        </span>
                                        {canAddMasterData && (
                                          <button
                                            type="button"
                                            onClick={() => handleOpenInlineAdd(prop.fieldDomain, prop.importedValue, row.rowIndex)}
                                            className="px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[9px] font-bold cursor-pointer"
                                          >
                                            {language === 'ar' ? 'إضافة كعنصر جديد' : 'Add as new'}
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {/* 1. [Approve] / [اعتماد] */}
                                        <button
                                          type="button"
                                          onClick={() => handleAcceptProposedMatch(row.rowIndex, mIdx)}
                                          className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold text-[10px] cursor-pointer flex items-center gap-0.5 shadow-xs"
                                          title={language === 'ar' ? 'اعتماد المطابقة المقترحة' : 'Approve suggested match'}
                                        >
                                          <Check className="w-3 h-3" />
                                          <span>{language === 'ar' ? 'اعتماد' : 'Approve'}</span>
                                        </button>

                                        {/* 2. [Add] / [إضافة] */}
                                        {canAddMasterData && (
                                          <button
                                            type="button"
                                            onClick={() => handleOpenInlineAdd(prop.fieldDomain, prop.importedValue, row.rowIndex)}
                                            className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold text-[10px] cursor-pointer flex items-center gap-0.5 shadow-xs"
                                            title={language === 'ar' ? 'إضافة إلى البيانات الأساسية' : 'Add to Master Data'}
                                          >
                                            <Plus className="w-3 h-3" />
                                            <span>{language === 'ar' ? 'إضافة' : 'Add'}</span>
                                          </button>
                                        )}

                                        {/* Candidates switcher if multiple */}
                                        {prop.candidates && prop.candidates.length > 1 && (
                                          <select
                                            onChange={(e) => {
                                              const cId = e.target.value;
                                              const cand = prop.candidates?.find(c => c.id === cId);
                                              if (cand) handleAcceptProposedMatch(row.rowIndex, mIdx, cand);
                                            }}
                                            className="text-[10px] bg-white border border-slate-300 rounded px-1 py-0.5 cursor-pointer"
                                            defaultValue=""
                                          >
                                            <option value="" disabled>{language === 'ar' ? 'بدائل أخرى...' : 'Other...'}</option>
                                            {prop.candidates.map((c) => (
                                              <option key={c.id} value={c.id}>
                                                {c.name} ({c.confidence}%)
                                              </option>
                                            ))}
                                          </select>
                                        )}

                                        {/* 3. [Skip] / [تخطي] */}
                                        <button
                                          type="button"
                                          onClick={() => handleSkipProposedMatch(row.rowIndex, mIdx)}
                                          className="px-1.5 py-0.5 text-slate-600 hover:text-red-700 hover:bg-red-50 rounded text-[10px] font-bold cursor-pointer transition-colors"
                                          title={language === 'ar' ? 'تخطي هذا البيان' : 'Skip this item'}
                                        >
                                          {language === 'ar' ? 'تخطي' : 'Skip'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Direct Quick Add / Manual Selection for Unresolved Entity Errors.
                              "Choose Existing" is always available (no master-data-create
                              permission required - it never creates anything); "+ Add"
                              requires canAddMasterData, per the permission requirement. */}
                          <div className="flex flex-wrap gap-1">
                            {row.worker1Name && !row.resolvedWorker1 && !row.proposedMatches?.some(m => (m.fieldDomain === 'worker1' || m.fieldDomain === 'employee1') && (m.decision === 'ACCEPTED' || m.decision === 'MANUAL')) && (
                              <>
                                {canViewMasterData && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setManualSelectState({ isOpen: true, domain: 'employee', importedValue: row.worker1Name, rowIndex: row.rowIndex, editedValue: row.worker1Name, mode: 'MANUAL_EDIT' })}
                                      className="text-[9px] px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                      title={language === 'ar' ? 'تصحيح القيمة يدوياً ثم البحث/الإضافة' : 'Manually correct the value, then search/add'}
                                    >
                                      <Edit3 className="w-2.5 h-2.5 text-indigo-700" />
                                      <span>{language === 'ar' ? 'تعديل يدوي' : 'Manual Edit'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setManualSelectState({ isOpen: true, domain: 'employee', importedValue: row.worker1Name, rowIndex: row.rowIndex, editedValue: row.worker1Name, mode: 'CHOOSE_EXISTING' })}
                                      className="text-[9px] px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                    >
                                      <Search className="w-2.5 h-2.5 text-sky-700" />
                                      <span>{language === 'ar' ? `اختيار موجود (${row.worker1Name})` : `Choose Existing (${row.worker1Name})`}</span>
                                    </button>
                                  </>
                                )}
                                {canAddMasterData && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenInlineAdd('employee', row.worker1Name, row.rowIndex, { suggestedCode: row.worker1Code })}
                                    className="text-[9px] px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                  >
                                    <Plus className="w-2.5 h-2.5 text-amber-700" />
                                    <span>{language === 'ar' ? `+ إضافة عامل 1 (${row.worker1Name})` : `+ Add Worker 1`}</span>
                                  </button>
                                )}
                              </>
                            )}
                            {row.pressRaw && !row.resolvedPress && !row.proposedMatches?.some(m => m.fieldDomain === 'press' && (m.decision === 'ACCEPTED' || m.decision === 'MANUAL')) && (
                              <>
                                {canViewMasterData && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setManualSelectState({ isOpen: true, domain: 'press', importedValue: row.pressRaw, rowIndex: row.rowIndex, editedValue: row.pressRaw, mode: 'MANUAL_EDIT' })}
                                      className="text-[9px] px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                      title={language === 'ar' ? 'تصحيح القيمة يدوياً ثم البحث/الإضافة' : 'Manually correct the value, then search/add'}
                                    >
                                      <Edit3 className="w-2.5 h-2.5 text-indigo-700" />
                                      <span>{language === 'ar' ? 'تعديل يدوي' : 'Manual Edit'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setManualSelectState({ isOpen: true, domain: 'press', importedValue: row.pressRaw, rowIndex: row.rowIndex, editedValue: row.pressRaw, mode: 'CHOOSE_EXISTING' })}
                                      className="text-[9px] px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                    >
                                      <Search className="w-2.5 h-2.5 text-sky-700" />
                                      <span>{language === 'ar' ? `اختيار موجود (${row.pressRaw})` : `Choose Existing (${row.pressRaw})`}</span>
                                    </button>
                                  </>
                                )}
                                {canAddMasterData && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenInlineAdd('press', row.pressRaw, row.rowIndex)}
                                    className="text-[9px] px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                  >
                                    <Plus className="w-2.5 h-2.5 text-amber-700" />
                                    <span>{language === 'ar' ? `+ إضافة مكبس (${row.pressRaw})` : `+ Add Press`}</span>
                                  </button>
                                )}
                              </>
                            )}
                            {row.productCodeRaw && !row.resolvedProduct && !row.proposedMatches?.some(m => m.fieldDomain === 'product' && (m.decision === 'ACCEPTED' || m.decision === 'MANUAL')) && (
                              <>
                                {canViewMasterData && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => setManualSelectState({ isOpen: true, domain: 'product', importedValue: row.productNameRaw || row.productCodeRaw, rowIndex: row.rowIndex, editedValue: row.productNameRaw || row.productCodeRaw, mode: 'MANUAL_EDIT' })}
                                      className="text-[9px] px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                      title={language === 'ar' ? 'تصحيح القيمة يدوياً ثم البحث/الإضافة' : 'Manually correct the value, then search/add'}
                                    >
                                      <Edit3 className="w-2.5 h-2.5 text-indigo-700" />
                                      <span>{language === 'ar' ? 'تعديل يدوي' : 'Manual Edit'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setManualSelectState({ isOpen: true, domain: 'product', importedValue: row.productNameRaw || row.productCodeRaw, rowIndex: row.rowIndex, editedValue: row.productNameRaw || row.productCodeRaw, mode: 'CHOOSE_EXISTING' })}
                                      className="text-[9px] px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                    >
                                      <Search className="w-2.5 h-2.5 text-sky-700" />
                                      <span>{language === 'ar' ? `اختيار موجود (${row.productCodeRaw})` : `Choose Existing (${row.productCodeRaw})`}</span>
                                    </button>
                                  </>
                                )}
                                {canAddMasterData && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenInlineAdd('product', row.productNameRaw || row.productCodeRaw, row.rowIndex, { code: row.productCodeRaw, pieceWeight: row.pieceWeight, aluminaPercentage: row.aluminaPercentage })}
                                    className="text-[9px] px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                  >
                                    <Plus className="w-2.5 h-2.5 text-amber-700" />
                                    <span>{language === 'ar' ? `+ إضافة صنف (${row.productCodeRaw})` : `+ Add Product`}</span>
                                  </button>
                                )}
                              </>
                            )}
                            {/* Unresolved Furnace Cars: Choose Existing / Add per missing token */}
                            {(() => {
                              const tokens = row.furnaceCarTokens || (row.furnaceCarsRaw ? parseFurnaceCarBrickPairs(row.furnaceCarsRaw).map(p => p.carNumber).filter(Boolean) : []);
                              const unresolvedTokens = tokens.filter(t =>
                                !row.resolvedFurnaceCars?.some(rc => (rc.code && rc.code.toLowerCase() === t.toLowerCase()) || (rc.carNumber && rc.carNumber.toLowerCase() === t.toLowerCase())) &&
                                !row.proposedMatches?.some(m => m.fieldDomain === 'furnaceCar' && m.importedValue.toLowerCase() === t.toLowerCase() && (m.decision === 'ACCEPTED' || m.decision === 'MANUAL'))
                              );

                              return (
                                <div className="flex flex-wrap gap-1">
                                  {unresolvedTokens.map((token, uIdx) => (
                                    <React.Fragment key={uIdx}>
                                      {canViewMasterData && (
                                        <>
                                          <button
                                            type="button"
                                            onClick={() => setManualSelectState({ isOpen: true, domain: 'furnaceCar', importedValue: token, rowIndex: row.rowIndex, editedValue: token, mode: 'MANUAL_EDIT' })}
                                            className="text-[9px] px-1.5 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                            title={language === 'ar' ? `تصحيح رقم العربة (${token}) يدوياً - عدد الطوب لا يتأثر` : `Manually correct the car number (${token}) - brick count is unaffected`}
                                          >
                                            <Edit3 className="w-2.5 h-2.5 text-indigo-700" />
                                            <span>{language === 'ar' ? 'تعديل يدوي' : 'Manual Edit'}</span>
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setManualSelectState({ isOpen: true, domain: 'furnaceCar', importedValue: token, rowIndex: row.rowIndex, editedValue: token, mode: 'CHOOSE_EXISTING' })}
                                            className="text-[9px] px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-900 border border-sky-300 rounded font-bold flex items-center gap-0.5 cursor-pointer"
                                            title={language === 'ar' ? `اختيار عربة موجودة لـ (${token})` : `Choose an existing car for (${token})`}
                                          >
                                            <Search className="w-2.5 h-2.5 text-sky-700" />
                                            <span>{language === 'ar' ? `اختيار موجود (${token})` : `Choose Existing (${token})`}</span>
                                          </button>
                                        </>
                                      )}
                                      {canAddMasterData && (
                                        <button
                                          type="button"
                                          onClick={() => handleOpenInlineAdd('furnaceCar', token, row.rowIndex, { carNumber: token, code: token })}
                                          className="text-[9px] px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded font-bold flex items-center gap-0.5 cursor-pointer shadow-xs transition-colors"
                                          title={language === 'ar' ? `إضافة العربة (${token})` : `Add Car (${token})`}
                                        >
                                          <Plus className="w-2.5 h-2.5 text-amber-700" />
                                          <span>{language === 'ar' ? `+ إضافة عربة (${token})` : `+ Add Car (${token})`}</span>
                                        </button>
                                      )}
                                    </React.Fragment>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>

                          {(!row.proposedMatches || row.proposedMatches.length === 0) && row.errors.length === 0 && (
                            <span className="text-slate-400 font-sans text-[10px]">-</span>
                          )}
                        </div>
                      </td>

                      <td className="p-2.5 whitespace-nowrap text-slate-900 font-bold">{row.date || '-'}</td>
                      
                      {/* Worker 1 */}
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-sans font-bold text-slate-900">{row.worker1Name || '-'}</div>
                        <div className="text-[10px] text-slate-500">{language === 'ar' ? 'كود' : 'Code'}: {row.worker1Code || '-'}</div>
                      </td>

                      {/* Worker 2 */}
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="font-sans font-bold text-slate-700">{row.worker2Name || '-'}</div>
                        {row.worker2Code && <div className="text-[10px] text-slate-500">{language === 'ar' ? 'كود' : 'Code'}: {row.worker2Code}</div>}
                      </td>

                      {/* Furnace Cars: العربة | عدد الطوب | الحالة pairs (NOT flat individual tokens) + Original value */}
                      <td className="p-2.5 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-1">
                            {(() => {
                              const pairs = row.furnaceCarBrickPairs || (row.furnaceCarsRaw ? parseFurnaceCarBrickPairs(row.furnaceCarsRaw) : []);
                              if (pairs.length === 0) return <span className="text-slate-400 font-sans text-xs">-</span>;

                              const carOccurrences = new Map<string, number>();
                              pairs.forEach(p => {
                                if (!p.isValid || !p.carNumber) return;
                                const n = p.carNumber.toLowerCase();
                                carOccurrences.set(n, (carOccurrences.get(n) || 0) + 1);
                              });

                              return pairs.map((pair, tIdx) => {
                                if (!pair.isValid) {
                                  return (
                                    <span
                                      key={tIdx}
                                      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border bg-red-50 text-red-800 border-red-300 shadow-2xs"
                                      title={language === 'ar' ? `إدخال غير مكتمل: "${pair.raw}"` : `Incomplete entry: "${pair.raw}"`}
                                    >
                                      {pair.raw || '?'} ⚠ {language === 'ar' ? '(غير مكتمل)' : '(incomplete)'}
                                    </span>
                                  );
                                }
                                const norm = pair.carNumber.toLowerCase();
                                const isDuplicate = (carOccurrences.get(norm) || 0) > 1;
                                const isResolved = row.resolvedFurnaceCars?.some(c =>
                                  (c.code && c.code.toLowerCase() === norm) ||
                                  (c.carNumber && c.carNumber.toLowerCase() === norm)
                                );
                                return (
                                  <span
                                    key={tIdx}
                                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shadow-2xs ${
                                      isDuplicate
                                        ? 'bg-red-50 text-red-800 border-red-300 ring-1 ring-red-300/60'
                                        : isResolved
                                        ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                                        : 'bg-amber-50 text-amber-900 border-amber-300 ring-1 ring-amber-300/60'
                                    }`}
                                    title={
                                      isDuplicate
                                        ? (language === 'ar' ? `العربة ${pair.carNumber} مكررة بأكثر من عدد طوب` : `Furnace Car ${pair.carNumber} appears more than once with different brick counts`)
                                        : isResolved
                                        ? (language === 'ar' ? `تمت مطابقة العربة (${pair.carNumber}) - عدد الطوب: ${pair.brickCount}` : `Matched car (${pair.carNumber}) - Brick Count: ${pair.brickCount}`)
                                        : (language === 'ar' ? `العربة (${pair.carNumber}) غير مسجلة - عدد الطوب: ${pair.brickCount}` : `Unregistered car (${pair.carNumber}) - Brick Count: ${pair.brickCount}`)
                                    }
                                  >
                                    {pair.carNumber} → {pair.brickCount}
                                    {isDuplicate ? ' ⚠' : isResolved ? ' ✓' : ' !'}
                                  </span>
                                );
                              });
                            })()}
                          </div>
                          {/* Original imported string for full auditability if multi */}
                          {row.furnaceCarsRaw && (row.furnaceCarBrickPairs?.length || 0) > 1 && (
                            <span className="text-[9px] text-slate-400 font-mono tracking-tight" title={language === 'ar' ? 'القيمة الأصلية بالملف' : 'Original raw value'}>
                              {language === 'ar' ? 'الأصل:' : 'Raw:'} {row.furnaceCarsRaw}
                            </span>
                          )}
                        </div>
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
                        {row.pieceWeight > 0 ? `${row.pieceWeight} ${language === 'ar' ? 'كجم' : 'kg'}` : '-'}
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
                        <span className="text-slate-900">{row.calculatedTotalFaults} {language === 'ar' ? 'د' : 'm'}</span>
                        {row.excelTotalFaults !== undefined && (
                          <span className={`text-[10px] mr-1 ${row.excelTotalFaults === row.calculatedTotalFaults ? 'text-slate-400' : 'text-amber-700 font-bold'}`}>
                            ({row.excelTotalFaults} {language === 'ar' ? 'د' : 'm'})
                          </span>
                        )}
                      </td>

                      {/* Notes / Issues */}
                      <td className="p-2.5 font-sans">
                        {row.errors.length > 0 ? (
                          <div className="text-red-700 font-bold text-[11px] space-y-0.5">
                            {deriveMissingRequiredFields(row).length > 0 && (
                              <div className="pb-1 mb-1 border-b border-red-200">
                                <span className="text-red-900">{language === 'ar' ? 'السجل غير مكتمل - الحقول المطلوبة الناقصة: ' : 'Incomplete record - required fields missing: '}</span>
                                {deriveMissingRequiredFields(row).map((f) => (language === 'ar' ? f.ar : f.en)).join('، ')}
                              </div>
                            )}
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
                          <span className="text-emerald-700 text-[11px] font-bold">
                            {language === 'ar' ? 'بيانات مطابقة تماماً' : 'Fully Validated'}
                          </span>
                        )}
                      </td>

                      {/* Row Selection Actions (§8-11): Skip / Exclude / Re-include / Edit */}
                      <td className="p-2.5 font-sans">
                        <div className="flex flex-wrap items-center gap-1">
                          {getRowSelection(row) === 'EXCLUDED' ? (
                            <button
                              type="button"
                              onClick={() => handleReincludeRow(row.rowIndex)}
                              className="px-1.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold cursor-pointer"
                              title={language === 'ar' ? 'إعادة إدراج هذا الصف في الاستيراد' : 'Re-include this row for import'}
                            >
                              {language === 'ar' ? 'إعادة إدراج' : 'Re-include'}
                            </button>
                          ) : (
                            <>
                              {row.errors.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleSkipRow(row.rowIndex)}
                                  className="px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded text-[10px] font-bold cursor-pointer"
                                  title={language === 'ar' ? 'تخطي هذا الصف (به خطأ مانع) والاستمرار في استيراد بقية الصفوف' : 'Skip this row (has a blocking error) and continue importing the rest'}
                                >
                                  {language === 'ar' ? 'تخطي السجل' : 'Skip Row'}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleExcludeRow(row.rowIndex)}
                                className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold cursor-pointer"
                                title={language === 'ar' ? 'استبعاد هذا الصف يدوياً من الاستيراد' : 'Manually exclude this row from import'}
                              >
                                {language === 'ar' ? 'استبعاد' : 'Exclude'}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditEntireRow(row.rowIndex)}
                                className="px-1.5 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded text-[10px] font-bold cursor-pointer"
                                title={language === 'ar' ? 'فتح نموذج شامل لتعديل كل حقول هذا السجل' : 'Open a full form to edit every field on this record'}
                              >
                                {language === 'ar' ? 'تعديل السجل بالكامل' : 'Edit Entire Row'}
                              </button>
                            </>
                          )}
                          {needsWarningAcceptance(row) && (
                            <button
                              type="button"
                              onClick={() => setWarningReviewRowIndex(row.rowIndex)}
                              className="px-1.5 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded text-[10px] font-bold cursor-pointer flex items-center gap-0.5"
                              title={language === 'ar' ? 'مراجعة التحذيرات واتخاذ قرار' : 'Review warnings and decide'}
                            >
                              <AlertTriangle className="w-3 h-3" />{language === 'ar' ? 'مراجعة التحذيرات' : 'Review Warnings'}
                            </button>
                          )}
                          {row.rowVersions && row.rowVersions.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setHistoryModalRowIndex(row.rowIndex)}
                              className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold cursor-pointer flex items-center gap-0.5"
                              title={language === 'ar' ? 'عرض سجل التعديلات والتراجع عن تعديل سابق' : 'View edit history and undo a previous edit'}
                            >
                              <History className="w-3 h-3" />{language === 'ar' ? 'السجل' : 'History'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Footer - sticky so it stays reachable without extra page
              scrolling once the table above is viewport-bounded (§3/§4). */}
          {isImporting ? (
            <div className="space-y-3 pt-3 bg-slate-50 p-4 rounded-xl border border-slate-200 sticky bottom-0 z-10">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  <span>
                    {language === 'ar' 
                      ? `جاري استيراد الدفعة ${currentBatchNum} من ${totalBatchCount} إلى قاعدة بيانات الإنتاج (Firestore)...`
                      : `Importing chunk ${currentBatchNum} of ${totalBatchCount} to Firestore...`}
                  </span>
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
            <div className="space-y-4 pt-4 border-t border-slate-100 sticky bottom-0 bg-white z-10">
              {/* Blocking Errors Alert vs Ready Confirmation - Partial Import (§4/§16/§19): a
                  blocking error on some rows never prevents importing the rest, so this is
                  now purely informational, never a hard gate on the button below. */}
              {partialImportSummary.blocking > 0 ? (
                <div className="p-3.5 bg-red-50 border-2 border-red-300 rounded-xl flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div className="flex-1 text-xs">
                    <h4 className="font-black text-red-950">
                      {language === 'ar' ? 'يوجد صفوف بها أخطاء مانعة:' : 'Some rows have blocking errors:'}
                    </h4>
                    <p className="text-red-800 mt-0.5 font-medium">
                      {language === 'ar'
                        ? `يوجد (${partialImportSummary.blocking}) صف به أخطاء مانعة. يمكنك حلها باعتماد مطابقة أو تعديل الصف، أو تخطيها/استبعادها، والاستمرار باستيراد بقية الصفوف الجاهزة (${partialImportSummary.willImport} سجل).`
                        : `There are (${partialImportSummary.blocking}) rows with blocking errors. You can resolve them, skip/exclude them, and still import the rest of the ready rows (${partialImportSummary.willImport} records).`}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div className="text-xs">
                    <span className="font-black text-emerald-950">
                      {language === 'ar' ? 'كافة البيانات جاهزة ومدققة بالكامل:' : 'All Data Fully Validated & Ready:'}
                    </span>{' '}
                    <span className="text-emerald-800 font-medium">
                      {language === 'ar'
                        ? `تم التحقق من كافة الحقول والتطابقات بنجاح. يمكنك الآن اعتماد واستكمال الرفع النهائي (${partialImportSummary.willImport} سجل).`
                        : `All rows and entities are verified. Ready to commit ${partialImportSummary.willImport} records directly to Firestore.`}
                    </span>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-600">
                  <span>{language === 'ar' ? 'سيتم استيراد: ' : 'Will import: '}</span>
                  <strong className="text-emerald-700 font-bold">
                    {partialImportSummary.willImport} {language === 'ar' ? 'سجل (من أصل' : 'records (out of'} {partialImportSummary.total} {language === 'ar' ? ')' : ')'}
                  </strong>
                  {addedMasterDataCount > 0 && (
                    <span className="text-blue-700 font-bold mx-1">
                      {language === 'ar' ? `+ (${addedMasterDataCount}) عنصر بيانات أساسية مضاف` : `+ (${addedMasterDataCount}) new master data`}
                    </span>
                  )}
                  {partialImportSummary.total - partialImportSummary.willImport > 0 && (
                    <span className="text-red-600 font-bold mx-1">
                      {language === 'ar'
                        ? `(لن يتم استيراد ${partialImportSummary.total - partialImportSummary.willImport} سجل: ${partialImportSummary.blocking} مانع، ${partialImportSummary.excluded} مستبعد/متخطى)`
                        : `(${partialImportSummary.total - partialImportSummary.willImport} records will NOT be imported: ${partialImportSummary.blocking} blocking, ${partialImportSummary.excluded} excluded/skipped)`}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleExportErrorReport}
                    disabled={partialImportSummary.total - partialImportSummary.willImport === 0}
                    className="px-3 py-2.5 text-xs font-bold text-amber-700 hover:bg-amber-50 border border-amber-200 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {language === 'ar' ? 'تصدير تقرير الأخطاء/المستبعد' : 'Export Error/Skipped Report'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPressingSummary(null)}
                    className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    {language === 'ar' ? 'إلغاء المعاينة' : 'Cancel'}
                  </button>
                  <button
                    type="button"
                    disabled={partialImportSummary.willImport === 0}
                    onClick={handleStartImport}
                    className="flex items-center gap-2 px-6 py-2.5 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl shadow-md transition-all cursor-pointer"
                    title={partialImportSummary.willImport === 0 ? (language === 'ar' ? 'لا توجد صفوف محددة وجاهزة للاستيراد' : 'No rows are both selected and ready to import') : ''}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {language === 'ar'
                        ? `اعتماد ورفع السجلات المحددة (${partialImportSummary.willImport} سجل)`
                        : `Import Selected Rows (${partialImportSummary.willImport} records)`}
                    </span>
                  </button>
                </div>
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
                <span>{language === 'ar' ? `نتيجة الفحص الأولي لمرحلة ${STAGE_DISPLAY_NAMES[selectedStage]}` : `Pre-validation result for ${STAGE_DISPLAY_NAMES[selectedStage]}`}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {language === 'ar' ? `تم فحص ${genericRawRows.length} صف في الملف المرفوع` : `Validated ${genericRawRows.length} rows`}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'صفوف جاهزة' : 'Valid Rows'}</span>
                <span className="text-base font-black text-emerald-600">{genericValidation.validRows.length}</span>
              </div>
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'محدد' : 'Selected'}</span>
                <span className="text-base font-black text-indigo-700">{genericSelectedRowIndexes.size}</span>
              </div>
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'أخطاء' : 'Errors'}</span>
                <span className="text-base font-black text-red-600">{genericValidation.errors.length}</span>
              </div>
              <div className="text-center">
                <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'سيتم استيراده' : 'Will Import'}</span>
                <span className="text-base font-black text-emerald-900">{genericWillImportCount}</span>
              </div>
            </div>
          </div>

          {/* Bulk Selection Controls (Master Data Consolidation task) - same
              selection semantics as Pressing/Chinese Mills, adapted to this
              screen's simpler validation model (no correction-review
              workflow, so no separate "Corrected"/"Ready" state exists here
              to select). */}
          <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-100">
            <span className="text-[11px] font-bold text-slate-500 ml-1">{language === 'ar' ? 'تحديد جماعي:' : 'Bulk selection:'}</span>
            <button type="button" onClick={() => handleGenericBulkSelection('ALL')} className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 cursor-pointer">
              {language === 'ar' ? 'تحديد الكل' : 'Select All'}
            </button>
            <button type="button" onClick={() => handleGenericBulkSelection('NONE')} className="px-2 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold text-slate-700 cursor-pointer">
              {language === 'ar' ? 'إلغاء تحديد الكل' : 'Deselect All'}
            </button>
            <button type="button" onClick={() => handleGenericBulkSelection('VALID')} className="px-2 py-1 bg-white hover:bg-slate-100 border border-emerald-200 rounded-lg text-[10px] font-bold text-emerald-700 cursor-pointer">
              {language === 'ar' ? 'تحديد الصفوف الصالحة فقط' : 'Select Valid Only'}
            </button>
          </div>

          {/* Required-field errors, blocking those rows from import */}
          {genericValidation.errors.length > 0 && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-1 max-h-48 overflow-y-auto">
              {genericValidation.errors.map((e, idx) => (
                <p key={idx} className="text-[11px] font-bold text-red-800">
                  {language === 'ar' ? `صف ${e.rowIndex}: ${e.message}` : `Row ${e.rowIndex}: ${e.message}`}
                </p>
              ))}
            </div>
          )}

          {/* Missing Master Data - grouped per entityType, each with its own "Add All" bulk-create action (BatchAddMasterDataModal) */}
          {genericValidation.missingMasterData.length > 0 && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
              <h3 className="text-xs font-black text-amber-900 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                {language === 'ar' ? 'بيانات أساسية مفقودة' : 'Missing Master Data'}
              </h3>
              {Array.from(new Set(genericValidation.missingMasterData.map((m) => m.entityType))).map((entityType) => {
                const items = genericValidation.missingMasterData.filter((m) => m.entityType === entityType);
                return (
                  <div key={entityType} className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-lg border border-amber-200">
                    <div className="text-[11px] font-bold text-slate-700">
                      <span>{items[0].type}</span>
                      <span className="text-slate-400 mx-1">·</span>
                      <span className="text-slate-500">{items.map((i) => i.name).join('، ')}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openGenericBulkAdd(entityType)}
                      className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 px-2.5 py-1.5 rounded-lg cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {language === 'ar' ? `إضافة الكل (${items.length})` : `Add All (${items.length})`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Action */}
          {isImporting ? (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>{language === 'ar' ? 'جاري إرسال السجلات إلى Firestore...' : 'Writing batch to Firestore...'}</span>
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
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 sticky bottom-0 bg-white z-10">
              <button
                type="button"
                onClick={() => setGenericValidation(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={genericWillImportCount === 0}
                onClick={handleStartImport}
                className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  {language === 'ar' ? `تنفيذ الاستيراد (${genericWillImportCount} سجل)` : `Execute Import (${genericWillImportCount} records)`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {/* Post-Import Audit Summary */}
      {importResult && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center space-y-4 animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-xs">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-black text-emerald-950">
              {language === 'ar' 
                ? `تم الانتهاء من عملية الاستيراد التاريخي لمرحلة (${STAGE_DISPLAY_NAMES[selectedStage]}) بنجاح!`
                : `Historical import completed for (${STAGE_DISPLAY_NAMES[selectedStage]})!`}
            </h2>
            <p className="text-xs text-emerald-800 font-mono mt-1">
              {language === 'ar' ? 'رقم العملية الموثقة' : 'Import Batch ID'}: {importResult.importId} {backupId ? `| ${language === 'ar' ? 'النسخة الوقائية' : 'Backup ID'}: ${backupId}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs font-bold text-emerald-900 bg-white/70 p-4 rounded-xl border border-emerald-200 max-w-xl mx-auto">
            <div>
              <span className="text-slate-500 block text-[11px]">{language === 'ar' ? 'إجمالي السجلات' : 'Total'}</span>
              <span className="text-base font-black text-slate-800">{importResult.total}</span>
            </div>
            <div>
              <span className="text-emerald-700 block text-[11px]">{language === 'ar' ? 'تم استيرادها بنجاح' : 'Imported'}</span>
              <span className="text-base font-black text-emerald-600">{importResult.imported}</span>
            </div>
            <div>
              <span className="text-amber-700 block text-[11px]">{language === 'ar' ? 'تم تخطيها' : 'Skipped'}</span>
              <span className="text-base font-black text-amber-600">{importResult.skipped}</span>
            </div>
            {importResult.failed > 0 && (
              <div>
                <span className="text-red-700 block text-[11px]">{language === 'ar' ? 'فشلت' : 'Failed'}</span>
                <span className="text-base font-black text-red-600">{importResult.failed}</span>
              </div>
            )}
          </div>

          <p className="text-[11px] text-emerald-700 font-sans">
            {language === 'ar' 
              ? 'السجلات المستوردة متاحة الآن فورياً في سجلات الإنتاج، لوحة المتابعة، التقارير التحليلية، ومساعد الذكاء الاصطناعي.'
              : 'Imported records are immediately available in Dashboard, Production Logs, Reports, and AI.'}
          </p>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: Historical Import Audit History & Rollback                         */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        title={language === 'ar' ? 'سجل عمليات الاستيراد التاريخي والتراجع' : 'Import Audit Trail & Rollback (Undo)'}
        subtitle={language === 'ar' ? 'توثيق كافة دفعات الاستيراد السابقة مع إمكانية التراجع الآمن عن أي دفعة' : 'Complete audit of previous imports with safe batch rollback'}
        maxWidth="2xl"
      >
        <div className="space-y-4 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
          {rollbackSuccessMsg && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center gap-2 font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{rollbackSuccessMsg}</span>
            </div>
          )}

          {isLoadingHistory ? (
            <div className="p-8 text-center text-slate-500 flex flex-col items-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span>{language === 'ar' ? 'جاري تحميل سجلات الاستيراد...' : 'Loading import history...'}</span>
            </div>
          ) : importHistory.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500">
              <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="font-bold">{language === 'ar' ? 'لا توجد عمليات استيراد سابقة مسجلة حتى الآن.' : 'No historical import operations recorded yet.'}</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto rounded-xl border border-slate-200">
              {importHistory.map((entry) => (
                <div key={entry.importBatchId} className="p-3.5 hover:bg-slate-50 flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 font-mono text-[11px]">{entry.importBatchId}</span>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-bold">
                        {STAGE_DISPLAY_NAMES[entry.stage as ProductionStageType] || entry.stage}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-3">
                      <span>الملف: <strong className="text-slate-700">{entry.fileName}</strong></span>
                      <span>بواسطة: <strong className="text-slate-700">{entry.performedByName || entry.performedBy}</strong></span>
                      <span>التاريخ: <strong className="text-slate-700">{entry.performedAt ? formatDateTime(entry.performedAt) : '-'}</strong></span>
                    </div>
                    <div className="text-[10px] text-emerald-700 font-bold">
                      تم استيراد {entry.importedCount} سجل | {entry.approvedMappingsCount || 0} مطابقة ذكية معتمدة
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setRollbackTargetBatch(entry)}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{language === 'ar' ? 'تراجع عن الدفعة' : 'Rollback'}</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsHistoryModalOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              {language === 'ar' ? 'إغلاق' : 'Close'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: Confirm Rollback Batch                                             */}
      {/* ========================================================================= */}
      <Modal
        isOpen={!!rollbackTargetBatch}
        onClose={() => setRollbackTargetBatch(null)}
        title={language === 'ar' ? 'تأكيد التراجع عن دفعة الاستيراد (Rollback Import)' : 'Confirm Batch Rollback'}
        subtitle={rollbackTargetBatch ? `${language === 'ar' ? 'الدفعة' : 'Batch'}: ${rollbackTargetBatch.importBatchId}` : ''}
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
          <p className="text-slate-700 leading-relaxed">
            {language === 'ar'
              ? `هل أنت متأكد من رغبتك في التراجع عن استيراد ملف (${rollbackTargetBatch?.fileName})؟ سيتم حذف جميع السجلات (${rollbackTargetBatch?.importedCount} سجل) التي أُنشئت في هذه الدفعة من قاعدة البيانات نهائياً.`
              : `Are you sure you want to rollback batch ${rollbackTargetBatch?.importBatchId}? All ${rollbackTargetBatch?.importedCount} imported records will be safely removed.`}
          </p>

          <div className="p-3 bg-rose-50 rounded-xl border border-rose-200 text-rose-800 text-[11px] font-bold">
            {language === 'ar' 
              ? 'تنبيه: لا يمكن التراجع عن عملية الحذف هذه، لكن سيتم توثيق إجراء التراجع في سجل المراجعة (Audit Log).'
              : 'This action is irreversible and will be logged in the audit trail.'}
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setRollbackTargetBatch(null)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              disabled={isRollingBack}
              onClick={handleConfirmRollback}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isRollingBack ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{language === 'ar' ? 'جاري الحذف والتراجع...' : 'Rolling back...'}</span>
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>{language === 'ar' ? 'تأكيد التراجع والحذف' : 'Confirm Rollback'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>
      {/* ========================================================================= */}
      {/* MODAL: Inline Master Data Quick Add                                       */}
      {/* ========================================================================= */}
      <InlineMasterDataAddModal
        isOpen={inlineAddModalState.isOpen}
        onClose={() => setInlineAddModalState(prev => ({ ...prev, isOpen: false }))}
        onSuccess={handleMasterDataCreated}
        domain={inlineAddModalState.domain}
        importedValue={inlineAddModalState.importedValue}
        extraContext={inlineAddModalState.extraContext}
        existingItems={existingMasterDataList}
      />

      {/* ========================================================================= */}
      {/* MODAL: Manual Edit / Choose Existing Master Data (fuzzy suggestion is      */}
      {/* never final - the user can override it, correct the text, select an       */}
      {/* existing record, or add a new one)                                        */}
      {/* ========================================================================= */}
      {manualSelectState?.isOpen && (() => {
        const state = manualSelectState;
        const editedTrimmed = state.editedValue.trim();
        const wasEdited = editedTrimmed.length > 0 && editedTrimmed.toLowerCase() !== state.importedValue.trim().toLowerCase();
        // Soft duplicate hint only - the actual hard duplicate check/block
        // happens inside InlineMasterDataAddModal / createMasterDataItem when
        // "Add as New" is actually submitted.
        const possibleDuplicate = (masterDataByDomain[state.domain] || []).find((it: any) => {
          const eName = normalizeArabicForComparison(it.name || it.carNumber || '');
          const eCode = normalizeCodeForComparison(it.code || it.carNumber || '');
          const qName = normalizeArabicForComparison(editedTrimmed);
          const qCode = normalizeCodeForComparison(editedTrimmed);
          return (eName && eName === qName) || (eCode && eCode === qCode);
        });

        const handleAddAsNew = () => {
          const row = pressingSummary?.rows.find((r) => r.rowIndex === state.rowIndex);
          let extraContext: any = undefined;
          if (state.domain === 'employee') extraContext = { suggestedCode: row?.worker1Code };
          else if (state.domain === 'product') extraContext = { code: row?.productCodeRaw, pieceWeight: row?.pieceWeight, aluminaPercentage: row?.aluminaPercentage };
          else if (state.domain === 'furnaceCar') extraContext = { carNumber: editedTrimmed, code: editedTrimmed };

          setManualSelectState(null);
          // importedValue pre-fills the Add form with the CORRECTED text;
          // matchValue keeps propagation keyed on the ORIGINAL row value, so
          // other rows still containing the original wrong text also resolve.
          handleOpenInlineAdd(state.domain, editedTrimmed, state.rowIndex, extraContext, state.importedValue);
        };

        return (
          <Modal
            isOpen={state.isOpen}
            onClose={() => setManualSelectState(null)}
            title={
              state.mode === 'MANUAL_EDIT'
                ? (language === 'ar' ? `تعديل يدوي: ${DOMAIN_BULK_LABELS[state.domain]?.ar}` : `Manual Edit: ${DOMAIN_BULK_LABELS[state.domain]?.en}`)
                : (language === 'ar' ? `اختيار بيان أساسي موجود: ${DOMAIN_BULK_LABELS[state.domain]?.ar}` : `Choose Existing: ${DOMAIN_BULK_LABELS[state.domain]?.en}`)
            }
            subtitle={language === 'ar' ? `القيمة الأصلية المستوردة: "${state.importedValue}"` : `Original imported value: "${state.importedValue}"`}
            maxWidth="md"
          >
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  {language === 'ar' ? 'القيمة المصححة (يمكن تعديلها):' : 'Corrected value (editable):'}
                </label>
                <input
                  type="text"
                  value={state.editedValue}
                  onChange={(e) => setManualSelectState({ ...state, editedValue: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                  autoFocus={state.mode === 'MANUAL_EDIT'}
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  {language === 'ar'
                    ? 'القيمة الأصلية المستوردة من الملف تبقى محفوظة دائماً للتدقيق، بغض النظر عن أي تصحيح هنا.'
                    : 'The original value imported from the file is always preserved for audit, regardless of any correction here.'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">
                  {language === 'ar' ? 'ابحث واختر من البيانات الأساسية الموجودة:' : 'Search and select from existing master data:'}
                </label>
                <SearchableCombobox
                  placeholder={language === 'ar' ? 'اكتب للبحث بالاسم أو الكود...' : 'Type to search by name or code...'}
                  value={null}
                  options={(masterDataByDomain[state.domain] || []).map((it: any): ComboboxOption => ({
                    id: it.id,
                    code: it.code || it.carNumber || '',
                    name: it.name || it.carNumber || it.code || '',
                    subtitle: it.carNumber && it.code && it.carNumber !== it.code ? it.carNumber : undefined,
                    rawItem: it,
                  }))}
                  onChange={(_selectedId, option) => {
                    if (!option) return;
                    handleManualSelectConfirm({ id: option.id, code: option.code, name: option.name });
                  }}
                />
              </div>

              {possibleDuplicate && (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-800">
                  {language === 'ar'
                    ? `هذا البيان موجود بالفعل: "${possibleDuplicate.name || possibleDuplicate.carNumber}" (${possibleDuplicate.code || possibleDuplicate.carNumber}). يفضّل اختياره من قائمة البحث أعلاه بدلاً من الإضافة.`
                    : `This record already exists: "${possibleDuplicate.name || possibleDuplicate.carNumber}" (${possibleDuplicate.code || possibleDuplicate.carNumber}). Prefer selecting it from the search list above instead of adding.`}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                {canAddMasterData && (
                  <button
                    type="button"
                    onClick={handleAddAsNew}
                    disabled={!editedTrimmed}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white text-xs font-bold rounded-lg cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{language === 'ar' ? 'إضافة كبيان جديد' : 'Add as New Master Data'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setManualSelectState(null)}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
              </div>

              <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-2">
                {language === 'ar'
                  ? 'سيتم تطبيق هذا القرار تلقائياً على كل القيم المطابقة (بعد التطبيع القياسي) لنفس نوع البيان في الملف الحالي - القيمة الأصلية المستوردة، وليست القيمة المصححة، هي أساس المطابقة مع الصفوف الأخرى.'
                  : "This decision will automatically apply to every equivalent (canonically normalized) value of the same entity type in the current file - the ORIGINAL imported value, not the corrected text, is what other rows are matched against."}
              </p>
            </div>
          </Modal>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL: Entity-Specific Bulk Add Master Data (Part 1)                      */}
      {/* ========================================================================= */}
      {bulkAddDomain && (
        <BatchAddMasterDataModal
          isOpen={!!bulkAddDomain}
          onClose={() => setBulkAddDomain(null)}
          items={missingEntitiesForBatchAdd.filter((i) => i.domain === bulkAddDomain)}
          existingItemsForDomain={masterDataByDomain[bulkAddDomain]}
          entityLabelAr={DOMAIN_BULK_LABELS[bulkAddDomain].ar}
          entityLabelEn={DOMAIN_BULK_LABELS[bulkAddDomain].en}
          onBatchCreated={handleBatchMasterDataCreated}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL: Generic-stage "Add All Master Data" (7 non-pressing stages)        */}
      {/* ========================================================================= */}
      {genericBulkAddEntityType && (
        <BatchAddMasterDataModal
          isOpen={!!genericBulkAddEntityType}
          onClose={() => setGenericBulkAddEntityType(null)}
          items={genericMissingEntitiesForBatchAdd.filter((i) => i.domain === genericBulkAddEntityType)}
          existingItemsForDomain={genericMasterDataByType[genericBulkAddEntityType]}
          onBatchCreated={handleGenericBatchMasterDataCreated}
        />
      )}

      {/* ========================================================================= */}
      {/* MODAL: Edit Entire Row (§1-7) - EVERY importable field for this row       */}
      {/* ========================================================================= */}
      {editRowState?.isOpen && editRowDraft && (() => {
        const editedRow = pressingSummary?.rows.find((r) => r.rowIndex === editRowState.rowIndex);
        const missingFields = editedRow ? deriveMissingRequiredFields(editedRow) : [];
        const employeeOptions: ComboboxOption[] = (masterDataByDomain.employee || []).map((e: any) => ({ id: e.id, code: e.code, name: e.name, iconType: 'employee' }));
        const pressOptions: ComboboxOption[] = (masterDataByDomain.press || []).map((p: any) => ({ id: p.id, code: p.code, name: p.name, iconType: 'press' }));
        const productOptions: ComboboxOption[] = (masterDataByDomain.product || []).map((p: any) => ({ id: p.id, code: p.code, name: p.name, iconType: 'product' }));
        const furnaceCarOptions: ComboboxOption[] = (masterDataByDomain.furnaceCar || [])
          .filter((c: any) => !editRowDraft.furnaceCarEntries.some((e) => e.carId === c.id))
          .map((c: any) => ({ id: c.id, code: c.code, name: c.carNumber || c.code, iconType: 'car' }));

        return (
        <Modal
          isOpen={editRowState.isOpen}
          onClose={() => { setEditRowState(null); setEditRowDraft(null); }}
          title={language === 'ar' ? `تعديل السجل بالكامل - الصف رقم ${editRowState.rowIndex}` : `Edit Entire Row - #${editRowState.rowIndex}`}
          subtitle={language === 'ar' ? 'كل الحقول القابلة للاستيراد لهذا السجل في شاشة واحدة.' : 'Every importable field for this record, in one screen.'}
          maxWidth="4xl"
        >
          <div className="space-y-4">
            {/* Structured "what's missing" (§8-10) - not the old generic message */}
            {missingFields.length > 0 && (
              <div className="p-3 bg-red-50 border border-red-300 rounded-xl text-xs">
                <p className="font-black text-red-950 mb-1">{language === 'ar' ? 'السجل غير مكتمل. الحقول المطلوبة الناقصة أو غير الصالحة:' : 'Incomplete record. Required fields missing or invalid:'}</p>
                <ul className="list-disc pr-5 text-red-800 font-bold space-y-0.5">
                  {missingFields.map((f) => (
                    <li key={f.ar}>{language === 'ar' ? f.ar : f.en}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Original vs Current Edited Version (§4) */}
            {editedRow && (
              <details className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                <summary className="font-bold text-slate-700 cursor-pointer">{language === 'ar' ? 'عرض البيانات الأصلية من الملف مقابل آخر نسخة معدّلة' : 'Show original file data vs last edited version'}</summary>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <span className="block font-bold text-slate-500 mb-1">{language === 'ar' ? 'الأصلي (من الملف):' : 'Original (from file):'}</span>
                    <pre className="whitespace-pre-wrap break-all bg-white border border-slate-200 rounded-lg p-2 text-[10px] font-mono max-h-32 overflow-y-auto">{JSON.stringify(editedRow.raw, null, 1)}</pre>
                  </div>
                  <div>
                    <span className="block font-bold text-slate-500 mb-1">{language === 'ar' ? 'النسخة الحالية المعدّلة:' : 'Current edited version:'}</span>
                    <pre className="whitespace-pre-wrap break-all bg-white border border-slate-200 rounded-lg p-2 text-[10px] font-mono max-h-32 overflow-y-auto">{editedRow.editedRowData ? JSON.stringify(editedRow.editedRowData, null, 1) : (language === 'ar' ? 'لم يتم تعديل السجل بعد.' : 'Not edited yet.')}</pre>
                  </div>
                </div>
              </details>
            )}

            {/* Relational fields - reuse the same master-data lists and combobox */}
            {/* component already used for field-level Manual Edit / Choose Existing. */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{language === 'ar' ? 'التاريخ *' : 'Date *'}</label>
                <input
                  type="date"
                  value={editRowDraft.date}
                  onChange={(e) => setEditRowDraft({ ...editRowDraft, date: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{language === 'ar' ? 'الوردية *' : 'Shift *'}</label>
                <div className="flex items-center gap-3 h-[38px]">
                  {(['1', '2', '3'] as const).map((s) => (
                    <label key={s} className="flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                      <input type="radio" name="edit-row-shift" checked={editRowDraft.shift === s} onChange={() => setEditRowDraft({ ...editRowDraft, shift: s })} />
                      {buildShiftDisplayName(Number(s) as 1 | 2 | 3, language)}
                    </label>
                  ))}
                </div>
              </div>

              <SearchableCombobox
                label={language === 'ar' ? 'عامل 1 *' : 'Worker 1 *'}
                options={employeeOptions}
                value={editRowDraft.worker1Id}
                onChange={(id) => setEditRowDraft({ ...editRowDraft, worker1Id: id })}
              />
              <SearchableCombobox
                label={language === 'ar' ? 'عامل 2 (اختياري)' : 'Worker 2 (optional)'}
                options={employeeOptions}
                value={editRowDraft.worker2Id}
                onChange={(id) => setEditRowDraft({ ...editRowDraft, worker2Id: id })}
              />
              <SearchableCombobox
                label={language === 'ar' ? 'المكبس *' : 'Press *'}
                options={pressOptions}
                value={editRowDraft.pressId}
                onChange={(id) => setEditRowDraft({ ...editRowDraft, pressId: id })}
              />
              <SearchableCombobox
                label={language === 'ar' ? 'الصنف *' : 'Product *'}
                options={productOptions}
                value={editRowDraft.productId}
                onChange={(id, opt) => setEditRowDraft({
                  ...editRowDraft,
                  productId: id,
                  productCode: opt?.code || editRowDraft.productCode,
                  productName: opt?.name || editRowDraft.productName,
                })}
              />

              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{language === 'ar' ? 'طلب العميل' : 'Customer Order'}</label>
                <input
                  type="text"
                  value={editRowDraft.customerOrder}
                  onChange={(e) => setEditRowDraft({ ...editRowDraft, customerOrder: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{language === 'ar' ? 'الألومينا %' : 'Alumina %'}</label>
                <input
                  type="number"
                  value={editRowDraft.aluminaPercentage}
                  onChange={(e) => setEditRowDraft({ ...editRowDraft, aluminaPercentage: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{language === 'ar' ? 'وزن القطعة' : 'Piece Weight'}</label>
                <input
                  type="number"
                  value={editRowDraft.pieceWeight}
                  onChange={(e) => setEditRowDraft({ ...editRowDraft, pieceWeight: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{language === 'ar' ? 'كمية الإنتاج *' : 'Production Quantity *'}</label>
                <input
                  type="number"
                  value={editRowDraft.productionQuantity}
                  onChange={(e) => setEditRowDraft({ ...editRowDraft, productionQuantity: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">{language === 'ar' ? 'كمية الهالك *' : 'Waste Quantity *'}</label>
                <input
                  type="number"
                  value={editRowDraft.wasteQuantity}
                  onChange={(e) => setEditRowDraft({ ...editRowDraft, wasteQuantity: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Furnace Cars + Brick Count per car (optional as a whole; each added
                entry must resolve and carry a valid brick count) */}
            <div className="pt-2 border-t border-slate-100">
              <SearchableCombobox
                label={language === 'ar' ? 'إضافة عربة فرن (اختياري)' : 'Add a Furnace Car (optional)'}
                options={furnaceCarOptions}
                value={null}
                onChange={(id) => handleAddFurnaceCarToEdit(id)}
              />
              {editRowDraft.furnaceCarEntries.length > 0 && (
                <div className="mt-2 space-y-1.5">
                  {editRowDraft.furnaceCarEntries.map((entry) => {
                    const car = (masterDataByDomain.furnaceCar || []).find((c: any) => c.id === entry.carId);
                    return (
                      <div key={entry.carId} className="flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-lg">
                        <span className="text-xs font-bold text-slate-700 min-w-[80px]">{language === 'ar' ? 'عربة' : 'Car'} {car?.carNumber || car?.code || entry.carId}</span>
                        <input
                          type="number"
                          placeholder={language === 'ar' ? 'عدد الطوب' : 'Brick count'}
                          value={entry.brickCount}
                          onChange={(e) => handleFurnaceCarBrickCountChangeInEdit(entry.carId, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
                          className="flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveFurnaceCarFromEdit(entry.carId)}
                          className="px-2 py-1 text-[10px] font-bold text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                        >
                          {language === 'ar' ? 'إزالة' : 'Remove'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100">
              <span className="block text-xs font-bold text-slate-600 mb-1.5">{language === 'ar' ? 'الأعطال (بالدقائق)' : 'Faults (minutes)'}</span>
              <div className="grid grid-cols-5 gap-2">
                {([
                  ['mechanicalFaults', language === 'ar' ? 'ميكانيكا' : 'Mech.'],
                  ['electricalFaults', language === 'ar' ? 'كهرباء' : 'Elec.'],
                  ['workshopFaults', language === 'ar' ? 'ورشة' : 'Workshop'],
                  ['rawMaterialFaults', language === 'ar' ? 'خامات' : 'Raw Mat.'],
                  ['otherFaults', language === 'ar' ? 'أخرى' : 'Other'],
                ] as const).map(([key, label]) => (
                  <div key={key}>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1">{label}</label>
                    <input
                      type="number"
                      value={editRowDraft[key]}
                      onChange={(e) => setEditRowDraft({ ...editRowDraft, [key]: e.target.value })}
                      className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            {editRowState.queue.length > 0 && (
              <p className="text-[11px] text-indigo-700 font-bold">
                {language === 'ar' ? `سيتم فتح ${editRowState.queue.length} صف آخر بعد الحفظ (تعديل جماعي للصفوف المحددة).` : `${editRowState.queue.length} more selected row(s) will open after saving (bulk edit).`}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => { setEditRowState(null); setEditRowDraft(null); }}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleSaveRowEdit}
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg cursor-pointer"
              >
                {language === 'ar' ? 'حفظ التعديلات' : 'Save Changes'}
              </button>
            </div>
          </div>
        </Modal>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL: Final Import Confirmation - shows exact counts before writing      */}
      {/* ========================================================================= */}
      {showFinalImportConfirm && pressingSummary && (() => {
        const willImport = partialImportSummary.willImport;
        const willSkip = partialImportSummary.total - willImport;
        return (
          <Modal
            isOpen={showFinalImportConfirm}
            onClose={() => setShowFinalImportConfirm(false)}
            title={language === 'ar' ? 'تأكيد الاستيراد الجزئي' : 'Confirm Partial Import'}
            maxWidth="md"
          >
            <div className="space-y-3">
              <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-sm font-bold text-amber-950">
                  {language === 'ar'
                    ? `سيتم رفع ${willImport} سجل فقط. سيتم ترك ${willSkip} سجل دون تسجيل. هل تريد المتابعة؟`
                    : `Only ${willImport} records will be imported. ${willSkip} records will remain unimported. Continue?`}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                  <span className="block font-bold text-emerald-700">{language === 'ar' ? 'سيتم استيراده' : 'Will Import'}</span>
                  <span className="text-base font-black text-emerald-900">{willImport}</span>
                </div>
                <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-center">
                  <span className="block font-bold text-red-700">{language === 'ar' ? 'لن يتم استيراده' : 'Will NOT Import'}</span>
                  <span className="text-base font-black text-red-900">{willSkip}</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowFinalImportConfirm(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
                >
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={isImporting}
                  onClick={handleConfirmFinalImport}
                  className="px-4 py-2 text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{language === 'ar' ? 'تأكيد ورفع السجلات المحددة' : 'Confirm & Import Selected'}</span>
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL: Delete Excluded Row(s) Permanently (§14/§15) - session-only,        */}
      {/* never touches Firestore/Master Data/the original Excel file.               */}
      {/* ========================================================================= */}
      {deleteConfirmState && (
        <Modal
          isOpen={!!deleteConfirmState}
          onClose={() => setDeleteConfirmState(null)}
          title={language === 'ar' ? 'حذف نهائي من جلسة الاستيراد' : 'Permanently Delete From Import Session'}
          maxWidth="md"
        >
          <div className="space-y-3">
            <div className="p-3.5 bg-red-50 border-2 border-red-300 rounded-xl flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm font-bold text-red-950">
                {language === 'ar'
                  ? 'سيتم حذف السجل من جلسة الاستيراد الحالية نهائيًا. لن يتم رفعه. هل تريد المتابعة؟'
                  : 'This record will be permanently removed from the current import session and will not be imported. Continue?'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-center">
                <span className="block font-bold text-slate-600">{language === 'ar' ? 'محدد' : 'Selected'}</span>
                <span className="text-base font-black text-slate-900">{deleteConfirmState.rowIndexes.length}</span>
              </div>
              <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-center">
                <span className="block font-bold text-red-700">{language === 'ar' ? 'صفوف سيتم حذفها' : 'Rows to delete'}</span>
                <span className="text-base font-black text-red-900">{deleteConfirmState.rowIndexes.length}</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              {language === 'ar'
                ? 'هذا الحذف يخص جلسة الاستيراد الحالية فقط - لن يتأثر الملف الأصلي أو قاعدة بيانات Firestore أو أي استيراد سابق.'
                : 'This deletion affects only the current import session - the original file, Firestore, and any previously completed import remain unchanged.'}
            </p>
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeleteConfirmState(null)}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => handleDeleteRowsPermanently(deleteConfirmState.rowIndexes)}
                className="px-4 py-2 text-xs font-black text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
              >
                {language === 'ar' ? 'حذف نهائي' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL: Version / Edit History (§11-16) - View / Compare / Revert          */}
      {/* ========================================================================= */}
      {historyModalRowIndex !== null && pressingSummary && (() => {
        const row = pressingSummary.rows.find((r) => r.rowIndex === historyModalRowIndex);
        if (!row) return null;
        const versions = row.rowVersions || [];
        const lastEditId = versions.length > 0 ? versions[versions.length - 1].editId : null;

        const formatFieldValue = (value: any): string => {
          if (value === null || value === undefined || value === '') return '—';
          if (Array.isArray(value)) return value.length === 0 ? '—' : value.map((v) => (typeof v === 'object' && v ? (v.carNumber || v.name || v.code || JSON.stringify(v)) : String(v))).join(', ');
          if (typeof value === 'object') return value.name || value.code || JSON.stringify(value);
          return String(value);
        };

        return (
          <Modal
            isOpen={true}
            onClose={() => { setHistoryModalRowIndex(null); setExpandedVersionId(null); }}
            title={language === 'ar' ? `سجل التعديلات - الصف رقم ${historyModalRowIndex}` : `Edit History - Row #${historyModalRowIndex}`}
            subtitle={language === 'ar' ? 'كل تعديل يدوي محفوظ كنسخة كاملة، ويمكن التراجع إلى أي نسخة سابقة دون فقدان النسخ الأحدث.' : 'Every manual edit is stored as a full version - you can revert to any earlier version without losing the newer ones.'}
            maxWidth="4xl"
          >
            <div className="space-y-3">
              {row.originalExclusionReason && (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs">
                  <span className="font-black text-red-900">{language === 'ar' ? 'سبب الاستبعاد الأصلي: ' : 'Original Exclusion Reason: '}</span>
                  <span className="text-red-800 font-sans">{row.originalExclusionReason}</span>
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-64">
                <table className="w-full text-right text-[11px]">
                  <thead className="bg-slate-50 text-slate-700 font-black sticky top-0 z-10 border-b border-slate-200">
                    <tr>
                      <th className="p-2">{language === 'ar' ? 'نسخة' : 'Version'}</th>
                      <th className="p-2">{language === 'ar' ? 'التاريخ' : 'Date'}</th>
                      <th className="p-2">{language === 'ar' ? 'المستخدم' : 'User'}</th>
                      <th className="p-2">{language === 'ar' ? 'التغييرات' : 'Changes'}</th>
                      <th className="p-2">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                      <th className="p-2">{language === 'ar' ? 'إجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-sans">
                    {versions.map((v, idx) => (
                      <tr key={v.editId} className={expandedVersionId === v.editId ? 'bg-indigo-50/50' : ''}>
                        <td className="p-2 font-bold text-slate-500 font-mono">{idx + 1}</td>
                        <td className="p-2">{formatDateTime(v.timestamp)}</td>
                        <td className="p-2">{v.userId}</td>
                        <td className="p-2 max-w-[220px] truncate" title={v.reason}>
                          {v.changedFields.length > 0
                            ? v.changedFields.map((c) => DISPLAY_FIELD_LABELS[c.fieldName]?.[language] || c.fieldName).join('، ')
                            : (language === 'ar' ? 'النسخة الأصلية' : 'Original')}
                        </td>
                        <td className="p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${v.validationAfter.errorCount === 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                            {v.validationAfter.errorCount === 0 ? (language === 'ar' ? 'جاهز' : 'Ready') : (language === 'ar' ? 'مانع' : 'Blocking')}
                          </span>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setExpandedVersionId(expandedVersionId === v.editId ? null : v.editId)}
                              className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold cursor-pointer"
                            >
                              {expandedVersionId === v.editId ? (language === 'ar' ? 'إخفاء' : 'Hide') : (language === 'ar' ? 'مقارنة' : 'Compare')}
                            </button>
                            {v.editId !== lastEditId && (
                              <button
                                type="button"
                                onClick={() => setRevertConfirmState({ rowIndex: historyModalRowIndex!, editId: v.editId })}
                                className="px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded text-[10px] font-bold cursor-pointer flex items-center gap-0.5"
                              >
                                <RotateCcw className="w-3 h-3" />{language === 'ar' ? 'تراجع' : 'Revert'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Before / After Comparison (§15) */}
              {expandedVersionId && (() => {
                const v = versions.find((vv) => vv.editId === expandedVersionId);
                if (!v) return null;
                return (
                  <div className="p-3 bg-indigo-50/50 border border-indigo-200 rounded-xl">
                    <h5 className="text-xs font-black text-indigo-950 mb-2">{language === 'ar' ? 'مقارنة قبل / بعد' : 'Before / After Comparison'}</h5>
                    {v.changedFields.length === 0 ? (
                      <p className="text-[11px] text-slate-500 font-sans">{language === 'ar' ? 'هذه هي النسخة الأصلية - لا يوجد تغيير للمقارنة.' : 'This is the original version - nothing to compare.'}</p>
                    ) : (
                      <div className="space-y-1.5">
                        {v.changedFields.map((c) => (
                          <div key={c.fieldName} className="grid grid-cols-3 gap-2 p-2 bg-white rounded-lg border border-indigo-100 text-[11px] font-sans">
                            <span className="font-bold text-slate-700">{DISPLAY_FIELD_LABELS[c.fieldName]?.[language] || c.fieldName}</span>
                            <span className="text-red-600"><span className="text-slate-400">{language === 'ar' ? 'قبل: ' : 'Before: '}</span>{formatFieldValue(c.oldValue)}</span>
                            <span className="text-emerald-700"><span className="text-slate-400">{language === 'ar' ? 'بعد: ' : 'After: '}</span>{formatFieldValue(c.newValue)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </Modal>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL: Confirm Revert (§16)                                                */}
      {/* ========================================================================= */}
      {revertConfirmState && (
        <Modal
          isOpen={true}
          onClose={() => setRevertConfirmState(null)}
          title={language === 'ar' ? 'تأكيد التراجع' : 'Confirm Revert'}
          maxWidth="sm"
        >
          <div className="space-y-3">
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm font-bold text-amber-950">
                {language === 'ar'
                  ? 'سيتم الرجوع إلى الإصدار المحدد من السجل. هل تريد المتابعة؟'
                  : 'This will restore the selected previous version of the record. Continue?'}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setRevertConfirmState(null)} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleRevertToVersion(revertConfirmState.rowIndex, revertConfirmState.editId);
                  setRevertConfirmState(null);
                  setExpandedVersionId(null);
                }}
                className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{language === 'ar' ? 'تراجع عن التعديل' : 'Undo Edit'}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL: Confirm Bulk Repair (§23)                                           */}
      {/* ========================================================================= */}
      {bulkRepairConfirm && (
        <Modal
          isOpen={true}
          onClose={() => setBulkRepairConfirm(false)}
          title={language === 'ar' ? 'تأكيد التصحيح الجماعي' : 'Confirm Bulk Repair'}
          maxWidth="sm"
        >
          <div className="space-y-3">
            <div className="p-3 bg-purple-50 border border-purple-300 rounded-xl">
              <p className="text-sm font-bold text-purple-950">
                {selectedExcludedRowIndices.size} {language === 'ar' ? 'صف محدد سيتم تصحيحهم ثم إعادة فحصهم.' : 'selected rows will be corrected, then revalidated.'}
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setBulkRepairConfirm(false)} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const idOnly = bulkRepairField === 'shift' ? {} : { id: bulkRepairValue };
                  const shiftOnly = bulkRepairField === 'shift' ? { shiftValue: bulkRepairValue as '1' | '2' | '3' } : {};
                  handleBulkRepair(Array.from(selectedExcludedRowIndices), bulkRepairField, { ...idOnly, ...shiftOnly });
                  setBulkRepairConfirm(false);
                  setShowBulkRepairPanel(false);
                  setBulkRepairValue('');
                }}
                className="px-4 py-2 text-xs font-black text-white bg-purple-600 hover:bg-purple-700 rounded-lg cursor-pointer"
              >
                {language === 'ar' ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ========================================================================= */}
      {/* MODAL: Review Warnings - "Edit Data" vs "Save Despite Warning" (§3/§7/§14) */}
      {/* ========================================================================= */}
      {warningReviewRowIndex !== null && pressingSummary && (() => {
        const row = pressingSummary.rows.find((r) => r.rowIndex === warningReviewRowIndex);
        if (!row) return null;
        return (
          <Modal
            isOpen={true}
            onClose={() => setWarningReviewRowIndex(null)}
            title={language === 'ar' ? `⚠️ تحذير - الصف رقم ${warningReviewRowIndex}` : `⚠️ Warning - Row #${warningReviewRowIndex}`}
            maxWidth="md"
          >
            <div className="space-y-3">
              <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
                <p className="text-xs font-black text-amber-950 mb-1.5">
                  {language === 'ar' ? (row.warnings.length > 1 ? 'تحذيرات:' : 'تحذير:') : (row.warnings.length > 1 ? 'Warnings:' : 'Warning:')}
                </p>
                <ul className="list-disc pr-5 text-sm font-bold text-amber-900 space-y-1">
                  {row.warnings.map((w, idx) => <li key={idx}>{w}</li>)}
                </ul>
                <p className="text-[11px] text-amber-700 mt-2 font-sans">
                  {language === 'ar' ? 'السجل يبقى صالحًا من الناحية الفنية ويمكن حفظه.' : 'The record remains technically valid and can be stored.'}
                </p>
              </div>

              {!canOverrideWarnings && (
                <p className="text-[11px] text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">
                  {language === 'ar' ? 'لا تملك صلاحية "تسجيل رغم التحذير" - يمكنك فقط تعديل البيانات.' : 'You do not have "Save Despite Warning" permission - you can only edit the data.'}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setWarningReviewRowIndex(null); handleOpenEditEntireRow(row.rowIndex); }}
                  className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                >
                  {language === 'ar' ? 'تعديل البيانات' : 'Edit Data'}
                </button>
                <button
                  type="button"
                  disabled={!canOverrideWarnings}
                  onClick={() => { handleAcceptRowWarnings(row.rowIndex); setWarningReviewRowIndex(null); }}
                  className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer"
                >
                  {language === 'ar' ? 'تسجيل رغم التحذير' : 'Save Despite Warning'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* ========================================================================= */}
      {/* MODAL: Bulk Approve & Import Despite Warnings (§13/§16)                    */}
      {/* ========================================================================= */}
      {showBulkWarningAcceptConfirm && pressingSummary && (() => {
        // Operates on every currently-INCLUDED row with a pending warning (the
        // partial-import model's existing selection = inclusion, per §16) -
        // not a separate scratch selection.
        const pending = pressingSummary.rows.filter((r) => needsWarningAcceptance(r) && getRowSelection(r) === 'INCLUDED');
        return (
          <Modal
            isOpen={true}
            onClose={() => setShowBulkWarningAcceptConfirm(false)}
            title={language === 'ar' ? 'اعتماد التحذيرات جماعيًا' : 'Bulk Approve Warnings'}
            maxWidth="sm"
          >
            <div className="space-y-3">
              <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl">
                <p className="text-sm font-bold text-amber-950">
                  {language === 'ar'
                    ? `الموافقة على تحذيرات ${pending.length} صف والاستمرار في تضمينهم للاستيراد. لن يتم تعديل أي قيمة.`
                    : `Approving warnings for ${pending.length} rows and keeping them included for import. No values will be changed.`}
                </p>
              </div>
              {!canOverrideWarnings && (
                <p className="text-[11px] text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">
                  {language === 'ar' ? 'لا تملك صلاحية اعتماد التحذيرات.' : 'You do not have permission to approve warnings.'}
                </p>
              )}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowBulkWarningAcceptConfirm(false)} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                  {language === 'ar' ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="button"
                  disabled={!canOverrideWarnings || pending.length === 0}
                  onClick={() => { handleBulkAcceptWarnings(pending.map((r) => r.rowIndex)); setShowBulkWarningAcceptConfirm(false); }}
                  className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer"
                >
                  {language === 'ar' ? 'الموافقة والاستيراد رغم التحذيرات' : 'Approve & Import Despite Warnings'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
};

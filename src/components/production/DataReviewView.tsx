/**
 * Historical Production Review, Edit & Versioned Audit Log Center
 * Features:
 * - Cross-stage unified querying and multi-dimension filtering
 * - Status workflow: DRAFT, SUBMITTED, REVIEWED, APPROVED, REJECTED, CORRECTED
 * - Deep Record Inspection Modal with inline field correction
 * - Full audit trail display for every record change
 * - Permission-guarded: operators see their own records, supervisors & admins can approve/correct
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  CheckCircle2, 
  XCircle, 
  Edit3, 
  History, 
  Filter, 
  Search, 
  Calendar, 
  Layers, 
  User, 
  Eye, 
  FileText, 
  ShieldCheck, 
  AlertCircle,
  Clock,
  ArrowUpDown,
  Download,
  Loader2,
  X,
  Save,
  MessageSquare
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { 
  UniversalStageRecord, 
  RecordStatus, 
  ProductionStageType,
  RecordAuditLog,
  MultiDimensionFilter 
} from '../../types';
import { 
  fetchUniversalStageRecords, 
  setRecordApprovalStatus, 
  updateStageRecord, 
  fetchRecordAuditHistory,
  STAGE_DISPLAY_NAMES 
} from '../../services/stageRecordService';
import {
  resolveDashboardDateSelection,
  type DashboardDatePreset,
  type DashboardDateSelection,
} from '../../services/dashboardPeriodPure';
import { todayLocalIso, resolveNamedMonthRange } from '../../assistant/tools/dateRangeResolver';
import { filterDataReviewRecords } from '../../services/dataReviewSearchPure';
import {
  MASTER_DATA_CATEGORIES,
  normaliseSelection,
  getCategory,
  supportsProductionFilter,
} from '../../services/masterDataCategoryRegistry';
import {
  filterProductionRecords,
  resolveProductionFilter,
} from '../../services/productionFilterEnginePure';
import {
  EMPTY_SELECTION_STATE,
  BULK_EDITABLE_FIELDS,
  toggleRow,
  selectAllVisible,
  deselectAll,
  pruneToVisible,
  selectionCount,
  isSelected,
  areAllVisibleSelected,
  planBulkEdit,
  summariseBulkEdit,
  confirmationMessage,
  BulkEditOutcome,
} from '../../services/bulkEditPure';
import * as XLSX from 'xlsx';

/**
 * PHASE 5E.3 - Data Review opens on the last 30 days.
 *
 * This is a deliberate, user-visible product decision, not a hidden cap: the
 * active period is rendered on screen, the matching preset button is
 * highlighted, and "كل الفترات (All Time)" sits next to it as an explicit
 * one-click choice. Declared as a named constant so the default is stated in
 * exactly one place and can be asserted by the tests.
 */
export const DATA_REVIEW_DEFAULT_DATE_PRESET: DashboardDatePreset = 'last30days';

/** The two presets this screen exposes as buttons; manual date entry produces 'custom'. */
export const DATA_REVIEW_DATE_PRESETS: DashboardDatePreset[] = ['last30days', 'all'];

export const DataReviewView: React.FC = () => {
  const { adminUser } = useAuth();
  const [records, setRecords] = useState<UniversalStageRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Filters
  const [selectedStage, setSelectedStage] = useState<ProductionStageType | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<RecordStatus | 'all'>('all');
  /**
   * PHASE 5E.3 - the date range is now a PRESET SELECTION rather than two
   * free-floating strings that both defaulted to ''.
   *
   * Before this change the screen opened with startDate/endDate both empty,
   * which resolveStageQueryBounds() reads as "no bound" - so the very first
   * load read every stage collection in full, and (because Phase 4B's cache
   * requires BOTH dates) could never be cached. The default is now a real
   * bounded LAST 30 DAYS window, which is both server-side bounded and
   * cache-eligible.
   *
   * Full history is NOT removed - it becomes an EXPLICIT, labelled choice
   * ("كل الفترات / All Time"), which is the only UI path that intentionally
   * produces an unbounded query. Previously "all time" was reachable only by
   * the unlabelled empty-input state, which no user could distinguish from
   * "no filter applied yet".
   *
   * Reuses the application's existing period vocabulary
   * (services/dashboardPeriodPure.ts, Phase 5B) rather than introducing a
   * second date-range framework - same resolver, same injected-"today"
   * convention, same empty-bounds meaning for the all-time preset.
   */
  const [dateSelection, setDateSelection] = useState<DashboardDateSelection>({
    preset: DATA_REVIEW_DEFAULT_DATE_PRESET,
  });

  const resolvedDates = useMemo(
    () => resolveDashboardDateSelection(dateSelection, {
      today: todayLocalIso(),
      resolveNamedMonth: (year, month) => {
        const r = resolveNamedMonthRange(year, month);
        return { startDate: r.startDate, endDate: r.endDate };
      },
    }),
    [dateSelection]
  );

  // The exact strings sent to the service and shown in the two date inputs.
  // For the 'all' preset these are '' - the existing, unchanged service
  // semantics for an unbounded query.
  const startDate = resolvedDates.startDate;
  const endDate = resolvedDates.endDate;

  // Selected Record for Modal Inspection / Correction / Audit History
  const [selectedRecord, setSelectedRecord] = useState<UniversalStageRecord | null>(null);
  /*
   * Category-first filtering.
   *
   * EVERY category is listed, including the ones that cannot filter production.
   * The unusable ones are disabled and say why, because "the option is missing"
   * is a worse answer than "the option is here and this is exactly what is
   * missing" - and a filter that silently matched nothing would look like the
   * category genuinely having no production, which would be a lie.
   */
  const [filterCategoryId, setFilterCategoryId] = useState<string>('');
  const [filterCodes, setFilterCodes] = useState<string[]>([]);
  const [filterAll, setFilterAll] = useState<boolean>(true);

  // Explicit row selection for bulk edit. Never inferred from the filters.
  const [selection, setSelection] = useState(EMPTY_SELECTION_STATE);
  const [isBulkOpen, setIsBulkOpen] = useState<boolean>(false);
  const [bulkNotes, setBulkNotes] = useState<string>('');
  const [bulkReason, setBulkReason] = useState<string>('');
  const [bulkBusy, setBulkBusy] = useState<boolean>(false);
  const [bulkOutcome, setBulkOutcome] = useState<BulkEditOutcome | null>(null);

  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [editedFields, setEditedFields] = useState<Record<string, any>>({});
  const [correctionReason, setCorrectionReason] = useState<string>('');
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [auditLogs, setAuditLogs] = useState<RecordAuditLog[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [modalFeedback, setModalFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const canApprove = useMemo(() => {
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN' || adminUser.role === 'SUPERVISOR') return true;
    const perms = adminUser.permissions as Record<string, any> | undefined;
    return perms?.recordsApprove === true || perms?.['production.approve'] === true;
  }, [adminUser]);

  const canEdit = useMemo(() => {
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    const perms = adminUser.permissions as Record<string, any> | undefined;
    return perms?.recordsEditAll === true || perms?.['production.edit'] === true || perms?.['production.correct'] === true;
  }, [adminUser]);

  const loadRecords = async () => {
    setIsLoading(true);
    try {
      const data = await fetchUniversalStageRecords({
        stageType: selectedStage,
        status: selectedStatus,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        // F-02: `searchQuery` is deliberately NOT sent to the service.
        // It is applied client-side below instead (see `visibleRecords`), so
        // `records` always holds the complete set for the selected
        // date/stage/status scope. Sending it here would narrow the cached
        // dataset by a term this effect does not re-run on, and clearing the
        // search box could then never restore the rows it had removed.
      });

      // Permission filter: if normal user only has read.own
      const perms = adminUser?.permissions as Record<string, any> | undefined;
      if (adminUser?.role === 'PRODUCTION_USER' && !perms?.recordsReadAll && !perms?.['production.view']) {
        setRecords(data.filter(r => r.createdBy === adminUser.uid));
      } else {
        setRecords(data);
      }
    } catch (err) {
      console.error('Error fetching stage records:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // PHASE 5E.3 - an incomplete or inverted CUSTOM range must not query at
    // all. resolveDashboardDateSelection() reports those as invalid with
    // empty bounds, and empty bounds mean UNBOUNDED to the service - so
    // without this guard a mid-edit date would silently trigger exactly the
    // full-history read this phase removes. Explicit "All Time" remains the
    // only path that intentionally produces an unbounded query.
    if (resolvedDates.invalid) {
      setIsLoading(false);
      return;
    }
    loadRecords();
  }, [selectedStage, selectedStatus, startDate, endDate, resolvedDates.invalid]);

  const openRecordDetails = async (rec: UniversalStageRecord) => {
    setSelectedRecord(rec);
    setEditedFields({
      quantity: rec.quantity,
      wasteQuantity: rec.wasteQuantity || 0,
      notes: rec.rawData?.notes || '',
    });
    setIsEditMode(false);
    setCorrectionReason('');
    setReviewNotes('');
    setModalFeedback(null);

    // Fetch versioned history
    setIsLoadingAudit(true);
    try {
      const history = await fetchRecordAuditHistory(rec.id);
      setAuditLogs(history);
    } catch (e) {
      setAuditLogs([]);
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const handleStatusChange = async (newStatus: 'APPROVED' | 'REJECTED') => {
    if (!selectedRecord) return;
    setActionLoading(true);
    try {
      await setRecordApprovalStatus(selectedRecord.stageType, selectedRecord.id, newStatus, reviewNotes);
      setModalFeedback({
        type: 'success',
        message: `تم تحديث حالة السجل بنجاح إلى: ${newStatus === 'APPROVED' ? 'معتمد' : 'مرفوض'}.`
      });
      setSelectedRecord(prev => prev ? { ...prev, status: newStatus } : null);
      await loadRecords();
    } catch (err: any) {
      setModalFeedback({ type: 'error', message: err.message || 'فشل تحديث الحالة.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveCorrection = async () => {
    if (!selectedRecord) return;
    if (!correctionReason.trim()) {
      setModalFeedback({ type: 'error', message: 'يرجى كتابة سبب التعديل لتوثيق سجل التغييرات.' });
      return;
    }

    setActionLoading(true);
    try {
      await updateStageRecord(selectedRecord.stageType, selectedRecord.id, editedFields, correctionReason);
      setModalFeedback({
        type: 'success',
        message: 'تم حفظ التعديلات وتوثيقها في سجل التغييرات بنجاح.'
      });
      setIsEditMode(false);
      
      // Refresh audit history
      const history = await fetchRecordAuditHistory(selectedRecord.id);
      setAuditLogs(history);
      await loadRecords();
    } catch (err: any) {
      setModalFeedback({ type: 'error', message: err.message || 'فشل حفظ التعديلات.' });
    } finally {
      setActionLoading(false);
    }
  };

  /**
   * F-02 - the records actually shown, derived from the canonical `records`
   * state. Zero Firestore reads: this filters the already-loaded, already
   * date/stage/status-bounded dataset, so it updates on every keystroke
   * without a network round-trip. `records` itself is never mutated or
   * overwritten, so clearing the box restores the full filtered set.
   */
  const visibleRecords = useMemo(
    () => {
      const searched = filterDataReviewRecords(records, searchQuery);
      // Category/code narrowing runs over the already-bounded, already-fetched
      // set - no extra Firestore read, and never one query per selected code.
      const sel = normaliseSelection(filterCategoryId || null, filterCodes, filterAll);
      /*
       * Routed through the central engine rather than filtering here: it is the
       * one place that knows a hierarchical parent means the parent AND every
       * descendant, and it refuses outright to narrow on a category with no
       * verified production field. Reporting calls the same engine, so a total
       * and this list can never disagree about what "Presses" means.
       */
      return filterProductionRecords(searched, sel);
    },
    [records, searchQuery, filterCategoryId, filterCodes, filterAll]
  );

  /**
   * Codes offered by the second selector, derived from the records actually in
   * view. Sourcing them from the loaded set (rather than a fresh Master Data
   * fetch) keeps this at zero additional reads and guarantees every offered
   * code can actually match something.
   */
  const availableCodes = useMemo(() => {
    const category = filterCategoryId ? getCategory(filterCategoryId) : undefined;
    const field = category?.productionFilter;
    if (!field) return [] as Array<{ value: string; label: string }>;
    const seen = new Map<string, string>();
    for (const r of filterDataReviewRecords(records, searchQuery)) {
      const raw = (r as any)[field];
      if (raw == null || raw === '') continue;
      const value = String(raw);
      if (seen.has(value)) continue;
      const label =
        field === 'stageType' ? (r.stageNameAr || value)
        : field === 'productId' ? (r.productName || r.productCode || value)
        : (r.customerName || value);
      seen.set(value, label);
    }
    return [...seen.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [records, searchQuery, filterCategoryId]);

  /** What the current selection actually resolved to - shown to the user verbatim. */
  const resolvedFilter = useMemo(
    () => resolveProductionFilter(normaliseSelection(filterCategoryId || null, filterCodes, filterAll)),
    [filterCategoryId, filterCodes, filterAll]
  );

  const visibleIds = useMemo(() => visibleRecords.map((r) => r.id), [visibleRecords]);

  /**
   * A row that scrolls out of the filter must not stay selected: a later bulk
   * edit would then write to a record the user can no longer see. The count
   * visibly drops, so nothing happens silently.
   */
  useEffect(() => {
    setSelection((prev) => (prev.selectedIds.length ? pruneToVisible(prev, visibleIds) : prev));
  }, [visibleIds]);

  /**
   * Applies the bulk edit.
   *
   * Row-isolated on purpose: each record goes through the SAME
   * updateStageRecord the single-record editor uses, so the correction reason,
   * the CORRECTED status and the versioned audit log are identical. One row
   * failing never rolls back the rows that already succeeded.
   */
  const handleBulkEdit = async () => {
    const patch: Record<string, unknown> = { notes: bulkNotes };
    const plan = planBulkEdit(selection, visibleRecords, patch);
    if (plan.targets.length === 0) return;
    if (!window.confirm(confirmationMessage(plan.targets.length, 'ar'))) return;

    setBulkBusy(true);
    const results: Array<{ id: string; ok: boolean; reason?: string }> = [];
    for (const target of plan.targets) {
      try {
        await updateStageRecord(
          target.stageType as any,
          target.id,
          patch,
          bulkReason || 'تعديل جماعي',
        );
        results.push({ id: target.id, ok: true });
      } catch (err: any) {
        // Isolated: recorded and skipped, the remaining rows still proceed.
        results.push({ id: target.id, ok: false, reason: String(err?.message ?? err) });
      }
    }
    const outcome = summariseBulkEdit(plan, results);
    setBulkOutcome(outcome);
    setBulkBusy(false);
    setSelection(deselectAll());
    await loadRecords();
  };

  const exportToExcel = () => {
    // Exports exactly what the table shows, search included - otherwise a
    // filtered view would silently export unfiltered rows.
    const exportData = visibleRecords.map(r => ({
      'كود السجل': r.id,
      'المرحلة': r.stageNameAr,
      'التاريخ': r.date,
      'كود المنتج': r.productCode || '-',
      'اسم المنتج': r.productName || '-',
      'العميل': r.customerName || '-',
      'الكمية المنتجة': r.quantity,
      'الوحدة': r.unit,
      'الهالك': r.wasteQuantity || 0,
      'الصالح': r.goodQuantity || 0,
      'التوقفات (دقيقة)': r.totalDowntimeMinutes || 0,
      'الحالة': r.status,
      'المسجل': r.createdByName || '-',
      'تاريخ الإدخال': r.createdAt?.split('T')[0] || '-',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'سجلات_الإنتاج');
    XLSX.writeFile(wb, `ASFOUR_Production_Review_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const renderStatusBadge = (st: RecordStatus) => {
    switch (st) {
      case 'APPROVED':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">معتمد</span>;
      case 'REJECTED':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">مرفوض</span>;
      case 'CORRECTED':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">معدل</span>;
      case 'REVIEWED':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">قيد المراجعة</span>;
      case 'DRAFT':
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200">مسودة</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-50 text-purple-700 border border-purple-200">مقدم</span>;
    }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-red-600" />
            مركز مراجعة وتدقيق سجلات الإنتاج (Data Review & Audit)
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            مراجعة كافة سجلات المراحل الثمانية، اعتماد السجلات، تعديل البيانات وحفظ سجل التاريخ المعتمد
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportToExcel}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-600" />
            تصدير إلى Excel
          </button>
        </div>
      </div>

      {/* PHASE 5E.3 - Review period selector. The active scope is always
          stated on screen; "All Time" is an explicit, labelled choice rather
          than the old unlabelled empty-date state. */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-2">
        <span className="text-xs font-black text-slate-800 flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-slate-500" />
          فترة المراجعة (Review Period):
        </span>

        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-[11px] font-bold">
          {DATA_REVIEW_DATE_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDateSelection({ preset: p })}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${dateSelection.preset === p ? 'bg-white text-red-600 shadow-xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {p === 'last30days' ? 'آخر 30 يوم (Last 30 Days)' : null}
              {p === 'all' ? 'كل الفترات (All Time)' : null}
            </button>
          ))}
        </div>

        {resolvedDates.invalid ? (
          <span className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 border border-red-200 text-[11px] font-bold">
            نطاق تاريخ غير صالح - تاريخ البداية يجب أن يسبق تاريخ النهاية أو يساويه. لم يتم تحديث السجلات.
          </span>
        ) : dateSelection.preset === 'all' ? (
          <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-bold">
            يتم عرض كامل السجل التاريخي لكل المراحل (All Time - full history)
          </span>
        ) : (
          <span className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-bold">
            {startDate} → {endDate}
          </span>
        )}
      </div>

      {/* Multi-Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث بالمنتج أو العميل..."
            className="w-full pl-3 pr-9 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 outline-none"
          />
          <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
        </div>

        {/* Stage Filter */}
        <div>
          <select
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value as any)}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none"
          >
            <option value="all">جميع مراحل الإنتاج (All Stages)</option>
            {Object.entries(STAGE_DISPLAY_NAMES).map(([st, name]) => (
              <option key={st} value={st}>{name}</option>
            ))}
          </select>
        </div>

        {/* Status Filter */}
        <div>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none"
          >
            <option value="all">جميع الحالات (All Statuses)</option>
            <option value="SUBMITTED">مقدم (Submitted)</option>
            <option value="APPROVED">معتمد (Approved)</option>
            <option value="REJECTED">مرفوض (Rejected)</option>
            <option value="CORRECTED">معدل (Corrected)</option>
            <option value="DRAFT">مسودة (Draft)</option>
          </select>
        </div>

        {/* Start Date - PHASE 5E.3: editing either input switches the
            selection to an explicit CUSTOM range and carries the other end
            over unchanged, so a manual range is used verbatim and survives
            stage/status filter changes. */}
        <div>
          <input
            type="date"
            value={startDate}
            aria-invalid={resolvedDates.invalid}
            onChange={(e) => setDateSelection({ preset: 'custom', startDate: e.target.value, endDate })}
            className={`w-full px-3 py-2 text-xs bg-slate-50 border rounded-xl outline-none ${resolvedDates.invalid ? 'border-red-400' : 'border-slate-300'}`}
            placeholder="من تاريخ"
          />
        </div>

        {/* End Date */}
        <div>
          <input
            type="date"
            value={endDate}
            aria-invalid={resolvedDates.invalid}
            onChange={(e) => setDateSelection({ preset: 'custom', startDate, endDate: e.target.value })}
            className={`w-full px-3 py-2 text-xs bg-slate-50 border rounded-xl outline-none ${resolvedDates.invalid ? 'border-red-400' : 'border-slate-300'}`}
            placeholder="إلى تاريخ"
          />
        </div>
      </div>

      {/* Records Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          {/* Category -> code filtering. Only verified mappings are offered. */}
          <div className="px-4 pt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">نوع الأكواد (Data Category)</label>
              <select
                value={filterCategoryId}
                onChange={(e) => { setFilterCategoryId(e.target.value); setFilterCodes([]); setFilterAll(true); }}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl font-bold text-slate-800 outline-none"
              >
                <option value="">بدون تصنيف (No category)</option>
                {MASTER_DATA_CATEGORIES.map((c) => {
                  const usable = supportsProductionFilter(c.id);
                  return (
                    <option key={c.id} value={c.id} disabled={!usable}>
                      {c.labelAr} / {c.labelEn}
                      {usable ? '' : ' — غير متاح لمراجعة الإنتاج (not available)'}
                    </option>
                  );
                })}
              </select>
              {filterCategoryId && !resolvedFilter.applicable && (
                <p className="mt-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  {resolvedFilter.reasonAr}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                الأكواد (Codes) {filterCategoryId && `- ${filterAll ? 'الكل' : filterCodes.length}`}
              </label>
              <select
                multiple
                disabled={!filterCategoryId}
                value={filterAll ? [] : filterCodes}
                onChange={(e) => {
                  const chosen = Array.from(e.target.selectedOptions).map((o) => o.value);
                  setFilterCodes(chosen);
                  setFilterAll(chosen.length === 0);
                }}
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl text-slate-800 outline-none disabled:opacity-50 h-[76px]"
              >
                {availableCodes.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              {resolvedFilter.expandedFromHierarchy && (
                <p className="mt-1 text-[11px] font-bold text-sky-700">{resolvedFilter.reasonAr}</p>
              )}
            </div>

            <div className="flex items-end gap-2">
              <button
                type="button"
                disabled={!filterCategoryId}
                onClick={() => { setFilterCodes([]); setFilterAll(true); }}
                className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl cursor-pointer"
              >
                الكل (ALL)
              </button>
              <button
                type="button"
                disabled={!filterCategoryId}
                onClick={() => { setFilterCategoryId(''); setFilterCodes([]); setFilterAll(true); }}
                className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-xl cursor-pointer"
              >
                مسح (Clear)
              </button>
            </div>
          </div>

          {/* Selection summary + bulk action. There is deliberately no bulk
              delete: stage records have no delete primitive at all. */}
          <div className="px-4 py-3 flex items-center gap-3 flex-wrap text-xs">
            <span className="font-bold text-slate-600">
              الظاهر (Visible): <span className="text-slate-900">{visibleRecords.length}</span>
            </span>
            <span className="font-bold text-slate-600">
              المحدد (Selected): <span className="text-sky-700">{selectionCount(selection)}</span>
            </span>
            <button
              type="button"
              onClick={() => setSelection(selectAllVisible(selection, visibleIds))}
              disabled={visibleIds.length === 0}
              className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              تحديد الظاهر (Select visible)
            </button>
            <button
              type="button"
              onClick={() => setSelection(deselectAll())}
              disabled={selectionCount(selection) === 0}
              className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              إلغاء التحديد (Deselect all)
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={() => { setBulkOutcome(null); setBulkNotes(''); setBulkReason(''); setIsBulkOpen(true); }}
                disabled={selectionCount(selection) === 0}
                className="px-3 py-1.5 font-black text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                تعديل جماعي (Bulk Edit)
              </button>
            )}
          </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-500 text-sm flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-red-600" />
            <span>جاري تحميل سجلات الإنتاج للتدقيق والمراجعة...</span>
          </div>
        ) : visibleRecords.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            لا توجد سجلات تطابق الفلاتر المحددة حالياً.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase">
                <tr>
                  <th className="px-4 py-3.5 w-10">
                    <input
                      type="checkbox"
                      aria-label="تحديد كل الظاهر"
                      checked={areAllVisibleSelected(selection, visibleIds)}
                      onChange={(e) => setSelection(e.target.checked ? selectAllVisible(selection, visibleIds) : deselectAll())}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-3.5">التاريخ</th>
                  <th className="px-4 py-3.5">المرحلة الإنتاجية</th>
                  <th className="px-4 py-3.5">المنتج / الصنف</th>
                  <th className="px-4 py-3.5">الكمية</th>
                  <th className="px-4 py-3.5">الهالك</th>
                  <th className="px-4 py-3.5">العميل / الأمر</th>
                  <th className="px-4 py-3.5">الحالة</th>
                  <th className="px-4 py-3.5 text-center">إجراءات التدقيق</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`تحديد سجل ${rec.id}`}
                        checked={isSelected(selection, rec.id)}
                        onChange={() => setSelection(toggleRow(selection, rec.id))}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                      {rec.date}
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                      {rec.stageNameAr}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-900">{rec.productName || 'غير محدد'}</span>
                        {rec.productCode && <span className="font-mono text-[10px] text-slate-500">{rec.productCode}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-900 whitespace-nowrap">
                      {rec.quantity.toLocaleString()} {rec.unit}
                    </td>
                    <td className="px-4 py-3 font-mono text-red-600 font-bold whitespace-nowrap">
                      {(rec.wasteQuantity || 0).toLocaleString()} {rec.unit}
                    </td>
                    <td className="px-4 py-3 text-slate-600 truncate max-w-xs">
                      {rec.customerName || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {renderStatusBadge(rec.status)}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => openRecordDetails(rec)}
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        فحص وتدقيق
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Record Audit & Review Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-600 text-white flex items-center justify-center font-bold">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900 flex items-center gap-2">
                    تدقيق سجل: {selectedRecord.stageNameAr}
                    {renderStatusBadge(selectedRecord.status)}
                  </h2>
                  <p className="text-xs text-slate-500 font-mono">
                    ID: {selectedRecord.id} &bull; التاريخ: {selectedRecord.date}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1 text-xs">
              {modalFeedback && (
                <div className={`p-3 rounded-xl font-bold flex items-center gap-2 ${
                  modalFeedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {modalFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
                  <span>{modalFeedback.message}</span>
                </div>
              )}

              {/* Data Summary Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-500 font-bold block mb-1">المنتج / الصنف:</span>
                  <span className="font-bold text-slate-900 text-sm">{selectedRecord.productName || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold block mb-1">العميل:</span>
                  <span className="font-bold text-slate-900 text-sm">{selectedRecord.customerName || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold block mb-1">الكمية المسجلة:</span>
                  <span className="font-bold text-slate-900 text-sm">{selectedRecord.quantity} {selectedRecord.unit}</span>
                </div>
                <div>
                  <span className="text-slate-500 font-bold block mb-1">الهالك المسجل:</span>
                  <span className="font-bold text-red-600 text-sm">{selectedRecord.wasteQuantity || 0} {selectedRecord.unit}</span>
                </div>
              </div>

              {/* Edit / Correction Form */}
              {isEditMode ? (
                <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200 space-y-3">
                  <h3 className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                    <Edit3 className="w-4 h-4 text-amber-600" />
                    تعديل بيانات السجل (مع توثيق سبب التغيير)
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">الكمية المنتجة</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editedFields.quantity}
                        onChange={(e) => setEditedFields(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">كمية الهالك</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editedFields.wasteQuantity}
                        onChange={(e) => setEditedFields(prev => ({ ...prev, wasteQuantity: Number(e.target.value) }))}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold text-red-600"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      سبب التعديل والتوثيق <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={correctionReason}
                      onChange={(e) => setCorrectionReason(e.target.value)}
                      placeholder="مثال: تصحيح قراءة العداد / مراجعة كشف الفرز اليدوي..."
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setIsEditMode(false)}
                      className="px-3 py-1.5 text-slate-600 font-bold hover:bg-slate-100 rounded-lg cursor-pointer"
                    >
                      إلغاء التعديل
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={handleSaveCorrection}
                      className="flex items-center gap-1 px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg cursor-pointer"
                    >
                      {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      حفظ التعديل الموثق
                    </button>
                  </div>
                </div>
              ) : (
                canEdit && (
                  <button
                    type="button"
                    onClick={() => setIsEditMode(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg cursor-pointer transition-colors"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    تعديل وتصحيح بيانات هذا السجل
                  </button>
                )
              )}

              {/* Versioned Audit History Log */}
              <div className="space-y-2">
                <h3 className="font-bold text-slate-800 flex items-center gap-1.5 uppercase">
                  <History className="w-4 h-4 text-purple-600" />
                  سجل التعديلات والتدقيق المعتمد ({auditLogs.length})
                </h3>

                {isLoadingAudit ? (
                  <div className="p-4 text-center text-slate-400">جاري تحميل سجل التغييرات...</div>
                ) : auditLogs.length === 0 ? (
                  <div className="p-3 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500">
                    لا توجد تعديلات سابقة لهذا السجل (النسخة الأصلية).
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {auditLogs.map((log) => (
                      <div key={log.id} className="p-3 bg-purple-50/50 rounded-xl border border-purple-100 flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-purple-900">{log.changedByName}</span>
                            <span className="text-[10px] text-slate-400 font-mono">{log.changedAt?.split('T')[0]}</span>
                            <span className="px-1.5 py-0.2 text-[10px] font-bold bg-purple-100 text-purple-800 rounded">
                              {log.action}
                            </span>
                          </div>
                          <p className="text-slate-600 text-xs">
                            السبب: <span className="font-semibold text-slate-800">{log.reason}</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer / Approval Actions */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex-1">
                <input
                  type="text"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="ملاحظات الاعتماد أو الرفض..."
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg outline-none"
                />
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto">
                {canApprove && (
                  <>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStatusChange('REJECTED')}
                      className="flex items-center gap-1 px-3.5 py-2 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-xl cursor-pointer"
                    >
                      <XCircle className="w-4 h-4" />
                      رفض السجل
                    </button>
                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => handleStatusChange('APPROVED')}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      اعتماد السجل
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setSelectedRecord(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk edit. Only `notes` is offered: every other field is a per-record
          measurement, system-managed, derived, or a denormalised relation. */}
      {isBulkOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={() => !bulkBusy && setIsBulkOpen(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-black text-slate-900">تعديل جماعي (Bulk Edit)</h3>
            <p className="text-xs text-slate-600">
              سيتم تعديل <span className="font-black text-sky-700">{selectionCount(selection)}</span> سجل محدد فقط. السجلات غير المحددة لن تتأثر.
            </p>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">ملاحظات (notes) - الحقل الوحيد المسموح بتعديله جماعيًا</label>
              <textarea value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} rows={3} className="w-full text-xs border border-slate-300 rounded-lg px-2.5 py-2" />
              <p className="text-[10px] text-slate-400 mt-1">الحقول المسموحة: {BULK_EDITABLE_FIELDS.join(', ')}</p>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">سبب التعديل (correction reason)</label>
              <input type="text" value={bulkReason} onChange={(e) => setBulkReason(e.target.value)} placeholder="تعديل جماعي" className="w-full text-xs border border-slate-300 rounded-lg px-2.5 py-2" />
            </div>
            {bulkOutcome && (
              <div className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                <div className="font-bold text-emerald-700">نجح: {bulkOutcome.successCount}</div>
                <div className="font-bold text-red-700">فشل: {bulkOutcome.failedCount}</div>
                <div className="font-bold text-slate-500">تم تخطيه: {bulkOutcome.skippedCount}</div>
                {bulkOutcome.failed.map((f) => (
                  <div key={f.id} className="text-[11px] text-slate-600 font-mono">{f.id}: {f.reason}</div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <button type="button" disabled={bulkBusy || selectionCount(selection) === 0} onClick={handleBulkEdit} className="px-3 py-1.5 text-xs font-black text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-lg cursor-pointer">
                {bulkBusy ? 'جارٍ التنفيذ...' : 'تأكيد التعديل'}
              </button>
              <button type="button" disabled={bulkBusy} onClick={() => setIsBulkOpen(false)} className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

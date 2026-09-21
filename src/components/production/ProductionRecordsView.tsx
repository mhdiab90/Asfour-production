/**
 * Production Records Management View
 * Features comprehensive filtering (Date, Cost Centre, Shift, Product, Customer,
 * Search), real-time aggregate KPI metrics, single record editing, single and
 * bulk deletion of selected records, and Excel export.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Search,
  Filter,
  Download,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  AlertCircle,
  X,
} from 'lucide-react';
import { ProductionRecord, Shift, Press, Furnace, Product, Customer, NavigationPage } from '../../types';
import { subscribeProductionRecords, updateProductionRecord, deleteProductionRecord } from '../../services/productionService';
import { fetchMasterData } from '../../services/masterDataService';
/*
 * The organisational filter is the canonical cost-centre HIERARCHY, through the
 * SAME selector component the Dashboard and the Custom Dashboard use (search,
 * 5/6/7/8/9 groups, recursive checkboxes). What a ticked node covers is decided
 * by the shared engine: node -> descendants -> linked equipment -> the records
 * naming that equipment (pressId / furnaceId). This screen does not walk the
 * tree and does not match equipment fields by hand.
 *
 * It replaces three controls that expressed the same dimension: a multi-level
 * drill-down, a separate equipment checklist beneath it, and a Code Type ->
 * Codes pair.
 */
import { CostCenterScopeSelector } from '../dashboard/CostCenterScopeSelector';
import { normaliseSelection } from '../../services/masterDataCategoryRegistry';
import {
  asNodeSelection,
  filterLegacyProductionRecords,
} from '../../services/productionFilterEnginePure';
import {
  listCostCenterHierarchyNodes,
  buildCostCenterHierarchyIndex,
  CostCenterHierarchyRecord,
} from '../../services/costCenterHierarchyService';
/*
 * Legacy code <-> hierarchy reconciliation, applied in memory.
 *
 * A press that carries no explicit hierarchyNodeId but shares its business code
 * with exactly one hierarchy node is linked for resolution purposes, so a leaf
 * resolves to its equipment without waiting for an administrator to persist the
 * link. An explicitly stored link always wins.
 */
import {
  reconcileLegacyWithHierarchy,
  applyReconciliationToEquipment,
} from '../../services/legacyHierarchyReconciliationPure';
import { exportProductionRecordsToExcel } from '../../services/exportService';
import { Modal } from '../common/Modal';
import { formatNumber, formatDecimal } from '../../utils/formatters';
import { useLanguage } from '../../i18n/LanguageContext';
/*
 * Row selection reuses the SAME primitives the Data Review screen already
 * uses - there is one selection architecture in this codebase, not two.
 * These are pure functions over an id list: no Firestore, no writes, no reads.
 */
import {
  EMPTY_SELECTION_STATE,
  toggleRow,
  selectAllVisible,
  deselectAll,
  pruneToVisible,
  selectionCount,
  isSelected,
  areAllVisibleSelected,
} from '../../services/bulkEditPure';
/*
 * Bulk delete: the plan (selected ∩ visible) and the one-record-at-a-time loop.
 * The delete itself is the existing deleteProductionRecord primitive, injected.
 */
import {
  planBulkDelete,
  executeBulkDelete,
  BulkDeletePlan,
  BulkDeleteOutcome,
} from '../../services/productionRecordsBulkDeletePure';
import { useAuth } from '../../context/AuthContext';
import {
  DASHBOARD_FILTER_PANEL,
  DASHBOARD_FILTER_SELECT,
  DASHBOARD_DATE_INPUT,
  DASHBOARD_PANEL_BUTTON,
} from '../dashboard/dashboardFilterStyles';

interface ProductionRecordsViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const ProductionRecordsView: React.FC<ProductionRecordsViewProps> = ({ onNavigate }) => {
  const { language, isRtl } = useLanguage();
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filter Master Lists
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [presses, setPresses] = useState<Press[]>([]);
  const [furnaces, setFurnaces] = useState<Furnace[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<CostCenterHierarchyRecord[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Filter Values
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterShift, setFilterShift] = useState<string>('all');
  /** Ticked cost-centre hierarchy nodes. Empty = every cost centre. */
  const [costCenterNodeIds, setCostCenterNodeIds] = useState<string[]>([]);
  const [filterCustomer, setFilterCustomer] = useState<string>('all');
  const [filterProduct, setFilterProduct] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Modals
  const [editingRecord, setEditingRecord] = useState<ProductionRecord | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [deleteConfirmRecord, setDeleteConfirmRecord] = useState<ProductionRecord | null>(null);

  /**
   * Explicit row selection - UI state only, never persisted and never read back
   * from Firestore. Keyed on the record's own document id, never on the row
   * index, so sorting, refiltering and live snapshot refreshes cannot silently
   * move a selection onto a different record.
   *
   * The only action that consumes it is Delete Selected, and only after an
   * explicit confirmation - selecting a row never changes any data.
   */
  const [selection, setSelection] = useState(EMPTY_SELECTION_STATE);

  /*
   * Bulk delete, gated on the EXISTING production.delete permission - no new
   * key. The plan is frozen when the confirmation opens, so the count the user
   * confirms is exactly the batch that runs.
   */
  const { hasPermission } = useAuth();
  const canDeleteRecords = hasPermission('production.delete');
  const [bulkDeletePlan, setBulkDeletePlan] = useState<BulkDeletePlan | null>(null);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkDeleteOutcome, setBulkDeleteOutcome] = useState<BulkDeleteOutcome | null>(null);
  /** The live snapshot, read at the moment of each delete - never a stale closure. */
  const recordsRef = useRef<ProductionRecord[]>(records);
  recordsRef.current = records;
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  useEffect(() => {
    fetchMasterData<Shift>('shifts').then(setShifts).catch(() => {});
    fetchMasterData<Press>('presses').then(setPresses).catch(() => {});
    fetchMasterData<Furnace>('furnaces').then(setFurnaces).catch(() => {});
    listCostCenterHierarchyNodes()
      .then(setHierarchyNodes)
      .catch(() => { /* an unavailable hierarchy only costs the node options */ });
    fetchMasterData<Product>('products').then(setProducts).catch(() => {});
    fetchMasterData<Customer>('customers').then(setCustomers).catch(() => {});
  }, []);

  /**
   * PHASE 4C - split out of the former single mount-only effect above so
   * that changing the date filter re-subscribes ONLY the Production
   * listener (with the same startDate/endDate now passed server-side),
   * never re-fetching Master Data. startDate/endDate were already being
   * applied client-side in `filteredRecords` below - this wires the exact
   * same values through to Firestore instead of ignoring them
   * server-side, so this UI's own date filter now controls how many
   * documents the live listener actually downloads. Empty-string
   * startDate/endDate (the initial/cleared state) still resolve to an
   * unbounded query, identical to this view's pre-Phase-4C behavior.
   * React's effect-cleanup contract unsubscribes the previous listener
   * before this effect body runs again on a startDate/endDate change, so
   * there is never more than one active subscription.
   */
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeProductionRecords(
      (data) => {
        setRecords(data);
        setIsLoading(false);
      },
      (err) => {
        console.error('Error loading production records:', err);
        setIsLoading(false);
      },
      { startDate: startDate || undefined, endDate: endDate || undefined }
    );

    return () => unsubscribe();
  }, [startDate, endDate]);

  /** The node graph - the canonical index the Dashboard selector uses (id = sheet1Code). */
  const hierarchyIndex = useMemo(() => buildCostCenterHierarchyIndex(hierarchyNodes), [hierarchyNodes]);

  /*
   * The equipment whose links make hierarchy filtering work.
   *
   * Presses and furnaces are exactly the master records a legacy production
   * record points at, so their hierarchyNodeId is the bridge between a record
   * and the node tree. Nothing here reads Firestore - both lists are already
   * loaded for the selector.
   */
  /**
   * Equipment, with hierarchy links completed from the code reconciliation.
   *
   * The stored link is authoritative wherever it exists; the code match only
   * fills gaps. Same code AND same category, exactly one candidate each side -
   * anything ambiguous is left unlinked rather than guessed.
   */
  const equipmentLinks = useMemo(() => {
    const raw = [
      ...presses.map((e) => ({ id: String(e.id ?? ''), code: String(e.code ?? ''), categoryId: 'presses', hierarchyNodeId: e.hierarchyNodeId })),
      ...furnaces.map((e) => ({ id: String(e.id ?? ''), code: String(e.code ?? ''), categoryId: 'furnaces', hierarchyNodeId: (e as any).hierarchyNodeId })),
    ];
    const report = reconcileLegacyWithHierarchy(
      raw,
      hierarchyNodes.map((h) => ({ id: h.id, code: h.sheet1Code, name: h.name, type: h.type })),
    );
    return applyReconciliationToEquipment(raw, report).map((e) => ({ id: e.id, hierarchyNodeId: e.hierarchyNodeId }));
  }, [presses, furnaces, hierarchyNodes]);

  /**
   * The cost-centre selection in the shared selection shape. Empty = ALL, which
   * stays a mode and never materialises every node.
   */
  const costCenterSelection = useMemo(
    () => normaliseSelection('productionCenters', costCenterNodeIds.map(asNodeSelection), costCenterNodeIds.length === 0),
    [costCenterNodeIds],
  );

  // Filter logic
  const filteredRecords = filterLegacyProductionRecords(records.filter((rec) => {
    if (filterShift !== 'all' && rec.shiftId !== filterShift) return false;
    if (filterProduct !== 'all' && rec.productId !== filterProduct) return false;
    if (filterCustomer !== 'all' && rec.customerId !== filterCustomer) return false;
    if (startDate && rec.date < startDate) return false;
    if (endDate && rec.date > endDate) return false;

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      const matchProd = rec.productName?.toLowerCase().includes(q) || rec.productCode?.toLowerCase().includes(q);
      const matchCust = rec.customerName?.toLowerCase().includes(q) || rec.customerOrderNumber?.toLowerCase().includes(q);
      const matchPress = rec.pressName?.toLowerCase().includes(q);
      const matchEmp = rec.employeeNames?.some(name => name.toLowerCase().includes(q));

      if (!matchProd && !matchCust && !matchPress && !matchEmp) return false;
    }

    return true;
  }), costCenterSelection, { index: hierarchyIndex }, { equipment: equipmentLinks });

  /*
   * The ids actually on screen right now.
   *
   * Derived from the SAME `filteredRecords` the table renders, so "all visible"
   * can never mean more than what the user can see - no extra fetch, no extra
   * Firestore read. `filteredRecords` is rebuilt on every render, so the list is
   * memoised on the id sequence itself; otherwise the pruning effect below would
   * see a new array identity every render and loop.
   *
   * A record without a document id cannot be addressed safely, so it is excluded
   * rather than given a synthetic key.
   */
  const visibleIdKey = filteredRecords.map((r) => r.id ?? '').join('|');
  const visibleIds = useMemo(
    () => filteredRecords.map((r) => r.id).filter((id): id is string => Boolean(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleIdKey],
  );

  /**
   * A row that leaves the current filter must not stay selected.
   *
   * Without this, changing a filter would leave ids selected for records the
   * user can no longer see, and any future bulk operation could act on them.
   * Pruning makes the counter visibly drop, so nothing is dropped silently.
   */
  useEffect(() => {
    setSelection((prev) => (prev.selectedIds.length ? pruneToVisible(prev, visibleIds) : prev));
  }, [visibleIds]);

  // Calculate live aggregations of filtered list (Factory Standard: TON is primary)
  let totalProductionTons = 0;
  let totalGoodTons = 0;
  let totalWasteTons = 0;
  let missingWeightsCount = 0;

  const totalProductionQuantity = filteredRecords.reduce((sum, r) => sum + (r.productionQuantity || 0), 0);
  const totalGoodQuantity = filteredRecords.reduce((sum, r) => sum + (r.goodQuantity || 0), 0);
  const totalWasteQuantity = filteredRecords.reduce((sum, r) => sum + (r.wasteQuantity || 0), 0);
  const totalProductionWeightKg = filteredRecords.reduce((sum, r) => sum + (r.productionWeight || 0), 0);
  const totalDowntimeMinutes = filteredRecords.reduce((sum, r) => sum + (r.totalDowntimeMinutes || 0), 0);

  filteredRecords.forEach(r => {
    const pWeight = r.pieceWeightKg !== undefined && r.pieceWeightKg !== null
      ? Number(r.pieceWeightKg)
      : (r.pieceWeight !== undefined && r.pieceWeight !== null ? Number(r.pieceWeight) : null);
    const hasWeight = pWeight !== null && !isNaN(pWeight) && pWeight > 0;

    if (r.productionTons !== undefined && r.productionTons !== null && r.productionTons > 0) {
      totalProductionTons += Number(r.productionTons);
      totalGoodTons += Number(r.goodTons ?? (r.productionTons - (r.wasteTons || 0)));
      totalWasteTons += Number(r.wasteTons || 0);
    } else if (hasWeight && pWeight !== null) {
      const prodKg = (r.productionQuantity || 0) * pWeight;
      const goodKg = (r.goodQuantity || 0) * pWeight;
      const wasteKg = (r.wasteQuantity || 0) * pWeight;
      totalProductionTons += (prodKg / 1000);
      totalGoodTons += (goodKg / 1000);
      totalWasteTons += (wasteKg / 1000);
    } else if ((r.productionQuantity || 0) > 0) {
      missingWeightsCount += 1;
    }
  });

  const averageWastePercentage = totalProductionTons > 0
    ? Number(((totalWasteTons / totalProductionTons) * 100).toFixed(2))
    : (totalProductionQuantity > 0 ? Number(((totalWasteQuantity / totalProductionQuantity) * 100).toFixed(2)) : 0);

  const handleOpenEdit = (rec: ProductionRecord) => {
    setEditingRecord({ ...rec });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord || !editingRecord.id) return;
    setIsUpdating(true);
    try {
      await updateProductionRecord(editingRecord.id, editingRecord);
      setIsEditModalOpen(false);
      setEditingRecord(null);
    } catch (err: any) {
      alert(err.message || (language === 'ar' ? 'حدث خطأ أثناء تعديل السجل.' : 'An error occurred while editing the record.'));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmRecord || !deleteConfirmRecord.id) return;
    try {
      await deleteProductionRecord(
        deleteConfirmRecord.id,
        `${deleteConfirmRecord.date} - ${deleteConfirmRecord.productName} (${deleteConfirmRecord.pressName})`
      );
      setDeleteConfirmRecord(null);
    } catch (err) {
      console.error('Error deleting record:', err);
    }
  };

  /** Opens the confirmation with the exact batch: selected ∩ visible. Nothing is deleted here. */
  const openBulkDelete = () => {
    if (!canDeleteRecords) return;
    const plan = planBulkDelete(selection.selectedIds, visibleIds);
    if (plan.targetIds.length === 0) return;
    setBulkDeleteOutcome(null);
    setBulkDeletePlan(plan);
  };

  /**
   * Runs the confirmed batch through the existing single-record primitive.
   *
   * Sequential, one call per record, failures isolated and nothing rolled back.
   * A record that is no longer in the live snapshot when its turn comes is
   * skipped as already removed. Succeeded rows leave the table through the live
   * subscription and the selection pruning; failed rows stay listed and selected
   * so they can be retried.
   */
  const handleConfirmBulkDelete = async () => {
    const plan = bulkDeletePlan;
    if (!canDeleteRecords || !plan || bulkDeleteProgress) return;
    const labelById = new Map(
      records.filter((r) => r.id).map((r) => [String(r.id), `${r.date} - ${r.productName} (${r.pressName})`]),
    );
    setBulkDeleteProgress({ done: 0, total: plan.targetIds.length });
    const outcome = await executeBulkDelete(plan.targetIds, {
      isStillPresent: (id) => recordsRef.current.some((r) => r.id === id),
      deleteOne: (id) => deleteProductionRecord(id, labelById.get(id)),
      onProgress: (done, total) => setBulkDeleteProgress({ done, total }),
    });
    setBulkDeleteProgress(null);
    setBulkDeletePlan(null);
    setBulkDeleteOutcome(outcome);
  };

  const bulkDeleteCount = planBulkDelete(selection.selectedIds, visibleIds).targetIds.length;

  const handleExport = () => {
    exportProductionRecordsToExcel(filteredRecords, `production-records-asfour-${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterShift('all');
    setCostCenterNodeIds([]);
    setFilterCustomer('all');
    setFilterProduct('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/*
        Production Records filters - ONE panel, in the Dashboard's filter-panel
        style (shared dashboardFilterStyles tokens): period, the canonical
        cost-centre hierarchy, shift, product, customer and search, then the
        screen actions. The cost-centre selector opens inline; it never opens
        hierarchy maintenance.
      */}
      <div id="production-records-filter-panel" className={DASHBOARD_FILTER_PANEL}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black text-slate-200 flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-amber-400" />
            {language === 'ar' ? 'فلاتر سجلات الإنتاج' : 'Production Records Filters'}
          </span>
          <div className="flex-grow" />
          {(searchQuery || filterShift !== 'all' || costCenterNodeIds.length > 0 || filterCustomer !== 'all' || filterProduct !== 'all' || startDate || endDate) && (
            <button type="button" onClick={clearFilters} className={DASHBOARD_PANEL_BUTTON}>
              <X className="w-3.5 h-3.5" />
              <span>{language === 'ar' ? 'إعادة ضبط وتفريغ الفلاتر' : 'Reset & Clear Filters'}</span>
            </button>
          )}
          <button
            id="export-records-btn"
            type="button"
            onClick={handleExport}
            disabled={filteredRecords.length === 0}
            className={`${DASHBOARD_PANEL_BUTTON} disabled:opacity-50`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>{language === 'ar' ? 'تصدير إلى Excel' : 'Export to Excel'}</span>
          </button>
          <button
            id="new-production-entry-btn"
            type="button"
            onClick={() => onNavigate('production-entry')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{language === 'ar' ? 'تسجيل إنتاج جديد' : 'New Production Entry'}</span>
          </button>
        </div>

        <div id="production-records-filter-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 mb-1">{language === 'ar' ? 'من تاريخ' : 'From Date'}</span>
            <input type="date" value={startDate} max={endDate || undefined} onChange={(e) => setStartDate(e.target.value)} className={`${DASHBOARD_DATE_INPUT} border-slate-700 w-full py-1.5`} />
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 mb-1">{language === 'ar' ? 'إلى تاريخ' : 'To Date'}</span>
            <input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} className={`${DASHBOARD_DATE_INPUT} border-slate-700 w-full py-1.5`} />
          </label>
          <div>
            <span className="block text-[11px] font-bold text-slate-400 mb-1">{language === 'ar' ? 'مراكز التكاليف' : 'Cost Centres'}</span>
            <CostCenterScopeSelector
              index={hierarchyIndex}
              selectedNodeIds={costCenterNodeIds}
              onChange={setCostCenterNodeIds}
              language={language}
              tone="dark"
              block
            />
          </div>
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 mb-1">{language === 'ar' ? 'الوردية' : 'Shift'}</span>
            <select value={filterShift} onChange={(e) => setFilterShift(e.target.value)} className={`${DASHBOARD_FILTER_SELECT} w-full`}>
              <option value="all">{language === 'ar' ? 'كل الورديات' : 'All Shifts'}</option>
              {shifts.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 mb-1">{language === 'ar' ? 'المنتج الحراري' : 'Product'}</span>
            <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} className={`${DASHBOARD_FILTER_SELECT} w-full`}>
              <option value="all">{language === 'ar' ? 'كل المنتجات' : 'All Products'}</option>
              {products.map(pr => (
                <option key={pr.id} value={pr.id}>{pr.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-bold text-slate-400 mb-1">{language === 'ar' ? 'العميل' : 'Customer'}</span>
            <select id="production-records-customer-filter" value={filterCustomer} onChange={(e) => setFilterCustomer(e.target.value)} className={`${DASHBOARD_FILTER_SELECT} w-full`}>
              <option value="all">{language === 'ar' ? 'كل العملاء' : 'All Customers'}</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="block text-[11px] font-bold text-slate-400 mb-1">{language === 'ar' ? 'بحث' : 'Search'}</span>
            <span className="relative block">
              <span className="absolute inset-y-0 start-0 ps-2.5 flex items-center pointer-events-none text-slate-400">
                <Search className="w-3.5 h-3.5" />
              </span>
              <input
                id="records-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={language === 'ar' ? 'البحث بالمنتج، الكود، المكبس، العميل، أو العامل...' : 'Search by product, code, press, customer, or employee...'}
                className={`${DASHBOARD_FILTER_SELECT} w-full ps-8 placeholder:text-slate-500 placeholder:font-semibold`}
              />
            </span>
          </label>
        </div>
      </div>

      {/* Aggregate KPI Strip for Filtered Results */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'إجمالي الإنتاج' : 'Total Production'}</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-slate-900">
              {formatNumber(totalProductionQuantity)}
            </span>
            <span className="text-xs text-slate-500">{language === 'ar' ? 'قطعة' : 'pcs'}</span>
          </div>
          <span className="text-[10px] text-emerald-600 font-semibold mt-0.5 block">
            {language === 'ar' ? `سليم: ${formatNumber(totalGoodQuantity)} قطعة` : `Good: ${formatNumber(totalGoodQuantity)} pcs`}
          </span>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'إجمالي الوزن المحسوب' : 'Total Calculated Weight'}</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-slate-900">
              {formatDecimal(totalProductionWeightKg / 1000, 2)}
            </span>
            <span className="text-xs text-slate-500">{language === 'ar' ? 'طن' : 't'}</span>
          </div>
          <span className="text-[10px] text-slate-400 font-semibold mt-0.5 block">
            ({formatNumber(totalProductionWeightKg)} {language === 'ar' ? 'كجم' : 'kg'})
          </span>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'متوسط نسبة الهالك' : 'Average Waste Rate'}</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className={`text-xl font-extrabold ${averageWastePercentage > 5 ? 'text-rose-600' : 'text-amber-600'}`}>
              {formatDecimal(averageWastePercentage, 2)}%
            </span>
          </div>
          <span className="text-[10px] text-rose-600 font-semibold mt-0.5 block">
            {language === 'ar' ? `هالك: ${formatNumber(totalWasteQuantity)} قطعة` : `Waste: ${formatNumber(totalWasteQuantity)} pcs`}
          </span>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">{language === 'ar' ? 'إجمالي وقت التوقف والأعطال' : 'Total Downtime & Fault Hours'}</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-slate-900">
              {(totalDowntimeMinutes / 60).toFixed(1)}
            </span>
            <span className="text-xs text-slate-500">{language === 'ar' ? 'ساعة' : 'hr'}</span>
          </div>
          <span className="text-[10px] text-slate-500 font-semibold mt-0.5 block">
            ({totalDowntimeMinutes} {language === 'ar' ? 'دقيقة' : 'min'})
          </span>
        </div>
      </div>

      {/* Production Records Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
            <p className="text-xs font-semibold">{language === 'ar' ? 'جارٍ تحميل سجلات الإنتاج من Firestore...' : 'Loading production records from Firestore...'}</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">{language === 'ar' ? 'لا توجد سجلات مطابقة للشروط المحددة' : 'No records match the selected criteria'}</p>
            <p className="text-xs text-slate-400 mt-1">
              {language === 'ar' ? 'يمكنك الضغط على زر "تسجيل إنتاج جديد" لإضافة أول تشغيلة.' : 'Click "New Production Entry" to add your first record.'}
            </p>
          </div>
        ) : (
          <>
          {/*
            Selection summary and controls, and the one bulk action: Delete
            Selected. It is rendered only for a user holding production.delete
            and only while something is selected, and it opens a confirmation -
            it deletes nothing by itself.
          */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap text-xs">
            <span className="font-bold text-slate-600">
              {language === 'ar' ? 'الظاهر' : 'Visible'}: <span className="text-slate-900">{visibleIds.length}</span>
            </span>
            <span className="font-bold text-slate-600">
              {language === 'ar' ? 'المحدد' : 'Selected'}:{' '}
              <span id="production-records-selected-count" className="text-sky-700">{selectionCount(selection)}</span>
            </span>
            <button
              type="button"
              onClick={() => setSelection(selectAllVisible(selection, visibleIds))}
              disabled={visibleIds.length === 0}
              className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              {language === 'ar' ? 'تحديد الكل' : 'Select all visible'}
            </button>
            <button
              type="button"
              onClick={() => setSelection(deselectAll())}
              disabled={selectionCount(selection) === 0}
              className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء تحديد الكل' : 'Deselect all'}
            </button>
            {canDeleteRecords && bulkDeleteCount > 0 && (
              <button
                id="production-records-bulk-delete-btn"
                type="button"
                onClick={openBulkDelete}
                disabled={!!bulkDeleteProgress}
                className="ms-auto flex items-center gap-1.5 px-3 py-1.5 font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {language === 'ar' ? <>حذف السجلات المحددة ({bulkDeleteCount})</> : <>Delete Selected Records ({bulkDeleteCount})</>}
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="px-4 py-3.5 w-10">
                    <input
                      id="production-records-select-all"
                      type="checkbox"
                      className="w-4 h-4 accent-sky-600 cursor-pointer align-middle"
                      aria-label={language === 'ar' ? 'تحديد كل السجلات الظاهرة' : 'Select all visible records'}
                      checked={areAllVisibleSelected(selection, visibleIds)}
                      onChange={(e) =>
                        setSelection(e.target.checked ? selectAllVisible(selection, visibleIds) : deselectAll())
                      }
                    />
                  </th>
                  <th className="px-4 py-3.5">{language === 'ar' ? 'التاريخ والوردية' : 'Date & Shift'}</th>
                  <th className="px-4 py-3.5">{language === 'ar' ? 'المكبس / الفرن' : 'Press / Furnace'}</th>
                  <th className="px-4 py-3.5">{language === 'ar' ? 'المنتج والمواصفة' : 'Product & Specification'}</th>
                  <th className="px-4 py-3.5">{language === 'ar' ? 'فريق التشغيل' : 'Operating Team'}</th>
                  <th className="px-4 py-3.5">{language === 'ar' ? 'الكمية (إجمالي / سليم)' : 'Quantity (Total / Good)'}</th>
                  <th className="px-4 py-3.5">{language === 'ar' ? 'الهالك (%)' : 'Waste (%)'}</th>
                  <th className="px-4 py-3.5">{language === 'ar' ? 'إجمالي الوزن' : 'Total Weight'}</th>
                  <th className="px-4 py-3.5">{language === 'ar' ? 'التوقف' : 'Downtime'}</th>
                  <th className="px-4 py-3.5 text-center">{language === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                    {/*
                      Selection only. This checkbox never opens, edits, approves
                      or deletes anything - the row's own actions in the
                      الإجراءات column remain the only way to do that.
                    */}
                    <td className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-sky-600 cursor-pointer align-middle disabled:opacity-40"
                        aria-label={language === 'ar' ? 'تحديد السجل' : 'Select record'}
                        disabled={!rec.id}
                        checked={rec.id ? isSelected(selection, rec.id) : false}
                        onChange={() => { if (rec.id) setSelection(toggleRow(selection, rec.id)); }}
                      />
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 font-mono">{rec.date}</div>
                      <div className="text-[11px] text-slate-500">{rec.shiftName}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">{rec.pressName}</div>
                      {rec.furnaceName && (
                        <div className="text-[11px] text-slate-500">{rec.furnaceName}</div>
                      )}
                      {rec.furnaceCarNumbers && rec.furnaceCarNumbers.length > 0 && (
                        <div className="text-[10px] text-amber-700 font-mono">
                          {language === 'ar' ? 'عربات: ' : 'Cars: '}{rec.furnaceCarNumbers.join(', ')}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{rec.productName}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.2 rounded font-mono">
                          {rec.aluminaPercentage}% {language === 'ar' ? 'ألومينا' : 'Alumina'}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {rec.pieceWeight} {language === 'ar' ? 'كجم' : 'kg'}
                        </span>
                      </div>
                      {rec.customerName && (
                        <div className="text-[11px] text-sky-700 font-semibold mt-0.5">
                          {language === 'ar' ? 'عميل: ' : 'Customer: '}{rec.customerName}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {rec.employeeNames && rec.employeeNames.length > 0 ? (
                        <div className="space-y-0.5">
                          {rec.employeeNames.map((name, i) => (
                            <span key={i} className="inline-block bg-slate-100 px-2 py-0.5 rounded text-[10px] font-semibold text-slate-700 mr-1 mb-1">
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-extrabold text-slate-900">
                        {formatNumber(rec.productionQuantity)}
                      </div>
                      <div className="text-[11px] text-emerald-600 font-semibold">
                        {language === 'ar' ? `سليم: ${formatNumber(rec.goodQuantity)}` : `Good: ${formatNumber(rec.goodQuantity)}`}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className={`font-bold ${rec.wastePercentage > 5 ? 'text-rose-600' : 'text-amber-600'}`}>
                        {formatDecimal(rec.wastePercentage, 2)}%
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {formatNumber(rec.wasteQuantity)} {language === 'ar' ? 'قطعة' : 'pcs'}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {(() => {
                        const pWeight = rec.pieceWeightKg ?? rec.pieceWeight ?? null;
                        const hasWeight = pWeight !== null && !isNaN(pWeight) && Number(pWeight) > 0;
                        const prodTons = rec.productionTons !== undefined && rec.productionTons !== null && Number(rec.productionTons) > 0
                          ? Number(rec.productionTons)
                          : (hasWeight ? (Number(rec.productionQuantity || 0) * Number(pWeight)) / 1000 : null);

                        if (prodTons !== null) {
                          return (
                            <>
                              <div className="font-extrabold text-slate-900">
                                {formatDecimal(prodTons, 3)} {language === 'ar' ? 'طن' : 't'}
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {formatNumber(rec.productionWeight || prodTons * 1000)} {language === 'ar' ? 'كجم' : 'kg'}
                              </div>
                            </>
                          );
                        }
                        return (
                          <div className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-[11px] font-bold border border-amber-200 inline-block">
                            {language === 'ar' ? 'غير محسوب' : 'Not Calculated'}
                            <div className="text-[9px] font-normal text-amber-600">{language === 'ar' ? 'وزن القطعة غير متوفر' : 'Piece weight not available'}</div>
                          </div>
                        );
                      })()}
                    </td>

                    <td className="px-4 py-3 font-mono">
                      {rec.totalDowntimeMinutes > 0 ? (
                        <span className="text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded">
                          {rec.totalDowntimeMinutes} {language === 'ar' ? 'د' : 'min'}
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-semibold">0 {language === 'ar' ? 'د' : 'min'}</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(rec)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          title={language === 'ar' ? 'تعديل' : 'Edit'}
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmRecord(rec)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title={language === 'ar' ? 'حذف' : 'Delete'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* Edit Record Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title={language === 'ar' ? 'تعديل سجل الإنتاج' : 'Edit Production Record'}
        subtitle={language === 'ar' ? 'يتم تحديث وإعادة حساب الأوزان ونسب الهالك تلقائياً في Firestore' : 'Weights and waste rates are automatically recalculated and updated in Firestore'}
        maxWidth="lg"
      >
        {editingRecord && (
          <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{language === 'ar' ? 'تاريخ الإنتاج' : 'Production Date'}</label>
                <input
                  type="date"
                  required
                  value={editingRecord.date || ''}
                  onChange={(e) => setEditingRecord({ ...editingRecord, date: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">{language === 'ar' ? 'وزن القطعة (كجم)' : 'Piece Weight (kg)'}</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editingRecord.pieceWeight ?? 4.5}
                  onChange={(e) => setEditingRecord({ ...editingRecord, pieceWeight: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{language === 'ar' ? 'إجمالي كمية الإنتاج (قطع)' : 'Total Production Quantity (pcs)'}</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={editingRecord.productionQuantity ?? 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, productionQuantity: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">{language === 'ar' ? 'كمية الهالك (قطع)' : 'Waste Quantity (pcs)'}</label>
                <input
                  type="number"
                  required
                  min="0"
                  value={editingRecord.wasteQuantity ?? 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, wasteQuantity: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-rose-600"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">{language === 'ar' ? 'ملاحظات التشغيل' : 'Operation Notes'}</label>
              <input
                type="text"
                value={editingRecord.notes || ''}
                onChange={(e) => setEditingRecord({ ...editingRecord, notes: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-xs flex items-center gap-1.5"
              >
                {isUpdating ? (language === 'ar' ? 'جارٍ الحفظ...' : 'Saving...') : (language === 'ar' ? 'حفظ التعديلات' : 'Save Changes')}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Record Confirmation Modal */}
      <Modal
        isOpen={!!deleteConfirmRecord}
        onClose={() => setDeleteConfirmRecord(null)}
        title={language === 'ar' ? 'تأكيد حذف سجل الإنتاج' : 'Confirm Production Record Deletion'}
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            {language === 'ar' ? (
              <>هل أنت متأكد من رغبتك في حذف سجل تشغيلة بتاريخ <span className="font-bold text-slate-900">{deleteConfirmRecord?.date}</span> لمنتج <span className="font-bold text-slate-900">{deleteConfirmRecord?.productName}</span>؟</>
            ) : (
              <>Are you sure you want to delete the record dated <span className="font-bold text-slate-900">{deleteConfirmRecord?.date}</span> for product <span className="font-bold text-slate-900">{deleteConfirmRecord?.productName}</span>?</>
            )}
          </p>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeleteConfirmRecord(null)}
              className="px-3.5 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              id="confirm-delete-record-btn"
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs cursor-pointer"
            >
              {language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete'}
            </button>
          </div>
        </div>
      </Modal>

      {/*
        Bulk delete confirmation. The count is the frozen plan's length - the
        exact batch that will run. Permanent: there is no undo or restore.
      */}
      <Modal
        isOpen={!!bulkDeletePlan}
        onClose={() => { if (!bulkDeleteProgress) setBulkDeletePlan(null); }}
        title={language === 'ar' ? 'تأكيد حذف السجلات المحددة' : 'Confirm Delete Selected Records'}
        maxWidth="md"
      >
        {bulkDeletePlan && (
          <div id="production-records-bulk-delete-confirm" className="space-y-4 text-xs">
            <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-rose-900 font-bold leading-relaxed">
                {language === 'ar'
                  ? `سيتم حذف ${bulkDeletePlan.targetIds.length} سجل من سجلات الإنتاج نهائيًا. هذا الإجراء لا يمكن التراجع عنه من خلال النظام الحالي. هل تريد المتابعة؟`
                  : `${bulkDeletePlan.targetIds.length} production records will be permanently deleted. This action cannot be undone through the current system. Continue?`}
              </p>
            </div>
            <p className="text-[11px] text-slate-500" dir="ltr">
              {`${bulkDeletePlan.targetIds.length} production records will be permanently deleted. This action cannot be undone through the current system. Continue?`}
            </p>
            {bulkDeleteProgress && (
              <p className="font-bold text-slate-700">
                {language === 'ar' ? 'جارٍ الحذف' : 'Deleting'}: {bulkDeleteProgress.done} / {bulkDeleteProgress.total}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBulkDeletePlan(null)}
                disabled={!!bulkDeleteProgress}
                className="px-3.5 py-2 font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50 rounded-xl cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                id="production-records-bulk-delete-confirm-btn"
                type="button"
                onClick={handleConfirmBulkDelete}
                disabled={!!bulkDeleteProgress}
                className="px-4 py-2 font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl shadow-xs cursor-pointer"
              >
                {bulkDeleteProgress ? (language === 'ar' ? 'جارٍ الحذف...' : 'Deleting...') : (language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete')}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk delete summary - what actually happened, record by record. */}
      <Modal
        isOpen={!!bulkDeleteOutcome}
        onClose={() => setBulkDeleteOutcome(null)}
        title={language === 'ar' ? 'نتيجة حذف السجلات المحددة' : 'Delete Selected Records - Result'}
        maxWidth="md"
      >
        {bulkDeleteOutcome && (
          <div id="production-records-bulk-delete-summary" className="space-y-3 text-xs">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-xl px-3 py-2 bg-emerald-50 border border-emerald-200 text-emerald-800">
                <p className="text-[10px] font-bold">{language === 'ar' ? 'تم الحذف بنجاح' : 'Successfully Deleted'}</p>
                <p className="text-lg font-black">{bulkDeleteOutcome.successCount}</p>
              </div>
              <div className="rounded-xl px-3 py-2 bg-rose-50 border border-rose-200 text-rose-800">
                <p className="text-[10px] font-bold">{language === 'ar' ? 'فشل' : 'Failed'}</p>
                <p className="text-lg font-black">{bulkDeleteOutcome.failedCount}</p>
              </div>
              <div className="rounded-xl px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800">
                <p className="text-[10px] font-bold">{language === 'ar' ? 'تم تخطيه (محذوف مسبقًا)' : 'Skipped (already removed)'}</p>
                <p className="text-lg font-black">{bulkDeleteOutcome.skippedCount}</p>
              </div>
              <div className="rounded-xl px-3 py-2 bg-slate-100 text-slate-800">
                <p className="text-[10px] font-bold">{language === 'ar' ? 'المحدد' : 'Selected'}</p>
                <p className="text-lg font-black">{bulkDeleteOutcome.selectedCount}</p>
              </div>
            </div>
            {bulkDeleteOutcome.failed.length > 0 && (
              <div className="space-y-1">
                <p className="font-bold text-rose-800">
                  {language === 'ar' ? 'السجلات التي فشل حذفها ما زالت موجودة ومحددة في الجدول - يمكنك إعادة المحاولة:' : 'Records that failed to delete still exist and stay selected in the table - you can retry:'}
                </p>
                <ul className="max-h-40 overflow-y-auto space-y-0.5 font-mono text-[11px] text-slate-700">
                  {bulkDeleteOutcome.failed.map((f) => (
                    <li key={f.id} title={f.error}>{f.id}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={() => setBulkDeleteOutcome(null)}
                className="px-4 py-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                {language === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

/**
 * Production Records Management View
 * Features comprehensive filtering (Date, Shift, Press, Product, Customer),
 * real-time aggregate KPI metrics, single record editing, deletion, and Excel export.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  FileText, 
  Search, 
  Filter, 
  Download, 
  Plus, 
  Edit, 
  Trash2, 
  Calendar, 
  Clock, 
  Cpu, 
  Box, 
  Users, 
  RefreshCw, 
  AlertCircle, 
  TrendingDown, 
  TrendingUp, 
  CheckCircle2, 
  X,
  Layers
} from 'lucide-react';
import { ProductionRecord, Shift, Press, Furnace, Product, Customer, NavigationPage } from '../../types';
import { subscribeProductionRecords, updateProductionRecord, deleteProductionRecord } from '../../services/productionService';
import { fetchMasterData } from '../../services/masterDataService';
/*
 * Category -> code filtering. Both modules are already in production: the
 * registry declares which record field each category maps to, and the engine
 * turns a selection into a filter. This screen reuses them rather than deciding
 * for itself what "Production Centers" means - which is how two screens end up
 * quietly disagreeing about a total.
 */
import {
  MasterDataCategory,
  legacyProductionCategories,
  legacyCodeSourceCategories,
  normaliseSelection,
} from '../../services/masterDataCategoryRegistry';
import {
  asNodeSelection,
  filterLegacyProductionRecords,
} from '../../services/productionFilterEnginePure';
/*
 * The hierarchy nodes, read through the EXISTING cache-first reader. Selecting
 * a node resolves through the equipment link, so a production record is reached
 * as: record -> pressId/furnaceId -> equipment -> hierarchyNodeId -> ancestors.
 */
import { listCostCenterHierarchyNodes, CostCenterHierarchyRecord } from '../../services/costCenterHierarchyService';
import { buildHierarchyIndex, getNodePath, buildEquipmentByNode } from '../../services/hierarchyResolverPure';
/*
 * Multi-level drill-down state. The selector owns WHAT the user picked; every
 * question about the tree is answered by the shared resolver, so there is still
 * exactly one traversal in the system.
 */
import {
  EMPTY_HIERARCHY_SELECTION,
  levelOptions,
  toggleAtLevel,
  selectAllAtLevel,
  clearLevel,
  clearSelection,
  effectiveLevel,
  equipmentUnderSelection,
  toggleEquipment,
  selectAllEquipment,
  deselectAllEquipment,
  resolveSelectedEquipment,
  selectionLabels,
} from '../../services/hierarchySelectorPure';
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
/*
 * Row selection reuses the SAME primitives the Data Review screen already uses -
 * there is one selection architecture in this codebase, not two. These are pure
 * functions over an id list: no Firestore, no writes, no reads.
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
import { exportProductionRecordsToExcel } from '../../services/exportService';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { formatNumber, formatDecimal } from '../../utils/formatters';

interface ProductionRecordsViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const ProductionRecordsView: React.FC<ProductionRecordsViewProps> = ({ onNavigate }) => {
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filter Master Lists
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [presses, setPresses] = useState<Press[]>([]);
  const [furnaces, setFurnaces] = useState<Furnace[]>([]);
  const [hierarchyNodes, setHierarchyNodes] = useState<CostCenterHierarchyRecord[]>([]);
  /** Where the user has drilled to, and what they ticked. Depth is whatever the data has. */
  const [hierarchySelection, setHierarchySelection] = useState(EMPTY_HIERARCHY_SELECTION);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Filter Values
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterShift, setFilterShift] = useState<string>('all');
  /*
   * Category -> code filter, replacing the press-only selector.
   *
   * ONE / MULTIPLE / ALL are not three separate controls: an empty code list IS
   * ALL, exactly as normaliseSelection already defines it everywhere else. So
   * ALL stays a mode and never materialises every code into an array.
   */
  const [filterCategoryId, setFilterCategoryId] = useState<string>('productionCenters');
  const [filterCodes, setFilterCodes] = useState<string[]>([]);
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
   * This is the selection FOUNDATION only. Nothing acts on it yet: there is no
   * bulk action here, and deliberately no bulk delete - see the note above the
   * selection toolbar.
   */
  const [selection, setSelection] = useState(EMPTY_SELECTION_STATE);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

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
      }
    );

    fetchMasterData<Shift>('shifts').then(setShifts).catch(() => {});
    fetchMasterData<Press>('presses').then(setPresses).catch(() => {});
    fetchMasterData<Furnace>('furnaces').then(setFurnaces).catch(() => {});
    listCostCenterHierarchyNodes()
      .then(setHierarchyNodes)
      .catch(() => { /* an unavailable hierarchy only costs the node options */ });
    fetchMasterData<Product>('products').then(setProducts).catch(() => {});
    fetchMasterData<Customer>('customers').then(setCustomers).catch(() => {});

    return () => unsubscribe();
  }, []);

  /** Which categories can actually filter THIS screen - declared on the registry, never hard-coded here. */
  const codeCategories = useMemo<MasterDataCategory[]>(() => legacyProductionCategories(), []);

  /** The loaded Master Data, keyed by the category that owns it. */
  const masterDataByCategory = useMemo<Record<string, Array<{ id?: string; code?: string; name?: string }>>>(
    () => ({ presses, furnaces, products, customers, shifts }),
    [presses, furnaces, products, customers, shifts],
  );

  /** The node graph, built once through the shared resolver. */
  const hierarchyIndex = useMemo(
    () =>
      buildHierarchyIndex(
        hierarchyNodes.map((node) => ({
          ...node,
          id: node.id,
          code: node.sheet1Code,
          parentId: node.parentSheet1Code,
        })),
      ),
    [hierarchyNodes],
  );

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

  /*
   * The codes offered for the selected category.
   *
   * Read from the Master Data this screen already loaded, so a newly imported or
   * edited code appears as soon as that cache refreshes - nothing about the list
   * is hard-coded in this component, and no extra Firestore read is issued to
   * build it. A category may draw on more than one collection (production
   * centres are presses AND furnaces), which is why the sources come from the
   * registry rather than from a switch here.
   */
  const availableCodes = useMemo(() => {
    const out: Array<{ value: string; label: string; source: string }> = [];
    const seen = new Set<string>();

    /*
     * Hierarchy nodes come FIRST for equipment categories, because selecting a
     * node is what gives the aggregate meaning: choosing "Presses" includes
     * every descendant node's linked equipment, so the user never has to pick
     * the individual machines. Each option is labelled with its full path and
     * carries the node's stable id, never its display text.
     */
    if (filterCategoryId === 'productionCenters' && hierarchyNodes.length > 0) {
      for (const node of hierarchyNodes) {
        const value = asNodeSelection(node.id);
        if (seen.has(value)) continue;
        seen.add(value);
        const path = getNodePath(hierarchyIndex, node.id, (x: any) => x.name || x.sheet1Code, ' ← ');
        out.push({
          value,
          label: `${path || node.name || node.sheet1Code}`,
          source: 'hierarchy',
        });
      }
    }

    /*
     * Then the equipment itself. Equipment already reachable through a node is
     * still listed so it can be picked directly, and equipment with NO link is
     * listed because a node selection can never reach it - that is the
     * backward-compatible path for records that predate the hierarchy.
     */
    for (const source of legacyCodeSourceCategories(filterCategoryId)) {
      for (const item of masterDataByCategory[source.id] ?? []) {
        const value = String(item.id ?? '');
        if (!value || seen.has(value)) continue;
        seen.add(value);
        const unlinked = filterCategoryId === 'productionCenters' && !(item as any).hierarchyNodeId;
        out.push({
          value,
          label: unlinked ? `${item.name || item.code || value} — غير مرتبط` : (item.name || item.code || value),
          source: source.labelAr,
        });
      }
    }
    return out;
  }, [filterCategoryId, masterDataByCategory, hierarchyNodes, hierarchyIndex, equipmentLinks]);

  /** node id -> equipment linked to it, built once. */
  const equipmentByNode = useMemo(() => buildEquipmentByNode(equipmentLinks), [equipmentLinks]);

  /** One entry per level to draw: roots, then the chosen node's children, and so on. */
  const hierarchyLevels = useMemo(
    () => levelOptions(hierarchyIndex, hierarchySelection),
    [hierarchyIndex, hierarchySelection],
  );

  /** The equipment hanging below the branch currently drilled into. */
  const branchEquipment = useMemo(
    () => equipmentUnderSelection(hierarchyIndex, equipmentByNode, hierarchySelection),
    [hierarchyIndex, equipmentByNode, hierarchySelection],
  );

  /** Readable labels for whatever is in play. From the data, never a constant. */
  const hierarchyCrumbs = useMemo(
    () => selectionLabels(hierarchyIndex, hierarchySelection, (x: any) => x.name || x.sheet1Code || x.id),
    [hierarchyIndex, hierarchySelection],
  );

  /**
   * What the hierarchy drill-down actually filters on.
   *
   * null when nothing is drilled into, so the screen keeps its existing
   * behaviour untouched. Otherwise: the whole branch, or exactly what was
   * ticked - the shared rule, decided in one place.
   */
  const hierarchyEquipmentIds = useMemo(
    () => resolveSelectedEquipment(hierarchyIndex, equipmentByNode, hierarchySelection),
    [hierarchyIndex, equipmentByNode, hierarchySelection],
  );

  const equipmentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of [...presses, ...furnaces]) {
      if (e.id) map.set(String(e.id), e.name || e.code || String(e.id));
    }
    return map;
  }, [presses, furnaces]);

  /** Empty codes = ALL. One = ONE. Several = MULTIPLE. The shared semantics, unchanged. */
  const codeSelection = useMemo(
    () => normaliseSelection(filterCategoryId, filterCodes, filterCodes.length === 0),
    [filterCategoryId, filterCodes],
  );

  // Filter logic
  const filteredRecords = filterLegacyProductionRecords(records.filter((rec) => {
    if (filterShift !== 'all' && rec.shiftId !== filterShift) return false;
    if (filterProduct !== 'all' && rec.productId !== filterProduct) return false;
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
  }).filter((rec) => {
    /*
     * The hierarchy drill-down, applied as one more AND beside date, shift,
     * product and search. null means nothing was drilled into, so this is the
     * identity case and the screen behaves exactly as before.
     *
     * Matches on the record's OWN equipment fields - a job belongs to the branch
     * whether it names the press or the furnace - and each record is tested
     * once, so it can never be emitted twice.
     */
    if (hierarchyEquipmentIds == null) return true;
    const wanted = new Set(hierarchyEquipmentIds);
    return [rec.pressId, rec.furnaceId].some((v) => v != null && wanted.has(String(v)));
  }), codeSelection, { index: hierarchyIndex }, { equipment: equipmentLinks });

  /*
   * The ids actually on screen right now.
   *
   * Derived from the SAME `filteredRecords` the table renders, so "select all
   * visible" can never mean more than what the user can see - no extra fetch and
   * no extra Firestore read. `filteredRecords` is rebuilt on every render, so the
   * list is memoised on the id sequence itself; otherwise the pruning effect
   * below would see a new array identity every render and loop.
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
      alert(err.message || 'حدث خطأ أثناء تعديل السجل.');
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

  const handleExport = () => {
    exportProductionRecordsToExcel(filteredRecords, `سجلات_إنتاج_عصفور_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterShift('all');
    setFilterCodes([]);
    setHierarchySelection(clearSelection());
    setFilterProduct('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="space-y-6">
      {/* Top Filter & Control Panel */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              id="records-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث بالمنتج، الكود، المكبس، العميل، أو العامل..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-4 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:bg-white transition-colors"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              id="export-records-btn"
              type="button"
              onClick={handleExport}
              disabled={filteredRecords.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير إلى Excel</span>
            </button>

            <button
              id="new-production-entry-btn"
              type="button"
              onClick={() => onNavigate('production-entry')}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>تسجيل إنتاج جديد</span>
            </button>
          </div>
        </div>

        {/* Dropdown Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100 text-xs">
          {/* Shift */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">الوردية</label>
            <select
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-700"
            >
              <option value="all">كل الورديات</option>
              {shifts.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/*
            Multi-level production-centre drill-down.

            Level 1 is the hierarchy's real roots; every later level is exactly
            the chosen node's children. Levels are drawn from the data, so the
            depth is whatever the hierarchy has and no centre name appears here.

            Stopping at any level means the whole branch below it; ticking
            equipment narrows to exactly what is ticked.
          */}
          {hierarchyLevels.length > 0 && hierarchyIndex.size > 0 && (
            <div className="col-span-2 sm:col-span-3 md:col-span-6 border-t border-slate-100 pt-2 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold text-slate-500">المراكز الإنتاجية</span>
                {hierarchyCrumbs.length > 0 && (
                  <span id="production-records-hierarchy-path" className="text-[11px] font-bold text-sky-700">
                    {hierarchyCrumbs.join(' + ')}
                  </span>
                )}
                {effectiveLevel(hierarchySelection) > 0 && (
                  <button
                    type="button"
                    onClick={() => setHierarchySelection(clearSelection())}
                    className="px-2 py-1 text-[11px] font-bold text-amber-700 hover:text-amber-900 cursor-pointer"
                  >
                    مسح الاختيار
                  </button>
                )}
              </div>

              {/*
                One checkbox column per level. Level 1 is the hierarchy's roots;
                every later level is the union of the children of whatever is
                ticked above it, so ticking two sibling branches shows both
                branches' children and nothing else.

                Ticking deeper NARROWS - which is also why a parent and its own
                child can never double-count.
              */}
              <div className="flex flex-wrap gap-3 items-start">
                {hierarchyLevels.map((lvl) => (
                  <div
                    key={lvl.level}
                    id={`production-records-hierarchy-level-${lvl.level}`}
                    className="min-w-[160px] max-w-[240px] border border-slate-200 rounded-xl p-2 bg-slate-50/60"
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[10px] font-black text-slate-600">{`المستوى ${lvl.level}`}</span>
                      <span className="text-[10px] font-bold text-sky-700">{`المحدد: ${lvl.selectedIds.length}`}</span>
                    </div>
                    <div className="flex gap-1 mb-1">
                      <button
                        type="button"
                        onClick={() => setHierarchySelection(selectAllAtLevel(hierarchyIndex, hierarchySelection, lvl.level))}
                        className="px-1.5 py-0.5 text-[10px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                      >
                        تحديد الكل
                      </button>
                      <button
                        type="button"
                        onClick={() => setHierarchySelection(clearLevel(hierarchyIndex, hierarchySelection, lvl.level))}
                        disabled={lvl.selectedIds.length === 0}
                        className="px-1.5 py-0.5 text-[10px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded cursor-pointer"
                      >
                        مسح
                      </button>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-0.5">
                      {lvl.optionIds.map((id) => {
                        const node: any = hierarchyIndex.byId.get(id);
                        return (
                          <label key={id} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer">
                            <input
                              type="checkbox"
                              className="w-3.5 h-3.5 accent-sky-600 cursor-pointer shrink-0"
                              checked={lvl.selectedIds.includes(id)}
                              onChange={() => setHierarchySelection(toggleAtLevel(hierarchyIndex, hierarchySelection, lvl.level, id))}
                            />
                            <span className="truncate" title={node?.name || node?.sheet1Code || id}>
                              {node?.name || node?.sheet1Code || id}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Equipment for whatever is in play. A leaf IS its equipment. */}
              {effectiveLevel(hierarchySelection) > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap text-[11px]">
                    <span className="font-bold text-slate-500">
                      المعدات ({branchEquipment.length}) — المحدد: <span className="text-sky-700">{hierarchySelection.equipmentIds.length}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setHierarchySelection(selectAllEquipment(hierarchyIndex, equipmentByNode, hierarchySelection))}
                      disabled={branchEquipment.length === 0}
                      className="px-2 py-1 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
                    >
                      تحديد الكل
                    </button>
                    <button
                      type="button"
                      onClick={() => setHierarchySelection(deselectAllEquipment(hierarchySelection))}
                      disabled={hierarchySelection.equipmentIds.length === 0}
                      className="px-2 py-1 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
                    >
                      إلغاء تحديد الكل
                    </button>
                    {hierarchySelection.equipmentIds.length === 0 && branchEquipment.length > 0 && (
                      <span className="text-slate-400">بدون تحديد = كل معدات هذا الفرع</span>
                    )}
                  </div>
                  {branchEquipment.length === 0 ? (
                    <p className="text-[11px] text-amber-700 font-bold">
                      لا توجد معدة مرتبطة بالاختيار الحالي - لا بالعقدة نفسها ولا بأي فرع تابع لها. يمكن ربط المعدة من البيانات الأساسية أو بمطابقة الكود.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 max-h-28 overflow-y-auto">
                      {branchEquipment.map((id) => (
                        <label key={id} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            className="w-3.5 h-3.5 accent-sky-600 cursor-pointer"
                            checked={hierarchySelection.equipmentIds.includes(id)}
                            onChange={() => setHierarchySelection(toggleEquipment(hierarchySelection, id))}
                          />
                          <span>{equipmentNameById.get(id) || id}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/*
            Code Type -> Codes, replacing the press-only selector.

            The category list and each category's code list both come from the
            shared registry and the already-loaded Master Data, so adding a
            category or a code never means editing this component.
          */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">نوع الأكواد</label>
            <select
              id="production-records-code-category"
              value={filterCategoryId}
              onChange={(e) => { setFilterCategoryId(e.target.value); setFilterCodes([]); }}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-700"
            >
              {codeCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.labelAr}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">
              الأكواد
              <span className="font-normal text-slate-400">
                {' '}({filterCodes.length === 0
                  ? 'كل الأكواد'
                  : filterCodes.length === 1
                  ? 'كود واحد'
                  : `عدة أكواد: ${filterCodes.length}`})
              </span>
            </label>
            <select
              id="production-records-codes"
              multiple
              size={3}
              value={filterCodes}
              onChange={(e) =>
                setFilterCodes(Array.from(e.target.selectedOptions, (o) => o.value))
              }
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-700"
              title="اترك الاختيار فارغًا ليعني كل الأكواد. اختر كودًا واحدًا أو عدة أكواد للتضييق."
            >
              {availableCodes.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          {/* Product */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">المنتج الحراري</label>
            <select
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-700"
            >
              <option value="all">كل المنتجات</option>
              {products.map(pr => (
                <option key={pr.id} value={pr.id}>{pr.name}</option>
              ))}
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">من تاريخ</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-slate-700"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-slate-700"
            />
          </div>
        </div>

        {/* Clear filter shortcut */}
        {(searchQuery || filterShift !== 'all' || filterCodes.length > 0 || effectiveLevel(hierarchySelection) > 0 || filterProduct !== 'all' || startDate || endDate) && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-amber-700 hover:text-amber-900 font-bold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>إعادة ضبط وتفريغ الفلاتر</span>
            </button>
          </div>
        )}
      </div>

      {/* Aggregate KPI Strip for Filtered Results */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">إجمالي الإنتاج المكبوس</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-slate-900">
              {formatNumber(totalProductionQuantity)}
            </span>
            <span className="text-xs text-slate-500">قطعة</span>
          </div>
          <span className="text-[10px] text-emerald-600 font-semibold mt-0.5 block">
            سليم: {formatNumber(totalGoodQuantity)} قطعة
          </span>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">إجمالي الوزن المحسوب</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-slate-900">
              {formatDecimal(totalProductionWeightKg / 1000, 2)}
            </span>
            <span className="text-xs text-slate-500">طن</span>
          </div>
          <span className="text-[10px] text-slate-400 font-semibold mt-0.5 block">
            ({formatNumber(totalProductionWeightKg)} كجم)
          </span>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">متوسط نسبة الهالك</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className={`text-xl font-extrabold ${averageWastePercentage > 5 ? 'text-rose-600' : 'text-amber-600'}`}>
              {formatDecimal(averageWastePercentage, 2)}%
            </span>
          </div>
          <span className="text-[10px] text-rose-600 font-semibold mt-0.5 block">
            هالك: {formatNumber(totalWasteQuantity)} قطعة
          </span>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">إجمالي وقت التوقف (الأعطال)</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-slate-900">
              {(totalDowntimeMinutes / 60).toFixed(1)}
            </span>
            <span className="text-xs text-slate-500">ساعة</span>
          </div>
          <span className="text-[10px] text-slate-500 font-semibold mt-0.5 block">
            ({totalDowntimeMinutes} دقيقة)
          </span>
        </div>
      </div>

      {/* Production Records Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
            <p className="text-xs font-semibold">جارٍ تحميل سجلات الإنتاج من Firestore...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">لا توجد سجلات مطابقة للشروط المحددة</p>
            <p className="text-xs text-slate-400 mt-1">
              يمكنك الضغط على زر "تسجيل إنتاج جديد" لإضافة أول تشغيلة.
            </p>
          </div>
        ) : (
          <>
          {/*
            Selection summary and controls.

            There is deliberately NO bulk action here - this is the selection
            foundation only. In particular there is no bulk delete: deleting many
            production records at once is a separate, explicit decision that has
            not been taken.
          */}
          <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-3 flex-wrap text-xs">
            <span className="font-bold text-slate-600">
              الظاهر: <span className="text-slate-900">{visibleIds.length}</span>
            </span>
            <span className="font-bold text-slate-600">
              المحدد: <span id="production-records-selected-count" className="text-sky-700">{selectionCount(selection)}</span>
            </span>
            <button
              type="button"
              onClick={() => setSelection(selectAllVisible(selection, visibleIds))}
              disabled={visibleIds.length === 0}
              className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              تحديد الكل
            </button>
            <button
              type="button"
              onClick={() => setSelection(deselectAll())}
              disabled={selectionCount(selection) === 0}
              className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
            >
              إلغاء تحديد الكل
            </button>
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
                      aria-label="تحديد كل السجلات الظاهرة"
                      checked={areAllVisibleSelected(selection, visibleIds)}
                      onChange={(e) =>
                        setSelection(e.target.checked ? selectAllVisible(selection, visibleIds) : deselectAll())
                      }
                    />
                  </th>
                  <th className="px-4 py-3.5">التاريخ والوردية</th>
                  <th className="px-4 py-3.5">المكبس / الفرن</th>
                  <th className="px-4 py-3.5">المنتج والمواصفة</th>
                  <th className="px-4 py-3.5">فريق التشغيل</th>
                  <th className="px-4 py-3.5">الكمية (إجمالي / سليم)</th>
                  <th className="px-4 py-3.5">الهالك (%)</th>
                  <th className="px-4 py-3.5">إجمالي الوزن</th>
                  <th className="px-4 py-3.5">التوقف</th>
                  <th className="px-4 py-3.5 text-center">الإجراءات</th>
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
                        aria-label="تحديد السجل"
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
                          عربات: {rec.furnaceCarNumbers.join(', ')}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{rec.productName}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.2 rounded font-mono">
                          {rec.aluminaPercentage}% ألومينا
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {rec.pieceWeight} كجم
                        </span>
                      </div>
                      {rec.customerName && (
                        <div className="text-[11px] text-sky-700 font-semibold mt-0.5">
                          عميل: {rec.customerName}
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
                        سليم: {formatNumber(rec.goodQuantity)}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className={`font-bold ${rec.wastePercentage > 5 ? 'text-rose-600' : 'text-amber-600'}`}>
                        {formatDecimal(rec.wastePercentage, 2)}%
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {formatNumber(rec.wasteQuantity)} قطعة
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
                                {formatDecimal(prodTons, 3)} طن
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {formatNumber(rec.productionWeight || prodTons * 1000)} كجم
                              </div>
                            </>
                          );
                        }
                        return (
                          <div className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-[11px] font-bold border border-amber-200 inline-block">
                            غير محسوب
                            <div className="text-[9px] font-normal text-amber-600">وزن القطعة غير متوفر</div>
                          </div>
                        );
                      })()}
                    </td>

                    <td className="px-4 py-3 font-mono">
                      {rec.totalDowntimeMinutes > 0 ? (
                        <span className="text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded">
                          {rec.totalDowntimeMinutes} د
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-semibold">0 د</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(rec)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          title="تعديل"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmRecord(rec)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title="حذف"
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
        title="تعديل سجل الإنتاج"
        subtitle="يتم تحديث وإعادة حساب الأوزان ونسب الهالك تلقائياً في Firestore"
        maxWidth="lg"
      >
        {editingRecord && (
          <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">تاريخ الإنتاج</label>
                <input
                  type="date"
                  required
                  value={editingRecord.date || ''}
                  onChange={(e) => setEditingRecord({ ...editingRecord, date: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">وزن القطعة (كجم)</label>
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
                <label className="block font-bold text-slate-700 mb-1">إجمالي كمية الإنتاج (قطع)</label>
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
                <label className="block font-bold text-slate-700 mb-1">كمية الهالك (قطع)</label>
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
              <label className="block font-bold text-slate-700 mb-1">ملاحظات التشغيل</label>
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
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-xs flex items-center gap-1.5"
              >
                {isUpdating ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Record Confirmation Modal */}
      <Modal
        isOpen={!!deleteConfirmRecord}
        onClose={() => setDeleteConfirmRecord(null)}
        title="تأكيد حذف سجل الإنتاج"
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            هل أنت متأكد من رغبتك في حذف سجل تشغيلة بتاريخ <span className="font-bold text-slate-900">{deleteConfirmRecord?.date}</span> لمنتج <span className="font-bold text-slate-900">{deleteConfirmRecord?.productName}</span>؟
          </p>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeleteConfirmRecord(null)}
              className="px-3.5 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              id="confirm-delete-record-btn"
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs cursor-pointer"
            >
              تأكيد الحذف
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

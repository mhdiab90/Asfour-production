/**
 * Master Data Management View
 * Manages Master Data entities:
 * Products, Product Types (Prefixes), Employees, Departments, Presses, Furnaces, Furnace Cars, Customers, Shifts
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  Building2, 
  Cpu, 
  Flame, 
  Truck, 
  Box, 
  Building, 
  Clock, 
  Plus, 
  Search, 
  Filter, 
  Edit, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  UploadCloud, 
  Download, 
  RefreshCw,
  AlertCircle,
  Layers,
  Sparkles,
  Check,
  AlertTriangle,
  PlusCircle,
  HelpCircle,
  Info,
  ShieldCheck,
  Wrench
} from 'lucide-react';
import {
  MasterDataTab,
  Employee,
  Department,
  Press,
  Furnace,
  FurnaceCar,
  Mill,
  Product,
  ProductType,
  Customer,
  Shift,
  NavigationPage
} from '../../types';
import {
  fetchMasterData,
  subscribeMasterData,
  createMasterDataItem,
  updateMasterDataItem,
  toggleMasterDataActive,
  deleteMasterDataItem,
  MASTER_DATA_COLLECTIONS
} from '../../services/masterDataService';
import {
  subscribeProductTypes,
  createProductType,
  updateProductType,
  toggleProductTypeActive
} from '../../services/productTypeService';
import { parseProductCode, normalizeProductCode } from '../../utils/productCodeParser';
import { enrichWithNormalizedFields } from '../../utils/searchUtils';
import { DataQualityModal } from '../admin/DataQualityModal';
import { MasterDataQualityReportModal } from './MasterDataQualityReportModal';
import { CostCenterHierarchyPanel } from './CostCenterHierarchyPanel';
import {
  MASTER_DATA_CATEGORIES,
  MasterDataCategory,
  categoryForTab,
  categoryLabel,
  getCategory,
} from '../../services/masterDataCategoryRegistry';
import { buildHierarchyIndex, getNodePath, validateEquipmentLink } from '../../services/hierarchyResolverPure';
import { validateAccountForSave } from '../../services/financialAccountService';
import { FinancialAccountsImportModal } from './FinancialAccountsImportModal';
import { FinancialTransactionsImportModal } from './FinancialTransactionsImportModal';
import { useAuth } from '../../context/AuthContext';
/*
 * The three-panel organisation. Selection state only - every label, collection
 * and code field still comes from the shared registry, and the 5/6/7/8/9
 * cost-centre rule is the existing one from the Sheet1 import, not a new one.
 */
import {
  panelCategories,
  costCenterSubCategories,
  filterByCostCenterSubCategories,
  costCenterSubCategoryCounts,
  selectAllSubCategories,
  toggleSubCategory,
  COST_CENTER_CATEGORY_ID,
  COST_CENTER_CODE_FIELD,
} from '../../services/masterDataPanelsPure';
/*
 * Equipment -> hierarchy linking.
 *
 * The nodes come from the EXISTING reader (listCostCenterHierarchyNodes), which
 * itself goes through the shared cache-first master-data read, and the graph
 * work goes through the EXISTING shared resolver. Nothing here walks a tree.
 */
import { listCostCenterHierarchyNodes, CostCenterHierarchyRecord } from '../../services/costCenterHierarchyService';
/*
 * The legacy-code <-> hierarchy dry run. Reports what WOULD link; writes
 * nothing. Ambiguous codes are surfaced for a human rather than guessed.
 */
import {
  reconcileLegacyWithHierarchy,
  summariseReconciliation,
  safeLinkPlan,
  applyConfirmationMessage,
  RECONCILABLE_EQUIPMENT_CATEGORIES,
} from '../../services/legacyHierarchyReconciliationPure';
import { applySafeLinks, describeApplyOutcome, ApplyLinksOutcome } from '../../services/legacyHierarchyLinkService';
import { exportMasterDataToExcel } from '../../services/exportService';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { db } from '../../config/firebase';
import { writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { logAuditAction } from '../../services/auditService';
import { toWesternDigits } from '../../utils/formatters';
import { useLanguage } from '../../i18n/LanguageContext';

/**
 * Phase 4 completion - "افتح المكبس 2000" / "افتح العربة 209" navigation.
 * Same session-local handoff pattern ReportsView.tsx already established
 * (REPORT_PREFILL_KEY) - selects the right tab and pre-fills the search box
 * so the resolved record is immediately visible, WITHOUT auto-opening the
 * edit modal (opening a record for editing is a separate, deliberate user
 * action, not implied by "open"/"show").
 */
export const MASTER_DATA_PREFILL_KEY = 'asfour_master_data_prefill';
export const MASTER_DATA_PREFILL_EVENT = 'asfour:master-data-prefill-update';

export interface MasterDataPrefill {
  tab?: MasterDataTab;
  query?: string;
}

function readMasterDataPrefill(): MasterDataPrefill | null {
  try {
    const raw = sessionStorage.getItem(MASTER_DATA_PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(MASTER_DATA_PREFILL_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface CodeAnalysisItem {
  product: Product;
  parseResult: ReturnType<typeof parseProductCode>;
  needsUpdate: boolean;
  proposedChanges: {
    productTypePrefix?: string;
    productTypeId?: string;
    productTypeName?: string;
    productTypeNameAr?: string;
    aluminaPercentage?: number;
    productIdentifier?: string;
    code?: string;
    productCode?: string;
    smartParseStatus?: string;
    productCodeNormalized?: string;
    nameNormalized?: string;
    productTypePrefixNormalized?: string;
    productTypeNameNormalized?: string;
  };
}

interface MasterDataViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const MasterDataView: React.FC<MasterDataViewProps> = ({ onNavigate }) => {
  const { language, isRtl } = useLanguage();
  const [prefill] = useState<MasterDataPrefill | null>(() => readMasterDataPrefill());
  const [activeTab, setActiveTab] = useState<MasterDataTab>(prefill?.tab || 'products');
  const [items, setItems] = useState<any[]>([]);
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [furnaces, setFurnaces] = useState<Furnace[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>(prefill?.query || '');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [prefixFilter, setPrefixFilter] = useState<string>('all');

  // Phase 4 completion - apply a prefill update live, without requiring a
  // remount (same reasoning as ReportsView's REPORT_PREFILL_EVENT).
  useEffect(() => {
    function handlePrefillUpdate(e: Event) {
      const detail = (e as CustomEvent<MasterDataPrefill>).detail;
      if (!detail) return;
      if (detail.tab) setActiveTab(detail.tab);
      if (detail.query !== undefined) setSearchQuery(detail.query || '');
    }
    window.addEventListener(MASTER_DATA_PREFILL_EVENT, handlePrefillUpdate as EventListener);
    return () => window.removeEventListener(MASTER_DATA_PREFILL_EVENT, handlePrefillUpdate as EventListener);
  }, []);

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<any | null>(null);

  // Quick New Product Type Modal from inside Product Form
  const [isQuickTypeModalOpen, setIsQuickTypeModalOpen] = useState<boolean>(false);
  const [quickTypePrefix, setQuickTypePrefix] = useState<string>('');
  const [quickTypeNameEn, setQuickTypeNameEn] = useState<string>('');
  const [quickTypeNameAr, setQuickTypeNameAr] = useState<string>('');
  const [quickTypeDescription, setQuickTypeDescription] = useState<string>('');
  const [quickTypeError, setQuickTypeError] = useState<string | null>(null);
  const [isQuickTypeSaving, setIsQuickTypeSaving] = useState<boolean>(false);
  const [manualOverrideAlumina, setManualOverrideAlumina] = useState<boolean>(false);

  // Analyze Existing Product Codes Modal State
  const [isAnalyzeModalOpen, setIsAnalyzeModalOpen] = useState<boolean>(false);
  const [isQualityModalOpen, setIsQualityModalOpen] = useState<boolean>(false);
  const [isQualityReportOpen, setIsQualityReportOpen] = useState<boolean>(false);
  const [isHierarchyPanelOpen, setIsHierarchyPanelOpen] = useState<boolean>(false);
  /**
   * Codes selected inside the CURRENT category only.
   *
   * Cleared whenever the category changes - carrying a product code over into
   * the Financial Accounts view would let a later action target something the
   * user can no longer see, which is the same rule Production Review's row
   * selection already follows.
   */
  const [selectedCodes, setSelectedCodes] = useState<string[]>([]);
  const [isAccountsImportOpen, setIsAccountsImportOpen] = useState<boolean>(false);
  /** The dedicated financial-transactions importer - also in place, never Historical Import. */
  const [isTransactionsImportOpen, setIsTransactionsImportOpen] = useState<boolean>(false);

  /**
   * The hierarchy nodes available to link equipment to.
   *
   * Loaded once, cache-first, and only used by the equipment tabs. An empty list
   * simply means no hierarchy has been imported yet - the selector then offers
   * only "not linked", rather than pretending there is something to choose.
   */
  const [hierarchyNodes, setHierarchyNodes] = useState<CostCenterHierarchyRecord[]>([]);
  const [isReconcileOpen, setIsReconcileOpen] = useState<boolean>(false);
  /**
   * The category being browsed.
   *
   * One selection, not two. The multi-select panel that used to sit above the
   * category row repeated the very navigation underneath it, so choosing a
   * category took two controls instead of one.
   */
  const [activeCategoryId, setActiveCategoryId] = useState<string>('products');
  /** Cost-centre classifications. Empty = no narrowing, as everywhere else. */
  const [costCenterDigits, setCostCenterDigits] = useState<string[]>([]);
  const [isApplyingLinks, setIsApplyingLinks] = useState<boolean>(false);
  const [applyOutcome, setApplyOutcome] = useState<ApplyLinksOutcome | null>(null);
  /** Bumped after a successful apply so the equipment list is re-read and the panel recomputes. */
  const [equipmentRefresh, setEquipmentRefresh] = useState<number>(0);
  /**
   * Every equipment record, not just the tab on screen.
   *
   * Reconciliation spans presses, furnaces and mills together, so tying it to
   * `items` (one tab) was part of why it was unreachable: you had to already be
   * on the right tab to see it at all.
   */
  const [allEquipment, setAllEquipment] = useState<Array<Record<string, any>>>([]);


  /**
   * Master Data import permission - the EXISTING grants, no new key.
   *
   * Exactly the rule DataImportView and ChineseMillsImportPanel already apply
   * for "may create Master Data", plus the existing excel.import grant. A user
   * without it can still open the importer and review a file; the execute
   * button stays disabled.
   */
  const { adminUser, isSuperAdmin, hasPermission } = useAuth();
  const canImportMasterData = useMemo(() => {
    if (isSuperAdmin) return true;
    if (!adminUser) return false;
    if (adminUser.role === 'SUPER_ADMIN' || adminUser.role === 'ADMIN') return true;
    return hasPermission('masterData.inlineAdd') || hasPermission('excel.import');
  }, [adminUser, isSuperAdmin, hasPermission]);
  const [analyzedItems, setAnalyzedItems] = useState<CodeAnalysisItem[]>([]);
  const [isApplyingAnalysis, setIsApplyingAnalysis] = useState<boolean>(false);
  const [analysisAppliedMessage, setAnalysisAppliedMessage] = useState<string | null>(null);

  const tabs: { id: MasterDataTab; label: string; icon: React.ElementType }[] = [
    { id: 'products', label: language === 'ar' ? 'المنتجات الحرارية' : 'Products', icon: Box },
    { id: 'productTypes', label: language === 'ar' ? 'تصنيفات المنتجات' : 'Product Types', icon: Layers },
    { id: 'employees', label: language === 'ar' ? 'العمال والموظفون' : 'Employees', icon: Users },
    { id: 'presses', label: language === 'ar' ? 'المكابس' : 'Presses', icon: Cpu },
    { id: 'furnaces', label: language === 'ar' ? 'الأفران' : 'Furnaces', icon: Flame },
    { id: 'furnaceCars', label: language === 'ar' ? 'عربات الأفران' : 'Furnace Cars', icon: Truck },
    { id: 'mills', label: language === 'ar' ? 'الطواحين الصينية' : 'Chinese Mills', icon: Wrench },
    { id: 'customers', label: language === 'ar' ? 'العملاء' : 'Customers', icon: Building },
    { id: 'departments', label: language === 'ar' ? 'الأقسام' : 'Departments', icon: Building2 },
    { id: 'shifts', label: language === 'ar' ? 'ورديات العمل' : 'Shifts', icon: Clock },
    { id: 'financialAccounts', label: language === 'ar' ? 'الحسابات المالية' : 'Financial Accounts', icon: Building2 },
  ];

  /** The seven top-level categories, straight from the registry. */
  const areaCategories = useMemo(() => panelCategories(), []);

  /**
   * Icons come from the existing tab definitions - §19 asks for the current
   * visual language, so nothing new is introduced here.
   */
  const iconForCategory = (categoryId: string): React.ElementType => {
    const category = areaCategories.find((c) => c.id === categoryId);
    const tab = tabs.find((t) => t.id === (category?.tab as MasterDataTab));
    return tab?.icon ?? Layers;
  };

  const labelForCategory = (categoryId: string): string => {
    const category = areaCategories.find((c) => c.id === categoryId);
    if (!category) return categoryId;
    return language === 'ar' ? category.labelAr : category.labelEn;
  };

  /*
   * The table follows the active category. `activeTab` stays the engine every
   * existing behaviour already depends on - the table, the Add/Edit modal, the
   * importers, export and the per-row actions - so none of them had to change.
   */
  useEffect(() => {
    const category = areaCategories.find((c) => c.id === activeCategoryId);
    if (category?.tab) setActiveTab(category.tab as MasterDataTab);
  }, [activeCategoryId, areaCategories]);

  const isCostCenterActive = activeCategoryId === COST_CENTER_CATEGORY_ID;

  /**
   * Counts per 5/6/7/8/9, from the rows already loaded - no extra read.
   *
   * Keyed on the hierarchy's own code field, so the classification is read off
   * the codes the Sheet1 import actually assigned.
   */
  const costCenterCounts = useMemo(
    () => (isCostCenterActive ? costCenterSubCategoryCounts(items, COST_CENTER_CODE_FIELD) : null),
    [isCostCenterActive, items],
  );

  // Subscribe to Product Types (always kept live for parser)
  useEffect(() => {
    const unsubTypes = subscribeProductTypes(
      (types) => setProductTypes(types),
      (err) => console.warn('Product types listener warning:', err)
    );
    return () => unsubTypes();
  }, []);

  // Subscribe to current collection
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeMasterData<any>(
      MASTER_DATA_COLLECTIONS[activeTab],
      (data) => {
        setItems(data);
        setIsLoading(false);
      },
      (err) => {
        console.error(`Error loading ${activeTab}:`, err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [activeTab]);

  /* The hierarchy node list, read once through the existing cache-first reader. */
  useEffect(() => {
    listCostCenterHierarchyNodes()
      .then(setHierarchyNodes)
      .catch(() => { /* an unavailable hierarchy only costs the link selector */ });
  }, []);

  /*
   * All equipment categories, cache-first, once. Reconciliation covers them
   * together, so it must not depend on which tab happens to be open.
   */
  useEffect(() => {
    Promise.all(
      RECONCILABLE_EQUIPMENT_CATEGORIES.map((categoryId) =>
        // `skipCache` after an apply: updateMasterDataItem invalidated the
        // collection, and the panel must recompute from what was actually
        // written rather than from a stale copy.
        fetchMasterData<any>(MASTER_DATA_COLLECTIONS[categoryId as MasterDataTab], { skipCache: equipmentRefresh > 0 })
          .then((rows) => rows.map((r) => ({ ...r, __categoryId: categoryId })))
          .catch(() => [] as Array<Record<string, any>>),
      ),
    )
      .then((groups) => setAllEquipment(groups.flat()))
      .catch(() => { /* an unavailable collection only shrinks the report */ });
  }, [equipmentRefresh]);

  // Load auxiliary lists (departments & furnaces for dropdowns)
  useEffect(() => {
    fetchMasterData<Department>('departments').then(setDepartments).catch(() => {});
    fetchMasterData<Furnace>('furnaces').then(setFurnaces).catch(() => {});
  }, []);

  /**
   * Which tabs can carry a hierarchy link.
   *
   * Equipment tabs only - these are the master records a production record
   * actually points at (pressId / furnaceId), plus mills for future use. A
   * non-equipment tab never shows the selector.
   */
  const EQUIPMENT_TABS = ['presses', 'furnaces', 'mills'];
  const isEquipmentTab = EQUIPMENT_TABS.includes(activeTab);

  /**
   * Index of the COST-CENTRE HIERARCHY NODES, used to label and validate an
   * equipment link. Distinct from `hierarchyIndex` further down, which indexes
   * whichever hierarchical CATEGORY is currently on screen - here we are on an
   * equipment tab and need the node tree instead.
   */
  const linkHierarchyIndex = useMemo(
    () => buildHierarchyIndex(
      hierarchyNodes.map((node) => ({ ...node, id: node.id, code: node.sheet1Code, parentId: node.parentSheet1Code })),
    ),
    [hierarchyNodes],
  );

  /**
   * Node options, each labelled with its full path so "Bo-kher 900 2" is
   * distinguishable from a similarly-named node in another branch. The label is
   * for the human; the stored value is always the stable node id.
   */
  const hierarchyOptions = useMemo(
    () =>
      hierarchyNodes.map((node) => ({
        id: node.id,
        label: getNodePath(linkHierarchyIndex, node.id, (x: any) => x.name || x.sheet1Code, ' ← ')
          || node.name || node.sheet1Code,
      })),
    [hierarchyNodes, linkHierarchyIndex],
  );

  /** The readable path for one linked node - what the table column shows. */
  const hierarchyLabelFor = (nodeId: unknown): string | null => {
    const id = nodeId == null ? '' : String(nodeId);
    if (!id) return null;
    const path = getNodePath(linkHierarchyIndex, id, (x: any) => x.name || x.sheet1Code, ' ← ');
    if (path) return path;
    const node = hierarchyNodes.find((h) => h.id === id);
    return node ? node.name || node.sheet1Code : null;
  };

  /**
   * Dry-run reconciliation for the equipment tab currently on screen.
   *
   * Recomputed from data already loaded - no read, no write. It exists so the
   * duplicate-looking records (same code, different name, one legacy and one
   * imported) are visible as what they are, and so ambiguous codes are shown
   * rather than silently resolved.
   */
  const reconciliation = useMemo(
    () =>
      reconcileLegacyWithHierarchy(
        allEquipment.map((i) => ({
          id: String(i.id ?? ''),
          code: String(i.code ?? ''),
          name: i.name,
          categoryId: String(i.__categoryId ?? ''),
          hierarchyNodeId: i.hierarchyNodeId,
        })),
        hierarchyNodes.map((h) => ({ id: h.id, code: h.sheet1Code, name: h.name, type: h.type })),
      ),
    [allEquipment, hierarchyNodes],
  );

  /**
   * The exact set of writes the Apply action would perform.
   *
   * Taken straight from the reconciliation - never recomputed with different
   * rules at write time - so the number the user confirms is the number of
   * documents touched. Conflicts and ambiguous codes cannot appear here: they
   * never reach `matched`.
   */
  const plannedLinks = useMemo(
    () => (reconciliation ? safeLinkPlan(reconciliation) : []),
    [reconciliation],
  );

  /**
   * Applies the planned links - and nothing else.
   *
   * `plannedLinks` is the already-validated plan the panel is displaying, so
   * the number in the confirmation is the number of documents touched. Nothing
   * is re-matched here: conflicts and ambiguous codes never entered the plan,
   * so they cannot be written even by mistake.
   *
   * Each link is applied independently through the shared audited update, so
   * one failure leaves the others written and retryable. Afterwards the
   * equipment list is re-read so the panel recomputes - the applied rows stop
   * being pending safe matches, and conflicts and no-counterpart rows are
   * untouched because nothing wrote to them.
   */
  const handleApplySafeLinks = async () => {
    if (plannedLinks.length === 0 || !canImportMasterData) return;
    if (!window.confirm(applyConfirmationMessage(plannedLinks.length, language))) return;

    setIsApplyingLinks(true);
    setApplyOutcome(null);
    try {
      const currentLinks = new Map<string, string | null | undefined>(
        allEquipment.map((e) => [String(e.id ?? ''), e.hierarchyNodeId]),
      );
      const outcome = await applySafeLinks(plannedLinks, { currentLinks });
      setApplyOutcome(outcome);
      if (outcome.successCount > 0) setEquipmentRefresh((v) => v + 1);
    } catch (err: any) {
      // A failure that stopped the whole run is reported as such - never as a
      // partial success, and never silently.
      setApplyOutcome({
        successCount: 0,
        failedCount: plannedLinks.length,
        skippedCount: 0,
        applied: [],
        failed: plannedLinks.map((l) => ({
          legacyId: l.legacyId, code: l.code, categoryId: l.categoryId,
          error: String(err?.message ?? err), at: new Date().toISOString(),
        })),
        skipped: [],
        plannedCount: plannedLinks.length,
      });
    } finally {
      setIsApplyingLinks(false);
    }
  };

  /** How many equipment records on this tab still carry no link - §24/§26 reporting. */
  const unlinkedEquipmentCount = useMemo(
    () => (isEquipmentTab ? items.filter((i) => !i.hierarchyNodeId).length : 0),
    [isEquipmentTab, items],
  );

  // Real-time parsed result for Product code in modal
  const liveProductParseResult = useMemo(() => {
    if (activeTab !== 'products' || !formData.code) {
      return null;
    }
    return parseProductCode(formData.code, productTypes);
  }, [activeTab, formData.code, productTypes]);

  // Handle live updates to product form when valid code is typed
  const handleProductCodeChange = (rawCode: string) => {
    const normalized = normalizeProductCode(rawCode);
    const parseRes = parseProductCode(normalized, productTypes);

    const updated: Record<string, any> = {
      ...formData,
      code: normalized,
      productCode: normalized,
    };

    if (parseRes.smartParseStatus === 'SMART_CODE' && parseRes.productType) {
      updated.productTypePrefix = parseRes.prefix;
      updated.productTypeId = parseRes.productType.id || '';
      updated.productTypeName = parseRes.productType.nameEn;
      updated.productTypeNameAr = parseRes.productType.nameAr;
      updated.productIdentifier = parseRes.productIdentifier;

      // Auto-set Alumina if not manually overridden
      if (!manualOverrideAlumina && parseRes.aluminaPercentage !== undefined) {
        updated.aluminaPercentage = parseRes.aluminaPercentage;
      }

      // Auto-set suggested Category and Name if currently empty
      if (!formData.category || formData.category.trim() === '') {
        updated.category = parseRes.productType.nameAr || parseRes.productType.nameEn;
      }
      if (!formData.name || formData.name.trim() === '' || formData.name === parseRes.suggestedNameAr) {
        if (parseRes.suggestedNameAr) {
          updated.name = parseRes.suggestedNameAr;
        }
      }
    } else if (parseRes.smartParseStatus === 'UNKNOWN_PREFIX') {
      updated.productTypePrefix = parseRes.prefix;
      updated.productIdentifier = parseRes.productIdentifier;
      if (!manualOverrideAlumina && parseRes.aluminaPercentage !== undefined) {
        updated.aluminaPercentage = parseRes.aluminaPercentage;
      }
    } else {
      // MANUAL_PRODUCT_CODE (starts with digit or custom):
      // Do NOT derive alumina, product type, prefix, or identifier
      if (!formData.isManualClassification) {
        updated.productTypePrefix = '';
        updated.productIdentifier = '';
      }
    }

    setFormData(updated);
  };

  /**
   * The category currently on screen.
   *
   * Derived from activeTab rather than stored separately, so the category
   * selector and every existing code path that already sets activeTab (the
   * prefill deep-link, for instance) can never disagree about what is shown.
   */
  const currentCategory: MasterDataCategory | undefined = useMemo(
    () => categoryForTab(activeTab),
    [activeTab]
  );

  /** The code that identifies a row in the current category. */
  const codeOfItem = (item: any): string =>
    String(item?.[currentCategory?.codeField || 'code'] ?? item?.code ?? item?.prefixCode ?? item?.id ?? '');

  /**
   * Hierarchy index for a hierarchical category, built once per item list.
   *
   * Built through the SHARED resolver, so the parent/child meaning here is
   * identical to the one Production Review and reporting use - there is no
   * screen-local idea of what "below this node" means.
   */
  const hierarchyIndex = useMemo(() => {
    if (!currentCategory?.hierarchical) return null;
    const parentField = currentCategory.parentField || 'parentCode';
    return buildHierarchyIndex(
      items.map((item) => ({
        ...item,
        id: codeOfItem(item),
        code: codeOfItem(item),
        parentId: item?.[parentField] ?? null,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, currentCategory]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Status filter
      if (statusFilter === 'active' && item.active === false) return false;
      if (statusFilter === 'inactive' && item.active !== false) return false;

      // Product Prefix filter
      if (activeTab === 'products' && prefixFilter !== 'all') {
        const itemPrefix = item.productTypePrefix || (item.code ? item.code.substring(0, 3).toUpperCase() : '');
        if (itemPrefix !== prefixFilter) return false;
      }

      // Search filter
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const codeMatch = item.code?.toLowerCase().includes(q) || item.prefixCode?.toLowerCase().includes(q);
        const nameMatch = item.name?.toLowerCase().includes(q) || item.nameEn?.toLowerCase().includes(q) || item.nameAr?.toLowerCase().includes(q);
        const categoryMatch = item.category?.toLowerCase().includes(q) || item.productTypeName?.toLowerCase().includes(q) || item.productTypeNameAr?.toLowerCase().includes(q);
        const jobTitleMatch = item.jobTitle?.toLowerCase().includes(q);
        const companyMatch = item.company?.toLowerCase().includes(q);
        const carNumberMatch = item.carNumber?.toLowerCase().includes(q);
        const aluminaMatch = item.aluminaPercentage !== undefined && String(item.aluminaPercentage).includes(q);
        const prefixMatch = item.productTypePrefix?.toLowerCase().includes(q);
        // Financial Accounts search their own fields, and only their own -
        // the search box never reaches across into another category.
        const accountTypeMatch = item.accountType?.toLowerCase().includes(q);
        const parentCodeMatch = item.parentCode?.toLowerCase?.().includes(q);

        return Boolean(
          codeMatch || 
          nameMatch || 
          categoryMatch || 
          jobTitleMatch || 
          companyMatch || 
          carNumberMatch || 
          aluminaMatch || 
          prefixMatch ||
          accountTypeMatch ||
          parentCodeMatch
        );
      }

      return true;
    });
  }, [items, statusFilter, prefixFilter, searchQuery, activeTab]);

  /**
   * Area 3's rows.
   *
   * The cost-centre sub-filter is one more AND on top of the existing search,
   * status and prefix filters - never a replacement. With nothing ticked it is
   * the identity, so every other category behaves exactly as before.
   */
  const visibleItems = useMemo(
    () => (isCostCenterActive ? filterByCostCenterSubCategories(filteredItems, costCenterDigits, COST_CENTER_CODE_FIELD) : filteredItems),
    [isCostCenterActive, filteredItems, costCenterDigits],
  );

  const handleOpenAdd = () => {
    setEditingItem(null);
    setFormError(null);
    setManualOverrideAlumina(false);

    if (activeTab === 'products') {
      setFormData({
        code: '',
        name: '',
        category: '',
        aluminaPercentage: 25,
        pieceWeight: 4.5,
        pieceWeightKg: 4.5,
        unit: 'قطعة',
        dimensions: '230x114x65 مم',
        description: '',
        active: true,
      });
    } else if (activeTab === 'productTypes') {
      setFormData({
        prefixCode: '',
        nameEn: '',
        nameAr: '',
        description: '',
        active: true,
      });
    } else if (activeTab === 'employees') {
      setFormData({ code: '', name: '', jobTitle: '', departmentId: '', departmentName: '', phone: '', active: true });
    } else if (activeTab === 'presses') {
      setFormData({ code: '', name: '', tonnage: 1200, model: '', status: 'active', active: true });
    } else if (activeTab === 'mills') {
      setFormData({ code: '', name: '', model: '', status: 'active', active: true });
    } else if (activeTab === 'furnaces') {
      setFormData({ code: '', name: '', capacity: 50, maxTemperature: 1650, status: 'active', active: true });
    } else if (activeTab === 'furnaceCars') {
      setFormData({ code: '', carNumber: '', furnaceId: '', furnaceName: '', capacity: 1200, active: true });
    } else if (activeTab === 'customers') {
      setFormData({ code: '', name: '', company: '', phone: '', email: '', address: '', active: true });
    } else if (activeTab === 'departments') {
      setFormData({ code: '', name: '', description: '', active: true });
    } else if (activeTab === 'shifts') {
      setFormData({ code: '', name: '', startTime: '08:00', endTime: '16:00', hours: 8, active: true });
    } else if (activeTab === 'financialAccounts') {
      setFormData({ code: '', name: '', nameEn: '', parentCode: '', accountType: '', description: '', active: true });
    }
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: any) => {
    setEditingItem(item);
    setFormError(null);
    setManualOverrideAlumina(false);
    setFormData({ ...item });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setIsSaving(true);

    try {
      if (activeTab === 'productTypes') {
        const prefix = (formData.prefixCode || '').trim().toUpperCase();
        if (!/^[A-Z0-9]{3}$/.test(prefix)) {
          throw new Error(language === 'ar' ? 'بادئة الكود (Prefix Code) يجب أن تتكون من 3 أحرف باللغة الإنجليزية بالضبط (مثال: BAR, BHA).' : 'The prefix code must be exactly 3 English characters (e.g. BAR, BHA).');
        }
        if (!formData.nameEn || !formData.nameEn.trim()) {
          throw new Error(language === 'ar' ? 'الاسم باللغة الإنجليزية إلزامي لتصنيف المنتج.' : 'The English name is required for the product type.');
        }
        if (!formData.nameAr || !formData.nameAr.trim()) {
          throw new Error(language === 'ar' ? 'الاسم باللغة العربية إلزامي لتصنيف المنتج.' : 'The Arabic name is required for the product type.');
        }

        if (editingItem && editingItem.id) {
          await updateProductType(editingItem.id, {
            prefixCode: prefix,
            nameEn: formData.nameEn.trim(),
            nameAr: formData.nameAr.trim(),
            description: formData.description || '',
            active: formData.active !== false,
          });
        } else {
          await createProductType({
            prefixCode: prefix,
            nameEn: formData.nameEn.trim(),
            nameAr: formData.nameAr.trim(),
            description: formData.description || '',
            active: formData.active !== false,
          });
        }
        setIsModalOpen(false);
        return;
      }

      // Products validation (Optional Smart Parsing & Non-blocking)
      if (activeTab === 'products') {
        const normalizedCode = normalizeProductCode(formData.code || '');
        if (!normalizedCode) {
          throw new Error(language === 'ar' ? 'حقل كود المنتج إلزامي.' : 'Product code is required.');
        }
        if (!formData.name || !formData.name.trim()) {
          throw new Error(language === 'ar' ? 'حقل اسم المنتج إلزامي.' : 'Product name is required.');
        }

        const parseResult = parseProductCode(normalizedCode, productTypes);

        formData.code = normalizedCode;
        formData.productCode = normalizedCode;
        formData.name = formData.name.trim();

        // Optional Alumina Percentage validation (if provided, must be 0-100)
        if (formData.aluminaPercentage !== undefined && formData.aluminaPercentage !== null && String(formData.aluminaPercentage).trim() !== '') {
          const aluminaNum = Number(formData.aluminaPercentage);
          if (isNaN(aluminaNum) || aluminaNum < 0 || aluminaNum > 100) {
            throw new Error(language === 'ar' ? 'نسبة الألومينا يجب أن تكون رقماً بين 0% و 100%.' : 'Alumina percentage must be a number between 0% and 100%.');
          }
          formData.aluminaPercentage = aluminaNum;
        } else {
          formData.aluminaPercentage = null;
        }

        // Optional Piece Weight validation
        if (formData.pieceWeight !== undefined && formData.pieceWeight !== null && String(formData.pieceWeight).trim() !== '') {
          const weightNum = Number(formData.pieceWeight);
          if (isNaN(weightNum) || weightNum <= 0) {
            throw new Error(language === 'ar' ? 'وزن القطعة (كجم) يجب أن يكون قيمة رقمية أكبر من الصفر.' : 'Piece weight (kg) must be a number greater than zero.');
          }
          formData.pieceWeight = weightNum;
          formData.pieceWeightKg = weightNum;
        } else {
          formData.pieceWeight = null;
          formData.pieceWeightKg = null;
        }

        // Apply derived smart classification if recognized
        if (parseResult.status === 'RECOGNIZED' && parseResult.productType) {
          formData.productTypePrefix = parseResult.prefix;
          formData.productTypeId = parseResult.productType.id || '';
          formData.productTypeName = parseResult.productType.nameEn;
          formData.productTypeNameAr = parseResult.productType.nameAr;
          formData.productIdentifier = parseResult.productIdentifier;
          formData.smartParseStatus = 'RECOGNIZED';
          if (formData.aluminaPercentage === null && parseResult.aluminaPercentage !== undefined) {
            formData.aluminaPercentage = parseResult.aluminaPercentage;
          }
        } else if (parseResult.status === 'PARTIAL') {
          formData.productTypePrefix = parseResult.prefix;
          formData.productIdentifier = parseResult.productIdentifier;
          formData.smartParseStatus = 'PARTIAL';
          if (formData.aluminaPercentage === null && parseResult.aluminaPercentage !== undefined) {
            formData.aluminaPercentage = parseResult.aluminaPercentage;
          }
        } else {
          formData.smartParseStatus = 'NOT_APPLICABLE';
        }
      }

      if (!formData.code || !formData.code.trim()) {
        throw new Error(language === 'ar' ? 'حقل الكود إلزامي.' : 'Code is required.');
      }
      /*
       * An equipment link must name a node that exists, and the hierarchy it
       * belongs to must be free of cycles - otherwise "all descendants" has no
       * defined meaning. Clearing the link (empty value) is always allowed.
       */
      if (isEquipmentTab && formData.hierarchyNodeId) {
        const linkCheck = validateEquipmentLink(linkHierarchyIndex, formData.hierarchyNodeId);
        if (!linkCheck.valid) {
          setFormError(language === 'ar' ? linkCheck.issues[0].messageAr : linkCheck.issues[0].messageEn);
          setIsSaving(false);
          return;
        }
      }

      if (!formData.name && activeTab !== 'furnaceCars') {
        throw new Error(language === 'ar' ? 'حقل الاسم إلزامي.' : 'Name is required.');
      }

      // Fill auxiliary names if needed
      if (activeTab === 'employees' && formData.departmentId) {
        const found = departments.find((d) => d.id === formData.departmentId);
        if (found) formData.departmentName = found.name;
      }
      if (activeTab === 'furnaceCars' && formData.furnaceId) {
        const found = furnaces.find((f) => f.id === formData.furnaceId);
        if (found) formData.furnaceName = found.name;
      }

      /*
       * Financial Accounts carry a parent, so a save can break the tree in
       * ways a plain required-field check would let through: a duplicate code,
       * a parent that does not exist, an account made its own parent, or a
       * move that closes a cycle (A -> B -> C -> A). All four are refused here
       * BEFORE the write, through the shared hierarchy resolver.
       */
      if (activeTab === 'financialAccounts') {
        const check = validateAccountForSave(items, formData, editingItem?.code);
        if (!check.valid) {
          throw new Error(
            check.issues.map((i) => (language === 'ar' ? i.messageAr : i.messageEn)).join(' | ')
          );
        }
        // An empty parent box means "root", which must be stored as null -
        // leaving '' behind would look like a parent whose code is blank.
        formData.parentCode = formData.parentCode ? String(formData.parentCode).trim() : null;
      }

      if (editingItem && editingItem.id) {
        await updateMasterDataItem(MASTER_DATA_COLLECTIONS[activeTab], editingItem.id, formData);
      } else {
        await createMasterDataItem(MASTER_DATA_COLLECTIONS[activeTab], formData);
      }

      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err.message || (language === 'ar' ? 'حدث خطأ أثناء حفظ البيانات.' : 'An error occurred while saving the data.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleStatus = async (item: any) => {
    try {
      if (activeTab === 'productTypes') {
        await toggleProductTypeActive(item.id, item.active !== false, item.prefixCode);
      } else {
        await toggleMasterDataActive(MASTER_DATA_COLLECTIONS[activeTab], item.id, item.active !== false);
      }
    } catch (err) {
      console.error('Error toggling status:', err);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmItem || !deleteConfirmItem.id) return;
    try {
      if (activeTab === 'productTypes') {
        await toggleProductTypeActive(deleteConfirmItem.id, true, deleteConfirmItem.prefixCode);
      } else {
        await deleteMasterDataItem(MASTER_DATA_COLLECTIONS[activeTab], deleteConfirmItem.id, deleteConfirmItem.code || deleteConfirmItem.name);
      }
      setDeleteConfirmItem(null);
    } catch (err) {
      console.error('Error deleting item:', err);
    }
  };

  // Quick New Product Type Creation
  const handleOpenQuickType = (prefix: string) => {
    setQuickTypePrefix(prefix.toUpperCase());
    setQuickTypeNameEn('');
    setQuickTypeNameAr('');
    setQuickTypeDescription(language === 'ar' ? `تصنيف نوع المنتج للبادئة (${prefix.toUpperCase()})` : `Product type classification for prefix (${prefix.toUpperCase()})`);
    setQuickTypeError(null);
    setIsQuickTypeModalOpen(true);
  };

  const handleSaveQuickType = async (e: React.FormEvent) => {
    e.preventDefault();
    setQuickTypeError(null);
    setIsQuickTypeSaving(true);

    try {
      const prefix = quickTypePrefix.trim().toUpperCase();
      if (!/^[A-Z0-9]{3}$/.test(prefix)) {
        throw new Error(language === 'ar' ? 'بادئة الكود يجب أن تتكون من 3 أحرف باللغة الإنجليزية بالضبط.' : 'The prefix code must be exactly 3 English characters.');
      }
      if (!quickTypeNameEn.trim()) throw new Error(language === 'ar' ? 'الاسم بالإنجليزية إلزامي.' : 'The English name is required.');
      if (!quickTypeNameAr.trim()) throw new Error(language === 'ar' ? 'الاسم بالعربية إلزامي.' : 'The Arabic name is required.');

      const newId = await createProductType({
        prefixCode: prefix,
        nameEn: quickTypeNameEn.trim(),
        nameAr: quickTypeNameAr.trim(),
        description: quickTypeDescription.trim(),
        active: true,
      });

      // Update local productTypes cache immediately so live parser picks it up instantly
      const newType: ProductType = {
        id: newId,
        prefixCode: prefix,
        nameEn: quickTypeNameEn.trim(),
        nameAr: quickTypeNameAr.trim(),
        description: quickTypeDescription.trim(),
        active: true,
      };
      setProductTypes((prev) => [...prev, newType]);

      // Re-trigger product form auto-population
      if (formData.code) {
        handleProductCodeChange(formData.code);
      }

      setIsQuickTypeModalOpen(false);
    } catch (err: any) {
      setQuickTypeError(err.message || (language === 'ar' ? 'فشل حفظ نوع المنتج الجديد.' : 'Failed to save the new product type.'));
    } finally {
      setIsQuickTypeSaving(false);
    }
  };

  // Analyze Existing Products Action
  const handleOpenAnalyzeCodes = () => {
    setAnalysisAppliedMessage(null);
    const analysis: CodeAnalysisItem[] = items.map((prod: Product) => {
      const normalizedCode = normalizeProductCode(prod.code || prod.productCode || '');
      const parseRes = parseProductCode(normalizedCode, productTypes);

      const proposedChanges: CodeAnalysisItem['proposedChanges'] = {};
      let needsUpdate = false;

      // Smart parse status check
      if (prod.smartParseStatus !== parseRes.smartParseStatus) {
        proposedChanges.smartParseStatus = parseRes.smartParseStatus;
        needsUpdate = true;
      }

      // Normalized search fields check
      const normalizedObj = enrichWithNormalizedFields(
        'products',
        {
          code: normalizedCode,
          name: prod.name || prod.productName,
          productTypePrefix: parseRes.prefix || prod.productTypePrefix,
          productTypeName: parseRes.productType?.nameEn || prod.productTypeName,
        }
      );

      if (prod.productCodeNormalized !== normalizedObj.productCodeNormalized) {
        proposedChanges.productCodeNormalized = normalizedObj.productCodeNormalized;
        needsUpdate = true;
      }
      if (prod.nameNormalized !== normalizedObj.nameNormalized) {
        proposedChanges.nameNormalized = normalizedObj.nameNormalized;
        needsUpdate = true;
      }
      if (normalizedObj.productTypePrefixNormalized && prod.productTypePrefixNormalized !== normalizedObj.productTypePrefixNormalized) {
        proposedChanges.productTypePrefixNormalized = normalizedObj.productTypePrefixNormalized;
        needsUpdate = true;
      }
      if (normalizedObj.productTypeNameNormalized && prod.productTypeNameNormalized !== normalizedObj.productTypeNameNormalized) {
        proposedChanges.productTypeNameNormalized = normalizedObj.productTypeNameNormalized;
        needsUpdate = true;
      }

      // CASE A: SMART_CODE
      if (parseRes.smartParseStatus === 'SMART_CODE' && parseRes.productType) {
        if (!prod.productTypePrefix || prod.productTypePrefix !== parseRes.prefix) {
          proposedChanges.productTypePrefix = parseRes.prefix;
          needsUpdate = true;
        }
        if (!prod.productTypeId || prod.productTypeId !== parseRes.productType.id) {
          proposedChanges.productTypeId = parseRes.productType.id;
          needsUpdate = true;
        }
        if (!prod.productTypeName || prod.productTypeName !== parseRes.productType.nameEn) {
          proposedChanges.productTypeName = parseRes.productType.nameEn;
          needsUpdate = true;
        }
        if (!prod.productTypeNameAr || prod.productTypeNameAr !== parseRes.productType.nameAr) {
          proposedChanges.productTypeNameAr = parseRes.productType.nameAr;
          needsUpdate = true;
        }
        if (parseRes.aluminaPercentage !== undefined && (prod.aluminaPercentage === undefined || prod.aluminaPercentage === null)) {
          proposedChanges.aluminaPercentage = parseRes.aluminaPercentage;
          needsUpdate = true;
        }
        if (parseRes.productIdentifier && (!prod.productIdentifier || prod.productIdentifier !== parseRes.productIdentifier)) {
          proposedChanges.productIdentifier = parseRes.productIdentifier;
          needsUpdate = true;
        }
        if (prod.code !== normalizedCode) {
          proposedChanges.code = normalizedCode;
          proposedChanges.productCode = normalizedCode;
          needsUpdate = true;
        }
      } 
      // CASE B: UNKNOWN_PREFIX
      else if (parseRes.smartParseStatus === 'UNKNOWN_PREFIX') {
        if (!prod.productTypePrefix || prod.productTypePrefix !== parseRes.prefix) {
          proposedChanges.productTypePrefix = parseRes.prefix;
          needsUpdate = true;
        }
        if (parseRes.aluminaPercentage !== undefined && (prod.aluminaPercentage === undefined || prod.aluminaPercentage === null)) {
          proposedChanges.aluminaPercentage = parseRes.aluminaPercentage;
          needsUpdate = true;
        }
        if (parseRes.productIdentifier && (!prod.productIdentifier || prod.productIdentifier !== parseRes.productIdentifier)) {
          proposedChanges.productIdentifier = parseRes.productIdentifier;
          needsUpdate = true;
        }
        if (prod.code !== normalizedCode) {
          proposedChanges.code = normalizedCode;
          proposedChanges.productCode = normalizedCode;
          needsUpdate = true;
        }
      }
      // CASE C & D: MANUAL_PRODUCT_CODE (Starts with digit or custom format)
      // DO NOT derive Alumina! Preserve existing manual values.
      else {
        if (prod.code !== normalizedCode) {
          proposedChanges.code = normalizedCode;
          proposedChanges.productCode = normalizedCode;
          needsUpdate = true;
        }
      }

      return {
        product: prod,
        parseResult: parseRes,
        needsUpdate,
        proposedChanges,
      };
    });

    setAnalyzedItems(analysis);
    setIsAnalyzeModalOpen(true);
  };

  const handleApplyAnalysis = async () => {
    const updatable = analyzedItems.filter((i) => i.needsUpdate && i.product.id);
    if (updatable.length === 0) return;

    setIsApplyingAnalysis(true);
    try {
      // Chunk batches by 400 for safety
      const chunkSize = 400;
      for (let i = 0; i < updatable.length; i += chunkSize) {
        const chunk = updatable.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        for (const item of chunk) {
          if (item.product.id) {
            const ref = doc(db, 'products', item.product.id);
            batch.update(ref, {
              ...item.proposedChanges,
              updatedAt: serverTimestamp(),
            });
          }
        }

        await batch.commit();
      }

      await logAuditAction(
        'BULK_UPDATE_PRODUCT_INTELLIGENCE',
        'products',
        'bulk',
        `تم تطبيق التحديث الذكي وتوليد الحقول المشتقة وتطبيع الفهارس لعدد (${updatable.length}) منتج بنجاح`
      );

      setAnalysisAppliedMessage(`تم تحديث وتطبيع بيانات (${updatable.length}) منتج بالمعلومات المشتقة بنجاح مع الحفاظ على الأكواد الرقمية والمدخلات اليدوية دون المساس بالأوزان أو الأبعاد.`);
      
      // Re-run analysis to reflect updated state
      setTimeout(() => {
        handleOpenAnalyzeCodes();
      }, 800);
    } catch (err: any) {
      console.error('Error applying analysis:', err);
      alert('حدث خطأ أثناء تطبيق التحديث: ' + (err.message || 'خطأ غير معروف'));
    } finally {
      setIsApplyingAnalysis(false);
    }
  };

  const handleExport = () => {
    const currentTabObj = tabs.find((t) => t.id === activeTab);
    exportMasterDataToExcel(
      visibleItems,
      currentTabObj?.label || activeTab,
      `بيانات_${currentTabObj?.label || activeTab}.xlsx`
    );
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/*
        What is being browsed, plus the actions for it.

        This used to hold a THIRD category dropdown, on top of the row below and
        the panel above it - and choosing cost centres from it opened the
        hierarchy maintenance modal instead of showing the records, which is why
        browsing cost centres never felt like browsing master data. Navigation
        is the single row below; this is a heading.
      */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col lg:flex-row lg:items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <p className="block text-[11px] font-black text-slate-500 mb-1">
            {language === 'ar' ? 'البيانات المعروضة' : 'Showing'}
          </p>
          <p id="master-data-active-category" className="text-sm font-black text-slate-900">
            {currentCategory
              ? (language === 'ar' ? currentCategory.labelAr : currentCategory.labelEn)
              : (language === 'ar' ? 'غير محدد' : 'Unspecified')}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-[11px] font-bold text-slate-600">
          <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100">
            {language === 'ar' ? 'عدد الأكواد' : 'Codes'}
            <span className="text-slate-900 font-black">{items.length}</span>
          </span>
          {currentCategory?.hierarchical && (
            <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">
              <Layers className="w-3.5 h-3.5" />
              {language === 'ar' ? 'تصنيف هرمي - الأصل يشمل كل الفروع' : 'Hierarchical - a parent includes every descendant'}
            </span>
          )}
          {activeTab === 'financialAccounts' && (
            <button
              id="master-data-import-financial-accounts-btn"
              type="button"
              /*
               * Opens the DEDICATED Financial Accounts importer, in place.
               *
               * This used to call onNavigate('bulk-entry'), and App.tsx routes
               * both `bulk-entry` and `historical-import` to <DataImportView />
               * - the Historical Excel Import centre. Importing a chart of
               * accounts must never leave Master Data, so it no longer
               * navigates at all.
               */
              onClick={() => setIsAccountsImportOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 transition-colors cursor-pointer"
              title={language === 'ar' ? 'استيراد الحسابات المالية من ملف Excel باستخدام محرك الاستيراد الحالي' : 'Import financial accounts from Excel using the existing import engine'}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              {language === 'ar' ? 'استيراد الحسابات المالية' : 'Import Financial Accounts'}
            </button>
          )}
          {activeTab === 'financialAccounts' && (
            <button
              id="master-data-import-financial-transactions-btn"
              type="button"
              /* Actual spending by account and cost centre, for the Dashboard's financial values. */
              onClick={() => setIsTransactionsImportOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-emerald-900 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors cursor-pointer"
              title={language === 'ar' ? 'استيراد المصروفات الفعلية حسب الحساب ومركز التكلفة' : 'Import actual spending by account and cost centre'}
            >
              <UploadCloud className="w-3.5 h-3.5" />
              {language === 'ar' ? 'استيراد المعاملات المالية' : 'Import Financial Transactions'}
            </button>
          )}
          <button
            id="master-data-cost-center-hierarchy-btn"
            type="button"
            onClick={() => setIsHierarchyPanelOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer"
            title={language === 'ar' ? 'استعراض وتحرير التسلسل الهرمي لمراكز التكلفة' : 'Browse and edit the cost center hierarchy'}
          >
            <Layers className="w-3.5 h-3.5 text-amber-600" />
            {language === 'ar' ? 'التسلسل الهرمي لمراكز التكلفة' : 'Cost Center Hierarchy'}
          </button>
        </div>
      </div>

      {/*
        The primary Master Data navigation - one control, not two.

        A multi-select panel used to sit above this row offering the very same
        categories, so picking one took two steps and the screen showed the
        choice twice. This row is the whole navigation now.

        The list comes from the shared registry. Presses, furnaces, mills and
        the legacy departments list are deliberately absent: those are the same
        business entities the cost-centre hierarchy already represents, and
        listing them again presented one machine as two master records. Their
        data is untouched and still reached through the equipment link.
      */}
      <div id="master-data-primary-categories" className="bg-white rounded-2xl p-2 border border-slate-200 shadow-xs flex items-center gap-1.5 overflow-x-auto">
        {areaCategories.map((category) => {
          const Icon = iconForCategory(category.id);
          const isActive = activeCategoryId === category.id;
          return (
            <button
              key={category.id}
              id={`master-data-category-${category.id}`}
              type="button"
              onClick={() => { setActiveCategoryId(category.id); setCostCenterDigits([]); }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                isActive ? 'bg-amber-400 text-slate-950 shadow-xs' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-slate-950' : 'text-slate-500'}`} />
              <span>{language === 'ar' ? category.labelAr : category.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/*
        Cost-centre sub-categories.

        The 5/6/7/8/9 split is the EXISTING rule from the Sheet1 import - the
        root is the code's first character - so a code outside that range, or
        one with a leading zero like "0501", is counted as unclassified rather
        than forced into a bucket. This is a Cost Centre classification and has
        nothing to do with the Production Equipment hierarchy.
      */}
      {isCostCenterActive && costCenterCounts && (
        <div id="cost-center-subcategories" className="bg-white rounded-2xl p-3 border border-slate-200 shadow-xs space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs font-black text-slate-700">
              {language === 'ar' ? 'تصنيفات مراكز التكلفة' : 'Cost centre classifications'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCostCenterDigits(selectAllSubCategories())}
                className="px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                {language === 'ar' ? 'تحديد الكل' : 'Select all'}
              </button>
              <button
                type="button"
                onClick={() => setCostCenterDigits([])}
                disabled={costCenterDigits.length === 0}
                className="px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {language === 'ar' ? 'إلغاء التحديد' : 'Clear'}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {costCenterSubCategories().map((sub) => {
              const count = costCenterCounts.byDigit[sub.digit] ?? 0;
              return (
                <label
                  key={sub.digit}
                  className={`flex items-center gap-2 text-xs font-semibold cursor-pointer ${count === 0 ? 'text-slate-400' : 'text-slate-700'}`}
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-amber-500 cursor-pointer shrink-0"
                    checked={costCenterDigits.includes(sub.digit)}
                    onChange={() => setCostCenterDigits((prev) => toggleSubCategory(prev, sub.digit))}
                  />
                  <span>{`${sub.digit} — ${sub.labelAr} (${count})`}</span>
                </label>
              );
            })}
          </div>
          {costCenterCounts.unclassified > 0 && (
            <p className="text-[10px] font-semibold text-amber-800">
              {language === 'ar'
                ? `${costCenterCounts.unclassified} سجل لا يبدأ كوده بأي من 5-9، ولذلك لا يظهر تحت أي تصنيف منها.`
                : `${costCenterCounts.unclassified} record(s) have a code not starting with 5-9, so they appear under none of these classifications.`}
            </p>
          )}
        </div>
      )}

      {/*
        Area 3's controls and table. Hidden entirely while no category is
        chosen - leaving them visible would show the previously loaded rows
        under a heading that no longer applies.
      */}
      {/* Control Bar: Search, Filters, Add Button, Bulk Import Link, Excel Export */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search & Status Filter */}
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              id="master-data-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                activeTab === 'products'
                  ? (language === 'ar' ? 'البحث بالكود الذكي (مثال: BAR25)، البادئة، نسبة الألومينا، أو الاسم...' : 'Search by smart code (e.g. BAR25), prefix, alumina %, or name...')
                  : activeTab === 'productTypes'
                  ? (language === 'ar' ? 'البحث بالبادئة (BAR, BHA) أو الاسم بالإنجليزية/العربية...' : 'Search by prefix (BAR, BHA) or English/Arabic name...')
                  : (language === 'ar' ? 'البحث بالكود، الاسم، أو التصنيف...' : 'Search by code, name, or category...')
              }
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-4 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:bg-white transition-colors"
            />
          </div>

          {/* Product Prefix Dropdown Filter (when on products tab) */}
          {activeTab === 'products' && (
            <select
              value={prefixFilter}
              onChange={(e) => setPrefixFilter(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 font-bold focus:outline-none focus:border-amber-500"
            >
              <option value="all">{language === 'ar' ? `جميع البادئات (${productTypes.length})` : `All Prefixes (${productTypes.length})`}</option>
              {productTypes.map((pt) => (
                <option key={pt.prefixCode} value={pt.prefixCode}>
                  {pt.prefixCode} - {pt.nameAr || pt.nameEn}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? `الكل (${items.length})` : `All (${items.length})`}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'active' ? 'bg-white text-emerald-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'النشط' : 'Active'}
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('inactive')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                statusFilter === 'inactive' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {language === 'ar' ? 'المعطل' : 'Inactive'}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            id="master-data-quality-btn"
            type="button"
            onClick={() => setIsQualityModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-emerald-850 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 rounded-xl transition-colors cursor-pointer"
            title={language === 'ar' ? 'فحص شامل لسلامة وتناسق البيانات واكتشاف الأكواد المكررة وتصنيفات الأكواد الرقمية' : 'Comprehensive data integrity check - detects duplicate codes and numeric code classifications'}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            <span>{language === 'ar' ? 'فحص جودة البيانات' : 'Data Quality Check'}</span>
          </button>

          <button
            id="master-data-quality-report-btn"
            type="button"
            onClick={() => setIsQualityReportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-purple-800 bg-purple-50 border border-purple-300 hover:bg-purple-100 rounded-xl transition-colors cursor-pointer"
            title={language === 'ar' ? 'اكتشاف الأكواد المكررة، الأسماء المتشابهة، فجوات التسلسل، وحذف/أرشفة آمنة للسجلات المشبوهة' : 'Detect duplicate codes, similar names, sequence gaps, and safely delete/archive suspicious records'}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-purple-600" />
            <span>{language === 'ar' ? 'تقرير جودة البيانات الأساسية' : 'Master Data Quality Report'}</span>
          </button>

          {/*
            Reconciliation entry point.

            It used to be an inline banner gated on BOTH being on an equipment
            tab AND having a non-zero match or ambiguity - so with the hierarchy
            not yet imported, or simply while looking at Products, it did not
            exist on screen at all. It is a Master Data utility now, always
            reachable, and the panel itself reports zero states rather than
            vanishing.

            This is NOT the Cost Center hierarchy browser next to the tabs -
            that is a different feature with a different label.
          */}
          <button
            id="master-data-reconcile-btn"
            type="button"
            onClick={() => setIsReconcileOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-sky-800 bg-sky-50 border border-sky-300 hover:bg-sky-100 rounded-xl transition-colors cursor-pointer"
            title={language === 'ar'
              ? 'مطابقة أكواد المعدات القديمة مع عقد التسلسل الهرمي - عرض فقط في هذه المرحلة'
              : 'Match legacy equipment codes against hierarchy nodes - read-only at this stage'}
          >
            <Layers className="w-3.5 h-3.5 text-sky-600" />
            <span>{language === 'ar' ? 'مطابقة الأكواد مع التسلسل الهرمي' : 'Reconcile Codes with Hierarchy'}</span>
          </button>

          {activeTab === 'products' && (
            <button
              id="master-data-analyze-codes-btn"
              type="button"
              onClick={handleOpenAnalyzeCodes}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-xl transition-colors cursor-pointer"
              title={language === 'ar' ? 'فحص واستخراج الحقول المشتقة لمنتجات قاعدة البيانات الحالية دون المساس بالأوزان أو الأبعاد' : "Inspect and derive fields for the current database's products without touching weights or dimensions"}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span>{language === 'ar' ? 'تحليل الأكواد الحالية' : 'Analyze Current Codes'}</span>
            </button>
          )}

          <button
            id="master-data-export-btn"
            type="button"
            onClick={handleExport}
            disabled={visibleItems.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{language === 'ar' ? 'تصدير Excel' : 'Export Excel'}</span>
          </button>

          {activeTab !== 'productTypes' && (
            <button
              id="master-data-bulk-link-btn"
              type="button"
              onClick={() => onNavigate('bulk-entry')}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-xl transition-colors cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5 text-amber-700" />
              <span>{language === 'ar' ? 'استيراد مجمع' : 'Bulk Import'}</span>
            </button>
          )}

          <button
            id="master-data-add-btn"
            type="button"
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>
              {activeTab === 'productTypes'
                ? (language === 'ar' ? 'إضافة تصنيف جديد' : 'Add New Type')
                : (language === 'ar' ? 'إضافة سجل جديد' : 'Add New Record')}
            </span>
          </button>
        </div>
      </div>

      {/*
        How much equipment is still outside hierarchy filtering.

        Reported rather than fixed automatically: assigning these by fuzzy name
        match would silently attach production to the wrong branch, so the count
        is surfaced and the assignment stays an explicit human decision.
      */}
      {isEquipmentTab && unlinkedEquipmentCount > 0 && (
        <div id="equipment-hierarchy-status" className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3 text-xs font-bold text-amber-900">
          {language === 'ar'
            ? `${unlinkedEquipmentCount} من ${items.length} سجل غير مرتبط بعقدة هرمية - لن تظهر هذه السجلات عند اختيار عقدة أب في التصفية.`
            : `${unlinkedEquipmentCount} of ${items.length} record(s) are not linked to a hierarchy node - they will not appear when an ancestor node is selected in a filter.`}
        </div>
      )}

      {/* Master Data Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {/*
          Selection acts on the VISIBLE rows of the CURRENT category only.
          "Select All" means every row that survives the current search and
          status filter - never every row in the collection - so what the
          count says is exactly what is on screen.
        */}
        <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 flex-wrap text-xs">
          <span className="font-bold text-slate-600">
            {language === 'ar' ? 'الظاهر' : 'Visible'}: <span className="text-slate-900">{visibleItems.length}</span>
          </span>
          <span className="font-bold text-slate-600">
            {language === 'ar' ? 'المحدد' : 'Selected'}: <span className="text-sky-700">{selectedCodes.length}</span>
          </span>
          <button
            id="master-data-select-all-btn"
            type="button"
            disabled={visibleItems.length === 0}
            onClick={() => setSelectedCodes([...new Set(visibleItems.map(codeOfItem).filter(Boolean))])}
            className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
          >
            {language === 'ar' ? 'تحديد الكل' : 'Select All'}
          </button>
          <button
            id="master-data-deselect-all-btn"
            type="button"
            disabled={selectedCodes.length === 0}
            onClick={() => setSelectedCodes([])}
            className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
          >
            {language === 'ar' ? 'إلغاء تحديد الكل' : 'Deselect All'}
          </button>
          <button
            id="master-data-clear-selection-btn"
            type="button"
            onClick={() => { setSelectedCodes([]); setSearchQuery(''); setStatusFilter('all'); setPrefixFilter('all'); }}
            className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            {language === 'ar' ? 'مسح' : 'Clear'}
          </button>
          {selectedCodes.length > 0 && (
            <span className="text-[11px] text-slate-500 font-medium truncate max-w-full" dir="ltr">
              {selectedCodes.slice(0, 12).join(', ')}{selectedCodes.length > 12 ? ' …' : ''}
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="py-16 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
            <p className="text-xs font-semibold">{language === 'ar' ? 'جارٍ تحميل البيانات من Firestore...' : 'Loading data from Firestore...'}</p>
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">{language === 'ar' ? 'لا توجد سجلات مطابقة' : 'No matching records'}</p>
            <p className="text-xs text-slate-400 mt-1">
              {language === 'ar' ? 'يمكنك إضافة سجل جديد أو استخدام الاستيراد المجمع لرفع ملفات Excel.' : 'You can add a new record or use Bulk Import to upload Excel files.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[calc(100vh-360px)] lg:max-h-[calc(100vh-320px)] overflow-y-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-3.5 w-10">
                    <input
                      type="checkbox"
                      aria-label={language === 'ar' ? 'تحديد كل الصفوف الظاهرة' : 'Select all visible rows'}
                      checked={visibleItems.length > 0 && visibleItems.every((i) => selectedCodes.includes(codeOfItem(i)))}
                      onChange={(e) =>
                        setSelectedCodes(
                          e.target.checked
                            ? [...new Set(visibleItems.map(codeOfItem).filter(Boolean))]
                            : []
                        )
                      }
                      className="w-3.5 h-3.5 cursor-pointer accent-amber-500"
                    />
                  </th>
                  {activeTab === 'productTypes' ? (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'البادئة (Prefix)' : 'Prefix'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الاسم بالإنجليزية (Name EN)' : 'Name (EN)'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الاسم بالعربية (Name AR)' : 'Name (AR)'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الوصف والبيان' : 'Description'}</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الكود' : 'Code'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الاسم / البيان' : 'Name / Description'}</th>
                    </>
                  )}

                  {activeTab === 'products' && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'نوع المنتج / البادئة' : 'Product Type / Prefix'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'نسبة الألومينا' : 'Alumina Percentage'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'المعرف الداخلي' : 'Internal ID'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'وزن القطعة (كجم)' : 'Piece Weight (kg)'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الأبعاد' : 'Dimensions'}</th>
                    </>
                  )}
                  {activeTab === 'employees' && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'المسمى الوظيفي' : 'Job Title'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'القسم' : 'Department'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الهاتف' : 'Phone'}</th>
                    </>
                  )}
                  {activeTab === 'presses' && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الحمولة' : 'Tonnage'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الموديل' : 'Model'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الحالة التشغيلية' : 'Operating Status'}</th>
                    </>
                  )}
                  {/* Whether this equipment participates in hierarchy filtering at all. */}
                  {isEquipmentTab && (
                    <th className="px-4 py-3.5">{language === 'ar' ? 'التسلسل الهرمي' : 'Hierarchy'}</th>
                  )}
                  {activeTab === 'mills' && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الموديل' : 'Model'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الحالة التشغيلية' : 'Operating Status'}</th>
                    </>
                  )}
                  {activeTab === 'furnaces' && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'السعة (طن)' : 'Capacity (t)'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'أقصى حرارة' : 'Max Temperature'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                    </>
                  )}
                  {activeTab === 'furnaceCars' && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'رقم العربة' : 'Car Number'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الفرن المخصص' : 'Assigned Furnace'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'السعة' : 'Capacity'}</th>
                    </>
                  )}
                  {activeTab === 'customers' && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الشركة' : 'Company'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الهاتف' : 'Phone'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'البريد' : 'Email'}</th>
                    </>
                  )}
                  {activeTab === 'shifts' && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'ساعات العمل' : 'Working Hours'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'المواعيد' : 'Timing'}</th>
                    </>
                  )}
                  {activeTab === 'financialAccounts' && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الاسم بالإنجليزية' : 'Name (EN)'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'نوع الحساب' : 'Account Type'}</th>
                    </>
                  )}
                  {currentCategory?.hierarchical && (
                    <>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'الحساب الأصل' : 'Parent'}</th>
                      <th className="px-4 py-3.5">{language === 'ar' ? 'المسار الكامل' : 'Full Path'}</th>
                    </>
                  )}
                  <th className="px-4 py-3.5">{language === 'ar' ? 'حالة التفعيل' : 'Active Status'}</th>
                  <th className="px-4 py-3.5 text-center">{language === 'ar' ? 'الإجراءات' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {visibleItems.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`${language === 'ar' ? 'تحديد' : 'Select'} ${codeOfItem(item)}`}
                        checked={selectedCodes.includes(codeOfItem(item))}
                        onChange={() => {
                          const code = codeOfItem(item);
                          setSelectedCodes((prev) =>
                            prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
                          );
                        }}
                        className="w-3.5 h-3.5 cursor-pointer accent-amber-500"
                      />
                    </td>
                    {activeTab === 'productTypes' ? (
                      <>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg font-mono font-black text-xs bg-indigo-50 border border-indigo-200 text-indigo-700">
                            {item.prefixCode}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900 font-sans" dir="ltr">
                          {item.nameEn}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800">
                          {item.nameAr}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-[11px]">
                          {item.description || '-'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">
                          {item.code || '-'}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-800">
                          {item.name || item.carNumber || '-'}
                        </td>
                      </>
                    )}

                    {/* Products details */}
                    {activeTab === 'products' && (
                      <>
                        <td className="px-4 py-3">
                          {item.productTypePrefix ? (
                            <div className="flex items-center gap-1.5">
                              <span className="px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-900 text-amber-400">
                                {item.productTypePrefix}
                              </span>
                              <span className="text-slate-700 font-semibold text-[11px]">
                                {item.productTypeNameAr || item.productTypeName || item.category || '-'}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">{language === 'ar' ? 'تصنيف يدوي / سابق' : 'Manual / Legacy'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {item.aluminaPercentage !== undefined && item.aluminaPercentage !== null ? (
                            <Badge variant="amber">{item.aluminaPercentage}% {language === 'ar' ? 'ألومينا' : 'Alumina'}</Badge>
                          ) : (
                            <span className="text-slate-400 text-xs">{language === 'ar' ? 'غير محدد' : 'Unspecified'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-600">
                          {item.productIdentifier || (item.code && item.code.length > 5 ? item.code.substring(5) : '-')}
                        </td>
                        <td className="px-4 py-3 font-bold text-slate-900">
                          {item.pieceWeight || item.pieceWeightKg ? `${item.pieceWeight || item.pieceWeightKg} ${language === 'ar' ? 'كجم' : 'kg'}` : <span className="text-slate-400 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-500">{item.dimensions || '-'}</td>
                      </>
                    )}

                    {/* Employees details */}
                    {activeTab === 'employees' && (
                      <>
                        <td className="px-4 py-3 text-slate-700">{item.jobTitle || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{item.departmentName || '-'}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{item.phone || '-'}</td>
                      </>
                    )}

                    {/* Presses details */}
                    {activeTab === 'presses' && (
                      <>
                        <td className="px-4 py-3 font-bold">{item.tonnage ? `${item.tonnage} ${language === 'ar' ? 'طن' : 't'}` : '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{item.model || '-'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={item.status === 'active' ? 'success' : item.status === 'maintenance' ? 'warning' : 'danger'}>
                            {item.status === 'active'
                              ? (language === 'ar' ? 'جاهز للعمل' : 'Ready')
                              : item.status === 'maintenance'
                              ? (language === 'ar' ? 'صيانة' : 'Maintenance')
                              : (language === 'ar' ? 'معطل' : 'Inactive')}
                          </Badge>
                        </td>
                      </>
                    )}

                    {/* Chinese Mills details */}
                    {activeTab === 'mills' && (
                      <>
                        <td className="px-4 py-3 text-slate-600">{item.model || '-'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={item.status === 'active' ? 'success' : item.status === 'maintenance' ? 'warning' : 'danger'}>
                            {item.status === 'active'
                              ? (language === 'ar' ? 'جاهز للعمل' : 'Ready')
                              : item.status === 'maintenance'
                              ? (language === 'ar' ? 'صيانة' : 'Maintenance')
                              : (language === 'ar' ? 'معطل' : 'Inactive')}
                          </Badge>
                        </td>
                      </>
                    )}

                    {/* Furnaces details */}
                    {activeTab === 'furnaces' && (
                      <>
                        <td className="px-4 py-3 font-bold">{item.capacity ? `${item.capacity} ${language === 'ar' ? 'طن' : 't'}` : '-'}</td>
                        <td className="px-4 py-3 text-rose-700 font-bold">{item.maxTemperature ? `${item.maxTemperature} °C` : '-'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={item.status === 'active' ? 'success' : 'warning'}>
                            {item.status === 'active' ? (language === 'ar' ? 'يعمل' : 'Running') : (language === 'ar' ? 'صيانة' : 'Maintenance')}
                          </Badge>
                        </td>
                      </>
                    )}

                    {/* Furnace Cars details */}
                    {activeTab === 'furnaceCars' && (
                      <>
                        <td className="px-4 py-3 font-mono font-bold text-slate-900">{item.carNumber}</td>
                        <td className="px-4 py-3 text-slate-600">{item.furnaceName || '-'}</td>
                        <td className="px-4 py-3">{item.capacity ? `${item.capacity} ${language === 'ar' ? 'قطعة' : 'pcs'}` : '-'}</td>
                      </>
                    )}

                    {/* Customers details */}
                    {activeTab === 'customers' && (
                      <>
                        <td className="px-4 py-3 font-bold">{item.company || '-'}</td>
                        <td className="px-4 py-3 font-mono text-slate-600">{item.phone || '-'}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{item.email || '-'}</td>
                      </>
                    )}

                    {/* Shifts details */}
                    {activeTab === 'shifts' && (
                      <>
                        <td className="px-4 py-3 font-bold">{item.hours} {language === 'ar' ? 'ساعات' : 'hrs'}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">
                          {item.startTime} &rarr; {item.endTime}
                        </td>
                      </>
                    )}

                    {activeTab === 'financialAccounts' && (
                      <>
                        <td className="px-4 py-3 text-slate-600" dir="ltr">{item.nameEn || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{item.accountType || '-'}</td>
                      </>
                    )}
                    {currentCategory?.hierarchical && (
                      <>
                        <td className="px-4 py-3 font-mono text-slate-500" dir="ltr">
                          {item?.[currentCategory.parentField || 'parentCode'] || (language === 'ar' ? 'جذر' : 'root')}
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-[11px]">
                          {/* Derived from parent links by the shared resolver, never a stored path. */}
                          {hierarchyIndex
                            ? getNodePath(
                                hierarchyIndex,
                                codeOfItem(item),
                                (node: any) => String(node.name || node.code || node.id)
                              )
                            : ''}
                        </td>
                      </>
                    )}

                    {/* Active toggle */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => handleToggleStatus(item)}
                        className="cursor-pointer"
                        title={item.active !== false ? (language === 'ar' ? 'تعطيل السجل' : 'Deactivate record') : (language === 'ar' ? 'تفعيل السجل' : 'Activate record')}
                      >
                        {item.active !== false ? (
                          <Badge variant="success">{language === 'ar' ? 'نشط' : 'Active'}</Badge>
                        ) : (
                          <Badge variant="danger">{language === 'ar' ? 'معطل' : 'Inactive'}</Badge>
                        )}
                      </button>
                    </td>

                    {/*
                      Hierarchy link status - lets the user see at a glance which
                      equipment is not yet reachable by a parent-node filter.
                    */}
                    {isEquipmentTab && (
                      <td className="px-4 py-3">
                        {hierarchyLabelFor(item.hierarchyNodeId) ? (
                          <span className="text-[11px] font-semibold text-emerald-800" title={hierarchyLabelFor(item.hierarchyNodeId) || ''}>
                            {hierarchyLabelFor(item.hierarchyNodeId)}
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-slate-400">
                            {language === 'ar' ? 'غير مرتبط' : 'Not linked'}
                          </span>
                        )}
                      </td>
                    )}

                    {/* Actions */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          title={language === 'ar' ? 'تعديل' : 'Edit'}
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmItem(item)}
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
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={
          editingItem
            ? (language === 'ar' ? `تعديل سجل في ${tabs.find((t) => t.id === activeTab)?.label}` : `Edit Record in ${tabs.find((t) => t.id === activeTab)?.label}`)
            : (language === 'ar' ? `إضافة سجل جديد في ${tabs.find((t) => t.id === activeTab)?.label}` : `Add New Record in ${tabs.find((t) => t.id === activeTab)?.label}`)
        }
        subtitle={language === 'ar' ? 'جميع البيانات يتم التحقق منها ومزامنتها مباشرة مع قاعدة بيانات Firestore' : 'All data is validated and synced directly with the Firestore database'}
        maxWidth="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* Form for Product Types (Prefix Master) */}
          {activeTab === 'productTypes' && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'بادئة الكود (3 أحرف إنجليزية) *' : 'Prefix Code (3 English letters) *'}
                </label>
                <input
                  type="text"
                  maxLength={3}
                  required
                  value={formData.prefixCode || ''}
                  onChange={(e) => setFormData({ ...formData, prefixCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                  placeholder={language === 'ar' ? 'مثال: BAR, BHA, BSI' : 'e.g. BAR, BHA, BSI'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold uppercase text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                />
                <p className="text-[11px] text-slate-500 mt-1">{language === 'ar' ? 'يجب أن تتكون البادئة من 3 أحرف لاتينية بالضبط مثل (BAR أو BHA).' : 'The prefix must be exactly 3 Latin letters, e.g. BAR or BHA.'}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {language === 'ar' ? 'الاسم بالإنجليزية *' : 'Name in English *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nameEn || ''}
                    onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                    placeholder="e.g. Bricks Acid Resistance"
                    dir="ltr"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {language === 'ar' ? 'الاسم بالعربية *' : 'Name in Arabic *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.nameAr || ''}
                    onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })}
                    placeholder={language === 'ar' ? 'مثال: طوب مقاوم للأحماض' : 'e.g. Acid-resistant brick'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الوصف والبيان' : 'Description'}</label>
                <textarea
                  rows={2}
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="ملاحظات ومواصفات نوع المنتج..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                />
              </div>
            </>
          )}

          {/* Form for Products (Intelligent Structured Code) */}
          {activeTab === 'products' && (
            <>
              {/* Product Code Input with Live Intelligence */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-bold text-slate-700">
                    {language === 'ar' ? 'كود المنتج الذكي *' : 'Smart Product Code *'}
                  </label>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {language === 'ar' ? '[البادئة 3 أحرف] + [الألومينا خانتان] + [المعرف]' : '[3-letter prefix] + [2-digit alumina] + [identifier]'}
                  </span>
                </div>
                <input
                  id="product-form-code-input"
                  type="text"
                  required
                  value={formData.code || ''}
                  onChange={(e) => handleProductCodeChange(e.target.value)}
                  placeholder={language === 'ar' ? 'مثال: BAR250102305 أو BHA70123456' : 'e.g. BAR250102305 or BHA70123456'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono font-black uppercase text-slate-950 tracking-wider focus:outline-none focus:border-amber-500 focus:bg-white"
                />
              </div>

              {/* Real-time Parser Intelligence Card */}
              {liveProductParseResult && formData.code && (
                <div className={`p-3.5 rounded-xl border text-xs ${
                  liveProductParseResult.smartParseStatus === 'SMART_CODE'
                    ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                    : liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX'
                    ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                    : liveProductParseResult.smartParseStatus === 'INVALID_FORMAT'
                    ? 'bg-orange-50/80 border-orange-200 text-orange-950'
                    : 'bg-slate-50 border-slate-200 text-slate-800'
                }`}>
                  <div className="flex items-center justify-between pb-2 border-b border-black/5 mb-2.5">
                    <div className="flex items-center gap-1.5 font-bold">
                      {liveProductParseResult.smartParseStatus === 'SMART_CODE' ? (
                        <>
                          <Sparkles className="w-4 h-4 text-emerald-600" />
                          <span className="text-emerald-800">SMART CODE DETECTED (كود ذكي معتمد)</span>
                        </>
                      ) : liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX' ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-amber-600" />
                          <span className="text-amber-800">UNKNOWN PRODUCT PREFIX (بادئة غير مسجلة)</span>
                        </>
                      ) : liveProductParseResult.smartParseStatus === 'INVALID_FORMAT' ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-orange-600" />
                          <span className="text-orange-800">INVALID SMART FORMAT — MANUAL ENTRY ALLOWED</span>
                        </>
                      ) : (
                        <>
                          <Info className="w-4 h-4 text-slate-500" />
                          <span className="text-slate-700">MANUAL CODE (كود يدوي / يبدأ برقم)</span>
                        </>
                      )}
                    </div>

                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-white/90 border border-black/10">
                      {liveProductParseResult.smartParseStatus === 'SMART_CODE' 
                        ? 'SMART_CODE ✅' 
                        : liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX' 
                        ? 'UNKNOWN_PREFIX ⚠️' 
                        : liveProductParseResult.smartParseStatus === 'INVALID_FORMAT'
                        ? 'INVALID_FORMAT ✍️'
                        : 'MANUAL_CODE 🔢'}
                    </span>
                  </div>

                  {liveProductParseResult.smartParseStatus === 'SMART_CODE' || liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX' ? (
                    <>
                      {/* 4 Detected Segments Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
                        <div className="bg-white/80 p-2 rounded-lg border border-slate-200/60">
                          <span className="block text-[10px] text-slate-500 font-sans">1. البادئة (Prefix)</span>
                          <span className="text-xs font-black text-slate-900">{liveProductParseResult.prefix || '-'}</span>
                        </div>

                        <div className="bg-white/80 p-2 rounded-lg border border-slate-200/60">
                          <span className="block text-[10px] text-slate-500 font-sans">2. نوع المنتج (Type)</span>
                          <span className="text-[11px] font-bold text-indigo-700 truncate block">
                            {liveProductParseResult.productType?.nameAr || liveProductParseResult.productType?.nameEn || (
                              <span className="text-amber-700 font-sans">غير مسجل (يدوي)</span>
                            )}
                          </span>
                        </div>

                        <div className="bg-white/80 p-2 rounded-lg border border-slate-200/60">
                          <span className="block text-[10px] text-slate-500 font-sans">3. نسبة الألومينا</span>
                          <span className="text-xs font-black text-amber-700">
                            {liveProductParseResult.aluminaPercentage !== undefined ? `${liveProductParseResult.aluminaPercentage}%` : '-'}
                          </span>
                        </div>

                        <div className="bg-white/80 p-2 rounded-lg border border-slate-200/60">
                          <span className="block text-[10px] text-slate-500 font-sans">4. المعرف الداخلي</span>
                          <span className="text-xs font-bold text-slate-700">{liveProductParseResult.productIdentifier || '-'}</span>
                        </div>
                      </div>

                      {/* Unknown Prefix Action Banner */}
                      {liveProductParseResult.smartParseStatus === 'UNKNOWN_PREFIX' && liveProductParseResult.prefix.length === 3 && (
                        <div className="mt-3 pt-2.5 border-t border-amber-200/80 flex items-center justify-between flex-wrap gap-2">
                          <p className="text-[11px] text-amber-900">
                            البادئة <span className="font-mono font-bold">"{liveProductParseResult.prefix}"</span> غير مسجلة في جدول التصنيفات. يمكنك إضافتها الآن أو المتابعة بإدخال يدوي.
                          </p>
                          <button
                            type="button"
                            onClick={() => handleOpenQuickType(liveProductParseResult.prefix)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer"
                          >
                            <PlusCircle className="w-3.5 h-3.5" />
                            <span>إضافة تصنيف {liveProductParseResult.prefix} الآن +</span>
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {liveProductParseResult.isNumericStart
                        ? 'كود يبدأ برقم: يُعامل كـ MANUAL_CODE بدون اشتقاق آلي لنسبة الألومينا. يمكنك إدخال نوع المنتج ونسبة الألومينا يدوياً.'
                        : 'كود ذو تنسيق مخصص: إدخال يدوي متاح بالكامل لجميع الحقول.'}
                    </p>
                  )}
                </div>
              )}

              {/* Product Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'اسم المنتج / التوصيف *' : 'Product Name / Description *'}
                </label>
                <input
                  id="product-form-name-input"
                  type="text"
                  required
                  value={formData.name || ''}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={language === 'ar' ? 'مثال: طوب عالي الألومينا 70% - قياسي' : 'e.g. High Alumina Brick 70% - Standard'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:border-amber-500 focus:bg-white"
                />
              </div>

              {/* Category and Alumina % */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'التصنيف / نوع المنتج' : 'Category / Product Type'}</label>
                  <input
                    type="text"
                    value={formData.category || formData.productTypeNameAr || formData.productTypeName || ''}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value, isManualClassification: true })}
                    placeholder={language === 'ar' ? 'طوب حراري / كتل كبس' : 'Refractory brick / Pressed blocks'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-800"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-slate-700">{language === 'ar' ? 'نسبة الألومينا (%)' : 'Alumina Percentage (%)'}</label>
                    {manualOverrideAlumina && (
                      <span className="text-[10px] text-amber-700 font-bold">{language === 'ar' ? 'تعديل يدوي' : 'Manual Edit'}</span>
                    )}
                  </div>
                  <input
                    id="product-form-alumina-input"
                    type="number"
                    step="0.1"
                    min={0}
                    max={100}
                    value={formData.aluminaPercentage !== undefined && formData.aluminaPercentage !== null ? formData.aluminaPercentage : ''}
                    onChange={(e) => {
                      setManualOverrideAlumina(true);
                      const val = e.target.value;
                      setFormData({ ...formData, aluminaPercentage: val === '' ? null : Number(val) });
                    }}
                    placeholder={language === 'ar' ? 'اختياري (0-100)' : 'Optional (0-100)'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-mono font-bold text-slate-900"
                  />
                </div>
              </div>

              {/* Piece Weight & Dimensions */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'وزن القطعة (كجم)' : 'Piece Weight (kg)'}</label>
                  <input
                    id="product-form-weight-input"
                    type="number"
                    step="0.01"
                    min={0.01}
                    value={formData.pieceWeight !== undefined && formData.pieceWeight !== null ? formData.pieceWeight : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFormData({
                        ...formData,
                        pieceWeight: val === '' ? null : Number(val),
                        pieceWeightKg: val === '' ? null : Number(val)
                      });
                    }}
                    placeholder={language === 'ar' ? 'مثال: 4.5' : 'e.g. 4.5'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs font-mono font-bold text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الأبعاد' : 'Dimensions'}</label>
                  <input
                    type="text"
                    value={formData.dimensions || ''}
                    onChange={(e) => setFormData({ ...formData, dimensions: e.target.value })}
                    placeholder={language === 'ar' ? '230x114x65 مم' : '230x114x65 mm'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                  />
                </div>
              </div>
            </>
          )}

          {/* Common Code & Name for Other Entities */}
          {activeTab !== 'products' && activeTab !== 'productTypes' && (
            <>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {language === 'ar' ? 'الكود التعريفي *' : 'Identifier Code *'}
                </label>
                <input
                  type="text"
                  required
                  value={formData.code || ''}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder={language === 'ar' ? 'مثال: EMP-101 / PRESS-01' : 'e.g. EMP-101 / PRESS-01'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-amber-500 focus:bg-white"
                />
              </div>

              {activeTab !== 'furnaceCars' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {language === 'ar' ? 'الاسم / الوصف *' : 'Name / Description *'}
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.name || ''}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={language === 'ar' ? 'أدخل الاسم' : 'Enter the name'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 focus:outline-none focus:border-amber-500 focus:bg-white"
                  />
                </div>
              )}
            </>
          )}

          {/* Specific Employee Fields */}
          {activeTab === 'employees' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'المسمى الوظيفي' : 'Job Title'}</label>
                <input
                  type="text"
                  value={formData.jobTitle || ''}
                  onChange={(e) => setFormData({ ...formData, jobTitle: e.target.value })}
                  placeholder={language === 'ar' ? 'فني مكبس / عامل فرن' : 'Press Technician / Furnace Operator'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'القسم' : 'Department'}</label>
                <select
                  value={formData.departmentId || ''}
                  onChange={(e) => {
                    const deptId = e.target.value;
                    const dept = departments.find((d) => d.id === deptId);
                    setFormData({
                      ...formData,
                      departmentId: deptId,
                      departmentName: dept?.name || '',
                    });
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                >
                  <option value="">{language === 'ar' ? '-- اختر القسم --' : '-- Select Department --'}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Specific Presses Fields */}
          {activeTab === 'presses' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الحمولة (طن)' : 'Tonnage (t)'}</label>
                <input
                  type="number"
                  value={formData.tonnage ?? 1200}
                  onChange={(e) => setFormData({ ...formData, tonnage: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الموديل والصانع' : 'Model & Manufacturer'}</label>
                <input
                  type="text"
                  value={formData.model || ''}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
            </div>
          )}

          {/*
            Equipment -> hierarchy link.

            This one field is what makes the hierarchy a business dimension: a
            production record already names this equipment, so linking the
            equipment to a node lets "all production under Presses" resolve
            without touching a single historical production document.

            Stores the node's stable id, never its path - re-parenting or
            renaming a node cannot break the link.
          */}
          {isEquipmentTab && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {language === 'ar' ? 'عقدة التسلسل الهرمي (مركز التكلفة)' : 'Hierarchy node (cost centre)'}
              </label>
              <select
                id="equipment-hierarchy-node"
                value={formData.hierarchyNodeId || ''}
                onChange={(e) => setFormData({ ...formData, hierarchyNodeId: e.target.value || null })}
                disabled={hierarchyOptions.length === 0}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs disabled:opacity-60"
              >
                <option value="">{language === 'ar' ? 'غير مرتبط' : 'Not linked'}</option>
                {hierarchyOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 mt-1">
                {hierarchyOptions.length === 0
                  ? (language === 'ar'
                      ? 'لا توجد عقد هرمية مستوردة بعد - يمكن حفظ المعدة بدون ربط.'
                      : 'No hierarchy nodes imported yet - the equipment can still be saved unlinked.')
                  : (language === 'ar'
                      ? 'اختيار عقدة أب في التصفية سيشمل هذه المعدة تلقائيًا. "غير مرتبط" يبقي المعدة صالحة لكن خارج تصفية التسلسل.'
                      : 'Selecting an ancestor node in a filter will include this equipment automatically. "Not linked" keeps the equipment valid but outside hierarchy filtering.')}
              </p>
            </div>
          )}

          {/* Specific Financial Account Fields */}
          {activeTab === 'financialAccounts' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الاسم بالإنجليزية' : 'Name (EN)'}</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={formData.nameEn || ''}
                    onChange={(e) => setFormData({ ...formData, nameEn: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'نوع الحساب' : 'Account Type'}</label>
                  <input
                    type="text"
                    value={formData.accountType || ''}
                    onChange={(e) => setFormData({ ...formData, accountType: e.target.value })}
                    placeholder={language === 'ar' ? 'كما هو في الملف - بدون تصنيف مفروض' : 'As supplied - no enforced taxonomy'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الحساب الأصل' : 'Parent Account'}</label>
                <select
                  value={formData.parentCode || ''}
                  onChange={(e) => setFormData({ ...formData, parentCode: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                >
                  <option value="">{language === 'ar' ? '-- بدون أصل (حساب جذر) --' : '-- No parent (root account) --'}</option>
                  {items
                    // An account can never be offered itself as its own parent.
                    // Deeper cycles are refused on save by the shared resolver.
                    .filter((a) => !editingItem || a.code !== editingItem.code)
                    .map((a) => (
                      <option key={a.id} value={a.code}>
                        {a.code} - {a.name}
                      </option>
                    ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500 font-medium">
                  {language === 'ar'
                    ? 'اختيار حساب أصل في التقارير يعني الحساب نفسه وكل الحسابات التابعة له مهما كان عمقها.'
                    : 'Selecting a parent means that account plus every account beneath it, to any depth.'}
                </p>
              </div>
              {editingItem && (
                <p className="text-[11px] text-slate-500 font-medium bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  {language === 'ar'
                    ? 'تغيير كود الحساب: لا يوجد أي حقل في سجلات الإنتاج يشير إلى الحسابات المالية، لذلك لا تتأثر أي بيانات إنتاج تاريخية. لكن الحسابات الفرعية ترتبط بالأصل عن طريق الكود - انقل الحسابات الفرعية أولاً قبل تغيير كود له فروع.'
                    : 'Changing an account code: no production record references financial accounts, so no historical production data is affected. Child accounts reference their parent BY CODE, so re-parent the children first before renaming a code that has any.'}
                </p>
              )}
            </div>
          )}

          {/* Specific Chinese Mills Fields */}
          {activeTab === 'mills' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الموديل' : 'Model'}</label>
                <input
                  type="text"
                  value={formData.model || ''}
                  onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الحالة التشغيلية' : 'Operating Status'}</label>
                <select
                  value={formData.status || 'active'}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                >
                  <option value="active">{language === 'ar' ? 'جاهز للعمل' : 'Ready'}</option>
                  <option value="maintenance">{language === 'ar' ? 'صيانة' : 'Maintenance'}</option>
                  <option value="inactive">{language === 'ar' ? 'معطل' : 'Inactive'}</option>
                </select>
              </div>
            </div>
          )}

          {/* Specific Furnace Cars Fields */}
          {activeTab === 'furnaceCars' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'رقم العربة *' : 'Car Number *'}</label>
                <input
                  type="text"
                  required
                  value={formData.carNumber || ''}
                  onChange={(e) => setFormData({ ...formData, carNumber: e.target.value })}
                  placeholder={language === 'ar' ? 'مثال: 105' : 'e.g. 105'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الفرن المخصص' : 'Assigned Furnace'}</label>
                <select
                  value={formData.furnaceId || ''}
                  onChange={(e) => {
                    const fId = e.target.value;
                    const furnace = furnaces.find((f) => f.id === fId);
                    setFormData({
                      ...formData,
                      furnaceId: fId,
                      furnaceName: furnace?.name || '',
                    });
                  }}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
                >
                  <option value="">{language === 'ar' ? '-- اختياري --' : '-- Optional --'}</option>
                  {furnaces.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              id="master-data-modal-save-btn"
              type="submit"
              disabled={isSaving || (activeTab === 'products' && liveProductParseResult?.isValid === false)}
              className="px-5 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
            >
              {isSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{editingItem ? (language === 'ar' ? 'حفظ التعديلات' : 'Save Changes') : (language === 'ar' ? 'إضافة إلى قاعدة البيانات' : 'Add to Database')}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Quick Add Product Type Sub-Modal */}
      <Modal
        isOpen={isQuickTypeModalOpen}
        onClose={() => setIsQuickTypeModalOpen(false)}
        title={language === 'ar' ? `إضافة تصنيف منتج جديد (${quickTypePrefix})` : `Add New Product Type (${quickTypePrefix})`}
        subtitle={language === 'ar' ? 'سيتم حفظ التصنيف في Firestore وإتاحته فوراً لمحلل الأكواد' : 'The type will be saved to Firestore and immediately available to the code analyzer'}
        maxWidth="md"
      >
        <form onSubmit={handleSaveQuickType} className="space-y-4">
          {quickTypeError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{quickTypeError}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {language === 'ar' ? 'بادئة الكود (3 أحرف) *' : 'Prefix Code (3 letters) *'}
            </label>
            <input
              type="text"
              maxLength={3}
              required
              value={quickTypePrefix}
              onChange={(e) => setQuickTypePrefix(e.target.value.toUpperCase())}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-mono font-bold uppercase text-slate-900"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {language === 'ar' ? 'الاسم بالإنجليزية *' : 'Name in English *'}
            </label>
            <input
              type="text"
              required
              value={quickTypeNameEn}
              onChange={(e) => setQuickTypeNameEn(e.target.value)}
              placeholder="e.g. Bricks High Alumina Custom"
              dir="ltr"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {language === 'ar' ? 'الاسم بالعربية *' : 'Name in Arabic *'}
            </label>
            <input
              type="text"
              required
              value={quickTypeNameAr}
              onChange={(e) => setQuickTypeNameAr(e.target.value)}
              placeholder={language === 'ar' ? 'مثال: طوب عالي الألومينا مخصص' : 'e.g. Custom High Alumina Brick'}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">{language === 'ar' ? 'الوصف' : 'Description'}</label>
            <textarea
              rows={2}
              value={quickTypeDescription}
              onChange={(e) => setQuickTypeDescription(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsQuickTypeModalOpen(false)}
              className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isQuickTypeSaving}
              className="px-5 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl flex items-center gap-2 cursor-pointer"
            >
              {isQuickTypeSaving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{language === 'ar' ? 'حفظ التصنيف وتفعيله فوراً' : 'Save & Activate Type Immediately'}</span>
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deleteConfirmItem}
        onClose={() => setDeleteConfirmItem(null)}
        title={language === 'ar' ? 'تأكيد الحذف' : 'Confirm Deletion'}
        subtitle={language === 'ar' ? 'هل أنت متأكد من رغبتك في حذف أو تعطيل هذا السجل؟' : 'Are you sure you want to delete or deactivate this record?'}
        maxWidth="sm"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600 leading-relaxed">
            {language === 'ar'
              ? `سيتم إزالة السجل (${deleteConfirmItem?.code || deleteConfirmItem?.prefixCode || deleteConfirmItem?.name}) من قاعدة البيانات السحابية مباشرة.`
              : `The record (${deleteConfirmItem?.code || deleteConfirmItem?.prefixCode || deleteConfirmItem?.name}) will be removed from the cloud database immediately.`}
          </p>
          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDeleteConfirmItem(null)}
              className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              id="confirm-delete-btn"
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs cursor-pointer"
            >
              {language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Analyze Existing Product Codes Modal */}
      <Modal
        isOpen={isAnalyzeModalOpen}
        onClose={() => setIsAnalyzeModalOpen(false)}
        title="تحليل الأكواد الحالية للمنتجات (Analyze Product Codes)"
        subtitle="فحص المنتجات المسجلة واستخراج الحقول المشتقة (البادئة، التصنيف، الألومينا، المعرف) دون التأثير على الأوزان أو الأبعاد أو حذف أي سجل"
        maxWidth="2xl"
      >
        <div className="space-y-4 text-xs">
          {analysisAppliedMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 flex items-start gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">اكتمل التحديث بنجاح!</p>
                <p className="text-[11px] mt-0.5">{analysisAppliedMessage}</p>
              </div>
            </div>
          )}

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-center">
              <span className="block text-[11px] text-slate-500 font-medium">إجمالي المنتجات</span>
              <span className="text-base font-black text-slate-900">{analyzedItems.length}</span>
            </div>
            <div className="bg-amber-50 border border-amber-200 p-3 rounded-xl text-center">
              <span className="block text-[11px] text-amber-800 font-medium">جاهز للإثراء والتحديث</span>
              <span className="text-base font-black text-amber-900">
                {analyzedItems.filter((i) => i.needsUpdate && i.parseResult.isValid).length}
              </span>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-center">
              <span className="block text-[11px] text-emerald-800 font-medium">مكتمل ومحدث مسبقاً</span>
              <span className="text-base font-black text-emerald-900">
                {analyzedItems.filter((i) => !i.needsUpdate && i.parseResult.isValid).length}
              </span>
            </div>
            <div className="bg-rose-50 border border-rose-200 p-3 rounded-xl text-center">
              <span className="block text-[11px] text-rose-800 font-medium">بادئة غير مسجلة أو غير صالحة</span>
              <span className="text-base font-black text-rose-900">
                {analyzedItems.filter((i) => !i.parseResult.isValid).length}
              </span>
            </div>
          </div>

          {/* Instruction Note */}
          <div className="p-3 bg-indigo-50/70 border border-indigo-200 rounded-xl text-indigo-950 flex items-start gap-2 leading-relaxed">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">التوافق والأمان مع البيانات السابقة (Backward Compatibility)</p>
              <p className="text-[11px] text-indigo-800 mt-0.5">
                يقوم هذا الفحص بمعاينة الحقول الذكية المشتقة تلقائياً من كود المنتج وربطها مع جدول تصنيفات المنتجات (Product Types). لن يتم تعديل وزن القطعة أو الأبعاد أو الحقول المخصصة، ولن يتم حذف أي سجل نهائياً.
              </p>
            </div>
          </div>

          {/* Analysis Comparison Preview Table */}
          <div className="border border-slate-200 rounded-xl overflow-hidden max-h-80 overflow-y-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 border-b border-slate-200 z-10">
                <tr>
                  <th className="px-3 py-2.5">الكود</th>
                  <th className="px-3 py-2.5">الاسم الحالي</th>
                  <th className="px-3 py-2.5">البادئة المشتقة</th>
                  <th className="px-3 py-2.5">التصنيف المشتق</th>
                  <th className="px-3 py-2.5">الألومينا %</th>
                  <th className="px-3 py-2.5">المعرف</th>
                  <th className="px-3 py-2.5 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analyzedItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                      لا توجد منتجات مسجلة في قاعدة البيانات حالياً.
                    </td>
                  </tr>
                ) : (
                  analyzedItems.map((item, idx) => (
                    <tr
                      key={item.product.id || idx}
                      className={`hover:bg-slate-50/80 ${
                        item.needsUpdate && item.parseResult.isValid
                          ? 'bg-amber-50/30'
                          : !item.parseResult.isValid
                          ? 'bg-rose-50/30'
                          : ''
                      }`}
                    >
                      <td className="px-3 py-2 font-mono font-bold text-slate-900">
                        {item.product.code || '-'}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-700 max-w-[140px] truncate">
                        {item.product.name}
                      </td>
                      <td className="px-3 py-2 font-mono font-bold">
                        {item.parseResult.prefix ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-900 text-amber-300 text-[10px]">
                            {item.parseResult.prefix}
                          </span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-slate-800">
                        {item.parseResult.productType ? (
                          <span>{item.parseResult.productType.nameAr || item.parseResult.productType.nameEn}</span>
                        ) : item.parseResult.isUnknownPrefix ? (
                          <span className="text-rose-600 font-bold">بادئة غير مسجلة ({item.parseResult.prefix})</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono font-bold text-amber-700">
                        {item.parseResult.aluminaPercentage !== undefined
                          ? `${item.parseResult.aluminaPercentage}%`
                          : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-600">
                        {item.parseResult.productIdentifier || '-'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {item.needsUpdate && item.parseResult.isValid ? (
                          <Badge variant="warning">بحاجة إثراء ⚡</Badge>
                        ) : !item.parseResult.isValid ? (
                          <Badge variant="danger">مراجعة البادئة ⚠️</Badge>
                        ) : (
                          <Badge variant="success">محدث ✅</Badge>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Modal Action Controls */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-100 flex-wrap gap-2">
            <span className="text-[11px] text-slate-500">
              عدد المنتجات المستهدفة بالتحديث: <strong className="text-slate-900">{analyzedItems.filter((i) => i.needsUpdate).length}</strong>
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAnalyzeModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                إغلاق
              </button>

              <button
                id="apply-analysis-upgrade-btn"
                type="button"
                onClick={handleApplyAnalysis}
                disabled={isApplyingAnalysis || analyzedItems.filter((i) => i.needsUpdate).length === 0}
                className="px-5 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer"
              >
                {isApplyingAnalysis && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  تطبيق التحديث الذكي والتطبيع ({analyzedItems.filter((i) => i.needsUpdate).length} منتج)
                </span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Data Quality & Integrity Diagnostics Modal */}
      <DataQualityModal
        isOpen={isQualityModalOpen}
        onClose={() => setIsQualityModalOpen(false)}
      />

      {/* Master Data Quality Report - duplicate/similar-name detection + safe delete/archive */}
      <MasterDataQualityReportModal
        isOpen={isQualityReportOpen}
        onClose={() => setIsQualityReportOpen(false)}
      />

      {/* Cost Center Hierarchy - a separate, additive Master Data section (see the pseudo-tab button above); entirely local/Firestore-independent browsing except for the manually-gated Phase 4B execution action inside it */}
      {/*
        The dedicated Financial Accounts importer. Rendered here, inside Master
        Data - it never navigates, so the user cannot land in Historical Import.
      */}
      <FinancialAccountsImportModal
        isOpen={isAccountsImportOpen}
        onClose={() => setIsAccountsImportOpen(false)}
        existingCodes={activeTab === 'financialAccounts' ? items.map((a) => String(a.code ?? '')).filter(Boolean) : []}
        canImport={canImportMasterData}
        onImported={() => {
          // The list behind this modal is a live subscribeMasterData listener,
          // so imported accounts arrive on their own; commitBulkImport also
          // invalidated the shared cache. Only the stale code selection needs
          // clearing - it was made against the pre-import list.
          setSelectedCodes([]);
        }}
      />

      <FinancialTransactionsImportModal
        isOpen={isTransactionsImportOpen}
        onClose={() => setIsTransactionsImportOpen(false)}
        canImport={canImportMasterData}
      />

      {/*
        Legacy code <-> hierarchy reconciliation - READ ONLY.

        Distinct from the Cost Center Hierarchy browser next to the tabs: this
        is about production EQUIPMENT master data and the equipment hierarchy,
        and it changes nothing. Every bucket is shown, including the zeroes,
        because "nothing matched" and "the panel is missing" looked identical
        before and that is exactly how this feature went unnoticed.

        Applying the safe links is deliberately NOT wired here. The plan is
        computed and its size shown, so the count can be checked before anything
        is written in a later step.
      */}
      <Modal
        id="master-data-reconcile-modal"
        isOpen={isReconcileOpen}
        onClose={() => setIsReconcileOpen(false)}
        title={language === 'ar' ? 'مطابقة الأكواد مع التسلسل الهرمي' : 'Reconcile Codes with Hierarchy'}
        subtitle={language === 'ar'
          ? 'مطابقة أكواد المعدات القديمة (المكابس والأفران والطواحين) مع عقد التسلسل الهرمي - عرض فقط، لا يتم تعديل أي بيانات'
          : 'Matches legacy equipment codes (presses, furnaces, mills) against hierarchy nodes - read-only, nothing is modified'}
        maxWidth="4xl"
      >
        <div className="space-y-4" dir={isRtl ? 'rtl' : 'ltr'}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { id: 'safe', label: language === 'ar' ? 'مطابقات آمنة' : 'Safe matches', value: reconciliation.counts.matched, tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
              { id: 'review', label: language === 'ar' ? 'تحتاج مراجعة' : 'Needs review', value: reconciliation.counts.ambiguous, tone: 'bg-amber-50 text-amber-800 border-amber-200' },
              { id: 'none', label: language === 'ar' ? 'بدون مقابل' : 'No counterpart', value: reconciliation.counts.unmatchedLegacy, tone: 'bg-slate-100 text-slate-800 border-slate-200' },
              { id: 'conflict', label: language === 'ar' ? 'تعارضات' : 'Conflicts', value: reconciliation.counts.conflicts, tone: 'bg-rose-50 text-rose-800 border-rose-200' },
            ].map((c) => (
              <div key={c.id} id={`reconcile-count-${c.id}`} className={`rounded-xl border px-3 py-2 ${c.tone}`}>
                <p className="text-[10px] font-bold opacity-80">{c.label}</p>
                <p className="text-lg font-black leading-tight">{c.value}</p>
              </div>
            ))}
          </div>

          {allEquipment.length === 0 || hierarchyNodes.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-6 text-center">
              <p className="text-xs font-bold text-slate-700">
                {language === 'ar' ? 'لا توجد بيانات للمطابقة' : 'No data to reconcile'}
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                {hierarchyNodes.length === 0
                  ? (language === 'ar'
                      ? 'لم يتم استيراد التسلسل الهرمي بعد، لذلك لا يوجد ما تُطابَق معه الأكواد.'
                      : 'The hierarchy has not been imported yet, so there is nothing for the codes to match against.')
                  : (language === 'ar'
                      ? 'لا توجد سجلات معدات (مكابس/أفران/طواحين) في البيانات الأساسية.'
                      : 'There are no equipment records (presses/furnaces/mills) in Master Data.')}
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-[11px] min-w-[640px]">
                    <thead className="sticky top-0 bg-slate-50 z-10 text-slate-600">
                      <tr className="border-b border-slate-200">
                        <th className="text-start py-2 px-2.5 font-bold">{language === 'ar' ? 'الكود' : 'Code'}</th>
                        <th className="text-start py-2 px-2.5 font-bold">{language === 'ar' ? 'الفئة' : 'Category'}</th>
                        <th className="text-start py-2 px-2.5 font-bold">{language === 'ar' ? 'الاسم القديم' : 'Legacy name'}</th>
                        <th className="text-start py-2 px-2.5 font-bold">{language === 'ar' ? 'اسم العقدة' : 'Hierarchy name'}</th>
                        <th className="text-start py-2 px-2.5 font-bold">{language === 'ar' ? 'الحالة' : 'Status'}</th>
                        <th className="text-start py-2 px-2.5 font-bold">{language === 'ar' ? 'السبب' : 'Reason'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reconciliation.matched.map((m) => (
                        <tr key={`m-${m.legacyId}`}>
                          <td className="py-1.5 px-2.5 font-mono font-bold">{m.legacyCode}</td>
                          <td className="py-1.5 px-2.5">{m.legacyCategory}</td>
                          <td className="py-1.5 px-2.5">{m.legacyName || '-'}</td>
                          <td className="py-1.5 px-2.5">{m.hierarchyName || '-'}</td>
                          <td className="py-1.5 px-2.5 font-bold text-emerald-700">
                            {m.alreadyLinked
                              ? (language === 'ar' ? 'مرتبطة سلفًا' : 'Already linked')
                              : (language === 'ar' ? 'مطابقة آمنة' : 'Safe match')}
                          </td>
                          <td className="py-1.5 px-2.5 text-slate-500">
                            {language === 'ar' ? 'تطابق الكود + نفس الفئة' : 'exact code + same category'}
                          </td>
                        </tr>
                      ))}
                      {reconciliation.conflicts.map((c) => (
                        <tr key={`c-${c.legacyId}`} className="bg-rose-50/40">
                          <td className="py-1.5 px-2.5 font-mono font-bold">{c.legacyCode}</td>
                          <td className="py-1.5 px-2.5">{c.legacyCategory}</td>
                          <td className="py-1.5 px-2.5">{c.legacyName || '-'}</td>
                          <td className="py-1.5 px-2.5">-</td>
                          <td className="py-1.5 px-2.5 font-bold text-rose-700">{language === 'ar' ? 'تعارض' : 'Conflict'}</td>
                          <td className="py-1.5 px-2.5 text-slate-500">
                            {language === 'ar' ? 'مرتبطة سلفًا بعقدة مختلفة - لن تُستبدل تلقائيًا' : 'already linked to a different node - never replaced automatically'}
                          </td>
                        </tr>
                      ))}
                      {reconciliation.ambiguous.map((a) => (
                        <tr key={`a-${a.category}-${a.code}`} className="bg-amber-50/40">
                          <td className="py-1.5 px-2.5 font-mono font-bold">{a.code}</td>
                          <td className="py-1.5 px-2.5">{a.category}</td>
                          <td className="py-1.5 px-2.5">-</td>
                          <td className="py-1.5 px-2.5">-</td>
                          <td className="py-1.5 px-2.5 font-bold text-amber-700">{language === 'ar' ? 'تحتاج مراجعة' : 'Needs review'}</td>
                          <td className="py-1.5 px-2.5 text-slate-500">{a.reason}</td>
                        </tr>
                      ))}
                      {reconciliation.unmatchedLegacy.map((u) => (
                        <tr key={`u-${u.id}`}>
                          <td className="py-1.5 px-2.5 font-mono font-bold">{u.code}</td>
                          <td className="py-1.5 px-2.5">{u.category}</td>
                          <td className="py-1.5 px-2.5">{u.name || '-'}</td>
                          <td className="py-1.5 px-2.5">-</td>
                          <td className="py-1.5 px-2.5 font-bold text-slate-500">{language === 'ar' ? 'بدون مقابل' : 'No counterpart'}</td>
                          <td className="py-1.5 px-2.5 text-slate-500">
                            {language === 'ar' ? 'لا توجد عقدة بنفس الكود' : 'no hierarchy node with this code'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-[11px] font-semibold text-slate-600">
                {language === 'ar'
                  ? 'المطابقة بالكود داخل نفس الفئة فقط - اختلاف الاسم لا يعني اختلاف السجل، وتشابه الاسم وحده لا يكفي للربط.'
                  : 'Matched by code within the same category only - a different name does not mean a different record, and a similar name alone is never enough to link.'}
              </p>
            </>
          )}

          {/* Read-only in this release: the plan size is shown, nothing is written. */}
          <div className="flex items-center justify-between gap-2 flex-wrap border-t border-slate-200 pt-3">
            <span className="text-[11px] font-bold text-slate-600">
              {language === 'ar'
                ? `جاهز للتطبيق لاحقًا: ${plannedLinks.length} سجل`
                : `Ready to apply later: ${plannedLinks.length} record(s)`}
            </span>
            <div className="flex items-center gap-2">
              <button
                id="reconcile-apply-btn"
                type="button"
                onClick={handleApplySafeLinks}
                disabled={!canImportMasterData || plannedLinks.length === 0 || isApplyingLinks}
                className="px-4 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl cursor-pointer"
                title={!canImportMasterData
                  ? (language === 'ar' ? 'تحتاج صلاحية تعديل البيانات الأساسية.' : 'Requires the Master Data edit permission.')
                  : (language === 'ar'
                      ? 'يطبّق المطابقات المؤكدة فقط - لا يشمل التعارضات ولا التي بدون مقابل.'
                      : 'Applies confirmed matches only - never conflicts or no-counterpart rows.')}
              >
                {isApplyingLinks
                  ? (language === 'ar' ? 'جارٍ الربط...' : 'Linking...')
                  : (language === 'ar' ? `تطبيق المطابقات الآمنة (${plannedLinks.length})` : `Apply Safe Matches (${plannedLinks.length})`)}
              </button>
              <button
                type="button"
                onClick={() => setIsReconcileOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                {language === 'ar' ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </div>
          {applyOutcome && (
            <div id="reconcile-apply-outcome" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 space-y-1">
              <p className="text-xs font-black text-emerald-900">{describeApplyOutcome(applyOutcome, language)}</p>
              {applyOutcome.failedCount > 0 && (
                <div className="max-h-24 overflow-y-auto text-[10px] text-rose-800 font-semibold">
                  {applyOutcome.failed.map((f) => (
                    <p key={f.legacyId}>{`${f.code}: ${f.error}`}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          <p className="text-[10px] text-slate-500">
            {language === 'ar'
              ? 'يُكتب حقل واحد فقط (عقدة التسلسل الهرمي) على سجل المعدة - لا تُعدَّل أي سجلات إنتاج تاريخية، ولا تُستبدل أي رابطة قائمة مختلفة.'
              : 'Exactly one field (the hierarchy node) is written on the equipment record - no historical production record is modified, and no existing different link is replaced.'}
          </p>
        </div>
      </Modal>

      <CostCenterHierarchyPanel
        isOpen={isHierarchyPanelOpen}
        onClose={() => setIsHierarchyPanelOpen(false)}
      />
    </div>
  );
};

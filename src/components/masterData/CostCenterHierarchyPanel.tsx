/**
 * Cost Center / Department Hierarchy - Phase 2 (browse + dry-run), Phase 3
 * (review, status filter, node detail, local approval), Phase 4B (real
 * Firestore execution, gated behind a manually-clicked, authenticated
 * Confirm), and Phase 5 (promoted to its own Master Data section entry
 * point + root-category/type filters) panel.
 *
 * PHASE 5 - NO FIRESTORE DEPENDENCY FOR BROWSING: every capability in this
 * panel except the one gated execution action operates entirely on the
 * in-memory `nodes` array produced by parsing the uploaded Sheet1 workbook
 * client-side (costCenterHierarchyPure.ts) - the tree, search, all four
 * filters (status/root/type + free-text), and node detail all work with
 * zero Firestore reads, so the panel remains fully usable even when
 * Firestore itself is unavailable (e.g. quota exhaustion).
 *
 * WRITE BOUNDARY: opening this panel, uploading a file, searching,
 * filtering, and clicking "Approve Cost Center Hierarchy" all remain
 * entirely read-only against Firestore - zero writes. The ONLY Firestore
 * write path in this entire file is `createCostCenterHierarchyNodes`
 * (reused verbatim from costCenterHierarchyService.ts, never reimplemented
 * here), and it is called from exactly ONE place: `handleConfirmExecution`,
 * itself only reachable after (a) local approval, (b) a fresh
 * runPreApprovalValidation pass, (c) the signed-in user is an authorized
 * admin, and (d) the administrator manually clicks "Confirm" in the
 * execution dialog. Nothing in this file ever calls it automatically - not
 * on mount, not on upload, not on validate, not on approve. See
 * scripts/tests/costCenterHierarchy.test.ts for a source-inspection test
 * that asserts both the single call site and its enclosing handler.
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  UploadCloud, Search, ChevronRight, ChevronDown, FolderTree, Building2,
  Layers, Wrench, AlertTriangle, CheckCircle2, XCircle, Info, Loader2,
  ClipboardCheck, ShieldCheck, ShieldAlert, Filter, Rocket,
} from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import {
  parseSheet1Workbook,
  createCostCenterHierarchyNodes,
  listCostCenterHierarchyNodes,
  COST_CENTER_HIERARCHY_COLLECTION,
  CostCenterHierarchyRecord,
} from '../../services/costCenterHierarchyService';
import {
  ParsedHierarchyNode,
  HierarchyDryRunSummary,
  HierarchyNodeStatus,
  HierarchyNodeType,
  PreApprovalValidationResult,
  CostCenterHierarchyApprovalState,
  CostCenterHierarchyExecutionState,
  ROOT_CATEGORY_CODES,
  ROOT_CATEGORY_LABELS,
  computeHierarchyDryRunSummary,
  runPreApprovalValidation,
  evaluateExecutionGate,
  computeAncestorInclusiveVisibleCodes,
  getChildren,
  getAncestorChain,
} from '../../services/costCenterHierarchyPure';

const STATUS_STYLES: Record<HierarchyNodeStatus, { bg: string; text: string; border: string; labelAr: string; labelEn: string }> = {
  READY: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', labelAr: 'جاهز', labelEn: 'Ready' },
  REVIEW_REQUIRED: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', labelAr: 'يتطلب مراجعة', labelEn: 'Review Required' },
  EXCLUDED_BLANK_NAME: { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200', labelAr: 'مستبعد - اسم فارغ', labelEn: 'Excluded - Blank Name' },
  EXCLUDED_CODE_6041: { bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-200', labelAr: 'مستبعد - كود 6041', labelEn: 'Excluded - Code 6041' },
  CONFLICT: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', labelAr: 'تعارض', labelEn: 'Conflict' },
};

const TYPE_ICON: Record<string, React.ElementType> = {
  DEPARTMENT: Building2,
  WORK_CENTER: Layers,
  EQUIPMENT: Wrench,
  CATEGORY: FolderTree,
};

const TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  CATEGORY: { ar: 'تصنيف رئيسي', en: 'Category' },
  DEPARTMENT: { ar: 'قسم', en: 'Department' },
  WORK_CENTER: { ar: 'مركز عمل', en: 'Work Center' },
  EQUIPMENT: { ar: 'معدة', en: 'Equipment' },
};

type StatusFilter = 'ALL' | 'READY' | 'REVIEW_REQUIRED';
type RootFilter = 'ALL' | (typeof ROOT_CATEGORY_CODES)[number];
type TypeFilter = 'ALL' | HierarchyNodeType;
type ApprovalState = CostCenterHierarchyApprovalState;
type ExecutionState = CostCenterHierarchyExecutionState;

interface CostCenterHierarchyPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CostCenterHierarchyPanel: React.FC<CostCenterHierarchyPanelProps> = ({ isOpen, onClose }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const { isAuthenticated, isSuperAdmin, userRole } = useAuth();
  // Mirrors firestore.rules' isAdmin() exactly (SUPER_ADMIN or ADMIN) - the
  // existing app-wide admin model, reused verbatim. Not a new permission
  // key: the real enforcement is still Firestore Rules server-side: this is
  // only the client-side UX gate that keeps the button disabled/hidden from
  // anyone who would be rejected by the server anyway.
  const isAuthorizedAdmin = isAuthenticated && (isSuperAdmin || userRole === 'ADMIN');

  const [nodes, setNodes] = useState<ParsedHierarchyNode[]>([]);

  // Already-imported hierarchy, read back from Firestore. This collection
  // used to be write-only: the importer created documents and nothing ever
  // read them, so a successful import looked like it had vanished.
  const [stored, setStored] = useState<CostCenterHierarchyRecord[]>([]);
  const [storedState, setStoredState] = useState<'IDLE' | 'LOADING' | 'READY' | 'FAILED'>('IDLE');
  const [storedSearch, setStoredSearch] = useState('');
  const [dryRun, setDryRun] = useState<HierarchyDryRunSummary | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [rootFilter, setRootFilter] = useState<RootFilter>('ALL');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');

  // Phase 3 - review/approval state. Entirely local React state, never persisted, never written to Firestore.
  const [approvalState, setApprovalState] = useState<ApprovalState>('DRAFT');
  const [preApproval, setPreApproval] = useState<PreApprovalValidationResult | null>(null);
  const [showApprovalConfirm, setShowApprovalConfirm] = useState(false);

  // Phase 4B - real Firestore execution, gated behind manual Confirm. See the file's own docblock for the write boundary.
  const [executionState, setExecutionState] = useState<ExecutionState>('idle');
  const [executionProgress, setExecutionProgress] = useState(0);
  const [executionResult, setExecutionResult] = useState<{ createdCount: number; importId: string } | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  // Synchronous double-invocation guard - a ref (not state) so it is read/set
  // instantly, immune to React's state-update batching/staleness, which a
  // plain `executionState === 'creating'` check inside a fast double-click
  // could otherwise race.
  const isExecutingRef = useRef(false);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsParsing(true);
    setParseError(null);
    setSelectedCode(null);
    setApprovalState('DRAFT');
    setPreApproval(null);
    setShowApprovalConfirm(false);
    setExecutionState('idle');
    setExecutionProgress(0);
    setExecutionResult(null);
    setExecutionError(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSheet1Workbook(buffer);
      setNodes(parsed);
      setDryRun(computeHierarchyDryRunSummary(parsed));
      setFileName(file.name);
      setExpandedRoots(new Set(ROOT_CATEGORY_CODES));
      setExpandedCodes(new Set());
      setStatusFilter('ALL');
      setRootFilter('ALL');
      setTypeFilter('ALL');
    } catch (err: any) {
      setParseError(err?.message || (isAr ? 'تعذر قراءة الملف' : 'Failed to read the file'));
      setNodes([]);
      setDryRun(null);
    } finally {
      setIsParsing(false);
      e.target.value = '';
    }
  }, [isAr]);

  /**
   * Loads the persisted hierarchy. Cache-first through the shared Master Data
   * service, so opening this panel repeatedly costs no extra Firestore reads;
   * Refresh passes skipCache to force a re-read after an import.
   */
  const loadStored = useCallback(async (force = false) => {
    setStoredState('LOADING');
    try {
      const rows = await listCostCenterHierarchyNodes(force ? { skipCache: true } : undefined);
      // Parent before child, then by code - keeps the hierarchy readable
      // without building a second tree renderer.
      rows.sort((a, b) => (a.level - b.level) || a.sheet1Code.localeCompare(b.sheet1Code));
      setStored(rows);
      setStoredState('READY');
    } catch {
      setStoredState('FAILED');
    }
  }, []);

  // Only when the panel is actually open - never on application startup.
  useEffect(() => {
    if (isOpen && storedState === 'IDLE') void loadStored();
  }, [isOpen, storedState, loadStored]);

  const storedFiltered = useMemo(() => {
    const q = storedSearch.trim().toLowerCase();
    if (!q) return stored;
    return stored.filter(
      (n) => n.sheet1Code.toLowerCase().includes(q) || (n.name ?? '').toLowerCase().includes(q),
    );
  }, [stored, storedSearch]);

  const byCode = useMemo(() => new Map(nodes.map((n) => [n.sheet1Code, n])), [nodes]);

  const excludedNodes = useMemo(
    () => nodes.filter((n) => n.status === 'EXCLUDED_BLANK_NAME' || n.status === 'EXCLUDED_CODE_6041'),
    [nodes]
  );

  // Every filter below (search, status, root category, type) independently
  // computes an ancestor-inclusive visible-code set via the ONE shared pure
  // helper (computeAncestorInclusiveVisibleCodes) - never a duplicated
  // ancestor-expansion loop per filter. isNodeVisible then ANDs whichever
  // filters are currently active.
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return nodes.filter((n) => n.sheet1Code.toLowerCase().includes(q) || n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q));
  }, [nodes, searchQuery]);

  const searchVisibleCodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return computeAncestorInclusiveVisibleCodes(
      nodes,
      (n) => n.sheet1Code.toLowerCase().includes(q) || n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)
    );
  }, [nodes, searchQuery]);

  const statusFilterVisibleCodes = useMemo(() => {
    if (statusFilter === 'ALL') return null;
    return computeAncestorInclusiveVisibleCodes(nodes, (n) => n.status === statusFilter);
  }, [nodes, statusFilter]);

  const rootFilterVisibleCodes = useMemo(() => {
    if (rootFilter === 'ALL') return null;
    return computeAncestorInclusiveVisibleCodes(nodes, (n) => n.rootCategoryCode === rootFilter);
  }, [nodes, rootFilter]);

  const typeFilterVisibleCodes = useMemo(() => {
    if (typeFilter === 'ALL') return null;
    return computeAncestorInclusiveVisibleCodes(nodes, (n) => n.type === typeFilter);
  }, [nodes, typeFilter]);

  const isNodeVisible = useCallback((code: string): boolean => {
    if (searchVisibleCodes && !searchVisibleCodes.has(code)) return false;
    if (statusFilterVisibleCodes && !statusFilterVisibleCodes.has(code)) return false;
    if (rootFilterVisibleCodes && !rootFilterVisibleCodes.has(code)) return false;
    if (typeFilterVisibleCodes && !typeFilterVisibleCodes.has(code)) return false;
    return true;
  }, [searchVisibleCodes, statusFilterVisibleCodes, rootFilterVisibleCodes, typeFilterVisibleCodes]);

  const hasActiveFilter = Boolean(searchVisibleCodes || statusFilterVisibleCodes || rootFilterVisibleCodes || typeFilterVisibleCodes);

  const selectedNode = selectedCode ? byCode.get(selectedCode) || null : null;
  const selectedParent = selectedNode?.parentSheet1Code ? byCode.get(selectedNode.parentSheet1Code) || null : null;
  const selectedAncestors = selectedCode ? getAncestorChain(nodes, selectedCode) : [];

  const toggleNode = (code: string) => {
    setExpandedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleRoot = (rootCode: string) => {
    setExpandedRoots((prev) => {
      const next = new Set(prev);
      if (next.has(rootCode)) next.delete(rootCode);
      else next.add(rootCode);
      return next;
    });
  };

  // Phase 3 - re-runs validation fresh every time; never caches a stale pass/fail. Purely local, reads only the already-parsed `nodes` array.
  const handleApproveClick = () => {
    const result = runPreApprovalValidation(nodes);
    setPreApproval(result);
    // A fresh (re-)validation invalidates any prior execution outcome/attempt display - never auto-starts a new one, just clears stale status.
    setExecutionState('idle');
    setExecutionResult(null);
    setExecutionError(null);
    if (result.passed) {
      setApprovalState('VALIDATION_PASSED');
      setShowApprovalConfirm(true);
    } else {
      setApprovalState('VALIDATION_FAILED');
      setShowApprovalConfirm(false);
    }
  };

  const handleConfirmApproval = () => {
    // Local UI state only - no Firestore call of any kind happens here or anywhere in this file.
    setApprovalState('APPROVED');
    setShowApprovalConfirm(false);
  };

  const handleCancelApproval = () => {
    setShowApprovalConfirm(false);
  };

  const executionGate = useMemo(
    () => evaluateExecutionGate({ approvalState, preApproval, isAuthorizedAdmin, executionState }),
    [approvalState, preApproval, isAuthorizedAdmin, executionState]
  );

  const handleExecuteClick = () => {
    if (!executionGate.canExecute) return;
    setExecutionError(null);
    setExecutionState('confirming');
  };

  const handleCancelExecution = () => {
    if (executionState !== 'confirming') return;
    setExecutionState('idle');
  };

  /**
   * PHASE 4B - THE single Firestore write path in this entire file. Only
   * reachable via the administrator manually clicking "Confirm" in the
   * execution dialog, which itself only renders when executionState ===
   * 'confirming', which itself only follows a passing executionGate. Calls
   * the EXACT existing createCostCenterHierarchyNodes (costCenterHierarchyService.ts)
   * verbatim - no reimplementation, no parallel persistence path.
   */
  const handleConfirmExecution = async () => {
    if (isExecutingRef.current) return; // synchronous guard - see isExecutingRef's own comment
    isExecutingRef.current = true;
    setExecutionState('creating');
    setExecutionProgress(0);
    try {
      const result = await createCostCenterHierarchyNodes(nodes, (percent) => setExecutionProgress(percent));
      setExecutionResult(result);
      setExecutionState('success');
    } catch (err: any) {
      setExecutionError(err?.message || (isAr ? 'حدث خطأ غير متوقع أثناء الإنشاء في Firestore.' : 'An unexpected error occurred during Firestore creation.'));
      setExecutionState('error');
    } finally {
      isExecutingRef.current = false;
    }
  };

  const renderNode = (node: ParsedHierarchyNode, depth: number): React.ReactNode => {
    if (!isNodeVisible(node.sheet1Code)) return null;

    const children = getChildren(nodes, node.sheet1Code);
    const isExpanded = hasActiveFilter ? true : expandedCodes.has(node.sheet1Code);
    const hasChildren = children.length > 0;
    const Icon = TYPE_ICON[node.type] || Layers;
    const style = STATUS_STYLES[node.status];
    const isMatch = searchMatches?.some((m) => m.sheet1Code === node.sheet1Code);
    const isSelected = selectedCode === node.sheet1Code;

    return (
      <div key={node.sheet1Code}>
        <div
          onClick={() => setSelectedCode(node.sheet1Code)}
          className={`flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer transition-colors ${
            isSelected ? 'bg-amber-100' : isMatch ? 'bg-amber-50' : 'hover:bg-slate-50'
          }`}
          style={{ [isAr ? 'paddingRight' : 'paddingLeft']: `${depth * 20 + 8}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleNode(node.sheet1Code); }}
              className="w-5 h-5 flex items-center justify-center text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className={`w-3.5 h-3.5 ${isAr ? 'rotate-180' : ''}`} />}
            </button>
          ) : (
            <span className="w-5 h-5 shrink-0" />
          )}
          <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="text-[11px] font-mono text-slate-500 shrink-0">{node.sheet1Code}</span>
          <span className={`text-xs font-semibold truncate ${node.status.startsWith('EXCLUDED') ? 'line-through text-slate-400' : 'text-slate-800'}`}>
            {node.name || (isAr ? '(بدون اسم)' : '(no name)')}
          </span>
          <span className="shrink-0 text-[10px] text-slate-400">{isAr ? `مستوى ${node.level}` : `L${node.level}`}</span>
          <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border ${style.bg} ${style.text} ${style.border}`}>
            {isAr ? style.labelAr : style.labelEn}
          </span>
        </div>
        {hasChildren && isExpanded && (
          <div>{children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const approvalBadge: Record<ApprovalState, { bg: string; text: string; border: string; labelAr: string; labelEn: string; icon: React.ElementType }> = {
    DRAFT: { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', labelAr: 'مسودة مراجعة', labelEn: 'Draft Review', icon: ClipboardCheck },
    VALIDATION_FAILED: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200', labelAr: 'فشل التحقق', labelEn: 'Validation Failed', icon: ShieldAlert },
    VALIDATION_PASSED: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', labelAr: 'تم اجتياز التحقق', labelEn: 'Validation Passed', icon: ShieldCheck },
    APPROVED: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', labelAr: 'معتمد للإنشاء', labelEn: 'Approved for Creation', icon: CheckCircle2 },
  };
  const badge = approvalBadge[approvalState];
  const BadgeIcon = badge.icon;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs ${isOpen ? '' : 'hidden'}`} onClick={onClose} dir={isAr ? 'rtl' : 'ltr'}>
      <div
        className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <FolderTree className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-lg font-bold text-slate-800">
                {isAr ? 'التسلسل الهرمي الجديد لمراكز التكلفة - المراجعة والاعتماد' : 'New Cost Center Hierarchy - Review & Approval'}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isAr ? 'رفع، معاينة، ومراجعة Sheet1 فقط - لا يتم إنشاء أي بيانات في قاعدة البيانات' : 'Upload, preview, and review Sheet1 only - nothing is written to the database'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-5">
          {/* Already-imported hierarchy, read back from the authoritative
              collection. Cache-first via the shared Master Data service, so
              re-opening this panel does not re-read Firestore. */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/70 border-b border-slate-100 flex-wrap">
              <div className="flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-emerald-600" />
                <h4 className="text-sm font-bold text-slate-800">
                  {isAr ? 'التسلسل الهرمي المحفوظ (المستورد سابقًا)' : 'Stored hierarchy (previously imported)'}
                </h4>
                {storedState === 'READY' && (
                  <span className="text-[11px] font-bold text-slate-500">({storedFiltered.length})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {storedState === 'READY' && stored.length > 0 && (
                  <input
                    type="text"
                    value={storedSearch}
                    onChange={(e) => setStoredSearch(e.target.value)}
                    placeholder={isAr ? 'بحث بالكود أو الاسم' : 'Search by code or name'}
                    className="text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 w-56"
                  />
                )}
                <button
                  type="button"
                  onClick={() => loadStored(true)}
                  disabled={storedState === 'LOADING'}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {storedState === 'LOADING' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  {isAr ? 'تحديث' : 'Refresh'}
                </button>
              </div>
            </div>

            {storedState === 'LOADING' && (
              <p className="px-4 py-4 text-xs text-slate-500">{isAr ? 'جارٍ التحميل...' : 'Loading...'}</p>
            )}
            {storedState === 'FAILED' && (
              <p className="px-4 py-4 text-xs text-red-700">
                {isAr ? 'تعذر تحميل التسلسل الهرمي المحفوظ.' : 'Could not load the stored hierarchy.'}
              </p>
            )}
            {storedState === 'READY' && stored.length === 0 && (
              <p className="px-4 py-4 text-xs text-slate-500">
                {isAr
                  ? 'لا توجد عقد محفوظة بعد. بعد اعتماد وتنفيذ استيراد، ستظهر هنا.'
                  : 'No stored nodes yet. After an import is approved and executed, they appear here.'}
              </p>
            )}
            {storedState === 'READY' && stored.length > 0 && (
              <div className="overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-xs min-w-[760px]">
                  <thead className="sticky top-0 bg-white">
                    <tr className="text-[11px] text-slate-500 border-b border-slate-100">
                      <th className="text-start py-2 px-3 font-bold">{isAr ? 'الكود' : 'Code'}</th>
                      <th className="text-start py-2 px-3 font-bold">{isAr ? 'الاسم' : 'Name'}</th>
                      <th className="text-start py-2 px-3 font-bold">{isAr ? 'الأصل' : 'Parent'}</th>
                      <th className="text-start py-2 px-3 font-bold">{isAr ? 'المستوى' : 'Level'}</th>
                      <th className="text-start py-2 px-3 font-bold">{isAr ? 'النوع' : 'Type'}</th>
                      <th className="text-start py-2 px-3 font-bold">{isAr ? 'التصنيف الرئيسي' : 'Root category'}</th>
                      <th className="text-start py-2 px-3 font-bold">{isAr ? 'الحالة' : 'Status'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storedFiltered.map((n) => (
                      <tr key={n.id} className="border-b border-slate-50 hover:bg-slate-50/60" title={n.notes ?? ''}>
                        <td className="py-2 px-3 font-mono font-bold text-slate-800">{n.sheet1Code}</td>
                        <td className="py-2 px-3 text-slate-700">{n.name}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">{n.parentSheet1Code ?? '-'}</td>
                        <td className="py-2 px-3 text-slate-600">{n.level}</td>
                        <td className="py-2 px-3 text-slate-600">{n.type}</td>
                        <td className="py-2 px-3 text-slate-600">{n.rootCategoryName || n.rootCategoryCode || '-'}</td>
                        <td className="py-2 px-3">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${n.active ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-slate-100 text-slate-500 border-slate-300'}`}>
                            {n.status || (n.active ? (isAr ? 'نشط' : 'Active') : (isAr ? 'غير نشط' : 'Inactive'))}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Safety notice */}
          <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-800 leading-relaxed">
              {isAr
                ? `يتم تحليل الملف بالكامل في المتصفح دون أي اتصال بقاعدة البيانات - الاستعراض والبحث والمرشحات ومراجعة كل عقدة لا تُنشئ أي شيء. مجموعة Firestore المستهدفة هي "${COST_CENTER_HIERARCHY_COLLECTION}" (منفصلة تمامًا عن مجموعة "departments" الحالية)، ولا يتم الكتابة إليها إلا بعد اعتماد صريح وتأكيد يدوي من مسؤول مسجل الدخول في قسم "التنفيذ الفعلي".`
                : `The file is fully parsed in-browser with no database connection - browsing, searching, filtering, and reviewing every node creates nothing. The target Firestore collection is "${COST_CENTER_HIERARCHY_COLLECTION}" (entirely separate from the existing "departments" collection), and it is only ever written to after explicit approval and a manual confirm by a signed-in administrator in the "Actual Execution" section.`}
            </p>
          </div>

          {/* Upload */}
          <div className="flex items-center gap-3">
            <label
              htmlFor="cost-center-hierarchy-upload"
              className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              <span>{isAr ? 'رفع ملف Sheet1 (Excel)' : 'Upload Sheet1 File (Excel)'}</span>
            </label>
            <input
              id="cost-center-hierarchy-upload"
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFileChange}
              className="hidden"
            />
            {fileName && <span className="text-xs text-slate-500">{fileName}</span>}
          </div>

          {parseError && (
            <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-800 whitespace-pre-line">{parseError}</p>
            </div>
          )}

          {dryRun && (
            <>
              {/* Dry-run summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryStat label={isAr ? 'إجمالي الأكواد المصدرية' : 'Total Source Codes'} value={dryRun.totalLogicalSourceNodes} />
                <SummaryStat label={isAr ? 'جاهز' : 'Ready'} value={dryRun.ready} tone="emerald" />
                <SummaryStat label={isAr ? 'يحتاج مراجعة' : 'Review Required'} value={dryRun.reviewRequired} tone="amber" />
                <SummaryStat label={isAr ? 'إجمالي المرشحين للإنشاء' : 'Total Creation Candidates'} value={dryRun.creationCandidates} tone="blue" />
                <SummaryStat label={isAr ? 'المستبعد بدون اسم' : 'Excluded - Blank Name'} value={dryRun.excludedBlankName} tone="slate" />
                <SummaryStat label={isAr ? 'المستبعد 6041' : 'Excluded - Code 6041'} value={dryRun.excludedCode6041} tone="slate" />
                <SummaryStat label={isAr ? 'تعارض' : 'Conflict'} value={dryRun.conflict} tone="rose" />
                <SummaryStat
                  label={isAr ? 'التحقق البنيوي' : 'Structural Validation'}
                  value={dryRun.validation.valid ? (isAr ? 'سليم' : 'Clean') : `${dryRun.validation.issues.length} ${isAr ? 'مشكلة' : 'issue(s)'}`}
                  tone={dryRun.validation.valid ? 'emerald' : 'rose'}
                  icon={dryRun.validation.valid ? CheckCircle2 : AlertTriangle}
                />
              </div>

              {/* Per-root counts */}
              <div className="flex flex-wrap gap-2">
                {ROOT_CATEGORY_CODES.map((root) => (
                  <div key={root} className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-[11px]">
                    <span className="font-mono font-bold text-slate-600">{root}</span>
                    <span className="text-slate-500">{ROOT_CATEGORY_LABELS[root]}</span>
                    <span className="font-bold text-slate-800">{dryRun.perRoot[root] || 0}</span>
                  </div>
                ))}
              </div>

              {!dryRun.validation.valid && (
                <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 space-y-1 max-h-32 overflow-y-auto">
                  {dryRun.validation.issues.map((issue, idx) => (
                    <p key={idx} className="text-[11px] text-rose-800">
                      <span className="font-mono font-bold">{issue.code}</span> - {issue.issue}: {issue.detail}
                    </p>
                  ))}
                </div>
              )}

              {/* Excluded summary (transparency only - never creation candidates) */}
              {excludedNodes.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                  <p className="text-[11px] font-bold text-slate-500 mb-2">
                    {isAr
                      ? `الأكواد المستبعدة (${excludedNodes.length}) - لأغراض الشفافية فقط، غير مدرجة ضمن مرشحي الإنشاء`
                      : `Excluded Codes (${excludedNodes.length}) - transparency only, NOT creation candidates`}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {excludedNodes.map((n) => (
                      <span key={n.sheet1Code} className="inline-flex items-center gap-1 text-[11px] bg-white border border-slate-200 rounded-lg px-2 py-1">
                        <span className="font-mono font-bold text-slate-500 line-through">{n.sheet1Code}</span>
                        <span className="text-slate-500">{n.name || (isAr ? '(بدون اسم)' : '(no name)')}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Search + Filters */}
              <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                  <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                    <Search className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={isAr ? 'البحث بالكود، الاسم، أو المسار الكامل...' : 'Search by code, name, or full path...'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-4 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:bg-white transition-colors"
                  />
                </div>

                <select
                  id="cost-center-hierarchy-root-filter"
                  value={rootFilter}
                  onChange={(e) => setRootFilter(e.target.value as RootFilter)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-bold text-slate-700 focus:outline-none focus:border-amber-500 cursor-pointer shrink-0"
                >
                  <option value="ALL">{isAr ? 'كل التصنيفات الجذرية' : 'All Root Categories'}</option>
                  {ROOT_CATEGORY_CODES.map((root) => (
                    <option key={root} value={root}>{root} - {ROOT_CATEGORY_LABELS[root]}</option>
                  ))}
                </select>

                <select
                  id="cost-center-hierarchy-type-filter"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-[11px] font-bold text-slate-700 focus:outline-none focus:border-amber-500 cursor-pointer shrink-0"
                >
                  <option value="ALL">{isAr ? 'كل الأنواع' : 'All Types'}</option>
                  <option value="DEPARTMENT">{isAr ? TYPE_LABELS.DEPARTMENT.ar : TYPE_LABELS.DEPARTMENT.en}</option>
                  <option value="WORK_CENTER">{isAr ? TYPE_LABELS.WORK_CENTER.ar : TYPE_LABELS.WORK_CENTER.en}</option>
                  <option value="EQUIPMENT">{isAr ? TYPE_LABELS.EQUIPMENT.ar : TYPE_LABELS.EQUIPMENT.en}</option>
                  {/* Defensive catch-all - the classifier never actually produces CATEGORY nodes today (levels are always DEPARTMENT/WORK_CENTER/EQUIPMENT), but the type stays structurally possible, so this option is kept correct rather than silently unreachable. */}
                  <option value="CATEGORY">{isAr ? 'أخرى' : 'Other'}</option>
                </select>

                <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl p-1 shrink-0">
                  <Filter className="w-3.5 h-3.5 text-slate-400 mx-1.5" />
                  {(['ALL', 'READY', 'REVIEW_REQUIRED'] as StatusFilter[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setStatusFilter(f)}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                        statusFilter === f ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {f === 'ALL' ? (isAr ? 'الكل' : 'All') : f === 'READY' ? (isAr ? 'جاهز' : 'Ready') : (isAr ? 'يحتاج مراجعة' : 'Review Required')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Selected node detail */}
              {selectedNode && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
                    <DetailField label={isAr ? 'الكود' : 'Code'} value={selectedNode.sheet1Code} mono />
                    <DetailField label={isAr ? 'الاسم' : 'Name'} value={selectedNode.name || (isAr ? '(بدون اسم)' : '(no name)')} />
                    <DetailField label={isAr ? 'النوع' : 'Type'} value={isAr ? TYPE_LABELS[selectedNode.type]?.ar : TYPE_LABELS[selectedNode.type]?.en} />
                    <DetailField label={isAr ? 'المستوى' : 'Level'} value={String(selectedNode.level)} />
                    <DetailField label={isAr ? 'الأصل' : 'Parent'} value={selectedParent ? `${selectedParent.sheet1Code} ${selectedParent.name}` : (isAr ? '(بدون أصل - قسم جذري)' : '(no parent - root-level)')} />
                    <DetailField label={isAr ? 'التصنيف الجذري' : 'Root Category'} value={`${selectedNode.rootCategoryCode} ${selectedNode.rootCategoryName}`} />
                    <DetailField label={isAr ? 'ورقة المصدر' : 'Source Sheet'} value="Sheet1" />
                    <DetailField
                      label={isAr ? 'الحالة' : 'Status'}
                      value={isAr ? STATUS_STYLES[selectedNode.status].labelAr : STATUS_STYLES[selectedNode.status].labelEn}
                    />
                  </div>

                  {(selectedNode.notes?.length || selectedNode.distinctNames?.length) ? (
                    <div className={`rounded-lg px-3 py-2 border ${selectedNode.status === 'REVIEW_REQUIRED' ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200'}`}>
                      <p className={`text-[11px] font-bold mb-0.5 ${selectedNode.status === 'REVIEW_REQUIRED' ? 'text-amber-700' : 'text-rose-700'}`}>
                        {isAr ? 'ملاحظة المصدر' : 'Source Note'}
                      </p>
                      <p className={`text-xs ${selectedNode.status === 'REVIEW_REQUIRED' ? 'text-amber-800' : 'text-rose-800'}`}>
                        {[...(selectedNode.notes || []), ...(selectedNode.distinctNames || [])].join(' / ')}
                      </p>
                    </div>
                  ) : null}

                  <div>
                    <p className="text-[11px] font-bold text-slate-500 mb-1">{isAr ? 'المسار الكامل للتصنيف' : 'Full Classification Path'}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {selectedAncestors.map((anc, idx) => (
                        <React.Fragment key={anc.sheet1Code}>
                          {idx > 0 && <ChevronRight className={`w-3 h-3 text-slate-400 ${isAr ? 'rotate-180' : ''}`} />}
                          <span className="font-mono text-slate-500">{anc.sheet1Code}</span>
                          <span className="font-semibold text-slate-700">{anc.name}</span>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tree browser */}
              <div className="border border-slate-200 rounded-xl overflow-y-auto max-h-[380px]">
                {ROOT_CATEGORY_CODES.map((root) => {
                  const rootChildren = getChildren(nodes, root);
                  if (hasActiveFilter && !rootChildren.some((n) => isNodeVisible(n.sheet1Code))) return null;
                  const isRootExpanded = hasActiveFilter ? true : expandedRoots.has(root);
                  return (
                    <div key={root} className="border-b border-slate-100 last:border-b-0">
                      <div
                        onClick={() => toggleRoot(root)}
                        className="flex items-center gap-2 py-2.5 px-3 bg-slate-50 cursor-pointer hover:bg-slate-100 transition-colors"
                      >
                        {isRootExpanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className={`w-4 h-4 text-slate-500 ${isAr ? 'rotate-180' : ''}`} />}
                        <FolderTree className="w-4 h-4 text-amber-500" />
                        <span className="font-mono text-xs font-bold underline underline-offset-2 text-slate-600">{root}</span>
                        <span className="text-xs font-bold underline underline-offset-2 text-slate-800">{ROOT_CATEGORY_LABELS[root]}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-semibold">
                          {rootChildren.length}
                        </span>
                      </div>
                      {isRootExpanded && (
                        <div className="py-1">
                          {rootChildren.map((child) => renderNode(child, 1))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Phase 3 - Approval */}
              <div className="border border-slate-200 rounded-xl px-4 py-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-700">{isAr ? 'حالة الاعتماد:' : 'Approval Status:'}</span>
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border ${badge.bg} ${badge.text} ${badge.border}`}>
                      <BadgeIcon className="w-3.5 h-3.5" />
                      {isAr ? badge.labelAr : badge.labelEn}
                    </span>
                  </div>
                  <button
                    id="cost-center-hierarchy-approve-btn"
                    type="button"
                    onClick={handleApproveClick}
                    disabled={approvalState === 'APPROVED'}
                    className="flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-xs transition-colors cursor-pointer"
                  >
                    <ClipboardCheck className="w-4 h-4" />
                    <span>{isAr ? 'اعتماد هيكل مراكز التكلفة' : 'Approve Cost Center Hierarchy'}</span>
                  </button>
                </div>

                {preApproval && !preApproval.passed && (
                  <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 space-y-1.5">
                    <p className="text-xs font-bold text-rose-700">{isAr ? 'فشل التحقق قبل الاعتماد - لا يمكن المتابعة' : 'Pre-approval validation failed - cannot proceed'}</p>
                    {preApproval.contractMismatches.map((m, idx) => (
                      <p key={`c${idx}`} className="text-[11px] text-rose-800">{m}</p>
                    ))}
                    {preApproval.excludedCodesFoundInCandidates.length > 0 && (
                      <p className="text-[11px] text-rose-800">
                        {isAr ? 'أكواد مستبعدة ظهرت ضمن المرشحين: ' : 'Excluded codes found in candidates: '}
                        {preApproval.excludedCodesFoundInCandidates.join(', ')}
                      </p>
                    )}
                    {preApproval.missingReviewRequiredCodes.length > 0 && (
                      <p className="text-[11px] text-rose-800">
                        {isAr ? 'أكواد يجب أن تكون "يحتاج مراجعة" وغير موجودة أو بحالة خاطئة: ' : 'Codes expected to be REVIEW_REQUIRED but missing/mismatched: '}
                        {preApproval.missingReviewRequiredCodes.join(', ')}
                      </p>
                    )}
                    {preApproval.furnaceCarNamesDetected.length > 0 && (
                      <p className="text-[11px] text-rose-800">
                        {isAr ? 'تم اكتشاف أسماء تشبه عربات الأفران: ' : 'Furnace-Car-like names detected: '}
                        {preApproval.furnaceCarNamesDetected.join(', ')}
                      </p>
                    )}
                    {!preApproval.summary.validation.valid && (
                      <p className="text-[11px] text-rose-800">
                        {isAr ? `مشاكل بنيوية: ${preApproval.summary.validation.issues.length}` : `Structural issues: ${preApproval.summary.validation.issues.length}`}
                      </p>
                    )}
                  </div>
                )}

                {approvalState === 'APPROVED' && (
                  <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-extrabold text-emerald-800">
                        {isAr ? 'اعتماد الهيكل الهرمي: معتمد للإنشاء' : 'Hierarchy Approval: APPROVED FOR CREATION'}
                      </p>
                      <p className="text-[11px] text-emerald-700 mt-1">
                        {isAr
                          ? 'هذا اعتماد على مستوى الواجهة فقط ولم ينشئ أي مستند بعد. استخدم قسم "التنفيذ الفعلي" أدناه لإنشاء الهيكل فعليًا في Firestore - يتطلب تسجيل دخول بصلاحية مدير وتأكيدًا يدويًا صريحًا.'
                          : 'This is a UI-level approval only and has not created any document yet. Use the "Actual Execution" section below to actually create the hierarchy in Firestore - requires an admin sign-in and an explicit manual confirm.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Phase 4B - Actual Firestore execution, gated behind a manual authenticated Confirm. See the file's docblock for the exact write boundary. */}
              {approvalState === 'APPROVED' && (
                <div className="border border-emerald-300 rounded-xl px-4 py-4 space-y-3 bg-emerald-50/30">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-800">{isAr ? 'التنفيذ الفعلي في Firestore' : 'Actual Firestore Execution'}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {isAr ? 'يتطلب تسجيل دخول بصلاحية مدير (SUPER_ADMIN/ADMIN) وتأكيدًا يدويًا' : 'Requires an admin (SUPER_ADMIN/ADMIN) sign-in and a manual confirm'}
                      </p>
                    </div>
                    <button
                      id="cost-center-hierarchy-execute-btn"
                      type="button"
                      onClick={handleExecuteClick}
                      disabled={!executionGate.canExecute}
                      title={!executionGate.canExecute ? executionGate.blockedReasons.join(', ') : undefined}
                      className="flex items-center gap-2 px-4 py-2.5 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      <Rocket className="w-4 h-4" />
                      <span>{isAr ? 'اعتماد وإنشاء الهيكل' : 'Approve & Create Hierarchy'}</span>
                    </button>
                  </div>

                  {!isAuthorizedAdmin && (
                    <p className="text-[11px] text-rose-700">
                      {isAr
                        ? 'هذا الإجراء يتطلب تسجيل الدخول بحساب بصلاحية مدير (SUPER_ADMIN أو ADMIN) - نفس نموذج الصلاحيات المستخدم في بقية شاشات البيانات الأساسية.'
                        : 'This action requires being signed in with an admin account (SUPER_ADMIN or ADMIN) - the same permission model used across the rest of Master Data.'}
                    </p>
                  )}

                  {executionState === 'creating' && (
                    <div className="flex items-center gap-2.5 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
                      <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                      <p className="text-xs text-blue-800">
                        {isAr ? `جارٍ الإنشاء في Firestore... ${executionProgress}%` : `Creating in Firestore... ${executionProgress}%`}
                      </p>
                    </div>
                  )}

                  {executionState === 'error' && executionError && (
                    <div className="flex items-start gap-2.5 bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-rose-800">{isAr ? 'فشل إنشاء الهيكل الهرمي' : 'Hierarchy creation failed'}</p>
                        <p className="text-[11px] text-rose-700 mt-1">{executionError}</p>
                      </div>
                    </div>
                  )}

                  {executionState === 'success' && executionResult && dryRun && (
                    <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-300 rounded-xl px-4 py-3">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div className="text-xs text-emerald-800 space-y-0.5">
                        <p className="font-extrabold">{isAr ? 'اكتملت المرحلة 4ب' : 'PHASE 4B COMPLETE'}</p>
                        <p>{isAr ? 'تم الإنشاء:' : 'Created:'} <strong>{executionResult.createdCount}</strong></p>
                        <p>{isAr ? 'مستبعد:' : 'Excluded:'} <strong>{dryRun.excludedBlankName + dryRun.excludedCode6041}</strong></p>
                        <p>{isAr ? 'يحتاج مراجعة:' : 'Review Required:'} <strong>{dryRun.reviewRequired}</strong></p>
                        <p>{isAr ? 'معرف دفعة الاستيراد:' : 'ImportBatchId:'} <span className="font-mono">{executionResult.importId}</span></p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {!dryRun && !parseError && !isParsing && (
            <div className="text-center py-10 text-slate-400 text-xs">
              {isAr ? 'قم برفع ملف Sheet1 لعرض المعاينة والمراجعة' : 'Upload a Sheet1 file to view the preview and review'}
            </div>
          )}
        </div>
      </div>

      {/* Approval confirmation - nested overlay, still zero Firestore calls */}
      {showApprovalConfirm && dryRun && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs" onClick={handleCancelApproval}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <h4 className="text-base font-bold text-slate-800">{isAr ? 'تأكيد الاعتماد' : 'Confirm Approval'}</h4>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              {isAr
                ? `سيتم تجهيز ${dryRun.creationCandidates} عقدة لإنشائها في هيكل مراكز التكلفة. لن يتم تعديل بيانات الإنتاج أو الأقسام الحالية. هل تريد اعتماد هذا الهيكل؟`
                : `${dryRun.creationCandidates} nodes will be prepared for creation in the cost center hierarchy. No production data or existing departments will be modified. Do you want to approve this hierarchy?`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelApproval}
                className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                id="cost-center-hierarchy-confirm-approve-btn"
                type="button"
                onClick={handleConfirmApproval}
                className="px-5 py-2 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                {isAr ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/*
        Phase 4B execution confirmation - reuses this exact same file's own
        established nested-overlay dialog pattern (see the approval
        confirmation immediately above) rather than introducing a third,
        different modal architecture. Stacked at z-[70], one layer above the
        approval confirm's z-[60], since both are the same "nested dialog
        opened from within this already-open panel" case Modal.tsx's own
        `layer: 'nested'` concept exists for - this panel just implements
        that stacking manually, consistent with itself.
        This is the ONLY place in the whole file that calls
        createCostCenterHierarchyNodes (via handleConfirmExecution) - see
        the file's docblock.
      */}
      {executionState === 'confirming' && dryRun && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs" onClick={handleCancelExecution}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5">
              <Rocket className="w-5 h-5 text-emerald-600" />
              <h4 className="text-base font-bold text-slate-800">{isAr ? 'تأكيد الإنشاء الفعلي' : 'Confirm Actual Creation'}</h4>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line">
              {isAr
                ? `سيتم إنشاء ${dryRun.creationCandidates} سجل في هيكل مراكز التكلفة داخل Firestore.\nسيتم ترك ${dryRun.excludedBlankName + dryRun.excludedCode6041} سجل خارج الإنشاء.\nهل تريد المتابعة؟`
                : `${dryRun.creationCandidates} Cost Center Hierarchy records will be created in Firestore.\n${dryRun.excludedBlankName + dryRun.excludedCode6041} records will remain uncreated.\nDo you want to continue?`}
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                id="cost-center-hierarchy-cancel-execute-btn"
                type="button"
                onClick={handleCancelExecution}
                className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              {/*
                No `disabled`/spinner state is needed here for "already
                creating" - this whole dialog is gated on
                executionState === 'confirming' (see the wrapping condition
                above), so the instant handleConfirmExecution flips state to
                'creating' this dialog itself unmounts. The REAL
                double-invocation guard is the synchronous isExecutingRef
                check at the top of handleConfirmExecution, which protects
                against a double-click within the same event-loop tick
                regardless of whether this dialog has re-rendered away yet.
              */}
              <button
                id="cost-center-hierarchy-confirm-execute-btn"
                type="button"
                onClick={handleConfirmExecution}
                className="flex items-center gap-2 px-5 py-2 text-xs font-extrabold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-xs transition-colors cursor-pointer"
              >
                <span>{isAr ? 'تأكيد' : 'Confirm'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SummaryStat: React.FC<{ label: string; value: number | string; tone?: 'slate' | 'emerald' | 'amber' | 'blue' | 'rose'; icon?: React.ElementType }> = ({
  label, value, tone = 'slate', icon: Icon,
}) => {
  const toneClasses: Record<string, string> = {
    slate: 'text-slate-800',
    emerald: 'text-emerald-700',
    amber: 'text-amber-700',
    blue: 'text-blue-700',
    rose: 'text-rose-700',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2.5">
      <p className="text-[10px] font-bold text-slate-500 mb-1">{label}</p>
      <div className={`flex items-center gap-1.5 text-lg font-extrabold ${toneClasses[tone]}`}>
        {Icon && <Icon className="w-4 h-4" />}
        <span>{value}</span>
      </div>
    </div>
  );
};

const DetailField: React.FC<{ label: string; value?: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div>
    <p className="text-[10px] font-bold text-slate-400">{label}</p>
    <p className={`text-xs font-semibold text-slate-800 ${mono ? 'font-mono' : ''}`}>{value || '-'}</p>
  </div>
);

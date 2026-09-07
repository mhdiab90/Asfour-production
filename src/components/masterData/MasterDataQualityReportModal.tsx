/**
 * Master Data Quality Report (§17-35) - detects suspicious/duplicate/similar
 * Master Data records BEFORE they cause confusion, and lets an authorized
 * user safely delete or archive them. Nothing here auto-deletes or
 * auto-merges anything; every action requires explicit selection + confirmation.
 */
import React, { useState, useMemo, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  ShieldCheck, RefreshCw, Download, ShieldAlert, CheckCircle2,
  Trash2, Archive, RotateCcw, Loader2, X, History,
} from 'lucide-react';
import { Modal } from '../common/Modal';
import { fetchMasterData, MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import { fetchProductTypes } from '../../services/productTypeService';
import { fetchAuditLogsForDocument } from '../../services/auditService';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../i18n/LanguageContext';
import {
  QualityIssue, QualityIssueType, QualitySeverity, QualityReportSummary,
  QUALITY_SCANNED_TYPES, HARD_DELETE_UNSUPPORTED,
  runMasterDataQualityScan, safeDeleteMasterDataRecord, archiveMasterDataRecord, restoreMasterDataRecord,
} from '../../services/masterDataQualityService';
import { MasterDataTab, AuditLog } from '../../types';
import { PermissionKey } from '../../types/permissions';

interface MasterDataQualityReportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ENTITY_LABELS: Record<MasterDataTab, { ar: string; en: string }> = {
  products: { ar: 'الأصناف', en: 'Products' },
  productTypes: { ar: 'تصنيفات المنتجات', en: 'Product Types' },
  employees: { ar: 'العمال والموظفون', en: 'Employees' },
  departments: { ar: 'الأقسام', en: 'Departments' },
  presses: { ar: 'المكابس', en: 'Presses' },
  furnaces: { ar: 'الأفران', en: 'Furnaces' },
  furnaceCars: { ar: 'عربات الأفران', en: 'Furnace Cars' },
  mills: { ar: 'الطواحين الصينية', en: 'Chinese Mills' },
  customers: { ar: 'العملاء', en: 'Customers' },
  shifts: { ar: 'ورديات العمل', en: 'Shifts' },
  materials: { ar: 'الخامات', en: 'Materials' },
  machines: { ar: 'الآلات', en: 'Machines' },
  stages: { ar: 'المراحل', en: 'Stages' },
};

const ISSUE_TYPE_LABELS: Record<QualityIssueType, { ar: string; en: string }> = {
  DUPLICATE_CODE: { ar: 'كود مكرر', en: 'Duplicate Code' },
  DUPLICATE_NAME: { ar: 'اسم مكرر تمامًا', en: 'Exact Duplicate Name' },
  SIMILAR_NAME: { ar: 'اسم مشابه', en: 'Similar Name' },
  MISSING_SEQUENCE: { ar: 'فجوة في التسلسل', en: 'Missing Sequence' },
  INVALID_CODE: { ar: 'تنسيق كود غير صالح', en: 'Invalid Code Format' },
  MISSING_REQUIRED: { ar: 'حقل إلزامي مفقود', en: 'Missing Required Field' },
};

const SEVERITY_STYLES: Record<QualitySeverity, string> = {
  HIGH: 'bg-red-100 text-red-800 border-red-200',
  MEDIUM: 'bg-amber-100 text-amber-800 border-amber-200',
  LOW: 'bg-sky-100 text-sky-800 border-sky-200',
  WARNING: 'bg-slate-100 text-slate-600 border-slate-200',
};

/** §34 - reuse the EXISTING per-entity delete permission keys, no new permission architecture. Entity types with no dedicated delete key (departments, productTypes) require SUPER_ADMIN, matching the fact that MasterDataView itself doesn't gate their CRUD with any permission today either. */
const ENTITY_DELETE_PERMISSION: Partial<Record<MasterDataTab, PermissionKey>> = {
  employees: 'employees.delete',
  presses: 'presses.delete',
  furnaces: 'furnaces.delete',
  furnaceCars: 'furnaceCars.delete',
  mills: 'mills.delete',
  products: 'products.delete',
  customers: 'customers.delete',
  shifts: 'shifts.delete',
  materials: 'materials.delete',
  machines: 'machines.delete',
};

export const MasterDataQualityReportModal: React.FC<MasterDataQualityReportModalProps> = ({ isOpen, onClose }) => {
  const { isSuperAdmin, hasPermission } = useAuth();
  const { language } = useLanguage();

  const [isScanning, setIsScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [issues, setIssues] = useState<QualityIssue[]>([]);
  const [summary, setSummary] = useState<QualityReportSummary | null>(null);
  const [itemsById, setItemsById] = useState<Map<string, any>>(new Map());
  const [dataByType, setDataByType] = useState<Partial<Record<MasterDataTab, any[]>>>({});

  const [entityFilter, setEntityFilter] = useState<'ALL' | MasterDataTab>('ALL');
  const [issueFilter, setIssueFilter] = useState<'ALL' | QualityIssueType>('ALL');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | QualitySeverity>('ALL');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmState, setConfirmState] = useState<{ type: 'DELETE' | 'ARCHIVE'; targetIssues: QualityIssue[] } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  /** §28 - read-only Master Data edit history, sourced from the EXISTING auditLogs collection. */
  const [historyState, setHistoryState] = useState<{ issue: QualityIssue; logs: AuditLog[] } | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  /** §19 - if the record changed since this scan last fetched it, warn before restoring instead of silently overwriting. */
  const [conflictState, setConflictState] = useState<{ issue: QualityIssue; freshItem: any } | null>(null);

  const canView = isSuperAdmin || hasPermission('masterdata.view' as PermissionKey);

  const canActOn = useCallback((entityType: MasterDataTab): boolean => {
    if (isSuperAdmin) return true;
    const key = ENTITY_DELETE_PERMISSION[entityType];
    return !!key && hasPermission(key);
  }, [isSuperAdmin, hasPermission]);

  const runScan = useCallback(async () => {
    setIsScanning(true);
    setActionMessage(null);
    try {
      // §1/§2 - the 9 small Master Data types are cheap/bounded (hundreds of
      // records at most) and safe to fetch together. `products` (thousands of
      // records) is fetched SEPARATELY and sequenced after this batch
      // completes, instead of joining one 10-way Firestore read burst - this
      // is what previously triggered 429 RESOURCE_EXHAUSTED. `production`
      // (the full historical import history, potentially far larger than
      // `products`) is intentionally never fetched here at all - see
      // referenceCountStatus/§5 below.
      const smallTypes = QUALITY_SCANNED_TYPES.filter((t) => t !== 'products');
      const smallResults = await Promise.all(
        smallTypes.map((t) => (t === 'productTypes' ? fetchProductTypes() : fetchMasterData(MASTER_DATA_COLLECTIONS[t])))
      );
      const products = await fetchMasterData(MASTER_DATA_COLLECTIONS.products);

      const byType: Partial<Record<MasterDataTab, any[]>> = { products };
      const idMap = new Map<string, any>();
      smallTypes.forEach((t, idx) => {
        const list = smallResults[idx] as any[];
        byType[t] = list;
        list.forEach((item) => idMap.set(`${t}::${item.id}`, item));
      });
      products.forEach((item: any) => idMap.set(`products::${item.id}`, item));

      setDataByType(byType);
      setItemsById(idMap);
      // productionRecords=null - reference counts for production-dependent
      // entity types (employees/presses/furnaceCars/customers/shifts/furnaces)
      // are reported as NOT_RUN_FOR_LARGE_DATASET and treated as protected by
      // default (never silently "0 references, safe to delete").
      const scan = runMasterDataQualityScan(byType, null);
      setIssues(scan.issues);
      setSummary(scan.summary);
      setSelectedIds(new Set());
      setHasScanned(true);
    } catch (err) {
      console.error('Master Data Quality scan failed:', err);
      setActionMessage(language === 'ar' ? 'فشل تشغيل الفحص. حاول مرة أخرى.' : 'Scan failed. Please try again.');
    } finally {
      setIsScanning(false);
    }
  }, [language]);

  const filteredIssues = useMemo(() => {
    return issues.filter((i) =>
      (entityFilter === 'ALL' || i.entityType === entityFilter) &&
      (issueFilter === 'ALL' || i.issueType === issueFilter) &&
      (severityFilter === 'ALL' || i.severity === severityFilter)
    );
  }, [issues, entityFilter, issueFilter, severityFilter]);

  const toggleOne = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectAllSafeCandidates = () => {
    setSelectedIds(new Set(
      filteredIssues.filter((i) => !i.isProtected && i.issueType !== 'MISSING_SEQUENCE' && canActOn(i.entityType)).map((i) => i.id)
    ));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const selectedIssues = useMemo(() => issues.filter((i) => selectedIds.has(i.id)), [issues, selectedIds]);
  /** Multiple issues can point at the same document (e.g. both a duplicate-code AND a similar-name hit) - dedupe by documentId before acting. */
  const uniqueTargetsFor = (list: QualityIssue[]) => {
    const seen = new Set<string>();
    const out: QualityIssue[] = [];
    for (const i of list) {
      const key = `${i.entityType}::${i.documentId}`;
      if (i.documentId && !seen.has(key)) { seen.add(key); out.push(i); }
    }
    return out;
  };

  const handleConfirmAction = async () => {
    if (!confirmState) return;
    setIsProcessing(true);
    let deleted = 0, archived = 0, blocked = 0;
    // §29 - one shared bulk-operation id tags every individual record's own
    // audit entry when more than one record is acted on together, without
    // replacing the per-record entries with a single combined one.
    const bulkOperationId = confirmState.targetIssues.length > 1 ? `BULK-${Date.now()}` : null;
    try {
      for (const issue of confirmState.targetIssues) {
        const item = itemsById.get(`${issue.entityType}::${issue.documentId}`);
        if (!item) continue;
        const reasonPrefix = bulkOperationId ? `[${bulkOperationId}] ` : '';
        if (confirmState.type === 'ARCHIVE') {
          await archiveMasterDataRecord(issue.entityType, item, `${reasonPrefix}تقرير جودة البيانات: ${ISSUE_TYPE_LABELS[issue.issueType].ar}`, issue.referenceCount);
          archived++;
        } else {
          const outcome = await safeDeleteMasterDataRecord(issue.entityType, item, issue.referenceCount, `${reasonPrefix}تقرير جودة البيانات: ${ISSUE_TYPE_LABELS[issue.issueType].ar}`, issue.referenceCountUnknown);
          if (outcome === 'DELETED') deleted++;
          else if (outcome === 'ARCHIVED') archived++;
          else blocked++;
        }
      }
      setActionMessage(
        language === 'ar'
          ? `تم: ${deleted} حذف نهائي، ${archived} تعطيل/أرشفة${blocked > 0 ? `، ${blocked} تم حظرها لوجود إشارات مرجعية` : ''}.`
          : `Done: ${deleted} deleted, ${archived} archived/deactivated${blocked > 0 ? `, ${blocked} blocked (referenced by production data)` : ''}.`
      );
    } finally {
      setIsProcessing(false);
      setConfirmState(null);
      await runScan();
    }
  };

  /**
   * §19 Conflict Detection - re-fetches the record fresh right before acting
   * and compares `updatedAt` against what this scan cached. If someone else
   * changed the record in between, this stops and asks for explicit
   * confirmation instead of silently overwriting the newer state.
   */
  const handleRestore = async (issue: QualityIssue) => {
    const cachedItem = itemsById.get(`${issue.entityType}::${issue.documentId}`);
    if (!cachedItem) return;
    setIsProcessing(true);
    try {
      const freshList = await fetchMasterData<any>(MASTER_DATA_COLLECTIONS[issue.entityType]);
      const freshItem = freshList.find((i: any) => i.id === issue.documentId) || cachedItem;
      if (cachedItem.updatedAt && freshItem.updatedAt && freshItem.updatedAt !== cachedItem.updatedAt) {
        setConflictState({ issue, freshItem });
        return;
      }
      await restoreMasterDataRecord(issue.entityType, freshItem);
      setActionMessage(language === 'ar' ? 'تمت الاستعادة بنجاح.' : 'Restored successfully.');
      await runScan();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmRestoreDespiteConflict = async () => {
    if (!conflictState) return;
    setIsProcessing(true);
    try {
      await restoreMasterDataRecord(conflictState.issue.entityType, conflictState.freshItem);
      setActionMessage(language === 'ar' ? 'تمت الاستعادة بنجاح.' : 'Restored successfully.');
      setConflictState(null);
      await runScan();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleViewHistory = async (issue: QualityIssue) => {
    setIsLoadingHistory(true);
    try {
      const logs = await fetchAuditLogsForDocument(MASTER_DATA_COLLECTIONS[issue.entityType], issue.documentId, 30);
      setHistoryState({ issue, logs });
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleExport = () => {
    if (filteredIssues.length === 0) return;
    const rows = filteredIssues.map((i) => ({
      [language === 'ar' ? 'النوع' : 'Entity Type']: ENTITY_LABELS[i.entityType]?.[language] || i.entityType,
      [language === 'ar' ? 'معرف المستند' : 'Document ID']: i.documentId,
      [language === 'ar' ? 'الكود' : 'Code']: i.code,
      [language === 'ar' ? 'الاسم' : 'Name']: i.name,
      [language === 'ar' ? 'المشكلة' : 'Issue']: ISSUE_TYPE_LABELS[i.issueType][language],
      [language === 'ar' ? 'التشابه' : 'Similarity']: i.confidence ?? '',
      [language === 'ar' ? 'مطابقة مقترحة' : 'Suggested Match']: i.relatedName || i.relatedCode || '',
      [language === 'ar' ? 'الخطورة' : 'Severity']: i.severity,
      [language === 'ar' ? 'عدد الإشارات المرجعية' : 'Reference Count']: i.referenceCountUnknown ? (language === 'ar' ? 'غير معروف' : 'unknown') : i.referenceCount,
      [language === 'ar' ? 'القرار' : 'Decision']: selectedIds.has(i.id) ? (language === 'ar' ? 'محدد' : 'Selected') : (language === 'ar' ? 'مراجعة' : 'Review'),
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, language === 'ar' ? 'جودة البيانات' : 'Data Quality');
    XLSX.writeFile(workbook, `master-data-quality-report-${Date.now()}.xlsx`);
  };

  if (!isOpen) return null;

  if (!canView) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title={language === 'ar' ? 'تقرير جودة البيانات الأساسية' : 'Master Data Quality Report'} maxWidth="md">
        <p className="text-sm text-red-700 font-bold">{language === 'ar' ? 'ليس لديك صلاحية عرض هذا التقرير.' : 'You do not have permission to view this report.'}</p>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'ar' ? 'تقرير جودة البيانات الأساسية' : 'Master Data Quality Report'}
      subtitle={language === 'ar' ? 'كشف الأكواد المشبوهة والأسماء المتشابهة/المكررة قبل أن تتحول إلى مشكلة.' : 'Detect suspicious codes and duplicate/similar names before they become a problem.'}
      maxWidth="4xl"
    >
      <div className="space-y-4">
        {!hasScanned ? (
          <div className="text-center py-10">
            <ShieldCheck className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-4">{language === 'ar' ? 'اضغط لبدء فحص جودة البيانات الأساسية.' : 'Click to start scanning Master Data quality.'}</p>
            <button type="button" onClick={runScan} disabled={isScanning} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl inline-flex items-center gap-2 cursor-pointer disabled:opacity-50">
              {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span>{language === 'ar' ? 'بدء الفحص' : 'Run Scan'}</span>
            </button>
          </div>
        ) : (
          <>
            {actionMessage && (
              <div className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-bold text-indigo-900 flex items-center justify-between">
                <span>{actionMessage}</span>
                <button type="button" onClick={() => setActionMessage(null)} className="text-indigo-400 hover:text-indigo-700 cursor-pointer"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}

            {/* Summary (§31) */}
            {summary && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {[
                  { label: language === 'ar' ? 'إجمالي السجلات' : 'Total Scanned', value: summary.totalScanned },
                  { label: language === 'ar' ? 'أكواد مكررة' : 'Duplicate Codes', value: summary.duplicateCodes },
                  { label: language === 'ar' ? 'أسماء متشابهة' : 'Similar Names', value: summary.similarNames },
                  { label: language === 'ar' ? 'أسماء مكررة' : 'Exact Duplicates', value: summary.exactDuplicateNames },
                  { label: language === 'ar' ? 'أكواد غير صالحة' : 'Invalid Codes', value: summary.invalidCodes },
                  { label: language === 'ar' ? 'فجوات تسلسل' : 'Sequence Warnings', value: summary.missingSequenceWarnings },
                  { label: language === 'ar' ? 'حقول مفقودة' : 'Missing Fields', value: summary.missingRequiredFields },
                  { label: language === 'ar' ? 'محمي (مرتبط بإنتاج)' : 'Protected', value: summary.protectedRecords },
                  { label: language === 'ar' ? 'مرشح آمن' : 'Safe Candidates', value: summary.safeCandidates },
                  { label: language === 'ar' ? 'يحتاج مراجعة' : 'Needs Review', value: summary.needsReview },
                ].map((s) => (
                  <div key={s.label} className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-center">
                    <span className="text-[9px] font-bold text-slate-500 block">{s.label}</span>
                    <span className="text-sm font-black text-slate-900">{s.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* §4/§5 - scan completeness must never be silently hidden: which
                entity types had the O(n^2) similar-name pass skipped for size
                safety, and whether production-history-derived reference
                counts were actually verified. */}
            {summary && (() => {
              const skippedSimilar = (Object.entries(summary.similarNameScanStatus) as [MasterDataTab, string][])
                .filter(([, status]) => status === 'SKIPPED_LARGE_DATASET')
                .map(([t]) => ENTITY_LABELS[t]?.[language] || t);
              const refCountNotRun = summary.referenceCountStatus === 'NOT_RUN_FOR_LARGE_DATASET';
              if (skippedSimilar.length === 0 && !refCountNotRun) return null;
              return (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] font-bold text-amber-900 space-y-1">
                  {skippedSimilar.length > 0 && (
                    <div>
                      {language === 'ar'
                        ? `تم تخطي فحص الأسماء المتشابهة لـ: ${skippedSimilar.join('، ')} (عدد كبير من السجلات - لتجنب تجميد المتصفح).`
                        : `Similar-name scan skipped for: ${skippedSimilar.join(', ')} (large record count - to avoid freezing the browser).`}
                    </div>
                  )}
                  {refCountNotRun && (
                    <div>
                      {language === 'ar'
                        ? 'لم يتم فحص السجل التاريخي الكامل للإنتاج لهذا التقرير (لتجنب قراءة ضخمة). العناصر التي تعتمد عليه (موظفين، مكابس، عربات أفران، عملاء، ورديات، أفران) تُعامل كمحمية افتراضيًا بدلًا من افتراض عدم وجود إشارات مرجعية.'
                        : 'The full production history was not scanned for this report (to avoid a heavy read). Entity types that depend on it (employees, presses, furnace cars, customers, shifts, furnaces) are treated as protected by default rather than assumed to have zero references.'}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Filters (§24) */}
            <div className="flex flex-wrap items-center gap-2">
              <select value={entityFilter} onChange={(e) => setEntityFilter(e.target.value as any)} className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg">
                <option value="ALL">{language === 'ar' ? 'كل الأنواع' : 'All Types'}</option>
                {QUALITY_SCANNED_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t][language]}</option>)}
              </select>
              <select value={issueFilter} onChange={(e) => setIssueFilter(e.target.value as any)} className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg">
                <option value="ALL">{language === 'ar' ? 'كل المشاكل' : 'All Issues'}</option>
                {(Object.keys(ISSUE_TYPE_LABELS) as QualityIssueType[]).map((t) => <option key={t} value={t}>{ISSUE_TYPE_LABELS[t][language]}</option>)}
              </select>
              <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as any)} className="px-2 py-1.5 text-xs border border-slate-300 rounded-lg">
                <option value="ALL">{language === 'ar' ? 'كل درجات الخطورة' : 'All Severities'}</option>
                {(['HIGH', 'MEDIUM', 'LOW', 'WARNING'] as QualitySeverity[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>

              <div className="mr-auto flex items-center gap-1.5">
                <button type="button" onClick={runScan} disabled={isScanning} className="px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer flex items-center gap-1 disabled:opacity-50">
                  {isScanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {language === 'ar' ? 'إعادة الفحص' : 'Refresh Scan'}
                </button>
                <button type="button" onClick={handleExport} disabled={filteredIssues.length === 0} className="px-2.5 py-1.5 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg cursor-pointer flex items-center gap-1 disabled:opacity-40">
                  <Download className="w-3.5 h-3.5" />
                  {language === 'ar' ? 'تصدير' : 'Export'}
                </button>
              </div>
            </div>

            {/* Actions (§25/§26/§32) */}
            <div className="flex flex-wrap items-center gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-[11px] font-bold text-slate-500">{selectedIds.size} {language === 'ar' ? 'محدد' : 'selected'}</span>
              <button type="button" onClick={selectAllSafeCandidates} className="px-2 py-1 text-[10px] font-bold bg-white hover:bg-slate-100 border border-emerald-200 text-emerald-700 rounded-lg cursor-pointer">
                {language === 'ar' ? 'تحديد كل المرشحين الآمنين' : 'Select All Safe Candidates'}
              </button>
              <button type="button" onClick={clearSelection} className="px-2 py-1 text-[10px] font-bold bg-white hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-lg cursor-pointer">
                {language === 'ar' ? 'مسح التحديد (يحتفظ)' : 'Clear Selection (Keep)'}
              </button>
              <button
                type="button"
                disabled={selectedIssues.length === 0}
                onClick={() => setConfirmState({ type: 'ARCHIVE', targetIssues: uniqueTargetsFor(selectedIssues) })}
                className="px-2 py-1 text-[10px] font-bold bg-white hover:bg-amber-50 border border-amber-200 text-amber-700 rounded-lg cursor-pointer disabled:opacity-40"
              >
                {language === 'ar' ? 'أرشفة/تعطيل المحدد' : 'Archive Selected'}
              </button>
              <button
                type="button"
                disabled={selectedIssues.length === 0}
                onClick={() => setConfirmState({ type: 'DELETE', targetIssues: uniqueTargetsFor(selectedIssues) })}
                className="px-2 py-1 text-[10px] font-bold bg-white hover:bg-red-50 border border-red-200 text-red-700 rounded-lg cursor-pointer disabled:opacity-40"
              >
                {language === 'ar' ? 'حذف المحدد' : 'Delete Selected'}
              </button>
            </div>

            {/* Report Table (§23) */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-96">
              <table className="w-full text-right text-[11px]">
                <thead className="bg-slate-50 text-slate-700 font-black sticky top-0 z-10 border-b border-slate-200">
                  <tr>
                    <th className="p-2"></th>
                    <th className="p-2">{language === 'ar' ? 'النوع' : 'Type'}</th>
                    <th className="p-2">{language === 'ar' ? 'الكود' : 'Code'}</th>
                    <th className="p-2">{language === 'ar' ? 'الاسم' : 'Name'}</th>
                    <th className="p-2">{language === 'ar' ? 'المشكلة' : 'Issue'}</th>
                    <th className="p-2">{language === 'ar' ? 'مشابه/متوقع' : 'Similar/Expected'}</th>
                    <th className="p-2">{language === 'ar' ? 'الثقة' : 'Confidence'}</th>
                    <th className="p-2">{language === 'ar' ? 'مرجعي' : 'Refs'}</th>
                    <th className="p-2">{language === 'ar' ? 'إجراء' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {filteredIssues.map((issue) => {
                    const item = itemsById.get(`${issue.entityType}::${issue.documentId}`);
                    const isArchived = item && item.active === false;
                    const allowed = canActOn(issue.entityType);
                    return (
                      <tr key={issue.id} className={issue.severity === 'HIGH' ? 'bg-red-50/40' : issue.severity === 'MEDIUM' ? 'bg-amber-50/30' : ''}>
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(issue.id)}
                            disabled={!allowed || issue.issueType === 'MISSING_SEQUENCE'}
                            onChange={() => toggleOne(issue.id)}
                            className="w-3.5 h-3.5 cursor-pointer disabled:opacity-30"
                          />
                        </td>
                        <td className="p-2 font-sans">{ENTITY_LABELS[issue.entityType]?.[language] || issue.entityType}</td>
                        <td className="p-2">{issue.code || '-'}</td>
                        <td className="p-2 font-sans">{issue.name || '-'}</td>
                        <td className="p-2 font-sans">
                          <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${SEVERITY_STYLES[issue.severity]}`}>
                            {ISSUE_TYPE_LABELS[issue.issueType][language]}
                          </span>
                          <div className="text-[10px] text-slate-500 mt-0.5 font-sans">{language === 'ar' ? issue.descriptionAr : issue.descriptionEn}</div>
                        </td>
                        <td className="p-2 font-sans">{issue.relatedName || issue.relatedCode || '-'}</td>
                        <td className="p-2">{issue.confidence != null ? `${issue.confidence}%` : '-'}</td>
                        <td className="p-2 text-center">
                          {issue.documentId ? (
                            issue.referenceCountUnknown ? (
                              <span className="font-bold text-amber-600" title={language === 'ar' ? 'غير محقق - لم يتم فحص سجل الإنتاج الكامل' : 'Unverified - full production history not scanned'}>{language === 'ar' ? 'غير معروف' : 'unknown'}</span>
                            ) : (
                              <span className={`font-bold ${issue.referenceCount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{issue.referenceCount}</span>
                            )
                          ) : '-'}
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1">
                            {issue.documentId && (
                              <button type="button" onClick={() => handleViewHistory(issue)} disabled={isLoadingHistory} className="px-1.5 py-0.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-bold cursor-pointer flex items-center gap-1">
                                <History className="w-3 h-3" />{language === 'ar' ? 'السجل' : 'History'}
                              </button>
                            )}
                            {!allowed ? (
                              <span className="text-[10px] text-slate-400">{language === 'ar' ? 'بدون صلاحية' : 'No permission'}</span>
                            ) : issue.issueType === 'MISSING_SEQUENCE' ? null : isArchived ? (
                              <button type="button" onClick={() => handleRestore(issue)} disabled={isProcessing} className="px-1.5 py-0.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded text-[10px] font-bold cursor-pointer flex items-center gap-1">
                                <RotateCcw className="w-3 h-3" />{language === 'ar' ? 'استعادة' : 'Restore'}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredIssues.length === 0 && (
                    <tr><td colSpan={9} className="p-6 text-center text-slate-400 font-sans">{language === 'ar' ? 'لا توجد نتائج مطابقة للفلاتر الحالية.' : 'No results match the current filters.'}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Confirmation (§26/§27) */}
      {confirmState && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60" onClick={() => !isProcessing && setConfirmState(null)}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <ShieldAlert className={`w-5 h-5 ${confirmState.type === 'DELETE' ? 'text-red-600' : 'text-amber-600'}`} />
              <h4 className="text-sm font-black text-slate-900">
                {confirmState.type === 'DELETE'
                  ? (language === 'ar' ? 'تأكيد حذف السجلات المحددة' : 'Confirm Deleting Selected Records')
                  : (language === 'ar' ? 'تأكيد أرشفة/تعطيل السجلات المحددة' : 'Confirm Archiving Selected Records')}
              </h4>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-center">
                <span className="block font-bold text-slate-500">{language === 'ar' ? 'عدد السجلات' : 'Records'}</span>
                <span className="text-base font-black text-slate-900">{confirmState.targetIssues.length}</span>
              </div>
              <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-center">
                <span className="block font-bold text-red-700">{language === 'ar' ? 'مرتبط ببيانات إنتاج' : 'Referenced by production'}</span>
                <span className="text-base font-black text-red-900">{confirmState.targetIssues.filter((i) => i.isProtected).length}</span>
              </div>
            </div>
            <div className="max-h-40 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-100">
              {confirmState.targetIssues.map((i) => (
                <div key={i.id} className="p-1.5 text-[11px] flex items-center justify-between">
                  <span className="font-sans">{ENTITY_LABELS[i.entityType]?.[language]} - {i.code} - {i.name}</span>
                  {i.referenceCountUnknown ? (
                    <span className="text-amber-600 font-bold">{language === 'ar' ? 'غير محقق' : 'unverified'}</span>
                  ) : i.isProtected && (
                    <span className="text-red-600 font-bold">{language === 'ar' ? 'محمي' : 'protected'}</span>
                  )}
                </div>
              ))}
            </div>
            {confirmState.type === 'DELETE' && confirmState.targetIssues.some((i) => i.isProtected || HARD_DELETE_UNSUPPORTED.includes(i.entityType)) && (
              <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
                {language === 'ar'
                  ? 'هذا البيان مستخدم في سجلات حالية ولا يمكن حذفه بأمان - سيتم تعطيله/أرشفته بدلاً من الحذف النهائي.'
                  : 'This record is referenced by existing data and cannot be safely deleted - it will be deactivated/archived instead of hard-deleted.'}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setConfirmState(null)} disabled={isProcessing} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleConfirmAction}
                disabled={isProcessing}
                className={`px-4 py-2 text-xs font-black text-white rounded-lg cursor-pointer flex items-center gap-1.5 disabled:opacity-50 ${confirmState.type === 'DELETE' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'}`}
              >
                {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmState.type === 'DELETE' ? <Trash2 className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                <span>{confirmState.type === 'DELETE' ? (language === 'ar' ? 'تأكيد الحذف' : 'Confirm Delete') : (language === 'ar' ? 'تأكيد الأرشفة' : 'Confirm Archive')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Master Data Edit History (§17/§28) - read-only, sourced from auditLogs */}
      {historyState && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60" onClick={() => setHistoryState(null)}>
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                <History className="w-4 h-4 text-slate-500" />
                {language === 'ar' ? `سجل التعديلات - ${historyState.issue.code || historyState.issue.name}` : `Edit History - ${historyState.issue.code || historyState.issue.name}`}
              </h4>
              <button type="button" onClick={() => setHistoryState(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
              {historyState.logs.length === 0 ? (
                <p className="text-xs text-slate-500">{language === 'ar' ? 'لا يوجد سجل تعديلات لهذا البيان.' : 'No edit history for this record.'}</p>
              ) : (
                historyState.logs.map((log) => (
                  <div key={log.id} className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="font-black text-slate-800">{log.action}</span>
                      <span className="text-slate-400 font-mono">{new Date(log.timestamp).toLocaleString(language === 'ar' ? 'ar-EG' : 'en-US')}</span>
                    </div>
                    <div className="text-slate-500">{language === 'ar' ? 'بواسطة: ' : 'By: '}{log.username}</div>
                    {log.details && <div className="text-slate-700 font-sans">{log.details}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* §19 Conflict warning before a potentially destructive restore */}
      {conflictState && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60" onClick={() => setConflictState(null)}>
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              <h4 className="text-sm font-black text-slate-900">{language === 'ar' ? 'تعارض في الإصدار' : 'Version Conflict'}</h4>
            </div>
            <p className="text-sm font-bold text-amber-950 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              {language === 'ar'
                ? 'تم تعديل هذا البيان بعد الإصدار الذي اخترته. هل تريد استبداله بهذا الإصدار؟'
                : 'This record was modified after the selected version. Do you want to replace the current version?'}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setConflictState(null)} disabled={isProcessing} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">
                {language === 'ar' ? 'إلغاء' : 'Cancel'}
              </button>
              <button type="button" onClick={handleConfirmRestoreDespiteConflict} disabled={isProcessing} className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 rounded-lg cursor-pointer disabled:opacity-50">
                {language === 'ar' ? 'استبدال والمتابعة' : 'Replace & Continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

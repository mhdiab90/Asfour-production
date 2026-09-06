/**
 * ASFOUR ERP - Batch Add Missing Master Data Modal
 *
 * Reviews and confirms multiple missing Master Data tokens of ONE entity
 * type (Furnace Cars, Employees, Presses, or Products - never mixed) before
 * creating them in Firestore.
 *
 * Strict Safety:
 * - Client-side duplicate detection against the already-loaded master data
 *   list for this domain (reuses the SAME normalizers as the fuzzy-matching
 *   engine - no second/incompatible validation system).
 * - Rows that already exist offer Use Existing / Edit / Cancel instead of a
 *   silent duplicate write.
 * - Each row is created independently: one failure never blocks the rest
 *   (partial save), and failed/duplicate rows stay in the modal, editable,
 *   for the operator to correct or resolve.
 * - Full audit logging and row resolution/mapping for every outcome.
 */
import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  CheckCircle2,
  Layers,
  Flame,
  User,
  Wrench,
  Box,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  RefreshCw,
  Ban,
} from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { createMasterDataItem } from '../../services/masterDataService';
import { logAuditAction } from '../../services/auditService';
import { saveApprovedMappingBatch } from '../../services/importMappingService';
import { normalizeArabicForComparison, normalizeCodeForComparison } from '../../utils/fuzzyMatching';

export interface MissingEntityItem {
  id: string; // unique key in modal list
  domain: 'furnaceCar' | 'employee' | 'press' | 'product' | 'customer' | 'shift' | 'material' | 'chineseMill' | 'faultType';
  token: string;
  suggestedCode: string;
  suggestedName: string;
  collectionName: string;
  selected: boolean;
  extraProps?: Record<string, any>;
}

type RowStatus = 'NEW' | 'ALREADY_EXISTS' | 'USE_EXISTING' | 'SAVING' | 'CREATED' | 'FAILED';

interface RowState extends MissingEntityItem {
  status: RowStatus;
  existingMatch?: { id: string; code: string; name: string };
  errorReason?: string;
}

export interface BatchAddResultItem {
  domain: string;
  token: string;
  item: any;
  wasNewlyCreated: boolean;
}

export interface BatchAddMasterDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: MissingEntityItem[];
  /** Full existing master-data list for THIS domain only, used for client-side duplicate detection. */
  existingItemsForDomain?: any[];
  /** Optional dynamic title for the single-entity-type popup (e.g. "إضافة جميع العربات"). */
  entityLabelAr?: string;
  entityLabelEn?: string;
  onBatchCreated: (createdItems: BatchAddResultItem[]) => void;
}

/** Domains whose real Master Data schema permits a Name-only record with no business code (Part 6.1-6.4: never invent a code - "customer"/"faultType" may legitimately have none; "chineseMill"/others keep the existing code-required behavior since their identity IS the code). */
const CODE_OPTIONAL_DOMAINS = new Set(['customer', 'faultType']);

function findExistingMatch(code: string, name: string, existingItems: any[] | undefined): { id: string; code: string; name: string } | undefined {
  if (!existingItems || existingItems.length === 0) return undefined;
  const normCode = normalizeCodeForComparison(code);
  const normName = normalizeArabicForComparison(name);
  const match = existingItems.find((e) => {
    const eCode = normalizeCodeForComparison(e.code || e.carNumber || '');
    const eName = normalizeArabicForComparison(e.name || e.carNumber || '');
    return (normCode && eCode === normCode) || (normName && eName === normName);
  });
  if (!match) return undefined;
  return { id: match.id, code: match.code || match.carNumber || '', name: match.name || match.carNumber || '' };
}

export const BatchAddMasterDataModal: React.FC<BatchAddMasterDataModalProps> = ({
  isOpen,
  onClose,
  items: initialItems,
  existingItemsForDomain,
  entityLabelAr,
  entityLabelEn,
  onBatchCreated,
}) => {
  const { language, isRtl } = useLanguage();

  const [rows, setRows] = useState<RowState[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastSummary, setLastSummary] = useState<{ created: number; usedExisting: number; failed: number } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRows(
        initialItems.map((item) => {
          const existingMatch = findExistingMatch(item.suggestedCode, item.suggestedName, existingItemsForDomain);
          return { ...item, selected: true, status: existingMatch ? 'ALREADY_EXISTS' : 'NEW', existingMatch };
        })
      );
      setErrorMsg(null);
      setLastSummary(null);
    }
  }, [isOpen, initialItems, existingItemsForDomain]);

  if (!isOpen) return null;

  const recheckRow = (row: RowState): RowState => {
    if (row.status === 'CREATED' || row.status === 'SAVING') return row;
    const existingMatch = findExistingMatch(row.suggestedCode, row.suggestedName, existingItemsForDomain);
    return { ...row, existingMatch, status: existingMatch ? 'ALREADY_EXISTS' : 'NEW', errorReason: undefined };
  };

  const handleToggleSelect = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)));
  };

  const handleSelectAll = (select: boolean) => {
    setRows((prev) => prev.map((r) => (r.status === 'CREATED' ? r : { ...r, selected: select })));
  };

  const handleFieldChange = (id: string, field: 'suggestedCode' | 'suggestedName', value: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? recheckRow({ ...r, [field]: value }) : r)));
  };

  const handleUseExisting = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'USE_EXISTING' } : r)));
  };

  const handleCancelRow = (id: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, selected: false } : r)));
  };

  const selectableRows = rows.filter((r) => r.status !== 'CREATED');
  const selectedCount = selectableRows.filter((r) => r.selected).length;

  const handleConfirmBatchAdd = async () => {
    const targetRows = rows.filter((r) => r.selected && r.status !== 'CREATED');
    if (targetRows.length === 0) {
      setErrorMsg(language === 'ar' ? 'يرجى تحديد عنصر واحد على الأقل للإضافة.' : 'Please select at least one item to add.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const createdResults: BatchAddResultItem[] = [];
    const mappingEntries: Array<{
      domain: string;
      originalValue: string;
      mappedEntityId: string;
      mappedEntityName: string;
      mappedEntityCode?: string;
      confidence: number;
      matchType: string;
    }> = [];

    let createdCount = 0;
    let usedExistingCount = 0;
    let failedCount = 0;

    // Mark all target rows as SAVING for live feedback, then process each
    // independently - one row's failure or pre-existing duplicate must never
    // block the rest (partial save requirement).
    setRows((prev) => prev.map((r) => (targetRows.some((t) => t.id === r.id) ? { ...r, status: 'SAVING' } : r)));

    const finalRowUpdates: Record<string, Partial<RowState>> = {};

    for (const row of targetRows) {
      const code = row.suggestedCode.trim();
      const name = row.suggestedName.trim();

      if (!code && !CODE_OPTIONAL_DOMAINS.has(row.domain)) {
        failedCount++;
        finalRowUpdates[row.id] = { status: 'FAILED', errorReason: language === 'ar' ? 'الكود مطلوب.' : 'Code is required.' };
        continue;
      }

      // "Use Existing" rows never create a new record - they resolve
      // directly to the entity the operator picked, preventing a duplicate.
      if (row.status === 'USE_EXISTING' && row.existingMatch) {
        usedExistingCount++;
        finalRowUpdates[row.id] = { status: 'CREATED' };
        createdResults.push({
          domain: row.domain,
          token: row.token,
          item: { id: row.existingMatch.id, code: row.existingMatch.code, name: row.existingMatch.name, collectionName: row.collectionName },
          wasNewlyCreated: false,
        });
        mappingEntries.push({
          domain: row.domain === 'furnaceCar' ? 'furnace_car' : row.domain,
          originalValue: row.token,
          mappedEntityId: row.existingMatch.id,
          mappedEntityName: row.existingMatch.name,
          mappedEntityCode: row.existingMatch.code,
          confidence: 100,
          matchType: 'BATCH_USE_EXISTING',
        });
        await logAuditAction(
          'UPDATE',
          row.collectionName,
          row.existingMatch.id,
          `استخدام بيان أساسي موجود بدلاً من إنشاء تكرار أثناء الاستيراد: ${row.existingMatch.name} (${row.token})`
        ).catch(() => {});
        continue;
      }

      // A row still flagged ALREADY_EXISTS that the operator neither
      // resolved to "Use Existing" nor edited to a new value must not be
      // silently created as a duplicate.
      if (row.status === 'ALREADY_EXISTS') {
        failedCount++;
        finalRowUpdates[row.id] = {
          status: 'ALREADY_EXISTS',
          errorReason: language === 'ar' ? 'موجود مسبقاً - اختر "استخدام الموجود" أو عدّل الكود.' : 'Already exists - choose "Use Existing" or edit the code.',
        };
        continue;
      }

      let payload: Record<string, any> = { code, name, active: true, ...row.extraProps };
      if (row.domain === 'furnaceCar') {
        payload.carNumber = row.token.trim();
        payload.carNumberNormalized = row.token.trim().toLowerCase();
        payload.carCodeNormalized = code.toLowerCase();
      }

      try {
        // createMasterDataItem() returns only the new Firestore document ID
        // (string | undefined) - never an object with .id/.name/.code.
        const createdId = await createMasterDataItem(row.collectionName as any, payload);
        if (!createdId) {
          throw new Error(language === 'ar' ? 'تعذر إنشاء وربط البيان الأساسي.' : 'Failed to create and map the master-data record.');
        }

        const createdEntity: Record<string, any> = { id: createdId, code: payload.code, name: payload.name, collectionName: row.collectionName };
        if (row.domain === 'furnaceCar') createdEntity.carNumber = payload.carNumber;

        createdCount++;
        finalRowUpdates[row.id] = { status: 'CREATED' };
        createdResults.push({ domain: row.domain, token: row.token, item: createdEntity, wasNewlyCreated: true });
        mappingEntries.push({
          domain: row.domain === 'furnaceCar' ? 'furnace_car' : row.domain,
          originalValue: row.token,
          mappedEntityId: createdId,
          mappedEntityName: payload.name,
          mappedEntityCode: payload.code,
          confidence: 100,
          matchType: 'BATCH_INLINE_ADD',
        });

        await logAuditAction(
          'CREATE',
          row.collectionName,
          createdId,
          `إضافة جماعية لبيان أساسي مفقود أثناء الاستيراد: ${payload.name} (${row.token})`
        ).catch(() => {});
      } catch (err: any) {
        failedCount++;
        finalRowUpdates[row.id] = { status: 'FAILED', errorReason: err?.message || (language === 'ar' ? 'خطأ غير معروف.' : 'Unknown error.') };
      }
    }

    setRows((prev) => prev.map((r) => (finalRowUpdates[r.id] ? { ...r, ...finalRowUpdates[r.id] } : r)));
    setLastSummary({ created: createdCount, usedExisting: usedExistingCount, failed: failedCount });

    // Records that were actually created/resolved must be reflected in the
    // import rows immediately, even if mapping-history persistence below
    // fails or some other row failed - never lose already-completed work.
    if (createdResults.length > 0) {
      onBatchCreated(createdResults);
    }

    if (mappingEntries.length > 0) {
      try {
        await saveApprovedMappingBatch(mappingEntries);
      } catch (mapErr: any) {
        console.error('Batch mapping save error:', mapErr);
        setErrorMsg(
          (language === 'ar'
            ? 'تم إنشاء/ربط السجلات بنجاح، لكن فشل حفظ سجل الربط لإعادة الاستخدام المستقبلي: '
            : 'Records were created/linked successfully, but saving the mapping history for future reuse failed: ') + (mapErr?.message || '')
        );
      }
    }

    setIsSubmitting(false);

    // Auto-close only when every targeted row genuinely succeeded - a
    // partial save (some failed/still-duplicate rows) keeps the modal open
    // so the operator can see exactly what needs correction, per the
    // explicit-confirmation-for-partial-save requirement.
    if (failedCount === 0) {
      onClose();
    }
  };

  const getDomainIcon = (domain: string) => {
    switch (domain) {
      case 'furnaceCar': return <Flame className="w-4 h-4 text-amber-600" />;
      case 'employee': return <User className="w-4 h-4 text-emerald-600" />;
      case 'press': return <Wrench className="w-4 h-4 text-sky-600" />;
      case 'product': return <Box className="w-4 h-4 text-indigo-600" />;
      case 'customer': return <User className="w-4 h-4 text-purple-600" />;
      case 'shift': return <Layers className="w-4 h-4 text-orange-600" />;
      case 'material': return <Box className="w-4 h-4 text-teal-600" />;
      case 'chineseMill': return <Wrench className="w-4 h-4 text-indigo-600" />;
      case 'faultType': return <AlertTriangle className="w-4 h-4 text-red-600" />;
      default: return <Layers className="w-4 h-4 text-slate-600" />;
    }
  };

  const getDomainLabel = (domain: string) => {
    if (language === 'ar') {
      switch (domain) {
        case 'furnaceCar': return 'عربة فرن';
        case 'employee': return 'موظف / عامل';
        case 'press': return 'مكبس';
        case 'product': return 'صنف';
        case 'customer': return 'عميل';
        case 'shift': return 'وردية';
        case 'material': return 'خامة';
        case 'chineseMill': return 'طاحونة صينية';
        case 'faultType': return 'نوع عطل';
        default: return domain;
      }
    }
    switch (domain) {
      case 'furnaceCar': return 'Furnace Car';
      case 'employee': return 'Employee';
      case 'press': return 'Press';
      case 'product': return 'Product';
      case 'customer': return 'Customer';
      case 'shift': return 'Shift';
      case 'material': return 'Material';
      case 'chineseMill': return 'Chinese Mill';
      case 'faultType': return 'Fault Type';
      default: return domain;
    }
  };

  const statusBadge = (row: RowState) => {
    const map: Record<RowStatus, { ar: string; en: string; cls: string }> = {
      NEW: { ar: 'جديد', en: 'New', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
      ALREADY_EXISTS: { ar: 'موجود مسبقاً', en: 'Already Exists', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
      USE_EXISTING: { ar: 'سيُستخدم الموجود', en: 'Will use existing', cls: 'bg-sky-100 text-sky-800 border-sky-300' },
      SAVING: { ar: 'جارٍ الحفظ...', en: 'Saving...', cls: 'bg-slate-100 text-slate-600 border-slate-300' },
      CREATED: { ar: 'تم', en: 'Done', cls: 'bg-emerald-600 text-white border-emerald-700' },
      FAILED: { ar: 'فشل', en: 'Failed', cls: 'bg-red-100 text-red-800 border-red-300' },
    };
    const s = map[row.status];
    return <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${s.cls}`}>{language === 'ar' ? s.ar : s.en}</span>;
  };

  const title = entityLabelAr && entityLabelEn
    ? (language === 'ar' ? `إضافة جميع البيانات: ${entityLabelAr}` : `Add All Master Data: ${entityLabelEn}`)
    : (language === 'ar' ? 'مراجعة وإضافة البيانات الأساسية المفقودة دفعة واحدة' : 'Review & Add Missing Master Data');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-white/15 rounded-lg backdrop-blur-xs shrink-0">
              <Layers className="w-5 h-5 text-amber-100" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold truncate">{title}</h3>
              <p className="text-xs text-amber-100 font-sans">
                {language === 'ar'
                  ? 'يرجى مراجعة العناصر المفقودة، التعديل عند الحاجة، وتأكيد الإضافة'
                  : 'Review the missing items, edit if needed, then confirm the addition'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-amber-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action / Toolbar (sticky) */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-sans sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => handleSelectAll(true)} className="px-2.5 py-1 bg-white border border-slate-300 rounded font-medium text-slate-700 hover:bg-slate-100 cursor-pointer">
              {language === 'ar' ? 'تحديد الكل' : 'Select All'}
            </button>
            <button type="button" onClick={() => handleSelectAll(false)} className="px-2.5 py-1 bg-white border border-slate-300 rounded font-medium text-slate-700 hover:bg-slate-100 cursor-pointer">
              {language === 'ar' ? 'إلغاء التحديد' : 'Clear All'}
            </button>
          </div>
          <div className="text-slate-600 font-bold">
            {language === 'ar' ? `المحدد: ${selectedCount} من إجمالي ${selectableRows.length}` : `Selected: ${selectedCount} of ${selectableRows.length}`}
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-700 font-sans shrink-0">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Partial Save Summary */}
        {lastSummary && (
          <div className="mx-6 mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs font-sans shrink-0 flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-emerald-700 font-bold">{language === 'ar' ? `تم الإنشاء: ${lastSummary.created}` : `Created: ${lastSummary.created}`}</span>
            <span className="text-sky-700 font-bold">{language === 'ar' ? `تم استخدام موجود: ${lastSummary.usedExisting}` : `Used existing: ${lastSummary.usedExisting}`}</span>
            {lastSummary.failed > 0 && (
              <span className="text-red-700 font-bold">{language === 'ar' ? `فشل/بحاجة مراجعة: ${lastSummary.failed}` : `Failed/needs review: ${lastSummary.failed}`}</span>
            )}
          </div>
        )}

        {/* Items Table */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {rows.map((row, idx) => (
            <div
              key={row.id}
              className={`p-3.5 rounded-xl border transition-all ${
                row.status === 'CREATED' ? 'bg-emerald-50/60 border-emerald-300 opacity-80' :
                row.status === 'FAILED' ? 'bg-red-50/60 border-red-300' :
                row.status === 'ALREADY_EXISTS' ? 'bg-amber-50/60 border-amber-300' :
                row.selected ? 'bg-amber-50/40 border-amber-300 ring-1 ring-amber-300/50' : 'bg-slate-50 border-slate-200 opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={row.selected}
                  onChange={() => handleToggleSelect(row.id)}
                  disabled={row.status === 'CREATED'}
                  className="mt-1 w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer disabled:opacity-40"
                />

                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex items-center justify-between flex-wrap gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] text-slate-400 font-mono">#{idx + 1}</span>
                      <span className="p-1 bg-white rounded border border-slate-200 shadow-2xs">{getDomainIcon(row.domain)}</span>
                      <span className="text-xs font-bold text-slate-800">{getDomainLabel(row.domain)}:</span>
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded font-mono font-bold text-xs" title={language === 'ar' ? 'القيمة المستوردة' : 'Imported value'}>
                        {row.token}
                      </span>
                      {statusBadge(row)}
                    </div>
                  </div>

                  {row.status === 'ALREADY_EXISTS' && row.existingMatch && (
                    <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex flex-wrap items-center gap-2">
                      <span>
                        {language === 'ar' ? 'موجود مسبقاً في قاعدة البيانات باسم: ' : 'Already exists in master data as: '}
                        <span className="font-bold font-mono">{row.existingMatch.name} ({row.existingMatch.code})</span>
                      </span>
                      <button type="button" onClick={() => handleUseExisting(row.id)} className="px-2 py-0.5 bg-sky-600 hover:bg-sky-700 text-white rounded font-bold cursor-pointer">
                        {language === 'ar' ? 'استخدام الموجود' : 'Use Existing'}
                      </button>
                      <button type="button" onClick={() => handleCancelRow(row.id)} className="px-2 py-0.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded font-bold cursor-pointer">
                        {language === 'ar' ? 'إلغاء هذا العنصر' : 'Cancel this item'}
                      </button>
                    </div>
                  )}

                  {row.status === 'FAILED' && row.errorReason && (
                    <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                      {row.errorReason}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[10px] text-slate-500 font-sans mb-0.5">{language === 'ar' ? 'الكود' : 'Code'}</label>
                      <input
                        type="text"
                        value={row.suggestedCode}
                        onChange={(e) => handleFieldChange(row.id, 'suggestedCode', e.target.value)}
                        disabled={!row.selected || row.status === 'CREATED' || row.status === 'SAVING'}
                        className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-amber-500 focus:border-amber-500 bg-white disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 font-sans mb-0.5">{language === 'ar' ? 'الاسم' : 'Name'}</label>
                      <input
                        type="text"
                        value={row.suggestedName}
                        onChange={(e) => handleFieldChange(row.id, 'suggestedName', e.target.value)}
                        disabled={!row.selected || row.status === 'CREATED' || row.status === 'SAVING'}
                        className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-amber-500 focus:border-amber-500 bg-white disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                </div>

                <div className="shrink-0 mt-1">
                  {row.status === 'SAVING' && <Loader2 className="w-4 h-4 animate-spin text-amber-600" />}
                  {row.status === 'CREATED' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-sans">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>{language === 'ar' ? 'تتم الإضافة بشكل منفصل مع حفظ السجل للتدقيق' : 'Separate creation with audit logging'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer">
              {language === 'ar' ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="button"
              onClick={handleConfirmBatchAdd}
              disabled={isSubmitting || selectedCount === 0}
              className="px-5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl shadow-xs flex items-center gap-2 cursor-pointer transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{language === 'ar' ? 'جاري الحفظ...' : 'Saving...'}</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>{language === 'ar' ? `إضافة وحفظ (${selectedCount})` : `Add & Save (${selectedCount})`}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

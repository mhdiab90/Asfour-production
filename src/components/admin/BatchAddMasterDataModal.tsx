/**
 * ASFOUR ERP - Batch Add Missing Master Data Modal
 * 
 * Allows reviewing and confirming multiple missing Master Data tokens (e.g. Furnace Cars, Employees, Presses)
 * before creating them in Firestore.
 * 
 * Strict Safety:
 * - Shows an explicit confirmation and review list for each missing token.
 * - Does NOT create records silently.
 * - Full audit logging and row resolution.
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
  ShieldCheck
} from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { createMasterDataItem } from '../../services/masterDataService';
import { logAuditAction } from '../../services/auditService';
import { saveApprovedMappingBatch } from '../../services/importMappingService';

export interface MissingEntityItem {
  id: string; // unique key in modal list
  domain: 'furnaceCar' | 'employee' | 'press' | 'product';
  token: string;
  suggestedCode: string;
  suggestedName: string;
  collectionName: string;
  selected: boolean;
  extraProps?: Record<string, any>;
}

export interface BatchAddMasterDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: MissingEntityItem[];
  onBatchCreated: (createdItems: Array<{ domain: string; token: string; item: any }>) => void;
}

export const BatchAddMasterDataModal: React.FC<BatchAddMasterDataModalProps> = ({
  isOpen,
  onClose,
  items: initialItems,
  onBatchCreated,
}) => {
  const { language, isRtl } = useLanguage();
  const { adminUser, isSuperAdmin } = useAuth();
  
  const [items, setItems] = useState<MissingEntityItem[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setItems(initialItems.map(item => ({ ...item, selected: true })));
      setErrorMsg(null);
    }
  }, [isOpen, initialItems]);

  if (!isOpen) return null;

  const handleToggleSelect = (id: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, selected: !item.selected } : item));
  };

  const handleSelectAll = (select: boolean) => {
    setItems(prev => prev.map(item => ({ ...item, selected: select })));
  };

  const handleItemChange = (id: string, field: 'suggestedCode' | 'suggestedName', value: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const selectedCount = items.filter(i => i.selected).length;

  const handleConfirmBatchAdd = async () => {
    const selectedItems = items.filter(i => i.selected);
    if (selectedItems.length === 0) {
      setErrorMsg(language === 'ar' ? 'يرجى تحديد عنصر واحد على الأقل للإضافة.' : 'Please select at least one item to add.');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    const createdResults: Array<{ domain: string; token: string; item: any }> = [];
    const mappingEntries: Array<{
      domain: string;
      originalValue: string;
      mappedEntityId: string;
      mappedEntityName: string;
      mappedEntityCode?: string;
      confidence: number;
      matchType: string;
    }> = [];

    try {
      for (const item of selectedItems) {
        let payload: Record<string, any> = {
          code: item.suggestedCode.trim(),
          name: item.suggestedName.trim(),
          active: true,
          ...item.extraProps,
        };

        if (item.domain === 'furnaceCar') {
          payload.carNumber = item.token.trim();
          payload.carNumberNormalized = item.token.trim().toLowerCase();
          payload.carCodeNormalized = item.suggestedCode.trim().toLowerCase();
        }

        const created = await createMasterDataItem(item.collectionName as any, payload);
        createdResults.push({
          domain: item.domain,
          token: item.token,
          item: created,
        });

        mappingEntries.push({
          domain: item.domain === 'furnaceCar' ? 'furnace_car' : item.domain,
          originalValue: item.token,
          mappedEntityId: created.id,
          mappedEntityName: created.name,
          mappedEntityCode: created.code,
          confidence: 100,
          matchType: 'BATCH_INLINE_ADD',
        });

        // Audit log
        await logAuditAction(
          'CREATE',
          item.collectionName,
          created.id,
          `إضافة جماعية لبيان أساسي مفقود أثناء الاستيراد: ${item.suggestedName} (${item.token})`
        );
      }

      // Save approved mappings in memory & Firestore
      if (mappingEntries.length > 0) {
        saveApprovedMappingBatch(mappingEntries).catch(err => console.warn('Batch mappings error:', err));
      }

      onBatchCreated(createdResults);
      onClose();
    } catch (err: any) {
      console.error('Batch add error:', err);
      setErrorMsg((language === 'ar' ? 'حدث خطأ أثناء الإضافة الجماعية: ' : 'Error during batch addition: ') + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getDomainIcon = (domain: string) => {
    switch (domain) {
      case 'furnaceCar':
        return <Flame className="w-4 h-4 text-amber-600" />;
      case 'employee':
        return <User className="w-4 h-4 text-emerald-600" />;
      case 'press':
        return <Wrench className="w-4 h-4 text-sky-600" />;
      case 'product':
        return <Box className="w-4 h-4 text-indigo-600" />;
      default:
        return <Layers className="w-4 h-4 text-slate-600" />;
    }
  };

  const getDomainLabel = (domain: string) => {
    if (language === 'ar') {
      switch (domain) {
        case 'furnaceCar': return 'عربة فرن';
        case 'employee': return 'موظف / عامل';
        case 'press': return 'مكبس';
        case 'product': return 'صنف';
        default: return domain;
      }
    } else {
      switch (domain) {
        case 'furnaceCar': return 'Furnace Car';
        case 'employee': return 'Employee';
        case 'press': return 'Press';
        case 'product': return 'Product';
        default: return domain;
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div 
        dir={isRtl ? 'rtl' : 'ltr'}
        className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-amber-600 to-amber-700 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/15 rounded-lg backdrop-blur-xs">
              <Layers className="w-5 h-5 text-amber-100" />
            </div>
            <div>
              <h3 className="text-base font-bold">
                {language === 'ar' ? 'مراجعة وإضافة البيانات الأساسية المفقودة دفعة واحدة' : 'Review & Add Missing Master Data'}
              </h3>
              <p className="text-xs text-amber-100 font-sans">
                {language === 'ar' 
                  ? 'يرجى مراجعة العناصر المفقودة وتأكيد إضافتها كبيانات أساسية منفصلة' 
                  : 'Review missing independent items and confirm adding them to master data'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-amber-100 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action / Toolbar */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-sans">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSelectAll(true)}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              {language === 'ar' ? 'تحديد الكل' : 'Select All'}
            </button>
            <button
              type="button"
              onClick={() => handleSelectAll(false)}
              className="px-2.5 py-1 bg-white border border-slate-300 rounded font-medium text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              {language === 'ar' ? 'إلغاء التحديد' : 'Deselect All'}
            </button>
          </div>
          <div className="text-slate-600 font-bold">
            {language === 'ar' 
              ? `المحدد: ${selectedCount} من إجمالي ${items.length}` 
              : `Selected: ${selectedCount} of ${items.length}`}
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mx-6 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-700 font-sans">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Items List */}
        <div className="p-6 overflow-y-auto flex-1 space-y-3">
          {items.map((item) => (
            <div 
              key={item.id}
              className={`p-3.5 rounded-xl border transition-all ${
                item.selected 
                  ? 'bg-amber-50/40 border-amber-300 ring-1 ring-amber-300/50' 
                  : 'bg-slate-50 border-slate-200 opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={() => handleToggleSelect(item.id)}
                  className="mt-1 w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                />
                
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="p-1 bg-white rounded border border-slate-200 shadow-2xs">
                        {getDomainIcon(item.domain)}
                      </span>
                      <span className="text-xs font-bold text-slate-800">
                        {getDomainLabel(item.domain)}:
                      </span>
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 rounded font-mono font-bold text-xs">
                        {item.token}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="block text-[10px] text-slate-500 font-sans mb-0.5">
                        {language === 'ar' ? 'الكود المقترح' : 'Suggested Code'}
                      </label>
                      <input
                        type="text"
                        value={item.suggestedCode}
                        onChange={(e) => handleItemChange(item.id, 'suggestedCode', e.target.value)}
                        disabled={!item.selected}
                        className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-amber-500 focus:border-amber-500 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 font-sans mb-0.5">
                        {language === 'ar' ? 'الاسم المقترح' : 'Suggested Name'}
                      </label>
                      <input
                        type="text"
                        value={item.suggestedName}
                        onChange={(e) => handleItemChange(item.id, 'suggestedName', e.target.value)}
                        disabled={!item.selected}
                        className="w-full px-2.5 py-1 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-amber-500 focus:border-amber-500 bg-white"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-sans">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>{language === 'ar' ? 'تتم الإضافة بشكل منفصل مع حفظ السجل للتدقيق' : 'Separate creation with audit logging'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
            >
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
                  <span>{language === 'ar' ? 'جاري الإضافة...' : 'Adding...'}</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>
                    {language === 'ar' 
                      ? `تأكيد وإضافة (${selectedCount}) عناصر` 
                      : `Confirm & Add (${selectedCount}) items`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

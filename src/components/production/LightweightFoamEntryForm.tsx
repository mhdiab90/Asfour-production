/**
 * Stage 7: Lightweight Foam Entry Form (الشاموت الخفيف / عزل الفوم)
 * Fields:
 * - Date, Product Name, Mix, Materials Used, Workers, Production Qty, Operating Hours, Yield %
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Feather, Save, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, FileCheck, Users } from 'lucide-react';
import { SmartEntitySelect, SmartOption } from '../common/SmartEntitySelect';
import { MultiSmartEntitySelect } from '../common/MultiSmartEntitySelect';
import { Material, Employee, Product } from '../../types';
import { fetchMasterData } from '../../services/masterDataService';
import { fetchMaterials } from '../../services/materialService';
import { createStageRecord } from '../../services/stageRecordService';
// Phase 1 Step 5A: optional job / batch / operation references, validated before the existing write.
import { attachProductionReferences } from '../../services/productionReferenceService';
import type { ProductionReferenceSelection } from '../../services/productionReferencePure';
// Phase 1 Step 5B: actual consumption - one shared panel, lines validated before the existing write.
import { ActualConsumptionPanel } from './ActualConsumptionPanel';
import { prepareActualConsumption } from '../../services/actualConsumptionService';
// Phase 1 Step 6: production outputs + input batches (genealogy), validated before the existing write.
import { prepareProductionGenealogy } from '../../services/productionGenealogyService';
import type { ProductionGenealogySelection } from '../../services/productionGenealogyPure';
import type { MaterialConsumptionItem } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { evaluateStageWarnings } from '../../utils/stageValidationEngine';
import { ValidationResult } from '../../utils/businessValidationRules';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { logAuditAction } from '../../services/auditService';

export const LightweightFoamEntryForm: React.FC<{ onSuccess?: () => void; productionReferences?: ProductionReferenceSelection; productionGenealogy?: ProductionGenealogySelection }> = ({ onSuccess, productionReferences, productionGenealogy }) => {
  const { language, isRtl } = useLanguage();
  const { isSuperAdmin, hasPermission } = useAuth();
  const canOverrideWarnings = isSuperAdmin || hasPermission('validation.overrideWarnings');

  const tr = {
    ton: language === 'ar' ? 'طن' : 't',
    savedSuccess: language === 'ar' ? 'تم حفظ سجل الشاموت الخفيف بنجاح.' : 'Lightweight foam record saved successfully.',
    saveFailed: language === 'ar' ? 'فشل الحفظ.' : 'Save failed.',
    stageTitle: language === 'ar' ? 'تسجيل إنتاج: الشاموت الخفيف وعزل الفوم (Lightweight & Foam)' : 'Production Entry: Lightweight Foam',
    stageSubtitle: language === 'ar' ? 'إنتاج الطوب والكتل العازلة للحرارة، مسامية الفوم ونسب الهالك' : 'Heat-insulating brick & block production, foam porosity, and waste rates',
    stage7: language === 'ar' ? 'المرحلة 7' : 'Stage 7',
    operationDate: language === 'ar' ? 'تاريخ التشغيل' : 'Operation Date',
    linkedProduct: language === 'ar' ? 'ربط بمنتج من البيانات الأساسية (اختياري)' : 'Link to a Master Data Product (optional)',
    searchProductPlaceholder: language === 'ar' ? 'ابحث لتعبئة اسم وكود الصنف تلقائيًا...' : 'Search to auto-fill the product name/code...',
    insulatingProductName: language === 'ar' ? 'اسم الصنف العازل' : 'Insulating Product Name',
    productCode: language === 'ar' ? 'كود الصنف' : 'Product Code',
    producedQuantity: language === 'ar' ? 'الكمية المنتجة (طن)' : 'Produced Quantity (t)',
    wasteQuantity: language === 'ar' ? 'الهالك (طن)' : 'Waste (t)',
    homogeneityEfficiency: language === 'ar' ? 'نسبة التجانس والكفاءة' : 'Homogeneity & Efficiency Rate',
    mixMaterials: (n: number) => language === 'ar' ? `الخامات المستخدمة (${n})` : `Materials Used (${n})`,
    addMaterial: language === 'ar' ? 'إضافة خامة' : 'Add Material',
    workersSectionTitle: (n: number) => language === 'ar' ? `العمالة (${n})` : `Workers (${n})`,
    addWorkersLabel: language === 'ar' ? 'إضافة العمالة:' : 'Add workers:',
    notesLabel: language === 'ar' ? 'ملاحظات' : 'Notes',
    saveDraft: language === 'ar' ? 'حفظ كمسودة' : 'Save as Draft',
    approveAndSave: language === 'ar' ? 'اعتماد وتسجيل الإنتاج' : 'Approve & Save Production',
    saving: language === 'ar' ? 'جاري الحفظ...' : 'Saving...',
    warningsTitle: (n: number) => language === 'ar' ? `⚠️ ${n > 1 ? 'تحذيرات' : 'تحذير'}` : `⚠️ ${n > 1 ? 'Warnings' : 'Warning'}`,
    stillValidNote: language === 'ar' ? 'السجل يبقى صالحًا من الناحية الفنية ويمكن حفظه كما هو دون أي تعديل على القيم المدخلة.' : 'The record remains technically valid and can be saved as-is without altering any entered values.',
    noOverridePermission: language === 'ar' ? 'لا تملك صلاحية "حفظ رغم التحذير" - يمكنك تعديل البيانات فقط.' : 'You do not have "Save Despite Warning" permission - you may only edit the data.',
    editData: language === 'ar' ? 'تعديل البيانات' : 'Edit Data',
    saveDespiteWarning: language === 'ar' ? 'حفظ رغم التحذير' : 'Save Despite Warning',
  };

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [linkedProductId, setLinkedProductId] = useState<string | null>(null);
  const [productName, setProductName] = useState('');
  const [productCode, setProductCode] = useState('');
  const [batchNumber, setBatchNumber] = useState(`FOAM-${Date.now().toString().slice(-4)}`);
  const [productionQuantity, setProductionQuantity] = useState<number>(0);
  const [wasteQuantity, setWasteQuantity] = useState<number>(0);
  const [operatingHours, setOperatingHours] = useState<number>(0);
  const [notes, setNotes] = useState('');

  const [materialsList, setMaterialsList] = useState<MaterialConsumptionItem[]>([]);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<ValidationResult[]>([]);

  useEffect(() => {
    Promise.all([
      fetchMaterials(),
      fetchMasterData<Product>('products'),
      fetchMasterData<Employee>('employees'),
    ]).then(([mats, prods, emps]) => {
      setMaterials(mats);
      setProducts(prods);
      setEmployees(emps);
    }).catch(console.error);
  }, []);

  const productOptions: SmartOption[] = useMemo(() => products.map(p => ({ id: p.id || '', code: p.code || p.productCode || '', name: p.name || '' })), [products]);
  const employeeOptions: SmartOption[] = useMemo(() => employees.map(e => ({ id: e.id || '', code: e.code, name: e.name, subtitle: e.department })), [employees]);

  const yieldPercentage = productionQuantity > 0 ? Number((((productionQuantity - wasteQuantity) / productionQuantity) * 100).toFixed(1)) : 100;

  const handleAddMaterial = () => {
    if (materials.length === 0) return;
    const first = materials[0];
    setMaterialsList(prev => [...prev, {
      materialId: first.id || '',
      materialCode: first.code,
      materialName: first.name,
      quantity: 0,
      unit: first.unit || tr.ton,
    }]);
  };

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setLinkedProductId(null);
    setProductName('');
    setProductCode('');
    setBatchNumber(`FOAM-${Date.now().toString().slice(-4)}`);
    setProductionQuantity(0);
    setWasteQuantity(0);
    setOperatingHours(0);
    setNotes('');
    setMaterialsList([]);
    setSelectedWorkerIds([]);
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    if (status === 'SUBMITTED') {
      const warnings = evaluateStageWarnings('lightweight_foam', { production: productionQuantity, waste: wasteQuantity }, language);
      if (warnings.length > 0) {
        setPendingWarnings(warnings);
        return;
      }
    }
    await performSave(status, []);
  };

  const performSave = async (status: 'SUBMITTED' | 'DRAFT', overriddenWarnings: ValidationResult[]) => {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      const selectedWorkers = employees.filter((e) => selectedWorkerIds.includes(e.id || ''));
      // Actual consumption is validated and normalised BEFORE the existing write; invalid lines throw and nothing is written.
      const genealogy = await prepareProductionGenealogy(materialsList, productionGenealogy?.outputs ?? [], productionReferences, language);
      const consumptionLines = await prepareActualConsumption(materialsList, language);
      // References are validated and merged BEFORE the existing write; an invalid traced selection throws and nothing is written.
      const newRecordId = await createStageRecord('lightweight_foam', await attachProductionReferences('lightweight_foam', {
        date,
        productName,
        productCode,
        linkedProductId: linkedProductId || undefined,
        batchNumber,
        productionQuantity,
        wasteQuantity,
        yieldPercentage,
        operatingHours,
        materials: consumptionLines,
        ...genealogy,
        workers: selectedWorkers.map((e) => ({ employeeId: e.id || '', employeeCode: e.code, employeeName: e.name })),
        notes,
      }, productionReferences, language), status);

      if (overriddenWarnings.length > 0) {
        logAuditAction(
          'UPDATE',
          'stage_lightweight_foam',
          newRecordId,
          `[OVERRIDE_WARNING] recordId=${newRecordId} warningCodes=${overriddenWarnings.map((w) => w.code).join(',')} override=true - ${overriddenWarnings.map((w) => w.message).join(' | ')}`
        ).catch(() => {});
      }

      setFeedback({ type: 'success', message: tr.savedSuccess });
      resetForm();
      setPendingWarnings([]);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || tr.saveFailed });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => handleSubmit(e, 'SUBMITTED')} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-7 space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
            <Feather className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{tr.stageTitle}</h2>
            <p className="text-xs text-slate-500">{tr.stageSubtitle}</p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-teal-100 text-teal-800 rounded-lg">{tr.stage7}</span>
      </div>

      {feedback && (
        <div className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 ${feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.operationDate} *</label>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500/20 outline-none" />
        </div>
        <SmartEntitySelect
          id="lwf-linked-product-select"
          label={tr.linkedProduct}
          entityType="product"
          options={productOptions}
          value={linkedProductId}
          onChange={(id, opt) => {
            setLinkedProductId(id);
            if (opt) {
              setProductName(opt.name);
              setProductCode(opt.code);
            }
          }}
          placeholder={tr.searchProductPlaceholder}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.insulatingProductName} *</label>
          <input type="text" required value={productName} onChange={(e) => setProductName(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.productCode}</label>
          <input type="text" value={productCode} onChange={(e) => setProductCode(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-mono" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-teal-50/40 p-4 rounded-xl border border-teal-200">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">{tr.producedQuantity}</label>
          <input type="number" step="0.1" value={productionQuantity || ''} onChange={(e) => setProductionQuantity(Number(e.target.value) || 0)} placeholder="0" className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl font-bold" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">{tr.wasteQuantity}</label>
          <input type="number" step="0.01" value={wasteQuantity || ''} onChange={(e) => setWasteQuantity(Number(e.target.value) || 0)} placeholder="0" className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl font-bold text-red-600" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">{tr.homogeneityEfficiency}</label>
          <div className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl font-bold text-teal-700">{yieldPercentage}%</div>
        </div>
      </div>

      {/* Actual Material Consumption (Phase 1 Step 5B) - the shared panel, editing this form's own materials lines */}
      <ActualConsumptionPanel lines={materialsList} onChange={setMaterialsList} jobReferenceId={productionReferences?.jobReferenceId} />

      {/* Workers - previously hardcoded to workers: [] with no UI at all */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase">
          <Users className="w-4 h-4 text-teal-600" />
          {tr.workersSectionTitle(selectedWorkerIds.length)}
        </h3>
        <MultiSmartEntitySelect
          id="lwf-workers-select"
          label={tr.addWorkersLabel}
          entityType="employee"
          options={employeeOptions}
          selectedIds={selectedWorkerIds}
          onChange={setSelectedWorkerIds}
          language={language}
        />
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.notesLabel}</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500/20 outline-none" />
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" disabled={isSubmitting} onClick={(e) => handleSubmit(e, 'DRAFT')} className="px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
          {tr.saveDraft}
        </button>
        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-md transition-all cursor-pointer">
          {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" />{tr.saving}</> : <><Save className="w-4 h-4" />{tr.approveAndSave}</>}
        </button>
      </div>

      {pendingWarnings.length > 0 && (
        <Modal isOpen onClose={() => setPendingWarnings([])} title={tr.warningsTitle(pendingWarnings.length)} maxWidth="md">
          <div className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
              <ul className="list-disc pr-5 text-sm font-bold text-amber-900 space-y-1">
                {pendingWarnings.map((w, idx) => <li key={idx}>{w.message}</li>)}
              </ul>
              <p className="text-[11px] text-amber-700 mt-2">{tr.stillValidNote}</p>
            </div>
            {!canOverrideWarnings && <p className="text-[11px] text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">{tr.noOverridePermission}</p>}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setPendingWarnings([])} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{tr.editData}</button>
              <button type="button" disabled={!canOverrideWarnings || isSubmitting} onClick={() => performSave('SUBMITTED', pendingWarnings)} className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer">
                {tr.saveDespiteWarning}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </form>
  );
};

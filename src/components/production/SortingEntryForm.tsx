/**
 * Stage 8: Sorting & Inspection Entry Form (الفرز والمراقبة وتصنيف العيوب)
 * Highly detailed quality control screen capturing piece counts, tonnages,
 * and comprehensive defect taxonomy (شطف، شروخ، بقع حديد، شوائب، حريق فرن، مرتجع).
 */
import React, { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, Save, AlertCircle, AlertTriangle, Loader2, FileCheck, Layers, Scale } from 'lucide-react';
import { SmartEntitySelect, SmartOption } from '../common/SmartEntitySelect';
import { Product, Customer } from '../../types';
import { fetchMasterData } from '../../services/masterDataService';
import { createStageRecord } from '../../services/stageRecordService';
// Phase 1 Step 5A: optional job / batch / operation references, validated before the existing write.
import { attachProductionReferences } from '../../services/productionReferenceService';
import type { ProductionReferenceSelection } from '../../services/productionReferencePure';
// Phase 1 Step 6: inputs (actual consumption from the entry screen) and outputs, validated before the existing write.
import { prepareActualConsumption } from '../../services/actualConsumptionService';
// Phase 1 Step 6: production outputs + input batches (genealogy), validated before the existing write.
import { prepareProductionGenealogy } from '../../services/productionGenealogyService';
// Phase 1 Step 8C-5: the packing sub-activity, validated before the existing write.
import { preparePackagingActivity } from '../../services/packagingActivityService';
import type { ProductionGenealogySelection } from '../../services/productionGenealogyPure';
import { useLanguage } from '../../i18n/LanguageContext';
import { evaluateStageWarnings } from '../../utils/stageValidationEngine';
import { ValidationResult } from '../../utils/businessValidationRules';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { logAuditAction } from '../../services/auditService';

export const SortingEntryForm: React.FC<{ onSuccess?: () => void; productionReferences?: ProductionReferenceSelection; productionGenealogy?: ProductionGenealogySelection }> = ({ onSuccess, productionReferences, productionGenealogy }) => {
  const { language, isRtl } = useLanguage();
  const { isSuperAdmin, hasPermission } = useAuth();
  const canOverrideWarnings = isSuperAdmin || hasPermission('validation.overrideWarnings');

  const tr = {
    selectSortedProduct: language === 'ar' ? 'يرجى اختيار المنتج المفروز.' : 'Please select the sorted product.',
    savedSuccess: language === 'ar' ? 'تم حفظ سجل الفرز والمراقبة وتصنيف العيوب بنجاح.' : 'Sorting, inspection & defect classification record saved successfully.',
    saveFailed: language === 'ar' ? 'فشل الحفظ.' : 'Save failed.',
    stageTitle: language === 'ar' ? 'تسجيل إنتاج: الفرز والمراقبة وتصنيف العيوب (Sorting & Inspection)' : 'Production Entry: Sorting & Inspection',
    stageSubtitle: language === 'ar' ? 'مراقبة جودة المنتج بعد الحرق، تفريغ الأفران، وتحليل تفصيلي لأسباب المعيب' : 'Post-firing product quality monitoring, kiln discharge, and detailed defect-cause analysis',
    stage8: language === 'ar' ? 'المرحلة 8' : 'Stage 8',
    sortingDate: language === 'ar' ? 'تاريخ الفرز' : 'Sorting Date',
    dischargeDate: language === 'ar' ? 'تاريخ خروج الفرن (Discharge)' : 'Kiln Discharge Date',
    poNumber: language === 'ar' ? 'رقم أمر العميل (PO #)' : 'Customer Order Number (PO #)',
    truckNumber: language === 'ar' ? 'رقم السيارة / التريلا' : 'Truck / Trailer Number',
    sortedProduct: language === 'ar' ? 'المنتج المفروز' : 'Sorted Product',
    searchSortedProduct: language === 'ar' ? 'ابحث عن المنتج المفروز...' : 'Search for the sorted product...',
    customerLabel: language === 'ar' ? 'العميل' : 'Customer',
    searchCustomerPlaceholder: language === 'ar' ? 'ابحث عن العميل...' : 'Search for the customer...',
    pieceWeight: language === 'ar' ? 'وزن القطعة (كجم)' : 'Piece Weight (kg)',
    ratioCode: language === 'ar' ? 'كود النسبة / الفئة' : 'Ratio / Category Code',
    quantitiesSectionTitle: language === 'ar' ? 'كميات الفرز والأوزان' : 'Sorting Quantities & Weights',
    totalSortedCount: language === 'ar' ? 'إجمالي العدد المفروز (قطعة)' : 'Total Sorted Count (pcs)',
    weightLabel: language === 'ar' ? 'الوزن' : 'Weight',
    ton: language === 'ar' ? 'طن' : 't',
    netGoodCount: language === 'ar' ? 'العدد الصالح النظيف (قطعة)' : 'Net Good Count (pcs)',
    totalBrokenCount: language === 'ar' ? 'إجمالي القطع المعيبة / الكسر' : 'Total Broken / Defective Pieces',
    defectTaxonomyTitle: language === 'ar' ? 'التصنيف الدقيق للعيوب والهالك (Defect Taxonomy)' : 'Detailed Defect & Waste Classification',
    defectSum: language === 'ar' ? 'مجموع العيوب:' : 'Defect Total:',
    reconcileWarning: (sum: number, broken: number) => language === 'ar' ? `تنبيه: مجموع تفاصيل العيوب (${sum}) لا يطابق إجمالي القطع المعيبة (${broken}). يرجى المراجعة.` : `Warning: the sum of defect details (${sum}) does not match the total broken pieces (${broken}). Please review.`,
    defectShiver: language === 'ar' ? 'شطف (Shiver)' : 'Shiver',
    defectCrack: language === 'ar' ? 'شروخ (Crack)' : 'Crack',
    defectIron: language === 'ar' ? 'بقع حديد (Iron)' : 'Iron Spots',
    defectContamination: language === 'ar' ? 'شوائب (Inclusions)' : 'Inclusions',
    defectKiln: language === 'ar' ? 'حريق فرن (Kiln)' : 'Kiln Burn',
    defectReturn: language === 'ar' ? 'مرتجع (Return)' : 'Return',
    returnTypeLabel: language === 'ar' ? 'نوع المرتجع' : 'Return Type',
    notesLabel: language === 'ar' ? 'ملاحظات' : 'Notes',
    saveDraft: language === 'ar' ? 'حفظ كمسودة' : 'Save as Draft',
    approveAndSave: language === 'ar' ? 'اعتماد وتسجيل الفرز' : 'Approve & Save Sorting',
    aluminaPct: (v: number) => language === 'ar' ? `${v}% ألومينا` : `${v}% Alumina`,
    warningsTitle: (n: number) => language === 'ar' ? `⚠️ ${n > 1 ? 'تحذيرات' : 'تحذير'}` : `⚠️ ${n > 1 ? 'Warnings' : 'Warning'}`,
    stillValidNote: language === 'ar' ? 'السجل يبقى صالحًا من الناحية الفنية ويمكن حفظه كما هو دون أي تعديل على القيم المدخلة.' : 'The record remains technically valid and can be saved as-is without altering any entered values.',
    noOverridePermission: language === 'ar' ? 'لا تملك صلاحية "حفظ رغم التحذير" - يمكنك تعديل البيانات فقط.' : 'You do not have "Save Despite Warning" permission - you may only edit the data.',
    editData: language === 'ar' ? 'تعديل البيانات' : 'Edit Data',
    saveDespiteWarning: language === 'ar' ? 'حفظ رغم التحذير' : 'Save Despite Warning',
    defectSumMismatchCode: 'DEFECT_SUM_MISMATCH',
  };

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dischargeDate, setDischargeDate] = useState(new Date().toISOString().split('T')[0]);
  const [customerOrderNumber, setCustomerOrderNumber] = useState('');
  const [truckNumber, setTruckNumber] = useState('');

  const [productId, setProductId] = useState<string | null>(null);
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [pieceWeight, setPieceWeight] = useState<number>(0); // kg
  const [ratioCode, setRatioCode] = useState('');

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerCode, setCustomerCode] = useState('');
  const [customerName, setCustomerName] = useState('');

  // Primary Counts
  const [totalCount, setTotalCount] = useState<number>(0);
  const [brokenCount, setBrokenCount] = useState<number>(0);

  // Defect breakdown categories
  const [shiverDefectCount, setShiverDefectCount] = useState<number>(0);       // شطف
  const [crackDefectCount, setCrackDefectCount] = useState<number>(0);         // شروخ
  const [ironDefectCount, setIronDefectCount] = useState<number>(0);          // بقع حديد
  const [contaminationDefectCount, setContaminationDefectCount] = useState<number>(0); // شوائب
  const [kilnDefectCount, setKilnDefectCount] = useState<number>(0);          // حريق فرن
  const [returnDefectCount, setReturnDefectCount] = useState<number>(0);      // مرتجع
  const [returnType, setReturnType] = useState('');
  const [notes, setNotes] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<ValidationResult[]>([]);

  useEffect(() => {
    Promise.all([
      fetchMasterData<Product>('products'),
      fetchMasterData<Customer>('customers'),
    ]).then(([prods, custs]) => {
      setProducts(prods);
      setCustomers(custs);
    }).catch(console.error);
  }, []);

  const productOptions: SmartOption[] = useMemo(() => {
    return products.map(p => ({
      id: p.id || '',
      code: p.code || p.productCode || '',
      name: p.name || '',
      subtitle: tr.aluminaPct(p.aluminaPercentage || 40),
      rawItem: p,
    }));
  }, [products, tr]);

  const customerOptions: SmartOption[] = useMemo(() => {
    return customers.map(c => ({
      id: c.id || '',
      code: c.code,
      name: c.name,
      subtitle: c.city || '',
    }));
  }, [customers]);

  // Derived Calculations
  const goodCount = Math.max(0, totalCount - brokenCount);
  const totalTons = Number(((totalCount * pieceWeight) / 1000).toFixed(2));
  const goodTons = Number(((goodCount * pieceWeight) / 1000).toFixed(2));
  const brokenTons = Number(((brokenCount * pieceWeight) / 1000).toFixed(2));
  const returnTons = Number(((returnDefectCount * pieceWeight) / 1000).toFixed(2));

  const goodPercentage = totalCount > 0 ? Number(((goodCount / totalCount) * 100).toFixed(1)) : 0;
  const brokenPercentage = totalCount > 0 ? Number(((brokenCount / totalCount) * 100).toFixed(1)) : 0;

  // Consistency Check
  const sumOfDefects = shiverDefectCount + crackDefectCount + ironDefectCount + contaminationDefectCount + kilnDefectCount + returnDefectCount;
  const isDefectSumReconciled = sumOfDefects === brokenCount;

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setDischargeDate(new Date().toISOString().split('T')[0]);
    setCustomerOrderNumber('');
    setTruckNumber('');
    setProductId(null);
    setProductCode('');
    setProductName('');
    setPieceWeight(0);
    setRatioCode('');
    setCustomerId(null);
    setCustomerCode('');
    setCustomerName('');
    setTotalCount(0);
    setBrokenCount(0);
    setShiverDefectCount(0);
    setCrackDefectCount(0);
    setIronDefectCount(0);
    setContaminationDefectCount(0);
    setKilnDefectCount(0);
    setReturnDefectCount(0);
    setReturnType('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    if (!productId) {
      setFeedback({ type: 'error', message: tr.selectSortedProduct });
      return;
    }

    if (status === 'SUBMITTED') {
      const warnings = evaluateStageWarnings('sorting', { production: totalCount, waste: brokenCount }, language);
      // The defect-taxonomy sum vs. total-broken reconciliation is specific to
      // this stage's own field structure (no other stage has this breakdown),
      // so it is appended here rather than invented inside the shared engine.
      if (!isDefectSumReconciled) {
        warnings.push({
          severity: 'WARNING',
          code: tr.defectSumMismatchCode,
          message: tr.reconcileWarning(sumOfDefects, brokenCount),
          canOverride: true,
        });
      }
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
      // Inputs and outputs are validated and normalised BEFORE the existing write; invalid lines throw and nothing is written.
      const genealogyInputs = productionGenealogy?.inputs ?? [];
      const genealogy = await prepareProductionGenealogy(genealogyInputs, productionGenealogy?.outputs ?? [], productionReferences, language);
      const consumptionLines = await prepareActualConsumption(genealogyInputs, language);
      // References are validated and merged BEFORE the existing write; an invalid traced selection throws and nothing is written.
      const newRecordId = await createStageRecord('sorting', await attachProductionReferences('sorting', {
        date,
        ...(consumptionLines.length ? { materials: consumptionLines } : {}),
        ...genealogy,
        ...(await preparePackagingActivity('sorting', productionGenealogy?.packaging, language)),
        dischargeDate,
        customerOrderNumber,
        truckNumber,
        customerId,
        customerCode,
        customerName,
        productId,
        productCode,
        productName,
        pieceWeight,
        ratioCode,
        totalCount,
        totalTons,
        goodCount,
        goodTons,
        brokenCount,
        brokenTons,
        shiverDefectCount,
        crackDefectCount,
        ironDefectCount,
        contaminationDefectCount,
        kilnDefectCount,
        returnDefectCount,
        returnTons,
        returnType,
        goodPercentage,
        brokenPercentage,
        notes,
      }, productionReferences, language), status);

      if (overriddenWarnings.length > 0) {
        logAuditAction(
          'UPDATE',
          'stage_sorting',
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
          <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {tr.stageTitle}
            </h2>
            <p className="text-xs text-slate-500">
              {tr.stageSubtitle}
            </p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-rose-100 text-rose-800 rounded-lg">
          {tr.stage8}
        </span>
      </div>

      {feedback && (
        <div className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 ${
          feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Date & Logistics Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.sortingDate} <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500/20 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.dischargeDate}
          </label>
          <input
            type="date"
            value={dischargeDate}
            onChange={(e) => setDischargeDate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.poNumber}
          </label>
          <input
            type="text"
            value={customerOrderNumber}
            onChange={(e) => setCustomerOrderNumber(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.truckNumber}
          </label>
          <input
            type="text"
            value={truckNumber}
            onChange={(e) => setTruckNumber(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl"
          />
        </div>
      </div>

      {/* Product & Customer Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SmartEntitySelect
          id="sorting-product-select"
          label={tr.sortedProduct}
          entityType="product"
          required
          options={productOptions}
          value={productId}
          onChange={(id, opt) => {
            setProductId(id);
            setProductCode(opt?.code || '');
            setProductName(opt?.name || '');
            if (opt?.rawItem?.pieceWeight) {
              setPieceWeight(opt.rawItem.pieceWeight);
            }
          }}
          placeholder={tr.searchSortedProduct}
        />

        {/*
          `customerOptions` was already computed from fetched Customer master
          data, but no Customer field was ever rendered - customerId/Code/Name
          could never actually be set by a user despite being sent to
          createStageRecord on every save.
        */}
        <SmartEntitySelect
          id="sorting-customer-select"
          label={tr.customerLabel}
          entityType="customer"
          options={customerOptions}
          value={customerId}
          onChange={(id, opt) => {
            setCustomerId(id);
            setCustomerCode(opt?.code || '');
            setCustomerName(opt?.name || '');
          }}
          placeholder={tr.searchCustomerPlaceholder}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              {tr.pieceWeight}
            </label>
            <input
              type="number"
              step="0.01"
              value={pieceWeight || ''}
              onChange={(e) => setPieceWeight(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              {tr.ratioCode}
            </label>
            <input
              type="text"
              value={ratioCode}
              onChange={(e) => setRatioCode(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-mono"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.returnTypeLabel}
          </label>
          <input
            type="text"
            value={returnType}
            onChange={(e) => setReturnType(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl"
          />
        </div>
      </div>

      {/* Primary Production & Sorting Quantities */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
        <h3 className="text-xs font-bold text-slate-800 uppercase flex items-center gap-1.5">
          <Scale className="w-4 h-4 text-slate-600" />
          {tr.quantitiesSectionTitle}
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 text-center">
            <label className="block text-xs font-bold text-slate-600 mb-1">{tr.totalSortedCount}</label>
            <input
              type="number"
              value={totalCount || ''}
              onChange={(e) => setTotalCount(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full text-center text-lg font-black text-slate-900 border border-slate-300 rounded-lg py-1"
            />
            <span className="text-xs font-bold text-slate-500 block mt-1.5">{tr.weightLabel}: {totalTons} {tr.ton}</span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-emerald-200 text-center">
            <label className="block text-xs font-bold text-emerald-700 mb-1">{tr.netGoodCount}</label>
            <div className="text-xl font-black text-emerald-600 py-1">{goodCount.toLocaleString()}</div>
            <span className="text-xs font-bold text-emerald-700 block mt-1.5">
              {goodTons} {tr.ton} ({goodPercentage}%)
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-red-200 text-center">
            <label className="block text-xs font-bold text-red-700 mb-1">{tr.totalBrokenCount}</label>
            <input
              type="number"
              value={brokenCount || ''}
              onChange={(e) => setBrokenCount(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full text-center text-lg font-black text-red-600 border border-red-300 rounded-lg py-1"
            />
            <span className="text-xs font-bold text-red-600 block mt-1.5">
              {brokenTons} {tr.ton} ({brokenPercentage}%)
            </span>
          </div>
        </div>
      </div>

      {/* Comprehensive Defect Taxonomy Breakdown */}
      <div className="bg-rose-50/40 p-4 rounded-xl border border-rose-200 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-rose-950 uppercase flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-rose-600" />
            {tr.defectTaxonomyTitle}
          </h3>
          <div className="flex items-center gap-1 text-xs font-bold">
            <span className="text-slate-600">{tr.defectSum}</span>
            <span className={`font-mono px-2 py-0.5 rounded ${
              isDefectSumReconciled ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}>
              {sumOfDefects} / {brokenCount}
            </span>
          </div>
        </div>

        {!isDefectSumReconciled && (
          <div className="p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>{tr.reconcileWarning(sumOfDefects, brokenCount)}</span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">{tr.defectShiver}</label>
            <input
              type="number"
              value={shiverDefectCount || ''}
              onChange={(e) => setShiverDefectCount(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">{tr.defectCrack}</label>
            <input
              type="number"
              value={crackDefectCount || ''}
              onChange={(e) => setCrackDefectCount(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">{tr.defectIron}</label>
            <input
              type="number"
              value={ironDefectCount || ''}
              onChange={(e) => setIronDefectCount(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">{tr.defectContamination}</label>
            <input
              type="number"
              value={contaminationDefectCount || ''}
              onChange={(e) => setContaminationDefectCount(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">{tr.defectKiln}</label>
            <input
              type="number"
              value={kilnDefectCount || ''}
              onChange={(e) => setKilnDefectCount(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">{tr.defectReturn}</label>
            <input
              type="number"
              value={returnDefectCount || ''}
              onChange={(e) => setReturnDefectCount(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.notesLabel}</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-rose-500/20 outline-none" />
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={(e) => handleSubmit(e, 'DRAFT')}
          className="px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
        >
          {tr.saveDraft}
        </button>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {tr.approveAndSave}
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

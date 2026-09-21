/**
 * Stage 3: Chinese Mills Entry Form (الطواحين الصينية)
 * Fields:
 * - Date, Customer (SmartEntitySelect), Specification Code
 * - Mill Type, Shift, Quantity, Number of Bags (شكائر)
 * - Rejected Quantity (توالف), Operating Days & Operating Hours
 * - Downtime Hours & Fault Type
 * - Auto-calculations: Theoretical Rate, Actual Rate, Efficiency %
 */
import React, { useState, useEffect, useMemo } from 'react';
import { RotateCw, Save, CheckCircle2, AlertCircle, Loader2, FileCheck } from 'lucide-react';
import { SmartEntitySelect, SmartOption } from '../common/SmartEntitySelect';
import { Customer, Shift } from '../../types';
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

export const ChineseMillsEntryForm: React.FC<{ onSuccess?: () => void; productionReferences?: ProductionReferenceSelection; productionGenealogy?: ProductionGenealogySelection }> = ({ onSuccess, productionReferences, productionGenealogy }) => {
  const { language, isRtl } = useLanguage();
  const { isSuperAdmin, hasPermission } = useAuth();
  const canOverrideWarnings = isSuperAdmin || hasPermission('validation.overrideWarnings');

  const tr = {
    approvedCustomer: language === 'ar' ? 'عميل معتمد' : 'Approved Customer',
    savedSuccess: language === 'ar' ? 'تم حفظ سجل الطواحين الصينية بنجاح.' : 'Chinese Mills record saved successfully.',
    saveFailed: language === 'ar' ? 'فشل الحفظ.' : 'Save failed.',
    stageTitle: language === 'ar' ? 'تسجيل إنتاج: الطواحين الصينية (Chinese Mills)' : 'Production Entry: Chinese Mills',
    stageSubtitle: language === 'ar' ? 'تسجيل طحن الخامات الحرارية، أكياس التعبئة، ومعدلات الأداء' : 'Recording refractory material grinding, packaging bags, and performance rates',
    stage3: language === 'ar' ? 'المرحلة 3' : 'Stage 3',
    operationDate: language === 'ar' ? 'تاريخ التشغيل' : 'Operation Date',
    chineseMillType: language === 'ar' ? 'نوع الطاحونة الصينية' : 'Chinese Mill Type',
    millTypePlaceholder: language === 'ar' ? 'مثال: طاحونة صينية 1' : 'e.g. Chinese Mill #1',
    specCode: language === 'ar' ? 'كود المواصفة / النعومة' : 'Specification / Fineness Code',
    specPlaceholder: language === 'ar' ? 'مثال: MESH-200' : 'e.g. MESH-200',
    shift: language === 'ar' ? 'الوردية' : 'Shift',
    searchShiftPlaceholder: language === 'ar' ? 'ابحث بكود أو اسم الوردية...' : 'Search by shift code or name...',
    requestingCustomer: language === 'ar' ? 'العميل الطالب' : 'Requesting Customer',
    searchCustomerPlaceholder: language === 'ar' ? 'ابحث بكود أو اسم العميل...' : 'Search by customer code or name...',
    totalProduction: language === 'ar' ? 'الإنتاج الكلي (طن)' : 'Total Production (t)',
    numberOfBags: language === 'ar' ? 'عدد الشكائر المعبأة' : 'Number of Bags Packed',
    rejectedQuantity: language === 'ar' ? 'الهالك / المرفوض (طن)' : 'Rejected / Waste (t)',
    actualOperatingHours: language === 'ar' ? 'ساعات التشغيل الفعلي' : 'Actual Operating Hours',
    downtimeHours: language === 'ar' ? 'ساعات التوقف' : 'Downtime Hours',
    actualRate: language === 'ar' ? 'معدل الإنتاج الفعلي' : 'Actual Production Rate',
    tonPerHour: language === 'ar' ? 'طن/س' : 't/hr',
    efficiencyRate: language === 'ar' ? 'نسبة الكفاءة التشغيلية' : 'Operating Efficiency Rate',
    saveDraft: language === 'ar' ? 'حفظ كمسودة' : 'Save as Draft',
    approveAndSave: language === 'ar' ? 'اعتماد وتسجيل الإنتاج' : 'Approve & Save Production',
    saving: language === 'ar' ? 'جاري الحفظ...' : 'Saving...',
    faultReasonLabel: language === 'ar' ? 'سبب التوقف أو العطل' : 'Downtime or Fault Reason',
    faultReasonPlaceholder: language === 'ar' ? 'صيانة دورية / تغيير غربال...' : 'Routine maintenance / screen change...',
    notesLabel: language === 'ar' ? 'ملاحظات' : 'Notes',
    warningsTitle: (n: number) => language === 'ar' ? `⚠️ ${n > 1 ? 'تحذيرات' : 'تحذير'}` : `⚠️ ${n > 1 ? 'Warnings' : 'Warning'}`,
    stillValidNote: language === 'ar' ? 'السجل يبقى صالحًا من الناحية الفنية ويمكن حفظه كما هو دون أي تعديل على القيم المدخلة.' : 'The record remains technically valid and can be saved as-is without altering any entered values.',
    noOverridePermission: language === 'ar' ? 'لا تملك صلاحية "حفظ رغم التحذير" - يمكنك تعديل البيانات فقط.' : 'You do not have "Save Despite Warning" permission - you may only edit the data.',
    editData: language === 'ar' ? 'تعديل البيانات' : 'Edit Data',
    saveDespiteWarning: language === 'ar' ? 'حفظ رغم التحذير' : 'Save Despite Warning',
  };

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerCode, setCustomerCode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [specificationCode, setSpecificationCode] = useState('');
  const [millType, setMillType] = useState('');
  /** Phase 1 Step 8C: the mill from the existing Chinese Mills master; the free-text type above is kept. */
  const [millId, setMillId] = useState('');
  const [millOptions, setMillOptions] = useState<any[]>([]);
  // Part 5: shiftType is a real ChineseMillsRecord field, previously stored
  // as unconstrained free text - now a genuine Shift Master Data selection
  // (shiftId) like every other stage that has a shift concept, so shift
  // 1/2/3 are recognized the same way everywhere, never a false error.
  const [shiftId, setShiftId] = useState('');
  const [quantity, setQuantity] = useState<number>(0);
  const [numberOfBags, setNumberOfBags] = useState<number>(0);
  const [rejectedQuantity, setRejectedQuantity] = useState<number>(0);
  const [operatingDays, setOperatingDays] = useState<number>(0);
  const [operatingHours, setOperatingHours] = useState<number>(0);
  const [downtimeHours, setDowntimeHours] = useState<number>(0);
  const [faultType, setFaultType] = useState('');
  const [notes, setNotes] = useState('');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<ValidationResult[]>([]);

  useEffect(() => {
    Promise.all([
      fetchMasterData<Customer>('customers'),
      fetchMasterData<Shift>('shifts'),
      fetchMasterData<any>('chineseMills').catch(() => []),
    ]).then(([custs, shs, mills]) => {
      setCustomers(custs);
      setShifts(shs);
      setMillOptions((mills ?? []).filter((m: any) => m.active !== false));
    }).catch(console.error);
  }, []);

  const customerOptions: SmartOption[] = useMemo(() => {
    return customers.map(c => ({
      id: c.id || '',
      code: c.code,
      name: c.name,
      subtitle: c.city || tr.approvedCustomer,
    }));
  }, [customers, tr.approvedCustomer]);

  // Calculations
  const totalOperatingTime = Number((operatingHours + downtimeHours).toFixed(2));
  const actualRatePerHour = operatingHours > 0 ? Number((quantity / operatingHours).toFixed(2)) : 0;
  const theoreticalRate = 2.0; // 2 tons per hour baseline
  const efficiencyPercentage = operatingHours > 0 ? Number(((actualRatePerHour / theoreticalRate) * 100).toFixed(1)) : 0;

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setCustomerId(null);
    setCustomerCode('');
    setCustomerName('');
    setSpecificationCode('');
    setMillType('');
    setShiftId('');
    setQuantity(0);
    setNumberOfBags(0);
    setRejectedQuantity(0);
    setOperatingDays(0);
    setOperatingHours(0);
    setDowntimeHours(0);
    setFaultType('');
    setNotes('');
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    if (status === 'SUBMITTED') {
      const warnings = evaluateStageWarnings(
        'chinese_mills',
        { production: quantity, waste: rejectedQuantity, downtimeMinutes: downtimeHours * 60, shiftHours: operatingHours },
        language
      );
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
      const shift = shifts.find((s) => s.id === shiftId);
      // Inputs and outputs are validated and normalised BEFORE the existing write; invalid lines throw and nothing is written.
      const genealogyInputs = productionGenealogy?.inputs ?? [];
      const genealogy = await prepareProductionGenealogy(genealogyInputs, productionGenealogy?.outputs ?? [], productionReferences, language);
      const consumptionLines = await prepareActualConsumption(genealogyInputs, language);
      // References are validated and merged BEFORE the existing write; an invalid traced selection throws and nothing is written.
      const newRecordId = await createStageRecord('chinese_mills', await attachProductionReferences('chinese_mills', {
        date,
        ...(consumptionLines.length ? { materials: consumptionLines } : {}),
        ...genealogy,
        ...(await preparePackagingActivity('chinese_mills', productionGenealogy?.packaging, language)),
        customerId,
        customerCode,
        customerName,
        specificationCode,
        millType,
        // Step 8C: the equipment master id, beside the free text it never replaces.
        ...(millId ? { millId } : {}),
        shiftId,
        shiftType: shift?.name || '',
        quantity,
        numberOfBags,
        rejectedQuantity,
        operatingDays,
        operatingHours,
        totalOperatingTimeHours: totalOperatingTime,
        downtimeHours,
        faultType,
        theoreticalRatePerHour: theoreticalRate,
        actualRatePerHour,
        efficiencyPercentage,
        notes,
      }, productionReferences, language), status);

      if (overriddenWarnings.length > 0) {
        logAuditAction(
          'UPDATE',
          'stage_chinese_mills',
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
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <RotateCw className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{tr.stageTitle}</h2>
            <p className="text-xs text-slate-500">{tr.stageSubtitle}</p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-amber-100 text-amber-800 rounded-lg">{tr.stage3}</span>
      </div>

      {feedback && (
        <div className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 ${feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.operationDate} <span className="text-red-500">*</span></label>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.chineseMillType}</label>
          {/* Step 8C: the machine itself, from the existing master - the free text below stays for historical wording */}
          <select value={millId} onChange={(e) => setMillId(e.target.value)} className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl mb-1.5">
            <option value="">{language === 'ar' ? '- اختر الطاحونة من البيانات الأساسية -' : '- select the mill from Master Data -'}</option>
            {millOptions.map((m: any) => <option key={m.id} value={m.id}>{[m.code, m.name].filter(Boolean).join(' - ')}</option>)}
          </select>
          <input type="text" value={millType} onChange={(e) => setMillType(e.target.value)} placeholder={tr.millTypePlaceholder} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.specCode}</label>
          <input type="text" value={specificationCode} onChange={(e) => setSpecificationCode(e.target.value)} placeholder={tr.specPlaceholder} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-mono" />
        </div>

        <SmartEntitySelect
          id="cm-shift-select"
          label={tr.shift}
          entityType="shift"
          options={shifts.map((s) => ({ id: s.id || '', code: s.code || '', name: s.name }))}
          value={shiftId}
          onChange={(id) => setShiftId(id || '')}
          placeholder={tr.searchShiftPlaceholder}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SmartEntitySelect
          id="cm-customer-select"
          label={tr.requestingCustomer}
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

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.totalProduction}</label>
            <input type="number" step="0.1" value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value) || 0)} placeholder="0" className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold text-slate-900" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.numberOfBags}</label>
            <input type="number" value={numberOfBags || ''} onChange={(e) => setNumberOfBags(Number(e.target.value) || 0)} placeholder="0" className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold text-slate-900" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.rejectedQuantity}</label>
            <input type="number" step="0.1" value={rejectedQuantity || ''} onChange={(e) => setRejectedQuantity(Number(e.target.value) || 0)} placeholder="0" className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold text-rose-600" />
          </div>
        </div>
      </div>

      {/* Operating KPIs and Calculations */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div>
          <span className="text-[11px] text-slate-500 font-bold block">{tr.actualOperatingHours}</span>
          <input type="number" step="0.5" value={operatingHours || ''} onChange={(e) => setOperatingHours(Number(e.target.value) || 0)} placeholder="0" className="w-20 mx-auto text-center font-bold text-sm bg-white border border-slate-300 rounded-lg py-1 mt-1" />
        </div>
        <div>
          <span className="text-[11px] text-slate-500 font-bold block">{tr.downtimeHours}</span>
          <input type="number" step="0.1" value={downtimeHours || ''} onChange={(e) => setDowntimeHours(Number(e.target.value) || 0)} placeholder="0" className="w-20 mx-auto text-center font-bold text-sm bg-white border border-slate-300 rounded-lg py-1 mt-1" />
        </div>
        <div>
          <span className="text-[11px] text-slate-500 font-bold block">{tr.actualRate}</span>
          <span className="text-base font-black text-amber-700 block mt-1.5">{actualRatePerHour} {tr.tonPerHour}</span>
        </div>
        <div>
          <span className="text-[11px] text-slate-500 font-bold block">{tr.efficiencyRate}</span>
          <span className="text-base font-black text-emerald-600 block mt-1.5">{efficiencyPercentage}%</span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.faultReasonLabel}</label>
          <input type="text" value={faultType} onChange={(e) => setFaultType(e.target.value)} placeholder={tr.faultReasonPlaceholder} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">{tr.notesLabel}</label>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none" />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" disabled={isSubmitting} onClick={(e) => handleSubmit(e, 'DRAFT')} className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
          <FileCheck className="w-4 h-4 text-slate-500" />
          {tr.saveDraft}
        </button>

        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer">
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

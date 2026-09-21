/**
 * Stage 2: Rotary Furnace Production Entry Form (الفرن الدوار)
 * Fields:
 * - Date, Operation Period, Batch Number
 * - Product manufactured (SmartEntitySelect), Operating Hours
 * - Consumption mode (Batch total vs Per Ton)
 * - Gas Consumption (m3), Electricity (kWh), auto-calculated per-ton metrics
 * - Raw Materials used (Multiple items with material, quantity, unit)
 * - Production workers & Maintenance workers (Smart multiselect / list)
 * - Production Quantity (tons), Waste Quantity, Good Quantity
 * - Downtime & Fault type
 * - Save as Draft / Submit with instant feedback
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Flame,
  Save,
  Plus,
  Trash2,
  Zap,
  Clock,
  Users,
  Package,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FileCheck
} from 'lucide-react';
import { SmartEntitySelect, SmartOption } from '../common/SmartEntitySelect';
import { MultiSmartEntitySelect } from '../common/MultiSmartEntitySelect';
import { Material, Employee, Product, Shift } from '../../types';
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
// Phase 1 Step 8C-5: the packing sub-activity, validated before the existing write.
import { preparePackagingActivity } from '../../services/packagingActivityService';
import type { ProductionGenealogySelection } from '../../services/productionGenealogyPure';
import type { MaterialConsumptionItem } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { evaluateStageWarnings } from '../../utils/stageValidationEngine';
import { ValidationResult } from '../../utils/businessValidationRules';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { logAuditAction } from '../../services/auditService';

interface RotaryFurnaceEntryFormProps {
  onSuccess?: () => void;
  productionReferences?: ProductionReferenceSelection;
  productionGenealogy?: ProductionGenealogySelection;
}

export const RotaryFurnaceEntryForm: React.FC<RotaryFurnaceEntryFormProps> = ({ onSuccess, productionReferences, productionGenealogy }) => {
  const { language, isRtl } = useLanguage();
  const { isSuperAdmin, hasPermission } = useAuth();
  const canOverrideWarnings = isSuperAdmin || hasPermission('validation.overrideWarnings');

  const tr = {
    morningPeriod: language === 'ar' ? 'صباحي (08:00 - 16:00)' : 'Morning (08:00 - 16:00)',
    stageTitle: language === 'ar' ? 'تسجيل إنتاج: الفرن الدوار (Rotary Furnace)' : 'Production Entry: Rotary Furnace',
    stageSubtitle: language === 'ar' ? 'تسجيل خلطات التكليس، استهلاك الطاقة (الغاز والكهرباء)، والخامات المستخدمة' : 'Recording calcination batches, energy consumption (gas & electricity), and materials used',
    stage2: language === 'ar' ? 'المرحلة 2' : 'Stage 2',
    selectProductFirst: language === 'ar' ? 'يرجى اختيار المنتج المصنع أولاً.' : 'Please select the manufactured product first.',
    savedSuccess: (draft: boolean) => language === 'ar' ? `تم حفظ سجل إنتاج الفرن الدوار بنجاح (${draft ? 'مسودة' : 'معتمد للنظام'}).` : `Rotary furnace production record saved successfully (${draft ? 'draft' : 'approved'}).`,
    saveError: language === 'ar' ? 'حدث خطأ أثناء الحفظ.' : 'An error occurred while saving.',
    mainShift: language === 'ar' ? 'وردية صباحية' : 'Morning Shift',
    operationDate: language === 'ar' ? 'تاريخ التشغيل' : 'Operation Date',
    batchNumber: language === 'ar' ? 'رقم الدفعة (Batch No)' : 'Batch Number',
    operationPeriodShift: language === 'ar' ? 'فترة التشغيل / الوردية' : 'Operation Period / Shift',
    periodPlaceholder: language === 'ar' ? 'صباحي / مسائي' : 'Morning / Evening',
    operatingHours: language === 'ar' ? 'ساعات التشغيل' : 'Operating Hours',
    productMade: language === 'ar' ? 'المنتج المصنع بالفرن' : 'Product Made in the Furnace',
    searchProductPlaceholder: language === 'ar' ? 'ابحث بكود أو اسم المنتج الحراري...' : 'Search by thermal product code or name...',
    totalProduction: language === 'ar' ? 'إجمالي الإنتاج' : 'Total Production',
    netGood: language === 'ar' ? 'الصالح النظيف' : 'Net Good',
    wasteRate: language === 'ar' ? 'نسبة الهالك' : 'Waste Rate',
    ton: language === 'ar' ? 'طن' : 't',
    energySectionTitle: language === 'ar' ? 'استهلاك الطاقة والوقود (معدلات الحرق)' : 'Energy & Fuel Consumption (Firing Rates)',
    totalBatch: language === 'ar' ? 'إجمالي الدفعة' : 'Total Batch',
    ratePerTon: language === 'ar' ? 'معدل لكل طن' : 'Rate per Ton',
    gasConsumptionLabel: language === 'ar' ? 'استهلاك الغاز الطبيعي (م³)' : 'Natural Gas Consumption (m³)',
    gasPerTonLabel: language === 'ar' ? 'معدل الغاز لكل طن (م³/طن)' : 'Gas Rate per Ton (m³/t)',
    electricityConsumptionLabel: language === 'ar' ? 'استهلاك الكهرباء (kWh)' : 'Electricity Consumption (kWh)',
    electricityPerTonLabel: language === 'ar' ? 'معدل الكهرباء لكل طن (kWh/طن)' : 'Electricity Rate per Ton (kWh/t)',
    materialsSectionTitle: (n: number) => language === 'ar' ? `الخامات الأولية المستخدمة بالخلطة (${n})` : `Raw Materials Used in the Batch (${n})`,
    addMaterial: language === 'ar' ? 'إضافة مادة خام' : 'Add Raw Material',
    noMaterialsYet: language === 'ar' ? 'لم يتم إضافة خامات أولية بعد. اضغط على "إضافة مادة خام" لتسجيل استهلاك الخامات.' : 'No raw materials added yet. Click "Add Raw Material" to record material consumption.',
    quantityPlaceholder: language === 'ar' ? 'الكمية' : 'Quantity',
    workersSectionTitle: (n: number) => language === 'ar' ? `عمالة التشغيل والصيانة (${n})` : `Operating & Maintenance Workers (${n})`,
    addWorker: language === 'ar' ? 'إضافة عامل' : 'Add Worker',
    noWorkersYet: language === 'ar' ? 'لم يتم ربط عمالة بهذا السجل بعد.' : 'No workers linked to this record yet.',
    downtimeLabel: language === 'ar' ? 'زمن التوقفات / الأعطال (دقيقة)' : 'Downtime / Fault Duration (minutes)',
    faultReasonLabel: language === 'ar' ? 'سبب التوقف أو العطل' : 'Downtime or Fault Reason',
    faultReasonPlaceholder: language === 'ar' ? 'صيانة دورية / انقطاع كهرباء / تغيير شعلة...' : 'Routine maintenance / power outage / burner change...',
    saveDraft: language === 'ar' ? 'حفظ كمسودة' : 'Save as Draft',
    saving: language === 'ar' ? 'جاري الحفظ...' : 'Saving...',
    approveAndSave: language === 'ar' ? 'اعتماد وتسجيل الإنتاج' : 'Approve & Save Production',
    aluminaPct: (v: number) => language === 'ar' ? `${v}% ألومينا` : `${v}% Alumina`,
    unitLabel: language === 'ar' ? 'الوحدة' : 'Unit',
    productionDept: language === 'ar' ? 'الإنتاج' : 'Production',
    tonUnit: language === 'ar' ? 'طن' : 't',
    shiftLabel: language === 'ar' ? 'الوردية' : 'Shift',
    searchShiftPlaceholder: language === 'ar' ? 'ابحث بكود أو اسم الوردية...' : 'Search by shift code or name...',
    addWorkersLabel: language === 'ar' ? 'إضافة عمالة التشغيل:' : 'Add operating workers:',
    warningsTitle: (n: number) => language === 'ar' ? `⚠️ ${n > 1 ? 'تحذيرات' : 'تحذير'}` : `⚠️ ${n > 1 ? 'Warnings' : 'Warning'}`,
    stillValidNote: language === 'ar' ? 'السجل يبقى صالحًا من الناحية الفنية ويمكن حفظه كما هو دون أي تعديل على القيم المدخلة.' : 'The record remains technically valid and can be saved as-is without altering any entered values.',
    noOverridePermission: language === 'ar' ? 'لا تملك صلاحية "حفظ رغم التحذير" - يمكنك تعديل البيانات فقط.' : 'You do not have "Save Despite Warning" permission - you may only edit the data.',
    editData: language === 'ar' ? 'تعديل البيانات' : 'Edit Data',
    saveDespiteWarning: language === 'ar' ? 'حفظ رغم التحذير' : 'Save Despite Warning',
  };

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [operationPeriod, setOperationPeriod] = useState(tr.morningPeriod);
  const [batchNumber, setBatchNumber] = useState(`BATCH-${Date.now().toString().slice(-4)}`);

  const [productId, setProductId] = useState<string | null>(null);
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [operatingHours, setOperatingHours] = useState(8);

  const [consumptionMode, setConsumptionMode] = useState<'batch' | 'per_ton'>('batch');
  // Part 3 §1 "New Record Must Start Empty" - these previously defaulted to
  // hardcoded demo-looking values (450/320/25/1.2) rather than a clean
  // empty state; fixed to start at 0 like every other numeric field here.
  /** Phase 1 Step 8C: the kiln from the existing Rotary Kilns master. */
  const [rotaryKilnId, setRotaryKilnId] = useState('');
  const [kilnOptions, setKilnOptions] = useState<any[]>([]);
  const [gasConsumption, setGasConsumption] = useState<number>(0);
  const [electricityConsumption, setElectricityConsumption] = useState<number>(0);

  const [productionQuantity, setProductionQuantity] = useState<number>(0);
  const [wasteQuantity, setWasteQuantity] = useState<number>(0);
  const [downtimeMinutes, setDowntimeMinutes] = useState<number>(0);
  const [faultType, setFaultType] = useState('');
  const [notes, setNotes] = useState('');

  // Materials & Workers
  const [materialsList, setMaterialsList] = useState<MaterialConsumptionItem[]>([]);
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);

  // Master Data
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftId, setShiftId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<ValidationResult[]>([]);

  useEffect(() => {
    Promise.all([
      fetchMasterData<Product>('products'),
      fetchMaterials(),
      fetchMasterData<Employee>('employees'),
      fetchMasterData<Shift>('shifts'),
      fetchMasterData<any>('rotaryKilns').catch(() => []),
    ]).then(([prods, mats, emps, shs, kilns]) => {
      setProducts(prods);
      setMaterials(mats);
      setEmployees(emps);
      setShifts(shs);
      setKilnOptions((kilns ?? []).filter((k: any) => k.active !== false));
      // Part 3 §1: no silent auto-selection of the first Shift - the user
      // must explicitly choose it, same as every other stage's Shift field.
    }).catch(console.error);
  }, []);

  const productOptions: SmartOption[] = useMemo(() => {
    return products.map(p => ({
      id: p.id || '',
      code: p.code || p.productCode || '',
      name: p.name || '',
      subtitle: tr.aluminaPct(p.aluminaPercentage || 40),
    }));
  }, [products, tr]);

  const materialOptions: SmartOption[] = useMemo(() => {
    return materials.map(m => ({
      id: m.id || '',
      code: m.code,
      name: m.name,
      subtitle: `${tr.unitLabel}: ${m.unit}`,
      unit: m.unit,
    }));
  }, [materials, tr]);

  const employeeOptions: SmartOption[] = useMemo(() => {
    return employees.map(e => ({
      id: e.id || '',
      code: e.code,
      name: e.name,
      subtitle: e.department || tr.productionDept,
    }));
  }, [employees, tr]);

  // Derived Calculations
  const goodQuantity = Math.max(0, Number((productionQuantity - wasteQuantity).toFixed(2)));
  const wastePercentage = productionQuantity > 0 ? Number(((wasteQuantity / productionQuantity) * 100).toFixed(2)) : 0;
  const gasPerTon = productionQuantity > 0 ? Number((gasConsumption / productionQuantity).toFixed(2)) : 0;
  const electricityPerTon = productionQuantity > 0 ? Number((electricityConsumption / productionQuantity).toFixed(2)) : 0;

  const handleAddMaterialRow = () => {
    if (materials.length === 0) return;
    const first = materials[0];
    setMaterialsList(prev => [
      ...prev,
      {
        materialId: first.id || '',
        materialCode: first.code,
        materialName: first.name,
        quantity: 5,
        unit: first.unit || tr.tonUnit,
      }
    ]);
  };

  const handleRemoveMaterialRow = (index: number) => {
    setMaterialsList(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    if (!productId) {
      setFeedback({ type: 'error', message: tr.selectProductFirst });
      return;
    }

    // Shared warning engine (Part 9 §24-26) - technically-valid-but-unusual
    // values (waste > production, high waste %, high downtime relative to
    // shift hours) become an explicit WARNING the user can save past, never
    // a silent BLOCKING failure and never an auto-"fixed" value.
    if (status === 'SUBMITTED') {
      const warnings = evaluateStageWarnings(
        'rotary_furnace',
        { production: productionQuantity, waste: wasteQuantity, downtimeMinutes, shiftHours: operatingHours },
        language
      );
      if (warnings.length > 0) {
        setPendingWarnings(warnings);
        return;
      }
    }

    await performSave(status, []);
  };

  const resetForm = () => {
    setDate(new Date().toISOString().split('T')[0]);
    setOperationPeriod(tr.morningPeriod);
    setBatchNumber(`BATCH-${Date.now().toString().slice(-4)}`);
    setProductId(null);
    setProductCode('');
    setProductName('');
    setOperatingHours(8);
    setConsumptionMode('batch');
    setGasConsumption(0);
    setElectricityConsumption(0);
    setProductionQuantity(0);
    setWasteQuantity(0);
    setDowntimeMinutes(0);
    setFaultType('');
    setNotes('');
    setMaterialsList([]);
    setSelectedWorkerIds([]);
    setShiftId('');
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
      const newRecordId = await createStageRecord('rotary_furnace', await attachProductionReferences('rotary_furnace', {
        date,
        operationPeriod,
        batchNumber,
        productId,
        productCode,
        productName,
        productOperatingHours: operatingHours,
        consumptionMode,
        // Step 8C: the kiln that produced this record (equipment master id).
        ...(rotaryKilnId ? { rotaryKilnId } : {}),
        gasConsumption,
        electricityConsumption,
        gasPerTon,
        electricityPerTon,
        materials: consumptionLines,
        ...genealogy,
        ...(await preparePackagingActivity('rotary_furnace', productionGenealogy?.packaging, language)),
        productionWorkers: selectedWorkers.map((e) => ({ employeeId: e.id || '', employeeCode: e.code, employeeName: e.name, role: 'production' as const })),
        maintenanceWorkers: [],
        productionQuantity,
        wasteQuantity,
        goodQuantity,
        wastePercentage,
        downtimeMinutes,
        faultType,
        shiftId: shiftId || '',
        shiftName: shifts.find(s => s.id === shiftId)?.name || '',
        notes,
      }, productionReferences, language), status);

      if (overriddenWarnings.length > 0) {
        logAuditAction(
          'UPDATE',
          'stage_rotary_furnace',
          newRecordId,
          `[OVERRIDE_WARNING] recordId=${newRecordId} warningCodes=${overriddenWarnings.map((w) => w.code).join(',')} override=true - ${overriddenWarnings.map((w) => w.message).join(' | ')}`
        ).catch(() => {});
      }

      setFeedback({
        type: 'success',
        message: tr.savedSuccess(status === 'DRAFT'),
      });

      resetForm();
      setPendingWarnings([]);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || tr.saveError });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => handleSubmit(e, 'SUBMITTED')} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-7 space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Stage Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
            <Flame className="w-6 h-6" />
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
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-red-100 text-red-800 rounded-lg">
          {tr.stage2}
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

      {/* Grid: Basic Batch Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.operationDate} <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.batchNumber}
          </label>
          <input
            type="text"
            value={batchNumber}
            onChange={(e) => setBatchNumber(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none font-mono font-bold"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.operationPeriodShift}
          </label>
          <input
            type="text"
            value={operationPeriod}
            onChange={(e) => setOperationPeriod(e.target.value)}
            placeholder={tr.periodPlaceholder}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.operatingHours}
          </label>
          <input
            type="number"
            step="0.5"
            value={operatingHours}
            onChange={(e) => setOperatingHours(Number(e.target.value))}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
          />
        </div>

        {/* Real Shift picker (Part 5) - RotaryFurnaceRecord already declares shiftId/shiftName; this replaces the previous silent shifts[0] default with an explicit selection, and supports Shift 1/2/3 via the same shared Shift master data every other stage uses. */}
        <SmartEntitySelect
          id="rf-shift-select"
          label={tr.shiftLabel}
          entityType="shift"
          options={shifts.map((s) => ({ id: s.id || '', code: s.code || '', name: s.name }))}
          value={shiftId}
          onChange={(id) => setShiftId(id || '')}
          placeholder={tr.searchShiftPlaceholder}
        />
      </div>

      {/* Product Selection with Inline Add */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <SmartEntitySelect
          id="rf-product-select"
          label={tr.productMade}
          entityType="product"
          required
          options={productOptions}
          value={productId}
          onChange={(id, opt) => {
            setProductId(id);
            setProductCode(opt?.code || '');
            setProductName(opt?.name || '');
          }}
          placeholder={tr.searchProductPlaceholder}
        />

        <div className="flex items-center gap-4 pt-4 sm:pt-6">
          <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 text-center">
            <span className="text-[11px] text-slate-500 font-bold block">{tr.totalProduction}</span>
            <span className="text-base font-black text-slate-900">{productionQuantity} {tr.ton}</span>
          </div>
          <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 text-center">
            <span className="text-[11px] text-slate-500 font-bold block">{tr.netGood}</span>
            <span className="text-base font-black text-emerald-600">{goodQuantity} {tr.ton}</span>
          </div>
          <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 text-center">
            <span className="text-[11px] text-slate-500 font-bold block">{tr.wasteRate}</span>
            <span className="text-base font-black text-red-600">{wastePercentage}%</span>
          </div>
        </div>
      </div>

      {/* Energy & Fuel Consumption */}
      <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-amber-900 flex items-center gap-1.5 uppercase">
            <Zap className="w-4 h-4 text-amber-600" />
            {tr.energySectionTitle}
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConsumptionMode('batch')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                consumptionMode === 'batch' ? 'bg-amber-600 text-white' : 'bg-white text-slate-700 border border-slate-300'
              }`}
            >
              {tr.totalBatch}
            </button>
            <button
              type="button"
              onClick={() => setConsumptionMode('per_ton')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                consumptionMode === 'per_ton' ? 'bg-amber-600 text-white' : 'bg-white text-slate-700 border border-slate-300'
              }`}
            >
              {tr.ratePerTon}
            </button>
          </div>
        </div>

        {/* Step 8C: which kiln produced this record, from the existing Rotary Kilns master */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {language === 'ar' ? 'الفرن الدوار' : 'Rotary kiln'}
            </label>
            <select id="rotary-kiln-select" value={rotaryKilnId} onChange={(e) => setRotaryKilnId(e.target.value)} className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl">
              <option value="">{language === 'ar' ? '- اختر الفرن من البيانات الأساسية -' : '- select the kiln from Master Data -'}</option>
              {kilnOptions.map((k: any) => <option key={k.id} value={k.id}>{[k.code, k.name].filter(Boolean).join(' - ')}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tr.gasConsumptionLabel}
            </label>
            <input
              type="number"
              step="0.1"
              value={gasConsumption}
              onChange={(e) => setGasConsumption(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tr.gasPerTonLabel}
            </label>
            <div className="w-full px-3 py-2 text-sm bg-slate-100 border border-slate-300 rounded-xl font-bold font-mono text-slate-800">
              {gasPerTon} {language === 'ar' ? 'م³/طن' : 'm³/t'}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tr.electricityConsumptionLabel}
            </label>
            <input
              type="number"
              step="0.1"
              value={electricityConsumption}
              onChange={(e) => setElectricityConsumption(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tr.electricityPerTonLabel}
            </label>
            <div className="w-full px-3 py-2 text-sm bg-slate-100 border border-slate-300 rounded-xl font-bold font-mono text-slate-800">
              {electricityPerTon} {language === 'ar' ? 'kWh/طن' : 'kWh/t'}
            </div>
          </div>
        </div>
      </div>

      {/* Actual Material Consumption (Phase 1 Step 5B) - the shared panel, editing this form's own materials lines */}
      <ActualConsumptionPanel lines={materialsList} onChange={setMaterialsList} jobReferenceId={productionReferences?.jobReferenceId} />

      {/* Production Workers - real multi-select with chips (Part 3 §4), fixes the previous bug where "Add Worker" always added employees[0] regardless of search */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase">
          <Users className="w-4 h-4 text-emerald-600" />
          {tr.workersSectionTitle(selectedWorkerIds.length)}
        </h3>
        <MultiSmartEntitySelect
          id="rf-workers-select"
          label={tr.addWorkersLabel}
          entityType="employee"
          options={employeeOptions}
          selectedIds={selectedWorkerIds}
          onChange={setSelectedWorkerIds}
          language={language}
        />
      </div>

      {/* Downtime & Notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.downtimeLabel}
          </label>
          <input
            type="number"
            value={downtimeMinutes}
            onChange={(e) => setDowntimeMinutes(Number(e.target.value))}
            placeholder="0"
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            {tr.faultReasonLabel}
          </label>
          <input
            type="text"
            value={faultType}
            onChange={(e) => setFaultType(e.target.value)}
            placeholder={tr.faultReasonPlaceholder}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={(e) => handleSubmit(e, 'DRAFT')}
          className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
        >
          <FileCheck className="w-4 h-4 text-slate-500" />
          {tr.saveDraft}
        </button>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {tr.saving}
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              {tr.approveAndSave}
            </>
          )}
        </button>
      </div>

      {/* Business Warning - Edit Data vs Save Despite Warning (Part 9 §26) */}
      {pendingWarnings.length > 0 && (
        <Modal isOpen onClose={() => setPendingWarnings([])} title={tr.warningsTitle(pendingWarnings.length)} maxWidth="md">
          <div className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
            <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
              <ul className="list-disc pr-5 text-sm font-bold text-amber-900 space-y-1">
                {pendingWarnings.map((w, idx) => <li key={idx}>{w.message}</li>)}
              </ul>
              <p className="text-[11px] text-amber-700 mt-2">{tr.stillValidNote}</p>
            </div>
            {!canOverrideWarnings && (
              <p className="text-[11px] text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">{tr.noOverridePermission}</p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setPendingWarnings([])} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{tr.editData}</button>
              <button
                type="button"
                disabled={!canOverrideWarnings || isSubmitting}
                onClick={() => performSave('SUBMITTED', pendingWarnings)}
                className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg cursor-pointer"
              >
                {tr.saveDespiteWarning}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </form>
  );
};

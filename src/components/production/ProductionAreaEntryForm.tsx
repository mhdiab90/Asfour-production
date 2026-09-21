/**
 * Stages 9-11: Thermal Concrete, Tunnel Kiln, Hand-made Brick - Phase 1 Step 8C-5.
 *
 * ONE form for the three remaining production areas, configured per stage -
 * the same pattern as the Mortar & Concrete form (product, quantity, actual
 * consumption panel, workers, notes, draft / submit, warning override) with
 * only each stage's own fields added:
 *   thermal_concrete  customer, batch, MO and customer request number; tons
 *   tunnel_kiln       batch, MO, source reference, kiln (Furnaces master) and
 *                     fired cars (Furnace Cars master); tons fired, waste
 *   handmade_brick    batch, MO; pieces, optional piece weight, waste
 * The record is written by the existing createStageRecord after the shared
 * reference (5A), consumption (5B), genealogy (6) and - for thermal concrete -
 * packing (8C-5) checks, plus the stage's own rules (productionAreaPure).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Layers3, Save, CheckCircle2, AlertCircle, Loader2, FileCheck, Users } from 'lucide-react';
import { SmartEntitySelect, SmartOption } from '../common/SmartEntitySelect';
import { MultiSmartEntitySelect } from '../common/MultiSmartEntitySelect';
import type { Customer, Employee, Furnace, FurnaceCar, MaterialConsumptionItem, Product } from '../../types';
import { fetchMasterData } from '../../services/masterDataService';
import { createStageRecord } from '../../services/stageRecordService';
import { attachProductionReferences } from '../../services/productionReferenceService';
import type { ProductionReferenceSelection } from '../../services/productionReferencePure';
import { ActualConsumptionPanel } from './ActualConsumptionPanel';
import { prepareActualConsumption } from '../../services/actualConsumptionService';
import { prepareProductionGenealogy } from '../../services/productionGenealogyService';
import type { ProductionGenealogySelection } from '../../services/productionGenealogyPure';
import { preparePackagingActivity } from '../../services/packagingActivityService';
import { PRODUCTION_AREA_FIELDS, validateProductionAreaRecord } from '../../services/productionAreaPure';
import type { ProductionAreaStage } from '../../services/productionAreaPure';
import { STAGE_COLLECTION_NAMES } from '../../services/stageQueryBoundsPure';
import { useLanguage } from '../../i18n/LanguageContext';
import { evaluateStageWarnings } from '../../utils/stageValidationEngine';
import type { ValidationResult } from '../../utils/businessValidationRules';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { logAuditAction } from '../../services/auditService';

interface Props {
  stage: ProductionAreaStage;
  onSuccess?: () => void;
  productionReferences?: ProductionReferenceSelection;
  productionGenealogy?: ProductionGenealogySelection;
}

const TITLES: Record<ProductionAreaStage, { ar: string; en: string; badgeAr: string; badgeEn: string; batchPrefix: string }> = {
  thermal_concrete: { ar: 'تسجيل إنتاج: الخرسانة الحرارية', en: 'Production Entry: Thermal Concrete', badgeAr: 'المرحلة 9', badgeEn: 'Stage 9', batchPrefix: 'TC' },
  tunnel_kiln: { ar: 'تسجيل إنتاج: الفرن النفقي', en: 'Production Entry: Tunnel Kiln', badgeAr: 'المرحلة 10', badgeEn: 'Stage 10', batchPrefix: 'TK' },
  handmade_brick: { ar: 'تسجيل إنتاج: الطوب اليدوي', en: 'Production Entry: Hand-made Brick', badgeAr: 'المرحلة 11', badgeEn: 'Stage 11', batchPrefix: 'HB' },
};

const today = () => new Date().toISOString().split('T')[0];
const num = (v: string) => (v.trim() === '' ? 0 : Number(v) || 0);

export const ProductionAreaEntryForm: React.FC<Props> = ({ stage, onSuccess, productionReferences, productionGenealogy }) => {
  const { language, isRtl } = useLanguage();
  const isAr = language === 'ar';
  const { isSuperAdmin, hasPermission } = useAuth();
  const canOverrideWarnings = isSuperAdmin || hasPermission('validation.overrideWarnings');
  const spec = PRODUCTION_AREA_FIELDS[stage];
  const title = TITLES[stage];
  const unit = spec.productionUnit;

  const [date, setDate] = useState(today());
  const [product, setProduct] = useState<{ id: string | null; code: string; name: string }>({ id: null, code: '', name: '' });
  const [customer, setCustomer] = useState<{ id: string | null; code: string; name: string }>({ id: null, code: '', name: '' });
  const [batchNumber, setBatchNumber] = useState('');
  const [manufacturingOrderNumber, setManufacturingOrderNumber] = useState('');
  const [customerRequestNumber, setCustomerRequestNumber] = useState('');
  const [sourceDocumentReference, setSourceDocumentReference] = useState('');
  const [productionQuantity, setProductionQuantity] = useState(0);
  const [wasteQuantity, setWasteQuantity] = useState(0);
  const [pieceWeightKg, setPieceWeightKg] = useState(0);
  const [operatingHours, setOperatingHours] = useState(0);
  const [furnace, setFurnace] = useState<{ id: string | null; code: string; name: string }>({ id: null, code: '', name: '' });
  const [carIds, setCarIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [materialsList, setMaterialsList] = useState<MaterialConsumptionItem[]>([]);
  const [workerIds, setWorkerIds] = useState<string[]>([]);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [furnaces, setFurnaces] = useState<Furnace[]>([]);
  const [cars, setCars] = useState<FurnaceCar[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingWarnings, setPendingWarnings] = useState<ValidationResult[]>([]);

  const reset = () => {
    setDate(today());
    setProduct({ id: null, code: '', name: '' });
    setCustomer({ id: null, code: '', name: '' });
    setBatchNumber('');
    setManufacturingOrderNumber('');
    setCustomerRequestNumber('');
    setSourceDocumentReference('');
    setProductionQuantity(0);
    setWasteQuantity(0);
    setPieceWeightKg(0);
    setOperatingHours(0);
    setFurnace({ id: null, code: '', name: '' });
    setCarIds([]);
    setNotes('');
    setMaterialsList([]);
    setWorkerIds([]);
  };

  // A different stage is a different record: nothing carries over.
  useEffect(() => {
    reset();
    setFeedback(null);
  }, [stage]);

  useEffect(() => {
    Promise.all([
      fetchMasterData<Product>('products'),
      fetchMasterData<Employee>('employees'),
      stage === 'thermal_concrete' ? fetchMasterData<Customer>('customers') : Promise.resolve([] as Customer[]),
      stage === 'tunnel_kiln' ? fetchMasterData<Furnace>('furnaces') : Promise.resolve([] as Furnace[]),
      stage === 'tunnel_kiln' ? fetchMasterData<FurnaceCar>('furnaceCars') : Promise.resolve([] as FurnaceCar[]),
    ]).then(([prods, emps, custs, furns, carList]) => {
      setProducts(prods);
      setEmployees(emps);
      setCustomers(custs);
      setFurnaces(furns);
      setCars(carList);
    }).catch(console.error);
  }, [stage]);

  const productOptions: SmartOption[] = useMemo(() => products.map((p) => ({ id: p.id || '', code: p.code || p.productCode || '', name: p.name || '' })), [products]);
  const customerOptions: SmartOption[] = useMemo(() => customers.map((c) => ({ id: c.id || '', code: c.code, name: c.name, subtitle: c.city || '' })), [customers]);
  const employeeOptions: SmartOption[] = useMemo(() => employees.map((e) => ({ id: e.id || '', code: e.code, name: e.name, subtitle: e.department })), [employees]);
  const furnaceOptions: SmartOption[] = useMemo(() => furnaces.filter((f) => f.active !== false).map((f) => ({ id: f.id || '', code: f.code, name: f.name })), [furnaces]);
  const carOptions: SmartOption[] = useMemo(
    () => cars.filter((c) => c.active !== false && (!furnace.id || !c.furnaceId || c.furnaceId === furnace.id)).map((c) => ({ id: c.id || '', code: c.code, name: c.carNumber })),
    [cars, furnace.id],
  );

  const buildData = (): Record<string, unknown> => {
    const selectedCars = cars.filter((c) => carIds.includes(c.id || ''));
    const workers = employees.filter((e) => workerIds.includes(e.id || '')).map((e) => ({ employeeId: e.id || '', employeeCode: e.code, employeeName: e.name }));
    return {
      date,
      productId: product.id ?? '',
      productCode: product.code,
      productName: product.name,
      ...(batchNumber.trim() ? { batchNumber: batchNumber.trim() } : {}),
      ...(manufacturingOrderNumber.trim() ? { manufacturingOrderNumber: manufacturingOrderNumber.trim() } : {}),
      ...(sourceDocumentReference.trim() ? { sourceDocumentReference: sourceDocumentReference.trim() } : {}),
      productionQuantity,
      ...(operatingHours > 0 ? { operatingHours } : {}),
      ...(workers.length ? { workers } : {}),
      ...(stage === 'thermal_concrete' && customer.id ? { customerId: customer.id, customerCode: customer.code, customerName: customer.name } : {}),
      ...(stage === 'thermal_concrete' && customerRequestNumber.trim() ? { customerRequestNumber: customerRequestNumber.trim() } : {}),
      ...(stage !== 'thermal_concrete' && wasteQuantity > 0 ? { wasteQuantity } : {}),
      ...(stage === 'handmade_brick' && pieceWeightKg > 0 ? { pieceWeightKg } : {}),
      ...(stage === 'tunnel_kiln' && furnace.id ? { furnaceId: furnace.id, furnaceCode: furnace.code, furnaceName: furnace.name } : {}),
      ...(stage === 'tunnel_kiln' && selectedCars.length
        ? { furnaceCarIds: selectedCars.map((c) => c.id || ''), furnaceCarNumbers: selectedCars.map((c) => c.carNumber) }
        : {}),
      notes,
    };
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    const check = validateProductionAreaRecord(stage, buildData());
    if (!check.valid) {
      setFeedback({ type: 'error', message: check.issues.map((i) => (isAr ? i.messageAr : i.messageEn)).join(' | ') });
      return;
    }
    if (status === 'SUBMITTED') {
      const warnings = evaluateStageWarnings(stage, { production: productionQuantity, waste: wasteQuantity }, language);
      if (warnings.length > 0) {
        setPendingWarnings(warnings);
        return;
      }
    }
    await performSave(status, []);
  };

  const performSave = async (status: 'SUBMITTED' | 'DRAFT', overridden: ValidationResult[]) => {
    setIsSubmitting(true);
    setFeedback(null);
    try {
      // Every shared check runs BEFORE the existing write; any failure throws and nothing is written.
      const genealogy = await prepareProductionGenealogy(materialsList, productionGenealogy?.outputs ?? [], productionReferences, language);
      const consumptionLines = await prepareActualConsumption(materialsList, language);
      const packaging = stage === 'thermal_concrete' ? await preparePackagingActivity(stage, productionGenealogy?.packaging, language) : {};
      const data = { ...buildData(), materials: consumptionLines, ...genealogy, ...packaging };
      const newRecordId = await createStageRecord(stage, await attachProductionReferences(stage, data, productionReferences, language), status);
      if (overridden.length > 0) {
        logAuditAction(
          'UPDATE',
          STAGE_COLLECTION_NAMES[stage],
          newRecordId,
          `[OVERRIDE_WARNING] recordId=${newRecordId} warningCodes=${overridden.map((w) => w.code).join(',')} override=true - ${overridden.map((w) => w.message).join(' | ')}`,
        ).catch(() => {});
      }
      setFeedback({ type: 'success', message: isAr ? 'تم حفظ السجل بنجاح.' : 'Record saved successfully.' });
      reset();
      setPendingWarnings([]);
      onSuccess?.();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || (isAr ? 'فشل الحفظ.' : 'Save failed.') });
    } finally {
      setIsSubmitting(false);
    }
  };

  const field = 'w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl';
  const label = 'block text-xs font-bold text-slate-700 mb-1.5';
  const quantityLabel = stage === 'handmade_brick'
    ? (isAr ? `عدد القطع المشكلة (${unit})` : `Pieces formed (${unit})`)
    : stage === 'tunnel_kiln'
      ? (isAr ? `الكمية المحروقة (${unit})` : `Fired quantity (${unit})`)
      : (isAr ? `الكمية المنتجة (${unit})` : `Produced quantity (${unit})`);

  return (
    <form id={`production-area-form-${stage}`} onSubmit={(e) => handleSubmit(e, 'SUBMITTED')} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-7 space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
            <Layers3 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{isAr ? title.ar : title.en}</h2>
            <p className="text-xs text-slate-500">
              {isAr ? 'العمالة والطاقة وساعات التشغيل اختيارية - لا يُفترض مصدر بيانات غير متاح.' : 'Labour, energy and operating hours are optional - no unavailable data source is assumed.'}
            </p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-orange-100 text-orange-800 rounded-lg">{isAr ? title.badgeAr : title.badgeEn}</span>
      </div>

      {feedback && (
        <div className={`p-4 rounded-xl text-xs font-bold flex items-center gap-2 ${feedback.type === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
          {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{feedback.message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className={label}>{isAr ? 'تاريخ الإنتاج' : 'Production Date'} <span className="text-red-500">*</span></label>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </div>
        <div>
          <label className={label}>{isAr ? 'رقم الدفعة' : 'Batch Number'}</label>
          <input type="text" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder={`${title.batchPrefix}-...`} className={`${field} font-mono`} />
        </div>
        <div>
          <label className={label}>{isAr ? 'رقم أمر التصنيع' : 'Manufacturing Order #'}</label>
          <input type="text" value={manufacturingOrderNumber} onChange={(e) => setManufacturingOrderNumber(e.target.value)} placeholder={isAr ? 'اختياري' : 'Optional'} className={`${field} font-mono`} />
        </div>
        {stage === 'thermal_concrete' ? (
          <div>
            <label className={label}>{isAr ? 'رقم طلب العميل' : 'Customer Request #'}</label>
            <input type="text" value={customerRequestNumber} onChange={(e) => setCustomerRequestNumber(e.target.value)} placeholder={isAr ? 'اختياري' : 'Optional'} className={field} />
          </div>
        ) : (
          <div>
            <label className={label}>{isAr ? 'المصدر (مرجع المستند)' : 'Source (document reference)'}</label>
            <input type="text" value={sourceDocumentReference} onChange={(e) => setSourceDocumentReference(e.target.value)} placeholder={isAr ? 'اختياري' : 'Optional'} className={`${field} font-mono`} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SmartEntitySelect
          id={`${stage}-product-select`}
          label={stage === 'tunnel_kiln' ? (isAr ? 'المنتج المحروق' : 'Fired product') : (isAr ? 'المنتج' : 'Product')}
          entityType="product"
          required
          options={productOptions}
          value={product.id}
          onChange={(id, opt) => setProduct({ id, code: opt?.code || '', name: opt?.name || '' })}
          placeholder={isAr ? 'ابحث عن المنتج...' : 'Search for the product...'}
        />
        {stage === 'thermal_concrete' && (
          <SmartEntitySelect
            id={`${stage}-customer-select`}
            label={isAr ? 'العميل' : 'Customer'}
            entityType="customer"
            options={customerOptions}
            value={customer.id}
            onChange={(id, opt) => setCustomer({ id, code: opt?.code || '', name: opt?.name || '' })}
            placeholder={isAr ? 'ابحث عن العميل...' : 'Search for the customer...'}
          />
        )}
        {stage === 'tunnel_kiln' && (
          <SmartEntitySelect
            id={`${stage}-furnace-select`}
            label={isAr ? 'الفرن' : 'Kiln'}
            entityType="furnace"
            options={furnaceOptions}
            value={furnace.id}
            onChange={(id, opt) => { setFurnace({ id, code: opt?.code || '', name: opt?.name || '' }); setCarIds([]); }}
            placeholder={isAr ? 'اختياري' : 'Optional'}
          />
        )}
      </div>

      {stage === 'tunnel_kiln' && (
        <MultiSmartEntitySelect
          id={`${stage}-cars-select`}
          label={isAr ? 'العربات المحروقة' : 'Cars fired'}
          entityType="car"
          options={carOptions}
          selectedIds={carIds}
          onChange={setCarIds}
          allowAddNew={false}
          language={isAr ? 'ar' : 'en'}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-orange-50/50 p-4 rounded-xl border border-orange-200">
        <div>
          <label className={label}>{quantityLabel} <span className="text-red-500">*</span></label>
          <input type="number" min="0" step={stage === 'handmade_brick' ? '1' : 'any'} value={productionQuantity || ''} onChange={(e) => setProductionQuantity(num(e.target.value))} className={`${field} font-bold`} />
        </div>
        {stage !== 'thermal_concrete' && (
          <div>
            <label className={label}>{isAr ? `الهالك (${unit})` : `Waste (${unit})`}</label>
            <input type="number" min="0" step="any" value={wasteQuantity || ''} onChange={(e) => setWasteQuantity(num(e.target.value))} className={field} />
          </div>
        )}
        {stage === 'handmade_brick' && (
          <div>
            <label className={label}>{isAr ? 'وزن القطعة (كجم)' : 'Piece weight (kg)'}</label>
            <input type="number" min="0" step="any" value={pieceWeightKg || ''} onChange={(e) => setPieceWeightKg(num(e.target.value))} className={field} />
          </div>
        )}
        <div>
          <label className={label}>{isAr ? 'ساعات التشغيل (اختياري)' : 'Operating hours (optional)'}</label>
          <input type="number" min="0" step="0.5" value={operatingHours || ''} onChange={(e) => setOperatingHours(num(e.target.value))} className={field} />
        </div>
      </div>

      <ActualConsumptionPanel lines={materialsList} onChange={setMaterialsList} jobReferenceId={productionReferences?.jobReferenceId} />

      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase">
          <Users className="w-4 h-4 text-orange-600" />
          {isAr ? `العمالة - اختياري (${workerIds.length})` : `Workers - optional (${workerIds.length})`}
        </h3>
        <MultiSmartEntitySelect
          id={`${stage}-workers-select`}
          label={isAr ? 'إضافة عمالة:' : 'Add workers:'}
          entityType="employee"
          options={employeeOptions}
          selectedIds={workerIds}
          onChange={setWorkerIds}
          language={isAr ? 'ar' : 'en'}
        />
      </div>

      <div>
        <label className={label}>{isAr ? 'ملاحظات' : 'Notes'}</label>
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button type="button" disabled={isSubmitting} onClick={(e) => handleSubmit(e, 'DRAFT')} className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
          <FileCheck className="w-4 h-4 text-slate-500" />
          {isAr ? 'حفظ كمسودة' : 'Save as Draft'}
        </button>
        <button type="submit" disabled={isSubmitting} className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50 rounded-xl shadow-md cursor-pointer">
          {isSubmitting ? <><Loader2 className="w-4 h-4 animate-spin" />{isAr ? 'جاري الحفظ...' : 'Saving...'}</> : <><Save className="w-4 h-4" />{isAr ? 'اعتماد وتسجيل الإنتاج' : 'Approve & Save Production'}</>}
        </button>
      </div>

      {pendingWarnings.length > 0 && (
        <Modal isOpen onClose={() => setPendingWarnings([])} title={isAr ? 'تحذيرات' : 'Warnings'} maxWidth="md">
          <div className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
            <ul className="list-disc ps-5 text-sm font-bold text-amber-900 space-y-1 p-3 bg-amber-50 border-2 border-amber-300 rounded-xl">
              {pendingWarnings.map((w, i) => <li key={i}>{w.message}</li>)}
            </ul>
            {!canOverrideWarnings && (
              <p className="text-[11px] text-red-600 font-bold bg-red-50 border border-red-200 rounded-lg p-2">
                {isAr ? 'لا تملك صلاحية "حفظ رغم التحذير".' : 'You do not have "Save Despite Warning" permission.'}
              </p>
            )}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button type="button" onClick={() => setPendingWarnings([])} className="px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">{isAr ? 'تعديل البيانات' : 'Edit Data'}</button>
              <button type="button" disabled={!canOverrideWarnings || isSubmitting} onClick={() => performSave('SUBMITTED', pendingWarnings)} className="px-4 py-2 text-xs font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 rounded-lg cursor-pointer">
                {isAr ? 'حفظ رغم التحذير' : 'Save Despite Warning'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </form>
  );
};

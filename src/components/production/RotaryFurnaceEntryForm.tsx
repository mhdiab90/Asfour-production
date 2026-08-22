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
import { Material, Employee, Product, Shift } from '../../types';
import { fetchMasterData } from '../../services/masterDataService';
import { fetchMaterials } from '../../services/materialService';
import { createStageRecord } from '../../services/stageRecordService';

interface RotaryFurnaceEntryFormProps {
  onSuccess?: () => void;
}

export const RotaryFurnaceEntryForm: React.FC<RotaryFurnaceEntryFormProps> = ({ onSuccess }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [operationPeriod, setOperationPeriod] = useState('صباحي (08:00 - 16:00)');
  const [batchNumber, setBatchNumber] = useState(`BATCH-${Date.now().toString().slice(-4)}`);
  
  const [productId, setProductId] = useState<string | null>(null);
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [operatingHours, setOperatingHours] = useState(8);

  const [consumptionMode, setConsumptionMode] = useState<'batch' | 'per_ton'>('batch');
  const [gasConsumption, setGasConsumption] = useState<number>(450);
  const [electricityConsumption, setElectricityConsumption] = useState<number>(320);

  const [productionQuantity, setProductionQuantity] = useState<number>(25);
  const [wasteQuantity, setWasteQuantity] = useState<number>(1.2);
  const [downtimeMinutes, setDowntimeMinutes] = useState<number>(0);
  const [faultType, setFaultType] = useState('');
  const [notes, setNotes] = useState('');

  // Materials & Workers
  const [materialsList, setMaterialsList] = useState<{ materialId: string; materialCode: string; materialName: string; quantity: number; unit: string }[]>([]);
  const [prodWorkersList, setProdWorkersList] = useState<{ employeeId: string; employeeCode: string; employeeName: string }[]>([]);

  // Master Data
  const [products, setProducts] = useState<Product[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftId, setShiftId] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetchMasterData<Product>('products'),
      fetchMaterials(),
      fetchMasterData<Employee>('employees'),
      fetchMasterData<Shift>('shifts'),
    ]).then(([prods, mats, emps, shs]) => {
      setProducts(prods);
      setMaterials(mats);
      setEmployees(emps);
      setShifts(shs);
      if (shs.length > 0) setShiftId(shs[0].id || '');
    }).catch(console.error);
  }, []);

  const productOptions: SmartOption[] = useMemo(() => {
    return products.map(p => ({
      id: p.id || '',
      code: p.code || p.productCode || '',
      name: p.name || '',
      subtitle: `${p.aluminaPercentage || 40}% ألومينا`,
    }));
  }, [products]);

  const materialOptions: SmartOption[] = useMemo(() => {
    return materials.map(m => ({
      id: m.id || '',
      code: m.code,
      name: m.name,
      subtitle: `الوحدة: ${m.unit}`,
      unit: m.unit,
    }));
  }, [materials]);

  const employeeOptions: SmartOption[] = useMemo(() => {
    return employees.map(e => ({
      id: e.id || '',
      code: e.code,
      name: e.name,
      subtitle: e.department || 'الإنتاج',
    }));
  }, [employees]);

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
        unit: first.unit || 'طن',
      }
    ]);
  };

  const handleRemoveMaterialRow = (index: number) => {
    setMaterialsList(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleAddWorkerRow = () => {
    if (employees.length === 0) return;
    const first = employees[0];
    setProdWorkersList(prev => [
      ...prev,
      {
        employeeId: first.id || '',
        employeeCode: first.code,
        employeeName: first.name,
      }
    ]);
  };

  const handleRemoveWorkerRow = (index: number) => {
    setProdWorkersList(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    if (!productId) {
      setFeedback({ type: 'error', message: 'يرجى اختيار المنتج المصنع أولاً.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      await createStageRecord('rotary_furnace', {
        date,
        operationPeriod,
        batchNumber,
        productId,
        productCode,
        productName,
        productOperatingHours: operatingHours,
        consumptionMode,
        gasConsumption,
        electricityConsumption,
        gasPerTon,
        electricityPerTon,
        materials: materialsList,
        productionWorkers: prodWorkersList.map(w => ({ ...w, role: 'production' })),
        maintenanceWorkers: [],
        productionQuantity,
        wasteQuantity,
        goodQuantity,
        wastePercentage,
        downtimeMinutes,
        faultType,
        shiftId: shiftId || 'shift-1',
        shiftName: shifts.find(s => s.id === shiftId)?.name || 'وردية صباحية',
        notes,
      }, status);

      setFeedback({
        type: 'success',
        message: `تم حفظ سجل إنتاج الفرن الدوار بنجاح (${status === 'DRAFT' ? 'مسودة' : 'معتمد للنظام'}).`
      });

      // Reset form
      setBatchNumber(`BATCH-${Date.now().toString().slice(-4)}`);
      setMaterialsList([]);
      setProdWorkersList([]);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'حدث خطأ أثناء الحفظ.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => handleSubmit(e, 'SUBMITTED')} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-7 space-y-6" dir="rtl">
      {/* Stage Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              تسجيل إنتاج: الفرن الدوار (Rotary Furnace)
            </h2>
            <p className="text-xs text-slate-500">
              تسجيل خلطات التكليس، استهلاك الطاقة (الغاز والكهرباء)، والخامات المستخدمة
            </p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-red-100 text-red-800 rounded-lg">
          المرحلة 2
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            تاريخ التشغيل <span className="text-red-500">*</span>
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
            رقم الدفعة (Batch No)
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
            فترة التشغيل / الوردية
          </label>
          <input
            type="text"
            value={operationPeriod}
            onChange={(e) => setOperationPeriod(e.target.value)}
            placeholder="صباحي / مسائي"
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            ساعات التشغيل
          </label>
          <input
            type="number"
            step="0.5"
            value={operatingHours}
            onChange={(e) => setOperatingHours(Number(e.target.value))}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none"
          />
        </div>
      </div>

      {/* Product Selection with Inline Add */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <SmartEntitySelect
          id="rf-product-select"
          label="المنتج المصنع بالفرن"
          entityType="product"
          required
          options={productOptions}
          value={productId}
          onChange={(id, opt) => {
            setProductId(id);
            setProductCode(opt?.code || '');
            setProductName(opt?.name || '');
          }}
          placeholder="ابحث بكود أو اسم المنتج الحراري..."
        />

        <div className="flex items-center gap-4 pt-4 sm:pt-6">
          <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 text-center">
            <span className="text-[11px] text-slate-500 font-bold block">إجمالي الإنتاج</span>
            <span className="text-base font-black text-slate-900">{productionQuantity} طن</span>
          </div>
          <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 text-center">
            <span className="text-[11px] text-slate-500 font-bold block">الصالح النظيف</span>
            <span className="text-base font-black text-emerald-600">{goodQuantity} طن</span>
          </div>
          <div className="flex-1 bg-white p-3 rounded-xl border border-slate-200 text-center">
            <span className="text-[11px] text-slate-500 font-bold block">نسبة الهالك</span>
            <span className="text-base font-black text-red-600">{wastePercentage}%</span>
          </div>
        </div>
      </div>

      {/* Energy & Fuel Consumption */}
      <div className="bg-amber-50/50 p-4 rounded-xl border border-amber-200 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-amber-900 flex items-center gap-1.5 uppercase">
            <Zap className="w-4 h-4 text-amber-600" />
            استهلاك الطاقة والوقود (معدلات الحرق)
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConsumptionMode('batch')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                consumptionMode === 'batch' ? 'bg-amber-600 text-white' : 'bg-white text-slate-700 border border-slate-300'
              }`}
            >
              إجمالي الدفعة
            </button>
            <button
              type="button"
              onClick={() => setConsumptionMode('per_ton')}
              className={`px-2.5 py-1 text-xs font-bold rounded-lg cursor-pointer transition-colors ${
                consumptionMode === 'per_ton' ? 'bg-amber-600 text-white' : 'bg-white text-slate-700 border border-slate-300'
              }`}
            >
              معدل لكل طن
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              استهلاك الغاز الطبيعي (م³)
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
              معدل الغاز لكل طن (م³/طن)
            </label>
            <div className="w-full px-3 py-2 text-sm bg-slate-100 border border-slate-300 rounded-xl font-bold font-mono text-slate-800">
              {gasPerTon} م³/طن
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              استهلاك الكهرباء (kWh)
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
              معدل الكهرباء لكل طن (kWh/طن)
            </label>
            <div className="w-full px-3 py-2 text-sm bg-slate-100 border border-slate-300 rounded-xl font-bold font-mono text-slate-800">
              {electricityPerTon} kWh/طن
            </div>
          </div>
        </div>
      </div>

      {/* Raw Materials Used (Multi-row with Smart Select) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase">
            <Package className="w-4 h-4 text-purple-600" />
            الخامات الأولية المستخدمة بالخلطة ({materialsList.length})
          </h3>
          <button
            type="button"
            onClick={handleAddMaterialRow}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة مادة خام
          </button>
        </div>

        {materialsList.length === 0 ? (
          <div className="p-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-xs text-slate-500">
            لم يتم إضافة خامات أولية بعد. اضغط على "إضافة مادة خام" لتسجيل استهلاك الخامات.
          </div>
        ) : (
          <div className="space-y-2">
            {materialsList.map((row, idx) => (
              <div key={idx} className="flex items-center gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <div className="flex-1">
                  <select
                    value={row.materialId}
                    onChange={(e) => {
                      const mat = materials.find(m => m.id === e.target.value);
                      if (mat) {
                        const next = [...materialsList];
                        next[idx] = {
                          materialId: mat.id || '',
                          materialCode: mat.code,
                          materialName: mat.name,
                          quantity: row.quantity,
                          unit: mat.unit || 'طن',
                        };
                        setMaterialsList(next);
                      }
                    }}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-800"
                  >
                    {materials.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.code} — {m.name} ({m.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-28">
                  <input
                    type="number"
                    step="0.01"
                    value={row.quantity}
                    onChange={(e) => {
                      const next = [...materialsList];
                      next[idx].quantity = Number(e.target.value);
                      setMaterialsList(next);
                    }}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold text-slate-800 text-center"
                    placeholder="الكمية"
                  />
                </div>
                <span className="text-xs font-bold text-slate-500 w-12 text-center">
                  {row.unit}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveMaterialRow(idx)}
                  className="p-1 text-slate-400 hover:text-red-600 rounded-md cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Production Workers */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase">
            <Users className="w-4 h-4 text-emerald-600" />
            عمالة التشغيل والصيانة ({prodWorkersList.length})
          </h3>
          <button
            type="button"
            onClick={handleAddWorkerRow}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة عامل
          </button>
        </div>

        {prodWorkersList.length === 0 ? (
          <div className="p-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-xs text-slate-500">
            لم يتم ربط عمالة بهذا السجل بعد.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {prodWorkersList.map((w, idx) => (
              <div key={idx} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-xl border border-slate-200">
                <div className="truncate">
                  <span className="font-mono text-[10px] font-bold bg-slate-200 px-1.5 py-0.5 rounded me-1">
                    {w.employeeCode}
                  </span>
                  <span className="text-xs font-bold text-slate-800">{w.employeeName}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveWorkerRow(idx)}
                  className="text-slate-400 hover:text-red-600 p-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Downtime & Notes */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            زمن التوقفات / الأعطال (دقيقة)
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
            سبب التوقف أو العطل
          </label>
          <input
            type="text"
            value={faultType}
            onChange={(e) => setFaultType(e.target.value)}
            placeholder="صيانة دورية / انقطاع كهرباء / تغيير شعلة..."
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
          حفظ كمسودة
        </button>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              جاري الحفظ...
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              اعتماد وتسجيل الإنتاج
            </>
          )}
        </button>
      </div>
    </form>
  );
};

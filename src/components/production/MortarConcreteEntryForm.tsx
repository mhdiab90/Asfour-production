/**
 * Stage 5: Mortar & Concrete Entry Form (المونة والخرسانات الحرارية)
 * Fields:
 * - Date, Product (SmartEntitySelect), Customer (SmartEntitySelect)
 * - Batch No, Manufacturing Order No (أمر التصنيع), Customer Request No (طلب العميل)
 * - Production Quantity (Tons), Materials used, Operating Hours, Workers
 */
import React, { useState, useEffect, useMemo } from 'react';
import { Boxes, Save, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, FileCheck } from 'lucide-react';
import { SmartEntitySelect, SmartOption } from '../common/SmartEntitySelect';
import { Product, Customer, Material, Employee } from '../../types';
import { fetchMasterData } from '../../services/masterDataService';
import { fetchMaterials } from '../../services/materialService';
import { createStageRecord } from '../../services/stageRecordService';

export const MortarConcreteEntryForm: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [productId, setProductId] = useState<string | null>(null);
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerCode, setCustomerCode] = useState('');
  const [customerName, setCustomerName] = useState('');

  const [batchNumber, setBatchNumber] = useState(`MC-${Date.now().toString().slice(-4)}`);
  const [manufacturingOrderNumber, setManufacturingOrderNumber] = useState(`MO-2026-${Date.now().toString().slice(-3)}`);
  const [customerRequestNumber, setCustomerRequestNumber] = useState('');

  const [productionQuantity, setProductionQuantity] = useState<number>(8.5); // tons
  const [operatingHours, setOperatingHours] = useState<number>(6);
  const [notes, setNotes] = useState('');

  const [materialsList, setMaterialsList] = useState<{ materialId: string; materialCode: string; materialName: string; quantity: number; unit: string }[]>([]);
  const [workersList, setWorkersList] = useState<{ employeeId: string; employeeCode: string; employeeName: string }[]>([]);

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetchMasterData<Product>('products'),
      fetchMasterData<Customer>('customers'),
      fetchMaterials(),
      fetchMasterData<Employee>('employees'),
    ]).then(([prods, custs, mats, emps]) => {
      setProducts(prods);
      setCustomers(custs);
      setMaterials(mats);
      setEmployees(emps);
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

  const customerOptions: SmartOption[] = useMemo(() => {
    return customers.map(c => ({
      id: c.id || '',
      code: c.code,
      name: c.name,
      subtitle: c.city || '',
    }));
  }, [customers]);

  const handleAddMaterial = () => {
    if (materials.length === 0) return;
    const first = materials[0];
    setMaterialsList(prev => [...prev, {
      materialId: first.id || '',
      materialCode: first.code,
      materialName: first.name,
      quantity: 1,
      unit: first.unit || 'طن',
    }]);
  };

  const handleAddWorker = () => {
    if (employees.length === 0) return;
    const first = employees[0];
    setWorkersList(prev => [...prev, {
      employeeId: first.id || '',
      employeeCode: first.code,
      employeeName: first.name,
    }]);
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    if (!productId) {
      setFeedback({ type: 'error', message: 'يرجى اختيار خلطة المونة أو الخرسانة.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      await createStageRecord('mortar_concrete', {
        date,
        productId,
        productCode,
        productName,
        customerId,
        customerCode,
        customerName,
        batchNumber,
        manufacturingOrderNumber,
        customerRequestNumber,
        productionQuantity,
        materials: materialsList,
        operatingHours,
        workers: workersList,
        notes,
      }, status);

      setFeedback({ type: 'success', message: 'تم حفظ سجل المونة والخرسانات بنجاح.' });
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'فشل الحفظ.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => handleSubmit(e, 'SUBMITTED')} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-7 space-y-6" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Boxes className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              تسجيل إنتاج: المونة والخرسانات الحرارية (Mortar & Concrete)
            </h2>
            <p className="text-xs text-slate-500">
              خلطات المونة المقاومة للحرارة، خرسانات الصب، أوامر التصنيع وطلبات العملاء
            </p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-emerald-100 text-emerald-800 rounded-lg">
          المرحلة 5
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            تاريخ الإنتاج <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
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
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-mono font-bold"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            رقم أمر التصنيع (MO #)
          </label>
          <input
            type="text"
            value={manufacturingOrderNumber}
            onChange={(e) => setManufacturingOrderNumber(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            رقم طلب العميل (PO #)
          </label>
          <input
            type="text"
            value={customerRequestNumber}
            onChange={(e) => setCustomerRequestNumber(e.target.value)}
            placeholder="اختياري"
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SmartEntitySelect
          id="mc-product-select"
          label="منتج المونة / الخرسانة الحرارية"
          entityType="product"
          required
          options={productOptions}
          value={productId}
          onChange={(id, opt) => {
            setProductId(id);
            setProductCode(opt?.code || '');
            setProductName(opt?.name || '');
          }}
          placeholder="ابحث عن خلطة المونة أو الخرسانة..."
        />

        <SmartEntitySelect
          id="mc-customer-select"
          label="العميل الطالب"
          entityType="customer"
          options={customerOptions}
          value={customerId}
          onChange={(id, opt) => {
            setCustomerId(id);
            setCustomerCode(opt?.code || '');
            setCustomerName(opt?.name || '');
          }}
          placeholder="ابحث عن العميل..."
        />
      </div>

      {/* Production Quantity & Materials */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-emerald-50/50 p-4 rounded-xl border border-emerald-200">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            الكمية المنتجة (طن)
          </label>
          <input
            type="number"
            step="0.1"
            value={productionQuantity}
            onChange={(e) => setProductionQuantity(Number(e.target.value))}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold text-slate-900"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">
            ساعات التشغيل
          </label>
          <input
            type="number"
            step="0.5"
            value={operatingHours}
            onChange={(e) => setOperatingHours(Number(e.target.value))}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold"
          />
        </div>
      </div>

      {/* Materials List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase">
            الخامات المضافة للخلطة ({materialsList.length})
          </h3>
          <button
            type="button"
            onClick={handleAddMaterial}
            className="text-xs font-bold text-emerald-700 hover:text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة مادة
          </button>
        </div>

        {materialsList.map((row, idx) => (
          <div key={idx} className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200">
            <select
              value={row.materialId}
              onChange={(e) => {
                const mat = materials.find(m => m.id === e.target.value);
                if (mat) {
                  const next = [...materialsList];
                  next[idx] = { ...next[idx], materialId: mat.id || '', materialCode: mat.code, materialName: mat.name, unit: mat.unit };
                  setMaterialsList(next);
                }
              }}
              className="flex-1 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs font-bold"
            >
              {materials.map(m => <option key={m.id} value={m.id}>{m.code} — {m.name} ({m.unit})</option>)}
            </select>
            <input
              type="number"
              step="0.1"
              value={row.quantity}
              onChange={(e) => {
                const next = [...materialsList];
                next[idx].quantity = Number(e.target.value);
                setMaterialsList(next);
              }}
              className="w-24 bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs font-bold text-center"
            />
            <span className="text-xs font-bold text-slate-500 w-10">{row.unit}</span>
            <button
              type="button"
              onClick={() => setMaterialsList(prev => prev.filter((_, i) => i !== idx))}
              className="text-slate-400 hover:text-red-600 p-1"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={(e) => handleSubmit(e, 'DRAFT')}
          className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
        >
          <FileCheck className="w-4 h-4 text-slate-500" />
          حفظ كمسودة
        </button>

        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          اعتماد وتسجيل الإنتاج
        </button>
      </div>
    </form>
  );
};

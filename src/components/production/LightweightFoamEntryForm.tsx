/**
 * Stage 7: Lightweight Foam Entry Form (الشاموت الخفيف / عزل الفوم)
 * Fields:
 * - Date, Product Name, Mix, Materials Used, Workers, Production Qty, Operating Hours, Yield %
 */
import React, { useState, useEffect } from 'react';
import { Feather, Save, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, FileCheck } from 'lucide-react';
import { Material } from '../../types';
import { fetchMaterials } from '../../services/materialService';
import { createStageRecord } from '../../services/stageRecordService';

export const LightweightFoamEntryForm: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [productName, setProductName] = useState('طوب عازل خفيف (LW-23)');
  const [productCode, setProductCode] = useState('LW-23-FOAM');
  const [batchNumber, setBatchNumber] = useState(`FOAM-${Date.now().toString().slice(-4)}`);
  const [productionQuantity, setProductionQuantity] = useState<number>(15); // tons
  const [wasteQuantity, setWasteQuantity] = useState<number>(0.8);
  const [operatingHours, setOperatingHours] = useState<number>(8);
  const [notes, setNotes] = useState('');

  const [materialsList, setMaterialsList] = useState<{ materialId: string; materialCode: string; materialName: string; quantity: number; unit: string }[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchMaterials().then(setMaterials).catch(console.error);
  }, []);

  const yieldPercentage = productionQuantity > 0 ? Number((((productionQuantity - wasteQuantity) / productionQuantity) * 100).toFixed(1)) : 100;

  const handleAddMaterial = () => {
    if (materials.length === 0) return;
    const first = materials[0];
    setMaterialsList(prev => [...prev, {
      materialId: first.id || '',
      materialCode: first.code,
      materialName: first.name,
      quantity: 2,
      unit: first.unit || 'طن',
    }]);
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    try {
      await createStageRecord('lightweight_foam', {
        date,
        productName,
        productCode,
        batchNumber,
        productionQuantity,
        wasteQuantity,
        yieldPercentage,
        operatingHours,
        materials: materialsList,
        workers: [],
        notes,
      }, status);

      setFeedback({ type: 'success', message: 'تم حفظ سجل الشاموت الخفيف بنجاح.' });
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
          <div className="w-11 h-11 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
            <Feather className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              تسجيل إنتاج: الشاموت الخفيف وعزل الفوم (Lightweight & Foam)
            </h2>
            <p className="text-xs text-slate-500">
              إنتاج الطوب والكتل العازلة للحرارة، مسامية الفوم ونسب الهالك
            </p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-teal-100 text-teal-800 rounded-lg">
          المرحلة 7
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">تاريخ التشغيل *</label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-teal-500/20 outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم الصنف العازل *</label>
          <input
            type="text"
            required
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">كود الصنف</label>
          <input
            type="text"
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-teal-50/40 p-4 rounded-xl border border-teal-200">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">الكمية المنتجة (طن)</label>
          <input
            type="number"
            step="0.1"
            value={productionQuantity}
            onChange={(e) => setProductionQuantity(Number(e.target.value))}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl font-bold"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">الهالك (طن)</label>
          <input
            type="number"
            step="0.01"
            value={wasteQuantity}
            onChange={(e) => setWasteQuantity(Number(e.target.value))}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl font-bold text-red-600"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">نسبة التجانس والكفاءة</label>
          <div className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl font-bold text-teal-700">
            {yieldPercentage}%
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button
          type="button"
          disabled={isSubmitting}
          onClick={(e) => handleSubmit(e, 'DRAFT')}
          className="px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
        >
          حفظ كمسودة
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          اعتماد وتسجيل الإنتاج
        </button>
      </div>
    </form>
  );
};

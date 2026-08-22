/**
 * Stage 6: Mixing Stage Entry Form (الخلط والتجهيز)
 * Fields:
 * - Date, Mix Name / Product, Raw Materials used, Production Quantity, Operating Hours, Yield %
 */
import React, { useState, useEffect } from 'react';
import { FlaskConical, Save, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, FileCheck } from 'lucide-react';
import { Material, Employee } from '../../types';
import { fetchMasterData } from '../../services/masterDataService';
import { fetchMaterials } from '../../services/materialService';
import { createStageRecord } from '../../services/stageRecordService';

export const MixingEntryForm: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [mixProductName, setMixProductName] = useState('خلطة حرارية شاموت 50%');
  const [mixProductCode, setMixProductCode] = useState('MIX-CH-50');
  const [batchNumber, setBatchNumber] = useState(`MIX-${Date.now().toString().slice(-4)}`);
  const [productionQuantity, setProductionQuantity] = useState<number>(20); // tons
  const [wasteQuantity, setWasteQuantity] = useState<number>(0.5);
  const [operatingHours, setOperatingHours] = useState<number>(7);
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
      quantity: 5,
      unit: first.unit || 'طن',
    }]);
  };

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    try {
      await createStageRecord('mixing', {
        date,
        mixProductName,
        mixProductCode,
        batchNumber,
        productionQuantity,
        wasteQuantity,
        yieldPercentage,
        operatingHours,
        materials: materialsList,
        workers: [],
        notes,
      }, status);

      setFeedback({ type: 'success', message: 'تم حفظ سجل الخلط والتجهيز بنجاح.' });
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
          <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <FlaskConical className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              تسجيل إنتاج: الخلط والتجهيز (Mixing Stage)
            </h2>
            <p className="text-xs text-slate-500">
              تجهيز وتجنيس الخلطات الحرارية ونسب إضافة الخامات
            </p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-indigo-100 text-indigo-800 rounded-lg">
          المرحلة 6
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
          <label className="block text-xs font-bold text-slate-700 mb-1.5">تاريخ الخلط *</label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">اسم الخلطة *</label>
          <input
            type="text"
            required
            value={mixProductName}
            onChange={(e) => setMixProductName(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">كود الخلطة</label>
          <input
            type="text"
            value={mixProductCode}
            onChange={(e) => setMixProductCode(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-indigo-50/40 p-4 rounded-xl border border-indigo-200">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">الكمية المجهزة (طن)</label>
          <input
            type="number"
            step="0.1"
            value={productionQuantity}
            onChange={(e) => setProductionQuantity(Number(e.target.value))}
            className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl font-bold"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">الهالك / الفاقد (طن)</label>
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
          <div className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl font-bold text-emerald-600">
            {yieldPercentage}%
          </div>
        </div>
      </div>

      {/* Materials */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase">خامات الخلطة ({materialsList.length})</h3>
          <button
            type="button"
            onClick={handleAddMaterial}
            className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            إضافة خامة
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
          className="px-4 py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
        >
          حفظ كمسودة
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          اعتماد وتسجيل الإنتاج
        </button>
      </div>
    </form>
  );
};

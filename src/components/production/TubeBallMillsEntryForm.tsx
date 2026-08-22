/**
 * Stage 4: Tube & Ball Mills Entry Form (طواحين الأنابيب والكرات)
 * Fields:
 * - Date, Mill Type (طاحونة كرات / أنابيب), Raw Material Type
 * - Operating Hours, Tons per Hour, Storage Bunker (البنكر / الصومعة)
 * - Auto-calculated Total Tons
 */
import React, { useState } from 'react';
import { Layers, Save, CheckCircle2, AlertCircle, Loader2, FileCheck } from 'lucide-react';
import { createStageRecord } from '../../services/stageRecordService';

export const TubeBallMillsEntryForm: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [millType, setMillType] = useState('طاحونة كرات 1 (Ball Mill #1)');
  const [rawMaterialType, setRawMaterialType] = useState('شاموت 45%');
  const [operatingHours, setOperatingHours] = useState<number>(8);
  const [tonsPerHour, setTonsPerHour] = useState<number>(3.5);
  const [storageBunker, setStorageBunker] = useState('صومعة 4 (Bunker #4)');
  const [notes, setNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const totalTons = Number((operatingHours * tonsPerHour).toFixed(2));

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    try {
      await createStageRecord('tube_ball_mills', {
        date,
        millType,
        rawMaterialType,
        operatingHours,
        tonsPerHour,
        storageBunker,
        totalTons,
        notes,
      }, status);

      setFeedback({ type: 'success', message: 'تم حفظ سجل طواحين الأنابيب والكرات بنجاح.' });
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
          <div className="w-11 h-11 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              تسجيل إنتاج: طواحين الأنابيب والكرات (Tube & Ball Mills)
            </h2>
            <p className="text-xs text-slate-500">
              طحن الخامات بالكرات الفولاذية، الصوامع والبناكر، وساعات التشغيل
            </p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-purple-100 text-purple-800 rounded-lg">
          المرحلة 4
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            تاريخ التشغيل <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            نوع الطاحونة
          </label>
          <input
            type="text"
            value={millType}
            onChange={(e) => setMillType(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            نوع الخامة المطحونة
          </label>
          <input
            type="text"
            value={rawMaterialType}
            onChange={(e) => setRawMaterialType(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
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

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            معدل الطن / ساعة
          </label>
          <input
            type="number"
            step="0.1"
            value={tonsPerHour}
            onChange={(e) => setTonsPerHour(Number(e.target.value))}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            الصومعة / البنكر المستقبل
          </label>
          <input
            type="text"
            value={storageBunker}
            onChange={(e) => setStorageBunker(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold"
          />
        </div>
      </div>

      <div className="bg-purple-50 p-4 rounded-xl border border-purple-200 text-center">
        <span className="text-xs text-purple-800 font-bold block">إجمالي الإنتاج المحسوب</span>
        <span className="text-2xl font-black text-purple-900 block mt-1">{totalTons} طن</span>
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
          className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          اعتماد وتسجيل الإنتاج
        </button>
      </div>
    </form>
  );
};

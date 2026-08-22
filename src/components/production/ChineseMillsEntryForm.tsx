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

export const ChineseMillsEntryForm: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerCode, setCustomerCode] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [specificationCode, setSpecificationCode] = useState('SPEC-MESH-200');
  const [millType, setMillType] = useState('طاحونة صينية 1');
  const [shiftType, setShiftType] = useState('وردية صباحية');
  const [quantity, setQuantity] = useState<number>(12); // tons
  const [numberOfBags, setNumberOfBags] = useState<number>(240); // 50kg bags
  const [rejectedQuantity, setRejectedQuantity] = useState<number>(0.3);
  const [operatingDays, setOperatingDays] = useState<number>(1);
  const [operatingHours, setOperatingHours] = useState<number>(7.5);
  const [downtimeHours, setDowntimeHours] = useState<number>(0.5);
  const [faultType, setFaultType] = useState('');
  const [notes, setNotes] = useState('');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    Promise.all([
      fetchMasterData<Customer>('customers'),
      fetchMasterData<Shift>('shifts'),
    ]).then(([custs, shs]) => {
      setCustomers(custs);
      setShifts(shs);
    }).catch(console.error);
  }, []);

  const customerOptions: SmartOption[] = useMemo(() => {
    return customers.map(c => ({
      id: c.id || '',
      code: c.code,
      name: c.name,
      subtitle: c.city || 'عميل معتمد',
    }));
  }, [customers]);

  // Calculations
  const totalOperatingTime = Number((operatingHours + downtimeHours).toFixed(2));
  const actualRatePerHour = operatingHours > 0 ? Number((quantity / operatingHours).toFixed(2)) : 0;
  const theoreticalRate = 2.0; // 2 tons per hour baseline
  const efficiencyPercentage = operatingHours > 0 ? Number(((actualRatePerHour / theoreticalRate) * 100).toFixed(1)) : 0;

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    setIsSubmitting(true);
    setFeedback(null);
    try {
      await createStageRecord('chinese_mills', {
        date,
        customerId,
        customerCode,
        customerName,
        specificationCode,
        millType,
        shiftType,
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
      }, status);

      setFeedback({
        type: 'success',
        message: 'تم حفظ سجل الطواحين الصينية بنجاح.'
      });
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
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <RotateCw className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              تسجيل إنتاج: الطواحين الصينية (Chinese Mills)
            </h2>
            <p className="text-xs text-slate-500">
              تسجيل طحن الخامات الحرارية، أكياس التعبئة، ومعدلات الأداء
            </p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-amber-100 text-amber-800 rounded-lg">
          المرحلة 3
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
            تاريخ التشغيل <span className="text-red-500">*</span>
          </label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            نوع الطاحونة الصينية
          </label>
          <input
            type="text"
            value={millType}
            onChange={(e) => setMillType(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            كود المواصفة / النعومة
          </label>
          <input
            type="text"
            value={specificationCode}
            onChange={(e) => setSpecificationCode(e.target.value)}
            placeholder="مثال: MESH-200"
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            الوردية
          </label>
          <input
            type="text"
            value={shiftType}
            onChange={(e) => setShiftType(e.target.value)}
            className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SmartEntitySelect
          id="cm-customer-select"
          label="العميل الطالب"
          entityType="customer"
          options={customerOptions}
          value={customerId}
          onChange={(id, opt) => {
            setCustomerId(id);
            setCustomerCode(opt?.code || '');
            setCustomerName(opt?.name || '');
          }}
          placeholder="ابحث بكود أو اسم العميل..."
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              الإنتاج الكلي (طن)
            </label>
            <input
              type="number"
              step="0.1"
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              عدد الشكائر المعبأة
            </label>
            <input
              type="number"
              value={numberOfBags}
              onChange={(e) => setNumberOfBags(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold text-slate-900"
            />
          </div>
        </div>
      </div>

      {/* Operating KPIs and Calculations */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
        <div>
          <span className="text-[11px] text-slate-500 font-bold block">ساعات التشغيل الفعلي</span>
          <input
            type="number"
            step="0.5"
            value={operatingHours}
            onChange={(e) => setOperatingHours(Number(e.target.value))}
            className="w-20 mx-auto text-center font-bold text-sm bg-white border border-slate-300 rounded-lg py-1 mt-1"
          />
        </div>
        <div>
          <span className="text-[11px] text-slate-500 font-bold block">ساعات التوقف</span>
          <input
            type="number"
            step="0.1"
            value={downtimeHours}
            onChange={(e) => setDowntimeHours(Number(e.target.value))}
            className="w-20 mx-auto text-center font-bold text-sm bg-white border border-slate-300 rounded-lg py-1 mt-1"
          />
        </div>
        <div>
          <span className="text-[11px] text-slate-500 font-bold block">معدل الإنتاج الفعلي</span>
          <span className="text-base font-black text-amber-700 block mt-1.5">{actualRatePerHour} طن/س</span>
        </div>
        <div>
          <span className="text-[11px] text-slate-500 font-bold block">نسبة الكفاءة التشغيلية</span>
          <span className="text-base font-black text-emerald-600 block mt-1.5">{efficiencyPercentage}%</span>
        </div>
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
          className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          اعتماد وتسجيل الإنتاج
        </button>
      </div>
    </form>
  );
};

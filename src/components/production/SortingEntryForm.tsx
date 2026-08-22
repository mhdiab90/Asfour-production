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

export const SortingEntryForm: React.FC<{ onSuccess?: () => void }> = ({ onSuccess }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dischargeDate, setDischargeDate] = useState(new Date().toISOString().split('T')[0]);
  const [customerOrderNumber, setCustomerOrderNumber] = useState('');
  const [truckNumber, setTruckNumber] = useState('');

  const [productId, setProductId] = useState<string | null>(null);
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [pieceWeight, setPieceWeight] = useState<number>(4.5); // kg
  const [ratioCode, setRatioCode] = useState('RATIO-A1');

  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerCode, setCustomerCode] = useState('');
  const [customerName, setCustomerName] = useState('');

  // Primary Counts
  const [totalCount, setTotalCount] = useState<number>(5000);
  const [brokenCount, setBrokenCount] = useState<number>(250);

  // Defect breakdown categories
  const [shiverDefectCount, setShiverDefectCount] = useState<number>(80);       // شطف
  const [crackDefectCount, setCrackDefectCount] = useState<number>(90);         // شروخ
  const [ironDefectCount, setIronDefectCount] = useState<number>(30);          // بقع حديد
  const [contaminationDefectCount, setContaminationDefectCount] = useState<number>(20); // شوائب
  const [kilnDefectCount, setKilnDefectCount] = useState<number>(20);          // حريق فرن
  const [returnDefectCount, setReturnDefectCount] = useState<number>(10);      // مرتجع
  const [returnType, setReturnType] = useState('كسر نقل / تداول');
  const [notes, setNotes] = useState('');

  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

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
      subtitle: `${p.aluminaPercentage || 40}% ألومينا`,
      rawItem: p,
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

  const handleSubmit = async (e: React.FormEvent, status: 'SUBMITTED' | 'DRAFT' = 'SUBMITTED') => {
    e.preventDefault();
    if (!productId) {
      setFeedback({ type: 'error', message: 'يرجى اختيار المنتج المفروز.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);
    try {
      await createStageRecord('sorting', {
        date,
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
      }, status);

      setFeedback({ type: 'success', message: 'تم حفظ سجل الفرز والمراقبة وتصنيف العيوب بنجاح.' });
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
          <div className="w-11 h-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              تسجيل إنتاج: الفرز والمراقبة وتصنيف العيوب (Sorting & Inspection)
            </h2>
            <p className="text-xs text-slate-500">
              مراقبة جودة المنتج بعد الحرق، تفريغ الأفران، وتحليل تفصيلي لأسباب المعيب
            </p>
          </div>
        </div>
        <span className="self-start sm:self-auto text-xs font-bold px-3 py-1 bg-rose-100 text-rose-800 rounded-lg">
          المرحلة 8
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
            تاريخ الفرز <span className="text-red-500">*</span>
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
            تاريخ خروج الفرن (Discharge)
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
            رقم أمر العميل (PO #)
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
            رقم السيارة / التريلا
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
          label="المنتج المفروز"
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
          placeholder="ابحث عن المنتج المفروز..."
        />

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              وزن القطعة (كجم)
            </label>
            <input
              type="number"
              step="0.01"
              value={pieceWeight}
              onChange={(e) => setPieceWeight(Number(e.target.value))}
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-bold"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              كود النسبة / الفئة
            </label>
            <input
              type="text"
              value={ratioCode}
              onChange={(e) => setRatioCode(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl font-mono"
            />
          </div>
        </div>
      </div>

      {/* Primary Production & Sorting Quantities */}
      <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
        <h3 className="text-xs font-bold text-slate-800 uppercase flex items-center gap-1.5">
          <Scale className="w-4 h-4 text-slate-600" />
          كميات الفرز والأوزان
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-3.5 rounded-xl border border-slate-200 text-center">
            <label className="block text-xs font-bold text-slate-600 mb-1">إجمالي العدد المفروز (قطعة)</label>
            <input
              type="number"
              value={totalCount}
              onChange={(e) => setTotalCount(Number(e.target.value))}
              className="w-full text-center text-lg font-black text-slate-900 border border-slate-300 rounded-lg py-1"
            />
            <span className="text-xs font-bold text-slate-500 block mt-1.5">الوزن: {totalTons} طن</span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-emerald-200 text-center">
            <label className="block text-xs font-bold text-emerald-700 mb-1">العدد الصالح النظيف (قطعة)</label>
            <div className="text-xl font-black text-emerald-600 py-1">{goodCount.toLocaleString()}</div>
            <span className="text-xs font-bold text-emerald-700 block mt-1.5">
              {goodTons} طن ({goodPercentage}%)
            </span>
          </div>

          <div className="bg-white p-3.5 rounded-xl border border-red-200 text-center">
            <label className="block text-xs font-bold text-red-700 mb-1">إجمالي القطع المعيبة / الكسر</label>
            <input
              type="number"
              value={brokenCount}
              onChange={(e) => setBrokenCount(Number(e.target.value))}
              className="w-full text-center text-lg font-black text-red-600 border border-red-300 rounded-lg py-1"
            />
            <span className="text-xs font-bold text-red-600 block mt-1.5">
              {brokenTons} طن ({brokenPercentage}%)
            </span>
          </div>
        </div>
      </div>

      {/* Comprehensive Defect Taxonomy Breakdown */}
      <div className="bg-rose-50/40 p-4 rounded-xl border border-rose-200 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-rose-950 uppercase flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-rose-600" />
            التصنيف الدقيق للعيوب والهالك (Defect Taxonomy)
          </h3>
          <div className="flex items-center gap-1 text-xs font-bold">
            <span className="text-slate-600">مجموع العيوب:</span>
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
            <span>تنبيه: مجموع تفاصيل العيوب ({sumOfDefects}) لا يطابق إجمالي القطع المعيبة ({brokenCount}). يرجى المراجعة.</span>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">شطف (Shiver)</label>
            <input
              type="number"
              value={shiverDefectCount}
              onChange={(e) => setShiverDefectCount(Number(e.target.value))}
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">شروخ (Crack)</label>
            <input
              type="number"
              value={crackDefectCount}
              onChange={(e) => setCrackDefectCount(Number(e.target.value))}
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">بقع حديد (Iron)</label>
            <input
              type="number"
              value={ironDefectCount}
              onChange={(e) => setIronDefectCount(Number(e.target.value))}
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">شوائب (Inclusions)</label>
            <input
              type="number"
              value={contaminationDefectCount}
              onChange={(e) => setContaminationDefectCount(Number(e.target.value))}
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">حريق فرن (Kiln)</label>
            <input
              type="number"
              value={kilnDefectCount}
              onChange={(e) => setKilnDefectCount(Number(e.target.value))}
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
          </div>

          <div className="bg-white p-3 rounded-xl border border-slate-200">
            <label className="block text-[11px] font-bold text-slate-700 mb-1">مرتجع (Return)</label>
            <input
              type="number"
              value={returnDefectCount}
              onChange={(e) => setReturnDefectCount(Number(e.target.value))}
              className="w-full text-center font-bold text-sm bg-slate-50 border border-slate-300 rounded-lg py-1"
            />
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
          className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-xl shadow-md transition-all cursor-pointer"
        >
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          اعتماد وتسجيل الفرز
        </button>
      </div>
    </form>
  );
};

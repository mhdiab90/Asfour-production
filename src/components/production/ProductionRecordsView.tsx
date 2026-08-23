/**
 * Production Records Management View
 * Features comprehensive filtering (Date, Shift, Press, Product, Customer),
 * real-time aggregate KPI metrics, single record editing, deletion, and Excel export.
 */
import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Search, 
  Filter, 
  Download, 
  Plus, 
  Edit, 
  Trash2, 
  Calendar, 
  Clock, 
  Cpu, 
  Box, 
  Users, 
  RefreshCw, 
  AlertCircle, 
  TrendingDown, 
  TrendingUp, 
  CheckCircle2, 
  X,
  Layers
} from 'lucide-react';
import { ProductionRecord, Shift, Press, Product, Customer, NavigationPage } from '../../types';
import { subscribeProductionRecords, updateProductionRecord, deleteProductionRecord } from '../../services/productionService';
import { fetchMasterData } from '../../services/masterDataService';
import { exportProductionRecordsToExcel } from '../../services/exportService';
import { Badge } from '../common/Badge';
import { Modal } from '../common/Modal';
import { formatNumber, formatDecimal } from '../../utils/formatters';

interface ProductionRecordsViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const ProductionRecordsView: React.FC<ProductionRecordsViewProps> = ({ onNavigate }) => {
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filter Master Lists
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [presses, setPresses] = useState<Press[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Filter Values
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterShift, setFilterShift] = useState<string>('all');
  const [filterPress, setFilterPress] = useState<string>('all');
  const [filterProduct, setFilterProduct] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Modals
  const [editingRecord, setEditingRecord] = useState<ProductionRecord | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [deleteConfirmRecord, setDeleteConfirmRecord] = useState<ProductionRecord | null>(null);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeProductionRecords(
      (data) => {
        setRecords(data);
        setIsLoading(false);
      },
      (err) => {
        console.error('Error loading production records:', err);
        setIsLoading(false);
      }
    );

    fetchMasterData<Shift>('shifts').then(setShifts).catch(() => {});
    fetchMasterData<Press>('presses').then(setPresses).catch(() => {});
    fetchMasterData<Product>('products').then(setProducts).catch(() => {});
    fetchMasterData<Customer>('customers').then(setCustomers).catch(() => {});

    return () => unsubscribe();
  }, []);

  // Filter logic
  const filteredRecords = records.filter((rec) => {
    if (filterShift !== 'all' && rec.shiftId !== filterShift) return false;
    if (filterPress !== 'all' && rec.pressId !== filterPress) return false;
    if (filterProduct !== 'all' && rec.productId !== filterProduct) return false;
    if (startDate && rec.date < startDate) return false;
    if (endDate && rec.date > endDate) return false;

    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      const matchProd = rec.productName?.toLowerCase().includes(q) || rec.productCode?.toLowerCase().includes(q);
      const matchCust = rec.customerName?.toLowerCase().includes(q) || rec.customerOrderNumber?.toLowerCase().includes(q);
      const matchPress = rec.pressName?.toLowerCase().includes(q);
      const matchEmp = rec.employeeNames?.some(name => name.toLowerCase().includes(q));

      if (!matchProd && !matchCust && !matchPress && !matchEmp) return false;
    }

    return true;
  });

  // Calculate live aggregations of filtered list (Factory Standard: TON is primary)
  let totalProductionTons = 0;
  let totalGoodTons = 0;
  let totalWasteTons = 0;
  let missingWeightsCount = 0;

  const totalProductionQuantity = filteredRecords.reduce((sum, r) => sum + (r.productionQuantity || 0), 0);
  const totalGoodQuantity = filteredRecords.reduce((sum, r) => sum + (r.goodQuantity || 0), 0);
  const totalWasteQuantity = filteredRecords.reduce((sum, r) => sum + (r.wasteQuantity || 0), 0);
  const totalProductionWeightKg = filteredRecords.reduce((sum, r) => sum + (r.productionWeight || 0), 0);
  const totalDowntimeMinutes = filteredRecords.reduce((sum, r) => sum + (r.totalDowntimeMinutes || 0), 0);

  filteredRecords.forEach(r => {
    const pWeight = r.pieceWeightKg !== undefined && r.pieceWeightKg !== null 
      ? Number(r.pieceWeightKg) 
      : (r.pieceWeight !== undefined && r.pieceWeight !== null ? Number(r.pieceWeight) : null);
    const hasWeight = pWeight !== null && !isNaN(pWeight) && pWeight > 0;

    if (r.productionTons !== undefined && r.productionTons !== null && r.productionTons > 0) {
      totalProductionTons += Number(r.productionTons);
      totalGoodTons += Number(r.goodTons ?? (r.productionTons - (r.wasteTons || 0)));
      totalWasteTons += Number(r.wasteTons || 0);
    } else if (hasWeight && pWeight !== null) {
      const prodKg = (r.productionQuantity || 0) * pWeight;
      const goodKg = (r.goodQuantity || 0) * pWeight;
      const wasteKg = (r.wasteQuantity || 0) * pWeight;
      totalProductionTons += (prodKg / 1000);
      totalGoodTons += (goodKg / 1000);
      totalWasteTons += (wasteKg / 1000);
    } else if ((r.productionQuantity || 0) > 0) {
      missingWeightsCount += 1;
    }
  });

  const averageWastePercentage = totalProductionTons > 0 
    ? Number(((totalWasteTons / totalProductionTons) * 100).toFixed(2))
    : (totalProductionQuantity > 0 ? Number(((totalWasteQuantity / totalProductionQuantity) * 100).toFixed(2)) : 0);

  const handleOpenEdit = (rec: ProductionRecord) => {
    setEditingRecord({ ...rec });
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord || !editingRecord.id) return;
    setIsUpdating(true);
    try {
      await updateProductionRecord(editingRecord.id, editingRecord);
      setIsEditModalOpen(false);
      setEditingRecord(null);
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء تعديل السجل.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmRecord || !deleteConfirmRecord.id) return;
    try {
      await deleteProductionRecord(
        deleteConfirmRecord.id,
        `${deleteConfirmRecord.date} - ${deleteConfirmRecord.productName} (${deleteConfirmRecord.pressName})`
      );
      setDeleteConfirmRecord(null);
    } catch (err) {
      console.error('Error deleting record:', err);
    }
  };

  const handleExport = () => {
    exportProductionRecordsToExcel(filteredRecords, `سجلات_إنتاج_عصفور_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const clearFilters = () => {
    setSearchQuery('');
    setFilterShift('all');
    setFilterPress('all');
    setFilterProduct('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="space-y-6">
      {/* Top Filter & Control Panel */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </div>
            <input
              id="records-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="البحث بالمنتج، الكود، المكبس، العميل، أو العامل..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl pr-9 pl-4 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-amber-500 focus:bg-white transition-colors"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              id="export-records-btn"
              type="button"
              onClick={handleExport}
              disabled={filteredRecords.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تصدير إلى Excel</span>
            </button>

            <button
              id="new-production-entry-btn"
              type="button"
              onClick={() => onNavigate('production-entry')}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>تسجيل إنتاج جديد</span>
            </button>
          </div>
        </div>

        {/* Dropdown Filters */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 pt-2 border-t border-slate-100 text-xs">
          {/* Shift */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">الوردية</label>
            <select
              value={filterShift}
              onChange={(e) => setFilterShift(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-700"
            >
              <option value="all">كل الورديات</option>
              {shifts.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* Press */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">المكبس</label>
            <select
              value={filterPress}
              onChange={(e) => setFilterPress(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-700"
            >
              <option value="all">كل المكابس</option>
              {presses.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Product */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">المنتج الحراري</label>
            <select
              value={filterProduct}
              onChange={(e) => setFilterProduct(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 font-semibold text-slate-700"
            >
              <option value="all">كل المنتجات</option>
              {products.map(pr => (
                <option key={pr.id} value={pr.id}>{pr.name}</option>
              ))}
            </select>
          </div>

          {/* Start Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">من تاريخ</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-slate-700"
            />
          </div>

          {/* End Date */}
          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">إلى تاريخ</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-1 text-slate-700"
            />
          </div>
        </div>

        {/* Clear filter shortcut */}
        {(searchQuery || filterShift !== 'all' || filterPress !== 'all' || filterProduct !== 'all' || startDate || endDate) && (
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-amber-700 hover:text-amber-900 font-bold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>إعادة ضبط وتفريغ الفلاتر</span>
            </button>
          </div>
        )}
      </div>

      {/* Aggregate KPI Strip for Filtered Results */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">إجمالي الإنتاج المكبوس</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-slate-900">
              {formatNumber(totalProductionQuantity)}
            </span>
            <span className="text-xs text-slate-500">قطعة</span>
          </div>
          <span className="text-[10px] text-emerald-600 font-semibold mt-0.5 block">
            سليم: {formatNumber(totalGoodQuantity)} قطعة
          </span>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">إجمالي الوزن المحسوب</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-slate-900">
              {formatDecimal(totalProductionWeightKg / 1000, 2)}
            </span>
            <span className="text-xs text-slate-500">طن</span>
          </div>
          <span className="text-[10px] text-slate-400 font-semibold mt-0.5 block">
            ({formatNumber(totalProductionWeightKg)} كجم)
          </span>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">متوسط نسبة الهالك</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className={`text-xl font-extrabold ${averageWastePercentage > 5 ? 'text-rose-600' : 'text-amber-600'}`}>
              {formatDecimal(averageWastePercentage, 2)}%
            </span>
          </div>
          <span className="text-[10px] text-rose-600 font-semibold mt-0.5 block">
            هالك: {formatNumber(totalWasteQuantity)} قطعة
          </span>
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-xs">
          <span className="text-[11px] font-bold text-slate-500 block">إجمالي وقت التوقف (الأعطال)</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl font-extrabold text-slate-900">
              {(totalDowntimeMinutes / 60).toFixed(1)}
            </span>
            <span className="text-xs text-slate-500">ساعة</span>
          </div>
          <span className="text-[10px] text-slate-500 font-semibold mt-0.5 block">
            ({totalDowntimeMinutes} دقيقة)
          </span>
        </div>
      </div>

      {/* Production Records Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="py-16 text-center text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-amber-500" />
            <p className="text-xs font-semibold">جارٍ تحميل سجلات الإنتاج من Firestore...</p>
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-sm font-bold text-slate-700">لا توجد سجلات مطابقة للشروط المحددة</p>
            <p className="text-xs text-slate-400 mt-1">
              يمكنك الضغط على زر "تسجيل إنتاج جديد" لإضافة أول تشغيلة.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
                <tr>
                  <th className="px-4 py-3.5">التاريخ والوردية</th>
                  <th className="px-4 py-3.5">المكبس / الفرن</th>
                  <th className="px-4 py-3.5">المنتج والمواصفة</th>
                  <th className="px-4 py-3.5">فريق التشغيل</th>
                  <th className="px-4 py-3.5">الكمية (إجمالي / سليم)</th>
                  <th className="px-4 py-3.5">الهالك (%)</th>
                  <th className="px-4 py-3.5">إجمالي الوزن</th>
                  <th className="px-4 py-3.5">التوقف</th>
                  <th className="px-4 py-3.5 text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredRecords.map((rec) => (
                  <tr key={rec.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900 font-mono">{rec.date}</div>
                      <div className="text-[11px] text-slate-500">{rec.shiftName}</div>
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">{rec.pressName}</div>
                      {rec.furnaceName && (
                        <div className="text-[11px] text-slate-500">{rec.furnaceName}</div>
                      )}
                      {rec.furnaceCarNumbers && rec.furnaceCarNumbers.length > 0 && (
                        <div className="text-[10px] text-amber-700 font-mono">
                          عربات: {rec.furnaceCarNumbers.join(', ')}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{rec.productName}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.2 rounded font-mono">
                          {rec.aluminaPercentage}% ألومينا
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {rec.pieceWeight} كجم
                        </span>
                      </div>
                      {rec.customerName && (
                        <div className="text-[11px] text-sky-700 font-semibold mt-0.5">
                          عميل: {rec.customerName}
                        </div>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      {rec.employeeNames && rec.employeeNames.length > 0 ? (
                        <div className="space-y-0.5">
                          {rec.employeeNames.map((name, i) => (
                            <span key={i} className="inline-block bg-slate-100 px-2 py-0.5 rounded text-[10px] font-semibold text-slate-700 mr-1 mb-1">
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="font-extrabold text-slate-900">
                        {formatNumber(rec.productionQuantity)}
                      </div>
                      <div className="text-[11px] text-emerald-600 font-semibold">
                        سليم: {formatNumber(rec.goodQuantity)}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      <div className={`font-bold ${rec.wastePercentage > 5 ? 'text-rose-600' : 'text-amber-600'}`}>
                        {formatDecimal(rec.wastePercentage, 2)}%
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {formatNumber(rec.wasteQuantity)} قطعة
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {(() => {
                        const pWeight = rec.pieceWeightKg ?? rec.pieceWeight ?? null;
                        const hasWeight = pWeight !== null && !isNaN(pWeight) && Number(pWeight) > 0;
                        const prodTons = rec.productionTons !== undefined && rec.productionTons !== null && Number(rec.productionTons) > 0
                          ? Number(rec.productionTons)
                          : (hasWeight ? (Number(rec.productionQuantity || 0) * Number(pWeight)) / 1000 : null);
                        
                        if (prodTons !== null) {
                          return (
                            <>
                              <div className="font-extrabold text-slate-900">
                                {formatDecimal(prodTons, 3)} طن
                              </div>
                              <div className="text-[10px] text-slate-400 font-mono">
                                {formatNumber(rec.productionWeight || prodTons * 1000)} كجم
                              </div>
                            </>
                          );
                        }
                        return (
                          <div className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded text-[11px] font-bold border border-amber-200 inline-block">
                            غير محسوب
                            <div className="text-[9px] font-normal text-amber-600">وزن القطعة غير متوفر</div>
                          </div>
                        );
                      })()}
                    </td>

                    <td className="px-4 py-3 font-mono">
                      {rec.totalDowntimeMinutes > 0 ? (
                        <span className="text-rose-700 font-bold bg-rose-50 px-2 py-0.5 rounded">
                          {rec.totalDowntimeMinutes} د
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-semibold">0 د</span>
                      )}
                    </td>

                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(rec)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                          title="تعديل"
                        >
                          <Edit className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmRecord(rec)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title="حذف"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit Record Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        title="تعديل سجل الإنتاج"
        subtitle="يتم تحديث وإعادة حساب الأوزان ونسب الهالك تلقائياً في Firestore"
        maxWidth="lg"
      >
        {editingRecord && (
          <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">تاريخ الإنتاج</label>
                <input
                  type="date"
                  required
                  value={editingRecord.date || ''}
                  onChange={(e) => setEditingRecord({ ...editingRecord, date: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">وزن القطعة (كجم)</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={editingRecord.pieceWeight ?? 4.5}
                  onChange={(e) => setEditingRecord({ ...editingRecord, pieceWeight: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 mb-1">إجمالي كمية الإنتاج (قطع)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={editingRecord.productionQuantity ?? 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, productionQuantity: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">كمية الهالك (قطع)</label>
                <input
                  type="number"
                  required
                  min="0"
                  value={editingRecord.wasteQuantity ?? 0}
                  onChange={(e) => setEditingRecord({ ...editingRecord, wasteQuantity: Number(e.target.value) })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-bold text-rose-600"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">ملاحظات التشغيل</label>
              <input
                type="text"
                value={editingRecord.notes || ''}
                onChange={(e) => setEditingRecord({ ...editingRecord, notes: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={isUpdating}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl shadow-xs flex items-center gap-1.5"
              >
                {isUpdating ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Record Confirmation Modal */}
      <Modal
        isOpen={!!deleteConfirmRecord}
        onClose={() => setDeleteConfirmRecord(null)}
        title="تأكيد حذف سجل الإنتاج"
        maxWidth="sm"
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            هل أنت متأكد من رغبتك في حذف سجل تشغيلة بتاريخ <span className="font-bold text-slate-900">{deleteConfirmRecord?.date}</span> لمنتج <span className="font-bold text-slate-900">{deleteConfirmRecord?.productName}</span>؟
          </p>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeleteConfirmRecord(null)}
              className="px-3.5 py-2 font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
            >
              إلغاء
            </button>
            <button
              id="confirm-delete-record-btn"
              type="button"
              onClick={handleDelete}
              className="px-4 py-2 font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl shadow-xs cursor-pointer"
            >
              تأكيد الحذف
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

/**
 * Industrial Analytical Reports View
 * Aggregates production and downtime data across multiple dimensions (Product, Press, Shift, Customer),
 * displays comparative charts and offers multi-format Excel reporting.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, 
  Download, 
  Calendar, 
  Printer, 
  Layers, 
  Box, 
  Cpu, 
  Clock, 
  Building, 
  TrendingUp, 
  Filter,
  CheckCircle2
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  Legend 
} from 'recharts';
import { ProductionRecord, NavigationPage } from '../../types';
import { subscribeProductionRecords } from '../../services/productionService';
import { exportProductionRecordsToExcel } from '../../services/exportService';
import { Badge } from '../common/Badge';
import { formatNumber, formatDecimal, formatPercentage } from '../../utils/formatters';

interface ReportsViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const ReportsView: React.FC<ReportsViewProps> = ({ onNavigate }) => {
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [groupBy, setGroupBy] = useState<'product' | 'press' | 'shift' | 'customer'>('product');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  useEffect(() => {
    const unsubscribe = subscribeProductionRecords(
      (data) => setRecords(data),
      (err) => console.error('Error fetching records for reports:', err)
    );
    return () => unsubscribe();
  }, []);

  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (startDate && r.date < startDate) return false;
      if (endDate && r.date > endDate) return false;
      return true;
    });
  }, [records, startDate, endDate]);

  // Grouped aggregated data
  const reportData = useMemo(() => {
    const map: Record<string, {
      key: string;
      label: string;
      totalQuantity: number;
      goodQuantity: number;
      wasteQuantity: number;
      weightKg: number;
      weightTon: number;
      downtimeMinutes: number;
      wastePercentage: number;
      operationsCount: number;
    }> = {};

    filteredRecords.forEach((r) => {
      let key = '';
      let label = '';

      if (groupBy === 'product') {
        key = r.productId || r.productName || 'غير محدد';
        label = r.productName || 'منتج غير محدد';
      } else if (groupBy === 'press') {
        key = r.pressId || r.pressName || 'غير محدد';
        label = r.pressName || 'مكبس غير محدد';
      } else if (groupBy === 'shift') {
        key = r.shiftId || r.shiftName || 'غير محدد';
        label = r.shiftName || 'وردية غير محددة';
      } else if (groupBy === 'customer') {
        key = r.customerId || r.customerName || 'عام';
        label = r.customerName || 'مبيعات عامة';
      }

      if (!map[key]) {
        map[key] = {
          key,
          label,
          totalQuantity: 0,
          goodQuantity: 0,
          wasteQuantity: 0,
          weightKg: 0,
          weightTon: 0,
          downtimeMinutes: 0,
          wastePercentage: 0,
          operationsCount: 0,
        };
      }

      map[key].totalQuantity += r.productionQuantity || 0;
      map[key].goodQuantity += r.goodQuantity || 0;
      map[key].wasteQuantity += r.wasteQuantity || 0;
      map[key].weightKg += r.productionWeight || 0;
      map[key].downtimeMinutes += r.totalDowntimeMinutes || 0;
      map[key].operationsCount += 1;
    });

    return Object.values(map).map((item) => ({
      ...item,
      weightTon: Number((item.weightKg / 1000).toFixed(2)),
      wastePercentage: item.totalQuantity > 0 
        ? Number(((item.wasteQuantity / item.totalQuantity) * 100).toFixed(2)) 
        : 0,
    })).sort((a, b) => b.weightTon - a.weightTon);
  }, [filteredRecords, groupBy]);

  const handleExport = () => {
    exportProductionRecordsToExcel(filteredRecords, `تقرير_تحليلي_عصفور_${groupBy}_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Report Header & Filter Controls */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-amber-500" />
            <span>التقارير التحليلية المجمعة وإحصائيات الكفاءة</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            تجميع وحساب مؤشرات الإنتاج والهالك والتوقفات حسب الأبعاد التشغيلية
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 self-stretch md:self-auto">
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>طباعة التقرير</span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={filteredRecords.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تصدير Excel كامل</span>
          </button>
        </div>
      </div>

      {/* Grouping & Date Filter Selector */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Dimension Pills */}
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl text-xs font-bold">
          <span className="text-slate-500 px-2">تجميع حسب:</span>
          <button
            type="button"
            onClick={() => setGroupBy('product')}
            className={`px-3 py-1.5 rounded-lg cursor-pointer ${groupBy === 'product' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
          >
            المنتج الحراري
          </button>
          <button
            type="button"
            onClick={() => setGroupBy('press')}
            className={`px-3 py-1.5 rounded-lg cursor-pointer ${groupBy === 'press' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
          >
            المكبس
          </button>
          <button
            type="button"
            onClick={() => setGroupBy('shift')}
            className={`px-3 py-1.5 rounded-lg cursor-pointer ${groupBy === 'shift' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
          >
            الوردية
          </button>
          <button
            type="button"
            onClick={() => setGroupBy('customer')}
            className={`px-3 py-1.5 rounded-lg cursor-pointer ${groupBy === 'customer' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'}`}
          >
            العميل
          </button>
        </div>

        {/* Date Ranges */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-500 font-bold">الفترة:</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs"
          />
          <span className="text-slate-400">إلى</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1 text-xs"
          />
        </div>
      </div>

      {/* Comparative Chart */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-sm font-bold text-slate-900">
            مقارنة كميات الإنتاج السليم مقابل الهالك (قطع)
          </h3>
          <Badge variant="indigo">تحليل مقارن</Badge>
        </div>

        <div className="h-72 w-full">
          {reportData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              لا توجد سجلات مطابقة للرسم البياني
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reportData} margin={{ top: 20, right: 10, left: 10, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '8px', color: '#fff', fontSize: '11px', border: 'none' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                <Bar dataKey="goodQuantity" name="الإنتاج السليم (قطع)" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="wasteQuantity" name="الهالك / التالف (قطع)" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Aggregate Report Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <h4 className="text-xs font-extrabold text-slate-800">
            جدول النتائج المجمعة ({reportData.length} عنصر)
          </h4>
          <span className="text-[11px] text-slate-500">
            إجمالي العمليات المشمولة: {filteredRecords.length} تشغيلة
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-700 font-bold">
              <tr>
                <th className="px-4 py-3">البيان / الفئة</th>
                <th className="px-4 py-3">عدد التشغيلات</th>
                <th className="px-4 py-3">إجمالي الإنتاج</th>
                <th className="px-4 py-3">الإنتاج السليم</th>
                <th className="px-4 py-3">الهالك</th>
                <th className="px-4 py-3">نسبة الهالك (%)</th>
                <th className="px-4 py-3">الوزن الكلي (طن)</th>
                <th className="px-4 py-3">أوقات التوقف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
              {reportData.map((row) => (
                <tr key={row.key} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-bold text-slate-900">{row.label}</td>
                  <td className="px-4 py-3 font-mono">{formatNumber(row.operationsCount)}</td>
                  <td className="px-4 py-3 font-extrabold text-slate-900">{formatNumber(row.totalQuantity)}</td>
                  <td className="px-4 py-3 font-bold text-emerald-600">{formatNumber(row.goodQuantity)}</td>
                  <td className="px-4 py-3 font-bold text-rose-600">{formatNumber(row.wasteQuantity)}</td>
                  <td className="px-4 py-3">
                    <span className={`font-bold ${row.wastePercentage > 5 ? 'text-rose-600' : 'text-amber-600'}`}>
                      {formatDecimal(row.wastePercentage, 2)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono font-extrabold text-slate-900">{formatDecimal(row.weightTon, 2)} طن</td>
                  <td className="px-4 py-3 font-mono text-slate-600">{formatNumber(row.downtimeMinutes)} دقيقة</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

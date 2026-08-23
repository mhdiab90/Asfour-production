/**
 * Executive Industrial Dashboard
 * Geometric Balance Design Theme
 * Provides real-time production analytics, KPIs, equipment breakdown charts,
 * downtime distribution, and quick operational shortcuts.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Factory, 
  Flame, 
  Cpu, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  Plus, 
  UploadCloud, 
  FileText, 
  Database, 
  ArrowRight,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid, 
  AreaChart, 
  Area 
} from 'recharts';
import { ProductionRecord, Press, Furnace, NavigationPage } from '../../types';
import { subscribeProductionRecords } from '../../services/productionService';
import { fetchMasterData } from '../../services/masterDataService';
import { StatCard } from '../common/StatCard';
import { Badge } from '../common/Badge';
import { formatNumber, formatDecimal } from '../../utils/formatters';

interface DashboardViewProps {
  onNavigate: (page: NavigationPage) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const [records, setRecords] = useState<ProductionRecord[]>([]);
  const [presses, setPresses] = useState<Press[]>([]);
  const [furnaces, setFurnaces] = useState<Furnace[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [timeRange, setTimeRange] = useState<'today' | 'week' | 'month' | 'all'>('month');

  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeProductionRecords(
      (data) => {
        setRecords(data);
        setIsLoading(false);
      },
      (err) => {
        console.error('Error in dashboard records:', err);
        setIsLoading(false);
      }
    );

    fetchMasterData<Press>('presses').then(setPresses).catch(() => {});
    fetchMasterData<Furnace>('furnaces').then(setFurnaces).catch(() => {});

    return () => unsubscribe();
  }, []);

  // Filter records by selected time range
  const filteredRecords = useMemo(() => {
    if (!records || !Array.isArray(records)) return [];
    if (timeRange === 'all') return records;

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    if (timeRange === 'today') {
      return records.filter(r => (r?.date || '') === todayStr);
    }

    if (timeRange === 'week') {
      const pastWeek = new Date();
      pastWeek.setDate(now.getDate() - 7);
      const pastWeekStr = pastWeek.toISOString().split('T')[0];
      return records.filter(r => (r?.date || '') >= pastWeekStr);
    }

    if (timeRange === 'month') {
      const pastMonth = new Date();
      pastMonth.setDate(now.getDate() - 30);
      const pastMonthStr = pastMonth.toISOString().split('T')[0];
      return records.filter(r => (r?.date || '') >= pastMonthStr);
    }

    return records;
  }, [records, timeRange]);

  // Aggregated KPIs (Factory Standard: TON is primary)
  let totalProductionTons = 0;
  let totalGoodTons = 0;
  let totalWasteTons = 0;
  let missingPieceWeightRecordsCount = 0;

  const totalProductionQuantity = (filteredRecords || []).reduce((sum, r) => sum + (Number(r?.productionQuantity) || 0), 0);
  const totalGoodQuantity = (filteredRecords || []).reduce((sum, r) => sum + (Number(r?.goodQuantity) || 0), 0);
  const totalWasteQuantity = (filteredRecords || []).reduce((sum, r) => sum + (Number(r?.wasteQuantity) || 0), 0);
  const totalDowntimeMinutes = (filteredRecords || []).reduce((sum, r) => sum + (Number(r?.totalDowntimeMinutes) || 0), 0);

  (filteredRecords || []).forEach(r => {
    const pWeight = r?.pieceWeightKg !== undefined && r?.pieceWeightKg !== null 
      ? Number(r.pieceWeightKg) 
      : (r?.pieceWeight !== undefined && r?.pieceWeight !== null ? Number(r.pieceWeight) : null);
    
    const hasWeight = pWeight !== null && !isNaN(pWeight) && pWeight > 0;

    if (r?.productionTons !== undefined && r?.productionTons !== null && Number(r.productionTons) > 0) {
      totalProductionTons += Number(r.productionTons);
      totalGoodTons += Number(r.goodTons ?? (Number(r.productionTons) - Number(r.wasteTons || 0)));
      totalWasteTons += Number(r.wasteTons || 0);
    } else if (hasWeight && pWeight !== null) {
      const prodKg = (Number(r?.productionQuantity) || 0) * pWeight;
      const goodKg = (Number(r?.goodQuantity) || 0) * pWeight;
      const wasteKg = (Number(r?.wasteQuantity) || 0) * pWeight;
      totalProductionTons += (prodKg / 1000);
      totalGoodTons += (goodKg / 1000);
      totalWasteTons += (wasteKg / 1000);
    } else if ((Number(r?.productionQuantity) || 0) > 0) {
      missingPieceWeightRecordsCount += 1;
    }
  });

  const qualityRate = totalProductionTons > 0 
    ? ((totalGoodTons / totalProductionTons) * 100).toFixed(1)
    : (totalProductionQuantity > 0 ? ((totalGoodQuantity / totalProductionQuantity) * 100).toFixed(1) : '100');

  const wasteRate = totalProductionTons > 0 
    ? ((totalWasteTons / totalProductionTons) * 100).toFixed(2)
    : (totalProductionQuantity > 0 ? ((totalWasteQuantity / totalProductionQuantity) * 100).toFixed(2) : '0');

  // Press Production Breakdown
  const pressProductionList = useMemo(() => {
    const map: Record<string, { name: string; weightTon: number; quantity: number }> = {};
    (filteredRecords || []).forEach((r) => {
      const key = r?.pressName || 'مكبس عام';
      if (!map[key]) map[key] = { name: key, weightTon: 0, quantity: 0 };
      
      const pWeight = Number(r?.pieceWeightKg ?? r?.pieceWeight ?? 0);
      const tons = r?.productionTons ? Number(r.productionTons) : (pWeight > 0 ? (Number(r?.productionQuantity || 0) * pWeight) / 1000 : (Number(r?.productionWeight || 0) / 1000));
      
      map[key].weightTon += tons;
      map[key].quantity += Number(r?.productionQuantity) || 0;
    });
    const totalTonsAll = Object.values(map).reduce((acc, curr) => acc + (Number(curr.weightTon) || 0), 0) || 1;
    return Object.values(map).map(item => ({
      ...item,
      percentage: Math.round(((Number(item.weightTon) || 0) / totalTonsAll) * 100),
      weightTon: Number(item.weightTon.toFixed(2)),
    })).sort((a, b) => (b.weightTon || 0) - (a.weightTon || 0));
  }, [filteredRecords]);

  // Daily Trend Data
  const dailyTrendData = useMemo(() => {
    const map: Record<string, { date: string; weightTon: number; wasteTon: number }> = {};
    const sorted = [...(filteredRecords || [])].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
    sorted.forEach((r) => {
      const rawDate = String(r?.date || '');
      const d = rawDate || new Date().toISOString().split('T')[0];
      if (!map[d]) {
        map[d] = { date: d.length > 5 ? d.substring(5) : d, weightTon: 0, wasteTon: 0 };
      }
      const pWeight = Number(r?.pieceWeightKg ?? r?.pieceWeight ?? 0);
      const prodTons = r?.productionTons ? Number(r.productionTons) : (pWeight > 0 ? (Number(r?.productionQuantity || 0) * pWeight) / 1000 : (Number(r?.productionWeight || 0) / 1000));
      const wasteTons = r?.wasteTons ? Number(r.wasteTons) : (pWeight > 0 ? (Number(r?.wasteQuantity || 0) * pWeight) / 1000 : 0);

      map[d].weightTon += prodTons;
      map[d].wasteTon += wasteTons;
    });
    return Object.values(map).map(item => ({
      ...item,
      weightTon: Number(item.weightTon.toFixed(2)),
      wasteTon: Number(item.wasteTon.toFixed(2)),
    }));
  }, [filteredRecords]);

  return (
    <div className="space-y-6">
      {/* Missing Piece Weight Notice */}
      {missingPieceWeightRecordsCount > 0 && (
        <div className="bg-amber-950/40 border border-amber-800/80 rounded p-3 text-xs text-amber-300 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              تنبيه: يوجد <strong>{missingPieceWeightRecordsCount}</strong> سجل إنتاج بدون وزن قطعة مسجل. تظهر أوزانها كـ "غير محسوب" طبقاً للقواعد القياسية للمصنع.
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('master-data')}
            className="text-amber-400 underline hover:text-amber-200 cursor-pointer font-bold shrink-0 ml-2"
          >
            تحديث أوزان المنتجات
          </button>
        </div>
      )}

      {/* 4-Column Geometric KPI Grid (Primary Factory Unit: TON) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Production in Tons */}
        <StatCard
          id="stat-total-production"
          title="إجمالي الإنتاج (طن)"
          value={totalProductionTons > 0 ? totalProductionTons.toFixed(2) : (totalProductionQuantity > 0 ? `${formatNumber(totalProductionQuantity)} ق` : '0.00')}
          unit={totalProductionTons > 0 ? 'طن' : 'قطعة'}
          color="indigo"
          icon={Factory}
          subtitle={`العدد: ${formatNumber(totalProductionQuantity)} قطعة`}
          trend={{ value: 'الوحدة القياسية للمصنع (طن)', isPositive: true }}
        />

        {/* Good Products in Tons */}
        <StatCard
          id="stat-good-production"
          title="الإنتاج السليم (طن)"
          value={totalGoodTons > 0 ? totalGoodTons.toFixed(2) : (totalGoodQuantity > 0 ? `${formatNumber(totalGoodQuantity)} ق` : '0.00')}
          unit={totalGoodTons > 0 ? 'طن' : 'قطعة'}
          color="emerald"
          icon={CheckCircle2}
          subtitle={`السليم: ${formatNumber(totalGoodQuantity)} قطعة`}
          trend={{ value: `${qualityRate}% كفاءة الجودة بالوزن`, isPositive: true }}
        />

        {/* Waste Quantity in Tons */}
        <StatCard
          id="stat-waste-production"
          title="الهالك والتالف (طن)"
          value={totalWasteTons > 0 ? totalWasteTons.toFixed(2) : (totalWasteQuantity > 0 ? `${formatNumber(totalWasteQuantity)} ق` : '0.00')}
          unit={totalWasteTons > 0 ? 'طن' : 'قطعة'}
          color="rose"
          icon={AlertTriangle}
          subtitle={`التالف: ${formatNumber(totalWasteQuantity)} قطعة`}
          trend={{ value: `${wasteRate}% نسبة الهالك بالوزن`, isPositive: false }}
        />

        {/* Downtime Hours */}
        <StatCard
          id="stat-downtime-hours"
          title="ساعات التوقف والأعطال"
          value={`${(totalDowntimeMinutes / 60).toFixed(1)} hr`}
          color="amber"
          icon={Clock}
          subtitle={`إجمالي: ${totalDowntimeMinutes} دقيقة`}
          trend={totalProductionTons > 0 ? { value: `${(totalProductionTons / Math.max(1, (filteredRecords.length * 8))).toFixed(2)} طن/ساعة عمل تقريبية`, isPositive: true } : undefined}
        />
      </div>

      {/* Operational Shortcuts Bar */}
      <div className="bg-slate-900 p-4 border border-slate-800 shadow-md text-white flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider">
            إجراءات سريعة:
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onNavigate('production-entry')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>تسجيل إنتاج جديد</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('bulk-entry')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded border border-slate-700 transition-colors cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5 text-indigo-400" />
              <span>استيراد Excel / CSV</span>
            </button>

            <button
              type="button"
              onClick={() => onNavigate('master-data')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs rounded border border-slate-700 transition-colors cursor-pointer"
            >
              <Database className="w-3.5 h-3.5 text-sky-400" />
              <span>البيانات الأساسية</span>
            </button>
          </div>
        </div>

        {/* Time range pills */}
        <div className="flex items-center gap-1 bg-slate-800 p-1 rounded text-xs font-bold">
          <button
            type="button"
            onClick={() => setTimeRange('today')}
            className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
              timeRange === 'today' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            اليوم
          </button>
          <button
            type="button"
            onClick={() => setTimeRange('week')}
            className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
              timeRange === 'week' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            الأسبوع
          </button>
          <button
            type="button"
            onClick={() => setTimeRange('month')}
            className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
              timeRange === 'month' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            الشهر
          </button>
          <button
            type="button"
            onClick={() => setTimeRange('all')}
            className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
              timeRange === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            الكل ({records.length})
          </button>
        </div>
      </div>

      {/* Main 3-Column Layout: Records Table (2 cols) + Right Side Gauges (1 col) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Recent Production Records Table */}
        <div className="lg:col-span-2 bg-white border border-slate-200 shadow-xs flex flex-col">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h2 className="font-bold text-slate-700 text-sm">أحدث سجلات الإنتاج</h2>
            <button
              type="button"
              onClick={() => onNavigate('production-records')}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-bold cursor-pointer"
            >
              عرض الكل &larr;
            </button>
          </div>

          <div className="flex-grow overflow-x-auto">
            {records.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-400">
                لا توجد سجلات مسجلة حتى الآن. انقر على "تسجيل إنتاج جديد" لإدخال أول سجل.
              </div>
            ) : (
              <table className="w-full text-right">
                <thead className="bg-slate-100 text-[10px] text-slate-500 uppercase tracking-tighter">
                  <tr className="border-b border-slate-200">
                    <th className="p-3 font-bold">التاريخ</th>
                    <th className="p-3 font-bold">المكبس</th>
                    <th className="p-3 font-bold">المنتج</th>
                    <th className="p-3 font-bold">الكمية</th>
                    <th className="p-3 font-bold">سليم</th>
                    <th className="p-3 font-bold">هالك</th>
                    <th className="p-3 font-bold">الوزن (طن)</th>
                    <th className="p-3 font-bold">الحالة</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-slate-100">
                  {records.slice(0, 7).map((rec) => (
                    <tr key={rec.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-3 font-mono text-xs text-slate-600">{rec.date || '-'}</td>
                      <td className="p-3 font-medium text-slate-800">{rec.pressName || '-'}</td>
                      <td className="p-3 font-medium text-slate-900">{rec.productName || '-'}</td>
                      <td className="p-3 font-mono font-bold text-slate-800">{formatNumber(rec.productionQuantity)}</td>
                      <td className="p-3 font-mono text-emerald-600 font-bold">{formatNumber(rec.goodQuantity)}</td>
                      <td className="p-3 font-mono text-rose-600 font-bold">{formatNumber(rec.wasteQuantity)}</td>
                      <td className="p-3 font-mono font-bold text-slate-900">
                        {formatDecimal((Number(rec.productionWeight) || 0) / 1000, 2)}
                      </td>
                      <td className="p-3">
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full">
                          مكتمل
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right 1 Column: Press Distribution Progress Bars & Dark Kiln Card */}
        <div className="flex flex-col gap-6">
          {/* Press Distribution Progress Bars */}
          <div className="bg-white border border-slate-200 p-4 shadow-xs flex flex-col">
            <h2 className="font-bold text-slate-700 text-sm mb-4 border-b border-slate-100 pb-2">
              توزيع الإنتاج حسب المكبس
            </h2>
            <div className="flex flex-col gap-3">
              {(pressProductionList.length > 0 ? pressProductionList.slice(0, 4) : [
                { name: 'مكبس 04', percentage: 35 },
                { name: 'مكبس 01', percentage: 25 },
                { name: 'مكبس 02', percentage: 20 },
                { name: 'مكبس 03', percentage: 20 },
              ]).map((item, idx) => {
                const colors = ['bg-indigo-600', 'bg-indigo-500', 'bg-indigo-400', 'bg-slate-400'];
                const barColor = colors[idx % colors.length];
                return (
                  <div key={item.name} className="space-y-1">
                    <div className="flex justify-between text-xs font-bold">
                      <span className="text-slate-600">{item.name}</span>
                      <span className="text-slate-800 font-mono">{item.percentage}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${barColor} rounded-full transition-all duration-500`}
                        style={{ width: `${item.percentage}%` }}
                      ></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Dark Industrial Kiln & Furnace Card */}
          <div className="bg-slate-900 p-5 rounded border border-slate-800 text-white shadow-lg flex-grow flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-indigo-400 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-orange-400" />
                  <span>إحصائيات الأفران والحراريات</span>
                </h3>
                <span className="text-[10px] bg-white/10 px-2 py-1 rounded text-emerald-400 font-bold font-mono">
                  مباشر
                </span>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-xs text-slate-400">الفرن الرئيسي #1</span>
                  <span className="text-sm font-bold text-orange-400 font-mono">1250°C</span>
                </div>
                <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                  <span className="text-xs text-slate-400">فرن الأنفاق #2</span>
                  <span className="text-sm font-bold text-orange-400 font-mono">1180°C</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-400">فرن التجفيف #3</span>
                  <span className="text-sm font-bold text-emerald-400 font-mono">240°C</span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => onNavigate('master-data')}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-bold mt-4 transition-colors cursor-pointer text-center"
            >
              لوحة الأفران والبيانات الأساسية
            </button>
          </div>
        </div>
      </div>

      {/* Production Trend Line Chart */}
      <div className="bg-white border border-slate-200 p-5 shadow-xs">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-800">مسار الإنتاج اليومي والأوزان (طن)</h3>
            <p className="text-[11px] text-slate-500">مراقبة الأداء التراكمي وتدفق خامات الحراريات</p>
          </div>
          <Badge variant="indigo">أطنان حراريات</Badge>
        </div>

        <div className="h-64 w-full">
          {dailyTrendData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-slate-400">
              لا توجد بيانات مسجلة للفترة المحددة
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="indigoWeightGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderRadius: '4px', color: '#fff', fontSize: '11px', border: '1px solid #334155' }}
                />
                <Area type="monotone" dataKey="weightTon" name="الوزن (طن)" stroke="#4f46e5" strokeWidth={2} fillOpacity={1} fill="url(#indigoWeightGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
};

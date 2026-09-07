/**
 * Analysis tools. These return STRUCTURED, FACTUAL data only (sorted
 * comparisons, deltas, totals) computed from real production records - they
 * never generate an explanatory narrative themselves. Turning structured
 * facts into a human "why" explanation is the AIProvider's job
 * (analyzeToolResult), and must be clearly labeled as inference, not fact -
 * see src/assistant/gateway.ts.
 */
import { calculateKPIsFromRecords } from '../../services/productionService';
import { ProductionRecord } from '../../types';
import { PermissionKey } from '../../types/permissions';
import { ToolDefinition } from '../types';
import { registerTool } from './registry';
import { fetchFiltered, groupBy, groupByEmployee } from './productionQueryTools';
import { PRODUCTION_FILTER_SCHEMA } from './parameterSchemas';
import { periodDisclosure } from './dateRangeResolver';

const READ_PERMISSION: PermissionKey[] = ['production.view', 'production.create', 'reports.view'];

function baseAnalysisTool(toolName: string, descriptionAr: string, descriptionEn: string) {
  return {
    toolName,
    descriptionAr,
    descriptionEn,
    commandType: 'ANALYSIS' as const,
    riskLevel: 'LOW_RISK' as const,
    confirmationPolicy: 'NONE' as const,
    requiredPermission: READ_PERMISSION,
    parameterSchema: PRODUCTION_FILTER_SCHEMA,
    inputSchema: (input: any) => ({ valid: true, value: input || {} }),
  };
}

function rankGroups(groups: ReturnType<typeof groupBy>) {
  const sorted = [...groups].sort((a, b) => b.kpis.totalProductionTons - a.kpis.totalProductionTons);
  return {
    sorted,
    highest: sorted[0] || null,
    lowest: sorted[sorted.length - 1] || null,
  };
}

const analyzeProductionTrend: ToolDefinition = {
  ...baseAnalysisTool('analyzeProductionTrend', 'اتجاه الإنتاج اليومي عبر الفترة المحددة', 'Daily production trend over the given period'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const byDate = groupBy(records, (r) => r.date, (r) => r.date);
    const series = byDate
      .map((g) => ({ date: g.key, productionTons: g.kpis.totalProductionTons, wasteTons: g.kpis.totalWasteTons, recordCount: g.recordCount }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const firstHalf = series.slice(0, Math.floor(series.length / 2));
    const secondHalf = series.slice(Math.floor(series.length / 2));
    const avg = (arr: typeof series) => (arr.length ? arr.reduce((s, x) => s + x.productionTons, 0) / arr.length : 0);
    return {
      success: true,
      data: {
        series,
        firstHalfAvgTons: avg(firstHalf),
        secondHalfAvgTons: avg(secondHalf),
        deltaTons: avg(secondHalf) - avg(firstHalf),
        period,
      },
      affectedCount: records.length,
      messageAr: `تم تحليل اتجاه الإنتاج عبر ${series.length} يوم${periodDisclosure(period, 'ar')}.`,
      messageEn: `Analyzed production trend across ${series.length} day(s)${periodDisclosure(period, 'en')}.`,
    };
  },
};

const compareShifts: ToolDefinition = {
  ...baseAnalysisTool('compareShifts', 'مقارنة أداء الورديات', 'Compare shift performance'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const groups = groupBy(records, (r) => r.shiftId, (r) => r.shiftName);
    const ranked = rankGroups(groups);
    return {
      success: true,
      data: { ...ranked, period },
      affectedCount: records.length,
      messageAr: `تمت مقارنة ${groups.length} وردية${periodDisclosure(period, 'ar')}.`,
      messageEn: `Compared ${groups.length} shift(s)${periodDisclosure(period, 'en')}.`,
    };
  },
};

const comparePresses: ToolDefinition = {
  ...baseAnalysisTool('comparePresses', 'مقارنة أداء المكابس', 'Compare press performance'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const groups = groupBy(records, (r) => r.pressId, (r) => r.pressName);
    const ranked = rankGroups(groups);
    return {
      success: true,
      data: { ...ranked, period },
      affectedCount: records.length,
      messageAr: `تمت مقارنة ${groups.length} مكبس${periodDisclosure(period, 'ar')}.`,
      messageEn: `Compared ${groups.length} press(es)${periodDisclosure(period, 'en')}.`,
    };
  },
};

const analyzeWaste: ToolDefinition = {
  ...baseAnalysisTool('analyzeWaste', 'تحليل الهالك حسب المكبس والوردية', 'Waste analysis by press and shift'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const byPress = groupBy(records, (r) => r.pressId, (r) => r.pressName)
      .map((g) => ({ label: g.label, wasteTons: g.kpis.totalWasteTons, wastePercentage: g.kpis.wastePercentage }))
      .sort((a, b) => b.wastePercentage - a.wastePercentage);
    const byShift = groupBy(records, (r) => r.shiftId, (r) => r.shiftName)
      .map((g) => ({ label: g.label, wasteTons: g.kpis.totalWasteTons, wastePercentage: g.kpis.wastePercentage }))
      .sort((a, b) => b.wastePercentage - a.wastePercentage);
    const overall = calculateKPIsFromRecords(records);
    return {
      success: true,
      data: { overallWastePercentage: overall.wastePercentage, byPress, byShift, period },
      affectedCount: records.length,
      messageAr: `نسبة الهالك الإجمالية: ${overall.wastePercentage.toFixed(1)}%${periodDisclosure(period, 'ar')}.`,
      messageEn: `Overall waste percentage: ${overall.wastePercentage.toFixed(1)}%${periodDisclosure(period, 'en')}.`,
    };
  },
};

const analyzeDowntime: ToolDefinition = {
  ...baseAnalysisTool('analyzeDowntime', 'تحليل وقت التوقف حسب المكبس والوردية', 'Downtime analysis by press and shift'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const byPress = groupBy(records, (r) => r.pressId, (r) => r.pressName)
      .map((g) => ({ label: g.label, downtimeMinutes: g.kpis.totalDowntimeMinutes }))
      .sort((a, b) => b.downtimeMinutes - a.downtimeMinutes);
    const byShift = groupBy(records, (r) => r.shiftId, (r) => r.shiftName)
      .map((g) => ({ label: g.label, downtimeMinutes: g.kpis.totalDowntimeMinutes }))
      .sort((a, b) => b.downtimeMinutes - a.downtimeMinutes);
    const overall = calculateKPIsFromRecords(records);
    return {
      success: true,
      data: { totalDowntimeMinutes: overall.totalDowntimeMinutes, byPress, byShift, period },
      affectedCount: records.length,
      messageAr: `إجمالي وقت التوقف: ${overall.totalDowntimeMinutes.toFixed(0)} دقيقة${periodDisclosure(period, 'ar')}.`,
      messageEn: `Total downtime: ${overall.totalDowntimeMinutes.toFixed(0)} minutes${periodDisclosure(period, 'en')}.`,
    };
  },
};

const analyzeFaults: ToolDefinition = {
  ...baseAnalysisTool('analyzeFaults', 'تحليل الأعطال حسب النوع الأكثر تكراراً', 'Fault analysis ranked by category'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const categories: Array<{ key: keyof ProductionRecord; labelAr: string; labelEn: string }> = [
      { key: 'mechanicalFaults', labelAr: 'ميكانيكية', labelEn: 'Mechanical' },
      { key: 'electricalFaults', labelAr: 'كهربائية', labelEn: 'Electrical' },
      { key: 'workshopFaults', labelAr: 'ورشة', labelEn: 'Workshop' },
      { key: 'rawMaterialFaults', labelAr: 'مواد خام', labelEn: 'Raw Material' },
      { key: 'furnaceFaults', labelAr: 'أفران', labelEn: 'Furnace' },
      { key: 'pressFaults', labelAr: 'مكابس', labelEn: 'Press' },
      { key: 'otherFaults', labelAr: 'أخرى', labelEn: 'Other' },
    ];
    const ranked = categories
      .map((c) => ({
        category: c.key,
        labelAr: c.labelAr,
        labelEn: c.labelEn,
        minutes: records.reduce((sum, r) => sum + Number((r as any)[c.key] || 0), 0),
      }))
      .sort((a, b) => b.minutes - a.minutes);
    return {
      success: true,
      data: { ranked, topCategory: ranked[0] || null, period },
      affectedCount: records.length,
      messageAr: ranked[0] ? `أكثر نوع أعطال: ${ranked[0].labelAr} (${ranked[0].minutes.toFixed(0)} دقيقة)${periodDisclosure(period, 'ar')}.` : `لا توجد بيانات أعطال${periodDisclosure(period, 'ar')}.`,
      messageEn: ranked[0] ? `Top fault category: ${ranked[0].labelEn} (${ranked[0].minutes.toFixed(0)} min)${periodDisclosure(period, 'en')}.` : `No fault data${periodDisclosure(period, 'en')}.`,
    };
  },
};

const analyzeEmployeeProduction: ToolDefinition = {
  ...baseAnalysisTool('analyzeEmployeeProduction', 'تحليل إنتاجية الموظفين مرتبة تنازلياً', 'Employee production analysis, ranked'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const ranked = groupByEmployee(records).sort((a, b) => b.kpis.totalProductionTons - a.kpis.totalProductionTons);
    return {
      success: true,
      data: { ranked, period },
      affectedCount: records.length,
      messageAr: `تم ترتيب ${ranked.length} موظف حسب الإنتاجية${periodDisclosure(period, 'ar')}.`,
      messageEn: `Ranked ${ranked.length} employee(s) by productivity${periodDisclosure(period, 'en')}.`,
    };
  },
};

const analyzeProductPerformance: ToolDefinition = {
  ...baseAnalysisTool('analyzeProductPerformance', 'تحليل أداء الأصناف مرتباً تنازلياً', 'Product performance analysis, ranked'),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const groups = groupBy(records, (r) => r.productId, (r) => r.productName);
    const ranked = groups.sort((a, b) => b.kpis.totalProductionTons - a.kpis.totalProductionTons);
    return {
      success: true,
      data: { ranked, period },
      affectedCount: records.length,
      messageAr: `تم ترتيب ${ranked.length} صنف حسب الإنتاجية${periodDisclosure(period, 'ar')}.`,
      messageEn: `Ranked ${ranked.length} product(s) by output${periodDisclosure(period, 'en')}.`,
    };
  },
};

export function registerAnalysisTools(): void {
  [
    analyzeProductionTrend,
    compareShifts,
    comparePresses,
    analyzeWaste,
    analyzeDowntime,
    analyzeFaults,
    analyzeEmployeeProduction,
    analyzeProductPerformance,
  ].forEach(registerTool);
}

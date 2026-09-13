/**
 * Export Service
 * Exports production records, master data tables, and analytics reports to Excel (.xlsx) and CSV
 */
import * as XLSX from 'xlsx';
import { ProductionRecord, UniversalStageRecord } from '../types';
import { logAuditAction } from './auditService';
import { formatDateTime } from '../utils/formatters';
import { AggregatedReportRow, aggregateByDimension, filterUniversalRecords } from './reportingEngine';
import {
  DashboardLayout, GlobalDashboardFilters, EntityType, METRIC_REGISTRY,
  getMetricLabel, ENTITY_TO_DIMENSION, resolveWidgetFilters,
} from './dashboardRegistry';

export function exportProductionRecordsToExcel(
  records: ProductionRecord[],
  fileName = 'تقرير_سجلات_إنتاج_مصنع_عصفور_طن_وقطع.xlsx'
) {
  const dataForExport = records.map((r, index) => {
    const pieceWeight = r.pieceWeightKg ?? r.pieceWeight ?? null;
    const hasWeight = pieceWeight !== null && !isNaN(pieceWeight) && pieceWeight > 0;
    
    // Ton values
    const prodTons = r.productionTons ?? (hasWeight ? Number(((Number(r.productionQuantity || 0) * pieceWeight) / 1000).toFixed(3)) : null);
    const goodTons = r.goodTons ?? (hasWeight ? Number(((Number(r.goodQuantity || 0) * pieceWeight) / 1000).toFixed(3)) : null);
    const wasteTons = r.wasteTons ?? (hasWeight ? Number(((Number(r.wasteQuantity || 0) * pieceWeight) / 1000).toFixed(3)) : null);

    return {
      'م': index + 1,
      'تاريخ الإنتاج': r.date,
      'الوردية': r.shiftName || r.shiftId,
      'المكبس': r.pressName || r.pressId,
      'الفرن': r.furnaceName || r.furnaceId || '-',
      'عربات الفرن': r.furnaceCarNumbers?.join(', ') || '-',
      'فريق العمل': r.employeeNames?.join(', ') || '-',
      'كود المنتج': r.productCode || '-',
      'اسم المنتج': r.productName,
      'نسبة الألومينا (%)': r.aluminaPercentage ?? '-',
      
      // Factory Standard Unit: TONS
      'إجمالي الإنتاج (طن)': prodTons !== null ? prodTons : 'غير محسوب',
      'الإنتاج السليم (طن)': goodTons !== null ? goodTons : 'غير محسوب',
      'الهالك / التالف (طن)': wasteTons !== null ? wasteTons : 'غير محسوب',
      
      // Piece & Weight Details
      'وزن القطعة (كجم)': hasWeight ? pieceWeight : 'غير متوفر',
      'إجمالي الإنتاج (قطع)': r.productionQuantity,
      'الهالك / التالف (قطع)': r.wasteQuantity,
      'الإنتاج السليم (قطع)': r.goodQuantity,
      'نسبة الهالك (%)': `${r.wastePercentage}%`,
      
      // Weights in Kg
      'وزن الإنتاج الإجمالي (كجم)': r.productionWeight,
      'وزن المنتج السليم (كجم)': r.goodWeight,
      'وزن التالف (كجم)': r.wasteWeight,
      
      // Downtime Breakdown
      'أعطال ميكانيكية (دقيقة)': r.mechanicalFaults || 0,
      'أعطال كهربائية (دقيقة)': r.electricalFaults || 0,
      'أعطال ورشة (دقيقة)': r.workshopFaults || 0,
      'أعطال خامات (دقيقة)': r.rawMaterialFaults || 0,
      'أعطال أفران (دقيقة)': r.furnaceFaults || 0,
      'أعطال مكابس (دقيقة)': r.pressFaults || 0,
      'أعطال أخرى (دقيقة)': r.otherFaults || 0,
      'إجمالي التوقف (دقيقة)': r.totalDowntimeMinutes || 0,
      'إجمالي التوقف (ساعة)': r.totalDowntimeHours || 0,
      
      // Productivity Rates
      'معدل الإنتاج (طن/ساعة)': r.productionRateTonsPerHour ?? '-',
      'إنتاجية العامل (طن/ساعة عمل)': r.laborProductivityTonsPerHour ?? '-',
      'طريقة الحساب': r.calculationMethod || (hasWeight ? 'COUNT_X_PIECE_WEIGHT' : 'DIRECT_TON'),
      
      // Orders & Tracing
      'رقم أمر العميل': r.customerOrderNumber || '-',
      'العميل': r.customerName || '-',
      'ملاحظات': r.notes || '',
      'سجل بواسطة': r.createdByName || '',
      'تاريخ التسجيل': formatDateTime(r.createdAt, ''),
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(dataForExport);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'سجلات الإنتاج');

  // Trigger download
  XLSX.writeFile(workbook, fileName);
  logAuditAction('EXPORT', 'production', '', `تصدير عدد ${records.length} سجل إنتاج إلى Excel`);
}

/**
 * Exports an AGGREGATED report table (from reportingEngine.ts's
 * aggregateByDimension()) to Excel - used by the stage-aware Reports module
 * and by the AI Assistant's exportReportToExcel/generateReport tools, so
 * both share one export path regardless of which production stage(s) the
 * underlying rows came from.
 */
export function exportAggregatedReportToExcel(
  rows: AggregatedReportRow[],
  labelHeader: string,
  language: 'ar' | 'en',
  fileName: string
) {
  const headers = language === 'ar'
    ? { label: labelHeader, ops: 'عدد التشغيلات', prod: 'إجمالي الإنتاج (طن)', good: 'الإنتاج السليم (طن)', waste: 'الهالك (طن)', wastePct: 'نسبة الهالك (%)', downtime: 'التوقف (دقيقة)' }
    : { label: labelHeader, ops: 'Operations', prod: 'Total Production (t)', good: 'Good Production (t)', waste: 'Waste (t)', wastePct: 'Waste Rate (%)', downtime: 'Downtime (min)' };

  const dataForExport = rows.map((row) => ({
    [headers.label]: row.label,
    [headers.ops]: row.operationsCount,
    [headers.prod]: Number(row.productionTons.toFixed(3)),
    [headers.good]: Number(row.goodTons.toFixed(3)),
    [headers.waste]: Number(row.wasteTons.toFixed(3)),
    [headers.wastePct]: row.wastePercentage,
    [headers.downtime]: Number(row.downtimeMinutes.toFixed(1)),
  }));

  const worksheet = XLSX.utils.json_to_sheet(dataForExport);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, language === 'ar' ? 'تقرير' : 'Report');
  XLSX.writeFile(workbook, fileName);
  logAuditAction('EXPORT', 'reports', '', `تصدير تقرير مجمّع (${rows.length} صف) إلى Excel`);
}

export function exportMasterDataToExcel<T extends Record<string, any>>(
  items: T[],
  sheetTitle: string,
  fileName: string
) {
  const worksheet = XLSX.utils.json_to_sheet(items);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetTitle.substring(0, 30));
  XLSX.writeFile(workbook, fileName);
  logAuditAction('EXPORT', sheetTitle, '', `تصدير بيانات ${sheetTitle} إلى Excel`);
}

const ENTITY_SHEET_LABEL: Record<EntityType, { ar: string; en: string }> = {
  EMPLOYEE: { ar: 'الموظفون', en: 'Employees' },
  SHIFT: { ar: 'الورديات', en: 'Shifts' },
  EQUIPMENT: { ar: 'المعدات', en: 'Equipment' },
  PRODUCT: { ar: 'المنتجات', en: 'Products' },
  CUSTOMER: { ar: 'العملاء', en: 'Customers' },
  STAGE: { ar: 'المراحل', en: 'Stages' },
};

/**
 * Dashboard -> Excel (Part 8 §30) - a STRUCTURED multi-sheet workbook, never
 * an image/screenshot. One "Dashboard Summary" sheet lists every widget's
 * resolved value (respecting its own local filters, per §34); one sheet per
 * distinct dimension actually used on the dashboard (Employees, Shifts,
 * Equipment, Products, ...) carries that dimension's full aggregated table -
 * reusing aggregateByDimension(), so a number here can never diverge from
 * what the dashboard itself displays.
 */
export function exportDashboardToExcel(
  dashboard: DashboardLayout,
  allRecords: UniversalStageRecord[],
  globalFilters: GlobalDashboardFilters,
  language: 'ar' | 'en',
  fileName: string,
  /** The cost-centre scope the Builder resolved, so the file matches the screen. null = no narrowing. */
  hierarchyScope: Set<string> | null = null
) {
  const workbook = XLSX.utils.book_new();
  const summaryRows: Record<string, string | number>[] = [];
  const dimensionSheets = new Map<EntityType, AggregatedReportRow[]>();

  const headers = language === 'ar'
    ? { section: 'القسم', widget: 'العنصر', metric: 'المقياس', value: 'القيمة' }
    : { section: 'Section', widget: 'Widget', metric: 'Metric', value: 'Value' };

  for (const section of dashboard.sections) {
    for (const w of section.widgets) {
      const resolved = resolveWidgetFilters(w, globalFilters);
      const filtered = filterUniversalRecords(allRecords, {
        startDate: resolved.startDate, endDate: resolved.endDate, stageType: resolved.stageType, ...resolved.filters,
      }, hierarchyScope);
      const metricDef = METRIC_REGISTRY[w.metric];
      summaryRows.push({
        [headers.section]: section.title,
        [headers.widget]: w.customTitle || getMetricLabel(w.metric, language),
        [headers.metric]: getMetricLabel(w.metric, language),
        [headers.value]: Number(metricDef.compute(filtered).toFixed(3)),
      });
      if (w.entityType && !dimensionSheets.has(w.entityType)) {
        const dimension = ENTITY_TO_DIMENSION[w.entityType];
        dimensionSheets.set(w.entityType, aggregateByDimension(filtered, dimension, language));
      }
    }
  }

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(workbook, summarySheet, language === 'ar' ? 'ملخص اللوحة' : 'Dashboard Summary');

  const rowHeaders = language === 'ar'
    ? { label: 'البند', ops: 'عدد التشغيلات', prod: 'الإنتاج (طن)', good: 'الإنتاج السليم (طن)', waste: 'الهالك (طن)', wastePct: 'نسبة الهالك (%)', downtime: 'التوقف (دقيقة)' }
    : { label: 'Item', ops: 'Operations', prod: 'Production (t)', good: 'Good Production (t)', waste: 'Waste (t)', wastePct: 'Waste Rate (%)', downtime: 'Downtime (min)' };

  for (const [entityType, rows] of dimensionSheets) {
    const sheetRows = rows.map((row) => ({
      [rowHeaders.label]: row.label,
      [rowHeaders.ops]: row.operationsCount,
      [rowHeaders.prod]: Number(row.productionTons.toFixed(3)),
      [rowHeaders.good]: Number(row.goodTons.toFixed(3)),
      [rowHeaders.waste]: Number(row.wasteTons.toFixed(3)),
      [rowHeaders.wastePct]: row.wastePercentage,
      [rowHeaders.downtime]: Number(row.downtimeMinutes.toFixed(1)),
    }));
    const sheet = XLSX.utils.json_to_sheet(sheetRows);
    const label = language === 'ar' ? ENTITY_SHEET_LABEL[entityType].ar : ENTITY_SHEET_LABEL[entityType].en;
    XLSX.utils.book_append_sheet(workbook, sheet, label.slice(0, 30));
  }

  XLSX.writeFile(workbook, fileName);
  logAuditAction('EXPORT', 'dashboard', dashboard.dashboardId, `تصدير اللوحة "${dashboard.name}" إلى Excel (${summaryRows.length} عنصر، ${dimensionSheets.size} جدول تفصيلي)`);
}

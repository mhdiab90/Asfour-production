/**
 * Excel export tools. Reuses the EXISTING Excel generation architecture
 * (src/services/exportService.ts, built on the `xlsx` package already used
 * throughout the app) rather than introducing a second export engine.
 * Exports trigger an immediate browser download exactly as the Reports/
 * Master Data screens already do - there is no server-side file storage in
 * this application, so `fileUrl` is intentionally absent.
 */
import * as XLSX from 'xlsx';
import { exportProductionRecordsToExcel } from '../../services/exportService';
import { logAuditAction } from '../../services/auditService';
import { PermissionKey } from '../../types/permissions';
import { ToolDefinition } from '../types';
import { registerTool } from './registry';
import { fetchFiltered } from './productionQueryTools';
import { PRODUCTION_FILTER_SCHEMA, EXPORT_REPORT_SCHEMA } from './parameterSchemas';
import { periodDisclosure } from './dateRangeResolver';
import { ProductionRecord } from '../../types';

function generateExportId(): string {
  return `AST-EXP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

const EXPORT_PERMISSION: PermissionKey[] = ['reports.export', 'reports.view'];

const exportProductionToExcel: ToolDefinition = {
  toolName: 'exportProductionToExcel',
  descriptionAr: 'تصدير سجلات الإنتاج (مع فلاتر اختيارية) إلى Excel',
  descriptionEn: 'Export production records (with optional filters) to Excel',
  commandType: 'EXPORT',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: EXPORT_PERMISSION,
  parameterSchema: PRODUCTION_FILTER_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: input || {} }),
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const exportId = generateExportId();
    const fileName = `ASFOUR_Production_Export_${new Date().toISOString().slice(0, 10)}.xlsx`;
    exportProductionRecordsToExcel(records, fileName);
    return {
      success: true,
      data: { exportId, fileName, rowCount: records.length, period },
      affectedCount: records.length,
      messageAr: `تم تصدير ${records.length} سجل إلى الملف (${fileName})${periodDisclosure(period, 'ar')}.`,
      messageEn: `Exported ${records.length} record(s) to (${fileName})${periodDisclosure(period, 'en')}.`,
    };
  },
};

const exportCurrentFilteredData: ToolDefinition = {
  toolName: 'exportCurrentFilteredData',
  descriptionAr: 'تصدير البيانات المفلترة حالياً في الشاشة الحالية إلى Excel',
  descriptionEn: "Export the current screen's filtered data to Excel",
  commandType: 'EXPORT',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: EXPORT_PERMISSION,
  parameterSchema: PRODUCTION_FILTER_SCHEMA,
  inputSchema: (input) => ({ valid: true, value: input || {} }),
  execute: async (input, context) => {
    // Uses the screen context's currently-selected filters as the export scope.
    const mergedFilter = { ...(context.selectedFilters || {}), ...(context.selectedDateRange || {}), ...input };
    const { records, period } = await fetchFiltered(mergedFilter);
    const exportId = generateExportId();
    const fileName = `ASFOUR_${context.currentModule || 'Export'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    exportProductionRecordsToExcel(records, fileName);
    return {
      success: true,
      data: { exportId, fileName, rowCount: records.length, period },
      affectedCount: records.length,
      messageAr: `تم تصدير البيانات الحالية (${records.length} سجل) إلى الملف (${fileName})${periodDisclosure(period, 'ar')}.`,
      messageEn: `Exported the current data (${records.length} record(s)) to (${fileName})${periodDisclosure(period, 'en')}.`,
    };
  },
};

type ReportType = 'production' | 'waste' | 'downtime' | 'faults';

function buildSummarySheet(reportType: ReportType, records: ProductionRecord[]) {
  if (reportType === 'waste') {
    return records.map((r) => ({
      'التاريخ': r.date,
      'المكبس': r.pressName,
      'الوردية': r.shiftName,
      'الهالك (طن)': r.wasteTons ?? '-',
      'نسبة الهالك (%)': r.wastePercentage,
    }));
  }
  if (reportType === 'downtime' || reportType === 'faults') {
    return records.map((r) => ({
      'التاريخ': r.date,
      'المكبس': r.pressName,
      'الوردية': r.shiftName,
      'أعطال ميكانيكية (د)': r.mechanicalFaults,
      'أعطال كهربائية (د)': r.electricalFaults,
      'أعطال ورشة (د)': r.workshopFaults,
      'أعطال مواد خام (د)': r.rawMaterialFaults,
      'أعطال أفران (د)': r.furnaceFaults,
      'أعطال مكابس (د)': r.pressFaults,
      'أعطال أخرى (د)': r.otherFaults,
    }));
  }
  return records.map((r) => ({
    'التاريخ': r.date,
    'المكبس': r.pressName,
    'الوردية': r.shiftName,
    'الإنتاج (طن)': r.productionTons ?? '-',
  }));
}

const exportReportToExcel: ToolDefinition = {
  toolName: 'exportReportToExcel',
  descriptionAr: 'إنشاء وتصدير تقرير (إنتاج / هالك / توقف / أعطال) إلى Excel',
  descriptionEn: 'Build and export a report (production / waste / downtime / faults) to Excel',
  commandType: 'EXPORT',
  riskLevel: 'LOW_RISK',
  confirmationPolicy: 'NONE',
  requiredPermission: EXPORT_PERMISSION,
  parameterSchema: EXPORT_REPORT_SCHEMA,
  inputSchema: (input) => {
    const reportType = String(input?.reportType || 'production').toLowerCase() as ReportType;
    if (!['production', 'waste', 'downtime', 'faults'].includes(reportType)) {
      return { valid: false, errors: ['reportType must be one of production|waste|downtime|faults'] };
    }
    return { valid: true, value: { ...input, reportType } };
  },
  execute: async (input) => {
    const { records, period } = await fetchFiltered(input);
    const rows = buildSummarySheet(input.reportType, records);
    const exportId = generateExportId();
    const fileName = `ASFOUR_Report_${input.reportType}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, input.reportType.slice(0, 30));
    XLSX.writeFile(workbook, fileName);
    await logAuditAction('EXPORT', 'production', '', `تصدير تقرير (${input.reportType}) عبر المساعد الذكي - عدد السجلات: ${rows.length}`).catch(() => {});

    return {
      success: true,
      data: { exportId, fileName, rowCount: rows.length, reportType: input.reportType, period },
      affectedCount: rows.length,
      messageAr: `تم إنشاء تقرير (${input.reportType}) وتصديره (${rows.length} صف) إلى الملف (${fileName})${periodDisclosure(period, 'ar')}.`,
      messageEn: `Built and exported the (${input.reportType}) report (${rows.length} row(s)) to (${fileName})${periodDisclosure(period, 'en')}.`,
    };
  },
};

export function registerExportTools(): void {
  [exportProductionToExcel, exportCurrentFilteredData, exportReportToExcel].forEach(registerTool);
}

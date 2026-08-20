/**
 * Export Service
 * Exports production records, master data tables, and analytics reports to Excel (.xlsx) and CSV
 */
import * as XLSX from 'xlsx';
import { ProductionRecord } from '../types';
import { logAuditAction } from './auditService';
import { formatDateTime } from '../utils/formatters';

export function exportProductionRecordsToExcel(
  records: ProductionRecord[],
  fileName = 'تقرير_سجلات_إنتاج_مصنع_عصفور.xlsx'
) {
  const dataForExport = records.map((r, index) => ({
    'م': index + 1,
    'تاريخ الإنتاج': r.date,
    'الوردية': r.shiftName || r.shiftId,
    'المكبس': r.pressName || r.pressId,
    'الفرن': r.furnaceName || r.furnaceId || '-',
    'عربات الفرن': r.furnaceCarNumbers?.join(', ') || '-',
    'فريق العمل': r.employeeNames?.join(', ') || '-',
    'كود المنتج': r.productCode || '-',
    'اسم المنتج': r.productName,
    'نسبة الألومينا (%)': r.aluminaPercentage,
    'وزن القطعة (كجم)': r.pieceWeight,
    'إجمالي الإنتاج (قطع)': r.productionQuantity,
    'الهالك / التالف (قطع)': r.wasteQuantity,
    'الإنتاج السليم (قطع)': r.goodQuantity,
    'نسبة الهالك (%)': `${r.wastePercentage}%`,
    'وزن الإنتاج الإجمالي (كجم)': r.productionWeight,
    'وزن المنتج السليم (كجم)': r.goodWeight,
    'وزن التالف (كجم)': r.wasteWeight,
    'أعطال ميكانيكية (دقيقة)': r.mechanicalFaults || 0,
    'أعطال كهربائية (دقيقة)': r.electricalFaults || 0,
    'أعطال ورشة (دقيقة)': r.workshopFaults || 0,
    'أعطال خامات (دقيقة)': r.rawMaterialFaults || 0,
    'أعطال أفران (دقيقة)': r.furnaceFaults || 0,
    'أعطال مكابس (دقيقة)': r.pressFaults || 0,
    'أعطال أخرى (دقيقة)': r.otherFaults || 0,
    'إجمالي التوقف (دقيقة)': r.totalDowntimeMinutes || 0,
    'إجمالي التوقف (ساعة)': r.totalDowntimeHours || 0,
    'رقم أمر العميل': r.customerOrderNumber || '-',
    'العميل': r.customerName || '-',
    'ملاحظات': r.notes || '',
    'سجل بواسطة': r.createdByName || '',
    'تاريخ التسجيل': formatDateTime(r.createdAt, ''),
  }));

  const worksheet = XLSX.utils.json_to_sheet(dataForExport);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'سجلات الإنتاج');

  // Trigger download
  XLSX.writeFile(workbook, fileName);
  logAuditAction('EXPORT', 'production', '', `تصدير عدد ${records.length} سجل إنتاج إلى Excel`);
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

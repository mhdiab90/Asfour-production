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

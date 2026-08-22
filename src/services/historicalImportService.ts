/**
 * Historical Production Import Service
 * Handles parsing, validation, Master Data resolution (by Code or Name),
 * duplicate detection, and batch insertion of historical Excel/CSV production logs.
 */
import * as XLSX from 'xlsx';
import { 
  collection, 
  getDocs, 
  writeBatch, 
  doc, 
  serverTimestamp 
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { 
  Employee, 
  Product, 
  Customer, 
  Shift, 
  Press, 
  Furnace, 
  ProductionStageType,
  UniversalStageRecord
} from '../types';
import { fetchMasterData } from './masterDataService';
import { logAuditAction } from './auditService';
import { calculateProductionMetrics } from './productionService';
import { 
  downloadPressingExcelTemplate, 
  parseAndValidatePressingExcel, 
  executePressingBatchImport, 
  PRESSING_IMPORT_HEADERS 
} from './pressingHistoricalImportService';

export { 
  downloadPressingExcelTemplate, 
  parseAndValidatePressingExcel, 
  executePressingBatchImport, 
  PRESSING_IMPORT_HEADERS 
};

export interface StageImportRow {
  rowIndex: number;
  data: Record<string, any>;
  errors: string[];
}

export interface ImportValidationResult {
  validRows: StageImportRow[];
  errors: { rowIndex: number; field: string; message: string }[];
  missingMasterData: { type: string; name: string }[];
}

export interface HistoricalImportRow {
  rowNumber: number;
  raw: Record<string, any>;
  date: string;
  stage: ProductionStageType;
  productCodeOrName: string;
  resolvedProductId?: string;
  resolvedProductCode?: string;
  resolvedProductName?: string;
  pieceWeight?: number;
  customerCodeOrName?: string;
  resolvedCustomerId?: string;
  resolvedCustomerName?: string;
  employeeCodeOrName?: string;
  resolvedEmployeeId?: string;
  resolvedEmployeeName?: string;
  resolvedEmployeeCode?: string;
  shiftCodeOrName?: string;
  resolvedShiftId?: string;
  resolvedShiftName?: string;
  pressCodeOrName?: string;
  resolvedPressId?: string;
  resolvedPressName?: string;
  furnaceCodeOrName?: string;
  resolvedFurnaceId?: string;
  resolvedFurnaceName?: string;
  quantity: number;
  wasteQuantity: number;
  goodQuantity: number;
  downtimeMinutes: number;
  status: 'NEW' | 'DUPLICATE' | 'INVALID';
  errors: string[];
}

export interface HistoricalImportSummary {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  rows: HistoricalImportRow[];
}

/**
 * Generate and download downloadable Excel template with correct headers for each stage
 */
export function downloadStageExcelTemplate(stage: ProductionStageType) {
  if (stage === 'pressing') {
    downloadPressingExcelTemplate();
    return;
  }

  let headers: string[] = [];
  let sampleRow: Record<string, any> = {};

  switch (stage) {
    case 'rotary_furnace':
      headers = ['التاريخ', 'رقم الدفعة', 'كود المنتج', 'اسم المنتج', 'ساعات التشغيل', 'استهلاك الغاز م3', 'استهلاك الكهرباء kWh', 'الإنتاج طن', 'الهالك طن', 'توقفات دقيقة', 'ملاحظات'];
      sampleRow = {
        'التاريخ': '2026-03-01',
        'رقم الدفعة': 'BATCH-001',
        'كود المنتج': 'PROD-ROT-40',
        'اسم المنتج': 'شاموت مكلس 40%',
        'ساعات التشغيل': 8,
        'استهلاك الغاز م3': 450,
        'استهلاك الكهرباء kWh': 320,
        'الإنتاج طن': 25,
        'الهالك طن': 1.2,
        'توقفات دقيقة': 0,
        'ملاحظات': 'تشغيل ممتاز'
      };
      break;
    case 'chinese_mills':
      headers = ['التاريخ', 'اسم العميل', 'كود المواصفة', 'نوع الطاحونة', 'الوردية', 'الإنتاج طن', 'عدد الشكائر', 'الهالك طن', 'ساعات التشغيل', 'ساعات التوقف'];
      sampleRow = {
        'التاريخ': '2026-03-01',
        'اسم العميل': 'شركة السويس للصلب',
        'كود المواصفة': 'MESH-200',
        'نوع الطاحونة': 'طاحونة صينية 1',
        'الوردية': 'وردية صباحية',
        'الإنتاج طن': 12,
        'عدد الشكائر': 240,
        'الهالك طن': 0.3,
        'ساعات التشغيل': 7.5,
        'ساعات التوقف': 0.5
      };
      break;
    case 'sorting':
      headers = ['التاريخ', 'تاريخ خروج الفرن', 'رقم أمر العميل', 'رقم السيارة', 'كود المنتج', 'اسم المنتج', 'وزن القطعة كجم', 'إجمالي العدد', 'عدد الكسر المعيب', 'شطف', 'شروخ', 'بقع حديد', 'شوائب', 'حريق فرن', 'مرتجع'];
      sampleRow = {
        'التاريخ': '2026-03-01',
        'تاريخ خروج الفرن': '2026-02-28',
        'رقم أمر العميل': 'PO-889',
        'رقم السيارة': '1245 ق هـ',
        'كود المنتج': 'BRICK-STD-42',
        'اسم المنتج': 'طوب حراري عالي الألومينا 42%',
        'وزن القطعة كجم': 4.5,
        'إجمالي العدد': 5000,
        'عدد الكسر المعيب': 250,
        'شطف': 80,
        'شروخ': 90,
        'بقع حديد': 30,
        'شوائب': 20,
        'حريق فرن': 20,
        'مرتجع': 10
      };
      break;
    default:
      headers = ['التاريخ', 'الوردية', 'المكبس', 'كود المنتج', 'اسم المنتج', 'العميل', 'كود العامل', 'الإنتاج', 'الهالك', 'التوقفات'];
      sampleRow = {
        'التاريخ': '2026-03-01',
        'الوردية': 'وردية 1',
        'المكبس': 'مكبس 1',
        'كود المنتج': 'PR-01',
        'اسم المنتج': 'طوب شاموت قياسي',
        'العميل': 'حديد عز',
        'كود العامل': 'EMP-101',
        'الإنتاج': 600,
        'الهالك': 15,
        'التوقفات': 0
      };
      break;
  }

  const ws = XLSX.utils.json_to_sheet([sampleRow], { header: headers });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'قالب_الاستيراد');
  XLSX.writeFile(wb, `Template_${stage}_${new Date().toISOString().split('T')[0]}.xlsx`);
}

/**
 * Parse uploaded file to JSON
 */
export async function parseExcelFile(file: File): Promise<StageImportRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawJson: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  return rawJson.map((row, idx) => ({
    rowIndex: idx + 2, // Excel 1-indexed plus header row
    data: row,
    errors: [],
  }));
}

/**
 * Validate imported rows against stage criteria and master data
 */
export async function validateImportRows(
  stage: ProductionStageType,
  rows: StageImportRow[]
): Promise<ImportValidationResult> {
  const [products, customers, employees] = await Promise.all([
    fetchMasterData<Product>('products'),
    fetchMasterData<Customer>('customers'),
    fetchMasterData<Employee>('employees'),
  ]);

  const validRows: StageImportRow[] = [];
  const errors: { rowIndex: number; field: string; message: string }[] = [];
  const missingMasterData: { type: string; name: string }[] = [];
  const missingSet = new Set<string>();

  rows.forEach((row) => {
    const d = row.data;
    let hasFatal = false;

    // Date check
    const dateVal = d['التاريخ'] || d['date'] || d['Date'];
    if (!dateVal) {
      errors.push({ rowIndex: row.rowIndex, field: 'التاريخ', message: 'حقل التاريخ إجباري' });
      hasFatal = true;
    }

    // Product check
    const prodVal = String(d['كود المنتج'] || d['المنتج'] || d['اسم المنتج'] || '').trim();
    if (prodVal) {
      const found = products.find(p => p.code === prodVal || p.name === prodVal);
      if (!found) {
        const key = `product_${prodVal}`;
        if (!missingSet.has(key)) {
          missingSet.add(key);
          missingMasterData.push({ type: 'منتج (Product)', name: prodVal });
        }
      }
    }

    // Customer check
    const custVal = String(d['العميل'] || d['اسم العميل'] || d['كود العميل'] || '').trim();
    if (custVal) {
      const found = customers.find(c => c.code === custVal || c.name === custVal);
      if (!found) {
        const key = `customer_${custVal}`;
        if (!missingSet.has(key)) {
          missingSet.add(key);
          missingMasterData.push({ type: 'عميل (Customer)', name: custVal });
        }
      }
    }

    // Worker check
    const empVal = String(d['العامل'] || d['كود العامل'] || d['الموظف'] || '').trim();
    if (empVal) {
      const found = employees.find(e => e.code === empVal || e.name === empVal);
      if (!found) {
        const key = `employee_${empVal}`;
        if (!missingSet.has(key)) {
          missingSet.add(key);
          missingMasterData.push({ type: 'عامل (Employee)', name: empVal });
        }
      }
    }

    if (!hasFatal) {
      validRows.push(row);
    }
  });

  return {
    validRows,
    errors,
    missingMasterData,
  };
}

/**
 * Execute batch import for any stage with progress callback
 */
export async function executeBatchImport(
  stage: ProductionStageType,
  validRows: StageImportRow[],
  autoCreateMasterData: boolean,
  onProgress?: (percent: number) => void
): Promise<{ total: number; success: number; errors: string[] }> {
  const collectionName = stage === 'pressing' ? 'production' : `stage_${stage}`;
  const batchSize = 400;
  let success = 0;
  const errors: string[] = [];

  for (let i = 0; i < validRows.length; i += batchSize) {
    const chunk = validRows.slice(i, i + batchSize);
    const batch = writeBatch(db);

    chunk.forEach((row) => {
      const docRef = doc(collection(db, collectionName));
      const raw = row.data;

      const record: any = {
        id: docRef.id,
        stageType: stage,
        date: raw['التاريخ'] || new Date().toISOString().split('T')[0],
        productCode: raw['كود المنتج'] || raw['المنتج'] || '',
        productName: raw['اسم المنتج'] || raw['المنتج'] || '',
        customerName: raw['العميل'] || raw['اسم العميل'] || '',
        quantity: Number(raw['الإنتاج'] || raw['الإنتاج طن'] || raw['إجمالي الإنتاج'] || raw['إجمالي العدد'] || 0),
        wasteQuantity: Number(raw['الهالك'] || raw['الهالك طن'] || raw['عدد الكسر المعيب'] || 0),
        totalDowntimeMinutes: Number(raw['التوقفات'] || raw['توقفات دقيقة'] || (Number(raw['ساعات التوقف'] || 0) * 60)),
        status: 'SUBMITTED',
        isHistoricalImport: true,
        notes: raw['ملاحظات'] || 'تم الاستيراد من ملف Excel تاريخي',
        rawData: raw,
        createdBy: auth.currentUser?.uid || 'SUPER_ADMIN',
        createdByName: auth.currentUser?.email || 'مشرف الاستيراد التاريخي',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        serverCreatedAt: serverTimestamp(),
      };

      batch.set(docRef, record);
    });

    try {
      await batch.commit();
      success += chunk.length;
      if (onProgress) {
        onProgress(Math.round(((i + chunk.length) / validRows.length) * 100));
      }
    } catch (err: any) {
      errors.push(`فشل حفظ الدفعة: ${err.message}`);
    }
  }

  await logAuditAction(
    'BULK_IMPORT',
    collectionName,
    'excel_import',
    `تم استيراد ${success} سجل لمرحلة ${stage} من ملف Excel`
  );

  return {
    total: validRows.length,
    success,
    errors,
  };
}



/**
 * Parse uploaded file (ArrayBuffer) and validate against existing Master Data & production history
 */
export async function parseAndValidateHistoricalExcel(
  fileBuffer: ArrayBuffer,
  targetStage: ProductionStageType = 'pressing'
): Promise<HistoricalImportSummary> {
  const workbook = XLSX.read(fileBuffer, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  // Fetch Master Data for fast in-memory matching
  const [employees, products, customers, shifts, presses, furnaces, existingProductionSnap] = await Promise.all([
    fetchMasterData<Employee>('employees'),
    fetchMasterData<Product>('products'),
    fetchMasterData<Customer>('customers'),
    fetchMasterData<Shift>('shifts'),
    fetchMasterData<Press>('presses'),
    fetchMasterData<Furnace>('furnaces'),
    getDocs(collection(db, 'production')).catch(() => ({ docs: [] } as any)),
  ]);

  // Build existing keys set for duplicate detection
  const existingSet = new Set<string>();
  existingProductionSnap.docs.forEach((d: any) => {
    const data = d.data();
    if (data.date && data.productCode) {
      existingSet.add(`${data.date}_${data.productCode}_${data.shiftId || ''}_${data.pressId || ''}`);
    }
  });

  const parsedRows: HistoricalImportRow[] = [];
  let validCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;

  rawRows.forEach((row, index) => {
    const rowErrors: string[] = [];
    
    // Normalize date
    let dateStr = String(row['التاريخ'] || row['date'] || row['Date'] || row['تاريخ الإنتاج'] || '').trim();
    if (!dateStr) {
      dateStr = new Date().toISOString().split('T')[0];
    } else if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        // Handle DD/MM/YYYY or YYYY/MM/DD
        if (parts[0].length === 4) {
          dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        } else {
          dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      }
    }

    // Match Product by Code OR Name
    const prodInput = String(row['المنتج'] || row['كود المنتج'] || row['اسم المنتج'] || row['product'] || row['Product'] || row['productCode'] || '').trim();
    const matchedProduct = products.find(p => 
      (p.code && p.code.toLowerCase() === prodInput.toLowerCase()) ||
      (p.name && p.name.trim().toLowerCase() === prodInput.toLowerCase()) ||
      (p.productCode && p.productCode.toLowerCase() === prodInput.toLowerCase())
    );

    if (!matchedProduct && prodInput) {
      rowErrors.push(`المنتج "${prodInput}" غير موجود بالبيانات الأساسية`);
    }

    // Match Employee by Code OR Name
    const empInput = String(row['الموظف'] || row['العامل'] || row['كود العامل'] || row['اسم العامل'] || row['employee'] || '').trim();
    const matchedEmployee = employees.find(e => 
      (e.code && String(e.code).trim() === empInput) ||
      (e.name && e.name.trim().toLowerCase() === empInput.toLowerCase())
    );

    // Match Customer by Code OR Name
    const custInput = String(row['العميل'] || row['اسم العميل'] || row['كود العميل'] || row['customer'] || '').trim();
    const matchedCustomer = customers.find(c =>
      (c.code && c.code.toLowerCase() === custInput.toLowerCase()) ||
      (c.name && c.name.trim().toLowerCase() === custInput.toLowerCase())
    );

    // Match Shift
    const shiftInput = String(row['الوردية'] || row['اسم الوردية'] || row['shift'] || '').trim();
    const matchedShift = shifts.find(s =>
      (s.code && s.code.toLowerCase() === shiftInput.toLowerCase()) ||
      (s.name && s.name.trim().toLowerCase() === shiftInput.toLowerCase())
    ) || shifts[0];

    // Match Press
    const pressInput = String(row['المكبس'] || row['رقم المكبس'] || row['press'] || '').trim();
    const matchedPress = presses.find(p =>
      (p.code && p.code.toLowerCase() === pressInput.toLowerCase()) ||
      (p.name && p.name.trim().toLowerCase() === pressInput.toLowerCase())
    ) || presses[0];

    // Quantities
    const qty = Number(row['الكمية'] || row['الإنتاج'] || row['إجمالي الإنتاج'] || row['quantity'] || row['productionQuantity'] || 0);
    const waste = Number(row['الهالك'] || row['القطع المعيبة'] || row['waste'] || row['wasteQuantity'] || 0);
    const downtime = Number(row['التوقفات'] || row['الأعطال'] || row['downtime'] || 0);

    if (qty <= 0) {
      rowErrors.push('الكمية المنتجة يجب أن تكون أكبر من صفر');
    }

    // Check duplicate
    const rowKey = `${dateStr}_${matchedProduct?.code || prodInput}_${matchedShift?.id || ''}_${matchedPress?.id || ''}`;
    const isDuplicate = existingSet.has(rowKey);

    let rowStatus: 'NEW' | 'DUPLICATE' | 'INVALID' = 'NEW';
    if (rowErrors.length > 0) {
      rowStatus = 'INVALID';
      invalidCount++;
    } else if (isDuplicate) {
      rowStatus = 'DUPLICATE';
      duplicateCount++;
    } else {
      rowStatus = 'NEW';
      validCount++;
    }

    parsedRows.push({
      rowNumber: index + 1,
      raw: row,
      date: dateStr,
      stage: targetStage,
      productCodeOrName: prodInput,
      resolvedProductId: matchedProduct?.id,
      resolvedProductCode: matchedProduct?.code || prodInput,
      resolvedProductName: matchedProduct?.name || prodInput,
      pieceWeight: matchedProduct?.pieceWeight || 4.5,
      customerCodeOrName: custInput,
      resolvedCustomerId: matchedCustomer?.id,
      resolvedCustomerName: matchedCustomer?.name,
      employeeCodeOrName: empInput,
      resolvedEmployeeId: matchedEmployee?.id,
      resolvedEmployeeName: matchedEmployee?.name,
      resolvedEmployeeCode: matchedEmployee?.code,
      shiftCodeOrName: shiftInput,
      resolvedShiftId: matchedShift?.id,
      resolvedShiftName: matchedShift?.name || 'وردية أساسية',
      pressCodeOrName: pressInput,
      resolvedPressId: matchedPress?.id,
      resolvedPressName: matchedPress?.name || 'مكبس 1',
      quantity: qty,
      wasteQuantity: waste,
      goodQuantity: Math.max(0, qty - waste),
      downtimeMinutes: downtime,
      status: rowStatus,
      errors: rowErrors,
    });
  });

  return {
    totalRows: rawRows.length,
    validRows: validCount,
    duplicateRows: duplicateCount,
    invalidRows: invalidCount,
    rows: parsedRows,
  };
}

/**
 * Commit validated rows to Firestore in chunks of 400
 */
export async function executeHistoricalImport(
  rowsToImport: HistoricalImportRow[]
): Promise<{ importedCount: number; errors: string[] }> {
  const currentUser = auth.currentUser;
  let importedCount = 0;
  const errors: string[] = [];

  const validRows = rowsToImport.filter(r => r.status === 'NEW' || r.status === 'DUPLICATE');
  const CHUNK_SIZE = 400;

  for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
    const chunk = validRows.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    chunk.forEach(row => {
      const docRef = doc(collection(db, 'production'));
      const pieceWeight = row.pieceWeight || 4.5;
      const metrics = calculateProductionMetrics(
        row.quantity,
        row.wasteQuantity,
        pieceWeight,
        { otherFaults: row.downtimeMinutes }
      );

      const recordPayload = {
        id: docRef.id,
        date: row.date,
        shiftId: row.resolvedShiftId || 'default-shift',
        shiftName: row.resolvedShiftName || 'وردية عامة',
        pressId: row.resolvedPressId || 'default-press',
        pressName: row.resolvedPressName || 'مكبس عام',
        productId: row.resolvedProductId || 'imported-prod',
        productCode: row.resolvedProductCode || row.productCodeOrName,
        productName: row.resolvedProductName || row.productCodeOrName,
        aluminaPercentage: 40,
        pieceWeight: pieceWeight,
        productionQuantity: metrics.productionQuantity,
        wasteQuantity: metrics.wasteQuantity,
        goodQuantity: metrics.goodQuantity,
        productionWeight: metrics.productionWeight,
        goodWeight: metrics.goodWeight,
        wasteWeight: metrics.wasteWeight,
        wastePercentage: metrics.wastePercentage,
        totalDowntimeMinutes: metrics.totalDowntimeMinutes,
        totalDowntimeHours: metrics.totalDowntimeHours,
        mechanicalFaults: 0,
        electricalFaults: 0,
        workshopFaults: 0,
        rawMaterialFaults: 0,
        furnaceFaults: 0,
        pressFaults: 0,
        otherFaults: row.downtimeMinutes,
        employeeIds: row.resolvedEmployeeId ? [row.resolvedEmployeeId] : [],
        employeeNames: row.resolvedEmployeeName ? [row.resolvedEmployeeName] : [],
        employeeCodes: row.resolvedEmployeeCode ? [row.resolvedEmployeeCode] : [],
        customerId: row.resolvedCustomerId || '',
        customerName: row.resolvedCustomerName || '',
        status: 'SUBMITTED',
        isHistoricalImport: true,
        createdBy: currentUser?.uid || 'SUPER_ADMIN',
        createdByName: currentUser?.email || 'مشرف الاستيراد التاريخي',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        serverCreatedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
      };

      batch.set(docRef, recordPayload);
    });

    try {
      await batch.commit();
      importedCount += chunk.length;
    } catch (err: any) {
      console.error('Batch import commit error:', err);
      errors.push(`فشل حفظ الدفعة ${Math.floor(i / CHUNK_SIZE) + 1}: ${err.message}`);
    }
  }

  await logAuditAction(
    'BULK_IMPORT',
    'production',
    'historical_excel',
    `استيراد إنتاج تاريخي من ملف Excel: ${importedCount} سجل بنجاح`
  );

  return { importedCount, errors };
}

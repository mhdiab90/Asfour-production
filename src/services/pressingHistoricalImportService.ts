/**
 * ASFOUR Factory Management ERP - Pressing Stage Historical Excel Import Service
 * 
 * Specialized high-precision historical data importer for مرحلة التشكيل والمكابس (Pressing):
 * - Exactly conforms to the 21 required columns and their strict sequence.
 * - Robust date normalization (Excel date serials, ISO dates, DD/MM/YYYY, Arabic numerals).
 * - Multi-worker resolution (Worker 1 required, Worker 2 optional) stored in structured arrays.
 * - Multi-furnace car parsing supporting separators (- , * , / , ,).
 * - Master Data matching for Presses, Shifts (strict 1/2 rule), Products, and Employees.
 * - Product Code Intelligence (Smart code auto-derivation vs numeric manual codes).
 * - Fault breakdown & downtime verification with calculated total comparison against Excel total.
 * - Deep duplicate detection (In-File and In-Database against Firestore production collection).
 * - Safe chunked batch commits (400 records per batch) with pre-import backup association.
 * - Historical tagging (sourceType: 'HISTORICAL_IMPORT', isHistoricalImport: true, preserved historical date).
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
  FurnaceCar, 
  ProductionRecord,
  PressingImportRow,
  PressingImportSummary,
  PressingImportStatus
} from '../types';
import { fetchMasterData } from './masterDataService';
import { fetchProductTypes } from './productTypeService';
import { parseProductCode } from '../utils/productCodeParser';
import { logAuditAction } from './auditService';
import { safeBatchSet } from '../utils/firestoreSanitizer';
import { calculateProductionMetrics } from './productionService';
import { toWesternDigits } from '../utils/formatters';

/**
 * EXACT 21 Columns required in this exact order for Pressing Historical Import
 */
export const PRESSING_IMPORT_HEADERS = [
  'التاريخ',
  'اسم عامل 1',
  'رقم سجل عامل 1',
  'اسم عامل 2',
  'رقم سجل عامل 2',
  'رقم العربات',
  'اسم المكبس',
  'طلب العميل',
  'رقم الوردية',
  'كود الصنف',
  'اسم الصنف',
  'نسبة الألومينا',
  'وزن القطعة (بالكيلو)',
  'الإنتاج بالعدد',
  'الهالك بالعدد',
  'أعطال ميكانيكا',
  'أعطال كهرباء',
  'أعطال ورشة',
  'أعطال خامات',
  'أعطال أخرى',
  'إجمالي الأعطال',
] as const;

/**
 * Helper: Normalize Arabic string for tolerant lookup
 */
export function normalizeArabicText(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F\u0640]/g, '') // Remove harakat and tatweel
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Helper: Convert any Excel date cell (number serial, date object, string) to YYYY-MM-DD
 */
export function normalizeDateInput(rawVal: any): { dateStr: string; isValid: boolean } {
  if (rawVal === undefined || rawVal === null || rawVal === '') {
    return { dateStr: '', isValid: false };
  }

  // 1. JS Date instance
  if (rawVal instanceof Date && !isNaN(rawVal.getTime())) {
    const y = rawVal.getFullYear();
    const m = String(rawVal.getMonth() + 1).padStart(2, '0');
    const d = String(rawVal.getDate()).padStart(2, '0');
    return { dateStr: `${y}-${m}-${d}`, isValid: true };
  }

  // 2. Numeric Excel Serial (e.g. 45350)
  if (typeof rawVal === 'number' && !isNaN(rawVal)) {
    if (rawVal > 1000 && rawVal < 100000) {
      try {
        const jsDate = new Date(Math.round((rawVal - 25569) * 86400 * 1000));
        if (!isNaN(jsDate.getTime())) {
          const y = jsDate.getUTCFullYear();
          const m = String(jsDate.getUTCMonth() + 1).padStart(2, '0');
          const d = String(jsDate.getUTCDate()).padStart(2, '0');
          return { dateStr: `${y}-${m}-${d}`, isValid: true };
        }
      } catch {
        // fallthrough
      }
    }
  }

  // 3. String representation
  const str = toWesternDigits(String(rawVal)).trim();
  if (!str) return { dateStr: '', isValid: false };

  // ISO: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[-/. ](\d{1,2})[-/. ](\d{1,2})/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const m = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (y >= 1970 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { 
        dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, 
        isValid: true 
      };
    }
  }

  // European / Middle-Eastern: DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = str.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{4})/);
  if (dmyMatch) {
    const d = parseInt(dmyMatch[1], 10);
    const m = parseInt(dmyMatch[2], 10);
    const y = parseInt(dmyMatch[3], 10);
    if (y >= 1970 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return { 
        dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, 
        isValid: true 
      };
    }
  }

  // Fallback try standard Date parsing
  const fallback = new Date(str);
  if (!isNaN(fallback.getTime()) && fallback.getFullYear() >= 1970 && fallback.getFullYear() <= 2100) {
    const y = fallback.getFullYear();
    const m = String(fallback.getMonth() + 1).padStart(2, '0');
    const d = String(fallback.getDate()).padStart(2, '0');
    return { dateStr: `${y}-${m}-${d}`, isValid: true };
  }

  return { dateStr: str, isValid: false };
}

/**
 * Generate and trigger download of the Pressing Historical Import Excel Template
 */
export function downloadPressingExcelTemplate(): void {
  // Sample row clearly labeled: مثال — لا يتم استيراده
  const sampleRow: Record<string, any> = {
    'التاريخ': '2026-03-01',
    'اسم عامل 1': 'أحمد علي',
    'رقم سجل عامل 1': '10025',
    'اسم عامل 2': 'محمد حسن',
    'رقم سجل عامل 2': '10026',
    'رقم العربات': 'FC01-FC02',
    'اسم المكبس': 'مكبس 1',
    'طلب العميل': 'ORD-9901 (شركة السويس للصلب)',
    'رقم الوردية': 1,
    'كود الصنف': 'BAR250102305',
    'اسم الصنف': 'طوب مقاوم للأحماض',
    'نسبة الألومينا': 25,
    'وزن القطعة (بالكيلو)': 4.5,
    'الإنتاج بالعدد': 1200,
    'الهالك بالعدد': 30,
    'أعطال ميكانيكا': 15,
    'أعطال كهرباء': 10,
    'أعطال ورشة': 5,
    'أعطال خامات': 0,
    'أعطال أخرى': 0,
    'إجمالي الأعطال': 30,
  };

  const ws = XLSX.utils.json_to_sheet([sampleRow], { 
    header: PRESSING_IMPORT_HEADERS as unknown as string[] 
  });
  
  // Set column widths for comfortable viewing
  ws['!cols'] = [
    { wch: 14 }, // التاريخ
    { wch: 18 }, // اسم عامل 1
    { wch: 16 }, // رقم سجل عامل 1
    { wch: 18 }, // اسم عامل 2
    { wch: 16 }, // رقم سجل عامل 2
    { wch: 18 }, // رقم العربات
    { wch: 16 }, // اسم المكبس
    { wch: 22 }, // طلب العميل
    { wch: 12 }, // رقم الوردية
    { wch: 18 }, // كود الصنف
    { wch: 24 }, // اسم الصنف
    { wch: 14 }, // نسبة الألومينا
    { wch: 18 }, // وزن القطعة (بالكيلو)
    { wch: 16 }, // الإنتاج بالعدد
    { wch: 16 }, // الهالك بالعدد
    { wch: 14 }, // أعطال ميكانيكا
    { wch: 14 }, // أعطال كهرباء
    { wch: 14 }, // أعطال ورشة
    { wch: 14 }, // أعطال خامات
    { wch: 14 }, // أعطال أخرى
    { wch: 14 }, // إجمالي الأعطال
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'قالب_استيراد_المكابس');
  
  const todayStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `ASFOUR_Template_Pressing_${todayStr}.xlsx`);
}

/**
 * Parse and Validate Uploaded Pressing Excel Buffer
 */
export async function parseAndValidatePressingExcel(
  fileBuffer: ArrayBuffer
): Promise<PressingImportSummary> {
  const workbook = XLSX.read(fileBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  // Fetch all necessary Master Data concurrently
  const [
    employees, 
    products, 
    customers, 
    shifts, 
    presses, 
    furnaceCars, 
    productTypes,
    existingProdSnap
  ] = await Promise.all([
    fetchMasterData<Employee>('employees'),
    fetchMasterData<Product>('products'),
    fetchMasterData<Customer>('customers'),
    fetchMasterData<Shift>('shifts'),
    fetchMasterData<Press>('presses'),
    fetchMasterData<FurnaceCar>('furnaceCars'),
    fetchProductTypes(),
    getDocs(collection(db, 'production')).catch(() => ({ docs: [] } as any)),
  ]);

  // Build In-Database index for duplicate detection
  // Composite Key: date + shift + press + product + order + worker1 + furnaceCars
  const dbRecordSet = new Set<string>();
  existingProdSnap.docs.forEach((docSnap: any) => {
    const d = docSnap.data() as ProductionRecord;
    const date = d.date || '';
    const shift = d.shiftCode || d.shiftName || d.shiftId || '';
    const press = d.pressCode || d.pressName || d.pressId || '';
    const prod = d.productCode || d.productId || '';
    const order = d.customerOrderNumber || '';
    const w1 = d.employeeCodes?.[0] || d.employeeNames?.[0] || d.employeeId || '';
    const cars = (d.furnaceCarNumbers || []).sort().join('-');
    const key = `${date}#${shift}#${press}#${prod}#${order}#${w1}#${cars}`.toLowerCase();
    dbRecordSet.add(key);
  });

  const inMemoryFileKeySet = new Set<string>();
  const parsedRows: PressingImportRow[] = [];

  let validRowsCount = 0;
  let warningRowsCount = 0;
  let errorRowsCount = 0;
  let duplicateRowsCount = 0;

  let unknownEmployeesCount = 0;
  let unknownProductsCount = 0;
  let unknownPressesCount = 0;
  let unknownFurnaceCarsCount = 0;
  let shiftErrorsCount = 0;
  let faultMismatchesCount = 0;

  for (let idx = 0; idx < rawRows.length; idx++) {
    const row = rawRows[idx];
    const rowIndex = idx + 2; // 1-based + 1 header row
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];
    let rowStatus: PressingImportStatus = 'NEW';
    let isDuplicate = false;
    let duplicateType: 'FILE' | 'DATABASE' | undefined = undefined;

    // Check if row is the sample explanatory row
    const dateRaw = row['التاريخ'] ?? row['date'] ?? row['Date'] ?? '';
    const sampleMarker = String(row['التاريخ'] || '') + String(row['اسم عامل 1'] || '');
    if (sampleMarker.includes('مثال') || sampleMarker.includes('لا يتم استيراده')) {
      continue; // Skip the sample guide row gracefully
    }

    // 1. DATE NORMALIZATION
    const { dateStr, isValid: isDateValid } = normalizeDateInput(dateRaw);
    if (!isDateValid || !dateStr) {
      rowErrors.push(`التاريخ غير صالح: "${dateRaw}"`);
      rowStatus = 'INVALID_DATE';
    }

    // 2. WORKER 1 (Required) & CODE
    const w1NameRaw = String(row['اسم عامل 1'] || row['العامل 1'] || row['اسم العامل'] || '').trim();
    const w1CodeRaw = toWesternDigits(String(row['رقم سجل عامل 1'] || row['كود عامل 1'] || row['كود العامل'] || '')).trim();

    let resolvedWorker1: { id: string; name: string; code: string; departmentName?: string } | undefined = undefined;

    if (!w1NameRaw && !w1CodeRaw) {
      rowErrors.push('اسم عامل 1 ورقم السجل مفقودان (حقل إجباري)');
      if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_EMPLOYEE';
      unknownEmployeesCount++;
    } else {
      // Find employee by name or code
      const normW1Name = normalizeArabicText(w1NameRaw);
      const matchedEmp = employees.find(e => {
        const eCode = toWesternDigits(String(e.code || '')).trim();
        const eNormName = normalizeArabicText(e.name);
        if (w1CodeRaw && eCode && eCode.toLowerCase() === w1CodeRaw.toLowerCase()) return true;
        if (normW1Name && eNormName === normW1Name) return true;
        return false;
      });

      if (!matchedEmp) {
        rowErrors.push(`عامل 1 (${w1NameRaw || w1CodeRaw}) غير مسجل بقاعدة بيانات الموظفين`);
        if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_EMPLOYEE';
        unknownEmployeesCount++;
      } else {
        // Verify code match if both provided
        const empCode = toWesternDigits(String(matchedEmp.code || '')).trim();
        if (w1CodeRaw && empCode && w1CodeRaw.toLowerCase() !== empCode.toLowerCase()) {
          rowErrors.push(`تعارض كود عامل 1: الكود المدخل [${w1CodeRaw}] لا يطابق كود الموظف المسجل [${empCode}] للاسم (${matchedEmp.name})`);
          if (rowStatus === 'NEW') rowStatus = 'EMPLOYEE_MISMATCH';
        } else {
          resolvedWorker1 = {
            id: matchedEmp.id || `emp-${matchedEmp.code || w1CodeRaw}`,
            name: matchedEmp.name,
            code: matchedEmp.code || w1CodeRaw,
            departmentName: matchedEmp.departmentName || 'قسم الكبس والتشكيل'
          };
        }
      }
    }

    // 3. WORKER 2 (Optional) & CODE
    const w2NameRaw = String(row['اسم عامل 2'] || row['العامل 2'] || '').trim();
    const w2CodeRaw = toWesternDigits(String(row['رقم سجل عامل 2'] || row['كود عامل 2'] || '')).trim();

    let resolvedWorker2: { id: string; name: string; code: string; departmentName?: string } | undefined = undefined;

    if (w2NameRaw || w2CodeRaw) {
      const normW2Name = normalizeArabicText(w2NameRaw);
      const matchedEmp2 = employees.find(e => {
        const eCode = toWesternDigits(String(e.code || '')).trim();
        const eNormName = normalizeArabicText(e.name);
        if (w2CodeRaw && eCode && eCode.toLowerCase() === w2CodeRaw.toLowerCase()) return true;
        if (normW2Name && eNormName === normW2Name) return true;
        return false;
      });

      if (!matchedEmp2) {
        rowErrors.push(`عامل 2 (${w2NameRaw || w2CodeRaw}) غير مسجل بقاعدة بيانات الموظفين`);
        if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_EMPLOYEE';
        unknownEmployeesCount++;
      } else {
        const emp2Code = toWesternDigits(String(matchedEmp2.code || '')).trim();
        if (w2CodeRaw && emp2Code && w2CodeRaw.toLowerCase() !== emp2Code.toLowerCase()) {
          rowErrors.push(`تعارض كود عامل 2: الكود المدخل [${w2CodeRaw}] لا يطابق كود الموظف المسجل [${emp2Code}] للاسم (${matchedEmp2.name})`);
          if (rowStatus === 'NEW') rowStatus = 'EMPLOYEE_MISMATCH';
        } else {
          resolvedWorker2 = {
            id: matchedEmp2.id || `emp-${matchedEmp2.code || w2CodeRaw}`,
            name: matchedEmp2.name,
            code: matchedEmp2.code || w2CodeRaw,
            departmentName: matchedEmp2.departmentName || 'قسم الكبس والتشكيل'
          };
        }
      }
    }

    // Combined Workers Structure
    const productionEmployees = [
      ...(resolvedWorker1 ? [resolvedWorker1] : []),
      ...(resolvedWorker2 ? [resolvedWorker2] : [])
    ];
    const employeeIds = productionEmployees.map(e => e.id);
    const employeeNames = productionEmployees.map(e => e.name);
    const employeeCodes = productionEmployees.map(e => e.code);

    // 4. FURNACE CARS (Separators: - , * , / , ,)
    const furnaceCarsRaw = String(row['رقم العربات'] || row['العربات'] || row['رقم العربة'] || '').trim();
    const rawCarParts = furnaceCarsRaw
      ? furnaceCarsRaw.split(/[-*/,،\s]+/).map(s => s.trim()).filter(Boolean)
      : [];

    const resolvedFurnaceCars: Array<{ id?: string; code: string; carNumber: string }> = [];
    const furnaceCarNumbers: string[] = [];
    const furnaceCarIds: string[] = [];
    const carCodes: string[] = [];

    for (const carCodeStr of rawCarParts) {
      const normCar = carCodeStr.toLowerCase();
      const matchedCar = furnaceCars.find(c => 
        (c.carNumber && c.carNumber.toLowerCase() === normCar) ||
        (c.code && c.code.toLowerCase() === normCar) ||
        (c.carCodeNormalized && c.carCodeNormalized === normCar) ||
        (c.carNumberNormalized && c.carNumberNormalized === normCar)
      );

      if (matchedCar) {
        resolvedFurnaceCars.push({
          id: matchedCar.id,
          code: matchedCar.code || carCodeStr,
          carNumber: matchedCar.carNumber || carCodeStr,
        });
        furnaceCarNumbers.push(matchedCar.carNumber || carCodeStr);
        if (matchedCar.id) furnaceCarIds.push(matchedCar.id);
        carCodes.push(matchedCar.code || carCodeStr);
      } else {
        rowErrors.push(`عربة الفرن "${carCodeStr}" غير مسجلة في بيانات عربات الأفران`);
        if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_FURNACE_CAR';
        unknownFurnaceCarsCount++;
      }
    }

    // 5. PRESS RESOLUTION
    const pressRaw = String(row['اسم المكبس'] || row['المكبس'] || row['رقم المكبس'] || '').trim();
    let resolvedPress: { id: string; name: string; code: string } | undefined = undefined;

    if (!pressRaw) {
      rowErrors.push('اسم المكبس مطلوب');
      if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_PRESS';
      unknownPressesCount++;
    } else {
      const normPress = normalizeArabicText(pressRaw);
      const matchedPress = presses.find(p => {
        const pNormName = normalizeArabicText(p.name);
        const pCode = String(p.code || '').trim().toLowerCase();
        if (pCode && pCode === pressRaw.toLowerCase()) return true;
        if (pNormName && pNormName === normPress) return true;
        return false;
      });

      if (matchedPress) {
        resolvedPress = {
          id: matchedPress.id || `press-${matchedPress.code || pressRaw}`,
          name: matchedPress.name || pressRaw,
          code: matchedPress.code || pressRaw,
        };
      } else {
        rowErrors.push(`المكبس "${pressRaw}" غير مسجل في بيانات المكابس الأساسية`);
        if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_PRESS';
        unknownPressesCount++;
      }
    }

    // 6. CUSTOMER ORDER
    const customerOrder = String(row['طلب العميل'] || row['رقم الطلب'] || row['أمر العميل'] || '').trim();
    let resolvedCustomerId: string | undefined = undefined;
    let resolvedCustomerName: string | undefined = undefined;

    if (customerOrder) {
      // Try to find customer if order text contains customer name
      const normOrder = normalizeArabicText(customerOrder);
      const matchedCustomer = customers.find(c => {
        const cNorm = normalizeArabicText(c.name);
        const cCode = String(c.code || '').trim().toLowerCase();
        if (cCode && normOrder.includes(cCode)) return true;
        if (cNorm && normOrder.includes(cNorm)) return true;
        return false;
      });
      if (matchedCustomer) {
        resolvedCustomerId = matchedCustomer.id;
        resolvedCustomerName = matchedCustomer.name;
      }
    }

    // 7. SHIFT RESOLUTION (Strictly 1 or 2)
    const shiftRaw = row['رقم الوردية'] ?? row['الوردية'] ?? row['shift'] ?? '';
    const shiftStr = toWesternDigits(String(shiftRaw)).trim();
    let resolvedShift: { id: string; name: string; code: string; hours?: number } | undefined = undefined;

    let shiftNum: number | null = null;
    if (shiftStr === '1' || shiftStr.includes('1') || shiftStr.includes('الأولى') || shiftStr.toLowerCase().includes('first')) {
      shiftNum = 1;
    } else if (shiftStr === '2' || shiftStr.includes('2') || shiftStr.includes('الثانية') || shiftStr.toLowerCase().includes('second')) {
      shiftNum = 2;
    }

    if (shiftNum !== 1 && shiftNum !== 2) {
      rowErrors.push(`رقم الوردية (${shiftRaw || 'فارغ'}) غير صالح. المسموح به فقط الوردية 1 أو الوردية 2.`);
      if (rowStatus === 'NEW') rowStatus = 'INVALID_SHIFT';
      shiftErrorsCount++;
    } else {
      const matchedShift = shifts.find(s => {
        const sCode = String(s.code || '').toLowerCase();
        const sName = String(s.name || '').toLowerCase();
        if (shiftNum === 1 && (sCode.includes('1') || sCode.includes('a') || sName.includes('1') || sName.includes('أولى') || sName.includes('صباحية'))) return true;
        if (shiftNum === 2 && (sCode.includes('2') || sCode.includes('b') || sName.includes('2') || sName.includes('ثانية') || sName.includes('مسائية'))) return true;
        return false;
      }) || shifts[shiftNum - 1] || {
        id: `shift-${shiftNum}`,
        code: `SHIFT-${shiftNum}`,
        name: `الوردية ${shiftNum === 1 ? 'الأولى' : 'الثانية'}`,
        hours: 8
      };

      resolvedShift = {
        id: matchedShift.id || `shift-${shiftNum}`,
        name: matchedShift.name || `الوردية ${shiftNum === 1 ? 'الأولى' : 'الثانية'}`,
        code: matchedShift.code || `SHIFT-${shiftNum}`,
        hours: matchedShift.hours || 8,
      };
    }

    // 8. PRODUCT CODE & NAME INTELLIGENCE
    const prodCodeRaw = String(row['كود الصنف'] || row['كود المنتج'] || row['كود'] || '').trim();
    const prodNameRaw = String(row['اسم الصنف'] || row['اسم المنتج'] || row['المنتج'] || '').trim();

    const smartParse = parseProductCode(prodCodeRaw, productTypes);
    let resolvedProduct: { id: string; name: string; code: string; pieceWeight?: number; aluminaPercentage?: number } | undefined = undefined;
    let productTypePrefix: string | undefined = undefined;
    let productTypeName: string | undefined = undefined;

    if (!prodCodeRaw && !prodNameRaw) {
      rowErrors.push('كود الصنف واسم الصنف مفقودان');
      if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_PRODUCT';
      unknownProductsCount++;
    } else {
      const normProdName = normalizeArabicText(prodNameRaw);
      const matchedProduct = products.find(p => {
        const pCode = String(p.code || p.productCode || '').trim().toLowerCase();
        const pNormName = normalizeArabicText(p.name);
        if (prodCodeRaw && pCode && pCode === prodCodeRaw.toLowerCase()) return true;
        if (normProdName && pNormName === normProdName) return true;
        return false;
      });

      if (!matchedProduct) {
        rowErrors.push(`الصنف (${prodCodeRaw || prodNameRaw}) غير موجود في دليل المنتجات الأساسية`);
        if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_PRODUCT';
        unknownProductsCount++;
      } else {
        // Check Product Code vs Name conflict
        const masterProdCode = String(matchedProduct.code || matchedProduct.productCode || '').trim();
        const masterProdNormName = normalizeArabicText(matchedProduct.name);

        if (prodCodeRaw && prodNameRaw && masterProdCode && masterProdNormName) {
          const isCodeMatch = prodCodeRaw.toLowerCase() === masterProdCode.toLowerCase();
          const isNameMatch = normProdName === masterProdNormName;

          if (!isCodeMatch && !isNameMatch) {
            rowErrors.push(`تعارض الصنف: كود الصنف [${prodCodeRaw}] واسم الصنف [${prodNameRaw}] لا يشيران لنفس المنتج في النظام`);
            if (rowStatus === 'NEW') rowStatus = 'PRODUCT_MISMATCH';
          }
        }

        resolvedProduct = {
          id: matchedProduct.id || `prod-${masterProdCode || prodCodeRaw}`,
          name: matchedProduct.name || prodNameRaw,
          code: masterProdCode || prodCodeRaw,
          pieceWeight: matchedProduct.pieceWeight,
          aluminaPercentage: matchedProduct.aluminaPercentage,
        };
      }
    }

    // Extract Smart classifications
    if (smartParse.isSmart && smartParse.prefix) {
      productTypePrefix = smartParse.prefix;
      productTypeName = smartParse.productType?.nameAr || smartParse.productType?.nameEn;
    }

    // 9. ALUMINA PERCENTAGE
    const aluminaRaw = row['نسبة الألومينا'] ?? row['الألومينا'] ?? '';
    let aluminaPercentage = 0;

    if (smartParse.isSmart && smartParse.aluminaPercentage !== undefined) {
      aluminaPercentage = smartParse.aluminaPercentage;
    } else {
      const parsedAlumina = parseFloat(toWesternDigits(String(aluminaRaw)));
      if (!isNaN(parsedAlumina) && parsedAlumina >= 0 && parsedAlumina <= 100) {
        aluminaPercentage = parsedAlumina;
      } else if (resolvedProduct?.aluminaPercentage !== undefined && resolvedProduct.aluminaPercentage > 0) {
        aluminaPercentage = resolvedProduct.aluminaPercentage;
      } else {
        aluminaPercentage = 0;
      }
    }

    // 10. PIECE WEIGHT (kg)
    const weightRaw = row['وزن القطعة (بالكيلو)'] ?? row['وزن القطعة'] ?? row['الوزن'] ?? '';
    let pieceWeight = 0;
    const parsedWeight = parseFloat(toWesternDigits(String(weightRaw)));

    if (!isNaN(parsedWeight) && parsedWeight > 0) {
      pieceWeight = parsedWeight;
    } else if (resolvedProduct?.pieceWeight && resolvedProduct.pieceWeight > 0) {
      pieceWeight = resolvedProduct.pieceWeight;
    } else {
      rowWarnings.push('وزن القطعة بالكيلو مفقود وغير مسجل بالمنتج');
      if (rowStatus === 'NEW') rowStatus = 'MISSING_PIECE_WEIGHT';
    }

    // 11. QUANTITIES & CALCULATIONS
    const prodQtyRaw = row['الإنتاج بالعدد'] ?? row['الإنتاج'] ?? row['إجمالي الإنتاج'] ?? 0;
    const wasteQtyRaw = row['الهالك بالعدد'] ?? row['الهالك'] ?? 0;

    const productionQuantity = parseInt(toWesternDigits(String(prodQtyRaw)), 10) || 0;
    const wasteQuantity = parseInt(toWesternDigits(String(wasteQtyRaw)), 10) || 0;

    if (isNaN(productionQuantity) || productionQuantity < 0) {
      rowErrors.push('كمية الإنتاج بالعدد يجب أن تكون رقماً صحيحاً أكبر من أو يساوي الصفر');
      if (rowStatus === 'NEW') rowStatus = 'INVALID_NUMBER';
    }

    if (isNaN(wasteQuantity) || wasteQuantity < 0) {
      rowErrors.push('كمية الهالك بالعدد يجب أن تكون رقماً صحيحاً أكبر من أو يساوي الصفر');
      if (rowStatus === 'NEW') rowStatus = 'INVALID_NUMBER';
    }

    if (wasteQuantity > productionQuantity && productionQuantity > 0) {
      rowWarnings.push(`تنبيه: كمية الهالك (${wasteQuantity}) أكبر من كمية الإنتاج (${productionQuantity})`);
    }

    const goodQuantity = Math.max(0, productionQuantity - wasteQuantity);
    const wastePercentage = productionQuantity > 0 
      ? Number(((wasteQuantity / productionQuantity) * 100).toFixed(2)) 
      : 0;

    const productionWeight = Number((productionQuantity * pieceWeight).toFixed(2));
    const goodWeight = Number((goodQuantity * pieceWeight).toFixed(2));
    const wasteWeight = Number((wasteQuantity * pieceWeight).toFixed(2));

    // 12. DOWNTIME / FAULT BREAKDOWN
    const parseFault = (val: any) => {
      const num = parseFloat(toWesternDigits(String(val || '0')));
      return (!isNaN(num) && num >= 0) ? num : 0;
    };

    const mechanicalFaults = parseFault(row['أعطال ميكانيكا'] ?? row['ميكانيكا']);
    const electricalFaults = parseFault(row['أعطال كهرباء'] ?? row['كهرباء']);
    const workshopFaults = parseFault(row['أعطال ورشة'] ?? row['ورشة']);
    const rawMaterialFaults = parseFault(row['أعطال خامات'] ?? row['خامات']);
    const otherFaults = parseFault(row['أعطال أخرى'] ?? row['أخرى']);

    const calculatedTotalFaults = mechanicalFaults + electricalFaults + workshopFaults + rawMaterialFaults + otherFaults;

    const excelTotalRaw = row['إجمالي الأعطال'] ?? row['إجمالي التوقف'] ?? row['التوقفات'];
    let excelTotalFaults: number | undefined = undefined;
    if (excelTotalRaw !== undefined && excelTotalRaw !== '') {
      const parsedExcelTotal = parseFloat(toWesternDigits(String(excelTotalRaw)));
      if (!isNaN(parsedExcelTotal)) {
        excelTotalFaults = parsedExcelTotal;
        if (Math.abs(parsedExcelTotal - calculatedTotalFaults) > 0.01) {
          rowWarnings.push(
            `عدم تطابق إجمالي الأعطال: المدخل في الملف (${parsedExcelTotal} دقيقة) لا يطابق مجموع الأعطال المحسوبة (${calculatedTotalFaults} دقيقة)`
          );
          if (rowStatus === 'NEW') rowStatus = 'FAULT_TOTAL_MISMATCH';
          faultMismatchesCount++;
        }
      }
    }

    // 13. DUPLICATE DETECTION
    // Key: date + shift + press + product + order + worker1 + furnaceCars
    const shiftKeyPart = resolvedShift?.code || shiftStr || '';
    const pressKeyPart = resolvedPress?.code || pressRaw || '';
    const prodKeyPart = resolvedProduct?.code || prodCodeRaw || '';
    const w1KeyPart = resolvedWorker1?.code || w1CodeRaw || w1NameRaw || '';
    const carsKeyPart = furnaceCarNumbers.sort().join('-');

    const duplicateCompositeKey = `${dateStr}#${shiftKeyPart}#${pressKeyPart}#${prodKeyPart}#${customerOrder}#${w1KeyPart}#${carsKeyPart}`.toLowerCase();

    if (inMemoryFileKeySet.has(duplicateCompositeKey)) {
      isDuplicate = true;
      duplicateType = 'FILE';
      rowErrors.push('صف مكرر داخل نفس ملف الـ Excel المرفوع');
      rowStatus = 'DUPLICATE_IN_FILE';
      duplicateRowsCount++;
    } else if (dbRecordSet.has(duplicateCompositeKey)) {
      isDuplicate = true;
      duplicateType = 'DATABASE';
      rowWarnings.push('يوجد سجل مطابق مسبقاً في قاعدة بيانات الإنتاج (Firestore)');
      if (rowStatus === 'NEW') rowStatus = 'DUPLICATE_IN_DATABASE';
      duplicateRowsCount++;
    } else {
      inMemoryFileKeySet.add(duplicateCompositeKey);
    }

    // Final Row Status Categorization
    if (rowErrors.length > 0) {
      if (rowStatus === 'NEW') rowStatus = 'INVALID_ROW';
      errorRowsCount++;
    } else if (rowWarnings.length > 0 || isDuplicate) {
      if (rowStatus === 'NEW') rowStatus = 'WARNING';
      warningRowsCount++;
    } else {
      rowStatus = 'VALID';
      validRowsCount++;
    }

    parsedRows.push({
      rowIndex,
      raw: row,
      date: dateStr,
      
      worker1Name: w1NameRaw,
      worker1Code: w1CodeRaw,
      resolvedWorker1,
      worker2Name: w2NameRaw,
      worker2Code: w2CodeRaw,
      resolvedWorker2,
      productionEmployees,
      employeeIds,
      employeeNames,
      employeeCodes,
      
      furnaceCarsRaw,
      resolvedFurnaceCars,
      furnaceCarNumbers,
      furnaceCarIds,
      carCodes,
      
      pressRaw,
      resolvedPress,
      
      customerOrder,
      resolvedCustomerId,
      resolvedCustomerName,
      
      shiftRaw,
      resolvedShift,
      
      productCodeRaw: prodCodeRaw,
      productNameRaw: prodNameRaw,
      resolvedProduct,
      productTypePrefix,
      productTypeName,
      aluminaPercentage,
      pieceWeight,
      
      productionQuantity,
      wasteQuantity,
      goodQuantity,
      wastePercentage,
      productionWeight,
      goodWeight,
      wasteWeight,
      
      mechanicalFaults,
      electricalFaults,
      workshopFaults,
      rawMaterialFaults,
      otherFaults,
      calculatedTotalFaults,
      excelTotalFaults,
      
      status: rowStatus,
      errors: rowErrors,
      warnings: rowWarnings,
      isDuplicate,
      duplicateType,
    });
  }

  return {
    totalRows: parsedRows.length,
    validRows: validRowsCount,
    warningRows: warningRowsCount,
    errorRows: errorRowsCount,
    duplicateRows: duplicateRowsCount,
    unknownEmployeesCount,
    unknownProductsCount,
    unknownPressesCount,
    unknownFurnaceCarsCount,
    shiftErrorsCount,
    faultMismatchesCount,
    rows: parsedRows,
  };
}

/**
 * Execute Safe Batch Import for Pressing Records
 * Commits up to 400 documents per batch with audit logging and backup association
 */
export async function executePressingBatchImport(
  rowsToImport: PressingImportRow[],
  backupId?: string,
  onProgress?: (percent: number, currentBatch: number, totalBatches: number) => void
): Promise<{
  importedCount: number;
  failedCount: number;
  skippedCount: number;
  errors: string[];
  importId: string;
}> {
  const currentUser = auth.currentUser;
  const now = new Date();
  const sessionImportId = `HIST-IMP-${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  // Filter out fatal rows
  const importableRows = rowsToImport.filter(r => r.errors.length === 0);
  const skippedCount = rowsToImport.length - importableRows.length;

  const BATCH_SIZE = 400;
  const totalBatches = Math.ceil(importableRows.length / BATCH_SIZE) || 1;
  let importedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const chunk = importableRows.slice(batchIndex * BATCH_SIZE, (batchIndex + 1) * BATCH_SIZE);
    if (chunk.length === 0) continue;

    const batch = writeBatch(db);

    chunk.forEach(row => {
      const docRef = doc(collection(db, 'production'));
      const pieceWeight = row.pieceWeight || 0;

      const recordPayload: ProductionRecord = {
        id: docRef.id,
        date: row.date, // Preserves the exact historical production date!
        
        // Shift
        shiftId: row.resolvedShift?.id || 'default-shift-1',
        shiftName: row.resolvedShift?.name || (row.shiftRaw == 2 ? 'الوردية الثانية' : 'الوردية الأولى'),
        shiftCode: row.resolvedShift?.code || (row.shiftRaw == 2 ? 'SHIFT-2' : 'SHIFT-1'),
        
        // Workers & Team
        employeeId: row.resolvedWorker1?.id || row.employeeIds?.[0] || 'default-emp',
        employeeIds: row.employeeIds || [],
        employeeNames: row.employeeNames || [],
        employeeCodes: row.employeeCodes || [],
        productionEmployees: row.productionEmployees || [],
        
        // Equipment (Press & Cars)
        pressId: row.resolvedPress?.id || 'default-press',
        pressName: row.resolvedPress?.name || row.pressRaw || 'مكبس 1',
        pressCode: row.resolvedPress?.code || row.pressRaw || 'P-01',
        
        furnaceCarIds: row.furnaceCarIds || [],
        furnaceCarNumbers: row.furnaceCarNumbers || [],
        carCodes: row.carCodes || [],
        carCode: row.furnaceCarsRaw || undefined,
        
        // Customer & Order
        customerOrderNumber: row.customerOrder || undefined,
        customerId: row.resolvedCustomerId || undefined,
        customerName: row.resolvedCustomerName || (row.customerOrder ? row.customerOrder : undefined),
        
        // Product & Specs
        productId: row.resolvedProduct?.id || 'historical-prod',
        productName: row.resolvedProduct?.name || row.productNameRaw || row.productCodeRaw,
        productCode: row.resolvedProduct?.code || row.productCodeRaw,
        productTypePrefix: row.productTypePrefix,
        productTypeName: row.productTypeName,
        aluminaPercentage: row.aluminaPercentage,
        pieceWeight: pieceWeight,
        
        // Quantities & Calculations
        productionQuantity: row.productionQuantity,
        wasteQuantity: row.wasteQuantity,
        goodQuantity: row.goodQuantity,
        productionWeight: row.productionWeight,
        goodWeight: row.goodWeight,
        wasteWeight: row.wasteWeight,
        wastePercentage: row.wastePercentage,
        
        // Downtimes & Faults
        mechanicalFaults: row.mechanicalFaults,
        electricalFaults: row.electricalFaults,
        workshopFaults: row.workshopFaults,
        rawMaterialFaults: row.rawMaterialFaults,
        furnaceFaults: 0,
        pressFaults: 0,
        otherFaults: row.otherFaults,
        totalDowntimeMinutes: row.calculatedTotalFaults,
        totalDowntimeHours: Number((row.calculatedTotalFaults / 60).toFixed(2)),
        
        // Historical Metadata Tags
        notes: `استيراد تاريخي - مرحلة التشكيل والمكابس | ملف: ${sessionImportId}`,
        createdBy: currentUser?.uid || 'SUPER_ADMIN',
        createdByName: currentUser?.email || 'مشرف الاستيراد التاريخي',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Add extra audit tags safely
      const enrichedPayload: any = {
        ...recordPayload,
        serverCreatedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
        sourceType: 'HISTORICAL_IMPORT',
        isHistoricalImport: true,
        importId: sessionImportId,
        importedAt: new Date().toISOString(),
        importedByUid: currentUser?.uid || 'SUPER_ADMIN',
        importedByName: currentUser?.email || 'مشرف الاستيراد التاريخي',
        ...(backupId ? { backupId } : {}),
      };

      safeBatchSet(batch, docRef, enrichedPayload);
    });

    try {
      await batch.commit();
      importedCount += chunk.length;
    } catch (err: any) {
      console.error(`Pressing batch ${batchIndex + 1} commit error:`, err);
      failedCount += chunk.length;
      errors.push(`فشل حفظ الدفعة ${batchIndex + 1} من ${totalBatches}: ${err.message}`);
    }

    if (onProgress) {
      const percent = Math.round(((batchIndex + 1) / totalBatches) * 100);
      onProgress(percent, batchIndex + 1, totalBatches);
    }
  }

  // Record Audit Trail
  await logAuditAction(
    'BULK_IMPORT',
    'production',
    sessionImportId,
    `استيراد إنتاج تاريخي - مرحلة المكابس: تم استيراد ${importedCount} سجل بنجاح، وتخطي ${skippedCount} سجل، وفشل ${failedCount} سجل. ${backupId ? `(رقم النسخة الوقائية: ${backupId})` : ''}`
  ).catch(err => console.warn('Audit logging warning:', err));

  return {
    importedCount,
    failedCount,
    skippedCount,
    errors,
    importId: sessionImportId,
  };
}

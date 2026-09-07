/**
 * ASFOUR Factory Management ERP - Pressing Stage Historical Excel Import Service
 * 
 * Specialized high-precision historical data importer for مرحلة التشكيل والمكابس (Pressing):
 * - Exactly conforms to the 21 required columns and their strict sequence.
 * - Robust date normalization (Excel date serials, ISO dates, DD/MM/YYYY, Arabic numerals).
 * - Multi-worker resolution (Worker 1 required, Worker 2 optional) stored in structured arrays.
 * - Multi-furnace car parsing supporting separators (- , * , / , ,).
 * - Master Data matching for Presses, Shifts (1/2/3 - see utils/shiftUtils.ts), Products, and Employees.
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
  query,
  where,
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
  PressingImportStatus,
  FurnaceCarBrickPair
} from '../types';
import { fetchMasterData } from './masterDataService';
import { fetchProductTypes } from './productTypeService';
import { parseProductCode } from '../utils/productCodeParser';
import { logAuditAction } from './auditService';
import { safeBatchSet, safeSetDoc } from '../utils/firestoreSanitizer';
import { runChunkedWriteWithFallback } from './tubeBallMillsChunkedWritePure';
import { calculateProductionMetrics } from './productionService';
import { toWesternDigits } from '../utils/formatters';
import { findBestFuzzyCandidates, ProposedMatchCandidate } from '../utils/fuzzyMatching';
import {
  buildPressingDuplicateKey,
  pressingIdentityFromRow,
  pressingIdentityFromFirestoreDoc,
} from './pressingDuplicateIdentityPure';
import { 
  loadApprovedMappings, 
  getDomainApprovedMappings, 
  logHistoricalImportExecution, 
  saveApprovedMappingBatch 
} from './importMappingService';
import { parseMultiCodeValue, parseFurnaceCarBrickPairs } from '../utils/multiCodeParser';
import { parseShiftNumber, isValidShiftNumber, buildShiftDisplayName, buildShiftCode } from '../utils/shiftUtils';
import { evaluateProductionWarnings, buildInvalidShiftMessage } from '../utils/businessValidationRules';

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
    existingProdSnap,
    approvedMappings
  ] = await Promise.all([
    fetchMasterData<Employee>('employees'),
    fetchMasterData<Product>('products'),
    fetchMasterData<Customer>('customers'),
    fetchMasterData<Shift>('shifts'),
    fetchMasterData<Press>('presses'),
    fetchMasterData<FurnaceCar>('furnaceCars'),
    fetchProductTypes(),
    getDocs(collection(db, 'production')).catch(() => ({ docs: [] } as any)),
    loadApprovedMappings().catch(() => ({} as Record<string, Record<string, string>>)),
  ]);

  // Build In-Database index for duplicate detection
  // Composite Key: date + shift + press + product + order + worker1 + furnaceCars
  // (PHASE 4F: now built via the shared pure helper - see
  // pressingDuplicateIdentityPure.ts - reused verbatim by the final live
  // recheck below, instead of two separately-maintained copies of this logic.)
  const dbRecordSet = new Set<string>();
  existingProdSnap.docs.forEach((docSnap: any) => {
    const d = docSnap.data() as ProductionRecord;
    dbRecordSet.add(buildPressingDuplicateKey(pressingIdentityFromFirestoreDoc(d)));
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
  let highConfidenceMatchesCount = 0;
  let unresolvedMismatchesCount = 0;

  for (let idx = 0; idx < rawRows.length; idx++) {
    const row = rawRows[idx];
    const rowIndex = idx + 2; // 1-based + 1 header row
    const rowErrors: string[] = [];
    const rowWarnings: string[] = [];
    const proposedMatches: NonNullable<PressingImportRow['proposedMatches']> = [];
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
      // Find employee by name, code or approved mapping
      const normW1Name = normalizeArabicText(w1NameRaw);
      let matchedEmp = employees.find(e => {
        const eCode = toWesternDigits(String(e.code || '')).trim();
        const eNormName = normalizeArabicText(e.name);
        if (w1CodeRaw && eCode && eCode.toLowerCase() === w1CodeRaw.toLowerCase()) return true;
        if (normW1Name && eNormName === normW1Name) return true;
        return false;
      });

      // Check approved mapping memory
      if (!matchedEmp && normW1Name && approvedMappings['employee']?.[normW1Name]) {
        const mappedId = approvedMappings['employee'][normW1Name];
        matchedEmp = employees.find(e => e.id === mappedId);
      }

      if (!matchedEmp) {
        // Run Fuzzy Candidate Detection
        const fuzzyCandidates = findBestFuzzyCandidates(w1NameRaw || w1CodeRaw, employees, {
          extractCode: (e) => e.code,
          extractName: (e) => e.name,
          minConfidence: 65,
          maxResults: 4,
        });

        if (fuzzyCandidates.length > 0) {
          const top = fuzzyCandidates[0];
          proposedMatches.push({
            fieldDomain: 'employee1',
            fieldNameAr: 'عامل 1',
            fieldNameEn: 'Worker 1',
            importedValue: w1NameRaw || w1CodeRaw,
            suggestedId: top.id,
            suggestedCode: top.code,
            suggestedName: top.name,
            confidence: top.confidence,
            matchType: top.matchType,
            reasonAr: top.reasonAr,
            reasonEn: top.reasonEn,
            decision: top.confidence >= 90 ? 'ACCEPTED' : 'PENDING',
            candidates: fuzzyCandidates,
          });

          if (top.confidence >= 90) {
            highConfidenceMatchesCount++;
            const candidateEmp = employees.find(e => e.id === top.id);
            if (candidateEmp) {
              resolvedWorker1 = {
                id: candidateEmp.id || `emp-${candidateEmp.code}`,
                name: candidateEmp.name,
                code: candidateEmp.code || w1CodeRaw,
                departmentName: candidateEmp.departmentName || 'قسم الكبس والتشكيل',
              };
              rowWarnings.push(`تمت المطابقة الذكية لعامل 1: "${w1NameRaw}" -> "${candidateEmp.name}" (دقة ${top.confidence}%)`);
            }
          } else {
            unresolvedMismatchesCount++;
            rowErrors.push(`عامل 1 (${w1NameRaw || w1CodeRaw}) غير مسجل بقاعدة بيانات الموظفين - يتطلب مراجعة بشرية`);
            if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_EMPLOYEE';
            unknownEmployeesCount++;
          }
        } else {
          unresolvedMismatchesCount++;
          rowErrors.push(`عامل 1 (${w1NameRaw || w1CodeRaw}) غير مسجل بقاعدة بيانات الموظفين`);
          if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_EMPLOYEE';
          unknownEmployeesCount++;
        }
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
      let matchedEmp2 = employees.find(e => {
        const eCode = toWesternDigits(String(e.code || '')).trim();
        const eNormName = normalizeArabicText(e.name);
        if (w2CodeRaw && eCode && eCode.toLowerCase() === w2CodeRaw.toLowerCase()) return true;
        if (normW2Name && eNormName === normW2Name) return true;
        return false;
      });

      if (!matchedEmp2 && normW2Name && approvedMappings['employee']?.[normW2Name]) {
        const mappedId = approvedMappings['employee'][normW2Name];
        matchedEmp2 = employees.find(e => e.id === mappedId);
      }

      if (!matchedEmp2) {
        const fuzzyCandidates = findBestFuzzyCandidates(w2NameRaw || w2CodeRaw, employees, {
          extractCode: (e) => e.code,
          extractName: (e) => e.name,
          minConfidence: 65,
          maxResults: 4,
        });

        if (fuzzyCandidates.length > 0) {
          const top = fuzzyCandidates[0];
          proposedMatches.push({
            fieldDomain: 'employee2',
            fieldNameAr: 'عامل 2',
            fieldNameEn: 'Worker 2',
            importedValue: w2NameRaw || w2CodeRaw,
            suggestedId: top.id,
            suggestedCode: top.code,
            suggestedName: top.name,
            confidence: top.confidence,
            matchType: top.matchType,
            reasonAr: top.reasonAr,
            reasonEn: top.reasonEn,
            decision: top.confidence >= 90 ? 'ACCEPTED' : 'PENDING',
            candidates: fuzzyCandidates,
          });

          if (top.confidence >= 90) {
            highConfidenceMatchesCount++;
            const candidateEmp = employees.find(e => e.id === top.id);
            if (candidateEmp) {
              resolvedWorker2 = {
                id: candidateEmp.id || `emp-${candidateEmp.code}`,
                name: candidateEmp.name,
                code: candidateEmp.code || w2CodeRaw,
                departmentName: candidateEmp.departmentName || 'قسم الكبس والتشكيل',
              };
              rowWarnings.push(`تمت المطابقة الذكية لعامل 2: "${w2NameRaw}" -> "${candidateEmp.name}" (دقة ${top.confidence}%)`);
            }
          } else {
            unresolvedMismatchesCount++;
            rowErrors.push(`عامل 2 (${w2NameRaw || w2CodeRaw}) غير مسجل بقاعدة بيانات الموظفين`);
            if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_EMPLOYEE';
            unknownEmployeesCount++;
          }
        } else {
          rowErrors.push(`عامل 2 (${w2NameRaw || w2CodeRaw}) غير مسجل بقاعدة بيانات الموظفين`);
          if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_EMPLOYEE';
          unknownEmployeesCount++;
        }
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

    // 4. FURNACE CARS + BRICK COUNT
    // NEW business format: "CAR-BRICKS/CAR-BRICKS/..." - '/' separates car
    // records, '-' separates a car's number from its brick count within one
    // record. Only carNumber is ever Master Data; brickCount is transactional.
    // This intentionally does NOT use the old flat multi-code splitter -
    // "278-453/254-880" now means 2 cars, never 4 independent codes.
    const furnaceCarsRaw = String(row['رقم العربات'] || row['العربات'] || row['رقم العربة'] || '').trim();
    const furnaceCarBrickPairs: FurnaceCarBrickPair[] = parseFurnaceCarBrickPairs(furnaceCarsRaw);
    const rawCarParts = furnaceCarBrickPairs.map(p => p.carNumber).filter(Boolean);

    const resolvedFurnaceCars: Array<{ id?: string; code: string; carNumber: string; brickCount?: number | null }> = [];
    const furnaceCarNumbers: string[] = [];
    const furnaceCarIds: string[] = [];
    const furnaceCarBrickCounts: number[] = [];
    const carCodes: string[] = [];

    if (furnaceCarBrickPairs.length > 1) {
      rowWarnings.push(`تم تقسيم البيان إلى ${furnaceCarBrickPairs.length} عربة/عربات منفصلة.`);
    }

    // Incomplete/malformed pairs (#6) - never silently discarded.
    const errorReasonMessage: Record<NonNullable<FurnaceCarBrickPair['errorReason']>, string> = {
      MISSING_BRICK_COUNT: 'عدد الطوب مفقود',
      INVALID_BRICK_COUNT: 'عدد الطوب غير صالح (يجب أن يكون رقماً صحيحاً غير سالب)',
      MISSING_CAR_NUMBER: 'رقم العربة مفقود',
      MALFORMED: 'صيغة غير صالحة',
    };
    for (const pair of furnaceCarBrickPairs) {
      if (!pair.isValid) {
        rowErrors.push(`إدخال عربة فرن غير مكتمل: "${pair.raw}" - ${errorReasonMessage[pair.errorReason || 'MALFORMED']}.`);
        if (rowStatus === 'NEW') rowStatus = 'INCOMPLETE_FURNACE_CAR_ENTRY';
      }
    }

    // Duplicate car number within the SAME row (#7) - never silently merged;
    // both occurrences stay visible in the review matrix so the operator can
    // see exactly which brick counts are in conflict and resolve explicitly.
    const carNumberOccurrences = new Map<string, number>();
    for (const pair of furnaceCarBrickPairs) {
      if (!pair.isValid || !pair.carNumber) continue;
      const norm = pair.carNumber.toLowerCase();
      carNumberOccurrences.set(norm, (carNumberOccurrences.get(norm) || 0) + 1);
    }
    const duplicateCarNumbersFlagged = new Set<string>();
    for (const pair of furnaceCarBrickPairs) {
      if (!pair.isValid || !pair.carNumber) continue;
      const norm = pair.carNumber.toLowerCase();
      if ((carNumberOccurrences.get(norm) || 0) > 1 && !duplicateCarNumbersFlagged.has(norm)) {
        duplicateCarNumbersFlagged.add(norm);
        rowErrors.push(`العربة ${pair.carNumber} مكررة بأكثر من عدد طوب. / Furnace Car ${pair.carNumber} appears more than once with different brick counts.`);
        if (rowStatus === 'NEW') rowStatus = 'DUPLICATE_FURNACE_CAR';
      }
    }

    for (const pair of furnaceCarBrickPairs) {
      if (!pair.isValid) continue; // already reported as an incomplete entry above

      const carCodeStr = pair.carNumber;
      const normCar = carCodeStr.toLowerCase();
      // Master Data matching is performed ONLY against the car number -
      // never against the "CAR-BRICKS" combined string.
      let matchedCar = furnaceCars.find(c =>
        (c.carNumber && c.carNumber.toLowerCase() === normCar) ||
        (c.code && c.code.toLowerCase() === normCar) ||
        (c.carCodeNormalized && c.carCodeNormalized === normCar) ||
        (c.carNumberNormalized && c.carNumberNormalized === normCar)
      );

      if (!matchedCar && approvedMappings['furnace_car']?.[normCar]) {
        const mappedId = approvedMappings['furnace_car'][normCar];
        matchedCar = furnaceCars.find(c => c.id === mappedId);
      }

      if (matchedCar) {
        resolvedFurnaceCars.push({
          id: matchedCar.id,
          code: matchedCar.code || carCodeStr,
          carNumber: matchedCar.carNumber || carCodeStr,
          brickCount: pair.brickCount,
        });
        furnaceCarNumbers.push(matchedCar.carNumber || carCodeStr);
        if (matchedCar.id) furnaceCarIds.push(matchedCar.id);
        furnaceCarBrickCounts.push(pair.brickCount ?? 0);
        carCodes.push(matchedCar.code || carCodeStr);
      } else {
        const carCandidates = findBestFuzzyCandidates(carCodeStr, furnaceCars, {
          extractCode: (c) => c.code || c.carNumber,
          extractName: (c) => c.carNumber || c.code,
          minConfidence: 70,
          maxResults: 3,
        });

        if (carCandidates.length > 0) {
          const top = carCandidates[0];
          proposedMatches.push({
            fieldDomain: 'furnaceCar',
            fieldNameAr: `عربة الفرن (${carCodeStr})`,
            fieldNameEn: `Furnace Car (${carCodeStr})`,
            importedValue: carCodeStr,
            suggestedId: top.id,
            suggestedCode: top.code,
            suggestedName: top.name,
            confidence: top.confidence,
            matchType: top.matchType,
            reasonAr: top.reasonAr,
            reasonEn: top.reasonEn,
            decision: top.confidence >= 90 ? 'ACCEPTED' : 'PENDING',
            candidates: carCandidates,
          });

          if (top.confidence >= 90) {
            highConfidenceMatchesCount++;
            resolvedFurnaceCars.push({
              id: top.id,
              code: top.code,
              carNumber: top.name,
              brickCount: pair.brickCount,
            });
            furnaceCarNumbers.push(top.name);
            if (top.id) furnaceCarIds.push(top.id);
            furnaceCarBrickCounts.push(pair.brickCount ?? 0);
            carCodes.push(top.code);
            rowWarnings.push(`مطابقة ذكية لعربة الفرن: "${carCodeStr}" -> "${top.name}" (${top.confidence}%)`);
          } else {
            unresolvedMismatchesCount++;
            rowErrors.push(`العربة ${carCodeStr} غير مسجلة.`);
            if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_FURNACE_CAR';
            unknownFurnaceCarsCount++;
          }
        } else {
          rowErrors.push(`العربة ${carCodeStr} غير مسجلة.`);
          if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_FURNACE_CAR';
          unknownFurnaceCarsCount++;
        }
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
      let matchedPress = presses.find(p => {
        const pNormName = normalizeArabicText(p.name);
        const pCode = String(p.code || '').trim().toLowerCase();
        if (pCode && pCode === pressRaw.toLowerCase()) return true;
        if (pNormName && pNormName === normPress) return true;
        return false;
      });

      if (!matchedPress && normPress && approvedMappings['press']?.[normPress]) {
        const mappedId = approvedMappings['press'][normPress];
        matchedPress = presses.find(p => p.id === mappedId);
      }

      if (matchedPress) {
        resolvedPress = {
          id: matchedPress.id || `press-${matchedPress.code || pressRaw}`,
          name: matchedPress.name || pressRaw,
          code: matchedPress.code || pressRaw,
        };
      } else {
        const pressCandidates = findBestFuzzyCandidates(pressRaw, presses, {
          extractCode: (p) => p.code,
          extractName: (p) => p.name,
          minConfidence: 65,
          maxResults: 3,
        });

        if (pressCandidates.length > 0) {
          const top = pressCandidates[0];
          proposedMatches.push({
            fieldDomain: 'press',
            fieldNameAr: 'المكبس',
            fieldNameEn: 'Press Machine',
            importedValue: pressRaw,
            suggestedId: top.id,
            suggestedCode: top.code,
            suggestedName: top.name,
            confidence: top.confidence,
            matchType: top.matchType,
            reasonAr: top.reasonAr,
            reasonEn: top.reasonEn,
            decision: top.confidence >= 90 ? 'ACCEPTED' : 'PENDING',
            candidates: pressCandidates,
          });

          if (top.confidence >= 90) {
            highConfidenceMatchesCount++;
            resolvedPress = {
              id: top.id,
              name: top.name,
              code: top.code,
            };
            rowWarnings.push(`مطابقة ذكية للمكبس: "${pressRaw}" -> "${top.name}" (${top.confidence}%)`);
          } else {
            unresolvedMismatchesCount++;
            rowErrors.push(`المكبس "${pressRaw}" غير مسجل في بيانات المكابس الأساسية`);
            if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_PRESS';
            unknownPressesCount++;
          }
        } else {
          rowErrors.push(`المكبس "${pressRaw}" غير مسجل في بيانات المكابس الأساسية`);
          if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_PRESS';
          unknownPressesCount++;
        }
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

    // 7. SHIFT RESOLUTION (1, 2, or 3 - all equally valid, see utils/shiftUtils.ts)
    const shiftRaw = row['رقم الوردية'] ?? row['الوردية'] ?? row['shift'] ?? '';
    const shiftStr = toWesternDigits(String(shiftRaw)).trim();
    let resolvedShift: { id: string; name: string; code: string; hours?: number } | undefined = undefined;

    const shiftNum = parseShiftNumber(shiftRaw);

    if (!isValidShiftNumber(shiftNum)) {
      rowErrors.push(buildInvalidShiftMessage(shiftRaw, 'ar'));
      if (rowStatus === 'NEW') rowStatus = 'INVALID_SHIFT';
      shiftErrorsCount++;
    } else {
      const matchedShift = shifts.find(s => {
        const sCode = String(s.code || '').toLowerCase();
        const sName = String(s.name || '').toLowerCase();
        if (shiftNum === 1 && (sCode.includes('1') || sCode.includes('a') || sName.includes('1') || sName.includes('أولى') || sName.includes('صباحية'))) return true;
        if (shiftNum === 2 && (sCode.includes('2') || sCode.includes('b') || sName.includes('2') || sName.includes('ثانية') || sName.includes('مسائية'))) return true;
        if (shiftNum === 3 && (sCode.includes('3') || sCode.includes('c') || sName.includes('3') || sName.includes('ثالثة') || sName.includes('ليلية'))) return true;
        return false;
      }) || shifts[shiftNum - 1] || {
        id: `shift-${shiftNum}`,
        code: buildShiftCode(shiftNum),
        name: buildShiftDisplayName(shiftNum, 'ar'),
        hours: 8
      };

      resolvedShift = {
        id: matchedShift.id || `shift-${shiftNum}`,
        name: matchedShift.name || buildShiftDisplayName(shiftNum, 'ar'),
        code: matchedShift.code || buildShiftCode(shiftNum),
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
      let matchedProduct = products.find(p => {
        const pCode = String(p.code || p.productCode || '').trim().toLowerCase();
        const pNormName = normalizeArabicText(p.name);
        if (prodCodeRaw && pCode && pCode === prodCodeRaw.toLowerCase()) return true;
        if (normProdName && pNormName === normProdName) return true;
        return false;
      });

      // Check approved mapping memory
      if (!matchedProduct) {
        const keyToLook = normProdName || prodCodeRaw.toLowerCase();
        if (approvedMappings['product']?.[keyToLook]) {
          const mappedId = approvedMappings['product'][keyToLook];
          matchedProduct = products.find(p => p.id === mappedId);
        }
      }

      if (!matchedProduct) {
        // Run Fuzzy Matching for Product
        const prodCandidates = findBestFuzzyCandidates(prodNameRaw || prodCodeRaw, products, {
          extractCode: (p) => p.code || p.productCode,
          extractName: (p) => p.name || p.productName,
          minConfidence: 65,
          maxResults: 4,
        });

        if (prodCandidates.length > 0) {
          const top = prodCandidates[0];
          proposedMatches.push({
            fieldDomain: 'product',
            fieldNameAr: 'الصنف / المنتج',
            fieldNameEn: 'Product / Item',
            importedValue: prodNameRaw || prodCodeRaw,
            suggestedId: top.id,
            suggestedCode: top.code,
            suggestedName: top.name,
            confidence: top.confidence,
            matchType: top.matchType,
            reasonAr: top.reasonAr,
            reasonEn: top.reasonEn,
            decision: top.confidence >= 90 ? 'ACCEPTED' : 'PENDING',
            candidates: prodCandidates,
          });

          if (top.confidence >= 90) {
            highConfidenceMatchesCount++;
            const candidateProd = products.find(p => p.id === top.id);
            if (candidateProd) {
              resolvedProduct = {
                id: candidateProd.id || `prod-${candidateProd.code}`,
                name: candidateProd.name || prodNameRaw,
                code: candidateProd.code || prodCodeRaw,
                pieceWeight: candidateProd.pieceWeight,
                aluminaPercentage: candidateProd.aluminaPercentage,
              };
              rowWarnings.push(`مطابقة ذكية للصنف: "${prodNameRaw || prodCodeRaw}" -> "${candidateProd.name}" (${top.confidence}%)`);
            }
          } else {
            unresolvedMismatchesCount++;
            rowErrors.push(`الصنف (${prodCodeRaw || prodNameRaw}) غير موجود في دليل المنتجات الأساسية`);
            if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_PRODUCT';
            unknownProductsCount++;
          }
        } else {
          rowErrors.push(`الصنف (${prodCodeRaw || prodNameRaw}) غير موجود في دليل المنتجات الأساسية`);
          if (rowStatus === 'NEW') rowStatus = 'UNKNOWN_PRODUCT';
          unknownProductsCount++;
        }
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

    // Business (non-blocking) warnings - centrally defined in businessValidationRules.ts
    // so the same rule codes/messages apply identically here, in DataImportView's
    // full-row editor, and in direct Production Entry.
    for (const w of evaluateProductionWarnings({ productionQuantity, wasteQuantity }, 'ar')) {
      rowWarnings.push(`تنبيه: ${w.message}`);
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

    for (const w of evaluateProductionWarnings({ productionQuantity, wasteQuantity, calculatedTotalFaults, shiftHours: resolvedShift?.hours }, 'ar')) {
      if (w.code === 'HIGH_DOWNTIME') rowWarnings.push(`تنبيه: ${w.message}`);
    }

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
    // (PHASE 4F: built via the shared pure helper - see
    // pressingDuplicateIdentityPure.ts - identical field/fallback order as
    // before, now also reused by the final live recheck.)
    const duplicateCompositeKey = buildPressingDuplicateKey({
      date: dateStr,
      shiftKeyPart: resolvedShift?.code || shiftStr || '',
      pressKeyPart: resolvedPress?.code || pressRaw || '',
      productKeyPart: resolvedProduct?.code || prodCodeRaw || '',
      customerOrder,
      worker1KeyPart: resolvedWorker1?.code || w1CodeRaw || w1NameRaw || '',
      furnaceCarNumbers,
    });

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
      furnaceCarTokens: rawCarParts,
      furnaceCarBrickPairs,
      resolvedFurnaceCars,
      furnaceCarNumbers,
      furnaceCarIds,
      furnaceCarBrickCounts,
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
      proposedMatches,
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
    highConfidenceMatchesCount,
    unresolvedMismatchesCount,
    rows: parsedRows,
  };
}

/**
 * PHASE 4F - FINAL LIVE DUPLICATE RECHECK.
 *
 * parseAndValidatePressingExcel()'s duplicate check above is a SNAPSHOT
 * taken once when the file was first uploaded/reviewed. Between that
 * moment and the user finally clicking "Execute Import" (which may be
 * minutes or longer - the user can review, correct, and re-review rows in
 * between), another user or process could have written a matching
 * production record. This closes that TOCTOU gap immediately before
 * writing, WITHOUT re-downloading the whole `production` collection again
 * (that would double the exact expensive full-collection read Phase 4C/4D
 * worked to reduce, for a collection this codebase's own audits already
 * flagged as large). Instead: group the candidate rows by their (date,
 * resolved product code) anchor - both fields are guaranteed present on
 * any row that reached this stage (a row with no resolved product would
 * already have a blocking UNKNOWN_PRODUCT error and never be writable) -
 * and issue ONE narrow, two-equality-filter query per DISTINCT anchor
 * pair (`where('date','==',...)`, `where('productCode','==',...)` - both
 * equality filters, so this is served by Firestore's automatic
 * single-field indexes, never a composite index). Each query typically
 * returns a handful of documents (same day, same product), not the whole
 * collection. The FULL 7-field composite key (shared with the parse-time
 * check via pressingDuplicateIdentityPure.ts) is then matched in-memory
 * only against that narrow result set, so correctness is identical to
 * the parse-time check, just re-verified live.
 *
 * RESIDUAL RISK (disclosed, not silently accepted): this anchors on
 * `productCode`, the field this importer and the manual entry form both
 * always write. A hypothetical existing document written by some other,
 * long-superseded path that stored the product only under `productId`
 * (never `productCode`) would not be found by this narrow query. Since
 * this recheck exists specifically to catch a record created DURING the
 * short review window (necessarily by a CURRENT writer, which always
 * populates `productCode`), this is judged an acceptable, narrow scope
 * limitation - the original parse-time full-snapshot check (which does
 * use the same code||id fallback as every other document field) already
 * covers the broader legacy-data case moments earlier.
 *
 * A row a newly-discovered live duplicate is found for is pushed a NEW
 * blocking error (not merely a warning) - unlike the parse-time
 * DUPLICATE_IN_DATABASE case (a warning the user can knowingly accept),
 * the user never had a chance to review THIS specific new information, so
 * it must not be silently overridable. Deliberately does NOT set
 * rowSelection to any kind of "pending/needs re-review" sentinel -
 * pressingSelectionPure.ts's computePressingBulkOutcome explicitly
 * documents that Pressing (unlike Chinese Mills) has no such state:
 * "every row gets an explicit INCLUDED/EXCLUDED decision... blocking rows
 * are still gated by isRowReadyToImport() ... never by being excluded
 * from selection itself." Adding a new sentinel here would silently
 * contradict that existing, deliberate design choice - pushing the error
 * alone is sufficient: isRowWritable() already gates on
 * `errors.length === 0` regardless of `rowSelection`.
 *
 * PHASE 4F.2 - FAILS CLOSED: if an anchor group's narrow query itself
 * fails (e.g. a transient network/permission error), every row in that
 * group is marked `DUPLICATE_RECHECK_FAILED` (a NEW, distinct status -
 * never mislabeled as the CONFIRMED `DUPLICATE_IN_DATABASE`) and blocked
 * from import via the same `errors` mechanism - never silently allowed
 * through un-verified. Rows in a different, successfully-queried anchor
 * group are entirely unaffected, so this can never poison an unrelated
 * valid row; it can only ever narrow the writable set further, never
 * widen it.
 */
export async function recheckPressingDatabaseDuplicates(
  rowsToCheck: PressingImportRow[]
): Promise<PressingImportRow[]> {
  // Group rows by (date, productCode) anchor so identical anchors share one query.
  const anchorGroups = new Map<string, { date: string; productCode: string; rows: PressingImportRow[] }>();
  for (const row of rowsToCheck) {
    const identity = pressingIdentityFromRow(row);
    if (!identity.date || !identity.productKeyPart) continue; // defensive - should not happen for a writable row
    const anchorKey = `${identity.date}#${identity.productKeyPart}`.toLowerCase();
    const group = anchorGroups.get(anchorKey);
    if (group) {
      group.rows.push(row);
    } else {
      anchorGroups.set(anchorKey, { date: identity.date, productCode: identity.productKeyPart, rows: [row] });
    }
  }

  // One narrow query per distinct (date, productCode) pair - never a full collection scan.
  const liveDuplicateKeys = new Set<string>();
  // PHASE 4F.2 - FAIL CLOSED: if an anchor group's query itself cannot be
  // completed, every row in that group is unverifiable and must NOT be
  // written - never silently allowed through (that would reopen the exact
  // TOCTOU gap this recheck exists to close), and never mislabeled as a
  // CONFIRMED duplicate (it might not be one - the check simply couldn't
  // run). Rows belonging to a DIFFERENT, successfully-queried anchor group
  // are entirely unaffected.
  const recheckFailedRowIndexes = new Set<number>();
  await Promise.all(
    Array.from(anchorGroups.values()).map(async ({ date, productCode, rows }) => {
      try {
        const snap = await getDocs(
          query(collection(db, 'production'), where('date', '==', date), where('productCode', '==', productCode))
        );
        snap.forEach((docSnap) => {
          const d = docSnap.data() as ProductionRecord;
          liveDuplicateKeys.add(buildPressingDuplicateKey(pressingIdentityFromFirestoreDoc(d)));
        });
      } catch (err) {
        console.warn('Pressing final duplicate recheck query warning (failing closed for this anchor group):', err);
        rows.forEach((r) => recheckFailedRowIndexes.add(r.rowIndex));
      }
    })
  );

  return rowsToCheck.map((row) => {
    if (row.duplicateType === 'DATABASE') return row; // already flagged at parse time, no need to re-flag
    if (recheckFailedRowIndexes.has(row.rowIndex)) {
      return {
        ...row,
        status: 'DUPLICATE_RECHECK_FAILED' as PressingImportStatus,
        errors: [
          ...row.errors,
          'تعذر التحقق النهائي من عدم تكرار هذا الصف قبل الاستيراد - لن يتم استيراده الآن حفاظاً على سلامة البيانات. يرجى إعادة المحاولة.',
        ],
      };
    }
    const key = buildPressingDuplicateKey(pressingIdentityFromRow(row));
    if (!liveDuplicateKeys.has(key)) return row;
    return {
      ...row,
      isDuplicate: true,
      duplicateType: 'DATABASE' as const,
      status: 'DUPLICATE_IN_DATABASE' as PressingImportStatus,
      errors: [
        ...row.errors,
        'تم استيراد سجل مطابق إلى قاعدة البيانات منذ مراجعة هذا الملف - لن يتم استيراده مرة أخرى.',
      ],
    };
  });
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
  /** F-03 - rowIndex of every row whose OWN individual write failed, so the UI can keep exactly those rows reviewable/re-importable instead of losing a whole chunk. */
  failedRowIndexes: number[];
}> {
  const currentUser = auth.currentUser;
  const now = new Date();
  const sessionImportId = `HIST-IMP-${now.toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  // Filter out fatal rows
  const importableRows = rowsToImport.filter(r => r.errors.length === 0);
  const skippedCount = rowsToImport.length - importableRows.length;

  const BATCH_SIZE = 400;

  /**
   * F-03 - ROW-LEVEL FAILURE ISOLATION.
   *
   * A Firestore writeBatch().commit() is ATOMIC, so the previous
   * one-batch-per-chunk loop marked all 400 rows of a chunk failed when any
   * single row in it was rejected - 399 perfectly valid, already-validated
   * rows were discarded because of one bad neighbour. That contradicts the
   * core partial-import rule that a failing row must only ever block itself.
   *
   * This now delegates to runChunkedWriteWithFallback (the SAME orchestrator
   * Tube/Ball Mills already uses - tubeBallMillsChunkedWritePure.ts), rather
   * than inventing a second strategy: the happy path still writes one atomic
   * batch per chunk (so a normal import pays no extra write cost), and ONLY
   * when a chunk's commit rejects does it retry that one chunk's rows
   * individually to find out exactly which ones actually fail. The retry is
   * bounded - one single pass over the failed chunk, never a loop - rows that
   * already committed are never rewritten, and a later chunk is still
   * processed after an earlier chunk fails.
   *
   * Rows are built up-front so each carries its own docRef: a retried row
   * reuses the id it was assigned, so the individual fallback can never
   * create a duplicate of a row the batch had already written.
   */
  const entries = importableRows.map(row => {
    const docRef = doc(collection(db, 'production'));
      const pieceWeight = row.pieceWeight || 0;

      const recordPayload: ProductionRecord = {
        id: docRef.id,
        date: row.date, // Preserves the exact historical production date!
        
        // Shift
        shiftId: row.resolvedShift?.id || 'default-shift-1',
        shiftName: row.resolvedShift?.name || buildShiftDisplayName(parseShiftNumber(row.shiftRaw) || 1, 'ar'),
        shiftCode: row.resolvedShift?.code || buildShiftCode(parseShiftNumber(row.shiftRaw) || 1),
        
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
        // Parallel to furnaceCarIds/furnaceCarNumbers (same index = same car).
        // Brick count is transactional data, never stored on the Furnace Car
        // Master Data document.
        furnaceCarBrickCounts: row.furnaceCarBrickCounts || [],
        carCodes: row.carCodes || [],
        carCode: row.furnaceCarsRaw || undefined,
        originalFurnaceCars: row.furnaceCarsRaw || undefined,
        
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
        importBatchId: sessionImportId,
        importedAt: new Date().toISOString(),
        importedByUid: currentUser?.uid || 'SUPER_ADMIN',
        importedByName: currentUser?.email || 'مشرف الاستيراد التاريخي',
        ...(backupId ? { backupId } : {}),
      };

    return { row, docRef, payload: enrichedPayload };
  });

  const writeResult = await runChunkedWriteWithFallback({
    items: entries,
    chunkSize: BATCH_SIZE,
    getId: (e) => e.row.rowIndex,
    writeChunk: async (chunk) => {
      const batch = writeBatch(db);
      chunk.forEach((e) => safeBatchSet(batch, e.docRef, e.payload));
      await batch.commit();
    },
    // Individual-row fallback - only ever invoked after writeChunk rejects
    // for the chunk this row belongs to. Reuses the row's pre-assigned
    // docRef, so a row the failed batch had not written gets written exactly
    // once and never twice.
    writeOne: async (e) => { await safeSetDoc(e.docRef, e.payload); },
    onProgress,
  });

  const importedCount = writeResult.importedIds.length;
  const failedCount = writeResult.failedIds.length;
  const errors = writeResult.errors;
  /** Row indexes that genuinely failed their own individual write - these stay reviewable/re-importable. */
  const failedRowIndexes = writeResult.failedIds as number[];

  // Save any approved mappings across the imported rows
  const mappingsToPersist: Array<{
    domain: string;
    originalValue: string;
    mappedEntityId: string;
    mappedEntityName: string;
    mappedEntityCode?: string;
    confidence: number;
    matchType: string;
  }> = [];

  rowsToImport.forEach(r => {
    (r.proposedMatches || []).forEach(p => {
      if ((p.decision === 'ACCEPTED' || p.confidence >= 90) && p.suggestedId) {
        mappingsToPersist.push({
          domain: p.fieldDomain === 'employee1' || p.fieldDomain === 'employee2' ? 'employee' : p.fieldDomain,
          originalValue: p.importedValue,
          mappedEntityId: p.suggestedId,
          mappedEntityName: p.suggestedName || '',
          mappedEntityCode: p.suggestedCode || '',
          confidence: p.confidence,
          matchType: p.matchType,
        });
      }
    });
  });

  if (mappingsToPersist.length > 0) {
    await saveApprovedMappingBatch(mappingsToPersist).catch(err => console.warn('Could not persist mapping batch:', err));
  }

  // Record Audit Trail in both collections
  await logHistoricalImportExecution({
    importBatchId: sessionImportId,
    stage: 'pressing',
    fileName: 'Pressing Historical Excel',
    totalRows: rowsToImport.length,
    importedCount,
    failedCount,
    skippedCount,
    approvedMappingsCount: mappingsToPersist.length,
    performedBy: currentUser?.uid || 'SUPER_ADMIN',
    performedByName: currentUser?.email || 'مشرف الاستيراد التاريخي',
    performedAt: new Date().toISOString(),
    backupId: backupId || undefined,
  });

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
    failedRowIndexes,
  };
}

/**
 * Bulk Import Service
 * Supports XLSX, XLS, CSV, TSV, and clipboard paste for Master Data with validation,
 * Smart Product Code derivation against Firestore productTypes, duplicate detection,
 * and chunked batch commits.
 */
import * as XLSX from 'xlsx';
import { collection, getDocs, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../config/firebase';
import { MasterDataTab, BulkImportRow, BulkImportResult, ProductType } from '../types';
import { logAuditAction } from './auditService';
import { toWesternDigits } from '../utils/formatters';
import { fetchProductTypes } from './productTypeService';
import { parseProductCode, normalizeProductCode } from '../utils/productCodeParser';
import { enrichWithNormalizedFields } from '../utils/searchUtils';

// Schema requirements and field mappings for each master data tab
export interface MasterDataSchemaField {
  key: string;
  label: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean';
  description?: string;
  aliases?: string[];
}

export const MASTER_DATA_SCHEMAS: Record<MasterDataTab, { title: string; fields: MasterDataSchemaField[] }> = {
  products: {
    title: 'المنتجات الحرارية (الاستيراد الذكي)',
    fields: [
      { 
        key: 'productCode', 
        label: 'كود المنتج (productCode)', 
        required: true, 
        type: 'string', 
        description: 'مثال: BAR250102305 أو BHA70123456',
        aliases: ['productCode', 'code', 'كود المنتج', 'كود', 'Product Code', 'Code']
      },
      { 
        key: 'productName', 
        label: 'اسم المنتج (productName)', 
        required: true, 
        type: 'string', 
        description: 'مثال: طوب مقاوم للأحماض 25% قياسي',
        aliases: ['productName', 'name', 'اسم المنتج', 'الاسم', 'Product Name', 'Name']
      },
      // Optional manual fields (NOT required; no fake data will be generated if omitted)
      { 
        key: 'pieceWeight', 
        label: 'وزن القطعة (كجم) - اختياري', 
        required: false, 
        type: 'number', 
        description: 'وزن القطعة بالكيلوجرام (إن وجد)',
        aliases: ['pieceWeight', 'pieceWeightKg', 'وزن القطعة', 'الوزن', 'Weight']
      },
      { 
        key: 'unit', 
        label: 'الوحدة - اختياري', 
        required: false, 
        type: 'string', 
        description: 'مثال: قطعة، كجم، طن',
        aliases: ['unit', 'الوحدة', 'Unit']
      },
      { 
        key: 'description', 
        label: 'الوصف / ملاحظات - اختياري', 
        required: false, 
        type: 'string', 
        description: 'مواصفات أو أبعاد إضافية',
        aliases: ['description', 'الوصف', 'ملاحظات', 'Description', 'Notes']
      },
    ]
  },
  productTypes: {
    title: 'تصنيفات المنتجات (Prefixes)',
    fields: [
      { key: 'prefixCode', label: 'بادئة الكود (3 أحرف)', required: true, type: 'string', description: 'مثال: BAR, BHA, BSI', aliases: ['prefixCode', 'prefix', 'البادئة', 'بادئة'] },
      { key: 'nameEn', label: 'الاسم بالإنجليزية (Name EN)', required: true, type: 'string', description: 'e.g. Bricks Acid Resistance', aliases: ['nameEn', 'Name EN', 'الاسم الإنجليزي'] },
      { key: 'nameAr', label: 'الاسم بالعربية (Name AR)', required: true, type: 'string', description: 'مثال: طوب مقاوم للأحماض', aliases: ['nameAr', 'Name AR', 'الاسم العربي'] },
      { key: 'description', label: 'الوصف والبيان', required: false, type: 'string', description: 'وصف نوع وتصنيف المنتج', aliases: ['description', 'الوصف'] },
    ]
  },
  employees: {
    title: 'الموظفون والعمال',
    fields: [
      { key: 'code', label: 'كود الموظف', required: true, type: 'string', description: 'مثال: EMP-001', aliases: ['code', 'كود الموظف', 'كود العامل'] },
      { key: 'name', label: 'اسم الموظف', required: true, type: 'string', description: 'الاسم ثلاثي أو رباعي', aliases: ['name', 'اسم الموظف', 'اسم العامل'] },
      { key: 'jobTitle', label: 'المسمى الوظيفي', required: false, type: 'string', description: 'مثال: فني مكبس', aliases: ['jobTitle', 'الوظيفة'] },
      { key: 'departmentName', label: 'القسم', required: false, type: 'string', description: 'مثال: قسم الكبس والتشكيل', aliases: ['departmentName', 'القسم'] },
      { key: 'phone', label: 'رقم الهاتف', required: false, type: 'string', description: '01XXXXXXXXX', aliases: ['phone', 'الهاتف'] },
    ]
  },
  departments: {
    title: 'الأقسام',
    fields: [
      { key: 'code', label: 'كود القسم', required: true, type: 'string', description: 'مثال: DEPT-01', aliases: ['code', 'كود القسم'] },
      { key: 'name', label: 'اسم القسم', required: true, type: 'string', description: 'مثال: قسم الأفران', aliases: ['name', 'اسم القسم'] },
      { key: 'description', label: 'الوصف', required: false, type: 'string', description: 'وصف القسم ومهامه', aliases: ['description', 'الوصف'] },
    ]
  },
  customers: {
    title: 'العملاء',
    fields: [
      { key: 'code', label: 'كود العميل', required: true, type: 'string', description: 'مثال: CUST-101', aliases: ['code', 'كود العميل'] },
      { key: 'name', label: 'اسم العميل / جهة الاتصال', required: true, type: 'string', description: 'مثال: شركة حديد عز', aliases: ['name', 'اسم العميل'] },
      { key: 'company', label: 'اسم الشركة', required: false, type: 'string', description: 'مثال: مصانع درفلة الحديد', aliases: ['company', 'الشركة'] },
      { key: 'phone', label: 'رقم الهاتف', required: false, type: 'string', description: '0100000000', aliases: ['phone', 'الهاتف'] },
      { key: 'email', label: 'البريد الإلكتروني', required: false, type: 'string', description: 'info@company.com', aliases: ['email', 'البريد'] },
      { key: 'address', label: 'العنوان', required: false, type: 'string', description: 'المنطقة الصناعية', aliases: ['address', 'العنوان'] },
    ]
  },
  shifts: {
    title: 'ورديات العمل',
    fields: [
      { key: 'code', label: 'كود الوردية', required: true, type: 'string', description: 'مثال: SHIFT-A', aliases: ['code', 'كود الوردية'] },
      { key: 'name', label: 'اسم الوردية', required: true, type: 'string', description: 'مثال: الوردية الأولى (صباحية)', aliases: ['name', 'اسم الوردية'] },
      { key: 'startTime', label: 'وقت البدء', required: false, type: 'string', description: '08:00', aliases: ['startTime', 'البدء'] },
      { key: 'endTime', label: 'وقت الانتهاء', required: false, type: 'string', description: '16:00', aliases: ['endTime', 'الانتهاء'] },
      { key: 'hours', label: 'عدد الساعات', required: true, type: 'number', description: '8', aliases: ['hours', 'الساعات'] },
    ]
  },
  presses: {
    title: 'المكابس',
    fields: [
      { key: 'code', label: 'كود المكبس', required: true, type: 'string', description: 'مثال: PRESS-01', aliases: ['code', 'كود المكبس'] },
      { key: 'name', label: 'اسم المكبس', required: true, type: 'string', description: 'مثال: مكبس هيدروليكي 1200 طن', aliases: ['name', 'اسم المكبس'] },
      { key: 'tonnage', label: 'الحمولة (طن)', required: false, type: 'number', description: 'مثال: 1200', aliases: ['tonnage', 'الحمولة'] },
      { key: 'model', label: 'الموديل / الصانع', required: false, type: 'string', description: 'مثال: SACMI 2020', aliases: ['model', 'الموديل'] },
    ]
  },
  furnaces: {
    title: 'الأفران',
    fields: [
      { key: 'code', label: 'كود الفرن', required: true, type: 'string', description: 'مثال: FURN-01', aliases: ['code', 'كود الفرن'] },
      { key: 'name', label: 'اسم الفرن', required: true, type: 'string', description: 'مثال: فرن النفق الحراري الرئيسي', aliases: ['name', 'اسم الفرن'] },
      { key: 'capacity', label: 'السعة (طن)', required: false, type: 'number', description: 'مثال: 50', aliases: ['capacity', 'السعة'] },
      { key: 'maxTemperature', label: 'أقصى حرارة (مئوية)', required: false, type: 'number', description: 'مثال: 1650', aliases: ['maxTemperature', 'الحرارة'] },
    ]
  },
  furnaceCars: {
    title: 'عربات الأفران',
    fields: [
      { key: 'code', label: 'كود العربة', required: true, type: 'string', description: 'مثال: CAR-01', aliases: ['code', 'كود العربة'] },
      { key: 'carNumber', label: 'رقم العربة', required: true, type: 'string', description: 'مثال: 104', aliases: ['carNumber', 'رقم العربة'] },
      { key: 'furnaceName', label: 'اسم الفرن المخصص', required: false, type: 'string', description: 'مثال: فرن النفق 1', aliases: ['furnaceName', 'الفرن'] },
      { key: 'capacity', label: 'سعة الحمولة (قطع)', required: false, type: 'number', description: 'مثال: 1200', aliases: ['capacity', 'سعة الحمولة'] },
    ]
  }
};

// Parse file content (.xlsx, .xls, .csv, .tsv)
export async function parseImportFile(file: File): Promise<Record<string, any>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });
        resolve(json);
      } catch (err) {
        reject(new Error('فشل قراءة الملف. تأكد من أن صيغة الملف صالحة (Excel أو CSV).'));
      }
    };

    reader.onerror = () => reject(new Error('حدث خطأ أثناء قراءة الملف.'));
    reader.readAsArrayBuffer(file);
  });
}

// Parse pasted clipboard text (Tab, Comma, or Semicolon separated)
export function parsePastedText(text: string): Record<string, any>[] {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('النص المنسوخ يجب أن يحتوي على صف العناوين وصف واحد على الأقل من البيانات.');
  }

  // Detect delimiter: tab or comma or semicolon
  const headerLine = lines[0];
  let delimiter = '\t';
  if (headerLine.includes('\t')) {
    delimiter = '\t';
  } else if (headerLine.includes(',')) {
    delimiter = ',';
  } else if (headerLine.includes(';')) {
    delimiter = ';';
  }

  const headers = headerLine.split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, ''));
  const rows: Record<string, any>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = line.split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ''));
    const rowObj: Record<string, any> = {};
    headers.forEach((header, idx) => {
      rowObj[header] = values[idx] !== undefined ? values[idx] : '';
    });
    rows.push(rowObj);
  }

  return rows;
}

// Helper to find field value in a raw row by checking aliases
function extractFieldValue(rawRow: Record<string, any>, field: MasterDataSchemaField): any {
  // Check exact key & label
  if (rawRow[field.key] !== undefined && rawRow[field.key] !== '') return rawRow[field.key];
  if (rawRow[field.label] !== undefined && rawRow[field.label] !== '') return rawRow[field.label];

  // Check aliases
  if (field.aliases && field.aliases.length > 0) {
    for (const alias of field.aliases) {
      if (rawRow[alias] !== undefined && rawRow[alias] !== '') return rawRow[alias];
    }
  }

  // Case-insensitive / fuzzy match
  const rawKeys = Object.keys(rawRow);
  const matchedKey = rawKeys.find(k => {
    const cleanK = k.trim().toLowerCase();
    if (cleanK === field.key.toLowerCase() || cleanK === field.label.toLowerCase()) return true;
    if (field.aliases?.some(a => a.toLowerCase() === cleanK)) return true;
    return false;
  });

  return matchedKey !== undefined ? rawRow[matchedKey] : undefined;
}

// Validate parsed rows against schema and existing Firestore database codes
export async function validateImportData(
  targetTab: MasterDataTab,
  rawRows: Record<string, any>[],
  cachedProductTypes?: ProductType[]
): Promise<BulkImportRow[]> {
  const schema = MASTER_DATA_SCHEMAS[targetTab];
  const collectionName = targetTab;

  // 1. Fetch existing codes from Firestore to detect duplicates
  const existingSnapshot = await getDocs(collection(db, collectionName));
  const existingCodesSet = new Set<string>();
  existingSnapshot.docs.forEach(docSnap => {
    const data = docSnap.data();
    const code = targetTab === 'productTypes' ? data.prefixCode : (data.productCode || data.code);
    if (code) existingCodesSet.add(String(code).trim().toUpperCase());
  });

  // Load product types for product intelligence parser if targetTab is products
  let knownProductTypes: ProductType[] = cachedProductTypes || [];
  if (targetTab === 'products' && (!knownProductTypes || knownProductTypes.length === 0)) {
    try {
      knownProductTypes = await fetchProductTypes();
    } catch {
      knownProductTypes = [];
    }
  }

  const batchSeenCodes = new Set<string>();
  const validatedRows: BulkImportRow[] = [];

  rawRows.forEach((rawRow, index) => {
    const rowNumber = index + 1;
    const rowData: Record<string, any> = {};
    const errors: string[] = [];

    // Map standard columns
    schema.fields.forEach(field => {
      let rawVal = extractFieldValue(rawRow, field);

      if (rawVal !== undefined && rawVal !== null && String(rawVal).trim() !== '') {
        const normalizedVal = typeof rawVal === 'string' ? toWesternDigits(rawVal.trim()) : rawVal;
        if (field.type === 'number') {
          const num = Number(normalizedVal);
          if (isNaN(num)) {
            errors.push(`حقل "${field.label}" يجب أن يكون رقماً.`);
            rowData[field.key] = rawVal;
          } else {
            rowData[field.key] = num;
          }
        } else if (field.type === 'boolean') {
          rowData[field.key] = normalizedVal === true || String(normalizedVal).toLowerCase() === 'true' || String(normalizedVal) === '1';
        } else {
          rowData[field.key] = String(normalizedVal).trim();
        }
      } else {
        if (field.required) {
          errors.push(`حقل "${field.label}" مطلوب ولم يتم تحديده.`);
        }
        if (field.type === 'number') {
          // Do NOT assign arbitrary numbers; leave undefined if optional
          if (field.required) rowData[field.key] = 0;
        } else {
          rowData[field.key] = '';
        }
      }
    });

    // =========================================================================
    // SMART PRODUCT INTELLIGENCE & DERIVATION WORKFLOW (OPTIONAL & NON-BLOCKING)
    // =========================================================================
    let derivedInfo: BulkImportRow['derivedData'] = undefined;
    let rowStatus: BulkImportRow['status'] = 'valid';

    if (targetTab === 'products') {
      const rawCode = String(rowData.productCode || rowData.code || '').trim();
      const rawName = String(rowData.productName || rowData.name || '').trim();

      if (!rawCode) {
        errors.push('كود المنتج (productCode) مطلوب.');
      }
      if (!rawName) {
        errors.push('اسم المنتج (productName) مطلوب.');
      }

      const normalizedCode = normalizeProductCode(rawCode);
      rowData.code = normalizedCode;
      rowData.productCode = normalizedCode;
      rowData.name = rawName;
      rowData.productName = rawName;

      // Optional Smart Code Parsing
      const parseResult = parseProductCode(normalizedCode, knownProductTypes);

      derivedInfo = {
        productCode: normalizedCode,
        productName: rawName,
        prefix: parseResult.prefix || '',
        productTypeName: parseResult.productType?.nameEn || '',
        productTypeNameAr: parseResult.productType?.nameAr || '',
        aluminaPercentage: parseResult.aluminaPercentage,
        productIdentifier: parseResult.productIdentifier || '',
        isUnknownPrefix: parseResult.isUnknownPrefix,
        isInvalidAlumina: parseResult.isInvalidAlumina,
      };

      if ((parseResult.status === 'SMART_CODE' || parseResult.status === 'RECOGNIZED') && parseResult.productType) {
        // Auto-derived fields
        rowData.productTypePrefix = parseResult.prefix;
        rowData.productIdentifier = parseResult.productIdentifier;
        rowData.productTypeId = parseResult.productType.id || '';
        rowData.productTypeName = parseResult.productType.nameEn;
        rowData.productTypeNameAr = parseResult.productType.nameAr;
        if (parseResult.aluminaPercentage !== undefined) {
          rowData.aluminaPercentage = parseResult.aluminaPercentage;
        }
        rowData.smartParseStatus = 'SMART_CODE';
      } else if (parseResult.status === 'UNKNOWN_PREFIX' || parseResult.status === 'PARTIAL') {
        // Unknown prefix with valid smart structure
        rowData.productTypePrefix = parseResult.prefix;
        rowData.productIdentifier = parseResult.productIdentifier;
        if (parseResult.aluminaPercentage !== undefined) {
          rowData.aluminaPercentage = parseResult.aluminaPercentage;
        }
        rowData.smartParseStatus = 'UNKNOWN_PREFIX';
      } else {
        // MANUAL_PRODUCT_CODE / NOT_APPLICABLE: Numeric-start or custom format - do NOT block, do NOT derive alumina!
        rowData.smartParseStatus = 'MANUAL_PRODUCT_CODE';
      }

      // Preserve optional fields safely without inventing fake values
      if (rowData.pieceWeight !== undefined && rowData.pieceWeight !== null && rowData.pieceWeight !== '' && !isNaN(Number(rowData.pieceWeight))) {
        rowData.pieceWeightKg = Number(rowData.pieceWeight);
      }
    }

    // Special validation for Product Types
    if (targetTab === 'productTypes') {
      const prefix = String(rowData.prefixCode || '').trim().toUpperCase();
      rowData.prefixCode = prefix;
      if (!/^[A-Z0-9]{3}$/.test(prefix)) {
        errors.push('بادئة الكود يجب أن تتكون من 3 أحرف لاتينية بالضبط (مثال: BAR, BHA).');
      }
    }

    // Duplicate Check & Final Status Determination
    const uniqueKey = targetTab === 'productTypes' 
      ? rowData.prefixCode 
      : (rowData.productCode || rowData.code);
    const codeVal = uniqueKey ? String(uniqueKey).trim().toUpperCase() : '';

    if (errors.length > 0) {
      rowStatus = 'INVALID';
    } else if (codeVal) {
      if (existingCodesSet.has(codeVal)) {
        rowStatus = 'DUPLICATE_IN_FIRESTORE';
        errors.push(`كود "${uniqueKey}" مسجل مسبقاً في قاعدة البيانات السحابية.`);
      } else if (batchSeenCodes.has(codeVal)) {
        rowStatus = 'DUPLICATE_IN_FILE';
        errors.push(`كود "${uniqueKey}" مكرر داخل نفس ملف الاستيراد.`);
      } else {
        batchSeenCodes.add(codeVal);
        rowStatus = 'NEW';
      }
    }

    validatedRows.push({
      rowNumber,
      data: rowData,
      status: rowStatus,
      errors,
      derivedData: derivedInfo,
    });
  });

  return validatedRows;
}

// Execute batch write in Firestore in chunks of up to 400 documents
export async function commitBulkImport(
  targetTab: MasterDataTab,
  validRows: BulkImportRow[],
  onProgress?: (processed: number, total: number) => void
): Promise<BulkImportResult> {
  const collectionName = targetTab;
  // Only import valid NEW rows
  const rowsToImport = validRows.filter(r => r.status === 'valid' || r.status === 'NEW');
  const total = rowsToImport.length;

  const duplicateInFileCount = validRows.filter(r => r.status === 'DUPLICATE_IN_FILE').length;
  const duplicateInFirestoreCount = validRows.filter(r => r.status === 'DUPLICATE_IN_FIRESTORE').length;
  const duplicateTotal = validRows.filter(r => r.status === 'duplicate' || r.status === 'DUPLICATE_IN_FILE' || r.status === 'DUPLICATE_IN_FIRESTORE').length;
  const unknownTypeCount = validRows.filter(r => r.status === 'UNKNOWN_PRODUCT_TYPE').length;
  const errorTotal = validRows.filter(r => r.status === 'error' || r.status === 'INVALID' || r.status === 'UNKNOWN_PRODUCT_TYPE').length;

  if (total === 0) {
    return {
      totalRows: validRows.length,
      validRows: 0,
      duplicateRows: duplicateTotal,
      duplicateInFileRows: duplicateInFileCount,
      duplicateInFirestoreRows: duplicateInFirestoreCount,
      unknownTypeRows: unknownTypeCount,
      errorRows: errorTotal,
      importedRows: 0,
    };
  }

  const CHUNK_SIZE = 400; // Firestore limit is 500 per batch
  let importedCount = 0;

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    const chunk = rowsToImport.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);

    chunk.forEach(row => {
      const docRef = doc(collection(db, collectionName));
      
      // Clean undefined fields to keep Firestore records pristine
      const cleanData: Record<string, any> = {};
      Object.keys(row.data).forEach(k => {
        if (row.data[k] !== undefined && row.data[k] !== null && row.data[k] !== '') {
          cleanData[k] = row.data[k];
        }
      });

      // Guarantee essential product fields without fake defaults
      if (targetTab === 'products') {
        cleanData.code = row.data.code || row.data.productCode;
        cleanData.productCode = row.data.productCode || row.data.code;
        cleanData.name = row.data.name || row.data.productName;
        cleanData.productName = row.data.productName || row.data.name;
        if (row.data.productTypePrefix) cleanData.productTypePrefix = row.data.productTypePrefix;
        if (row.data.productTypeId) cleanData.productTypeId = row.data.productTypeId;
        if (row.data.productTypeName) cleanData.productTypeName = row.data.productTypeName;
        if (row.data.productTypeNameAr) cleanData.productTypeNameAr = row.data.productTypeNameAr;
        if (row.data.aluminaPercentage !== undefined && row.data.aluminaPercentage !== null && !isNaN(Number(row.data.aluminaPercentage))) {
          cleanData.aluminaPercentage = Number(row.data.aluminaPercentage);
        }
        if (row.data.productIdentifier) cleanData.productIdentifier = row.data.productIdentifier;
        if (row.data.smartParseStatus) cleanData.smartParseStatus = row.data.smartParseStatus;
      }

      // Enrich with normalized searchable fields
      const enrichedData = enrichWithNormalizedFields(targetTab, cleanData);

      batch.set(docRef, {
        ...enrichedData,
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        serverCreatedAt: serverTimestamp(),
        serverUpdatedAt: serverTimestamp(),
      });
    });

    try {
      await batch.commit();
      importedCount += chunk.length;
      if (onProgress) {
        onProgress(importedCount, total);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, collectionName);
      throw error;
    }
  }

  // Audit Log with non-sensitive user metadata
  await logAuditAction(
    'BULK_IMPORT',
    collectionName,
    '',
    `استيراد مجمع لعدد ${importedCount} منتج/سجل جديد في مجموعة ${collectionName}`
  );

  return {
    totalRows: validRows.length,
    validRows: rowsToImport.length,
    duplicateRows: duplicateTotal,
    duplicateInFileRows: duplicateInFileCount,
    duplicateInFirestoreRows: duplicateInFirestoreCount,
    unknownTypeRows: unknownTypeCount,
    errorRows: errorTotal,
    importedRows: importedCount,
  };
}

// Generate and trigger download of template file for a given master data entity
export function downloadMasterDataTemplate(targetTab: MasterDataTab, format: 'xlsx' | 'csv' = 'xlsx') {
  const schema = MASTER_DATA_SCHEMAS[targetTab];

  let sampleHeaders: string[] = [];
  let sampleDescriptions: string[] = [];
  let sampleRow1: any[] = [];
  let sampleRow2: any[] = [];

  if (targetTab === 'products') {
    // Minimal & Smart Product Template (productCode, productName only)
    sampleHeaders = ['productCode', 'productName'];
    sampleDescriptions = [
      'كود المنتج الذكي (مثال: BAR250102305)',
      'اسم المنتج (يتم استخراج النوع والألومينا والمعرف تلقائياً من الكود)'
    ];
    sampleRow1 = ['BAR250102305', 'Acid Resistant Brick 25% Standard'];
    sampleRow2 = ['BHA70123456', 'High Alumina Brick 70% Extra'];
  } else if (targetTab === 'productTypes') {
    sampleHeaders = ['prefixCode', 'nameEn', 'nameAr', 'description'];
    sampleDescriptions = ['بادئة الكود (3 أحرف)', 'الاسم بالإنجليزية', 'الاسم بالعربية', 'الوصف والبيان'];
    sampleRow1 = ['BAR', 'Bricks Acid Resistance', 'طوب مقاوم للأحماض', 'طوب حراري مقاوم للأحماض والكيماويات'];
    sampleRow2 = ['BHA', 'Bricks High Alumina', 'طوب عالي الألومينا', 'طوب حراري عالي الألومينا لدرجات الحرارة المرتفعة'];
  } else {
    sampleHeaders = schema.fields.map(f => f.key);
    sampleDescriptions = schema.fields.map(f => f.description || f.label);
    sampleRow1 = schema.fields.map(f => {
      if (f.key === 'code') return `${targetTab.toUpperCase().substring(0, 4)}-001`;
      if (f.key === 'name') return `نموذج تجريبي 1`;
      if (f.type === 'number') return 10;
      return 'بيان تجريبي';
    });
  }

  const wsData = [
    sampleHeaders,
    sampleDescriptions,
    sampleRow1,
    ...(sampleRow2.length > 0 ? [sampleRow2] : [])
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, schema.title.substring(0, 30));

  const fileName = `قالب_استيراد_${schema.title.replace(/\s+/g, '_')}.${format}`;
  XLSX.writeFile(wb, fileName, { bookType: format });
}

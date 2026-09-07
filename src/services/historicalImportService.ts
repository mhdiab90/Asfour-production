/**
 * Historical Production Import Service
 * Handles parsing, validation, Master Data resolution (by Code or Name),
 * duplicate detection, and batch insertion of historical Excel/CSV production logs.
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
import { safeSetDoc } from '../utils/firestoreSanitizer';
import { runChunkedWriteWithFallback } from './tubeBallMillsChunkedWritePure';
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
import { getStageConfig, ImportFieldDef } from './productionStageConfig';
import { STAGE_COLLECTION_NAMES } from './stageQueryBoundsPure';
import {
  GENERIC_STAGE_DUPLICATE_IDENTITY,
  hasSafeDuplicateIdentity,
  buildGenericStageDuplicateKey,
} from './genericStageDuplicateIdentityPure';
import { EntityType } from '../components/common/SmartEntitySelect';
import {
  downloadPressingExcelTemplate,
  parseAndValidatePressingExcel,
  executePressingBatchImport,
  recheckPressingDatabaseDuplicates,
  normalizeDateInput,
  PRESSING_IMPORT_HEADERS
} from './pressingHistoricalImportService';

export {
  downloadPressingExcelTemplate,
  parseAndValidatePressingExcel,
  executePressingBatchImport,
  recheckPressingDatabaseDuplicates,
  PRESSING_IMPORT_HEADERS
};

export interface StageImportRow {
  rowIndex: number;
  data: Record<string, any>;
  errors: string[];
  /**
   * PHASE 4F - set only for stages with a safe duplicate identity (see
   * genericStageDuplicateIdentityPure.ts). A FILE duplicate is always
   * pushed into `errors` (blocking, same convention as Pressing/Chinese
   * Mills/Tube-Ball Mills' in-file duplicates); a DATABASE duplicate is
   * ALSO pushed into `errors` here (unlike Pressing's warning-based
   * override for DB duplicates) because the generic panel has no
   * per-row review table/warning-acceptance UI to safely offer an
   * override through - see validateImportRows()'s own comment.
   */
  duplicateType?: 'FILE' | 'DATABASE';
}

/** A Master Data token referenced by a generic-stage import row that has no match in the fetched Master Data list for its entityType - drives the "Add All Master Data" bulk-create flow (BatchAddMasterDataModal), grouped per entityType so a stage's fields never get mixed with an unrelated stage's/entity's tokens. */
export interface MissingMasterDataRef {
  type: string;
  name: string;
  entityType: EntityType;
  field: string;
}

export interface ImportValidationResult {
  validRows: StageImportRow[];
  errors: { rowIndex: number; field: string; message: string }[];
  missingMasterData: MissingMasterDataRef[];
  /**
   * PHASE 4F - rows excluded from validRows specifically because they are
   * duplicates (of another row in the same file, or of an existing
   * Firestore document), kept visible/countable here rather than silently
   * dropped, per this phase's "duplicate rows must remain visible in
   * result/review" requirement. Always empty for a stage with no safe
   * duplicate identity (see `duplicateIdentityDeferred` below).
   */
  duplicateRows: { rowIndex: number; type: 'FILE' | 'DATABASE' }[];
  /**
   * True when this stage has NO safe, authoritative duplicate identity
   * configured (genericStageDuplicateIdentityPure.ts) - duplicate
   * detection is deliberately skipped for that stage rather than
   * guessing a fingerprint. NOT a validation failure; existing behavior
   * for that stage is left exactly as it was before Phase 4F.
   */
  duplicateIdentityDeferred: boolean;
}

/** Reads a stage-config import field's value out of a raw parsed Excel row, trying every recognized column-header spelling for that field. */
function readImportFieldValue(fieldDef: ImportFieldDef, rowData: Record<string, any>): string {
  for (const alias of fieldDef.columnAliases) {
    const raw = rowData[alias];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      return String(raw).trim();
    }
  }
  return '';
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
function sampleValueForImportField(fieldDef: ImportFieldDef): string | number {
  if (fieldDef.type === 'date') return '2026-03-01';
  if (fieldDef.type === 'number') return fieldDef.required ? 10 : 0;
  return fieldDef.entityType ? fieldDef.labelAr : '';
}

/**
 * Generates a downloadable Excel template with the CORRECT headers for the
 * given stage, built directly from that stage's own `importFields` config
 * (productionStageConfig.ts) - the single source of truth also used by
 * validation and the batch-import writer, so a stage can never have a
 * template shaped like a different stage's fields (previously, 4 of the 7
 * non-pressing stages fell through to a Pressing-shaped default template).
 */
export function downloadStageExcelTemplate(stage: ProductionStageType) {
  if (stage === 'pressing') {
    downloadPressingExcelTemplate();
    return;
  }

  const config = getStageConfig(stage);
  const headers = config.importFields.map((f) => f.columnAliases[0]);
  const sampleRow: Record<string, any> = {};
  config.importFields.forEach((f) => {
    sampleRow[f.columnAliases[0]] = sampleValueForImportField(f);
  });

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
 * Validate imported rows against THIS stage's own required fields and
 * Master Data relationships (productionStageConfig.ts `importFields`) -
 * previously this ignored the `stage` parameter entirely and only ever
 * checked a fixed Pressing-shaped set of columns (date/product/customer/
 * employee), so e.g. Tube & Ball Mills' `totalTons` or Sorting's
 * `totalCount` were never validated as required at all.
 *
 * PHASE 4F additions (the Phase 3 audit's "no reliable duplicate
 * detection" finding for this path):
 * 1. DATE VALIDATION: a `type: 'date'` field was previously only checked
 *    for "non-empty" - an unparseable value like "abc" silently passed.
 *    Now validated (and its canonical form used everywhere below) via
 *    normalizeDateInput() - the SAME helper Pressing/Chinese Mills/
 *    Tube-Ball Mills already use, not a second date parser.
 * 2. DUPLICATE DETECTION: only for stages with a safe, authoritative
 *    identity (genericStageDuplicateIdentityPure.ts, built entirely from
 *    this same config's own importFields - never guessed). For any other
 *    stage, `duplicateIdentityDeferred: true` is returned and behavior is
 *    unchanged (NO SAFE DUPLICATE IDENTITY - DEFERRED). One getDocs() of
 *    THIS stage's own collection (not `production`) mirrors the existing
 *    parse-time precedent already used by every dedicated stage importer
 *    (Pressing/Chinese Mills/Tube-Ball Mills) - establishing the feature
 *    for the first time, not a new "immediately before write" full scan
 *    (that would be the final live recheck in executeBatchImport, which
 *    uses narrow per-anchor queries instead - see its own doc comment).
 *    Both FILE and DATABASE duplicates are treated as BLOCKING here
 *    (pushed into `errors`) - unlike Pressing's overridable DB-duplicate
 *    warning, the generic panel has no per-row review table or
 *    warning-acceptance UI to safely offer an override through, so
 *    treating both as blocking is the smallest safe choice rather than
 *    inventing new UI in this phase.
 */
export async function validateImportRows(
  stage: ProductionStageType,
  rows: StageImportRow[],
  language: 'ar' | 'en' = 'ar'
): Promise<ImportValidationResult> {
  const config = getStageConfig(stage);
  const masterDataFields = config.importFields.filter((f) => f.type === 'masterData' && f.entityType);
  const entityTypes = Array.from(new Set(masterDataFields.map((f) => f.entityType as EntityType)));

  const masterDataByType: Partial<Record<EntityType, any[]>> = {};
  await Promise.all(
    entityTypes.map(async (entityType) => {
      masterDataByType[entityType] = await fetchMasterData<any>(`${entityType}s` as any);
    })
  );

  const duplicateIdentityDeferred = !hasSafeDuplicateIdentity(stage);
  const dbKeySet = new Set<string>();
  if (!duplicateIdentityDeferred) {
    const collectionName = STAGE_COLLECTION_NAMES[stage];
    const existingSnap = await getDocs(collection(db, collectionName)).catch(() => ({ docs: [] } as any));
    existingSnap.docs.forEach((docSnap: any) => {
      const d = docSnap.data();
      const rawDate = String(d.date || '');
      const { dateStr, isValid } = normalizeDateInput(rawDate);
      const normalizedDate = isValid ? dateStr : rawDate;
      const key = buildGenericStageDuplicateKey(stage, normalizedDate, (fieldKey) => String(d[fieldKey] ?? ''));
      if (key) dbKeySet.add(key);
    });
  }

  const validRows: StageImportRow[] = [];
  const errors: { rowIndex: number; field: string; message: string }[] = [];
  const missingMasterData: MissingMasterDataRef[] = [];
  const missingSet = new Set<string>();
  const duplicateRows: { rowIndex: number; type: 'FILE' | 'DATABASE' }[] = [];
  const fileKeySet = new Set<string>();

  rows.forEach((row) => {
    let hasFatal = false;
    let normalizedDate = '';

    config.importFields.forEach((fieldDef) => {
      const val = readImportFieldValue(fieldDef, row.data);

      if (fieldDef.required && !val) {
        const label = language === 'ar' ? fieldDef.labelAr : fieldDef.labelEn;
        errors.push({
          rowIndex: row.rowIndex,
          field: fieldDef.key,
          message: language === 'ar' ? `حقل "${label}" إجباري` : `Field "${label}" is required`,
        });
        hasFatal = true;
        return;
      }

      if (fieldDef.type === 'date' && val) {
        const { dateStr, isValid } = normalizeDateInput(val);
        if (!isValid) {
          const label = language === 'ar' ? fieldDef.labelAr : fieldDef.labelEn;
          errors.push({
            rowIndex: row.rowIndex,
            field: fieldDef.key,
            message: language === 'ar' ? `حقل "${label}" يحتوي على تاريخ غير صالح: "${val}"` : `Field "${label}" contains an invalid date: "${val}"`,
          });
          hasFatal = true;
          return;
        }
        if (fieldDef.key === 'date') normalizedDate = dateStr;
      }

      if (fieldDef.type === 'masterData' && fieldDef.entityType && val) {
        const list = masterDataByType[fieldDef.entityType] || [];
        const found = list.find(
          (item: any) => (item.code && item.code === val) || (item.name && item.name === val)
        );
        if (!found) {
          const key = `${fieldDef.entityType}_${val}`;
          if (!missingSet.has(key)) {
            missingSet.add(key);
            missingMasterData.push({
              type: language === 'ar' ? fieldDef.labelAr : fieldDef.labelEn,
              name: val,
              entityType: fieldDef.entityType,
              field: fieldDef.key,
            });
          }
        }
      }
    });

    if (!hasFatal && !duplicateIdentityDeferred) {
      const key = buildGenericStageDuplicateKey(stage, normalizedDate, (fieldKey) => readImportFieldValue(
        config.importFields.find((f) => f.key === fieldKey) || { key: fieldKey, labelAr: '', labelEn: '', columnAliases: [fieldKey], type: 'text', required: false },
        row.data
      ));
      if (key) {
        if (fileKeySet.has(key)) {
          errors.push({
            rowIndex: row.rowIndex,
            field: 'duplicate',
            message: language === 'ar' ? 'صف مكرر داخل نفس الملف المرفوع' : 'Duplicate row within the same uploaded file',
          });
          duplicateRows.push({ rowIndex: row.rowIndex, type: 'FILE' });
          hasFatal = true;
        } else if (dbKeySet.has(key)) {
          errors.push({
            rowIndex: row.rowIndex,
            field: 'duplicate',
            message: language === 'ar' ? 'يوجد سجل مطابق مسبقاً في قاعدة البيانات' : 'A matching record already exists in the database',
          });
          duplicateRows.push({ rowIndex: row.rowIndex, type: 'DATABASE' });
          hasFatal = true;
        } else {
          fileKeySet.add(key);
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
    duplicateRows,
    duplicateIdentityDeferred,
  };
}

/**
 * Execute batch import for any stage with progress callback.
 *
 * Builds each record from THIS stage's own `importFields` config, so every
 * real field the stage declares gets written (previously this only ever
 * wrote a fixed date/product/customer/quantity/waste/downtime subset,
 * silently dropping every other stage-specific column even though it had
 * already passed validation) - and resolves each `masterData` field to the
 * real Master Data document id it matched during validation, stored under
 * that stage's own relational field name (`masterDataFields` config),
 * exactly as that stage's own entry form does via SmartEntitySelect.
 *
 * `autoCreateMasterData` was removed: it was accepted but never read, so it
 * silently did nothing. Creating missing Master Data is a separate,
 * explicit step (the "Add All Master Data" bulk-add flow) that happens
 * BEFORE this function runs, not an implicit side effect of importing.
 */
export async function executeBatchImport(
  stage: ProductionStageType,
  validRows: StageImportRow[],
  onProgress?: (percent: number) => void
): Promise<{
  total: number;
  success: number;
  errors: string[];
  duplicateSkippedCount: number;
  duplicateSkippedRowIndexes: number[];
  recheckFailedCount: number;
  recheckFailedRowIndexes: number[];
  /** F-03.1 - rowIndex of every row whose OWN individual write failed, so the UI can keep exactly those rows reviewable/re-importable instead of losing a whole chunk. Distinct from recheckFailedRowIndexes, which never reached the writer at all. */
  failedRowIndexes: number[];
}> {
  // PHASE 4F: reuse the shared STAGE_COLLECTION_NAMES constant (already
  // used by stageRecordService.ts/productionQueryBoundsPure.ts) instead of
  // re-deriving the same collection-name string a second, separate way.
  const collectionName = STAGE_COLLECTION_NAMES[stage];
  const config = getStageConfig(stage);
  const masterDataImportFields = config.importFields.filter((f) => f.type === 'masterData' && f.entityType);
  const entityTypes = Array.from(new Set(masterDataImportFields.map((f) => f.entityType as EntityType)));

  const masterDataByType: Partial<Record<EntityType, any[]>> = {};
  await Promise.all(
    entityTypes.map(async (entityType) => {
      masterDataByType[entityType] = await fetchMasterData<any>(`${entityType}s` as any);
    })
  );

  /**
   * PHASE 4F - FINAL LIVE DUPLICATE RECHECK, immediately before writing.
   * validateImportRows()'s own duplicate check (if this stage has a safe
   * identity) is a snapshot taken when the file was first
   * uploaded/reviewed - another user/process could have written a
   * matching record since then. Mirrors Pressing's
   * recheckPressingDatabaseDuplicates() exactly: narrow per-(date,
   * product-like-field) queries (equality-only, safe without a composite
   * index), never a second full collection download. Rows whose full
   * identity key matches a live document are excluded from the write and
   * reported separately (never silently written, never poisoning
   * unrelated rows).
   *
   * PHASE 4F.2 - FAILS CLOSED: if an anchor group's narrow query itself
   * fails (e.g. a transient network/permission error), every row in that
   * group is unverifiable and is excluded from `writableRows` too -
   * tracked separately in `recheckFailedRowIndexes` (never conflated with
   * `duplicateSkippedRowIndexes`, which means a CONFIRMED duplicate) so
   * the distinction between "confirmed duplicate" and "could not verify"
   * is preserved. Rows in a different, successfully-queried anchor group
   * are entirely unaffected - this can only ever narrow `writableRows`
   * further, never widen it, and never falls back to a full scan.
   */
  const rowDateByIndex = new Map<number, string>();
  const rowKeyByIndex = new Map<number, string>();
  const duplicateSkippedRowIndexes: number[] = [];
  const recheckFailedRowIndexes: number[] = [];
  let writableRows = validRows;

  if (hasSafeDuplicateIdentity(stage)) {
    const identityConfig = GENERIC_STAGE_DUPLICATE_IDENTITY[stage]!;
    const anchorGroups = new Map<string, { date: string; productValue: string; rowIndexes: number[] }>();

    for (const row of validRows) {
      const dateFieldDef = config.importFields.find((f) => f.key === 'date');
      const rawDate = dateFieldDef ? readImportFieldValue(dateFieldDef, row.data) : '';
      const { dateStr, isValid } = normalizeDateInput(rawDate);
      const normalizedDate = isValid ? dateStr : rawDate;
      rowDateByIndex.set(row.rowIndex, normalizedDate);

      const key = buildGenericStageDuplicateKey(stage, normalizedDate, (fieldKey) => {
        const fieldDef = config.importFields.find((f) => f.key === fieldKey);
        return fieldDef ? readImportFieldValue(fieldDef, row.data) : '';
      });
      if (key) rowKeyByIndex.set(row.rowIndex, key);

      const productFieldDef = config.importFields.find((f) => f.key === identityConfig.productLikeFields[0]);
      const productValue = productFieldDef ? readImportFieldValue(productFieldDef, row.data) : '';
      if (!normalizedDate || !productValue) continue; // defensive - required fields already validated upstream

      const anchorKey = `${normalizedDate}#${productValue}`.toLowerCase();
      const group = anchorGroups.get(anchorKey);
      if (group) {
        group.rowIndexes.push(row.rowIndex);
      } else {
        anchorGroups.set(anchorKey, { date: normalizedDate, productValue, rowIndexes: [row.rowIndex] });
      }
    }

    const liveDuplicateKeys = new Set<string>();
    const failedRowIndexSet = new Set<number>();
    await Promise.all(
      Array.from(anchorGroups.values()).map(async ({ date, productValue, rowIndexes }) => {
        try {
          const anchorField = identityConfig.productLikeFields[0];
          const snap = await getDocs(
            query(collection(db, collectionName), where('date', '==', date), where(anchorField, '==', productValue))
          );
          snap.forEach((docSnap) => {
            const d = docSnap.data();
            const key = buildGenericStageDuplicateKey(stage, date, (fieldKey) => String(d[fieldKey] ?? ''));
            if (key) liveDuplicateKeys.add(key);
          });
        } catch (err) {
          // FAIL CLOSED (Phase 4F.2): never fall back to a full collection
          // scan, and never silently allow this anchor group's rows through
          // un-verified - mark them unverifiable instead.
          console.warn(`Generic historical import final duplicate recheck warning (${stage}) - failing closed for this anchor group:`, err);
          rowIndexes.forEach((idx) => failedRowIndexSet.add(idx));
        }
      })
    );

    if (liveDuplicateKeys.size > 0 || failedRowIndexSet.size > 0) {
      writableRows = validRows.filter((row) => {
        if (failedRowIndexSet.has(row.rowIndex)) {
          recheckFailedRowIndexes.push(row.rowIndex);
          return false;
        }
        const key = rowKeyByIndex.get(row.rowIndex);
        if (key && liveDuplicateKeys.has(key)) {
          duplicateSkippedRowIndexes.push(row.rowIndex);
          return false;
        }
        return true;
      });
    }
  }

  const batchSize = 400;
  let success = 0;
  const errors: string[] = [];

  /**
   * F-03.1 - ROW-LEVEL FAILURE ISOLATION.
   *
   * A Firestore writeBatch().commit() is ATOMIC, so the previous
   * one-batch-per-chunk loop discarded every row of a chunk when any single
   * row in it was rejected - `success` never incremented for up to 399
   * already-validated rows because of one bad neighbour.
   *
   * This delegates to runChunkedWriteWithFallback - the SAME orchestrator
   * Tube/Ball Mills, Pressing and Chinese Mills use, not a second strategy.
   * The happy path still writes one atomic batch per chunk, so a normal
   * import pays no extra write cost; only when a chunk's commit rejects does
   * it retry that one chunk's rows individually, in a single bounded pass.
   * Later chunks are still processed after an earlier chunk fails.
   *
   * Each row's docRef is allocated up-front, so a row retried by the
   * fallback reuses the id the batch had already assigned and can never
   * produce a duplicate document.
   */
  const entries = writableRows.map((row) => {
      const docRef = doc(collection(db, collectionName));
      const raw = row.data;

      const record: any = {
        id: docRef.id,
        stageType: stage,
        status: 'SUBMITTED',
        isHistoricalImport: true,
        rawData: raw,
        createdBy: auth.currentUser?.uid || 'SUPER_ADMIN',
        createdByName: auth.currentUser?.email || 'مشرف الاستيراد التاريخي',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        serverCreatedAt: serverTimestamp(),
      };

      config.importFields.forEach((fieldDef) => {
        const val = readImportFieldValue(fieldDef, raw);

        if (fieldDef.type === 'number') {
          record[fieldDef.key] = val ? Number(val) : 0;
        } else if (fieldDef.type === 'date') {
          // PHASE 4F: normalize to canonical YYYY-MM-DD (same helper
          // Pressing/Chinese Mills/Tube-Ball Mills already use), instead
          // of writing the raw, possibly non-canonical Excel string
          // verbatim - this stage's own duplicate identity (and Phase
          // 4A's date-range bounding) both depend on a consistent format.
          const { dateStr, isValid } = normalizeDateInput(val);
          record[fieldDef.key] = isValid ? dateStr : val;
        } else if (fieldDef.type === 'masterData' && fieldDef.entityType) {
          record[fieldDef.key] = val;
          const list = masterDataByType[fieldDef.entityType] || [];
          const found = list.find((item: any) => (item.code && item.code === val) || (item.name && item.name === val));
          if (found) {
            const masterField = config.masterDataFields.find((m) => m.entityType === fieldDef.entityType);
            if (masterField) record[masterField.field] = found.id;
          }
        } else {
          record[fieldDef.key] = val;
        }
      });

      if (!record.date) {
        record.date = new Date().toISOString().split('T')[0];
      }

      return { row, docRef, record };
  });

  const writeResult = await runChunkedWriteWithFallback({
    items: entries,
    chunkSize: batchSize,
    getId: (e) => e.row.rowIndex,
    writeChunk: async (chunk) => {
      const batch = writeBatch(db);
      chunk.forEach((e) => batch.set(e.docRef, e.record));
      await batch.commit();
    },
    // Individual-row fallback - only ever invoked after writeChunk rejects
    // for the chunk this row belongs to, reusing the pre-assigned docRef.
    writeOne: async (e) => { await safeSetDoc(e.docRef, e.record); },
    // This function's own onProgress takes only a percent; the extra
    // batch arguments the orchestrator supplies are simply ignored.
    onProgress: onProgress ? (percent) => onProgress(percent) : undefined,
  });

  success = writeResult.importedIds.length;
  errors.push(...writeResult.errors);
  /** F-03.1 - rowIndex of every row whose OWN individual write failed; these stay reviewable/re-importable. */
  const failedRowIndexes = writeResult.failedIds as number[];

  await logAuditAction(
    'BULK_IMPORT',
    collectionName,
    'excel_import',
    `تم استيراد ${success} سجل لمرحلة ${stage} من ملف Excel` +
      `${duplicateSkippedRowIndexes.length > 0 ? ` (تم تجاوز ${duplicateSkippedRowIndexes.length} صف مكرر عند إعادة الفحص النهائي)` : ''}` +
      `${recheckFailedRowIndexes.length > 0 ? ` (تعذر التحقق النهائي من ${recheckFailedRowIndexes.length} صف ولم يتم استيراده)` : ''}`
  );

  return {
    total: writableRows.length,
    success,
    errors,
    duplicateSkippedCount: duplicateSkippedRowIndexes.length,
    duplicateSkippedRowIndexes,
    // Phase 4F.2: distinct from duplicateSkippedCount - these rows were
    // never confirmed as duplicates, their final recheck simply could not
    // be completed, so they were conservatively excluded rather than
    // risking a silent double-write.
    recheckFailedCount: recheckFailedRowIndexes.length,
    recheckFailedRowIndexes,
    failedRowIndexes,
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

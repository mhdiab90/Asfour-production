/**
 * Tube/Ball Mills Historical Import Service.
 *
 * Stage-specific parallel to chineseMillsHistoricalImportService.ts (itself
 * parallel to pressingHistoricalImportService.ts), reusing the SAME generic
 * engines (fuzzy matching, mapping history, Firestore write safety,
 * selection/writability rules) but with this stage's own 7-field schema and
 * its own Mill/Material/Mixture/Bunker resolution - never a blind copy of
 * Chinese Mills' Customer/MillType/FaultType/Specification concepts.
 */
import * as XLSX from 'xlsx';
import { collection, doc, getDocs, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Product, TubeBallMillsImportRow, TubeBallMillsImportSummary, TubeBallMillsImportStatus } from '../types';
import { fetchMasterData, createMasterDataItem } from './masterDataService';
import { logAuditAction } from './auditService';
import { logHistoricalImportExecution, saveApprovedMappingBatch, loadApprovedMappings, getDomainApprovedMappings } from './importMappingService';
import { normalizeDateInput } from './pressingHistoricalImportService';
import { safeBatchSet, safeSetDoc } from '../utils/firestoreSanitizer';
import { isPermissionDeniedError } from './chineseMillsHistoricalImportService';
import { isTubeBallMillsRowWritable } from './tubeBallMillsSelectionPure';
import { parseMaterialTypeField, findEquivalentMixture, ExistingMixtureCandidate, resolveAluminaPayloadValue } from './tubeBallMillsMixturePure';
import { parseBunkerTokens, resolveBunkerAllocationQuantities, isBunkerAllocationValid } from './tubeBallMillsBunkerPure';
import { runChunkedWriteWithFallback } from './tubeBallMillsChunkedWritePure';
import { resolveNumericFields } from './tubeBallMillsNumericPure';
import { resolveMasterDataField, MasterDataDomain, EntityListItem, ManualOverrideMap, buildMappingEntryCandidates } from './tubeBallMillsResolutionPure';

export const TUBE_BALL_MILLS_COLLECTION = 'stage_tube_ball_mills';
/** New equipment master data collection (§7/§8 of this task) - starts unregistered in MasterDataView, populated only via this import's own "Code New Mill" action, exactly mirroring how 'chineseMills' itself started (see the Mill type's own comment in types/index.ts). */
export const TUBE_BALL_MILL_MASTER_COLLECTION = 'tubeBallMills';
/** New Storage Bunker master data collection (§20) - no prior bunker/silo collection existed anywhere in the codebase. */
export const BUNKER_COLLECTION = 'bunkers';

export type { MasterDataDomain, EntityListItem, ManualOverrideMap } from './tubeBallMillsResolutionPure';

export interface MasterDataLoadError {
  domain: MasterDataDomain;
  labelAr: string;
  labelEn: string;
  isPermissionDenied: boolean;
}

const DOMAIN_LABELS: Record<MasterDataDomain, { ar: string; en: string }> = {
  mill: { ar: 'الطواحين الأنبوبية والكرات', en: 'Tube/Ball Mills' },
  material: { ar: 'الخامات', en: 'Materials' },
  bunker: { ar: 'البناكر', en: 'Storage Bunkers' },
};

/** Same controlled-degradation pattern as chineseMillsHistoricalImportService.ts's own fetchMasterDataSafe (§8 of this task) - a failed load is reported as data, never thrown past this point, so one inaccessible collection never takes down Mill/Material resolution too. Reuses isPermissionDeniedError directly rather than re-detecting the error shape. */
export async function fetchMasterDataSafe<T>(collectionName: string, domain: MasterDataDomain): Promise<{ data: T[]; error?: MasterDataLoadError }> {
  try {
    const data = await fetchMasterData<T>(collectionName);
    return { data };
  } catch (err) {
    console.error(`[TubeBallMillsImport] Failed to load "${collectionName}" (${domain}):`, err);
    return {
      data: [],
      error: { domain, labelAr: DOMAIN_LABELS[domain].ar, labelEn: DOMAIN_LABELS[domain].en, isPermissionDenied: isPermissionDeniedError(err) },
    };
  }
}

export function describeMasterDataLoadError(err: MasterDataLoadError, language: 'ar' | 'en'): string {
  if (err.isPermissionDenied) {
    return language === 'ar'
      ? `لا توجد لديك صلاحية الاطلاع على "${err.labelAr}" المطلوبة لاستيراد بيانات الطواحين الأنبوبية والكرات.`
      : `You do not have permission to view "${err.labelEn}" required for the Tube/Ball Mills import.`;
  }
  return language === 'ar' ? `تعذر تحميل "${err.labelAr}" حاليًا.` : `Could not load "${err.labelEn}" right now.`;
}

const IMPORT_FIELD_DEFS: Array<{ key: string; labelAr: string; labelEn: string; sample: string | number }> = [
  { key: 'date', labelAr: 'التاريخ', labelEn: 'Date', sample: '2026-03-01' },
  { key: 'millType', labelAr: 'نوع الطاحونة', labelEn: 'Mill Type', sample: 'طاحونة 1' },
  { key: 'materialType', labelAr: 'نوع الخامة', labelEn: 'Material Type', sample: 'جريت40%' },
  { key: 'hours', labelAr: 'عدد الساعات', labelEn: 'Hours', sample: 8 },
  { key: 'tonsPerHour', labelAr: 'الطن بالساعه', labelEn: 'Tons Per Hour', sample: 12.5 },
  { key: 'storageBunkers', labelAr: 'بناكر التخزين', labelEn: 'Storage Bunkers', sample: '54-65-66' },
  { key: 'total', labelAr: 'الإجمالي', labelEn: 'Total', sample: 100 },
];

export function getTubeBallMillsImportHeaders(language: 'ar' | 'en' = 'ar'): string[] {
  return IMPORT_FIELD_DEFS.map((f) => (language === 'ar' ? f.labelAr : f.labelEn));
}

/**
 * Generates the 7-column Tube/Ball Mills Excel template in the requested
 * language, with one clearly-marked, never-imported sample row - the exact
 * same pattern as downloadChineseMillsExcelTemplate/pressingHistoricalImportService's
 * own template generator (same XLSX infra already imported, no new
 * dependency). The sample row's date cell carries the same
 * "مثال — لا يتم استيراده" / "SAMPLE — do not import" marker
 * parseAndValidateTubeBallMillsExcel already recognizes and skips (see its
 * sampleMarker check), so re-uploading the downloaded template unmodified
 * produces zero importable rows rather than a phantom sample record.
 */
export function downloadTubeBallMillsExcelTemplate(language: 'ar' | 'en' = 'ar'): void {
  const headers = getTubeBallMillsImportHeaders(language);
  const sampleRow: Record<string, any> = {};
  IMPORT_FIELD_DEFS.forEach((f) => {
    const label = language === 'ar' ? f.labelAr : f.labelEn;
    sampleRow[label] = f.key === 'date' ? (language === 'ar' ? 'مثال — لا يتم استيراده' : 'SAMPLE — do not import') : f.sample;
  });

  const ws = XLSX.utils.json_to_sheet([sampleRow], { header: headers });
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'قالب_الطواحين_الأنبوبية_والكرات' : 'TubeBallMills_Template');
  XLSX.writeFile(wb, `ASFOUR_Template_TubeBallMills_${new Date().toISOString().split('T')[0]}.xlsx`);
}

const FIELD_ALIASES = {
  date: ['التاريخ', 'Date', 'date'],
  millType: ['نوع الطاحونة', 'Mill Type', 'millType'],
  materialType: ['نوع الخامة', 'Material Type', 'materialType'],
  hours: ['عدد الساعات', 'Hours', 'hours'],
  tonsPerHour: ['الطن بالساعه', 'الطن بالساعة', 'Tons Per Hour', 'tonsPerHour'],
  storageBunkers: ['بناكر التخزين', 'Storage Bunkers', 'storageBunkers'],
  total: ['الإجمالي', 'Total', 'total'],
} as const;

function readField(rowData: Record<string, any>, aliases: readonly string[]): string {
  for (const alias of aliases) {
    const raw = rowData[alias];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      return String(raw).trim();
    }
  }
  return '';
}

export interface TubeBallMillsMasterDataBundle {
  mills: EntityListItem[];
  materials: EntityListItem[];
  bunkers: EntityListItem[];
  mixtures: ExistingMixtureCandidate[];
}

/**
 * Re-runs Mill/Material/Mixture/Bunker resolution for ONE row's current
 * field values - the single mechanism behind the initial parse, global
 * mapping propagation, manual-edit revalidation, and re-include
 * revalidation (mirrors revalidateChineseMillsRowFields's own role exactly
 * - never a second/divergent revalidation path).
 */
export function revalidateTubeBallMillsRowFields(
  fields: {
    date: string;
    millTypeRaw: string;
    materialTypeRaw: string;
    hoursRaw: string;
    tonsPerHourRaw: string;
    storageBunkersRaw: string;
    totalRaw: string;
  },
  masterData: TubeBallMillsMasterDataBundle,
  approvedMappings: Record<string, Record<string, string>>,
  language: 'ar' | 'en',
  manualOverrides: ManualOverrideMap = {},
  unavailable: Partial<Record<MasterDataDomain, boolean>> = {},
  /** Gap-fix §5/§22: the row's CURRENT bunker allocations before this revalidation pass (undefined on first parse) - lets bunker quantities survive a user's manual edit through re-revalidation instead of being silently regenerated back to an equal split every time. See resolveBunkerAllocationQuantities. */
  previousBunkerAllocations?: Array<{ bunkerRaw: string; allocatedTons: number }>
): Omit<TubeBallMillsImportRow, 'rowIndex' | 'raw' | 'isDuplicate' | 'duplicateType' | 'rowSelection' | 'exclusionReason' | 'excludedBy' | 'excludedAt' | 'importOutcome' | 'editedRowData' | 'resolutionHistory' | 'warningsAccepted' | 'warningOverrideBy' | 'warningOverrideAt' | 'approved' | 'approvedBy' | 'approvedAt' | 'approvalMethod' | 'readyToImport' | 'readyToImportBy' | 'readyToImportAt' | 'readyToImportMethod' | 'preReadyToImportState'> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Date (required, non-overridable - §23 mirrors Chinese Mills' own date rule)
  const { dateStr, isValid: dateValid } = normalizeDateInput(fields.date);
  if (!fields.date.trim() || !dateValid) {
    errors.push(language === 'ar' ? 'التاريخ مفقود أو غير صالح.' : 'Date is missing or invalid.');
  }

  // Mill Type (§7-8) - OPTIONAL per the existing generic import schema
  // (productionStageConfig.ts's tube_ball_mills.importFields: `millType`
  // is `required: false`, only `totalTons` is required for this stage).
  // A blank value is therefore not an error at all (§J: "for OPTIONAL:
  // allow resolve/clear/exclude/continue") - only a PRESENT-but-unresolved
  // value needs review, exactly mirroring how Chinese Mills treats its own
  // optional Customer field.
  const millRes = (!fields.millTypeRaw.trim() || unavailable.mill) ? {} : resolveMasterDataField('mill', fields.millTypeRaw, masterData.mills, getDomainApprovedMappings('tubeBallMill'), manualOverrides);
  if (fields.millTypeRaw.trim()) {
    if (unavailable.mill) {
      errors.push(language === 'ar' ? `تعذر التحقق من نوع الطاحونة "${fields.millTypeRaw}": البيانات الأساسية غير متاحة حاليًا (صلاحيات).` : `Could not verify Mill Type "${fields.millTypeRaw}": Master Data is currently unavailable (permission).`);
    } else if (!millRes.resolved) {
      errors.push(language === 'ar' ? `نوع الطاحونة "${fields.millTypeRaw}" غير معروف - يتطلب مراجعة.` : `Mill Type "${fields.millTypeRaw}" is unknown - requires review.`);
    }
  }
  const suggestedMillId = millRes.suggestedId;
  const suggestedMillCode = millRes.suggestedCode;
  const suggestedMillName = millRes.suggestedName;
  const suggestedMillConfidence = millRes.suggestedConfidence;

  // Material Type (§9-14) - single material, single-with-alumina, or mixture.
  const materialParse = parseMaterialTypeField(fields.materialTypeRaw);
  let isMixture = false;
  let resolvedMaterialId: string | undefined, resolvedMaterialCode: string | undefined, resolvedMaterialName: string | undefined;
  let suggestedMaterialId: string | undefined, suggestedMaterialCode: string | undefined, suggestedMaterialName: string | undefined, suggestedMaterialConfidence: number | undefined;
  let detectedAluminaPercentage: number | undefined;
  let mixtureComponents: TubeBallMillsImportRow['mixtureComponents'];
  let mixtureTotalQuantityKg: number | undefined;
  let resolvedMixtureProductId: string | undefined, resolvedMixtureProductCode: string | undefined, resolvedMixtureProductName: string | undefined;
  let suggestedMixtureProductId: string | undefined, suggestedMixtureProductName: string | undefined, suggestedMixtureMatchReason: string | undefined;

  // Material Type is OPTIONAL per the existing schema (required: false) - a
  // blank value is simply left unresolved with no error at all, matching
  // Mill Type's exact reasoning above.
  if (!fields.materialTypeRaw.trim()) {
    // intentionally no error - see comment above.
  } else if (materialParse.kind === 'UNPARSEABLE_MIXTURE') {
    isMixture = true;
    errors.push(
      language === 'ar'
        ? `تعذر تفسير مكونات الخلطة - الأجزاء التالية بلا وزن واضح: ${materialParse.unparsedSegments.join('، ')}`
        : `Could not interpret mixture components - the following segments have no clear quantity: ${materialParse.unparsedSegments.join(', ')}`
    );
  } else if (materialParse.kind === 'MIXTURE') {
    isMixture = true;
    mixtureTotalQuantityKg = materialParse.totalQuantityKg;
    if (unavailable.material) {
      errors.push(language === 'ar' ? 'تعذر التحقق من مكونات الخلطة: البيانات الأساسية للخامات غير متاحة حاليًا (صلاحيات).' : 'Could not verify mixture components: Material Master Data is currently unavailable (permission).');
      mixtureComponents = materialParse.components.map((c) => ({ materialNameRaw: c.materialNameRaw, quantityKg: c.quantityKg, percentage: c.percentage }));
    } else {
      mixtureComponents = materialParse.components.map((c) => {
        const res = resolveMasterDataField('material', c.materialNameRaw, masterData.materials, getDomainApprovedMappings('tubeBallMaterial'), manualOverrides);
        return {
          materialNameRaw: c.materialNameRaw,
          quantityKg: c.quantityKg,
          percentage: c.percentage,
          resolvedMaterialId: res.resolved?.id,
          resolvedMaterialCode: res.resolved?.code,
          resolvedMaterialName: res.resolved?.name,
        };
      });
      const unresolvedCount = mixtureComponents.filter((c) => !c.resolvedMaterialId).length;
      if (unresolvedCount > 0) {
        errors.push(
          language === 'ar'
            ? `${unresolvedCount} من مكونات الخلطة غير معروفة في البيانات الأساسية - يتطلب مراجعة.`
            : `${unresolvedCount} mixture component(s) are unknown in Master Data - requires review.`
        );
      } else {
        // §14/§48: every component resolved - search for an existing equivalent mixture before requiring the user to create one.
        const equivalent = findEquivalentMixture(mixtureComponents.map((c) => ({ resolvedMaterialId: c.resolvedMaterialId, percentage: c.percentage })), masterData.mixtures);
        if (equivalent) {
          suggestedMixtureProductId = equivalent.productId;
          suggestedMixtureProductName = equivalent.productName;
          suggestedMixtureMatchReason = language === 'ar' ? 'مطابقة بنفس المكونات والنسب لخلطة موجودة.' : 'Matches an existing mixture by identical components and ratios.';
        } else {
          errors.push(language === 'ar' ? 'لا توجد خلطة/BOM مطابقة في البيانات الأساسية - يتطلب اختيار أو إنشاء.' : 'No matching mixture/BOM found in Master Data - requires selection or creation.');
        }
      }
    }
  } else if (materialParse.kind === 'SINGLE_WITH_ALUMINA' || materialParse.kind === 'SINGLE_PLAIN') {
    const materialName = materialParse.kind === 'SINGLE_WITH_ALUMINA' ? materialParse.materialName : materialParse.materialName;
    detectedAluminaPercentage = materialParse.kind === 'SINGLE_WITH_ALUMINA' ? materialParse.aluminaPercentage : undefined;
    // materialName can only be empty here if the raw field was blank - already handled above (no error). A non-empty parsed name always means the field had content, so it is always worth attempting resolution.
    if (materialName) {
      if (unavailable.material) {
        errors.push(language === 'ar' ? `تعذر التحقق من الخامة "${materialName}": البيانات الأساسية غير متاحة حاليًا (صلاحيات).` : `Could not verify Material "${materialName}": Master Data is currently unavailable (permission).`);
      } else {
        const res = resolveMasterDataField('material', materialName, masterData.materials, getDomainApprovedMappings('tubeBallMaterial'), manualOverrides);
        resolvedMaterialId = res.resolved?.id;
        resolvedMaterialCode = res.resolved?.code;
        resolvedMaterialName = res.resolved?.name;
        if (!res.resolved) {
          errors.push(language === 'ar' ? `الخامة "${materialName}" غير معروفة - يتطلب مراجعة.` : `Material "${materialName}" is unknown - requires review.`);
          suggestedMaterialId = res.suggestedId;
          suggestedMaterialCode = res.suggestedCode;
          suggestedMaterialName = res.suggestedName;
          suggestedMaterialConfidence = res.suggestedConfidence;
        }
      }
    }
  }

  // Hours/Total/Tons-Per-Hour (§23-25/§J) - delegated to the pure,
  // independently-tested resolveNumericFields (tubeBallMillsNumericPure.ts)
  // rather than reimplemented inline, so this required-vs-optional business
  // logic has real unit test coverage (this file cannot be imported outside
  // a Vite runtime - verified empirically). Required/optional status is
  // taken verbatim from the EXISTING generic import schema
  // (productionStageConfig.ts): only totalTons is required.
  const numeric = resolveNumericFields(fields.hoursRaw, fields.totalRaw, fields.tonsPerHourRaw);
  const { operatingHours, totalTons } = numeric;
  let tonsPerHour = numeric.tonsPerHour;
  const tonsPerHourDerived = numeric.tonsPerHourDerived;
  const tonsPerHourMismatch = numeric.tonsPerHourMismatch;

  if (!numeric.hoursValid) {
    errors.push(language === 'ar' ? 'عدد الساعات غير رقمي.' : 'Hours is not numeric.');
  }
  if (!numeric.totalValid) {
    errors.push(language === 'ar' ? 'الإجمالي مفقود أو غير صالح.' : 'Total is missing or invalid.');
  }
  if (!numeric.tonsPerHourValid) {
    errors.push(language === 'ar' ? 'الطن بالساعة غير رقمي.' : 'Tons Per Hour is not numeric.');
  }
  if (tonsPerHourMismatch) {
    const derivedRate = totalTons / operatingHours;
    warnings.push(
      language === 'ar'
        ? `الطن بالساعة المصرح به (${tonsPerHour}) يختلف عن المحسوب من الإجمالي/الساعات (${derivedRate.toFixed(2)}).`
        : `Declared Tons/Hour (${tonsPerHour}) differs from Total/Hours (${derivedRate.toFixed(2)}).`
    );
  }

  // Storage Bunkers (§19-22) - OPTIONAL per the existing schema. A blank
  // value means there is nothing to allocate at all - never an error, and
  // bunkerAllocationValid is vacuously true (§J: optional -> allow
  // "exclude field" outright, never forced to provide a value).
  const bunkerTokens = parseBunkerTokens(fields.storageBunkersRaw);
  let bunkerAllocations: TubeBallMillsImportRow['bunkerAllocations'] = [];
  let bunkerAllocationValid = true;
  if (bunkerTokens.length > 0) {
    const suggestion = resolveBunkerAllocationQuantities(bunkerTokens, totalTons, previousBunkerAllocations);
    bunkerAllocations = suggestion.map((s) => {
      const res = unavailable.bunker ? {} : resolveMasterDataField('bunker', s.bunkerRaw, masterData.bunkers, getDomainApprovedMappings('tubeBallBunker'), manualOverrides);
      return {
        bunkerRaw: s.bunkerRaw,
        resolvedBunkerId: res.resolved?.id,
        resolvedBunkerCode: res.resolved?.code,
        resolvedBunkerName: res.resolved?.name,
        allocatedTons: s.allocatedTons,
      };
    });
    bunkerAllocationValid = isBunkerAllocationValid(bunkerAllocations, totalTons);
    if (!bunkerAllocationValid) {
      errors.push(language === 'ar' ? 'توزيع البناكر لا يساوي الإجمالي.' : 'Bunker allocation does not equal Total.');
    }
    const unresolvedBunkers = bunkerAllocations.filter((b) => !b.resolvedBunkerId);
    if (unresolvedBunkers.length > 0) {
      if (unavailable.bunker) {
        errors.push(language === 'ar' ? 'تعذر التحقق من البناكر: البيانات الأساسية غير متاحة حاليًا (صلاحيات).' : 'Could not verify bunkers: Master Data is currently unavailable (permission).');
      } else {
        errors.push(
          language === 'ar'
            ? `${unresolvedBunkers.length} من البناكر غير معروفة في البيانات الأساسية - يتطلب مراجعة.`
            : `${unresolvedBunkers.length} bunker(s) are unknown in Master Data - requires review.`
        );
      }
    }
  }

  let status: TubeBallMillsImportStatus;
  if (!dateValid) status = 'INVALID_DATE';
  else if (fields.millTypeRaw.trim() && !millRes.resolved) status = 'UNKNOWN_MILL';
  else if (isMixture && materialParse.kind === 'UNPARSEABLE_MIXTURE') status = 'UNRESOLVED_MIXTURE_COMPONENT';
  else if (isMixture && !resolvedMixtureProductId && errors.length > 0) status = 'UNRESOLVED_MIXTURE_COMPONENT';
  else if (!isMixture && fields.materialTypeRaw.trim() && !resolvedMaterialId) status = 'UNKNOWN_MATERIAL';
  else if (bunkerTokens.length > 0 && bunkerAllocations.some((b) => !b.resolvedBunkerId)) status = 'UNKNOWN_BUNKER';
  else if (bunkerTokens.length > 0 && !bunkerAllocationValid) status = 'INVALID_BUNKER_ALLOCATION';
  else if (errors.length > 0) status = 'INVALID_ROW';
  else if (warnings.length > 0) status = 'WARNING';
  else status = 'VALID';

  return {
    date: dateStr || fields.date,
    millTypeRaw: fields.millTypeRaw,
    resolvedMillId: millRes.resolved?.id,
    resolvedMillCode: millRes.resolved?.code,
    resolvedMillName: millRes.resolved?.name,
    suggestedMillId,
    suggestedMillCode,
    suggestedMillName,
    suggestedMillConfidence,
    materialTypeRaw: fields.materialTypeRaw,
    isMixture,
    resolvedMaterialId,
    resolvedMaterialCode,
    resolvedMaterialName,
    suggestedMaterialId,
    suggestedMaterialCode,
    suggestedMaterialName,
    suggestedMaterialConfidence,
    detectedAluminaPercentage,
    mixtureComponents,
    mixtureTotalQuantityKg,
    resolvedMixtureProductId,
    resolvedMixtureProductCode,
    resolvedMixtureProductName,
    suggestedMixtureProductId,
    suggestedMixtureProductName,
    suggestedMixtureMatchReason,
    operatingHours,
    tonsPerHour,
    totalTons,
    tonsPerHourMismatch,
    tonsPerHourDerived,
    storageBunkersRaw: fields.storageBunkersRaw,
    bunkerAllocations,
    bunkerAllocationValid,
    status,
    errors,
    warnings,
  };
}

/** Extracts the field set revalidateTubeBallMillsRowFields needs from an existing row (used for Manual Edit / global mapping propagation / re-include). */
export function extractFieldsFromRow(row: TubeBallMillsImportRow) {
  return {
    date: row.date,
    millTypeRaw: row.millTypeRaw,
    materialTypeRaw: row.materialTypeRaw,
    hoursRaw: String(row.operatingHours ?? ''),
    tonsPerHourRaw: String(row.tonsPerHour ?? ''),
    storageBunkersRaw: row.storageBunkersRaw,
    totalRaw: String(row.totalTons ?? ''),
  };
}

export async function parseAndValidateTubeBallMillsExcel(fileBuffer: ArrayBuffer, language: 'ar' | 'en' = 'ar'): Promise<TubeBallMillsImportSummary> {
  const workbook = XLSX.read(fileBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const [millsRes, materialsRes, bunkersRes, productsRes, approvedMappings, existingSnap] = await Promise.all([
    fetchMasterDataSafe<EntityListItem>(TUBE_BALL_MILL_MASTER_COLLECTION, 'mill'),
    fetchMasterDataSafe<EntityListItem & { aluminaPercentage?: number }>('materials', 'material'),
    fetchMasterDataSafe<EntityListItem>(BUNKER_COLLECTION, 'bunker'),
    fetchMasterDataSafe<Product>('products', 'material'),
    loadApprovedMappings().catch(() => ({})),
    getDocs(collection(db, TUBE_BALL_MILLS_COLLECTION)).catch(() => ({ docs: [] } as any)),
  ]);

  const masterDataLoadErrors: MasterDataLoadError[] = [millsRes.error, materialsRes.error, bunkersRes.error].filter((e): e is MasterDataLoadError => !!e);
  const unavailable: Partial<Record<MasterDataDomain, boolean>> = { mill: !!millsRes.error, material: !!materialsRes.error, bunker: !!bunkersRes.error };

  const mixtures: ExistingMixtureCandidate[] = (productsRes.data || [])
    .filter((p) => p.isMixtureBOM && p.mixtureComponents && p.mixtureComponents.length > 0)
    .map((p) => ({ productId: p.id || '', productName: p.name, components: p.mixtureComponents!.map((c) => ({ materialId: c.materialId, percentage: c.percentage })) }));

  const masterData: TubeBallMillsMasterDataBundle = { mills: millsRes.data, materials: materialsRes.data, bunkers: bunkersRes.data, mixtures };

  const dbKeySet = new Set<string>();
  existingSnap.docs.forEach((d: any) => {
    const data = d.data();
    if (data.date) {
      dbKeySet.add(`${data.date}#${(data.millTypeId || data.millType || '').toString().toLowerCase()}#${(data.rawMaterialType || '').toString().toLowerCase()}`);
    }
  });

  const fileKeySet = new Set<string>();
  const parsedRows: TubeBallMillsImportRow[] = [];
  let validRows = 0, warningRows = 0, errorRows = 0, duplicateRows = 0;
  let unknownMillsCount = 0, unknownMaterialsCount = 0, unresolvedMixtureCount = 0, unknownBunkersCount = 0, invalidBunkerAllocationCount = 0;

  rawRows.forEach((row, idx) => {
    const dateRaw = readField(row, FIELD_ALIASES.date);
    const sampleMarker = (dateRaw + readField(row, FIELD_ALIASES.millType)).toUpperCase();
    if (sampleMarker.includes('مثال') || sampleMarker.includes('لا يتم استيراده') || sampleMarker.includes('SAMPLE') || sampleMarker.includes('DO NOT IMPORT')) return;

    const fields = {
      date: dateRaw,
      millTypeRaw: readField(row, FIELD_ALIASES.millType),
      materialTypeRaw: readField(row, FIELD_ALIASES.materialType),
      hoursRaw: readField(row, FIELD_ALIASES.hours),
      tonsPerHourRaw: readField(row, FIELD_ALIASES.tonsPerHour),
      storageBunkersRaw: readField(row, FIELD_ALIASES.storageBunkers),
      totalRaw: readField(row, FIELD_ALIASES.total),
    };

    const resolved = revalidateTubeBallMillsRowFields(fields, masterData, approvedMappings, language, {}, unavailable);

    const key = `${resolved.date}#${(resolved.resolvedMillCode || resolved.millTypeRaw).toLowerCase()}#${resolved.materialTypeRaw.toLowerCase()}`;
    let isDuplicate = false;
    let duplicateType: 'FILE' | 'DATABASE' | undefined;
    if (resolved.status !== 'INVALID_DATE' && resolved.date) {
      if (fileKeySet.has(key)) {
        isDuplicate = true;
        duplicateType = 'FILE';
        resolved.errors.push(language === 'ar' ? 'صف مكرر داخل نفس الملف.' : 'Duplicate row within the same file.');
      } else if (dbKeySet.has(key)) {
        isDuplicate = true;
        duplicateType = 'DATABASE';
        if (resolved.errors.length === 0) {
          resolved.warnings.push(language === 'ar' ? 'يوجد سجل مشابه مستورد مسبقًا في قاعدة البيانات.' : 'A similar record already exists in the database.');
        }
      }
      fileKeySet.add(key);
    }

    const finalRow: TubeBallMillsImportRow = {
      rowIndex: idx + 2,
      raw: row,
      ...resolved,
      isDuplicate,
      duplicateType,
      // Row-Based Review: a row with a blocking error is parked as PENDING automatically on first parse - never lost (same convention as Chinese Mills).
      rowSelection: resolved.errors.length > 0 ? 'PENDING' : 'INCLUDED',
    };

    if (resolved.errors.length > 0) errorRows++;
    else if (resolved.warnings.length > 0) warningRows++;
    else validRows++;
    if (isDuplicate) duplicateRows++;
    if (finalRow.status === 'UNKNOWN_MILL') unknownMillsCount++;
    if (finalRow.status === 'UNKNOWN_MATERIAL') unknownMaterialsCount++;
    if (finalRow.status === 'UNRESOLVED_MIXTURE_COMPONENT') unresolvedMixtureCount++;
    if (finalRow.status === 'UNKNOWN_BUNKER') unknownBunkersCount++;
    if (finalRow.status === 'INVALID_BUNKER_ALLOCATION') invalidBunkerAllocationCount++;

    parsedRows.push(finalRow);
  });

  return {
    totalRows: parsedRows.length,
    validRows,
    warningRows,
    errorRows,
    duplicateRows,
    unknownMillsCount,
    unknownMaterialsCount,
    unresolvedMixtureCount,
    unknownBunkersCount,
    invalidBunkerAllocationCount,
    rows: parsedRows,
    masterDataLoadErrors: masterDataLoadErrors.length > 0 ? masterDataLoadErrors : undefined,
  };
}

/**
 * §38: full pre-execution revalidation against the LATEST Master Data,
 * mirroring executeChineseMillsBatchImport's own recheck-database-duplicates
 * pass. Re-checks database duplicates only (file duplicates were already
 * settled at parse time and never change).
 */
export async function recheckDatabaseDuplicates(rows: TubeBallMillsImportRow[], language: 'ar' | 'en'): Promise<TubeBallMillsImportRow[]> {
  const existingSnap = await getDocs(collection(db, TUBE_BALL_MILLS_COLLECTION)).catch(() => ({ docs: [] } as any));
  const dbKeySet = new Set<string>();
  existingSnap.docs.forEach((d: any) => {
    const data = d.data();
    if (data.date) {
      dbKeySet.add(`${data.date}#${(data.millTypeId || data.millType || '').toString().toLowerCase()}#${(data.rawMaterialType || '').toString().toLowerCase()}`);
    }
  });
  return rows.map((row) => {
    const key = `${row.date}#${(row.resolvedMillCode || row.millTypeRaw).toLowerCase()}#${row.materialTypeRaw.toLowerCase()}`;
    if (dbKeySet.has(key) && row.duplicateType !== 'DATABASE') {
      return {
        ...row,
        isDuplicate: true,
        duplicateType: 'DATABASE' as const,
        warnings: [...row.warnings, language === 'ar' ? 'يوجد سجل مشابه مستورد حديثًا في قاعدة البيانات.' : 'A similar record was recently imported into the database.'],
      };
    }
    return row;
  });
}

/**
 * Creates a mixture/BOM Product from a row's resolved components (§14) -
 * ONLY ever called after explicit user confirmation in the Mixture Coding
 * window, NEVER automatically. Reuses the existing Products/Master Data
 * write path (createMasterDataItem) rather than a new collection - callers
 * must check Master Data Add permission before invoking this (§8/§46,
 * enforced by the panel, not re-checked here since this is a plain service
 * function with no permission context of its own, matching every other
 * master-data-item creator in this codebase).
 */
export async function createMixtureBOMProduct(
  name: string,
  components: Array<{ materialId: string; materialCode?: string; materialName: string; quantityKg: number; percentage: number }>
): Promise<string> {
  const id = await createMasterDataItem<Partial<Product>>('products', {
    code: '',
    name,
    category: 'MIXTURE_BOM',
    isMixtureBOM: true,
    mixtureComponents: components,
    active: true,
  });
  if (!id) throw new Error('Failed to create mixture/BOM product');
  return id;
}

interface HistoryContext {
  fileName?: string;
  totalRowsInSession?: number;
  selectedCount?: number;
  approvedCount?: number;
  correctedCount?: number;
  warningCount?: number;
  blockingCount?: number;
}

/**
 * Batch-writes every writable row to Firestore, isolating row/chunk
 * failures (§39) exactly like executeChineseMillsBatchImport - a
 * writeBatch().commit() per 400-row chunk, cancellable only at chunk
 * boundaries, never claiming rollback of an already-committed chunk.
 * Generates a REAL importId (HIST-IMP-TBM- prefix, matching the
 * HIST-IMP- convention every reliable ImportId in this app already uses -
 * see importHistoryPure.ts's hasReliableImportId) - never the legacy
 * 'excel_import' sentinel bug found and fixed in the Historical Import
 * History audit.
 */
export async function executeTubeBallMillsBatchImport(
  rowsToImport: TubeBallMillsImportRow[],
  backupId?: string,
  onProgress?: (percent: number, currentBatch: number, totalBatches: number) => void,
  shouldCancel?: () => boolean,
  historyContext?: HistoryContext
): Promise<{ importedCount: number; failedCount: number; skippedCount: number; cancelledCount: number; errors: string[]; importId: string; importedRowIndexes: number[]; failedRowIndexes: number[] }> {
  const writable = rowsToImport.filter(isTubeBallMillsRowWritable);
  const skippedCount = rowsToImport.length - writable.length;
  const importId = `HIST-IMP-TBM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const currentUser = auth.currentUser;

  const BATCH_SIZE = 400;
  const mappingEntries: Array<{ domain: string; originalValue: string; mappedEntityId: string; mappedEntityName: string; mappedEntityCode?: string; confidence: number; matchType: string }> = [];

  const buildPayload = (row: TubeBallMillsImportRow, docRef: ReturnType<typeof doc>) => ({
    id: docRef.id,
    stageType: 'tube_ball_mills',
    date: row.date,
    millType: row.resolvedMillName || row.millTypeRaw,
    millTypeId: row.resolvedMillId || '',
    millTypeName: row.resolvedMillName || '',
    rawMaterialType: row.materialTypeRaw,
    materialId: row.isMixture ? (row.resolvedMixtureProductId || '') : (row.resolvedMaterialId || ''),
    materialCode: row.isMixture ? (row.resolvedMixtureProductCode || '') : (row.resolvedMaterialCode || ''),
    materialName: row.isMixture ? (row.resolvedMixtureProductName || '') : (row.resolvedMaterialName || ''),
    isMixtureMaterial: row.isMixture,
    // Gap-fix §4: a single (non-mixture) raw material's own detected alumina percentage (e.g. "جريت40%") rides through to the production record - never set for a mixture/BOM row, never invented when the source never carried one.
    aluminaPercentage: resolveAluminaPayloadValue(row.isMixture, row.detectedAluminaPercentage),
    operatingHours: row.operatingHours,
    tonsPerHour: row.tonsPerHour,
    storageBunker: row.bunkerAllocations.map((b) => b.bunkerRaw).join('-'),
    bunkerAllocations: row.bunkerAllocations.map((b) => ({ bunkerId: b.resolvedBunkerId || '', bunkerCode: b.resolvedBunkerCode || '', bunkerNumber: b.bunkerRaw, allocatedTons: b.allocatedTons })),
    totalTons: row.totalTons,
    status: 'SUBMITTED',
    isHistoricalImport: true,
    sourceType: 'HISTORICAL_IMPORT',
    importBatchId: importId,
    importedAt: new Date().toISOString(),
    importedByUid: currentUser?.uid || 'SUPER_ADMIN',
    importedByName: currentUser?.email || 'مشرف الاستيراد التاريخي',
    backupId: backupId || null,
    rawData: row.raw,
    createdBy: currentUser?.uid || 'SUPER_ADMIN',
    createdByName: currentUser?.email || 'مشرف الاستيراد التاريخي',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    serverCreatedAt: serverTimestamp(),
  });

  // Gap-fix §9/§10: pre-generate every doc ref + payload ONCE, so the same
  // ref/payload is reused whether it is written as part of its chunk's batch
  // or, on that chunk's failure, retried individually - never two different
  // ids for the same row. Mapping entries (Global Mapping persistence, §8)
  // are collected here unconditionally, exactly matching the prior
  // behavior of collecting them while building the batch regardless of the
  // eventual write outcome.
  const entries = writable.map((row) => {
    const docRef = doc(collection(db, TUBE_BALL_MILLS_COLLECTION));
    const payload = buildPayload(row, docRef);

    // Gap-fix §8: extend cross-session approved-mapping persistence (previously Mill-only) to an explicitly-resolved single Material and to explicitly-resolved Bunkers - never for a merely-suggested (not yet accepted) match. Logic lives in the pure, directly-tested buildMappingEntryCandidates.
    mappingEntries.push(...buildMappingEntryCandidates(row));

    return { row, docRef, payload };
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
    // Individual-row fallback (§10) - only ever invoked after writeChunk rejects for the chunk this item belongs to.
    writeOne: async (e) => { await safeSetDoc(e.docRef, e.payload); },
    shouldCancel,
    onProgress,
  });

  const importedCount = writeResult.importedIds.length;
  const cancelledCount = writeResult.cancelledCount;
  const errors = writeResult.errors;
  const importedRowIndexes = writeResult.importedIds as number[];
  const failedRowIndexes = writeResult.failedIds as number[];

  if (mappingEntries.length > 0) {
    await saveApprovedMappingBatch(mappingEntries).catch(() => {});
  }

  await logHistoricalImportExecution({
    importBatchId: importId,
    stage: 'tube_ball_mills',
    fileName: historyContext?.fileName || '',
    totalRows: historyContext?.totalRowsInSession ?? rowsToImport.length,
    importedCount,
    failedCount: rowsToImport.length - importedCount - skippedCount - cancelledCount,
    skippedCount,
    cancelledCount,
    remainingCount: rowsToImport.length - importedCount - skippedCount - cancelledCount,
    approvedMappingsCount: mappingEntries.length,
    selectedCount: historyContext?.selectedCount,
    approvedCount: historyContext?.approvedCount,
    correctedCount: historyContext?.correctedCount,
    warningCount: historyContext?.warningCount,
    blockingCount: historyContext?.blockingCount,
    performedBy: currentUser?.uid || 'SUPER_ADMIN',
    performedByName: currentUser?.email || '',
    performedAt: new Date().toISOString(),
    backupId,
  }).catch(() => {});

  await logAuditAction(
    'BULK_IMPORT',
    TUBE_BALL_MILLS_COLLECTION,
    importId,
    cancelledCount > 0
      ? `استيراد تاريخي للطواحين الأنبوبية والكرات (أُلغي جزئيًا): ${importedCount} سجل بنجاح، ${cancelledCount} أُلغي قبل التنفيذ، من أصل ${rowsToImport.length}`
      : `استيراد تاريخي للطواحين الأنبوبية والكرات: ${importedCount} سجل بنجاح من أصل ${rowsToImport.length}`
  ).catch(() => {});

  return {
    importedCount,
    failedCount: rowsToImport.length - importedCount - skippedCount - cancelledCount,
    skippedCount,
    cancelledCount,
    errors,
    importId,
    importedRowIndexes,
    failedRowIndexes,
  };
}

/** Record-level detail for a completed import operation's Import Details view - a single equality query on the SAME importBatchId field the write above stamps, never a broad scan (§27/§44). */
export async function getTubeBallMillsImportedRowsByBatch(importBatchId: string): Promise<any[]> {
  if (!importBatchId) return [];
  const q = query(collection(db, TUBE_BALL_MILLS_COLLECTION), where('importBatchId', '==', importBatchId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

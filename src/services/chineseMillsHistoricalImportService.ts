/**
 * Chinese Mills Historical Import Service.
 *
 * Stage-specific parallel to pressingHistoricalImportService.ts, reusing the
 * SAME generic engines (fuzzy matching, mapping history, business
 * validation warnings, Firestore write safety) but with Chinese Mills' own
 * 17-field schema - never Pressing's Furnace Car + Brick Count concept, and
 * never a blind copy of Pressing's row shape.
 */
import * as XLSX from 'xlsx';
import { collection, doc, getDocs, query, where, writeBatch, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { Customer, Product, ChineseMillsImportRow, ChineseMillsImportSummary, ChineseMillsImportStatus } from '../types';
import { fetchMasterData, createMasterDataItem, updateMasterDataItem } from './masterDataService';
import { logAuditAction } from './auditService';
import { logHistoricalImportExecution, saveApprovedMappingBatch, loadApprovedMappings, getDomainApprovedMappings } from './importMappingService';
import { normalizeArabicForComparison, normalizeCodeForComparison, findBestFuzzyCandidates } from '../utils/fuzzyMatching';
import { parseShiftNumber, buildShiftDisplayName, buildShiftCode } from '../utils/shiftUtils';
import { evaluateBagWeightConsistency, buildInvalidShiftMessage } from '../utils/businessValidationRules';
import { toWesternDigits } from '../utils/formatters';
import { normalizeDateInput } from './pressingHistoricalImportService';
import { safeBatchSet } from '../utils/firestoreSanitizer';
import { isChineseMillsRowWritable } from './chineseMillsSelectionPure';

export const CHINESE_MILLS_COLLECTION = 'stage_chinese_mills';
export const CHINESE_MILLS_MASTER_COLLECTION = 'chineseMills';
export const FAULT_TYPES_COLLECTION = 'faultTypes';

/**
 * Firebase Firestore SDK errors set `error.code === 'permission-denied'`.
 * `fetchMasterData` (masterDataService.ts) wraps that in
 * `handleFirestoreError()`, which re-throws `new Error(JSON.stringify(...))`
 * - a diagnostic blob containing the ORIGINAL error text, operationType, and
 * path - so `.code` is lost by the time it reaches this service, but the
 * stringified message still contains the original text. Detecting both
 * shapes here means a caller never has to show that raw JSON/text to a user.
 */
export function isPermissionDeniedError(err: unknown): boolean {
  const anyErr = err as any;
  if (anyErr?.code === 'permission-denied') return true;
  const message = String(anyErr?.message || err || '');
  return message.includes('permission-denied') || message.includes('Missing or insufficient permissions');
}

export type MasterDataDomain = 'customer' | 'millType' | 'faultType' | 'specification';

export interface MasterDataLoadError {
  domain: MasterDataDomain;
  labelAr: string;
  labelEn: string;
  isPermissionDenied: boolean;
}

const DOMAIN_LABELS: Record<MasterDataDomain, { ar: string; en: string }> = {
  customer: { ar: 'العملاء', en: 'Customers' },
  millType: { ar: 'الطواحين الصينية', en: 'Chinese Mills' },
  faultType: { ar: 'أنواع الأعطال', en: 'Fault Types' },
  specification: { ar: 'المنتجات', en: 'Products' },
};

/**
 * Fetches one Master Data collection WITHOUT letting a permission (or any
 * other) failure abort the whole import screen (§8) - failures are reported
 * back as data, never thrown past this point, so ONE inaccessible
 * collection can never take down Customer/Mill Type resolution too.
 */
export async function fetchMasterDataSafe<T>(collectionName: string, domain: MasterDataDomain): Promise<{ data: T[]; error?: MasterDataLoadError }> {
  try {
    const data = await fetchMasterData<T>(collectionName);
    return { data };
  } catch (err) {
    console.error(`[ChineseMillsImport] Failed to load "${collectionName}" (${domain}):`, err);
    return {
      data: [],
      error: { domain, labelAr: DOMAIN_LABELS[domain].ar, labelEn: DOMAIN_LABELS[domain].en, isPermissionDenied: isPermissionDeniedError(err) },
    };
  }
}

/** Builds a clean, bilingual, NEVER-raw-Firestore-text message for a failed Master Data load (§7/§20). Technical detail is only ever logged via console.error above - never shown to the user. */
export function describeMasterDataLoadError(err: MasterDataLoadError, language: 'ar' | 'en'): string {
  if (err.isPermissionDenied) {
    return language === 'ar'
      ? `لا توجد لديك صلاحية الاطلاع على "${err.labelAr}" المطلوبة لاستيراد بيانات الطواحين الصينية.`
      : `You do not have permission to view "${err.labelEn}" required for the Chinese Mills import.`;
  }
  return language === 'ar' ? `تعذر تحميل "${err.labelAr}" حاليًا.` : `Could not load "${err.labelEn}" right now.`;
}

/**
 * Unit-bearing display labels (Unit Correction §1-5): Weight Class is a
 * per-bag KILOGRAM value, Theoretical/Actual Rate are both in TONS - never
 * interchangeable, never silently converted. These are the PRIMARY column
 * headers (used for template generation, §6) and error-message labels; the
 * old unsuffixed spellings are kept as fallback parser aliases only, so a
 * file created before this correction still imports correctly.
 */
const WEIGHT_CLASS_LABEL = { ar: 'فئة الوزن (كجم)', en: 'Weight Class (kg)' };
const THEORETICAL_RATE_LABEL = { ar: 'المعدل النظري (طن)', en: 'Theoretical Rate (Tons)' };
const ACTUAL_RATE_LABEL = { ar: 'المعدل الفعلي (طن)', en: 'Actual Rate (Tons)' };

/** Field definitions in the exact 17-field order (§1/§50), each carrying its own bilingual, unit-correct display label - the single source used to build BOTH the Arabic and English template (§6). */
const IMPORT_FIELD_DEFS: Array<{ key: string; labelAr: string; labelEn: string; sample: string | number }> = [
  { key: 'date', labelAr: 'التاريخ', labelEn: 'Date', sample: '2026-03-01' },
  { key: 'customerName', labelAr: 'اسم العميل', labelEn: 'Customer Name', sample: 'شركة النور' },
  { key: 'specificationCode', labelAr: 'كود المواصفة', labelEn: 'Specification Code', sample: 'SP-250' },
  { key: 'millType', labelAr: 'نوع الطاحونة', labelEn: 'Mill Type', sample: '1' },
  { key: 'shift', labelAr: 'الوردية', labelEn: 'Shift', sample: '1' },
  { key: 'productionQuantity', labelAr: 'كمية الإنتاج (طن)', labelEn: 'Production Quantity (Tons)', sample: 3.75 },
  { key: 'numberOfBags', labelAr: 'عدد الجواني', labelEn: 'Number of Bags', sample: 5 },
  { key: 'rejectedQuantity', labelAr: 'المرفوض', labelEn: 'Rejected Quantity', sample: 0.1 },
  { key: 'operatingMinutes', labelAr: 'دقائق التشغيل', labelEn: 'Operating Minutes', sample: 30 },
  { key: 'operatingHours', labelAr: 'ساعات التشغيل', labelEn: 'Operating Hours', sample: 3 },
  { key: 'downtimeHours', labelAr: 'ساعات الأعطال', labelEn: 'Downtime Hours', sample: 0.5 },
  { key: 'faultType', labelAr: 'نوع العطل', labelEn: 'Fault Type', sample: 'ميكانيكي' },
  { key: 'specification', labelAr: 'المواصفة', labelEn: 'Specification', sample: 'High Density Grade 250' },
  { key: 'weightClass', labelAr: WEIGHT_CLASS_LABEL.ar, labelEn: WEIGHT_CLASS_LABEL.en, sample: 750 },
  { key: 'theoreticalRate', labelAr: THEORETICAL_RATE_LABEL.ar, labelEn: THEORETICAL_RATE_LABEL.en, sample: 2 },
  { key: 'actualRate', labelAr: ACTUAL_RATE_LABEL.ar, labelEn: ACTUAL_RATE_LABEL.en, sample: 1.1 },
  { key: 'notes', labelAr: 'ملاحظات', labelEn: 'Notes', sample: 'ملاحظة تشغيل' },
];

/** Builds the 17 template column headers in the requested language, with correct units (§6). */
export function getChineseMillsImportHeaders(language: 'ar' | 'en' = 'ar'): string[] {
  return IMPORT_FIELD_DEFS.map((f) => (language === 'ar' ? f.labelAr : f.labelEn));
}

const FIELD_ALIASES = {
  date: ['التاريخ', 'Date', 'date'],
  customerName: ['اسم العميل', 'Customer Name', 'customerName'],
  /** Not one of the official 17 template columns - only read opportunistically if a file happens to carry it, to drive the Customer Future Code proposal (§5). */
  customerCode: ['كود العميل', 'Customer Code', 'customerCode'],
  specificationCode: ['كود المواصفة', 'Specification Code', 'specificationCode'],
  millType: ['نوع الطاحونة', 'Mill Type', 'millType'],
  shift: ['الوردية', 'Shift', 'shift'],
  productionQuantity: ['كمية الإنتاج (طن)', 'Production Quantity (Tons)', 'كمية الإنتاج', 'Production Quantity', 'quantity'],
  numberOfBags: ['عدد الجواني', 'Number of Bags', 'numberOfBags'],
  rejectedQuantity: ['المرفوض', 'Rejected Quantity', 'rejectedQuantity'],
  operatingMinutes: ['دقائق التشغيل', 'Operating Minutes', 'operatingMinutes'],
  operatingHours: ['ساعات التشغيل', 'Operating Hours', 'operatingHours'],
  downtimeHours: ['ساعات الأعطال', 'Downtime Hours', 'downtimeHours'],
  faultType: ['نوع العطل', 'Fault Type', 'faultType'],
  specification: ['المواصفة', 'Specification', 'specification'],
  // Unit-suffixed forms listed first (current template output, §6); the old
  // unsuffixed spellings stay as fallback aliases so files created under the
  // original spec (before this Unit Correction) still parse correctly.
  weightClass: [WEIGHT_CLASS_LABEL.ar, WEIGHT_CLASS_LABEL.en, 'فئة الوزن', 'Weight Class', 'weightClass'],
  theoreticalRate: [THEORETICAL_RATE_LABEL.ar, THEORETICAL_RATE_LABEL.en, 'المعدل النظري', 'Theoretical Rate', 'theoreticalRate'],
  actualRate: [ACTUAL_RATE_LABEL.ar, ACTUAL_RATE_LABEL.en, 'المعدل الفعلي', 'Actual Rate', 'actualRate'],
  notes: ['ملاحظات', 'Notes', 'notes'],
} as const;

/** Existing approved baseline used by the live entry form (ChineseMillsEntryForm.tsx) when no Theoretical Rate is imported - reused, never re-derived. */
const DEFAULT_THEORETICAL_RATE = 2.0;

function readField(rowData: Record<string, any>, aliases: readonly string[]): string {
  for (const alias of aliases) {
    const raw = rowData[alias];
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      return String(raw).trim();
    }
  }
  return '';
}

function parseNum(raw: string): number | null {
  if (!raw) return null;
  const western = toWesternDigits(raw).replace(/,/g, '').trim();
  if (!western) return null;
  const n = Number(western);
  return Number.isFinite(n) ? n : null;
}

type FieldDomain = 'customer' | 'millType' | 'faultType' | 'specification';
type ProposedMatch = NonNullable<ChineseMillsImportRow['proposedMatches']>[number];

interface EntityListItem {
  id?: string;
  code?: string;
  name?: string;
}

interface FieldResolution {
  resolved?: { id: string; code: string; name: string };
  proposedMatch?: ProposedMatch;
  autoAcceptedNote?: string;
}

/**
 * Shared resolution strategy for Customer / Mill Type / Fault Type (§3, §7-8,
 * §17): exact code/name -> approved mapping memory -> fuzzy candidates
 * (auto-accepted only at >=90 confidence, otherwise deferred to human
 * review) -> nothing found. One function, three call sites below - never a
 * fourth incompatible matcher.
 */
/**
 * Session-local resolution decisions keyed `${fieldDomain}::${normalizedValue}`
 * (§4/§39: stage+entityType+normalizedValue - never cross-field/cross-entity
 * contamination). Populated whenever the user Approves/Chooses
 * Existing/Manually Edits+resolves/Adds a value for ANY row; consulted
 * BEFORE exact/mapping/fuzzy matching for every row so that re-running
 * revalidateChineseMillsRowFields (the exact same function used for the
 * initial parse) on every row after one decision is enough to propagate it
 * everywhere - no separate/divergent "apply to matching rows" code path.
 */
export type ManualOverrideMap = Record<string, { id: string; code: string; name: string }>;

function overrideKey(fieldDomain: FieldDomain, normalizedValue: string): string {
  return `${fieldDomain}::${normalizedValue}`;
}

function resolveEntityField(
  fieldDomain: FieldDomain,
  fieldNameAr: string,
  fieldNameEn: string,
  rawValue: string,
  list: EntityListItem[],
  approvedMappings: Record<string, string>,
  language: 'ar' | 'en',
  manualOverrides: ManualOverrideMap = {}
): FieldResolution {
  const trimmed = rawValue.trim();
  if (!trimmed) return {};

  const normName = normalizeArabicForComparison(trimmed);
  const normCode = normalizeCodeForComparison(trimmed);

  const override = manualOverrides[overrideKey(fieldDomain, normName)] || manualOverrides[overrideKey(fieldDomain, normCode)];
  if (override) {
    return { resolved: override };
  }

  let matched = list.find(
    (item) =>
      (item.code && normalizeCodeForComparison(item.code) === normCode) ||
      (item.name && normalizeArabicForComparison(item.name) === normName)
  );

  if (!matched && approvedMappings[normName]) {
    matched = list.find((item) => item.id === approvedMappings[normName]);
  }

  if (matched) {
    return { resolved: { id: matched.id || '', code: matched.code || '', name: matched.name || '' } };
  }

  const candidates = findBestFuzzyCandidates(trimmed, list, {
    extractCode: (i: any) => i.code,
    extractName: (i: any) => i.name,
    minConfidence: 65,
    maxResults: 4,
  });

  if (candidates.length > 0) {
    const top = candidates[0];
    const proposedMatch: ProposedMatch = {
      fieldDomain,
      fieldNameAr,
      fieldNameEn,
      importedValue: trimmed,
      suggestedId: top.id,
      suggestedCode: top.code,
      suggestedName: top.name,
      confidence: top.confidence,
      matchType: top.matchType,
      reasonAr: top.reasonAr,
      reasonEn: top.reasonEn,
      decision: top.confidence >= 90 ? 'ACCEPTED' : 'PENDING',
      candidates: candidates.map((c) => ({ id: c.id, code: c.code, name: c.name, confidence: c.confidence, matchType: c.matchType, reasonAr: c.reasonAr, reasonEn: c.reasonEn })),
    };
    if (top.confidence >= 90) {
      return {
        resolved: { id: top.id, code: top.code, name: top.name },
        proposedMatch,
        autoAcceptedNote:
          language === 'ar'
            ? `تمت مطابقة "${trimmed}" تلقائيًا مع "${top.name}" (${top.confidence}% ثقة).`
            : `"${trimmed}" was automatically matched to "${top.name}" (${top.confidence}% confidence).`,
      };
    }
    return { proposedMatch };
  }

  return {
    proposedMatch: {
      fieldDomain,
      fieldNameAr,
      fieldNameEn,
      importedValue: trimmed,
      confidence: 0,
      matchType: 'NONE',
      reasonAr: 'لا يوجد تطابق في البيانات الأساسية.',
      reasonEn: 'No Master Data match found.',
      decision: 'PENDING',
      candidates: [],
    },
  };
}

/**
 * Generates the 17-column Chinese Mills Excel template (§50) in the
 * requested language, with correct units on Weight Class/Theoretical
 * Rate/Actual Rate (Unit Correction §6), and one clearly-marked,
 * never-imported sample row (same convention as
 * pressingHistoricalImportService.ts's "مثال — لا يتم استيراده").
 */
export function downloadChineseMillsExcelTemplate(language: 'ar' | 'en' = 'ar'): void {
  const headers = getChineseMillsImportHeaders(language);
  const sampleValues: Record<string, string | number> = Object.fromEntries(IMPORT_FIELD_DEFS.map((f) => [f.key, f.sample]));
  sampleValues.date = language === 'ar' ? 'مثال — لا يتم استيراده' : 'SAMPLE — do not import';

  const sampleRow: Record<string, any> = {};
  IMPORT_FIELD_DEFS.forEach((f) => {
    sampleRow[language === 'ar' ? f.labelAr : f.labelEn] = sampleValues[f.key];
  });

  const ws = XLSX.utils.json_to_sheet([sampleRow], { header: headers });
  ws['!cols'] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, language === 'ar' ? 'قالب_الطواحين_الصينية' : 'ChineseMills_Template');
  XLSX.writeFile(wb, `ASFOUR_Template_ChineseMills_${new Date().toISOString().split('T')[0]}.xlsx`);
}

/**
 * Revalidates ONE row's current field values (used both for the initial
 * parse and for full-row-edit / excluded-row-repair revalidation - §29,
 * §36-37 - so re-checking a row after a correction runs the EXACT same
 * rules as the original parse, never a lighter/divergent check).
 */
export function revalidateChineseMillsRowFields(
  fields: {
    date: string;
    customerNameRaw: string;
    customerCodeRaw?: string;
    specificationCodeRaw: string;
    millTypeRaw: string;
    shiftRaw: string;
    productionQuantityRaw: string;
    numberOfBagsRaw: string;
    rejectedQuantityRaw: string;
    operatingMinutesRaw: string;
    operatingHoursRaw: string;
    downtimeHoursRaw: string;
    faultTypeRaw: string;
    specification: string;
    weightClassRaw: string;
    theoreticalRateRaw: string;
    actualRateRaw: string;
    notes: string;
  },
  masterData: { customers: EntityListItem[]; mills: EntityListItem[]; faultTypes: EntityListItem[]; products: EntityListItem[] },
  approvedMappings: Record<string, Record<string, string>>,
  language: 'ar' | 'en',
  previousActualRateDecision?: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'NOT_APPLICABLE',
  manualOverrides: ManualOverrideMap = {},
  /** §9/§13: when a domain's Master Data could not be loaded (permission error, etc.), matching is SKIPPED for it rather than attempted against an empty list - which would otherwise misreport every real value as "unknown". */
  unavailable: Partial<Record<MasterDataDomain, boolean>> = {}
): Omit<ChineseMillsImportRow, 'rowIndex' | 'raw' | 'rowSelection' | 'exclusionReason' | 'excludedBy' | 'excludedAt' | 'importOutcome' | 'editedRowData' | 'resolutionHistory' | 'originalExclusionReason' | 'warningsAccepted' | 'warningOverrideBy' | 'warningOverrideAt' | 'rowVersions'> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const warningCodes: string[] = [];
  const proposedMatches: ProposedMatch[] = [];

  // Date (required)
  const { dateStr, isValid: dateValid } = normalizeDateInput(fields.date);
  if (!fields.date.trim() || !dateValid) {
    errors.push(language === 'ar' ? 'التاريخ مفقود أو غير صالح.' : 'Date is missing or invalid.');
  }

  // Customer (optional field; if present, must resolve - unless the Customer list itself couldn't be loaded, §9: OPTIONAL field, import may continue without resolution)
  const customerRes = unavailable.customer ? {} : resolveEntityField('customer', 'اسم العميل', 'Customer Name', fields.customerNameRaw, masterData.customers, getDomainApprovedMappingsFrom(approvedMappings, 'customer'), language, manualOverrides);
  if (customerRes.proposedMatch) proposedMatches.push(customerRes.proposedMatch);
  if (customerRes.autoAcceptedNote) warnings.push(customerRes.autoAcceptedNote);
  if (unavailable.customer && fields.customerNameRaw.trim()) {
    warnings.push(language === 'ar' ? `تعذر التحقق من العميل "${fields.customerNameRaw}": بيانات العملاء غير متاحة حاليًا (صلاحيات). سيتم الاستيراد دون ربط العميل.` : `Could not verify Customer "${fields.customerNameRaw}": Customer data is currently unavailable (permission). Will import without a linked Customer.`);
  } else if (fields.customerNameRaw.trim() && !customerRes.resolved) {
    errors.push(language === 'ar' ? `العميل "${fields.customerNameRaw}" غير معروف - يتطلب مراجعة.` : `Customer "${fields.customerNameRaw}" is unknown - requires review.`);
  }

  // Customer Future Code proposal (§5) - only when the file happens to carry an extra code column
  let customerCodeUpdateProposal: ChineseMillsImportRow['customerCodeUpdateProposal'] | undefined;
  if (customerRes.resolved && fields.customerCodeRaw?.trim() && !customerRes.resolved.code) {
    customerCodeUpdateProposal = { currentCode: '', proposedCode: fields.customerCodeRaw.trim(), decision: 'PENDING' };
  }

  // Specification Code ("كود المواصفة") - CRITICAL SCHEMA CORRECTION: this,
  // not "المواصفة"/specification, is Chinese Mills' actual Product Code
  // identity field. Optional-but-must-resolve-if-present (blocking only
  // when a value IS present and doesn't match any Product - see specRes
  // below), never hard-required.
  const specificationCodeRaw = fields.specificationCodeRaw.trim();

  // Mill Type (required per the real ChineseMillsRecord.millType field; matches ONLY Chinese Mills master data - §7)
  const millRes = unavailable.millType ? {} : resolveEntityField('millType', 'نوع الطاحونة', 'Mill Type', fields.millTypeRaw, masterData.mills, getDomainApprovedMappingsFrom(approvedMappings, 'chineseMill'), language, manualOverrides);
  if (millRes.proposedMatch) proposedMatches.push(millRes.proposedMatch);
  if (millRes.autoAcceptedNote) warnings.push(millRes.autoAcceptedNote);
  if (!fields.millTypeRaw.trim()) {
    errors.push(language === 'ar' ? 'نوع الطاحونة مفقود.' : 'Mill Type is missing.');
  } else if (unavailable.millType) {
    // §9: Mill Type is REQUIRED, so the row must stay reviewable-but-blocked
    // rather than silently fabricating a match - the message says exactly
    // WHY it can't be resolved (a permission problem, not a bad value).
    errors.push(language === 'ar' ? `تعذر التحقق من نوع الطاحونة "${fields.millTypeRaw}": البيانات الأساسية للطواحين غير متاحة حاليًا (صلاحيات).` : `Could not verify Mill Type "${fields.millTypeRaw}": Chinese Mills Master Data is currently unavailable (permission).`);
  } else if (!millRes.resolved) {
    errors.push(language === 'ar' ? `نوع الطاحونة "${fields.millTypeRaw}" غير معروف - يتطلب مراجعة.` : `Mill Type "${fields.millTypeRaw}" is unknown - requires review.`);
  }

  // Shift (required; 1/2/3 all valid - §9)
  const shiftNum = parseShiftNumber(fields.shiftRaw);
  if (!fields.shiftRaw.trim() || !shiftNum) {
    errors.push(buildInvalidShiftMessage(fields.shiftRaw, language));
    warningCodes.push('INVALID_SHIFT');
  }

  // Production Quantity (required, tons)
  const productionQuantity = parseNum(fields.productionQuantityRaw);
  if (fields.productionQuantityRaw.trim() === '' || productionQuantity === null || productionQuantity <= 0) {
    errors.push(language === 'ar' ? 'كمية الإنتاج مفقودة أو غير رقمية.' : 'Production Quantity is missing or not numeric.');
  }

  // Optional numeric fields - blocking only if present but non-numeric, never for being blank
  function optionalNum(raw: string, labelAr: string, labelEn: string): number {
    if (!raw.trim()) return 0;
    const n = parseNum(raw);
    if (n === null) {
      errors.push(language === 'ar' ? `"${labelAr}" غير رقمية.` : `"${labelEn}" is not numeric.`);
      return 0;
    }
    return n;
  }

  const numberOfBags = optionalNum(fields.numberOfBagsRaw, 'عدد الجواني', 'Number of Bags');
  const rejectedQuantity = optionalNum(fields.rejectedQuantityRaw, 'المرفوض', 'Rejected Quantity');
  const operatingMinutes = optionalNum(fields.operatingMinutesRaw, 'دقائق التشغيل', 'Operating Minutes');
  const operatingHours = optionalNum(fields.operatingHoursRaw, 'ساعات التشغيل', 'Operating Hours');
  const downtimeHours = optionalNum(fields.downtimeHoursRaw, 'ساعات الأعطال', 'Downtime Hours');
  const weightClassKg = fields.weightClassRaw.trim() ? optionalNum(fields.weightClassRaw, WEIGHT_CLASS_LABEL.ar, WEIGHT_CLASS_LABEL.en) : undefined;
  const theoreticalRateRawNum = fields.theoreticalRateRaw.trim() ? optionalNum(fields.theoreticalRateRaw, THEORETICAL_RATE_LABEL.ar, THEORETICAL_RATE_LABEL.en) : undefined;
  const actualRateImported = fields.actualRateRaw.trim() ? optionalNum(fields.actualRateRaw, ACTUAL_RATE_LABEL.ar, ACTUAL_RATE_LABEL.en) : undefined;

  // Fault Type (optional; if present, must resolve - unless the Fault Type list itself couldn't be loaded, §9: OPTIONAL field, import may continue without resolution)
  const faultRes = unavailable.faultType ? {} : resolveEntityField('faultType', 'نوع العطل', 'Fault Type', fields.faultTypeRaw || '', masterData.faultTypes, getDomainApprovedMappingsFrom(approvedMappings, 'faultType'), language, manualOverrides);
  if (faultRes.proposedMatch) proposedMatches.push(faultRes.proposedMatch);
  if (faultRes.autoAcceptedNote) warnings.push(faultRes.autoAcceptedNote);
  if (unavailable.faultType && (fields.faultTypeRaw || '').trim()) {
    warnings.push(language === 'ar' ? 'لا توجد لديك صلاحية الاطلاع على أنواع الأعطال المطلوبة لاستيراد البيانات - سيتم المتابعة دون مطابقة نوع العطل.' : 'You do not have permission to view the fault types required for this import - continuing without Fault Type matching.');
  } else if ((fields.faultTypeRaw || '').trim() && !faultRes.resolved) {
    errors.push(language === 'ar' ? `نوع العطل "${fields.faultTypeRaw}" غير معروف - يتطلب مراجعة.` : `Fault Type "${fields.faultTypeRaw}" is unknown - requires review.`);
  }

  // CRITICAL SCHEMA CORRECTION: "كود المواصفة"/specificationCodeRaw - NOT
  // "المواصفة"/specification - is Chinese Mills' actual Product Code
  // identity field, resolved against Master Data Products via the SAME
  // resolveEntityField() every other domain here uses, treated as
  // optional-but-must-resolve-if-present exactly like Customer/Fault Type
  // above (never hard-required like Mill Type), so files that never filled
  // this column keep importing exactly as before. "المواصفة"/specification
  // itself is PURE free-text description - never resolved, never validated,
  // stored verbatim exactly as imported (see the `specification` field
  // further below, and the write path in executeChineseMillsBatchImport).
  const specRes = unavailable.specification ? {} : resolveEntityField('specification', 'كود المواصفة', 'Specification Code', specificationCodeRaw, masterData.products, getDomainApprovedMappingsFrom(approvedMappings, 'specification'), language, manualOverrides);
  if (specRes.proposedMatch) proposedMatches.push(specRes.proposedMatch);
  if (specRes.autoAcceptedNote) warnings.push(specRes.autoAcceptedNote);
  if (unavailable.specification && specificationCodeRaw) {
    warnings.push(language === 'ar' ? 'لا توجد لديك صلاحية الاطلاع على بيانات المنتجات المطلوبة لمطابقة كود المواصفة - سيتم المتابعة دون ربط المنتج.' : 'You do not have permission to view the Products data required to match the Specification Code - continuing without linking a Product.');
  } else if (specificationCodeRaw && !specRes.resolved) {
    errors.push(language === 'ar' ? `كود المواصفة "${specificationCodeRaw}" غير موجود في البيانات الأساسية.` : `Specification Code "${specificationCodeRaw}" was not found in Master Data.`);
  }

  // §15: derived total operating time (hours + minutes), NEVER collapsing the two original fields
  const totalOperatingTimeHours = Number((operatingHours + operatingMinutes / 60).toFixed(3));

  // §20: bag x weight-class vs. production-quantity consistency
  let bagWeightExpectedTons: number | undefined;
  let bagWeightMismatch = false;
  if (productionQuantity !== null && weightClassKg) {
    const { expectedTons, result } = evaluateBagWeightConsistency(productionQuantity, numberOfBags, weightClassKg, language);
    bagWeightExpectedTons = expectedTons;
    if (result) {
      bagWeightMismatch = true;
      warnings.push(result.message);
      warningCodes.push(result.code);
    }
  }

  // §21-23: Theoretical/Actual Rate - never auto-overwritten, explicit accept/reject only
  const theoreticalRate = theoreticalRateRawNum ?? DEFAULT_THEORETICAL_RATE;
  const actualRateSuggested = totalOperatingTimeHours > 0 && productionQuantity ? Number((productionQuantity / totalOperatingTimeHours).toFixed(2)) : undefined;

  let actualRateDecision: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'NOT_APPLICABLE';
  let actualRateFinal: number | undefined;
  if (actualRateImported === undefined) {
    // Nothing was imported to preserve - the suggestion (if computable) becomes the value directly, no accept/reject needed.
    actualRateDecision = 'NOT_APPLICABLE';
    actualRateFinal = actualRateSuggested;
  } else if (actualRateSuggested === undefined || actualRateSuggested === actualRateImported) {
    actualRateDecision = 'NOT_APPLICABLE';
    actualRateFinal = actualRateImported;
  } else {
    // Preserve a REJECTED/ACCEPTED decision across revalidation (e.g. full-row-edit) rather than silently resetting the user's prior choice, unless the row never had a decision yet.
    actualRateDecision = previousActualRateDecision && previousActualRateDecision !== 'NOT_APPLICABLE' ? previousActualRateDecision : 'PENDING';
    actualRateFinal = actualRateDecision === 'ACCEPTED' ? actualRateSuggested : actualRateImported;
  }

  // Status categorization
  let status: ChineseMillsImportStatus;
  if (errors.length > 0) {
    if (!dateValid) status = 'INVALID_DATE';
    else if (!fields.millTypeRaw.trim() || !millRes.resolved) status = 'UNKNOWN_MILL';
    else if (!shiftNum) status = 'INVALID_SHIFT';
    else if (fields.customerNameRaw.trim() && !customerRes.resolved) status = 'UNKNOWN_CUSTOMER';
    else if ((fields.faultTypeRaw || '').trim() && !faultRes.resolved) status = 'UNKNOWN_FAULT_TYPE';
    else if (specificationCodeRaw && !specRes.resolved) status = 'UNKNOWN_SPECIFICATION';
    else status = 'INVALID_ROW';
  } else if (warnings.length > 0) {
    status = 'WARNING';
  } else {
    status = 'VALID';
  }

  return {
    date: dateStr,
    customerNameRaw: fields.customerNameRaw,
    customerCodeRaw: fields.customerCodeRaw,
    resolvedCustomerId: customerRes.resolved?.id,
    resolvedCustomerName: customerRes.resolved?.name,
    resolvedCustomerCode: customerRes.resolved?.code,
    customerCodeUpdateProposal,
    specificationCodeRaw,
    millTypeRaw: fields.millTypeRaw,
    resolvedMillId: millRes.resolved?.id,
    resolvedMillCode: millRes.resolved?.code,
    resolvedMillName: millRes.resolved?.name,
    shiftRaw: fields.shiftRaw,
    resolvedShiftNumber: shiftNum || undefined,
    resolvedShiftId: shiftNum ? `shift-${shiftNum}` : undefined,
    resolvedShiftName: shiftNum ? buildShiftDisplayName(shiftNum, language) : undefined,
    productionQuantity: productionQuantity || 0,
    numberOfBags,
    rejectedQuantity,
    operatingMinutes,
    operatingHours,
    totalOperatingTimeHours,
    downtimeHours,
    faultTypeRaw: fields.faultTypeRaw,
    resolvedFaultTypeId: faultRes.resolved?.id,
    resolvedFaultTypeName: faultRes.resolved?.name,
    specification: fields.specification,
    resolvedProductId: specRes.resolved?.id,
    resolvedProductCode: specRes.resolved?.code,
    resolvedProductName: specRes.resolved?.name,
    weightClassKg,
    bagWeightExpectedTons,
    bagWeightMismatch,
    theoreticalRate,
    actualRateImported,
    actualRateSuggested,
    actualRateDecision,
    actualRateFinal,
    notes: fields.notes,
    status,
    errors,
    warnings,
    warningCodes,
    isDuplicate: false,
    proposedMatches,
  };
}

function getDomainApprovedMappingsFrom(all: Record<string, Record<string, string>>, domain: string): Record<string, string> {
  return all[domain] || {};
}

/** Adds one resolution decision to a ManualOverrideMap, keyed by BOTH the normalized name and the normalized code so a later lookup hits regardless of which normalization the raw text happens to match under. */
export function registerManualOverride(
  map: ManualOverrideMap,
  fieldDomain: FieldDomain,
  rawValue: string,
  resolved: { id: string; code: string; name: string }
): ManualOverrideMap {
  const trimmed = rawValue.trim();
  const next = { ...map };
  next[overrideKey(fieldDomain, normalizeArabicForComparison(trimmed))] = resolved;
  next[overrideKey(fieldDomain, normalizeCodeForComparison(trimmed))] = resolved;
  return next;
}

/**
 * Parses and validates an uploaded Chinese Mills Excel file (§1-54). Fetches
 * Customers/Chinese Mills/Fault Types Master Data + approved mapping memory
 * + existing stage_chinese_mills docs (for DB-duplicate detection) once,
 * then resolves every row against them - never a Firestore read per row.
 *
 * Each Master Data collection is fetched INDEPENDENTLY (fetchMasterDataSafe)
 * rather than via one Promise.all - a permission failure on ONE collection
 * (e.g. faultTypes) must never abort loading the others, and must never
 * throw past this function (§8: the import screen must not crash on a
 * missing permission).
 */
export async function parseAndValidateChineseMillsExcel(fileBuffer: ArrayBuffer, language: 'ar' | 'en' = 'ar'): Promise<ChineseMillsImportSummary> {
  const workbook = XLSX.read(fileBuffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows: Record<string, any>[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

  const [customersRes, millsRes, faultTypesRes, productsRes, approvedMappings, existingSnap] = await Promise.all([
    fetchMasterDataSafe<Customer>('customers', 'customer'),
    fetchMasterDataSafe<EntityListItem>(CHINESE_MILLS_MASTER_COLLECTION, 'millType'),
    fetchMasterDataSafe<EntityListItem>(FAULT_TYPES_COLLECTION, 'faultType'),
    fetchMasterDataSafe<Product>('products', 'specification'),
    loadApprovedMappings().catch(() => ({})),
    getDocs(collection(db, CHINESE_MILLS_COLLECTION)).catch(() => ({ docs: [] } as any)),
  ]);

  const customers = customersRes.data;
  const mills = millsRes.data;
  const faultTypes = faultTypesRes.data;
  const products = productsRes.data;
  const masterDataLoadErrors = [customersRes.error, millsRes.error, faultTypesRes.error, productsRes.error].filter((e): e is MasterDataLoadError => !!e);
  const unavailable: Partial<Record<MasterDataDomain, boolean>> = {
    customer: !!customersRes.error,
    millType: !!millsRes.error,
    faultType: !!faultTypesRes.error,
    specification: !!productsRes.error,
  };

  const dbKeySet = new Set<string>();
  existingSnap.docs.forEach((d: any) => {
    const data = d.data();
    if (data.date) {
      dbKeySet.add(`${data.date}#${(data.millTypeId || data.millType || '').toString().toLowerCase()}#${data.shiftNumber || ''}#${(data.customerId || data.customerName || '').toString().toLowerCase()}`);
    }
  });

  const fileKeySet = new Set<string>();
  const parsedRows: ChineseMillsImportRow[] = [];
  let validRows = 0, warningRows = 0, errorRows = 0, duplicateRows = 0;
  let unknownCustomersCount = 0, unknownMillsCount = 0, unknownFaultTypesCount = 0, shiftErrorsCount = 0, bagWeightMismatchCount = 0, actualRateSuggestionsCount = 0;

  rawRows.forEach((row, idx) => {
    const dateRaw = readField(row, FIELD_ALIASES.date);
    const sampleMarker = (dateRaw + readField(row, FIELD_ALIASES.customerName)).toUpperCase();
    if (sampleMarker.includes('مثال') || sampleMarker.includes('لا يتم استيراده') || sampleMarker.includes('SAMPLE') || sampleMarker.includes('DO NOT IMPORT')) return; // skip the template's guide row (Arabic or English)

    const fields = {
      date: dateRaw,
      customerNameRaw: readField(row, FIELD_ALIASES.customerName),
      customerCodeRaw: readField(row, FIELD_ALIASES.customerCode) || undefined,
      specificationCodeRaw: readField(row, FIELD_ALIASES.specificationCode),
      millTypeRaw: readField(row, FIELD_ALIASES.millType),
      shiftRaw: readField(row, FIELD_ALIASES.shift),
      productionQuantityRaw: readField(row, FIELD_ALIASES.productionQuantity),
      numberOfBagsRaw: readField(row, FIELD_ALIASES.numberOfBags),
      rejectedQuantityRaw: readField(row, FIELD_ALIASES.rejectedQuantity),
      operatingMinutesRaw: readField(row, FIELD_ALIASES.operatingMinutes),
      operatingHoursRaw: readField(row, FIELD_ALIASES.operatingHours),
      downtimeHoursRaw: readField(row, FIELD_ALIASES.downtimeHours),
      faultTypeRaw: readField(row, FIELD_ALIASES.faultType),
      specification: readField(row, FIELD_ALIASES.specification),
      weightClassRaw: readField(row, FIELD_ALIASES.weightClass),
      theoreticalRateRaw: readField(row, FIELD_ALIASES.theoreticalRate),
      actualRateRaw: readField(row, FIELD_ALIASES.actualRate),
      notes: readField(row, FIELD_ALIASES.notes),
    };

    const resolved = revalidateChineseMillsRowFields(fields, { customers, mills, faultTypes, products }, approvedMappings, language, undefined, {}, unavailable);

    // Duplicate detection - date + mill + shift + customer composite key
    const key = `${resolved.date}#${(resolved.resolvedMillCode || resolved.millTypeRaw).toLowerCase()}#${resolved.resolvedShiftNumber || ''}#${(resolved.resolvedCustomerId || resolved.customerNameRaw).toLowerCase()}`;
    let isDuplicate = false;
    let duplicateType: 'FILE' | 'DATABASE' | undefined;
    if (resolved.status !== 'INVALID_DATE' && resolved.date) {
      if (fileKeySet.has(key)) {
        isDuplicate = true;
        duplicateType = 'FILE';
        resolved.errors.push(language === 'ar' ? 'صف مكرر داخل نفس الملف.' : 'Duplicate row within the same file.');
        resolved.status = 'DUPLICATE_IN_FILE';
      } else if (dbKeySet.has(key)) {
        isDuplicate = true;
        duplicateType = 'DATABASE';
        if (resolved.errors.length === 0) {
          resolved.warnings.push(language === 'ar' ? 'يوجد سجل مشابه مستورد مسبقًا في قاعدة البيانات.' : 'A similar record already exists in the database.');
          resolved.status = 'DUPLICATE_IN_DATABASE';
        }
      }
      fileKeySet.add(key);
    }

    const finalRow: ChineseMillsImportRow = {
      rowIndex: idx + 2,
      raw: row,
      ...resolved,
      isDuplicate,
      duplicateType,
      // Row-Based Review Part 6: a row with a BLOCKING error is parked as
      // PENDING automatically on first parse - never lost, never silently
      // stuck unusable in the main "select for import" list.
      rowSelection: resolved.errors.length > 0 ? 'PENDING' : 'INCLUDED',
    };

    if (isDuplicate) duplicateRows++;
    if (finalRow.errors.length > 0) errorRows++;
    else if (finalRow.warnings.length > 0) warningRows++;
    else validRows++;

    if (finalRow.status === 'UNKNOWN_CUSTOMER') unknownCustomersCount++;
    if (finalRow.status === 'UNKNOWN_MILL') unknownMillsCount++;
    if (finalRow.status === 'UNKNOWN_FAULT_TYPE') unknownFaultTypesCount++;
    if (finalRow.status === 'INVALID_SHIFT') shiftErrorsCount++;
    if (finalRow.bagWeightMismatch) bagWeightMismatchCount++;
    if (finalRow.actualRateDecision === 'PENDING') actualRateSuggestionsCount++;

    parsedRows.push(finalRow);
  });

  return {
    totalRows: parsedRows.length,
    validRows,
    warningRows,
    errorRows,
    duplicateRows,
    unknownCustomersCount,
    unknownMillsCount,
    unknownFaultTypesCount,
    shiftErrorsCount,
    bagWeightMismatchCount,
    actualRateSuggestionsCount,
    rows: parsedRows,
    masterDataLoadErrors: masterDataLoadErrors.length > 0 ? masterDataLoadErrors : undefined,
  };
}

/**
 * Re-checks the given rows against the CURRENT `stage_chinese_mills` state
 * immediately before a Firestore write (§31: pre-import revalidation;
 * §36/TEST 20: never duplicate an already-imported row) - a row imported by
 * someone else, or in an earlier partial-import run, since this file was
 * first parsed must still be caught even though the in-memory review
 * session never re-ran the initial parse-time duplicate check on its own.
 * Never mutates anything else about the row - only isDuplicate/duplicateType
 * and, if now a file-scoped duplicate no other row in THIS batch owns, a new
 * blocking error explaining why.
 */
export async function recheckDatabaseDuplicates(rows: ChineseMillsImportRow[], language: 'ar' | 'en'): Promise<ChineseMillsImportRow[]> {
  const snap = await getDocs(collection(db, CHINESE_MILLS_COLLECTION));
  const dbKeySet = new Set<string>();
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.date) {
      dbKeySet.add(`${data.date}#${(data.millTypeId || data.millType || '').toString().toLowerCase()}#${data.shiftNumber || ''}#${(data.customerId || data.customerName || '').toString().toLowerCase()}`);
    }
  });

  return rows.map((row) => {
    const key = `${row.date}#${(row.resolvedMillCode || row.millTypeRaw).toLowerCase()}#${row.resolvedShiftNumber || ''}#${(row.resolvedCustomerId || row.customerNameRaw).toLowerCase()}`;
    if (dbKeySet.has(key) && row.duplicateType !== 'DATABASE') {
      return {
        ...row,
        isDuplicate: true,
        duplicateType: 'DATABASE' as const,
        errors: [...row.errors, language === 'ar' ? 'تم استيراد سجل مطابق إلى قاعدة البيانات منذ فحص هذا الملف - لن يتم استيراده مرة أخرى.' : 'A matching record was imported to the database since this file was checked - it will not be imported again.'],
        rowSelection: 'PENDING' as const,
        status: 'DUPLICATE_IN_DATABASE' as const,
      };
    }
    return row;
  });
}

export { isChineseMillsRowWritable };

/**
 * Commits writable rows to `stage_chinese_mills` in 400-row batches (§34).
 * Re-filters to isChineseMillsRowWritable as a final safety net even if the
 * caller already filtered - one bad row is never allowed to block the rest.
 */
export async function executeChineseMillsBatchImport(
  rowsToImport: ChineseMillsImportRow[],
  backupId?: string,
  onProgress?: (percent: number, currentBatch: number, totalBatches: number) => void
): Promise<{ importedCount: number; failedCount: number; skippedCount: number; errors: string[]; importId: string }> {
  const writable = rowsToImport.filter(isChineseMillsRowWritable);
  const skippedCount = rowsToImport.length - writable.length;
  const importId = `HIST-IMP-CM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const currentUser = auth.currentUser;

  const BATCH_SIZE = 400;
  const totalBatches = Math.ceil(writable.length / BATCH_SIZE) || 1;
  let importedCount = 0;
  const errors: string[] = [];
  const mappingEntries: Array<{ domain: string; originalValue: string; mappedEntityId: string; mappedEntityName: string; mappedEntityCode?: string; confidence: number; matchType: string }> = [];

  for (let i = 0; i < writable.length; i += BATCH_SIZE) {
    const chunk = writable.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    const currentBatchNum = Math.floor(i / BATCH_SIZE) + 1;

    chunk.forEach((row) => {
      const docRef = doc(collection(db, CHINESE_MILLS_COLLECTION));
      const efficiencyPercentage = row.theoreticalRate ? Number((((row.actualRateFinal || 0) / row.theoreticalRate) * 100).toFixed(1)) : undefined;

      safeBatchSet(batch, docRef, {
        id: docRef.id,
        stageType: 'chinese_mills',
        date: row.date,
        customerId: row.resolvedCustomerId || '',
        customerCode: row.resolvedCustomerCode || '',
        customerName: row.resolvedCustomerName || row.customerNameRaw || '',
        specificationCode: row.specificationCodeRaw || '',
        millType: row.resolvedMillCode || row.millTypeRaw,
        millTypeId: row.resolvedMillId || '',
        millTypeName: row.resolvedMillName || '',
        shiftType: row.resolvedShiftName || '',
        shiftId: row.resolvedShiftId || '',
        shiftNumber: row.resolvedShiftNumber ?? null,
        quantity: row.productionQuantity,
        numberOfBags: row.numberOfBags,
        rejectedQuantity: row.rejectedQuantity,
        operatingMinutes: row.operatingMinutes,
        operatingHours: row.operatingHours,
        totalOperatingTimeHours: row.totalOperatingTimeHours,
        downtimeHours: row.downtimeHours,
        faultType: row.resolvedFaultTypeName || row.faultTypeRaw || '',
        faultTypeId: row.resolvedFaultTypeId || '',
        specification: row.specification || '',
        productId: row.resolvedProductId || '',
        productCode: row.resolvedProductCode || '',
        productName: row.resolvedProductName || '',
        weightClassKg: row.weightClassKg ?? null,
        theoreticalRatePerHour: row.theoreticalRate,
        actualRatePerHour: row.actualRateFinal ?? 0,
        importedActualRatePerHour: row.actualRateImported ?? null,
        suggestedActualRatePerHour: row.actualRateSuggested ?? null,
        actualRateDecision: row.actualRateDecision,
        efficiencyPercentage,
        notes: row.notes || '',
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

      (row.proposedMatches || []).forEach((m) => {
        if ((m.decision === 'ACCEPTED' || m.confidence >= 90) && m.suggestedId) {
          mappingEntries.push({
            domain: m.fieldDomain === 'millType' ? 'chineseMill' : m.fieldDomain,
            originalValue: m.importedValue,
            mappedEntityId: m.suggestedId,
            mappedEntityName: m.suggestedName || '',
            mappedEntityCode: m.suggestedCode,
            confidence: m.confidence,
            matchType: m.matchType,
          });
        } else if (m.decision === 'MANUAL' && m.manualId) {
          mappingEntries.push({
            domain: m.fieldDomain === 'millType' ? 'chineseMill' : m.fieldDomain,
            originalValue: m.importedValue,
            mappedEntityId: m.manualId,
            mappedEntityName: m.manualName || '',
            confidence: 100,
            matchType: 'MANUAL_MAPPING',
          });
        }
      });
    });

    try {
      await batch.commit();
      importedCount += chunk.length;
      if (onProgress) onProgress(Math.round(((i + chunk.length) / writable.length) * 100), currentBatchNum, totalBatches);
    } catch (err: any) {
      errors.push(`فشل حفظ الدفعة ${currentBatchNum}: ${err.message}`);
    }
  }

  if (mappingEntries.length > 0) {
    await saveApprovedMappingBatch(mappingEntries).catch(() => {});
  }

  await logHistoricalImportExecution({
    importBatchId: importId,
    stage: 'chinese_mills',
    fileName: '',
    totalRows: rowsToImport.length,
    importedCount,
    failedCount: rowsToImport.length - importedCount - skippedCount,
    skippedCount,
    approvedMappingsCount: mappingEntries.length,
    performedBy: currentUser?.uid || 'SUPER_ADMIN',
    performedByName: currentUser?.email || '',
    performedAt: new Date().toISOString(),
    backupId,
  }).catch(() => {});

  await logAuditAction('BULK_IMPORT', CHINESE_MILLS_COLLECTION, importId, `استيراد تاريخي للطواحين الصينية: ${importedCount} سجل بنجاح من أصل ${rowsToImport.length}`).catch(() => {});

  return {
    importedCount,
    failedCount: rowsToImport.length - importedCount - skippedCount,
    skippedCount,
    errors,
    importId,
  };
}

/** §6.1-6.4: creates a Customer with an optional (never invented) code - Name-only creation is a first-class, non-blocking outcome. */
export async function createCustomerFromImport(name: string, code?: string): Promise<string | undefined> {
  return createMasterDataItem<Partial<Customer>>('customers', { code: code?.trim() || '', name: name.trim(), active: true });
}

/** §6.1: Mill Type identity IS its numeric code - required here (unlike Customer/Fault Type). */
export async function createChineseMillFromImport(code: string, name: string): Promise<string | undefined> {
  return createMasterDataItem(CHINESE_MILLS_MASTER_COLLECTION, { code: code.trim(), name: name.trim(), active: true });
}

/** §6.2/§17: Fault Type may be Name-only, matching Customer's convention. */
export async function createFaultTypeFromImport(name: string, code?: string): Promise<string | undefined> {
  return createMasterDataItem(FAULT_TYPES_COLLECTION, { code: code?.trim() || '', name: name.trim(), active: true });
}

/** Master Data Consolidation task - "المواصفة" quick-create against Master Data Products, reusing createMasterDataItem('products', ...)'s existing smart product-code parsing (the SAME path the Master Data Products tab and Pressing's own product quick-create use), never a second/simpler product-creation path. */
export async function createProductFromImport(code: string, name: string): Promise<string | undefined> {
  return createMasterDataItem<Partial<Product>>('products', { code: code.trim(), name: name.trim(), active: true });
}

/** §5/§45: updates the SAME existing customer document with a business code it didn't have - never creates a duplicate. */
export async function applyCustomerCodeUpdate(customerId: string, newCode: string): Promise<void> {
  await updateMasterDataItem<Partial<Customer>>('customers', customerId, { code: newCode.trim() });
}

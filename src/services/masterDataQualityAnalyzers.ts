/**
 * Master Data Quality Report - pure analysis functions only.
 *
 * Deliberately Firebase-free (no import of ../config/firebase or anything
 * that transitively pulls it in) so these functions can be unit-tested with
 * plain in-memory fixtures via `npx tsx`, without needing a Firestore
 * connection or Vite's `import.meta.env` - see scripts/tests/. The
 * Firestore-touching mutation orchestration (safeDeleteMasterDataRecord,
 * archiveMasterDataRecord, restoreMasterDataRecord) lives in
 * masterDataQualityService.ts, which imports and re-exports everything here
 * so no existing call site needs to change.
 */
import { normalizeArabicForComparison, normalizeCodeForComparison, calculateStringSimilarity } from '../utils/fuzzyMatching';
import { MasterDataTab, ProductionRecord } from '../types';

export type QualityIssueType =
  | 'DUPLICATE_CODE'
  | 'DUPLICATE_NAME'
  | 'SIMILAR_NAME'
  | 'MISSING_SEQUENCE'
  | 'INVALID_CODE'
  | 'MISSING_REQUIRED';

export type QualitySeverity = 'HIGH' | 'MEDIUM' | 'LOW' | 'WARNING';

export interface QualityIssue {
  id: string;
  entityType: MasterDataTab;
  issueType: QualityIssueType;
  severity: QualitySeverity;
  documentId: string;
  code: string;
  name: string;
  descriptionAr: string;
  descriptionEn: string;
  relatedDocumentId?: string;
  relatedCode?: string;
  relatedName?: string;
  confidence?: number;
  referenceCount: number;
  isProtected: boolean;
  /** §5 - true when referenceCount could not be verified (production history not fetched) and isProtected was therefore forced true as a safe default, not a confirmed reference. */
  referenceCountUnknown?: boolean;
}

export type ScanCompleteness = 'COMPLETED' | 'SKIPPED_LARGE_DATASET' | 'NOT_RUN_FOR_LARGE_DATASET';

export interface QualityReportSummary {
  totalScanned: number;
  duplicateCodes: number;
  similarNames: number;
  exactDuplicateNames: number;
  invalidCodes: number;
  missingSequenceWarnings: number;
  missingRequiredFields: number;
  protectedRecords: number;
  safeCandidates: number;
  needsReview: number;
  /** §4 - per entity type, whether the O(n^2) similar-name pass actually ran. */
  similarNameScanStatus: Partial<Record<MasterDataTab, ScanCompleteness>>;
  /**
   * §5 - whether production-history-derived reference counts (employees,
   * presses, furnaceCars, customers, shifts, furnaces) were actually computed.
   * When NOT_RUN_FOR_LARGE_DATASET, affected issues are marked
   * referenceCountUnknown so the UI/caller never mistakes "not checked" for
   * "confirmed zero references."
   */
  referenceCountStatus: ScanCompleteness;
}

/** Entity types actually surfaced in the Master Data UI's tabs + covered here. */
export const QUALITY_SCANNED_TYPES: MasterDataTab[] = [
  'employees', 'presses', 'furnaces', 'furnaceCars', 'mills', 'products', 'productTypes', 'customers', 'departments', 'shifts',
];

/** Entity types whose codes are expected to be a numeric sequence (§18). */
const SEQUENTIAL_ENTITY_TYPES: MasterDataTab[] = ['furnaceCars', 'presses', 'employees'];

/**
 * §4 - detectSimilarNames is O(n^2) (pairwise Levenshtein). Above this size
 * it is skipped rather than run, to avoid freezing the browser main thread
 * for tens of seconds on a large list like `products` (thousands of items).
 * Every other analyzer here (duplicate code/name, invalid code, missing
 * required, sequence gaps) is O(n) and stays enabled regardless of size.
 */
export const SIMILAR_NAME_SCAN_MAX_ITEMS = 500;

/**
 * §5 - entity types whose reference-safety count depends on the full
 * `production` history collection (via computeReferenceCounts). `productTypes`
 * (via `products`) and `departments` (via `employees`) are NOT in this list -
 * their reference counts come from collections the caller already fetches
 * for the scan itself, so they stay accurate even when `production` is
 * skipped for size safety.
 */
export const PRODUCTION_DEPENDENT_ENTITY_TYPES: MasterDataTab[] = ['employees', 'presses', 'furnaceCars', 'customers', 'shifts', 'furnaces'];

/** Hard-delete is not supported for productTypes anywhere in this app (MasterDataView routes its "delete" to a deactivate) - the quality report must follow the same rule rather than inventing a new deletion path. */
export const HARD_DELETE_UNSUPPORTED: MasterDataTab[] = ['productTypes'];

export function extractCodeAndName(entityType: MasterDataTab, item: any): { code: string; name: string } {
  if (entityType === 'furnaceCars') return { code: String(item.code || item.carNumber || ''), name: String(item.carNumber || item.code || '') };
  if (entityType === 'productTypes') return { code: String(item.prefixCode || ''), name: String(item.nameAr || item.nameEn || '') };
  return { code: String(item.code || ''), name: String(item.name || '') };
}

function makeIssue(partial: Omit<QualityIssue, 'referenceCount' | 'isProtected'>): Omit<QualityIssue, 'referenceCount' | 'isProtected'> {
  return partial;
}

// ============================================================================
// Analyzers - each takes (entityType, items) for ONE entity type at a time.
// Comparisons never cross entity types (§20: Press 209 and Furnace Car 209
// are unrelated).
// ============================================================================

export function detectMissingRequiredFields(entityType: MasterDataTab, items: any[]) {
  const issues: ReturnType<typeof makeIssue>[] = [];
  for (const item of items) {
    const { code, name } = extractCodeAndName(entityType, item);
    if (!code.trim() || !name.trim()) {
      const missing = [!code.trim() ? 'الكود' : null, !name.trim() ? 'الاسم' : null].filter(Boolean).join(' و ');
      const missingEn = [!code.trim() ? 'code' : null, !name.trim() ? 'name' : null].filter(Boolean).join(' and ');
      issues.push(makeIssue({
        id: `${entityType}-${item.id}-missing`,
        entityType,
        issueType: 'MISSING_REQUIRED',
        severity: 'HIGH',
        documentId: item.id,
        code,
        name,
        descriptionAr: `حقل إلزامي مفقود: ${missing}.`,
        descriptionEn: `Missing required field: ${missingEn}.`,
      }));
    }
  }
  return issues;
}

const VALID_CODE_PATTERN = /^[A-Za-z0-9؀-ۿ\-_./]+$/;

export function detectInvalidCodes(entityType: MasterDataTab, items: any[]) {
  const issues: ReturnType<typeof makeIssue>[] = [];
  for (const item of items) {
    const { code, name } = extractCodeAndName(entityType, item);
    const trimmed = code.trim();
    if (!trimmed) continue; // empty codes are reported by detectMissingRequiredFields
    if (trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') {
      issues.push(makeIssue({
        id: `${entityType}-${item.id}-invalidcode`,
        entityType, issueType: 'INVALID_CODE', severity: 'HIGH', documentId: item.id, code, name,
        descriptionAr: `الكود (${code}) قيمة غير صالحة.`, descriptionEn: `Code (${code}) is not a valid value.`,
      }));
      continue;
    }
    if (!VALID_CODE_PATTERN.test(trimmed)) {
      issues.push(makeIssue({
        id: `${entityType}-${item.id}-invalidcode`,
        entityType, issueType: 'INVALID_CODE', severity: 'MEDIUM', documentId: item.id, code, name,
        descriptionAr: `تنسيق الكود (${code}) يحتوي على رموز غير مسموحة.`, descriptionEn: `Code (${code}) contains characters that are not allowed.`,
      }));
    }
  }
  return issues;
}

export function detectDuplicateCodes(entityType: MasterDataTab, items: any[]) {
  const groups = new Map<string, any[]>();
  for (const item of items) {
    const { code } = extractCodeAndName(entityType, item);
    const norm = normalizeCodeForComparison(code);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push(item);
  }
  const issues: ReturnType<typeof makeIssue>[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const item of group) {
      const { code, name } = extractCodeAndName(entityType, item);
      const other = group.find((g) => g.id !== item.id);
      const otherInfo = other ? extractCodeAndName(entityType, other) : { code: '', name: '' };
      issues.push(makeIssue({
        id: `${entityType}-${item.id}-dupcode`,
        entityType, issueType: 'DUPLICATE_CODE', severity: 'HIGH', documentId: item.id, code, name,
        relatedDocumentId: other?.id, relatedCode: otherInfo.code, relatedName: otherInfo.name, confidence: 100,
        descriptionAr: `كود مكرر (${code}) - نفس الكود مستخدم في ${group.length} سجل من نوع ${entityType}.`,
        descriptionEn: `Duplicate code (${code}) - used by ${group.length} records of type ${entityType}.`,
      }));
    }
  }
  return issues;
}

export function detectDuplicateNames(entityType: MasterDataTab, items: any[]) {
  const groups = new Map<string, any[]>();
  for (const item of items) {
    const { name } = extractCodeAndName(entityType, item);
    const norm = normalizeArabicForComparison(name);
    if (!norm) continue;
    if (!groups.has(norm)) groups.set(norm, []);
    groups.get(norm)!.push(item);
  }
  const issues: ReturnType<typeof makeIssue>[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const item of group) {
      const { code, name } = extractCodeAndName(entityType, item);
      const other = group.find((g) => g.id !== item.id);
      const otherInfo = other ? extractCodeAndName(entityType, other) : { code: '', name: '' };
      issues.push(makeIssue({
        id: `${entityType}-${item.id}-dupname`,
        entityType, issueType: 'DUPLICATE_NAME', severity: 'MEDIUM', documentId: item.id, code, name,
        relatedDocumentId: other?.id, relatedCode: otherInfo.code, relatedName: otherInfo.name, confidence: 100,
        descriptionAr: `اسم مكرر تمامًا (${name}) - يظهر في ${group.length} سجل من نوع ${entityType}.`,
        descriptionEn: `Exact duplicate name (${name}) - appears on ${group.length} records of type ${entityType}.`,
      }));
    }
  }
  return issues;
}

/**
 * Pairwise similar-name scan within ONE entity type. O(n^2) but with a cheap
 * length-difference prune before the more expensive Levenshtein call.
 * Callers (runMasterDataQualityScan) are responsible for not invoking this
 * above SIMILAR_NAME_SCAN_MAX_ITEMS - this function itself has no size guard
 * so its behavior for small lists (existing callers/tests) is unchanged.
 */
export function detectSimilarNames(entityType: MasterDataTab, items: any[], threshold = 80) {
  const entries = items
    .map((item) => ({ item, ...extractCodeAndName(entityType, item) }))
    .filter((e) => e.name.trim().length > 0)
    .map((e) => ({ ...e, normalized: normalizeArabicForComparison(e.name) }));

  const issues: ReturnType<typeof makeIssue>[] = [];
  const flaggedPairs = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.normalized === b.normalized) continue; // exact duplicates already reported separately
      const lenDiff = Math.abs(a.normalized.length - b.normalized.length);
      const maxLen = Math.max(a.normalized.length, b.normalized.length, 1);
      if (lenDiff / maxLen > 0.6) continue; // cheap prune before Levenshtein
      const { similarity } = calculateStringSimilarity(a.name, b.name);
      if (similarity >= threshold) {
        const pairKey = [a.item.id, b.item.id].sort().join('::');
        if (flaggedPairs.has(pairKey)) continue;
        flaggedPairs.add(pairKey);
        const severity: QualitySeverity = similarity >= 90 ? 'MEDIUM' : 'LOW';
        issues.push(makeIssue({
          id: `${entityType}-${a.item.id}-${b.item.id}-similar`,
          entityType, issueType: 'SIMILAR_NAME', severity, documentId: a.item.id, code: a.code, name: a.name,
          relatedDocumentId: b.item.id, relatedCode: b.code, relatedName: b.name, confidence: similarity,
          descriptionAr: `اسم مشابه محتمل لـ "${b.name}" (${b.code || 'بدون كود'}) - تشابه ${similarity}%.`,
          descriptionEn: `Possible similar name to "${b.name}" (${b.code || 'no code'}) - ${similarity}% similarity.`,
        }));
      }
    }
  }
  return issues;
}

/**
 * §18 - a missing number in a numeric code sequence is a WARNING/suggestion
 * only, never a definite error. Only fires for entity types explicitly
 * configured as sequential, and only reports gaps up to a modest size
 * (business data legitimately has large intentional gaps) so the report
 * doesn't drown in noise.
 */
export function analyzeCodeSequence(entityType: MasterDataTab, items: any[], maxGapToReport = 20) {
  if (!SEQUENTIAL_ENTITY_TYPES.includes(entityType)) return [];
  const numbered = items
    .map((item) => {
      const { code } = extractCodeAndName(entityType, item);
      const match = code.match(/(\d+)/);
      return match ? { item, num: parseInt(match[1], 10), code } : null;
    })
    .filter((x): x is { item: any; num: number; code: string } => x !== null)
    .sort((a, b) => a.num - b.num);

  const issues: ReturnType<typeof makeIssue>[] = [];
  for (let i = 1; i < numbered.length; i++) {
    const prev = numbered[i - 1];
    const curr = numbered[i];
    const gap = curr.num - prev.num;
    if (gap > 1 && gap - 1 <= maxGapToReport) {
      for (let missing = prev.num + 1; missing < curr.num; missing++) {
        issues.push(makeIssue({
          id: `${entityType}-seq-${missing}`,
          entityType, issueType: 'MISSING_SEQUENCE', severity: 'WARNING', documentId: '', code: String(missing), name: '',
          relatedCode: `${prev.code} .. ${curr.code}`,
          descriptionAr: `احتمال وجود فجوة في التسلسل الرقمي: الكود ${missing} غير موجود بين ${prev.code} و ${curr.code} (تنبيه وليس خطأ مؤكد).`,
          descriptionEn: `Possible missing sequence: code ${missing} does not exist between ${prev.code} and ${curr.code} (a warning, not a confirmed error).`,
        }));
      }
    }
  }
  return issues;
}

// ============================================================================
// Reference counting - a SINGLE pass over already-fetched production records
// (+ employees/products for department/productType cross-references), never
// N per-record queries (§35).
// ============================================================================

export function computeReferenceCounts(
  productionRecords: ProductionRecord[],
  employees: any[],
  products: any[]
): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (entityType: MasterDataTab, id: string | undefined | null) => {
    if (!id) return;
    const key = `${entityType}::${id}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };

  for (const rec of productionRecords) {
    (rec.employeeIds || []).forEach((id) => bump('employees', id));
    bump('presses', rec.pressId);
    (rec.furnaceCarIds || []).forEach((id) => bump('furnaceCars', id));
    bump('customers', rec.customerId);
    bump('products', rec.productId);
    bump('shifts', rec.shiftId);
    bump('furnaces', (rec as any).furnaceId);
  }
  for (const emp of employees) bump('departments', emp.departmentId);
  for (const prod of products) bump('productTypes', prod.productTypeId);

  return counts;
}

export function getReferenceCount(counts: Map<string, number>, entityType: MasterDataTab, id: string): number {
  return counts.get(`${entityType}::${id}`) || 0;
}

// ============================================================================
// Scan orchestrator
// ============================================================================

/**
 * @param productionRecords the full `production` history, or `null` when the
 * caller has deliberately skipped fetching it for size safety (§5). When
 * `null`, reference counts for PRODUCTION_DEPENDENT_ENTITY_TYPES cannot be
 * verified - their issues are marked `referenceCountUnknown` and forced
 * `isProtected: true` (never silently treated as "0 references, safe to
 * delete"). `productTypes`/`departments` reference counts are unaffected,
 * since they're derived from `products`/`employees`, not `production`.
 */
export function runMasterDataQualityScan(
  dataByType: Partial<Record<MasterDataTab, any[]>>,
  productionRecords: ProductionRecord[] | null
): { issues: QualityIssue[]; summary: QualityReportSummary } {
  const employees = dataByType.employees || [];
  const products = dataByType.products || [];
  const referenceCounts = computeReferenceCounts(productionRecords || [], employees, products);
  const referenceCountStatus: ScanCompleteness = productionRecords === null ? 'NOT_RUN_FOR_LARGE_DATASET' : 'COMPLETED';

  const rawIssues: ReturnType<typeof makeIssue>[] = [];
  const similarNameScanStatus: Partial<Record<MasterDataTab, ScanCompleteness>> = {};
  let totalScanned = 0;

  for (const entityType of QUALITY_SCANNED_TYPES) {
    const items = dataByType[entityType] || [];
    totalScanned += items.length;
    rawIssues.push(
      ...detectMissingRequiredFields(entityType, items),
      ...detectInvalidCodes(entityType, items),
      ...detectDuplicateCodes(entityType, items),
      ...detectDuplicateNames(entityType, items),
      ...analyzeCodeSequence(entityType, items),
    );
    if (items.length > SIMILAR_NAME_SCAN_MAX_ITEMS) {
      similarNameScanStatus[entityType] = 'SKIPPED_LARGE_DATASET';
    } else {
      rawIssues.push(...detectSimilarNames(entityType, items));
      similarNameScanStatus[entityType] = 'COMPLETED';
    }
  }

  const issues: QualityIssue[] = rawIssues.map((issue) => {
    const referenceCountKnown = !(productionRecords === null && PRODUCTION_DEPENDENT_ENTITY_TYPES.includes(issue.entityType));
    const referenceCount = issue.documentId ? getReferenceCount(referenceCounts, issue.entityType, issue.documentId) : 0;
    if (!referenceCountKnown) {
      return { ...issue, referenceCount: 0, isProtected: true, referenceCountUnknown: true };
    }
    return { ...issue, referenceCount, isProtected: referenceCount > 0 };
  });

  const summary: QualityReportSummary = {
    totalScanned,
    duplicateCodes: issues.filter((i) => i.issueType === 'DUPLICATE_CODE').length,
    similarNames: issues.filter((i) => i.issueType === 'SIMILAR_NAME').length,
    exactDuplicateNames: issues.filter((i) => i.issueType === 'DUPLICATE_NAME').length,
    invalidCodes: issues.filter((i) => i.issueType === 'INVALID_CODE').length,
    missingSequenceWarnings: issues.filter((i) => i.issueType === 'MISSING_SEQUENCE').length,
    missingRequiredFields: issues.filter((i) => i.issueType === 'MISSING_REQUIRED').length,
    protectedRecords: issues.filter((i) => i.isProtected).length,
    safeCandidates: issues.filter((i) => !i.isProtected && i.issueType !== 'MISSING_SEQUENCE').length,
    needsReview: issues.filter((i) => i.issueType !== 'MISSING_SEQUENCE').length,
    similarNameScanStatus,
    referenceCountStatus,
  };

  return { issues, summary };
}

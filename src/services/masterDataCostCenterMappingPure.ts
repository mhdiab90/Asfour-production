/**
 * ASFOUR ERP - Master Data <-> Cost Center Hierarchy Mapping Audit (Phase 6A).
 *
 * Pure, Firebase-free audit ENGINE: given already-fetched Master Data
 * records (Department/Press/Furnace/FurnaceCar/ChineseMill/TubeBallMill/
 * Bunker/Material/Product - plain arrays, never fetched by this module
 * itself) and the already-parsed Cost Center Hierarchy node set
 * (costCenterHierarchyPure.ts), classifies every record's best possible
 * relationship to a hierarchy node. Produces the two audit tables
 * (Master Data -> Cost Center and its inverse), conflict/duplicate
 * detection, and global-mapping-candidate detection.
 *
 * SCOPE BOUNDARY: this module NEVER writes anything, NEVER mutates its
 * inputs, and NEVER persists a mapping - every result here is an in-memory
 * SUGGESTION for a human to review in a future integration phase. It reuses
 * the project's EXISTING fuzzy-matching/normalization engine
 * (src/utils/fuzzyMatching.ts - normalizeArabicForComparison,
 * normalizeCodeForComparison, rankFuzzyCandidates) rather than
 * reimplementing string comparison, and reuses costCenterHierarchyPure.ts's
 * getCreationCandidates so EXCLUDED_BLANK_NAME/EXCLUDED_CODE_6041/CONFLICT
 * nodes (including 6041) can never structurally become a mapping target -
 * they are filtered out before any matching logic ever runs.
 */
import {
  normalizeArabicForComparison,
  normalizeCodeForComparison,
  rankFuzzyCandidates,
  FuzzyCandidate,
} from '../utils/fuzzyMatching';
import { ParsedHierarchyNode, getCreationCandidates, getAncestorChain } from './costCenterHierarchyPure';

export type MasterDataType =
  | 'Department' | 'Press' | 'Furnace' | 'FurnaceCar'
  | 'ChineseMill' | 'TubeBallMill' | 'Bunker' | 'Material' | 'Product';

export type MappingMatchType =
  | 'EXACT_MATCH' | 'DETERMINISTIC_MATCH' | 'STRONG_MATCH' | 'FUZZY_MATCH'
  | 'REVIEW_REQUIRED' | 'NO_SAFE_MATCH' | 'NOT_APPLICABLE';

/** Minimal shape every Master Data record is reduced to before matching - callers map their real Department/Press/Furnace/etc. objects into this. */
export interface MasterDataMatchInput {
  masterDataType: MasterDataType;
  id: string;
  code: string;
  name: string;
  /** FurnaceCar-only - its existing furnaceId relationship, if any (a real existing relationship, distinct from any Cost Center mapping). */
  furnaceId?: string;
  /** FurnaceCar-only - mirrors FurnaceCar.carNumber. */
  carNumber?: string;
}

export interface MasterDataToCostCenterRow {
  masterDataType: MasterDataType;
  masterDataId: string;
  masterDataCode: string;
  masterDataName: string;
  suggestedCostCenterCode: string | null;
  suggestedCostCenterName: string | null;
  fullCostCenterPath: string | null;
  matchType: MappingMatchType;
  confidence: number;
  reason: string;
  reviewRequired: boolean;
}

const TYPES_NOT_APPLICABLE_TO_EQUIPMENT_HIERARCHY: ReadonlySet<MasterDataType> = new Set(['Material', 'Product']);

function notApplicableRow(record: MasterDataMatchInput, reason: string): MasterDataToCostCenterRow {
  return {
    masterDataType: record.masterDataType,
    masterDataId: record.id,
    masterDataCode: record.code,
    masterDataName: record.name,
    suggestedCostCenterCode: null,
    suggestedCostCenterName: null,
    fullCostCenterPath: null,
    matchType: 'NOT_APPLICABLE',
    confidence: 0,
    reason,
    reviewRequired: false,
  };
}

/** Classifies a rankFuzzyCandidates() confidence/matchType pair into this module's required MappingMatchType taxonomy. */
function classifyConfidence(candidate: FuzzyCandidate<ParsedHierarchyNode>): MappingMatchType {
  if (candidate.matchType === 'EXACT_CODE' || candidate.matchType === 'EXACT_NAME') return 'EXACT_MATCH';
  if (candidate.matchType === 'NORMALIZED_NAME') return 'DETERMINISTIC_MATCH';
  if (candidate.matchType === 'CODE_SIMILARITY' && candidate.confidence >= 96) return 'DETERMINISTIC_MATCH';
  if (candidate.confidence >= 90) return 'STRONG_MATCH';
  if (candidate.confidence >= 75) return 'FUZZY_MATCH';
  if (candidate.confidence >= 50) return 'REVIEW_REQUIRED';
  return 'NO_SAFE_MATCH';
}

function pathOf(hierarchyNodes: ParsedHierarchyNode[], node: ParsedHierarchyNode): string {
  return getAncestorChain(hierarchyNodes, node.sheet1Code).map((n) => `${n.sheet1Code} ${n.name}`).join(' -> ');
}

/**
 * Matches ONE Master Data record against the eligible hierarchy candidate
 * set (READY + REVIEW_REQUIRED only - excluded/conflict nodes, including
 * 6041 and blank-name codes, are never considered - see
 * getCreationCandidates). Reuses rankFuzzyCandidates verbatim for the
 * actual code/name comparison.
 */
function matchAgainstCandidates(
  record: MasterDataMatchInput,
  candidates: ParsedHierarchyNode[],
  domainLabelAr: string,
  domainLabelEn: string
): MasterDataToCostCenterRow {
  if (candidates.length === 0) {
    return {
      masterDataType: record.masterDataType,
      masterDataId: record.id,
      masterDataCode: record.code,
      masterDataName: record.name,
      suggestedCostCenterCode: null,
      suggestedCostCenterName: null,
      fullCostCenterPath: null,
      matchType: 'NO_SAFE_MATCH',
      confidence: 0,
      reason: 'No eligible hierarchy candidates to compare against (empty or fully excluded node set)',
      reviewRequired: true,
    };
  }

  // Try matching on code first, then on name - keep whichever produces the higher-confidence top candidate.
  const byCode = rankFuzzyCandidates(record.code, candidates, {
    extractCode: (n) => n.sheet1Code,
    extractName: (n) => n.name,
    domainLabelAr, domainLabelEn,
    minConfidence: 0, maxResults: 3,
  });
  const byName = rankFuzzyCandidates(record.name, candidates, {
    extractCode: (n) => n.sheet1Code,
    extractName: (n) => n.name,
    domainLabelAr, domainLabelEn,
    minConfidence: 0, maxResults: 3,
  });

  const best = [...byCode, ...byName].sort((a, b) => b.confidence - a.confidence)[0];
  if (!best) {
    return {
      masterDataType: record.masterDataType,
      masterDataId: record.id,
      masterDataCode: record.code,
      masterDataName: record.name,
      suggestedCostCenterCode: null,
      suggestedCostCenterName: null,
      fullCostCenterPath: null,
      matchType: 'NO_SAFE_MATCH',
      confidence: 0,
      reason: 'No comparable candidate found (empty code and name)',
      reviewRequired: true,
    };
  }

  const targetNode = best.entity;
  const matchType = classifyConfidence(best);
  const targetIsReviewRequired = targetNode.status === 'REVIEW_REQUIRED';

  return {
    masterDataType: record.masterDataType,
    masterDataId: record.id,
    masterDataCode: record.code,
    masterDataName: record.name,
    suggestedCostCenterCode: matchType === 'NO_SAFE_MATCH' ? null : targetNode.sheet1Code,
    suggestedCostCenterName: matchType === 'NO_SAFE_MATCH' ? null : targetNode.name,
    fullCostCenterPath: matchType === 'NO_SAFE_MATCH' ? null : pathOf(candidates, targetNode),
    matchType,
    confidence: best.confidence,
    reason: best.reasonEn + (targetIsReviewRequired ? ' (target Cost Center itself is REVIEW_REQUIRED - flagged for review, not auto-approved)' : ''),
    reviewRequired: matchType === 'FUZZY_MATCH' || matchType === 'REVIEW_REQUIRED' || matchType === 'NO_SAFE_MATCH' || targetIsReviewRequired,
  };
}

/**
 * FurnaceCar protection (Phase 1 audit finding, reconfirmed every phase
 * since: Sheet1 contains ZERO Furnace Car entries). A Furnace Car can
 * therefore NEVER receive a safe match against the hierarchy - not even a
 * numerically-similar Mill node - regardless of how close a code/name
 * coincidence looks. This function always returns NO_SAFE_MATCH with
 * reviewRequired=true; it never calls matchAgainstCandidates for a
 * FurnaceCar record. See detectFurnaceCarContaminationRisk for the
 * separate, transparency-only coincidence report.
 */
function matchFurnaceCarProtected(record: MasterDataMatchInput): MasterDataToCostCenterRow {
  return {
    masterDataType: 'FurnaceCar',
    masterDataId: record.id,
    masterDataCode: record.code,
    masterDataName: record.name,
    suggestedCostCenterCode: null,
    suggestedCostCenterName: null,
    fullCostCenterPath: null,
    matchType: 'NO_SAFE_MATCH',
    confidence: 0,
    reason: 'Furnace Cars are protected by design - the approved Sheet1 hierarchy contains zero Furnace Car entries, so no hierarchy node is ever a safe target regardless of numeric similarity to a Mill code',
    reviewRequired: true,
  };
}

/**
 * Classifies ONE Master Data record. This is the single entry point every
 * caller should use - it routes to the correct specialized matcher (or
 * NOT_APPLICABLE / FurnaceCar protection) based on masterDataType, and
 * always restricts the hierarchy candidate set to getCreationCandidates
 * (never excluded/conflict nodes).
 */
export function matchMasterDataRecordToHierarchy(
  record: MasterDataMatchInput,
  hierarchyNodes: ParsedHierarchyNode[]
): MasterDataToCostCenterRow {
  const candidates = getCreationCandidates(hierarchyNodes);

  if (TYPES_NOT_APPLICABLE_TO_EQUIPMENT_HIERARCHY.has(record.masterDataType)) {
    return notApplicableRow(
      record,
      record.masterDataType === 'Material'
        ? 'Materials are not automatically equipment - no authoritative Cost Center relationship exists in the current architecture'
        : 'Products/Product Classifications remain separate from the equipment Cost Center hierarchy - no authoritative relationship exists in the current architecture'
    );
  }

  if (record.masterDataType === 'FurnaceCar') {
    return matchFurnaceCarProtected(record);
  }

  if (record.masterDataType === 'Department') {
    const departmentCandidates = candidates.filter((n) => n.level === 1);
    return matchAgainstCandidates(record, departmentCandidates, 'قسم', 'Department');
  }

  // Press / Furnace / ChineseMill / TubeBallMill / Bunker - match against every eligible node (equipment leaves and work centers alike; the hierarchy's own variable depth decides what's a leaf, never assumed here).
  return matchAgainstCandidates(record, candidates, 'معدة', 'Equipment');
}

/** Runs matchMasterDataRecordToHierarchy over a whole list - the main audit entry point for one Master Data collection. */
export function auditMasterDataCollection(
  records: MasterDataMatchInput[],
  hierarchyNodes: ParsedHierarchyNode[]
): MasterDataToCostCenterRow[] {
  return records.map((r) => matchMasterDataRecordToHierarchy(r, hierarchyNodes));
}

// ==================================================
// Furnace Car contamination review (transparency-only, never auto-flags as an error)
// ==================================================

export interface FurnaceCarContaminationReviewEntry {
  furnaceCarId: string;
  furnaceCarCode: string;
  furnaceCarNumber: string;
  coincidentalHierarchyCode: string;
  coincidentalHierarchyName: string;
  note: string;
}

/**
 * Reports (never auto-classifies) Furnace Cars whose code/car number happens
 * to numerically coincide with an EQUIPMENT-type hierarchy node's code.
 * This is explicitly NOT proof of contamination - Phase 1's audit already
 * established the Furnace Car reporting bug's root cause was
 * `checkCodeDuplicate` only checking within one collection, not that any
 * such collision currently exists. This function exists purely so a human
 * reviewer can see and rule out coincidences, never to auto-correct them.
 */
export function detectFurnaceCarContaminationRisk(
  furnaceCars: MasterDataMatchInput[],
  hierarchyNodes: ParsedHierarchyNode[]
): FurnaceCarContaminationReviewEntry[] {
  const candidates = getCreationCandidates(hierarchyNodes).filter((n) => n.type === 'EQUIPMENT');
  const entries: FurnaceCarContaminationReviewEntry[] = [];

  for (const car of furnaceCars) {
    const carNumeric = normalizeCodeForComparison(car.carNumber || car.code);
    if (!carNumeric) continue;
    for (const node of candidates) {
      if (normalizeCodeForComparison(node.sheet1Code) === carNumeric || node.sheet1Code.endsWith(carNumeric)) {
        entries.push({
          furnaceCarId: car.id,
          furnaceCarCode: car.code,
          furnaceCarNumber: car.carNumber || car.code,
          coincidentalHierarchyCode: node.sheet1Code,
          coincidentalHierarchyName: node.name,
          note: 'Numeric coincidence only - NOT evidence of contamination. This Furnace Car remains a protected, separate Master Data record (see matchFurnaceCarProtected); this entry exists for human transparency only.',
        });
      }
    }
  }
  return entries;
}

// ==================================================
// Inverse table: Cost Center -> Master Data
// ==================================================

export type CostCenterMappingStatus = 'MATCHED' | 'MULTIPLE_CANDIDATES' | 'NO_EXISTING_MASTER_DATA';

export interface CostCenterToMasterDataRow {
  costCenterCode: string;
  costCenterName: string;
  fullPath: string;
  /** A heuristic-only guess, never authoritative - see the function docblock. */
  expectedMasterDataType: string;
  matchedMasterData: MasterDataToCostCenterRow[];
  matchCount: number;
  mappingStatus: CostCenterMappingStatus;
  reviewRequired: boolean;
}

const EQUIPMENT_NAME_TYPE_HINTS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /طاحون|طواحين|مطحنة|مطاحن/, type: 'Mill / Tube-Ball Mill (name hint only)' },
  { pattern: /مكبس|كبس/, type: 'Press (name hint only)' },
  { pattern: /فرن/, type: 'Furnace (name hint only)' },
  { pattern: /بنكر/, type: 'Bunker (name hint only)' },
];

/** Heuristic-only guess at what Master Data type a hierarchy node's name suggests - NEVER authoritative, never used to force a mapping. Returns 'Department' for level-1 nodes and 'Unknown / no name-based hint' when nothing matches. */
function guessExpectedMasterDataType(node: ParsedHierarchyNode): string {
  if (node.level === 1) return 'Department';
  for (const hint of EQUIPMENT_NAME_TYPE_HINTS) {
    if (hint.pattern.test(node.name)) return hint.type;
  }
  return 'Unknown / no name-based hint';
}

/** Builds the Cost Center -> Master Data inverse view from an already-computed set of forward audit rows. Every creation-candidate hierarchy node is represented, including ones with zero matches (NO_EXISTING_MASTER_DATA is a legitimate, non-error state - see the Phase 6A spec). */
export function buildCostCenterToMasterDataTable(
  hierarchyNodes: ParsedHierarchyNode[],
  masterDataRows: MasterDataToCostCenterRow[]
): CostCenterToMasterDataRow[] {
  const candidates = getCreationCandidates(hierarchyNodes);
  const byCostCenter = new Map<string, MasterDataToCostCenterRow[]>();
  for (const row of masterDataRows) {
    if (!row.suggestedCostCenterCode) continue; // NOT_APPLICABLE / NO_SAFE_MATCH rows target nothing
    const list = byCostCenter.get(row.suggestedCostCenterCode) || [];
    list.push(row);
    byCostCenter.set(row.suggestedCostCenterCode, list);
  }

  return candidates.map((node) => {
    const matched = byCostCenter.get(node.sheet1Code) || [];
    const mappingStatus: CostCenterMappingStatus =
      matched.length === 0 ? 'NO_EXISTING_MASTER_DATA' : matched.length === 1 ? 'MATCHED' : 'MULTIPLE_CANDIDATES';
    return {
      costCenterCode: node.sheet1Code,
      costCenterName: node.name,
      fullPath: pathOf(candidates, node),
      expectedMasterDataType: guessExpectedMasterDataType(node),
      matchedMasterData: matched,
      matchCount: matched.length,
      mappingStatus,
      reviewRequired: mappingStatus === 'MULTIPLE_CANDIDATES' || node.status === 'REVIEW_REQUIRED',
    };
  });
}

// ==================================================
// Conflict / duplicate detection
// ==================================================

export type MappingConflictType =
  | 'MULTIPLE_MASTER_DATA_SAME_COST_CENTER'
  | 'CONFLICTING_CODE'
  | 'CONFLICTING_NAME';

export interface MappingConflict {
  type: MappingConflictType;
  description: string;
  involvedMasterDataIds: string[];
  costCenterCode?: string;
}

/**
 * Detects (never resolves) conflicts across the forward+inverse audit
 * tables: multiple Master Data records confidently mapped to the same
 * equipment node, and records sharing a normalized code or name with
 * genuinely different suggested Cost Centers (a sign one of the two is
 * likely misclassified, decided by a human, never auto-corrected here).
 */
export function detectMappingConflicts(
  masterDataRows: MasterDataToCostCenterRow[],
  costCenterRows: CostCenterToMasterDataRow[]
): MappingConflict[] {
  const conflicts: MappingConflict[] = [];

  for (const ccRow of costCenterRows) {
    if (ccRow.mappingStatus === 'MULTIPLE_CANDIDATES') {
      conflicts.push({
        type: 'MULTIPLE_MASTER_DATA_SAME_COST_CENTER',
        description: `${ccRow.matchCount} Master Data records all map to the same Cost Center ${ccRow.costCenterCode} (${ccRow.costCenterName}) - a human must pick the correct one(s), never auto-resolved`,
        involvedMasterDataIds: ccRow.matchedMasterData.map((r) => r.masterDataId),
        costCenterCode: ccRow.costCenterCode,
      });
    }
  }

  const byNormalizedCode = new Map<string, MasterDataToCostCenterRow[]>();
  const byNormalizedName = new Map<string, MasterDataToCostCenterRow[]>();
  for (const row of masterDataRows) {
    if (row.masterDataCode) {
      const key = normalizeCodeForComparison(row.masterDataCode);
      if (key) byNormalizedCode.set(key, [...(byNormalizedCode.get(key) || []), row]);
    }
    if (row.masterDataName) {
      const key = normalizeArabicForComparison(row.masterDataName);
      if (key) byNormalizedName.set(key, [...(byNormalizedName.get(key) || []), row]);
    }
  }

  for (const [code, rows] of byNormalizedCode) {
    const distinctTargets = new Set(rows.map((r) => r.suggestedCostCenterCode).filter(Boolean));
    if (rows.length > 1 && distinctTargets.size > 1) {
      conflicts.push({
        type: 'CONFLICTING_CODE',
        description: `Records sharing normalized code "${code}" suggest DIFFERENT Cost Centers (${[...distinctTargets].join(', ')}) - likely a genuine duplicate/misclassification, human review required`,
        involvedMasterDataIds: rows.map((r) => r.masterDataId),
      });
    }
  }

  for (const [name, rows] of byNormalizedName) {
    const distinctTargets = new Set(rows.map((r) => r.suggestedCostCenterCode).filter(Boolean));
    if (rows.length > 1 && distinctTargets.size > 1 && rows.some((r) => r.masterDataType !== rows[0].masterDataType) === false) {
      // Only flag same-type name collisions - a Press and a Furnace sharing a generic name is not inherently a conflict.
      conflicts.push({
        type: 'CONFLICTING_NAME',
        description: `${rows.length} records of the same type sharing normalized name "${name}" suggest DIFFERENT Cost Centers - human review required`,
        involvedMasterDataIds: rows.map((r) => r.masterDataId),
      });
    }
  }

  return conflicts;
}

// ==================================================
// Global mapping candidates
// ==================================================

export interface GlobalMappingCandidate {
  normalizedName: string;
  masterDataType: MasterDataType;
  costCenterCode: string;
  costCenterName: string;
  recordCount: number;
  involvedMasterDataIds: string[];
  note: string;
}

/**
 * Identifies a NAME pattern that consistently and confidently (EXACT_MATCH
 * or DETERMINISTIC_MATCH only) resolves to the SAME Cost Center across 2+
 * records of the same type - a candidate for a reusable mapping rule in a
 * future Phase 6B, never persisted here.
 */
export function findGlobalMappingCandidates(masterDataRows: MasterDataToCostCenterRow[]): GlobalMappingCandidate[] {
  const groups = new Map<string, MasterDataToCostCenterRow[]>();
  for (const row of masterDataRows) {
    if (row.matchType !== 'EXACT_MATCH' && row.matchType !== 'DETERMINISTIC_MATCH') continue;
    if (!row.suggestedCostCenterCode) continue;
    const key = `${row.masterDataType}::${normalizeArabicForComparison(row.masterDataName)}::${row.suggestedCostCenterCode}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  const results: GlobalMappingCandidate[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const first = rows[0];
    results.push({
      normalizedName: normalizeArabicForComparison(first.masterDataName),
      masterDataType: first.masterDataType,
      costCenterCode: first.suggestedCostCenterCode!,
      costCenterName: first.suggestedCostCenterName || '',
      recordCount: rows.length,
      involvedMasterDataIds: rows.map((r) => r.masterDataId),
      note: `${rows.length} ${first.masterDataType} records with the same normalized name all confidently resolve to ${first.suggestedCostCenterCode} - safe to apply as a reusable rule once a human confirms it in Phase 6B`,
    });
  }
  return results;
}

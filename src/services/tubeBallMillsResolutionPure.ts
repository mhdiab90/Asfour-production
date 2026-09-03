/**
 * Tube/Ball Mills Historical Import - Mill/Material/Bunker Master Data
 * field resolution (§7-8/§F/§H, "Global Mapping").
 *
 * Firebase-free and pure (only depends on ../utils/fuzzyMatching, itself
 * Firebase-free) so this is unit-testable via `npx tsx` - extracted out of
 * tubeBallMillsHistoricalImportService.ts specifically for real test
 * coverage of the exact-match -> approved-mapping-memory -> fuzzy-
 * suggestion resolution strategy, mirroring chineseMillsHistoricalImport-
 * Service.ts's own resolveEntityField as a PATTERN (never imported
 * directly - it is private/unexported and domain-typed to Chinese Mills'
 * own 4 domains) - never a second fuzzy-matching engine, this only
 * orchestrates the EXISTING findBestFuzzyCandidates/normalizeArabic-
 * ForComparison/normalizeCodeForComparison.
 */
import { normalizeArabicForComparison, normalizeCodeForComparison, findBestFuzzyCandidates } from '../utils/fuzzyMatching';

export type MasterDataDomain = 'mill' | 'material' | 'bunker';

export interface EntityListItem {
  id?: string;
  code?: string;
  name?: string;
}

/**
 * Session-local resolution decisions keyed `${domain}::${normalizedValue}`
 * - populated whenever the user explicitly resolves a value for ANY row
 * ("Global Mapping"), consulted BEFORE exact/approved-mapping/fuzzy
 * matching for every row so that re-running resolution on every row after
 * one decision propagates it everywhere - no separate/divergent "apply to
 * matching rows" code path.
 */
export type ManualOverrideMap = Record<string, { id: string; code: string; name: string }>;

export function overrideKey(domain: MasterDataDomain, normalizedValue: string): string {
  return `${domain}::${normalizedValue}`;
}

export interface FieldResolution {
  resolved?: { id: string; code: string; name: string };
  suggestedId?: string;
  suggestedName?: string;
  suggestedCode?: string;
  suggestedConfidence?: number;
  suggestedReason?: string;
}

/**
 * Resolution strategy, in priority order:
 *  1. Manual override (session-local "Global Mapping" - a value the user
 *     already explicitly resolved once this session, for THIS domain).
 *  2. Exact code or name match against the Master Data list.
 *  3. Previously-approved persisted mapping (a value resolved and saved in
 *     an EARLIER import session - see saveApprovedMappingBatch).
 *  4. Fuzzy suggestion (never auto-applied - returned as a suggestion only,
 *     the caller/UI must obtain explicit user acceptance before treating it
 *     as resolved - §16/§48: never silently replace the source value).
 *  5. Nothing found - caller/UI must show this as unresolved, needing a
 *     manual choice or new Master Data record (permission-gated).
 */
export function resolveMasterDataField(
  domain: MasterDataDomain,
  rawValue: string,
  list: EntityListItem[],
  approvedMappings: Record<string, string>,
  manualOverrides: ManualOverrideMap = {}
): FieldResolution {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) return {};

  const normName = normalizeArabicForComparison(trimmed);
  const normCode = normalizeCodeForComparison(trimmed);

  const override = manualOverrides[overrideKey(domain, normName)] || manualOverrides[overrideKey(domain, normCode)];
  if (override) return { resolved: override };

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
    maxResults: 1,
  });
  const top = candidates[0];
  if (top) {
    return {
      suggestedId: top.id,
      suggestedName: top.name,
      suggestedCode: top.code,
      suggestedConfidence: top.confidence,
      suggestedReason: top.reasonAr,
    };
  }
  return {};
}

export interface MappingEntryCandidate {
  domain: string;
  originalValue: string;
  mappedEntityId: string;
  mappedEntityName: string;
  mappedEntityCode?: string;
  confidence: number;
  matchType: string;
}

/**
 * Gap-fix §8: decides whether ONE resolved field is eligible for
 * cross-session approved-mapping persistence (saveApprovedMappingBatch) -
 * only when it was genuinely RESOLVED to an entity whose name differs from
 * the raw source text (i.e. an actual correction happened, not merely a
 * value that already matched verbatim) - never for a field that is still
 * only a SUGGESTION the user has not accepted.
 */
export function isEligibleForMappingPersistence(rawValue: string, resolvedName: string | undefined): boolean {
  if (!resolvedName) return false;
  return normalizeArabicForComparison(rawValue) !== normalizeArabicForComparison(resolvedName);
}

/** Gap-fix §8: builds the full set of approved-mapping candidates for one row - Mill, single Material (never for a mixture row), and every resolved Bunker - extending what was previously Mill-only persistence to Material and Bunker as well, still gated on an explicit resolution having actually happened. */
export function buildMappingEntryCandidates(row: {
  millTypeRaw: string;
  resolvedMillId?: string;
  resolvedMillCode?: string;
  resolvedMillName?: string;
  isMixture: boolean;
  materialTypeRaw: string;
  resolvedMaterialId?: string;
  resolvedMaterialCode?: string;
  resolvedMaterialName?: string;
  bunkerAllocations: Array<{ bunkerRaw: string; resolvedBunkerId?: string; resolvedBunkerCode?: string; resolvedBunkerName?: string }>;
}): MappingEntryCandidate[] {
  const entries: MappingEntryCandidate[] = [];
  if (row.resolvedMillId && isEligibleForMappingPersistence(row.millTypeRaw, row.resolvedMillName)) {
    entries.push({ domain: 'tubeBallMill', originalValue: row.millTypeRaw, mappedEntityId: row.resolvedMillId, mappedEntityName: row.resolvedMillName || '', mappedEntityCode: row.resolvedMillCode, confidence: 100, matchType: 'CONFIRMED' });
  }
  if (!row.isMixture && row.resolvedMaterialId && isEligibleForMappingPersistence(row.materialTypeRaw, row.resolvedMaterialName)) {
    entries.push({ domain: 'tubeBallMaterial', originalValue: row.materialTypeRaw, mappedEntityId: row.resolvedMaterialId, mappedEntityName: row.resolvedMaterialName || '', mappedEntityCode: row.resolvedMaterialCode, confidence: 100, matchType: 'CONFIRMED' });
  }
  row.bunkerAllocations.forEach((b) => {
    if (b.resolvedBunkerId && isEligibleForMappingPersistence(b.bunkerRaw, b.resolvedBunkerName)) {
      entries.push({ domain: 'tubeBallBunker', originalValue: b.bunkerRaw, mappedEntityId: b.resolvedBunkerId, mappedEntityName: b.resolvedBunkerName || '', mappedEntityCode: b.resolvedBunkerCode, confidence: 100, matchType: 'CONFIRMED' });
    }
  });
  return entries;
}

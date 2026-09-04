/**
 * Tube/Ball Mills Historical Import - full-file Master Data extraction
 * (§2/§3 of the Master-Data Extraction + Excel Template + BOM Mixture
 * Coding task).
 *
 * Deliberately Firebase-free and deterministic: it performs NO Firestore
 * reads/writes and NO fuzzy re-matching of its own - every row passed in has
 * already been resolved once by revalidateTubeBallMillsRowFields (exact/
 * normalized/fuzzy-suggestion, via resolveMasterDataField), so this module
 * only AGGREGATES that already-computed per-row resolution state into
 * deduplicated, occurrence-counted groups per entity type (Mill/Material/
 * Mixture/Bunker) for the Master Data Review Window. Since resolution is a
 * pure function of (raw value, master data, manual overrides), every row
 * sharing the same raw value is guaranteed to already carry an identical
 * resolved/suggested result - so a group's resolution fields are taken from
 * its first occurrence only, never re-derived.
 *
 * Alumina suffix handling (§7): a material grouping key is always the PARSED
 * base name (via parseMaterialTypeField, the existing single parser - never
 * a second one), not the raw cell text - so "جريت40%" and "جريت25%" both
 * fold into one "جريت" group, matching how they already resolve against the
 * same Material Master Data record in the service.
 *
 * Mixture components (§11): every BOM component name also contributes an
 * occurrence to the Material group - components resolve against the exact
 * SAME Materials Master Data pool as plain (non-mixture) rows, so they share
 * one combined "Materials" list rather than a separate parallel pool.
 */
import { TubeBallMillsImportRow } from '../types';
import { parseMaterialTypeField } from './tubeBallMillsMixturePure';

export type MasterDataEntityType = 'mill' | 'material' | 'mixture' | 'bunker';

export interface MasterDataEntityGroup {
  entityType: MasterDataEntityType;
  originalValue: string;
  occurrences: number;
  /** rowIndex of every row this value appears in - used to scope "Apply to All" / status displays without re-scanning. */
  rowIndexes: number[];
  resolved: boolean;
  resolvedId?: string;
  resolvedCode?: string;
  resolvedName?: string;
  suggestedId?: string;
  suggestedCode?: string;
  suggestedName?: string;
  suggestedConfidence?: number;
}

export interface TubeBallMillsMasterDataExtraction {
  mills: MasterDataEntityGroup[];
  materials: MasterDataEntityGroup[];
  mixtures: MasterDataEntityGroup[];
  bunkers: MasterDataEntityGroup[];
}

function upsertGroup(
  map: Map<string, MasterDataEntityGroup>,
  entityType: MasterDataEntityType,
  originalValue: string,
  rowIndex: number,
  resolutionInfo: Omit<MasterDataEntityGroup, 'entityType' | 'originalValue' | 'occurrences' | 'rowIndexes'>
): void {
  const existing = map.get(originalValue);
  if (existing) {
    existing.occurrences += 1;
    existing.rowIndexes.push(rowIndex);
    return;
  }
  map.set(originalValue, { entityType, originalValue, occurrences: 1, rowIndexes: [rowIndex], ...resolutionInfo });
}

/**
 * Scans the ENTIRE parsed row set (in memory, no Firestore access) and
 * groups every distinct Mill/Material/Mixture/Bunker value that requires
 * Master Data resolution, with occurrence counts and each group's already-
 * computed resolved/suggested state - the data source for the Master Data
 * Review Window (§3).
 */
export function extractTubeBallMillsMasterDataGroups(rows: TubeBallMillsImportRow[]): TubeBallMillsMasterDataExtraction {
  const millMap = new Map<string, MasterDataEntityGroup>();
  const materialMap = new Map<string, MasterDataEntityGroup>();
  const mixtureMap = new Map<string, MasterDataEntityGroup>();
  const bunkerMap = new Map<string, MasterDataEntityGroup>();

  rows.forEach((row) => {
    if (row.millTypeRaw && row.millTypeRaw.trim()) {
      upsertGroup(millMap, 'mill', row.millTypeRaw.trim(), row.rowIndex, {
        resolved: !!row.resolvedMillId,
        resolvedId: row.resolvedMillId,
        resolvedCode: row.resolvedMillCode,
        resolvedName: row.resolvedMillName,
        suggestedId: row.suggestedMillId,
        suggestedCode: row.suggestedMillCode,
        suggestedName: row.suggestedMillName,
        suggestedConfidence: row.suggestedMillConfidence,
      });
    }

    if (row.materialTypeRaw && row.materialTypeRaw.trim()) {
      const parsed = parseMaterialTypeField(row.materialTypeRaw);
      if (parsed.kind === 'MIXTURE') {
        upsertGroup(mixtureMap, 'mixture', row.materialTypeRaw.trim(), row.rowIndex, {
          resolved: !!row.resolvedMixtureProductId,
          resolvedId: row.resolvedMixtureProductId,
          resolvedCode: row.resolvedMixtureProductCode,
          resolvedName: row.resolvedMixtureProductName,
          suggestedId: row.suggestedMixtureProductId,
          suggestedName: row.suggestedMixtureProductName,
        });
        (row.mixtureComponents || []).forEach((c) => {
          if (!c.materialNameRaw || !c.materialNameRaw.trim()) return;
          upsertGroup(materialMap, 'material', c.materialNameRaw.trim(), row.rowIndex, {
            resolved: !!c.resolvedMaterialId,
            resolvedId: c.resolvedMaterialId,
            resolvedCode: c.resolvedMaterialCode,
            resolvedName: c.resolvedMaterialName,
          });
        });
      } else if (parsed.kind === 'UNPARSEABLE_MIXTURE') {
        upsertGroup(mixtureMap, 'mixture', row.materialTypeRaw.trim(), row.rowIndex, { resolved: false });
      } else {
        // SINGLE_WITH_ALUMINA or SINGLE_PLAIN - group by the parsed BASE
        // name (§7), never the raw cell text, so "جريت40%"/"جريت25%" merge
        // into one "جريت" group exactly as they already resolve.
        const baseName = parsed.materialName.trim();
        if (baseName) {
          upsertGroup(materialMap, 'material', baseName, row.rowIndex, {
            resolved: !!row.resolvedMaterialId,
            resolvedId: row.resolvedMaterialId,
            resolvedCode: row.resolvedMaterialCode,
            resolvedName: row.resolvedMaterialName,
            suggestedId: row.suggestedMaterialId,
            suggestedCode: row.suggestedMaterialCode,
            suggestedName: row.suggestedMaterialName,
            suggestedConfidence: row.suggestedMaterialConfidence,
          });
        }
      }
    }

    (row.bunkerAllocations || []).forEach((b) => {
      if (!b.bunkerRaw || !b.bunkerRaw.trim()) return;
      upsertGroup(bunkerMap, 'bunker', b.bunkerRaw.trim(), row.rowIndex, {
        resolved: !!b.resolvedBunkerId,
        resolvedId: b.resolvedBunkerId,
        resolvedCode: b.resolvedBunkerCode,
        resolvedName: b.resolvedBunkerName,
      });
    });
  });

  return {
    mills: Array.from(millMap.values()).sort((a, b) => b.occurrences - a.occurrences),
    materials: Array.from(materialMap.values()).sort((a, b) => b.occurrences - a.occurrences),
    mixtures: Array.from(mixtureMap.values()).sort((a, b) => b.occurrences - a.occurrences),
    bunkers: Array.from(bunkerMap.values()).sort((a, b) => b.occurrences - a.occurrences),
  };
}

export interface MasterDataGroupCounts {
  uniqueCount: number;
  resolvedCount: number;
  unresolvedCount: number;
}

/** §15 summary counts for one entity group - unique/resolved/unresolved, computed only from actual group state. */
export function summarizeMasterDataGroup(groups: MasterDataEntityGroup[]): MasterDataGroupCounts {
  const resolvedCount = groups.filter((g) => g.resolved).length;
  return { uniqueCount: groups.length, resolvedCount, unresolvedCount: groups.length - resolvedCount };
}

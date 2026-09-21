/**
 * UOM data readiness for the records already on screen - Phase 1 Step 8.
 *
 * Runs only when the user asks. It analyses the production records the Data
 * Review screen has ALREADY loaded (its own date-bounded read) plus the shared
 * master data (BOM versions, BOM headers, job references, products, materials)
 * through the existing cache-first reads. It scans no production collection,
 * writes nothing, audits nothing and stores no result.
 */
import type { UniversalStageRecord } from '../types';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from './masterDataService';
import { BOM_VERSION_COLLECTION } from './bomPure';
import { analyzeUomReadiness } from './uomReadinessPure';

type Stored = Record<string, unknown> & { id?: string };

const safe = <T,>(p: Promise<T[]>): Promise<T[] | undefined> => p.catch(() => undefined);

export async function loadUomReadiness(records: readonly UniversalStageRecord[]): Promise<ReturnType<typeof analyzeUomReadiness> & { masterDataLoaded: Record<string, boolean> }> {
  const [bomVersions, boms, jobs, products, materials] = await Promise.all([
    safe(fetchMasterData<Stored>(BOM_VERSION_COLLECTION)),
    safe(fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.boms)),
    safe(fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.jobReferences)),
    safe(fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.products)),
    safe(fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.materials)),
  ]);
  const result = analyzeUomReadiness({
    stageRecords: records.map((r) => ({ id: r.id, stageType: r.stageType, data: (r.rawData ?? {}) as Record<string, unknown> })),
    bomVersions,
    boms,
    jobs,
    products,
    materials,
  });
  return {
    ...result,
    masterDataLoaded: { bomVersions: Boolean(bomVersions), boms: Boolean(boms), jobs: Boolean(jobs), products: Boolean(products), materials: Boolean(materials) },
  };
}

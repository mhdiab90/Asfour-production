/**
 * Standard vs actual quantity variance for ONE production record - Phase 1 Step 7.
 *
 * Reads the shared master data (job references, BOM versions, BOM headers,
 * logical items, products, materials) through the existing cache-first reads
 * and hands them to the pure engine. READ-ONLY: nothing is written, audited or
 * persisted - the variance is re-derived from the record's references each time.
 *
 * A record without a job reads nothing. Before a job or BOM version is reported
 * missing (an integrity error), that one list is re-read bypassing the cache, so
 * a stale cache never produces a false integrity error.
 */
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from './masterDataService';
import { loadLogicalItemState } from './logicalItemService';
import { BOM_VERSION_COLLECTION } from './bomPure';
import { analyseQuantityVariance } from './quantityVariancePure';
import type { QuantityVarianceReport, VarianceContext, VarianceRecordInput } from './quantityVariancePure';

type Stored = Record<string, unknown> & { id?: string };

const safe = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
const has = (list: readonly Stored[] | null, id: string) => Boolean(list?.some((r) => String(r.id ?? '') === id));

export async function loadQuantityVariance(record: VarianceRecordInput): Promise<QuantityVarianceReport> {
  const jobId = String(record.jobReferenceId ?? '').trim();
  if (!jobId) return analyseQuantityVariance(record, {});

  let jobs = await safe(fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.jobReferences));
  if (jobs && !has(jobs, jobId)) jobs = await safe(fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.jobReferences, { skipCache: true }));
  const job = jobs?.find((j) => String(j.id ?? '') === jobId);
  const versionId = String(job?.bomVersionId ?? '').trim();
  if (!job || !versionId) return analyseQuantityVariance(record, { jobs });

  const [cachedVersions, boms, logical, products, materials] = await Promise.all([
    safe(fetchMasterData<Stored>(BOM_VERSION_COLLECTION)),
    safe(fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.boms)),
    safe(loadLogicalItemState()),
    safe(fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.products)),
    safe(fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.materials)),
  ]);
  let bomVersions = cachedVersions;
  if (bomVersions && !has(bomVersions, versionId)) bomVersions = await safe(fetchMasterData<Stored>(BOM_VERSION_COLLECTION, { skipCache: true }));

  const context: VarianceContext = { jobs, bomVersions, boms, logicalItems: logical?.items ?? null, products, materials };
  return analyseQuantityVariance(record, context);
}

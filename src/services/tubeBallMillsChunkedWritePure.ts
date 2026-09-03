/**
 * Gap-fix §9/§10: the CHUNKING + individual-fallback-on-failure strategy for
 * Tube/Ball Mills' batch import, extracted out of
 * executeTubeBallMillsBatchImport (which cannot be imported outside a Vite
 * runtime - it transitively pulls in ../config/firebase) into a small,
 * Firebase-free orchestrator that takes the actual write operations as
 * injected functions. This is the SAME control flow the real import runs -
 * not a parallel/fake abstraction - so testing it here (with fake
 * writeChunk/writeOne functions that simulate success/failure) exercises the
 * real strategy directly.
 *
 * STRATEGY (documented per the gap-fix request): the normal/happy path
 * writes one Firestore writeBatch per chunk (≤400 rows), which is atomic -
 * Firestore gives no way to know which individual row inside a failed batch
 * would have failed. Rather than declare the whole chunk lost on a
 * batch.commit() failure, this falls back to retrying that ONE chunk's items
 * individually via writeOne, isolating exactly which rows succeed/fail. This
 * fallback only runs on the rare failure path - an ordinary successful
 * import never pays the per-row write cost, so no write amplification is
 * introduced for the normal case. Cancellation is checked only at
 * chunk-loop-top (chunk-boundary cancellation) - an already-started chunk is
 * never interrupted mid-write, and a chunk that has already committed is
 * never rolled back.
 */
export interface ChunkedWriteOptions<T> {
  items: T[];
  chunkSize: number;
  getId: (item: T) => string | number;
  /** Writes one whole chunk atomically (e.g. a Firestore writeBatch().commit()). */
  writeChunk: (chunk: T[]) => Promise<void>;
  /** Writes exactly one item - only ever invoked as the fallback after writeChunk rejects for the chunk containing this item. */
  writeOne: (item: T) => Promise<void>;
  shouldCancel?: () => boolean;
  onProgress?: (percent: number, currentBatch: number, totalBatches: number) => void;
}

export interface ChunkedWriteResult<T> {
  importedIds: Array<string | number>;
  failedIds: Array<string | number>;
  cancelledCount: number;
  errors: string[];
}

export async function runChunkedWriteWithFallback<T>(opts: ChunkedWriteOptions<T>): Promise<ChunkedWriteResult<T>> {
  const { items, chunkSize, getId, writeChunk, writeOne, shouldCancel, onProgress } = opts;
  const importedIds: Array<string | number> = [];
  const failedIds: Array<string | number> = [];
  const errors: string[] = [];
  let cancelledCount = 0;
  const totalBatches = Math.ceil(items.length / chunkSize) || 1;

  for (let i = 0; i < items.length; i += chunkSize) {
    if (shouldCancel && shouldCancel()) {
      cancelledCount = items.length - i;
      break;
    }
    const chunk = items.slice(i, i + chunkSize);
    const currentBatchNum = Math.floor(i / chunkSize) + 1;

    try {
      await writeChunk(chunk);
      chunk.forEach((item) => importedIds.push(getId(item)));
      if (onProgress) onProgress(Math.round(((i + chunk.length) / items.length) * 100), currentBatchNum, totalBatches);
    } catch {
      // The chunk-level write failed as a whole (atomic) - isolate exactly
      // which of THIS chunk's items actually fail, one at a time.
      for (const item of chunk) {
        try {
          await writeOne(item);
          importedIds.push(getId(item));
        } catch (itemErr: any) {
          failedIds.push(getId(item));
          errors.push(`${getId(item)}: ${itemErr?.message || itemErr}`);
        }
      }
      if (onProgress) onProgress(Math.round(((i + chunk.length) / items.length) * 100), currentBatchNum, totalBatches);
    }
  }

  return { importedIds, failedIds, cancelledCount, errors };
}

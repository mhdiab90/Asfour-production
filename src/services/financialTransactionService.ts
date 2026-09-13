/**
 * Financial transactions - the Firebase side.
 *
 * Reads through the shared cache-first `fetchMasterData`, and writes through the
 * shared audited `createMasterDataItem`, so a transaction gets exactly the audit
 * entry and cache invalidation every master-data write already gets. No raw
 * Firestore call is made here.
 *
 * `createMasterDataItem` only runs its duplicate-code check when a record has a
 * `code` field. A transaction deliberately has none - it references an account
 * and a cost centre by their codes instead - so that check never misfires on
 * two legitimate transactions against the same account.
 *
 * REQUIRES a Firestore rule for `financialTransactions` (see firestore.rules).
 * Until that rule is deployed, the default-deny rule rejects every read and
 * write here, and this service surfaces that error rather than hiding it.
 */
import { fetchMasterData, createMasterDataItem } from './masterDataService';
import {
  FINANCIAL_TRANSACTIONS_COLLECTION,
  FinancialTransaction,
} from './financialTransactionsPure';

export async function listFinancialTransactions(options?: { skipCache?: boolean }): Promise<FinancialTransaction[]> {
  return fetchMasterData<FinancialTransaction>(FINANCIAL_TRANSACTIONS_COLLECTION, options);
}

export interface FinancialImportOutcome {
  successCount: number;
  failedCount: number;
  failed: Array<{ index: number; error: string }>;
  importBatchId: string;
}

/**
 * Writes the already-validated rows, one at a time.
 *
 * The plan was validated before this is called and is never re-validated here,
 * so the count the user confirmed is the count written. Each write is isolated:
 * with 95 planned and 2 failing, 93 stay written - there is no batch and no
 * rollback, the same partial-import rule the rest of this system follows.
 */
export async function importFinancialTransactions(
  rows: readonly FinancialTransaction[],
  onProgress?: (done: number, total: number) => void,
): Promise<FinancialImportOutcome> {
  const importBatchId = `FIN-IMP-${Date.now()}`;
  const failed: FinancialImportOutcome['failed'] = [];
  let successCount = 0;

  for (let i = 0; i < rows.length; i++) {
    try {
      await createMasterDataItem(FINANCIAL_TRANSACTIONS_COLLECTION, { ...rows[i], importBatchId });
      successCount += 1;
    } catch (error: any) {
      failed.push({ index: i, error: String(error?.message ?? error) });
    } finally {
      onProgress?.(i + 1, rows.length);
    }
  }

  return { successCount, failedCount: failed.length, failed, importBatchId };
}

/**
 * Financial Accounts - the thin Firebase-aware layer.
 *
 * Everything that can be decided without Firestore lives in
 * financialAccountsPure.ts (the model, validation, hierarchy adaptation,
 * code-change impact). This file only does the parts that genuinely need a
 * database, and it does them THROUGH the existing Master Data primitives:
 *
 *   read    -> fetchMasterData        (cache-first, per-user scoped, de-duped)
 *   create  -> createMasterDataItem   (audit + cache invalidation included)
 *   update  -> updateMasterDataItem   (audit + cache invalidation included)
 *   dupes   -> checkCodeDuplicate     (indexed equality query, never a scan)
 *   import  -> bulkImportService via the shared MASTER_DATA_SCHEMAS entry
 *
 * No new CRUD engine, no new audit system, no new cache. The only thing this
 * module adds on top is hierarchy safety: an account cannot be saved into a
 * shape that would create a cycle, point at a missing parent, or duplicate a
 * code - checked through the shared resolver before the write is attempted.
 */
import {
  fetchMasterData,
  createMasterDataItem,
  updateMasterDataItem,
  toggleMasterDataActive,
} from './masterDataService';
import {
  FINANCIAL_ACCOUNTS_COLLECTION,
  FinancialAccountRecord,
  assessCodeChangeImpact,
  normaliseAccount,
  toHierarchyNodes,
  validateAccountFields,
} from './financialAccountsPure';
import {
  HierarchyIndex,
  HierarchyIssue,
  buildHierarchyIndex,
  validateNodeEdit,
} from './hierarchyResolverPure';

export { FINANCIAL_ACCOUNTS_COLLECTION };
export type { FinancialAccountRecord };

/**
 * Reads every account, cache-first.
 *
 * `skipCache` is what the UI passes straight after an import or an edit so the
 * refreshed list is the one the user sees, rather than waiting out the
 * freshness window.
 */
export async function listFinancialAccounts(
  options?: { skipCache?: boolean },
): Promise<FinancialAccountRecord[]> {
  return fetchMasterData<FinancialAccountRecord>(FINANCIAL_ACCOUNTS_COLLECTION, options);
}

/** The account set as a hierarchy index, ready for the shared resolver. */
export function buildAccountHierarchy(accounts: readonly FinancialAccountRecord[]): HierarchyIndex {
  return buildHierarchyIndex(toHierarchyNodes(accounts));
}

export interface AccountSaveCheck {
  valid: boolean;
  issues: HierarchyIssue[];
}

/**
 * Everything that must be true before an account is written.
 *
 * Runs against the CURRENT account set the caller already loaded, so it costs
 * no reads. `checkCodeDuplicate` still runs inside createMasterDataItem at
 * write time, which is what actually closes the race - this check is here to
 * fail early with a readable, bilingual reason instead of a Firestore error.
 */
export function validateAccountForSave(
  accounts: readonly FinancialAccountRecord[],
  draft: Partial<FinancialAccountRecord>,
  existingCode?: string,
): AccountSaveCheck {
  const account = normaliseAccount(draft);
  const issues: HierarchyIssue[] = [];

  for (const fieldIssue of validateAccountFields(draft)) {
    issues.push({
      code: fieldIssue.field === 'code' ? 'EMPTY_CODE' : 'EMPTY_NAME',
      messageAr: fieldIssue.messageAr,
      messageEn: fieldIssue.messageEn,
    });
  }

  // A new account is validated against the set PLUS itself, so a parent check
  // has a node to reason about and a duplicate code is still caught.
  const isNew = !existingCode;
  const working = isNew
    ? [...accounts, { ...(account as FinancialAccountRecord) }]
    : accounts.map((a) =>
        a.code === existingCode ? ({ ...a, ...account } as FinancialAccountRecord) : a,
      );

  const index = buildAccountHierarchy(working);
  const targetCode = String(account.code ?? existingCode ?? '');

  if (targetCode) {
    const duplicate = accounts.some(
      (a) => String(a.code).trim() === targetCode && a.code !== existingCode,
    );
    if (duplicate) {
      issues.push({
        code: 'DUPLICATE_CODE',
        messageAr: `كود الحساب "${targetCode}" مسجل بالفعل.`,
        messageEn: `Account code "${targetCode}" already exists.`,
      });
    }

    const structural = validateNodeEdit(
      index,
      targetCode,
      { parentId: account.parentCode ?? null },
      { requireUniqueCode: false },
    );
    issues.push(...structural.issues);
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Creates an account.
 *
 * Deliberately goes through createMasterDataItem rather than addDoc: that is
 * where the existing duplicate recheck, the audit entry and the cache
 * invalidation already live, and duplicating any of the three here would mean
 * two behaviours to keep in step.
 */
export async function createFinancialAccount(
  draft: Partial<FinancialAccountRecord>,
): Promise<string | undefined> {
  const account = normaliseAccount(draft);
  return createMasterDataItem(FINANCIAL_ACCOUNTS_COLLECTION, {
    ...account,
    active: draft.active !== false,
  } as Record<string, any>);
}

/**
 * Updates an account.
 *
 * `parentCode` is written as null rather than omitted when an account is
 * promoted to a root - omitting it would leave the old parent in place and
 * silently undo the move.
 */
export async function updateFinancialAccount(
  id: string,
  patch: Partial<FinancialAccountRecord>,
): Promise<void> {
  const account = normaliseAccount(patch);
  return updateMasterDataItem(FINANCIAL_ACCOUNTS_COLLECTION, id, account as Record<string, any>);
}

export async function toggleFinancialAccountActive(id: string, currentlyActive: boolean): Promise<void> {
  return toggleMasterDataActive(FINANCIAL_ACCOUNTS_COLLECTION, id, currentlyActive);
}

/**
 * Is renaming this account's code safe?
 *
 * Re-exported from the pure module so callers have one obvious place to ask.
 * The answer rests on two verified facts: no production record references a
 * financial account at all, and child accounts reference their parent by code.
 */
export const assessAccountCodeChange = assessCodeChangeImpact;

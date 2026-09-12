/**
 * Financial Accounts - the model rules, kept pure and Firebase-free.
 *
 * WHY THIS FILE EXISTS AT ALL (reported, not decided quietly):
 * The codebase was inspected before writing a line - `financialAccounts` had no
 * Firestore collection, no service, no type, no import schema and no UI. The
 * only trace of it was a stub in the Master Data category registry that pointed
 * at the `departments` collection, which would have listed department records
 * under a "Financial Accounts" heading. There was nothing to reuse, so the
 * MINIMUM structure needed to store, import, search, select and edit an account
 * is defined here - and nothing more. No journal entries, no postings, no
 * balances, no periods, no currencies, no debit/credit semantics: this is
 * Master Data for account codes, not an accounting engine.
 *
 * THE MODEL (exactly these fields, nothing invented for decoration):
 *   code         string   required, unique. The account code.
 *   name         string   required. Arabic name - matches every other Master
 *                         Data collection, whose `name` is already the Arabic one.
 *   nameEn       string   optional English name.
 *   parentCode   string   optional. The parent account's `code`. Absent = root.
 *   accountType  string   optional, free text from the sheet. NOT an enum -
 *                         no chart-of-accounts taxonomy is imposed on the user.
 *   active       boolean  written as true by the shared importer, editable after.
 *   description  string   optional notes.
 *
 * `level` and `path` are DERIVED at read time by the shared hierarchy resolver,
 * never stored - so moving an account cannot leave a stale level behind.
 *
 * The hierarchy runs through hierarchyResolverPure.ts like every other
 * hierarchy in the system. There is no second descendant walk here.
 */
import { resolveParentCode } from './costCenterHierarchyPure';
import { HierarchyNodeInput, buildHierarchyIndex, detectExistingCycles } from './hierarchyResolverPure';

/** Firestore collection. New - see the docblock above for why nothing existed to reuse. */
export const FINANCIAL_ACCOUNTS_COLLECTION = 'financialAccounts';

export interface FinancialAccountRecord {
  id?: string;
  code: string;
  name: string;
  nameEn?: string;
  parentCode?: string | null;
  accountType?: string;
  description?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// --- Normalisation -----------------------------------------------------------

export function normaliseAccountCode(raw: unknown): string {
  return String(raw ?? '').trim();
}

/**
 * Trims the writable fields and drops a self-referencing parent.
 *
 * A row whose parentCode equals its own code is a common spreadsheet artefact.
 * Treating it as a root is right: the alternative is storing a one-node cycle
 * that every later resolution then has to defend against.
 */
export function normaliseAccount(input: Partial<FinancialAccountRecord>): Partial<FinancialAccountRecord> {
  const code = normaliseAccountCode(input.code);
  const parentRaw = input.parentCode == null ? '' : normaliseAccountCode(input.parentCode);
  const parentCode = parentRaw && parentRaw !== code ? parentRaw : null;

  const out: Partial<FinancialAccountRecord> = { ...input, code, parentCode };
  if (input.name !== undefined) out.name = String(input.name).trim();
  if (input.nameEn !== undefined) out.nameEn = String(input.nameEn).trim();
  if (input.accountType !== undefined) out.accountType = String(input.accountType).trim();
  if (input.description !== undefined) out.description = String(input.description).trim();
  return out;
}

// --- Validation --------------------------------------------------------------

export interface AccountFieldIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

/**
 * Field-level checks for ONE account, independent of every other row.
 *
 * Row-independent on purpose: the shared importer applies this per row and
 * imports the rows that pass, so one malformed account never blocks the rest.
 */
export function validateAccountFields(input: Partial<FinancialAccountRecord>): AccountFieldIssue[] {
  const issues: AccountFieldIssue[] = [];
  const account = normaliseAccount(input);

  if (!account.code) {
    issues.push({
      field: 'code',
      messageAr: 'كود الحساب مطلوب.',
      messageEn: 'Account code is required.',
    });
  }
  if (!account.name) {
    issues.push({
      field: 'name',
      messageAr: 'اسم الحساب مطلوب.',
      messageEn: 'Account name is required.',
    });
  }
  return issues;
}

// --- Hierarchy adaptation ----------------------------------------------------

/**
 * Presents accounts to the shared resolver.
 *
 * The document id is the account CODE, so a parent reference is just the parent
 * account's code - no id lookup table, and an account can be re-parented by
 * naming a code the user can actually see on screen.
 */
export function toHierarchyNodes(accounts: readonly FinancialAccountRecord[]): HierarchyNodeInput[] {
  return accounts.map((a) => ({
    ...a,
    id: normaliseAccountCode(a.code || a.id),
    code: normaliseAccountCode(a.code || a.id),
    parentId: a.parentCode ? normaliseAccountCode(a.parentCode) : null,
  }));
}

/**
 * Fills in a missing parentCode by code prefix, using the EXISTING
 * `resolveParentCode` primitive that already serves the cost-centre hierarchy
 * (longest known prefix wins, so 2-digit child suffixes work as well as
 * 1-digit ones).
 *
 * Deliberately conservative in two ways:
 *   - an explicitly supplied parentCode is never overwritten. What the sheet
 *     states beats what a prefix suggests.
 *   - a parent is only inferred when that shorter code EXISTS in the same set.
 *     No parent is conjured out of a code that nobody imported.
 *
 * Callers pass `infer: false` to switch this off entirely and keep only the
 * relationships stated in the file.
 */
export function deriveMissingParents(
  accounts: readonly FinancialAccountRecord[],
  options?: { infer?: boolean },
): FinancialAccountRecord[] {
  const infer = options?.infer !== false;
  const known = new Set(accounts.map((a) => normaliseAccountCode(a.code)).filter(Boolean));

  return accounts.map((a) => {
    const normalised = normaliseAccount(a) as FinancialAccountRecord;
    if (normalised.parentCode) return normalised;
    if (!infer) return { ...normalised, parentCode: null };
    const inferred = resolveParentCode(normalised.code, known);
    return { ...normalised, parentCode: inferred };
  });
}

// --- Search ------------------------------------------------------------------

/**
 * Searches WITHIN the account set only - never across other Master Data.
 * Matches code, Arabic name, English name and account type.
 */
export function searchAccounts(
  accounts: readonly FinancialAccountRecord[],
  query: string,
): FinancialAccountRecord[] {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return [...accounts];
  return accounts.filter((a) =>
    [a.code, a.name, a.nameEn, a.accountType]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(q)),
  );
}

// --- Code-change impact ------------------------------------------------------

export interface CodeChangeImpact {
  safe: boolean;
  childCount: number;
  /** Codes whose parentCode points at the old code and would be orphaned. */
  affectedChildCodes: string[];
  reasonAr: string;
  reasonEn: string;
}

/**
 * What breaks if this account's code changes?
 *
 * Two facts drive the answer, both verified rather than assumed:
 *   - No production record references a financial account. `UniversalStageRecord`
 *     has no accountId/accountCode/financialAccount field at all, so renaming an
 *     account cannot alter or invalidate a single historical production figure.
 *   - Child accounts DO reference the parent by code, since parentCode is a code.
 *     So a rename with children still attached would orphan them.
 *
 * Hence: a rename is reported as safe only when the account has no children.
 * That is a real, checkable condition - not a migration invented on the spot.
 */
export function assessCodeChangeImpact(
  accounts: readonly FinancialAccountRecord[],
  oldCode: string,
): CodeChangeImpact {
  const code = normaliseAccountCode(oldCode);
  const affectedChildCodes = accounts
    .filter((a) => normaliseAccountCode(a.parentCode ?? '') === code)
    .map((a) => normaliseAccountCode(a.code));

  if (affectedChildCodes.length === 0) {
    return {
      safe: true,
      childCount: 0,
      affectedChildCodes,
      reasonAr:
        'لا توجد حسابات فرعية مرتبطة بهذا الكود، ولا يوجد أي حقل في سجلات الإنتاج يشير إلى الحسابات المالية، لذلك تغيير الكود لا يؤثر على أي بيانات تاريخية.',
      reasonEn:
        'No child account references this code, and no production record field references financial accounts at all, so changing the code cannot affect historical data.',
    };
  }

  return {
    safe: false,
    childCount: affectedChildCodes.length,
    affectedChildCodes,
    reasonAr: `${affectedChildCodes.length} حساب فرعي يشير إلى هذا الكود كأصل، وتغييره سيفصلها عن التسلسل الهرمي. انقل الحسابات الفرعية أولاً.`,
    reasonEn: `${affectedChildCodes.length} child account(s) reference this code as their parent; changing it would detach them. Re-parent the children first.`,
  };
}

// --- Import-time relationship checks -----------------------------------------

export interface AccountImportRowIssue {
  rowNumber: number;
  errors: string[];
}

/**
 * Checks the relationships an import file states, ROW BY ROW.
 *
 * The shared importer already covers required fields and duplicate codes. What
 * it cannot know is whether a stated `parentCode` means anything, so this adds
 * exactly two checks and no more:
 *
 *   1. the parent must resolve - to an account already stored OR to another row
 *      in the same file. A parent naming nothing would silently detach the
 *      account from every report that walks the tree.
 *   2. the file must not describe a cycle (A under B, B under C, C under A).
 *      Detected through the SHARED resolver, never a second graph walk here.
 *
 * Row-independent by construction: each problem is attached to its own row, so
 * the valid rows in a mixed file stay importable. Rows already rejected by the
 * shared importer are simply not passed in.
 *
 * A row that states no parent is a root and is always fine - a flat account
 * list is a legitimate import.
 */
export function validateAccountImportRelationships(
  rows: ReadonlyArray<{ rowNumber: number; data: Record<string, unknown> }>,
  existingCodes: ReadonlySet<string>,
): AccountImportRowIssue[] {
  const issues = new Map<number, string[]>();
  const addIssue = (rowNumber: number, message: string) => {
    const list = issues.get(rowNumber);
    if (list) list.push(message);
    else issues.set(rowNumber, [message]);
  };

  const inFile = new Map<string, number>();
  for (const row of rows) {
    const code = normaliseAccountCode(row.data.code);
    if (code && !inFile.has(code)) inFile.set(code, row.rowNumber);
  }

  for (const row of rows) {
    const code = normaliseAccountCode(row.data.code);
    const parent = normaliseAccountCode(row.data.parentCode);
    if (!parent) continue; // a root account - always valid

    if (parent === code) {
      addIssue(row.rowNumber, `الحساب "${code}" مُعرَّف كأصل لنفسه. / Account "${code}" is set as its own parent.`);
      continue;
    }
    if (!existingCodes.has(parent) && !inFile.has(parent)) {
      addIssue(
        row.rowNumber,
        `كود الحساب الأصل "${parent}" غير موجود في قاعدة البيانات ولا في نفس الملف. / Parent account "${parent}" exists neither in the database nor in this file.`,
      );
    }
  }

  // Cycle detection across the file plus what is already stored, through the
  // shared resolver - the same one Master Data editing and reporting use.
  const nodes: HierarchyNodeInput[] = rows.map((row) => ({
    id: normaliseAccountCode(row.data.code),
    code: normaliseAccountCode(row.data.code),
    parentId: normaliseAccountCode(row.data.parentCode) || null,
  }));
  for (const cycle of detectExistingCycles(buildHierarchyIndex(nodes))) {
    const chain = cycle.join(' -> ');
    for (const member of cycle) {
      const rowNumber = inFile.get(member);
      if (rowNumber !== undefined) {
        addIssue(rowNumber, `حلقة مغلقة في شجرة الحسابات: ${chain} / Cycle in the account tree: ${chain}`);
      }
    }
  }

  return [...issues.entries()]
    .map(([rowNumber, errors]) => ({ rowNumber, errors }))
    .sort((a, b) => a.rowNumber - b.rowNumber);
}

/**
 * Financial transactions - the minimum model, pure and Firebase-free.
 *
 * WHY THIS EXISTS (reported, not decided quietly).
 * The codebase was audited first: there is no expense, transaction, journal or
 * ledger collection anywhere, no type, no service and no Firestore rule. Only
 * `financialAccounts` exists, and it is master data - a chart of accounts, not
 * money. So there was nothing to reuse, and this defines the SMALLEST record
 * that answers "how much was spent, on which account, in which cost centre, on
 * which day". No journal entries, no double entry, no balances, no periods.
 *
 * THE RECORD (collection `financialTransactions`):
 *   date            string   required, YYYY-MM-DD - the same date format and
 *                            boundary semantics production records use, so a
 *                            Dashboard period means the same days for both
 *   accountCode     string   required - must exist in Financial Accounts
 *   costCenterCode  string   required - must exist in the cost-centre hierarchy
 *   amount          number   required, finite
 *   description     string   optional
 *   reference       string   optional - an invoice or voucher number, as given
 *
 * IDENTITY. Both references are business CODES, which are the stable identity
 * of those entities in this system: cost-centre nodes are stored under their
 * sheet1Code as the document id, and codes are unique per category. A name is
 * never used to identify anything - names differ between sources.
 *
 * WHAT A TRANSACTION IS NOT LINKED TO. No product, customer, shift or stage.
 * Filters for those are production dimensions and must not be applied to money
 * - a Product filter cannot narrow financial value that carries no product.
 */

export const FINANCIAL_TRANSACTIONS_COLLECTION = 'financialTransactions';

export interface FinancialTransaction {
  id?: string;
  date: string;
  accountCode: string;
  costCenterCode: string;
  amount: number;
  description?: string;
  reference?: string;
  importBatchId?: string;
}

// --- Normalisation -----------------------------------------------------------

/** Trim only. A code's leading zeros are significant and are never stripped. */
export function normaliseTxCode(raw: unknown): string {
  return String(raw ?? '').trim();
}

/**
 * A spreadsheet amount to a number, or null when it is not one.
 *
 * Accepts thousands separators and Arabic-Indic digits, because those are how
 * amounts actually arrive in Excel here. Anything else - text, an empty cell,
 * Infinity - is null rather than a silent zero, since importing a zero where a
 * number was unreadable would understate spending without anyone noticing.
 */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw ?? '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,٬\s]/g, '')
    .replace(/٫/g, '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * A date to YYYY-MM-DD, or null when it is not a real calendar date.
 *
 * Excel serial numbers are accepted because a date column read with defaults
 * arrives that way. "2026-02-30" is rejected: it is not a day that exists.
 */
export function parseTxDate(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 80000) {
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + Math.round(raw) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const text = String(raw ?? '').trim();
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text) || /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, mo - 1, da));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== da) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

// --- Column headers ------------------------------------------------------------

/**
 * Accepted header spellings per field. A sheet arrives with whatever headers
 * its author typed, in Arabic or English; matching is on the trimmed,
 * lower-cased header, never on column position.
 */
export const FINANCIAL_TX_HEADER_ALIASES: Record<keyof Omit<FinancialTransaction, 'id' | 'importBatchId'>, string[]> = {
  date: ['date', 'transaction date', 'التاريخ', 'تاريخ'],
  accountCode: ['accountcode', 'account code', 'account', 'كود الحساب', 'رقم الحساب', 'الحساب'],
  costCenterCode: ['costcentercode', 'cost center code', 'cost centre code', 'cost center', 'cost centre', 'كود مركز التكلفة', 'مركز التكلفة', 'مركز التكاليف'],
  amount: ['amount', 'value', 'المبلغ', 'القيمة'],
  description: ['description', 'البيان', 'الوصف'],
  reference: ['reference', 'ref', 'المرجع', 'رقم المستند'],
};

/** One raw sheet row to the canonical field names. Unknown columns are dropped. */
export function mapFinancialRowHeaders(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const byHeader = new Map<string, unknown>();
  for (const [key, value] of Object.entries(raw)) byHeader.set(key.trim().toLowerCase(), value);
  for (const [field, aliases] of Object.entries(FINANCIAL_TX_HEADER_ALIASES)) {
    const hit = aliases.find((alias) => byHeader.has(alias));
    if (hit !== undefined) out[field] = byHeader.get(hit);
  }
  return out;
}

// --- Validation --------------------------------------------------------------

export interface TxRowIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface ValidatedTxRow {
  rowNumber: number;
  valid: boolean;
  issues: TxRowIssue[];
  /** Present only when valid. */
  transaction?: FinancialTransaction;
}

/**
 * Validates ONE row against the real master data, independent of every other.
 *
 * Row independence is what makes partial import possible: a bad account code on
 * row 7 says nothing about row 8. The account and cost centre are checked by
 * EXACT code against the sets actually loaded - never by name, never fuzzily.
 * A name that differs from the master record is irrelevant; the code decides.
 */
export function validateFinancialRow(
  rowNumber: number,
  row: Record<string, unknown>,
  accountCodes: ReadonlySet<string>,
  costCenterCodes: ReadonlySet<string>,
): ValidatedTxRow {
  const issues: TxRowIssue[] = [];

  const date = parseTxDate(row.date);
  if (!date) {
    issues.push({ field: 'date', messageAr: 'التاريخ غير صالح (المطلوب YYYY-MM-DD).', messageEn: 'Invalid date (expected YYYY-MM-DD).' });
  }

  const accountCode = normaliseTxCode(row.accountCode);
  if (!accountCode) {
    issues.push({ field: 'accountCode', messageAr: 'كود الحساب مطلوب.', messageEn: 'Account code is required.' });
  } else if (!accountCodes.has(accountCode)) {
    issues.push({
      field: 'accountCode',
      messageAr: `الحساب "${accountCode}" غير موجود في الحسابات المالية.`,
      messageEn: `Account "${accountCode}" does not exist in Financial Accounts.`,
    });
  }

  const costCenterCode = normaliseTxCode(row.costCenterCode);
  if (!costCenterCode) {
    issues.push({ field: 'costCenterCode', messageAr: 'كود مركز التكلفة مطلوب.', messageEn: 'Cost centre code is required.' });
  } else if (!costCenterCodes.has(costCenterCode)) {
    issues.push({
      field: 'costCenterCode',
      messageAr: `مركز التكلفة "${costCenterCode}" غير موجود في التسلسل الهرمي.`,
      messageEn: `Cost centre "${costCenterCode}" does not exist in the hierarchy.`,
    });
  }

  const amount = parseAmount(row.amount);
  if (amount == null) {
    issues.push({ field: 'amount', messageAr: 'المبلغ غير صالح.', messageEn: 'Invalid amount.' });
  }

  if (issues.length > 0) return { rowNumber, valid: false, issues };

  const description = normaliseTxCode(row.description);
  const reference = normaliseTxCode(row.reference);
  return {
    rowNumber,
    valid: true,
    issues,
    transaction: {
      date: date as string,
      accountCode,
      costCenterCode,
      amount: amount as number,
      ...(description ? { description } : {}),
      ...(reference ? { reference } : {}),
    },
  };
}

export interface FinancialImportPlan {
  rows: ValidatedTxRow[];
  validCount: number;
  invalidCount: number;
  /** The exact set of documents an import would write. */
  toWrite: FinancialTransaction[];
}

/** Validates a whole sheet, keeping every row's verdict for review. */
export function planFinancialImport(
  rows: ReadonlyArray<Record<string, unknown>>,
  accountCodes: ReadonlySet<string>,
  costCenterCodes: ReadonlySet<string>,
): FinancialImportPlan {
  const validated = rows.map((row, i) => validateFinancialRow(i + 2, row, accountCodes, costCenterCodes));
  const toWrite = validated.filter((r) => r.valid && r.transaction).map((r) => r.transaction as FinancialTransaction);
  return {
    rows: validated,
    validCount: toWrite.length,
    invalidCount: validated.length - toWrite.length,
    toWrite,
  };
}

// --- Aggregation -------------------------------------------------------------

export interface FinancialScope {
  /** Resolved cost-centre codes (node + descendants). null = every cost centre. */
  costCenterCodes: ReadonlySet<string> | null;
  /** Account codes to include. null/empty = every account. */
  accountCodes?: ReadonlySet<string> | null;
  startDate?: string;
  endDate?: string;
}

export interface FinancialAggregate {
  total: number;
  count: number;
}

/**
 * Sums actual transaction amounts inside a scope.
 *
 * Money is never derived from production quantities here. A null cost-centre
 * scope means no cost-centre narrowing; an EMPTY one means a selection was made
 * that resolved to nothing, and correctly sums to zero.
 *
 * Date bounds are inclusive on both ends, matching the production filter, so
 * the same Dashboard period selects the same days for both datasets.
 */
export function aggregateFinancialValue(
  transactions: readonly FinancialTransaction[],
  scope: FinancialScope,
): FinancialAggregate {
  const accounts = scope.accountCodes && scope.accountCodes.size > 0 ? scope.accountCodes : null;
  let total = 0;
  let count = 0;
  const seen = new Set<string>();

  for (const tx of transactions) {
    // Each document counts once even if it arrives twice.
    const key = tx.id ? String(tx.id) : '';
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    if (scope.startDate && tx.date < scope.startDate) continue;
    if (scope.endDate && tx.date > scope.endDate) continue;
    if (scope.costCenterCodes && !scope.costCenterCodes.has(normaliseTxCode(tx.costCenterCode))) continue;
    if (accounts && !accounts.has(normaliseTxCode(tx.accountCode))) continue;
    const amount = parseAmount(tx.amount);
    if (amount == null) continue;
    total += amount;
    count += 1;
  }

  // Round to the cent so floating-point dust never reaches a KPI.
  return { total: Math.round(total * 100) / 100, count };
}

/**
 * Chinese Mills Historical Import - selection/eligibility logic ONLY.
 *
 * Deliberately Firebase-free (no import of ../config/firebase or anything
 * that transitively pulls it in) so this is unit-testable with plain
 * in-memory fixtures via `npx tsx` - see scripts/tests/. This is the SINGLE
 * authoritative source for "what counts as Valid / Ready / Corrected /
 * Invalid-Needs-Review" - both ChineseMillsImportPanel.tsx (bulk-select
 * buttons, top summary counts, review windows) and
 * chineseMillsHistoricalImportService.ts (import-time writable check)
 * import from here, so there is never a second/competing definition (§22).
 */
import { ChineseMillsImportRow } from '../types';

/**
 * Approve Invalid Records task, §10: which of a row's blocking errors an
 * authorized user's approval decision may safely override, vs. a hard
 * structural rule this business has defined as non-overridable. Determined
 * by inspecting the ACTUAL Firestore write payload in
 * executeChineseMillsBatchImport (chineseMillsHistoricalImportService.ts) -
 * every resolved master-data field (customer/mill/fault/specification
 * type/id) is written with a `|| ''` fallback to the raw imported text, so
 * an unresolved master-data MATCH never blocks the write at the database
 * level and is safely overridable. These five conditions are checked
 * directly off the row's own independently-recomputed typed fields (never
 * by matching freeform, locale-varying error text) because writing past them
 * would corrupt the record or the dataset outright, regardless of any human
 * decision:
 *  - INVALID_DATE: `date` is written as a plain string and is the key half
 *    of the duplicate-detection key and every date-based report/query.
 *  - Mill Type entirely blank (not just unmatched): the record would carry
 *    no press identity at all - `millTypeRaw` has no raw-text fallback to
 *    fall back to when it never had one.
 *  - Invalid Shift: `shiftNumber` is a closed 1/2/3 enum written as `?? null`
 *    - a null/invalid shift breaks shift-based aggregation.
 *  - Production Quantity <= 0: written directly as the raw `quantity`
 *    number, no fallback - this is the row's entire business reason to
 *    exist; a record with none has no meaning.
 *  - Duplicate-in-file: approving this would double-count real, physical
 *    production in every report - a data-integrity safety net, not a
 *    reviewable data-quality question.
 */
export function isNonOverridableBlockingCondition(row: ChineseMillsImportRow): boolean {
  if (row.status === 'INVALID_DATE') return true;
  if (!row.millTypeRaw || !row.millTypeRaw.trim()) return true;
  if (!row.resolvedShiftNumber) return true;
  if (!(row.productionQuantity > 0)) return true;
  if (row.duplicateType === 'FILE') return true;
  return false;
}

/**
 * A row is writable only once it is explicitly INCLUDED (never while
 * EXCLUDED or still parked PENDING), every WARNING has been explicitly
 * accepted, and every smart-match proposal has a decision (never left
 * silently PENDING). A row with blocking errors is writable ONLY if an
 * authorized user has explicitly approved it (row.approved) AND none of its
 * errors are non-overridable per isNonOverridableBlockingCondition above -
 * approval is an override of REVIEWABLE errors, never a bypass of a hard
 * structural/data-integrity rule.
 */
export function isChineseMillsRowWritable(row: ChineseMillsImportRow): boolean {
  if ((row.rowSelection ?? 'INCLUDED') !== 'INCLUDED') return false;
  if (row.errors.length > 0) {
    if (!row.approved) return false;
    if (isNonOverridableBlockingCondition(row)) return false;
  }
  if (row.warnings.length > 0 && !row.warningsAccepted) return false;
  if ((row.proposedMatches || []).some((m) => m.decision === 'PENDING')) return false;
  if (row.actualRateDecision === 'PENDING') return false;
  if (row.customerCodeUpdateProposal?.decision === 'PENDING') return false;
  return true;
}

/** APPROVED (for display/counters): has a blocking error AND has been explicitly approved - independent of whether that approval actually makes it writable (a non-overridable error can still be approved-for-review-tracking but will never count toward Will Import). */
export function matchesApproved(row: ChineseMillsImportRow): boolean {
  return row.errors.length > 0 && row.approved === true;
}

/** getSelection with the same 'INCLUDED' default used throughout the panel. */
export function getRowSelection(row: ChineseMillsImportRow): 'INCLUDED' | 'EXCLUDED' | 'PENDING' {
  return row.rowSelection ?? 'INCLUDED';
}

/**
 * Global Ready-to-Import Override task, §10: whether "Mark as Ready to
 * Import" can succeed for this row AT ALL, regardless of its current
 * validationStatus. Two independent reasons a row can never be forced
 * ready, neither guessed - both read directly off the SAME existing guards
 * isChineseMillsRowWritable already enforces:
 *  - A non-overridable structural error (§10 of the Approve Invalid Records
 *    task, reused verbatim here - never a second overridability model).
 *  - An unresolved smart-match/Actual-Rate/Customer-Code decision still
 *    PENDING - these require the user to pick a SPECIFIC answer, which a
 *    blanket "mark ready" action must never silently decide FOR them.
 */
export function canMarkReadyToImport(row: ChineseMillsImportRow): boolean {
  if (row.errors.length > 0 && isNonOverridableBlockingCondition(row)) return false;
  if ((row.proposedMatches || []).some((m) => m.decision === 'PENDING')) return false;
  if (row.actualRateDecision === 'PENDING') return false;
  if (row.customerCodeUpdateProposal?.decision === 'PENDING') return false;
  return true;
}

/**
 * The field patch "Mark as Ready to Import" applies to a row that already
 * passed canMarkReadyToImport - caller must check that first (this function
 * does not re-check it). Deliberately reuses the EXISTING mechanisms that
 * already drive isChineseMillsRowWritable rather than inventing a parallel
 * writability path: rowSelection -> INCLUDED (undoes EXCLUDED/SKIPPED/
 * PENDING - §8/§9, "Reinclude and Mark Ready"), approved -> true only when
 * the row actually has overridable errors to override (§16 - a clean row
 * never gets a meaningless approved flag), warningsAccepted -> true only
 * when there is an actual unaccepted warning to accept (§17 - never
 * touches/hides the warning itself). validationStatus (status/errors/
 * warnings) is never part of this patch - §11's core rule.
 */
export function computeMarkReadyPatch(row: ChineseMillsImportRow): Partial<ChineseMillsImportRow> {
  const patch: Partial<ChineseMillsImportRow> = { rowSelection: 'INCLUDED', exclusionReason: undefined };
  if (row.errors.length > 0) patch.approved = true;
  if (row.warnings.length > 0 && !row.warningsAccepted) patch.warningsAccepted = true;
  return patch;
}

/** READY_TO_IMPORT (for display/counters) - an explicit "Mark as Ready to Import" decision was recorded for this row, independent of whether it is currently selected/writable (e.g. a later edit could have invalidated it again). */
export function matchesReadyToImport(row: ChineseMillsImportRow): boolean {
  return row.readyToImport === true;
}

/** VALID: no blocking errors AND no warnings at all (stricter than "writable" - a row with an accepted warning is writable but not "clean valid"). */
export function matchesValid(row: ChineseMillsImportRow): boolean {
  return row.errors.length === 0 && row.warnings.length === 0;
}

/** READY: would be writable right now if it were INCLUDED - i.e. every blocking/pending condition is already resolved, regardless of its current INCLUDED/EXCLUDED state. */
export function matchesReady(row: ChineseMillsImportRow): boolean {
  return isChineseMillsRowWritable({ ...row, rowSelection: 'INCLUDED' });
}

/** CORRECTED: has at least one entry in its resolution/edit history (a manual fix was applied at some point). */
export function matchesCorrected(row: ChineseMillsImportRow): boolean {
  return (row.resolutionHistory?.length || 0) > 0;
}

/** WARNING_APPROVED: has warnings and the user has explicitly accepted them. */
export function matchesWarningApproved(row: ChineseMillsImportRow): boolean {
  return row.warnings.length > 0 && !!row.warningsAccepted;
}

/**
 * INVALID / NEEDS REVIEW: rows that require a user decision before they can
 * ever be imported - has a BLOCKING error (INTRINSIC: row.errors.length > 0,
 * never the mutable rowSelection field - see the root-cause note on
 * computeBulkSelectionOutcome below for why) OR still carries an unresolved
 * condition (unaccepted warning, a smart-match proposal still PENDING, an
 * unresolved Actual Rate/Customer Code decision). Deliberately does NOT
 * include a row whose only issue is an ALREADY-accepted warning
 * (matchesWarningApproved) - task §8 requires WARNING to not be reclassified
 * as INVALID unless it genuinely still blocks the row.
 */
export function matchesInvalidNeedsReview(row: ChineseMillsImportRow): boolean {
  if (row.errors.length > 0) return true;
  if (row.warnings.length > 0 && !row.warningsAccepted) return true;
  if ((row.proposedMatches || []).some((m) => m.decision === 'PENDING')) return true;
  if (row.actualRateDecision === 'PENDING') return true;
  if (row.customerCodeUpdateProposal?.decision === 'PENDING') return true;
  return false;
}

export type BulkSelectionMode = 'ALL' | 'NONE' | 'VALID' | 'READY' | 'CORRECTED' | 'WARNING_APPROVED';

/**
 * Pure decision function behind handleBulkSelection: given one row and a
 * mode, decide its NEW rowSelection.
 *
 * ROOT CAUSE FIX: a row with a blocking error is parked as rowSelection
 * 'PENDING' at parse time (§ Row-Based Review Part 6). The PREVIOUS version
 * of this function treated 'PENDING' as "never touched by bulk selection" -
 * intended to stop a blocking row from becoming importable via a careless
 * Select All, but it actually broke Select All/Deselect All entirely for
 * every blocking row: the checkbox in the review modal reads
 * getRowSelection(row) === 'INCLUDED', so a row this function always skipped
 * could NEVER visually check, no matter how many times Select All was
 * clicked - exactly the reported "individual checkbox works, Select All does
 * nothing" bug (manual re-include/exclude call other handlers directly and
 * were never gated here). This mirrors Pressing's OWN proven pattern
 * exactly: Pressing has no PENDING state at all - EVERY row, blocking or
 * not, gets an explicit INCLUDED/EXCLUDED decision from Select All/Deselect
 * All (see pressingSelectionPure.ts's computePressingBulkOutcome), and
 * "blocking" is a purely DERIVED, INTRINSIC classification
 * (isRowReadyToImport/errors.length) that is completely independent of
 * selection state. Selection ("is this row part of my reviewed batch") and
 * writability ("can this row actually be written right now") are two
 * separate questions - isChineseMillsRowWritable's OWN errors.length check
 * already guarantees a blocking row can never be written regardless of
 * whether it is now selected, so there is no safety reason to also gate it
 * here. Never returns null anymore - every row gets a real decision.
 */
export function computeBulkSelectionOutcome(
  row: ChineseMillsImportRow,
  mode: BulkSelectionMode
): { rowSelection: 'INCLUDED' | 'EXCLUDED'; exclusionReason?: 'USER_DESELECTED' } | null {
  if (mode === 'ALL') return { rowSelection: 'INCLUDED' };
  if (mode === 'NONE') return { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' };
  const matches =
    mode === 'VALID' ? matchesValid(row) :
    mode === 'READY' ? matchesReady(row) :
    mode === 'CORRECTED' ? matchesCorrected(row) :
    matchesWarningApproved(row); // WARNING_APPROVED
  return matches ? { rowSelection: 'INCLUDED' } : { rowSelection: 'EXCLUDED', exclusionReason: 'USER_DESELECTED' };
}

export interface ChineseMillsSelectionCounts {
  total: number;
  valid: number;
  ready: number;
  corrected: number;
  invalidNeedsReview: number;
  warning: number;
  selected: number;
  excluded: number;
  skipped: number;
  willImport: number;
  /** Approve Invalid Records task §19: has a blocking error AND has been explicitly approved. */
  approved: number;
  /** Has a blocking error that approval can never override (§10) - always excluded from Will Import regardless of approval. */
  blocking: number;
  /** Global Ready-to-Import Override task §19: rows with an explicit "Mark as Ready to Import" decision recorded (row.readyToImport) - distinct from the pre-existing `ready` above (matchesReady - "would be writable if included", never requires the explicit decision). */
  markedReadyToImport: number;
}

/** §3/§11 - the top-of-screen counts, computed ONLY from actual row state - never invented/estimated. */
export function computeSelectionCounts(rows: ChineseMillsImportRow[]): ChineseMillsSelectionCounts {
  let valid = 0, ready = 0, corrected = 0, invalidNeedsReview = 0, warning = 0, selected = 0, excluded = 0, skipped = 0, willImport = 0, approved = 0, blocking = 0, markedReadyToImport = 0;
  for (const row of rows) {
    if (matchesValid(row)) valid++;
    if (matchesReady(row)) ready++;
    if (matchesCorrected(row)) corrected++;
    if (matchesInvalidNeedsReview(row)) invalidNeedsReview++;
    if (row.warnings.length > 0) warning++;
    if (matchesApproved(row)) approved++;
    if (row.errors.length > 0 && isNonOverridableBlockingCondition(row)) blocking++;
    if (matchesReadyToImport(row)) markedReadyToImport++;
    const sel = getRowSelection(row);
    if (sel === 'INCLUDED') selected++;
    if (sel === 'EXCLUDED') excluded++;
    if (sel === 'EXCLUDED' && row.exclusionReason === 'SKIPPED_ROW') skipped++;
    if (isChineseMillsRowWritable(row)) willImport++;
  }
  return { total: rows.length, valid, ready, corrected, invalidNeedsReview, warning, selected, excluded, skipped, willImport, approved, blocking, markedReadyToImport };
}

/**
 * §17-19 - final import eligibility: only rows that are BOTH currently
 * selected for the review window AND writable right now. Splits a candidate
 * set into what would import vs. what would remain, without mutating
 * anything - used for the "X will be imported, Y will remain" confirmation
 * (§20) and to prove invalid rows never block valid ones (§18 test).
 */
export function planImport(rows: ChineseMillsImportRow[]): { willImport: ChineseMillsImportRow[]; willRemain: ChineseMillsImportRow[] } {
  const willImport: ChineseMillsImportRow[] = [];
  const willRemain: ChineseMillsImportRow[] = [];
  for (const row of rows) {
    (isChineseMillsRowWritable(row) ? willImport : willRemain).push(row);
  }
  return { willImport, willRemain };
}

/**
 * §6-7/§9: pure batch-boundary planner behind executeChineseMillsBatchImport's
 * cancellation loop - given how many writable rows there are and which batch
 * index a cancel request landed on (or -1 if never cancelled), returns the
 * same importedCount/cancelledCount split the real Firestore loop produces,
 * WITHOUT touching Firestore. This is the single source of truth for "how
 * many rows count as imported vs. cancelled" so the UI's importResult and
 * the service's return value can never disagree. Batches already started are
 * never partially rolled back (a writeBatch().commit() is atomic) - only
 * whole not-yet-started batches are ever counted as cancelled.
 */
export function planBatchCancellation(
  writableCount: number,
  batchSize: number,
  cancelledAtBatchStartIndex: number
): { importedCount: number; cancelledCount: number; totalBatches: number } {
  const totalBatches = Math.ceil(writableCount / batchSize) || 1;
  if (cancelledAtBatchStartIndex < 0 || cancelledAtBatchStartIndex >= writableCount) {
    return { importedCount: writableCount, cancelledCount: 0, totalBatches };
  }
  return {
    importedCount: cancelledAtBatchStartIndex,
    cancelledCount: writableCount - cancelledAtBatchStartIndex,
    totalBatches,
  };
}

/**
 * Comprehensive Historical Import Management task §11-21: structured error
 * explanation - classifies each of a row's ACTUAL error strings (produced
 * verbatim by revalidateChineseMillsRowFields in
 * chineseMillsHistoricalImportService.ts) into a Problem/Field/Current
 * Value/Reason/Suggested Solution/Actions record. This is pattern-matching
 * against the REAL, EXISTING validator's own known output - never a new or
 * invented validation rule (§12). §17: a specification-CODE problem is
 * always labeled with its own field (specificationCodeRaw), never confused
 * with the free-text `specification` description field.
 */
export type ChineseMillsErrorType =
  | 'MISSING_REQUIRED_FIELD'
  | 'MISSING_OPTIONAL_FIELD'
  | 'UNKNOWN_MASTER_DATA_CODE'
  | 'DUPLICATE_MATCH'
  | 'LOGICAL_INCONSISTENCY'
  | 'INVALID_FORMAT'
  | 'OTHER_VALIDATION_ERROR';

export type ChineseMillsErrorAction = 'APPLY_SUGGESTED' | 'SELECT_EXISTING' | 'MANUAL_FIX' | 'ADD_NEW' | 'APPROVE' | 'EXCLUDE' | 'SKIP' | 'REVALIDATE';

export interface ChineseMillsErrorExplanation {
  type: ChineseMillsErrorType;
  field: string;
  fieldLabelAr: string;
  fieldLabelEn: string;
  currentValue: string;
  reasonAr: string;
  reasonEn: string;
  suggestedSolutionAr: string;
  suggestedSolutionEn: string;
  overridable: boolean;
  actions: ChineseMillsErrorAction[];
}

const MASTER_DATA_ACTIONS: ChineseMillsErrorAction[] = ['SELECT_EXISTING', 'MANUAL_FIX', 'ADD_NEW', 'APPROVE', 'EXCLUDE', 'SKIP', 'REVALIDATE'];
const REQUIRED_FIELD_ACTIONS: ChineseMillsErrorAction[] = ['MANUAL_FIX', 'EXCLUDE', 'SKIP', 'REVALIDATE'];

/** Classifies ONE error message string into a structured explanation for the given row. Returns a generic OTHER_VALIDATION_ERROR explanation for any message that doesn't match a known pattern (never throws, never silently drops the error). */
export function explainChineseMillsRowError(row: ChineseMillsImportRow, errorMessage: string): ChineseMillsErrorExplanation {
  const overridable = !isNonOverridableBlockingCondition({ ...row, errors: [errorMessage] });

  if (errorMessage.includes('التاريخ مفقود أو غير صالح') || errorMessage.includes('Date is missing or invalid')) {
    return {
      type: 'MISSING_REQUIRED_FIELD', field: 'date', fieldLabelAr: 'التاريخ', fieldLabelEn: 'Date',
      currentValue: row.date || '-',
      reasonAr: 'التاريخ حقل أساسي مطلوب لكل سجل إنتاج ولا يمكن استيراد السجل بدونه.', reasonEn: 'Date is a required field for every production record and the row cannot be imported without it.',
      suggestedSolutionAr: 'أدخل تاريخًا صالحًا يدويًا.', suggestedSolutionEn: 'Enter a valid date manually.',
      overridable: false, actions: REQUIRED_FIELD_ACTIONS,
    };
  }
  if (errorMessage.startsWith('العميل "') || errorMessage.startsWith('Customer "')) {
    return {
      type: 'UNKNOWN_MASTER_DATA_CODE', field: 'customerNameRaw', fieldLabelAr: 'العميل', fieldLabelEn: 'Customer',
      currentValue: row.customerNameRaw || '-',
      reasonAr: 'لا يوجد عميل مطابق لهذا الاسم في البيانات الرئيسية.', reasonEn: 'No matching customer exists in Master Data for this name.',
      suggestedSolutionAr: 'اختيار عميل موجود أو إضافة عميل جديد.', suggestedSolutionEn: 'Select an existing customer or add a new one.',
      overridable, actions: MASTER_DATA_ACTIONS,
    };
  }
  if (errorMessage.includes('نوع الطاحونة مفقود') || errorMessage.includes('Mill Type is missing')) {
    return {
      type: 'MISSING_REQUIRED_FIELD', field: 'millTypeRaw', fieldLabelAr: 'نوع الطاحونة', fieldLabelEn: 'Mill Type',
      currentValue: row.millTypeRaw || '-',
      reasonAr: 'نوع الطاحونة حقل أساسي مطلوب - لا يمكن معرفة الآلة المنتجة بدونه.', reasonEn: 'Mill Type is a required field - which machine produced this record cannot be known without it.',
      suggestedSolutionAr: 'أدخل نوع الطاحونة يدويًا.', suggestedSolutionEn: 'Enter the Mill Type manually.',
      overridable: false, actions: REQUIRED_FIELD_ACTIONS,
    };
  }
  if (errorMessage.includes('تعذر التحقق من نوع الطاحونة') || errorMessage.includes('Could not verify Mill Type')) {
    return {
      type: 'OTHER_VALIDATION_ERROR', field: 'millTypeRaw', fieldLabelAr: 'نوع الطاحونة', fieldLabelEn: 'Mill Type',
      currentValue: row.millTypeRaw || '-',
      reasonAr: 'تعذر التحقق من نوع الطاحونة لأن البيانات الأساسية للطواحين غير متاحة حاليًا (مشكلة صلاحيات مؤقتة، وليست خطأ في السجل نفسه).', reasonEn: 'Mill Type could not be verified because Chinese Mills Master Data is currently unavailable (a temporary permission issue, not an error in the record itself).',
      suggestedSolutionAr: 'أعد المحاولة لاحقًا، أو اعتمد السجل إذا كنت متأكدًا من صحة القيمة.', suggestedSolutionEn: 'Retry later, or approve the record if you are confident the value is correct.',
      overridable, actions: MASTER_DATA_ACTIONS,
    };
  }
  if (errorMessage.startsWith('نوع الطاحونة "') || errorMessage.startsWith('Mill Type "')) {
    return {
      type: 'UNKNOWN_MASTER_DATA_CODE', field: 'millTypeRaw', fieldLabelAr: 'نوع الطاحونة', fieldLabelEn: 'Mill Type',
      currentValue: row.millTypeRaw || '-',
      reasonAr: 'لا يوجد نوع طاحونة مطابق لهذه القيمة في البيانات الرئيسية.', reasonEn: 'No matching Mill Type exists in Master Data for this value.',
      suggestedSolutionAr: 'اختيار نوع طاحونة موجود أو إضافة نوع جديد.', suggestedSolutionEn: 'Select an existing Mill Type or add a new one.',
      overridable, actions: MASTER_DATA_ACTIONS,
    };
  }
  if (errorMessage.includes('رقم الوردية') && (errorMessage.includes('غير صالح') || errorMessage.includes('is invalid'))) {
    return {
      type: 'INVALID_FORMAT', field: 'shiftRaw', fieldLabelAr: 'الوردية', fieldLabelEn: 'Shift',
      currentValue: String(row.shiftRaw ?? '-'),
      reasonAr: 'الورديات المسموح بها فقط 1 أو 2 أو 3.', reasonEn: 'Only shifts 1, 2, or 3 are allowed.',
      suggestedSolutionAr: 'أدخل رقم وردية صالح (1، 2، أو 3).', suggestedSolutionEn: 'Enter a valid shift number (1, 2, or 3).',
      overridable: false, actions: REQUIRED_FIELD_ACTIONS,
    };
  }
  if (errorMessage.includes('كمية الإنتاج مفقودة') || errorMessage.includes('Production Quantity is missing')) {
    return {
      type: 'MISSING_REQUIRED_FIELD', field: 'productionQuantity', fieldLabelAr: 'كمية الإنتاج', fieldLabelEn: 'Production Quantity',
      currentValue: String(row.productionQuantity ?? '-'),
      reasonAr: 'كمية الإنتاج هي المقياس الأساسي للسجل ويجب أن تكون رقمًا موجبًا.', reasonEn: 'Production Quantity is the record\'s core metric and must be a positive number.',
      suggestedSolutionAr: 'أدخل كمية إنتاج صحيحة أكبر من صفر.', suggestedSolutionEn: 'Enter a valid Production Quantity greater than zero.',
      overridable: false, actions: REQUIRED_FIELD_ACTIONS,
    };
  }
  if (errorMessage.startsWith('كود المواصفة "') || errorMessage.startsWith('Specification Code "')) {
    return {
      type: 'UNKNOWN_MASTER_DATA_CODE', field: 'specificationCodeRaw', fieldLabelAr: 'كود المواصفة', fieldLabelEn: 'Specification Code',
      currentValue: row.specificationCodeRaw || '-',
      reasonAr: 'لا يوجد منتج مطابق لهذا الكود في البيانات الرئيسية للمنتجات.', reasonEn: 'No matching product exists in Product Master Data for this code.',
      suggestedSolutionAr: 'اختيار منتج موجود أو تصحيح الكود.', suggestedSolutionEn: 'Select an existing product or correct the code.',
      overridable, actions: MASTER_DATA_ACTIONS,
    };
  }
  if (errorMessage.startsWith('نوع العطل "') || errorMessage.startsWith('Fault Type "')) {
    return {
      type: 'MISSING_OPTIONAL_FIELD', field: 'faultTypeRaw', fieldLabelAr: 'نوع العطل', fieldLabelEn: 'Fault Type',
      currentValue: row.faultTypeRaw || '-',
      reasonAr: 'لا يوجد نوع عطل مطابق لهذه القيمة في البيانات الرئيسية - حقل اختياري.', reasonEn: 'No matching Fault Type exists in Master Data for this value - an optional field.',
      suggestedSolutionAr: 'اختيار نوع عطل موجود، تصحيح القيمة، أو حذفها لأنها اختيارية.', suggestedSolutionEn: 'Select an existing Fault Type, correct the value, or clear it since it is optional.',
      overridable, actions: [...MASTER_DATA_ACTIONS],
    };
  }
  if (errorMessage.includes('صف مكرر داخل نفس الملف') || errorMessage.includes('Duplicate row within the same file')) {
    return {
      type: 'DUPLICATE_MATCH', field: 'date', fieldLabelAr: 'صف مكرر', fieldLabelEn: 'Duplicate Row',
      currentValue: `${row.date} / ${row.millTypeRaw} / ${row.shiftRaw}`,
      reasonAr: 'يوجد صف آخر بنفس التاريخ والطاحونة والوردية والعميل داخل نفس الملف - استيراد الاثنين يكرر نفس الإنتاج الفعلي.', reasonEn: 'Another row with the same date, mill, shift, and customer exists in this same file - importing both would double-count the same real production.',
      suggestedSolutionAr: 'راجع الملف الأصلي وتأكد أي صف هو الصحيح، ثم استبعد أو تخطَّ الآخر.', suggestedSolutionEn: 'Review the source file to confirm which row is correct, then exclude or skip the other.',
      overridable: false, actions: ['EXCLUDE', 'SKIP', 'REVALIDATE'],
    };
  }
  const optionalNumericMatch = errorMessage.match(/^"(.+)" (?:غير رقمية|is not numeric)\.?$/);
  if (optionalNumericMatch) {
    return {
      type: 'INVALID_FORMAT', field: 'optionalNumeric', fieldLabelAr: optionalNumericMatch[1], fieldLabelEn: optionalNumericMatch[1],
      currentValue: '-',
      reasonAr: 'القيمة المدخلة غير رقمية - حقل اختياري، يُعامل كصفر ما لم يُصحَّح.', reasonEn: 'The entered value is not numeric - an optional field, treated as zero unless corrected.',
      suggestedSolutionAr: 'صحّح القيمة يدويًا أو اتركها فارغة.', suggestedSolutionEn: 'Correct the value manually, or leave it blank.',
      overridable, actions: ['MANUAL_FIX', 'APPROVE', 'EXCLUDE', 'SKIP', 'REVALIDATE'],
    };
  }

  return {
    type: 'OTHER_VALIDATION_ERROR', field: 'other', fieldLabelAr: 'أخرى', fieldLabelEn: 'Other',
    currentValue: '-',
    reasonAr: errorMessage, reasonEn: errorMessage,
    suggestedSolutionAr: 'راجع السجل يدويًا.', suggestedSolutionEn: 'Review the record manually.',
    overridable, actions: overridable ? MASTER_DATA_ACTIONS : REQUIRED_FIELD_ACTIONS,
  };
}

/** All structured explanations for a row's current errors, in order (§20: multiple problems in one row). */
export function explainChineseMillsRowErrors(row: ChineseMillsImportRow): ChineseMillsErrorExplanation[] {
  return row.errors.map((e) => explainChineseMillsRowError(row, e));
}

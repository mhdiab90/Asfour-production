/**
 * Phase 4F - pure, Firebase-free duplicate-identity/fingerprint helpers for
 * Pressing Historical Import.
 *
 * The composite key (date + shift + press + product + customer order +
 * worker1 + furnace cars) already existed, duplicated verbatim in two
 * places inside pressingHistoricalImportService.ts's
 * parseAndValidatePressingExcel(): once to build the in-database key Set
 * from existing Firestore documents, once to build each parsed row's own
 * key. This file extracts that SAME logic (byte-identical field
 * selection/fallback order and the same lowercase `#`-joined shape) into
 * one shared, directly unit-testable function - reused by BOTH the
 * existing parse-time check (refactored to call it, not reimplemented)
 * and the new Phase 4F final live pre-write recheck
 * (recheckPressingDatabaseDuplicates, in pressingHistoricalImportService.ts),
 * so the two can never silently drift apart.
 *
 * No business identity was invented here - every field and fallback order
 * below is copied verbatim from the pre-existing code (see that file's
 * git history / the Phase 4F audit), not guessed.
 */
import { ProductionRecord, PressingImportRow } from '../types';
import { toWesternDigits } from '../utils/formatters';

export interface PressingDuplicateIdentityFields {
  date: string;
  shiftKeyPart: string;
  pressKeyPart: string;
  productKeyPart: string;
  customerOrder: string;
  worker1KeyPart: string;
  furnaceCarNumbers: string[];
}

/** The exact composite-key shape both the parse-time check and the final live recheck use: date#shift#press#product#order#worker1#cars, lowercased. */
export function buildPressingDuplicateKey(fields: PressingDuplicateIdentityFields): string {
  const cars = [...(fields.furnaceCarNumbers || [])].sort().join('-');
  return `${fields.date}#${fields.shiftKeyPart}#${fields.pressKeyPart}#${fields.productKeyPart}#${fields.customerOrder}#${fields.worker1KeyPart}#${cars}`.toLowerCase();
}

/**
 * Builds the identity fields for an ALREADY-PARSED import row (post Master
 * Data resolution) - same fallback order as the original inline code:
 * resolved code first, then the raw uploaded value. `shiftRaw` is
 * `string | number` on PressingImportRow (an Excel cell can parse as
 * either) - normalized via the exact same `toWesternDigits(String(...)).trim()`
 * the original inline code applied (as `shiftStr`) before it ever reached
 * the composite key, so this stays byte-identical to the pre-existing
 * behavior.
 */
export function pressingIdentityFromRow(row: PressingImportRow): PressingDuplicateIdentityFields {
  return {
    date: row.date || '',
    shiftKeyPart: row.resolvedShift?.code || toWesternDigits(String(row.shiftRaw ?? '')).trim() || '',
    pressKeyPart: row.resolvedPress?.code || row.pressRaw || '',
    productKeyPart: row.resolvedProduct?.code || row.productCodeRaw || '',
    customerOrder: row.customerOrder || '',
    worker1KeyPart: row.resolvedWorker1?.code || row.worker1Code || row.worker1Name || '',
    furnaceCarNumbers: row.furnaceCarNumbers || [],
  };
}

/** Builds the identity fields for an EXISTING Firestore production document - same fallback order as the original inline code: code, then name, then id. */
export function pressingIdentityFromFirestoreDoc(d: Partial<ProductionRecord>): PressingDuplicateIdentityFields {
  return {
    date: d.date || '',
    shiftKeyPart: d.shiftCode || d.shiftName || d.shiftId || '',
    pressKeyPart: d.pressCode || d.pressName || d.pressId || '',
    productKeyPart: d.productCode || d.productId || '',
    customerOrder: d.customerOrderNumber || '',
    worker1KeyPart: d.employeeCodes?.[0] || d.employeeNames?.[0] || d.employeeId || '',
    furnaceCarNumbers: d.furnaceCarNumbers || [],
  };
}

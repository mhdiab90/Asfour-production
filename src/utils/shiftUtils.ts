/**
 * Centralized Shift validation/normalization (§1-4). The factory operates
 * THREE shifts - 1, 2, 3 - all equally valid. This is the ONE place that
 * enumerates valid shift numbers; every call site (historical import,
 * DataImportView's full-row editor/bulk repair, Production Entry) reads from
 * here instead of re-declaring its own "1 or 2" assumption.
 */
import { toWesternDigits } from './formatters';

export const VALID_SHIFT_NUMBERS: readonly number[] = [1, 2, 3];

const SHIFT_NAME_AR: Record<number, string> = { 1: 'الأولى', 2: 'الثانية', 3: 'الثالثة' };
const SHIFT_NAME_EN: Record<number, string> = { 1: 'First', 2: 'Second', 3: 'Third' };

export function isValidShiftNumber(num: number | null | undefined): num is 1 | 2 | 3 {
  return num !== null && num !== undefined && VALID_SHIFT_NUMBERS.includes(num);
}

/**
 * Parses a raw imported/entered value into a shift number. Mirrors the
 * EXACT matching strategy the historical importer already used for shifts 1
 * and 2 (exact match, substring match, Arabic ordinal word, English ordinal
 * word) - only extended with an equivalent branch for shift 3 - so existing
 * data that already parsed correctly continues to parse identically.
 */
export function parseShiftNumber(rawValue: any): 1 | 2 | 3 | null {
  const str = toWesternDigits(String(rawValue ?? '')).trim();
  if (!str) return null;
  if (str === '1' || str.includes('1') || str.includes('الأولى') || str.toLowerCase().includes('first')) return 1;
  if (str === '2' || str.includes('2') || str.includes('الثانية') || str.toLowerCase().includes('second')) return 2;
  if (str === '3' || str.includes('3') || str.includes('الثالثة') || str.toLowerCase().includes('third')) return 3;
  return null;
}

export function buildShiftDisplayName(num: 1 | 2 | 3, language: 'ar' | 'en' = 'ar'): string {
  return language === 'ar' ? `الوردية ${SHIFT_NAME_AR[num]}` : `${SHIFT_NAME_EN[num]} Shift`;
}

export function buildShiftCode(num: 1 | 2 | 3): string {
  return `SHIFT-${num}`;
}

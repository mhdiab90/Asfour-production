/**
 * Centralized formatting helpers enforcing WESTERN ARABIC NUMERALS (0-9)
 * Guarantees that Eastern Arabic-Indic digits (٠-٩) are never displayed in the UI.
 * Supports Firestore Timestamp, Date, ISO strings, timestamps, null, and undefined.
 */

export type DateInput = Date | string | number | { toDate?: () => Date; seconds?: number } | null | undefined;

const EASTERN_TO_WESTERN_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * Replaces any Eastern Arabic-Indic numerals with standard Western digits (0-9)
 */
export function toWesternDigits(str: string | number | null | undefined): string {
  if (str === null || str === undefined) return '';
  const s = String(str);
  return s.replace(/[٠-٩۰-۹]/g, (char) => EASTERN_TO_WESTERN_MAP[char] || char);
}

/**
 * Safely parse any date representation into a valid JS Date or null
 */
export function parseSafeDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;

  try {
    // Firestore Timestamp with .toDate()
    if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
      return value.toDate();
    }
    // Firestore Timestamp raw object with seconds
    if (typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') {
      return new Date(value.seconds * 1000);
    }
    // Date instance
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? null : value;
    }
    // Number timestamp
    if (typeof value === 'number') {
      const d = new Date(value);
      return isNaN(d.getTime()) ? null : d;
    }
    // String (ISO or standard)
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      // Convert any eastern digits before parsing
      const normalized = toWesternDigits(trimmed);
      const d = new Date(normalized);
      return isNaN(d.getTime()) ? null : d;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Formats a date and time with Western digits (DD/MM/YYYY HH:MM)
 */
export function formatDateTime(value: DateInput, fallback: string = '-'): string {
  const date = parseSafeDate(value);
  if (!date) return fallback;

  try {
    const formatted = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
    return toWesternDigits(formatted);
  } catch {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }
}

/**
 * Formats only the date portion with Western digits (YYYY/MM/DD)
 */
export function formatDate(value: DateInput, fallback: string = '-'): string {
  const date = parseSafeDate(value);
  if (!date) return fallback;

  try {
    const formatted = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    return toWesternDigits(formatted);
  } catch {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${year}/${month}/${day}`;
  }
}

/**
 * Formats only the time portion with Western digits (HH:MM AM/PM)
 */
export function formatTime(value: DateInput, fallback: string = '-'): string {
  const date = parseSafeDate(value);
  if (!date) return fallback;

  try {
    const formatted = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(date);
    return toWesternDigits(formatted);
  } catch {
    return date.toTimeString().substring(0, 5);
  }
}

/**
 * Formats number with Western digits (0-9) and thousand separators (e.g. 125,000)
 */
export function formatNumber(
  value: number | string | null | undefined, 
  fallback: string = '0',
  useGrouping: boolean = true
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const cleanVal = typeof value === 'string' ? toWesternDigits(value).replace(/,/g, '') : value;
  const num = typeof cleanVal === 'number' ? cleanVal : Number(cleanVal);
  if (isNaN(num)) return fallback;

  try {
    const formatted = new Intl.NumberFormat('en-US', {
      useGrouping,
      maximumFractionDigits: 2,
    }).format(num);
    return toWesternDigits(formatted);
  } catch {
    return toWesternDigits(String(num));
  }
}

/**
 * Formats integer with Western digits
 */
export function formatInteger(value: number | string | null | undefined, fallback: string = '0'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const cleanVal = typeof value === 'string' ? toWesternDigits(value).replace(/,/g, '') : value;
  const num = typeof cleanVal === 'number' ? Math.round(cleanVal) : Math.round(Number(cleanVal));
  if (isNaN(num)) return fallback;

  try {
    return new Intl.NumberFormat('en-US', { useGrouping: true, maximumFractionDigits: 0 }).format(num);
  } catch {
    return String(num);
  }
}

/**
 * Formats decimal with fixed decimal places and Western digits (e.g. 4.50)
 */
export function formatDecimal(
  value: number | string | null | undefined, 
  decimals: number = 2, 
  fallback: string = '0.00'
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const cleanVal = typeof value === 'string' ? toWesternDigits(value).replace(/,/g, '') : value;
  const num = typeof cleanVal === 'number' ? cleanVal : Number(cleanVal);
  if (isNaN(num)) return fallback;

  return num.toFixed(decimals);
}

/**
 * Formats percentage with Western digits (e.g. 4.00%)
 */
export function formatPercentage(
  value: number | string | null | undefined, 
  decimals: number = 1, 
  fallback: string = '0%'
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const cleanVal = typeof value === 'string' ? toWesternDigits(value).replace(/%/g, '') : value;
  const num = typeof cleanVal === 'number' ? cleanVal : Number(cleanVal);
  if (isNaN(num)) return fallback;

  return `${num.toFixed(decimals)}%`;
}

/**
 * Formats currency in Egyptian Pounds with Western digits
 */
export function formatCurrency(
  value: number | string | null | undefined, 
  currency: string = 'ج.م', 
  fallback: string = '0 ج.م'
): string {
  if (value === null || value === undefined || value === '') return fallback;
  const num = formatNumber(value, '0');
  return `${num} ${currency}`;
}

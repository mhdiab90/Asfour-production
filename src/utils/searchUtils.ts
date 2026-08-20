/**
 * Search Normalization and Fuzzy Matching Utilities
 * 
 * Provides unified normalization for Arabic/English search text, codes, and names.
 * Ensures case-insensitivity, whitespace normalization, Arabic diacritic/letter folding,
 * and Western numeral normalization across all search components and Firestore records.
 */
import { toWesternDigits } from './formatters';
import { MasterDataTab } from '../types';

/**
 * Normalizes general search text:
 * - Trims whitespace
 * - Converts Eastern Arabic-Indic numerals (٠-٩) to Western (0-9)
 * - Lowercases Latin characters
 * - Normalizes Arabic letters (أ/إ/آ -> ا, ة -> ه, ى -> ي)
 * - Collapses consecutive whitespace to a single space
 */
export function normalizeSearchText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let str = toWesternDigits(String(value)).trim().toLowerCase();
  if (!str) return '';

  // Arabic letter normalization for resilient search
  str = str
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\u064B-\u065F]/g, ''); // Remove tashkeel / diacritics

  // Collapse multiple whitespaces
  str = str.replace(/\s+/g, ' ');

  return str;
}

/**
 * Normalizes entity code strings:
 * - Trims whitespace
 * - Converts Eastern Arabic-Indic numerals to Western
 * - Uppercases Latin characters
 * - Strips or collapses internal spaces
 */
export function normalizeCode(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const str = toWesternDigits(String(value)).trim().toUpperCase();
  return str.replace(/\s+/g, '');
}

/**
 * Normalizes human-readable names:
 * - Trims whitespace
 * - Lowercases Latin characters
 * - Normalizes Arabic characters
 * - Collapses repeated spaces
 */
export function normalizeName(value: string | null | undefined): string {
  return normalizeSearchText(value);
}

/**
 * Checks if a search query matches a given target text (or code)
 */
export function matchesSearch(targetText: string | number | null | undefined, searchQuery: string): boolean {
  if (!searchQuery) return true;
  if (targetText === null || targetText === undefined) return false;

  const normTarget = normalizeSearchText(targetText);
  const normQuery = normalizeSearchText(searchQuery);

  // Direct substring check
  if (normTarget.includes(normQuery)) return true;

  // Also check code match (without space)
  const normTargetCode = normalizeCode(targetText);
  const normQueryCode = normalizeCode(searchQuery);
  if (normQueryCode && normTargetCode.includes(normQueryCode)) return true;

  return false;
}

/**
 * Adds normalized search index fields to Master Data objects before saving to Firestore
 */
export function enrichWithNormalizedFields(
  tab: MasterDataTab,
  raw: Record<string, any>
): Record<string, any> {
  const result: Record<string, any> = { ...raw };

  const codeVal = raw.code || raw.productCode || raw.prefixCode || raw.carNumber || '';
  const nameVal = raw.name || raw.productName || raw.nameAr || raw.nameEn || '';

  // Common fields
  if (codeVal) {
    result.codeNormalized = normalizeCode(codeVal);
  }
  if (nameVal) {
    result.nameNormalized = normalizeName(nameVal);
  }

  // Entity-specific fields
  switch (tab) {
    case 'employees':
      if (raw.code || raw.employeeCode) {
        result.employeeCodeNormalized = normalizeCode(raw.code || raw.employeeCode);
      }
      if (raw.name || raw.employeeName) {
        result.nameNormalized = normalizeName(raw.name || raw.employeeName);
      }
      break;

    case 'products':
      if (raw.code || raw.productCode) {
        result.productCodeNormalized = normalizeCode(raw.code || raw.productCode);
      }
      if (raw.name || raw.productName) {
        result.nameNormalized = normalizeName(raw.name || raw.productName);
      }
      if (raw.productTypePrefix) {
        result.productTypePrefixNormalized = normalizeCode(raw.productTypePrefix);
      }
      if (raw.productTypeName || raw.productTypeNameAr) {
        result.productTypeNameNormalized = normalizeName(raw.productTypeName || raw.productTypeNameAr);
      }
      break;

    case 'customers':
      if (raw.code || raw.customerCode) {
        result.customerCodeNormalized = normalizeCode(raw.code || raw.customerCode);
      }
      if (raw.name || raw.customerName || raw.company) {
        result.nameNormalized = normalizeName(raw.name || raw.customerName || raw.company);
      }
      break;

    case 'presses':
      if (raw.code || raw.pressCode) {
        result.pressCodeNormalized = normalizeCode(raw.code || raw.pressCode);
      }
      if (raw.name || raw.pressName) {
        result.nameNormalized = normalizeName(raw.name || raw.pressName);
      }
      break;

    case 'furnaces':
      if (raw.code || raw.furnaceCode) {
        result.furnaceCodeNormalized = normalizeCode(raw.code || raw.furnaceCode);
      }
      if (raw.name || raw.furnaceName) {
        result.nameNormalized = normalizeName(raw.name || raw.furnaceName);
      }
      break;

    case 'furnaceCars':
      if (raw.code || raw.carCode) {
        result.carCodeNormalized = normalizeCode(raw.code || raw.carCode);
      }
      if (raw.carNumber) {
        result.carNumberNormalized = normalizeCode(raw.carNumber);
      }
      break;

    case 'departments':
      if (raw.code || raw.departmentCode) {
        result.departmentCodeNormalized = normalizeCode(raw.code || raw.departmentCode);
      }
      if (raw.name || raw.departmentName) {
        result.nameNormalized = normalizeName(raw.name || raw.departmentName);
      }
      break;

    case 'shifts':
      if (raw.code || raw.shiftCode) {
        result.shiftCodeNormalized = normalizeCode(raw.code || raw.shiftCode);
      }
      if (raw.name || raw.shiftName) {
        result.nameNormalized = normalizeName(raw.name || raw.shiftName);
      }
      break;

    case 'productTypes':
      if (raw.prefixCode) {
        result.prefixCodeNormalized = normalizeCode(raw.prefixCode);
      }
      if (raw.nameAr || raw.nameEn) {
        result.nameNormalized = normalizeName(raw.nameAr || raw.nameEn);
      }
      break;
  }

  return result;
}

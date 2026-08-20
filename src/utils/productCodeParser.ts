/**
 * Product Code Intelligence & Automatic Classification Parser
 * 
 * Implements strict, resilient classification rules:
 * - CASE A: SMART ALPHABETIC CODE (Chars 1..3: Alphabetic A-Z, Chars 4..5: Numeric Alumina %, Prefix in productTypes)
 *           -> status: 'SMART_CODE', auto-derive Type, Prefix, Alumina %, Identifier.
 * - CASE B: ALPHABETIC CODE WITH UNKNOWN PREFIX (Chars 1..3: Alphabetic A-Z, Chars 4..5: Numeric, Prefix NOT in productTypes)
 *           -> status: 'UNKNOWN_PREFIX', Prefix & Alumina derived, Type is Manual/Empty. Do NOT block save.
 * - CASE C: CODE STARTS WITH A DIGIT / NUMBER (e.g. 123456789, 25000125, 00123456)
 *           -> status: 'MANUAL_PRODUCT_CODE', NEVER derive Alumina %, Prefix, Type, or Identifier.
 *              Alumina remains NULL / Empty unless explicitly entered by Admin.
 * - CASE D: COMPLETELY CUSTOM CODE (e.g. CUSTOM-001, BRICK-A-25, TESTPRODUCT)
 *           -> status: 'MANUAL_PRODUCT_CODE', Manual entry allowed, no derived fields.
 * - INVALID SMART FORMAT: Starts with 3 letters but non-numeric alumina segment
 *           -> status: 'INVALID_FORMAT', Manual entry allowed.
 * 
 * IMPORTANT:
 * Smart parsing is strictly an OPTIONAL helper and NEVER a blocking gate.
 */
import { ProductType, ProductCodeParseResult } from '../types';
import { getCachedProductTypes } from '../services/productTypeService';
import { toWesternDigits } from './formatters';

/**
 * Normalizes user input product code by trimming accidental spaces,
 * converting Eastern digits to Western digits, and converting to uppercase.
 */
export function normalizeProductCode(rawCode: string | null | undefined): string {
  if (!rawCode) return '';
  const converted = toWesternDigits(String(rawCode)).trim();
  return converted.replace(/\s+/g, '').toUpperCase();
}

/**
 * Parses a raw Product Code against the active Product Type dictionary.
 * 
 * @param rawCode Raw code string entered or imported (e.g. "BAR250102305", "123456789", "XYZ25123456", "CUSTOM-001")
 * @param availableTypes Optional custom list of ProductTypes to match against (defaults to cached list)
 */
export function parseProductCode(
  rawCode: string | null | undefined,
  availableTypes?: ProductType[]
): ProductCodeParseResult {
  const normalized = normalizeProductCode(rawCode);
  const typesList = (availableTypes && availableTypes.length > 0) 
    ? availableTypes 
    : getCachedProductTypes();

  const emptyResult: ProductCodeParseResult = {
    rawCode: rawCode || '',
    normalizedCode: normalized,
    status: 'MANUAL_PRODUCT_CODE',
    smartParseStatus: 'MANUAL_PRODUCT_CODE',
    isValid: false,
    isSmart: false,
    prefix: '',
    isUnknownPrefix: false,
    isInvalidAlumina: false,
    isNumericStart: false,
    productIdentifier: '',
    statusMessage: 'كود يدوي مخصص (MANUAL CODE) — يمكنك إدخال نوع المنتج ونسبة الألومينا يدوياً.',
  };

  if (!normalized) {
    return emptyResult;
  }

  // =========================================================================
  // RULE C: IF THE PRODUCT CODE STARTS WITH A DIGIT / NUMBER (0-9)
  // Examples: 123456789, 25000125, 00123456, 25001234
  // CRITICAL: NEVER calculate or assume Alumina % from first 2 digits!
  // =========================================================================
  if (/^\d/.test(normalized)) {
    return {
      rawCode: rawCode || '',
      normalizedCode: normalized,
      status: 'MANUAL_PRODUCT_CODE',
      smartParseStatus: 'MANUAL_PRODUCT_CODE',
      isValid: false,
      isSmart: false,
      prefix: '',
      productType: undefined,
      isUnknownPrefix: false,
      aluminaPercentage: undefined, // MUST REMAIN UNDEFINED / NULL
      isInvalidAlumina: false,
      isNumericStart: true,
      productIdentifier: '',
      statusMessage: 'كود رقمي يدوي (MANUAL CODE) — التصنيف الذكي غير منطبق. أدخل نوع المنتج ونسبة الألومينا يدوياً إن وجدت.',
    };
  }

  // Check if code has minimum length of 5 for smart parsing (3 prefix + 2 alumina)
  if (normalized.length < 5) {
    return {
      rawCode: rawCode || '',
      normalizedCode: normalized,
      status: 'MANUAL_PRODUCT_CODE',
      smartParseStatus: 'MANUAL_PRODUCT_CODE',
      isValid: false,
      isSmart: false,
      prefix: '',
      productType: undefined,
      isUnknownPrefix: false,
      aluminaPercentage: undefined,
      isInvalidAlumina: false,
      isNumericStart: false,
      productIdentifier: '',
      statusMessage: 'كود يدوي مخصص (MANUAL CODE) — الإدخال اليدوي متاح.',
    };
  }

  // Extract candidate prefix (first 3 chars) and alumina candidate (chars 4 and 5)
  const prefixCandidate = normalized.substring(0, 3);
  const aluminaSegment = normalized.substring(3, 5);
  const isPrefixStrictAlpha = /^[A-Z]{3}$/.test(prefixCandidate);
  const isAluminaNumeric = /^\d{2}$/.test(aluminaSegment);

  // If first 3 chars are NOT strict alphabetic letters (A-Z) -> Custom / Manual Code
  if (!isPrefixStrictAlpha) {
    return {
      rawCode: rawCode || '',
      normalizedCode: normalized,
      status: 'MANUAL_PRODUCT_CODE',
      smartParseStatus: 'MANUAL_PRODUCT_CODE',
      isValid: false,
      isSmart: false,
      prefix: '',
      productType: undefined,
      isUnknownPrefix: false,
      aluminaPercentage: undefined,
      isInvalidAlumina: false,
      isNumericStart: false,
      productIdentifier: '',
      statusMessage: 'كود يدوي مخصص (MANUAL CODE) — الإدخال اليدوي متاح.',
    };
  }

  // If first 3 chars ARE alphabetic, but chars 4..5 are NOT numeric (e.g. BAR9X123 or BARABC)
  if (!isAluminaNumeric) {
    return {
      rawCode: rawCode || '',
      normalizedCode: normalized,
      status: 'INVALID_FORMAT',
      smartParseStatus: 'INVALID_FORMAT',
      isValid: false,
      isSmart: false,
      prefix: prefixCandidate,
      productType: undefined,
      isUnknownPrefix: false,
      aluminaPercentage: undefined,
      isInvalidAlumina: true,
      isNumericStart: false,
      productIdentifier: '',
      statusMessage: 'تنسيق ذكي غير صالح (INVALID SMART FORMAT) — الإدخال اليدوي متاح بالكامل.',
    };
  }

  // Valid numeric alumina percentage (0-100)
  const parsedAlumina = parseInt(aluminaSegment, 10);
  const productIdentifier = normalized.substring(5);

  // Lookup prefix in productTypes master (case-insensitive)
  const matchedType = typesList.find(
    (t) => t.prefixCode && t.prefixCode.toUpperCase() === prefixCandidate.toUpperCase()
  );

  // =========================================================================
  // CASE A: SMART ALPHABETIC CODE RECOGNIZED (e.g. BAR250102305)
  // =========================================================================
  if (matchedType) {
    let suggestedNameAr: string | undefined = undefined;
    let suggestedNameEn: string | undefined = undefined;
    const identText = productIdentifier ? ` - ${productIdentifier}` : '';
    suggestedNameAr = `${matchedType.nameAr || matchedType.nameEn} ${parsedAlumina}% ألومينا${identText}`;
    suggestedNameEn = `${matchedType.nameEn} ${parsedAlumina}% Alumina${identText}`;

    return {
      rawCode: rawCode || '',
      normalizedCode: normalized,
      status: 'SMART_CODE',
      smartParseStatus: 'SMART_CODE',
      isValid: true,
      isSmart: true,
      prefix: prefixCandidate,
      productType: matchedType,
      isUnknownPrefix: false,
      aluminaPercentage: parsedAlumina,
      isInvalidAlumina: false,
      isNumericStart: false,
      productIdentifier,
      statusMessage: 'كود ذكي معتمد (SMART CODE DETECTED) — تم استخراج التصنيف ونسبة الألومينا تلقائياً.',
      suggestedNameAr,
      suggestedNameEn,
    };
  }

  // =========================================================================
  // CASE B: ALPHABETIC CODE WITH UNKNOWN PREFIX (e.g. XYZ25123456)
  // =========================================================================
  return {
    rawCode: rawCode || '',
    normalizedCode: normalized,
    status: 'UNKNOWN_PREFIX',
    smartParseStatus: 'UNKNOWN_PREFIX',
    isValid: false,
    isSmart: false,
    prefix: prefixCandidate,
    productType: undefined,
    isUnknownPrefix: true,
    aluminaPercentage: parsedAlumina,
    isInvalidAlumina: false,
    isNumericStart: false,
    productIdentifier,
    statusMessage: `بادئة منتج غير مسجلة (UNKNOWN PRODUCT PREFIX: ${prefixCandidate}) — يمكنك حفظ المنتج أو إضافة نوع المنتج.`,
  };
}

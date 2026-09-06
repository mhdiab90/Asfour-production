/**
 * Shared i18n primitive types, split out from LanguageContext.tsx so
 * translationOverrideService.ts (which LanguageContext.tsx itself imports,
 * to layer admin overrides on top of the static dictionaries) can depend on
 * `Language` without creating a circular module dependency.
 */
export type Language = 'ar' | 'en';
export type Direction = 'rtl' | 'ltr';

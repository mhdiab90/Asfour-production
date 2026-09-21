/**
 * Product Type initial seed list + the pure "what's missing" computation.
 *
 * Deliberately Firebase-free (no import of ../config/firebase) so
 * computeMissingSeedDocuments can be unit-tested with plain in-memory sets
 * via `npx tsx`, without needing a Firestore connection or Vite's
 * `import.meta.env` - see scripts/tests/. productTypeService.ts imports and
 * re-exports both of these so no existing call site needs to change.
 */
import { ProductType } from '../types';

export const INITIAL_PRODUCT_TYPES: Omit<ProductType, 'id'>[] = [
  { prefixCode: 'BAR', nameEn: 'Bricks Acid Resistance', nameAr: 'طوب مقاوم للأحماض', active: true },
  { prefixCode: 'BC2', nameEn: 'Ball Clay', nameAr: 'طين كروي BC2', active: true },
  { prefixCode: 'BC3', nameEn: 'Ball Clay Type B (Bulk)', nameAr: 'طين كروي صب BC3', active: true },
  { prefixCode: 'BCB', nameEn: 'Bricks Chemical Bond', nameAr: 'طوب بروابط كيميائية BCB', active: true },
  { prefixCode: 'BCM', nameEn: 'Bricks Chemical Bond', nameAr: 'طوب بروابط كيميائية BCM', active: true },
  { prefixCode: 'BFC', nameEn: 'Bricks Semi Silica', nameAr: 'طوب نصف سيليكا', active: true },
  { prefixCode: 'BHA', nameEn: 'Bricks High Alumina', nameAr: 'طوب عالي الألومينا BHA', active: true },
  { prefixCode: 'BHS', nameEn: 'Bricks High Alumina', nameAr: 'طوب عالي الألومينا BHS', active: true },
  { prefixCode: 'BLW', nameEn: 'Bricks Lightweight', nameAr: 'طوب خفيف عازل', active: true },
  { prefixCode: 'BMG', nameEn: 'Magnesite Bricks', nameAr: 'مجنزيت', active: true },
  { prefixCode: 'BSI', nameEn: 'Bricks Silicon Carbide', nameAr: 'طوب كربيد السيليكون', active: true },
  { prefixCode: 'CAL', nameEn: 'Calcined Alumina', nameAr: 'ألومينا محروقة', active: true },
  { prefixCode: 'CBA', nameEn: 'Asfour Calcined Bauxite', nameAr: 'بوكسيت عصفور محروق', active: true },
  { prefixCode: 'CBC', nameEn: 'China Calcined Bauxite', nameAr: 'بوكسيت صيني محروق', active: true },
  { prefixCode: 'CHC', nameEn: 'Cordierite Chamotte', nameAr: 'شاموت كورديريت', active: true },
  { prefixCode: 'CHR', nameEn: 'Kaolin', nameAr: 'كاولين', active: true },
  { prefixCode: 'CHS', nameEn: 'Chamotte Sanitaryware', nameAr: 'شاموت أدوات صحية', active: true },
  { prefixCode: 'CLW', nameEn: 'Castable Lightweight', nameAr: 'خرسانة خفيفة عازلة', active: true },
  { prefixCode: 'COC', nameEn: 'Castable Cordierite', nameAr: 'خرسانة كورديريت', active: true },
  { prefixCode: 'FBF', nameEn: 'Bricks Fire Clay', nameAr: 'طوب طيني حراري', active: true },
  { prefixCode: 'FBJ', nameEn: 'Crushed Bricks', nameAr: 'كسر طوب', active: true },
  { prefixCode: 'GPS', nameEn: 'Ref. Gypsum', nameAr: 'جبس حراري', active: true },
  { prefixCode: 'GRA', nameEn: 'Ground Graphite', nameAr: 'جرافيت مطحون', active: true },
  { prefixCode: 'LCC', nameEn: 'Castable LCC', nameAr: 'خرسانة حرارية LCC منخفضة الأسمنت', active: true },
  { prefixCode: 'LCM', nameEn: 'Castable LCM', nameAr: 'خرسانة حرارية LCM متوسطة الأسمنت', active: true },
  { prefixCode: 'LMC', nameEn: 'Castable Cordierite', nameAr: 'خرسانة كورديريت LMC', active: true },
  { prefixCode: 'LWC', nameEn: 'Lightweight Chamotte', nameAr: 'شاموت خفيف الوزن', active: true },
];

/**
 * Given the set of prefixCodes that already exist, compute the documents
 * that still need to be seeded, each with a DETERMINISTIC id derived from
 * its prefixCode (`productTypes/{PREFIX}` instead of a random auto-ID).
 *
 * This is what makes seeding idempotent: two concurrent callers that both
 * read the same "missing" snapshot will compute the SAME target doc ID for
 * the same prefix, so their writes land on the same document instead of
 * creating two documents with the same prefixCode - the exact race that
 * produced the 27 duplicate pairs under the old random-auto-ID scheme.
 * Existing documents (including any already-duplicated ones) are untouched;
 * this only decides where a MISSING prefix would be created.
 */
export function computeMissingSeedDocuments(
  existingPrefixes: Set<string>,
  seedList: Omit<ProductType, 'id'>[] = INITIAL_PRODUCT_TYPES
): Array<{ id: string; data: Record<string, unknown> }> {
  const nowIso = new Date().toISOString();
  const toCreate: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const item of seedList) {
    const normalizedPrefix = item.prefixCode.toUpperCase();
    if (existingPrefixes.has(normalizedPrefix)) continue;
    toCreate.push({
      id: normalizedPrefix,
      data: {
        prefixCode: normalizedPrefix,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        description: `تصنيف تلقائي لنوع المنتج (${item.prefixCode})`,
        active: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    });
  }
  return toCreate;
}

/**
 * Products <-> materials overlap analysis - READ ONLY, deterministic.
 *
 * WHY. ASFOUR keeps `products` and `materials` as separate collections, but one
 * physical item (calcined kaolin, calcined alumina, crushed bricks...) can be
 * bought, produced, used as an ingredient AND sold. Before a single logical
 * Item identity (and a BOM that can point at it) is designed, this finds the
 * records that may be the same item, and says exactly why.
 *
 * WHAT COUNTS AS A MATCH. Only exact equality after the repository's own
 * normalisers - the same `normalizeCode` / `normalizeName` that fill the stored
 * `*CodeNormalized` / `nameNormalized` fields:
 *   code  trimmed, Western digits, uppercase, whitespace removed
 *   name  trimmed, lowercase, Arabic letter variants and diacritics folded,
 *         whitespace collapsed
 * No fuzzy or similarity scoring, no AI, no guessing. "Kaolin" and "Kaolin 40"
 * are different names.
 *
 * WHAT IT NEVER DOES. It writes nothing, merges nothing and mutates no input.
 * Its most confident outcome is CANDIDATE_FOR_MAPPING - a suggestion for a
 * human. There is deliberately no merge action.
 *
 * OUTCOMES (per material):
 *   CODE_AND_NAME_MATCH  exactly one product, same code AND same name
 *   EXACT_CODE_MATCH     exactly one product, same code, different name
 *   EXACT_NAME_MATCH     exactly one product, same name, different code
 *   AMBIGUOUS            more than one candidate, or the candidate product is
 *                        also matched by another material
 *   NO_MATCH             nothing shares its code or name
 * Only CODE_AND_NAME_MATCH is a mapping candidate; every other match needs
 * review, and NO_MATCH keeps the records separate.
 */
import type { ItemKind } from '../types';
import { normalizeCode, normalizeName } from '../utils/searchUtils';
import { resolveItemKind, findProductTypeFor } from './itemClassificationPure';

export type ItemMatchType = 'CODE_AND_NAME_MATCH' | 'EXACT_CODE_MATCH' | 'EXACT_NAME_MATCH' | 'AMBIGUOUS' | 'NO_MATCH';
export type ItemOverlapAction = 'CANDIDATE_FOR_MAPPING' | 'REVIEW' | 'KEEP_SEPARATE';

export interface OverlapMaterialInput {
  id?: string;
  code?: string;
  name?: string;
  itemKind?: unknown;
}

export interface OverlapProductInput {
  id?: string;
  code?: string;
  productCode?: string;
  name?: string;
  productName?: string;
  itemKind?: unknown;
  productTypeId?: string;
  productTypePrefix?: string;
  isMixtureBOM?: boolean;
}

export interface OverlapProductTypeInput {
  id?: string;
  prefixCode?: string;
  itemKind?: unknown;
}

export interface ItemOverlapRow {
  materialId: string;
  materialCode: string;
  materialName: string;
  productId?: string;
  productCode?: string;
  productName?: string;
  matchType: ItemMatchType;
  /** Which signals matched, e.g. ['CODE'] or ['CODE', 'NAME']. Empty for NO_MATCH. */
  matchedOn: Array<'CODE' | 'NAME'>;
  reasonEn: string;
  reasonAr: string;
  recommendedAction: ItemOverlapAction;
  needsReview: boolean;
  materialItemKind: ItemKind | null;
  productItemKind: ItemKind | null;
  /** The product is a mixture definition (isMixtureBOM), not a plain item. */
  productIsMixture?: boolean;
}

export interface ItemOverlapSummary {
  totalProducts: number;
  totalMaterials: number;
  codeAndNameMatches: number;
  exactCodeMatches: number;
  exactNameMatches: number;
  /** Distinct materials with at least one AMBIGUOUS row. */
  ambiguousMaterials: number;
  unmatchedMaterials: number;
  unmatchedProducts: number;
  /** Records without a document id cannot be identified and are left out of matching. */
  skippedWithoutId: number;
}

export interface ItemOverlapReport {
  rows: ItemOverlapRow[];
  unmatchedProducts: Array<{ productId: string; productCode: string; productName: string; productItemKind: ItemKind | null; productIsMixture?: boolean }>;
  summary: ItemOverlapSummary;
}

const productCodeOf = (p: OverlapProductInput) => String(p.code ?? p.productCode ?? '');
const productNameOf = (p: OverlapProductInput) => String(p.name ?? p.productName ?? '');

function indexBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

export function analyzeProductMaterialOverlap(
  materialsIn: readonly OverlapMaterialInput[],
  productsIn: readonly OverlapProductInput[],
  productTypes: readonly OverlapProductTypeInput[] = [],
): ItemOverlapReport {
  const materials = materialsIn.filter((m) => m && m.id);
  const products = productsIn.filter((p) => p && p.id);
  const skippedWithoutId = (materialsIn.length - materials.length) + (productsIn.length - products.length);

  const productsByCode = indexBy(products, (p) => normalizeCode(productCodeOf(p)));
  const productsByName = indexBy(products, (p) => normalizeName(productNameOf(p)));
  const materialsByCode = indexBy(materials, (m) => normalizeCode(m.code));
  const materialsByName = indexBy(materials, (m) => normalizeName(m.name));

  const productKind = (p: OverlapProductInput) => resolveItemKind(p, findProductTypeFor(p, productTypes)).kind;

  /** How many distinct materials match this product on code or name. */
  const materialsMatching = (p: OverlapProductInput): number => {
    const ids = new Set<string>();
    for (const m of materialsByCode.get(normalizeCode(productCodeOf(p))) ?? []) ids.add(String(m.id));
    for (const m of materialsByName.get(normalizeName(productNameOf(p))) ?? []) ids.add(String(m.id));
    return ids.size;
  };

  const rows: ItemOverlapRow[] = [];
  const matchedProductIds = new Set<string>();
  let codeAndNameMatches = 0;
  let exactCodeMatches = 0;
  let exactNameMatches = 0;
  const ambiguousMaterialIds = new Set<string>();
  let unmatchedMaterials = 0;

  for (const m of materials) {
    const materialCode = String(m.code ?? '');
    const materialName = String(m.name ?? '');
    const codeKey = normalizeCode(materialCode);
    const nameKey = normalizeName(materialName);
    const base = {
      materialId: String(m.id),
      materialCode,
      materialName,
      materialItemKind: resolveItemKind(m).kind,
    };

    const byCode = codeKey ? productsByCode.get(codeKey) ?? [] : [];
    const byName = nameKey ? productsByName.get(nameKey) ?? [] : [];
    const candidates = new Map<string, OverlapProductInput>();
    for (const p of [...byCode, ...byName]) candidates.set(String(p.id), p);

    if (candidates.size === 0) {
      unmatchedMaterials += 1;
      rows.push({
        ...base,
        matchType: 'NO_MATCH',
        matchedOn: [],
        reasonEn: 'No product shares this code or name.',
        reasonAr: 'لا يوجد منتج بنفس الكود أو الاسم.',
        recommendedAction: 'KEEP_SEPARATE',
        needsReview: false,
        productItemKind: null,
      });
      continue;
    }

    const ambiguous = candidates.size > 1 || [...candidates.values()].some((p) => materialsMatching(p) > 1);

    for (const p of candidates.values()) {
      const pid = String(p.id);
      matchedProductIds.add(pid);
      const onCode = byCode.some((x) => String(x.id) === pid);
      const onName = byName.some((x) => String(x.id) === pid);
      const matchedOn: Array<'CODE' | 'NAME'> = [...(onCode ? ['CODE' as const] : []), ...(onName ? ['NAME' as const] : [])];
      const signalEn = onCode && onName ? 'code and name' : onCode ? 'code' : 'name';
      const signalAr = onCode && onName ? 'الكود والاسم' : onCode ? 'الكود' : 'الاسم';

      let matchType: ItemMatchType;
      let reasonEn: string;
      let reasonAr: string;
      if (ambiguous) {
        matchType = 'AMBIGUOUS';
        reasonEn = candidates.size > 1
          ? `Exact ${signalEn} match, but this material matches ${candidates.size} products.`
          : `Exact ${signalEn} match, but this product also matches another material.`;
        reasonAr = candidates.size > 1
          ? `تطابق تام في ${signalAr}، لكن هذه الخامة تطابق ${candidates.size} منتجات.`
          : `تطابق تام في ${signalAr}، لكن هذا المنتج يطابق خامة أخرى أيضًا.`;
      } else if (onCode && onName) {
        matchType = 'CODE_AND_NAME_MATCH';
        reasonEn = 'Exact normalized code and exact normalized name match.';
        reasonAr = 'تطابق تام في الكود والاسم بعد التوحيد.';
      } else if (onCode) {
        matchType = 'EXACT_CODE_MATCH';
        reasonEn = 'Exact normalized code match; the names differ.';
        reasonAr = 'تطابق تام في الكود بعد التوحيد، لكن الأسماء مختلفة.';
      } else {
        matchType = 'EXACT_NAME_MATCH';
        reasonEn = 'Exact normalized name match; the codes differ.';
        reasonAr = 'تطابق تام في الاسم بعد التوحيد، لكن الأكواد مختلفة.';
      }

      if (matchType === 'CODE_AND_NAME_MATCH') codeAndNameMatches += 1;
      if (matchType === 'EXACT_CODE_MATCH') exactCodeMatches += 1;
      if (matchType === 'EXACT_NAME_MATCH') exactNameMatches += 1;
      if (matchType === 'AMBIGUOUS') ambiguousMaterialIds.add(base.materialId);

      const recommendedAction: ItemOverlapAction = matchType === 'CODE_AND_NAME_MATCH' ? 'CANDIDATE_FOR_MAPPING' : 'REVIEW';
      rows.push({
        ...base,
        productId: pid,
        productCode: productCodeOf(p),
        productName: productNameOf(p),
        matchType,
        matchedOn,
        reasonEn,
        reasonAr,
        recommendedAction,
        needsReview: recommendedAction === 'REVIEW',
        productItemKind: productKind(p),
        ...(p.isMixtureBOM ? { productIsMixture: true } : {}),
      });
    }
  }

  const unmatchedProducts = products
    .filter((p) => !matchedProductIds.has(String(p.id)))
    .map((p) => ({
      productId: String(p.id),
      productCode: productCodeOf(p),
      productName: productNameOf(p),
      productItemKind: productKind(p),
      ...(p.isMixtureBOM ? { productIsMixture: true } : {}),
    }));

  return {
    rows,
    unmatchedProducts,
    summary: {
      totalProducts: products.length,
      totalMaterials: materials.length,
      codeAndNameMatches,
      exactCodeMatches,
      exactNameMatches,
      ambiguousMaterials: ambiguousMaterialIds.size,
      unmatchedMaterials,
      unmatchedProducts: unmatchedProducts.length,
      skippedWithoutId,
    },
  };
}

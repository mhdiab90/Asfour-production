/**
 * Item classification - the ItemKind vocabulary and how a record's kind is
 * resolved. Pure and Firebase-free.
 *
 * WHERE THE KIND LIVES. `ItemKind` (types/index.ts) is an optional field on:
 *   ProductType  a DEFAULT for every product of that type
 *   Product      an explicit kind for that one product - wins over its type
 *   Material     an explicit kind for that one material
 *
 * The type default is not enough on its own: the current product types mix
 * roles (Kaolin, Calcined Alumina, Crushed Bricks can each be bought, produced
 * or sold), so a single type cannot always decide. Nothing is ever inferred
 * from which collection a record lives in - a material is not assumed to be a
 * raw material, and a product is not assumed to be finished. An unset or
 * unrecognised value resolves to "unclassified", never to a guess.
 *
 * No existing record is given a kind by this module. It only reads.
 */
import type { ItemKind } from '../types';

/** Every supported kind, in display order. */
export const ITEM_KINDS: readonly ItemKind[] = ['RAW_MATERIAL', 'INTERMEDIATE', 'FINISHED_PRODUCT', 'OTHER'];

export const ITEM_KIND_LABELS: Record<ItemKind, { ar: string; en: string }> = {
  RAW_MATERIAL: { ar: 'خامة أولية', en: 'Raw Material' },
  INTERMEDIATE: { ar: 'منتج وسيط / نصف مصنع', en: 'Intermediate / Semi-Finished' },
  FINISHED_PRODUCT: { ar: 'منتج تام', en: 'Finished Product' },
  OTHER: { ar: 'أخرى', en: 'Other' },
};

/** True only for an exact supported value - no case folding, no aliases. */
export function isItemKind(value: unknown): value is ItemKind {
  return typeof value === 'string' && (ITEM_KINDS as readonly string[]).includes(value);
}

export type ItemKindSource = 'ITEM' | 'PRODUCT_TYPE' | 'UNCLASSIFIED';

export interface ResolvedItemKind {
  kind: ItemKind | null;
  source: ItemKindSource;
}

/**
 * The effective kind of a product or material.
 *
 * The record's own valid `itemKind` first, then its product type's valid
 * `itemKind`, else unclassified. A record without the field - every record
 * written before it existed - is valid and simply unclassified.
 */
export function resolveItemKind(
  record: { itemKind?: unknown } | null | undefined,
  productType?: { itemKind?: unknown } | null,
): ResolvedItemKind {
  if (record && isItemKind(record.itemKind)) return { kind: record.itemKind, source: 'ITEM' };
  if (productType && isItemKind(productType.itemKind)) return { kind: productType.itemKind, source: 'PRODUCT_TYPE' };
  return { kind: null, source: 'UNCLASSIFIED' };
}

/**
 * The product type a product points at, by its stored productTypeId, falling
 * back to an exact prefix match. Read-only; returns undefined when neither
 * identifies exactly one type.
 */
export function findProductTypeFor<T extends { id?: string; prefixCode?: string }>(
  product: { productTypeId?: string; productTypePrefix?: string },
  productTypes: readonly T[],
): T | undefined {
  if (product.productTypeId) {
    const byId = productTypes.find((t) => t.id === product.productTypeId);
    if (byId) return byId;
  }
  const prefix = (product.productTypePrefix || '').trim();
  if (!prefix) return undefined;
  const byPrefix = productTypes.filter((t) => (t.prefixCode || '').trim() === prefix);
  return byPrefix.length === 1 ? byPrefix[0] : undefined;
}

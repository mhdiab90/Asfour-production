/**
 * THE MACHINE OF AN ODOO-IMPORTED RECORD (3.41.0).
 *
 * The production record the Odoo import writes does not carry the machine; the `workOrders` document written
 * beside it does (workCenter.equipmentName, pointing back through productionRecordId). This module reads that
 * name into a machine key the cost-centre selector can match - only where the Odoo name says which machine it
 * is. A name that does not (one "الخلاطات" for all mixers, one "الافران النفقية" for all tunnel kilns) gets no
 * key and is never guessed. Pure.
 */
import type { UniversalStageRecord } from '../types';

export interface OdooEquipmentLink {
  equipmentName: string;
  /** The raw work-centre text, kept for display. */
  raw: string;
}

const digitsToLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

/** Arabic spelling variants folded together so "الطاحونه الصينيه" and "الطاحونة الصيني" compare equal. */
export function foldArabic(text: unknown): string {
  return digitsToLatin(String(text ?? ''))
    .replace(/[ً-ْ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * The machine an Odoo work-centre name stands for, as a key; null when the name does not say which one.
 *   chinese_mills:N     - "الطاحونه الصينيه رقم N" (N = 1..5)
 *   tube_ball_mills:ball / :tube - the ball mills / the tube mills
 */
export function odooMachineKey(stage: string | undefined, name: unknown): string | null {
  const t = foldArabic(name);
  if (!t) return null;
  if (stage === 'chinese_mills' && /طاحون/.test(t) && /صيني/.test(t)) {
    const n = /رقم\s*(\d+)/.exec(t)?.[1] ?? /(\d+)\s*$/.exec(t)?.[1];
    return n ? `chinese_mills:${Number(n)}` : null;
  }
  if (stage === 'tube_ball_mills') {
    if (/بول|كروي/.test(t)) return 'tube_ball_mills:ball';
    if (/تيوب|اسطوان/.test(t)) return 'tube_ball_mills:tube';
  }
  return null;
}

/**
 * Stamps each Odoo record with the machine its work order named. Copies - a record read from a cache is never
 * mutated. Records the import did not write (no manufacturing-order number) and records with no link are
 * returned as they were.
 */
export function attachOdooEquipment(records: readonly UniversalStageRecord[], links: ReadonlyMap<string, OdooEquipmentLink>): UniversalStageRecord[] {
  return records.map((r) => {
    const raw = (r.rawData ?? {}) as Record<string, any>;
    if (!raw.manufacturingOrderNumber) return r;
    const link = links.get(r.id);
    if (!link) return r;
    return {
      ...r,
      rawData: { ...raw, odooEquipmentName: link.equipmentName, odooWorkCenterRaw: link.raw, odooMachineKey: odooMachineKey(r.stageType, link.equipmentName || link.raw) },
    };
  });
}

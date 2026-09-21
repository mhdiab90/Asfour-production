/**
 * Actual material consumption - Phase 1 Step 5B. Pure and Firebase-free.
 *
 * WHAT WAS CONSUMED by one production record. Not the BOM (what SHOULD be
 * consumed), not a cost, not a stock movement: identity + quantity + unit only.
 * An item missing from the BOM is allowed (the difference becomes a variance
 * later), a record without a BOM may still record consumption, and nothing here
 * touches a BOM, a job, a batch, inventory or Material.currentStock.
 *
 * REUSED MODEL. Lines are the existing MaterialConsumptionItem stored in the
 * stage record's own `materials` array - the same array Rotary Furnace, Mortar /
 * Concrete, Mixing and Foam already write, inside the record's single write. New
 * writes add optional fields only, so every existing reader keeps working:
 *   materialId     the SOURCE record id (a material, or a product - see itemSource)
 *   itemSource     'products' | 'materials'; absent on historical lines = materials
 *   materialCode / materialName  snapshots taken from the source record at save
 *   quantity       > 0, never rounded or converted
 *   unit           one of the existing unit values (bomPure.BOM_UNITS), explicit
 *   lineId / sequence  stable line id (L1..) and display order 1..n
 *   logicalItemId  stored only when the source already resolves to an ACTIVE
 *                  logical item - never created. Unmapped items are allowed and
 *                  reported as unresolved.
 *   notes          optional
 *   batchId        (Phase 1 Step 6) the input lot this line was drawn from - the
 *                  genealogy input link, validated by productionGenealogyPure
 *   componentType  (Phase 1 Step 7A) BASE or ADDITIVE, as the user recorded it -
 *                  never inferred from the BOM; absent on historical lines = BASE
 *
 * THE LINE RULE (a decided policy): a line may consume any valid item. If it
 * carries a logicalItemId, that id must be exactly what its source resolves to.
 * There is no comparison with the job's own logical item.
 */
import type { MaterialConsumptionItem } from '../types';
import { BOM_UNITS } from './bomPure';
import { BOM_COMPONENT_TYPES, componentTypeOf } from './bomPure';
import type { LogicalItemRecord } from './logicalItemPure';
import { findLogicalItemFor, resolveLogicalItemId } from './logicalItemPure';
import { lineIdentityIssues, normaliseSequences } from './versionedSetupPure';

export const CONSUMPTION_ITEM_SOURCES = ['products', 'materials'] as const;
export type ConsumptionItemSource = (typeof CONSUMPTION_ITEM_SOURCES)[number];

type Stored = Record<string, unknown> & { id?: string };

export interface ConsumptionIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface ConsumptionContext {
  /** Source lists; null = not loaded, so lines from that source cannot be verified and are refused. */
  products?: readonly Stored[] | null;
  materials?: readonly Stored[] | null;
  logicalItems?: readonly LogicalItemRecord[] | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

/** Historical lines have no itemSource: they were always materials. */
export function lineSource(line: Record<string, unknown>): string {
  return text(line.itemSource) || 'materials';
}

/** The logical identity of a line's source, through the shared resolver. */
export function lineLogicalItemKey(line: Record<string, unknown>, logicalItems: readonly LogicalItemRecord[]): string {
  return resolveLogicalItemId(logicalItems, lineSource(line), text(line.materialId));
}

/** Validates the lines about to be written. Structural rules need no reads; item checks need the source lists. */
export function validateActualConsumption(lines: ReadonlyArray<Record<string, unknown>>, context: ConsumptionContext = {}): { valid: boolean; issues: ConsumptionIssue[] } {
  const issues: ConsumptionIssue[] = [];
  const shaped = lines.map((l) => ({ ...l, lineId: text(l.lineId), sequence: typeof l.sequence === 'number' ? l.sequence : Number(text(l.sequence)) }));
  issues.push(...lineIdentityIssues(shaped as Array<{ lineId: string; sequence: number }>, 'materials'));

  lines.forEach((line, i) => {
    const n = i + 1;
    const add = (field: string, ar: string, en: string) => issues.push({ field: `materials.${field}`, messageAr: `سطر الاستهلاك ${n}: ${ar}`, messageEn: `Consumption line ${n}: ${en}` });
    const source = lineSource(line);
    const itemId = text(line.materialId);

    if (!(CONSUMPTION_ITEM_SOURCES as readonly string[]).includes(source)) add('itemSource', 'مصدر الصنف غير صالح.', 'invalid item source.');
    else if (!itemId) add('materialId', 'يجب اختيار الصنف.', 'select the item.');
    else {
      const list = source === 'products' ? context.products : context.materials;
      if (!list) add('materialId', 'تعذر التحقق من الصنف - القائمة غير محملة.', 'the item cannot be verified - the item list is not loaded.');
      else if (!list.some((r) => String(r.id ?? '') === itemId)) add('materialId', 'الصنف غير موجود.', 'the item does not exist.');
    }

    const quantity = line.quantity;
    if (!(typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0)) add('quantity', 'الكمية يجب أن تكون رقمًا أكبر من صفر.', 'quantity must be a number greater than zero.');
    if (!(BOM_UNITS as readonly string[]).includes(text(line.unit))) add('unit', 'يجب اختيار وحدة معروفة - لا يتم افتراض أو تحويل الوحدة.', 'choose a known unit - no unit is assumed or converted.');
    if (line.notes !== undefined && line.notes !== null && typeof line.notes !== 'string') add('notes', 'الملاحظات يجب أن تكون نصًا.', 'notes must be text.');
    const type = text(line.componentType);
    if (type && !(BOM_COMPONENT_TYPES as readonly string[]).includes(type.toUpperCase())) add('componentType', 'نوع الاستهلاك يجب أن يكون أساسي أو إضافة.', 'the consumption type must be BASE or ADDITIVE.');

    const storedLogical = text(line.logicalItemId);
    if (storedLogical) {
      if (!context.logicalItems) add('logicalItemId', 'تعذر التحقق من الصنف المنطقي.', 'the logical item cannot be verified.');
      else if (lineLogicalItemKey(line, context.logicalItems) !== `logicalItem:${storedLogical}`) {
        add('logicalItemId', 'الصنف المنطقي للسطر لا يطابق الصنف المنطقي لمصدره.', "the line's logical item does not match what its source item resolves to.");
      }
    }
  });
  return { valid: issues.length === 0, issues };
}

/**
 * The exact lines to write: display order 1..n, snapshots from the source
 * record, logicalItemId set only when the source resolves to an ACTIVE logical
 * item. Assumes validateActualConsumption passed.
 */
export function normaliseActualConsumption(lines: ReadonlyArray<Record<string, unknown>>, context: ConsumptionContext): MaterialConsumptionItem[] {
  const ordered = normaliseSequences(lines.map((l, i) => ({ ...l, sequence: typeof l.sequence === 'number' ? l.sequence : i + 1 })) as Array<Record<string, unknown> & { sequence: number }>);
  return ordered.map((line) => {
    const source = lineSource(line) as ConsumptionItemSource;
    const itemId = text(line.materialId);
    const record = (source === 'products' ? context.products : context.materials)?.find((r) => String(r.id ?? '') === itemId);
    const logical = context.logicalItems ? findLogicalItemFor(context.logicalItems, source, itemId) : undefined;
    const out: MaterialConsumptionItem = {
      lineId: text(line.lineId),
      sequence: line.sequence,
      itemSource: source,
      materialId: itemId,
      materialCode: text(record?.code ?? record?.productCode ?? line.materialCode),
      materialName: text(record?.name ?? record?.productName ?? line.materialName),
      quantity: line.quantity as number,
      unit: text(line.unit),
    };
    if (logical) out.logicalItemId = logical.id;
    // Phase 1 Step 6: the input batch travels with its consumption line (validated by genealogy).
    if (text(line.batchId)) out.batchId = text(line.batchId);
    // Phase 1 Step 7A: new lines always store their formula group explicitly.
    out.componentType = componentTypeOf(line);
    const notes = text(line.notes);
    if (notes) out.notes = notes;
    return out;
  });
}

/** Lines whose source has no logical identity yet - reported, never mapped here. */
export function unresolvedConsumptionLines(lines: ReadonlyArray<Record<string, unknown>>, logicalItems: readonly LogicalItemRecord[]): string[] {
  return lines.filter((l) => text(l.materialId) && lineLogicalItemKey(l, logicalItems).startsWith('record:')).map((l) => text(l.lineId));
}

export type BomMembership = 'IN_BOM' | 'OFF_BOM' | 'NO_BOM';

/**
 * Whether a line's item is a component of the selected BOM version - by logical
 * identity through the shared resolver. INFORMATION ONLY: nothing is blocked,
 * computed as a variance, or written back to the BOM.
 */
export function bomMembership(line: Record<string, unknown>, bomVersion: Record<string, unknown> | null | undefined, logicalItems: readonly LogicalItemRecord[]): BomMembership {
  const components = bomVersion && Array.isArray(bomVersion.components) ? (bomVersion.components as Array<Record<string, unknown>>) : null;
  if (!components) return 'NO_BOM';
  const key = lineLogicalItemKey(line, logicalItems);
  return components.some((c) => resolveLogicalItemId(logicalItems, text(c.itemSource), text(c.itemId)) === key) ? 'IN_BOM' : 'OFF_BOM';
}

/** Added / removed / quantity / unit / reorder changes between two line lists, for the existing audit history. */
export function describeConsumptionChange(before: ReadonlyArray<Record<string, unknown>>, after: ReadonlyArray<Record<string, unknown>>): string | null {
  const prev = new Map(before.map((l) => [text(l.lineId), l]));
  const next = new Map(after.map((l) => [text(l.lineId), l]));
  const changes: string[] = [];
  for (const l of after) {
    const id = text(l.lineId);
    const o = prev.get(id);
    if (!o) { changes.push(`added ${id} ${lineSource(l)}/${text(l.materialId)} ${l.quantity} ${text(l.unit)}`); continue; }
    if (text(o.materialId) !== text(l.materialId) || lineSource(o) !== lineSource(l)) changes.push(`${id} item ${lineSource(o)}/${text(o.materialId)} -> ${lineSource(l)}/${text(l.materialId)}`);
    if (componentTypeOf(o) !== componentTypeOf(l)) changes.push(`${id} type ${componentTypeOf(o)} -> ${componentTypeOf(l)}`);
    if (o.quantity !== l.quantity) changes.push(`${id} quantity ${o.quantity} -> ${l.quantity}`);
    if (text(o.unit) !== text(l.unit)) changes.push(`${id} unit ${text(o.unit)} -> ${text(l.unit)}`);
    if (o.sequence !== l.sequence) changes.push(`${id} reordered ${o.sequence} -> ${l.sequence}`);
  }
  for (const l of before) if (!next.has(text(l.lineId))) changes.push(`removed ${text(l.lineId)} ${lineSource(l)}/${text(l.materialId)}`);
  return changes.length ? `[ACTUAL_CONSUMPTION] ${changes.join('; ')}` : null;
}

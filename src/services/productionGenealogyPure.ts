/**
 * Production genealogy - Phase 1 Step 6. Pure and Firebase-free.
 *
 * WHAT WENT IN and WHAT CAME OUT of one production record - traceability only:
 * no stock, no cost, no BOM change, no routing, no downstream record created.
 *
 * INPUTS ARE THE ACTUAL CONSUMPTION LINES (Step 5B) - there is no second input
 * system. A consumption line gains an optional `batchId`: the lot it was drawn
 * from. So "what went in" is the record's `materials` array, never a copy.
 *
 * OUTPUTS are new lines on the same record (`productionOutputs`), saved in the
 * record's existing single write:
 *   lineId / sequence   stable id (L1..) and display order 1..n
 *   itemSource/itemId   the produced item's real record - a product OR a material
 *   itemCode/itemName   snapshots from that record at save
 *   logicalItemId       stored only when it already resolves - never created
 *   batchId             the output lot; REQUIRED for PRIMARY and BYPRODUCT (a real
 *                       produced lot), optional for SCRAP. Selected, never generated
 *   quantity / unit     > 0, one of the existing units, never converted
 *   outputType          PRIMARY | BYPRODUCT | SCRAP
 *   notes
 *
 * QUERYABLE LINKS. Firestore cannot query inside an array of objects, so the
 * record also carries two flat id lists - `genealogyInputBatchIds` and
 * `genealogyOutputBatchIds` - for later array-contains queries ("which records
 * produced / consumed batch X") across the stage collections. No graph store.
 *
 * DECIDED RULES.
 *   Primary   outputs are optional; once ANY output line is entered, at least one
 *             must be PRIMARY. Entries without outputs save as before.
 *   Batches   an output batch bound to a product must be that item's logical item;
 *             one bound to a job must be this record's job. An input batch bound
 *             to a product must match the consumed item (inputs may come from
 *             other jobs' lots). Batches must exist and be active.
 *   Circular  an output with the SAME batch AND the SAME item (logical identity)
 *             as an input of the same record is refused - no transformation. The
 *             same batch carried into a different item is allowed.
 *   Totals    output never has to equal input (loss, moisture, scrap).
 */
import type { MaterialConsumptionItem, PackagingActivity, ProductionOutputLine } from '../types';
import { BOM_UNITS } from './bomPure';
import type { LogicalItemRecord } from './logicalItemPure';
import { findLogicalItemFor, resolveLogicalItemId } from './logicalItemPure';
import { lineIdentityIssues, normaliseSequences } from './versionedSetupPure';

/** What the entry screen hands a form: container-held inputs (stages without their own editor) and outputs. */
export interface ProductionGenealogySelection {
  inputs: MaterialConsumptionItem[];
  outputs: ProductionOutputLine[];
  /** Phase 1 Step 8C-5: the packing sub-activity, carried with the lines to the same single write. */
  packaging?: PackagingActivity | null;
}

export const OUTPUT_TYPES = ['PRIMARY', 'BYPRODUCT', 'SCRAP'] as const;
export type OutputTypeValue = (typeof OUTPUT_TYPES)[number];

/** Output types that represent a real produced lot and therefore need a batch. */
export const BATCH_REQUIRED_OUTPUT_TYPES: readonly OutputTypeValue[] = ['PRIMARY', 'BYPRODUCT'];

type Stored = Record<string, unknown> & { id?: string };

export interface GenealogyIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export interface GenealogyContext {
  /** Lists as read; null = not loaded, so anything needing them is refused. */
  products?: readonly Stored[] | null;
  materials?: readonly Stored[] | null;
  logicalItems?: readonly LogicalItemRecord[] | null;
  batches?: readonly Stored[] | null;
}

export interface GenealogyInput {
  /** The record's consumption lines (Step 5B), possibly carrying batchId. */
  inputs: ReadonlyArray<Record<string, unknown>>;
  outputs: ReadonlyArray<Record<string, unknown>>;
  /** The record's job (Step 5A selection), for job-bound output batches. */
  jobReferenceId?: string | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

const sourceOf = (line: Record<string, unknown>, field: 'itemSource') => text(line[field]) || 'materials';
const inputItemId = (line: Record<string, unknown>) => text(line.materialId);
const outputItemId = (line: Record<string, unknown>) => text(line.itemId);

function itemRecord(ctx: GenealogyContext, source: string, id: string): Stored | undefined {
  const list = source === 'products' ? ctx.products : source === 'materials' ? ctx.materials : null;
  return (list ?? []).find((r) => String(r.id ?? '') === id);
}

/** Why a batch cannot hold this item, or null when it can. */
function batchItemIssue(batch: Stored, source: string, itemId: string, logicalItems: readonly LogicalItemRecord[]): { ar: string; en: string } | null {
  if (batch.active === false) return { ar: 'الدفعة معطلة.', en: 'the batch is inactive.' };
  const productId = text(batch.productId);
  if (productId && resolveLogicalItemId(logicalItems, 'products', productId) !== resolveLogicalItemId(logicalItems, source, itemId)) {
    return { ar: 'الدفعة مرتبطة بصنف آخر - لم تُستبدل تلقائيًا.', en: 'the batch belongs to a different item - it is not replaced automatically.' };
  }
  return null;
}

export function validateProductionGenealogy(input: GenealogyInput, context: GenealogyContext = {}): { valid: boolean; issues: GenealogyIssue[] } {
  const issues: GenealogyIssue[] = [];
  const logicalItems = context.logicalItems ?? [];
  const batchById = (id: string) => (context.batches ?? []).find((b) => String(b.id ?? '') === id);

  // Inputs: only the batch link is new here; the lines themselves are validated by Step 5B.
  input.inputs.forEach((line, i) => {
    const batchId = text(line.batchId);
    if (!batchId) return;
    const add = (ar: string, en: string) => issues.push({ field: 'materials.batchId', messageAr: `سطر الاستهلاك ${i + 1}: ${ar}`, messageEn: `Consumption line ${i + 1}: ${en}` });
    if (!context.batches || !context.logicalItems) { add('تعذر التحقق من دفعة المدخل.', 'the input batch cannot be verified.'); return; }
    const batch = batchById(batchId);
    if (!batch) { add('دفعة المدخل غير موجودة.', 'the input batch does not exist.'); return; }
    const why = batchItemIssue(batch, sourceOf(line, 'itemSource'), inputItemId(line), logicalItems);
    if (why) add(`الدفعة "${text(batch.batchNumber)}": ${why.ar}`, `batch "${text(batch.batchNumber)}": ${why.en}`);
  });

  // Outputs.
  const shaped = input.outputs.map((l) => ({ lineId: text(l.lineId), sequence: typeof l.sequence === 'number' ? l.sequence : Number(text(l.sequence)) }));
  issues.push(...lineIdentityIssues(shaped, 'productionOutputs'));

  const inputKeys = new Set(
    input.inputs
      .filter((l) => text(l.batchId))
      .map((l) => JSON.stringify([text(l.batchId), resolveLogicalItemId(logicalItems, sourceOf(l, 'itemSource'), inputItemId(l))])),
  );

  input.outputs.forEach((line, i) => {
    const n = i + 1;
    const add = (field: string, ar: string, en: string) => issues.push({ field: `productionOutputs.${field}`, messageAr: `سطر المخرجات ${n}: ${ar}`, messageEn: `Output line ${n}: ${en}` });
    const source = sourceOf(line, 'itemSource');
    const itemId = outputItemId(line);
    const type = text(line.outputType).toUpperCase();

    if (source !== 'products' && source !== 'materials') add('itemSource', 'مصدر الصنف غير صالح.', 'invalid item source.');
    else if (!itemId) add('itemId', 'يجب اختيار الصنف المنتج.', 'select the produced item.');
    else if (!(source === 'products' ? context.products : context.materials)) add('itemId', 'تعذر التحقق من الصنف - القائمة غير محملة.', 'the item cannot be verified - the item list is not loaded.');
    else if (!itemRecord(context, source, itemId)) add('itemId', 'الصنف المنتج غير موجود.', 'the produced item does not exist.');

    const q = line.quantity;
    if (!(typeof q === 'number' && Number.isFinite(q) && q > 0)) add('quantity', 'الكمية المنتجة يجب أن تكون رقمًا أكبر من صفر.', 'the produced quantity must be a number greater than zero.');
    if (!(BOM_UNITS as readonly string[]).includes(text(line.unit))) add('unit', 'يجب اختيار وحدة معروفة - لا يتم افتراض أو تحويل الوحدة.', 'choose a known unit - no unit is assumed or converted.');
    if (!(OUTPUT_TYPES as readonly string[]).includes(type)) add('outputType', 'نوع المخرج غير صالح (PRIMARY / BYPRODUCT / SCRAP).', 'invalid output type (PRIMARY / BYPRODUCT / SCRAP).');
    if (line.notes !== undefined && line.notes !== null && typeof line.notes !== 'string') add('notes', 'الملاحظات يجب أن تكون نصًا.', 'notes must be text.');

    const storedLogical = text(line.logicalItemId);
    if (storedLogical && context.logicalItems && resolveLogicalItemId(logicalItems, source, itemId) !== `logicalItem:${storedLogical}`) {
      add('logicalItemId', 'الصنف المنطقي للمخرج لا يطابق مصدره.', "the output's logical item does not match what its item resolves to.");
    }

    const batchId = text(line.batchId);
    if (!batchId) {
      if ((BATCH_REQUIRED_OUTPUT_TYPES as readonly string[]).includes(type)) {
        add('batchId', 'اختر دفعة المخرج (لا يتم إنشاء دفعة تلقائيًا).', 'select the output batch (no batch is created automatically).');
      }
    } else if (!context.batches || !context.logicalItems) {
      add('batchId', 'تعذر التحقق من دفعة المخرج.', 'the output batch cannot be verified.');
    } else {
      const batch = batchById(batchId);
      if (!batch) add('batchId', 'دفعة المخرج غير موجودة.', 'the output batch does not exist.');
      else {
        const why = batchItemIssue(batch, source, itemId, logicalItems);
        if (why) add('batchId', `الدفعة "${text(batch.batchNumber)}": ${why.ar}`, `batch "${text(batch.batchNumber)}": ${why.en}`);
        const boundJob = text(batch.jobReferenceId);
        if (boundJob && boundJob !== text(input.jobReferenceId)) {
          add('batchId', `الدفعة "${text(batch.batchNumber)}" مرتبطة بأمر شغل آخر.`, `batch "${text(batch.batchNumber)}" is bound to another job reference.`);
        }
        if (itemId && inputKeys.has(JSON.stringify([batchId, resolveLogicalItemId(logicalItems, source, itemId)]))) {
          add('batchId', 'نفس الدفعة ونفس الصنف في المدخلات والمخرجات - لا يوجد تحويل.', 'the same batch and the same item are both an input and an output - no transformation.');
        }
      }
    }
  });

  if (input.outputs.length > 0 && !input.outputs.some((l) => text(l.outputType).toUpperCase() === 'PRIMARY')) {
    issues.push({ field: 'productionOutputs.outputType', messageAr: 'عند تسجيل مخرجات يجب أن يكون أحدها على الأقل PRIMARY.', messageEn: 'When outputs are recorded, at least one must be PRIMARY.' });
  }

  return { valid: issues.length === 0, issues };
}

export interface ProductionOutputValue {
  lineId: string;
  sequence: number;
  itemSource: 'products' | 'materials';
  itemId: string;
  itemCode: string;
  itemName: string;
  logicalItemId?: string;
  batchId?: string;
  quantity: number;
  unit: string;
  outputType: OutputTypeValue;
  notes?: string;
}

/**
 * The genealogy fields to merge into the record - only non-empty keys, so an
 * entry without genealogy writes nothing new. Assumes validation passed.
 */
export function normaliseProductionGenealogy(input: GenealogyInput, context: GenealogyContext): {
  productionOutputs?: ProductionOutputValue[];
  genealogyInputBatchIds?: string[];
  genealogyOutputBatchIds?: string[];
} {
  const outputs = normaliseSequences(input.outputs.map((l, i) => ({ ...l, sequence: typeof l.sequence === 'number' ? l.sequence : i + 1 })) as Array<Record<string, unknown> & { sequence: number }>)
    .map((line) => {
      const source = sourceOf(line, 'itemSource') as 'products' | 'materials';
      const itemId = outputItemId(line);
      const record = itemRecord(context, source, itemId);
      const logical = context.logicalItems ? findLogicalItemFor(context.logicalItems, source, itemId) : undefined;
      const out: ProductionOutputValue = {
        lineId: text(line.lineId),
        sequence: line.sequence,
        itemSource: source,
        itemId,
        itemCode: text(record?.code ?? record?.productCode),
        itemName: text(record?.name ?? record?.productName),
        quantity: line.quantity as number,
        unit: text(line.unit),
        outputType: text(line.outputType).toUpperCase() as OutputTypeValue,
      };
      if (logical) out.logicalItemId = logical.id;
      if (text(line.batchId)) out.batchId = text(line.batchId);
      if (text(line.notes)) out.notes = text(line.notes);
      return out;
    });
  const unique = (ids: string[]) => [...new Set(ids.filter(Boolean))];
  const inputBatchIds = unique(input.inputs.map((l) => text(l.batchId)));
  const outputBatchIds = unique(outputs.map((o) => o.batchId ?? ''));
  return {
    ...(outputs.length ? { productionOutputs: outputs } : {}),
    ...(inputBatchIds.length ? { genealogyInputBatchIds: inputBatchIds } : {}),
    ...(outputBatchIds.length ? { genealogyOutputBatchIds: outputBatchIds } : {}),
  };
}

/** Output added / removed / item / batch / quantity / unit / type changes, for the existing audit. */
export function describeOutputChange(beforeLines: ReadonlyArray<object>, afterLines: ReadonlyArray<object>): string | null {
  const before = beforeLines as ReadonlyArray<Record<string, unknown>>;
  const after = afterLines as ReadonlyArray<Record<string, unknown>>;
  const prev = new Map(before.map((l) => [text(l.lineId), l]));
  const next = new Map(after.map((l) => [text(l.lineId), l]));
  const changes: string[] = [];
  for (const l of after) {
    const id = text(l.lineId);
    const o = prev.get(id);
    if (!o) { changes.push(`output added ${id} ${text(l.outputType)} ${text(l.itemSource)}/${text(l.itemId)} batch ${text(l.batchId) || '-'} ${l.quantity} ${text(l.unit)}`); continue; }
    if (text(o.itemId) !== text(l.itemId) || text(o.itemSource) !== text(l.itemSource)) changes.push(`${id} item ${text(o.itemSource)}/${text(o.itemId)} -> ${text(l.itemSource)}/${text(l.itemId)}`);
    if (text(o.batchId) !== text(l.batchId)) changes.push(`${id} batch ${text(o.batchId) || '-'} -> ${text(l.batchId) || '-'}`);
    if (o.quantity !== l.quantity) changes.push(`${id} quantity ${o.quantity} -> ${l.quantity}`);
    if (text(o.unit) !== text(l.unit)) changes.push(`${id} unit ${text(o.unit)} -> ${text(l.unit)}`);
    if (text(o.outputType) !== text(l.outputType)) changes.push(`${id} type ${text(o.outputType)} -> ${text(l.outputType)}`);
  }
  for (const l of before) if (!next.has(text(l.lineId))) changes.push(`output removed ${text(l.lineId)} ${text(l.itemSource)}/${text(l.itemId)}`);
  return changes.length ? `[PRODUCTION_GENEALOGY] ${changes.join('; ')}` : null;
}

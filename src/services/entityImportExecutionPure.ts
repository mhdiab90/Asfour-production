/**
 * The entity-import execution loop - Firebase-free, so it can be exercised with a
 * stand-in writer. entityImportService passes the real one (the existing audited
 * services); nothing here writes on its own.
 *
 * WHAT IT GUARANTEES
 *   - Every eligible row is revalidated immediately before it is written, with
 *     the SAME function the review used (resolveAndValidateImportRow); a row that
 *     no longer passes is dropped and reported, never written.
 *   - Row isolation: each write sits in its own try/catch and its outcome is
 *     recorded on that row only. Nothing is rolled back.
 *   - Dependency order (Master Data package): products and materials are written
 *     BEFORE the BOMs that use them. The id each write returns is captured, the
 *     BOM's pending package-item tokens are bound to those ids, and the BOM is
 *     revalidated against the existing items PLUS the items written in this run.
 *     A token whose item was not written is reported with its code and the BOM is
 *     dropped - a token is never written.
 *   - A row already written earlier in the same file is seen by the next row of
 *     the SAME kind (`pendingSameKind`), so an in-file duplicate is caught - and a
 *     product can never be mistaken for a BOM of the same code.
 *
 * Rows keep their original order in the result, whatever order they were written in.
 */
import { applyRowResult, applyValidation, isRowWritable, planImport, rowPayload } from './entityImportPure';
import type { ImportRow, ImportSession } from './entityImportPure';
import { resolveAndValidateImportRow } from './importEntityValidationPure';
import type { ImportValidationContext, ImportValidationResult } from './importEntityValidationPure';
import type { ReferenceIndexes, ReferenceMappingCache } from './referenceResolutionPure';
import { bindPackageItemReferences, isPackageItemToken, packageItemKey } from './masterDataPackageSessionPure';

type Stored = Record<string, unknown> & { id?: string };

export interface ExecuteRowsOptions {
  indexes: ReferenceIndexes;
  mappingCache?: ReferenceMappingCache;
  user: string;
  at: () => string;
  language: 'ar' | 'en';
}

/** Writes one row through its existing service; returns the ASFOUR id it wrote or updated. */
export type ImportRowWriter = (row: ImportRow, context: ImportValidationContext) => Promise<string | undefined>;

/** Called after every attempted write, with the row's outcome and its final validation. */
export type ImportRowObserver = (row: ImportRow, recheck: ImportValidationResult) => void;

export interface ExecuteRowsResult {
  rows: ImportRow[];
  droppedBeforeWrite: Array<{ rowId: string; reason: string }>;
}

/** Items the rest of a run depends on are written first; everything else keeps its file order. */
function phaseOf(row: ImportRow): number {
  return row.entityKind === 'bomPackage' ? 1 : 0;
}

/** True when a payload still carries a pending package-item token anywhere. */
export function carriesPackageItemToken(value: unknown): boolean {
  if (isPackageItemToken(value)) return true;
  if (Array.isArray(value)) return value.some(carriesPackageItemToken);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(carriesPackageItemToken);
  return false;
}

export async function executeImportRows(
  session: ImportSession,
  context: ImportValidationContext,
  options: ExecuteRowsOptions,
  write: ImportRowWriter,
  observe?: ImportRowObserver,
): Promise<ExecuteRowsResult> {
  const droppedBeforeWrite: Array<{ rowId: string; reason: string }> = [];
  const eligible = new Set(planImport(session).willImport.map((r) => r.rowId));
  const pendingByKind = new Map<string, Array<Record<string, unknown> & { id?: string }>>();
  /** Package item key (kind:CODE) -> the ASFOUR id its row wrote in this run. */
  const writtenItemIds = new Map<string, string>();
  /** Items CREATED in this run, so a BOM's final validation knows them. */
  const createdItems: { products: Stored[]; materials: Stored[] } = { products: [], materials: [] };
  const outcome = new Map<string, ImportRow>();
  /**
   * The context every BOM is validated and written against: the existing items
   * plus those created in this run. Built once, when the first BOM is reached -
   * all items are written by then (they come first) - so its arrays stay the
   * same objects and the validators' per-list lookups are built once.
   */
  let bomContext: ImportValidationContext | null = null;

  const order = session.rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => phaseOf(a.row) - phaseOf(b.row) || a.index - b.index);

  for (const { row } of order) {
    if (!eligible.has(row.rowId)) {
      outcome.set(row.rowId, row);
      continue;
    }

    let payload = rowPayload(row);
    let rowContext = context;
    if (row.entityKind === 'bomPackage') {
      const bound = bindPackageItemReferences(payload, writtenItemIds);
      if (bound.unresolved.length > 0) {
        const codes = bound.unresolved.map((k) => k.slice(k.indexOf(':') + 1)).join(', ');
        droppedBeforeWrite.push({
          rowId: row.rowId,
          reason: options.language === 'ar'
            ? `صنف من نفس الحزمة لم يُكتب في هذا الاستيراد: ${codes}`
            : `A package item was not written in this import: ${codes}`,
        });
        outcome.set(row.rowId, row);
        continue;
      }
      payload = bound.payload;
      bomContext ??= {
        ...context,
        products: [...(context.products ?? []), ...createdItems.products],
        materials: [...(context.materials ?? []), ...createdItems.materials],
      };
      rowContext = bomContext;
    }

    let pendingSameKind = pendingByKind.get(row.entityKind);
    if (!pendingSameKind) {
      pendingSameKind = [];
      pendingByKind.set(row.entityKind, pendingSameKind);
    }
    const recheck = resolveAndValidateImportRow(row.entityKind, payload, { ...rowContext, pendingSameKind }, options.indexes, options.mappingCache);
    let current = applyValidation(row, recheck, { user: options.user, at: options.at() });
    if (!isRowWritable(current)) {
      droppedBeforeWrite.push({
        rowId: current.rowId,
        reason: current.errors.map((e) => (options.language === 'ar' ? e.messageAr : e.messageEn)).join(' | ') || 'no longer eligible',
      });
      outcome.set(current.rowId, current);
      continue;
    }

    try {
      if (carriesPackageItemToken(current.normalizedData)) {
        // Defence in depth: a pending token is never an id and is never written.
        throw new Error('A pending package-item reference was not bound to an ASFOUR id.');
      }
      const id = await write(current, rowContext);
      current = applyRowResult(current, { ok: true, id: id ?? null }, { user: options.user, at: options.at() });
      if (id) {
        pendingSameKind.push({ ...(current.normalizedData ?? {}), id });
        if (row.entityKind === 'products' || row.entityKind === 'materials') {
          const data = (current.normalizedData ?? {}) as Record<string, unknown>;
          const code = String(data.code ?? '');
          if (code) writtenItemIds.set(packageItemKey(row.entityKind, code), id);
          if (!data.existingId) {
            const { existingId: _existingId, upsertAction: _upsertAction, matchedBy: _matchedBy, ...record } = data;
            createdItems[row.entityKind].push({ ...record, id });
          }
        }
      }
    } catch (err: any) {
      // One row's failure is recorded on that row only - never a rollback.
      current = applyRowResult(current, { ok: false, error: String(err?.message ?? err) }, { user: options.user, at: options.at() });
    }
    observe?.(current, recheck);
    outcome.set(current.rowId, current);
  }

  return { rows: session.rows.map((r) => outcome.get(r.rowId) ?? r), droppedBeforeWrite };
}

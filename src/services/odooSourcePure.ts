/**
 * Shared reading rules for the three Odoo reports - Phase 1 Step 8D.
 * Pure and Firebase-free.
 *
 * Each report (mrp.production, mrp.workorder, stock.scrap) has its own reader;
 * this module holds only what all three need: how a column name is matched to
 * an ASFOUR field, how a cell becomes a number, a date, a code or a unit, and
 * the row shape every reader produces.
 *
 * COLUMNS ARE MATCHED, NEVER GUESSED. A column matches by its exact ASFOUR
 * field name, then by an explicit alias, then by what the user mapped by hand.
 * Anything else is reported as UNMAPPED and ignored - never attached to a field
 * because the name looked similar. A required field with no column blocks the
 * whole sheet, not a single row.
 *
 * RAW IS KEPT. Every produced row carries the untouched Excel row and its
 * provenance (file, sheet, row number), so any normalised value can be traced
 * back to the cell it came from.
 */
import type { ImportProvenance, OdooSourceType } from '../types';
import { normaliseUom } from './uomPure';
import { ODOO_UOM_NAMES, odooDateToIso, splitBracketCode } from './odooManufacturingImportPure';

export { odooDateToIso, splitBracketCode };

export interface SourceIssue {
  field: string;
  messageAr: string;
  messageEn: string;
}

export type SourceMappingMethod = 'EXACT' | 'ALIAS' | 'MANUAL' | 'IGNORED' | 'UNMAPPED';

export interface SourceColumnMapping {
  sourceColumn: string;
  field: string | null;
  method: SourceMappingMethod;
}

export interface SourceSheetMapping {
  sourceType: OdooSourceType;
  columns: SourceColumnMapping[];
  /** Required fields no column maps to - the sheet cannot be read until they are mapped. */
  missingRequired: string[];
}

/** One row as a reader produced it: raw, normalised, and where it came from. */
export interface OdooSourceRow<TNormalized> {
  rowId: string;
  sourceType: OdooSourceType;
  sourceRow: number;
  raw: Record<string, unknown>;
  normalized: TNormalized;
  issues: SourceIssue[];
  warnings: SourceIssue[];
  provenance: ImportProvenance;
}

export interface ReaderContext {
  importSessionId: string;
  fileName: string;
  sheetName: string;
  /** Column -> ASFOUR field, when a user mapped one by hand. */
  manualMapping?: Record<string, string | null>;
}

export const ODOO_SOURCE_SYSTEM = 'odoo';

export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());
export const blank = (value: unknown): boolean => text(value) === '';

/** A number exactly as the cell gives it - no rounding, no unit conversion, null when it is not a number. */
export function num(value: unknown): number | null {
  if (blank(value)) return null;
  const raw = typeof value === 'number' ? value : Number(text(value).replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48)).replace(/,/g, ''));
  return Number.isFinite(raw) ? raw : null;
}

/** Compares column names ignoring case, spaces, underscores and slashes. */
export const columnKey = (value: string): string => String(value).trim().toLowerCase().replace(/[\s_]+/g, '').replace(/\//g, '/');

/**
 * The Odoo unit NAME -> the approved ASFOUR unit it names ("Ton" -> "طن").
 * A name table, never a quantity conversion: the number is untouched.
 */
export function mapUnit(value: unknown): { unit: string | null; mapped: boolean; original: string } {
  const original = text(value);
  if (!original) return { unit: null, mapped: false, original };
  const approved = normaliseUom(original);
  if (approved.status === 'APPROVED') return { unit: approved.normalized, mapped: false, original };
  const named = ODOO_UOM_NAMES[original.toLowerCase()];
  return named ? { unit: named, mapped: true, original } : { unit: null, mapped: false, original };
}

/** Duration in minutes when the cell holds a number; Odoo exports durations as decimal hours or minutes, so the unit is reported, never assumed. */
export function duration(value: unknown): number | null {
  return num(value);
}

/**
 * Builds the column map for one sheet: exact field name, then explicit alias,
 * then the user's manual choice. Everything else is UNMAPPED.
 */
export function buildSourceMapping(
  sourceType: OdooSourceType,
  fields: readonly string[],
  aliases: Readonly<Record<string, readonly string[]>>,
  required: readonly string[],
  headers: readonly string[],
  manual: Readonly<Record<string, string | null>> = {},
): SourceSheetMapping {
  const columns: SourceColumnMapping[] = headers.map((sourceColumn) => {
    if (Object.prototype.hasOwnProperty.call(manual, sourceColumn)) {
      const field = manual[sourceColumn];
      return { sourceColumn, field: field ?? null, method: field ? 'MANUAL' : 'IGNORED' };
    }
    const key = columnKey(sourceColumn);
    const exact = fields.find((f) => columnKey(f) === key);
    if (exact) return { sourceColumn, field: exact, method: 'EXACT' };
    const alias = fields.find((f) => (aliases[f] ?? []).some((a) => columnKey(a) === key));
    if (alias) return { sourceColumn, field: alias, method: 'ALIAS' };
    return { sourceColumn, field: null, method: 'UNMAPPED' };
  });
  const mapped = new Set(columns.filter((c) => c.field).map((c) => c.field as string));
  return { sourceType, columns, missingRequired: required.filter((f) => !mapped.has(f)) };
}

/** Every column any row of the sheet uses - the union, so a column blank at the top is still mapped. */
export function sheetHeaders(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/** One source row in canonical field names; unmapped columns are left out (the raw row keeps them). */
export function applySourceMapping(row: Record<string, unknown>, mapping: SourceSheetMapping): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of mapping.columns) {
    if (!column.field) continue;
    const value = row[column.sourceColumn];
    if (value === undefined) continue;
    // A field several columns map to keeps the first non-empty value; nothing is overwritten by a blank.
    if (out[column.field] !== undefined && blank(value)) continue;
    if (out[column.field] !== undefined && !blank(out[column.field])) continue;
    out[column.field] = value;
  }
  return out;
}

export function provenanceOf(context: ReaderContext, sourceType: OdooSourceType, sourceRow: number, normalizationRule: string | null = null): ImportProvenance {
  return {
    importSessionId: context.importSessionId,
    sourceFile: context.fileName,
    sourceType,
    sourceSheet: context.sheetName,
    sourceRow,
    sourceSystem: ODOO_SOURCE_SYSTEM,
    normalizationRule,
  };
}

export const issue = (field: string, messageAr: string, messageEn: string): SourceIssue => ({ field, messageAr, messageEn });

/** The sheet-level result every reader returns. */
export interface ReaderResult<TRow> {
  sourceType: OdooSourceType;
  fileName: string;
  sheetName: string;
  mapping: SourceSheetMapping;
  rows: TRow[];
  /** Problems with the sheet itself - a missing required column, an unreadable sheet. */
  sheetIssues: SourceIssue[];
  counts: Record<string, number>;
}

/** The product code and name an Odoo "[CODE] name" cell holds, with the code column winning when both exist. */
export function productOf(codeCell: unknown, nameCell: unknown): { code: string; name: string } {
  const fromName = splitBracketCode(nameCell);
  const code = text(codeCell) || fromName.code;
  return { code, name: fromName.name || text(nameCell) };
}

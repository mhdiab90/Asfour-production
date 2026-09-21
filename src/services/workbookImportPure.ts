/**
 * Multi-sheet production workbooks - Phase 1 Step 8C-4. Pure and Firebase-free.
 *
 * A real export is three related sheets, not JSON inside a cell:
 *   Production    one row per production record
 *   Consumption   one row per consumption line
 *   Outputs       one row per output line
 * joined by an IMPORT-ONLY key the workbook itself carries: Production's
 * `sourceRowId`, referenced by each line's `productionSourceRowId`. That key is
 * never a Firestore id and is never written anywhere - it only says which rows
 * belong together inside this file.
 *
 * ONE MODEL, ONE RULE SET. The sheets are folded into exactly the payload the
 * JSON mode already produces - a production record with `materials` and
 * `productionOutputs` arrays - and then handed to the SAME resolution
 * (Step 8C-3) and the SAME validators (Steps 5A/5B/6). Nothing here validates a
 * job, a unit or a formula, and both input shapes therefore behave identically.
 *
 * NOTHING IS ATTACHED BY GUESSWORK. A line whose key is blank or names a
 * production row that does not exist is an ORPHAN and blocks - it is never
 * attached to the nearest row. A `sourceRowId` used twice blocks both rows,
 * because "which record did this line belong to" would otherwise be a guess.
 *
 * PARTIAL IMPORT SURVIVES. A bad line belongs to ONE production record: that
 * record carries the error, every other record still imports.
 *
 * PROVENANCE IS KEPT. Every produced record remembers each contributing row's
 * sheet, its row number in that sheet and its untouched original values.
 */
import { REFERENCE_FIELD_ALIASES } from './referenceResolutionPure';

export type WorkbookSheetKind = 'production' | 'consumption' | 'outputs';

/** Sheet names accepted for each part of the workbook - explicit, never guessed. */
export const WORKBOOK_SHEET_ALIASES: Readonly<Record<WorkbookSheetKind, readonly string[]>> = {
  production: ['production', 'production records', 'prod', 'الإنتاج', 'سجلات الإنتاج'],
  consumption: ['consumption', 'consumption lines', 'materials', 'الاستهلاك', 'المواد المستهلكة'],
  outputs: ['outputs', 'output lines', 'production outputs', 'المخرجات'],
};

/**
 * Column names accepted per sheet, on top of the reference aliases of Step 8C-3.
 * A bounded, explicit list - anything else is reported as unmapped, never guessed.
 */
export const WORKBOOK_FIELD_ALIASES: Readonly<Record<string, readonly string[]>> = {
  sourceRowId: ['sourceRowId', 'source row id', 'source_row_id', 'rowId', 'row id', 'معرف الصف'],
  productionSourceRowId: ['productionSourceRowId', 'production source row id', 'production_source_row_id', 'production row', 'productionRowId', 'sourceRowId', 'source row id', 'source_row_id', 'معرف صف الإنتاج'],
  date: ['date', 'production date', 'production_date', 'التاريخ', 'تاريخ الإنتاج'],
  stageType: ['stageType', 'stage type', 'stage_type', 'stage', 'المرحلة'],
  subJobCode: ['subJobCode', 'sub job code', 'sub_job_code', 'subJob', 'أمر فرعي'],
  productionQuantity: ['productionQuantity', 'production quantity', 'production_quantity', 'quantityProduced', 'كمية الإنتاج'],
  productionUnit: ['productionUnit', 'production unit', 'production_unit', 'وحدة الإنتاج'],
  quantity: ['quantity', 'qty', 'الكمية'],
  unit: ['unit', 'uom', 'الوحدة'],
  componentType: ['componentType', 'component type', 'component_type', 'type', 'baseOrAdditive', 'نوع المكوّن'],
  outputType: ['outputType', 'output type', 'output_type', 'type', 'نوع المخرج'],
  inputBatchNumber: ['inputBatchNumber', 'input batch number', 'input_batch_number', 'inputBatch', 'رقم دفعة المدخل'],
  lineId: ['lineId', 'line id', 'line_id', 'رقم السطر'],
  sequence: ['sequence', 'seq', 'الترتيب'],
  notes: ['notes', 'note', 'ملاحظات'],
};

/** Fields a sheet cannot do without. Everything else is optional or resolved later. */
export const WORKBOOK_REQUIRED_FIELDS: Readonly<Record<WorkbookSheetKind, readonly string[]>> = {
  production: ['sourceRowId', 'stageType'],
  consumption: ['productionSourceRowId', 'quantity', 'unit'],
  outputs: ['productionSourceRowId', 'quantity', 'unit', 'outputType'],
};

/** The canonical fields each sheet may carry: its own plus every reference alias. */
export function workbookFieldsFor(kind: WorkbookSheetKind): string[] {
  const own: Record<WorkbookSheetKind, string[]> = {
    production: ['sourceRowId', 'date', 'stageType', 'productionQuantity', 'productionUnit', 'notes', 'subJobCode'],
    consumption: ['productionSourceRowId', 'quantity', 'unit', 'componentType', 'inputBatchNumber', 'lineId', 'sequence', 'notes'],
    outputs: ['productionSourceRowId', 'quantity', 'unit', 'outputType', 'lineId', 'sequence', 'notes'],
  };
  const references = kind === 'production'
    ? ['jobCode', 'parentJobCode', 'batchNumber', 'productCode', 'customerCode', 'operationCode', 'equipmentCode', 'pressCode', 'furnaceCode', 'rotaryKilnCode', 'millCode', 'tubeBallMillCode', 'bunkerCode', 'costCenterCode', 'externalSystem', 'externalModel', 'externalId']
    : ['itemCode', 'materialCode', 'productCode', 'batchNumber'];
  return [...own[kind], ...references];
}

const aliasKey = (key: string) => String(key).trim().toLowerCase().replace(/[\s_]+/g, '');
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim());

/** Every accepted spelling of one canonical field (its own aliases plus the reference ones). */
function aliasesOf(field: string): readonly string[] {
  return WORKBOOK_FIELD_ALIASES[field] ?? REFERENCE_FIELD_ALIASES[field] ?? [field];
}

/**
 * Every column the sheet uses - the union across its rows, not just the first
 * one, so a column that is blank at the top of the file is still mapped.
 */
export function workbookHeaders(rows: ReadonlyArray<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/** The sheet kind a sheet name means, or null when it is not one of the three. */
export function sheetKindFor(sheetName: string): WorkbookSheetKind | null {
  const key = aliasKey(sheetName);
  for (const [kind, aliases] of Object.entries(WORKBOOK_SHEET_ALIASES) as Array<[WorkbookSheetKind, readonly string[]]>) {
    if (aliases.some((a) => aliasKey(a) === key)) return kind;
  }
  return null;
}

export type MappingMethod = 'EXACT' | 'ALIAS' | 'MANUAL' | 'IGNORED' | 'UNMAPPED';

export interface ColumnMapping {
  sourceColumn: string;
  field: string | null;
  method: MappingMethod;
}

export interface SheetMapping {
  kind: WorkbookSheetKind;
  columns: ColumnMapping[];
  /** Required fields no column maps to - the sheet cannot be used until they are mapped. */
  missingRequired: string[];
}

/**
 * Matches the file's columns to ASFOUR fields: the exact field name first, then
 * its explicit aliases, then whatever the user mapped by hand. An unmatched
 * column is reported as UNMAPPED and simply ignored - never guessed at.
 */
export function buildSheetMapping(kind: WorkbookSheetKind, headers: readonly string[], manual: Readonly<Record<string, string | null>> = {}): SheetMapping {
  const fields = workbookFieldsFor(kind);
  const columns: ColumnMapping[] = headers.map((sourceColumn) => {
    if (Object.prototype.hasOwnProperty.call(manual, sourceColumn)) {
      const field = manual[sourceColumn];
      return { sourceColumn, field: field ?? null, method: field ? 'MANUAL' : 'IGNORED' };
    }
    const key = aliasKey(sourceColumn);
    const exact = fields.find((f) => aliasKey(f) === key);
    if (exact) return { sourceColumn, field: exact, method: 'EXACT' };
    const alias = fields.find((f) => aliasesOf(f).some((a) => aliasKey(a) === key));
    if (alias) return { sourceColumn, field: alias, method: 'ALIAS' };
    return { sourceColumn, field: null, method: 'UNMAPPED' };
  });
  const mapped = new Set(columns.filter((c) => c.field).map((c) => c.field as string));
  return { kind, columns, missingRequired: WORKBOOK_REQUIRED_FIELDS[kind].filter((f) => !mapped.has(f)) };
}

/** One source row in the canonical field names, keeping every unmapped value out. */
export function applySheetMapping(row: Record<string, unknown>, mapping: SheetMapping): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const column of mapping.columns) {
    if (!column.field) continue;
    const value = row[column.sourceColumn];
    if (value === undefined) continue;
    out[column.field] = value;
  }
  return out;
}

export interface WorkbookIssue {
  sheet: WorkbookSheetKind;
  sourceRowNumber: number;
  sourceRowId: string;
  field: string;
  messageAr: string;
  messageEn: string;
}

/** Where one contributing row came from - kept for the review and the error report. */
export interface RowOrigin {
  sheet: WorkbookSheetKind;
  sourceRowNumber: number;
  sourceRowId: string;
  originalRowData: Record<string, unknown>;
}

export interface WorkbookRecord {
  sourceRowId: string;
  sourceRowNumber: number;
  /** The production payload in the same shape the JSON mode produces. */
  payload: Record<string, unknown>;
  origins: RowOrigin[];
  consumptionCount: number;
  outputCount: number;
  /** Problems that belong to THIS record (a duplicate key, a line it owns). */
  issues: WorkbookIssue[];
}

export interface WorkbookNormalisation {
  records: WorkbookRecord[];
  /** Lines that belong to no production row - blocking, and never attached to a neighbour. */
  orphans: Array<{ origin: RowOrigin; payload: Record<string, unknown>; issue: WorkbookIssue }>;
  /** Sheet-level problems: a missing Production sheet, unmapped required columns. */
  sheetIssues: WorkbookIssue[];
  counts: { production: number; consumption: number; outputs: number; orphans: number; duplicates: number };
}

export interface WorkbookSheets {
  production?: { rows: ReadonlyArray<Record<string, unknown>>; mapping: SheetMapping } | null;
  consumption?: { rows: ReadonlyArray<Record<string, unknown>>; mapping: SheetMapping } | null;
  outputs?: { rows: ReadonlyArray<Record<string, unknown>>; mapping: SheetMapping } | null;
}

const issue = (sheet: WorkbookSheetKind, sourceRowNumber: number, sourceRowId: string, field: string, messageAr: string, messageEn: string): WorkbookIssue =>
  ({ sheet, sourceRowNumber, sourceRowId, field, messageAr, messageEn });

/**
 * Folds the sheets into one production payload per production row. Pure: the
 * same workbook always produces the same records, in sheet order, and no input
 * is mutated.
 */
export function normaliseWorkbook(sheets: WorkbookSheets): WorkbookNormalisation {
  const sheetIssues: WorkbookIssue[] = [];
  const productionRows = sheets.production?.rows ?? [];
  const productionMapping = sheets.production?.mapping ?? null;

  if (!productionMapping) {
    sheetIssues.push(issue('production', 0, '', 'sheet', 'ورقة الإنتاج مفقودة - لا يمكن ربط الاستهلاك والمخرجات بدونها.', 'The Production sheet is missing - consumption and outputs cannot be linked without it.'));
  }
  for (const part of ['production', 'consumption', 'outputs'] as const) {
    const sheet = sheets[part];
    for (const field of sheet?.mapping.missingRequired ?? []) {
      sheetIssues.push(issue(part, 0, '', field, `عمود مطلوب غير مربوط في ورقة "${part}": ${field}.`, `A required column is not mapped in the "${part}" sheet: ${field}.`));
    }
  }

  // --- Production rows, keyed by their workbook id ------------------------------------------
  const records: WorkbookRecord[] = [];
  const byKey = new Map<string, WorkbookRecord[]>();
  productionRows.forEach((raw, i) => {
    const mapped = productionMapping ? applySheetMapping(raw, productionMapping) : {};
    const sourceRowId = text(mapped.sourceRowId);
    const sourceRowNumber = i + 2;
    const record: WorkbookRecord = {
      sourceRowId,
      sourceRowNumber,
      payload: { ...mapped },
      origins: [{ sheet: 'production', sourceRowNumber, sourceRowId, originalRowData: { ...raw } }],
      consumptionCount: 0,
      outputCount: 0,
      issues: [],
    };
    if (!sourceRowId) {
      record.issues.push(issue('production', sourceRowNumber, '', 'sourceRowId', 'مفتاح الربط (sourceRowId) فارغ - لا يمكن ربط سطور الاستهلاك أو المخرجات.', 'The relationship key (sourceRowId) is blank - consumption and output lines cannot be linked.'));
    } else {
      byKey.set(sourceRowId, [...(byKey.get(sourceRowId) ?? []), record]);
    }
    records.push(record);
  });

  let duplicates = 0;
  for (const [key, group] of byKey) {
    if (group.length < 2) continue;
    duplicates += group.length;
    for (const record of group) {
      record.issues.push(issue('production', record.sourceRowNumber, key, 'sourceRowId',
        `المفتاح "${key}" مستخدم في أكثر من صف إنتاج (${group.length}) - لا يمكن تحديد صاحب السطور.`,
        `Key "${key}" is used by more than one production row (${group.length}) - which record owns a line cannot be decided.`));
    }
  }

  // --- Lines attach to exactly one production row ---------------------------------------------
  const orphans: WorkbookNormalisation['orphans'] = [];
  const attach = (kind: 'consumption' | 'outputs', targetField: 'materials' | 'productionOutputs') => {
    const sheet = sheets[kind];
    if (!sheet) return 0;
    sheet.rows.forEach((raw, i) => {
      const mapped = applySheetMapping(raw, sheet.mapping);
      const sourceRowNumber = i + 2;
      const key = text(mapped.productionSourceRowId);
      const origin: RowOrigin = { sheet: kind, sourceRowNumber, sourceRowId: key, originalRowData: { ...raw } };
      const line: Record<string, unknown> = { ...mapped };
      delete line.productionSourceRowId;
      // A consumption line's input batch is a batch number like any other.
      if (kind === 'consumption' && line.inputBatchNumber !== undefined) {
        line.batchNumber = line.inputBatchNumber;
        delete line.inputBatchNumber;
      }
      if (!key) {
        orphans.push({ origin, payload: line, issue: issue(kind, sourceRowNumber, '', 'productionSourceRowId', 'مفتاح صف الإنتاج فارغ - لم يُربط السطر بأي سجل.', 'The production row key is blank - the line is attached to nothing.') });
        return;
      }
      const group = byKey.get(key) ?? [];
      if (group.length !== 1) {
        orphans.push({
          origin,
          payload: line,
          issue: issue(kind, sourceRowNumber, key, 'productionSourceRowId',
            group.length === 0 ? `لا يوجد صف إنتاج بالمفتاح "${key}".` : `المفتاح "${key}" مكرر في ورقة الإنتاج.`,
            group.length === 0 ? `No production row has the key "${key}".` : `Key "${key}" is duplicated in the Production sheet.`),
        });
        return;
      }
      const record = group[0];
      const list = Array.isArray(record.payload[targetField]) ? (record.payload[targetField] as Array<Record<string, unknown>>) : [];
      // Line identity within its record: what the sheet gave, else its position in sheet order.
      if (!text(line.lineId)) line.lineId = `L${list.length + 1}`;
      if (!text(line.sequence)) line.sequence = list.length + 1;
      record.payload[targetField] = [...list, line];
      record.origins.push(origin);
      if (kind === 'consumption') record.consumptionCount += 1;
      else record.outputCount += 1;
    });
    return sheet.rows.length;
  };
  const consumptionCount = attach('consumption', 'materials');
  const outputCount = attach('outputs', 'productionOutputs');

  // A line id repeated inside one record would make the line identity ambiguous.
  for (const record of records) {
    for (const [field, label] of [['materials', 'consumption'], ['productionOutputs', 'outputs']] as const) {
      const lines = Array.isArray(record.payload[field]) ? (record.payload[field] as Array<Record<string, unknown>>) : [];
      const seen = new Set<string>();
      for (const line of lines) {
        const id = text(line.lineId);
        if (!id) continue;
        if (seen.has(id)) {
          record.issues.push(issue(label === 'consumption' ? 'consumption' : 'outputs', record.sourceRowNumber, record.sourceRowId, `${field}.lineId`,
            `رقم السطر "${id}" مكرر داخل نفس سجل الإنتاج.`,
            `Line id "${id}" is used twice inside the same production record.`));
        }
        seen.add(id);
      }
    }
  }

  return {
    records,
    orphans,
    sheetIssues,
    counts: { production: productionRows.length, consumption: consumptionCount, outputs: outputCount, orphans: orphans.length, duplicates },
  };
}

/** The workbook issues of one record, as import-row issues. */
export function recordIssues(record: WorkbookRecord): Array<{ field: string; messageAr: string; messageEn: string }> {
  return record.issues.map((i) => ({
    field: `${i.sheet}.${i.field}`,
    messageAr: `ورقة ${i.sheet} صف ${i.sourceRowNumber}: ${i.messageAr}`,
    messageEn: `${i.sheet} sheet row ${i.sourceRowNumber}: ${i.messageEn}`,
  }));
}

/** The error-report rows for a workbook: sheet, row, key, field and message. */
export function workbookIssueReport(normalisation: WorkbookNormalisation): WorkbookIssue[] {
  return [
    ...normalisation.sheetIssues,
    ...normalisation.records.flatMap((r) => r.issues),
    ...normalisation.orphans.map((o) => o.issue),
  ];
}

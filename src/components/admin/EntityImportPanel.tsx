/**
 * Entity import review - Phase 1 Step 8C-2. Opened from the existing Historical
 * Excel Import centre.
 *
 * The same flow the other import panels already use, for the entities the
 * system defines: parse the file with the existing parser, validate every row
 * with the SAME rules its form uses, review and correct row by row, include,
 * skip or exclude, then write only the eligible rows - each on its own, so one
 * failure never touches another row.
 *
 * WHAT THE FILE SAID IS KEPT. Every row shows its source row number, and a
 * correction is stored beside the original, never over it. Failed rows stay in
 * the session and can be corrected and reprocessed under the SAME import id.
 *
 * NOTHING IS WRITTEN UNTIL THE FINAL CONFIRMATION, which states the exact counts.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { listImportSheetNames, parseImportFile } from '../../services/bulkImportService';
import {
  buildSheetMapping,
  normaliseWorkbook,
  recordIssues,
  sheetKindFor,
  workbookFieldsFor,
  workbookHeaders,
  workbookIssueReport,
} from '../../services/workbookImportPure';
import type { RowOrigin, SheetMapping, WorkbookNormalisation, WorkbookSheetKind } from '../../services/workbookImportPure';
import {
  AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE,
  isOdooManufacturingSheet,
  normaliseOdooManufacturingSheet,
  odooRecordWarnings,
  odooSheetStage,
} from '../../services/odooManufacturingImportPure';
import type { ProductionStageType } from '../../types';
import {
  IMPORT_ENTITY_KINDS,
  acceptRowWarnings,
  applyRowCorrection,
  applyValidation,
  createImportRow,
  createImportSession,
  setRowSelection,
  importConfirmation,
  isRowWritable,
  prepareRowForReprocess,
  replaceRow,
  rowPayload,
  summariseSession,
} from '../../services/entityImportPure';
import type { ImportEntityKind, ImportRow, ImportSession } from '../../services/entityImportPure';
import { resolveAndValidateImportRow } from '../../services/importEntityValidationPure';
import type { ImportValidationContext } from '../../services/importEntityValidationPure';
import { approveReferenceMapping } from '../../services/referenceResolutionPure';
import type { ReferenceIndexes, ReferenceMappingCache, ReferenceResolution } from '../../services/referenceResolutionPure';
import { buildImportReferenceIndexes, executeEntityImport, loadImportValidationContext } from '../../services/entityImportService';
import { buildMasterDataPackageSession, evaluatePackageRows, packageSessionCounts, packageSheetKind } from '../../services/masterDataPackageSessionPure';
import type { PackageSessionResult } from '../../services/masterDataPackageSessionPure';
import type { ImportExecutionProgress, ImportFinalResult } from '../../services/entityImportExecutionPure';
import { ImportProgressPanel } from './ImportProgressPanel';

/*
 * 3.21.2 - large imports. The last run's progress is kept in this browser as a
 * checkpoint, so a page closed mid-import is reported on the next visit with how
 * far it got. It holds counts only - never data - and a re-run is safe by design:
 * what was written is matched and updated, never duplicated.
 */
const LAST_RUN_KEY = 'asfour.entityImport.lastRun';
interface LastRunCheckpoint {
  importId: string;
  sourceFile: string;
  state: string;
  phase: string;
  processed: number;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Rows whose write outcome is unknown (timed out) - a re-run matches them, never duplicates them. */
  uncertain?: number;
  updatedAt: string;
}
function saveLastRun(checkpoint: LastRunCheckpoint): void {
  try { localStorage.setItem(LAST_RUN_KEY, JSON.stringify(checkpoint)); } catch { /* storage may be unavailable */ }
}
function readLastRun(): LastRunCheckpoint | null {
  try {
    const raw = localStorage.getItem(LAST_RUN_KEY);
    return raw ? (JSON.parse(raw) as LastRunCheckpoint) : null;
  } catch {
    return null;
  }
}
function clearLastRun(): void {
  try { localStorage.removeItem(LAST_RUN_KEY); } catch { /* storage may be unavailable */ }
}

/** Review-table filters: a 30,000-row package is shown a page at a time, never all at once. */
type RowFilter = 'ALL' | 'BLOCKING' | 'WARNING' | 'WILL_IMPORT' | 'IMPORTED' | 'FAILED' | 'NOT_WRITTEN';
const ROWS_PER_PAGE = 100;

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const KIND_LABELS: Record<ImportEntityKind, { ar: string; en: string }> = {
  jobReferences: { ar: 'أوامر الشغل والأوامر الفرعية', en: 'Jobs & sub-jobs' },
  batches: { ar: 'الدفعات', en: 'Batches' },
  boms: { ar: 'قوائم المواد', en: 'BOMs' },
  bomVersions: { ar: 'إصدارات قوائم المواد', en: 'BOM versions' },
  routings: { ar: 'المسارات', en: 'Routings' },
  routingVersions: { ar: 'إصدارات المسارات', en: 'Routing versions' },
  production: { ar: 'سجلات الإنتاج (مع الاستهلاك والمخرجات)', en: 'Production (with consumption & outputs)' },
  consumptionLine: { ar: 'سطر استهلاك غير مرتبط', en: 'Unlinked consumption line' },
  outputLine: { ar: 'سطر مخرجات غير مرتبط', en: 'Unlinked output line' },
  // Phase 1 Step 8D - the three-file Odoo import has its own panel; these labels
  // exist so every row kind has a name wherever a row is displayed.
  odooProduction: { ar: 'أمر تصنيع (mrp.production)', en: 'Manufacturing order (mrp.production)' },
  odooWorkOrder: { ar: 'أمر عمل (mrp.workorder)', en: 'Work order (mrp.workorder)' },
  odooScrap: { ar: 'هالك (stock.scrap)', en: 'Scrap (stock.scrap)' },
  // The reconciled Master Data package.
  products: { ar: 'المنتجات (Product Master)', en: 'Products (Product Master)' },
  materials: { ar: 'الخامات (Product Master)', en: 'Materials (Product Master)' },
  bomPackage: { ar: 'قائمة مواد بمكوناتها (Mixes)', en: 'BOM with its components (Mixes)' },
};

const STATUS_TONE: Record<string, string> = {
  VALID: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  READY_TO_IMPORT: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  CORRECTED: 'bg-sky-50 text-sky-800 border-sky-200',
  WARNING: 'bg-amber-50 text-amber-800 border-amber-200',
  BLOCKING: 'bg-rose-50 text-rose-800 border-rose-200',
  SKIPPED: 'bg-slate-100 text-slate-700 border-slate-300',
  EXCLUDED: 'bg-slate-100 text-slate-700 border-slate-300',
  IMPORTED: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  FAILED: 'bg-rose-100 text-rose-900 border-rose-300',
};

/** Arrays and objects arrive from Excel as JSON text; anything else is taken as written. */
function readCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  if ((t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'))) {
    try {
      return JSON.parse(t);
    } catch {
      return value;
    }
  }
  return value;
}

export const EntityImportPanel: React.FC<Props> = ({ isOpen, onClose }) => {
  const { language } = useLanguage();
  const { adminUser, hasPermission, isSuperAdmin } = useAuth();
  const isAr = language === 'ar';
  const canImport = isSuperAdmin || hasPermission('excel.import');

  const [kind, setKind] = useState<ImportEntityKind>('jobReferences');
  const [session, setSession] = useState<ImportSession | null>(null);
  const [context, setContext] = useState<ImportValidationContext>({});
  /** Step 8C-3: the session's code dictionaries, its approved mappings, and how each row resolved. */
  const [indexes, setIndexes] = useState<ReferenceIndexes>({});
  const [mappingCache, setMappingCache] = useState<ReferenceMappingCache>(new Map());
  const [resolutions, setResolutions] = useState<Record<string, ReferenceResolution[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ successCount: number; failedCount: number; droppedBeforeWrite: Array<{ rowId: string; reason: string }> } | null>(null);
  /** 3.21.2 - the loop's live snapshot while it runs, and its verified final result. */
  const [progress, setProgress] = useState<ImportExecutionProgress | null>(null);
  const [finalResult, setFinalResult] = useState<ImportFinalResult | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const stopRef = useRef(false);
  /** 3.21.4 - aborting it stops the run promptly, even while a write waits for the server. */
  const stopControllerRef = useRef<AbortController | null>(null);
  /** A single guard against a second import starting while one runs. */
  const runningRef = useRef(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<LastRunCheckpoint | null>(() => {
    const saved = readLastRun();
    return saved && (saved.state === 'IMPORTING' || saved.state === 'VERIFYING') ? saved : null;
  });
  const [rowFilter, setRowFilter] = useState<RowFilter>('ALL');
  const [page, setPage] = useState(0);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editField, setEditField] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editReason, setEditReason] = useState('');
  /*
   * Phase 1 Step 8C-4 - a workbook is Production + Consumption + Outputs, joined
   * by the workbook's own sourceRowId. The sheets are folded into the SAME
   * production payload the JSON mode produces, so one rule set serves both.
   */
  const [mode, setMode] = useState<'sheet' | 'workbook' | 'package'>('sheet');
  /*
   * Phase 1 Step 8E - the reconciled Master Data package (Product Master +
   * Mixes + Exceptions, split across part files). Every row is an UPSERT and
   * goes through this same review, validation and write path.
   */
  const [packageSession, setPackageSession] = useState<PackageSessionResult | null>(null);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [sheetRows, setSheetRows] = useState<Partial<Record<WorkbookSheetKind, Array<Record<string, unknown>>>>>({});
  const [manualMapping, setManualMapping] = useState<Partial<Record<WorkbookSheetKind, Record<string, string | null>>>>({});
  const [workbook, setWorkbook] = useState<WorkbookNormalisation | null>(null);
  const [relationships, setRelationships] = useState<Record<string, { consumption: number; outputs: number; origins: RowOrigin[] }>>({});
  const [workbookTab, setWorkbookTab] = useState<'rows' | 'mapping' | 'issues'>('rows');
  /*
   * Phase 1 Step 8C-5 - an Odoo manufacturing-order export (one sheet per area,
   * MO header + continuation rows) is folded by its own reader into the SAME
   * production payloads, then resolved and validated exactly like any workbook.
   * A sheet serving two stages (mortar / thermal concrete) waits for a choice.
   */
  const [odooSheets, setOdooSheets] = useState<Record<string, Array<Record<string, unknown>>>>({});
  const [odooStages, setOdooStages] = useState<Record<string, ProductionStageType>>({});

  const user = adminUser?.email ?? adminUser?.uid ?? 'unknown';
  const now = () => new Date().toISOString();
  const summary = useMemo(() => (session ? summariseSession(session) : null), [session]);

  /*
   * Master Data package: a BOM's status follows the rows it depends on. Whenever
   * the session changes (a warning accepted, a row excluded, a correction), every
   * BOM row is re-derived by the SAME rules the import applies before writing -
   * so the preview never shows as importable a BOM the import would drop.
   * evaluatePackageRows returns unchanged rows as the same objects, so this
   * settles after one pass.
   */
  useEffect(() => {
    if (mode !== 'package' || !packageSession || !session) return;
    const next = evaluatePackageRows(packageSession, session.rows);
    if (next.some((row, i) => row !== session.rows[i])) setSession({ ...session, rows: next });
  }, [mode, packageSession, session]);

  /** While an import runs, leaving or reloading the page asks first. */
  const importing = progress !== null && (progress.state === 'IMPORTING' || progress.state === 'VERIFYING');
  useEffect(() => {
    if (!importing) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [importing]);

  const filteredRows = useMemo(() => {
    if (!session) return [];
    const keep = (r: ImportRow) => {
      switch (rowFilter) {
        case 'BLOCKING': return r.errors.length > 0;
        case 'WARNING': return r.warnings.length > 0 && !r.warningsAccepted;
        case 'WILL_IMPORT': return isRowWritable(r);
        case 'IMPORTED': return r.status === 'IMPORTED';
        case 'FAILED': return r.status === 'FAILED';
        case 'NOT_WRITTEN': return r.status !== 'IMPORTED' && r.selection === 'INCLUDED';
        default: return true;
      }
    };
    return rowFilter === 'ALL' ? session.rows : session.rows.filter(keep);
  }, [session, rowFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / ROWS_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = filteredRows.slice(currentPage * ROWS_PER_PAGE, (currentPage + 1) * ROWS_PER_PAGE);

  /** The package counts from the rows as they stand now - what the import would actually do. */
  const packageCounts = useMemo(
    () => (packageSession && session ? packageSessionCounts(packageSession.staged, session.rows, packageSession.exceptions) : null),
    [packageSession, session],
  );

  /** Resolve the row's business codes, then validate it - one pipeline for every row. */
  const check = (row: ImportRow, ctx: ImportValidationContext, idx: ReferenceIndexes, cache: ReferenceMappingCache) => {
    const result = resolveAndValidateImportRow(row.entityKind, rowPayload(row), ctx, idx, cache);
    setResolutions((r) => ({ ...r, [row.rowId]: result.resolutions ?? [] }));
    return result;
  };
  const validateAll = (rows: ImportRow[], ctx: ImportValidationContext, idx: ReferenceIndexes, cache: ReferenceMappingCache): ImportRow[] => {
    const next: Record<string, ReferenceResolution[]> = {};
    const checked = rows.map((row) => {
      const result = resolveAndValidateImportRow(row.entityKind, rowPayload(row), ctx, idx, cache);
      next[row.rowId] = result.resolutions ?? [];
      return applyValidation(row, result);
    });
    setResolutions(next);
    return checked;
  };

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const parsed = await parseImportFile(file);
      const stageType = kind === 'production' ? String(parsed[0]?.stageType ?? '') : undefined;
      const ctx = await loadImportValidationContext(stageType);
      const idx = await buildImportReferenceIndexes(ctx, stageType);
      const rows = parsed.map((raw, i) => {
        const cells = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, readCell(v)]));
        return createImportRow(kind, i + 2, cells);
      });
      const cache: ReferenceMappingCache = new Map();
      setContext(ctx);
      setIndexes(idx);
      setMappingCache(cache);
      setSession(createImportSession({
        importId: `IMP-${Date.now()}`,
        sourceFile: file.name,
        sourceSheet: '',
        createdBy: user,
        createdAt: now(),
        rows: validateAll(rows, ctx, idx, cache),
      }));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const mappingFor = (sheet: WorkbookSheetKind, rows: Array<Record<string, unknown>> | undefined): SheetMapping | null =>
    rows && rows.length ? buildSheetMapping(sheet, workbookHeaders(rows), manualMapping[sheet] ?? {}) : null;

  /** Folds the sheets into production payloads, then resolves and validates each one. */
  const buildWorkbookSession = (
    rowsBySheet: Partial<Record<WorkbookSheetKind, Array<Record<string, unknown>>>>,
    manual: Partial<Record<WorkbookSheetKind, Record<string, string | null>>>,
    ctx: ImportValidationContext,
    idx: ReferenceIndexes,
    cache: ReferenceMappingCache,
    file: File,
    importId: string,
  ) => {
    const sheetOf = (sheet: WorkbookSheetKind) => {
      const rows = rowsBySheet[sheet];
      if (!rows || !rows.length) return null;
      return { rows, mapping: buildSheetMapping(sheet, workbookHeaders(rows), manual[sheet] ?? {}) };
    };
    const normalisation = normaliseWorkbook({ production: sheetOf('production'), consumption: sheetOf('consumption'), outputs: sheetOf('outputs') });
    const nextResolutions: Record<string, ReferenceResolution[]> = {};
    const nextRelationships: Record<string, { consumption: number; outputs: number; origins: RowOrigin[] }> = {};

    const productionRows = normalisation.records.map((record) => {
      const row = createImportRow('production', record.sourceRowNumber, record.payload, `production:${record.sourceRowId || record.sourceRowNumber}`);
      const result = resolveAndValidateImportRow('production', rowPayload(row), ctx, idx, cache);
      nextResolutions[row.rowId] = result.resolutions ?? [];
      nextRelationships[row.rowId] = { consumption: record.consumptionCount, outputs: record.outputCount, origins: record.origins };
      // A workbook problem (a duplicate key, a line this record owns) blocks THIS record only.
      const workbookErrors = recordIssues(record);
      return applyValidation(row, {
        errors: [...workbookErrors, ...result.errors],
        warnings: result.warnings,
        normalized: workbookErrors.length ? null : result.normalized,
      });
    });

    // An orphan line is visible as its own row - never attached to a neighbouring record.
    const orphanRows = normalisation.orphans.map((orphan, i) => {
      const kind = orphan.origin.sheet === 'consumption' ? 'consumptionLine' : 'outputLine';
      const row = createImportRow(kind, orphan.origin.sourceRowNumber, orphan.payload, `${kind}:${orphan.origin.sourceRowNumber}:${i}`);
      nextRelationships[row.rowId] = { consumption: 0, outputs: 0, origins: [orphan.origin] };
      return applyValidation(row, {
        errors: [{ field: `${orphan.issue.sheet}.${orphan.issue.field}`, messageAr: orphan.issue.messageAr, messageEn: orphan.issue.messageEn }],
        warnings: [],
        normalized: null,
      });
    });

    setResolutions(nextResolutions);
    setRelationships(nextRelationships);
    setWorkbook(normalisation);
    return createImportSession({
      importId,
      sourceFile: file.name,
      sourceSheet: 'Production + Consumption + Outputs',
      createdBy: user,
      createdAt: now(),
      rows: [...productionRows, ...orphanRows],
    });
  };

  /** Step 8C-5: one Odoo MO sheet per area -> production rows, each resolved and validated as usual. */
  const buildOdooSession = (
    sheets: Record<string, Array<Record<string, unknown>>>,
    stages: Record<string, ProductionStageType>,
    ctx: ImportValidationContext,
    idx: ReferenceIndexes,
    cache: ReferenceMappingCache,
    file: File,
    importId: string,
  ) => {
    const nextResolutions: Record<string, ReferenceResolution[]> = {};
    const nextRelationships: Record<string, { consumption: number; outputs: number; origins: RowOrigin[] }> = {};
    const merged: WorkbookNormalisation = { records: [], orphans: [], sheetIssues: [], counts: { production: 0, consumption: 0, outputs: 0, orphans: 0, duplicates: 0 } };
    const rows: ImportRow[] = [];
    for (const [sheetName, rowsOfSheet] of Object.entries(sheets)) {
      const folded = normaliseOdooManufacturingSheet(sheetName, rowsOfSheet, { stageOverride: stages[sheetName] ?? null });
      const sheetErrors = folded.sheetIssues.map((i) => ({ field: `${sheetName}.${i.field}`, messageAr: `${sheetName}: ${i.messageAr}`, messageEn: `${sheetName}: ${i.messageEn}` }));
      merged.records.push(...folded.records);
      merged.orphans.push(...folded.orphans);
      merged.sheetIssues.push(...folded.sheetIssues.map((i) => ({ ...i, messageAr: `${sheetName}: ${i.messageAr}`, messageEn: `${sheetName}: ${i.messageEn}` })));
      for (const k of Object.keys(merged.counts) as Array<keyof WorkbookNormalisation['counts']>) merged.counts[k] += folded.counts[k];
      for (const record of folded.records) {
        const row = createImportRow('production', record.sourceRowNumber, record.payload, `production:${sheetName}:${record.sourceRowId || record.sourceRowNumber}`);
        const result = resolveAndValidateImportRow('production', rowPayload(row), ctx, idx, cache);
        nextResolutions[row.rowId] = result.resolutions ?? [];
        nextRelationships[row.rowId] = { consumption: record.consumptionCount, outputs: record.outputCount, origins: record.origins };
        const blocking = [...sheetErrors, ...recordIssues(record)];
        rows.push(applyValidation(row, {
          errors: [...blocking, ...result.errors],
          warnings: [...odooRecordWarnings(record), ...result.warnings],
          normalized: blocking.length ? null : result.normalized,
        }));
      }
      folded.orphans.forEach((orphan, i) => {
        const lineKind = orphan.origin.sheet === 'consumption' ? 'consumptionLine' : 'outputLine';
        const row = createImportRow(lineKind, orphan.origin.sourceRowNumber, orphan.payload, `${lineKind}:${sheetName}:${orphan.origin.sourceRowNumber}:${i}`);
        nextRelationships[row.rowId] = { consumption: 0, outputs: 0, origins: [orphan.origin] };
        rows.push(applyValidation(row, {
          errors: [{ field: `${orphan.issue.sheet}.${orphan.issue.field}`, messageAr: orphan.issue.messageAr, messageEn: orphan.issue.messageEn }],
          warnings: [],
          normalized: null,
        }));
      });
    }
    setResolutions(nextResolutions);
    setRelationships(nextRelationships);
    setWorkbook(merged);
    return createImportSession({
      importId,
      sourceFile: file.name,
      sourceSheet: `Odoo MO: ${Object.keys(sheets).join(' + ')}`,
      createdBy: user,
      createdAt: now(),
      rows,
    });
  };

  /** Step 8C-5: choosing the stage of an ambiguous Odoo sheet re-folds it and revalidates. */
  const setOdooSheetStage = (sheetName: string, stage: ProductionStageType | '') => {
    const next = { ...odooStages };
    if (stage) next[sheetName] = stage;
    else delete next[sheetName];
    setOdooStages(next);
    if (!workbookFile || !session) return;
    setSession(buildOdooSession(odooSheets, next, context, indexes, mappingCache, workbookFile, session.importId));
  };

  /** The whole package at once: each file's sheets are recognised by their own columns. */
  const onPackage = async (files: FileList | File[]) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const productSheets: Array<{ fileName: string; sheetName: string; rows: Array<Record<string, unknown>> }> = [];
      const mixSheets: typeof productSheets = [];
      const exceptionSheets: typeof productSheets = [];
      const unknown: string[] = [];
      const fileList = Array.from(files);
      for (const [fileIndex, file] of fileList.entries()) {
        setUploadStatus(isAr ? `جارٍ قراءة الملف ${fileIndex + 1} من ${fileList.length}: ${file.name}` : `Reading file ${fileIndex + 1} of ${fileList.length}: ${file.name}`);
        // One file at a time, handing the browser a turn in between, so the page stays responsive.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        for (const sheetName of await listImportSheetNames(file)) {
          const rows = await parseImportFile(file, sheetName);
          if (!rows.length) continue;
          const kind = packageSheetKind(workbookHeaders(rows));
          const entry = { fileName: file.name, sheetName, rows };
          if (kind === 'PRODUCT_MASTER') productSheets.push(entry);
          else if (kind === 'MIXES') mixSheets.push(entry);
          else if (kind === 'EXCEPTIONS') exceptionSheets.push(entry);
          else unknown.push(`${file.name} / ${sheetName}`);
        }
      }
      if (productSheets.length === 0 && mixSheets.length === 0) {
        throw new Error(isAr ? 'لم يتم التعرف على أي ورقة من حزمة البيانات الأساسية.' : 'No Master Data package sheet was recognised.');
      }
      // What ASFOUR already holds decides CREATE vs UPDATE for every row.
      setUploadStatus(isAr ? 'جارٍ تحميل البيانات الأساسية الحالية وبناء المعاينة...' : 'Loading the current master data and building the preview...');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const ctx = await loadImportValidationContext();
      const idx = await buildImportReferenceIndexes(ctx);
      setContext(ctx);
      setIndexes(idx);
      setMappingCache(new Map());
      const built = buildMasterDataPackageSession({
        importSessionId: `MDP-${Date.now()}`,
        productSheets,
        mixSheets,
        exceptionSheets,
        existing: { products: ctx.products, materials: ctx.materials, boms: ctx.boms, bomVersions: ctx.bomVersions },
        // The same context the import revalidates against (customers, logical items...).
        validationContext: ctx,
      });
      setPackageSession(built);
      setWorkbook(null);
      setProgress(null);
      setFinalResult(null);
      setPage(0);
      setRowFilter('ALL');
      setSession(createImportSession({
        importId: built.importSessionId,
        sourceFile: Array.from(files).map((f) => f.name).join(', '),
        sourceSheet: `Master Data package (${productSheets.length} product + ${mixSheets.length} mixes)`,
        createdBy: user,
        createdAt: now(),
        rows: built.staged.map((s) => s.row),
      }));
      if (unknown.length) setError(isAr ? `أوراق لم يتم التعرف عليها: ${unknown.join('، ')}` : `Unrecognised sheets: ${unknown.join(', ')}`);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setUploadStatus(null);
      setBusy(false);
    }
  };

  /** Accepts the warnings of every row that carries them - one explicit review decision. */
  const acceptAllWarnings = () => {
    setSession((s) => (s ? { ...s, rows: s.rows.map((r) => (r.warnings.length > 0 && !r.warningsAccepted ? acceptRowWarnings(r, { user, at: now() }) : r)) } : s));
  };

  const onWorkbook = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const names = await listImportSheetNames(file);
      // Step 8C-5: an Odoo manufacturing-order export is recognised by its columns, sheet by sheet.
      const odoo: Record<string, Array<Record<string, unknown>>> = {};
      for (const name of names) {
        const parsed = await parseImportFile(file, name);
        if (parsed.length && isOdooManufacturingSheet(workbookHeaders(parsed))) odoo[name] = parsed;
      }
      if (Object.keys(odoo).length > 0) {
        const stagesInFile = [...new Set(Object.keys(odoo).map((n) => odooSheetStage(n)).flatMap((s) =>
          s === AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE ? ['mortar_concrete', 'thermal_concrete'] : s ? [s] : []))];
        const ctx = await loadImportValidationContext(stagesInFile);
        const idx = await buildImportReferenceIndexes(ctx, stagesInFile);
        const cache: ReferenceMappingCache = new Map();
        setContext(ctx);
        setIndexes(idx);
        setMappingCache(cache);
        setWorkbookFile(file);
        setSheetRows({});
        setManualMapping({});
        setOdooSheets(odoo);
        setOdooStages({});
        setSession(buildOdooSession(odoo, {}, ctx, idx, cache, file, `IMP-${Date.now()}`));
        setWorkbookTab('rows');
        return;
      }
      setOdooSheets({});
      const rowsBySheet: Partial<Record<WorkbookSheetKind, Array<Record<string, unknown>>>> = {};
      for (const name of names) {
        const kind = sheetKindFor(name);
        if (!kind || rowsBySheet[kind]) continue;
        const parsed = await parseImportFile(file, name);
        rowsBySheet[kind] = parsed.map((raw) => Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, readCell(v)])));
      }
      if (!rowsBySheet.production) {
        throw new Error(isAr
          ? 'لم يتم العثور على ورقة "Production" في الملف - المصنف يحتاج ورقة إنتاج واحدة على الأقل.'
          : 'No "Production" sheet was found in the workbook - at least a Production sheet is required.');
      }
      const stageType = String(rowsBySheet.production[0]?.stageType ?? rowsBySheet.production[0]?.['Stage Type'] ?? '');
      const ctx = await loadImportValidationContext(stageType || undefined);
      const idx = await buildImportReferenceIndexes(ctx, stageType || undefined);
      const cache: ReferenceMappingCache = new Map();
      setContext(ctx);
      setIndexes(idx);
      setMappingCache(cache);
      setWorkbookFile(file);
      setSheetRows(rowsBySheet);
      setManualMapping({});
      setSession(buildWorkbookSession(rowsBySheet, {}, ctx, idx, cache, file, `IMP-${Date.now()}`));
      setWorkbookTab('rows');
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  /** A manual column mapping re-folds the workbook and revalidates - mapping never skips validation. */
  const setColumnMapping = (sheet: WorkbookSheetKind, column: string, field: string | null) => {
    const manual = { ...manualMapping, [sheet]: { ...(manualMapping[sheet] ?? {}), [column]: field } };
    setManualMapping(manual);
    if (!workbookFile || !session) return;
    setSession(buildWorkbookSession(sheetRows, manual, context, indexes, mappingCache, workbookFile, session.importId));
  };

  const update = (row: ImportRow) => setSession((s) => (s ? replaceRow(s, row) : s));
  const revalidate = (row: ImportRow, cache: ReferenceMappingCache = mappingCache) =>
    applyValidation(row, check(row, context, indexes, cache), { user, at: now() });

  /**
   * Approving a suggested or chosen record: it is applied to this row AND
   * remembered for every later row naming the same value in this import.
   */
  const approveMapping = (row: ImportRow, resolution: ReferenceResolution, targetId: string) => {
    const nextCache = approveReferenceMapping(mappingCache, resolution.entity, resolution.sourceValue, targetId);
    setMappingCache(nextCache);
    setSession((s) => (s ? { ...s, rows: s.rows.map((r) => (r.errors.length > 0 || r.rowId === row.rowId ? revalidate(r, nextCache) : r)) } : s));
  };

  const saveCorrection = () => {
    if (!session || !editingRowId || !editField.trim()) return;
    const row = session.rows.find((r) => r.rowId === editingRowId);
    if (!row) return;
    const corrected = applyRowCorrection(row, { [editField.trim()]: readCell(editValue) }, { user, at: now(), reason: editReason });
    update(revalidate(corrected));
    setEditingRowId(null);
    setEditField('');
    setEditValue('');
    setEditReason('');
  };

  const execute = async () => {
    if (!session || runningRef.current) return;
    // A package BOM's status is re-derived one last time, so the confirmed count is the written count.
    const toRun = mode === 'package' && packageSession ? { ...session, rows: evaluatePackageRows(packageSession, session.rows) } : session;
    if (!window.confirm(importConfirmation(toRun, isAr ? 'ar' : 'en'))) return;
    runningRef.current = true;
    stopRef.current = false;
    stopControllerRef.current = new AbortController();
    setStopRequested(false);
    setBusy(true);
    setError(null);
    setResult(null);
    setFinalResult(null);
    setLastRun(null);
    const packageRun = mode === 'package';
    const checkpoint = (p: ImportExecutionProgress) => saveLastRun({
      importId: toRun.importId, sourceFile: toRun.sourceFile, state: p.state, phase: p.phase,
      processed: p.processed, total: p.total, succeeded: p.succeeded, failed: p.failed, skipped: p.skipped, uncertain: p.uncertain, updatedAt: now(),
    });
    try {
      const outcome = await executeEntityImport(toRun, context, {
        indexes, mappingCache, user, at: now, language: isAr ? 'ar' : 'en', canEdit: canImport,
        // Batches keep the page responsive; the loop reports after each one.
        batchSize: 250,
        // Only the de-duplicated Master Data package writes a few rows at once; every
        // other import keeps its strict one-row-at-a-time order.
        concurrency: packageRun ? 4 : 1,
        // A lost connection or a refused permission stops the run instead of failing 30,000 rows one by one.
        maxConsecutiveFailures: packageRun ? 25 : undefined,
        shouldStop: () => stopRef.current,
        stopSignal: stopControllerRef.current.signal,
        // 3.21.5 - recorded on every timeout, so a stall can be diagnosed afterwards.
        environment: () => ({
          online: typeof navigator === 'undefined' ? null : navigator.onLine !== false,
          visibility: typeof document === 'undefined' ? null : document.visibilityState,
        }),
        describeSource: (row) => {
          const provenance = packageSession?.staged.find((s) => s.row.rowId === row.rowId)?.provenance;
          return provenance ? { file: provenance.sourceFile, row: provenance.sourceRow } : { row: row.sourceRowNumber };
        },
        onProgress: (p) => {
          setProgress(p);
          checkpoint(p);
        },
      });
      setSession(outcome.session);
      setResult({ successCount: outcome.successCount, failedCount: outcome.failedCount, droppedBeforeWrite: outcome.droppedBeforeWrite });
      setFinalResult(outcome.final);
      saveLastRun({
        importId: toRun.importId, sourceFile: toRun.sourceFile, state: outcome.final.outcome, phase: outcome.final.stoppedIn ?? 'DONE',
        processed: outcome.final.processed, total: outcome.final.total, succeeded: outcome.final.succeeded, failed: outcome.final.failed, skipped: outcome.final.skipped, uncertain: outcome.final.uncertain, updatedAt: now(),
      });
    } catch (err: any) {
      // The loop itself never throws; anything here is outside it. The screen stays usable.
      setError(String(err?.message ?? err));
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  };

  const requestStop = () => {
    stopRef.current = true;
    stopControllerRef.current?.abort();
    setStopRequested(true);
  };

  const reprocessFailed = () => {
    if (!session) return;
    // The same import id, the same rows - only the failed ones return to review.
    setSession({ ...session, rows: session.rows.map((r) => (r.status === 'FAILED' ? revalidate(prepareRowForReprocess(r)) : r)) });
    setResult(null);
    setFinalResult(null);
    setProgress(null);
  };

  const cell = 'px-2 py-1.5 align-top';

  return (
    <Modal
      id="entity-import-panel"
      isOpen={isOpen}
      onClose={() => { if (!busy) onClose(); }}
      title={isAr ? 'استيراد الكيانات (أوامر الشغل، الدفعات، قوائم المواد، المسارات، الإنتاج)' : 'Entity import (jobs, batches, BOMs, routings, production)'}
      subtitle={isAr ? 'نفس قواعد التحقق المستخدمة في الشاشات - لا يُكتب أي سطر إلا بعد المراجعة والتأكيد' : 'The same validation the screens use - no row is written before review and confirmation'}
      maxWidth="4xl"
    >
      <div className="space-y-3 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        {!canImport && (
          <p className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-bold text-amber-900">
            {isAr ? 'لا تملك صلاحية الاستيراد - يمكنك المراجعة فقط.' : 'You do not have the import right - you may review only.'}
          </p>
        )}
        {error && <p className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold text-rose-800">{error}</p>}
        {lastRun && !progress && (
          <div id="entity-import-last-run" className="bg-amber-50 border border-amber-300 rounded-xl px-3 py-2 text-amber-950 space-y-1">
            <p className="font-bold">
              {isAr
                ? `استيراد سابق (${lastRun.importId}) لم يكتمل: توقف عند ${lastRun.processed.toLocaleString('ar-EG')} من ${lastRun.total.toLocaleString('ar-EG')} سجل (نجح ${lastRun.succeeded.toLocaleString('ar-EG')}، فشل ${lastRun.failed.toLocaleString('ar-EG')}).`
                : `A previous import (${lastRun.importId}) did not finish: it stopped at ${lastRun.processed.toLocaleString()} of ${lastRun.total.toLocaleString()} records (${lastRun.succeeded.toLocaleString()} successful, ${lastRun.failed.toLocaleString()} failed${lastRun.uncertain ? `, ${lastRun.uncertain.toLocaleString()} with unknown outcome` : ''}).`}
            </p>
            <p>
              {isAr
                ? 'ما كُتب محفوظ. للاستئناف بأمان: ارفع نفس الحزمة مرة أخرى واستورد - السجلات الموجودة تُحدَّث ولا تتكرر.'
                : 'What was written is kept. To resume safely, upload the same package again and import - existing records are updated, never duplicated.'}
            </p>
            <button type="button" onClick={() => { clearLastRun(); setLastRun(null); }} className="px-2 py-1 rounded-lg bg-white border border-amber-300 font-bold cursor-pointer">{isAr ? 'تم' : 'Dismiss'}</button>
          </div>
        )}
        {uploadStatus && (
          <p id="entity-import-upload-status" className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 font-bold text-sky-900 flex items-center gap-1.5" aria-live="polite">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />{uploadStatus}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select
            id="entity-import-mode"
            value={mode}
            disabled={busy}
            onChange={(e) => { setMode(e.target.value as 'sheet' | 'workbook'); setSession(null); setWorkbook(null); setResult(null); setPackageSession(null); }}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
          >
            <option value="sheet">{isAr ? 'ورقة واحدة لكل كيان' : 'One sheet per entity'}</option>
            <option value="workbook">{isAr ? 'مصنف إنتاج (إنتاج + استهلاك + مخرجات)' : 'Production workbook (Production + Consumption + Outputs)'}</option>
            <option value="package">{isAr ? 'حزمة البيانات الأساسية (منتجات + خلطات + استثناءات)' : 'Master Data package (products + mixes + exceptions)'}</option>
          </select>
          {mode === 'package' && (
            <label className="inline-flex items-center gap-1.5 px-3 py-2 font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              {isAr ? 'اختر كل ملفات الحزمة' : 'Choose every package file'}
              <input
                id="entity-import-package-files"
                type="file"
                accept=".xlsx,.xls"
                multiple
                disabled={busy}
                className="hidden"
                onChange={(e) => {
                  // Copied before the input is cleared, so choosing the same files again always re-reads them.
                  const f = e.target.files ? Array.from(e.target.files) : [];
                  e.target.value = '';
                  if (f.length) void onPackage(f);
                }}
              />
            </label>
          )}
          {mode === 'workbook' && (
            <label className="inline-flex items-center gap-1.5 px-3 py-2 font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              {isAr ? 'اختر مصنف الإنتاج' : 'Choose the production workbook'}
              <input id="entity-import-workbook-file" type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onWorkbook(f); }} />
            </label>
          )}
          {mode === 'sheet' && (
          <select
            id="entity-import-kind"
            value={kind}
            onChange={(e) => { setKind(e.target.value as ImportEntityKind); setSession(null); setResult(null); }}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold"
          >
            {IMPORT_ENTITY_KINDS.map((k) => <option key={k} value={k}>{isAr ? KIND_LABELS[k].ar : KIND_LABELS[k].en}</option>)}
          </select>
          )}
          {mode === 'sheet' && (
          <label className="inline-flex items-center gap-1.5 px-3 py-2 font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            {isAr ? 'اختر ملف Excel' : 'Choose an Excel file'}
            <input id="entity-import-file" type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
          </label>
          )}
          {busy && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
          {session && <span className="font-mono text-slate-500">{session.importId} · {session.sourceFile}</span>}
        </div>

        {packageSession && (
          <div id="entity-import-package" className="space-y-2 border border-slate-200 rounded-xl p-2">
            <div className="flex flex-wrap gap-1.5">
              {([
                ['products', isAr ? 'منتجات' : 'Products'],
                ['productsToCreate', isAr ? 'جديدة' : 'To create'],
                ['productsToUpdate', isAr ? 'تحديث' : 'To update'],
                ['productsWillImport', isAr ? 'منتجات ستُستورد' : 'Products to import'],
                ['materials', isAr ? 'خامات' : 'Materials'],
                ['materialsToCreate', isAr ? 'خامات جديدة' : 'Materials to create'],
                ['materialsToUpdate', isAr ? 'خامات للتحديث' : 'Materials to update'],
                ['materialsWillImport', isAr ? 'خامات ستُستورد' : 'Materials to import'],
                ['boms', isAr ? 'قوائم مواد' : 'BOMs'],
                ['bomsValid', isAr ? 'قوائم صالحة' : 'BOMs valid'],
                ['bomsBlockedByData', isAr ? 'قوائم بها خطأ بيانات' : 'BOMs blocked by data'],
                ['bomsWaitingForItems', isAr ? 'قوائم تنتظر أصنافها' : 'BOMs waiting for their items'],
                ['bomsWillImport', isAr ? 'قوائم ستُستورد' : 'BOMs to import'],
                ['bomComponents', isAr ? 'مكوّنات' : 'Components'],
                ['ready', isAr ? 'جاهز' : 'Ready'],
                ['skippedDuplicates', isAr ? 'مكرر (متخطى)' : 'Duplicates (skipped)'],
                ['deferredUnsupportedUom', isAr ? 'مؤجَّل (وحدة غير مدعومة)' : 'Deferred (unsupported UOM)'],
                ['blocking', isAr ? 'مانع' : 'Blocking'],
                ['exceptions', isAr ? 'استثناءات' : 'Exceptions'],
              ] as const).map(([key, label]) => (
                <span key={key} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200">
                  {label}: <span className="font-bold">{(packageCounts ?? packageSession.counts)[key] ?? 0}</span>
                </span>
              ))}
              <button type="button" onClick={acceptAllWarnings} disabled={busy} className="px-2 py-1 rounded-lg bg-amber-50 border border-amber-200 font-bold cursor-pointer disabled:opacity-50">
                {isAr ? 'قبول كل التحذيرات' : 'Accept all warnings'}
              </button>
            </div>
            {packageSession.unresolvedUnits.length > 0 && (
              <p className="text-rose-700 font-bold">
                {isAr ? 'وحدات غير معتمدة (لم تُخمَّن):' : 'Units ASFOUR does not approve (never guessed):'}{' '}
                {packageSession.unresolvedUnits.map((u) => `${u.unit} (${u.rows})`).join('، ')}
              </p>
            )}
            {packageSession.deferred.length > 0 && (
              <div className="overflow-x-auto max-h-40 overflow-y-auto border border-slate-200 rounded-lg">
                <p className="px-2 py-1 font-black text-slate-800">
                  {isAr ? 'صفوف محفوظة وغير مستوردة الآن (متخطاة / مؤجَّلة)' : 'Rows kept and not imported now (skipped / deferred)'}
                </p>
                <table id="entity-import-package-deferred" className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    <th className={cell}>{isAr ? 'السبب' : 'Reason'}</th>
                    <th className={cell}>{isAr ? 'الكود' : 'Code'}</th>
                    <th className={cell}>{isAr ? 'الاسم' : 'Name'}</th>
                    <th className={cell}>{isAr ? 'التفصيل' : 'Detail'}</th>
                    <th className={cell}>{isAr ? 'المصدر' : 'Source'}</th>
                  </tr></thead>
                  <tbody>
                    {packageSession.deferred.slice(0, 500).map((d) => (
                      <tr key={d.rowId} className="border-t border-slate-100">
                        <td className={`${cell} font-mono ${d.reason === 'UNSUPPORTED_UOM' ? 'text-amber-700' : 'text-slate-600'}`}>{d.reason}</td>
                        <td className={`${cell} font-mono`}>{d.code}</td>
                        <td className={cell}>{d.name}</td>
                        <td className={cell}>{d.detail}</td>
                        <td className={`${cell} font-mono text-slate-500`}>{d.sourceFile}:{d.sourceRow}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {packageSession.deferred.length > 500 && (
                  <p className="px-2 py-1 text-slate-500">
                    {isAr ? `و${packageSession.deferred.length - 500} صفًا آخر` : `and ${packageSession.deferred.length - 500} more row(s)`}
                  </p>
                )}
              </div>
            )}

            {packageSession.exceptions.length > 0 && (
              <div className="overflow-x-auto max-h-40 overflow-y-auto border border-slate-200 rounded-lg">
                <table id="entity-import-package-exceptions" className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-600"><tr>
                    <th className={cell}>{isAr ? 'النوع' : 'Type'}</th>
                    <th className={cell}>{isAr ? 'المفتاح' : 'Key'}</th>
                    <th className={cell}>{isAr ? 'مانع؟' : 'Blocking?'}</th>
                    <th className={cell}>{isAr ? 'القرار' : 'Decision'}</th>
                  </tr></thead>
                  <tbody>
                    {packageSession.exceptions.map((ex, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className={`${cell} font-mono`}>{ex.type}</td>
                        <td className={`${cell} font-mono`}>{ex.key}</td>
                        <td className={cell}>{ex.blocking ? (isAr ? 'نعم' : 'Yes') : (isAr ? 'لا' : 'No')}</td>
                        <td className={cell}>{ex.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {session && summary && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['total', isAr ? 'الإجمالي' : 'Total'], ['selected', isAr ? 'المحدد' : 'Selected'], ['ready', isAr ? 'جاهز' : 'Ready'],
                ['corrected', isAr ? 'مصحح' : 'Corrected'], ['warnings', isAr ? 'تحذيرات' : 'Warnings'], ['blocking', isAr ? 'مانع' : 'Blocking'],
                ['skipped', isAr ? 'متخطى' : 'Skipped'], ['excluded', isAr ? 'مستبعد' : 'Excluded'], ['willImport', isAr ? 'سيتم استيراده' : 'Will import'],
                // Session totals: every run made in this window. The run's own result is the panel below.
                ['imported', isAr ? 'مستورد (كل عمليات هذه النافذة)' : 'Imported (all runs in this window)'], ['failed', isAr ? 'فاشل (كل عمليات هذه النافذة)' : 'Failed (all runs in this window)'],
              ] as const).map(([k, label]) => (
                <span key={k} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200">
                  {label}: <span className="font-bold">{summary[k]}</span>
                </span>
              ))}
            </div>

            {/* 3.21.2 - READY / IMPORTING / VERIFYING / COMPLETED / COMPLETED WITH ERRORS / INTERRUPTED, from the loop's own numbers */}
            <ImportProgressPanel
              isAr={isAr}
              progress={finalResult ? null : progress}
              final={finalResult}
              readyCount={busy ? undefined : summary.willImport}
              onStop={importing ? requestStop : undefined}
              stopRequested={stopRequested}
              onClose={finalResult && !busy ? onClose : undefined}
            />
            {result && result.failedCount > 0 && !busy && (
              <button id="entity-import-reprocess" type="button" onClick={reprocessFailed} className="inline-flex items-center gap-1.5 px-3 py-1.5 font-bold bg-white border border-emerald-300 rounded-lg cursor-pointer">
                <RefreshCw className="w-3.5 h-3.5" />{isAr ? 'إعادة مراجعة السطور الفاشلة' : 'Review failed rows again'}
              </button>
            )}

            {workbook && (
              <div id="entity-import-workbook" className="space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['rows', 'mapping', 'issues'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setWorkbookTab(t)} className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${workbookTab === t ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-700'}`}>
                      {t === 'rows' ? (isAr ? 'العلاقات' : 'Relationships') : t === 'mapping' ? (isAr ? 'ربط الأعمدة' : 'Column mapping') : (isAr ? 'مشاكل المصنف' : 'Workbook issues')}
                    </button>
                  ))}
                  <span className="ms-auto text-slate-600">
                    {isAr ? 'إنتاج' : 'Production'}: <b>{workbook.counts.production}</b> · {isAr ? 'استهلاك' : 'Consumption'}: <b>{workbook.counts.consumption}</b> · {isAr ? 'مخرجات' : 'Outputs'}: <b>{workbook.counts.outputs}</b> · {isAr ? 'غير مرتبط' : 'Orphans'}: <b className={workbook.counts.orphans ? 'text-rose-700' : ''}>{workbook.counts.orphans}</b>
                  </span>
                </div>

                {Object.keys(odooSheets).length > 0 && (
                  <div id="entity-import-odoo-sheets" className="border border-slate-200 rounded-xl p-2 space-y-1.5">
                    <p className="font-black text-slate-800">{isAr ? 'أوراق أوامر تصنيع أودو' : 'Odoo manufacturing-order sheets'}</p>
                    {Object.keys(odooSheets).map((name) => {
                      const detected = odooSheetStage(name);
                      const ambiguous = detected === AMBIGUOUS_MORTAR_OR_THERMAL_CONCRETE;
                      return (
                        <div key={name} className="flex flex-wrap items-center gap-2">
                          <span className="font-bold">{name}</span>
                          <span className="text-slate-400">&rarr;</span>
                          {ambiguous ? (
                            <select
                              value={odooStages[name] ?? ''}
                              onChange={(e) => setOdooSheetStage(name, e.target.value as ProductionStageType | '')}
                              className={`px-2 py-1 border rounded-lg ${odooStages[name] ? 'border-sky-300 bg-sky-50' : 'border-rose-300 bg-rose-50'}`}
                            >
                              <option value="">{isAr ? '- اختر المرحلة (مونة أم خرسانة حرارية) -' : '- choose the stage (mortar or thermal concrete) -'}</option>
                              <option value="mortar_concrete">mortar_concrete</option>
                              <option value="thermal_concrete">thermal_concrete</option>
                            </select>
                          ) : (
                            <span className="font-mono">{detected ?? (isAr ? 'مرحلة غير معروفة' : 'unknown stage')}</span>
                          )}
                          {detected === 'tube_ball_mills' && (
                            <span className="text-amber-700">{isAr ? 'نوع الطاحونة (أنبوبية/كرات) غير محدد في المصدر' : 'EQUIPMENT TYPE NOT IDENTIFIED IN SOURCE'}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {workbookTab === 'mapping' && (
                  <div className="space-y-2">
                    {(['production', 'consumption', 'outputs'] as const).map((sheet) => {
                      const mapping = mappingFor(sheet, sheetRows[sheet]);
                      if (!mapping) return null;
                      return (
                        <div key={sheet} className="border border-slate-200 rounded-xl p-2">
                          <p className="font-black text-slate-800 mb-1">{sheet}{mapping.missingRequired.length > 0 && <span className="text-rose-700 font-bold ms-2">{isAr ? 'أعمدة مطلوبة غير مربوطة:' : 'required columns not mapped:'} {mapping.missingRequired.join(', ')}</span>}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                            {mapping.columns.map((c) => (
                              <label key={c.sourceColumn} className="flex items-center gap-1.5">
                                <span className="font-mono truncate max-w-[45%]" title={c.sourceColumn}>{c.sourceColumn}</span>
                                <span className="text-slate-400">→</span>
                                <select
                                  value={c.field ?? ''}
                                  onChange={(e) => setColumnMapping(sheet, c.sourceColumn, e.target.value || null)}
                                  className={`flex-1 px-2 py-1 border rounded-lg ${c.method === 'UNMAPPED' ? 'border-slate-200 text-slate-400' : c.method === 'MANUAL' ? 'border-sky-300 bg-sky-50' : 'border-slate-200'}`}
                                >
                                  <option value="">{isAr ? '- تجاهل العمود -' : '- ignore column -'}</option>
                                  {workbookFieldsFor(sheet).map((f) => <option key={f} value={f}>{f}</option>)}
                                </select>
                                <span className="text-[10px] text-slate-400">{c.method}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {workbookTab === 'issues' && (
                  <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-200 rounded-xl">
                    <table id="entity-import-workbook-issues" className="w-full text-[11px]">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className={cell}>{isAr ? 'الورقة' : 'Sheet'}</th>
                          <th className={cell}>{isAr ? 'الصف' : 'Row'}</th>
                          <th className={cell}>{isAr ? 'المفتاح' : 'Key'}</th>
                          <th className={cell}>{isAr ? 'الحقل' : 'Field'}</th>
                          <th className={cell}>{isAr ? 'المشكلة' : 'Issue'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workbookIssueReport(workbook).map((i, n) => (
                          <tr key={n} className="border-t border-slate-100">
                            <td className={cell}>{i.sheet}</td>
                            <td className={`${cell} font-mono`}>{i.sourceRowNumber || '-'}</td>
                            <td className={`${cell} font-mono`}>{i.sourceRowId || '-'}</td>
                            <td className={`${cell} font-mono`}>{i.field}</td>
                            <td className={`${cell} text-rose-700`}>{isAr ? i.messageAr : i.messageEn}</td>
                          </tr>
                        ))}
                        {workbookIssueReport(workbook).length === 0 && (
                          <tr><td colSpan={5} className="px-3 py-3 text-center text-emerald-700 font-bold">{isAr ? 'لا توجد مشاكل في بنية المصنف.' : 'The workbook structure has no issues.'}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {workbookTab === 'rows' && (
                  <div className="overflow-x-auto max-h-64 overflow-y-auto border border-slate-200 rounded-xl">
                    <table id="entity-import-relationships" className="w-full text-[11px]">
                      <thead className="bg-slate-50 text-slate-600">
                        <tr>
                          <th className={cell}>{isAr ? 'مفتاح الصف' : 'Row key'}</th>
                          <th className={cell}>{isAr ? 'المرحلة' : 'Stage'}</th>
                          <th className={cell}>{isAr ? 'أمر الشغل / الدفعة' : 'Job / batch'}</th>
                          <th className={cell}>{isAr ? 'استهلاك' : 'Consumption'}</th>
                          <th className={cell}>{isAr ? 'مخرجات' : 'Outputs'}</th>
                          <th className={cell}>{isAr ? 'الحالة' : 'Status'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.rows.filter((r) => r.entityKind === 'production').map((row) => {
                          const payload = rowPayload(row) as Record<string, any>;
                          const rel = relationships[row.rowId];
                          return (
                            <tr key={row.rowId} className="border-t border-slate-100">
                              <td className={`${cell} font-mono`}>{String(payload.sourceRowId ?? row.sourceRowNumber)}</td>
                              <td className={cell}>{String(payload.stageType ?? '-')}</td>
                              <td className={cell}>{String(payload.jobCode ?? payload.jobReferenceId ?? '-')} / {String(payload.batchNumber ?? payload.batchId ?? '-')}</td>
                              <td className={cell}>{rel?.consumption ?? 0}</td>
                              <td className={cell}>{rel?.outputs ?? 0}</td>
                              <td className={cell}>
                                <span className={`px-1.5 py-0.5 rounded border font-bold ${STATUS_TONE[row.status] ?? ''}`}>{row.status}</span>
                                {row.errors.length > 0 && <div className="text-rose-700">{row.errors.length} {isAr ? 'مانع' : 'blocking'}</div>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div id="entity-import-rows-pager" className="flex flex-wrap items-center gap-2">
              <select
                value={rowFilter}
                onChange={(e) => { setRowFilter(e.target.value as RowFilter); setPage(0); }}
                className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg font-bold"
              >
                <option value="ALL">{isAr ? 'كل السطور' : 'All rows'}</option>
                <option value="BLOCKING">{isAr ? 'مانعة' : 'Blocking'}</option>
                <option value="WARNING">{isAr ? 'تحذيرات غير مقبولة' : 'Warnings not accepted'}</option>
                <option value="WILL_IMPORT">{isAr ? 'سيتم استيرادها' : 'Will import'}</option>
                <option value="IMPORTED">{isAr ? 'تم استيرادها' : 'Imported'}</option>
                <option value="FAILED">{isAr ? 'فشلت' : 'Failed'}</option>
                <option value="NOT_WRITTEN">{isAr ? 'لم تُكتب' : 'Not written'}</option>
              </select>
              <span className="text-slate-600">
                {isAr
                  ? `${filteredRows.length.toLocaleString('ar-EG')} سطر - صفحة ${currentPage + 1} من ${pageCount}`
                  : `${filteredRows.length.toLocaleString()} rows - page ${currentPage + 1} of ${pageCount}`}
              </span>
              <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="px-2 py-1 rounded-lg border border-slate-200 bg-white font-bold cursor-pointer disabled:opacity-40">{isAr ? 'السابق' : 'Previous'}</button>
              <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="px-2 py-1 rounded-lg border border-slate-200 bg-white font-bold cursor-pointer disabled:opacity-40">{isAr ? 'التالي' : 'Next'}</button>
            </div>

            {/* Locked while an import runs: a row cannot change under the running import. */}
            <fieldset disabled={busy} className="min-w-0">
            <div className="overflow-x-auto max-h-[420px] overflow-y-auto border border-slate-200 rounded-xl">
              <table id="entity-import-rows" className="w-full text-[11px] min-w-[900px]">
                <thead className="bg-slate-50 sticky top-0 z-10 text-slate-600">
                  <tr>
                    <th className={cell}>{isAr ? 'السطر' : 'Row'}</th>
                    <th className={cell}>{isAr ? 'الكيان' : 'Entity'}</th>
                    <th className={cell}>{isAr ? 'الحالة' : 'Status'}</th>
                    <th className={cell}>{isAr ? 'البيانات' : 'Data'}</th>
                    <th className={cell}>{isAr ? 'الأكواد المُطابَقة' : 'Resolved references'}</th>
                    <th className={cell}>{isAr ? 'الأخطاء والتحذيرات' : 'Errors & warnings'}</th>
                    <th className={cell}>{isAr ? 'إجراء' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    const payload = rowPayload(row);
                    return (
                      <tr key={row.rowId} className={`border-t border-slate-100 ${isRowWritable(row) ? '' : 'bg-slate-50/60'}`}>
                        <td className={`${cell} font-mono`}>{row.sourceRowNumber}</td>
                        <td className={cell}>{isAr ? KIND_LABELS[row.entityKind].ar : KIND_LABELS[row.entityKind].en}</td>
                        <td className={cell}>
                          <span className={`px-1.5 py-0.5 rounded border font-bold ${STATUS_TONE[row.status] ?? ''}`}>{row.status}</span>
                          <div className="text-[10px] text-slate-500 mt-0.5">{row.selection}</div>
                        </td>
                        <td className={`${cell} font-mono max-w-[280px] truncate`} title={JSON.stringify(payload).slice(0, 2000)}>{JSON.stringify(payload).slice(0, 400)}</td>
                        <td className={cell}>
                          {(resolutions[row.rowId] ?? []).filter((r) => r.status !== 'EMPTY').map((r, i) => (
                            <div key={`r${i}`} className="mb-1">
                              <span className="font-mono">{r.field}="{r.sourceValue}"</span>{' '}
                              <span className={r.status === 'RESOLVED' ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
                                {r.status === 'RESOLVED' ? `${r.method} → ${r.targetCode ?? r.targetId}` : r.status}
                              </span>
                              {r.candidates.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1 mt-0.5">
                                  {r.candidates.map((c) => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => approveMapping(row, r, c.id)}
                                      className="px-1.5 py-0.5 rounded border border-sky-300 bg-sky-50 text-sky-900 font-bold cursor-pointer"
                                      title={isAr ? 'استخدام هذا السجل لكل السطور التي تحمل نفس القيمة' : 'Use this record for every row with the same value'}
                                    >
                                      {c.code || c.id}{c.name ? ` - ${c.name}` : ''}{c.score !== undefined ? ` (${Math.round(c.score)}%)` : ''}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </td>
                        <td className={cell}>
                          {row.errors.map((e, i) => <div key={`e${i}`} className="text-rose-700 font-bold">{isAr ? e.messageAr : e.messageEn}</div>)}
                          {row.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-700">{isAr ? w.messageAr : w.messageEn}</div>)}
                          {row.failureMessage && <div className="text-rose-800 font-bold">{row.failureMessage}</div>}
                        </td>
                        <td className={cell}>
                          <div className="flex flex-wrap items-center gap-1">
                            <button type="button" onClick={() => { setEditingRowId(row.rowId); setEditField(''); setEditValue(''); setEditReason(''); }} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-bold cursor-pointer">{isAr ? 'تصحيح' : 'Edit'}</button>
                            <button type="button" onClick={() => update(setRowSelection(row, 'SKIPPED', { user, at: now() }))} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 cursor-pointer">{isAr ? 'تخطي' : 'Skip'}</button>
                            <button type="button" onClick={() => update(setRowSelection(row, 'EXCLUDED', { user, at: now() }))} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 cursor-pointer">{isAr ? 'استبعاد' : 'Exclude'}</button>
                            <button type="button" onClick={() => update(revalidate(setRowSelection(row, 'INCLUDED', { user, at: now() })))} className="px-2 py-1 rounded bg-emerald-50 text-emerald-800 hover:bg-emerald-100 cursor-pointer">{isAr ? 'إعادة تضمين' : 'Include'}</button>
                            {row.warnings.length > 0 && !row.warningsAccepted && (
                              <button type="button" onClick={() => update(acceptRowWarnings(row, { user, at: now() }))} className="px-2 py-1 rounded bg-amber-50 text-amber-900 hover:bg-amber-100 font-bold cursor-pointer">{isAr ? 'قبول التحذير' : 'Accept warning'}</button>
                            )}
                          </div>
                          {editingRowId === row.rowId && (
                            <div className="mt-1.5 p-2 rounded-lg border border-slate-200 bg-white space-y-1">
                              <input value={editField} onChange={(e) => setEditField(e.target.value)} placeholder={isAr ? 'اسم الحقل' : 'field name'} className="w-full px-2 py-1 border border-slate-200 rounded font-mono" />
                              <input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder={isAr ? 'القيمة الجديدة' : 'new value'} className="w-full px-2 py-1 border border-slate-200 rounded font-mono" />
                              <input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder={isAr ? 'سبب التصحيح' : 'reason'} className="w-full px-2 py-1 border border-slate-200 rounded" />
                              <div className="flex items-center gap-1 justify-end">
                                <button type="button" onClick={() => setEditingRowId(null)} className="px-2 py-1 rounded hover:bg-slate-100 cursor-pointer"><X className="w-3 h-3" /></button>
                                <button type="button" onClick={saveCorrection} className="px-2 py-1 rounded bg-amber-400 font-bold cursor-pointer">{isAr ? 'حفظ وإعادة تحقق' : 'Save & revalidate'}</button>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </fieldset>

            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-slate-600">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                {isAr ? 'السطور المانعة والمتخطاة والمستبعدة لا تُكتب أبدًا.' : 'Blocking, skipped and excluded rows are never written.'}
              </p>
              <button
                id="entity-import-execute"
                type="button"
                disabled={busy || !canImport || summary.willImport === 0}
                onClick={() => void execute()}
                className="inline-flex items-center gap-1.5 px-4 py-2 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {importing
                  ? (isAr ? 'جارٍ الاستيراد...' : 'Importing...')
                  : (isAr ? `استيراد ${summary.willImport} سجل` : `Import ${summary.willImport} records`)}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};


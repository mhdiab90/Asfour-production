/**
 * Odoo historical import (three files) - Phase 1 Step 8D.
 *
 * Opened from the existing Historical Import centre. The three Odoo reports are
 * uploaded as they were exported - never merged by hand - parsed by their own
 * readers, staged, linked, validated and reviewed here, and only written after
 * an explicit approval.
 *
 * The review reuses the existing import row lifecycle (entityImportPure):
 * warnings are accepted, rows are skipped or excluded, a field can be corrected,
 * and every row shows the raw Excel row behind it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { listImportSheetNames, parseImportFile } from '../../services/bulkImportService';
import { acceptRowWarnings, applyRowCorrection, setRowSelection, type ImportRowSelection } from '../../services/entityImportPure';
import { readMrpProduction } from '../../services/odooProductionReaderPure';
import { readMrpWorkOrder } from '../../services/odooWorkOrderReaderPure';
import { readStockScrap } from '../../services/odooScrapReaderPure';
import { fetchMasterData, MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import type { OdooRunFinal, OdooRunProgress } from '../../services/odooExecutionPure';
import { approveRowsInBulk, bulkApprovalCandidates, bulkApprovalSummary, clearBulkSelection, buildOdooImportSession, isOdooRowWritable, type OdooSessionResult, type OdooStagedRow } from '../../services/odooImportSessionPure';
import {
  executeOdooImport,
  listOdooImportSessions,
  loadApprovedWorkCenterMappings,
  loadOdooImportSession,
  saveOdooImportSession,
  saveWorkCenterMapping,
} from '../../services/odooImportService';
import { buildImportReferenceIndexes, loadImportValidationContext } from '../../services/entityImportService';
import { WORK_CENTERS, buildPressLookup, buildShiftLookup, type ApprovedWorkCenterMapping } from '../../services/workCenterRegistryPure';
import { conflictReport, orphanReport } from '../../services/odooImportReportsPure';
import type { ImportSessionRecord, OdooSourceType, ProductionStageType } from '../../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'files' | 'matching' | 'workCenters' | 'validation' | 'conflicts' | 'orphans' | 'preview' | 'audit';

const SOURCES: Array<{ type: OdooSourceType; ar: string; en: string; hint: string }> = [
  { type: 'MRP_PRODUCTION', ar: 'أوامر التصنيع', en: 'Manufacturing orders', hint: 'mrp.production' },
  { type: 'MRP_WORKORDER', ar: 'أوامر العمل', en: 'Work orders', hint: 'mrp.workorder' },
  { type: 'STOCK_SCRAP', ar: 'الهالك', en: 'Scrap', hint: 'stock.scrap' },
];

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

interface LoadedFile {
  file: File;
  sheetName: string;
  rows: Array<Record<string, unknown>>;
}

export const OdooHistoricalImportPanel: React.FC<Props> = ({ isOpen, onClose }) => {
  const { language } = useLanguage();
  const { adminUser, hasPermission, isSuperAdmin } = useAuth();
  const isAr = language === 'ar';
  const canImport = isSuperAdmin || hasPermission('excel.import') || hasPermission('historical.import.execute');

  const [files, setFiles] = useState<Partial<Record<OdooSourceType, LoadedFile>>>({});
  const [approvedCenters, setApprovedCenters] = useState<ApprovedWorkCenterMapping[]>([]);
  /* ---- the write run (3.32.0): live progress, stop, and the complete result ---- */
  const [runProgress, setRunProgress] = useState<OdooRunProgress | null>(null);
  const [runFinal, setRunFinal] = useState<OdooRunFinal | null>(null);
  const [clock, setClock] = useState<number>(() => Date.now());
  const stopRef = useRef<AbortController | null>(null);
  /** The latest progress, flushed to the screen twice a second so a thousand rows do not re-render a thousand times. */
  const latestProgress = useRef<OdooRunProgress | null>(null);
  /** OFF by default: turns Odoo tons into pieces for pressing / sorting / hand-made brick by each product's piece weight. */
  const [convertTonsToPieces, setConvertTonsToPieces] = useState<boolean>(false);
  const [session, setSession] = useState<OdooSessionResult | null>(null);
  const [staged, setStaged] = useState<OdooStagedRow[]>([]);
  const [importSessionId, setImportSessionId] = useState<string>('');
  const [tab, setTab] = useState<Tab>('files');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rawRowId, setRawRowId] = useState<string | null>(null);
  const [editRowId, setEditRowId] = useState<string | null>(null);
  const [editField, setEditField] = useState('');
  const [editValue, setEditValue] = useState('');
  const [editReason, setEditReason] = useState('');
  const [sessions, setSessions] = useState<ImportSessionRecord[]>([]);
  const [result, setResult] = useState<{ production: number; workOrders: number; scrap: number; failed: number; skipped: number } | null>(null);

  const user = adminUser?.email ?? adminUser?.uid ?? 'unknown';
  const now = () => new Date().toISOString();

  const counts = session?.counts ?? {};
  const writable = useMemo(() => staged.filter(isOdooRowWritable), [staged]);

  const onFile = async (sourceType: OdooSourceType, file: File) => {
    setBusy(true);
    setError(null);
    try {
      const sheets = await listImportSheetNames(file);
      const sheetName = sheets[0] ?? 'Sheet1';
      const rows = await parseImportFile(file, sheetName);
      setFiles((f) => ({ ...f, [sourceType]: { file, sheetName, rows } }));
      setNotice(isAr ? `تمت قراءة ${rows.length} صفًا من ${file.name}.` : `${rows.length} row(s) read from ${file.name}.`);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  /** Parse -> stage -> normalise -> link -> validate. Nothing is written to a production collection here. */
  const buildSession = async () => {
    if (!files.MRP_PRODUCTION && !files.MRP_WORKORDER && !files.STOCK_SCRAP) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const id = importSessionId || `ODOO-${Date.now()}`;
      setImportSessionId(id);
      const approved = approvedCenters.length ? approvedCenters : await loadApprovedWorkCenterMappings();
      setApprovedCenters(approved);

      const production = files.MRP_PRODUCTION
        ? readMrpProduction(files.MRP_PRODUCTION.rows, { importSessionId: id, fileName: files.MRP_PRODUCTION.file.name, sheetName: files.MRP_PRODUCTION.sheetName })
        : null;
      const workOrders = files.MRP_WORKORDER
        ? readMrpWorkOrder(files.MRP_WORKORDER.rows, { importSessionId: id, fileName: files.MRP_WORKORDER.file.name, sheetName: files.MRP_WORKORDER.sheetName }, approved)
        : null;
      const scrap = files.STOCK_SCRAP
        ? readStockScrap(files.STOCK_SCRAP.rows, { importSessionId: id, fileName: files.STOCK_SCRAP.file.name, sheetName: files.STOCK_SCRAP.sheetName })
        : null;

      // Piece weights are read from Master Data only when the user switched the conversion on.
      let pieceConversion: { enabled: boolean; pieceWeightKg: (code: string) => number | null } | undefined;
      if (convertTonsToPieces) {
        const products = await fetchMasterData<any>(MASTER_DATA_COLLECTIONS.products);
        const weights = new Map<string, number>();
        for (const p of products) {
          const w = Number(p.pieceWeightKg ?? p.pieceWeight);
          const code = String(p.code ?? p.productCode ?? '').trim().toUpperCase();
          if (code && w > 0) weights.set(code, w);
        }
        pieceConversion = { enabled: true, pieceWeightKg: (code) => weights.get(String(code).trim().toUpperCase()) ?? null };
      }

      // Press and shift identity of pressing rows: the presses and shifts of Master Data (two small
      // collections), matched only when exactly one fits. Failing to read them only leaves rows without one.
      let identity: { pressByName: ReturnType<typeof buildPressLookup>; shiftByNumber: ReturnType<typeof buildShiftLookup> } | undefined;
      if (workOrders?.rows.some((w) => w.normalized.stageType === 'pressing')) {
        try {
          const [presses, shifts] = await Promise.all([
            fetchMasterData<any>(MASTER_DATA_COLLECTIONS.presses),
            fetchMasterData<any>(MASTER_DATA_COLLECTIONS.shifts),
          ]);
          identity = { pressByName: buildPressLookup(presses), shiftByNumber: buildShiftLookup(shifts) };
        } catch {
          /* pressing rows then carry the "no press / no shift" warning */
        }
      }

      const sheetIssues = [...(production?.sheetIssues ?? []), ...(workOrders?.sheetIssues ?? []), ...(scrap?.sheetIssues ?? [])];
      const built = buildOdooImportSession({
        importSessionId: id,
        createdBy: user,
        createdAt: now(),
        production: production?.rows ?? [],
        workOrders: workOrders?.rows ?? [],
        scrap: scrap?.rows ?? [],
        approvedWorkCenters: approved,
        pieceConversion,
        identity,
      });
      setSession(built);
      setStaged(built.staged);
      setTab('validation');
      if (sheetIssues.length) {
        setError(sheetIssues.map((i) => (isAr ? i.messageAr : i.messageEn)).join(' | '));
      }

      // Raw staging: the review survives a reload.
      await saveOdooImportSession({
        importSessionId: id,
        files: SOURCES.filter((s) => files[s.type]).map((s) => ({
          sourceType: s.type,
          fileName: files[s.type]!.file.name,
          sheetName: files[s.type]!.sheetName,
          rowCount: files[s.type]!.rows.length,
          uploadedAt: now(),
        })),
        counts: built.counts,
        conflicts: built.conflicts,
        status: 'REVIEW',
      }, built.staged).catch((err) => setNotice(isAr ? `تعذر حفظ المرحلة المؤقتة: ${String(err?.message ?? err)}` : `The staging could not be saved: ${String(err?.message ?? err)}`));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const refreshSessions = async () => {
    setBusy(true);
    try {
      setSessions(await listOdooImportSessions(15));
    } finally {
      setBusy(false);
    }
  };

  /** Reopens a staged session - the raw rows, their validation and their outcome. */
  const resumeSession = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const loaded = await loadOdooImportSession(id);
      if (!loaded.session) {
        setError(isAr ? 'لم يتم العثور على الجلسة.' : 'The session was not found.');
        return;
      }
      setImportSessionId(id);
      setSession({
        importSessionId: id,
        staged: [],
        link: { links: [], orphans: [], conflicts: loaded.session.conflicts ?? [], duplicateGroups: [], counts: {} },
        conflicts: loaded.session.conflicts ?? [],
        workCenters: [],
        counts: loaded.session.counts ?? {},
      });
      setStaged(loaded.rows.map((r) => ({
        row: {
          rowId: r.rowId,
          entityKind: (r.sourceType === 'MRP_WORKORDER' ? 'odooWorkOrder' : r.sourceType === 'STOCK_SCRAP' ? 'odooScrap' : 'odooProduction') as never,
          sourceRowNumber: r.provenance.sourceRow,
          originalRowData: r.rawRow,
          correctedRowData: r.correctedRow,
          normalizedData: r.normalizedRow,
          errors: r.errors ?? [],
          warnings: r.warnings ?? [],
          warningsAccepted: false,
          status: r.status as never,
          selection: r.selection as ImportRowSelection,
          resolutionHistory: [],
          importedId: r.importedId ?? null,
          failureMessage: r.failureMessage ?? null,
        },
        kind: (r.sourceType === 'MRP_WORKORDER' ? 'odooWorkOrder' : r.sourceType === 'STOCK_SCRAP' ? 'odooScrap' : 'odooProduction') as never,
        sourceType: r.sourceType,
        provenance: r.provenance,
        rawRow: r.rawRow,
        linkedManufacturingOrder: r.linkedManufacturingOrder ?? null,
        linkedRowIds: r.linkedRowIds ?? [],
        orphanKinds: r.orphanKinds ?? [],
      })));
      setTab('validation');
      setNotice(isAr ? 'تمت استعادة الجلسة من المرحلة المؤقتة (للمراجعة فقط - أعد رفع الملفات لإعادة التنفيذ).' : 'The session was restored from staging (review only - re-upload the files to execute again).');
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (rowId: string, next: OdooStagedRow) => setStaged((rows) => rows.map((r) => (r.row.rowId === rowId ? next : r)));

  /* ---- bulk approval (3.31.0) ---- */
  const [bulkGroup, setBulkGroup] = useState<string>('ALL');
  const [bulkLimit, setBulkLimit] = useState<string>('');
  const bulkFilter = useMemo(
    () => ({ groups: bulkGroup === 'ALL' ? [] : [bulkGroup], limit: bulkLimit.trim() ? Number(bulkLimit) : null }),
    [bulkGroup, bulkLimit],
  );
  /** Every group that has something to approve, with its count - the filter's choices. */
  const bulkGroups = useMemo(() => bulkApprovalSummary(bulkApprovalCandidates(staged, {})).byGroup, [staged]);
  const bulkCandidates = useMemo(() => bulkApprovalCandidates(staged, bulkFilter), [staged, bulkFilter]);

  const approveInBulk = () => {
    if (bulkCandidates.length === 0) return;
    const summary = bulkApprovalSummary(bulkCandidates, isAr ? 'ar' : 'en');
    const lines = [
      isAr ? `سيتم اختيار ${summary.total} سطرًا وقبول تحذيراتها:` : `${summary.total} row(s) will be included and their warnings accepted:`,
      ...summary.byGroup.map((g) => `  ${g.group}: ${g.count}`),
      isAr ? 'التحذيرات التي ستُقبل:' : 'Warnings being accepted:',
      ...summary.warnings.slice(0, 6).map((w) => `  (${w.count}) ${w.message}`),
      isAr ? 'لن يُكتب شيء الآن - الكتابة بزر "اعتماد وكتابة السجلات".' : 'Nothing is written yet - writing is the "Approve & write records" button.',
    ];
    if (!window.confirm(lines.join('\n'))) return;
    const out = approveRowsInBulk(staged, bulkFilter, { user, at: now() });
    setStaged(out.staged);
    setNotice(isAr ? `تم اختيار ${out.approved} سطرًا وقبول تحذيراتها.` : `${out.approved} row(s) included and their warnings accepted.`);
  };

  const clearBulk = () => {
    const out = clearBulkSelection(staged, { user, at: now() });
    setStaged(out.staged);
    setNotice(isAr ? `أُلغي اختيار ${out.cleared} سطرًا.` : `${out.cleared} row(s) un-selected.`);
  };

  const acceptWarnings = (item: OdooStagedRow) =>
    updateRow(item.row.rowId, { ...item, row: acceptRowWarnings(item.row, { user, at: now() }) });

  const changeSelection = (item: OdooStagedRow, selection: ImportRowSelection) =>
    updateRow(item.row.rowId, { ...item, row: setRowSelection(item.row, selection, { user, at: now() }) });

  const saveCorrection = () => {
    const item = staged.find((r) => r.row.rowId === editRowId);
    if (!item || !editField.trim()) return;
    updateRow(item.row.rowId, { ...item, row: applyRowCorrection(item.row, { [editField.trim()]: editValue }, { user, at: now(), reason: editReason }) });
    setEditRowId(null);
    setEditField('');
    setEditValue('');
    setEditReason('');
  };

  const approveCenter = async (raw: string, centerId: string) => {
    setBusy(true);
    try {
      await saveWorkCenterMapping(raw, centerId, raw);
      const approved = await loadApprovedWorkCenterMappings();
      setApprovedCenters(approved);
      setNotice(isAr ? `تم اعتماد "${raw}".` : `"${raw}" approved.`);
      await buildSession();
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  /** Approval: only reviewed rows are written, each on its own. */
  // Flush progress to the screen and keep the elapsed-time clock ticking while a write is running.
  useEffect(() => {
    if (!busy || !stopRef.current) return;
    const timer = setInterval(() => {
      setClock(Date.now());
      if (latestProgress.current) setRunProgress(latestProgress.current);
    }, 500);
    return () => clearInterval(timer);
  }, [busy]);

  // A write in progress must not be abandoned by closing the tab without a warning.
  useEffect(() => {
    if (!busy || !stopRef.current) return;
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [busy]);

  const stopRun = () => {
    stopRef.current?.abort();
    setNotice(isAr ? 'تم طلب الإيقاف - لن يبدأ أي سجل جديد، وتُنتظر الكتابات الجارية لحظات.' : 'Stop requested - no new row starts; writes in flight are given a moment.');
  };

  const execute = async () => {
    if (!session || writable.length === 0) return;
    const summary = isAr
      ? `سيتم كتابة ${writable.length} سجلًا (إنتاج + أوامر عمل + هالك). هل تريد المتابعة؟`
      : `${writable.length} record(s) will be written (production + work orders + scrap). Continue?`;
    if (!window.confirm(summary)) return;
    setBusy(true);
    setError(null);
    setRunFinal(null);
    setRunProgress(null);
    latestProgress.current = null;
    const controller = new AbortController();
    stopRef.current = controller;
    try {
      const stages = [...new Set(staged.map((s) => s.targetStage).filter(Boolean))] as ProductionStageType[];
      const context = await loadImportValidationContext(stages);
      const indexes = await buildImportReferenceIndexes(context, stages);
      const outcome = await executeOdooImport(session.importSessionId, staged, {
        context,
        indexes,
        mappingCache: new Map(),
        language: isAr ? 'ar' : 'en',
        signal: controller.signal,
        onProgress: (p) => { latestProgress.current = p; },
      });
      setStaged(outcome.staged);
      setRunFinal(outcome.final);
      setRunProgress(null);
      setResult({ production: outcome.writtenProduction, workOrders: outcome.writtenWorkOrders, scrap: outcome.writtenScrap, failed: outcome.failed, skipped: outcome.skipped });
      if (outcome.messages.length) setNotice(outcome.messages.slice(0, 5).join(' | '));
    } catch (err: any) {
      // Nothing was written if the run could not even start (for example the existing records could not be read).
      setError(isAr
        ? `لم يبدأ الاستيراد أو توقف قبل الكتابة: ${String(err?.message ?? err)}`
        : `The import did not start or stopped before writing: ${String(err?.message ?? err)}`);
    } finally {
      stopRef.current = null;
      setBusy(false);
    }
  };

  const cell = 'px-2 py-1.5 align-top';
  const rawRow = staged.find((r) => r.row.rowId === rawRowId);

  return (
    <Modal
      id="odoo-historical-import-panel"
      isOpen={isOpen}
      onClose={() => { if (!busy) onClose(); }}
      title={isAr ? 'استيراد أودو التاريخي (ثلاثة ملفات)' : 'Odoo historical import (three files)'}
      subtitle={isAr ? 'mrp.production + mrp.workorder + stock.scrap - تُرفع كما صدّرها أودو، بدون دمج يدوي' : 'mrp.production + mrp.workorder + stock.scrap - uploaded exactly as Odoo exported them, never merged by hand'}
      maxWidth="4xl"
    >
      <div className="space-y-3 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        {!canImport && (
          <p className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 font-bold text-amber-900">
            {isAr ? 'لا تملك صلاحية الاستيراد - يمكنك المراجعة فقط.' : 'You do not have the import right - you may review only.'}
          </p>
        )}
        {error && <p className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold text-rose-800">{error}</p>}
        {notice && <p className="bg-sky-50 border border-sky-200 rounded-xl px-3 py-2 font-bold text-sky-900">{notice}</p>}

        {/* ---- files ---- */}
        <div id="odoo-import-files" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {SOURCES.map((source) => {
            const loaded = files[source.type];
            return (
              <label key={source.type} className={`flex flex-col gap-1 p-3 rounded-xl border cursor-pointer ${loaded ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-slate-50'}`}>
                <span className="font-black text-slate-800">{isAr ? source.ar : source.en}</span>
                <span className="font-mono text-[10px] text-slate-500">{source.hint}</span>
                <span className="flex items-center gap-1.5 font-bold text-slate-700">
                  <Upload className="w-3.5 h-3.5" />
                  {loaded ? `${loaded.file.name} · ${loaded.rows.length}` : (isAr ? 'اختر الملف' : 'Choose the file')}
                </span>
                <input
                  id={`odoo-import-file-${source.type}`}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(source.type, f); }}
                />
              </label>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            id="odoo-import-build"
            type="button"
            disabled={busy || (!files.MRP_PRODUCTION && !files.MRP_WORKORDER && !files.STOCK_SCRAP)}
            onClick={() => void buildSession()}
            className="px-3 py-2 font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 disabled:opacity-40 rounded-xl cursor-pointer"
          >
            {isAr ? 'قراءة وربط وتحقق' : 'Parse, link & validate'}
          </button>
          <button type="button" disabled={busy} onClick={() => void refreshSessions()} className="inline-flex items-center gap-1.5 px-3 py-2 font-bold bg-slate-100 rounded-xl cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" />{isAr ? 'الجلسات المحفوظة' : 'Saved sessions'}
          </button>
          <label
            className="inline-flex items-center gap-1.5 font-bold text-slate-700 cursor-pointer"
            title={isAr
              ? 'يحوّل كمية أودو بالطن إلى قطع في الكبس والفرز والطوب اليدوي = الطن × 1000 ÷ وزن قطعة المنتج، مقرّبة لأقرب قطعة. المنتج بلا وزن قطعة يُرفض.'
              : 'Turns Odoo tons into pieces for pressing, sorting and hand-made brick = tons x 1000 / the product piece weight, rounded. A product without a piece weight is refused.'}
          >
            <input id="odoo-convert-pieces" type="checkbox" checked={convertTonsToPieces} disabled={busy} onChange={(e) => setConvertTonsToPieces(e.target.checked)} className="accent-amber-500" />
            {isAr ? 'تحويل الطن إلى قطع (بوزن قطعة المنتج)' : 'Convert tons to pieces (by product piece weight)'}
          </label>
          {busy && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
          {importSessionId && <span className="font-mono text-slate-500">{importSessionId}</span>}
        </div>

        {sessions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sessions.map((s) => (
              <button key={s.importSessionId} type="button" onClick={() => void resumeSession(s.importSessionId)} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 font-mono cursor-pointer">
                {s.importSessionId} · {s.status}
              </button>
            ))}
          </div>
        )}

        {session && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['manufacturingOrders', isAr ? 'أوامر تصنيع' : 'MOs'],
                ['workOrders', isAr ? 'أوامر عمل' : 'Work orders'],
                ['productionRowsToWrite', isAr ? 'سجلات إنتاج' : 'Production rows'],
                ['scrapRows', isAr ? 'سطور هالك' : 'Scrap rows'],
                ['linkedWorkOrders', isAr ? 'مرتبطة' : 'Linked'],
                ['unresolved', isAr ? 'غير محلولة' : 'Unresolved'],
                ['conflicts', isAr ? 'تعارضات' : 'Conflicts'],
                ['warnings', isAr ? 'تحذيرات' : 'Warnings'],
                ['errors', isAr ? 'أخطاء' : 'Errors'],
                ['skipped', isAr ? 'متخطاة' : 'Skipped'],
                ['excluded', isAr ? 'مستبعدة' : 'Excluded'],
              ] as const).map(([key, label]) => (
                <span key={key} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200">
                  {label}: <span className="font-bold">{counts[key] ?? 0}</span>
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(['files', 'matching', 'workCenters', 'validation', 'conflicts', 'orphans', 'preview', 'audit'] as Tab[]).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${tab === t ? 'bg-amber-400 text-slate-950' : 'bg-slate-100 text-slate-700'}`}>
                  {t}
                </button>
              ))}
            </div>

            {/* Bulk approval: a whole stage, or the first N rows as a pilot batch, instead of one row at a time. */}
            <div id="odoo-import-bulk" className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-amber-200 bg-amber-50/60">
              <span className="font-black text-slate-800">{isAr ? 'اعتماد جماعي' : 'Bulk approval'}</span>
              <select
                id="odoo-bulk-group"
                value={bulkGroup}
                onChange={(e) => setBulkGroup(e.target.value)}
                disabled={busy}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1.5 font-bold"
              >
                <option value="ALL">{isAr ? 'كل المراحل والهالك' : 'All stages and scrap'}</option>
                {bulkGroups.map((g) => <option key={g.group} value={g.group}>{`${g.group} (${g.count})`}</option>)}
              </select>
              <label className="inline-flex items-center gap-1.5 font-bold text-slate-700">
                {isAr ? 'أول' : 'First'}
                <input
                  id="odoo-bulk-limit"
                  type="number"
                  min="1"
                  value={bulkLimit}
                  onChange={(e) => setBulkLimit(e.target.value)}
                  placeholder={isAr ? 'الكل' : 'all'}
                  className="w-20 bg-white border border-slate-200 rounded-lg px-2 py-1.5 font-mono"
                />
                {isAr ? 'سطر (دفعة تجريبية)' : 'rows (pilot batch)'}
              </label>
              <button
                id="odoo-bulk-approve"
                type="button"
                disabled={!canImport || busy || bulkCandidates.length === 0}
                onClick={approveInBulk}
                className="px-3 py-1.5 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 disabled:opacity-40 rounded-lg cursor-pointer"
              >
                {isAr ? `اختيار وقبول التحذيرات (${bulkCandidates.length})` : `Include & accept warnings (${bulkCandidates.length})`}
              </button>
              <button
                id="odoo-bulk-clear"
                type="button"
                disabled={busy || writable.length === 0}
                onClick={clearBulk}
                className="px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 rounded-lg cursor-pointer"
              >
                {isAr ? 'إلغاء اختيار الكل' : 'Un-select all'}
              </button>
              <span className="text-[10px] text-slate-500">
                {isAr
                  ? 'يشمل الأسطر بلا أخطاء فقط. الكتابة تتم بزر "اعتماد وكتابة السجلات" بعد ذلك.'
                  : 'Only rows without errors. Writing is the "Approve & write records" button afterwards.'}
              </span>
            </div>

            {/* ---- live progress of the write ---- */}
            {busy && runProgress && (
              <div id="odoo-import-progress" className="p-3 rounded-xl border border-sky-200 bg-sky-50 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black text-sky-900">
                    {isAr ? 'جاري الكتابة' : 'Writing'} - {runProgress.phase === 'SCRAP' ? (isAr ? 'الهالك' : 'scrap') : (isAr ? 'سجلات الإنتاج' : 'production records')}
                  </span>
                  <span id="odoo-import-percent" className="font-black text-sky-900 text-base font-mono">{runProgress.percent}%</span>
                </div>
                <div className="h-3 rounded-full bg-sky-100 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={runProgress.percent}>
                  <div className="h-full bg-sky-500 transition-all" style={{ width: `${runProgress.percent}%` }} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-bold text-slate-700">
                  <span>{isAr ? 'تمت معالجة' : 'Processed'}: <b className="font-mono">{runProgress.processed.toLocaleString('en-US')} / {runProgress.total.toLocaleString('en-US')}</b></span>
                  <span className="text-emerald-700">{isAr ? 'نجح' : 'Written'}: <b className="font-mono">{runProgress.succeeded.toLocaleString('en-US')}</b></span>
                  <span className="text-rose-700">{isAr ? 'فشل' : 'Failed'}: <b className="font-mono">{runProgress.failed}</b></span>
                  <span className="text-amber-700">{isAr ? 'لم تتأكد النتيجة' : 'Outcome unknown'}: <b className="font-mono">{runProgress.uncertain}</b></span>
                  <span className="text-slate-600">{isAr ? 'موجود من قبل' : 'Already there'}: <b className="font-mono">{runProgress.alreadyImported}</b></span>
                  <span className="text-slate-500">{isAr ? 'الزمن' : 'Elapsed'}: <b className="font-mono">{Math.max(0, Math.round((clock - runProgress.startedAt) / 1000))}s</b></span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(runProgress.byGroup).map(([group, g]) => (
                    <span key={group} className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 font-mono">
                      {group}: {g.done}/{g.total}{g.failed ? ` ✗${g.failed}` : ''}{g.unknown ? ` ?${g.unknown}` : ''}
                    </span>
                  ))}
                </div>
                {runProgress.current && <p className="text-slate-600">{isAr ? 'الآن' : 'Now'}: <span className="font-mono">{runProgress.current}</span></p>}
                {clock - runProgress.lastProgressAt > 60_000 && (
                  <p className="font-bold text-amber-800">
                    {isAr
                      ? `لا يوجد تقدم منذ ${Math.round((clock - runProgress.lastProgressAt) / 1000)} ثانية - قد يكون الخادم بطيئًا أو الاتصال مقطوعًا. كل سجل ينتظر 90 ثانية كحد أقصى ثم يُعلَّم "لم تتأكد النتيجة".`
                      : `No progress for ${Math.round((clock - runProgress.lastProgressAt) / 1000)} s - the server may be slow or the connection lost. Each row waits 90 s at most, then is marked "outcome unknown".`}
                  </p>
                )}
                {runProgress.lastError && <p className="font-semibold text-rose-700">{isAr ? 'آخر خطأ' : 'Last problem'}: {runProgress.lastError}</p>}
                <button
                  id="odoo-import-stop"
                  type="button"
                  onClick={stopRun}
                  disabled={runProgress.stopRequested}
                  className="px-3 py-1.5 font-bold text-rose-800 bg-rose-50 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 rounded-lg cursor-pointer"
                >
                  {runProgress.stopRequested ? (isAr ? 'جاري الإيقاف...' : 'Stopping...') : (isAr ? 'إيقاف' : 'Stop')}
                </button>
                <p className="text-[10px] text-slate-500">{isAr ? 'لا تغلق الصفحة حتى ينتهي. السجلات المكتوبة محفوظة، وإعادة التشغيل لا تكرر أي سجل.' : 'Do not close the page until it finishes. Written records are kept, and a re-run never repeats a record.'}</p>
              </div>
            )}
            {busy && !runProgress && stopRef.current && (
              <p id="odoo-import-preparing" className="p-3 rounded-xl border border-sky-200 bg-sky-50 font-bold text-sky-900 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />{isAr ? 'جاري التجهيز: قراءة السجلات الموجودة والتحقق قبل الكتابة...' : 'Preparing: reading existing records and validating before writing...'}
              </p>
            )}

            {/* ---- the final result of the write ---- */}
            {runFinal && !busy && (
              <div id="odoo-import-final" className={`p-3 rounded-xl border space-y-2 ${runFinal.outcome === 'COMPLETED' ? 'border-emerald-200 bg-emerald-50' : runFinal.outcome === 'INTERRUPTED' ? 'border-amber-300 bg-amber-50' : 'border-rose-200 bg-rose-50'}`}>
                <p className="font-black text-base">
                  {runFinal.outcome === 'COMPLETED' && `✅ ${isAr ? 'اكتمل الاستيراد بنجاح (100%)' : 'The import completed successfully (100%)'}`}
                  {runFinal.outcome === 'COMPLETED_WITH_ERRORS' && `⚠️ ${isAr ? 'اكتمل الاستيراد مع أخطاء (100%) - راجع القوائم أدناه' : 'The import completed with errors (100%) - see the lists below'}`}
                  {runFinal.outcome === 'INTERRUPTED' && `⏸️ ${isAr ? `توقف الاستيراد عند ${runFinal.percent}%` : `The import stopped at ${runFinal.percent}%`}`}
                </p>
                {runFinal.error && <p className="font-bold text-amber-900">{runFinal.error}</p>}
                <div className="flex flex-wrap gap-x-4 gap-y-1 font-bold text-slate-800">
                  <span>{isAr ? 'المخطط' : 'Planned'}: <b className="font-mono">{runFinal.total}</b></span>
                  <span className="text-emerald-700">{isAr ? 'كُتب' : 'Written'}: <b className="font-mono">{runFinal.succeeded}</b></span>
                  <span className="text-rose-700">{isAr ? 'فشل' : 'Failed'}: <b className="font-mono">{runFinal.failed}</b></span>
                  <span className="text-amber-700">{isAr ? 'لم تتأكد النتيجة' : 'Outcome unknown'}: <b className="font-mono">{runFinal.uncertain}</b></span>
                  <span>{isAr ? 'موجود من قبل' : 'Already there'}: <b className="font-mono">{runFinal.alreadyImported}</b></span>
                  <span>{isAr ? 'لم يبدأ' : 'Not started'}: <b className="font-mono">{runFinal.notStarted}</b></span>
                  <span className="text-slate-500">{isAr ? 'خارج الخطة' : 'Not planned'}: <b className="font-mono">{runFinal.notPlanned}</b></span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(runFinal.byGroup).map(([group, g]) => (
                    <span key={group} className="px-2 py-0.5 rounded-lg bg-white border border-slate-200 font-mono">{group}: {g.done}/{g.total}{g.failed ? ` ✗${g.failed}` : ''}{g.unknown ? ` ?${g.unknown}` : ''}</span>
                  ))}
                </div>
                {runFinal.failures.length > 0 && (
                  <div>
                    <p className="font-black text-rose-800">{isAr ? `أسباب الفشل (${runFinal.failures.length})` : `Failure reasons (${runFinal.failures.length})`}</p>
                    <div className="max-h-48 overflow-auto border border-rose-200 rounded-lg bg-white">
                      <table id="odoo-import-failures" className="w-full text-[11px]">
                        <tbody>
                          {runFinal.failures.slice(0, 200).map((f) => (
                            <tr key={f.rowId} className="border-t border-rose-100 align-top">
                              <td className="px-2 py-1 font-mono whitespace-nowrap">{f.group}</td>
                              <td className="px-2 py-1 font-mono whitespace-nowrap">{f.moReference ?? '-'}</td>
                              <td className="px-2 py-1 font-mono whitespace-nowrap">{f.sourceFile} #{f.sourceRow}</td>
                              <td className="px-2 py-1 text-rose-800">{f.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {runFinal.uncertainRows.length > 0 && (
                  <div>
                    <p className="font-black text-amber-900">{isAr ? `لم تتأكد النتيجة (${runFinal.uncertainRows.length}) - لم يرد الخادم، فقد يكون السجل كُتب` : `Outcome unknown (${runFinal.uncertainRows.length}) - the server did not answer; the record may have been written`}</p>
                    <div className="max-h-40 overflow-auto border border-amber-200 rounded-lg bg-white">
                      <table id="odoo-import-uncertain" className="w-full text-[11px]">
                        <tbody>
                          {runFinal.uncertainRows.slice(0, 200).map((f) => (
                            <tr key={f.rowId} className="border-t border-amber-100 align-top">
                              <td className="px-2 py-1 font-mono whitespace-nowrap">{f.group}</td>
                              <td className="px-2 py-1 font-mono whitespace-nowrap">{f.moReference ?? '-'}</td>
                              <td className="px-2 py-1 font-mono whitespace-nowrap">{f.sourceFile} #{f.sourceRow}</td>
                              <td className="px-2 py-1 text-amber-900">{f.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {runFinal.outcome !== 'COMPLETED' && (
                  <p className="text-[11px] font-semibold text-slate-700">
                    {isAr
                      ? 'لإكمال ما تبقى: أعد رفع الملفات واعتمد وانتظر - السجلات المكتوبة يتعرف عليها البرنامج ولا يكتبها مرة ثانية.'
                      : 'To finish the rest: upload the files again, approve and write - the records already written are recognised and never written twice.'}
                  </p>
                )}
              </div>
            )}

            {result && !runFinal && (
              <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-900">
                <p className="font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  {isAr
                    ? `تم: ${result.production} سجل إنتاج، ${result.workOrders} أمر عمل، ${result.scrap} هالك، ${result.failed} فشل، ${result.skipped} متخطى.`
                    : `${result.production} production, ${result.workOrders} work orders, ${result.scrap} scrap, ${result.failed} failed, ${result.skipped} skipped.`}
                </p>
              </div>
            )}

            {/* ---- work centers ---- */}
            {tab === 'workCenters' && (
              <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                <table id="odoo-import-work-centers" className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0">
                    <tr>
                      <th className={cell}>{isAr ? 'النص الأصلي' : 'Raw'}</th>
                      <th className={cell}>{isAr ? 'المركز' : 'Main center'}</th>
                      <th className={cell}>{isAr ? 'المعدة' : 'Equipment'}</th>
                      <th className={cell}>{isAr ? 'القاعدة' : 'Rule'}</th>
                      <th className={cell}>{isAr ? 'الحالة' : 'Status'}</th>
                      <th className={cell}>{isAr ? 'عدد' : 'Rows'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.workCenters.map((w) => (
                      <tr key={w.raw} className="border-t border-slate-100">
                        <td className={`${cell} font-mono`}>{w.raw}</td>
                        <td className={cell}>
                          {w.resolution.mainCenterNameAr ?? (
                            <select
                              className="px-2 py-1 border border-rose-300 bg-rose-50 rounded-lg"
                              defaultValue=""
                              disabled={!canImport || busy}
                              onChange={(e) => { if (e.target.value) void approveCenter(w.raw, e.target.value); }}
                            >
                              <option value="">{isAr ? '- اختر المركز -' : '- choose the center -'}</option>
                              {WORK_CENTERS.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
                            </select>
                          )}
                        </td>
                        <td className={cell}>{w.resolution.equipmentName ?? '-'}{w.resolution.millKind ? ` (${w.resolution.millKind})` : ''}</td>
                        <td className={`${cell} font-mono text-slate-500`}>{w.resolution.rule}</td>
                        <td className={cell}>
                          <span className={`px-1.5 py-0.5 rounded border font-bold ${w.resolution.status === 'RESOLVED' ? STATUS_TONE.VALID : STATUS_TONE.WARNING}`}>{w.resolution.status}</span>
                        </td>
                        <td className={cell}>{w.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ---- matching (MO -> work orders / scrap) ---- */}
            {tab === 'matching' && (
              <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                <table id="odoo-import-matching" className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0">
                    <tr>
                      <th className={cell}>{isAr ? 'أمر التصنيع' : 'Manufacturing order'}</th>
                      <th className={cell}>{isAr ? 'في mrp.production' : 'In mrp.production'}</th>
                      <th className={cell}>{isAr ? 'أوامر عمل' : 'Work orders'}</th>
                      <th className={cell}>{isAr ? 'سطور هالك' : 'Scrap rows'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {session.link.links.map((l) => (
                      <tr key={l.moReference} className="border-t border-slate-100">
                        <td className={`${cell} font-mono`}>{l.moReference || '-'}</td>
                        <td className={cell}>{l.productionRowId ? '✔' : <span className="text-rose-700 font-bold">✖</span>}</td>
                        <td className={cell}>{l.workOrderRowIds.length}</td>
                        <td className={cell}>{l.scrapRowIds.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ---- conflicts ---- */}
            {tab === 'conflicts' && (
              <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                <table id="odoo-import-conflicts" className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0">
                    <tr>
                      <th className={cell}>{isAr ? 'المفتاح' : 'Key'}</th>
                      <th className={cell}>{isAr ? 'الحقل' : 'Field'}</th>
                      <th className={cell}>{isAr ? 'المصدر أ' : 'Source A'}</th>
                      <th className={cell}>{isAr ? 'المصدر ب' : 'Source B'}</th>
                      <th className={cell}>{isAr ? 'الخطورة' : 'Severity'}</th>
                      <th className={cell}>{isAr ? 'الرسالة' : 'Message'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflictReport(session.conflicts, isAr ? 'ar' : 'en').map((c, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className={`${cell} font-mono`}>{c.logicalKey}</td>
                        <td className={`${cell} font-mono`}>{c.field}</td>
                        <td className={cell}>{c.sourceA}: <b>{c.valueA}</b><div className="text-slate-400">{c.locationA}</div></td>
                        <td className={cell}>{c.sourceB}: <b>{c.valueB}</b><div className="text-slate-400">{c.locationB}</div></td>
                        <td className={cell}><span className={`px-1.5 py-0.5 rounded border font-bold ${c.severity === 'BLOCKING' ? STATUS_TONE.BLOCKING : STATUS_TONE.WARNING}`}>{c.severity}</span></td>
                        <td className={cell}>{c.message}</td>
                      </tr>
                    ))}
                    {session.conflicts.length === 0 && (
                      <tr><td colSpan={6} className="px-3 py-3 text-center text-emerald-700 font-bold">{isAr ? 'لا توجد تعارضات بين الملفات.' : 'No conflicts between the files.'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ---- orphans ---- */}
            {tab === 'orphans' && (
              <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                <table id="odoo-import-orphans" className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0">
                    <tr>
                      <th className={cell}>{isAr ? 'النوع' : 'Kind'}</th>
                      <th className={cell}>{isAr ? 'المصدر' : 'Source'}</th>
                      <th className={cell}>{isAr ? 'الصف' : 'Row'}</th>
                      <th className={cell}>{isAr ? 'المرجع' : 'Reference'}</th>
                      <th className={cell}>{isAr ? 'الرسالة' : 'Message'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphanReport(session.link.orphans, isAr ? 'ar' : 'en').map((o, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className={`${cell} font-mono`}>{o.kind}</td>
                        <td className={`${cell} font-mono`}>{o.sourceType}</td>
                        <td className={`${cell} font-mono`}>{o.sourceRow}</td>
                        <td className={cell}>{o.reference || '-'}</td>
                        <td className={cell}>{o.message}</td>
                      </tr>
                    ))}
                    {session.link.orphans.length === 0 && (
                      <tr><td colSpan={5} className="px-3 py-3 text-center text-emerald-700 font-bold">{isAr ? 'لا توجد سطور يتيمة.' : 'No orphan rows.'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* ---- validation / corrections / preview ---- */}
            {(tab === 'validation' || tab === 'preview' || tab === 'files') && (
              <div className="overflow-x-auto max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
                <table id="odoo-import-rows" className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0">
                    <tr>
                      <th className={cell}>{isAr ? 'المصدر' : 'Source'}</th>
                      <th className={cell}>{isAr ? 'الصف' : 'Row'}</th>
                      <th className={cell}>{isAr ? 'أمر التصنيع' : 'MO'}</th>
                      <th className={cell}>{isAr ? 'المرحلة' : 'Stage'}</th>
                      <th className={cell}>{isAr ? 'الحالة' : 'Status'}</th>
                      <th className={cell}>{isAr ? 'الأخطاء والتحذيرات' : 'Errors & warnings'}</th>
                      <th className={cell}>{isAr ? 'إجراءات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staged
                      .filter((item) => (tab === 'preview' ? isOdooRowWritable(item) : true))
                      .map((item) => (
                        <tr key={item.row.rowId} className="border-t border-slate-100">
                          <td className={`${cell} font-mono`}>{item.sourceType}</td>
                          <td className={`${cell} font-mono`}>{item.provenance.sourceRow}</td>
                          <td className={`${cell} font-mono`}>{item.linkedManufacturingOrder || '-'}</td>
                          <td className={cell}>{item.targetStage ?? '-'}</td>
                          <td className={cell}>
                            <span className={`px-1.5 py-0.5 rounded border font-bold ${STATUS_TONE[item.row.status] ?? ''}`}>{item.row.status}</span>
                            {item.row.selection !== 'INCLUDED' && <div className="text-slate-500">{item.row.selection}</div>}
                            {item.orphanKinds.length > 0 && <div className="text-amber-700">{item.orphanKinds.join(', ')}</div>}
                          </td>
                          <td className={cell}>
                            {item.row.errors.map((e, i) => <div key={`e${i}`} className="text-rose-700">{isAr ? e.messageAr : e.messageEn}</div>)}
                            {item.row.warnings.map((w, i) => <div key={`w${i}`} className="text-amber-700">{isAr ? w.messageAr : w.messageEn}</div>)}
                            {item.row.failureMessage && <div className="text-rose-800 font-bold">{item.row.failureMessage}</div>}
                          </td>
                          <td className={cell}>
                            <div className="flex flex-wrap gap-1">
                              <button type="button" onClick={() => setRawRowId(item.row.rowId)} className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 cursor-pointer">
                                {isAr ? 'الصف الأصلي' : 'Raw row'}
                              </button>
                              {item.row.warnings.length > 0 && !item.row.warningsAccepted && (
                                <button type="button" onClick={() => acceptWarnings(item)} className="px-1.5 py-0.5 rounded border border-amber-300 bg-amber-50 cursor-pointer">
                                  {isAr ? 'قبول التحذيرات' : 'Accept warnings'}
                                </button>
                              )}
                              {item.kind !== 'odooProduction' && (
                                <>
                                  <button type="button" onClick={() => changeSelection(item, item.row.selection === 'SKIPPED' ? 'INCLUDED' : 'SKIPPED')} className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 cursor-pointer">
                                    {item.row.selection === 'SKIPPED' ? (isAr ? 'إرجاع' : 'Include') : (isAr ? 'تخطٍ' : 'Skip')}
                                  </button>
                                  <button type="button" onClick={() => { setEditRowId(item.row.rowId); setEditField(''); setEditValue(''); setEditReason(''); }} className="px-1.5 py-0.5 rounded border border-sky-200 bg-sky-50 cursor-pointer">
                                    {isAr ? 'تصحيح' : 'Correct'}
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ---- audit / provenance ---- */}
            {tab === 'audit' && (
              <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
                <table id="odoo-import-audit" className="w-full text-[11px]">
                  <thead className="bg-slate-50 text-slate-600 sticky top-0">
                    <tr>
                      <th className={cell}>{isAr ? 'الصف' : 'Row'}</th>
                      <th className={cell}>{isAr ? 'الملف' : 'File'}</th>
                      <th className={cell}>{isAr ? 'الورقة' : 'Sheet'}</th>
                      <th className={cell}>{isAr ? 'رقم الصف' : 'Source row'}</th>
                      <th className={cell}>{isAr ? 'قاعدة التطبيع' : 'Normalization rule'}</th>
                      <th className={cell}>{isAr ? 'المعرّف المكتوب' : 'Written id'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staged.map((item) => (
                      <tr key={item.row.rowId} className="border-t border-slate-100">
                        <td className={`${cell} font-mono`}>{item.row.rowId}</td>
                        <td className={cell}>{item.provenance.sourceFile}</td>
                        <td className={cell}>{item.provenance.sourceSheet}</td>
                        <td className={`${cell} font-mono`}>{item.provenance.sourceRow}</td>
                        <td className={`${cell} font-mono text-slate-500`}>{item.provenance.normalizationRule ?? '-'}</td>
                        <td className={`${cell} font-mono`}>{item.row.importedId ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ---- approval ---- */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <span className="text-slate-600">
                {isAr ? 'جاهز للكتابة' : 'Ready to write'}: <b>{writable.length}</b>
                {session.counts.errors > 0 && (
                  <span className="text-rose-700 font-bold ms-2 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {isAr ? 'السطور المانعة لا تُكتب' : 'blocking rows are never written'}
                  </span>
                )}
              </span>
              <button
                id="odoo-import-execute"
                type="button"
                disabled={!canImport || busy || writable.length === 0}
                onClick={() => void execute()}
                className="px-4 py-2 font-black text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-xl cursor-pointer"
              >
                {isAr ? 'اعتماد وكتابة السجلات' : 'Approve & write records'}
              </button>
            </div>
          </>
        )}

        {rawRow && (
          <Modal isOpen onClose={() => setRawRowId(null)} title={isAr ? 'الصف الأصلي من الملف' : 'The raw row from the file'} maxWidth="2xl">
            <div className="space-y-2 text-[11px]" dir={isAr ? 'rtl' : 'ltr'}>
              <p className="font-mono text-slate-500">{rawRow.provenance.sourceFile} · {rawRow.provenance.sourceSheet} · {isAr ? 'صف' : 'row'} {rawRow.provenance.sourceRow}</p>
              <table className="w-full">
                <tbody>
                  {Object.entries(rawRow.rawRow).map(([key, value]) => (
                    <tr key={key} className="border-t border-slate-100">
                      <td className={`${cell} font-bold`}>{key}</td>
                      <td className={`${cell} font-mono`}>{String(value ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rawRow.row.normalizedData && (
                <>
                  <p className="font-black text-slate-800">{isAr ? 'القيمة بعد التطبيع' : 'Normalized'}</p>
                  <pre className="bg-slate-50 border border-slate-200 rounded-lg p-2 overflow-x-auto">{JSON.stringify(rawRow.row.normalizedData, null, 1)}</pre>
                </>
              )}
            </div>
          </Modal>
        )}

        {editRowId && (
          <Modal isOpen onClose={() => setEditRowId(null)} title={isAr ? 'تصحيح حقل' : 'Correct a field'} maxWidth="md">
            <div className="space-y-2 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
              <input value={editField} onChange={(e) => setEditField(e.target.value)} placeholder={isAr ? 'اسم الحقل' : 'Field name'} className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono" />
              <input value={editValue} onChange={(e) => setEditValue(e.target.value)} placeholder={isAr ? 'القيمة الجديدة' : 'New value'} className="w-full px-3 py-2 border border-slate-300 rounded-xl" />
              <input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder={isAr ? 'سبب التصحيح' : 'Correction reason'} className="w-full px-3 py-2 border border-slate-300 rounded-xl" />
              <p className="text-[11px] text-slate-500">{isAr ? 'القيمة الأصلية تبقى محفوظة كما هي.' : 'The original value is kept as it is.'}</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setEditRowId(null)} className="px-3 py-1.5 bg-slate-100 rounded-lg font-bold cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={saveCorrection} className="px-3 py-1.5 bg-sky-600 text-white rounded-lg font-bold cursor-pointer">{isAr ? 'حفظ التصحيح' : 'Save correction'}</button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
};

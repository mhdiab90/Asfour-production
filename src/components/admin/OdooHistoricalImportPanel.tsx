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
import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Upload, X } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { listImportSheetNames, parseImportFile } from '../../services/bulkImportService';
import { acceptRowWarnings, applyRowCorrection, setRowSelection, type ImportRowSelection } from '../../services/entityImportPure';
import { readMrpProduction } from '../../services/odooProductionReaderPure';
import { readMrpWorkOrder } from '../../services/odooWorkOrderReaderPure';
import { readStockScrap } from '../../services/odooScrapReaderPure';
import { buildOdooImportSession, isOdooRowWritable, type OdooSessionResult, type OdooStagedRow } from '../../services/odooImportSessionPure';
import {
  executeOdooImport,
  listOdooImportSessions,
  loadApprovedWorkCenterMappings,
  loadOdooImportSession,
  saveOdooImportSession,
  saveWorkCenterMapping,
} from '../../services/odooImportService';
import { buildImportReferenceIndexes, loadImportValidationContext } from '../../services/entityImportService';
import { WORK_CENTERS, type ApprovedWorkCenterMapping } from '../../services/workCenterRegistryPure';
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

      const sheetIssues = [...(production?.sheetIssues ?? []), ...(workOrders?.sheetIssues ?? []), ...(scrap?.sheetIssues ?? [])];
      const built = buildOdooImportSession({
        importSessionId: id,
        createdBy: user,
        createdAt: now(),
        production: production?.rows ?? [],
        workOrders: workOrders?.rows ?? [],
        scrap: scrap?.rows ?? [],
        approvedWorkCenters: approved,
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
  const execute = async () => {
    if (!session || writable.length === 0) return;
    const summary = isAr
      ? `سيتم كتابة ${writable.length} سجلًا (إنتاج + أوامر عمل + هالك). هل تريد المتابعة؟`
      : `${writable.length} record(s) will be written (production + work orders + scrap). Continue?`;
    if (!window.confirm(summary)) return;
    setBusy(true);
    setError(null);
    try {
      const stages = [...new Set(staged.map((s) => s.targetStage).filter(Boolean))] as ProductionStageType[];
      const context = await loadImportValidationContext(stages);
      const indexes = await buildImportReferenceIndexes(context, stages);
      const outcome = await executeOdooImport(session.importSessionId, staged, {
        context,
        indexes,
        mappingCache: new Map(),
        language: isAr ? 'ar' : 'en',
      });
      setStaged(outcome.staged);
      setResult({ production: outcome.writtenProduction, workOrders: outcome.writtenWorkOrders, scrap: outcome.writtenScrap, failed: outcome.failed, skipped: outcome.skipped });
      if (outcome.messages.length) setNotice(outcome.messages.slice(0, 5).join(' | '));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
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

            {result && (
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

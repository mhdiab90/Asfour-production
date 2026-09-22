/**
 * Live progress and final result of an entity import (3.21.2).
 *
 * Shows ONLY what the execution loop reports (ImportExecutionProgress while it
 * runs, ImportFinalResult when it ends) - no number here is computed or guessed
 * by the screen. The percentage is the loop's own rule: floor(processed / total),
 * never 100 until every phase ran and the final verification passed.
 *
 * At any moment the screen answers: is it running, how far, how many processed,
 * what is being processed, did it finish, did it succeed, how many succeeded /
 * failed / were skipped, and what went wrong.
 */
import React from 'react';
import { AlertTriangle, CheckCircle2, Loader2, OctagonX, PauseCircle } from 'lucide-react';
import { progressPercent } from '../../services/entityImportExecutionPure';
import type { ImportExecutionPhase, ImportExecutionProgress, ImportFinalResult, ImportRowIssue, KindCounts } from '../../services/entityImportExecutionPure';

const KIND_NAMES: Record<string, { ar: string; en: string }> = {
  products: { ar: 'المنتجات', en: 'Products' },
  materials: { ar: 'الخامات', en: 'Materials' },
  bomPackage: { ar: 'قوائم المواد', en: 'BOMs' },
  jobReferences: { ar: 'أوامر الشغل', en: 'Jobs' },
  batches: { ar: 'الدفعات', en: 'Batches' },
  boms: { ar: 'قوائم المواد', en: 'BOMs' },
  bomVersions: { ar: 'إصدارات قوائم المواد', en: 'BOM versions' },
  routings: { ar: 'المسارات', en: 'Routings' },
  routingVersions: { ar: 'إصدارات المسارات', en: 'Routing versions' },
  production: { ar: 'سجلات الإنتاج', en: 'Production records' },
};
const kindName = (kind: string | null, isAr: boolean) => (kind ? (isAr ? KIND_NAMES[kind]?.ar : KIND_NAMES[kind]?.en) ?? kind : '');

const PHASE_NAMES: Record<ImportExecutionPhase, { ar: string; en: string }> = {
  PREPARING: { ar: 'التحضير', en: 'Preparing' },
  RECORDS: { ar: 'السجلات', en: 'Records' },
  ITEMS: { ar: 'المنتجات والخامات', en: 'Products & Materials' },
  DEPENDENCIES: { ar: 'ربط الاعتماديات', en: 'Resolving Dependencies' },
  BOMS: { ar: 'قوائم المواد', en: 'BOMs' },
  VERIFYING: { ar: 'التحقق', en: 'Verifying' },
  DONE: { ar: 'اكتمل', en: 'Done' },
};

const fmt = (n: number, isAr: boolean) => n.toLocaleString(isAr ? 'ar-EG' : 'en-US');

/** The current-action sentence, from the loop's own snapshot. */
function actionMessage(p: ImportExecutionProgress, isAr: boolean): string {
  const at = fmt(Math.min(p.phaseProcessed + 1, Math.max(p.phaseTotal, 1)), isAr);
  const of = fmt(p.phaseTotal, isAr);
  switch (p.phase) {
    case 'PREPARING': return isAr ? 'جارٍ تحضير الاستيراد...' : 'Preparing import...';
    case 'ITEMS':
    case 'RECORDS':
      return p.currentKind === 'materials'
        ? (isAr ? `جارٍ استيراد الخامات... (${at} من ${of})` : `Importing materials... (${at} of ${of})`)
        : p.currentKind === 'products'
          ? (isAr ? `جارٍ استيراد المنتجات... (${at} من ${of})` : `Importing products... (${at} of ${of})`)
          : (isAr ? `جارٍ استيراد ${kindName(p.currentKind, isAr)}... (${at} من ${of})` : `Importing ${kindName(p.currentKind, isAr).toLowerCase()}... (${at} of ${of})`);
    case 'DEPENDENCIES': return isAr ? `جارٍ ربط معرّفات المنتجات والخامات بقوائم المواد... (${at} من ${of})` : `Resolving product IDs for BOMs... (${at} of ${of})`;
    case 'BOMS': return isAr ? `جارٍ استيراد قائمة المواد ${at} من ${of}...` : `Importing BOM ${at} of ${of}...`;
    case 'VERIFYING': return isAr ? 'جارٍ التحقق من السجلات المستوردة...' : 'Verifying imported records...';
    default: return isAr ? 'جارٍ إنهاء الاستيراد...' : 'Finalizing import...';
  }
}

function Bar({ percent, tone }: { percent: number; tone: string }) {
  return (
    <div className="h-3 w-full rounded-full bg-slate-200 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <div className={`h-full ${tone} transition-[width] duration-300`} style={{ width: `${percent}%` }} />
    </div>
  );
}

function Counter({ label, value, tone = 'text-slate-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`font-extrabold ${tone}`}>{value}</div>
    </div>
  );
}

function KindTable({ byKind, isAr }: { byKind: Record<string, KindCounts>; isAr: boolean }) {
  const kinds = Object.keys(byKind);
  if (!kinds.length) return null;
  return (
    <table className="w-full text-[11px] border border-slate-200 rounded-lg overflow-hidden">
      <thead className="bg-slate-50 text-slate-600">
        <tr>
          <th className="px-2 py-1 text-start">{isAr ? 'النوع' : 'Type'}</th>
          <th className="px-2 py-1 text-start">{isAr ? 'المخطط' : 'Planned'}</th>
          <th className="px-2 py-1 text-start">{isAr ? 'نجح' : 'Successful'}</th>
          <th className="px-2 py-1 text-start">{isAr ? 'فشل' : 'Failed'}</th>
          <th className="px-2 py-1 text-start">{isAr ? 'متخطى' : 'Skipped'}</th>
        </tr>
      </thead>
      <tbody>
        {kinds.map((k) => (
          <tr key={k} className="border-t border-slate-100">
            <td className="px-2 py-1 font-bold">{kindName(k, isAr)}</td>
            <td className="px-2 py-1">{fmt(byKind[k].total, isAr)}</td>
            <td className="px-2 py-1 text-emerald-700 font-bold">{fmt(byKind[k].succeeded, isAr)}</td>
            <td className="px-2 py-1 text-rose-700 font-bold">{fmt(byKind[k].failed, isAr)}</td>
            <td className="px-2 py-1 text-amber-700">{fmt(byKind[k].skipped, isAr)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A long issue list, rendered in a bounded way: the first rows plus how many more there are. */
function IssueList({ id, title, issues, isAr }: { id: string; title: string; issues: ImportRowIssue[]; isAr: boolean }) {
  if (!issues.length) return null;
  const shown = issues.slice(0, 300);
  return (
    <details id={id} className="rounded-lg border border-rose-200 bg-white">
      <summary className="px-3 py-2 font-bold text-rose-800 cursor-pointer">{title} ({fmt(issues.length, isAr)})</summary>
      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-[11px]">
          <tbody>
            {shown.map((f) => (
              <tr key={f.rowId} className="border-t border-slate-100 align-top">
                <td className="px-2 py-1 whitespace-nowrap">{kindName(f.kind, isAr)}</td>
                <td className="px-2 py-1 font-mono whitespace-nowrap">{f.code || f.rowId}</td>
                <td className="px-2 py-1 text-rose-800">{f.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {issues.length > shown.length && (
          <p className="px-3 py-2 text-slate-600">{isAr ? `و${fmt(issues.length - shown.length, isAr)} سطرًا آخر - كلها ظاهرة في جدول المراجعة (عامل التصفية: فشل / لم يُكتب).` : `and ${fmt(issues.length - shown.length, isAr)} more - all are listed in the review table (filter: Failed / Not written).`}</p>
        )}
      </div>
    </details>
  );
}

export interface ImportProgressPanelProps {
  isAr: boolean;
  progress: ImportExecutionProgress | null;
  final: ImportFinalResult | null;
  /** Rows the approved plan would write - shown as READY TO IMPORT before a run. */
  readyCount?: number;
  onStop?: () => void;
  stopRequested?: boolean;
  /** Closes the import window. Offered only once a final result is shown - the window never closes by itself. */
  onClose?: () => void;
}

/**
 * The closing message of a finished or stopped run (3.21.3), chosen ONLY from the
 * authoritative final result: success is never claimed unless the outcome is
 * COMPLETED.
 */
export function closingMessage(outcome: ImportFinalResult['outcome'], isAr: boolean): { icon: string; title: string; lines: string[] } {
  if (outcome === 'COMPLETED') {
    return isAr
      ? { icon: '✅', title: 'انتهت عملية الاستيراد', lines: ['تمت معالجة جميع السجلات ووصلت العملية إلى 100%.', 'يمكنك الآن إغلاق هذه النافذة بأمان.'] }
      : { icon: '✅', title: 'The import has finished', lines: ['Every record was processed and the import reached 100%.', 'You can now close this window safely.'] };
  }
  if (outcome === 'COMPLETED_WITH_ERRORS') {
    return isAr
      ? { icon: '⚠️', title: 'انتهت عملية الاستيراد مع وجود أخطاء', lines: ['انتهت عملية المعالجة ووصلت إلى 100%، ولكن توجد سجلات لم يتم استيرادها.', 'راجع النتيجة والتفاصيل قبل إغلاق النافذة.'] }
      : { icon: '⚠️', title: 'The import has finished with errors', lines: ['Processing finished and reached 100%, but some records were not imported.', 'Review the result and the details before closing the window.'] };
  }
  return isAr
    ? { icon: '⏸️', title: 'توقفت عملية الاستيراد', lines: ['تم حفظ نتائج السجلات التي تمت معالجتها حتى لحظة التوقف.', 'راجع السبب قبل إغلاق النافذة.'] }
    : { icon: '⏸️', title: 'The import has stopped', lines: ['The results of every record processed up to the stop are kept.', 'Review the reason before closing the window.'] };
}

export const ImportProgressPanel: React.FC<ImportProgressPanelProps> = ({ isAr, progress, final, readyCount, onStop, stopRequested, onClose }) => {
  // --- Final result -------------------------------------------------------------------------
  if (final) {
    const ok = final.outcome === 'COMPLETED';
    const partial = final.outcome === 'COMPLETED_WITH_ERRORS';
    const tone = ok ? 'border-emerald-300 bg-emerald-50' : partial ? 'border-amber-300 bg-amber-50' : 'border-rose-300 bg-rose-50';
    const headline = ok
      ? (isAr ? 'اكتمل الاستيراد بنجاح' : 'IMPORT COMPLETED SUCCESSFULLY')
      : partial ? (isAr ? 'اكتمل الاستيراد مع أخطاء' : 'IMPORT COMPLETED WITH ERRORS')
        : (isAr ? 'توقف الاستيراد' : 'IMPORT INTERRUPTED');
    const notPlannedTotal = Object.values(final.notPlanned).reduce((a, b) => a + b, 0);
    const closing = closingMessage(final.outcome, isAr);
    return (
      <div id="entity-import-final" data-outcome={final.outcome} className={`p-3 rounded-xl border-2 ${tone} space-y-2`}>
        <div id="entity-import-closing" className="rounded-lg bg-white/70 border border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-extrabold text-sm">{closing.icon} {closing.title}</p>
            {closing.lines.map((line) => <p key={line} className="text-slate-800">{line}</p>)}
          </div>
          {onClose && (
            <button id="entity-import-close" type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-slate-900 text-white font-extrabold cursor-pointer hover:bg-slate-700">
              {isAr ? 'إغلاق النافذة' : 'Close window'}
            </button>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
            <p className="font-extrabold text-sm flex items-center gap-1.5">
            {ok ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : partial ? <AlertTriangle className="w-5 h-5 text-amber-600" /> : <OctagonX className="w-5 h-5 text-rose-600" />}
            {headline}
            <span className="text-[10px] font-bold text-slate-600">{isAr ? '- نتيجة هذه العملية' : '- this run'}</span>
          </p>
          <span className="text-2xl font-black">{final.percent}%</span>
        </div>
        <Bar percent={final.percent} tone={ok ? 'bg-emerald-500' : partial ? 'bg-amber-500' : 'bg-rose-500'} />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          <Counter label={isAr ? 'تمت معالجته' : 'Processed'} value={`${fmt(final.processed, isAr)} / ${fmt(final.total, isAr)}`} />
          <Counter label={isAr ? 'نجح' : 'Successful'} value={fmt(final.succeeded, isAr)} tone="text-emerald-700" />
          <Counter label={isAr ? 'فشل' : 'Failed'} value={fmt(final.failed, isAr)} tone="text-rose-700" />
          <Counter label={isAr ? 'متخطى قبل الكتابة' : 'Skipped'} value={fmt(final.skipped, isAr)} tone="text-amber-700" />
          <Counter label={isAr ? 'بتحذيرات مقبولة' : 'With accepted warnings'} value={fmt(final.warnings, isAr)} />
        </div>
        <KindTable byKind={final.byKind} isAr={isAr} />
        {notPlannedTotal > 0 && (
          <p className="text-slate-700">
            {isAr ? 'لم تدخل خطة الاستيراد (مانعة، مكررة متخطاة، مستبعدة، أو تحذيرات غير مقبولة): ' : 'Not in the import plan (blocked, skipped duplicates, excluded, or warnings not accepted): '}
            {Object.entries(final.notPlanned).map(([k, n]) => `${kindName(k, isAr)} ${fmt(n, isAr)}`).join(isAr ? '، ' : ', ')}
          </p>
        )}
        {final.error && (
          <p className="font-bold text-rose-800">{isAr ? 'السبب: ' : 'Reason: '}{final.error}</p>
        )}
        {final.outcome === 'INTERRUPTED' && (
          <p className="text-slate-800">
            {isAr
              ? `توقف في مرحلة: ${final.stoppedIn ? PHASE_NAMES[final.stoppedIn].ar : '-'}. السجلات المكتوبة محفوظة. يمكن الاستئناف بأمان: أعد رفع نفس الحزمة واستورد مرة أخرى - ما كُتب بالفعل يُحدَّث ولا يتكرر.`
              : `Stopped in phase: ${final.stoppedIn ? PHASE_NAMES[final.stoppedIn].en : '-'}. Everything already written is kept. It can be resumed safely: upload the same package again and import - what was written is updated, never duplicated.`}
          </p>
        )}
        {!final.verification.ok && final.verification.issues.length > 0 && (
          <ul className="list-disc ps-5 text-rose-800">
            {final.verification.issues.map((i) => <li key={i}>{i}</li>)}
          </ul>
        )}
        <IssueList id="entity-import-final-failures" title={isAr ? 'السجلات الفاشلة وأسبابها' : 'Failed records and reasons'} issues={final.failures} isAr={isAr} />
        <IssueList id="entity-import-final-dropped" title={isAr ? 'سجلات لم تُكتب بعد إعادة التحقق' : 'Records not written after the final check'} issues={final.dropped} isAr={isAr} />
      </div>
    );
  }

  // --- Running -------------------------------------------------------------------------------
  if (progress) {
    const percent = progressPercent(progress);
    const verifying = progress.state === 'VERIFYING';
    return (
      <div id="entity-import-progress" data-state={progress.state} className="p-3 rounded-xl border-2 border-indigo-300 bg-indigo-50 space-y-2" aria-live="polite">
        <div className="flex items-center justify-between gap-2">
          <p className="font-extrabold text-sm flex items-center gap-1.5 text-indigo-950">
            <Loader2 className="w-4 h-4 animate-spin" />
            {verifying ? (isAr ? 'جارٍ التحقق' : 'VERIFYING') : (isAr ? 'جارٍ استيراد البيانات الأساسية' : 'IMPORTING')}
          </p>
          <span className="text-2xl font-black text-indigo-950">{percent}%</span>
        </div>
        <Bar percent={percent} tone="bg-indigo-500" />
        <p className="font-bold">
          {isAr ? `${fmt(progress.processed, isAr)} من ${fmt(progress.total, isAr)} سجل تمت معالجته` : `${fmt(progress.processed, isAr)} / ${fmt(progress.total, isAr)} records processed`}
        </p>
        {progress.phaseNumber > 0 && (
          <p className="font-bold text-indigo-900">
            {isAr ? `المرحلة ${progress.phaseNumber} من ${progress.phaseCount} - ${PHASE_NAMES[progress.phase].ar}` : `Phase ${progress.phaseNumber} of ${progress.phaseCount} — ${PHASE_NAMES[progress.phase].en}`}
          </p>
        )}
        <p id="entity-import-progress-action" className="text-slate-700">{actionMessage(progress, isAr)}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <Counter label={isAr ? 'نجح' : 'Successful'} value={fmt(progress.succeeded, isAr)} tone="text-emerald-700" />
          <Counter label={isAr ? 'فشل' : 'Failed'} value={fmt(progress.failed, isAr)} tone="text-rose-700" />
          <Counter label={isAr ? 'متخطى' : 'Skipped'} value={fmt(progress.skipped, isAr)} tone="text-amber-700" />
          <Counter label={isAr ? 'بتحذيرات مقبولة' : 'With accepted warnings'} value={fmt(progress.warnings, isAr)} />
        </div>
        {progress.lastError && <p className="text-rose-800">{isAr ? 'آخر خطأ: ' : 'Last error: '}{progress.lastError}</p>}
        <div className="flex items-center justify-between gap-2">
          <p className="text-slate-600">{isAr ? 'لا تغلق الصفحة أثناء الاستيراد.' : 'Keep this page open while the import runs.'}</p>
          {onStop && (
            <button id="entity-import-stop" type="button" onClick={onStop} disabled={stopRequested} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white font-bold cursor-pointer disabled:opacity-50">
              <PauseCircle className="w-3.5 h-3.5" />
              {stopRequested ? (isAr ? 'سيتوقف بعد الدفعة الحالية...' : 'Stopping after this batch...') : (isAr ? 'إيقاف بعد الدفعة الحالية' : 'Stop after this batch')}
            </button>
          )}
        </div>
      </div>
    );
  }

  // --- Ready ---------------------------------------------------------------------------------
  if (readyCount && readyCount > 0) {
    return (
      <div id="entity-import-ready" className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 font-bold text-slate-800">
        {isAr ? `جاهز للاستيراد: ${fmt(readyCount, isAr)} سجل` : `READY TO IMPORT: ${fmt(readyCount, isAr)} records`}
      </div>
    );
  }
  return null;
};

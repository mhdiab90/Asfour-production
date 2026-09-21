/**
 * UOM data readiness - a small read-only section of Data Review (Phase 1 Step 8).
 *
 * Analyses the records the screen already shows, on request. Shows the stage UOM
 * matrix, the readiness summary and the findings, and exports them. It edits
 * nothing: each finding names a factual action to take in the record's existing
 * screen. No conversion is applied or suggested beyond what is configured.
 */
import React, { useState } from 'react';
import { Ruler, Download, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import type { UniversalStageRecord } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { loadUomReadiness } from '../../services/uomReadinessService';
import { STAGE_UOM_MATRIX, UOM_SUMMARY_LABELS } from '../../services/uomReadinessPure';
import type { UomFinding, UomReadinessSummary } from '../../services/uomReadinessPure';

const SEVERITY_TONE: Record<string, string> = {
  BLOCKING: 'bg-red-50 text-red-800 border-red-200',
  WARNING: 'bg-amber-50 text-amber-800 border-amber-200',
  INFO: 'bg-emerald-50 text-emerald-800 border-emerald-200',
};

const STAGE_STATUS_TONE: Record<string, string> = {
  READY: 'text-emerald-700',
  UNIT_MISMATCH_RISK: 'text-amber-700',
  NO_PRODUCTION_RECORD_TYPE: 'text-slate-500',
  SUB_ACTIVITY: 'text-sky-700',
};

export const UomReadinessPanel: React.FC<{ records: readonly UniversalStageRecord[] }> = ({ records }) => {
  const { language, isRtl } = useLanguage();
  const isAr = language === 'ar';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ findings: UomFinding[]; summary: UomReadinessSummary } | null>(null);
  const [problemsOnly, setProblemsOnly] = useState(true);

  const analyse = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await loadUomReadiness(records));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const exportReport = () => {
    if (!result) return;
    const rows = result.findings.map((f) => ({
      Entity: f.entityType,
      'Record ID': f.recordId,
      Line: f.lineId ?? '',
      Stage: f.stage ?? '',
      Context: f.context ?? '',
      Field: f.field,
      'Original UOM': f.originalUom ?? '',
      'Normalized UOM': f.normalizedUom ?? '',
      Category: f.category ?? '',
      Severity: f.severity,
      Issue: f.issue,
      Reason: isAr ? f.reasonAr : f.reasonEn,
      'Recommended Action': isAr ? f.recommendedActionAr : f.recommendedActionEn,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'UOM_Readiness');
    XLSX.writeFile(wb, `ASFOUR_UOM_Readiness_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const shown = result ? result.findings.filter((f) => !problemsOnly || f.severity !== 'INFO') : [];

  return (
    <div id="uom-readiness-panel" className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 space-y-3 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 font-black text-slate-800 cursor-pointer">
          <Ruler className="w-4 h-4 text-teal-600" />
          {isAr ? 'جاهزية وحدات القياس (قبل التكاليف)' : 'Unit of measure readiness (before costing)'}
          <span className="text-[10px] font-normal text-slate-400">{isAr ? '- للقراءة فقط' : '- read-only'}</span>
        </button>
        {open && (
          <div className="flex items-center gap-2">
            <button id="uom-readiness-run" type="button" disabled={busy} onClick={() => void analyse()} className="flex items-center gap-1 px-3 py-1.5 font-bold bg-teal-50 text-teal-800 hover:bg-teal-100 rounded-lg cursor-pointer disabled:opacity-50">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isAr ? `تحليل السجلات المعروضة (${records.length})` : `Analyze shown records (${records.length})`}
            </button>
            {result && (
              <button id="uom-readiness-export" type="button" onClick={exportReport} className="flex items-center gap-1 px-3 py-1.5 font-bold bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                <Download className="w-3.5 h-3.5" />{isAr ? 'تصدير' : 'Export'}
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
        <>
          {error && <p className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-800 font-bold">{error}</p>}

          {/* Stage UOM matrix - code-level, deterministic */}
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table id="uom-stage-matrix" className="w-full text-[11px] min-w-[760px]">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="p-2 text-start">{isAr ? 'المرحلة' : 'Stage'}</th>
                  <th className="p-2 text-start">{isAr ? 'وحدة الإنتاج' : 'Production unit'}</th>
                  <th className="p-2 text-start">{isAr ? 'كميات أخرى' : 'Other quantities'}</th>
                  <th className="p-2 text-start">{isAr ? 'وحدات المخرجات' : 'Output units'}</th>
                  <th className="p-2 text-start">{isAr ? 'وحدات الاستهلاك' : 'Consumption units'}</th>
                  <th className="p-2 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody>
                {STAGE_UOM_MATRIX.map((row) => (
                  <tr key={row.operationCode} className="border-t border-slate-100 align-top">
                    <td className="p-2 font-bold">{isAr ? row.nameAr : row.nameEn}</td>
                    <td className="p-2">{row.production ? `${row.production.unit} (${row.production.fields.join(' / ')})` : '-'}</td>
                    <td className="p-2">{row.otherMeasures.map((m) => `${m.unit}${m.fields.length ? ` (${m.fields.join(' / ')})` : ''}`).join('، ') || '-'}</td>
                    <td className="p-2 font-mono">{row.outputUnits}</td>
                    <td className="p-2 font-mono">{row.consumptionUnits}</td>
                    <td className="p-2">
                      <span className={`font-bold ${STAGE_STATUS_TONE[row.status]}`}>{row.status}</span>
                      {(isAr ? row.noteAr : row.noteEn) && <div className="text-slate-500">{isAr ? row.noteAr : row.noteEn}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(UOM_SUMMARY_LABELS) as Array<keyof typeof UOM_SUMMARY_LABELS>).map((k) => (
                  <span key={k} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200">
                    {isAr ? UOM_SUMMARY_LABELS[k].ar : UOM_SUMMARY_LABELS[k].en}: <span className="font-bold">{result.summary[k]}</span>
                  </span>
                ))}
              </div>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
                {isAr ? 'المشكلات فقط' : 'Problems only'}
              </label>
              {shown.length === 0 ? (
                <p className="p-3 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500">{isAr ? 'لا توجد نتائج.' : 'No findings.'}</p>
              ) : (
                <div className="overflow-x-auto max-h-80 overflow-y-auto border border-slate-200 rounded-xl">
                  <table id="uom-readiness-findings" className="w-full text-[11px] min-w-[900px]">
                    <thead className="bg-slate-50 sticky top-0 z-10 text-slate-600">
                      <tr>
                        <th className="p-2 text-start">{isAr ? 'الكيان' : 'Entity'}</th>
                        <th className="p-2 text-start">{isAr ? 'السجل' : 'Record'}</th>
                        <th className="p-2 text-start">{isAr ? 'الحقل' : 'Field'}</th>
                        <th className="p-2 text-start">{isAr ? 'الوحدة الأصلية' : 'Original UOM'}</th>
                        <th className="p-2 text-start">{isAr ? 'الوحدة المعتمدة' : 'Normalized UOM'}</th>
                        <th className="p-2 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                        <th className="p-2 text-start">{isAr ? 'الإجراء المقترح' : 'Recommended action'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((f, i) => (
                        <tr key={`${f.entityType}-${f.recordId}-${f.lineId ?? ''}-${f.field}-${f.issue}-${i}`} className="border-t border-slate-100 align-top">
                          <td className="p-2 font-mono">{f.entityType}</td>
                          <td className="p-2 font-mono">{f.recordId}{f.lineId ? ` / ${f.lineId}` : ''}{f.context ? <div className="text-slate-400">{f.context}</div> : null}</td>
                          <td className="p-2 font-mono">{f.field}</td>
                          <td className="p-2">{f.originalUom ?? '-'}</td>
                          <td className="p-2">{f.normalizedUom ?? '-'}</td>
                          <td className="p-2">
                            <span className={`px-1.5 py-0.5 rounded border font-bold ${SEVERITY_TONE[f.severity]}`}>{f.severity}</span>
                            <div className="font-mono text-[10px] mt-0.5">{f.issue}</div>
                            <div className="text-slate-500">{isAr ? f.reasonAr : f.reasonEn}</div>
                          </td>
                          <td className="p-2">{isAr ? f.recommendedActionAr : f.recommendedActionEn}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

/**
 * Standard vs Actual - quantity variance of one production record (Phase 1 Step 7).
 *
 * Shown inside the existing Data Review record modal. READ-ONLY: no edit,
 * no "apply to BOM", no save, no audit entry for viewing. The calculation lives
 * in services/quantityVariancePure.ts; this panel only loads and displays it.
 */
import React, { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import type { UniversalStageRecord } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { BOM_UNIT_LABELS } from '../../services/bomPure';
import { loadQuantityVariance } from '../../services/quantityVarianceService';
import type { QuantityVarianceReport, VarianceStatus } from '../../services/quantityVariancePure';
import { stageProductionMeasure } from '../../services/uomReadinessPure';

const STATUS_LABELS: Record<VarianceStatus, { ar: string; en: string; tone: string }> = {
  MATCHED: { ar: 'مطابق', en: 'Matched', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  OVER_CONSUMED: { ar: 'استهلاك زائد', en: 'Over-consumed', tone: 'bg-red-50 text-red-800 border-red-200' },
  UNDER_CONSUMED: { ar: 'استهلاك أقل', en: 'Under-consumed', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  MISSING: { ar: 'غير مستهلك', en: 'Missing', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  OFF_BOM: { ar: 'خارج قائمة المواد', en: 'Off-BOM', tone: 'bg-purple-50 text-purple-800 border-purple-200' },
  OFF_BOM_ADDITIVE: { ar: 'إضافة خارج قائمة المواد', en: 'Off-BOM additive', tone: 'bg-purple-50 text-purple-800 border-purple-200' },
  FORMULA_TYPE_MISMATCH: { ar: 'اختلاف نوع المكوّن (أساسي/إضافة)', en: 'Base / additive mismatch', tone: 'bg-orange-50 text-orange-800 border-orange-200' },
  UNIT_MISMATCH: { ar: 'اختلاف الوحدة', en: 'Unit mismatch', tone: 'bg-orange-50 text-orange-800 border-orange-200' },
  UNRESOLVED_ITEM_IDENTITY: { ar: 'هوية صنف غير محسومة', en: 'Unresolved identity', tone: 'bg-slate-100 text-slate-700 border-slate-300' },
  NO_STANDARD_QUANTITY: { ar: 'لا توجد كمية معيارية', en: 'No standard quantity', tone: 'bg-slate-100 text-slate-700 border-slate-300' },
  INVALID_ACTUAL_QUANTITY: { ar: 'كمية فعلية غير صالحة', en: 'Invalid actual quantity', tone: 'bg-slate-100 text-slate-700 border-slate-300' },
  MISSING_BOM_BASIS: { ar: 'أساس الخلطة مفقود', en: 'Missing BOM basis', tone: 'bg-slate-100 text-slate-700 border-slate-300' },
  SCALING_NOT_SUPPORTED: { ar: 'تعذر معايرة الأساس', en: 'Scaling not possible', tone: 'bg-slate-100 text-slate-700 border-slate-300' },
};

const fmt = (n: number | null, digits = 3) => (n === null ? '-' : Number(n.toFixed(digits)).toLocaleString('en-US', { maximumFractionDigits: digits }));

export const QuantityVariancePanel: React.FC<{ record: UniversalStageRecord }> = ({ record }) => {
  const { language, isRtl } = useLanguage();
  const isAr = language === 'ar';
  const [report, setReport] = useState<QuantityVarianceReport | null>(null);
  const [failed, setFailed] = useState(false);

  const raw = (record.rawData ?? {}) as Record<string, unknown>;
  const jobReferenceId = typeof raw.jobReferenceId === 'string' ? raw.jobReferenceId : null;
  // Phase 1 Step 8: the stage's own production field in its true unit (stage UOM matrix) - not the
  // review list's label, which shows Chinese Mills tons as "شيكارة" and Sorting tons as "قطعة".
  const measure = stageProductionMeasure(record.stageType, raw);

  useEffect(() => {
    let alive = true;
    setReport(null);
    setFailed(false);
    loadQuantityVariance({
      jobReferenceId,
      materials: record.materials ?? [],
      productionQuantity: measure.quantity,
      productionUnit: measure.unit,
    })
      .then((r) => { if (alive) setReport(r); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [record.id, jobReferenceId, measure.quantity, measure.unit, record.materials]);

  const unit = (u: string | null) => (u ? (BOM_UNIT_LABELS[u] ? (isAr ? BOM_UNIT_LABELS[u].ar : BOM_UNIT_LABELS[u].en) : u) : '');
  const title = isAr ? 'المعياري مقابل الفعلي (فروق الكميات)' : 'Standard vs Actual (quantity variance)';

  return (
    <div id="quantity-variance-panel" className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
      <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
        <Scale className="w-4 h-4 text-teal-600" />
        {title}
        <span className="text-[10px] font-normal text-slate-400">{isAr ? '(للقراءة فقط - كميات فقط بدون تكلفة)' : '(read-only - quantities only, no cost)'}</span>
      </h3>

      {failed && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800">{isAr ? 'تعذر تحميل بيانات المقارنة.' : 'Could not load the comparison data.'}</div>}
      {!failed && !report && <div className="p-3 text-center text-slate-400">{isAr ? 'جاري التحميل...' : 'Loading...'}</div>}

      {report && report.state !== 'COMPARED' && (
        <div className={`p-3 rounded-xl border ${report.state === 'NO_STANDARD_BOM' ? 'bg-slate-50 border-slate-200 text-slate-600' : 'bg-red-50 border-red-200 text-red-800'}`}>
          <span className="font-mono text-[10px] me-2">{report.state}</span>
          {report.message ? (isAr ? report.message.messageAr : report.message.messageEn) : ''}
        </div>
      )}

      {report && report.state === 'COMPARED' && (
        <>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
            <span>{isAr ? 'قائمة المواد:' : 'BOM:'} <span className="font-bold">{report.bomCode ?? report.bomId} / {report.bomVersionCode}</span> ({report.bomVersionStatus})</span>
            <span>{isAr ? 'النطاق:' : 'Scope:'} <span className="font-bold">{report.bomCustomerId ? (isAr ? 'خاص بعميل' : 'Customer-specific') : (isAr ? 'قياسي' : 'Standard')}</span></span>
            {report.basis?.state === 'NO_BASIS' && <span>{isAr ? 'الكميات كما هي في الإصدار (بدون أساس)' : 'Quantities as written in the version (no basis)'}</span>}
            {report.basis?.state === 'SCALED' && (
              <span>
                {isAr ? 'معايرة:' : 'Scaled:'} {fmt(report.basis.productionQuantity)} {unit(report.basis.productionUnit)} ÷ {fmt(report.basis.basisQuantity)} {unit(report.basis.basisUnit)} = ×{fmt(report.basis.scaleFactor, 4)}
              </span>
            )}
          </div>
          {report.message && <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">{isAr ? report.message.messageAr : report.message.messageEn}</div>}

          <div className="flex flex-wrap gap-1.5">
            {([
              ['standardItems', isAr ? 'أصناف معيارية' : 'Standard items'],
              ['actualItems', isAr ? 'أصناف فعلية' : 'Actual items'],
              ['matched', STATUS_LABELS.MATCHED],
              ['overConsumed', STATUS_LABELS.OVER_CONSUMED],
              ['underConsumed', STATUS_LABELS.UNDER_CONSUMED],
              ['missing', STATUS_LABELS.MISSING],
              ['offBom', STATUS_LABELS.OFF_BOM],
              ['offBomAdditive', STATUS_LABELS.OFF_BOM_ADDITIVE],
              ['formulaTypeMismatch', STATUS_LABELS.FORMULA_TYPE_MISMATCH],
              ['unitMismatch', STATUS_LABELS.UNIT_MISMATCH],
              ['unresolvedIdentity', STATUS_LABELS.UNRESOLVED_ITEM_IDENTITY],
              ['missingBomBasis', STATUS_LABELS.MISSING_BOM_BASIS],
            ] as const).map(([k, label]) => (
              <span key={k} className="px-2 py-1 rounded-lg bg-slate-50 border border-slate-200">
                {typeof label === 'string' ? label : isAr ? label.ar : label.en}: <span className="font-bold">{report.summary[k]}</span>
              </span>
            ))}
          </div>

          {report.rows.length === 0 ? (
            <div className="p-3 text-center bg-slate-50 rounded-xl border border-slate-200 text-slate-500">{isAr ? 'لا توجد مكونات أو استهلاك للمقارنة.' : 'No components or consumption to compare.'}</div>
          ) : (
            <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-xl">
              <table className="w-full text-xs text-start">
                <thead className="bg-slate-50 sticky top-0 z-10 text-slate-600">
                  <tr>
                    <th className="p-2 text-start">{isAr ? 'النوع' : 'Type'}</th>
                    <th className="p-2 text-start">{isAr ? 'الصنف' : 'Item'}</th>
                    <th className="p-2 text-start">{isAr ? 'المعياري' : 'Standard'}</th>
                    <th className="p-2 text-start">{isAr ? 'الفعلي' : 'Actual'}</th>
                    <th className="p-2 text-start">{isAr ? 'الفرق' : 'Variance'}</th>
                    <th className="p-2 text-start">{isAr ? 'الفرق %' : 'Variance %'}</th>
                    <th className="p-2 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => {
                    const st = STATUS_LABELS[r.status];
                    const scaled = report.basis?.state === 'SCALED' && r.standardQuantity !== null;
                    return (
                      <tr key={`${r.componentType}:${r.key}`} className="border-t border-slate-100">
                        <td className="p-2 whitespace-nowrap font-bold">
                          {r.componentType === 'ADDITIVE' ? <span className="text-purple-700">{isAr ? '+ إضافة' : '+ Additive'}</span> : <span className="text-slate-600">{isAr ? 'أساسي' : 'Base'}</span>}
                        </td>
                        <td className="p-2">
                          <div className="font-bold text-slate-800">{r.itemName || r.itemId || '-'}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{r.itemCode || `${r.itemSource}/${r.itemId}`}{r.logicalItemId ? ` · ${isAr ? 'صنف منطقي' : 'logical'}` : ''}</div>
                        </td>
                        <td className="p-2">
                          {r.inBom ? (
                            <>
                              {fmt(scaled ? r.expectedQuantity : r.standardQuantity)} {unit(r.standardUnit)}
                              {scaled && <div className="text-[10px] text-slate-400">{isAr ? 'في الإصدار:' : 'in version:'} {fmt(r.standardQuantity)}</div>}
                            </>
                          ) : '-'}
                        </td>
                        <td className="p-2">{r.actualFound ? `${fmt(r.actualQuantity)} ${unit(r.actualUnit)}` : '-'}</td>
                        <td className="p-2 font-bold">{r.varianceQuantity === null ? '-' : `${r.varianceQuantity > 0 ? '+' : ''}${fmt(r.varianceQuantity)} ${unit(r.actualUnit)}`}</td>
                        <td className="p-2">{r.variancePercent === null ? '-' : `${r.variancePercent > 0 ? '+' : ''}${fmt(r.variancePercent, 2)}%`}</td>
                        <td className="p-2"><span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${st.tone}`}>{isAr ? st.ar : st.en}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
};

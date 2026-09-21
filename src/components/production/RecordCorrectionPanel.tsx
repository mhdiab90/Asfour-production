/**
 * Correcting a saved production record - Phase 1 Step 8C-2. Opened from the
 * existing Data Review record modal, behind the existing correction right.
 *
 * It reuses the ENTRY screen's own editors - the reference panel, the actual
 * consumption panel and the genealogy output panel - so a correction is made
 * and validated exactly the way the record was created. The correction is
 * refused with the same messages, and applied through the existing
 * updateStageRecord, which records the old value, the new value, the user, the
 * time and the reason in the existing audit history.
 *
 * Identity and workflow (id, stage, creator, approval status) are never edited here.
 */
import React, { useState } from 'react';
import { Loader2, Wrench } from 'lucide-react';
import type { UniversalStageRecord } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { ProductionReferencePanel } from './ProductionReferencePanel';
import { ActualConsumptionPanel } from './ActualConsumptionPanel';
import { ProductionGenealogyPanel } from './ProductionGenealogyPanel';
import { correctProductionRecord } from '../../services/recordCorrectionService';
import { stageProductionMeasure } from '../../services/uomReadinessPure';
import { BOM_UNIT_LABELS } from '../../services/bomPure';
import type { ProductionReferenceSelection } from '../../services/productionReferencePure';
import type { MaterialConsumptionItem, ProductionOutputLine } from '../../types';

interface Props {
  record: UniversalStageRecord;
  /** The existing production correction right, decided by the caller. */
  canCorrect: boolean;
  /** Called after a correction is written, so the list and the modal reload. */
  onCorrected: () => void;
}

export const RecordCorrectionPanel: React.FC<Props> = ({ record, canCorrect, onCorrected }) => {
  const { language, isRtl } = useLanguage();
  const isAr = language === 'ar';
  const raw = (record.rawData ?? {}) as Record<string, any>;
  const measure = stageProductionMeasure(record.stageType, raw);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [references, setReferences] = useState<ProductionReferenceSelection>({
    jobReferenceId: raw.jobReferenceId ?? undefined,
    batchId: raw.batchId ?? undefined,
    logicalItemId: raw.logicalItemId ?? undefined,
    hierarchyNodeId: raw.hierarchyNodeId ?? undefined,
  });
  const [materials, setMaterials] = useState<MaterialConsumptionItem[]>(Array.isArray(raw.materials) ? raw.materials : []);
  const [outputs, setOutputs] = useState<ProductionOutputLine[]>(Array.isArray(raw.productionOutputs) ? raw.productionOutputs : []);
  const [quantity, setQuantity] = useState<string>(measure.quantity === null ? '' : String(measure.quantity));

  const unitLabel = measure.unit && BOM_UNIT_LABELS[measure.unit] ? (isAr ? BOM_UNIT_LABELS[measure.unit].ar : BOM_UNIT_LABELS[measure.unit].en) : measure.unit ?? '';

  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const parsed = quantity.trim() === '' ? null : Number(quantity);
      const { written, plan } = await correctProductionRecord(
        record.stageType,
        record.id,
        raw,
        {
          references,
          materials: materials as unknown as Array<Record<string, unknown>>,
          productionOutputs: outputs as unknown as Array<Record<string, unknown>>,
          productionQuantity: parsed,
          reason,
        },
        isAr ? 'ar' : 'en',
      );
      if (!written) {
        setDone(isAr ? 'لا يوجد تغيير لحفظه.' : 'Nothing changed, so nothing was written.');
      } else {
        setDone(isAr ? `تم حفظ التصحيح (${plan.changes.length} تغيير).` : `Correction saved (${plan.changes.length} change(s)).`);
        onCorrected();
      }
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  if (!canCorrect) return null;

  return (
    <div id="record-correction-panel" className="space-y-3 text-xs" dir={isRtl ? 'rtl' : 'ltr'}>
      <button
        id="record-correction-toggle"
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-bold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg cursor-pointer"
      >
        <Wrench className="w-3.5 h-3.5" />
        {isAr ? 'تصحيح المراجع والاستهلاك والمخرجات' : 'Correct references, consumption and outputs'}
      </button>

      {open && (
        <div className="border border-indigo-200 bg-indigo-50/30 rounded-xl p-3 space-y-3">
          <p className="font-semibold text-indigo-900 leading-relaxed">
            {isAr
              ? 'يُعاد التحقق من التصحيح بنفس قواعد الإدخال. تُحفظ القيمة الأصلية والقيمة الجديدة والمستخدم والوقت والسبب في سجل التدقيق الحالي. لا تتغير هوية السجل ولا حالته.'
              : 'A correction is revalidated by the same rules as entry. The original value, the new value, the user, the time and the reason are kept in the existing audit history. The record identity and status are not changed here.'}
          </p>

          <ProductionReferencePanel stageType={record.stageType} value={references} onChange={setReferences} />

          {measure.field && (
            <label className="block space-y-1">
              <span className="font-bold text-slate-700">
                {isAr ? 'كمية الإنتاج' : 'Production quantity'} ({measure.field}) {unitLabel}
              </span>
              <input
                id="record-correction-quantity"
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-48 bg-white border border-slate-300 rounded-lg px-3 py-2 font-bold"
              />
            </label>
          )}

          <ActualConsumptionPanel lines={materials} onChange={setMaterials} jobReferenceId={references.jobReferenceId} />

          <ProductionGenealogyPanel
            showInputs={false}
            inputs={materials}
            onInputsChange={setMaterials}
            outputs={outputs}
            onOutputsChange={setOutputs}
            jobReferenceId={references.jobReferenceId}
          />

          <label className="block space-y-1">
            <span className="font-bold text-slate-700">{isAr ? 'سبب التصحيح *' : 'Correction reason *'}</span>
            <input
              id="record-correction-reason"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isAr ? 'مثال: تصحيح دفعة المدخل من كشف المخزن' : 'e.g. input batch corrected from the store sheet'}
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2"
            />
          </label>

          {error && <p className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold text-rose-800">{error}</p>}
          {done && <p className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 font-bold text-emerald-800">{done}</p>}

          <div className="flex items-center justify-end">
            <button
              id="record-correction-save"
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="inline-flex items-center gap-1.5 px-4 py-2 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isAr ? 'حفظ التصحيح الموثق' : 'Save audited correction'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

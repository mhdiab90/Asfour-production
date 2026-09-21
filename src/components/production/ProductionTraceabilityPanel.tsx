/**
 * Production traceability - Phase 1 Step 8C. Read-only, inside the existing
 * Data Review record modal.
 *
 * Answers, for ONE record: which job (and whether it is a SUB-JOB of a main
 * job), which batch, which operation, cost centre and machine, what was
 * consumed, what was produced, and which lots the genealogy links - the input
 * and output batch ids the record already carries.
 *
 * It only displays what the record and the existing masters already hold:
 * nothing is calculated, corrected, converted or written.
 */
import React, { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import type { UniversalStageRecord } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from '../../services/masterDataService';
import { BOM_UNIT_LABELS, componentTypeOf } from '../../services/bomPure';
import { stageProductionMeasure } from '../../services/uomReadinessPure';

type Stored = Record<string, any> & { id?: string };

const EQUIPMENT_FIELDS: Array<{ field: string; collection: string; labelAr: string; labelEn: string }> = [
  { field: 'pressId', collection: MASTER_DATA_COLLECTIONS.presses, labelAr: 'المكبس', labelEn: 'Press' },
  { field: 'furnaceId', collection: MASTER_DATA_COLLECTIONS.furnaces, labelAr: 'الفرن', labelEn: 'Furnace' },
  { field: 'rotaryKilnId', collection: MASTER_DATA_COLLECTIONS.rotaryKilns, labelAr: 'الفرن الدوار', labelEn: 'Rotary kiln' },
  { field: 'millId', collection: MASTER_DATA_COLLECTIONS.mills, labelAr: 'الطاحونة الصينية', labelEn: 'Chinese mill' },
  { field: 'tubeBallMillId', collection: MASTER_DATA_COLLECTIONS.tubeBallMills, labelAr: 'طاحونة الأنابيب/الكرات', labelEn: 'Tube / ball mill' },
  { field: 'bunkerId', collection: MASTER_DATA_COLLECTIONS.bunkers, labelAr: 'البنكر', labelEn: 'Bunker' },
];

export const ProductionTraceabilityPanel: React.FC<{ record: UniversalStageRecord }> = ({ record }) => {
  const { language, isRtl } = useLanguage();
  const isAr = language === 'ar';
  const [jobs, setJobs] = useState<Stored[]>([]);
  const [batches, setBatches] = useState<Stored[]>([]);
  const [operations, setOperations] = useState<Stored[]>([]);
  const [equipment, setEquipment] = useState<Record<string, Stored[]>>({});

  const raw = (record.rawData ?? {}) as Record<string, any>;
  const jobId = String(raw.jobReferenceId ?? '');
  const batchId = String(raw.batchId ?? '');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [j, b, o] = await Promise.all([
        fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.jobReferences).catch(() => []),
        fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.batches).catch(() => []),
        fetchMasterData<Stored>(MASTER_DATA_COLLECTIONS.stages).catch(() => []),
      ]);
      if (!alive) return;
      setJobs(j ?? []);
      setBatches(b ?? []);
      setOperations(o ?? []);
      const used = EQUIPMENT_FIELDS.filter((e) => String(raw[e.field] ?? ''));
      const lists = await Promise.all(used.map((e) => fetchMasterData<Stored>(e.collection).catch(() => [])));
      if (!alive) return;
      setEquipment(Object.fromEntries(used.map((e, i) => [e.field, lists[i] ?? []])));
    };
    void load();
    return () => { alive = false; };
  }, [record.id, jobId, batchId, raw]);

  const label = (list: Stored[], id: string, codeField = 'code') => {
    const found = list.find((x) => String(x.id ?? '') === id);
    return found ? [found[codeField], found.name ?? found.nameAr ?? found.batchNumber].filter(Boolean).join(' - ') : id || '-';
  };
  const unit = (u: unknown) => {
    const v = String(u ?? '');
    return v && BOM_UNIT_LABELS[v] ? (isAr ? BOM_UNIT_LABELS[v].ar : BOM_UNIT_LABELS[v].en) : v || '-';
  };

  const job = jobs.find((j) => String(j.id ?? '') === jobId) ?? null;
  const parentJob = job && job.parentJobReferenceId ? jobs.find((j) => String(j.id ?? '') === String(job.parentJobReferenceId)) ?? null : null;
  const recordBatch = batchId ? batches.find((b) => String(b.id ?? '') === batchId) ?? null : null;
  const jobBatches = jobId ? batches.filter((b) => String(b.jobReferenceId ?? '') === jobId) : [];
  const materials: Stored[] = Array.isArray(raw.materials) ? raw.materials : [];
  const outputs: Stored[] = Array.isArray(raw.productionOutputs) ? raw.productionOutputs : [];
  const inputBatchIds: string[] = Array.isArray(raw.genealogyInputBatchIds) ? raw.genealogyInputBatchIds : [];
  const outputBatchIds: string[] = Array.isArray(raw.genealogyOutputBatchIds) ? raw.genealogyOutputBatchIds : [];
  const measure = stageProductionMeasure(record.stageType, raw);
  const usedEquipment = EQUIPMENT_FIELDS.filter((e) => String(raw[e.field] ?? ''));

  const cell = 'p-2 text-start';
  const head = 'bg-slate-50 text-slate-600';

  return (
    <div id="production-traceability-panel" className="space-y-3" dir={isRtl ? 'rtl' : 'ltr'}>
      <h3 className="font-bold text-slate-800 flex items-center gap-1.5">
        <GitBranch className="w-4 h-4 text-indigo-600" />
        {isAr ? 'التتبع: أمر الشغل، الدفعة، المستهلك والمنتج' : 'Traceability: job, batch, consumption and output'}
        <span className="text-[10px] font-normal text-slate-400">{isAr ? '(للقراءة فقط)' : '(read-only)'}</span>
      </h3>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200">
        <div>
          <span className="text-slate-500 font-bold block mb-1">{isAr ? 'أمر الشغل' : 'Job'}</span>
          <span className="font-bold text-slate-900">{job ? [job.code, job.status].filter(Boolean).join(' · ') : (isAr ? 'غير مرتبط' : 'Not linked')}</span>
          {parentJob && <div className="text-[10px] text-indigo-700 font-bold mt-0.5">{isAr ? 'أمر فرعي من' : 'Sub-job of'} {String(parentJob.code ?? '')}</div>}
        </div>
        <div>
          <span className="text-slate-500 font-bold block mb-1">{isAr ? 'الدفعة' : 'Batch'}</span>
          <span className="font-bold text-slate-900">{recordBatch ? String(recordBatch.batchNumber ?? recordBatch.id) : (isAr ? 'غير مرتبطة' : 'Not linked')}</span>
          {jobBatches.length > 0 && (
            <div className="text-[10px] text-slate-500 mt-0.5">
              {isAr ? 'دفعات أمر الشغل' : 'Job batches'}: {jobBatches.map((b) => String(b.batchNumber ?? b.id)).join('، ')}
            </div>
          )}
        </div>
        <div>
          <span className="text-slate-500 font-bold block mb-1">{isAr ? 'العملية' : 'Operation'}</span>
          <span className="font-bold text-slate-900">{raw.operationId ? label(operations, String(raw.operationId)) : '-'}</span>
          {raw.hierarchyNodeId && <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{isAr ? 'مركز التكلفة' : 'Cost centre'}: {String(raw.hierarchyNodeId)}</div>}
        </div>
        <div>
          <span className="text-slate-500 font-bold block mb-1">{isAr ? 'كمية الإنتاج' : 'Production quantity'}</span>
          <span className="font-bold text-slate-900">{measure.quantity ?? '-'} {unit(measure.unit)}</span>
          {measure.field && <div className="text-[10px] text-slate-400 font-mono mt-0.5">{measure.field}</div>}
        </div>
      </div>

      {usedEquipment.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
          {usedEquipment.map((e) => (
            <span key={e.field}>
              {isAr ? e.labelAr : e.labelEn}: <span className="font-bold">{label(equipment[e.field] ?? [], String(raw[e.field]))}</span>
            </span>
          ))}
        </div>
      )}

      <div>
        <p className="font-bold text-slate-700 mb-1">{isAr ? `المستهلك (${materials.length})` : `Consumed (${materials.length})`}</p>
        {materials.length === 0 ? (
          <p className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-slate-500">{isAr ? 'لا توجد سطور استهلاك على هذا السجل.' : 'This record has no consumption lines.'}</p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table id="traceability-consumption" className="w-full text-xs">
              <thead className={head}>
                <tr>
                  <th className={cell}>{isAr ? 'النوع' : 'Type'}</th>
                  <th className={cell}>{isAr ? 'الصنف' : 'Item'}</th>
                  <th className={cell}>{isAr ? 'الكمية' : 'Quantity'}</th>
                  <th className={cell}>{isAr ? 'دفعة المدخل' : 'Input batch'}</th>
                </tr>
              </thead>
              <tbody>
                {materials.map((m, i) => (
                  <tr key={String(m.lineId ?? i)} className="border-t border-slate-100">
                    <td className={cell}>{componentTypeOf(m) === 'ADDITIVE' ? (isAr ? '+ إضافة' : '+ Additive') : (isAr ? 'أساسي' : 'Base')}</td>
                    <td className={cell}>{[m.materialCode, m.materialName].filter(Boolean).join(' - ') || String(m.materialId ?? '-')}</td>
                    <td className={cell}>{String(m.quantity ?? '-')} {unit(m.unit)}</td>
                    <td className={cell}>{m.batchId ? label(batches, String(m.batchId), 'batchNumber') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="font-bold text-slate-700 mb-1">{isAr ? `المنتج (${outputs.length})` : `Produced (${outputs.length})`}</p>
        {outputs.length === 0 ? (
          <p className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-slate-500">{isAr ? 'لا توجد مخرجات مسجلة على هذا السجل.' : 'This record has no recorded outputs.'}</p>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table id="traceability-outputs" className="w-full text-xs">
              <thead className={head}>
                <tr>
                  <th className={cell}>{isAr ? 'النوع' : 'Type'}</th>
                  <th className={cell}>{isAr ? 'الصنف' : 'Item'}</th>
                  <th className={cell}>{isAr ? 'الكمية' : 'Quantity'}</th>
                  <th className={cell}>{isAr ? 'دفعة المخرج' : 'Output batch'}</th>
                </tr>
              </thead>
              <tbody>
                {outputs.map((o, i) => (
                  <tr key={String(o.lineId ?? i)} className="border-t border-slate-100">
                    <td className={cell}>{String(o.outputType ?? '-')}</td>
                    <td className={cell}>{[o.itemCode, o.itemName].filter(Boolean).join(' - ') || String(o.itemId ?? '-')}</td>
                    <td className={cell}>{String(o.quantity ?? '-')} {unit(o.unit)}</td>
                    <td className={cell}>{o.batchId ? label(batches, String(o.batchId), 'batchNumber') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(inputBatchIds.length > 0 || outputBatchIds.length > 0) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-600">
          <span>{isAr ? 'دفعات المدخلات' : 'Input batches'}: <span className="font-bold">{inputBatchIds.map((id) => label(batches, id, 'batchNumber')).join('، ') || '-'}</span></span>
          <span>{isAr ? 'دفعات المخرجات' : 'Output batches'}: <span className="font-bold">{outputBatchIds.map((id) => label(batches, id, 'batchNumber')).join('، ') || '-'}</span></span>
        </div>
      )}
    </div>
  );
};

/**
 * Job / batch traceability for new production entries - Phase 1 Step 5A.
 *
 * Shown once above the existing stage forms in StageProductionEntryView - not a
 * production screen of its own. The user may pick an ACTIVE job and a batch; the
 * panel then shows what the job resolves to (customer, logical item, configured
 * BOM and routing versions, configured batch) and the operation the current
 * stage resolves to in the Operation Master. The selection is handed to the
 * active form, whose save validates it (productionReferenceService) before its
 * existing write. Nothing here writes, and nothing is required: with no job and
 * no batch the forms save exactly as before.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link2, X } from 'lucide-react';
import type { ProductionStageType } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from '../../services/masterDataService';
import { readOperation } from '../../services/operationMasterPure';
import { loadLogicalItemState } from '../../services/logicalItemService';
import type { LogicalItemRecord } from '../../services/logicalItemPure';
import { compatibleBatches } from '../../services/jobConfigurationPure';
import { BOM_VERSION_COLLECTION } from '../../services/bomPure';
import { ROUTING_VERSION_COLLECTION } from '../../services/routingPure';
import { ProductionReferenceSelection, isTracedSelection, resolveOperationForStage } from '../../services/productionReferencePure';

interface ProductionReferencePanelProps {
  stageType: ProductionStageType;
  value: ProductionReferenceSelection;
  onChange: (next: ProductionReferenceSelection) => void;
}

type Lists = {
  jobs: any[]; batches: any[]; logicalItems: LogicalItemRecord[]; products: any[]; materials: any[]; customers: any[];
  boms: any[]; bomVersions: any[]; routings: any[]; routingVersions: any[]; operations: any[];
};

const EMPTY: Lists = { jobs: [], batches: [], logicalItems: [], products: [], materials: [], customers: [], boms: [], bomVersions: [], routings: [], routingVersions: [], operations: [] };

export const ProductionReferencePanel: React.FC<ProductionReferencePanelProps> = ({ stageType, value, onChange }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [lists, setLists] = useState<Lists>(EMPTY);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const read = (collection: string) => fetchMasterData<any>(collection).catch(() => null);
    Promise.all([
      read(MASTER_DATA_COLLECTIONS.jobReferences),
      read(MASTER_DATA_COLLECTIONS.batches),
      loadLogicalItemState().then((s) => s.items).catch(() => null),
      read(MASTER_DATA_COLLECTIONS.products),
      read(MASTER_DATA_COLLECTIONS.materials),
      read(MASTER_DATA_COLLECTIONS.customers),
      read(MASTER_DATA_COLLECTIONS.boms),
      read(BOM_VERSION_COLLECTION),
      read(MASTER_DATA_COLLECTIONS.routings),
      read(ROUTING_VERSION_COLLECTION),
      read(MASTER_DATA_COLLECTIONS.stages),
    ]).then(([jobs, batches, logicalItems, products, materials, customers, boms, bomVersions, routings, routingVersions, operations]) => {
      if (cancelled) return;
      setUnavailable(jobs === null);
      setLists({
        jobs: jobs ?? [], batches: batches ?? [], logicalItems: logicalItems ?? [], products: products ?? [], materials: materials ?? [],
        customers: customers ?? [], boms: boms ?? [], bomVersions: bomVersions ?? [], routings: routings ?? [], routingVersions: routingVersions ?? [],
        operations: (operations ?? []).map(readOperation),
      });
    });
    return () => { cancelled = true; };
  }, []);

  const activeJobs = useMemo(() => lists.jobs.filter((j) => j.active !== false && String(j.status ?? '').toUpperCase() === 'ACTIVE'), [lists.jobs]);
  const job = lists.jobs.find((j) => j.id === value.jobReferenceId) ?? null;
  const operation = resolveOperationForStage(lists.operations, stageType);

  const find = (list: any[], id: unknown) => list.find((x) => x.id === String(id ?? ''));
  const logicalItemLabel = (id: unknown) => {
    const item = lists.logicalItems.find((i) => i.id === String(id ?? ''));
    if (!item) return id ? String(id) : '-';
    const product = item.productId ? find(lists.products, item.productId) : null;
    const material = item.materialId ? find(lists.materials, item.materialId) : null;
    return [product && `${product.code || product.productCode || ''} ${product.name || ''}`.trim(), material && `${material.code || ''} ${material.name || ''}`.trim()].filter(Boolean).join(' | ') || item.id;
  };
  const versionLabel = (versions: any[], headers: any[], headerKey: string, id: unknown) => {
    const version = find(versions, id);
    if (!version) return id ? String(id) : '-';
    const header = find(headers, version[headerKey]);
    return [header ? `${header.code} - ${header.name}` : version[headerKey], version.versionCode, version.status].filter(Boolean).join(' / ');
  };
  const batchLabel = (id: unknown) => {
    const batch = find(lists.batches, id);
    if (!batch) return id ? String(id) : '-';
    const product = batch.productId ? find(lists.products, batch.productId) : null;
    return [batch.batchNumber, product ? product.name || product.code : '', batch.active === false ? 'INACTIVE' : 'ACTIVE'].filter(Boolean).join(' / ');
  };

  /** With a job: the Step 4 compatibility rule. Without: only batches bound to no job and no product. */
  const batchChoices = useMemo(() => {
    if (job) return compatibleBatches({ logicalItemId: job.logicalItemId }, lists.batches, lists.logicalItems, String(job.id));
    return lists.batches.filter((b) => b.active !== false && !b.productId && !b.jobReferenceId);
  }, [job, lists.batches, lists.logicalItems]);

  const selectJob = (jobId: string) => {
    const next = lists.jobs.find((j) => j.id === jobId);
    // The job's configured batch is offered as the starting choice - visible, and changeable.
    onChange({ jobReferenceId: jobId || null, batchId: next?.batchId || null });
  };

  const traced = isTracedSelection(value);
  const selectClass = 'w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs';

  return (
    <div id="production-reference-panel" className="bg-white rounded-2xl border border-indigo-200 shadow-xs p-4 space-y-3" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-black text-indigo-900">
          <Link2 className="w-4 h-4" />
          {isAr ? 'الربط بأمر الشغل والدفعة (اختياري)' : 'Job & batch traceability (optional)'}
        </p>
        {traced && (
          <button type="button" onClick={() => onChange({})} className="flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
            <X className="w-3 h-3" />{isAr ? 'إلغاء الربط' : 'Clear'}
          </button>
        )}
      </div>

      {unavailable && (
        <p className="text-[11px] font-bold text-slate-500">
          {isAr ? 'أوامر الشغل غير متاحة حاليًا - يُحفظ الإدخال بدون ربط كما كان.' : 'Job references are not available right now - entries save untraced, as before.'}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">{isAr ? 'أمر الشغل (النشط)' : 'Job reference (active)'}</label>
          <select id="production-job-reference" value={value.jobReferenceId || ''} onChange={(e) => selectJob(e.target.value)} className={selectClass} disabled={unavailable}>
            <option value="">{isAr ? 'بدون' : 'None'}</option>
            {activeJobs.map((j) => (
              <option key={j.id} value={j.id}>{j.code}{j.customerId ? ` - ${find(lists.customers, j.customerId)?.name ?? ''}` : ''}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1">{isAr ? 'الدفعة' : 'Batch'}</label>
          <select id="production-batch" value={value.batchId || ''} onChange={(e) => onChange({ ...value, batchId: e.target.value || null })} className={selectClass} disabled={unavailable}>
            <option value="">{isAr ? 'بدون' : 'None'}</option>
            {batchChoices.map((b) => <option key={b.id} value={b.id}>{batchLabel(b.id)}</option>)}
            {value.batchId && !batchChoices.some((b) => b.id === value.batchId) && (
              <option value={value.batchId}>{batchLabel(value.batchId)} {isAr ? '(غير متوافقة)' : '(not compatible)'}</option>
            )}
          </select>
        </div>
      </div>

      {job && (
        <div id="production-job-summary" className="bg-indigo-50/60 border border-indigo-100 rounded-xl px-3 py-2 text-[11px] text-slate-700 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-0.5">
          <div><span className="font-bold">{isAr ? 'أمر الشغل' : 'Job'}:</span> {job.code} ({job.status})</div>
          <div><span className="font-bold">{isAr ? 'العميل' : 'Customer'}:</span> {job.customerId ? find(lists.customers, job.customerId)?.name ?? job.customerId : (isAr ? 'بدون' : 'None')}</div>
          <div><span className="font-bold">{isAr ? 'الصنف المنطقي' : 'Logical item'}:</span> {job.logicalItemId ? logicalItemLabel(job.logicalItemId) : (isAr ? 'غير مُعد' : 'Not configured')}</div>
          <div><span className="font-bold">BOM:</span> {job.bomVersionId ? versionLabel(lists.bomVersions, lists.boms, 'bomId', job.bomVersionId) : '-'}</div>
          <div><span className="font-bold">{isAr ? 'المسار' : 'Routing'}:</span> {job.routingVersionId ? versionLabel(lists.routingVersions, lists.routings, 'routingId', job.routingVersionId) : '-'}</div>
          <div><span className="font-bold">{isAr ? 'دفعة أمر الشغل' : 'Job batch'}:</span> {job.batchId ? batchLabel(job.batchId) : '-'}</div>
        </div>
      )}

      <div className="text-[11px] text-slate-600">
        <span className="font-bold">{isAr ? 'العملية' : 'Operation'}:</span>{' '}
        {operation.operation
          ? `${operation.operation.code} - ${isAr ? operation.operation.nameAr : operation.operation.nameEn || operation.operation.nameAr}`
          : <span className={traced ? 'font-bold text-rose-700' : 'text-slate-400'}>{isAr ? operation.reasonAr : operation.reasonEn}</span>}
      </div>

      {traced && (
        <p className="text-[11px] font-bold text-indigo-800">
          {isAr
            ? 'إدخال مرتبط: يتم التحقق من أمر الشغل والصنف المنطقي والدفعة والعملية والمعدات والمنتج قبل الحفظ - ولا يُحفظ شيء إذا كان أي منها غير صالح. لا يتم تنفيذ المسار أو استهلاك قائمة المواد.'
            : 'Traced entry: the job, logical item, batch, operation, equipment and product are checked before saving - nothing is saved if any is invalid. No routing is executed and no BOM is consumed.'}
        </p>
      )}
    </div>
  );
};

/**
 * Actual Material Consumption - Phase 1 Step 5B.
 *
 * One reusable panel inside the existing stage entry forms that already record
 * consumption (Rotary Furnace, Mortar / Concrete, Mixing, Foam), replacing their
 * four copied inline editors. It edits the form's own `materials` lines - the
 * existing MaterialConsumptionItem array written in the record's single save.
 *
 * Any product or material can be consumed (e.g. a calcined intermediate kept as a
 * product). Quantity and unit are explicit; nothing is converted. When the entry
 * is linked to a job with a BOM version, each line shows whether its item is in
 * that BOM - information only: off-BOM items are allowed and the BOM is never
 * changed. Items without a logical identity are allowed and marked unmapped.
 * Nothing here writes; the form's save validates and normalises the lines.
 *
 * Phase 1 Step 6: each line may name the input batch it was drawn from - the
 * genealogy input link. Only active batches that can hold the line's item are
 * offered; no batch is created here.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Package, Plus, Trash2 } from 'lucide-react';
import type { MaterialConsumptionItem } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { SmartEntitySelect, SmartOption } from '../common/SmartEntitySelect';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from '../../services/masterDataService';
import { loadLogicalItemState } from '../../services/logicalItemService';
import type { LogicalItemRecord } from '../../services/logicalItemPure';
import { BOM_UNITS, BOM_UNIT_LABELS, BOM_VERSION_COLLECTION, componentTypeOf } from '../../services/bomPure';
import { moveLine, nextLineId, normaliseSequences } from '../../services/versionedSetupPure';
import { bomMembership, lineLogicalItemKey, lineSource } from '../../services/actualConsumptionPure';
import { resolveLogicalItemId } from '../../services/logicalItemPure';

interface ActualConsumptionPanelProps {
  lines: MaterialConsumptionItem[];
  onChange: (lines: MaterialConsumptionItem[]) => void;
  /** The entry's selected job (Step 5A), used only to show BOM membership. */
  jobReferenceId?: string | null;
}

const toOptions = (list: any[]): SmartOption[] => list.map((x) => ({ id: x.id || '', code: x.code || x.productCode || '', name: x.name || x.productName || '', subtitle: x.unit || '' }));

export const ActualConsumptionPanel: React.FC<ActualConsumptionPanelProps> = ({ lines, onChange, jobReferenceId }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [products, setProducts] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [logicalItems, setLogicalItems] = useState<LogicalItemRecord[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [bomVersions, setBomVersions] = useState<any[]>([]);
  const [batches, setBatches] = useState<any[]>([]);

  useEffect(() => {
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.products).then(setProducts).catch(() => {});
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.materials).then(setMaterials).catch(() => {});
    loadLogicalItemState().then((s) => setLogicalItems(s.items)).catch(() => {});
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.jobReferences).then(setJobs).catch(() => {});
    fetchMasterData<any>(BOM_VERSION_COLLECTION).then(setBomVersions).catch(() => {});
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.batches).then(setBatches).catch(() => {});
  }, []);

  /** Active batches that can hold a line's item (unbound, or bound to the same logical item). */
  const inputBatchChoices = (line: MaterialConsumptionItem) => batches.filter((b) => b.active !== false && (!b.productId
    || resolveLogicalItemId(logicalItems, 'products', b.productId) === resolveLogicalItemId(logicalItems, lineSource(line as any), line.materialId)));

  const productOptions = useMemo(() => toOptions(products), [products]);
  const materialOptions = useMemo(() => toOptions(materials), [materials]);
  const job = jobs.find((j) => j.id === jobReferenceId);
  const bomVersion = job?.bomVersionId ? bomVersions.find((v) => v.id === job.bomVersionId) ?? null : null;

  const ordered = normaliseSequences(lines.map((l, i) => ({ ...l, sequence: typeof l.sequence === 'number' ? l.sequence : i + 1 })));
  const update = (lineId: string, patch: Partial<MaterialConsumptionItem>) =>
    onChange(ordered.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));

  const addLine = () => onChange([
    ...ordered,
    { lineId: nextLineId(ordered), sequence: ordered.length + 1, itemSource: 'materials', materialId: '', materialCode: '', materialName: '', quantity: 0, unit: '', notes: '', componentType: 'BASE' },
  ]);

  const pickItem = (line: MaterialConsumptionItem, id: string | null) => {
    const list = lineSource(line as any) === 'products' ? products : materials;
    const record = list.find((r) => r.id === id);
    // The item's own unit is offered only when it is a known unit; otherwise the user chooses - never assumed.
    const unit = record && (BOM_UNITS as readonly string[]).includes(String(record.unit ?? '').trim()) ? String(record.unit).trim() : line.unit;
    update(line.lineId as string, {
      materialId: id ?? '',
      materialCode: record?.code || record?.productCode || '',
      materialName: record?.name || record?.productName || '',
      unit,
      logicalItemId: undefined,
    });
  };

  const inputClass = 'w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs';

  return (
    <div id="actual-consumption-panel" className="space-y-3" dir={isAr ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5 uppercase">
          <Package className="w-4 h-4 text-purple-600" />
          {isAr ? `الاستهلاك الفعلي للخامات (${ordered.length})` : `Actual Material Consumption (${ordered.length})`}
        </h3>
        <button id="actual-consumption-add" type="button" onClick={addLine} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-lg cursor-pointer">
          <Plus className="w-3.5 h-3.5" />{isAr ? 'إضافة صنف' : 'Add Item'}
        </button>
      </div>

      {ordered.length === 0 ? (
        <div className="p-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 text-xs text-slate-500">
          {isAr ? 'لا يوجد استهلاك مسجل. اضغط «إضافة صنف» لتسجيل ما تم استهلاكه فعليًا.' : 'No consumption recorded. Click "Add Item" to record what was actually consumed.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] min-w-[820px]">
            <thead className="text-slate-500">
              <tr>
                <th className="text-start px-1 py-1">#</th>
                <th className="text-start px-1 py-1">{isAr ? 'النوع' : 'Type'}</th>
                <th className="text-start px-1 py-1">{isAr ? 'المصدر' : 'Source'}</th>
                <th className="text-start px-1 py-1 w-64">{isAr ? 'الصنف' : 'Item'}</th>
                <th className="text-start px-1 py-1">{isAr ? 'الكمية' : 'Quantity'}</th>
                <th className="text-start px-1 py-1">{isAr ? 'الوحدة' : 'Unit'}</th>
                <th className="text-start px-1 py-1">{isAr ? 'دفعة المدخل' : 'Input batch'}</th>
                <th className="text-start px-1 py-1">{isAr ? 'ملاحظات' : 'Notes'}</th>
                <th className="px-1 py-1" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ordered.map((line) => {
                const membership = line.materialId ? bomMembership(line as any, bomVersion, logicalItems) : null;
                const unmapped = line.materialId && lineLogicalItemKey(line as any, logicalItems).startsWith('record:');
                return (
                  <tr key={line.lineId}>
                    <td className="px-1 py-1 font-mono">{line.sequence}</td>
                    {/* Phase 1 Step 7A: base formula or additive consumption - chosen here, never inferred from the BOM */}
                    <td className="px-1 py-1 w-28">
                      <select value={componentTypeOf(line as any)} onChange={(e) => update(line.lineId as string, { componentType: e.target.value as 'BASE' | 'ADDITIVE' })} className={inputClass}>
                        <option value="BASE">{isAr ? 'أساسي' : 'Base'}</option>
                        <option value="ADDITIVE">{isAr ? '+ إضافة' : '+ Additive'}</option>
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <select value={lineSource(line as any)} onChange={(e) => update(line.lineId as string, { itemSource: e.target.value as 'products' | 'materials', materialId: '', materialCode: '', materialName: '' })} className={inputClass}>
                        <option value="materials">{isAr ? 'خامة' : 'Material'}</option>
                        <option value="products">{isAr ? 'منتج / وسيط' : 'Product / intermediate'}</option>
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <SmartEntitySelect
                        entityType={lineSource(line as any) === 'products' ? 'product' : 'material'}
                        allowAddNew={false}
                        options={lineSource(line as any) === 'products' ? productOptions : materialOptions}
                        value={line.materialId || null}
                        onChange={(id) => pickItem(line, id)}
                      />
                      <div className="flex items-center gap-1 flex-wrap mt-0.5">
                        {membership === 'IN_BOM' && <span className="text-[9px] font-bold px-1 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">{isAr ? 'ضمن قائمة المواد' : 'In BOM'}</span>}
                        {membership === 'OFF_BOM' && <span className="text-[9px] font-bold px-1 rounded bg-amber-50 text-amber-800 border border-amber-200">{isAr ? 'خارج قائمة المواد (مسموح)' : 'Not in BOM (allowed)'}</span>}
                        {unmapped && <span className="text-[9px] font-bold px-1 rounded bg-slate-100 text-slate-600 border border-slate-200">{isAr ? 'بدون صنف منطقي بعد' : 'No logical item yet'}</span>}
                      </div>
                    </td>
                    <td className="px-1 py-1 w-28">
                      <input type="number" step="any" min="0" value={line.quantity || ''} onChange={(e) => update(line.lineId as string, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })} className={`${inputClass} text-center font-bold`} />
                    </td>
                    <td className="px-1 py-1 w-28">
                      <select value={line.unit || ''} onChange={(e) => update(line.lineId as string, { unit: e.target.value })} className={inputClass}>
                        <option value="">-</option>
                        {BOM_UNITS.map((u) => <option key={u} value={u}>{isAr ? BOM_UNIT_LABELS[u].ar : BOM_UNIT_LABELS[u].en}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1 w-40">
                      <select value={line.batchId ?? ''} disabled={!line.materialId} onChange={(e) => update(line.lineId as string, { batchId: e.target.value || null })} className={inputClass}>
                        <option value="">{isAr ? 'بدون' : 'None'}</option>
                        {inputBatchChoices(line).map((b) => <option key={b.id} value={b.id}>{b.batchNumber}</option>)}
                        {line.batchId && !inputBatchChoices(line).some((b) => b.id === line.batchId) && <option value={line.batchId}>{line.batchId} {isAr ? '(غير متوافقة)' : '(not compatible)'}</option>}
                      </select>
                    </td>
                    <td className="px-1 py-1"><input value={line.notes ?? ''} onChange={(e) => update(line.lineId as string, { notes: e.target.value })} className={inputClass} /></td>
                    <td className="px-1 py-1">
                      <div className="flex items-center gap-0.5">
                        <button type="button" onClick={() => onChange(moveLine(ordered as any, line.lineId as string, 'up') as any)} className="p-1 rounded hover:bg-slate-100 cursor-pointer" title={isAr ? 'أعلى' : 'Up'}><ArrowUp className="w-3 h-3" /></button>
                        <button type="button" onClick={() => onChange(moveLine(ordered as any, line.lineId as string, 'down') as any)} className="p-1 rounded hover:bg-slate-100 cursor-pointer" title={isAr ? 'أسفل' : 'Down'}><ArrowDown className="w-3 h-3" /></button>
                        <button type="button" onClick={() => onChange(normaliseSequences(ordered.filter((l) => l.lineId !== line.lineId)))} className="p-1 rounded hover:bg-rose-50 text-rose-600 cursor-pointer" title={isAr ? 'إزالة' : 'Remove'}><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-500">
        {isAr
          ? 'يُسجَّل الاستهلاك الفعلي مع سجل الإنتاج في نفس الحفظ. لا يغيّر قائمة المواد أو المخزون، ولا تُحسب تكلفة.'
          : 'Actual consumption is saved with the production record in the same save. It changes no BOM or stock, and no cost is calculated.'}
      </p>
    </div>
  );
};

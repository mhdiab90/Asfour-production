/**
 * Production Output & Genealogy - Phase 1 Step 6.
 *
 * One panel in the existing StageProductionEntryView (not a genealogy page). It
 * edits the entry's OUTPUT lines - item (product or material), output batch,
 * quantity, unit, PRIMARY / BYPRODUCT / SCRAP, notes - and, for the stages whose
 * form has no consumption editor of its own (Pressing, Chinese Mills, Tube/Ball
 * Mills, Sorting), hosts the shared Actual Consumption panel so every stage can
 * name its inputs and their batches. Inputs are always consumption lines - there
 * is no second input list.
 *
 * Batches are only SELECTED: new batches are created through the existing
 * workflow (Master Data -> Jobs & Batches -> Batches). Nothing here writes; the
 * active form's save validates the genealogy and writes it in the record's own
 * single write. Outputs are optional; once any is entered, one must be PRIMARY.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GitBranch, Plus, Trash2 } from 'lucide-react';
import type { MaterialConsumptionItem, ProductionOutputLine } from '../../types';
import { useLanguage } from '../../i18n/LanguageContext';
import { SmartEntitySelect, SmartOption } from '../common/SmartEntitySelect';
import { MASTER_DATA_COLLECTIONS, fetchMasterData } from '../../services/masterDataService';
import { loadLogicalItemState } from '../../services/logicalItemService';
import { resolveLogicalItemId } from '../../services/logicalItemPure';
import type { LogicalItemRecord } from '../../services/logicalItemPure';
import { BOM_UNITS, BOM_UNIT_LABELS } from '../../services/bomPure';
import { moveLine, nextLineId, normaliseSequences } from '../../services/versionedSetupPure';
import { OUTPUT_TYPES } from '../../services/productionGenealogyPure';
import { ActualConsumptionPanel } from './ActualConsumptionPanel';

interface ProductionGenealogyPanelProps {
  /** Show the shared consumption panel here (stages whose form has none). */
  showInputs: boolean;
  inputs: MaterialConsumptionItem[];
  onInputsChange: (lines: MaterialConsumptionItem[]) => void;
  outputs: ProductionOutputLine[];
  onOutputsChange: (lines: ProductionOutputLine[]) => void;
  jobReferenceId?: string | null;
}

const toOptions = (list: any[]): SmartOption[] => list.map((x) => ({ id: x.id || '', code: x.code || x.productCode || '', name: x.name || x.productName || '', subtitle: x.unit || '' }));

const TYPE_LABELS: Record<string, { ar: string; en: string }> = {
  PRIMARY: { ar: 'رئيسي', en: 'Primary' },
  BYPRODUCT: { ar: 'منتج ثانوي', en: 'By-product' },
  SCRAP: { ar: 'هالك / فاقد', en: 'Scrap' },
};

export const ProductionGenealogyPanel: React.FC<ProductionGenealogyPanelProps> = ({ showInputs, inputs, onInputsChange, outputs, onOutputsChange, jobReferenceId }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [products, setProducts] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [logicalItems, setLogicalItems] = useState<LogicalItemRecord[]>([]);
  const [batches, setBatches] = useState<any[]>([]);

  useEffect(() => {
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.products).then(setProducts).catch(() => {});
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.materials).then(setMaterials).catch(() => {});
    loadLogicalItemState().then((s) => setLogicalItems(s.items)).catch(() => {});
    fetchMasterData<any>(MASTER_DATA_COLLECTIONS.batches).then(setBatches).catch(() => {});
  }, []);

  const productOptions = useMemo(() => toOptions(products), [products]);
  const materialOptions = useMemo(() => toOptions(materials), [materials]);
  const ordered = normaliseSequences(outputs.map((l, i) => ({ ...l, sequence: typeof l.sequence === 'number' ? l.sequence : i + 1 })));
  const update = (lineId: string, patch: Partial<ProductionOutputLine>) => onOutputsChange(ordered.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)));

  /** Active batches that can hold the output item and are not bound to another job. */
  const batchChoices = (line: ProductionOutputLine) => batches.filter((b) => b.active !== false
    && (!b.productId || resolveLogicalItemId(logicalItems, 'products', b.productId) === resolveLogicalItemId(logicalItems, line.itemSource, line.itemId))
    && (!b.jobReferenceId || b.jobReferenceId === jobReferenceId));

  const addOutput = () => onOutputsChange([
    ...ordered,
    {
      lineId: nextLineId(ordered), sequence: ordered.length + 1, itemSource: 'products', itemId: '', itemCode: '', itemName: '',
      batchId: null, quantity: 0, unit: '', outputType: ordered.some((l) => l.outputType === 'PRIMARY') ? 'BYPRODUCT' : 'PRIMARY', notes: '',
    },
  ]);

  const pickItem = (line: ProductionOutputLine, id: string | null) => {
    const record = (line.itemSource === 'products' ? products : materials).find((r) => r.id === id);
    const unit = record && (BOM_UNITS as readonly string[]).includes(String(record.unit ?? '').trim()) ? String(record.unit).trim() : line.unit;
    update(line.lineId, { itemId: id ?? '', itemCode: record?.code || record?.productCode || '', itemName: record?.name || record?.productName || '', unit, logicalItemId: undefined });
  };

  const inputClass = 'w-full bg-white border border-slate-300 rounded-lg px-2 py-1.5 text-xs';

  return (
    <div id="production-genealogy-panel" className="bg-white rounded-2xl border border-teal-200 shadow-xs p-4 space-y-4" dir={isAr ? 'rtl' : 'ltr'}>
      <div>
        <p className="flex items-center gap-1.5 text-sm font-black text-teal-900">
          <GitBranch className="w-4 h-4" />
          {isAr ? 'المخرجات وتتبع الدفعات (اختياري)' : 'Production Output & Genealogy (optional)'}
        </p>
        <p className="text-[10px] text-slate-500 mt-0.5">
          {isAr
            ? 'تُحفظ مع سجل الإنتاج في نفس الحفظ. المدخلات هي سطور الاستهلاك الفعلي ودفعاتها. لا يتم تعديل المخزون أو قائمة المواد، ولا تُحسب تكلفة.'
            : 'Saved with the production record in the same save. Inputs are the actual consumption lines and their batches. No stock or BOM is changed and no cost is calculated.'}
        </p>
      </div>

      {showInputs ? (
        <div id="production-genealogy-inputs" className="border border-slate-200 rounded-xl p-3">
          <ActualConsumptionPanel lines={inputs} onChange={onInputsChange} jobReferenceId={jobReferenceId} />
        </div>
      ) : (
        <p className="text-[11px] text-slate-600">
          {isAr ? 'المدخلات: سطور «الاستهلاك الفعلي» في نموذج المرحلة أدناه، مع دفعة كل مدخل.' : 'Inputs: the "Actual Material Consumption" lines in the stage form below, each with its input batch.'}
        </p>
      )}

      <div id="production-genealogy-outputs" className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800 uppercase">{isAr ? `المخرجات (${ordered.length})` : `Outputs (${ordered.length})`}</h3>
          <button id="production-output-add" type="button" onClick={addOutput} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-teal-50 text-teal-800 hover:bg-teal-100 rounded-lg cursor-pointer">
            <Plus className="w-3.5 h-3.5" />{isAr ? 'إضافة مخرج' : 'Add Output'}
          </button>
        </div>
        {ordered.length === 0 ? (
          <p className="text-[11px] text-slate-400">{isAr ? 'لا توجد مخرجات مسجلة - الإدخال يُحفظ كما كان.' : 'No outputs recorded - the entry saves as before.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[980px]">
              <thead className="text-slate-500">
                <tr>
                  <th className="text-start px-1 py-1">#</th>
                  <th className="text-start px-1 py-1">{isAr ? 'النوع' : 'Type'}</th>
                  <th className="text-start px-1 py-1">{isAr ? 'المصدر' : 'Source'}</th>
                  <th className="text-start px-1 py-1 w-60">{isAr ? 'الصنف المنتج' : 'Produced item'}</th>
                  <th className="text-start px-1 py-1">{isAr ? 'دفعة المخرج' : 'Output batch'}</th>
                  <th className="text-start px-1 py-1">{isAr ? 'الكمية' : 'Quantity'}</th>
                  <th className="text-start px-1 py-1">{isAr ? 'الوحدة' : 'Unit'}</th>
                  <th className="text-start px-1 py-1">{isAr ? 'ملاحظات' : 'Notes'}</th>
                  <th className="px-1 py-1" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ordered.map((line) => {
                  const choices = batchChoices(line);
                  const unmapped = line.itemId && resolveLogicalItemId(logicalItems, line.itemSource, line.itemId).startsWith('record:');
                  return (
                    <tr key={line.lineId}>
                      <td className="px-1 py-1 font-mono">{line.sequence}</td>
                      <td className="px-1 py-1 w-32">
                        <select value={line.outputType} onChange={(e) => update(line.lineId, { outputType: e.target.value as ProductionOutputLine['outputType'] })} className={inputClass}>
                          {OUTPUT_TYPES.map((t) => <option key={t} value={t}>{isAr ? TYPE_LABELS[t].ar : TYPE_LABELS[t].en}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1 w-32">
                        <select value={line.itemSource} onChange={(e) => update(line.lineId, { itemSource: e.target.value as 'products' | 'materials', itemId: '', itemCode: '', itemName: '' })} className={inputClass}>
                          <option value="products">{isAr ? 'منتج / وسيط' : 'Product / intermediate'}</option>
                          <option value="materials">{isAr ? 'خامة' : 'Material'}</option>
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <SmartEntitySelect
                          entityType={line.itemSource === 'products' ? 'product' : 'material'}
                          allowAddNew={false}
                          options={line.itemSource === 'products' ? productOptions : materialOptions}
                          value={line.itemId || null}
                          onChange={(id) => pickItem(line, id)}
                        />
                        {unmapped && <span className="text-[9px] font-bold px-1 rounded bg-slate-100 text-slate-600 border border-slate-200">{isAr ? 'بدون صنف منطقي بعد' : 'No logical item yet'}</span>}
                      </td>
                      <td className="px-1 py-1 w-40">
                        <select value={line.batchId ?? ''} disabled={!line.itemId} onChange={(e) => update(line.lineId, { batchId: e.target.value || null })} className={inputClass}>
                          <option value="">{line.outputType === 'SCRAP' ? (isAr ? 'بدون (اختياري للهالك)' : 'None (optional for scrap)') : (isAr ? 'اختر دفعة' : 'Select batch')}</option>
                          {choices.map((b) => <option key={b.id} value={b.id}>{b.batchNumber}</option>)}
                          {line.batchId && !choices.some((b) => b.id === line.batchId) && <option value={line.batchId}>{line.batchId} {isAr ? '(غير متوافقة)' : '(not compatible)'}</option>}
                        </select>
                      </td>
                      <td className="px-1 py-1 w-28">
                        <input type="number" step="any" min="0" value={line.quantity || ''} onChange={(e) => update(line.lineId, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })} className={`${inputClass} text-center font-bold`} />
                      </td>
                      <td className="px-1 py-1 w-28">
                        <select value={line.unit || ''} onChange={(e) => update(line.lineId, { unit: e.target.value })} className={inputClass}>
                          <option value="">-</option>
                          {BOM_UNITS.map((u) => <option key={u} value={u}>{isAr ? BOM_UNIT_LABELS[u].ar : BOM_UNIT_LABELS[u].en}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1"><input value={line.notes ?? ''} onChange={(e) => update(line.lineId, { notes: e.target.value })} className={inputClass} /></td>
                      <td className="px-1 py-1">
                        <div className="flex items-center gap-0.5">
                          <button type="button" onClick={() => onOutputsChange(moveLine(ordered, line.lineId, 'up'))} className="p-1 rounded hover:bg-slate-100 cursor-pointer" title={isAr ? 'أعلى' : 'Up'}><ArrowUp className="w-3 h-3" /></button>
                          <button type="button" onClick={() => onOutputsChange(moveLine(ordered, line.lineId, 'down'))} className="p-1 rounded hover:bg-slate-100 cursor-pointer" title={isAr ? 'أسفل' : 'Down'}><ArrowDown className="w-3 h-3" /></button>
                          <button type="button" onClick={() => onOutputsChange(normaliseSequences(ordered.filter((l) => l.lineId !== line.lineId)))} className="p-1 rounded hover:bg-rose-50 text-rose-600 cursor-pointer" title={isAr ? 'إزالة' : 'Remove'}><Trash2 className="w-3 h-3" /></button>
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
            ? 'الدفعات تُختار فقط - لإنشاء دفعة جديدة استخدم: البيانات الأساسية ← أوامر الشغل والدفعات ← الدفعات.'
            : 'Batches are only selected here - create a new batch in Master Data → Jobs & Batches → Batches.'}
        </p>
      </div>
    </div>
  );
};

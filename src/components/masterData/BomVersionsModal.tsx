/**
 * BOM versions and components - opened from a row of Master Data -> Products ->
 * Bills of Materials. Phase 1 Step 2.
 *
 * A window on ONE BOM, not a second BOM manager: the BOM itself is created and
 * edited in the shared Master Data table. Here the user lists the versions
 * (the history), starts a draft (empty or copied from another version), edits
 * a draft's basis, yield and component lines, and activates or retires a version.
 * Nothing is deleted. Active and retired versions are shown read-only.
 *
 * Writes go through bomService (validation + the shared audited Master Data
 * services). The product's historical mixture, if any, is shown read-only and
 * is never converted.
 *
 * Phase 1 Step 7A: each component is Base Formula or Additive. The summary shows
 * Base Formula % / Additives +% / Total Applied, the formula rules activation
 * will enforce, and a read-only preview of the quantities for a production
 * quantity. Derived quantities / percentages are shown, never written into the line.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, History, Plus, RefreshCw, Trash2, Info } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import { SmartEntitySelect, SmartOption } from '../common/SmartEntitySelect';
import { useLanguage } from '../../i18n/LanguageContext';
import {
  BOM_ITEM_SOURCES,
  BOM_UNITS,
  BOM_UNIT_LABELS,
  bomFormula,
  bomFormulaIssues,
  bomVersionPayloadForSave,
  formatFormulaPercentage,
  draftFromVersion,
  isVersionEditable,
  moveComponent,
  nextLineId,
  normaliseSequences,
  readLegacyMixture,
} from '../../services/bomPure';
import { createBomVersion, listBomVersions, saveBomVersionDraft, transitionBomVersion } from '../../services/bomService';
import { loadLogicalItemState } from '../../services/logicalItemService';
import type { LogicalItemRecord } from '../../services/logicalItemPure';

interface BomVersionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  bom: Record<string, any> | null;
  /** The existing Master Data edit gate, decided by the caller. */
  canEdit: boolean;
  products: any[];
  materials: any[];
}

const toOptions = (list: any[]): SmartOption[] =>
  list.map((x) => ({ id: x.id || '', code: x.code || x.productCode || '', name: x.name || '' }));

export const BomVersionsModal: React.FC<BomVersionsModalProps> = ({ isOpen, onClose, bom, canEdit, products, materials }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [versions, setVersions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [newVersionCode, setNewVersionCode] = useState('');
  /** Read-only scaling preview: a production quantity in the basis unit. Never saved. */
  const [previewQuantity, setPreviewQuantity] = useState('');
  /** Logical items (Step 2A), so a mapped product and material are validated as one item. */
  const [logicalItems, setLogicalItems] = useState<LogicalItemRecord[]>([]);

  const productOptions = useMemo(() => toOptions(products), [products]);
  const materialOptions = useMemo(() => toOptions(materials), [materials]);
  const knownItems = useMemo(
    () => ({
      products: products.length ? new Set(products.map((p) => String(p.id))) : null,
      materials: materials.length ? new Set(materials.map((m) => String(m.id))) : null,
    }),
    [products, materials],
  );
  const context = useMemo(() => ({ knownItems, bom, logicalItems }), [knownItems, bom, logicalItems]);

  const itemLabel = (source: string, id: string): string => {
    const list = source === 'materials' ? materials : products;
    const found = list.find((x) => x.id === id);
    return found ? [found.code || found.productCode, found.name].filter(Boolean).join(' - ') : id || '-';
  };

  const load = useCallback(async (skipCache = false) => {
    if (!bom?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const list = await listBomVersions(String(bom.id), { skipCache });
      // Before a write the mapping state is re-read too, so the duplicate rule sees current mappings.
      setLogicalItems((await loadLogicalItemState({ skipCache }).catch(() => ({ items: [] as LogicalItemRecord[] }))).items);
      list.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
      setVersions(list);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsLoading(false);
    }
  }, [bom?.id]);

  useEffect(() => {
    if (isOpen) {
      setSelectedId(null);
      setDraft(null);
      setNewVersionCode('');
      void load();
    }
  }, [isOpen, load]);

  const selected = versions.find((v) => v.id === selectedId) ?? null;
  const editable = canEdit && isVersionEditable(selected);

  const openVersion = (v: any) => {
    setSelectedId(v.id);
    setDraft({ ...bomVersionPayloadForSave(v) });
    setError(null);
  };

  const run = async (action: () => Promise<void>) => {
    if (!canEdit) return;
    setIsBusy(true);
    setError(null);
    try {
      await action();
      await load(true);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreate = (source: any | null) =>
    run(async () => {
      const base = source
        ? draftFromVersion(source, newVersionCode)
        : { versionCode: newVersionCode, status: 'DRAFT', components: [] };
      await createBomVersion(versions, { ...base, bomId: bom?.id }, context, language);
      setNewVersionCode('');
    });

  const handleSaveDraft = () =>
    run(async () => {
      if (!selected || !draft) return;
      await saveBomVersionDraft(versions, selected, draft, context, language);
    });

  const handleTransition = (v: any, next: 'ACTIVE' | 'RETIRED') => {
    if (next === 'RETIRED' && !window.confirm(isAr ? `إيقاف الإصدار "${v.versionCode}"؟ يبقى محفوظًا للقراءة ولا يمكن إعادته.` : `Retire version "${v.versionCode}"? It stays readable and cannot be reactivated.`)) return;
    return run(async () => {
      await transitionBomVersion(versions, v, next, context, language);
      setSelectedId(null);
      setDraft(null);
    });
  };

  const updateLine = (lineId: string, patch: Record<string, any>) =>
    setDraft((d) => (d ? { ...d, components: d.components.map((c: any) => (c.lineId === lineId ? { ...c, ...patch } : c)) } : d));

  const addLine = () =>
    setDraft((d) => (d ? {
      ...d,
      components: [...d.components, { lineId: nextLineId(d.components), componentType: 'BASE', itemSource: 'materials', itemId: '', quantity: '', unit: '', sequence: d.components.length + 1, percentage: '', notes: '' }],
    } : d));

  // Step 7A: the formula view of what is on screen (form values normalised first; nothing written).
  const formulaInput = draft ? bomVersionPayloadForSave(draft) : null;
  const formula = formulaInput ? bomFormula(formulaInput) : null;
  const formulaIssues = formulaInput ? bomFormulaIssues(formulaInput) : [];
  const formulaLine = (lineId: string) => formula?.lines.find((l) => l.lineId === lineId) ?? null;
  const previewValue = Number(previewQuantity);
  const previewFactor = formula?.basisValid && previewQuantity.trim() !== '' && Number.isFinite(previewValue) && previewValue > 0 ? previewValue / (formula.basisQuantity as number) : null;
  const pct = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 4 });
  const qty = (n: number | null) => (n === null ? '-' : Number(n.toFixed(6)).toLocaleString('en-US', { maximumFractionDigits: 6 }));
  const unitLabel = (u: string | null | undefined) => (u && BOM_UNIT_LABELS[u] ? (isAr ? BOM_UNIT_LABELS[u].ar : BOM_UNIT_LABELS[u].en) : u || '');

  const legacy = bom?.itemSource === 'products' ? readLegacyMixture(products.find((p) => p.id === bom?.itemId)) : null;

  const statusBadge = (status: string) => (
    <Badge variant={status === 'ACTIVE' ? 'success' : status === 'RETIRED' ? 'neutral' : 'warning'}>{status}</Badge>
  );

  const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs disabled:opacity-70';

  return (
    <Modal
      id="bom-versions-modal"
      isOpen={isOpen}
      onClose={() => { if (!isBusy) onClose(); }}
      title={isAr ? `إصدارات قائمة المواد: ${bom?.code ?? ''}` : `BOM versions: ${bom?.code ?? ''}`}
      subtitle={bom ? `${bom.name ?? ''} · ${itemLabel(bom.itemSource, bom.itemId)}` : ''}
      maxWidth="4xl"
    >
      <div className="space-y-4 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 text-sky-900">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="font-semibold leading-relaxed">
            {isAr
              ? 'قائمة المواد تحدد المكونات والكميات فقط - لا عمليات ولا مراكز تكلفة ولا تكاليف. تُعدَّل المكونات في المسودة فقط؛ لتغيير إصدار نشط أنشئ إصدارًا جديدًا منه. لا يُحذف أي إصدار.'
              : 'A BOM defines components and quantities only - no operations, cost centres or costs. Components change only in a draft; to change an active version, start a new version from it. Versions are never deleted.'}
          </p>
        </div>

        {error && <p className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold text-rose-800">{error}</p>}

        {legacy?.isLegacyMixture && (
          <div id="bom-legacy-mixture" className="border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-2">
            <p className="font-bold text-amber-900">
              {isAr ? 'خلطة قديمة (استيراد تاريخي) - للعرض فقط، لم تُحوَّل إلى إصدار' : 'Legacy mixture (historical import) - read-only, not converted to a version'}
            </p>
            {legacy.lines.length > 0 && (
              <table className="w-full text-[11px]">
                <tbody>
                  {legacy.lines.map((l, i) => (
                    <tr key={`${l.materialId}-${i}`} className="border-t border-amber-100">
                      <td className="py-1">{[l.materialCode, l.materialName].filter(Boolean).join(' - ') || l.materialId}</td>
                      <td className="py-1 font-mono">{l.quantityKg ?? '-'} {isAr ? 'كجم' : 'kg'}</td>
                      <td className="py-1 font-mono">{l.percentage ?? '-'}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* History: every version, newest first */}
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <span className="flex items-center gap-1.5 font-black text-slate-700"><History className="w-3.5 h-3.5" />{isAr ? 'الإصدارات' : 'Versions'}</span>
            <button type="button" onClick={() => void load(true)} disabled={isLoading} className="p-1 rounded hover:bg-slate-200 cursor-pointer" title={isAr ? 'تحديث' : 'Refresh'}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <table id="bom-version-list" className="w-full text-[11px] min-w-[640px]">
            <thead className="text-slate-500">
              <tr>
                <th className="text-start px-3 py-1.5">{isAr ? 'الإصدار' : 'Version'}</th>
                <th className="text-start px-3 py-1.5">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="text-start px-3 py-1.5">{isAr ? 'سريان' : 'Effective'}</th>
                <th className="text-start px-3 py-1.5">{isAr ? 'المكونات' : 'Components'}</th>
                <th className="text-start px-3 py-1.5">{isAr ? 'آخر تعديل' : 'Updated'}</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {versions.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-4 text-center text-slate-400">{isLoading ? '...' : (isAr ? 'لا توجد إصدارات بعد' : 'No versions yet')}</td></tr>
              )}
              {versions.map((v) => (
                <tr key={v.id} className={v.id === selectedId ? 'bg-amber-50' : ''}>
                  <td className="px-3 py-1.5 font-mono font-bold">{v.versionCode}</td>
                  <td className="px-3 py-1.5">{statusBadge(v.status)}</td>
                  <td className="px-3 py-1.5 font-mono">{v.effectiveFrom || '-'} → {v.effectiveTo || '-'}</td>
                  <td className="px-3 py-1.5">{Array.isArray(v.components) ? v.components.length : 0}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-500">{String(v.updatedAt ?? v.createdAt ?? '').slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => openVersion(v)} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold cursor-pointer">
                        {canEdit && isVersionEditable(v) ? (isAr ? 'تعديل' : 'Edit') : (isAr ? 'عرض' : 'View')}
                      </button>
                      {canEdit && v.status === 'DRAFT' && (
                        <button type="button" disabled={isBusy} onClick={() => handleTransition(v, 'ACTIVE')} className="px-2 py-1 rounded-lg bg-emerald-100 text-emerald-800 hover:bg-emerald-200 font-bold cursor-pointer disabled:opacity-50">
                          {isAr ? 'تفعيل' : 'Activate'}
                        </button>
                      )}
                      {canEdit && v.status !== 'RETIRED' && (
                        <button type="button" disabled={isBusy} onClick={() => handleTransition(v, 'RETIRED')} className="px-2 py-1 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 font-bold cursor-pointer disabled:opacity-50">
                          {isAr ? 'إيقاف' : 'Retire'}
                        </button>
                      )}
                      {canEdit && (
                        <button type="button" disabled={isBusy || !newVersionCode.trim()} onClick={() => handleCreate(v)} title={isAr ? 'مسودة جديدة منسوخة من هذا الإصدار (أدخل رمز الإصدار الجديد أولًا)' : 'New draft copied from this version (enter the new version code first)'} className="p-1 rounded-lg hover:bg-slate-100 cursor-pointer disabled:opacity-40">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="flex items-center gap-2 flex-wrap">
            <input
              id="bom-new-version-code"
              type="text"
              value={newVersionCode}
              onChange={(e) => setNewVersionCode(e.target.value)}
              placeholder={isAr ? 'رمز الإصدار الجديد (مثال: V1)' : 'New version code (e.g. V1)'}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono w-56"
            />
            <button id="bom-new-version-btn" type="button" disabled={isBusy || !newVersionCode.trim()} onClick={() => handleCreate(null)} className="flex items-center gap-1.5 px-3 py-2 font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" />{isAr ? 'مسودة فارغة' : 'Empty draft'}
            </button>
            <span className="text-[10px] text-slate-500">{isAr ? 'أو استخدم زر النسخ بجانب أي إصدار.' : 'or use the copy button next to any version.'}</span>
          </div>
        )}

        {/* Version editor / viewer */}
        {selected && draft && (
          <div id="bom-version-editor" className="border border-slate-200 rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-black text-slate-800">{isAr ? 'الإصدار' : 'Version'} {selected.versionCode} {statusBadge(selected.status)}</span>
              {!editable && <span className="text-[10px] text-slate-500">{isAr ? 'للقراءة فقط' : 'Read-only'}</span>}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'رمز الإصدار' : 'Version code'}</span>
                <input disabled={!editable} value={draft.versionCode ?? ''} onChange={(e) => setDraft({ ...draft, versionCode: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'يسري من' : 'Effective from'}</span>
                <input type="date" disabled={!editable} value={draft.effectiveFrom ?? ''} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'يسري حتى' : 'Effective to'}</span>
                <input type="date" disabled={!editable} value={draft.effectiveTo ?? ''} onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'كمية الأساس (اختياري)' : 'Basis quantity (optional)'}</span>
                <input type="number" step="any" disabled={!editable} value={draft.basisQuantity ?? ''} onChange={(e) => setDraft({ ...draft, basisQuantity: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'وحدة الأساس' : 'Basis unit'}</span>
                <select disabled={!editable} value={draft.basisUnit ?? ''} onChange={(e) => setDraft({ ...draft, basisUnit: e.target.value })} className={inputClass}>
                  <option value="">-</option>
                  {BOM_UNITS.map((u) => <option key={u} value={u}>{isAr ? BOM_UNIT_LABELS[u].ar : BOM_UNIT_LABELS[u].en}</option>)}
                </select>
              </label>
              <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'المردود المتوقع % (اختياري)' : 'Expected yield % (optional)'}</span>
                <input type="number" step="any" disabled={!editable} value={draft.expectedYieldPercent ?? ''} onChange={(e) => setDraft({ ...draft, expectedYieldPercent: e.target.value })} className={inputClass} />
              </label>
            </div>

            <div className="overflow-x-auto">
              <table id="bom-component-lines" className="w-full text-[11px] min-w-[860px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-start px-1 py-1">#</th>
                    <th className="text-start px-1 py-1">{isAr ? 'النوع' : 'Type'}</th>
                    <th className="text-start px-1 py-1">{isAr ? 'المصدر' : 'Source'}</th>
                    <th className="text-start px-1 py-1 w-64">{isAr ? 'الصنف' : 'Item'}</th>
                    <th className="text-start px-1 py-1">%</th>
                    <th className="text-start px-1 py-1">{formula?.basisValid ? `${isAr ? 'الكمية /' : 'Qty /'} ${qty(formula.basisQuantity)} ${unitLabel(formula.basisUnit)}` : (isAr ? 'الكمية' : 'Quantity')}</th>
                    <th className="text-start px-1 py-1">{isAr ? 'الوحدة' : 'Unit'}</th>
                    {previewFactor !== null && <th className="text-start px-1 py-1">{isAr ? 'متوقع للمعاينة' : 'Preview'}</th>}
                    <th className="text-start px-1 py-1">{isAr ? 'ملاحظات' : 'Notes'}</th>
                    <th className="px-1 py-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...draft.components].sort((a: any, b: any) => a.sequence - b.sequence).map((c: any) => {
                    const fl = formulaLine(c.lineId);
                    const isAdditive = fl?.componentType === 'ADDITIVE';
                    return (
                    <tr key={c.lineId} className={isAdditive ? 'bg-purple-50/40' : ''}>
                      <td className="px-1 py-1 font-mono">{c.sequence}</td>
                      <td className="px-1 py-1 w-28">
                        <select disabled={!editable} value={isAdditive ? 'ADDITIVE' : 'BASE'} onChange={(e) => updateLine(c.lineId, { componentType: e.target.value })} className={inputClass}>
                          <option value="BASE">{isAr ? 'خلطة أساسية' : 'Base formula'}</option>
                          <option value="ADDITIVE">{isAr ? '+ إضافة' : '+ Additive'}</option>
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        <select disabled={!editable} value={c.itemSource} onChange={(e) => updateLine(c.lineId, { itemSource: e.target.value, itemId: '' })} className={inputClass}>
                          {BOM_ITEM_SOURCES.map((s) => <option key={s} value={s}>{s === 'products' ? (isAr ? 'منتج' : 'Product') : (isAr ? 'خامة' : 'Material')}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        {editable ? (
                          <SmartEntitySelect
                            entityType={c.itemSource === 'products' ? 'product' : 'material'}
                            allowAddNew={false}
                            options={c.itemSource === 'products' ? productOptions : materialOptions}
                            value={c.itemId || null}
                            onChange={(id) => updateLine(c.lineId, { itemId: id ?? '' })}
                          />
                        ) : (
                          <span>{itemLabel(c.itemSource, c.itemId)}</span>
                        )}
                      </td>
                      <td className="px-1 py-1 w-28">
                        {editable ? (
                          <div className="flex items-center gap-0.5">
                            {isAdditive && <span className="font-black text-purple-700">+</span>}
                            <input type="number" step="any" min="0" value={c.percentage ?? ''} onChange={(e) => updateLine(c.lineId, { percentage: e.target.value })} className={inputClass} />
                          </div>
                        ) : (
                          <span className="font-mono font-bold">{formatFormulaPercentage(fl?.componentType ?? 'BASE', fl?.percentage)}</span>
                        )}
                        {fl?.percentageDerived && <div className="text-[10px] text-slate-400 font-mono">= {formatFormulaPercentage(fl.componentType, fl.effectivePercentage)}</div>}
                      </td>
                      <td className="px-1 py-1 w-28">
                        <input type="number" step="any" disabled={!editable} value={c.quantity ?? ''} onChange={(e) => updateLine(c.lineId, { quantity: e.target.value })} className={inputClass} />
                        {fl?.quantityDerived && <div className="text-[10px] text-slate-400 font-mono">= {qty(fl.effectiveQuantity)} {unitLabel(formula?.basisUnit)}</div>}
                      </td>
                      <td className="px-1 py-1">
                        <select disabled={!editable} value={c.unit ?? ''} onChange={(e) => updateLine(c.lineId, { unit: e.target.value })} className={inputClass}>
                          <option value="">-</option>
                          {BOM_UNITS.map((u) => <option key={u} value={u}>{isAr ? BOM_UNIT_LABELS[u].ar : BOM_UNIT_LABELS[u].en}</option>)}
                        </select>
                      </td>
                      {previewFactor !== null && <td className="px-1 py-1 font-mono font-bold">{fl?.effectiveQuantity != null ? `${qty(fl.effectiveQuantity * previewFactor)} ${unitLabel(fl.unit)}` : '-'}</td>}
                      <td className="px-1 py-1"><input disabled={!editable} value={c.notes ?? ''} onChange={(e) => updateLine(c.lineId, { notes: e.target.value })} className={inputClass} /></td>
                      <td className="px-1 py-1">
                        {editable && (
                          <div className="flex items-center gap-0.5">
                            <button type="button" onClick={() => setDraft({ ...draft, components: moveComponent(draft.components, c.lineId, 'up') })} className="p-1 rounded hover:bg-slate-100 cursor-pointer" title={isAr ? 'أعلى' : 'Up'}><ArrowUp className="w-3 h-3" /></button>
                            <button type="button" onClick={() => setDraft({ ...draft, components: moveComponent(draft.components, c.lineId, 'down') })} className="p-1 rounded hover:bg-slate-100 cursor-pointer" title={isAr ? 'أسفل' : 'Down'}><ArrowDown className="w-3 h-3" /></button>
                            <button
                              type="button"
                              onClick={() => setDraft({ ...draft, components: normaliseSequences(draft.components.filter((x: any) => x.lineId !== c.lineId)) })}
                              className="p-1 rounded hover:bg-rose-50 text-rose-600 cursor-pointer"
                              title={isAr ? 'إزالة السطر من المسودة' : 'Remove line from the draft'}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Step 7A: formula summary - Base Formula / Additives / Total Applied, the activation rules, and a scaling preview */}
            {formula && (
              <div id="bom-formula-summary" className={`rounded-xl border p-3 space-y-2 ${formulaIssues.length ? 'border-rose-300 bg-rose-50/60' : 'border-emerald-200 bg-emerald-50/50'}`}>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  <span>{isAr ? 'الخلطة الأساسية:' : 'Base Formula:'} <span className={`font-black font-mono ${formula.percentageBased && formula.baseComplete && Math.abs(formula.baseTotal - 100) > 0.01 ? 'text-rose-700' : 'text-slate-900'}`}>{pct(formula.baseTotal)}%</span>{formula.percentageBased && !formula.baseComplete && <span className="text-rose-700"> ({isAr ? 'غير مكتمل' : 'incomplete'})</span>}</span>
                  <span>{isAr ? 'الإضافات:' : 'Additives:'} <span className="font-black font-mono text-purple-700">+{pct(formula.additiveTotal)}%</span></span>
                  <span>{isAr ? 'إجمالي المطبق:' : 'Total Applied:'} <span className="font-black font-mono">{pct(formula.totalApplied)}%</span></span>
                  <span className="text-slate-500">{isAr ? 'الأساس:' : 'Basis:'} {formula.basisValid ? `${qty(formula.basisQuantity)} ${unitLabel(formula.basisUnit)}` : (isAr ? 'غير محدد' : 'not set')}</span>
                </div>
                {formulaIssues.length > 0 ? (
                  <ul id="bom-formula-issues" className="list-disc ps-5 font-bold text-rose-800 space-y-0.5">
                    {formulaIssues.map((i, n) => <li key={n}>{isAr ? i.messageAr : i.messageEn}</li>)}
                    <li className="list-none -ms-5 font-semibold text-rose-700">{isAr ? 'يمكن حفظ المسودة، لكن التفعيل سيُرفض حتى التصحيح.' : 'The draft can be saved, but activation is refused until this is corrected.'}</li>
                  </ul>
                ) : (
                  <p className="font-bold text-emerald-800">{isAr ? 'الخلطة مكتملة لقواعد التفعيل.' : 'The formula meets the activation rules.'}</p>
                )}
                {formula.basisValid && (
                  <label className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-slate-600">{isAr ? 'معاينة كميات لإنتاج' : 'Preview quantities for production of'}</span>
                    <input id="bom-formula-preview" type="number" step="any" min="0" value={previewQuantity} onChange={(e) => setPreviewQuantity(e.target.value)} className="w-28 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono" />
                    <span>{unitLabel(formula.basisUnit)}</span>
                    {previewFactor !== null && <span className="text-slate-500 font-mono">x{qty(previewFactor)}</span>}
                  </label>
                )}
              </div>
            )}

            <label className="block space-y-1"><span className="font-bold text-slate-600">{isAr ? 'ملاحظات الإصدار' : 'Version notes'}</span>
              <textarea disabled={!editable} rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={inputClass} />
            </label>

            {editable && (
              <div className="flex items-center justify-between gap-2">
                <button id="bom-add-line-btn" type="button" onClick={addLine} className="flex items-center gap-1.5 px-3 py-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
                  <Plus className="w-3.5 h-3.5" />{isAr ? 'إضافة مكوّن' : 'Add component'}
                </button>
                <button id="bom-save-draft-btn" type="button" disabled={isBusy} onClick={() => void handleSaveDraft()} className="px-4 py-2 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50">
                  {isAr ? 'حفظ المسودة' : 'Save draft'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

/**
 * Routing versions and steps - opened from a row of Master Data -> Products ->
 * Routings. Phase 1 Step 3. The same pattern as BomVersionsModal.
 *
 * A window on ONE routing, not a routing application: the routing header is
 * created and edited in the shared Master Data table. Here the user sees the
 * version history, starts a draft (empty or copied), edits a draft's ordered
 * steps - operation, optional cost-centre override, optional equipment category
 * and machine, required flag, notes - and activates or retires a version.
 * Nothing is deleted; ACTIVE and RETIRED versions are read-only.
 *
 * The operation, hierarchy and equipment lists come from the caller (the
 * existing Master Data reads). Writes go through routingService.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, History, Plus, RefreshCw, Trash2, Info } from 'lucide-react';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import { useLanguage } from '../../i18n/LanguageContext';
import type { Operation } from '../../types';
import type { HierarchyIndex } from '../../services/hierarchyResolverPure';
import { OPERATION_EQUIPMENT_CATEGORY_IDS } from '../../services/operationMasterPure';
import { categoryLabel, getCategory } from '../../services/masterDataCategoryRegistry';
import {
  RoutingEquipmentRef,
  draftFromRoutingVersion,
  isVersionEditable,
  moveRoutingStep,
  nextLineId,
  normaliseSequences,
  routingVersionPayloadForSave,
} from '../../services/routingPure';
import { createRoutingVersion, listRoutingVersions, saveRoutingVersionDraft, transitionRoutingVersion } from '../../services/routingService';

export interface RoutingEquipmentOption extends RoutingEquipmentRef {
  code?: string;
  name?: string;
}

interface RoutingVersionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  routing: Record<string, any> | null;
  /** The existing Master Data edit gate, decided by the caller. */
  canEdit: boolean;
  /** Readable label of the routing's logical item. */
  itemLabel: string;
  operations: Operation[];
  hierarchyIndex: HierarchyIndex<any> | null;
  hierarchyOptions: Array<{ id: string; label: string }>;
  equipment: RoutingEquipmentOption[];
}

export const RoutingVersionsModal: React.FC<RoutingVersionsModalProps> = ({
  isOpen, onClose, routing, canEdit, itemLabel, operations, hierarchyIndex, hierarchyOptions, equipment,
}) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [versions, setVersions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any> | null>(null);
  const [newVersionCode, setNewVersionCode] = useState('');

  const context = useMemo(
    () => ({ operations: operations.length ? operations : null, hierarchyIndex, equipment: equipment.length ? equipment : null, routing }),
    [operations, hierarchyIndex, equipment, routing],
  );

  const operationLabel = (id: string) => {
    const op = operations.find((o) => o.id === id);
    if (!op) return id || '-';
    return `${op.code} - ${isAr ? op.nameAr : op.nameEn || op.nameAr}${op.active === false ? (isAr ? ' (معطلة)' : ' (inactive)') : ''}`;
  };
  const hierarchyLabel = (id: string | null) => (id ? hierarchyOptions.find((h) => h.id === id)?.label ?? id : null);
  const categoryName = (id: string) => {
    const c = getCategory(id);
    return c ? categoryLabel(c, language) : id;
  };

  const load = useCallback(async (skipCache = false) => {
    if (!routing?.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const list = await listRoutingVersions(String(routing.id), { skipCache });
      list.sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
      setVersions(list);
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsLoading(false);
    }
  }, [routing?.id]);

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
      const base = source ? draftFromRoutingVersion(source, newVersionCode) : { versionCode: newVersionCode, steps: [] };
      await createRoutingVersion(versions, { ...base, routingId: routing?.id }, context, { canEdit, language, copiedFrom: source ? source.versionCode : null });
      setNewVersionCode('');
    });

  const handleSaveDraft = () =>
    run(async () => {
      if (!selected || !draft) return;
      await saveRoutingVersionDraft(versions, selected, draft, context, { canEdit, language });
    });

  const handleTransition = (v: any, next: 'ACTIVE' | 'RETIRED') => {
    if (next === 'RETIRED' && !window.confirm(isAr ? `إيقاف الإصدار "${v.versionCode}"؟ يبقى محفوظًا للقراءة ولا يمكن إعادته.` : `Retire version "${v.versionCode}"? It stays readable and cannot be reactivated.`)) return;
    return run(async () => {
      await transitionRoutingVersion(versions, v, next, context, { canEdit, language });
      setSelectedId(null);
      setDraft(null);
    });
  };

  const updateStep = (lineId: string, patch: Record<string, any>) =>
    setDraft((d) => (d ? { ...d, steps: d.steps.map((s: any) => (s.lineId === lineId ? { ...s, ...patch } : s)) } : d));

  const addStep = () =>
    setDraft((d) => (d ? {
      ...d,
      steps: [...d.steps, { lineId: nextLineId(d.steps), sequence: d.steps.length + 1, operationId: '', hierarchyNodeId: null, equipmentCategoryId: null, equipmentId: null, required: true, notes: '' }],
    } : d));

  /** The categories a step may use: the operation's allowed list when it restricts them, else every registered one. */
  const categoriesFor = (operationId: string): string[] => {
    const op = operations.find((o) => o.id === operationId);
    const allowed = op?.allowedEquipmentCategoryIds ?? [];
    return allowed.length ? allowed : [...OPERATION_EQUIPMENT_CATEGORY_IDS];
  };

  const statusBadge = (status: string) => (
    <Badge variant={status === 'ACTIVE' ? 'success' : status === 'RETIRED' ? 'neutral' : 'warning'}>{status}</Badge>
  );
  const inputClass = 'w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs disabled:opacity-70';
  const activeOperations = operations.filter((o) => o.active !== false);

  return (
    <Modal
      id="routing-versions-modal"
      isOpen={isOpen}
      onClose={() => { if (!isBusy) onClose(); }}
      title={isAr ? `إصدارات المسار: ${routing?.code ?? ''}` : `Routing versions: ${routing?.code ?? ''}`}
      subtitle={routing ? `${routing.name ?? ''} · ${itemLabel}` : ''}
      maxWidth="4xl"
    >
      <div className="space-y-4 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 text-sky-900">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="font-semibold leading-relaxed">
            {isAr
              ? 'المسار يحدد العمليات وترتيبها فقط - لا مواد ولا تكاليف ولا تنفيذ إنتاج. تُعدَّل الخطوات في المسودة فقط؛ لتغيير إصدار نشط انسخه إلى مسودة جديدة. يمكن تكرار نفس العملية في أكثر من خطوة. لا يُحذف أي إصدار.'
              : 'A routing defines operations and their order only - no materials, costs or production execution. Steps change only in a draft; to change an active version, copy it to a new draft. The same operation may appear in more than one step. Versions are never deleted.'}
          </p>
        </div>

        {error && <p className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold text-rose-800">{error}</p>}

        {/* History: every version, newest first */}
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
            <span className="flex items-center gap-1.5 font-black text-slate-700"><History className="w-3.5 h-3.5" />{isAr ? 'الإصدارات' : 'Versions'}</span>
            <button type="button" onClick={() => void load(true)} disabled={isLoading} className="p-1 rounded hover:bg-slate-200 cursor-pointer" title={isAr ? 'تحديث' : 'Refresh'}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <table id="routing-version-list" className="w-full text-[11px] min-w-[640px]">
            <thead className="text-slate-500">
              <tr>
                <th className="text-start px-3 py-1.5">{isAr ? 'الإصدار' : 'Version'}</th>
                <th className="text-start px-3 py-1.5">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="text-start px-3 py-1.5">{isAr ? 'سريان' : 'Effective'}</th>
                <th className="text-start px-3 py-1.5">{isAr ? 'الخطوات' : 'Steps'}</th>
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
                  <td className="px-3 py-1.5">{Array.isArray(v.steps) ? v.steps.length : 0}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-500">{String(v.updatedAt ?? v.createdAt ?? '').slice(0, 16).replace('T', ' ')}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-end gap-1">
                      <button type="button" onClick={() => { setSelectedId(v.id); setDraft({ ...routingVersionPayloadForSave(v) }); setError(null); }} className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold cursor-pointer">
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
              id="routing-new-version-code"
              type="text"
              value={newVersionCode}
              onChange={(e) => setNewVersionCode(e.target.value)}
              placeholder={isAr ? 'رمز الإصدار الجديد (مثال: R1)' : 'New version code (e.g. R1)'}
              className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono w-56"
            />
            <button id="routing-new-version-btn" type="button" disabled={isBusy || !newVersionCode.trim()} onClick={() => handleCreate(null)} className="flex items-center gap-1.5 px-3 py-2 font-bold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" />{isAr ? 'مسودة فارغة' : 'Empty draft'}
            </button>
            <span className="text-[10px] text-slate-500">{isAr ? 'أو استخدم زر النسخ بجانب أي إصدار.' : 'or use the copy button next to any version.'}</span>
          </div>
        )}

        {selected && draft && (
          <div id="routing-version-editor" className="border border-slate-200 rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-black text-slate-800">{isAr ? 'الإصدار' : 'Version'} {selected.versionCode} {statusBadge(selected.status)}</span>
              {!editable && <span className="text-[10px] text-slate-500">{isAr ? 'للقراءة فقط' : 'Read-only'}</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'رمز الإصدار' : 'Version code'}</span>
                <input disabled={!editable} value={draft.versionCode ?? ''} onChange={(e) => setDraft({ ...draft, versionCode: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'يسري من' : 'Effective from'}</span>
                <input type="date" disabled={!editable} value={draft.effectiveFrom ?? ''} onChange={(e) => setDraft({ ...draft, effectiveFrom: e.target.value })} className={inputClass} />
              </label>
              <label className="space-y-1"><span className="font-bold text-slate-600">{isAr ? 'يسري حتى' : 'Effective to'}</span>
                <input type="date" disabled={!editable} value={draft.effectiveTo ?? ''} onChange={(e) => setDraft({ ...draft, effectiveTo: e.target.value })} className={inputClass} />
              </label>
            </div>

            <div className="overflow-x-auto">
              <table id="routing-step-lines" className="w-full text-[11px] min-w-[980px]">
                <thead className="text-slate-500">
                  <tr>
                    <th className="text-start px-1 py-1">#</th>
                    <th className="text-start px-1 py-1 w-56">{isAr ? 'العملية' : 'Operation'}</th>
                    <th className="text-start px-1 py-1 w-56">{isAr ? 'مركز التكلفة (اختياري)' : 'Cost centre override'}</th>
                    <th className="text-start px-1 py-1">{isAr ? 'فئة المعدات' : 'Equipment category'}</th>
                    <th className="text-start px-1 py-1">{isAr ? 'المعدة' : 'Equipment'}</th>
                    <th className="text-start px-1 py-1">{isAr ? 'إلزامية' : 'Required'}</th>
                    <th className="text-start px-1 py-1">{isAr ? 'ملاحظات' : 'Notes'}</th>
                    <th className="px-1 py-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...draft.steps].sort((a: any, b: any) => a.sequence - b.sequence).map((s: any) => (
                    <tr key={s.lineId}>
                      <td className="px-1 py-1 font-mono">{s.sequence}</td>
                      <td className="px-1 py-1">
                        {editable ? (
                          <select value={s.operationId ?? ''} onChange={(e) => updateStep(s.lineId, { operationId: e.target.value, equipmentCategoryId: null, equipmentId: null })} className={inputClass}>
                            <option value="">-</option>
                            {activeOperations.map((o) => <option key={o.id} value={o.id}>{operationLabel(String(o.id))}</option>)}
                            {s.operationId && !activeOperations.some((o) => o.id === s.operationId) && <option value={s.operationId}>{operationLabel(s.operationId)}</option>}
                          </select>
                        ) : (
                          <span>{operationLabel(s.operationId)}</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {editable ? (
                          <select value={s.hierarchyNodeId ?? ''} onChange={(e) => updateStep(s.lineId, { hierarchyNodeId: e.target.value || null })} className={inputClass} disabled={hierarchyOptions.length === 0}>
                            <option value="">{isAr ? 'افتراضي العملية' : "Operation's default"}</option>
                            {hierarchyOptions.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
                          </select>
                        ) : (
                          <span>{hierarchyLabel(s.hierarchyNodeId) ?? (isAr ? 'افتراضي العملية' : "Operation's default")}</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {editable ? (
                          <select value={s.equipmentCategoryId ?? ''} onChange={(e) => updateStep(s.lineId, { equipmentCategoryId: e.target.value || null, equipmentId: null })} className={inputClass}>
                            <option value="">-</option>
                            {categoriesFor(s.operationId).map((c) => <option key={c} value={c}>{categoryName(c)}</option>)}
                          </select>
                        ) : (
                          <span>{s.equipmentCategoryId ? categoryName(s.equipmentCategoryId) : '-'}</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        {editable ? (
                          <select value={s.equipmentId ?? ''} onChange={(e) => updateStep(s.lineId, { equipmentId: e.target.value || null })} className={inputClass} disabled={!s.equipmentCategoryId}>
                            <option value="">{isAr ? 'أي معدة' : 'Any'}</option>
                            {equipment.filter((m) => m.categoryId === s.equipmentCategoryId && m.active).map((m) => <option key={m.id} value={m.id}>{[m.code, m.name].filter(Boolean).join(' - ') || m.id}</option>)}
                          </select>
                        ) : (
                          <span>{s.equipmentId ? ([equipment.find((m) => m.id === s.equipmentId && m.categoryId === s.equipmentCategoryId)?.code, equipment.find((m) => m.id === s.equipmentId && m.categoryId === s.equipmentCategoryId)?.name].filter(Boolean).join(' - ') || s.equipmentId) : '-'}</span>
                        )}
                      </td>
                      <td className="px-1 py-1">
                        <input type="checkbox" disabled={!editable} checked={s.required !== false} onChange={(e) => updateStep(s.lineId, { required: e.target.checked })} className="w-3.5 h-3.5 accent-amber-500" />
                      </td>
                      <td className="px-1 py-1"><input disabled={!editable} value={s.notes ?? ''} onChange={(e) => updateStep(s.lineId, { notes: e.target.value })} className={inputClass} /></td>
                      <td className="px-1 py-1">
                        {editable && (
                          <div className="flex items-center gap-0.5">
                            <button type="button" onClick={() => setDraft({ ...draft, steps: moveRoutingStep(draft.steps, s.lineId, 'up') })} className="p-1 rounded hover:bg-slate-100 cursor-pointer" title={isAr ? 'أعلى' : 'Up'}><ArrowUp className="w-3 h-3" /></button>
                            <button type="button" onClick={() => setDraft({ ...draft, steps: moveRoutingStep(draft.steps, s.lineId, 'down') })} className="p-1 rounded hover:bg-slate-100 cursor-pointer" title={isAr ? 'أسفل' : 'Down'}><ArrowDown className="w-3 h-3" /></button>
                            <button type="button" onClick={() => setDraft({ ...draft, steps: normaliseSequences(draft.steps.filter((x: any) => x.lineId !== s.lineId)) })} className="p-1 rounded hover:bg-rose-50 text-rose-600 cursor-pointer" title={isAr ? 'إزالة الخطوة من المسودة' : 'Remove step from the draft'}>
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="block space-y-1"><span className="font-bold text-slate-600">{isAr ? 'ملاحظات الإصدار' : 'Version notes'}</span>
              <textarea disabled={!editable} rows={2} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={inputClass} />
            </label>

            {editable && (
              <div className="flex items-center justify-between gap-2">
                <button id="routing-add-step-btn" type="button" onClick={addStep} className="flex items-center gap-1.5 px-3 py-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer">
                  <Plus className="w-3.5 h-3.5" />{isAr ? 'إضافة خطوة' : 'Add step'}
                </button>
                <button id="routing-save-draft-btn" type="button" disabled={isBusy} onClick={() => void handleSaveDraft()} className="px-4 py-2 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50">
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

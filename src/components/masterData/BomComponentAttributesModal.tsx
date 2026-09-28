/**
 * BOM component attributes - alumina %, local / imported, and prices (3.24.0).
 *
 * The BOM costing view needs, for every material a BOM uses: its alumina %,
 * whether it is LOCAL or IMPORTED, and its two prices - the last purchase price
 * and the average price of the stores' issues to manufacturing - with the unit
 * the prices are per. When the system does not hold them, this is where they
 * are set, for every material at once, with a filter for what is still missing.
 *
 * Writes go one material at a time through updateMasterDataItem (sanitised,
 * cache-invalidating, audited), carrying ONLY the fields that changed - a save
 * never touches a material's code, name, unit or anything else. Editing is
 * behind the existing Master Data edit gate; without it the screen is
 * read-only. Prices entered here are the costing design's MANUAL_APPROVED_INPUT
 * source (costingSetupPure.ts).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, Search } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useLanguage } from '../../i18n/LanguageContext';
import { BOM_UNITS, BOM_UNIT_LABELS } from '../../services/bomPure';
import { fetchMasterData, updateMasterDataItem, MASTER_DATA_COLLECTIONS } from '../../services/masterDataService';
import {
  MATERIAL_ORIGINS,
  MATERIAL_ORIGIN_LABELS,
  MaterialCostAttributesDraft,
  draftFromMaterial,
  materialCostAttributesPatch,
  missingAttributes,
  validateMaterialCostAttributes,
} from '../../services/bomCostingPure';

interface BomComponentAttributesModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The existing Master Data edit gate, decided by the caller. */
  canEdit: boolean;
  /** Told after a save, so lists already on screen are read again. */
  onSaved?: () => void;
}

/** One write, bounded - a save that does not answer is reported, never waited on forever. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

export const BomComponentAttributesModal: React.FC<BomComponentAttributesModalProps> = ({ isOpen, onClose, canEdit, onSaved }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [materials, setMaterials] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MaterialCostAttributesDraft>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (skipCache = false) => {
    setIsLoading(true);
    setNotice(null);
    try {
      const list = await fetchMasterData<any>(MASTER_DATA_COLLECTIONS.materials, { skipCache });
      list.sort((a, b) => String(a.code ?? '').localeCompare(String(b.code ?? '')));
      setMaterials(list);
      setDrafts(Object.fromEntries(list.map((m) => [String(m.id), draftFromMaterial(m)])));
      setRowErrors({});
    } catch (err: any) {
      setNotice(String(err?.message ?? err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const originals = useMemo(
    () => Object.fromEntries(materials.map((m) => [String(m.id), draftFromMaterial(m)])),
    [materials],
  );
  const changedIds = useMemo(
    () => materials
      .map((m) => String(m.id))
      .filter((id) => drafts[id] && Object.keys(materialCostAttributesPatch(originals[id], drafts[id], '')).some((k) => k !== 'pricesUpdatedAt')),
    [materials, drafts, originals],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials.filter((m) => {
      if (missingOnly && missingAttributes(m).length === 0) return false;
      if (!q) return true;
      return String(m.code ?? '').toLowerCase().includes(q) || String(m.name ?? '').toLowerCase().includes(q);
    });
  }, [materials, search, missingOnly]);

  const missingCount = useMemo(() => materials.filter((m) => missingAttributes(m).length > 0).length, [materials]);

  const update = (id: string, patch: Partial<MaterialCostAttributesDraft>) =>
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));

  /** Saves every changed row, one at a time; a row that fails keeps its edit and says why. */
  const handleSave = async () => {
    if (!canEdit || changedIds.length === 0) return;
    setIsSaving(true);
    setNotice(null);
    const errors: Record<string, string> = {};
    let saved = 0;
    const now = new Date().toISOString();
    for (const id of changedIds) {
      const issues = validateMaterialCostAttributes(drafts[id], BOM_UNITS);
      if (issues.length) {
        errors[id] = issues.map((i) => (isAr ? i.messageAr : i.messageEn)).join(' | ');
        continue;
      }
      try {
        const patch = materialCostAttributesPatch(originals[id], drafts[id], now);
        await withTimeout(updateMasterDataItem(MASTER_DATA_COLLECTIONS.materials, id, patch), 30_000);
        saved++;
      } catch (err: any) {
        errors[id] = err?.message === 'TIMEOUT'
          ? (isAr ? 'لم يرد الخادم - تحقق من الاتصال ثم احفظ مرة أخرى.' : 'The server did not answer - check the connection and save again.')
          : String(err?.message ?? err);
      }
    }
    setIsSaving(false);
    const failed = Object.keys(errors).length;
    if (saved > 0) {
      onSaved?.();
      await load(true);
    }
    // Rows that failed keep what the user typed, over the freshly read values.
    if (failed > 0) {
      setDrafts((d) => ({ ...d, ...Object.fromEntries(Object.keys(errors).map((id) => [id, drafts[id]])) }));
    }
    setRowErrors(errors);
    setNotice(isAr
      ? `تم حفظ ${saved} خامة${failed ? ` - تعذر حفظ ${failed}، راجع الأسطر المعلّمة` : ''}.`
      : `${saved} material(s) saved${failed ? ` - ${failed} could not be saved, see the marked rows` : ''}.`);
  };

  const unitLabel = (u: string) => (BOM_UNIT_LABELS[u] ? (isAr ? BOM_UNIT_LABELS[u].ar : BOM_UNIT_LABELS[u].en) : u);
  const input = 'w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs disabled:opacity-70';

  return (
    <Modal
      id="bom-component-attributes-modal"
      isOpen={isOpen}
      onClose={() => { if (!isSaving) onClose(); }}
      title={isAr ? 'خصائص وأسعار مكونات قوائم المواد' : 'BOM component attributes and prices'}
      subtitle={isAr
        ? 'نسبة الألومينا، محلي أو مستورد، وأسعار الخامات المستخدمة في حساب تكلفة الـ BOM'
        : 'Alumina %, local or imported, and the material prices used to cost a BOM'}
      maxWidth="4xl"
    >
      <div className="space-y-3 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-3.5 h-3.5 absolute top-2.5 text-slate-400 start-2.5" />
            <input
              id="bom-attributes-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isAr ? 'بحث بالكود أو الاسم...' : 'Search by code or name...'}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl ps-8 pe-3 py-2"
            />
          </div>
          <label className="flex items-center gap-1.5 font-bold text-slate-700 cursor-pointer">
            <input id="bom-attributes-missing-only" type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} className="accent-amber-500" />
            {isAr ? `الناقص فقط (${missingCount})` : `Missing only (${missingCount})`}
          </label>
          <button type="button" onClick={() => void load(true)} disabled={isLoading || isSaving} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer disabled:opacity-50" title={isAr ? 'تحديث' : 'Refresh'}>
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          {canEdit && (
            <button
              id="bom-attributes-save-btn"
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || changedIds.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-xl cursor-pointer disabled:opacity-50"
            >
              {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {isAr ? `حفظ التغييرات (${changedIds.length})` : `Save changes (${changedIds.length})`}
            </button>
          )}
        </div>

        {!canEdit && (
          <p className="font-semibold text-slate-500">{isAr ? 'للعرض فقط - لا تملك صلاحية تعديل البيانات الأساسية.' : 'Read-only - you do not have permission to edit Master Data.'}</p>
        )}
        {notice && <p className="font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">{notice}</p>}

        <div className="border border-slate-200 rounded-xl overflow-auto max-h-[60vh]">
          <table id="bom-attributes-table" className="w-full text-[11px] min-w-[900px]">
            <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10">
              <tr>
                <th className="text-start px-2 py-2">{isAr ? 'الكود' : 'Code'}</th>
                <th className="text-start px-2 py-2">{isAr ? 'الخامة' : 'Material'}</th>
                <th className="text-start px-2 py-2">{isAr ? 'الوحدة' : 'Unit'}</th>
                <th className="text-start px-2 py-2 w-24">{isAr ? 'الألومينا %' : 'Alumina %'}</th>
                <th className="text-start px-2 py-2 w-28">{isAr ? 'محلي / مستورد' : 'Local / Imported'}</th>
                <th className="text-start px-2 py-2 w-28">{isAr ? 'آخر سعر شراء' : 'Last purchase price'}</th>
                <th className="text-start px-2 py-2 w-28">{isAr ? 'متوسط سعر المنصرف' : 'Average issue price'}</th>
                <th className="text-start px-2 py-2 w-24">{isAr ? 'السعر لكل' : 'Price per'}</th>
                <th className="text-start px-2 py-2">{isAr ? 'آخر تحديث للأسعار' : 'Prices updated'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">{isLoading ? '...' : (isAr ? 'لا توجد خامات' : 'No materials')}</td></tr>
              )}
              {visible.map((m) => {
                const id = String(m.id);
                const d = drafts[id];
                if (!d) return null;
                const changed = changedIds.includes(id);
                return (
                  <React.Fragment key={id}>
                    <tr className={changed ? 'bg-amber-50/60' : ''}>
                      <td className="px-2 py-1.5 font-mono font-bold">{m.code || '-'}</td>
                      <td className="px-2 py-1.5">{m.name || '-'}</td>
                      <td className="px-2 py-1.5">{m.unit ? unitLabel(String(m.unit)) : '-'}</td>
                      <td className="px-2 py-1.5">
                        <input type="number" step="any" min="0" max="100" disabled={!canEdit} value={d.aluminaPercentage} onChange={(e) => update(id, { aluminaPercentage: e.target.value })} className={input} />
                      </td>
                      <td className="px-2 py-1.5">
                        <select disabled={!canEdit} value={d.origin} onChange={(e) => update(id, { origin: e.target.value })} className={input}>
                          <option value="">-</option>
                          {MATERIAL_ORIGINS.map((o) => <option key={o} value={o}>{isAr ? MATERIAL_ORIGIN_LABELS[o].ar : MATERIAL_ORIGIN_LABELS[o].en}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" step="any" min="0" disabled={!canEdit} value={d.lastPurchasePrice} onChange={(e) => update(id, { lastPurchasePrice: e.target.value })} className={input} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input type="number" step="any" min="0" disabled={!canEdit} value={d.averageIssuePrice} onChange={(e) => update(id, { averageIssuePrice: e.target.value })} className={input} />
                      </td>
                      <td className="px-2 py-1.5">
                        <select disabled={!canEdit} value={d.priceUnit} onChange={(e) => update(id, { priceUnit: e.target.value })} className={input}>
                          <option value="">-</option>
                          {BOM_UNITS.map((u) => <option key={u} value={u}>{unitLabel(u)}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-slate-500">{m.pricesUpdatedAt ? String(m.pricesUpdatedAt).slice(0, 10) : '-'}</td>
                    </tr>
                    {rowErrors[id] && (
                      <tr><td colSpan={9} className="px-2 py-1 text-[10px] font-bold text-rose-700 bg-rose-50">{rowErrors[id]}</td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-500">
          {isAr
            ? 'الأسعار بالجنيه المصري لكل وحدة السعر المختارة. المكونات من نوع "منتج" تُعتبر محلية وتؤخذ نسبة الألومينا من بيانات المنتج نفسه.'
            : 'Prices are in EGP per the chosen price unit. Components that are products count as local; their alumina % comes from the product itself.'}
        </p>
      </div>
    </Modal>
  );
};

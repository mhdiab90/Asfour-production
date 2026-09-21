/**
 * Products <-> Materials overlap review - a Master Data utility.
 *
 * Opened from the existing Master Data screen (Products or Materials tab), in
 * the same way as the Data Quality Report and the hierarchy reconciliation. It
 * reads the three collections through the shared cache-first fetchMasterData,
 * runs the pure deterministic analysis (itemOverlapAnalysisPure.ts), and shows
 * what may be the same logical item and why.
 *
 * Phase 1 Step 2A adds explicit, persisted decisions per row - and nothing
 * automatic. "Map as Same Logical Item" and "Keep Separate" each need a
 * confirmation and go through logicalItemService (fresh read, pure conflict
 * planning, one audited write). Neither the product nor the material record is
 * ever changed, merged or deleted; withdrawn decisions become inactive. Users
 * without the Master Data edit gate see the state but no action.
 *
 * Phase 1 Step 3 adds "Register as Logical Item" for one product or material on
 * its own (e.g. a brick with no material twin), also confirmed. The service
 * refuses it while that record still has an undecided overlap row.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, RefreshCw, Info, Link2, Unlink, SplitSquareHorizontal } from 'lucide-react';
import { Modal } from '../common/Modal';
import { fetchMasterData } from '../../services/masterDataService';
import { useLanguage } from '../../i18n/LanguageContext';
import type { ItemKind, Material, Product, ProductType } from '../../types';
import { ITEM_KIND_LABELS } from '../../services/itemClassificationPure';
import {
  analyzeProductMaterialOverlap,
  ItemMatchType,
  ItemOverlapAction,
  ItemOverlapReport,
  ItemOverlapRow,
} from '../../services/itemOverlapAnalysisPure';
import { LogicalItemSource, OverlapRowState, findLogicalItemFor, overlapRowState } from '../../services/logicalItemPure';
import {
  LogicalItemState,
  keepProductAndMaterialSeparate,
  loadLogicalItemState,
  mapProductToMaterial,
  registerLogicalItem,
  unlinkLogicalItem,
  withdrawKeepSeparate,
} from '../../services/logicalItemService';

interface ItemOverlapReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The existing Master Data edit gate, decided by the caller. Without it the dialog is read-only. */
  canEdit?: boolean;
}

type Filter = 'ALL' | 'CANDIDATES' | 'REVIEW' | 'DECIDED' | 'UNMATCHED_MATERIALS' | 'UNMATCHED_PRODUCTS';

type PendingAction =
  | { kind: 'MAP' | 'KEEP' | 'UNLINK' | 'WITHDRAW'; row: ItemOverlapRow; targetId?: string }
  | { kind: 'REGISTER'; source: LogicalItemSource; record: { id: string; code?: string; name?: string } };

const MATCH_LABELS: Record<ItemMatchType, { ar: string; en: string; tone: string }> = {
  CODE_AND_NAME_MATCH: { ar: 'تطابق الكود والاسم', en: 'Code & name match', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  EXACT_CODE_MATCH: { ar: 'تطابق الكود', en: 'Exact code match', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  EXACT_NAME_MATCH: { ar: 'تطابق الاسم', en: 'Exact name match', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  AMBIGUOUS: { ar: 'غامض', en: 'Ambiguous', tone: 'bg-rose-50 text-rose-800 border-rose-200' },
  NO_MATCH: { ar: 'لا يوجد تطابق', en: 'No match', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};

const ACTION_LABELS: Record<ItemOverlapAction, { ar: string; en: string }> = {
  CANDIDATE_FOR_MAPPING: { ar: 'مرشح للربط كصنف واحد', en: 'Candidate: same logical item' },
  REVIEW: { ar: 'يحتاج مراجعة', en: 'Needs review' },
  KEEP_SEPARATE: { ar: 'إبقاء منفصل', en: 'Keep separate' },
};

const STATE_LABELS: Record<OverlapRowState, { ar: string; en: string; tone: string }> = {
  MAPPED: { ar: 'مرتبط كصنف منطقي واحد', en: 'Mapped', tone: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  KEPT_SEPARATE: { ar: 'تم إبقاؤه منفصلًا', en: 'Kept separate', tone: 'bg-slate-200 text-slate-800 border-slate-300' },
  CONFLICT: { ar: 'تعارض', en: 'Conflict', tone: 'bg-rose-100 text-rose-900 border-rose-300' },
  CANDIDATE: { ar: 'مرشح - لم يُراجع', en: 'Candidate - not reviewed', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  NOT_REVIEWED: { ar: 'لم يُراجع', en: 'Not reviewed', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  NO_MATCH: { ar: 'لا يوجد تطابق', en: 'No match', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};

export const ItemOverlapReviewModal: React.FC<ItemOverlapReviewModalProps> = ({ isOpen, onClose, canEdit = false }) => {
  const { language } = useLanguage();
  const isAr = language === 'ar';
  const [report, setReport] = useState<ItemOverlapReport | null>(null);
  const [decisions, setDecisions] = useState<LogicalItemState>({ items: [], decisions: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (skipCache = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const [materials, products, productTypes] = await Promise.all([
        fetchMasterData<Material>('materials', { skipCache }),
        fetchMasterData<Product>('products', { skipCache }),
        fetchMasterData<ProductType>('productTypes', { skipCache }),
      ]);
      setReport(analyzeProductMaterialOverlap(materials, products, productTypes));
      // Decisions are read separately: an unavailable decision store must not hide the analysis.
      try {
        setDecisions(await loadLogicalItemState({ skipCache }));
      } catch (err: any) {
        setError(isAr ? `تعذر قراءة قرارات الربط: ${String(err?.message ?? err)}` : `Could not read mapping decisions: ${String(err?.message ?? err)}`);
      }
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsLoading(false);
    }
  }, [isAr]);

  useEffect(() => {
    if (isOpen) {
      setPending(null);
      setNotice(null);
      void load();
    }
  }, [isOpen, load]);

  const kindLabel = (kind: ItemKind | null) =>
    kind ? (isAr ? ITEM_KIND_LABELS[kind].ar : ITEM_KIND_LABELS[kind].en) : (isAr ? 'غير مصنف' : 'Unclassified');

  const stateOf = useCallback((r: ItemOverlapRow) => overlapRowState(r, decisions.items, decisions.decisions), [decisions]);

  const rows = useMemo(() => {
    if (!report) return [];
    if (filter === 'CANDIDATES') return report.rows.filter((r) => r.recommendedAction === 'CANDIDATE_FOR_MAPPING');
    if (filter === 'REVIEW') return report.rows.filter((r) => r.needsReview);
    if (filter === 'DECIDED') return report.rows.filter((r) => ['MAPPED', 'KEPT_SEPARATE'].includes(stateOf(r).state));
    if (filter === 'UNMATCHED_MATERIALS') return report.rows.filter((r) => r.matchType === 'NO_MATCH');
    return report.rows;
  }, [report, filter, stateOf]);

  const decidedCounts = useMemo(() => {
    const counts = { mapped: 0, kept: 0, conflicts: 0 };
    for (const r of report?.rows ?? []) {
      const st = stateOf(r).state;
      if (st === 'MAPPED') counts.mapped += 1;
      if (st === 'KEPT_SEPARATE') counts.kept += 1;
      if (st === 'CONFLICT') counts.conflicts += 1;
    }
    return counts;
  }, [report, stateOf]);

  const s = report?.summary;
  const cards: Array<{ label: string; value: number | undefined; tone: string }> = [
    { label: isAr ? 'إجمالي المنتجات' : 'Total Products', value: s?.totalProducts, tone: 'bg-slate-100 text-slate-800' },
    { label: isAr ? 'إجمالي الخامات' : 'Total Materials', value: s?.totalMaterials, tone: 'bg-slate-100 text-slate-800' },
    { label: isAr ? 'تطابق الكود والاسم' : 'Code & Name Matches', value: s?.codeAndNameMatches, tone: 'bg-emerald-50 text-emerald-800 border border-emerald-200' },
    { label: isAr ? 'تطابق الكود فقط' : 'Exact Code Matches', value: s?.exactCodeMatches, tone: 'bg-sky-50 text-sky-800 border border-sky-200' },
    { label: isAr ? 'تطابق الاسم فقط' : 'Name Matches', value: s?.exactNameMatches, tone: 'bg-amber-50 text-amber-800 border border-amber-200' },
    { label: isAr ? 'خامات غامضة' : 'Ambiguous Materials', value: s?.ambiguousMaterials, tone: 'bg-rose-50 text-rose-800 border border-rose-200' },
    { label: isAr ? 'خامات بلا تطابق' : 'Unmatched Materials', value: s?.unmatchedMaterials, tone: 'bg-slate-50 text-slate-700 border border-slate-200' },
    { label: isAr ? 'منتجات بلا تطابق' : 'Unmatched Products', value: s?.unmatchedProducts, tone: 'bg-slate-50 text-slate-700 border border-slate-200' },
    { label: isAr ? 'مرتبطة' : 'Mapped', value: decidedCounts.mapped, tone: 'bg-emerald-100 text-emerald-900 border border-emerald-300' },
    { label: isAr ? 'أُبقيت منفصلة' : 'Kept Separate', value: decidedCounts.kept, tone: 'bg-slate-200 text-slate-800 border border-slate-300' },
    { label: isAr ? 'تعارضات' : 'Conflicts', value: decidedCounts.conflicts, tone: 'bg-rose-100 text-rose-900 border border-rose-300' },
  ];

  const filters: Array<{ id: Filter; label: string }> = [
    { id: 'ALL', label: isAr ? 'كل الخامات' : 'All materials' },
    { id: 'CANDIDATES', label: isAr ? 'مرشحة للربط' : 'Mapping candidates' },
    { id: 'REVIEW', label: isAr ? 'تحتاج مراجعة' : 'Needs review' },
    { id: 'DECIDED', label: isAr ? 'تم اتخاذ قرار' : 'Decided' },
    { id: 'UNMATCHED_MATERIALS', label: isAr ? 'خامات بلا تطابق' : 'Unmatched materials' },
    { id: 'UNMATCHED_PRODUCTS', label: isAr ? 'منتجات بلا تطابق' : 'Unmatched products' },
  ];

  const confirmText = (p: PendingAction): string => {
    if (p.kind === 'REGISTER') {
      const who = [p.record.code, p.record.name].filter(Boolean).join(' - ') || p.record.id;
      return isAr
        ? `${who}: سيتم تسجيل ${p.source === 'products' ? 'المنتج' : 'الخامة'} كصنف منطقي مستقل بدون تعديل السجل. يُرفض إذا كان له تطابق لم يُحسم بعد. هل تريد المتابعة؟`
        : `${who}: The ${p.source === 'products' ? 'product' : 'material'} will be registered as its own logical item without changing the record. This is refused while it has an undecided overlap. Continue?`;
    }
    const pairAr = `${p.row.productName || p.row.productCode || p.row.productId} ↔ ${p.row.materialName || p.row.materialCode || p.row.materialId}`;
    const pairEn = pairAr;
    if (p.kind === 'MAP') {
      const warnAr = p.row.matchType !== 'CODE_AND_NAME_MATCH' ? ' تنبيه: هذا ليس تطابقًا تامًا في الكود والاسم - تأكد أنهما نفس الصنف فعلًا.' : '';
      const warnEn = p.row.matchType !== 'CODE_AND_NAME_MATCH' ? ' Note: this is not an exact code-and-name match - make sure they really are the same item.' : '';
      return isAr
        ? `${pairAr}: سيتم ربط المنتج والخامة كصنف منطقي واحد بدون حذف أو تعديل أي من السجلين. هل تريد المتابعة؟${warnAr}`
        : `${pairEn}: The product and material will be linked as one logical item. Neither existing record will be deleted or modified. Continue?${warnEn}`;
    }
    if (p.kind === 'KEEP') {
      return isAr
        ? `${pairAr}: سيتم تسجيل قرار إبقاء المنتج والخامة منفصلين. لن يتغير أي سجل. هل تريد المتابعة؟`
        : `${pairEn}: The decision to keep the product and material separate will be recorded. No record changes. Continue?`;
    }
    if (p.kind === 'UNLINK') {
      return isAr
        ? `${pairAr}: سيتم إلغاء تفعيل الربط (يبقى محفوظًا للقراءة). لن يتغير المنتج أو الخامة. هل تريد المتابعة؟`
        : `${pairEn}: The mapping will be deactivated (it stays readable). The product and material are not changed. Continue?`;
    }
    return isAr
      ? `${pairAr}: سيتم إلغاء قرار «إبقاء منفصل» (يبقى محفوظًا للقراءة). هل تريد المتابعة؟`
      : `${pairEn}: The Keep Separate decision will be withdrawn (it stays readable). Continue?`;
  };

  const runPending = async () => {
    if (!pending || !canEdit) return;
    if (pending.kind === 'REGISTER') {
      setIsBusy(true);
      setError(null);
      setNotice(null);
      try {
        const result = await registerLogicalItem(pending.source, pending.record, { canEdit, language });
        setNotice(result.wrote
          ? (isAr ? `تم التسجيل كصنف منطقي (${result.logicalItemId}).` : `Registered as logical item (${result.logicalItemId}).`)
          : (isAr ? 'مسجل بالفعل - لم يُكتب شيء.' : 'Already registered - nothing was written.'));
        setPending(null);
        setDecisions(await loadLogicalItemState({ skipCache: true }));
      } catch (err: any) {
        setError(String(err?.message ?? err));
      } finally {
        setIsBusy(false);
      }
      return;
    }
    if (!pending.row.productId) return;
    const { row } = pending;
    const pair = { productId: row.productId as string, materialId: row.materialId };
    const labels = {
      product: { id: row.productId as string, code: row.productCode, name: row.productName },
      material: { id: row.materialId, code: row.materialCode, name: row.materialName },
    };
    setIsBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (pending.kind === 'MAP') {
        const result = await mapProductToMaterial(pair, labels, { canEdit, reason: row.matchType, language });
        setNotice(result.wrote
          ? (isAr ? `تم الربط كصنف منطقي واحد (${result.logicalItemId}).` : `Mapped as one logical item (${result.logicalItemId}).`)
          : (isAr ? 'مرتبطان بالفعل - لم يُكتب شيء.' : 'Already mapped - nothing was written.'));
      } else if (pending.kind === 'KEEP') {
        const result = await keepProductAndMaterialSeparate(pair, labels, { canEdit, reason: row.matchType, language });
        setNotice(result.wrote ? (isAr ? 'تم تسجيل «إبقاء منفصل».' : 'Kept separate.') : (isAr ? 'مسجل بالفعل - لم يُكتب شيء.' : 'Already recorded - nothing was written.'));
      } else if (pending.kind === 'UNLINK' && pending.targetId) {
        await unlinkLogicalItem(pending.targetId, { canEdit, language });
        setNotice(isAr ? 'تم إلغاء تفعيل الربط.' : 'Mapping deactivated.');
      } else if (pending.kind === 'WITHDRAW' && pending.targetId) {
        await withdrawKeepSeparate(pending.targetId, { canEdit, language });
        setNotice(isAr ? 'تم إلغاء قرار «إبقاء منفصل».' : 'Keep Separate withdrawn.');
      }
      setPending(null);
      setDecisions(await loadLogicalItemState({ skipCache: true }));
    } catch (err: any) {
      setError(String(err?.message ?? err));
    } finally {
      setIsBusy(false);
    }
  };

  const actionButton = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg font-bold cursor-pointer disabled:opacity-50';

  /** A registered / mapped badge, or the Register action, for one record. */
  const registration = (source: LogicalItemSource, record: { id: string; code?: string; name?: string }) => {
    const item = findLogicalItemFor(decisions.items, source, record.id);
    if (item) {
      return (
        <span className="inline-block px-1.5 py-0.5 rounded border font-bold bg-indigo-50 text-indigo-800 border-indigo-200" title={item.id}>
          {source === 'products' ? (isAr ? 'المنتج: صنف منطقي' : 'Product: logical item') : (isAr ? 'الخامة: صنف منطقي' : 'Material: logical item')}
        </span>
      );
    }
    if (!canEdit) return null;
    return (
      <button type="button" disabled={isBusy} onClick={() => setPending({ kind: 'REGISTER', source, record })} className={`${actionButton} text-indigo-800 bg-indigo-50 hover:bg-indigo-100`}>
        {source === 'products' ? (isAr ? 'تسجيل المنتج كصنف منطقي' : 'Register product as Logical Item') : (isAr ? 'تسجيل الخامة كصنف منطقي' : 'Register material as Logical Item')}
      </button>
    );
  };

  return (
    <Modal
      id="item-overlap-review-modal"
      isOpen={isOpen}
      onClose={() => { if (!isBusy) onClose(); }}
      title={isAr ? 'مراجعة تداخل المنتجات والخامات' : 'Products & Materials Overlap Review'}
      subtitle={isAr
        ? 'مطابقة حتمية بالكود والاسم فقط - الربط يتم بقرار صريح ولا يُعدَّل أو يُدمج أي سجل'
        : 'Deterministic code and name matching only - mapping needs an explicit decision, and no record is changed or merged'}
      maxWidth="4xl"
    >
      <div className="space-y-4 text-xs" dir={isAr ? 'rtl' : 'ltr'}>
        <div className="flex items-start gap-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-2.5 text-sky-900">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="font-semibold leading-relaxed">
            {isAr
              ? 'التحليل يقترح فقط؛ لا يتم أي ربط تلقائيًا. «ربط كصنف منطقي واحد» ينشئ هوية مشتركة للمنتج والخامة، و«إبقاء منفصل» يسجل قرار المراجعة - وكلاهما يحتاج تأكيدًا ولا يعدّل أو يحذف أي سجل. المنتج أو الخامة لا يرتبطان بأكثر من صنف منطقي نشط.'
              : 'The analysis only suggests; nothing is mapped automatically. "Map as Same Logical Item" creates one shared identity for the product and material, and "Keep Separate" records the review decision - both need confirmation and neither changes or deletes a record. A product or material belongs to at most one active logical item.'}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-2.5 py-1.5 rounded-lg font-bold cursor-pointer ${filter === f.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={isLoading || isBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            {isAr ? 'تحديث التحليل' : 'Refresh analysis'}
          </button>
        </div>

        {error && (
          <p className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 font-bold text-rose-800">
            {isAr ? `تعذر إكمال العملية: ${error}` : `Could not complete: ${error}`}
          </p>
        )}
        {notice && <p className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 font-bold text-emerald-800">{notice}</p>}

        {/* Explicit confirmation - nothing is written until Confirm. */}
        {pending && (
          <div id="item-overlap-confirm" className="border-2 border-amber-300 bg-amber-50 rounded-xl px-3 py-3 space-y-2">
            <p className="font-bold text-amber-950 leading-relaxed">{confirmText(pending)}</p>
            <div className="flex items-center justify-end gap-2">
              <button type="button" disabled={isBusy} onClick={() => setPending(null)} className="px-3 py-1.5 font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer disabled:opacity-50">
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button id="item-overlap-confirm-btn" type="button" disabled={isBusy} onClick={() => void runPending()} className="px-3 py-1.5 font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-500 rounded-lg cursor-pointer disabled:opacity-50">
                {isBusy ? '…' : (isAr ? 'تأكيد' : 'Confirm')}
              </button>
            </div>
          </div>
        )}

        <div id="item-overlap-summary" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {cards.map((c) => (
            <div key={c.label} className={`rounded-xl px-3 py-2 ${c.tone}`}>
              <p className="text-[10px] font-bold opacity-80">{c.label}</p>
              <p className="text-lg font-black leading-tight">{isLoading && !report ? '…' : (c.value ?? 0)}</p>
            </div>
          ))}
        </div>

        {report && filter !== 'UNMATCHED_PRODUCTS' && (
          <div className="overflow-x-auto max-h-[55vh] overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-[11px] min-w-[1080px]">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="text-slate-600 border-b border-slate-200">
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'كود الخامة' : 'Material Code'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'اسم الخامة' : 'Material Name'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'كود المنتج' : 'Product Code'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'اسم المنتج' : 'Product Name'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'نوع التطابق' : 'Match Type'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'السبب' : 'Reason'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'نوع الصنف' : 'Item Kind'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'القرار المقترح' : 'Suggested Decision'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'القرار' : 'Decision'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="py-6 text-center text-slate-400">{isAr ? 'لا توجد صفوف لهذا الفلتر.' : 'No rows for this filter.'}</td></tr>
                ) : rows.map((r) => {
                  const st = stateOf(r);
                  return (
                    <tr key={`${r.materialId}#${r.productId ?? ''}`}>
                      <td className="py-1.5 px-2.5 font-mono text-slate-800">{r.materialCode || '—'}</td>
                      <td className="py-1.5 px-2.5 text-slate-800">{r.materialName || '—'}</td>
                      <td className="py-1.5 px-2.5 font-mono text-slate-800">{r.productCode || '—'}</td>
                      <td className="py-1.5 px-2.5 text-slate-800">
                        {r.productName || '—'}
                        {r.productIsMixture && <span className="ms-1 text-[9px] font-bold text-purple-700">{isAr ? '(خلطة)' : '(mixture)'}</span>}
                      </td>
                      <td className="py-1.5 px-2.5">
                        <span className={`inline-block px-1.5 py-0.5 rounded border font-bold ${MATCH_LABELS[r.matchType].tone}`}>
                          {isAr ? MATCH_LABELS[r.matchType].ar : MATCH_LABELS[r.matchType].en}
                        </span>
                      </td>
                      <td className="py-1.5 px-2.5 text-slate-600">{isAr ? r.reasonAr : r.reasonEn}</td>
                      <td className="py-1.5 px-2.5 text-slate-600">
                        <div>{isAr ? 'الخامة' : 'Material'}: {kindLabel(r.materialItemKind)}</div>
                        {r.productId && <div>{isAr ? 'المنتج' : 'Product'}: {kindLabel(r.productItemKind)}</div>}
                      </td>
                      <td className="py-1.5 px-2.5 font-bold text-slate-700">
                        {isAr ? ACTION_LABELS[r.recommendedAction].ar : ACTION_LABELS[r.recommendedAction].en}
                      </td>
                      <td className="py-1.5 px-2.5 space-y-1">
                        <span className={`inline-block px-1.5 py-0.5 rounded border font-bold ${STATE_LABELS[st.state].tone}`}>
                          {isAr ? STATE_LABELS[st.state].ar : STATE_LABELS[st.state].en}
                        </span>
                        {st.logicalItemId && <div className="font-mono text-[9px] text-slate-500" title={isAr ? 'الصنف المنطقي' : 'Logical item'}>{st.logicalItemId}</div>}
                        {/* A material with no product counterpart, or a pair kept separate, may be registered on its own. */}
                        {(st.state === 'NO_MATCH' || st.state === 'KEPT_SEPARATE') && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {registration('materials', { id: r.materialId, code: r.materialCode, name: r.materialName })}
                            {st.state === 'KEPT_SEPARATE' && r.productId && registration('products', { id: r.productId, code: r.productCode, name: r.productName })}
                          </div>
                        )}
                        {st.state === 'CONFLICT' && st.plan && <div className="text-[10px] text-rose-700">{isAr ? st.plan.messageAr : st.plan.messageEn}</div>}
                        {canEdit && r.productId && (
                          <div className="flex items-center gap-1 flex-wrap">
                            {(st.state === 'CANDIDATE' || st.state === 'NOT_REVIEWED') && (
                              <>
                                <button type="button" disabled={isBusy} onClick={() => setPending({ kind: 'MAP', row: r })} className={`${actionButton} text-emerald-800 bg-emerald-100 hover:bg-emerald-200`}>
                                  <Link2 className="w-3 h-3" />{isAr ? 'ربط كصنف منطقي واحد' : 'Map as Same Logical Item'}
                                </button>
                                <button type="button" disabled={isBusy} onClick={() => setPending({ kind: 'KEEP', row: r })} className={`${actionButton} text-slate-700 bg-slate-100 hover:bg-slate-200`}>
                                  <SplitSquareHorizontal className="w-3 h-3" />{isAr ? 'إبقاء منفصل' : 'Keep Separate'}
                                </button>
                              </>
                            )}
                            {st.state === 'CONFLICT' && (
                              <button type="button" disabled={isBusy} onClick={() => setPending({ kind: 'KEEP', row: r })} className={`${actionButton} text-slate-700 bg-slate-100 hover:bg-slate-200`}>
                                <SplitSquareHorizontal className="w-3 h-3" />{isAr ? 'إبقاء منفصل' : 'Keep Separate'}
                              </button>
                            )}
                            {st.state === 'MAPPED' && st.logicalItemId && (
                              <button type="button" disabled={isBusy} onClick={() => setPending({ kind: 'UNLINK', row: r, targetId: st.logicalItemId })} className={`${actionButton} text-rose-700 bg-rose-50 hover:bg-rose-100`}>
                                <Unlink className="w-3 h-3" />{isAr ? 'إلغاء الربط' : 'Unlink'}
                              </button>
                            )}
                            {st.state === 'KEPT_SEPARATE' && st.decisionId && (
                              <button type="button" disabled={isBusy} onClick={() => setPending({ kind: 'WITHDRAW', row: r, targetId: st.decisionId })} className={`${actionButton} text-slate-700 bg-slate-100 hover:bg-slate-200`}>
                                {isAr ? 'إلغاء القرار' : 'Withdraw decision'}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {report && filter === 'UNMATCHED_PRODUCTS' && (
          <div className="overflow-x-auto max-h-[55vh] overflow-y-auto border border-slate-200 rounded-xl">
            <table className="w-full text-[11px] min-w-[560px]">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="text-slate-600 border-b border-slate-200">
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'كود المنتج' : 'Product Code'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'اسم المنتج' : 'Product Name'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'نوع الصنف' : 'Item Kind'}</th>
                  <th className="text-start py-2 px-2.5 font-bold">{isAr ? 'الصنف المنطقي' : 'Logical Item'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.unmatchedProducts.length === 0 ? (
                  <tr><td colSpan={4} className="py-6 text-center text-slate-400">{isAr ? 'كل المنتجات لها تطابق.' : 'Every product has a match.'}</td></tr>
                ) : report.unmatchedProducts.map((p) => (
                  <tr key={p.productId}>
                    <td className="py-1.5 px-2.5 font-mono text-slate-800">{p.productCode || '—'}</td>
                    <td className="py-1.5 px-2.5 text-slate-800">
                      {p.productName || '—'}
                      {p.productIsMixture && <span className="ms-1 text-[9px] font-bold text-purple-700">{isAr ? '(خلطة)' : '(mixture)'}</span>}
                    </td>
                    <td className="py-1.5 px-2.5 text-slate-600">{kindLabel(p.productItemKind)}</td>
                    <td className="py-1.5 px-2.5">{registration('products', { id: p.productId, code: p.productCode, name: p.productName })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {s && s.skippedWithoutId > 0 && (
          <p className="text-[11px] text-slate-500">
            {isAr ? `تم تجاهل ${s.skippedWithoutId} سجل بدون معرف.` : `${s.skippedWithoutId} record(s) without an id were left out.`}
          </p>
        )}

        <div className="flex justify-end">
          <button type="button" onClick={onClose} disabled={isBusy} className="flex items-center gap-1.5 px-4 py-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer disabled:opacity-50">
            <GitCompareArrows className="w-3.5 h-3.5" />
            {isAr ? 'إغلاق' : 'Close'}
          </button>
        </div>
      </div>
    </Modal>
  );
};

/**
 * Cost-centre scope selector - shared by the classic Dashboard and the Custom
 * Dashboard Builder.
 *
 * Replaces the flat legacy press list both screens used to show. The options
 * are the imported cost-centre hierarchy, grouped under the existing 5/6/7/8/9
 * classifications, and every node has a checkbox: tick a parent and its whole
 * branch is in scope, tick a leaf and that leaf is the target.
 *
 * Ticking a node ticks its whole branch (and unticking removes it); a parent
 * with only part of its branch ticked shows as indeterminate. Search filters
 * the rows shown - matches plus their path and branch - and never the
 * selection. Every branch, path and child comes from the shared resolver via
 * costCenterDashboardPure, over the hierarchy already loaded: typing and
 * ticking issue no reads and no writes.
 */
import React, { useMemo, useState } from 'react';
import { Layers, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { HierarchyIndex, getChildIds } from '../../services/hierarchyResolverPure';
import {
  classificationGroups,
  costCenterCheckState,
  effectiveCostCenterSelection,
  searchCostCenterNodes,
  selectAllCostCenterNodes,
  toggleCostCenterNode,
} from '../../services/costCenterDashboardPure';

interface CostCenterScopeSelectorProps {
  index: HierarchyIndex<any>;
  selectedNodeIds: string[];
  onChange: (nodeIds: string[]) => void;
  language: 'ar' | 'en';
  /** Visual variant - the classic Dashboard sits on a dark bar, the Builder on light. */
  tone?: 'dark' | 'light';
  /** Fill the width of its container - used when the selector sits in a filter grid cell. */
  block?: boolean;
}

const labelOf = (node: any): string => String(node?.name || node?.sheet1Code || node?.code || node?.id || '');
const codeOf = (node: any): string => String(node?.sheet1Code ?? node?.code ?? node?.id ?? '');

export const CostCenterScopeSelector: React.FC<CostCenterScopeSelectorProps> = ({
  index, selectedNodeIds, onChange, language, tone = 'light', block = false,
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const isAr = language === 'ar';
  const groups = useMemo(() => classificationGroups(index, codeOf), [index]);

  /* The selection expanded to every node it covers - drives the tick states. */
  const effective = useMemo(() => effectiveCostCenterSelection(index, selectedNodeIds), [index, selectedNodeIds]);
  const { matchedIds, visibleIds } = useMemo(() => searchCostCenterNodes(index, query), [index, query]);
  const isVisible = (id: string) => visibleIds == null || visibleIds.has(id);

  /* Branches are resolved against the FULL index, so a search never narrows what a tick selects. */
  const toggle = (id: string) => onChange(toggleCostCenterNode(index, selectedNodeIds, id));

  /* Select All = every classified root, or every match while searching. */
  const selectAllTargets = useMemo(
    () => (visibleIds == null ? groups.flatMap((g) => g.rootIds) : [...matchedIds]),
    [groups, visibleIds, matchedIds],
  );

  /** Renders one node and its children that the search leaves visible. Depth is whatever the data has. */
  const renderNode = (id: string, depth: number): React.ReactNode => {
    const node = index.byId.get(id);
    if (!node || !isVisible(id)) return null;
    const children = getChildIds(index, id).filter(isVisible);
    const state = costCenterCheckState(index, effective, id);
    const isMatch = visibleIds != null && matchedIds.has(id);
    return (
      <div key={id}>
        <label
          className={`flex items-center gap-1.5 py-0.5 text-[11px] cursor-pointer ${isMatch ? 'font-black text-slate-900' : 'font-semibold text-slate-700'}`}
          style={{ paddingInlineStart: `${depth * 14}px` }}
        >
          <input
            type="checkbox"
            className="w-3.5 h-3.5 accent-sky-600 cursor-pointer shrink-0"
            data-node-id={id}
            data-state={state}
            checked={state === 'checked'}
            ref={(el) => { if (el) el.indeterminate = state === 'indeterminate'; }}
            aria-checked={state === 'indeterminate' ? 'mixed' : state === 'checked'}
            onChange={() => toggle(id)}
          />
          <span className={`truncate ${isMatch ? 'bg-amber-100 rounded px-0.5' : ''}`}>{labelOf(node)}</span>
          <span className="text-[9px] text-slate-400 font-mono shrink-0">{codeOf(node)}</span>
        </label>
        {children.map((childId) => renderNode(childId, depth + 1))}
      </div>
    );
  };

  const visibleGroups = groups
    .map((group) => ({ ...group, rootIds: group.rootIds.filter(isVisible) }))
    .filter((group) => visibleIds == null || group.rootIds.length > 0);

  const buttonClass = tone === 'dark'
    ? 'bg-slate-800 text-slate-200 border border-slate-700'
    : 'bg-white text-slate-700 border border-slate-200';

  return (
    <div className={`relative ${block ? 'w-full' : ''}`} id="cost-center-scope-selector">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-bold cursor-pointer ${block ? 'w-full' : ''} ${buttonClass}`}
      >
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span className={`truncate ${block ? 'flex-1 text-start' : ''}`}>
          {selectedNodeIds.length === 0
            ? (isAr ? 'كل مراكز التكاليف' : 'All cost centres')
            : (isAr ? `مراكز التكاليف (${selectedNodeIds.length})` : `Cost centres (${selectedNodeIds.length})`)}
        </span>
        {open ? <ChevronUp className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
      </button>

      {open && (
        <div
          id="cost-center-scope-panel"
          className="absolute z-40 mt-1 start-0 w-[24rem] min-w-full max-w-[90vw] max-h-[26rem] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg p-2.5 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black text-slate-500">
              {isAr ? 'اختر مركزًا أو أكثر - الأصل يشمل كل الفروع' : 'Pick one or more - a parent includes every branch'}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                id="cost-center-scope-select-all"
                type="button"
                onClick={() => onChange(selectAllCostCenterNodes(index, selectedNodeIds, selectAllTargets))}
                disabled={selectAllTargets.length === 0}
                className="text-[10px] font-bold text-sky-700 disabled:opacity-40 cursor-pointer"
              >
                {isAr ? 'تحديد الكل' : 'Select all'}
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                disabled={selectedNodeIds.length === 0}
                className="text-[10px] font-bold text-amber-700 disabled:opacity-40 cursor-pointer"
              >
                {isAr ? 'مسح' : 'Clear'}
              </button>
            </div>
          </div>

          {/* Search - filters the rows shown, never the selection. */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2 pointer-events-none" />
            <input
              id="cost-center-scope-search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isAr ? 'ابحث بالكود أو الاسم' : 'Search by code or name'}
              aria-label={isAr ? 'بحث' : 'Search'}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg ps-7 pe-7 py-1.5 text-[11px] font-semibold text-slate-800"
            />
            {query && (
              <button
                id="cost-center-scope-search-clear"
                type="button"
                onClick={() => setQuery('')}
                className="absolute top-1/2 -translate-y-1/2 end-1.5 p-0.5 text-slate-400 hover:text-slate-700 cursor-pointer"
                title={isAr ? 'مسح البحث' : 'Clear search'}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {index.size === 0 ? (
            <p className="text-[11px] text-slate-500 py-2">
              {isAr ? 'لا توجد مراكز تكاليف مستوردة بعد.' : 'No cost centres have been imported yet.'}
            </p>
          ) : visibleGroups.length === 0 ? (
            <p className="text-[11px] text-slate-500 py-2">
              {isAr ? 'لا توجد نتائج مطابقة.' : 'No matching cost centres.'}
            </p>
          ) : (
            visibleGroups.map((group) => (
              <div key={group.digit} className="border-t border-slate-100 pt-1.5">
                <p className="text-[10px] font-black text-slate-600 mb-0.5">
                  {`${group.digit} — ${group.labelAr}`}
                  <span className="text-slate-400 font-semibold">{` (${group.rootIds.length})`}</span>
                </p>
                {group.rootIds.length === 0 ? (
                  <p className="text-[10px] text-slate-400">{isAr ? 'لا توجد مراكز' : 'None'}</p>
                ) : (
                  group.rootIds.map((id) => renderNode(id, 0))
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

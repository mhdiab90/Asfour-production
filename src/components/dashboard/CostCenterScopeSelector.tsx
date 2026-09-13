/**
 * Cost-centre scope selector - shared by the classic Dashboard and the Custom
 * Dashboard Builder.
 *
 * Replaces the flat legacy press list both screens used to show. The options
 * are the imported cost-centre hierarchy, grouped under the existing 5/6/7/8/9
 * classifications, and every node has a checkbox: tick a parent and its whole
 * branch is in scope, tick a leaf and that leaf is the target.
 *
 * This component only records WHICH nodes are ticked. What a ticked parent
 * covers is decided by the shared resolver, never here - so the Dashboard and
 * the Builder cannot drift apart on what a selection means.
 */
import React, { useMemo, useState } from 'react';
import { Layers, ChevronDown, ChevronUp } from 'lucide-react';
import { HierarchyIndex, getChildIds } from '../../services/hierarchyResolverPure';
import { classificationGroups } from '../../services/costCenterDashboardPure';

interface CostCenterScopeSelectorProps {
  index: HierarchyIndex<any>;
  selectedNodeIds: string[];
  onChange: (nodeIds: string[]) => void;
  language: 'ar' | 'en';
  /** Visual variant - the classic Dashboard sits on a dark bar, the Builder on light. */
  tone?: 'dark' | 'light';
}

const labelOf = (node: any): string => String(node?.name || node?.sheet1Code || node?.code || node?.id || '');
const codeOf = (node: any): string => String(node?.sheet1Code ?? node?.code ?? node?.id ?? '');

export const CostCenterScopeSelector: React.FC<CostCenterScopeSelectorProps> = ({
  index, selectedNodeIds, onChange, language, tone = 'light',
}) => {
  const [open, setOpen] = useState(false);
  const isAr = language === 'ar';
  const selected = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const groups = useMemo(() => classificationGroups(index, codeOf), [index]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  /** Renders one node and, when expanded, its direct children. Depth is whatever the data has. */
  const renderNode = (id: string, depth: number): React.ReactNode => {
    const node = index.byId.get(id);
    if (!node) return null;
    const children = getChildIds(index, id);
    return (
      <div key={id}>
        <label
          className="flex items-center gap-1.5 py-0.5 text-[11px] font-semibold text-slate-700 cursor-pointer"
          style={{ paddingInlineStart: `${depth * 14}px` }}
        >
          <input
            type="checkbox"
            className="w-3.5 h-3.5 accent-sky-600 cursor-pointer shrink-0"
            checked={selected.has(id)}
            onChange={() => toggle(id)}
          />
          <span className="truncate">{labelOf(node)}</span>
          <span className="text-[9px] text-slate-400 font-mono shrink-0">{codeOf(node)}</span>
        </label>
        {children.map((childId) => renderNode(childId, depth + 1))}
      </div>
    );
  };

  const buttonClass = tone === 'dark'
    ? 'bg-slate-800 text-slate-200 border border-slate-700'
    : 'bg-white text-slate-700 border border-slate-200';

  return (
    <div className="relative" id="cost-center-scope-selector">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-bold cursor-pointer ${buttonClass}`}
      >
        <Layers className="w-3.5 h-3.5" />
        <span>
          {selectedNodeIds.length === 0
            ? (isAr ? 'كل مراكز التكاليف' : 'All cost centres')
            : (isAr ? `مراكز التكاليف (${selectedNodeIds.length})` : `Cost centres (${selectedNodeIds.length})`)}
        </span>
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-72 max-w-[85vw] max-h-80 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg p-2 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black text-slate-500">
              {isAr ? 'اختر مركزًا أو أكثر - الأصل يشمل كل الفروع' : 'Pick one or more - a parent includes every branch'}
            </span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selectedNodeIds.length === 0}
              className="text-[10px] font-bold text-amber-700 disabled:opacity-40 cursor-pointer"
            >
              {isAr ? 'مسح' : 'Clear'}
            </button>
          </div>

          {index.size === 0 ? (
            <p className="text-[11px] text-slate-500 py-2">
              {isAr ? 'لا توجد مراكز تكاليف مستوردة بعد.' : 'No cost centres have been imported yet.'}
            </p>
          ) : (
            groups.map((group) => (
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

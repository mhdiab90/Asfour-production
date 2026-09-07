/**
 * Saved Dashboards Manager (Part 3 §9-14) - the full management view for
 * every dashboard/report the user has saved: name, description, owner,
 * created/updated dates, default/favorite/shared status, and per-row
 * Open/Rename/Duplicate/Set-Default/Favorite/Delete actions plus
 * multi-select bulk delete. All actions are thin wrappers over
 * dashboardPersistenceService.ts - this component owns no persistence
 * logic of its own.
 */
import React, { useState } from 'react';
import { Star, Copy, Trash2, Pencil, Check, FolderOpen, FileBarChart2 } from 'lucide-react';
import { DashboardLayout } from '../../services/dashboardRegistry';

interface SavedDashboardsManagerProps {
  dashboards: DashboardLayout[];
  activeId: string | null;
  defaultDashboardId: string | null;
  language: 'ar' | 'en';
  canDelete: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onSetDefault: (id: string) => void;
  onToggleFavorite: (id: string, next: boolean) => void;
  onDelete: (id: string) => void;
  onBulkDelete: (ids: string[]) => void;
}

export const SavedDashboardsManager: React.FC<SavedDashboardsManagerProps> = ({
  dashboards, activeId, defaultDashboardId, language, canDelete,
  onOpen, onRename, onDuplicate, onSetDefault, onToggleFavorite, onDelete, onBulkDelete,
}) => {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const t = {
    name: language === 'ar' ? 'الاسم' : 'Name',
    description: language === 'ar' ? 'الوصف' : 'Description',
    owner: language === 'ar' ? 'المالك' : 'Owner',
    updated: language === 'ar' ? 'آخر تحديث' : 'Last Updated',
    created: language === 'ar' ? 'تاريخ الإنشاء' : 'Created',
    status: language === 'ar' ? 'الحالة' : 'Status',
    actions: language === 'ar' ? 'الإجراءات' : 'Actions',
    default: language === 'ar' ? 'افتراضي' : 'Default',
    report: language === 'ar' ? 'تقرير' : 'Report',
    open: language === 'ar' ? 'فتح' : 'Open',
    rename: language === 'ar' ? 'إعادة تسمية' : 'Rename',
    duplicate: language === 'ar' ? 'نسخ' : 'Duplicate',
    setDefault: language === 'ar' ? 'تعيين كافتراضي' : 'Set Default',
    delete: language === 'ar' ? 'حذف' : 'Delete',
    deleteSelected: language === 'ar' ? 'حذف المحدد' : 'Delete Selected',
    noDashboards: language === 'ar' ? 'لا توجد لوحات محفوظة بعد.' : 'No saved dashboards yet.',
    confirmDelete: language === 'ar'
      ? 'سيتم حذف لوحة المعلومات المحفوظة. لن يتم حذف بيانات الإنتاج أو البيانات الأساسية. هل تريد المتابعة؟'
      : 'This will delete the saved dashboard configuration only. Production and Master Data will not be deleted. Continue?',
    confirmBulkDelete: (n: number) => language === 'ar'
      ? `اللوحات المحددة: ${n}. سيتم حذف تكوين اللوحات فقط، دون التأثير على أي بيانات إنتاج أو بيانات أساسية. هل تريد المتابعة؟`
      : `Selected Dashboards: ${n}. Only the saved dashboard configurations will be deleted - no production or master data is affected. Continue?`,
  };

  const sorted = [...dashboards].sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0) || b.updatedAt.localeCompare(a.updatedAt));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (selected.size === 0) return;
    if (!window.confirm(t.confirmBulkDelete(selected.size))) return;
    onBulkDelete(Array.from(selected));
    setSelected(new Set());
  };

  const handleSingleDelete = (id: string) => {
    if (!window.confirm(t.confirmDelete)) return;
    onDelete(id);
    setSelected((prev) => { const n = new Set(prev); n.delete(id); return n; });
  };

  if (dashboards.length === 0) {
    return <p className="text-xs text-slate-400 text-center py-6">{t.noDashboards}</p>;
  }

  return (
    <div className="space-y-3" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      {canDelete && selected.size > 0 && (
        <div className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded px-3 py-2">
          <span className="text-xs font-bold text-rose-700">{selected.size}</span>
          <button type="button" onClick={handleBulkDelete} className="flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded cursor-pointer">
            <Trash2 className="w-3.5 h-3.5" />{t.deleteSelected}
          </button>
        </div>
      )}
      <div className="space-y-2 max-h-[55vh] overflow-y-auto">
        {sorted.map((d) => (
          <div key={d.dashboardId} className={`border rounded p-3 ${d.dashboardId === activeId ? 'border-indigo-400 bg-indigo-50/40' : 'border-slate-200'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2 min-w-0">
                {canDelete && (
                  <input type="checkbox" checked={selected.has(d.dashboardId)} onChange={() => toggleSelect(d.dashboardId)} className="mt-1 cursor-pointer" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button type="button" onClick={() => onOpen(d.dashboardId)} className="text-sm font-bold text-slate-800 hover:text-indigo-600 cursor-pointer truncate">{d.name}</button>
                    {d.isReport && <span title={t.report}><FileBarChart2 className="w-3 h-3 text-violet-500 shrink-0" /></span>}
                    {d.dashboardId === defaultDashboardId && <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-600 text-[9px] font-bold rounded shrink-0">{t.default}</span>}
                  </div>
                  {d.description && <p className="text-[11px] text-slate-500 mt-0.5">{d.description}</p>}
                  <p className="text-[10px] text-slate-400 mt-1">
                    {t.owner}: {d.ownerName || '-'} · {t.created}: {d.createdAt.slice(0, 10)} · {t.updated}: {d.updatedAt.slice(0, 10)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => onToggleFavorite(d.dashboardId, !d.isFavorite)} className={`p-1 cursor-pointer ${d.isFavorite ? 'text-amber-500' : 'text-slate-300 hover:text-amber-500'}`} title="Favorite">
                  <Star className={`w-3.5 h-3.5 ${d.isFavorite ? 'fill-amber-400' : ''}`} />
                </button>
                <button type="button" onClick={() => onOpen(d.dashboardId)} className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer" title={t.open}><FolderOpen className="w-3.5 h-3.5" /></button>
                <button
                  type="button"
                  onClick={() => { const n = window.prompt(t.rename, d.name); if (n && n.trim()) onRename(d.dashboardId, n.trim()); }}
                  className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer" title={t.rename}
                ><Pencil className="w-3.5 h-3.5" /></button>
                <button type="button" onClick={() => onDuplicate(d.dashboardId)} className="p-1 text-slate-400 hover:text-indigo-600 cursor-pointer" title={t.duplicate}><Copy className="w-3.5 h-3.5" /></button>
                {d.dashboardId !== defaultDashboardId && (
                  <button type="button" onClick={() => onSetDefault(d.dashboardId)} className="p-1 text-slate-400 hover:text-amber-500 cursor-pointer" title={t.setDefault}><Check className="w-3.5 h-3.5" /></button>
                )}
                {canDelete && (
                  <button type="button" onClick={() => handleSingleDelete(d.dashboardId)} className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer" title={t.delete}><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

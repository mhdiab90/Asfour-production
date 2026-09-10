/**
 * Change Registry panel (Layer 3 of the release chain).
 *
 * Kept as its own component rather than growing SystemVersionManagementView,
 * which already owns Layers 1-2 (version history, health, rollback). This
 * panel only reads/filters the registry and shows a single change's boundary.
 *
 * READ DISCIPLINE: nothing loads until this screen is opened, the list is
 * paged, and a change's detail comes from the row already in memory - there is
 * no per-row fetch. Editing/approval happens through changeRegistryService,
 * which enforces immutability; this panel never writes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Filter, Loader2, Lock, Search, ShieldAlert, X } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import {
  CHANGE_STATUSES,
  CHANGE_TYPES,
  ChangeRecord,
  ReleaseRecord,
  isFrozen,
} from '../../services/changeRegistryPure';
import { isPermissionDeniedError, listChanges, listReleases } from '../../services/changeRegistryService';

function t(ar: string, en: string, language: 'ar' | 'en'): string {
  return language === 'ar' ? ar : en;
}

const STATUS_TONE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-600 border-slate-300',
  READY_FOR_REVIEW: 'bg-amber-50 text-amber-700 border-amber-300',
  APPROVED: 'bg-sky-50 text-sky-700 border-sky-300',
  RELEASED: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  INACTIVE: 'bg-slate-100 text-slate-500 border-slate-300',
  ROLLED_BACK: 'bg-red-50 text-red-700 border-red-300',
  DEPRECATED: 'bg-slate-100 text-slate-400 border-slate-200',
  FAILED: 'bg-red-50 text-red-700 border-red-300',
};

const RISK_TONE: Record<string, string> = {
  LOW: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  MEDIUM: 'bg-amber-50 text-amber-700 border-amber-300',
  HIGH: 'bg-red-50 text-red-700 border-red-300',
};

const PAGE_SIZE = 25;

/** A labelled block of the change's boundary; empty lists say so rather than rendering nothing. */
const Field: React.FC<{ label: string; children?: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1">
    <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
    <div className="text-xs text-slate-700 break-words">{children}</div>
  </div>
);

const List: React.FC<{ items?: string[]; empty: string; mono?: boolean }> = ({ items, empty, mono }) => {
  if (!items || items.length === 0) return <span className="text-slate-400">{empty}</span>;
  return (
    <ul className="space-y-0.5">
      {items.map((v) => (
        <li key={v} className={mono ? 'font-mono text-[11px]' : ''}>{v}</li>
      ))}
    </ul>
  );
};

export const ChangeRegistryPanel: React.FC = () => {
  const { language } = useLanguage();
  const [state, setState] = useState<'LOADING' | 'PERMISSION_DENIED' | 'FAILED' | 'READY'>('LOADING');
  const [changes, setChanges] = useState<ChangeRecord[]>([]);
  const [releases, setReleases] = useState<ReleaseRecord[]>([]);
  const [detail, setDetail] = useState<ChangeRecord | null>(null);

  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [release, setRelease] = useState('all');
  const [module, setModule] = useState('all');
  const [version, setVersion] = useState('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, r] = await Promise.all([listChanges(), listReleases()]);
        if (cancelled) return;
        setChanges(c);
        setReleases(r);
        setState('READY');
      } catch (err) {
        if (cancelled) return;
        setState(isPermissionDeniedError(err) ? 'PERMISSION_DENIED' : 'FAILED');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const modules = useMemo(
    () => [...new Set(changes.flatMap((c) => c.affectedModules ?? []))].sort(),
    [changes],
  );
  const versions = useMemo(
    () => [...new Set(changes.map((c) => c.version).filter(Boolean))].sort().reverse(),
    [changes],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return changes.filter((c) => {
      if (q && !(c.changeId.toLowerCase().includes(q) || (c.title ?? '').toLowerCase().includes(q))) return false;
      if (type !== 'all' && c.type !== type) return false;
      if (status !== 'all' && c.status !== status) return false;
      if (release !== 'all' && c.releaseId !== release) return false;
      if (version !== 'all' && c.version !== version) return false;
      if (module !== 'all' && !(c.affectedModules ?? []).includes(module)) return false;
      return true;
    });
  }, [changes, search, type, status, release, version, module]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  useEffect(() => { setPage(0); }, [search, type, status, release, version, module]);

  if (state === 'LOADING') {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('جارٍ تحميل سجل التغييرات...', 'Loading the Change Registry...', language)}
      </div>
    );
  }

  if (state === 'PERMISSION_DENIED') {
    return (
      <div className="bg-white rounded-2xl border border-amber-200 shadow-xs p-5 space-y-1">
        <h2 className="text-sm font-black text-amber-800 flex items-center gap-2"><Lock className="w-4 h-4" />{t('صلاحية غير كافية', 'Insufficient permission', language)}</h2>
        <p className="text-xs text-slate-600">
          {t('سجل التغييرات متاح لمديري النظام فقط (صلاحية إدارة إصدارات النظام).',
             'The Change Registry is visible to system administrators only (system version management permission).', language)}
        </p>
      </div>
    );
  }

  if (state === 'FAILED') {
    return (
      <div className="bg-white rounded-2xl border border-red-200 shadow-xs p-5 space-y-1">
        <h2 className="text-sm font-black text-red-700 flex items-center gap-2"><ShieldAlert className="w-4 h-4" />{t('تعذر تحميل سجل التغييرات', 'Could not load the Change Registry', language)}</h2>
        <p className="text-xs text-slate-600">
          {t('هوية الإصدار المعروضة أعلاه لا تعتمد على قاعدة البيانات وتظل صحيحة.',
             'The build identity shown above does not depend on the database and remains accurate.', language)}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-slate-600" />
          {t('سجل التغييرات', 'Change Registry', language)}
          <span className="text-[11px] font-bold text-slate-400">({filtered.length})</span>
        </h2>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute top-1/2 -translate-y-1/2 start-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('بحث بالكود أو العنوان', 'Search by Change ID or title', language)}
            className="text-xs border border-slate-300 rounded-lg ps-8 pe-2.5 py-1.5 w-64"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <Filter className="w-3.5 h-3.5 text-slate-400" />
        {([
          [t('النوع', 'Type', language), type, setType, ['all', ...CHANGE_TYPES]],
          [t('الحالة', 'Status', language), status, setStatus, ['all', ...CHANGE_STATUSES]],
          [t('الإصدار', 'Version', language), version, setVersion, ['all', ...versions]],
          [t('الإطلاق', 'Release', language), release, setRelease, ['all', ...releases.map((r) => r.releaseId)]],
          [t('الوحدة', 'Module', language), module, setModule, ['all', ...modules]],
        ] as Array<[string, string, (v: string) => void, string[]]>).map(([label, value, set, options]) => (
          <label key={label} className="flex items-center gap-1">
            <span className="text-slate-500 font-bold">{label}</span>
            <select value={value} onChange={(e) => set(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 bg-white">
              {options.map((o) => <option key={o} value={o}>{o === 'all' ? t('الكل', 'All', language) : o}</option>)}
            </select>
          </label>
        ))}
      </div>

      {changes.length === 0 ? (
        <p className="text-xs text-slate-500 py-4">
          {t('لا توجد سجلات تغيير بعد. تُنشأ السجلات عند اعتماد تغيير وربطه بإطلاق.',
             'No change records yet. Records are created when a change is registered and associated with a release.', language)}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[860px]">
              <thead>
                <tr className="text-[11px] text-slate-500 border-b border-slate-100">
                  <th className="text-start py-2 font-bold">{t('الكود', 'Change ID', language)}</th>
                  <th className="text-start py-2 font-bold">{t('العنوان', 'Title', language)}</th>
                  <th className="text-start py-2 font-bold">{t('النوع', 'Type', language)}</th>
                  <th className="text-start py-2 font-bold">{t('الوحدة', 'Module', language)}</th>
                  <th className="text-start py-2 font-bold">{t('الحالة', 'Status', language)}</th>
                  <th className="text-start py-2 font-bold">{t('الخطورة', 'Risk', language)}</th>
                  <th className="text-start py-2 font-bold">{t('الإطلاق', 'Release', language)}</th>
                  <th className="text-start py-2 font-bold">{t('التاريخ', 'Date', language)}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((c) => (
                  <tr key={c.changeId} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="py-2">
                      <button type="button" onClick={() => setDetail(c)} className="font-mono font-bold text-sky-700 underline cursor-pointer">{c.changeId}</button>
                      {isFrozen(c.status) && <Lock className="inline w-3 h-3 text-slate-400 ms-1" />}
                    </td>
                    <td className="py-2 text-slate-800">{c.title}</td>
                    <td className="py-2 text-slate-600">{c.type}</td>
                    <td className="py-2 text-slate-600">{c.module}</td>
                    <td className="py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_TONE[c.status] ?? ''}`}>{c.status}</span></td>
                    <td className="py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${RISK_TONE[c.risk] ?? ''}`}>{c.risk}</span></td>
                    <td className="py-2 font-mono text-slate-500">{c.releaseId ?? '-'}</td>
                    <td className="py-2 text-slate-500">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-end gap-2 text-[11px]">
              <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-40 cursor-pointer">{t('السابق', 'Previous', language)}</button>
              <span className="text-slate-500">{page + 1} / {pageCount}</span>
              <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 rounded border border-slate-300 disabled:opacity-40 cursor-pointer">{t('التالي', 'Next', language)}</button>
            </div>
          )}
        </>
      )}

      {/* Bounded view: everything that belongs to this change, without searching the repo. */}
      {detail && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-mono text-lg font-black text-slate-900">{detail.changeId}</div>
                <div className="text-sm text-slate-700">{detail.title}</div>
              </div>
              <button type="button" onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label={t('الإطلاق', 'Release', language)}>{detail.releaseId ?? '-'}</Field>
              <Field label={t('الإصدار', 'Version', language)}>{detail.version}</Field>
              <Field label={t('النوع', 'Type', language)}>{detail.type}</Field>
              <Field label={t('الحالة', 'Status', language)}>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${STATUS_TONE[detail.status] ?? ''}`}>{detail.status}</span>
                {isFrozen(detail.status) && (
                  <span className="ms-2 text-[10px] text-slate-500">{t('محفوظ - لا يمكن تعديل السجل التاريخي', 'Frozen - historical record is immutable', language)}</span>
                )}
              </Field>
              <Field label={t('الخطورة', 'Risk', language)}>{detail.risk}</Field>
              <Field label={t('أثر قاعدة البيانات', 'Firestore impact', language)}>{detail.firestoreImpact}</Field>
              <Field label={t('ترحيل مطلوب', 'Migration required', language)}>{detail.migrationRequired ? t('نعم', 'Yes', language) : t('لا', 'No', language)}</Field>
              <Field label={t('طريقة التراجع', 'Rollback method', language)}>{detail.rollbackMethod}</Field>
              <Field label={t('خاصية قابلة للتعطيل', 'Feature flag', language)}>{detail.featureFlag ?? '-'}</Field>
              <Field label={t('كود الالتزام', 'Commit', language)}><span className="font-mono">{detail.commitHash ? detail.commitHash.slice(0, 12) : '-'}</span></Field>
              <Field label={t('معرف النشر', 'Deployment', language)}><span className="font-mono">{detail.deploymentId ?? '-'}</span></Field>
              <Field label={t('أنشئ بواسطة', 'Created by', language)}>{detail.createdBy}</Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
              <Field label={t('الملخص', 'Summary', language)}>{detail.summary}</Field>
              <Field label={t('السبب', 'Reason', language)}>{detail.reason}</Field>
              {detail.detailedDescription && (
                <div className="md:col-span-2"><Field label={t('التفاصيل', 'Details', language)}>{detail.detailedDescription}</Field></div>
              )}
              <Field label={t('الوحدات المتأثرة', 'Affected modules', language)}><List items={detail.affectedModules} empty="-" /></Field>
              <Field label={t('الصلاحيات المتأثرة', 'Affected permissions', language)}><List items={detail.affectedPermissions} empty={t('لا شيء', 'None', language)} mono /></Field>
              <div className="md:col-span-2">
                <Field label={t('الملفات المتأثرة', 'Affected files', language)}><List items={detail.affectedFiles} empty="-" mono /></Field>
              </div>
              <Field label={t('الاختبارات', 'Tests', language)}><List items={detail.tests} empty="-" mono /></Field>
              <Field label={t('الاعتماديات', 'Dependencies', language)}><List items={detail.dependencies} empty={t('لا شيء', 'None', language)} mono /></Field>
              {detail.parentChangeId && <Field label={t('التغيير الأصلي', 'Parent change', language)}><span className="font-mono">{detail.parentChangeId}</span></Field>}
              <Field label={t('تغييرات مرتبطة', 'Related changes', language)}><List items={detail.relatedChanges} empty={t('لا شيء', 'None', language)} mono /></Field>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Translation Manager (§8-16 of the localization task) - "مدير الترجمة".
 *
 * Lets an authorized admin search every translation key, see its current
 * Arabic/English value (default from ar.ts/en.ts, or a live admin
 * override), edit either language, restore the default, and view the
 * change history. Never rewrites ar.ts/en.ts - every edit is an override
 * document layered on top by LanguageContext.tsx's t() (§11).
 */
import React, { useState, useMemo } from 'react';
import { Languages, Search, Pencil, RotateCcw, History, X, Check, BookOpen } from 'lucide-react';
import { ar } from '../../i18n/ar';
import { en } from '../../i18n/en';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { Modal } from '../common/Modal';
import { Badge } from '../common/Badge';
import {
  setTranslationOverride, restoreDefaultTranslation, getTranslationHistory,
} from '../../services/translationOverrideService';
import { AuditLog } from '../../types';
import keyUsageMap from '../../i18n/keyUsageMap.generated.json';
import { TERMINOLOGY_GLOSSARY } from '../../i18n/glossary';

interface TranslationRow {
  key: string;
  arDefault: string;
  enDefault: string;
  arValue: string;
  enValue: string;
  arIsCustom: boolean;
  enIsCustom: boolean;
  usedIn: string[];
}

const usageMap = keyUsageMap as unknown as Record<string, { file: string; screen: string }[]>;

/** Session-local handoff from the Language Audit screen's "Search in Translation Manager" action - not persisted beyond the current tab session. */
export const TRANSLATION_MANAGER_PREFILL_KEY = 'asfour_translation_manager_prefill';

export const TranslationManagerView: React.FC = () => {
  // PHASE 4E: allOverrides (both ar and en, unfiltered) now comes from
  // LanguageContext's own already-live translationOverrides subscription
  // instead of opening a second, independent onSnapshot on the identical
  // collection - LanguageContext already holds this exact same map
  // in-memory for every signed-in user (see LanguageContext.tsx), it just
  // didn't expose the unfiltered map through context until now.
  const { language, isRtl, allOverrides } = useLanguage();
  const { isSuperAdmin, hasPermission } = useAuth();
  const canManage = isSuperAdmin || hasPermission('translation.manage');

  const [query, setQuery] = useState(() => {
    try {
      const prefill = sessionStorage.getItem(TRANSLATION_MANAGER_PREFILL_KEY);
      if (prefill) sessionStorage.removeItem(TRANSLATION_MANAGER_PREFILL_KEY);
      return prefill || '';
    } catch {
      return '';
    }
  });
  const [filterSource, setFilterSource] = useState<'all' | 'custom' | 'default'>('all');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const rows: TranslationRow[] = useMemo(() => {
    const arKeys = Object.keys(ar);
    return arKeys.map((key) => {
      const arOverride = allOverrides[`ar__${key}`];
      const enOverride = allOverrides[`en__${key}`];
      return {
        key,
        arDefault: (ar as Record<string, string>)[key] || '',
        enDefault: (en as Record<string, string>)[key] || '',
        arValue: arOverride?.value ?? ((ar as Record<string, string>)[key] || ''),
        enValue: enOverride?.value ?? ((en as Record<string, string>)[key] || ''),
        arIsCustom: !!arOverride,
        enIsCustom: !!enOverride,
        usedIn: (usageMap[key] || []).map((u) => u.screen),
      };
    });
  }, [allOverrides]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterSource === 'custom' && !r.arIsCustom && !r.enIsCustom) return false;
      if (filterSource === 'default' && (r.arIsCustom || r.enIsCustom)) return false;
      if (!q) return true;
      return r.key.toLowerCase().includes(q) || r.arValue.includes(query) || r.enValue.toLowerCase().includes(q);
    });
  }, [rows, query, filterSource]);

  const t = {
    title: language === 'ar' ? 'مدير الترجمة' : 'Translation Manager',
    subtitle: language === 'ar' ? 'ابحث، عدّل، واستعد الترجمات الافتراضية دون تعديل الشيفرة المصدرية' : 'Search, edit, and restore translations without touching source code',
    searchPlaceholder: language === 'ar' ? 'ابحث بالمفتاح أو النص العربي أو الإنجليزي...' : 'Search by key, Arabic text, or English text...',
    all: language === 'ar' ? 'الكل' : 'All',
    custom: language === 'ar' ? 'مخصص' : 'Custom',
    default: language === 'ar' ? 'افتراضي' : 'Default',
    key: language === 'ar' ? 'المفتاح' : 'Key',
    arabic: language === 'ar' ? 'العربية' : 'Arabic',
    english: language === 'ar' ? 'الإنجليزية' : 'English',
    source: language === 'ar' ? 'المصدر' : 'Source',
    actions: language === 'ar' ? 'الإجراءات' : 'Actions',
    edit: language === 'ar' ? 'تعديل' : 'Edit',
    noAccess: language === 'ar' ? 'لا تملك صلاحية إدارة الترجمات. تواصل مع المسؤول.' : 'You do not have permission to manage translations. Contact your administrator.',
    noResults: language === 'ar' ? 'لا توجد نتائج مطابقة.' : 'No matching results.',
    resultCount: language === 'ar' ? 'مفتاح' : 'keys',
    glossaryNote: language === 'ar' ? 'راجع قسم "المصطلحات المعتمدة" أدناه للحصول على الترجمة القياسية للمصطلحات الأساسية.' : 'See the "Approved Terminology" section below for standard translations of core business terms.',
  };

  if (!canManage) {
    return (
      <div className="p-10 text-center text-sm text-slate-500 bg-white border border-slate-200" dir={isRtl ? 'rtl' : 'ltr'}>
        <Languages className="w-8 h-8 mx-auto mb-3 text-slate-300" />
        {t.noAccess}
      </div>
    );
  }

  return (
    <div className="space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Languages className="w-5 h-5 text-indigo-600" />{t.title}</h1>
        <p className="text-xs text-slate-500 mt-0.5">{t.subtitle}</p>
      </div>

      <div className="bg-white border border-slate-200 shadow-xs p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.searchPlaceholder} className="w-full border border-slate-200 rounded ps-9 pe-3 py-2 text-sm" />
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded text-xs font-bold">
          {(['all', 'custom', 'default'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilterSource(f)} className={`px-2.5 py-1 rounded cursor-pointer ${filterSource === f ? 'bg-white text-indigo-600 shadow-xs' : 'text-slate-500'}`}>
              {t[f]}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-slate-400 whitespace-nowrap">{filteredRows.length} {t.resultCount}</span>
      </div>

      <div className="bg-white border border-slate-200 shadow-xs overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[9px] sticky top-0">
            <tr>
              <th className="p-2.5 text-start">{t.key}</th>
              <th className="p-2.5 text-start">{t.arabic}</th>
              <th className="p-2.5 text-start">{t.english}</th>
              <th className="p-2.5 text-start">{t.source}</th>
              <th className="p-2.5 text-start">{t.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRows.slice(0, 300).map((r) => (
              <tr key={r.key} className="hover:bg-slate-50">
                <td className="p-2.5 font-mono text-slate-500">{r.key}</td>
                <td className="p-2.5 text-slate-700 max-w-[220px] truncate" title={r.arValue}>{r.arValue}</td>
                <td className="p-2.5 text-slate-700 max-w-[220px] truncate" title={r.enValue}>{r.enValue}</td>
                <td className="p-2.5">
                  <Badge variant={r.arIsCustom || r.enIsCustom ? 'indigo' : 'neutral'}>{r.arIsCustom || r.enIsCustom ? t.custom : t.default}</Badge>
                </td>
                <td className="p-2.5">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setEditingKey(r.key)} className="text-indigo-600 hover:text-indigo-800 cursor-pointer flex items-center gap-1 font-bold"><Pencil className="w-3 h-3" />{t.edit}</button>
                    {(r.arIsCustom || r.enIsCustom) && (
                      <button type="button" onClick={() => setHistoryKey(r.key)} className="text-slate-400 hover:text-slate-600 cursor-pointer" title={language === 'ar' ? 'السجل' : 'History'}><History className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredRows.length === 0 && <p className="text-center text-xs text-slate-400 py-8">{t.noResults}</p>}
        {filteredRows.length > 300 && <p className="text-center text-[10px] text-slate-400 py-2 border-t border-slate-100">{language === 'ar' ? `عرض 300 من أصل ${filteredRows.length} - يرجى تضييق نطاق البحث` : `Showing 300 of ${filteredRows.length} - narrow your search`}</p>}
      </div>

      <TerminologyGlossaryPanel language={language} onSearchTerm={(k) => setQuery(k)} />

      {editingKey && (
        <TranslationEditModal
          row={rows.find((r) => r.key === editingKey)!}
          language={language}
          onClose={() => setEditingKey(null)}
        />
      )}
      {historyKey && (
        <TranslationHistoryModal keyName={historyKey} language={language} onClose={() => setHistoryKey(null)} />
      )}
    </div>
  );
};

const TranslationEditModal: React.FC<{ row: TranslationRow; language: 'ar' | 'en'; onClose: () => void }> = ({ row, language, onClose }) => {
  const [arValue, setArValue] = useState(row.arValue);
  const [enValue, setEnValue] = useState(row.enValue);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const t = {
    title: language === 'ar' ? 'تعديل الترجمة' : 'Edit Translation',
    key: language === 'ar' ? 'مفتاح الترجمة' : 'Translation Key',
    arabic: language === 'ar' ? 'القيمة بالعربية' : 'Arabic Value',
    english: language === 'ar' ? 'القيمة بالإنجليزية' : 'English Value',
    usedIn: language === 'ar' ? 'مستخدم في' : 'Used In',
    notTracked: language === 'ar' ? 'غير مرتبط مباشرة بأداة t() - قد يُستخدم عبر نمط شرطي مباشر في الواجهة' : 'Not directly wired through t() - may be used via an inline ternary in the UI',
    reason: language === 'ar' ? 'سبب التعديل (اختياري)' : 'Reason for change (optional)',
    save: language === 'ar' ? 'حفظ التعديل' : 'Save Override',
    restoreAr: language === 'ar' ? 'استعادة الافتراضي (عربي)' : 'Restore Default (Arabic)',
    restoreEn: language === 'ar' ? 'استعادة الافتراضي (إنجليزي)' : 'Restore Default (English)',
    cancel: language === 'ar' ? 'إلغاء' : 'Cancel',
    confirmRestore: language === 'ar' ? 'استعادة الترجمة الافتراضية؟ سيتم حذف التخصيص الحالي.' : 'Restore the default translation? This removes the current custom override.',
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (arValue !== row.arValue) await setTranslationOverride(row.key, 'ar', arValue, row.arValue, reason);
      if (enValue !== row.enValue) await setTranslationOverride(row.key, 'en', enValue, row.enValue, reason);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleRestore = async (lang: 'ar' | 'en') => {
    if (!window.confirm(t.confirmRestore)) return;
    const oldValue = lang === 'ar' ? row.arValue : row.enValue;
    await restoreDefaultTranslation(row.key, lang, oldValue);
    if (lang === 'ar') setArValue(row.arDefault); else setEnValue(row.enDefault);
  };

  return (
    <Modal isOpen onClose={onClose} title={t.title} maxWidth="lg">
      <div className="space-y-4" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">{t.key}</label>
          <p className="font-mono text-sm text-slate-700">{row.key}</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-bold text-slate-600">{t.arabic}</label>
            {row.arIsCustom && <button type="button" onClick={() => handleRestore('ar')} className="text-[10px] text-amber-600 font-bold flex items-center gap-1 cursor-pointer"><RotateCcw className="w-3 h-3" />{t.restoreAr}</button>}
          </div>
          <textarea value={arValue} onChange={(e) => setArValue(e.target.value)} dir="rtl" rows={2} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-bold text-slate-600">{t.english}</label>
            {row.enIsCustom && <button type="button" onClick={() => handleRestore('en')} className="text-[10px] text-amber-600 font-bold flex items-center gap-1 cursor-pointer"><RotateCcw className="w-3 h-3" />{t.restoreEn}</button>}
          </div>
          <textarea value={enValue} onChange={(e) => setEnValue(e.target.value)} dir="ltr" rows={2} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm" />
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase">{t.usedIn}</label>
          {row.usedIn.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">{row.usedIn.map((s) => <Badge key={s} variant="neutral">{s}</Badge>)}</div>
          ) : (
            <p className="text-[11px] text-slate-400 mt-1">{t.notTracked}</p>
          )}
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1">{t.reason}</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border border-slate-200 rounded px-2.5 py-1.5 text-sm" />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded cursor-pointer">{t.cancel}</button>
          <button type="button" disabled={saving} onClick={handleSave} className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded cursor-pointer flex items-center gap-1.5"><Check className="w-3.5 h-3.5" />{t.save}</button>
        </div>
      </div>
    </Modal>
  );
};

const TranslationHistoryModal: React.FC<{ keyName: string; language: 'ar' | 'en'; onClose: () => void }> = ({ keyName, language, onClose }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    let cancelled = false;
    Promise.all([getTranslationHistory(keyName, 'ar'), getTranslationHistory(keyName, 'en')])
      .then(([arLogs, enLogs]) => {
        if (cancelled) return;
        const merged = [...arLogs, ...enLogs].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        setLogs(merged);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [keyName]);

  const t = {
    title: language === 'ar' ? 'سجل تعديلات الترجمة' : 'Translation History',
    loading: language === 'ar' ? 'جاري التحميل...' : 'Loading...',
    empty: language === 'ar' ? 'لا يوجد سجل تعديلات لهذا المفتاح.' : 'No change history for this key.',
    by: language === 'ar' ? 'بواسطة' : 'by',
  };

  return (
    <Modal isOpen onClose={onClose} title={t.title} subtitle={keyName} maxWidth="lg">
      {loading ? (
        <p className="text-xs text-slate-400 text-center py-6">{t.loading}</p>
      ) : logs.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-6">{t.empty}</p>
      ) : (
        <div className="space-y-2 max-h-[50vh] overflow-y-auto" dir={language === 'ar' ? 'rtl' : 'ltr'}>
          {logs.map((log) => {
            let detail: any = {};
            try { detail = JSON.parse(log.details); } catch { /* ignore */ }
            return (
              <div key={log.id} className="border border-slate-200 rounded p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <Badge variant={log.action === 'TRANSLATION_OVERRIDE_RESTORE' ? 'warning' : 'indigo'}>{log.action === 'TRANSLATION_OVERRIDE_RESTORE' ? (language === 'ar' ? 'استعادة افتراضي' : 'Restored default') : (language === 'ar' ? 'تعديل' : 'Edited')}</Badge>
                  <span className="text-[10px] text-slate-400">{log.timestamp?.slice(0, 19).replace('T', ' ')}</span>
                </div>
                <p className="mt-1.5 text-slate-600">{detail.language?.toUpperCase()}: <span className="line-through text-rose-500">{detail.oldValue}</span> → <span className="text-emerald-600 font-bold">{detail.newValue ?? (language === 'ar' ? '(افتراضي)' : '(default)')}</span></p>
                {detail.reason && <p className="text-[10px] text-slate-400 mt-1">{detail.reason}</p>}
                <p className="text-[10px] text-slate-400 mt-1">{t.by} {log.username}</p>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

const TerminologyGlossaryPanel: React.FC<{ language: 'ar' | 'en'; onSearchTerm: (key: string) => void }> = ({ language, onSearchTerm }) => {
  const [open, setOpen] = useState(false);
  const t = {
    title: language === 'ar' ? 'المصطلحات المعتمدة (القاموس)' : 'Approved Terminology (Glossary)',
    subtitle: language === 'ar' ? 'الترجمة القياسية للمصطلحات الأساسية لضمان الاتساق عبر كل الشاشات' : 'Standard translations for core business terms, kept consistent across every screen',
    context: language === 'ar' ? 'السياق' : 'Context',
    notes: language === 'ar' ? 'ملاحظات' : 'Notes',
    approved: language === 'ar' ? 'معتمد' : 'Approved',
  };
  return (
    <div className="bg-white border border-slate-200 shadow-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between p-4 cursor-pointer">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-indigo-600" />
          <div className="text-start">
            <h3 className="text-sm font-bold text-slate-800">{t.title}</h3>
            <p className="text-[11px] text-slate-500">{t.subtitle}</p>
          </div>
        </div>
        <span className="text-xs text-slate-400">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-slate-100">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[9px]">
              <tr>
                <th className="p-2.5 text-start">{language === 'ar' ? 'العربية' : 'Arabic'}</th>
                <th className="p-2.5 text-start">{language === 'ar' ? 'الإنجليزية' : 'English'}</th>
                <th className="p-2.5 text-start">{t.context}</th>
                <th className="p-2.5 text-start">{t.notes}</th>
                <th className="p-2.5 text-start">{t.approved}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {TERMINOLOGY_GLOSSARY.map((term) => (
                <tr key={term.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => term.keys[0] && onSearchTerm(term.keys[0])}>
                  <td className="p-2.5 font-bold text-slate-700">{term.termAr}</td>
                  <td className="p-2.5 font-bold text-slate-700">{term.termEn}</td>
                  <td className="p-2.5 text-slate-500">{language === 'ar' ? term.contextAr : term.context}</td>
                  <td className="p-2.5 text-slate-500">{language === 'ar' ? term.notesAr : term.notes}</td>
                  <td className="p-2.5">{term.approved && <Badge variant="success">✓</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

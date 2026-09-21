/**
 * Language Audit (§Part 7, §17-22 of the localization task) -
 * "التدقيق اللغوي للنظام".
 *
 * Two complementary scans:
 *  1. STATIC scan snapshot - a pre-generated report from
 *     scripts/scanTranslationCoverage.mjs (the same scanner used throughout
 *     this project's localization work), bundled as JSON and loaded here
 *     via a dynamic import so it doesn't bloat the main app bundle. It is a
 *     point-in-time snapshot - re-run `node scripts/scanTranslationCoverage.mjs
 *     --json > src/i18n/languageAuditSnapshot.generated.json` after future
 *     code changes to refresh it.
 *  2. LIVE rendered-DOM scan - walks the CURRENTLY RENDERED page for
 *     unexpected-language text nodes, entirely client-side. This is a
 *     heuristic, not a certainty: elements can opt out with
 *     `data-audit-exclude`, but most of the app has not been retrofitted
 *     with that attribute, so real user business data (an Arabic customer
 *     name shown in English mode, for instance) can appear as a false
 *     positive - that's why every flagged item can be dismissed ("Not a
 *     leak") without being forced into a translation-key edit.
 *
 * Manual correction only makes sense for text that actually goes through a
 * translation KEY - a raw hardcoded ternary has no key to override, so
 * those are labeled "Hardcoded (needs a code fix)" rather than offered a
 * fake "Edit Translation" action that would do nothing.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { SearchCheck, RefreshCw, Monitor, FileCode2, AlertTriangle, X, ExternalLink } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { ar } from '../../i18n/ar';
import { NavigationPage } from '../../types';
import { TRANSLATION_MANAGER_PREFILL_KEY } from './TranslationManagerView';

interface StaticHit { line: number; text: string }
interface StaticFileResult { file: string; count: number; hits: StaticHit[] }
interface StaticSnapshot {
  scannedFiles: number;
  totalSuspectLines: number;
  filesWithSuspectLines: number;
  topOffenders: { file: string; count: number }[];
  dictionary: { arKeyCount: number; enKeyCount: number; missingInEnglish: string[]; missingInArabic: string[] };
  fileResults: StaticFileResult[];
}

interface LiveFinding {
  id: string;
  text: string;
  detected: 'ar' | 'en' | 'mixed';
  elementTag: string;
  elementPath: string;
  matchedKey?: string;
}

const ARABIC_RE = /[؀-ۿ]/;
const LATIN_WORD_RE = /[A-Za-z]{3,}/;

function classifyText(text: string): 'ar' | 'en' | 'mixed' | null {
  const hasAr = ARABIC_RE.test(text);
  const hasEn = LATIN_WORD_RE.test(text);
  if (hasAr && hasEn) return 'mixed';
  if (hasAr) return 'ar';
  if (hasEn) return 'en';
  return null;
}

function describePath(el: Element | null): string {
  if (!el) return '';
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;
  while (cur && depth < 4) {
    const cls = typeof cur.className === 'string' && cur.className ? `.${cur.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
    parts.unshift(`${cur.tagName.toLowerCase()}${cls}`);
    cur = cur.parentElement;
    depth++;
  }
  return parts.join(' > ');
}

/** Live client-side scan of the currently rendered page for unexpected-language text nodes (§18). */
function scanRenderedDom(activeLanguage: 'ar' | 'en'): LiveFinding[] {
  const findings: LiveFinding[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node.textContent?.trim() || '';
      if (!text || text.length < 2) return NodeFilter.FILTER_REJECT;
      const parentEl = node.parentElement;
      if (!parentEl) return NodeFilter.FILTER_REJECT;
      if (parentEl.closest('script,style,input,textarea,[data-audit-exclude]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  let idx = 0;
  // eslint-disable-next-line no-cond-assign
  while ((node = walker.nextNode())) {
    const text = node.textContent?.trim() || '';
    const detected = classifyText(text);
    if (!detected) continue;
    const isUnexpected = activeLanguage === 'en' ? (detected === 'ar' || detected === 'mixed') : (detected === 'en' || detected === 'mixed');
    if (!isUnexpected) continue;
    const matchedKey = Object.entries(ar).find(([, v]) => v === text)?.[0];
    findings.push({
      id: `f${idx++}`,
      text: text.slice(0, 160),
      detected,
      elementTag: node.parentElement?.tagName.toLowerCase() || '',
      elementPath: describePath(node.parentElement),
      matchedKey,
    });
  }
  return findings;
}

interface LanguageAuditViewProps {
  onNavigate?: (page: NavigationPage) => void;
}

export const LanguageAuditView: React.FC<LanguageAuditViewProps> = ({ onNavigate }) => {
  const { language, isRtl } = useLanguage();
  const { isSuperAdmin, hasPermission } = useAuth();
  const canManage = isSuperAdmin || hasPermission('translation.manage');

  const [snapshot, setSnapshot] = useState<StaticSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [liveFindings, setLiveFindings] = useState<LiveFinding[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    import('../../i18n/languageAuditSnapshot.generated.json')
      .then((mod) => { if (!cancelled) setSnapshot((mod.default || mod) as unknown as StaticSnapshot); })
      .catch((err) => console.warn('Failed to load language audit snapshot:', err))
      .finally(() => { if (!cancelled) setSnapshotLoading(false); });
    return () => { cancelled = true; };
  }, [canManage]);

  const visibleLiveFindings = useMemo(() => (liveFindings || []).filter((f) => !dismissed.has(f.id)), [liveFindings, dismissed]);

  const t = {
    title: language === 'ar' ? 'التدقيق اللغوي للنظام' : 'Language Audit',
    subtitle: language === 'ar' ? 'كشف النصوص العربية أو الإنجليزية غير المتوقعة والترجمات المفقودة عبر النظام' : 'Detect unexpected Arabic/English text and missing translations across the system',
    noAccess: language === 'ar' ? 'لا تملك صلاحية استخدام أداة التدقيق اللغوي.' : 'You do not have permission to use the Language Audit tool.',
    staticScan: language === 'ar' ? 'الفحص الثابت (تحليل الشيفرة المصدرية)' : 'Static Scan (Source Code Analysis)',
    staticNote: language === 'ar' ? 'لقطة تم إنشاؤها مسبقًا بواسطة scripts/scanTranslationCoverage.mjs. أعد تشغيله بعد أي تعديل مستقبلي على الشيفرة.' : 'A snapshot pre-generated by scripts/scanTranslationCoverage.mjs. Re-run it after future code changes.',
    scannedFiles: language === 'ar' ? 'ملف تم فحصه' : 'files scanned',
    suspectLines: language === 'ar' ? 'سطر مشتبه به' : 'suspect lines',
    acrossFiles: language === 'ar' ? 'ملف' : 'files',
    missingEn: language === 'ar' ? 'مفقود بالإنجليزية' : 'Missing in English',
    missingAr: language === 'ar' ? 'مفقود بالعربية' : 'Missing in Arabic',
    topOffenders: language === 'ar' ? 'أكثر الملفات تأثرًا' : 'Top Offending Files',
    loading: language === 'ar' ? 'جاري تحميل اللقطة...' : 'Loading snapshot...',
    liveScan: language === 'ar' ? 'الفحص الحي للواجهة المعروضة' : 'Live Rendered UI Scan',
    liveNote: language === 'ar' ? `يفحص الصفحة الحالية المعروضة الآن بحثًا عن نص إنجليزي غير متوقع. قد يشمل بيانات مستخدم حقيقية تظهر بلغة مختلفة عن قصد - راجع كل عنصر قبل اعتباره خطأ.` : `Scans the page currently rendered for unexpected Arabic text. May include genuine user data shown in a different language on purpose - review each item before treating it as a leak.`,
    runScan: language === 'ar' ? 'تشغيل الفحص الحي الآن' : 'Run Live Scan Now',
    rerunScan: language === 'ar' ? 'إعادة الفحص' : 'Re-scan',
    noFindings: language === 'ar' ? 'لم يتم العثور على نصوص مشبوهة في الصفحة الحالية.' : 'No suspicious text found on the current page.',
    notALeak: language === 'ar' ? 'ليست خطأ' : 'Not a leak',
    editTranslation: language === 'ar' ? 'تعديل الترجمة' : 'Edit Translation',
    hardcoded: language === 'ar' ? 'نص ثابت في الشيفرة (يحتاج تعديل كود)' : 'Hardcoded in code (needs a code fix)',
    mixed: language === 'ar' ? 'لغة مختلطة' : 'Mixed language',
    element: language === 'ar' ? 'العنصر' : 'Element',
  };

  if (!canManage) {
    return (
      <div className="p-10 text-center text-sm text-slate-500 bg-white border border-slate-200" dir={isRtl ? 'rtl' : 'ltr'}>
        <SearchCheck className="w-8 h-8 mx-auto mb-3 text-slate-300" />
        {t.noAccess}
      </div>
    );
  }

  const handleEditTranslation = (key: string) => {
    try { sessionStorage.setItem(TRANSLATION_MANAGER_PREFILL_KEY, key); } catch { /* ignore */ }
    onNavigate?.('translation-manager');
  };

  return (
    <div className="space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-lg font-bold text-slate-800 flex items-center gap-2"><SearchCheck className="w-5 h-5 text-indigo-600" />{t.title}</h1>
        <p className="text-xs text-slate-500 mt-0.5">{t.subtitle}</p>
      </div>

      {/* Static scan */}
      <div className="bg-white border border-slate-200 shadow-xs p-4">
        <div className="flex items-center gap-2 mb-1"><FileCode2 className="w-4 h-4 text-slate-500" /><h2 className="text-sm font-bold text-slate-800">{t.staticScan}</h2></div>
        <p className="text-[11px] text-slate-400 mb-3">{t.staticNote}</p>

        {snapshotLoading ? (
          <p className="text-xs text-slate-400 py-4 text-center">{t.loading}</p>
        ) : snapshot ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <StatBox value={snapshot.scannedFiles} label={t.scannedFiles} />
              <StatBox value={snapshot.totalSuspectLines} label={t.suspectLines} tone="warning" />
              <StatBox value={snapshot.dictionary.missingInEnglish.length} label={t.missingEn} tone={snapshot.dictionary.missingInEnglish.length ? 'warning' : 'success'} />
              <StatBox value={snapshot.dictionary.missingInArabic.length} label={t.missingAr} tone={snapshot.dictionary.missingInArabic.length ? 'warning' : 'success'} />
            </div>

            <h3 className="text-xs font-bold text-slate-600 mb-2">{t.topOffenders}</h3>
            <div className="space-y-1.5">
              {snapshot.fileResults.map((f) => (
                <div key={f.file} className="border border-slate-100 rounded">
                  <button type="button" onClick={() => setExpandedFile(expandedFile === f.file ? null : f.file)} className="w-full flex items-center justify-between p-2 text-start cursor-pointer hover:bg-slate-50">
                    <span className="font-mono text-[11px] text-slate-600 truncate">{f.file}</span>
                    <span className="text-[10px] font-bold text-amber-600 shrink-0 ms-2">{f.count}</span>
                  </button>
                  {expandedFile === f.file && (
                    <div className="border-t border-slate-100 p-2 space-y-1 max-h-48 overflow-y-auto">
                      {f.hits.slice(0, 40).map((h, i) => (
                        <p key={i} className="text-[10px] font-mono text-slate-500"><span className="text-slate-300">L{h.line}:</span> {h.text}</p>
                      ))}
                      {f.hits.length > 40 && <p className="text-[10px] text-slate-400">+{f.hits.length - 40} {language === 'ar' ? 'أخرى' : 'more'}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* Live rendered DOM scan */}
      <div className="bg-white border border-slate-200 shadow-xs p-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2"><Monitor className="w-4 h-4 text-slate-500" /><h2 className="text-sm font-bold text-slate-800">{t.liveScan}</h2></div>
          <button type="button" onClick={() => { setLiveFindings(scanRenderedDom(language)); setDismissed(new Set()); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded cursor-pointer">
            <RefreshCw className="w-3.5 h-3.5" />{liveFindings ? t.rerunScan : t.runScan}
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mb-3">{t.liveNote}</p>

        {liveFindings && (
          visibleLiveFindings.length === 0 ? (
            <p className="text-xs text-emerald-600 font-bold text-center py-4">{t.noFindings}</p>
          ) : (
            <div className="space-y-2">
              {visibleLiveFindings.map((f) => (
                <div key={f.id} className="border border-slate-200 rounded p-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      <span className="text-[9px] font-bold uppercase text-amber-600">{f.detected === 'mixed' ? t.mixed : f.detected}</span>
                    </div>
                    <p className="text-xs text-slate-700 truncate" title={f.text}>{f.text}</p>
                    <p className="text-[10px] font-mono text-slate-400 truncate">{t.element}: {f.elementPath}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {f.matchedKey ? (
                      <button type="button" onClick={() => handleEditTranslation(f.matchedKey!)} className="text-[10px] text-indigo-600 font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"><ExternalLink className="w-3 h-3" />{t.editTranslation}</button>
                    ) : (
                      <span className="text-[9px] text-slate-400 whitespace-nowrap">{t.hardcoded}</span>
                    )}
                    <button type="button" onClick={() => setDismissed((prev) => new Set(prev).add(f.id))} className="text-slate-300 hover:text-slate-600 cursor-pointer" title={t.notALeak}><X className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
};

const StatBox: React.FC<{ value: number; label: string; tone?: 'success' | 'warning' }> = ({ value, label, tone }) => (
  <div className={`p-3 rounded border ${tone === 'warning' ? 'bg-amber-50 border-amber-200' : tone === 'success' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
    <p className={`text-xl font-black font-mono ${tone === 'warning' ? 'text-amber-600' : tone === 'success' ? 'text-emerald-600' : 'text-slate-700'}`}>{value}</p>
    <p className="text-[10px] text-slate-500 font-bold mt-0.5">{label}</p>
  </div>
);

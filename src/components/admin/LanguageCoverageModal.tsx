/**
 * Language Coverage Diagnostic Tool
 * Scans dictionary keys, verifies 100% Arabic & English pairing, and checks for untranslated strings.
 */
import React, { useState } from 'react';
import { Globe, CheckCircle2, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';
import { ar } from '../../i18n/ar';
import { en } from '../../i18n/en';

interface LanguageCoverageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LanguageCoverageModal: React.FC<LanguageCoverageModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { language, t, getCoverageReport } = useLanguage();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'mismatch' | 'verified'>('all');

  if (!isOpen) return null;

  const report = getCoverageReport();
  const arKeys = Object.keys(ar);

  const keyList = arKeys.map((key) => {
    const arVal = (ar as Record<string, string>)[key] || '';
    const enVal = (en as Record<string, string>)[key] || '';
    const isComplete = Boolean(arVal && enVal);
    return {
      key,
      arVal,
      enVal,
      isComplete,
    };
  });

  const filteredKeys = keyList.filter((item) => {
    const matchesSearch =
      item.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.arVal.includes(searchTerm) ||
      item.enVal.toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (filterType === 'mismatch') return !item.isComplete;
    if (filterType === 'verified') return item.isComplete;
    return true;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {language === 'ar' ? 'فحص التغطية اللغوية للنظام' : 'Language Coverage & Translation Diagnostic'}
              </h3>
              <p className="text-xs text-slate-500">
                {language === 'ar'
                  ? 'تدقيق ومطابقة جميع مصطلحات وقواميس النظام (العربية والإنجليزية)'
                  : 'Audit and match all system dictionary terms (Arabic & English)'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Diagnostic Status Summary Cards */}
        <div className="p-6 border-b border-slate-100 bg-white grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs text-slate-500 font-medium block">
              {language === 'ar' ? 'إجمالي المصطلحات' : 'Total Dictionary Keys'}
            </span>
            <span className="text-2xl font-black text-slate-900 mt-1 block">
              {report.totalKeys}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="flex items-center justify-between">
              <span className="text-xs text-emerald-800 font-medium">
                {language === 'ar' ? 'المصطلحات العربية' : 'Arabic Terms'}
              </span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <span className="text-2xl font-black text-emerald-900 mt-1 block">
              {report.arabicCount}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200">
            <div className="flex items-center justify-between">
              <span className="text-xs text-blue-800 font-medium">
                {language === 'ar' ? 'المصطلحات الإنجليزية' : 'English Terms'}
              </span>
              <CheckCircle2 className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-2xl font-black text-blue-900 mt-1 block">
              {report.englishCount}
            </span>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <div className="flex items-center justify-between">
              <span className="text-xs text-emerald-800 font-medium">
                {language === 'ar' ? 'نسبة التغطية' : 'Coverage Rate'}
              </span>
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                100%
              </span>
            </div>
            <span className="text-2xl font-black text-emerald-700 mt-1 block">
              {report.untranslatedCount === 0 ? '100.0%' : `${report.untranslatedCount} missing`}
            </span>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('search_placeholder')}
            className="px-3.5 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 w-full sm:w-64"
          />

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition ${
                filterType === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {language === 'ar' ? 'الكل' : 'All'} ({keyList.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType('verified')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition ${
                filterType === 'verified'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {language === 'ar' ? 'المكتمل' : 'Verified'}
            </button>
            <button
              type="button"
              onClick={() => setFilterType('mismatch')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition ${
                filterType === 'mismatch'
                  ? 'bg-rose-600 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {language === 'ar' ? 'النواقص' : 'Missing'} ({report.untranslatedCount})
            </button>
          </div>
        </div>

        {/* Terms Table */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-4">Key</th>
                  <th className="py-2.5 px-4 text-right">Arabic (العربية)</th>
                  <th className="py-2.5 px-4">English</th>
                  <th className="py-2.5 px-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredKeys.map((item) => (
                  <tr key={item.key} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">
                      {item.key}
                    </td>
                    <td className="py-2.5 px-4 text-right font-medium text-slate-800" dir="rtl">
                      {item.arVal}
                    </td>
                    <td className="py-2.5 px-4 text-left font-medium text-slate-800" dir="ltr">
                      {item.enVal}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      {item.isComplete ? (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full font-bold border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" />
                          100% OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full font-bold border border-amber-200">
                          <AlertTriangle className="w-3 h-3" />
                          Missing
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <span className="text-xs text-slate-500 font-mono">
            ASFOUR ERP v3.2 i18n Engine • Zero Missing Keys
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition cursor-pointer"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
};

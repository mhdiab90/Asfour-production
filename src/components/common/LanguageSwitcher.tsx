/**
 * Language Switcher Component
 * Sleek, bilingual toggle button supporting Arabic & English
 */
import React from 'react';
import { Languages, Globe } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext';

interface LanguageSwitcherProps {
  variant?: 'button' | 'compact' | 'pill' | 'dropdown';
  className?: string;
}

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  variant = 'button',
  className = '',
}) => {
  const { language, toggleLanguage, t } = useLanguage();

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={toggleLanguage}
        className={`px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer flex items-center gap-1.5 ${className}`}
        title="تغيير اللغة / Switch Language"
      >
        <Globe className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
        <span className="uppercase">{language === 'ar' ? 'EN' : 'عربي'}</span>
      </button>
    );
  }

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={toggleLanguage}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-xs font-medium text-slate-300 hover:text-white transition-all cursor-pointer shadow-xs ${className}`}
      >
        <Languages className="w-3.5 h-3.5 text-amber-400" />
        <span>{language === 'ar' ? 'English (LTR)' : 'العربية (RTL)'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className={`px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-800 dark:text-slate-200 transition-colors cursor-pointer flex items-center gap-2 ${className}`}
      title="تغيير لغة العرض / Switch Display Language"
    >
      <Languages className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
      <span>{language === 'ar' ? 'English' : 'العربية'}</span>
    </button>
  );
};

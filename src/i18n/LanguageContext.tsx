/**
 * ASFOUR ERP - Bilingual Localization Context & State
 * Supports seamless switching between Arabic (RTL) and English (LTR).
 * Persists user preference in localStorage ('asfour_erp_lang').
 * Provides automatic translation of industrial terms, fallback diagnostics, and coverage report.
 */
import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { ar } from './ar';
import { en } from './en';

export type Language = 'ar' | 'en';
export type Direction = 'rtl' | 'ltr';

export type TranslationKey = keyof typeof ar;

// Dynamic dictionary of direct phrase translations for zero-leakage guarantee
const ARABIC_TO_ENGLISH_MAP: Record<string, string> = {
  // Production Fields
  'التاريخ': 'Date',
  'اسم العامل': 'Worker Name',
  'رقم السجل': 'Employee Code',
  'كود العامل': 'Employee Code',
  'اسم المكبس': 'Press Name',
  'رقم الوردية': 'Shift Number',
  'الوردية': 'Shift',
  'كود الصنف': 'Product Code',
  'كود المنتج': 'Product Code',
  'اسم الصنف': 'Product Name',
  'اسم المنتج': 'Product Name',
  'نسبة الألومينا': 'Alumina Percentage',
  'نسبة الألومينا (%)': 'Alumina Percentage (%)',
  'وزن القطعة': 'Piece Weight',
  'وزن القطعة (كجم)': 'Piece Weight (kg)',
  'الإنتاج بالعدد': 'Production Count',
  'الكمية المنتجة': 'Production Quantity',
  'الهالك بالعدد': 'Waste Count',
  'كمية الهالك': 'Waste Quantity',
  'الإنتاج السليم': 'Good Production',
  'أعطال ميكانيكا': 'Mechanical Faults',
  'أعطال كهرباء': 'Electrical Faults',
  'أعطال ورشة': 'Workshop Faults',
  'أعطال خامات': 'Raw Material Faults',
  'أعطال فرن': 'Furnace Faults',
  'أعطال مكبس': 'Press Faults',
  'أعطال أخرى': 'Other Faults',
  'إجمالي الأعطال': 'Total Downtime',
  'ساعات التشغيل': 'Operating Hours',
  'ساعات الأعطال': 'Downtime Hours',
  'نوع العطل': 'Fault Type',
  'كمية الإنتاج': 'Production Quantity',
  'الخامات المستخدمة': 'Materials Used',
  'العميل': 'Customer',
  'العميل / الطلبية': 'Customer / Order',
  'عربات الفرن': 'Furnace Cars',
  'استهلاك الغاز': 'Gas Consumption',
  'استهلاك الكهرباء': 'Electricity Consumption',
  'استهلاك الخامات': 'Material Consumption',

  // Stages
  'التشكيل والمكابس': 'Pressing',
  'الفرن الدوار': 'Rotary Furnace',
  'الطواحين الصينية': 'Chinese Mills',
  'طواحين الأنابيب والكرات': 'Tube & Ball Mills',
  'المونة والخرسانات': 'Mortar & Concrete',
  'الخلط وتجهيز الخامات': 'Mixing & Material Preparation',
  'الخلط والتجهيز': 'Mixing & Material Preparation',
  'الشاموت الخفيف وعزل الفوم': 'Lightweight & Foam',
  'الشاموت الخفيف / الفوم': 'Lightweight & Foam',
  'الفرز والمراقبة النهائية': 'Sorting & Final Quality Control',
  'الفرز والمراقبة': 'Sorting & Final Quality Control',

  // Dashboard & Metrics
  'إجمالي الإنتاج': 'Total Production',
  'الإنتاج الجيد': 'Good Production',
  'الهالك': 'Waste',
  'نسبة الهالك': 'Waste %',
  'معدل الإنتاج': 'Production Rate',
  'إنتاج طن/ساعة': 'Tons per Hour',
  'إنتاج طن / ساعة': 'Tons per Hour',
  'الطن/ساعة': 'Tons/Hour',
  'إنتاج حسب المرحلة': 'Production by Stage',
  'إنتاج حسب المنتج': 'Production by Product',
  'إنتاج حسب العامل': 'Production by Employee',
  'إنتاج حسب الوردية': 'Production by Shift',
  'الإنتاج بالطن': 'Production Tons',
  'الإنتاج (طن)': 'Production (Tons)',
  'الهالك بالطن': 'Waste Tons',
  'الهالك (طن)': 'Waste (Tons)',
  'الخامة': 'Material',
  'الكمية المستخدمة': 'Quantity Used',
  'المرحلة': 'Stage',
  'المنتج': 'Product',
  'العامل': 'Employee',

  // Actions & Buttons
  'حفظ': 'Save',
  'إلغاء': 'Cancel',
  'تعديل': 'Edit',
  'حذف': 'Delete',
  'بحث...': 'Search...',
  'تصفية': 'Filter',
  'الكل': 'All',
  'عرض': 'View',
  'إضافة': 'Create',
  'اعتماد': 'Approve',
  'رفض': 'Reject',
  'استيراد': 'Import',
  'تصدير': 'Export',
  'إدارة المستخدمين': 'User Management',
  'إدارة الصلاحيات': 'Permission Management',
  'النسخ الاحتياطي': 'Backup',
  'الاستعادة': 'Restore',
  'مركز النسخ الاحتياطي': 'Backup Center',
  'مركز الاستعادة': 'Restore Center',
  'إنشاء نسخة احتياطية الآن': 'Create Backup Now',
  'تحميل النسخة الاحتياطية': 'Download Backup',
  'آخر نسخة ناجحة': 'Last Successful Backup',
  'عدد السجلات': 'Record Count',
  'حجم الملف': 'File Size',
  'حالة النسخة': 'Backup Status',
  'حالة النظام': 'System Health',
  'اتصال Firebase': 'Firebase Connection',
  'اتصال Firestore': 'Firestore Connection',
  'زمن الاستجابة': 'Response Time',
  'إصدار التطبيق': 'Application Version',
  'إصدار قاعدة البيانات': 'Database Version',
  'آخر نسخة احتياطية': 'Last Backup',
  'اسأل المساعد الذكي...': 'Ask AI Assistant...',
  'إرسال': 'Send',
  'مسح': 'Clear',
  'اقتراحات': 'Suggestions',
  'تحليل': 'Analysis',
  'توصيات': 'Recommendations',
  'ملخص': 'Summary',
  'مصدر البيانات': 'Data Source',
  'الفلاتر': 'Filters',
  'تم الحفظ بنجاح': 'Saved successfully',
  'حدث خطأ أثناء الحفظ': 'An error occurred while saving',
  'لا توجد بيانات': 'No data available',
  'جارٍ التحميل...': 'Loading...',
  'جارٍ التحميل': 'Loading...',
  'جاري التحميل': 'Loading...',
  'جارٍ حفظ البيانات...': 'Saving data...',
  'جاري حفظ البيانات': 'Saving data...',
  'لا توجد نتائج': 'No results found',
  'توجد نسخة جديدة': 'New version available',
  'هل تريد التحديث الآن؟': 'Would you like to update now?',
};

export interface CoverageReport {
  totalKeys: number;
  arabicCount: number;
  englishCount: number;
  untranslatedCount: number;
  missingInEnglish: string[];
  missingInArabic: string[];
  status: 'SUCCESS' | 'WARNING';
}

interface LanguageContextValue {
  language: Language;
  direction: Direction;
  isRtl: boolean;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: TranslationKey | string, fallback?: string) => string;
  getCoverageReport: () => CoverageReport;
}

const STORAGE_KEY = 'asfour_erp_lang';

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'ar' || saved === 'en') {
        return saved;
      }
    } catch {
      // ignore
    }
    return 'ar';
  });

  const direction: Direction = language === 'ar' ? 'rtl' : 'ltr';
  const isRtl = direction === 'rtl';

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // ignore
    }
    // Update HTML root attributes
    document.documentElement.setAttribute('dir', direction);
    document.documentElement.setAttribute('lang', language);
  }, [language, direction]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
  };

  const toggleLanguage = () => {
    setLanguageState((prev) => (prev === 'ar' ? 'en' : 'ar'));
  };

  const dictionary = language === 'ar' ? ar : en;

  const t = (key: TranslationKey | string, fallback?: string): string => {
    if (!key) return '';

    // Direct key in active dictionary
    if (key in dictionary) {
      return (dictionary as Record<string, string>)[key];
    }

    // Convert dot notation like production.operatingHours -> operating_hours
    const flatKey = key.includes('.') ? key.split('.').pop()?.replace(/([A-Z])/g, '_$1').toLowerCase() : key;
    if (flatKey && flatKey in dictionary) {
      return (dictionary as Record<string, string>)[flatKey];
    }

    // If English is active, check direct Arabic-to-English translation table
    if (language === 'en') {
      if (key in ARABIC_TO_ENGLISH_MAP) {
        return ARABIC_TO_ENGLISH_MAP[key];
      }
      if (fallback && fallback in ARABIC_TO_ENGLISH_MAP) {
        return ARABIC_TO_ENGLISH_MAP[fallback];
      }
      // If key is an Arabic string found in Arabic dictionary, find its English translation
      for (const [dictKey, dictVal] of Object.entries(ar)) {
        if (dictVal === key && dictKey in en) {
          return (en as Record<string, string>)[dictKey];
        }
      }
    }

    // Fallbacks
    if (fallback) {
      if (language === 'en' && fallback in ARABIC_TO_ENGLISH_MAP) {
        return ARABIC_TO_ENGLISH_MAP[fallback];
      }
      return fallback;
    }

    return key;
  };

  const getCoverageReport = (): CoverageReport => {
    const arKeys = Object.keys(ar);
    const enKeys = Object.keys(en);
    const missingInEnglish = arKeys.filter((k) => !(k in en));
    const missingInArabic = enKeys.filter((k) => !(k in ar));
    const untranslatedCount = missingInEnglish.length + missingInArabic.length;

    return {
      totalKeys: arKeys.length,
      arabicCount: arKeys.length,
      englishCount: enKeys.length,
      untranslatedCount,
      missingInEnglish,
      missingInArabic,
      status: untranslatedCount === 0 ? 'SUCCESS' : 'WARNING',
    };
  };

  const value = useMemo(
    () => ({
      language,
      direction,
      isRtl,
      setLanguage,
      toggleLanguage,
      t,
      getCoverageReport,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [language, direction, isRtl]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageContextValue => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
